/**
 * vita の彫刻に「鉱物（宝石・水晶）の面」と「生物（粘土）の面」を**同居**させる。
 *
 * 位置づけ（docs/handoff/VITA.md [P2]）:
 * - 曲の音色軸（`SpeciesProfile.mineral`）は**強度ではなく結晶になる面の枚数**を決める。
 *   18 枚の結晶平面（`SoundSculpture.initCrystalFacets`）それぞれに曲固有のランクを持たせ、
 *   軸がそのランクを越えた面だけが結晶になる。axis 0 → 0 枚（＝完全に現状の生物）／
 *   axis 1 → 18 枚（ほぼ全面が鉱石）／中間 → 結晶の面と生物の面が同居する。
 * - **形（シルエット）と材質が同じ面選択を共有する。** 幾何側（`applyCrystalFacets` /
 *   `applyMembraneFacets`）は結晶の面だけを平らにスナップし、ここはその面を宝石の光学で見せる。
 *
 * 2026-08-12 の作り直しの理由（**同じ轍を踏まないこと**）:
 * - 旧版は「軸 × 強度」の全体ブレンドだったので、軸がほぼ全曲 0 の状態では
 *   強度スライダーを最大にしても掛け算で 0 になり、**再生中に何も起きなかった**。
 * - 旧版の微ファセットは `vClayDir`（変形前の球面方向）の乱数セルで、幾何の 18 面と
 *   無関係だった。面ではなくノイズに見えるので「カット面」として読めない。
 * - 旧版はマット粘土の上に発光を足すだけだった。**宝石は地が暗くて艶と稜で見える。**
 *   拡散を落とさずに光だけ足すと「キラキラした粘土」にしかならない。
 */

/** 結晶平面の枚数。`SoundSculpture.facetCount` と**必ず一致させる**（GLSL 側は定数展開） */
export const GEM_FACET_COUNT = 18;

/** 宝石光学の master 強度（0 で無効）。**仮値・実機で曲を鳴らして確定する** */
export const DEFAULT_GEM_STRENGTH = 1;

/** 結晶面の平ら化。1 で完全にその平面の法線になる（＝大きなカット面） */
export const DEFAULT_GEM_FLATTEN = 0.9;

/** 結晶面の地の暗さ（1 = 現状の粘土色のまま、0 = 真っ黒）。宝石に見える主因 */
export const DEFAULT_GEM_BODY_DARK = 0.45;

/** 面の境界（稜）の明線の強さ */
export const DEFAULT_GEM_RIDGE = 1.1;

/** 分散（fire）の色づき。0 で白のみ＝色は完全に脇役 */
export const DEFAULT_GEM_FIRE = 0.35;

/** 面の閃き（ビュー空間固定のキーライト2灯による鋭いスペキュラ） */
export const DEFAULT_GEM_SPARKLE = 1;

/** 透過っぽい回り込み光（水晶らしさ）。地を暗くしたぶんをここで「透けて」見せる */
export const DEFAULT_GEM_THROUGH = 0.5;

/** 結晶面の roughness 倍率（小さいほど鋭い映り込み） */
export const DEFAULT_GEM_ROUGHNESS_MUL = 0.12;

/**
 * 結晶面の中の副次ディテール（微ファセット）の量。**主役ではない。**
 * 大きくすると旧版と同じ「市松模様のブロック」になって宝石に見えなくなる
 * （2026-08-12 に 0.22 / スケール 16 で実際にそうなった）。細かく・薄くだけ乗せる。
 */
export const DEFAULT_GEM_SUBFACET = 0.07;

/** 副次ディテールのセル密度。**低いとブロックが見える。** */
export const DEFAULT_GEM_FACET_SCALE = 90;

/**
 * core / 膜 が共有する uniform。dev パネルから直接書き換えられるよう
 * モジュールに1組だけ持つ（`onBeforeCompile` / ShaderMaterial へ**同じオブジェクトを差す**）。
 *
 * `uGemPlanes`: 結晶平面。xyz = **オブジェクト空間**の面法線（幾何側の選択と完全に同じもの）、
 *   w = その面が結晶になっているか 0..1（軸で毎フレーム更新）。
 * `uGemPlanesWorld`: 同じ面の**ワールド空間**法線。陰影に使う。
 *   フラグメントで `viewMatrix` を掛けてビュー空間へ落とす
 *   （`normalMatrix` はフラグメントシェーダには来ないので、CPU 側で回してから渡している）。
 */
export const gemUniforms = {
  uGem: { value: DEFAULT_GEM_STRENGTH },
  /** 曲の音色軸（表示・膜の微調整用。面の選択自体は uGemPlanes.w が持つ） */
  uMineral: { value: 0 },
  uGemFlatten: { value: DEFAULT_GEM_FLATTEN },
  uGemBodyDark: { value: DEFAULT_GEM_BODY_DARK },
  uGemRidge: { value: DEFAULT_GEM_RIDGE },
  uGemFire: { value: DEFAULT_GEM_FIRE },
  uGemSparkle: { value: DEFAULT_GEM_SPARKLE },
  uGemThrough: { value: DEFAULT_GEM_THROUGH },
  uGemRoughnessMul: { value: DEFAULT_GEM_ROUGHNESS_MUL },
  uGemSubFacet: { value: DEFAULT_GEM_SUBFACET },
  uGemFacetScale: { value: DEFAULT_GEM_FACET_SCALE },
  uGemPlanes: { value: new Float32Array(GEM_FACET_COUNT * 4) },
  uGemPlanesWorld: { value: new Float32Array(GEM_FACET_COUNT * 3) },
};

/** 頂点シェーダの `#include <common>` の直後へ（core 用。膜は自前の varying を持つ） */
export const GEM_VERTEX_COMMON = /* glsl */ `
varying vec3 vGemDir;
`;

/**
 * 頂点シェーダの `#include <begin_vertex>` の直後へ。
 * **変形後**のオブジェクト空間位置（`transformed`）から方向を作る。
 * `vClayDir`（変形前の球面方向）を使うと幾何側の面選択とズレて、面と陰影が一致しない。
 */
export const GEM_VERTEX_MAIN = /* glsl */ `
vGemDir = normalize(transformed);
`;

/**
 * フラグメントシェーダの `#include <common>` の直後へ（core / 膜 共通）。
 * `vGemDir`（フラグメント側の varying 宣言）もここが持つ。
 *
 * 注入ブロックをまたいで値を持ち回るため、グローバル変数に置いている
 * （GLSL のファイルスコープ変数。`gemResolveFace()` を最初の注入点で1回だけ呼ぶ）。
 */
export const GEM_FRAGMENT_COMMON = /* glsl */ `
varying vec3 vGemDir;
uniform float uGem;
uniform float uMineral;
uniform float uGemFlatten;
uniform float uGemBodyDark;
uniform float uGemRidge;
uniform float uGemFire;
uniform float uGemSparkle;
uniform float uGemThrough;
uniform float uGemRoughnessMul;
uniform float uGemSubFacet;
uniform float uGemFacetScale;
uniform vec4 uGemPlanes[${GEM_FACET_COUNT}];
uniform vec3 uGemPlanesWorld[${GEM_FACET_COUNT}];

/** その画素が結晶か 0..1（uGem 込み） */
float gGemMask;
/** 面の境界（稜）0..1 */
float gGemRidge;
/** その面の法線（ビュー空間） */
vec3 gGemFaceView;
/** 面ごとの分散色（uGemFire で白へ寄せてある） */
vec3 gGemFire;

float gemHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 gemHash33(vec3 p) {
  return vec3(gemHash13(p), gemHash13(p + 7.13), gemHash13(p + 13.71));
}

/**
 * この画素がどの結晶平面に属するかを決める。**幾何側の nearestFacet と同じ基準**
 * （オブジェクト空間の方向ベクトルとの内積が最大の面）なので、形と陰影が一致する。
 * 最寄りと次点の差が小さい ＝ 面の境界なので、そこに稜を立てる。
 */
void gemResolveFace() {
  gGemMask = 0.0;
  gGemRidge = 0.0;
  gGemFaceView = vec3(0.0, 0.0, 1.0);
  gGemFire = vec3(1.0);
  if (uGem <= 0.001) {
    return;
  }
  vec3 dir = normalize(vGemDir);
  float d1 = -2.0;
  float d2 = -2.0;
  float f2 = 0.0;
  float idx = 0.0;
  vec4 best = uGemPlanes[0];
  vec3 bestWorld = uGemPlanesWorld[0];
  for (int k = 0; k < ${GEM_FACET_COUNT}; k += 1) {
    float d = dot(dir, uGemPlanes[k].xyz);
    if (d > d1) {
      d2 = d1;
      f2 = best.w;
      d1 = d;
      best = uGemPlanes[k];
      bestWorld = uGemPlanesWorld[k];
      idx = float(k);
    } else if (d > d2) {
      d2 = d;
      f2 = uGemPlanes[k].w;
    }
  }
  float gap = d1 - d2;
  // 面の境界だけ隣の面のフラグと混ぜて、結晶↔生物の境目がジャギらないようにする
  float blend = smoothstep(0.0, 0.035, gap);
  float flag = mix(mix(best.w, f2, 0.5), best.w, blend);
  gGemMask = clamp(flag * uGem, 0.0, 1.0);
  gGemRidge = (1.0 - smoothstep(0.0, 0.022, gap)) * gGemMask;
  gGemFaceView = normalize((viewMatrix * vec4(bestWorld, 0.0)).xyz);
  float h = gemHash13(vec3(idx * 1.37 + 0.5, 2.1, 7.3));
  vec3 hue = 0.62 + 0.38 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.66)));
  // uGemFire 0 で完全な白＝色を主役にしない（原則「色は脇役」）
  gGemFire = mix(vec3(1.0), hue, uGemFire);
}
`;

/**
 * `vec4 diffuseColor = ...` の差し替えブロックの中（**最初の注入点**）へ。
 * ここで面を解決し、結晶面の地を暗く落とす。
 * 宝石は「暗い地＋鋭い光」で見える。拡散を残したまま光だけ足すと粘土のままになる。
 */
export const GEM_FRAGMENT_BODY = /* glsl */ `
  gemResolveFace();
  diffuseColor.rgb *= mix(1.0, uGemBodyDark, gGemMask);
`;

/** `#include <roughnessmap_fragment>` の直後へ。結晶面だけ鋭い映り込みにする */
export const GEM_FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, roughnessFactor * uGemRoughnessMul, gGemMask);
`;

/**
 * clay-grain の法線摂動の直後へ。結晶面の法線をその平面へ倒して**大きな平らなカット面**にする。
 * 面の中の副次ディテールは弱く乗せるだけ（旧版はこれが主役でノイズに見えていた）。
 */
export const GEM_FRAGMENT_NORMAL = /* glsl */ `
if (gGemMask > 0.001) {
  vec3 gemN = normalize(mix(normal, gGemFaceView, gGemMask * uGemFlatten));
  vec3 gemCell = floor(vGemDir * uGemFacetScale) + 0.5;
  gemN = normalize(gemN + (gemHash33(gemCell) - 0.5) * uGemSubFacet * gGemMask);
  normal = gemN;
}
`;

/**
 * 発光の加算ブロックの末尾へ。**結晶が結晶に見えるための光**。
 * vita の環境は暗い深海で映り込む物が無いので、env 反射だけでは宝石にならない。
 * ビュー空間固定のキーライトで自前に焚く（彫刻が回ると面ごとに舐めるように閃く）。
 */
export const GEM_FRAGMENT_EMISSIVE = /* glsl */ `
if (gGemMask > 0.001) {
  vec3 gemV = normalize(vViewPosition);
  float gemNV = max(dot(normal, gemV), 0.0);
  vec3 gemL1 = normalize(vec3(0.35, 0.75, 0.55));
  vec3 gemL2 = normalize(vec3(-0.62, 0.22, 0.75));
  // (1) 稜 — カットの角が線で光る。常に見える宝石の基調
  vec3 gemRidgeLight = gGemFire * gGemRidge * uGemRidge * (0.3 + 0.7 * pow(1.0 - gemNV, 2.0));
  // (2) 縁のフレネル — 透き通った結晶の縁
  vec3 gemRim = gGemFire * pow(1.0 - gemNV, 3.5) * 0.5 * gGemMask;
  // (3) 面の閃き — 回転で面ごとに光が走る
  // 指数を上げすぎると数画素しか光らず「閃かない」。面全体が舐めるくらいが宝石に見える。
  float gemG1 = pow(max(dot(normal, normalize(gemL1 + gemV)), 0.0), 26.0);
  float gemG2 = pow(max(dot(normal, normalize(gemL2 + gemV)), 0.0), 60.0);
  vec3 gemGlint = (gemG1 * vec3(1.0) + gemG2 * gGemFire) * uGemSparkle * gGemMask;
  // (4) 透過 — 面の裏から回り込む光。暗く落とした地がここで「透ける」。
  // 指数を低くすると面全体に薄く乗って「白く霞む」だけになるので鋭めに保つ。
  float gemBack =
    pow(max(dot(-normal, gemL1), 0.0), 4.0) + pow(max(dot(-normal, gemL2), 0.0), 6.0) * 0.6;
  vec3 gemThrough = gGemFire * gemBack * uGemThrough * gGemMask;
  totalEmissiveRadiance += gemRidgeLight + gemRim + gemGlint + gemThrough;
}
`;

/**
 * 膜（外殻・ShaderMaterial）用。結晶の面の上だけ「平らなガラス板」にする。
 * 生物の面の上は**真珠シアンの確定値のまま**（2026-08-11 承認済みの見た目を壊さない）。
 * `color` / `alpha` / `vNormal` / `vViewPosition` が定義済みの文脈で使う。
 */
export const GEM_MEMBRANE_FRAGMENT = /* glsl */ `
{
  gemResolveFace();
  float gemM = gGemMask;
  if (gemM > 0.001) {
    vec3 gemV = normalize(-vViewPosition);
    vec3 gemN = normalize(mix(normalize(vNormal), gGemFaceView, gemM * uGemFlatten));
    float gemNV = max(dot(gemN, gemV), 0.0);
    vec3 gemL1 = normalize(vec3(0.35, 0.75, 0.55));
    // 平らな板の鏡面（面ごとに一枚ずつ光る）
    float gemSpec = pow(max(dot(gemN, normalize(gemL1 + gemV)), 0.0), 60.0);
    // 稜（板の縁）と、板の縁のフレネル
    float gemEdge = gGemRidge;
    vec3 gemGlass = mix(vec3(0.88, 0.95, 1.0), gGemFire, 0.5);
    // **結晶の板は「白く盛る」のではなく「透かす」。** 乳白色の膜が被さったままだと
    // 下の宝石が見えない（2026-08-12 に実際そうなった）。板の面は薄くして芯を見せ、
    // 稜と鏡面だけを鋭く出す＝水晶の板。
    color = mix(color, color * 0.5, gemM * 0.8);
    color += gemGlass * (gemSpec * 1.35 + gemEdge * uGemRidge * 0.7
      + pow(1.0 - gemNV, 4.0) * 0.45) * gemM * uGemSparkle;
    alpha *= mix(1.0, 0.45, gemM);
    alpha += (gemSpec * 0.22 + gemEdge * 0.14) * gemM;
  }
}
`;
