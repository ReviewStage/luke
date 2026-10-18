import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { ZoneEdge } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  type Scene,
  Vector3,
} from "three";
import { CITY, type CityLayout, DISTRICT_KIND, type District } from "./city";
import type { ZoneLight } from "./districts";
import { bendableTube, GLSL_BEND, instancedAttribute } from "./geometry";
import type { Sea } from "./sea";

/**
 * pipes.ts -- the dependencies as Atlantis draws them: glass transit tubes arching between the districts, pods shuttling through them, and warm beams of light between the crystals under the great dome.
 *
 * A tube runs from the district that depends to the one it depends on, out
 * of the side of each that faces the other and up over the water between,
 * bent along a Bézier in its shader, so every tube is one instance of one
 * mesh and its pods ride the same curve on the clock alone. A tube between
 * two zones the developer's focus lights glows with it; the rest dim. Where
 * a defect hurts a zone, one pod in each of its tubes runs red, leaving the
 * damage behind.
 */

/**
 * The most tubes drawn: eight to a zone. A denser graph draws the tubes the
 * developer's focus lights first, then the rest in the view's order, and
 * leaves the remainder out rather than drawing a tangle no one could read.
 */
const TUBES = FACTORY_WORLD_BOUNDS.MAX_ZONES * 8;

/** How many pods ride each tube. */
const PODS_PER_TUBE = 2;

/** The dependencies between districts, as tubes and beams. */
export interface Pipes {
  /** Lays the tubes along `edges` between `layout`'s districts, lit by `lights`, carrying red pods out of each zone `hurt` names. */
  readonly draw: (
    layout: CityLayout,
    edges: readonly ZoneEdge[],
    lights: readonly ZoneLight[],
  ) => void;
}

const TUBE_VERTEX = /* glsl */ `${GLSL_BEND}
attribute vec4 aTube;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec4 vTube;
void main(){
  vec3 p = bendTube(position, aTube.x);
  vec3 c = bendAt(position.x);
  vec4 w = modelMatrix*vec4(p,1.0);
  vUv = uv; vTube = aTube; vN = normalize(p - c); vV = cameraPosition - w.xyz;
  vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const TUBE_FRAGMENT = /* glsl */ `
uniform vec3 uHiColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec4 vTube;
void main(){
  float len = vTube.y; float hi = vTube.z; float dim = vTube.w;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float strip = exp(-pow((fract(vUv.y)-0.5)*14.0, 2.0));
  float flow = pow(fract(vUv.x*len/7.0 - uTime*0.6), 6.0);
  vec3 water = mix(vec3(0.4,0.9,1.0), uHiColor, hi);
  vec3 c = water*(0.03 + fres*0.32) + mix(vec3(0.5,0.95,1.0), uHiColor*1.4, hi)*strip*(0.12 + flow*0.45);
  c += uHiColor*hi*(0.1 + flow*0.6);
  float a = (0.05 + fres*0.4 + strip*0.3)*dim + hi*0.15;
  c *= mix(dim, 1.0, hi);
  float f = fogF(vDepth);
  gl_FragColor = vec4(mix(c, uFogColor, f), a*(1.0-f*0.6));
}`;

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uHiColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; varying vec4 vTube;
void main(){
  float flow = pow(fract(vUv.x*vTube.y/5.0 - uTime*0.8), 4.0);
  vec3 c = vec3(1.0,0.72,0.35)*(0.35 + flow*2.2)*vTube.w + uHiColor*vTube.z*2.0;
  gl_FragColor = vec4(c*(1.0-fogF(vDepth)), 1.0);
}`;

const POD_VERTEX = /* glsl */ `${GLSL_BEND}
attribute vec4 aPod;
varying float vDepth; varying float vBad;
void main(){
  float len = aPod.y; float bad = aPod.w;
  float u = fract(uTime*(bad > 0.0 ? 5.0 : 9.0)/len + aPod.x);
  if (aPod.z < 0.0) u = 1.0 - u;
  vec3 t = bendTangent(u);
  vec3 side = normalize(cross(t, abs(t.y) > 0.98 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0)));
  vec3 up = cross(side, t);
  float grow = bad > 0.0 ? 1.5 : 1.0;
  vec3 p = bendAt(u) + (side*position.x + up*position.y + t*position.z)*grow;
  vBad = bad;
  vec4 mv = viewMatrix*modelMatrix*vec4(p,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;
}`;

const POD_FRAGMENT = /* glsl */ `
uniform vec3 uDefect; varying float vDepth; varying float vBad;
void main(){
  vec3 c = mix(vec3(0.75,0.97,1.0)*1.5, uDefect*1.15, step(0.01, vBad));
  gl_FragColor = vec4(mix(c, uFogColor, fogF(vDepth)), 1.0);
}`;

/** Where a tube leaves `district` towards `toward`: the great dome's wall for a crystal, the plinth's or the reef's side for the rest. */
function portOf(district: District, toward: Vector3): Vector3 {
  const from = district.kind === DISTRICT_KIND.CRYSTAL ? new Vector3() : district.centre;
  const out = new Vector3(toward.x - from.x, 0, toward.z - from.z);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  out.normalize();
  switch (district.kind) {
    case DISTRICT_KIND.CRYSTAL:
      return out.multiplyScalar(CITY.DOME_RADIUS + 1).setY(3);
    case DISTRICT_KIND.DOME:
      return district.centre
        .clone()
        .addScaledVector(out, district.radius + 1.6)
        .setY(1.2);
    default:
      return district.centre
        .clone()
        .addScaledVector(out, district.radius * 1.1)
        .setY(Math.min(district.base, 3.2));
  }
}

/** The control point that bends a quadratic Bézier from `from` to `to` through `middle` at its half. */
function bendThrough(from: Vector3, middle: Vector3, to: Vector3): Vector3 {
  return middle.clone().multiplyScalar(2).addScaledVector(from, -0.5).addScaledVector(to, -0.5);
}

/** A quadratic Bézier's length, summed over a few chords. */
export function bentLength(from: Vector3, bend: Vector3, to: Vector3): number {
  let length = 0;
  const last = from.clone();
  const point = new Vector3();
  for (let step = 1; step <= 12; step += 1) {
    const u = step / 12;
    const w = 1 - u;
    point
      .copy(from)
      .multiplyScalar(w * w)
      .addScaledVector(bend, 2 * u * w)
      .addScaledVector(to, u * u);
    length += point.distanceTo(last);
    last.copy(point);
  }
  return length;
}

/** The pipes of `scene`, glowing in `highlight` where the focus lies. */
export function pipesOf(scene: Scene, sea: Sea): Pipes {
  const highlight = { value: new Color(sea.signal.BLAST_RADIUS) };
  const tubeShape = bendableTube(40, 10);
  const tubeFrom = instancedAttribute(tubeShape, "aFrom", 3, TUBES);
  const tubeBend = instancedAttribute(tubeShape, "aBend", 3, TUBES);
  const tubeTo = instancedAttribute(tubeShape, "aTo", 3, TUBES);
  const tubeLook = instancedAttribute(tubeShape, "aTube", 4, TUBES);
  const tubes = new InstancedMesh(
    tubeShape,
    sea.shader({ uHiColor: highlight }, TUBE_VERTEX, TUBE_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
    TUBES,
  );
  tubes.renderOrder = 4;
  const beamShape = bendableTube(32, 6);
  const beamFrom = instancedAttribute(beamShape, "aFrom", 3, TUBES);
  const beamBend = instancedAttribute(beamShape, "aBend", 3, TUBES);
  const beamTo = instancedAttribute(beamShape, "aTo", 3, TUBES);
  const beamLook = instancedAttribute(beamShape, "aTube", 4, TUBES);
  const beams = new InstancedMesh(
    beamShape,
    sea.shader({ uHiColor: highlight }, TUBE_VERTEX, BEAM_FRAGMENT, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    TUBES,
  );
  const podShape = new CapsuleGeometry(0.24, 0.9, 4, 8).rotateX(Math.PI / 2);
  const podFrom = instancedAttribute(podShape, "aFrom", 3, TUBES * PODS_PER_TUBE);
  const podBend = instancedAttribute(podShape, "aBend", 3, TUBES * PODS_PER_TUBE);
  const podTo = instancedAttribute(podShape, "aTo", 3, TUBES * PODS_PER_TUBE);
  const podLook = instancedAttribute(podShape, "aPod", 4, TUBES * PODS_PER_TUBE);
  const pods = new InstancedMesh(
    podShape,
    sea.shader({}, POD_VERTEX, POD_FRAGMENT),
    TUBES * PODS_PER_TUBE,
  );
  for (const mesh of [tubes, beams, pods]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  const middle = new Vector3();
  const lightOf = (lights: readonly ZoneLight[], district: District) => lights[district.index];
  return {
    draw: (layout, edges, lights) => {
      const focused = lights.some((light) => light.dim < 1);
      let tube = 0;
      let beam = 0;
      let pod = 0;
      const lit = (path: string) => (lights[layout.byPath.get(path)?.index ?? -1]?.lit ?? 0) > 0;
      const inFocus = (edge: ZoneEdge) => lit(edge.from) && lit(edge.to);
      const ordered = [...edges.filter(inFocus), ...edges.filter((edge) => !inFocus(edge))];
      ordered.forEach((edge, order) => {
        const from = layout.byPath.get(edge.from);
        const to = layout.byPath.get(edge.to);
        if (from === undefined || to === undefined || from === to) return;
        const fromLight = lightOf(lights, from);
        const toLight = lightOf(lights, to);
        // Note that a tube glows where both its ends are in the focus, and dims with the rest of the city where they are not.
        const inFocus = (light: ZoneLight | undefined) => light !== undefined && light.lit > 0;
        const lit = inFocus(fromLight) && inFocus(toLight) ? 1 : 0;
        const dim = focused && lit === 0 ? 0.25 : 1;
        if (from.kind === DISTRICT_KIND.CRYSTAL && to.kind === DISTRICT_KIND.CRYSTAL) {
          if (beam >= TUBES) return;
          const start = new Vector3(from.centre.x, from.base + from.height * 0.62, from.centre.z);
          const end = new Vector3(to.centre.x, to.base + to.height * 0.62, to.centre.z);
          middle.lerpVectors(start, end, 0.5).y += 6;
          const bend = bendThrough(start, middle, end);
          beamFrom.setXYZ(beam, start.x, start.y, start.z);
          beamBend.setXYZ(beam, bend.x, bend.y, bend.z);
          beamTo.setXYZ(beam, end.x, end.y, end.z);
          beamLook.setXYZW(beam, 0.16, bentLength(start, bend, end), lit, dim);
          beam += 1;
          return;
        }
        if (tube >= TUBES) return;
        const start = portOf(from, to.kind === DISTRICT_KIND.CRYSTAL ? new Vector3() : to.centre);
        const end = portOf(to, from.centre);
        middle.lerpVectors(start, end, 0.5).y =
          Math.max(start.y, end.y) + 5 + start.distanceTo(end) * 0.13;
        const bend = bendThrough(start, middle, end);
        const length = bentLength(start, bend, end);
        tubeFrom.setXYZ(tube, start.x, start.y, start.z);
        tubeBend.setXYZ(tube, bend.x, bend.y, bend.z);
        tubeTo.setXYZ(tube, end.x, end.y, end.z);
        tubeLook.setXYZW(tube, 0.42, length, lit, dim);
        tube += 1;
        // Note that a defect's pod leaves the hurt end: from `to` back along the tube where the dependency is hurt, else out of the dependent.
        const hurt = Math.max(toLight?.hurt ?? 0, fromLight?.hurt ?? 0);
        const outOfTo = (toLight?.hurt ?? 0) >= (fromLight?.hurt ?? 0);
        for (let rider = 0; rider < PODS_PER_TUBE; rider += 1) {
          const bad = rider === 0 && hurt > 0 ? hurt : 0;
          const direction = bad > 0 ? (outOfTo ? -1 : 1) : rider % 2 === 1 ? -1 : 1;
          podFrom.setXYZ(pod, start.x, start.y, start.z);
          podBend.setXYZ(pod, bend.x, bend.y, bend.z);
          podTo.setXYZ(pod, end.x, end.y, end.z);
          podLook.setXYZW(pod, rider / PODS_PER_TUBE + order * 0.137, length, direction, bad);
          pod += 1;
        }
      });
      tubes.count = tube;
      beams.count = beam;
      pods.count = pod;
      for (const attribute of [
        tubeFrom,
        tubeBend,
        tubeTo,
        tubeLook,
        beamFrom,
        beamBend,
        beamTo,
        beamLook,
        podFrom,
        podBend,
        podTo,
        podLook,
      ]) {
        attribute.needsUpdate = true;
      }
    },
  };
}
