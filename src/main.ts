import './styles.scss';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type AudioBands = {
  low: number;
  mid: number;
  high: number;
  overall: number;
};

const SILENCE_THRESHOLD = 0.025;
const SILENCE_SECONDS_TO_COMPLETE = 2.4;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

const vertexPattern = (x: number, y: number, z: number, salt: number) => {
  const wave =
    Math.sin(x * 5.13 + y * 1.37 + salt) +
    Math.sin(y * 4.21 - z * 2.31 + salt * 1.7) +
    Math.sin(z * 6.17 + x * 2.91 - salt * 0.6);

  return wave / 3;
};

const seededUnit = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
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
  uniform float uHigh;
  uniform float uLive;
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
    float flowTime = uTime * (1.0 - frozen);

    float surfaceNoise = noise(vWorldPosition * 4.2 + vec3(0.0, flowTime * 0.34, 0.0));
    float fineNoise = noise(vWorldPosition * 18.0 - vec3(flowTime * 0.22));
    float latitude = sin((vUv.y * 34.0) + flowTime * 2.8 + surfaceNoise * 2.2);
    float meridian = sin((vUv.x * 58.0) - flowTime * 3.6 + fineNoise * 1.6);
    float dataLines = smoothstep(0.78, 0.98, latitude) * (0.3 + uMid * 0.7);
    float microSignals = smoothstep(0.86, 0.995, meridian) * uHigh;

    vec3 baseColor = vec3(0.62, 0.78, 0.94);
    vec3 electricBlue = vec3(0.24, 0.55, 1.0);
    vec3 paleViolet = vec3(0.74, 0.68, 1.0);
    vec3 color = baseColor * 0.24;
    color += electricBlue * (fresnel * (0.95 + uHigh * 1.35));
    color += paleViolet * dataLines * 0.42;
    color += vec3(0.72, 0.94, 1.0) * microSignals * 0.48;
    color += vec3(0.2, 0.42, 0.72) * surfaceNoise * uLive * 0.18;

    float alpha = uOpacity + fresnel * 0.22 + dataLines * 0.055 + microSignals * 0.07;
    alpha *= mix(1.0, 0.58, frozen);

    gl_FragColor = vec4(color, alpha);
  }
`;

class AudioInput {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private bands: AudioBands = { low: 0, mid: 0, high: 0, overall: 0 };

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.76;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
  }

  update() {
    if (!this.context || !this.analyser || !this.data) {
      return this.bands;
    }

    this.analyser.getByteFrequencyData(this.data);

    const low = this.readBand(24, 240);
    const mid = this.readBand(240, 2200);
    const high = this.readBand(2200, 9000);
    const overall = low * 0.48 + mid * 0.34 + high * 0.18;

    this.bands = {
      low: smoothstep(0.025, 0.42, low),
      mid: smoothstep(0.018, 0.34, mid),
      high: smoothstep(0.012, 0.28, high),
      overall: smoothstep(0.014, 0.36, overall),
    };

    return this.bands;
  }

  private readBand(minHz: number, maxHz: number) {
    if (!this.context || !this.analyser || !this.data) {
      return 0;
    }

    const nyquist = this.context.sampleRate / 2;
    const startIndex = Math.max(
      0,
      Math.floor((minHz / nyquist) * this.data.length),
    );
    const endIndex = Math.min(
      this.data.length - 1,
      Math.ceil((maxHz / nyquist) * this.data.length),
    );

    let sum = 0;
    let count = 0;

    for (let i = startIndex; i <= endIndex; i += 1) {
      sum += this.data[i] / 255;
      count += 1;
    }

    return count === 0 ? 0 : sum / count;
  }
}

class SoundSculpture {
  private static readonly maxParticles = 900;

  readonly group = new THREE.Group();

  private readonly core: THREE.Mesh;
  private readonly surface: THREE.Mesh;
  private readonly particles: THREE.Points;
  private readonly surfaceMaterial: THREE.ShaderMaterial;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly geometry: THREE.SphereGeometry;
  private readonly surfaceGeometry: THREE.SphereGeometry;
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly basePositions: Float32Array;
  private readonly baseSurfacePositions: Float32Array;
  private readonly accumulated: Float32Array;
  private readonly liveOffset: Float32Array;
  private readonly particlePositions: Float32Array;
  private readonly particleColors: Float32Array;
  private readonly particleStartPositions: Float32Array;
  private readonly particleTargetDirections: Float32Array;
  private readonly particleTargetOffsets: Float32Array;
  private readonly particleProgress: Float32Array;
  private readonly particleActive: Uint8Array;
  private readonly particleStuck: Uint8Array;
  private hardness = 0;
  private formingTime = 0;
  private particleCursor = 0;
  private particleEmission = 0;
  private completed = false;

  constructor() {
    this.geometry = new THREE.SphereGeometry(1.34, 96, 64);
    this.surfaceGeometry = new THREE.SphereGeometry(1.42, 96, 64);

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8e2d8,
      roughness: 0.86,
      metalness: 0.02,
    });

    this.surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uLive: { value: 0 },
        uOpacity: { value: 0.22 },
        uCompleted: { value: 0 },
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.core = new THREE.Mesh(this.geometry, coreMaterial);
    this.surface = new THREE.Mesh(this.surfaceGeometry, this.surfaceMaterial);

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
    this.particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.particlePositions, 3),
    );
    this.particleGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.particleColors, 3),
    );
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
    this.group.add(this.core, this.surface, this.particles);

    this.basePositions = new Float32Array(
      this.geometry.attributes.position.array,
    );
    this.baseSurfacePositions = new Float32Array(
      this.surfaceGeometry.attributes.position.array,
    );
    this.accumulated = new Float32Array(
      this.geometry.attributes.position.count,
    );
    this.liveOffset = new Float32Array(this.accumulated.length);
  }

  update(bands: AudioBands, deltaTime: number) {
    this.formingTime += deltaTime;

    if (!this.completed) {
      this.hardness = Math.min(
        0.88,
        this.hardness + deltaTime * (0.012 + bands.low * 0.035),
      );
      this.accumulateBassPressure(bands, deltaTime);
    }

    this.updateCoreGeometry(bands, deltaTime);
    this.updateSurfaceGeometry(bands, deltaTime);
    this.updateParticles(bands, deltaTime);

    const targetSpin = this.completed ? 0 : 0.08 + bands.mid * 0.05;
    this.group.rotation.y += deltaTime * targetSpin;
    this.group.rotation.x = Math.sin(this.formingTime * 0.18) * 0.07;
  }

  complete() {
    this.completed = true;
  }

  createExportGroup() {
    const exportGroup = new THREE.Group();
    exportGroup.name = 'Sound Sculpture';
    exportGroup.rotation.copy(this.group.rotation);

    const core = new THREE.Mesh(
      this.geometry.clone(),
      new THREE.MeshStandardMaterial({
        name: 'Accumulated core',
        color: 0xe8e2d8,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    core.name = 'Sculpture core';

    const surface = new THREE.Mesh(
      this.surfaceGeometry.clone(),
      new THREE.MeshStandardMaterial({
        name: 'Frozen digital surface',
        color: 0x92b8e8,
        emissive: 0x1e5eff,
        emissiveIntensity: 0.12,
        roughness: 0.34,
        metalness: 0.04,
        transparent: true,
        opacity: 0.32,
      }),
    );
    surface.name = 'Digital surface';

    exportGroup.add(core, surface);

    const particleCount = this.particleActive.reduce(
      (count, isActive) => count + isActive,
      0,
    );

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
      particleGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3),
      );
      particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
          name: 'Fixed high-frequency deposits',
          size: 0.028,
          vertexColors: true,
          transparent: true,
          opacity: 0.72,
        }),
      );
      particles.name = 'High frequency deposits';
      exportGroup.add(particles);
    }

    return exportGroup;
  }

  private accumulateBassPressure(bands: AudioBands, deltaTime: number) {
    const pressure = Math.max(0, bands.low - 0.03);
    const midTexture = bands.mid * 0.62;
    const amount = pressure * deltaTime * 0.62 * (1 - this.hardness * 0.72);

    if (amount <= 0.0001) {
      return;
    }

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const largeForm = vertexPattern(nx, ny, nz, 0.8);
      const surfaceGrain = vertexPattern(nx, ny, nz, 7.4);
      const chiselNoise = vertexPattern(nx, ny, nz, 14.6);
      const carveMask = smoothstep(0.12, 0.82, -largeForm + chiselNoise * 0.38);
      const pushMask = smoothstep(0.08, 0.86, largeForm + surfaceGrain * 0.3);
      const ridge = Math.abs(surfaceGrain - chiselNoise) * midTexture;
      const directionalPressure = pushMask * 0.9 - carveMask * 1.28 + ridge * 0.48;
      const nextDisplacement = this.accumulated[i] + amount * directionalPressure;

      this.accumulated[i] = Math.min(0.64, Math.max(-0.52, nextDisplacement));
    }
  }

  private updateCoreGeometry(bands: AudioBands, deltaTime: number) {
    const positions = this.geometry.attributes.position.array;

    for (let i = 0; i < this.accumulated.length; i += 1) {
      const index = i * 3;
      const x = this.basePositions[index];
      const y = this.basePositions[index + 1];
      const z = this.basePositions[index + 2];
      const radius = Math.hypot(x, y, z) || 1;
      const nx = x / radius;
      const ny = y / radius;
      const nz = z / radius;
      const pulse = this.completed
        ? 0
        : vertexPattern(nx, ny, nz, this.formingTime * 1.6) * bands.overall * 0.06;

      this.liveOffset[i] += (pulse - this.liveOffset[i]) * Math.min(1, deltaTime * 8);

      const displacement = this.accumulated[i] + this.liveOffset[i];
      positions[index] = x + nx * displacement;
      positions[index + 1] = y + ny * displacement;
      positions[index + 2] = z + nz * displacement;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  private updateSurfaceGeometry(bands: AudioBands, deltaTime: number) {
    const positions = this.surfaceGeometry.attributes.position.array;
    const liveEnergy = this.completed ? 0 : bands.mid * 0.09 + bands.high * 0.06;

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
      const displacement = this.accumulated[i] * 0.72 + flow * liveEnergy;

      positions[index] = x + nx * displacement;
      positions[index + 1] = y + ny * displacement;
      positions[index + 2] = z + nz * displacement;
    }

    const uniforms = this.surfaceMaterial.uniforms;
    uniforms.uTime.value = this.formingTime;
    uniforms.uMid.value += (bands.mid - uniforms.uMid.value) * Math.min(1, deltaTime * 7);
    uniforms.uHigh.value +=
      (bands.high - uniforms.uHigh.value) * Math.min(1, deltaTime * 9);
    uniforms.uLive.value +=
      ((this.completed ? 0 : bands.overall) - uniforms.uLive.value) *
      Math.min(1, deltaTime * 6);
    uniforms.uOpacity.value +=
      ((this.completed ? 0.11 : 0.2 + bands.high * 0.08) - uniforms.uOpacity.value) *
      Math.min(1, deltaTime * 3);
    uniforms.uCompleted.value +=
      ((this.completed ? 1 : 0) - uniforms.uCompleted.value) * Math.min(1, deltaTime * 2);

    this.surfaceGeometry.attributes.position.needsUpdate = true;
    this.surfaceGeometry.computeVertexNormals();
  }

  private updateParticles(bands: AudioBands, deltaTime: number) {
    if (!this.completed) {
      this.particleEmission += Math.max(0, bands.high - 0.18) * deltaTime * 48;

      let spawnedThisFrame = 0;
      while (this.particleEmission >= 1 && spawnedThisFrame < 5) {
        this.spawnParticle(bands.high);
        this.particleEmission -= 1;
        spawnedThisFrame += 1;
      }
    }

    for (let i = 0; i < SoundSculpture.maxParticles; i += 1) {
      if (this.particleActive[i] === 0) {
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
        this.particleProgress[i] = Math.min(
          1,
          this.particleProgress[i] + deltaTime * speed,
        );

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

      const glow = this.completed ? 0.42 : 0.62 + bands.high * 0.34;
      this.particleColors[index] = 0.48 * glow;
      this.particleColors[index + 1] = 0.78 * glow;
      this.particleColors[index + 2] = 1.0 * glow;
    }

    this.particleMaterial.opacity +=
      ((this.completed ? 0.54 : 0.82) - this.particleMaterial.opacity) *
      Math.min(1, deltaTime * 3);
    this.particleGeometry.attributes.position.needsUpdate = true;
    this.particleGeometry.attributes.color.needsUpdate = true;
  }

  private spawnParticle(energy: number) {
    const particleIndex = this.particleCursor;
    const surfaceIndex = Math.floor(
      seededUnit(this.particleCursor, this.formingTime + energy * 13) *
        this.accumulated.length,
    );
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

    this.particleStartPositions[particlePositionIndex] =
      Math.cos(orbitAngle) * orbitRadius + nx * 0.24;
    this.particleStartPositions[particlePositionIndex + 1] =
      verticalDrift + ny * 0.36;
    this.particleStartPositions[particlePositionIndex + 2] =
      Math.sin(orbitAngle) * orbitRadius + nz * 0.24;
    this.particleTargetDirections[particlePositionIndex] = nx;
    this.particleTargetDirections[particlePositionIndex + 1] = ny;
    this.particleTargetDirections[particlePositionIndex + 2] = nz;
    this.particleTargetOffsets[particleIndex] =
      Math.max(-0.34, this.accumulated[surfaceIndex] * 0.86) +
      0.035 +
      energy * 0.04;
    this.particleProgress[particleIndex] = 0;
    this.particleActive[particleIndex] = 1;
    this.particleStuck[particleIndex] = 0;

    this.particlePositions[particlePositionIndex] =
      this.particleStartPositions[particlePositionIndex];
    this.particlePositions[particlePositionIndex + 1] =
      this.particleStartPositions[particlePositionIndex + 1];
    this.particlePositions[particlePositionIndex + 2] =
      this.particleStartPositions[particlePositionIndex + 2];

    this.particleCursor =
      (this.particleCursor + 1) % SoundSculpture.maxParticles;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const appElement = document.querySelector<HTMLElement>('#app');
const startButton = document.querySelector<HTMLButtonElement>('#start-audio');
const completeButton = document.querySelector<HTMLButtonElement>('#complete-sculpture');
const exportButton = document.querySelector<HTMLButtonElement>('#export-gltf');
const viewerControlFields = document.querySelector<HTMLFieldSetElement>(
  '#viewer-control-fields',
);
const lightAzimuthInput = document.querySelector<HTMLInputElement>('#light-azimuth');
const lightElevationInput =
  document.querySelector<HTMLInputElement>('#light-elevation');
const lightIntensityInput =
  document.querySelector<HTMLInputElement>('#light-intensity');
const resetViewButton = document.querySelector<HTMLButtonElement>('#reset-view');
const statusElement = document.querySelector<HTMLParagraphElement>('#status');

if (
  !canvas ||
  !appElement ||
  !startButton ||
  !completeButton ||
  !exportButton ||
  !viewerControlFields ||
  !lightAzimuthInput ||
  !lightElevationInput ||
  !lightIntensityInput ||
  !resetViewButton ||
  !statusElement
) {
  throw new Error('Required DOM elements are missing.');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf7f6f2);

const camera = new THREE.PerspectiveCamera(
  36,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
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

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enabled = false;
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.enablePan = false;
orbitControls.minDistance = 3.4;
orbitControls.maxDistance = 9;
orbitControls.target.set(0, 0, 0);
orbitControls.saveState();

const sculpture = new SoundSculpture();
scene.add(sculpture.group);

const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);
scene.add(keyLight.target);

const fillLight = new THREE.DirectionalLight(0xe8f0ff, 1.1);
fillLight.position.set(-4, 2, 2);
scene.add(fillLight);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0xd6d0c6, 2.4);
scene.add(ambientLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 18),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.045 }),
);
floor.position.y = -1.82;
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const audioInput = new AudioInput();
const clock = new THREE.Clock();
let isAudioReady = false;
let isComplete = false;
let hasHeardSound = false;
let silenceSeconds = 0;

const setStatus = (message: string) => {
  statusElement.textContent = message;
};

const updateKeyLight = () => {
  const azimuth = THREE.MathUtils.degToRad(Number(lightAzimuthInput.value));
  const elevation = THREE.MathUtils.degToRad(Number(lightElevationInput.value));
  const radius = 6;

  keyLight.position.set(
    Math.cos(elevation) * Math.sin(azimuth) * radius,
    Math.sin(elevation) * radius,
    Math.cos(elevation) * Math.cos(azimuth) * radius,
  );
  keyLight.intensity = Number(lightIntensityInput.value);
};

const completeSculpture = () => {
  if (isComplete) {
    return;
  }

  isComplete = true;
  silenceSeconds = 0;
  sculpture.complete();
  appElement.classList.add('is-complete');
  orbitControls.enabled = true;
  viewerControlFields.disabled = false;
  completeButton.disabled = true;
  exportButton.disabled = false;
  setStatus('完成 - マウス操作とライト調整ができます');
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const exportSculpture = () => {
  exportButton.disabled = true;
  setStatus('GLTF を書き出し中');

  const exporter = new GLTFExporter();
  const exportGroup = sculpture.createExportGroup();

  exporter.parse(
    exportGroup,
    (gltf) => {
      const blob =
        gltf instanceof ArrayBuffer
          ? new Blob([gltf], { type: 'model/gltf-binary' })
          : new Blob([JSON.stringify(gltf, null, 2)], {
              type: 'model/gltf+json',
            });

      downloadBlob(blob, 'sound-sculpture.gltf');
      exportButton.disabled = false;
      setStatus('完成 - GLTF を出力しました');
    },
    (error) => {
      console.error(error);
      exportButton.disabled = false;
      setStatus('GLTF 出力に失敗しました');
    },
    {
      binary: false,
      trs: true,
      onlyVisible: true,
    },
  );
};

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  setStatus('音入力を準備中');

  try {
    await audioInput.start();
    isAudioReady = true;
    completeButton.disabled = false;
    setStatus('形成中 - 音の圧力を蓄積しています');
  } catch (error) {
    startButton.disabled = false;
    setStatus('音入力を開始できませんでした');
    console.error(error);
  }
});

completeButton.addEventListener('click', completeSculpture);
exportButton.addEventListener('click', exportSculpture);
lightAzimuthInput.addEventListener('input', updateKeyLight);
lightElevationInput.addEventListener('input', updateKeyLight);
lightIntensityInput.addEventListener('input', updateKeyLight);
resetViewButton.addEventListener('click', () => {
  camera.position.set(0, 0.28, 6.4);
  orbitControls.target.set(0, 0, 0);
  orbitControls.update();
});

const resize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener('resize', resize);

const render = () => {
  const deltaTime = Math.min(0.033, clock.getDelta());
  const bands = isAudioReady ? audioInput.update() : { low: 0, mid: 0, high: 0, overall: 0 };

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

  sculpture.update(bands, deltaTime);
  orbitControls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
};

updateKeyLight();
render();
