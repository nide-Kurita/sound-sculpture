/**
 * 現地時刻から空の色を求める。
 * 太陽光らしい経路のみを通す（青 → 白っぽい大気 → 琥珀 → 藍）。
 * 緑・ピンクの色相はキーに含めず、補間も隣接キー間の RGB のみ。
 */

export type DaytimeAtmosphere = {
  /** シーン背景・フォグ用の中間色 */
  forming: number;
  complete: number;
  /** 天頂（ドーム上部） */
  zenith: number;
  /** 地平（ドーム下部） */
  horizon: number;
  /** UI をダークテーマにするか */
  dark: boolean;
  hour: number;
};

type DaytimeKey = {
  hour: number;
  /** 天頂 */
  zenith: number;
  /** 地平線付近 */
  horizon: number;
};

/**
 * 自然光の空。朝日は地平が暖色・天頂が冷色、
 * 正午は全体が明るく、夕暮れは地平が琥珀で天頂が沈む藍。
 */
const DAYTIME_KEYS: DaytimeKey[] = [
  // 真夜中
  { hour: 0, zenith: 0x05070c, horizon: 0x080a12 },
  { hour: 4.8, zenith: 0x0a1018, horizon: 0x10141c },
  // 朝日 — 地平に朝焼け、上はまだ冷たい青
  { hour: 6.0, zenith: 0x1c2a3c, horizon: 0x5a4838 },
  { hour: 6.7, zenith: 0x3a5878, horizon: 0xd4a878 },
  { hour: 7.5, zenith: 0x6a90b0, horizon: 0xe0c8a8 },
  // 朝〜午前 — 澄んだ青空
  { hour: 9.0, zenith: 0x88a8c4, horizon: 0xd8d0c4 },
  { hour: 10.5, zenith: 0x9cb4cc, horizon: 0xe4ded4 },
  // 正午 — 明るく白い大気
  { hour: 12.0, zenith: 0xb8cce0, horizon: 0xeceae4 },
  { hour: 14.0, zenith: 0xa8bcc8, horizon: 0xe4ddd0 },
  // 夕暮れ — 地平が琥珀、天頂は落ち着いた青灰
  { hour: 16.5, zenith: 0x6a7e98, horizon: 0xe8b888 },
  { hour: 17.8, zenith: 0x3e4e68, horizon: 0xd88848 },
  { hour: 18.8, zenith: 0x242c3c, horizon: 0x8a5a38 },
  // 宵〜夜 — 藍へ沈む（赤紫は使わない）
  { hour: 20.0, zenith: 0x10141c, horizon: 0x1a1e28 },
  { hour: 24.0, zenith: 0x05070c, horizon: 0x080a12 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpChannel = (a: number, b: number, t: number) => Math.round(lerp(a, b, t));

/** 隣接キーは近い色同士なので RGB 直補間で十分（長距離の青↔橙はキーで分割済み） */
const lerpHex = (from: number, to: number, t: number) => {
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  return (
    (lerpChannel(fr, tr, t) << 16) |
    (lerpChannel(fg, tg, t) << 8) |
    lerpChannel(fb, tb, t)
  );
};

const mixHex = (a: number, b: number, t: number) => lerpHex(a, b, t);

const softenComplete = (hex: number) => {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (
    (Math.round(r * 0.92) << 16) |
    (Math.round(g * 0.93) << 8) |
    Math.round(b * 0.94)
  );
};

/** sRGB 相対輝度（WCAG） */
export const relativeLuminance = (hex: number) => {
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear((hex >> 16) & 0xff);
  const g = toLinear((hex >> 8) & 0xff);
  const b = toLinear(hex & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** 背景が暗く、明るい文字の方が読みやすいとき true */
export const shouldUseDarkUi = (backgroundHex: number) =>
  relativeLuminance(backgroundHex) < 0.42;

export const getLocalHourFraction = (date = new Date()) =>
  date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

export const dateFromHourFraction = (hourFraction: number, base = new Date()) => {
  const wrapped = ((hourFraction % 24) + 24) % 24;
  const hours = Math.floor(wrapped);
  const minutesFloat = (wrapped - hours) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60);
  const date = new Date(base);
  date.setHours(hours, minutes, seconds, 0);
  return date;
};

export const sampleDaytimeAtmosphereFromHour = (hour: number): DaytimeAtmosphere => {
  const wrapped = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < DAYTIME_KEYS.length - 1 && DAYTIME_KEYS[i + 1].hour < wrapped) {
    i += 1;
  }
  const a = DAYTIME_KEYS[i];
  const b = DAYTIME_KEYS[Math.min(i + 1, DAYTIME_KEYS.length - 1)];
  const span = Math.max(1e-6, b.hour - a.hour);
  const t = Math.min(1, Math.max(0, (wrapped - a.hour) / span));
  const eased = t * t * (3 - 2 * t);

  const zenith = lerpHex(a.zenith, b.zenith, eased);
  const horizon = lerpHex(a.horizon, b.horizon, eased);
  // シーン全体色は天頂寄り（空の印象）に地平を少し混ぜる
  const forming = mixHex(zenith, horizon, 0.28);

  return {
    forming,
    complete: softenComplete(forming),
    zenith,
    horizon,
    dark: shouldUseDarkUi(forming),
    hour: wrapped,
  };
};

export const sampleDaytimeAtmosphere = (date = new Date()): DaytimeAtmosphere =>
  sampleDaytimeAtmosphereFromHour(getLocalHourFraction(date));

export const formatAmPmFromHour = (hourFraction: number) => {
  const wrapped = ((hourFraction % 24) + 24) % 24;
  const minutes = Math.floor((wrapped % 1) * 60);
  let hours = Math.floor(wrapped);
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) {
    hours = 12;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`;
};

export const formatLocalAmPm = (date = new Date()) =>
  formatAmPmFromHour(getLocalHourFraction(date));

export const DAYTIME_BACKGROUND_STORAGE_KEY = "sound-sculpture:daytime-background";

export const readDaytimeBackgroundEnabled = () => {
  try {
    return window.localStorage.getItem(DAYTIME_BACKGROUND_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeDaytimeBackgroundEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(DAYTIME_BACKGROUND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};
