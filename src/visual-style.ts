/**
 * ビジュアルスタイル — classic モードの見た目と完成時の振る舞いを差し替えるレイヤー。
 *
 * - metamorphosis: 形成中は生命体、音が止まると石化・結晶化して彫刻として完成する
 * - vita:          生命に振り切る。暗い環境で膜が真珠光沢に輝き、完成後も呼吸を続ける
 * - monolith:      彫刻に振り切る。膜なし・素材感重視、完成でギャラリー照明が灯る
 */

export type VisualStyleId = "metamorphosis" | "vita" | "monolith";

export type BackgroundProfile = {
  studioSpace?: boolean;
  dustMotes?: boolean;
  domeVariant?: "default" | "studio" | "abyss";
  /** 可視床を出さず開放空間にする（vita） */
  openVoid?: boolean;
  /** 疎な生物発光粒子（vita） */
  biolumeMotes?: boolean;
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
  introTitle: string;
  introDescription: string;
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

const METAMORPHOSIS: VisualStyleConfig = {
  id: "metamorphosis",
  label: "変容 — 生命が彫刻になる",
  introTitle: "音で彫刻する",
  introDescription:
    "音は膜の中で生命のように蠢き、形を蓄積します。演奏が終わり静寂が訪れると生命は結晶化し、音の記憶を刻んだ鉱物の彫刻として完成します。",
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
    backgroundProfile: {
      studioSpace: true,
      dustMotes: true,
      domeVariant: "studio",
    },
  },
};

const VITA: VisualStyleConfig = {
  id: "vita",
  label: "生命 — 神秘の生命体",
  introTitle: "音で育てる生命",
  introDescription:
    "音を糧に、深海のような闇の中で生命体が育ちます。膜は真珠のように輝き、完成後もあなたの音の鼓動を記憶して呼吸し続けます。",
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
    key: 1.95,
    keyComplete: 1.72,
    fill: 0.82,
    fillComplete: 0.72,
    ambient: 0.56,
    ambientComplete: 0.48,
    stars: true,
    environmentMap: false,
    pedestal: false,
    spotlight: false,
    spotlightIntensity: 0,
    cameraFar: 220,
    hemisphereGround: 0x0c1018,
    fillColor: 0x6a7280,
    rimLightIntensity: 0.26,
    rimLightColor: 0x3d4f62,
    backgroundProfile: {
      domeVariant: "abyss",
      openVoid: true,
      biolumeMotes: true,
      fogDensity: 0.0022,
    },
  },
};

const MONOLITH: VisualStyleConfig = {
  id: "monolith",
  label: "彫刻 — 石とブロンズ",
  introTitle: "音で刻む彫刻",
  introDescription:
    "低音が量塊を盛り、中音が面を流し、高音がノミの跡を刻みます。静寂とともにギャラリーの照明が灯り、音の性質から生まれた素材 — 大理石、ブロンズ、黒曜石 — の彫刻が現れます。",
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
    pedestal: true,
    spotlight: true,
    spotlightIntensity: 3.4,
  },
};

export const VISUAL_STYLE_CATALOG: readonly VisualStyleConfig[] = [
  METAMORPHOSIS,
  VITA,
  MONOLITH,
];

/** classic 以外のモード用 — 従来どおりの環境（完成時も変化しない） */
export const NEUTRAL_ENVIRONMENT: VisualStyleEnv = {
  background: 0xf7f6f2,
  backgroundComplete: 0xf7f6f2,
  exposure: 1.08,
  key: 3.4,
  keyComplete: 3.4,
  fill: 1.1,
  fillComplete: 1.1,
  ambient: 2.4,
  ambientComplete: 2.4,
  stars: true,
  environmentMap: false,
  pedestal: false,
  spotlight: false,
  spotlightIntensity: 0,
};

export const getVisualStyle = (id: VisualStyleId): VisualStyleConfig =>
  VISUAL_STYLE_CATALOG.find((style) => style.id === id) ?? METAMORPHOSIS;

export const parseVisualStyleId = (): VisualStyleId => {
  const param = new URLSearchParams(window.location.search).get("style");
  if (param === "vita") return "vita";
  if (param === "monolith") return "monolith";
  return "metamorphosis";
};

let activeStyle: VisualStyleConfig = METAMORPHOSIS;

export const setActiveVisualStyle = (id: VisualStyleId) => {
  activeStyle = getVisualStyle(id);
};

export const getActiveVisualStyle = () => activeStyle;
