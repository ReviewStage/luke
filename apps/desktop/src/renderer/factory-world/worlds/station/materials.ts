import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  Color,
  type ColorRepresentation,
  DataTexture,
  DoubleSide,
  FloatType,
  MeshStandardMaterial,
  NearestFilter,
  NormalBlending,
  type Object3D,
  RGBAFormat,
  ShaderMaterial,
  type ShaderMaterialParameters,
  Vector2,
} from "three";
import { foilTexture, hullTextures, radiatorTexture, solarTexture } from "./textures";

/**
 * materials.ts -- what the station is made of: its hull, frame, foil, cells, fins and glass, and the four materials that light each zone on its own from one merged mesh, its windows, its accent seams, its glow shell, and the conduits between zones.
 *
 * The station merges every zone's parts into one mesh per material
 * (`kit.ts`'s `Parts`), so a zone is told apart by its `aZone` vertex
 * attribute alone. `ZoneSignals` is a small float texture, one column per
 * zone, that `update` writes and the zone materials read in their vertex
 * shaders: how many windows are lit and how bright, the accent seams'
 * colour, the glow shell's colour and strength, and the blast radius's
 * distance. Writing a texel is how a zone lights up; nothing is rebuilt.
 *
 * Every shader here ends in three's tone mapping and colour space chunks,
 * so a signal drawn unlit lands on screen as the palette's own colour, the
 * same as a standard material's.
 */

/** The rows of the zone texture, each four floats per zone. */
const ZONE_ROW = {
  /** Lit windows' share, their brightness, the glow's strength, and the blast radius's distance (-1 outside it). */
  LIGHT: 0,
  /** The glow's colour, and how it is drawn (`GLOW_MODE`). */
  GLOW: 1,
  /** The accent seams' colour, and their brightness. */
  ACCENT: 2,
  /** The windows' tint. */
  TINT: 3,
} as const;

const ZONE_ROWS = 4;

/** How a zone's glow shell is drawn. */
export const GLOW_MODE = {
  /** At its strength, or as the blast radius cascades through it. */
  STEADY: 0,
  /** Pulsing, as a damaged zone's alarm does. */
  PULSE: 1,
  /** At its strength whatever the blast radius says: what the developer selected or hovers. */
  CHOSEN: 2,
} as const;

export type GlowMode = (typeof GLOW_MODE)[keyof typeof GLOW_MODE];

/** The uniforms every animated station material shares. */
export interface StationUniforms {
  /** Seconds the world has run, the clock every idle motion reads; held where motion is still. */
  readonly uTime: { value: number };
  /** Seconds since the selected agent's blast radius began to cascade. */
  readonly uBlastTime: { value: number };
  /** 1 while motion runs; 0 holds every shader at a still frame that says the same. */
  readonly uMotion: { value: number };
  readonly uZones: { value: DataTexture };
  readonly uBlastColor: { value: Color };
  /** 1 in the window's light appearance, where an effect is laid over the ground rather than added to it. */
  readonly uLight: { value: number };
}

/** What every effect shader reads beside its own: the pixel scale halos are sized by, and the appearance. */
export interface EffectUniforms {
  readonly viewport: { value: number };
  readonly light: { value: number };
}

/** The GLSL that reads one zone's row, for a vertex shader. */
const ZONE_READ = /* glsl */ `
uniform sampler2D uZones;
attribute float aZone;
vec4 zoneRow(float zone, int row) {
  if (zone < -0.5) return vec4(0.0, 0.0, 0.0, -1.0);
  return texelFetch(uZones, ivec2(int(zone + 0.5), row), 0);
}
`;

/** What ends every shader here, so its colour reads as a standard material's does. */
const OUTPUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

/**
 * The end of an effect's shader. On a dark ground an effect is light added
 * to what is behind it; on a light ground added light would not show, so
 * the same colour is laid over the ground instead, as opaque as it was
 * bright (`setAppearance` switches the blending to match).
 */
const EFFECT_OUTPUT = /* glsl */ `
{
  float strength = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
  if (uLight > 0.5) gl_FragColor = vec4(gl_FragColor.rgb / max(strength, 1e-4), clamp(strength * 1.8, 0.0, 1.0));
}
${OUTPUT}
`;

/** Where an effect's fragment shader ends: `effectMaterial` puts its output there. */
export const EFFECT = "/* effect output */";

/** The glow's strength in a vertex shader: steady, pulsing, chosen, or cascading out with the blast radius. */
const GLOW_OF = /* glsl */ `
uniform float uTime, uBlastTime, uMotion;
float glowOf(vec4 light, vec4 glow) {
  float strength = light.z;
  float distance = light.w;
  if (glow.a > 1.5) return strength;
  if (glow.a > 0.5) return strength * mix(1.0, 0.6 + 0.4 * sin(uTime * 3.2), uMotion);
  if (distance > 0.5) {
    // Note that each step away from the change lights later, so the alarm visibly cascades outward.
    float phase = uBlastTime * 1.6 - distance * 0.55;
    float wave = phase < 0.0 ? 0.0
      : pow(max(0.0, sin(phase * 2.6)), 3.0) * exp(-0.15 * distance) * 0.7 + 0.14 * min(1.0, phase);
    return mix(0.45 * exp(-0.15 * distance) + 0.14, wave, uMotion);
  }
  if (distance > -0.5) return 0.95 + sin(uTime * 5.0) * 0.25 * uMotion;
  return strength;
}
`;

/** Each zone's signals, written by the world and read by the zone materials. */
export class ZoneSignals {
  readonly texture: DataTexture;
  readonly #data: Float32Array;

  constructor() {
    this.#data = new Float32Array(FACTORY_WORLD_BOUNDS.MAX_ZONES * ZONE_ROWS * 4);
    this.texture = new DataTexture(
      this.#data,
      FACTORY_WORLD_BOUNDS.MAX_ZONES,
      ZONE_ROWS,
      RGBAFormat,
      FloatType,
    );
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.needsUpdate = true;
  }

  #write(zone: number, row: number, values: readonly [number, number, number, number]): void {
    this.#data.set(values, (row * FACTORY_WORLD_BOUNDS.MAX_ZONES + zone) * 4);
  }

  /** How many of the zone's windows are lit, how brightly, and its blast radius distance, -1 outside it. */
  setLight(zone: number, lit: number, boost: number, distance: number): void {
    const glow = this.#data[(ZONE_ROW.LIGHT * FACTORY_WORLD_BOUNDS.MAX_ZONES + zone) * 4 + 2] ?? 0;
    this.#write(zone, ZONE_ROW.LIGHT, [lit, boost, glow, distance]);
  }

  /** The zone's glow shell: its colour, strength, and how it is drawn. */
  setGlow(zone: number, color: Color, strength: number, mode: GlowMode): void {
    const at = (ZONE_ROW.LIGHT * FACTORY_WORLD_BOUNDS.MAX_ZONES + zone) * 4 + 2;
    this.#data[at] = strength;
    this.#write(zone, ZONE_ROW.GLOW, [color.r, color.g, color.b, mode]);
  }

  setAccent(zone: number, color: Color, intensity: number): void {
    this.#write(zone, ZONE_ROW.ACCENT, [color.r, color.g, color.b, intensity]);
  }

  setTint(zone: number, color: Color): void {
    this.#write(zone, ZONE_ROW.TINT, [color.r, color.g, color.b, 0]);
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }
}

export function stationUniforms(signals: ZoneSignals, blast: ColorRepresentation): StationUniforms {
  return {
    uTime: { value: 0 },
    uBlastTime: { value: 0 },
    uMotion: { value: 1 },
    uZones: { value: signals.texture },
    uBlastColor: { value: new Color(blast) },
    uLight: { value: 0 },
  };
}

/** An effect: light added on a dark ground, laid over a light one, its fragment shader's output put where it says `EFFECT`. */
export function effectMaterial(
  parameters: ShaderMaterialParameters & { readonly fragmentShader: string },
  light: { value: number },
): ShaderMaterial {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    ...parameters,
    uniforms: { ...parameters.uniforms, uLight: light },
    fragmentShader: `uniform float uLight;\n${parameters.fragmentShader.replace(EFFECT, EFFECT_OUTPUT)}`,
  });
  material.userData.effect = true;
  return material;
}

/** Switches every effect under `root` to add its light on a dark ground, or lay its colour over a light one. */
export function setAppearance(root: Object3D, dark: boolean): void {
  root.traverse((object) => {
    if (!("material" in object)) return;
    const material = object.material;
    if (material instanceof ShaderMaterial && material.userData.effect === true) {
      material.blending = dark ? AdditiveBlending : NormalBlending;
    }
  });
}

/** A hull band whose windows each zone lights from its own texel: how many, how bright, and in what tint. */
function windowMaterial(uniforms: StationUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x252b33, roughness: 0.25, metalness: 0.7 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uZones: uniforms.uZones, uTime: uniforms.uTime });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${ZONE_READ}
varying vec2 vWindowUv; varying float vLit, vBoost, vSeed; varying vec3 vTint;`,
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
vWindowUv = uv * 6.0;
vec4 zoneLight = zoneRow(aZone, ${ZONE_ROW.LIGHT});
vLit = zoneLight.x; vBoost = zoneLight.y; vSeed = aZone * 7.31 + 3.0;
vTint = zoneRow(aZone, ${ZONE_ROW.TINT}).rgb;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
varying vec2 vWindowUv; varying float vLit, vBoost, vSeed; varying vec3 vTint;
float windowHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec2 grid = vWindowUv * vec2(1.0 / 0.85, 1.0 / 0.62);
  vec2 cell = floor(grid), at = fract(grid);
  float pane = step(0.2, at.x) * step(at.x, 0.8) * step(0.24, at.y) * step(at.y, 0.76);
  float chance = windowHash(cell + vSeed);
  float lit = step(chance, vLit);
  float flicker = 0.8 + 0.2 * sin(uTime * (0.6 + chance * 2.5) + chance * 50.0);
  vec3 light = mix(vec3(1.0, 0.74, 0.42), vec3(0.62, 0.86, 1.0), step(0.62, windowHash(cell + 7.7)));
  light = mix(light, vTint, 0.25);
  totalEmissiveRadiance += light * pane * lit * flicker * vBoost * 1.05;
  diffuseColor.rgb *= mix(1.0, 0.35, pane);
}`,
      );
  };
  material.customProgramCacheKey = () => "station-window";
  return material;
}

/** The glowing seams at a zone's collars and corridors, in its accent: its layer's, or the signal it carries. */
function accentMaterial(uniforms: StationUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uZones: uniforms.uZones });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${ZONE_READ}\nvarying vec4 vAccent;`)
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvAccent = zoneRow(aZone, ${ZONE_ROW.ACCENT});\nif (aZone < -0.5) vAccent = vec4(0.81, 0.91, 1.0, 1.4);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vAccent;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance = vAccent.rgb * vAccent.a;",
      );
  };
  material.customProgramCacheKey = () => "station-accent";
  return material;
}

/** A fresnel shell around each zone, lit in the zone's glow colour, and collapsed away where it has none. */
function glowMaterial(uniforms: StationUniforms): ShaderMaterial {
  return effectMaterial(
    {
      uniforms: {
        uZones: uniforms.uZones,
        uTime: uniforms.uTime,
        uBlastTime: uniforms.uBlastTime,
        uMotion: uniforms.uMotion,
      },
      vertexShader: /* glsl */ `
${ZONE_READ}
${GLOW_OF}
varying vec3 vNormal; varying vec3 vView; varying vec3 vColor; varying float vGlow;
void main() {
  vec4 light = zoneRow(aZone, ${ZONE_ROW.LIGHT});
  vec4 glow = zoneRow(aZone, ${ZONE_ROW.GLOW});
  vGlow = glowOf(light, glow);
  vColor = glow.rgb;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -view.xyz;
  gl_Position = projectionMatrix * view;
  // Note that a zone with no glow is folded out of the clip volume, so its shell costs no fragments.
  if (vGlow < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
varying vec3 vNormal; varying vec3 vView; varying vec3 vColor; varying float vGlow;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
  gl_FragColor = vec4(vColor * (rim * 1.25 + 0.025) * vGlow, 1.0);
  ${EFFECT}
}`,
      side: DoubleSide,
    },
    uniforms.uLight,
  );
}

/** The conduits between zones: dark until the selected agent's blast radius runs through them, from what it changed to what depends on it. */
function conduitMaterial(uniforms: StationUniforms): ShaderMaterial {
  return effectMaterial(
    {
      uniforms: {
        uZones: uniforms.uZones,
        uTime: uniforms.uTime,
        uMotion: uniforms.uMotion,
        uBlastColor: uniforms.uBlastColor,
      },
      vertexShader: /* glsl */ `
uniform sampler2D uZones;
attribute float aFrom; attribute float aTo; attribute float aLength;
varying vec2 vUv; varying float vLength;
void main() {
  float from = texelFetch(uZones, ivec2(int(aFrom + 0.5), ${ZONE_ROW.LIGHT}), 0).w;
  float to = texelFetch(uZones, ivec2(int(aTo + 0.5), ${ZONE_ROW.LIGHT}), 0).w;
  vUv = uv; vLength = aLength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Note that a conduit lights only where the blast steps from a zone to one a step further out.
  if (to < -0.5 || abs(from - to - 1.0) > 0.1) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform float uTime, uMotion; uniform vec3 uBlastColor;
varying vec2 vUv; varying float vLength;
void main() {
  float x = vUv.x * vLength;
  float phase = fract(x / 7.0 - uTime * 0.5);
  float pulse = mix(0.6, smoothstep(0.0, 0.05, phase) * smoothstep(0.35, 0.05, phase) * 1.8, uMotion);
  float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float ends = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
  gl_FragColor = vec4(uBlastColor * (0.12 + pulse) * (0.4 + core) * 2.4 * ends, 1.0);
  ${EFFECT}
}`,
    },
    uniforms.uLight,
  );
}

/** A soft round glow per point, sized in scene units and shrinking with distance: the halos, sparks, and trails. */
export function haloMaterial(strength: number, effects: EffectUniforms): ShaderMaterial {
  return effectMaterial(
    {
      uniforms: { uScale: effects.viewport, uStrength: { value: strength } },
      vertexShader: /* glsl */ `
attribute float size; attribute vec3 color;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(size * uScale / -view.z, 64.0);
  gl_Position = projectionMatrix * view;
}`,
      fragmentShader: /* glsl */ `
uniform float uStrength;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vColor * exp(-d * d * 28.0) * uStrength, 1.0);
  ${EFFECT}
}`,
    },
    effects.light,
  );
}

/** Everything the station is built of. */
export interface StationMaterials {
  readonly hull: MeshStandardMaterial;
  readonly dark: MeshStandardMaterial;
  readonly foil: MeshStandardMaterial;
  readonly solar: MeshStandardMaterial;
  readonly radiator: MeshStandardMaterial;
  readonly glass: MeshStandardMaterial;
  readonly white: MeshStandardMaterial;
  readonly window: MeshStandardMaterial;
  readonly accent: MeshStandardMaterial;
  readonly glow: ShaderMaterial;
  readonly conduit: ShaderMaterial;
}

export function stationMaterials(uniforms: StationUniforms): StationMaterials {
  const hull = hullTextures();
  const glass = new MeshStandardMaterial({
    color: 0x0c1824,
    roughness: 0.04,
    metalness: 1,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.6,
  });
  glass.userData.noShadow = true;
  return {
    hull: new MeshStandardMaterial({
      map: hull.map,
      normalMap: hull.normal,
      normalScale: new Vector2(0.7, 0.7),
      roughnessMap: hull.roughness,
      roughness: 0.85,
      metalness: 0.28,
    }),
    dark: new MeshStandardMaterial({
      color: 0x3c434c,
      roughness: 0.45,
      metalness: 0.75,
      map: hull.map,
    }),
    foil: new MeshStandardMaterial({
      map: foilTexture(),
      color: 0xffe0a0,
      roughness: 0.32,
      metalness: 1,
    }),
    solar: new MeshStandardMaterial({
      map: solarTexture(),
      roughness: 0.22,
      metalness: 0.65,
      emissive: 0x0a1a40,
      emissiveIntensity: 0.25,
    }),
    radiator: new MeshStandardMaterial({ map: radiatorTexture(), roughness: 0.5, metalness: 0.1 }),
    glass,
    white: new MeshStandardMaterial({
      color: 0xe9edf2,
      roughness: 0.55,
      metalness: 0.1,
      side: DoubleSide,
    }),
    window: windowMaterial(uniforms),
    accent: accentMaterial(uniforms),
    glow: glowMaterial(uniforms),
    conduit: conduitMaterial(uniforms),
  };
}

/** The tone mapping and colour space chunks a shader here ends in, for the other modules' shaders. */
export const SHADER_OUTPUT = OUTPUT;
