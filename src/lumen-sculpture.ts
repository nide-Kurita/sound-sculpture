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

/**
 * lumen:
 * 内側の芯（質量）と放射線状の繊維を、薄い殻と粒子ヴェール越しに見せる。
 * 低域＝マゼンタ芯、高域＝青の輪郭、トランジェントで破片が飛ぶ。
 */

const VEIL_COUNT = 3500;
const FIBER_COUNT = 1600;
const SPRAY_COUNT = 1200;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const UPDATE_STRIDE = 2;

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

let softPointMap: THREE.CanvasTexture | null = null;
const getSoftPointMap = () => {
  if (softPointMap) return softPointMap;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.48);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  softPointMap = new THREE.CanvasTexture(canvas);
  softPointMap.colorSpace = THREE.SRGBColorSpace;
  return softPointMap;
};

const SHELL_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uForm;
uniform float uPulse;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBreath;
varying vec3 vObj;
varying vec3 vWorldN;
varying float vRim;
varying float vElev;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  vec3 n = normalize(normal);
  vec3 p = position;
  float open = smoothstep(0.05, 0.9, uForm);
  float ang = atan(p.z, p.x);
  float elev = p.y;

  float mass = 0.72 + uBass * 0.28;
  float surface =
    1.0
    + noise(p * 2.4 + vec3(uTime * 0.04, 0.0, 0.0)) * (0.06 + uMid * 0.12) * open
    + sin(elev * 3.5 + ang * 0.5) * (0.03 + uHigh * 0.1) * open;

  float grain = noise(p * 3.2 + vec3(0.0, uTime * 0.05, 0.0));
  float radius =
    (0.28 + open * 0.62) * surface * mass
    + grain * (0.03 + open * 0.04)
    + uPulse * 0.018;

  float stand = mix(0.9, 1.08, open);
  vec3 displaced = n * radius;
  displaced.y *= stand * uBreath;
  displaced.x *= mix(0.9, 0.98, open);
  displaced.z *= mix(0.9, 0.98, open);

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vObj = displaced;
  vWorldN = normalize(mat3(modelMatrix) * n);
  vec3 viewDir = normalize(cameraPosition - world.xyz);
  vRim = pow(1.0 - max(dot(vWorldN, viewDir), 0.0), 2.4);
  vElev = displaced.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHELL_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uForm;
uniform float uPulse;
uniform float uBass;
uniform float uHigh;
uniform float uShed;
uniform vec3 uMassColor;
uniform vec3 uStructColor;
uniform vec3 uEdgeColor;
varying vec3 vObj;
varying vec3 vWorldN;
varying float vRim;
varying float vElev;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  float open = smoothstep(0.05, 0.9, uForm);
  vec3 p = vObj * 2.4;
  float n1 = noise(p);
  float n2 = noise(p * 2.6 + 4.0);
  float carve = pow(1.0 - abs(n1 * 2.0 - 1.0), 3.2);
  float pore = pow(1.0 - abs(n2 * 2.0 - 1.0), 2.4);

  float depth = clamp(1.0 - length(vObj) * 0.55 + uBass * 0.15, 0.0, 1.0);
  float elevT = smoothstep(-0.7, 1.1, vElev);
  vec3 col = mix(uMassColor, uStructColor, elevT * 0.55 + (1.0 - depth) * 0.4);
  col = mix(col, uEdgeColor, carve * 0.18 + vRim * 0.2);
  col = mix(col, uMassColor * 1.1, uBass * 0.28 * depth);
  col += uEdgeColor * pore * uHigh * 0.06;
  col *= 0.9 + open * 0.1;

  float side = -normalize(vObj + 1e-4).x;
  float shedMask = smoothstep(0.15, 0.95, side * 0.65 + 0.4 + n2 * 0.15) * uShed;
  col = mix(col, col * 0.45, shedMask * 0.45);

  if (shedMask > 0.92 && n2 > 0.72) discard;

  col += uEdgeColor * vRim * 0.08;
  col += uMassColor * uPulse * 0.04 * depth;

  // 外側は薄く透かし、中の芯が見えるようにする
  float alpha = 0.18 + open * 0.14 + carve * 0.1 + vRim * 0.22;
  alpha = clamp(alpha, 0.08, 0.42);
  if (shedMask > 0.75) alpha *= 1.0 - shedMask * 0.55;

  gl_FragColor = vec4(col, alpha);
}
`;

const fibonacciDir = (index: number, total: number, out: THREE.Vector3) => {
  const t = index + 0.5;
  const y = 1 - (t / total) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * t;
  out.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
};

export class LumenSculpture implements SculptureExperience {
  readonly group = new THREE.Group();

  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;

  private readonly veilPositions: Float32Array;
  private readonly veilColors: Float32Array;
  private readonly veilDirs: Float32Array;
  private readonly veilPhase: Float32Array;
  private readonly veilGeometry: THREE.BufferGeometry;
  private readonly veilMaterial: THREE.PointsMaterial;
  private readonly veilPoints: THREE.Points;
  private updatePhase = 0;

  private readonly fiberPositions: Float32Array;
  private readonly fiberColors: Float32Array;
  private readonly fiberRoots: Float32Array;
  private readonly fiberTips: Float32Array;
  private readonly fiberPhase: Float32Array;
  private readonly fiberGeometry: THREE.BufferGeometry;
  private readonly fiberMaterial: THREE.LineBasicMaterial;
  private readonly fiberLines: THREE.LineSegments;
  private fiberFrame = 0;

  private readonly sprayPositions: Float32Array;
  private readonly sprayColors: Float32Array;
  private readonly sprayVel: Float32Array;
  private readonly sprayLife: Float32Array;
  private readonly sprayGeometry: THREE.BufferGeometry;
  private readonly sprayMaterial: THREE.PointsMaterial;
  private readonly sprayPoints: THREE.Points;
  private sprayDirty = false;

  private readonly sprayOrigin = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  private time = 0;
  private forming = 0;
  private energySmoothed = 0;
  private pulse = 0;
  private completed = false;
  private breathe = 0;
  private idlePhase = 0;
  private heldForm = 0;

  constructor() {
    this.group.name = "LumenSculpture";

    // 中身: はっきり見える芯
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xff2a62,
      transparent: true,
      opacity: 0.92,
      depthWrite: true,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), this.coreMat);
    this.core.renderOrder = 0;

    this.shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uForm: { value: 0.08 },
        uPulse: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uBreath: { value: 1 },
        uShed: { value: 0 },
        uMassColor: { value: new THREE.Color(0xff2a62) },
        uStructColor: { value: new THREE.Color(0x6a7ad8) },
        uEdgeColor: { value: new THREE.Color(0xe8f0ff) },
      },
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), this.shellMat);
    this.shell.renderOrder = 2;

    // 芯から殻へ伸びる放射線状の繊維
    this.fiberRoots = new Float32Array(FIBER_COUNT * 3);
    this.fiberTips = new Float32Array(FIBER_COUNT * 3);
    this.fiberPhase = new Float32Array(FIBER_COUNT);
    this.fiberPositions = new Float32Array(FIBER_COUNT * 6);
    this.fiberColors = new Float32Array(FIBER_COUNT * 6);
    for (let i = 0; i < FIBER_COUNT; i += 1) {
      fibonacciDir(i, FIBER_COUNT, this.tmpDir);
      const layer = 0.4 + seededUnit(i, 3.3) * 0.55;
      const di = i * 3;
      this.fiberRoots[di] = this.tmpDir.x * layer * 0.7;
      this.fiberRoots[di + 1] = this.tmpDir.y * layer * 0.7;
      this.fiberRoots[di + 2] = this.tmpDir.z * layer * 0.7;
      const tx = -this.tmpDir.z;
      const tz = this.tmpDir.x;
      const tLen = Math.hypot(tx, tz) || 1;
      const spread = 0.06 + seededUnit(i, 7.1) * 0.16;
      this.fiberTips[di] = this.tmpDir.x + (tx / tLen) * spread;
      this.fiberTips[di + 1] = this.tmpDir.y + (seededUnit(i, 9.2) - 0.3) * 0.28;
      this.fiberTips[di + 2] = this.tmpDir.z + (tz / tLen) * spread;
      const tipLen = Math.hypot(this.fiberTips[di], this.fiberTips[di + 1], this.fiberTips[di + 2]) || 1;
      this.fiberTips[di] /= tipLen;
      this.fiberTips[di + 1] /= tipLen;
      this.fiberTips[di + 2] /= tipLen;
      this.fiberPhase[i] = seededUnit(i, 11.4) * Math.PI * 2;
    }
    this.fiberGeometry = new THREE.BufferGeometry();
    this.fiberGeometry.setAttribute("position", new THREE.BufferAttribute(this.fiberPositions, 3));
    this.fiberGeometry.setAttribute("color", new THREE.BufferAttribute(this.fiberColors, 3));
    this.fiberMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fiberLines = new THREE.LineSegments(this.fiberGeometry, this.fiberMaterial);
    this.fiberLines.frustumCulled = false;
    this.fiberLines.renderOrder = 1;

    // 外側の薄い粒子ヴェール
    this.veilDirs = new Float32Array(VEIL_COUNT * 3);
    this.veilPhase = new Float32Array(VEIL_COUNT);
    this.veilPositions = new Float32Array(VEIL_COUNT * 3);
    this.veilColors = new Float32Array(VEIL_COUNT * 3);
    for (let i = 0; i < VEIL_COUNT; i += 1) {
      fibonacciDir(i, VEIL_COUNT, this.tmpDir);
      const di = i * 3;
      this.veilDirs[di] = this.tmpDir.x;
      this.veilDirs[di + 1] = this.tmpDir.y;
      this.veilDirs[di + 2] = this.tmpDir.z;
      this.veilPhase[i] = seededUnit(i, 19.2) * Math.PI * 2;
      this.veilColors[di] = 0.75 + seededUnit(i, 1.1) * 0.25;
      this.veilColors[di + 1] = 0.35 + seededUnit(i, 2.2) * 0.25;
      this.veilColors[di + 2] = 0.85 + seededUnit(i, 3.3) * 0.15;
    }
    this.veilGeometry = new THREE.BufferGeometry();
    this.veilGeometry.setAttribute("position", new THREE.BufferAttribute(this.veilPositions, 3));
    this.veilGeometry.setAttribute("color", new THREE.BufferAttribute(this.veilColors, 3));
    this.veilMaterial = new THREE.PointsMaterial({
      size: 0.032,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.veilPoints = new THREE.Points(this.veilGeometry, this.veilMaterial);
    this.veilPoints.frustumCulled = false;
    this.veilPoints.renderOrder = 3;

    this.sprayPositions = new Float32Array(SPRAY_COUNT * 3);
    this.sprayColors = new Float32Array(SPRAY_COUNT * 3);
    this.sprayVel = new Float32Array(SPRAY_COUNT * 3);
    this.sprayLife = new Float32Array(SPRAY_COUNT);
    for (let i = 0; i < SPRAY_COUNT; i += 1) this.sprayPositions[i * 3 + 1] = -99;
    this.sprayGeometry = new THREE.BufferGeometry();
    this.sprayGeometry.setAttribute("position", new THREE.BufferAttribute(this.sprayPositions, 3));
    this.sprayGeometry.setAttribute("color", new THREE.BufferAttribute(this.sprayColors, 3));
    this.sprayMaterial = new THREE.PointsMaterial({
      size: 0.04,
      map: getSoftPointMap(),
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });
    this.sprayPoints = new THREE.Points(this.sprayGeometry, this.sprayMaterial);
    this.sprayPoints.frustumCulled = false;
    this.sprayPoints.renderOrder = 4;

    this.group.add(this.core, this.fiberLines, this.shell, this.veilPoints, this.sprayPoints);
    this.group.position.y = -0.15;
    this.reset(Math.floor(Math.random() * 1e9));
  }

  applyLiveTuningNow() {}
  pokeIdle() {
    this.pulse = Math.min(1, this.pulse + 0.5);
  }
  getPointerTargets() {
    return [this.shell, this.core];
  }
  pokeSurface(localPoint: THREE.Vector3) {
    this.pulse = Math.min(1, this.pulse + 0.35);
    this.emitSprayBurst(localPoint, 0.7, 50);
  }
  nudgeClayColorOnClick() {}
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
    void seed;
    this.time = 0;
    this.forming = 0.06;
    this.heldForm = 0;
    this.energySmoothed = 0;
    this.pulse = 0;
    this.completed = false;
    this.breathe = 0;
    this.idlePhase = 0;
    this.updatePhase = 0;
    this.fiberFrame = 0;
    this.sprayLife.fill(0);
    for (let i = 0; i < SPRAY_COUNT; i += 1) this.sprayPositions[i * 3 + 1] = -99;
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
      brightness: 0.35,
      contrast: 0.3,
    };
    this.syncShell(0.06, silent, 1);
    this.syncCore(0.06, silent, 1);
    this.rebuildFibers(0.06, silent);
    this.rebuildVeil(0.06, silent, 0, 1);
  }

  createExportGroup() {
    const g = new THREE.Group();
    g.name = "Lumen Sculpture";
    g.rotation.copy(this.group.rotation);
    g.add(this.core.clone(), this.fiberLines.clone(), this.shell.clone());
    return g;
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
      ? clamp01(bands.overall * 1.3 + bands.bassFocus * 0.3 + r.pulseEnvelope * 0.18)
      : 0;
    this.energySmoothed += (energyTarget - this.energySmoothed) * Math.min(1, dt * 3.2);

    if (!this.completed) {
      this.forming = clamp01(
        this.forming + this.energySmoothed * dt * (0.07 + bands.mid * 0.03),
      );
      if (!loud && this.forming > 0.1) {
        this.forming = Math.max(0.1, this.forming - dt * 0.01);
      }
    } else {
      this.forming = this.heldForm;
      this.breathe += dt;
    }

    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.pulse = Math.min(1, this.pulse + r.kick * 0.5 + r.transient * 0.4 + r.snare * 0.2);

    if (loud && (r.kick > 0.5 || r.transient > 0.65) && Math.random() < 0.32) {
      this.sprayOrigin.set(-0.55, (Math.random() - 0.2) * 0.7, (Math.random() - 0.5) * 0.4);
      this.emitSprayBurst(
        this.sprayOrigin,
        0.5 + this.energySmoothed * 0.6,
        30 + Math.floor(bands.high * 40),
      );
    }

    const form = this.completed && this.heldForm > 0 ? this.heldForm : this.forming;
    const breath = this.completed
      ? 1 + Math.sin(this.breathe * 1.05) * 0.018
      : 1 + Math.sin(this.idlePhase * 0.65) * 0.01;

    this.syncShell(form, bands, breath);
    this.syncCore(form, bands, breath);
    this.fiberFrame += 1;
    if (this.fiberFrame % 2 === 0) this.rebuildFibers(form, bands);
    const open = smoothstep(0.05, 0.9, form);
    this.fiberMaterial.opacity = 0.18 + open * 0.4 + bands.high * 0.2;
    this.fiberLines.visible = open > 0.1;
    this.updatePhase = (this.updatePhase + 1) % UPDATE_STRIDE;
    this.rebuildVeil(form, bands, this.updatePhase, UPDATE_STRIDE);
    (this.veilGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.veilMaterial.opacity = 0.1 + smoothstep(0.1, 0.85, form) * 0.1 + bands.high * 0.06;
    this.updateSpray(dt);
  }

  private syncShell(form: number, bands: AudioBands, breath: number) {
    const u = this.shellMat.uniforms;
    u.uTime.value = this.time;
    u.uForm.value = form;
    u.uPulse.value = this.pulse;
    u.uBass.value = bands.sub * 0.55 + bands.low * 0.45;
    u.uMid.value = bands.mid * 0.55 + bands.melody * 0.45;
    u.uHigh.value = bands.high;
    u.uBreath.value = breath;
    u.uShed.value = clamp01(this.pulse * 0.7 + bands.high * 0.5 + bands.brightness * 0.15);
  }

  private syncCore(form: number, bands: AudioBands, breath: number) {
    const open = smoothstep(0.05, 0.9, form);
    const bass = bands.sub * 0.55 + bands.low * 0.45;
    // 殻の内側に収まるサイズ
    const r = (0.28 + open * 0.62) * (0.72 + bass * 0.28) * 0.52 * breath;
    this.core.scale.set(r * 0.95, r * (0.9 + open * 0.12), r * 0.95);
    this.coreMat.color.setRGB(1.0, 0.16 + bass * 0.12, 0.38 + bands.mid * 0.1);
    this.coreMat.opacity = 0.75 + bass * 0.2;
  }

  private rebuildFibers(form: number, bands: AudioBands) {
    const open = smoothstep(0.12, 0.92, form);
    if (open < 0.05) return;
    const bass = bands.sub * 0.55 + bands.low * 0.45;
    const high = bands.high;
    // 殻と同じスケール感で、中身に収める
    const shellR = (0.28 + open * 0.62) * (0.72 + bass * 0.28);
    const grow = 0.35 + open * 0.7 + high * 0.12;
    const stand = 0.9 + open * 0.18;
    const xzTaper = 0.9 + open * 0.08;
    const breath = this.completed
      ? 1 + Math.sin(this.breathe * 1.05) * 0.018
      : 1 + Math.sin(this.idlePhase * 0.65) * 0.01;

    for (let i = 0; i < FIBER_COUNT; i += 1) {
      const di = i * 3;
      const pi = i * 6;
      const ph = this.fiberPhase[i];
      const wobble = Math.sin(this.time * 0.9 + ph) * (0.015 + high * 0.03);
      const rootScale = shellR * (0.32 + seededUnit(i, 1.1) * 0.18);
      const tipScale = shellR * grow * (0.88 + Math.sin(ph + this.time * 0.35) * 0.04);

      this.tmpA.set(this.fiberRoots[di], this.fiberRoots[di + 1], this.fiberRoots[di + 2]).multiplyScalar(rootScale);
      this.tmpB.set(this.fiberTips[di], this.fiberTips[di + 1], this.fiberTips[di + 2]).multiplyScalar(tipScale);
      this.tmpA.x *= xzTaper;
      this.tmpA.z *= xzTaper;
      this.tmpA.y *= stand * breath;
      this.tmpB.x = this.tmpB.x * xzTaper + wobble;
      this.tmpB.z *= xzTaper;
      this.tmpB.y *= stand * breath;

      this.fiberPositions[pi] = this.tmpA.x;
      this.fiberPositions[pi + 1] = this.tmpA.y;
      this.fiberPositions[pi + 2] = this.tmpA.z;
      this.fiberPositions[pi + 3] = this.tmpB.x;
      this.fiberPositions[pi + 4] = this.tmpB.y;
      this.fiberPositions[pi + 5] = this.tmpB.z;

      // 根＝マゼンタ質量、先＝青の構造
      const tipH = clamp01((this.tmpB.y + 1.0) / 2.0);
      this.fiberColors[pi] = 1.0;
      this.fiberColors[pi + 1] = 0.14;
      this.fiberColors[pi + 2] = 0.36;
      this.fiberColors[pi + 3] = 0.42 + tipH * 0.35 + high * 0.15;
      this.fiberColors[pi + 4] = 0.5 + tipH * 0.3;
      this.fiberColors[pi + 5] = 0.95;
    }
    (this.fiberGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.fiberGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private rebuildVeil(form: number, bands: AudioBands, phase: number, stride: number) {
    const open = smoothstep(0.05, 0.9, form);
    const bass = bands.sub * 0.55 + bands.low * 0.45;
    const high = bands.high;
    const shellR = (0.28 + open * 0.62) * (0.72 + bass * 0.28);
    const stand = 0.9 + open * 0.18;
    const xzTaper = 0.9 + open * 0.08;
    const breath = this.completed
      ? 1 + Math.sin(this.breathe * 1.05) * 0.018
      : 1 + Math.sin(this.idlePhase * 0.65) * 0.01;

    for (let i = phase; i < VEIL_COUNT; i += stride) {
      const di = i * 3;
      const dx = this.veilDirs[di];
      const dy = this.veilDirs[di + 1];
      const dz = this.veilDirs[di + 2];
      const ph = this.veilPhase[i];
      const ripple = 1 + Math.sin(this.time * 0.8 + ph) * 0.03 + high * 0.04;
      const radius = shellR * 1.04 * ripple;
      this.veilPositions[di] = dx * radius * xzTaper;
      this.veilPositions[di + 1] = dy * radius * stand * breath;
      this.veilPositions[di + 2] = dz * radius * xzTaper;
    }
  }

  private emitSprayBurst(origin: THREE.Vector3, strength: number, count: number) {
    let spawned = 0;
    const budget = Math.min(count, 70);
    for (let i = 0; i < SPRAY_COUNT && spawned < budget; i += 1) {
      if (this.sprayLife[i] > 0.05) continue;
      const di = i * 3;
      const u = seededUnit(i + Math.floor(this.time * 100), 1.7);
      const v = seededUnit(i + Math.floor(this.time * 100), 2.9);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sp = (0.45 + seededUnit(i, 5.1) * 1.3) * strength;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.cos(phi);
      const sz = Math.sin(phi) * Math.sin(theta);
      this.sprayPositions[di] = origin.x + sx * 0.05;
      this.sprayPositions[di + 1] = origin.y + sy * 0.05;
      this.sprayPositions[di + 2] = origin.z + sz * 0.05;
      this.sprayVel[di] = sx * sp - 0.35 * strength;
      this.sprayVel[di + 1] = sy * sp * 0.65 + 0.08;
      this.sprayVel[di + 2] = sz * sp;
      this.sprayLife[i] = 0.35 + seededUnit(i, 8.8) * 0.45;
      this.sprayColors[di] = 1.0;
      this.sprayColors[di + 1] = 0.18;
      this.sprayColors[di + 2] = 0.42;
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
      this.sprayLife[i] -= dt * 0.95;
      if (this.sprayLife[i] <= 0) {
        this.sprayPositions[di + 1] = -99;
        continue;
      }
      this.sprayVel[di + 1] -= dt * 0.4;
      this.sprayPositions[di] += this.sprayVel[di] * dt;
      this.sprayPositions[di + 1] += this.sprayVel[di + 1] * dt;
      this.sprayPositions[di + 2] += this.sprayVel[di + 2] * dt;
      this.sprayColors[di] *= 0.98;
      this.sprayColors[di + 1] *= 0.98;
      this.sprayColors[di + 2] *= 0.98;
    }
    if (any || this.sprayDirty) {
      (this.sprayGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.sprayGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      this.sprayDirty = false;
    }
  }
}
