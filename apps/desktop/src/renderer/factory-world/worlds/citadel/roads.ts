import { ZONE_LAYER, type ZoneEdge } from "@luke/ui/factory-world";
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import type { ZoneSite } from "./layout";
import { angleBetween, clamp, lerp, placed, polar } from "./math";
import { groundAt, HILL, INNER_GATES, KEEP_GATES } from "./terrain";

/**
 * roads.ts -- the dependency roads: one from each zone to every zone it depends on, following the terraces' ring roads and passing the walls only at their gates, and the blast radius running down them.
 *
 * A route climbs or descends a terrace at a time, through whichever of that
 * wall's gates is the shorter way round, and keeps to a ring road between;
 * arcs are walked in polar steps so they follow the hill. Every road is laid
 * as flat segments of one instanced mesh. Where the selected agent's work
 * ripples from one zone to the next, the road between them carries a run of
 * light in the blast radius's colour.
 */

/** The most road segments the town lays, at a segment every `SEGMENT_LENGTH` units. */
const MAX_SEGMENTS = 14000;
const SEGMENT_LENGTH = 1.4;
const ROAD_WIDTH = 1.1;

/** A route on the floor: its points and the distance walked to each. */
export interface Route {
  readonly points: readonly (readonly [number, number])[];
  readonly walked: readonly number[];
  readonly length: number;
}

interface Polar {
  readonly r: number;
  readonly angle: number;
}

/** Each wall a route crosses, by the terrace inside it: its gates, and the radii a route meets it at inside and outside. */
function boundsOf(outerGates: readonly number[]) {
  return [
    { gates: KEEP_GATES, inside: 10.5, outside: 20.2 },
    { gates: INNER_GATES, inside: 34.1, outside: 44.1 },
    { gates: outerGates, inside: HILL.OUTER_RADIUS - 2.4, outside: HILL.OUTER_RADIUS + 2.6 },
  ] as const;
}

/** The ring roads within each terrace. */
const TERRACE_RINGS = [[], [18.9, 34.4], [44.6], [50.2]] as const;

function terraceOf(r: number): number {
  if (r < HILL.KEEP_RADIUS + 0.3) return 0;
  if (r < HILL.INNER_RADIUS + 0.4) return 1;
  if (r < HILL.OUTER_RADIUS) return 2;
  return 3;
}

/** The way from `a` to `b` within one terrace: straight where they are near or on the crown, else out to its ring road, round it, and in. */
function within(a: Polar, b: Polar, terrace: number): Polar[] {
  if (terrace === 0) return [a, b];
  if (Math.abs(angleBetween(b.angle, a.angle)) * Math.min(a.r, b.r) < 3.5) return [a, b];
  const rings: readonly number[] = TERRACE_RINGS[terrace] ?? [];
  let ring = rings[0] ?? a.r;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of rings) {
    const cost = Math.abs(a.r - candidate) + Math.abs(b.r - candidate) + (candidate < 25 ? 6 : 0);
    if (cost < best) {
      best = cost;
      ring = candidate;
    }
  }
  if (terrace === 3 && Math.max(a.r, b.r) > 64) ring = 64;
  return [a, { r: ring, angle: a.angle }, { r: ring, angle: b.angle }, b];
}

/** A route from `ax, az` to `bx, bz` by the terraces' rings and gates, smoothed. */
export function routeOf(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  outerGates: readonly number[],
): Route {
  const bounds = boundsOf(outerGates);
  const a = { r: Math.hypot(ax, az), angle: Math.atan2(az, ax) };
  const b = { r: Math.hypot(bx, bz), angle: Math.atan2(bz, bx) };
  const waypoints: Polar[] = [a];
  let at: Polar = a;
  let terrace = terraceOf(a.r);
  const goal = terraceOf(b.r);
  for (let guard = 0; terrace !== goal && guard < 6; guard += 1) {
    const up = goal > terrace;
    const bound = bounds[up ? terrace : terrace - 1];
    if (bound === undefined) break;
    let gate = bound.gates[0] ?? at.angle;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of bound.gates) {
      const cost =
        Math.abs(angleBetween(at.angle, candidate)) * (at.r + 5) +
        Math.abs(angleBetween(candidate, b.angle)) * (b.r + 5);
      if (cost < best) {
        best = cost;
        gate = candidate;
      }
    }
    const entry = { r: up ? bound.inside : bound.outside, angle: gate };
    const exit = { r: up ? bound.outside : bound.inside, angle: gate };
    waypoints.push(...within(at, entry, terrace).slice(1), exit);
    at = exit;
    terrace += up ? 1 : -1;
  }
  waypoints.push(...within(at, b, terrace).slice(1));
  return smoothed(densified(waypoints));
}

/** The waypoints walked in steps under a unit, arcs in polar steps so they follow the rings. */
function densified(waypoints: readonly Polar[]): [number, number][] {
  const points: [number, number][] = [];
  for (const [index, from] of waypoints.entries()) {
    const to = waypoints[index + 1];
    if (to === undefined) break;
    const straight = from.r < HILL.KEEP_RADIUS || to.r < HILL.KEEP_RADIUS;
    const [fx, fz] = polar(from.r, from.angle);
    const [tx, tz] = polar(to.r, to.angle);
    const turn = angleBetween(to.angle, from.angle);
    const length = straight
      ? Math.hypot(tx - fx, tz - fz)
      : Math.abs(to.r - from.r) + Math.abs(turn) * ((from.r + to.r) / 2);
    const steps = Math.max(1, Math.ceil(length / 0.9));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      points.push(
        straight
          ? [lerp(fx, tx, t), lerp(fz, tz, t)]
          : [...polar(lerp(from.r, to.r, t), from.angle + turn * t)],
      );
    }
  }
  const last = waypoints.at(-1);
  if (last !== undefined) points.push([...polar(last.r, last.angle)]);
  return points;
}

/** Corners cut twice (Chaikin), and the distance walked to each point. */
function smoothed(input: readonly (readonly [number, number])[]): Route {
  let points = input;
  for (let pass = 0; pass < 2; pass += 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) break;
    const cut: (readonly [number, number])[] = [first];
    for (const [index, p] of points.entries()) {
      const q = points[index + 1];
      if (q === undefined) break;
      cut.push(
        [p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25],
        [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75],
      );
    }
    cut.push(last);
    points = cut;
  }
  const walked = [0];
  for (const [index, point] of points.entries()) {
    const before = points[index - 1];
    if (before !== undefined)
      walked.push((walked.at(-1) ?? 0) + Math.hypot(point[0] - before[0], point[1] - before[1]));
  }
  return { points, walked, length: walked.at(-1) ?? 0 };
}

/** Where a route stands `distance` along it, and which way it heads there. */
export function along(
  route: Route,
  distance: number,
  out: { x: number; z: number; dx: number; dz: number },
): void {
  const d = clamp(distance, 0, route.length);
  let low = 0;
  let high = route.walked.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((route.walked[middle] ?? 0) <= d) low = middle;
    else high = middle;
  }
  const from = route.points[low] ?? [0, 0];
  const to = route.points[high] ?? from;
  const span = (route.walked[high] ?? 0) - (route.walked[low] ?? 0) || 1;
  const t = (d - (route.walked[low] ?? 0)) / span;
  out.x = lerp(from[0], to[0], t);
  out.z = lerp(from[1], to[1], t);
  out.dx = to[0] - from[0];
  out.dz = to[1] - from[1];
}

/** Where a zone's roads meet it: the crown's foot for the keep, the curtain's inside for the town, its door for the rest. */
function doorOf(site: ZoneSite): readonly [number, number] {
  if (site.heart) return polar(5, KEEP_GATES[0] ?? 0);
  if (site.layer === ZONE_LAYER.SURFACE) return polar(HILL.OUTER_RADIUS - 2, site.angle);
  if (site.layer === ZONE_LAYER.TOOLING) return polar(site.radius - site.size - 1, site.angle);
  return [site.x, site.z];
}

/** The roads as the world draws them: laid once per town, and lit along the blast radius. */
export interface Roads {
  readonly mesh: InstancedMesh;
  /** Lays a road for each edge between two zones of the product, the keep's own roads left out. */
  readonly lay: (
    edges: readonly ZoneEdge[],
    sites: ReadonlyMap<string, ZoneSite>,
    outerGates: readonly number[],
  ) => void;
  /** Lights each road a blast ripples down, from a zone to one a step further out. */
  readonly light: (blast: ReadonlyMap<string, number>) => void;
  readonly step: (elapsed: number) => void;
}

/** The roads' one mesh, allocated at `MAX_SEGMENTS`, drawn in `blastColor` where the blast runs. */
export function buildRoads(blastColor: string): Roads {
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // Note that each segment carries how far along its road it starts, its length, and whether the blast runs down it.
  const run = new InstancedBufferAttribute(new Float32Array(MAX_SEGMENTS * 3), 3);
  geometry.setAttribute("aRoad", run);
  const material = new MeshStandardMaterial({
    color: "#b39469",
    roughness: 1,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const time = { value: 0 };
  const glow = { value: new Color(blastColor) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uBlast = glow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aRoad;\nvarying float vRun;\nvarying float vFlow;\nvarying float vAcross;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRun = aRoad.x + (position.x + 0.5) * aRoad.y;\nvFlow = aRoad.z;\nvAcross = position.z + 0.5;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform vec3 uBlast;\nvarying float vRun;\nvarying float vFlow;\nvarying float vAcross;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float citadelDash = smoothstep(0.35, 1.0, fract((vRun - uTime * 7.0) / 3.2));
        float citadelMiddle = 1.0 - abs(vAcross * 2.0 - 1.0);
        totalEmissiveRadiance += uBlast * vFlow * citadelMiddle * (0.7 + citadelDash * 2.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, uBlast, vFlow * 0.6);`,
      );
  };
  const mesh = new InstancedMesh(geometry, material, MAX_SEGMENTS);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.count = 0;
  mesh.frustumCulled = false;
  const matrix = new Matrix4();
  let laid: { from: string; to: string; first: number; count: number }[] = [];

  return {
    mesh,
    lay: (edges, sites, outerGates) => {
      laid = [];
      let count = 0;
      for (const edge of edges) {
        const from = sites.get(edge.from);
        const to = sites.get(edge.to);
        if (from === undefined || to === undefined) continue;
        if (from.layer === ZONE_LAYER.TOOLING || to.layer === ZONE_LAYER.TOOLING) continue;
        if (from.layer === ZONE_LAYER.CORE && to.layer === ZONE_LAYER.CORE) continue;
        const [ax, az] = doorOf(to);
        const [bx, bz] = doorOf(from);
        const route = routeOf(ax, az, bx, bz, outerGates);
        const segments = Math.max(1, Math.ceil(route.length / SEGMENT_LENGTH));
        if (count + segments > MAX_SEGMENTS) break;
        const first = count;
        const point = { x: 0, z: 0, dx: 0, dz: 0 };
        for (let segment = 0; segment < segments; segment += 1) {
          const start = (segment / segments) * route.length;
          const length = route.length / segments;
          along(route, start + length / 2, point);
          // Note that a segment tilts from the ground at its back end to the ground at its front, so a road climbs a ramp.
          const heading = Math.hypot(point.dx, point.dz) || 1;
          const reachX = (point.dx / heading) * length * 0.5;
          const reachZ = (point.dz / heading) * length * 0.5;
          const backY = groundAt(point.x - reachX, point.z - reachZ);
          const frontY = groundAt(point.x + reachX, point.z + reachZ);
          const tilt = Math.atan2(frontY - backY, length);
          const yaw = Math.atan2(-point.dz, point.dx);
          placed(
            matrix,
            point.x,
            (backY + frontY) / 2 + 0.08,
            point.z,
            yaw,
            length + 0.1,
            1,
            ROAD_WIDTH,
            0,
            tilt,
          );
          mesh.setMatrixAt(count, matrix);
          run.setXYZ(count, start, length + 0.1, 0);
          count += 1;
        }
        laid.push({ from: edge.from, to: edge.to, first, count: segments });
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      run.needsUpdate = true;
    },
    light: (blast) => {
      for (const road of laid) {
        const near = blast.get(road.to);
        const far = blast.get(road.from);
        const lit = near !== undefined && far !== undefined && far === near + 1 ? 1 : 0;
        for (let segment = road.first; segment < road.first + road.count; segment += 1)
          run.setZ(segment, lit);
      }
      run.needsUpdate = true;
    },
    step: (elapsed) => {
      time.value = elapsed;
    },
  };
}
