import { PHI } from "./fibonacci";
import { curlNoiseSample, seededUnit, vertexPattern } from "./sculpture-types";

/** 生成アルゴリズム ID — モード（型）とは独立した「考え方」 */
export type GrowthAlgorithmId =
  | "fibonacci"
  | "phyllotaxis"
  | "lsystem"
  | "differential-growth"
  | "reaction-diffusion"
  | "voronoi"
  | "dla"
  | "physarum"
  | "flow-field"
  | "curl-noise"
  | "space-colonization"
  | "crystal-growth"
  | "erosion";

export type GrowthAlgorithmMeta = {
  id: GrowthAlgorithmId;
  label: string;
  tagline: string;
};

export const GROWTH_ALGORITHM_CATALOG: GrowthAlgorithmMeta[] = [
  { id: "fibonacci", label: "Fibonacci", tagline: "フィボナッチ比率による均衡した起伏" },
  { id: "phyllotaxis", label: "Phyllotaxis", tagline: "黄金角螺旋 — 花・松ぼっくりの葉序" },
  { id: "lsystem", label: "L-System", tagline: "枝分かれ — 触手・骨格・器官" },
  { id: "differential-growth", label: "Differential Growth", tagline: "面の押し合い — レタス・脳・珊瑚" },
  { id: "reaction-diffusion", label: "Reaction Diffusion", tagline: "反応拡散 — 皮膚模様・侵食文様" },
  { id: "voronoi", label: "Voronoi Growth", tagline: "細胞分裂・鉱物の割れ目" },
  { id: "dla", label: "DLA", tagline: "拡散限定凝集 — 雪の結晶・菌糸" },
  { id: "physarum", label: "Physarum", tagline: "粘菌網 — 神経・血管の経路" },
  { id: "flow-field", label: "Flow Field", tagline: "流れ場に沿った成長" },
  { id: "curl-noise", label: "Curl Noise", tagline: "渦のある柔らかい有機変形" },
  { id: "space-colonization", label: "Space Colonization", tagline: "空間探索 — 木・血管・触手" },
  { id: "crystal-growth", label: "Crystal Growth", tagline: "結晶面 — 鉱石・人工物の鋭さ" },
  { id: "erosion", label: "Erosion", tagline: "風化侵食 — 音の化石" },
];

export type GrowthVec3 = { x: number; y: number; z: number };

export type GrowthAlgorithm = {
  id: GrowthAlgorithmId;
  pattern(x: number, y: number, z: number, salt: number): number;
  flow(x: number, y: number, z: number, salt: number, out: GrowthVec3): void;
  placeOnSphere(index: number, total: number, seed: number): GrowthVec3;
  spikeMask(x: number, y: number, z: number, salt: number): number;
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const hash3 = (x: number, y: number, z: number, salt: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 19.3) * 43758.5453;
  return v - Math.floor(v);
};

const uniformSphere = (index: number, _total: number, _seed: number): GrowthVec3 => {
  const u = seededUnit(index, 41.2);
  const v = seededUnit(index, 77.9);
  const theta = u * Math.PI * 2;
  const phi = Math.acos(2 * v - 1);
  const sinPhi = Math.sin(phi);
  return { x: sinPhi * Math.cos(theta), y: Math.cos(phi), z: sinPhi * Math.sin(theta) };
};

const phyllotaxisSphere = (index: number, total: number, seed: number): GrowthVec3 => {
  const t = index + seed * 0.13;
  const y = 1 - (t / Math.max(1, total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * t;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
};

const normalize3 = (x: number, y: number, z: number) => {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
};

const laplacianPattern = (x: number, y: number, z: number, salt: number, base: (x: number, y: number, z: number, s: number) => number) => {
  const eps = 0.08;
  const c = base(x, y, z, salt);
  const lx = base(x + eps, y, z, salt) + base(x - eps, y, z, salt);
  const ly = base(x, y + eps, z, salt) + base(x, y - eps, z, salt);
  const lz = base(x, y, z + eps, salt) + base(x, y, z - eps, salt);
  return (lx + ly + lz) * 0.25 - c;
};

const voronoiEdge = (x: number, y: number, z: number, salt: number, cells = 6) => {
  let best = 1e9;
  let second = 1e9;
  for (let c = 0; c < cells; c += 1) {
    const cx = Math.sin(c * 2.399 + salt * 0.17) * 0.9;
    const cy = Math.cos(c * 1.731 + salt * 0.23) * 0.9;
    const cz = Math.sin(c * 3.113 - salt * 0.11) * 0.9;
    const d = Math.hypot(x - cx, y - cy, z - cz);
    if (d < best) {
      second = best;
      best = d;
    } else if (d < second) {
      second = d;
    }
  }
  return second - best;
};

const flowFromAngle = (x: number, y: number, z: number, salt: number, out: GrowthVec3, scale = 1) => {
  const angle = hash3(x * 2.1, y * 2.1, z * 2.1, salt) * Math.PI * 2;
  const ax = Math.cos(angle) * scale;
  const az = Math.sin(angle) * scale;
  const dot = ax * x + az * z;
  out.x = ax - x * dot;
  out.y = 0.35 * Math.sin(angle * 1.7 + salt);
  out.z = az - z * dot;
};

const fibonacciAlgo: GrowthAlgorithm = {
  id: "fibonacci",
  pattern: (x, y, z, salt) => vertexPattern(x, y, z, salt),
  flow: (x, y, z, salt, out) => curlNoiseSample(x, y, z, salt, out),
  placeOnSphere: uniformSphere,
  spikeMask: (x, y, z, salt) => clamp01(vertexPattern(x, y, z, salt + 28.9) * 0.5 + 0.5),
};

const phyllotaxisAlgo: GrowthAlgorithm = {
  id: "phyllotaxis",
  pattern: (x, y, z, salt) => {
    const theta = Math.atan2(z, x);
    const spiral = Math.sin(theta * PHI + y * 8.2 + salt * 0.4);
    const ring = Math.cos((Math.hypot(x, z) - 0.35) * 12.0 - salt * 0.2);
    return (spiral * 0.62 + ring * 0.38) / 1.0;
  },
  flow: (x, y, z, _salt, out) => {
    const theta = Math.atan2(z, x) + GOLDEN_ANGLE;
    out.x = -Math.sin(theta);
    out.y = y * 0.18;
    out.z = Math.cos(theta);
  },
  placeOnSphere: phyllotaxisSphere,
  spikeMask: (x, _y, z, salt) => clamp01(Math.abs(Math.sin(Math.atan2(z, x) * PHI + salt)) * 0.85),
};

const lsystemAlgo: GrowthAlgorithm = {
  id: "lsystem",
  pattern: (x, y, z, salt) => {
    let v = x * 0.8 + y * 0.35 + z * 0.2;
    for (let g = 0; g < 4; g += 1) {
      v = Math.abs(Math.sin(v * 3.4 + salt * 0.31 + g)) - 0.38 + Math.abs(Math.cos(y * 2.9 - salt * 0.17 + g * 1.3)) * 0.34;
    }
    return v;
  },
  flow: (x, y, z, salt, out) => {
    const branch = Math.sin(x * 5.5 + salt) * Math.cos(z * 4.2 - salt * 0.5);
    out.x = branch;
    out.y = Math.sin(y * 6.1 + salt * 0.7) * 0.4;
    out.z = Math.cos(x * 4.8 - z * 3.6 + salt);
  },
  placeOnSphere: (index, total, seed) => {
    const base = phyllotaxisSphere(index, total, seed);
    const fork = seededUnit(index, seed + 19.4) > 0.55 ? 1 : -1;
    return normalize3(base.x + fork * 0.12, base.y, base.z + fork * 0.08);
  },
  spikeMask: (x, y, _z, salt) => clamp01(Math.abs(Math.sin(x * 9 + y * 7 + salt)) * 0.9),
};

const differentialGrowthAlgo: GrowthAlgorithm = {
  id: "differential-growth",
  pattern: (x, y, z, salt) => {
    const base = vertexPattern(x, y, z, salt);
    const lap = laplacianPattern(x, y, z, salt, vertexPattern);
    return base * 0.45 + lap * 1.8;
  },
  flow: (x, y, z, salt, out) => {
    curlNoiseSample(x, y, z, salt, out);
    // 毎頂点の二重ラプラシアンを避け、軽い押し出しだけ足す
    const push = vertexPattern(x, y, z, salt + 2.1) * 0.22;
    out.x += x * push;
    out.y += y * push;
    out.z += z * push;
  },
  placeOnSphere: (index, total, seed) => {
    const p = uniformSphere(index, total, seed);
    const bulge = seededUnit(index, seed + 3.3) * 0.18;
    return normalize3(p.x * (1 + bulge), p.y * (1 - bulge * 0.5), p.z * (1 + bulge));
  },
  // pattern を再計算しない（ラプラシアン二重評価を避ける）
  spikeMask: (x, y, z, salt) => clamp01(Math.abs(vertexPattern(x, y, z, salt + 5.5)) * 0.85 + 0.2),
};

const reactionDiffusionAlgo: GrowthAlgorithm = {
  id: "reaction-diffusion",
  pattern: (x, y, z, salt) => {
    const u = Math.sin(x * 8.4 + salt * 0.3) * Math.cos(y * 6.2 - salt * 0.2);
    const v = Math.cos(z * 7.1 - salt * 0.4) * Math.sin(x * 5.5 + salt);
    return (u * v - 0.08) / 0.35;
  },
  flow: (x, _y, z, salt, out) => {
    const du = Math.sin(x * 8.4 + salt) * 0.02;
    const dv = Math.cos(z * 7.1 - salt) * 0.02;
    out.x = du - dv;
    out.y = (du + dv) * 0.5;
    out.z = dv - du;
  },
  placeOnSphere: phyllotaxisSphere,
  spikeMask: (x, y, _z, salt) =>
    clamp01(Math.abs(Math.sin(x * 8.4 + salt * 0.3) * Math.cos(y * 6.2 - salt * 0.2))),
};

const voronoiAlgo: GrowthAlgorithm = {
  id: "voronoi",
  pattern: (x, y, z, salt) => voronoiEdge(x, y, z, salt) * 2.4 - 0.35,
  flow: (x, y, z, salt, out) => flowFromAngle(x, y, z, salt + hash3(x, y, z, salt) * 2, out, 0.8),
  placeOnSphere: (index, _total, seed) => {
    const c = Math.floor(seededUnit(index, seed) * 10);
    const cx = Math.sin(c * 2.399 + seed) * 0.85;
    const cy = Math.cos(c * 1.731 + seed) * 0.85;
    const cz = Math.sin(c * 3.113 - seed) * 0.85;
    return normalize3(cx, cy, cz);
  },
  spikeMask: (x, y, z, salt) => clamp01(Math.abs(vertexPattern(x * 3.1, y * 3.1, z * 3.1, salt)) * 0.9 + 0.1),
};

const dlaAlgo: GrowthAlgorithm = {
  id: "dla",
  pattern: (x, y, z, salt) => {
    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const arms = Math.sin(angle * 5.5 + salt * 0.2) * (1 - r * 0.35);
    const dendrite = Math.pow(Math.max(0, 1 - Math.abs(y) * 1.2), 2.2) * arms;
    return dendrite + hash3(x, y, z, salt) * 0.15 - 0.2;
  },
  flow: (x, y, z, salt, out) => {
    const angle = Math.atan2(z, x) + salt * 0.01;
    out.x = Math.cos(angle) * (0.4 + hash3(x, y, z, salt));
    out.y = y * -0.25;
    out.z = Math.sin(angle) * (0.4 + hash3(z, x, y, salt + 1));
  },
  placeOnSphere: (index, total, seed) => {
    const angle = (index / Math.max(1, total)) * Math.PI * 2 * 5 + seed * 0.05;
    const r = 0.55 + seededUnit(index, seed + 2) * 0.45;
    return normalize3(Math.cos(angle) * r, (seededUnit(index, seed + 4) - 0.5) * 0.6, Math.sin(angle) * r);
  },
  spikeMask: (x, y, z, salt) => clamp01(Math.abs(hash3(x, y, z, salt + 9) * 2 - 1) * 0.55 + 0.35),
};

const physarumAlgo: GrowthAlgorithm = {
  id: "physarum",
  pattern: (x, y, z, salt) => {
    const veinA = Math.sin(x * 6.5 + z * 4.2 + salt * 0.3);
    const veinB = Math.cos(y * 7.1 - x * 3.8 + salt * 0.5);
    const veinC = Math.sin((x + y + z) * 5.2 - salt * 0.2);
    return (veinA + veinB + veinC) / 3;
  },
  flow: (x, y, z, salt, out) => {
    flowFromAngle(x, y, z, salt + hash3(x, y, z, salt) * 4, out, 1.1);
    out.x += Math.sin(z * 5 + salt) * 0.2;
    out.z += Math.cos(x * 5 - salt) * 0.2;
  },
  placeOnSphere: (index, total, seed) => {
    const hub = Math.floor(seededUnit(index, seed) * 6);
    const base = uniformSphere(hub, 6, seed);
    const spoke = phyllotaxisSphere(index, total, seed);
    return normalize3(base.x * 0.55 + spoke.x * 0.45, base.y * 0.55 + spoke.y * 0.45, base.z * 0.55 + spoke.z * 0.45);
  },
  spikeMask: (x, _y, z, salt) => clamp01(Math.abs(Math.sin(x * 6.5 + z * 4.2 + salt * 0.3))),
};

const flowFieldAlgo: GrowthAlgorithm = {
  id: "flow-field",
  pattern: (x, y, z, salt) => {
    const angle = hash3(x, y, z, salt) * Math.PI * 2;
    return Math.sin(angle * 3 + y * 4 + salt * 0.2);
  },
  flow: (x, y, z, salt, out) => flowFromAngle(x, y, z, salt, out, 1.2),
  placeOnSphere: (index, total, seed) => {
    const p = uniformSphere(index, total, seed);
    const drift = hash3(p.x, p.y, p.z, seed) * 0.25;
    return normalize3(p.x + drift, p.y, p.z - drift * 0.5);
  },
  spikeMask: (x, y, z, salt) => clamp01(Math.abs(hash3(x, y, z, salt + 3) * 2 - 1) * 0.75),
};

/**
 * curl-noise のスカラー模様は有限差分 curl を使わない。
 * （growthModulate が毎頂点・毎チャネルで pattern を呼ぶため、フル curl だと落ちる）
 * 見た目の渦感は flow() 側の本命 curl で出す。
 */
const curlNoiseAlgo: GrowthAlgorithm = {
  id: "curl-noise",
  pattern: (x, y, z, salt) => {
    const sx = x * 1.6;
    const sy = y * 1.6;
    const sz = z * 1.6;
    return (
      Math.sin(sx * 3.1 + sy * 2.4 + salt) * Math.cos(sz * 2.7 - salt * 0.45) * 0.55 +
      Math.sin((sx - sz) * 2.35 + salt * 1.1) * 0.28 +
      Math.cos(sy * 3.6 + salt * 0.7) * 0.17
    );
  },
  flow: (x, y, z, salt, out) => curlNoiseSample(x * 1.45, y * 1.45, z * 1.45, salt, out),
  placeOnSphere: uniformSphere,
  spikeMask: (x, y, z, salt) =>
    clamp01(Math.abs(Math.sin(x * 4.2 + y * 3.1 - z * 2.8 + salt)) * 0.75 + 0.12),
};

const spaceColonizationAlgo: GrowthAlgorithm = {
  id: "space-colonization",
  pattern: (x, y, z, salt) => {
    // 6点フル評価は重いので 3 点 + ハッシュで近似
    let attract = 0;
    for (let a = 0; a < 3; a += 1) {
      const ax = Math.sin(a * 2.1 + salt * 0.13) * 0.75;
      const ay = Math.cos(a * 1.7 + salt * 0.19) * 0.75;
      const az = Math.sin(a * 2.9 - salt * 0.11) * 0.75;
      const d = Math.hypot(x - ax, y - ay, z - az);
      attract += Math.exp(-d * 4.5);
    }
    attract += hash3(x, y, z, salt) * 0.35;
    return attract * 1.6 - 0.55;
  },
  flow: (x, y, z, salt, out) => {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let a = 0; a < 3; a += 1) {
      const tx = Math.sin(a * 2.1 + salt) * 0.8 - x;
      const ty = Math.cos(a * 1.7 + salt) * 0.8 - y;
      const tz = Math.sin(a * 2.9 - salt) * 0.8 - z;
      const w = 1 / (Math.hypot(tx, ty, tz) + 0.2);
      ax += tx * w;
      ay += ty * w;
      az += tz * w;
    }
    out.x = ax;
    out.y = ay;
    out.z = az;
  },
  placeOnSphere: (index, total, seed) => {
    const attractor = Math.floor(seededUnit(index, seed + 11) * 6);
    const target = uniformSphere(attractor, 6, seed + 33);
    const growth = phyllotaxisSphere(index, total, seed);
    const t = 0.35 + seededUnit(index, seed + 7) * 0.45;
    return normalize3(
      target.x * (1 - t) + growth.x * t,
      target.y * (1 - t) + growth.y * t,
      target.z * (1 - t) + growth.z * t,
    );
  },
  spikeMask: (x, y, z, salt) => clamp01(hash3(x, y, z, salt + 2) * 0.85 + 0.1),
};

const crystalGrowthAlgo: GrowthAlgorithm = {
  id: "crystal-growth",
  pattern: (x, y, z, salt) => {
    const f1 = Math.abs(Math.sin(x * 9.2 + salt * 0.2));
    const f2 = Math.abs(Math.sin(y * 8.7 - salt * 0.15));
    const f3 = Math.abs(Math.sin(z * 10.1 + salt * 0.25));
    return Math.max(f1, f2, f3) * 2 - 0.85;
  },
  flow: (x, y, z, salt, out) => {
    const f1 = Math.sign(x) * Math.abs(Math.sin(x * 9 + salt));
    const f2 = Math.sign(y) * Math.abs(Math.sin(y * 8 - salt));
    const f3 = Math.sign(z) * Math.abs(Math.sin(z * 10 + salt));
    out.x = f1;
    out.y = f2;
    out.z = f3;
  },
  placeOnSphere: (index, _total, seed) => {
    const u = seededUnit(index, seed + 1.1);
    const v = seededUnit(index, seed + 2.2);
    const w = seededUnit(index, seed + 3.3);
    return normalize3(Math.round(u * 4 - 2), Math.round(v * 4 - 2), Math.round(w * 4 - 2));
  },
  spikeMask: (x, y, z, salt) => clamp01(crystalGrowthAlgo.pattern(x, y, z, salt) * 0.9 + 0.25),
};

const erosionAlgo: GrowthAlgorithm = {
  id: "erosion",
  pattern: (x, y, z, salt) => {
    const raw = vertexPattern(x, y, z, salt);
    const worn = raw * 0.35 - Math.abs(vertexPattern(x * 1.4, y * 1.4, z * 1.4, salt + 4.7)) * 0.55;
    // フルラプラシアンは重いので 1 軸差分で近似
    const eps = 0.08;
    const lapApprox =
      (vertexPattern(x + eps, y, z, salt) + vertexPattern(x - eps, y, z, salt)) * 0.5 - raw;
    return worn + lapApprox * 0.35;
  },
  flow: (x, y, z, salt, out) => {
    const downhill = -vertexPattern(x, y, z, salt + 1.3);
    out.x = x * downhill * 0.5;
    out.y = y * downhill * 0.35 - 0.08;
    out.z = z * downhill * 0.5;
  },
  placeOnSphere: uniformSphere,
  spikeMask: () => 0.15,
};

const ALGORITHMS: Record<GrowthAlgorithmId, GrowthAlgorithm> = {
  fibonacci: fibonacciAlgo,
  phyllotaxis: phyllotaxisAlgo,
  lsystem: lsystemAlgo,
  "differential-growth": differentialGrowthAlgo,
  "reaction-diffusion": reactionDiffusionAlgo,
  voronoi: voronoiAlgo,
  dla: dlaAlgo,
  physarum: physarumAlgo,
  "flow-field": flowFieldAlgo,
  "curl-noise": curlNoiseAlgo,
  "space-colonization": spaceColonizationAlgo,
  "crystal-growth": crystalGrowthAlgo,
  erosion: erosionAlgo,
};

let activeGrowthAlgorithmId: GrowthAlgorithmId = "fibonacci";

export const getGrowthAlgorithmId = () => activeGrowthAlgorithmId;

/** flow() が重いアルゴリズム（毎頂点フル評価すると落ちやすい） */
export const isHeavyGrowthFlowAlgorithm = (id: GrowthAlgorithmId = activeGrowthAlgorithmId) =>
  id === "curl-noise" || id === "differential-growth" || id === "voronoi" || id === "space-colonization";

export const getGrowthAlgorithm = (id: GrowthAlgorithmId = activeGrowthAlgorithmId) => ALGORITHMS[id];

export const setGrowthAlgorithmId = (id: GrowthAlgorithmId) => {
  if (!ALGORITHMS[id]) {
    return false;
  }
  activeGrowthAlgorithmId = id;
  return true;
};

export const parseGrowthAlgorithmId = (): GrowthAlgorithmId => {
  const param = new URLSearchParams(window.location.search).get("algo");
  if (param && param in ALGORITHMS) {
    return param as GrowthAlgorithmId;
  }
  return "fibonacci";
};

export const growthPattern = (x: number, y: number, z: number, salt: number) =>
  getGrowthAlgorithm().pattern(x, y, z, salt);

export const growthFlow = (x: number, y: number, z: number, salt: number, out: GrowthVec3) =>
  getGrowthAlgorithm().flow(x, y, z, salt, out);

export const growthPlaceOnSphere = (index: number, total: number, seed: number) =>
  getGrowthAlgorithm().placeOnSphere(index, total, seed);

export const growthSpikeMask = (x: number, y: number, z: number, salt: number) =>
  getGrowthAlgorithm().spikeMask(x, y, z, salt);

export const getGrowthAlgorithmMeta = (id: GrowthAlgorithmId = activeGrowthAlgorithmId) =>
  GROWTH_ALGORITHM_CATALOG.find((entry) => entry.id === id) ?? GROWTH_ALGORITHM_CATALOG[0];

/** 変形チャネル — 全ての形状数値は growthModulate* を通して反映する */
export type GrowthDeformChannel =
  | "bulk"
  | "mid"
  | "high"
  | "flow"
  | "erosion"
  | "live"
  | "idle"
  | "click"
  | "global"
  | "anchor"
  | "memory"
  | "surface";

let growthDeformInfluence = 1;

/** 成長アルゴリズムによる変形の効き（1=フル、低いほど均一に近づく） */
export const setGrowthDeformInfluence = (value: number) => {
  growthDeformInfluence = Math.max(0, Math.min(1.5, value));
};

export const getGrowthDeformInfluence = () => growthDeformInfluence;

const deformSmooth01 = (value: number) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};

const ALGO_CHANNEL_BIAS: Partial<
  Record<GrowthAlgorithmId, Partial<Record<GrowthDeformChannel, number>>>
> = {
  fibonacci: { bulk: 1, mid: 1, global: 1, memory: 1.05 },
  phyllotaxis: { bulk: 1.22, global: 1.28, anchor: 1.35, surface: 1.18 },
  lsystem: { anchor: 1.45, flow: 1.32, mid: 1.22, bulk: 1.12 },
  "differential-growth": { bulk: 1.32, mid: 1.28, flow: 1.22, surface: 1.2 },
  "reaction-diffusion": { mid: 1.38, surface: 1.4, erosion: 1.28, bulk: 1.1 },
  voronoi: { bulk: 1.42, mid: 1.38, high: 1.05, global: 1.25 },
  dla: { high: 1.4, anchor: 1.35, flow: 1.28, bulk: 1.12 },
  physarum: { flow: 1.48, anchor: 1.35, surface: 1.3, mid: 1.18 },
  "flow-field": { flow: 1.55, surface: 1.32, live: 1.22, bulk: 1.1 },
  "curl-noise": { flow: 1.42, live: 1.28, idle: 1.22, bulk: 1.18, surface: 1.2 },
  "space-colonization": { anchor: 1.5, bulk: 1.28, global: 1.22, mid: 1.15 },
  "crystal-growth": { high: 1.65, bulk: 0.72, mid: 0.78, global: 1.15 },
  erosion: { erosion: 1.7, bulk: 0.68, global: 0.78, mid: 0.85 },
};

/** 大域シルエットへのアルゴリズム偏り（morphWeights 乗数） */
export type GrowthAlgoSilhouetteBias = {
  diabolo: number;
  torus: number;
  monolith: number;
  coral: number;
  spindle: number;
};

export const getGrowthAlgoSilhouetteBias = (
  id: GrowthAlgorithmId = activeGrowthAlgorithmId,
): GrowthAlgoSilhouetteBias => {
  switch (id) {
    case "phyllotaxis":
      return { diabolo: 0.9, torus: 1.45, monolith: 0.85, coral: 1.05, spindle: 1.25 };
    case "lsystem":
    case "space-colonization":
      return { diabolo: 0.85, torus: 0.9, monolith: 1.05, coral: 1.3, spindle: 1.5 };
    case "differential-growth":
    case "curl-noise":
      return { diabolo: 1.2, torus: 1.05, monolith: 0.8, coral: 1.45, spindle: 0.95 };
    case "reaction-diffusion":
    case "voronoi":
      return { diabolo: 0.88, torus: 1.1, monolith: 0.9, coral: 1.55, spindle: 1.0 };
    case "dla":
      return { diabolo: 0.8, torus: 0.95, monolith: 1.0, coral: 1.4, spindle: 1.35 };
    case "physarum":
    case "flow-field":
      return { diabolo: 1.05, torus: 1.35, monolith: 0.85, coral: 1.25, spindle: 1.1 };
    case "crystal-growth":
      return { diabolo: 0.7, torus: 0.75, monolith: 1.55, coral: 0.75, spindle: 1.4 };
    case "erosion":
      return { diabolo: 0.75, torus: 0.85, monolith: 1.4, coral: 0.9, spindle: 1.15 };
    default:
      return { diabolo: 1, torus: 1, monolith: 1, coral: 1, spindle: 1 };
  }
};

const rawChannelGain = (
  channel: GrowthDeformChannel,
  pattern: number,
  spike: number,
  algoId: GrowthAlgorithmId,
) => {
  const wave = deformSmooth01(pattern * 0.5 + 0.5);
  const edge = deformSmooth01(spike);
  // 振幅を広げ、アルゴリズム差が永続形状にも残るようにする
  let gain = 0.42 + wave * 1.05;

  switch (channel) {
    case "bulk":
      gain *= 0.72 + wave * 0.55;
      break;
    case "mid":
      gain *= 0.65 + Math.abs(pattern) * 0.55;
      break;
    case "high":
      gain *= 0.4 + edge * 1.15;
      break;
    case "flow":
      gain *= 0.58 + Math.abs(pattern) * 0.72;
      break;
    case "erosion":
      gain *= 0.55 + (1 - wave) * 0.65 + edge * 0.35;
      break;
    case "live":
      gain *= 0.7 + wave * 0.55;
      break;
    case "idle":
      gain *= 0.78 + wave * 0.4;
      break;
    case "click":
      gain *= 0.82 + edge * 0.5;
      break;
    case "global":
      gain *= 0.55 + wave * 0.85;
      break;
    case "anchor":
      gain *= 0.52 + wave * 0.9;
      break;
    case "memory":
      gain *= 0.65 + wave * 0.5;
      break;
    case "surface":
      gain *= 0.7 + Math.abs(pattern) * 0.55;
      break;
    default:
      break;
  }

  return gain * (ALGO_CHANNEL_BIAS[algoId]?.[channel] ?? 1);
};

/**
 * スカラー変位・圧力・蓄積量を成長アルゴリズムのパターンで変調して返す。
 * amount=0 は即 0（パターン評価をスキップ）。
 * spikeMask は高コストになりやすいので、edge を使うチャネルだけ評価する。
 */
export const growthModulateScalar = (
  amount: number,
  nx: number,
  ny: number,
  nz: number,
  salt: number,
  channel: GrowthDeformChannel = "bulk",
) => {
  if (amount === 0) {
    return 0;
  }
  const algo = getGrowthAlgorithm();
  const pattern = algo.pattern(nx, ny, nz, salt);
  const needsSpike =
    channel === "high" || channel === "click" || channel === "erosion";
  const spike = needsSpike
    ? algo.spikeMask(nx, ny, nz, salt)
    : deformSmooth01(Math.abs(pattern));
  const gain = rawChannelGain(channel, pattern, spike, algo.id);
  const blended = 1 + (gain - 1) * growthDeformInfluence;
  return amount * blended;
};

/** ベクトル変位を成長アルゴリズムで変調（方向は保ち、大きさのみ変える） */
export const growthModulateVector3 = (
  vx: number,
  vy: number,
  vz: number,
  nx: number,
  ny: number,
  nz: number,
  salt: number,
  channel: GrowthDeformChannel = "flow",
) => {
  if (vx === 0 && vy === 0 && vz === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const gain = growthModulateScalar(1, nx, ny, nz, salt, channel);
  return { x: vx * gain, y: vy * gain, z: vz * gain };
};
