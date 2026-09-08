import * as THREE from "three";
import type { AudioBands } from "./sculpture-types";
import {
  getGrowthAlgorithmId,
  growthFlow,
  growthModulateScalar,
  growthModulateVector3,
  growthPattern,
  isHeavyGrowthPatternAlgorithm,
  type GrowthVec3,
} from "./growth-algorithm";
import type { BackgroundProfile, VisualStyleEnv } from "./visual-style";
/** Codrops Procedural Clouds の外形 / ノイズ画像 */
import cloudShapeUrl from "./assets/clouds/shape.png";
import cloudNoiseUrl from "./assets/clouds/noise.png";

/**
 * 星ドリフト用の共有成長フィールド。
 * 毎星で growthPattern/flow を呼ばず、球面上の少数サンプルを全レイヤーで再利用する。
 */
const STAR_GROWTH_SAMPLE_COUNT = 48;
const STAR_GROWTH_DIRS = (() => {
  const dirs = new Float32Array(STAR_GROWTH_SAMPLE_COUNT * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < STAR_GROWTH_SAMPLE_COUNT; i += 1) {
    const y = 1 - (i / Math.max(1, STAR_GROWTH_SAMPLE_COUNT - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const idx = i * 3;
    dirs[idx] = Math.cos(theta) * r;
    dirs[idx + 1] = y;
    dirs[idx + 2] = Math.sin(theta) * r;
  }
  return dirs;
})();

const starGrowthPatternSlow = new Float32Array(STAR_GROWTH_SAMPLE_COUNT);
const starGrowthPatternFast = new Float32Array(STAR_GROWTH_SAMPLE_COUNT);
const starGrowthFlow = new Float32Array(STAR_GROWTH_SAMPLE_COUNT * 3);
const starGrowthFlowTmp = { x: 0, y: 0, z: 0 };
let starGrowthFieldClock = -1e9;
let starGrowthFieldAlgo = "";

const refreshStarGrowthField = (time: number) => {
  const algoId = getGrowthAlgorithmId();
  // 重い pattern は更新頻度を下げる（星は遅い漂いで足りる）
  const minInterval = isHeavyGrowthPatternAlgorithm(algoId) ? 1 / 8 : 1 / 24;
  if (algoId === starGrowthFieldAlgo && time - starGrowthFieldClock < minInterval) {
    return;
  }
  starGrowthFieldAlgo = algoId;
  starGrowthFieldClock = time;

  const slow = time * 0.32;
  const fast = time * 0.58 + 13.7;
  const flowSalt = slow * 0.55;
  const heavy = isHeavyGrowthPatternAlgorithm(algoId);
  // 重い algo はサンプル半分だけ再計算
  const sampleStride = heavy ? 2 : 1;
  const samplePhase = heavy ? Math.floor(time * 8) % sampleStride : 0;

  for (let i = samplePhase; i < STAR_GROWTH_SAMPLE_COUNT; i += sampleStride) {
    const di = i * 3;
    const nx = STAR_GROWTH_DIRS[di];
    const ny = STAR_GROWTH_DIRS[di + 1];
    const nz = STAR_GROWTH_DIRS[di + 2];
    starGrowthPatternSlow[i] = growthPattern(nx * 0.75, ny * 0.75, nz * 0.75, slow + i * 0.017);
    starGrowthPatternFast[i] = growthPattern(nx * 1.35, ny * 1.35, nz * 1.35, fast + i * 0.031);
    growthFlow(nx * 1.1, ny * 1.1, nz * 1.1, flowSalt + i * 0.11, starGrowthFlowTmp);
    // 接線成分へ
    const dot = starGrowthFlowTmp.x * nx + starGrowthFlowTmp.y * ny + starGrowthFlowTmp.z * nz;
    let fx = starGrowthFlowTmp.x - nx * dot;
    let fy = starGrowthFlowTmp.y - ny * dot;
    let fz = starGrowthFlowTmp.z - nz * dot;
    const len = Math.hypot(fx, fy, fz) || 1;
    starGrowthFlow[di] = fx / len;
    starGrowthFlow[di + 1] = fy / len;
    starGrowthFlow[di + 2] = fz / len;
  }
};

const nearestStarGrowthSample = (nx: number, ny: number, nz: number) => {
  let best = 0;
  let bestDot = -2;
  for (let i = 0; i < STAR_GROWTH_SAMPLE_COUNT; i += 1) {
    const di = i * 3;
    const d =
      nx * STAR_GROWTH_DIRS[di] + ny * STAR_GROWTH_DIRS[di + 1] + nz * STAR_GROWTH_DIRS[di + 2];
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
};

/** Points のデフォルト四角を消すためのソフト円テクスチャ（共有） */
let sharedPointCircleMap: THREE.CanvasTexture | null = null;
const getPointCircleMap = () => {
  if (sharedPointCircleMap) {
    return sharedPointCircleMap;
  }
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.Texture();
    fallback.needsUpdate = true;
    sharedPointCircleMap = fallback as THREE.CanvasTexture;
    return sharedPointCircleMap;
  }
  // AdditiveBlending は alpha を無視して RGB を足すため、縁は黒へ落とす（透明白だと四角が残る）
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgb(255,255,255)");
  gradient.addColorStop(0.32, "rgb(255,255,255)");
  gradient.addColorStop(0.68, "rgb(90,90,90)");
  gradient.addColorStop(1, "rgb(0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sharedPointCircleMap = new THREE.CanvasTexture(canvas);
  sharedPointCircleMap.colorSpace = THREE.NoColorSpace;
  sharedPointCircleMap.needsUpdate = true;
  return sharedPointCircleMap;
};

type CloudShapeStyle = "sky" | "mist";

/**
 * Codrops Procedural Clouds の外形テクスチャ（中央の柔らかい白シルエット、外周は黒）。
 * @see https://github.com/dghez/THREEJS_Procedural-clouds
 */
let sharedCloudShapeMap: THREE.Texture | null = null;
const getCloudShapeMap = () => {
  if (sharedCloudShapeMap) {
    return sharedCloudShapeMap;
  }
  const tex = new THREE.TextureLoader().load(cloudShapeUrl);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  sharedCloudShapeMap = tex;
  return sharedCloudShapeMap;
};

/**
 * Codrops の雲ノイズ（タイル可能なグレーノイズ。外形を揺らす用）。
 */
let sharedCloudNoiseMap: THREE.Texture | null = null;
const getCloudNoiseMap = () => {
  if (sharedCloudNoiseMap) {
    return sharedCloudNoiseMap;
  }
  const tex = new THREE.TextureLoader().load(cloudNoiseUrl);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  sharedCloudNoiseMap = tex;
  return sharedCloudNoiseMap;
};

/** Codrops 風のビルボード雲頂点（Sprite 相当） */
const proceduralCloudVertexShader = /* glsl */ `
  uniform float rotation;
  uniform vec2 center;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 scale;
    scale.x = length(vec3(modelMatrix[0].x, modelMatrix[0].y, modelMatrix[0].z));
    scale.y = length(vec3(modelMatrix[1].x, modelMatrix[1].y, modelMatrix[1].z));
    vec2 alignedPosition = (position.xy - (center - vec2(0.5))) * scale;
    vec2 rotatedPosition;
    rotatedPosition.x = cos(rotation) * alignedPosition.x - sin(rotation) * alignedPosition.y;
    rotatedPosition.y = sin(rotation) * alignedPosition.x + cos(rotation) * alignedPosition.y;
    mvPosition.xy += rotatedPosition;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

/**
 * Codrops cloud.frag 相当。
 * 外形画像（角まで黒）× ノイズ levels でアルファを作るため、クワッドの辺が出にくい。
 */
const proceduralCloudFragmentShader = /* glsl */ `
  uniform sampler2D uTxtShape;
  uniform sampler2D uTxtCloudNoise;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uFac1;
  uniform float uFac2;
  uniform float uTimeFactor1;
  uniform float uTimeFactor2;
  uniform float uDisplStrenght1;
  uniform float uDisplStrenght2;
  varying vec2 vUv;

  vec4 gammaCorrect(vec4 color, float gamma) {
    return pow(color, vec4(1.0 / gamma));
  }
  vec4 levelRange(vec4 color, float minInput, float maxInput) {
    return min(max(color - vec4(minInput), vec4(0.0)) / (vec4(maxInput) - vec4(minInput)), vec4(1.0));
  }
  vec4 levels(vec4 color, float minInput, float gamma, float maxInput) {
    return gammaCorrect(levelRange(color, minInput, maxInput), gamma);
  }

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 newUv = vUv;

    vec4 txtNoise1 = texture2D(uTxtCloudNoise, vec2(vUv.x + uTime * 0.0001, vUv.y - uTime * 0.00014));
    vec4 txtNoise2 = texture2D(uTxtCloudNoise, vec2(vUv.x - uTime * 0.00002, vUv.y + uTime * 0.000017 + 0.2));

    float noiseBig = fbm3(vec3(vUv * uFac1, uTime * uTimeFactor1)) + 0.5;
    newUv += noiseBig * uDisplStrenght1;

    float noiseSmall = noise3(vec3(newUv * uFac2, uTime * uTimeFactor2)) * 2.0 - 1.0;
    newUv += noiseSmall * uDisplStrenght2;

    vec4 txtShape = texture2D(uTxtShape, newUv);
    float alpha = levels((txtNoise1 + txtNoise2) * 0.6, 0.2, 0.4, 0.7).r;
    alpha *= txtShape.r;
    alpha *= uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

const createProceduralCloudMaterial = (seed: number, style: CloudShapeStyle = "sky") => {
  const shape = getCloudShapeMap();
  const noise = getCloudNoiseMap();
  const jitter = (seed * 17.13) % 1;
  const misty = style === "mist";
  return new THREE.ShaderMaterial({
    uniforms: {
      rotation: { value: 0 },
      center: { value: new THREE.Vector2(0.5, 0.5) },
      uTime: { value: seed * 120 },
      uTxtShape: { value: shape },
      uTxtCloudNoise: { value: noise },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(misty ? 0xe4eaf0 : 0xd8dee6) },
      // Codrops デモ寄りの既定値＋個体差
      uFac1: { value: 15 + jitter * 6 },
      uFac2: { value: 2.2 + jitter * 1.2 },
      uTimeFactor1: { value: 0.0015 + jitter * 0.001 },
      uTimeFactor2: { value: 0.001 + jitter * 0.001 },
      uDisplStrenght1: { value: 0.035 + jitter * 0.02 },
      uDisplStrenght2: { value: 0.06 + jitter * 0.04 },
    },
    vertexShader: proceduralCloudVertexShader,
    fragmentShader: proceduralCloudFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
};

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
  uniform float uCloudCover;
  uniform float uFogHaze;
  uniform float uLightningFlash;
  uniform vec3 uSunDir;
  uniform float uShaft;
  uniform float uSunset;
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

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y * 0.5 + 0.5;
    float cloud = clamp(uCloudCover, 0.0, 1.0);
    float fogH = clamp(uFogHaze, 0.0, 1.0);
    float flash = clamp(uLightningFlash, 0.0, 1.0);

    if (uAbyss > 0.5) {
      float vGrad = pow(h, 0.55);
      float sunset = clamp(uSunset, 0.0, 1.0);
      // 青みがかった海中の水塊。夕方は海水そのものに夕日の赤みを混ぜる
      vec3 waterDeep = mix(uBottom, vec3(0.02, 0.09, 0.18), 0.4);
      vec3 waterLit = mix(uTop, vec3(0.2, 0.52, 0.82), 0.5);
      if (sunset > 0.001) {
        vec3 sunsetDeep = vec3(0.18, 0.055, 0.065);
        vec3 sunsetLit = vec3(0.58, 0.25, 0.15);
        waterDeep = mix(waterDeep, sunsetDeep, sunset * 0.62);
        waterLit = mix(waterLit, sunsetLit, sunset * 0.52);
      }
      vec3 col = mix(waterDeep, waterLit, smoothstep(0.02, 0.98, vGrad));

      float horizonView = 1.0 - abs(dir.y);
      float atmosHaze = horizonView * horizonView * (0.55 + noise(dir * 1.8 + vec3(uTime * 0.01)) * 0.45);
      col = mix(col, uHalo, atmosHaze * mix(0.3, 0.18, sunset));

      float murk = noise(dir * 2.4 + vec3(uTime * 0.018, uTime * 0.012, uTime * 0.008));
      float midHaze = smoothstep(0.12, 0.68, h) * (murk * 0.45 + 0.55);
      col += uHalo * midHaze * 0.08;
      float shelfA = smoothstep(0.18, 0.32, h) * (1.0 - smoothstep(0.32, 0.48, h));
      float shelfB = smoothstep(0.48, 0.62, h) * (1.0 - smoothstep(0.62, 0.78, h));
      col += uHalo * (shelfA * 0.035 + shelfB * 0.045);
      float starMist = smoothstep(0.5, 0.99, h);
      float mistNoise = noise(dir * 5.0 + vec3(0.0, uTime * 0.03, 0.0));
      col += uTop * starMist * (mistNoise * 0.35 + 0.25) * 0.24;
      float abyssBands = sin(dir.x * 9.0 + dir.z * 7.0 + uTime * 0.06) * 0.028;
      col *= 1.0 + abyssBands * smoothstep(0.08, 0.7, h);

      // 夕日: 海水塊に控えめな赤〜琥珀を乗せる
      if (sunset > 0.001) {
        vec3 sunsetSea = vec3(0.72, 0.29, 0.14);
        float seaBand =
          smoothstep(-0.4, 0.2, dir.y) * (1.0 - smoothstep(0.5, 0.95, dir.y));
        float seaBody = 0.42 + 0.58 * seaBand;
        col = mix(col, mix(col, sunsetSea, 0.7), sunset * seaBody * 0.65);
        float upperSea = smoothstep(0.0, 0.5, dir.y) * (1.0 - smoothstep(0.65, 0.98, dir.y));
        col += sunsetSea * upperSea * sunset * 0.22;
      }

      // 海中へ差し込む光の柱（青〜銀青のまま）
      float shaft = clamp(uShaft, 0.0, 1.0);
      if (shaft > 0.001) {
        vec3 sunDir = normalize(uSunDir);
        float towardSun = max(0.0, dot(dir, sunDir));
        float shaftCore = pow(towardSun, 11.0);
        float shaftWide = pow(towardSun, 2.5);
        float caustic =
          0.55 +
          0.45 * sin(dir.x * 26.0 + dir.z * 18.0 - uTime * 0.42 + towardSun * 6.0);
        float rays = shaftCore * 0.8 + shaftWide * caustic * 0.3;
        float column = exp(-pow(1.0 - towardSun, 2.0) * 3.4) * shaftWide;
        rays = max(rays, column * 0.7);
        float topL = dot(uTop, vec3(0.299, 0.587, 0.114));
        float nightAmt = 1.0 - smoothstep(0.1, 0.28, topL);
        vec3 dayShaft = vec3(0.42, 0.8, 1.0);
        vec3 moonShaft = vec3(0.78, 0.88, 1.0);
        vec3 shaftCol = mix(dayShaft, moonShaft, nightAmt);
        col += shaftCol * rays * shaft * mix(1.35, 1.85, nightAmt);
        col *= mix(0.86, 1.0, smoothstep(-0.15, 0.55, dir.y) * (0.55 + shaft * 0.45));
      }

      col = mix(col, mix(uBottom, uHalo, 0.25), cloud * horizonView * 0.12);
      col = mix(col, uHalo, fogH * horizonView * horizonView * 0.15);

      vec3 behind = normalize(uCameraPos);
      float halo = smoothstep(0.5, 0.99, dot(dir, behind));
      float haloStrength = uHaloStrength * 1.08 * (1.0 + uAudio * 0.06);
      col = mix(col, uHalo, halo * halo * haloStrength * (1.0 - sunset * 0.35));
      col = mix(col, vec3(0.86, 0.91, 1.0), flash * 0.85);
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

    // 空の下地だけ薄く落とす（雲・霧の実体はプロシージャル雲スプライト側）
    {
      float elev = dir.y;
      float band = smoothstep(0.0, 0.18, elev) * (1.0 - smoothstep(0.35, 0.85, elev));
      vec3 overcast = mix(uBottom, vec3(0.58, 0.62, 0.66), 0.45);
      col = mix(col, overcast, band * cloud * 0.28);
      col = mix(col, overcast, cloud * cloud * 0.12 * smoothstep(0.1, 0.9, elev));
    }

    // 霧の下地: フレアにならないよう低コントラストの霞のみ
    {
      float rise = 1.0 - smoothstep(-0.15, 0.5, dir.y);
      vec3 mistCol = mix(uBottom, vec3(0.7, 0.74, 0.78), 0.5);
      col = mix(col, mistCol, rise * fogH * 0.35);
    }

    vec3 behind = normalize(uCameraPos);
    float halo = smoothstep(0.55, 0.985, dot(dir, behind));
    float audioPulse = uStudio > 0.5 ? 0.08 : 0.0;
    float haloStrength = uHaloStrength * (1.0 + uAudio * audioPulse);
    col = mix(col, uHalo, halo * halo * haloStrength);
    col = mix(col, vec3(0.88, 0.92, 1.0), flash * 0.9);

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
        uCloudCover: { value: 0 },
        uFogHaze: { value: 0 },
        uLightningFlash: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.15, 0.95, 0.2) },
        uShaft: { value: 0 },
        uSunset: { value: 0 },
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

  /** lumen 用: 右上マゼンタのハローを強める */
  setAccentGlow(enabled: boolean) {
    if (!enabled) return;
    const top = this.material.uniforms.uTop.value as THREE.Color;
    const bottom = this.material.uniforms.uBottom.value as THREE.Color;
    const halo = this.material.uniforms.uHalo.value as THREE.Color;
    top.setHSL(0.7, 0.42, 0.07);
    bottom.setHSL(0.78, 0.4, 0.028);
    halo.setHSL(0.92, 0.85, 0.28);
    this.baseHaloStrength = 1.55;
    this.material.uniforms.uHaloStrength.value = this.baseHaloStrength;
  }

  setFromBackground(base: THREE.Color, dark: boolean, studio = false, abyss = false) {
    base.getHSL(this._hsl);
    const { h, s, l } = this._hsl;
    const top = this.material.uniforms.uTop.value as THREE.Color;
    const bottom = this.material.uniforms.uBottom.value as THREE.Color;
    const halo = this.material.uniforms.uHalo.value as THREE.Color;
    if (abyss) {
      const abyssHue = THREE.MathUtils.lerp(h, 0.58, 0.8);
      top.setHSL(abyssHue, Math.min(1, s * 1.2 + 0.22), Math.min(0.36, l * 2.8 + 0.14));
      bottom.setHSL(abyssHue, Math.min(1, s * 1.05 + 0.1), Math.max(0.03, l * 0.35));
      halo.setHSL(abyssHue, Math.min(1, s * 0.95 + 0.2), Math.min(0.4, l * 3.0 + 0.14));
      this.baseHaloStrength = 1.15;
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

  /** 時間帯スカイ: 天頂・地平を直接指定（朝日・夕暮れのグラデーション用） */
  setSkyGradient(zenith: THREE.Color, horizon: THREE.Color, dark: boolean, hour?: number) {
    const top = this.material.uniforms.uTop.value as THREE.Color;
    const bottom = this.material.uniforms.uBottom.value as THREE.Color;
    const halo = this.material.uniforms.uHalo.value as THREE.Color;
    if (this.material.uniforms.uAbyss.value > 0.5) {
      // 海水塊の明るさ・夕日の赤みは時刻表で制御
      this.setAbyssSeaByHour(hour ?? 12);
      return;
    }
    if (this.material.uniforms.uSunset) {
      this.material.uniforms.uSunset.value = 0;
    }
    top.copy(zenith);
    bottom.copy(horizon);
    halo.copy(zenith).lerp(horizon, dark ? 0.45 : 0.55);
    this.baseHaloStrength = dark ? 0.55 : 0.82;
    this.material.uniforms.uHaloStrength.value = this.baseHaloStrength;
  }

  /**
   * 深海の海水塊を時刻で調整する（キーフレーム間を分単位で連続補間）。
   * 0–3 暗め / 4–11 赤みなし / 12–15 明るい青・赤みなし
   * 15–18 赤みが時間とともに出て 18 で消える / 18–24 徐々に暗く夜へ
   */
  /**
   * 天気ぶんの海水の色味。**色相はここまでハードコードだった**（0.58 固定）ので、
   * 「天気で作った環境が色に出る」が背景側で成立していなかった（2026-08-21 実測 幅 0.002）。
   * 明度は触らない（夜が潰れる）。
   */
  setAbyssSeaWeather(tint: { hue: number; sat: number } | null) {
    this.seaWeatherTint.hue = tint?.hue ?? 0;
    this.seaWeatherTint.sat = tint?.sat ?? 0;
  }

  setAbyssSeaByHour(hour: number) {
    if (!(this.material.uniforms.uAbyss?.value > 0.5)) {
      return;
    }
    const top = this.material.uniforms.uTop.value as THREE.Color;
    const bottom = this.material.uniforms.uBottom.value as THREE.Color;
    const halo = this.material.uniforms.uHalo.value as THREE.Color;
    const h = ((hour % 24) + 24) % 24;

    type SeaKey = {
      h: number;
      topL: number;
      bottomL: number;
      haloL: number;
      haloStr: number;
      sunset: number;
    };
    // 端点を揃えて境界で段差が出ないようにする
    const keys: SeaKey[] = [
      { h: 0, topL: 0.038, bottomL: 0.004, haloL: 0.22, haloStr: 0.7, sunset: 0 },
      { h: 3, topL: 0.04, bottomL: 0.004, haloL: 0.22, haloStr: 0.7, sunset: 0 },
      { h: 4, topL: 0.18, bottomL: 0.02, haloL: 0.38, haloStr: 1.15, sunset: 0 },
      { h: 11, topL: 0.46, bottomL: 0.03, haloL: 0.58, haloStr: 1.5, sunset: 0 },
      { h: 12, topL: 0.52, bottomL: 0.032, haloL: 0.64, haloStr: 1.55, sunset: 0 },
      { h: 15, topL: 0.52, bottomL: 0.032, haloL: 0.64, haloStr: 1.55, sunset: 0 },
      // 15→16:45 赤みピーク（さっき付いていた強さ）、18:00 で 0
      { h: 16.75, topL: 0.46, bottomL: 0.026, haloL: 0.55, haloStr: 1.4, sunset: 0.72 },
      { h: 18, topL: 0.3, bottomL: 0.016, haloL: 0.4, haloStr: 1.15, sunset: 0 },
      { h: 24, topL: 0.038, bottomL: 0.004, haloL: 0.22, haloStr: 0.7, sunset: 0 },
    ];

    let a = keys[0];
    let b = keys[1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (h >= keys[i].h && h <= keys[i + 1].h) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const span = Math.max(1e-6, b.h - a.h);
    // 分単位で線形に補間（キー境界で値は連続）
    const t = THREE.MathUtils.clamp((h - a.h) / span, 0, 1);
    const lerp = THREE.MathUtils.lerp;
    const topL = lerp(a.topL, b.topL, t);
    const bottomL = lerp(a.bottomL, b.bottomL, t);
    const haloL = lerp(a.haloL, b.haloL, t);
    const haloStrength = lerp(a.haloStr, b.haloStr, t);
    const sunset = lerp(a.sunset, b.sunset, t);

    // 天気ぶんの色味（`abyssSeaTintFromWeather`）。色相と彩度だけ動かす。
    const wrap = (v: number) => ((v % 1) + 1) % 1;
    const clamp01v = (v: number) => Math.min(1, Math.max(0, v));
    const wxH = this.seaWeatherTint.hue;
    const wxS = this.seaWeatherTint.sat;
    top.setHSL(wrap(0.58 + wxH), clamp01v(0.52 + wxS), topL);
    bottom.setHSL(wrap(0.62 + wxH * 0.85), clamp01v(0.38 + wxS * 0.8), bottomL);
    halo.setHSL(wrap(0.57 + wxH * 1.1), clamp01v(0.44 + wxS), haloL);
    this.baseHaloStrength = haloStrength;
    this.material.uniforms.uHaloStrength.value = this.baseHaloStrength;
    if (this.material.uniforms.uSunset) {
      this.material.uniforms.uSunset.value = sunset;
    }
  }

  setAbyssShaft(sunDir: THREE.Vector3, strength: number) {
    if (!this.material.uniforms.uSunDir || !this.material.uniforms.uShaft) {
      return;
    }
    (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
    this.material.uniforms.uShaft.value = THREE.MathUtils.clamp(strength, 0, 1);
  }

  update(time: number, audio: number, camera?: THREE.Vector3) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAudio.value = audio;
    if (camera) {
      (this.material.uniforms.uCameraPos.value as THREE.Vector3).copy(camera);
    }
  }

  private readonly seaWeatherTint = { hue: 0, sat: 0 };

  setWeatherAtmosphere(cloudCover: number, fogHaze: number, lightningFlash: number) {
    if (!this.material.uniforms.uCloudCover) {
      return;
    }
    this.material.uniforms.uCloudCover.value = cloudCover;
    this.material.uniforms.uFogHaze.value = fogHaze;
    this.material.uniforms.uLightningFlash.value = lightningFlash;
  }

  applyParallax(camera: THREE.Vector3, amount: number) {
    this.mesh.position.set(camera.x * amount, camera.y * amount * 0.85, camera.z * amount);
  }
}

class StarField {
  readonly points: THREE.Points;
  readonly trailPoints: THREE.Points;
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
  private readonly trailGeometry: THREE.BufferGeometry;
  private readonly trailMaterial: THREE.PointsMaterial;
  private readonly trailPositions: Float32Array;
  private readonly trailColors: Float32Array;
  private readonly trailSteps: number;
  private readonly parallax: number;
  private readonly parallaxAmount: number;
  private readonly organicDrift: boolean;
  private readonly baseOpacity: number;
  /** 近 > 中 > 遠の常時ドリフト強さ */
  private readonly idleMotion: number;
  private readonly avoidOffsets: Float32Array;
  /** 共有成長フィールド上の最近傍サンプル index */
  private readonly fieldIndex: Uint8Array | null;
  private readonly _flowOut: GrowthVec3 = { x: 0, y: 0, z: 0 };
  private readonly _world = new THREE.Vector3();
  private readonly _ndc = new THREE.Vector3();
  private readonly _camRight = new THREE.Vector3();
  private readonly _camUp = new THREE.Vector3();
  /** 星の有機ドリフト用時計（再生中も停止中と同じく進む） */
  private motionClock = 0;

  constructor(options?: {
    count?: number;
    minRadius?: number;
    maxRadius?: number;
    size?: number;
    baseOpacity?: number;
    parallax?: number;
    parallaxAmount?: number;
    coolBias?: boolean;
    /** 成長アルゴリズム同期のふよふよ漂い（共有フィールド経由で軽量） */
    organicDrift?: boolean;
    /** 常時ドリフトの相対強さ（近=1 / 中≈0.55 / 遠≈0.28） */
    idleMotion?: number;
    /** 軌跡のゴースト段数 */
    trailSteps?: number;
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
    this.idleMotion = options?.idleMotion ?? 1;
    this.trailSteps = Math.max(1, options?.trailSteps ?? 2);
    this.baseOpacity = baseOpacity;
    this.anchorPositions = this.organicDrift ? new Float32Array(count * 3) : null;
    this.particleSeed = this.organicDrift ? new Float32Array(count) : null;
    this.fieldIndex = this.organicDrift ? new Uint8Array(count) : null;

    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.baseColors = new Float32Array(count * 3);
    this.twinklePhase = new Float32Array(count);
    this.twinkleRate = new Float32Array(count);
    this.driftDir = new Float32Array(count * 3);
    this.avoidOffsets = new Float32Array(count * 3);
    this.trailPositions = new Float32Array(count * this.trailSteps * 3);
    this.trailColors = new Float32Array(count * this.trailSteps * 3);

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
      if (this.fieldIndex) {
        this.fieldIndex[i] = nearestStarGrowthSample(nx, ny, nz);
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
        ? 0.7 + (1 - bright) * 1.15
        : 0.18 + (1 - bright) * 0.95;

      this.baseColors[idx] = r * intensity;
      this.baseColors[idx + 1] = g * intensity;
      this.baseColors[idx + 2] = b * intensity;
      this.colors[idx] = this.baseColors[idx];
      this.colors[idx + 1] = this.baseColors[idx + 1];
      this.colors[idx + 2] = this.baseColors[idx + 2];

      this.twinklePhase[i] = Math.random() * Math.PI * 2;
      this.twinkleRate[i] = this.organicDrift ? 0.12 + Math.random() * 0.38 : 0.25 + Math.random() * 0.9;

      for (let step = 0; step < this.trailSteps; step += 1) {
        const tIdx = (i * this.trailSteps + step) * 3;
        this.trailPositions[tIdx] = this.positions[idx];
        this.trailPositions[tIdx + 1] = this.positions[idx + 1];
        this.trailPositions[tIdx + 2] = this.positions[idx + 2];
        const fade = 0.42 - step * 0.14;
        this.trailColors[tIdx] = this.colors[idx] * fade;
        this.trailColors[tIdx + 1] = this.colors[idx + 1] * fade;
        this.trailColors[tIdx + 2] = this.colors[idx + 2] * fade;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    // 円マップ（縁は黒）— 近い星が WebGL のデフォルト四角に見えないようにする
    // alphaTest は付けない（遠い薄い点が消える）/ toneMapped:false で ACES 潰れを防ぐ
    this.material = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: getPointCircleMap(),
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setAttribute("color", new THREE.BufferAttribute(this.trailColors, 3));
    this.trailMaterial = new THREE.PointsMaterial({
      size: pointSize * 0.78,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: Math.min(0.72, baseOpacity * 0.48),
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: getPointCircleMap(),
      toneMapped: false,
    });
    this.trailPoints = new THREE.Points(this.trailGeometry, this.trailMaterial);
    this.trailPoints.frustumCulled = false;
    this.trailPoints.renderOrder = -11;
  }

  /** 遅延ゴーストで移動軌跡を残す */
  private updateTrails(deltaTime: number, motionEnabled = true) {
    const count = this.twinklePhase.length;
    // 停止中は軌跡を素早く本体へ収束させる
    const followRate = motionEnabled ? 2.4 + this.idleMotion * 1.1 : 14;
    const follow = 1 - Math.exp(-deltaTime * followRate);
    const trailOpacity =
      this.material.opacity * (0.28 + this.idleMotion * 0.12);

    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      let srcX = this.positions[idx];
      let srcY = this.positions[idx + 1];
      let srcZ = this.positions[idx + 2];
      const cr = this.colors[idx];
      const cg = this.colors[idx + 1];
      const cb = this.colors[idx + 2];

      for (let step = 0; step < this.trailSteps; step += 1) {
        const tIdx = (i * this.trailSteps + step) * 3;
        this.trailPositions[tIdx] += (srcX - this.trailPositions[tIdx]) * follow;
        this.trailPositions[tIdx + 1] += (srcY - this.trailPositions[tIdx + 1]) * follow;
        this.trailPositions[tIdx + 2] += (srcZ - this.trailPositions[tIdx + 2]) * follow;
        srcX = this.trailPositions[tIdx];
        srcY = this.trailPositions[tIdx + 1];
        srcZ = this.trailPositions[tIdx + 2];

        const fade = 0.55 - step * (0.55 / (this.trailSteps + 0.5));
        this.trailColors[tIdx] = cr * fade;
        this.trailColors[tIdx + 1] = cg * fade;
        this.trailColors[tIdx + 2] = cb * fade;
      }
    }

    this.trailPoints.position.copy(this.points.position);
    this.trailMaterial.opacity = trailOpacity;
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.attributes.color.needsUpdate = true;
  }

  update(
    time: number,
    bands: AudioBands,
    deltaTime: number,
    camera?: THREE.Camera,
    pointerNDC?: THREE.Vector2 | null,
    motionEnabled = true,
    /** true=曲中の軽量共有フィールド / false=停止中の全星フル評価 */
    growthLite = false,
  ) {
    const cameraPosition = camera?.position;
    if (motionEnabled) {
      this.motionClock += deltaTime;
    }

    if (this.organicDrift && this.anchorPositions && this.particleSeed) {
      if (motionEnabled) {
        // Voronoi 等はフル評価だと星の数で落ちるため、常に共有フィールド経路へ
        if (growthLite || isHeavyGrowthPatternAlgorithm()) {
          this.updateOrganicDriftLite(this.motionClock, bands, deltaTime, cameraPosition);
        } else {
          this.updateOrganicDriftFull(this.motionClock, bands, deltaTime, cameraPosition);
        }
      } else if (cameraPosition) {
        const px = cameraPosition.x * (1 - this.parallax) * this.parallaxAmount;
        const py = cameraPosition.y * (1 - this.parallax) * this.parallaxAmount * 0.85;
        const pz = cameraPosition.z * (1 - this.parallax) * this.parallaxAmount;
        this.points.position.set(px, py, pz);
      }
      this.refreshPointerAvoid(deltaTime, camera, pointerNDC);
      this.geometry.attributes.position.needsUpdate = true;
      this.updateTrails(deltaTime, motionEnabled);
      return;
    }

    // 前フレームの回避オフセットを外してからシミュレート（蓄積防止）
    this.applyAvoidSign(-1);

    const audioTwinkle = 0.18 + bands.high * 0.35 + bands.brightness * 0.25;
    const calm = 1 - bands.sub * 0.25;

    const drift =
      motionEnabled ? deltaTime * 0.05 * (0.35 + audioTwinkle) * calm * this.parallax : 0;
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

    this.refreshPointerAvoid(deltaTime, camera, pointerNDC);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = 0.75 + bands.high * 0.12;
    this.updateTrails(deltaTime, motionEnabled);
  }

  /** カーソル付近の星を画面空間で少し押し退ける */
  private refreshPointerAvoid(
    deltaTime: number,
    camera?: THREE.Camera,
    pointerNDC?: THREE.Vector2 | null,
  ) {
    const count = this.twinklePhase.length;
    const ease = Math.min(1, deltaTime * 10);
    const settle = Math.min(1, deltaTime * 6);
    const radius = 0.22;
    const radiusSq = radius * radius;
    // 近いレイヤーほど強く避ける（parallax が大きいほど手前）
    const layerGain = 0.55 + this.parallax * 0.35;
    const screenPush = 0.014 * layerGain;
    const active = Boolean(camera && pointerNDC);

    if (active && camera && pointerNDC) {
      this._camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      this._camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const mx = pointerNDC.x;
      const my = pointerNDC.y;

      for (let i = 0; i < count; i += 1) {
        const idx = i * 3;
        this._world.set(this.positions[idx], this.positions[idx + 1], this.positions[idx + 2]);
        this.points.localToWorld(this._world);
        this._ndc.copy(this._world).project(camera);
        if (this._ndc.z < -1 || this._ndc.z > 1) {
          this.avoidOffsets[idx] += (0 - this.avoidOffsets[idx]) * settle;
          this.avoidOffsets[idx + 1] += (0 - this.avoidOffsets[idx + 1]) * settle;
          this.avoidOffsets[idx + 2] += (0 - this.avoidOffsets[idx + 2]) * settle;
          continue;
        }

        const dx = this._ndc.x - mx;
        const dy = this._ndc.y - my;
        const d2 = dx * dx + dy * dy;
        let tx = 0;
        let ty = 0;
        let tz = 0;
        if (d2 < radiusSq && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const falloff = (1 - d / radius) ** 2;
          const depth = this._world.distanceTo(camera.position);
          const push = falloff * screenPush * depth;
          const inv = 1 / d;
          tx = (this._camRight.x * dx + this._camUp.x * dy) * inv * push;
          ty = (this._camRight.y * dx + this._camUp.y * dy) * inv * push;
          tz = (this._camRight.z * dx + this._camUp.z * dy) * inv * push;
        }

        this.avoidOffsets[idx] += (tx - this.avoidOffsets[idx]) * ease;
        this.avoidOffsets[idx + 1] += (ty - this.avoidOffsets[idx + 1]) * ease;
        this.avoidOffsets[idx + 2] += (tz - this.avoidOffsets[idx + 2]) * ease;
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        const idx = i * 3;
        this.avoidOffsets[idx] += (0 - this.avoidOffsets[idx]) * settle;
        this.avoidOffsets[idx + 1] += (0 - this.avoidOffsets[idx + 1]) * settle;
        this.avoidOffsets[idx + 2] += (0 - this.avoidOffsets[idx + 2]) * settle;
      }
    }

    this.applyAvoidSign(1);
  }

  private applyAvoidSign(sign: number) {
    const count = this.twinklePhase.length;
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      this.positions[idx] += this.avoidOffsets[idx] * sign;
      this.positions[idx + 1] += this.avoidOffsets[idx + 1] * sign;
      this.positions[idx + 2] += this.avoidOffsets[idx + 2] * sign;
    }
  }

  /**
   * 曲停止中: 全星を成長アルゴリズムで直接評価（高品質・高負荷）
   */
  private updateOrganicDriftFull(
    time: number,
    bands: AudioBands,
    deltaTime: number,
    cameraPosition?: THREE.Vector3,
  ) {
    const anchors = this.anchorPositions!;
    const seeds = this.particleSeed!;
    const activity = bands.overall * 0.45 + bands.melody * 0.4 + bands.brightness * 0.2;
    const motion = this.idleMotion;
    const slow = time * 0.32;
    const fast = time * 0.58 + 13.7;
    const flowSaltBase = slow * 0.55;
    const radialScale = (0.55 + motion * 0.95) * (0.85 + activity * 0.55);
    const flowScale = (0.7 + motion * 1.15) * (0.9 + activity * 0.7);
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
      const deformSalt = seed + flowSaltBase;

      const wave =
        growthPattern(nx * 0.75, ny * 0.75, nz * 0.75, seed + slow) * 0.68 +
        growthPattern(nx * 1.35, ny * 1.35, nz * 1.35, seed + fast) * 0.22 +
        growthPattern(nx * 0.5, ny * 0.5, nz * 0.5, seed + slow * 0.47 + 8.2) * 0.1;
      const breathe = wave * 0.5 + 0.5;

      growthFlow(nx * 1.1, ny * 1.1, nz * 1.1, deformSalt + i * 0.003, this._flowOut);
      const dot = this._flowOut.x * nx + this._flowOut.y * ny + this._flowOut.z * nz;
      let fx = this._flowOut.x - nx * dot;
      let fy = this._flowOut.y - ny * dot;
      let fz = this._flowOut.z - nz * dot;
      const flowLen = Math.hypot(fx, fy, fz) || 1;
      fx /= flowLen;
      fy /= flowLen;
      fz /= flowLen;

      const radialAmp = growthModulateScalar(wave * radialScale, nx, ny, nz, deformSalt, "idle");
      const flowAmp = growthModulateScalar(
        flowScale * (0.55 + breathe * 0.65 + activity * 0.35),
        nx,
        ny,
        nz,
        deformSalt + 4.1,
        "flow",
      );
      const liveBoost = growthModulateScalar(
        0.2 + activity * 0.55,
        nx,
        ny,
        nz,
        deformSalt + 9.2,
        "live",
      );
      const flowVec = growthModulateVector3(
        fx * flowAmp * (1 + liveBoost),
        fy * flowAmp * (1 + liveBoost),
        fz * flowAmp * (1 + liveBoost),
        nx,
        ny,
        nz,
        deformSalt + 5.5,
        "flow",
      );

      growthFlow(nx * 1.35, ny * 1.35, nz * 1.35, deformSalt * 0.7 + bands.centroid * 4, this._flowOut);
      const dot2 = this._flowOut.x * nx + this._flowOut.y * ny + this._flowOut.z * nz;
      const sx = (this._flowOut.x - nx * dot2) * flowAmp * 0.45;
      const sy = (this._flowOut.y - ny * dot2) * flowAmp * 0.45;
      const sz = (this._flowOut.z - nz * dot2) * flowAmp * 0.45;

      let px = ax + nx * radialAmp + flowVec.x + sx;
      let py = ay + ny * radialAmp * 0.72 + flowVec.y + sy;
      let pz = az + nz * radialAmp + flowVec.z + sz;

      const cr = Math.hypot(px, py, pz) || 1;
      const radiusPull = (shellR - cr) * Math.min(1, deltaTime * 1.6);
      px += (px / cr) * radiusPull;
      py += (py / cr) * radiusPull;
      pz += (pz / cr) * radiusPull;

      this.positions[idx] = px;
      this.positions[idx + 1] = py;
      this.positions[idx + 2] = pz;

      const hueWave = growthPattern(nx, ny, nz, seed + 14.2 + slow * 0.22) * 0.5 + 0.5;
      const twinkle =
        0.76 +
        0.24 * Math.sin(time * this.twinkleRate[i] * 0.48 + phase) * (0.75 + activity * 0.5 + breathe * 0.25);
      const colorGain = (0.78 + breathe * 0.35 + liveBoost * 0.4) * twinkle;
      this.colors[idx] = Math.max(0.04, this.baseColors[idx] * colorGain * (0.9 + hueWave * 0.18));
      this.colors[idx + 1] = Math.max(0.04, this.baseColors[idx + 1] * colorGain * (0.88 + breathe * 0.2));
      this.colors[idx + 2] = Math.max(0.06, this.baseColors[idx + 2] * colorGain * (0.86 + hueWave * 0.22));
    }

    if (cameraPosition) {
      const px = cameraPosition.x * (1 - this.parallax) * this.parallaxAmount;
      const py = cameraPosition.y * (1 - this.parallax) * this.parallaxAmount * 0.85;
      const pz = cameraPosition.z * (1 - this.parallax) * this.parallaxAmount;
      this.points.position.set(px, py, pz);
    }

    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = this.baseOpacity * (0.95 + activity * 0.14 + bands.high * 0.08);
  }

  /**
   * 曲再生中: 共有成長フィールド参照（軽量・アルゴリズム同期）
   */
  private updateOrganicDriftLite(
    time: number,
    bands: AudioBands,
    deltaTime: number,
    cameraPosition?: THREE.Vector3,
  ) {
    refreshStarGrowthField(time);

    const anchors = this.anchorPositions!;
    const seeds = this.particleSeed!;
    const fieldIndex = this.fieldIndex!;
    const activity = bands.overall * 0.45 + bands.melody * 0.4 + bands.brightness * 0.2;
    const motion = this.idleMotion;
    const radialScale = (0.55 + motion * 0.95) * (0.85 + activity * 0.55);
    const flowScale = (0.7 + motion * 1.15) * (0.9 + activity * 0.7) * 0.36;
    const count = this.twinklePhase.length;
    // 遠方の大量レイヤーだけ間引き（フィールド自体はアルゴリズム同期）
    const stride = count > 4000 ? 2 : 1;
    const phase = stride > 1 ? Math.floor(time * 30) % stride : 0;

    for (let i = phase; i < count; i += stride) {
      const idx = i * 3;
      const ax = anchors[idx];
      const ay = anchors[idx + 1];
      const az = anchors[idx + 2];
      const shellR = Math.hypot(ax, ay, az) || 1;
      const nx = ax / shellR;
      const ny = ay / shellR;
      const nz = az / shellR;
      const seed = seeds[i];
      const phaseTw = this.twinklePhase[i];
      const sample = fieldIndex[i];
      const fi = sample * 3;

      // フィールド値 + 星ごとの微小位相で個体差
      const micro = Math.sin(seed * 0.37 + time * 0.21) * 0.12;
      const wave =
        starGrowthPatternSlow[sample] * 0.72 + starGrowthPatternFast[sample] * 0.28 + micro;
      const breathe = wave * 0.5 + 0.5;

      let fx = starGrowthFlow[fi];
      let fy = starGrowthFlow[fi + 1];
      let fz = starGrowthFlow[fi + 2];
      // 星固有の接線へ再投影（サンプル方向と星方向のズレを吸収）
      const fDot = fx * nx + fy * ny + fz * nz;
      fx -= nx * fDot;
      fy -= ny * fDot;
      fz -= nz * fDot;
      const flowLen = Math.hypot(fx, fy, fz) || 1;
      fx /= flowLen;
      fy /= flowLen;
      fz /= flowLen;

      const radialAmp = wave * radialScale;
      const flowAmp = flowScale * (0.55 + breathe * 0.65 + activity * 0.35);
      const liveBoost = 0.2 + activity * 0.55;

      let px = ax + nx * radialAmp + fx * flowAmp * (1 + liveBoost * 0.35);
      let py = ay + ny * radialAmp * 0.72 + fy * flowAmp * (1 + liveBoost * 0.35);
      let pz = az + nz * radialAmp + fz * flowAmp * (1 + liveBoost * 0.35);

      const cr = Math.hypot(px, py, pz) || 1;
      const radiusPull = (shellR - cr) * Math.min(1, deltaTime * 1.6 * stride);
      px += (px / cr) * radiusPull;
      py += (py / cr) * radiusPull;
      pz += (pz / cr) * radiusPull;

      this.positions[idx] = px;
      this.positions[idx + 1] = py;
      this.positions[idx + 2] = pz;

      const hueWave = starGrowthPatternSlow[sample] * 0.5 + 0.5;
      const twinkle =
        0.76 +
        0.24 *
          Math.sin(time * this.twinkleRate[i] * 0.48 + phaseTw) *
          (0.75 + activity * 0.5 + breathe * 0.25);
      const colorGain = (0.78 + breathe * 0.35 + liveBoost * 0.25) * twinkle;
      this.colors[idx] = Math.max(0.04, this.baseColors[idx] * colorGain * (0.9 + hueWave * 0.18));
      this.colors[idx + 1] = Math.max(0.04, this.baseColors[idx + 1] * colorGain * (0.88 + breathe * 0.2));
      this.colors[idx + 2] = Math.max(0.06, this.baseColors[idx + 2] * colorGain * (0.86 + hueWave * 0.22));
    }

    if (cameraPosition) {
      const px = cameraPosition.x * (1 - this.parallax) * this.parallaxAmount;
      const py = cameraPosition.y * (1 - this.parallax) * this.parallaxAmount * 0.85;
      const pz = cameraPosition.z * (1 - this.parallax) * this.parallaxAmount;
      this.points.position.set(px, py, pz);
    }

    this.geometry.attributes.color.needsUpdate = true;
    this.material.opacity = this.baseOpacity * (0.95 + activity * 0.14 + bands.high * 0.08);
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
      map: getPointCircleMap(),
      toneMapped: false,
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
      map: getPointCircleMap(),
      toneMapped: false,
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

/** 実天気の雨・雪（雨は上から落ちる筋、雪は粒） */
class WeatherPrecipField {
  readonly object: THREE.Object3D;
  readonly rainLines: THREE.LineSegments;
  readonly snowPoints: THREE.Points;
  private readonly rainPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly rainLengths: Float32Array;
  private readonly snowPositions: Float32Array;
  private readonly snowSpeeds: Float32Array;
  private readonly snowPhase: Float32Array;
  private readonly rainGeometry: THREE.BufferGeometry;
  private readonly snowGeometry: THREE.BufferGeometry;
  private readonly rainMaterial: THREE.LineBasicMaterial;
  private readonly snowMaterial: THREE.PointsMaterial;
  private intensity = 0;
  private windX = 0;
  private windZ = 0;
  private snowMode = false;
  private readonly rainCount: number;
  private readonly snowCount: number;
  private time = 0;

  constructor(rainCount = 1600, snowCount = 900) {
    this.rainCount = rainCount;
    this.snowCount = snowCount;
    this.rainPositions = new Float32Array(rainCount * 6);
    this.rainSpeeds = new Float32Array(rainCount);
    this.rainLengths = new Float32Array(rainCount);
    this.snowPositions = new Float32Array(snowCount * 3);
    this.snowSpeeds = new Float32Array(snowCount);
    this.snowPhase = new Float32Array(snowCount);

    for (let i = 0; i < rainCount; i += 1) this.resetRain(i, true);
    for (let i = 0; i < snowCount; i += 1) this.resetSnow(i, true);

    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute("position", new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: 0xc4d0dc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.rainLines = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = -3;

    this.snowGeometry = new THREE.BufferGeometry();
    this.snowGeometry.setAttribute("position", new THREE.BufferAttribute(this.snowPositions, 3));
    this.snowMaterial = new THREE.PointsMaterial({
      size: 0.07,
      sizeAttenuation: true,
      color: 0xe4ebf4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: getPointCircleMap(),
      toneMapped: false,
    });
    this.snowPoints = new THREE.Points(this.snowGeometry, this.snowMaterial);
    this.snowPoints.frustumCulled = false;
    this.snowPoints.renderOrder = -3;

    this.object = new THREE.Group();
    this.object.add(this.rainLines, this.snowPoints);
    this.object.visible = false;
  }

  /** 常に上空から再出現（横からは降らせない） */
  private resetRain(index: number, scatterY: boolean) {
    const head = index * 6;
    const x = (Math.random() - 0.5) * 22;
    const y = scatterY ? 4 + Math.random() * 12 : 12 + Math.random() * 6;
    const z = (Math.random() - 0.5) * 22;
    this.rainPositions[head] = x;
    this.rainPositions[head + 1] = y;
    this.rainPositions[head + 2] = z;
    this.rainPositions[head + 3] = x;
    this.rainPositions[head + 4] = y;
    this.rainPositions[head + 5] = z;
    this.rainSpeeds[index] = 10 + Math.random() * 9;
    this.rainLengths[index] = 0.22 + Math.random() * 0.35;
  }

  private resetSnow(index: number, scatterY: boolean) {
    const idx = index * 3;
    this.snowPositions[idx] = (Math.random() - 0.5) * 22;
    this.snowPositions[idx + 1] = scatterY ? 3 + Math.random() * 12 : 11 + Math.random() * 6;
    this.snowPositions[idx + 2] = (Math.random() - 0.5) * 22;
    this.snowSpeeds[index] = 1.2 + Math.random() * 2.4;
    this.snowPhase[index] = Math.random() * Math.PI * 2;
  }

  setWeather(intensity: number, windX: number, windZ: number, snow: boolean) {
    this.intensity = Math.min(1, Math.max(0, intensity));
    this.windX = windX;
    this.windZ = windZ;
    this.snowMode = snow;
    this.object.visible = this.intensity > 0.02;
    this.rainLines.visible = !snow && this.intensity > 0.02;
    this.snowPoints.visible = snow && this.intensity > 0.02;
    this.rainMaterial.color.setHex(0xc4d0dc);
  }

  update(deltaTime: number) {
    this.time += deltaTime;
    if (this.intensity < 0.02) {
      this.rainMaterial.opacity = 0;
      this.snowMaterial.opacity = 0;
      return;
    }

    const windMag = Math.hypot(this.windX, this.windZ);
    let wx = this.windX;
    let wz = this.windZ;
    if (windMag > 0.001) {
      wx /= windMag;
      wz /= windMag;
    } else {
      wx = 0;
      wz = 0;
    }

    if (this.snowMode) {
      const active = 0.2 + this.intensity * 0.8;
      for (let i = 0; i < this.snowCount; i += 1) {
        if (i / this.snowCount > active) {
          this.snowPositions[i * 3 + 1] = -99;
          continue;
        }
        const idx = i * 3;
        const flutter = Math.sin(this.time * 1.6 + this.snowPhase[i]) * 0.45;
        const drift = Math.cos(this.time * 1.1 + this.snowPhase[i] * 1.3) * 0.35;
        this.snowPositions[idx] += (wx * windMag * 1.6 + flutter) * deltaTime;
        this.snowPositions[idx + 1] -= this.snowSpeeds[i] * deltaTime * (0.55 + this.intensity * 0.5);
        this.snowPositions[idx + 2] += (wz * windMag * 1.6 + drift) * deltaTime;
        if (this.snowPositions[idx + 1] < -3.2) this.resetSnow(i, false);
      }
      this.snowGeometry.attributes.position.needsUpdate = true;
      this.snowMaterial.opacity = 0.22 + this.intensity * 0.62;
      this.snowMaterial.size = 0.055 + this.intensity * 0.04;
      this.rainMaterial.opacity = 0;
      return;
    }

    // 雨はほぼ鉛直落下。風はわずかな傾きだけ（横から降らない）
    const active = 0.22 + this.intensity * 0.78;
    const fallBoost = 0.95 + this.intensity * 1.05;
    const windLean = Math.min(2.2, windMag * 2.4);
    for (let i = 0; i < this.rainCount; i += 1) {
      if (i / this.rainCount > active) {
        const head = i * 6;
        this.rainPositions[head + 1] = -99;
        this.rainPositions[head + 4] = -99;
        continue;
      }
      const head = i * 6;
      const speed = this.rainSpeeds[i] * fallBoost;
      const vx = wx * windLean;
      const vy = -speed;
      const vz = wz * windLean;
      this.rainPositions[head] += vx * deltaTime;
      this.rainPositions[head + 1] += vy * deltaTime;
      this.rainPositions[head + 2] += vz * deltaTime;

      const len = this.rainLengths[i] * (0.85 + this.intensity * 0.9);
      const inv = 1 / Math.max(0.001, Math.hypot(vx, vy, vz));
      this.rainPositions[head + 3] = this.rainPositions[head] - vx * inv * len;
      this.rainPositions[head + 4] = this.rainPositions[head + 1] - vy * inv * len;
      this.rainPositions[head + 5] = this.rainPositions[head + 2] - vz * inv * len;

      // 地面に落ちたら上空へ戻す（横方向はみ出しでも上空リスポーン）
      if (this.rainPositions[head + 1] < -3.5) {
        this.resetRain(i, false);
      } else if (
        Math.abs(this.rainPositions[head]) > 14 ||
        Math.abs(this.rainPositions[head + 2]) > 14
      ) {
        this.resetRain(i, false);
      }
    }
    this.rainGeometry.attributes.position.needsUpdate = true;
    // 豪雨でも本数・長さで強さを出し、1本の不透明度は薄く保つ
    this.rainMaterial.opacity = 0.14 + this.intensity * 0.1;
    this.snowMaterial.opacity = 0;
  }
}

type ProceduralCloudLayerMode = "wind" | "mist" | "sky";

type ProceduralCloudPuff = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  speed: number;
  phase: number;
  baseW: number;
  baseH: number;
  homeY: number;
};

/**
 * Codrops Procedural Clouds 系のビルボード雲レイヤー。
 * Points のフレアではなく、外形×ノイズの大きな半透明シートで表現する。
 */
class ProceduralCloudLayer {
  readonly group = new THREE.Group();
  private readonly puffs: ProceduralCloudPuff[] = [];
  private readonly mode: ProceduralCloudLayerMode;
  private intensity = 0;
  private windX = 0;
  private windZ = 0;
  private time = 0;
  private gust = 0;
  private readonly sharedGeometry: THREE.PlaneGeometry;

  constructor(mode: ProceduralCloudLayerMode, count: number) {
    this.mode = mode;
    this.sharedGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.group.renderOrder = mode === "sky" ? -5 : mode === "mist" ? -4 : -2;
    this.group.visible = false;
    this.group.frustumCulled = false;

    const shapeStyle: CloudShapeStyle = mode === "mist" ? "mist" : "sky";
    for (let i = 0; i < count; i += 1) {
      const material = createProceduralCloudMaterial(
        i + (mode === "sky" ? 40 : mode === "mist" ? 20 : 0),
        shapeStyle,
      );
      const mesh = new THREE.Mesh(this.sharedGeometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = this.group.renderOrder;
      const puff: ProceduralCloudPuff = {
        mesh,
        material,
        speed: 0.4 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        baseW: 1,
        baseH: 1,
        homeY: 0,
      };
      this.resetPuff(puff, true);
      this.puffs.push(puff);
      this.group.add(mesh);
    }
  }

  private resetPuff(puff: ProceduralCloudPuff, scatter: boolean) {
    const mesh = puff.mesh;
    if (this.mode === "mist") {
      // 丸い房を低く重ねて「帯」ではなく地面の霞にする
      mesh.position.set((Math.random() - 0.5) * 20, -1.35 + Math.random() * 2.4, (Math.random() - 0.5) * 20);
      const size = 3.2 + Math.random() * 3.4;
      const aspect = 0.92 + Math.random() * 0.45;
      puff.baseW = size * aspect;
      puff.baseH = size / aspect;
      puff.homeY = mesh.position.y;
    } else if (this.mode === "sky") {
      mesh.position.set((Math.random() - 0.5) * 30, 4.2 + Math.random() * 6.5, (Math.random() - 0.5) * 30);
      const size = 5.2 + Math.random() * 5.5;
      const aspect = 1.15 + Math.random() * 0.7;
      puff.baseW = size * aspect;
      puff.baseH = size / Math.max(1, aspect * 0.85);
      puff.homeY = mesh.position.y;
    } else {
      // wind: やや横長の薄い雲が流れる
      const y = scatter ? 0.4 + Math.random() * 6.2 : 0.8 + Math.random() * 5.5;
      mesh.position.set((Math.random() - 0.5) * 24, y, (Math.random() - 0.5) * 24);
      puff.baseW = 3.8 + Math.random() * 4.2;
      puff.baseH = 2.0 + Math.random() * 1.6;
      puff.homeY = y;
    }
    puff.speed = 0.35 + Math.random() * 0.85;
    puff.phase = Math.random() * Math.PI * 2;
    mesh.scale.set(puff.baseW, puff.baseH, 1);
    // 板を傾けない（辺が斜め線として見えるのを防ぐ）。形の変化はノイズ変位に任せる
    puff.material.uniforms.rotation.value = 0;
  }

  setWeather(intensity: number, windX = 0, windZ = 0) {
    this.intensity = Math.min(1, Math.max(0, intensity));
    this.windX = windX;
    this.windZ = windZ;
    const visibleThreshold = this.mode === "sky" ? 0.1 : 0.05;
    this.group.visible = this.intensity > visibleThreshold;

    const color =
      this.mode === "mist"
        ? new THREE.Color(0xe8eef4)
        : this.mode === "sky"
          ? new THREE.Color(this.intensity > 0.7 ? 0x8f9aa8 : 0xb8c2cd)
          : new THREE.Color(this.intensity > 0.55 ? 0xa7b4c2 : 0xc2cbd4);
    for (const puff of this.puffs) {
      puff.material.uniforms.uColor.value.copy(color);
    }
  }

  update(deltaTime: number) {
    this.time += deltaTime;
    const visibleThreshold = this.mode === "sky" ? 0.1 : 0.05;
    if (this.intensity < visibleThreshold) {
      for (const puff of this.puffs) {
        puff.material.uniforms.uOpacity.value = 0;
      }
      return;
    }

    this.gust +=
      (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.time * 0.5)) - this.gust) * Math.min(1, deltaTime * 1.1);

    let wx = this.windX;
    let wz = this.windZ;
    const mag = Math.hypot(wx, wz);
    if (mag < 0.001) {
      wx = this.mode === "wind" ? 1 : 0.25;
      wz = 0;
    } else {
      wx /= mag;
      wz /= mag;
    }

    const activeRatio =
      this.mode === "sky"
        ? 0.28 + this.intensity * 0.72
        : this.mode === "mist"
          ? 0.55 + this.intensity * 0.45
          : 0.25 + this.intensity * 0.75;

    // 霧は1枚を濃くせず、多数を薄く重ねてボリューム感を出す
    const baseOpacity =
      this.mode === "mist"
        ? 0.12 + this.intensity * 0.22
        : this.mode === "sky"
          ? 0.16 + this.intensity * 0.38
          : 0.12 + this.intensity * 0.28;

    const flow =
      this.mode === "wind"
        ? (0.9 + this.intensity * 3.4) * (0.7 + this.gust * 0.7)
        : this.mode === "mist"
          ? 0.12 + this.intensity * 0.2
          : 0.22 + this.intensity * 0.55;

    for (let i = 0; i < this.puffs.length; i += 1) {
      const puff = this.puffs[i];
      if (i / this.puffs.length > activeRatio) {
        puff.material.uniforms.uOpacity.value = 0;
        puff.mesh.visible = false;
        continue;
      }
      puff.mesh.visible = true;
      const mesh = puff.mesh;
      const wobble = Math.sin(this.time * 0.35 + puff.phase) * (this.mode === "mist" ? 0.12 : 0.22);
      const lift = Math.sin(this.time * 0.22 + puff.phase * 1.3) * (this.mode === "mist" ? 0.06 : 0.14);
      const move = puff.speed * flow * deltaTime;
      mesh.position.x += (wx + -wz * wobble) * move;
      mesh.position.z += (wz + wx * wobble) * move;
      mesh.position.y = puff.homeY + lift;

      const breathe = 1 + Math.sin(this.time * 0.2 + puff.phase) * (this.mode === "mist" ? 0.1 : 0.06);
      mesh.scale.set(puff.baseW * breathe, puff.baseH * breathe, 1);

      // Codrops デモ同様、時間はフレーム加算（秒ではないスケール）
      puff.material.uniforms.uTime.value += deltaTime * 60;
      puff.material.uniforms.uOpacity.value =
        baseOpacity * (0.8 + 0.2 * Math.sin(this.time * 0.25 + puff.phase));

      const limit = this.mode === "sky" ? 17 : 13;
      if (
        Math.abs(mesh.position.x) > limit ||
        Math.abs(mesh.position.z) > limit ||
        (this.mode === "wind" && (mesh.position.y < -1.5 || mesh.position.y > 9))
      ) {
        this.resetPuff(puff, false);
        if (this.mode === "wind") {
          mesh.position.x = -wx * (8 + Math.random() * 8) + (Math.random() - 0.5) * 5;
          mesh.position.z = -wz * (8 + Math.random() * 8) + (Math.random() - 0.5) * 5;
          puff.homeY = mesh.position.y;
        }
      }
    }
  }
}

/** 風: 流れる薄いプロシージャル雲 */
class WeatherWindField extends ProceduralCloudLayer {
  constructor() {
    super("wind", 12);
  }
}

/** 霧: 丸い房を低く重ねた霞 */
class WeatherMistField extends ProceduralCloudLayer {
  constructor() {
    super("mist", 24);
  }
}

/** 雲 / どんより: 中空のプロシージャル雲 */
class WeatherCloudField extends ProceduralCloudLayer {
  constructor() {
    super("sky", 16);
  }
}

/** 稲妻のジグザグボルト */
class WeatherLightningBolts {
  readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private life = 0;
  private readonly maxSegments = 18;
  private readonly maxBolts = 2;

  constructor() {
    // bolt * segments * 2 verts * 3
    this.positions = new Float32Array(this.maxBolts * this.maxSegments * 6);
    this.positions.fill(0);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({
      color: 0xe8f0ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -1;
    this.lines.visible = false;
  }

  /** フラッシュ開始時に呼び、空から地面へボルトを生成 */
  trigger(intensity: number) {
    if (intensity < 0.08) return;
    const boltCount = Math.random() < 0.35 ? 2 : 1;
    this.positions.fill(0);
    for (let b = 0; b < boltCount; b += 1) {
      const az = Math.random() * Math.PI * 2;
      const dist = 4 + Math.random() * 10;
      let x = Math.cos(az) * dist;
      let y = 11 + Math.random() * 4;
      let z = Math.sin(az) * dist;
      const targetX = x + (Math.random() - 0.5) * 3.5;
      const targetZ = z + (Math.random() - 0.5) * 3.5;
      const segs = 10 + Math.floor(Math.random() * 8);
      for (let s = 0; s < this.maxSegments; s += 1) {
        const base = (b * this.maxSegments + s) * 6;
        if (s >= segs) {
          this.positions[base + 1] = -99;
          this.positions[base + 4] = -99;
          continue;
        }
        const t = (s + 1) / segs;
        const nx = THREE.MathUtils.lerp(x, targetX, t) + (Math.random() - 0.5) * (0.35 + t * 0.9);
        const ny = THREE.MathUtils.lerp(y, -1.2, t) + (Math.random() - 0.5) * 0.25;
        const nz = THREE.MathUtils.lerp(z, targetZ, t) + (Math.random() - 0.5) * (0.35 + t * 0.9);
        this.positions[base] = x;
        this.positions[base + 1] = y;
        this.positions[base + 2] = z;
        this.positions[base + 3] = nx;
        this.positions[base + 4] = ny;
        this.positions[base + 5] = nz;
        x = nx;
        y = ny;
        z = nz;
        // 分岐
        if (s > 3 && Math.random() < 0.18 && s + 1 < segs) {
          // 短い分岐は次セグメントのジッターで表現
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.life = 0.12 + Math.random() * 0.1;
    this.lines.visible = true;
    this.material.opacity = 0.95;
  }

  update(deltaTime: number) {
    if (this.life <= 0) {
      this.material.opacity = 0;
      this.lines.visible = false;
      return;
    }
    this.life = Math.max(0, this.life - deltaTime);
    const fade = Math.min(1, this.life * 10);
    this.material.opacity = fade * (0.65 + Math.random() * 0.35);
    if (this.life <= 0) {
      this.lines.visible = false;
    }
  }
}

export type SceneWeatherState = {
  enabled: boolean;
  cloudCover: number;
  rainIntensity: number;
  windStrength: number;
  windX: number;
  windZ: number;
  snow: boolean;
  fogBoost: number;
  /** 0..1 霧の見え方（地上ミスト＋ドーム霞） */
  fogIntensity: number;
  /** 0..1 雷フラッシュの頻度・明るさ */
  lightningIntensity: number;
};

const DEFAULT_WEATHER_STATE: SceneWeatherState = {
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

export class SceneBackground {
  private readonly parallaxRoot = new THREE.Group();
  private readonly viewDelta = new THREE.Quaternion();
  private readonly dome: BackgroundDome;
  private readonly innerDome: BackgroundDome | null;
  private readonly starsNear: StarField;
  private readonly starsMid: StarField | null;
  private readonly starsFar: StarField;
  private readonly dust: DustMoteField | null;
  private readonly biolume: BiolumeMoteField | null;
  private readonly biolumeFar: BiolumeMoteField | null;
  private readonly weatherPrecip: WeatherPrecipField;
  private readonly weatherWind: WeatherWindField;
  private readonly weatherMist: WeatherMistField;
  private readonly weatherClouds: WeatherCloudField;
  private readonly weatherLightning: WeatherLightningBolts;
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
  private weather: SceneWeatherState = { ...DEFAULT_WEATHER_STATE };
  /** 次の稲妻までの待ち時間 */
  private lightningCooldown = 2.5;
  /** フラッシュ残時間 */
  private lightningBurst = 0;
  /** 連撃の残り回数 */
  private lightningFollowUps = 0;
  /** 現在のフラッシュ量 0..1（getLightningFlash 用） */
  private lightningFlash = 0;

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

    const noStars = this.profile?.noStars === true;

    this.starsNear = new StarField({
      count: noStars ? 0 : this.abyssVariant ? 900 : 820,
      // カメラ(~6)に近すぎると sizeAttenuation で巨大な四角になる
      minRadius: this.abyssVariant ? 16 : 10,
      maxRadius: this.abyssVariant ? 28 : 26,
      size: this.abyssVariant ? 0.098 : 0.052,
      baseOpacity: this.abyssVariant ? 1 : 0.95,
      parallax: 1.6,
      parallaxAmount: this.abyssVariant ? 0.14 : 0.04,
      coolBias: this.abyssVariant,
      organicDrift: this.abyssVariant && !noStars,
      idleMotion: 1,
      trailSteps: noStars ? 1 : 3,
    });
    this.starsMid =
      !noStars && this.abyssVariant
      ? new StarField({
          count: 2200,
          minRadius: 28,
          maxRadius: 72,
          size: 0.046,
          baseOpacity: 0.95,
          parallax: 0.78,
          parallaxAmount: 0.08,
          coolBias: true,
          organicDrift: true,
          idleMotion: 0.55,
          trailSteps: 2,
        })
      : null;
    this.starsFar = new StarField({
      count: noStars ? 0 : this.abyssVariant ? 6400 : 3400,
      minRadius: 26,
      maxRadius: this.abyssVariant ? 150 : 58,
      size: this.abyssVariant ? 0.028 : 0.02,
      baseOpacity: this.abyssVariant ? 0.95 : 0.8,
      parallax: 0.38,
      parallaxAmount: this.abyssVariant ? 0.05 : 0.04,
      coolBias: this.abyssVariant,
      organicDrift: this.abyssVariant && !noStars,
      idleMotion: 0.28,
      trailSteps: noStars ? 1 : 2,
    });
    if (noStars) {
      this.starsNear.points.visible = false;
      this.starsNear.trailPoints.visible = false;
      this.starsFar.points.visible = false;
      this.starsFar.trailPoints.visible = false;
    }

    this.dust = this.profile?.dustMotes ? new DustMoteField() : null;
    this.biolume = this.profile?.biolumeMotes
      ? new BiolumeMoteField({
          count: 180,
          size: 0.018,
          baseOpacity: 0.45,
          minRadius: 22,
          maxRadius: 42,
          intensityScale: 1.05,
        })
      : null;
    this.biolumeFar = this.profile?.biolumeMotes
      ? new BiolumeMoteField({
          count: 380,
          size: 0.016,
          baseOpacity: 0.28,
          minRadius: 40,
          maxRadius: 110,
          intensityScale: 0.8,
        })
      : null;
    this.weatherPrecip = new WeatherPrecipField();
    this.weatherWind = new WeatherWindField();
    this.weatherMist = new WeatherMistField();
    this.weatherClouds = new WeatherCloudField();
    this.weatherLightning = new WeatherLightningBolts();
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
    this.starsNear.trailPoints.visible = sceneEnv.stars;
    if (this.starsMid) {
      this.starsMid.points.visible = sceneEnv.stars;
      this.starsMid.trailPoints.visible = sceneEnv.stars;
    }
    this.starsFar.points.visible = sceneEnv.stars;
    this.starsFar.trailPoints.visible = sceneEnv.stars;
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
    scene.add(this.parallaxRoot);
    this.parallaxRoot.add(this.dome.mesh);
    if (this.innerDome) {
      this.parallaxRoot.add(this.innerDome.mesh);
    }
    this.parallaxRoot.add(this.starsFar.trailPoints);
    this.parallaxRoot.add(this.starsFar.points);
    if (this.starsMid) {
      this.parallaxRoot.add(this.starsMid.trailPoints);
      this.parallaxRoot.add(this.starsMid.points);
    }
    this.parallaxRoot.add(this.starsNear.trailPoints);
    this.parallaxRoot.add(this.starsNear.points);
    if (this.dust) {
      this.parallaxRoot.add(this.dust.points);
    }
    if (this.biolume) {
      this.parallaxRoot.add(this.biolume.points);
    }
    if (this.biolumeFar) {
      this.parallaxRoot.add(this.biolumeFar.points);
    }
    this.parallaxRoot.add(this.weatherPrecip.object);
    this.parallaxRoot.add(this.weatherWind.group);
    this.parallaxRoot.add(this.weatherMist.group);
    this.parallaxRoot.add(this.weatherClouds.group);
    this.parallaxRoot.add(this.weatherLightning.lines);
    if (this.cyclorama) {
      scene.add(this.cyclorama.mesh);
    }
    if (!this.openVoid) {
      scene.add(this.floor);
    } else if (this.floor.receiveShadow) {
      scene.add(this.floor);
    }
  }

  /** オブジェクト操作量の一部だけ背景へ加え、奥行きの視差を作る。 */
  rotateView(axis: THREE.Vector3, angle: number) {
    this.viewDelta.setFromAxisAngle(axis, angle);
    this.parallaxRoot.quaternion.premultiply(this.viewDelta);
    this.parallaxRoot.updateMatrixWorld();
  }

  /** 視差ルートの向きを取得する。 */
  getViewOrientation(target = new THREE.Quaternion()) {
    return target.copy(this.parallaxRoot.quaternion);
  }

  /** 視差ルートの向きを設定する。 */
  setViewOrientation(orientation: THREE.Quaternion) {
    this.parallaxRoot.quaternion.copy(orientation);
    this.parallaxRoot.updateMatrixWorld();
  }

  /** 視差ルートを初期向きへ戻す。 */
  resetViewOrientation() {
    this.parallaxRoot.quaternion.identity();
    this.parallaxRoot.updateMatrixWorld();
  }

  setPedestalLayout(usePedestal: boolean) {
    this.floor.position.y = usePedestal ? -2.62 : -1.82;
  }

  /** 網点など純黒グラフィック用: ドーム・星・埃を消し、クリア色だけにする */
  setGraphicVoid(enabled: boolean) {
    this.dome.mesh.visible = !enabled;
    if (this.innerDome) {
      this.innerDome.mesh.visible = !enabled;
    }
    if (enabled) {
      this.starsNear.points.visible = false;
      this.starsNear.trailPoints.visible = false;
      if (this.starsMid) {
        this.starsMid.points.visible = false;
        this.starsMid.trailPoints.visible = false;
      }
      this.starsFar.points.visible = false;
      this.starsFar.trailPoints.visible = false;
      if (this.dust) this.dust.points.visible = false;
      if (this.biolume) this.biolume.points.visible = false;
      if (this.biolumeFar) this.biolumeFar.points.visible = false;
    }
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
    if (this.profile?.accentGlow) {
      this.dome.setAccentGlow(true);
    }
    this.cyclorama?.setFromBackground(color, envMix);
    this.studioFloor?.setFromBackground(color, envMix);
  }

  /** 時間帯リンク用: 天頂〜地平の空グラデーションを直接当てる */
  setDaytimeSky(zenith: THREE.Color, horizon: THREE.Color, dark: boolean, envMix = 0, hour?: number) {
    this.envMix = envMix;
    this.dome.setSkyGradient(zenith, horizon, dark, hour);
    this.innerDome?.setSkyGradient(zenith, horizon, dark, hour);
    // 床・サイクラマは地平色寄り
    this.cyclorama?.setFromBackground(horizon, envMix);
    this.studioFloor?.setFromBackground(horizon, envMix);
  }

  /** 深海の海水塊を時刻で調整（天気ぶんの色味は `setAbyssSeaWeather` で先に渡す） */
  setAbyssSeaByHour(hour: number) {
    if (!this.abyssVariant) {
      return;
    }
    this.dome.setAbyssSeaByHour(hour);
    this.innerDome?.setAbyssSeaByHour(hour);
  }

  /** 深海の海水塊の天気ぶんの色味（色相・彩度のみ） */
  setAbyssSeaWeather(tint: { hue: number; sat: number } | null) {
    if (!this.abyssVariant) {
      return;
    }
    this.dome.setAbyssSeaWeather(tint);
    // 内側ドームは効きを半分に（奥行きが潰れないように）
    this.innerDome?.setAbyssSeaWeather(tint ? { hue: tint.hue * 0.6, sat: tint.sat * 0.6 } : null);
  }

  /** 深海ドームの差し込み光条（太陽方向・強度） */
  setAbyssShaft(sunDir: THREE.Vector3, strength: number) {
    if (!this.abyssVariant) {
      this.dome.setAbyssShaft(new THREE.Vector3(0, 1, 0), 0);
      return;
    }
    this.dome.setAbyssShaft(sunDir, strength);
  }

  setWeather(state: SceneWeatherState) {
    this.weather = { ...state };
    this.weatherPrecip.setWeather(
      state.enabled ? state.rainIntensity : 0,
      state.windX,
      state.windZ,
      state.snow,
    );
    this.weatherWind.setWeather(
      state.enabled ? state.windStrength : 0,
      state.windX,
      state.windZ,
    );
    this.weatherMist.setWeather(
      state.enabled ? state.fogIntensity : 0,
      state.windX,
      state.windZ,
    );
    this.weatherClouds.setWeather(
      state.enabled ? state.cloudCover : 0,
      state.windX * 0.45,
      state.windZ * 0.45,
    );
  }

  getWeather() {
    return this.weather;
  }

  /** フレームごとの稲妻フラッシュ量（0..1）。背景・ライトに乗せる */
  getLightningFlash() {
    if (!this.weather.enabled || this.weather.lightningIntensity < 0.05) {
      return 0;
    }
    return this.lightningFlash * this.weather.lightningIntensity;
  }

  private updateLightning(deltaTime: number) {
    const power = this.weather.enabled ? this.weather.lightningIntensity : 0;
    if (power < 0.05) {
      this.lightningFlash = 0;
      this.lightningBurst = 0;
      this.lightningFollowUps = 0;
      this.lightningCooldown = 2.5;
      return;
    }

    if (this.lightningBurst > 0) {
      this.lightningBurst = Math.max(0, this.lightningBurst - deltaTime);
      // 鋭いピーク＋わずかなちらつき
      const envelope = Math.min(1, this.lightningBurst * 22);
      this.lightningFlash = envelope * (0.72 + Math.random() * 0.28);
      if (this.lightningBurst <= 0 && this.lightningFollowUps > 0) {
        this.lightningFollowUps -= 1;
        this.lightningBurst = 0.04 + Math.random() * 0.07;
        if (Math.random() < 0.45) {
          this.weatherLightning.trigger(power * 0.75);
        }
      }
      return;
    }

    this.lightningFlash = 0;
    this.lightningCooldown -= deltaTime;
    if (this.lightningCooldown > 0) {
      return;
    }

    // 強いほど頻発（おおよそ 1.2〜8 秒間隔）
    const gap = (1.4 + Math.random() * 5.5) * (1.35 - power * 0.55);
    this.lightningCooldown = Math.max(0.7, gap);
    this.lightningBurst = 0.06 + Math.random() * 0.1;
    this.lightningFollowUps = Math.random() < 0.4 + power * 0.25 ? 1 + Math.floor(Math.random() * 2) : 0;
    this.lightningFlash = 0.85 + Math.random() * 0.15;
    // 時折ジグザグの稲妻を描く
    if (Math.random() < 0.55 + power * 0.35) {
      this.weatherLightning.trigger(power);
    }
  }

  getFogDensity(dark: boolean) {
    let density: number;
    if (this.profile?.fogDensity !== undefined) {
      density = this.profile.fogDensity * this.weather.fogBoost;
    } else if (this.profile?.studioSpace) {
      density = (dark ? 0.0078 : 0.0048) * this.weather.fogBoost;
    } else {
      density = (dark ? 0.0078 : 0.0058) * this.weather.fogBoost;
    }
    // 霧天気ははっきり霞む密度を下限で保証
    if (this.weather.enabled && this.weather.fogIntensity > 0.05) {
      density = Math.max(density, 0.01 + this.weather.fogIntensity * 0.032);
    }
    return density;
  }

  syncFog(scene: THREE.Scene, color: THREE.Color, dark: boolean) {
    const density = this.getFogDensity(dark);
    if (density <= 0) {
      scene.fog = null;
      return;
    }
    if (this.weather.enabled && this.weather.fogIntensity > 0.2) {
      // 霧は背景色を白寄りに溶かして「霞」として見せる
      const fogColor = color.clone().lerp(new THREE.Color(0xb8c4d2), 0.45 + this.weather.fogIntensity * 0.35);
      scene.fog = new THREE.FogExp2(fogColor.getHex(), density);
      return;
    }
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
    this.starsNear.trailPoints.visible = visible;
    if (this.starsMid) {
      this.starsMid.points.visible = visible;
      this.starsMid.trailPoints.visible = visible;
    }
    this.starsFar.points.visible = visible;
    this.starsFar.trailPoints.visible = visible;
  }

  update(
    time: number,
    bands: AudioBands,
    deltaTime: number,
    camera: THREE.Camera,
    pointerNDC: THREE.Vector2 | null = null,
    starsMotionEnabled = true,
    /** 曲中は true（軽量）/ 停止中は false（全星フル） */
    starsGrowthLite = false,
  ) {
    const targetAudio = bands.overall * 0.55 + bands.melody * 0.45;
    this.audioSmooth += (targetAudio - this.audioSmooth) * Math.min(1, deltaTime * 3.5);

    this.dome.update(time, this.audioSmooth, camera.position);
    if (this.abyssVariant) {
      this.dome.applyParallax(camera.position, this.openVoid ? 0.045 : 0.022);
    }
    this.innerDome?.update(time, this.audioSmooth, camera.position);
    this.innerDome?.applyParallax(camera.position, this.abyssVariant ? 0.018 : 0.025);

    if (this.starsNear.points.visible) {
      this.starsNear.update(
        time,
        bands,
        deltaTime,
        camera,
        pointerNDC,
        starsMotionEnabled,
        starsGrowthLite,
      );
      this.starsMid?.update(
        time,
        bands,
        deltaTime,
        camera,
        pointerNDC,
        starsMotionEnabled,
        starsGrowthLite,
      );
      this.starsFar.update(
        time,
        bands,
        deltaTime,
        camera,
        pointerNDC,
        starsMotionEnabled,
        starsGrowthLite,
      );
    }
    this.dust?.update(bands, deltaTime, camera.position);
    this.biolume?.update(bands, deltaTime, camera.position);
    this.biolumeFar?.update(bands, deltaTime, camera.position);
    this.weatherPrecip.update(deltaTime);
    this.weatherWind.update(deltaTime);
    this.weatherMist.update(deltaTime);
    this.weatherClouds.update(deltaTime);
    this.weatherLightning.update(deltaTime);
    this.updateLightning(deltaTime);

    const flash = this.getLightningFlash();
    const cloud =
      this.weather.enabled ? this.weather.cloudCover : 0;
    const fogHaze =
      this.weather.enabled
        ? Math.max(this.weather.fogIntensity, this.weather.cloudCover * 0.35)
        : 0;
    this.dome.setWeatherAtmosphere(cloud, fogHaze, flash);
    this.innerDome?.setWeatherAtmosphere(cloud * 0.55, fogHaze * 0.4, flash * 0.5);

    // 風で浮遊粒子を流す（はっきり分かる速度）
    if (this.weather.enabled && this.weather.windStrength > 0.05) {
      const gust = 2.8 + this.weather.windStrength * 9.5;
      const wx = this.weather.windX * deltaTime * gust;
      const wz = this.weather.windZ * deltaTime * gust;
      const pushDust = (field: DustMoteField | BiolumeMoteField | null, scale: number) => {
        if (!field) return;
        const pos = field.points.geometry.attributes.position as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] += wx * scale;
          arr[i + 1] += Math.sin(arr[i] * 0.4 + arr[i + 2] * 0.25) * deltaTime * 0.15 * scale;
          arr[i + 2] += wz * scale;
        }
        pos.needsUpdate = true;
      };
      pushDust(this.dust, 1);
      pushDust(this.biolume, 0.75);
      pushDust(this.biolumeFar, 0.45);
    }

    if (this.cyclorama) {
      this.cyclorama.applyEnvMix(this.envMix);
    }
  }
}
