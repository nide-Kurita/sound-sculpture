import * as THREE from "three";

/**
 * 表示専用の高解像度メッシュ。
 *
 * **なぜ要るか**（`docs/handoff/VITA.md` の [P2]）:
 * vita の輪郭が多角形に見える。頂点を増やせば直るが、変形は CPU の per-vertex 計算なので
 * 頂点数に比例して重くなる。分割を足す方針はユーザーが却下済み。
 *
 * **効く理屈**: 最終位置は `base + 法線方向スカラー + ベクトル変位` を
 * `applyGlobalForm` に通したもので、**球面方向ごとの滑らかな3次元変位場**になっている。
 * ならば低解像度メッシュで変位場を計算し、それを高解像度メッシュへ
 * 重心座標で補間すれば、**変形計算を増やさずに描画だけ細かくできる。**
 *
 * 補間するのは「変位」であって位置ではない。位置を補間すると、
 * 高解像度メッシュの頂点が低解像度の三角形の平面へ吸い寄せられて、
 * 元の多角形がそのまま残る。
 */
export type DisplayMeshBinding = {
  /** 表示頂点ごとの、参照する低解像度頂点3つ（`vertexCount * 3`） */
  readonly indices: Int32Array;
  /** 上の3つに対する重み（合計1。`vertexCount * 3`） */
  readonly weights: Float32Array;
  /** 表示メッシュの変形前の位置 */
  readonly basePositions: Float32Array;
};

/** 頂点 → その頂点を含む三角形の一覧 */
const buildVertexTriangles = (index: ArrayLike<number>, vertexCount: number) => {
  const counts = new Uint32Array(vertexCount);
  const triCount = index.length / 3;
  for (let t = 0; t < triCount; t += 1) {
    counts[index[t * 3]] += 1;
    counts[index[t * 3 + 1]] += 1;
    counts[index[t * 3 + 2]] += 1;
  }
  const starts = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i += 1) {
    starts[i + 1] = starts[i] + counts[i];
  }
  const cursor = starts.slice(0, vertexCount);
  const list = new Uint32Array(starts[vertexCount]);
  for (let t = 0; t < triCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = index[t * 3 + k];
      list[cursor[v]] = t;
      cursor[v] += 1;
    }
  }
  return { starts, list };
};

/**
 * 球面上の点 `d`（単位ベクトル）が三角形 `a,b,c`（同じく球面上）に入るか判定し、
 * 入るなら重心座標を返す。
 *
 * 球面三角形なので、`d` を三角形の平面へ中心投影してから通常の重心座標を取る。
 * 3つとも非負なら内側。
 */
const sphericalBarycentric = (
  d: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  out: THREE.Vector3,
) => {
  // 平面 (a,b,c) と原点から d 方向へ伸ばした直線の交点を求める
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const denom = n.dot(d);
  if (Math.abs(denom) < 1e-12) {
    return false;
  }
  const t = n.dot(a) / denom;
  if (t <= 0) {
    return false;
  }
  const p = new THREE.Vector3().copy(d).multiplyScalar(t);

  const v0 = new THREE.Vector3().subVectors(b, a);
  const v1 = new THREE.Vector3().subVectors(c, a);
  const v2 = new THREE.Vector3().subVectors(p, a);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);
  const det = d00 * d11 - d01 * d01;
  if (Math.abs(det) < 1e-16) {
    return false;
  }
  const v = (d11 * d20 - d01 * d21) / det;
  const w = (d00 * d21 - d01 * d20) / det;
  const u = 1 - v - w;
  // 端で取りこぼさないよう、わずかな負を許して丸める
  const eps = -1e-5;
  if (u < eps || v < eps || w < eps) {
    return false;
  }
  out.set(Math.max(0, u), Math.max(0, v), Math.max(0, w));
  const sum = out.x + out.y + out.z;
  out.multiplyScalar(1 / Math.max(1e-9, sum));
  return true;
};

/**
 * 表示メッシュの各頂点を、低解像度メッシュの三角形へ束ねる。
 * **初期化時に1回だけ走る。** 毎フレームではない。
 *
 * 総当たりは 4,000 × 2,400 で 1,000 万回になるので、
 * まず最近傍の低解像度頂点を探し、その頂点に接する三角形だけを見る。
 */
export const bindDisplayMesh = (
  displayGeometry: THREE.BufferGeometry,
  simGeometry: THREE.BufferGeometry,
): DisplayMeshBinding => {
  const simPos = simGeometry.attributes.position.array as ArrayLike<number>;
  const simCount = simGeometry.attributes.position.count;
  const simIndex = simGeometry.getIndex();
  if (!simIndex) {
    throw new Error("bindDisplayMesh: 低解像度メッシュに index が無い");
  }
  const { starts, list } = buildVertexTriangles(simIndex.array, simCount);

  // 低解像度頂点の単位方向（何度も使うので先に作る）
  const simDir = new Float32Array(simCount * 3);
  for (let i = 0; i < simCount; i += 1) {
    const x = simPos[i * 3];
    const y = simPos[i * 3 + 1];
    const z = simPos[i * 3 + 2];
    const r = Math.hypot(x, y, z) || 1;
    simDir[i * 3] = x / r;
    simDir[i * 3 + 1] = y / r;
    simDir[i * 3 + 2] = z / r;
  }

  const dispPos = displayGeometry.attributes.position.array as ArrayLike<number>;
  const dispCount = displayGeometry.attributes.position.count;
  const indices = new Int32Array(dispCount * 3);
  const weights = new Float32Array(dispCount * 3);

  const d = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const bary = new THREE.Vector3();
  const idxArr = simIndex.array;

  for (let i = 0; i < dispCount; i += 1) {
    const x = dispPos[i * 3];
    const y = dispPos[i * 3 + 1];
    const z = dispPos[i * 3 + 2];
    const r = Math.hypot(x, y, z) || 1;
    d.set(x / r, y / r, z / r);

    // 最近傍の低解像度頂点
    let best = 0;
    let bestDot = -Infinity;
    for (let j = 0; j < simCount; j += 1) {
      const dot = d.x * simDir[j * 3] + d.y * simDir[j * 3 + 1] + d.z * simDir[j * 3 + 2];
      if (dot > bestDot) {
        bestDot = dot;
        best = j;
      }
    }

    let found = false;
    for (let k = starts[best]; k < starts[best + 1] && !found; k += 1) {
      const t = list[k];
      const ia = idxArr[t * 3];
      const ib = idxArr[t * 3 + 1];
      const ic = idxArr[t * 3 + 2];
      a.set(simDir[ia * 3], simDir[ia * 3 + 1], simDir[ia * 3 + 2]);
      b.set(simDir[ib * 3], simDir[ib * 3 + 1], simDir[ib * 3 + 2]);
      c.set(simDir[ic * 3], simDir[ic * 3 + 1], simDir[ic * 3 + 2]);
      if (!sphericalBarycentric(d, a, b, c, bary)) {
        continue;
      }
      indices[i * 3] = ia;
      indices[i * 3 + 1] = ib;
      indices[i * 3 + 2] = ic;
      weights[i * 3] = bary.x;
      weights[i * 3 + 1] = bary.y;
      weights[i * 3 + 2] = bary.z;
      found = true;
    }

    if (!found) {
      // 三角形に入らなかったときは最近傍頂点そのものを使う。
      // 球面三角形の縁で稀に起きるが、変位場は連続なので見た目に段は出ない。
      indices[i * 3] = best;
      indices[i * 3 + 1] = best;
      indices[i * 3 + 2] = best;
      weights[i * 3] = 1;
      weights[i * 3 + 1] = 0;
      weights[i * 3 + 2] = 0;
    }
  }

  return {
    indices,
    weights,
    basePositions: new Float32Array(dispPos as ArrayLike<number> as never),
  };
};

/**
 * 低解像度メッシュの**変位**を表示メッシュへ流し込む。毎フレーム走る。
 * 1頂点あたり乗算9回・加算6回で、変形計算そのものより桁違いに軽い。
 */
export const syncDisplayPositions = (
  binding: DisplayMeshBinding,
  simPositions: ArrayLike<number>,
  simBasePositions: ArrayLike<number>,
  target: Float32Array,
) => {
  const { indices, weights, basePositions } = binding;
  const count = target.length / 3;
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let k = 0; k < 3; k += 1) {
      const w = weights[o + k];
      if (w === 0) continue;
      const s = indices[o + k] * 3;
      dx += (simPositions[s] - simBasePositions[s]) * w;
      dy += (simPositions[s + 1] - simBasePositions[s + 1]) * w;
      dz += (simPositions[s + 2] - simBasePositions[s + 2]) * w;
    }
    target[o] = basePositions[o] + dx;
    target[o + 1] = basePositions[o + 1] + dy;
    target[o + 2] = basePositions[o + 2] + dz;
  }
};

/** 低解像度メッシュの頂点ごとのスカラー／ベクトル属性を表示メッシュへ補間する */
export const syncDisplayAttribute = (
  binding: DisplayMeshBinding,
  source: ArrayLike<number>,
  itemSize: number,
  target: Float32Array,
) => {
  const { indices, weights } = binding;
  const count = target.length / itemSize;
  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const to = i * itemSize;
    for (let c = 0; c < itemSize; c += 1) {
      target[to + c] = 0;
    }
    for (let k = 0; k < 3; k += 1) {
      const w = weights[o + k];
      if (w === 0) continue;
      const s = indices[o + k] * itemSize;
      for (let c = 0; c < itemSize; c += 1) {
        target[to + c] += source[s + c] * w;
      }
    }
  }
};
