import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  Color,
  DataTexture,
  FloatType,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
} from "three";
import type { WorldPalette } from "../../world";
import { GLSL_OUTPUT } from "./mood";

/**
 * zone-light.ts -- how a zone lights up: one texel per zone holding its blast distance, how alive it is with merges, whether it is chosen, and how damaged, read by every material drawn over the islands.
 *
 * The islands, their props, their rim lanterns, and the bridges between
 * them are each one merged mesh across the whole archipelago, so a hover
 * never rebuilds one: `update` rewrites the zone's texel, and the shaders
 * read it by the `zone` attribute every vertex carries. A selected or
 * hovered zone glows the selection's colour, a zone in the blast radius the
 * blast's, rippling outward by distance while motion runs and graded by it
 * when held still, and a zone's windows burn brighter the more alive it is.
 */

/** What one zone's texel says. */
export interface ZoneLight {
  /** Steps from what the selected agent touched, or undefined outside its blast radius. */
  readonly blast: number | undefined;
  /** How alive it is with merges, zero with the shipped layer off. */
  readonly alive: number;
  /** Whether it is selected, hovered, or neither. */
  readonly chosen: Chosen;
  /** How damaged, zero with the defects layer off. */
  readonly damage: number;
}

export const CHOSEN = {
  NONE: 0,
  HOVERED: 0.5,
  SELECTED: 1,
} as const;

export type Chosen = (typeof CHOSEN)[keyof typeof CHOSEN];

/** The uniforms every zone-lit material shares. */
export interface ZoneUniforms {
  readonly uZones: { value: DataTexture };
  readonly uTime: { value: number };
  readonly uStill: { value: number };
  readonly uGlowGain: { value: number };
  readonly uBlast: { value: Color };
  readonly uSelect: { value: Color };
  readonly uShipped: { value: Color };
  readonly uDefect: { value: Color };
}

/** The texel read, by a vertex's `zone`, in every zone-lit vertex shader. */
const GLSL_ZONE = /* glsl */ `
  attribute float zone;
  uniform sampler2D uZones;
  uniform float uTime, uStill, uGlowGain;
  uniform vec3 uBlast, uSelect, uShipped, uDefect;
  vec4 zoneState(){ return texelFetch(uZones, ivec2(int(zone + 0.5), 0), 0); }
  vec3 zoneHighlight(vec4 zs){
    float pulse = (0.5 + 0.5 * sin(uTime * 3.)) * (1. - uStill);
    if (zs.z > 0.75) return uSelect * (0.6 + 0.2 * pulse);
    if (zs.z > 0.25) return uSelect * 0.35;
    if (zs.x < 0.5) return vec3(0.);
    float d = zs.x - 1.;
    if (d < 0.5) return uBlast * (0.6 + 0.2 * pulse);
    float ripple = mix(0.18 + 0.32 * max(0., sin(uTime * 3. - d * 1.1)), max(0.18, 0.45 - d * 0.06), uStill);
    return uBlast * ripple;
  }
`;

/** The zone texture and the uniforms over it, the signals in `palette`'s colours, on the sky's clock and its glow. */
export function zoneUniformsOf(
  palette: WorldPalette,
  shared: { readonly time: { value: number }; readonly glow: { value: number } },
): ZoneUniforms {
  const texture = new DataTexture(
    new Float32Array(FACTORY_WORLD_BOUNDS.MAX_ZONES * 4),
    FACTORY_WORLD_BOUNDS.MAX_ZONES,
    1,
    RGBAFormat,
    FloatType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return {
    uZones: { value: texture },
    uTime: shared.time,
    uStill: { value: 0 },
    uGlowGain: shared.glow,
    uBlast: { value: new Color(palette.signal.BLAST_RADIUS) },
    uSelect: { value: new Color(palette.signal.SELECTION) },
    uShipped: { value: new Color(palette.signal.SHIPPED) },
    uDefect: { value: new Color(palette.signal.DEFECT) },
  };
}

/** Writes each zone's texel, the zone at `index` from `lightOf(index)`, and clears the rest. */
export function writeZoneLights(
  uniforms: ZoneUniforms,
  count: number,
  lightOf: (index: number) => ZoneLight,
): void {
  const texture = uniforms.uZones.value;
  const data = texture.image.data;
  if (!(data instanceof Float32Array)) return;
  data.fill(0);
  for (let index = 0; index < Math.min(count, FACTORY_WORLD_BOUNDS.MAX_ZONES); index += 1) {
    const light = lightOf(index);
    data[index * 4] = light.blast === undefined ? 0 : light.blast + 1;
    data[index * 4 + 1] = light.alive;
    data[index * 4 + 2] = light.chosen;
    data[index * 4 + 3] = light.damage;
  }
  texture.needsUpdate = true;
}

/**
 * The three surfaces drawn over the islands: the grass tops, glowing whole
 * by their zone; the rock beneath, a quarter as much; and the props, whose
 * windows give light of their own.
 */
export const ZONE_SURFACE = {
  TOP: { key: "archipelago-top", highlight: 1, glow: false, flat: false },
  UNDERSIDE: { key: "archipelago-underside", highlight: 0.25, glow: false, flat: true },
  PROPS: { key: "archipelago-props", highlight: 0, glow: true, flat: true },
} as const;

export type ZoneSurface = (typeof ZONE_SURFACE)[keyof typeof ZONE_SURFACE];

/**
 * A lit material that also glows by its zone: `highlight` of the zone's
 * selection or blast glow, and, where `glow` is set, the light its windows
 * give, carried in a `glow` attribute and brighter the more alive the zone.
 */
export function zoneLitMaterial(
  uniforms: ZoneUniforms,
  options: ZoneSurface,
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: options.flat ? 0.88 : 0.95,
    metalness: 0,
    flatShading: options.flat,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLSL_ZONE}\n${options.glow ? "attribute vec3 glow;" : ""}\nvarying vec3 vZoneEmissive;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 zs = zoneState();
        vZoneEmissive = zoneHighlight(zs) * ${options.highlight.toFixed(3)};
        ${options.glow ? "vZoneEmissive += glow * uGlowGain * (0.6 + 0.9 * zs.y);" : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vZoneEmissive;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vZoneEmissive;",
      );
  };
  material.customProgramCacheKey = () => options.key;
  return material;
}

/** A lit material whose windows and lamps give light of their own, carried in a `glow` attribute: the builders' towers and hulls. */
export function glowMaterial(uniforms: ZoneUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowGain = uniforms.uGlowGain;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 glow;\nuniform float uGlowGain;\nvarying vec3 vGlow;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow * uGlowGain;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlow;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;",
      );
  };
  material.customProgramCacheKey = () => "archipelago-glow";
  return material;
}

/** The rim lanterns: the shipped signal, burning by how alive their zone is, and gone where it is not. */
export function lanternMaterial(
  uniforms: ZoneUniforms,
  lampsOn: { value: number },
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...uniforms, uLampsOn: lampsOn },
    vertexShader: /* glsl */ `${GLSL_ZONE}
      uniform float uLampsOn; varying float vAlive;
      void main(){
        vAlive = zoneState().y * uLampsOn;
        gl_Position = vAlive < 0.05 ? vec4(2., 2., 2., 1.) : projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uShipped; varying float vAlive;
      void main(){ gl_FragColor = vec4(uShipped * (0.7 + 0.5 * vAlive), 1.); ${GLSL_OUTPUT} }`,
  });
}

/** A soft halo about each lantern, in place of a bloom pass: additive, and as bright as the zone is alive. */
export function haloMaterial(uniforms: ZoneUniforms, lampsOn: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { ...uniforms, uLampsOn: lampsOn },
    vertexShader: /* glsl */ `${GLSL_ZONE}
      attribute float aSize; uniform float uLampsOn; varying float vAlive;
      void main(){
        vAlive = zoneState().y * uLampsOn;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = vAlive < 0.05 ? 0. : aSize * (0.6 + 0.6 * vAlive) * 300. / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uShipped; uniform float uGlowGain; varying float vAlive;
      void main(){
        float d = length(gl_PointCoord - .5); if (d > .5) discard;
        gl_FragColor = vec4(uShipped * smoothstep(.5, 0., d) * (0.35 + 0.45 * vAlive) * min(uGlowGain, 1.6), 1.);
        ${GLSL_OUTPUT}
      }`,
  });
}

/** The bridges' glow: a tube along each, lit where both its ends are in the blast radius, and brighter where both were touched. */
export function bridgeGlowMaterial(uniforms: ZoneUniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { ...uniforms },
    vertexShader: /* glsl */ `
      attribute vec2 zones; uniform sampler2D uZones; uniform float uTime, uStill; uniform vec3 uBlast;
      varying vec2 vUv; varying vec3 vColor;
      void main(){
        vec4 a = texelFetch(uZones, ivec2(int(zones.x + 0.5), 0), 0);
        vec4 b = texelFetch(uZones, ivec2(int(zones.y + 0.5), 0), 0);
        vUv = uv;
        bool lit = a.x > 0.5 && b.x > 0.5;
        vColor = uBlast * (a.x < 1.5 && b.x < 1.5 ? 1.25 : 0.85);
        gl_Position = lit ? projectionMatrix * modelViewMatrix * vec4(position, 1.) : vec4(2., 2., 2., 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStill; varying vec2 vUv; varying vec3 vColor;
      void main(){
        float p = fract(vUv.x * 4. + uTime * 0.9);
        float a = mix(0.18 + 0.85 * smoothstep(0.7, 1.0, p), 0.55, uStill);
        gl_FragColor = vec4(vColor * a, 1.);
        ${GLSL_OUTPUT}
      }`,
  });
}
