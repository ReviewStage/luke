import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from "three";

/**
 * glow.ts -- the World Tree's soft lights: one points cloud per way of blending, shared by every lantern, firefly, spark, ring, and puff, each system writing its own reserved run of points.
 *
 * A point is drawn in one of `GLOW_SHAPE`'s shapes, worked out in the
 * fragment shader rather than read from a texture, so the tree loads no
 * image and draws no glyph. A point's size is in scene units, scaled by the
 * drawing buffer's height as the renderer reports it before each draw, so
 * the cloud reads nothing from the page.
 */

/** What a point draws: a soft dot, a ring, a snore bubble, or the three dots of a wait. */
export const GLOW_SHAPE = {
  DOT: 0,
  RING: 1,
  BUBBLE: 2,
  ELLIPSIS: 3,
} as const;

export type GlowShape = (typeof GLOW_SHAPE)[keyof typeof GLOW_SHAPE];

/** How a cloud blends: added light, laid over, or added light seen through the wood. */
export const GLOW_BLEND = {
  ADD: "add",
  OVER: "over",
  XRAY: "xray",
} as const;

export type GlowBlend = (typeof GLOW_BLEND)[keyof typeof GLOW_BLEND];

/** The largest a point is drawn, in device pixels. */
const MAX_POINT_PX = 90;

/** One cloud, written a point at a time and committed once a frame. */
export interface GlowField {
  readonly points: Points;
  /** Reserves `count` points for one system; answers the first. */
  readonly reserve: (count: number) => number;
  readonly set: (
    index: number,
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    a: number,
    shape?: GlowShape,
  ) => void;
  /** Hides `count` points from `first`. */
  readonly clear: (first: number, count: number) => void;
  readonly commit: () => void;
}

function glowMaterial(blend: GlowBlend): ShaderMaterial {
  const xray = blend === GLOW_BLEND.XRAY;
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: !xray,
    blending: blend === GLOW_BLEND.OVER ? NormalBlending : AdditiveBlending,
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec4 aColor; attribute float aShape;
      varying vec4 vColor; varying float vShape; uniform float uScale;
      void main(){
        vColor = aColor; vShape = aShape;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        mv.xyz *= max(0.5, 1.0 - 0.6 / max(length(mv.xyz), 0.001));
        ${xray ? "vColor.a *= smoothstep(9.0, 26.0, -mv.z);" : ""}
        gl_PointSize = min(aSize * uScale / -mv.z, ${MAX_POINT_PX.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vColor; varying float vShape;
      float segment(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        float a;
        if (vShape < 0.5) {
          a = r < 0.25 ? mix(1.0, 0.75, r / 0.25) : mix(0.75, 0.0, clamp((r - 0.25) / 0.75, 0.0, 1.0));
        } else if (vShape < 1.5) {
          a = exp(-pow((r - 0.8) / 0.07, 2.0));
        } else if (vShape < 2.5) {
          a = (1.0 - smoothstep(0.08, 0.16, abs(r - 0.62))) + (1.0 - smoothstep(0.0, 0.14, length(p - vec2(-0.25, 0.3)))) * 0.8;
        } else {
          float d = min(min(length(p - vec2(-0.55, 0.0)), length(p)), length(p - vec2(0.55, 0.0)));
          a = 1.0 - smoothstep(0.15, 0.22, d);
        }
        gl_FragColor = vec4(vColor.rgb, vColor.a * a);
        if (gl_FragColor.a < 0.003) discard;
      }`,
  });
}

export function glowField(capacity: number, blend: GlowBlend): GlowField {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
    DynamicDrawUsage,
  );
  const size = new BufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const color = new BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
  const shape = new BufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aSize", size);
  geometry.setAttribute("aColor", color);
  geometry.setAttribute("aShape", shape);
  const material = glowMaterial(blend);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = blend === GLOW_BLEND.XRAY ? 20 : 10;
  const buffer = new Vector2();
  const scale = material.uniforms.uScale;
  // Note that the size is read from the renderer as it draws, so a point is as large on a Retina canvas as on any other.
  points.onBeforeRender = (renderer: WebGLRenderer) => {
    if (scale !== undefined) scale.value = renderer.getDrawingBufferSize(buffer).y * 0.5;
  };
  let reserved = 0;
  return {
    points,
    reserve: (count) => {
      const first = reserved;
      reserved += count;
      if (reserved > capacity) throw new Error("tree: a glow field reserved past its capacity");
      return first;
    },
    set: (index, x, y, z, s, r, g, b, a, drawn = GLOW_SHAPE.DOT) => {
      position.setXYZ(index, x, y, z);
      size.setX(index, s);
      color.setXYZW(index, r, g, b, a);
      shape.setX(index, drawn);
    },
    clear: (first, count) => {
      for (let index = first; index < first + count; index += 1) color.setW(index, 0);
    },
    commit: () => {
      position.needsUpdate = true;
      size.needsUpdate = true;
      color.needsUpdate = true;
      shape.needsUpdate = true;
    },
  };
}
