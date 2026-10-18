import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector4,
} from "three";
import type { WorldPalette } from "../../world";
import { glowingMaterial, glowMaterial, hdrMaterial } from "./effects";
import { col } from "./geo";

/**
 * materials.ts -- every material the Factory shares across rebuilds, and the two shaders that light a zone without a draw of its own: the buildings' and the belts'.
 *
 * Every building is one draw, so a zone is lit through a uniform array the
 * building shader reads by each vertex's zone index (`aZone`): an emissive
 * to add, and how far to dim it. The belts read a second array the same
 * way, by the two zones each belt joins: how far the blast radius's ripple
 * has reached each, and whether it is damaged, which jams what rides out of
 * it. The lot highlight, a glowing floor and fading walls round a lit lot,
 * is one instanced draw for every lot at once.
 */

/** The most zones the arrays hold, the contract's bound. */
const ZONE_SLOTS = FACTORY_WORLD_BOUNDS.MAX_ZONES;

const BUILDING_VERTEX_HEAD = /* glsl */ `
#include <common>
attribute float aZone;
uniform vec4 uZone[${ZONE_SLOTS}];
varying vec4 vZoneLight;`;

const BELT_VERTEX_HEAD = /* glsl */ `
#include <common>
attribute float aU;
attribute float aSource;
attribute float aSink;
uniform vec4 uZoneReach[${ZONE_SLOTS}];
varying float vU;
varying float vLit;
varying float vJam;`;

const BELT_FRAGMENT_HEAD = /* glsl */ `
#include <common>
uniform float uTime;
uniform float uDim;
uniform vec3 uLitColor;
varying float vU;
varying float vLit;
varying float vJam;`;

const BELT_COLOUR = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= mix(1.0, 0.45, uDim * (1.0 - clamp(vLit, 0.0, 1.0)));
if (vColor.r < 0.12) {
  float speed = mix(2.2, 0.25, vJam);
  float stripe = step(0.5, fract(vU * 1.25 - uTime * speed * 1.25));
  diffuseColor.rgb *= 0.7 + 0.6 * stripe;
}`;

const BELT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
float pulse = pow(max(sin(vU * 0.42 - uTime * 6.0), 0.0), 8.0);
totalEmissiveRadiance += uLitColor * vLit * (0.12 + 2.6 * pulse);
if (vJam > 0.5) totalEmissiveRadiance += vec3(1.0, 0.08, 0.04) * (0.6 + 0.5 * sin(uTime * 5.0)) * smoothstep(16.0, 2.0, vU);`;

const HIGHLIGHT_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec2 vPlace;
varying vec2 vSize;
varying vec3 vTint;
void main() {
  vUv = uv;
  vTint = vec3(0.0);
  vec4 local = vec4(position, 1.0);
  vSize = vec2(1.0);
  #ifdef USE_INSTANCING
    vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
    local = instanceMatrix * local;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #endif
  vPlace = position.xz * vSize;
  gl_Position = projectionMatrix * modelViewMatrix * local;
}`;

const FLOOR_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vPlace;
varying vec2 vSize;
varying vec3 vTint;
void main() {
  vec2 e = vSize * 0.5 - abs(vPlace);
  float edge = 1.0 - smoothstep(0.0, 1.2, min(e.x, e.y));
  float r = length(vPlace);
  float ring = smoothstep(1.4, 0.0, abs(r - mod(uTime * 9.0, max(vSize.x, vSize.y)))) * 0.6;
  gl_FragColor = vec4(vTint * 1.6 * (0.06 + edge * 0.9 + ring), 1.0);
}`;

const WALLS_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  float a = pow(1.0 - vUv.y, 3.0) * (0.75 + 0.25 * sin(uTime * 5.0 + vUv.x * 6.0));
  gl_FragColor = vec4(vTint * 1.4 * a, 1.0);
}`;

/** The materials and the uniforms a world drives them by. */
export interface WorldMaterials {
  readonly solid: MeshStandardMaterial;
  readonly building: MeshStandardMaterial;
  readonly glow: MeshBasicMaterial;
  readonly lampHead: MeshBasicMaterial;
  readonly lampPool: ShaderMaterial;
  readonly flare: MeshBasicMaterial;
  readonly belt: MeshStandardMaterial;
  readonly highlightFloor: ShaderMaterial;
  readonly highlightWalls: ShaderMaterial;
  readonly invisible: MeshBasicMaterial;
  /** By zone index: an emissive to add in `xyz`, and a multiplier for the zone's colour in `w`. */
  readonly zoneLight: readonly Vector4[];
  /** By zone index: how far the ripple has reached it in `x`, from 0 to 1, and whether it is damaged in `y`. */
  readonly zoneReach: readonly Vector4[];
  readonly time: { value: number };
  readonly dim: { value: number };
  /** Every material here, so a rebuild can tell what is shared from what it made. */
  readonly all: ReadonlySet<Material>;
}

/** Makes the world's shared materials in `palette`'s signals. */
export function worldMaterialsOf(palette: WorldPalette): WorldMaterials {
  const zoneLight = Array.from({ length: ZONE_SLOTS }, () => new Vector4(0, 0, 0, 1));
  const zoneReach = Array.from({ length: ZONE_SLOTS }, () => new Vector4(0, 0, 0, 0));
  const time = { value: 0 };
  const dim = { value: 0 };
  const solid = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.8,
    metalness: 0.02,
  });
  const building = solid.clone();
  building.onBeforeCompile = (shader) => {
    shader.uniforms.uZone = { value: zoneLight };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", BUILDING_VERTEX_HEAD)
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvZoneLight = uZone[int(aZone + 0.5)];",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vZoneLight;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= vZoneLight.w;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vZoneLight.xyz;",
      );
  };
  const belt = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.7,
    metalness: 0.1,
    side: DoubleSide,
  });
  const litColor = col(palette.signal.BLAST_RADIUS).clone();
  belt.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneReach = { value: zoneReach };
    shader.uniforms.uTime = time;
    shader.uniforms.uDim = dim;
    shader.uniforms.uLitColor = { value: litColor };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", BELT_VERTEX_HEAD)
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "vU = aU;",
          "vec4 fromReach = uZoneReach[int(aSource + 0.5)];",
          "vec4 toReach = uZoneReach[int(aSink + 0.5)];",
          "vLit = min(fromReach.x, toReach.x);",
          "vJam = fromReach.y;",
        ].join("\n"),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", BELT_FRAGMENT_HEAD)
      .replace("#include <color_fragment>", BELT_COLOUR)
      .replace("#include <emissivemap_fragment>", BELT_EMISSIVE);
  };
  const highlight = (fragmentShader: string, walls: boolean) =>
    new ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: HIGHLIGHT_VERTEX,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: walls ? DoubleSide : FrontSide,
    });
  const lampHead = new MeshBasicMaterial({ color: new Color("#ffd89a") });
  const materials = {
    solid,
    building,
    glow: glowingMaterial(1),
    lampHead,
    lampPool: glowMaterial("#ffcf8a", 0),
    flare: hdrMaterial("#ffa040", 4),
    belt,
    highlightFloor: highlight(FLOOR_FRAGMENT, false),
    highlightWalls: highlight(WALLS_FRAGMENT, true),
    invisible: new MeshBasicMaterial({ visible: false }),
  };
  return {
    ...materials,
    zoneLight,
    zoneReach,
    time,
    dim,
    all: new Set<Material>(Object.values(materials)),
  };
}
