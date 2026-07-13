import * as THREE from "three";
import type { SpeciesProfile } from "./species-profile";
import type { StructureSnapshot } from "./structure-tracker";
import { getGrowthAlgorithmId, type GrowthAlgorithmId } from "./growth-algorithm";
import { createClayColorShift, nudgeClayColorShift } from "./clay-color";
import { runtimeTuning } from "./sculpture-tuning";
import {
  clamp01,
  smoothstep,
  type AudioBands,
  type RhythmEvents,
  type SculptureExperience,
} from "./sculpture-types";

const defaultRhythm = (): RhythmEvents => ({
  kick: 0,
  snare: 0,
  hat: 0,
  transient: 0,
  beat: 0,
  beatIndex: 0,
  kickIndex: 0,
  snareIndex: 0,
  hatIndex: 0,
  transientIndex: 0,
  downbeat: false,
  bpm: 0,
  pulsePhase: 0,
  pulseConfidence: 0,
  pulseEnvelope: 0,
  pulseIndex: 0,
  subLevel: 0,
  wavePeak: 0,
  waveEnergy: 0,
});

type AmoebaGrowthMode = "tendril" | "radial" | "meander";

const mapGrowthAlgorithmToAmoebaMode = (id: GrowthAlgorithmId): AmoebaGrowthMode => {
  // Reuse existing panel's "成長アルゴリズム" selector.
  // Map algorithm "feel" to slime steering variants.
  switch (id) {
    case "phyllotaxis":
    case "fibonacci":
      return "radial";
    case "flow-field":
    case "curl-noise":
    case "reaction-diffusion":
      return "meander";
    default:
      return "tendril";
  }
};

/**
 * Amoeba (new spec): 2D slime mold (physarum-like) growth, rendered as per-pixel texture.
 *
 * - Agents move on a 2D grid, depositing trail.
 * - Trail diffuses + decays, agents steer by sensing trail ahead/left/right.
 * - Render: 1px粒感の ImageData を CanvasTexture として貼る。
 */
export class AmoebaSculpture implements SculptureExperience {
  readonly group = new THREE.Group();
  private readonly consumeOrganBudget: (cost: number) => boolean;

  // --- Simulation (2D) ---
  private readonly w: number;
  private readonly h: number;
  private readonly wh: number;
  private trail0: Float32Array;
  private trail1: Float32Array;

  private agentsX: Float32Array;
  private agentsY: Float32Array;
  private agentsA: Float32Array;
  private agentCount: number;

  private simTime = 0;
  private completed = false;
  private readonly clickRipples: Array<{ x: number; y: number; age: number }> = [];

  private growthMode: AmoebaGrowthMode = "tendril";
  private clayColorShift = createClayColorShift();

  // --- Rendering (pixel texture) ---
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private readonly tex: THREE.CanvasTexture;
  private readonly plane: THREE.Mesh;
  private readonly planeMat: THREE.MeshBasicMaterial;
  private readonly glowPlane: THREE.Mesh;
  private readonly glowMat: THREE.MeshBasicMaterial;

  // --- Runtime params (audio will modulate later) ---
  private readonly params = {
    // Agents
    speed: 0.48, // px / step (more viscous)
    turnSpeed: 0.22, // rad / step (smoother)
    sensorDist: 10,
    sensorAngle: 0.42, // rad
    deposit: 1.05,
    // Branching / exploration
    branchChance: 0.014, // per agent per step (more branching)
    branchAngle: 0.78, // rad
    repelTrail: 0.12, // stickier (less avoidance)
    // Trail field
    diffuse: 0.06, // 0..1 (less blur => gooey filaments)
    decay: 0.9965, // per step (much longer memory)
    // Growth (spawn)
    spawnPerSecond: 90,
    maxAgents: 18000,
    // Visual
    gain: 10.0,
    bg: 0.0,
    grainLevels: 7,
    grainThreshold: 0.085,
    glow: 1.0,
    // Deep-sea palette (blue/teal, slow drift)
    hueSpeed: 0.015,
    hueSpan: 0.18,
    sat: 0.9,
    lightMin: 0.22,
    lightMax: 0.48,
  };

  constructor(options?: { consumeOrganBudget?: (cost: number) => boolean }) {
    this.consumeOrganBudget = options?.consumeOrganBudget ?? (() => true);
    void this.consumeOrganBudget;
    this.growthMode = mapGrowthAlgorithmToAmoebaMode(getGrowthAlgorithmId());

    // Pixel grid (1px粒感). Keep it moderate for perf; can be raised later.
    this.w = 512;
    this.h = 512;
    this.wh = this.w * this.h;
    this.trail0 = new Float32Array(this.wh);
    this.trail1 = new Float32Array(this.wh);

    // Start with a small colony, then grow.
    this.agentCount = 650;
    this.agentsX = new Float32Array(this.params.maxAgents);
    this.agentsY = new Float32Array(this.params.maxAgents);
    this.agentsA = new Float32Array(this.params.maxAgents);

    // Canvas -> texture
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Failed to create 2D canvas context");
    }
    this.ctx = ctx;
    this.imageData = this.ctx.createImageData(this.w, this.h);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;

    this.planeMat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), this.planeMat);
    this.plane.position.set(0, 0, 0);
    this.group.add(this.plane);

    // Additive glow overlay (cheap “emission” look).
    this.glowMat = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      opacity: this.params.glow,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(0xffffff),
    });
    this.glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), this.glowMat);
    this.glowPlane.position.set(0, 0, 0.001);
    this.glowPlane.scale.setScalar(1.01);
    this.group.add(this.glowPlane);
    this.group.rotation.set(0, 0, 0);

    this.reset();
  }

  update(
    bands: AudioBands,
    deltaTime: number,
    userViewInteracting = false,
    rhythm: RhythmEvents = defaultRhythm(),
    structure?: StructureSnapshot,
    _species?: SpeciesProfile,
  ) {
    void userViewInteracting;
    void structure;

    // Keep deterministic-ish stepping and avoid explosions.
    const dt = Math.min(1 / 30, Math.max(0, deltaTime));
    const activity = this.completed ? 0 : smoothstep(0.01, 0.18, bands.overall);
    const timeAdvance = this.completed ? 0 : dt * (0.5 + activity * 0.5);

    if (!this.completed) {
      this.simTime += timeAdvance;
      this.growthMode = mapGrowthAlgorithmToAmoebaMode(getGrowthAlgorithmId());

      // Audio hooks (light): more brightness -> faster diffusion; kick -> brief extra deposit.
      const kickBoost = rhythm.kick > 0 ? 1 + clamp01(rhythm.kick) * 0.8 : 1;
      const diffuse = clamp01(this.params.diffuse + clamp01(bands.brightness) * 0.12);
      const decay = this.params.decay - clamp01(bands.contrast) * 0.008;

      // Reuse existing tuning panel (6 sliders) as "slow controls" for amoeba.
      // - formation: growth rate / spawn
      // - growth: branching + persistence
      const formation = clamp01(runtimeTuning.accumRate * 2.2); // expanded knob proxy
      const growth = clamp01(runtimeTuning.globalFormEnergyScale * 0.9);
      this.params.spawnPerSecond = 70 + formation * 140;
      this.params.branchChance = 0.008 + growth * 0.02;
      this.params.decay = 0.995 + growth * 0.0035;

      // Steps per frame: keep stable.
      const steps = 1;
      for (let s = 0; s < steps; s += 1) {
        this.stepAgents(kickBoost);
        this.diffuseAndDecay(diffuse, decay);
        this.swapTrail();
        this.spawnAgents(dt / steps, bands, rhythm);
      }
    }

    this.updateClickRipples(deltaTime);
    this.renderToTexture(bands);
  }

  getPointerTargets() {
    return [this.plane, this.glowPlane];
  }

  pokeSurface(localPoint: THREE.Vector3) {
    const px = (localPoint.x / 4.2 + 0.5) * this.w;
    const py = (0.5 - localPoint.y / 4.2) * this.h;
    this.clickRipples.push({ x: px, y: py, age: 0 });
    this.repelAgentsAt(px, py, 34);
    this.nudgeClayColorOnClick();
  }

  nudgeClayColorOnClick() {
    this.clayColorShift = nudgeClayColorShift(this.clayColorShift);
  }

  private updateClickRipples(deltaTime: number) {
    for (let ri = this.clickRipples.length - 1; ri >= 0; ri -= 1) {
      const ripple = this.clickRipples[ri];
      ripple.age += deltaTime;
      const radius = 10 + ripple.age * 55;
      const amp = Math.exp(-ripple.age * 3.8) * Math.cos(ripple.age * 18) * 0.55;
      if (ripple.age > 1.1) {
        this.clickRipples.splice(ri, 1);
        continue;
      }
      if (Math.abs(amp) > 0.008) {
        this.addTrailRipple(this.trail0, ripple.x, ripple.y, radius, amp);
      }
    }
  }

  private repelAgentsAt(px: number, py: number, radius: number) {
    const radiusSq = radius * radius;
    for (let i = 0; i < this.agentCount; i += 1) {
      let dx = this.agentsX[i] - px;
      let dy = this.agentsY[i] - py;
      if (dx > this.w * 0.5) {
        dx -= this.w;
      } else if (dx < -this.w * 0.5) {
        dx += this.w;
      }
      if (dy > this.h * 0.5) {
        dy -= this.h;
      } else if (dy < -this.h * 0.5) {
        dy += this.h;
      }
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq || distSq < 1) {
        continue;
      }
      const dist = Math.sqrt(distSq);
      const push = ((radius - dist) / radius) * 5.5;
      this.agentsX[i] += (dx / dist) * push;
      this.agentsY[i] += (dy / dist) * push;
    }
  }

  private addTrailRipple(
    trail: Float32Array,
    cx: number,
    cy: number,
    radius: number,
    amp: number,
  ) {
    const radiusSq = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq) {
          continue;
        }
        const t = 1 - Math.sqrt(distSq / radiusSq);
        const falloff = t * t * (3 - 2 * t);
        const idx = x + y * this.w;
        trail[idx] = Math.min(1, Math.max(0, trail[idx] + amp * falloff));
      }
    }
  }

  applyLiveTuningNow() {
    // Placeholder: in the future, live tuning can map into params.*.
  }

  complete() {
    this.completed = true;
  }

  reset() {
    this.completed = false;
    this.simTime = 0;
    this.clayColorShift = createClayColorShift();
    this.clickRipples.length = 0;
    this.trail0.fill(0);
    this.trail1.fill(0);

    // Seed agents near center (two nearby clusters to encourage “merge/split” feel).
    const cx = this.w * 0.5;
    const cy = this.h * 0.5;
    const r = Math.min(this.w, this.h) * 0.065;

    const seed = (i: number, ox: number, oy: number) => {
      const a = (i * 0.61803398875) % 1;
      const b = (i * 0.41421356237) % 1;
      const ang = a * Math.PI * 2;
      const rad = Math.sqrt(b) * r;
      this.agentsX[i] = cx + ox + Math.cos(ang) * rad;
      this.agentsY[i] = cy + oy + Math.sin(ang) * rad;
      this.agentsA[i] = ang;
    };

    this.agentCount = Math.min(this.agentCount, this.params.maxAgents);
    for (let i = 0; i < this.agentCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      seed(i, side * r * 0.6, 0);
    }

    this.renderToTexture({
      sub: 0,
      low: 0,
      mid: 0,
      melody: 0,
      high: 0,
      overall: 0,
      centroid: 0,
      bassFocus: 0,
      melodyFocus: 0,
      brightness: 0,
      contrast: 0,
    });
  }

  createExportGroup() {
    const exportGroup = new THREE.Group();
    exportGroup.name = "Amoeba Slime Mold";
    exportGroup.rotation.copy(this.group.rotation);
    exportGroup.scale.copy(this.group.scale);

    const plane = this.plane.clone();
    (plane.material as THREE.MeshBasicMaterial).map = this.tex.clone();
    plane.name = "Amoeba slime texture";
    exportGroup.add(plane);
    return exportGroup;
  }

  // --- Slime mold sim ---

  private stepAgents(kickBoost: number) {
    const sd = this.params.sensorDist;
    const sa = this.params.sensorAngle;
    const speed = this.params.speed;
    const turn = this.params.turnSpeed;
    const dep = this.params.deposit * kickBoost;
    const branchChance = this.params.branchChance;
    const branchAngle = this.params.branchAngle;
    const repel = this.params.repelTrail;

    for (let i = 0; i < this.agentCount; i += 1) {
      let x = this.agentsX[i];
      let y = this.agentsY[i];
      let a = this.agentsA[i];

      const f = this.sampleTrail(x + Math.cos(a) * sd, y + Math.sin(a) * sd);
      const l = this.sampleTrail(x + Math.cos(a - sa) * sd, y + Math.sin(a - sa) * sd);
      const r = this.sampleTrail(x + Math.cos(a + sa) * sd, y + Math.sin(a + sa) * sd);

      // Prefer trail, but also avoid over-traveled paths to encourage branching.
      const bf = f - f * f * repel;
      const bl = l - l * l * repel;
      const br = r - r * r * repel;

      if (bf >= bl && bf >= br) {
        // keep heading (slight jitter so tips can split)
        a += (this.randUnit(i, this.simTime) - 0.5) * 0.04;
      } else if (bl > br) {
        a -= turn;
      } else if (br > bl) {
        a += turn;
      } else {
        // random jitter to avoid deadlocks
        a += (this.randUnit(i * 3 + 17, this.simTime * 0.7) - 0.5) * turn * 2.2;
      }

      // Growth algorithm variants
      if (this.growthMode === "radial") {
        // Nudge outward from center to form radiating branches.
        const cx = this.w * 0.5;
        const cy = this.h * 0.5;
        const vx = x - cx;
        const vy = y - cy;
        const outAngle = Math.atan2(vy, vx);
        const da = Math.atan2(Math.sin(outAngle - a), Math.cos(outAngle - a));
        a += clamp01(Math.hypot(vx, vy) / (Math.min(this.w, this.h) * 0.5)) * da * 0.04;
      } else if (this.growthMode === "meander") {
        // Slow global flow to create wandering, river-like filaments.
        const flow =
          Math.sin(this.simTime * 0.13 + y * 0.012) * 0.4 +
          Math.cos(this.simTime * 0.09 + x * 0.015) * 0.3;
        a += flow * 0.02;
      }

      x += Math.cos(a) * speed;
      y += Math.sin(a) * speed;

      // wrap
      if (x < 0) x += this.w;
      if (x >= this.w) x -= this.w;
      if (y < 0) y += this.h;
      if (y >= this.h) y -= this.h;

      this.agentsX[i] = x;
      this.agentsY[i] = y;
      this.agentsA[i] = a;

      const ix = x | 0;
      const iy = y | 0;
      const idx = ix + iy * this.w;
      this.trail1[idx] = Math.min(1, this.trail1[idx] + dep * 0.08);

      // Occasionally fork a new agent from this tip.
      if (this.agentCount < this.params.maxAgents) {
        const p = branchChance * (0.7 + (1 - f) * 0.6);
        if (this.randUnit(i * 11 + 5, this.simTime * 0.33) < p) {
          const j = this.agentCount;
          this.agentCount += 1;
          this.agentsX[j] = x;
          this.agentsY[j] = y;
          const side = this.randUnit(i * 19 + 3, this.simTime) < 0.5 ? -1 : 1;
          this.agentsA[j] = a + side * branchAngle;
        }
      }
    }
  }

  private diffuseAndDecay(diffuse: number, decay: number) {
    // Simple 3x3 blur + decay (cheap and “粘菌っぽい”).
    const w = this.w;
    const h = this.h;
    const src = this.trail0;
    const dst = this.trail1;

    // Start dst from src (so agent deposits accumulate this step).
    // (trail1 already has deposits; we blend diffusion into it)
    for (let y = 0; y < h; y += 1) {
      const ym = y === 0 ? h - 1 : y - 1;
      const yp = y === h - 1 ? 0 : y + 1;
      for (let x = 0; x < w; x += 1) {
        const xm = x === 0 ? w - 1 : x - 1;
        const xp = x === w - 1 ? 0 : x + 1;

        const c = src[x + y * w];
        const sum =
          src[xm + ym * w] +
          src[x + ym * w] +
          src[xp + ym * w] +
          src[xm + y * w] +
          c +
          src[xp + y * w] +
          src[xm + yp * w] +
          src[x + yp * w] +
          src[xp + yp * w];
        const blur = sum / 9;

        const idx = x + y * w;
        const mixed = c + (blur - c) * diffuse;
        dst[idx] = clamp01((dst[idx] + mixed) * 0.5 * decay);
      }
    }
  }

  private swapTrail() {
    [this.trail0, this.trail1] = [this.trail1, this.trail0];
    // clear next buffer for deposits
    this.trail1.fill(0);
  }

  private spawnAgents(dt: number, bands: AudioBands, rhythm: RhythmEvents) {
    if (this.agentCount >= this.params.maxAgents) return;

    const drive = 0.35 + clamp01(bands.overall) * 0.65;
    const burst = rhythm.transient > 0 ? 1 + clamp01(rhythm.transient) * 2.0 : 1;
    const spawn = Math.floor(this.params.spawnPerSecond * dt * drive * burst);
    if (spawn <= 0) return;

    const cx = this.w * 0.5;
    const cy = this.h * 0.5;
    const baseR = Math.min(this.w, this.h) * (0.06 + clamp01(bands.low) * 0.06);

    for (let n = 0; n < spawn; n += 1) {
      if (this.agentCount >= this.params.maxAgents) break;
      const i = this.agentCount;
      this.agentCount += 1;

      const t = ((i * 0.754877666) % 1) * Math.PI * 2;
      const r = Math.sqrt(((i * 0.56984029) % 1)) * baseR;
      this.agentsX[i] = cx + Math.cos(t) * r;
      this.agentsY[i] = cy + Math.sin(t) * r;
      this.agentsA[i] = t + Math.PI * 0.5;
    }
  }

  private sampleTrail(x: number, y: number) {
    let ix = x | 0;
    let iy = y | 0;
    if (ix < 0) ix += this.w;
    if (ix >= this.w) ix -= this.w;
    if (iy < 0) iy += this.h;
    if (iy >= this.h) iy -= this.h;
    return this.trail0[ix + iy * this.w];
  }

  private randUnit(seed: number, salt: number) {
    const v = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  private renderToTexture(bands: AudioBands) {
    const data = this.imageData.data;
    const gain = this.params.gain * (0.7 + clamp01(bands.overall) * 0.6);
    const bg = this.params.bg;
    const levels = this.params.grainLevels;
    const threshold = this.params.grainThreshold;
    const hueBase = this.simTime * this.params.hueSpeed + this.clayColorShift.hue;
    const hueSpan = this.params.hueSpan;
    const sat = this.params.sat;
    const lightMin = this.params.lightMin;
    const lightMax = this.params.lightMax;
    const color = new THREE.Color();
    let hueAccum = 0;

    for (let i = 0; i < this.wh; i += 1) {
      // Grainy look: threshold + quantize (posterize) so it reads as “粒”.
      const raw = this.trail0[i] * gain;
      const shaped = clamp01((raw - threshold) * 1.35 + bg);
      if (shaped <= 0) {
        const p = i * 4;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
        continue;
      }
      const q = Math.floor(shaped * levels) / levels;
      // Dither only where there is slime (avoid noisy background).
      const dither = (this.randUnit(i, 1.7) - 0.5) * (1 / (levels * 2));
      const v = clamp01(q + dither);
      const p = i * 4;

      // Color: hue varies with position + intensity, so filaments become multi-colored.
      const x = i % this.w;
      const y = (i / this.w) | 0;
      const posHue = ((x / this.w) * 0.55 + (y / this.h) * 0.25) % 1;
      const hue = (hueBase + posHue * hueSpan + v * 0.18) % 1;
      const light = lightMin + (lightMax - lightMin) * v;
      color.setHSL(hue, sat, light);

      data[p] = (color.r * 255) | 0;
      data[p + 1] = (color.g * 255) | 0;
      data[p + 2] = (color.b * 255) | 0;
      data[p + 3] = (Math.min(1, v * 1.35) * 255) | 0;

      hueAccum += hue;
    }

    this.ctx.putImageData(this.imageData, 0, 0);
    this.tex.needsUpdate = true;

    // Subtle dynamic glow: brighter audio -> slightly stronger emission.
    this.glowMat.opacity = this.params.glow * (0.75 + clamp01(bands.brightness) * 0.6);
    // Pick a representative hue for glow tint (average over visible pixels).
    if (hueAccum > 0) {
      const avgHue = (hueAccum / Math.max(1, this.agentCount)) % 1;
      const glowColor = new THREE.Color().setHSL(avgHue, 0.85, 0.62);
      this.glowMat.color.copy(glowColor);
    }
  }

  // (consumeOrganBudget is kept as a constructor option for future organ-like controls.)
}

