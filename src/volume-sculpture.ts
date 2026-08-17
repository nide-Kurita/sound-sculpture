import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import {
  applyEnvShiftToSculpturePalette,
  deriveSculpturePalette,
  type AudioProfileSummary,
  type SculpturePalette,
} from "./audio-palette";
import {
  combineClayShifts,
  createClayColorShift,
  hourClayShiftFromHour,
  weatherClayShiftFromSnapshot,
  type ClayColorShift,
} from "./clay-color";
import { growthFlow, growthPattern, growthPlaceOnSphere } from "./growth-algorithm";
import type { SpeciesProfile } from "./species-profile";
import type { StructureSnapshot } from "./structure-tracker";
import {
  clamp01,
  seededUnit,
  SILENCE_THRESHOLD,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
} from "./sculpture-types";

/**
 * volume:
 * 頂点を動かすのではなく、空間そのもの（密度場）へ音を堆積させ、
 * 等値面を取り出して彫刻にする。
 *
 * 球のトポロジーに縛られないので、穴・枝・分離した塊・空洞が出る。
 * 法線は場の勾配から出るため、面平均由来のカクカクが原理的に発生しない。
 *
 * 三本柱との対応:
 * - リアルタイム: live スタンプ（減衰する一時的な盛り上がり）
 * - 蓄積:         density（不可逆。減らすのは「彫り込み」だけ）
 * - 完成形:       density を高解像度で再メッシュ化して焼き込む
 *
 * 帯域の役割（原則の 低→塊 / 中→伸長 / 高→粒 を体積へ翻訳）:
 * - 低音寄り: 中心の質量が育つ（塊）
 * - 中音寄り: 成長ヘッドが空間を進んで腕・枝を作る（伸長）
 * - 高音寄り: 表面の細かい粒立ちと、彫り込み（孔・空洞）
 */

/** 形成中の場の解像度。update() が res^3 を走査するのでここが主コスト */
const LIVE_RES = 48;
/** 完成時に焼き込む解像度（一度だけ） */
const FINAL_RES = 72;
/** 三角形の上限。FINAL_RES で複雑な形になっても足りる量を確保する */
const MAX_POLY = 90000;
/** 等値面のしきい値 */
const ISO = 1;
/** 密度の上限。内部が飽和し、盛るほど等値面が外側へ広がる */
const MAX_DENSITY = 2.6;
/** メッシュの表示スケール（MarchingCubes は [-1,1] の立方体を占める） */
const MESH_SCALE = 1.62;
/** ヘッドが動ける半径。場の縁に張り付かせない */
const FIELD_BOUND = 0.82;
/** 成長ヘッドの最大数 */
const MAX_HEADS = 40;

/** live スタンプの最大数 */
const MAX_LIVE_STAMPS = 72;

/**
 * 彫り込み・枝分かれの瞬間に出す閃光の数。
 *
 * **なぜ要るか**（2026-08-11、ユーザーの実機確認）:
 * 「ほぼ動きがない。進んでいるのはよく見ると分かるが、何も起きていないように感じる」。
 * 充填率の上限（約60秒）で大きさは止まるが、**彫刻は最後まで進んでいる**
 * （面積は一定なのに穴の数・複雑度は動き続ける。`docs/handoff/VOLUME.md` 3章）。
 * つまり直すのは形ではなく**見せ方**。大きさを伸ばす方向は2回試して2回とも
 * 複雑度を壊しているので取らない（5章）。
 *
 * トポロジーが実際に変わった瞬間（穴が貫通した等）を毎フレーム判定するのは高くつくので、
 * **彫り込みイベントそのものを合図に使う。** 「ここが削られた」を見せるのが目的なので
 * これで足りる。
 */
const MAX_CARVE_FLASHES = 28;

/**
 * 彫り込みの閃光のマテリアル。加算合成の柔らかい点。
 * 深度判定を切っているので `depthWrite` も false にしないと後続の描画を汚す。
 */
const createFlashMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffe6c2) } },
    vertexShader: `
      attribute float aLife;
      attribute float aSize;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // 出た瞬間が一番大きく、縮みながら消える。
        // **上限を切ること。** GPU 側の gl_PointSize の上限に張り付くと、
        // aSize を 1/8 にしても見た目が変わらなくなる（2026-08-11 にこれで一度はまった）。
        gl_PointSize = clamp(
          aSize * (260.0 / max(0.001, -mv.z)) * (0.45 + aLife * 0.55),
          3.0,
          78.0
        );
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5) discard;
        float soft = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(uColor, soft * soft * vLife * 0.85);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });

/** `SculptureExperience.applyWeatherClayTint` が受け取る形（構造的に定義されている） */
type WeatherTintSnapshot = {
  condition: string;
  cloudCover: number;
  rainIntensity: number;
  lightningIntensity: number;
};

/**
 * volume 用の天気の効き（彩度・明度）。
 *
 * **なぜ volume 専用の表が要るのか**（2026-08-11 の実測とユーザー判断）:
 * 共通の `weatherClayShiftFromSnapshot` は色相で天気を伝える作りで、彩度・明度の押しは
 * ±0.03 程度しかない。vita の粘土では色相が読めるのでそれで足りるが、volume の完成体は
 * **明度 0.78 と淡く、色相を動かしても色として読めない。**
 * 色相を強める案は2通り試して2通りとも悪化した（`docs/handoff/VOLUME.md` 5章）。
 * ユーザーは「明度・彩度で伝える」を選んだので、その2軸だけ volume 側で持つ。
 *
 * 方針: 雨・嵐は暗く、雪・霧は白く明るく、快晴は明るく鮮やかに、雷雨は暗く鮮やかに。
 * 天気を「見て分かる」ようにするための表なので、共通側より一桁大きい。
 */
const VOLUME_ENV_TONE: Record<string, { sat: number; light: number }> = {
  clear: { sat: 0.1, light: 0.06 },
  cloudy: { sat: -0.1, light: -0.05 },
  overcast: { sat: -0.16, light: -0.1 },
  fog: { sat: -0.24, light: 0.04 },
  rain: { sat: 0.04, light: -0.16 },
  snow: { sat: -0.3, light: 0.12 },
  windy: { sat: -0.06, light: -0.02 },
  storm: { sat: 0.02, light: -0.2 },
  thunder: { sat: 0.16, light: -0.22 },
  thunderstorm: { sat: 0.16, light: -0.22 },
};

/** 天気の彩度・明度。雲量・雨・雷の強さで連続に効かせる（切り替わりで段が出ないように） */
const volumeWeatherTone = (snapshot: WeatherTintSnapshot | null): ClayColorShift => {
  if (!snapshot) {
    return { hue: 0, sat: 0, light: 0 };
  }
  const tone = VOLUME_ENV_TONE[snapshot.condition];
  if (!tone) {
    return { hue: 0, sat: 0, light: 0 };
  }
  const cloud = clamp01(snapshot.cloudCover);
  const rain = clamp01(snapshot.rainIntensity);
  const lightning = clamp01(snapshot.lightningIntensity);
  // 快晴は「雲が無いほど強い」、それ以外は「荒れているほど強い」
  const amt =
    snapshot.condition === "clear"
      ? clamp01(0.55 + (1 - cloud) * 0.45)
      : clamp01(0.5 + cloud * 0.25 + rain * 0.3 + lightning * 0.25);
  return { hue: 0, sat: tone.sat * amt, light: tone.light * amt };
};

/**
 * volume 用の時刻の効き（彩度・明度）。
 *
 * 共通の `hourClayShiftFromHour` は色相幅が ±0.045 しか無く、
 * **完成後に時刻で色が動いて見えるぶんは照明が作っていた**（ずらしの倍率を
 * 1 / 2.5 / 5.5 と変えても画像で見分けられなかった）。ここで本体側にも差を付ける。
 *
 * 深夜と夜は暗く彩度を落とし、昼は明るく、夕は彩度を上げる。
 * キーフレーム間を分単位で線形補間するのは共通関数と同じ作り。
 */
const volumeHourTone = (hour: number): ClayColorShift => {
  const h = ((hour % 24) + 24) % 24;
  const keys = [
    { h: 0, sat: -0.12, light: -0.2 },
    { h: 4, sat: -0.12, light: -0.19 },
    { h: 7, sat: -0.04, light: -0.06 },
    { h: 11, sat: 0.05, light: 0.06 },
    { h: 14, sat: 0.06, light: 0.08 },
    { h: 16.75, sat: 0.16, light: 0.0 },
    { h: 19, sat: 0.0, light: -0.1 },
    { h: 22, sat: -0.1, light: -0.18 },
    { h: 24, sat: -0.12, light: -0.2 },
  ];
  let a = keys[0];
  let b = keys[1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (h >= keys[i].h && h <= keys[i + 1].h) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const t = clamp01((h - a.h) / Math.max(1e-6, b.h - a.h));
  return {
    hue: 0,
    sat: a.sat + (b.sat - a.sat) * t,
    light: a.light + (b.light - a.light) * t,
  };
};

type GrowthHead = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 残り寿命（秒）。尽きると止まる */
  life: number;
  /** 堆積の太さ（オブジェクト空間） */
  thickness: number;
  /** 分岐した世代。深いほど細い */
  generation: number;
  seed: number;
};

type LiveStamp = {
  life: number;
  decay: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  amount: number;
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

export class VolumeSculpture implements SculptureExperience {
  readonly group = new THREE.Group();

  private readonly material: THREE.MeshPhysicalMaterial;
  private mc: MarchingCubes;

  /** 蓄積された密度（不可逆）。これが彫刻の正体 */
  private density: Float32Array;
  private res = LIVE_RES;

  private readonly heads: GrowthHead[] = [];
  private readonly liveStamps: LiveStamp[] = [];

  private readonly flowOut = { x: 0, y: 0, z: 0 };
  private readonly tmpColor = new THREE.Color();
  private readonly targetColor = new THREE.Color();

  private time = 0;
  private seed = 1;
  /** 中心質量の育ち具合 0..1 */
  private mass = 0;
  /** 直近の盛り上がり（滑らか化した overall） */
  private energy = 0;
  /** 静かなパートがどれだけ続いたか。細く滑らかな部位を作る */
  private calm = 0;
  private completed = false;
  private shapeHold = false;
  private completionProgress = 0;
  private breathTime = 0;
  private breathBpm = 64;
  private idleTime = 0;
  private headSpawnCooldown = 0;
  private carveCooldown = 0;
  private readonly flashPositions = new Float32Array(MAX_CARVE_FLASHES * 3);
  private readonly flashLife = new Float32Array(MAX_CARVE_FLASHES);
  private readonly flashSize = new Float32Array(MAX_CARVE_FLASHES);
  private flashDirty = false;
  private readonly flashMaterial = createFlashMaterial();
  private readonly flashPoints = this.createFlashPoints();
  /** 等値面の内側になっているセルの割合。空間を埋め尽くさないためのブレーキに使う */
  private fillRatio = 0;
  private fillCheckCooldown = 0;
  /** 堆積量の倍率 0..1。埋まるほど 0 に近づく */
  private growthBudget = 1;
  private lastKickIndex = -1;
  private lastSnareIndex = -1;
  private lastMelodyPulse = 0;
  private completionPalette: SculpturePalette | null = null;
  /**
   * 天気・時刻による色のずらし量。
   * **原則で必須の要素**（天気 / 時間 / 音楽性による色変化を殺してはいけない）。
   * 2026-08-10 まで volume では `applyWeatherClayTint` が空実装で、
   * 天気も時刻もまったく反映されていなかった。公開スタイルへ上げるにあたって塞いだ穴。
   */
  private weatherShift: ClayColorShift = createClayColorShift();
  /** ずらしを作り直せるように生の入力も持っておく */
  private envSnapshot: WeatherTintSnapshot | null = null;
  private envHour = 12;
  /** 再生中に育つ「その曲の色」。完成を待たずに曲の性格が色へ出るようにする */
  private songPalette: SculpturePalette | null = null;
  private songPaletteTimer = 0;
  private completionSpecies: SpeciesProfile | null = null;
  private speciesProfile: SpeciesProfile | null = null;
  /** 完成時の質感立ち上げ用に、完成直前の roughness を控える */
  private completionStartRoughness = 0.86;
  private dirty = true;

  constructor() {
    this.group.name = "VolumeSculpture";

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x9aa6c4,
      roughness: 0.86,
      metalness: 0,
      flatShading: false,
      // 完成フェーズで立ち上げるチャンネルは、実質 0 で先にコンパイルさせておく
      // （0 → >0 の切り替えはシェーダー再コンパイルのカクつきになる）
      clearcoat: 1e-4,
      clearcoatRoughness: 0.6,
      sheen: 1e-4,
      sheenColor: new THREE.Color(0x9fd9ff),
      sheenRoughness: 0.8,
      iridescence: 1e-4,
      iridescenceIOR: 1.32,
    });

    // UV・頂点カラーは使わないので polygonize の仕事を減らす
    this.mc = new MarchingCubes(LIVE_RES, this.material, false, false, MAX_POLY);
    this.mc.isolation = ISO;
    this.mc.scale.setScalar(MESH_SCALE);
    this.mc.frustumCulled = false;

    this.density = new Float32Array(LIVE_RES * LIVE_RES * LIVE_RES);

    for (let i = 0; i < MAX_HEADS; i += 1) {
      this.heads.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        thickness: 0.06,
        generation: 0,
        seed: i * 1.37,
      });
    }
    for (let i = 0; i < MAX_LIVE_STAMPS; i += 1) {
      this.liveStamps.push({
        life: 0,
        decay: 1,
        x: 0,
        y: 0,
        z: 0,
        radius: 0.1,
        amount: 0,
      });
    }

    this.group.add(this.mc);
    this.group.add(this.flashPoints);
    this.group.position.y = -0.1;
    this.reset(Math.floor(Math.random() * 1e9));
  }

  private createFlashPoints() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.flashPositions, 3));
    geo.setAttribute("aLife", new THREE.BufferAttribute(this.flashLife, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.flashSize, 1));
    const points = new THREE.Points(geo, this.flashMaterial);
    // 等値面の内側で起きた彫り込みも見せたいので深度判定を切る。
    // 一瞬の光なので、手前に抜けても「火花」として読める。
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 3;
    return points;
  }

  /**
   * 彫り込み・枝分かれの閃光を1つ出す。
   * `ox/oy/oz` はオブジェクト空間 (-1..1)。等値面と同じ `MESH_SCALE` で置く。
   */
  private pushFlash(ox: number, oy: number, oz: number, size: number) {
    // 一番寿命の短いスロットを潰す（常に「今起きたこと」が見える）
    let slot = 0;
    let weakest = Infinity;
    for (let i = 0; i < MAX_CARVE_FLASHES; i += 1) {
      if (this.flashLife[i] < weakest) {
        weakest = this.flashLife[i];
        slot = i;
      }
    }
    const p = this.flashPositions;
    p[slot * 3] = ox * MESH_SCALE;
    p[slot * 3 + 1] = oy * MESH_SCALE;
    p[slot * 3 + 2] = oz * MESH_SCALE;
    this.flashLife[slot] = 1;
    this.flashSize[slot] = size;
    this.flashDirty = true;
  }

  /** 閃光の減衰。完成後は出さない（作品になったら静かになる） */
  private updateFlashes(dt: number) {
    let anyAlive = false;
    for (let i = 0; i < MAX_CARVE_FLASHES; i += 1) {
      if (this.flashLife[i] <= 0) continue;
      // 0.55 秒で消える。立ち上がりは即時、減衰だけ見せる
      this.flashLife[i] = Math.max(0, this.flashLife[i] - dt / 0.55);
      anyAlive = true;
      this.flashDirty = true;
    }
    this.flashPoints.visible = anyAlive;
    if (!this.flashDirty) return;
    this.flashDirty = false;
    const geo = this.flashPoints.geometry;
    geo.getAttribute("position").needsUpdate = true;
    geo.getAttribute("aLife").needsUpdate = true;
    geo.getAttribute("aSize").needsUpdate = true;
  }

  // ---------------------------------------------------------------- 場の操作

  /** オブジェクト空間 (-1..1) → セル座標 */
  private toCell(v: number) {
    return (v + 1) * (this.res * 0.5);
  }

  /**
   * 球ブラシで場へ書き込む。amount が負なら彫り込み。
   * 密度は [0, MAX_DENSITY] にクランプするので、内部は飽和して外へ広がる。
   */
  private stamp(
    target: Float32Array,
    ox: number,
    oy: number,
    oz: number,
    radiusObj: number,
    amount: number,
  ) {
    const res = this.res;
    const res2 = res * res;
    const cx = this.toCell(ox);
    const cy = this.toCell(oy);
    const cz = this.toCell(oz);
    const r = Math.max(1, radiusObj * res * 0.5);
    const r2 = r * r;
    const invR2 = 1 / r2;

    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(res - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(res - 2, Math.ceil(cy + r));
    const z0 = Math.max(1, Math.floor(cz - r));
    const z1 = Math.min(res - 2, Math.ceil(cz + r));

    for (let z = z0; z <= z1; z += 1) {
      const dz = z - cz;
      const dz2 = dz * dz;
      const zo = z * res2;
      for (let y = y0; y <= y1; y += 1) {
        const dy = y - cy;
        const d2yz = dz2 + dy * dy;
        if (d2yz > r2) continue;
        const yo = zo + y * res;
        for (let x = x0; x <= x1; x += 1) {
          const dx = x - cx;
          const d2 = d2yz + dx * dx;
          if (d2 > r2) continue;
          const t = 1 - d2 * invR2;
          const idx = yo + x;
          const next = target[idx] + amount * t * t;
          target[idx] = next < 0 ? 0 : next > MAX_DENSITY ? MAX_DENSITY : next;
        }
      }
    }
  }

  /**
   * 塊を置く。等方の球にすると「粘土玉」になってしまうので、
   * 成長アルゴリズムの模様で凹凸を付けながら盛る。
   * アルゴリズムを変えると body の肌そのものが変わる。
   */
  private stampLumpy(
    ox: number,
    oy: number,
    oz: number,
    radiusObj: number,
    amount: number,
  ) {
    const res = this.res;
    const res2 = res * res;
    const cx = this.toCell(ox);
    const cy = this.toCell(oy);
    const cz = this.toCell(oz);
    const r = Math.max(1, radiusObj * res * 0.5);
    const r2 = r * r;
    const invR2 = 1 / r2;
    const invHalf = 2 / res;
    const salt = this.seed * 0.019;

    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(res - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(res - 2, Math.ceil(cy + r));
    const z0 = Math.max(1, Math.floor(cz - r));
    const z1 = Math.min(res - 2, Math.ceil(cz + r));

    for (let z = z0; z <= z1; z += 1) {
      const dz = z - cz;
      const dz2 = dz * dz;
      const zo = z * res2;
      const oz2 = z * invHalf - 1;
      for (let y = y0; y <= y1; y += 1) {
        const dy = y - cy;
        const d2yz = dz2 + dy * dy;
        if (d2yz > r2) continue;
        const yo = zo + y * res;
        const oy2 = y * invHalf - 1;
        for (let x = x0; x <= x1; x += 1) {
          const dx = x - cx;
          const d2 = d2yz + dx * dx;
          if (d2 > r2) continue;
          const ox2 = x * invHalf - 1;
          // pattern は -1..1 程度。0.35..1.35 の不均一な盛りに変換する
          const p = growthPattern(ox2 * 2.6, oy2 * 2.6, oz2 * 2.6, salt);
          const t = 1 - d2 * invR2;
          const idx = yo + x;
          const next = this.density[idx] + amount * t * t * (0.85 + p * 0.5);
          this.density[idx] = next < 0 ? 0 : next > MAX_DENSITY ? MAX_DENSITY : next;
        }
      }
    }
  }

  /** 減衰する一時的な盛り上がり（LIVE 層）を積む */
  private pushLiveStamp(
    x: number,
    y: number,
    z: number,
    radius: number,
    amount: number,
    decay: number,
  ) {
    let slot: LiveStamp | null = null;
    let weakest = Infinity;
    for (const s of this.liveStamps) {
      if (s.life <= 0) {
        slot = s;
        break;
      }
      if (s.life < weakest) {
        weakest = s.life;
        slot = s;
      }
    }
    if (!slot) return;
    slot.life = 1;
    slot.decay = decay;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.radius = radius;
    slot.amount = amount;
  }

  // -------------------------------------------------------------- 成長ヘッド

  private spawnHead(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    thickness: number,
    generation: number,
    life: number,
  ) {
    for (const h of this.heads) {
      if (h.active) continue;
      h.active = true;
      h.x = x;
      h.y = y;
      h.z = z;
      h.vx = vx;
      h.vy = vy;
      h.vz = vz;
      h.thickness = thickness;
      h.generation = generation;
      h.life = life;
      return h;
    }
    return null;
  }

  private activeHeadCount() {
    let n = 0;
    for (const h of this.heads) if (h.active) n += 1;
    return n;
  }

  /**
   * ヘッドを進めて軌跡に密度を置く。
   * 進行方向は成長アルゴリズムの flow() が決めるので、
   * アルゴリズムを変えると枝の走り方そのものが変わる。
   */
  private advanceHeads(bands: AudioBands, r: RhythmEvents, dt: number, budget: number) {
    const mid = bands.mid * 0.5 + bands.melody * 0.5;
    const drive = 0.25 + mid * 1.5 + r.melodyOnset * 0.8 + this.energy * 0.5;

    for (const h of this.heads) {
      if (!h.active) continue;

      h.life -= dt;
      if (h.life <= 0) {
        h.active = false;
        continue;
      }

      growthFlow(h.x * 2.2, h.y * 2.2, h.z * 2.2, this.seed * 0.017 + h.seed, this.flowOut);
      const fl = Math.hypot(this.flowOut.x, this.flowOut.y, this.flowOut.z) || 1;
      const steer = Math.min(1, dt * 3.4);
      h.vx += (this.flowOut.x / fl - h.vx) * steer;
      h.vy += (this.flowOut.y / fl - h.vy) * steer;
      h.vz += (this.flowOut.z / fl - h.vz) * steer;

      // 中心から離れすぎたら引き戻す（場の外へ出さない）
      const dist = Math.hypot(h.x, h.y, h.z);
      if (dist > FIELD_BOUND) {
        const pull = (dist - FIELD_BOUND) * 6;
        h.vx -= (h.x / dist) * pull * dt;
        h.vy -= (h.y / dist) * pull * dt;
        h.vz -= (h.z / dist) * pull * dt;
      }

      const speed = (0.14 + drive * 0.22) * (1 - h.generation * 0.14);
      const step = speed * dt;
      const px = h.x;
      const py = h.y;
      const pz = h.z;
      h.x += h.vx * step;
      h.y += h.vy * step;
      h.z += h.vz * step;

      // 静かなときほど細く滑らか、盛り上がりで太く荒く
      const thickness =
        h.thickness * (0.62 + this.energy * 0.9) * (1 - this.calm * 0.35);
      // 育つほど新しい堆積は薄くする。曲の後半で全体が埋まってブロブに戻るのを防ぐ
      const deposit = (0.9 + this.energy * 2.2) * dt * 2.4 * (1 - this.mass * 0.55) * budget;

      // 軌跡が飛ばないよう区間を分割して置く（切れると浮遊する破片になる）
      const segments = 3;
      for (let s = 1; s <= segments; s += 1) {
        const t = s / segments;
        this.stamp(
          this.density,
          px + (h.x - px) * t,
          py + (h.y - py) * t,
          pz + (h.z - pz) * t,
          thickness,
          deposit / segments,
        );
      }
    }
  }

  // ------------------------------------------------------------------ update

  update(
    bands: AudioBands,
    deltaTime: number,
    _userViewInteracting?: boolean,
    rhythm?: RhythmEvents,
    structure?: StructureSnapshot,
    species?: SpeciesProfile,
  ) {
    const r = rhythm ?? defaultRhythm();
    const dt = Math.min(0.05, Math.max(0, deltaTime));
    this.time += dt;
    this.idleTime += dt;
    if (species) {
      this.speciesProfile = species;
    }

    if (this.completed) {
      this.updateAfterlife(dt);
      // 完成後は閃光を出さない（作品になったら静かになる）。残っている分だけ消す
      this.updateFlashes(dt);
      this.rebuildField(dt);
      return;
    }

    const loud = bands.overall > SILENCE_THRESHOLD;
    const target = loud ? clamp01(bands.overall * 1.25 + bands.bassFocus * 0.25) : 0;
    this.energy += (target - this.energy) * Math.min(1, dt * 3.4);
    this.calm += ((loud ? 0 : 1) - this.calm) * Math.min(1, dt * 0.6);

    if (!this.shapeHold) {
      this.grow(bands, r, structure, dt, loud);
    }

    this.updateMaterialLive(bands, dt);
    this.updateFlashes(dt);
    this.rebuildField(dt);
  }

  /** 音を密度場へ堆積させる（蓄積は不可逆） */
  private grow(
    bands: AudioBands,
    r: RhythmEvents,
    structure: StructureSnapshot | undefined,
    dt: number,
    loud: boolean,
  ) {
    const bass = bands.sub * 0.6 + bands.low * 0.4;
    const high = bands.high;

    // 空間を埋め尽くすとどの曲も同じ「大きな塊」になるので、詰まり具合でブレーキをかける。
    // 上限自体は蓄積した質量に応じて変わるため、静かな曲は小さく、激しい曲は大きく仕上がる。
    //
    // 2026-08-11 修正: 旧実装は上限に達すると堆積を **0 倍** にしていたため、
    // **曲の最初の 60 秒で成長が終わっていた。** 実測（I'm Yours 4:18）で本体面積が
    // 60秒 24.33% → 120秒 24.65% → 180秒 24.64% と完全に平ら。曲の 77% が形に残らず、
    // 「一曲を最後まで聴いた結果」が成立していなかった。
    //
    // **2つ試して2つとも失敗した。詳細は docs/handoff/VOLUME.md の5章。**
    //   A+B 上限を 0.10 → 0.25 に上げ、累積エネルギーで押し上げる
    //       → 成長は最後まで続いたが、2曲の複雑度が 4.31 / 10.56 → 6.47 / 6.42 になり
    //         **曲ごとの差（6.25）がほぼ消えた（0.05）**。太ると網目が埋まる。
    //   C   堆積を止めず、超過ぶんだけ全体を痩せさせる（質量保存）
    //       → さらに悪化。Fury が穴 5 → 0、複雑度 10.56 → **3.74**（真円が 3.54）。
    //         一様に痩せさせると薄い部分が「割れる」のではなく「均される」。
    // どちらも元の実装より悪かったので、この節は元のまま戻してある。
    // **上限に達したあと彫り込みだけが効く状態が、密な曲の網目構造を作っている**
    // という可能性が高い。触る前にそこを測ること。
    this.fillCheckCooldown -= dt;
    if (this.fillCheckCooldown <= 0) {
      this.fillCheckCooldown = 0.5;
      let filled = 0;
      const d = this.density;
      for (let i = 0; i < d.length; i += 1) {
        if (d[i] > ISO) filled += 1;
      }
      this.fillRatio = filled / d.length;
      const targetFill = 0.025 + this.mass * 0.075;
      const over = this.fillRatio / targetFill;
      this.growthBudget = clamp01(1 - over * over);
    }
    const budget = this.growthBudget;

    // --- 低音寄り: 質量が育つ（塊）
    this.mass = clamp01(this.mass + bass * dt * 0.075 * (1 - this.mass * 0.55));
    if (loud) {
      // 中心は控えめに。球状に盛り続けると「粘土玉」になるので、模様で凹凸を付ける
      const coreRadius = 0.12 + this.mass * 0.24;
      this.stampLumpy(0, 0, 0, coreRadius, (0.2 + bass * 1.5) * dt * budget);

      // 低音は「既にあるもの」を太らせる方向にも効かせる。
      // 腕の付け根に質量が乗るので、玉＋毛ではなく胴と肢のある塊になる
      // 付け根は数が多いので、模様の評価は中心だけに留めて素の球ブラシで盛る
      // （腕の向きがすでに不規則なので、ここで模様を足さなくても玉にはならない）
      const limbGain = (0.35 + bass * 2.1) * dt * budget;
      for (const h of this.heads) {
        if (!h.active) continue;
        const back = 0.55;
        this.stamp(
          this.density,
          h.x * back,
          h.y * back,
          h.z * back,
          0.1 + this.mass * 0.14,
          limbGain,
        );
      }
    }

    // キック: 一時的な膨らみ（LIVE）＋わずかな恒久堆積
    if (r.kickIndex !== this.lastKickIndex && r.kick > 0.25) {
      this.lastKickIndex = r.kickIndex;
      this.pushLiveStamp(0, 0, 0, 0.2 + this.mass * 0.4, 0.9 + r.kick * 1.4, 3.4);
      // 打点はヘッドを外へ押し出す = 腕が伸びる瞬間になる
      for (const h of this.heads) {
        if (!h.active) continue;
        const d = Math.hypot(h.x, h.y, h.z) || 1;
        const push = r.kick * 0.55;
        h.vx += (h.x / d) * push;
        h.vy += (h.y / d) * push;
        h.vz += (h.z / d) * push;
      }
    }

    // --- 中音寄り: 成長ヘッドが空間を進んで腕・枝を作る（伸長）
    this.advanceHeads(bands, r, dt, budget);

    // 本数は絞る。多いと空間が埋まって結局ブロブになる
    this.headSpawnCooldown -= dt;
    const wantHeads = 3 + Math.round(this.mass * 3 + bands.melodyFocus * 3);
    if (this.headSpawnCooldown <= 0 && this.activeHeadCount() < Math.min(MAX_HEADS, wantHeads)) {
      this.headSpawnCooldown = 0.6;
      this.spawnFromCore(0.1 + bands.melodyFocus * 0.04, 0);
    }

    // メロディの句頭で分岐する（枝分かれ＝曲の展開が形に残る）
    this.lastMelodyPulse = Math.max(0, this.lastMelodyPulse - dt);
    if (r.melodyOnset > 0.45 && this.lastMelodyPulse <= 0) {
      this.lastMelodyPulse = 0.22;
      this.branchRandomHead(r.melodyOnset);
    }

    // スネア: 膜の代わりに、面で押し広げる一時的な張り
    if (r.snareIndex !== this.lastSnareIndex && r.snare > 0.3) {
      this.lastSnareIndex = r.snareIndex;
      const dir = growthPlaceOnSphere(
        Math.floor(this.time * 60) % 512,
        512,
        this.seed * 0.31,
      );
      const rad = 0.35 + this.mass * 0.3;
      this.pushLiveStamp(
        dir.x * rad,
        dir.y * rad,
        dir.z * rad,
        0.16 + r.snare * 0.16,
        0.8 + r.snare * 1.2,
        4.2,
      );
    }

    // --- 高音寄り: 表面の粒立ちと彫り込み（孔・空洞）
    if (high > 0.12) {
      const grains = 1 + Math.floor(high * 3);
      for (let i = 0; i < grains; i += 1) {
        const idx = Math.floor(seededUnit(Math.floor(this.time * 240) + i * 7, 3.1) * 4096);
        const dir = growthPlaceOnSphere(idx, 4096, this.seed * 0.11);
        const rad = (0.2 + this.mass * 0.55) * (0.85 + seededUnit(idx, 9.4) * 0.3);
        this.pushLiveStamp(
          dir.x * rad,
          dir.y * rad,
          dir.z * rad,
          0.035 + high * 0.03,
          0.5 + high * 0.9,
          7.5,
        );
      }
    }

    // 彫り込み: 高域が強いとき／盛り上がりが落ちた瞬間に孔を開ける。
    // 細い腕を貫通するとトポロジーが変わる = 曲ごとに別物になる主因
    // 頻度は絞る。毎秒開けると全体が虫食いになって形が壊れるので、
    // 「盛り上がりが落ちた瞬間」を主なきっかけにして曲あたり数十回に収める
    this.carveCooldown -= dt;
    const drop = structure?.events.energyDrop ?? false;
    if (this.carveCooldown <= 0 && (high > 0.55 || drop)) {
      this.carveCooldown = drop ? 1.6 : 2.4;
      const idx = Math.floor(seededUnit(Math.floor(this.time * 97), 5.7) * 4096);
      const dir = growthPlaceOnSphere(idx, 4096, this.seed * 0.53 + this.time * 0.01);
      const depth = drop ? 0.55 : 0.3 + this.mass * 0.35;
      const carveRadius = drop ? 0.13 + high * 0.06 : 0.07 + high * 0.06;
      this.stamp(
        this.density,
        dir.x * depth,
        dir.y * depth,
        dir.z * depth,
        carveRadius,
        -(0.9 + high * 1.4),
      );
      // 「いま削れた場所」を見せる。彫り込みは大きさを変えないので、
      // これが無いと後半は何も起きていないように見える（MAX_CARVE_FLASHES の説明）
      // aSize は距離で割る前の大きさ。シェーダ側で 78px に頭打ちするので、
      // 近すぎるときも画面を埋めない
      this.pushFlash(dir.x * depth, dir.y * depth, dir.z * depth, 2.6 + carveRadius * 8);
    }

    // 盛り上がりの立ち上がりでヘッドを増やす（サビで枝が増える）
    if (structure?.events.energySurge) {
      for (let i = 0; i < 2; i += 1) {
        this.spawnFromCore(0.07, 0);
      }
      // 枝が分かれる瞬間も見せる。彫り込みより小さくして、削りと区別が付くようにする
      const idx = Math.floor(seededUnit(Math.floor(this.time * 53), 3.9) * 2048);
      const dir = growthPlaceOnSphere(idx, 2048, this.seed * 0.31);
      const rad = 0.25 + this.mass * 0.45;
      this.pushFlash(dir.x * rad, dir.y * rad, dir.z * rad, 1.4);
    }
  }

  private spawnFromCore(thickness: number, generation: number) {
    const idx = Math.floor(seededUnit(Math.floor(this.time * 31) + generation * 13, 2.3) * 2048);
    const dir = growthPlaceOnSphere(idx, 2048, this.seed * 0.07);
    const start = 0.1 + this.mass * 0.25;
    this.spawnHead(
      dir.x * start,
      dir.y * start,
      dir.z * start,
      dir.x,
      dir.y,
      dir.z,
      thickness,
      generation,
      4 + seededUnit(idx, 1.9) * 6,
    );
  }

  private branchRandomHead(strength: number) {
    const candidates = this.heads.filter((h) => h.active && h.generation < 3);
    if (candidates.length === 0) {
      this.spawnFromCore(0.05, 0);
      return;
    }
    const pick = candidates[Math.floor(seededUnit(Math.floor(this.time * 53), 7.7) * candidates.length) % candidates.length];
    const jx = seededUnit(Math.floor(this.time * 71), 1.1) - 0.5;
    const jy = seededUnit(Math.floor(this.time * 71), 2.2) - 0.5;
    const jz = seededUnit(Math.floor(this.time * 71), 3.3) - 0.5;
    const len = Math.hypot(pick.vx + jx, pick.vy + jy, pick.vz + jz) || 1;
    this.spawnHead(
      pick.x,
      pick.y,
      pick.z,
      (pick.vx + jx) / len,
      (pick.vy + jy) / len,
      (pick.vz + jz) / len,
      pick.thickness * (0.66 + strength * 0.2),
      pick.generation + 1,
      2.5 + strength * 3.5,
    );
  }

  /**
   * density（蓄積）に live 層を重ねて等値面を作り直す。
   * normal_cache は「計算済みフラグ」を兼ねているので毎フレーム無効化する。
   *
   * 完成後は形を焼き込んだ扱いにして再ポリゴン化しない（FINAL_RES は毎フレーム回すには重い）。
   * 完成後の呼吸は group のスケールで出す。
   */
  private rebuildField(dt: number) {
    if (this.completed && !this.dirty) {
      return;
    }

    const field = this.mc.field;
    field.set(this.density);

    for (const s of this.liveStamps) {
      if (s.life <= 0) continue;
      const amp = s.amount * s.life * s.life;
      if (amp > 0.001) {
        this.stamp(field, s.x, s.y, s.z, s.radius, amp);
      }
    }

    // 無音時のかすかな呼吸（形は変えず、等値面をわずかに上下させる）
    if (!this.completed && this.calm > 0.2) {
      const breath = Math.sin(this.idleTime * 0.7) * 0.5 + 0.5;
      this.mc.isolation = ISO * (1 - this.calm * 0.02 * breath);
    } else {
      this.mc.isolation = ISO;
    }

    this.mc.normal_cache.fill(0);
    this.mc.update();
    this.dirty = false;

    for (const s of this.liveStamps) {
      if (s.life <= 0) continue;
      s.life -= s.decay * dt;
      if (s.life < 0) s.life = 0;
    }
  }

  // -------------------------------------------------------------- マテリアル

  private updateMaterialLive(bands: AudioBands, dt: number) {
    // 瞬間の音（LIVE）
    let hue = 0.6 - bands.brightness * 0.08 + bands.melodyFocus * 0.05;
    let sat = 0.2 + bands.contrast * 0.18;
    let light = 0.5 + bands.brightness * 0.08;
    // その曲らしさ（蓄積）。完成を待たずに曲の性格が色へ出るようにする。
    // 寄せ幅を抑えているのは、色を主役にしないため（原則: 色は脇役）。
    const song = this.songPalette;
    if (song) {
      hue += this.hueDelta(hue, song.hue) * 0.45;
      sat += (song.saturation - sat) * 0.3;
      light += (song.lightness - light) * 0.25;
    }
    // 天気・時刻
    hue += this.weatherShift.hue;
    sat += this.weatherShift.sat;
    light += this.weatherShift.light;
    this.targetColor.setHSL(
      ((hue % 1) + 1) % 1,
      Math.min(0.8, Math.max(0.04, sat)),
      Math.min(0.72, Math.max(0.12, light)),
    );
    this.material.color.lerp(this.targetColor, Math.min(1, dt * 1.4));
    this.material.roughness = Math.max(
      0.42,
      0.88 - bands.brightness * 0.1 - bands.high * 0.06,
    );
  }

  /** 完成後: 質感が「生きもの」から「作品」へ切り替わる */
  private updateAfterlife(dt: number) {
    this.breathTime += dt;
    this.completionProgress = Math.min(1, this.completionProgress + dt / 6);
    const p = this.completionProgress;
    const ease = p * p * (3 - 2 * p);

    // 呼吸は形ではなくスケールで出す（再ポリゴン化しない）
    const beat = (this.breathBpm / 60) * Math.PI * 0.2;
    const swell = 1 + Math.sin(this.breathTime * beat) * 0.014;
    this.group.scale.set(swell, 2 - swell, swell);

    const sp = this.completionSpecies ?? this.speciesProfile;
    const organic = sp?.organic ?? 0.5;
    const aggressive = sp?.aggressive ?? 0.5;

    // 完成後も天気・時刻で色が動く（作品になった後に環境が効くのが vita と同じ扱い）
    const palette = this.completionPalette;
    if (palette) {
      const envPalette = applyEnvShiftToSculpturePalette(palette, this.weatherShift);
      this.tmpColor.copy(envPalette.baseColor);
      this.material.color.lerp(this.tmpColor, Math.min(1, dt * 0.9));
    }

    const clearcoatMul = 1 + aggressive * 0.48;
    const roughnessMul = 1 + organic * 0.28 - aggressive * 0.16;

    this.material.clearcoat = Math.max(1e-4, Math.min(1, 0.42 * clearcoatMul) * ease);
    this.material.sheen = Math.max(1e-4, 0.5 * ease);
    this.material.iridescence = Math.max(1e-4, 0.32 * ease);
    const targetRoughness = Math.min(1, Math.max(0.1, 0.74 * roughnessMul));
    this.material.roughness =
      this.completionStartRoughness +
      (targetRoughness - this.completionStartRoughness) * ease;
  }

  // ------------------------------------------------------ ライフサイクル API

  applyLiveTuningNow() {}

  applyAlgoMorphBias() {}

  nudgeClayColorOnClick() {}

  /** 色相の差を最短方向で返す（0.95 → 0.05 は +0.1 であって -0.9 ではない） */
  private hueDelta(from: number, to: number) {
    let d = (to - from) % 1;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  }

  applyWeatherClayTint(snapshot: WeatherTintSnapshot | null, hour = 12) {
    this.envSnapshot = snapshot;
    this.envHour = hour;
    this.weatherShift = this.envShiftFor(0.6);
  }

  /**
   * 天気・時刻のずらしを作る。`baseHue` は volume の基準色（0.6 = 深い青緑）。
   *
   * **基準を適用先の色相（完成パレットの 0.1 付近）に変える案は 2026-08-11 に試して却下した。**
   * 理屈の上では正しい——`weatherClayShiftFromSnapshot` が返すのは
   * 「基準色相から目標色相へ寄せる差分」なので、基準がずれていれば
   * `applyEnvShiftToSculpturePalette` のクランプ [0.02, 0.92] に張り付いて消える——のだが、
   * 直すと**全天気が淡い黄緑へ収束して、直す前より判別できなくなった**。
   * 完成体の明度が 0.78 と高く、色相だけでは天気を伝えられないため。
   * 倍率を上げても白へ抜けるだけだった。比較画像は
   * `docs/volume-progress/env-weather-gain.png`、経緯は `docs/handoff/VOLUME.md` 3章。
   */
  private envShiftFor(baseHue: number): ClayColorShift {
    const weather = weatherClayShiftFromSnapshot(
      this.envSnapshot as Parameters<typeof weatherClayShiftFromSnapshot>[0],
      baseHue,
    );
    const hourly = hourClayShiftFromHour(this.envHour);
    // 色相は共通関数のものをそのまま使い、彩度・明度だけ volume 用に差し替える
    // （VOLUME_ENV_TONE の説明。色相では天気も時刻も伝わらないと実測で確定している）。
    const tone = combineClayShifts(
      volumeWeatherTone(this.envSnapshot),
      volumeHourTone(this.envHour),
    );
    return { hue: weather.hue + hourly.hue, sat: tone.sat, light: tone.light };
  }

  evolveSongColors(profile: AudioProfileSummary | null, deltaTime: number) {
    // パレット導出は毎フレーム回すほど軽くないので 0.5 秒ごと。
    // 色はゆっくり動くので、この粒度で見た目に段は出ない。
    this.songPaletteTimer += deltaTime;
    if (this.songPaletteTimer < 0.5) {
      return;
    }
    this.songPaletteTimer = 0;
    this.songPalette = profile ? deriveSculpturePalette(profile) : null;
  }

  pokeIdle() {
    this.pushLiveStamp(0, 0, 0, 0.28 + this.mass * 0.3, 0.9, 3);
  }

  getPointerTargets() {
    return [this.mc as unknown as THREE.Object3D];
  }

  pokeSurface(localPoint: THREE.Vector3) {
    const inv = 1 / MESH_SCALE;
    this.pushLiveStamp(
      localPoint.x * inv,
      localPoint.y * inv,
      localPoint.z * inv,
      0.12,
      0.9,
      4,
    );
  }

  holdShapeForCompletion() {
    if (this.completed) return;
    this.shapeHold = true;
  }

  prepareCompletion(palette: SculpturePalette, species?: SpeciesProfile) {
    this.completionPalette = palette;
    if (species) {
      this.completionSpecies = species;
    }
  }

  /**
   * 完成: 蓄積した密度場を高解像度で焼き直す。
   * ここで初めて解像度を上げるので、形成中の負荷は上がらない。
   */
  complete() {
    if (this.completed) return;
    this.completed = true;
    this.shapeHold = false;
    this.completionProgress = 0;
    this.breathTime = 0;
    this.completionStartRoughness = this.material.roughness;
    for (const s of this.liveStamps) s.life = 0;
    for (const h of this.heads) h.active = false;

    // 浮遊する細かい破片を落としてから焼き込む（作品として成立させる）
    this.pruneFragments();
    this.resampleTo(FINAL_RES);
    // ここには以前 `mc.blur(0.6)` があった（「堆積の階段状のむらを取る。形の骨格は残る」）。
    // **骨格は残っていなかった。** 2026-08-11 の実測（60秒だけ形成して Complete を押し、
    // 完成前後を同じ個体で比較。`complete_ab.js`）:
    //
    //   blur 0.6  : 輪郭の複雑度 11.99 → 4.87（−59%）
    //   blur 0.25 : 12.65 → 6.20（−51%）
    //   blur なし : 10.41 → 11.33（保たれる）
    //
    // 演奏中は複雑な形をしているのに完成した瞬間に滑らかな塊になる、という現象の主因。
    // 破片の除去（pruneFragments）ではなくこのぼかしだった。
    // 値を下げても半減するので段階調整では解決せず、外した。
    // 外して出るはずだった「階段状のむら」は、72³ への載せ替えと MarchingCubes の
    // 法線で十分滑らかになっており、画像で確認しても粗は出ていない。
    this.group.scale.set(1, 1, 1);
    this.dirty = true;
  }

  /**
   * 等値面の連結成分を数え、小さすぎる塊を消す。
   * 意図的に分離した大きな塊は残し、堆積の取りこぼしで出た粒だけを落とす。
   */
  private pruneFragments() {
    const res = this.res;
    const res2 = res * res;
    const d = this.density;
    const total = d.length;
    const label = new Int32Array(total).fill(-1);
    const stack = new Int32Array(total);
    const sizes: number[] = [];

    for (let start = 0; start < total; start += 1) {
      if (label[start] !== -1 || d[start] <= ISO) continue;
      const id = sizes.length;
      let sp = 0;
      stack[sp++] = start;
      label[start] = id;
      let count = 0;
      while (sp > 0) {
        const q = stack[--sp];
        count += 1;
        const x = q % res;
        const y = Math.floor(q / res) % res;
        const z = (q / res2) | 0;
        if (x > 0) { const k = q - 1; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
        if (x < res - 1) { const k = q + 1; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
        if (y > 0) { const k = q - res; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
        if (y < res - 1) { const k = q + res; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
        if (z > 0) { const k = q - res2; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
        if (z < res - 1) { const k = q + res2; if (label[k] === -1 && d[k] > ISO) { label[k] = id; stack[sp++] = k; } }
      }
      sizes.push(count);
    }

    if (sizes.length <= 1) return;
    let largest = 0;
    for (const s of sizes) if (s > largest) largest = s;
    // 最大の塊の 4% 未満は破片とみなして落とす
    const minSize = Math.max(24, largest * 0.04);
    for (let i = 0; i < total; i += 1) {
      const id = label[i];
      if (id >= 0 && sizes[id] < minSize) {
        d[i] = 0;
      }
    }
  }

  /** 密度場を別解像度へ三線形で載せ替える */
  private resampleTo(nextRes: number) {
    if (nextRes === this.res) return;
    const src = this.density;
    const srcRes = this.res;
    const srcRes2 = srcRes * srcRes;
    const dst = new Float32Array(nextRes * nextRes * nextRes);
    const nextRes2 = nextRes * nextRes;
    const scale = (srcRes - 1) / (nextRes - 1);

    for (let z = 0; z < nextRes; z += 1) {
      const sz = z * scale;
      const z0 = Math.min(srcRes - 1, Math.floor(sz));
      const z1 = Math.min(srcRes - 1, z0 + 1);
      const tz = sz - z0;
      for (let y = 0; y < nextRes; y += 1) {
        const sy = y * scale;
        const y0 = Math.min(srcRes - 1, Math.floor(sy));
        const y1 = Math.min(srcRes - 1, y0 + 1);
        const ty = sy - y0;
        for (let x = 0; x < nextRes; x += 1) {
          const sx = x * scale;
          const x0 = Math.min(srcRes - 1, Math.floor(sx));
          const x1 = Math.min(srcRes - 1, x0 + 1);
          const tx = sx - x0;

          const c000 = src[z0 * srcRes2 + y0 * srcRes + x0];
          const c100 = src[z0 * srcRes2 + y0 * srcRes + x1];
          const c010 = src[z0 * srcRes2 + y1 * srcRes + x0];
          const c110 = src[z0 * srcRes2 + y1 * srcRes + x1];
          const c001 = src[z1 * srcRes2 + y0 * srcRes + x0];
          const c101 = src[z1 * srcRes2 + y0 * srcRes + x1];
          const c011 = src[z1 * srcRes2 + y1 * srcRes + x0];
          const c111 = src[z1 * srcRes2 + y1 * srcRes + x1];

          const c00 = c000 + (c100 - c000) * tx;
          const c10 = c010 + (c110 - c010) * tx;
          const c01 = c001 + (c101 - c001) * tx;
          const c11 = c011 + (c111 - c011) * tx;
          const c0 = c00 + (c10 - c00) * ty;
          const c1 = c01 + (c11 - c01) * ty;

          dst[z * nextRes2 + y * nextRes + x] = c0 + (c1 - c0) * tz;
        }
      }
    }

    this.density = dst;
    this.res = nextRes;
    this.mc.init(nextRes);
    this.mc.isolation = ISO;
  }

  reset(seed = 1) {
    this.seed = seed;
    this.time = 0;
    this.mass = 0;
    this.energy = 0;
    this.calm = 0;
    this.completed = false;
    this.shapeHold = false;
    this.completionProgress = 0;
    this.breathTime = 0;
    this.idleTime = 0;
    this.headSpawnCooldown = 0;
    this.carveCooldown = 0;
    this.flashLife.fill(0);
    this.flashPoints.visible = false;
    this.flashDirty = true;
    this.fillRatio = 0;
    this.fillCheckCooldown = 0;
    this.growthBudget = 1;
    this.lastKickIndex = -1;
    this.lastSnareIndex = -1;
    this.lastMelodyPulse = 0;
    this.completionPalette = null;
    this.songPalette = null;
    this.songPaletteTimer = 0;
    this.completionSpecies = null;

    if (this.res !== LIVE_RES) {
      this.res = LIVE_RES;
      this.mc.init(LIVE_RES);
      this.mc.isolation = ISO;
      this.density = new Float32Array(LIVE_RES * LIVE_RES * LIVE_RES);
    } else {
      this.density.fill(0);
    }

    for (const h of this.heads) h.active = false;
    for (const s of this.liveStamps) s.life = 0;

    this.material.clearcoat = 1e-4;
    this.material.sheen = 1e-4;
    this.material.iridescence = 1e-4;
    this.material.roughness = 0.86;
    this.completionStartRoughness = 0.86;

    // 種（芽）を置く。ここが唯一の初期形で、あとは音だけが形を決める
    this.stamp(this.density, 0, 0, 0, 0.14, 2.2);
    for (let i = 0; i < 3; i += 1) {
      this.spawnFromCore(0.1, 0);
    }
    this.group.scale.set(1, 1, 1);
    this.dirty = true;
    this.rebuildField(1 / 60);
  }

  createExportGroup() {
    const g = new THREE.Group();
    g.name = "Volume Sculpture";
    g.rotation.copy(this.group.rotation);

    // 描画中のバッファから、実際に使われている範囲だけを切り出す
    const src = this.mc.geometry;
    const count = this.mc.count;
    const position = src.getAttribute("position") as THREE.BufferAttribute;
    const normal = src.getAttribute("normal") as THREE.BufferAttribute;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute((position.array as Float32Array).slice(0, count * 3), 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute((normal.array as Float32Array).slice(0, count * 3), 3),
    );
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material.clone());
    mesh.name = "Volume sculpture surface";
    mesh.scale.setScalar(MESH_SCALE);
    g.add(mesh);
    return g;
  }
}
