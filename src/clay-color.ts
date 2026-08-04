import { clamp01 } from "./sculpture-types";
import type { LiveWeatherSnapshot } from "./live-weather";

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

export const combineClayShifts = (a: ClayColorShift, b: ClayColorShift): ClayColorShift => ({
  hue: a.hue + b.hue,
  sat: a.sat + b.sat,
  light: a.light + b.light,
});

/** 色相を最短経路で補間（0〜1） */
export const lerpHueShortest = (from: number, to: number, t: number) => {
  let d = to - from;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return ((from + d * t) % 1 + 1) % 1;
};

const shortestHueDelta = (from: number, to: number) => {
  let d = to - from;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
};

/** 暖色側（黄→オレンジ）へ寄せる。青系から shortest だと紫経由になるのを避ける */
const warmHueDelta = (from: number, to: number) => {
  // 寒色（青〜シアン帯）から暖色へは、緑→黄経由の負方向を使う
  if (from > 0.4 && to < 0.22) {
    let d = to - from;
    if (d > 0) d -= 1;
    return d;
  }
  return shortestHueDelta(from, to);
};

/**
 * 天気に応じて粘土（内側含む）の色味をずらす。
 * 晴れ=オレンジ / 雨=水色 / 曇り=緑 / 雷=黄 / 雪=白寄り（やりすぎず、変化は分かる程度）
 */
export const weatherClayShiftFromSnapshot = (
  snapshot: LiveWeatherSnapshot | null,
  baseHue = 0.62,
): ClayColorShift => {
  if (!snapshot) {
    return createClayColorShift();
  }
  const cloud = clamp01(snapshot.cloudCover);
  const rain = clamp01(snapshot.rainIntensity);
  const lightning = clamp01(snapshot.lightningIntensity);

  // 目標色相（HSL）と、彩度・明度の押し
  let targetHue = baseHue;
  let satPush = 0;
  let lightPush = 0;
  let pull = 0.32; // 基準色から目標へ寄せる強さ（0〜1）

  switch (snapshot.condition) {
    case "clear":
      // 膜（青系）越しでオレンジに見えるよう、素は黄寄りアンバー＋彩度強め
      targetHue = 0.01;
      satPush = 0.18;
      lightPush = 0.02;
      pull = 0.32;
      break;
    case "cloudy":
      targetHue = 0.34; // 緑
      satPush = 0.06;
      lightPush = 0.01;
      pull = 0.3;
      break;
    case "overcast":
      targetHue = 0.33;
      satPush = 0.04;
      lightPush = -0.03;
      pull = 0.28;
      break;
    case "fog":
      targetHue = 0.5;
      satPush = -0.1;
      lightPush = 0.07;
      pull = 0.22;
      break;
    case "rain":
      targetHue = 0.55; // 水色
      satPush = 0.08;
      lightPush = 0.03;
      pull = 0.36;
      break;
    case "snow":
      // 白寄り: 色相はほぼ据え置き、彩度を落として明るく
      targetHue = baseHue;
      satPush = -0.2;
      lightPush = 0.14;
      pull = 0.08;
      break;
    case "thunder":
    case "thunderstorm":
      targetHue = 0.145; // 黄
      satPush = 0.12;
      lightPush = 0.04;
      pull = 0.38;
      break;
    default:
      break;
  }

  // 雲量・雨・雷で効きを連続に（やりすぎ防止の上限つき）
  const amt =
    snapshot.condition === "clear"
      ? clamp01(0.55 + (1 - cloud) * 0.45)
      : clamp01(0.45 + cloud * 0.3 + rain * 0.35 + lightning * 0.3);
  const blend = clamp01(pull * amt);
  const hueDelta =
    snapshot.condition === "clear" ||
    snapshot.condition === "thunder" ||
    snapshot.condition === "thunderstorm"
      ? warmHueDelta(baseHue, targetHue)
      : shortestHueDelta(baseHue, targetHue);

  return {
    hue: hueDelta * blend,
    sat: satPush * amt,
    light: lightPush * amt,
  };
};

/**
 * 時刻に応じて粘土の色味をずらす（キーフレーム間を分単位で線形補間）。
 * 深夜〜早朝: 冷たく暗め / 昼: 明るめ / 15–18: 薄い暖色（夕） / 夜へ徐々に冷たく
 */
export const hourClayShiftFromHour = (hour: number): ClayColorShift => {
  const h = ((hour % 24) + 24) % 24;
  type Key = { h: number; hue: number; sat: number; light: number };
  const keys: Key[] = [
    { h: 0, hue: 0.045, sat: -0.05, light: -0.09 },
    { h: 3, hue: 0.045, sat: -0.05, light: -0.1 },
    { h: 4, hue: 0.03, sat: -0.02, light: -0.04 },
    { h: 8, hue: 0.01, sat: 0.02, light: 0.02 },
    { h: 11, hue: 0.005, sat: 0.03, light: 0.04 },
    { h: 12, hue: -0.005, sat: 0.045, light: 0.055 },
    { h: 15, hue: 0, sat: 0.04, light: 0.05 },
    // 夕: 粘土に薄い暖色（背景の海水赤みと揃える帯）
    { h: 16.75, hue: -0.045, sat: 0.07, light: 0.02 },
    { h: 18, hue: 0.015, sat: 0.01, light: -0.025 },
    { h: 21, hue: 0.04, sat: -0.035, light: -0.07 },
    { h: 24, hue: 0.045, sat: -0.05, light: -0.09 },
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
    hue: a.hue + (b.hue - a.hue) * t,
    sat: a.sat + (b.sat - a.sat) * t,
    light: a.light + (b.light - a.light) * t,
  };
};

/**
 * 天気 + 時刻を合成した粘土色シフト
 */
export const envClayShiftFromWeatherAndHour = (
  snapshot: LiveWeatherSnapshot | null,
  hour: number,
  baseHue = 0.62,
): ClayColorShift =>
  combineClayShifts(weatherClayShiftFromSnapshot(snapshot, baseHue), hourClayShiftFromHour(hour));

/** クリック毎に色相をずらす（少しずつだが変化は分かる幅） */
export const nudgeClayColorShift = (shift: ClayColorShift): ClayColorShift => {
  let hueDelta = (Math.random() - 0.5) * 0.22;
  if (Math.abs(hueDelta) < 0.055) {
    hueDelta = (hueDelta >= 0 ? 1 : -1) * 0.055;
  }
  return {
    hue: shift.hue + hueDelta,
    sat: shift.sat + (Math.random() - 0.5) * 0.09,
    light: shift.light + (Math.random() - 0.5) * 0.07,
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
