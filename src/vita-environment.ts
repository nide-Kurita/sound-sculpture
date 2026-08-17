import * as THREE from "three";

/**
 * vita 専用の「深海の環境マップ」。
 *
 * 経緯: vita の clearcoat / iridescence に映り込むものが無く、質感が
 * 「少し尖った粘土に膜が光ってるだけ」に見える、という指摘への対応。
 * 一度 `scene.environment = PMREM(RoomEnvironment)` を有効化したが、
 * RoomEnvironment は明るいニュートラルな「部屋」なので、vita の暗く沈んだ
 * 配色が白く洗われた（docs/handoff/VITA.md 5章。**あれは二度と使わない**）。
 *
 * ここでは代わりに、背景（0x082838 の深海）とほぼ同じ暗さの環境を手続きで作る。
 * 設計方針は「平均は暗いまま・分布にだけ差をつける」:
 *
 * - 全天の平均輝度を背景と同程度に保つ（＝環境光として明るさを足さない）
 * - 上（水面側）をわずかに明るく、下（深みの側）をほぼ真っ暗にする
 *   → 回転させたときに上下で映り込みが変わり、塊の丸みが出る
 * - 小さな明部を2つだけ置く（遠くの光条・生物発光のイメージ）
 *   → 回転で流れるハイライトが出る。これが「映り込みがある」ことの主表現
 *
 * `scene.environment` には入れない。入れると背景ドームや床など
 * 彫刻以外の MeshStandardMaterial にも一律にかかるため、
 * 呼び出し側で彫刻のマテリアルにだけ `envMap` として差す。
 */

/** 既定の映り込み量。dev パネルの初期位置・「既定に戻す」の戻り先 */
export const DEFAULT_ABYSS_ENV_INTENSITY = 0.55;

/** 等距円筒図法のソース解像度。PMREM でぼかされるので粗くてよい */
const ENV_WIDTH = 256;
const ENV_HEIGHT = 128;

/**
 * 全天のベース。ここは「明るさを足す」側なので背景と同程度に暗く保つ。
 * 上げると映り込みではなく環境光として全体が持ち上がり、
 * RoomEnvironment のときの「白く洗われる」に近づく。
 */
/** 天頂（水面側）。背景よりわずかに明るいだけ */
const ZENITH = new THREE.Color(0.028, 0.062, 0.09);
/** 水平。深海背景 0x082838 のリニア値とほぼ同じ */
const HORIZON = new THREE.Color(0.005, 0.02, 0.034);
/** 天底（深みの側）。ほぼ無 */
const NADIR = new THREE.Color(0.001, 0.003, 0.006);

/**
 * 遠くの光条・生物発光。角半径（rad）と色で定義する。
 * **1 を大きく超える値を入れているのは意図的。** vita の粘土は roughness 0.78〜0.92 と
 * ほぼマットで、スペキュラのローブが非常に広い。実在の HDRI で太陽が数十〜数百の
 * 値を持つのと同じで、輝度が 1 前後の環境では「映り込み」にならず、
 * ただの環境光（＝全体が明るくなるだけ）になってしまう。
 * 立体角を小さく・輝度を高くすることで、全天の平均は暗いまま
 * 「回転させると流れるハイライト」だけを出す。
 */
const HIGHLIGHTS = [
  // 主役。回転させたときに流れるハイライトを作る
  { azimuth: 1.15, elevation: 0.62, radius: 0.21, color: new THREE.Color(2.6, 4.4, 5.8) },
  // 反対側の弱い広がり。片側だけだと平面的に見えるため
  { azimuth: -1.9, elevation: 0.05, radius: 0.5, color: new THREE.Color(0.18, 0.4, 0.58) },
] as const;

/**
 * 手続きで作った等距円筒テクスチャを PMREM に通し、`material.envMap` へ
 * そのまま差せるテクスチャを返す。
 * 返り値は呼び出し側が保持し、不要になったら `dispose()` すること。
 */
export const createAbyssEnvironment = (renderer: THREE.WebGLRenderer): THREE.Texture => {
  const data = new Uint16Array(ENV_WIDTH * ENV_HEIGHT * 4);
  const color = new THREE.Color();

  for (let y = 0; y < ENV_HEIGHT; y += 1) {
    // v: 0 = 天頂, 1 = 天底
    const v = (y + 0.5) / ENV_HEIGHT;
    const polar = v * Math.PI;
    const elevation = Math.PI / 2 - polar;

    for (let x = 0; x < ENV_WIDTH; x += 1) {
      const u = (x + 0.5) / ENV_WIDTH;
      const azimuth = (u - 0.5) * Math.PI * 2;

      // 上下グラデーション。上半球と下半球で別の補間にして、
      // 「上はうっすら明るい／下は落ちる」を強めに出す
      const t = Math.sin(elevation);
      if (t >= 0) {
        color.copy(HORIZON).lerp(ZENITH, t * t);
      } else {
        color.copy(HORIZON).lerp(NADIR, -t);
      }

      for (const highlight of HIGHLIGHTS) {
        // 球面上の角距離。方位差は経度の折り返しを考慮する
        let dAz = azimuth - highlight.azimuth;
        while (dAz > Math.PI) dAz -= Math.PI * 2;
        while (dAz < -Math.PI) dAz += Math.PI * 2;
        const dEl = elevation - highlight.elevation;
        const angle = Math.hypot(dAz * Math.cos(elevation), dEl);
        if (angle >= highlight.radius) continue;
        // 端で滑らかに 0 になるガウシアン風の減衰（PMREM 後の縁を出さないため）
        const falloff = 1 - angle / highlight.radius;
        const weight = falloff * falloff;
        color.r += highlight.color.r * weight;
        color.g += highlight.color.g * weight;
        color.b += highlight.color.b * weight;
      }

      const i = (y * ENV_WIDTH + x) * 4;
      data[i] = THREE.DataUtils.toHalfFloat(color.r);
      data[i + 1] = THREE.DataUtils.toHalfFloat(color.g);
      data[i + 2] = THREE.DataUtils.toHalfFloat(color.b);
      data[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }

  const source = new THREE.DataTexture(data, ENV_WIDTH, ENV_HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.minFilter = THREE.LinearFilter;
  source.magFilter = THREE.LinearFilter;
  source.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(source);
  pmrem.dispose();
  source.dispose();
  return target.texture;
};
