import * as THREE from "three";

/** クリックで巡回するパレット数（0=初期の青） */
export const DITHER_PALETTE_COUNT = 12;

/**
 * 参照（vitekvisuals）寄りのマット陰影。
 * シーンライトを使わず、固定ライトで柔らかい 2D 階調だけを出す。
 */
const MATTE_VERTEX = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const MATTE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
uniform vec3 uLightDir;
uniform float uWrap;
uniform float uAmbient;
uniform float uContrast;

void main() {
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) n = -n;
  float ndotl = dot(n, normalize(uLightDir));
  float diffuse = clamp((ndotl + uWrap) / (1.0 + uWrap), 0.0, 1.0);
  diffuse = pow(diffuse, 1.15);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
  float shade = uAmbient + (1.0 - uAmbient) * diffuse;
  shade *= 1.0 - rim * 0.22;
  shade = clamp((shade - 0.5) * uContrast + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(vec3(shade), 1.0);
}
`;

export const createDitherMatteMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0.45, 0.85, 0.55).normalize() },
      uWrap: { value: 0.55 },
      uAmbient: { value: 0.08 },
      uContrast: { value: 1.15 },
    },
    vertexShader: MATTE_VERTEX,
    fragmentShader: MATTE_FRAGMENT,
    lights: false,
    fog: false,
  });

/**
 * 画面全体の Ordered Dither（Bayer 8×8）。
 * パレット切替は中心から網点でパタパタ広がる。
 */
const DITHER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DITHER_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uPixelSize;
uniform float uContrast;
uniform float uPaletteFrom;
uniform float uPaletteTo;
uniform vec2 uWaveOrigin;
uniform float uWaveRadius;
uniform float uWaveBand;
varying vec2 vUv;

float bayer8(vec2 p) {
  int x = int(mod(p.x, 8.0));
  int y = int(mod(p.y, 8.0));
  int index = x + y * 8;
  float m =
    index==0?0.: index==1?48.: index==2?12.: index==3?60.:
    index==4?3.: index==5?51.: index==6?15.: index==7?63.:
    index==8?32.: index==9?16.: index==10?44.: index==11?28.:
    index==12?35.: index==13?19.: index==14?47.: index==15?31.:
    index==16?8.: index==17?56.: index==18?4.: index==19?52.:
    index==20?11.: index==21?59.: index==22?7.: index==23?55.:
    index==24?40.: index==25?24.: index==26?36.: index==27?20.:
    index==28?43.: index==29?27.: index==30?39.: index==31?23.:
    index==32?2.: index==33?50.: index==34?14.: index==35?62.:
    index==36?1.: index==37?49.: index==38?13.: index==39?61.:
    index==40?34.: index==41?18.: index==42?46.: index==43?30.:
    index==44?33.: index==45?17.: index==46?45.: index==47?29.:
    index==48?10.: index==49?58.: index==50?6.: index==51?54.:
    index==52?9.: index==53?57.: index==54?5.: index==55?53.:
    index==56?42.: index==57?26.: index==58?38.: index==59?22.:
    index==60?41.: index==61?25.: index==62?37.: 21.;
  return m / 64.0;
}

vec3 ramp5(float t, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e) {
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}

vec3 applyPalette(float t, float id) {
  vec3 black = vec3(0.0);
  vec3 white = vec3(1.0);

  if (id < 0.5) {
    return ramp5(t, black, vec3(0.05, 0.1, 0.28), vec3(0.12, 0.35, 0.78), vec3(0.45, 0.78, 0.98), white);
  }
  if (id < 1.5) {
    return vec3(t);
  }
  if (id < 2.5) {
    return ramp4(t, black, vec3(0.9, 0.05, 0.55), vec3(0.98, 0.88, 0.08), vec3(0.3, 0.98, 0.22));
  }
  if (id < 3.5) {
    return ramp5(t, black, vec3(0.35, 0.02, 0.08), vec3(0.92, 0.22, 0.08), vec3(1.0, 0.62, 0.18), vec3(1.0, 0.86, 0.72));
  }
  if (id < 4.5) {
    return ramp5(t, black, vec3(0.18, 0.02, 0.32), vec3(0.55, 0.12, 0.85), vec3(0.2, 0.75, 0.95), white);
  }
  if (id < 5.5) {
    return ramp4(t, black, vec3(0.05, 0.55, 0.12), vec3(0.85, 0.95, 0.1), vec3(1.0, 0.2, 0.65));
  }
  if (id < 6.5) {
    return ramp5(t, black, vec3(0.02, 0.22, 0.28), vec3(0.05, 0.72, 0.68), vec3(1.0, 0.45, 0.32), vec3(1.0, 0.9, 0.55));
  }
  if (id < 7.5) {
    return ramp5(t, black, vec3(0.02, 0.08, 0.35), vec3(0.15, 0.4, 0.95), vec3(0.35, 0.95, 0.88), white);
  }
  if (id < 8.5) {
    return ramp5(t, black, vec3(0.28, 0.02, 0.12), vec3(0.85, 0.18, 0.42), vec3(0.72, 0.45, 0.95), white);
  }
  if (id < 9.5) {
    return ramp5(t, black, vec3(0.22, 0.08, 0.0), vec3(0.75, 0.35, 0.05), vec3(0.98, 0.78, 0.2), vec3(1.0, 0.95, 0.75));
  }
  if (id < 10.5) {
    return ramp4(t, black, vec3(0.0, 0.95, 0.95), vec3(0.95, 0.05, 0.9), vec3(1.0, 0.95, 0.15));
  }
  return ramp5(t, black, vec3(0.9, 0.1, 0.2), vec3(0.15, 0.85, 0.25), vec3(0.15, 0.35, 0.95), vec3(0.95, 0.85, 0.2));
}

void main() {
  float px = max(uPixelSize, 1.0);
  vec2 pixel = floor(gl_FragCoord.xy / px);
  vec2 uv = (pixel + 0.5) * px / uResolution;
  vec4 src = texture2D(tDiffuse, uv);
  float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  luma = clamp((luma - 0.5) * uContrast + 0.5, 0.0, 1.0);

  float threshold = bayer8(pixel);
  float levels = 6.0;
  float q = floor(luma * levels);
  float frac = fract(luma * levels);
  float stepped = (q + step(threshold, frac)) / levels;
  stepped = clamp(stepped, 0.0, 1.0);

  // 中心からの距離（アスペクト補正）。波面で Bayer がパタパタ切り替わる
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 fromOrigin = (uv - uWaveOrigin) * vec2(aspect, 1.0);
  float dist = length(fromOrigin);
  // セル単位に量子化してドミノ感を出す
  float cell = 0.028;
  float distCell = floor(dist / cell) * cell;
  float frontier = (uWaveRadius - distCell) / max(uWaveBand, 0.001);
  float flipChance = clamp(frontier, 0.0, 1.0);
  // 波面帯では Bayer 閾値でドット単位に新旧が入れ替わる
  float useNew = step(threshold, flipChance);
  if (flipChance >= 1.0) useNew = 1.0;
  if (flipChance <= 0.0) useNew = 0.0;

  float paletteId = mix(uPaletteFrom, uPaletteTo, useNew);
  vec3 color = applyPalette(stepped, paletteId);

  if (luma < 0.015) {
    color = vec3(0.0);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

export class OrderedDitherPass {
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  enabled = true;
  /** 表示上の確定パレット（波完了後） */
  palette = 0;

  private paletteFrom = 0;
  private paletteTo = 0;
  private waveRadius = 2;
  private waveActive = false;
  /** 波が画面端まで届くまでの秒数 */
  private readonly waveDuration = 0.42;
  private readonly waveMaxRadius = 1.35;
  private waveSpeed = 1.35 / 0.42;

  constructor(width: number, height: number) {
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.renderTarget.texture.colorSpace = THREE.NoColorSpace;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        uResolution: { value: new THREE.Vector2(width, height) },
        uPixelSize: { value: 3.6 },
        uContrast: { value: 1.2 },
        uPaletteFrom: { value: 0 },
        uPaletteTo: { value: 0 },
        uWaveOrigin: { value: new THREE.Vector2(0.5, 0.5) },
        uWaveRadius: { value: 2 },
        uWaveBand: { value: 0.09 },
      },
      vertexShader: DITHER_VERTEX,
      fragmentShader: DITHER_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(width: number, height: number) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderTarget.setSize(w, h);
    this.material.uniforms.uResolution.value.set(w, h);
  }

  setPixelSize(size: number) {
    this.material.uniforms.uPixelSize.value = size;
  }

  /**
   * 次パレットへ。中心（または指定 UV）から網点ドミノ波で広がる。
   * @param originUv 画面 UV（左下 0,0〜右上 1,1）。省略時は中央。
   */
  cyclePalette(originUv?: { x: number; y: number }) {
    const next =
      (((this.waveActive ? this.paletteTo : this.palette) + 1) % DITHER_PALETTE_COUNT +
        DITHER_PALETTE_COUNT) %
      DITHER_PALETTE_COUNT;

    if (this.waveActive) {
      // 途中クリック: 進行中の先を確定してから次の波を始める
      this.paletteFrom = this.paletteTo;
      this.palette = this.paletteTo;
    } else {
      this.paletteFrom = this.palette;
    }

    this.paletteTo = next;
    this.palette = next;
    this.waveRadius = 0;
    this.waveActive = true;
    this.waveSpeed = this.waveMaxRadius / this.waveDuration;

    const origin = this.material.uniforms.uWaveOrigin.value as THREE.Vector2;
    if (originUv) {
      origin.set(originUv.x, originUv.y);
    } else {
      origin.set(0.5, 0.5);
    }

    this.syncWaveUniforms();
  }

  update(deltaTime: number) {
    if (!this.waveActive) {
      return;
    }
    this.waveRadius += this.waveSpeed * deltaTime;
    if (this.waveRadius >= this.waveMaxRadius) {
      this.waveRadius = this.waveMaxRadius;
      this.waveActive = false;
      this.paletteFrom = this.paletteTo;
      this.palette = this.paletteTo;
    }
    this.syncWaveUniforms();
  }

  private syncWaveUniforms() {
    this.material.uniforms.uPaletteFrom.value = this.paletteFrom;
    this.material.uniforms.uPaletteTo.value = this.paletteTo;
    this.material.uniforms.uWaveRadius.value = this.waveRadius;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const prevTone = renderer.toneMapping;
    const prevExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.toneMapping = prevTone;
    renderer.toneMappingExposure = prevExposure;

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.renderTarget.dispose();
    this.material.dispose();
  }
}
