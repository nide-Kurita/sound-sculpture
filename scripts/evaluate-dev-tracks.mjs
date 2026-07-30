/**
 * Dev トラックを決定論スペクトルで走査し、完成時の種・パレット・形態目標を算出する。
 * 実アプリの AudioInput 正規化 / StructureTracker / SpeciesProfiler / Palette に可能な限り揃える。
 *
 * Usage: node scripts/evaluate-dev-tracks.mjs
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const musicDir = join(root, "src/music");
const outDir = join(root, "scripts/.eval-cache");
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);

// --- fib helpers (mirror src/fibonacci.ts) ---
const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
const fib = (i) => FIB[Math.min(Math.max(0, i), FIB.length - 1)];
const fibRatio = (a, b) => fib(a) / fib(b);
const fibUnit = (a, b) => fib(a) / fib(b);
const fibSeconds = (i) => fib(i);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (e0, e1, v) => {
  const x = clamp01((v - e0) / (e1 - e0));
  return x * x * (3 - 2 * x);
};

const SILENCE_THRESHOLD = 0.025;
const HOP_SEC = 1 / 60;
const FFT_SIZE = 2048;
const BAND_NORM_FLOOR = 0.34;
const BAND_NORM_ATTACK = 2.4;
const BAND_NORM_RELEASE = 1 / 55;
const BAND_NORM_AMOUNT = 0.52;
const BAND_NORM_CURVE = 1.28;
const SPECIES_CALIBRATION = fibSeconds(5); // 5 → 5? wait fib(5)=5 — tuning uses fibSeconds(7)=21 typically

// Match sculpture-tuning default if present
let speciesCalibrationSeconds = 21;
try {
  const tuningPath = join(root, "src/sculpture-tuning.ts");
  const text = readFileSync(tuningPath, "utf8");
  const m = text.match(/speciesCalibrationSeconds:\s*fibSeconds\((\d+)\)/);
  if (m) speciesCalibrationSeconds = fibSeconds(Number(m[1]));
} catch {
  // keep default
}

// --- FFT / timeline (mirror deterministic-audio.ts) ---
const fftRadix2 = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(ang);
    const wLenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j += 1) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
};

const bandAverage = (mags, sampleRate, minHz, maxHz) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  if (end < start) return 0;
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    sum += mags[i];
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
};

const bandHybrid = (mags, sampleRate, minHz, maxHz) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  if (end < start) return 0;
  let sum = 0;
  let peak = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    const v = mags[i];
    sum += v;
    peak = Math.max(peak, v);
    count += 1;
  }
  if (count === 0) return 0;
  return (sum / count) * 0.28 + peak * 0.72;
};

const bandCentroid = (mags, sampleRate, minHz, maxHz) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  let weighted = 0;
  let total = 0;
  for (let i = start; i <= end; i += 1) {
    const energy = mags[i];
    weighted += (i / Math.max(1, bins - 1)) * energy;
    total += energy;
  }
  return total <= 0.0001 ? 0 : clamp01(weighted / total);
};

const buildTimeline = (mono, sampleRate) => {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const duration = mono.length / sampleRate;
  const frames = [];
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const mags = new Float32Array(FFT_SIZE / 2);
  const half = FFT_SIZE / 2;
  const invNorm = 2 / FFT_SIZE;

  for (let origin = 0; origin < mono.length; origin += hop) {
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sampleIndex = origin + i - half;
      const sample =
        sampleIndex >= 0 && sampleIndex < mono.length ? mono[sampleIndex] : 0;
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
      re[i] = sample * window;
      im[i] = 0;
      sumSq += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    fftRadix2(re, im);
    for (let i = 0; i < half; i += 1) {
      const mag = Math.hypot(re[i], im[i]) * invNorm;
      mags[i] = Math.min(1, Math.pow(mag, 0.5) * 2.2);
    }
    const sub = bandAverage(mags, sampleRate, 30, 120);
    const low = bandAverage(mags, sampleRate, 120, 400);
    const mid = bandAverage(mags, sampleRate, 400, 2000);
    const melody = bandAverage(mags, sampleRate, 700, 1500);
    const presence = bandHybrid(mags, sampleRate, 1800, 6500);
    const air = bandHybrid(mags, sampleRate, 5000, 18000);
    const high = presence * 0.38 + air * 0.62;
    const overall = sub * 0.18 + low * 0.32 + mid * 0.2 + melody * 0.14 + high * 0.14;
    const spectralTotal = sub + low + mid + high + melody * 0.35 + 0.0001;
    frames.push({
      sub,
      low,
      mid,
      melody,
      high,
      overall,
      centroid: bandCentroid(mags, sampleRate, 24, 9000),
      bassFocus: (sub + low) / spectralTotal,
      melodyFocus: melody / spectralTotal,
      brightness: clamp01(high / spectralTotal),
      contrast: clamp01(
        (Math.abs(sub - mid) +
          Math.abs(low - mid) +
          Math.abs(melody - mid) +
          Math.abs(mid - high)) /
          spectralTotal,
      ),
      peak,
      rms: Math.sqrt(sumSq / FFT_SIZE),
    });
  }
  return { hopSec: HOP_SEC, duration, frames };
};

const hashBytesToMorphologySeed = (bytes) => {
  const view = new Uint8Array(bytes);
  let h = 2166136261;
  const step = Math.max(1, Math.floor(view.length / 8192));
  for (let i = 0; i < view.length; i += step) {
    h ^= view[i];
    h = Math.imul(h, 16777619);
  }
  h ^= view.length;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return ((h >>> 0) % 1_000_000) / 1000;
};

const decodeMono = (filePath) => {
  const cacheKey = createHash("sha1").update(filePath).update(String(existsSync(filePath) ? readFileSync(filePath).length : 0)).digest("hex").slice(0, 16);
  const cachePath = join(outDir, `${cacheKey}.f32`);
  const metaPath = join(outDir, `${cacheKey}.json`);
  if (existsSync(cachePath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const buf = readFileSync(cachePath);
    return { sampleRate: meta.sampleRate, mono: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), fileBytes: readFileSync(filePath) };
  }
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", filePath],
    { encoding: "utf8" },
  );
  const sampleRate = Number((probe.stdout || "44100").trim().split("\n")[0]) || 44100;
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", filePath, "-ac", "1", "-f", "f32le", "-acodec", "pcm_f32le", cachePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${filePath}: ${result.stderr}`);
  }
  writeFileSync(metaPath, JSON.stringify({ sampleRate, file: basename(filePath) }));
  const buf = readFileSync(cachePath);
  return {
    sampleRate,
    mono: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4),
    fileBytes: readFileSync(filePath),
  };
};

// --- band normalize + profile ---
const makeBandNorm = () => ({
  peaks: { sub: 0, low: 0, mid: 0, melody: 0, high: 0, overall: 0 },
  normalize(key, value, dt) {
    const peak = this.peaks[key];
    const rate = value > peak ? BAND_NORM_ATTACK : BAND_NORM_RELEASE;
    this.peaks[key] = peak + (value - peak) * Math.min(1, dt * rate);
    const denom = Math.max(BAND_NORM_FLOOR, this.peaks[key]);
    const compressed = clamp01(value / denom);
    const blended = compressed * BAND_NORM_AMOUNT + value * (1 - BAND_NORM_AMOUNT);
    return clamp01(Math.pow(blended, BAND_NORM_CURVE));
  },
});

const frameToBands = (frame, norm, dt) => ({
  sub: norm.normalize("sub", smoothstep(0.035, 0.42, frame.sub), dt),
  low: norm.normalize("low", smoothstep(0.04, 0.46, frame.low), dt),
  mid: norm.normalize("mid", smoothstep(0.03, 0.38, frame.mid), dt),
  melody: norm.normalize("melody", smoothstep(0.012, 0.24, frame.melody), dt),
  high: norm.normalize("high", smoothstep(0.01, 0.18, frame.high), dt),
  overall: norm.normalize("overall", smoothstep(0.025, 0.4, frame.overall), dt),
  centroid: frame.centroid,
  bassFocus: frame.bassFocus,
  melodyFocus: frame.melodyFocus,
  brightness: clamp01(frame.brightness),
  contrast: clamp01(frame.contrast),
});

// Lightweight rhythm approximation aligned with kick/transient spirit of RhythmTracker
class SimpleRhythm {
  constructor() {
    this.envSub = 0;
    this.envLow = 0;
    this.envMid = 0;
    this.envHigh = 0;
    this.prevPeak = 0;
    this.prevRms = 0;
    this.lastKick = 10;
    this.lastTransient = 10;
    this.pulseIntervals = [];
    this.lastPulseTime = 0;
    this.elapsed = 0;
    this.pulseConfidence = 0;
    this.pulseEnvelope = 0;
    this.kick = 0;
    this.transient = 0;
    this.beat = 0;
    this.kickIndex = 0;
  }
  update(bands, wave, dt) {
    const a = Math.min(1, dt * 14);
    const prevSub = this.envSub;
    const prevLow = this.envLow;
    const prevHigh = this.envHigh;
    this.envSub += (bands.sub - this.envSub) * a;
    this.envLow += (bands.low - this.envLow) * a;
    this.envMid += (bands.mid - this.envMid) * a;
    this.envHigh += (bands.high - this.envHigh) * a;
    const onsetSub = Math.max(0, bands.sub - prevSub);
    const onsetLow = Math.max(0, bands.low - prevLow);
    const onsetHigh = Math.max(0, bands.high - prevHigh);
    const bassOnset = Math.max(onsetSub, onsetLow * 0.92);
    const peakDelta = Math.max(0, wave.peak - this.prevPeak);
    const energyDelta = Math.max(0, wave.rms - this.prevRms);
    this.prevPeak = wave.peak;
    this.prevRms = wave.rms;
    this.elapsed += dt;
    this.lastKick += dt;
    this.lastTransient += dt;
    this.kick = 0;
    this.transient = 0;
    this.beat = 0;
    this.pulseEnvelope *= Math.exp(-dt * 5.5);

    const bassLevel = Math.max(bands.sub, bands.low * 0.8);
    const bassHit = bassOnset > 0.04 + onsetHigh * 0.3 && bassLevel > 0.08;
    if (bassHit && this.lastKick > 0.12) {
      this.kick = Math.max(bassOnset, peakDelta * 0.8);
      this.lastKick = 0;
      this.kickIndex += 1;
      this.beat = this.kick;
      if (this.lastPulseTime > 0) {
        const ioi = this.elapsed - this.lastPulseTime;
        if (ioi > 0.2 && ioi < 1.6) {
          this.pulseIntervals.push(ioi);
          if (this.pulseIntervals.length > 8) this.pulseIntervals.shift();
        }
      }
      this.lastPulseTime = this.elapsed;
      this.pulseEnvelope = 1;
    }
    const brightSpike = onsetHigh > 0.03 && bands.high > 0.05;
    if (peakDelta > 0.08 && brightSpike && this.lastTransient > 0.05) {
      this.transient = peakDelta;
      this.lastTransient = 0;
      this.pulseEnvelope = Math.max(this.pulseEnvelope, 0.7);
    }
    if (this.pulseIntervals.length >= 3) {
      const sorted = [...this.pulseIntervals].sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      let err = 0;
      for (const v of this.pulseIntervals) err += Math.abs(v - mid) / mid;
      this.pulseConfidence = clamp01(1 - err / this.pulseIntervals.length);
    } else {
      this.pulseConfidence *= Math.exp(-dt * 0.2);
    }
    return {
      beat: this.beat,
      kick: this.kick,
      kickIndex: this.kickIndex,
      snare: 0,
      hat: 0,
      transient: this.transient,
      downbeat: false,
      bpm: this.pulseIntervals.length ? 60 / (this.pulseIntervals.reduce((a, b) => a + b, 0) / this.pulseIntervals.length) : 0,
      pulsePhase: 0,
      pulseConfidence: this.pulseConfidence,
      pulseEnvelope: this.pulseEnvelope,
    };
  }
}

// StructureTracker (ported essentials)
class StructureTracker {
  constructor() {
    this.reset();
  }
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
    this.formationCredit = 0;
    this.eventCounts = { novelty: 0, surge: 0, drop: 0, burst: 0 };
  }
  update(bands, rhythm, dt, isActive) {
    const overall = bands.overall;
    const longAlpha = 1 - Math.exp(-dt * 0.35);
    const midAlpha = 1 - Math.exp(-dt * 1.8);
    const shortAlpha = 1 - Math.exp(-dt * 6.5);
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
      bands.contrast * 0.34 + bands.brightness * 0.28 + centroidDelta * 1.6 + this.energyMid * 0.22,
    );
    this.tension += (tensionTarget - this.tension) * midAlpha;
    if (isActive) {
      this.activeSeconds += dt;
      this.formationCredit += dt * (0.1 + overall * 1.05);
    }
    this.elapsed += dt;
    if (rhythm.beat > 0.02) this.beatTimestamps.push(this.elapsed);
    while (this.beatTimestamps.length && this.elapsed - this.beatTimestamps[0] > 8) this.beatTimestamps.shift();
    const beatRate = this.beatTimestamps.length / 8;
    const density = clamp01(
      smoothstep(0.18, 1.55, beatRate) * 0.78 + smoothstep(0.06, 0.7, rhythm.pulseConfidence) * 0.22,
    );
    const novelty = clamp01(
      Math.abs(bands.centroid - this.centroidLong) * 1.4 +
        Math.abs(bands.contrast - this.contrastLong) * 0.9 +
        Math.abs(bands.brightness - this.brightnessLong) * 0.75 +
        Math.abs(this.energyMid - this.energyLong) * 1.1,
    );
    this.noveltyCooldown = Math.max(0, this.noveltyCooldown - dt);
    this.energySurgeCooldown = Math.max(0, this.energySurgeCooldown - dt);
    this.energyDropCooldown = Math.max(0, this.energyDropCooldown - dt);
    this.transientBurstCooldown = Math.max(0, this.transientBurstCooldown - dt);
    let noveltyPeakEvent = false;
    if (novelty > this.noveltyPeak + 0.14 && this.noveltyCooldown <= 0) {
      noveltyPeakEvent = true;
      this.noveltyCooldown = 2.2;
      this.eventCounts.novelty += 1;
    }
    this.noveltyPeak = noveltyPeakEvent ? novelty : this.noveltyPeak * Math.exp(-dt * 0.35);
    const energyDelta = this.energyShort - this.energyLong;
    if (energyDelta > 0.12 && this.energySurgeCooldown <= 0) {
      this.energySurgeCooldown = 1.8;
      this.eventCounts.surge += 1;
    }
    if (energyDelta < -0.08 && this.energyDropCooldown <= 0 && this.energyLong > 0.06) {
      this.energyDropCooldown = 2.4;
      this.eventCounts.drop += 1;
    }
    if (rhythm.transient > 0.08) this.transientBurstWindow.push(this.elapsed);
    while (this.transientBurstWindow.length && this.elapsed - this.transientBurstWindow[0] > 1.2) {
      this.transientBurstWindow.shift();
    }
    if (this.transientBurstWindow.length >= 4 && this.transientBurstCooldown <= 0) {
      this.transientBurstCooldown = 1.5;
      this.eventCounts.burst += 1;
    }
    this.transientRate += (rhythm.transient - this.transientRate) * Math.min(1, dt * 6);
    // phase
    const t = this.activeSeconds;
    if (isActive) {
      if (this.phase === "embryo" && t > 5 && this.energyMid > 0.04) this.phase = "growth";
      if (this.phase === "growth" && (novelty > 0.34 || this.tension > 0.48 || density > 0.42) && t > 16) {
        this.phase = "metamorphosis";
      }
      if (this.phase === "metamorphosis" && novelty < 0.18 && this.tension < 0.31 && t > 38) {
        this.phase = "hardening";
      }
      if (this.phase === "hardening" && novelty > 0.5) this.phase = "metamorphosis";
      let gain = dt * (0.06 + density * 0.18 + novelty * 0.14 + this.tension * 0.1);
      this.organBudget = Math.min(6, this.organBudget + gain);
    }
    return {
      tension: this.tension,
      density,
      novelty,
      phase: this.phase,
      formationRamp: Math.max(smoothstep(0, 10, this.activeSeconds), smoothstep(0, 4.5, this.formationCredit)),
      organicScore: clamp01((1 - density) * 0.28 + (1 - this.contrastLong) * 0.2 + smoothstep(0.2, 0.55, this.centroidLong) * 0.3),
      mineralScore: clamp01(density * 0.38 + this.brightnessLong * 0.2 + this.transientRate * 0.35),
      organBudget: this.organBudget,
      events: {
        noveltyPeak: noveltyPeakEvent,
        energySurge: this.energySurgeCooldown > 1.79,
        energyDrop: this.energyDropCooldown > 2.39,
        transientBurst: this.transientBurstCooldown > 1.49,
        pulseStable: rhythm.pulseConfidence > 0.55,
      },
    };
  }
  getTransientRate() {
    return this.transientRate;
  }
}

// SpeciesProfiler
class SpeciesProfiler {
  constructor(warmupSeconds) {
    this.warmupSeconds = warmupSeconds;
    this.reset();
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
    this.profile = null;
  }
  update(input, bands, dt, isActive) {
    if (!isActive) return;
    this.activeSeconds += dt;
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
    if (bands.overall > 0.66) this.loudSampleCount += 1;
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
  }
  finalize() {
    const n = Math.max(1, this.sampleCount);
    const avgDensity = this.sumDensity / n;
    const avgTension = this.sumTension / n;
    const avgContrast = this.sumContrast / n;
    const avgBrightness = this.sumBrightness / n;
    const avgBassFocus = this.sumBassFocus / n;
    const avgMelodyFocus = this.sumMelodyFocus / n;
    const avgCentroid = this.sumCentroid / n;
    const avgPulse = this.sumPulseConfidence / n;
    const avgTransient = this.sumTransientRate / n;
    const avgNovelty = this.sumNovelty / n;
    const avgEventRate = this.sumEventRate / n;
    const avgOverall = this.sumOverall / n;
    const loudRatio = this.loudSampleCount / n;
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
      Math.abs(lateCentroid - earlyCentroid) * 0.9 +
        Math.abs(lateBrightness - earlyBrightness) * 0.75 +
        Math.abs(lateMelodyFocus - earlyMelodyFocus) * 1.2,
    );
    const organic = clamp01(
      (() => {
        const loudHard = smoothstep(0.78, 0.98, loudRatio);
        const softDyn = smoothstep(0.04, 0.45, sectionContrast) * (1 - loudHard * 0.55);
        return (
          0.44 -
          avgDensity * 0.14 -
          avgBassFocus * 0.06 -
          loudHard * 0.26 +
          softDyn * 0.38 +
          avgMelodyFocus * 0.68 +
          avgCentroid * 0.38 +
          sectionContrast * 0.5 +
          contrastVar * 0.42 -
          avgBrightness * 0.08 -
          avgTransient * 0.08
        );
      })(),
    );
    const aggressive = clamp01(
      (() => {
        const loudHard = smoothstep(0.78, 0.98, loudRatio);
        const softDyn = smoothstep(0.04, 0.45, sectionContrast) * (1 - loudHard * 0.55);
        return (
          0.12 +
          loudHard * 0.4 +
          avgOverall * 0.06 +
          avgContrast * 0.16 +
          avgBrightness * 0.22 +
          avgTension * 0.2 +
          avgTransient * 0.1 +
          avgBassFocus * 0.02 +
          avgNovelty * 0.1 +
          avgEventRate * 0.08 +
          brightnessVar * 0.1 -
          avgMelodyFocus * 0.2 -
          softDyn * 0.3
        );
      })(),
    );
    const rhythmic = clamp01(
      0.02 +
        avgPulse * 0.24 +
        avgDensity * 0.12 +
        densityVar * 0.34 +
        tensionVar * 0.12 +
        avgEventRate * 0.16 +
        sectionContrast * 0.12 -
        avgTransient * 0.05,
    );
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
      avgs: {
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
      },
    };
  }
}

const speciesMorphTargets = (sp) => {
  const o = sp.organic;
  const a = sp.aggressive;
  const r = sp.rhythmic;
  const hardness = clamp01(0.5 + (a - o) * 0.7);
  const softness = 1 - hardness;
  const coralGate = smoothstep(0.38, 0.62, o);
  const coralWeight = softness * coralGate;
  const diaboloWeight = softness * (1 - coralGate * 0.65);
  const tipGate = smoothstep(0.4, 0.7, a) * (0.45 + smoothstep(0.3, 0.5, r) * 0.55);
  const spindleWeight = hardness * tipGate;
  const monolithWeight = hardness * (1 - tipGate * 0.75);
  const torusWeight = r * (0.6 + hardness * 0.25 + softness * 0.2);
  return {
    diabolo: fibUnit(3, 21) + diaboloWeight * fibUnit(13, 21) + r * fibUnit(3, 34),
    coral: fibUnit(1, 34) + coralWeight * fibUnit(13, 21) + o * fibUnit(5, 21),
    monolith: fibUnit(2, 21) + monolithWeight * fibUnit(13, 21) + (1 - o) * fibUnit(3, 21),
    spindle: fibUnit(1, 34) + spindleWeight * fibUnit(13, 21) + a * fibUnit(5, 21),
    torus: fibUnit(2, 21) + torusWeight * fibUnit(13, 21),
  };
};

/** main.ts updateMorphology の live/structure 補正に相当 */
const applyLiveMorphBias = (morph, profile, structure, species) => {
  const mineralLead = clamp01((structure.mineralScore ?? 0) - (structure.organicScore ?? 0) + 0.5);
  const softRatio = species.organic / Math.max(0.001, species.organic + species.aggressive);
  const softLead = Math.max(0, softRatio - 0.38);
  const hardLead = Math.max(0, 0.5 - softRatio);
  const hardBias = clamp01(0.5 + (species.aggressive - species.organic) * 0.7);
  const softBias = 1 - hardBias;
  const liveHard = clamp01(
    hardLead * 0.55 +
      mineralLead * 0.16 +
      profile.brightness * 0.24 +
      profile.bassDominance * hardBias * 0.08 +
      (species.avgs?.avgTension ?? 0.3) * 0.12 +
      Math.min(0.2, (structure.events?.burst ?? 0) / Math.max(1, profile.activeDuration) * 8) -
      softLead * 0.55 -
      profile.melodyFocus * 0.3 -
      softBias * 0.12,
  );
  const liveSoft = 1 - liveHard;
  const coralCue = clamp01(
    species.organic * 0.48 +
      profile.melodyFocus * 0.32 +
      profile.contrast * 0.22 +
      softLead * 0.35 +
      profile.sectionContrast * 0.25,
  );
  const brightGate = smoothstep(0.1, 0.22, profile.brightness);
  const attackGate = smoothstep(5, 13, profile.attackRate);
  const tipGateLive = clamp01(brightGate * 0.4 + attackGate * 0.45 + (species.avgs?.avgTension ?? 0.3) * 0.2);
  const spindleCue = clamp01(tipGateLive * liveHard);
  const massCue = clamp01(
    liveHard * 0.55 +
      profile.bassDominance * hardBias * 0.5 * (1 - tipGateLive * 0.65) +
      (1 - brightGate) * 0.2,
  );
  const torusCue = clamp01(
    species.rhythmic * 0.58 +
      attackGate * 0.2 +
      profile.variation * 0.18 -
      Math.max(massCue, spindleCue) * 0.3,
  );
  const diaboloCue = clamp01(
    liveSoft * 0.4 + profile.bassDominance * softBias * 0.35 + (1 - coralCue) * softBias * 0.35,
  );
  const next = { ...morph };
  next.monolith *= 0.5 + liveHard * 0.65 + massCue * 1.08;
  next.spindle *= 0.34 + liveHard * 0.38 + spindleCue * 2.0;
  next.diabolo *= 0.5 + liveSoft * 0.7 + diaboloCue * 0.95;
  next.coral *= 0.42 + liveSoft * 0.65 + coralCue * 1.25;
  next.torus *= 0.38 + torusCue * 1.35 + species.rhythmic * 0.32;
  next.diabolo = Math.pow(next.diabolo, 1.12);
  next.torus = Math.pow(next.torus, 1.12);
  next.monolith = Math.pow(next.monolith, 1.12);
  next.coral = Math.pow(next.coral, 1.12);
  next.spindle = Math.pow(next.spindle, 1.12);
  return next;
};

const HUE_STOPS = [0.05, 0.1, 0.24, 0.46, 0.58, 0.72];
const derivePalette = (profile) => {
  const centroid = profile.centroid;
  const brightness = profile.brightness;
  const contrast = profile.contrast;
  const bassDominance = profile.bassDominance;
  const melodyFocus = profile.melodyFocus;
  const sectionContrast = profile.sectionContrast;
  const variation = profile.variation;
  const attackRate = profile.attackRate;
  const loudRatio = profile.loudRatio;
  const overallAverage = profile.overallAverage;
  const quietRatio = profile.quietRatio ?? 0;
  const loudHard = smoothstep(0.7, 0.96, loudRatio);
  const softDyn = clamp01(
    sectionContrast * 0.42 +
      variation * 0.38 +
      melodyFocus * 0.36 +
      quietRatio * 0.22 +
      (1 - loudHard) * 0.28 -
      brightness * 0.08,
  );
  const hardMat = clamp01(
    loudHard * 0.52 +
      smoothstep(0.1, 0.22, brightness) * 0.28 +
      contrast * 0.14 +
      smoothstep(5, 13, attackRate) * 0.12 -
      softDyn * 0.4,
  );
  const spectralColor = clamp01(
    centroid * 0.3 +
      brightness * 0.24 +
      profile.highRatio * 0.22 +
      profile.midRatio * 0.12 +
      melodyFocus * 0.32 +
      sectionContrast * 0.22 -
      softDyn * 0.12 -
      bassDominance * 0.06 +
      variation * 0.1,
  );
  const spectralT = smoothstep(0.04, 0.58, spectralColor);
  const pos = spectralT * (HUE_STOPS.length - 1);
  const seg = Math.min(HUE_STOPS.length - 2, Math.floor(pos));
  const warmPull =
    (softDyn * 0.1 + (1 - loudHard) * 0.03) * smoothstep(0.18, 0.55, spectralT);
  const hue =
    ((HUE_STOPS[seg] +
      (HUE_STOPS[seg + 1] - HUE_STOPS[seg]) * (pos - seg) -
      warmPull -
      bassDominance * 0.015 +
      hardMat * 0.06 +
      variation * 0.025 +
      melodyFocus * 0.02) %
      1 +
      1) %
    1;
  const saturation = Math.min(
    0.92,
    Math.max(0.18, 0.26 + contrast * 0.55 + softDyn * 0.32 + variation * 0.28 - hardMat * 0.14),
  );
  const lightness = Math.min(
    0.76,
    Math.max(0.28, 0.34 + brightness * 0.38 + softDyn * 0.1 + loudHard * 0.08 + melodyFocus * 0.06),
  );
  const roughness = Math.min(
    0.92,
    Math.max(0.14, 0.38 + softDyn * 0.42 + (1 - hardMat) * 0.22 - brightness * 0.18 - loudHard * 0.16),
  );
  const metalness = Math.min(
    0.9,
    Math.max(
      0.02,
      0.06 + hardMat * 0.72 + contrast * 0.08 + bassDominance * 0.08 - softDyn * 0.38 - melodyFocus * 0.12,
    ),
  );
  const emissiveStrength = Math.min(
    1,
    Math.max(
      0.12,
      0.12 + hardMat * 0.28 + loudRatio * 0.38 + brightness * 0.42 + overallAverage * 0.16 + sectionContrast * 0.12,
    ),
  );
  return {
    hue,
    saturation,
    lightness,
    roughness,
    metalness,
    emissiveStrength,
    energy: clamp01(overallAverage * 1.2 + loudRatio * 0.85 + hardMat * 0.25),
  };
};

const hueFamily = (h) => {
  if (h < 0.08) return "amber";
  if (h < 0.16) return "gold";
  if (h < 0.35) return "moss";
  if (h < 0.52) return "jade";
  if (h < 0.65) return "blue";
  return "violet";
};

const dominantMorph = (m) =>
  Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];

const analyzeTrack = (filePath) => {
  const label = basename(filePath).replace(/\.[^.]+$/u, "");
  console.error(`analyzing: ${label}`);
  const { sampleRate, mono, fileBytes } = decodeMono(filePath);
  const seed = hashBytesToMorphologySeed(fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength));
  const timeline = buildTimeline(mono, sampleRate);
  const norm = makeBandNorm();
  const rhythm = new SimpleRhythm();
  const structure = new StructureTracker();
  const species = new SpeciesProfiler(speciesCalibrationSeconds);

  let prevBands = null;
  const profile = {
    duration: 0,
    activeDuration: 0,
    lowTotal: 0,
    midTotal: 0,
    highTotal: 0,
    overallTotal: 0,
    centroidTotal: 0,
    bassFocusTotal: 0,
    brightnessTotal: 0,
    contrastTotal: 0,
    variationTotal: 0,
    attackTotal: 0,
    attackEvents: 0,
    quiet: 0,
    loud: 0,
    melodyFocusTotal: 0,
    earlyActive: 0,
    earlyCentroidTotal: 0,
    earlyBrightnessTotal: 0,
    earlyMelodyFocusTotal: 0,
    lateActive: 0,
    lateCentroidTotal: 0,
    lateBrightnessTotal: 0,
    lateMelodyFocusTotal: 0,
    rawBassFocusTotal: 0,
    rawBrightnessTotal: 0,
    rawOverallTotal: 0,
    rawFrames: 0,
  };

  // section listening: thirds
  const sections = [
    { name: "intro", start: 0, end: timeline.duration / 3, overall: 0, bass: 0, bright: 0, n: 0 },
    { name: "middle", start: timeline.duration / 3, end: (2 * timeline.duration) / 3, overall: 0, bass: 0, bright: 0, n: 0 },
    { name: "late", start: (2 * timeline.duration) / 3, end: timeline.duration, overall: 0, bass: 0, bright: 0, n: 0 },
  ];

  let latestStructure = {
    tension: 0,
    density: 0,
    novelty: 0,
    phase: "embryo",
    formationRamp: 0,
    organBudget: 0,
    organicScore: 0,
    mineralScore: 0,
    events: {
      noveltyPeak: false,
      energySurge: false,
      energyDrop: false,
      transientBurst: false,
      pulseStable: false,
    },
  };
  let kickCount = 0;
  let transientCount = 0;

  for (let i = 0; i < timeline.frames.length; i += 1) {
    const frame = timeline.frames[i];
    const t = i * HOP_SEC;
    const bands = frameToBands(frame, norm, HOP_SEC);
    const wave = { peak: frame.peak, rms: frame.rms };
    const rhythmEvents = rhythm.update(bands, wave, HOP_SEC);
    if (rhythmEvents.kick > 0) kickCount += 1;
    if (rhythmEvents.transient > 0) transientCount += 1;

    profile.duration += HOP_SEC;
    profile.rawFrames += 1;
    profile.rawBassFocusTotal += frame.bassFocus;
    profile.rawBrightnessTotal += frame.brightness;
    profile.rawOverallTotal += frame.overall;

    if (bands.overall < SILENCE_THRESHOLD) profile.quiet += HOP_SEC;
    if (bands.overall > 0.66) profile.loud += HOP_SEC;

    const isActive = bands.overall >= SILENCE_THRESHOLD;
    if (isActive) {
      profile.activeDuration += HOP_SEC;
      profile.lowTotal += bands.low * HOP_SEC;
      profile.midTotal += bands.mid * HOP_SEC;
      profile.highTotal += bands.high * HOP_SEC;
      profile.overallTotal += bands.overall * HOP_SEC;
      profile.centroidTotal += bands.centroid * HOP_SEC;
      profile.bassFocusTotal += bands.bassFocus * HOP_SEC;
      profile.brightnessTotal += bands.brightness * HOP_SEC;
      profile.contrastTotal += bands.contrast * HOP_SEC;
      profile.melodyFocusTotal += bands.melodyFocus * HOP_SEC;
      if (profile.activeDuration <= 12) {
        profile.earlyActive += HOP_SEC;
        profile.earlyCentroidTotal += bands.centroid * HOP_SEC;
        profile.earlyBrightnessTotal += bands.brightness * HOP_SEC;
        profile.earlyMelodyFocusTotal += bands.melodyFocus * HOP_SEC;
      } else if (profile.activeDuration >= 24) {
        profile.lateActive += HOP_SEC;
        profile.lateCentroidTotal += bands.centroid * HOP_SEC;
        profile.lateBrightnessTotal += bands.brightness * HOP_SEC;
        profile.lateMelodyFocusTotal += bands.melodyFocus * HOP_SEC;
      }
      if (prevBands) {
        const spectralShift =
          Math.abs(bands.low - prevBands.low) +
          Math.abs(bands.mid - prevBands.mid) +
          Math.abs(bands.high - prevBands.high) +
          Math.abs(bands.overall - prevBands.overall);
        const attack =
          Math.max(0, bands.overall - prevBands.overall) +
          Math.max(0, bands.low - prevBands.low) * 0.3 +
          Math.max(0, bands.mid - prevBands.mid) * 0.25;
        profile.variationTotal += spectralShift * HOP_SEC;
        profile.attackTotal += attack * HOP_SEC;
        if (attack > 0.08) profile.attackEvents += 1;
      }
      prevBands = { ...bands };
    }

    latestStructure = structure.update(bands, rhythmEvents, HOP_SEC, isActive);
    species.update(
      {
        density: latestStructure.density,
        tension: latestStructure.tension,
        melodyFocus: bands.melodyFocus,
        pulseConfidence: rhythmEvents.pulseConfidence,
        transientRate: structure.getTransientRate(),
        novelty: latestStructure.novelty,
        eventRate:
          (latestStructure.events.noveltyPeak ? 1 : 0) +
          (latestStructure.events.energySurge ? 1 : 0) +
          (latestStructure.events.transientBurst ? 1 : 0) +
          (latestStructure.events.pulseStable ? 0.5 : 0),
      },
      bands,
      HOP_SEC,
      isActive,
    );

    for (const s of sections) {
      if (t >= s.start && t < s.end) {
        s.overall += frame.overall;
        s.bass += frame.bassFocus;
        s.bright += frame.brightness;
        s.n += 1;
      }
    }
  }

  const ad = Math.max(0.0001, profile.activeDuration);
  const bandEnergy = profile.lowTotal + profile.midTotal + profile.highTotal + 0.0001;
  const earlyCentroid = profile.earlyCentroidTotal / Math.max(0.0001, profile.earlyActive);
  const earlyBrightness = profile.earlyBrightnessTotal / Math.max(0.0001, profile.earlyActive);
  const earlyMelodyFocus = profile.earlyMelodyFocusTotal / Math.max(0.0001, profile.earlyActive);
  const lateCentroid = profile.lateCentroidTotal / Math.max(0.0001, profile.lateActive);
  const lateBrightness = profile.lateBrightnessTotal / Math.max(0.0001, profile.lateActive);
  const lateMelodyFocus = profile.lateMelodyFocusTotal / Math.max(0.0001, profile.lateActive);
  const audioProfile = {
    activeDuration: profile.activeDuration,
    duration: profile.duration,
    overallAverage: profile.overallTotal / ad,
    lowRatio: profile.lowTotal / bandEnergy,
    midRatio: profile.midTotal / bandEnergy,
    highRatio: profile.highTotal / bandEnergy,
    bassDominance: profile.bassFocusTotal / ad,
    brightness: profile.brightnessTotal / ad,
    contrast: profile.contrastTotal / ad,
    centroid: profile.centroidTotal / ad,
    sectionContrast: clamp01(
      Math.abs(lateCentroid - earlyCentroid) * 0.9 +
        Math.abs(lateBrightness - earlyBrightness) * 0.75 +
        Math.abs(lateMelodyFocus - earlyMelodyFocus) * 1.2,
    ),
    variation: profile.variationTotal / ad,
    attackRate: profile.attackEvents / ad,
    quietRatio: profile.quiet / Math.max(0.0001, profile.duration),
    loudRatio: profile.loud / Math.max(0.0001, profile.duration),
    melodyFocus: profile.melodyFocusTotal / ad,
  };
  const speciesFinal = species.finalize();
  const morph = applyLiveMorphBias(
    speciesMorphTargets(speciesFinal),
    audioProfile,
    {
      ...latestStructure,
      events: structure.eventCounts,
    },
    speciesFinal,
  );
  const palette = derivePalette(audioProfile);

  return {
    label,
    file: basename(filePath),
    durationSec: Number(timeline.duration.toFixed(2)),
    morphologySeed: Number(seed.toFixed(3)),
    listening: {
      sections: sections.map((s) => ({
        name: s.name,
        overall: s.n ? Number((s.overall / s.n).toFixed(3)) : 0,
        bassFocus: s.n ? Number((s.bass / s.n).toFixed(3)) : 0,
        brightness: s.n ? Number((s.bright / s.n).toFixed(3)) : 0,
      })),
      rawAvgBassFocus: Number((profile.rawBassFocusTotal / Math.max(1, profile.rawFrames)).toFixed(3)),
      rawAvgBrightness: Number((profile.rawBrightnessTotal / Math.max(1, profile.rawFrames)).toFixed(3)),
      rawAvgOverall: Number((profile.rawOverallTotal / Math.max(1, profile.rawFrames)).toFixed(3)),
      kickEvents: kickCount,
      transientEvents: transientCount,
      kicksPerMin: Number(((kickCount / timeline.duration) * 60).toFixed(1)),
    },
    profile: Object.fromEntries(
      Object.entries(audioProfile).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(4)) : v]),
    ),
    structure: {
      phase: latestStructure.phase,
      formationRamp: Number(latestStructure.formationRamp.toFixed(3)),
      organBudget: Number(latestStructure.organBudget.toFixed(3)),
      events: structure.eventCounts,
    },
    species: {
      organic: Number(speciesFinal.organic.toFixed(3)),
      aggressive: Number(speciesFinal.aggressive.toFixed(3)),
      rhythmic: Number(speciesFinal.rhythmic.toFixed(3)),
      spikeGain: Number(speciesFinal.spikeGain.toFixed(3)),
      crystalGain: Number(speciesFinal.crystalGain.toFixed(3)),
      tentacleGain: Number(speciesFinal.tentacleGain.toFixed(3)),
      membraneGain: Number(speciesFinal.membraneGain.toFixed(3)),
      avgs: Object.fromEntries(
        Object.entries(speciesFinal.avgs).map(([k, v]) => [k, Number(v.toFixed(3))]),
      ),
    },
    morphTargets: Object.fromEntries(Object.entries(morph).map(([k, v]) => [k, Number(v.toFixed(3))])),
    dominantMorph: dominantMorph(morph),
    palette: {
      ...Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, Number(v.toFixed(3))])),
      hueFamily: hueFamily(palette.hue),
    },
  };
};

const TRACK_EXPECTATIONS = {
  "01 6_00": {
    character: "Dream Theater — progressive metal。重低音・複雑リズム・高域ディストーション",
    expect: {
      aggressive: "high",
      organic: "low-mid",
      rhythmic: "mid-high",
      morph: ["monolith", "spindle"],
      hue: ["amber", "gold", "moss"],
      metalness: "mid-high",
    },
  },
  "01 Donna Lee": {
    character: "Charlie Parker — bebop。サックス主旋律・低音は控えめ・高速フレーズ",
    expect: {
      aggressive: "low-mid",
      organic: "mid-high",
      rhythmic: "mid",
      morph: ["coral", "diabolo", "torus"],
      hue: ["jade", "blue", "moss"],
      metalness: "low-mid",
      melodyFocus: "high",
    },
  },
  "01 Peaches En Regalia": {
    character: "Frank Zappa — 器楽フュージョン。明るくキメの効いたホーン/ギター",
    expect: {
      aggressive: "mid",
      organic: "mid",
      rhythmic: "mid-high",
      morph: ["spindle", "coral", "monolith"],
      hue: ["gold", "moss", "jade"],
    },
  },
  "02 AIR": {
    character: "ASIAN KUNG-FU GENERATION — オルタナ/エモ・ロック。中域ギターとドラム",
    expect: {
      aggressive: "mid",
      organic: "mid",
      rhythmic: "mid-high",
      morph: ["monolith", "coral", "diabolo"],
    },
  },
  "02 Fly Away": {
    character: "Lenny Kravitz — ロック。グルーヴとギター、中域寄り",
    expect: {
      aggressive: "mid",
      organic: "mid",
      rhythmic: "high",
      morph: ["torus", "diabolo", "monolith"],
    },
  },
  "02 Fury Of The Storm": {
    character: "DragonForce — パワーメタル。超高速・超高域・アグレッシブ",
    expect: {
      aggressive: "high",
      organic: "low",
      rhythmic: "mid-high",
      morph: ["spindle", "monolith"],
      hue: ["jade", "blue", "violet", "moss"],
      metalness: "high",
      brightness: "high",
    },
  },
  "02 I'm Yours": {
    character: "Jason Mraz — アコースティック・ポップ。柔らかくメロディ中心・低アタック",
    expect: {
      aggressive: "low",
      organic: "high",
      rhythmic: "mid",
      morph: ["coral", "diabolo", "torus"],
      hue: ["amber", "gold", "moss"],
      metalness: "low",
      brightness: "low-mid",
    },
  },
  "05 ロビンソン": {
    character: "スピッツ — J-pop ロック。メロディアス、中庸なダイナミクス",
    expect: {
      aggressive: "low-mid",
      organic: "mid-high",
      rhythmic: "mid",
      morph: ["coral", "diabolo", "torus"],
    },
  },
  "1-05 修羅場": {
    character: "東京事変 — ドラマチックな J-rock。緊張感・中高域の存在感",
    expect: {
      aggressive: "mid-high",
      organic: "mid",
      rhythmic: "mid",
      morph: ["monolith", "spindle", "coral"],
    },
  },
  s04: {
    character: "開発用テスト音源（100秒）。基準トラック",
    expect: {
      aggressive: "any",
      organic: "any",
      rhythmic: "any",
      morph: ["coral", "diabolo", "torus", "monolith", "spindle"],
    },
  },
};

const bandLabel = (v, kind) => {
  if (kind === "aggressive" || kind === "organic" || kind === "rhythmic") {
    if (v >= 0.62) return "high";
    if (v >= 0.45) return "mid-high";
    if (v >= 0.32) return "mid";
    if (v >= 0.2) return "low-mid";
    return "low";
  }
  if (kind === "metalness" || kind === "brightness") {
    if (v >= 0.55) return "high";
    if (v >= 0.35) return "mid-high";
    if (v >= 0.22) return "mid";
    if (v >= 0.12) return "low-mid";
    return "low";
  }
  return String(v);
};

const rankMatch = (actual, expectedList) => {
  if (!expectedList || expectedList.includes("any")) return { ok: true, note: "n/a" };
  if (expectedList.includes(actual)) return { ok: true, note: `dominant=${actual}` };
  return { ok: false, note: `dominant=${actual}, expected one of ${expectedList.join("|")}` };
};

const levelMatch = (actualLabel, expected) => {
  if (!expected || expected === "any") return { ok: true, note: actualLabel };
  if (expected === actualLabel) return { ok: true, note: actualLabel };
  // adjacent tolerance
  const order = ["low", "low-mid", "mid", "mid-high", "high"];
  const ai = order.indexOf(actualLabel);
  const ei = order.indexOf(expected);
  if (ai >= 0 && ei >= 0 && Math.abs(ai - ei) <= 1) {
    return { ok: true, note: `${actualLabel} (~${expected})` };
  }
  return { ok: false, note: `${actualLabel} vs expected ${expected}` };
};

const files = readdirSync(musicDir)
  .filter((f) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, "ja"));

const results = [];
for (const f of files) {
  const path = join(musicDir, f);
  const result = analyzeTrack(path);
  const key = result.label;
  const exp = TRACK_EXPECTATIONS[key] ?? {
    character: "(未登録)",
    expect: { aggressive: "any", organic: "any", rhythmic: "any", morph: ["coral", "diabolo", "torus", "monolith", "spindle"] },
  };
  const checks = {
    organic: levelMatch(bandLabel(result.species.organic, "organic"), exp.expect.organic),
    aggressive: levelMatch(bandLabel(result.species.aggressive, "aggressive"), exp.expect.aggressive),
    rhythmic: levelMatch(bandLabel(result.species.rhythmic, "rhythmic"), exp.expect.rhythmic),
    morph: rankMatch(result.dominantMorph, exp.expect.morph),
    hue: exp.expect.hue
      ? {
          ok: exp.expect.hue.includes(result.palette.hueFamily),
          note: `${result.palette.hueFamily}`,
        }
      : { ok: true, note: result.palette.hueFamily },
    metalness: exp.expect.metalness
      ? levelMatch(bandLabel(result.palette.metalness, "metalness"), exp.expect.metalness)
      : { ok: true, note: bandLabel(result.palette.metalness, "metalness") },
    brightness: exp.expect.brightness
      ? levelMatch(bandLabel(result.listening.rawAvgBrightness, "brightness"), exp.expect.brightness)
      : { ok: true, note: bandLabel(result.listening.rawAvgBrightness, "brightness") },
  };
  const failed = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  results.push({
    ...result,
    concept: exp.character,
    checks,
    verdict: failed.length === 0 ? "PASS" : `PARTIAL (${failed.join(", ")})`,
    failed,
  });
}

// Cross-track diversity
const speciesVectors = results.map((r) => [r.species.organic, r.species.aggressive, r.species.rhythmic]);
let minDist = Infinity;
let closestPair = null;
let distTotal = 0;
let distCount = 0;
for (let i = 0; i < speciesVectors.length; i += 1) {
  for (let j = i + 1; j < speciesVectors.length; j += 1) {
    const a = speciesVectors[i];
    const b = speciesVectors[j];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    distTotal += d;
    distCount += 1;
    if (d < minDist) {
      minDist = d;
      closestPair = [results[i].label, results[j].label];
    }
  }
}

const morphDistribution = {};
const hueDistribution = {};
for (const track of results) {
  morphDistribution[track.dominantMorph] = (morphDistribution[track.dominantMorph] ?? 0) + 1;
  hueDistribution[track.palette.hueFamily] = (hueDistribution[track.palette.hueFamily] ?? 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  speciesCalibrationSeconds,
  trackCount: results.length,
  passCount: results.filter((r) => r.verdict === "PASS").length,
  closestSpeciesPair: { pair: closestPair, distance: Number(minDist.toFixed(4)) },
  meanSpeciesDistance: Number((distTotal / Math.max(1, distCount)).toFixed(4)),
  morphDistribution,
  hueDistribution,
  tracks: results,
};

const outJson = join(outDir, "track-eval-results.json");
writeFileSync(outJson, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.error(`\nWrote ${outJson}`);
