import { Color, DataTexture, FloatType, NearestFilter, RGBAFormat } from "three";

/**
 * glsl.ts -- what every Neon Megacity shader shares: hashes and noise, the night's fog, the per-zone state texture the buildings read, and the tone-mapped output line.
 *
 * Every material here is a `ShaderMaterial`, so each ends its fragment
 * shader on `OUTPUT_GLSL`, which tone-maps and encodes the colour the way the
 * host's renderer does for its built-in materials; without it the neon
 * would land on the canvas in linear light, unmapped. The fog is the city's
 * own (`applyFog`): denser near the ground and thinner up the towers, the
 * colour of the sky's horizon, and switched to a pale smog when the window
 * is light.
 *
 * Each zone's state lives in one row-per-reading float texture
 * (`zoneState`), one texel per zone slot, so a building reads its
 * zone's glow, damage, and blast radius by index in its vertex shader and a
 * redraw writes a few hundred floats rather than touching a material.
 */

/** Zone slots in the state texture: one per zone the contract allows, and the last for the filler city between them. */
const ZONE_SLOTS = 201;

/** The slot every building that belongs to no zone reads. */
export const FILL_SLOT = ZONE_SLOTS - 1;

/** The state texture's rows: what one zone holds, four floats a row. */
export const ZONE_ROW = {
  /** Shipped glow, damage, growth, lightning flash. */
  GLOW: 0,
  /** Blast level, the instant the ripple arrives, selection, whether touched. */
  BLAST: 1,
  /** The merge flash of a ship event. */
  FLASH: 2,
} as const;

const ZONE_ROWS = 3;

/** Hashes and value noise. */
const NOISE_GLSL = /* glsl */ `
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/** The city's fog: exponential-squared with distance, and a low ground haze. */
const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogDensity; uniform float uHaze;
float fogF(float d){ return clamp(1.0 - exp(-pow(uFogDensity * d, 2.0)), 0.0, 1.0); }
vec3 applyFog(vec3 c, float d, float y){
  float f = fogF(d);
  f = max(f, (1.0 - exp(-d * 0.0035)) * exp(-max(y, 0.0) * 0.06) * uHaze);
  return mix(c, uFogColor, f);
}
`;

/** Both, as most fragment shaders want them. */
export const COMMON_GLSL = NOISE_GLSL + FOG_GLSL;

/** The zone state reads, for a vertex shader. */
export const ZONE_STATE_GLSL = /* glsl */ `
uniform sampler2D uZones;
vec4 zoneRow(float slot, int row){ return texelFetch(uZones, ivec2(int(slot + 0.5), row), 0); }
`;

/** The last lines of every fragment shader: tone-mapped and encoded as the renderer's own materials are. */
export const OUTPUT_GLSL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

/** The uniforms every material shares by reference, so one write reaches them all. */
export interface SharedUniforms {
  readonly uTime: { value: number };
  readonly uFogColor: { value: Color };
  readonly uFogDensity: { value: number };
  /** How thick the haze lies along the ground. */
  readonly uHaze: { value: number };
  /** 0 at night, 1 in the window's light appearance. */
  readonly uDay: { value: number };
  /** How far the world is dimmed behind a selected agent's blast radius, 0 to 1. */
  readonly uFocus: { value: number };
}

export function sharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uFogColor: { value: new Color() },
    uFogDensity: { value: 0.0016 },
    uHaze: { value: 0.55 },
    uDay: { value: 0 },
    uFocus: { value: 0 },
  };
}

/** The zone state texture and the floats behind it. */
export interface ZoneState {
  readonly texture: DataTexture;
  readonly data: Float32Array;
}

/** The zone state texture, every slot at rest: no glow, no damage, full growth, no blast. */
export function zoneState(): ZoneState {
  const data = new Float32Array(ZONE_SLOTS * ZONE_ROWS * 4);
  const texture = new DataTexture(data, ZONE_SLOTS, ZONE_ROWS, RGBAFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  const state = { texture, data };
  resetZoneState(state);
  return state;
}

/** Puts every slot back at rest. */
export function resetZoneState({ texture, data }: ZoneState): void {
  data.fill(0);
  for (let slot = 0; slot < ZONE_SLOTS; slot += 1) {
    data[zoneTexel(slot, ZONE_ROW.GLOW) + 2] = 1;
    data[zoneTexel(slot, ZONE_ROW.BLAST) + 1] = -1000;
  }
  texture.needsUpdate = true;
}

/** Where slot `slot`'s row `row` starts in the state texture's data. */
export function zoneTexel(slot: number, row: number): number {
  return (row * ZONE_SLOTS + slot) * 4;
}
