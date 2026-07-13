import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bandSoloAllows, computeBandLiveWeights, getBandSoloMode } from "./band-test";
import {
  createClayColorShift,
  METAMORPHOSIS_CLAY_STYLE,
  nudgeClayColorShift,
  resolveClayPalette,
} from "./clay-color";
import { growthModulateScalar, growthPattern } from "./growth-algorithm";
import { fibUnit } from "./fibonacci";
import { runtimeTuning } from "./sculpture-tuning";
import { DEFAULT_SPECIES_PROFILE, type SpeciesProfile } from "./species-profile";
import { getStructureFormationScale, type StructureSnapshot } from "./structure-tracker";
import {
  clamp01,
  seededUnit,
  SILENCE_THRESHOLD,
  smoothstep,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
} from "./sculpture-types";
import {
  applyClickRepulsionToPositions,
  createClickRepulsionState,
  pokeClickRepulsion,
  resetClickRepulsionState,
  updateClickRepulsion,
} from "./click-repulsion";

const SCULPTURE_SPHERE_DETAIL = 10;
const CLAY_CORE_COLOR = 0xd9cdb8;
const CLAY_INNER_COLOR = 0xcfc3ae;
const MAX_SPARKS = 640;

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

const defaultStructure = (): StructureSnapshot => ({
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

const createSculptureSphereGeometry = (radius: number) => {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(radius, SCULPTURE_SPHERE_DETAIL));
  normalizeGeometryToSphere(geometry, radius);
  return geometry;
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

    float alpha = uOpacity + fresnel * 0.11 + melodyLines * 0.05 + microSignals * 0.05;
    alpha += hotVeins * uGlow * 0.08 + ember * uGlow * uHigh * 0.06;
    alpha += lineDrive * fresnel * uMelodyFresnel * 0.06;
    alpha *= mix(1.0, 0.58, frozen);

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * carve モード: 無から音で形を立ち上げる。
 * 減算ではなく出現（emergence）の蓄積。長尺曲でも枯渇しないよう、
 * 体積出現と表面細部を分離し、時間とともにマスクが巡る。
 */
export class CarveSculpture implements SculptureExperience {
  readonly group = new THREE.Group();

  private readonly core: THREE.Mesh;
  private readonly innerCore: THREE.Mesh;
  private readonly surface: THREE.Mesh;
  private readonly sparks: THREE.Points;
  /** 未出現時もクリック判定できる透明コライダー */
  private readonly pokeCollider: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly surfaceGeometry: THREE.BufferGeometry;
  private readonly sparkGeometry: THREE.BufferGeometry;

  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly innerCoreMaterial: THREE.MeshStandardMaterial;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly sparkMaterial: THREE.PointsMaterial;

  private readonly basePositions: Float32Array;
  private readonly baseSurfacePositions: Float32Array;
  /** 0→peakTarget まで不可逆に出現する体積 */
  private readonly emergence: Float32Array;
  /** 頂点ごとの出現上限（均一球にならないようばらつき） */
  private readonly peakTarget: Float32Array;
  /** 表面の溝・流れ（長尺でも継続蓄積可） */
  private readonly surfaceDetail: Float32Array;
  /** 細かな起伏（長尺でも継続蓄積可） */
  private readonly fineRelief: Float32Array;
  /** 録音中のみの瞬間反応 */
  private readonly liveEmergence: Float32Array;
  private readonly emergenceVelocity: Float32Array;
  private readonly clickRepulsion: ReturnType<typeof createClickRepulsionState>;
  private readonly surfaceClickRepulsion: ReturnType<typeof createClickRepulsionState>;

  private readonly sparkPositions: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly sparkVelocities: Float32Array;
  private readonly sparkLife: Float32Array;
  private sparkCursor = 0;

  private readonly growthAxis = new THREE.Vector3(0, 1, 0);
  private readonly scratchAxis = new THREE.Vector3();
  private readonly scratchOrigin = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();
  private readonly targetCoreColor = new THREE.Color(CLAY_CORE_COLOR);
  private readonly targetCoreEmissive = new THREE.Color(0x000000);
  private clayHueBase = 0.09;
  private claySatBase = 0.18;
  private clayLightBase = 0.78;
  private clayColorShift = createClayColorShift();
  private readonly innerColor = new THREE.Color(CLAY_INNER_COLOR);
  private readonly baseScale = new THREE.Vector3(1, 1, 1);

  private readonly targetCoreMeanRadius: number;
  private readonly targetSurfaceMeanRadius: number;

  private completed = false;
  private formingTime = 0;
  private activeFormingTime = 0;
  private frozenTime = 0;
  private spectralPhase = 0;
  private growthPhase = 0;
  private morphologySeed = seededUnit(0, 19.7) * 1000;

  private kickImpulse = 0;
  private snareImpulse = 0;
  private hatImpulse = 0;
  private waveImpulse = 0;
  private lastKickIndexApplied = -1;
  private lastSnareIndexApplied = -1;
  private lastHatIndexApplied = -1;
  private lastTransientIndexApplied = -1;
  private lastPulseIndexApplied = -1;
  private burstCooldown = 0;

  private lastBands: AudioBands | null = null;
  private currentStructure: StructureSnapshot = defaultStructure();
  private speciesProfile: SpeciesProfile = { ...DEFAULT_SPECIES_PROFILE };

  constructor() {
    this.geometry = createSculptureSphereGeometry(1.34);
    this.surfaceGeometry = createSculptureSphereGeometry(1.46);

    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: CLAY_CORE_COLOR,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.94,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    this.innerCoreMaterial = new THREE.MeshStandardMaterial({
      color: CLAY_INNER_COLOR,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.97,
      metalness: 0,
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
        uOpacity: { value: 0.14 },
        uCompleted: { value: 0 },
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
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
    this.innerCore.scale.setScalar(0.12);
    this.surface.castShadow = false;
    this.surface.receiveShadow = false;
    this.core.visible = false;
    this.innerCore.visible = false;
    this.surface.visible = false;

    this.sparkPositions = new Float32Array(MAX_SPARKS * 3);
    this.sparkColors = new Float32Array(MAX_SPARKS * 3);
    this.sparkVelocities = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkPositions.fill(999);
    this.sparkGeometry = new THREE.BufferGeometry();
    this.sparkGeometry.setAttribute("position", new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeometry.setAttribute("color", new THREE.BufferAttribute(this.sparkColors, 3));
    this.sparkMaterial = new THREE.PointsMaterial({
      size: 0.016,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparks = new THREE.Points(this.sparkGeometry, this.sparkMaterial);

    this.pokeCollider = new THREE.Mesh(
      new THREE.SphereGeometry(1.42, 28, 28),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.pokeCollider.name = "Poke collider";

    this.group.add(this.pokeCollider, this.innerCore, this.core, this.surface, this.sparks);
    this.baseScale.copy(this.group.scale);

    const vertexCount = this.geometry.attributes.position.count;
    this.basePositions = new Float32Array(this.geometry.attributes.position.array);
    this.baseSurfacePositions = new Float32Array(this.surfaceGeometry.attributes.position.array);
    this.targetCoreMeanRadius = this.meanRadialLength(this.basePositions);
    this.targetSurfaceMeanRadius = this.meanRadialLength(this.baseSurfacePositions);

    this.emergence = new Float32Array(vertexCount);
    this.peakTarget = new Float32Array(vertexCount);
    this.surfaceDetail = new Float32Array(vertexCount);
    this.fineRelief = new Float32Array(vertexCount);
    this.liveEmergence = new Float32Array(vertexCount);
    this.emergenceVelocity = new Float32Array(vertexCount);
    this.clickRepulsion = createClickRepulsionState(vertexCount);
    this.surfaceClickRepulsion = createClickRepulsionState(vertexCount);

    this.initPeakTargets();
    this.collapseToOrigin();
    this.syncClayColors();
  }

  private syncClayColors() {
    const palette = resolveClayPalette(METAMORPHOSIS_CLAY_STYLE, this.clayColorShift);
    this.clayHueBase = palette.hue;
    this.claySatBase = palette.sat;
    this.clayLightBase = palette.light;
    this.coreMaterial.color.setHex(palette.surfaceHex);
    this.targetCoreColor.setHex(palette.surfaceHex);
    this.innerCoreMaterial.color.setHex(palette.innerHex);
    this.innerColor.setHex(palette.innerHex);
  }

  nudgeClayColorOnClick() {
    this.clayColorShift = nudgeClayColorShift(this.clayColorShift);
    this.syncClayColors();
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    userViewInteracting = false,
    rhythm: RhythmEvents = defaultRhythm(),
    structure: StructureSnapshot = this.currentStructure,
    species: SpeciesProfile = this.speciesProfile,
  ) {
    this.lastBands = bands;
    this.currentStructure = structure;
    this.speciesProfile = species;

    const activity = this.completed ? 0 : smoothstep(SILENCE_THRESHOLD, 0.22, bands.overall);
    const timeAdvance = this.completed ? 0 : deltaTime * activity;

    if (!this.completed) {
      this.formingTime += timeAdvance;
      if (bands.overall > SILENCE_THRESHOLD) {
        this.activeFormingTime += deltaTime;
        this.spectralPhase +=
          deltaTime * activity * (0.12 + bands.centroid * 1.6 + bands.brightness * 0.9 + bands.melody * 1.2);
        this.growthPhase += deltaTime * activity * (0.1 + bands.overall * 1.2 + bands.contrast * 1.2);
        this.updateGrowthAxis(bands, deltaTime);
        this.accumulateEmergence(bands, deltaTime);
        this.applyRhythmBursts(bands, rhythm, structure);
        this.updateCoreMaterial(bands, deltaTime);
      }
      this.burstCooldown = Math.max(0, this.burstCooldown - deltaTime);
    }

    this.decayLiveEmergence(deltaTime);
    updateClickRepulsion(this.clickRepulsion, deltaTime);
    updateClickRepulsion(this.surfaceClickRepulsion, deltaTime);
    this.updateGeometry(bands, deltaTime);
    this.updateSparks(bands, deltaTime);
    this.updateGroupMotion(bands, deltaTime, userViewInteracting, rhythm, activity);

    if (!this.completed) {
      this.applyRhythmImpulses(deltaTime, rhythm);
    }
  }

  applyLiveTuningNow() {
    const bands = this.lastBands;
    if (!bands) {
      return;
    }

    const t = runtimeTuning;
    const shift = t.coreColorShift;
    const hue =
      this.clayHueBase + bands.mid * 0.08 * shift + bands.melody * t.coreColorShift + bands.brightness * 0.48 * shift;
    const saturation = this.claySatBase + bands.contrast * 0.34 * shift + bands.high * 0.16 * shift;
    const lightness = this.clayLightBase + bands.brightness * 0.1 * shift;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift, 0.72, 0.18);
    this.coreMaterial.color.copy(this.targetCoreColor);
    this.coreMaterial.emissive.copy(this.targetCoreEmissive);
    this.coreMaterial.emissiveIntensity =
      (bands.overall * 0.22 + bands.brightness * 0.12 + bands.contrast * t.coreEmissive * 0.1) *
      (t.coreEmissive / 0.1);

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uMelodyLine.value = t.membraneLine;
    uniforms.uMelodyFresnel.value = t.membraneFresnel;
    uniforms.uMelodyNoise.value = t.membraneNoise;
    uniforms.uMelodyFlowAnim.value = 1.2 + t.liveHigh * 1.4;
    uniforms.uLive.value = this.getMembraneLiveTarget(bands);
    uniforms.uGlow.value = this.getMembraneGlowTarget(bands);

    this.updateGeometry(bands, 0.033);
  }

  getPointerTargets() {
    const targets: THREE.Object3D[] = [this.pokeCollider];
    if (this.core.visible) {
      targets.push(this.core);
    }
    if (this.surface.visible) {
      targets.push(this.surface);
    }
    return targets;
  }

  pokeSurface(localPoint: THREE.Vector3) {
    pokeClickRepulsion(this.clickRepulsion, this.basePositions, localPoint);
    pokeClickRepulsion(this.surfaceClickRepulsion, this.baseSurfacePositions, localPoint, 0.1, 0.52);
    this.nudgeClayColorOnClick();
  }

  complete() {
    for (let i = 0; i < this.emergence.length; i += 1) {
      const bake = this.liveEmergence[i] * runtimeTuning.liveLow * 0.35;
      this.emergence[i] = Math.min(this.peakTarget[i], this.emergence[i] + bake);
    }
    this.liveEmergence.fill(0);
    this.frozenTime = this.formingTime;
    this.completed = true;
    this.surfaceMaterial.uniforms.uCompleted.value = 1;
    this.updateGeometry(this.lastBands ?? this.zeroBands(), 0);
  }

  reset() {
    this.completed = false;
    this.frozenTime = 0;
    this.formingTime = 0;
    this.activeFormingTime = 0;
    this.spectralPhase = 0;
    this.growthPhase = 0;
    this.kickImpulse = 0;
    this.snareImpulse = 0;
    this.hatImpulse = 0;
    this.waveImpulse = 0;
    this.burstCooldown = 0;
    this.lastKickIndexApplied = -1;
    this.lastSnareIndexApplied = -1;
    this.lastHatIndexApplied = -1;
    this.lastTransientIndexApplied = -1;
    this.lastPulseIndexApplied = -1;
    this.currentStructure = defaultStructure();
    this.speciesProfile = { ...DEFAULT_SPECIES_PROFILE };
    this.emergence.fill(0);
    this.surfaceDetail.fill(0);
    this.fineRelief.fill(0);
    this.liveEmergence.fill(0);
    this.emergenceVelocity.fill(0);
    resetClickRepulsionState(this.clickRepulsion);
    resetClickRepulsionState(this.surfaceClickRepulsion);
    this.sparkLife.fill(0);
    this.sparkPositions.fill(999);
    this.growthAxis.set(0, 1, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.copy(this.baseScale);
    this.innerCore.scale.setScalar(0.12);
    this.core.visible = false;
    this.innerCore.visible = false;
    this.surface.visible = false;
    this.coreMaterial.emissive.set(0x000000);
    this.coreMaterial.emissiveIntensity = 0;
    this.clayColorShift = createClayColorShift();
    this.syncClayColors();
    this.surfaceMaterial.uniforms.uCompleted.value = 0;
    this.collapseToOrigin();
  }

  createExportGroup() {
    const exportGroup = new THREE.Group();
    exportGroup.name = "Sound Sculpture (Emergence)";
    exportGroup.rotation.copy(this.group.rotation);

    const core = new THREE.Mesh(
      this.geometry.clone(),
      new THREE.MeshStandardMaterial({
        name: "Emergent core",
        color: this.coreMaterial.color.clone(),
        emissive: this.coreMaterial.emissive.clone(),
        emissiveIntensity: this.coreMaterial.emissiveIntensity,
        roughness: this.coreMaterial.roughness,
        metalness: 0.02,
      }),
    );
    core.name = "Emergent core";

    const innerCore = new THREE.Mesh(
      this.geometry.clone(),
      new THREE.MeshStandardMaterial({
        name: "Inner mass",
        color: this.innerCoreMaterial.color.clone(),
        roughness: 0.96,
        metalness: 0,
      }),
    );
    innerCore.scale.copy(this.innerCore.scale);
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

    exportGroup.add(core, innerCore, surface);
    return exportGroup;
  }

  private zeroBands(): AudioBands {
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
    };
  }

  private initPeakTargets() {
    for (let i = 0; i < this.peakTarget.length; i += 1) {
      const idx = i * 3;
      const x = this.basePositions[idx];
      const y = this.basePositions[idx + 1];
      const z = this.basePositions[idx + 2];
      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;
      const form = growthPattern(nx, ny, nz, this.morphologySeed);
      const grain = growthPattern(nx, ny, nz, this.morphologySeed + 11.3);
      this.peakTarget[i] = 0.32 + smoothstep(-0.2, 0.85, form + grain * 0.35) * 0.68;
    }
  }

  private meanRadialLength(positions: Float32Array) {
    let sum = 0;
    for (let i = 0; i < positions.length; i += 3) {
      sum += Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
    }
    return sum / Math.max(1, positions.length / 3);
  }

  private collapseToOrigin() {
    const corePos = this.geometry.attributes.position.array as Float32Array;
    corePos.fill(0);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();

    const surfacePos = this.surfaceGeometry.attributes.position.array as Float32Array;
    surfacePos.fill(0);
    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();
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

  /** 長尺曲向け: 時間経過でマスクが巡り、未出現領域が後から立ち上がる */
  private getTimelineSalt(bands: AudioBands) {
    return (
      this.spectralPhase * 1.7 +
      this.growthPhase * 0.9 +
      bands.centroid * 11 +
      bands.contrast * 7 +
      this.morphologySeed * 0.02 +
      this.activeFormingTime * 0.045
    );
  }

  private getAudioGrowthAxis(offset: number, bands: AudioBands, out: THREE.Vector3) {
    const angle = this.growthPhase * (1.1 + offset * 0.37) + bands.centroid * Math.PI * (2.2 + offset);
    const elevation =
      (bands.centroid - 0.42) * 1.05 +
      Math.sin(this.spectralPhase * 0.73 + offset) * 0.42 +
      (bands.overall - 0.28) * 0.72;
    const y = Math.sin(elevation);
    const horizontal = Math.sqrt(Math.max(0.001, 1 - y * y));
    out.set(Math.cos(angle) * horizontal, y, Math.sin(angle) * horizontal);
    return out;
  }

  private updateGrowthAxis(bands: AudioBands, deltaTime: number) {
    const target = this.getAudioGrowthAxis(0, bands, this.scratchAxis);
    this.growthAxis.lerp(target, Math.min(1, deltaTime * 0.55)).normalize();
  }

  private accumulateEmergence(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const formation = this.getFormationScale();
    const detail = this.getDetailScale();
    const liveW = computeBandLiveWeights(bands, getBandSoloMode());
    const liveGainK = 0.38;
    const liveGainLow = 0.48 + liveW.low * t.liveLow * liveGainK;
    const liveGainMid = 0.48 + liveW.mid * t.liveMid * liveGainK;
    const liveGainHigh = 0.48 + liveW.high * t.liveHigh * liveGainK;

    const lowPressure = Math.max(0, Math.max(bands.sub, bands.low) - 0.025);
    const midPressure = Math.max(0, Math.max(bands.mid, bands.melody) - 0.025);
    const highPressure = Math.max(0, bands.high - 0.025);

    const lowAmount = lowPressure * deltaTime * t.accumRate * liveGainLow * formation;
    const midAmount =
      midPressure * deltaTime * t.accumRate * liveGainMid * formation * (0.65 + bands.contrast * 0.85);
    const highAmount =
      highPressure * deltaTime * t.accumRate * liveGainHigh * detail * (0.8 + bands.brightness * 0.1);

    if (lowAmount + midAmount + highAmount <= 0.0001) {
      return;
    }

    const axisA = this.getAudioGrowthAxis(0, bands, this.scratchAxis);
    const axisB = this.getAudioGrowthAxis(1, bands, new THREE.Vector3());
    const growthScale = t.growthAnchorGain * this.speciesProfile.flowGain;
    const salt = this.getTimelineSalt(bands);
    const detailCap = runtimeTuning.spikeCap * this.speciesProfile.spikeGain;
    const reliefCap = detailCap * 0.55;

    for (let i = 0; i < this.emergence.length; i += 1) {
      const idx = i * 3;
      const x = this.basePositions[idx];
      const y = this.basePositions[idx + 1];
      const z = this.basePositions[idx + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;

      const axisFocusA = smoothstep(-0.15, 0.88, nx * axisA.x + ny * axisA.y + nz * axisA.z);
      const axisFocusB = smoothstep(-0.28, 0.82, nx * axisB.x + ny * axisB.y + nz * axisB.z);
      const largeForm = growthPattern(nx, ny, nz, salt);
      const surfaceGrain = growthPattern(nx, ny, nz, salt + 6.3);
      const flowNoise = growthPattern(nx, ny, nz, salt + 13.7);
      const fineNoise = growthPattern(nx, ny, nz, salt + 28.9);

      const bulkMask =
        smoothstep(0.04, 0.88, largeForm + flowNoise * 0.42 + axisFocusA * 0.38) *
        (0.28 + axisFocusA * 0.56 + axisFocusB * bands.brightness * 0.44);
      const streakMask =
        smoothstep(0.1, 0.9, Math.abs(surfaceGrain - flowNoise) + axisFocusB * 0.22) *
        (0.32 + axisFocusB * 0.48);
      const fineMask =
        smoothstep(0.58, 0.96, fineNoise * 0.58 + axisFocusA * 0.42 + bands.brightness * 0.24) *
        (0.24 + bands.contrast * 0.22);

      const peak = this.peakTarget[i];
      const headroom = Math.max(0, peak - this.emergence[i]);
      if (headroom > 0.0001) {
        const prev = this.emergence[i];
        const delta = growthModulateScalar(
          lowAmount * bulkMask * 1.1 * growthScale,
          nx,
          ny,
          nz,
          salt,
          "bulk",
        );
        this.emergence[i] = Math.min(peak, prev + delta);
        this.emergenceVelocity[i] = Math.max(this.emergenceVelocity[i], this.emergence[i] - prev);
      }

      this.surfaceDetail[i] = Math.min(
        detailCap,
        this.surfaceDetail[i] +
          growthModulateScalar(
            midAmount * streakMask * 0.9 * growthScale,
            nx,
            ny,
            nz,
            salt + 6.3,
            "mid",
          ),
      );
      this.fineRelief[i] = Math.min(
        reliefCap,
        this.fineRelief[i] +
          growthModulateScalar(
            highAmount * fineMask * 0.75 * growthScale,
            nx,
            ny,
            nz,
            salt + 28.9,
            "high",
          ),
      );
    }
  }

  private decayLiveEmergence(deltaTime: number) {
    const decay = Math.exp(-5.5 * deltaTime);
    for (let i = 0; i < this.liveEmergence.length; i += 1) {
      this.liveEmergence[i] *= decay;
    }
  }

  private applyConeLiveBurst(direction: THREE.Vector3, strength: number) {
    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;
    const coneCos = Math.cos(0.46);

    for (let i = 0; i < this.emergence.length; i += 1) {
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
      const strike = strength * falloff;
      const peak = this.peakTarget[i];
      this.liveEmergence[i] = Math.min(0.38, this.liveEmergence[i] + strike * 0.32);
      const prev = this.emergence[i];
      this.emergence[i] = Math.min(peak, prev + strike * 0.14);
      this.emergenceVelocity[i] = Math.max(this.emergenceVelocity[i], this.emergence[i] - prev);
    }
  }

  private pickFrontierOrigin(out: THREE.Vector3) {
    let bestScore = -1;
    let bestIndex = 0;

    for (let i = 0; i < this.emergence.length; i += 1) {
      const headroom = this.peakTarget[i] - this.emergence[i];
      const score =
        this.emergenceVelocity[i] * 1.4 +
        this.emergence[i] * 0.5 +
        Math.max(0, headroom) * 0.35 +
        seededUnit(i, this.growthPhase) * 0.06;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const idx = bestIndex * 3;
    const positions = this.geometry.attributes.position.array as Float32Array;
    out.set(positions[idx], positions[idx + 1], positions[idx + 2]);
    if (out.lengthSq() < 0.0001) {
      out.copy(this.growthAxis).multiplyScalar(0.05);
    }
    return bestIndex;
  }

  private emitSparks(origin: THREE.Vector3, direction: THREE.Vector3, count: number, strength: number) {
    for (let n = 0; n < count; n += 1) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      const idx = i * 3;

      const spread = 0.22 + strength * 0.28;
      const jitter = new THREE.Vector3(
        (seededUnit(i + n, this.formingTime) - 0.5) * spread,
        (seededUnit(i + n, this.formingTime + 1) - 0.5) * spread,
        (seededUnit(i + n, this.formingTime + 2) - 0.5) * spread,
      );
      const outDir = direction.clone().add(jitter).normalize();
      const speed = 0.28 + strength * 0.95 + seededUnit(n, 7.3) * 0.35;

      this.sparkPositions[idx] = origin.x;
      this.sparkPositions[idx + 1] = origin.y;
      this.sparkPositions[idx + 2] = origin.z;
      this.sparkVelocities[idx] = outDir.x * speed;
      this.sparkVelocities[idx + 1] = outDir.y * speed;
      this.sparkVelocities[idx + 2] = outDir.z * speed;
      this.sparkLife[i] = 0.45 + strength * 0.55;

      const tone = 0.65 + seededUnit(i, 3.1) * 0.35;
      this.scratchColor.copy(this.targetCoreColor).lerp(this.innerColor, 0.2);
      this.sparkColors[idx] = this.scratchColor.r * tone;
      this.sparkColors[idx + 1] = this.scratchColor.g * tone;
      this.sparkColors[idx + 2] = this.scratchColor.b * tone;
    }
  }

  private applyRhythmBursts(bands: AudioBands, rhythm: RhythmEvents, structure: StructureSnapshot) {
    if (this.burstCooldown > 0 || structure.phase === "embryo") {
      return;
    }

    const kickBurst = rhythm.kick > 0.08 ? rhythm.kick : 0;
    const snareBurst = rhythm.snare > 0.1 ? rhythm.snare : 0;
    const transientBurst = rhythm.transient > 0.12 ? rhythm.transient : 0;
    const surgeBurst = structure.events.energySurge ? 0.55 + bands.overall * 0.35 : 0;
    const noveltyBurst = structure.events.noveltyPeak ? 0.4 + bands.contrast * 0.35 : 0;

    const trigger = Math.max(kickBurst, snareBurst * 0.9, transientBurst, surgeBurst, noveltyBurst);
    if (trigger < 0.12) {
      return;
    }

    this.pickFrontierOrigin(this.scratchOrigin);
    const dir = this.scratchOrigin.clone().normalize();
    if (dir.lengthSq() < 0.001) {
      dir.copy(this.growthAxis);
    }

    const strength = clamp01(0.2 + trigger * 0.75);
    this.applyConeLiveBurst(dir, strength);
    this.emitSparks(this.scratchOrigin, dir, Math.min(16, 4 + Math.floor(strength * 14)), strength);
    this.burstCooldown = 0.12 + (1 - strength) * 0.24;
  }

  private applyRhythmImpulses(deltaTime: number, rhythm: RhythmEvents) {
    this.kickImpulse *= Math.exp(-7.2 * deltaTime);
    this.snareImpulse *= Math.exp(-8 * deltaTime);
    this.hatImpulse *= Math.exp(-13 * deltaTime);
    this.waveImpulse *= Math.exp(-10 * deltaTime);

    if (rhythm.kickIndex !== this.lastKickIndexApplied) {
      this.lastKickIndexApplied = rhythm.kickIndex;
      if (rhythm.kick > 0) {
        this.kickImpulse = Math.min(1, this.kickImpulse + rhythm.kick * 5.5);
      }
    }

    if (rhythm.snareIndex !== this.lastSnareIndexApplied) {
      this.lastSnareIndexApplied = rhythm.snareIndex;
      if (rhythm.snare > 0) {
        this.snareImpulse = Math.min(1, this.snareImpulse + rhythm.snare * 3.6);
      }
    }

    if (rhythm.hatIndex !== this.lastHatIndexApplied) {
      this.lastHatIndexApplied = rhythm.hatIndex;
      if (rhythm.hat > 0) {
        this.hatImpulse = Math.min(1, this.hatImpulse + rhythm.hat * 5.5);
      }
    }

    if (rhythm.transientIndex !== this.lastTransientIndexApplied) {
      this.lastTransientIndexApplied = rhythm.transientIndex;
      if (rhythm.transient > 0) {
        this.waveImpulse = Math.min(1, this.waveImpulse + rhythm.transient * 2.8);
      }
    }

    if (rhythm.pulseIndex !== this.lastPulseIndexApplied) {
      this.lastPulseIndexApplied = rhythm.pulseIndex;
      this.kickImpulse = Math.min(1, this.kickImpulse + fibUnit(8, 13));
    }
  }

  private updateGeometry(bands: AudioBands, deltaTime: number) {
    const liveGain = runtimeTuning.liveMid * 0.55 + runtimeTuning.liveHigh * 0.25;
    const corePositions = this.geometry.attributes.position.array as Float32Array;
    const surfacePositions = this.surfaceGeometry.attributes.position.array as Float32Array;

    let emergenceSum = 0;
    let freshEdgeSum = 0;

    for (let i = 0; i < this.emergence.length; i += 1) {
      const idx = i * 3;
      const bx = this.basePositions[idx];
      const by = this.basePositions[idx + 1];
      const bz = this.basePositions[idx + 2];
      const bxSurf = this.baseSurfacePositions[idx];
      const bySurf = this.baseSurfacePositions[idx + 1];
      const bzSurf = this.baseSurfacePositions[idx + 2];
      const radius = Math.hypot(bx, by, bz) || 1;
      const nx = bx / radius;
      const ny = by / radius;
      const nz = bz / radius;

      const body =
        Math.min(this.peakTarget[i], this.emergence[i] + this.liveEmergence[i] * liveGain * 0.22);
      const relief = 1 + this.surfaceDetail[i] * 0.14 + this.fineRelief[i] * 0.1;
      const scale = Math.max(0, body * relief);

      emergenceSum += body / Math.max(0.001, this.peakTarget[i]);
      freshEdgeSum += this.emergenceVelocity[i];

      corePositions[idx] = nx * radius * scale;
      corePositions[idx + 1] = ny * radius * scale;
      corePositions[idx + 2] = nz * radius * scale;

      const surfScale = scale * 1.04;
      const surfR = Math.hypot(bxSurf, bySurf, bzSurf) || 1;
      surfacePositions[idx] = (bxSurf / surfR) * surfR * surfScale;
      surfacePositions[idx + 1] = (bySurf / surfR) * surfR * surfScale;
      surfacePositions[idx + 2] = (bzSurf / surfR) * surfR * surfScale;

      this.emergenceVelocity[i] *= Math.exp(-8 * deltaTime);
    }

    this.constrainEnvelope(corePositions, this.targetCoreMeanRadius, 1.12);
    this.constrainEnvelope(surfacePositions, this.targetSurfaceMeanRadius, 1.28);

    applyClickRepulsionToPositions(this.clickRepulsion, this.basePositions, corePositions);
    applyClickRepulsionToPositions(this.surfaceClickRepulsion, this.baseSurfacePositions, surfacePositions);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();

    const avgEmergence = emergenceSum / Math.max(1, this.emergence.length);
    const visible = avgEmergence > 0.018;
    this.core.visible = visible;
    this.innerCore.visible = visible;
    this.surface.visible = visible;

    const innerScale = 0.1 + avgEmergence * 0.86;
    this.innerCore.scale.setScalar(innerScale);

    const freshEdge = freshEdgeSum / Math.max(1, this.emergence.length);
    this.coreMaterial.roughness = 0.94 - avgEmergence * 0.08 + freshEdge * 0.06;
    this.coreMaterial.emissiveIntensity =
      (this.completed ? 0.05 : freshEdge * 0.42 + avgEmergence * 0.1) * (0.5 + bands.brightness * 0.5);

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uTime.value = this.completed ? this.frozenTime : this.formingTime;
    uniforms.uMid.value += (bands.mid - uniforms.uMid.value) * Math.min(1, deltaTime * 9);
    uniforms.uMelody.value += (bands.melody - uniforms.uMelody.value) * Math.min(1, deltaTime * 9);
    uniforms.uHigh.value += (bands.high - uniforms.uHigh.value) * Math.min(1, deltaTime * 9);
    uniforms.uLive.value += (this.getMembraneLiveTarget(bands) - uniforms.uLive.value) * Math.min(1, deltaTime * 14);
    uniforms.uGlow.value += (this.getMembraneGlowTarget(bands) - uniforms.uGlow.value) * Math.min(1, deltaTime * 5);

    const sp = this.speciesProfile;
    const membraneOpacity = this.completed
      ? fibUnit(2, 21)
      : fibUnit(5, 21) + sp.membraneGain * fibUnit(8, 21) - sp.aggressive * fibUnit(5, 21);
    uniforms.uOpacity.value += (membraneOpacity - uniforms.uOpacity.value) * Math.min(1, deltaTime * 3);
  }

  private constrainEnvelope(positions: Float32Array, targetMeanRadius: number, maxSpreadRatio: number) {
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

  private updateCoreMaterial(bands: AudioBands, deltaTime: number) {
    const t = runtimeTuning;
    const shift = t.coreColorShift;
    const hue =
      this.clayHueBase +
      bands.mid * 0.08 * shift +
      bands.melody * t.coreColorShift +
      bands.brightness * 0.48 * shift;
    const saturation = this.claySatBase + bands.contrast * 0.34 * shift + bands.high * 0.16 * shift;
    const lightness = this.clayLightBase + bands.brightness * 0.1 * shift + this.getAverageEmergence() * 0.04;

    this.targetCoreColor.setHSL(hue, saturation, lightness);
    this.targetCoreEmissive.setHSL(0.56 + bands.brightness * 0.08 * shift, 0.72, 0.18);
    const follow = Math.min(1, deltaTime * 4.5);
    this.coreMaterial.color.lerp(this.targetCoreColor, follow);
    this.coreMaterial.emissive.lerp(this.targetCoreEmissive, follow * 0.6);
  }

  private getAverageEmergence() {
    let sum = 0;
    for (let i = 0; i < this.emergence.length; i += 1) {
      sum += this.emergence[i] / Math.max(0.001, this.peakTarget[i]);
    }
    return sum / Math.max(1, this.emergence.length);
  }

  private getMembraneLiveTarget(bands: AudioBands) {
    const t = runtimeTuning;
    const liveW = computeBandLiveWeights(bands, getBandSoloMode());
    if (this.completed) {
      return 0;
    }
    return (
      liveW.high * t.liveHigh * 1.1 +
      this.speciesProfile.membraneGain * fibUnit(5, 13) +
      (this.hatImpulse * fibUnit(8, 13) + this.waveImpulse * fibUnit(5, 13)) * t.liveHigh
    );
  }

  private getMembraneGlowTarget(bands: AudioBands) {
    const t = runtimeTuning;
    return (
      (this.completed ? 0.35 : 0.2) +
      bands.overall * t.liveHigh * 1.1 +
      (this.hatImpulse * 0.5 + this.waveImpulse * 0.28) * t.liveHigh
    );
  }

  private updateSparks(bands: AudioBands, deltaTime: number) {
    let moved = false;

    for (let i = 0; i < MAX_SPARKS; i += 1) {
      const life = this.sparkLife[i];
      if (life <= 0) {
        continue;
      }

      const idx = i * 3;
      this.sparkPositions[idx] += this.sparkVelocities[idx] * deltaTime;
      this.sparkPositions[idx + 1] += this.sparkVelocities[idx + 1] * deltaTime;
      this.sparkPositions[idx + 2] += this.sparkVelocities[idx + 2] * deltaTime;
      this.sparkVelocities[idx] *= Math.exp(-3.2 * deltaTime);
      this.sparkVelocities[idx + 1] *= Math.exp(-3.2 * deltaTime);
      this.sparkVelocities[idx + 2] *= Math.exp(-3.2 * deltaTime);

      const fade = life / 0.5;
      const tone = fade * (0.5 + bands.overall * 0.5);
      this.sparkColors[idx] = Math.min(this.sparkColors[idx], tone);
      this.sparkColors[idx + 1] = Math.min(this.sparkColors[idx + 1], tone * 0.95);
      this.sparkColors[idx + 2] = Math.min(this.sparkColors[idx + 2], tone);

      this.sparkLife[i] = life - deltaTime;
      if (this.sparkLife[i] <= 0) {
        this.sparkPositions[idx] = 999;
        this.sparkPositions[idx + 1] = 999;
        this.sparkPositions[idx + 2] = 999;
      }
      moved = true;
    }

    if (moved) {
      this.sparkGeometry.attributes.position.needsUpdate = true;
      this.sparkGeometry.attributes.color.needsUpdate = true;
    }

    const targetOpacity = this.completed ? 0.1 : 0.38 + bands.high * 0.28;
    this.sparkMaterial.opacity += (targetOpacity - this.sparkMaterial.opacity) * Math.min(1, deltaTime * 4);
  }

  private updateGroupMotion(
    bands: AudioBands,
    deltaTime: number,
    userViewInteracting: boolean,
    rhythm: RhythmEvents,
    activity: number,
  ) {
    const pulseFloor = runtimeTuning.pulseConfidenceFloor;
    const syncPulse =
      rhythm.pulseEnvelope * (pulseFloor + rhythm.pulseConfidence * (1 - pulseFloor));
    const kickPulse = this.completed
      ? 1
      : 1 + Math.max(this.kickImpulse, syncPulse) * fibUnit(8, 13) * runtimeTuning.liveLow * 0.65;

    if (bandSoloAllows("low")) {
      this.group.scale.setScalar(kickPulse);
    }

    if (!userViewInteracting && !this.completed) {
      const gate = rhythm.pulseConfidence;
      const spin = (0.04 + bands.mid * 0.015 + bands.melody * 0.04) * activity * gate;
      this.group.rotation.y += deltaTime * spin;
      this.group.rotation.x = Math.sin(this.formingTime * 0.18) * 0.035 * activity * gate;
    } else if (this.completed && bandSoloAllows("low")) {
      this.group.scale.lerp(this.baseScale, Math.min(1, deltaTime * 12));
    }
  }
}
