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
    spikeGain: fibUnit(3, 8) + aggressive * fibUnit(8, 9),
    crystalGain: fibUnit(2, 8) + aggressive * fibRatio(8, 2) + mineral * fibUnit(5, 13),
    tentacleGain: fibUnit(3, 8) + organic * fibUnit(8, 9),
    erosionGain: fibUnit(2, 8) + aggressive * fibRatio(5, 3) + mineral * fibUnit(3, 13),
    fragmentGain: fibUnit(2, 8) + aggressive * fibRatio(8, 2),
    membraneGain: fibUnit(5, 8) + organic * fibUnit(8, 9) + rhythmic * fibUnit(5, 13),
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
  avgBassFocus: number,
  avgMelodyFocus: number,
  avgNovelty: number,
  avgEventRate: number,
  _avgOverall: number,
  loudRatio: number,
  densityVar: number,
  _tensionVar: number,
  contrastVar: number,
  _brightnessVar: number,
  sectionContrast: number,
) => {
  // Sustained loudness + bright grit separates wall-of-sound metal/prog from loud-but-dark alt rock.
  const loudHard = smoothstep(0.72, 0.96, loudRatio);
  const softDyn = smoothstep(0.04, 0.45, sectionContrast) * (1 - loudHard * 0.55);
  const grit = clamp01(
    smoothstep(0.55, 0.85, loudRatio) * smoothstep(0.145, 0.22, avgBrightness) * 1.15 +
      smoothstep(0.16, 0.24, avgBrightness) * 0.35,
  );
  // 中音圧＋高パルスのグルーヴ（Fly Away 系）と、明るく静かめの器楽（Peaches 系）を分ける
  const grooveLead = clamp01(
    smoothstep(0.86, 0.95, avgPulse) *
      smoothstep(0.4, 0.5, loudRatio) *
      (1 - smoothstep(0.58, 0.78, loudRatio)),
  );
  const brightSoft = clamp01(
    smoothstep(0.17, 0.24, avgBrightness) * (1 - smoothstep(0.4, 0.7, loudRatio)),
  );
  const organic = clamp01(
    0.44 -
      avgDensity * 0.12 -
      avgBassFocus * 0.05 -
      loudHard * 0.2 -
      grit * 0.25 -
      brightSoft * 0.1 -
      grooveLead * 0.05 +
      softDyn * 0.38 +
      avgMelodyFocus * 0.68 +
      avgCentroid * 0.4 +
      sectionContrast * 0.5 +
      contrastVar * 0.4 -
      avgTransient * 0.06,
  );
  const aggressive = clamp01(
    0.12 +
      loudHard * 0.34 +
      grit * 0.48 +
      brightSoft * 0.14 +
      grooveLead * 0.12 +
      avgContrast * 0.12 +
      avgBrightness * 0.1 +
      avgTension * 0.14 +
      avgTransient * 0.08 +
      avgNovelty * 0.08 +
      avgEventRate * 0.07 -
      avgMelodyFocus * 0.16 -
      softDyn * 0.28,
  );
  const rhythmic = clamp01(
    0.02 +
      avgPulse * 0.42 +
      grooveLead * 0.22 +
      avgDensity * 0.06 +
      densityVar * 0.2 +
      avgEventRate * 0.2 +
      sectionContrast * 0.1 -
      avgTransient * 0.04,
  );
  return { organic, aggressive, rhythmic };
};

export type SpeciesSampleInput = {
  density: number;
  tension: number;
  contrast: number;
  brightness: number;
  bassFocus: number;
  melodyFocus: number;
  centroid: number;
  pulseConfidence: number;
  transientRate: number;
  novelty: number;
  eventRate: number;
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
  private sumMelodyFocus = 0;
  private sumCentroid = 0;
  private sumPulseConfidence = 0;
  private sumTransientRate = 0;
  private sumNovelty = 0;
  private sumEventRate = 0;
  private sumOverall = 0;
  private loudSampleCount = 0;
  private softSampleCount = 0;
  private sumDensitySq = 0;
  private sumTensionSq = 0;
  private sumContrastSq = 0;
  private sumBrightnessSq = 0;
  private earlyCount = 0;
  private earlyCentroid = 0;
  private earlyBrightness = 0;
  private earlyMelodyFocus = 0;
  private lateCount = 0;
  private lateCentroid = 0;
  private lateBrightness = 0;
  private lateMelodyFocus = 0;
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
    this.sumMelodyFocus = 0;
    this.sumCentroid = 0;
    this.sumPulseConfidence = 0;
    this.sumTransientRate = 0;
    this.sumNovelty = 0;
    this.sumEventRate = 0;
    this.sumOverall = 0;
    this.loudSampleCount = 0;
    this.softSampleCount = 0;
    this.sumDensitySq = 0;
    this.sumTensionSq = 0;
    this.sumContrastSq = 0;
    this.sumBrightnessSq = 0;
    this.earlyCount = 0;
    this.earlyCentroid = 0;
    this.earlyBrightness = 0;
    this.earlyMelodyFocus = 0;
    this.lateCount = 0;
    this.lateCentroid = 0;
    this.lateBrightness = 0;
    this.lateMelodyFocus = 0;
    this.profile = { ...DEFAULT_SPECIES_PROFILE };
  }

  getProfile(): SpeciesProfile {
    return this.profile;
  }

  private getAverages() {
    const n = Math.max(1, this.sampleCount);
    const avgDensity = this.sumDensity / n;
    const avgTension = this.sumTension / n;
    const avgContrast = this.sumContrast / n;
    const avgBrightness = this.sumBrightness / n;
    const avgCentroid = this.sumCentroid / n;
    const avgPulse = this.sumPulseConfidence / n;
    const avgTransient = this.sumTransientRate / n;
    const avgBassFocus = this.sumBassFocus / n;
    const avgMelodyFocus = this.sumMelodyFocus / n;
    const avgNovelty = this.sumNovelty / n;
    const avgEventRate = this.sumEventRate / n;
    const avgOverall = this.sumOverall / n;
    const loudRatio = this.loudSampleCount / n;
    const softRatio = this.softSampleCount / n;
    const densityVar = Math.max(0, this.sumDensitySq / n - avgDensity * avgDensity);
    const tensionVar = Math.max(0, this.sumTensionSq / n - avgTension * avgTension);
    const contrastVar = Math.max(0, this.sumContrastSq / n - avgContrast * avgContrast);
    const brightnessVar = Math.max(0, this.sumBrightnessSq / n - avgBrightness * avgBrightness);
    const earlyCentroid = this.earlyCount > 0 ? this.earlyCentroid / this.earlyCount : avgCentroid;
    const earlyBrightness = this.earlyCount > 0 ? this.earlyBrightness / this.earlyCount : avgBrightness;
    const earlyMelodyFocus = this.earlyCount > 0 ? this.earlyMelodyFocus / this.earlyCount : avgMelodyFocus;
    const lateCentroid = this.lateCount > 0 ? this.lateCentroid / this.lateCount : avgCentroid;
    const lateBrightness = this.lateCount > 0 ? this.lateBrightness / this.lateCount : avgBrightness;
    const lateMelodyFocus = this.lateCount > 0 ? this.lateMelodyFocus / this.lateCount : avgMelodyFocus;
    const sectionContrast = clamp01(
      Math.abs(lateCentroid - earlyCentroid) * 0.75 +
        Math.abs(lateBrightness - earlyBrightness) * 0.6 +
        Math.abs(lateMelodyFocus - earlyMelodyFocus) * 0.95 +
        Math.sqrt(Math.max(0, softRatio) * Math.max(0, loudRatio)) * 2.4 +
        contrastVar * 0.55,
    );
    return {
      avgDensity,
      avgTension,
      avgContrast,
      avgBrightness,
      avgCentroid,
      avgPulse,
      avgTransient,
      avgBassFocus,
      avgMelodyFocus,
      avgNovelty,
      avgEventRate,
      avgOverall,
      loudRatio,
      densityVar,
      tensionVar,
      contrastVar,
      brightnessVar,
      sectionContrast,
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
    this.sumMelodyFocus += input.melodyFocus;
    this.sumCentroid += bands.centroid;
    this.sumPulseConfidence += input.pulseConfidence;
    this.sumTransientRate += input.transientRate;
    this.sumNovelty += input.novelty;
    this.sumEventRate += input.eventRate;
    this.sumOverall += bands.overall;
    if (bands.overall > 0.66) {
      this.loudSampleCount += 1;
    }
    if (bands.overall < 0.18) {
      this.softSampleCount += 1;
    }
    this.sumDensitySq += input.density * input.density;
    this.sumTensionSq += input.tension * input.tension;
    this.sumContrastSq += bands.contrast * bands.contrast;
    this.sumBrightnessSq += bands.brightness * bands.brightness;

    if (this.activeSeconds <= 12) {
      this.earlyCount += 1;
      this.earlyCentroid += bands.centroid;
      this.earlyBrightness += bands.brightness;
      this.earlyMelodyFocus += input.melodyFocus;
    } else if (this.activeSeconds >= 24) {
      this.lateCount += 1;
      this.lateCentroid += bands.centroid;
      this.lateBrightness += bands.brightness;
      this.lateMelodyFocus += input.melodyFocus;
    }

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
      avgs.avgBassFocus,
      avgs.avgMelodyFocus,
      avgs.avgNovelty,
      avgs.avgEventRate,
      avgs.avgOverall,
      avgs.loudRatio,
      avgs.densityVar,
      avgs.tensionVar,
      avgs.contrastVar,
      avgs.brightnessVar,
      avgs.sectionContrast,
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
      avgs.avgBassFocus,
      avgs.avgMelodyFocus,
      avgs.avgNovelty,
      avgs.avgEventRate,
      avgs.avgOverall,
      avgs.loudRatio,
      avgs.densityVar,
      avgs.tensionVar,
      avgs.contrastVar,
      avgs.brightnessVar,
      avgs.sectionContrast,
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
  const hardness = clamp01(0.5 + (a - o) * 0.9 + smoothstep(0.4, 0.55, a) * 0.18);
  const softness = 1 - hardness;
  // soft: 高 organic → coral（ゲートを少し厳しくして偏りを抑える）
  const coralGate = smoothstep(0.38, 0.64, o);
  const coralWeight = softness * coralGate * (0.85 + o * 0.35);
  const diaboloWeight = softness * (1 - coralGate * 0.75) * (0.72 + (1 - a) * 0.16);
  // hard: tip → spindle、塊 → monolith
  const tipGate = smoothstep(0.35, 0.65, a) * (0.4 + smoothstep(0.28, 0.55, r) * 0.6);
  const spindleWeight = hardness * tipGate;
  const monolithWeight = hardness * (1 - tipGate * 0.7) * (0.95 + smoothstep(0.4, 0.55, a) * 0.25);
  // 柔らかい高 rhythmic では torus を残し、硬い種では抑える
  const torusWeight =
    (r * (0.62 + hardness * 0.15 + softness * 0.28) + smoothstep(0.52, 0.82, r) * 0.28) *
    (1 - hardness * 0.5);

  return {
    diabolo: fibUnit(2, 21) + diaboloWeight * fibUnit(13, 21) + r * fibUnit(2, 34),
    coral: fibUnit(1, 34) + coralWeight * fibRatio(8, 5) + o * fibUnit(8, 21),
    monolith: fibUnit(1, 21) + monolithWeight * fibRatio(8, 5) + (1 - o) * fibUnit(5, 21),
    spindle: fibUnit(1, 34) + spindleWeight * fibRatio(8, 5) + a * fibUnit(8, 21),
    torus: fibUnit(1, 21) + torusWeight * fibRatio(8, 5) + r * fibUnit(5, 21),
  };
};
