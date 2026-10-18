import { DoubleSide, MeshStandardMaterial, type MeshStandardMaterialParameters } from "three";

/**
 * materials.ts -- what the Citadel is built of: dressed stone, slate and tile roofs, timber-framed plaster, wood, iron, and fresh-cut stone, each patterned by its shader rather than a texture.
 *
 * Note that every pattern is drawn in the fragment shader from the
 * surface's own place in the world (stone, roofs) or its face (plaster), so
 * the world ships no image and builds none: the brick courses, the shingles,
 * and the half-timbering are arithmetic. Each pattern fades to its own
 * average where its courses would be finer than a pixel, which is what a
 * texture's mipmaps did for the mockup.
 */

/** The GLSL every pattern shares: a cell hash and a fade by screen-space size. */
const PATTERN_COMMON = `
  float citadelHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float citadelDetail(vec2 p, float course){ vec2 w = fwidth(p); return 1.0 - smoothstep(course * 0.25, course * 0.7, max(w.x, w.y)); }
`;

/** Dressed stone: courses 0.3 high of ashlar blocks of varied length, pale mortar between, a lit top edge and a shadowed foot. */
const BRICK = `
  vec3 citadelPattern(vec2 p){
    float row = floor(p.y / 0.3);
    float span = 0.36 + citadelHash(vec2(row, 3.0)) * 0.26;
    float along = (p.x + citadelHash(vec2(row, 7.0)) * 0.6) / span;
    float index = floor(along);
    vec2 cell = vec2(fract(along), fract(p.y / 0.3));
    float tone = 0.7 + citadelHash(vec2(index, row)) * 0.17;
    float joint = smoothstep(0.0, 0.06, cell.x) * smoothstep(1.0, 0.94, cell.x) * smoothstep(0.0, 0.1, cell.y) * smoothstep(1.0, 0.9, cell.y);
    float light = 1.0 + 0.1 * smoothstep(0.78, 0.92, cell.y) - 0.12 * smoothstep(0.3, 0.1, cell.y);
    vec3 block = vec3(tone + 0.04, tone, tone - 0.055) * light;
    vec3 face = mix(vec3(0.44, 0.4, 0.35), block, joint);
    return mix(vec3(0.7, 0.665, 0.62), face, citadelDetail(p, 0.3));
  }
`;

/** Shingles: rows 0.15 high of tiles offset by half, each a little darker at its head. */
const SHINGLE = `
  vec3 citadelPattern(vec2 p){
    float row = floor(p.y / 0.15);
    float along = p.x / 0.15 + mod(row, 2.0) * 0.5;
    vec2 cell = vec2(fract(along), fract(p.y / 0.15));
    float tone = (0.75 + citadelHash(vec2(floor(along), row)) * 0.2) * mix(1.0, 0.77, cell.y);
    float joint = smoothstep(0.0, 0.07, cell.x) * smoothstep(1.0, 0.93, cell.x) * smoothstep(0.0, 0.08, cell.y);
    vec3 face = mix(vec3(0.36, 0.33, 0.31), vec3(tone * 0.99, tone * 0.97, tone * 0.95), joint);
    return mix(vec3(0.74, 0.72, 0.7), face, citadelDetail(p, 0.15));
  }
`;

/** Patches a standard material to multiply its colour by `pattern`, projected three ways from the world and blended by the surface's facing. */
function triplanar(
  parameters: MeshStandardMaterialParameters,
  pattern: string,
): MeshStandardMaterial {
  const material = new MeshStandardMaterial(parameters);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vCitadelWorld;\nvarying vec3 vCitadelNormal;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        mat4 citadelPlace = modelMatrix;
        #ifdef USE_INSTANCING
          citadelPlace = modelMatrix * instanceMatrix;
        #endif
        vCitadelWorld = (citadelPlace * vec4(position, 1.0)).xyz;
        vCitadelNormal = normalize(mat3(citadelPlace) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vCitadelWorld;\nvarying vec3 vCitadelNormal;\n${PATTERN_COMMON}\n${pattern}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec3 citadelWeight = pow(abs(normalize(vCitadelNormal)), vec3(6.0));
        citadelWeight /= citadelWeight.x + citadelWeight.y + citadelWeight.z;
        vec3 citadelP = vCitadelWorld;
        diffuseColor.rgb *= citadelPattern(citadelP.zy) * citadelWeight.x + citadelPattern(citadelP.xz) * citadelWeight.y + citadelPattern(citadelP.xy) * citadelWeight.z;`,
      );
  };
  return material;
}

/** Plaster between dark timbers: a frame round each face, a rail across its middle, a post down it, and two braces under the eaves. */
function halfTimbered(parameters: MeshStandardMaterialParameters): MeshStandardMaterial {
  const material = new MeshStandardMaterial(parameters);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCitadelFace;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCitadelFace = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vCitadelFace;
        float citadelBrace(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 f = vCitadelFace;
        float b = 0.0625;
        float timber = step(f.x, b) + step(1.0 - b, f.x) + step(f.y, b) + step(1.0 - b, f.y);
        timber += step(abs(f.y - 0.5), b * 0.4) + step(abs(f.x - 0.5), b * 0.5);
        timber += step(citadelBrace(f, vec2(b, 0.52), vec2(0.5, 1.0 - b)), 0.024) + step(citadelBrace(f, vec2(1.0 - b, 0.52), vec2(0.5, 1.0 - b)), 0.024);
        diffuseColor.rgb *= mix(vec3(0.94, 0.89, 0.78), vec3(0.29, 0.2, 0.14), clamp(timber, 0.0, 1.0));`,
      );
  };
  return material;
}

/**
 * The Citadel's materials. Each takes its colour from the instance it
 * draws, so one material serves every hue of its kind: grey and honey stone,
 * slate and red tile, oak and iron.
 */
export function citadelMaterials() {
  return {
    stone: triplanar({ roughness: 0.93 }, BRICK),
    fresh: triplanar({ roughness: 0.8, emissive: "#ffcf8a", emissiveIntensity: 0.14 }, BRICK),
    roof: triplanar({ roughness: 0.78, flatShading: true }, SHINGLE),
    plaster: halfTimbered({ roughness: 0.9 }),
    plain: new MeshStandardMaterial({ roughness: 0.72, metalness: 0.15 }),
    cloth: new MeshStandardMaterial({ roughness: 0.85, side: DoubleSide }),
    rock: new MeshStandardMaterial({ roughness: 1, flatShading: true }),
  } as const;
}

export type CitadelMaterials = ReturnType<typeof citadelMaterials>;

/** The hues the Citadel's parts are dressed in. */
export const HUE = {
  STONE: "#e6d3b0",
  STONE_DARK: "#a8957a",
  FRESH: "#fff6e4",
  SLATE: "#7a86a0",
  WOOD: "#7a5434",
  POLE: "#6b4a2e",
  GOLD: "#f0bf55",
  IRON: "#4a4b52",
  PLASTER: "#ffffff",
  ROCK: "#b6a68c",
} as const;

/** The tile roofs a zone's own seed picks among. */
export const ROOF_HUES = [
  "#b4573a",
  "#5a6680",
  "#9a4632",
  "#6f5a7e",
  "#b8843c",
  "#4f6b5a",
  "#a85a48",
  "#5c6f8f",
  "#8a4a3a",
  "#7a6a4a",
  "#a0603a",
  "#596079",
  "#9c5236",
] as const;
