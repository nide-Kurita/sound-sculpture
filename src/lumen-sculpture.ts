import * as THREE from "three";
import type { SculpturePalette } from "./audio-palette";
import type { SpeciesProfile } from "./species-profile";
import type { StructureSnapshot } from "./structure-tracker";
import {
  clamp01,
  seededUnit,
  SILENCE_THRESHOLD,
  smoothstep,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
} from "./sculpture-types";

/** 見た目を保ちつつ CPU を抑える密度（加算ブレンドで埋まる） */
const CORE_COUNT = 18000;
const SPRAY_COUNT = 1800;
const DUST_COUNT = 480;
/** 毎フレーム全点更新せず、ストライドで分割 */
const UPDATE_STRIDE = 2;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const defaultRhythm = (): RhythmEvents => ({
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
});

let sharedSoftPointMap: THREE.CanvasTexture | null = null;
const getSoftPointMap = () => {
  if (sharedSoftPointMap) return sharedSoftPointMap;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.7)");
  g.addColorStop(0.65, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sharedSoftPointMap = new THREE.CanvasTexture(canvas);
  sharedSoftPointMap.colorSpace = THREE.SRGBColorSpace;
  return sharedSoftPointMap;
};

const fibonacciDir = (index: number, total: number, out: THREE.Vector3) => {
  const t = index + 0.5;
  const y = 1 - (t / total) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * t;
  out.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
};

/** curlNoise より軽い 3D ゆらぎ（粒子ごとの高コスト差分を避ける） */
const softWarpInto = (
  x: number,
  y: number,
  z: number,
  salt: number,
  out: { x: number; y: number; z: number },
) => {
  const a = Math.sin(x * 3.7 + salt) * Math.cos(y * 2.9 - salt * 0.6);
  const b = Math.sin(y * 4.1 + z * 2.2 + salt * 1.3);
  const c = Math.cos(z * 3.4 - x * 1.8 + salt * 0.7);
  out.x = a * 0.55 + c * 0.2;
  out.y = b * 0.5 + a * 0.2;
  out.z = c * 0.55 + b * 0.15;
};

/**
 * 闇の中の粒子雲。音エネルギーで膨らみ、帯域で色とほつれが変わる。
 * 既存の膜/コア造形は使わない。
 */
export class LumenSculpture implements SculptureExperience {
  readonly group = new THREE.Group();

  private readonly corePositions: Float32Array;
  private readonly coreColors: Float32Array;
  private readonly coreDirs: Float32Array;
  private readonly coreLayer: Float32Array;
  private readonly corePhase: Float32Array;
  private readonly coreAng: Float32Array;
  private readonly coreTearJitter: Float32Array;
  private readonly coreGeometry: THREE.BufferGeometry;
  private readonly coreMaterial: THREE.PointsMaterial;
  private readonly corePoints: THREE.Points;

  private readonly sprayPositions: Float32Array;
  private readonly sprayColors: Float32Array;
  private readonly sprayVel: Float32Array;
  private readonly sprayLife: Float32Array;
  private readonly sprayGeometry: THREE.BufferGeometry;
  private readonly sprayMaterial: THREE.PointsMaterial;
  private readonly sprayPoints: THREE.Points;
  private sprayDirty = false;

  private readonly dustPositions: Float32Array;
  private readonly dustColors: Float32Array;
  private readonly dustOrbit: Float32Array;
  private readonly dustY: Float32Array;
  private readonly dustR: Float32Array;
  private readonly dustRate: Float32Array;
  private readonly dustGeometry: THREE.BufferGeometry;
  private readonly dustMaterial: THREE.PointsMaterial;
  private readonly dustPoints: THREE.Points;

  private readonly accentGlow: THREE.Mesh;
  private readonly accentMat: THREE.MeshBasicMaterial;
  private readonly sprayOrigin = new THREE.Vector3();

  private seed = 1;
  private time = 0;
  private forming = 0;
  private energySmoothed = 0;
  private pulse = 0;
  private completed = false;
  private breathe = 0;
  private idlePhase = 0;
  private colorShift = 0;
  private heldForm = 0;
  private updatePhase = 0;
  private dustFrame = 0;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpWarp = { x: 0, y: 0, z: 0 };
  private readonly colorA = new THREE.Color(0xd01038);
  private readonly colorB = new THREE.Color(0x5a8cff);
  private readonly colorC = new THREE.Color(0xe8f2ff);

  constructor() {
    this.group.name = "LumenSculpture";

    this.coreDirs = new Float32Array(CORE_COUNT * 3);
    this.coreLayer = new Float32Array(CORE_COUNT);
    this.corePhase = new Float32Array(CORE_COUNT);
    this.coreAng = new Float32Array(CORE_COUNT);
    this.coreTearJitter = new Float32Array(CORE_COUNT * 2);
    this.corePositions = new Float32Array(CORE_COUNT * 3);
    this.coreColors = new Float32Array(CORE_COUNT * 3);

    for (let i = 0; i < CORE_COUNT; i += 1) {
      fibonacciDir(i, CORE_COUNT, this.tmpDir);
      const layer = Math.pow(seededUnit(i, 11.3), 0.62);
      const jitter = 0.04 + seededUnit(i, 29.1) * 0.12;
      const nx = this.tmpDir.x + (seededUnit(i, 3.1) - 0.5) * jitter;
      const ny = this.tmpDir.y + (seededUnit(i, 7.7) - 0.5) * jitter;
      const nz = this.tmpDir.z + (seededUnit(i, 13.9) - 0.5) * jitter;
      const len = Math.hypot(nx, ny, nz) || 1;
      const di = i * 3;
      this.coreDirs[di] = nx / len;
      this.coreDirs[di + 1] = ny / len;
      this.coreDirs[di + 2] = nz / len;
      this.coreLayer[i] = layer;
      this.corePhase[i] = seededUnit(i, 41.7) * Math.PI * 2;
      this.coreAng[i] = Math.atan2(nz / len, nx / len);
      this.coreTearJitter[i * 2] = seededUnit(i, 2.2) - 0.2;
      this.coreTearJitter[i * 2 + 1] = seededUnit(i, 4.4) - 0.5;
    }

    this.coreGeometry = new THREE.BufferGeometry();
    this.coreGeometry.setAttribute("position", new THREE.BufferAttribute(this.corePositions, 3));
    this.coreGeometry.setAttribute("color", new THREE.BufferAttribute(this.coreColors, 3));

    this.coreMaterial = new THREE.PointsMaterial({
      size: 0.055,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.corePoints = new THREE.Points(this.coreGeometry, this.coreMaterial);
    this.corePoints.frustumCulled = false;

    this.sprayPositions = new Float32Array(SPRAY_COUNT * 3);
    this.sprayColors = new Float32Array(SPRAY_COUNT * 3);
    this.sprayVel = new Float32Array(SPRAY_COUNT * 3);
    this.sprayLife = new Float32Array(SPRAY_COUNT);
    for (let i = 0; i < SPRAY_COUNT; i += 1) {
      this.sprayPositions[i * 3 + 1] = -99;
    }
    this.sprayGeometry = new THREE.BufferGeometry();
    this.sprayGeometry.setAttribute("position", new THREE.BufferAttribute(this.sprayPositions, 3));
    this.sprayGeometry.setAttribute("color", new THREE.BufferAttribute(this.sprayColors, 3));
    this.sprayMaterial = new THREE.PointsMaterial({
      size: 0.055,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.sprayPoints = new THREE.Points(this.sprayGeometry, this.sprayMaterial);
    this.sprayPoints.frustumCulled = false;

    this.dustPositions = new Float32Array(DUST_COUNT * 3);
    this.dustColors = new Float32Array(DUST_COUNT * 3);
    this.dustOrbit = new Float32Array(DUST_COUNT);
    this.dustY = new Float32Array(DUST_COUNT);
    this.dustR = new Float32Array(DUST_COUNT);
    this.dustRate = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      this.dustOrbit[i] = seededUnit(i, 12.1) * Math.PI * 2;
      this.dustY[i] = seededUnit(i, 14.2) - 0.4;
      this.dustR[i] = 0.55 + seededUnit(i, 16.3) * 0.9;
      this.dustRate[i] = 0.08 + seededUnit(i, 6.6) * 0.12;
      const di = i * 3;
      this.dustColors[di] = 0.55 + seededUnit(i, 1.2) * 0.45;
      this.dustColors[di + 1] = 0.35 + seededUnit(i, 2.4) * 0.35;
      this.dustColors[di + 2] = 0.75 + seededUnit(i, 3.6) * 0.25;
    }
    this.dustGeometry = new THREE.BufferGeometry();
    this.dustGeometry.setAttribute("position", new THREE.BufferAttribute(this.dustPositions, 3));
    this.dustGeometry.setAttribute("color", new THREE.BufferAttribute(this.dustColors, 3));
    this.dustMaterial = new THREE.PointsMaterial({
      size: 0.028,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.dustPoints = new THREE.Points(this.dustGeometry, this.dustMaterial);
    this.dustPoints.frustumCulled = false;

    this.accentMat = new THREE.MeshBasicMaterial({
      color: 0xff3a9a,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    this.accentGlow = new THREE.Mesh(new THREE.SphereGeometry(6.5, 24, 16), this.accentMat);
    this.accentGlow.position.set(3.8, 2.4, -5.5);
    this.accentGlow.renderOrder = -2;

    this.group.add(this.accentGlow, this.dustPoints, this.corePoints, this.sprayPoints);
    this.group.position.y = -0.15;
    this.reset(Math.floor(Math.random() * 1e9));
  }

  applyLiveTuningNow() {}

  pokeIdle() {
    this.pulse = Math.min(1, this.pulse + 0.55);
  }

  getPointerTargets() {
    return [this.corePoints];
  }

  pokeSurface(localPoint: THREE.Vector3) {
    this.pulse = Math.min(1, this.pulse + 0.4);
    this.emitSprayBurst(localPoint, 0.85, 80);
  }

  nudgeClayColorOnClick() {
    this.colorShift = (this.colorShift + 0.07) % 1;
  }

  applyAlgoMorphBias() {}

  holdShapeForCompletion() {
    this.heldForm = this.forming;
  }

  prepareCompletion(_palette: SculpturePalette, _species?: SpeciesProfile) {
    this.heldForm = this.forming;
  }

  complete() {
    this.completed = true;
    this.heldForm = Math.max(this.heldForm, this.forming, 0.72);
    this.forming = this.heldForm;
  }

  reset(seed = 1) {
    this.seed = seed || 1;
    this.time = 0;
    this.forming = 0.08;
    this.heldForm = 0;
    this.energySmoothed = 0;
    this.pulse = 0;
    this.completed = false;
    this.breathe = 0;
    this.idlePhase = 0;
    this.colorShift = seededUnit(seed, 0.37) * 0.12;
    this.updatePhase = 0;
    this.sprayLife.fill(0);
    for (let i = 0; i < SPRAY_COUNT; i += 1) {
      this.sprayPositions[i * 3 + 1] = -99;
    }
    const silent: AudioBands = {
      sub: 0,
      low: 0,
      mid: 0,
      melody: 0,
      high: 0,
      overall: 0,
      centroid: 0.5,
      bassFocus: 0,
      melodyFocus: 0,
      brightness: 0.4,
      contrast: 0.3,
    };
    // 初期は全点を一度だけ埋める
    this.rebuildCore(0.08, silent, 0, 1);
    this.updateDust(0.08);
  }

  createExportGroup() {
    const exportGroup = new THREE.Group();
    exportGroup.name = "Lumen Sculpture";
    exportGroup.rotation.copy(this.group.rotation);
    const geom = this.coreGeometry.clone();
    const mat = new THREE.PointsMaterial({
      size: 0.05,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    exportGroup.add(new THREE.Points(geom, mat));
    return exportGroup;
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    _userViewInteracting?: boolean,
    rhythm?: RhythmEvents,
    _structure?: StructureSnapshot,
    _species?: SpeciesProfile,
  ) {
    const r = rhythm ?? defaultRhythm();
    const dt = Math.min(0.05, Math.max(0, deltaTime));
    this.time += dt;
    this.idlePhase += dt;

    const loud = bands.overall > SILENCE_THRESHOLD;
    const energyTarget = loud
      ? clamp01(bands.overall * 1.35 + bands.bassFocus * 0.25 + r.pulseEnvelope * 0.2)
      : 0;
    this.energySmoothed += (energyTarget - this.energySmoothed) * Math.min(1, dt * 3.2);

    if (!this.completed) {
      const grow =
        this.energySmoothed * dt * (0.085 + bands.mid * 0.04 + bands.melodyFocus * 0.03);
      this.forming = clamp01(this.forming + grow);
      if (!loud && this.forming > 0.12) {
        this.forming = Math.max(0.12, this.forming - dt * 0.012);
      }
    } else {
      this.forming = this.heldForm;
      this.breathe += dt;
    }

    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.pulse = Math.min(
      1,
      this.pulse + r.kick * 0.55 + r.transient * 0.35 + r.snare * 0.22,
    );

    if (loud && (r.kick > 0.55 || r.transient > 0.7) && Math.random() < 0.28) {
      const side = seededUnit(Math.floor(this.time * 40), 9.1) > 0.5 ? -1 : 1;
      this.sprayOrigin.set(side * 0.6, 0.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5);
      this.emitSprayBurst(
        this.sprayOrigin,
        0.55 + this.energySmoothed * 0.7,
        40 + Math.floor(this.energySmoothed * 50),
      );
    }

    const form = this.completed && this.heldForm > 0 ? this.heldForm : this.forming;

    this.updatePhase = (this.updatePhase + 1) % UPDATE_STRIDE;
    this.rebuildCore(form, bands, this.updatePhase, UPDATE_STRIDE);
    this.updateSpray(dt);
    this.dustFrame += 1;
    if (this.dustFrame % 2 === 0) {
      this.updateDust(form);
    }
    this.accentMat.opacity = 0.1 + this.energySmoothed * 0.08 + form * 0.04;
  }

  private rebuildCore(form: number, bands: AudioBands, phase: number, stride: number) {
    const open = smoothstep(0.05, 0.95, form);
    const breathe =
      this.completed
        ? 1 + Math.sin(this.breathe * 1.1) * 0.018
        : 1 + Math.sin(this.idlePhase * 0.7) * 0.012 * (1 - open * 0.5);
    const pulseBoost = 1 + this.pulse * 0.07;
    const baseRadius = (0.42 + open * 1.55) * breathe * pulseBoost;
    const stretchY = 1.08 + open * 0.22;
    const stretchXZ = 0.92 + open * 0.18;
    const radiusOpen = 0.55 + open * 0.45;

    const bass = bands.sub * 0.55 + bands.low * 0.45;
    const mid = bands.mid * 0.55 + bands.melody * 0.45;
    const high = bands.high;
    const warpSalt = this.time * 0.35 + this.seed * 0.001;

    const lobeA = 0.18 + bass * 0.55;
    const lobeB = 0.12 + mid * 0.48;
    const lobeC = 0.08 + high * 0.42;
    const tear = clamp01(this.pulse * 0.85 + high * 0.45 + bands.brightness * 0.2);
    const curlAmpBase = 0.04 + open * 0.14 + mid * 0.08;
    const shift = this.colorShift * 0.35;
    const caR = this.colorA.r;
    const caG = this.colorA.g;
    const caB = this.colorA.b;
    const cbR = this.colorB.r;
    const cbG = this.colorB.g;
    const cbB = this.colorB.b;
    const ccR = this.colorC.r;
    const ccG = this.colorC.g;
    const ccB = this.colorC.b;
    const tSin = Math.sin(this.time);

    for (let i = phase; i < CORE_COUNT; i += stride) {
      const di = i * 3;
      const dx = this.coreDirs[di];
      const dy = this.coreDirs[di + 1];
      const dz = this.coreDirs[di + 2];
      const layer = this.coreLayer[i];
      const phaseI = this.corePhase[i];
      const ang = this.coreAng[i];

      const petal =
        1 +
        Math.cos(ang * 3 + phaseI) * lobeA * (0.35 + layer) +
        Math.cos(ang * 5 - phaseI * 1.3) * lobeB * layer +
        Math.sin(dy * Math.PI * 2 + phaseI) * lobeC * 0.65;

      let radius = baseRadius * (0.22 + layer * 0.92) * petal * radiusOpen;

      softWarpInto(dx * 1.6, dy * 1.6 + this.time * 0.12, dz * 1.6, warpSalt + i * 0.002, this.tmpWarp);
      const curlAmp = curlAmpBase * (0.4 + layer);
      let px = dx * radius * stretchXZ + this.tmpWarp.x * curlAmp;
      let py = dy * radius * stretchY + this.tmpWarp.y * curlAmp * 0.85;
      let pz = dz * radius * stretchXZ + this.tmpWarp.z * curlAmp;

      const tearMask = clamp01((-dx * 0.55 + 0.35 + Math.sin(phaseI) * 0.12 * tSin + 0.08) * tear);
      if (tearMask > 0.05) {
        const spray = tearMask * tearMask * (0.15 + high * 0.55);
        px += dx * spray * 0.35 - spray * 0.55;
        py += this.coreTearJitter[i * 2] * spray * 0.8;
        pz += dz * spray * 0.25 + this.coreTearJitter[i * 2 + 1] * spray * 0.4;
      }

      this.corePositions[di] = px;
      this.corePositions[di + 1] = py - 0.35;
      this.corePositions[di + 2] = pz;

      const heightT = clamp01((py + 1.2) / 2.6);
      const rim = clamp01(layer * 0.75 + heightT * 0.55 + high * 0.15);
      const heat = clamp01(1 - rim + bass * 0.25 + this.pulse * 0.15);
      let r = caR + (cbR - caR) * rim;
      let g = caG + (cbG - caG) * rim;
      let b = caB + (cbB - caB) * rim;
      if (rim > 0.72) {
        const t = (rim - 0.72) / 0.28;
        r += (ccR - r) * t;
        g += (ccG - g) * t;
        b += (ccB - b) * t;
      }
      this.coreColors[di] = clamp01(r * (0.85 + heat * 0.4) + shift * 0.15);
      this.coreColors[di + 1] = clamp01(g * (0.75 + rim * 0.35) - shift * 0.05);
      this.coreColors[di + 2] = clamp01(b * (0.9 + rim * 0.2) + shift * 0.1);
    }

    (this.coreGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.coreGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    this.coreMaterial.size = 0.048 + open * 0.018 + this.pulse * 0.008;
    this.coreMaterial.opacity = 0.78 + open * 0.14;
  }

  private emitSprayBurst(origin: THREE.Vector3, strength: number, count: number) {
    let spawned = 0;
    const budget = Math.min(count, 90);
    for (let i = 0; i < SPRAY_COUNT && spawned < budget; i += 1) {
      if (this.sprayLife[i] > 0.05) continue;
      const di = i * 3;
      const u = seededUnit(i + Math.floor(this.time * 100), 1.7);
      const v = seededUnit(i + Math.floor(this.time * 100), 2.9);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sp = (0.6 + seededUnit(i, 5.1) * 1.8) * strength;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.cos(phi);
      const sz = Math.sin(phi) * Math.sin(theta);
      this.sprayPositions[di] = origin.x + sx * 0.08;
      this.sprayPositions[di + 1] = origin.y + sy * 0.08;
      this.sprayPositions[di + 2] = origin.z + sz * 0.08;
      this.sprayVel[di] = sx * sp;
      this.sprayVel[di + 1] = sy * sp * 0.75 + 0.15;
      this.sprayVel[di + 2] = sz * sp;
      this.sprayLife[i] = 0.45 + seededUnit(i, 8.8) * 0.55;
      const hot = seededUnit(i, 3.3) > 0.35;
      this.sprayColors[di] = hot ? 1 : 0.45;
      this.sprayColors[di + 1] = hot ? 0.12 : 0.45;
      this.sprayColors[di + 2] = hot ? 0.28 : 1;
      spawned += 1;
    }
    this.sprayDirty = spawned > 0;
  }

  private updateSpray(dt: number) {
    let any = false;
    for (let i = 0; i < SPRAY_COUNT; i += 1) {
      if (this.sprayLife[i] <= 0) continue;
      any = true;
      const di = i * 3;
      this.sprayLife[i] -= dt * 0.85;
      if (this.sprayLife[i] <= 0) {
        this.sprayPositions[di + 1] = -99;
        continue;
      }
      this.sprayVel[di + 1] -= dt * 0.35;
      this.sprayPositions[di] += this.sprayVel[di] * dt;
      this.sprayPositions[di + 1] += this.sprayVel[di + 1] * dt;
      this.sprayPositions[di + 2] += this.sprayVel[di + 2] * dt;
      this.sprayColors[di] *= 0.985;
      this.sprayColors[di + 1] *= 0.985;
      this.sprayColors[di + 2] *= 0.985;
    }
    if (any || this.sprayDirty) {
      (this.sprayGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.sprayGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      this.sprayDirty = false;
    }
  }

  private updateDust(form: number) {
    const radius = 1.8 + form * 1.6;
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const di = i * 3;
      const phase = this.dustOrbit[i] + this.time * this.dustRate[i];
      const r = radius * this.dustR[i];
      this.dustPositions[di] = Math.cos(phase) * r;
      this.dustPositions[di + 1] = this.dustY[i] * radius * 1.4 + Math.sin(phase * 1.7) * 0.15;
      this.dustPositions[di + 2] = Math.sin(phase) * r;
    }
    (this.dustGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.dustMaterial.opacity = 0.22 + form * 0.28 + this.energySmoothed * 0.12;
  }
}
