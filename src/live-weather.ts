/**
 * 現在地の実天気を Open-Meteo から取得する。
 * API キー不要。位置は Geolocation（拒否時は東京へフォールバック）。
 */

export type WeatherCondition = "clear" | "cloudy" | "overcast" | "fog" | "rain" | "snow";

export type LiveWeatherSnapshot = {
  condition: WeatherCondition;
  /** HUD 用短いラベル */
  label: string;
  cloudCover: number;
  precipitation: number;
  windSpeed: number;
  windDirectionDeg: number;
  /** 0..1 雨の強さ */
  rainIntensity: number;
  /** 0..1 風の強さ */
  windStrength: number;
  /** 風が粒子を流す方向（ワールド XZ、正規化済みに近い） */
  windX: number;
  windZ: number;
  latitude: number;
  longitude: number;
  fetchedAt: number;
};

export const LIVE_WEATHER_STORAGE_KEY = "sound-sculpture:live-weather";

export const readLiveWeatherEnabled = () => {
  try {
    return window.localStorage.getItem(LIVE_WEATHER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const writeLiveWeatherEnabled = (enabled: boolean) => {
  try {
    window.localStorage.setItem(LIVE_WEATHER_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};

const FALLBACK_LAT = 35.6812;
const FALLBACK_LON = 139.7671;

const CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: "CLEAR",
  cloudy: "CLOUDY",
  overcast: "OVERCAST",
  fog: "FOG",
  rain: "RAIN",
  snow: "SNOW",
};

/** WMO Weather interpretation codes → ざっくりした条件 */
export const conditionFromWmoCode = (code: number): WeatherCondition => {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 2) return "cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    (code >= 95 && code <= 99)
  ) {
    return "rain";
  }
  return "cloudy";
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const buildWeatherSnapshot = (params: {
  code: number;
  cloudCover: number;
  precipitation: number;
  windSpeed: number;
  windDirectionDeg: number;
  latitude: number;
  longitude: number;
}): LiveWeatherSnapshot => {
  const condition = conditionFromWmoCode(params.code);
  const cloudCover = clamp01(params.cloudCover / 100);
  const windStrength = clamp01(params.windSpeed / 14);
  let rainIntensity = 0;
  if (condition === "rain") {
    rainIntensity = clamp01(0.25 + params.precipitation / 6 + cloudCover * 0.2);
  } else if (condition === "snow") {
    rainIntensity = clamp01(0.18 + params.precipitation / 5);
  } else if (condition === "fog") {
    rainIntensity = 0.05;
  }

  // 気象の風向は「風上」。粒子は風下へ流すので +180°
  const blowRad = ((params.windDirectionDeg + 180) * Math.PI) / 180;
  const windX = Math.sin(blowRad) * windStrength;
  const windZ = Math.cos(blowRad) * windStrength;

  return {
    condition,
    label: CONDITION_LABEL[condition],
    cloudCover,
    precipitation: params.precipitation,
    windSpeed: params.windSpeed,
    windDirectionDeg: params.windDirectionDeg,
    rainIntensity,
    windStrength,
    windX,
    windZ,
    latitude: params.latitude,
    longitude: params.longitude,
    fetchedAt: Date.now(),
  };
};

export const getGeolocation = (): Promise<{ latitude: number; longitude: number }> =>
  new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ latitude: FALLBACK_LAT, longitude: FALLBACK_LON });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        resolve({ latitude: FALLBACK_LAT, longitude: FALLBACK_LON });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    );
  });

type OpenMeteoCurrent = {
  weather_code?: number;
  cloud_cover?: number;
  precipitation?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
};

export const fetchLiveWeather = async (
  latitude: number,
  longitude: number,
): Promise<LiveWeatherSnapshot> => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    "weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "ms");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Weather request failed (${response.status})`);
  }
  const data = (await response.json()) as { current?: OpenMeteoCurrent };
  const current = data.current ?? {};
  return buildWeatherSnapshot({
    code: current.weather_code ?? 1,
    cloudCover: current.cloud_cover ?? 30,
    precipitation: current.precipitation ?? 0,
    windSpeed: current.wind_speed_10m ?? 0,
    windDirectionDeg: current.wind_direction_10m ?? 0,
    latitude,
    longitude,
  });
};

export const fetchLiveWeatherForUser = async (): Promise<LiveWeatherSnapshot> => {
  const { latitude, longitude } = await getGeolocation();
  return fetchLiveWeather(latitude, longitude);
};

export type WeatherPreviewPresetId =
  | "live"
  | "clear"
  | "cloudy"
  | "overcast"
  | "fog"
  | "rain"
  | "rain-heavy"
  | "snow"
  | "windy"
  | "storm";

export const WEATHER_PREVIEW_PRESETS: {
  id: WeatherPreviewPresetId;
  label: string;
}[] = [
  { id: "live", label: "LIVE（実天気）" },
  { id: "clear", label: "晴れ" },
  { id: "cloudy", label: "曇り" },
  { id: "overcast", label: "どんより" },
  { id: "fog", label: "霧" },
  { id: "rain", label: "雨" },
  { id: "rain-heavy", label: "強い雨" },
  { id: "snow", label: "雪" },
  { id: "windy", label: "強風" },
  { id: "storm", label: "嵐（雨＋風）" },
];

/** DEV プレビュー用の合成スナップショット */
export const createWeatherPreviewSnapshot = (
  preset: Exclude<WeatherPreviewPresetId, "live">,
  rainScale = 1,
  windScale = 1,
): LiveWeatherSnapshot => {
  const rainMul = Math.min(1.4, Math.max(0, rainScale));
  const windMul = Math.min(1.6, Math.max(0, windScale));

  const finish = (partial: {
    condition: WeatherCondition;
    label: string;
    cloudCover: number;
    precipitation: number;
    windSpeed: number;
    windDirectionDeg: number;
    rainIntensity: number;
    windStrength: number;
  }): LiveWeatherSnapshot => {
    const rainIntensity = Math.min(1, partial.rainIntensity * rainMul);
    const windStrength = Math.min(1, partial.windStrength * windMul);
    const blowRad = ((partial.windDirectionDeg + 180) * Math.PI) / 180;
    return {
      condition: partial.condition,
      label: partial.label,
      cloudCover: partial.cloudCover,
      precipitation: partial.precipitation,
      windSpeed: partial.windSpeed * windMul,
      windDirectionDeg: partial.windDirectionDeg,
      rainIntensity,
      windStrength,
      windX: Math.sin(blowRad) * windStrength,
      windZ: Math.cos(blowRad) * windStrength,
      latitude: FALLBACK_LAT,
      longitude: FALLBACK_LON,
      fetchedAt: Date.now(),
    };
  };

  switch (preset) {
    case "clear":
      return finish({
        condition: "clear",
        label: "CLEAR",
        cloudCover: 0.05,
        precipitation: 0,
        windSpeed: 1.2,
        windDirectionDeg: 220,
        rainIntensity: 0,
        windStrength: 0.08,
      });
    case "cloudy":
      return finish({
        condition: "cloudy",
        label: "CLOUDY",
        cloudCover: 0.45,
        precipitation: 0,
        windSpeed: 3,
        windDirectionDeg: 200,
        rainIntensity: 0,
        windStrength: 0.22,
      });
    case "overcast":
      return finish({
        condition: "overcast",
        label: "OVERCAST",
        cloudCover: 0.88,
        precipitation: 0,
        windSpeed: 4,
        windDirectionDeg: 180,
        rainIntensity: 0,
        windStrength: 0.3,
      });
    case "fog":
      return finish({
        condition: "fog",
        label: "FOG",
        cloudCover: 0.7,
        precipitation: 0,
        windSpeed: 0.8,
        windDirectionDeg: 90,
        rainIntensity: 0.05,
        windStrength: 0.06,
      });
    case "rain":
      return finish({
        condition: "rain",
        label: "RAIN",
        cloudCover: 0.75,
        precipitation: 2.2,
        windSpeed: 5,
        windDirectionDeg: 240,
        rainIntensity: 0.55,
        windStrength: 0.36,
      });
    case "rain-heavy":
      return finish({
        condition: "rain",
        label: "RAIN+",
        cloudCover: 0.92,
        precipitation: 8,
        windSpeed: 8,
        windDirectionDeg: 250,
        rainIntensity: 0.92,
        windStrength: 0.58,
      });
    case "snow":
      return finish({
        condition: "snow",
        label: "SNOW",
        cloudCover: 0.8,
        precipitation: 1.5,
        windSpeed: 3.5,
        windDirectionDeg: 30,
        rainIntensity: 0.48,
        windStrength: 0.28,
      });
    case "windy":
      return finish({
        condition: "cloudy",
        label: "WINDY",
        cloudCover: 0.35,
        precipitation: 0,
        windSpeed: 14,
        windDirectionDeg: 270,
        rainIntensity: 0,
        windStrength: 0.95,
      });
    case "storm":
      return finish({
        condition: "rain",
        label: "STORM",
        cloudCover: 0.95,
        precipitation: 10,
        windSpeed: 16,
        windDirectionDeg: 260,
        rainIntensity: 1,
        windStrength: 1,
      });
  }
};

/** 雲量で天頂・地平を灰寄りに寄せる（晴れ ident、曇りで沈む） */
export const applyCloudCoverToSky = (
  zenith: number,
  horizon: number,
  cloudCover: number,
): { zenith: number; horizon: number } => {
  const t = clamp01(cloudCover);
  if (t < 0.05) {
    return { zenith, horizon };
  }
  const grayZ = 0x8a9098;
  const grayH = 0x9a9ea4;
  const darkZ = 0x4a5058;
  const darkH = 0x5a6068;
  const targetZ = t > 0.65 ? darkZ : grayZ;
  const targetH = t > 0.65 ? darkH : grayH;
  const mix = t * 0.72;
  const lerpC = (a: number, b: number, u: number) => {
    const ar = (a >> 16) & 0xff;
    const ag = (a >> 8) & 0xff;
    const ab = a & 0xff;
    const br = (b >> 16) & 0xff;
    const bg = (b >> 8) & 0xff;
    const bb = b & 0xff;
    return (
      (Math.round(ar + (br - ar) * u) << 16) |
      (Math.round(ag + (bg - ag) * u) << 8) |
      Math.round(ab + (bb - ab) * u)
    );
  };
  return {
    zenith: lerpC(zenith, targetZ, mix),
    horizon: lerpC(horizon, targetH, mix * 0.85),
  };
};
