import {
  AdditiveBlending,
  type Color,
  DataTexture,
  FloatType,
  type InstancedMesh,
  type Material,
  Matrix4,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  Vector3,
} from "three";

/**
 * kit.ts -- the small tools every part of the planet shares: seeded randomness, noise in JavaScript and in GLSL, the frames things stand in on a sphere, and the zone-state texture the shaders read.
 *
 * Every random draw is seeded, by a constant or by an item's own id, so the
 * same snapshot draws the same planet on every open. Noise comes twice: a
 * Perlin noise in JavaScript, which shapes the crust once, and one cheap
 * value noise in GLSL, which every shader shares because each octave is paid
 * per pixel.
 *
 * The zone state is one small float texture the world writes and every
 * shader that draws a zone reads by the zone's index: how bright the blast
 * radius holds it and after how long a delay, how alive it is with shipped
 * work, whether it is chosen, and where its centre stands. It is built in
 * memory, never loaded, and is the one texture the world holds, because the
 * same reading as uniform arrays would pass what a fragment shader may hold.
 */

/** Columns in the zone-state texture: one per zone, at the contract's bound and past it. */
export const ZONE_TEXELS = 256;

/** The zone-state texture's rows. */
export const ZONE_ROW = {
  /** Blast level, blast delay in seconds, shipped glow, chosen. */
  STATE: 0,
  /** The zone's centre on the unit sphere, and its angular radius. */
  CENTRE: 1,
} as const;

/** How long the blast radius takes to reach one more dependency away, in seconds. */
export const BLAST_STEP_SECONDS = 0.35;

/** A blast clock far past every delay, for a still frame. */
export const BLAST_SETTLED = 1e4;

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

export function smooth(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** A hash of `n` into [0, 1). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A string hashed into an unsigned 32-bit seed: FNV-1a. */
export function seedOf(text: string): number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return seed;
}

/** A seeded generator of [0, 1): mulberry32. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERMUTATION = (() => {
  const draw = rng(1337);
  const order = Array.from({ length: 256 }, (_, index) => index);
  for (let index = 255; index > 0; index -= 1) {
    const other = Math.floor(draw() * (index + 1));
    [order[index], order[other]] = [order[other] ?? 0, order[index] ?? 0];
  }
  const table = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) table[index] = order[index & 255] ?? 0;
  return table;
})();

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function gradient(hashed: number, x: number, y: number, z: number): number {
  const h = hashed & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Perlin noise in three dimensions, in about [-1, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const X = fx & 255;
  const Y = fy & 255;
  const Z = fz & 255;
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  const u = fade(dx);
  const v = fade(dy);
  const w = fade(dz);
  const P = (index: number) => PERMUTATION[index] ?? 0;
  const A = P(X) + Y;
  const AA = P(A) + Z;
  const AB = P(A + 1) + Z;
  const B = P(X + 1) + Y;
  const BA = P(B) + Z;
  const BB = P(B + 1) + Z;
  const near = mix(
    mix(gradient(P(AA), dx, dy, dz), gradient(P(BA), dx - 1, dy, dz), u),
    mix(gradient(P(AB), dx, dy - 1, dz), gradient(P(BB), dx - 1, dy - 1, dz), u),
    v,
  );
  const far = mix(
    mix(gradient(P(AA + 1), dx, dy, dz - 1), gradient(P(BA + 1), dx - 1, dy, dz - 1), u),
    mix(gradient(P(AB + 1), dx, dy - 1, dz - 1), gradient(P(BB + 1), dx - 1, dy - 1, dz - 1), u),
    v,
  );
  return mix(near, far, w);
}

/** The value noise and four-octave fbm every shader shares. */
export const GLSL_NOISE = /* glsl */ `
float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

/** Appended to a shader's colour, so it is tone-mapped and encoded as the built-in materials are. */
export const GLSL_OUTPUT = "\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n";

/** The cutaway: the octant facing the establishing shot is opened to the core. */
export const GLSL_OCTANT = "if (vLocal.x > 0.0 && vLocal.y > 0.0 && vLocal.z > 0.0) discard;";

/** Reads one zone's state and centre from the zone-state texture, and its blast level at `uBlastT`. */
export const GLSL_ZONE = /* glsl */ `
uniform sampler2D uZones; uniform float uBlastT;
vec4 zoneState(int zone){ return texelFetch(uZones, ivec2(zone, ${ZONE_ROW.STATE}), 0); }
vec4 zoneCentre(int zone){ return texelFetch(uZones, ivec2(zone, ${ZONE_ROW.CENTRE}), 0); }
float zoneBlast(vec4 s){ return s.x * smoothstep(s.y, s.y + 0.45, uBlastT); }
`;

/** The uniforms every shader reads: the clock, the sun, the zone state, the blast clock, the screen, and the signals. */
export type SharedUniforms = {
  readonly uTime: { value: number };
  readonly uSunDir: { value: Vector3 };
  readonly uZones: { value: Texture };
  readonly uBlastT: { value: number };
  /** Device pixels per CSS pixel, which a point's size is drawn in. */
  readonly uPixelRatio: { value: number };
  /** Pixels per scene unit at unit distance: the drawing buffer's height over the field of view. */
  readonly uProjection: { value: number };
  /** One in the window's dark appearance, zero in its light one. */
  readonly uDark: { value: number };
  /** Whether defects are drawn, one or zero. */
  readonly uDefects: { value: number };
  readonly uPlanned: { value: Color };
  readonly uBuilding: { value: Color };
  readonly uShipped: { value: Color };
  readonly uDefect: { value: Color };
  readonly uBlast: { value: Color };
  readonly uChosen: { value: Color };
};

/** The zone-state texture, and the floats it is written through. */
export function zoneStateTexture() {
  const data = new Float32Array(ZONE_TEXELS * 2 * 4);
  const texture = new DataTexture(data, ZONE_TEXELS, 2, RGBAFormat, FloatType);
  texture.needsUpdate = true;
  return { texture, data };
}

/** Two tangents perpendicular to `up` and to each other. */
export function tangentBasis(up: Vector3): [Vector3, Vector3] {
  const reference = Math.abs(up.y) < 0.95 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const first = new Vector3().crossVectors(reference, up).normalize();
  const second = new Vector3().crossVectors(up, first).normalize();
  return [first, second];
}

/** `direction` tipped `angle` radians away from itself, toward `azimuth` around it. */
export function rotateToward(direction: Vector3, angle: number, azimuth: number): Vector3 {
  const [first, second] = tangentBasis(direction);
  const off = first.multiplyScalar(Math.cos(azimuth)).add(second.multiplyScalar(Math.sin(azimuth)));
  return direction
    .clone()
    .multiplyScalar(Math.cos(angle))
    .add(off.multiplyScalar(Math.sin(angle)))
    .normalize();
}

const frameX = new Vector3();
const frameZ = new Vector3();
const frameScale = new Vector3();

/** A frame standing at `position`, its y along `up` and facing `forward`, scaled by `scale`. */
export function frameMatrix(
  out: Matrix4,
  position: Vector3,
  up: Vector3,
  forward: Vector3,
  scale: number,
): Matrix4 {
  frameX.crossVectors(up, forward).normalize();
  frameZ.crossVectors(frameX, up).normalize();
  return out
    .makeBasis(frameX, up, frameZ)
    .scale(frameScale.set(scale, scale, scale))
    .setPosition(position);
}

/** The matrix that hides an instance. */
export const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Marks an instanced mesh's matrices, and its colours where it has them, for upload. */
export function flush(mesh: InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
}

/**
 * A soft round glow that faces the camera, for the sun and lamps: a quad
 * turned to the camera in its vertex shader, so no texture is drawn or
 * loaded for it.
 */
export function glowMaterial(color: Vector3, size: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: color }, uSize: { value: size } },
    vertexShader: /* glsl */ `
      uniform float uSize; varying vec2 vUv;
      void main(){ vUv = uv - 0.5; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec2 vUv;
      void main(){ float d = length(vUv) * 2.0; float a = exp(-d * d * 7.0) + 0.35 * exp(-d * 3.2);
        gl_FragColor = vec4(uColor * a * smoothstep(1.0, 0.7, d), 1.0); ${GLSL_OUTPUT} }`,
  });
}

/**
 * Lets a standard material glow per instance: each instance's `aGlow`
 * (a colour times its strength) is added to what it emits, which is how a
 * zone or an agent is lit in the blast radius's or the selection's colour
 * without a material of its own.
 */
export function withInstanceGlow<M extends Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;",
      );
  };
  return material;
}
