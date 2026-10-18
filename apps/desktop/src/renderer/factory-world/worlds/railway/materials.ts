import {
  AdditiveBlending,
  type Color,
  DataTexture,
  DoubleSide,
  type Material,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  type RGB,
  RGBADepthPacking,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";

/**
 * materials.ts -- the shader patches the railway leans on: a town whose cells a site or a shipped house can clear, windows lit by how alive their zone is, and the track glow the blast radius runs along.
 *
 * Each is a stock material with a few lines spliced into its shader, so it
 * keeps Three.js's lighting and shadows. What changes per update is a small
 * data texture rather than geometry: one texel per town cell (`cells`), one
 * per glowing length of track (`glows`).
 */

/** A data texture of `width` by `height` texels the shaders read exactly, texel by texel. */
export function dataTexture(width: number, height: number): DataTexture {
  const texture = new DataTexture(new Uint8Array(width * height * 4), width, height, RGBAFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** The rows of texels a cell, or a glow, is fetched from. */
const FETCH = (attribute: string, width: number) =>
  `ivec2(int(${attribute}) % ${width}, int(${attribute}) / ${width})`;

/** What the town's materials read on every frame. */
export interface TownUniforms {
  /** Per cell: red, whether it stands; green, the share of its windows lit. */
  readonly uCells: { value: DataTexture };
  /** How brightly a lit window shines: low by day, high at night. */
  readonly uLit: { value: number };
}

/** Splices the cell's standing into a vertex shader, so a cleared cell's parts fold away to nothing. */
function patchCells(material: Material, uniforms: TownUniforms, width: number, lit: boolean): void {
  material.customProgramCacheKey = () => `railway-cells-${lit ? "lit" : "plain"}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCells = uniforms.uCells;
    shader.uniforms.uLit = uniforms.uLit;
    const head = [
      "attribute float aCell;",
      "uniform sampler2D uCells;",
      ...(lit ? ["attribute float aLit;", "uniform float uLit;", "varying float vLit;"] : []),
    ].join("\n");
    const body = [
      `vec4 cellState = texelFetch(uCells, ${FETCH("aCell", width)}, 0);`,
      "transformed *= step(0.5, cellState.r);",
      ...(lit
        ? ["vLit = step(aLit, cellState.g) * uLit * (0.75 + 0.5 * fract(aLit * 37.0));"]
        : []),
    ].join("\n");
    shader.vertexShader = `${head}\n${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n${body}`,
    )}`;
    if (!lit) return;
    shader.fragmentShader = `varying float vLit;\n${shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.64, 0.30) * vLit;",
    )}`;
  };
}

/** The town's walls and roofs, painted per vertex, folding away where their cell is cleared. */
export function townMaterials(uniforms: TownUniforms, width: number) {
  const buildings = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  patchCells(buildings, uniforms, width, false);
  const shadow = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  patchCells(shadow, uniforms, width, false);
  const windows = new MeshStandardMaterial({ color: "#6f8396", roughness: 0.18, metalness: 0.3 });
  patchCells(windows, uniforms, width, true);
  return { buildings, shadow, windows };
}

/** The glow over the tracks: each length lit in its glow id's colour, added over the rails. */
export function glowMaterial(glows: DataTexture, width: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uGlows: { value: glows } },
    vertexShader: `
      attribute float aGlow;
      uniform sampler2D uGlows;
      varying vec3 vGlow;
      void main() {
        vGlow = texelFetch(uGlows, ${FETCH("aGlow", width)}, 0).rgb;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vGlow;
      void main() {
        if (max(vGlow.r, max(vGlow.g, vGlow.b)) < 0.01) discard;
        gl_FragColor = vec4(vGlow, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

const SCRATCH_RGB: RGB = { r: 0, g: 0, b: 0 };

/**
 * Writes `color` scaled by `strength` into texel `index` of a data texture,
 * in sRGB, since the glow's shader hands its texel to the screen as it is and
 * a signal must reach the screen in its own colour.
 */
export function writeTexel(
  texture: DataTexture,
  index: number,
  color: Color,
  strength: number,
): void {
  const data = texture.image.data;
  if (!(data instanceof Uint8Array) || index * 4 + 3 >= data.length) return;
  color.getRGB(SCRATCH_RGB, SRGBColorSpace);
  data[index * 4] = Math.round(Math.min(1, SCRATCH_RGB.r * strength) * 255);
  data[index * 4 + 1] = Math.round(Math.min(1, SCRATCH_RGB.g * strength) * 255);
  data[index * 4 + 2] = Math.round(Math.min(1, SCRATCH_RGB.b * strength) * 255);
  data[index * 4 + 3] = 255;
}
