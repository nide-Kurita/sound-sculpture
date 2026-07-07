import type { BandLevels } from "./band-test";

export type RhythmSnapshot = {
  beat: number;
  beatIndex: number;
  kick: number;
  kickIndex: number;
  snare: number;
  hat: number;
  transient: number;
  downbeat: boolean;
  bpm: number;
  pulsePhase: number;
  pulseConfidence: number;
  pulseEnvelope: number;
};

export type GrowthEventFlags = {
  noveltyPeak: boolean;
  energySurge: boolean;
  energyDrop: boolean;
  transientBurst: boolean;
  pulseStable: boolean;
};

export type StructureSnapshot = {
  energyLong: number;
  energyMid: number;
  tension: number;
  density: number;
  novelty: number;
  breathCycle: number;
  phase: GrowthPhase;
  organBudget: number;
  organicScore: number;
  mineralScore: number;
  formationRamp: number;
  detailRamp: number;
  events: GrowthEventFlags;
  lastEventLabel: string;
};

export type GrowthPhase = "embryo" | "growth" | "metamorphosis" | "hardening";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

export class StructureTracker {
  private energyLong = 0;
  private energyMid = 0;
  private energyShort = 0;
  private tension = 0;
  private centroidLong = 0.5;
  private centroidMid = 0.5;
  private contrastLong = 0;
  private brightnessLong = 0;
  private bassFocusLong = 0;
  private beatTimestamps: number[] = [];
  private transientBurstWindow: number[] = [];
  private elapsed = 0;
  private organBudget = 0;
  private phase: GrowthPhase = "embryo";
  private activeSeconds = 0;
  private noveltyPeak = 0;
  private noveltyCooldown = 0;
  private energySurgeCooldown = 0;
  private energyDropCooldown = 0;
  private transientBurstCooldown = 0;
  private lastEventLabel = "—";
  private kickStreak = 0;
  private transientRate = 0;

  reset() {
    this.energyLong = 0;
    this.energyMid = 0;
    this.energyShort = 0;
    this.tension = 0;
    this.centroidLong = 0.5;
    this.centroidMid = 0.5;
    this.contrastLong = 0;
    this.brightnessLong = 0;
    this.bassFocusLong = 0;
    this.beatTimestamps = [];
    this.transientBurstWindow = [];
    this.elapsed = 0;
    this.organBudget = 0;
    this.phase = "embryo";
    this.activeSeconds = 0;
    this.noveltyPeak = 0;
    this.noveltyCooldown = 0;
    this.energySurgeCooldown = 0;
    this.energyDropCooldown = 0;
    this.transientBurstCooldown = 0;
    this.lastEventLabel = "—";
    this.kickStreak = 0;
    this.transientRate = 0;
  }

  update(bands: BandLevels, rhythm: RhythmSnapshot, deltaTime: number, isActive: boolean): StructureSnapshot {
    const overall = bands.overall;
    const longAlpha = 1 - Math.exp(-deltaTime * 0.35);
    const midAlpha = 1 - Math.exp(-deltaTime * 1.8);
    const shortAlpha = 1 - Math.exp(-deltaTime * 6.5);

    this.energyLong += (overall - this.energyLong) * longAlpha;
    this.energyMid += (overall - this.energyMid) * midAlpha;
    this.energyShort += (overall - this.energyShort) * shortAlpha;
    this.centroidLong += (bands.centroid - this.centroidLong) * longAlpha;
    this.centroidMid += (bands.centroid - this.centroidMid) * midAlpha;
    this.contrastLong += (bands.contrast - this.contrastLong) * longAlpha;
    this.brightnessLong += (bands.brightness - this.brightnessLong) * longAlpha;
    this.bassFocusLong += (bands.bassFocus - this.bassFocusLong) * longAlpha;

    const centroidDelta = Math.abs(bands.centroid - this.centroidMid);
    const tensionTarget = clamp01(
      bands.contrast * 0.34 +
        bands.brightness * 0.28 +
        centroidDelta * 1.6 +
        this.energyMid * 0.22,
    );
    this.tension += (tensionTarget - this.tension) * midAlpha;

    if (isActive) {
      this.activeSeconds += deltaTime;
    }

    this.elapsed += deltaTime;
    if (rhythm.beat > 0.02) {
      this.beatTimestamps.push(this.elapsed);
    }
    while (this.beatTimestamps.length > 0 && this.elapsed - this.beatTimestamps[0] > 8) {
      this.beatTimestamps.shift();
    }
    const density = clamp01((this.beatTimestamps.length / 8) * 0.62);

    const novelty =
      Math.abs(bands.centroid - this.centroidLong) * 1.4 +
      Math.abs(bands.contrast - this.contrastLong) * 0.9 +
      Math.abs(bands.brightness - this.brightnessLong) * 0.75 +
      Math.abs(this.energyMid - this.energyLong) * 1.1;
    const noveltyClamped = clamp01(novelty);

    this.noveltyCooldown = Math.max(0, this.noveltyCooldown - deltaTime);
    this.energySurgeCooldown = Math.max(0, this.energySurgeCooldown - deltaTime);
    this.energyDropCooldown = Math.max(0, this.energyDropCooldown - deltaTime);
    this.transientBurstCooldown = Math.max(0, this.transientBurstCooldown - deltaTime);

    let noveltyPeakEvent = false;
    if (noveltyClamped > this.noveltyPeak + 0.14 && this.noveltyCooldown <= 0) {
      noveltyPeakEvent = true;
      this.noveltyCooldown = 2.2;
      this.lastEventLabel = "novelty";
    }
    this.noveltyPeak = noveltyPeakEvent ? noveltyClamped : this.noveltyPeak * Math.exp(-deltaTime * 0.35);

    const energyDelta = this.energyShort - this.energyLong;
    let energySurge = false;
    if (energyDelta > 0.12 && this.energySurgeCooldown <= 0) {
      energySurge = true;
      this.energySurgeCooldown = 1.8;
      this.lastEventLabel = "surge";
    }
    let energyDrop = false;
    if (energyDelta < -0.08 && this.energyDropCooldown <= 0 && this.energyLong > 0.06) {
      energyDrop = true;
      this.energyDropCooldown = 2.4;
      this.lastEventLabel = "drop";
    }

    if (rhythm.transient > 0.08) {
      this.transientBurstWindow.push(this.elapsed);
    }
    while (this.transientBurstWindow.length > 0 && this.elapsed - this.transientBurstWindow[0] > 1.2) {
      this.transientBurstWindow.shift();
    }
    let transientBurst = false;
    if (this.transientBurstWindow.length >= 4 && this.transientBurstCooldown <= 0) {
      transientBurst = true;
      this.transientBurstCooldown = 1.5;
      this.lastEventLabel = "burst";
    }

    if (rhythm.kick > 0.02) {
      this.kickStreak = Math.min(16, this.kickStreak + 1);
    } else {
      this.kickStreak = Math.max(0, this.kickStreak - deltaTime * 2.5);
    }
    this.transientRate += (rhythm.transient - this.transientRate) * Math.min(1, deltaTime * 6);

    const pulseStable = rhythm.pulseConfidence > 0.55;
    const breathCycle = clamp01(rhythm.pulseEnvelope * rhythm.pulseConfidence);

    this.updatePhase(noveltyClamped, density, isActive, deltaTime);
    this.updateOrganBudget(
      density,
      noveltyClamped,
      energySurge,
      transientBurst,
      deltaTime,
      isActive,
    );

    const organicScore = clamp01(
      (1 - density) * 0.28 +
        (1 - this.contrastLong) * 0.2 +
        smoothstep(0.2, 0.55, this.centroidLong) * 0.3,
    );
    const mineralScore = clamp01(
      density * 0.38 +
        (1 - organicScore) * 0.32 +
        smoothstep(0.35, 0.85, this.brightnessLong) * 0.2 +
        this.transientRate * 0.35,
    );

    const formationRamp = smoothstep(0, 18, this.activeSeconds);
    const detailRamp = smoothstep(12, 90, this.activeSeconds) * smoothstep(0.08, 0.35, this.energyLong);

    return {
      energyLong: this.energyLong,
      energyMid: this.energyMid,
      tension: this.tension,
      density,
      novelty: noveltyClamped,
      breathCycle,
      phase: this.phase,
      organBudget: this.organBudget,
      organicScore,
      mineralScore,
      formationRamp,
      detailRamp,
      events: {
        noveltyPeak: noveltyPeakEvent,
        energySurge,
        energyDrop,
        transientBurst,
        pulseStable,
      },
      lastEventLabel: this.lastEventLabel,
    };
  }

  private updatePhase(novelty: number, density: number, isActive: boolean, deltaTime: number) {
    if (!isActive) {
      return;
    }

    const t = this.activeSeconds;
    if (this.phase === "embryo" && t > 6 && this.energyMid > 0.04) {
      this.phase = "growth";
    }
    if (
      this.phase === "growth" &&
      (novelty > 0.42 || this.tension > 0.55 || density > 0.5) &&
      t > 20
    ) {
      this.phase = "metamorphosis";
    }
    if (this.phase === "metamorphosis" && novelty < 0.22 && this.tension < 0.35 && t > 45) {
      this.phase = "hardening";
    }

    if (this.phase === "hardening" && novelty > 0.5 && deltaTime > 0) {
      this.phase = "metamorphosis";
    }
  }

  private updateOrganBudget(
    density: number,
    novelty: number,
    energySurge: boolean,
    transientBurst: boolean,
    deltaTime: number,
    isActive: boolean,
  ) {
    if (!isActive) {
      return;
    }
    let gain = deltaTime * (0.06 + density * 0.18 + novelty * 0.14 + this.tension * 0.1);
    if (energySurge) gain += 0.45;
    if (transientBurst) gain += 0.35;
    if (novelty > 0.4) gain += deltaTime * 0.12;
    this.organBudget = Math.min(4, this.organBudget + gain);
  }

  getTransientRate() {
    return this.transientRate;
  }

  consumeOrganBudget(cost = 1): boolean {
    if (this.organBudget < cost) {
      return false;
    }
    this.organBudget -= cost;
    return true;
  }

  getPhase(): GrowthPhase {
    return this.phase;
  }
}
