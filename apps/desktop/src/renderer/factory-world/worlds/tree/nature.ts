import { type BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from "three";

/**
 * nature.ts -- the World Tree's shared ground rules: seeded randomness, value noise, the island's ragged outline and its meadow's height, and the GLSL the tree's shaders share.
 *
 * Every random draw in the tree is seeded from what it draws (a zone's path,
 * an agent's id, a pull request's number), never from a sequence shared
 * across them, so the same zone grows the same branch however the zones
 * around it come and go.
 */

/** The meadow's radius, in scene units, before its ragged edge. */
export const ISLAND_RADIUS = 24;

/** How far the island's earth hangs below the meadow. */
export const ISLAND_DEPTH = 21;

export const UP = new Vector3(0, 1, 0);

/**
 * How thick the dusk air is. Note that it is thicker than the mockup's, whose
 * bloom pass hazed the bright sky over the crown: the extra air gives the same
 * soft, warm haze with no pass.
 */
export const AIR_DENSITY = 0.0034;

/** Where the low sun stands: the tree's warm side and its shadows. */
export const SUN_DIRECTION = new Vector3(-0.78, 0.32, 0.54).normalize();

/** A seeded draw in [0, 1). */
export type Random = () => number;

/** Mulberry32: small, fast, and well spread for scenery. */
export function randomOf(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A draw in [low, high). */
export function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

/** FNV-1a over `text`, mixed with `salt`: the seed of whatever `text` names. */
export function seedOf(text: string, salt = 0): number {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

/** Hermite step from `low` to `high`, as GLSL's `smoothstep`. */
export function smooth(low: number, high: number, x: number): number {
  const t = MathUtils.clamp((x - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Value noise in [0, 1], smooth across integer cells. */
export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const lerp = MathUtils.lerp;
  const near = lerp(
    lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
    lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u),
    v,
  );
  const far = lerp(
    lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
    lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u),
    v,
  );
  return lerp(near, far, w);
}

/** Three octaves of value noise. */
export function fractalNoise(x: number, y: number, z: number): number {
  return (
    valueNoise(x, y, z) * 0.55 +
    valueNoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 +
    valueNoise(x * 4.3, y * 4.3, z * 4.3) * 0.15
  );
}

/** The island's ragged rim at angle `theta`. */
export function edgeRadius(theta: number): number {
  const wobble = fractalNoise(Math.cos(theta) * 1.6 + 3, Math.sin(theta) * 1.6 + 3, 0.5) - 0.5;
  return ISLAND_RADIUS * (1 + 0.07 * wobble * 2);
}

/** The meadow's height at `(x, z)`: a low dome, rolling, falling away at the rim. */
export function groundY(x: number, z: number): number {
  const k = MathUtils.clamp(Math.hypot(x, z) / edgeRadius(Math.atan2(z, x)), 0, 1);
  const roll = (fractalNoise(x * 0.12, 0, z * 0.12) - 0.5) * 0.9 * (1 - k * 0.6);
  return 0.9 * (1 - k * k) + roll - 0.15 * k ** 4;
}

/** A point on the meadow at polar `(rho, theta)`, `lift` above the grass. */
export function meadowPoint(rho: number, theta: number, lift = 0): Vector3 {
  const x = Math.cos(theta) * rho;
  const z = Math.sin(theta) * rho;
  return new Vector3(x, groundY(x, z) + lift, z);
}

/** GLSL: sRGB to linear, a hash, and value noise, for every shader the tree writes. */
export const GLSL_NOISE = /* glsl */ `
  vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
  float h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vn3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
`;

/** Paints `geometry` one colour, as a vertex colour and without its uvs, so differently coloured parts merge into one mesh. */
export function painted(geometry: BufferGeometry, hex: string): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  const tint = new Color(hex);
  const count = flat.getAttribute("position").count;
  const color = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) color.set([tint.r, tint.g, tint.b], index * 3);
  flat.setAttribute("color", new Float32BufferAttribute(color, 3));
  if (flat.hasAttribute("uv")) flat.deleteAttribute("uv");
  return flat;
}
