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

/**
 * 天気・時刻ぶんの色シフトの倍率（worklist vita [P1]「初期色が面白くない」）。
 *
 * 原則では**色の第一目的は「気候・時間・作った環境」**で、曲による色差は副次。
 * ところが待機時の実測（2026-08-21）では、画面上の本体色相の広がりが
 * **天気 0.06 / 時刻 0.03**（0.5 が補色）しかなく、面内の真珠ノイズ **±0.35** に埋もれていた。
 * 「振幅を桁で変える」判断は**曲を鳴らさずに天気・時刻プレビューを振って実機で決める**ので、
 * dev パネル `#envcolor-panel` のノブとして外へ出してある。
 *
 * **1.0 が従来値。** 既定を動かすときは `initial_color_grid.js` の前後比較を残すこと。
 */
/**
 * **既定 2.0 / 3.0（2026-08-21）。** 1.0 が従来値で、そのときの実測は
 * 「画面上の本体色相の広がり 0.081 / 背景の色相は 0.002（＝ほぼ動かない）」だった。
 * 天気・時刻・海水の色まで通した状態で 1.0 と 2.0/3.0 を並べて撮り、
 * **2.0/3.0 のほうが「天気ごとに別の色」と読める**ことを確認して既定にした
 * （画像 `docs/vita-progress/initial-color-compare.png` / `env-color-sea.png`）。
 * 戻すときは dev パネル `#envcolor-panel` を 1.0 にするか、ここを 1 に戻す。
 */
export const DEFAULT_ENV_COLOR_WEATHER_GAIN = 2;
export const DEFAULT_ENV_COLOR_HOUR_GAIN = 3;
export const envColorGain = {
  weather: DEFAULT_ENV_COLOR_WEATHER_GAIN,
  hour: DEFAULT_ENV_COLOR_HOUR_GAIN,
};

/**
 * 振れ幅の掛け方。**色相を主に広げ、明度は広げない。**
 *
 * 3 段階（1 / 2・3 / 3・5）で実測したところ、明度まで一緒に広げると
 * **夜（3 時）の本体が L 0.18 まで落ちて真っ黒な影になり、形が読めなくなった。**
 * ユーザーの要求は「色を楽しめること」であって暗くすることではない。
 * 明暗は背景ドームとライト（`daytime-atmosphere`）側が担っているので、
 * 粘土側は色相を主・彩度を従で広げ、明度は設計値のままにする。
 */
const scaleShift = (shift: ClayColorShift, gain: number): ClayColorShift =>
  gain === 1
    ? shift
    : {
        hue: shift.hue * gain,
        // **彩度を下げる向きは増幅しない。**
        // 時刻の彩度押しは深夜 -0.05 / 夕 +0.07。倍率を掛けると**夜の彩度が桁で落ちて**、
        // ただでさえ暗い夜が灰色になる（2026-08-23 実測: 3 時の粘土の彩度が 0.283 まで低下、
        // 15 時は 0.717）。上げる向きだけ増幅する。
        sat: shift.sat > 0 ? shift.sat * (1 + (gain - 1) * 0.5) : shift.sat,
        light: shift.light,
      };

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

/** 0..1 Hermite。Three に依存させない（clay-color はスタイル共通） */
const smooth01 = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * vita 専用: 昼の海が明るいのに粘土が沈んで見える問題（2026-09-03 実機）。
 * 夜の明度は触らない（深夜を灰色／真っ黒にした過去がある）。
 */
export const vitaDaytimeClayLift = (hour: number): ClayColorShift => {
  const h = ((hour % 24) + 24) % 24;
  const day = smooth01(6.8, 10.2, h) * (1 - smooth01(17.4, 20.4, h));
  return { hue: 0, sat: 0.015 * day, light: 0.078 * day };
};

/**
 * 晴れの膜にだけ載せる金の陽だまり（色相ではなく発光感）。
 * 雷雨は銅の語彙が既に OK なので足さない。
 */
export const weatherGoldLuster = (snapshot: LiveWeatherSnapshot | null): number => {
  if (snapshot?.condition === "clear") {
    const cloud = clamp01(snapshot.cloudCover);
    return clamp01(0.55 + (1 - cloud) * 0.45);
  }
  return 0;
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
/**
 * 深海ドーム（海水塊）の天気ぶんの色味。**worklist vita [P1]「初期色が面白くない」の続き。**
 *
 * ドームの色相は `scene-background.ts` の `setAbyssSeaByHour()` で
 * **`top.setHSL(0.58, …)` とハードコードされていて、時刻は明度しか動かしていなかった。**
 * 実測（2026-08-21、天気 6 × 時刻 4）でも背景の色相は **0.579〜0.581**（幅 0.002）で、
 * 「天気で作った環境が色に出る」が背景側では成立していなかった。
 *
 * 粘土と**同じ語彙**（晴れ=暖 / 雨=水色 / 曇り=緑 / 雪=白寄り）を使うが、
 * ドームは画面のほぼ全部を占めるので**粘土より弱く効かせる**。
 * 明度は触らない（夜が潰れる。粘土側と同じ理由）。倍率ノブ `envColorGain.weather` を共有する。
 */
/**
 * 深海ドーム（海水塊）の天気ぶんの色味。
 *
 * **粘土（生きもの）の語彙をそのまま流用してはいけない**（2026-08-21 にユーザー指摘で判明）。
 * 粘土の「晴れ」は *膜の青越しにオレンジに見せるための琥珀* なので、
 * 海水へ同じ差分を掛けると **晴れの海が緑になって違和感が出る**。
 * 海には海の語彙を持たせる:
 *
 * | 天気 | 海水 |
 * |---|---|
 * | 晴れ | 澄んだターコイズ寄りの青（彩度を上げる） |
 * | 曇り / どんより | 彩度が落ちた青〜鋼色 |
 * | 霧 / 雪 | 淡く白っぽい（彩度を大きく落とす） |
 * | 雨 | わずかに濁った青緑 |
 * | 雷 / 雷雨 | 藍（青紫）へ寄せる |
 *
 * 明度は触らない（時刻側が担当。夜が潰れる）。倍率ノブ `envColorGain.weather` を粘土と共有し、
 * **色相には全部・彩度には半分**掛ける（彩度は上げ過ぎると水槽の着色水になる）。
 */
/**
 * **天気ごとの「染み」の色**（worklist vita [P1]。粘土＝生きものの色の主題）。
 *
 * なぜ要るか（2026-08-21 の実測とユーザー指摘）:
 * 従来の 2 極は **`clayHueBase` から相対**に開いていた（暖 = base - spread/2）。
 * base は深海のシアン 0.62 なので、暖極は **0.10〜0.47 の「緑〜黄緑」**に落ちる。
 * そこへ寒極（シアン）を面内で混ぜるので、**どの天気でも濁ったオリーブ〜灰緑**になっていた
 * （等倍で並べた画像で 6 天気すべてが同じ濁った色。ユーザー「あまり面白い色合いではない」）。
 *
 * 直し方は「振れ幅を上げる」ではない。**染みの色を天気ごとに決め打ちする。**
 * 地（寒極）は真珠シアンのまま＝深海の同一性を保ち、
 * 染み（暖極）だけがその日の天気の色になる（案C「無機ベース＋有機の染み」の本来の姿）。
 */
export type ClayWeatherPalette = {
  /** 地（球体そのものの色） */
  ground: number;
  /** 染み（面内のもう一方の極） */
  bloom: number;
  /** 彩度の倍率 */
  sat: number;
  /** 明度の押し */
  light: number;
  /** 地をどこまで振り切るか（0〜1）。**途中で止めると緑の中間色になる** */
  reach: number;
};

/**
 * **天気ごとの粘土（生きもの）の色。地と染みの 2 色を決め打ちする。**
 *
 * 2026-08-21、ユーザー:「粘土質の球体の色合いがどの状態でも青緑っぽい色で面白みがない。」
 *
 * それまでは **地を真珠シアン 0.52 に固定**して染みだけ天気色にしていた（案C の読み方）。
 * だが地が画面の大半を占めるので、**どの天気でも球体は青緑**のままだった。
 * さらにその前は 2 極とも `clayHueBase` からの相対で、暖極が緑〜黄緑に落ちて濁っていた。
 *
 * **色相環の途中で止めると必ず濁る**（シアンから暖色へは緑を通る）ので、
 * 地は `reach` で**振り切る**。深海の同一性は背景ドーム・膜の真珠・ライトが担う。
 */
export const weatherClayPalette = (snapshot: LiveWeatherSnapshot | null): ClayWeatherPalette => {
  switch (snapshot?.condition) {
    // **染みは地の同系色にする（2026-08-23）。**
    // 遠い色相の 2 極を面内で混ぜると、境目が灰色になって彩度を食う
    // （実測: 染みを切ると本体の Lab 彩度が 12.6 → 16.6 に上がった）。
    // 貝の真珠層も「金と銅」「藍と青」のような**同系のグラデーション**であって補色ではない。
    // 段C1（2026-09-02）: 天気ごとの語彙再設計。ground↔bloom は同系色ファミリー（Δ≤0.10）。
    // 詳細は docs/handoff/VITA-strategy.md 10.3。
    case "clear":
      return { ground: 0.085, bloom: 0.045, sat: 1.35, light: 0.05, reach: 1 }; // 琥珀 × 金
    case "cloudy":
      return { ground: 0.36, bloom: 0.3, sat: 1.05, light: 0.01, reach: 0.95 }; // 翡翠 × 苔
    case "overcast":
      return { ground: 0.57, bloom: 0.61, sat: 0.78, light: -0.01, reach: 0.88 }; // スレート × 菫
    case "fog":
      return { ground: 0.55, bloom: 0.48, sat: 0.52, light: 0.07, reach: 0.72 }; // 乳白 × 淡緑
    case "rain":
      return { ground: 0.635, bloom: 0.595, sat: 1.15, light: 0.02, reach: 1 }; // コバルト × サファイア
    case "snow":
      return { ground: 0.56, bloom: 0.59, sat: 0.38, light: 0.16, reach: 0.75 }; // 白磁 × 淡藤
    case "thunder":
    case "thunderstorm":
      return { ground: 0.105, bloom: 0.075, sat: 1.45, light: 0.05, reach: 1 }; // 硫黄 × 銅
    default:
      // 天気が取れないとき（オフライン・天気オフ）は深海の既定＝シアン × 青緑。
      return { ground: 0.58, bloom: 0.52, sat: 1, light: 0, reach: 0.3 };
  }
};

/**
 * vita 用の天気シフト。**地の色へ振り切る**（途中で止めない）。
 *
 * `weatherClayShiftFromSnapshot` は aether など他スタイルも使っているので触っていない。
 * こちらは vita だけが通る。倍率ノブ `envColorGain.weather` は `reach` に掛けて
 * **1 で頭打ち**にする（上げても目標を通り過ぎない）。
 */
export const vitaWeatherClayShift = (
  snapshot: LiveWeatherSnapshot | null,
  baseHue = 0.62,
): ClayColorShift => {
  const pal = weatherClayPalette(snapshot);
  const reach = clamp01(pal.reach * Math.max(0, envColorGain.weather) * 0.5);
  const delta = warmHueDelta(baseHue, pal.ground);
  return {
    hue: delta * reach,
    sat: (pal.sat - 1) * 0.34 * reach,
    light: pal.light * reach,
  };
};

/**
 * **天気ごとの「海に差し込む光」の色**（worklist vita [P1] 段3。2026-08-23 ユーザー合意）。
 *
 * vita のライトは key `0xc4e8ff` / fill `0x2a5a78` / ambient `0x6a98b8` と
 * **全部ハードコードの青**だった。粘土が何色でも青い光で照らされるので、
 * 暖色の粘土は補色キャンセルで灰色になる（実測: ライトを中立にすると本体の彩度 +1.4）。
 *
 * 海面から入る光の色は天気で変わる、というのが物理的にも自然な理屈。
 * `amount` は既存の青からどれだけ寄せるか（0 = 従来のまま）。
 */
export type WeatherLightTint = {
  key: number;
  fill: number;
  ambient: number;
  amount: number;
};

export const weatherLightTint = (snapshot: LiveWeatherSnapshot | null): WeatherLightTint => {
  switch (snapshot?.condition) {
    case "clear":
      // 晴れ: 浅瀬の金陽。段C4 で key を琥珀寄りにして「色はあるが発光しない」を補う
      return { key: 0xffe4a8, fill: 0x5a6e68, ambient: 0xd0b888, amount: 0.72 };
    case "cloudy":
      return { key: 0xd8e6f0, fill: 0x33566e, ambient: 0x8fa3b0, amount: 0.42 };
    case "overcast":
      return { key: 0xc8d6e2, fill: 0x2c4a60, ambient: 0x7d90a0, amount: 0.48 };
    case "fog":
      return { key: 0xdfe9ef, fill: 0x3a5a6a, ambient: 0x9fb0bb, amount: 0.5 };
    case "rain":
      return { key: 0xb8d4e8, fill: 0x25506c, ambient: 0x6e93ab, amount: 0.35 };
    case "snow":
      return { key: 0xe6f0f8, fill: 0x3d6076, ambient: 0xa9bcc9, amount: 0.48 };
    case "thunder":
    case "thunderstorm":
      // 嵐: 色を失った鈍い鋼。稲妻のフラッシュとの落差を作る
      return { key: 0xa8b8c0, fill: 0x2a3c4a, ambient: 0x6a7680, amount: 0.55 };
    default:
      return { key: 0xc4e8ff, fill: 0x2a5a78, ambient: 0x6a98b8, amount: 0 };
  }
};

export const abyssSeaTintFromWeather = (
  snapshot: LiveWeatherSnapshot | null,
): { hue: number; sat: number } => {
  if (!snapshot) {
    return { hue: 0, sat: 0 };
  }
  const cloud = clamp01(snapshot.cloudCover);
  const rain = clamp01(snapshot.rainIntensity);
  const lightning = clamp01(snapshot.lightningIntensity);
  let hue = 0;
  let sat = 0;
  switch (snapshot.condition) {
    case "clear":
      hue = -0.04; // 0.58 → ターコイズ寄り（緑まで行かせない）
      sat = 0.14;
      break;
    case "cloudy":
      hue = 0.012;
      sat = -0.1;
      break;
    case "overcast":
      hue = 0.02;
      sat = -0.16;
      break;
    case "fog":
      hue = 0.005;
      sat = -0.22;
      break;
    case "rain":
      hue = -0.022;
      sat = -0.06;
      break;
    case "snow":
      hue = 0.018;
      sat = -0.26;
      break;
    case "thunder":
    case "thunderstorm":
      // 紫の海は不自然（2026-08-21 ユーザー指摘）。嵐の海は**暗く濁った青緑〜鋼色**。
      // ドラマは既存の稲妻フラッシュ（`uLightningFlash`）が担当する。
      hue = -0.012;
      sat = -0.2;
      break;
    default:
      break;
  }
  const amt =
    snapshot.condition === "clear"
      ? clamp01(0.55 + (1 - cloud) * 0.45)
      : clamp01(0.45 + cloud * 0.3 + rain * 0.35 + lightning * 0.3);
  const satGain = 1 + (envColorGain.weather - 1) * 0.5;
  return { hue: hue * amt * envColorGain.weather, sat: sat * amt * satGain };
};

export const envClayShiftFromWeatherAndHour = (
  snapshot: LiveWeatherSnapshot | null,
  hour: number,
  baseHue = 0.62,
): ClayColorShift =>
  combineClayShifts(
    scaleShift(weatherClayShiftFromSnapshot(snapshot, baseHue), envColorGain.weather),
    scaleShift(hourClayShiftFromHour(hour), envColorGain.hour),
  );

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
