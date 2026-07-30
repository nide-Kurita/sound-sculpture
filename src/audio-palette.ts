import * as THREE from "three";
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
 * スペクトル重心 (低→高) を色相の旅程に写像する。
 * 琥珀 → 金 → 苔 → 翡翠 → 青 → 菫
 */
const HUE_STOPS = [0.05, 0.1, 0.24, 0.46, 0.58, 0.72];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampRange = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const wrapHue = (hue: number) => ((hue % 1) + 1) % 1;

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
  const variation = hasSignal ? profile.variation : 0.1;
  const attackRate = hasSignal ? profile.attackRate : 0.5;
  const loudRatio = hasSignal ? profile.loudRatio : 0.05;
  const overallAverage = hasSignal ? profile.overallAverage : 0.2;
  const quietRatio = hasSignal ? profile.quietRatio : 0.2;

  // 質感の硬柔: bass 単独では決めない（ジャズ・ベースが金属化するため）
  const loudHard = smoothstep(0.7, 0.96, loudRatio);
  const softDyn = clamp01(
    sectionContrast * 0.42 +
      variation * 0.38 +
      melodyFocus * 0.36 +
      quietRatio * 0.22 +
      (1 - loudHard) * 0.28 -
      brightness * 0.08,
  );
  const hardMat = clamp01(
    loudHard * 0.52 +
      smoothstep(0.1, 0.22, brightness) * 0.28 +
      contrast * 0.14 +
      smoothstep(5, 13, attackRate) * 0.12 -
      softDyn * 0.4,
  );

  const spectralColor = clamp01(
    centroid * 0.3 +
      brightness * 0.24 +
      highRatio * 0.22 +
      midRatio * 0.12 +
      melodyFocus * 0.32 +
      sectionContrast * 0.22 -
      softDyn * 0.12 -
      bassDominance * 0.06 +
      variation * 0.1,
  );
  const spectralT = smoothstep(0.04, 0.58, spectralColor);
  const pos = spectralT * (HUE_STOPS.length - 1);
  const seg = Math.min(HUE_STOPS.length - 2, Math.floor(pos));
  // soft → 暖色寄り（既に暖色帯なら追加引きを弱め、wrap で菫へ飛ばないようにする）
  const warmPull =
    (softDyn * 0.1 + (1 - loudHard) * 0.03) * smoothstep(0.18, 0.55, spectralT);
  const hue = wrapHue(
    lerp(HUE_STOPS[seg], HUE_STOPS[seg + 1], pos - seg) -
      warmPull -
      bassDominance * 0.015 +
      hardMat * 0.06 +
      variation * 0.025 +
      melodyFocus * 0.02,
  );

  const saturation = clampRange(
    0.26 + contrast * 0.55 + softDyn * 0.32 + variation * 0.28 - hardMat * 0.14,
    0.18,
    0.92,
  );
  const lightness = clampRange(
    0.34 + brightness * 0.38 + softDyn * 0.1 + loudHard * 0.08 + melodyFocus * 0.06,
    0.28,
    0.76,
  );
  // soft: マット／有機、hard: 滑らかな鉱物
  const roughness = clampRange(
    0.38 + softDyn * 0.42 + (1 - hardMat) * 0.22 - brightness * 0.18 - loudHard * 0.16,
    0.14,
    0.92,
  );
  // soft: 低金属、hard: 高金属（bass は補助のみ）
  const metalness = clampRange(
    0.06 + hardMat * 0.72 + contrast * 0.08 + bassDominance * 0.08 - softDyn * 0.38 - melodyFocus * 0.12,
    0.02,
    0.9,
  );
  const emissiveStrength = clampRange(
    0.12 + hardMat * 0.28 + loudRatio * 0.38 + brightness * 0.42 + overallAverage * 0.16 + sectionContrast * 0.12,
    0.12,
    1,
  );
  const energy = clamp01(overallAverage * 1.2 + loudRatio * 0.85 + hardMat * 0.25);

  const baseColor = new THREE.Color().setHSL(hue, saturation, lightness);
  const accentColor = new THREE.Color().setHSL(
    wrapHue(hue + 0.08 + brightness * 0.06 + hardMat * 0.03),
    Math.min(0.95, saturation * (1.08 + softDyn * 0.08)),
    Math.min(0.75, lightness + 0.12 + softDyn * 0.04),
  );
  const emissiveColor = new THREE.Color().setHSL(
    wrapHue(hue - 0.04 + hardMat * 0.03),
    Math.min(0.9, saturation * 1.08),
    clampRange(0.42 + hardMat * 0.12, 0.35, 0.62),
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
    roughnessMul: 1 + o * 0.22 - a * 0.12,
    metalnessMul: 1 + a * 0.35 - o * 0.15,
    emissiveMul: 1 + o * 0.25 - a * 0.08,
    saturationMul: 1 + o * 0.18 - a * 0.1,
    breathAmp: 1 + o * 0.3 + r * 0.2,
    clearcoatMul: 1 + a * 0.4,
    petrifyBoost: 1 + a * 0.15,
  };
};
