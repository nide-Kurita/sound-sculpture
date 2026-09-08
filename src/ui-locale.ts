/**
 * 公開 UI の表示言語（JA / EN）。
 * 説明文の正本は日本語。英語は切替時に差し替える。
 */

export type UiLocale = "ja" | "en";

export const UI_LOCALE_STORAGE_KEY = "sound-sculpture:ui-locale";

export const readUiLocale = (): UiLocale => {
  try {
    const stored = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "ja") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "ja";
};

export const writeUiLocale = (locale: UiLocale) => {
  try {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
};

type LocaleTable = Record<UiLocale, string>;

const L = (ja: string, en: string): LocaleTable => ({ ja, en });

export const UI_STRINGS = {
  settings: L("設定", "Settings"),
  language: L("言語", "Language"),
  style: L("スタイル", "Style"),
  growthAlgorithm: L("成長アルゴリズム", "Growth Algorithm"),
  aboutGrowth: L("成長アルゴリズムについて", "About Growth Algorithm"),
  matchTime: L("時刻に合わせる", "Match local time of day"),
  aboutTime: L("時刻設定について", "About Match local time of day"),
  hintTime: L(
    "朝・昼・夕・夜で色が変わります。",
    "Colors shift through morning, day, evening, and night.",
  ),
  matchWeather: L("天気に合わせる", "Match local weather"),
  aboutWeather: L("天気設定について", "About Match local weather"),
  hintWeather: L(
    "位置情報と天気で、晴れ・曇り・雨・風を反映します。",
    "Uses location and weather to reflect clear, cloud, rain, and wind.",
  ),
  showOverlays: L("画面表示", "Show overlays"),
  aboutOverlays: L("画面表示について", "About Show overlays"),
  hintOverlays: L(
    "タイトル・メーター・ステータス・スティック・あしらいを表示します。オフ時は操作パネルボタンだけ、操作で一時表示します。",
    "Titles, meters, status, stick, and frame marks. When off, the panel button appears briefly on interaction.",
  ),
  weather: L("天気", "Weather"),
  condition: L("条件", "Condition"),
  rainAmount: L("雨量", "Rain"),
  windAmount: L("風速", "Wind"),
  useLiveWeather: L("実天気に戻す", "Use live weather"),
  timeOfDay: L("時刻", "Time of day"),
  useLiveTime: L("実時刻に戻す", "Use live time"),
  defaultInput: L("既定の入力", "Default input"),
  weatherLive: L("LIVE（実天気）", "LIVE (real weather)"),
  weatherClear: L("晴れ", "Clear"),
  weatherCloudy: L("曇り", "Cloudy"),
  weatherOvercast: L("どんより", "Overcast"),
  weatherFog: L("霧", "Fog"),
  weatherRain: L("雨", "Rain"),
  weatherRainHeavy: L("強い雨", "Heavy rain"),
  weatherSnow: L("雪", "Snow"),
  weatherWindy: L("強風", "Windy"),
  weatherStorm: L("嵐（雨＋風）", "Storm (rain + wind)"),
  weatherThunder: L("雷", "Thunder"),
  weatherThunderstorm: L("雷雨", "Thunderstorm"),
  fetchingWeather: L("天気を取得中…", "Fetching weather…"),
  applied: L("反映中", "Applied"),
  appliedTokyo: L("反映中（東京）", "Applied (Tokyo fallback)"),
  locationDenied: L(
    "位置情報が拒否されたため、天気に合わせるをOFFにしました",
    "Location denied — Match local weather turned off",
  ),
  weatherFailed: L("天気の取得に失敗しました。再試行します", "Weather fetch failed — retrying soon"),
  preview: L("プレビュー", "Preview"),
} as const;

export type UiStringKey = keyof typeof UI_STRINGS;

export const t = (key: UiStringKey, locale: UiLocale) => UI_STRINGS[key][locale];

export const WEATHER_PRESET_I18N: Record<string, UiStringKey> = {
  live: "weatherLive",
  clear: "weatherClear",
  cloudy: "weatherCloudy",
  overcast: "weatherOvercast",
  fog: "weatherFog",
  rain: "weatherRain",
  "rain-heavy": "weatherRainHeavy",
  snow: "weatherSnow",
  windy: "weatherWindy",
  storm: "weatherStorm",
  thunder: "weatherThunder",
  thunderstorm: "weatherThunderstorm",
};

export const GROWTH_TAGLINE_I18N: Record<string, LocaleTable> = {
  fibonacci: L(
    "フィボナッチ比率による均衡した起伏",
    "Balanced relief from Fibonacci ratios",
  ),
  phyllotaxis: L(
    "黄金角螺旋 — 花・松ぼっくりの葉序",
    "Golden-angle spiral — leaf and pine-cone packing",
  ),
  lsystem: L("枝分かれ — 触手・骨格・器官", "Branching — tentacles, bones, organs"),
  "differential-growth": L(
    "面の押し合い — レタス・脳・珊瑚",
    "Surface crowding — lettuce, cortex, coral",
  ),
  "reaction-diffusion": L(
    "反応拡散 — 皮膚模様・侵食文様",
    "Reaction-diffusion — skin and etch patterns",
  ),
  voronoi: L("細胞分裂・細胞の斑模様", "Cell division and mottled cells"),
  dla: L("拡散限定凝集 — 雪の結晶・菌糸", "Diffusion-limited aggregation — snow, mycelium"),
  physarum: L("粘菌網 — 神経・血管の経路", "Slime-mold networks — nerves and vessels"),
  "flow-field": L("流れ場に沿った成長", "Growth along a flow field"),
  "curl-noise": L("渦のある柔らかい有機変形", "Soft organic deformation with swirl"),
  "space-colonization": L(
    "空間探索 — 木・血管・触手",
    "Space-seeking — trees, vessels, tentacles",
  ),
  "crystal-growth": L("結晶面 — 鉱石・人工物の鋭さ", "Crystal facets — mineral sharpness"),
  erosion: L("風化侵食 — 音の化石", "Weathered erosion — a fossil of sound"),
};

export const growthTagline = (id: string, locale: UiLocale) =>
  GROWTH_TAGLINE_I18N[id]?.[locale] ?? GROWTH_TAGLINE_I18N.fibonacci[locale];
