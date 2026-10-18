import type { ZoneEdge } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CubicBezierCurve3,
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  NearestFilter,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COMMON_GLSL, OUTPUT_GLSL, type SharedUniforms } from "./glsl";
import { type CityLayout, seededRandom } from "./layout";

/**
 * highways.ts -- the city's dependencies as elevated light-trail highways arcing from each district to the districts it depends on, flying traffic riding them, and the blast radius racing down them.
 *
 * Every highway is one Bézier arc, the arcs merged into one tube mesh and
 * their sampled curves kept in a float texture the cars read, so a city of
 * hundreds of dependencies is two draw calls. When an agent is selected,
 * each highway that carries its ripple one step outward lights in the blast
 * radius's colour, from the instant the ripple reaches its near end; held
 * still, it is lit at once.
 */

/** The most highways the city draws; beyond them the rest of a dense graph stays off the skyline. */
const EDGE_BOUND = 600;

/** Samples along each highway the cars read. */
const SEGMENTS = 48;

/** Cars riding each highway. */
const CARS_PER_EDGE = 3;

/** One highway as drawn: the zones it joins, by path, and its index in the state texture. */
interface Highway {
  readonly from: string;
  readonly to: string;
  readonly index: number;
}

export interface Highways {
  readonly group: Group;
  readonly textures: readonly DataTexture[];
  /** Lays the highways out for `layout` and its edges. */
  readonly plan: (layout: CityLayout, edges: readonly ZoneEdge[]) => void;
  /** Lights the highways a blast radius rides: `startOf(distance)` is when the ripple leaves a zone that many steps out. */
  readonly light: (
    blast: ReadonlyMap<string, number>,
    startOf: (distance: number) => number,
  ) => void;
}

export function createHighways(
  scene: Scene,
  uniforms: SharedUniforms,
  blastColor: string,
): Highways {
  const stateData = new Float32Array(EDGE_BOUND * 4);
  const curveData = new Float32Array((SEGMENTS + 1) * EDGE_BOUND * 4);
  const state = new DataTexture(stateData, EDGE_BOUND, 1, RGBAFormat, FloatType);
  const curves = new DataTexture(curveData, SEGMENTS + 1, EDGE_BOUND, RGBAFormat, FloatType);
  for (const texture of [state, curves]) {
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
  }
  const group = new Group();
  const tubes = new Mesh(
    new BufferGeometry(),
    new ShaderMaterial({
      uniforms: {
        ...uniforms,
        uEdges: { value: state },
        uBlastColor: { value: new Color(blastColor) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aEdge; attribute vec3 aColor; varying float vU; varying float vEdge; varying vec3 vColor; varying float vDist;
        void main(){ vU = uv.x; vEdge = aEdge; vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL}
        uniform sampler2D uEdges; uniform float uTime, uFocus; uniform vec3 uBlastColor;
        varying float vU; varying float vEdge; varying vec3 vColor; varying float vDist;
        void main(){
          vec4 st = texelFetch(uEdges, ivec2(int(vEdge + 0.5), 0), 0);
          float len = st.w;
          float s1 = pow(fract(vU * len / 7.0 - uTime * 0.9 + vEdge * 0.37), 10.0);
          float s2 = pow(fract(-vU * len / 9.0 - uTime * 0.65 + vEdge * 0.71), 14.0);
          vec3 col = vColor * (0.05 + s1 * 0.55) + vec3(0.9, 0.85, 1.0) * s2 * 0.25;
          if (st.x > 0.0) {
            float tt = uTime - st.y; float pos = 1.0 - tt / 0.7;
            float head = exp(-abs(vU - pos) * 22.0) * step(0.0, tt) * step(-0.2, pos);
            float trail = step(pos, vU) * step(0.0, tt);
            col = col * 0.5 + uBlastColor * (head * 7.0 + trail * (1.1 + 0.5 * sin(vU * len * 0.6 - uTime * 9.0)));
          } else {
            col *= 1.0 - uFocus * 0.8;
          }
          gl_FragColor = vec4(col * (1.0 - fogF(vDist)), 1.0);
          ${OUTPUT_GLSL}
        }`,
    }),
  );
  tubes.frustumCulled = false;
  const carGeometry = new BoxGeometry(1, 1, 1);
  const carData = new InstancedBufferAttribute(new Float32Array(EDGE_BOUND * CARS_PER_EDGE * 4), 4);
  carGeometry.setAttribute("aCar", carData);
  const cars = new InstancedMesh(
    carGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uCurves: { value: curves }, uSeg: { value: SEGMENTS } },
      vertexShader: /* glsl */ `attribute vec4 aCar; uniform sampler2D uCurves; uniform float uSeg, uTime; varying vec3 vC; varying float vDist;
        vec3 cp(float e, float u){ float x = clamp(u, 0.0, 1.0) * uSeg; float i = floor(x); float f = x - i;
          vec3 a = texelFetch(uCurves, ivec2(int(i), int(e)), 0).xyz; vec3 b = texelFetch(uCurves, ivec2(int(min(i + 1.0, uSeg)), int(e)), 0).xyz; return mix(a, b, f); }
        void main(){
          float e = aCar.x, dir = aCar.w; float u = fract(aCar.y + uTime * aCar.z * dir);
          if (dir < 0.0) u = 1.0 - fract(aCar.y - uTime * aCar.z);
          vec3 p = cp(e, u); vec3 q = cp(e, u + 0.004 * dir);
          vec3 fwd = normalize(q - p + vec3(1e-5)); vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + vec3(1e-5)); vec3 up = cross(side, fwd);
          vec3 lp = position * vec3(0.34, 0.2, 1.7);
          vec3 w = p + side * 0.55 * dir + up * 0.1 + side * lp.x + up * lp.y + fwd * lp.z;
          vC = position.z > 0.0 ? vec3(1.4, 1.5, 1.8) : vec3(1.2, 0.3, 0.6);
          vec4 mv = viewMatrix * vec4(w, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `${COMMON_GLSL} uniform float uFocus; varying vec3 vC; varying float vDist; void main(){ gl_FragColor = vec4(vC * (1.0 - fogF(vDist)) * (1.0 - uFocus * 0.6), 1.0); ${OUTPUT_GLSL} }`,
    }),
    EDGE_BOUND * CARS_PER_EDGE,
  );
  cars.frustumCulled = false;
  cars.count = 0;
  group.add(tubes, cars);
  scene.add(group);
  let highways: Highway[] = [];

  const plan = (layout: CityLayout, edges: readonly ZoneEdge[]) => {
    const random = seededRandom(20261017);
    stateData.fill(0);
    const pieces: BufferGeometry[] = [];
    const drawn: Highway[] = [];
    const point = new Vector3();
    const mixed = new Color();
    for (const edge of edges) {
      if (drawn.length >= EDGE_BOUND) break;
      const from = layout.districtByPath.get(edge.from);
      const to = layout.districtByPath.get(edge.to);
      if (from === undefined || to === undefined || from === to) continue;
      const index = drawn.length;
      const start = new Vector3(from.x, Math.min(from.height * 0.55, 34), from.z);
      const end = new Vector3(to.x, Math.min(to.height * 0.62, 48), to.z);
      const lift = Math.max(start.y, end.y) * 0.25 + 8 + start.distanceTo(end) * 0.12;
      const near = start.clone().lerp(end, 0.25);
      near.y += lift;
      const far = start.clone().lerp(end, 0.75);
      far.y += lift;
      const curve = new CubicBezierCurve3(start, near, far, end);
      const length = curve.getLength();
      stateData[index * 4 + 3] = length;
      for (let step = 0; step <= SEGMENTS; step += 1) {
        curve.getPointAt(step / SEGMENTS, point);
        curveData.set([point.x, point.y, point.z, 1], (index * (SEGMENTS + 1) + step) * 4);
      }
      const tube = new TubeGeometry(curve, 48, 0.2, 6, false);
      const vertices = tube.getAttribute("position").count;
      tube.setAttribute("aEdge", new BufferAttribute(new Float32Array(vertices).fill(index), 1));
      const fromColor = from.accent.clone().lerp(new Color("#7a5cff"), 0.4);
      const colors = new Float32Array(vertices * 3);
      const uv = tube.getAttribute("uv");
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        mixed
          .copy(fromColor)
          .lerp(to.accent, uv.getX(vertex))
          .toArray(colors, vertex * 3);
      }
      tube.setAttribute("aColor", new BufferAttribute(colors, 3));
      tube.deleteAttribute("normal");
      pieces.push(tube);
      for (let car = 0; car < CARS_PER_EDGE; car += 1) {
        carData.setXYZW(
          index * CARS_PER_EDGE + car,
          index,
          random(),
          (5 + random() * 7) / length,
          car % 2 ? 1 : -1,
        );
      }
      drawn.push({ from: edge.from, to: edge.to, index });
    }
    tubes.geometry.dispose();
    tubes.geometry =
      pieces.length > 0 ? (mergeGeometries(pieces) ?? new BufferGeometry()) : new BufferGeometry();
    for (const piece of pieces) piece.dispose();
    cars.count = drawn.length * CARS_PER_EDGE;
    carData.needsUpdate = true;
    state.needsUpdate = true;
    curves.needsUpdate = true;
    highways = drawn;
  };

  const light = (blast: ReadonlyMap<string, number>, startOf: (distance: number) => number) => {
    for (const highway of highways) {
      const near = blast.get(highway.to);
      const far = blast.get(highway.from);
      const lit = near !== undefined && far !== undefined && far === near + 1;
      stateData[highway.index * 4] = lit ? 1 : 0;
      stateData[highway.index * 4 + 1] = lit ? startOf(near) : -1000;
    }
    state.needsUpdate = true;
  };

  return { group, textures: [state, curves], plan, light };
}
