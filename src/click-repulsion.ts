import type * as THREE from "three";

export type ClickRepulsionState = {
  offset: Float32Array;
  velocity: Float32Array;
};

export const createClickRepulsionState = (vertexCount: number): ClickRepulsionState => ({
  offset: new Float32Array(vertexCount),
  velocity: new Float32Array(vertexCount),
});

export const resetClickRepulsionState = (state: ClickRepulsionState) => {
  state.offset.fill(0);
  state.velocity.fill(0);
};

export const pokeClickRepulsion = (
  state: ClickRepulsionState,
  basePositions: Float32Array,
  localPoint: THREE.Vector3,
  strength = 0.11,
  radius = 0.48,
) => {
  const radiusSq = radius * radius;
  const count = state.velocity.length;
  const px = localPoint.x;
  const py = localPoint.y;
  const pz = localPoint.z;

  for (let i = 0; i < count; i += 1) {
    const idx = i * 3;
    const dx = basePositions[idx] - px;
    const dy = basePositions[idx + 1] - py;
    const dz = basePositions[idx + 2] - pz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) {
      continue;
    }
    const t = 1 - Math.sqrt(distSq / radiusSq);
    const falloff = t * t * (3 - 2 * t);
    state.velocity[i] += strength * falloff;
  }
};

export const updateClickRepulsion = (state: ClickRepulsionState, deltaTime: number) => {
  const restore = 48;
  const damping = 12;
  const count = state.offset.length;

  for (let i = 0; i < count; i += 1) {
    const accel = -state.offset[i] * restore - state.velocity[i] * damping;
    state.velocity[i] += accel * deltaTime;
    state.offset[i] += state.velocity[i] * deltaTime;
    if (Math.abs(state.offset[i]) < 1e-5 && Math.abs(state.velocity[i]) < 1e-5) {
      state.offset[i] = 0;
      state.velocity[i] = 0;
    }
  }
};

export const applyClickRepulsionToPositions = (
  state: ClickRepulsionState,
  basePositions: Float32Array,
  positions: ArrayLike<number>,
) => {
  const count = state.offset.length;

  for (let i = 0; i < count; i += 1) {
    const bump = state.offset[i];
    if (bump === 0) {
      continue;
    }
    const idx = i * 3;
    const x = basePositions[idx];
    const y = basePositions[idx + 1];
    const z = basePositions[idx + 2];
    const r = Math.hypot(x, y, z) || 1;
    (positions as Float32Array)[idx] += (x / r) * bump;
    (positions as Float32Array)[idx + 1] += (y / r) * bump;
    (positions as Float32Array)[idx + 2] += (z / r) * bump;
  }
};
