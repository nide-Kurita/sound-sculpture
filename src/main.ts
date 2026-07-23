import "./styles.scss";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
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
  getStructureFormationScale,
  type StructureSnapshot,
} from "./structure-tracker";
import {
  DEFAULT_SPECIES_PROFILE,
  SpeciesProfiler,
  speciesMorphTargets,
  type SpeciesProfile,
} from "./species-profile";
import { fib, fibRatio, fibUnit } from "./fibonacci";
import {
  GROWTH_ALGORITHM_CATALOG,
  getGrowthAlgoSilhouetteBias,
  getGrowthAlgorithmId,
  getGrowthAlgorithmMeta,
  growthFlow,
  growthModulateFromPattern,
  growthModulateScalar,
  growthModulateVector3,
  growthPattern,
  growthPlaceOnSphere,
  growthSpikeMask,
  isHeavyGrowthFlowAlgorithm,
  getHeavyGrowthFlowStride,
  getHeavyGrowthPatternStride,
  isHeavyGrowthPatternAlgorithm,
  parseGrowthAlgorithmId,
  setGrowthAlgorithmId,
  type GrowthAlgorithmId,
} from "./growth-algorithm";
import {
  clayStyleFromVisualCore,
  createClayColorShift,
  nudgeClayColorShift,
  resolveClayPalette,
} from "./clay-color";
import { AmoebaSculpture } from "./amoeba-sculpture";
import { CarveSculpture } from "./carve-sculpture";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  deriveAfterlifeMaterial,
  deriveSculpturePalette,
  NEUTRAL_SCULPTURE_PALETTE,
  type SculpturePalette,
} from "./audio-palette";
import {
  applyClickRepulsionToPositions,
  createClickRepulsionState,
  pokeClickRepulsion,
  resetClickRepulsionState,
  updateClickRepulsion,
} from "./click-repulsion";
import {
  EXPERIENCE_CATALOG,
  getActiveVisualStyle,
  getExperience,
  NEUTRAL_ENVIRONMENT,
  parseExperienceId,
  setActiveVisualStyle,
  type ExperienceId,
  type VisualStyleId,
} from "./visual-style";
import { SceneBackground } from "./scene-background";
import {
  formatAmPmFromHour,
  formatLocalAmPm,
  getLocalHourFraction,
  readDaytimeBackgroundEnabled,
  sampleDaytimeAtmosphere,
  sampleDaytimeAtmosphereFromHour,
  writeDaytimeBackgroundEnabled,
} from "./daytime-atmosphere";
import {
  applyCloudCoverToSky,
  createWeatherPreviewSnapshot,
  fetchLiveWeatherForUser,
  writeLiveWeatherEnabled,
  type LiveWeatherSnapshot,
  type WeatherPreviewPresetId,
} from "./live-weather";
import type { SceneWeatherState } from "./scene-background";
import {
  clamp01,
  seededUnit,
  SILENCE_SECONDS_TO_COMPLETE,
  PLAYBACK_END_SECONDS_TO_COMPLETE,
  SILENCE_THRESHOLD,
  smoothstep,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
  type SculptureMode,
} from "./sculpture-types";
import {
  buildDeterministicTimeline,
  hashBytesToMorphologySeed,
  sampleDeterministicFrame,
  type DeterministicAudioTimeline,
  type DeterministicSpectralFrame,
} from "./deterministic-audio";

type WaveformMetrics = {
  peak: number;
  rms: number;
  peakDelta: number;
  energyDelta: number;
};

type DeterministicSimStep = {
  bands: AudioBands;
  waveform: WaveformMetrics;
  deltaTime: number;
};

/** 曲内相対正規化の対象となる帯域キー */
type BandNormKey = "sub" | "low" | "mid" | "melody" | "high" | "overall";

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

/**
 * audio-scope 右端の水色バーと、オブジェクト周りの glow dust / sparkle が共有する駆動量 (0–1)。
 * waveEnergy（RMS）を主、wavePeak で瞬間の立ち上がりを足す。
 */
const scopeCyanDrive = (rhythm: RhythmEvents) =>
  clamp01(rhythm.waveEnergy * 0.82 + rhythm.wavePeak * 0.28);

const emptyBands = (): AudioBands => ({
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
});

let lastDisplayBands: AudioBands = emptyBands();

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

  private registerPulse(strength: number) {
    const now = this.elapsed;
    if (this.lastPulseTime > 0) {
      const interval = now - this.lastPulseTime;
      if (interval > fibUnit(3, 21) && interval < fibRatio(8, 3)) {
        this.pulseIntervals.push(interval);
        if (this.pulseIntervals.length > fib(5)) {
          this.pulseIntervals.shift();
        }
        const sortedIntervals = [...this.pulseIntervals].sort((a, b) => a - b);
        const middle = Math.floor(sortedIntervals.length / 2);
        const median =
          sortedIntervals.length % 2 === 0
            ? (sortedIntervals[middle - 1] + sortedIntervals[middle]) * 0.5
            : sortedIntervals[middle];
        const variance =
          this.pulseIntervals.reduce((sum, value) => sum + (value - median) ** 2, 0) /
          this.pulseIntervals.length;
        const cv = Math.sqrt(variance) / Math.max(fibUnit(2, 21), median);
        const sampleConfidence = clamp01((this.pulseIntervals.length - 1) / 3);
        this.pulseConfidence = clamp01(1 - cv * fibRatio(5, 3)) * sampleConfidence;
        this.expectedPulseInterval = median;

        // 倍テン・半テンを一般的な表示域へ正規化し、イベント単位で安定追従させる。
        // deltaTime を係数にすると0から延々と増え続けて見えるため使わない。
        if (this.pulseIntervals.length >= 3) {
          let estimatedBpm = 60 / median;
          while (estimatedBpm < 70) estimatedBpm *= 2;
          while (estimatedBpm > 180) estimatedBpm *= 0.5;
          this.bpm += (estimatedBpm - this.bpm) * (this.bpm <= 0 ? 1 : 0.22);
        }
      }
    }
    this.lastPulseTime = now;
    this.pulsePhase = 0;
    this.pulseIndex += 1;
    this.pulseEnvelope = Math.min(1, fibUnit(8, 9) + strength * fibRatio(8, 5));
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
      this.registerPulse(pulseStrength);
    } else if (this.expectedPulseInterval > fibUnit(3, 21)) {
      this.pulsePhase = Math.min(1, this.pulsePhase + deltaTime / this.expectedPulseInterval);
    }
    const pulseInterval = Math.max(fibUnit(3, 21), this.expectedPulseInterval);
    const decayRate = fib(5) / (pulseInterval * runtimeTuning.pulseHold);
    this.pulseEnvelope *= Math.exp(-deltaTime * (decayRate + (1 - this.pulseConfidence) * fibUnit(5, 8)));
    if (
      this.lastPulseTime > 0 &&
      this.elapsed - this.lastPulseTime > this.expectedPulseInterval * 2.5
    ) {
      this.pulseConfidence *= Math.exp(-deltaTime * 1.2);
    }

    if (beat > 0) {
      this.beatIndex += 1;
      this.lastBeat = 0;
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
  uniform float uPetrify;
  uniform float uVita;
  uniform float uBreath;
  uniform vec3 uPaletteColor;
  uniform vec3 uPaletteAccent;

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

    vec3 baseColor = uPaletteColor;
    vec3 electricBlue = uPaletteAccent;
    vec3 melodyGold = vec3(1.0, 0.82, 0.52);
    vec3 color = baseColor * 0.18;
    float idleDim = 0.4 + uLive * 0.6;
    color += electricBlue * (fresnel * (0.95 + uHigh * 1.35)) * idleDim;
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
    float alpha = uOpacity + fresnel * 0.11 * idleDim + melodyLines * 0.05 + microSignals * 0.05;
    alpha += hotVeins * uGlow * 0.08 + ember * uGlow * uHigh * 0.06;
    alpha += lineDrive * fresnel * uMelodyFresnel * 0.06;
    alpha *= mix(1.0, 0.58, frozen);

    // vita: 真珠光沢のイリデッセンス（生命スタイル）
    if (uVita > 0.5) {
      vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fresnel * 1.35 + vec3(0.02, 0.18, 0.52)) + flowTime * 0.3);
      vec3 pearl = irid * mix(vec3(1.0), uPaletteColor * 1.7, 0.55);
      color = mix(color, color * 0.35 + pearl * (0.4 + uBreath * 0.5), 0.68 * idleDim);
      alpha += (0.03 + fresnel * 0.11 + uBreath * fresnel * 0.09) * idleDim;
    }

    // petrify: 下から上へ結晶化が進む（変容スタイル）
    if (uPetrify > 0.001) {
      float h = clamp(vWorldPosition.y / 1.9, -1.0, 1.0);
      float front = uPetrify * 2.9 - 1.45;
      float crystal = smoothstep(h - 0.34, h + 0.1, front + surfaceNoise * 0.4);
      float facets = pow(noise(vWorldPosition * 12.5), 2.2);
      vec3 crystalColor =
        uPaletteColor * (0.35 + facets * 1.05) +
        uPaletteAccent * fresnel * 1.35 +
        vec3(1.0) * pow(facets, 3.0) * 0.65;
      color = mix(color, crystalColor, crystal);
      alpha = mix(alpha, 0.16 + fresnel * 0.3 + facets * 0.12, crystal);
    }

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
  /** ファイル内容から導出。同じ音源なら同じ形態シード */
  private morphologySeed: number | null = null;
  /** バッファ音源用の固定 hop スペクトル時系列 */
  private timeline: DeterministicAudioTimeline | null = null;
  private playbackStartAt = -1;
  private simTime = 0;
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
  /**
   * 曲内相対正規化用のランニングピーク。
   * 各帯域を「その曲の中でのピーク」で割ることで、ミックスバランスや
   * 再生音量の偏り（低音が強い曲・明るい曲・小さくマスタリングされた曲）を吸収し、
   * どの曲でも帯域ごとの役割が等しく形に現れるようにする。
   */
  private readonly bandPeakEma: Record<BandNormKey, number> = {
    sub: 0,
    low: 0,
    mid: 0,
    melody: 0,
    high: 0,
    overall: 0,
  };
  /** これ未満のピークでは割らない（無音・微小ノイズの増幅を防ぐ下限） */
  private static readonly BAND_NORM_FLOOR = 0.22;
  /** ピーク追従（速い）— 持続的な大音量に ~1 秒で追いつく */
  private static readonly BAND_NORM_ATTACK = 2.4;
  /** ピーク減衰（非常に遅い; 時定数 ~55 秒）— 曲全体のスケール感を保持する */
  private static readonly BAND_NORM_RELEASE = 1 / 55;
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
      this.morphologySeed = hashBytesToMorphologySeed(arrayBuffer);
      // decodeAudioData は arrayBuffer を切り離すので、先にシードを取る
      this.devAudioBuffer = await this.context!.decodeAudioData(arrayBuffer);
      this.devAudioUrl = audioUrl;
      this.timeline = buildDeterministicTimeline(this.devAudioBuffer);
    }

    this.resetAnalysisState();
    this.playDevBuffer();

    if (this.context!.state === "suspended") {
      await this.context!.resume();
    }
  }

  isUsingDevAudio() {
    return this.devAudioUrl !== null;
  }

  /** バッファ音源を決定論シミュレーションしているか */
  isDeterministic() {
    return this.timeline !== null && this.morphologySeed !== null;
  }

  getMorphologySeed() {
    return this.morphologySeed;
  }

  /**
   * 決定論タイムライン上で再生が終わったか。
   * wall clock ではなく simTime 基準（追いつき中に premature 完了しない）。
   */
  hasPlaybackEnded() {
    if (!this.timeline) {
      return false;
    }
    return this.simTime >= this.timeline.duration;
  }

  restartDevAudioIfActive() {
    if (!this.devAudioUrl || !this.devAudioBuffer) {
      return false;
    }
    this.resetAnalysisState();
    this.playDevBuffer();
    return true;
  }

  /**
   * 再生位置まで固定 hop でシミュレーションを進める。
   * 同じ音源・同じ開始から同じ入力列になる。
   */
  drainSimulationSteps(): DeterministicSimStep[] {
    if (!this.timeline || !this.context || this.playbackStartAt < 0) {
      return [];
    }

    const hop = this.timeline.hopSec;
    const target = Math.max(0, this.context.currentTime - this.playbackStartAt);
    const steps: DeterministicSimStep[] = [];
    const maxSteps = 180;

    while (this.simTime + hop <= target + 1e-9 && steps.length < maxSteps) {
      this.simTime += hop;
      const frame = sampleDeterministicFrame(this.timeline, this.simTime);
      steps.push({
        bands: this.bandsFromDeterministicFrame(frame, hop),
        waveform: this.waveformFromDeterministicFrame(frame),
        deltaTime: hop,
      });
    }

    return steps;
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
    const when = this.context.currentTime;
    source.start(when);
    this.playbackStartAt = when;
    this.simTime = 0;
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

  private clearDeterministicSession() {
    this.morphologySeed = null;
    this.timeline = null;
    this.playbackStartAt = -1;
    this.simTime = 0;
  }

  private initAnalyser() {
    this.disconnect();
    this.clearDeterministicSession();

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

    // 帯域ごとのノイズゲート（絶対値）→ 曲内相対正規化（曲のオブジェクト化）
    // centroid/bassFocus/brightness/contrast は元々スペクトル比率（相対値）なので正規化しない
    this.bands = {
      sub: this.normalizeBandBySongPeak("sub", smoothstep(0.02, 0.38, sub), deltaTime),
      low: this.normalizeBandBySongPeak("low", smoothstep(0.025, 0.42, low), deltaTime),
      mid: this.normalizeBandBySongPeak("mid", smoothstep(0.018, 0.34, mid), deltaTime),
      melody: this.normalizeBandBySongPeak("melody", smoothstep(0.006, 0.2, melody), deltaTime),
      high: this.normalizeBandBySongPeak("high", smoothstep(0.005, 0.14, high), deltaTime),
      overall: this.normalizeBandBySongPeak("overall", smoothstep(0.014, 0.36, overall), deltaTime),
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

  private bandsFromDeterministicFrame(frame: DeterministicSpectralFrame, deltaTime: number): AudioBands {
    this.bands = {
      sub: this.normalizeBandBySongPeak("sub", smoothstep(0.02, 0.38, frame.sub), deltaTime),
      low: this.normalizeBandBySongPeak("low", smoothstep(0.025, 0.42, frame.low), deltaTime),
      mid: this.normalizeBandBySongPeak("mid", smoothstep(0.018, 0.34, frame.mid), deltaTime),
      melody: this.normalizeBandBySongPeak("melody", smoothstep(0.006, 0.2, frame.melody), deltaTime),
      high: this.normalizeBandBySongPeak("high", smoothstep(0.005, 0.14, frame.high), deltaTime),
      overall: this.normalizeBandBySongPeak("overall", smoothstep(0.014, 0.36, frame.overall), deltaTime),
      centroid: frame.centroid,
      bassFocus: frame.bassFocus,
      melodyFocus: frame.melodyFocus,
      brightness: clamp01(frame.brightness),
      contrast: clamp01(frame.contrast),
    };
    this.updateProfile(this.bands, deltaTime);
    return this.bands;
  }

  private waveformFromDeterministicFrame(frame: DeterministicSpectralFrame): WaveformMetrics {
    const peak = frame.peak;
    const rms = frame.rms;
    const peakDelta = Math.max(0, peak - this.prevWavePeak);
    const energyDelta = Math.max(0, rms - this.prevWaveRms);
    this.prevWavePeak = peak;
    this.prevWaveRms = rms;
    return { peak, rms, peakDelta, energyDelta };
  }

  /**
   * ゲート済み帯域値を「その曲の中でのランニングピーク」で正規化する。
   * - ピークへの追従は速く（アタック）、減衰は非常に遅い（リリース）ので、
   *   曲の静かなパートは静かなまま、帯域間のスケール差だけが吸収される
   * - ピークが下限 (BAND_NORM_FLOOR) 未満の帯域はほぼ素通し — 存在しない帯域を
   *   ノイズから増幅してしまうことを防ぐ
   */
  private normalizeBandBySongPeak(key: BandNormKey, value: number, deltaTime: number) {
    const peak = this.bandPeakEma[key];
    const rate = value > peak ? AudioInput.BAND_NORM_ATTACK : AudioInput.BAND_NORM_RELEASE;
    this.bandPeakEma[key] = peak + (value - peak) * Math.min(1, deltaTime * rate);
    const denom = Math.max(AudioInput.BAND_NORM_FLOOR, this.bandPeakEma[key]);
    return clamp01(value / denom);
  }

  private resetBandNormalization() {
    this.bandPeakEma.sub = 0;
    this.bandPeakEma.low = 0;
    this.bandPeakEma.mid = 0;
    this.bandPeakEma.melody = 0;
    this.bandPeakEma.high = 0;
    this.bandPeakEma.overall = 0;
  }

  private resetProfile() {
    this.profile = createEmptyAudioProfile();
    this.resetBandNormalization();
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

class SoundSculpture {
  private static readonly maxParticles = 900;
  private static readonly maxGlowDust = 1400;
  private static readonly maxSparkles = 360;
  private static readonly maxDetachmentDustSand = 1200;
  private static readonly maxDetachmentDustMetal = 800;
  private static readonly maxDetachmentDustSpark = 600;
  /** 完成後の鼓動（呼吸）の全体的な強さ */
  private static readonly AFTERLIFE_BREATH_STRENGTH = 0.68;
  /** 完成後の鼓動（呼吸）のテンポ。1未満でゆっくり */
  private static readonly AFTERLIFE_BREATH_TEMPO = 0.2;
  /** 形成開始時の膜不透明度 — 中身の粘土が主役になるよう控えめに */
  private static readonly INITIAL_MEMBRANE_OPACITY = 0.1;

  /** プール済み Points の未使用頂点を描画しない（初期のゴミ粒対策） */
  private static parkPointsGeometry(geometry: THREE.BufferGeometry) {
    geometry.setDrawRange(0, 0);
  }

  private static unparkPointsGeometry(geometry: THREE.BufferGeometry, count: number) {
    geometry.setDrawRange(0, Math.max(0, count));
  }

  private parkInactivePointPools() {
    SoundSculpture.parkPointsGeometry(this.particleGeometry);
    SoundSculpture.parkPointsGeometry(this.sparkleGeometry);
    SoundSculpture.parkPointsGeometry(this.detachmentDustSandGeometry);
    SoundSculpture.parkPointsGeometry(this.detachmentDustMetalGeometry);
    SoundSculpture.parkPointsGeometry(this.detachmentDustSparkGeometry);
    this.detachmentDustSand.visible = false;
    this.detachmentDustMetal.visible = false;
    this.detachmentDustSpark.visible = false;
  }

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
  private readonly coreMaterial: THREE.MeshPhysicalMaterial;
  private readonly innerCoreMaterial: THREE.MeshPhysicalMaterial;
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
  /** 成長アルゴリズム固有の永続起伏（完成形の差を残す） */
  private readonly algoIdentity: Float32Array;
  private readonly liveOffset: Float32Array;
  private readonly surfaceLiveOffset: Float32Array;
  /** コア接触による膜の外向き圧力（頂点ごと） */
  private readonly membranePressure: Float32Array;
  private readonly membranePressureScratch: Float32Array;
  /** 膜メッシュの1-ring近傍（拡散用、-1 終端） */
  private readonly membraneNeighbors: Int32Array;
  private static readonly membraneNeighborCap = 8;
  /** 接触緊張の全体インパルス（シェーダ用 0..1） */
  private membranePressureImpulse = 0;
  /** 膜が粘土へ作用する同化量（頂点ごと 0..1） */
  private readonly clayAssimilation: Float32Array;
  /** 膜を突き抜けた量（頂点ごと — 半透明・発光用） */
  private readonly pierceAmount: Float32Array;
  /** 焼き込み時のコア頂点色（同化ブレンドの基準） */
  private readonly coreColorBase: Float32Array;
  private readonly baseCoreClearcoat: number;
  private readonly baseCoreSheen: number;
  private readonly baseCoreIridescence: number;
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
  /** スタイル基準 + クリックシフトの粘土色 — core / inner / 膜 / 頂点が共有 */
  private clayHueBase = 0.09;
  private claySatBase = 0.18;
  private clayLightBase = 0.78;
  private clayColorShift = createClayColorShift();
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
  /** 曲終了〜完成までの短い待ちで、形を動かさない */
  private shapeHold = false;
  private frozenTime = 0;
  private completeFadeOut = 1;
  /** 1→0: 完成直後の残存モーションを滑らかに止める */
  private completionSettle = 0;
  // --- ビジュアルスタイル（変容/生命/彫刻）と完成後の変化 ---
  private readonly style = getActiveVisualStyle();
  private completionProgress = 0;
  private completionPalette: SculpturePalette | null = null;
  private completionSpecies: SpeciesProfile | null = null;
  private breathTime = 0;
  private breathBpm = 64;
  private breathWave = 0;
  private readonly completionStartColor = new THREE.Color();
  private readonly completionStartInnerColor = new THREE.Color();
  private completionStartRoughness = 0.94;
  private readonly _tmpColor = new THREE.Color();
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
  // --- アイドル揺らぎ（vita: 無音・形成初期も成長アルゴリズムのパターンでホヨホヨ蠢く） ---
  /** formingTime と違い、音が無くても常に進む時計 */
  private idleTime = 0;
  private idleWobbleAmp = 0;
  private readonly idleWobbleField: Float32Array;
  /** vita アイドル揺らぎの接線方向成分（成長アルゴリズムの flow に則る） */
  private readonly idleWobbleVector: Float32Array;
  /** クリック・タッチで一瞬強まる揺らぎ（0→1 で減衰） */
  private idlePokeImpulse = 0;
  /** クリック位置の局所反発（完成後も有効） */
  private readonly clickRepulsion: ReturnType<typeof createClickRepulsionState>;
  private readonly surfaceClickRepulsion: ReturnType<typeof createClickRepulsionState>;
  /** 音入力が始まってから色・発光が追従する度合い（急な色変化を抑える） */
  private audioColorBlend = 0;
  /**
   * 大域変形の発達度 (0=未形成)。coral の定常ノイズなど「音に依らない起伏」を
   * これでゲートし、形成前・形成初期のシルエットを正円（真球）に保つ。
   */
  private formDevelopment = 0;

  constructor() {
    // Icosahedron + mergeVertices: 球面上の均質な頂点分布と滑らかな法線の両立
    this.geometry = createSculptureSphereGeometry(1.34);
    // core と重なると縁がチラつくので、少し外側へ
    this.surfaceGeometry = createSculptureSphereGeometry(1.46);

    const styleCore = this.style.core;

    this.coreMaterial = new THREE.MeshPhysicalMaterial({
      color: styleCore.pearlVariation > 0 ? 0xffffff : styleCore.color,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: styleCore.roughness,
      metalness: 0,
      flatShading: false,
      // surface(透明)との Z-fighting を避けて「隙間の線」を減らす
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    if (styleCore.sheen > 0) {
      this.coreMaterial.sheen = styleCore.sheen;
      this.coreMaterial.sheenColor.set(styleCore.sheenColor);
      this.coreMaterial.sheenRoughness = 0.55;
    }
    if (styleCore.iridescence > 0) {
      this.coreMaterial.iridescence = styleCore.iridescence;
      this.coreMaterial.iridescenceIOR = 1.5;
    }
    if (styleCore.clearcoat > 0) {
      this.coreMaterial.clearcoat = styleCore.clearcoat;
      this.coreMaterial.clearcoatRoughness = 0.35;
    }
    if (this.style.membrane.vita) {
      this.installCorePierceShader(this.coreMaterial);
    }

    // “粘土の中身”を感じるための内側の塊（突き抜け発光は載せない＝常に粘土質）
    this.innerCoreMaterial = new THREE.MeshPhysicalMaterial({
      color: CLAY_CORE_COLOR,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: Math.min(1, styleCore.roughness + 0.03),
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
        uOpacity: { value: SoundSculpture.INITIAL_MEMBRANE_OPACITY },
        uCompleted: { value: 0 },
        uPetrify: { value: 0 },
        uVita: { value: this.style.membrane.vita ? 1 : 0 },
        uBreath: { value: 0 },
        uPaletteColor: { value: new THREE.Color(0.52, 0.66, 0.82) },
        uPaletteAccent: { value: new THREE.Color(0.72, 0.78, 0.9) },
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
    // 自己影を受けない（回転で影が張り付いて急に暗くなるのを防ぐ）
    this.core.receiveShadow = false;
    this.innerCore.castShadow = true;
    this.innerCore.receiveShadow = false;
    // 内側は一回り小さくし、外側コアの突き抜け先端が前面に出るようにする
    this.innerCore.scale.setScalar(this.style.membrane.vita ? 0.9 : 1);
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
    const pointCircleMap = this.makeCircleTexture();
    this.particleMaterial = new THREE.PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: pointCircleMap,
      toneMapped: false,
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
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: pointCircleMap,
      toneMapped: false,
    });
    this.glowDust = new THREE.Points(this.glowDustGeometry, this.glowDustMaterial);
    this.glowDust.visible = false;
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
      map: pointCircleMap,
      toneMapped: false,
    });
    this.sparkles = new THREE.Points(this.sparkleGeometry, this.sparkleMaterial);

    const detachmentMap = pointCircleMap;

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
    this.detachmentDustSandColors.fill(0);
    this.detachmentDustMetalColors.fill(0);
    this.detachmentDustSparkColors.fill(0);
    this.particleColors.fill(0);
    this.sparkleColors.fill(0);
    this.sparkleLife.fill(0);
    this.detachmentDustSandLife.fill(0);
    this.detachmentDustMetalLife.fill(0);
    this.detachmentDustSparkLife.fill(0);

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

    // スタイルによる表示制御: monolith は膜も加算パーティクルも持たない純粋な彫刻
    this.surface.visible = this.style.membrane.visible;
    if (!this.style.particlesVisible) {
      this.particles.visible = false;
      this.glowDust.visible = false;
      this.sparkles.visible = false;
      this.detachmentDustSand.visible = false;
      this.detachmentDustMetal.visible = false;
      this.detachmentDustSpark.visible = false;
    }
    this.parkInactivePointPools();

    this.basePositions = new Float32Array(this.geometry.attributes.position.array);
    this.baseSurfacePositions = new Float32Array(this.surfaceGeometry.attributes.position.array);
    this.targetCoreMeanRadius = this.meanRadialLength(this.basePositions);
    this.targetSurfaceMeanRadius = this.meanRadialLength(this.baseSurfacePositions);
    this.accumulated = new Float32Array(this.geometry.attributes.position.count);
    this.midBumps = new Float32Array(this.accumulated.length);
    this.highSpikes = new Float32Array(this.accumulated.length);
    this.erosionField = new Float32Array(this.accumulated.length);
    this.sculptureMemory = new Float32Array(this.accumulated.length);
    this.algoIdentity = new Float32Array(this.accumulated.length);
    this.liveOffset = new Float32Array(this.accumulated.length);
    this.surfaceLiveOffset = new Float32Array(this.accumulated.length);
    this.membranePressure = new Float32Array(this.accumulated.length);
    this.membranePressureScratch = new Float32Array(this.accumulated.length);
    this.clayAssimilation = new Float32Array(this.accumulated.length);
    this.pierceAmount = new Float32Array(this.accumulated.length);
    this.geometry.setAttribute("aPierce", new THREE.BufferAttribute(this.pierceAmount, 1));
    this.coreColorBase = new Float32Array(this.accumulated.length * 3);
    this.membraneNeighbors = this.buildMembraneNeighbors(
      this.surfaceGeometry,
      this.accumulated.length,
    );
    this.vectorField = new Float32Array(this.accumulated.length * 3);
    this.flowField = new Float32Array(this.accumulated.length * 3);
    this.crystalAxes = new Float32Array(this.accumulated.length * 3);
    this.detachmentCarve = new Float32Array(this.accumulated.length);
    this.idleWobbleField = new Float32Array(this.accumulated.length);
    this.idleWobbleVector = new Float32Array(this.accumulated.length * 3);
    this.clickRepulsion = createClickRepulsionState(this.accumulated.length);
    this.surfaceClickRepulsion = createClickRepulsionState(this.accumulated.length);
    this.baseCoreClearcoat = styleCore.clearcoat;
    this.baseCoreSheen = styleCore.sheen;
    this.baseCoreIridescence = styleCore.iridescence;
    this.initCrystalAxes();
    this.initMorphology();
    this.syncClayColors();

    if (styleCore.pearlVariation > 0) {
      this.bakeCorePearlColors(styleCore.pearlVariation);
    } else {
      this.bakeCoreClayMottle(0.18);
    }
  }

  /**
   * vita 用: コアの頂点カラーに真珠の干渉色（青緑〜藤〜桃）のムラを焼き込む。
   * 単色の初期状態でも生命の質感が出る。マテリアルカラーと乗算される。
   */
  private bakeCorePearlColors(amount: number) {
    const position = this.geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      const p1 = growthPattern(nx * 1.3, ny * 1.3, nz * 1.3, this.morphologySeed + 4.2);
      const p2 = growthPattern(nx * 2.7, ny * 2.7, nz * 2.7, this.morphologySeed + 17.8);
      const p3 = growthPattern(nx * 0.85, ny * 1.15, nz * 0.95, this.morphologySeed + 31.4);
      const hue = (this.clayHueBase + p1 * 0.18 + p3 * 0.1 + ny * 0.05 + p2 * 0.04 + 1) % 1;
      const saturation = clamp01(
        this.claySatBase + (Math.abs(p2) * 0.32 + Math.abs(p3) * 0.14) * amount * 0.55,
      );
      const lightness = clamp01(
        this.clayLightBase + p1 * 0.12 * amount * 0.4 + p2 * 0.05 * amount + p3 * 0.03 * amount,
      );
      color.setHSL(hue, saturation, lightness);
      const idx = i * 3;
      colors[idx] = color.r;
      colors[idx + 1] = color.g;
      colors[idx + 2] = color.b;
    }
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.coreColorBase.set(colors);
    this.coreMaterial.vertexColors = true;
    this.coreMaterial.needsUpdate = true;
  }

  /** 変容・彫刻スタイル: 粘土表面にごく弱い色ムラを焼き込む */
  private bakeCoreClayMottle(amount: number) {
    const position = this.geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      const p1 = growthPattern(nx * 1.1, ny * 1.1, nz * 1.1, this.morphologySeed + 2.6);
      const p2 = growthPattern(nx * 2.4, ny * 2.4, nz * 2.4, this.morphologySeed + 13.1);
      const p3 = growthPattern(nx * 0.7, ny * 1.2, nz * 0.9, this.morphologySeed + 27.9);
      const hue = (this.clayHueBase + p1 * 0.09 + p3 * 0.05 + ny * 0.03 + 1) % 1;
      const saturation = clamp01(this.claySatBase + Math.abs(p2) * 0.12 * amount);
      const lightness = clamp01(this.clayLightBase + p1 * 0.05 * amount + p2 * 0.025 * amount);
      color.setHSL(hue, saturation, lightness);
      const idx = i * 3;
      colors[idx] = color.r;
      colors[idx + 1] = color.g;
      colors[idx + 2] = color.b;
    }
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.coreColorBase.set(colors);
    this.coreMaterial.vertexColors = true;
    this.coreMaterial.color.set(0xffffff);
    this.coreMaterial.needsUpdate = true;
  }

  private applyMembraneClayPalette(palette: { hue: number; sat: number; light: number }) {
    const base = new THREE.Color().setHSL(
      palette.hue,
      Math.min(0.42, palette.sat * 0.85),
      Math.min(0.72, palette.light * 0.94),
    );
    const accent = new THREE.Color().setHSL(
      (palette.hue + 0.08 + 1) % 1,
      Math.min(0.48, palette.sat * 0.95),
      Math.min(0.68, palette.light * 0.88),
    );
    (this.surfaceMaterial.uniforms.uPaletteColor.value as THREE.Color).copy(base);
    (this.surfaceMaterial.uniforms.uPaletteAccent.value as THREE.Color).copy(accent);
  }

  private rebakeCoreClayColors() {
    const st = this.style.core;
    if (st.pearlVariation > 0) {
      this.bakeCorePearlColors(st.pearlVariation);
      return;
    }
    this.bakeCoreClayMottle(0.18);
  }

  /** スタイル基準 + クリックシフトで粘土・膜の色を一括同期 */
  private syncClayColors() {
    const st = this.style.core;
    const palette = resolveClayPalette(clayStyleFromVisualCore(st), this.clayColorShift);
    this.clayHueBase = palette.hue;
    this.claySatBase = palette.sat;
    this.clayLightBase = palette.light;

    this.innerCoreMaterial.color.setHex(palette.innerHex);

    if (st.pearlVariation > 0) {
      this.coreMaterial.color.set(0xffffff);
    } else {
      this.coreMaterial.color.setHex(palette.surfaceHex);
      this.targetCoreColor.setHex(palette.surfaceHex);
    }

    if (this.style.membrane.visible) {
      this.applyMembraneClayPalette(palette);
    }
  }

  nudgeClayColorOnClick() {
    this.clayColorShift = nudgeClayColorShift(this.clayColorShift);
    this.syncClayColors();
    this.rebakeCoreClayColors();
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
    // AdditiveBlending 向け: 縁は黒（透明白だと四角が残る）
    gradient.addColorStop(0, "rgb(255,255,255)");
    gradient.addColorStop(0.35, "rgb(255,255,255)");
    gradient.addColorStop(1, "rgb(0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
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

  private initMorphology(seed?: number) {
    this.morphologySeed = seed ?? Math.random() * 1000;
    this.idleTime = seededUnit(0, this.morphologySeed + 0.71) * 30;
    const axis = growthPlaceOnSphere(0, 1, this.morphologySeed);
    this.morphAxis.set(axis.x, axis.y, axis.z);
    this.waistCenterAlong = (seededUnit(2, this.morphologySeed + 9.1) - 0.5) * 0.5;

    this.morphWeights = {
      diabolo: 0.14 + seededUnit(3, this.morphologySeed) * 0.28,
      torus: 0.14 + seededUnit(4, this.morphologySeed) * 0.28,
      monolith: 0.14 + seededUnit(5, this.morphologySeed) * 0.28,
      coral: 0.14 + seededUnit(6, this.morphologySeed) * 0.28,
      spindle: 0.14 + seededUnit(7, this.morphologySeed) * 0.28,
    };
    this.applyAlgoMorphBias();
  }

  /** 成長アルゴリズムに応じて大域シルエットの偏りを乗せる */
  applyAlgoMorphBias() {
    const bias = getGrowthAlgoSilhouetteBias(getGrowthAlgorithmId());
    this.morphWeights.diabolo *= bias.diabolo;
    this.morphWeights.torus *= bias.torus;
    this.morphWeights.monolith *= bias.monolith;
    this.morphWeights.coral *= bias.coral;
    this.morphWeights.spindle *= bias.spindle;
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
    return getStructureFormationScale(this.currentStructure);
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
    const speciesConfidence = sp.confidence;
    const lerp = Math.min(1, deltaTime * (0.45 + speciesConfidence * 0.4));
    const targetAxis = this.getAudioCarveAxis(0, bands);
    this.morphAxis.lerp(targetAxis, lerp * 0.18).normalize();

    const organic = sp.organic;
    const mineral = sp.aggressive;
    const rhythmic = sp.rhythmic;
    const overallBlend = bands.overall;
    const bandWeights: MorphWeights = {
      diabolo: fibUnit(3, 21) + overallBlend * fibUnit(5, 21) + organic * fibUnit(8, 21),
      torus: fibUnit(2, 21) + overallBlend * fibUnit(5, 21) + mineral * fibUnit(5, 21) + rhythmic * fibUnit(8, 21),
      monolith: fibUnit(5, 21) + overallBlend * fibUnit(8, 21) + mineral * fibUnit(8, 21),
      coral: fibUnit(5, 21) + organic * fibUnit(13, 21) + bands.contrast * fibUnit(5, 21),
      spindle: fibUnit(3, 21) + bands.brightness * fibUnit(8, 21) + mineral * fibUnit(8, 21) + s.tension * fibUnit(5, 21),
    };

    const speciesTarget = speciesMorphTargets(sp);
    const bandBlend = fibUnit(3, 13);
    const liveOverallBlend = bands.overall * bandBlend;
    const speciesWeights: MorphWeights = {
      diabolo:
        speciesTarget.diabolo * (1 - bandBlend) +
        (fibUnit(3, 21) + liveOverallBlend * fibUnit(5, 21)) * bandBlend,
      torus:
        speciesTarget.torus * (1 - bandBlend) +
        (fibUnit(2, 21) + liveOverallBlend * fibUnit(5, 21)) * bandBlend,
      monolith:
        speciesTarget.monolith * (1 - bandBlend) +
        (fibUnit(5, 21) + liveOverallBlend * fibUnit(8, 21)) * bandBlend,
      coral:
        speciesTarget.coral * (1 - bandBlend) +
        (fibUnit(5, 21) + bands.contrast * fibUnit(5, 21)) * bandBlend,
      spindle:
        speciesTarget.spindle * (1 - bandBlend) +
        (fibUnit(3, 21) + bands.brightness * fibUnit(8, 21)) * bandBlend,
    };

    const c = speciesConfidence;
    const targetWeights: MorphWeights = {
      diabolo: speciesWeights.diabolo * c + bandWeights.diabolo * (1 - c),
      torus: speciesWeights.torus * c + bandWeights.torus * (1 - c),
      monolith: speciesWeights.monolith * c + bandWeights.monolith * (1 - c),
      coral: speciesWeights.coral * c + bandWeights.coral * (1 - c),
      spindle: speciesWeights.spindle * c + bandWeights.spindle * (1 - c),
    };
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

    // アルゴリズム差を大域シルエットにも残す
    const algoBias = getGrowthAlgoSilhouetteBias();
    targetWeights.diabolo *= algoBias.diabolo;
    targetWeights.torus *= algoBias.torus;
    targetWeights.monolith *= algoBias.monolith;
    targetWeights.coral *= algoBias.coral;
    targetWeights.spindle *= algoBias.spindle;
    const biasedSum =
      targetWeights.diabolo +
      targetWeights.torus +
      targetWeights.monolith +
      targetWeights.coral +
      targetWeights.spindle;
    const biasedInv = 1 / Math.max(0.0001, biasedSum);
    targetWeights.diabolo *= biasedInv;
    targetWeights.torus *= biasedInv;
    targetWeights.monolith *= biasedInv;
    targetWeights.coral *= biasedInv;
    targetWeights.spindle *= biasedInv;

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

  /** 頂点変形の salt — 成長アルゴリズム変調用 */
  private vertexDeformSalt(vertexIndex: number, extra = 0) {
    return this.morphologySeed + this.formingTime * 0.31 + vertexIndex * 0.0037 + extra;
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
    const total = this.accumulated.length;
    for (let i = 0; i < total; i += 1) {
      const idx = i * 3;
      const axis = growthPlaceOnSphere(i, total, 1.71 + this.morphologySeed * 0.001);
      this.crystalAxes[idx] = axis.x;
      this.crystalAxes[idx + 1] = axis.y;
      this.crystalAxes[idx + 2] = axis.z;
    }
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    _userViewInteracting = false,
    _rhythm?: RhythmEvents,
    structure: StructureSnapshot = latestStructure,
    species: SpeciesProfile = speciesProfiler.getProfile(),
  ) {
    this.lastBands = bands;
    this.currentStructure = structure;
    this.speciesProfile = species;

    // 曲終了直後〜完成まで: 形を凍結したまま描画だけ更新
    if (this.shapeHold && !this.completed) {
      this.updateCoreGeometry(bands, deltaTime);
      if (this.surface.visible) {
        this.updateSurfaceGeometry(bands, deltaTime);
      }
      return;
    }

    const activity = this.completed ? 0 : smoothstep(SILENCE_THRESHOLD, 0.22, bands.overall);
    const timeAdvance = this.completed ? 0 : deltaTime * activity;
    if (!this.completed) {
      this.formingTime += timeAdvance;
    }
    this.idleTime += deltaTime;
    if (!this.completed && this.style.idleWobble > 0) {
      const activityTarget = smoothstep(SILENCE_THRESHOLD, 0.22, bands.overall);
      this.audioColorBlend += (activityTarget - this.audioColorBlend) * Math.min(1, deltaTime * 0.55);
    }
    this.updateIdleWobble(activity, deltaTime);
    updateClickRepulsion(this.clickRepulsion, deltaTime);
    updateClickRepulsion(this.surfaceClickRepulsion, deltaTime);

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
    if (this.surface.visible) {
      this.updateSurfaceGeometry(bands, deltaTime);
    }
    if (!this.completed) {
      this.maybeSpawnDetachedFragment(bands, deltaTime);
      this.updateSeparationTendency(bands, deltaTime);
    }
    this.updateDetachedFragments(bands, deltaTime);
    if (this.style.particlesVisible) {
      this.updateDetachmentDust(bands, deltaTime);
      this.updateGlowDust(bands, deltaTime);
      this.updateSparkles(bands, deltaTime);
      this.updateParticles(bands, deltaTime);
    }

    const innerBase = this.style.membrane.vita ? 0.9 : 1;
    if (!this.completed) {
      const pulseFloor = runtimeTuning.pulseConfidenceFloor;
      const syncPulse =
        latestRhythm.pulseEnvelope * (pulseFloor + latestRhythm.pulseConfidence * (1 - pulseFloor));
      const kickPulse =
        1 + Math.max(this.kickImpulse, syncPulse) * fibUnit(8, 13) * runtimeTuning.liveLow;
      this.innerCore.scale.setScalar(innerBase * kickPulse);
      this.applyRhythmImpulses(deltaTime, bands);
    } else {
      this.updateAfterlife(deltaTime);
    }
  }

  /** vita: クリック・タップで生命体がホヨッと反応する（完成後も有効） */
  pokeIdle() {
    if (this.style.idleWobble <= 0) {
      return;
    }
    this.idlePokeImpulse = 1;
  }

  private hasActiveClickWobble() {
    return this.idlePokeImpulse > 0.01 || this.idleWobbleAmp > 0.001;
  }

  getPointerTargets() {
    const targets: THREE.Object3D[] = [this.core, this.innerCore];
    if (this.surface.visible) {
      targets.push(this.surface);
    }
    return targets;
  }

  pokeSurface(localPoint: THREE.Vector3) {
    pokeClickRepulsion(this.clickRepulsion, this.basePositions, localPoint);
    if (this.surface.visible) {
      pokeClickRepulsion(this.surfaceClickRepulsion, this.baseSurfacePositions, localPoint, 0.1, 0.52);
    }
    this.nudgeClayColorOnClick();
  }

  /**
   * アイドル揺らぎ: 音が無くても成長アルゴリズムのパターンに則って
   * 表面がホヨホヨと蠢く（vita 用）。音が鳴るほど・形成が進むほど控えめになり、
   * 音による本来の変形が主役になる。
   */
  private updateIdleWobble(activity: number, deltaTime: number) {
    const gain = this.style.idleWobble;
    if (gain <= 0) {
      return;
    }

    this.idlePokeImpulse *= Math.exp(-6.2 * deltaTime);
    const pokeBoost = this.idlePokeImpulse * 0.42;

    const targetAmp = this.completed
      ? gain * (pokeBoost + this.completionSettle * 0.045)
      : gain *
        (0.072 + pokeBoost) *
        (1 - activity * 0.38) *
        (1 - this.currentStructure.formationRamp * 0.5);
    const ampFollow = this.completed ? 1.1 : 2.2;
    this.idleWobbleAmp += (targetAmp - this.idleWobbleAmp) * Math.min(1, deltaTime * ampFollow);

    if (this.idleWobbleAmp < 0.001 && this.idlePokeImpulse < 0.01) {
      this.idleWobbleField.fill(0);
      this.idleWobbleVector.fill(0);
      return;
    }

    const slow = this.idleTime * 0.32;
    const fast = this.idleTime * 0.58 + 13.7;
    const flowSalt = this.morphologySeed + slow * 0.55;
    const heavyFlow = isHeavyGrowthFlowAlgorithm();
    const heavyPattern = isHeavyGrowthPatternAlgorithm();
    // 重い flow/pattern は頂点を間引き更新（見た目はほぼ同じで負荷低減）
    const flowStride = getHeavyGrowthFlowStride();
    const flowPhase = heavyFlow ? (Math.floor(this.idleTime * 30) % flowStride) : 0;
    const patternStride = getHeavyGrowthPatternStride();
    const patternPhase = heavyPattern ? (Math.floor(this.idleTime * 22) % patternStride) : 0;
    for (let i = 0; i < this.idleWobbleField.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      if ((i + patternPhase) % patternStride === 0) {
        // 低周波中心。第3オクターブは負荷の割に効きが薄いので省略
        const wave =
          growthPattern(nx * 0.75, ny * 0.75, nz * 0.75, slow) * 0.78 +
          growthPattern(nx * 1.35, ny * 1.35, nz * 1.35, fast) * 0.22;
        this.idleWobbleField[i] = wave * this.idleWobbleAmp;
      }
      if ((i + flowPhase) % flowStride !== 0) {
        continue;
      }
      growthFlow(nx * 1.1, ny * 1.1, nz * 1.1, flowSalt + i * 0.003, this._curlOut);
      const flowAmp = this.idleWobbleAmp * 0.18;
      this.idleWobbleVector[index] = this._curlOut.x * flowAmp;
      this.idleWobbleVector[index + 1] = this._curlOut.y * flowAmp;
      this.idleWobbleVector[index + 2] = this._curlOut.z * flowAmp;
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

    const shake = Math.max(this.hatImpulse, this.waveImpulse * 0.5) * s.detailRamp;
    if (
      shake > 0.001 &&
      s.phase === "metamorphosis" &&
      latestRhythm.pulseConfidence > 0.45
    ) {
      const amount = shake * deltaTime * 0.1;
      const salt = this.formingTime * 3.2 + this.morphologySeed;
      const flowStride = getHeavyGrowthFlowStride();
      const flowPhase = Math.floor(this.formingTime * 20) % flowStride;
      for (let i = 0; i < this.accumulated.length; i += 1) {
        if ((i + flowPhase) % flowStride !== 0) {
          continue;
        }
        const idx = i * 3;
        const bx = this.basePositions[idx];
        const by = this.basePositions[idx + 1];
        const bz = this.basePositions[idx + 2];
        growthFlow(bx * 2.8, by * 2.8, bz * 2.8, salt, this._curlOut);
        const boost = flowStride;
        this.flowField[idx] += this._curlOut.x * amount * boost;
        this.flowField[idx + 1] += this._curlOut.y * amount * boost;
        this.flowField[idx + 2] += this._curlOut.z * amount * boost;
      }
    }
  }

  /** 完成直前に、録音音声から導出したパレットと種プロファイルを受け取る */
  prepareCompletion(palette: SculpturePalette, species?: SpeciesProfile) {
    this.completionPalette = palette;
    this.completionSpecies = species ?? null;
    if (species) {
      this.speciesProfile = species;
    }
  }

  /** 曲終了後、完成確定までのあいだ形を動かさない */
  holdShapeForCompletion() {
    if (this.completed || this.shapeHold) {
      return;
    }
    this.shapeHold = true;
    // 振幅だけ止める。場の値は最終フレームのまま残して形を維持する
    this.idleWobbleAmp = 0;
    this.idlePokeImpulse = 0;
  }

  complete() {
    // 永久レイヤーは shapeHold 時点で止まっている。ハード焼き込みはしない（形が変わらない）
    this.bakeFinalSculptureMemory();
    // 膜シェーダーの uTime と連続になるよう、アイドル分も含めて凍結する
    this.frozenTime =
      this.formingTime + (this.style.idleWobble > 0 ? this.idleTime * 0.3 : 0);
    this.completeFadeOut = 1;
    this.completed = true;
    this.shapeHold = false;
    this.completionProgress = 0;
    this.completionSettle = 0;
    this.breathTime = 0;
    this.breathWave = 0;
    const bpm = latestRhythm.bpm;
    this.breathBpm = bpm > 30 && bpm < 200 ? Math.min(150, Math.max(44, bpm)) : 64;
    this.completionStartColor.copy(this.coreMaterial.color);
    this.completionStartInnerColor.copy(this.innerCoreMaterial.color);
    this.completionStartRoughness = this.coreMaterial.roughness;
    // ライブ／フロー／膜圧はゼロにせず、最終フレームの値で固定する
    this.idleWobbleAmp = 0;
    this.idlePokeImpulse = 0;
    this.kickImpulse = 0;
    this.snareImpulse = 0;
    this.hatImpulse = 0;
    this.waveImpulse = 0;
    this.membranePressureImpulse = 0;
    const palette = this.completionPalette ?? NEUTRAL_SCULPTURE_PALETTE;
    const uniforms = this.surfaceMaterial.uniforms;
    // vita: 膜も音パレットの暖色へ飛ばさず、初期の寒色パレットを維持
    if (!(this.style.completion.mode === "breathe" && this.style.core.pearlVariation > 0)) {
      (uniforms.uPaletteColor.value as THREE.Color).copy(palette.baseColor);
      (uniforms.uPaletteAccent.value as THREE.Color).copy(palette.accentColor);
    }
  }

  /**
   * 完成後の毎フレーム更新 — スタイルごとの「その後」。
   * - petrify:  数秒かけて粘土が鉱物へ変わり、膜が結晶化する
   * - breathe:  録音した鼓動(BPM)を記憶して呼吸を続ける
   * - monolith: 音のプロファイルが決めた素材（大理石〜ブロンズ〜黒曜石）が現れる
   */
  private updateAfterlife(deltaTime: number) {
    const st = this.style;
    const palette = this.completionPalette ?? NEUTRAL_SCULPTURE_PALETTE;
    const species = this.completionSpecies ?? this.speciesProfile;
    const afterlife = deriveAfterlifeMaterial(palette, species);
    this.completionProgress = Math.min(
      1,
      this.completionProgress + deltaTime / Math.max(0.001, st.completion.seconds),
    );
    const p = this.completionProgress;
    const ease = p * p * (3 - 2 * p);

    // 形状は complete() で確定済み。ここではマテリアル／呼吸のみ
    this.completionSettle = 0;
    this.kickImpulse *= Math.exp(-deltaTime * 3.2);
    this.snareImpulse *= Math.exp(-deltaTime * 3.6);
    this.hatImpulse *= Math.exp(-deltaTime * 4.2);
    this.waveImpulse *= Math.exp(-deltaTime * 3.8);

    const innerBase = st.membrane.vita ? 0.9 : 1;
    const scaleFollow = Math.min(1, deltaTime * 2.2);

    switch (st.completion.mode) {
      case "petrify": {
        this._tmpColor.setHSL(
          palette.hue,
          Math.min(0.95, palette.saturation * 0.72 * afterlife.saturationMul),
          Math.min(0.62, palette.lightness * 0.82),
        );
        this.coreMaterial.color.copy(this.completionStartColor).lerp(this._tmpColor, ease);
        this._tmpColor.setHSL(
          palette.hue,
          Math.min(0.95, palette.saturation * 0.6 * afterlife.saturationMul),
          Math.min(0.5, palette.lightness * 0.6),
        );
        this.innerCoreMaterial.color
          .copy(this.completionStartInnerColor)
          .lerp(this._tmpColor, ease);
        this.coreMaterial.roughness =
          this.completionStartRoughness +
          (palette.roughness * afterlife.roughnessMul - this.completionStartRoughness) * ease;
        this.coreMaterial.metalness =
          palette.metalness * 0.35 * afterlife.metalnessMul * ease;
        this.coreMaterial.clearcoat = 0.35 * afterlife.clearcoatMul * ease;
        const surge = Math.sin(Math.PI * ease);
        this.coreMaterial.emissive.copy(palette.emissiveColor);
        this.coreMaterial.emissiveIntensity =
          (surge * surge * 0.85 * palette.emissiveStrength +
            ease * 0.07 * palette.emissiveStrength) *
          afterlife.emissiveMul;
        this.surfaceMaterial.uniforms.uPetrify.value =
          ease * afterlife.petrifyBoost;
        this.group.scale.lerp(this.baseScale, scaleFollow);
        this.innerCore.scale.setScalar(
          THREE.MathUtils.lerp(this.innerCore.scale.x, innerBase, scaleFollow),
        );
        break;
      }
      case "breathe": {
        this.breathTime += deltaTime;
        this.frozenTime += deltaTime * 0.35;
        const beat =
          (this.breathBpm / 60) * Math.PI * SoundSculpture.AFTERLIFE_BREATH_TEMPO;
        const wave =
          (Math.sin(this.breathTime * beat) * 0.6 +
            Math.sin(this.breathTime * beat * 0.5 + 1.7) * 0.4) *
          afterlife.breathAmp *
          SoundSculpture.AFTERLIFE_BREATH_STRENGTH;
        this.breathWave = wave * 0.5 + 0.5;
        const swell = 1 + wave * 0.016 * (0.6 + palette.energy * 0.7);
        // 完成直前のスケールから呼吸へ滑らかに乗り換える
        this.group.scale.x += (this.baseScale.x * swell - this.group.scale.x) * scaleFollow;
        this.group.scale.y += (this.baseScale.y * (2 - swell) - this.group.scale.y) * scaleFollow;
        this.group.scale.z += (this.baseScale.z * swell - this.group.scale.z) * scaleFollow;
        const innerTarget = innerBase * (1 + this.breathWave * 0.05 * afterlife.breathAmp);
        this.innerCore.scale.setScalar(
          THREE.MathUtils.lerp(this.innerCore.scale.x, innerTarget, scaleFollow),
        );
        if (st.core.pearlVariation > 0) {
          // vita: 真珠頂点色を主体に保つ。音パレット（琥珀〜金など）へ寄せない
          this.coreMaterial.color.set(0xffffff);
          this.innerCoreMaterial.color.copy(this.completionStartInnerColor);
          // 発光だけ、初期の寒色寄り＋音の記憶をわずかに混ぜて鼓動する
          this._tmpColor.setHSL(
            THREE.MathUtils.lerp(this.clayHueBase, palette.hue, 0.22),
            Math.min(0.72, this.claySatBase * 0.9 + palette.saturation * 0.25),
            0.22 + this.breathWave * 0.08,
          );
          this.coreMaterial.emissive.lerp(this._tmpColor, Math.min(1, deltaTime * 2.4));
          this.coreMaterial.emissiveIntensity =
            (0.14 + this.breathWave * 0.28 + palette.emissiveStrength * 0.12 * ease) *
            afterlife.emissiveMul *
            st.core.emissiveScale;
        } else {
          this._tmpColor.setHSL(
            palette.hue,
            Math.min(0.9, palette.saturation * 1.15 * afterlife.saturationMul),
            Math.min(0.6, palette.lightness),
          );
          this.coreMaterial.color.copy(this.completionStartColor).lerp(this._tmpColor, ease);
          this.coreMaterial.emissive.copy(palette.emissiveColor);
          this.coreMaterial.emissiveIntensity =
            palette.emissiveStrength * (0.22 + this.breathWave * 0.35) * afterlife.emissiveMul;
        }
        this.surfaceMaterial.uniforms.uBreath.value = this.breathWave;
        break;
      }
      case "monolith": {
        const metal = palette.metalness * afterlife.metalnessMul;
        this._tmpColor.setHSL(
          palette.hue,
          palette.saturation * (0.22 + metal * 0.4) * afterlife.saturationMul,
          0.62 - metal * 0.47,
        );
        this.coreMaterial.color.copy(this.completionStartColor).lerp(this._tmpColor, ease);
        this._tmpColor.multiplyScalar(0.72);
        this.innerCoreMaterial.color
          .copy(this.completionStartInnerColor)
          .lerp(this._tmpColor, ease);
        this.coreMaterial.roughness =
          this.completionStartRoughness +
          (0.42 * afterlife.roughnessMul - metal * 0.16 - this.completionStartRoughness) * ease;
        this.coreMaterial.metalness = metal * ease;
        this.coreMaterial.clearcoat = (0.3 + (1 - metal) * 0.3) * afterlife.clearcoatMul * ease;
        this.coreMaterial.emissiveIntensity *= Math.max(0, 1 - deltaTime * 2);
        this.group.scale.lerp(this.baseScale, scaleFollow);
        this.innerCore.scale.setScalar(
          THREE.MathUtils.lerp(this.innerCore.scale.x, innerBase, scaleFollow),
        );
        break;
      }
    }
  }

  /**
   * 完了時フック。永久メモリはすでに追従済みなので触らない
   * （ハード再計算するとライブ層との合計が変わり、形がずれる）。
   */
  private bakeFinalSculptureMemory() {
    // no-op: live / flow / membrane を最終値のまま描画し続ける
  }

  /** 形状・粒子・分裂体を初期化（音入力は維持）。 */
  reset(seed?: number) {
    this.completed = false;
    this.shapeHold = false;
    this.frozenTime = 0;
    this.completeFadeOut = 1;
    this.completionProgress = 0;
    this.completionSettle = 0;
    this.completionPalette = null;
    this.completionSpecies = null;
    this.breathTime = 0;
    this.breathWave = 0;
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
    this.formDevelopment = 0;
    this.idleWobbleAmp = 0;
    this.idlePokeImpulse = 0;
    this.audioColorBlend = 0;
    this.clayColorShift = createClayColorShift();
    this.idleWobbleField.fill(0);
    this.idleWobbleVector.fill(0);
    resetClickRepulsionState(this.clickRepulsion);
    resetClickRepulsionState(this.surfaceClickRepulsion);
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
    this.algoIdentity.fill(0);
    this.liveOffset.fill(0);
    this.surfaceLiveOffset.fill(0);
    this.membranePressure.fill(0);
    this.membranePressureScratch.fill(0);
    this.membranePressureImpulse = 0;
    this.clayAssimilation.fill(0);
    this.pierceAmount.fill(0);
    const pierceAttrReset = this.geometry.getAttribute("aPierce");
    if (pierceAttrReset) {
      pierceAttrReset.needsUpdate = true;
    }
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

    this.parkInactivePointPools();
    this.glowDust.visible = false;
    this.glowDustMaterial.opacity = 0;

    this.group.quaternion.identity();
    this.group.rotation.set(0, 0, 0);
    this.group.scale.copy(this.baseScale);
    this.innerCore.scale.setScalar(1);

    this.initMorphology(seed);
    this.initCrystalAxes();

    const corePos = this.geometry.attributes.position.array as Float32Array;
    corePos.set(this.basePositions);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();

    const surfPos = this.surfaceGeometry.attributes.position.array as Float32Array;
    surfPos.set(this.baseSurfacePositions);
    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();

    const styleCore = this.style.core;
    this.syncClayColors();
    this.coreMaterial.roughness = styleCore.roughness;
    this.coreMaterial.metalness = 0;
    this.coreMaterial.clearcoat = styleCore.clearcoat;
    this.coreMaterial.emissive.set(0x000000);
    this.coreMaterial.emissiveIntensity = 0;
    this.innerCoreMaterial.roughness = Math.min(1, styleCore.roughness + 0.03);
    this.innerCoreMaterial.emissive.set(0x000000);
    this.innerCoreMaterial.emissiveIntensity = 0;

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uCompleted.value = 0;
    uniforms.uLive.value = 0;
    uniforms.uMelody.value = 0;
    uniforms.uGlow.value = 0;
    uniforms.uOpacity.value = SoundSculpture.INITIAL_MEMBRANE_OPACITY;
    uniforms.uPetrify.value = 0;
    uniforms.uBreath.value = 0;

    if (styleCore.pearlVariation > 0) {
      this.bakeCorePearlColors(styleCore.pearlVariation);
    } else {
      this.coreMaterial.vertexColors = false;
      this.geometry.deleteAttribute("color");
      this.bakeCoreClayMottle(0.18);
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
    const points =
      kind === "spark" ? this.detachmentDustSpark : kind === "metal" ? this.detachmentDustMetal : this.detachmentDustSand;
    const geometry =
      kind === "spark" ? this.detachmentDustSparkGeometry : kind === "metal" ? this.detachmentDustMetalGeometry : this.detachmentDustSandGeometry;

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

    if (this.style.particlesVisible) {
      points.visible = true;
      SoundSculpture.unparkPointsGeometry(geometry, max);
    }
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
    const points =
      kind === "spark" ? this.detachmentDustSpark : kind === "metal" ? this.detachmentDustMetal : this.detachmentDustSand;

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

      growthFlow(px * curlScale, py * curlScale, pz * curlScale, this.morphologySeed + drift, this._curlOut);
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

    let anyAlive = false;
    for (let i = 0; i < max; i += 1) {
      if (life[i] > 0) {
        anyAlive = true;
        break;
      }
    }
    if (anyAlive && this.style.particlesVisible) {
      points.visible = true;
      SoundSculpture.unparkPointsGeometry(geometry, max);
    } else {
      points.visible = false;
      SoundSculpture.parkPointsGeometry(geometry);
    }

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
        roughness: this.coreMaterial.roughness,
        metalness: this.coreMaterial.metalness,
        vertexColors: this.coreMaterial.vertexColors,
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

    exportGroup.add(core, innerCore);

    if (this.surface.visible) {
      const palette = this.completionPalette ?? NEUTRAL_SCULPTURE_PALETTE;
      const surface = new THREE.Mesh(
        this.surfaceGeometry.clone(),
        new THREE.MeshStandardMaterial({
          name: "Frozen digital surface",
          color: palette.baseColor.clone(),
          emissive: palette.emissiveColor.clone(),
          emissiveIntensity: 0.12,
          roughness: 0.34,
          metalness: 0.04,
          transparent: true,
          opacity: 0.32,
        }),
      );
      surface.name = "Digital surface";
      exportGroup.add(surface);
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
    const st = this.style.core;
    const shift = t.coreColorShift * st.shiftScale;
    const audioBlend = st.pearlVariation > 0 ? this.audioColorBlend : 1;
    // vita: 無音時も色相がゆっくり漂い、生きている印象を保つ
    const idleHueDrift =
      this.style.idleWobble > 0
        ? Math.sin(this.idleTime * 0.21) * 0.03 + Math.sin(this.idleTime * 0.047 + 1.7) * 0.02
        : 0;
    const hue =
      this.clayHueBase +
      idleHueDrift +
      bands.mid * 0.08 * shift * audioBlend +
      bands.melody * t.coreColorShift * st.shiftScale * audioBlend +
      bands.brightness * 0.48 * shift * audioBlend;
    const saturation =
      this.claySatBase + (bands.contrast * 0.34 + bands.high * 0.16) * shift * audioBlend;
    const lightness = this.clayLightBase + bands.brightness * 0.1 * shift * audioBlend;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift * audioBlend, 0.72, 0.18);

    const colorLerp = Math.min(1, deltaTime * (1.2 + bands.overall * 2.8 * audioBlend));
    if (st.pearlVariation <= 0) {
      this.coreMaterial.color.lerp(this.targetCoreColor, colorLerp);
    } else {
      this.coreMaterial.color.set(0xffffff);
    }
    const sp = this.getSpecies();
    // vita: 全体発光は使わず、突き抜け頂点のシェーダー発光に任せる
    if (this.style.membrane.vita) {
      this.coreMaterial.emissive.set(0x000000);
      this.coreMaterial.emissiveIntensity *= Math.max(0, 1 - deltaTime * 8);
      this.coreMaterial.vertexColors = true;
      this.coreMaterial.color.set(0xffffff);
      this.innerCoreMaterial.vertexColors = false;
      this.innerCoreMaterial.emissive.set(0x000000);
      this.innerCoreMaterial.emissiveIntensity *= Math.max(0, 1 - deltaTime * 6);
    } else {
      this.coreMaterial.emissive.lerp(this.targetCoreEmissive, colorLerp * audioBlend);
      const idleGlow =
        this.style.idleWobble * (0.07 + (Math.sin(this.idleTime * 0.55) * 0.5 + 0.5) * 0.08);
      const targetEmissive =
        (bands.overall * fibUnit(5, 21) + bands.brightness * fibUnit(3, 21) + bands.contrast * t.coreEmissive * fibUnit(3, 21)) *
          (t.coreEmissive / fibUnit(3, 21)) *
          (fibUnit(5, 8) + sp.aggressive * fibUnit(8, 13)) *
          st.emissiveScale *
          audioBlend +
        idleGlow;
      const emissiveLerp = Math.min(1, deltaTime * (1.4 + bands.overall * 2.2 * audioBlend));
      this.coreMaterial.emissiveIntensity +=
        (targetEmissive - this.coreMaterial.emissiveIntensity) * emissiveLerp;
    }

    // 膜の質感が粘土へ移るのは控えめに（全体が発光体に見えない範囲）
    const membraneBleed = this.membranePressureImpulse * 0.35;
    this.coreMaterial.clearcoat = Math.min(
      1,
      this.baseCoreClearcoat + membraneBleed * 0.25,
    );
    this.coreMaterial.clearcoatRoughness = Math.max(0.2, 0.35 - membraneBleed * 0.08);
    if (this.baseCoreSheen > 0 || membraneBleed > 0.08) {
      this.coreMaterial.sheen = Math.min(1, this.baseCoreSheen + membraneBleed * 0.2);
      this.coreMaterial.sheenRoughness = Math.max(0.35, 0.55 - membraneBleed * 0.08);
    }
    if (this.baseCoreIridescence > 0 || membraneBleed > 0.12) {
      this.coreMaterial.iridescence = Math.min(1, this.baseCoreIridescence + membraneBleed * 0.15);
      this.coreMaterial.iridescenceIOR = 1.5;
    }
    const baseRoughness =
      fibRatio(11, 12) +
      fibUnit(5, 21) -
      bands.brightness * fibUnit(5, 21) * shift -
      bands.high * fibUnit(3, 21) * shift;
    this.coreMaterial.roughness = Math.min(
      1,
      Math.max(
        0.1,
        baseRoughness +
          (st.roughness - 0.94) +
          sp.aggressive * fibUnit(5, 21) -
          sp.organic * fibUnit(5, 21),
      ),
    );
  }

  private getBandLiveWeights(bands: AudioBands): BandLiveWeights {
    return computeBandLiveWeights(bands, getBandSoloMode());
  }

  private getMembraneLiveTarget(bands: AudioBands) {
    const t = runtimeTuning;
    const w = this.getBandLiveWeights(bands);
    const audioPart = this.style.core.pearlVariation > 0 ? this.audioColorBlend : 1;
    if (this.completed) {
      // vita は完成後も記憶した鼓動で膜が生き続ける
      if (this.style.completion.mode === "breathe") {
        const interaction = this.hasActiveClickWobble() ? this.idleWobbleAmp : 0;
        return 0.45 + this.breathWave * 0.6 + interaction * 5;
      }
      return this.hasActiveClickWobble() ? this.idleWobbleAmp * 5 : 0;
    }
    return (
      w.high * t.liveHigh * fibRatio(8, 5) * audioPart +
      this.getSpecies().membraneGain * fibUnit(5, 13) * audioPart +
      (this.hatImpulse * fibUnit(8, 13) + this.waveImpulse * fibUnit(5, 13)) * t.liveHigh +
      // アイドル時も膜が微かに生きて見えるように（vita）
      this.idleWobbleAmp * 5
    );
  }

  private getMembraneGlowTarget(bands: AudioBands) {
    const t = runtimeTuning;
    const audioPart = this.style.core.pearlVariation > 0 ? this.audioColorBlend : 1;
    if (this.completed && this.style.completion.mode === "breathe") {
      const interaction = this.hasActiveClickWobble() ? this.idleWobbleAmp : 0;
      return 0.4 + this.breathWave * 0.45 + interaction * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2);
    }
    if (this.completed) {
      const interaction = this.hasActiveClickWobble() ? this.idleWobbleAmp : 0;
      return 0.35 + interaction * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2);
    }
    return (
      (this.completed ? 0.35 : 0.2) +
      bands.overall * t.liveHigh * 1.1 * audioPart +
      this.separationTendency * 0.25 * audioPart +
      (this.hatImpulse * 0.5 + this.waveImpulse * 0.28) * t.liveHigh +
      this.idleWobbleAmp * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2)
    );
  }

  applyLiveTuningNow() {
    const bands = this.lastBands;
    if (!bands) {
      return;
    }
    if (this.completed) {
      // 完成後のマテリアルは afterlife（石化・呼吸・素材化）が管理する
      return;
    }

    const t = runtimeTuning;
    const st = this.style.core;
    const shift = t.coreColorShift * st.shiftScale;
    const hue =
      this.clayHueBase +
      bands.mid * 0.08 * shift +
      bands.melody * t.coreColorShift * st.shiftScale +
      bands.brightness * 0.48 * shift;
    const saturation = this.claySatBase + bands.contrast * 0.34 * shift + bands.high * 0.16 * shift;
    const lightness = this.clayLightBase + bands.brightness * 0.1 * shift;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift, 0.72, 0.18);
    this.coreMaterial.color.copy(this.targetCoreColor);
    this.coreMaterial.emissive.copy(this.targetCoreEmissive);
    this.coreMaterial.emissiveIntensity =
      (bands.overall * 0.22 + bands.brightness * 0.12 + bands.contrast * t.coreEmissive * 0.1) *
      (t.coreEmissive / 0.1);
    this.coreMaterial.roughness = Math.min(
      1,
      Math.max(0.1, 0.86 + (st.roughness - 0.94) - bands.brightness * 0.18 * shift - bands.high * 0.08 * shift),
    );

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

    // 発達度: 音で蓄積された変形量の総和。coral の定常ノイズ等をこれでゲートし、
    // 音が入る前・形成初期のシルエットを正円に保つ。
    this.formDevelopment = clamp01(
      (this.formStretch +
        this.formWaist +
        this.formTwist +
        this.formBaseWeight +
        Math.abs(this.formBendX) +
        Math.abs(this.formBendZ) +
        Math.abs(this.formAsymmetry)) *
        2.4,
    );
  }

  /**
   * 大域変形: 複数の造形モードをブレンドする。
   * diabolo だけだとくびれ＋上下膨らみのジャグリング用形状に固定されるため、
   * torus / monolith / coral / spindle を音と乱数で混ぜる。
   */
  private applyGlobalForm(px: number, py: number, pz: number, salt: number) {
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

    // coral / 全アルゴリズム: pattern で塊のクラスタ（垂直対称を壊す）
    const coralNoise =
      growthPattern(px * 1.15, py * 1.08, pz * 1.12, this.morphologySeed + this.formingTime * 0.16) *
      this.formDevelopment;
    const coralBump = 1 + coralNoise * 0.26 * (0.45 + this.formTwist * 0.08);
    sx *= blendScale(coralBump - 1, Math.max(w.coral, 0.35));
    sy *= blendScale(coralBump - 1, Math.max(w.coral, 0.35));
    sz *= blendScale(coralBump - 1, Math.max(w.coral, 0.35));

    // アルゴリズム固有の半径うねり（coral 以外でも常に薄く効かせる）
    const algoWarp =
      growthPattern(px * 0.92, py * 1.05, pz * 0.88, this.morphologySeed + 41.2 + this.formingTime * 0.09) *
      this.formDevelopment *
      0.11;
    sx *= 1 + algoWarp;
    sy *= 1 + algoWarp * 0.85;
    sz *= 1 + algoWarp;

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
    const formMix = smoothstep(0, 1, this.formDevelopment);
    const pr = Math.hypot(px, py, pz) || 1;
    const globalGain = growthModulateScalar(1, px / pr, py / pr, pz / pr, salt, "global");
    const mix = formMix * globalGain;
    return {
      x: px + (warpedX - px) * mix,
      y: py + (warpedY - py) * mix,
      z: pz + (warpedZ - pz) * mix,
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
    const heavyPattern = isHeavyGrowthPatternAlgorithm();
    const cheapGrain = (x: number, y: number, z: number, salt: number) => {
      const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 19.3) * 43758.5453;
      return v - Math.floor(v);
    };

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
      const largeForm = growthPattern(nx, ny, nz, audioSalt);
      // 重い pattern は追加オクターブをハッシュ近似にして呼び出し回数を抑える
      const surfaceGrain = heavyPattern
        ? largeForm * 0.55 + (cheapGrain(nx, ny, nz, audioSalt + 6.3) * 2 - 1) * 0.45
        : growthPattern(nx, ny, nz, audioSalt + 6.3);
      const chiselNoise = heavyPattern
        ? largeForm * 0.4 + (cheapGrain(nx, ny, nz, audioSalt + 13.7) * 2 - 1) * 0.6
        : growthPattern(nx, ny, nz, audioSalt + 13.7);
      const spikeNoise = heavyPattern
        ? chiselNoise * 0.65 + (cheapGrain(nx, ny, nz, audioSalt + 28.9) * 2 - 1) * 0.35
        : growthPattern(nx, ny, nz, audioSalt + 28.9);
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
      // 共通モーフは弱め、アルゴリズム pattern を完成形に残す
      const idolMix = 0.52;
      const algoGrain = largeForm * 0.85 + surfaceGrain * 0.42 + chiselNoise * 0.35;
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
        pushMask * pushBias * 0.28 -
        carveMask * (carveBias + 0.92) -
        smoothstep(0.0, 0.78, -largeForm + axisFocusA * 0.3) * 0.42 +
        ridge * 0.12 +
        algoGrain * 0.62 +
        idolBulge * idolMix -
        idolCarve * idolMix;
      const bumpPressure =
        surfaceGrain * 0.36 +
        chiselNoise * 0.28 +
        axisFocusB * 0.12 -
        0.16;
      const spikeMask = smoothstep(0.62, 0.96, spikeNoise * 0.58 + axisFocusA * 0.42 + bands.brightness * 0.24);
      const spikeEdge = heavyPattern
        ? Math.min(1, Math.abs(largeForm) * 0.85 + 0.15)
        : growthSpikeMask(nx, ny, nz, audioSalt);
      const spikePressure =
        Math.pow(spikeMask, 2.7) *
        (0.26 + bands.contrast * 0.22 + bands.overall * 0.2) *
        (0.55 + spikeEdge * 0.65);
      const softSpike = Math.min(1, Math.abs(largeForm));
      const bulkDelta = heavyPattern
        ? growthModulateFromPattern(lowAmount * roundedPressure, largeForm, softSpike, "bulk")
        : growthModulateScalar(
            lowAmount * roundedPressure,
            nx,
            ny,
            nz,
            audioSalt,
            "bulk",
          );
      const midDelta = heavyPattern
        ? growthModulateFromPattern(midAmount * bumpPressure, surfaceGrain, softSpike, "mid")
        : growthModulateScalar(
            midAmount * bumpPressure,
            nx,
            ny,
            nz,
            audioSalt + 6.3,
            "mid",
          );
      const highDelta = heavyPattern
        ? growthModulateFromPattern(
            highAmount * spikePressure * 0.85,
            spikeNoise,
            spikeEdge,
            "high",
          )
        : growthModulateScalar(
            highAmount * spikePressure * 0.85,
            nx,
            ny,
            nz,
            audioSalt + 28.9,
            "high",
          );
      this.accumulated[i] = this.accumulateWithMemory(
        this.accumulated[i],
        bulkDelta,
        -0.72,
        0.58,
      );
      this.midBumps[i] = this.accumulateWithMemory(
        this.midBumps[i],
        midDelta,
        -0.42,
        0.26,
      );
      const spikeCap = runtimeTuning.spikeCap * this.getSpecies().spikeGain;
      this.highSpikes[i] = Math.min(
        spikeCap,
        Math.max(
          0,
          (this.highSpikes[i] * (1 - deltaTime * 0.35)) + highDelta,
        ),
      );

      // アルゴリズム固有の起伏を永続レイヤーへ直接蓄積
      const identityDrive =
        (lowAmount + midAmount * 0.75 + highAmount * 0.4) * (0.6 + formation * 0.5);
      if (identityDrive > 1e-6) {
        const identityDelta = growthModulateScalar(
          identityDrive * (largeForm * 0.7 + surfaceGrain * 0.28 + chiselNoise * 0.22),
          nx,
          ny,
          nz,
          audioSalt + 51.3,
          "memory",
        );
        this.algoIdentity[i] = Math.min(
          0.52,
          Math.max(-0.45, this.algoIdentity[i] + identityDelta * 1.4),
        );
      }

      // 結晶軸方向の "結晶化 / 粒子化" 変位。
      // 高音 + 高ブライトネス時、頂点ごとに固定された結晶軸方向に
      // 横方向の小さなオフセットが乗る。これが法線方向のスパイクと
      // 組合さって、鉱物や工業製品的な不揃いな突起感を出す。
      if (highAmount > 0.0001 && spikePressure > 0.001) {
        const ax = this.crystalAxes[index];
        const ay = this.crystalAxes[index + 1];
        const az = this.crystalAxes[index + 2];
        const crystalScale = growthModulateScalar(
          highAmount *
            spikePressure *
            (0.45 + bands.brightness * 0.6) *
            runtimeTuning.crystalScale *
            this.getSpecies().crystalGain,
          nx,
          ny,
          nz,
          audioSalt + 19.4,
          "high",
        );
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
    const placed = growthPlaceOnSphere(
      this.growthAnchors.length,
      SoundSculpture.maxGrowthAnchors,
      seed,
    );
    const randomDir = new THREE.Vector3(placed.x, placed.y, placed.z);
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
            const f = growthModulateScalar(
              falloff * growth * 0.55,
              nx,
              ny,
              nz,
              this.vertexDeformSalt(i, a),
              "anchor",
            );
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
            const f = growthModulateScalar(
              falloff * growth,
              nx,
              ny,
              nz,
              this.vertexDeformSalt(i, a + 1.3),
              "anchor",
            );
            const tangentScale = 1.05 * f;
            const normalScale = 0.22 * f;
            this.vectorField[idx] += (tx / tLen) * tangentScale + nx * normalScale;
            this.vectorField[idx + 1] += (ty / tLen) * tangentScale + ny * normalScale;
            this.vectorField[idx + 2] += (tz / tLen) * tangentScale + nz * normalScale;
            break;
          }
          case "crystal": {
            const sharp = Math.pow(falloff, 4.5);
            const f = growthModulateScalar(
              sharp * growth * 0.65,
              nx,
              ny,
              nz,
              this.vertexDeformSalt(i, a + 2.7),
              "high",
            );
            // 結晶: 法線 + わずかに斜めの軸。
            this.vectorField[idx] += (nx * 0.75 + dx * 0.45) * f;
            this.vectorField[idx + 1] += (ny * 0.75 + dy * 0.45) * f;
            this.vectorField[idx + 2] += (nz * 0.75 + dz * 0.45) * f;
            break;
          }
          case "erosion": {
            // “削り”は相対的に主役にする（ただし急激に凹まないように上限は同じ）
            const f = growthModulateScalar(
              falloff * growth * 0.95,
              nx,
              ny,
              nz,
              this.vertexDeformSalt(i, a + 4.1),
              "erosion",
            );
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
    const heavyFlow = isHeavyGrowthFlowAlgorithm();
    const flowStride = getHeavyGrowthFlowStride();
    const flowPhase = heavyFlow ? (Math.floor(this.formingTime * 28) % flowStride) : 0;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const idx = i * 3;
      // 全頂点で flowField を緩く減衰。
      this.flowField[idx] *= decayRate;
      this.flowField[idx + 1] *= decayRate;
      this.flowField[idx + 2] *= decayRate;
      if (skipLive || (i + flowPhase) % flowStride !== 0) {
        continue;
      }

      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const r = Math.hypot(bx, by, bz) || 1;
      const nx = bx / r;
      const ny = by / r;
      const nz = bz / r;

      growthFlow(bx * 1.35, by * 1.35, bz * 1.35, salt, this._curlOut);
      // 法線方向成分を抜いて純粋な tangent flow にする。
      const dot = this._curlOut.x * nx + this._curlOut.y * ny + this._curlOut.z * nz;
      const tx = this._curlOut.x - nx * dot;
      const ty = this._curlOut.y - ny * dot;
      const tz = this._curlOut.z - nz * dot;
      const deformSalt = this.vertexDeformSalt(i, salt);
      const strideBoost = flowStride;
      const liveMod = growthModulateScalar(liveAmount * strideBoost, nx, ny, nz, deformSalt, "flow");
      const persistMod = growthModulateScalar(
        persistAmount * strideBoost,
        nx,
        ny,
        nz,
        deformSalt + 4.1,
        "memory",
      );

      this.flowField[idx] += tx * liveMod;
      this.flowField[idx + 1] += ty * liveMod;
      this.flowField[idx + 2] += tz * liveMod;
      // 持続的な痕跡 (中音が長く続くほど "流れの彫り跡" が残る)。
      this.vectorField[idx] += tx * persistMod;
      this.vectorField[idx + 1] += ty * persistMod;
      this.vectorField[idx + 2] += tz * persistMod;
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

    const bleedRate = 0.058;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const deformSalt = this.vertexDeformSalt(i);

      const lowBleed = growthModulateScalar(
        this.liveOffset[i] * w.low * t.liveLow * rate * bleedRate,
        nx,
        ny,
        nz,
        deformSalt,
        "live",
      );
      if (Math.abs(lowBleed) > 0.00001) {
        this.accumulated[i] = this.accumulateWithMemory(this.accumulated[i], lowBleed, -0.72, 0.58);
      }

      const midBleed = growthModulateScalar(
        this.surfaceLiveOffset[i] * w.mid * t.liveMid * rate * bleedRate,
        nx,
        ny,
        nz,
        deformSalt + 3.2,
        "surface",
      );
      if (Math.abs(midBleed) > 0.00001) {
        this.midBumps[i] = this.accumulateWithMemory(this.midBumps[i], midBleed, -0.42, 0.26);
      }

      const highDrive = w.high * t.liveHigh + this.hatImpulse * 0.42;
      const highBleed = growthModulateScalar(
        highDrive * rate * bleedRate * growthPattern(nx, ny, nz, this.formingTime * 2.1 + i * 0.03),
        nx,
        ny,
        nz,
        deformSalt + 7.4,
        "high",
      );
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
        vfScalar * 0.88 +
        this.algoIdentity[i];
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

      const grain = growthPattern(nx, ny, nz, salt);
      const streak = growthPattern(nx * 1.7, ny * 1.7, nz * 1.7, salt + 4.7);
      const mask = smoothstep(0.1, 0.92, -grain + streak * 0.55 + bands.contrast * 0.35);

      const hardness = 0.55;
      const amount = growthModulateScalar(
        -drive * mask * (1 - hardness * 0.6) * deltaTime * 2.1,
        nx,
        ny,
        nz,
        this.vertexDeformSalt(i, salt),
        "erosion",
      );
      this.erosionField[i] = Math.max(-0.62, this.erosionField[i] + amount);

      const fx = this.flowField[idx];
      const fy = this.flowField[idx + 1];
      const fz = this.flowField[idx + 2];
      const fLen = Math.hypot(fx, fy, fz);
      if (fLen > 0.0001) {
        const scrape = growthModulateScalar(
          drive * mask * deltaTime * 0.012,
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i, salt + 2.8),
          "erosion",
        );
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
      const pulseRaw =
        this.completed ? 0 : growthPattern(nx, ny, nz, this.formingTime * 1.6) * (
          (this.kickImpulse * 0.42 + latestRhythm.pulseEnvelope * latestRhythm.pulseConfidence * 0.38) * t.liveLow
        );
      const pulse = growthModulateScalar(
        pulseRaw,
        nx,
        ny,
        nz,
        this.vertexDeformSalt(i, 6.1),
        "live",
      );

      // 完成／ホールド中は liveOffset を動かさない（最終形を維持）
      if (!this.completed && !this.shapeHold) {
        this.liveOffset[i] += (pulse - this.liveOffset[i]) * Math.min(1, deltaTime * 8);
      }

      const carve = this.detachmentCarve[i];
      const erosion = this.erosionField[i];
      const rememberedDisplacement = this.getPermanentScalarDisplacement(i);
      const deformSalt = this.vertexDeformSalt(i);
      const scalarDisp = growthModulateScalar(
        (rememberedDisplacement + erosion) * (1 - carve * 0.88),
        nx,
        ny,
        nz,
        deformSalt,
        "bulk",
      );

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
      const vecMod = growthModulateVector3(vfx, vfy, vfz, nx, ny, nz, deformSalt + 5.5, "flow");
      const flowMod = growthModulateVector3(
        this.flowField[index],
        this.flowField[index + 1],
        this.flowField[index + 2],
        nx,
        ny,
        nz,
        deformSalt + 2.2,
        "flow",
      );

      // 法線方向のスカラ変位 + 任意方向の vector offset + live tangent flow。
      const px = x + nx * scalarDisp + vecMod.x + flowMod.x;
      const py = y + ny * scalarDisp + vecMod.y + flowMod.y;
      const pz = z + nz * scalarDisp + vecMod.z + flowMod.z;
      const warped = this.applyGlobalForm(px, py, pz, deformSalt);
      positions[index] = warped.x;
      positions[index + 1] = warped.y;
      positions[index + 2] = warped.z;
    }

    this.constrainEnvelope(
      positions as Float32Array,
      this.targetCoreMeanRadius,
      1.02 + this.formDevelopment * 0.2 + this.getFormationScale() * 0.28,
    );

    // 完成後も最終ライブ／フローを描画して形を維持（値は更新しない）
    {
      for (let i = 0; i < this.accumulated.length; i += 1) {
        const index = i * 3;
        const x = this.basePositions[index];
        const y = this.basePositions[index + 1];
        const z = this.basePositions[index + 2];
        const radius = Math.hypot(x, y, z) || 1;
        const nx = x / radius;
        const ny = y / radius;
        const nz = z / radius;
        const live =
          this.liveOffset[i] * (1 - this.detachmentCarve[i] * 0.88) + this.idleWobbleField[i];
        if (
          Math.abs(live) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index]) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index + 1]) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index + 2]) < 1e-6
        ) {
          continue;
        }
        const liveScalar = growthModulateScalar(
          live,
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i),
          "live",
        );
        const wobbleVec = growthModulateVector3(
          this.idleWobbleVector[index],
          this.idleWobbleVector[index + 1],
          this.idleWobbleVector[index + 2],
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i, 1.7),
          "idle",
        );
        positions[index] += nx * liveScalar + wobbleVec.x;
        positions[index + 1] += ny * liveScalar + wobbleVec.y;
        positions[index + 2] += nz * liveScalar + wobbleVec.z;
      }
    }

    applyClickRepulsionToPositions(this.clickRepulsion, this.basePositions, positions as Float32Array);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  /**
   * 突き抜け頂点だけ半透明＋発光するためのコアシェーダ拡張（誇張版）。
   * core / innerCore の両方に入れる（同一ジオメトリのため片方だけだと隠れる）。
   */
  private installCorePierceShader(material: THREE.MeshPhysicalMaterial) {
    material.transparent = true;
    material.opacity = 1;
    // 膜内の粘土は通常の不透明感を保ち、突き抜け先端だけ透過＋発光
    material.depthWrite = true;
    material.vertexColors = true;
    material.color.set(0xffffff);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          attribute float aPierce;
          varying float vPierce;
          `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vPierce = aPierce;
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          varying float vPierce;
          `,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          /* glsl */ `
          // 真の突き抜けだけ弱い発光。膜内は頂点色の粘土質のまま
          float pierceMask = smoothstep(0.4, 0.9, vPierce);
          vec3 pierceTint = mix(diffuse, vec3(0.82, 0.52, 0.72), pierceMask * 0.12);
          vec4 diffuseColor = vec4( pierceTint, opacity * mix(1.0, 0.72, pierceMask) );
          `,
        )
        .replace(
          "#include <emissivemap_fragment>",
          /* glsl */ `
          #include <emissivemap_fragment>
          float pierceGlow = smoothstep(0.45, 0.95, vPierce);
          totalEmissiveRadiance += vec3(0.7, 0.4, 0.65) * pierceGlow * 0.45;
          totalEmissiveRadiance += vec3(0.35, 0.55, 0.75) * pierceGlow * pierceGlow * 0.22;
          `,
        );
    };
    material.customProgramCacheKey = () => "vita-core-pierce-tips-soft-v6";
    material.needsUpdate = true;
  }

  /**
   * 膜メッシュの1-ring近傍を構築（接触圧の柔らかい拡散用）。
   */
  private buildMembraneNeighbors(geometry: THREE.BufferGeometry, vertexCount: number) {
    const cap = SoundSculpture.membraneNeighborCap;
    const neighbors = new Int32Array(vertexCount * cap);
    neighbors.fill(-1);
    const counts = new Uint8Array(vertexCount);
    const indexAttr = geometry.getIndex();
    if (!indexAttr) {
      return neighbors;
    }
    const indices = indexAttr.array;
    const addEdge = (a: number, b: number) => {
      if (a === b || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) {
        return;
      }
      const base = a * cap;
      const n = counts[a];
      if (n >= cap) {
        return;
      }
      for (let k = 0; k < n; k += 1) {
        if (neighbors[base + k] === b) {
          return;
        }
      }
      neighbors[base + n] = b;
      counts[a] = n + 1;
    };
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      addEdge(a, b);
      addEdge(b, a);
      addEdge(a, c);
      addEdge(c, a);
      addEdge(b, c);
      addEdge(c, b);
    }
    return neighbors;
  }

  /**
   * コアが膜に近づいた／突き抜けた頂点で圧力を溜め、近傍へ拡散する。
   * 完成後は新規加算せず減衰のみ。
   * ※ 膜接着の前に呼ぶこと — ここで aPierce も更新する。
   */
  private updateMembraneContactPressure(deltaTime: number) {
    // 完成／ホールド中は膜圧・pierce を減衰させず形を固定
    if (this.completed || this.shapeHold) {
      return;
    }
    const decay = Math.exp(-4 * deltaTime);
    const impulseDecay = Math.exp(-5.2 * deltaTime);
    const pierceDecay = Math.exp(-3.8 * deltaTime);
    const pierceAttack = Math.min(1, deltaTime * 18);
    const count = this.membranePressure.length;
    let pierceChanged = false;

    for (let i = 0; i < count; i += 1) {
      this.membranePressure[i] *= decay;
      if (this.membranePressure[i] < 1e-5) {
        this.membranePressure[i] = 0;
      }
      // 接触なしフレームでも pierce は減衰
      const prevPierce = this.pierceAmount[i];
      this.pierceAmount[i] *= pierceDecay;
      if (this.pierceAmount[i] < 1e-4) {
        this.pierceAmount[i] = 0;
      }
      if (this.pierceAmount[i] !== prevPierce) {
        pierceChanged = true;
      }
    }

    if (!this.style.membrane.vita) {
      this.membranePressureImpulse *= impulseDecay;
      if (pierceChanged) {
        const pierceAttr = this.geometry.getAttribute("aPierce");
        if (pierceAttr) {
          pierceAttr.needsUpdate = true;
        }
      }
      return;
    }

    let hit = 0;
    if (!this.completed) {
      const corePositions = this.geometry.attributes.position.array as Float32Array;
      const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;
      const softGap = 0.35;
      const vertexCount = Math.min(count, Math.min(corePositions.length, surfacePositions.length) / 3);

      for (let i = 0; i < vertexCount; i += 1) {
        const index = i * 3;
        const coreRadius = Math.hypot(
          corePositions[index],
          corePositions[index + 1],
          corePositions[index + 2],
        );
        if (coreRadius < 0.0001) {
          continue;
        }
        const surfaceRadius = Math.hypot(
          surfacePositions[index],
          surfacePositions[index + 1],
          surfacePositions[index + 2],
        );
        const gap = surfaceRadius - coreRadius;
        if (gap >= softGap) {
          continue;
        }

        const bx = this.baseSurfacePositions[index];
        const by = this.baseSurfacePositions[index + 1];
        const bz = this.baseSurfacePositions[index + 2];
        const br = Math.hypot(bx, by, bz) || 1;
        const nx = bx / br;
        const ny = by / br;
        const nz = bz / br;

        let push = 0;
        if (gap < 0) {
          push = 0.085 + Math.min(0.24, -gap * 0.9);
        } else {
          const t = 1 - gap / softGap;
          push = t * t * 0.058;
        }
        push = growthModulateScalar(push, nx, ny, nz, this.vertexDeformSalt(i, 21.4), "surface");
        this.membranePressure[i] = Math.min(0.38, this.membranePressure[i] + push);
        hit = Math.max(hit, push);

        // 膜を突き抜けた頂点だけ発光マスク（接近だけでは立てない）
        if (gap < 0) {
          const pierceTarget = Math.min(1, (-gap / 0.1) * 0.95);
          if (pierceTarget > this.pierceAmount[i]) {
            this.pierceAmount[i] += (pierceTarget - this.pierceAmount[i]) * pierceAttack;
          } else {
            this.pierceAmount[i] = Math.max(this.pierceAmount[i] * pierceDecay, pierceTarget);
          }
          pierceChanged = true;
        }
      }

      // 接触圧のみ 1-ring へ柔らかい拡散（pierce は拡散しない＝膜内が光らない）
      const cap = SoundSculpture.membraneNeighborCap;
      for (let i = 0; i < count; i += 1) {
        let sum = this.membranePressure[i];
        let n = 1;
        const base = i * cap;
        for (let k = 0; k < cap; k += 1) {
          const j = this.membraneNeighbors[base + k];
          if (j < 0) {
            break;
          }
          sum += this.membranePressure[j];
          n += 1;
        }
        this.membranePressureScratch[i] = this.membranePressure[i] * 0.7 + (sum / n) * 0.3;
      }
      this.membranePressure.set(this.membranePressureScratch);
    }

    this.membranePressureImpulse = Math.min(
      1,
      this.membranePressureImpulse * impulseDecay + hit * 3.8,
    );

    if (pierceChanged) {
      const pierceAttr = this.geometry.getAttribute("aPierce");
      if (pierceAttr) {
        pierceAttr.needsUpdate = true;
      }
    }
  }

  /**
   * 接触圧に応じて膜を粘土側へ引っ張る（接着）。
   * 粘土が膨らめば膜も一緒に外へ、近づけば膜が内側へ吸い付く。
   */
  private applyMembranePressureBulge(positions: Float32Array | ArrayLike<number>) {
    if (!this.style.membrane.vita) {
      return;
    }
    const pos = positions as Float32Array;
    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const count = Math.min(this.membranePressure.length, corePositions.length / 3);
    const filmGap = 0.055;

    for (let i = 0; i < count; i += 1) {
      const pressure = this.membranePressure[i];
      if (pressure < 1e-5) {
        continue;
      }
      const index = i * 3;
      const cx = corePositions[index];
      const cy = corePositions[index + 1];
      const cz = corePositions[index + 2];
      const coreRadius = Math.hypot(cx, cy, cz);
      if (coreRadius < 0.0001) {
        continue;
      }

      const sx = pos[index];
      const sy = pos[index + 1];
      const sz = pos[index + 2];
      const surfaceRadius = Math.hypot(sx, sy, sz) || 1;

      // 粘土表面のすぐ外側へ膜を引き寄せる目標点
      const targetRadius = coreRadius + filmGap;
      const cnx = cx / coreRadius;
      const cny = cy / coreRadius;
      const cnz = cz / coreRadius;
      const targetX = cnx * targetRadius;
      const targetY = cny * targetRadius;
      const targetZ = cnz * targetRadius;

      const nx = sx / surfaceRadius;
      const ny = sy / surfaceRadius;
      const nz = sz / surfaceRadius;
      // 圧力が強いほど強く張り付く（突き抜け時は特に粘土に引っ張られる）
      const pierceBoost = surfaceRadius < coreRadius ? 1.35 : 1;
      const adhesion = Math.min(
        0.92,
        growthModulateScalar(
          Math.min(1, pressure * 2.4) * pierceBoost,
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i, 23.7),
          "surface",
        ),
      );

      pos[index] = sx + (targetX - sx) * adhesion;
      pos[index + 1] = sy + (targetY - sy) * adhesion;
      pos[index + 2] = sz + (targetZ - sz) * adhesion;
    }
  }

  /**
   * 膜に引っ張られた反作用として、粘土コアを接触点で内側へへこませる。
   */
  private applyClayContactCompress() {
    if (!this.style.membrane.vita) {
      return;
    }
    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const count = Math.min(this.membranePressure.length, corePositions.length / 3);
    let changed = false;

    for (let i = 0; i < count; i += 1) {
      const pressure = this.membranePressure[i];
      if (pressure < 1e-5) {
        continue;
      }
      const index = i * 3;
      const cx = corePositions[index];
      const cy = corePositions[index + 1];
      const cz = corePositions[index + 2];
      const cr = Math.hypot(cx, cy, cz) || 1;
      const nx = cx / cr;
      const ny = cy / cr;
      const nz = cz / cr;
      // 膜に引っ張られる感触の反作用 — やや控えめに内側へ
      const amount = growthModulateScalar(
        pressure * 0.42,
        nx,
        ny,
        nz,
        this.vertexDeformSalt(i, 25.1),
        "live",
      );
      growthFlow(nx * 1.15, ny * 1.15, nz * 1.15, this.vertexDeformSalt(i, 26.4), this._curlOut);
      const dot = this._curlOut.x * nx + this._curlOut.y * ny + this._curlOut.z * nz;
      const tx = this._curlOut.x - nx * dot;
      const ty = this._curlOut.y - ny * dot;
      const tz = this._curlOut.z - nz * dot;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      const lateral = amount * 0.22;

      corePositions[index] = cx - nx * amount + (tx / tLen) * lateral;
      corePositions[index + 1] = cy - ny * amount + (ty / tLen) * lateral;
      corePositions[index + 2] = cz - nz * amount + (tz / tLen) * lateral;
      changed = true;
    }

    if (changed) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
  }

  /**
   * 膜が粘土に作用して少し同化する。
   * pierce マスクは updateMembraneContactPressure（膜接着前）で更新済み。
   */
  private applyClayMembraneAssimilation(deltaTime: number) {
    if (!this.style.membrane.vita) {
      return;
    }

    const decay = Math.exp(-3.4 * deltaTime);
    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;
    const count = Math.min(
      this.clayAssimilation.length,
      Math.min(corePositions.length, surfacePositions.length) / 3,
    );
    const softGap = 0.2;
    const colorAttr = this.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    const colors = colorAttr ? (colorAttr.array as Float32Array) : null;
    let geomChanged = false;
    let colorChanged = false;
    const allowUpdate = !this.completed && !this.shapeHold;

    for (let i = 0; i < count; i += 1) {
      if (allowUpdate) {
        this.clayAssimilation[i] *= decay;
        if (this.clayAssimilation[i] < 1e-5) {
          this.clayAssimilation[i] = 0;
        }
      }

      const index = i * 3;
      const cx = corePositions[index];
      const cy = corePositions[index + 1];
      const cz = corePositions[index + 2];
      const coreRadius = Math.hypot(cx, cy, cz);
      if (coreRadius < 0.0001) {
        continue;
      }
      const surfaceRadius = Math.hypot(
        surfacePositions[index],
        surfacePositions[index + 1],
        surfacePositions[index + 2],
      );
      const gap = surfaceRadius - coreRadius;
      const pierce = this.pierceAmount[i];

      if (allowUpdate && (gap < softGap || this.membranePressure[i] > 0.02)) {
        const nx = cx / coreRadius;
        const ny = cy / coreRadius;
        const nz = cz / coreRadius;
        let gain = 0;
        if (gap < 0) {
          gain = 0.12 + Math.min(0.35, -gap * 1.1);
        } else if (gap < softGap) {
          const t = 1 - gap / softGap;
          gain = t * t * 0.06 + this.membranePressure[i] * 0.08;
        } else {
          gain = this.membranePressure[i] * 0.05;
        }
        gain = growthModulateScalar(gain, nx, ny, nz, this.vertexDeformSalt(i, 28.2), "live");
        this.clayAssimilation[i] = Math.min(1, this.clayAssimilation[i] + gain);
      }

      const assimil = this.clayAssimilation[i];
      if (assimil < 1e-4 && pierce < 1e-4) {
        if (colors) {
          colors[index] = this.coreColorBase[index];
          colors[index + 1] = this.coreColorBase[index + 1];
          colors[index + 2] = this.coreColorBase[index + 2];
          colorChanged = true;
        }
        continue;
      }

      const nx = cx / coreRadius;
      const ny = cy / coreRadius;
      const nz = cz / coreRadius;

      // 突き抜けを消さないよう、引き戻しは弱め
      const membraneInner = Math.max(0.15, surfaceRadius - 0.025);
      if (assimil > 1e-4 && pierce < 0.35 && coreRadius > membraneInner) {
        const pull = Math.min(
          0.35,
          growthModulateScalar(assimil * 0.28, nx, ny, nz, this.vertexDeformSalt(i, 29.1), "live"),
        );
        const newRadius = coreRadius + (membraneInner - coreRadius) * pull;
        corePositions[index] = nx * newRadius;
        corePositions[index + 1] = ny * newRadius;
        corePositions[index + 2] = nz * newRadius;
        geomChanged = true;
      }

      if (colors) {
        // 膜内は粘土色のまま。突き抜け先端もごく弱く寄せるだけ
        const tintStrength = Math.min(1, Math.max(0, (pierce - 0.4) / 0.55) * 0.1);
        if (tintStrength > 0.015) {
          const tr = 0.78;
          const tg = 0.5 + pierce * 0.06;
          const tb = 0.62 + pierce * 0.05;
          colors[index] = this.coreColorBase[index] + (tr - this.coreColorBase[index]) * tintStrength;
          colors[index + 1] =
            this.coreColorBase[index + 1] + (tg - this.coreColorBase[index + 1]) * tintStrength;
          colors[index + 2] =
            this.coreColorBase[index + 2] + (tb - this.coreColorBase[index + 2]) * tintStrength;
          colorChanged = true;
        } else {
          colors[index] = this.coreColorBase[index];
          colors[index + 1] = this.coreColorBase[index + 1];
          colors[index + 2] = this.coreColorBase[index + 2];
          colorChanged = true;
        }
      }
    }

    if (geomChanged) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
    if (colorChanged && colorAttr) {
      colorAttr.needsUpdate = true;
    }
  }

  /**
   * vita のコアを膜より内側に収める安全弁。
   * 突き抜けは許容し、極端な飛び出しだけ抑える。
   */
  private enforceVitaMembraneClearance() {
    if (!this.style.membrane.vita) {
      return;
    }

    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;
    const vertexCount = Math.min(corePositions.length, surfacePositions.length) / 3;
    // 突き抜け許容幅 — これ以上だけ強制クランプ
    const maxOvershoot = 0.32;
    let changed = false;

    for (let i = 0; i < vertexCount; i += 1) {
      const index = i * 3;
      const cx = corePositions[index];
      const cy = corePositions[index + 1];
      const cz = corePositions[index + 2];
      const coreRadius = Math.hypot(cx, cy, cz);
      if (coreRadius < 0.0001) {
        continue;
      }

      const surfaceRadius = Math.hypot(
        surfacePositions[index],
        surfacePositions[index + 1],
        surfacePositions[index + 2],
      );
      const maxCoreRadius = surfaceRadius + maxOvershoot;
      if (coreRadius <= maxCoreRadius) {
        continue;
      }

      const scale = maxCoreRadius / coreRadius;
      corePositions[index] = cx * scale;
      corePositions[index + 1] = cy * scale;
      corePositions[index + 2] = cz * scale;
      changed = true;
    }

    if (changed) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.computeVertexNormals();
    }
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
      const flow = growthPattern(nx, ny, nz, this.formingTime * 2.8);
      const ripple = growthPattern(nx, ny, nz, this.formingTime * 3.6 + this.carvingPhase * 0.7);
      const surfacePattern = flow * 0.22 + ripple * 0.09;
      const targetSurfaceLive = midDrive * surfacePattern;
      if (!this.completed && !this.shapeHold) {
        this.surfaceLiveOffset[i] +=
          (targetSurfaceLive - this.surfaceLiveOffset[i]) * Math.min(1, deltaTime * 9);
      }
      const remembered = this.getPermanentScalarDisplacement(i);
      const deformSalt = this.vertexDeformSalt(i, 9.2);
      // ホールド／完成後は midDrive 由来の瞬時オフセットも足さない（形固定）
      const liveSurfaceNudge =
        this.completed || this.shapeHold ? 0 : flow * midDrive * 0.05;
      const scalarDisp = growthModulateScalar(
        remembered * 0.98 + liveSurfaceNudge,
        nx,
        ny,
        nz,
        deformSalt,
        "surface",
      );
      const vecMod = growthModulateVector3(
        this.vectorField[index] * vectorScale,
        this.vectorField[index + 1] * vectorScale,
        this.vectorField[index + 2] * vectorScale,
        nx,
        ny,
        nz,
        deformSalt + 4.4,
        "flow",
      );
      const flowMod = growthModulateVector3(
        this.flowField[index] * flowScale,
        this.flowField[index + 1] * flowScale,
        this.flowField[index + 2] * flowScale,
        nx,
        ny,
        nz,
        deformSalt + 1.8,
        "flow",
      );

      const px = x + nx * scalarDisp + vecMod.x + flowMod.x;
      const py = y + ny * scalarDisp + vecMod.y + flowMod.y;
      const pz = z + nz * scalarDisp + vecMod.z + flowMod.z;
      const warped = this.applyGlobalForm(px, py, pz, deformSalt);
      positions[index] = warped.x;
      positions[index + 1] = warped.y;
      positions[index + 2] = warped.z;
    }

    this.constrainEnvelope(positions as Float32Array, this.targetSurfaceMeanRadius, 1.32);

    // 完成後も最終 surfaceLive を描画して形を維持
    {
      for (let i = 0; i < this.accumulated.length; i += 1) {
        const index = i * 3;
        const x = this.baseSurfacePositions[index];
        const y = this.baseSurfacePositions[index + 1];
        const z = this.baseSurfacePositions[index + 2];
        const radius = Math.hypot(x, y, z) || 1;
        const nx = x / radius;
        const ny = y / radius;
        const nz = z / radius;
        // 膜はコアより僅かに大きくホヨホヨさせて「柔らかい外皮」を演出
        const live = this.surfaceLiveOffset[i] + this.idleWobbleField[i] * 1.18;
        if (
          Math.abs(live) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index]) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index + 1]) < 1e-6 &&
          Math.abs(this.idleWobbleVector[index + 2]) < 1e-6
        ) {
          continue;
        }
        const liveScalar = growthModulateScalar(
          live,
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i, 11.5),
          "surface",
        );
        const wobbleVec = growthModulateVector3(
          this.idleWobbleVector[index] * 1.05,
          this.idleWobbleVector[index + 1] * 1.05,
          this.idleWobbleVector[index + 2] * 1.05,
          nx,
          ny,
          nz,
          this.vertexDeformSalt(i, 13.1),
          "idle",
        );
        positions[index] += nx * liveScalar + wobbleVec.x;
        positions[index + 1] += ny * liveScalar + wobbleVec.y;
        positions[index + 2] += nz * liveScalar + wobbleVec.z;
      }
    }

    applyClickRepulsionToPositions(
      this.surfaceClickRepulsion,
      this.baseSurfacePositions,
      positions as Float32Array,
    );

    // 接触圧 → 膜が粘土に引っ張られる → 粘土へこみ → 膜が粘土を同化する → 極端飛び出しのみ安全弁
    this.updateMembraneContactPressure(deltaTime);
    this.applyMembranePressureBulge(positions as Float32Array);
    this.applyClayContactCompress();
    this.applyClayMembraneAssimilation(deltaTime);
    this.enforceVitaMembraneClearance();

    const uniforms = this.surfaceMaterial.uniforms;
    // vita は無音時も膜の模様がゆっくり流れ続ける（idleTime は常に進む）
    uniforms.uTime.value = this.completed
      ? this.frozenTime
      : this.formingTime + (this.style.idleWobble > 0 ? this.idleTime * 0.3 : 0);
    uniforms.uMelodyLine.value = t.membraneLine;
    uniforms.uMelodyFresnel.value = t.membraneFresnel;
    uniforms.uMelodyNoise.value = t.membraneNoise;
    uniforms.uMelodyFlowAnim.value = 1.2 + t.liveHigh * 1.4;
    uniforms.uMid.value += (bands.mid - uniforms.uMid.value) * Math.min(1, deltaTime * 9);
    uniforms.uMelody.value += (bands.melody - uniforms.uMelody.value) * Math.min(1, deltaTime * 9);
    uniforms.uHigh.value += (bands.high - uniforms.uHigh.value) * Math.min(1, deltaTime * 9);
    const tension = this.membranePressureImpulse;
    const targetLive = this.getMembraneLiveTarget(bands) + tension * 0.7;
    uniforms.uLive.value += (targetLive - uniforms.uLive.value) * Math.min(1, deltaTime * 14);
    const targetGlow = this.getMembraneGlowTarget(bands) + tension * 0.9;
    uniforms.uGlow.value += (targetGlow - uniforms.uGlow.value) * Math.min(1, deltaTime * 5);
    // 外殻の透明感を抑えて「中身が詰まっている」印象に寄せる
    const sp = this.getSpecies();
    const stMembrane = this.style.membrane;
    const initialGate = 0.5 + this.formDevelopment * 0.5;
    const membraneOpacity =
      (this.completed
        ? stMembrane.completedOpacity
        : (fibUnit(5, 21) + sp.membraneGain * fibUnit(8, 21) - sp.aggressive * fibUnit(5, 21)) *
          stMembrane.opacityScale) *
        initialGate +
      tension * 0.14;
    const opacityFollow = this.completed
      ? 0.7 + (1 - this.completionSettle) * 1.4
      : fib(3);
    uniforms.uOpacity.value +=
      (membraneOpacity - uniforms.uOpacity.value) * Math.min(1, deltaTime * opacityFollow);
    const freezeTarget = this.completed ? stMembrane.freezeTarget : 0;
    const freezeFollow = this.completed
      ? 0.55 + (1 - this.completionSettle) * 1.1
      : 2;
    uniforms.uCompleted.value +=
      (freezeTarget - uniforms.uCompleted.value) * Math.min(1, deltaTime * freezeFollow);

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

  private updateGlowDust(_bands: AudioBands, deltaTime: number) {
    // Scope 水色バー (scopeCyanDrive) と同じ波形エネルギーで半径・明度・不透明度を動かす
    const drive = this.completed ? 0 : scopeCyanDrive(latestRhythm);
    // 初期ロード／無音時はシェル周りの孤立した点としてゴミに見えるので隠す
    if (!this.style.particlesVisible || (!this.completed && drive < 0.018)) {
      this.glowDust.visible = false;
      this.glowDustMaterial.opacity = 0;
      return;
    }
    this.glowDust.visible = true;

    const displayTime = this.completed ? this.frozenTime : this.formingTime;
    const shellPulse = 1.34 + drive * 0.28 + Math.sin(displayTime * 1.4) * (0.012 + drive * 0.04);
    const drift = displayTime * (0.28 + drive * 1.15);

    for (let i = 0; i < SoundSculpture.maxGlowDust; i += 1) {
      const idx = i * 3;
      const nx = this.glowDustBaseDirs[idx];
      const ny = this.glowDustBaseDirs[idx + 1];
      const nz = this.glowDustBaseDirs[idx + 2];
      const wobble = growthPattern(nx, ny, nz, this.morphologySeed + i * 0.13 + drift) * (0.06 + drive * 0.12);
      const radius = shellPulse + wobble + seededUnit(i, drift) * (0.03 + drive * 0.07);
      this.glowDustPositions[idx] = nx * radius;
      this.glowDustPositions[idx + 1] = ny * radius;
      this.glowDustPositions[idx + 2] = nz * radius;

      const glow = (0.18 + drive * 0.95) * (0.55 + seededUnit(i, 2.7) * 0.45);
      this.glowDustColors[idx] = 0.38 * glow;
      this.glowDustColors[idx + 1] = 0.7 * glow;
      this.glowDustColors[idx + 2] = 1.0 * glow;
    }

    const targetOpacity = this.completed
      ? this.style.completion.mode === "breathe"
        ? 0.24 + this.breathWave * 0.12
        : 0.12
      : 0.12 + drive * 0.78;
    this.glowDustMaterial.opacity +=
      (targetOpacity - this.glowDustMaterial.opacity) * Math.min(1, deltaTime * 10);
    this.glowDustMaterial.size = 0.012 + drive * 0.028;

    this.glowDustGeometry.attributes.position.needsUpdate = true;
    this.glowDustGeometry.attributes.color.needsUpdate = true;
  }

  private spawnSparkle(bands: AudioBands, drive = scopeCyanDrive(latestRhythm)) {
    const index = this.sparkleCursor();
    const idx = index * 3;
    const origin = new THREE.Vector3();
    this.pickDetachmentOrigin(origin);
    const jitter = 0.06 + drive * 0.1;
    // 見た目のジッターのみ — 形態決定論には影響しない
    this.sparklePositions[idx] = origin.x + (seededUnit(index, this.formingTime + 1.1) - 0.5) * jitter;
    this.sparklePositions[idx + 1] = origin.y + (seededUnit(index, this.formingTime + 2.2) - 0.5) * jitter;
    this.sparklePositions[idx + 2] = origin.z + (seededUnit(index, this.formingTime + 3.3) - 0.5) * jitter;
    this.sparkleLife[index] = 1;
    const glow = 0.55 + drive * 0.7 + bands.high * 0.15;
    this.sparkleColors[idx] = 0.55 * glow;
    this.sparkleColors[idx + 1] = 0.85 * glow;
    this.sparkleColors[idx + 2] = 1.0 * glow;
    if (this.style.particlesVisible) {
      SoundSculpture.unparkPointsGeometry(this.sparkleGeometry, SoundSculpture.maxSparkles);
    }
  }

  private sparkleCursor() {
    const index = this.sparkleCursorIndex;
    this.sparkleCursorIndex = (this.sparkleCursorIndex + 1) % SoundSculpture.maxSparkles;
    return index;
  }

  private updateSparkles(bands: AudioBands, deltaTime: number) {
    const drive = this.completed ? 0 : scopeCyanDrive(latestRhythm);
    if (!this.completed) {
      this.sparkleEmission += drive * deltaTime * 36;
      let spawned = 0;
      while (this.sparkleEmission >= 1 && spawned < 10) {
        this.spawnSparkle(bands, drive);
        this.sparkleEmission -= 1;
        spawned += 1;
      }
    }

    const decay = this.completed ? 2.8 : 1.8;
    let anyAlive = false;
    for (let i = 0; i < SoundSculpture.maxSparkles; i += 1) {
      if (this.sparkleLife[i] <= 0) {
        continue;
      }
      anyAlive = true;
      this.sparkleLife[i] = Math.max(0, this.sparkleLife[i] - deltaTime * decay);
      const idx = i * 3;
      if (this.sparkleLife[i] <= 0) {
        this.sparklePositions[idx] = 999;
        this.sparklePositions[idx + 1] = 999;
        this.sparklePositions[idx + 2] = 999;
        continue;
      }
      const twinkle = this.sparkleLife[i] * (0.45 + drive * 0.7);
      this.sparkleColors[idx] = 0.5 * twinkle;
      this.sparkleColors[idx + 1] = 0.82 * twinkle;
      this.sparkleColors[idx + 2] = 1.0 * twinkle;
    }

    this.sparkleMaterial.opacity +=
      ((this.completed ? 0.08 : 0.2 + drive * 0.75) - this.sparkleMaterial.opacity) * Math.min(1, deltaTime * 8);
    this.sparkleMaterial.size = 0.04 + drive * 0.06;
    if (anyAlive && this.style.particlesVisible) {
      SoundSculpture.unparkPointsGeometry(this.sparkleGeometry, SoundSculpture.maxSparkles);
    } else {
      SoundSculpture.parkPointsGeometry(this.sparkleGeometry);
    }
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
    let anyActive = false;

    for (let i = 0; i < SoundSculpture.maxParticles; i += 1) {
      if (this.particleActive[i] === 0) {
        continue;
      }
      anyActive = true;

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
    if (anyActive && this.style.particlesVisible) {
      SoundSculpture.unparkPointsGeometry(this.particleGeometry, SoundSculpture.maxParticles);
    } else {
      SoundSculpture.parkPointsGeometry(this.particleGeometry);
    }
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

    if (this.style.particlesVisible) {
      SoundSculpture.unparkPointsGeometry(this.particleGeometry, SoundSculpture.maxParticles);
    }

    this.particleCursor = (this.particleCursor + 1) % SoundSculpture.maxParticles;
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
const statusElement = document.querySelector<HTMLParagraphElement>("#status");
const audioInputSelect = document.querySelector<HTMLSelectElement>("#audio-input-device");
const refreshAudioDevicesButton = document.querySelector<HTMLButtonElement>("#refresh-audio-devices");
const audioScopeCanvas = document.querySelector<HTMLCanvasElement>("#audio-scope");
const controlPanelShell = document.querySelector<HTMLElement>("#control-panel-shell");
const controlPanel = document.querySelector<HTMLElement>("#control-panel");
const toggleControlPanelButton = document.querySelector<HTMLButtonElement>("#hud-panel-toggle");
const tuningSlidersRoot = document.querySelector<HTMLElement>("#tuning-sliders");
const tuningExportText = document.querySelector<HTMLTextAreaElement>("#tuning-export-text");
const copyTuningButton = document.querySelector<HTMLButtonElement>("#copy-tuning");
const resetTuningButton = document.querySelector<HTMLButtonElement>("#reset-tuning");
const experienceStyleSelect = document.querySelector<HTMLSelectElement>("#experience-style");
const growthAlgorithmSelect = document.querySelector<HTMLSelectElement>("#growth-algorithm");
const growthAlgorithmHint = document.querySelector<HTMLElement>("#growth-algorithm-hint");
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
  !statusElement ||
  !audioInputSelect ||
  !refreshAudioDevicesButton ||
  !audioScopeCanvas ||
  !controlPanelShell ||
  !controlPanel ||
  !toggleControlPanelButton ||
  !tuningSlidersRoot ||
  !tuningExportText ||
  !copyTuningButton ||
  !resetTuningButton ||
  !experienceStyleSelect ||
  !growthAlgorithmSelect ||
  !growthAlgorithmHint
) {
  throw new Error("Required DOM elements are missing.");
}

const experienceId: ExperienceId = parseExperienceId();
const experience = getExperience(experienceId);
const sculptureMode: SculptureMode = experience.sculptureMode;
const visualStyleId: VisualStyleId = experience.visualStyleId ?? "vita";
setActiveVisualStyle(visualStyleId);
const visualStyle = getActiveVisualStyle();
// classic エンジンの作品スタイルだけ環境を差し替える
const styleEnvActive = sculptureMode === "classic";
const sceneEnv = styleEnvActive ? visualStyle.env : NEUTRAL_ENVIRONMENT;
const daytimeBackgroundInput = document.querySelector<HTMLInputElement>("#daytime-background");
const liveWeatherInput = document.querySelector<HTMLInputElement>("#live-weather");
const liveWeatherStatusEl = document.querySelector<HTMLElement>("#live-weather-status");
const weatherPreviewRoot = document.querySelector<HTMLElement>("#weather-preview");
const weatherPreviewPresetSelect =
  document.querySelector<HTMLSelectElement>("#weather-preview-preset");
const weatherPreviewValueEl = document.querySelector<HTMLElement>("#weather-preview-value");
const weatherPreviewRainInput = document.querySelector<HTMLInputElement>("#weather-preview-rain");
const weatherPreviewWindInput = document.querySelector<HTMLInputElement>("#weather-preview-wind");
const weatherPreviewRainValueEl = document.querySelector<HTMLElement>("#weather-preview-rain-value");
const weatherPreviewWindValueEl = document.querySelector<HTMLElement>("#weather-preview-wind-value");
const weatherPreviewLiveButton = document.querySelector<HTMLButtonElement>("#weather-preview-live");
const daytimePreviewRoot = document.querySelector<HTMLElement>("#daytime-preview");
const daytimePreviewHourInput = document.querySelector<HTMLInputElement>("#daytime-preview-hour");
const daytimePreviewValueEl = document.querySelector<HTMLElement>("#daytime-preview-value");
const daytimePreviewLiveButton = document.querySelector<HTMLButtonElement>("#daytime-preview-live");
let daytimeBackgroundEnabled = readDaytimeBackgroundEnabled();
/** 天気リンクはオプトイン。起動時は常にオフ */
let liveWeatherEnabled = false;
/** DEV: null なら実時刻、数値なら 0..24 のプレビュー時刻 */
let daytimePreviewHour: number | null = null;
/** DEV: live なら API / 実天気、それ以外は合成天気 */
let weatherPreviewPreset: WeatherPreviewPresetId = "live";
let weatherPreviewRainScale = 1;
let weatherPreviewWindScale = 1;
let liveWeatherSnapshot: LiveWeatherSnapshot | null = null;
let liveWeatherRefreshTimer: number | null = null;
let liveWeatherFetchSeq = 0;
if (daytimeBackgroundInput) {
  daytimeBackgroundInput.checked = daytimeBackgroundEnabled;
}
if (liveWeatherInput) {
  liveWeatherInput.checked = false;
}
if (import.meta.env.DEV && daytimePreviewRoot) {
  daytimePreviewRoot.hidden = false;
}
if (import.meta.env.DEV && weatherPreviewRoot) {
  weatherPreviewRoot.hidden = false;
}
let growthAlgorithmId: GrowthAlgorithmId =
  sculptureMode === "carve" ? "flow-field" : parseGrowthAlgorithmId();
setGrowthAlgorithmId(growthAlgorithmId);

const populateGrowthAlgorithmSelect = () => {
  growthAlgorithmSelect.innerHTML = "";
  for (const entry of GROWTH_ALGORITHM_CATALOG) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    growthAlgorithmSelect.appendChild(option);
  }
};

const applyGrowthAlgorithmUi = (id: GrowthAlgorithmId) => {
  growthAlgorithmSelect.value = id;
  const meta = getGrowthAlgorithmMeta(id);
  growthAlgorithmHint.textContent =
    sculptureMode === "carve" ? `出現パターン — ${meta.tagline}` : meta.tagline;
};

populateGrowthAlgorithmSelect();
applyGrowthAlgorithmUi(growthAlgorithmId);

if (import.meta.env.DEV && startDevAudioButton) {
  startDevAudioButton.hidden = false;
}

if (import.meta.env.DEV && bandTestPanel) {
  bandTestPanel.hidden = false;
}

if (import.meta.env.DEV) {
  document
    .querySelectorAll<HTMLElement>(".sculpture-mode, .audio-scope, .tuning-export")
    .forEach((element) => {
      element.hidden = false;
    });
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

const applyExperienceUi = (id: ExperienceId) => {
  const entry = getExperience(id);
  experienceStyleSelect.value = id;
  appElement.classList.toggle("mode-carve", entry.sculptureMode === "carve");
  appElement.classList.toggle("mode-classic", entry.sculptureMode === "classic");
  appElement.classList.toggle("mode-amoeba", entry.sculptureMode === "amoeba");
  appElement.classList.toggle("style-metamorphosis", entry.visualStyleId === "metamorphosis");
  appElement.classList.toggle("style-vita", entry.visualStyleId === "vita");
  appElement.classList.toggle("style-monolith", entry.visualStyleId === "monolith");
  if (!daytimeBackgroundEnabled) {
    appElement.classList.toggle("theme-dark", styleEnvActive && visualStyle.themeDark);
  }

  // 既定の VITA のコピーは index.html を正とし、SEO向けの初期HTMLを保持する。
  // URLで別スタイルを開いた場合のみ、そのスタイル固有のコピーへ差し替える。
  if (entry.id !== "vita") {
    const introTitle = document.querySelector<HTMLElement>("#intro-title");
    const introDescription = document.querySelector<HTMLElement>("#intro-description");
    const introDescriptionJa = document.querySelector<HTMLElement>("#intro-description-ja");
    if (introTitle) {
      introTitle.textContent = entry.introTitle;
    }
    if (introDescription) {
      introDescription.textContent = entry.introDescriptionEn ?? "";
    }
    if (introDescriptionJa) {
      introDescriptionJa.textContent = entry.introDescription.replaceAll("。", "。\n").trim();
    }
  }

  if (entry.sculptureMode === "carve") {
    document.title = "Sound Sculpture — 生み出す";
  } else if (entry.sculptureMode === "amoeba") {
    document.title = "Sound Sculpture — 生命体";
  } else if (entry.id === "vita") {
    document.title = "Sound Sculpture — 生命";
  } else if (entry.id === "monolith") {
    document.title = "Sound Sculpture — 彫刻";
  } else {
    document.title = "Sound Sculpture";
  }
};

const populateExperienceSelect = () => {
  experienceStyleSelect.innerHTML = "";
  for (const entry of EXPERIENCE_CATALOG) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    experienceStyleSelect.appendChild(option);
  }
};

populateExperienceSelect();
applyExperienceUi(experienceId);
applyGrowthAlgorithmUi(growthAlgorithmId);

experienceStyleSelect.addEventListener("change", () => {
  const nextId = experienceStyleSelect.value as ExperienceId;
  if (!EXPERIENCE_CATALOG.some((entry) => entry.id === nextId)) {
    return;
  }
  if (nextId === experienceId) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("mode");
  if (nextId === "vita") {
    url.searchParams.delete("style");
  } else {
    url.searchParams.set("style", nextId);
  }
  window.location.href = url.toString();
});

// ドラッグ直後の click ではパネルを開閉しない（アイコンは移動ハンドルを兼ねる）。
let suppressPanelToggleClick = false;

// ユーザーがドラッグで動かした後は、リサイズ時も自動で中央/ドックへ戻さない。
let controlPanelDragged = false;

type ControlPanelPosition = { left: number; top: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const getHudRemPx = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const getHudPanelGap = () => getHudRemPx() * 0.55;

const getToggleIconSize = () => getHudRemPx() * 2;

const getToggleDockPosition = (): ControlPanelPosition => {
  const rem = getHudRemPx();
  const iconSize = getToggleIconSize();
  const bottomOffset = clamp(window.innerHeight * 0.045, 1.5 * rem, 3.2 * rem);
  return {
    left: (window.innerWidth - iconSize) * 0.5,
    top: window.innerHeight - bottomOffset - iconSize,
  };
};

const applyTogglePosition = (position: ControlPanelPosition, options?: { animate?: boolean }) => {
  const iconSize = getToggleIconSize();
  const margin = 12;
  const left = clamp(position.left, margin, window.innerWidth - iconSize - margin);
  const top = clamp(position.top, margin, window.innerHeight - iconSize - margin);

  if (options?.animate === false) {
    toggleControlPanelButton.style.transition = "none";
  }

  toggleControlPanelButton.style.left = `${left}px`;
  toggleControlPanelButton.style.top = `${top}px`;
  toggleControlPanelButton.style.right = "auto";
  toggleControlPanelButton.style.bottom = "auto";

  if (options?.animate === false) {
    void toggleControlPanelButton.offsetWidth;
    toggleControlPanelButton.style.transition = "";
  }
};

const positionPanelShellAtCenter = () => {
  const shellWidth = controlPanelShell.offsetWidth;
  const shellHeight = controlPanelShell.offsetHeight;
  applyControlPanelPosition({
    left: (window.innerWidth - shellWidth) * 0.5,
    top: (window.innerHeight - shellHeight) * 0.5,
  });
};

// トグルをパネル下中央に保つ位置関係で、パネルをトグル基準に置く。
const positionPanelRelativeToToggle = () => {
  const toggleRect = toggleControlPanelButton.getBoundingClientRect();
  const iconSize = getToggleIconSize();
  const gap = getHudPanelGap();
  const panelWidth = controlPanel.offsetWidth;
  const panelHeight = controlPanel.offsetHeight;
  applyControlPanelPosition({
    left: toggleRect.left - (panelWidth - iconSize) * 0.5,
    top: toggleRect.top - gap - panelHeight,
  });
};

const getToggleOpenPosition = (): ControlPanelPosition => {
  const shellLeft = parseFloat(controlPanelShell.style.left) || 0;
  const shellTop = parseFloat(controlPanelShell.style.top) || 0;
  const panelWidth = controlPanel.offsetWidth;
  const panelHeight = controlPanel.offsetHeight;
  const iconSize = getToggleIconSize();
  return {
    left: shellLeft + (panelWidth - iconSize) * 0.5,
    top: shellTop + panelHeight + getHudPanelGap(),
  };
};

const syncToggleToPanel = (animate = false) => {
  applyTogglePosition(getToggleOpenPosition(), { animate });
};

const playControlPanelOpenAnimation = () => {
  controlPanel.classList.remove("is-closing", "is-opening", "is-open");
  void controlPanel.offsetWidth;
  controlPanel.classList.add("is-opening");

  window.setTimeout(() => {
    controlPanel.classList.add("is-open");
  }, 200);

  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== controlPanel || event.animationName !== "control-panel-expand") return;
    controlPanel.removeEventListener("animationend", onAnimationEnd);
    controlPanel.classList.remove("is-opening");
    controlPanel.style.clipPath = "none";
  };

  controlPanel.addEventListener("animationend", onAnimationEnd);
};

const playControlPanelCloseAnimation = (): Promise<void> =>
  new Promise((resolve) => {
    controlPanel.classList.remove("is-opening", "is-open");
    controlPanel.classList.add("is-closing");

    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target !== controlPanel || event.animationName !== "control-panel-collapse") return;
      controlPanel.removeEventListener("animationend", onAnimationEnd);
      controlPanel.classList.remove("is-closing");
      resolve();
    };

    controlPanel.addEventListener("animationend", onAnimationEnd);
  });

let controlPanelHasOpenedOnce = false;

const openControlPanel = () => {
  controlPanelDragged = false;
  controlPanelShell.classList.remove("is-collapsed");

  const placePanel = () => {
    if (controlPanelHasOpenedOnce) {
      // 閉じた場所（トグル位置）を基準に開く。
      positionPanelRelativeToToggle();
    } else {
      positionPanelShellAtCenter();
    }
  };

  placePanel();
  playControlPanelOpenAnimation();

  requestAnimationFrame(() => {
    placePanel();
    // パネルと重なる／上に乗る場合も含め、下中央へすーっと寄せる。
    syncToggleToPanel(true);
    controlPanelHasOpenedOnce = true;
  });

  toggleControlPanelButton.setAttribute("aria-expanded", "true");
};

const closeControlPanel = async () => {
  // 閉じてもトグルはその場に留める。
  await playControlPanelCloseAnimation();
  controlPanelShell.classList.add("is-collapsed");
  toggleControlPanelButton.setAttribute("aria-expanded", "false");
};

let panelToggleClickTimer: number | null = null;

toggleControlPanelButton.addEventListener("click", () => {
  if (suppressPanelToggleClick) {
    suppressPanelToggleClick = false;
    return;
  }
  // ダブルクリックと単クリックを切り分ける。
  if (panelToggleClickTimer !== null) {
    window.clearTimeout(panelToggleClickTimer);
    panelToggleClickTimer = null;
    return;
  }
  panelToggleClickTimer = window.setTimeout(() => {
    panelToggleClickTimer = null;
    if (controlPanelShell.classList.contains("is-collapsed")) {
      openControlPanel();
    } else {
      closeControlPanel();
    }
  }, 260);
});

/** パネル／トグル以外をクリックしたら閉じる */
document.addEventListener("pointerdown", (event) => {
  if (controlPanelShell.classList.contains("is-collapsed")) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (controlPanelShell.contains(target) || toggleControlPanelButton.contains(target)) {
    return;
  }
  void closeControlPanel();
});

toggleControlPanelButton.addEventListener("dblclick", (event) => {
  event.preventDefault();
  if (panelToggleClickTimer !== null) {
    window.clearTimeout(panelToggleClickTimer);
    panelToggleClickTimer = null;
  }
  suppressPanelToggleClick = true;

  const dock = getToggleDockPosition();
  applyTogglePosition(dock, { animate: true });

  // パネルが開いていれば、同じ位置関係のまま初期位置へ寄せる。
  if (!controlPanelShell.classList.contains("is-collapsed")) {
    const iconSize = getToggleIconSize();
    const gap = getHudPanelGap();
    applyControlPanelPosition({
      left: dock.left - (controlPanel.offsetWidth - iconSize) * 0.5,
      top: dock.top - gap - controlPanel.offsetHeight,
    });
    controlPanelDragged = false;
  }
});

// 初期表示: トグルを画面の真ん中下にドック。
{
  applyTogglePosition(getToggleDockPosition(), { animate: false });
}

// トグルをドラッグして移動（閉じているときはトグルのみ、開いているときはパネルごと）。
{
  let dragging = false;
  let didMove = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let dragMode: "toggle" | "panel" = "toggle";

  const startDrag = (event: PointerEvent) => {
    // Only left click / primary pointer.
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    dragging = true;
    didMove = false;
    toggleControlPanelButton.setPointerCapture(pointerId);
    startX = event.clientX;
    startY = event.clientY;

    if (controlPanelShell.classList.contains("is-collapsed")) {
      dragMode = "toggle";
      const rect = toggleControlPanelButton.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
    } else {
      dragMode = "panel";
      const rect = controlPanelShell.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      controlPanelShell.classList.add("is-dragging");
    }
    toggleControlPanelButton.classList.add("is-dragging");
  };

  const moveDrag = (event: PointerEvent) => {
    if (!dragging || pointerId !== event.pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!didMove && Math.hypot(dx, dy) >= 4) {
      didMove = true;
    }
    if (!didMove) return;

    if (dragMode === "toggle") {
      applyTogglePosition(
        { left: originLeft + dx, top: originTop + dy },
        { animate: false },
      );
    } else {
      applyControlPanelPosition({ left: originLeft + dx, top: originTop + dy });
      syncToggleToPanel(false);
    }
  };

  const endDrag = (event: PointerEvent) => {
    if (!dragging || pointerId !== event.pointerId) return;
    dragging = false;
    controlPanelShell.classList.remove("is-dragging");
    toggleControlPanelButton.classList.remove("is-dragging");
    pointerId = null;
    suppressPanelToggleClick = didMove;
    if (didMove && dragMode === "panel") controlPanelDragged = true;
    didMove = false;
  };

  toggleControlPanelButton.addEventListener("pointerdown", startDrag);
  toggleControlPanelButton.addEventListener("pointermove", moveDrag);
  toggleControlPanelButton.addEventListener("pointerup", endDrag);
  toggleControlPanelButton.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", () => {
    if (controlPanelShell.classList.contains("is-collapsed")) {
      // ユーザー位置を保ちつつ画面内に収める。
      const rect = toggleControlPanelButton.getBoundingClientRect();
      applyTogglePosition({ left: rect.left, top: rect.top }, { animate: false });
    } else if (controlPanelDragged) {
      const rect = controlPanelShell.getBoundingClientRect();
      applyControlPanelPosition({ left: rect.left, top: rect.top });
      syncToggleToPanel(false);
    } else {
      // 開いているときはトグル基準の位置関係を保つ。
      positionPanelRelativeToToggle();
    }
  });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(sceneEnv.background);

let themeDarkActive = styleEnvActive && visualStyle.themeDark;
if (daytimeBackgroundEnabled) {
  themeDarkActive = (
    daytimePreviewHour === null
      ? sampleDaytimeAtmosphere()
      : sampleDaytimeAtmosphereFromHour(daytimePreviewHour)
  ).dark;
  appElement.classList.toggle("theme-dark", themeDarkActive);
}

const sceneBackground = new SceneBackground(sceneEnv, themeDarkActive);
sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, 0);
sceneBackground.addToScene(scene);

const syncSceneFog = () => {
  sceneBackground.syncFog(scene, scene.background as THREE.Color, themeDarkActive);
};

syncSceneFog();

const camera = new THREE.PerspectiveCamera(
  36,
  window.innerWidth / window.innerHeight,
  0.1,
  sceneEnv.cameraFar ?? 100,
);
camera.position.set(0, 0.28, 6.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(scene.background as THREE.Color);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = sceneEnv.exposure;
renderer.shadowMap.enabled = true;
// VSM は回転時に自己影が飛んで急に暗くなることがあるため、PCF Soft を使う
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// monolith スタイル: 環境マップで石・金属の質感を出す
if (sceneEnv.environmentMap) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

const viewControls = new TrackballControls(camera, renderer.domElement);
viewControls.enabled = true;
// カメラは固定。ホイールズームだけ TrackballControls に任せる
viewControls.noRotate = true;
viewControls.noPan = true;
viewControls.staticMoving = false;
viewControls.dynamicDampingFactor = 0.08;
viewControls.rotateSpeed = 1.4;
viewControls.minDistance = 3.4;
viewControls.maxDistance = 9;
viewControls.target.set(0, 0, 0);
camera.lookAt(viewControls.target);

let isViewInteracting = false;
const sculptureDrag = {
  active: false,
  moved: false,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  id: null as number | null,
};
viewControls.addEventListener("start", () => {
  isViewInteracting = true;
});
viewControls.addEventListener("end", () => {
  isViewInteracting = false;
});

/** 再生中だけカメラに載せる、ランダムな方向へスーッと流れるカメラワーク */
const cameraSwayRight = new THREE.Vector3();
const cameraSwayUp = new THREE.Vector3();
const cameraSwayFwd = new THREE.Vector3();
const cameraSwayOffset = new THREE.Vector3();
const cameraSwayPrevOffset = new THREE.Vector3();
/** カメラローカル: x=右, y=上, z=dolly(前が負) */
const cameraSwayCurrent = new THREE.Vector3();
const cameraSwaySmoothed = new THREE.Vector3();
const cameraSwayTarget = new THREE.Vector3();
let cameraSwayAmp = 0;
let cameraSwayLegTimer = 0;
let cameraSwayLegDuration = 0;
const CAMERA_DRIFT_RADIUS = 0.22;
/** 追従の時定数（小さいほどゆっくり滑る） */
const CAMERA_DRIFT_SMOOTHING = 0.09;

const pickCameraDriftTarget = () => {
  // 右下 / 左 / 右上 / 左…のような大まかな方角をランダムに選ぶ
  const quadrant = Math.floor(Math.random() * 4);
  const angle =
    quadrant === 0
      ? -Math.PI * 0.28 + (Math.random() - 0.5) * 0.35 // 右下
      : quadrant === 1
        ? Math.PI * 0.92 + (Math.random() - 0.5) * 0.4 // 左
        : quadrant === 2
          ? Math.PI * 0.28 + (Math.random() - 0.5) * 0.35 // 右上
          : -Math.PI * 0.92 + (Math.random() - 0.5) * 0.4; // 左寄り下〜上
  const radius = CAMERA_DRIFT_RADIUS * (0.55 + Math.random() * 0.45);
  cameraSwayTarget.set(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * 0.85,
    (Math.random() - 0.5) * CAMERA_DRIFT_RADIUS * 0.2,
  );
  cameraSwayLegTimer = 0;
  cameraSwayLegDuration = 14 + Math.random() * 10;
};

/** TrackballControls がオフセット込みの位置を基準にしないよう、先に外す */
const clearAudioCameraSway = () => {
  if (cameraSwayPrevOffset.lengthSq() === 0) {
    return;
  }
  camera.position.sub(cameraSwayPrevOffset);
  cameraSwayPrevOffset.set(0, 0, 0);
};

const updateAudioCameraSway = (
  deltaTime: number,
  _bands: AudioBands,
  _rhythm: RhythmEvents,
  active: boolean,
) => {
  // 音量には反応させない（脈打つと酔うので、再生中は一定振幅でゆったり漂うだけ）
  const interactDamp = isViewInteracting ? 0.08 : 1;
  const targetAmp = (active ? 1 : 0) * interactDamp;
  cameraSwayAmp += (targetAmp - cameraSwayAmp) * Math.min(1, deltaTime * 0.4);

  if (cameraSwayAmp < 0.002 && cameraSwayCurrent.lengthSq() < 1e-8) {
    return;
  }

  if (cameraSwayAmp >= 0.002) {
    cameraSwayLegTimer += deltaTime;
    if (cameraSwayLegTimer >= cameraSwayLegDuration) {
      pickCameraDriftTarget();
    }
  } else {
    cameraSwayTarget.set(0, 0, 0);
  }

  // 二重スムージング: 目標→中間→現在と2段階でならすことで、
  // 目標が切り替わっても速度が途切れず、常になめらかに滑り続ける
  const k = Math.min(1, deltaTime * CAMERA_DRIFT_SMOOTHING * 2);
  cameraSwaySmoothed.lerp(cameraSwayTarget, k);
  cameraSwayCurrent.lerp(cameraSwaySmoothed, k);

  const a = cameraSwayAmp;
  cameraSwayRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  cameraSwayUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  camera.getWorldDirection(cameraSwayFwd);

  cameraSwayOffset
    .set(0, 0, 0)
    .addScaledVector(cameraSwayRight, cameraSwayCurrent.x * a)
    .addScaledVector(cameraSwayUp, cameraSwayCurrent.y * a)
    .addScaledVector(cameraSwayFwd, -cameraSwayCurrent.z * a);
  camera.position.add(cameraSwayOffset);
  cameraSwayPrevOffset.copy(cameraSwayOffset);
};

const sculpture: SculptureExperience =
  sculptureMode === "amoeba"
    ? new AmoebaSculpture({
        consumeOrganBudget: (cost) => structureTracker.consumeOrganBudget(cost),
      })
    : sculptureMode === "carve"
      ? new CarveSculpture()
      : new SoundSculpture();
scene.add(sculpture.group);

// ドラッグ: オブジェクト自体を回す。背景とライトは回転量の3%だけ追従
const viewRaycaster = new THREE.Raycaster();
const viewPointerNdc = new THREE.Vector2();
const sculptureHitLocal = new THREE.Vector3();
const sculptureRotateAxis = new THREE.Vector3();
const sculptureRotateDelta = new THREE.Quaternion();
const SCULPTURE_ROTATE_SPEED = 0.0058;
const sculptureStickEl = document.querySelector<HTMLElement>("#sculpture-stick");
const sculptureStickHandleEl = document.querySelector<HTMLElement>(".hud-reticle__handle");
const sculptureStick = {
  active: false,
  id: null as number | null,
  x: 0,
  y: 0,
};
const sculptureStickMove = {
  active: false,
  id: null as number | null,
  startX: 0,
  startY: 0,
  originLeft: 0,
  originTop: 0,
};
const SCULPTURE_STICK_MAX_SPEED = 0.72;

// イージング用: ドラッグ量は保留分に貯め、毎フレーム滑らかに消化する（離した後は慣性でゆっくり止まる）
let pendingYaw = 0;
let pendingPitch = 0;

const queueSculptureRotation = (dx: number, dy: number) => {
  pendingYaw += dx * SCULPTURE_ROTATE_SPEED;
  pendingPitch += dy * SCULPTURE_ROTATE_SPEED;
};

const applySculptureRotation = (yaw: number, pitch: number) => {
  sculptureRotateAxis.set(0, 1, 0).applyQuaternion(camera.quaternion);
  sculptureRotateDelta.setFromAxisAngle(sculptureRotateAxis, yaw);
  sculpture.group.quaternion.premultiply(sculptureRotateDelta);

  sculptureRotateAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
  sculptureRotateDelta.setFromAxisAngle(sculptureRotateAxis, pitch);
  sculpture.group.quaternion.premultiply(sculptureRotateDelta);
};

/** オブジェクトを初期向きへすっと戻す。ライト・背景はワールド固定のまま。 */
const sculptureOrientIdentity = new THREE.Quaternion();
const sculptureOrientReset = {
  active: false,
  elapsed: 0,
  duration: 0.85,
  fromSculpture: new THREE.Quaternion(),
};

const resetSculptureViewOrientation = () => {
  pendingYaw = 0;
  pendingPitch = 0;
  sculptureOrientReset.fromSculpture.copy(sculpture.group.quaternion);
  sculptureOrientReset.elapsed = 0;
  sculptureOrientReset.active = true;
};

const updateSculptureOrientationReset = (deltaTime: number) => {
  if (!sculptureOrientReset.active) return;
  if (sculptureStick.active || sculptureDrag.active) {
    sculptureOrientReset.active = false;
    return;
  }

  sculptureOrientReset.elapsed += deltaTime;
  const t = Math.min(1, sculptureOrientReset.elapsed / sculptureOrientReset.duration);
  // easeOutCubic: 速く動き始めてゆっくり止まる
  const eased = 1 - (1 - t) ** 3;

  sculpture.group.quaternion
    .copy(sculptureOrientReset.fromSculpture)
    .slerp(sculptureOrientIdentity, eased);

  if (t >= 1) {
    sculptureOrientReset.active = false;
    sculpture.group.quaternion.identity();
    hudTickPitchDisplay = 0.5;
    hudTickYawDisplay = 0.5;
    hudTickPreviousYaw = 0;
    hudTickYawUnwrapped = 0;
  }
};

const updateSculptureRotationEasing = (deltaTime: number) => {
  if (sculptureOrientReset.active) return;
  if (sculptureStick.active) {
    pendingYaw += sculptureStick.x * SCULPTURE_STICK_MAX_SPEED * deltaTime;
    pendingPitch += sculptureStick.y * SCULPTURE_STICK_MAX_SPEED * deltaTime;
  }

  if (Math.abs(pendingYaw) < 1e-5 && Math.abs(pendingPitch) < 1e-5) {
    pendingYaw = 0;
    pendingPitch = 0;
    return;
  }
  // ドラッグ中はやや速く追従、離した後は残りが指数的に減ってスッと止まる
  const follow = Math.min(
    1,
    deltaTime * (sculptureDrag.active || sculptureStick.active ? 9 : 4.2),
  );
  const yaw = pendingYaw * follow;
  const pitch = pendingPitch * follow;
  pendingYaw -= yaw;
  pendingPitch -= pitch;
  applySculptureRotation(yaw, pitch);
};

const setSculptureStickFromPointer = (clientX: number, clientY: number) => {
  if (!sculptureStickEl) return;
  const rect = sculptureStickEl.getBoundingClientRect();
  const maxTravel = rect.width * 0.27;
  let x = clientX - (rect.left + rect.width * 0.5);
  let y = clientY - (rect.top + rect.height * 0.5);
  const length = Math.hypot(x, y);
  if (length > maxTravel) {
    const scale = maxTravel / length;
    x *= scale;
    y *= scale;
  }
  sculptureStick.x = x / maxTravel;
  sculptureStick.y = y / maxTravel;
  sculptureStickEl.style.setProperty("--stick-x", `${x.toFixed(2)}px`);
  sculptureStickEl.style.setProperty("--stick-y", `${y.toFixed(2)}px`);
};

const releaseSculptureStick = () => {
  if (!sculptureStickEl) return;
  sculptureStick.active = false;
  sculptureStick.id = null;
  sculptureStick.x = 0;
  sculptureStick.y = 0;
  sculptureStickEl.classList.remove("is-active");
  sculptureStickEl.style.setProperty("--stick-x", "0px");
  sculptureStickEl.style.setProperty("--stick-y", "0px");
  if (!sculptureDrag.active) {
    isViewInteracting = false;
  }
};

const applySculptureStickPosition = (left: number, top: number) => {
  if (!sculptureStickEl) return;
  const margin = 12;
  const width = sculptureStickEl.offsetWidth;
  const height = sculptureStickEl.offsetHeight;
  const handleWidth = sculptureStickHandleEl?.offsetWidth ?? 0;
  // ハンドルは右側に出るので、右端だけ余裕を見る
  const clampedLeft = clamp(left, margin, window.innerWidth - width - handleWidth - margin);
  const clampedTop = clamp(top, margin, window.innerHeight - height - margin);
  sculptureStickEl.style.left = `${clampedLeft}px`;
  sculptureStickEl.style.top = `${clampedTop}px`;
  sculptureStickEl.style.right = "auto";
  sculptureStickEl.style.bottom = "auto";
  sculptureStickEl.style.transform = "none";
};

let sculptureStickUserMoved = false;

const getSculptureStickDockPosition = (): { left: number; top: number } => {
  if (!sculptureStickEl) return { left: 0, top: 0 };
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // intro / hud-left-bottom と同じ左インセットに揃える
  const introEl = document.querySelector<HTMLElement>(".intro");
  const leftBottomEl = document.querySelector<HTMLElement>(".hud-left-bottom");
  const alignedLeft =
    introEl?.getBoundingClientRect().left ??
    leftBottomEl?.getBoundingClientRect().left ??
    clamp(window.innerWidth * 0.045, 1.5 * rem, 3.2 * rem);
  const height = sculptureStickEl.offsetHeight;
  const introBottom = introEl?.getBoundingClientRect().bottom ?? 0;
  const metersTop = leftBottomEl?.getBoundingClientRect().top ?? window.innerHeight;
  const centerY = (introBottom + metersTop) * 0.5;
  return {
    left: alignedLeft,
    top: centerY - height * 0.5,
  };
};

const dockSculptureStick = (options: { force?: boolean; animate?: boolean } = {}) => {
  if (!sculptureStickEl) return;
  if (!options.force && sculptureStickUserMoved) return;
  const dock = getSculptureStickDockPosition();
  if (options.animate) {
    sculptureStickEl.classList.add("is-docking");
    const clearDocking = (event: TransitionEvent) => {
      if (event.propertyName !== "left" && event.propertyName !== "top") return;
      sculptureStickEl.classList.remove("is-docking");
      sculptureStickEl.removeEventListener("transitionend", clearDocking);
    };
    sculptureStickEl.addEventListener("transitionend", clearDocking);
    window.setTimeout(() => {
      sculptureStickEl.classList.remove("is-docking");
      sculptureStickEl.removeEventListener("transitionend", clearDocking);
    }, 520);
  }
  applySculptureStickPosition(dock.left, dock.top);
};

requestAnimationFrame(() => {
  dockSculptureStick();
});
window.addEventListener("resize", () => dockSculptureStick());

if (sculptureStickHandleEl && sculptureStickEl) {
  sculptureStickHandleEl.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    releaseSculptureStick();
    sculptureStickMove.active = true;
    sculptureStickMove.id = event.pointerId;
    sculptureStickMove.startX = event.clientX;
    sculptureStickMove.startY = event.clientY;
    const rect = sculptureStickEl.getBoundingClientRect();
    sculptureStickMove.originLeft = rect.left;
    sculptureStickMove.originTop = rect.top;
    sculptureStickHandleEl.setPointerCapture(event.pointerId);
    sculptureStickEl.classList.add("is-moving");
    sculptureStickUserMoved = true;
  });

  sculptureStickHandleEl.addEventListener("pointermove", (event: PointerEvent) => {
    if (!sculptureStickMove.active || sculptureStickMove.id !== event.pointerId) return;
    event.preventDefault();
    applySculptureStickPosition(
      sculptureStickMove.originLeft + (event.clientX - sculptureStickMove.startX),
      sculptureStickMove.originTop + (event.clientY - sculptureStickMove.startY),
    );
  });

  const endSculptureStickMove = (event: PointerEvent) => {
    if (sculptureStickMove.id !== event.pointerId) return;
    sculptureStickMove.active = false;
    sculptureStickMove.id = null;
    sculptureStickEl.classList.remove("is-moving");
  };

  sculptureStickHandleEl.addEventListener("pointerup", endSculptureStickMove);
  sculptureStickHandleEl.addEventListener("pointercancel", endSculptureStickMove);
}

sculptureStickEl?.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) return;
  if (sculptureStickMove.active) return;
  if (event.target instanceof Element && event.target.closest(".hud-reticle__handle")) return;
  event.preventDefault();
  sculptureStick.active = true;
  sculptureStick.id = event.pointerId;
  sculptureStickEl.setPointerCapture(event.pointerId);
  sculptureStickEl.classList.add("is-active");
  isViewInteracting = true;
  setSculptureStickFromPointer(event.clientX, event.clientY);
});

sculptureStickEl?.addEventListener("pointermove", (event: PointerEvent) => {
  if (!sculptureStick.active || sculptureStick.id !== event.pointerId) return;
  event.preventDefault();
  setSculptureStickFromPointer(event.clientX, event.clientY);
});

sculptureStickEl?.addEventListener("pointerup", (event: PointerEvent) => {
  if (sculptureStick.id !== event.pointerId) return;
  releaseSculptureStick();
});

sculptureStickEl?.addEventListener("pointercancel", releaseSculptureStick);
sculptureStickEl?.addEventListener("lostpointercapture", releaseSculptureStick);

sculptureStickEl?.addEventListener("dblclick", (event) => {
  event.preventDefault();
  event.stopPropagation();
  releaseSculptureStick();
  if (sculptureStickMove.active) {
    sculptureStickMove.active = false;
    sculptureStickMove.id = null;
    sculptureStickEl.classList.remove("is-moving");
  }
  sculptureStickUserMoved = false;
  dockSculptureStick({ force: true, animate: true });
  resetSculptureViewOrientation();
});

const pokeSculptureAtClient = (clientX: number, clientY: number) => {
  const targets = sculpture.getPointerTargets?.();
  if (!targets?.length) {
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  viewPointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  viewRaycaster.setFromCamera(viewPointerNdc, camera);
  const hits = viewRaycaster.intersectObjects(targets, false);
  if (!hits.length) {
    return;
  }
  sculptureHitLocal.copy(hits[0].point);
  sculpture.group.worldToLocal(sculptureHitLocal);
  sculpture.pokeSurface?.(sculptureHitLocal);
  sculpture.pokeIdle?.();
};

const starPointerNdc = new THREE.Vector2();
let starPointerActive = false;

const syncStarPointerFromClient = (clientX: number, clientY: number) => {
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    starPointerActive = false;
    return;
  }
  starPointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  starPointerActive = true;
};

renderer.domElement.addEventListener("pointermove", (event: PointerEvent) => {
  syncStarPointerFromClient(event.clientX, event.clientY);
  if (!sculptureDrag.active || sculptureDrag.id !== event.pointerId) {
    return;
  }
  const dx = event.clientX - sculptureDrag.lastX;
  const dy = event.clientY - sculptureDrag.lastY;
  sculptureDrag.lastX = event.clientX;
  sculptureDrag.lastY = event.clientY;
  if (!sculptureDrag.moved) {
    const total = Math.hypot(
      event.clientX - sculptureDrag.startX,
      event.clientY - sculptureDrag.startY,
    );
    if (total < 4) {
      return;
    }
    sculptureDrag.moved = true;
    isViewInteracting = true;
  }
  queueSculptureRotation(dx, dy);
});
renderer.domElement.addEventListener("pointerleave", () => {
  starPointerActive = false;
});
renderer.domElement.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) return;
  sculptureDrag.active = true;
  sculptureDrag.moved = false;
  sculptureDrag.startX = event.clientX;
  sculptureDrag.startY = event.clientY;
  sculptureDrag.lastX = event.clientX;
  sculptureDrag.lastY = event.clientY;
  sculptureDrag.id = event.pointerId;
  renderer.domElement.setPointerCapture(event.pointerId);
  syncStarPointerFromClient(event.clientX, event.clientY);
});
renderer.domElement.addEventListener("pointerup", (event: PointerEvent) => {
  if (event.button !== 0 || sculptureDrag.id !== event.pointerId) return;
  const moved = sculptureDrag.moved;
  sculptureDrag.active = false;
  sculptureDrag.id = null;
  renderer.domElement.releasePointerCapture(event.pointerId);
  if (!moved) {
    pokeSculptureAtClient(event.clientX, event.clientY);
  }
  isViewInteracting = false;
});
renderer.domElement.addEventListener("pointercancel", () => {
  sculptureDrag.active = false;
  sculptureDrag.id = null;
  isViewInteracting = false;
  starPointerActive = false;
});

// ライト一式はワールド上方に固定（回しても光源方向は変わらない）
const lightRig = new THREE.Group();
scene.add(lightRig);

const keyLight = new THREE.DirectionalLight(0xffffff, sceneEnv.key);
keyLight.position.set(1.6, 6.4, 2.4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 22;
keyLight.shadow.camera.left = -9;
keyLight.shadow.camera.right = 9;
keyLight.shadow.camera.top = 9;
keyLight.shadow.camera.bottom = -9;
keyLight.shadow.radius = 4;
keyLight.shadow.blurSamples = 8;
keyLight.shadow.bias = -0.0002;
keyLight.shadow.normalBias = 0.035;
lightRig.add(keyLight);
lightRig.add(keyLight.target);

const fillLight = new THREE.DirectionalLight(sceneEnv.fillColor ?? 0xe8f0ff, sceneEnv.fill);
fillLight.position.set(-3.2, 4.8, 2.6);
lightRig.add(fillLight);

// 反対側からの弱いフィルで陰影を広げ、全体に広がりを出す
const softFillLight = new THREE.DirectionalLight(sceneEnv.fillColor ?? 0xe8f0ff, sceneEnv.fill * 0.55);
softFillLight.position.set(2.4, 3.8, -3.6);
lightRig.add(softFillLight);

const ambientLight = new THREE.HemisphereLight(
  0xffffff,
  sceneEnv.hemisphereGround ?? 0xd6d0c6,
  sceneEnv.ambient,
);
lightRig.add(ambientLight);

if (sceneEnv.rimLightIntensity) {
  const rimLight = new THREE.DirectionalLight(
    sceneEnv.rimLightColor ?? 0x6ec8ff,
    sceneEnv.rimLightIntensity,
  );
  rimLight.position.set(-1.2, 2.8, -5.5);
  lightRig.add(rimLight);
}

// monolith スタイル: ギャラリーの台座
if (sceneEnv.pedestal) {
  sceneBackground.setPedestalLayout(true);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.08, 1.2, 0.8, 64),
    new THREE.MeshStandardMaterial({ color: 0x35343a, roughness: 0.85, metalness: 0.08 }),
  );
  pedestal.position.y = -2.22;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  scene.add(pedestal);
}

// monolith スタイル: 完成時に灯るギャラリーのスポットライト
let spotLight: THREE.SpotLight | null = null;
if (sceneEnv.spotlight) {
  spotLight = new THREE.SpotLight(0xfff2df, 0, 0, 0.44, 0.55, 0);
  spotLight.position.set(0.5, 7.2, 0.8);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.set(1024, 1024);
  spotLight.shadow.radius = 7;
  spotLight.shadow.blurSamples = 12;
  spotLight.shadow.bias = -0.0004;
  spotLight.target.position.set(0, -0.3, 0);
  scene.add(spotLight, spotLight.target);
}

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
/** しきい値超えが連続した秒数。一瞬のノイズでは無音カウントを落とさない */
let loudBurstSeconds = 0;
const audioScopeContext = audioScopeCanvas.getContext("2d");

// --- HUD（計測風オーバーレイ） ---
const hudLowEl = document.querySelector<HTMLElement>("#hud-low");
const hudMidEl = document.querySelector<HTMLElement>("#hud-mid");
const hudHighEl = document.querySelector<HTMLElement>("#hud-high");
const hudSignalEl = document.querySelector<HTMLElement>("#hud-signal");
const hudStatusEl = document.querySelector<HTMLElement>("#hud-status");
const hudLocalTimeEl = document.querySelector<HTMLElement>("#hud-local-time");
const hudLocalTimeFieldEl = document.querySelector<HTMLElement>("#hud-local-time-field");
const hudWeatherEl = document.querySelector<HTMLElement>("#hud-weather");
const hudWeatherFieldEl = document.querySelector<HTMLElement>("#hud-weather-field");
const hudTimecodeEl = document.querySelector<HTMLElement>("#hud-timecode");
const hudBpmEl = document.querySelector<HTMLElement>("#hud-bpm");
const hudAlgoEl = document.querySelector<HTMLElement>("#hud-algo");
const hudScopeEl = document.querySelector<HTMLElement>("#hud-scope");
const hudTicksEl = document.querySelector<HTMLElement>("#hud-ticks");
const hudTicksXEl = document.querySelector<HTMLElement>("#hud-ticks-x");

/** オブジェクトの向きを連続座標で示す照準 */
const HUD_TICK_COUNT = 13;
const hudTickForward = new THREE.Vector3();
const hudTickCamUp = new THREE.Vector3();
let hudTickPitchDisplay = 0.5;
let hudTickYawDisplay = 0.5;
let hudTickPreviousYaw = 0;
let hudTickYawUnwrapped = 0;

const createHudTickMarks = (element: HTMLElement | null) => {
  if (!element) return [] as HTMLElement[];
  const marks: HTMLElement[] = [];
  for (let i = 0; i < HUD_TICK_COUNT; i += 1) {
    const mark = document.createElement("span");
    mark.className = "hud-tick-mark";
    element.append(mark);
    marks.push(mark);
  }
  return marks;
};

const hudTickMarks = createHudTickMarks(hudTicksEl);
const hudTickXMarks = createHudTickMarks(hudTicksXEl);

const updateHudTickLengths = (marks: HTMLElement[], position: number, cyclic = false) => {
  for (let i = 0; i < marks.length; i += 1) {
    let distance = Math.abs(i - position);
    if (cyclic) {
      distance = Math.min(distance, HUD_TICK_COUNT - distance);
    }
    const proximity = THREE.MathUtils.clamp(1 - distance, 0, 1);
    // 端で速度が急変しないよう smoothstep で伸縮させる
    const grow = proximity * proximity * (3 - 2 * proximity);
    marks[i].style.setProperty("--tick-grow", grow.toFixed(4));
  }
};

const updateHudTicks = (deltaTime: number) => {
  if (sculptureOrientReset.active) return;
  // オブジェクト前方をカメラ上方向で測る（ドラッグ回転と同じ軸。ワールドYだと横回転でも縦が動く）
  hudTickForward.set(0, 0, 1).applyQuaternion(sculpture.group.quaternion);
  hudTickCamUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const follow = 1 - Math.exp(-deltaTime * 5);

  if (hudTicksEl) {
    // カメラ上方向への傾き。横ドラッグ（カメラ上まわり）では不変
    const pitch = Math.asin(
      THREE.MathUtils.clamp(hudTickForward.dot(hudTickCamUp), -1, 1),
    );
    // ±約50°で端まで届く（πだと90°近くまで回さないと端に届かない）
    const target = THREE.MathUtils.clamp(0.5 - pitch / (Math.PI * 0.55), 0, 1);
    hudTickPitchDisplay += (target - hudTickPitchDisplay) * follow;
    updateHudTickLengths(hudTickMarks, hudTickPitchDisplay * (HUD_TICK_COUNT - 1));
  }

  if (hudTicksXEl) {
    // ヨー（左右）はワールド水平面。縦とは独立して一周する
    const yaw = Math.atan2(hudTickForward.x, hudTickForward.z);
    let yawDelta = yaw - hudTickPreviousYaw;
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    hudTickYawUnwrapped += yawDelta;
    hudTickPreviousYaw = yaw;
    const target = hudTickYawUnwrapped / (Math.PI * 2) + 0.5;
    hudTickYawDisplay += (target - hudTickYawDisplay) * follow;
    const wrapped = ((hudTickYawDisplay % 1) + 1) % 1;
    updateHudTickLengths(hudTickXMarks, wrapped * HUD_TICK_COUNT, true);
  }
};

let hudSignalLabel = "---";
let hudFormingSeconds = 0;
let hudTextTimer = 1;
let hudLastBpm = 0;

const formatHudTimecode = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const c = Math.floor((seconds % 1) * 100);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(m)}.${pad(s)}.${pad(c)}`;
};

/** 左下: エンベロープ小 → // / 大 → //////////////////// （初期は100%） */
const HUD_SLASH_MIN = 2;
const HUD_SLASH_MAX = 20;
let hudSlashLevel = 1;

const updateHudScope = (bands: AudioBands, rhythmEvents: RhythmEvents, deltaTime: number) => {
  if (!hudScopeEl) {
    return;
  }
  if (!isAudioReady || isComplete) {
    hudSlashLevel = 1;
    hudScopeEl.textContent = "/".repeat(HUD_SLASH_MAX);
    return;
  }
  const envelope = Math.min(
    1,
    rhythmEvents.pulseEnvelope * 0.7 +
      rhythmEvents.waveEnergy * 0.55 +
      bands.overall * 0.45,
  );
  const follow = Math.min(1, deltaTime * (envelope > hudSlashLevel ? 18 : 8));
  hudSlashLevel += (envelope - hudSlashLevel) * follow;
  const count = Math.max(
    HUD_SLASH_MIN,
    Math.round(HUD_SLASH_MIN + hudSlashLevel * (HUD_SLASH_MAX - HUD_SLASH_MIN)),
  );
  hudScopeEl.textContent = "/".repeat(count);
};

const updateHud = (
  bands: AudioBands,
  rhythmEvents: RhythmEvents,
  deltaTime: number,
) => {
  if (isAudioReady && !isComplete) {
    hudFormingSeconds += deltaTime;
  }
  updateHudScope(bands, rhythmEvents, deltaTime);
  updateHudTicks(deltaTime);

  hudTextTimer += deltaTime;
  if (hudTextTimer < 0.12) {
    return;
  }
  hudTextTimer = 0;

  if (hudLowEl) hudLowEl.textContent = bands.low.toFixed(2);
  if (hudMidEl) hudMidEl.textContent = bands.mid.toFixed(2);
  if (hudHighEl) hudHighEl.textContent = bands.high.toFixed(2);
  if (hudTimecodeEl) hudTimecodeEl.textContent = formatHudTimecode(hudFormingSeconds);
  if (hudSignalEl) hudSignalEl.textContent = hudSignalLabel;
  if (hudStatusEl) {
    hudStatusEl.textContent = isComplete ? "COMPLETE" : isAudioReady ? "FORMING" : "STANDBY";
  }
  if (hudBpmEl) {
    if (rhythmEvents.bpm > 0 && rhythmEvents.pulseConfidence >= 0.35) {
      hudLastBpm = rhythmEvents.bpm;
    }
    hudBpmEl.textContent = hudLastBpm > 0 ? hudLastBpm.toFixed(0) : "---";
  }
  if (hudAlgoEl) hudAlgoEl.textContent = growthAlgorithmId.toUpperCase();
};

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

  const cyanLevel = scopeCyanDrive(rhythmEvents);
  const meterW = 6;
  ctx.fillStyle = "rgba(22,22,22,0.08)";
  ctx.fillRect(w - meterW - 4, 4, meterW, scopeH - 8);
  ctx.fillStyle = "rgba(61,124,255,0.5)";
  ctx.fillRect(
    w - meterW - 4,
    scopeH - 4 - cyanLevel * (scopeH - 12),
    meterW,
    cyanLevel * (scopeH - 12),
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
      `sp O${species.organic.toFixed(2)} A${species.aggressive.toFixed(2)} R${species.rhythmic.toFixed(2)} c${species.confidence.toFixed(2)}${species.finalized ? " fin" : ""}`,
      4,
      y + 22,
    );
    ctx.fillText(`evt ${structure.lastEventLabel}`, w * 0.52, y + 22);
  }
};

const setStatus = (message: string) => {
  statusElement.textContent = message;
};

growthAlgorithmSelect.addEventListener("change", () => {
  const nextId = growthAlgorithmSelect.value as GrowthAlgorithmId;
  if (!GROWTH_ALGORITHM_CATALOG.some((entry) => entry.id === nextId)) {
    return;
  }
  if (nextId === growthAlgorithmId) {
    return;
  }
  growthAlgorithmId = nextId;
  setGrowthAlgorithmId(nextId);
  applyGrowthAlgorithmUi(nextId);
  sculpture.applyAlgoMorphBias?.();

  const url = new URL(window.location.href);
  if (nextId === "fibonacci") {
    url.searchParams.delete("algo");
  } else {
    url.searchParams.set("algo", nextId);
  }
  window.history.replaceState(null, "", url.toString());

  sculpture.reset(audioInput.getMorphologySeed() ?? undefined);
  rhythm.reset();
  structureTracker.reset();
  speciesProfiler.reset();
  setStatus("成長アルゴリズムを変更しました — 形成を再開できます");
});

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

// --- 完成時の環境クロスフェード（背景・ライト・スポットライト） ---
let envMix = 0;
const envBackgroundForming = new THREE.Color(sceneEnv.background);
const envBackgroundComplete = new THREE.Color(sceneEnv.backgroundComplete);
const envLerp = (from: number, to: number) => from + (to - from) * envMix;
let lastLocalTimeLabel = "";
const daytimeZenithColor = new THREE.Color();
const daytimeHorizonColor = new THREE.Color();
let daytimeSkyActive = false;

const getActiveDaytimeHour = () =>
  daytimePreviewHour === null ? getLocalHourFraction() : daytimePreviewHour;

const syncDaytimePreviewLabel = () => {
  if (!daytimePreviewValueEl) {
    return;
  }
  daytimePreviewValueEl.textContent =
    daytimePreviewHour === null ? "LIVE" : formatAmPmFromHour(daytimePreviewHour);
};

const LIVE_WEATHER_REFRESH_MS = 10 * 60 * 1000;

const clearLiveWeatherRefreshTimer = () => {
  if (liveWeatherRefreshTimer !== null) {
    window.clearInterval(liveWeatherRefreshTimer);
    liveWeatherRefreshTimer = null;
  }
};

const setLiveWeatherStatus = (message: string, visible = true) => {
  if (!liveWeatherStatusEl) {
    return;
  }
  liveWeatherStatusEl.hidden = !visible || !message;
  liveWeatherStatusEl.textContent = message;
};

const updateWeatherHud = () => {
  if (hudWeatherFieldEl) {
    hudWeatherFieldEl.hidden = !liveWeatherEnabled;
  }
  if (!hudWeatherEl) {
    return;
  }
  if (!liveWeatherEnabled) {
    hudWeatherEl.textContent = "---";
    return;
  }
  const active = getActiveWeatherSnapshot();
  const prefix =
    import.meta.env.DEV && weatherPreviewPreset !== "live" ? "DEV/" : "";
  hudWeatherEl.textContent = active ? `${prefix}${active.label}` : "...";
};

const getActiveWeatherSnapshot = (): LiveWeatherSnapshot | null => {
  if (import.meta.env.DEV && weatherPreviewPreset !== "live") {
    return createWeatherPreviewSnapshot(
      weatherPreviewPreset,
      weatherPreviewRainScale,
      weatherPreviewWindScale,
    );
  }
  if (!liveWeatherEnabled) {
    return null;
  }
  return liveWeatherSnapshot;
};

const isWeatherFxActive = () =>
  (import.meta.env.DEV && weatherPreviewPreset !== "live") || liveWeatherEnabled;

const snapshotToSceneWeather = (snapshot: LiveWeatherSnapshot | null): SceneWeatherState => {
  if (!snapshot || !isWeatherFxActive()) {
    return {
      enabled: false,
      cloudCover: 0,
      rainIntensity: 0,
      windStrength: 0,
      windX: 0,
      windZ: 0,
      snow: false,
      fogBoost: 1,
    };
  }
  const fogBoost =
    1 +
    snapshot.cloudCover * 0.35 +
    snapshot.rainIntensity * 0.55 +
    (snapshot.condition === "fog" ? 0.7 : 0);
  return {
    enabled: true,
    cloudCover: snapshot.cloudCover,
    rainIntensity: snapshot.rainIntensity,
    windStrength: snapshot.windStrength,
    windX: snapshot.windX,
    windZ: snapshot.windZ,
    snow: snapshot.condition === "snow",
    fogBoost,
  };
};

const applyLiveWeatherToScene = () => {
  sceneBackground.setWeather(snapshotToSceneWeather(getActiveWeatherSnapshot()));
  updateWeatherHud();
};

const tintHexWithClouds = (hex: number, cloudCover: number) => {
  const active = getActiveWeatherSnapshot();
  if (!isWeatherFxActive() || !active || cloudCover < 0.05) {
    return hex;
  }
  return applyCloudCoverToSky(hex, hex, cloudCover).zenith;
};

const syncDaytimeEnvironmentTargets = () => {
  const activeWeather = getActiveWeatherSnapshot();
  const cloudCover =
    isWeatherFxActive() && activeWeather ? activeWeather.cloudCover : 0;

  if (daytimeBackgroundEnabled) {
    const atmosphere = sampleDaytimeAtmosphereFromHour(getActiveDaytimeHour());
    const sky = applyCloudCoverToSky(atmosphere.zenith, atmosphere.horizon, cloudCover);
    const forming = tintHexWithClouds(atmosphere.forming, cloudCover);
    const complete = tintHexWithClouds(atmosphere.complete, cloudCover);
    envBackgroundForming.setHex(forming);
    envBackgroundComplete.setHex(complete);
    daytimeZenithColor.setHex(sky.zenith);
    daytimeHorizonColor.setHex(sky.horizon);
    daytimeSkyActive = true;
    const bgCss = `#${forming.toString(16).padStart(6, "0")}`;
    appElement.classList.add("daytime-linked");
    appElement.style.setProperty("--daytime-bg", bgCss);
    themeDarkActive = atmosphere.dark || cloudCover > 0.72;
    appElement.classList.toggle("theme-dark", themeDarkActive);
    return;
  }
  daytimeSkyActive = false;
  appElement.classList.remove("daytime-linked");
  appElement.style.removeProperty("--daytime-bg");
  envBackgroundForming.setHex(tintHexWithClouds(sceneEnv.background, cloudCover));
  envBackgroundComplete.setHex(tintHexWithClouds(sceneEnv.backgroundComplete, cloudCover));
  const styleDark = styleEnvActive && visualStyle.themeDark;
  themeDarkActive = styleDark || cloudCover > 0.78;
  appElement.classList.toggle("theme-dark", themeDarkActive);
};

const updateLocalClockHud = () => {
  if (hudLocalTimeFieldEl) {
    hudLocalTimeFieldEl.hidden = !daytimeBackgroundEnabled;
  }
  if (!daytimeBackgroundEnabled) {
    return;
  }
  const label =
    daytimePreviewHour === null
      ? formatLocalAmPm()
      : formatAmPmFromHour(daytimePreviewHour);
  if (label === lastLocalTimeLabel) {
    return;
  }
  lastLocalTimeLabel = label;
  if (hudLocalTimeEl) {
    hudLocalTimeEl.textContent = label;
  }
};

const refreshLiveWeather = async () => {
  if (!liveWeatherEnabled) {
    return;
  }
  const seq = ++liveWeatherFetchSeq;
  setLiveWeatherStatus("天気を取得しています…");
  updateWeatherHud();
  try {
    const snapshot = await fetchLiveWeatherForUser();
    if (seq !== liveWeatherFetchSeq || !liveWeatherEnabled) {
      return;
    }
    liveWeatherSnapshot = snapshot;
    const nearTokyo =
      Math.abs(snapshot.latitude - 35.6812) < 0.05 &&
      Math.abs(snapshot.longitude - 139.7671) < 0.05;
    setLiveWeatherStatus(
      nearTokyo
        ? `反映中（位置フォールバック・東京） · ${snapshot.label}`
        : `反映中 · ${snapshot.label}`,
    );
    applyLiveWeatherToScene();
    syncDaytimeEnvironmentTargets();
  } catch (error) {
    if (seq !== liveWeatherFetchSeq || !liveWeatherEnabled) {
      return;
    }
    console.error(error);
    setLiveWeatherStatus("天気の取得に失敗しました。しばらくして再試行します");
    updateWeatherHud();
  }
};

const stopLiveWeather = () => {
  liveWeatherFetchSeq += 1;
  clearLiveWeatherRefreshTimer();
  liveWeatherSnapshot = null;
  setLiveWeatherStatus("", false);
  applyLiveWeatherToScene();
  syncDaytimeEnvironmentTargets();
};

const startLiveWeather = () => {
  clearLiveWeatherRefreshTimer();
  void refreshLiveWeather();
  liveWeatherRefreshTimer = window.setInterval(() => {
    void refreshLiveWeather();
  }, LIVE_WEATHER_REFRESH_MS);
};

daytimeBackgroundInput?.addEventListener("change", () => {
  daytimeBackgroundEnabled = Boolean(daytimeBackgroundInput.checked);
  writeDaytimeBackgroundEnabled(daytimeBackgroundEnabled);
  lastLocalTimeLabel = "";
  updateLocalClockHud();
  syncDaytimeEnvironmentTargets();
});

liveWeatherInput?.addEventListener("change", () => {
  liveWeatherEnabled = Boolean(liveWeatherInput.checked);
  writeLiveWeatherEnabled(liveWeatherEnabled);
  if (liveWeatherEnabled) {
    startLiveWeather();
  } else {
    stopLiveWeather();
  }
  // DEV プレビュー中はチェックOFFでも効果を維持
  if (weatherPreviewPreset !== "live") {
    applyLiveWeatherToScene();
    syncDaytimeEnvironmentTargets();
  }
  updateWeatherHud();
});

const syncWeatherPreviewLabel = () => {
  if (!weatherPreviewValueEl) {
    return;
  }
  if (weatherPreviewPreset === "live") {
    weatherPreviewValueEl.textContent = "LIVE";
    return;
  }
  const snap = createWeatherPreviewSnapshot(
    weatherPreviewPreset,
    weatherPreviewRainScale,
    weatherPreviewWindScale,
  );
  weatherPreviewValueEl.textContent = snap.label;
};

const syncWeatherPreviewScaleLabels = () => {
  if (weatherPreviewRainValueEl) {
    weatherPreviewRainValueEl.textContent = weatherPreviewRainScale.toFixed(2);
  }
  if (weatherPreviewWindValueEl) {
    weatherPreviewWindValueEl.textContent = weatherPreviewWindScale.toFixed(2);
  }
};

const applyWeatherPreviewSelection = () => {
  syncWeatherPreviewLabel();
  syncWeatherPreviewScaleLabels();
  if (weatherPreviewPreset !== "live") {
    setLiveWeatherStatus(`DEV プレビュー · ${weatherPreviewValueEl?.textContent ?? ""}`);
    applyLiveWeatherToScene();
    syncDaytimeEnvironmentTargets();
    return;
  }
  if (liveWeatherEnabled) {
    if (liveWeatherSnapshot) {
      setLiveWeatherStatus(`反映中 · ${liveWeatherSnapshot.label}`);
    } else {
      setLiveWeatherStatus("天気を取得しています…");
      void refreshLiveWeather();
    }
  } else {
    setLiveWeatherStatus("", false);
  }
  applyLiveWeatherToScene();
  syncDaytimeEnvironmentTargets();
};

const parseWeatherPreviewPreset = (value: string): WeatherPreviewPresetId => {
  switch (value) {
    case "clear":
    case "cloudy":
    case "overcast":
    case "fog":
    case "rain":
    case "rain-heavy":
    case "snow":
    case "windy":
    case "storm":
      return value;
    default:
      return "live";
  }
};

weatherPreviewPresetSelect?.addEventListener("change", () => {
  weatherPreviewPreset = parseWeatherPreviewPreset(weatherPreviewPresetSelect.value);
  applyWeatherPreviewSelection();
});

weatherPreviewRainInput?.addEventListener("input", () => {
  weatherPreviewRainScale = Number(weatherPreviewRainInput.value);
  applyWeatherPreviewSelection();
});

weatherPreviewWindInput?.addEventListener("input", () => {
  weatherPreviewWindScale = Number(weatherPreviewWindInput.value);
  applyWeatherPreviewSelection();
});

weatherPreviewLiveButton?.addEventListener("click", () => {
  weatherPreviewPreset = "live";
  weatherPreviewRainScale = 1;
  weatherPreviewWindScale = 1;
  if (weatherPreviewPresetSelect) {
    weatherPreviewPresetSelect.value = "live";
  }
  if (weatherPreviewRainInput) {
    weatherPreviewRainInput.value = "1";
  }
  if (weatherPreviewWindInput) {
    weatherPreviewWindInput.value = "1";
  }
  applyWeatherPreviewSelection();
});

if (import.meta.env.DEV) {
  syncWeatherPreviewLabel();
  syncWeatherPreviewScaleLabels();
}

daytimePreviewHourInput?.addEventListener("input", () => {
  daytimePreviewHour = Number(daytimePreviewHourInput.value);
  syncDaytimePreviewLabel();
  lastLocalTimeLabel = "";
  updateLocalClockHud();
  syncDaytimeEnvironmentTargets();
});

daytimePreviewLiveButton?.addEventListener("click", () => {
  daytimePreviewHour = null;
  if (daytimePreviewHourInput) {
    daytimePreviewHourInput.value = String(getLocalHourFraction());
  }
  syncDaytimePreviewLabel();
  lastLocalTimeLabel = "";
  updateLocalClockHud();
  syncDaytimeEnvironmentTargets();
});

if (daytimePreviewHourInput) {
  daytimePreviewHourInput.value = String(getLocalHourFraction());
}
syncDaytimePreviewLabel();

syncDaytimeEnvironmentTargets();
updateLocalClockHud();
updateWeatherHud();
(scene.background as THREE.Color).copy(envBackgroundForming);
renderer.setClearColor(scene.background as THREE.Color);
if (daytimeSkyActive) {
  sceneBackground.setDaytimeSky(daytimeZenithColor, daytimeHorizonColor, themeDarkActive, 0);
} else {
  sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, 0);
}
syncSceneFog();
applyLiveWeatherToScene();

const updateEnvironmentCrossfade = (deltaTime: number) => {
  syncDaytimeEnvironmentTargets();
  const target = isComplete ? 1 : 0;
  const seconds = styleEnvActive ? Math.max(1, visualStyle.completion.seconds * 0.7) : 1;
  const rate = isComplete ? 1 / seconds : 2.4;
  envMix += (target - envMix) * Math.min(1, deltaTime * rate * 3);
  (scene.background as THREE.Color)
    .copy(envBackgroundForming)
    .lerp(envBackgroundComplete, envMix);
  renderer.setClearColor(scene.background as THREE.Color);
  if (daytimeSkyActive) {
    sceneBackground.setDaytimeSky(
      daytimeZenithColor,
      daytimeHorizonColor,
      themeDarkActive,
      envMix,
    );
  } else {
    sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, envMix);
  }
  syncSceneFog();
  keyLight.intensity = envLerp(sceneEnv.key, sceneEnv.keyComplete);
  fillLight.intensity = envLerp(sceneEnv.fill, sceneEnv.fillComplete);
  softFillLight.intensity = envLerp(sceneEnv.fill, sceneEnv.fillComplete) * 0.55;
  ambientLight.intensity = envLerp(sceneEnv.ambient, sceneEnv.ambientComplete);
  if (spotLight) {
    spotLight.intensity = sceneEnv.spotlightIntensity * envMix;
  }
};

/** 上からやや広げて当てる（俯瞰＋広がり） */
const updateKeyLight = () => {
  const azimuth = THREE.MathUtils.degToRad(32);
  const elevation = THREE.MathUtils.degToRad(72);
  const radius = 7.6;
  keyLight.position.set(
    Math.cos(elevation) * Math.sin(azimuth) * radius,
    Math.sin(elevation) * radius,
    Math.cos(elevation) * Math.cos(azimuth) * radius,
  );
};

const setStartButtonsEnabled = (enabled: boolean) => {
  startButton.disabled = !enabled;
  startSystemAudioButton.disabled = !enabled;
  if (startDevAudioButton) {
    startDevAudioButton.disabled = !enabled;
  }
};

const completeSculpture = () => {
  if (isComplete) {
    return;
  }

  isComplete = true;
  isAudioReady = false;
  silenceSeconds = 0;
  loudBurstSeconds = 0;
  // 音を止める前にプロファイルを確定し、完成形の色・質感を導出する
  const completionPalette = deriveSculpturePalette(audioInput.getProfile());
  const completionSpecies = speciesProfiler.finalizeProfile();
  sculpture.prepareCompletion?.(completionPalette, completionSpecies);
  audioInput.stopPlayback();
  audioInput.resetAnalysisState();
  sculpture.complete();
  appElement.classList.add("is-complete");
  viewControls.enabled = true;
  completeButton.disabled = true;
  resetSculptureButton.disabled = false;
  exportButton.disabled = false;
  setStartButtonsEnabled(true);
  if (bandToneTestButton) {
    bandToneTestButton.disabled = true;
  }
  setStatus(completeButton.dataset.statusDone ?? "");
};

const resetSculptureSession = () => {
  const seed = audioInput.getMorphologySeed() ?? undefined;
  sculpture.reset(seed);
  rhythm.reset();
  structureTracker.reset();
  speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
  speciesProfiler.reset();
  latestStructure = defaultStructureSnapshot();
  lastDisplayBands = emptyBands();
  audioInput.resetAnalysisState();
  isComplete = false;
  hasHeardSound = false;
  silenceSeconds = 0;
  loudBurstSeconds = 0;
  hudFormingSeconds = 0;
  hudSlashLevel = 1;
  hudLastBpm = 0;
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
  viewControls.enabled = true;
  completeButton.disabled = !isAudioReady;
  exportButton.disabled = true;
  if (!isAudioReady) {
    setStartButtonsEnabled(true);
  }
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
  setStartButtonsEnabled(false);
  setStatus(trigger.dataset.statusPreparing ?? "");

  try {
    await start();
    isAudioReady = true;
    hudFormingSeconds = 0;
    hudSlashLevel = 1;
    hudLastBpm = 0;
    const seed = audioInput.getMorphologySeed() ?? undefined;
    sculpture.reset(seed);
    rhythm.reset();
    structureTracker.reset();
    speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
    speciesProfiler.reset();
    latestStructure = defaultStructureSnapshot();
    hasHeardSound = false;
    silenceSeconds = 0;
    loudBurstSeconds = 0;
    // 解析ロード中に進んだ再生を巻き戻し、シード付きリセットと先頭を揃える
    audioInput.restartDevAudioIfActive();
    viewControls.enabled = true;
    completeButton.disabled = isComplete;
    resetSculptureButton.disabled = false;
    if (bandToneTestButton) {
      bandToneTestButton.disabled = isComplete;
    }
    setStatus(trigger.dataset.statusReady ?? "");
  } catch (error) {
    setStartButtonsEnabled(true);
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "音入力を開始できませんでした";
    setStatus(message);
    console.error(error);
  }
};

startButton.addEventListener("click", async () => {
  hudSignalLabel = "MIC";
  await startAudioInput(startButton, async () => {
    await audioInput.startMicrophone(audioInputSelect.value);
    // 権限取得後に label が読めるようになる事があるため、再取得して表示名を更新。
    await populateAudioDevices();
  });
});

startSystemAudioButton.addEventListener("click", async () => {
  hudSignalLabel = "SYSTEM";
  await startAudioInput(startSystemAudioButton, () => audioInput.startDisplayAudio());
});

if (import.meta.env.DEV && startDevAudioButton) {
  startDevAudioButton.addEventListener("click", async () => {
    hudSignalLabel = "BUFFER";
    const { DEV_AUDIO_URL } = await import("./dev-audio");
    await startAudioInput(startDevAudioButton, () => audioInput.startDevAudio(DEV_AUDIO_URL));
  });
}

completeButton.addEventListener("click", completeSculpture);
resetSculptureButton.addEventListener("click", resetSculptureSession);
exportButton.addEventListener("click", exportSculpture);

const resize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewControls.handleResize();
};

window.addEventListener("resize", resize);

const applyWaveGate = (rawBands: AudioBands, waveformMetrics: WaveformMetrics | null): AudioBands => {
  const bands: AudioBands = { ...rawBands };
  if (waveformMetrics) {
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
  return bands;
};

const injectRhythmIntoBands = (bands: AudioBands, rhythmEvents: RhythmEvents) => {
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
};

const trackSilenceForCompletion = (
  bands: AudioBands,
  deltaTime: number,
  _waveformMetrics: WaveformMetrics | null = null,
) => {
  if (!isAudioReady || isComplete) {
    return;
  }

  // バッファ音源終了後は強制無音。曲間の環境ノイズで完了が止まるのを防ぐ
  const playbackEnded = audioInput.hasPlaybackEnded();
  const activity = playbackEnded ? 0 : bands.overall;

  // ヒステリシス: 無音継続中は少し高いしきい値まで割り込みを無視
  const enterQuiet = SILENCE_THRESHOLD;
  const exitQuiet = SILENCE_THRESHOLD * 1.9;
  const quiet = activity < (silenceSeconds > 0.35 ? exitQuiet : enterQuiet);

  if (!quiet) {
    hasHeardSound = true;
    loudBurstSeconds += deltaTime;
    if (loudBurstSeconds >= 0.28) {
      // きちんと音が戻ったときだけ完了カウントを破棄
      silenceSeconds = 0;
    } else if (silenceSeconds > 0) {
      // 一瞬のノイズ・クリックはわずかに巻き戻すだけ
      silenceSeconds = Math.max(0, silenceSeconds - deltaTime * 0.6);
    }
    return;
  }

  loudBurstSeconds = 0;
  if (playbackEnded) {
    hasHeardSound = true;
  }
  if (hasHeardSound) {
    silenceSeconds += deltaTime;
  }

  const completeAfter = playbackEnded
    ? PLAYBACK_END_SECONDS_TO_COMPLETE
    : SILENCE_SECONDS_TO_COMPLETE;
  if (silenceSeconds >= completeAfter) {
    completeSculpture();
  }
};

const advanceSculptureSimulation = (
  rawBands: AudioBands,
  waveformMetrics: WaveformMetrics | null,
  deltaTime: number,
) => {
  const rhythmEvents = rhythm.update(rawBands, waveformMetrics, deltaTime);
  latestRhythm = rhythmEvents;

  const bands = applyWaveGate(rawBands, waveformMetrics);
  const playbackEnded = audioInput.hasPlaybackEnded();

  // バッファ曲が終わったら形を止め、短く待って完成
  if (playbackEnded && !isComplete) {
    sculpture.holdShapeForCompletion?.();
    trackSilenceForCompletion(bands, deltaTime, waveformMetrics);
    const heldBands = lastDisplayBands.overall > 0 ? lastDisplayBands : emptyBands();
    sculpture.update(
      heldBands,
      deltaTime,
      isViewInteracting,
      latestRhythm,
      latestStructure,
      speciesProfiler.getProfile(),
    );
    return {
      bands: heldBands,
      rhythmEvents,
      speciesProfile: speciesProfiler.getProfile(),
    };
  }

  trackSilenceForCompletion(bands, deltaTime, waveformMetrics);

  if (!isComplete && isAudioReady) {
    injectRhythmIntoBands(bands, rhythmEvents);
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
  const sculptureBands = bandSoloMode === "off" ? bands : applyBandSolo(bands, bandSoloMode);
  sculpture.update(
    sculptureBands,
    deltaTime,
    isViewInteracting,
    rhythmEvents,
    latestStructure,
    speciesProfile,
  );

  return { bands, rhythmEvents, speciesProfile };
};

const render = () => {
  const deltaTime = Math.min(0.033, clock.getDelta());
  const elapsedTime = clock.getElapsedTime();

  let displayBands: AudioBands = lastDisplayBands;
  let rhythmEvents = latestRhythm;
  let speciesProfile = speciesProfiler.getProfile();
  let waveform: Uint8Array | null = null;
  let bandMeters: BandMeterSnapshot | null = null;

  if (isAudioReady && !isComplete && audioInput.isDeterministic()) {
    const steps = audioInput.drainSimulationSteps();
    for (const step of steps) {
      const result = advanceSculptureSimulation(step.bands, step.waveform, step.deltaTime);
      displayBands = result.bands;
      rhythmEvents = result.rhythmEvents;
      speciesProfile = result.speciesProfile;
      if (isComplete) {
        break;
      }
    }
    waveform = audioInput.getWaveformBytes();
    bandMeters = snapshotBandMeters(displayBands);
  } else if (isAudioReady) {
    const rawBands = audioInput.update(deltaTime);
    const waveformMetrics = audioInput.getWaveformMetrics();
    waveform = audioInput.getWaveformBytes();
    bandMeters = snapshotBandMeters(rawBands);
    if (isComplete) {
      displayBands = applyWaveGate(rawBands, waveformMetrics);
      rhythmEvents = latestRhythm;
      sculpture.update(
        bandSoloMode === "off" ? displayBands : applyBandSolo(displayBands, bandSoloMode),
        deltaTime,
        isViewInteracting,
        rhythmEvents,
        latestStructure,
        speciesProfile,
      );
    } else {
      const result = advanceSculptureSimulation(rawBands, waveformMetrics, deltaTime);
      displayBands = result.bands;
      rhythmEvents = result.rhythmEvents;
      speciesProfile = result.speciesProfile;
    }
  } else {
    displayBands = emptyBands();
    sculpture.update(
      displayBands,
      deltaTime,
      isViewInteracting,
      latestRhythm,
      latestStructure,
      speciesProfile,
    );
  }

  lastDisplayBands = displayBands;

  sceneBackground.update(
    elapsedTime,
    displayBands,
    deltaTime,
    camera,
    starPointerActive ? starPointerNdc : null,
    true,
    // 曲再生中は軽量フィールド、停止中・完成後は全星フル評価
    isAudioReady && !isComplete,
  );
  drawAudioScope(waveform, rhythmEvents, bandMeters, bandSoloMode, latestStructure, speciesProfile);
  updateHud(displayBands, rhythmEvents, deltaTime);
  updateLocalClockHud();
  updateEnvironmentCrossfade(deltaTime);
  clearAudioCameraSway();
  viewControls.update();
  updateSculptureOrientationReset(deltaTime);
  updateSculptureRotationEasing(deltaTime);
  updateAudioCameraSway(
    deltaTime,
    displayBands,
    rhythmEvents,
    isAudioReady && !isComplete,
  );
  renderer.render(scene, camera);
  requestAnimationFrame(render);
};

const tuningSliderInputs = new Map<keyof SculptureTuning, HTMLInputElement>();
const tuningSliderValueLabels = new Map<keyof SculptureTuning, HTMLElement>();

const refreshTuningExport = () => {
  tuningExportText.value = formatSculptureTuningForAgent(sculptureTuning, runtimeTuning, growthAlgorithmId);
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
