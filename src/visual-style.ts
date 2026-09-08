/**
 * 作品体験（旧・彫刻モード + 作品スタイルを統合）。
 * URL は `?style=` で切替え。デフォルトは vita。
 *
 * 公開: vita / monolith / dither
 * DEV のみ: metamorphosis / lumen / volume / aether（`?style=`）
 *
 * - vita:          生命に振り切る。暗い環境で膜が真珠光沢に輝き、完成後も呼吸を続ける（基本）
 * - metamorphosis: 形成中は生命体、音が止まると石化・結晶化して彫刻として完成する（DEV）
 * - monolith:      彫刻に振り切る。膜なし・素材感重視、完成でギャラリー照明が灯る
 * - dither:        黒背景に Ordered Dither（網点）の有機ブロブ。vitekvisuals 系の見た目
 * - lumen:         闇の虚空で音が物質を削る。低域＝質量、高域＝輪郭、トランジェント＝剥離
 * - volume:        球を捨て、密度場へ音を堆積させて等値面を彫刻にする（穴・枝・空洞が出る）
 * - aether:        半透明の光の体積。音を密度場へ堆積しレイマーチで描く（vita 雰囲気を継承）
 */

import { isDevSurface } from "./app-surface";
import type { SculptureMode } from "./sculpture-types";

export type VisualStyleId =
  | "metamorphosis"
  | "vita"
  | "monolith"
  | "dither"
  | "lumen"
  | "volume"
  | "aether";

/** 統合された作品モード ID（URL `style` パラメータ） */
export type ExperienceId = VisualStyleId;

/** 公開で選択可能な作品スタイル（生命 / 彫刻 / 網点） */
export const PUBLIC_EXPERIENCE_IDS = ["vita", "monolith", "dither"] as const;
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
  /** PMREM(RoomEnvironment) を `scene.environment` に入れる（monolith 系）。vita では使わない */
  environmentMap: boolean;
  /**
   * 彫刻のマテリアルにだけ差す暗い自作環境（vita）。`scene.environment` には入れない。
   * RoomEnvironment を使うと暗い配色が白く洗われるため、その代替（vita-environment.ts）。
   */
  abyssEnvironment?: boolean;
  /** `abyssEnvironment` の映り込み量。未指定なら vita-environment.ts の既定値 */
  envMapIntensity?: number;
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
    /**
     * 完成フェーズでだけ立ち上げる質感（形成中は使わない）。
     * 演奏中と完成後を「別のフェーズ」にするための層。
     * 形成中に clearcoat / sheen / iridescence を足すと回転時に色が飛ぶため、
     * ここは完成後（形が確定して動きが止まったあと）専用に扱う。
     * 未指定のスタイルは従来どおり completion.mode の処理だけが効く。
     */
    finish?: CompletionFinish;
  };
  env: VisualStyleEnv;
};

/** 完成フェーズの質感。値は ease（0→1）と種プロファイルで立ち上がる */
export type CompletionFinish = {
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  iridescence?: number;
  iridescenceIOR?: number;
  /** 完成時に roughness をこの値へ寄せる（未指定なら mode 側の値を維持） */
  roughness?: number;
};

/**
 * 全スタイル共通のイントロコピー（index.html の初期文言・改行と一致）。
 * **`title` はスタイルを切り替えても変えない**（作品名にあたる表示のため）。
 * スタイルごとに変えるのは説明文（description）だけ。
 */
export const SHARED_INTRO = {
  title: "音の彫刻",
  description:
    "聴かせた音が、粘土のような核へ降り積もる。\n膜は真珠のように輝き、\n曲が終わると、その一曲だけの\n彫刻として残ります。",
  /** index.html の #intro-description-ja と同じマークアップ */
  descriptionHtml:
    "聴かせた音が、粘土のような核へ降り積もる。<br>\n膜は真珠のように輝き、<br>\n曲が終わると、その一曲だけの<br>\n彫刻として残ります。",
  descriptionEn:
    "Sound settles onto a clay-like core. Its membrane gleams like a pearl, and when the song ends, what remains is a sculpture of that one song alone.",
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
    exposure: 1.04,
    key: 2.4,
    keyComplete: 2.15,
    fill: 1.55,
    fillComplete: 1.35,
    ambient: 2.85,
    ambientComplete: 2.2,
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
    opacityScale: 1.45,
    completedOpacity: 0.2,
    freezeTarget: 0.24,
  },
  particlesVisible: true,
  idleWobble: 1,
  core: {
    // 頂点カラー（真珠色のムラ）と乗算されるため、単色時より明るめに設定
    color: 0x9ca8c8,
    innerColor: 0x3e4a62,
    roughness: 0.92,
    hueBase: 0.62,
    hslSatBase: 0.34,
    hslLightBase: 0.54,
    shiftScale: 0.62,
    emissiveScale: 1.05,
    sheen: 0,
    sheenColor: 0x9fd9ff,
    iridescence: 0,
    clearcoat: 0,
    pearlVariation: 0.82,
  },
  completion: {
    mode: "breathe",
    seconds: 6,
    // 完成すると膜の真珠光沢が粘土側へ移り、「生きもの」から「作品」へ質が変わる。
    // clearcoatRoughness / sheenRoughness は高めに保ち、回転時のスペキュラ白飛びを避ける。
    finish: {
      clearcoat: 0.42,
      clearcoatRoughness: 0.62,
      sheen: 0.55,
      sheenRoughness: 0.8,
      iridescence: 0.34,
      iridescenceIOR: 1.32,
      roughness: 0.78,
    },
  },
  env: {
    background: 0x082838,
    backgroundComplete: 0x0a2030,
    exposure: 1.06,
    // 彫刻ライトは抑えめ。明るさ・青みは背景ドーム側で作る
    key: 1.2,
    keyComplete: 1.05,
    fill: 0.45,
    fillComplete: 0.38,
    ambient: 0.68,
    ambientComplete: 0.58,
    stars: true,
    environmentMap: false,
    // 明るい部屋（RoomEnvironment）ではなく、背景と同じ暗さの自作環境を彫刻にだけ映す
    abyssEnvironment: true,
    // 2026-08-10 にユーザーが実機で曲を鳴らして確定した値
    envMapIntensity: 0.74,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 220,
    hemisphereGround: 0x010408,
    fillColor: 0x2a5a78,
    rimLightIntensity: 0.28,
    rimLightColor: 0x6ecfff,
    backgroundProfile: {
      domeVariant: "abyss",
      openVoid: true,
      biolumeMotes: true,
      fogDensity: 0.0018,
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

/**
 * volume: 密度場ベース。造形は VolumeSculpture 側が持つので、
 * ここでは背景・ライティングなど環境まわりだけを定義する。
 */
const VOLUME: VisualStyleConfig = {
  id: "volume",
  label: "体積 — Sound Accretes Matter",
  themeDark: true,
  membrane: {
    visible: false,
    vita: false,
    opacityScale: 0,
    completedOpacity: 0,
    freezeTarget: 0.3,
  },
  particlesVisible: false,
  idleWobble: 0,
  core: {
    color: 0x9aa6c4,
    innerColor: 0x3e4a62,
    roughness: 0.86,
    hueBase: 0.6,
    hslSatBase: 0.22,
    hslLightBase: 0.52,
    shiftScale: 0.5,
    emissiveScale: 0.6,
    sheen: 0,
    sheenColor: 0x9fd9ff,
    iridescence: 0,
    clearcoat: 0,
    pearlVariation: 0,
  },
  completion: { mode: "breathe", seconds: 6 },
  env: {
    background: 0x0a1a26,
    backgroundComplete: 0x0c1e2c,
    exposure: 1.06,
    key: 1.5,
    keyComplete: 1.35,
    fill: 0.55,
    fillComplete: 0.48,
    ambient: 0.75,
    ambientComplete: 0.65,
    stars: true,
    // 等値面は素材感が主役になるので、反射する環境を与える
    environmentMap: true,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 220,
    hemisphereGround: 0x020609,
    fillColor: 0x2a5a78,
    rimLightIntensity: 0.34,
    rimLightColor: 0x6ecfff,
    backgroundProfile: {
      domeVariant: "abyss",
      openVoid: true,
      biolumeMotes: true,
      fogDensity: 0.0016,
    },
  },
};

/**
 * aether: 半透明の光体積。造形は AetherSculpture 側。
 * 目標見た目は参考動画 画面収録 2026-08-07 0.53.09（明るいミント地に柔らかい光の塊）。
 * 天気・時刻のフックは残すが、背景は vita の深海ではなく参考動画の淡色平面に合わせる。
 */
const AETHER: VisualStyleConfig = {
  id: "aether",
  label: "光体積 — Soft Volume Light",
  themeDark: false,
  membrane: {
    visible: false,
    vita: false,
    opacityScale: 0,
    completedOpacity: 0,
    freezeTarget: 0.3,
  },
  particlesVisible: false,
  idleWobble: 0,
  core: {
    color: 0xff7a4a,
    innerColor: 0x0a1020,
    roughness: 1,
    hueBase: 0.055,
    hslSatBase: 0.55,
    hslLightBase: 0.55,
    shiftScale: 0.45,
    emissiveScale: 1.2,
    sheen: 0,
    sheenColor: 0xffffff,
    iridescence: 0,
    clearcoat: 0,
    pearlVariation: 0,
  },
  completion: { mode: "breathe", seconds: 6 },
  env: {
    // 参考動画 0.53.09: フラットな淡ミント／オフホワイト。
    // 実測すると参考の背景は #d4e8e1。0xc5ddd6 は一段暗く、塊の淡い縁が
    // 背景より明るくなって輪郭が浮いていた（aether-sculpture.ts の pale と対で使う）
    background: 0xd4e8e1,
    backgroundComplete: 0xc4d8d1,
    exposure: 1.0,
    // 体積は自己発光。外部ライトは最小限
    key: 0.12,
    keyComplete: 0.1,
    fill: 0.18,
    fillComplete: 0.14,
    ambient: 0.9,
    ambientComplete: 0.75,
    stars: false,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 80,
    hemisphereGround: 0xa8c4be,
    fillColor: 0xd0e8e2,
    rimLightIntensity: 0,
    rimLightColor: 0xffffff,
    backgroundProfile: {
      openVoid: true,
      noStars: true,
      fogDensity: 0.00035,
    },
  },
};

export const VISUAL_STYLE_CATALOG: readonly VisualStyleConfig[] = [
  VITA,
  METAMORPHOSIS,
  MONOLITH,
  DITHER,
  LUMEN,
  VOLUME,
  AETHER,
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
    introTitle: SHARED_INTRO.title,
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
    introTitle: SHARED_INTRO.title,
    introDescription:
      "打点のひとつずつが、鈍い塊を削っていく。\n膜も光沢もなく、素材そのものが残り、\n音が止むと、展示のあかりが形を照らします。",
    introDescriptionEn:
      "Each strike carves at a dull mass. No membrane, no sheen—only the material itself—until the sound stops and exhibition light falls across the form.",
  },
  {
    id: "dither",
    label: DITHER.label,
    sculptureMode: "classic",
    visualStyleId: "dither",
    introTitle: SHARED_INTRO.title,
    introDescription:
      "音が階調を押し、網点のきめが輪郭を育てる。\n黒地に粒が定着し、\n有機的な塊として残ります。",
    introDescriptionEn:
      "Sound presses tone, and the grain of the halftone grows an edge. On black, the dots settle into an organic mass.",
  },
  {
    id: "lumen",
    label: LUMEN.label,
    sculptureMode: "lumen",
    visualStyleId: "lumen",
    introTitle: SHARED_INTRO.title,
    introDescription:
      "闇の虚空で、音が物質を削る。\n低域は質量、高域は輪郭、\nトランジェントは剥離として刻まれます。",
    introDescriptionEn:
      "In a dark void, sound carves matter. Bass is mass, treble is edge, transients flake away the surface.",
  },
  {
    id: "volume",
    label: VOLUME.label,
    sculptureMode: "volume",
    visualStyleId: "volume",
    introTitle: SHARED_INTRO.title,
    introDescription:
      "音が空間そのものへ堆積する。\n低音は塊を育て、中音は枝を伸ばし、\n高音は孔を穿ちます。",
    introDescriptionEn:
      "Sound accretes into space itself. Bass grows mass, mids extend branches, highs bore holes.",
  },
  {
    id: "aether",
    label: AETHER.label,
    sculptureMode: "aether",
    visualStyleId: "aether",
    introTitle: SHARED_INTRO.title,
    introDescription:
      "音が空間に光の質量を積み上げる。\n低音は中心の塊、中音は伸びる筋、\n高音は粒立つ輝きとして残ります。",
    introDescriptionEn:
      "Sound stacks luminous mass into space. Bass grows the core, mids draw filaments, highs leave grained glow.",
  },
];

/** 公開 UI・公開 URL で使うカタログ（生命 / 彫刻 / 網点） */
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
 * 公開サーフェスでは PUBLIC_EXPERIENCE_IDS 以外（変容・lumen 等）を vita へ落とす。
 * デフォルトは vita。
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
  else if (style === "volume") id = "volume";
  else if (style === "aether") id = "aether";

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
