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
  combineClayShifts,
  createClayColorShift,
  lerpHueShortest,
  nudgeClayColorShift,
  resolveClayPalette,
  envClayShiftFromWeatherAndHour,
  weatherClayShiftFromSnapshot,
  hourClayShiftFromHour,
} from "./clay-color";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createAbyssEnvironment, DEFAULT_ABYSS_ENV_INTENSITY } from "./vita-environment";
import {
  applyEnvShiftToSculpturePalette,
  deriveAfterlifeMaterial,
  deriveSculpturePalette,
  NEUTRAL_SCULPTURE_PALETTE,
  type AfterlifeMaterial,
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
  getAppSurface,
  getSurfaceBadgeLabel,
  isDevSurface,
} from "./app-surface";
import {
  EXPERIENCE_CATALOG,
  getActiveVisualStyle,
  getExperience,
  parseExperienceId,
  PUBLIC_EXPERIENCE_CATALOG,
  setActiveVisualStyle,
  SHARED_INTRO,
  type ExperienceId,
  type VisualStyleId,
} from "./visual-style";
import { OrderedDitherPass, createDitherMatteMaterial } from "./dither-pass";
import { DEFAULT_BLOOM_STRENGTH, DEFAULT_BLOOM_THRESHOLD, SimpleBloomPass } from "./bloom-pass";
import {
  DEFAULT_SONG_HUE_SPAN,
  DEFAULT_SONG_SAT_SPAN,
  songColorSpan,
} from "./audio-palette";
import {
  attachClayGrainAttribute,
  clayGrainUniforms,
  CLAY_GRAIN_FRAGMENT_COMMON,
  CLAY_GRAIN_FRAGMENT_NORMAL,
  CLAY_GRAIN_VERTEX_COMMON,
  CLAY_GRAIN_VERTEX_MAIN,
  DEFAULT_CLAY_GRAIN_SCALE,
  DEFAULT_CLAY_GRAIN_STRENGTH,
} from "./clay-grain";
import {
  gemUniforms,
  GEM_FACET_COUNT,
  GEM_FRAGMENT_COMMON,
  GEM_FRAGMENT_BODY,
  GEM_FRAGMENT_ROUGHNESS,
  GEM_FRAGMENT_NORMAL,
  GEM_FRAGMENT_EMISSIVE,
  GEM_MEMBRANE_FRAGMENT,
  GEM_VERTEX_COMMON,
  GEM_VERTEX_MAIN,
  DEFAULT_GEM_STRENGTH,
  DEFAULT_GEM_BODY_DARK,
  DEFAULT_GEM_RIDGE,
  DEFAULT_GEM_FIRE,
  DEFAULT_GEM_SPARKLE,
  DEFAULT_GEM_THROUGH,
} from "./gem-material";
import {
  bindDisplayMesh,
  syncDisplayAttribute,
  syncDisplayPositions,
  type DisplayMeshBinding,
} from "./display-mesh";
import { LumenSculpture } from "./lumen-sculpture";
import { VolumeSculpture } from "./volume-sculpture";
import { AetherSculpture } from "./aether-sculpture";
import { SceneBackground } from "./scene-background";
import {
  formatAmPmFromHour,
  formatLocalAmPm,
  formatLocalDateShort,
  getLocalHourFraction,
  readDaytimeBackgroundEnabled,
  sampleDaytimeAtmosphere,
  sampleDaytimeAtmosphereFromHour,
  writeDaytimeBackgroundEnabled,
  uiTokensFromBackground,
  DEFAULT_DAYTIME_LOCATION,
  type DaytimeAtmosphere,
} from "./daytime-atmosphere";
import {
  applyCloudCoverToSky,
  createWeatherPreviewSnapshot,
  fetchLiveWeatherForUser,
  formatWeatherHudLabel,
  GeolocationPermissionDeniedError,
  readLiveWeatherEnabled,
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
  /** ピーク正規化前 — ドラム／オンセット検出用（曲と同期させる） */
  rhythmBands: AudioBands;
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
  melodyFocus: number;
  sectionContrast: number;
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
  chop: 0,
  salience: 0,
  beat: 0,
  beatIndex: 0,
  kickIndex: 0,
  snareIndex: 0,
  hatIndex: 0,
  transientIndex: 0,
  chopIndex: 0,
  salienceIndex: 0,
  downbeat: false,
  bpm: 0,
  pulsePhase: 0,
  pulseConfidence: 0,
  pulseEnvelope: 0,
  pulseIndex: 0,
  kickLength: 0,
  snareLength: 0,
  hatLength: 0,
  kickRing: 0,
  snareRing: 0,
  hatRing: 0,
  melodyOnset: 0,
  salienceLow: 0,
  salienceMid: 0,
  salienceHigh: 0,
  subLevel: 0,
  wavePeak: 0,
  waveEnergy: 0,
};

/**
 * vita の混色（時刻・天気・曲を面内で混ぜ、単色化を防ぐ）の既定値。
 *
 * 経緯: 従来は時刻・天気・曲を1つの色相スカラー（clayHueBase）へ合算し、
 * `bakeCorePearlColors` でそれに小さなノイズを足すだけだったので、
 * 面全体が1色に落ち着いていた（ユーザー指摘「色味が単色に落ち着く」）。
 * そこで clayHueBase を中心に**暖⇔寒の2極**へ開き、低周波ノイズで面内を
 * 空間補間して混色させる。極の傾きは時刻（暖側）・天気（寒側）で、
 * 配分の偏りは曲の明るさ・天気で動かす。**平均色は base 付近に保つ**ので、
 * 曲による“平均色”の差（脇役へ畳んだ量）は増やさない。増えるのは面内のばらつき。
 *
 * SPREAD = 0 で従来どおり（2極が base に一致＝単色＋ノイズ）。
 * dev パネル「混色の広がり（DEV・vitaのみ）」で実機調整でき、
 * 決めた値は DEFAULT_PEARL_MIX_* へ焼き込む。**無音の見た目で決めないこと**
 * （ブルーム・肌理とも無音で置いた仮値が実機で倍以上に変わっている）。
 */
const DEFAULT_PEARL_MIX_SPREAD = 0.28;
const DEFAULT_PEARL_MIX_BALANCE = -0.1;
/** dev パネルと共有する現在値（実機で決めた値は DEFAULT_* へ焼き込む） */
const pearlColorMix = {
  spread: DEFAULT_PEARL_MIX_SPREAD,
  balance: DEFAULT_PEARL_MIX_BALANCE,
  enabled: true,
};

/**
 * 音色で形の語彙を分ける（鉱物 / 丸み / その中間）の既定値。
 *
 * 曲の音色軸 `SpeciesProfile.mineral`（0=丸み, 1=鉱物）で、結晶ファセット・鋭い稜・棘を
 * 桁で増減する。丸み端（axis≈0）は現状 vita 完成形を基準に崩さない。
 * **仮値。無音で決めない**（handoff の鉄則。ブルーム・肌理とも無音仮値が実機で倍以上変わっている）。
 * dev パネル「音色で形（鉱物/丸み）」で曲を鳴らしながら決め、DEFAULT_* へ焼き込む。
 */
const DEFAULT_MINERAL_FACET_STRENGTH = 1;
const mineralMix = {
  /** 音色軸の上書き。< 0 で自動（曲の mineral を使う）、0..1 で強制（dev 検証用）。 */
  axisOverride: -1,
  /** 結晶ファセットの強さの倍率。 */
  facetStrength: DEFAULT_MINERAL_FACET_STRENGTH,
  enabled: true,
};

/**
 * 音色軸の dev 読み出し。**パネルの表示と headless 計測が同じオブジェクトを読む。**
 * `window.__mineralAxis` にも生やす（`mineral_axis_probe.js`）。
 *
 * これが無かったせいで「軸がほぼ全曲 0 なので宝石が一切出ない」ことに気づけず、
 * 強度スライダーだけを何度も振ることになった（2026-08-12）。**消さないこと。**
 */
const mineralDebug = {
  /** 実際に効いている軸（override 優先。非 vita は 0） */
  axis: 0,
  /** いまのフレームのグリット（スペクトル平坦度） */
  grit: 0,
  /** 曲全体のグリット平均（軸の実際の入力） */
  gritAvg: 0,
  /** 曲の音色軸（override を通す前の生値） */
  mineral: 0,
  organic: 0,
  aggressive: 0,
  /** dev パネルで軸を固定しているか */
  override: false,
  /** 以下は calibration 用の生の曲平均（合成軸のように飽和しない） */
  loudRatio: 0,
  brightness: 0,
  melodyFocus: 0,
  centroid: 0,
  transient: 0,
  density: 0,
};

/**
 * 熟成度（maturity）の dev 制御。**vita だけに効く。**
 * `override` < 0 で自動（曲の蓄積量＋進行度）、0..1 で強制（実機で見た目を追い込む用）。
 */
const maturityMix = {
  override: -1,
  enabled: true,
};

/**
 * 熟成度（maturity）の入力の dev 読み出し。**worklist [P1]。**
 * `window.__maturity` に生やす（`maturity_probe.js` が読む）。
 *
 * 「蓄積量だけで完成へ寄せる」がユーザー判断なので、9 曲で候補の伸び方を測ってから
 * 正規化を決める。**軸のときと同じで、見えない量は決められない。この読み出しは消さないこと。**
 */
const maturityDebug = {
  /** いま効いている熟成度（override 優先。非 vita は 0） */
  maturity: 0,
  /** 蓄積量から出た値（進行度の最低保証を入れる前） */
  fromAccum: 0,
  /** 曲の進行度（duration が分かるときだけ。マイクは -1） */
  progress: -1,
  /** dev パネルで熟成度を固定しているか */
  override: false,
  /** 既存の発達度。序盤の球を守るゲートなので**すぐ 1.0 に張り付く**（対照用） */
  formDev: 0,
  /** 変位の総量（vectorField の平均長さ） */
  vecMean: 0,
  /** 法線方向スカラの総量（sculptureMemory + erosionField の平均） */
  scalarMean: 0,
  /** 音の露出の積算 Σ overall*dt（単調増加・飽和しない） */
  exposure: 0,
  /** 有音だった秒数 */
  activeSeconds: 0,
  completed: false,
};

const structureTracker = new StructureTracker();
const speciesProfiler = new SpeciesProfiler();
speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);

const defaultStructureSnapshot = (): StructureSnapshot => ({
  energyLong: 0,
  energyMid: 0,
  sectionLift: 0.5,
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
 * 拍＋キック／スネアを主に、ハット／シンバルも軽く乗せる。
 */
const scopeCyanDrive = (rhythm: RhythmEvents) =>
  clamp01(
    rhythm.pulseConfidence * rhythm.pulseEnvelope * 0.4 +
      (1 - clamp01(rhythm.pulsePhase / 0.5)) * rhythm.pulseConfidence * 0.22 +
      rhythm.kick * 0.45 +
      rhythm.kickRing * 0.28 +
      rhythm.snare * 0.3 +
      rhythm.snareRing * 0.2 +
      rhythm.hat * 0.22 +
      rhythm.hatRing * 0.12 +
      rhythm.chop * 0.55 +
      rhythm.transient * 0.45,
  );

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
  melodyFocus: 0,
  sectionContrast: 0,
  variation: 0,
  attackAmount: 0,
  attackRate: 0,
  quietRatio: 0,
  loudRatio: 0,
});

/**
 * オンセット/ビート検出。
 * kick は「サブ低域 + 波形ピーク/エネルギー」の両方が揃った瞬間のみ（mid/high の誤検出を抑える）。
 * あわせて各ヒットの「鳴り長さ」（帯域が落ちるまでの時間）を測り、見た目の持続に渡す。
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
  private lastChop = 10;
  private lastSalience = 10;
  private lastBeat = 10;
  /** 直近1秒のイベント回数（高密度ミックス判定用） */
  private recentEventTimes: number[] = [];
  private beatIndex = 0;
  private kickIndex = 0;
  private snareIndex = 0;
  private hatIndex = 0;
  private transientIndex = 0;
  private chopIndex = 0;
  private salienceIndex = 0;
  private bpm = 0;
  private elapsed = 0;
  private lastPulseTime = 0;
  private pulsePhase = 0;
  private pulseConfidence = 0;
  private pulseEnvelope = 0;
  private pulseIntervals: number[] = [];
  private expectedPulseInterval = fibUnit(7, 8);
  private pulseIndex = 0;
  // --- 鳴り長さ（音程ではなくゲート長）---
  private kickGateOpen = false;
  private snareGateOpen = false;
  private hatGateOpen = false;
  private kickGateStart = 0;
  private snareGateStart = 0;
  private hatGateStart = 0;
  private kickGatePeak = 0;
  private snareGatePeak = 0;
  private hatGatePeak = 0;
  private kickLength = 0;
  private snareLength = 0;
  private hatLength = 0;
  private kickRing = 0;
  private snareRing = 0;
  private hatRing = 0;
  // --- 帯域ごとの「直近の自分自身」に対する目立ち度（楽器分類とは独立） ---
  private trailLow = 0;
  private trailMid = 0;
  private trailHigh = 0;

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
    this.lastChop = 10;
    this.lastSalience = 10;
    this.lastBeat = 10;
    this.recentEventTimes = [];
    this.beatIndex = 0;
    this.kickIndex = 0;
    this.snareIndex = 0;
    this.hatIndex = 0;
    this.transientIndex = 0;
    this.chopIndex = 0;
    this.salienceIndex = 0;
    this.bpm = 0;
    this.elapsed = 0;
    this.lastPulseTime = 0;
    this.pulsePhase = 0;
    this.pulseConfidence = 0;
    this.pulseEnvelope = 0;
    this.pulseIntervals = [];
    this.expectedPulseInterval = fibUnit(7, 8);
    this.pulseIndex = 0;
    this.kickGateOpen = false;
    this.snareGateOpen = false;
    this.hatGateOpen = false;
    this.kickGateStart = 0;
    this.snareGateStart = 0;
    this.hatGateStart = 0;
    this.kickGatePeak = 0;
    this.snareGatePeak = 0;
    this.hatGatePeak = 0;
    this.kickLength = 0;
    this.snareLength = 0;
    this.hatLength = 0;
    this.kickRing = 0;
    this.snareRing = 0;
    this.hatRing = 0;
    this.trailLow = 0;
    this.trailMid = 0;
    this.trailHigh = 0;
  }

  /** 直近1秒の検出イベント密度 0〜1（多いほど埋もれやすいミックス） */
  private getDetectionBusy() {
    const now = this.elapsed;
    while (this.recentEventTimes.length > 0 && now - this.recentEventTimes[0] > 1) {
      this.recentEventTimes.shift();
    }
    // 秒あたり ~12 イベントでほぼ満杯（メタル／チャグ想定）
    return clamp01(this.recentEventTimes.length / 12);
  }

  private noteDetectionEvent() {
    this.recentEventTimes.push(this.elapsed);
    if (this.recentEventTimes.length > 32) {
      this.recentEventTimes.shift();
    }
  }

  private registerPulse(strength: number) {
    const now = this.elapsed;
    if (this.lastPulseTime > 0) {
      const interval = now - this.lastPulseTime;
      if (interval > fibUnit(3, 21) && interval < fibRatio(8, 3)) {
        // 外れ IOI はテンポ推定に入れない（倍テン・連続キックでグリッドが壊れるのを防ぐ）
        const expected = this.expectedPulseInterval;
        const ratio = interval / Math.max(fibUnit(3, 21), expected);
        const plausible =
          this.pulseIntervals.length < 3 || (ratio > 0.55 && ratio < 1.75);
        if (plausible) {
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

          // 細かいキック連打 IOI を「人が頭を振る拍」帯（約 72–160 BPM）へ畳む
          // Fury のような倍テン／ダブルキックでも心地よいうなずき周期になる
          let beatIoI = median;
          while (beatIoI < 60 / 160) beatIoI *= 2;
          while (beatIoI > 60 / 72) beatIoI *= 0.5;
          const follow = this.pulseIntervals.length < 4 ? 0.55 : 0.28;
          this.expectedPulseInterval += (beatIoI - this.expectedPulseInterval) * follow;

          if (this.pulseIntervals.length >= 3) {
            let estimatedBpm = 60 / this.expectedPulseInterval;
            while (estimatedBpm < 70) estimatedBpm *= 2;
            while (estimatedBpm > 180) estimatedBpm *= 0.5;
            this.bpm += (estimatedBpm - this.bpm) * (this.bpm <= 0 ? 1 : 0.22);
          }
        }
      }
    }
    this.lastPulseTime = now;
    this.pulsePhase = 0;
    this.pulseIndex += 1;
    this.pulseEnvelope = Math.min(1, fibUnit(8, 9) + strength * fibRatio(8, 5));
  }

  /** オンセット後、帯域が落ちるまでを「長さ」として測る（共有ルール） */
  private trackHitLength(
    open: boolean,
    start: number,
    peak: number,
    level: number,
    floor: number,
    maxSec: number,
  ): { open: boolean; start: number; peak: number; length: number; ring: number } {
    if (!open) {
      return { open: false, start, peak, length: 0, ring: 0 };
    }
    const nextPeak = Math.max(peak, level);
    const liveLen = Math.min(maxSec, Math.max(0, this.elapsed - start));
    // ピーク比 or 絶対床を下回ったらゲート閉じる
    const stillRinging = level > nextPeak * 0.28 || level > floor;
    if (stillRinging && liveLen < maxSec) {
      const ring = clamp01(0.35 + liveLen / Math.max(0.04, maxSec) * 0.65);
      return { open: true, start, peak: nextPeak, length: liveLen, ring };
    }
    return { open: false, start, peak: nextPeak, length: liveLen, ring: 0 };
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
    const midOnset = Math.max(onsetMid * 0.9, onsetMelody * 1.25);

    // --- 帯域ごとの目立ち度: 「直近の自分自身」に対して今どれだけ跳ねているか ---
    // kick/snare/hat/chop のような楽器別分類を通らない音（ピアノの単音、
    // シンバルの持続的なシマーなど）でも、その帯域なりの「今の主役」を拾うための
    // ジャンル非依存トップアップ。約1.6秒の時定数でその帯域の"通常の跳ね幅"を追従する。
    const trailAlpha = 1 - Math.exp(-deltaTime / 1.6);
    this.trailLow += (bassOnset - this.trailLow) * trailAlpha;
    this.trailMid += (midOnset - this.trailMid) * trailAlpha;
    this.trailHigh += (onsetHigh - this.trailHigh) * trailAlpha;
    const bandSalience = (onset: number, trail: number, floor: number) => {
      if (onset < floor) return 0;
      const ratio = onset / (trail + floor);
      return smoothstep(1.5, 3.2, ratio);
    };
    const salienceLow = bandSalience(bassOnset, this.trailLow, 0.022);
    const salienceMid = bandSalience(midOnset, this.trailMid, 0.016);
    const salienceHigh = bandSalience(onsetHigh, this.trailHigh, 0.013);

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
    this.lastChop += deltaTime;
    this.lastSalience += deltaTime;
    this.lastBeat += deltaTime;

    const waveHit =
      peakDelta > fibUnit(5, 34) + this.deltaPeak * fibUnit(8, 13) ||
      energyDelta > fibUnit(5, 34) + this.deltaEnergy * fibUnit(8, 13) ||
      peak > fibUnit(8, 21);
    const strongWave =
      peak > fibUnit(8, 13) || peakDelta > fibUnit(8, 34) || energyDelta > fibUnit(5, 34);

    // --- kick: アタック比で胴鳴り／ウォーキングベースを弾き、テンポに応じたリフラクトリ ---
    const bassGate = fibUnit(2, 34) + Math.max(this.deltaSub, this.deltaLow) * fibUnit(5, 13);
    const bassLevel = Math.max(bands.sub, bands.low * fibUnit(8, 13));
    const kickClarity = bassOnset / (bassLevel + 0.08);
    const bassHit =
      bassOnset > bassGate &&
      bassLevel > fibUnit(3, 34) &&
      (kickClarity > 0.32 || peakDelta > fibUnit(5, 21) || energyDelta > fibUnit(3, 21));
    const kickTransient =
      peakDelta > fibUnit(3, 34) + this.deltaPeak * fibUnit(3, 13) ||
      energyDelta > fibUnit(2, 21) + this.deltaEnergy * fibUnit(2, 13);
    // グリッド学習後は拍間隔の ~6 割で連打を間引く（J-pop など中テンポのキック過多を防ぐ）
    const minKickGap =
      this.pulseConfidence > 0.35
        ? Math.max(0.06, this.expectedPulseInterval * 0.62)
        : Math.max(0.04, fibUnit(5, 34));
    let kick = 0;
    if (
      this.lastKick > minKickGap &&
      bassHit &&
      kickTransient &&
      bassOnset > onsetHigh * 0.4 &&
      bassLevel > bands.high * fibUnit(3, 13)
    ) {
      kick = Math.min(
        1,
        Math.max(bassOnset * 1.55, peakDelta * fibRatio(8, 3), energyDelta * fibRatio(5, 3)),
      );
    }

    // --- snare: 胴(中域) + クラック。誤爆防止で聴こえる打点を落とさない ---
    const minSnareGap =
      this.pulseConfidence > 0.4
        ? Math.max(0.08, this.expectedPulseInterval * 0.32)
        : 0.1;
    const snareGate = 0.02 + this.deltaMid * 0.42;
    const snareCrackGate = 0.01 + this.deltaHigh * 0.32;
    const snareBody = Math.max(bands.mid, bands.low * 0.35);
    // 明るいクラック、または暗いスネア（波形ピーク＋中域胴）
    const snareCrack =
      (onsetHigh > snareCrackGate && bands.high > 0.024) ||
      (peakDelta > fibUnit(5, 34) && bands.high > 0.028 && onsetHigh > 0.006) ||
      (peakDelta > fibUnit(8, 34) && onsetMid > 0.022 && bands.mid > 0.06);
    // ギター句頭のハード排他はやめ、メロが明らかに主導のときだけ弾く
    const guitarPhraseLead =
      onsetMelody > onsetMid * 1.35 &&
      bands.melodyFocus > 0.3 &&
      onsetHigh < Math.max(0.012, onsetMelody * 0.65);
    let snare = 0;
    if (
      this.lastSnare > minSnareGap &&
      kick < 0.2 &&
      !guitarPhraseLead &&
      snareBody > 0.055 &&
      onsetMid > snareGate * 0.8 &&
      (peakDelta > fibUnit(2, 34) ||
        energyDelta > fibUnit(2, 34) ||
        onsetHigh > 0.01 ||
        onsetMid > 0.038)
    ) {
      if (snareCrack || (onsetMid > 0.048 && peakDelta > fibUnit(5, 34))) {
        snare = Math.min(
          1,
          onsetMid * 1.15 + onsetHigh * 1.55 + peakDelta * 0.8 + energyDelta * 0.35,
        );
      }
    }
    const snareLevel = Math.max(bands.mid, bands.high * 0.75);

    // --- hat: 拾いすぎないが、チッチのトレンドは落とさない ---
    const hatGate = 0.012 + this.deltaHigh * 0.4;
    const hat =
      this.lastHat > 0.022 &&
      onsetHigh > hatGate &&
      bands.high > 0.024 &&
      kick < 0.08 &&
      snare < 0.08 &&
      // シンバル／金物はミッドにも金属的なシマーが乗るため、高音優勢の比率をやや緩める
      onsetHigh > onsetMid * 0.55 &&
      (peakDelta > fibUnit(3, 34) || energyDelta > fibUnit(2, 34) || onsetHigh > hatGate * 1.35)
        ? onsetHigh * 1.15
        : 0;

    // --- transient: シンバル／クラッシュ（強めの高域＋波形だけ）---
    const transientGate = 0.014 + this.deltaHigh * 0.42;
    const brightSpike = onsetHigh > transientGate && bands.high > 0.03;
    let transient = 0;
    if (
      this.lastTransient > 0.05 &&
      waveHit &&
      brightSpike &&
      (peakDelta > 0.04 || energyDelta > 0.03) &&
      kick < 0.1
    ) {
      transient = Math.max(onsetHigh * 1.15, peakDelta * 1.05, energyDelta * 0.9);
    } else if (this.lastTransient > 0.08 && strongWave && peakDelta > 0.09 && bands.high > 0.04) {
      transient = Math.max(peakDelta * 1.1, energyDelta * 0.95);
    }

    // --- chop: チャグ／カッティング。スネアのクラックとは排他 ---
    const eventBusy = this.getDetectionBusy();
    const chopGate = 0.01 + Math.max(this.deltaMid, this.deltaMelody) * 0.3 + eventBusy * 0.012;
    const chopLevel = Math.max(bands.mid * 0.9, bands.melody * 1.25);
    const chopOnset = midOnset;
    const minChopGap = 0.034 + eventBusy * 0.055;
    let chop = 0;
    if (
      snare < 0.04 &&
      this.lastChop > minChopGap &&
      chopOnset > chopGate &&
      chopLevel > 0.06 + eventBusy * 0.04 &&
      // 明るいクラック優勢ならスネア側に譲る
      onsetHigh < Math.max(0.02, chopOnset * 1.05) &&
      (peakDelta > fibUnit(2, 34) + eventBusy * 0.02 ||
        energyDelta > fibUnit(2, 34) + eventBusy * 0.015 ||
        chopOnset > 0.016 + eventBusy * 0.02 ||
        (bands.melodyFocus > 0.18 && eventBusy < 0.45))
    ) {
      chop = Math.min(1, chopOnset * 1.55 + peakDelta * 0.3);
    }

    if (kick > 0) {
      this.lastKick = 0;
      this.kickIndex += 1;
      this.kickGateOpen = true;
      this.kickGateStart = this.elapsed;
      this.kickGatePeak = bassLevel;
      this.noteDetectionEvent();
    }
    if (snare > 0) {
      this.lastSnare = 0;
      this.snareIndex += 1;
      this.snareGateOpen = true;
      this.snareGateStart = this.elapsed;
      this.snareGatePeak = snareLevel;
      this.noteDetectionEvent();
    }
    if (hat > 0) {
      this.lastHat = 0;
      this.hatIndex += 1;
      this.hatGateOpen = true;
      this.hatGateStart = this.elapsed;
      this.hatGatePeak = bands.high;
      this.noteDetectionEvent();
    }
    if (transient > 0) {
      this.lastTransient = 0;
      this.transientIndex += 1;
      this.noteDetectionEvent();
    }
    if (chop > 0) {
      this.lastChop = 0;
      this.chopIndex += 1;
      this.noteDetectionEvent();
    }

    // --- salience: 分類外の強いアタック。高密度では厳選して埋もれを防ぐ ---
    const busy = this.getDetectionBusy();
    const saliencePeakNeed = 0.055 + busy * 0.07;
    const salienceEnergyNeed = 0.045 + busy * 0.055;
    const minSalienceGap = 0.09 + busy * 0.14;
    let salience = 0;
    if (
      this.lastSalience > minSalienceGap &&
      kick < 0.05 &&
      snare < 0.05 &&
      hat < 0.05 &&
      chop < 0.05 &&
      transient < 0.05 &&
      (peakDelta > saliencePeakNeed || energyDelta > salienceEnergyNeed) &&
      bands.overall > 0.07 &&
      (onsetMid > 0.012 || onsetHigh > 0.01 || onsetMelody > 0.014 || bassOnset > 0.014)
    ) {
      salience = Math.min(1, Math.max(peakDelta * 1.25, energyDelta * 1.1, onsetMid * 0.9 + onsetHigh * 0.7));
    }
    if (salience > 0) {
      this.lastSalience = 0;
      this.salienceIndex += 1;
      this.noteDetectionEvent();
    }

    // 帯域が残っているあいだを長さとして確定（キック長め／ハット短めの上限）
    const kickTrack = this.trackHitLength(
      this.kickGateOpen,
      this.kickGateStart,
      this.kickGatePeak,
      bassLevel,
      0.045,
      0.42,
    );
    this.kickGateOpen = kickTrack.open;
    this.kickGateStart = kickTrack.start;
    this.kickGatePeak = kickTrack.peak;
    if (kickTrack.length > 0) {
      this.kickLength += (kickTrack.length - this.kickLength) * Math.min(1, deltaTime * 8);
    }
    this.kickRing = Math.max(kickTrack.ring, this.kickRing * Math.exp(-deltaTime * (2.8 + (1 - this.kickLength / 0.42) * 4)));

    const snareTrack = this.trackHitLength(
      this.snareGateOpen,
      this.snareGateStart,
      this.snareGatePeak,
      snareLevel,
      0.05,
      0.28,
    );
    this.snareGateOpen = snareTrack.open;
    this.snareGateStart = snareTrack.start;
    this.snareGatePeak = snareTrack.peak;
    if (snareTrack.length > 0) {
      this.snareLength += (snareTrack.length - this.snareLength) * Math.min(1, deltaTime * 9);
    }
    this.snareRing = Math.max(
      snareTrack.ring,
      this.snareRing * Math.exp(-deltaTime * (3.6 + (1 - this.snareLength / 0.28) * 5)),
    );

    const hatTrack = this.trackHitLength(
      this.hatGateOpen,
      this.hatGateStart,
      this.hatGatePeak,
      bands.high,
      0.028,
      0.35,
    );
    this.hatGateOpen = hatTrack.open;
    this.hatGateStart = hatTrack.start;
    this.hatGatePeak = hatTrack.peak;
    if (hatTrack.length > 0) {
      this.hatLength += (hatTrack.length - this.hatLength) * Math.min(1, deltaTime * 10);
    }
    this.hatRing = Math.max(
      hatTrack.ring,
      this.hatRing * Math.exp(-deltaTime * (5.5 + (1 - this.hatLength / 0.35) * 8)),
    );

    // pulse: キック主・スネア副。グリッド確立後は拍付近だけ同期（ででで連打でBPMを壊さない）
    let beat = 0;
    if (kick > 0) beat = Math.min(1, kick * fibRatio(8, 3));
    else if (snare > 0) beat = Math.min(1, snare * fibRatio(5, 3));

    const onGrid =
      this.pulseConfidence < 0.45
        ? this.pulsePhase < 0.26 || this.pulsePhase > 0.74
        : this.pulsePhase < 0.18 || this.pulsePhase > 0.82;
    let pulseStrength = 0;
    if (kick > 0) {
      if (this.pulseConfidence < 0.4 || onGrid) {
        pulseStrength = kick;
      } else {
        // グリッド外連打は位相を触らない（崩れの主因）
        this.pulseEnvelope = Math.max(this.pulseEnvelope, kick * 0.18);
      }
    } else if (snare > fibUnit(5, 21)) {
      const kickSparse = this.lastKick > this.expectedPulseInterval * 0.75;
      if (
        kickSparse &&
        (this.pulseConfidence < 0.48 || onGrid) &&
        snare > 0.06
      ) {
        pulseStrength = snare * fibUnit(8, 13);
      }
    }
    if (pulseStrength > fibUnit(3, 21)) {
      this.registerPulse(pulseStrength);
    } else if (this.expectedPulseInterval > fibUnit(3, 21)) {
      this.pulsePhase += deltaTime / this.expectedPulseInterval;
      if (this.pulsePhase >= 1) {
        this.pulsePhase -= Math.floor(this.pulsePhase);
        if (this.pulseConfidence > 0.38) {
          this.pulseEnvelope = Math.max(
            this.pulseEnvelope,
            0.26 + this.pulseConfidence * 0.4,
          );
          this.pulseIndex += 1;
        }
      }
    }
    const pulseInterval = Math.max(fibUnit(3, 21), this.expectedPulseInterval);
    const decayRate =
      fib(5) / (pulseInterval * runtimeTuning.pulseHold * (0.75 + this.pulseConfidence * 0.9));
    this.pulseEnvelope *= Math.exp(-deltaTime * (decayRate + (1 - this.pulseConfidence) * fibUnit(5, 13)));
    if (
      this.lastPulseTime > 0 &&
      this.elapsed - this.lastPulseTime > this.expectedPulseInterval * 3.2
    ) {
      this.pulseConfidence *= Math.exp(-deltaTime * 0.85);
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
      chop,
      salience,
      beat,
      beatIndex: this.beatIndex,
      kickIndex: this.kickIndex,
      snareIndex: this.snareIndex,
      hatIndex: this.hatIndex,
      transientIndex: this.transientIndex,
      chopIndex: this.chopIndex,
      salienceIndex: this.salienceIndex,
      downbeat,
      bpm: this.bpm,
      pulsePhase: this.pulsePhase,
      pulseConfidence: this.pulseConfidence,
      pulseEnvelope: this.pulseEnvelope,
      pulseIndex: this.pulseIndex,
      kickLength: this.kickLength,
      snareLength: this.snareLength,
      hatLength: this.hatLength,
      kickRing: this.kickRing,
      snareRing: this.snareRing,
      hatRing: this.hatRing,
      melodyOnset: clamp01(this.deltaMelody * 2.4),
      salienceLow,
      salienceMid,
      salienceHigh,
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
/**
 * 表示専用メッシュの分割数。**変形計算はこの解像度では走らない**（`display-mesh.ts`）。
 * 変形は `SCULPTURE_SPHERE_DETAIL` のメッシュで計算し、変位だけをここへ補間する。
 *
 * 10 → 20 で三角形は 2,420 → 8,820、輪郭の直線分は半分の長さになる。
 * 上げすぎると computeVertexNormals（毎フレーム）が効いてくるので、
 * 実機のフレームレートを見てから動かすこと。
 */
const SCULPTURE_DISPLAY_DETAIL = 20;

/**
 * 膜の折り重なりをほどく平滑化の既定値（`relaxMembraneFolds`）。
 * 反復数 0 で無効（＝2026-08-11 以前の挙動）。
 *
 * **無音や静止画で決めないこと。** ブルーム・肌理はどちらも無音で置いた仮値が弱すぎて、
 * 実機で曲を鳴らして倍以上に変わっている（`docs/handoff/VITA.md` 3章）。
 * dev パネル `#membrane-panel` で曲を鳴らしながら同一ロード内で追い込む。
 */
const DEFAULT_MEMBRANE_RELAX_ITERATIONS = 1;
const DEFAULT_MEMBRANE_RELAX_STRENGTH = 0.5;

/** dev パネルから書き換える現在値 */
const membraneRelax = {
  iterations: DEFAULT_MEMBRANE_RELAX_ITERATIONS,
  strength: DEFAULT_MEMBRANE_RELAX_STRENGTH,
};

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
const createSculptureSphereGeometry = (radius: number, detail = SCULPTURE_SPHERE_DETAIL) => {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(radius, detail));
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
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;
  varying vec2 vUv;
  // 結晶面の選択に使う（幾何側 applyMembraneFacets と同じオブジェクト空間の方向）
  varying vec3 vGemDir;

  void main() {
    vUv = uv;
    vLocalPosition = position;
    vGemDir = normalize(position);
    // normalMatrix は非均一スケール（キックの縦潰れ）込みの正しいビュー空間法線
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPosition.xyz;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
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

  ${GEM_FRAGMENT_COMMON}

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  varying vec3 vLocalPosition;
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
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(-vViewPosition);
    float NdotV = clamp(dot(normal, viewDirection), 0.0, 1.0);
    // リムと正面の差を小さくして、回転で色味が飛びにくくする。
    // 物理ベース（Schlick・指数5）へ寄せる実装を 2026-08-10 に入れて実機で比べたが、
    // ユーザーが旧近似を選んだので撤去した（docs/handoff/VITA.md 5章）。
    float fresnel = pow(1.0 - NdotV, 1.45);
    float softSheen = pow(NdotV, 1.15) * 0.52;
    float pearl = clamp(fresnel * 0.58 + softSheen, 0.0, 1.0);
    float frozen = smoothstep(0.0, 1.0, uCompleted);
    float flowTime = uTime * (1.0 - frozen) * (1.0 + uLive * uMelodyFlowAnim);

    float surfaceNoise = noise(vLocalPosition * 4.2 + vec3(0.0, flowTime * 0.34, 0.0));
    float fineNoise = noise(vLocalPosition * 18.0 - vec3(flowTime * 0.22));
    // ライン模様の位置は時間にも音にも乗せず、表面に固定された「血管・脈」として
    // 完全に静止させる。動くのは明るさ（lineDrive/uMelodyLine）だけにして、
    // 中音のヒットが来た瞬間だけ既存の脈が光る、という分かりやすい対応にする
    // （常時ゆっくり流れる/歪む演出は「曲と関係あるように見えない」との指摘で撤去）。
    float meridian = sin(dot(vLocalPosition, vec3(9.5, 0.7, 8.2)) + fineNoise * 1.6);
    // 音楽連動の uLive/uGlow — 形状は抑えめでも光は 7/28 以前の煌めきを残す
    float liveAmt = clamp(uLive, 0.0, 1.15);
    float glowAmt = clamp(uGlow, 0.0, 1.15);
    // uLiveはアイドル呼吸（idleWobbleAmp）でも底上げされるため、そのままだと
    // 無音時にも縞模様(melodyLines)が薄く点灯し続けてしまい「音と無関係な固定の縞」に
    // 見えてしまっていた（ユーザー指摘で判明）。ライン模様専用に無音分を除いた
    // デッドゾーンを設け、はっきりした反応のときだけ立ち上がるようにする。
    float lineLiveAmt = max(0.0, liveAmt - 0.55) * 2.2;
    // リード／ギター帯 (uMelody・uMid) でもラインが立つ。高域だけだとイントロリフが消える
    float leadAmt = max(uMelody, uMid * 0.72);
    float lineDrive = lineLiveAmt * (0.55 + leadAmt * 0.75 + uHigh * 0.7);
    // 帯状マスク（latitude基準のsmoothstep）は縞に見えるため撤去したが、
    // 単なる一様な明るさだけでは煌めきが失われ単調になった（ユーザー指摘）。
    // 縞にならない不規則な3Dノイズ（sin波の帯ではなく既存のvalue noise）で
    // 散らばった細かい輝点を作り、「反応時にキラキラ光る」質感を縞無しで戻す。
    float glitter = pow(clamp(noise(vLocalPosition * 19.0 + vec3(6.4, 2.8, 11.1)), 0.0, 1.0), 3.4);
    float melodyLines = (0.4 + glitter * 2.6) * lineDrive * uMelodyLine;
    float dataLines = 0.0;
    float microSignals = smoothstep(0.65, 0.96, meridian) * uHigh * lineDrive * 0.95;

    vec3 baseColor = uPaletteColor;
    vec3 electricBlue = uPaletteAccent;
    // vita: ヒット時のハイライトも真珠シアン寄り（金色メロディは粘土パレットの
    // 桃緑と同居して「模様がうるさい」印象になりやすいので弱める）。
    vec3 hitTint = uVita > 0.5 ? vec3(0.82, 0.93, 1.0) : vec3(1.0, 0.82, 0.52);
    // vita 案A（2026-08-11）: 膜ベースを真珠白＋electric シアンへ寄せ、
    // 粘土パレットの色乗りを弱める。天気/曲の色は薄い染みとして残す（殺さない）。
    if (uVita > 0.5) {
      vec3 pearlWhite = vec3(0.90, 0.95, 1.0);
      vec3 cyanAccent = vec3(0.42, 0.76, 1.0);
      baseColor = mix(pearlWhite, uPaletteColor, 0.20);
      electricBlue = mix(cyanAccent, uPaletteAccent, 0.26);
    }
    vec3 color = baseColor * 0.2;
    float idleDim = 0.42 + liveAmt * 0.5;
    if (uVita > 0.5) {
      // 待機では膜を読める底上げを残しつつ、再生中の live による明るさの上がりを抑える
      // （2026-08-11→12: 輝きを段階的に抑制）
      idleDim = 0.54 + liveAmt * 0.14;
    }
    // vita は高域で常時シアンが乗りすぎないよう、uHigh の乗せを弱める
    float pearlLive = pearl * (0.75 + uHigh * (uVita > 0.5 ? 0.28 : 0.95));
    color += electricBlue * pearlLive * idleDim;
    color += hitTint * melodyLines * (uVita > 0.5 ? 0.42 : 1.6);
    color += hitTint * pearl * uMelodyFresnel * lineDrive * (uVita > 0.5 ? 0.26 : 0.95);
    color += vec3(0.72, 0.94, 1.0) * microSignals * (uVita > 0.5 ? 0.35 : 0.85);
    color += vec3(0.2, 0.42, 0.72) * surfaceNoise * liveAmt * (uVita > 0.5 ? 0.07 : 0.2);
    color += (uVita > 0.5 ? vec3(0.28, 0.48, 0.72) : vec3(0.55, 0.38, 0.22))
      * surfaceNoise * uMelodyNoise * lineDrive * (uVita > 0.5 ? 0.08 : 0.32);

    // 中音のヒットできらめく粒状ハイライト（煌めき表現）。位置は固定し、
    // uMid/uMelody（＝実際のヒットで立ち上がる値）が来た瞬間だけ明滅させる
    float glint = pow(noise(vLocalPosition * 24.0), 5.5);
    float glintDrive = clamp(uMid * 1.3 + uMelody * 0.95, 0.0, 1.4);
    color += (uVita > 0.5 ? vec3(0.92, 0.97, 1.0) : vec3(1.0, 0.9, 0.68))
      * glint * glintDrive * (uVita > 0.5 ? 0.48 : 1.5);

    float hotVeins = pow(noise(vLocalPosition * 9.5 + vec3(flowTime * 0.5)), 2.8);
    float ember = pow(noise(vLocalPosition * 22.0 - vec3(flowTime * 0.8)), 4.2);
    float glowScale = uVita > 0.5 ? 0.32 : 1.0;
    color += vec3(0.45, 0.78, 1.0) * hotVeins * glowAmt * glowScale
      * (0.22 + uHigh * 0.32) * mix(0.7, 1.0, pearl);
    // ember はパレットのみ（白寄りミックスなし）
    color += electricBlue * ember * glowAmt * glowScale * uHigh * 0.18 * mix(0.65, 1.0, pearl);

    // 透明外殻が強いと「中身が空っぽ」に見えやすいので、fresnel/ラインの寄与を抑える
    float alpha = uOpacity + pearl * 0.08 * idleDim + melodyLines * (uVita > 0.5 ? 0.07 : 0.16)
      + microSignals * (uVita > 0.5 ? 0.045 : 0.12);
    alpha += glint * glintDrive * (uVita > 0.5 ? 0.022 : 0.06);
    alpha += hotVeins * glowAmt * glowScale * 0.045 + ember * glowAmt * glowScale * uHigh * 0.03;
    alpha += lineDrive * pearl * uMelodyFresnel * (uVita > 0.5 ? 0.018 : 0.045);
    alpha *= mix(1.0, 0.58, frozen);

    // vita: 真珠は白〜シアンの薄い艶。パレット乗算で緑紫に染まらないようにする
    // （以前の irid*uPaletteColor と color*0.58 が白芯を潰していた）。
    if (uVita > 0.5) {
      vec3 irid = 0.55 + 0.32 * cos(6.28318 * (pearl * 0.85 + vec3(0.0, 0.14, 0.48)) + flowTime * 0.12);
      vec3 pearlTint = mix(vec3(0.88, 0.94, 1.0), electricBlue, 0.38);
      // 天気/曲の色はごく薄い染みだけ残す
      pearlTint = mix(pearlTint, uPaletteColor, 0.12);
      vec3 pearlColor = irid * mix(pearlTint * 0.95, pearlTint * 1.18, 0.7);
      color = mix(color, color * 0.82 + pearlColor * (0.22 + uBreath * 0.12), 0.24 * idleDim);
      alpha += (0.01 + pearl * 0.025 + uBreath * pearl * 0.016) * idleDim;
      // 宝石（vita [P2]）: **結晶になっている面の上だけ**、膜を平らなガラス板に見せる。
      // 生物の面の上は真珠シアンの確定値のまま（2026-08-11 承認済みの見た目を壊さない）。
      ${GEM_MEMBRANE_FRAGMENT}
      // 結晶の面の上は**天井を下げて透かす**（[P1] step 2）。以前は逆に上げていて
      // （0.55 + gGemMask*0.06）、乳白の膜が濃いまま下の宝石が見えなかった。
      // 稜と鏡面は上の加算で残るので、板は「白く盛る」のではなく「透ける」。
      alpha = min(alpha, mix(0.55, 0.30, gGemMask));
      color = min(color, vec3(0.92 + gGemMask * 0.05));
    }

    // petrify: 下から上へ結晶化が進む（変容スタイル）
    if (uPetrify > 0.001) {
      float h = clamp(vWorldPosition.y / 1.9, -1.0, 1.0);
      float front = uPetrify * 2.9 - 1.45;
      float crystal = smoothstep(h - 0.34, h + 0.1, front + surfaceNoise * 0.4);
      float facets = pow(noise(vLocalPosition * 12.5), 2.2);
      vec3 crystalColor =
        uPaletteColor * (0.35 + facets * 1.05) +
        uPaletteAccent * pearl * 1.35 +
        vec3(1.0) * pow(facets, 3.0) * 0.65;
      color = mix(color, crystalColor, crystal);
      alpha = mix(alpha, 0.16 + pearl * 0.3 + facets * 0.12, crystal);
    }

    gl_FragColor = vec4(color, alpha);
  }
`;
class AudioInput {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  /** スピーカー出力専用。解析前段には入れず、ブラウザ再生音量だけを変える */
  private outputGain: GainNode | null = null;
  private outputVolume = 0.8;
  private monitoringConnected = false;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  /** 直近フレームのグリット（歪み/ザラつき）= プレゼンス帯のスペクトル平坦度。音色軸の主信号。 */
  private spectralFlatness = 0;
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
  /** 曲内ピーク正規化前の帯域。リズム検出はこちらを使う（誤反応防止） */
  private rhythmBands: AudioBands = {
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
  private static readonly BAND_NORM_FLOOR = 0.34;
  /** ピーク追従（速い）— 持続的な大音量に ~1 秒で追いつく */
  private static readonly BAND_NORM_ATTACK = 2.4;
  /** ピーク減衰（非常に遅い; 時定数 ~55 秒）— 曲全体のスケール感を保持する */
  private static readonly BAND_NORM_RELEASE = 1 / 55;
  /** ピーク正規化の混ぜ具合（1=フルAGC／0=絶対値のみ）。下げると静かな所の過剰反応を抑える */
  private static readonly BAND_NORM_AMOUNT = 0.36;
  /** >1 で中域を落としピークを残す（コンプを弱めてダイナミクスを広げる） */
  private static readonly BAND_NORM_CURVE = 1.12;
  private profile = createEmptyAudioProfile();
  private previousProfileBands: AudioBands | null = null;
  private lowProfileTotal = 0;
  private midProfileTotal = 0;
  private highProfileTotal = 0;
  private overallProfileTotal = 0;
  private centroidProfileTotal = 0;
  private bassFocusProfileTotal = 0;
  private melodyFocusProfileTotal = 0;
  private brightnessProfileTotal = 0;
  private contrastProfileTotal = 0;
  private variationProfileTotal = 0;
  private attackProfileTotal = 0;
  private attackEventCount = 0;
  private quietProfileDuration = 0;
  private loudProfileDuration = 0;
  private earlyProfileSamples = 0;
  private earlyCentroidProfileTotal = 0;
  private earlyBrightnessProfileTotal = 0;
  private earlyMelodyFocusProfileTotal = 0;
  private lateProfileSamples = 0;
  private lateCentroidProfileTotal = 0;
  private lateBrightnessProfileTotal = 0;
  private lateMelodyFocusProfileTotal = 0;

  private connectStream(stream: MediaStream) {
    this.devAudioUrl = null;
    this.devAudioBuffer = null;
    this.initAnalyser();

    this.stream = stream;
    this.source = this.context!.createMediaStreamSource(stream);
    this.source.connect(this.analyser!);
  }

  private async ensureContextRunning() {
    if (this.context && this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  async startMicrophone(deviceId?: string) {
    const open = async (audio: boolean | MediaTrackConstraints) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: false,
      });
      this.connectStream(stream);
      await this.ensureContextRunning();
    };

    const wantsDevice = Boolean(deviceId && deviceId !== "default");
    try {
      if (wantsDevice) {
        // exact だとデバイス消失時に NotFoundError になるため ideal を使う
        await open({
          deviceId: { ideal: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        });
      } else {
        // 既定入力は最も互換性の高い制約にする
        await open(true);
      }
    } catch (error) {
      // 指定デバイスが使えない場合は既定入力へフォールバック
      if (wantsDevice) {
        await open(true);
        return;
      }
      throw error;
    }
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
    await this.ensureContextRunning();
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
   * 曲の進行度 0..1。**duration が分かるときだけ**（＝バッファ音源の決定論再生）。
   * マイク入力では曲の長さが分からないので **-1** を返す。
   * 熟成度（maturity）の「最低保証」に使う。worklist [P1]。
   */
  getPlaybackProgress(): number {
    if (!this.timeline || this.timeline.duration <= 0 || this.playbackStartAt < 0) {
      return -1;
    }
    return Math.min(1, Math.max(0, this.simTime / this.timeline.duration));
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
      const bands = this.bandsFromDeterministicFrame(frame, hop);
      steps.push({
        bands,
        rhythmBands: { ...this.rhythmBands },
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
    this.disconnectMonitoring();
  }

  /** ブラウザ再生音量 (0–1)。解析・造形には影響しない */
  setOutputVolume(value: number) {
    this.outputVolume = clamp01(value);
    if (this.outputGain) {
      this.outputGain.gain.value = this.outputVolume;
    }
  }

  getOutputVolume() {
    return this.outputVolume;
  }

  private connectMonitoring() {
    if (!this.analyser || !this.outputGain || !this.context || this.monitoringConnected) {
      return;
    }
    this.analyser.connect(this.outputGain);
    this.outputGain.connect(this.context.destination);
    this.monitoringConnected = true;
  }

  private disconnectMonitoring() {
    if (!this.analyser || !this.outputGain || !this.context || !this.monitoringConnected) {
      this.monitoringConnected = false;
      return;
    }
    try {
      this.analyser.disconnect(this.outputGain);
    } catch {
      // not connected
    }
    try {
      this.outputGain.disconnect(this.context.destination);
    } catch {
      // not connected
    }
    this.monitoringConnected = false;
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

    this.connectMonitoring();

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
    this.connectMonitoring();
    const when = this.context.currentTime;
    source.start(when);
    this.playbackStartAt = when;
    this.simTime = 0;
    this.bufferSource = source;
  }

  private disconnect() {
    this.disconnectMonitoring();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.bufferSource?.stop();
    this.bufferSource?.disconnect();
    this.stream = null;
    this.source = null;
    this.bufferSource = null;
    this.outputGain = null;
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
    this.outputGain = this.context.createGain();
    this.outputGain.gain.value = this.outputVolume;
    this.monitoringConnected = false;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.resetProfile();
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
    // 目立つギターリフ／主旋律 (でっでででででー 等) が乗る 500–1800 Hz
    const melody = this.readBand(500, 1800);
    const presence = this.readBandHybrid(1800, 6500);
    const air = this.readBandHybrid(5000, 18000);
    const high = presence * 0.38 + air * 0.62;
    // 音色軸（鉱物 vs 丸み）の主信号: プレゼンス帯のスペクトル平坦度＝歪みのグリット。
    this.spectralFlatness = this.readSpectralFlatness(1500, 7000);
    const overall =
      sub * 0.18 + low * 0.32 + mid * 0.2 + melody * 0.14 + high * 0.14;
    const spectralTotal = sub + low + mid + high + melody * 0.35 + 0.0001;
    const centroid = this.readCentroid(24, 9000);
    const bassFocus = (sub + low) / spectralTotal;
    // キック胴でメロ存在感が潰れないよう、低域の分母を少し抑える
    const melodyFocus =
      melody / (sub * 0.55 + low * 0.7 + mid * 0.85 + high + melody * 0.4 + 0.0001);
    const brightness = high / spectralTotal;
    const contrast =
      (Math.abs(sub - mid) +
        Math.abs(low - mid) +
        Math.abs(melody - mid) +
        Math.abs(mid - high)) /
      spectralTotal;

    // 帯域ごとのノイズゲート（絶対値）— 少し厳しめにして弱い常時信号を落とす
    // centroid/bassFocus/brightness/contrast はスペクトル比率（相対値）
    const gatedSub = smoothstep(0.035, 0.42, sub);
    const gatedLow = smoothstep(0.04, 0.46, low);
    const gatedMid = smoothstep(0.03, 0.38, mid);
    const gatedMelody = smoothstep(0.012, 0.24, melody);
    const gatedHigh = smoothstep(0.01, 0.18, high);
    const gatedOverall = smoothstep(0.025, 0.4, overall);
    // リズム検出は絶対ゲートのみ（曲内ピーク正規化すると静かな所も「大」になり曲とずれる）
    this.rhythmBands = {
      sub: gatedSub,
      low: gatedLow,
      mid: gatedMid,
      melody: gatedMelody,
      high: gatedHigh,
      overall: gatedOverall,
      centroid,
      bassFocus,
      melodyFocus,
      brightness: clamp01(brightness),
      contrast: clamp01(contrast),
    };
    // 造形・パレット用は曲内相対正規化
    this.bands = {
      sub: this.normalizeBandBySongPeak("sub", gatedSub, deltaTime),
      low: this.normalizeBandBySongPeak("low", gatedLow, deltaTime),
      mid: this.normalizeBandBySongPeak("mid", gatedMid, deltaTime),
      melody: this.normalizeBandBySongPeak("melody", gatedMelody, deltaTime),
      high: this.normalizeBandBySongPeak("high", gatedHigh, deltaTime),
      overall: this.normalizeBandBySongPeak("overall", gatedOverall, deltaTime),
      centroid,
      bassFocus,
      melodyFocus,
      brightness: clamp01(brightness),
      contrast: clamp01(contrast),
    };

    this.updateProfile(this.bands, deltaTime);

    return this.bands;
  }

  getRhythmBands(): AudioBands {
    return this.rhythmBands;
  }

  /** 直近フレームのグリット（歪み/ザラつき）。音色軸の主信号。0..1。 */
  getSpectralFlatness(): number {
    return this.spectralFlatness;
  }

  getProfile() {
    return this.profile;
  }

  private bandsFromDeterministicFrame(frame: DeterministicSpectralFrame, deltaTime: number): AudioBands {
    const gatedSub = smoothstep(0.035, 0.42, frame.sub);
    const gatedLow = smoothstep(0.04, 0.46, frame.low);
    const gatedMid = smoothstep(0.03, 0.38, frame.mid);
    const gatedMelody = smoothstep(0.012, 0.24, frame.melody);
    const gatedHigh = smoothstep(0.01, 0.18, frame.high);
    const gatedOverall = smoothstep(0.025, 0.4, frame.overall);
    // グリット（歪み/ザラつき）。**Dev Audio の曲はすべてこの決定論経路を通る**ので、
    // ここが音色軸の実際の入口。以前は brightness/contrast の代用値だったため
    // 歪みを一度も測れておらず、mineral 軸がほぼ全曲 0 になっていた（2026-08-12 修正）。
    // 平坦度はタイムライン構築時に FFT ビンから計算済み（deterministic-audio.ts）。
    this.spectralFlatness = clamp01(frame.flatness);
    this.rhythmBands = {
      sub: gatedSub,
      low: gatedLow,
      mid: gatedMid,
      melody: gatedMelody,
      high: gatedHigh,
      overall: gatedOverall,
      centroid: frame.centroid,
      bassFocus: frame.bassFocus,
      melodyFocus: frame.melodyFocus,
      brightness: clamp01(frame.brightness),
      contrast: clamp01(frame.contrast),
    };
    this.bands = {
      sub: this.normalizeBandBySongPeak("sub", gatedSub, deltaTime),
      low: this.normalizeBandBySongPeak("low", gatedLow, deltaTime),
      mid: this.normalizeBandBySongPeak("mid", gatedMid, deltaTime),
      melody: this.normalizeBandBySongPeak("melody", gatedMelody, deltaTime),
      high: this.normalizeBandBySongPeak("high", gatedHigh, deltaTime),
      overall: this.normalizeBandBySongPeak("overall", gatedOverall, deltaTime),
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
   * - フルAGCだと常に反応しすぎるため、絶対値を混ぜてコンプを弱める
   */
  private normalizeBandBySongPeak(key: BandNormKey, value: number, deltaTime: number) {
    const peak = this.bandPeakEma[key];
    const rate = value > peak ? AudioInput.BAND_NORM_ATTACK : AudioInput.BAND_NORM_RELEASE;
    this.bandPeakEma[key] = peak + (value - peak) * Math.min(1, deltaTime * rate);
    const denom = Math.max(AudioInput.BAND_NORM_FLOOR, this.bandPeakEma[key]);
    const compressed = clamp01(value / denom);
    const amount = AudioInput.BAND_NORM_AMOUNT;
    const blended = compressed * amount + value * (1 - amount);
    return clamp01(Math.pow(blended, AudioInput.BAND_NORM_CURVE));
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
    this.melodyFocusProfileTotal = 0;
    this.brightnessProfileTotal = 0;
    this.contrastProfileTotal = 0;
    this.variationProfileTotal = 0;
    this.attackProfileTotal = 0;
    this.attackEventCount = 0;
    this.quietProfileDuration = 0;
    this.loudProfileDuration = 0;
    this.earlyProfileSamples = 0;
    this.earlyCentroidProfileTotal = 0;
    this.earlyBrightnessProfileTotal = 0;
    this.earlyMelodyFocusProfileTotal = 0;
    this.lateProfileSamples = 0;
    this.lateCentroidProfileTotal = 0;
    this.lateBrightnessProfileTotal = 0;
    this.lateMelodyFocusProfileTotal = 0;
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
      this.melodyFocusProfileTotal += bands.melodyFocus * sampleDuration;
      this.brightnessProfileTotal += bands.brightness * sampleDuration;
      this.contrastProfileTotal += bands.contrast * sampleDuration;

      if (this.profile.activeDuration <= 12) {
        this.earlyProfileSamples += sampleDuration;
        this.earlyCentroidProfileTotal += bands.centroid * sampleDuration;
        this.earlyBrightnessProfileTotal += bands.brightness * sampleDuration;
        this.earlyMelodyFocusProfileTotal += bands.melodyFocus * sampleDuration;
      } else if (this.profile.activeDuration >= 24) {
        this.lateProfileSamples += sampleDuration;
        this.lateCentroidProfileTotal += bands.centroid * sampleDuration;
        this.lateBrightnessProfileTotal += bands.brightness * sampleDuration;
        this.lateMelodyFocusProfileTotal += bands.melodyFocus * sampleDuration;
      }

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
    this.profile.melodyFocus = this.melodyFocusProfileTotal / activeDuration;
    this.profile.brightness = this.brightnessProfileTotal / activeDuration;
    this.profile.contrast = this.contrastProfileTotal / activeDuration;
    this.profile.centroid = this.centroidProfileTotal / activeDuration;
    const earlyCentroid = this.earlyCentroidProfileTotal / Math.max(0.0001, this.earlyProfileSamples);
    const earlyBrightness = this.earlyBrightnessProfileTotal / Math.max(0.0001, this.earlyProfileSamples);
    const earlyMelodyFocus =
      this.earlyMelodyFocusProfileTotal / Math.max(0.0001, this.earlyProfileSamples);
    const lateCentroid = this.lateCentroidProfileTotal / Math.max(0.0001, this.lateProfileSamples);
    const lateBrightness = this.lateBrightnessProfileTotal / Math.max(0.0001, this.lateProfileSamples);
    const lateMelodyFocus =
      this.lateMelodyFocusProfileTotal / Math.max(0.0001, this.lateProfileSamples);
    this.profile.sectionContrast = clamp01(
      Math.abs(lateCentroid - earlyCentroid) * 0.75 +
        Math.abs(lateBrightness - earlyBrightness) * 0.6 +
        Math.abs(lateMelodyFocus - earlyMelodyFocus) * 0.95 +
        // 静かと盛り上がりの両立・時間変動も「セクション差」として種・パレットへ
        Math.sqrt(
          Math.max(0, this.quietProfileDuration / Math.max(0.0001, this.profile.duration)) *
            Math.max(0, this.loudProfileDuration / Math.max(0.0001, this.profile.duration)),
        ) *
          2.4 +
        (this.variationProfileTotal / Math.max(0.0001, this.profile.activeDuration || this.profile.duration)) *
          0.28,
    );
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

  /**
   * スペクトル平坦度（幾何平均 / 算術平均）。トーナルな音は 0 に近く、
   * 広帯域のノイズ・歪みは 1 に近い。**歪みギターの「グリット」を検出する**ため、
   * プレゼンス帯（1.5–7kHz。ここに歪みの倍音・ザラつきが乗る）で測る。
   * 音色軸（鉱物 vs 丸み）の主信号。四つ打ち（トーナルなキック/シンセ）はここが低く、
   * メタル/歪みギターは高い ＝ 修羅場 と Fury を別物にする鍵。
   */
  private readSpectralFlatness(minHz: number, maxHz: number) {
    if (!this.context || !this.analyser || !this.data) {
      return 0;
    }
    const nyquist = this.context.sampleRate / 2;
    const startIndex = Math.max(0, Math.floor((minHz / nyquist) * this.data.length));
    const endIndex = Math.min(this.data.length - 1, Math.ceil((maxHz / nyquist) * this.data.length));
    let logSum = 0;
    let sum = 0;
    let count = 0;
    for (let i = startIndex; i <= endIndex; i += 1) {
      // +イプシロンで log(0) を避ける。0..255 → 0..1。
      const v = this.data[i] / 255 + 1e-4;
      logSum += Math.log(v);
      sum += v;
      count += 1;
    }
    if (count === 0 || sum <= 0) {
      return 0;
    }
    const geoMean = Math.exp(logSum / count);
    const arithMean = sum / count;
    const flatness = geoMean / arithMean; // 0（トーナル）..1（平坦・ノイズ/歪み）
    // 帯域全体がほぼ無音のときは平坦度が意味を持たない（微小ノイズで 1 に張り付く）ので、
    // プレゼンス帯のエネルギーでゲートする。
    const presenceGate = smoothstep(0.02, 0.14, arithMean);
    return clamp01(flatness) * presenceGate;
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

// P3「粒子に厚みを持たせる」: 吸着する粒（particles）を平面の丸ビルボードから
// 球インポスターにする。gl_PointCoord から擬似法線を作り、方向性のある陰影＋
// オフセットしたハイライトを乗せることで、加算ブレンドのままでも「光る粒」ではなく
// 「陰影のある小さな球（＝彫刻に付いた粒）」に見せる。頂点数・ドローコールは不変。
// three r184 の points フラグメントの `#include <color_fragment>` を差し替える。
const PARTICLE_BEAD_COLOR_FRAGMENT = /* glsl */ `
  vec2 beadUv = gl_PointCoord * 2.0 - 1.0;
  float beadR2 = dot(beadUv, beadUv);
  if (beadR2 > 1.0) discard;
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    diffuseColor *= vColor;
  #endif
  float beadZ = sqrt(1.0 - beadR2);
  vec3 beadN = vec3(beadUv.x, -beadUv.y, beadZ);
  vec3 beadL = normalize(vec3(-0.42, 0.66, 0.62));
  float beadDiff = clamp(dot(beadN, beadL), 0.0, 1.0);
  // 暗部も 0 にしない（加算ブレンドで完全に消えると輪郭が痩せる）。
  diffuseColor.rgb *= 0.30 + 0.86 * beadDiff;
  // 光源方向へオフセットした鏡面ハイライト（色は乗せず白く出す＝立体の艶）。
  vec3 beadH = normalize(beadL + vec3(0.0, 0.0, 1.0));
  float beadSpec = pow(clamp(dot(beadN, beadH), 0.0, 1.0), 28.0);
  diffuseColor.rgb += beadSpec * 0.55;
  // 縁を柔らかく落として硬い円盤にしない。
  diffuseColor.a *= smoothstep(1.0, 0.72, beadR2);
`;

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
  /**
   * 完成フェーズ質感（clearcoat / sheen / iridescence）の下限。
   * three.js は値が 0 かどうかでシェーダーチャンクの有無を決めるため、
   * 形成中も 0 にせずこの値で保ち、完成の瞬間の再コンパイルを避ける。
   */
  private static readonly FINISH_EPSILON = 1e-4;

  /**
   * 熟成度（maturity）の定数。**2026-08-13 に 9 曲の実測から決めた**
   * （`maturity_probe.js` で 9 曲を最後まで流し、`maturity_fit.js` で
   * 「進行度との差の平均」を目的関数に総当たり）。実測表は handoff 3章。
   * **無音や 1 曲だけを見て動かさないこと。**
   */
  /** LIVE で到達する上限（完成の 90%。残り 10% は完成アニメーションで詰める）。ユーザー判断 */
  private static readonly MATURITY_LIVE_CEILING = 0.9;
  /** 蓄積量の正規化。平均音量 0 のときこの値で天井 */
  private static readonly MATURITY_K0 = 0.65;
  /** 平均音量で正規化を可変にする量（濃い曲ほど天井が遠い＝早く張り付かない） */
  private static readonly MATURITY_LOUD_GAIN = 1.5;
  /** 蓄積量は序盤で急に伸びるので、凸変換で進行度に近い曲線へ寄せる */
  private static readonly MATURITY_POWER = 1.7;

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
  /** sparkles と同じ位置/色を大きく淡く重ねた擬似グロー（EffectComposer 無しでの底上げ） */
  private readonly sparkleGlow: THREE.Points;
  private readonly detachmentDustSand: THREE.Points;
  private readonly detachmentDustMetal: THREE.Points;
  private readonly detachmentDustSpark: THREE.Points;
  private readonly coreMaterial: THREE.MeshPhysicalMaterial;
  private readonly innerCoreMaterial: THREE.MeshPhysicalMaterial;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly glowDustMaterial: THREE.PointsMaterial;
  private readonly sparkleMaterial: THREE.PointsMaterial;
  private readonly sparkleGlowMaterial: THREE.PointsMaterial;
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
  /** 描画に使う高解像度メッシュ。変形はここでは計算しない（`display-mesh.ts`） */
  private readonly displayGeometry: THREE.BufferGeometry;
  private readonly displaySurfaceGeometry: THREE.BufferGeometry;
  private displayBinding!: DisplayMeshBinding;
  private displaySurfaceBinding!: DisplayMeshBinding;
  private displayPositions!: Float32Array;
  private displaySurfacePositions!: Float32Array;
  private displayColors!: Float32Array;
  private displayPierce!: Float32Array;
  private readonly basePositions: Float32Array;
  private readonly baseSurfacePositions: Float32Array;
  private readonly accumulated: Float32Array;
  private readonly midBumps: Float32Array;
  private readonly highSpikes: Float32Array;
  private readonly erosionField: Float32Array;
  private readonly sculptureMemory: Float32Array;
  /**
   * 完成の瞬間に一度だけ焼き込む「曲の記録」用の遷移状態。
   * bake*Original = 焼き込み直前の値のスナップショット、bake*Scale = 完成アニメーション
   * (ease 0→1) で到達させる最終倍率。null の間は焼き込み無し（通常の演奏中）。
   */
  private bakeVectorFieldOriginal: Float32Array | null = null;
  private bakeVectorFieldScale: Float32Array | null = null;
  private bakeSculptureMemoryOriginal: Float32Array | null = null;
  private bakeErosionFieldOriginal: Float32Array | null = null;
  private bakeScalarScale: Float32Array | null = null;
  /** 成長アルゴリズム固有の永続起伏（完成形の差を残す） */
  private readonly algoIdentity: Float32Array;
  private readonly liveOffset: Float32Array;
  private readonly surfaceLiveOffset: Float32Array;
  /** コア接触による膜の外向き圧力（頂点ごと） */
  private readonly membranePressure: Float32Array;
  private readonly membranePressureScratch: Float32Array;
  /** 膜メッシュの1-ring近傍（拡散用、-1 終端） */
  private readonly membraneNeighbors: Int32Array;
  /** 膜の折り重なりをほどくときの作業領域（変位を持つ） */
  private membraneRelaxScratch!: Float32Array;
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
  /**
   * 音の露出の積算 `Σ bands.overall * dt`。熟成度の正規化（平均音量）に使う。
   * 単調増加で飽和しないのが `formDevelopment` との違い。
   */
  private soundExposure = 0;
  /**
   * 熟成度 0..1。**LIVE から完成の見た目へ連続に寄せるための唯一のスカラー**（worklist [P1]）。
   * 0 = 生まれたて / `MATURITY_LIVE_CEILING` = LIVE で到達する上限 / 1 = 完成。
   * **単調増加**（下がると「戻った」に見えるし、蓄積の原則に反する）。
   */
  private maturity = 0;
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
  /** 結晶ファセット（音色→鉱物）の平面軸と距離。morphologySeed から曲ごとに決まる。 */
  private static readonly facetCount = GEM_FACET_COUNT;
  private readonly facetAxes = new Float32Array(SoundSculpture.facetCount * 3);
  private readonly facetLevels = new Float32Array(SoundSculpture.facetCount);
  /**
   * 面ごとの「結晶になる順番」0..1（曲ごとに違う）。音色軸がこのランクを越えた面から
   * 順に結晶になる。**軸は強度ではなく結晶になる面の枚数を決める**（[P2] の設計の要）。
   */
  private readonly facetRank = new Float32Array(SoundSculpture.facetCount);
  /** いまその面が結晶か 0..1（軸で毎フレーム更新。境界は smoothstep で滑らかに立ち上がる）。 */
  private readonly facetCrystal = new Float32Array(SoundSculpture.facetCount);
  /** 1 枚でも結晶になっているか。0 なら幾何側のファセット処理ごと飛ばす（軸 0 の完全な no-op）。 */
  private anyCrystalFace = 0;
  /** 面法線をワールドへ回す行列（宝石シェーダはここからビュー空間へ落とす）。 */
  private readonly facetNormalMatrix = new THREE.Matrix3();
  private readonly facetWorldScratch = new THREE.Vector3();
  /** 膜ファセットの2パス用スクラッチ（面ドメインごとの平均距離）。 */
  private readonly facetSumDot = new Float64Array(SoundSculpture.facetCount);
  private readonly facetCnt = new Int32Array(SoundSculpture.facetCount);
  /** スタイル基準 + クリックシフトの粘土色 — core / inner / 膜 / 頂点が共有 */
  private clayHueBase = 0.09;
  private claySatBase = 0.18;
  private clayLightBase = 0.78;
  private clayColorShift = createClayColorShift();
  private weatherClayShift = createClayColorShift();
  private lastWeatherClayKey = "";
  private lastWeatherSnapshot: import("./live-weather").LiveWeatherSnapshot | null = null;
  private lastWeatherHour = 12;
  /** 再生中に蓄積プロファイルから導いた曲パレット（完成前） */
  private liveSongPalette: SculpturePalette | null = null;
  /** 0=スタイル基準色 → 1=曲パレット（天気は常に両方へ加算） */
  private songColorBlend = 0;
  private pearlColorBakeCooldown = 0;
  private lastPearlBakeHue = -1;
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
  /**
   * 完成後の質感倍率を**形成中にも**使うためのキャッシュ（[P1]）。
   * `deriveAfterlifeMaterial` は純関数で palette を見ない（species だけ）ので毎フレーム作れる。
   * 完成後は `updateAfterlife` が確定値で作り直す。
   */
  private liveAfterlife: AfterlifeMaterial = deriveAfterlifeMaterial(
    NEUTRAL_SCULPTURE_PALETTE,
    DEFAULT_SPECIES_PROFILE,
  );
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
  private lastChopIndexApplied = -1;
  private lastSalienceIndexApplied = -1;
  private lastPulseIndexApplied = -1;
  private kickImpulse = 0;
  private snareImpulse = 0;
  private hatImpulse = 0;
  private waveImpulse = 0;
  /** 「だ！ダダダ！」用の瞬間ピーク押し込み（速いアタック・速い戻り） */
  private peakPunch = 0;
  /** スネア専用：表面の横割れフラッシュ */
  private snareFlash = 0;
  /** ハット専用：表面のチカチカ */
  private hatFlash = 0;
  /** ギター／中域メロディのうねり */
  private guitarImpulse = 0;
  private guitarFlash = 0;
  /** メロディ句頭（人がフレーズの立ち上がりで感じる反応） */
  private melodyPhraseImpulse = 0;
  /** salienceHigh のスパーク発火用クールダウン（連続発火を防ぐ） */
  private lastSalienceHighSpark = 10;
  /** 音数の多いミックスでイベントが埋もれないよう、直近の視覚イベント密度 */
  private mixBusy = 0;
  /** キック／スネア直後は副次イベントを抑える排他窓 */
  private primaryHitLock = 0;
  /** ドラム起点 LIVE ゲート（キック／スネアが鳴っているときだけ大きく動かす） */
  private drumLiveGate = 0;
  /** エネルギーサージ直後の永久蓄積ブースト（減衰） */
  private sectionSurgeBoost = 0;
  private lastBands: AudioBands | null = null;
  private readonly baseScale = new THREE.Vector3(1, 1, 1);
  /** 周囲 FX をワールド固定にするための逆クォータニオン */
  private readonly ambientFxInvQuat = new THREE.Quaternion();
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
    // 描画に使うのはこちら。変形は上の軽いメッシュで計算して変位だけ流し込む
    this.displayGeometry = createSculptureSphereGeometry(1.34, SCULPTURE_DISPLAY_DETAIL);
    this.displaySurfaceGeometry = createSculptureSphereGeometry(1.46, SCULPTURE_DISPLAY_DETAIL);

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
      this.coreMaterial.sheenRoughness = 0.82;
    }
    if (styleCore.iridescence > 0) {
      this.coreMaterial.iridescence = styleCore.iridescence;
      this.coreMaterial.iridescenceIOR = 1.35;
    }
    if (styleCore.clearcoat > 0) {
      this.coreMaterial.clearcoat = styleCore.clearcoat;
      this.coreMaterial.clearcoatRoughness = 0.55;
    }
    // 完成フェーズで質感を立ち上げるスタイルは、該当チャンクを最初からコンパイルさせておく。
    // 0 → >0 で切り替えると完成の瞬間にシェーダー再コンパイルのカクつきが出るため。
    // FINISH_EPSILON は見た目には現れない大きさ。
    const finish = this.style.completion.finish;
    if (finish) {
      if (finish.clearcoat !== undefined && this.coreMaterial.clearcoat <= 0) {
        this.coreMaterial.clearcoat = SoundSculpture.FINISH_EPSILON;
      }
      if (finish.sheen !== undefined && this.coreMaterial.sheen <= 0) {
        this.coreMaterial.sheen = SoundSculpture.FINISH_EPSILON;
        this.coreMaterial.sheenColor.set(styleCore.sheenColor);
      }
      if (finish.iridescence !== undefined && this.coreMaterial.iridescence <= 0) {
        this.coreMaterial.iridescence = SoundSculpture.FINISH_EPSILON;
      }
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
        // 他スタイルの膜は従来のまま（旧近似）。物理ベース化は vita だけの判断。
        uPaletteColor: { value: new THREE.Color(0.52, 0.66, 0.82) },
        uPaletteAccent: { value: new THREE.Color(0.72, 0.78, 0.9) },
        // 宝石（vita [P2]）: 結晶面の選択。**core と同じ module uniform オブジェクトを共有**
        // するので、パネルを動かすと core と膜が同時に変わる。
        ...gemUniforms,
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
      transparent: true,
      // 膜は常にコアの上に乗せる（透明キュー内でも renderOrder で後ろに）
      side: THREE.FrontSide,
      depthWrite: false,
      depthTest: true,
      // core と競合しないよう前に出す
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.NormalBlending,
    });

    this.core = new THREE.Mesh(this.displayGeometry, this.coreMaterial);
    this.innerCore = new THREE.Mesh(this.displayGeometry, this.innerCoreMaterial);
    this.surface = new THREE.Mesh(this.displaySurfaceGeometry, this.surfaceMaterial);
    // 不透明コア → 透明膜の順を固定（回転で前後が入れ替わらないようにする）
    this.innerCore.renderOrder = 0;
    this.core.renderOrder = 1;
    this.surface.renderOrder = 3;
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
      // 球インポスターで陰影を付けるので size を少しだけ上げて厚みが読める大きさにする
      // （0.028 → 0.032）。map は使わない（形は gl_PointCoord からシェーダで作る）。
      size: 0.032,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    // 平面ビルボード → 陰影付きの球（PARTICLE_BEAD_COLOR_FRAGMENT 参照）。
    this.particleMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        PARTICLE_BEAD_COLOR_FRAGMENT,
      );
    };
    // 他の PointsMaterial（sparkle / glowDust / detachment dust）と同じ points プログラムを
    // 共有して注入前のシェーダが再利用されないよう、独自のキャッシュキーを与える。
    this.particleMaterial.customProgramCacheKey = () => "particle-bead-v1";
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

    // 同じ位置/色を大きく・薄く重ねるだけの疑似ブルーム。renderer 側の
    // トーンマッピング／カラースペースには一切触れないので、EffectComposer で
    // 起きた二重適用のリスクが無い（安全側の底上げ）。
    this.sparkleGlowMaterial = new THREE.PointsMaterial({
      size: 0.14,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: pointCircleMap,
      toneMapped: false,
    });
    this.sparkleGlow = new THREE.Points(this.sparkleGeometry, this.sparkleGlowMaterial);
    this.sparkleGlow.renderOrder = -1;

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
      this.sparkleGlow,
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
      this.sparkleGlow.visible = false;
      this.detachmentDustSand.visible = false;
      this.detachmentDustMetal.visible = false;
      this.detachmentDustSpark.visible = false;
    }
    // dither: 2D 網点用のマット陰影。内側コア・影を消し、階調はポストプロセスへ
    if (this.style.id === "dither") {
      this.core.material = createDitherMatteMaterial();
      this.innerCore.visible = false;
      this.core.castShadow = false;
      this.core.receiveShadow = false;
      this.innerCore.castShadow = false;
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

    // --- 表示専用メッシュの結線（初期化時に1回だけ） ---
    this.displayBinding = bindDisplayMesh(this.displayGeometry, this.geometry);
    this.displaySurfaceBinding = bindDisplayMesh(this.displaySurfaceGeometry, this.surfaceGeometry);
    this.displayPositions = this.displayGeometry.attributes.position.array as Float32Array;
    this.displaySurfacePositions = this.displaySurfaceGeometry.attributes.position
      .array as Float32Array;
    this.displayColors = new Float32Array(this.displayGeometry.attributes.position.count * 3);
    this.displayPierce = new Float32Array(this.displayGeometry.attributes.position.count);
    this.displayGeometry.setAttribute("color", new THREE.BufferAttribute(this.displayColors, 3));
    this.displayGeometry.setAttribute("aPierce", new THREE.BufferAttribute(this.displayPierce, 1));

    if (this.style.membrane.vita) {
      // 肌理のドメイン（変形前の球面方向）。core のシェーダだけが読む静的な attribute。
      // **表示メッシュ側へ付ける**（シェーダが読むのは描画に使うメッシュの attribute）
      attachClayGrainAttribute(this.displayGeometry, this.displayBinding.basePositions);
    }
    this.coreColorBase = new Float32Array(this.accumulated.length * 3);
    this.membraneNeighbors = this.buildMembraneNeighbors(
      this.surfaceGeometry,
      this.accumulated.length,
    );
    this.membraneRelaxScratch = new Float32Array(this.accumulated.length * 3);
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
    } else if (this.style.id !== "dither") {
      this.bakeCoreClayMottle(0.18);
    }
  }

  /**
   * vita の混色の2極（暖⇔寒）を、いまの clayHueBase・時刻・天気・曲から求める。
   * base を中心に ±spread で開き、暖極には時刻シフト・寒極には天気シフトを乗せて
   * 「時刻の色」と「天気の色」が面内の別々の領域に出るようにする。
   * 配分の偏り（cool 側の面積）は曲の明るさ・天気（雲/雨）で動かす。
   * SPREAD = 0 で warm===cool===base に潰れ、従来の単色＋ノイズに戻る。
   */
  /**
   * 音色→形の語彙軸 0..1（0=丸み/有機, 1=鉱物/角）。
   * dev override が有効ならそれ、無ければ曲の音色軸 `SpeciesProfile.mineral`
   * （形成中は EMA、完成時に確定）。丸み端で従来一致にするため 0 が「効果なし」。
   */
  /**
   * 熟成度を進める。**worklist [P1] の中核。**
   *
   * `maturity = max(蓄積量ベース, 進行度ベース)` を単調増加で追う。
   * - **蓄積量ベース**（音の内容で寄る）: `clamp01((scalarMean / (K0*(1+A*平均音量)))^P)`。
   *   `scalarMean` は永久メモリ（`sculptureMemory` + `erosionField`）の平均。
   *   2026-08-13 に 9 曲を最後まで流して、進行度との差の平均を目的関数に総当たりして決めた
   *   （`maturity_probe.js` → `maturity_fit.js`。実測表は handoff 3章）。
   * - **進行度ベース**（最低保証）: 曲の進行度。**duration が分かるときだけ**。
   *   蓄積量だけでは静かな曲が終端 0.68〜0.77 までしか行かず、完成の飛びが 3 割残ることが
   *   実測で分かったので、ユーザー判断で最低保証を入れた。マイク入力（progress < 0）では
   *   蓄積量だけになる。
   *
   * 完成後は残り（1 - 上限）を完成アニメーションの ease で詰める。
   */
  private updateMaturity(deltaTime: number) {
    if (this.completed) {
      // 完成: 上限 → 1 を完成アニメーションに乗せる（瞬間の段差を作らない）
      const target =
        SoundSculpture.MATURITY_LIVE_CEILING +
        (1 - SoundSculpture.MATURITY_LIVE_CEILING) * smoothstep(0, 1, this.completionProgress);
      this.maturity = Math.max(this.maturity, target);
      return;
    }
    const n = this.accumulated.length;
    if (n === 0) {
      return;
    }
    let scalarSum = 0;
    for (let i = 0; i < n; i += 1) {
      scalarSum += Math.abs(this.sculptureMemory[i]) + Math.abs(this.erosionField[i]);
    }
    const scalarMean = scalarSum / n;
    const loud = this.activeFormingTime > 1 ? this.soundExposure / this.activeFormingTime : 0.3;
    const norm = SoundSculpture.MATURITY_K0 * (1 + SoundSculpture.MATURITY_LOUD_GAIN * loud);
    const fromAccum = clamp01(Math.pow(Math.max(0, scalarMean) / norm, SoundSculpture.MATURITY_POWER));
    // 蓄積量と進行度の**平均**（[P1]）。max（どちらか先行）だと、蓄積が速い曲
    // （Fury は曲の 45% で蓄積が振り切れる）で後半に軌跡が残らなかった。
    // 平均なら 0.9 到達が約 85% まで伸び、静かな曲は進行度が下支えして終端 0.9 を保つ。
    // 曲の長さが分からない入力（マイク）は -1 が返るので蓄積量だけになる。
    const progress = audioInput.getPlaybackProgress();
    const blended = progress >= 0 ? fromAccum * 0.5 + progress * 0.5 : fromAccum;
    const target = blended * SoundSculpture.MATURITY_LIVE_CEILING;
    // 追従は 1 秒程度。単調増加（下げない）。
    const next = this.maturity + (target - this.maturity) * Math.min(1, deltaTime);
    this.maturity = Math.max(this.maturity, next);
  }

  /**
   * 形成中も「完成後の呼吸」を裏で回す（[P1]）。
   *
   * 完成後の膜のドライブは**ゼロではなく呼吸グロー**（`getMembraneLiveTarget` の breathe 分岐）。
   * LIVE の地をそこへ寄せるには、形成中から同じ位相の呼吸が要る。
   * BPM は完成時と同じ `latestRhythm.bpm` から取るので、**完成の瞬間に位相が飛ばない**
   * （そのため `complete()` では `breathTime` / `breathWave` をリセットしない）。
   */
  private updateLiveBreath(deltaTime: number) {
    if (this.completed || !this.style.membrane.vita) {
      return;
    }
    const bpm = latestRhythm.bpm;
    if (bpm > 30 && bpm < 200) {
      this.breathBpm = Math.min(150, Math.max(44, bpm));
    }
    this.breathTime += deltaTime;
    const beat = (this.breathBpm / 60) * Math.PI * SoundSculpture.AFTERLIFE_BREATH_TEMPO;
    const wave =
      (Math.sin(this.breathTime * beat) * 0.6 +
        Math.sin(this.breathTime * beat * 0.5 + 1.7) * 0.4) *
      this.liveAfterlife.breathAmp *
      SoundSculpture.AFTERLIFE_BREATH_STRENGTH;
    this.breathWave = wave * 0.5 + 0.5;
    // 膜の真珠の艶も完成側と同じ呼吸に乗せる（完成でここが段差にならないように）
    this.surfaceMaterial.uniforms.uBreath.value = this.breathWave * this.getMaturity();
  }

  /** 熟成度 0..1。dev override があればそれを返す。**vita 以外では常に 0**（他スタイルは従来のまま）。 */
  getMaturity(): number {
    if (!this.style.membrane.vita) {
      return 0;
    }
    if (maturityMix.override >= 0) {
      return clamp01(maturityMix.override);
    }
    return maturityMix.enabled ? this.maturity : 0;
  }

  /**
   * 熟成度の入力を読み出す（dev 表示・`maturity_probe.js` 用）。
   * **軸のときと同じで、見えない量は決められない。この読み出しは消さないこと。**
   * dev（`?surface=dev`）でしか呼ばれない。1 フレームに 1 回・頂点数ぶんの走査。
   */
  getMaturityInputs(): {
    maturity: number;
    fromAccum: number;
    progress: number;
    formDev: number;
    vecMean: number;
    scalarMean: number;
    exposure: number;
    activeSeconds: number;
    completed: boolean;
  } {
    const n = this.accumulated.length;
    let vecSum = 0;
    let scalarSum = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = i * 3;
      vecSum += Math.hypot(this.vectorField[idx], this.vectorField[idx + 1], this.vectorField[idx + 2]);
      scalarSum += Math.abs(this.sculptureMemory[i]) + Math.abs(this.erosionField[i]);
    }
    const inv = n > 0 ? 1 / n : 0;
    const scalarMean = scalarSum * inv;
    const loud = this.activeFormingTime > 1 ? this.soundExposure / this.activeFormingTime : 0.3;
    const norm = SoundSculpture.MATURITY_K0 * (1 + SoundSculpture.MATURITY_LOUD_GAIN * loud);
    return {
      maturity: this.getMaturity(),
      fromAccum: clamp01(Math.pow(Math.max(0, scalarMean) / norm, SoundSculpture.MATURITY_POWER)),
      progress: audioInput.getPlaybackProgress(),
      formDev: this.formDevelopment,
      vecMean: vecSum * inv,
      scalarMean,
      exposure: this.soundExposure,
      activeSeconds: this.activeFormingTime,
      completed: this.completed,
    };
  }

  getMineralAxis(): number {
    // 音色→形の語彙は vita(classic) だけに効かせる（他の classic 系レガシースタイルは従来のまま）。
    if (!mineralMix.enabled || !this.style.membrane.vita) {
      return 0;
    }
    if (mineralMix.axisOverride >= 0) {
      return clamp01(mineralMix.axisOverride);
    }
    return clamp01(this.getSpecies().mineral);
  }

  private resolvePearlColorPoles(): {
    warmHue: number;
    coolHue: number;
    warmSat: number;
    coolSat: number;
    balanceBias: number;
  } {
    const base = this.clayHueBase;
    const enable = pearlColorMix.enabled ? 1 : 0;
    const spread = pearlColorMix.spread * enable;
    if (spread <= 0) {
      return { warmHue: base, coolHue: base, warmSat: 1, coolSat: 1, balanceBias: 0 };
    }
    // 2026-08-11 案C: 語彙を「無機（寒・真珠シアン/氷）ベース ＋ 有機（暖・珊瑚/琥珀）の染み」に
    // 再定義した。旧実装は base ± spread の対称で、base が琥珀寄りだと暖極が赤(0.0)を越えて
    // 紫へ wrap し、寒極が緑へ開くため「紫×緑」が既定になっていた（ユーザー指摘）。
    // 対処: 暖極は赤を割らないよう floor し、寒極はシアン真珠(0.52)へ寄せて紫を作らない。
    // 曲・環境の平均色（clayHueBase）は殺さない（時刻→暖 / 天気→寒 の割り振りも維持）。
    const time = hourClayShiftFromHour(this.lastWeatherHour);
    const wx = weatherClayShiftFromSnapshot(this.lastWeatherSnapshot, base);
    // 暖・有機: base から暖側へ。**赤(0.0)を割らないよう floor 0.035（珊瑚）** ＝ 紫 wrap を止める。
    const warmHue = Math.max(0.035, base - spread * 0.5 + time.hue * 0.5);
    // 寒・無機: base から寒側へ開き、さらにシアン真珠 0.52 へ 0.45 寄せる（低彩度と併せて氷/貝に見せる）。
    const coolHue = lerpHueShortest(base + spread + wx.hue * 0.5, 0.52, 0.45);
    // 彩度: 無機ほど淡く（真珠・氷）、有機は色を残す。claySatBase への倍率で返す。
    const warmSat = 0.92;
    const coolSat = 0.45;
    // 配分: 無機（寒）を主体に、有機（暖）を少数の染みにする。midpoint は bake 側で寒寄りに置く。
    // 曲が明るい／曇り・雨ほどさらに寒側へ（副次。平均色はずらさない）。
    const songSrc = this.completionPalette ?? this.liveSongPalette;
    const songCoolBias = songSrc ? (clamp01(songSrc.lightness) - 0.45) * 0.5 : 0;
    const snap = this.lastWeatherSnapshot;
    const wxCoolBias = snap
      ? clamp01(clamp01(snap.cloudCover) * 0.4 + clamp01(snap.rainIntensity) * 0.5) * 0.35
      : 0;
    const balanceBias = (pearlColorMix.balance + songCoolBias + wxCoolBias) * enable;
    return { warmHue, coolHue, warmSat, coolSat, balanceBias };
  }

  /**
   * vita 用: コアの頂点カラーに真珠の干渉色（青緑〜藤〜桃）のムラを焼き込む。
   * 単色の初期状態でも生命の質感が出る。マテリアルカラーと乗算される。
   * ※明度を上げすぎると再生中のハイライトと重なってチョーク白に見えるため、上限を抑える。
   *
   * 2026-08-11: 単色化を防ぐため、clayHueBase 一点ではなく暖⇔寒の2極
   * （時刻・天気・曲で位置と配分が動く）を低周波ノイズで空間補間する。
   * SPREAD = 0 なら warm===cool===base に潰れ、従来と同一の出力になる。
   */
  private bakeCorePearlColors(amount: number) {
    const position = this.geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    const { warmHue, coolHue, warmSat, coolSat, balanceBias } = this.resolvePearlColorPoles();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      // vertexPattern は3本のsin波の合成（軽量ノイズ）で、同じ軸の組み合わせを
      // 複数スケールで重ねると周期が揃って規則的な縞（エイリアシング）が見えてしまう
      // （実際に「音と無関係な固定の横縞が5本見える」との指摘で発覚）。
      // オクターブごとに軸を入れ替えて重ねる、通常のfractalノイズの手法で崩す。
      const p1 = growthPattern(nx * 1.3, ny * 1.3, nz * 1.3, this.morphologySeed + 4.2);
      const p2 = growthPattern(ny * 2.7, nz * 2.7, nx * 2.7, this.morphologySeed + 17.8);
      const p3 = growthPattern(nz * 0.85, nx * 1.15, ny * 0.95, this.morphologySeed + 31.4);
      const p4 = growthPattern(nx * 3.6 + ny * 1.1, ny * 3.6 + nz * 1.1, nz * 3.6 + nx * 1.1, this.morphologySeed + 52.6);
      // 無機（寒）ベース ＋ 有機（暖）の染み、に混ぜる。極は resolvePearlColorPoles。
      // 専用の低周波ノイズ pMix で領域を作り、細かいムラ（p1..p4）はその上に重ねる。
      // midpoint を寒寄り(0.64)に置き、無機を主体・有機を少数の染みにする。
      // SPREAD = 0 では warm===cool===base なので、hue は従来式に一致する。
      const pMix = growthPattern(nx * 0.6, nz * 0.6, ny * 0.6, this.morphologySeed + 61.7);
      const mix = clamp01(0.64 + pMix * 0.52 + balanceBias);
      const toneHue = lerpHueShortest(warmHue, coolHue, mix);
      const hue = (toneHue + p1 * 0.12 + p3 * 0.08 + p4 * 0.09 + ny * 0.03 + p2 * 0.03 + 1) % 1;
      // 無機（寒側）ほど淡く、有機（暖側）は色を残す。mix で warmSat↔coolSat を補間。
      const poleSat = warmSat + (coolSat - warmSat) * mix;
      const saturation = clamp01(
        this.claySatBase * poleSat + (Math.abs(p2) * 0.38 + Math.abs(p3) * 0.16) * amount * 0.65,
      );
      const lightness = clamp01(
        Math.min(
          0.62,
          this.clayLightBase + p1 * 0.08 * amount * 0.35 + p2 * 0.03 * amount + p3 * 0.02 * amount,
        ),
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

  private applyMembraneClayPalette(palette: { hue: number; sat: number; light: number }, fullness = 0) {
    const f = clamp01(fullness);
    const satMul = THREE.MathUtils.lerp(0.85, 1.05, f);
    const satCap = THREE.MathUtils.lerp(0.42, 0.92, f);
    const lightMul = THREE.MathUtils.lerp(0.94, 1, f);
    const lightCap = THREE.MathUtils.lerp(0.72, 0.82, f);
    const base = new THREE.Color().setHSL(
      palette.hue,
      Math.min(satCap, palette.sat * satMul),
      Math.min(lightCap, palette.light * lightMul),
    );
    const accent = new THREE.Color().setHSL(
      (palette.hue + 0.08 + 1) % 1,
      Math.min(THREE.MathUtils.lerp(0.48, 0.95, f), palette.sat * THREE.MathUtils.lerp(0.95, 1.1, f)),
      Math.min(THREE.MathUtils.lerp(0.68, 0.78, f), palette.light * THREE.MathUtils.lerp(0.88, 1, f)),
    );
    (this.surfaceMaterial.uniforms.uPaletteColor.value as THREE.Color).copy(base);
    (this.surfaceMaterial.uniforms.uPaletteAccent.value as THREE.Color).copy(accent);
  }

  /**
   * 表示色の目標:
   * lerp(スタイル+クリック+天気, 曲パレット+クリック+天気, songColorBlend)
   * 天気シフトはそれぞれの基準色相から再計算（スタイル青の差分を曲色に足して wrap 赤化するのを防ぐ）
   */
  private resolveEvolvingClayTarget(): {
    hue: number;
    sat: number;
    light: number;
    song?: SculpturePalette;
  } {
    const stylePal = resolveClayPalette(
      clayStyleFromVisualCore(this.style.core),
      combineClayShifts(this.clayColorShift, this.weatherClayShift),
    );
    const songSource = this.completionPalette ?? this.liveSongPalette;
    if (!songSource || this.songColorBlend <= 0.0005) {
      return { hue: stylePal.hue, sat: stylePal.sat, light: stylePal.light };
    }
    // 曲色を基準に天気・時刻を同じ pull 強度で適用
    const songWeather = envClayShiftFromWeatherAndHour(
      this.lastWeatherSnapshot,
      this.lastWeatherHour,
      songSource.hue,
    );
    const songPal = applyEnvShiftToSculpturePalette(
      applyEnvShiftToSculpturePalette(songSource, this.clayColorShift),
      songWeather,
    );
    const b = clamp01(this.songColorBlend);
    return {
      hue: lerpHueShortest(stylePal.hue, songPal.hue, b),
      sat: THREE.MathUtils.lerp(stylePal.sat, songPal.saturation, b),
      light: THREE.MathUtils.lerp(stylePal.light, songPal.lightness, b),
      song: songPal,
    };
  }

  /** 目標色へ滑らかに追従（曲の蓄積・天気・時刻の変化を吸収） */
  private refreshEvolvingClayColors(deltaTime: number, snap = false) {
    if (this.completed) {
      return;
    }
    const target = this.resolveEvolvingClayTarget();
    const follow = snap ? 1 : Math.min(1, deltaTime * 2.1);
    this.clayHueBase = lerpHueShortest(this.clayHueBase, target.hue, follow);
    this.claySatBase += (target.sat - this.claySatBase) * follow;
    this.clayLightBase += (target.light - this.clayLightBase) * follow;

    const st = this.style.core;
    if (st.pearlVariation > 0) {
      this.coreMaterial.color.set(0xffffff);
    } else {
      this.targetCoreColor.setHSL(this.clayHueBase, this.claySatBase, this.clayLightBase);
      this.coreMaterial.color.lerp(this.targetCoreColor, follow);
      this.innerCoreMaterial.color.setHSL(
        this.clayHueBase,
        clamp01(this.claySatBase * 0.96),
        clamp01(this.clayLightBase - 0.06),
      );
    }

    if (this.style.membrane.visible) {
      const fullness = clamp01(this.songColorBlend);
      if (target.song && fullness > 0.55) {
        // 後半は曲パレット色を膜へそのまま寄せる（完成時のジャンプを防ぐ）
        const memBlend = snap ? 1 : Math.min(1, deltaTime * (0.8 + fullness));
        const memBase = this.surfaceMaterial.uniforms.uPaletteColor.value as THREE.Color;
        const memAccent = this.surfaceMaterial.uniforms.uPaletteAccent.value as THREE.Color;
        const muted = {
          hue: this.clayHueBase,
          sat: this.claySatBase,
          light: this.clayLightBase,
        };
        this.applyMembraneClayPalette(muted, fullness);
        if (fullness > 0.75) {
          memBase.lerp(target.song.baseColor, memBlend * (fullness - 0.75) / 0.25);
          memAccent.lerp(target.song.accentColor, memBlend * (fullness - 0.75) / 0.25);
        }
      } else {
        this.applyMembraneClayPalette(
          { hue: this.clayHueBase, sat: this.claySatBase, light: this.clayLightBase },
          fullness,
        );
      }
    }

    this.pearlColorBakeCooldown = Math.max(0, this.pearlColorBakeCooldown - deltaTime);
    let hueDist = Math.abs(this.clayHueBase - this.lastPearlBakeHue);
    if (hueDist > 0.5) hueDist = 1 - hueDist;
    if (
      st.pearlVariation > 0 &&
      (snap || this.pearlColorBakeCooldown <= 0 || hueDist > 0.012 || this.lastPearlBakeHue < 0)
    ) {
      this.bakeCorePearlColors(st.pearlVariation);
      this.lastPearlBakeHue = this.clayHueBase;
      this.pearlColorBakeCooldown = snap ? 0.05 : 0.22;
    } else if (st.pearlVariation <= 0 && (snap || this.pearlColorBakeCooldown <= 0)) {
      this.bakeCoreClayMottle(0.18);
      this.pearlColorBakeCooldown = 0.35;
    }
  }

  /** スタイル基準 + クリック + 天気（＋再生中は曲色ブレンド） */
  private syncClayColors() {
    this.refreshEvolvingClayColors(0, true);
  }

  /**
   * いまの clayHueBase・混色設定で頂点カラーを焼き直す。
   * 通常は形成中の update が周期的に焼き直すが、完成後（焼き直しが止まる）でも
   * dev パネルで混色を変えた結果を即時に見られるように公開している。
   */
  rebakeCoreColors() {
    const pv = this.style.core.pearlVariation;
    if (pv > 0) {
      this.bakeCorePearlColors(pv);
      this.lastPearlBakeHue = this.clayHueBase;
    } else if (this.style.id !== "dither") {
      this.bakeCoreClayMottle(0.18);
    }
  }

  /** 曲パレット + 天気・時刻（曲の色相を基準に同じ pull 強度） */
  private getDisplayCompletionPalette(): SculpturePalette {
    const base = this.completionPalette ?? this.liveSongPalette ?? NEUTRAL_SCULPTURE_PALETTE;
    const songWeather = envClayShiftFromWeatherAndHour(
      this.lastWeatherSnapshot,
      this.lastWeatherHour,
      base.hue,
    );
    return applyEnvShiftToSculpturePalette(
      applyEnvShiftToSculpturePalette(base, this.clayColorShift),
      songWeather,
    );
  }

  /** 完成色（曲 + 環境）を粘土・膜へ反映。完成後の天気更新でも使う */
  private applyCompletionEnvColors() {
    const palette = this.getDisplayCompletionPalette();
    const uniforms = this.surfaceMaterial.uniforms;
    const isVitaPearl =
      this.style.completion.mode === "breathe" && this.style.core.pearlVariation > 0;

    this.clayHueBase = palette.hue;
    this.claySatBase = clamp01(palette.saturation);
    this.clayLightBase = clamp01(palette.lightness);

    if (isVitaPearl) {
      (uniforms.uPaletteColor.value as THREE.Color).copy(palette.baseColor);
      (uniforms.uPaletteAccent.value as THREE.Color).copy(palette.accentColor);
      this.coreMaterial.color.set(0xffffff);
      this.bakeCorePearlColors(this.style.core.pearlVariation);
      this.lastPearlBakeHue = this.clayHueBase;
    } else {
      (uniforms.uPaletteColor.value as THREE.Color).copy(palette.baseColor);
      (uniforms.uPaletteAccent.value as THREE.Color).copy(palette.accentColor);
      this.coreMaterial.color.copy(palette.baseColor);
      this.targetCoreColor.copy(palette.baseColor);
      this.innerCoreMaterial.color.copy(palette.baseColor).multiplyScalar(0.88);
    }
  }

  /**
   * 再生中: 蓄積プロファイルから曲色を更新し、スタイル色から徐々に寄せる。
   * 天気・時刻は weatherClayShift 経由で毎フレーム加味される。
   */
  evolveSongColors(
    profile: import("./audio-palette").AudioProfileSummary | null,
    deltaTime: number,
  ) {
    if (this.completed) {
      return;
    }
    const hasSignal = profile !== null && profile.activeDuration > 0.5;
    if (hasSignal) {
      this.liveSongPalette = deriveSculpturePalette(profile);
      // 序盤は控えめ、おおよそ 3 分かけて完成色へ（完成瞬間の急変を避ける）
      const active = profile.activeDuration;
      const targetBlend = clamp01(
        smoothstep(6, 40, active) * 0.35 + smoothstep(40, 180, active) * 0.65,
      );
      this.songColorBlend += (targetBlend - this.songColorBlend) * Math.min(1, deltaTime * 0.42);
    } else {
      this.songColorBlend += (0 - this.songColorBlend) * Math.min(1, deltaTime * 0.35);
    }
    this.refreshEvolvingClayColors(deltaTime);
  }

  nudgeClayColorOnClick() {
    this.clayColorShift = nudgeClayColorShift(this.clayColorShift);
    this.syncClayColors();
  }

  /** 天気・時刻に合わせて粘土質（内側含む）の色を更新 */
  applyWeatherClayTint(
    snapshot: import("./live-weather").LiveWeatherSnapshot | null,
    hour = 12,
  ) {
    this.lastWeatherSnapshot = snapshot;
    this.lastWeatherHour = hour;
    const next = envClayShiftFromWeatherAndHour(snapshot, hour, this.style.core.hueBase);
    // 時刻は連続変化させる（分キーだけで間引かない）
    const fineKey = Math.round((((hour % 24) + 24) % 24) * 240); // 15秒粒度
    const key = snapshot
      ? `${snapshot.condition}:${snapshot.cloudCover.toFixed(2)}:${snapshot.rainIntensity.toFixed(2)}:${snapshot.lightningIntensity.toFixed(2)}:${fineKey}`
      : `none:${fineKey}`;
    const shiftDelta =
      Math.abs(next.hue - this.weatherClayShift.hue) +
      Math.abs(next.sat - this.weatherClayShift.sat) +
      Math.abs(next.light - this.weatherClayShift.light);
    this.weatherClayShift = next;
    if (key === this.lastWeatherClayKey && shiftDelta < 0.0006) {
      return;
    }
    this.lastWeatherClayKey = key;
    if (this.completed && this.completionPalette) {
      this.applyCompletionEnvColors();
      return;
    }
    // 目標だけ更新。見た目の追従は evolveSongColors / refresh 側
    this.refreshEvolvingClayColors(0.05);
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
    this.initCrystalFacets();
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

  /** 勝者を強く残す（1.32 では差が薄い） */
  private static readonly MORPH_WINNER_POW = 2.05;

  private emphasizeMorphWeights(weights: MorphWeights): MorphWeights {
    const pow = SoundSculpture.MORPH_WINNER_POW;
    const next: MorphWeights = {
      diabolo: Math.pow(Math.max(1e-6, weights.diabolo), pow),
      torus: Math.pow(Math.max(1e-6, weights.torus), pow),
      monolith: Math.pow(Math.max(1e-6, weights.monolith), pow),
      coral: Math.pow(Math.max(1e-6, weights.coral), pow),
      spindle: Math.pow(Math.max(1e-6, weights.spindle), pow),
    };
    const sum = next.diabolo + next.torus + next.monolith + next.coral + next.spindle;
    const inv = 1 / Math.max(0.0001, sum);
    next.diabolo *= inv;
    next.torus *= inv;
    next.monolith *= inv;
    next.coral *= inv;
    next.spindle *= inv;
    return next;
  }

  /** 完成時: 種＋algo から強調したモルフ目標を作る */
  private buildFinalizedMorphWeights(species: SpeciesProfile): MorphWeights {
    const target = speciesMorphTargets(species);
    const algoBias = getGrowthAlgoSilhouetteBias();
    return this.emphasizeMorphWeights({
      diabolo: target.diabolo * algoBias.diabolo,
      torus: target.torus * algoBias.torus,
      monolith: target.monolith * algoBias.monolith,
      coral: target.coral * algoBias.coral,
      spindle: target.spindle * algoBias.spindle,
    });
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

  /**
   * セクション相対エネルギーに応じた永久蓄積倍率。
   * 静かな区間は控えめ、盛り上がり／サージで深く刻み、完成シルエットに静動差を残す。
   */
  private getSectionAccumMul() {
    const lift = this.currentStructure.sectionLift;
    const surge = this.sectionSurgeBoost;
    // quiet ≈ 0.18–0.35 / loud ≈ 1.4–2.5（旧 0.46+ だと静区間も同程度に膨らんで差が薄れる）
    return 0.18 + lift * 1.55 + surge * 0.85;
  }

  /**
   * 表面テクスチャ（mid bumps / high spikes）用のセクション倍率。
   * 静は滑らか、動はざらつき・棘を強く残す。
   */
  private getSectionTextureMul() {
    const lift = this.currentStructure.sectionLift;
    const surge = this.sectionSurgeBoost;
    return 0.12 + lift * 1.85 + surge * 1.1;
  }

  /**
   * 描画だけのライブ振幅スケール（永久層への bleed には掛けない）。
   * 平常時も少し残し、イベントで開く（少し前の LIVE 感に戻す）。
   */
  private getLiveDrawScale(bands: AudioBands) {
    const listen = this.getQuietLivePresence(bands);
    return 0.27 + listen * 0.5;
  }

  /**
   * LIVE リズム・ジェスチャー駆動（聴感トレンド）。
   * - thump: ばっ／ばーん（キック・バス・拍）
   * - ting: ちん！（スネア等の鋭い打点）
   * - chatter: ジャカジャカ（チョップ・チャグ・句頭）
   * - sparkle: ハット等の装飾
   */
  private getListeningEventDrive(bands: AudioBands) {
    const busy = this.mixBusy;
    const listen = this.getQuietLivePresence(bands);
    const bob = this.getGrooveBob() * (0.7 + listen * 0.3);
    const thump = clamp01(
      this.kickImpulse * 1.15 +
        this.peakPunch * 0.55 +
        bob * 0.5 +
        (this.currentStructure.events.energySurge ? 0.22 : 0),
    );
    const ting = clamp01(this.snareImpulse * 1.05 + this.snareFlash * 0.75);
    const chatter = clamp01(
      this.guitarFlash * 1.15 +
        this.guitarImpulse * 0.25 +
        this.melodyPhraseImpulse * 0.45,
    );
    const sparkle = clamp01(
      (this.hatImpulse * 0.85 + this.hatFlash * 1.15 + this.waveImpulse * 0.35) *
        (1 - busy * 0.2) *
        (this.primaryHitLock > 0 ? 0.7 : 1),
    );
    return {
      thump,
      ting,
      chatter,
      body: thump,
      crack: ting,
      phrase: chatter,
      sparkle,
      listen,
      busy,
    };
  }

  /**
   * 人が聴いて「今反応する」瞬間の存在感。
   * 蓄積パスには掛けない。
   */
  private getQuietLivePresence(bands: AudioBands) {
    const r = latestRhythm;
    const busy = this.mixBusy;
    const events = clamp01(
      this.kickImpulse * 1.15 +
        this.snareImpulse * 0.95 +
        this.peakPunch * 0.55 +
        this.guitarImpulse * (0.55 - busy * 0.2) +
        this.guitarFlash * (0.7 - busy * 0.22) +
        this.melodyPhraseImpulse * (0.9 - busy * 0.25) +
        this.hatFlash * 0.16 +
        this.waveImpulse * 0.4 +
        this.sectionSurgeBoost * 0.4 +
        (this.currentStructure.events.energySurge ? 0.35 : 0),
    );
    const bob =
      this.getGrooveBob() *
      smoothstep(0.45, 0.8, r.pulseConfidence) *
      (0.35 + r.pulseEnvelope * 0.65) *
      (1 - busy * 0.3);
    const melodic = clamp01(
      this.melodyPhraseImpulse * 0.85 +
        this.guitarFlash * (0.55 - busy * 0.2) +
        this.guitarImpulse * (0.35 - busy * 0.15) +
        bands.melodyFocus * r.melodyOnset * (1.2 - busy * 0.4),
    );
    return clamp01(events * 0.78 + bob * 0.35 + melodic * 0.55);
  }

  /** Fly Away / Fury / 修羅場など音数が多いときの埋もれ度 0〜1 */
  private refreshMixBusy(deltaTime: number) {
    const s = this.currentStructure;
    // 曲全体の静的な性格（種のaggressive/organic）を混ぜていたため、メタルのような
    // ジャンルは曲全体を通してbusyが張り付き、原則が意図した「一瞬の密集を抑える」
    // ではなく「音数の多い曲を丸ごと弱く見せる」になっていた（実測: Fury Of The Storm
    // でbusy平均0.835、9割超が全体の46%）。瞬間的な密度（density/tension）だけで判定する
    const target = clamp01(s.density * 0.55 + s.tension * 0.15 + this.mixBusy * 0.08);
    this.mixBusy += (target - this.mixBusy) * Math.min(1, deltaTime * 1.8);
    this.mixBusy *= Math.exp(-deltaTime * 0.55);
  }

  private noteVisualEvent(weight = 1) {
    this.mixBusy = Math.min(1, this.mixBusy + 0.14 * weight);
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
    // 音色軸で結晶⇔触手の選好を桁で振る（axis 1 → crystal/erosion 主体, 0 → tentacle/lobe 主体）。
    const axis = this.getMineralAxis();
    const axisLead = (axis - 0.5) * 0.6;
    const crystalLead = sp.crystalGain - sp.tentacleGain + axisLead;
    const tentacleLead = sp.tentacleGain - sp.crystalGain - axisLead;
    const aggressiveBias = sp.aggressive - sp.organic;
    if (s.events.energyDrop || (s.energyLong < 0.1 && (s.mineralScore > 0.34 || axis > 0.6))) {
      return "erosion";
    }
    if (
      // transientBurst は四つ打ちのキックでも鳴るので、鉱物寄りの曲だけ結晶化させる
      // （axis で門番。修羅場＝低 axis はここで結晶が出ない → Fury と別物になる）。
      (s.events.transientBurst && axis > 0.35) ||
      crystalLead > 0.12 ||
      (aggressiveBias > 0.08 && s.mineralScore > s.organicScore * 0.9)
    ) {
      return "crystal";
    }
    if (tentacleLead > 0.08 || (sp.organic > 0.36 && s.organicScore > s.mineralScore * 0.92)) {
      return "tentacle";
    }
    if (s.events.energySurge && crystalLead > -0.04) {
      return sp.crystalGain > sp.tentacleGain ? "crystal" : "tentacle";
    }
    if (s.events.pulseStable && sp.rhythmic > 0.28 && axis < 0.55) {
      return "lobe";
    }
    if (sp.aggressive > 0.38 && axis > 0.45) {
      return "crystal";
    }
    if (sp.organic > 0.34 || axis < 0.3) {
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
    const hardBias = clamp01(0.5 + (mineral - organic) * 0.7);
    const softBias = 1 - hardBias;
    const overallBlend = bands.overall;
    const bandWeights: MorphWeights = {
      diabolo:
        fibUnit(3, 21) +
        overallBlend * fibUnit(5, 21) +
        softBias * fibUnit(8, 21) +
        bands.bassFocus * softBias * fibUnit(8, 21),
      torus:
        fibUnit(2, 21) +
        overallBlend * fibUnit(3, 21) +
        rhythmic * fibUnit(13, 21) +
        latestRhythm.pulseConfidence * fibUnit(5, 21),
      monolith:
        fibUnit(3, 21) +
        overallBlend * fibUnit(8, 21) +
        hardBias * fibUnit(8, 21) +
        bands.bassFocus * hardBias * fibUnit(8, 21) * (1 - bands.brightness),
      coral:
        fibUnit(1, 34) +
        organic * fibUnit(13, 21) +
        softBias * fibUnit(5, 21) +
        bands.melodyFocus * fibUnit(8, 21) +
        bands.contrast * fibUnit(3, 21),
      spindle:
        fibUnit(1, 34) +
        bands.brightness * fibUnit(13, 21) +
        hardBias * fibUnit(5, 21) +
        s.tension * fibUnit(8, 21) +
        latestRhythm.transient * fibUnit(3, 21),
    };

    const speciesTarget = speciesMorphTargets(sp);
    // ライブ帯域ブレンドを弱め、種のシルエット差を完成形に残す
    const bandBlend = fibUnit(1, 13);
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

    // soft は coral/diabolo、hard は monolith/spindle、pulse は torus へ分岐（共有ルール）
    const mineralLead = clamp01(s.mineralScore - s.organicScore + 0.5);
    const softRatio = organic / Math.max(0.001, organic + mineral);
    const softLead = Math.max(0, softRatio - 0.38);
    const hardLead = Math.max(0, 0.5 - softRatio);
    const liveHard = clamp01(
      hardLead * 0.55 +
        mineralLead * 0.16 +
        bands.brightness * 0.24 +
        bands.bassFocus * hardBias * 0.08 +
        s.tension * 0.12 +
        latestRhythm.transient * 0.08 -
        softLead * 0.55 -
        bands.melodyFocus * 0.3 -
        softBias * 0.12,
    );
    const liveSoft = 1 - liveHard;
    const coralCue = clamp01(
      organic * 0.48 + bands.melodyFocus * 0.32 + bands.contrast * 0.22 + softLead * 0.35,
    );
    const brightGate = smoothstep(0.1, 0.22, bands.brightness);
    const tipGateLive = clamp01(
      brightGate * 0.45 + latestRhythm.transient * 0.4 + s.tension * 0.2,
    );
    const spindleCue = clamp01(tipGateLive * liveHard);
    const massCue = clamp01(
      liveHard * 0.55 +
        bands.bassFocus * hardBias * 0.5 * (1 - tipGateLive * 0.65) +
        (1 - brightGate) * 0.2,
    );
    const torusCue = clamp01(
      rhythmic * 0.58 +
        latestRhythm.pulseConfidence * 0.35 -
        Math.max(massCue, spindleCue) * 0.3,
    );
    const diaboloCue = clamp01(
      liveSoft * 0.4 + bands.bassFocus * softBias * 0.35 + (1 - coralCue) * softBias * 0.35,
    );

    // 種が確定するほどライブ帯域補正を弱め、完成シルエットを種に寄せる
    const liveMorph = 1 - speciesConfidence * 0.7;
    targetWeights.monolith *= 1 + (0.55 + liveHard * 0.75 + massCue * 1.15 - 1) * liveMorph;
    targetWeights.spindle *= 1 + (0.34 + liveHard * 0.38 + spindleCue * 2.0 - 1) * liveMorph;
    targetWeights.diabolo *= 1 + (0.42 + liveSoft * 0.55 + diaboloCue * 0.75 - 1) * liveMorph;
    targetWeights.coral *= 1 + (0.42 + liveSoft * 0.65 + coralCue * 1.25 - 1) * liveMorph;
    targetWeights.torus *= 1 + (0.38 + torusCue * 1.35 + rhythmic * 0.32 - 1) * liveMorph;

    // アルゴリズム差を大域シルエットにも残す
    const algoBias = getGrowthAlgoSilhouetteBias();
    targetWeights.diabolo *= algoBias.diabolo;
    targetWeights.torus *= algoBias.torus;
    targetWeights.monolith *= algoBias.monolith;
    targetWeights.coral *= algoBias.coral;
    targetWeights.spindle *= algoBias.spindle;
    const emphasized = this.emphasizeMorphWeights(targetWeights);
    this.lerpMorphWeights(emphasized, lerp);
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
    // 熟成度は**どの状態でも**進める（形の凍結中・完成後も含む）。[P1]
    this.updateMaturity(deltaTime);
    this.liveAfterlife = deriveAfterlifeMaterial(
      this.completionPalette ?? this.liveSongPalette ?? NEUTRAL_SCULPTURE_PALETTE,
      species,
    );
    this.updateLiveBreath(deltaTime);

    // 曲終了直後〜完成まで: 形を凍結したまま描画だけ更新
    if (this.shapeHold && !this.completed) {
      this.refreshEvolvingClayColors(deltaTime);
      this.updateCoreGeometry(bands, deltaTime);
      if (this.surface.visible) {
        this.updateSurfaceGeometry(bands, deltaTime);
      }
      this.syncDisplayGeometry(this.surface.visible);
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
        this.soundExposure += bands.overall * deltaTime;
      }

      if (this.currentStructure.events.energySurge) {
        this.sectionSurgeBoost = Math.min(1, this.sectionSurgeBoost + 0.85);
      }
      if (this.currentStructure.events.energyDrop) {
        this.sectionSurgeBoost *= 0.35;
      }
      this.sectionSurgeBoost *= Math.exp(-1.6 * deltaTime);

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

    // ヒットを先に反映（kick/snare の食い込み・衝動が同フレームの幾何に乗る）
    if (!this.completed) {
      this.applyRhythmImpulses(deltaTime, bands);
    }

    this.updateCoreGeometry(bands, deltaTime);
    if (this.surface.visible) {
      this.updateSurfaceGeometry(bands, deltaTime);
    }
    this.syncDisplayGeometry(this.surface.visible);
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
      // 周囲の粒はワールド固定（回転・スクイーズに追従させない）
      this.syncAmbientFxWorldLock();
    }

    const innerBase = this.style.membrane.vita ? 0.9 : 1;
    if (!this.completed) {
      // 大きな芯の膨らみはビートうなずき + キック／スネア
      const groove = this.getGrooveBob();
      const quietLive = this.getQuietLivePresence(bands);
      const kickPulse =
        1 +
        (groove * 0.34 + this.kickImpulse * 0.36 + this.peakPunch * 0.17 + this.snareImpulse * 0.08) *
          fibUnit(8, 13) *
          runtimeTuning.liveLow *
          SoundSculpture.LIVE_MOTION *
          (0.22 + quietLive * 0.62);
      this.innerCore.scale.setScalar(innerBase * kickPulse);
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
    // クリックのたびに粘土色をランダムに少しずらす（天気・時刻シフトと合成）
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

    // 待機のゆらぎ（**打点の反応ではない**常時の揺れ）は熟成度で落ち着かせる（[P1]）。
    // スケールが baseScale へ寄り、完成時の「ふっと静まる」段差が小さくなる。
    // クリックの poke は触らない（触ったときの反応は最後まで同じ）。
    const settle = 1 - this.getMaturity() * 0.5;
    const targetAmp = this.completed
      ? gain * (pokeBoost + this.completionSettle * 0.045)
      : gain *
        (0.072 * settle + pokeBoost) *
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

  /**
   * 人がのれるビート表現:
   * - 土台 = BPMパルスのうなずき（で、で、で…）
   * - アクセント = キック縦／スネア横
   * 帯域の常時ゆらぎやハットで起点を濁さない。
   */
  private refreshGrooveDrive() {
    const r = latestRhythm;
    const grooveBob = this.getGrooveBob();
    this.drumLiveGate = clamp01(
      r.pulseConfidence * 0.45 +
        grooveBob * 0.55 +
        this.kickImpulse * 0.65 +
        this.snareImpulse * 0.45 +
        this.peakPunch * 0.35 +
        this.melodyPhraseImpulse * 0.4 +
        this.guitarFlash * 0.3 +
        r.pulseEnvelope * 0.18,
    );
  }

  /** パルス位相から「うなずき」量。phase=0 が拍、その後回復 → で、で、で */
  private getGrooveBob() {
    const r = latestRhythm;
    if (r.pulseConfidence < 0.08) {
      return 0;
    }
    // 短いアタックで頭を振る感覚。回復は早めに戻して次の拍を待つ
    const recover = 0.34;
    const bob = Math.pow(Math.max(0, 1 - r.pulsePhase / recover), 1.7);
    const steady = smoothstep(0.28, 0.7, r.pulseConfidence);
    const env = 0.45 + r.pulseEnvelope * 0.55;
    return clamp01(bob * (0.42 + r.pulseConfidence * 0.58) * env * (0.85 + steady * 0.45));
  }

  /** LIVE 全体の動きゲイン（強弱の天井） */
  private static readonly LIVE_MOTION = 0.68;

  /** ビート／ギター／ハイがいるほど LIVE を開く（持続 overall ではなく出来事） */
  private getDrumLiveMul(floor = 0.08) {
    const events = clamp01(
      this.kickImpulse * 0.7 +
        this.snareImpulse * 0.55 +
        this.peakPunch * 0.4 +
        this.guitarFlash * 0.55 +
        this.melodyPhraseImpulse * 0.65 +
        this.hatFlash * 0.18 +
        this.waveImpulse * 0.25 +
        this.getGrooveBob() * 0.35,
    );
    return floor + clamp01(events * 0.85 + this.drumLiveGate * 0.2) * (1 - floor);
  }

  /** ヒット強度 0–1 → 弱い音は小さく、強い音は残す */
  private hitDynamics(strength: number, downbeat = false, busy = 0) {
    const s = clamp01(strength);
    const shaped = Math.pow(s, 1.2 + busy * 0.35);
    return clamp01(shaped * (downbeat ? 1.15 : 1) * 0.55 + shaped * 0.45);
  }

  private applyRhythmImpulses(deltaTime: number, bands: AudioBands) {
    const r = latestRhythm;
    const s = this.currentStructure;
    this.refreshMixBusy(deltaTime);
    const busy = this.mixBusy;
    // busyによる減衰の加速は「音数が多い曲を丸ごと弱く見せる」原因になっていたため
    // 大幅に緩めた（実測: Fury Of The Storm でbusy平均0.835。以前の係数のままだと
    // ほぼ曲全体で最大の抑制がかかり続けていた）。busyは短い密集の瞬間だけ軽く
    // 均す程度にとどめ、音数の多さ自体は素直に視覚の活発さへ出す。
    const M = SoundSculpture.LIVE_MOTION * (1 - busy * 0.05);
    const kickDecay = (5.2 + (1 - clamp01(r.kickLength / 0.35)) * 6.8) * (1 + busy * 0.12);
    const snareDecay = (4.4 + (1 - clamp01(r.snareLength / 0.22)) * 6.2) * (1 + busy * 0.12);
    const hatDecay = (8.0 + (1 - clamp01(r.hatLength / 0.28)) * 9.0) * (1 + busy * 0.1);
    this.kickImpulse *= Math.exp(-kickDecay * deltaTime);
    this.snareImpulse *= Math.exp(-snareDecay * deltaTime);
    this.hatImpulse *= Math.exp(-hatDecay * deltaTime);
    this.waveImpulse *= Math.exp(-(8.5 + busy * 0.8) * deltaTime);
    this.peakPunch *= Math.exp(-(12 + busy * 1) * deltaTime);
    this.snareFlash *= Math.exp(-(9.2 + busy * 0.8) * deltaTime);
    this.hatFlash *= Math.exp(-(10 + busy * 0.7) * deltaTime);
    this.guitarImpulse *= Math.exp(-(3.8 + busy * 1) * deltaTime);
    // カッティングは一瞬のフラッシュ。余韻のうねりにしない
    this.guitarFlash *= Math.exp(-(9.5 + busy * 0.9) * deltaTime);
    this.melodyPhraseImpulse *= Math.exp(-(5.5 + busy * 0.7) * deltaTime);
    this.primaryHitLock = Math.max(0, this.primaryHitLock - deltaTime);
    // ring はヒットの余韻だけ。busy でも大きく削らない（音数の多さ＝存在感の低下にしない）
    const ringFloor = (latestRhythm.pulseConfidence > 0.4 ? 0.012 : 0.028) * (1 - busy * 0.25);
    this.kickImpulse = Math.max(this.kickImpulse, r.kickRing * ringFloor);
    this.snareImpulse = Math.max(this.snareImpulse, r.snareRing * 0.018 * (1 - busy * 0.2));
    this.snareFlash = Math.max(this.snareFlash, r.snareRing * 0.016 * (1 - busy * 0.2));
    this.hatImpulse = Math.max(this.hatImpulse, r.hatRing * 0.04 * (1 - busy * 0.25));
    this.hatFlash = Math.max(this.hatFlash, r.hatRing * 0.05 * (1 - busy * 0.25));

    // --- 帯域ごとの目立ち度トップアップ: kick/snare/hat/chop に分類されない音
    // （ピアノの単音、シンバルの持続的なシマーなど）にも、その帯域なりの
    // 控えめな反応を足す。既存の楽器別イベントより弱く、上書きはしない（Math.max）。
    // 音数の多い曲ほどこの底上げが効いてほしいので、busyでの減衰はごく弱くする
    this.kickImpulse = Math.max(this.kickImpulse, r.salienceLow * 0.32 * (1 - busy * 0.2));
    this.peakPunch = Math.max(this.peakPunch, r.salienceLow * 0.16 * (1 - busy * 0.2));
    this.guitarFlash = Math.max(this.guitarFlash, r.salienceMid * 0.34 * (1 - busy * 0.15));
    this.hatFlash = Math.max(this.hatFlash, r.salienceHigh * 0.3 * (1 - busy * 0.2));
    this.lastSalienceHighSpark += deltaTime;
    if (r.salienceHigh > 0.4 && this.lastSalienceHighSpark > 0.09) {
      this.lastSalienceHighSpark = 0;
      this.spawnSparkle(
        {
          ...bands,
          high: Math.min(1, bands.high + 0.3),
          brightness: Math.min(1, bands.brightness + 0.25),
        },
        0.35 + r.salienceHigh * 0.35,
      );
    }

    // 主役ヒット直後の副次イベント抑制／弱いイベントの足切りも、busyでの上乗せを
    // 大幅に縮小（音数の多さがそのまま「反応が乏しい」に直結していたため）
    const secondaryMul = this.primaryHitLock > 0 ? 0.45 + (1 - busy) * 0.25 : 1;
    const weakFloor = 0.07 + busy * 0.08;

    // --- メロディ句頭: 人がフレーズの立ち上がりで感じる反応 ---
    if (
      r.melodyOnset > 0.035 + busy * 0.04 &&
      (bands.melodyFocus > 0.12 + busy * 0.1 || bands.melody > 0.08 + busy * 0.06)
    ) {
      const phrase = this.hitDynamics(r.melodyOnset * (0.7 + bands.melodyFocus * 0.8), false, busy);
      if (phrase > weakFloor * 0.7) {
        this.melodyPhraseImpulse = Math.min(
          1,
          this.melodyPhraseImpulse + phrase * 2.8 * M * (1 - busy * 0.45) * secondaryMul,
        );
        this.guitarFlash = Math.min(
          1,
          this.guitarFlash + phrase * 0.55 * M * (1 - busy * 0.4) * secondaryMul,
        );
        this.guitarImpulse = Math.min(
          1,
          this.guitarImpulse + phrase * 1.4 * M * (1 - busy * 0.5) * secondaryMul,
        );
        this.noteVisualEvent(0.45);
      }
    }

    // --- kick: 強弱つきの「で」---
    if (r.kickIndex !== this.lastKickIndexApplied) {
      this.lastKickIndexApplied = r.kickIndex;
      if (r.kick > 0) {
        const dyn = this.hitDynamics(r.kick, r.downbeat, busy);
        const lengthBoost = 0.7 + clamp01(r.kickLength / 0.28) * 0.7;
        // busy でもキックは立てる
        const kickGain = 4.2 + busy * 0.7;
        this.kickImpulse = Math.min(1, this.kickImpulse + dyn * kickGain * lengthBoost * M);
        this.peakPunch = Math.min(0.75, this.peakPunch + dyn * (0.28 + (r.downbeat ? 0.18 : 0)));
        this.injectMusicPierce(dyn * (0.72 + (r.downbeat ? 0.28 : 0)) * M, "kick");
        this.primaryHitLock = Math.max(this.primaryHitLock, 0.09 + busy * 0.05);
        this.noteVisualEvent(1.1);
        if (s.phase !== "embryo" && dyn > 0.35) {
          this.trySpawnStructureAnchor("lobe", bands, 0.7);
        }
      }
    }

    // --- snare: 横へパシッ（クラック）---
    if (r.snareIndex !== this.lastSnareIndexApplied) {
      this.lastSnareIndexApplied = r.snareIndex;
      if (r.snare > 0) {
        const dyn = this.hitDynamics(r.snare, false, busy);
        const lengthBoost = 0.7 + clamp01(r.snareLength / 0.16) * 0.55;
        const snareGain = (4.0 + busy * 0.55) * (this.primaryHitLock > 0.05 ? 0.78 : 1);
        this.snareImpulse = Math.min(1, this.snareImpulse + dyn * snareGain * lengthBoost * M);
        this.snareFlash = Math.min(1, this.snareFlash + dyn * (0.9 + busy * 0.12));
        this.peakPunch = Math.min(0.65, this.peakPunch + dyn * 0.16);
        this.fragmentSpawnCooldown = 0;
        this.separationTendency = Math.min(1, this.separationTendency + dyn * 0.42 * (1 - busy * 0.3));
        this.injectMusicPierce(dyn * 0.85 * M, "snare");
        this.primaryHitLock = Math.max(this.primaryHitLock, 0.07 + busy * 0.05);
        this.noteVisualEvent(1);
        const origin = new THREE.Vector3(
          (Math.random() - 0.5) * 0.9,
          (Math.random() - 0.5) * 0.55,
          (Math.random() - 0.5) * 0.9,
        );
        const dir = origin.clone().normalize();
        if (dir.lengthSq() < 1e-6) dir.set(1, 0.2, 0).normalize();
        this.emitDetachmentDust("metal", origin, dir, 0.35 + dyn * 0.75);
        if (s.phase !== "embryo" && dyn > 0.35) {
          this.trySpawnStructureAnchor(this.pickAnchorKindFromStructure(bands), bands, 0.75);
        }
      }
    }

    // --- hat: チッチ＝粒子本線。膜は補助グローのみ ---
    if (r.hatIndex !== this.lastHatIndexApplied) {
      this.lastHatIndexApplied = r.hatIndex;
      if (r.hat > 0) {
        const dyn = this.hitDynamics(r.hat, false, busy);
        if (dyn > weakFloor * 0.35) {
          const lengthBoost = 0.75 + clamp01(r.hatLength / 0.22) * 0.8;
          const hatMul = (1 - busy * 0.22) * Math.max(0.62, secondaryMul);
          this.hatImpulse = Math.min(1, this.hatImpulse + dyn * 4.8 * lengthBoost * M * hatMul);
          this.hatFlash = Math.min(1, this.hatFlash + dyn * 1.35 * hatMul);
          const burst = Math.min(
            Math.max(5, 16 - Math.floor(busy * 2)),
            5 +
              Math.floor(
                r.hat * 13 * (0.75 + clamp01(r.hatLength / 0.2)) * (0.6 + s.detailRamp * 0.4) * hatMul,
              ),
          );
          for (let i = 0; i < burst; i += 1) {
            this.spawnSparkle(
              {
                ...bands,
                high: Math.min(1, bands.high + 0.55),
                brightness: Math.min(1, bands.brightness + 0.5),
              },
              0.7 + dyn * 0.95,
            );
          }
          this.noteVisualEvent(0.28);
        }
      }
    }

    // --- cymbal: 一閃。粒子はハットより少なめ ---
    if (r.transientIndex !== this.lastTransientIndexApplied) {
      this.lastTransientIndexApplied = r.transientIndex;
      if (r.transient > 0) {
        const dyn = this.hitDynamics(r.transient, false, busy);
        if (dyn > weakFloor * 0.5) {
          this.waveImpulse = Math.min(1, this.waveImpulse + dyn * 0.85 * M * secondaryMul);
          this.hatFlash = Math.min(1, this.hatFlash + dyn * 0.2 * secondaryMul);
          const burst = Math.min(Math.max(1, 4 - Math.floor(busy * 2)), 1 + Math.floor(dyn * 4 * secondaryMul));
          for (let i = 0; i < burst; i += 1) {
            this.spawnSparkle(
              {
                ...bands,
                high: Math.min(1, bands.high + 0.4),
                brightness: Math.min(1, bands.brightness + 0.35),
              },
              0.45 + dyn * 0.5,
            );
          }
          this.noteVisualEvent(0.45);
          if (s.mineralScore > fibUnit(8, 21) && dyn > 0.55) {
            this.trySpawnStructureAnchor("crystal", bands, fibUnit(5, 13));
          }
        }
      }
    }

    // --- chop: 中音＝膜フラッシュ＋横パルス。粒子には載せない（高音チャンネルと分離）---
    if (r.chopIndex !== this.lastChopIndexApplied) {
      this.lastChopIndexApplied = r.chopIndex;
      if (r.chop > 0) {
        const dyn = this.hitDynamics(r.chop, false, busy);
        if (dyn > weakFloor * 0.75 && secondaryMul > 0.32) {
          const chopMul = (1 - busy * 0.4) * secondaryMul;
          this.guitarImpulse = Math.min(1, this.guitarImpulse + dyn * 0.85 * M * chopMul);
          this.guitarFlash = Math.min(1, this.guitarFlash + dyn * 1.85 * chopMul);
          this.peakPunch = Math.min(0.5, this.peakPunch + dyn * 0.1 * chopMul);
          this.noteVisualEvent(0.32);
        }
      }
    }

    // --- salience: 分類外でも強く鳴った瞬間。busy では厳選 ---
    if (r.salienceIndex !== this.lastSalienceIndexApplied) {
      this.lastSalienceIndexApplied = r.salienceIndex;
      if (r.salience > 0) {
        const dyn = this.hitDynamics(r.salience, false, busy);
        if (dyn > weakFloor + busy * 0.12 && secondaryMul > 0.35) {
          const salMul = (1 - busy * 0.5) * secondaryMul;
          this.waveImpulse = Math.min(1, this.waveImpulse + dyn * 0.95 * M * salMul);
          this.peakPunch = Math.min(0.7, this.peakPunch + dyn * 0.28 * M * salMul);
          if (bands.mid >= bands.high) {
            this.snareFlash = Math.min(1, this.snareFlash + dyn * 0.45 * M * salMul);
            this.injectMusicPierce(dyn * 0.4 * M * salMul, "snare");
          } else {
            this.hatFlash = Math.min(1, this.hatFlash + dyn * 0.55 * M * salMul);
            const burst = Math.min(Math.max(1, 4 - Math.floor(busy * 2)), 1 + Math.floor(dyn * 3.5 * salMul));
            for (let i = 0; i < burst; i += 1) {
              this.spawnSparkle({
                ...bands,
                high: Math.min(1, bands.high + 0.35),
                brightness: Math.min(1, bands.brightness + 0.28),
              });
            }
          }
          this.noteVisualEvent(0.55);
        }
      }
    }

    // --- guitar: 持続チャグはフラッシュ連打に寄せ、うねり用 impulse は抑える ---
    if (bandSoloAllows("mid") || bandSoloAllows("high")) {
      const midLead = Math.max(bands.mid * 0.85, bands.melody * 1.45);
      const melodicRock = clamp01(
        (bands.melody * 0.65 + bands.mid * 0.35 + bands.melodyFocus * 0.55) *
          (0.4 + r.pulseConfidence * 0.55),
      );
      const chugBed = clamp01(
        Math.max(bands.mid * 0.85, bands.melody * 1.2) * 0.95 - bands.bassFocus * 0.08,
      );
      const soloBias = clamp01(
        midLead * 1.1 +
          bands.melodyFocus * 1.0 +
          melodicRock * 0.55 +
          chugBed * 0.55 +
          this.guitarFlash * 0.4 -
          bands.bassFocus * 0.2 -
          this.kickImpulse * 0.25 -
          r.kickRing * 0.14,
      );
      const eventGate = clamp01(
        r.melodyOnset * 2.4 +
          this.melodyPhraseImpulse * 1.35 +
          this.guitarFlash * 0.75 +
          chugBed * (0.45 - busy * 0.2) +
          melodicRock * (0.35 - busy * 0.15),
      );
      const guitarBody = clamp01(
        midLead *
          (0.1 + bands.melodyFocus * 0.35 + soloBias * 0.35 + eventGate * 0.7) *
          (0.15 + eventGate) *
          (1 - busy * 0.45),
      );
      const kickMute =
        1 -
        clamp01(this.kickImpulse * 0.4 + this.snareImpulse * 0.18 + r.kickRing * 0.14) * 0.75;
      const soloGain =
        (0.32 +
          soloBias * 0.85 * eventGate +
          melodicRock * 0.25 +
          chugBed * 0.3 +
          r.melodyOnset * 1.4 +
          this.melodyPhraseImpulse * 0.55) *
        (1 - busy * 0.3);
      // うねり源の impulse は薄く。見た目は Flash（横パルス・膜ライン・粒子）
      this.guitarImpulse = Math.max(
        this.guitarImpulse,
        guitarBody * kickMute * soloGain * 0.35 * secondaryMul,
      );
      if (eventGate > 0.12 && guitarBody > 0.05) {
        this.guitarFlash = Math.min(
          1,
          this.guitarFlash +
            guitarBody * (0.38 + soloBias * 0.4 + eventGate * 0.45) * (1 - busy * 0.22) * secondaryMul,
        );
      }
      if (r.snare > 0.08 && (bands.melodyFocus > 0.22 || melodicRock > 0.5 || chugBed > 0.5)) {
        this.guitarFlash = Math.min(1, this.guitarFlash + r.snare * 0.08 * (1 - busy * 0.35));
      }
    }

    if (r.pulseIndex !== this.lastPulseIndexApplied) {
      this.lastPulseIndexApplied = r.pulseIndex;
    }

    this.refreshGrooveDrive();

    // スケール: キック縦／スネア横／カッティングは Flash 主導の横パルス
    if (bandSoloAllows("low") || bandSoloAllows("mid") || bandSoloAllows("high")) {
      const groove = this.getGrooveBob() * M;
      const conf = r.pulseConfidence;
      const kickAccent = (this.kickImpulse * 0.85 + this.peakPunch * 0.35) * M;
      const snareCrack = (this.snareImpulse * 0.75 + this.snareFlash * 0.6) * M;
      // カッティング／スネア＝横のキレ。持続 wobble なし
      const chopPulse = (this.guitarFlash * 1.35 + this.snareFlash * 0.35) * M;
      const grooveAmp = 0.11 + conf * 0.08;
      const targetY =
        1 -
        Math.min(0.12, groove * grooveAmp * 1.35 + kickAccent * 0.075);
      const targetXz =
        1 +
        Math.min(
          0.16,
          snareCrack * 0.13 +
            groove * 0.018 +
            kickAccent * 0.012 +
            chopPulse * 0.13,
        );
      const onBeat =
        groove > 0.12 ||
        kickAccent > 0.14 ||
        snareCrack > 0.12 ||
        this.guitarFlash > 0.14 ||
        this.snareFlash > 0.16;
      const attack = onBeat ? 48 : this.guitarFlash > 0.1 ? 36 : 8;
      const follow = Math.min(1, deltaTime * attack);
      if (bandSoloAllows("low")) {
        this.group.scale.y += (this.baseScale.y * targetY - this.group.scale.y) * follow;
      }
      if (bandSoloAllows("mid") || bandSoloAllows("low")) {
        this.group.scale.x += (this.baseScale.x * targetXz - this.group.scale.x) * follow;
        this.group.scale.z += (this.baseScale.z * targetXz - this.group.scale.z) * follow;
      }
      if (!bandSoloAllows("low") && !bandSoloAllows("mid")) {
        this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * 8));
      }
    } else {
      this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * 7));
    }

    // 表面 flow: スネア／シンバルのクラックのみ。ギター・ハットのうねりは載せない
    const surfaceShake =
      this.snareFlash * 0.5 +
      this.snareImpulse * 0.25 +
      this.waveImpulse * 0.3 +
      this.guitarFlash * 0.12;
    if (surfaceShake > 0.08 && !this.completed && !this.shapeHold) {
      const amount = surfaceShake * deltaTime * 0.045 * M;
      const salt = this.formingTime * 3.2 + this.morphologySeed;
      const flowStride = getHeavyGrowthFlowStride();
      const flowPhase = Math.floor(this.formingTime * 20) % flowStride;
      for (let i = 0; i < this.accumulated.length; i += 1) {
        if ((i + flowPhase) % flowStride !== 0) continue;
        const idx = i * 3;
        growthFlow(
          this.basePositions[idx] * 2.8,
          this.basePositions[idx + 1] * 2.8,
          this.basePositions[idx + 2] * 2.8,
          salt,
          this._curlOut,
        );
        const boost =
          flowStride *
          (0.45 + this.waveImpulse * 0.35 + this.snareFlash * 0.35 + this.guitarFlash * 0.12);
        this.flowField[idx] += this._curlOut.x * amount * boost;
        this.flowField[idx + 1] += this._curlOut.y * amount * boost;
        this.flowField[idx + 2] += this._curlOut.z * amount * boost;
      }
    }
  }

  /** 完成直前に、録音音声から導出したパレットと種プロファイルを受け取る */
  prepareCompletion(palette: SculpturePalette, species?: SpeciesProfile) {
    this.completionPalette = palette;
    this.liveSongPalette = palette;
    this.songColorBlend = 1;
    this.completionSpecies = species ?? null;
    if (species) {
      this.speciesProfile = species;
      // 完成シルエットを種の勝者寄りへ寄せる（ライブ最終フレームの曖昧さ残しを減らす）
      const finalized = this.buildFinalizedMorphWeights(species);
      const w = this.morphWeights;
      w.diabolo = w.diabolo * 0.4 + finalized.diabolo * 0.6;
      w.torus = w.torus * 0.4 + finalized.torus * 0.6;
      w.monolith = w.monolith * 0.4 + finalized.monolith * 0.6;
      w.coral = w.coral * 0.4 + finalized.coral * 0.6;
      w.spindle = w.spindle * 0.4 + finalized.spindle * 0.6;
      this.normalizeMorphWeights();
    }
    // 完成待ち中も最終色へ滑らかに寄せる（瞬間切り替えしない）
    this.refreshEvolvingClayColors(0.2);
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
    // **呼吸はリセットしない**（[P1]）。形成中から `updateLiveBreath` が同じ位相で回していて、
    // 膜の地がそこへ寄せてある。ここで 0 に戻すと完成の瞬間に呼吸の位相が飛ぶ。
    const bpm = latestRhythm.bpm;
    this.breathBpm = bpm > 30 && bpm < 200 ? Math.min(150, Math.max(44, bpm)) : this.breathBpm;
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
    this.peakPunch = 0;
    this.snareFlash = 0;
    this.hatFlash = 0;
    this.guitarImpulse = 0;
    this.guitarFlash = 0;
    this.melodyPhraseImpulse = 0;
    this.mixBusy = 0;
    this.primaryHitLock = 0;
    this.drumLiveGate = 0;
    this.sectionSurgeBoost = 0;
    this.membranePressureImpulse = 0;
    this.songColorBlend = 1;
    // 曲パレット + 天気・時刻（再生中に寄せ済みならほぼ変化なし）
    this.applyCompletionEnvColors();
  }

  /**
   * 完成後の毎フレーム更新 — スタイルごとの「その後」。
   * - petrify:  数秒かけて粘土が鉱物へ変わり、膜が結晶化する
   * - breathe:  録音した鼓動(BPM)を記憶して呼吸を続ける
   * - monolith: 音のプロファイルが決めた素材（大理石〜ブロンズ〜黒曜石）が現れる
   */
  private updateAfterlife(deltaTime: number) {
    // 完成後も結晶面の選択を最新に保つ（dev パネルの override 変更にも追従させる）。
    this.syncGemFacets();
    const st = this.style;
    const palette = this.getDisplayCompletionPalette();
    const species = this.completionSpecies ?? this.speciesProfile;
    const afterlife = deriveAfterlifeMaterial(palette, species);
    this.completionProgress = Math.min(
      1,
      this.completionProgress + deltaTime / Math.max(0.001, st.completion.seconds),
    );
    const p = this.completionProgress;
    const ease = p * p * (3 - 2 * p);

    // 形状の大枠は complete() 以前に確定済みだが、曲の記録の焼き込み
    // （bakeFinalSculptureMemory で確定した最終コントラスト）だけは
    // この完成アニメーションに乗せて滑らかに適用する。それ以外はマテリアル／呼吸のみ
    this.applySculptureMemoryBake(ease);
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
          // vita: 真珠 + 曲色 + 環境（天気・時刻）を同じ強さで保つ。
          // 完成後も「再生中と同じ混色」を見せる: 再生中は core の emissive を 0 にして
          // 頂点カラー（真珠＋暖⇔寒の混色）をそのまま出している（updateAudioColors 参照）。
          // ここで palette.hue の単色 emissive を強く足すと面全体が1色へ寄り、混色が洗われる
          // （実測: 完成で本体の色相の散らばりが再生中の約半分に落ちていた）。
          // そこで emissive は弱く・淡くして呼吸のゆらぎだけ残し、色は頂点カラー主導に保つ。
          this.coreMaterial.color.set(0xffffff);
          this.innerCoreMaterial.color.copy(this.completionStartInnerColor);
          this._tmpColor.setHSL(
            palette.hue,
            Math.min(0.3, palette.saturation * 0.4 * afterlife.saturationMul),
            0.18 + this.breathWave * 0.08 + palette.lightness * 0.06,
          );
          this.coreMaterial.emissive.lerp(this._tmpColor, Math.min(1, deltaTime * 2.4));
          this.coreMaterial.emissiveIntensity =
            (0.05 + this.breathWave * 0.12 + palette.emissiveStrength * 0.1 * ease) *
            afterlife.emissiveMul *
            st.core.emissiveScale;
          const memBase = this.surfaceMaterial.uniforms.uPaletteColor.value as THREE.Color;
          const memAccent = this.surfaceMaterial.uniforms.uPaletteAccent.value as THREE.Color;
          memBase.lerp(palette.baseColor, Math.min(1, deltaTime * 0.55 * ease));
          memAccent.lerp(palette.accentColor, Math.min(1, deltaTime * 0.6 * ease));
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

    this.applyCompletionFinish(ease, afterlife);
  }

  /**
   * 完成フェーズの質感を立ち上げる（style.completion.finish がある場合のみ）。
   * 立ち上がり量は種プロファイル（afterlife）で曲ごとに変わる。
   *
   * **2026-08-13（[P1] step 2）以降、形成中も熟成度ぶんだけ同じ値へ寄せている**
   * （`updateCoreMaterial`）。そこで立ち上がりは `ease` ではなく
   * **`max(ease, 熟成度)`** で進める。ease をそのまま使うと、LIVE で 0.9 まで
   * 上がっていた磨きが完成の瞬間に 0 へ落ちてから上がり直す（＝直したかった飛びが再発）。
   * **`Math.max(m.clearcoat, …)` で下限を作る形にしてはいけない**：下の宝石ぶんが
   * 毎フレーム加算されて 1 まで暴走する（roughness は 0 へ落ちる）。
   * 非 vita は熟成度が 0 なので `ease` のまま＝従来と同じ。
   */
  private applyCompletionFinish(ease: number, afterlife: AfterlifeMaterial) {
    const finish = this.style.completion.finish;
    if (!finish) {
      return;
    }
    const m = this.coreMaterial;
    const eps = SoundSculpture.FINISH_EPSILON;
    const blend = Math.max(ease, this.getMaturity());
    if (finish.clearcoat !== undefined) {
      m.clearcoat = Math.max(eps, Math.min(1, finish.clearcoat * afterlife.clearcoatMul) * blend);
      m.clearcoatRoughness = finish.clearcoatRoughness ?? 0.62;
    }
    if (finish.sheen !== undefined) {
      m.sheen = Math.max(eps, finish.sheen * blend);
      m.sheenRoughness = finish.sheenRoughness ?? 0.8;
    }
    if (finish.iridescence !== undefined) {
      m.iridescence = Math.max(eps, finish.iridescence * blend);
      m.iridescenceIOR = finish.iridescenceIOR ?? 1.32;
    }
    if (finish.roughness !== undefined) {
      const target = Math.min(1, Math.max(0.05, finish.roughness * afterlife.roughnessMul));
      m.roughness =
        this.completionStartRoughness + (target - this.completionStartRoughness) * ease;
      this.innerCoreMaterial.roughness = Math.min(1, m.roughness + 0.03);
    }
    // 宝石（vita [P2]）: 結晶になっている面の割合ぶんだけ完成質感を「磨き」側へ足す。
    // 歪みロックほど完成時に宝石へ寄り、結晶が 0 枚（アコギ）は確定値のまま no-op。
    // 上の finish 代入への加算なので、既存の確定値は下限として保たれる。
    // **`DEFAULT_GEM_STRENGTH` を直接読むとパネルの「宝石強度」が完成後に効かない**
    // （2026-08-12 のバグ。isolate 検証も無効になっていた）。現在値を読むこと。
    const gemFinish = this.getCrystalFaceRatio() * gemUniforms.uGem.value * blend;
    if (gemFinish > 0.001) {
      m.clearcoat = Math.min(1, m.clearcoat + gemFinish * 0.4);
      m.clearcoatRoughness = Math.max(0.05, m.clearcoatRoughness - gemFinish * 0.28);
      m.iridescence = Math.min(1, m.iridescence + gemFinish * 0.28);
      m.roughness = Math.max(0.05, m.roughness * (1 - gemFinish * 0.4));
      this.innerCoreMaterial.roughness = Math.min(1, m.roughness + 0.03);
    }
  }

  /**
   * 完了時フック。曲の記録（蓄積した頂点変位）に、この曲固有のコントラストを
   * 一度だけ・不可逆に焼き込む。
   *
   * 背景: vectorField（アンカー由来の方向性変位）・sculptureMemory/erosionField
   * （法線方向のスカラ変位）は曲全体で蓄積される「永久メモリ」だが、発散防止の
   * 頂点ごとクランプがあるため、ある程度アクティブな曲ならどれも上限付近まで
   * 飽和してしまい、曲ごとの違いが最終形に残りにくかった
   * （原則の主ギャップ＝完成形に曲の記録が残らない、の直接原因）。
   *
   * ここでは新しい変形システムを足すのではなく、「この曲で実際にどれだけ
   * 偏って育ったか」をそのまま使う: 一部の頂点だけ強く育った曲（＝静と動の
   * 差が大きい曲）ほど強くコントラストを付け、全体が均等に育った曲は
   * 素直な丸みのまま残す。曲そのものの分布を基準にするので、曲の音量や
   * 長さに関わらず「この曲なりの強弱」になる。
   *
   * 即座に書き換えると complete() の瞬間に形がポップして見えるため、実際の
   * 適用は updateAfterlife() 側で完成アニメーション（ease 0→1）に乗せて行う。
   * ここでは「元の値」と「最終倍率」を確定させるだけ。
   */
  private bakeFinalSculptureMemory() {
    const n = this.accumulated.length;
    if (n === 0) {
      return;
    }

    const vecMags = new Float32Array(n);
    const scalarMags = new Float32Array(n);
    let vecMagSum = 0;
    let vecMagMax = 0;
    let scalarMagSum = 0;
    let scalarMagMax = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = i * 3;
      const mag = Math.hypot(
        this.vectorField[idx],
        this.vectorField[idx + 1],
        this.vectorField[idx + 2],
      );
      vecMags[i] = mag;
      vecMagSum += mag;
      if (mag > vecMagMax) vecMagMax = mag;

      const smag = Math.abs(this.sculptureMemory[i]) + Math.abs(this.erosionField[i]);
      scalarMags[i] = smag;
      scalarMagSum += smag;
      if (smag > scalarMagMax) scalarMagMax = smag;
    }

    // ほぼ無音のまま終わった曲（静止画のような形）は焼き込む対象が無いので触らない
    if (vecMagMax < 1e-5 && scalarMagMax < 1e-5) {
      return;
    }

    const vecMean = vecMagSum / n;
    const scalarMean = scalarMagSum / n;
    // 最大／平均比が大きいほど「一部だけ突出して育った」曲 → コントラストを強める。
    // 初版は差が控えめすぎて「曲の個性か判断しづらい」との指摘を受け、
    // 立ち上がりを早め（1.4→1.15, /4→/2.2）、最大強度も大幅に引き上げた（1.3→3.2）。
    const vecSpread = vecMagMax > 1e-5 ? clamp01((vecMagMax / (vecMean + 1e-5) - 1.15) / 2.2) : 0;
    const scalarSpread =
      scalarMagMax > 1e-5 ? clamp01((scalarMagMax / (scalarMean + 1e-5) - 1.15) / 2.2) : 0;
    const vecExponent = 1 + vecSpread * 3.2;
    const scalarExponent = 1 + scalarSpread * 3.2;

    this.bakeVectorFieldOriginal = Float32Array.from(this.vectorField);
    this.bakeSculptureMemoryOriginal = Float32Array.from(this.sculptureMemory);
    this.bakeErosionFieldOriginal = Float32Array.from(this.erosionField);
    this.bakeVectorFieldScale = new Float32Array(n).fill(1);
    this.bakeScalarScale = new Float32Array(n).fill(1);

    for (let i = 0; i < n; i += 1) {
      if (vecMagMax > 1e-5 && vecMags[i] > 1e-6) {
        const ratio = vecMags[i] / vecMagMax;
        this.bakeVectorFieldScale[i] = Math.pow(ratio, vecExponent - 1);
      }
      if (scalarMagMax > 1e-5 && scalarMags[i] > 1e-6) {
        const ratio = scalarMags[i] / scalarMagMax;
        this.bakeScalarScale[i] = Math.pow(ratio, scalarExponent - 1);
      }
    }
  }

  /** bakeFinalSculptureMemory() が確定した焼き込みを、完成アニメーションに乗せて適用する */
  private applySculptureMemoryBake(ease: number) {
    if (
      !this.bakeVectorFieldOriginal ||
      !this.bakeVectorFieldScale ||
      !this.bakeSculptureMemoryOriginal ||
      !this.bakeErosionFieldOriginal ||
      !this.bakeScalarScale
    ) {
      return;
    }
    const n = this.bakeScalarScale.length;
    for (let i = 0; i < n; i += 1) {
      const idx = i * 3;
      const vecScale = 1 + (this.bakeVectorFieldScale[i] - 1) * ease;
      this.vectorField[idx] = this.bakeVectorFieldOriginal[idx] * vecScale;
      this.vectorField[idx + 1] = this.bakeVectorFieldOriginal[idx + 1] * vecScale;
      this.vectorField[idx + 2] = this.bakeVectorFieldOriginal[idx + 2] * vecScale;

      const scalarScale = 1 + (this.bakeScalarScale[i] - 1) * ease;
      this.sculptureMemory[i] = this.bakeSculptureMemoryOriginal[i] * scalarScale;
      this.erosionField[i] = this.bakeErosionFieldOriginal[i] * scalarScale;
    }
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
    this.bakeVectorFieldOriginal = null;
    this.bakeVectorFieldScale = null;
    this.bakeSculptureMemoryOriginal = null;
    this.bakeErosionFieldOriginal = null;
    this.bakeScalarScale = null;
    this.liveSongPalette = null;
    this.songColorBlend = 0;
    this.pearlColorBakeCooldown = 0;
    this.lastPearlBakeHue = -1;
    this.breathTime = 0;
    this.breathWave = 0;
    this.currentStructure = defaultStructureSnapshot();
    this.speciesProfile = { ...DEFAULT_SPECIES_PROFILE };
    this.lastNoveltySpawn = 0;
    this.formingTime = 0;
    this.activeFormingTime = 0;
    this.soundExposure = 0;
    this.maturity = 0;
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
    // 天気シフトは環境側の状態なのでリセット後も維持
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
    this.lastChopIndexApplied = -1;
    this.lastSalienceIndexApplied = -1;
    this.lastPulseIndexApplied = -1;
    this.kickImpulse = 0;
    this.snareImpulse = 0;
    this.hatImpulse = 0;
    this.waveImpulse = 0;
    this.peakPunch = 0;
    this.snareFlash = 0;
    this.hatFlash = 0;
    this.guitarImpulse = 0;
    this.guitarFlash = 0;
    this.melodyPhraseImpulse = 0;
    this.lastSalienceHighSpark = 10;
    this.mixBusy = 0;
    this.primaryHitLock = 0;
    this.drumLiveGate = 0;
    this.sectionSurgeBoost = 0;
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

    // リセット直後も表示メッシュを合わせる（合わせないと前の形が残る）
    this.syncDisplayGeometry(true);

    const styleCore = this.style.core;
    this.syncClayColors();
    this.coreMaterial.roughness = styleCore.roughness;
    this.coreMaterial.metalness = 0;
    this.coreMaterial.clearcoat = styleCore.clearcoat;
    this.coreMaterial.sheen = styleCore.sheen;
    this.coreMaterial.iridescence = styleCore.iridescence;
    // 完成フェーズで立ち上げた質感を形成フェーズへ戻す。
    // finish が使うチャンネルだけ 0 ではなく実質 0（再コンパイル回避）にする
    const resetFinish = this.style.completion.finish;
    if (resetFinish) {
      const off = SoundSculpture.FINISH_EPSILON;
      if (resetFinish.clearcoat !== undefined) {
        this.coreMaterial.clearcoat = Math.max(styleCore.clearcoat, off);
      }
      if (resetFinish.sheen !== undefined) {
        this.coreMaterial.sheen = Math.max(styleCore.sheen, off);
      }
      if (resetFinish.iridescence !== undefined) {
        this.coreMaterial.iridescence = Math.max(styleCore.iridescence, off);
      }
    }
    this.completionStartRoughness = styleCore.roughness;
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

  /**
   * glow / sparkle / detachment は group 配下だが、見た目はワールド固定にする。
   * （形成中の付着パーティクル this.particles はオブジェクトに追従させる）
   */
  private syncAmbientFxWorldLock() {
    this.ambientFxInvQuat.copy(this.group.quaternion).invert();
    const sx = this.group.scale.x || 1;
    const sy = this.group.scale.y || 1;
    const sz = this.group.scale.z || 1;
    const lock = (obj: THREE.Object3D) => {
      obj.quaternion.copy(this.ambientFxInvQuat);
      obj.scale.set(1 / sx, 1 / sy, 1 / sz);
    };
    lock(this.glowDust);
    lock(this.sparkles);
    lock(this.sparkleGlow);
    lock(this.detachmentDustSand);
    lock(this.detachmentDustMetal);
    lock(this.detachmentDustSpark);
  }

  /** ambient FX バッファはワールド座標として扱う（world lock 前提） */
  private toAmbientFxWorldPoint(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    out.applyMatrix4(this.group.matrixWorld);
  }

  private toAmbientFxWorldDirection(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    out.transformDirection(this.group.matrixWorld);
  }

  private emitDetachmentDust(
    kind: "sand" | "metal" | "spark",
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    strength: number,
  ) {
    // ワールド固定 FX 用に、発生位置・方向をワールドへ
    const worldOrigin = origin.clone();
    const worldDir = dir.clone().normalize();
    this.toAmbientFxWorldPoint(worldOrigin);
    this.toAmbientFxWorldDirection(worldDir);
    const burstCount =
      kind === "spark"
        ? Math.min(220, Math.floor(60 + strength * 340))
        : kind === "metal"
          ? Math.min(160, Math.floor(40 + strength * 220))
          : Math.min(180, Math.floor(50 + strength * 240));
    const tangent = new THREE.Vector3();
    const bitangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    buildFragmentBasis(worldDir, tangent, bitangent, normal);

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
      const px = worldOrigin.x + tangent.x * Math.cos(a) * r + bitangent.x * Math.sin(a) * r + normal.x * jitter;
      const py = worldOrigin.y + tangent.y * Math.cos(a) * r + bitangent.y * Math.sin(a) * r + normal.y * jitter;
      const pz = worldOrigin.z + tangent.z * Math.cos(a) * r + bitangent.z * Math.sin(a) * r + normal.z * jitter;
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
      const palette = this.getDisplayCompletionPalette();
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
    if (this.style.id === "dither") {
      return;
    }
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

    // 膜の質感が粘土へ移るのは控えめに（スペキュラ白飛び防止）
    // 回転で色が飛ぶ原因になる clearcoat / sheen / iridescence は、**熟成度ぶんだけ**
    // 完成フェーズの値へ寄せる（[P1] step 2。以前は形成中ずっと FINISH_EPSILON ＝ 実質 0 で、
    // 完成の瞬間に 0 → 0.42/0.55/0.34 が立ち上がるのが「LIVE と完成で全く違う」の主因だった）。
    // 完成後は applyCompletionFinish が持つ（この関数は形成中しか呼ばれない）。
    const off = SoundSculpture.FINISH_EPSILON;
    const membraneBleed = this.membranePressureImpulse * 0.35;
    const finish = this.style.completion.finish;
    const polish = finish ? this.getMaturity() : 0;
    // 宝石ぶんの磨き（結晶面の割合 × 宝石強度）も同じ熟成度で立ち上げる。
    // 完成時の加算（applyCompletionFinish）と同じ量に向かうので、完成で段差にならない。
    const gemPolish = polish * this.getCrystalFaceRatio() * gemUniforms.uGem.value;
    if (this.baseCoreClearcoat > 0) {
      this.coreMaterial.clearcoat = Math.min(
        1,
        this.baseCoreClearcoat + membraneBleed * 0.12,
      );
      this.coreMaterial.clearcoatRoughness = Math.max(0.45, 0.72 - membraneBleed * 0.04);
    } else if (finish?.clearcoat !== undefined && polish > 0) {
      // 完成時と同じ種プロファイル倍率（`deriveAfterlifeMaterial`）を LIVE でも掛ける（[P1]）。
      // これが無いと、歪みロック（aggressive 高＝clearcoatMul 約 1.4）で完成の艶に届かない。
      this.coreMaterial.clearcoat = Math.max(
        off,
        Math.min(1, finish.clearcoat * this.liveAfterlife.clearcoatMul * polish + gemPolish * 0.4),
      );
      this.coreMaterial.clearcoatRoughness = Math.max(
        0.05,
        (finish.clearcoatRoughness ?? 0.62) - gemPolish * 0.28,
      );
    } else {
      this.coreMaterial.clearcoat = off;
    }
    if (this.baseCoreSheen > 0) {
      this.coreMaterial.sheen = Math.min(1, this.baseCoreSheen + membraneBleed * 0.1);
      this.coreMaterial.sheenRoughness = Math.max(0.62, 0.88 - membraneBleed * 0.04);
    } else if (finish?.sheen !== undefined && polish > 0) {
      this.coreMaterial.sheen = Math.max(off, finish.sheen * polish);
      this.coreMaterial.sheenRoughness = finish.sheenRoughness ?? 0.8;
    } else {
      this.coreMaterial.sheen = off;
    }
    if (this.baseCoreIridescence > 0) {
      this.coreMaterial.iridescence = Math.min(1, this.baseCoreIridescence + membraneBleed * 0.08);
      this.coreMaterial.iridescenceIOR = 1.35;
    } else if (finish?.iridescence !== undefined && polish > 0) {
      this.coreMaterial.iridescence = Math.max(
        off,
        Math.min(1, finish.iridescence * polish + gemPolish * 0.28),
      );
      this.coreMaterial.iridescenceIOR = finish.iridescenceIOR ?? 1.32;
    } else {
      this.coreMaterial.iridescence = off;
    }
    // 明るさで粗さを落としすぎるとスペキュラがチョーク白になるため控えめに
    // 膜接触時はむしろ少し粗くして白飛びを抑える
    const baseRoughness =
      fibRatio(11, 12) +
      fibUnit(5, 21) -
      bands.brightness * fibUnit(3, 21) * shift * 0.65 -
      bands.high * fibUnit(2, 21) * shift * 0.65 +
      membraneBleed * 0.06;
    const liveRoughness = Math.min(
      1,
      Math.max(
        0.1,
        baseRoughness +
          (st.roughness - 0.94) +
          sp.aggressive * fibUnit(5, 21) -
          sp.organic * fibUnit(5, 21),
      ),
    );
    // [P1] step 2: 完成の roughness（vita 0.78・結晶面はさらに ×0.6）へ熟成度ぶん寄せる。
    // ここを寄せないと「LIVE はマット粘土 / 完成は艶」の段差が残る。
    const finishRoughness = finish?.roughness;
    const matureRoughness =
      finishRoughness === undefined
        ? liveRoughness
        : liveRoughness +
          (Math.min(1, Math.max(0.05, finishRoughness * this.liveAfterlife.roughnessMul)) -
            liveRoughness) *
            polish;
    this.coreMaterial.roughness = Math.max(0.05, matureRoughness * (1 - gemPolish * 0.4));
    this.innerCoreMaterial.roughness = Math.min(1, this.coreMaterial.roughness + 0.03);
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
    const ev = this.getListeningEventDrive(bands);
    // **地（常時出ているうねり）と出来事（打点）を分ける**（[P1]）。
    // 地だけを熟成度で「完成後の呼吸ドライブ」へ寄せ、出来事はそのまま上に足す。
    // ＝曲が進むほど膜の常時の揺らぎが落ち着き、ヒットの読み取りは最後まで同じ。
    const eventLive = ev.thump * 0.12 + ev.ting * 0.62 + ev.chatter * 0.78 + ev.sparkle * 0.12;
    const groundLive =
      w.high * t.liveHigh * fibRatio(2, 13) * audioPart * this.getDrumLiveMul(0.08) * 0.25 +
      this.getSpecies().membraneGain * fibUnit(1, 21) * audioPart * ev.listen * 0.55 +
      this.idleWobbleAmp * 5;
    const listenGate = 0.22 + ev.listen * 0.78;
    const settledGround = 0.45 + this.breathWave * 0.6; // 完成後の breathe 分岐と同じ式
    const m = this.getMaturity();
    return groundLive * listenGate * (1 - m) + settledGround * m + eventLive * listenGate;
  }

  private getMembraneGlowTarget(bands: AudioBands) {
    const audioPart = this.style.core.pearlVariation > 0 ? this.audioColorBlend : 1;
    if (this.completed && this.style.completion.mode === "breathe") {
      const interaction = this.hasActiveClickWobble() ? this.idleWobbleAmp : 0;
      return 0.4 + this.breathWave * 0.45 + interaction * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2);
    }
    if (this.completed) {
      const interaction = this.hasActiveClickWobble() ? this.idleWobbleAmp : 0;
      return 0.35 + interaction * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2);
    }
    const ev = this.getListeningEventDrive(bands);
    // 地（常時のグロー）と出来事（打点のフラッシュ）を分ける（[P1]。上の live と同じ考え方）
    const groundGlow =
      0.12 +
      ev.listen * 0.28 +
      this.separationTendency * 0.06 * audioPart +
      this.idleWobbleAmp * (3.2 + Math.sin(this.idleTime * 0.55) * 1.2);
    const eventGlow =
      // 中音：膜グローの主役
      ev.ting * 0.55 +
      ev.chatter * 0.95 +
      // 高音：粒子が本線。膜はチッチの補助だけ
      ev.sparkle * 0.4 +
      ev.thump * 0.08;
    const settledGlow = 0.4 + this.breathWave * 0.45; // 完成後の breathe 分岐と同じ式
    const m = this.getMaturity();
    return groundGlow * (1 - m) + settledGlow * m + eventGlow;
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
    // 中音フラッシュ＝ライン／フレネル。高音は uHigh 微信号のみ（粒子が本線）
    const midFlash = clamp01(this.guitarFlash * 1.05 + this.snareFlash * 0.55);
    const hatTick = clamp01(this.hatFlash * 1.05 + this.hatImpulse * 0.45);
    uniforms.uMelodyLine.value =
      t.membraneLine * (1 + midFlash * 1.65 + this.melodyPhraseImpulse * 0.4);
    uniforms.uMelodyFresnel.value =
      t.membraneFresnel * (1 + midFlash * 0.75 + this.melodyPhraseImpulse * 0.25);
    uniforms.uMelodyNoise.value = t.membraneNoise * (0.85 + midFlash * 0.35);
    uniforms.uMelodyFlowAnim.value = 0.95 + t.liveHigh * 0.7 + midFlash * 0.65;
    uniforms.uLive.value = Math.min(1.05, Math.max(0, this.getMembraneLiveTarget(bands)));
    uniforms.uGlow.value = Math.min(1.2, Math.max(0, this.getMembraneGlowTarget(bands)));
    // 帯域の持続よりフラッシュを優先（常時ラインを消す）
    uniforms.uMid.value = clamp01(midFlash * 0.95 + bands.mid * 0.12);
    uniforms.uMelody.value = clamp01(
      this.guitarFlash * 0.9 + this.melodyPhraseImpulse * 0.55 + bands.melody * 0.1,
    );
    uniforms.uHigh.value = clamp01(hatTick * 0.85 + bands.high * 0.12);
    // 結晶になる面の選択（音色軸）。core / 膜 / 幾何が共有する module uniform を更新。
    this.syncGemFacets();

    const impulsePart =
      (this.getGrooveBob() * 0.5 + this.kickImpulse * 0.55 + this.snareImpulse * 0.18 + this.peakPunch * 0.22) *
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
    const sp = this.getSpecies();
    const energy =
      Math.max(0, bands.overall - 0.02) *
      deltaTime *
      runtimeTuning.globalFormEnergyScale *
      formation *
      this.getSectionAccumMul();
    const w = this.morphWeights;
    // 種・モルフで伸び方と上限の両方を分岐（長い曲でも同じ天井に潰さない）
    const stretchBias = 0.85 + sp.aggressive * 0.55 + w.spindle * 0.7 + w.monolith * 0.35;
    const waistBias = 0.75 + sp.organic * 0.55 + w.diabolo * 0.85 + w.coral * 0.4;
    const twistBias = 0.8 + sp.rhythmic * 0.5 + w.torus * 0.75 + bands.contrast * 0.25;
    const stretchCap = Math.min(
      0.78,
      0.4 + w.spindle * 0.34 + w.monolith * 0.2 + sp.aggressive * 0.14,
    );
    const waistCap = Math.min(
      0.82,
      0.46 + w.diabolo * 0.3 + w.coral * 0.18 + sp.organic * 0.12,
    );
    const twistCap = Math.min(
      0.92,
      0.5 + w.torus * 0.34 + sp.rhythmic * 0.16 + bands.contrast * 0.08,
    );

    this.formStretch = Math.min(
      stretchCap,
      this.formStretch +
        energy * (0.1 + bands.overall * 0.22) * runtimeTuning.formStretchRate * stretchBias,
    );
    this.formWaist = Math.min(
      waistCap,
      this.formWaist +
        energy *
          (0.12 + bands.contrast * 0.32 + bands.overall * 0.18) *
          (0.25 + w.diabolo * 0.75) *
          waistBias,
    );
    this.formTwist = Math.min(
      twistCap,
      this.formTwist +
        energy *
          (0.12 + bands.overall * 0.26 + bands.contrast * 0.18) *
          runtimeTuning.formTwistAccumRate *
          twistBias,
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
  /** 結晶ファセットの平面（軸＋距離）を morphologySeed から決める。曲ごとに向きが変わる。 */
  private initCrystalFacets() {
    const planes = gemUniforms.uGemPlanes.value;
    for (let k = 0; k < SoundSculpture.facetCount; k += 1) {
      const p = growthPlaceOnSphere(k, SoundSculpture.facetCount, this.morphologySeed + 71.3);
      this.facetAxes[k * 3] = p.x;
      this.facetAxes[k * 3 + 1] = p.y;
      this.facetAxes[k * 3 + 2] = p.z;
      // 面ごとに距離を少し散らす（規則正しい多面体を避け、曲固有の不揃いな結晶にする）。
      this.facetLevels[k] = 0.9 + seededUnit(k + 1, this.morphologySeed + 88.1) * 0.28;
      // 結晶になる順番。曲（morphologySeed）ごとにどの面から鉱物化するかが変わる。
      this.facetRank[k] = seededUnit(k + 31, this.morphologySeed + 140.9);
      this.facetCrystal[k] = 0;
      planes[k * 4] = p.x;
      planes[k * 4 + 1] = p.y;
      planes[k * 4 + 2] = p.z;
      planes[k * 4 + 3] = 0;
    }
    this.anyCrystalFace = 0;
  }

  /**
   * 音色軸から「どの面が結晶か」を決め、宝石シェーダの uniform を更新する。
   *
   * 軸は**強度ではなく枚数**を決める: 軸がその面のランクを越えたら結晶になる。
   * 曲が進んで軸が上がるにつれて面が1枚ずつ結晶化していく（ポップしないよう smoothstep）。
   * 軸 0 では 1 枚も結晶にならないので、幾何・材質とも**完全な恒等**になる。
   *
   * ワールド法線も一緒に送る。`normalMatrix` はフラグメントシェーダには来ないので、
   * ここで回してから渡し、シェーダ側は `viewMatrix` でビュー空間へ落とす。
   */
  private syncGemFacets() {
    // 軸＝**最終的に**結晶になる面の枚数 / 熟成度＝いま何枚目まで結晶化したか（[P1] step 2）。
    // 軸だけだと 10〜40 秒で飽和して枚数が序盤で止まる（Fury は 40 秒で 18 面すべて）。
    const axis = this.getMineralAxis() * (this.style.membrane.vita ? this.getMaturity() : 1);
    const planes = gemUniforms.uGemPlanes.value;
    const world = gemUniforms.uGemPlanesWorld.value;
    gemUniforms.uMineral.value = axis;
    this.facetNormalMatrix.getNormalMatrix(this.group.matrixWorld);
    let any = 0;
    for (let k = 0; k < SoundSculpture.facetCount; k += 1) {
      const rank = this.facetRank[k];
      const on = smoothstep(rank, rank + 0.08, axis);
      this.facetCrystal[k] = on;
      planes[k * 4 + 3] = on;
      if (on > any) {
        any = on;
      }
      const kk = k * 3;
      this.facetWorldScratch
        .set(this.facetAxes[kk], this.facetAxes[kk + 1], this.facetAxes[kk + 2])
        .applyMatrix3(this.facetNormalMatrix)
        .normalize();
      world[kk] = this.facetWorldScratch.x;
      world[kk + 1] = this.facetWorldScratch.y;
      world[kk + 2] = this.facetWorldScratch.z;
    }
    this.anyCrystalFace = any;
  }

  /** 結晶になっている面の割合 0..1（完成時の磨きの量に使う）。 */
  private getCrystalFaceRatio(): number {
    let sum = 0;
    for (let k = 0; k < SoundSculpture.facetCount; k += 1) {
      sum += this.facetCrystal[k];
    }
    return sum / SoundSculpture.facetCount;
  }

  /**
   * 音色（鉱物軸）で、各頂点を最も近い結晶平面へスナップして**平らな面＋鋭い稜**を作る。
   * 放射スパイクだけの「トゲトゲ球」から抜けるための新語彙（Phase 3）。
   * axis 0（丸み端）では t=0 で完全な恒等 ＝ 現状の vita 完成形を崩さない。
   * 隣り合う頂点が別の面へスナップする境界が鋭い稜になる。過大な変位は
   * 呼び出し元の constrainEnvelope が抑える。
   */
  private applyCrystalFacets(
    x: number,
    y: number,
    z: number,
    formMix: number,
    refRadius: number,
  ) {
    // refRadius <= 0 は「この層はここでは faceting しない」の合図（膜は別処理）。
    if (refRadius <= 0) {
      return { x, y, z };
    }
    // 1 枚も結晶になっていない（軸 0）なら完全な恒等。18 面のループごと飛ばす。
    if (this.anyCrystalFace <= 0.002 || formMix <= 0.002) {
      return { x, y, z };
    }
    const r = Math.hypot(x, y, z);
    if (r < 1e-4) {
      return { x, y, z };
    }
    const nx = x / r;
    const ny = y / r;
    const nz = z / r;
    let best = -2;
    let bk = 0;
    for (let k = 0; k < SoundSculpture.facetCount; k += 1) {
      const kk = k * 3;
      const d = nx * this.facetAxes[kk] + ny * this.facetAxes[kk + 1] + nz * this.facetAxes[kk + 2];
      if (d > best) {
        best = d;
        bk = k;
      }
    }
    // **その面が結晶になっているときだけ**、フル強度で平らにする。
    // 生物の面は一切スナップしない → 平らな結晶面と丸い生物面が同じ個体に同居する。
    // core は大域平均の単一パスなので上限は控えめ（0.55）に留め、球化を避ける。
    const t = this.facetCrystal[bk] * mineralMix.facetStrength * 0.55 * formMix;
    if (t <= 0.002) {
      return { x, y, z };
    }
    const kk = bk * 3;
    const mkx = this.facetAxes[kk];
    const mky = this.facetAxes[kk + 1];
    const mkz = this.facetAxes[kk + 2];
    // 面 { p : dot(p, m_k) = H } へ、法線 m_k に沿って寄せる（面上に載ると平らになる）。
    // refRadius はその層の平均半径: core と膜（半径が違う）で正しい距離の面へ寄せる。
    const H = refRadius * this.facetLevels[bk];
    const shift = (H - (x * mkx + y * mky + z * mkz)) * t;
    return { x: x + mkx * shift, y: y + mky * shift, z: z + mkz * shift };
  }

  /**
   * 膜（外殻）の結晶ファセット。**面ドメインごとの平均距離**へ寄せる2パス。
   * 大域平均へ寄せると膜のふくらみが潰れて球になるので、各面が担当する頂点群の
   * 平均距離を面の位置にする（大きな起伏は面ごとの距離差として残り、面内は平らになって
   * 境界に鋭い稜が立つ＝結晶）。axis 0 では効果なし。膜の輪郭を角ばらせる（要求 B）。
   */
  private applyMembraneFacets(positions: Float32Array) {
    // 面ドメイン平均なので球化しない → 上限を強め（0.85）にして輪郭をしっかり角ばらせる。
    // **結晶になっている面だけ**平らにする（生物の面は膜も丸いまま）。
    const t = mineralMix.facetStrength * 0.85 * smoothstep(0, 1, this.formDevelopment);
    if (t <= 0.002 || this.anyCrystalFace <= 0.002) {
      return;
    }
    const K = SoundSculpture.facetCount;
    const sumDot = this.facetSumDot;
    const cnt = this.facetCnt;
    sumDot.fill(0);
    cnt.fill(0);
    const n = this.accumulated.length;
    const nearestFacet = (x: number, y: number, z: number, r: number) => {
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      let best = -2;
      let bk = 0;
      for (let k = 0; k < K; k += 1) {
        const kk = k * 3;
        const d = nx * this.facetAxes[kk] + ny * this.facetAxes[kk + 1] + nz * this.facetAxes[kk + 2];
        if (d > best) {
          best = d;
          bk = k;
        }
      }
      return bk;
    };
    // pass 1: 面ドメインごとに、面法線に沿った距離 dot(p, m_k) の合計を貯める。
    for (let i = 0; i < n; i += 1) {
      const idx = i * 3;
      const x = positions[idx];
      const y = positions[idx + 1];
      const z = positions[idx + 2];
      const r = Math.hypot(x, y, z);
      if (r < 1e-4) continue;
      const bk = nearestFacet(x, y, z, r);
      const kk = bk * 3;
      sumDot[bk] += x * this.facetAxes[kk] + y * this.facetAxes[kk + 1] + z * this.facetAxes[kk + 2];
      cnt[bk] += 1;
    }
    // pass 2: 各頂点を「自分のドメインの平均距離」の面へ寄せる。
    for (let i = 0; i < n; i += 1) {
      const idx = i * 3;
      const x = positions[idx];
      const y = positions[idx + 1];
      const z = positions[idx + 2];
      const r = Math.hypot(x, y, z);
      if (r < 1e-4) continue;
      const bk = nearestFacet(x, y, z, r);
      const kk = bk * 3;
      const mkx = this.facetAxes[kk];
      const mky = this.facetAxes[kk + 1];
      const mkz = this.facetAxes[kk + 2];
      const Havg = cnt[bk] > 0 ? sumDot[bk] / cnt[bk] : this.targetSurfaceMeanRadius;
      const shift = (Havg - (x * mkx + y * mky + z * mkz)) * t * this.facetCrystal[bk];
      positions[idx] = x + mkx * shift;
      positions[idx + 1] = y + mky * shift;
      positions[idx + 2] = z + mkz * shift;
    }
  }

  private applyGlobalForm(
    px: number,
    py: number,
    pz: number,
    salt: number,
    facetRefRadius = this.targetCoreMeanRadius,
  ) {
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
    const winW = Math.max(w.diabolo, w.torus, w.monolith, w.coral, w.spindle);
    // 勝者が強いほどモーフ振幅を上げ、5 者平均の「少し歪んだ球」を避ける
    const winBoost = 0.78 + winW * 1.15;
    const blendScale = (delta: number, weight: number) => 1 + delta * weight * winBoost;

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
    // coral 床を撤廃 — 非 coral 曲に共通のゴツゴツを乗せて個性を潰さない
    sx *= blendScale(coralBump - 1, w.coral);
    sy *= blendScale(coralBump - 1, w.coral);
    sz *= blendScale(coralBump - 1, w.coral);

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
    // 音色→鉱物の結晶ファセット（axis 0 では効果なし＝丸み端は従来一致）。
    // formMix で序盤の球状態を守る。
    return this.applyCrystalFacets(
      px + (warpedX - px) * mix,
      py + (warpedY - py) * mix,
      pz + (warpedZ - pz) * mix,
      formMix,
      facetRefRadius,
    );
  }


  private accumulateBassPressure(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const formation = this.getFormationScale();
    const detail = this.getDetailScale();
    const sectionMul = this.getSectionAccumMul();
    const liveW = this.getBandLiveWeights(bands);
    const drumMul = this.getDrumLiveMul(0.1);
    const liveGainK = 0.38;
    const liveGainLow = (0.48 + liveW.low * t.liveLow * liveGainK) * drumMul;
    const liveGainMid = (0.48 + liveW.mid * t.liveMid * liveGainK) * drumMul;
    const liveGainHigh = (0.48 + liveW.high * t.liveHigh * liveGainK) * (0.2 + drumMul * 0.8);
    const lowPressure = Math.max(0, Math.max(bands.sub, bands.low) - 0.025);
    const midPressure = Math.max(0, Math.max(bands.mid, bands.melody) - 0.025);
    const highPressure = Math.max(0, bands.high - 0.025);
    const sculptMidDrive = midPressure;
    const midTexture = sculptMidDrive * (0.42 + bands.contrast * 0.48);
    const textureMul = this.getSectionTextureMul();
    const lowAmount = lowPressure * deltaTime * t.accumRate * liveGainLow * formation * sectionMul;
    const midAmount =
      sculptMidDrive *
      deltaTime *
      t.accumRate *
      liveGainMid *
      formation *
      textureMul *
      (0.65 + bands.contrast * 0.85);
    const highAmount =
      highPressure *
      deltaTime *
      t.accumRate *
      liveGainHigh *
      detail *
      textureMul *
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
      // 共通モーフを強め、アルゴリズム pattern と合わせて完成形の読み分けを残す
      const idolMix = 0.68;
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
    const axisBlend = 0.14 + s.density * 0.16 + s.mineralScore * 0.08;
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
    // 音色軸: 鉱物寄りほど結晶・侵食を桁で強く・大きく・長寿命にする（トゲトゲ球から抜ける量）。
    const axis = this.getMineralAxis();
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
        radius = (0.11 + seededUnit(this.growthAnchors.length, seed + 7) * 0.08) * (1 + axis * 0.45);
        strength = (0.22 + energy * 0.38) * sp.crystalGain * (0.55 + axis * 1.7);
        decay = 0.38 * (1 - axis * 0.28);
        break;
      case "erosion":
        radius = 0.28 + seededUnit(this.growthAnchors.length, seed + 8) * 0.2;
        strength =
          (0.3 + bands.contrast * 0.4 + (1 - s.energyLong) * 0.2) * sp.erosionGain * (1 + axis * 0.5);
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

    // 鉱物寄りほど結晶を「幅のある楔」寄りにする（尖った針 → 平らに近い面＝鉱物の稜）。
    const mineralAxis = this.getMineralAxis();
    const crystalSharpExp = 4.5 - mineralAxis * 1.3;

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
            const sharp = Math.pow(falloff, crystalSharpExp);
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
    const t = runtimeTuning;
    const rate = deltaTime * 1.4;
    // ヒット瞬間は転写を加速し、静かな区間は控えめ（ライブ感は残しつつ軌跡を刻む）
    const hitEnergy = clamp01(
      this.kickImpulse * 0.9 +
        this.peakPunch * 0.55 +
        this.snareFlash * 0.7 +
        this.snareImpulse * 0.45 +
        this.guitarImpulse * 0.55 +
        this.guitarFlash * 0.4 +
        this.hatFlash * 0.25,
    );
    const sectionMul = this.getSectionAccumMul();
    const textureMul = this.getSectionTextureMul();
    const bleedRate = 0.09 * (1 + hitEnergy * 1.35) * sectionMul;
    const ev = this.getListeningEventDrive(bands);
    // 帯域重みではなく聴感イベントで「何が刻まれたか」を決める（蓄積でも軌跡が読みやすい）
    const lowGate = 0.25 + ev.body * 0.75;
    const midGate = 0.2 + ev.crack * 0.4 + ev.phrase * 0.4;
    const highGate = 0.15 + ev.sparkle * 0.85;

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
      const grain = growthPattern(nx, ny, nz, this.formingTime * 1.15 + i * 0.029);

      const kickStamp =
        (this.kickImpulse * 0.085 + this.peakPunch * 0.055) * (0.55 + grain * 0.45);
      const lowBleed = growthModulateScalar(
        (this.liveOffset[i] * lowGate * t.liveLow * this.getDrumLiveMul(0.15) + kickStamp) *
          rate *
          bleedRate,
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
        (this.surfaceLiveOffset[i] * midGate * t.liveMid +
          this.snareFlash * 0.72 +
          this.snareImpulse * 0.38 +
          this.guitarImpulse * 0.78 +
          this.guitarFlash * 0.58 +
          this.pierceAmount[i] * 0.22) *
          rate *
          bleedRate *
          (textureMul / Math.max(0.18, sectionMul)),
        nx,
        ny,
        nz,
        deformSalt + 3.2,
        "surface",
      );
      if (Math.abs(midBleed) > 0.00001) {
        this.midBumps[i] = this.accumulateWithMemory(this.midBumps[i], midBleed, -0.42, 0.26);
      }

      const highDrive =
        highGate * t.liveHigh * 0.85 +
        this.hatImpulse * 0.58 +
        this.hatFlash * 0.68 +
        this.waveImpulse * 0.7;
      const highBleed = growthModulateScalar(
        highDrive *
          rate *
          bleedRate *
          (textureMul / Math.max(0.18, sectionMul)) *
          growthPattern(nx, ny, nz, this.formingTime * 2.1 + i * 0.03),
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
    // ヒット直後は記憶追従を早め、ライブ衝動が完成形へ残りやすくする
    const hitLock = clamp01(
      this.kickImpulse * 0.85 +
        this.peakPunch * 0.5 +
        this.snareFlash * 0.65 +
        this.guitarImpulse * 0.45,
    );
    const follow = Math.min(1, deltaTime * (5.5 + hitLock * 7.5));
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

  /**
   * 低解像度メッシュ（変形計算用）の結果を、描画に使う高解像度メッシュへ流し込む。
   *
   * **位置ではなく変位を補間する。** 位置を補間すると高解像度の頂点が
   * 低解像度の三角形の平面へ吸い寄せられ、直したかった多角形がそのまま残る。
   * 理屈は `display-mesh.ts` の説明を参照。
   */
  private syncDisplayGeometry(surfaceVisible: boolean) {
    const corePositions = this.geometry.attributes.position.array as Float32Array;
    syncDisplayPositions(
      this.displayBinding,
      corePositions,
      this.basePositions,
      this.displayPositions,
    );
    this.displayGeometry.attributes.position.needsUpdate = true;
    this.displayGeometry.computeVertexNormals();

    const colorAttr = this.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (colorAttr) {
      syncDisplayAttribute(
        this.displayBinding,
        colorAttr.array as Float32Array,
        3,
        this.displayColors,
      );
      this.displayGeometry.attributes.color.needsUpdate = true;
    }
    syncDisplayAttribute(this.displayBinding, this.pierceAmount, 1, this.displayPierce);
    this.displayGeometry.attributes.aPierce.needsUpdate = true;

    if (!surfaceVisible) {
      return;
    }
    const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;
    syncDisplayPositions(
      this.displaySurfaceBinding,
      surfacePositions,
      this.baseSurfacePositions,
      this.displaySurfacePositions,
    );
    this.displaySurfaceGeometry.attributes.position.needsUpdate = true;
    this.displaySurfaceGeometry.computeVertexNormals();
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
      const livePresence = this.completed ? 0 : this.getQuietLivePresence(_bands);
      const ev = this.completed
        ? { body: 0, crack: 0, phrase: 0, sparkle: 0, listen: 0, busy: 0, thump: 0, ting: 0, chatter: 0 }
        : this.getListeningEventDrive(_bands);
      const pulseRaw =
        this.completed ? 0 : growthPattern(nx, ny, nz, this.formingTime * 1.6) * (
          (ev.thump * 0.48 + ev.ting * 0.18 + ev.chatter * 0.13) *
          t.liveLow *
          (0.018 + livePresence * 0.78)
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
        const rising = Math.abs(pulse) > Math.abs(this.liveOffset[i]);
        // 立ち上がりは俊敏、平常への戻りは速め → 揺れが形を覆い隠さない
        const liveFollow = rising
          ? 6 + this.drumLiveGate * 10
          : 11 + this.drumLiveGate * 6;
        this.liveOffset[i] += (pulse - this.liveOffset[i]) * Math.min(1, deltaTime * liveFollow);
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
      const liveDraw = this.completed ? 1 : this.getLiveDrawScale(_bands);
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
          this.liveOffset[i] * liveDraw * (1 - this.detachmentCarve[i] * 0.88) +
          this.idleWobbleField[i];
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
   * 突き抜け先端の発光だけを足す。透明にすると膜と同じ透明キューに入り、
   * 回転で描画順が入れ替わってフレネルを上書きし「レイヤーが変わった」ように見える。
   */
  private installCorePierceShader(material: THREE.MeshPhysicalMaterial) {
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.depthTest = true;
    material.vertexColors = true;
    material.color.set(0xffffff);
    material.onBeforeCompile = (shader) => {
      // 肌理の uniform はモジュール側のオブジェクトをそのまま差す（dev パネルから直接書ける）
      shader.uniforms.uClayGrain = clayGrainUniforms.uClayGrain;
      shader.uniforms.uClayGrainScale = clayGrainUniforms.uClayGrainScale;
      // 宝石（鉱物）の面。結晶になっている面だけに効く（vita [P2]）。
      for (const [key, value] of Object.entries(gemUniforms)) {
        shader.uniforms[key] = value;
      }

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          attribute float aPierce;
          varying float vPierce;
          ${CLAY_GRAIN_VERTEX_COMMON}
          ${GEM_VERTEX_COMMON}
          `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vPierce = aPierce;
          ${CLAY_GRAIN_VERTEX_MAIN}
          ${GEM_VERTEX_MAIN}
          `,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          /* glsl */ `
          #include <common>
          varying float vPierce;
          ${CLAY_GRAIN_FRAGMENT_COMMON}
          ${GEM_FRAGMENT_COMMON}
          `,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          /* glsl */ `
          #include <roughnessmap_fragment>
          ${GEM_FRAGMENT_ROUGHNESS}
          `,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
          #include <normal_fragment_maps>
          ${CLAY_GRAIN_FRAGMENT_NORMAL}
          ${GEM_FRAGMENT_NORMAL}
          `,
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          /* glsl */ `
          // 接点 = 同じ粘土がわずかに濃く・暖かく（明るくしない）
          float pierceMask = smoothstep(0.34, 0.92, vPierce);
          vec3 flushWarm = mix(diffuse * 0.62, diffuse * vec3(1.06, 0.82, 0.72), 0.45);
          flushWarm = clamp(flushWarm, vec3(0.0), vec3(0.72));
          vec3 pierceTint = mix(diffuse, flushWarm, pierceMask * 0.22);
          vec4 diffuseColor = vec4( pierceTint, opacity );
          ${GEM_FRAGMENT_BODY}
          `,
        )
        .replace(
          "#include <emissivemap_fragment>",
          /* glsl */ `
          #include <emissivemap_fragment>
          // 発光はごく弱い粘土色のみ
          float pierceGlow = smoothstep(0.45, 0.96, vPierce);
          float glowPulse = pierceGlow * pierceGlow;
          totalEmissiveRadiance += diffuse * vec3(1.05, 0.7, 0.55) * glowPulse * 0.1;
          ${GEM_FRAGMENT_EMISSIVE}
          `,
        );
    };
    material.customProgramCacheKey = () => "vita-core-pierce-opaque-v20-live-settle";
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
   * キック／スネアに合わせて膜食い込み（pierce）を直接乗せる。
   * 幾何交差だけだと聴感とずれて感じられないため、ヒット瞬間に接点の熱を立てる。
   */
  private injectMusicPierce(strength: number, mode: "kick" | "snare") {
    if (!this.style.membrane.vita || this.completed || this.shapeHold) {
      return;
    }
    const amount = clamp01(strength);
    if (amount < 0.04) {
      return;
    }

    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;
    const count = Math.min(
      this.pierceAmount.length,
      Math.min(corePositions.length, surfacePositions.length) / 3,
    );
    const mx = this.morphAxis.x;
    const my = this.morphAxis.y;
    const mz = this.morphAxis.z;
    const softGap = 0.42;
    let changed = false;
    let peak = 0;

    for (let i = 0; i < count; i += 1) {
      const index = i * 3;
      const cx = corePositions[index];
      const cy = corePositions[index + 1];
      const cz = corePositions[index + 2];
      const coreRadius = Math.hypot(cx, cy, cz);
      if (coreRadius < 0.0001) {
        continue;
      }
      const sx = surfacePositions[index];
      const sy = surfacePositions[index + 1];
      const sz = surfacePositions[index + 2];
      const surfaceRadius = Math.hypot(sx, sy, sz) || 1;
      const gap = surfaceRadius - coreRadius;

      const bx = this.basePositions[index];
      const by = this.basePositions[index + 1];
      const bz = this.basePositions[index + 2];
      const br = Math.hypot(bx, by, bz) || 1;
      const nx = bx / br;
      const ny = by / br;
      const nz = bz / br;
      const along = nx * mx + ny * my + nz * mz;
      const perp = Math.sqrt(Math.max(0.001, 1 - along * along));
      const grain = growthPattern(nx, ny, nz, this.morphologySeed + (mode === "kick" ? 41.2 : 73.8));
      const grain01 = grain * 0.5 + 0.5;

      // キックは胴・底寄り、スネアは側面・赤道寄り
      const spatial =
        mode === "kick"
          ? smoothstep(-0.85, 0.15, along) * smoothstep(0.95, 0.25, along) * (0.35 + grain01 * 0.65)
          : smoothstep(0.28, 0.92, perp) *
            smoothstep(-0.55, 0.35, along) *
            smoothstep(0.7, 0.1, along) *
            (0.3 + grain01 * 0.7);

      // 膜に近い／すでに食い込んでいる頂点を優先。遠くても弱いフラッシュは許可
      let proximity = 0.18;
      if (gap < 0) {
        proximity = 1;
      } else if (gap < softGap) {
        const t = 1 - gap / softGap;
        proximity = 0.35 + t * t * 0.65;
      }

      const liveBias = clamp01(Math.abs(this.liveOffset[i]) * 4.5 + this.membranePressure[i] * 2.2);
      const target = clamp01(amount * spatial * proximity * (0.55 + liveBias * 0.55));
      if (target < 0.03) {
        continue;
      }

      const next = Math.min(1, Math.max(this.pierceAmount[i], this.pierceAmount[i] * 0.55 + target));
      if (next > this.pierceAmount[i] + 0.01) {
        const delta = next - this.pierceAmount[i];
        this.pierceAmount[i] = next;
        this.membranePressure[i] = Math.min(0.38, this.membranePressure[i] + target * 0.16);
        // 音楽ヒットの食い込みを mid 永久層へ薄く刻む（発光だけで終わらせない）
        this.midBumps[i] = this.accumulateWithMemory(
          this.midBumps[i],
          delta * (mode === "kick" ? 0.028 : 0.022),
          -0.42,
          0.26,
        );
        changed = true;
        peak = Math.max(peak, next);
      }
    }

    if (peak > 0) {
      this.membranePressureImpulse = Math.min(1, this.membranePressureImpulse + amount * 0.65);
    }
    if (changed) {
      const pierceAttr = this.geometry.getAttribute("aPierce");
      if (pierceAttr) {
        pierceAttr.needsUpdate = true;
      }
    }
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
    // キック／スネア直後は食い込み発光を少し長く残す
    const rhythmHold = clamp01(this.kickImpulse * 0.7 + this.snareFlash * 0.55 + this.peakPunch * 0.35);
    const pierceDecay = Math.exp(-(2.4 + (1 - rhythmHold) * 2.2) * deltaTime);
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
      const rhythmBoost = 1 + this.kickImpulse * 0.9 + this.snareFlash * 0.55 + this.peakPunch * 0.35;

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

        // 幾何突き抜け＋リズムで食い込みを強調。接近だけでもヒット直後は弱いフラッシュ
        if (gap < 0) {
          const pierceTarget = Math.min(1, (-gap / 0.1) * 0.95 * rhythmBoost);
          if (pierceTarget > this.pierceAmount[i]) {
            this.pierceAmount[i] += (pierceTarget - this.pierceAmount[i]) * pierceAttack;
          } else {
            this.pierceAmount[i] = Math.max(this.pierceAmount[i] * pierceDecay, pierceTarget);
          }
          pierceChanged = true;
        } else if (rhythmHold > 0.2 && gap < softGap * 0.55) {
          const nearFlush = (1 - gap / (softGap * 0.55)) * rhythmHold * 0.45;
          if (nearFlush > this.pierceAmount[i]) {
            this.pierceAmount[i] += (nearFlush - this.pierceAmount[i]) * pierceAttack * 0.7;
            pierceChanged = true;
          }
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

      // 突き抜けを消さないよう、引き戻しは弱め。ただし膜を大きく突き破ると
      // 回転でフレネル外殻の前後が入れ替わって見えるので、突き出し量に上限を置く
      const membraneInner = Math.max(0.15, surfaceRadius - 0.025);
      const membraneOuterCap = surfaceRadius + (pierce > 0.35 ? 0.045 : 0.012);
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
      } else if (coreRadius > membraneOuterCap) {
        corePositions[index] = nx * membraneOuterCap;
        corePositions[index + 1] = ny * membraneOuterCap;
        corePositions[index + 2] = nz * membraneOuterCap;
        geomChanged = true;
      }

      if (colors) {
        // 接点は粘土色をわずかに濃く・暖かく（明度は上げない）
        const tintStrength = Math.min(1, Math.max(0, (pierce - 0.32) / 0.55) * 0.28);
        if (tintStrength > 0.02) {
          this._tmpColor.setHSL(
            this.clayHueBase,
            Math.min(0.9, this.claySatBase * 1.35 + 0.12),
            Math.max(0.16, Math.min(0.42, this.clayLightBase * 0.55)),
          );
          const br = this.coreColorBase[index];
          const bg = this.coreColorBase[index + 1];
          const bb = this.coreColorBase[index + 2];
          const tr = Math.min(0.72, br * 0.65 + this._tmpColor.r * 0.35);
          const tg = Math.min(0.68, bg * 0.65 + this._tmpColor.g * 0.35);
          const tb = Math.min(0.64, bb * 0.65 + this._tmpColor.b * 0.35);
          colors[index] = br + (tr - br) * tintStrength;
          colors[index + 1] = bg + (tg - bg) * tintStrength;
          colors[index + 2] = bb + (tb - bb) * tintStrength;
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

  /**
   * 膜の折り重なりをほどく。
   *
   * **なぜ要るか**（2026-08-11、[P2] の (1)）:
   * 膜は core と同じ `vectorField` / `flowField` を使う（`vectorScale` 1.04）。
   * これらは接線方向の変位で、1頂点あたり最大 0.92 まで貯まる。
   * 膜の半径 1.46 に対して 6 割を超えるので、隣り合う頂点が別方向へ大きく引かれると
   * **面が交差して、半透明の板が何枚も重なったように見える。**
   * 拡大するとその板の縁が長い直線と鋭い角になっていて、これが
   * 「輪郭が多角形っぽい」の主因だった（解像度不足ではない）。
   *
   * **やり方**: 位置ではなく**変位**を 1-ring 近傍で平均する（ラプラシアン平滑）。
   * 折り重なりは変位場の高周波成分なので、そこだけが落ちて全体の形は残る。
   * 位置を平滑化すると球へ戻ってしまうので、必ず変位側でやること。
   *
   * 近傍は `membraneNeighbors`（接触圧の拡散用に既にある）を使い回す。
   * 1,245 頂点 × 近傍8 × 反復数なので、実測できるコストにはならない。
   */
  private relaxMembraneFolds(positions: Float32Array) {
    const iterations = Math.round(membraneRelax.iterations);
    if (iterations <= 0 || membraneRelax.strength <= 0) {
      return;
    }
    const count = this.accumulated.length;
    const cap = SoundSculpture.membraneNeighborCap;
    const base = this.baseSurfacePositions;
    const src = this.membraneRelaxScratch;
    const strength = membraneRelax.strength;

    // 変位に落とす
    for (let i = 0; i < count * 3; i += 1) {
      src[i] = positions[i] - base[i];
    }

    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < count; i += 1) {
        const index = i * 3;
        const nb = i * cap;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (let k = 0; k < cap; k += 1) {
          const j = this.membraneNeighbors[nb + k];
          if (j < 0) break;
          const jj = j * 3;
          sx += src[jj];
          sy += src[jj + 1];
          sz += src[jj + 2];
          n += 1;
        }
        if (n === 0) {
          positions[index] = base[index] + src[index];
          positions[index + 1] = base[index + 1] + src[index + 1];
          positions[index + 2] = base[index + 2] + src[index + 2];
          continue;
        }
        const inv = 1 / n;
        positions[index] = base[index] + src[index] + (sx * inv - src[index]) * strength;
        positions[index + 1] =
          base[index + 1] + src[index + 1] + (sy * inv - src[index + 1]) * strength;
        positions[index + 2] =
          base[index + 2] + src[index + 2] + (sz * inv - src[index + 2]) * strength;
      }
      if (pass < iterations - 1) {
        for (let i = 0; i < count * 3; i += 1) {
          src[i] = positions[i] - base[i];
        }
      }
    }
  }

  private updateSurfaceGeometry(bands: AudioBands, deltaTime: number) {
    const positions = this.surfaceGeometry.attributes.position.array;
    const t = runtimeTuning;
    const ev = this.completed
      ? { body: 0, crack: 0, phrase: 0, sparkle: 0, listen: 0, busy: 0, thump: 0, ting: 0, chatter: 0 }
      : this.getListeningEventDrive(bands);
    const w = this.getBandLiveWeights(bands);
    const listen = ev.listen;
    const liveDraw = this.completed ? 1 : this.getLiveDrawScale(bands);
    // 表面うねり LIVE: スネア寄りのみ。ギター／ハットは載せない（別表現）
    const midDrive =
      (ev.ting * 0.42 +
        ev.thump * 0.06 +
        w.mid * 0.18 * this.getDrumLiveMul(0.08)) *
      t.liveMid *
      (0.03 + listen * 0.4);
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
      const targetSurfaceLive =
        midDrive * surfacePattern +
        ev.ting * 0.35 * surfacePattern * (0.4 + listen * 0.55);
      if (!this.completed && !this.shapeHold) {
        const rising = Math.abs(targetSurfaceLive) > Math.abs(this.surfaceLiveOffset[i]);
        const follow = rising ? 9 : 14;
        this.surfaceLiveOffset[i] +=
          (targetSurfaceLive - this.surfaceLiveOffset[i]) * Math.min(1, deltaTime * follow);
      }
      const remembered = this.getPermanentScalarDisplacement(i);
      const deformSalt = this.vertexDeformSalt(i, 9.2);
      // ホールド／完成後は midDrive 由来の瞬時オフセットも足さない（形固定）
      const liveSurfaceNudge =
        this.completed || this.shapeHold ? 0 : flow * midDrive * 0.02 * liveDraw;
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
      // 膜のファセットはここでは掛けない（0 で skip）。全頂点を大域平均の面へ寄せると
      // 膜のふくらみが潰れて球になる。膜は最後に applyMembraneFacets で
      // **面ドメインごとの平均**へ寄せる（大きな起伏は保ったまま平らな面＋稜を作る）。
      const warped = this.applyGlobalForm(px, py, pz, deformSalt, 0);
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
        const live = this.surfaceLiveOffset[i] * liveDraw + this.idleWobbleField[i] * 1.18;
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
    this.relaxMembraneFolds(positions as Float32Array);
    // 最後に膜を結晶ファセット化（要求 B: 輪郭を角ばらせる）。relax の後なので稜が残る。
    this.applyMembraneFacets(positions as Float32Array);

    const uniforms = this.surfaceMaterial.uniforms;
    // vita は無音時も膜の模様がゆっくり流れ続ける（idleTime は常に進む）
    uniforms.uTime.value = this.completed
      ? this.frozenTime
      : this.formingTime + (this.style.idleWobble > 0 ? this.idleTime * 0.3 : 0);
    const midFlash = clamp01(this.guitarFlash * 1.05 + this.snareFlash * 0.55);
    const hatTick = clamp01(this.hatFlash * 1.05 + this.hatImpulse * 0.45);
    uniforms.uMelodyLine.value =
      t.membraneLine * (1 + midFlash * 1.65 + this.melodyPhraseImpulse * 0.4);
    uniforms.uMelodyFresnel.value =
      t.membraneFresnel * (1 + midFlash * 0.75 + this.melodyPhraseImpulse * 0.25);
    uniforms.uMelodyNoise.value = t.membraneNoise * (0.85 + midFlash * 0.35);
    uniforms.uMelodyFlowAnim.value = 0.95 + t.liveHigh * 0.7 + midFlash * 0.65;
    // フラッシュ追従を速く（中高音のキレ）
    const midTarget = clamp01(midFlash * 0.95 + bands.mid * 0.12);
    const melTarget = clamp01(
      this.guitarFlash * 0.9 + this.melodyPhraseImpulse * 0.55 + bands.melody * 0.1,
    );
    const highTarget = clamp01(hatTick * 0.85 + bands.high * 0.12);
    uniforms.uMid.value += (midTarget - uniforms.uMid.value) * Math.min(1, deltaTime * 18);
    uniforms.uMelody.value += (melTarget - uniforms.uMelody.value) * Math.min(1, deltaTime * 18);
    uniforms.uHigh.value += (highTarget - uniforms.uHigh.value) * Math.min(1, deltaTime * 20);
    const tension = this.membranePressureImpulse;
    const targetLive = Math.min(1.05, Math.max(0, this.getMembraneLiveTarget(bands) + tension * 0.7));
    const liveRising = targetLive > uniforms.uLive.value;
    uniforms.uLive.value +=
      (targetLive - uniforms.uLive.value) * Math.min(1, deltaTime * (liveRising ? 20 : 10));
    const targetGlow = Math.min(1.2, Math.max(0, this.getMembraneGlowTarget(bands) + tension * 0.9));
    const glowRising = targetGlow > uniforms.uGlow.value;
    uniforms.uGlow.value +=
      (targetGlow - uniforms.uGlow.value) * Math.min(1, deltaTime * (glowRising ? 24 : 8));
    // 外殻の透明感を抑えて「中身が詰まっている」印象に寄せる
    // ※ membraneGain は曲で organic が上がると 10 超になり得る → vita は粘土が見えるよう不透明度を上限する
    const sp = this.getSpecies();
    const stMembrane = this.style.membrane;
    const initialGate = 0.5 + this.formDevelopment * 0.5;
    const rawMembraneOpacity =
      (this.completed
        ? stMembrane.completedOpacity
        : (fibUnit(5, 21) + sp.membraneGain * fibUnit(8, 21) - sp.aggressive * fibUnit(5, 21)) *
          stMembrane.opacityScale) *
        initialGate +
      tension * 0.14;
    // vita の LIVE 上限は 0.46（乳白の膜）／完成は 0.20。**熟成度でその間を連続に降ろす**
    // （[P1] step 3）。以前は完成の瞬間に 0.46 → 0.20 と半分以下に落ちていて、
    // 「LIVE は乳白の生きもの / 完成は磨かれた石」の落差の主因だった。
    // `opacityScale: 1.45` と `completedOpacity: 0.2` は動かしていない。
    const liveOpacityCap = 0.46 + (stMembrane.completedOpacity - 0.46) * this.getMaturity();
    const membraneOpacity = stMembrane.vita
      ? Math.min(
          this.completed ? stMembrane.completedOpacity : liveOpacityCap,
          Math.max(0.1, rawMembraneOpacity),
        )
      : Math.min(0.92, Math.max(0, rawMembraneOpacity));
    const opacityFollow = this.completed
      ? 0.7 + (1 - this.completionSettle) * 1.4
      : fib(3);
    uniforms.uOpacity.value +=
      (membraneOpacity - uniforms.uOpacity.value) * Math.min(1, deltaTime * opacityFollow);
    // 形成中も熟成度ぶんだけ「流れが落ち着く」方向へ（[P1]）。**完成時の半分まで**にして、
    // 残り半分は完成の特権として残す。`freezeTarget` は 0.24 なので LIVE の最大は 0.12。
    const freezeTarget = this.completed
      ? stMembrane.freezeTarget
      : stMembrane.vita
        ? stMembrane.freezeTarget * this.getMaturity() * 0.5
        : 0;
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
    const vertCount = Math.max(1, this.accumulated.length);
    // 最も変形した1点に寄せると「反対側だけ膜が点滅」に見えるので、表面全体へ散らす
    const vert =
      Math.floor(
        seededUnit(index, this.formingTime * 0.41 + bands.high * 3.1 + 1.7) * vertCount,
      ) % vertCount;
    const pIdx = vert * 3;
    const positions = this.geometry.attributes.position.array;
    const bx = this.basePositions[pIdx];
    const by = this.basePositions[pIdx + 1];
    const bz = this.basePositions[pIdx + 2];
    const br = Math.hypot(bx, by, bz) || 1;
    const outward = 0.03 + drive * 0.05;
    const origin = new THREE.Vector3(
      positions[pIdx] + (bx / br) * outward,
      positions[pIdx + 1] + (by / br) * outward,
      positions[pIdx + 2] + (bz / br) * outward,
    );
    this.toAmbientFxWorldPoint(origin);
    const jitter = 0.05 + drive * 0.08;
    this.sparklePositions[idx] = origin.x + (seededUnit(index, this.formingTime + 1.1) - 0.5) * jitter;
    this.sparklePositions[idx + 1] = origin.y + (seededUnit(index, this.formingTime + 2.2) - 0.5) * jitter;
    this.sparklePositions[idx + 2] = origin.z + (seededUnit(index, this.formingTime + 3.3) - 0.5) * jitter;
    this.sparkleLife[index] = 1;
    // 背景の常時きらめく星と見分けがつくよう、発火直後だけ白熱するくらい強く振る
    // （toneMapped:false + 加算合成なので 1.0 を超えると本当に白飛びして「パッと弾ける」）
    const glow = 0.4 + drive * 0.5 + bands.high * 0.15;
    const hot = Math.max(0, drive - 0.35) * 1.4;
    this.sparkleColors[idx] = 0.5 * glow + 0.75 * hot;
    this.sparkleColors[idx + 1] = 0.78 * glow + 0.95 * hot;
    this.sparkleColors[idx + 2] = 0.95 * glow + 1.1 * hot;
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
    const hatTick = this.completed
      ? 0
      : clamp01(this.hatFlash * 1.2 + this.hatImpulse * 0.75);
    if (!this.completed) {
      // 常時 cyan はさらに弱く・まれに。背景の星との違いを「多さ」ではなく
      // ヒット時の弾け方で出す（高音チッチだけ粒子を立てる。中音は膜側）
      this.sparkleEmission += (drive * 0.06 + hatTick * 3.6) * deltaTime * 22;
      let spawned = 0;
      while (this.sparkleEmission >= 1 && spawned < 12) {
        this.spawnSparkle(bands, Math.max(0.35, hatTick * 1.05 + drive * 0.2));
        this.sparkleEmission -= 1;
        spawned += 1;
      }
    }

    // チッチは短く明るく消える（リズムが読める）が、見えないほど短命にはしない
    const decay = this.completed ? 2.8 : 1.5 + hatTick * 0.2;
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
      // 常時分＝控えめな淡いシアン、チッチの瞬間だけ白熱させて星の明滅と区別する
      const ambient = this.sparkleLife[i] * (0.32 + drive * 0.12);
      const hot = this.sparkleLife[i] * hatTick * 1.5;
      this.sparkleColors[idx] = 0.55 * ambient + 0.85 * hot;
      this.sparkleColors[idx + 1] = 0.8 * ambient + 1.05 * hot;
      this.sparkleColors[idx + 2] = 1.0 * ambient + 1.2 * hot;
    }

    const targetOpacity = this.completed ? 0.08 : 0.07 + drive * 0.1 + hatTick * 1.1;
    this.sparkleMaterial.opacity +=
      (targetOpacity - this.sparkleMaterial.opacity) * Math.min(1, deltaTime * 16);
    this.sparkleMaterial.size = 0.032 + drive * 0.018 + hatTick * 0.26;
    // 疑似グロー: 芯より一回り大きく・薄く。ヒット時だけ大きく膨らませて
    // 「弾けた」感じを出す（常時は芯とほぼ同サイズまで縮めて背景の星と混同させない）
    const targetGlowOpacity = this.completed ? 0.03 : 0.02 + drive * 0.04 + hatTick * 0.5;
    this.sparkleGlowMaterial.opacity +=
      (targetGlowOpacity - this.sparkleGlowMaterial.opacity) * Math.min(1, deltaTime * 16);
    this.sparkleGlowMaterial.size = 0.05 + drive * 0.02 + hatTick * 0.55;
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
      // 熟成が進むほど新しい粒の湧きを少しだけ抑える（[P1]。完成で 0.5 秒に消える段差を和らげる）。
      // **チラつきの強さ・吸着済みの粒・スパークル・グローダストは触っていない。**
      const emissionSettle = 1 - this.getMaturity() * 0.3;
      this.particleEmission +=
        (Math.max(0, bands.high - 0.12) * deltaTime * 52 * this.getDetailScale() +
          Math.max(0, bands.melody - 0.1) * deltaTime * 28 * this.getDetailScale() +
          Math.max(0, bands.mid - 0.14) * deltaTime * 16 +
          bands.contrast * deltaTime * 8) *
        emissionSettle;

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
const devAudioRow = document.querySelector<HTMLElement>("#dev-audio-row");
const devAudioTrackSelect = document.querySelector<HTMLSelectElement>("#dev-audio-track");
const beginRecordingButton = document.querySelector<HTMLButtonElement>("#begin-recording");
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
  !beginRecordingButton ||
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
const visualStyleId: VisualStyleId = experience.visualStyleId;
setActiveVisualStyle(visualStyleId);
const visualStyle = getActiveVisualStyle();
const styleEnvActive = true;
const sceneEnv = visualStyle.env;
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
let liveWeatherEnabled = readLiveWeatherEnabled();
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
  liveWeatherInput.checked = liveWeatherEnabled;
}

const devSurface = isDevSurface();
const surfaceBadgeEl = document.querySelector<HTMLElement>("#surface-badge");
const surfaceBadgeLabel = getSurfaceBadgeLabel();
if (surfaceBadgeEl && surfaceBadgeLabel) {
  surfaceBadgeEl.hidden = false;
  surfaceBadgeEl.dataset.surface = getAppSurface();
  surfaceBadgeEl.textContent =
    surfaceBadgeLabel === "DEV"
      ? "DEV — 公開見た目は ?surface=public"
      : "PUBLIC PREVIEW";
}

const experienceStyleField = document.querySelector<HTMLElement>("#experience-style-field");
const growthAlgorithmField = document.querySelector<HTMLElement>("#growth-algorithm-field");
const devTuningGroup = document.querySelector<HTMLElement>("#dev-tuning-group");

if (experienceStyleField) {
  experienceStyleField.hidden = false;
}
if (growthAlgorithmField) {
  growthAlgorithmField.hidden = false;
}
if (devSurface && daytimePreviewRoot) {
  daytimePreviewRoot.hidden = false;
}
if (devSurface && weatherPreviewRoot) {
  weatherPreviewRoot.hidden = false;
}
// vita: DEV 既定を「晴れ・昼〜夕方」に寄せて差し込み光を確認しやすくする
if (devSurface && visualStyleId === "vita") {
  weatherPreviewPreset = "clear";
  daytimePreviewHour = 15.5;
  if (weatherPreviewPresetSelect) {
    weatherPreviewPresetSelect.value = "clear";
  }
  if (daytimePreviewHourInput) {
    daytimePreviewHourInput.value = "15.5";
  }
  if (daytimeBackgroundInput && !daytimeBackgroundEnabled) {
    daytimeBackgroundEnabled = true;
    daytimeBackgroundInput.checked = true;
    writeDaytimeBackgroundEnabled(true);
  }
}
let growthAlgorithmId: GrowthAlgorithmId = parseGrowthAlgorithmId();
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
  growthAlgorithmHint.hidden = false;
  growthAlgorithmHint.textContent = meta.tagline;
};

populateGrowthAlgorithmSelect();
applyGrowthAlgorithmUi(growthAlgorithmId);

if (devSurface && startDevAudioButton) {
  startDevAudioButton.hidden = false;
}

let getSelectedDevAudioUrl: (() => Promise<{ url: string; label: string }>) | null = null;

if (devSurface && startDevAudioButton) {
  void (async () => {
    const {
      DEV_AUDIO_TRACKS,
      resolveInitialDevAudioTrack,
      writeStoredDevAudioTrackId,
      getDevAudioTrackById,
    } = await import("./dev-audio");

    if (devAudioRow) {
      devAudioRow.hidden = DEV_AUDIO_TRACKS.length === 0;
    }
    if (!devAudioTrackSelect) {
      return;
    }

    devAudioTrackSelect.replaceChildren();
    for (const track of DEV_AUDIO_TRACKS) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = track.label;
      devAudioTrackSelect.append(option);
    }

    const initial = resolveInitialDevAudioTrack();
    if (initial) {
      devAudioTrackSelect.value = initial.id;
      writeStoredDevAudioTrackId(initial.id);
    }

    const syncSelectedTrack = () => {
      const track = getDevAudioTrackById(devAudioTrackSelect.value) ?? resolveInitialDevAudioTrack();
      if (!track) {
        return null;
      }
      writeStoredDevAudioTrackId(track.id);
      startDevAudioButton.dataset.statusArmed = `Dev audio (${track.label}) ready — press Start Recording`;
      if (armedAudioSource === "dev" && statusElement && !isAudioReady) {
        setStatus(startDevAudioButton.dataset.statusArmed);
      }
      return track;
    };

    syncSelectedTrack();
    devAudioTrackSelect.addEventListener("change", () => {
      syncSelectedTrack();
    });

    getSelectedDevAudioUrl = async () => {
      const track = syncSelectedTrack();
      if (!track) {
        throw new Error("開発用音源がありません（src/music を確認してください）");
      }
      return { url: track.url, label: track.label };
    };
  })();
}

if (devSurface && bandTestPanel) {
  bandTestPanel.hidden = false;
}

if (devSurface) {
  if (devTuningGroup) {
    devTuningGroup.hidden = false;
  }
  document.querySelectorAll<HTMLElement>(".audio-scope, .tuning-export").forEach((element) => {
    element.hidden = false;
  });
} else if (devTuningGroup) {
  devTuningGroup.hidden = true;
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
  appElement.classList.toggle("mode-classic", true);
  appElement.classList.toggle("style-metamorphosis", entry.visualStyleId === "metamorphosis");
  appElement.classList.toggle("style-vita", entry.visualStyleId === "vita");
  appElement.classList.toggle("style-monolith", entry.visualStyleId === "monolith");
  appElement.classList.toggle("style-dither", entry.visualStyleId === "dither");
  appElement.classList.toggle("style-lumen", entry.visualStyleId === "lumen");
  if (entry.visualStyleId === "dither") {
    appElement.classList.toggle("theme-dark", false);
  } else if (!daytimeBackgroundEnabled) {
    appElement.classList.toggle("theme-dark", styleEnvActive && visualStyle.themeDark);
  }

  if (entry.id === "vita") {
    document.title = "Sound Sculpture — 生命";
  } else if (entry.id === "monolith") {
    document.title = "Sound Sculpture — 彫刻";
  } else if (entry.id === "metamorphosis") {
    document.title = "Sound Sculpture — 変容";
  } else if (entry.id === "dither") {
    document.title = "Sound Sculpture — 網点";
  } else if (entry.id === "lumen") {
    document.title = "Sound Sculpture — 発光";
  } else {
    document.title = "Sound Sculpture";
  }

  const introTitleEl = document.querySelector<HTMLElement>("#intro-title");
  const introDescEl = document.querySelector<HTMLElement>("#intro-description");
  const introDescJaEl = document.querySelector<HTMLElement>("#intro-description-ja");
  if (introTitleEl) introTitleEl.textContent = entry.introTitle;
  if (introDescEl && entry.introDescriptionEn) {
    introDescEl.textContent = entry.introDescriptionEn;
  }
  if (introDescJaEl) {
    // index.html と同じ <br> 改行を維持（改行なしテキストで縦書きが崩れるのを防ぐ）
    introDescJaEl.innerHTML =
      entry.introDescription === SHARED_INTRO.description
        ? SHARED_INTRO.descriptionHtml
        : entry.introDescription
            .trim()
            .split(/\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("<br>\n");
  }
};

const populateExperienceSelect = () => {
  experienceStyleSelect.innerHTML = "";
  const catalog = devSurface ? EXPERIENCE_CATALOG : PUBLIC_EXPERIENCE_CATALOG;
  for (const entry of catalog) {
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
  const catalog = devSurface ? EXPERIENCE_CATALOG : PUBLIC_EXPERIENCE_CATALOG;
  if (!catalog.some((entry) => entry.id === nextId)) {
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
    controlPanel.style.removeProperty("clip-path");
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

/** Settings など details 開閉で高さが変わったとき、画面内に収めつつスクロール可能にする */
const clampControlPanelAfterLayoutChange = () => {
  if (controlPanelShell.classList.contains("is-collapsed")) {
    return;
  }
  const rect = controlPanelShell.getBoundingClientRect();
  applyControlPanelPosition({ left: rect.left, top: rect.top });
  if (!controlPanelDragged) {
    syncToggleToPanel(false);
  }
};

controlPanel.querySelectorAll<HTMLDetailsElement>("details.control-group").forEach((details) => {
  details.addEventListener("toggle", () => {
    requestAnimationFrame(() => {
      clampControlPanelAfterLayoutChange();
    });
  });
});

controlPanel.addEventListener(
  "wheel",
  (event) => {
    event.stopPropagation();
  },
  { passive: true },
);

const openControlPanel = () => {
  controlPanelDragged = false;
  controlPanelShell.classList.remove("is-collapsed");

  // トグルの現在位置（初期は画面下中央）の直上から開く
  const placePanel = () => {
    positionPanelRelativeToToggle();
  };

  placePanel();
  playControlPanelOpenAnimation();

  requestAnimationFrame(() => {
    placePanel();
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

const resetPanelToggleToDock = () => {
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
};

toggleControlPanelButton.addEventListener("click", () => {
  if (suppressPanelToggleClick) {
    suppressPanelToggleClick = false;
    return;
  }
  // ダブルクリック / ダブルタップと単クリックを切り分ける。
  if (panelToggleClickTimer !== null) {
    window.clearTimeout(panelToggleClickTimer);
    panelToggleClickTimer = null;
    resetPanelToggleToDock();
    return;
  }

  const willOpen = controlPanelShell.classList.contains("is-collapsed");

  panelToggleClickTimer = window.setTimeout(() => {
    panelToggleClickTimer = null;
    if (willOpen) {
      openControlPanel();
    } else {
      void closeControlPanel();
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
  resetPanelToggleToDock();
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
if (daytimeBackgroundEnabled && visualStyleId !== "dither") {
  themeDarkActive = (
    daytimePreviewHour === null
      ? sampleDaytimeAtmosphere(new Date(), DEFAULT_DAYTIME_LOCATION)
      : sampleDaytimeAtmosphereFromHour(daytimePreviewHour, DEFAULT_DAYTIME_LOCATION)
  ).dark;
  appElement.classList.toggle("theme-dark", themeDarkActive);
}
if (visualStyleId === "dither") {
  // 網点は時間帯で UI / 背景を沈めない
  themeDarkActive = false;
  appElement.classList.toggle("theme-dark", false);
}

const sceneBackground = new SceneBackground(sceneEnv, themeDarkActive);
sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, 0);
sceneBackground.addToScene(scene);

const syncSceneFog = () => {
  sceneBackground.syncFog(scene, scene.background as THREE.Color, themeDarkActive);
};

syncSceneFog();

const ditherStyle = visualStyleId === "dither";
const lumenStyle = visualStyleId === "lumen";
const vitaStyle = visualStyleId === "vita";
const aetherStyle = visualStyleId === "aether";
/**
 * 日中天候システムに背景色を決めさせないスタイル。
 * - vita: 深海・差し込み光を自前で持つ
 * - aether: 参考動画がフラットな淡ミント一色なので、時刻で色が変わると目標から外れる
 *   （実測: これが無いと 16:39 の空色が乗って暗い灰褐色の背景になっていた）
 */
const vitaAtmosphere = vitaStyle || aetherStyle;
const cameraAspect = window.innerWidth / Math.max(1, window.innerHeight);
const orthoHalf = 3.15;
const BASE_CAMERA_FOV = 36;
/** 短辺がこの px のとき見た目スケール 1。小さい窓ではオブジェクトを小さく、大きい窓では大きく */
const VIEW_FIT_REFERENCE_PX = 960;
const getViewportFitScale = () =>
  THREE.MathUtils.clamp(
    Math.min(window.innerWidth, window.innerHeight) / VIEW_FIT_REFERENCE_PX,
    0.52,
    1.18,
  );
const initialViewFit = getViewportFitScale();
const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = ditherStyle
  ? new THREE.OrthographicCamera(
      -(orthoHalf / initialViewFit) * cameraAspect,
      (orthoHalf / initialViewFit) * cameraAspect,
      orthoHalf / initialViewFit,
      -(orthoHalf / initialViewFit),
      0.1,
      sceneEnv.cameraFar ?? 100,
    )
  : new THREE.PerspectiveCamera(
      BASE_CAMERA_FOV / initialViewFit,
      cameraAspect,
      0.1,
      sceneEnv.cameraFar ?? 100,
    );
// 正投影は真正面寄りにして 2D グラフィックに見せる
camera.position.set(0, ditherStyle ? 0 : lumenStyle ? 0.12 : 0.28, ditherStyle ? 8 : lumenStyle ? 5.6 : 6.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !ditherStyle,
  alpha: false,
});
renderer.setPixelRatio(
  ditherStyle ? 1 : lumenStyle ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2),
);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(scene.background as THREE.Color);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = ditherStyle ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = ditherStyle ? 1 : sceneEnv.exposure;
renderer.shadowMap.enabled = !ditherStyle && !lumenStyle;
// VSM は回転時に自己影が飛んで急に暗くなることがあるため、PCF Soft を使う
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ditherPass = ditherStyle
  ? (() => {
      const bufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(bufferSize);
      return new OrderedDitherPass(bufferSize.x, bufferSize.y);
    })()
  : null;

// vita: 明るく振り切った部分（粒子のヒット・膜のきらめき等）だけがふわっと滲む
// 自前の軽量ブルーム。renderer.render() を素通しする通常の描画は一切変えず、
// その後に加算合成のオーバーレイを重ねるだけ（詳細は bloom-pass.ts のコメント参照）。
const bloomPass = vitaStyle
  ? (() => {
      const bufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(bufferSize);
      return new SimpleBloomPass(bufferSize.x, bufferSize.y);
    })()
  : null;

if (ditherStyle) {
  scene.fog = null;
  sceneBackground.setGraphicVoid(true);
}

// aether: 参考動画の背景は「グラデーションのない淡ミント一色」。
// ドームの空グラデーションとフォグが乗ると目標から外れるので、dither と同じく素の背景にする。
if (aetherStyle) {
  scene.fog = null;
  sceneBackground.setGraphicVoid(true);
}

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
  experience.sculptureMode === "lumen"
    ? new LumenSculpture()
    : experience.sculptureMode === "volume"
      ? new VolumeSculpture()
      : experience.sculptureMode === "aether"
        ? new AetherSculpture()
        : new SoundSculpture();
scene.add(sculpture.group);

// vita: 暗い自作の深海環境を「彫刻のマテリアルにだけ」映す。
// scene.environment には入れない（背景ドーム・床など彫刻以外にも一律にかかるため）。
// 明るい RoomEnvironment を scene.environment に入れて画面全体が白く洗われた失敗の
// 再発防止でもある（docs/handoff/VITA.md 5章）。
const abyssEnvironment = sceneEnv.abyssEnvironment ? createAbyssEnvironment(renderer) : null;
let abyssEnvEnabled = abyssEnvironment !== null;
let abyssEnvIntensity = sceneEnv.envMapIntensity ?? DEFAULT_ABYSS_ENV_INTENSITY;

const applyAbyssEnvironment = () => {
  if (!abyssEnvironment) return;
  const nextMap = abyssEnvEnabled ? abyssEnvironment : null;
  sculpture.group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      // 膜（ShaderMaterial）や粒子（PointsMaterial）には envMapIntensity が無い
      if (!("envMapIntensity" in material)) continue;
      const standard = material as THREE.MeshStandardMaterial;
      // envMap の有無はシェーダーチャンクの出し分けなので、変わったときだけ再コンパイルさせる
      if (standard.envMap !== nextMap) {
        standard.envMap = nextMap;
        standard.needsUpdate = true;
      }
      standard.envMapIntensity = abyssEnvIntensity;
    }
  });
};
applyAbyssEnvironment();

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
  // intro / hud-left-stack と同じ左インセットに揃える
  const introEl = document.querySelector<HTMLElement>(".intro");
  const leftStackEl = document.querySelector<HTMLElement>(".hud-left-stack");
  const alignedLeft =
    introEl?.getBoundingClientRect().left ??
    leftStackEl?.getBoundingClientRect().left ??
    clamp(window.innerWidth * 0.045, 1.5 * rem, 3.2 * rem);
  const height = sculptureStickEl.offsetHeight;
  const introBottom = introEl?.getBoundingClientRect().bottom ?? 0;
  const stackTop =
    leftStackEl?.getBoundingClientRect().top ?? window.innerHeight;

  // SP のみ: hud-left-stack の少し上。PC は header と左下 HUD のあいだ中央
  const isSpLayout = window.matchMedia("(max-width: 768px)").matches;
  if (isSpLayout) {
    const gap = Math.max(0.7 * rem, 12);
    const preferredTop = stackTop - height - gap;
    return {
      left: alignedLeft,
      top: clamp(
        preferredTop,
        introBottom + Math.max(0.45 * rem, 8),
        Math.max(introBottom + 4, window.innerHeight - height - 12),
      ),
    };
  }

  const gap = Math.max(1.15 * rem, 20);
  const minTop = introBottom + gap;
  const maxTop = stackTop - height - gap;
  let top: number;
  if (maxTop >= minTop) {
    top = (minTop + maxTop) * 0.5;
  } else {
    const tightGap = Math.max(0.55 * rem, 10);
    const tightMin = introBottom + tightGap;
    const tightMax = stackTop - height - tightGap;
    top =
      tightMax >= tightMin
        ? (tightMin + tightMax) * 0.5
        : clamp(
            (introBottom + stackTop) * 0.5 - height * 0.5,
            introBottom + 4,
            Math.max(introBottom + 4, stackTop - height - 4),
          );
  }
  return {
    left: alignedLeft,
    top,
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

const SCULPTURE_STICK_DOUBLE_TAP_MS = 320;
const SCULPTURE_STICK_TAP_MOVE_PX = 10;
let sculptureStickLastTapAt = 0;
let sculptureStickTapCandidate = false;
let sculptureStickTapOriginX = 0;
let sculptureStickTapOriginY = 0;

const resetSculptureStickToDock = () => {
  releaseSculptureStick();
  if (sculptureStickMove.active) {
    sculptureStickMove.active = false;
    sculptureStickMove.id = null;
    sculptureStickEl?.classList.remove("is-moving");
  }
  sculptureStickUserMoved = false;
  sculptureStickLastTapAt = 0;
  sculptureStickTapCandidate = false;
  dockSculptureStick({ force: true, animate: true });
  resetSculptureViewOrientation();
};

const noteSculptureStickTap = () => {
  const now = performance.now();
  if (now - sculptureStickLastTapAt <= SCULPTURE_STICK_DOUBLE_TAP_MS) {
    resetSculptureStickToDock();
    return;
  }
  sculptureStickLastTapAt = now;
};

if (sculptureStickHandleEl && sculptureStickEl) {
  let handleDragMoved = false;

  sculptureStickHandleEl.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    releaseSculptureStick();
    handleDragMoved = false;
    sculptureStickMove.active = true;
    sculptureStickMove.id = event.pointerId;
    sculptureStickMove.startX = event.clientX;
    sculptureStickMove.startY = event.clientY;
    const rect = sculptureStickEl.getBoundingClientRect();
    sculptureStickMove.originLeft = rect.left;
    sculptureStickMove.originTop = rect.top;
    sculptureStickHandleEl.setPointerCapture(event.pointerId);
    sculptureStickEl.classList.add("is-moving");
  });

  sculptureStickHandleEl.addEventListener("pointermove", (event: PointerEvent) => {
    if (!sculptureStickMove.active || sculptureStickMove.id !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - sculptureStickMove.startX;
    const dy = event.clientY - sculptureStickMove.startY;
    if (!handleDragMoved && Math.hypot(dx, dy) > SCULPTURE_STICK_TAP_MOVE_PX) {
      handleDragMoved = true;
      sculptureStickUserMoved = true;
    }
    if (!handleDragMoved) return;
    applySculptureStickPosition(
      sculptureStickMove.originLeft + dx,
      sculptureStickMove.originTop + dy,
    );
  });

  const endSculptureStickMove = (event: PointerEvent) => {
    if (sculptureStickMove.id !== event.pointerId) return;
    sculptureStickMove.active = false;
    sculptureStickMove.id = null;
    sculptureStickEl.classList.remove("is-moving");
    if (!handleDragMoved) {
      noteSculptureStickTap();
    }
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
  sculptureStickTapCandidate = true;
  sculptureStickTapOriginX = event.clientX;
  sculptureStickTapOriginY = event.clientY;
  sculptureStickEl.setPointerCapture(event.pointerId);
  sculptureStickEl.classList.add("is-active");
  isViewInteracting = true;
  setSculptureStickFromPointer(event.clientX, event.clientY);
});

sculptureStickEl?.addEventListener("pointermove", (event: PointerEvent) => {
  if (!sculptureStick.active || sculptureStick.id !== event.pointerId) return;
  event.preventDefault();
  if (
    sculptureStickTapCandidate &&
    Math.hypot(
      event.clientX - sculptureStickTapOriginX,
      event.clientY - sculptureStickTapOriginY,
    ) > SCULPTURE_STICK_TAP_MOVE_PX
  ) {
    sculptureStickTapCandidate = false;
  }
  setSculptureStickFromPointer(event.clientX, event.clientY);
});

sculptureStickEl?.addEventListener("pointerup", (event: PointerEvent) => {
  if (sculptureStick.id !== event.pointerId) return;
  const wasTap = sculptureStickTapCandidate;
  releaseSculptureStick();
  sculptureStickTapCandidate = false;
  if (wasTap) {
    noteSculptureStickTap();
  }
});

sculptureStickEl?.addEventListener("pointercancel", () => {
  sculptureStickTapCandidate = false;
  releaseSculptureStick();
});
sculptureStickEl?.addEventListener("lostpointercapture", () => {
  if (!sculptureStick.active) return;
  sculptureStickTapCandidate = false;
  releaseSculptureStick();
});

sculptureStickEl?.addEventListener("dblclick", (event) => {
  event.preventDefault();
  event.stopPropagation();
  resetSculptureStickToDock();
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
  if (ditherPass) {
    ditherPass.cyclePalette();
  }
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
keyLight.castShadow = !!(sceneEnv.pedestal || sceneEnv.spotlight);
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 22;
keyLight.shadow.camera.left = -9;
keyLight.shadow.camera.right = 9;
keyLight.shadow.camera.top = 9;
keyLight.shadow.camera.bottom = -9;
keyLight.shadow.radius = 8;
keyLight.shadow.blurSamples = 12;
keyLight.shadow.bias = -0.0002;
keyLight.shadow.normalBias = 0.035;
lightRig.add(keyLight);
lightRig.add(keyLight.target);

const fillLight = new THREE.DirectionalLight(sceneEnv.fillColor ?? 0xe8f0ff, sceneEnv.fill);
fillLight.position.set(-3.2, 4.8, 2.6);
lightRig.add(fillLight);

// 反対側からの弱いフィルで陰影を広げ、全体に広がりを出す
const softFillLight = new THREE.DirectionalLight(sceneEnv.fillColor ?? 0xe8f0ff, sceneEnv.fill * 0.85);
softFillLight.position.set(2.4, 3.8, -3.6);
lightRig.add(softFillLight);

const ambientLight = new THREE.HemisphereLight(
  0xffffff,
  sceneEnv.hemisphereGround ?? 0xd6d0c6,
  sceneEnv.ambient,
);
lightRig.add(ambientLight);

const rimLight = new THREE.DirectionalLight(
  sceneEnv.rimLightColor ?? 0x6ec8ff,
  sceneEnv.rimLightIntensity ?? 0,
);
rimLight.position.set(-1.2, 2.8, -5.5);
lightRig.add(rimLight);

/** DEV パネルで上書きする光源パラメータ（初期値はスタイル env） */
const createLightDevFromStyle = () => ({
  key: sceneEnv.key,
  keyComplete: sceneEnv.keyComplete,
  fill: sceneEnv.fill,
  fillComplete: sceneEnv.fillComplete,
  softFill: sceneEnv.fill * 0.85,
  softFillComplete: sceneEnv.fillComplete * 0.85,
  ambient: sceneEnv.ambient,
  ambientComplete: sceneEnv.ambientComplete,
  rim: sceneEnv.rimLightIntensity ?? 0,
  rimComplete: (sceneEnv.rimLightIntensity ?? 0) * 0.85,
  exposure: sceneEnv.exposure,
  elevationDeg: vitaAtmosphere ? 68 : 72,
  sideDeg: vitaAtmosphere ? 12 : 18,
});
let lightDev = createLightDevFromStyle();
const abyssShaftDir = new THREE.Vector3(0.12, 0.96, 0.18);

// dither: 陰影はマットシェーダ側。シーンライトは消して 3D 感を出さない
if (ditherStyle) {
  lightRig.visible = false;
}

// lumen: マゼンタ寄りの弱いフィルで輪郭を拾う（加算白飛びはさせない）
if (lumenStyle) {
  keyLight.intensity *= 0.7;
  fillLight.color.setHex(0xb04888);
  fillLight.intensity *= 1.05;
  ambientLight.intensity *= 0.8;
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
      setStatus(`Band test: ${label}`);
    });
    setStatus("Band test done — check meters and solo");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to play test tones";
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
const hudLocalTimeFieldEl = document.querySelector<HTMLElement>("#hud-local-time-field");
const hudDateFieldEl = document.querySelector<HTMLElement>("#hud-date-field");
const hudWeatherFieldEl = document.querySelector<HTMLElement>("#hud-weather-field");
const hudTimecodeEl = document.querySelector<HTMLElement>("#hud-timecode");
const hudBpmEl = document.querySelector<HTMLElement>("#hud-bpm");
const hudStyleEl = document.querySelector<HTMLElement>("#hud-style");
const hudAlgoEl = document.querySelector<HTMLElement>("#hud-algo");
const hudScopeEl = document.querySelector<HTMLElement>("#hud-scope");
const hudTicksEl = document.querySelector<HTMLElement>("#hud-ticks");
const hudTicksXEl = document.querySelector<HTMLElement>("#hud-ticks-x");

if (hudStyleEl) {
  hudStyleEl.textContent = experienceId.toUpperCase();
}
if (hudAlgoEl) {
  hudAlgoEl.textContent = growthAlgorithmId.toUpperCase();
}

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
    rhythmEvents.pulseEnvelope * 0.55 +
      rhythmEvents.kickRing * 0.45 +
      rhythmEvents.snareRing * 0.28 +
      rhythmEvents.hatRing * 0.22 +
      rhythmEvents.waveEnergy * 0.35 +
      bands.overall * 0.3,
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
  const debugH = isDevSurface() ? 28 : 0;
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

  if (rhythmEvents.kick > 0 || rhythmEvents.kickRing > 0.08) {
    ctx.fillStyle = "rgba(61,124,255,0.62)";
    const kickW = Math.min(
      w,
      18 + Math.max(rhythmEvents.kick, rhythmEvents.kickRing) * 140 * (0.7 + clamp01(rhythmEvents.kickLength / 0.3) * 0.6),
    );
    ctx.fillRect(0, 0, kickW, scopeH);
  }
  if (rhythmEvents.snare > 0 || rhythmEvents.snareRing > 0.08) {
    ctx.fillStyle = "rgba(255,140,90,0.4)";
    const snareW = Math.min(w * 0.45, 10 + Math.max(rhythmEvents.snare, rhythmEvents.snareRing) * 90);
    ctx.fillRect(w * 0.5 - snareW * 0.5, 0, snareW, scopeH);
  }
  if (rhythmEvents.hat > 0 || rhythmEvents.hatRing > 0.08) {
    ctx.fillStyle = "rgba(136,204,255,0.45)";
    const hatW = Math.min(
      w,
      12 + Math.max(rhythmEvents.hat, rhythmEvents.hatRing) * 90 * (0.65 + clamp01(rhythmEvents.hatLength / 0.25) * 0.7),
    );
    ctx.fillRect(w - hatW, 0, hatW, scopeH);
  }
  if (rhythmEvents.transient > 0) {
    ctx.fillStyle = "rgba(255,220,120,0.35)";
    ctx.fillRect(w * 0.5 - 8, 0, 16 + rhythmEvents.transient * 60, scopeH);
  }

  if (isDevSurface()) {
    const y = scopeH + meterH + 2;
    ctx.fillStyle = "#8a857b";
    ctx.font = "9px ui-monospace, monospace";
    const pulseBarW = Math.max(2, rhythmEvents.pulseConfidence * 42);
    const envBarW = Math.max(2, rhythmEvents.pulseEnvelope * 42);
    ctx.fillText(
      `pulse #${rhythmEvents.pulseIndex} ${rhythmEvents.pulsePhase.toFixed(2)} conf ${rhythmEvents.pulseConfidence.toFixed(2)} env ${rhythmEvents.pulseEnvelope.toFixed(2)} | k${rhythmEvents.kickLength.toFixed(2)}s s${rhythmEvents.snareLength.toFixed(2)}s h${rhythmEvents.hatLength.toFixed(2)}s`,
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
  setStatus("Growth algorithm changed — ready to form again");
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
  const previousValue = audioInputSelect.value;
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
      if (!device.deviceId) {
        continue;
      }
      // HTML 側の「既定の入力」と重複する default はスキップ
      if (device.deviceId === "default") {
        if (device.label && defaultOption) {
          defaultOption.textContent = device.label;
        }
        continue;
      }
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Audio input (${device.deviceId.slice(0, 6)}...)`;
      audioInputSelect.appendChild(option);
    }
  } catch (error) {
    console.error(error);
  }

  if ([...audioInputSelect.options].some((option) => option.value === previousValue)) {
    audioInputSelect.value = previousValue;
  }
};

let micPermissionGranted = false;
let micPermissionRequest: Promise<boolean> | null = null;

/**
 * マイク権限取得を最優先する。
 * getUserMedia はユーザー操作の同一ターンで呼び出すこと（setTimeout 後だとブロックされる）。
 */
const ensureMicPermission = (): Promise<boolean> => {
  if (micPermissionGranted) {
    return Promise.resolve(true);
  }
  if (micPermissionRequest) {
    return micPermissionRequest;
  }

  micPermissionRequest = (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      stream.getTracks().forEach((track) => track.stop());
      micPermissionGranted = true;
      await populateAudioDevices();
      return true;
    } catch (error) {
      console.error(error);
      micPermissionRequest = null;
      await populateAudioDevices();
      return false;
    }
  })();

  return micPermissionRequest;
};

refreshAudioDevicesButton.addEventListener("click", async () => {
  setStatus("Requesting microphone access…");
  const ok = await ensureMicPermission();
  setStatus(
    ok
      ? (refreshAudioDevicesButton.dataset.statusSuccess ?? "")
      : (refreshAudioDevicesButton.dataset.statusError ?? "Microphone permission denied"),
  );
});

// 権限なしの仮一覧だけ先に出しておく（本一覧はユーザー操作後）
void populateAudioDevices();

// --- 完成時の環境クロスフェード（背景・ライト・スポットライト） ---
let envMix = 0;
const envBackgroundForming = new THREE.Color(sceneEnv.background);
const envBackgroundComplete = new THREE.Color(sceneEnv.backgroundComplete);
const lightningFlashColor = new THREE.Color(0xd6e6ff);
const envLerp = (from: number, to: number) => from + (to - from) * envMix;
let lastLocalTimeLabel = "";
const daytimeZenithColor = new THREE.Color();
const daytimeHorizonColor = new THREE.Color();
const daytimeZenithFlashColor = new THREE.Color();
const daytimeHorizonFlashColor = new THREE.Color();
let daytimeSkyActive = false;
/** 時刻プレビュー／実時刻から得た Kelvin ライティング状態 */
let activeDaytimeLook: DaytimeAtmosphere | null = null;

const getActiveDaytimeHour = () =>
  daytimePreviewHour === null ? getLocalHourFraction() : daytimePreviewHour;

/** 天気／位置情報から昼光計算用の緯度経度を取る */
const getActiveDaytimeLocation = () => {
  const weather = getActiveWeatherSnapshot();
  if (
    weather &&
    Number.isFinite(weather.latitude) &&
    Number.isFinite(weather.longitude)
  ) {
    return { latitude: weather.latitude, longitude: weather.longitude };
  }
  return DEFAULT_DAYTIME_LOCATION;
};

const sampleActiveDaytimeAtmosphere = (hour = getActiveDaytimeHour()) =>
  sampleDaytimeAtmosphereFromHour(hour, getActiveDaytimeLocation());

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
  if (!hudWeatherFieldEl) {
    return;
  }
  const wasHidden = hudWeatherFieldEl.hidden;
  hudWeatherFieldEl.hidden = !liveWeatherEnabled;
  if (!liveWeatherEnabled) {
    hudWeatherFieldEl.textContent = "---";
  } else {
    const active = getActiveWeatherSnapshot();
    const prefix =
      isDevSurface() && weatherPreviewPreset !== "live" ? "DEV/" : "";
    hudWeatherFieldEl.textContent = active
      ? formatWeatherHudLabel(active, prefix)
      : "...";
  }
  if (wasHidden !== hudWeatherFieldEl.hidden) {
    dockSculptureStick();
  }
};

const getActiveWeatherSnapshot = (): LiveWeatherSnapshot | null => {
  if (isDevSurface() && weatherPreviewPreset !== "live") {
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
  (isDevSurface() && weatherPreviewPreset !== "live") || liveWeatherEnabled;

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
      fogIntensity: 0,
      lightningIntensity: 0,
    };
  }
  const isFog = snapshot.condition === "fog";
  const fogIntensity = isFog
    ? 1
    : snapshot.condition === "overcast"
      ? 0.28
      : snapshot.cloudCover > 0.85
        ? 0.18
        : 0;
  const fogBoost =
    1 +
    snapshot.cloudCover * 0.45 +
    snapshot.rainIntensity * 0.55 +
    (isFog ? 3.2 : 0) +
    snapshot.lightningIntensity * 0.2;
  // 強風時は雲を足して、風の強さが背景でも分かるようにする
  const windCloudBoost =
    snapshot.windStrength > 0.5 ? (snapshot.windStrength - 0.5) * 0.85 : 0;
  const cloudCover = Math.min(1, snapshot.cloudCover + windCloudBoost);
  return {
    enabled: true,
    cloudCover,
    rainIntensity: snapshot.rainIntensity,
    windStrength: snapshot.windStrength,
    windX: snapshot.windX,
    windZ: snapshot.windZ,
    snow: snapshot.condition === "snow",
    fogBoost,
    fogIntensity,
    lightningIntensity: snapshot.lightningIntensity,
  };
};

const applyLiveWeatherToScene = () => {
  sceneBackground.setWeather(snapshotToSceneWeather(getActiveWeatherSnapshot()));
  updateWeatherHud();
  sculpture.applyWeatherClayTint?.(getActiveWeatherSnapshot(), getActiveDaytimeHour());
};

const tintHexWithClouds = (hex: number, cloudCover: number) => {
  const active = getActiveWeatherSnapshot();
  if (!isWeatherFxActive() || !active || cloudCover < 0.05) {
    return hex;
  }
  return applyCloudCoverToSky(hex, hex, cloudCover).zenith;
};

const clearDaytimeUiTokens = () => {
  for (const key of [
    "--daytime-bg",
    "--ui-ink",
    "--ui-ink-soft",
    "--ui-ink-faint",
    "--ui-panel",
    "--ui-border",
    "--ui-badge-bg",
  ]) {
    appElement.style.removeProperty(key);
  }
};

const applyDaytimeUiTokens = (
  backgroundHex: number,
  sky?: { horizon: number; zenith: number },
) => {
  const tokens = uiTokensFromBackground(backgroundHex, {
    horizonHex: sky?.horizon,
    zenithHex: sky?.zenith,
  });
  appElement.style.setProperty("--daytime-bg", `#${backgroundHex.toString(16).padStart(6, "0")}`);
  appElement.style.setProperty("--ui-ink", tokens.ink);
  appElement.style.setProperty("--ui-ink-soft", tokens.soft);
  appElement.style.setProperty("--ui-ink-faint", tokens.faint);
  appElement.style.setProperty("--ui-panel", tokens.panel);
  appElement.style.setProperty("--ui-border", tokens.border);
  appElement.style.setProperty("--ui-badge-bg", tokens.badgeBg);
  return tokens;
};

const syncDaytimeEnvironmentTargets = () => {
  const activeWeather = getActiveWeatherSnapshot();
  const cloudCover =
    isWeatherFxActive() && activeWeather ? activeWeather.cloudCover : 0;

  // 網点: 夜まで沈めず昼帯のトーンを維持（UI は CSS の multiply+#fff）
  if (ditherStyle) {
    daytimeSkyActive = false;
    activeDaytimeLook = null;
    appElement.classList.remove("daytime-linked");
    clearDaytimeUiTokens();
    appElement.style.removeProperty("--dither-bg");
    const dayLook = sampleActiveDaytimeAtmosphere(
      daytimeBackgroundEnabled ? Math.min(Math.max(getActiveDaytimeHour(), 8), 16) : 11,
    );
    const forming = tintHexWithClouds(dayLook.forming, Math.min(cloudCover, 0.35));
    const complete = tintHexWithClouds(dayLook.complete, Math.min(cloudCover, 0.35));
    envBackgroundForming.setHex(forming);
    envBackgroundComplete.setHex(complete);
    themeDarkActive = false;
    appElement.classList.toggle("theme-dark", false);
    return;
  }

  if (daytimeBackgroundEnabled) {
    const atmosphere = sampleActiveDaytimeAtmosphere();
    activeDaytimeLook = atmosphere;
    const sky = applyCloudCoverToSky(atmosphere.zenith, atmosphere.horizon, cloudCover);
    // vita / aether: 夕焼けの forming（フォグ／クリア色）はオブジェクトを赤くするので使わない。
    // 夕日は abyss ドームの色味だけに載せる。
    const forming = vitaAtmosphere
      ? tintHexWithClouds(sceneEnv.background, cloudCover)
      : tintHexWithClouds(atmosphere.forming, cloudCover);
    const complete = vitaAtmosphere
      ? tintHexWithClouds(sceneEnv.backgroundComplete, cloudCover)
      : tintHexWithClouds(atmosphere.complete, cloudCover);
    envBackgroundForming.setHex(forming);
    envBackgroundComplete.setHex(complete);
    daytimeZenithColor.setHex(sky.zenith);
    daytimeHorizonColor.setHex(sky.horizon);
    daytimeSkyActive = true;
    appElement.classList.add("daytime-linked");
    const ui = applyDaytimeUiTokens(forming, { horizon: sky.horizon, zenith: sky.zenith });
    // 背景輝度に合わせてダーク UI クラスも同期（パネル等のフォールバック用）
    themeDarkActive = ui.darkUi || cloudCover > 0.78;
    appElement.classList.toggle("theme-dark", themeDarkActive);
    return;
  }
  daytimeSkyActive = false;
  activeDaytimeLook = null;
  appElement.classList.remove("daytime-linked");
  clearDaytimeUiTokens();
  envBackgroundForming.setHex(tintHexWithClouds(sceneEnv.background, cloudCover));
  envBackgroundComplete.setHex(tintHexWithClouds(sceneEnv.backgroundComplete, cloudCover));
  const styleDark = styleEnvActive && visualStyle.themeDark;
  themeDarkActive = styleDark || cloudCover > 0.78;
  appElement.classList.toggle("theme-dark", themeDarkActive);
};

const updateLocalClockHud = () => {
  const showDateTime = daytimeBackgroundEnabled;
  const dateWasHidden = hudDateFieldEl?.hidden ?? true;
  const timeWasHidden = hudLocalTimeFieldEl?.hidden ?? true;
  if (hudDateFieldEl) {
    hudDateFieldEl.hidden = !showDateTime;
  }
  if (hudLocalTimeFieldEl) {
    hudLocalTimeFieldEl.hidden = !showDateTime;
  }
  if (
    dateWasHidden !== !showDateTime ||
    timeWasHidden !== !showDateTime
  ) {
    dockSculptureStick();
  }
  if (!showDateTime) {
    return;
  }
  const now = new Date();
  const date = formatLocalDateShort(now);
  const time =
    daytimePreviewHour === null
      ? formatLocalAmPm(now)
      : formatAmPmFromHour(daytimePreviewHour);
  const stamp = `${date}|${time}`;
  if (stamp === lastLocalTimeLabel) {
    return;
  }
  lastLocalTimeLabel = stamp;
  if (hudDateFieldEl) {
    hudDateFieldEl.textContent = date;
  }
  if (hudLocalTimeFieldEl) {
    hudLocalTimeFieldEl.textContent = time;
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
    if (error instanceof GeolocationPermissionDeniedError) {
      liveWeatherEnabled = false;
      writeLiveWeatherEnabled(false);
      if (liveWeatherInput) {
        liveWeatherInput.checked = false;
      }
      stopLiveWeather();
      setLiveWeatherStatus("位置情報が許可されなかったため Match local weather をOFFにしました");
      updateWeatherHud();
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
    case "thunder":
    case "thunderstorm":
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

if (isDevSurface()) {
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
if (liveWeatherEnabled) {
  startLiveWeather();
}
// 日時・天気 HUD の表示後にスティック位置を再計算（header / 左下スタックと被らない帯へ）
requestAnimationFrame(() => {
  dockSculptureStick();
});
(scene.background as THREE.Color).copy(envBackgroundForming);
renderer.setClearColor(scene.background as THREE.Color);
if (daytimeSkyActive) {
  sceneBackground.setDaytimeSky(
    daytimeZenithColor,
    daytimeHorizonColor,
    themeDarkActive,
    0,
    getActiveDaytimeHour(),
  );
} else {
  sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, 0);
  if (vitaAtmosphere) {
    sceneBackground.setAbyssSeaByHour(getActiveDaytimeHour());
  }
}
syncSceneFog();
applyLiveWeatherToScene();

const updateEnvironmentCrossfade = (deltaTime: number) => {
  syncDaytimeEnvironmentTargets();
  // 形成中も熟成度ぶんだけ完成側の環境（背景色・キー/フィル/アンビエント/リム）へ寄せる
  // （[P1] step 4）。**vita 以外は熟成度が 0 を返すので従来どおり完成の瞬間に切り替わる。**
  // 天気・時刻の色は envMix とは別系統なので殺していない。
  const target = isComplete
    ? 1
    : (sculpture as { getMaturity?: () => number }).getMaturity?.() ?? 0;
  const seconds = styleEnvActive ? Math.max(1, visualStyle.completion.seconds * 0.7) : 1;
  const rate = isComplete ? 1 / seconds : 2.4;
  envMix += (target - envMix) * Math.min(1, deltaTime * rate * 3);
  (scene.background as THREE.Color)
    .copy(envBackgroundForming)
    .lerp(envBackgroundComplete, envMix);
  const lightningFlash = sceneBackground.getLightningFlash();
  if (lightningFlash > 0.01) {
    (scene.background as THREE.Color).lerp(lightningFlashColor, Math.min(1, lightningFlash * 0.92));
  }
  renderer.setClearColor(scene.background as THREE.Color);
  const seaHour = getActiveDaytimeHour();
  if (daytimeSkyActive) {
    sceneBackground.setDaytimeSky(
      daytimeZenithColor,
      daytimeHorizonColor,
      themeDarkActive,
      envMix,
      seaHour,
    );
  } else {
    sceneBackground.setFromBackground(scene.background as THREE.Color, themeDarkActive, envMix);
    if (vitaAtmosphere) {
      sceneBackground.setAbyssSeaByHour(seaHour);
    }
  }
  // 雷の瞬間はドーム側もフラッシュ色を重ねる
  if (lightningFlash > 0.01 && daytimeSkyActive) {
    daytimeZenithFlashColor.copy(daytimeZenithColor).lerp(lightningFlashColor, lightningFlash * 0.9);
    daytimeHorizonFlashColor.copy(daytimeHorizonColor).lerp(lightningFlashColor, lightningFlash * 0.75);
    sceneBackground.setDaytimeSky(
      daytimeZenithFlashColor,
      daytimeHorizonFlashColor,
      themeDarkActive,
      envMix,
      seaHour,
    );
  }
  sculpture.applyWeatherClayTint?.(getActiveWeatherSnapshot(), seaHour);
  syncSceneFog();
  const baseKey = envLerp(lightDev.key, lightDev.keyComplete);
  const baseFill = envLerp(lightDev.fill, lightDev.fillComplete);
  const baseAmbient = envLerp(lightDev.ambient, lightDev.ambientComplete);
  const baseSoftFill = envLerp(lightDev.softFill, lightDev.softFillComplete);
  const baseRim = envLerp(lightDev.rim, lightDev.rimComplete);

  if (daytimeSkyActive && activeDaytimeLook) {
    const li = activeDaytimeLook.lightIntensity;
    const weather = getActiveWeatherSnapshot();
    const cloud = weather?.cloudCover ?? 0;
    const clearFactor = THREE.MathUtils.clamp(1 - cloud * 1.15, 0.15, 1);
    const hour = activeDaytimeLook.hour;
    // 昼〜夕方（概ね 11〜18時）で差し込みを強める
    const dayWindow =
      THREE.MathUtils.smoothstep(9.5, 12.5, hour) *
      (1 - THREE.MathUtils.smoothstep(17.8, 20.2, hour));

    if (vitaAtmosphere) {
      const moonlit = activeDaytimeLook.usingMoonlight || hour >= 20.5 || hour < 4.2;
      if (moonlit) {
        // 月明かり: 背景の銀青差し込み柱向け（彫刻ライトは控えめ）
        const moonAmt = THREE.MathUtils.clamp(0.5 + li * 2.4, 0.45, 0.95) * clearFactor;
        keyLight.intensity = baseKey * (0.45 + moonAmt * 0.45) + lightningFlash * 0.7;
        fillLight.intensity = baseFill * (0.42 + (1 - clearFactor) * 0.2);
        softFillLight.intensity = baseSoftFill * 0.4;
        ambientLight.intensity = baseAmbient * (0.5 + moonAmt * 0.15);
        rimLight.intensity = baseRim * (0.45 + moonAmt * 0.4);
        keyLight.color.setHex(0xd0e4ff);
        fillLight.color.setHex(0x243a58);
        softFillLight.color.copy(fillLight.color);
        ambientLight.color.setHex(0x5a7898);
        ambientLight.groundColor.setHex(0x010408);
      } else {
        // 彫刻ライトは安定させ、背景の青明るさに任せる
        const shaft = (0.28 + li * 0.65) * clearFactor * (0.4 + dayWindow * 0.55);
        keyLight.intensity = baseKey * (0.55 + shaft * 0.75) + lightningFlash * 1.0;
        fillLight.intensity = baseFill * (0.55 + (1 - clearFactor) * 0.3) * (0.7 + li * 0.2);
        softFillLight.intensity = baseSoftFill * (0.5 + (1 - clearFactor) * 0.28);
        ambientLight.intensity = baseAmbient * (0.68 + (1 - clearFactor) * 0.2 + li * 0.08);
        rimLight.intensity = baseRim * (0.45 + clearFactor * 0.45 * dayWindow);
        keyLight.color.setHex(0xc4e8ff);
        fillLight.color.setHex(sceneEnv.fillColor ?? 0x2a5a78);
        softFillLight.color.copy(fillLight.color);
        ambientLight.color.setHex(0x6a98b8);
        ambientLight.groundColor.setHex(sceneEnv.hemisphereGround ?? 0x010408);
      }
    } else {
      // 背景の昼夜は残しつつ、彫刻ライトは潰さない。
      const softKey = 0.62 + li * 0.38;
      const softFill = 0.78 + li * 0.22;
      const softAmbient = 0.88 + li * 0.12;
      keyLight.intensity = baseKey * softKey + lightningFlash * 1.2;
      fillLight.intensity = baseFill * softFill + lightningFlash * 0.7;
      softFillLight.intensity = baseSoftFill * softFill + lightningFlash * 0.45;
      ambientLight.intensity = baseAmbient * softAmbient + lightningFlash * 0.9;
      rimLight.intensity = baseRim;
      keyLight.color.setHex(0xffffff).lerp(new THREE.Color(activeDaytimeLook.sunColor), 0.22);
      fillLight.color
        .setHex(sceneEnv.fillColor ?? 0xe8f0ff)
        .lerp(new THREE.Color(activeDaytimeLook.fillColor), 0.28);
      softFillLight.color.copy(fillLight.color);
      ambientLight.color.setHex(0xffffff).lerp(new THREE.Color(activeDaytimeLook.sunColor), 0.18);
      ambientLight.groundColor
        .setHex(sceneEnv.hemisphereGround ?? 0xd6d0c6)
        .lerp(new THREE.Color(activeDaytimeLook.horizon), 0.35);
    }
  } else {
    if (vitaAtmosphere) {
      keyLight.intensity = baseKey + lightningFlash * 1.0;
      fillLight.intensity = baseFill + lightningFlash * 0.5;
      softFillLight.intensity = baseSoftFill + lightningFlash * 0.35;
      ambientLight.intensity = baseAmbient + lightningFlash * 0.7;
      rimLight.intensity = baseRim;
      keyLight.color.setHex(0xc8ecff);
      fillLight.color.setHex(sceneEnv.fillColor ?? 0x2a5a78);
      softFillLight.color.copy(fillLight.color);
      ambientLight.color.setHex(0x7eb4d8);
      ambientLight.groundColor.setHex(sceneEnv.hemisphereGround ?? 0x010408);
    } else {
      keyLight.intensity = baseKey + lightningFlash * 2.4;
      fillLight.intensity = baseFill + lightningFlash * 1.1;
      softFillLight.intensity = baseSoftFill + lightningFlash * 0.7;
      ambientLight.intensity = baseAmbient + lightningFlash * 1.6;
      rimLight.intensity = baseRim;
      keyLight.color.setHex(0xffffff);
      if (lumenStyle) {
        fillLight.color.setHex(0xb04888);
        softFillLight.color.setHex(0xb04888);
      } else {
        fillLight.color.setHex(sceneEnv.fillColor ?? 0xe8f0ff);
        softFillLight.color.copy(fillLight.color);
      }
      ambientLight.color.setHex(0xffffff);
      ambientLight.groundColor.setHex(sceneEnv.hemisphereGround ?? 0xd6d0c6);
    }
  }
  if (!ditherStyle) {
    renderer.toneMappingExposure = lightDev.exposure;
  }
  if (spotLight) {
    spotLight.intensity = sceneEnv.spotlightIntensity * envMix;
  }
  updateKeyLight();

  if (vitaAtmosphere) {
    const weather = getActiveWeatherSnapshot();
    const cloud = weather?.cloudCover ?? (daytimeSkyActive ? 0.35 : 0.55);
    const clearFactor = THREE.MathUtils.clamp(1 - cloud * 1.15, 0.1, 1);
    const look = daytimeSkyActive ? activeDaytimeLook : null;
    const li = look?.lightIntensity ?? 0.45;
    const hour = look?.hour ?? 15;
    const moonlit = !!(look?.usingMoonlight || hour >= 20.5 || hour < 4.2);
    const dayWindow =
      THREE.MathUtils.smoothstep(9.5, 12.5, hour) *
      (1 - THREE.MathUtils.smoothstep(17.8, 20.2, hour));
    let shaft: number;
    if (moonlit) {
      // 夜〜深夜帯: 水塊は暗いが、月明かりの差し込みは常に出す
      const moonElev = look?.usingMoonlight ? (look.lightElevationDeg ?? 28) : 28;
      const moonAmt = THREE.MathUtils.clamp(0.55 + moonElev / 55, 0.55, 1);
      shaft = (0.65 + li * 1.5) * clearFactor * moonAmt;
      shaft = THREE.MathUtils.clamp(shaft, 0.55, 1);
    } else {
      // 日中: 青白い差し込み
      shaft =
        (daytimeSkyActive ? 0.62 + li * 0.65 : 0.38) * clearFactor * (0.55 + dayWindow * 0.5);
      shaft = THREE.MathUtils.clamp(shaft, 0.35, 1);
    }
    abyssShaftDir.copy(keyLight.position).normalize();
    if (abyssShaftDir.lengthSq() < 1e-6) {
      abyssShaftDir.set(0.12, 0.96, 0.18);
    }
    sceneBackground.setAbyssShaft(abyssShaftDir, shaft);
  } else {
    sceneBackground.setAbyssShaft(abyssShaftDir.set(0, 1, 0), 0);
  }
};

/** 左下（朝）→ 正午真上 → 右下（夕〜夜）の弧でキーライトを置く */
const updateKeyLight = () => {
  const look = daytimeSkyActive ? activeDaytimeLook : null;
  let elevationDeg = lightDev.elevationDeg;
  let sideDeg = lightDev.sideDeg;
  if (look) {
    const h = look.hour;
    if (vitaAtmosphere) {
      // 深海の差し込み: 昼は上寄り、夜は月の高度・方位を反映
      if (look.usingMoonlight || h >= 20.5 || h < 3.5) {
        const moonElev = THREE.MathUtils.clamp(look.lightElevationDeg, 12, 72);
        elevationDeg = THREE.MathUtils.lerp(42, 70, THREE.MathUtils.clamp(moonElev / 60, 0, 1));
        // 方位: 南寄りを0、東西に振る（深海では控えめ）
        const az = ((look.lightAzimuthDeg % 360) + 360) % 360;
        const eastWest = Math.sin(((az - 180) * Math.PI) / 180);
        sideDeg = eastWest * 28;
      } else if (h <= 12) {
        const t = THREE.MathUtils.smoothstep(3.5, 12, h);
        sideDeg = THREE.MathUtils.lerp(-22, 0, t);
        elevationDeg = THREE.MathUtils.lerp(55, 78, t);
      } else {
        const t = THREE.MathUtils.smoothstep(12, 19.5, h);
        sideDeg = THREE.MathUtils.lerp(0, 26, t);
        elevationDeg = THREE.MathUtils.lerp(78, 52, t);
      }
    } else if (look.usingMoonlight || h >= 20.5 || h < 3.5) {
      sideDeg = 28;
      elevationDeg = 52;
    } else if (h <= 12) {
      const t = THREE.MathUtils.smoothstep(3.5, 12, h);
      sideDeg = THREE.MathUtils.lerp(-32, 0, t);
      elevationDeg = THREE.MathUtils.lerp(48, 72, t);
    } else {
      const t = THREE.MathUtils.smoothstep(12, 20.5, h);
      sideDeg = THREE.MathUtils.lerp(0, 32, t);
      elevationDeg = THREE.MathUtils.lerp(72, 48, t);
    }
    if (!look.usingMoonlight && look.sunElevationDeg > -8) {
      const solarLift = THREE.MathUtils.clamp(look.sunElevationDeg * 0.12, -2, 6);
      elevationDeg = THREE.MathUtils.clamp(elevationDeg + solarLift, vitaAtmosphere ? 48 : 45, 78);
    }
  } else if (vitaAtmosphere) {
    elevationDeg = Math.max(elevationDeg, 62);
  }
  const side = THREE.MathUtils.degToRad(sideDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const radius = 7.6;
  // side<0 = 左下寄り、side>0 = 右下寄り。正午は真上近く
  keyLight.position.set(
    Math.sin(side) * Math.cos(elevation) * radius,
    Math.sin(elevation) * radius,
    Math.cos(side) * Math.cos(elevation) * radius * 0.55 + 2.2,
  );
};

type ArmedAudioSource = "input" | "system" | "dev" | null;
let armedAudioSource: ArmedAudioSource = null;
let sourceButtonsEnabled = true;
const inputDevicePanel = document.querySelector<HTMLElement>("#input-device-panel");
const playbackVolumeSlider = document.querySelector<HTMLInputElement>("#playback-volume");
const playbackVolumeValue = document.querySelector<HTMLElement>("#playback-volume-value");
const PLAYBACK_VOLUME_STORAGE_KEY = "sound-sculpture.playback-volume";

const syncPlaybackVolumeUi = (percent: number) => {
  const clamped = Math.round(clamp01(percent / 100) * 100);
  if (playbackVolumeSlider) {
    playbackVolumeSlider.value = String(clamped);
    playbackVolumeSlider.setAttribute("aria-valuenow", String(clamped));
    playbackVolumeSlider.setAttribute(
      "aria-valuetext",
      clamped === 0 ? "Muted" : `${clamped}%`,
    );
    // Input Device 非活性時も常に操作可能（親パネルの disabled に巻き込まない）
    playbackVolumeSlider.disabled = false;
  }
  if (playbackVolumeValue) {
    playbackVolumeValue.textContent = clamped === 0 ? "Mute" : `${clamped}%`;
  }
  const volumeLabel = playbackVolumeSlider?.closest(".playback-volume");
  volumeLabel?.classList.toggle("is-muted", clamped === 0);
};

const applyPlaybackVolume = (percent: number, persist = true) => {
  const raw = Number(percent);
  const unit = clamp01(Number.isFinite(raw) ? raw / 100 : 0.8);
  audioInput.setOutputVolume(unit);
  syncPlaybackVolumeUi(unit * 100);
  if (persist) {
    try {
      localStorage.setItem(PLAYBACK_VOLUME_STORAGE_KEY, String(Math.round(unit * 100)));
    } catch {
      // private mode など
    }
  }
};

{
  let initial = 80;
  try {
    const stored = localStorage.getItem(PLAYBACK_VOLUME_STORAGE_KEY);
    if (stored != null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        initial = Math.round(clamp01(parsed / 100) * 100);
      }
    }
  } catch {
    // ignore
  }
  applyPlaybackVolume(initial, false);
}

playbackVolumeSlider?.addEventListener("input", () => {
  applyPlaybackVolume(Number(playbackVolumeSlider.value));
});

const syncArmedSourceUi = () => {
  const useButtons: Array<{ button: HTMLButtonElement | null; source: Exclude<ArmedAudioSource, null> }> = [
    { button: startButton, source: "input" },
    { button: startSystemAudioButton, source: "system" },
    { button: startDevAudioButton, source: "dev" },
  ];
  for (const entry of useButtons) {
    if (!entry.button) continue;
    const selected = armedAudioSource === entry.source;
    entry.button.classList.toggle("is-selected", selected);
    entry.button.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  const inputDeviceActive = armedAudioSource === "input" && sourceButtonsEnabled;
  if (inputDevicePanel) {
    inputDevicePanel.classList.toggle("is-active", inputDeviceActive);
    inputDevicePanel.setAttribute("aria-disabled", inputDeviceActive ? "false" : "true");
  }
  audioInputSelect.disabled = !inputDeviceActive;
  refreshAudioDevicesButton.disabled = !inputDeviceActive;

  beginRecordingButton.disabled = !sourceButtonsEnabled || armedAudioSource === null;
  // Use 選択後 / 形成中 / 完成後は Reset で初期状態に戻せる
  resetSculptureButton.disabled = !(armedAudioSource !== null || isAudioReady || isComplete);
};

const armAudioSource = (
  source: Exclude<ArmedAudioSource, null>,
  trigger: HTMLButtonElement,
) => {
  if (!sourceButtonsEnabled) {
    return;
  }
  armedAudioSource = source;
  syncArmedSourceUi();
  setStatus(trigger.dataset.statusArmed ?? "Ready — press Start Recording");
};

const setStartButtonsEnabled = (enabled: boolean) => {
  sourceButtonsEnabled = enabled;
  startButton.disabled = !enabled;
  startSystemAudioButton.disabled = !enabled;
  if (startDevAudioButton) {
    startDevAudioButton.disabled = !enabled;
  }
  syncArmedSourceUi();
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
  audioInput.stopPlayback();
  audioInput.resetAnalysisState();
  sculpture.reset();
  rhythm.reset();
  structureTracker.reset();
  speciesProfiler.setCalibrationSeconds(runtimeTuning.speciesCalibrationSeconds);
  speciesProfiler.reset();
  latestStructure = defaultStructureSnapshot();
  lastDisplayBands = emptyBands();
  isComplete = false;
  isAudioReady = false;
  hasHeardSound = false;
  silenceSeconds = 0;
  loudBurstSeconds = 0;
  hudFormingSeconds = 0;
  hudSlashLevel = 1;
  hudLastBpm = 0;
  hudSignalLabel = "---";
  armedAudioSource = null;
  latestRhythm = {
    kick: 0,
    snare: 0,
    hat: 0,
    transient: 0,
    chop: 0,
    salience: 0,
    beat: 0,
    beatIndex: 0,
    kickIndex: 0,
    snareIndex: 0,
    hatIndex: 0,
    transientIndex: 0,
    chopIndex: 0,
    salienceIndex: 0,
    downbeat: false,
    bpm: 0,
    pulsePhase: 0,
    pulseConfidence: 0,
    pulseEnvelope: 0,
    pulseIndex: 0,
    kickLength: 0,
    snareLength: 0,
    hatLength: 0,
    kickRing: 0,
    snareRing: 0,
    hatRing: 0,
    melodyOnset: 0,
    salienceLow: 0,
    salienceMid: 0,
    salienceHigh: 0,
    subLevel: 0,
    wavePeak: 0,
    waveEnergy: 0,
  };
  appElement.classList.remove("is-complete");
  viewControls.enabled = true;
  completeButton.disabled = true;
  exportButton.disabled = true;
  if (bandToneTestButton) {
    bandToneTestButton.disabled = true;
  }
  setStartButtonsEnabled(true);
  setStatus(statusElement.dataset.statusIdle ?? "Standby");
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

const finishAudioInputStart = () => {
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
  audioInput.restartDevAudioIfActive();
  viewControls.enabled = true;
  completeButton.disabled = isComplete;
  resetSculptureButton.disabled = false;
  if (bandToneTestButton) {
    bandToneTestButton.disabled = isComplete;
  }
  setStatus(beginRecordingButton.dataset.statusReady ?? "Forming — drag to rotate");
  void closeControlPanel();
};

startButton.addEventListener("click", () => {
  armAudioSource("input", startButton);
});

startSystemAudioButton.addEventListener("click", () => {
  armAudioSource("system", startSystemAudioButton);
});

if (isDevSurface() && startDevAudioButton) {
  startDevAudioButton.addEventListener("click", () => {
    armAudioSource("dev", startDevAudioButton);
  });
}

beginRecordingButton.addEventListener("click", async () => {
  if (!armedAudioSource || !sourceButtonsEnabled) {
    return;
  }

  void closeControlPanel();

  const source = armedAudioSource;
  const deviceId = audioInputSelect.value || "default";

  setStartButtonsEnabled(false);
  setStatus(beginRecordingButton.dataset.statusPreparing ?? "Preparing audio input…");

  try {
    if (source === "input") {
      hudSignalLabel = "INPUT";
      await audioInput.startMicrophone(deviceId);
      micPermissionGranted = true;
      await populateAudioDevices();
      if ([...audioInputSelect.options].some((option) => option.value === deviceId)) {
        audioInputSelect.value = deviceId;
      }
    } else if (source === "system") {
      hudSignalLabel = "SYSTEM";
      setStatus("Preparing system / tab audio…");
      await audioInput.startDisplayAudio();
    } else {
      hudSignalLabel = "BUFFER";
      setStatus("Preparing dev audio…");
      let selected: { url: string; label: string };
      if (getSelectedDevAudioUrl) {
        selected = await getSelectedDevAudioUrl();
      } else {
        const mod = await import("./dev-audio");
        const track = mod.resolveInitialDevAudioTrack();
        if (!track) {
          throw new Error("開発用音源がありません（src/music を確認してください）");
        }
        selected = { url: track.url, label: track.label };
      }
      beginRecordingButton.dataset.statusReady = `Forming (${selected.label}) — drag to rotate`;
      await audioInput.startDevAudio(selected.url);
    }

    finishAudioInputStart();
  } catch (error) {
    setStartButtonsEnabled(true);
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Failed to start audio input";
    setStatus(message);
    console.error(error);
  }
});

syncArmedSourceUi();

completeButton.addEventListener("click", completeSculpture);
resetSculptureButton.addEventListener("click", resetSculptureSession);
exportButton.addEventListener("click", exportSculpture);

const resize = () => {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const fit = getViewportFitScale();
  if (camera instanceof THREE.OrthographicCamera) {
    const half = orthoHalf / fit;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
  } else {
    camera.aspect = aspect;
    camera.fov = BASE_CAMERA_FOV / fit;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (ditherPass) {
    const bufferSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(bufferSize);
    ditherPass.setSize(bufferSize.x, bufferSize.y);
  }
  if (bloomPass) {
    const bufferSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(bufferSize);
    bloomPass.setSize(bufferSize.x, bufferSize.y);
  }
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
  if (bandSoloAllows("low") && rhythmEvents.kick > 0.03) {
    const k = rhythmEvents.kick;
    bands.sub = Math.min(1, bands.sub + k * 1.2);
    bands.low = Math.min(1, bands.low + k * 0.8);
    bands.overall = Math.min(1, bands.overall + k * 0.42);
  }
  if (bandSoloAllows("mid") && rhythmEvents.snare > 0.04) {
    const s = rhythmEvents.snare;
    bands.contrast = Math.min(1, bands.contrast + s * 0.35);
    bands.mid = Math.min(1, bands.mid + s * 0.45);
    bands.melody = Math.min(1, bands.melody + s * 0.55);
    bands.overall = Math.min(1, bands.overall + s * 0.14);
  }
  if (bandSoloAllows("high") && rhythmEvents.hat > 0.05) {
    const h = rhythmEvents.hat;
    bands.high = Math.min(1, bands.high + h * 0.45);
    bands.brightness = Math.min(1, bands.brightness + h * 0.35);
  }
  if (bandSoloAllows("high") && rhythmEvents.transient > 0.06) {
    bands.high = Math.min(1, bands.high + rhythmEvents.transient * 0.7);
    bands.brightness = Math.min(1, bands.brightness + rhythmEvents.transient * 0.55);
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
  sculptureBands: AudioBands,
  waveformMetrics: WaveformMetrics | null,
  deltaTime: number,
  rhythmBands: AudioBands = sculptureBands,
) => {
  // リズムはピーク正規化前の帯域で検出（曲の実際のアタックと揃える）
  const rhythmEvents = rhythm.update(rhythmBands, waveformMetrics, deltaTime);
  latestRhythm = rhythmEvents;

  const bands = applyWaveGate(sculptureBands, waveformMetrics);
  const playbackEnded = audioInput.hasPlaybackEnded();

  // バッファ曲が終わったら形を止め、短く待って完成
  if (playbackEnded && !isComplete) {
    sculpture.holdShapeForCompletion?.();
    sculpture.evolveSongColors?.(audioInput.getProfile(), deltaTime);
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
      melodyFocus: bands.melodyFocus,
      centroid: bands.centroid,
      pulseConfidence: rhythmEvents.pulseConfidence,
      transientRate: structureTracker.getTransientRate(),
      novelty: latestStructure.novelty,
      eventRate:
        (latestStructure.events.noveltyPeak ? 1 : 0) +
        (latestStructure.events.energySurge ? 1 : 0) +
        (latestStructure.events.transientBurst ? 1 : 0) +
        (latestStructure.events.pulseStable ? 0.5 : 0),
      grit: audioInput.getSpectralFlatness(),
    },
    bands,
    deltaTime,
    isStructureActive,
  );

  const speciesProfile = speciesProfiler.getProfile();
  if (devSurface) {
    // 音色軸の読み出し（パネルと headless 計測が共有する。3章の「見えなかった」再発防止）
    mineralDebug.axis =
      (sculpture as { getMineralAxis?: () => number }).getMineralAxis?.() ?? 0;
    mineralDebug.grit = audioInput.getSpectralFlatness();
    mineralDebug.gritAvg = speciesProfiler.getAverageGrit();
    mineralDebug.mineral = speciesProfile.mineral;
    mineralDebug.organic = speciesProfile.organic;
    mineralDebug.aggressive = speciesProfile.aggressive;
    mineralDebug.override = mineralMix.axisOverride >= 0;
    const raw = speciesProfiler.getMineralInputs();
    mineralDebug.loudRatio = raw.loudRatio;
    mineralDebug.brightness = raw.brightness;
    mineralDebug.melodyFocus = raw.melodyFocus;
    mineralDebug.centroid = raw.centroid;
    mineralDebug.transient = raw.transient;
    mineralDebug.density = raw.density;
    // 熟成度の候補入力（[P1] step 0 の計測専用。まだ見た目には使っていない）
    const mat = (
      sculpture as { getMaturityInputs?: () => typeof maturityDebug }
    ).getMaturityInputs?.();
    if (mat) {
      maturityDebug.maturity = mat.maturity;
      maturityDebug.fromAccum = mat.fromAccum;
      maturityDebug.progress = mat.progress;
      maturityDebug.override = maturityMix.override >= 0;
      maturityDebug.formDev = mat.formDev;
      maturityDebug.vecMean = mat.vecMean;
      maturityDebug.scalarMean = mat.scalarMean;
      maturityDebug.exposure = mat.exposure;
      maturityDebug.activeSeconds = mat.activeSeconds;
    }
  }
  if (!isComplete) {
    sculpture.evolveSongColors?.(audioInput.getProfile(), deltaTime);
  }
  const soloBands = bandSoloMode === "off" ? bands : applyBandSolo(bands, bandSoloMode);
  sculpture.update(
    soloBands,
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
  // 完成すると advanceSculptureSimulation を通らなくなるので、完成フラグはここで拾う
  // （[P1] step 0 の計測用。`maturity_probe.js` が曲の終わりを検出できないと止まらない）。
  maturityDebug.completed = isComplete;

  if (isAudioReady && !isComplete && audioInput.isDeterministic()) {
    const steps = audioInput.drainSimulationSteps();
    for (const step of steps) {
      const result = advanceSculptureSimulation(
        step.bands,
        step.waveform,
        step.deltaTime,
        step.rhythmBands,
      );
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
    const sculptureBands = audioInput.update(deltaTime);
    const rhythmBands = audioInput.getRhythmBands();
    const waveformMetrics = audioInput.getWaveformMetrics();
    waveform = audioInput.getWaveformBytes();
    bandMeters = snapshotBandMeters(sculptureBands);
    if (isComplete) {
      displayBands = applyWaveGate(sculptureBands, waveformMetrics);
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
      const result = advanceSculptureSimulation(
        sculptureBands,
        waveformMetrics,
        deltaTime,
        rhythmBands,
      );
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
  if (ditherPass) {
    ditherPass.update(deltaTime);
    ditherPass.render(renderer, scene, camera);
  } else {
    renderer.render(scene, camera);
    if (bloomPass) {
      bloomPass.renderBloomOverlay(renderer, scene, camera);
    }
  }
  requestAnimationFrame(render);
};

const tuningSliderInputs = new Map<keyof SculptureTuning, HTMLInputElement>();
const tuningSliderValueLabels = new Map<keyof SculptureTuning, HTMLElement>();

const refreshTuningExport = () => {
  // ノブ以外の dev パネル値も、パネルで追い込んだ値をそのままエージェントへ
  // 渡せるようコピー用テキストに含める。
  const isVita = visualStyle.membrane.vita;
  tuningExportText.value = formatSculptureTuningForAgent(
    sculptureTuning,
    runtimeTuning,
    growthAlgorithmId,
    bloomPass
      ? { enabled: bloomPass.enabled, threshold: bloomPass.threshold, strength: bloomPass.strength }
      : null,
    abyssEnvironment ? { enabled: abyssEnvEnabled, intensity: abyssEnvIntensity } : null,
    isVita
      ? {
          strength: clayGrainUniforms.uClayGrain.value,
          scale: clayGrainUniforms.uClayGrainScale.value,
        }
      : null,
    { hueSpan: songColorSpan.hue, satSpan: songColorSpan.sat },
    isVita
      ? {
          enabled: membraneRelax.iterations > 0,
          iterations: membraneRelax.iterations,
          strength: membraneRelax.strength,
        }
      : null,
    isVita
      ? {
          enabled: pearlColorMix.enabled,
          spread: pearlColorMix.spread,
          balance: pearlColorMix.balance,
        }
      : null,
    isVita
      ? {
          axis: gemUniforms.uMineral.value,
          axisOverride: mineralMix.axisOverride >= 0,
          facetStrength: mineralMix.facetStrength,
          gem: gemUniforms.uGem.value,
          bodyDark: gemUniforms.uGemBodyDark.value,
          ridge: gemUniforms.uGemRidge.value,
          sparkle: gemUniforms.uGemSparkle.value,
          through: gemUniforms.uGemThrough.value,
          fire: gemUniforms.uGemFire.value,
        }
      : null,
  );
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

type LightDevKey = keyof typeof lightDev;
type LightSliderSpec = {
  key: LightDevKey;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
};

const LIGHT_SLIDER_SPECS: readonly LightSliderSpec[] = [
  { key: "key", label: "Key", help: "メイン光源の強さ", min: 0, max: 5, step: 0.05 },
  { key: "fill", label: "Fill", help: "正面寄りの補助光", min: 0, max: 4, step: 0.05 },
  { key: "softFill", label: "Soft fill", help: "反対側の弱いフィル", min: 0, max: 4, step: 0.05 },
  { key: "ambient", label: "Ambient", help: "半球環境光", min: 0, max: 5, step: 0.05 },
  { key: "rim", label: "Rim", help: "背面リムライト", min: 0, max: 2, step: 0.02 },
  { key: "exposure", label: "Exposure", help: "トーンマッピング露出", min: 0.4, max: 2, step: 0.02 },
  { key: "elevationDeg", label: "Elevation", help: "キーライト高度（°）。昼空ON時は時刻が優先", min: 0, max: 90, step: 1 },
  { key: "sideDeg", label: "Side", help: "キーライト左右（°）。昼空ON時は時刻が優先", min: -90, max: 90, step: 1 },
];

const lightSliderInputs = new Map<LightDevKey, HTMLInputElement>();
const lightSliderValueLabels = new Map<LightDevKey, HTMLElement>();

const syncLightRigSlidersFromState = () => {
  for (const spec of LIGHT_SLIDER_SPECS) {
    const input = lightSliderInputs.get(spec.key);
    const valueLabel = lightSliderValueLabels.get(spec.key);
    const value = lightDev[spec.key];
    if (input) {
      input.value = String(value);
    }
    if (valueLabel) {
      valueLabel.textContent = Number.isInteger(spec.step) ? value.toFixed(0) : value.toFixed(2);
    }
  }
};

const initLightRigPanel = () => {
  const root = document.querySelector<HTMLElement>("#light-rig-sliders");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-light-rig");
  if (!root || !devSurface) return;

  for (const spec of LIGHT_SLIDER_SPECS) {
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
    const helpId = `light-help-${spec.key}`;
    help.id = helpId;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", helpId);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(lightDev[spec.key]);
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    row.append(label, input, valueLabel, help);
    root.appendChild(row);

    lightSliderInputs.set(spec.key, input);
    lightSliderValueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      lightDev[spec.key] = value;
      // 形成中スライダーを動かしたら、完成時も同じ比率で追従（独立キー以外）
      if (spec.key === "key") {
        const ratio = sceneEnv.key > 0.001 ? sceneEnv.keyComplete / sceneEnv.key : 1;
        lightDev.keyComplete = value * ratio;
      } else if (spec.key === "fill") {
        const ratio = sceneEnv.fill > 0.001 ? sceneEnv.fillComplete / sceneEnv.fill : 1;
        lightDev.fillComplete = value * ratio;
      } else if (spec.key === "softFill") {
        const ratio = sceneEnv.fill > 0.001 ? sceneEnv.fillComplete / sceneEnv.fill : 1;
        lightDev.softFillComplete = value * ratio;
      } else if (spec.key === "ambient") {
        const ratio = sceneEnv.ambient > 0.001 ? sceneEnv.ambientComplete / sceneEnv.ambient : 1;
        lightDev.ambientComplete = value * ratio;
      } else if (spec.key === "rim") {
        lightDev.rimComplete = value * 0.85;
      }
      valueLabel.textContent = Number.isInteger(spec.step) ? value.toFixed(0) : value.toFixed(2);
      if (spec.key === "exposure" && !ditherStyle) {
        renderer.toneMappingExposure = value;
      }
      if (spec.key === "elevationDeg" || spec.key === "sideDeg") {
        updateKeyLight();
      }
    });
  }

  resetButton?.addEventListener("click", () => {
    lightDev = createLightDevFromStyle();
    syncLightRigSlidersFromState();
    if (!ditherStyle) {
      renderer.toneMappingExposure = lightDev.exposure;
    }
    updateKeyLight();
  });

  syncLightRigSlidersFromState();
};

initLightRigPanel();

/**
 * ブルーム（vita のみ）の DEV パネル。
 * ブルームの対象は再生中のヒット（粒子・膜のきらめき）なので、無音のスクリーンショットでは
 * 強度を決められない。曲を鳴らしながら threshold / strength を動かして追い込むための口。
 * ここで決めた値は bloom-pass.ts の DEFAULT_BLOOM_* へ焼き込む。
 */
const initBloomPanel = () => {
  const panel = document.querySelector<HTMLElement>("#bloom-panel");
  const root = document.querySelector<HTMLElement>("#bloom-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-bloom");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-bloom");
  // bloomPass は vita のときだけ生成される。他スタイルではパネルごと出さない。
  if (!panel || !root || !bloomPass || !devSurface) return;
  panel.hidden = false;

  const pass = bloomPass;
  const specs = [
    {
      key: "threshold" as const,
      label: "Threshold",
      // 実測: vita のシーンで線形HDR輝度 0.90 超が 1.49%、0.60 超が 50.3%。
      // 1.0 を超えるとほぼ何も拾わなくなるので上限は 1.2 で足りる。
      help: "この線形HDR輝度を超えた画素だけ滲む。下げるほど広い範囲が光る（0.6 で画面の半分が対象）。",
      min: 0.2,
      max: 1.2,
      step: 0.01,
      get: () => pass.threshold,
      set: (value: number) => {
        pass.threshold = value;
      },
    },
    {
      key: "strength" as const,
      label: "Strength",
      help: "抽出した明部を canvas へ加算する量。上げるほど滲みが強く広がる。",
      min: 0,
      max: 3,
      step: 0.02,
      get: () => pass.strength,
      set: (value: number) => {
        pass.strength = value;
      },
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();

  const syncFromState = () => {
    for (const spec of specs) {
      const input = inputs.get(spec.key);
      const valueLabel = valueLabels.get(spec.key);
      if (input) {
        input.value = String(spec.get());
      }
      if (valueLabel) {
        valueLabel.textContent = spec.get().toFixed(2);
      }
    }
    if (toggleButton) {
      toggleButton.textContent =
        (pass.enabled ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
    }
  };

  for (const spec of specs) {
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
    const helpId = `bloom-help-${spec.key}`;
    help.id = helpId;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", helpId);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    row.append(label, input, valueLabel, help);
    root.appendChild(row);

    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      valueLabel.textContent = value.toFixed(2);
      refreshTuningExport();
    });
  }

  // 同一ロード内で ON/OFF を切り替えるための口。シードはロードごとにランダムなので、
  // 別々に起動した2枚で A/B を取ると形自体が変わってしまう（handoff/VITA.md の6章）。
  toggleButton?.addEventListener("click", () => {
    pass.enabled = !pass.enabled;
    syncFromState();
    refreshTuningExport();
  });

  resetButton?.addEventListener("click", () => {
    pass.enabled = true;
    pass.threshold = DEFAULT_BLOOM_THRESHOLD;
    pass.strength = DEFAULT_BLOOM_STRENGTH;
    syncFromState();
    refreshTuningExport();
  });

  syncFromState();
};

/**
 * 映り込み（vita の暗い自作環境）の dev パネル。
 * ブルームと同じく「同一ロード内で ON/OFF と量を振れる口」を作るためのもの。
 * シードはロードごとにランダムなので、別々に起動した2枚では A/B にならない
 * （docs/handoff/VITA.md 6章）。
 */
const initEnvPanel = () => {
  const panel = document.querySelector<HTMLElement>("#env-panel");
  const root = document.querySelector<HTMLElement>("#env-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-env");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-env");
  // abyssEnvironment は vita のときだけ生成される。他スタイルではパネルごと出さない。
  if (!panel || !root || !abyssEnvironment || !devSurface) return;
  panel.hidden = false;

  const row = document.createElement("div");
  row.className = "tuning-slider";
  const label = document.createElement("button");
  label.className = "tuning-slider__label";
  label.type = "button";
  label.textContent = "Intensity";
  const help = document.createElement("div");
  help.className = "tuning-slider__help";
  help.textContent =
    "彫刻のマテリアルに環境（暗い深海）が映り込む量。上げるほど上面が明るくなり、回転で流れるハイライトが強くなる。";
  help.hidden = true;
  help.id = "env-help-intensity";
  label.setAttribute("aria-expanded", "false");
  label.setAttribute("aria-controls", help.id);
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1.5";
  input.step = "0.01";
  const valueLabel = document.createElement("span");
  valueLabel.className = "tuning-slider__value";
  row.append(label, input, valueLabel, help);
  root.appendChild(row);

  const syncFromState = () => {
    input.value = String(abyssEnvIntensity);
    valueLabel.textContent = abyssEnvIntensity.toFixed(2);
    if (toggleButton) {
      toggleButton.textContent =
        (abyssEnvEnabled ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
    }
  };

  label.addEventListener("click", (event) => {
    event.preventDefault();
    const next = help.hidden;
    help.hidden = !next;
    label.setAttribute("aria-expanded", next ? "true" : "false");
  });

  input.addEventListener("input", () => {
    abyssEnvIntensity = Number(input.value);
    applyAbyssEnvironment();
    valueLabel.textContent = abyssEnvIntensity.toFixed(2);
    refreshTuningExport();
  });

  toggleButton?.addEventListener("click", () => {
    abyssEnvEnabled = !abyssEnvEnabled;
    applyAbyssEnvironment();
    syncFromState();
    refreshTuningExport();
  });

  resetButton?.addEventListener("click", () => {
    abyssEnvEnabled = true;
    abyssEnvIntensity = sceneEnv.envMapIntensity ?? DEFAULT_ABYSS_ENV_INTENSITY;
    applyAbyssEnvironment();
    syncFromState();
    refreshTuningExport();
  });

  syncFromState();
};

/**
 * 粘土の肌理（vita の core にシェーダだけで足した法線摂動）の dev パネル。
 * ブルーム・映り込みと同じく「同一ロード内で ON/OFF と量を振れる口」。
 * 肌理は動いている面ほど読めるので、これも曲を鳴らしながら決める前提
 * （docs/handoff/VITA.md 6章）。
 */
const initMembraneRelaxPanel = () => {
  const panel = document.querySelector<HTMLElement>("#membrane-panel");
  const root = document.querySelector<HTMLElement>("#membrane-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-membrane-relax");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-membrane-relax");
  // 膜の折り重なりは vita の膜だけの問題。他スタイルではパネルごと出さない。
  if (!panel || !root || !visualStyle.membrane.vita || !devSurface) return;
  panel.hidden = false;

  const specs = [
    {
      key: "iterations" as const,
      label: "Iterations",
      help: "近傍平均を何回かけるか。0 で無効（＝板が重なったままの従来の見た目）。上げるほど折り重なりが消えるが、膜の起伏そのものも失われて真球へ近づく。",
      min: 0,
      max: 6,
      step: 1,
      digits: 0,
      get: () => membraneRelax.iterations,
      set: (value: number) => {
        membraneRelax.iterations = value;
      },
    },
    {
      key: "strength" as const,
      label: "Strength",
      help: "1回あたりどれだけ近傍の平均へ寄せるか。1 で完全に平均へ置き換える。Iterations と掛け算で効くので、両方上げると一気に平らになる。",
      min: 0,
      max: 1,
      step: 0.05,
      digits: 2,
      get: () => membraneRelax.strength,
      set: (value: number) => {
        membraneRelax.strength = value;
      },
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();
  let lastIterations = membraneRelax.iterations || DEFAULT_MEMBRANE_RELAX_ITERATIONS;

  const syncFromState = () => {
    for (const spec of specs) {
      const input = inputs.get(spec.key);
      if (input) input.value = String(spec.get());
      const valueLabel = valueLabels.get(spec.key);
      if (valueLabel) valueLabel.textContent = spec.get().toFixed(spec.digits);
    }
    if (toggleButton) {
      const enabled = membraneRelax.iterations > 0;
      toggleButton.textContent =
        (enabled ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
    }
  };

  for (const spec of specs) {
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
    help.id = `membrane-help-${spec.key}`;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", help.id);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    row.append(label, input, valueLabel, help);
    root.appendChild(row);

    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      if (spec.key === "iterations" && value > 0) {
        lastIterations = value;
      }
      valueLabel.textContent = value.toFixed(spec.digits);
      if (spec.key === "iterations" && toggleButton) {
        toggleButton.textContent =
          (value > 0 ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
      }
      refreshTuningExport();
    });
  }

  toggleButton?.addEventListener("click", () => {
    if (membraneRelax.iterations > 0) {
      lastIterations = membraneRelax.iterations;
      membraneRelax.iterations = 0;
    } else {
      membraneRelax.iterations = lastIterations;
    }
    syncFromState();
    refreshTuningExport();
  });

  resetButton?.addEventListener("click", () => {
    membraneRelax.iterations = DEFAULT_MEMBRANE_RELAX_ITERATIONS;
    membraneRelax.strength = DEFAULT_MEMBRANE_RELAX_STRENGTH;
    lastIterations = DEFAULT_MEMBRANE_RELAX_ITERATIONS;
    syncFromState();
    refreshTuningExport();
  });

  syncFromState();
};

const initGrainPanel = () => {
  const panel = document.querySelector<HTMLElement>("#grain-panel");
  const root = document.querySelector<HTMLElement>("#grain-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-grain");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-grain");
  // 肌理は vita の core にしか入っていない。他スタイルではパネルごと出さない。
  if (!panel || !root || !visualStyle.membrane.vita || !devSurface) return;
  panel.hidden = false;

  const specs = [
    {
      key: "strength" as const,
      label: "Strength",
      help: "法線を摂動させる量。上げるほど粘土の肌理が強く出て、面の境目が読み取りにくくなる。上げすぎるとザラつきだけが目立つ。",
      min: 0,
      max: 2,
      step: 0.01,
      get: () => clayGrainUniforms.uClayGrain.value,
      set: (value: number) => {
        clayGrainUniforms.uClayGrain.value = value;
      },
    },
    {
      key: "scale" as const,
      label: "Scale",
      help: "肌理の細かさ。下げると大きなうねり（面の境目を崩す側）、上げると細かい砂目になる。",
      min: 4,
      max: 80,
      step: 0.5,
      get: () => clayGrainUniforms.uClayGrainScale.value,
      set: (value: number) => {
        clayGrainUniforms.uClayGrainScale.value = value;
      },
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();
  // ON/OFF は uniform を 0 にするだけ（シェーダーを差し替えないので再コンパイルが起きない）
  let lastStrength = clayGrainUniforms.uClayGrain.value || DEFAULT_CLAY_GRAIN_STRENGTH;

  const syncFromState = () => {
    for (const spec of specs) {
      const input = inputs.get(spec.key);
      if (input) input.value = String(spec.get());
      const valueLabel = valueLabels.get(spec.key);
      if (valueLabel) valueLabel.textContent = spec.get().toFixed(2);
    }
    if (toggleButton) {
      const enabled = clayGrainUniforms.uClayGrain.value > 0;
      toggleButton.textContent =
        (enabled ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
    }
  };

  for (const spec of specs) {
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
    help.id = `grain-help-${spec.key}`;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", help.id);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    row.append(label, input, valueLabel, help);
    root.appendChild(row);

    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      if (spec.key === "strength" && value > 0) {
        lastStrength = value;
      }
      valueLabel.textContent = value.toFixed(2);
      if (spec.key === "strength" && toggleButton) {
        toggleButton.textContent =
          (value > 0 ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
      }
      refreshTuningExport();
    });
  }

  toggleButton?.addEventListener("click", () => {
    if (clayGrainUniforms.uClayGrain.value > 0) {
      lastStrength = clayGrainUniforms.uClayGrain.value;
      clayGrainUniforms.uClayGrain.value = 0;
    } else {
      clayGrainUniforms.uClayGrain.value = lastStrength;
    }
    syncFromState();
    refreshTuningExport();
  });

  resetButton?.addEventListener("click", () => {
    clayGrainUniforms.uClayGrain.value = DEFAULT_CLAY_GRAIN_STRENGTH;
    clayGrainUniforms.uClayGrainScale.value = DEFAULT_CLAY_GRAIN_SCALE;
    lastStrength = DEFAULT_CLAY_GRAIN_STRENGTH;
    syncFromState();
    refreshTuningExport();
  });

  syncFromState();
};

/**
 * 完成形シルエットを曲どうしで比べるための検証用キャプチャ（DEV 限定）。
 *
 * なぜ要るか: 再生中はカメラが `pickCameraDriftTarget()` でランダムな方角へ漂い、
 * 彫刻はドラッグで自由に回る。そのまま画面を撮ると
 * `docs/aether-progress/tools/silhouette.js` は**形ではなくカメラ角度の差**を測る。
 * ここで向き・画角・解像度を固定してから撮ることで、初めて曲どうしの比較が成立する。
 *
 * 3方向撮るのは、1方向だけだと「たまたまその角度から似ていた／違って見えた」を
 * 排除できないため。silhouette.js には同じ角度どうしを渡して突き合わせる。
 */
const CAPTURE_SIZE = 900;
const CAPTURE_YAWS = [0, 120, 240];

const captureVerificationShots = () => {
  const label =
    devAudioTrackSelect?.selectedOptions[0]?.textContent?.trim().replace(/[^\w\-.ぁ-んァ-ヶ一-龠]/gu, "_") ||
    "unknown";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/gu, "");

  // 元の状態を控えて、撮り終わったら必ず戻す
  const savedQuaternion = sculpture.group.quaternion.clone();
  const savedPosition = camera.position.clone();
  const savedAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : null;

  // カメラの漂いを打ち消して基準位置へ戻す（sway は現在のオフセットぶんだけずれている）
  camera.position.sub(cameraSwayPrevOffset);

  if (camera instanceof THREE.OrthographicCamera) {
    const half = orthoHalf / getViewportFitScale();
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
  } else {
    camera.aspect = 1;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false);
  if (bloomPass) {
    const bufferSize = new THREE.Vector2();
    renderer.getDrawingBufferSize(bufferSize);
    bloomPass.setSize(bufferSize.x, bufferSize.y);
  }

  for (const yaw of CAPTURE_YAWS) {
    sculpture.group.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (yaw * Math.PI) / 180,
    );
    sculpture.group.updateMatrixWorld(true);
    // render → toDataURL を同じ実行タスク内で行う。
    // preserveDrawingBuffer: false のままでも、間に描画フレームを挟まなければ読める。
    if (ditherPass) {
      ditherPass.render(renderer, scene, camera);
    } else {
      renderer.render(scene, camera);
      if (bloomPass) {
        bloomPass.renderBloomOverlay(renderer, scene, camera);
      }
    }
    const url = renderer.domElement.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${visualStyleId}-${label}-${stamp}-yaw${yaw}.png`;
    anchor.click();
  }

  sculpture.group.quaternion.copy(savedQuaternion);
  camera.position.copy(savedPosition);
  if (savedAspect !== null && camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = savedAspect;
  }
  resize();
  setStatus(`検証用キャプチャを3枚保存しました（${label}）`);
};

const initCapturePanel = () => {
  const panel = document.querySelector<HTMLElement>("#capture-panel");
  const button = document.querySelector<HTMLButtonElement>("#capture-verify");
  if (!panel || !button || !devSurface) return;
  panel.hidden = false;
  button.addEventListener("click", () => {
    captureVerificationShots();
  });
};

/**
 * 曲による色の振れ幅（`audio-palette.ts` の `songColorSpan`）の dev パネル。
 *
 * ブルーム等と違って**即時反映ではない。** 完成時のパレット導出で使う値なので、
 * 変えたら Reset して録り直さないと結果が変わらない。パネルの注記にもそう書いてある。
 */
const initSongColorPanel = () => {
  const panel = document.querySelector<HTMLElement>("#songcolor-panel");
  const root = document.querySelector<HTMLElement>("#songcolor-sliders");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-songcolor");
  if (!panel || !root || !devSurface) return;
  panel.hidden = false;

  const specs = [
    {
      key: "hue" as const,
      label: "色相の幅",
      help: "1 で従来（曲によって色相環をほぼ一周する）。0 で曲による色相差なし。実測では従来の曲間の色相の広がりは 0.436（0.5 = 補色）だった。",
      get: () => songColorSpan.hue,
      set: (v: number) => {
        songColorSpan.hue = v;
      },
      reset: DEFAULT_SONG_HUE_SPAN,
    },
    {
      key: "sat" as const,
      label: "彩度の幅",
      help: "曲によるビビッドさの差。色相だけ縮めても、ある曲だけ鮮やかだと色が第一印象を持っていく。",
      get: () => songColorSpan.sat,
      set: (v: number) => {
        songColorSpan.sat = v;
      },
      reset: DEFAULT_SONG_SAT_SPAN,
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();

  for (const spec of specs) {
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
    help.id = `songcolor-help-${spec.key}`;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", help.id);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    valueLabel.textContent = spec.get().toFixed(2);
    row.append(label, input, valueLabel, help);
    root.appendChild(row);
    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      valueLabel.textContent = value.toFixed(2);
      refreshTuningExport();
    });
  }

  resetButton?.addEventListener("click", () => {
    for (const spec of specs) {
      spec.set(spec.reset);
      const input = inputs.get(spec.key);
      const valueLabel = valueLabels.get(spec.key);
      if (input) input.value = String(spec.reset);
      if (valueLabel) valueLabel.textContent = spec.reset.toFixed(2);
    }
    refreshTuningExport();
  });
};

/**
 * 混色（時刻・天気・曲を面内で暖⇔寒に混ぜる）の dev パネル。
 * vita の core にしか入っていないのでそれ以外ではパネルごと出さない。
 * 焼き直しは形成中に走るので「形成中は即時反映」。
 */
const initColorMixPanel = () => {
  const panel = document.querySelector<HTMLElement>("#colormix-panel");
  const root = document.querySelector<HTMLElement>("#colormix-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-colormix");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-colormix");
  if (!panel || !root || !visualStyle.membrane.vita || !devSurface) return;
  panel.hidden = false;

  const specs = [
    {
      key: "spread" as const,
      label: "広がり",
      help: "暖極⇔寒極の開き（色相単位）。0 で従来の単色＋ノイズ。上げるほど1つの塊にオレンジと青が同居する。0.25 を超えると補色対比が強くなりすぎる場合がある。",
      min: 0,
      max: 0.4,
      step: 0.005,
      get: () => pearlColorMix.spread,
      set: (v: number) => {
        pearlColorMix.spread = v;
      },
      reset: DEFAULT_PEARL_MIX_SPREAD,
    },
    {
      key: "balance" as const,
      label: "配分の偏り",
      help: "面内の寒側の面積。負で暖色寄り、正で寒色寄り。曲の明るさ・天気（雲/雨）でも自動で動く。",
      min: -0.4,
      max: 0.4,
      step: 0.01,
      get: () => pearlColorMix.balance,
      set: (v: number) => {
        pearlColorMix.balance = v;
      },
      reset: DEFAULT_PEARL_MIX_BALANCE,
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();
  let lastSpread = pearlColorMix.spread || DEFAULT_PEARL_MIX_SPREAD;

  // 完成後は焼き直しが止まるので、変更を即時に見せるため明示的に焼き直す。
  const rebakeNow = () => {
    (sculpture as { rebakeCoreColors?: () => void }).rebakeCoreColors?.();
    refreshTuningExport();
  };

  const syncToggle = () => {
    if (!toggleButton) return;
    toggleButton.textContent =
      (pearlColorMix.enabled ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
  };

  for (const spec of specs) {
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
    help.id = `colormix-help-${spec.key}`;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", help.id);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    valueLabel.textContent = spec.get().toFixed(3);
    row.append(label, input, valueLabel, help);
    root.appendChild(row);
    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      valueLabel.textContent = value.toFixed(3);
      if (spec.key === "spread" && value > 0) {
        lastSpread = value;
        pearlColorMix.enabled = true;
        syncToggle();
      }
      rebakeNow();
    });
  }

  toggleButton?.addEventListener("click", () => {
    pearlColorMix.enabled = !pearlColorMix.enabled;
    if (pearlColorMix.enabled && pearlColorMix.spread <= 0) {
      pearlColorMix.spread = lastSpread;
      const input = inputs.get("spread");
      const valueLabel = valueLabels.get("spread");
      if (input) input.value = String(pearlColorMix.spread);
      if (valueLabel) valueLabel.textContent = pearlColorMix.spread.toFixed(3);
    }
    syncToggle();
    rebakeNow();
  });

  resetButton?.addEventListener("click", () => {
    pearlColorMix.enabled = true;
    for (const spec of specs) {
      spec.set(spec.reset);
      const input = inputs.get(spec.key);
      const valueLabel = valueLabels.get(spec.key);
      if (input) input.value = String(spec.reset);
      if (valueLabel) valueLabel.textContent = spec.reset.toFixed(3);
    }
    lastSpread = DEFAULT_PEARL_MIX_SPREAD;
    syncToggle();
    rebakeNow();
  });

  syncToggle();
};

/**
 * 音色で形の語彙を分ける（鉱物/丸み）の dev パネル。vita だけ。
 * 「軸=固定」で音色軸を強制（曲に依らず A/B できる）、自動時は曲の音色（grit）で決まる。
 * faceting は毎フレームの変形で効くので即時反映（完成後も反映される）。
 */
/**
 * 熟成度パネル（[P1]）。**vita + dev のときだけ出す。**
 *
 * 現在値の表示（自動 / 固定・蓄積量ぶん・進行度）と、0〜1 の固定スライダー。
 * **固定できないと、曲を最後まで聴かないと途中の見た目を確認できない**ので、
 * step 2 以降の追い込みはこのパネルでやる。
 */
const initMaturityPanel = () => {
  const panel = document.querySelector<HTMLElement>("#maturity-panel");
  const root = document.querySelector<HTMLElement>("#maturity-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-maturity-override");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-maturity");
  if (!panel || !root || !visualStyle.membrane.vita || !devSurface) return;
  panel.hidden = false;

  // 熟成度の読み出し。`maturity_probe.js` が読む。**軸のときと同じ理由で消さないこと。**
  (window as unknown as { __maturity?: typeof maturityDebug }).__maturity = maturityDebug;
  const readout = document.createElement("div");
  readout.className = "tuning-slider__help";
  root.appendChild(readout);
  const refreshReadout = () => {
    readout.textContent =
      `熟成度 ${maturityDebug.maturity.toFixed(2)}（${maturityDebug.override ? "固定" : "自動"}）` +
      ` / 蓄積量ぶん ${maturityDebug.fromAccum.toFixed(2)}` +
      ` / 進行度 ${maturityDebug.progress >= 0 ? maturityDebug.progress.toFixed(2) : "—"}` +
      ` / 蓄積 ${maturityDebug.scalarMean.toFixed(3)}`;
    requestAnimationFrame(refreshReadout);
  };
  refreshReadout();

  let overrideValue = 0.5;
  let overrideOn = maturityMix.override >= 0;

  const row = document.createElement("label");
  row.className = "tuning-slider";
  const label = document.createElement("span");
  label.className = "tuning-slider__label";
  label.textContent = "熟成度（0=生まれたて / 1=完成）";
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.02";
  input.value = String(overrideValue);
  const valueLabel = document.createElement("span");
  valueLabel.className = "tuning-slider__value";
  valueLabel.textContent = overrideValue.toFixed(2);
  row.append(label, input, valueLabel);
  root.appendChild(row);
  input.addEventListener("input", () => {
    overrideValue = Number(input.value);
    valueLabel.textContent = overrideValue.toFixed(2);
    if (overrideOn) {
      maturityMix.override = overrideValue;
    }
  });

  const syncToggle = () => {
    if (!toggleButton) return;
    toggleButton.textContent = overrideOn
      ? toggleButton.dataset.labelOn ?? "熟成度=固定"
      : toggleButton.dataset.labelOff ?? "熟成度=自動";
    toggleButton.dataset.active = overrideOn ? "true" : "false";
  };

  toggleButton?.addEventListener("click", () => {
    overrideOn = !overrideOn;
    maturityMix.override = overrideOn ? overrideValue : -1;
    syncToggle();
  });

  resetButton?.addEventListener("click", () => {
    overrideOn = false;
    overrideValue = 0.5;
    maturityMix.override = -1;
    maturityMix.enabled = true;
    input.value = String(overrideValue);
    valueLabel.textContent = overrideValue.toFixed(2);
    syncToggle();
  });

  syncToggle();
};

const initMineralPanel = () => {
  const panel = document.querySelector<HTMLElement>("#mineral-panel");
  const root = document.querySelector<HTMLElement>("#mineral-sliders");
  const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-mineral-override");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset-mineral");
  if (!panel || !root || !visualStyle.membrane.vita || !devSurface) return;
  panel.hidden = false;

  // 音色軸の現在値を出す。**自動時に軸がいくつなのかが見えないと強度を決められない**
  // （軸 0 の曲では「宝石強度」を 2 にしても掛け算で 0 になる）。headless も同じものを読む。
  (window as unknown as { __mineralAxis?: typeof mineralDebug }).__mineralAxis = mineralDebug;
  const readout = document.createElement("div");
  readout.className = "tuning-slider__help";
  root.appendChild(readout);
  const refreshReadout = () => {
    readout.textContent =
      `軸 ${mineralDebug.axis.toFixed(2)}（${mineralDebug.override ? "固定" : "自動"}）` +
      ` / グリット平均 ${mineralDebug.gritAvg.toFixed(3)}` +
      ` / 曲の軸 ${mineralDebug.mineral.toFixed(2)}` +
      ` / organic ${mineralDebug.organic.toFixed(2)}`;
    requestAnimationFrame(refreshReadout);
  };
  refreshReadout();

  let overrideValue = 0.5;
  let overrideOn = mineralMix.axisOverride >= 0;

  const specs = [
    {
      key: "axis" as const,
      label: "音色軸（鉱物←→丸み）",
      help: "0=丸み（現状）, 1=鉱物（結晶ファセット・角・棘）。「軸=固定」のときだけ効く。自動時は曲の歪み/グリットで決まる。",
      min: 0,
      max: 1,
      step: 0.02,
      get: () => overrideValue,
      set: (v: number) => {
        overrideValue = v;
        if (overrideOn) mineralMix.axisOverride = v;
      },
      reset: 0.5,
    },
    {
      key: "facet" as const,
      label: "ファセット強度",
      help: "結晶平面へ寄せる量の倍率。上げるほど平らな面と鋭い稜が強く出る。上げすぎると多面体化して曲差が消える。",
      min: 0,
      max: 2,
      step: 0.05,
      get: () => mineralMix.facetStrength,
      set: (v: number) => {
        mineralMix.facetStrength = v;
      },
      reset: DEFAULT_MINERAL_FACET_STRENGTH,
    },
    {
      key: "gem" as const,
      label: "宝石強度（材質）",
      help: "結晶面の光学の master。0 で結晶面も粘土のまま。面の枚数は「音色軸」が決めるので、ここは1枚あたりの見え方の強さ。仮値、曲を鳴らして確定。",
      min: 0,
      max: 2,
      step: 0.05,
      get: () => gemUniforms.uGem.value,
      set: (v: number) => {
        gemUniforms.uGem.value = v;
      },
      reset: DEFAULT_GEM_STRENGTH,
    },
    {
      key: "gemDark" as const,
      label: "結晶面の地の暗さ",
      help: "1=粘土色のまま／小さいほど地が暗くなる。宝石は暗い地＋鋭い光で見える。ここを下げないと「キラキラした粘土」にしかならない。",
      min: 0,
      max: 1,
      step: 0.02,
      get: () => gemUniforms.uGemBodyDark.value,
      set: (v: number) => {
        gemUniforms.uGemBodyDark.value = v;
      },
      reset: DEFAULT_GEM_BODY_DARK,
    },
    {
      key: "gemRidge" as const,
      label: "稜（面の境界）の光",
      help: "カットの角が線で光る量。上げるほど多面体の稜がはっきりする。",
      min: 0,
      max: 2,
      step: 0.05,
      get: () => gemUniforms.uGemRidge.value,
      set: (v: number) => {
        gemUniforms.uGemRidge.value = v;
      },
      reset: DEFAULT_GEM_RIDGE,
    },
    {
      key: "gemSparkle" as const,
      label: "面の閃き",
      help: "回転で面ごとに走る鋭いハイライト。暗い深海では env 反射が出ないので自前で焚いている。",
      min: 0,
      max: 2.5,
      step: 0.05,
      get: () => gemUniforms.uGemSparkle.value,
      set: (v: number) => {
        gemUniforms.uGemSparkle.value = v;
      },
      reset: DEFAULT_GEM_SPARKLE,
    },
    {
      key: "gemThrough" as const,
      label: "透過（水晶らしさ）",
      help: "面の裏から回り込む光。暗く落とした地がここで「透けて」見える。上げすぎると発光体になる。",
      min: 0,
      max: 1.5,
      step: 0.05,
      get: () => gemUniforms.uGemThrough.value,
      set: (v: number) => {
        gemUniforms.uGemThrough.value = v;
      },
      reset: DEFAULT_GEM_THROUGH,
    },
    {
      key: "gemFire" as const,
      label: "分散（fire）の色づき",
      help: "0 で白のみ＝色を主役にしない（原則「色は脇役」）。上げるほど面ごとに虹色が出る。",
      min: 0,
      max: 1,
      step: 0.05,
      get: () => gemUniforms.uGemFire.value,
      set: (v: number) => {
        gemUniforms.uGemFire.value = v;
      },
      reset: DEFAULT_GEM_FIRE,
    },
  ];

  const inputs = new Map<string, HTMLInputElement>();
  const valueLabels = new Map<string, HTMLElement>();

  const syncToggle = () => {
    if (!toggleButton) return;
    toggleButton.textContent =
      (overrideOn ? toggleButton.dataset.labelOn : toggleButton.dataset.labelOff) ?? "";
  };

  for (const spec of specs) {
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
    help.id = `mineral-help-${spec.key}`;
    label.setAttribute("aria-expanded", "false");
    label.setAttribute("aria-controls", help.id);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    const valueLabel = document.createElement("span");
    valueLabel.className = "tuning-slider__value";
    valueLabel.textContent = spec.get().toFixed(2);
    row.append(label, input, valueLabel, help);
    root.appendChild(row);
    inputs.set(spec.key, input);
    valueLabels.set(spec.key, valueLabel);

    label.addEventListener("click", (event) => {
      event.preventDefault();
      const next = help.hidden;
      help.hidden = !next;
      label.setAttribute("aria-expanded", next ? "true" : "false");
    });

    input.addEventListener("input", () => {
      const value = Number(input.value);
      spec.set(value);
      valueLabel.textContent = value.toFixed(2);
    });
  }

  toggleButton?.addEventListener("click", () => {
    overrideOn = !overrideOn;
    mineralMix.axisOverride = overrideOn ? overrideValue : -1;
    syncToggle();
  });

  resetButton?.addEventListener("click", () => {
    overrideOn = false;
    overrideValue = 0.5;
    mineralMix.axisOverride = -1;
    mineralMix.facetStrength = DEFAULT_MINERAL_FACET_STRENGTH;
    gemUniforms.uGem.value = DEFAULT_GEM_STRENGTH;
    gemUniforms.uGemBodyDark.value = DEFAULT_GEM_BODY_DARK;
    gemUniforms.uGemRidge.value = DEFAULT_GEM_RIDGE;
    gemUniforms.uGemSparkle.value = DEFAULT_GEM_SPARKLE;
    gemUniforms.uGemThrough.value = DEFAULT_GEM_THROUGH;
    gemUniforms.uGemFire.value = DEFAULT_GEM_FIRE;
    for (const spec of specs) {
      const input = inputs.get(spec.key);
      const valueLabel = valueLabels.get(spec.key);
      if (input) input.value = String(spec.reset);
      if (valueLabel) valueLabel.textContent = spec.reset.toFixed(2);
    }
    syncToggle();
  });

  syncToggle();
};

initBloomPanel();
initEnvPanel();
initGrainPanel();
initMembraneRelaxPanel();
initSongColorPanel();
initColorMixPanel();
initMaturityPanel();
initMineralPanel();
initCapturePanel();
updateKeyLight();
render();
