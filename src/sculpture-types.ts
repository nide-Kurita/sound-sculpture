import type * as THREE from "three";
import type { StructureSnapshot } from "./structure-tracker";
import type { SpeciesProfile } from "./species-profile";
import type { SculpturePalette } from "./audio-palette";

export type SculptureMode = "classic" | "carve" | "amoeba";

export type AudioBands = {
  /** サブ低域 (キック胴・フロアタム) 30–120 Hz */
  sub: number;
  /** 低域 (キック箱鳴り・スネア太さ) 120–400 Hz */
  low: number;
  /** 中域 (ドラムボディ・ハイハット胴) 400–2000 Hz */
  mid: number;
  /** メロディ中域 (ボーカル・主旋律) 700–1500 Hz */
  melody: number;
  /** 高域 (アタック 2–6 kHz + 輝き・空気感 5–18 kHz) */
  high: number;
  overall: number;
  centroid: number;
  bassFocus: number;
  /** melody / 全帯域 — 主旋律の存在感 */
  melodyFocus: number;
  brightness: number;
  contrast: number;
};

export type RhythmEvents = {
  kick: number;
  snare: number;
  hat: number;
  /** シンバル・大きな波形スパイクなどの瞬間反応 */
  transient: number;
  beat: number;
  beatIndex: number;
  kickIndex: number;
  snareIndex: number;
  hatIndex: number;
  transientIndex: number;
  downbeat: boolean;
  /** 推定テンポ (BPM)。ビートが検出できない間は直近値を維持。 */
  bpm: number;
  /** IOIベースの拍位相 0–1 */
  pulsePhase: number;
  /** 直近パルス間隔の安定度 */
  pulseConfidence: number;
  /** 減衰するパルスエンベロープ */
  pulseEnvelope: number;
  /** kick/transient 等で記録された離散パルス回数 */
  pulseIndex: number;
  /** オシロ表示用 */
  subLevel: number;
  wavePeak: number;
  waveEnergy: number;
};

export type SculptureExperience = {
  readonly group: THREE.Group;
  update(
    bands: AudioBands,
    deltaTime: number,
    userViewInteracting?: boolean,
    rhythm?: RhythmEvents,
    structure?: StructureSnapshot,
    species?: SpeciesProfile,
  ): void;
  applyLiveTuningNow(): void;
  /** 完成直前に、録音音声から導出したパレットと種プロファイルを渡す（対応するモードのみ） */
  prepareCompletion?(palette: SculpturePalette, species?: SpeciesProfile): void;
  /** vita 等: 無音時のタッチ反応（クリックでホヨッと動く） */
  pokeIdle?(): void;
  /** クリック位置で表面が少し反発する（完成後も有効） */
  getPointerTargets?(): THREE.Object3D[];
  pokeSurface?(localPoint: THREE.Vector3): void;
  /** クリック毎に粘土色を少しずらす（全モード共通の色条件） */
  nudgeClayColorOnClick?(): void;
  /** 成長アルゴリズム切替時にシルエット偏りを更新 */
  applyAlgoMorphBias?(): void;
  complete(): void;
  /** 同じ音源再現用。渡されていれば形態シードとして使う実装もある */
  reset(seed?: number): void;
  createExportGroup(): THREE.Group;
};

export const SILENCE_THRESHOLD = 0.025;
/** マイク等の無音判定で完成するまでの秒数 */
export const SILENCE_SECONDS_TO_COMPLETE = 2.4;
/** バッファ音源の再生終了後、形が変わらないうちに完成させる秒数 */
export const PLAYBACK_ENDED_SECONDS_TO_COMPLETE = 0.08;

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

export const seededUnit = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export const vertexPattern = (x: number, y: number, z: number, salt: number) => {
  const wave =
    Math.sin(x * 5.13 + y * 1.37 + salt) +
    Math.sin(y * 4.21 - z * 2.31 + salt * 1.7) +
    Math.sin(z * 6.17 + x * 2.91 - salt * 0.6);
  return wave / 3;
};

/** 軽量ポテンシャル（curl 用）。品質より速度優先の 2 項版 */
const curlPotential = (x: number, y: number, z: number, salt: number) =>
  Math.sin(x * 5.13 + y * 1.37 + salt) * 0.62 + Math.sin(y * 4.21 - z * 2.31 + salt * 1.7) * 0.38;

/**
 * 有限差分 curl。呼び出し側は out を再利用すること（毎回 new しない）。
 */
export const curlNoiseSample = (
  x: number,
  y: number,
  z: number,
  salt: number,
  out: { x: number; y: number; z: number },
) => {
  const eps = 0.42;
  const invDouble = 1 / (2 * eps);
  const sB = salt + 7.13;
  const sC = salt + 13.71;

  const Pa_yp = curlPotential(x, y + eps, z, salt);
  const Pa_yn = curlPotential(x, y - eps, z, salt);
  const Pa_zp = curlPotential(x, y, z + eps, salt);
  const Pa_zn = curlPotential(x, y, z - eps, salt);
  const Pb_xp = curlPotential(x + eps, y, z, sB);
  const Pb_xn = curlPotential(x - eps, y, z, sB);
  const Pb_zp = curlPotential(x, y, z + eps, sB);
  const Pb_zn = curlPotential(x, y, z - eps, sB);
  const Pc_xp = curlPotential(x + eps, y, z, sC);
  const Pc_xn = curlPotential(x - eps, y, z, sC);
  const Pc_yp = curlPotential(x, y + eps, z, sC);
  const Pc_yn = curlPotential(x, y - eps, z, sC);

  out.x = (Pc_yp - Pc_yn - (Pb_zp - Pb_zn)) * invDouble;
  out.y = (Pa_zp - Pa_zn - (Pc_xp - Pc_xn)) * invDouble;
  out.z = (Pb_xp - Pb_xn - (Pa_yp - Pa_yn)) * invDouble;
};

/** @deprecated `parseExperienceId`（visual-style）へ統合。互換のため残す */
export const parseSculptureMode = (): SculptureMode => {
  const style = new URLSearchParams(window.location.search).get("style");
  if (style === "carve") return "carve";
  if (style === "amoeba") return "amoeba";
  const param = new URLSearchParams(window.location.search).get("mode");
  if (param === "carve") return "carve";
  if (param === "amoeba") return "amoeba";
  return "classic";
};
