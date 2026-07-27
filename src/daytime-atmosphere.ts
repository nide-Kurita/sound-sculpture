/**
 * 緯度・経度・日付から太陽／月の位置を求め、色温度・光量・空色へ変換する。
 * 季節・地域で日の出・日没が変わる（例: 日本の夏は 4 時台から明るくなる）。
 *
 * 色温度が低いほど暖色、高いほど寒色。朝焼け・夕焼けは淡いオレンジに抑え、
 * 正午は高 Kelvin・高光量。夜は月明かりの角度を使う。
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
  /** 太陽光色温度 K */
  kelvin: number;
  /** 太陽光量 0..1（正午 ≈ 1） */
  lightIntensity: number;
  /** 太陽高度（度）。負は地平下 */
  sunElevationDeg: number;
  /** 太陽方位（度）。北=0、東=90、南=180、西=270 */
  sunAzimuthDeg: number;
  /** キーライトに使う高度（月明かり時は月の高度） */
  lightElevationDeg: number;
  /** キーライトに使う方位 */
  lightAzimuthDeg: number;
  /** true のとき月明かりモード */
  usingMoonlight: boolean;
  /** キーライト色（Kelvin 由来） */
  sunColor: number;
  /** フィル／環境光寄り色 */
  fillColor: number;
  latitude: number;
  longitude: number;
};

export type DaytimeLocation = {
  latitude: number;
  longitude: number;
};

/** 東京（位置未取得時のフォールバック） */
export const DEFAULT_DAYTIME_LOCATION: DaytimeLocation = {
  latitude: 35.6812,
  longitude: 139.7671,
};

type Rgb = { r: number; g: number; b: number };
type CelestialPos = { elevationDeg: number; azimuthDeg: number };

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const denom = edge1 - edge0;
  if (Math.abs(denom) < 1e-9) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / denom);
  return t * t * (3 - 2 * t);
};
const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
const rgbToHex = ({ r, g, b }: Rgb) => (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
});
const scaleRgb = (c: Rgb, s: number): Rgb => ({ r: c.r * s, g: c.g * s, b: c.b * s });

/**
 * Tanner Helland 近似: Kelvin → sRGB（0–255）。
 * @see http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code/
 */
export const kelvinToRgb = (kelvin: number): Rgb => {
  const temp = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (temp - 60) ** -0.1332047592;
    g = 288.1221695283 * (temp - 60) ** -0.0755148492;
    b = 255;
  }
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
};

export const kelvinToHex = (kelvin: number) => rgbToHex(kelvinToRgb(kelvin));

const softenComplete = (hex: number) => {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (Math.round(r * 0.92) << 16) | (Math.round(g * 0.93) << 8) | Math.round(b * 0.94);
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

export const shouldUseDarkUi = (backgroundHex: number) =>
  relativeLuminance(backgroundHex) < 0.36;

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

const toJulian = (date: Date) => date.getTime() / 86400000 - 0.5 + 2440588;

/** NOAA 近似の太陽位置（高度・方位）。季節・緯度経度を反映する。 */
export const getSunPosition = (
  date: Date,
  latitude: number,
  longitude: number,
): CelestialPos => {
  const lat = latitude * RAD;
  const jc = (toJulian(date) - 2451545) / 36525;
  const geomMeanLong =
    (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const geomMeanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccent = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const sunEqCtr =
    Math.sin(geomMeanAnom * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * geomMeanAnom * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * geomMeanAnom * RAD) * 0.000289;
  const sunTrueLong = geomMeanLong + sunEqCtr;
  const sunAppLong =
    sunTrueLong -
    0.00569 -
    0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD);
  const meanObliq =
    23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD);
  const sunDecl = Math.asin(Math.sin(obliqCorr * RAD) * Math.sin(sunAppLong * RAD));

  const y = Math.tan((obliqCorr * RAD) / 2) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * geomMeanLong * RAD) -
      2 * eccent * Math.sin(geomMeanAnom * RAD) +
      4 * eccent * y * Math.sin(geomMeanAnom * RAD) * Math.cos(2 * geomMeanLong * RAD) -
      0.5 * y * y * Math.sin(4 * geomMeanLong * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * geomMeanAnom * RAD));

  const minutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60000;
  let trueSolarTime = (minutes + eqTime + 4 * longitude) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const ha = hourAngle * RAD;

  const cosZenith =
    Math.sin(lat) * Math.sin(sunDecl) + Math.cos(lat) * Math.cos(sunDecl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  // 大気差の簡易補正
  let elevation = 90 - zenith * DEG;
  if (elevation > -0.575) {
    const te = Math.tan(elevation * RAD);
    elevation += 1.02 / (60 * Math.max(0.1, te + 10.3 / (te + 5.11)));
  }

  const azY = -Math.sin(ha);
  const azX = Math.tan(sunDecl) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha);
  let azimuth = Math.atan2(azY, azX) * DEG;
  if (azimuth < 0) azimuth += 360;

  return { elevationDeg: elevation, azimuthDeg: azimuth };
};

/** 簡易の月位置（夜のキーライト方向用） */
export const getMoonPosition = (
  date: Date,
  latitude: number,
  longitude: number,
): CelestialPos => {
  // 月は太陽より約 13°/日遅れる簡易モデル + 太陽軌道の位相オフセット
  const day = toJulian(date) - 2451545;
  const moonLon = (218.316 + 13.176396 * day) % 360;
  const moonLat = 5.145 * Math.sin(((134.9 + 13.064993 * day) % 360) * RAD);
  const lat = latitude * RAD;
  const decl = Math.asin(
    Math.sin(moonLat * RAD) * Math.cos(lat) +
      Math.cos(moonLat * RAD) * Math.sin(lat) * Math.sin(moonLon * RAD),
  );
  // 太陽と同じ hour angle 系で粗い近似
  const sun = getSunPosition(date, latitude, longitude);
  const phaseShift = ((day % 29.530588) / 29.530588) * 360;
  let azimuth = (sun.azimuthDeg + 180 + phaseShift * 0.35) % 360;
  if (azimuth < 0) azimuth += 360;
  // 高度は太陽の反対側に寄せつつ、日付で上下
  const elev =
    -sun.elevationDeg * 0.55 +
    18 * Math.sin(((day % 27.3) / 27.3) * Math.PI * 2) -
    Math.abs(moonLat) * 0.15;
  return {
    elevationDeg: Math.min(72, Math.max(-40, elev + decl * DEG * 0.15)),
    azimuthDeg: azimuth,
  };
};

/**
 * 太陽高度と朝／夕で Kelvin を決める。
 * 朝4時台・夕日はオレンジを淡く保つ。
 */
const kelvinFromSun = (elevationDeg: number, afterNoon: boolean) => {
  if (elevationDeg < -12) {
    return 4500;
  }
  if (elevationDeg < -4) {
    // 夜明け前（AM4 付近）: オレンジはごく薄く
    return lerp(4500, afterNoon ? 3400 : 4100, smoothstep(-12, -4, elevationDeg));
  }
  if (elevationDeg < 2) {
    const t = smoothstep(-4, 2, elevationDeg);
    return afterNoon ? lerp(3000, 3700, t) : lerp(4100, 4600, t);
  }
  if (elevationDeg < 12) {
    const t = smoothstep(2, 12, elevationDeg);
    return afterNoon ? lerp(3700, 4600, t) : lerp(4600, 5400, t);
  }
  if (elevationDeg < 28) {
    const t = smoothstep(12, 28, elevationDeg);
    return afterNoon ? lerp(4600, 5600, t) : lerp(5400, 6100, t);
  }
  if (elevationDeg < 55) {
    return lerp(5800, 6600, smoothstep(28, 55, elevationDeg));
  }
  return lerp(6600, 7000, smoothstep(55, 78, elevationDeg));
};

const intensityFromSun = (elevationDeg: number) => {
  if (elevationDeg < -14) {
    return 0.12 + smoothstep(-40, -14, elevationDeg) * 0.03;
  }
  // 夜明け前から徐々に上がり、正午で ≈1
  const dawn = smoothstep(-12, 10, elevationDeg);
  const day = smoothstep(10, 58, elevationDeg);
  return lerp(0.14, 0.52, dawn) + day * 0.48;
};

/**
 * 空グラデーション。
 * 夕日は地平〜forming に淡いオレンジをはっきり出し、朝（AM4）はごく薄いピーチ。
 */
const buildSkyFromLight = (
  kelvin: number,
  intensity: number,
  elevationDeg: number,
  afterNoon: boolean,
  usingMoonlight: boolean,
) => {
  const sun = kelvinToRgb(kelvin);
  const warmBias =
    clamp01((4300 - kelvin) / 2400) * (afterNoon ? 0.55 : 0.22) +
    clamp01((16 - elevationDeg) / 30) * (afterNoon ? 0.35 : 0.12);
  // 夜明け前（AM4 付近）も地平だけわずかに立ち上がる
  const preDawn = !afterNoon
    ? smoothstep(-13, -1, elevationDeg) * 0.34
    : 0;
  const dayAmount =
    smoothstep(-11, 24, elevationDeg) * (0.28 + intensity * 0.72) + preDawn;
  // 夕: 高度 26°〜−6° でオレンジ帯（17時台から感じられる）
  const glowWindow = afterNoon
    ? (1 - smoothstep(10, 26, elevationDeg)) * smoothstep(-8, 3, elevationDeg)
    : clamp01(1 - Math.abs(elevationDeg + 1) / 14);
  const duskGlow = afterNoon
    ? glowWindow * (0.45 + 0.55 * clamp01((5200 - kelvin) / 2200))
    : glowWindow * clamp01((4600 - kelvin) / 2600 + 0.25) * 0.35;

  const nightZenith: Rgb = { r: 5, g: 7, b: 14 };
  const nightHorizon: Rgb = { r: 8, g: 10, b: 18 };
  const coolZenith: Rgb = {
    r: lerp(95, 155, clamp01((kelvin - 4500) / 2500)),
    g: lerp(130, 185, clamp01((kelvin - 4500) / 2500)),
    b: lerp(170, 225, clamp01((kelvin - 4500) / 2500)),
  };
  const dayZenith = lerpRgb(coolZenith, sun, 0.08 + warmBias * 0.08);

  // 夕日: わかる淡いオレンジ（茜・深紅は避ける）／朝: 薄いピーチ
  const sunsetHorizon: Rgb = { r: 236, g: 158, b: 108 };
  const sunsetForming: Rgb = { r: 214, g: 142, b: 98 };
  const sunriseHorizon: Rgb = { r: 220, g: 204, b: 192 };
  const glowHorizon = afterNoon ? sunsetHorizon : sunriseHorizon;

  const dayHorizonBase = lerpRgb({ r: 222, g: 218, b: 210 }, sun, 0.18 + warmBias * 0.2);
  const dayHorizon = lerpRgb(
    dayHorizonBase,
    lerpRgb(sun, glowHorizon, afterNoon ? 0.72 : 0.28),
    Math.min(1, duskGlow * (afterNoon ? 1.05 : 0.5) + warmBias * 0.18 + preDawn * 0.65),
  );

  let zenithRgb = scaleRgb(
    lerpRgb(nightZenith, dayZenith, Math.min(1, dayAmount)),
    0.5 + intensity * 0.55,
  );
  // 夕はオレンジを落とさないよう、夜への押し込みを弱める
  const horizonMix = Math.min(
    1,
    dayAmount + duskGlow * (afterNoon ? 0.85 : 0.3) + 0.12 + preDawn,
  );
  const horizonLift =
    duskGlow * (afterNoon ? 0.42 : 0.12) + (afterNoon ? 0.16 : preDawn * 0.25);
  let horizonRgb = scaleRgb(
    lerpRgb(nightHorizon, dayHorizon, horizonMix),
    (afterNoon ? 0.62 : 0.52) + intensity * (afterNoon ? 0.38 : 0.46) + horizonLift,
  );

  if (usingMoonlight) {
    const moon = kelvinToRgb(4500);
    zenithRgb = lerpRgb(nightZenith, moon, 0.07);
    horizonRgb = lerpRgb(nightHorizon, moon, 0.12);
  }

  // 夕は forming（HTML/フォグ背景）にもオレンジを載せる＝画面全体でわかる
  let forming = lerpRgb(
    zenithRgb,
    horizonRgb,
    0.32 + duskGlow * (afterNoon ? 0.42 : 0.12) + preDawn * 0.08,
  );
  if (afterNoon && duskGlow > 0.05) {
    forming = lerpRgb(forming, sunsetForming, duskGlow * 0.72);
    // 暗灰に沈ませない最低明るさ
    const floor: Rgb = { r: 118, g: 78, b: 56 };
    forming = {
      r: Math.max(forming.r, floor.r * duskGlow),
      g: Math.max(forming.g, floor.g * duskGlow),
      b: Math.max(forming.b, floor.b * duskGlow * 0.85),
    };
  }

  const litSun = afterNoon
    ? lerpRgb(sun, { r: 255, g: 196, b: 148 }, 0.28 + duskGlow * 0.25)
    : lerpRgb(sun, { r: 255, g: 248, b: 238 }, 0.42 + preDawn * 0.2);
  const fill = lerpRgb(litSun, { r: 200, g: 215, b: 235 }, 0.32 + intensity * 0.22);

  return {
    zenith: rgbToHex(zenithRgb),
    horizon: rgbToHex(horizonRgb),
    forming: rgbToHex(forming),
    sunColor: rgbToHex(litSun),
    fillColor: rgbToHex(fill),
  };
};

/** UI テキストは常に明色。明るい空は #fff、夜などは既存のクリーム系 */
export type DaytimeUiTokens = {
  ink: string;
  soft: string;
  faint: string;
  panel: string;
  border: string;
  badgeBg: string;
  darkUi: boolean;
};

export type UiTokenOptions = {
  horizonHex?: number;
  zenithHex?: number;
};

export const uiTokensFromBackground = (
  backgroundHex: number,
  options: UiTokenOptions = {},
): DaytimeUiTokens => {
  const formLum = relativeLuminance(backgroundHex);
  const horizonLum =
    options.horizonHex != null ? relativeLuminance(options.horizonHex) : formLum;
  const zenithLum =
    options.zenithHex != null ? relativeLuminance(options.zenithHex) : formLum;
  const maxLum = Math.max(formLum, horizonLum * 0.9, zenithLum * 0.75);
  const brightSky = maxLum >= 0.22;

  if (brightSky) {
    return {
      ink: "#ffffff",
      soft: "#ffffff",
      faint: "rgb(255 255 255 / 72%)",
      panel: "rgb(8 10 14 / 84%)",
      border: "rgb(255 255 255 / 28%)",
      badgeBg: "rgb(10 12 18 / 84%)",
      darkUi: true,
    };
  }

  return {
    ink: "#f6f3ea",
    soft: "#d5d0c4",
    faint: "#a89f90",
    panel: "rgb(8 10 14 / 84%)",
    border: "rgb(245 240 230 / 28%)",
    badgeBg: "rgb(10 12 18 / 84%)",
    darkUi: true,
  };
};

export type SampleDaytimeOptions = {
  latitude?: number;
  longitude?: number;
  /** プレビュー用の基準日（季節）。省略時は今日 */
  baseDate?: Date;
};

export const sampleDaytimeAtmosphereFromHour = (
  hour: number,
  options: SampleDaytimeOptions = {},
): DaytimeAtmosphere => {
  const latitude = options.latitude ?? DEFAULT_DAYTIME_LOCATION.latitude;
  const longitude = options.longitude ?? DEFAULT_DAYTIME_LOCATION.longitude;
  const date = dateFromHourFraction(hour, options.baseDate ?? new Date());
  const wrappedHour = ((hour % 24) + 24) % 24;

  const sun = getSunPosition(date, latitude, longitude);
  const moon = getMoonPosition(date, latitude, longitude);

  // 方位が南を過ぎたら夕方寄り（東=朝、西=夕）
  const afterNoon = sun.azimuthDeg > 180 || wrappedHour >= 12.2;

  const usingMoonlight = sun.elevationDeg < -10;
  const kelvin = usingMoonlight
    ? 4500
    : kelvinFromSun(sun.elevationDeg, afterNoon);
  let lightIntensity = usingMoonlight
    ? 0.14 + clamp01(moon.elevationDeg / 55) * 0.1
    : intensityFromSun(sun.elevationDeg);
  // 夕焼け帯は色を優先し光量は抑えめ
  if (!usingMoonlight && afterNoon && sun.elevationDeg > -4 && sun.elevationDeg < 18) {
    lightIntensity *= 0.82;
  }

  const lightElevationDeg = usingMoonlight
    ? Math.max(10, moon.elevationDeg)
    : Math.max(sun.elevationDeg, -2);
  const lightAzimuthDeg = usingMoonlight ? moon.azimuthDeg : sun.azimuthDeg;

  const sky = buildSkyFromLight(
    kelvin,
    lightIntensity,
    sun.elevationDeg,
    afterNoon,
    usingMoonlight,
  );

  return {
    forming: sky.forming,
    complete: softenComplete(sky.forming),
    zenith: sky.zenith,
    horizon: sky.horizon,
    dark: shouldUseDarkUi(sky.forming),
    hour: wrappedHour,
    kelvin,
    lightIntensity,
    sunElevationDeg: sun.elevationDeg,
    sunAzimuthDeg: sun.azimuthDeg,
    lightElevationDeg,
    lightAzimuthDeg,
    usingMoonlight,
    sunColor: sky.sunColor,
    fillColor: sky.fillColor,
    latitude,
    longitude,
  };
};

export const sampleDaytimeAtmosphere = (
  date = new Date(),
  options: SampleDaytimeOptions = {},
): DaytimeAtmosphere =>
  sampleDaytimeAtmosphereFromHour(getLocalHourFraction(date), {
    ...options,
    baseDate: options.baseDate ?? date,
  });

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

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const formatLocalDateShort = (date = new Date()) =>
  `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;

export const DAYTIME_BACKGROUND_STORAGE_KEY = "sound-sculpture:daytime-background";

export const readDaytimeBackgroundEnabled = () => {
  try {
    const stored = window.localStorage.getItem(DAYTIME_BACKGROUND_STORAGE_KEY);
    if (stored === null) {
      return true;
    }
    return stored === "1";
  } catch {
    return true;
  }
};

export const writeDaytimeBackgroundEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(DAYTIME_BACKGROUND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};
