import "./styles.scss";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  applyBandSolo,
  BAND_TEST_TONES,
  bandSoloAllows,
  computeBandLiveWeights,
  getBandSoloMode,
  setBandSoloMode,
  snapshotBandMeters,
  type BandLiveWeights,
  type BandMeterSnapshot,
  type BandSoloMode,
} from "./band-test";
import {
  formatSculptureTuningForAgent,
  resetSculptureTuning,
  runtimeTuning,
  sculptureTuning,
  syncRuntimeTuning,
  TUNING_SLIDER_SPECS,
  type SculptureTuning,
} from "./sculpture-tuning";
import {
  StructureTracker,
  type StructureSnapshot,
} from "./structure-tracker";
import {
  DEFAULT_SPECIES_PROFILE,
  SpeciesProfiler,
  speciesMorphTargets,
  type SpeciesProfile,
} from "./species-profile";
import { fib, fibRatio, fibUnit } from "./fibonacci";

type SculptureMode = "classic" | "carve";

type SculptureExperience = {
  readonly group: THREE.Group;
  update(bands: AudioBands, deltaTime: number, userViewInteracting?: boolean, rhythm?: RhythmEvents, structure?: StructureSnapshot, species?: SpeciesProfile): void;
  applyLiveTuningNow(): void;
  complete(): void;
  reset(): void;
  createExportGroup(): THREE.Group;
};

const parseSculptureMode = (): SculptureMode => {
  const param = new URLSearchParams(window.location.search).get("mode");
  return param === "carve" ? "carve" : "classic";
};

type AudioBands = {
  /** サブ低域 (キック胴・フロアタム) 30–120 Hz */
  sub: number;
  /** 低域 (キック箱鳴り・スネア太さ) 120–400 Hz */
  low: number;
  /** 中域 (ドラムボディ・ハイハット胴) 400–2000 Hz */
  mid: number;
  /** メロディ中域 (ボーカル・主旋律) 700–1500 Hz */
  melody: number;
  /** 高域 (アタック 2–6 kHz + 輝き・空気感 5–18 kHz) */
  high: number;
  overall: number;
  centroid: number;
  bassFocus: number;
  /** melody / 全帯域 — 主旋律の存在感 */
  melodyFocus: number;
  brightness: number;
  contrast: number;
};

type WaveformMetrics = {
  peak: number;
  rms: number;
  peakDelta: number;
  energyDelta: number;
};

type AudioProfile = {
  duration: number;
  activeDuration: number;
  sampleCount: number;
  lowAverage: number;
  midAverage: number;
  highAverage: number;
  overallAverage: number;
  lowPeak: number;
  midPeak: number;
  highPeak: number;
  overallPeak: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  bassDominance: number;
  brightness: number;
  contrast: number;
  centroid: number;
  variation: number;
  attackAmount: number;
  attackRate: number;
  quietRatio: number;
  loudRatio: number;
};

type RhythmEvents = {
  kick: number;
  snare: number;
  hat: number;
  /** シンバル・大きな波形スパイクなどの瞬間反応 */
  transient: number;
  beat: number;
  beatIndex: number;
  kickIndex: number;
  snareIndex: number;
  hatIndex: number;
  transientIndex: number;
  downbeat: boolean;
  /** 推定テンポ (BPM)。ビートが検出できない間は直近値を維持。 */
  bpm: number;
  /** IOIベースの拍位相 0–1 */
  pulsePhase: number;
  /** 直近パルス間隔の安定度 */
  pulseConfidence: number;
  /** 減衰するパルスエンベロープ */
  pulseEnvelope: number;
  /** kick/transient 等で記録された離散パルス回数 */
  pulseIndex: number;
  /** オシロ表示用 */
  subLevel: number;
  wavePeak: number;
  waveEnergy: number;
};

// NOTE: render loop で最新値に更新し、SoundSculpture 側で参照する。
let latestRhythm: RhythmEvents = {
  kick: 0,
  snare: 0,
  hat: 0,
  transient: 0,
  beat: 0,
  beatIndex: 0,
  kickIndex: 0,
  snareIndex: 0,
  hatIndex: 0,
  transientIndex: 0,
  downbeat: false,
  bpm: 0,
  pulsePhase: 0,
  pulseConfidence: 0,
  pulseEnvelope: 0,
  pulseIndex: 0,
  subLevel: 0,
  wavePeak: 0,
  waveEnergy: 0,
};

const structureTracker = new StructureTracker();
const speciesProfiler = new SpeciesProfiler();
speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);

const defaultStructureSnapshot = (): StructureSnapshot => ({
  energyLong: 0,
  energyMid: 0,
  tension: 0,
  density: 0,
  novelty: 0,
  breathCycle: 0,
  phase: "embryo",
  organBudget: 0,
  organicScore: 0.5,
  mineralScore: 0,
  formationRamp: 0,
  detailRamp: 0,
  events: {
    noveltyPeak: false,
    energySurge: false,
    energyDrop: false,
    transientBurst: false,
    pulseStable: false,
  },
  lastEventLabel: "—",
});

let latestStructure: StructureSnapshot = defaultStructureSnapshot();

const SILENCE_THRESHOLD = 0.025;
const SILENCE_SECONDS_TO_COMPLETE = 2.4;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

const createEmptyAudioProfile = (): AudioProfile => ({
  duration: 0,
  activeDuration: 0,
  sampleCount: 0,
  lowAverage: 0,
  midAverage: 0,
  highAverage: 0,
  overallAverage: 0,
  lowPeak: 0,
  midPeak: 0,
  highPeak: 0,
  overallPeak: 0,
  lowRatio: 0,
  midRatio: 0,
  highRatio: 0,
  bassDominance: 0,
  brightness: 0,
  contrast: 0,
  centroid: 0,
  variation: 0,
  attackAmount: 0,
  attackRate: 0,
  quietRatio: 0,
  loudRatio: 0,
});

const vertexPattern = (x: number, y: number, z: number, salt: number) => {
  const wave = Math.sin(x * 5.13 + y * 1.37 + salt) + Math.sin(y * 4.21 - z * 2.31 + salt * 1.7) + Math.sin(z * 6.17 + x * 2.91 - salt * 0.6);

  return wave / 3;
};

const seededUnit = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * オンセット/ビート検出。
 * kick は「サブ低域 + 波形ピーク/エネルギー」の両方が揃った瞬間のみ（mid/high の誤検出を抑える）。
 */
class RhythmTracker {
  private envSub = 0;
  private envLow = 0;
  private envMid = 0;
  private envMelody = 0;
  private envHigh = 0;
  private prevPeak = 0;
  private prevRms = 0;
  private deltaSub = 0;
  private deltaLow = 0;
  private deltaMid = 0;
  private deltaMelody = 0;
  private deltaHigh = 0;
  private deltaPeak = 0;
  private deltaEnergy = 0;
  private lastKick = 10;
  private lastSnare = 10;
  private lastHat = 10;
  private lastTransient = 10;
  private lastBeat = 10;
  private beatIndex = 0;
  private kickIndex = 0;
  private snareIndex = 0;
  private hatIndex = 0;
  private transientIndex = 0;
  private tempoPhase = 0;
  private bpm = 0;
  private elapsed = 0;
  private lastPulseTime = 0;
  private pulsePhase = 0;
  private pulseConfidence = 0;
  private pulseEnvelope = 0;
  private pulseIntervals: number[] = [];
  private expectedPulseInterval = fibUnit(7, 8);
  private pulseIndex = 0;

  reset() {
    this.envSub = 0;
    this.envLow = 0;
    this.envMid = 0;
    this.envMelody = 0;
    this.envHigh = 0;
    this.prevPeak = 0;
    this.prevRms = 0;
    this.deltaSub = 0;
    this.deltaLow = 0;
    this.deltaMid = 0;
    this.deltaMelody = 0;
    this.deltaHigh = 0;
    this.deltaPeak = 0;
    this.deltaEnergy = 0;
    this.lastKick = 10;
    this.lastSnare = 10;
    this.lastHat = 10;
    this.lastTransient = 10;
    this.lastBeat = 10;
    this.beatIndex = 0;
    this.kickIndex = 0;
    this.snareIndex = 0;
    this.hatIndex = 0;
    this.transientIndex = 0;
    this.tempoPhase = 0;
    this.bpm = 0;
    this.elapsed = 0;
    this.lastPulseTime = 0;
    this.pulsePhase = 0;
    this.pulseConfidence = 0;
    this.pulseEnvelope = 0;
    this.pulseIntervals = [];
    this.expectedPulseInterval = fibUnit(7, 8);
    this.pulseIndex = 0;
  }

  private registerPulse(strength: number, deltaTime: number) {
    const now = this.elapsed;
    if (this.lastPulseTime > 0) {
      const interval = now - this.lastPulseTime;
      if (interval > fibUnit(3, 21) && interval < fibRatio(8, 3)) {
        this.pulseIntervals.push(interval);
        if (this.pulseIntervals.length > fib(5)) {
          this.pulseIntervals.shift();
        }
        const mean =
          this.pulseIntervals.reduce((sum, value) => sum + value, 0) / this.pulseIntervals.length;
        const variance =
          this.pulseIntervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          this.pulseIntervals.length;
        const cv = Math.sqrt(variance) / Math.max(fibUnit(2, 21), mean);
        this.pulseConfidence = clamp01(1 - cv * fibRatio(5, 3));
        this.expectedPulseInterval = mean;
      }
    }
    this.lastPulseTime = now;
    this.pulsePhase = 0;
    this.pulseIndex += 1;
    this.pulseEnvelope = Math.min(1, fibUnit(8, 9) + strength * fibRatio(8, 5));
    if (this.expectedPulseInterval > fibUnit(3, 21)) {
      this.bpm += ((60 / this.expectedPulseInterval) - this.bpm) * Math.min(1, deltaTime * fibUnit(5, 8));
    }
  }

  update(bands: AudioBands, waveform: WaveformMetrics | null, deltaTime: number): RhythmEvents {
    this.elapsed += deltaTime;
    const a = Math.min(1, deltaTime * 20);
    const prevSub = this.envSub;
    const prevLow = this.envLow;
    const prevMid = this.envMid;
    const prevMelody = this.envMelody;
    const prevHigh = this.envHigh;

    this.envSub += (bands.sub - this.envSub) * a;
    this.envLow += (bands.low - this.envLow) * a;
    this.envMid += (bands.mid - this.envMid) * a;
    this.envMelody += (bands.melody - this.envMelody) * a;
    this.envHigh += (bands.high - this.envHigh) * a;

    const onsetSub = Math.max(0, bands.sub - prevSub);
    const onsetLow = Math.max(0, bands.low - prevLow);
    const onsetMid = Math.max(0, bands.mid - prevMid);
    const onsetMelody = Math.max(0, bands.melody - prevMelody);
    const onsetHigh = Math.max(0, bands.high - prevHigh);
    const bassOnset = Math.max(onsetSub, onsetLow * 0.92);

    const peak = waveform?.peak ?? 0;
    const rms = waveform?.rms ?? 0;
    const peakDelta = waveform?.peakDelta ?? Math.max(0, peak - this.prevPeak);
    const energyDelta = waveform?.energyDelta ?? Math.max(0, rms - this.prevRms);
    this.prevPeak = peak;
    this.prevRms = rms;

    this.deltaSub += (onsetSub - this.deltaSub) * Math.min(1, deltaTime * 5.5);
    this.deltaLow += (onsetLow - this.deltaLow) * Math.min(1, deltaTime * 5.5);
    this.deltaMid += (onsetMid - this.deltaMid) * Math.min(1, deltaTime * 5.5);
    this.deltaMelody += (onsetMelody - this.deltaMelody) * Math.min(1, deltaTime * 5.5);
    this.deltaHigh += (onsetHigh - this.deltaHigh) * Math.min(1, deltaTime * 5.5);
    this.deltaPeak += (peakDelta - this.deltaPeak) * Math.min(1, deltaTime * 5.5);
    this.deltaEnergy += (energyDelta - this.deltaEnergy) * Math.min(1, deltaTime * 5.5);

    this.lastKick += deltaTime;
    this.lastSnare += deltaTime;
    this.lastHat += deltaTime;
    this.lastTransient += deltaTime;
    this.lastBeat += deltaTime;

    const waveHit =
      peakDelta > fibUnit(5, 34) + this.deltaPeak * fibUnit(8, 13) ||
      energyDelta > fibUnit(5, 34) + this.deltaEnergy * fibUnit(8, 13) ||
      peak > fibUnit(8, 21);
    const strongWave =
      peak > fibUnit(8, 13) || peakDelta > fibUnit(8, 34) || energyDelta > fibUnit(5, 34);

    // --- kick: 低音域 + 波形パルス（バスドラムの鼓動）---
    const bassGate = fibUnit(2, 34) + Math.max(this.deltaSub, this.deltaLow) * fibUnit(8, 13);
    const bassLevel = Math.max(bands.sub, bands.low * fibUnit(8, 13));
    const bassHit = bassOnset > bassGate && bassLevel > fibUnit(5, 34);
    const bassForward =
      bassLevel > bands.mid * fibUnit(8, 13) &&
      bassLevel > bands.high * fibUnit(8, 13);
    const denseMix = bands.mid > fibUnit(5, 21) && bands.high > fibUnit(5, 34);
    const metalKickFallback =
      bassHit &&
      bassLevel > fibUnit(8, 34) &&
      (bassOnset > bassGate * fibUnit(8, 13) || strongWave || peakDelta > fibUnit(5, 34) || denseMix);
    const notHatOnly = onsetHigh < bassOnset * fibRatio(8, 5) || bands.high < fibUnit(8, 13);

    let kick = 0;
    if (
      this.lastKick > fibUnit(3, 34) &&
      bassHit &&
      (waveHit || metalKickFallback || peakDelta > fibUnit(8, 34)) &&
      (bassForward || metalKickFallback || strongWave || denseMix) &&
      notHatOnly
    ) {
      kick = Math.max(bassOnset, peakDelta * fibRatio(8, 5), energyDelta * fibRatio(8, 5));
    }

    // --- snare: 中域 + メロディ帯域 (700–1500 Hz) の立ち上がり ---
    const snareGate = 0.04 + this.deltaMid * 0.95;
    const melodySnareGate = 0.024 + this.deltaMelody * 1.1;
    const snareFromMid =
      this.lastSnare > 0.08 && onsetMid > snareGate && bands.mid > 0.1 && kick < 0.03 ? onsetMid : 0;
    const snareFromMelody =
      this.lastSnare > 0.06 && onsetMelody > melodySnareGate && bands.melody > 0.12 && kick < 0.03
        ? onsetMelody * 1.25
        : 0;
    const snare = Math.max(snareFromMid, snareFromMelody);

    // --- hat: 高域の立ち上がり（ハイハット・シンバル・アタック）---
    const hatGate = 0.01 + this.deltaHigh * 0.52;
    const hat =
      this.lastHat > 0.022 && onsetHigh > hatGate && bands.high > 0.024 && kick < 0.05 ? onsetHigh * 1.15 : 0;

    // --- transient: シンバル・大きな波形スパイク（ハイハット単体でも反応）---
    const transientGate = 0.01 + this.deltaHigh * 0.48;
    const brightSpike = onsetHigh > transientGate || onsetMelody > transientGate * 1.05;
    let transient = 0;
    if (this.lastTransient > 0.022 && waveHit && brightSpike && bands.high > 0.018) {
      transient = Math.max(onsetHigh * 1.2, onsetMelody * 0.75, peakDelta * 1.1, energyDelta * 0.9);
    } else if (this.lastTransient > 0.045 && strongWave && peakDelta > 0.07) {
      transient = Math.max(peakDelta * 1.15, energyDelta * 0.95);
    }

    if (kick > 0) {
      this.lastKick = 0;
      this.kickIndex += 1;
    }
    if (snare > 0) {
      this.lastSnare = 0;
      this.snareIndex += 1;
    }
    if (hat > 0) {
      this.lastHat = 0;
      this.hatIndex += 1;
    }
    if (transient > 0) {
      this.lastTransient = 0;
      this.transientIndex += 1;
    }

    let beat = 0;
    if (kick > 0) beat = Math.min(1, kick * fibRatio(8, 3));
    else if (snare > 0) beat = Math.min(1, snare * fibRatio(5, 3));
    else if (hat > 0) beat = Math.min(1, hat * fibRatio(8, 5));
    else if (transient > 0) beat = Math.min(1, transient * fibRatio(5, 3));
    else if (
      this.lastBeat > fibUnit(8, 21) &&
      waveHit &&
      (energyDelta > fibUnit(5, 34) || peakDelta > fibUnit(8, 34) || peak > fibUnit(8, 13))
    ) {
      beat = Math.min(
        1,
        Math.max(energyDelta * fibRatio(8, 2), peakDelta * fibRatio(8, 2), (peak - fibUnit(8, 21)) * fibRatio(5, 3)),
      );
    }

    const fallbackPulseStrength =
      kick <= 0
        ? Math.max(
            transient > fibUnit(3, 21) ? transient * fibUnit(8, 13) : 0,
            snare > fibUnit(5, 21) && peakDelta > fibUnit(5, 34) ? snare * fibUnit(8, 13) : 0,
            beat > fibUnit(8, 13) && peakDelta > fibUnit(3, 21) ? beat * fibUnit(5, 13) : 0,
            peakDelta > fibUnit(8, 21) ? peakDelta * fibUnit(8, 13) : 0,
            energyDelta > fibUnit(5, 21) ? energyDelta * fibUnit(8, 13) : 0,
          )
        : 0;
    const pulseStrength = kick > 0 ? kick : fallbackPulseStrength;
    if (pulseStrength > fibUnit(3, 21)) {
      this.registerPulse(pulseStrength, deltaTime);
    } else if (this.expectedPulseInterval > fibUnit(3, 21)) {
      this.pulsePhase = Math.min(1, this.pulsePhase + deltaTime / this.expectedPulseInterval);
    }
    const pulseInterval = Math.max(fibUnit(3, 21), this.expectedPulseInterval);
    const decayRate = fib(5) / (pulseInterval * runtimeTuning.pulseHold);
    this.pulseEnvelope *= Math.exp(-deltaTime * (decayRate + (1 - this.pulseConfidence) * fibUnit(5, 8)));

    if (beat > 0) {
      const beatInterval = Math.max(fibUnit(3, 21), this.tempoPhase);
      const instantBpm = 60 / beatInterval;
      if (instantBpm > 40 && instantBpm < 220) {
        const lerp = Math.min(1, deltaTime * 4.2);
        this.bpm += (instantBpm - this.bpm) * (this.bpm <= 0 ? 1 : lerp);
      }
      this.tempoPhase = 0;
      this.beatIndex += 1;
      this.lastBeat = 0;
    } else {
      this.tempoPhase += deltaTime;
    }

    const downbeat = beat > 0 && this.beatIndex % 4 === 0;

    return {
      kick,
      snare,
      hat,
      transient,
      beat,
      beatIndex: this.beatIndex,
      kickIndex: this.kickIndex,
      snareIndex: this.snareIndex,
      hatIndex: this.hatIndex,
      transientIndex: this.transientIndex,
      downbeat,
      bpm: this.bpm,
      pulsePhase: this.pulsePhase,
      pulseConfidence: this.pulseConfidence,
      pulseEnvelope: this.pulseEnvelope,
      pulseIndex: this.pulseIndex,
      subLevel: bands.sub,
      wavePeak: peak,
      waveEnergy: rms,
    };
  }
}

const curlNoiseSample = (
  x: number,
  y: number,
  z: number,
  salt: number,
  out: { x: number; y: number; z: number },
) => {
  const eps = 0.42;
  const invDouble = 1 / (2 * eps);

  // Three independent scalar potentials Pa / Pb / Pc.
  // curl(F) where F = (Pa, Pb, Pc).
  const Pa_yp = vertexPattern(x, y + eps, z, salt);
  const Pa_yn = vertexPattern(x, y - eps, z, salt);
  const Pa_zp = vertexPattern(x, y, z + eps, salt);
  const Pa_zn = vertexPattern(x, y, z - eps, salt);
  const Pb_xp = vertexPattern(x + eps, y, z, salt + 7.13);
  const Pb_xn = vertexPattern(x - eps, y, z, salt + 7.13);
  const Pb_zp = vertexPattern(x, y, z + eps, salt + 7.13);
  const Pb_zn = vertexPattern(x, y, z - eps, salt + 7.13);
  const Pc_xp = vertexPattern(x + eps, y, z, salt + 13.71);
  const Pc_xn = vertexPattern(x - eps, y, z, salt + 13.71);
  const Pc_yp = vertexPattern(x, y + eps, z, salt + 13.71);
  const Pc_yn = vertexPattern(x, y - eps, z, salt + 13.71);

  out.x = ((Pc_yp - Pc_yn) - (Pb_zp - Pb_zn)) * invDouble;
  out.y = ((Pa_zp - Pa_zn) - (Pc_xp - Pc_xn)) * invDouble;
  out.z = ((Pb_xp - Pb_xn) - (Pa_yp - Pa_yn)) * invDouble;
};

type GrowthAnchorKind = "lobe" | "tentacle" | "crystal" | "erosion";

/** シルエットの造形モード。diabolo 一強にならないよう複数をブレンドする。 */
type MorphWeights = {
  diabolo: number;
  torus: number;
  monolith: number;
  coral: number;
  spindle: number;
};

type GrowthAnchor = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
  strength: number;
  decay: number;
  kind: GrowthAnchorKind;
  age: number;
};

/** 彫刻用ジオメトリの分割数（merge 後も十分な頂点密度を確保）。 */
const SCULPTURE_SPHERE_DETAIL = 10;

/** ジオメトリ頂点を完全な球面上に正規化する。 */
const normalizeGeometryToSphere = (geometry: THREE.BufferGeometry, radius: number) => {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    position.setXYZ(i, (x / len) * radius, (y / len) * radius, (z / len) * radius);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
};

/** 均質な geodesic 球 + 頂点結合で滑らかなシェーディングを得る。 */
const createSculptureSphereGeometry = (radius: number) => {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(radius, SCULPTURE_SPHERE_DETAIL));
  normalizeGeometryToSphere(geometry, radius);
  return geometry;
};

const CLAY_CORE_COLOR = 0xd9cdb8;
const CLAY_INNER_COLOR = 0xcfc3ae;

const buildFragmentBasis = (
  axis: THREE.Vector3,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
  normal: THREE.Vector3,
) => {
  normal.copy(axis).normalize();
  const helper = Math.abs(normal.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  tangent.crossVectors(helper, normal).normalize();
  bitangent.crossVectors(normal, tangent).normalize();
};

const surfaceVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const surfaceFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uMid;
  uniform float uMelody;
  uniform float uMelodyLine;
  uniform float uMelodyFresnel;
  uniform float uMelodyNoise;
  uniform float uMelodyFlowAnim;
  uniform float uHigh;
  uniform float uLive;
  uniform float uGlow;
  uniform float uOpacity;
  uniform float uCompleted;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDirection), 0.0), 2.45);
    float frozen = smoothstep(0.0, 1.0, uCompleted);
    float flowTime = uTime * (1.0 - frozen) * (1.0 + uLive * uMelodyFlowAnim);

    float surfaceNoise = noise(vWorldPosition * 4.2 + vec3(0.0, flowTime * 0.34, 0.0));
    float fineNoise = noise(vWorldPosition * 18.0 - vec3(flowTime * 0.22));
    float latitude = sin((vUv.y * 34.0) + flowTime * 2.8 + surfaceNoise * 2.2);
    float meridian = sin((vUv.x * 58.0) - flowTime * 3.6 + fineNoise * 1.6);
    float lineDrive = uLive * (0.62 + uHigh * 0.95);
    float melodyLines = smoothstep(0.72, 0.98, latitude) * lineDrive * uMelodyLine;
    float dataLines = 0.0;
    float microSignals = smoothstep(0.8, 0.995, meridian) * uHigh * lineDrive * 1.2;

    vec3 baseColor = vec3(0.62, 0.78, 0.94);
    vec3 electricBlue = vec3(0.24, 0.55, 1.0);
    vec3 melodyGold = vec3(1.0, 0.82, 0.52);
    vec3 color = baseColor * 0.24;
    color += electricBlue * (fresnel * (0.95 + uHigh * 1.35));
    color += melodyGold * melodyLines;
    color += melodyGold * fresnel * uMelodyFresnel * lineDrive;
    color += vec3(0.72, 0.94, 1.0) * microSignals * 0.48;
    color += vec3(0.2, 0.42, 0.72) * surfaceNoise * uLive * 0.22;
    color += vec3(0.55, 0.38, 0.22) * surfaceNoise * uMelodyNoise * lineDrive * 0.35;

    float hotVeins = pow(noise(vWorldPosition * 9.5 + vec3(flowTime * 0.5)), 2.8);
    float ember = pow(noise(vWorldPosition * 22.0 - vec3(flowTime * 0.8)), 4.2);
    color += vec3(0.45, 0.78, 1.0) * hotVeins * uGlow * (0.35 + uHigh * 0.55);
    color += vec3(0.92, 0.96, 1.0) * ember * uGlow * uHigh * 0.65;

    // 透明外殻が強いと「中身が空っぽ」に見えやすいので、fresnel/ラインの寄与を抑える
    float alpha = uOpacity + fresnel * 0.11 + melodyLines * 0.05 + microSignals * 0.05;
    alpha += hotVeins * uGlow * 0.08 + ember * uGlow * uHigh * 0.06;
    alpha += lineDrive * fresnel * uMelodyFresnel * 0.06;
    alpha *= mix(1.0, 0.58, frozen);

    gl_FragColor = vec4(color, alpha);
  }
`;

class AudioInput {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private devAudioUrl: string | null = null;
  private devAudioBuffer: AudioBuffer | null = null;
  private bands: AudioBands = {
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
  };
  private prevWaveRms = 0;
  private prevWavePeak = 0;
  private profile = createEmptyAudioProfile();
  private previousProfileBands: AudioBands | null = null;
  private lowProfileTotal = 0;
  private midProfileTotal = 0;
  private highProfileTotal = 0;
  private overallProfileTotal = 0;
  private centroidProfileTotal = 0;
  private bassFocusProfileTotal = 0;
  private brightnessProfileTotal = 0;
  private contrastProfileTotal = 0;
  private variationProfileTotal = 0;
  private attackProfileTotal = 0;
  private attackEventCount = 0;
  private quietProfileDuration = 0;
  private loudProfileDuration = 0;

  async startMicrophone(deviceId?: string) {
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    if (deviceId && deviceId !== "default") {
      audioConstraints.deviceId = { exact: deviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });

    this.connectStream(stream);
  }

  async listAudioInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput");
  }

  async startDisplayAudio() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: true,
    });

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("共有された画面またはタブに音声トラックがありません。");
    }

    this.connectStream(stream);
  }

  async startDevAudio(audioUrl: string) {
    const needsLoad = this.devAudioUrl !== audioUrl || !this.devAudioBuffer;
    if (needsLoad) {
      this.initAnalyser();

      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`開発用音源を読み込めませんでした (${response.status})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      this.devAudioBuffer = await this.context!.decodeAudioData(arrayBuffer);
      this.devAudioUrl = audioUrl;
    }

    this.playDevBuffer();

    if (this.context!.state === "suspended") {
      await this.context!.resume();
    }
  }

  isUsingDevAudio() {
    return this.devAudioUrl !== null;
  }

  restartDevAudioIfActive() {
    if (!this.devAudioUrl || !this.devAudioBuffer) {
      return false;
    }
    this.playDevBuffer();
    this.resetAnalysisState();
    return true;
  }

  stopPlayback() {
    try {
      this.bufferSource?.stop();
    } catch {
      // already stopped
    }
    this.bufferSource?.disconnect();
    this.bufferSource = null;

    if (this.analyser && this.context) {
      try {
        this.analyser.disconnect(this.context.destination);
      } catch {
        // not connected
      }
    }
  }

  async playBandIsolationTest(
    tones: ReadonlyArray<{ hz: number; seconds: number; label: string }>,
    onStep?: (label: string) => void,
  ) {
    if (!this.context || !this.analyser) {
      throw new Error("音入力を開始してからテスト音を再生してください。");
    }

    this.stopPlayback();

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.analyser.connect(this.context.destination);

    let startAt = this.context.currentTime + 0.08;
    const gap = 0.4;

    for (const tone of tones) {
      onStep?.(tone.label);
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.hz;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.06);
      gain.gain.setValueAtTime(0.28, startAt + tone.seconds - 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.seconds);
      osc.connect(gain);
      gain.connect(this.analyser);
      osc.start(startAt);
      osc.stop(startAt + tone.seconds + 0.02);
      startAt += tone.seconds + gap;
    }

    const totalSeconds = startAt - this.context.currentTime;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, totalSeconds * 1000 + 80);
    });
  }

  private playDevBuffer() {
    if (!this.context || !this.analyser || !this.devAudioBuffer) {
      return;
    }

    try {
      this.bufferSource?.stop();
    } catch {
      // already stopped
    }
    this.bufferSource?.disconnect();

    const source = this.context.createBufferSource();
    source.buffer = this.devAudioBuffer;
    source.loop = false;
    source.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    source.start(0);
    this.bufferSource = source;
  }

  private disconnect() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.bufferSource?.stop();
    this.bufferSource?.disconnect();
    this.stream = null;
    this.source = null;
    this.bufferSource = null;
  }

  private initAnalyser() {
    this.disconnect();

    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    // ビート/ハイハットの瞬間を拾いやすくする（常時ノイズではなくオンセット駆動に寄せる）
    this.analyser.smoothingTimeConstant = 0.09;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.resetProfile();
  }

  private connectStream(stream: MediaStream) {
    this.devAudioUrl = null;
    this.devAudioBuffer = null;
    this.initAnalyser();

    this.stream = stream;
    this.source = this.context!.createMediaStreamSource(stream);
    this.source.connect(this.analyser!);
  }

  getWaveformBytes() {
    if (!this.analyser || !this.timeData) {
      return null;
    }
    this.analyser.getByteTimeDomainData(this.timeData);
    return this.timeData;
  }

  getWaveformMetrics(): WaveformMetrics | null {
    const timeData = this.getWaveformBytes();
    if (!timeData) {
      return null;
    }

    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < timeData.length; i += 1) {
      const v = (timeData[i] - 128) / 128;
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.sqrt(sumSq / timeData.length);
    const peakDelta = Math.max(0, peak - this.prevWavePeak);
    const energyDelta = Math.max(0, rms - this.prevWaveRms);
    this.prevWavePeak = peak;
    this.prevWaveRms = rms;

    return { peak, rms, peakDelta, energyDelta };
  }

  resetAnalysisState() {
    this.prevWavePeak = 0;
    this.prevWaveRms = 0;
    this.resetProfile();
  }

  update(deltaTime: number) {
    if (!this.context || !this.analyser || !this.data) {
      return this.bands;
    }

    this.analyser.getByteFrequencyData(this.data);

    const sub = this.readBand(30, 120);
    const low = this.readBand(120, 400);
    const mid = this.readBand(400, 2000);
    const melody = this.readBand(700, 1500);
    const presence = this.readBandHybrid(1800, 6500);
    const air = this.readBandHybrid(5000, 18000);
    const high = presence * 0.38 + air * 0.62;
    const overall =
      sub * 0.18 + low * 0.32 + mid * 0.2 + melody * 0.14 + high * 0.14;
    const spectralTotal = sub + low + mid + high + melody * 0.35 + 0.0001;
    const centroid = this.readCentroid(24, 9000);
    const bassFocus = (sub + low) / spectralTotal;
    const melodyFocus = melody / spectralTotal;
    const brightness = high / spectralTotal;
    const contrast =
      (Math.abs(sub - mid) +
        Math.abs(low - mid) +
        Math.abs(melody - mid) +
        Math.abs(mid - high)) /
      spectralTotal;

    this.bands = {
      sub: smoothstep(0.02, 0.38, sub),
      low: smoothstep(0.025, 0.42, low),
      mid: smoothstep(0.018, 0.34, mid),
      melody: smoothstep(0.006, 0.2, melody),
      high: smoothstep(0.005, 0.14, high),
      overall: smoothstep(0.014, 0.36, overall),
      centroid,
      bassFocus,
      melodyFocus,
      brightness: clamp01(brightness),
      contrast: clamp01(contrast),
    };

    this.updateProfile(this.bands, deltaTime);

    return this.bands;
  }

  getProfile() {
    return this.profile;
  }

  private resetProfile() {
    this.profile = createEmptyAudioProfile();
    this.previousProfileBands = null;
    this.lowProfileTotal = 0;
    this.midProfileTotal = 0;
    this.highProfileTotal = 0;
    this.overallProfileTotal = 0;
    this.centroidProfileTotal = 0;
    this.bassFocusProfileTotal = 0;
    this.brightnessProfileTotal = 0;
    this.contrastProfileTotal = 0;
    this.variationProfileTotal = 0;
    this.attackProfileTotal = 0;
    this.attackEventCount = 0;
    this.quietProfileDuration = 0;
    this.loudProfileDuration = 0;
  }

  private updateProfile(bands: AudioBands, deltaTime: number) {
    const sampleDuration = Math.max(0, deltaTime);
    if (sampleDuration <= 0) {
      return;
    }

    this.profile.duration += sampleDuration;
    this.profile.sampleCount += 1;

    if (bands.overall < SILENCE_THRESHOLD) {
      this.quietProfileDuration += sampleDuration;
    }

    if (bands.overall > 0.66) {
      this.loudProfileDuration += sampleDuration;
    }

    if (bands.overall >= SILENCE_THRESHOLD) {
      this.profile.activeDuration += sampleDuration;
      this.lowProfileTotal += bands.low * sampleDuration;
      this.midProfileTotal += bands.mid * sampleDuration;
      this.highProfileTotal += bands.high * sampleDuration;
      this.overallProfileTotal += bands.overall * sampleDuration;
      this.centroidProfileTotal += bands.centroid * sampleDuration;
      this.bassFocusProfileTotal += bands.bassFocus * sampleDuration;
      this.brightnessProfileTotal += bands.brightness * sampleDuration;
      this.contrastProfileTotal += bands.contrast * sampleDuration;

      if (this.previousProfileBands) {
        const spectralShift =
          Math.abs(bands.low - this.previousProfileBands.low) +
          Math.abs(bands.mid - this.previousProfileBands.mid) +
          Math.abs(bands.high - this.previousProfileBands.high) +
          Math.abs(bands.overall - this.previousProfileBands.overall);
        const attack =
          Math.max(0, bands.overall - this.previousProfileBands.overall) +
          Math.max(0, bands.low - this.previousProfileBands.low) * 0.3 +
          Math.max(0, bands.mid - this.previousProfileBands.mid) * 0.25 +
          Math.max(0, bands.high - this.previousProfileBands.high) * 0.35;

        this.variationProfileTotal += spectralShift * sampleDuration;
        this.attackProfileTotal += attack * sampleDuration;

        if (attack > 0.08) {
          this.attackEventCount += 1;
        }
      }
    }

    this.profile.lowPeak = Math.max(this.profile.lowPeak, bands.low);
    this.profile.midPeak = Math.max(this.profile.midPeak, bands.mid);
    this.profile.highPeak = Math.max(this.profile.highPeak, bands.high);
    this.profile.overallPeak = Math.max(this.profile.overallPeak, bands.overall);

    const activeDuration = Math.max(0.0001, this.profile.activeDuration);
    const bandEnergyTotal = this.lowProfileTotal + this.midProfileTotal + this.highProfileTotal + 0.0001;

    this.profile.lowAverage = this.lowProfileTotal / activeDuration;
    this.profile.midAverage = this.midProfileTotal / activeDuration;
    this.profile.highAverage = this.highProfileTotal / activeDuration;
    this.profile.overallAverage = this.overallProfileTotal / activeDuration;
    this.profile.lowRatio = this.lowProfileTotal / bandEnergyTotal;
    this.profile.midRatio = this.midProfileTotal / bandEnergyTotal;
    this.profile.highRatio = this.highProfileTotal / bandEnergyTotal;
    this.profile.bassDominance = this.bassFocusProfileTotal / activeDuration;
    this.profile.brightness = this.brightnessProfileTotal / activeDuration;
    this.profile.contrast = this.contrastProfileTotal / activeDuration;
    this.profile.centroid = this.centroidProfileTotal / activeDuration;
    this.profile.variation = this.variationProfileTotal / activeDuration;
    this.profile.attackAmount = this.attackProfileTotal / activeDuration;
    this.profile.attackRate = this.attackEventCount / activeDuration;
    this.profile.quietRatio = this.quietProfileDuration / Math.max(0.0001, this.profile.duration);
    this.profile.loudRatio = this.loudProfileDuration / Math.max(0.0001, this.profile.duration);
    this.previousProfileBands = bands;
  }

  private readBand(minHz: number, maxHz: number) {
    if (!this.context || !this.analyser || !this.data) {
      return 0;
    }

    const nyquist = this.context.sampleRate / 2;
    const startIndex = Math.max(0, Math.floor((minHz / nyquist) * this.data.length));
    const endIndex = Math.min(this.data.length - 1, Math.ceil((maxHz / nyquist) * this.data.length));

    let sum = 0;
    let count = 0;

    for (let i = startIndex; i <= endIndex; i += 1) {
      sum += this.data[i] / 255;
      count += 1;
    }

    return count === 0 ? 0 : sum / count;
  }

  /** 平均とピークの混合 — 狭い帯域のアタック（シンバル・クリック）を拾いやすくする */
  private readBandHybrid(minHz: number, maxHz: number) {
    if (!this.context || !this.analyser || !this.data) {
      return 0;
    }

    const nyquist = this.context.sampleRate / 2;
    const startIndex = Math.max(0, Math.floor((minHz / nyquist) * this.data.length));
    const endIndex = Math.min(this.data.length - 1, Math.ceil((maxHz / nyquist) * this.data.length));

    let sum = 0;
    let peak = 0;
    let count = 0;

    for (let i = startIndex; i <= endIndex; i += 1) {
      const energy = this.data[i] / 255;
      sum += energy;
      peak = Math.max(peak, energy);
      count += 1;
    }

    if (count === 0) {
      return 0;
    }

    const average = sum / count;
    return average * 0.28 + peak * 0.72;
  }

  private readCentroid(minHz: number, maxHz: number) {
    if (!this.context || !this.analyser || !this.data) {
      return 0;
    }

    const nyquist = this.context.sampleRate / 2;
    const startIndex = Math.max(0, Math.floor((minHz / nyquist) * this.data.length));
    const endIndex = Math.min(this.data.length - 1, Math.ceil((maxHz / nyquist) * this.data.length));
    let weightedFrequency = 0;
    let totalEnergy = 0;

    for (let i = startIndex; i <= endIndex; i += 1) {
      const energy = this.data[i] / 255;
      const frequencyRatio = i / Math.max(1, this.data.length - 1);
      weightedFrequency += frequencyRatio * energy;
      totalEnergy += energy;
    }

    return totalEnergy <= 0.0001 ? 0 : clamp01(weightedFrequency / totalEnergy);
  }
}

export type SoundSculptureOptions = {
  /** 粘土の変形ロジックはそのまま、コアの見た目だけ頂点追従の粒にする */
  granular?: boolean;
};

class SoundSculpture {
  private static readonly maxParticles = 900;
  private static readonly maxGlowDust = 1400;
  private static readonly maxSparkles = 360;
  private static readonly maxDetachmentDustSand = 1200;
  private static readonly maxDetachmentDustMetal = 800;
  private static readonly maxDetachmentDustSpark = 600;

  readonly group = new THREE.Group();

  private readonly core: THREE.Mesh;
  private readonly innerCore: THREE.Mesh;
  private readonly surface: THREE.Mesh;
  private readonly particles: THREE.Points;
  private readonly glowDust: THREE.Points;
  private readonly sparkles: THREE.Points;
  private readonly detachmentDustSand: THREE.Points;
  private readonly detachmentDustMetal: THREE.Points;
  private readonly detachmentDustSpark: THREE.Points;
  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly innerCoreMaterial: THREE.MeshStandardMaterial;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly glowDustMaterial: THREE.PointsMaterial;
  private readonly sparkleMaterial: THREE.PointsMaterial;
  private readonly detachmentDustSandMaterial: THREE.PointsMaterial;
  private readonly detachmentDustMetalMaterial: THREE.PointsMaterial;
  private readonly detachmentDustSparkMaterial: THREE.PointsMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly surfaceGeometry: THREE.BufferGeometry;
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly glowDustGeometry: THREE.BufferGeometry;
  private readonly sparkleGeometry: THREE.BufferGeometry;
  private readonly detachmentDustSandGeometry: THREE.BufferGeometry;
  private readonly detachmentDustMetalGeometry: THREE.BufferGeometry;
  private readonly detachmentDustSparkGeometry: THREE.BufferGeometry;
  private readonly glowDustPositions: Float32Array;
  private readonly glowDustColors: Float32Array;
  private readonly glowDustBaseDirs: Float32Array;
  private readonly sparklePositions: Float32Array;
  private readonly sparkleColors: Float32Array;
  private readonly sparkleLife: Float32Array;
  private readonly detachmentDustSandPositions: Float32Array;
  private readonly detachmentDustSandColors: Float32Array;
  private readonly detachmentDustSandVelocities: Float32Array;
  private readonly detachmentDustSandLife: Float32Array;
  private detachmentDustSandCursor = 0;

  private readonly detachmentDustMetalPositions: Float32Array;
  private readonly detachmentDustMetalColors: Float32Array;
  private readonly detachmentDustMetalVelocities: Float32Array;
  private readonly detachmentDustMetalLife: Float32Array;
  private detachmentDustMetalCursor = 0;

  private readonly detachmentDustSparkPositions: Float32Array;
  private readonly detachmentDustSparkColors: Float32Array;
  private readonly detachmentDustSparkVelocities: Float32Array;
  private readonly detachmentDustSparkLife: Float32Array;
  private detachmentDustSparkCursor = 0;
  private readonly detachmentCarve: Float32Array;
  private readonly basePositions: Float32Array;
  private readonly baseSurfacePositions: Float32Array;
  private readonly accumulated: Float32Array;
  private readonly midBumps: Float32Array;
  private readonly highSpikes: Float32Array;
  private readonly erosionField: Float32Array;
  private readonly sculptureMemory: Float32Array;
  private readonly liveOffset: Float32Array;
  private readonly surfaceLiveOffset: Float32Array;
  // Per-vertex directional offset (任意方向への変位場)。
  // accumulated/midBumps/highSpikes が "法線方向のスカラ" であるのに対し、
  // ここは横方向・接線方向・結晶軸など、任意ベクトルの蓄積を担う。
  private readonly vectorField: Float32Array;
  // Live tangent flow (curl noise driven, 中音持続でうねる)。
  private readonly flowField: Float32Array;
  // 頂点ごとに固定された結晶軸 (高音時の "結晶化" 方向)。
  private readonly crystalAxes: Float32Array;
  // 成長拠点 (lobe/tentacle/crystal/erosion)。音イベントでスポーン。
  private readonly growthAnchors: GrowthAnchor[] = [];
  private static readonly maxGrowthAnchors = 28;
  private anchorSpawnCooldown = 0;
  // 一時的な計算用バッファ (curl 等)。
  private readonly _curlOut = { x: 0, y: 0, z: 0 };
  /** 初期メッシュの平均半径。変形後もこのスケールを維持する (質量一定・広がりは局所で可)。 */
  private readonly targetCoreMeanRadius: number;
  private readonly targetSurfaceMeanRadius: number;
  private readonly particlePositions: Float32Array;
  private readonly particleColors: Float32Array;
  private readonly particleStartPositions: Float32Array;
  private readonly particleTargetDirections: Float32Array;
  private readonly particleTargetOffsets: Float32Array;
  private readonly particleProgress: Float32Array;
  private readonly particleActive: Uint8Array;
  private readonly particleStuck: Uint8Array;
  private formingTime = 0;
  private activeFormingTime = 0;
  private spectralPhase = 0;
  private carvingPhase = 0;
  private formStretch = 0;
  private formWaist = 0;
  private formTwist = 0;
  private formBendX = 0;
  private formBendZ = 0;
  private formAsymmetry = 0;
  private formBaseWeight = 0;
  /** 造形の主軸 (Y 固定ではなく音・乱数で傾く)。 */
  private readonly morphAxis = new THREE.Vector3(0, 1, 0);
  private morphWeights: MorphWeights = {
    diabolo: 0.2,
    torus: 0.2,
    monolith: 0.2,
    coral: 0.2,
    spindle: 0.2,
  };
  private waistCenterAlong = 0;
  private morphologySeed = 0;
  private readonly targetCoreColor = new THREE.Color(CLAY_CORE_COLOR);
  private readonly targetCoreEmissive = new THREE.Color(0x000000);
  private particleCursor = 0;
  private particleEmission = 0;
  private sparkleEmission = 0;
  private sparkleCursorIndex = 0;
  private separationTendency = 0;
  private spectralShift = 0;
  private previousBandsForSeparation: AudioBands | null = null;
  private fragmentSpawnCooldown = 0;
  private completed = false;
  private frozenTime = 0;
  private completeFadeOut = 1;
  private currentStructure: StructureSnapshot = defaultStructureSnapshot();
  private speciesProfile: SpeciesProfile = { ...DEFAULT_SPECIES_PROFILE };
  private lastNoveltySpawn = 0;
  private lastKickIndexApplied = -1;
  private lastSnareIndexApplied = -1;
  private lastHatIndexApplied = -1;
  private lastTransientIndexApplied = -1;
  private lastPulseIndexApplied = -1;
  private kickImpulse = 0;
  private snareImpulse = 0;
  private hatImpulse = 0;
  private waveImpulse = 0;
  private lastBands: AudioBands | null = null;
  private readonly baseScale = new THREE.Vector3(1, 1, 1);
  private readonly granular: boolean;
  private grainMass: THREE.Points | null = null;
  private grainMassGeometry: THREE.BufferGeometry | null = null;
  private grainMassMaterial: THREE.PointsMaterial | null = null;
  private grainMassPositions: Float32Array | null = null;
  private grainMassColors: Float32Array | null = null;
  private readonly scratchGrainColor = new THREE.Color();

  constructor(options?: SoundSculptureOptions) {
    this.granular = options?.granular ?? false;
    // Icosahedron + mergeVertices: 球面上の均質な頂点分布と滑らかな法線の両立
    this.geometry = createSculptureSphereGeometry(1.34);
    // core と重なると縁がチラつくので、少し外側へ
    this.surfaceGeometry = createSculptureSphereGeometry(1.46);

    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: CLAY_CORE_COLOR,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.94,
      metalness: 0,
      flatShading: false,
      // surface(透明)との Z-fighting を避けて「隙間の線」を減らす
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    // “粘土の中身”を感じるための内側の塊
    this.innerCoreMaterial = new THREE.MeshStandardMaterial({
      color: CLAY_INNER_COLOR,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.97,
      metalness: 0,
      flatShading: false,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMid: { value: 0 },
        uMelody: { value: 0 },
        uMelodyLine: { value: 0.35 },
        uMelodyFresnel: { value: 0.38 },
        uMelodyNoise: { value: 0.12 },
        uMelodyFlowAnim: { value: 1.8 },
        uHigh: { value: 0 },
        uLive: { value: 0 },
        uGlow: { value: 0 },
        // 外殻は控えめにして core の質量感を主役に
        uOpacity: { value: 0.14 },
        uCompleted: { value: 0 },
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      // core と競合しないよう前に出す
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.AdditiveBlending,
    });

    this.core = new THREE.Mesh(this.geometry, this.coreMaterial);
    this.innerCore = new THREE.Mesh(this.geometry, this.innerCoreMaterial);
    this.surface = new THREE.Mesh(this.surfaceGeometry, this.surfaceMaterial);
    this.core.castShadow = true;
    this.core.receiveShadow = true;
    this.innerCore.castShadow = true;
    this.innerCore.receiveShadow = true;
    // 初期は外側と一体の粘土球。形成が進むと内側の厚みが見える
    this.innerCore.scale.setScalar(1);
    this.surface.castShadow = false;
    this.surface.receiveShadow = false;

    this.particlePositions = new Float32Array(SoundSculpture.maxParticles * 3);
    this.particleColors = new Float32Array(SoundSculpture.maxParticles * 3);
    this.particleStartPositions = new Float32Array(SoundSculpture.maxParticles * 3);
    this.particleTargetDirections = new Float32Array(SoundSculpture.maxParticles * 3);
    this.particleTargetOffsets = new Float32Array(SoundSculpture.maxParticles);
    this.particleProgress = new Float32Array(SoundSculpture.maxParticles);
    this.particleActive = new Uint8Array(SoundSculpture.maxParticles);
    this.particleStuck = new Uint8Array(SoundSculpture.maxParticles);
    this.particlePositions.fill(999);
    this.particleGeometry = new THREE.BufferGeometry();
    this.particleGeometry.setAttribute("position", new THREE.BufferAttribute(this.particlePositions, 3));
    this.particleGeometry.setAttribute("color", new THREE.BufferAttribute(this.particleColors, 3));
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);

    this.glowDustPositions = new Float32Array(SoundSculpture.maxGlowDust * 3);
    this.glowDustColors = new Float32Array(SoundSculpture.maxGlowDust * 3);
    this.glowDustBaseDirs = new Float32Array(SoundSculpture.maxGlowDust * 3);
    this.glowDustGeometry = new THREE.BufferGeometry();
    this.glowDustGeometry.setAttribute("position", new THREE.BufferAttribute(this.glowDustPositions, 3));
    this.glowDustGeometry.setAttribute("color", new THREE.BufferAttribute(this.glowDustColors, 3));
    this.glowDustMaterial = new THREE.PointsMaterial({
      size: 0.016,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowDust = new THREE.Points(this.glowDustGeometry, this.glowDustMaterial);
    this.initGlowDust();

    this.sparklePositions = new Float32Array(SoundSculpture.maxSparkles * 3);
    this.sparkleColors = new Float32Array(SoundSculpture.maxSparkles * 3);
    this.sparkleLife = new Float32Array(SoundSculpture.maxSparkles);
    this.sparklePositions.fill(999);
    this.sparkleGeometry = new THREE.BufferGeometry();
    this.sparkleGeometry.setAttribute("position", new THREE.BufferAttribute(this.sparklePositions, 3));
    this.sparkleGeometry.setAttribute("color", new THREE.BufferAttribute(this.sparkleColors, 3));
    this.sparkleMaterial = new THREE.PointsMaterial({
      size: 0.052,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkles = new THREE.Points(this.sparkleGeometry, this.sparkleMaterial);

    const detachmentMap = this.makeCircleTexture();

    // --- sand dust (kick/sub 寄り、寿命長め、重い) ---
    this.detachmentDustSandPositions = new Float32Array(SoundSculpture.maxDetachmentDustSand * 3);
    this.detachmentDustSandColors = new Float32Array(SoundSculpture.maxDetachmentDustSand * 3);
    this.detachmentDustSandVelocities = new Float32Array(SoundSculpture.maxDetachmentDustSand * 3);
    this.detachmentDustSandLife = new Float32Array(SoundSculpture.maxDetachmentDustSand);
    this.detachmentDustSandPositions.fill(999);
    this.detachmentDustSandGeometry = new THREE.BufferGeometry();
    this.detachmentDustSandGeometry.setAttribute("position", new THREE.BufferAttribute(this.detachmentDustSandPositions, 3));
    this.detachmentDustSandGeometry.setAttribute("color", new THREE.BufferAttribute(this.detachmentDustSandColors, 3));
    this.detachmentDustSandMaterial = new THREE.PointsMaterial({
      size: 0.026,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: detachmentMap,
    });
    this.detachmentDustSand = new THREE.Points(this.detachmentDustSandGeometry, this.detachmentDustSandMaterial);

    // --- metal dust (snare/mid 寄り、角ばった光の粒のつもり) ---
    this.detachmentDustMetalPositions = new Float32Array(SoundSculpture.maxDetachmentDustMetal * 3);
    this.detachmentDustMetalColors = new Float32Array(SoundSculpture.maxDetachmentDustMetal * 3);
    this.detachmentDustMetalVelocities = new Float32Array(SoundSculpture.maxDetachmentDustMetal * 3);
    this.detachmentDustMetalLife = new Float32Array(SoundSculpture.maxDetachmentDustMetal);
    this.detachmentDustMetalPositions.fill(999);
    this.detachmentDustMetalGeometry = new THREE.BufferGeometry();
    this.detachmentDustMetalGeometry.setAttribute("position", new THREE.BufferAttribute(this.detachmentDustMetalPositions, 3));
    this.detachmentDustMetalGeometry.setAttribute("color", new THREE.BufferAttribute(this.detachmentDustMetalColors, 3));
    this.detachmentDustMetalMaterial = new THREE.PointsMaterial({
      size: 0.02,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: detachmentMap,
    });
    this.detachmentDustMetal = new THREE.Points(this.detachmentDustMetalGeometry, this.detachmentDustMetalMaterial);

    // --- spark dust (hat/high 寄り、寿命短め、明るい) ---
    this.detachmentDustSparkPositions = new Float32Array(SoundSculpture.maxDetachmentDustSpark * 3);
    this.detachmentDustSparkColors = new Float32Array(SoundSculpture.maxDetachmentDustSpark * 3);
    this.detachmentDustSparkVelocities = new Float32Array(SoundSculpture.maxDetachmentDustSpark * 3);
    this.detachmentDustSparkLife = new Float32Array(SoundSculpture.maxDetachmentDustSpark);
    this.detachmentDustSparkPositions.fill(999);
    this.detachmentDustSparkGeometry = new THREE.BufferGeometry();
    this.detachmentDustSparkGeometry.setAttribute("position", new THREE.BufferAttribute(this.detachmentDustSparkPositions, 3));
    this.detachmentDustSparkGeometry.setAttribute("color", new THREE.BufferAttribute(this.detachmentDustSparkColors, 3));
    this.detachmentDustSparkMaterial = new THREE.PointsMaterial({
      size: 0.034,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: detachmentMap,
    });
    this.detachmentDustSpark = new THREE.Points(this.detachmentDustSparkGeometry, this.detachmentDustSparkMaterial);

    this.group.add(
      this.core,
      this.innerCore,
      this.surface,
      this.particles,
      this.glowDust,
      this.sparkles,
      this.detachmentDustSand,
      this.detachmentDustMetal,
      this.detachmentDustSpark,
    );
    this.baseScale.copy(this.group.scale);

    this.basePositions = new Float32Array(this.geometry.attributes.position.array);
    this.baseSurfacePositions = new Float32Array(this.surfaceGeometry.attributes.position.array);
    this.targetCoreMeanRadius = this.meanRadialLength(this.basePositions);
    this.targetSurfaceMeanRadius = this.meanRadialLength(this.baseSurfacePositions);
    this.accumulated = new Float32Array(this.geometry.attributes.position.count);
    this.midBumps = new Float32Array(this.accumulated.length);
    this.highSpikes = new Float32Array(this.accumulated.length);
    this.erosionField = new Float32Array(this.accumulated.length);
    this.sculptureMemory = new Float32Array(this.accumulated.length);
    this.liveOffset = new Float32Array(this.accumulated.length);
    this.surfaceLiveOffset = new Float32Array(this.accumulated.length);
    this.vectorField = new Float32Array(this.accumulated.length * 3);
    this.flowField = new Float32Array(this.accumulated.length * 3);
    this.crystalAxes = new Float32Array(this.accumulated.length * 3);
    this.detachmentCarve = new Float32Array(this.accumulated.length);
    this.initCrystalAxes();
    this.initMorphology();

    if (this.granular) {
      this.initGrainMassDisplay(detachmentMap);
    }
  }

  private initGrainMassDisplay(pointTexture: THREE.Texture) {
    const vertexCount = this.geometry.attributes.position.count;
    this.grainMassPositions = new Float32Array(vertexCount * 3);
    this.grainMassColors = new Float32Array(vertexCount * 3);
    this.grainMassPositions.set(this.geometry.attributes.position.array as Float32Array);
    this.writeGrainMassColors();

    this.grainMassGeometry = new THREE.BufferGeometry();
    this.grainMassGeometry.setAttribute("position", new THREE.BufferAttribute(this.grainMassPositions, 3));
    this.grainMassGeometry.setAttribute("color", new THREE.BufferAttribute(this.grainMassColors, 3));
    this.grainMassMaterial = new THREE.PointsMaterial({
      size: 0.024,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.93,
      depthWrite: true,
      map: pointTexture,
    });
    this.grainMass = new THREE.Points(this.grainMassGeometry, this.grainMassMaterial);
    this.grainMass.frustumCulled = false;
    this.grainMass.castShadow = true;
    this.grainMass.receiveShadow = true;

    this.core.visible = false;
    this.innerCore.visible = false;
    this.core.castShadow = false;
    this.innerCore.castShadow = false;
    this.group.add(this.grainMass);
  }

  private writeGrainMassColors() {
    if (!this.grainMassColors || !this.grainMassPositions) {
      return;
    }

    const innerScale = this.innerCore.scale.x;
    const innerColor = new THREE.Color(CLAY_INNER_COLOR);
    for (let i = 0; i < this.grainMassColors.length / 3; i += 1) {
      const idx = i * 3;
      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const baseRadius = Math.hypot(bx, by, bz) / Math.max(0.001, this.targetCoreMeanRadius);
      const tone = 0.84 + seededUnit(i, 3.7) * 0.16;
      const innerMix = smoothstep(0.9, 0.45, baseRadius) * (1.1 - innerScale);
      this.scratchGrainColor.copy(this.coreMaterial.color).lerp(innerColor, innerMix * 0.5);
      this.grainMassColors[idx] = this.scratchGrainColor.r * tone;
      this.grainMassColors[idx + 1] = this.scratchGrainColor.g * tone;
      this.grainMassColors[idx + 2] = this.scratchGrainColor.b * tone;
    }
  }

  private syncGrainMassFromCore() {
    if (!this.granular || !this.grainMassPositions || !this.grainMassGeometry) {
      return;
    }

    this.grainMassPositions.set(this.geometry.attributes.position.array as Float32Array);
    this.grainMassGeometry.attributes.position.needsUpdate = true;
    this.writeGrainMassColors();
    this.grainMassGeometry.attributes.color.needsUpdate = true;
  }

  private makeCircleTexture() {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      const fallback = new THREE.Texture();
      fallback.needsUpdate = true;
      return fallback;
    }
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private initGlowDust() {
    for (let i = 0; i < SoundSculpture.maxGlowDust; i += 1) {
      const idx = i * 3;
      const u = seededUnit(i, 41.2);
      const v = seededUnit(i, 77.9);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      const nx = sinPhi * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = sinPhi * Math.sin(theta);
      const shell = 1.38 + seededUnit(i, 12.4) * 0.35;
      this.glowDustBaseDirs[idx] = nx;
      this.glowDustBaseDirs[idx + 1] = ny;
      this.glowDustBaseDirs[idx + 2] = nz;
      this.glowDustPositions[idx] = nx * shell;
      this.glowDustPositions[idx + 1] = ny * shell;
      this.glowDustPositions[idx + 2] = nz * shell;
      const tint = 0.35 + seededUnit(i, 3.1) * 0.65;
      this.glowDustColors[idx] = 0.42 * tint;
      this.glowDustColors[idx + 1] = 0.72 * tint;
      this.glowDustColors[idx + 2] = 1.0 * tint;
    }
  }

  private initMorphology() {
    this.morphologySeed = Math.random() * 1000;
    const theta = seededUnit(0, this.morphologySeed) * Math.PI * 2;
    const phi = Math.acos(2 * seededUnit(1, this.morphologySeed + 3.7) - 1);
    const sinPhi = Math.sin(phi);
    this.morphAxis.set(sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta));
    this.waistCenterAlong = (seededUnit(2, this.morphologySeed + 9.1) - 0.5) * 0.5;

    this.morphWeights = {
      diabolo: 0.14 + seededUnit(3, this.morphologySeed) * 0.28,
      torus: 0.14 + seededUnit(4, this.morphologySeed) * 0.28,
      monolith: 0.14 + seededUnit(5, this.morphologySeed) * 0.28,
      coral: 0.14 + seededUnit(6, this.morphologySeed) * 0.28,
      spindle: 0.14 + seededUnit(7, this.morphologySeed) * 0.28,
    };
    this.normalizeMorphWeights();
  }

  private normalizeMorphWeights() {
    const sum =
      this.morphWeights.diabolo +
      this.morphWeights.torus +
      this.morphWeights.monolith +
      this.morphWeights.coral +
      this.morphWeights.spindle;
    const inv = 1 / Math.max(0.0001, sum);
    this.morphWeights.diabolo *= inv;
    this.morphWeights.torus *= inv;
    this.morphWeights.monolith *= inv;
    this.morphWeights.coral *= inv;
    this.morphWeights.spindle *= inv;
  }

  private lerpMorphWeights(target: MorphWeights, t: number) {
    const w = this.morphWeights;
    w.diabolo += (target.diabolo - w.diabolo) * t;
    w.torus += (target.torus - w.torus) * t;
    w.monolith += (target.monolith - w.monolith) * t;
    w.coral += (target.coral - w.coral) * t;
    w.spindle += (target.spindle - w.spindle) * t;
    this.normalizeMorphWeights();
  }

  private getFormationScale() {
    const s = this.currentStructure;
    const phaseScale =
      s.phase === "embryo" ? 0.22 : s.phase === "growth" ? 0.62 : s.phase === "metamorphosis" ? 1 : 0.78;
    return Math.max(0.08, s.formationRamp * phaseScale);
  }

  private getDetailScale() {
    const s = this.currentStructure;
    const phaseDetail =
      s.phase === "embryo" ? 0.12 : s.phase === "growth" ? 0.55 : s.phase === "metamorphosis" ? 1 : 0.45;
    return Math.max(0.05, s.detailRamp * phaseDetail);
  }

  private getSpecies() {
    return this.speciesProfile;
  }

  private pickAnchorKindFromStructure(_bands: AudioBands): GrowthAnchorKind {
    const s = this.currentStructure;
    const sp = this.getSpecies();
    if (s.events.energyDrop || s.energyLong < 0.12) {
      return "erosion";
    }
    if (s.events.transientBurst || sp.aggressive > 0.55) {
      return "crystal";
    }
    if (sp.organic > 0.55) {
      return "tentacle";
    }
    if (s.events.energySurge && sp.aggressive > 0.45) {
      return sp.crystalGain > sp.tentacleGain ? "crystal" : "tentacle";
    }
    if (s.events.pulseStable) {
      return "lobe";
    }
    if (sp.aggressive > 0.5) {
      return "crystal";
    }
    if (sp.organic > 0.5) {
      return "tentacle";
    }
    return "lobe";
  }

  private trySpawnStructureAnchor(kind: GrowthAnchorKind, bands: AudioBands, cost = 1) {
    if (this.growthAnchors.length >= SoundSculpture.maxGrowthAnchors) {
      return false;
    }
    if (!structureTracker.consumeOrganBudget(cost)) {
      return false;
    }
    this.growthAnchors.push(this.makeAnchor(kind, bands));
    return true;
  }

  /** 音響に応じてモルフォロジーの比率と主軸をゆっくり更新する。 */
  private updateMorphology(bands: AudioBands, deltaTime: number) {
    const s = this.currentStructure;
    const sp = this.getSpecies();
    const lerp = sp.locked ? Math.min(1, deltaTime * 0.85) : Math.min(1, deltaTime * 0.45);
    const targetAxis = this.getAudioCarveAxis(0, bands);
    this.morphAxis.lerp(targetAxis, lerp * 0.18).normalize();

    const organic = sp.organic;
    const mineral = sp.aggressive;
    const rhythmic = sp.rhythmic;
    let targetWeights: MorphWeights;
    if (sp.locked) {
      const speciesTarget = speciesMorphTargets(sp);
      const bandBlend = fibUnit(3, 13);
      const overallBlend = bands.overall * bandBlend;
      targetWeights = {
        diabolo:
          speciesTarget.diabolo * (1 - bandBlend) +
          (fibUnit(3, 21) + overallBlend * fibUnit(5, 21)) * bandBlend,
        torus:
          speciesTarget.torus * (1 - bandBlend) +
          (fibUnit(2, 21) + overallBlend * fibUnit(5, 21)) * bandBlend,
        monolith:
          speciesTarget.monolith * (1 - bandBlend) +
          (fibUnit(5, 21) + overallBlend * fibUnit(8, 21)) * bandBlend,
        coral:
          speciesTarget.coral * (1 - bandBlend) +
          (fibUnit(5, 21) + bands.contrast * fibUnit(5, 21)) * bandBlend,
        spindle:
          speciesTarget.spindle * (1 - bandBlend) +
          (fibUnit(3, 21) + bands.brightness * fibUnit(8, 21)) * bandBlend,
      };
    } else {
      const overallBlend = bands.overall;
      targetWeights = {
        diabolo: fibUnit(3, 21) + overallBlend * fibUnit(5, 21) + organic * fibUnit(8, 21),
        torus: fibUnit(2, 21) + overallBlend * fibUnit(5, 21) + mineral * fibUnit(5, 21) + rhythmic * fibUnit(8, 21),
        monolith: fibUnit(5, 21) + overallBlend * fibUnit(8, 21) + mineral * fibUnit(8, 21),
        coral: fibUnit(5, 21) + organic * fibUnit(13, 21) + bands.contrast * fibUnit(5, 21),
        spindle: fibUnit(3, 21) + bands.brightness * fibUnit(8, 21) + mineral * fibUnit(8, 21) + s.tension * fibUnit(5, 21),
      };
    }
    const targetSum =
      targetWeights.diabolo +
      targetWeights.torus +
      targetWeights.monolith +
      targetWeights.coral +
      targetWeights.spindle;
    const inv = 1 / Math.max(0.0001, targetSum);
    targetWeights.diabolo *= inv;
    targetWeights.torus *= inv;
    targetWeights.monolith *= inv;
    targetWeights.coral *= inv;
    targetWeights.spindle *= inv;

    this.lerpMorphWeights(targetWeights, lerp);
    this.waistCenterAlong += (bands.centroid - 0.5) * deltaTime * 0.35;
    this.waistCenterAlong = Math.min(0.55, Math.max(-0.55, this.waistCenterAlong));
  }

  private meanRadialLength(positions: Float32Array) {
    const vertexCount = positions.length / 3;
    let sum = 0;
    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      sum += Math.hypot(positions[index], positions[index + 1], positions[index + 2]);
    }
    return sum / Math.max(1, vertexCount);
  }

  /**
   * 変形後の平均半径を初期値に戻し、全体の膨張を抑える。
   * 突起の最大半径だけは maxSpreadRatio まで許容する (広がり・触手など)。
   */
  private constrainEnvelope(
    positions: Float32Array,
    targetMeanRadius: number,
    maxSpreadRatio = 1.3,
  ) {
    const vertexCount = positions.length / 3;
    let sumRadius = 0;
    let maxRadius = 0;

    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      const radius = Math.hypot(positions[index], positions[index + 1], positions[index + 2]);
      sumRadius += radius;
      maxRadius = Math.max(maxRadius, radius);
    }

    const meanRadius = sumRadius / Math.max(1, vertexCount);
    if (meanRadius < 0.0001) {
      return;
    }

    let scale = 1;
    if (meanRadius > targetMeanRadius * 1.004) {
      scale = targetMeanRadius / meanRadius;
    }

    const scaledMax = maxRadius * scale;
    const maxAllowed = targetMeanRadius * maxSpreadRatio;
    if (scaledMax > maxAllowed) {
      scale *= maxAllowed / scaledMax;
    }

    if (Math.abs(scale - 1) < 0.0004) {
      return;
    }

    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      positions[index] *= scale;
      positions[index + 1] *= scale;
      positions[index + 2] *= scale;
    }
  }

  private initCrystalAxes() {
    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      const u = seededUnit(i, 1.71);
      const v = seededUnit(i, 5.37);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      this.crystalAxes[idx] = sinPhi * Math.cos(theta);
      this.crystalAxes[idx + 1] = Math.cos(phi);
      this.crystalAxes[idx + 2] = sinPhi * Math.sin(theta);
    }
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    userViewInteracting = false,
    _rhythm?: RhythmEvents,
    structure: StructureSnapshot = latestStructure,
    species: SpeciesProfile = speciesProfiler.getProfile(),
  ) {
    this.lastBands = bands;
    this.currentStructure = structure;
    this.speciesProfile = species;
    const activity = this.completed ? 0 : smoothstep(SILENCE_THRESHOLD, 0.22, bands.overall);
    const timeAdvance = this.completed ? 0 : deltaTime * activity;
    if (!this.completed) {
      this.formingTime += timeAdvance;
    }

    if (!this.completed) {
      if (bands.overall > SILENCE_THRESHOLD) {
        this.activeFormingTime += deltaTime;
      }

      this.spectralPhase +=
        deltaTime * activity * (0.12 + bands.centroid * 1.6 + bands.brightness * 0.9 + bands.melody * 1.2);
      this.carvingPhase += deltaTime * activity * (0.1 + bands.overall * 1.2 + bands.contrast * 1.2);
      this.updateMorphology(bands, deltaTime);
      this.accumulateBassPressure(bands, deltaTime);
      this.bleedLiveIntoSculpture(bands, deltaTime);
      this.maybeSpawnAnchors(bands, deltaTime);
      this.applyGrowthAnchors(deltaTime);
      this.updateCurlFlow(bands, deltaTime);
      this.updateErosion(bands, deltaTime);
      this.updateGlobalForm(bands, deltaTime);
      this.updateCoreMaterial(bands, deltaTime);
    }

    if (!this.completed) {
      this.syncSculptureMemory(deltaTime);
    }

    this.updateCoreGeometry(bands, deltaTime);
    this.updateSurfaceGeometry(bands, deltaTime);
    if (this.granular) {
      this.syncGrainMassFromCore();
    }
    if (!this.completed) {
      this.maybeSpawnDetachedFragment(bands, deltaTime);
      this.updateSeparationTendency(bands, deltaTime);
    }
    this.updateDetachedFragments(bands, deltaTime);
    this.updateDetachmentDust(bands, deltaTime);
    this.updateGlowDust(bands, deltaTime);
    this.updateSparkles(bands, deltaTime);
    this.updateParticles(bands, deltaTime);

    const innerBase = 1;
    const pulseFloor = runtimeTuning.pulseConfidenceFloor;
    const syncPulse =
      latestRhythm.pulseEnvelope * (pulseFloor + latestRhythm.pulseConfidence * (1 - pulseFloor));
    const kickPulse = this.completed ? 0 : 1 + Math.max(this.kickImpulse, syncPulse) * fibUnit(8, 13) * runtimeTuning.liveLow;
    this.innerCore.scale.setScalar(innerBase * kickPulse);

    if (!userViewInteracting && !this.completed) {
      const pulseGate = latestRhythm.pulseConfidence;
      const targetSpin = (0.04 + bands.mid * 0.015 + bands.melody * 0.04) * activity * pulseGate;
      this.group.rotation.y += deltaTime * targetSpin;
      this.group.rotation.x = Math.sin(this.formingTime * 0.18) * 0.035 * activity * pulseGate;
    }

    if (!this.completed) {
      this.applyRhythmImpulses(deltaTime, bands);
    } else if (bandSoloAllows("low")) {
      this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * 12));
    }
  }

  /** イベントを「必ず」見せるための直結トリガ。 */
  private applyRhythmImpulses(deltaTime: number, bands: AudioBands) {
    this.kickImpulse *= Math.exp(-7.2 * deltaTime);
    this.snareImpulse *= Math.exp(-8 * deltaTime);
    this.hatImpulse *= Math.exp(-13 * deltaTime);
    this.waveImpulse *= Math.exp(-10 * deltaTime);

    const r = latestRhythm;
    const s = this.currentStructure;

    if (r.kickIndex !== this.lastKickIndexApplied) {
      this.lastKickIndexApplied = r.kickIndex;
      if (r.kick > 0) {
        this.kickImpulse = Math.min(1, this.kickImpulse + r.kick * 5.5);
        if (s.phase !== "embryo" && r.kick > 0.08) {
          this.trySpawnStructureAnchor("lobe", bands, 0.85);
        }
      }
    }

    if (r.snareIndex !== this.lastSnareIndexApplied) {
      this.lastSnareIndexApplied = r.snareIndex;
      if (r.snare > 0) {
        this.snareImpulse = Math.min(1, this.snareImpulse + r.snare * 3.6);
        this.fragmentSpawnCooldown = 0;
        this.separationTendency = Math.min(1, this.separationTendency + 0.18 + r.snare * 0.45);
        if (s.tension > 0.35) {
          this.trySpawnStructureAnchor(this.pickAnchorKindFromStructure(bands), bands, 1.1);
        }
      }
    }

    if (r.hatIndex !== this.lastHatIndexApplied) {
      this.lastHatIndexApplied = r.hatIndex;
      if (r.hat > 0 && s.detailRamp > 0.35) {
        this.hatImpulse = Math.min(1, this.hatImpulse + r.hat * 5.5);
        const burst = Math.min(8, 2 + Math.floor(r.hat * 12 * s.detailRamp));
        for (let i = 0; i < burst; i += 1) {
          this.spawnSparkle({
            ...bands,
            high: Math.min(1, bands.high + 0.35),
            brightness: Math.min(1, bands.brightness + 0.28),
          });
        }
      }
    }

    if (r.transientIndex !== this.lastTransientIndexApplied) {
      this.lastTransientIndexApplied = r.transientIndex;
      if (r.transient > 0 && s.detailRamp > fibUnit(8, 21)) {
        this.waveImpulse = Math.min(1, this.waveImpulse + r.transient * fibRatio(8, 3));
        this.hatImpulse = Math.min(1, this.hatImpulse + r.transient * fibRatio(5, 3));
        if (s.mineralScore > fibUnit(8, 21)) {
          this.trySpawnStructureAnchor("crystal", bands, fibUnit(8, 13));
        }
      }
    }

    if (r.pulseIndex !== this.lastPulseIndexApplied) {
      this.lastPulseIndexApplied = r.pulseIndex;
      this.kickImpulse = Math.min(1, this.kickImpulse + fibUnit(8, 13));
    }

    // 離散パルス型の呼吸 — 連続 low 成分は使わない
    if (bandSoloAllows("low")) {
      const t = runtimeTuning;
      const pulseFloor = t.pulseConfidenceFloor;
      const pulseSync =
        latestRhythm.pulseEnvelope * (pulseFloor + latestRhythm.pulseConfidence * (1 - pulseFloor));
      const kickBoost = this.kickImpulse;
      const transientBoost =
        Math.max(r.transient, this.waveImpulse * fibUnit(5, 8)) *
        fibUnit(8, 13) *
        (fibUnit(5, 8) + this.getSpecies().aggressive * fibUnit(8, 13));
      const rhythmSqueeze = (pulseSync + kickBoost * fibUnit(8, 13) + transientBoost) * t.liveLow * t.pulseSqueeze;
      if (rhythmSqueeze > fibUnit(2, 21)) {
        const k = rhythmSqueeze;
        const targetXz = 1 + k * fibUnit(8, 21);
        const targetY = 1 - k * fibUnit(5, 21);
        const follow = Math.min(1, deltaTime * fib(8));
        this.group.scale.x += (this.baseScale.x * targetXz - this.group.scale.x) * follow;
        this.group.scale.z += (this.baseScale.z * targetXz - this.group.scale.z) * follow;
        this.group.scale.y += (this.baseScale.y * targetY - this.group.scale.y) * follow;
      } else if (getBandSoloMode() !== "low") {
        this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * fib(5)));
      }
    } else {
      this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * 7));
    }

    const hatFlash = Math.max(this.hatImpulse, this.waveImpulse * 0.75);
    if (bandSoloAllows("high") && hatFlash > 0.0001 && s.detailRamp > 0.3) {
      const h = hatFlash;
      this.sparkleMaterial.size = 0.052 + h * 0.08;
      this.sparkleMaterial.opacity = Math.min(1, this.sparkleMaterial.opacity + h * 0.1);
      this.glowDustMaterial.size = 0.014 + bands.high * 0.008 + h * 0.012;
      this.glowDustMaterial.opacity = Math.min(1, this.glowDustMaterial.opacity + h * 0.08);
    }

    const shake = Math.max(this.hatImpulse, this.waveImpulse * 0.5) * s.detailRamp;
    if (
      shake > 0.001 &&
      s.phase === "metamorphosis" &&
      latestRhythm.pulseConfidence > 0.45
    ) {
      const amount = shake * deltaTime * 0.1;
      const salt = this.formingTime * 3.2 + this.morphologySeed;
      for (let i = 0; i < this.accumulated.length; i += 1) {
        const idx = i * 3;
        const bx = this.basePositions[idx];
        const by = this.basePositions[idx + 1];
        const bz = this.basePositions[idx + 2];
        curlNoiseSample(bx * 2.8, by * 2.8, bz * 2.8, salt, this._curlOut);
        this.flowField[idx] += this._curlOut.x * amount;
        this.flowField[idx + 1] += this._curlOut.y * amount;
        this.flowField[idx + 2] += this._curlOut.z * amount;
      }
    }
  }

  complete() {
    this.bakeFinalSculptureMemory();
    this.frozenTime = this.formingTime;
    this.completeFadeOut = 1;
    this.completed = true;
    this.liveOffset.fill(0);
    this.surfaceLiveOffset.fill(0);
    this.flowField.fill(0);
  }

  /** 完了時: LIVE で見えていた変位を永久形状に焼き込む */
  private bakeFinalSculptureMemory() {
    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const vfScalar = this.getVectorNormalDisplacement(i, nx, ny, nz);
      const t = runtimeTuning;
      const liveBake =
        this.liveOffset[i] * t.liveLow * 0.58 +
        this.surfaceLiveOffset[i] * t.liveMid * 0.68;
      this.sculptureMemory[i] =
        this.accumulated[i] +
        this.midBumps[i] +
        this.highSpikes[i] +
        liveBake +
        vfScalar * 0.92 +
        this.erosionField[i];
    }
    this.liveOffset.fill(0);
    this.surfaceLiveOffset.fill(0);
  }

  /** 形状・粒子・分裂体を初期化（音入力は維持）。 */
  reset() {
    this.completed = false;
    this.frozenTime = 0;
    this.completeFadeOut = 1;
    this.currentStructure = defaultStructureSnapshot();
    this.speciesProfile = { ...DEFAULT_SPECIES_PROFILE };
    this.lastNoveltySpawn = 0;
    this.formingTime = 0;
    this.activeFormingTime = 0;
    this.spectralPhase = 0;
    this.carvingPhase = 0;
    this.formStretch = 0;
    this.formWaist = 0;
    this.formTwist = 0;
    this.formBendX = 0;
    this.formBendZ = 0;
    this.formAsymmetry = 0;
    this.formBaseWeight = 0;
    this.waistCenterAlong = 0;
    this.particleCursor = 0;
    this.particleEmission = 0;
    this.sparkleEmission = 0;
    this.sparkleCursorIndex = 0;
    this.separationTendency = 0;
    this.spectralShift = 0;
    this.fragmentSpawnCooldown = 0;
    this.anchorSpawnCooldown = 0;
    this.lastKickIndexApplied = -1;
    this.lastSnareIndexApplied = -1;
    this.lastHatIndexApplied = -1;
    this.lastTransientIndexApplied = -1;
    this.lastPulseIndexApplied = -1;
    this.kickImpulse = 0;
    this.snareImpulse = 0;
    this.hatImpulse = 0;
    this.waveImpulse = 0;
    this.previousBandsForSeparation = null;

    this.accumulated.fill(0);
    this.midBumps.fill(0);
    this.highSpikes.fill(0);
    this.erosionField.fill(0);
    this.sculptureMemory.fill(0);
    this.liveOffset.fill(0);
    this.surfaceLiveOffset.fill(0);
    this.vectorField.fill(0);
    this.flowField.fill(0);
    this.detachmentCarve.fill(0);

    this.growthAnchors.length = 0;

    this.particleActive.fill(0);
    this.particleStuck.fill(0);
    this.particleProgress.fill(0);
    this.particlePositions.fill(999);
    this.sparkleLife.fill(0);
    this.sparklePositions.fill(999);
    this.detachmentDustSandLife.fill(0);
    this.detachmentDustSandPositions.fill(999);
    this.detachmentDustSandVelocities.fill(0);
    this.detachmentDustSandCursor = 0;
    this.detachmentDustMetalLife.fill(0);
    this.detachmentDustMetalPositions.fill(999);
    this.detachmentDustMetalVelocities.fill(0);
    this.detachmentDustMetalCursor = 0;
    this.detachmentDustSparkLife.fill(0);
    this.detachmentDustSparkPositions.fill(999);
    this.detachmentDustSparkVelocities.fill(0);
    this.detachmentDustSparkCursor = 0;

    this.group.rotation.set(0, 0, 0);
    this.group.scale.copy(this.baseScale);
    this.innerCore.scale.setScalar(1);

    this.initMorphology();

    const corePos = this.geometry.attributes.position.array as Float32Array;
    corePos.set(this.basePositions);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();

    const surfPos = this.surfaceGeometry.attributes.position.array as Float32Array;
    surfPos.set(this.baseSurfacePositions);
    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();

    this.coreMaterial.color.set(CLAY_CORE_COLOR);
    this.coreMaterial.roughness = 0.94;
    this.coreMaterial.emissive.set(0x000000);
    this.coreMaterial.emissiveIntensity = 0;

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uCompleted.value = 0;
    uniforms.uLive.value = 0;
    uniforms.uMelody.value = 0;
    uniforms.uGlow.value = 0;
    uniforms.uOpacity.value = 0.22;

    if (this.granular) {
      this.syncGrainMassFromCore();
    }
  }

  private emitDetachmentDust(
    kind: "sand" | "metal" | "spark",
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    strength: number,
  ) {
    const burstCount =
      kind === "spark"
        ? Math.min(220, Math.floor(60 + strength * 340))
        : kind === "metal"
          ? Math.min(160, Math.floor(40 + strength * 220))
          : Math.min(180, Math.floor(50 + strength * 240));
    const tangent = new THREE.Vector3();
    const bitangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    buildFragmentBasis(dir, tangent, bitangent, normal);

    const positions =
      kind === "spark" ? this.detachmentDustSparkPositions : kind === "metal" ? this.detachmentDustMetalPositions : this.detachmentDustSandPositions;
    const colors =
      kind === "spark" ? this.detachmentDustSparkColors : kind === "metal" ? this.detachmentDustMetalColors : this.detachmentDustSandColors;
    const velocities =
      kind === "spark" ? this.detachmentDustSparkVelocities : kind === "metal" ? this.detachmentDustMetalVelocities : this.detachmentDustSandVelocities;
    const life =
      kind === "spark" ? this.detachmentDustSparkLife : kind === "metal" ? this.detachmentDustMetalLife : this.detachmentDustSandLife;
    const max =
      kind === "spark" ? SoundSculpture.maxDetachmentDustSpark : kind === "metal" ? SoundSculpture.maxDetachmentDustMetal : SoundSculpture.maxDetachmentDustSand;

    for (let i = 0; i < burstCount; i += 1) {
      const index =
        kind === "spark"
          ? this.detachmentDustSparkCursor
          : kind === "metal"
            ? this.detachmentDustMetalCursor
            : this.detachmentDustSandCursor;
      if (kind === "spark") this.detachmentDustSparkCursor = (this.detachmentDustSparkCursor + 1) % max;
      else if (kind === "metal") this.detachmentDustMetalCursor = (this.detachmentDustMetalCursor + 1) % max;
      else this.detachmentDustSandCursor = (this.detachmentDustSandCursor + 1) % max;
      const idx = index * 3;

      const a = seededUnit(index, this.formingTime + i * 0.17) * Math.PI * 2;
      const r = (seededUnit(index, this.formingTime + 9.1) ** 0.55) * (0.18 + strength * 0.35);
      const jitter = seededUnit(index, this.formingTime + 18.7) * 0.08;
      const px = origin.x + tangent.x * Math.cos(a) * r + bitangent.x * Math.sin(a) * r + normal.x * jitter;
      const py = origin.y + tangent.y * Math.cos(a) * r + bitangent.y * Math.sin(a) * r + normal.y * jitter;
      const pz = origin.z + tangent.z * Math.cos(a) * r + bitangent.z * Math.sin(a) * r + normal.z * jitter;
      positions[idx] = px;
      positions[idx + 1] = py;
      positions[idx + 2] = pz;

      // outward + lateral spray
      const baseSpeed = kind === "spark" ? 1.15 : kind === "metal" ? 0.85 : 0.55;
      const speed = (baseSpeed + strength * (kind === "spark" ? 2.0 : 1.2)) * (0.6 + seededUnit(index, 2.2) * 0.7);
      velocities[idx] =
        normal.x * speed + tangent.x * (Math.cos(a) * 0.22 + (seededUnit(index, 7.7) - 0.5) * 0.18);
      velocities[idx + 1] =
        normal.y * speed + bitangent.y * (Math.sin(a) * 0.22 + (seededUnit(index, 9.7) - 0.5) * 0.18);
      velocities[idx + 2] =
        normal.z * speed + bitangent.z * (Math.sin(a) * 0.22 + (seededUnit(index, 11.7) - 0.5) * 0.18);

      life[index] = 1;
      const tint = 0.55 + seededUnit(index, 3.3) * 0.45;
      if (kind === "sand") {
        colors[idx] = 0.22 * tint;
        colors[idx + 1] = 0.58 * tint;
        colors[idx + 2] = 0.95 * tint;
      } else if (kind === "metal") {
        colors[idx] = 0.5 * tint;
        colors[idx + 1] = 0.86 * tint;
        colors[idx + 2] = 1.0 * tint;
      } else {
        colors[idx] = 0.62 * tint;
        colors[idx + 1] = 0.95 * tint;
        colors[idx + 2] = 1.0 * tint;
      }
    }

    const geometry =
      kind === "spark" ? this.detachmentDustSparkGeometry : kind === "metal" ? this.detachmentDustMetalGeometry : this.detachmentDustSandGeometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  private updateDetachmentDustKind(
    kind: "sand" | "metal" | "spark",
    bands: AudioBands,
    deltaTime: number,
  ) {
    const positions =
      kind === "spark" ? this.detachmentDustSparkPositions : kind === "metal" ? this.detachmentDustMetalPositions : this.detachmentDustSandPositions;
    const colors =
      kind === "spark" ? this.detachmentDustSparkColors : kind === "metal" ? this.detachmentDustMetalColors : this.detachmentDustSandColors;
    const velocities =
      kind === "spark" ? this.detachmentDustSparkVelocities : kind === "metal" ? this.detachmentDustMetalVelocities : this.detachmentDustSandVelocities;
    const life =
      kind === "spark" ? this.detachmentDustSparkLife : kind === "metal" ? this.detachmentDustMetalLife : this.detachmentDustSandLife;
    const max =
      kind === "spark" ? SoundSculpture.maxDetachmentDustSpark : kind === "metal" ? SoundSculpture.maxDetachmentDustMetal : SoundSculpture.maxDetachmentDustSand;
    const geometry =
      kind === "spark" ? this.detachmentDustSparkGeometry : kind === "metal" ? this.detachmentDustMetalGeometry : this.detachmentDustSandGeometry;
    const material =
      kind === "spark" ? this.detachmentDustSparkMaterial : kind === "metal" ? this.detachmentDustMetalMaterial : this.detachmentDustSandMaterial;

    const curlScale = kind === "spark" ? 1.25 : kind === "metal" ? 0.95 : 0.75;
    const curlStrengthBase = kind === "spark" ? 0.0068 : kind === "metal" ? 0.0046 : 0.0028;
    const curlStrength =
      (this.completed ? 0.001 : curlStrengthBase + bands.mid * 0.004 + bands.high * 0.003) *
      (0.6 + this.separationTendency * 0.6);
    const damping = Math.exp(-(kind === "spark" ? 2.8 : kind === "metal" ? 2.1 : 1.4) * deltaTime);
    const decay = kind === "spark" ? 1.35 : kind === "metal" ? 0.9 : 0.6;
    const drift = this.formingTime * 0.18;

    for (let i = 0; i < max; i += 1) {
      const l = life[i];
      if (l <= 0) continue;
      const nextLife = Math.max(0, l - deltaTime * (this.completed ? decay * 0.4 : decay));
      life[i] = nextLife;
      const idx = i * 3;

      if (nextLife <= 0) {
        positions[idx] = 999;
        positions[idx + 1] = 999;
        positions[idx + 2] = 999;
        continue;
      }

      const px = positions[idx];
      const py = positions[idx + 1];
      const pz = positions[idx + 2];

      curlNoiseSample(px * curlScale, py * curlScale, pz * curlScale, this.morphologySeed + drift, this._curlOut);
      const vx = (velocities[idx] + this._curlOut.x * curlStrength) * damping;
      const vy = (velocities[idx + 1] + this._curlOut.y * curlStrength) * damping;
      const vz = (velocities[idx + 2] + this._curlOut.z * curlStrength) * damping;
      velocities[idx] = vx;
      velocities[idx + 1] = vy;
      velocities[idx + 2] = vz;

      positions[idx] = px + vx * deltaTime;
      positions[idx + 1] = py + vy * deltaTime;
      positions[idx + 2] = pz + vz * deltaTime;

      const fade = nextLife * nextLife;
      colors[idx] *= 0.985;
      colors[idx + 1] *= 0.985;
      colors[idx + 2] *= 0.985;
      colors[idx] *= 0.9 + fade * 0.1;
      colors[idx + 1] *= 0.9 + fade * 0.1;
      colors[idx + 2] *= 0.9 + fade * 0.1;
    }

    material.opacity =
      kind === "spark"
        ? (this.completed ? 0.4 : 0.7 + bands.high * 0.2)
        : kind === "metal"
          ? (this.completed ? 0.45 : 0.65 + bands.mid * 0.18)
          : (this.completed ? 0.5 : 0.6 + bands.sub * 0.18);
    material.size =
      kind === "spark"
        ? 0.03 + bands.high * 0.022
        : kind === "metal"
          ? 0.02 + bands.mid * 0.014
          : 0.024 + bands.sub * 0.016;

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  private updateDetachmentDust(bands: AudioBands, deltaTime: number) {
    this.updateDetachmentDustKind("sand", bands, deltaTime);
    this.updateDetachmentDustKind("metal", bands, deltaTime);
    this.updateDetachmentDustKind("spark", bands, deltaTime);
  }

  createExportGroup() {
    const exportGroup = new THREE.Group();
    exportGroup.name = "Sound Sculpture";
    exportGroup.rotation.copy(this.group.rotation);

    const core = new THREE.Mesh(
      this.geometry.clone(),
      new THREE.MeshStandardMaterial({
        name: "Accumulated core",
        color: this.coreMaterial.color.clone(),
        emissive: this.coreMaterial.emissive.clone(),
        emissiveIntensity: this.coreMaterial.emissiveIntensity,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    core.name = "Sculpture core";

    const innerCore = new THREE.Mesh(
      this.geometry.clone(),
      new THREE.MeshStandardMaterial({
        name: "Inner mass",
        color: this.innerCoreMaterial.color.clone(),
        emissive: this.innerCoreMaterial.emissive.clone(),
        emissiveIntensity: this.innerCoreMaterial.emissiveIntensity,
        roughness: 0.96,
        metalness: 0,
      }),
    );
    innerCore.scale.setScalar(0.92);
    innerCore.name = "Inner mass";

    const surface = new THREE.Mesh(
      this.surfaceGeometry.clone(),
      new THREE.MeshStandardMaterial({
        name: "Frozen digital surface",
        color: 0x92b8e8,
        emissive: 0x1e5eff,
        emissiveIntensity: 0.12,
        roughness: 0.34,
        metalness: 0.04,
        transparent: true,
        opacity: 0.32,
      }),
    );
    surface.name = "Digital surface";

    if (this.granular && this.grainMassGeometry && this.grainMassMaterial) {
      const grainGeometry = this.grainMassGeometry.clone();
      grainGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute((this.grainMassPositions ?? this.geometry.attributes.position.array).slice(), 3),
      );
      if (this.grainMassColors) {
        grainGeometry.setAttribute("color", new THREE.BufferAttribute(this.grainMassColors.slice(), 3));
      }
      const grains = new THREE.Points(
        grainGeometry,
        new THREE.PointsMaterial({
          name: "Grain mass",
          size: this.grainMassMaterial.size,
          vertexColors: true,
          transparent: true,
          opacity: this.grainMassMaterial.opacity,
        }),
      );
      grains.name = "Sculpture core (grains)";
      exportGroup.add(grains, surface);
    } else {
      exportGroup.add(core, innerCore, surface);
    }

    const particleCount = this.particleActive.reduce((count, isActive) => count + isActive, 0);

    if (particleCount > 0) {
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      let writeIndex = 0;

      for (let i = 0; i < SoundSculpture.maxParticles; i += 1) {
        if (this.particleActive[i] === 0) {
          continue;
        }

        const readIndex = i * 3;
        const positionIndex = writeIndex * 3;
        positions[positionIndex] = this.particlePositions[readIndex];
        positions[positionIndex + 1] = this.particlePositions[readIndex + 1];
        positions[positionIndex + 2] = this.particlePositions[readIndex + 2];
        colors[positionIndex] = this.particleColors[readIndex];
        colors[positionIndex + 1] = this.particleColors[readIndex + 1];
        colors[positionIndex + 2] = this.particleColors[readIndex + 2];
        writeIndex += 1;
      }

      const particleGeometry = new THREE.BufferGeometry();
      particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
          name: "Fixed high-frequency deposits",
          size: 0.028,
          vertexColors: true,
          transparent: true,
          opacity: 0.72,
        }),
      );
      particles.name = "High frequency deposits";
      exportGroup.add(particles);
    }

    return exportGroup;
  }

  private updateCoreMaterial(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const shift = t.coreColorShift;
    const hue =
      0.09 + bands.mid * 0.08 * shift + bands.melody * t.coreColorShift + bands.brightness * 0.48 * shift;
    const saturation = 0.18 + bands.contrast * 0.34 * shift + bands.high * 0.16 * shift;
    const lightness = 0.78 + bands.brightness * 0.1 * shift;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift, 0.72, 0.18);

    const colorLerp = Math.min(1, deltaTime * (1.8 + bands.overall * 5));
    this.coreMaterial.color.lerp(this.targetCoreColor, colorLerp);
    this.coreMaterial.emissive.lerp(this.targetCoreEmissive, colorLerp);
    const sp = this.getSpecies();
    const targetEmissive =
      (bands.overall * fibUnit(5, 21) + bands.brightness * fibUnit(3, 21) + bands.contrast * t.coreEmissive * fibUnit(3, 21)) *
      (t.coreEmissive / fibUnit(3, 21)) *
      (fibUnit(5, 8) + sp.aggressive * fibUnit(8, 13));
    this.coreMaterial.emissiveIntensity +=
      (targetEmissive - this.coreMaterial.emissiveIntensity) * Math.min(1, deltaTime * fib(3));
    const baseRoughness =
      fibRatio(11, 12) +
      fibUnit(5, 21) -
      bands.brightness * fibUnit(5, 21) * shift -
      bands.high * fibUnit(3, 21) * shift;
    this.coreMaterial.roughness =
      baseRoughness + sp.aggressive * fibUnit(5, 21) - sp.organic * fibUnit(5, 21);
  }

  private getBandLiveWeights(bands: AudioBands): BandLiveWeights {
    return computeBandLiveWeights(bands, getBandSoloMode());
  }

  private getMembraneLiveTarget(bands: AudioBands) {
    const t = runtimeTuning;
    const w = this.getBandLiveWeights(bands);
    if (this.completed) {
      return 0;
    }
    return (
      w.high * t.liveHigh * fibRatio(8, 5) +
      this.getSpecies().membraneGain * fibUnit(5, 13) +
      (this.hatImpulse * fibUnit(8, 13) + this.waveImpulse * fibUnit(5, 13)) * t.liveHigh
    );
  }

  private getMembraneGlowTarget(bands: AudioBands) {
    const t = runtimeTuning;
    return (
      (this.completed ? 0.35 : 0.2) +
      bands.overall * t.liveHigh * 1.1 +
      this.separationTendency * 0.25 +
      (this.hatImpulse * 0.5 + this.waveImpulse * 0.28) * t.liveHigh
    );
  }

  applyLiveTuningNow() {
    const bands = this.lastBands;
    if (!bands) {
      return;
    }

    const t = runtimeTuning;
    const shift = t.coreColorShift;
    const hue =
      0.09 + bands.mid * 0.08 * shift + bands.melody * t.coreColorShift + bands.brightness * 0.48 * shift;
    const saturation = 0.18 + bands.contrast * 0.34 * shift + bands.high * 0.16 * shift;
    const lightness = 0.78 + bands.brightness * 0.1 * shift;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift, 0.72, 0.18);
    this.coreMaterial.color.copy(this.targetCoreColor);
    this.coreMaterial.emissive.copy(this.targetCoreEmissive);
    this.coreMaterial.emissiveIntensity =
      (bands.overall * 0.22 + bands.brightness * 0.12 + bands.contrast * t.coreEmissive * 0.1) *
      (t.coreEmissive / 0.1);
    this.coreMaterial.roughness = 0.86 - bands.brightness * 0.18 * shift - bands.high * 0.08 * shift;

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uMelodyLine.value = t.membraneLine;
    uniforms.uMelodyFresnel.value = t.membraneFresnel;
    uniforms.uMelodyNoise.value = t.membraneNoise;
    uniforms.uMelodyFlowAnim.value = 1.2 + t.liveHigh * 1.4;
    uniforms.uLive.value = this.getMembraneLiveTarget(bands);
    uniforms.uGlow.value = this.getMembraneGlowTarget(bands);

    const r = latestRhythm;
    const pulseFloor = t.pulseConfidenceFloor;
    const pulseSync = r.pulseEnvelope * (pulseFloor + r.pulseConfidence * (1 - pulseFloor));
    const impulsePart =
      (this.kickImpulse + pulseSync * fibUnit(8, 13) + r.transient * fibUnit(5, 21)) *
      t.liveLow *
      fibUnit(8, 21) *
      t.pulseSqueeze;
    const squeeze = impulsePart;
    if (squeeze > fibUnit(2, 21)) {
      this.group.scale.set(
        this.baseScale.x * (1 + squeeze * fibUnit(8, 21)),
        this.baseScale.y * (1 - squeeze * fibUnit(5, 21)),
        this.baseScale.z * (1 + squeeze * fibUnit(8, 21)),
      );
    }

    this.updateCoreGeometry(bands, 0.033);
    this.updateSurfaceGeometry(bands, 0.033);
  }

  private accumulateWithMemory(
    current: number,
    delta: number,
    min: number,
    max: number,
  ) {
    const formation = this.getFormationScale();
    const maxStep =
      (runtimeTuning.accumMaxStepBase + runtimeTuning.accumMaxStepScale * formation) * formation;
    const cappedDelta = Math.max(-maxStep, Math.min(maxStep, delta));
    const next = current + cappedDelta;
    return Math.min(max, Math.max(min, next));
  }

  private updateGlobalForm(bands: AudioBands, deltaTime: number) {
    const formation = this.getFormationScale();
    const energy =
      Math.max(0, bands.overall - 0.02) *
      deltaTime *
      runtimeTuning.globalFormEnergyScale *
      formation;
    const w = this.morphWeights;

    this.formStretch = Math.min(
      0.42,
      this.formStretch +
        energy * (0.1 + bands.overall * 0.22) * runtimeTuning.formStretchRate,
    );
    this.formWaist = Math.min(
      0.58,
      this.formWaist +
        energy *
          (0.12 + bands.contrast * 0.32 + bands.overall * 0.18) *
          (0.25 + w.diabolo * 0.75),
    );
    this.formTwist = Math.min(
      0.65,
      this.formTwist +
        energy *
          (0.12 + bands.overall * 0.26 + bands.contrast * 0.18) *
          runtimeTuning.formTwistAccumRate,
    );
    this.formBaseWeight = Math.min(
      0.34,
      this.formBaseWeight + energy * (0.12 + bands.overall * 0.3),
    );

    const bendDirection = Math.sin(this.spectralPhase * 0.9 + bands.centroid * 8);
    const bendCrossDirection = Math.cos(this.carvingPhase * 0.7 + bands.contrast * 6);
    this.formBendX = Math.min(
      0.58,
      Math.max(-0.58, this.formBendX + energy * bendDirection * (0.12 + bands.overall * 0.35)),
    );
    this.formBendZ = Math.min(
      0.48,
      Math.max(-0.48, this.formBendZ + energy * bendCrossDirection * (0.12 + bands.overall * 0.28)),
    );
    this.formAsymmetry = Math.min(
      0.46,
      Math.max(
        -0.46,
        this.formAsymmetry +
          energy *
            Math.sin(this.carvingPhase + bands.brightness * 10) *
            0.22 *
            runtimeTuning.formAsymmetryAccumRate,
      ),
    );
  }

  /**
   * 大域変形: 複数の造形モードをブレンドする。
   * diabolo だけだとくびれ＋上下膨らみのジャグリング用形状に固定されるため、
   * torus / monolith / coral / spindle を音と乱数で混ぜる。
   */
  private applyGlobalForm(px: number, py: number, pz: number) {
    const ax = this.morphAxis.x;
    const ay = this.morphAxis.y;
    const az = this.morphAxis.z;
    const along = Math.min(1, Math.max(-1, (px * ax + py * ay + pz * az) / 1.6));
    const alongLift = along * 1.6;
    const rx = px - ax * alongLift;
    const ry = py - ay * alongLift;
    const rz = pz - az * alongLift;
    const perp = Math.min(1.2, Math.hypot(rx, ry, rz) / 1.6);
    const w = this.morphWeights;

    const blendScale = (delta: number, weight: number) => 1 + delta * weight;

    // diabolo: くびれ＋両端 (従来の Y 対称を主軸に沿わせたもの。重みで抑制)
    const diaboloWaist =
      1 -
      this.formWaist * Math.exp(-Math.pow((along - this.waistCenterAlong) / 0.34, 2)) * 0.85;
    const diaboloHead = 1 + this.formStretch * smoothstep(0.2, 0.82, along) * 0.48;
    const diaboloBase = 1 + this.formBaseWeight * smoothstep(-1, -0.5, along) * 0.4;
    let sx =
      px *
      blendScale(diaboloWaist * diaboloHead * diaboloBase - 1, w.diabolo);
    let sy =
      py *
      blendScale(
        1 +
          this.formStretch * 0.28 * smoothstep(0.15, 0.85, along) +
          this.formBaseWeight * 0.18 * smoothstep(-1, -0.45, along) -
          1,
        w.diabolo,
      );
    let sz =
      pz *
      blendScale(
        diaboloWaist *
          (1 + this.formStretch * smoothstep(-0.15, 0.5, along) * 0.14) -
          1,
        w.diabolo,
      );

    // torus: 主軸の赤道リングが太る・極が細い
    const torusEquator =
      1 + this.formStretch * (1 - smoothstep(0, 0.48, Math.abs(along))) * perp * 0.52;
    const torusPole =
      1 - this.formWaist * smoothstep(0.4, 0.98, Math.abs(along)) * 0.22;
    const torusScale = torusEquator * torusPole;
    sx *= blendScale(torusScale - 1, w.torus);
    sy *= blendScale(torusScale - 1, w.torus);
    sz *= blendScale(torusScale - 1, w.torus);

    // monolith: 主軸の片側だけが塊になる (非対称な岩・生物)
    const monoCap = 1 + this.formBaseWeight * smoothstep(0.12, 0.82, along) * 0.46;
    const monoTail = 1 - this.formWaist * smoothstep(-0.92, -0.18, along) * 0.32;
    const monoScale = monoCap * monoTail;
    sx *= blendScale(monoScale - 1, w.monolith);
    sy *= blendScale(monoScale - 1, w.monolith);
    sz *= blendScale(monoScale - 1, w.monolith);

    // spindle: 主軸方向に細長く、垂直断面は絞る
    const spindleAlong = 1 + this.formStretch * Math.abs(along) * 0.34;
    const spindlePerp = 1 - this.formWaist * perp * 0.26;
    sx *= blendScale(spindleAlong * spindlePerp - 1, w.spindle);
    sy *= blendScale(spindleAlong * spindlePerp - 1, w.spindle);
    sz *= blendScale(spindleAlong * spindlePerp - 1, w.spindle);

    // coral: 3D ノイズで塊のクラスタ (垂直対称を壊す)
    const coralNoise = vertexPattern(px * 1.15, py * 1.08, pz * 1.12, this.morphologySeed + this.formingTime * 0.16);
    const coralBump = 1 + coralNoise * 0.14 * (0.45 + this.formTwist * 0.08);
    sx *= blendScale(coralBump - 1, w.coral);
    sy *= blendScale(coralBump - 1, w.coral);
    sz *= blendScale(coralBump - 1, w.coral);

    const sidePull =
      this.formAsymmetry * (1 - along * along) * perp * runtimeTuning.asymmetrySidePull;
    // ねじりが視覚的に支配しやすいので、量を抑えて緩やかに
    const twistAngle =
      this.formTwist * along * runtimeTuning.twistAlongFactor +
      this.formAsymmetry * along * along * runtimeTuning.asymmetryAlongFactor;
    const cosTwist = Math.cos(twistAngle);
    const sinTwist = Math.sin(twistAngle);

    sx += sidePull + this.formBendX * along * along;
    sy -= this.formBaseWeight * smoothstep(-1, -0.55, along) * 0.16 * w.monolith;
    sz += this.formBendZ * (along + 0.22) * (along + 0.22);

    // coral の接線方向シフト (塊の偏り)
    const coralShift = w.coral * coralNoise * 0.1 * perp;
    const shiftLen = Math.hypot(rx, ry, rz) || 1;
    sx += (rx / shiftLen) * coralShift;
    sz += (rz / shiftLen) * coralShift;

    const warpedX = sx * cosTwist - sz * sinTwist;
    const warpedY = sy;
    const warpedZ = sx * sinTwist + sz * cosTwist;
    // 序盤は大域モーフを掛けず、完全な球体の粘土塊として見せる
    const formMix = 1;
    return {
      x: px + (warpedX - px) * formMix,
      y: py + (warpedY - py) * formMix,
      z: pz + (warpedZ - pz) * formMix,
    };
  }

  private accumulateBassPressure(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const formation = this.getFormationScale();
    const detail = this.getDetailScale();
    const liveW = this.getBandLiveWeights(bands);
    const liveGainK = 0.38;
    const liveGainLow = 0.48 + liveW.low * t.liveLow * liveGainK;
    const liveGainMid = 0.48 + liveW.mid * t.liveMid * liveGainK;
    const liveGainHigh = 0.48 + liveW.high * t.liveHigh * liveGainK;
    const lowPressure = Math.max(0, Math.max(bands.sub, bands.low) - 0.025);
    const midPressure = Math.max(0, Math.max(bands.mid, bands.melody) - 0.025);
    const highPressure = Math.max(0, bands.high - 0.025);
    const sculptMidDrive = midPressure;
    const midTexture = sculptMidDrive * (0.42 + bands.contrast * 0.48);
    const lowAmount = lowPressure * deltaTime * t.accumRate * liveGainLow * formation;
    const midAmount =
      sculptMidDrive *
      deltaTime *
      t.accumRate *
      liveGainMid *
      formation *
      (0.65 + bands.contrast * 0.85);
    const highAmount =
      highPressure *
      deltaTime *
      t.accumRate *
      liveGainHigh *
      detail *
      this.getSpecies().spikeGain *
      (0.8 + bands.brightness * 0.1);

    if (lowAmount + midAmount + highAmount <= 0.0001) {
      return;
    }

    const axisA = this.getAudioCarveAxis(0, bands);
    const axisB = this.getAudioCarveAxis(1, bands);
    const carveBias = 0.42 + bands.brightness * 0.42;
    const pushBias = 0.74 + bands.contrast * 0.5;
    const mx = this.morphAxis.x;
    const my = this.morphAxis.y;
    const mz = this.morphAxis.z;
    const w = this.morphWeights;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const axisFocusA = smoothstep(-0.15, 0.88, nx * axisA.x + ny * axisA.y + nz * axisA.z);
      const axisFocusB = smoothstep(-0.28, 0.82, nx * axisB.x + ny * axisB.y + nz * axisB.z);
      const along = nx * mx + ny * my + nz * mz;
      const perp = Math.sqrt(Math.max(0.001, 1 - along * along));
      const headMass =
        smoothstep(0.36, 0.76, along) * smoothstep(1.0, 0.58, along);
      const torsoMass =
        smoothstep(-0.34, 0.08, along) * smoothstep(0.54, 0.12, along);
      const baseMass = smoothstep(-0.94, -0.52, along);
      const waistCarve =
        smoothstep(-0.18, 0.08, along - this.waistCenterAlong) *
        smoothstep(0.32, 0.1, along - this.waistCenterAlong);
      const crownCut = smoothstep(0.62, 0.95, along);
      const sideLobe =
        smoothstep(0.38, 0.96, perp) *
        smoothstep(-0.42, 0.24, along) *
        smoothstep(0.56, 0.18, along);
      const audioSalt = this.spectralPhase * 1.7 + this.carvingPhase * 0.9 + bands.centroid * 11.0 + bands.contrast * 7.0;
      const largeForm = vertexPattern(nx, ny, nz, audioSalt);
      const surfaceGrain = vertexPattern(nx, ny, nz, audioSalt + 6.3);
      const chiselNoise = vertexPattern(nx, ny, nz, audioSalt + 13.7);
      const spikeNoise = vertexPattern(nx, ny, nz, audioSalt + 28.9);
      const torusRing =
        (1 - smoothstep(0, 0.44, Math.abs(along))) * perp * (0.82 + bands.overall * 0.55);
      const monolithCap = smoothstep(0.18, 0.88, along) * axisFocusA * (0.95 + bands.overall * 0.5);
      const monolithTail = smoothstep(-0.9, -0.12, along) * (0.55 + (1 - axisFocusA) * 0.45);
      const coralCluster =
        smoothstep(0.12, 0.9, largeForm + chiselNoise * 0.55) * (0.5 + bands.contrast * 0.42);
      const spindleTip = smoothstep(0.52, 0.98, Math.abs(along)) * perp * (0.45 + bands.brightness * 0.5);
      const diaboloBulge =
        headMass * (0.95 + bands.brightness * 0.42) +
        torsoMass * (0.86 + bands.overall * 0.68) +
        baseMass * (0.58 + bands.overall * 0.64) +
        sideLobe * (0.5 + bands.overall * 0.42);
      const diaboloCarve =
        waistCarve * (1.12 + bands.contrast * 0.72) +
        crownCut * bands.overall * 0.42;
      const localFocus = 0.28 + axisFocusA * 0.56 + axisFocusB * bands.brightness * 0.44;
      const carveMask = smoothstep(0.04, 0.82, -largeForm + chiselNoise * 0.45 + axisFocusA * 0.42) * localFocus;
      const pushMask = smoothstep(0.12, 0.9, largeForm + surfaceGrain * 0.32 + axisFocusB * 0.22) * (0.38 + axisFocusB * 0.62);
      const ridge = Math.abs(surfaceGrain - chiselNoise) * midTexture;
      const idolBulge =
        w.diabolo * diaboloBulge +
        w.torus * torusRing +
        w.monolith * (monolithCap + monolithTail * 0.4) +
        w.coral * coralCluster +
        w.spindle * spindleTip;
      const idolCarve =
        w.diabolo * diaboloCarve +
        w.monolith * smoothstep(0.25, 0.92, -along) * axisFocusA * 0.55 +
        w.torus * smoothstep(0.72, 1.0, Math.abs(along)) * 0.28 * bands.overall +
        smoothstep(0.56, 0.96, -nx * axisA.x - nz * axisA.z) * axisFocusA * 0.36 * (0.35 + w.coral * 0.65);
      const roundedPressure =
        pushMask * pushBias * 0.22 -
        carveMask * (carveBias + 0.82) -
        smoothstep(0.0, 0.78, -largeForm + axisFocusA * 0.3) * 0.34 +
        ridge * 0.08 +
        idolBulge -
        idolCarve;
      const bumpPressure =
        surfaceGrain * 0.36 +
        chiselNoise * 0.28 +
        axisFocusB * 0.12 -
        0.16;
      const spikeMask = smoothstep(0.62, 0.96, spikeNoise * 0.58 + axisFocusA * 0.42 + bands.brightness * 0.24);
      const spikePressure =
        Math.pow(spikeMask, 2.7) *
        (0.26 + bands.contrast * 0.22 + bands.overall * 0.2);
      this.accumulated[i] = this.accumulateWithMemory(
        this.accumulated[i],
        lowAmount * roundedPressure,
        -0.72,
        0.58,
      );
      this.midBumps[i] = this.accumulateWithMemory(
        this.midBumps[i],
        midAmount * bumpPressure,
        -0.42,
        0.26,
      );
      const spikeCap = runtimeTuning.spikeCap * this.getSpecies().spikeGain;
      this.highSpikes[i] = Math.min(
        spikeCap,
        Math.max(
          0,
          (this.highSpikes[i] * (1 - deltaTime * 0.35)) +
            highAmount * spikePressure * 0.85,
        ),
      );

      // 結晶軸方向の "結晶化 / 粒子化" 変位。
      // 高音 + 高ブライトネス時、頂点ごとに固定された結晶軸方向に
      // 横方向の小さなオフセットが乗る。これが法線方向のスパイクと
      // 組合さって、鉱物や工業製品的な不揃いな突起感を出す。
      if (highAmount > 0.0001 && spikePressure > 0.001) {
        const ax = this.crystalAxes[index];
        const ay = this.crystalAxes[index + 1];
        const az = this.crystalAxes[index + 2];
        const crystalScale =
          highAmount *
          spikePressure *
          (0.45 + bands.brightness * 0.6) *
          runtimeTuning.crystalScale *
          this.getSpecies().crystalGain;
        this.vectorField[index] += ax * crystalScale;
        this.vectorField[index + 1] += ay * crystalScale;
        this.vectorField[index + 2] += az * crystalScale;
      }
    }
  }

  private getAudioCarveAxis(offset: number, bands: AudioBands) {
    const angle =
      this.carvingPhase * (1.1 + offset * 0.37) +
      bands.centroid * Math.PI * (2.2 + offset);
    const elevation =
      (bands.centroid - 0.42) * 1.05 +
      Math.sin(this.spectralPhase * 0.73 + offset) * 0.42 +
      (bands.overall - 0.28) * 0.72;
    const y = Math.sin(elevation);
    const horizontal = Math.sqrt(Math.max(0.001, 1 - y * y));

    return new THREE.Vector3(Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal);
  }

  /**
   * 曲構造イベントと器官予算で GrowthAnchor を生成する。
   */
  private maybeSpawnAnchors(bands: AudioBands, deltaTime: number) {
    const s = this.currentStructure;
    const ev = s.events;
    this.anchorSpawnCooldown = Math.max(0, this.anchorSpawnCooldown - deltaTime);

    if (this.growthAnchors.length > SoundSculpture.maxGrowthAnchors) {
      this.growthAnchors.sort((a, b) => b.strength - a.strength);
      this.growthAnchors.length = SoundSculpture.maxGrowthAnchors;
    }

    if (this.anchorSpawnCooldown > 0 || s.phase === "embryo") {
      return;
    }

    if (ev.noveltyPeak && s.novelty > this.lastNoveltySpawn + 0.1) {
      this.lastNoveltySpawn = s.novelty;
      const kind = this.pickAnchorKindFromStructure(bands);
      if (this.trySpawnStructureAnchor(kind, bands, 1.4)) {
        this.anchorSpawnCooldown = 0.28;
      }
    }

    if (ev.energySurge) {
      const kind = this.pickAnchorKindFromStructure(bands);
      if (this.trySpawnStructureAnchor(kind, bands, 1.2)) {
        this.anchorSpawnCooldown = 0.24;
      }
    }

    if (ev.energyDrop) {
      if (this.trySpawnStructureAnchor("erosion", bands, 0.75)) {
        this.anchorSpawnCooldown = 0.32;
      }
    }

    if (ev.transientBurst) {
      const kind = this.getSpecies().aggressive > 0.5 ? "crystal" : "tentacle";
      if (this.trySpawnStructureAnchor(kind, bands, 1.3)) {
        this.anchorSpawnCooldown = 0.22;
      }
    }

    if (ev.pulseStable && latestRhythm.kick > 0.06) {
      if (this.trySpawnStructureAnchor("lobe", bands, 0.85)) {
        this.anchorSpawnCooldown = 0.2;
      }
    }
  }

  private makeAnchor(kind: GrowthAnchorKind, bands: AudioBands): GrowthAnchor {
    const s = this.currentStructure;
    const seed = this.morphologySeed + latestRhythm.beatIndex * 0.17 + this.growthAnchors.length * 3.1;
    const u = seededUnit(this.growthAnchors.length, seed);
    const v = seededUnit(this.growthAnchors.length + 1, seed + 4.2);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * v)));
    const sinPhi = Math.sin(phi);
    const randomDir = new THREE.Vector3(sinPhi * Math.cos(theta), Math.cos(phi), sinPhi * Math.sin(theta));
    const axisBlend = 0.35 + s.density * 0.25;
    const position = randomDir.lerp(this.morphAxis, axisBlend).normalize();

    let direction: THREE.Vector3;
    switch (kind) {
      case "tentacle": {
        // 接線方向のランダムなベクトル (球面上で position に直交)。
        const arbitrary = Math.abs(position.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const t1 = new THREE.Vector3().crossVectors(position, arbitrary).normalize();
        const t2 = new THREE.Vector3().crossVectors(position, t1).normalize();
        const angle = seededUnit(this.growthAnchors.length + 2, seed + 8.4) * Math.PI * 2;
        direction = t1
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(t2, Math.sin(angle))
          .normalize();
        break;
      }
      case "crystal": {
        // 法線から少しズレた結晶軸方向。
        const random = new THREE.Vector3(
          seededUnit(this.growthAnchors.length, seed + 1.1) - 0.5,
          seededUnit(this.growthAnchors.length, seed + 2.2) - 0.5,
          seededUnit(this.growthAnchors.length, seed + 3.3) - 0.5,
        );
        if (random.lengthSq() < 0.001) {
          random.set(0, 1, 0);
        }
        random.normalize();
        direction = random.lerp(position, 0.55).normalize();
        break;
      }
      default:
        direction = position.clone();
    }

    let radius: number;
    let strength: number;
    let decay: number;
    const sp = this.getSpecies();
    const energy = bands.overall;
    switch (kind) {
      case "lobe":
        radius = 0.5 + seededUnit(this.growthAnchors.length, seed + 5) * 0.28;
        strength = (0.24 + energy * 0.55 + s.density * 0.2) * sp.rhythmic;
        decay = 0.2;
        break;
      case "tentacle":
        radius = 0.18 + seededUnit(this.growthAnchors.length, seed + 6) * 0.12;
        strength = (0.28 + energy * 0.5) * sp.tentacleGain;
        decay = 0.14;
        break;
      case "crystal":
        radius = 0.11 + seededUnit(this.growthAnchors.length, seed + 7) * 0.08;
        strength = (0.22 + energy * 0.38) * sp.crystalGain;
        decay = 0.38;
        break;
      case "erosion":
        radius = 0.28 + seededUnit(this.growthAnchors.length, seed + 8) * 0.2;
        strength = (0.3 + bands.contrast * 0.4 + (1 - s.energyLong) * 0.2) * sp.erosionGain;
        decay = 0.42;
        break;
    }

    return { position, direction, radius, strength, decay, kind, age: 0 };
  }

  /**
   * 既存のアンカーを 1 step 進めて、vectorField に方向性のある変位を蓄積する。
   * 各 kind ごとに違う成長挙動を持たせる:
   *  - lobe      : 法線方向にゆっくり膨らむ (低音の塊)
   *  - tentacle  : 接線方向に細長く伸び、わずかに法線方向にも (触手)
   *  - crystal   : 強い falloff で鋭く尖る (結晶スパイク)
   *  - erosion   : 法線方向に凹む (穴・侵食)
   */
  private applyGrowthAnchors(deltaTime: number) {
    if (this.growthAnchors.length === 0) {
      return;
    }

    for (let a = this.growthAnchors.length - 1; a >= 0; a -= 1) {
      const anchor = this.growthAnchors[a];
      anchor.age += deltaTime;
      anchor.strength *= Math.exp(-anchor.decay * deltaTime);
      if (anchor.strength < 0.004) {
        this.growthAnchors.splice(a, 1);
      }
    }

    if (this.growthAnchors.length === 0) {
      return;
    }

    const vertexCount = this.accumulated.length;

    for (let a = 0; a < this.growthAnchors.length; a += 1) {
      const anchor = this.growthAnchors[a];
      const ax = anchor.position.x;
      const ay = anchor.position.y;
      const az = anchor.position.z;
      const dx = anchor.direction.x;
      const dy = anchor.direction.y;
      const dz = anchor.direction.z;
      // radius は球面上での "角度的距離" の閾値。
      // dot >= cos(radius) なら影響圏内。
      const radiusCos = Math.cos(anchor.radius);
      const inv1MinusCos = 1 / Math.max(0.0001, 1 - radiusCos);
      const growth =
        anchor.strength * deltaTime * 0.42 * runtimeTuning.growthAnchorGain;

      for (let i = 0; i < vertexCount; i += 1) {
        const idx = i * 3;
        const bx = this.basePositions[idx];
        const by = this.basePositions[idx + 1];
        const bz = this.basePositions[idx + 2];
        const r = Math.hypot(bx, by, bz) || 1;
        const nx = bx / r;
        const ny = by / r;
        const nz = bz / r;
        const dot = nx * ax + ny * ay + nz * az;
        if (dot < radiusCos) {
          continue;
        }
        const t = (dot - radiusCos) * inv1MinusCos;
        const falloff = t * t * (3 - 2 * t);

        switch (anchor.kind) {
          case "lobe": {
            const f = falloff * growth * 0.55;
            this.vectorField[idx] += nx * f;
            this.vectorField[idx + 1] += ny * f;
            this.vectorField[idx + 2] += nz * f;
            break;
          }
          case "tentacle": {
            // anchor.direction を vertex tangent 平面へ射影。
            const proj = dx * nx + dy * ny + dz * nz;
            const tx = dx - nx * proj;
            const ty = dy - ny * proj;
            const tz = dz - nz * proj;
            const tLen = Math.hypot(tx, ty, tz) || 1;
            const f = falloff * growth;
            const tangentScale = 1.05 * f;
            const normalScale = 0.22 * f;
            this.vectorField[idx] += (tx / tLen) * tangentScale + nx * normalScale;
            this.vectorField[idx + 1] += (ty / tLen) * tangentScale + ny * normalScale;
            this.vectorField[idx + 2] += (tz / tLen) * tangentScale + nz * normalScale;
            break;
          }
          case "crystal": {
            const sharp = Math.pow(falloff, 4.5);
            const f = sharp * growth * 0.65;
            // 結晶: 法線 + わずかに斜めの軸。
            this.vectorField[idx] += (nx * 0.75 + dx * 0.45) * f;
            this.vectorField[idx + 1] += (ny * 0.75 + dy * 0.45) * f;
            this.vectorField[idx + 2] += (nz * 0.75 + dz * 0.45) * f;
            break;
          }
          case "erosion": {
            // “削り”は相対的に主役にする（ただし急激に凹まないように上限は同じ）
            const f = falloff * growth * 0.95;
            this.vectorField[idx] -= nx * f;
            this.vectorField[idx + 1] -= ny * f;
            this.vectorField[idx + 2] -= nz * f;
            break;
          }
        }
      }
    }
  }

  /**
   * Curl noise による接線方向の "流れ" 場を flowField に蓄積する。
   * 中音帯域で駆動され、表面が滑らかにうねる効果を生む。
   * flowField は decay 付きなので、無音になれば徐々に止まる。
   * 同時に、長時間の中音持続では vectorField にも薄く蓄積し、
   * "流れの痕跡" を恒久的な形状として残す。
   */
  private updateCurlFlow(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const flowDrive = Math.max(0, Math.max(bands.mid, bands.melody) - 0.05);
    const decayRate = Math.exp(-(0.55 - flowDrive * t.melodyFlowDecay) * deltaTime);
    const persistence = 1;
    const sp = this.getSpecies();
    const liveAmount =
      flowDrive *
      deltaTime *
      (runtimeTuning.flowLive + bands.contrast * runtimeTuning.flowContrast + flowDrive * t.melodyCurlBoost) *
      this.getDetailScale() *
      sp.flowGain;
    const persistAmount =
      flowDrive *
      deltaTime *
      t.flowPersist *
      persistence *
      (0.55 + bands.overall * 0.55) *
      this.getFormationScale() *
      sp.flowGain;
    const salt = this.spectralPhase * 0.7 + bands.centroid * 4.0;
    const skipLive = liveAmount < 0.0001;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      // 全頂点で flowField を緩く減衰。
      this.flowField[idx] *= decayRate;
      this.flowField[idx + 1] *= decayRate;
      this.flowField[idx + 2] *= decayRate;
      if (skipLive) {
        continue;
      }

      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const r = Math.hypot(bx, by, bz) || 1;
      const nx = bx / r;
      const ny = by / r;
      const nz = bz / r;

      curlNoiseSample(bx * 1.35, by * 1.35, bz * 1.35, salt, this._curlOut);
      // 法線方向成分を抜いて純粋な tangent flow にする。
      const dot = this._curlOut.x * nx + this._curlOut.y * ny + this._curlOut.z * nz;
      const tx = this._curlOut.x - nx * dot;
      const ty = this._curlOut.y - ny * dot;
      const tz = this._curlOut.z - nz * dot;

      this.flowField[idx] += tx * liveAmount;
      this.flowField[idx + 1] += ty * liveAmount;
      this.flowField[idx + 2] += tz * liveAmount;
      // 持続的な痕跡 (中音が長く続くほど "流れの彫り跡" が残る)。
      this.vectorField[idx] += tx * persistAmount;
      this.vectorField[idx + 1] += ty * persistAmount;
      this.vectorField[idx + 2] += tz * persistAmount;
    }
  }

  private getVectorNormalDisplacement(vertexIndex: number, nx: number, ny: number, nz: number) {
    const idx = vertexIndex * 3;
    const vfx = this.vectorField[idx];
    const vfy = this.vectorField[idx + 1];
    const vfz = this.vectorField[idx + 2];
    return vfx * nx + vfy * ny + vfz * nz;
  }

  /** 録音中に LIVE 変位を少しずつ永久レイヤーへ転写する */
  private bleedLiveIntoSculpture(bands: AudioBands, deltaTime: number) {
    const w = this.getBandLiveWeights(bands);
    const t = runtimeTuning;
    const rate = deltaTime * 1.4;

    const bleedRate = 0.027;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const lowBleed = this.liveOffset[i] * w.low * t.liveLow * rate * bleedRate;
      if (Math.abs(lowBleed) > 0.00001) {
        this.accumulated[i] = this.accumulateWithMemory(this.accumulated[i], lowBleed, -0.72, 0.58);
      }

      const midBleed = this.surfaceLiveOffset[i] * w.mid * t.liveMid * rate * bleedRate;
      if (Math.abs(midBleed) > 0.00001) {
        this.midBumps[i] = this.accumulateWithMemory(this.midBumps[i], midBleed, -0.42, 0.26);
      }

      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const highDrive = w.high * t.liveHigh + this.hatImpulse * 0.42;
      const highBleed =
        highDrive * rate * bleedRate * vertexPattern(nx, ny, nz, this.formingTime * 2.1 + i * 0.03);
      if (highBleed > 0.00001) {
        this.highSpikes[i] = Math.min(t.spikeCap, this.highSpikes[i] + highBleed);
      }
    }
  }

  private syncSculptureMemory(deltaTime: number) {
    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const vfScalar = this.getVectorNormalDisplacement(i, nx, ny, nz);
      const sculpted =
        this.accumulated[i] +
        this.midBumps[i] +
        this.highSpikes[i] +
        vfScalar * 0.88;
      this.rememberSculptedDisplacement(i, sculpted, deltaTime);
    }
  }

  private getPermanentScalarDisplacement(vertexIndex: number) {
    return this.sculptureMemory[vertexIndex];
  }

  private rememberSculptedDisplacement(index: number, sculptedDisplacement: number, deltaTime: number) {
    const remembered = this.sculptureMemory[index];
    const follow = Math.min(1, deltaTime * 5.5);
    const oppositeFlip =
      Math.sign(sculptedDisplacement) !== Math.sign(remembered) &&
      Math.abs(sculptedDisplacement) > Math.abs(remembered) * 0.68;
    const target = oppositeFlip ? sculptedDisplacement : remembered + (sculptedDisplacement - remembered) * follow;
    this.sculptureMemory[index] = target;
    return this.sculptureMemory[index];
  }

  /**
   * 侵食（削れ）フィールド。
   * - 序盤はほぼ変化させず、時間とともに効きが増える
   * - 中高域/コントラストで「削り」が増える（低域は削れにくい）
   * - flowField 方向へ薄く“擦り跡”を残す
   */
  private updateErosion(bands: AudioBands, deltaTime: number) {
    if (this.completed) {
      return;
    }

    const activity = smoothstep(SILENCE_THRESHOLD, 0.18, bands.overall);
    if (activity <= 0.0001) {
      return;
    }

    const drive =
      (0.01 + bands.overall * 0.05 + bands.contrast * 0.025) *
      activity *
      runtimeTuning.erosionDriveScale *
      this.getDetailScale() *
      this.getSpecies().erosionGain *
      (this.currentStructure.phase === "hardening" ? 0.55 : 1);
    const salt = this.carvingPhase * 1.1 + this.spectralPhase * 0.35 + this.morphologySeed * 0.8;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const r = Math.hypot(bx, by, bz) || 1;
      const nx = bx / r;
      const ny = by / r;
      const nz = bz / r;

      const grain = vertexPattern(nx, ny, nz, salt);
      const streak = vertexPattern(nx * 1.7, ny * 1.7, nz * 1.7, salt + 4.7);
      const mask = smoothstep(0.1, 0.92, -grain + streak * 0.55 + bands.contrast * 0.35);

      const hardness = 0.55;
      const amount = -drive * mask * (1 - hardness * 0.6) * deltaTime * 2.1;
      this.erosionField[i] = Math.max(-0.62, this.erosionField[i] + amount);

      const fx = this.flowField[idx];
      const fy = this.flowField[idx + 1];
      const fz = this.flowField[idx + 2];
      const fLen = Math.hypot(fx, fy, fz);
      if (fLen > 0.0001) {
        const scrape = drive * mask * deltaTime * 0.012;
        this.vectorField[idx] -= (fx / fLen) * scrape;
        this.vectorField[idx + 1] -= (fy / fLen) * scrape;
        this.vectorField[idx + 2] -= (fz / fLen) * scrape;
      }
    }
  }

  private updateCoreGeometry(_bands: AudioBands, deltaTime: number) {
    const positions = this.geometry.attributes.position.array;
    const t = runtimeTuning;
    // vectorField の頂点ごとの上限 (発散防止)。
    const maxVectorLen = 0.92;
    const maxVectorLenSq = maxVectorLen * maxVectorLen;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const pulse =
        this.completed ? 0 : vertexPattern(nx, ny, nz, this.formingTime * 1.6) * (
          (this.kickImpulse * 0.42 + latestRhythm.pulseEnvelope * latestRhythm.pulseConfidence * 0.38) * t.liveLow
        );

      this.liveOffset[i] += (pulse - this.liveOffset[i]) * Math.min(1, deltaTime * 8);

      const carve = this.detachmentCarve[i];
      const erosion = this.erosionField[i];
      const rememberedDisplacement = this.getPermanentScalarDisplacement(i);
      const scalarDisp = (rememberedDisplacement + erosion) * (1 - carve * 0.88);

      // vectorField のクランプ (頂点ごと)。
      let vfx = this.vectorField[index] * (1 - carve * 0.75);
      let vfy = this.vectorField[index + 1] * (1 - carve * 0.75);
      let vfz = this.vectorField[index + 2] * (1 - carve * 0.75);
      const lenSq = vfx * vfx + vfy * vfy + vfz * vfz;
      if (lenSq > maxVectorLenSq) {
        const s = maxVectorLen / Math.sqrt(lenSq);
        vfx *= s;
        vfy *= s;
        vfz *= s;
        this.vectorField[index] = vfx;
        this.vectorField[index + 1] = vfy;
        this.vectorField[index + 2] = vfz;
      }

      // 法線方向のスカラ変位 + 任意方向の vector offset + live tangent flow。
      const px = x + nx * scalarDisp + vfx + this.flowField[index];
      const py = y + ny * scalarDisp + vfy + this.flowField[index + 1];
      const pz = z + nz * scalarDisp + vfz + this.flowField[index + 2];
      const warped = this.applyGlobalForm(px, py, pz);
      positions[index] = warped.x;
      positions[index + 1] = warped.y;
      positions[index + 2] = warped.z;
    }

    this.constrainEnvelope(
      positions as Float32Array,
      this.targetCoreMeanRadius,
      1.12 + this.getFormationScale() * 0.22,
    );

    if (!this.completed) {
      for (let i = 0; i < this.accumulated.length; i += 1) {
        const index = i * 3;
        const x = this.basePositions[index];
        const y = this.basePositions[index + 1];
        const z = this.basePositions[index + 2];
        const radius = Math.hypot(x, y, z) || 1;
        const nx = x / radius;
        const ny = y / radius;
        const nz = z / radius;
        const live = this.liveOffset[i] * (1 - this.detachmentCarve[i] * 0.88);
        positions[index] += nx * live;
        positions[index + 1] += ny * live;
        positions[index + 2] += nz * live;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  private updateSurfaceGeometry(bands: AudioBands, deltaTime: number) {
    const positions = this.surfaceGeometry.attributes.position.array;
    const t = runtimeTuning;
    const w = this.getBandLiveWeights(bands);
    const midDrive = w.mid * t.liveMid;
    // surface は core より少し外側を覆うので vector offset を僅かに拡大。
    const vectorScale = 1.04;
    const flowScale = 0.92;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.baseSurfacePositions[index];
      const y = this.baseSurfacePositions[index + 1];
      const z = this.baseSurfacePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const flow = vertexPattern(nx, ny, nz, this.formingTime * 2.8);
      const ripple = vertexPattern(nx, ny, nz, this.formingTime * 3.6 + this.carvingPhase * 0.7);
      const surfacePattern = flow * 0.22 + ripple * 0.09;
      const targetSurfaceLive = midDrive * surfacePattern;
      this.surfaceLiveOffset[i] +=
        (targetSurfaceLive - this.surfaceLiveOffset[i]) * Math.min(1, deltaTime * 9);
      const remembered = this.getPermanentScalarDisplacement(i);
      const scalarDisp = remembered * 0.98 + flow * midDrive * 0.05;

      const px = x + nx * scalarDisp + this.vectorField[index] * vectorScale + this.flowField[index] * flowScale;
      const py = y + ny * scalarDisp + this.vectorField[index + 1] * vectorScale + this.flowField[index + 1] * flowScale;
      const pz = z + nz * scalarDisp + this.vectorField[index + 2] * vectorScale + this.flowField[index + 2] * flowScale;
      const warped = this.applyGlobalForm(px, py, pz);
      positions[index] = warped.x;
      positions[index + 1] = warped.y;
      positions[index + 2] = warped.z;
    }

    this.constrainEnvelope(positions as Float32Array, this.targetSurfaceMeanRadius, 1.32);

    if (!this.completed) {
      for (let i = 0; i < this.accumulated.length; i += 1) {
        const index = i * 3;
        const x = this.baseSurfacePositions[index];
        const y = this.baseSurfacePositions[index + 1];
        const z = this.baseSurfacePositions[index + 2];
        const radius = Math.hypot(x, y, z) || 1;
        const nx = x / radius;
        const ny = y / radius;
        const nz = z / radius;
        const live = this.surfaceLiveOffset[i];
        positions[index] += nx * live;
        positions[index + 1] += ny * live;
        positions[index + 2] += nz * live;
      }
    }

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uTime.value = this.completed ? this.frozenTime : this.formingTime;
    uniforms.uMelodyLine.value = t.membraneLine;
    uniforms.uMelodyFresnel.value = t.membraneFresnel;
    uniforms.uMelodyNoise.value = t.membraneNoise;
    uniforms.uMelodyFlowAnim.value = 1.2 + t.liveHigh * 1.4;
    uniforms.uMid.value += (bands.mid - uniforms.uMid.value) * Math.min(1, deltaTime * 9);
    uniforms.uMelody.value += (bands.melody - uniforms.uMelody.value) * Math.min(1, deltaTime * 9);
    uniforms.uHigh.value += (bands.high - uniforms.uHigh.value) * Math.min(1, deltaTime * 9);
    const targetLive = this.getMembraneLiveTarget(bands);
    uniforms.uLive.value += (targetLive - uniforms.uLive.value) * Math.min(1, deltaTime * 14);
    const targetGlow = this.getMembraneGlowTarget(bands);
    uniforms.uGlow.value += (targetGlow - uniforms.uGlow.value) * Math.min(1, deltaTime * 5);
    // 外殻の透明感を抑えて「中身が詰まっている」印象に寄せる
    const sp = this.getSpecies();
    const membraneOpacity =
      this.completed
        ? fibUnit(2, 21)
        : fibUnit(5, 21) + sp.membraneGain * fibUnit(8, 21) - sp.aggressive * fibUnit(5, 21);
    uniforms.uOpacity.value += (membraneOpacity - uniforms.uOpacity.value) * Math.min(1, deltaTime * fib(3));
    uniforms.uCompleted.value += ((this.completed ? 1 : 0) - uniforms.uCompleted.value) * Math.min(1, deltaTime * 2);

    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();
  }

  /**
   * 曲調の「離散度」: コントラスト・明るさ・全体エネルギー・スペクトル変化が強いほど上がる。
   */
  private updateSeparationTendency(bands: AudioBands, deltaTime: number) {
    const prev = this.previousBandsForSeparation;
    this.previousBandsForSeparation = { ...bands };

    if (prev) {
      const shift =
        Math.abs(bands.low - prev.low) +
        Math.abs(bands.mid - prev.mid) +
        Math.abs(bands.high - prev.high);
      this.spectralShift += (shift - this.spectralShift) * Math.min(1, deltaTime * 5.5);
    }

    const drive =
      bands.contrast * 0.4 +
      bands.brightness * 0.34 +
      bands.overall * 0.22 +
      bands.centroid * 0.18 +
      this.spectralShift * 1.6;
    const target = clamp01(drive);
    this.separationTendency += (target - this.separationTendency) * Math.min(1, deltaTime * 1.6);
    this.fragmentSpawnCooldown = Math.max(0, this.fragmentSpawnCooldown - deltaTime);
  }

  private pickDetachmentOrigin(out: THREE.Vector3) {
    let bestScore = -1;
    let bestIndex = 0;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      const vLen = Math.hypot(this.vectorField[idx], this.vectorField[idx + 1], this.vectorField[idx + 2]);
      const score = Math.abs(this.accumulated[i]) + vLen * 0.85 + this.highSpikes[i] * 1.2;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const idx = bestIndex * 3;
    const positions = this.geometry.attributes.position.array;
    out.set(positions[idx], positions[idx + 1], positions[idx + 2]);
    return bestIndex;
  }

  private applyDetachmentCarve(direction: THREE.Vector3, strength: number) {
    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;
    const coneCos = Math.cos(0.42);

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const r = Math.hypot(bx, by, bz) || 1;
      const dot = (bx / r) * dx + (by / r) * dy + (bz / r) * dz;
      if (dot < coneCos) {
        continue;
      }
      const t = (dot - coneCos) / Math.max(0.0001, 1 - coneCos);
      const falloff = t * t * (3 - 2 * t);
      this.detachmentCarve[i] = Math.min(1, this.detachmentCarve[i] + strength * falloff);
      this.accumulated[i] *= 1 - strength * falloff * 0.55;
    }
  }

  private maybeSpawnDetachedFragment(bands: AudioBands, _deltaTime: number) {
    const s = this.currentStructure;
    if (s.phase === "embryo" || s.detailRamp < 0.4) {
      return;
    }
    if (this.fragmentSpawnCooldown > 0 || this.separationTendency < 0.32) {
      return;
    }

    const prev = this.previousBandsForSeparation;
    const midAttack = prev ? Math.max(0, bands.mid - prev.mid) : 0;
    const highAttack = prev ? Math.max(0, bands.high - prev.high) : 0;

    const trigger =
      Math.max(
        latestRhythm.snare * 0.95,
        latestRhythm.transient * 0.9,
        s.novelty * 0.75,
        s.tension * 0.55,
        midAttack * 0.9,
        highAttack * 1.1,
      ) * (0.5 + this.separationTendency * 0.75);

    if (trigger < 0.38 * this.getSpecies().fragmentGain || this.getSpecies().aggressive < 0.28) {
      return;
    }

    if (!structureTracker.consumeOrganBudget(1.4)) {
      return;
    }

    const origin = new THREE.Vector3();
    this.pickDetachmentOrigin(origin);
    const dir = origin.clone().normalize();
    if (dir.lengthSq() < 0.001) {
      dir.copy(this.morphAxis);
    }

    const strength = clamp01(0.25 + trigger);

    // 「剥がれた」痕跡（切断面の印象だけ残す）
    this.applyDetachmentCarve(dir, 0.22 + strength * 0.28);

    // 粒の切り離し: spark を主役に、少し metal を混ぜて光量を出す
    this.emitDetachmentDust("spark", origin, dir, strength);
    if (strength > 0.35) {
      this.emitDetachmentDust("metal", origin, dir, strength * 0.55);
    }

    // sparkle も少量追従（瞬間の輝き）
    const burst = Math.min(12, 3 + Math.floor(strength * 14));
    for (let i = 0; i < burst; i += 1) {
      this.spawnSparkle({
        ...bands,
        high: Math.min(1, bands.high + 0.6),
        brightness: Math.min(1, bands.brightness + 0.55),
        contrast: Math.min(1, bands.contrast + 0.25),
      });
    }

    this.fragmentSpawnCooldown = 0.26 + (1 - strength) * 0.5;
  }

  private updateDetachedFragments(_bands: AudioBands, _deltaTime: number) {
    // 旧: detachedFragments のメッシュ片を更新
    // 新: 粒状 detachment は detachmentDust 側で更新する
  }

  private updateGlowDust(bands: AudioBands, deltaTime: number) {
    const live = this.completed ? 0 : bands.overall;
    const displayTime = this.completed ? this.frozenTime : this.formingTime;
    const shellPulse = 1.34 + bands.mid * 0.08 + bands.melody * 0.14 + bands.high * 0.08 + Math.sin(displayTime * 1.4) * 0.04;
    const drift = displayTime * (0.35 + bands.mid * 0.45 + bands.melody * 0.95);

    for (let i = 0; i < SoundSculpture.maxGlowDust; i += 1) {
      const idx = i * 3;
      const nx = this.glowDustBaseDirs[idx];
      const ny = this.glowDustBaseDirs[idx + 1];
      const nz = this.glowDustBaseDirs[idx + 2];
      const wobble = vertexPattern(nx, ny, nz, this.morphologySeed + i * 0.13 + drift) * 0.14;
      const radius = shellPulse + wobble + seededUnit(i, drift) * 0.08;
      this.glowDustPositions[idx] = nx * radius;
      this.glowDustPositions[idx + 1] = ny * radius;
      this.glowDustPositions[idx + 2] = nz * radius;

      const glow = (0.25 + live * 0.75 + bands.high * 0.45) * (0.55 + seededUnit(i, 2.7) * 0.45);
      this.glowDustColors[idx] = 0.38 * glow;
      this.glowDustColors[idx + 1] = 0.7 * glow;
      this.glowDustColors[idx + 2] = 1.0 * glow;
    }

    const targetOpacity = this.completed ? 0.12 : 0.42 + bands.high * 0.35 + bands.melody * 0.28 + bands.mid * 0.1;
    this.glowDustMaterial.opacity +=
      (targetOpacity - this.glowDustMaterial.opacity) * Math.min(1, deltaTime * 4);
    this.glowDustMaterial.size = 0.014 + bands.high * 0.008 + this.hatImpulse * 0.012 + this.waveImpulse * 0.01;

    this.glowDustGeometry.attributes.position.needsUpdate = true;
    this.glowDustGeometry.attributes.color.needsUpdate = true;
  }

  private spawnSparkle(bands: AudioBands) {
    const index = this.sparkleCursor();
    const idx = index * 3;
    const origin = new THREE.Vector3();
    this.pickDetachmentOrigin(origin);
    const jitter = 0.08 + bands.high * 0.06;
    this.sparklePositions[idx] = origin.x + (Math.random() - 0.5) * jitter;
    this.sparklePositions[idx + 1] = origin.y + (Math.random() - 0.5) * jitter;
    this.sparklePositions[idx + 2] = origin.z + (Math.random() - 0.5) * jitter;
    this.sparkleLife[index] = 1;
    const glow = 0.7 + bands.high * 0.5;
    this.sparkleColors[idx] = 0.55 * glow;
    this.sparkleColors[idx + 1] = 0.85 * glow;
    this.sparkleColors[idx + 2] = 1.0 * glow;
  }

  private sparkleCursor() {
    const index = this.sparkleCursorIndex;
    this.sparkleCursorIndex = (this.sparkleCursorIndex + 1) % SoundSculpture.maxSparkles;
    return index;
  }

  private updateSparkles(bands: AudioBands, deltaTime: number) {
    if (!this.completed) {
      this.sparkleEmission +=
        (bands.high * 0.6 + bands.melody * 0.45 + bands.mid * 0.15 + bands.brightness * 0.35) * deltaTime * 28;
      let spawned = 0;
      while (this.sparkleEmission >= 1 && spawned < 8) {
        this.spawnSparkle(bands);
        this.sparkleEmission -= 1;
        spawned += 1;
      }
    }

    const decay = this.completed ? 2.8 : 1.8;
    for (let i = 0; i < SoundSculpture.maxSparkles; i += 1) {
      if (this.sparkleLife[i] <= 0) {
        continue;
      }
      this.sparkleLife[i] = Math.max(0, this.sparkleLife[i] - deltaTime * decay);
      const idx = i * 3;
      if (this.sparkleLife[i] <= 0) {
        this.sparklePositions[idx] = 999;
        this.sparklePositions[idx + 1] = 999;
        this.sparklePositions[idx + 2] = 999;
        continue;
      }
      const twinkle = this.sparkleLife[i] * (0.65 + bands.high * 0.5);
      this.sparkleColors[idx] = 0.5 * twinkle;
      this.sparkleColors[idx + 1] = 0.82 * twinkle;
      this.sparkleColors[idx + 2] = 1.0 * twinkle;
    }

    this.sparkleMaterial.opacity += ((this.completed ? 0.08 : 0.88) - this.sparkleMaterial.opacity) * Math.min(1, deltaTime * 5);
    this.sparkleGeometry.attributes.position.needsUpdate = true;
    this.sparkleGeometry.attributes.color.needsUpdate = true;
  }

  private updateParticles(bands: AudioBands, deltaTime: number) {
    if (this.completed) {
      this.completeFadeOut = Math.max(0, this.completeFadeOut - deltaTime * 1.8);
    }

    if (!this.completed) {
      this.particleEmission +=
        Math.max(0, bands.high - 0.12) * deltaTime * 52 *
          this.getDetailScale() +
        Math.max(0, bands.melody - 0.1) * deltaTime * 28 * this.getDetailScale() +
        Math.max(0, bands.mid - 0.14) * deltaTime * 16 +
        bands.contrast * deltaTime * 8;

      let spawnedThisFrame = 0;
      while (this.particleEmission >= 1 && spawnedThisFrame < 5) {
        this.spawnParticle(bands.high);
        this.particleEmission -= 1;
        spawnedThisFrame += 1;
      }
    }

    const completedFade = this.completeFadeOut;

    for (let i = 0; i < SoundSculpture.maxParticles; i += 1) {
      if (this.particleActive[i] === 0) {
        continue;
      }

      if (this.completed && completedFade < 0.02) {
        this.particleActive[i] = 0;
        this.particleStuck[i] = 0;
        this.particlePositions[i * 3] = 999;
        this.particlePositions[i * 3 + 1] = 999;
        this.particlePositions[i * 3 + 2] = 999;
        continue;
      }

      const index = i * 3;
      const tx = this.particleTargetDirections[index];
      const ty = this.particleTargetDirections[index + 1];
      const tz = this.particleTargetDirections[index + 2];
      const targetRadius = 1.45 + this.particleTargetOffsets[i];
      const targetX = tx * targetRadius;
      const targetY = ty * targetRadius;
      const targetZ = tz * targetRadius;

      if (this.particleStuck[i] === 0) {
        const speed = 0.72 + bands.high * 1.65;
        this.particleProgress[i] = Math.min(1, this.particleProgress[i] + deltaTime * speed);

        const easedProgress = 1 - Math.pow(1 - this.particleProgress[i], 3);
        const sx = this.particleStartPositions[index];
        const sy = this.particleStartPositions[index + 1];
        const sz = this.particleStartPositions[index + 2];
        const orbit = Math.sin(this.formingTime * 2.2 + i * 0.37) * 0.12;
        const orbitX = -tz * orbit;
        const orbitZ = tx * orbit;

        this.particlePositions[index] = sx + (targetX - sx) * easedProgress + orbitX;
        this.particlePositions[index + 1] = sy + (targetY - sy) * easedProgress;
        this.particlePositions[index + 2] = sz + (targetZ - sz) * easedProgress + orbitZ;

        if (this.particleProgress[i] >= 1) {
          this.particleStuck[i] = 1;
        }
      } else {
        this.particlePositions[index] = targetX;
        this.particlePositions[index + 1] = targetY;
        this.particlePositions[index + 2] = targetZ;
      }

      const glow = (this.completed ? 0.42 * completedFade : 0.62 + bands.high * 0.34);
      this.particleColors[index] = 0.48 * glow;
      this.particleColors[index + 1] = 0.78 * glow;
      this.particleColors[index + 2] = 1.0 * glow;
    }

    this.particleMaterial.opacity +=
      ((this.completed ? 0.08 : 0.82) - this.particleMaterial.opacity) * Math.min(1, deltaTime * 4);
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  private spawnParticle(energy: number) {
    const particleIndex = this.particleCursor;
    const surfaceIndex = Math.floor(seededUnit(this.particleCursor, this.formingTime + energy * 13) * this.accumulated.length);
    const surfacePositionIndex = surfaceIndex * 3;
    const particlePositionIndex = particleIndex * 3;
    const x = this.baseSurfacePositions[surfacePositionIndex];
    const y = this.baseSurfacePositions[surfacePositionIndex + 1];
    const z = this.baseSurfacePositions[surfacePositionIndex + 2];
    const radius = Math.hypot(x, y, z) || 1;
    const nx = x / radius;
    const ny = y / radius;
    const nz = z / radius;
    const orbitAngle = seededUnit(particleIndex, this.formingTime * 0.7) * Math.PI * 2;
    const orbitRadius = 2.55 + seededUnit(particleIndex, 4.2) * 1.35;
    const verticalDrift = (seededUnit(particleIndex, 8.9) - 0.5) * 1.5;

    this.particleStartPositions[particlePositionIndex] = Math.cos(orbitAngle) * orbitRadius + nx * 0.24;
    this.particleStartPositions[particlePositionIndex + 1] = verticalDrift + ny * 0.36;
    this.particleStartPositions[particlePositionIndex + 2] = Math.sin(orbitAngle) * orbitRadius + nz * 0.24;
    this.particleTargetDirections[particlePositionIndex] = nx;
    this.particleTargetDirections[particlePositionIndex + 1] = ny;
    this.particleTargetDirections[particlePositionIndex + 2] = nz;
    this.particleTargetOffsets[particleIndex] = Math.max(-0.34, this.accumulated[surfaceIndex] * 0.86) + 0.035 + energy * 0.04;
    this.particleProgress[particleIndex] = 0;
    this.particleActive[particleIndex] = 1;
    this.particleStuck[particleIndex] = 0;

    this.particlePositions[particlePositionIndex] = this.particleStartPositions[particlePositionIndex];
    this.particlePositions[particlePositionIndex + 1] = this.particleStartPositions[particlePositionIndex + 1];
    this.particlePositions[particlePositionIndex + 2] = this.particleStartPositions[particlePositionIndex + 2];

    this.particleCursor = (this.particleCursor + 1) % SoundSculpture.maxParticles;
  }
}

class StarField {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly twinklePhase: Float32Array;
  private readonly twinkleRate: Float32Array;
  private readonly driftDir: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(count = 2400) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.twinklePhase = new Float32Array(count);
    this.twinkleRate = new Float32Array(count);
    this.driftDir = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      // far shell around origin (camera orbits around center)
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      const nx = sinPhi * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = sinPhi * Math.sin(theta);

      const radius = 26 + Math.random() * 34;
      this.positions[idx] = nx * radius;
      this.positions[idx + 1] = ny * radius * 0.78; // 少し扁平にして“空”感
      this.positions[idx + 2] = nz * radius;

      // slight drift direction (very slow)
      const dx = (Math.random() - 0.5) * 0.5;
      const dy = (Math.random() - 0.5) * 0.35;
      const dz = (Math.random() - 0.5) * 0.5;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.driftDir[idx] = dx / len;
      this.driftDir[idx + 1] = dy / len;
      this.driftDir[idx + 2] = dz / len;

      // star color: white〜pale blue, rare warm stars
      const warm = Math.random() < 0.08;
      const tint = 0.6 + Math.random() * 0.4;
      const r = warm ? 0.95 * tint : 0.65 * tint;
      const g = warm ? 0.85 * tint : 0.78 * tint;
      const b = warm ? 1.0 * tint : 1.0 * tint;

      // brightness distribution (many faint, few bright)
      const bright = Math.pow(Math.random(), 3.2);
      const intensity = 0.18 + (1 - bright) * 0.95;

      this.baseColors[idx] = r * intensity;
      this.baseColors[idx + 1] = g * intensity;
      this.baseColors[idx + 2] = b * intensity;
      this.colors[idx] = this.baseColors[idx];
      this.colors[idx + 1] = this.baseColors[idx + 1];
      this.colors[idx + 2] = this.baseColors[idx + 2];

      this.twinklePhase[i] = Math.random() * Math.PI * 2;
      this.twinkleRate[i] = 0.25 + Math.random() * 0.9;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.022,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }

  update(time: number, bands: AudioBands, deltaTime: number) {
    // audio reacts only subtly: brighter on hats/highs, slightly steadier on bass
    const audioTwinkle = 0.18 + bands.high * 0.35 + bands.brightness * 0.25;
    const calm = 1 - bands.sub * 0.25;

    const drift = deltaTime * 0.05 * (0.35 + audioTwinkle) * calm;
    const count = this.twinklePhase.length;
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      // extremely slow drift (keeps “alive” feeling)
      this.positions[idx] += this.driftDir[idx] * drift;
      this.positions[idx + 1] += this.driftDir[idx + 1] * drift;
      this.positions[idx + 2] += this.driftDir[idx + 2] * drift;

      const tw =
        0.72 +
        0.28 *
          Math.sin(time * this.twinkleRate[i] + this.twinklePhase[i]) *
          (0.75 + audioTwinkle * 0.75);

      this.colors[idx] = this.baseColors[idx] * tw;
      this.colors[idx + 1] = this.baseColors[idx + 1] * tw;
      this.colors[idx + 2] = this.baseColors[idx + 2] * tw;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.75 + bands.high * 0.12;
    this.material.size = 0.02 + bands.high * 0.01;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const appElement = document.querySelector<HTMLElement>("#app");
const startButton = document.querySelector<HTMLButtonElement>("#start-audio");
const startSystemAudioButton = document.querySelector<HTMLButtonElement>("#start-system-audio");
const startDevAudioButton = document.querySelector<HTMLButtonElement>("#start-dev-audio");
const resetSculptureButton = document.querySelector<HTMLButtonElement>("#reset-sculpture");
const completeButton = document.querySelector<HTMLButtonElement>("#complete-sculpture");
const exportButton = document.querySelector<HTMLButtonElement>("#export-gltf");
const viewerControlFields = document.querySelector<HTMLFieldSetElement>("#viewer-control-fields");
const lightAzimuthInput = document.querySelector<HTMLInputElement>("#light-azimuth");
const lightElevationInput = document.querySelector<HTMLInputElement>("#light-elevation");
const lightIntensityInput = document.querySelector<HTMLInputElement>("#light-intensity");
const resetViewButton = document.querySelector<HTMLButtonElement>("#reset-view");
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const audioInputSelect = document.querySelector<HTMLSelectElement>("#audio-input-device");
const refreshAudioDevicesButton = document.querySelector<HTMLButtonElement>("#refresh-audio-devices");
const audioScopeCanvas = document.querySelector<HTMLCanvasElement>("#audio-scope");
const controlPanelShell = document.querySelector<HTMLElement>("#control-panel-shell");
const controlPanelHandle = document.querySelector<HTMLElement>("#control-panel-handle");
const toggleControlPanelButton = document.querySelector<HTMLButtonElement>("#toggle-control-panel");
const tuningSlidersRoot = document.querySelector<HTMLElement>("#tuning-sliders");
const tuningExportText = document.querySelector<HTMLTextAreaElement>("#tuning-export-text");
const copyTuningButton = document.querySelector<HTMLButtonElement>("#copy-tuning");
const resetTuningButton = document.querySelector<HTMLButtonElement>("#reset-tuning");
const sculptureModeSelect = document.querySelector<HTMLSelectElement>("#sculpture-mode");
const bandTestPanel = document.querySelector<HTMLDetailsElement>("#band-test-panel");
const bandSoloSelect = document.querySelector<HTMLSelectElement>("#band-solo-mode");
const bandToneTestButton = document.querySelector<HTMLButtonElement>("#band-tone-test");

if (
  !canvas ||
  !appElement ||
  !startButton ||
  !startSystemAudioButton ||
  !resetSculptureButton ||
  !completeButton ||
  !exportButton ||
  !viewerControlFields ||
  !lightAzimuthInput ||
  !lightElevationInput ||
  !lightIntensityInput ||
  !resetViewButton ||
  !statusElement ||
  !audioInputSelect ||
  !refreshAudioDevicesButton ||
  !audioScopeCanvas ||
  !controlPanelShell ||
  !controlPanelHandle ||
  !toggleControlPanelButton ||
  !tuningSlidersRoot ||
  !tuningExportText ||
  !copyTuningButton ||
  !resetTuningButton ||
  !sculptureModeSelect
) {
  throw new Error("Required DOM elements are missing.");
}

const sculptureMode = parseSculptureMode();
const isCarveMode = sculptureMode === "carve";

if (import.meta.env.DEV && startDevAudioButton) {
  startDevAudioButton.hidden = false;
}

if (import.meta.env.DEV && bandTestPanel) {
  bandTestPanel.hidden = false;
}

const parseBandSoloMode = (): BandSoloMode => {
  const value = bandSoloSelect?.value;
  if (value === "low" || value === "mid" || value === "high") {
    return value;
  }
  return "off";
};

let bandSoloMode: BandSoloMode = parseBandSoloMode();
setBandSoloMode(bandSoloMode);

const applySculptureModeUi = (mode: SculptureMode) => {
  sculptureModeSelect.value = mode;
  appElement.classList.toggle("mode-carve", mode === "carve");
  appElement.classList.toggle("mode-classic", mode === "classic");
  if (mode === "carve") {
    document.title = "Sound Sculpture — 粒";
  }
};

applySculptureModeUi(sculptureMode);

sculptureModeSelect.addEventListener("change", () => {
  const nextMode: SculptureMode = sculptureModeSelect.value === "carve" ? "carve" : "classic";
  if (nextMode === sculptureMode) {
    return;
  }
  const url = new URL(window.location.href);
  if (nextMode === "classic") {
    url.searchParams.delete("mode");
  } else {
    url.searchParams.set("mode", "carve");
  }
  window.location.href = url.toString();
});

toggleControlPanelButton.addEventListener("click", () => {
  const collapsed = controlPanelShell.classList.toggle("is-collapsed");
  toggleControlPanelButton.setAttribute("aria-expanded", String(!collapsed));
});

type ControlPanelPosition = { left: number; top: number };
const CONTROL_PANEL_POSITION_STORAGE_KEY = "sound-sculpture:controlPanelPosition";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const readStoredControlPanelPosition = (): ControlPanelPosition | null => {
  try {
    const raw = window.localStorage.getItem(CONTROL_PANEL_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ControlPanelPosition>;
    if (typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
};

const writeStoredControlPanelPosition = (position: ControlPanelPosition) => {
  try {
    window.localStorage.setItem(CONTROL_PANEL_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // ignore
  }
};

const applyControlPanelPosition = (position: ControlPanelPosition) => {
  // Keep within viewport with a small margin.
  const margin = 12;
  const rect = controlPanelShell.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = clamp(position.left, margin, maxLeft);
  const top = clamp(position.top, margin, maxTop);

  controlPanelShell.style.left = `${left}px`;
  controlPanelShell.style.top = `${top}px`;
  controlPanelShell.style.right = "auto";
  controlPanelShell.style.bottom = "auto";
};

const restoreControlPanelPosition = () => {
  const stored = readStoredControlPanelPosition();
  if (!stored) return;
  // Defer until layout settles.
  requestAnimationFrame(() => {
    applyControlPanelPosition(stored);
  });
};

restoreControlPanelPosition();

// Drag the panel by the toggle button (acts as a handle).
{
  let dragging = false;
  let didMove = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const startDrag = (event: PointerEvent) => {
    // Only left click / primary pointer.
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    dragging = true;
    didMove = false;
    controlPanelHandle.setPointerCapture(pointerId);

    const rect = controlPanelShell.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    originLeft = rect.left;
    originTop = rect.top;
    controlPanelShell.classList.add("is-dragging");
  };

  const moveDrag = (event: PointerEvent) => {
    if (!dragging || pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!didMove && Math.hypot(dx, dy) >= 4) {
      didMove = true;
    }
    if (!didMove) return;
    applyControlPanelPosition({ left: originLeft + dx, top: originTop + dy });
  };

  const endDrag = (event: PointerEvent) => {
    if (!dragging || pointerId !== event.pointerId) return;
    dragging = false;
    controlPanelShell.classList.remove("is-dragging");
    if (didMove) {
      const rect = controlPanelShell.getBoundingClientRect();
      writeStoredControlPanelPosition({ left: rect.left, top: rect.top });
    }
    pointerId = null;
    didMove = false;
  };

  controlPanelHandle.addEventListener("pointerdown", startDrag);
  controlPanelHandle.addEventListener("pointermove", moveDrag);
  controlPanelHandle.addEventListener("pointerup", endDrag);
  controlPanelHandle.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    const rect = controlPanelShell.getBoundingClientRect();
    applyControlPanelPosition({ left: rect.left, top: rect.top });
  });
}

const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x000000);
scene.background = new THREE.Color(0xf7f6f2);

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.28, 6.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enabled = true;
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.enablePan = false;
orbitControls.minDistance = 3.4;
orbitControls.maxDistance = 9;
orbitControls.target.set(0, 0, 0);
orbitControls.saveState();

let isViewInteracting = false;
orbitControls.addEventListener("start", () => {
  isViewInteracting = true;
});
orbitControls.addEventListener("end", () => {
  isViewInteracting = false;
});

const sculpture: SculptureExperience = isCarveMode
  ? new SoundSculpture({ granular: true })
  : new SoundSculpture();
scene.add(sculpture.group);

const stars = new StarField();
scene.add(stars.points);

const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(3, 4, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 18;
keyLight.shadow.camera.left = -6;
keyLight.shadow.camera.right = 6;
keyLight.shadow.camera.top = 6;
keyLight.shadow.camera.bottom = -6;
scene.add(keyLight);
scene.add(keyLight.target);

const fillLight = new THREE.DirectionalLight(0xe8f0ff, 1.1);
fillLight.position.set(-4, 2, 2);
scene.add(fillLight);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0xd6d0c6, 2.4);
scene.add(ambientLight);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.045 }));
floor.position.y = -1.82;
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const audioInput = new AudioInput();
const rhythm = new RhythmTracker();

bandSoloSelect?.addEventListener("change", () => {
  bandSoloMode = parseBandSoloMode();
  setBandSoloMode(bandSoloMode);
  sculpture.applyLiveTuningNow();
});

bandToneTestButton?.addEventListener("click", async () => {
  if (!isAudioReady || !bandToneTestButton) {
    return;
  }
  bandToneTestButton.disabled = true;
  try {
    await audioInput.playBandIsolationTest(BAND_TEST_TONES, (label) => {
      setStatus(`音域テスト: ${label}`);
    });
    setStatus("音域テスト完了 — メーターとソロで確認してください");
  } catch (error) {
    const message = error instanceof Error ? error.message : "テスト音の再生に失敗しました";
    setStatus(message);
    console.error(error);
  } finally {
    bandToneTestButton.disabled = !isAudioReady;
  }
});

const clock = new THREE.Clock();
let isAudioReady = false;
let isComplete = false;
let hasHeardSound = false;
let silenceSeconds = 0;
const audioScopeContext = audioScopeCanvas.getContext("2d");

const drawAudioScope = (
  waveform: Uint8Array | null,
  rhythmEvents: RhythmEvents,
  meters: BandMeterSnapshot | null,
  soloMode: BandSoloMode,
  structure: StructureSnapshot = latestStructure,
  species: SpeciesProfile = speciesProfiler.getProfile(),
) => {
  if (!audioScopeContext) {
    return;
  }
  const ctx = audioScopeContext;
  const w = audioScopeCanvas.width;
  const h = audioScopeCanvas.height;
  const debugH = import.meta.env.DEV ? 28 : 0;
  const meterH = 16;
  const scopeH = h - meterH - debugH;
  ctx.clearRect(0, 0, w, h);

  // 低音 / 中音 / 高音メーター
  const meterCols = [
    { key: "low" as const, label: "低", value: meters?.low ?? 0, color: "rgba(42,92,200,0.78)" },
    { key: "mid" as const, label: "中", value: meters?.mid ?? 0, color: "rgba(46,140,96,0.78)" },
    { key: "high" as const, label: "高", value: meters?.high ?? 0, color: "rgba(200,120,48,0.82)" },
  ];
  const colW = w / meterCols.length;
  for (let i = 0; i < meterCols.length; i += 1) {
    const col = meterCols[i];
    const x = i * colW + 3;
    const barW = colW - 6;
    const isSolo = soloMode === col.key;
    const isDominant = meters?.dominant === col.key;
    ctx.fillStyle = isSolo ? "rgba(22,22,22,0.14)" : "rgba(22,22,22,0.06)";
    ctx.fillRect(x, scopeH + 1, barW, meterH - 2);
    const fillH = Math.max(2, col.value * (meterH - 4));
    ctx.fillStyle = col.color;
    ctx.fillRect(x, scopeH + meterH - 1 - fillH, barW, fillH);
    if (isDominant || isSolo) {
      ctx.strokeStyle = isSolo ? "rgba(22,22,22,0.55)" : col.color;
      ctx.lineWidth = isSolo ? 2 : 1;
      ctx.strokeRect(x, scopeH + 1, barW, meterH - 2);
    }
    ctx.fillStyle = "#5e594f";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(col.label, x + 4, scopeH + meterH - 5);
  }

  // baseline
  ctx.strokeStyle = "rgba(22,22,22,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, scopeH * 0.5);
  ctx.lineTo(w, scopeH * 0.5);
  ctx.stroke();

  if (waveform) {
    ctx.strokeStyle = "rgba(22,22,22,0.62)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const step = Math.max(1, Math.floor(waveform.length / w));
    let maxPeakX = 0;
    let maxPeakV = 0;
    for (let x = 0, i = 0; x < w && i < waveform.length; x += 1, i += step) {
      const v = (waveform[i] - 128) / 128;
      if (Math.abs(v) > maxPeakV) {
        maxPeakV = Math.abs(v);
        maxPeakX = x;
      }
      const y = scopeH * 0.5 + v * (scopeH * 0.36);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(61,124,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(maxPeakX, 0);
    ctx.lineTo(maxPeakX, scopeH);
    ctx.stroke();
  }

  const meterW = 6;
  ctx.fillStyle = "rgba(22,22,22,0.08)";
  ctx.fillRect(w - meterW - 4, 4, meterW, scopeH - 8);
  ctx.fillStyle = "rgba(61,124,255,0.5)";
  ctx.fillRect(
    w - meterW - 4,
    scopeH - 4 - rhythmEvents.waveEnergy * (scopeH - 12),
    meterW,
    rhythmEvents.waveEnergy * (scopeH - 12),
  );

  if (rhythmEvents.kick > 0) {
    ctx.fillStyle = "rgba(61,124,255,0.62)";
    ctx.fillRect(0, 0, Math.min(w, 18 + rhythmEvents.kick * 140), scopeH);
  }
  if (rhythmEvents.hat > 0) {
    ctx.fillStyle = "rgba(136,204,255,0.45)";
    ctx.fillRect(w - Math.min(w, 12 + rhythmEvents.hat * 90), 0, Math.min(w, 12 + rhythmEvents.hat * 90), scopeH);
  }
  if (rhythmEvents.transient > 0) {
    ctx.fillStyle = "rgba(255,220,120,0.35)";
    ctx.fillRect(w * 0.5 - 8, 0, 16 + rhythmEvents.transient * 60, scopeH);
  }

  if (import.meta.env.DEV) {
    const y = scopeH + meterH + 2;
    ctx.fillStyle = "#8a857b";
    ctx.font = "9px ui-monospace, monospace";
    const pulseBarW = Math.max(2, rhythmEvents.pulseConfidence * 42);
    const envBarW = Math.max(2, rhythmEvents.pulseEnvelope * 42);
    ctx.fillText(
      `pulse #${rhythmEvents.pulseIndex} ${rhythmEvents.pulsePhase.toFixed(2)} conf ${rhythmEvents.pulseConfidence.toFixed(2)} env ${rhythmEvents.pulseEnvelope.toFixed(2)}`,
      4,
      y + 9,
    );
    ctx.fillStyle = "rgba(61,124,255,0.45)";
    ctx.fillRect(4, y + 12, pulseBarW, 4);
    ctx.fillStyle = "rgba(42,140,96,0.55)";
    ctx.fillRect(50, y + 12, envBarW, 4);
    ctx.fillStyle = "#8a857b";
    ctx.fillText(
      `sp O${species.organic.toFixed(2)} A${species.aggressive.toFixed(2)} R${species.rhythmic.toFixed(2)}${species.locked ? " locked" : ""}`,
      4,
      y + 22,
    );
    ctx.fillText(`evt ${structure.lastEventLabel}`, w * 0.52, y + 22);
  }
};

const setStatus = (message: string) => {
  statusElement.textContent = message;
};

// 拡張機能や外部スクリプト由来も含め、実行時エラーを画面に出して原因特定しやすくする
window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? `${event.error.name}: ${event.error.message}` : event.message;
  setStatus(message);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  setStatus(`Unhandled: ${message}`);
});

const populateAudioDevices = async () => {
  const defaultOption = audioInputSelect
    .querySelector<HTMLOptionElement>('option[value="default"]')
    ?.cloneNode(true) as HTMLOptionElement | null;
  audioInputSelect.replaceChildren();
  if (defaultOption) {
    audioInputSelect.appendChild(defaultOption);
  }

  try {
    const devices = await audioInput.listAudioInputDevices();
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Audio input (${device.deviceId.slice(0, 6)}...)`;
      audioInputSelect.appendChild(option);
    }
  } catch (error) {
    console.error(error);
  }
};

refreshAudioDevicesButton.addEventListener("click", async () => {
  try {
    await populateAudioDevices();
    setStatus(refreshAudioDevicesButton.dataset.statusSuccess ?? "");
  } catch (error) {
    console.error(error);
    setStatus(refreshAudioDevicesButton.dataset.statusError ?? "");
  }
});

// enumerateDevices が環境によっては例外/遅延するため、起動をブロックしない
populateAudioDevices().catch((error) => {
  console.error(error);
});

const updateKeyLight = () => {
  const azimuth = THREE.MathUtils.degToRad(Number(lightAzimuthInput.value));
  const elevation = THREE.MathUtils.degToRad(Number(lightElevationInput.value));
  const radius = 6;

  keyLight.position.set(Math.cos(elevation) * Math.sin(azimuth) * radius, Math.sin(elevation) * radius, Math.cos(elevation) * Math.cos(azimuth) * radius);
  keyLight.intensity = Number(lightIntensityInput.value);
};

const completeSculpture = () => {
  if (isComplete) {
    return;
  }

  isComplete = true;
  silenceSeconds = 0;
  audioInput.stopPlayback();
  audioInput.resetAnalysisState();
  sculpture.complete();
  appElement.classList.add("is-complete");
  orbitControls.enabled = true;
  viewerControlFields.disabled = false;
  completeButton.disabled = true;
  resetSculptureButton.disabled = false;
  exportButton.disabled = false;
  setStatus(completeButton.dataset.statusDone ?? "");
};

const resetSculptureSession = () => {
  sculpture.reset();
  rhythm.reset();
  structureTracker.reset();
  speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
  speciesProfiler.reset();
  latestStructure = defaultStructureSnapshot();
  audioInput.resetAnalysisState();
  isComplete = false;
  hasHeardSound = false;
  silenceSeconds = 0;
  latestRhythm = {
    kick: 0,
    snare: 0,
    hat: 0,
    transient: 0,
    beat: 0,
    beatIndex: 0,
    kickIndex: 0,
    snareIndex: 0,
    hatIndex: 0,
    transientIndex: 0,
    downbeat: false,
    bpm: 0,
    pulsePhase: 0,
    pulseConfidence: 0,
    pulseEnvelope: 0,
    pulseIndex: 0,
    subLevel: 0,
    wavePeak: 0,
    waveEnergy: 0,
  };
  appElement.classList.remove("is-complete");
  orbitControls.enabled = true;
  viewerControlFields.disabled = true;
  completeButton.disabled = !isAudioReady;
  exportButton.disabled = true;
  audioInput.restartDevAudioIfActive();
  setStatus(isAudioReady ? (resetSculptureButton.dataset.statusReset ?? "") : (statusElement.dataset.statusIdle ?? ""));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const exportSculpture = () => {
  exportButton.disabled = true;
  setStatus(exportButton.dataset.statusExporting ?? "");

  const exporter = new GLTFExporter();
  const exportGroup = sculpture.createExportGroup();

  exporter.parse(
    exportGroup,
    (gltf) => {
      const blob =
        gltf instanceof ArrayBuffer
          ? new Blob([gltf], { type: "model/gltf-binary" })
          : new Blob([JSON.stringify(gltf, null, 2)], {
              type: "model/gltf+json",
            });

      downloadBlob(blob, "sound-sculpture.gltf");
      exportButton.disabled = false;
      setStatus(exportButton.dataset.statusSuccess ?? "");
    },
    (error) => {
      console.error(error);
      exportButton.disabled = false;
      setStatus(exportButton.dataset.statusError ?? "");
    },
    {
      binary: false,
      trs: true,
      onlyVisible: true,
    },
  );
};

const startAudioInput = async (
  trigger: HTMLButtonElement,
  start: () => Promise<void>,
) => {
  startButton.disabled = true;
  startSystemAudioButton.disabled = true;
  if (startDevAudioButton) {
    startDevAudioButton.disabled = true;
  }
  setStatus(trigger.dataset.statusPreparing ?? "");

  try {
    await start();
    isAudioReady = true;
    orbitControls.enabled = true;
    completeButton.disabled = false;
    resetSculptureButton.disabled = false;
    if (bandToneTestButton) {
      bandToneTestButton.disabled = false;
    }
    setStatus(trigger.dataset.statusReady ?? "");
  } catch (error) {
    startButton.disabled = false;
    startSystemAudioButton.disabled = false;
    if (startDevAudioButton) {
      startDevAudioButton.disabled = false;
    }
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "音入力を開始できませんでした";
    setStatus(message);
    console.error(error);
  }
};

startButton.addEventListener("click", async () => {
  await startAudioInput(startButton, async () => {
    await audioInput.startMicrophone(audioInputSelect.value);
    // 権限取得後に label が読めるようになる事があるため、再取得して表示名を更新。
    await populateAudioDevices();
  });
});

startSystemAudioButton.addEventListener("click", async () => {
  await startAudioInput(startSystemAudioButton, () => audioInput.startDisplayAudio());
});

if (import.meta.env.DEV && startDevAudioButton) {
  startDevAudioButton.addEventListener("click", async () => {
    const { DEV_AUDIO_URL } = await import("./dev-audio");
    await startAudioInput(startDevAudioButton, () => audioInput.startDevAudio(DEV_AUDIO_URL));
  });
}

completeButton.addEventListener("click", completeSculpture);
resetSculptureButton.addEventListener("click", resetSculptureSession);
exportButton.addEventListener("click", exportSculpture);
lightAzimuthInput.addEventListener("input", updateKeyLight);
lightElevationInput.addEventListener("input", updateKeyLight);
lightIntensityInput.addEventListener("input", updateKeyLight);
resetViewButton.addEventListener("click", () => {
  camera.position.set(0, 0.28, 6.4);
  orbitControls.target.set(0, 0, 0);
  orbitControls.update();
});

const resize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", resize);

const render = () => {
  const deltaTime = Math.min(0.033, clock.getDelta());
  const elapsedTime = clock.getElapsedTime();
  const rawBands = isAudioReady
    ? audioInput.update(deltaTime)
    : {
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
      };

  const waveformMetrics = isAudioReady ? audioInput.getWaveformMetrics() : null;
  const rhythmEvents = rhythm.update(rawBands, waveformMetrics, deltaTime);
  latestRhythm = rhythmEvents;
  const waveform = isAudioReady ? audioInput.getWaveformBytes() : null;
  const bandMeters = isAudioReady ? snapshotBandMeters(rawBands) : null;

  // 波形(RMS/peak)でゲートして「無音時のノイズ」を彫刻入力から除外する
  const bands: AudioBands = { ...rawBands };
  if (isAudioReady && waveformMetrics) {
    const waveGate = Math.max(
      smoothstep(0.008, 0.03, waveformMetrics.rms),
      smoothstep(0.03, 0.12, waveformMetrics.peak) * 0.75,
    );
    bands.sub *= waveGate;
    bands.low *= waveGate;
    bands.mid *= waveGate;
    bands.melody *= waveGate;
    bands.high *= waveGate;
    bands.overall *= waveGate;
  }

  stars.update(elapsedTime, bands, deltaTime);

  if (isAudioReady && !isComplete) {
    if (bands.overall >= SILENCE_THRESHOLD) {
      hasHeardSound = true;
    }

    if (hasHeardSound && bands.overall < SILENCE_THRESHOLD) {
      silenceSeconds += deltaTime;
    } else {
      silenceSeconds = 0;
    }

    if (silenceSeconds >= SILENCE_SECONDS_TO_COMPLETE) {
      completeSculpture();
    }
  }

  // 音の「瞬間」に反応を寄せる: kick/snare/hat を彫刻ロジックへ注入
  if (!isComplete && isAudioReady) {
    if (bandSoloAllows("low") && rhythmEvents.kick > 0) {
      bands.sub = Math.min(1, bands.sub + rhythmEvents.kick * 0.85);
      bands.low = Math.min(1, bands.low + rhythmEvents.kick * 0.55);
      bands.overall = Math.min(1, bands.overall + rhythmEvents.kick * 0.38);
    }
    if (bandSoloAllows("mid") && rhythmEvents.snare > 0) {
      bands.contrast = Math.min(1, bands.contrast + rhythmEvents.snare * 0.25);
      bands.mid = Math.min(1, bands.mid + rhythmEvents.snare * 0.35);
      bands.melody = Math.min(1, bands.melody + rhythmEvents.snare * 0.55);
      bands.overall = Math.min(1, bands.overall + rhythmEvents.snare * 0.12);
    }
    if (bandSoloAllows("high") && rhythmEvents.hat > 0) {
      bands.high = Math.min(1, bands.high + rhythmEvents.hat * 1.05);
      bands.brightness = Math.min(1, bands.brightness + rhythmEvents.hat * 0.75);
      bands.overall = Math.min(1, bands.overall + rhythmEvents.hat * 0.12);
    }
    if (bandSoloAllows("high") && rhythmEvents.transient > 0) {
      bands.high = Math.min(1, bands.high + rhythmEvents.transient * 1.1);
      bands.brightness = Math.min(1, bands.brightness + rhythmEvents.transient * 0.85);
      bands.overall = Math.min(1, bands.overall + rhythmEvents.transient * 0.32);
    }
    if (bandSoloAllows("high") && rhythmEvents.kick > 0) {
      bands.high = Math.min(1, bands.high + rhythmEvents.kick * 0.18);
    }
    if (bandSoloAllows("mid") && rhythmEvents.transient > 0) {
      bands.melody = Math.min(1, bands.melody + rhythmEvents.transient * 0.35);
    }
  }

  const isStructureActive = isAudioReady && !isComplete && bands.overall >= SILENCE_THRESHOLD;
  latestStructure = structureTracker.update(
    bands,
    {
      beat: rhythmEvents.beat,
      beatIndex: rhythmEvents.beatIndex,
      kick: rhythmEvents.kick,
      kickIndex: rhythmEvents.kickIndex,
      snare: rhythmEvents.snare,
      hat: rhythmEvents.hat,
      transient: rhythmEvents.transient,
      downbeat: rhythmEvents.downbeat,
      bpm: rhythmEvents.bpm,
      pulsePhase: rhythmEvents.pulsePhase,
      pulseConfidence: rhythmEvents.pulseConfidence,
      pulseEnvelope: rhythmEvents.pulseEnvelope,
    },
    deltaTime,
    isStructureActive,
  );

  speciesProfiler.update(
    {
      density: latestStructure.density,
      tension: latestStructure.tension,
      contrast: bands.contrast,
      brightness: bands.brightness,
      bassFocus: bands.bassFocus,
      centroid: bands.centroid,
      pulseConfidence: rhythmEvents.pulseConfidence,
      transientRate: structureTracker.getTransientRate(),
    },
    bands,
    deltaTime,
    isStructureActive,
  );
  const speciesProfile = speciesProfiler.getProfile();

  drawAudioScope(waveform, rhythmEvents, bandMeters, bandSoloMode, latestStructure, speciesProfile);

  const sculptureBands = bandSoloMode === "off" ? bands : applyBandSolo(bands, bandSoloMode);

  sculpture.update(
    sculptureBands,
    deltaTime,
    isViewInteracting,
    rhythmEvents,
    latestStructure,
    speciesProfile,
  );
  orbitControls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
};

const tuningSliderInputs = new Map<keyof SculptureTuning, HTMLInputElement>();
const tuningSliderValueLabels = new Map<keyof SculptureTuning, HTMLElement>();

const refreshTuningExport = () => {
  tuningExportText.value = formatSculptureTuningForAgent(sculptureTuning);
};

const syncTuningSlidersFromState = () => {
  for (const spec of TUNING_SLIDER_SPECS) {
    const input = tuningSliderInputs.get(spec.key);
    const valueLabel = tuningSliderValueLabels.get(spec.key);
    const value = sculptureTuning[spec.key];
    if (input) {
      input.value = String(value);
    }
    if (valueLabel) {
      valueLabel.textContent = value.toFixed(3);
    }
  }
  refreshTuningExport();
};

const initTuningPanel = () => {
  const groups = new Map<string, HTMLElement>();

  for (const spec of TUNING_SLIDER_SPECS) {
    let groupEl = groups.get(spec.group);
    if (!groupEl) {
      const section = document.createElement("section");
      section.className = "tuning-sliders__group";
      if (spec.group === "LIVE・呼吸") {
        section.classList.add("tuning-sliders__group--live");
      }
      const title = document.createElement("p");
      title.className = "tuning-sliders__group-title";
      title.textContent = spec.group;
      section.appendChild(title);
      groupEl = document.createElement("div");
      groupEl.className = "tuning-sliders__group-inner";
      section.appendChild(groupEl);
      tuningSlidersRoot.appendChild(section);
      groups.set(spec.group, groupEl);
    }

    const row = document.createElement("div");
    row.className = "tuning-slider";
    const label = document.createElement("button");
    label.className = "tuning-slider__label";
    label.type = "button";
    label.textContent = spec.label;
    const help = document.createElement("div");
    help.className = "tuning-slider__help";
    help.textContent = spec.help;
    help.hidden = true;
    const helpId = `tuning-help-${spec.key}`;
    help.id = helpId;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", helpId);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(sculptureTuning[spec.key]);
    input.dataset.tuningKey = spec.key;
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    row.append(label, input, valueLabel, help);
    groupEl.appendChild(row);

    tuningSliderInputs.set(spec.key, input);
    tuningSliderValueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      sculptureTuning[spec.key] = Number(input.value) as SculptureTuning[typeof spec.key];
      syncRuntimeTuning();
      speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
      valueLabel.textContent = sculptureTuning[spec.key].toFixed(3);
      refreshTuningExport();
      if (spec.scope === "live") {
        sculpture.applyLiveTuningNow();
      }
    });
  }

  resetTuningButton.addEventListener("click", () => {
    resetSculptureTuning();
    speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
    syncTuningSlidersFromState();
    sculpture.applyLiveTuningNow();
  });

  copyTuningButton.addEventListener("click", async () => {
    refreshTuningExport();
    const defaultLabel = copyTuningButton.textContent ?? "";
    try {
      await navigator.clipboard.writeText(tuningExportText.value);
      copyTuningButton.textContent = copyTuningButton.dataset.labelCopied ?? defaultLabel;
      copyTuningButton.classList.add("copied");
      window.setTimeout(() => {
        copyTuningButton.textContent = defaultLabel;
        copyTuningButton.classList.remove("copied");
      }, 1600);
    } catch {
      tuningExportText.focus();
      tuningExportText.select();
      setStatus(copyTuningButton.dataset.statusError ?? "");
    }
  });

  syncTuningSlidersFromState();
};

initTuningPanel();
updateKeyLight();
render();
