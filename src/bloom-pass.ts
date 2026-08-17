import * as THREE from "three";

/**
 * EffectComposer を使わない、自前の軽量ブルーム。
 *
 * 経緯: EffectComposer + RenderPass + UnrealBloomPass + OutputPass で実装したところ、
 * renderer.toneMapping / outputColorSpace まわりで画面全体が白っぽく霞む問題が発生し、
 * 原因を特定できず撤回した。このプロジェクトの dither スタイル（OrderedDitherPass,
 * dither-pass.ts）は「専用の WebGLRenderTarget に描画 → フルスクリーンクアッドで
 * 合成」という自前パターンで正しく動いているため、同じ流儀で作り直す。
 *
 * 通常の renderer.render(scene, camera) を canvas へ直接呼ぶ処理は一切変更しない
 * （そこが今回の失敗の火種だったため）。ブルームは「シーンをもう一度、別の
 * オフスクリーンターゲットへ描画し、明るい部分だけ抽出してぼかしたものを、
 * 既に描画済みの canvas へ加算合成で重ねる」という完全に独立した追加パスにする。
 */
/**
 * 既定値。dev チューニングパネルの初期位置・「既定に戻す」の戻り先でもある。
 * ここを書き換えると出荷時の見た目が変わる（パネルで追い込んだ値を焼き込む場所）。
 *
 * 2026-08-10: ユーザーが dev パネルで**曲を鳴らしながら**決めた値。
 * 0.9 / 0.6（無音のスクリーンショットだけで置いた仮値）から変更した。
 * 無音では滲みの本来の対象（ヒット時の粒子・膜のきらめき）が出ないため、
 * 仮値は弱すぎた。**この2つを無音の見た目を根拠に動かさないこと。**
 */
export const DEFAULT_BLOOM_THRESHOLD = 0.8;
export const DEFAULT_BLOOM_STRENGTH = 2.08;

export class SimpleBloomPass {
  enabled = true;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  // threshold は「線形HDR の輝度がいくつを超えたら滲ませるか」。
  // 初期値だった 1.15 は vita のシーンの実測レンジを超えており、該当画素が 0.042%
  // しか無くブルームが常にゼロだった。実測では 0.90 超が 1.49%、0.60 超が 50%。
  // 既定は上の DEFAULT_BLOOM_* を参照（実機で曲を鳴らして決めた値）。
  constructor(
    width: number,
    height: number,
    threshold = DEFAULT_BLOOM_THRESHOLD,
    strength = DEFAULT_BLOOM_STRENGTH,
  ) {
    // ぼかしの負荷を抑えるため半解像度で十分（ソフトなグローなのでシャープさは不要）
    const w = Math.max(1, Math.floor(width * 0.5));
    const h = Math.max(1, Math.floor(height * 0.5));
    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      // 8bit（トーンマップ後）だと通常の艶ハイライトも 1.0 に張り付いて閾値で
      // 選り分けられないため、線形HDRのまま保持できる HalfFloat にする
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.sceneTarget.texture },
        uTexelSize: { value: new THREE.Vector2(1 / w, 1 / h) },
        uThreshold: { value: threshold },
        uStrength: { value: strength },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform vec2 uTexelSize;
        uniform float uThreshold;
        uniform float uStrength;
        varying vec2 vUv;

        float bloomLuma(vec3 c) {
          return dot(c, vec3(0.2126, 0.7152, 0.0722));
        }

        void main() {
          // 13タップの円形サンプルで簡易ぼかし（マルチパス無しの軽量版）
          vec2 offsets[12];
          offsets[0] = vec2(1.0, 0.0);
          offsets[1] = vec2(-1.0, 0.0);
          offsets[2] = vec2(0.0, 1.0);
          offsets[3] = vec2(0.0, -1.0);
          offsets[4] = vec2(0.71, 0.71);
          offsets[5] = vec2(-0.71, 0.71);
          offsets[6] = vec2(0.71, -0.71);
          offsets[7] = vec2(-0.71, -0.71);
          offsets[8] = vec2(2.0, 0.0);
          offsets[9] = vec2(-2.0, 0.0);
          offsets[10] = vec2(0.0, 2.0);
          offsets[11] = vec2(0.0, -2.0);

          vec3 sum = vec3(0.0);
          float total = 0.0;
          for (int i = 0; i < 12; i += 1) {
            vec2 uv = vUv + offsets[i] * uTexelSize * 2.4;
            vec3 c = texture2D(tDiffuse, uv).rgb;
            float l = bloomLuma(c);
            float bright = max(0.0, l - uThreshold);
            sum += c * bright;
            total += 1.0;
          }
          vec3 centerColor = texture2D(tDiffuse, vUv).rgb;
          float centerBright = max(0.0, bloomLuma(centerColor) - uThreshold);
          sum += centerColor * centerBright * 3.0;
          total += 3.0;

          vec3 glow = (sum / total) * uStrength;
          // three.js の AdditiveBlending は blendSrc = SrcAlphaFactor なので、
          // 出力 rgb はここで書く alpha を掛けられてから加算される。
          // 以前は alpha に glow の輝度そのものを入れていたため glow が二乗され、
          // 実際の寄与が 1/255 未満に潰れて**ブルームが一切見えていなかった**。
          // 加算量は uStrength だけで制御し、alpha は 1.0 に固定する。
          gl_FragColor = vec4(glow, 1.0);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /**
   * threshold / strength は dev チューニングパネルから再生中に動かす
   * （ブルームの対象がヒット時の粒子・きらめきなので、無音では強度を判断できない）。
   */
  get threshold() {
    return this.material.uniforms.uThreshold.value as number;
  }

  set threshold(value: number) {
    this.material.uniforms.uThreshold.value = value;
  }

  get strength() {
    return this.material.uniforms.uStrength.value as number;
  }

  set strength(value: number) {
    this.material.uniforms.uStrength.value = value;
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width * 0.5));
    const h = Math.max(1, Math.floor(height * 0.5));
    this.sceneTarget.setSize(w, h);
    (this.material.uniforms.uTexelSize.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  /**
   * 呼び出し順が重要: renderer.render(scene, camera) で通常どおり canvas へ
   * 描画した「後」に呼ぶこと。ここではシーンをもう一度オフスクリーンへ描画し、
   * 明るい部分だけを抽出・ぼかして canvas へ加算合成する（canvas はクリアしない）。
   */
  renderBloomOverlay(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) {
      return;
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    // dither スタイル（OrderedDitherPass）と同じ手法: このオフスクリーン描画中だけ
    // トーンマッピングを止めて線形HDRのまま書き出す。canvas へ表示済みの絵は
    // 既に別の renderer.render() 呼び出しで確定しているので、ここで何をしても
    // その表示には影響しない（合成後の加算オーバーレイのみに使う一時バッファ）。
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.autoClear = true;
    renderer.render(scene, camera);

    renderer.toneMapping = prevTone;
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.sceneTarget.dispose();
    this.material.dispose();
  }
}
