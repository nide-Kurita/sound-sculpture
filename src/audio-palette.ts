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
  brightness: number;
  contrast: number;
  centroid: number;
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
  const variation = hasSignal ? profile.variation : 0.1;
  const attackRate = hasSignal ? profile.attackRate : 0.5;
  const loudRatio = hasSignal ? profile.loudRatio : 0.05;
  const overallAverage = hasSignal ? profile.overallAverage : 0.2;

  const spectralT = smoothstep(0.12, 0.6, centroid);
  const pos = spectralT * (HUE_STOPS.length - 1);
  const seg = Math.min(HUE_STOPS.length - 2, Math.floor(pos));
  const hue = wrapHue(
    lerp(HUE_STOPS[seg], HUE_STOPS[seg + 1], pos - seg) -
      bassDominance * 0.035 +
      variation * 0.04,
  );

  const saturation = clampRange(0.24 + contrast * 1.05 + variation * 0.7, 0.22, 0.85);
  const lightness = clampRange(0.34 + brightness * 0.55 + loudRatio * 0.12, 0.3, 0.72);
  const roughness = clampRange(
    0.74 - brightness * 0.5 + bassDominance * 0.18 - Math.min(0.2, attackRate * 0.02),
    0.16,
    0.92,
  );
  const metalness = clampRange(
    bassDominance * 0.85 + contrast * 0.25 - brightness * 0.3,
    0.02,
    0.92,
  );
  const emissiveStrength = clampRange(
    0.18 + brightness * 0.85 + loudRatio * 0.55 + overallAverage * 0.3,
    0.15,
    1,
  );
  const energy = clamp01(overallAverage * 1.4 + loudRatio * 0.9);

  const baseColor = new THREE.Color().setHSL(hue, saturation, lightness);
  const accentColor = new THREE.Color().setHSL(
    wrapHue(hue + 0.09 + brightness * 0.08),
    Math.min(0.95, saturation * 1.15),
    Math.min(0.75, lightness + 0.14),
  );
  const emissiveColor = new THREE.Color().setHSL(
    wrapHue(hue - 0.05),
    Math.min(0.9, saturation * 1.1),
    0.5,
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
