import * as THREE from "three";
import type { ClayColorShift } from "./clay-color";
import { clamp01, smoothstep } from "./sculpture-types";

/**
 * 音のプロファイル要約 — main.ts の AudioProfile が構造的に満たすサブセット。
 * 完成時の色・質感の導出に使う。
 */
export type AudioProfileSummary = {
  activeDuration: number;
  overallAverage: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  bassDominance: number;
  melodyFocus: number;
  brightness: number;
  contrast: number;
  centroid: number;
  sectionContrast: number;
  variation: number;
  attackRate: number;
  quietRatio: number;
  loudRatio: number;
};

/** 録音した音から導出される、完成形の色・質感パラメータ */
export type SculpturePalette = {
  hue: number;
  saturation: number;
  lightness: number;
  baseColor: THREE.Color;
  accentColor: THREE.Color;
  emissiveColor: THREE.Color;
  roughness: number;
  metalness: number;
  emissiveStrength: number;
  energy: number;
};

/**
 * スペクトル／性格軸を色相の旅程に写像する。
 * 琥珀 → 金 → 苔 → 翡翠 → 青 → 菫（曲差が出るようストップ幅を広げる）
 */
const HUE_STOPS = [0.03, 0.09, 0.2, 0.42, 0.58, 0.78];

/**
 * 曲による色の振れ幅（2026-08-10 追加）。
 *
 * 経緯: 実曲4曲の完成形を並べたところ、**一番目立つ差が色になっていた**
 * （緑 / 淡青 / 淡青 / 橙。実測の色相の広がりは 0.436 で、0.5 = 補色）。
 * ユーザーはこれを明確に非とした:
 * 「色が前に出過ぎている。色は脇役です。色の目的は気候や時間、作った環境で変化を出すこと。」
 *
 * ただし**曲による色差を消すのは誤り**（「曲ごとに色の違いが出るのは面白い」とも言っている。
 * 天気 / 時間 / 音楽性による色変化を殺すのは過去に却下されている禁止事項）。
 * そこで HUE_STOPS のマッピング自体は触らず、**アンカーへ向けて畳む**。
 * 曲どうしの前後関係（どの曲がどちら寄りか）は保たれ、振れ幅だけが縮む。
 *
 * SPAN = 1 で従来どおり、0 で曲による差が消える。
 * dev パネル（`?surface=dev` の「曲の色の幅」）で実機調整できる。
 */
export const DEFAULT_SONG_HUE_SPAN = 0.4;
/** 彩度の振れ幅。色相だけ縮めてもビビッドさの差が残ると色が前に出る */
export const DEFAULT_SONG_SAT_SPAN = 0.55;

/**
 * 畳む中心。**無音時のフォールバック（`deriveSculpturePalette(null)`）の値と一致させてある**
 * ので、SPAN を 0 にすると「音が無いときの色」にちょうど落ちる。
 * 値は null 時の既定入力から計算して求めた（hue 0.1263 / saturation 0.6468）。
 * `HUE_STOPS` や null 時の既定入力を変えたらここも計算し直すこと。
 */
const SONG_HUE_ANCHOR = 0.1263;
const SONG_SAT_ANCHOR = 0.6468;

/** dev パネルと共有する現在値（実機で決めた値は DEFAULT_* へ焼き込む） */
export const songColorSpan = {
  hue: DEFAULT_SONG_HUE_SPAN,
  sat: DEFAULT_SONG_SAT_SPAN,
};
const SONG_HUE_SPAN_REF = () => songColorSpan.hue;
const SONG_SAT_SPAN_REF = () => songColorSpan.sat;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampRange = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const wrapHue = (hue: number) => ((hue % 1) + 1) % 1;

/** 0〜1 を両端へ押し広げ、中間帯の潰れを防ぐ */
const contrastStretch = (v: number, amount: number) =>
  clamp01(0.5 + (clamp01(v) - 0.5) * (1 + amount));

export const deriveSculpturePalette = (
  profile: AudioProfileSummary | null,
): SculpturePalette => {
  const hasSignal = profile !== null && profile.activeDuration > 0.5;
  const centroid = hasSignal ? profile.centroid : 0.3;
  const brightness = hasSignal ? profile.brightness : 0.12;
  const contrast = hasSignal ? profile.contrast : 0.2;
  const bassDominance = hasSignal ? profile.bassDominance : 0.4;
  const melodyFocus = hasSignal ? profile.melodyFocus : 0.18;
  const sectionContrast = hasSignal ? profile.sectionContrast : 0.08;
  const midRatio = hasSignal ? profile.midRatio : 0.34;
  const highRatio = hasSignal ? profile.highRatio : 0.22;
  const lowRatio = hasSignal ? profile.lowRatio : 0.34;
  const variation = hasSignal ? profile.variation : 0.1;
  const attackRate = hasSignal ? profile.attackRate : 0.5;
  const loudRatio = hasSignal ? profile.loudRatio : 0.05;
  const overallAverage = hasSignal ? profile.overallAverage : 0.2;
  const quietRatio = hasSignal ? profile.quietRatio : 0.2;

  // 質感の硬柔: bass 単独では決めない（ジャズ・ベースが金属化するため）
  const loudHard = smoothstep(0.55, 0.92, loudRatio);
  const softDyn = clamp01(
    sectionContrast * 0.48 +
      variation * 0.42 +
      melodyFocus * 0.4 +
      quietRatio * 0.32 +
      (1 - loudHard) * 0.32 -
      brightness * 0.06 -
      loudHard * 0.15,
  );
  const hardMat = clamp01(
    loudHard * 0.58 +
      smoothstep(0.1, 0.24, brightness) * 0.3 +
      contrast * 0.16 +
      smoothstep(4, 14, attackRate) * 0.14 -
      softDyn * 0.42,
  );

  // 性格軸 — 曲ごとの色差の主信号
  const warmAxis = clamp01(
    softDyn * 0.45 +
      bassDominance * 0.35 +
      lowRatio * 0.35 +
      quietRatio * 0.25 -
      highRatio * 0.3 -
      loudHard * 0.45,
  );
  const coolAxis = clamp01(
    highRatio * 0.42 +
      brightness * 0.38 +
      melodyFocus * 0.4 +
      centroid * 0.28 +
      sectionContrast * 0.22 -
      bassDominance * 0.18 -
      loudHard * 0.12,
  );
  const grooveAxis = clamp01(
    midRatio * 0.4 +
      variation * 0.35 +
      smoothstep(0.25, 0.7, loudRatio) * (1 - loudHard) * 0.55 +
      (1 - Math.abs(softDyn - 0.45)) * 0.2,
  );

  // スペクトル位置 — soft を 0 に潰さず、hard も上限に張り付かせない
  const attackGate = smoothstep(5, 14, attackRate);
  const spectralRaw = clamp01(
    0.14 +
      highRatio * 0.36 +
      coolAxis * 0.28 +
      hardMat * 0.22 +
      attackGate * 0.12 +
      brightness * 0.18 +
      centroid * 0.12 +
      melodyFocus * 0.14 +
      midRatio * 0.14 +
      variation * 0.16 +
      sectionContrast * 0.2 -
      warmAxis * 0.22 -
      softDyn * 0.06 -
      bassDominance * 0.1 -
      quietRatio * 0.06,
  );
  // stretch を弱め、loud 曲どうしが同じ天井色にならないようにする
  const spectralT = contrastStretch(smoothstep(0.05, 0.85, spectralRaw), 0.35);
  const pos = spectralT * (HUE_STOPS.length - 1);
  const seg = Math.min(HUE_STOPS.length - 2, Math.floor(pos));
  const hueAlong = lerp(HUE_STOPS[seg], HUE_STOPS[seg + 1], pos - seg);

  // soft 曲どうし: メロディ／展開／グルーヴで扇状に開く
  const softFan =
    (1 - hardMat) *
    (melodyFocus * 0.1 +
      variation * 0.12 +
      sectionContrast * 0.14 +
      midRatio * 0.08 +
      grooveAxis * 0.06 -
      bassDominance * 0.05);
  // hard 曲どうし: high/attack が多いほど青寄り、loud だけなら菫寄り
  const hardFan =
    hardMat *
    (highRatio * 0.08 + attackGate * 0.06 + variation * 0.05 - midRatio * 0.04 - loudHard * 0.03);

  const hueFull = clampRange(
    hueAlong + softFan + hardFan - warmAxis * 0.04 + coolAxis * 0.08 + grooveAxis * 0.03,
    0.02,
    0.86,
  );
  // 曲による色差を「脇役」の幅へ畳む。曲どうしの前後関係（明るい曲ほど寒色側 など）は
  // そのまま保ち、振れ幅だけを縮める。詳細は SONG_HUE_SPAN のコメント。
  const hue = wrapHue(SONG_HUE_ANCHOR + (hueFull - SONG_HUE_ANCHOR) * SONG_HUE_SPAN_REF());

  const saturationFull = clampRange(
    0.18 +
      contrast * 0.55 +
      softDyn * 0.48 +
      variation * 0.38 +
      melodyFocus * 0.2 +
      coolAxis * 0.12 -
      hardMat * 0.18 -
      loudHard * 0.08,
    0.14,
    0.96,
  );
  // 彩度も同じ考え方で畳む。色相だけ縮めても、ビビッドさが曲ごとに大きく違うと
  // やはり色が第一印象を持っていく。
  const saturation = clampRange(
    SONG_SAT_ANCHOR + (saturationFull - SONG_SAT_ANCHOR) * SONG_SAT_SPAN_REF(),
    0.14,
    0.96,
  );
  const lightness = clampRange(
    0.26 +
      brightness * 0.48 +
      softDyn * 0.1 +
      loudHard * 0.16 +
      hardMat * 0.08 +
      melodyFocus * 0.1 -
      bassDominance * 0.1 -
      quietRatio * 0.08,
    0.2,
    0.82,
  );
  // soft: マット／有機、hard: 滑らかな鉱物
  const roughness = clampRange(
    0.34 + softDyn * 0.5 + (1 - hardMat) * 0.26 - brightness * 0.2 - loudHard * 0.22,
    0.1,
    0.94,
  );
  // soft: 低金属、hard: 高金属（bass は補助のみ）
  const metalness = clampRange(
    0.03 + hardMat * 0.82 + contrast * 0.08 + bassDominance * 0.06 - softDyn * 0.45 - melodyFocus * 0.14,
    0.01,
    0.94,
  );
  const emissiveStrength = clampRange(
    0.1 +
      hardMat * 0.34 +
      loudRatio * 0.42 +
      brightness * 0.38 +
      overallAverage * 0.18 +
      sectionContrast * 0.16 +
      coolAxis * 0.1,
    0.1,
    1,
  );
  const energy = clamp01(overallAverage * 1.15 + loudRatio * 0.9 + hardMat * 0.32);

  const accentHuePull = 0.06 + coolAxis * 0.05 + hardMat * 0.04 - warmAxis * 0.02;
  const baseColor = new THREE.Color().setHSL(hue, saturation, lightness);
  const accentColor = new THREE.Color().setHSL(
    wrapHue(hue + accentHuePull + brightness * 0.05),
    Math.min(0.98, saturation * (1.1 + softDyn * 0.12)),
    Math.min(0.78, lightness + 0.1 + softDyn * 0.05 + coolAxis * 0.04),
  );
  const emissiveColor = new THREE.Color().setHSL(
    wrapHue(hue - 0.03 + hardMat * 0.05 + coolAxis * 0.03),
    Math.min(0.92, saturation * (1.05 + hardMat * 0.08)),
    clampRange(0.38 + hardMat * 0.16 + brightness * 0.08, 0.32, 0.68),
  );

  return {
    hue,
    saturation,
    lightness,
    baseColor,
    accentColor,
    emissiveColor,
    roughness,
    metalness,
    emissiveStrength,
    energy,
  };
};

/** 音が取得できなかった場合のフォールバック */
export const NEUTRAL_SCULPTURE_PALETTE = deriveSculpturePalette(null);

/**
 * 成形中と同じ環境シフト（天気・時刻）を完成パレットへ加算する。
 * ※ hue の基準は呼び出し側で合わせること（スタイル基準の差分を曲色に足すと wrap で赤紫化する）
 */
export const applyEnvShiftToSculpturePalette = (
  palette: SculpturePalette,
  shift: ClayColorShift,
): SculpturePalette => {
  if (shift.hue === 0 && shift.sat === 0 && shift.light === 0) {
    return palette;
  }
  // 色相は加算後に clamp（大きく負へ振って暖色→赤紫 wrap するのを防ぐ）
  const hue = clampRange(palette.hue + shift.hue, 0.02, 0.92);
  const saturation = clamp01(palette.saturation + shift.sat);
  const lightness = clamp01(palette.lightness + shift.light);
  const shiftColor = (color: THREE.Color) => {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    return new THREE.Color().setHSL(
      clampRange(hsl.h + shift.hue, 0.02, 0.92),
      clamp01(hsl.s + shift.sat),
      clamp01(hsl.l + shift.light),
    );
  };
  return {
    ...palette,
    hue,
    saturation,
    lightness,
    baseColor: new THREE.Color().setHSL(hue, saturation, lightness),
    accentColor: shiftColor(palette.accentColor),
    emissiveColor: shiftColor(palette.emissiveColor),
  };
};

/** 完成後 afterlife（石化・呼吸・素材化）への種プロファイル係数 */
export type AfterlifeMaterial = {
  roughnessMul: number;
  metalnessMul: number;
  emissiveMul: number;
  saturationMul: number;
  breathAmp: number;
  clearcoatMul: number;
  petrifyBoost: number;
};

export const deriveAfterlifeMaterial = (
  _palette: SculpturePalette,
  species: {
    organic: number;
    aggressive: number;
    rhythmic: number;
  },
): AfterlifeMaterial => {
  const o = species.organic;
  const a = species.aggressive;
  const r = species.rhythmic;
  return {
    roughnessMul: 1 + o * 0.28 - a * 0.16,
    metalnessMul: 1 + a * 0.42 - o * 0.18,
    emissiveMul: 1 + o * 0.28 - a * 0.06 + r * 0.08,
    saturationMul: 1 + o * 0.24 - a * 0.12 + r * 0.06,
    breathAmp: 1 + o * 0.32 + r * 0.24,
    clearcoatMul: 1 + a * 0.48,
    petrifyBoost: 1 + a * 0.2,
  };
};
