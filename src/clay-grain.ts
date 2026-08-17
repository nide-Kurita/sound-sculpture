import * as THREE from "three";

/**
 * vita の粘土（core）に「シェーダ側だけで」肌理を足す。
 *
 * 背景: 本体は Icosahedron detail 10 = 1,245 頂点 / 2,420 三角形しかなく、
 * 「プレステ2くらい」と言われる原因になっている。頂点を増やす方向
 * （geodesic / 分割密度 / 法線平滑）はユーザーが却下済みで、
 * CPU の per-vertex 変形が頂点予算を縛っているので増やせもしない
 * （docs/handoff/VITA.md 5章・7章）。
 *
 * そこで幾何は一切割らずに、**フラグメントで法線だけを摂動させる**。
 * 三角形が大きいと法線の線形補間がそのまま滑らかなグラデーションになり、
 * 稜線が「面の境目」として読めてしまう。肌理を乗せてその勾配を崩すと、
 * 同じ頂点数のままでも面の境目が読み取りにくくなる。
 *
 * **シルエットは変わらない。** 輪郭の多角形っぽさはこの手法では直らない
 * （直すには頂点を増やすしかなく、それは却下されている）。効くのは陰影だけ。
 *
 * 手法は Morten S. Mikkelsen の "Bump Mapping Unparametrized Surfaces on the GPU"。
 * three.js の `bumpmap_pars_fragment` と同じ式だが、あちらは `bumpMap` テクスチャが
 * 無いとチャンクごとコンパイルされないので、ここに自前で持っている。
 * 高さ場は手続きノイズなので、1画素あたりノイズ評価は1回だけ（勾配は dFdx / dFdy）。
 */

/**
 * 肌理の強さ。0 で無効（uniform 分岐でノイズ評価ごと飛ばす）。
 * 2026-08-10 にユーザーが実機で曲を鳴らして確定した値。
 * 無音のスクリーンショットで置いた仮値 0.55 のちょうど2倍で、ブルームのときと同じく
 * **無音で置いた仮値は弱すぎた**。この値を無音の見た目を根拠に下げないこと。
 */
export const DEFAULT_CLAY_GRAIN_STRENGTH = 1.11;

/**
 * 肌理の細かさ。単位方向ベクトルに掛ける周波数。
 * 2026-08-10 にユーザー確定。仮値 26 の約2倍で、より細かい砂目が選ばれた。
 */
export const DEFAULT_CLAY_GRAIN_SCALE = 55;

/**
 * core マテリアル間で共有する uniform。
 * dev パネルから直接書き換えられるよう、モジュールに1組だけ持つ
 * （`onBeforeCompile` の `shader.uniforms` へ**同じオブジェクトを差す**）。
 */
export const clayGrainUniforms = {
  uClayGrain: { value: DEFAULT_CLAY_GRAIN_STRENGTH },
  uClayGrainScale: { value: DEFAULT_CLAY_GRAIN_SCALE },
};

/**
 * 肌理のドメインになる「変形前の球面方向」を作る。
 *
 * 変形後の `position` を使うと、成長・呼吸で頂点が動くたびに肌理が表面を泳ぐ。
 * `basePositions`（構築時の未変形の球）は最後まで書き換わらないので、
 * ここから単位方向を作って静的な attribute として持たせる。
 */
export const createClayGrainDirections = (basePositions: Float32Array) => {
  const directions = new Float32Array(basePositions.length);
  for (let i = 0; i < basePositions.length; i += 3) {
    const x = basePositions[i];
    const y = basePositions[i + 1];
    const z = basePositions[i + 2];
    const length = Math.hypot(x, y, z) || 1;
    directions[i] = x / length;
    directions[i + 1] = y / length;
    directions[i + 2] = z / length;
  }
  return directions;
};

/** `geometry` に肌理用の attribute を張る。attribute 名は GLSL 側と対で決め打ち */
export const attachClayGrainAttribute = (
  geometry: THREE.BufferGeometry,
  basePositions: Float32Array,
) => {
  geometry.setAttribute(
    "aClayDir",
    new THREE.BufferAttribute(createClayGrainDirections(basePositions), 3),
  );
};

/** 頂点シェーダの `#include <common>` の直後へ */
export const CLAY_GRAIN_VERTEX_COMMON = /* glsl */ `
attribute vec3 aClayDir;
varying vec3 vClayDir;
`;

/** 頂点シェーダの `#include <begin_vertex>` の直後へ */
export const CLAY_GRAIN_VERTEX_MAIN = /* glsl */ `
vClayDir = aClayDir;
`;

/** フラグメントシェーダの `#include <common>` の直後へ */
export const CLAY_GRAIN_FRAGMENT_COMMON = /* glsl */ `
varying vec3 vClayDir;
uniform float uClayGrain;
uniform float uClayGrainScale;

float clayGrainHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float clayGrainValueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n00 = mix(clayGrainHash(i + vec3(0.0, 0.0, 0.0)), clayGrainHash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float n10 = mix(clayGrainHash(i + vec3(0.0, 1.0, 0.0)), clayGrainHash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float n01 = mix(clayGrainHash(i + vec3(0.0, 0.0, 1.0)), clayGrainHash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float n11 = mix(clayGrainHash(i + vec3(0.0, 1.0, 1.0)), clayGrainHash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(n00, n10, f.y), mix(n01, n11, f.y), f.z);
}

// 3オクターブ。粗いほうが「面の境目」を崩し、細かいほうが粘土の肌理になる。
float clayGrainHeight(vec3 p) {
  float height = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 3; octave += 1) {
    height += amplitude * clayGrainValueNoise(p);
    p *= 2.07;
    amplitude *= 0.5;
  }
  return height;
}
`;

/**
 * フラグメントシェーダの `#include <normal_fragment_maps>` の直後へ。
 *
 * `nonPerturbedNormal`（clearcoat が使う法線）はこれより前で確定しているので、
 * クリアコート層は滑らかなまま下地の粘土だけが荒れる——釉薬と素地の関係と同じ。
 * clearcoat 側も同じ勾配で荒らす実装を試したが、完成状態の勾配エネルギーは
 * strength 2 で +29% と、入れる前とまったく同じだった（＝測れる効果が無い）ので外した。
 */
export const CLAY_GRAIN_FRAGMENT_NORMAL = /* glsl */ `
if (uClayGrain > 0.0) {
  float clayHeight = clayGrainHeight(vClayDir * uClayGrainScale);
  vec2 clayDHdxy = vec2(dFdx(clayHeight), dFdy(clayHeight)) * uClayGrain;
  // faceDirection は normal_fragment_begin が定義済み
  vec3 claySigmaX = normalize(dFdx(-vViewPosition));
  vec3 claySigmaY = normalize(dFdy(-vViewPosition));
  vec3 clayR1 = cross(claySigmaY, normal);
  vec3 clayR2 = cross(normal, claySigmaX);
  float clayDet = dot(claySigmaX, clayR1) * faceDirection;
  vec3 clayGrad = sign(clayDet) * (clayDHdxy.x * clayR1 + clayDHdxy.y * clayR2);
  normal = normalize(abs(clayDet) * normal - clayGrad);
}
`;
