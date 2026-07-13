import type { BandLevels } from "./band-test";
import { fibRatio, fibSeconds, fibUnit } from "./fibonacci";

export type SpeciesProfile = {
  organic: number;
  aggressive: number;
  rhythmic: number;
  flowGain: number;
  spikeGain: number;
  crystalGain: number;
  tentacleGain: number;
  erosionGain: number;
  fragmentGain: number;
  membraneGain: number;
  /** 完成時に確定済み — 以降 update は停止 */
  finalized: boolean;
  /** ウォームアップ後の種信頼度 0〜1（モルフォロジーブレンド用） */
  confidence: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

/** EMA 時定数 ~12 秒 */
const SPECIES_EMA_RATE = 1 / 12;

export const DEFAULT_SPECIES_PROFILE: SpeciesProfile = {
  organic: fibUnit(8, 13),
  aggressive: fibUnit(5, 13),
  rhythmic: fibUnit(5, 8),
  flowGain: 1,
  spikeGain: 1,
  crystalGain: 1,
  tentacleGain: 1,
  erosionGain: 1,
  fragmentGain: 1,
  membraneGain: 1,
  finalized: false,
  confidence: 0,
};

const applyGains = (
  organic: number,
  aggressive: number,
  rhythmic: number,
  finalized: boolean,
  confidence: number,
): SpeciesProfile => {
  const mineral = 1 - organic;

  return {
    organic,
    aggressive,
    rhythmic,
    flowGain: fibUnit(5, 8) + organic * fibRatio(8, 5),
    spikeGain: fibUnit(3, 8) + aggressive * fibRatio(8, 3),
    crystalGain: fibUnit(2, 8) + aggressive * fibRatio(8, 2) + mineral * fibUnit(5, 13),
    tentacleGain: fibUnit(3, 8) + organic * fibRatio(8, 3),
    erosionGain: fibUnit(2, 8) + aggressive * fibRatio(5, 3) + mineral * fibUnit(3, 13),
    fragmentGain: fibUnit(2, 8) + aggressive * fibRatio(8, 2),
    membraneGain: fibUnit(3, 8) + organic * fibRatio(8, 3) + rhythmic * fibUnit(5, 13),
    finalized,
    confidence,
  };
};

const computeAxesFromAverages = (
  avgDensity: number,
  avgTension: number,
  avgContrast: number,
  avgBrightness: number,
  avgCentroid: number,
  avgPulse: number,
  avgTransient: number,
) => {
  const organic = clamp01(
    (1 - avgDensity) * fibUnit(8, 21) +
      (1 - avgContrast) * fibUnit(5, 21) +
      smoothstep(fibUnit(5, 21), fibUnit(13, 21), avgCentroid) * fibUnit(8, 13) +
      (1 - avgTransient) * fibUnit(3, 13),
  );
  const aggressive = clamp01(
    avgContrast * fibUnit(8, 21) +
      avgBrightness * fibUnit(5, 13) +
      avgTension * fibUnit(5, 21) +
      avgTransient * fibUnit(8, 13) +
      avgDensity * fibUnit(3, 21),
  );
  const rhythmic = clamp01(
    avgPulse * fibRatio(8, 13) + avgDensity * fibUnit(5, 13) + (1 - avgTransient) * fibUnit(5, 21),
  );
  return { organic, aggressive, rhythmic };
};

export type SpeciesSampleInput = {
  density: number;
  tension: number;
  contrast: number;
  brightness: number;
  bassFocus: number;
  centroid: number;
  pulseConfidence: number;
  transientRate: number;
};

export class SpeciesProfiler {
  /** ウォームアップ秒数 — この間は種の影響が弱い */
  private warmupSeconds = fibSeconds(5);
  private activeSeconds = 0;
  private sampleCount = 0;
  private sumDensity = 0;
  private sumTension = 0;
  private sumContrast = 0;
  private sumBrightness = 0;
  private sumBassFocus = 0;
  private sumCentroid = 0;
  private sumPulseConfidence = 0;
  private sumTransientRate = 0;
  private profile: SpeciesProfile = { ...DEFAULT_SPECIES_PROFILE };

  setCalibrationSeconds(seconds: number) {
    this.warmupSeconds = Math.max(fibSeconds(3), seconds);
  }

  getWarmupSeconds() {
    return this.warmupSeconds;
  }

  reset() {
    this.activeSeconds = 0;
    this.sampleCount = 0;
    this.sumDensity = 0;
    this.sumTension = 0;
    this.sumContrast = 0;
    this.sumBrightness = 0;
    this.sumBassFocus = 0;
    this.sumCentroid = 0;
    this.sumPulseConfidence = 0;
    this.sumTransientRate = 0;
    this.profile = { ...DEFAULT_SPECIES_PROFILE };
  }

  getProfile(): SpeciesProfile {
    return this.profile;
  }

  private getAverages() {
    const n = Math.max(1, this.sampleCount);
    return {
      avgDensity: this.sumDensity / n,
      avgTension: this.sumTension / n,
      avgContrast: this.sumContrast / n,
      avgBrightness: this.sumBrightness / n,
      avgCentroid: this.sumCentroid / n,
      avgPulse: this.sumPulseConfidence / n,
      avgTransient: this.sumTransientRate / n,
    };
  }

  private getConfidence() {
    return smoothstep(this.warmupSeconds, this.warmupSeconds + 8, this.activeSeconds);
  }

  private applyTargets(organic: number, aggressive: number, rhythmic: number, deltaTime: number) {
    const confidence = this.getConfidence();
    const rate = Math.min(1, deltaTime * SPECIES_EMA_RATE * 3);
    const nextOrganic = this.profile.organic + (organic - this.profile.organic) * rate;
    const nextAggressive = this.profile.aggressive + (aggressive - this.profile.aggressive) * rate;
    const nextRhythmic = this.profile.rhythmic + (rhythmic - this.profile.rhythmic) * rate;
    this.profile = applyGains(nextOrganic, nextAggressive, nextRhythmic, false, confidence);
  }

  update(input: SpeciesSampleInput, bands: BandLevels, deltaTime: number, isActive: boolean) {
    if (!isActive || this.profile.finalized) {
      return;
    }

    this.activeSeconds += deltaTime;
    this.sampleCount += 1;
    this.sumDensity += input.density;
    this.sumTension += input.tension;
    this.sumContrast += bands.contrast;
    this.sumBrightness += bands.brightness;
    this.sumBassFocus += bands.bassFocus;
    this.sumCentroid += bands.centroid;
    this.sumPulseConfidence += input.pulseConfidence;
    this.sumTransientRate += input.transientRate;

    if (this.activeSeconds < this.warmupSeconds) {
      this.profile = { ...DEFAULT_SPECIES_PROFILE, confidence: this.getConfidence() };
      return;
    }

    const avgs = this.getAverages();
    const { organic, aggressive, rhythmic } = computeAxesFromAverages(
      avgs.avgDensity,
      avgs.avgTension,
      avgs.avgContrast,
      avgs.avgBrightness,
      avgs.avgCentroid,
      avgs.avgPulse,
      avgs.avgTransient,
    );
    this.applyTargets(organic, aggressive, rhythmic, deltaTime);
  }

  /**
   * 完成直前に曲全体の平均から種を確定する。
   * ウォームアップ未満の極短曲は部分平均または DEFAULT にフォールバック。
   */
  finalizeProfile(): SpeciesProfile {
    if (this.profile.finalized) {
      return this.profile;
    }

    if (this.sampleCount < 1 || this.activeSeconds < this.warmupSeconds * 0.25) {
      this.profile = { ...DEFAULT_SPECIES_PROFILE, finalized: true, confidence: 1 };
      return this.profile;
    }

    const avgs = this.getAverages();
    const { organic, aggressive, rhythmic } = computeAxesFromAverages(
      avgs.avgDensity,
      avgs.avgTension,
      avgs.avgContrast,
      avgs.avgBrightness,
      avgs.avgCentroid,
      avgs.avgPulse,
      avgs.avgTransient,
    );
    this.profile = applyGains(organic, aggressive, rhythmic, true, 1);
    return this.profile;
  }
}

/** 種確定後のモルフォロジー目標（bands より species を優先） */
export const speciesMorphTargets = (
  sp: SpeciesProfile,
): { diabolo: number; torus: number; monolith: number; coral: number; spindle: number } => {
  const o = sp.organic;
  const a = sp.aggressive;
  const r = sp.rhythmic;
  return {
    diabolo: fibUnit(3, 21) + o * fibUnit(13, 21) + r * fibUnit(5, 21),
    torus: fibUnit(2, 21) + r * fibUnit(8, 21) + (1 - a) * fibUnit(5, 21),
    monolith: fibUnit(5, 21) + a * fibUnit(13, 21),
    coral: fibUnit(5, 21) + o * fibUnit(21, 21),
    spindle: fibUnit(3, 21) + a * fibUnit(13, 21) + (1 - o) * fibUnit(5, 21),
  };
};
