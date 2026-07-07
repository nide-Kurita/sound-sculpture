/** band-test と main で共有する帯域スナップショット形 */
export type BandLevels = {
  sub: number;
  low: number;
  mid: number;
  melody: number;
  high: number;
  overall: number;
  centroid: number;
  bassFocus: number;
  melodyFocus: number;
  brightness: number;
  contrast: number;
};

export type BandSoloMode = "off" | "low" | "mid" | "high";

export type BandMeterSnapshot = {
  low: number;
  mid: number;
  high: number;
  dominant: BandSoloMode | "off";
  dominantLabel: string;
};

export const applyBandSolo = <T extends BandLevels>(bands: T, mode: BandSoloMode): T => {
  if (mode === "off") {
    return bands;
  }

  if (mode === "low") {
    const lowEnergy = Math.max(bands.sub, bands.low);
    return {
      ...bands,
      sub: bands.sub,
      low: bands.low,
      mid: 0,
      melody: 0,
      high: 0,
      overall: lowEnergy,
      bassFocus: 1,
      melodyFocus: 0,
      brightness: 0,
      contrast: 0,
    };
  }

  if (mode === "mid") {
    const midEnergy = Math.max(bands.mid, bands.melody);
    return {
      ...bands,
      sub: 0,
      low: 0,
      mid: bands.mid,
      melody: bands.melody,
      high: 0,
      overall: midEnergy,
      bassFocus: 0,
      melodyFocus: midEnergy > 0.001 ? 1 : 0,
      brightness: 0,
      contrast: bands.contrast * 0.5,
    };
  }

  return {
    ...bands,
    sub: 0,
    low: 0,
    mid: 0,
    melody: 0,
    high: bands.high,
    overall: bands.high,
    bassFocus: 0,
    melodyFocus: 0,
    brightness: bands.high > 0.001 ? 1 : 0,
    contrast: bands.contrast * 0.35,
  };
};

export type BandLiveWeights = {
  low: number;
  mid: number;
  high: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

const BAND_GATE_LOW = 0.01;
const BAND_GATE_HIGH = 0.28;

/** 低音=全体 / 中音=表面 / 高音=膜 — 3帯域対称の正規化重み */
export const computeBandLiveWeights = (bands: BandLevels, solo: BandSoloMode = "off"): BandLiveWeights => {
  if (solo === "low") {
    const low = Math.max(bands.sub, bands.low);
    return { low: clamp01(low * 1.15 + 0.12), mid: 0, high: 0 };
  }
  if (solo === "mid") {
    const mid = Math.max(bands.mid, bands.melody);
    return { low: 0, mid: clamp01(mid * 1.15 + 0.12), high: 0 };
  }
  if (solo === "high") {
    const high = bands.high;
    return { low: 0, mid: 0, high: clamp01(high * 1.15 + 0.12) };
  }

  const lowRaw = Math.max(bands.sub, bands.low);
  const midRaw = Math.max(bands.mid, bands.melody);
  const highRaw = bands.high;

  const low = smoothstep(BAND_GATE_LOW, BAND_GATE_HIGH, lowRaw);
  const mid = smoothstep(BAND_GATE_LOW, BAND_GATE_HIGH, midRaw);
  const high = smoothstep(BAND_GATE_LOW, BAND_GATE_HIGH, highRaw);
  const total = low + mid + high + 0.0001;

  return {
    low: clamp01(low / total),
    mid: clamp01(mid / total),
    high: clamp01(high / total),
  };
};

export const snapshotBandMeters = (bands: BandLevels): BandMeterSnapshot => {
  const low = Math.max(bands.sub, bands.low);
  const mid = Math.max(bands.mid, bands.melody);
  const high = bands.high;

  let dominant: BandSoloMode | "off" = "off";
  let dominantLabel = "—";
  const peak = Math.max(low, mid, high);
  if (peak > 0.04) {
    if (low >= mid && low >= high) {
      dominant = "low";
      dominantLabel = "低音";
    } else if (mid >= low && mid >= high) {
      dominant = "mid";
      dominantLabel = "中音";
    } else {
      dominant = "high";
      dominantLabel = "高音";
    }
  }

  return { low, mid, high, dominant, dominantLabel };
};

export const BAND_TEST_TONES = [
  { hz: 80, seconds: 1.6, label: "低音 80Hz" },
  { hz: 1000, seconds: 1.6, label: "中音 1kHz" },
  { hz: 7000, seconds: 1.6, label: "高音 7kHz" },
] as const;

let activeBandSoloMode: BandSoloMode = "off";

export const setBandSoloMode = (mode: BandSoloMode) => {
  activeBandSoloMode = mode;
};

export const getBandSoloMode = () => activeBandSoloMode;

export const bandSoloAllows = (band: BandSoloMode) =>
  activeBandSoloMode === "off" || activeBandSoloMode === band;
