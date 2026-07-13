import * as THREE from "three";
import type { AudioBands } from "./sculpture-types";
import {
  growthFlow,
  growthModulateScalar,
  growthPattern,
  type GrowthVec3,
} from "./growth-algorithm";
import type { BackgroundProfile, VisualStyleEnv } from "./visual-style";

const domeVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const domeFragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uHalo;
  uniform float uHaloStrength;
  uniform float uTime;
  uniform float uAudio;
  uniform float uStudio;
  uniform float uAbyss;
  uniform vec3 uCameraPos;
  varying vec3 vDir;

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
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y * 0.5 + 0.5;

    if (uAbyss > 0.5) {
      // 非線形の垂直グラデーション — 天頂が開き、深部は沈む
      float vGrad = pow(h, 0.58);
      vec3 col = mix(uBottom, uTop, smoothstep(0.02, 0.98, vGrad));

      // 地平方向の大気遠近 — 水平線ほど霞が厚く、奥行きの手がかりになる
      float horizonView = 1.0 - abs(dir.y);
      float atmosHaze = horizonView * horizonView * (0.55 + noise(dir * 1.8 + vec3(uTime * 0.01)) * 0.45);
      col = mix(col, uHalo, atmosHaze * 0.26);

      // 高度ごとの霞レイヤー（深海の層 + 宇宙の微光）
      float murk = noise(dir * 2.4 + vec3(uTime * 0.018, uTime * 0.012, uTime * 0.008));
      float midHaze = smoothstep(0.12, 0.68, h) * (murk * 0.45 + 0.55);
      col += uHalo * midHaze * 0.065;
      float shelfA = smoothstep(0.18, 0.32, h) * (1.0 - smoothstep(0.32, 0.48, h));
      float shelfB = smoothstep(0.48, 0.62, h) * (1.0 - smoothstep(0.62, 0.78, h));
      col += uHalo * (shelfA * 0.03 + shelfB * 0.045);
      float starMist = smoothstep(0.5, 0.99, h);
      float mistNoise = noise(dir * 5.0 + vec3(0.0, uTime * 0.03, 0.0));
      col += uTop * starMist * (mistNoise * 0.35 + 0.25) * 0.2;
      float abyssBands = sin(dir.x * 9.0 + dir.z * 7.0 + uTime * 0.06) * 0.032;
      col *= 1.0 + abyssBands * smoothstep(0.08, 0.7, h);

      vec3 behind = normalize(uCameraPos);
      float halo = smoothstep(0.5, 0.99, dot(dir, behind));
      float haloStrength = uHaloStrength * 1.15 * (1.0 + uAudio * 0.06);
      col = mix(col, uHalo, halo * halo * haloStrength);
      gl_FragColor = vec4(col, 1.0);
      return;
    }

    vec3 col = mix(uBottom, uTop, smoothstep(0.06, 0.94, h));
    float horizon = smoothstep(0.02, 0.38, h);
    float horizonFloor = 0.62;
    col *= mix(horizonFloor, 1.0, horizon);

    float depthBands = sin(dir.x * 18.0 + dir.z * 14.0) * 0.012 + sin(dir.y * 22.0) * 0.008;
    col *= 1.0 - depthBands;

    if (uStudio > 0.5) {
      float air = noise(dir * 3.2 + vec3(uTime * 0.04, uTime * 0.025, 0.0));
      float wisp = smoothstep(0.38, 0.9, h) * (air * 0.5 + 0.5);
      col += uHalo * wisp * 0.065;
      float windowGlow = smoothstep(0.05, 0.28, h) * (1.0 - smoothstep(0.28, 0.52, h));
      col = mix(col, uHalo, windowGlow * 0.24);
      float ceilingWarm = smoothstep(0.72, 0.98, h);
      col = mix(col, uTop, ceilingWarm * 0.08);
    }

    vec3 behind = normalize(uCameraPos);
    float halo = smoothstep(0.55, 0.985, dot(dir, behind));
    float haloBoost = 1.0;
    float audioPulse = uStudio > 0.5 ? 0.08 : 0.0;
    float haloStrength = uHaloStrength * haloBoost * (1.0 + uAudio * audioPulse);
    col = mix(col, uHalo, halo * halo * haloStrength);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const innerDomeFragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y * 0.5 + 0.5;
    vec3 col = mix(uBottom, uTop, smoothstep(0.1, 0.9, h));
    col *= mix(0.75, 1.0, smoothstep(0.05, 0.35, h));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * 背景に奥行きを与えるグラデーションドーム。
 */
class BackgroundDome {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly _hsl = { h: 0, s: 0, l: 0 };
  private baseHaloStrength = 0.55;

  constructor(radius: number, renderOrder: number, inner = false) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uHalo: { value: new THREE.Color() },
        uHaloStrength: { value: 0.55 },
        uTime: { value: 0 },
        uAudio: { value: 0 },
        uStudio: { value: 0 },
        uAbyss: { value: 0 },
        uCameraPos: { value: new THREE.Vector3(0, 0.28, 6.4) },
      },
      vertexShader: domeVertexShader,
      fragmentShader: inner ? innerDomeFragmentShader : domeFragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), this.material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
  }

  setStudioVariant(enabled: boolean) {
    this.material.uniforms.uStudio.value = enabled ? 1 : 0;
  }

  setAbyssVariant(enabled: boolean) {
    this.material.uniforms.uAbyss.value = enabled ? 1 : 0;
  }

  setFromBackground(base: THREE.Color, dark: boolean, studio = false, abyss = false) {
    base.getHSL(this._hsl);
    const { h, s, l } = this._hsl;
    const top = this.material.uniforms.uTop.value as THREE.Color;
    const bottom = this.material.uniforms.uBottom.value as THREE.Color;
    const halo = this.material.uniforms.uHalo.value as THREE.Color;
    if (abyss) {
      const abyssHue = THREE.MathUtils.lerp(h, 0.58, 0.48);
      top.setHSL(abyssHue, Math.min(1, s * 1.6 + 0.18), Math.min(0.2, l * 2.4 + 0.08));
      bottom.setHSL(abyssHue, Math.min(1, s * 1.1 + 0.08), Math.max(0.028, l * 0.32));
      halo.setHSL(abyssHue + 0.03, Math.min(1, s * 1.2 + 0.22), Math.min(0.18, l * 2.6 + 0.06));
      this.baseHaloStrength = 1.05;
    } else if (dark) {
      top.setHSL(h, Math.min(1, s * 1.15 + 0.02), Math.min(1, l * 1.9 + 0.015));
      bottom.setHSL(h, s, Math.max(0, l * 0.45));
      halo.setHSL(h, Math.min(1, s * 0.8 + 0.1), Math.min(0.32, l * 2.6 + 0.05));
      this.baseHaloStrength = 0.7;
    } else if (studio) {
      top.setHSL(h, Math.min(1, s + 0.02), Math.min(1, l + 0.035));
      bottom.setHSL(h, Math.min(1, s + 0.04), Math.max(0, l - 0.1));
      halo.setHSL(h, Math.max(0, s + 0.06), Math.min(1, l + 0.055));
      this.baseHaloStrength = 0.92;
    } else {
      top.setHSL(h, s, Math.min(1, l + 0.025));
      bottom.setHSL(h, Math.min(1, s + 0.03), Math.max(0, l - 0.085));
      halo.setHSL(h, Math.max(0, s - 0.02), Math.min(1, l + 0.035));
      this.baseHaloStrength = 0.9;
    }
    this.material.uniforms.uHaloStrength.value = this.baseHaloStrength;
  }

  update(time: number, audio: number, camera?: THREE.Vector3) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAudio.value = audio;
    if (camera) {
      (this.material.uniforms.uCameraPos.value as THREE.Vector3).copy(camera);
    }
  }

  applyParallax(camera: THREE.Vector3, amount: number) {
    this.mesh.position.set(camera.x * amount, camera.y * amount * 0.85, camera.z * amount);
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
  private readonly anchorPositions: Float32Array | null;
  private readonly particleSeed: Float32Array | null;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly parallax: number;
  private readonly parallaxAmount: number;
  private readonly organicDrift: boolean;
  private readonly baseOpacity: number;
  private readonly _flowOut: GrowthVec3 = { x: 0, y: 0, z: 0 };

  constructor(options?: {
    count?: number;
    minRadius?: number;
    maxRadius?: number;
    size?: number;
    baseOpacity?: number;
    parallax?: number;
    parallaxAmount?: number;
    coolBias?: boolean;
    /** 成長アルゴリズムに則った深海のふよふよ漂い（vita abyss） */
    organicDrift?: boolean;
  }) {
    const count = options?.count ?? 2400;
    const minRadius = options?.minRadius ?? 26;
    const maxRadius = options?.maxRadius ?? 60;
    const pointSize = options?.size ?? 0.022;
    const baseOpacity = options?.baseOpacity ?? 0.9;
    const coolBias = options?.coolBias ?? false;
    this.parallax = options?.parallax ?? 1;
    this.parallaxAmount = options?.parallaxAmount ?? 0.04;
    this.organicDrift = options?.organicDrift === true;
    this.baseOpacity = baseOpacity;
    this.anchorPositions = this.organicDrift ? new Float32Array(count * 3) : null;
    this.particleSeed = this.organicDrift ? new Float32Array(count) : null;

    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.twinklePhase = new Float32Array(count);
    this.twinkleRate = new Float32Array(count);
    this.driftDir = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      const nx = sinPhi * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = sinPhi * Math.sin(theta);

      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      this.positions[idx] = nx * radius;
      this.positions[idx + 1] = ny * radius * 0.78;
      this.positions[idx + 2] = nz * radius;

      if (this.anchorPositions) {
        this.anchorPositions[idx] = this.positions[idx];
        this.anchorPositions[idx + 1] = this.positions[idx + 1];
        this.anchorPositions[idx + 2] = this.positions[idx + 2];
      }
      if (this.particleSeed) {
        this.particleSeed[i] = Math.random() * 80 + i * 0.017;
      }

      const dx = (Math.random() - 0.5) * 0.5;
      const dy = (Math.random() - 0.5) * 0.35;
      const dz = (Math.random() - 0.5) * 0.5;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.driftDir[idx] = dx / len;
      this.driftDir[idx + 1] = dy / len;
      this.driftDir[idx + 2] = dz / len;

      const warm = !coolBias && Math.random() < 0.08;
      const tint = 0.6 + Math.random() * 0.4;
      let r: number;
      let g: number;
      let b: number;
      if (coolBias) {
        r = 0.55 * tint;
        g = 0.72 * tint;
        b = 1.0 * tint;
      } else {
        r = warm ? 0.95 * tint : 0.65 * tint;
        g = warm ? 0.85 * tint : 0.78 * tint;
        b = warm ? 1.0 * tint : 1.0 * tint;
      }

      const bright = Math.pow(Math.random(), 3.2);
      const intensity = this.organicDrift
        ? 0.42 + (1 - bright) * 0.95
        : 0.18 + (1 - bright) * 0.95;

      this.baseColors[idx] = r * intensity;
      this.baseColors[idx + 1] = g * intensity;
      this.baseColors[idx + 2] = b * intensity;
      this.colors[idx] = this.baseColors[idx];
      this.colors[idx + 1] = this.baseColors[idx + 1];
      this.colors[idx + 2] = this.baseColors[idx + 2];

      this.twinklePhase[i] = Math.random() * Math.PI * 2;
      this.twinkleRate[i] = this.organicDrift ? 0.12 + Math.random() * 0.38 : 0.25 + Math.random() * 0.9;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;
  }

  update(time: number, bands: AudioBands, deltaTime: number, cameraPosition?: THREE.Vector3) {
    if (this.organicDrift && this.anchorPositions && this.particleSeed) {
      this.updateOrganicDrift(time, bands, deltaTime, cameraPosition);
      return;
    }

    const audioTwinkle = 0.18 + bands.high * 0.35 + bands.brightness * 0.25;
    const calm = 1 - bands.sub * 0.25;

    const drift = deltaTime * 0.05 * (0.35 + audioTwinkle) * calm * this.parallax;
    const count = this.twinklePhase.length;
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
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

    if (cameraPosition) {
      const px = cameraPosition.x * (1 - this.parallax) * this.parallaxAmount;
      const py = cameraPosition.y * (1 - this.parallax) * this.parallaxAmount * 0.85;
      const pz = cameraPosition.z * (1 - this.parallax) * this.parallaxAmount;
      this.points.position.set(px, py, pz);
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.75 + bands.high * 0.12;
  }

  /** vita: 成長アルゴリズムの flow / pattern で深海のふよふよ漂い */
  private updateOrganicDrift(
    time: number,
    bands: AudioBands,
    deltaTime: number,
    cameraPosition?: THREE.Vector3,
  ) {
    const anchors = this.anchorPositions!;
    const seeds = this.particleSeed!;
    const calm = 1 - bands.sub * 0.2;
    const activity = bands.overall * 0.45 + bands.melody * 0.4 + bands.brightness * 0.2;
    const slow = time * 0.26;
    const count = this.twinklePhase.length;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const ax = anchors[idx];
      const ay = anchors[idx + 1];
      const az = anchors[idx + 2];
      const shellR = Math.hypot(ax, ay, az) || 1;
      const nx = ax / shellR;
      const ny = ay / shellR;
      const nz = az / shellR;
      const seed = seeds[i];
      const phase = this.twinklePhase[i];
      const rate = this.twinkleRate[i];

      const patternSlow = growthPattern(nx * 0.82, ny * 0.82, nz * 0.82, seed + slow * 0.52);
      const patternFast = growthPattern(
        nx * 1.28,
        ny * 1.28,
        nz * 1.28,
        seed + slow * 0.74 + 9.6,
      );
      // pattern は -1..1 — 0..1 に正規化して明滅が消えないようにする
      const breathe = (patternSlow * 0.64 + patternFast * 0.36) * 0.5 + 0.5;
      const hueWave = growthPattern(nx, ny, nz, seed + 14.2 + slow * 0.22) * 0.5 + 0.5;

      growthFlow(nx * 1.02, ny * 1.02, nz * 1.02, seed + slow * 0.44, this._flowOut);

      const idleGain = growthModulateScalar(1, nx, ny, nz, seed + slow * 0.35, "idle");
      const flowGain = growthModulateScalar(1, nx, ny, nz, seed + slow * 0.62, "flow");
      const liveGain = growthModulateScalar(Math.max(0.08, activity), nx, ny, nz, seed + slow * 0.18, "live");

      const floatA = Math.sin(time * rate + phase + breathe * Math.PI * 2);
      const floatB = Math.sin(time * rate * 0.58 + phase * 1.4 + patternFast * 2.2);
      const buoy = Math.sin(time * 0.19 + phase * 0.7 + breathe * Math.PI * 2) * 0.022 * idleGain;

      const driftAmp =
        (0.018 + breathe * 0.024 + liveGain * 0.016) * idleGain * flowGain * calm * this.parallax;
      const radialAmp = (0.012 + breathe * 0.014) * floatA * idleGain;

      let px = ax + this._flowOut.x * floatB * driftAmp + nx * radialAmp;
      let py = ay + this._flowOut.y * floatA * driftAmp * 0.52 + ny * radialAmp + buoy;
      let pz = az + this._flowOut.z * floatB * driftAmp + nz * radialAmp;

      const cr = Math.hypot(px, py, pz) || 1;
      const radiusPull = (shellR - cr) * Math.min(1, deltaTime * 2.8);
      px += (px / cr) * radiusPull;
      py += (py / cr) * radiusPull;
      pz += (pz / cr) * radiusPull;

      this.positions[idx] = px;
      this.positions[idx + 1] = py;
      this.positions[idx + 2] = pz;

      const twinkle =
        0.78 +
        0.22 * Math.sin(time * rate * 0.48 + phase) * (0.8 + activity * 0.45 + breathe * 0.2);
      const colorGain = (0.82 + breathe * 0.28 + liveGain * 0.35) * twinkle;
      const rShift = 0.92 + hueWave * 0.16;
      const gShift = 0.9 + breathe * 0.18 + hueWave * 0.08;
      const bShift = 0.88 + breathe * 0.14 + hueWave * 0.2;

      this.colors[idx] = Math.max(0.04, this.baseColors[idx] * colorGain * rShift);
      this.colors[idx + 1] = Math.max(0.04, this.baseColors[idx + 1] * colorGain * gShift);
      this.colors[idx + 2] = Math.max(0.06, this.baseColors[idx + 2] * colorGain * bShift);
    }

    if (cameraPosition) {
      const px = cameraPosition.x * (1 - this.parallax) * this.parallaxAmount;
      const py = cameraPosition.y * (1 - this.parallax) * this.parallaxAmount * 0.85;
      const pz = cameraPosition.z * (1 - this.parallax) * this.parallaxAmount;
      this.points.position.set(px, py, pz);
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = this.baseOpacity * (0.9 + activity * 0.14 + bands.high * 0.08);
  }
}

/** 工房の浮遊ダスト — 近距離・暖色・ゆっくり */
class DustMoteField {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly driftDir: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(count = 520) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.driftDir = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      const radius = 4 + Math.random() * 10;

      this.positions[idx] = sinPhi * Math.cos(theta) * radius;
      this.positions[idx + 1] = (Math.cos(phi) * radius * 0.55 - 0.2) * 0.9;
      this.positions[idx + 2] = sinPhi * Math.sin(theta) * radius;

      const dx = (Math.random() - 0.5) * 0.2;
      const dy = (Math.random() - 0.5) * 0.12;
      const dz = (Math.random() - 0.5) * 0.2;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.driftDir[idx] = dx / len;
      this.driftDir[idx + 1] = dy / len;
      this.driftDir[idx + 2] = dz / len;

      const warm = 0.88 + Math.random() * 0.12;
      const intensity = 0.12 + Math.random() * 0.35;
      this.baseColors[idx] = warm * intensity;
      this.baseColors[idx + 1] = (warm - 0.04) * intensity;
      this.baseColors[idx + 2] = (warm - 0.12) * intensity;
      this.colors[idx] = this.baseColors[idx];
      this.colors[idx + 1] = this.baseColors[idx + 1];
      this.colors[idx + 2] = this.baseColors[idx + 2];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.022,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -5;
  }

  update(bands: AudioBands, deltaTime: number, cameraPosition?: THREE.Vector3) {
    const drift = deltaTime * 0.012 * (0.7 + bands.brightness * 0.35);
    const brighten = 1 + bands.high * 0.22 + bands.brightness * 0.15;
    const count = this.positions.length / 3;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      this.positions[idx] += this.driftDir[idx] * drift;
      this.positions[idx + 1] += this.driftDir[idx + 1] * drift;
      this.positions[idx + 2] += this.driftDir[idx + 2] * drift;
      this.colors[idx] = this.baseColors[idx] * brighten;
      this.colors[idx + 1] = this.baseColors[idx + 1] * brighten;
      this.colors[idx + 2] = this.baseColors[idx + 2] * brighten;
    }

    if (cameraPosition) {
      this.points.position.set(cameraPosition.x * 0.02, cameraPosition.y * 0.015, cameraPosition.z * 0.02);
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.5 + bands.brightness * 0.2;
  }
}

/** 深海の生物発光粒子 — 遠距離・寒色・疎 */
class BiolumeMoteField {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly driftDir: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor(options?: {
    count?: number;
    size?: number;
    baseOpacity?: number;
    minRadius?: number;
    maxRadius?: number;
    intensityScale?: number;
  }) {
    const count = options?.count ?? 280;
    const pointSize = options?.size ?? 0.018;
    const baseOpacity = options?.baseOpacity ?? 0.38;
    const minRadius = options?.minRadius ?? 18;
    const maxRadius = options?.maxRadius ?? 75;
    const intensityScale = options?.intensityScale ?? 1;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.driftDir = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      const radius = minRadius + Math.random() * (maxRadius - minRadius);

      this.positions[idx] = sinPhi * Math.cos(theta) * radius;
      this.positions[idx + 1] = Math.cos(phi) * radius * 0.72;
      this.positions[idx + 2] = sinPhi * Math.sin(theta) * radius;

      const dx = (Math.random() - 0.5) * 0.14;
      const dy = (Math.random() - 0.5) * 0.08;
      const dz = (Math.random() - 0.5) * 0.14;
      const len = Math.hypot(dx, dy, dz) || 1;
      this.driftDir[idx] = dx / len;
      this.driftDir[idx + 1] = dy / len;
      this.driftDir[idx + 2] = dz / len;

      const hue = 0.48 + Math.random() * 0.14;
      const intensity = (0.12 + Math.random() * 0.36) * intensityScale;
      const color = new THREE.Color().setHSL(hue, 0.55 + Math.random() * 0.25, 0.45 + Math.random() * 0.2);
      this.baseColors[idx] = color.r * intensity;
      this.baseColors[idx + 1] = color.g * intensity;
      this.baseColors[idx + 2] = color.b * intensity;
      this.colors[idx] = this.baseColors[idx];
      this.colors[idx + 1] = this.baseColors[idx + 1];
      this.colors[idx + 2] = this.baseColors[idx + 2];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -6;
  }

  update(bands: AudioBands, deltaTime: number, cameraPosition?: THREE.Vector3) {
    const drift = deltaTime * 0.006 * (0.6 + bands.brightness * 0.3 + bands.melody * 0.15);
    const brighten = 1 + bands.brightness * 0.18 + bands.melody * 0.12;
    const count = this.positions.length / 3;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      this.positions[idx] += this.driftDir[idx] * drift;
      this.positions[idx + 1] += this.driftDir[idx + 1] * drift;
      this.positions[idx + 2] += this.driftDir[idx + 2] * drift;
      this.colors[idx] = this.baseColors[idx] * brighten;
      this.colors[idx + 1] = this.baseColors[idx + 1] * brighten;
      this.colors[idx + 2] = this.baseColors[idx + 2] * brighten;
    }

    if (cameraPosition) {
      this.points.position.set(
        cameraPosition.x * 0.012,
        cameraPosition.y * 0.009,
        cameraPosition.z * 0.012,
      );
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.42 + bands.brightness * 0.14 + bands.melody * 0.1;
  }
}

/** 工房サイクロラマ — 背面の曲面壁（上明→下暗のグラデーション） */
class StudioCyclorama {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private envMix = 0;
  private readonly _formingTop = new THREE.Color();
  private readonly _formingBottom = new THREE.Color();
  private readonly _completeTop = new THREE.Color();
  private readonly _completeBottom = new THREE.Color();

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexColors: true,
    });
    this.geometry = new THREE.CylinderGeometry(13.5, 13.5, 9, 72, 4, true);
    this.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.geometry.attributes.position.count * 3), 3));
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = -0.55;
    this.mesh.renderOrder = -8;
    this.mesh.frustumCulled = false;
  }

  setPalette(forming: THREE.Color, complete: THREE.Color) {
    this.setWallColors(forming, this._formingTop, this._formingBottom);
    this.setWallColors(complete, this._completeTop, this._completeBottom);
    this.applyVertexColors();
  }

  applyEnvMix(envMix: number) {
    this.envMix = envMix;
    this.applyVertexColors();
  }

  setFromBackground(base: THREE.Color, envMix: number) {
    this.setWallColors(base, this._formingTop, this._formingBottom);
    const completeBase = base.clone();
    completeBase.getHSL(this._tmpHsl);
    completeBase.setHSL(this._tmpHsl.h, this._tmpHsl.s * 0.88, this._tmpHsl.l * 0.94);
    this.setWallColors(completeBase, this._completeTop, this._completeBottom);
    this.envMix = envMix;
    this.applyVertexColors();
  }

  private setWallColors(base: THREE.Color, topOut: THREE.Color, bottomOut: THREE.Color) {
    base.getHSL(this._tmpHsl);
    topOut.setHSL(
      this._tmpHsl.h,
      Math.min(1, this._tmpHsl.s + 0.05),
      Math.max(0.72, this._tmpHsl.l - 0.02),
    );
    bottomOut.setHSL(
      this._tmpHsl.h,
      Math.min(1, this._tmpHsl.s + 0.08),
      Math.max(0.42, this._tmpHsl.l - 0.2),
    );
  }

  private applyVertexColors() {
    const top = this._formingTop.clone().lerp(this._completeTop, this.envMix);
    const bottom = this._formingBottom.clone().lerp(this._completeBottom, this.envMix);
    const colors = this.geometry.attributes.color as THREE.BufferAttribute;
    const pos = this.geometry.attributes.position;
    const mix = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.smoothstep(y, -4.8, 3.8);
      mix.copy(bottom).lerp(top, t);
      colors.setXYZ(i, mix.r, mix.g, mix.b);
    }
    colors.needsUpdate = true;
  }

  private readonly _tmpHsl = { h: 0, s: 0, l: 0 };
}

/** 暖色グラデーションの工房床 */
class StudioFloor {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;

  constructor() {
    const segments = 64;
    const geo = new THREE.CircleGeometry(14, segments);
    const colors = new Float32Array(segments * 3 * 3);
    const color = new THREE.Color();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z) / 14;
      color.setHSL(0.09, 0.12, 0.88 - r * 0.14);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = -1.82;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = -6;
  }

  setFromBackground(base: THREE.Color, envMix: number) {
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const geo = this.mesh.geometry as THREE.CircleGeometry;
    const colors = geo.attributes.color as THREE.BufferAttribute;
    const color = new THREE.Color();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z) / 14;
      const light = (hsl.l + 0.06 - r * 0.12) * (1 - envMix * 0.05);
      color.setHSL(hsl.h, Math.min(0.16, hsl.s + 0.06), Math.max(0.68, light));
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }
}

export class SceneBackground {
  private readonly dome: BackgroundDome;
  private readonly innerDome: BackgroundDome | null;
  private readonly starsNear: StarField;
  private readonly starsMid: StarField | null;
  private readonly starsFar: StarField;
  private readonly dust: DustMoteField | null;
  private readonly biolume: BiolumeMoteField | null;
  private readonly biolumeFar: BiolumeMoteField | null;
  private readonly cyclorama: StudioCyclorama | null;
  private readonly studioFloor: StudioFloor | null;
  readonly floor: THREE.Mesh;
  private readonly profile: BackgroundProfile | undefined;
  private readonly studioVariant: boolean;
  private readonly abyssVariant: boolean;
  private readonly openVoid: boolean;
  private audioSmooth = 0;
  private envMix = 0;
  private formingColor = new THREE.Color();
  private completeColor = new THREE.Color();

  constructor(sceneEnv: VisualStyleEnv, themeDark: boolean) {
    this.profile = sceneEnv.backgroundProfile;
    this.abyssVariant = this.profile?.domeVariant === "abyss";
    this.studioVariant = this.profile?.domeVariant === "studio" && !themeDark;
    this.openVoid = this.profile?.openVoid === true;

    const outerRadius = this.abyssVariant ? 160 : 46;
    const innerRadius = this.abyssVariant ? 72 : 38;

    this.dome = new BackgroundDome(outerRadius, -20);
    this.dome.setStudioVariant(this.studioVariant);
    this.dome.setAbyssVariant(this.abyssVariant);

    this.innerDome =
      this.studioVariant || (this.abyssVariant && !this.openVoid)
        ? new BackgroundDome(innerRadius, -18, true)
        : null;
    if (this.innerDome) {
      this.innerDome.setAbyssVariant(this.abyssVariant);
    }

    this.starsNear = new StarField({
      count: this.abyssVariant ? 640 : 820,
      minRadius: 10,
      maxRadius: this.abyssVariant ? 22 : 26,
      size: this.abyssVariant ? 0.034 : 0.028,
      baseOpacity: this.abyssVariant ? 0.92 : 0.95,
      parallax: 1.6,
      parallaxAmount: this.abyssVariant ? 0.14 : 0.04,
      coolBias: this.abyssVariant,
      organicDrift: this.abyssVariant,
    });
    this.starsMid = this.abyssVariant
      ? new StarField({
          count: 1800,
          minRadius: 30,
          maxRadius: 72,
          size: 0.022,
          baseOpacity: 0.78,
          parallax: 0.78,
          parallaxAmount: 0.08,
          coolBias: true,
          organicDrift: true,
        })
      : null;
    this.starsFar = new StarField({
      count: this.abyssVariant ? 5600 : 3400,
      minRadius: 28,
      maxRadius: this.abyssVariant ? 150 : 58,
      size: this.abyssVariant ? 0.016 : 0.015,
      baseOpacity: this.abyssVariant ? 0.72 : 0.72,
      parallax: 0.38,
      parallaxAmount: this.abyssVariant ? 0.05 : 0.04,
      coolBias: this.abyssVariant,
      organicDrift: this.abyssVariant,
    });

    this.dust = this.profile?.dustMotes ? new DustMoteField() : null;
    this.biolume = this.profile?.biolumeMotes
      ? new BiolumeMoteField({
          count: 200,
          size: 0.03,
          baseOpacity: 0.48,
          minRadius: 6,
          maxRadius: 24,
          intensityScale: 1.35,
        })
      : null;
    this.biolumeFar = this.profile?.biolumeMotes
      ? new BiolumeMoteField({
          count: 360,
          size: 0.014,
          baseOpacity: 0.22,
          minRadius: 38,
          maxRadius: 110,
          intensityScale: 0.75,
        })
      : null;
    this.cyclorama = this.profile?.studioSpace ? new StudioCyclorama() : null;
    this.studioFloor = this.profile?.studioSpace ? new StudioFloor() : null;

    if (this.studioFloor) {
      this.floor = this.studioFloor.mesh;
    } else if (this.openVoid) {
      this.floor = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.ShadowMaterial({ color: 0x000000, opacity: 0 }),
      );
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.position.y = -1.82;
      this.floor.receiveShadow = true;
      this.floor.visible = false;
    } else {
      this.floor = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 18),
        new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.045 }),
      );
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.position.y = -1.82;
      this.floor.receiveShadow = true;
    }

    this.starsNear.points.visible = sceneEnv.stars;
    if (this.starsMid) {
      this.starsMid.points.visible = sceneEnv.stars;
    }
    this.starsFar.points.visible = sceneEnv.stars;
    if (this.dust) {
      this.dust.points.visible = true;
    }
    if (this.biolume) {
      this.biolume.points.visible = true;
    }
    if (this.biolumeFar) {
      this.biolumeFar.points.visible = true;
    }

    this.formingColor.setHex(sceneEnv.background);
    this.completeColor.setHex(sceneEnv.backgroundComplete);
    this.cyclorama?.setPalette(this.formingColor, this.completeColor);
  }

  addToScene(scene: THREE.Scene) {
    scene.add(this.dome.mesh);
    if (this.innerDome) {
      scene.add(this.innerDome.mesh);
    }
    scene.add(this.starsFar.points);
    if (this.starsMid) {
      scene.add(this.starsMid.points);
    }
    scene.add(this.starsNear.points);
    if (this.dust) {
      scene.add(this.dust.points);
    }
    if (this.biolume) {
      scene.add(this.biolume.points);
    }
    if (this.biolumeFar) {
      scene.add(this.biolumeFar.points);
    }
    if (this.cyclorama) {
      scene.add(this.cyclorama.mesh);
    }
    if (!this.openVoid) {
      scene.add(this.floor);
    } else if (this.floor.receiveShadow) {
      scene.add(this.floor);
    }
  }

  setPedestalLayout(usePedestal: boolean) {
    this.floor.position.y = usePedestal ? -2.62 : -1.82;
  }

  setPaletteColors(forming: THREE.Color, complete: THREE.Color) {
    this.formingColor.copy(forming);
    this.completeColor.copy(complete);
    this.cyclorama?.setPalette(this.formingColor, this.completeColor);
  }

  setFromBackground(color: THREE.Color, dark: boolean, envMix = 0) {
    this.envMix = envMix;
    this.dome.setFromBackground(color, dark, this.studioVariant, this.abyssVariant);
    this.innerDome?.setFromBackground(color, dark, this.studioVariant, this.abyssVariant);
    this.cyclorama?.setFromBackground(color, envMix);
    this.studioFloor?.setFromBackground(color, envMix);
  }

  getFogDensity(dark: boolean) {
    if (this.profile?.fogDensity !== undefined) {
      return this.profile.fogDensity;
    }
    if (this.profile?.studioSpace) {
      return dark ? 0.0078 : 0.0048;
    }
    return dark ? 0.0078 : 0.0058;
  }

  syncFog(scene: THREE.Scene, color: THREE.Color, dark: boolean) {
    const density = this.getFogDensity(dark);
    if (this.abyssVariant) {
      const fogColor = color.clone();
      const hsl = { h: 0, s: 0, l: 0 };
      fogColor.getHSL(hsl);
      fogColor.setHSL(
        hsl.h + 0.015,
        Math.min(1, hsl.s * 1.1 + 0.08),
        Math.min(0.08, hsl.l * 1.6 + 0.025),
      );
      scene.fog = new THREE.FogExp2(fogColor.getHex(), density * 0.88);
      return;
    }
    scene.fog = new THREE.FogExp2(color.getHex(), density);
  }

  setStarsVisible(visible: boolean) {
    this.starsNear.points.visible = visible;
    if (this.starsMid) {
      this.starsMid.points.visible = visible;
    }
    this.starsFar.points.visible = visible;
  }

  update(time: number, bands: AudioBands, deltaTime: number, camera: THREE.PerspectiveCamera) {
    const targetAudio = bands.overall * 0.55 + bands.melody * 0.45;
    this.audioSmooth += (targetAudio - this.audioSmooth) * Math.min(1, deltaTime * 3.5);

    this.dome.update(time, this.audioSmooth, camera.position);
    if (this.abyssVariant) {
      this.dome.applyParallax(camera.position, this.openVoid ? 0.045 : 0.022);
    }
    this.innerDome?.update(time, this.audioSmooth, camera.position);
    this.innerDome?.applyParallax(camera.position, this.abyssVariant ? 0.018 : 0.025);

    if (this.starsNear.points.visible) {
      this.starsNear.update(time, bands, deltaTime, camera.position);
      this.starsMid?.update(time, bands, deltaTime, camera.position);
      this.starsFar.update(time, bands, deltaTime, camera.position);
    }
    this.dust?.update(bands, deltaTime, camera.position);
    this.biolume?.update(bands, deltaTime, camera.position);
    this.biolumeFar?.update(bands, deltaTime, camera.position);

    if (this.cyclorama) {
      this.cyclorama.applyEnvMix(this.envMix);
    }
  }
}
