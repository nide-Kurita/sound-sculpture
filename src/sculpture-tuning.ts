import { fib, fibRatio, fibSeconds, fibUnit } from "./fibonacci";
import { setGrowthDeformInfluence } from "./growth-algorithm";

/** 開発パネル用の調整ノブ（6項目） */
export type SculptureTuning = {
  formation: number;
  pulse: number;
  liveSurface: number;
  liveMembrane: number;
  growth: number;
  mineral: number;
};

/** 実行時に参照する展開済みパラメータ */
export type RuntimeSculptureTuning = {
  accumRate: number;
  spikeCap: number;
  crystalScale: number;
  melodySculpt: number;
  flowPersist: number;
  liveLow: number;
  liveMid: number;
  liveHigh: number;
  flowLive: number;
  flowContrast: number;
  coreEmissive: number;
  coreColorShift: number;
  membraneLine: number;
  membraneFresnel: number;
  membraneNoise: number;
  globalFormEnergyScale: number;
  formStretchRate: number;
  formTwistAccumRate: number;
  formAsymmetryAccumRate: number;
  twistAlongFactor: number;
  asymmetryAlongFactor: number;
  asymmetrySidePull: number;
  growthAnchorGain: number;
  erosionDriveScale: number;
  accumMaxStepBase: number;
  accumMaxStepScale: number;
  melodyFlowDecay: number;
  melodyCurlBoost: number;
  pulseHold: number;
  pulseSqueeze: number;
  pulseConfidenceFloor: number;
  speciesCalibrationSeconds: number;
};

/**
 * スライダー既定位置 F₈/F₉ ≈ 0.618（黄金比付近）
 * min/max もフィボナッチ比率。max > 1 で既定より強められる。
 */
export const FIB_SLIDER_DEFAULT = fibUnit(8, 9);
const FIB_SLIDER_MIN = fibUnit(2, 7);
const FIB_SLIDER_MAX = fibRatio(7, 5);
const FIB_SLIDER_STEP = fibUnit(2, 11);

const knobScale = (knob: number) => knob / FIB_SLIDER_DEFAULT;

/**
 * 従来の既定挙動に相当するランタイム基準（F インデックスは fibonacci.ts の配列準拠）
 */
const RUNTIME_BASELINE: RuntimeSculptureTuning = {
  accumRate: fibUnit(2, 7),
  accumMaxStepBase: fibUnit(2, 12) * fibUnit(3, 8),
  accumMaxStepScale: fibUnit(5, 12) * fibUnit(2, 8),
  spikeCap: fibUnit(2, 7),
  crystalScale: fib(3),
  melodySculpt: fibUnit(8, 9) + fibUnit(2, 7),
  flowPersist: fibUnit(5, 8),
  liveLow: fibRatio(6, 5),
  liveMid: fibRatio(6, 5),
  liveHigh: fibRatio(6, 5),
  flowLive: fibUnit(5, 8),
  flowContrast: fibUnit(8, 10),
  coreEmissive: fibUnit(5, 7),
  coreColorShift: fibUnit(8, 10),
  membraneLine: fibUnit(8, 10),
  membraneFresnel: fibUnit(8, 9),
  membraneNoise: fibUnit(5, 8),
  globalFormEnergyScale: fibUnit(5, 6),
  formStretchRate: fibUnit(5, 6),
  formTwistAccumRate: fibUnit(8, 10),
  formAsymmetryAccumRate: fibUnit(5, 6),
  twistAlongFactor: fibUnit(5, 7),
  asymmetryAlongFactor: fibUnit(3, 7),
  asymmetrySidePull: fibUnit(5, 7),
  growthAnchorGain: fibUnit(8, 9),
  erosionDriveScale: fibUnit(5, 6),
  melodyFlowDecay: fibUnit(5, 8),
  melodyCurlBoost: fibUnit(8, 11),
  pulseHold: fibRatio(8, 5),
  pulseSqueeze: fibUnit(8, 9),
  pulseConfidenceFloor: fibUnit(8, 10),
  speciesCalibrationSeconds: fibSeconds(5),
};

export const DEFAULT_SCULPTURE_TUNING: SculptureTuning = {
  formation: FIB_SLIDER_MIN,
  pulse: FIB_SLIDER_DEFAULT,
  liveSurface: FIB_SLIDER_DEFAULT,
  liveMembrane: FIB_SLIDER_DEFAULT,
  growth: FIB_SLIDER_MIN,
  mineral: FIB_SLIDER_MIN,
};

export const expandSculptureTuning = (knobs: SculptureTuning): RuntimeSculptureTuning => {
  const formation = knobScale(knobs.formation);
  const pulse = knobScale(knobs.pulse);
  const surface = knobScale(knobs.liveSurface);
  const membrane = knobScale(knobs.liveMembrane);
  const growth = knobScale(knobs.growth);
  const mineral = knobScale(knobs.mineral);
  const b = RUNTIME_BASELINE;

  return {
    accumRate: b.accumRate * formation,
    accumMaxStepBase: b.accumMaxStepBase,
    accumMaxStepScale: b.accumMaxStepScale * formation,
    spikeCap: b.spikeCap * mineral,
    crystalScale: b.crystalScale * mineral,
    melodySculpt: b.melodySculpt * formation,
    flowPersist: b.flowPersist * formation,
    liveLow: b.liveLow * pulse,
    liveMid: b.liveMid * surface,
    liveHigh: b.liveHigh * membrane,
    flowLive: b.flowLive * surface,
    flowContrast: b.flowContrast * surface,
    coreEmissive: b.coreEmissive * membrane,
    coreColorShift: b.coreColorShift * membrane,
    membraneLine: b.membraneLine * membrane,
    membraneFresnel: b.membraneFresnel * membrane,
    membraneNoise: b.membraneNoise * membrane,
    globalFormEnergyScale: b.globalFormEnergyScale * growth,
    formStretchRate: b.formStretchRate * growth,
    formTwistAccumRate: b.formTwistAccumRate * growth,
    formAsymmetryAccumRate: b.formAsymmetryAccumRate * growth,
    twistAlongFactor: b.twistAlongFactor * growth,
    asymmetryAlongFactor: b.asymmetryAlongFactor * growth,
    asymmetrySidePull: b.asymmetrySidePull * growth,
    growthAnchorGain: b.growthAnchorGain * growth,
    erosionDriveScale: b.erosionDriveScale * growth,
    melodyFlowDecay: b.melodyFlowDecay * formation,
    melodyCurlBoost: b.melodyCurlBoost * formation,
    pulseHold: b.pulseHold * (fibUnit(5, 8) + pulse * fibUnit(8, 9)),
    pulseSqueeze: b.pulseSqueeze * pulse,
    pulseConfidenceFloor: b.pulseConfidenceFloor * (fibUnit(5, 8) + pulse * fibUnit(5, 9)),
    speciesCalibrationSeconds: b.speciesCalibrationSeconds,
  };
};

export const sculptureTuning: SculptureTuning = { ...DEFAULT_SCULPTURE_TUNING };

export let runtimeTuning: RuntimeSculptureTuning = expandSculptureTuning(sculptureTuning);

export const syncRuntimeTuning = () => {
  runtimeTuning = expandSculptureTuning(sculptureTuning);
  const formation = knobScale(sculptureTuning.formation);
  const growth = knobScale(sculptureTuning.growth);
  setGrowthDeformInfluence(Math.min(1.45, 0.48 + formation * 0.3 + growth * 0.44));
};

export const resetSculptureTuning = () => {
  Object.assign(sculptureTuning, DEFAULT_SCULPTURE_TUNING);
  syncRuntimeTuning();
};

syncRuntimeTuning();

export type TuningSliderGroup = "LIVE・呼吸" | "形成・成長";

export type TuningSliderSpec = {
  key: keyof SculptureTuning;
  label: string;
  help: string;
  group: TuningSliderGroup;
  scope: "live" | "form";
  min: number;
  max: number;
  step: number;
};

export const TUNING_SLIDER_SPECS: TuningSliderSpec[] = [
  {
    key: "pulse",
    label: "拍呼吸",
    help: "キック／アタックに同期した全体の鼓動。上げるほど脈動がはっきりします。",
    group: "LIVE・呼吸",
    scope: "live",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
  {
    key: "liveSurface",
    label: "表面 LIVE",
    help: "中音帯の表面うねりと流れ。メロディ・ドラムボディの即時変形に効きます。",
    group: "LIVE・呼吸",
    scope: "live",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
  {
    key: "liveMembrane",
    label: "膜 LIVE",
    help: "高音帯の膜・コア発光。ハイハットやシンバルのきらめきに効きます。",
    group: "LIVE・呼吸",
    scope: "live",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
  {
    key: "formation",
    label: "形成",
    help: "音の蓄積速度とうねり痕跡。上げるほど形が速く・深く刻まれます。成長アルゴリズムの変形効きにも影響します。",
    group: "形成・成長",
    scope: "form",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
  {
    key: "growth",
    label: "成長・侵食",
    help: "大域シルエットの変化、アンカー器官、侵食の進みやすさ。成長アルゴリズムの変形効きも強まります。",
    group: "形成・成長",
    scope: "form",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
  {
    key: "mineral",
    label: "棘・結晶",
    help: "高音由来の尖りと結晶化。メタル寄りの硬い質感を強めます。",
    group: "形成・成長",
    scope: "form",
    min: FIB_SLIDER_MIN,
    max: FIB_SLIDER_MAX,
    step: FIB_SLIDER_STEP,
  },
];

/** vita のブルーム（`SimpleBloomPass`）の現在値。パネルで追い込んだ値を報告に含めるため */
export type BloomTuningSnapshot = {
  enabled: boolean;
  threshold: number;
  strength: number;
};

/** vita の映り込み（`vita-environment.ts` の暗い環境マップ）の現在値 */
export type EnvTuningSnapshot = {
  enabled: boolean;
  intensity: number;
};

/** vita の粘土の肌理（`clay-grain.ts` の法線摂動）の現在値 */
export type ClayGrainTuningSnapshot = {
  strength: number;
  scale: number;
};

/** 曲による色の振れ幅（`audio-palette.ts` の songColorSpan）の現在値 */
export type SongColorTuningSnapshot = {
  hueSpan: number;
  satSpan: number;
};

/** vita の膜の折り重なりほどき（`main.ts` の membraneRelax）の現在値 */
export type MembraneRelaxTuningSnapshot = {
  enabled: boolean;
  iterations: number;
  strength: number;
};

/** vita の面内混色（`main.ts` の pearlColorMix）の現在値 */
export type PearlColorMixTuningSnapshot = {
  enabled: boolean;
  spread: number;
  balance: number;
};

/**
 * vita の宝石（鉱物）の面（`gem-material.ts` の gemUniforms）の現在値。
 * `axis` は**そのとき鳴っていた曲の音色軸**（自動なら曲が決めた値）。
 * 強度を判断するには軸がいくつだったかが要る（軸 0 なら何をしても出ない）。
 */
export type GemTuningSnapshot = {
  axis: number;
  axisOverride: boolean;
  facetStrength: number;
  gem: number;
  bodyDark: number;
  ridge: number;
  sparkle: number;
  through: number;
  fire: number;
};

export const formatSculptureTuningForAgent = (
  knobs: SculptureTuning = sculptureTuning,
  runtime: RuntimeSculptureTuning = runtimeTuning,
  growthAlgorithm = "fibonacci",
  bloom: BloomTuningSnapshot | null = null,
  environment: EnvTuningSnapshot | null = null,
  clayGrain: ClayGrainTuningSnapshot | null = null,
  songColor: SongColorTuningSnapshot | null = null,
  membraneRelax: MembraneRelaxTuningSnapshot | null = null,
  pearlColorMix: PearlColorMixTuningSnapshot | null = null,
  gem: GemTuningSnapshot | null = null,
) => {
  const bloomLines = bloom
    ? [
        "",
        "ブルーム（vita・bloom-pass.ts の DEFAULT_BLOOM_* へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(bloom, null, 2),
        "```",
      ]
    : [];
  const environmentLines = environment
    ? [
        "",
        "映り込み（vita・visual-style.ts の VITA.env.envMapIntensity へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(environment, null, 2),
        "```",
      ]
    : [];
  const clayGrainLines = clayGrain
    ? [
        "",
        "粘土の肌理（vita・clay-grain.ts の DEFAULT_CLAY_GRAIN_* へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(clayGrain, null, 2),
        "```",
      ]
    : [];
  const songColorLines = songColor
    ? [
        "",
        "曲の色の幅（audio-palette.ts の DEFAULT_SONG_*_SPAN へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(songColor, null, 2),
        "```",
      ]
    : [];
  const membraneRelaxLines = membraneRelax
    ? [
        "",
        "膜の折り重なり（vita・main.ts の DEFAULT_MEMBRANE_RELAX_* へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(membraneRelax, null, 2),
        "```",
      ]
    : [];
  const pearlColorMixLines = pearlColorMix
    ? [
        "",
        "混色の広がり（vita・main.ts の DEFAULT_PEARL_MIX_* へ焼き込む値）:",
        "",
        "```json",
        JSON.stringify(pearlColorMix, null, 2),
        "```",
      ]
    : [];
  const gemLines = gem
    ? [
        "",
        "宝石の面（vita・gem-material.ts の DEFAULT_GEM_* へ焼き込む値）:",
        "**axis は鳴らしていた曲の音色軸。0 なら結晶の面が1枚も無いので、何を上げても出ない。**",
        "",
        "```json",
        JSON.stringify(gem, null, 2),
        "```",
      ]
    : [];
  const lines = [
    "Sound Sculpture — 開発チューニング（AI agent 用）",
    "",
    `成長アルゴリズム: ${growthAlgorithm}`,
    "",
    "ノブ（パネル6項目）:",
    "",
    "```json",
    JSON.stringify(knobs, null, 2),
    "```",
    "",
    "展開済みランタイム値（内部参照用）:",
    "",
    "```json",
    JSON.stringify(runtime, null, 2),
    "```",
    "",
    "ノブの意味:",
    "- formation: 不可逆蓄積・うねり痕跡・メロディ彫刻",
    "- pulse: 拍呼吸（全体スクイーズ・パルス同期）",
    "- liveSurface: 中音表面 LIVE / curl flow",
    "- liveMembrane: 高音膜・コア発光",
    "- growth: 大域形・アンカー・侵食",
    "- mineral: 棘・結晶",
    "",
    `スライダー中央 F₈/F₉ ≈ ${FIB_SLIDER_DEFAULT.toFixed(3)} で従来の既定挙動。`,
    ...bloomLines,
    ...environmentLines,
    ...clayGrainLines,
    ...songColorLines,
    ...membraneRelaxLines,
    ...pearlColorMixLines,
    ...gemLines,
  ];
  return lines.join("\n");
};
