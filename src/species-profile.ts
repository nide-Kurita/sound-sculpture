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
  locked: boolean;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

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
  locked: false,
};

const buildGains = (organic: number, aggressive: number, rhythmic: number): SpeciesProfile => {
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
    locked: true,
  };
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
  private calibrationSeconds = fibSeconds(7);
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
    this.calibrationSeconds = Math.max(fibSeconds(5), seconds);
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

  update(input: SpeciesSampleInput, bands: BandLevels, deltaTime: number, isActive: boolean) {
    if (!isActive) {
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

    if (this.profile.locked || this.activeSeconds < this.calibrationSeconds) {
      return;
    }

    const n = Math.max(1, this.sampleCount);
    const avgDensity = this.sumDensity / n;
    const avgTension = this.sumTension / n;
    const avgContrast = this.sumContrast / n;
    const avgBrightness = this.sumBrightness / n;
    const avgCentroid = this.sumCentroid / n;
    const avgPulse = this.sumPulseConfidence / n;
    const avgTransient = this.sumTransientRate / n;

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

    this.profile = buildGains(organic, aggressive, rhythmic);
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
