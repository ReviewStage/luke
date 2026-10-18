import {
  type BufferGeometry,
  Color,
  DoubleSide,
  type InstancedBufferAttribute,
  InstancedMesh,
  type Matrix4,
} from "three";
import { instancedAttribute } from "./geometry";
import type { Sea } from "./sea";

/**
 * glass.ts -- the geodesic glass every dome in Atlantis is made of: a district's dome, the great dome, an agent's dome going up, and a planned blueprint.
 *
 * One shader draws them all, as instances: struts along each triangle's
 * edges, glass between them catching the light at a glance, and the
 * caustic net over the top. A dome's mode says how it stands: built, going
 * up panel by panel, swept by a refactor's band, flickering where a fix or a
 * failure is at work, or a hologram not yet built. Each instance carries
 * its own colour, highlight, and how far the blast radius's ripple has to
 * travel to reach it.
 */

/** How a dome stands, which its shader reads per instance. */
export const DOME_MODE = {
  /** Going up: panels fill to the dome's height of done. */
  RISING: 0,
  /** Being reworked: a band of new panels sweeps up it. */
  SWEEPING: 1,
  /** Being mended, or broken: panels flicker at random. */
  FLICKERING: 2,
  /** Built: clear glass on pale struts. */
  BUILT: 3,
  /** Planned: a hologram of scan lines, not yet built. */
  HOLOGRAM: 4,
} as const;

export type DomeMode = (typeof DOME_MODE)[keyof typeof DOME_MODE];

/** How one dome is drawn, filled in place and handed to `Domes.place`. */
export interface DomeLook {
  readonly color: Color;
  readonly highlight: Color;
  /** How much of it is built, in [0, 1]. */
  fill: number;
  mode: DomeMode;
  /** How strongly `highlight` lights it. */
  lit: number;
  /** 1 for full strength, less where the developer's focus is elsewhere. */
  dim: number;
  /** How many steps out of the blast radius it stands, or -1 outside it. */
  steps: number;
  seed: number;
}

/** A dome's look before anything is filled in. */
export function domeLookOf(): DomeLook {
  return {
    color: new Color(),
    highlight: new Color(),
    fill: 1,
    mode: DOME_MODE.BUILT,
    lit: 0,
    dim: 1,
    steps: -1,
    seed: 0,
  };
}

/** One instanced set of domes. */
export interface Domes {
  readonly mesh: InstancedMesh;
  /** Draws dome `index` where `matrix` puts it, as `look` says. */
  readonly place: (index: number, matrix: Matrix4, look: DomeLook) => void;
  /** Draws the first `count` and no more. */
  readonly finish: (count: number) => void;
}

/** How a set of domes' glass reads: its opacity, its struts' width, and their colour and strength where built. */
export interface GlassLook {
  readonly opacity: number;
  readonly strutWidth: number;
  readonly strut: string;
  readonly strutGain: number;
}

const DOME_VERTEX = /* glsl */ `
attribute vec3 bary; attribute float aCy; attribute float aRand;
attribute vec3 aColor; attribute vec4 aParam; attribute vec3 aHiColor; attribute vec2 aLook;
varying vec3 vBary; varying vec3 vN; varying vec3 vW; varying float vCy; varying float vRand; varying float vDepth;
varying vec3 vCol; varying vec4 vParam; varying vec3 vHiColor; varying vec2 vLook;
void main(){
  mat4 M = modelMatrix * instanceMatrix;
  vCol = aColor; vParam = aParam; vHiColor = aHiColor; vLook = aLook;
  vec4 wp = M * vec4(position,1.0);
  vW = wp.xyz; vN = normalize(mat3(M)*normal); vBary = bary; vCy = aCy; vRand = aRand;
  vec4 mv = viewMatrix * wp; vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uStrut; uniform float uOpacity; uniform float uStrutW;
varying vec3 vBary; varying vec3 vN; varying vec3 vW; varying float vCy; varying float vRand; varying float vDepth;
varying vec3 vCol; varying vec4 vParam; varying vec3 vHiColor; varying vec2 vLook;
void main(){
  float fill = vParam.x; float mode = vParam.y; float seed = vParam.w;
  float hi = vParam.z + ripple(vLook.y)*0.8;
  float dim = vLook.x;
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float fres = pow(1.0 - abs(dot(N,V)), 2.0);
  float e = min(min(vBary.x,vBary.y),vBary.z);
  float fw = fwidth(e);
  float strut = 1.0 - smoothstep(uStrutW, uStrutW + fw*1.6, e);
  float panel = 1.0; float fresh = 1.0; float edgeGlow = 0.0;
  if (mode < 0.5) {
    panel = step(vCy, fill);
    edgeGlow = (1.0-panel) * step(vCy, fill + 0.09) * (0.55+0.45*sin(uTime*7.0+vRand*20.0));
  } else if (mode < 1.5) {
    float band = fract(uTime*0.045 + seed);
    float d = vCy - band;
    fresh = step(d, 0.0);
    edgeGlow = step(abs(d), 0.06) * (0.55+0.45*sin(uTime*8.0+vRand*30.0));
  } else if (mode < 2.5) {
    edgeGlow = step(vRand, 0.12) * (0.6+0.4*sin(uTime*9.0+vRand*50.0));
    panel = step(0.08, fract(vRand*7.0 + seed));
  } else if (mode > 3.5) {
    panel = 0.0;
  }
  vec3 glass = (mode > 2.5 ? vec3(0.36,0.85,1.0) : mix(vec3(0.36,0.85,1.0), vCol, 0.45)) * (0.03 + fres*0.5);
  glass += vec3(0.5,0.9,1.0) * caustic(vW, uTime*0.5) * 0.12 * (N.y*0.5+0.5);
  if (mode > 0.5 && mode < 1.5) glass *= mix(0.45, 1.25, fresh);
  vec3 col = glass * panel;
  float a = panel * (uOpacity + fres*0.32);
  bool built = mode > 2.5 && mode < 3.5;
  float lit = clamp(hi, 0.0, 1.0);
  // Note that a highlight recolours the struts rather than adding to them, so the signal's hue survives the tone mapping.
  vec3 sc = mix(built ? uStrut : vCol, vHiColor*1.6, lit);
  float sk = built ? 1.0 : (panel > 0.5 ? 0.75 : 1.25);
  col += sc * strut * sk * (1.0 + lit*0.6);
  a += strut * 0.85;
  col += vCol * edgeGlow * 1.6; a += edgeGlow*0.45;
  col += vHiColor * hi * (0.08 + fres*0.6); a += hi*0.2;
  if (mode > 3.5) { float scan = 0.45 + 0.55*pow(0.5+0.5*sin(vW.y*2.2 - uTime*2.5), 3.0); col *= scan * (0.5 + hi*1.6); a *= scan*(0.5+hi); }
  float f = fogF(vDepth);
  col *= dim; a *= mix(0.55, 1.0, dim);
  col = mix(col, uFogColor, f); a *= (1.0 - f*0.6);
  gl_FragColor = vec4(col, clamp(a,0.0,1.0));
}`;

/** `capacity` domes of `geometry` (a `geodesicDome`), in glass that reads as `glass` says. */
export function domesOf(
  sea: Sea,
  geometry: BufferGeometry,
  capacity: number,
  glass: GlassLook,
): Domes {
  const color = instancedAttribute(geometry, "aColor", 3, capacity);
  const param = instancedAttribute(geometry, "aParam", 4, capacity);
  const highlight = instancedAttribute(geometry, "aHiColor", 3, capacity);
  const look = instancedAttribute(geometry, "aLook", 2, capacity);
  const material = sea.shader(
    {
      uStrut: { value: new Color(glass.strut).multiplyScalar(glass.strutGain) },
      uOpacity: { value: glass.opacity },
      uStrutW: { value: glass.strutWidth },
    },
    DOME_VERTEX,
    DOME_FRAGMENT,
    { transparent: true, depthWrite: false, side: DoubleSide },
  );
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const touched: readonly InstancedBufferAttribute[] = [color, param, highlight, look];
  return {
    mesh,
    place: (index, matrix, dome) => {
      mesh.setMatrixAt(index, matrix);
      color.setXYZ(index, dome.color.r, dome.color.g, dome.color.b);
      param.setXYZW(index, dome.fill, dome.mode, dome.lit, dome.seed);
      highlight.setXYZ(index, dome.highlight.r, dome.highlight.g, dome.highlight.b);
      look.setXY(index, dome.dim, dome.steps);
    },
    finish: (count) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      for (const attribute of touched) attribute.needsUpdate = true;
    },
  };
}
