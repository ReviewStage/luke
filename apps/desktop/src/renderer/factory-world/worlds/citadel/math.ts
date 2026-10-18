import { Euler, type Matrix4, Quaternion, Vector3 } from "three";

/**
 * math.ts -- the small arithmetic every part of the Citadel shares: easing, seeded noise, polar points, and one matrix composed from a place, a turn, and a size.
 *
 * Nothing here draws. Every random draw in the Citadel is seeded, by a
 * fixed number or by a zone's path, so the same snapshot builds the same
 * town every time it is opened, and nothing reads the clock.
 */

export const TAU = Math.PI * 2;

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Hermite smoothstep from `edge0` to `edge1`; the edges may run either way. */
export function smooth(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The signed turn from `to` to `from`, in (-π, π]. */
export function angleBetween(from: number, to: number): number {
  let turn = (from - to) % TAU;
  if (turn > Math.PI) turn -= TAU;
  if (turn <= -Math.PI) turn += TAU;
  return turn;
}

/** The yaw that turns a part's +z face outward at `angle` on the floor. */
export function facingOut(angle: number): number {
  return Math.PI / 2 - angle;
}

/** The point `radius` out at `angle`, as floor x and z. */
export function polar(radius: number, angle: number): readonly [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** A seeded generator in [0, 1): mulberry32. */
export function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from text: FNV-1a, so a zone's own path seeds its own town. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

/** Two integers hashed into [0, 1). */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise in [0, 1], `octaves` deep. */
export function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

const scratchEuler = new Euler();
const scratchQuaternion = new Quaternion();
const scratchPosition = new Vector3();
const scratchScale = new Vector3();

/** One part's matrix: placed at `x, y, z`, turned by `yaw` then `pitch` then `roll`, and sized `sx, sy, sz`. */
export function placed(
  out: Matrix4,
  x: number,
  y: number,
  z: number,
  yaw = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  pitch = 0,
  roll = 0,
): Matrix4 {
  scratchEuler.set(pitch, yaw, roll, "YXZ");
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchPosition.set(x, y, z);
  scratchScale.set(sx, sy, sz);
  return out.compose(scratchPosition, scratchQuaternion, scratchScale);
}
