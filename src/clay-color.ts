import { clamp01 } from "./sculpture-types";

/** クリックで累積する色相シフト — スタイル基準への加算のみ */
export type ClayColorShift = {
  hue: number;
  sat: number;
  light: number;
};

/** 粘土色の単一基準（スタイル core から供給） */
export type ClayColorStyle = {
  hueBase: number;
  hslSatBase: number;
  hslLightBase: number;
  pearlVariation: number;
};

export type ClayPalette = {
  hue: number;
  sat: number;
  light: number;
  surfaceHex: number;
  innerHex: number;
};

/** carve 等の固定粘土スタイル（変容スタイルと同じ基準） */
export const METAMORPHOSIS_CLAY_STYLE: ClayColorStyle = {
  hueBase: 0.09,
  hslSatBase: 0.18,
  hslLightBase: 0.78,
  pearlVariation: 0,
};

export const createClayColorShift = (): ClayColorShift => ({ hue: 0, sat: 0, light: 0 });

/** クリック毎に色相をずらす（最低でもわずかに変化が見えるよう下限あり） */
export const nudgeClayColorShift = (shift: ClayColorShift): ClayColorShift => {
  let hueDelta = (Math.random() - 0.5) * 0.1;
  if (Math.abs(hueDelta) < 0.032) {
    hueDelta = (hueDelta >= 0 ? 1 : -1) * 0.032;
  }
  return {
    hue: shift.hue + hueDelta,
    sat: shift.sat + (Math.random() - 0.5) * 0.045,
    light: shift.light + (Math.random() - 0.5) * 0.034,
  };
};

const hslToHex = (h: number, s: number, l: number) => {
  if (s <= 0) {
    const gray = Math.round(l * 255);
    return (gray << 16) | (gray << 8) | gray;
  }
  const hue = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let channel = t;
    if (channel < 0) {
      channel += 1;
    }
    if (channel > 1) {
      channel -= 1;
    }
    if (channel < 1 / 6) {
      return p + (q - p) * 6 * channel;
    }
    if (channel < 1 / 2) {
      return q;
    }
    if (channel < 2 / 3) {
      return p + (q - p) * (2 / 3 - channel) * 6;
    }
    return p;
  };
  const r = Math.round(hueToRgb(hue + 1 / 3) * 255);
  const g = Math.round(hueToRgb(hue) * 255);
  const b = Math.round(hueToRgb(hue - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
};

/** 外側・内側・膜・頂点カラーが共有する単一パレット */
export const resolveClayPalette = (style: ClayColorStyle, shift: ClayColorShift): ClayPalette => {
  const hue = (style.hueBase + shift.hue + 1) % 1;
  const sat = clamp01(style.hslSatBase + shift.sat);
  const light = clamp01(style.hslLightBase + shift.light);
  const innerLight = clamp01(light - 0.06);
  return {
    hue,
    sat,
    light,
    surfaceHex: hslToHex(hue, sat, light),
    innerHex: hslToHex(hue, clamp01(sat * 0.96), innerLight),
  };
};

export const clayStyleFromVisualCore = (core: {
  hueBase: number;
  hslSatBase: number;
  hslLightBase: number;
  pearlVariation: number;
}): ClayColorStyle => ({
  hueBase: core.hueBase,
  hslSatBase: core.hslSatBase,
  hslLightBase: core.hslLightBase,
  pearlVariation: core.pearlVariation,
});
