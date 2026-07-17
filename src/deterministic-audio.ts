/**
 * バッファ音源から決定論的なスペクトル時系列と形態シードを作る。
 * ライブ Analyser 依存を排し、同じ PCM なら同じ入力列になる。
 */

export const DETERMINISTIC_HOP_SEC = 1 / 60;
export const DETERMINISTIC_FFT_SIZE = 2048;

/** 1 フレーム分の生スペクトル（正規化前）と波形指標 */
export type DeterministicSpectralFrame = {
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
  peak: number;
  rms: number;
};

export type DeterministicAudioTimeline = {
  hopSec: number;
  duration: number;
  frames: DeterministicSpectralFrame[];
};

/** 生バイト列から 0〜1000 の形態シードを得る（デコード前のファイルと一対一） */
export const hashBytesToMorphologySeed = (bytes: ArrayBuffer): number => {
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

const mixMono = (buffer: AudioBuffer): Float32Array => {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const mixed = new Float32Array(length);
  for (let c = 0; c < numberOfChannels; c += 1) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mixed[i] += ch[i];
    }
  }
  const inv = 1 / numberOfChannels;
  for (let i = 0; i < length; i += 1) {
    mixed[i] *= inv;
  }
  return mixed;
};

/** in-place radix-2 FFT (re/im) */
const fftRadix2 = (re: Float32Array, im: Float32Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
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

const bandAverage = (
  mags: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  if (end < start) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    sum += mags[i];
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
};

/** Analyser の readBandHybrid に相当（平均とピークの混合） */
const bandHybrid = (
  mags: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  if (end < start) {
    return 0;
  }
  let sum = 0;
  let peak = 0;
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    const v = mags[i];
    sum += v;
    peak = Math.max(peak, v);
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return sum / count * 0.28 + peak * 0.72;
};

const bandCentroid = (
  mags: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
) => {
  const nyquist = sampleRate / 2;
  const bins = mags.length;
  const start = Math.max(0, Math.floor((minHz / nyquist) * bins));
  const end = Math.min(bins - 1, Math.ceil((maxHz / nyquist) * bins));
  let weighted = 0;
  let total = 0;
  for (let i = start; i <= end; i += 1) {
    const energy = mags[i];
    const frequencyRatio = i / Math.max(1, bins - 1);
    weighted += frequencyRatio * energy;
    total += energy;
  }
  return total <= 0.0001 ? 0 : Math.min(1, Math.max(0, weighted / total));
};

/**
 * AudioBuffer を固定 hop で走査し、ライブ update() と同じ帯域定義の時系列を作る。
 * mag はおおよそ 0〜1（Analyser byte/255 相当）にスケールする。
 */
export const buildDeterministicTimeline = (
  buffer: AudioBuffer,
  hopSec = DETERMINISTIC_HOP_SEC,
  fftSize = DETERMINISTIC_FFT_SIZE,
): DeterministicAudioTimeline => {
  const sampleRate = buffer.sampleRate;
  const mono = mixMono(buffer);
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const duration = mono.length / sampleRate;
  const frames: DeterministicSpectralFrame[] = [];

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mags = new Float32Array(fftSize / 2);
  const half = fftSize / 2;
  const invNorm = 2 / fftSize;

  for (let origin = 0; origin < mono.length; origin += hop) {
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < fftSize; i += 1) {
      const sampleIndex = origin + i - half;
      const sample =
        sampleIndex >= 0 && sampleIndex < mono.length ? mono[sampleIndex] : 0;
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
      re[i] = sample * window;
      im[i] = 0;
      sumSq += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }

    fftRadix2(re, im);

    for (let i = 0; i < half; i += 1) {
      // Analyser の byte スペクトラムに近い知覚スケールへ寄せる
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
    const centroid = bandCentroid(mags, sampleRate, 24, 9000);
    const bassFocus = (sub + low) / spectralTotal;
    const melodyFocus = melody / spectralTotal;
    const brightness = high / spectralTotal;
    const contrast =
      (Math.abs(sub - mid) +
        Math.abs(low - mid) +
        Math.abs(melody - mid) +
        Math.abs(mid - high)) /
      spectralTotal;

    frames.push({
      sub,
      low,
      mid,
      melody,
      high,
      overall,
      centroid,
      bassFocus,
      melodyFocus,
      brightness: Math.min(1, Math.max(0, brightness)),
      contrast: Math.min(1, Math.max(0, contrast)),
      peak,
      rms: Math.sqrt(sumSq / fftSize),
    });
  }

  return { hopSec, duration, frames };
};

export const sampleDeterministicFrame = (
  timeline: DeterministicAudioTimeline,
  timeSec: number,
): DeterministicSpectralFrame => {
  const { frames, hopSec, duration } = timeline;
  if (frames.length === 0 || timeSec < 0 || timeSec >= duration) {
    return {
      sub: 0,
      low: 0,
      mid: 0,
      melody: 0,
      high: 0,
      overall: 0,
      centroid: 0,
      bassFocus: 0,
      melodyFocus: 0,
      brightness: 0,
      contrast: 0,
      peak: 0,
      rms: 0,
    };
  }
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(timeSec / hopSec)));
  return frames[index];
};
