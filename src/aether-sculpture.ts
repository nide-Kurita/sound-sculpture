import * as THREE from "three";
import type { AudioProfileSummary, SculpturePalette } from "./audio-palette";
import {
  createClayColorShift,
  weatherClayShiftFromSnapshot,
  hourClayShiftFromHour,
  combineClayShifts,
  type ClayColorShift,
} from "./clay-color";
import type { SpeciesProfile } from "./species-profile";
import type { StructureSnapshot } from "./structure-tracker";
import {
  clamp01,
  SILENCE_THRESHOLD,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
} from "./sculpture-types";

/**
 * aether（再設計）:
 * まず無音でも参考動画 0.53.09 に近い「滑らかな光の体積」を
 * SDF（柔らかいトーラス）＋ domain warp ＋ レイマーチで描く。
 * 音はその美しい場をパラメータ変調する層（スタンプ堆積ではない）。
 *
 * vita 思想の翻訳:
 * - 低音寄り: 太さ・質量パルス（major/minor、吸収）
 * - 中音寄り: 歪み・非対称の伸長（warp / stretch）
 * - 高音寄り: 細かいうねりの振幅（高周波 warp）
 */

// 参考動画は塊が画面の 7 割ほどを占める。1.7 では小さく、余白が広すぎた
const MESH_SCALE = 2.0;

/** 計測用 URL パラメータ。本番で曲を聴くときは付けない */
const accentHueFromMix = (gold: number, rose: number, violet: number, mint: number) => {
  // 4色の円平均は補色同士で打ち消し、橙に戻る。一番強い色素を第3色にする
  const pigments = [
    { w: gold, h: 0.13 },
    { w: rose, h: 0.95 },
    { w: violet, h: 0.78 },
    { w: mint, h: 0.38 },
  ];
  let top = pigments[0];
  for (const p of pigments) if (p.w > top.w) top = p;
  return top.w < 1e-5 ? 0.13 : top.h;
};

const readAetherUrlNumber = (key: string): number | null => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const defaultRhythm = (): RhythmEvents => ({
  kick: 0,
  snare: 0,
  hat: 0,
  transient: 0,
  chop: 0,
  salience: 0,
  beat: 0,
  beatIndex: 0,
  kickIndex: 0,
  snareIndex: 0,
  hatIndex: 0,
  transientIndex: 0,
  chopIndex: 0,
  salienceIndex: 0,
  downbeat: false,
  bpm: 0,
  pulsePhase: 0,
  pulseConfidence: 0,
  pulseEnvelope: 0,
  pulseIndex: 0,
  kickLength: 0,
  snareLength: 0,
  hatLength: 0,
  kickRing: 0,
  snareRing: 0,
  hatRing: 0,
  melodyOnset: 0,
  salienceLow: 0,
  salienceMid: 0,
  salienceHigh: 0,
  subLevel: 0,
  wavePeak: 0,
  waveEnergy: 0,
});

const volumeVertexShader = /* glsl */ `
varying vec3 vLocalPos;
void main() {
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 軽量版: ステップ少なめ + 安い sin ノイズ + SDF 空空間スキップ。
 * （5oct fbm × 複数 × 110 step は実機で破綻するため）
 */
const volumeFragmentShader = /* glsl */ `
precision mediump float;

uniform vec3 uCamLocal;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uTime;
uniform float uMajor;
uniform float uMinor;
uniform float uWarp;
uniform float uWarpFine;
uniform float uStretchY;
uniform float uStretchX;
uniform float uTwist;
uniform float uAbsorption;
uniform float uEmission;
uniform float uSoftness;
uniform float uShell;
uniform float uBreath;
uniform float uHueShift;
uniform float uOpacity;
uniform float uSeed;
uniform float uMelt;
uniform float uFlowAmp;
uniform vec3 uAccent;
uniform float uChroma;

varying vec3 vLocalPos;

/* ハッシュ8点補間より桁違いに安い */
float cheapNoise(vec3 p) {
  return sin(dot(p, vec3(12.9898, 78.233, 37.719) + uSeed)) * 0.5
       + sin(dot(p, vec3(39.346, 11.135, 83.155))) * 0.35
       + sin(dot(p, vec3(73.156, 51.922, 17.441))) * 0.15;
}

float cheapFbm(vec3 p) {
  return cheapNoise(p) * 0.6 + cheapNoise(p * 2.1 + 1.7) * 0.4;
}

/**
 * 折り用の低周波うねり。
 * cheapNoise は周波数が 78 rad/unit もあり（塊の直径 ~1.1 に対して波長 0.08）、
 * 変位に使うと膜が霧状に砕けて斑点ノイズにしかならない。
 * 折りを作るには塊全体で1〜2周する程度の滑らかな波が要る。
 */
float swell(vec3 p, float phase) {
  return sin(p.x * 1.7 + p.y * 0.9 + phase) * 0.5
       + sin(p.y * 1.3 - p.z * 1.1 + phase * 0.7 + uSeed * 6.2831853) * 0.3
       + sin(p.z * 1.9 + p.x * 0.7 - phase * 0.5) * 0.2;
}

/**
 * Bridson 2007: curl(A)。A の各成分は swell と同じ低周波の sin。
 * 差分商はレイマーチ1サンプルあたり6回 swell 相当になるので解析解を使う。
 * cheapNoise 帯の波数は使わない（膜が霧に砕ける）。
 *
 * A = (s1, s2, s3), si = sin(dot(p, ki) + φi)
 * curl_x = k3.y c3 - k2.z c2  ほか同様。
 */
vec3 curlTerm(vec3 p, vec3 k1, vec3 k2, vec3 k3, float phase) {
  float c1 = cos(dot(p, k1) + phase);
  float c2 = cos(dot(p, k2) + phase * 0.71 + 1.7);
  float c3 = cos(dot(p, k3) + phase * 1.13 + 3.1);
  return vec3(
    k3.y * c3 - k2.z * c2,
    k1.z * c1 - k3.x * c3,
    k2.x * c2 - k1.y * c1
  );
}

vec3 curlSwell(vec3 p, float phase) {
  // 1オクターブ。細かい渦は呼び出し側でスケールを変える（Helicity Garden）
  // 2オクターブだと STEPS 112 で headless が 6.3→3.2fps まで落ちた
  return curlTerm(
    p,
    vec3(1.70, 0.90, 0.40),
    vec3(0.60, 1.30, -1.10),
    vec3(1.10, -0.50, 1.90),
    phase + uSeed * 6.2831853
  ) * 0.28;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 hueShiftRgb(vec3 c, float h) {
  float angle = h * 6.2831853;
  float s = sin(angle);
  float k = cos(angle);
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 chroma = c - luma;
  vec3 rot = chroma * k + cross(vec3(0.57735), chroma) * s
    + vec3(0.57735) * dot(vec3(0.57735), chroma) * (1.0 - k);
  return clamp(luma + rot, 0.0, 1.6);
}

/**
 * 光学的厚み tau -> 色。
 *
 * 参考動画 0.53.09 の複数フレーム（0.3 / 1.6 / 3.0 / 5.8 秒）を見比べて分かること:
 *
 * - **橙が支配色**で、青／ティールは常にあるわけではない。5.8 秒はほぼ全面が橙、
 *   3.0 秒は青が優勢。つまり寒暖は tau 上に直列に並んでいるのではなく、
 *   **中間帯の色相が場所と時間で橙⇔ティールに振れている**。
 *   これを tau の直列（青の次に橙）で作ると必ず等高線状のリングになって似ない。
 * - 全フレームで不変なのは明度の並びのほう:
 *     淡ミント → クリーム → 彩度の乗った中間帯 → 細い菫色の縁 → ほぼ黒のボイド
 * - ボイドのすぐ外に**紫〜藍のリング**が必ずある。橙から黒紺へ直接繋ぐと
 *   濁った茶色を通ってしまい、この特徴が出ない。明示的な停止点として置く。
 *
 * よって tau は明度側だけを担当し、色相は lateral が担当する。
 * lateral: 0=ティール 1=橙。大域の傾きと折りのうねり場から作る。
 */
vec3 densityRamp(float density, float lateral) {
  float t = density;

  // 背景（visual-style.ts AETHER env.background = 0xd4e8e1）と同一色にしておく。
  // 縁が背景へ溶けるのはこの一致によるもので、alpha を絞ることでは作らない
  vec3 pale   = vec3(0.831, 0.910, 0.882);
  // 参考の塊の外周は背景ミントそのものではなく、わずかに暖いクリームの暈。
  // pale から直接 mid へ繋ぐと淡い領域が「ただの背景」になって面積が稼げない
  vec3 haze   = vec3(0.905, 0.900, 0.835);
  // 中間帯。色相だけが空間で振れる。
  // ティールと橙はほぼ補色なので mix(uCool, uWarm, lateral) で RGB 直線補間すると
  // 中間が必ず濁った灰茶（黄土色）になる。淡色を経由させると今度は塊が乳白色に
  // 洗われて彩度が死ぬ。参考の青→橙の実測は #4f4689 → #994f82 → #fca46f で、
  // **洋紅を経由**している＝色相環を回っている。よって HSV で色相を回す。
  // lateral はレイに沿った平均なので本体全域に broad に散り、素のままだと
  // 大半が経路の中間＝洋紅に落ちて塊全体が紫になる（実測: 本体の m は 0.2〜1.0 に
  // ほぼ一様）。両端へ寄せて、洋紅は境目の細い帯だけに残す
  // 幅は 0.40〜0.56 だと狭すぎて洋紅が色収差のような硬い縁取り線になり、
  // 0.33〜0.67 だと広すぎてピンクの帯が主役になる。参考の境目は塊の1割前後。
  // 0.36〜0.62 のまま cross だけ広げると線は残る。わずかに幅を足して
  // 線を面に戻しつつ、ピンク帯が主役になる手前で止める
  float m = smoothstep(0.35, 0.65, lateral);
  vec3 hc = rgb2hsv(uCool);
  vec3 hw = rgb2hsv(uWarm);
  vec3 ha = rgb2hsv(uAccent);
  // 回す向きは増加側（青→菫→洋紅→橙）。減少側は緑・黄を通るのでまた濁る。
  // 寒暖はほぼ対蹠なので「近い側」を自動選択させると向きが不定になる。ここは固定する
  float hue = fract(hc.x + (hw.x + 1.0 - hc.x) * m);
  float sat = mix(hc.y, hw.y, m);
  float val = mix(hc.z, hw.z, m);
  // 交差点は参考でも中間より暗く沈む。実測 #994f82 は S=0.48 / V=0.60 で、
  // 素直に補間した S=0.70 / V=0.85 のままだと蛍光ピンクの帯として浮く。
  // 落とすのは彩度が主で、明度を落としすぎると今度は暗い縞として線に見える。
  // 幅も広めに取り、回転区間の全体をくすませる（狭いと純赤の帯が残る）。
  // sat を 0.68 まで落とすと area.js の「彩度のある中間帯」が淡部へ流れ、
  // 淡部が 13%→28% まで崩れた。0.58 に留めて線だけを沈める
  float cross = exp(-pow((m - 0.5) / 0.42, 2.0));
  sat *= (1.0 - cross * 0.58);
  val *= (1.0 - cross * 0.16);
  // 曲が進むと第3色素が中間帯へ混ざる。狭いガウシアンだと帯が線になるので面で入れる
  float accMask = clamp(uChroma * mix(0.28, 0.88, smoothstep(0.12, 0.72, lateral)), 0.0, 0.9);
  float dh = ha.x - hue;
  dh -= floor(dh + 0.5);
  hue = fract(hue + dh * accMask);
  sat = mix(sat, ha.y, accMask * 0.70);
  val = mix(val, ha.z, accMask * 0.40);
  vec3 mid = hsv2rgb(vec3(hue, sat, val));
  // 中間帯の中の陰。参考の橙も青も一様ではなく、ボイドへ近づくほど濃く沈む。
  // ここを平坦にするとベタ塗りのポスターになるが、下げすぎると参考の明るい
  // コーラルが黄土色に転ぶ（0.74 では暗すぎた）
  vec3 midDeep = mid * 0.88 + vec3(0.02, 0.01, 0.05);
  // ボイドを縁取る菫。全フレームに出る特徴で、これが無いと橙→黒紺が茶色く濁る
  vec3 rim    = vec3(0.34, 0.18, 0.46);
  vec3 deep   = vec3(0.035, 0.030, 0.115);
  vec3 abyss  = vec3(0.018, 0.016, 0.062);

  // 停止点は tau の実測 CDF から決めた（本体の面積比が
  // クリーム20 / 中間帯55 / 暗部25 になる位置。tau の実レンジは 0.065〜0.81）。
  if (t < 0.13) return mix(pale, haze, smoothstep(0.0, 0.13, t));
  if (t < 0.26) return mix(haze, mid, smoothstep(0.13, 0.26, t));
  if (t < 0.52) return mix(mid, midDeep, smoothstep(0.26, 0.52, t));

  // 菫はランプの停止点として置くと担当区間ぶんの面積を持ってしまい、
  // 参考の「細いリング」ではなく紫の広い領域になる。
  // 明度側の遷移とは独立に、狭いガウシアンで着色として乗せる。
  // 暗部の立ち上がりは CDF の 77 パーセンタイル（t=0.60）から。
  // 実測の面積比（暗部 / 中間帯 / 淡部）を参考3フレームの 21 / 62 / 17 に合わせてある。
  // 0.48 まで下げると本体の3割が半分沈み、参考が保っている
  // 「ボイドを囲む中間帯のリング」が消える
  vec3 base = mix(midDeep, deep, smoothstep(0.575, 0.685, t));
  base = mix(base, abyss, smoothstep(0.685, 0.79, t));
  float rimBand = exp(-pow((t - 0.605) / 0.026, 2.0));
  return mix(base, rim, rimBand * 0.38);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

/** 滑らかな和集合。副ローブを溶かし込んで一体の塊にする */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/**
 * 静止の swell warp（シード位相のみ）＋時間は curl 場。
 * 旧版の vec3(n,n2,n-n2) は発散がありゴムのように伸び縮みしていた。
 * curl は体積を保つので折りがボイドの周りを回る（Vortex Cathedral）。
 * flow は層ごとの反転回転と色リボンに再利用する。
 */
vec3 domainWarp(vec3 p, out vec3 flow) {
  vec3 q = p;
  q.x *= uStretchX;
  q.y *= uStretchY;

  float seedPh = uSeed * 6.2831853;
  float n = swell(q * 1.4, seedPh);
  float n2 = swell(q * 1.1 + vec3(1.3), -seedPh * 0.6);
  // 静止 warp を一段落とし、時間変化の主役を curl に渡す
  q += uWarp * 0.38 * vec3(n, n2, n - n2);

  // uTime は CPU 側で flowRate 積分済み。音が速いほど場が進む（半径パルスではない）
  float t = uTime;
  vec3 drift = q + vec3(t * 0.18, t * 0.05, -t * 0.12);
  vec3 cCoarse = curlSwell(drift * 1.15, t);
  vec3 cFine = curlSwell(drift * 2.40 + vec3(4.2), -t * 0.73);
  cCoarse *= inversesqrt(dot(cCoarse, cCoarse) + 0.22);
  cFine *= inversesqrt(dot(cFine, cFine) + 0.22);
  q += (uWarp * 0.45 + uFlowAmp) * cCoarse + uWarpFine * 0.20 * cFine;
  flow = cCoarse + cFine * 0.45;

  float a = uTwist * q.y;
  float ca = cos(a);
  float sa = sin(a);
  q.xz = mat2(ca, -sa, sa, ca) * q.xz;
  flow.xz = mat2(ca, -sa, sa, ca) * flow.xz;
  return q;
}

/**
 * 参考動画は「中身の詰まった塊」ではなく、自分自身へ折り重なった薄い膜。
 * 折りが重なった所だけレイが何層も貫いて厚みが積算され、輪郭のはっきりした
 * 暗いボイドとリボン状の色帯が生まれる。ソリッドな球では絶対に出ない構造なので、
 * abs() で殻化した SDF を大きな低周波変位で波打たせ、自己交差＝折りを作る。
 */
float map(vec3 p, out float ribbon) {
  vec3 flow;
  vec3 q = domainWarp(p, flow);

  // 折りの形はシードで固定。時間は curl の移流に任せる
  // （両方動かすと波と渦が喧嘩してチカチカする）
  float seedPh = uSeed * 6.2831853;
  float fold = swell(q * 2.4, seedPh * 0.37);
  float fold2 = swell(q * 4.6, -seedPh * 0.21);
  // 0.55 + uWarp*0.75 だと無音時で 0.87、変位が半径 0.52 の 6 割に達し、
  // 殻が破れて高 tau 領域が飛沫状の細い触手になる。参考のボイドは滑らかな腎臓形。
  // 0.40 + 0.50 / smin 0.07 まで落とすと折りが溶けて面積比が崩れた（暗部19→14、
  // 淡部13→28）。幾何はここに戻し、境目の柔らかさは色側だけで出す
  float amp = 0.45 + uWarp * 0.60;

  float len = length(q);

  // 参考動画は折りが 4〜5 層見える。膜1枚ではレイの貫通が最大2回で、
  // tau が 2 値にしかならず帯が積層しない。内側へ層を重ねて貫通回数を増やす。
  // ここで層ごとに swell の混ぜ方（符号と比率）を変えるのが要点で、
  // 同じ変位を使い回すと層が平行なまま＝ただの同心リングになり折りに見えない。
  // swell の再評価は sin 3本ぶん高くつくので、2つの場の線形結合で層を散らす。
  // 半径は等間隔ではなく比率で刻む。等間隔だと内側の層だけ半径に対して変位が
  // 過大になり、膜が破れて鋭い黒い触手になる（変位も半径比で縮めるのはそのため）。
  // 半径比を 1.0 / 0.82 / 0.63 と詰める。0.72 / 0.48 のように内側を小さく取ると、
  // 「6 枚とも貫くレイ」が半径 0.48 の投影内にしか無く、参考の大きな滑らかな
  // ボイドにならず小さな鉤爪状の高 tau 領域になる。詰めておくと
  // 6枚貫通=ボイド / 4枚=その外の帯 / 2枚=縁 と入れ子の帯が素直に出る
  float r2 = uMajor * 0.82;
  float r3 = uMajor * 0.63;
  // fold2 は fold の約2倍の周波数。変位に強く効かせると膜が細かく折れて
  // ボイドの縁がギザギザになるので、形は低周波の fold 主体にする。
  // spin: 接線方向の flow を半径変位へ。層で符号を反転すると入れ子が逆回転する
  float spin = dot(flow, vec3(q.z, 0.0, -q.x)) * mix(1.0, 1.65, uMelt) * (1.0 + uFlowAmp * 0.45);
  float d1 = abs(len - uMajor + (fold * 0.30 + fold2 * 0.05) * amp + spin * 0.085) - uShell;
  float d2 = abs(len - r2     + (fold * 0.12 - fold2 * 0.09) * amp * 0.82 - spin * 0.072) - uShell * 0.88;
  float d3 = abs(len - r3     + (fold * -0.18 + fold2 * 0.06) * amp * 0.63 + spin * 0.045) - uShell * 0.74;

  // uMelt で層が溶ける。0.10 超えると折り自体が消えるので上限は低く
  float k = mix(0.045, 0.078, uMelt);
  float shell = smin(smin(d1, d2, k), d3, k);

  vec3 off = vec3(uMinor * 1.2, -uMinor * 0.8, uMinor * 0.3);
  float subDisp = (fold * 0.22 + fold2 * 0.06) * amp;
  float sub = abs(sdSphere(q - off, uMajor * 0.72) + subDisp) - uShell * 0.85;

  // 色も同じ流れに乗せる。fold2 だけだと折りは止まって色だけ流れてちぐはぐになる
  ribbon = flow.x * 0.55 + flow.y * 0.40 + fold2 * 0.25;

  return smin(shell, sub, mix(0.12, 0.19, uMelt));
}

/**
 * 膜の内外を対称に減衰させる。以前の版は soft=0.30 で滲みすぎて
 * 折りが全部溶け合い、ただのぼやけた楕円になっていた。
 * 参考動画のリボン状の色境界を出すには縁を締める必要がある。
 */
float sdfDensity(float d) {
  float soft = max(0.015, uSoftness);
  return clamp(1.0 - smoothstep(-soft, soft, d), 0.0, 1.0);
}

bool intersectBox(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 invRd = 1.0 / rd;
  vec3 tmin = (-1.0 - ro) * invRd;
  vec3 tmax = (1.0 - ro) * invRd;
  vec3 t1v = min(tmin, tmax);
  vec3 t2v = max(tmin, tmax);
  t0 = max(max(t1v.x, t1v.y), t1v.z);
  t1 = min(min(t2v.x, t2v.y), t2v.z);
  return t1 > max(t0, 0.0);
}

void main() {
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocalPos - uCamLocal);

  float tEnter;
  float tExit;
  if (!intersectBox(ro, rd, tEnter, tExit)) discard;
  tEnter = max(tEnter, 0.0);

  const int STEPS = 112;

  // 参考動画は「発光する霧」ではなく「背景光を吸収して染める体積」。
  // 光学的厚み tau を積算し、最後に一度だけ色へ写す。
  // これにより厚い所ほど黒紺へ沈み、折りが重なった所に暗いボイドが生まれる
  // （発光モデルだと厚い所ほど明るくなり、参考動画と逆になる）。
  float soft = max(0.015, uSoftness);

  // 膜の中は「膜厚に対して」十分細かく刻む。span を STEPS で割る等間隔だと
  // 1回の貫通で2サンプルしか取れず、jitter の分散がそのまま斑点ノイズになる
  float fine = max(0.010, uShell * 0.42);
  float band = soft + uShell * 0.25;

  // 等間隔サンプリングは縞として見えるので開始位置を 1step 未満だけずらす
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  tEnter += fine * jitter;

  float tau = 0.0;
  float lateralAccum = 0.0;
  float breath = 0.94 + uBreath * 0.08;
  float t = tEnter;

  for (int i = 0; i < STEPS; i++) {
    if (t >= tExit || tau > 3.0) break;
    vec3 p = ro + rd * t;

    float ribbon;
    float d = map(p, ribbon);

    // 膜から離れている間は SDF 距離ぶん飛ばす（体積レイの最大の節約）。
    // 変位で Lipschitz 条件が崩れているので 0.85 だと薄膜を飛び越して穴が開く
    if (d > band) {
      t += max(fine, (d - band) * 0.6);
      continue;
    }

    float dens = sdfDensity(d) * breath;
    // 外周の折りほど薄くして輪郭を背景へ溶かす。
    // これが無いと膜が途切れる所がそのまま硬いシルエットの縁になる
    dens *= 1.0 - smoothstep(0.45, 0.95, length(p));
    float contrib = dens * fine;
    tau += contrib;
    // 中間帯の色相（0=ティール 1=橙）。
    // 大スケールの傾き: 参考は片側だけが寒色へ回る。clamp だと塊のほぼ全域で
    // 0/1 に振り切れて硬い二分割になるので、塊の幅いっぱいを使ってなだらかに回す
    float globalHue = smoothstep(-0.85, 0.85, p.x + p.y * 0.45);
    // それに折りのうねり場を重ねる。これが折りに沿って巻く色の帯を作る本体で、
    // 大域側だけだと何層貫いても左右グラデーション1枚にしかならない。
    // ribbon の smoothstep が狭いと折りのゼロ交差が色の等高線になる。
    // 参考の帯はもっと幅があるので、ここで少し広げて線を面に戻す
    float ribbonHue = smoothstep(-0.62, 0.62, ribbon);
    lateralAccum += contrib * mix(globalHue, ribbonHue, 0.52);
    t += fine;
  }

  // 色相は膜が運ぶ情報なので、オーラを足す前の tau で正規化する。
  // +0.18 は暖色寄りのバイアス。参考は 4 フレーム中 3 枚が橙優勢で、
  // ティールは片側にだけ回るので、素の 0..1 のままだと寒色が出すぎる
  float lateral = clamp(lateralAccum / max(tau, 1e-4) * 0.90 + 0.18, 0.0, 1.0);

  // 塊を包む淡いオーラ。参考動画は本体の外側にクリーム色の暈があり、
  // これが無いと色から背景へ直接切り替わって切り絵のように見える。
  // ループ内は空間をスキップするので拾えない。レイと原点の最近接距離から解析的に足す
  float tClosest = clamp(dot(-ro, rd), tEnter, tExit);
  float dMin = length(ro + rd * tClosest);
  // 減衰 4.5 だと e 折り 0.22 で、参考の「半径の2割ほど広がるクリームの暈」に足りない
  tau += exp(-max(dMin - 0.5, 0.0) * 3.2) * 0.085;

  if (tau < 0.0025) discard;

  // ランプの座標。Beer-Lambert の 1-exp(-tau*k) を通すと上位3割の tau が
  // depth 0.60〜0.77 に圧縮され、ボイドの縁と内部の階調を作る余地が無くなる。
  // tau 自体が光学的厚みなので、そのまま倍率だけ掛けてランプへ渡す。
  // uAbsorption は「同じ厚みをどれだけ濃く見るか」の意味のまま音の変調に残る。
  float density = clamp(tau * uAbsorption, 0.0, 1.3);
  vec3 col = hueShiftRgb(densityRamp(density, lateral), uHueShift);
  col *= uEmission;

  // 縁は背景へ完全に溶かす（参考動画にはシルエットの硬い境界が一切ない）。
  // ただし溶かすのは alpha ではなく色のほう。ランプの pale を背景色そのものに
  // しておけば、不透明のまま縁が消える。
  // 0.20 で立ち上げていた頃はランプのクリーム区間が常に alpha 0.3 前後にあり、
  // 「淡い領域」が薄い背景としてしか出ず、色が見え始める時には既に中間帯だった。
  // 参考の広いクリームの暈を出すには、色より先に alpha を立て切る必要がある
  float alpha = clamp(smoothstep(0.0, 0.07, tau) * uOpacity, 0.0, 1.0);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export class AetherSculpture implements SculptureExperience {
  readonly group = new THREE.Group();

  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly camLocal = new THREE.Vector3(0, 0.15, 4.2);
  private readonly invMatrix = new THREE.Matrix4();
  private readonly warmColor = new THREE.Color(1.0, 0.5, 0.3);
  private readonly coolColor = new THREE.Color(0.2, 0.45, 0.85);
  private readonly accentColor = new THREE.Color(0.85, 0.55, 0.42);
  private readonly targetWarm = new THREE.Color();
  private readonly targetCool = new THREE.Color();
  private readonly targetAccent = new THREE.Color();
  /** 曲が進むほど混ざる色素（金 / 薔薇 / 菫 / ミント） */
  private mixGold = 0;
  private mixRose = 0;
  private mixViolet = 0;
  private mixMint = 0;

  private time = 0;
  private seed = 1;
  private energy = 0;
  private calm = 1;
  private completed = false;
  private shapeHold = false;
  private completionProgress = 0;
  private breathTime = 0;
  private breathBpm = 62;
  private idleTime = 0;

  /** 蓄積（不可逆）— 曲が進むほど場が育つ */
  private accumMass = 0;
  private accumWarp = 0;
  private accumAsym = 0;
  private accumFine = 0;

  /** LIVE エンベロープ（減衰） */
  private kickPulse = 0;
  private snarePulse = 0;
  private hatPulse = 0;
  private melodyPulse = 0;
  private lastKickIndex = -1;
  private lastSnareIndex = -1;
  private lastHatIndex = -1;
  private lastChopIndex = -1;
  private lastTransientIndex = -1;
  private lastSalienceIndex = -1;
  private melodyOnsetHeld = false;
  private kickRing = 0;
  private snareRing = 0;
  private hatRing = 0;

  private pokePulse = 0;
  /** curl 場の積分時刻。rate を変えても位相が飛ばないように CPU で積む */
  private flowTime = 0;
  /** 帯域の滑らかなドライブ（オンセットパルスより「混ざる」側） */
  private flowDrive = 0;
  private meltDrive = 0;
  private fineDrive = 0;
  /** `?aetherAccum=` で固定しているとき true。音でこれ以上育てない */
  private accumPinned = false;
  /** `?aetherMelt=` / `?aetherFlow=` で LIVE ドライブを固定（計測用） */
  private meltPinned = false;
  private flowPinned = false;
  private completionPalette: SculpturePalette | null = null;
  private weatherShift: ClayColorShift = createClayColorShift();
  private hueShift = 0;

  /** ベース形状（無音でも参考動画に近い） */
  private baseMajor = 0.52;
  private baseMinor = 0.26;
  private baseWarp = 0.42;
  // 膜の縁の締まり。大きいと折りが溶け合ってただの楕円になる
  private baseSoft = 0.05;
  // 膜の半厚
  private baseShell = 0.055;

  constructor() {
    this.group.name = "AetherSculpture";

    this.material = new THREE.ShaderMaterial({
      vertexShader: volumeVertexShader,
      fragmentShader: volumeFragmentShader,
      uniforms: {
        uCamLocal: { value: this.camLocal },
        uWarm: { value: this.warmColor.clone() },
        uCool: { value: this.coolColor.clone() },
        uTime: { value: 0 },
        uMajor: { value: this.baseMajor },
        uMinor: { value: this.baseMinor },
        uWarp: { value: this.baseWarp },
        uWarpFine: { value: 0.15 },
        uStretchY: { value: 1 },
        uStretchX: { value: 1 },
        uTwist: { value: 0.15 },
        uAbsorption: { value: 1.0 },
        uEmission: { value: 1.0 },
        uSoftness: { value: this.baseSoft },
        uShell: { value: this.baseShell },
        uBreath: { value: 0 },
        uHueShift: { value: 0 },
        uOpacity: { value: 1 },
        uSeed: { value: 0.17 },
        uMelt: { value: 0 },
        uFlowAmp: { value: 0 },
        uAccent: { value: this.accentColor.clone() },
        uChroma: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.NormalBlending,
    });

    const geo = new THREE.BoxGeometry(2, 2, 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(MESH_SCALE);
    this.mesh.name = "AetherVolume";
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.mesh.updateWorldMatrix(true, false);
      this.invMatrix.copy(this.mesh.matrixWorld).invert();
      this.camLocal.copy(camera.position).applyMatrix4(this.invMatrix);
    };
    this.group.add(this.mesh);
    this.group.position.y = -0.06;

    this.reset(readAetherUrlNumber("aetherSeed") ?? Math.floor(Math.random() * 1e9));
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    _userViewInteracting?: boolean,
    rhythm?: RhythmEvents,
    structure?: StructureSnapshot,
    _species?: SpeciesProfile,
  ) {
    const r = rhythm ?? defaultRhythm();
    const dt = Math.min(0.05, Math.max(0, deltaTime));
    this.time += dt;
    this.idleTime += dt;

    if (this.completed) {
      this.updateAfterlife(dt);
      this.flowTime += dt * 0.28;
      this.syncUniforms();
      return;
    }

    const loud = bands.overall > SILENCE_THRESHOLD;
    const target = loud ? clamp01(bands.overall * 1.2 + bands.bassFocus * 0.25) : 0;
    this.energy += (target - this.energy) * Math.min(1, dt * 3.2);
    this.calm += ((loud ? 0 : 1) - this.calm) * Math.min(1, dt * 0.55);

    if (!this.shapeHold) {
      this.modulateFromAudio(bands, r, structure, dt, loud);
    }

    this.decayPulses(dt);
    this.updateColors(bands, dt);
    this.flowTime += dt * this.currentFlowRate();
    this.syncUniforms();
  }

  private kickLive(): number {
    return Math.max(this.kickPulse, this.kickRing);
  }

  private snareLive(): number {
    return Math.max(this.snarePulse, this.snareRing);
  }

  private hatLive(): number {
    return Math.max(this.hatPulse, this.hatRing);
  }

  private currentFlowRate(): number {
    // 床は曲の密度。打点は読むが暴れない振幅
    return (
      0.22 +
      this.flowDrive * 0.28 +
      this.kickLive() * 0.72 +
      this.snareLive() * 0.55 +
      this.melodyPulse * 0.28 +
      this.hatLive() * 0.14
    );
  }

  /**
   * 音 → 場パラメータ。ボクセルへスタンプしない。
   * LIVE は半径パルス（弾み）ではなく、渦の速さ・層の溶け・細渦。
   * 滑らかな帯域追従は床だけ。聴感イベントを打点として立てる。
   */
  private modulateFromAudio(
    bands: AudioBands,
    r: RhythmEvents,
    structure: StructureSnapshot | undefined,
    dt: number,
    loud: boolean,
  ) {
    const bass = bands.sub * 0.55 + bands.low * 0.45;
    const mid = bands.mid * 0.5 + bands.melody * 0.5;
    const high = bands.high;

    this.kickRing = r.kickRing;
    this.snareRing = r.snareRing;
    this.hatRing = r.hatRing;

    const follow = Math.min(1, dt * 1.1);
    const flowTarget = loud ? clamp01(bands.overall * 0.4 + mid * 0.25) : 0;
    const meltTarget = loud ? clamp01(mid * 0.35) : 0;
    const fineTarget = loud ? clamp01(high * 0.4) : 0;
    if (!this.flowPinned) {
      this.flowDrive += (flowTarget - this.flowDrive) * follow;
    }
    if (!this.meltPinned) {
      this.meltDrive += (meltTarget - this.meltDrive) * Math.min(1, dt * 0.9);
    }
    this.fineDrive += (fineTarget - this.fineDrive) * Math.min(1, dt * 1.4);

    if (loud && !this.accumPinned) {
      // 蓄積: ゆっくり育つ（長い曲でも飽和しすぎない）
      this.accumMass = clamp01(this.accumMass + bass * dt * 0.028 * (1 - this.accumMass * 0.7));
      this.accumWarp = clamp01(this.accumWarp + mid * dt * 0.022 * (1 - this.accumWarp * 0.65));
      this.accumAsym = clamp01(
        this.accumAsym + (bands.melodyFocus + r.salienceMid) * dt * 0.018 * (1 - this.accumAsym * 0.7),
      );
      this.accumFine = clamp01(this.accumFine + high * dt * 0.02 * (1 - this.accumFine * 0.75));
    }

    if (loud && readAetherUrlNumber("aetherHueLock") !== 0) {
      this.mixGold = clamp01(this.mixGold + high * bands.brightness * dt * 0.022 * (1 - this.mixGold * 0.65));
      this.mixRose = clamp01(this.mixRose + bands.melodyFocus * dt * 0.02 * (1 - this.mixRose * 0.65));
      this.mixViolet = clamp01(this.mixViolet + bass * dt * 0.018 * (1 - this.mixViolet * 0.65));
      this.mixMint = clamp01(
        this.mixMint + (1 - bands.bassFocus) * mid * dt * 0.016 * (1 - this.mixMint * 0.65),
      );
    }

    let swirled = false;
    if (r.kickIndex !== this.lastKickIndex && r.kick > 0.22) {
      this.lastKickIndex = r.kickIndex;
      this.kickPulse = Math.max(this.kickPulse, 0.5 + r.kick * 0.55);
      this.flowTime += 0.03 + r.kick * 0.04;
      swirled = true;
    }

    if (r.snareIndex !== this.lastSnareIndex && r.snare > 0.28) {
      this.lastSnareIndex = r.snareIndex;
      this.snarePulse = Math.max(this.snarePulse, 0.48 + r.snare * 0.5);
      this.flowTime += 0.02 + r.snare * 0.03;
      swirled = true;
    }

    if (r.chopIndex !== this.lastChopIndex && r.chop > 0.28) {
      this.lastChopIndex = r.chopIndex;
      this.snarePulse = Math.max(this.snarePulse, 0.38 + r.chop * 0.42);
      this.flowTime += 0.015 + r.chop * 0.02;
      swirled = true;
    }

    if (r.melodyOnset > 0.45) {
      if (!this.melodyOnsetHeld) {
        this.melodyPulse = Math.max(this.melodyPulse, 0.38 + r.melodyOnset * 0.4);
      }
      this.melodyOnsetHeld = true;
    } else {
      this.melodyOnsetHeld = false;
    }

    if (r.hatIndex !== this.lastHatIndex && r.hat > 0.3) {
      this.lastHatIndex = r.hatIndex;
      this.hatPulse = Math.max(this.hatPulse, 0.38 + r.hat * 0.45);
    }

    if (r.transientIndex !== this.lastTransientIndex && r.transient > 0.35) {
      this.lastTransientIndex = r.transientIndex;
      this.melodyPulse = Math.max(this.melodyPulse, 0.32 + r.transient * 0.35);
      if (!swirled) this.flowTime += 0.018 + r.transient * 0.02;
    }

    if (r.salienceIndex !== this.lastSalienceIndex && r.salience > 0.42) {
      this.lastSalienceIndex = r.salienceIndex;
      if (r.salienceLow >= r.salienceMid && r.salienceLow >= r.salienceHigh) {
        this.kickPulse = Math.max(this.kickPulse, 0.32 + r.salienceLow * 0.35);
        if (!swirled) this.flowTime += 0.02;
      } else if (r.salienceHigh > r.salienceMid) {
        this.hatPulse = Math.max(this.hatPulse, 0.28 + r.salienceHigh * 0.32);
      } else {
        this.snarePulse = Math.max(this.snarePulse, 0.3 + r.salienceMid * 0.32);
      }
    }

    if (structure?.events.energySurge) {
      this.accumWarp = clamp01(this.accumWarp + 0.04);
      this.melodyPulse = Math.max(this.melodyPulse, 0.7);
    }
    if (structure?.events.energyDrop) {
      this.accumMass = clamp01(this.accumMass + 0.015);
    }
  }

  private decayPulses(dt: number) {
    // アタックは打点として読める速さ。余韻は kickRing 等が持つ
    this.kickPulse = Math.max(0, this.kickPulse - dt * 2.55);
    this.snarePulse = Math.max(0, this.snarePulse - dt * 2.85);
    this.hatPulse = Math.max(0, this.hatPulse - dt * 4.2);
    this.melodyPulse = Math.max(0, this.melodyPulse - dt * 2.4);
    this.pokePulse = Math.max(0, this.pokePulse - dt * 2.0);
  }

  private syncUniforms() {
    const u = this.material.uniforms;

    const kick = this.kickLive();
    const snare = this.snareLive();
    const hat = this.hatLive();

    const major = this.baseMajor + this.accumMass * 0.10 + this.pokePulse * 0.02;
    const minor = this.baseMinor + this.accumMass * 0.1;
    const warp = this.baseWarp + this.accumWarp * 0.35 + this.melodyPulse * 0.03;
    const warpFine = 0.12 + this.accumFine * 0.35 + this.fineDrive * 0.06 + hat * 0.14;
    const stretchY = 1 + this.accumAsym * 0.22;
    const stretchX = 1 + this.accumAsym * 0.12;
    const twist = 0.12 + this.accumWarp * 0.25 + snare * 0.025 + this.melodyPulse * 0.02;
    const melt = clamp01(this.meltDrive * 0.18 + snare * 0.26 + this.melodyPulse * 0.14);
    const flowAmp = this.flowDrive * 0.04 + kick * 0.10 + snare * 0.05;
    const chroma = clamp01(
      Math.max(this.mixGold, this.mixRose, this.mixViolet, this.mixMint) * 0.55 +
        (this.mixGold + this.mixRose + this.mixViolet + this.mixMint) * 0.28,
    );

    u.uTime.value = this.flowTime;
    u.uMajor.value = major;
    u.uMinor.value = Math.max(0.08, minor);
    u.uWarp.value = warp;
    u.uWarpFine.value = warpFine;
    u.uStretchY.value = stretchY;
    u.uStretchX.value = stretchX;
    u.uTwist.value = twist;
    u.uMelt.value = melt;
    u.uFlowAmp.value = flowAmp;
    u.uChroma.value = chroma;
    (u.uAccent.value as THREE.Color).copy(this.accentColor);
    u.uSoftness.value = this.baseSoft + this.calm * 0.012;
    // 膜が厚くなるとレイの貫通ぶんが増えて tau もそのまま増える。uAbsorption と
    // 二重に効くので控えめに（0.02 だと蓄積飽和時に tau が 3 割増しになる）
    u.uShell.value = this.baseShell + this.accumMass * 0.010;
    // 薄膜モデルでの tau は「膜を何層貫いたか」。多層化後の実測レンジは 0.065〜0.99 で、
    // densityRamp の停止点はこの CDF に合わせてある。よって無音時の倍率は 1.0 が基準で、
    // 音の変調ぶんだけランプ上を押し上げる（＝曲が進むほど濃く沈む）。
    // ここは初期値ではなく毎フレーム上書きされる側なので、調整は必ずこの行で行う。
    //
    // tau は「膜を何層貫いたか × 1層あたりの厚み」なので、膜厚（uShell）と縁の
    // 甘さ（uSoftness）にほぼ比例する。densityRamp の停止点は絶対値なので、
    // 正規化しないとこの2つが動くだけで露出が狂う。実際シードは baseShell を
    // 0.048〜0.066 に振るだけだが、それで暗部面積が 15%〜42% まで暴れていた
    // （＝曲ごとに真っ黒な塊になることがある）。膜厚ぶんは打ち消し、
    // 意図した変調（蓄積・キック）だけをランプ上の移動として残す。
    // 係数 0.35 は蓄積が飽和した曲の終盤で本体の 46% が黒に潰れたので 0.12 に下げた
    const thickness = (u.uShell.value as number) + (u.uSoftness.value as number);
    // 色境目を柔らけて紫の等高線が消えたぶん、area.js の暗部が 19%→10% まで落ちた。
    // 線を戻さずボイド自体を参考の ~21% へ戻すため、露出だけ一段濃くする
    const exposure = 0.122 / Math.max(0.04, thickness);
    u.uAbsorption.value = exposure * (1.0 + this.accumMass * 0.12 + kick * 0.05);
    u.uEmission.value = 1.0 + this.energy * 0.06 + snare * 0.045 + this.melodyPulse * 0.03;
    u.uHueShift.value = this.hueShift * 0.35;
    u.uSeed.value = (this.seed % 1000) * 0.0017;

    const breath =
      this.completed
        ? Math.sin(this.breathTime * ((this.breathBpm / 60) * Math.PI * 0.2)) * 0.5 + 0.5
        : this.calm > 0.25
          ? Math.sin(this.idleTime * 0.65) * 0.5 + 0.5
          : this.flowDrive * 0.08 + kick * 0.08;
    u.uBreath.value = breath;

    if (this.completed) {
      const ease = this.completionProgress * this.completionProgress * (3 - 2 * this.completionProgress);
      u.uOpacity.value = 0.94 + ease * 0.06;
      u.uAbsorption.value = 1.08 + ease * 0.10;
    } else {
      u.uOpacity.value = 1;
    }
  }

  private updateColors(bands: AudioBands, dt: number) {
    // 基準値は参考動画からの実測。橙 #fd8652 -> HSL(0.051, 0.98, 0.657)、
    // 寒色 #62b3c1 -> HSL(0.524, 0.43, 0.571)。
    // 天気 hueShift は消さない。曲の色素蓄積で暖寒が少し開き、第3色が混ざる
    const warmHue =
      ((0.051 + this.mixRose * 0.10 + this.mixGold * 0.06 + bands.bassFocus * 0.025 + this.hueShift) % 1 + 1) % 1;
    const coolHue =
      ((0.54 + this.mixMint * 0.14 - this.mixViolet * 0.12 - bands.brightness * 0.04 + this.hueShift * 0.4) % 1 +
        1) %
      1;
    this.targetWarm.setHSL(warmHue, 0.90 - this.mixGold * 0.10, 0.65 + bands.contrast * 0.05);
    this.targetCool.setHSL(coolHue, 0.46 + this.mixMint * 0.12 + this.mixViolet * 0.06, 0.56 + bands.brightness * 0.06);

    const accHue = accentHueFromMix(this.mixGold, this.mixRose, this.mixViolet, this.mixMint);
    this.targetAccent.setHSL(
      accHue,
      0.56 + this.mixRose * 0.12 + this.mixGold * 0.08,
      0.55 + this.mixMint * 0.06,
    );

    const follow = Math.min(1, dt * 1.1);
    this.warmColor.lerp(this.targetWarm, follow);
    this.coolColor.lerp(this.targetCool, follow);
    this.accentColor.lerp(this.targetAccent, Math.min(1, dt * 0.55));
    (this.material.uniforms.uWarm.value as THREE.Color).copy(this.warmColor);
    (this.material.uniforms.uCool.value as THREE.Color).copy(this.coolColor);
    (this.material.uniforms.uAccent.value as THREE.Color).copy(this.accentColor);
  }

  private updateAfterlife(dt: number) {
    this.breathTime += dt;
    this.completionProgress = Math.min(1, this.completionProgress + dt / 6);
    const swell = 1 + Math.sin(this.breathTime * ((this.breathBpm / 60) * Math.PI * 0.2)) * 0.012;
    this.group.scale.set(swell, 2 - swell, swell);

    const palette = this.completionPalette;
    if (palette) {
      this.targetWarm.copy(palette.accentColor);
      this.targetCool.copy(palette.baseColor);
      this.warmColor.lerp(this.targetWarm, Math.min(1, dt * 0.75));
      this.coolColor.lerp(this.targetCool, Math.min(1, dt * 0.75));
      (this.material.uniforms.uWarm.value as THREE.Color).copy(this.warmColor);
      (this.material.uniforms.uCool.value as THREE.Color).copy(this.coolColor);
    }
  }

  applyLiveTuningNow() {}

  applyAlgoMorphBias() {}

  nudgeClayColorOnClick() {
    this.hueShift = (this.hueShift + 0.03) % 1;
  }

  applyWeatherClayTint(
    snapshot: {
      condition: string;
      cloudCover: number;
      rainIntensity: number;
      lightningIntensity: number;
    } | null,
    hour?: number,
  ) {
    if (readAetherUrlNumber("aetherHueLock") === 0) {
      this.weatherShift = createClayColorShift();
      this.hueShift = 0;
      return;
    }
    const weather = weatherClayShiftFromSnapshot(
      snapshot as import("./live-weather").LiveWeatherSnapshot | null,
      0.055,
    );
    const hourShift = hourClayShiftFromHour(hour ?? 15);
    this.weatherShift = combineClayShifts(weather, hourShift);
    this.hueShift = this.weatherShift.hue;
  }

  evolveSongColors(profile: AudioProfileSummary | null, deltaTime: number) {
    if (readAetherUrlNumber("aetherHueLock") === 0) return;
    if (!profile) return;
    const dt = Math.min(0.05, Math.max(0, deltaTime));
    const target =
      0.02 +
      profile.bassDominance * 0.04 -
      profile.brightness * 0.03 +
      profile.melodyFocus * 0.02;
    this.hueShift += (target - this.hueShift) * Math.min(1, dt * 0.12);
    this.mixGold = clamp01(this.mixGold + profile.brightness * dt * 0.01 * (1 - this.mixGold * 0.7));
    this.mixRose = clamp01(this.mixRose + profile.melodyFocus * dt * 0.01 * (1 - this.mixRose * 0.7));
    this.mixViolet = clamp01(
      this.mixViolet + profile.bassDominance * dt * 0.009 * (1 - this.mixViolet * 0.7),
    );
    this.mixMint = clamp01(this.mixMint + (1 - profile.bassDominance) * dt * 0.008 * (1 - this.mixMint * 0.7));
  }

  pokeIdle() {
    this.pokePulse = Math.max(this.pokePulse, 0.85);
  }

  getPointerTargets() {
    return [this.mesh];
  }

  pokeSurface(_localPoint: THREE.Vector3) {
    this.pokePulse = Math.max(this.pokePulse, 0.7);
    this.flowDrive = Math.max(this.flowDrive, 0.28);
    this.meltDrive = Math.max(this.meltDrive, 0.18);
  }

  holdShapeForCompletion() {
    if (this.completed) return;
    this.shapeHold = true;
  }

  prepareCompletion(palette: SculpturePalette, _species?: SpeciesProfile) {
    this.completionPalette = palette;
  }

  complete() {
    if (this.completed) return;
    this.completed = true;
    this.shapeHold = false;
    this.completionProgress = 0;
    this.breathTime = 0;
    this.kickPulse = 0;
    this.snarePulse = 0;
    this.hatPulse = 0;
    this.melodyPulse = 0;
    this.pokePulse = 0;
    // 完成時に蓄積を少し強調して「焼き込み」感を出す
    this.accumMass = clamp01(this.accumMass + 0.08);
    this.accumWarp = clamp01(this.accumWarp + 0.06);
    this.group.scale.set(1, 1, 1);
    this.syncUniforms();
  }

  reset(seed = 1) {
    const pinnedSeed = readAetherUrlNumber("aetherSeed");
    if (pinnedSeed != null) seed = pinnedSeed;
    this.seed = seed;
    this.time = 0;
    this.energy = 0;
    this.calm = 1;
    this.completed = false;
    this.shapeHold = false;
    this.completionProgress = 0;
    this.breathTime = 0;
    this.idleTime = 0;
    this.flowTime = 0;
    this.flowDrive = 0;
    this.meltDrive = 0;
    this.fineDrive = 0;
    this.mixGold = 0;
    this.mixRose = 0;
    this.mixViolet = 0;
    this.mixMint = 0;
    this.accentColor.setRGB(0.85, 0.55, 0.42);
    const chromaPin = readAetherUrlNumber("aetherChroma");
    if (chromaPin != null) {
      const a = clamp01(chromaPin);
      this.mixGold = a * 0.3;
      this.mixRose = a * 0.45;
      this.mixViolet = a * 0.8;
      this.mixMint = a * 0.55;
    }
    this.meltPinned = false;
    this.flowPinned = false;
    const meltPin = readAetherUrlNumber("aetherMelt");
    if (meltPin != null) {
      this.meltPinned = true;
      this.meltDrive = clamp01(meltPin);
    }
    const flowPin = readAetherUrlNumber("aetherFlow");
    if (flowPin != null) {
      this.flowPinned = true;
      this.flowDrive = clamp01(flowPin);
    }
    this.accumMass = 0;
    this.accumWarp = 0;
    this.accumAsym = 0;
    this.accumFine = 0;
    this.accumPinned = false;
    const accumPin = readAetherUrlNumber("aetherAccum");
    if (accumPin != null) {
      this.accumPinned = true;
      const a = clamp01(accumPin);
      this.accumMass = a;
      this.accumWarp = a;
      this.accumAsym = a;
      this.accumFine = a;
    }
    this.kickPulse = 0;
    this.snarePulse = 0;
    this.hatPulse = 0;
    this.melodyPulse = 0;
    this.pokePulse = 0;
    this.lastKickIndex = -1;
    this.lastSnareIndex = -1;
    this.lastHatIndex = -1;
    this.lastChopIndex = -1;
    this.lastTransientIndex = -1;
    this.lastSalienceIndex = -1;
    this.melodyOnsetHeld = false;
    this.kickRing = 0;
    this.snareRing = 0;
    this.hatRing = 0;
    this.completionPalette = null;
    this.hueShift = 0;
    this.weatherShift = createClayColorShift();

    // シードでベース形をわずかに振る（曲ごとに唯一の出発点）
    const s = (seed % 10000) / 10000;
    // 注: uMajor/uMinor はトーラス時代の意味（大半径/小半径）ではなく、
    // 主ローブ半径 / 副ローブのオフセット量になっている
    this.baseMajor = 0.50 + s * 0.06;
    this.baseMinor = 0.24 + (1 - s) * 0.06;
    this.baseWarp = 0.38 + s * 0.12;
    this.baseSoft = 0.042 + (1 - s) * 0.016;
    this.baseShell = 0.048 + s * 0.018;

    this.warmColor.setRGB(1.0, 0.5, 0.3);
    this.coolColor.setRGB(0.2, 0.45, 0.85);
    (this.material.uniforms.uWarm.value as THREE.Color).copy(this.warmColor);
    (this.material.uniforms.uCool.value as THREE.Color).copy(this.coolColor);
    this.group.scale.set(1, 1, 1);
    this.syncUniforms();
  }

  createExportGroup() {
    const g = new THREE.Group();
    g.name = "Aether Sculpture";
    g.rotation.copy(this.group.rotation);
    const mat = this.material.clone();
    mat.uniforms.uCamLocal = { value: this.camLocal.clone() };
    mat.uniforms.uWarm = { value: this.warmColor.clone() };
    mat.uniforms.uCool = { value: this.coolColor.clone() };
    const mesh = new THREE.Mesh(this.mesh.geometry.clone(), mat);
    mesh.name = "Aether volume";
    mesh.scale.copy(this.mesh.scale);
    g.add(mesh);
    return g;
  }
}
