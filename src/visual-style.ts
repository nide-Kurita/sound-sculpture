/**
 * 作品体験（旧・彫刻モード + 作品スタイルを統合）。
 * URL は `?style=` で切替え。デフォルトは vita。
 *
 * 公開: vita / metamorphosis / monolith
 * DEV のみ: dither / lumen（`?style=`）
 *
 * - vita:          生命に振り切る。暗い環境で膜が真珠光沢に輝き、完成後も呼吸を続ける（基本）
 * - metamorphosis: 形成中は生命体、音が止まると石化・結晶化して彫刻として完成する
 * - monolith:      彫刻に振り切る。膜なし・素材感重視、完成でギャラリー照明が灯る
 * - dither:        黒背景に Ordered Dither（網点）の有機ブロブ。vitekvisuals 系の見た目
 * - lumen:         闇の虚空で音が物質を削る。低域＝質量、高域＝輪郭、トランジェント＝剥離
 */

import { isDevSurface } from "./app-surface";
import type { SculptureMode } from "./sculpture-types";

export type VisualStyleId = "metamorphosis" | "vita" | "monolith" | "dither" | "lumen";

/** 統合された作品モード ID（URL `style` パラメータ） */
export type ExperienceId = VisualStyleId;

/** 公開で選択可能な作品スタイル */
export const PUBLIC_EXPERIENCE_IDS = ["vita", "metamorphosis", "monolith"] as const;
export type PublicExperienceId = (typeof PUBLIC_EXPERIENCE_IDS)[number];

export const isPublicExperienceId = (id: string): id is PublicExperienceId =>
  (PUBLIC_EXPERIENCE_IDS as readonly string[]).includes(id);

export type BackgroundProfile = {
  studioSpace?: boolean;
  dustMotes?: boolean;
  domeVariant?: "default" | "studio" | "abyss";
  /** 可視床を出さず開放空間にする（vita） */
  openVoid?: boolean;
  /** 疎な生物発光粒子（vita） */
  biolumeMotes?: boolean;
  /** 右上のマゼンタ・アクセントグロー（lumen） */
  accentGlow?: boolean;
  /** 星フィールドを生成しない（lumen） */
  noStars?: boolean;
  /** スタイル別の FogExp2 密度 */
  fogDensity?: number;
};

export type VisualStyleEnv = {
  background: number;
  backgroundComplete: number;
  exposure: number;
  key: number;
  keyComplete: number;
  fill: number;
  fillComplete: number;
  ambient: number;
  ambientComplete: number;
  stars: boolean;
  environmentMap: boolean;
  pedestal: boolean;
  spotlight: boolean;
  spotlightIntensity: number;
  backgroundProfile?: BackgroundProfile;
  /** 遠景ドーム・星屑用のカメラ far（vita） */
  cameraFar?: number;
  /** HemisphereLight 地面色（vita） */
  hemisphereGround?: number;
  /** 被写体背面のリムライト強度（vita） */
  rimLightIntensity?: number;
  /** 被写体背面のリムライト色（vita） */
  rimLightColor?: number;
  /** フィルライト色（vita） */
  fillColor?: number;
};

export type VisualStyleConfig = {
  id: VisualStyleId;
  label: string;
  themeDark: boolean;
  membrane: {
    visible: boolean;
    /** 真珠光沢イリデッセンス（vita 用シェーダー分岐） */
    vita: boolean;
    /** 形成中の膜不透明度スケール */
    opacityScale: number;
    /** 完成後の膜不透明度 */
    completedOpacity: number;
    /** 完成後の uCompleted 目標値（1=完全凍結, 小さいほどアニメーション継続） */
    freezeTarget: number;
  };
  particlesVisible: boolean;
  /** 無音時・形成初期の「ホヨホヨ」アイドル揺らぎの強さ (0=なし)。成長アルゴリズムのパターンで駆動される。 */
  idleWobble: number;
  core: {
    color: number;
    innerColor: number;
    roughness: number;
    /** ライブ色計算の基準色相（0.09=粘土の暖色、0.5前後=水棲の寒色） */
    hueBase: number;
    hslSatBase: number;
    hslLightBase: number;
    /** 音による色シフトのスケール */
    shiftScale: number;
    /** コア発光のスケール */
    emissiveScale: number;
    sheen: number;
    sheenColor: number;
    iridescence: number;
    clearcoat: number;
    /** 頂点カラーで焼き込む真珠色のムラ (0=単色)。初期から生命感のある色になる。 */
    pearlVariation: number;
  };
  completion: {
    mode: "petrify" | "breathe" | "monolith";
    seconds: number;
  };
  env: VisualStyleEnv;
};

/** 全スタイル共通のイントロコピー（index.html の初期文言・改行と一致） */
export const SHARED_INTRO = {
  title: "音の彫刻",
  description:
    "音を糧に、深海のような闇の中で生命体が育つ。\n膜は真珠のように輝き、\n完成後も音の鼓動を記憶して\n呼吸し続けます。",
  /** index.html の #intro-description-ja と同じマークアップ */
  descriptionHtml:
    "音を糧に、深海のような闇の中で生命体が育つ。<br>\n膜は真珠のように輝き、<br>\n完成後も音の鼓動を記憶して<br>\n呼吸し続けます。",
  descriptionEn:
    "Fed by sound, a life-form grows. Its membrane gleams like a pearl, remembering the pulse of sound as it continues to breathe.",
} as const;

const METAMORPHOSIS: VisualStyleConfig = {
  id: "metamorphosis",
  label: "変容 — Life Becomes Sculpture",
  themeDark: false,
  membrane: {
    visible: true,
    vita: false,
    opacityScale: 1,
    completedOpacity: 0.11,
    freezeTarget: 1,
  },
  particlesVisible: true,
  idleWobble: 0,
  core: {
    color: 0xd9cdb8,
    innerColor: 0xcfc3ae,
    roughness: 0.94,
    hueBase: 0.09,
    hslSatBase: 0.18,
    hslLightBase: 0.78,
    shiftScale: 1,
    emissiveScale: 1,
    sheen: 0,
    sheenColor: 0xffffff,
    iridescence: 0,
    clearcoat: 0,
    pearlVariation: 0,
  },
  completion: { mode: "petrify", seconds: 7 },
  env: {
    background: 0xf7f6f2,
    backgroundComplete: 0xe8e4db,
    exposure: 1.08,
    key: 3.4,
    keyComplete: 3.0,
    fill: 1.1,
    fillComplete: 0.9,
    ambient: 2.4,
    ambientComplete: 1.7,
    stars: true,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
  },
};

const VITA: VisualStyleConfig = {
  id: "vita",
  label: "生命 — Mystical Lifeform",
  themeDark: true,
  membrane: {
    visible: true,
    vita: true,
    opacityScale: 1.9,
    completedOpacity: 0.2,
    freezeTarget: 0.24,
  },
  particlesVisible: true,
  idleWobble: 1,
  core: {
    // 頂点カラー（真珠色のムラ）と乗算されるため、単色時より明るめに設定
    color: 0x9ca8c8,
    innerColor: 0x3e4a62,
    roughness: 0.52,
    hueBase: 0.62,
    hslSatBase: 0.34,
    hslLightBase: 0.54,
    shiftScale: 0.62,
    emissiveScale: 1.05,
    sheen: 0.85,
    sheenColor: 0x9fd9ff,
    iridescence: 0.65,
    clearcoat: 0.5,
    pearlVariation: 0.82,
  },
  completion: { mode: "breathe", seconds: 6 },
  env: {
    background: 0x060910,
    backgroundComplete: 0x070b12,
    exposure: 1.12,
    key: 1.35,
    keyComplete: 1.2,
    fill: 1.3,
    fillComplete: 1.15,
    ambient: 1.15,
    ambientComplete: 0.98,
    stars: true,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 220,
    hemisphereGround: 0x0c1018,
    fillColor: 0x6a7280,
    rimLightIntensity: 0.38,
    rimLightColor: 0x4a6078,
    backgroundProfile: {
      domeVariant: "abyss",
      openVoid: true,
      biolumeMotes: true,
      fogDensity: 0.0012,
    },
  },
};

const MONOLITH: VisualStyleConfig = {
  id: "monolith",
  label: "彫刻 — Stone & Bronze",
  themeDark: false,
  membrane: {
    visible: false,
    vita: false,
    opacityScale: 0,
    completedOpacity: 0,
    freezeTarget: 1,
  },
  particlesVisible: false,
  idleWobble: 0,
  core: {
    color: 0x969288,
    innerColor: 0x807c73,
    roughness: 0.82,
    hueBase: 0.09,
    hslSatBase: 0.06,
    hslLightBase: 0.6,
    shiftScale: 0.25,
    emissiveScale: 0.12,
    sheen: 0,
    sheenColor: 0xffffff,
    iridescence: 0,
    clearcoat: 0.25,
    pearlVariation: 0,
  },
  completion: { mode: "monolith", seconds: 5 },
  env: {
    background: 0xdfdcd5,
    backgroundComplete: 0x141518,
    exposure: 1.05,
    key: 2.8,
    keyComplete: 1.1,
    fill: 0.9,
    fillComplete: 0.25,
    ambient: 1.9,
    ambientComplete: 0.3,
    stars: false,
    environmentMap: true,
    pedestal: false,
    spotlight: true,
    spotlightIntensity: 3.4,
  },
};

const DITHER: VisualStyleConfig = {
  id: "dither",
  label: "網点 — Ordered Dither",
  themeDark: true,
  membrane: {
    visible: false,
    vita: false,
    opacityScale: 0,
    completedOpacity: 0,
    freezeTarget: 1,
  },
  particlesVisible: false,
  idleWobble: 0.75,
  core: {
    // 中間グレー。ディザ前のシェーディング階調を確保する
    color: 0xb8b8b8,
    innerColor: 0x6e6e6e,
    roughness: 0.78,
    hueBase: 0.55,
    hslSatBase: 0.04,
    hslLightBase: 0.62,
    shiftScale: 0.15,
    emissiveScale: 0.08,
    sheen: 0,
    sheenColor: 0xffffff,
    iridescence: 0,
    clearcoat: 0.05,
    pearlVariation: 0,
  },
  completion: { mode: "breathe", seconds: 6 },
  env: {
    background: 0x000000,
    backgroundComplete: 0x000000,
    exposure: 1,
    key: 0,
    keyComplete: 0,
    fill: 0,
    fillComplete: 0,
    ambient: 0,
    ambientComplete: 0,
    stars: false,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 120,
    hemisphereGround: 0x000000,
    fillColor: 0x000000,
    rimLightIntensity: 0,
    backgroundProfile: {
      openVoid: true,
      fogDensity: 0,
    },
  },
};

const LUMEN: VisualStyleConfig = {
  id: "lumen",
  label: "発光 — Sound Carves Matter",
  themeDark: true,
  membrane: {
    visible: false,
    vita: false,
    opacityScale: 0,
    completedOpacity: 0,
    freezeTarget: 0.2,
  },
  particlesVisible: true,
  idleWobble: 0.4,
  core: {
    color: 0xd01848,
    innerColor: 0x4a5aaa,
    roughness: 0.45,
    hueBase: 0.95,
    hslSatBase: 0.65,
    hslLightBase: 0.48,
    shiftScale: 0.5,
    emissiveScale: 1.1,
    sheen: 0,
    sheenColor: 0xffffff,
    iridescence: 0,
    clearcoat: 0,
    pearlVariation: 0,
  },
  completion: { mode: "breathe", seconds: 7 },
  env: {
    background: 0x060814,
    backgroundComplete: 0x070916,
    exposure: 1.05,
    key: 0.7,
    keyComplete: 0.58,
    fill: 0.55,
    fillComplete: 0.45,
    ambient: 0.48,
    ambientComplete: 0.42,
    stars: false,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 120,
    hemisphereGround: 0x04060e,
    fillColor: 0xb04888,
    rimLightIntensity: 0.45,
    rimLightColor: 0xff4a8a,
    backgroundProfile: {
      openVoid: true,
      noStars: true,
      accentGlow: true,
      fogDensity: 0.0015,
    },
  },
};

export const VISUAL_STYLE_CATALOG: readonly VisualStyleConfig[] = [
  VITA,
  METAMORPHOSIS,
  MONOLITH,
  DITHER,
  LUMEN,
];

export type ExperienceEntry = {
  id: ExperienceId;
  label: string;
  sculptureMode: SculptureMode;
  visualStyleId: VisualStyleId;
  introTitle: string;
  introDescription: string;
  introDescriptionEn?: string;
};

export const EXPERIENCE_CATALOG: readonly ExperienceEntry[] = [
  {
    id: "vita",
    label: VITA.label,
    sculptureMode: "classic",
    visualStyleId: "vita",
    introTitle: SHARED_INTRO.title,
    introDescription: SHARED_INTRO.description,
    introDescriptionEn: SHARED_INTRO.descriptionEn,
  },
  {
    id: "metamorphosis",
    label: METAMORPHOSIS.label,
    sculptureMode: "classic",
    visualStyleId: "metamorphosis",
    introTitle: "音の変容",
    introDescription:
      "音を糧に、やわらかい生命体が育つ。\n音が止まると、膜は結晶化し、\n形は石のように固まって\n彫刻として残ります。",
    introDescriptionEn:
      "Fed by sound, a soft life-form grows. When the sound falls silent, its membrane crystallizes and the form hardens into sculpture.",
  },
  {
    id: "monolith",
    label: MONOLITH.label,
    sculptureMode: "classic",
    visualStyleId: "monolith",
    introTitle: "音の彫刻",
    introDescription:
      "音の圧力が、石とブロンズのような質量を削り出す。\n膜はなく、素材の手触りだけが残り、\n完成するとギャラリーの光が灯ります。",
    introDescriptionEn:
      "Sound pressure carves mass like stone and bronze. There is no membrane—only material presence—until gallery light settles on the finished form.",
  },
  {
    id: "dither",
    label: DITHER.label,
    sculptureMode: "classic",
    visualStyleId: "dither",
    introTitle: "網点の彫刻",
    introDescription:
      "音が階調を押し、網点の輪郭を育てる。\n黒地に Ordered Dither が定着し、\n有機的なブロブとして残ります。",
    introDescriptionEn:
      "Sound presses tone into ordered dither. On black, an organic blob settles into a fixed grain.",
  },
  {
    id: "lumen",
    label: LUMEN.label,
    sculptureMode: "lumen",
    visualStyleId: "lumen",
    introTitle: "発光の彫刻",
    introDescription:
      "闇の虚空で、音が物質を削る。\n低域は質量、高域は輪郭、\nトランジェントは剥離として刻まれます。",
    introDescriptionEn:
      "In a dark void, sound carves matter. Bass is mass, treble is edge, transients flake away the surface.",
  },
];

/** 公開 UI・公開 URL で使うカタログ（生命 / 変容 / 彫刻） */
export const PUBLIC_EXPERIENCE_CATALOG: readonly ExperienceEntry[] = EXPERIENCE_CATALOG.filter(
  (entry) => isPublicExperienceId(entry.id),
);

export const getExperience = (id: ExperienceId): ExperienceEntry =>
  EXPERIENCE_CATALOG.find((entry) => entry.id === id) ?? EXPERIENCE_CATALOG[0];

export const getVisualStyle = (id: VisualStyleId): VisualStyleConfig =>
  VISUAL_STYLE_CATALOG.find((style) => style.id === id) ?? VITA;

/** @deprecated ExperienceId へ統合。互換のため残す */
export const parseVisualStyleId = (): VisualStyleId => parseExperienceId();

/**
 * URL `?style=` を優先。旧 `?mode=` / carve・amoeba は vita へフォールバック。
 * 公開サーフェスでは dither / lumen も vita へ落とす。デフォルトは vita。
 */
export const parseExperienceId = (): ExperienceId => {
  const params = new URLSearchParams(window.location.search);
  const style = params.get("style");
  let id: ExperienceId = "vita";
  if (style === "vita") id = "vita";
  else if (style === "metamorphosis") id = "metamorphosis";
  else if (style === "monolith") id = "monolith";
  else if (style === "dither") id = "dither";
  else if (style === "lumen") id = "lumen";

  if (!isDevSurface() && !isPublicExperienceId(id)) {
    return "vita";
  }
  return id;
};

let activeStyle: VisualStyleConfig = VITA;

export const setActiveVisualStyle = (id: VisualStyleId) => {
  activeStyle = getVisualStyle(id);
};

export const getActiveVisualStyle = () => activeStyle;
