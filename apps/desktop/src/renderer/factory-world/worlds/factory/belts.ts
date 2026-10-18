import { ZONE_EDGE_KIND, type ZoneEdge } from "@luke/ui/factory-world";
import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  DynamicDrawUsage,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
} from "three";
import type { Building } from "./buildings";
import { clamp, col, Geo, lerp, partGeo, smooth } from "./geo";
import { type Layout, type Lot, onRoadX, onRoadZ, ROAD } from "./layout";

/**
 * belts.ts -- the Factory's dependencies as conveyor belts: each zone's work carried out of what it depends on and into it, along racks over the roads.
 *
 * A belt runs from the building a zone depends on to the building that
 * depends on it, out along the street grid on one of ten lanes (five across
 * a road, two heights), each lane chosen to keep belts sharing a road apart.
 * Every belt is swept into one geometry whose vertices carry how far along
 * they are and which two zones they join, so the belt shader can run the
 * rubber, light a belt where the selected agent's blast radius reaches both
 * of its ends, and slow and redden one out of a zone with defects. Crates
 * ride the belts as one instanced mesh.
 */

/** Where across a road a lane runs, and how high. */
const LANES_X = [-2.4, -1.2, 0, 1.2, 2.4] as const;
const LANES_Y = [5.0, 6.6] as const;

/**
 * The most belts drawn. Note that this is a sacrifice: a belt is a swept
 * mesh of a couple of thousand vertices, and a repository at the contract's
 * two hundred zones can name several hundred edges, so past this many the
 * least-depended-on edges go unbelted. The blast radius and every zone stay
 * drawn whatever the belts show; the belts are the dependencies' picture.
 */
const MAX_BELTS = 100;

/** The most crates riding all of them. */
const MAX_RIDERS = 2400;

/** How fast a crate rides, in scene units a second. */
const BELT_SPEED = 2.2;

/** The belt's cross-section, without the underside no camera sees: outer side, lip, inner wall, rubber, inner wall, lip, outer side. */
const PROFILE = [
  [0.45, -0.22],
  [0.45, 0.15],
  [0.36, 0.15],
  [0.36, 0.03],
  [-0.36, 0.03],
  [-0.36, 0.15],
  [-0.45, 0.15],
  [-0.45, -0.22],
] as const;

/** Each face of the profile's paint: the frame, the rails on the lips, and the dark rubber. */
const FACE_PAINT = [
  "#959da8",
  "#b4bbc4",
  "#959da8",
  "#30343c",
  "#959da8",
  "#b4bbc4",
  "#959da8",
] as const;

interface Point {
  readonly x: number;
  readonly z: number;
}

/** A belt as built: the two lots it joins and its centre line sampled every half unit. */
export interface Belt {
  readonly source: Lot;
  readonly sink: Lot;
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly ys: Float32Array;
  readonly step: number;
  readonly length: number;
}

/** One crate on a belt: which, and how far along. */
interface Rider {
  readonly belt: number;
  offset: number;
}

/** Every belt, swept, and the crates riding them. */
export interface Belts {
  readonly list: readonly Belt[];
  readonly mesh: Mesh;
  readonly supports: Mesh;
  readonly crates: InstancedMesh;
  readonly riders: readonly Rider[];
}

const ORIENTATION = {
  ALONG_Z: "z",
  ALONG_X: "x",
} as const;

type Orientation = (typeof ORIENTATION)[keyof typeof ORIENTATION];

/** One straight stretch of a route, on the line it runs along. */
interface Stretch {
  readonly orientation: Orientation;
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

function dedupe(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last === undefined || Math.hypot(point.x - last.x, point.z - last.z) > 0.05)
      kept.push(point);
  }
  const straight: Point[] = [];
  kept.forEach((point, index) => {
    const before = straight.at(-1);
    const after = kept[index + 1];
    if (before === undefined || after === undefined) {
      straight.push(point);
      return;
    }
    const cross =
      (point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x);
    if (Math.abs(cross) > 1e-3) straight.push(point);
  });
  return straight;
}

/** `points` with each corner rounded to a quadratic curve of radius up to `radius`. */
function rounded(points: readonly Point[], radius: number): Point[] {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 3) return [...points];
  const out: Point[] = [first];
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    if (a === undefined || b === undefined || c === undefined) continue;
    const l1 = Math.hypot(b.x - a.x, b.z - a.z);
    const l2 = Math.hypot(c.x - b.x, c.z - b.z);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p0 = { x: b.x - ((b.x - a.x) / l1) * r, z: b.z - ((b.z - a.z) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, z: b.z + ((c.z - b.z) / l2) * r };
    for (let k = 0; k <= 6; k += 1) {
      const t = k / 6;
      const u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * b.x + t * t * p2.x,
        z: u * u * p0.z + 2 * u * t * b.z + t * t * p2.z,
      });
    }
  }
  out.push(last);
  return out;
}

/** `points` resampled every `step` units or a little less, so the samples land evenly. */
/** A centre line sampled evenly: its points, its length, and the step between them. */
interface Samples {
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly length: number;
  readonly step: number;
}

/** What every belt's sweep is written into, vertex by vertex. */
interface Sweep {
  readonly positions: number[];
  readonly colors: number[];
  readonly along: number[];
  readonly source: number[];
  readonly sink: number[];
}

function resampled(points: readonly Point[], step: number): Samples {
  const lengths: number[] = [];
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const piece = a === undefined || b === undefined ? 0 : Math.hypot(b.x - a.x, b.z - a.z);
    lengths.push(piece);
    length += piece;
  }
  const count = Math.max(2, Math.ceil(length / step) + 1);
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);
  let piece = 0;
  let walked = 0;
  for (let k = 0; k < count; k += 1) {
    const at = (length * k) / (count - 1);
    while (piece < lengths.length - 1 && walked + (lengths[piece] ?? 0) < at) {
      walked += lengths[piece] ?? 0;
      piece += 1;
    }
    const a = points[piece];
    const b = points[piece + 1] ?? a;
    const span = lengths[piece] ?? 0;
    const t = span > 0 ? clamp((at - walked) / span, 0, 1) : 0;
    xs[k] = lerp(a?.x ?? 0, b?.x ?? 0, t);
    zs[k] = lerp(a?.z ?? 0, b?.z ?? 0, t);
  }
  return { xs, zs, length, step: length / (count - 1) };
}

/** The route from `source`'s building to `sink`'s along the grid, on `lane`. */
function routeOf(layout: Layout, source: Lot, sink: Lot, lane: number): Point[] {
  const { xr, zr } = layout;
  const o = LANES_X[lane % 5] ?? 0;
  const line = (lines: readonly number[], index: number) => lines[index] ?? 0;
  let xa: number;
  let xc: number;
  if (sink.col > source.col) {
    xa = line(xr, source.col + 1);
    xc = line(xr, sink.col);
  } else if (sink.col < source.col) {
    xa = line(xr, source.col);
    xc = line(xr, sink.col + 1);
  } else {
    xa = line(xr, source.col + (lane % 2 ? 0 : 1));
    xc = xa;
  }
  const zm =
    sink.row > source.row
      ? line(zr, Math.floor((source.row + 1 + sink.row) / 2))
      : sink.row < source.row
        ? line(zr, Math.floor((sink.row + 1 + source.row) / 2))
        : undefined;
  const zSource = source.bz + o * 0.5;
  const zSink = sink.bz + o * 0.5;
  const exitOf = (lot: Lot, toward: number) => {
    const side = Math.sign(toward - lot.bx) || 1;
    return lot.bx + side * (lot.plan.w / 2 + (side > 0 ? lot.plan.eastX : 0) + 0.6);
  };
  const points: Point[] = [
    { x: exitOf(source, xa), z: zSource },
    { x: xa + o, z: zSource },
  ];
  if (zm === undefined) {
    if (xa !== xc) {
      const zz = line(zr, source.row + (lane % 2)) + o;
      points.push({ x: xa + o, z: zz }, { x: xc + o, z: zz });
    }
  } else {
    points.push({ x: xa + o, z: zm + o }, { x: xc + o, z: zm + o });
  }
  points.push({ x: xc + o, z: zSink }, { x: exitOf(sink, xc), z: zSink });
  return dedupe(points);
}

function stretchesOf(points: readonly Point[]): Stretch[] {
  const stretches: Stretch[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a.x - b.x) < 0.01) {
      stretches.push({
        orientation: ORIENTATION.ALONG_Z,
        line: Math.round(a.x / 2),
        from: Math.min(a.z, b.z),
        to: Math.max(a.z, b.z),
      });
    } else {
      stretches.push({
        orientation: ORIENTATION.ALONG_X,
        line: Math.round(a.z / 2),
        from: Math.min(a.x, b.x),
        to: Math.max(a.x, b.x),
      });
    }
  }
  return stretches;
}

/** The lanes already taken, by orientation, then line: each stretch and the lane it runs on. */
type LaneLedger = Map<Orientation, Map<number, { lane: number; from: number; to: number }[]>>;

/** What sharing roads with the belts already laid costs a route on `lane`: their overlap, thrice on the very same lane. */
function crowdingOf(ledger: LaneLedger, stretches: readonly Stretch[], lane: number): number {
  let cost = lane * 0.01;
  for (const stretch of stretches) {
    for (const used of ledger.get(stretch.orientation)?.get(stretch.line) ?? []) {
      if (used.lane % 5 !== lane % 5) continue;
      const overlap = Math.max(
        0,
        Math.min(used.to, stretch.to) - Math.max(used.from, stretch.from),
      );
      cost += overlap * (used.lane === lane ? 3 : 1);
    }
  }
  return cost;
}

function record(ledger: LaneLedger, stretches: readonly Stretch[], lane: number): void {
  for (const stretch of stretches) {
    const lines = ledger.get(stretch.orientation) ?? new Map();
    ledger.set(stretch.orientation, lines);
    const used = lines.get(stretch.line) ?? [];
    used.push({ lane, from: stretch.from, to: stretch.to });
    lines.set(stretch.line, used);
  }
}

/**
 * The edges drawn as belts, at most `MAX_BELTS`: a dependency before a zone
 * sitting inside another, and among each, the edge into what more of the
 * product depends on first, so the belts out of the core are the last to go.
 */
function beltEdgesOf(edges: readonly ZoneEdge[], layout: Layout): ZoneEdge[] {
  const weight = (edge: ZoneEdge) => layout.lotByPath.get(edge.to)?.zone.transitiveDependents ?? 0;
  const ranked = (kind: boolean) =>
    edges
      .filter((edge) => (edge.kind === ZONE_EDGE_KIND.DEPENDS) === kind)
      .map((edge, order) => ({ edge, order }))
      .sort((left, right) => weight(right.edge) - weight(left.edge) || left.order - right.order)
      .map(({ edge }) => edge);
  return [...ranked(true), ...ranked(false)].slice(0, MAX_BELTS);
}

/** Sweeps one belt's profile along its samples into `into`, tagged with its two lots. */
function sweep(belt: Belt, into: Sweep) {
  const { xs, zs, ys } = belt;
  const count = xs.length;
  const kept: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const at = k * belt.step;
    const ramp = at < 8 || at > belt.length - 8;
    const before = Math.max(0, k - 1);
    const after = Math.min(count - 1, k + 1);
    const turning =
      Math.abs(
        ((xs[k] ?? 0) - (xs[before] ?? 0)) * ((zs[after] ?? 0) - (zs[k] ?? 0)) -
          ((zs[k] ?? 0) - (zs[before] ?? 0)) * ((xs[after] ?? 0) - (xs[k] ?? 0)),
      ) > 1e-4;
    if ((k % 3 === 0 && (ramp || turning)) || k % 24 === 0 || k === count - 1) kept.push(k);
  }
  const frame = (k: number) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(count - 1, k + 1);
    let tx = (xs[b] ?? 0) - (xs[a] ?? 0);
    let tz = (zs[b] ?? 0) - (zs[a] ?? 0);
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    return { x: xs[k] ?? 0, y: ys[k] ?? 0, z: zs[k] ?? 0, nx: -tz, nz: tx, u: k * belt.step };
  };
  for (let q = 0; q < kept.length - 1; q += 1) {
    const a = frame(kept[q] ?? 0);
    const b = frame(kept[q + 1] ?? 0);
    for (let face = 0; face < PROFILE.length - 1; face += 1) {
      const p0 = PROFILE[face] ?? PROFILE[0];
      const p1 = PROFILE[face + 1] ?? PROFILE[0];
      const corner = (f: typeof a, p: readonly [number, number]) => [
        f.x + f.nx * p[0],
        f.y + p[1],
        f.z + f.nz * p[0],
      ];
      const a0 = corner(a, p0);
      const a1 = corner(a, p1);
      const b0 = corner(b, p0);
      const b1 = corner(b, p1);
      into.positions.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
      const paint = col(FACE_PAINT[face] ?? FACE_PAINT[0]);
      for (let vertex = 0; vertex < 6; vertex += 1) {
        into.colors.push(paint.r, paint.g, paint.b);
        into.source.push(belt.source.index);
        into.sink.push(belt.sink.index);
      }
      into.along.push(a.u, b.u, b.u, a.u, b.u, a.u);
    }
  }
}

/** Posts where a belt crosses a lot, and gantries where it runs along a road. */
function supportsOf(layout: Layout, list: readonly Belt[]): Geo {
  const geo = new Geo();
  const racks = new Map<Orientation, Map<number, Set<number>>>();
  const rack = (orientation: Orientation, line: number, at: number) => {
    const lines = racks.get(orientation) ?? new Map<number, Set<number>>();
    racks.set(orientation, lines);
    const spots = lines.get(line) ?? new Set<number>();
    spots.add(at);
    lines.set(line, spots);
  };
  for (const belt of list) {
    let lastPost = -99;
    for (let k = 0; k < belt.xs.length; k += 1) {
      const at = k * belt.step;
      const x = belt.xs[k] ?? 0;
      const z = belt.zs[k] ?? 0;
      const y = belt.ys[k] ?? 0;
      const offRoad = !onRoadX(layout, x) && !onRoadZ(layout, z);
      if (offRoad && at - lastPost > 5 && at > 2 && at < belt.length - 2) {
        geo.box(x, 0.2, z, 0.28, y - 0.48, 0.28, "#78828f");
        geo.box(x, y - 0.42, z, 1.3, 0.16, 0.3, "#78828f");
        lastPost = at;
      }
      if (offRoad) continue;
      const a = Math.max(0, k - 1);
      const b = Math.min(belt.xs.length - 1, k + 1);
      const alongZ =
        Math.abs((belt.xs[b] ?? 0) - (belt.xs[a] ?? 0)) <
        Math.abs((belt.zs[b] ?? 0) - (belt.zs[a] ?? 0));
      const lines = alongZ ? layout.xr : layout.zr;
      const line = lines.findIndex((value) => Math.abs((alongZ ? x : z) - value) < ROAD / 2);
      if (line >= 0)
        rack(
          alongZ ? ORIENTATION.ALONG_Z : ORIENTATION.ALONG_X,
          line,
          Math.round((alongZ ? z : x) / 14),
        );
    }
  }
  for (const [orientation, lines] of racks) {
    const alongZ = orientation === ORIENTATION.ALONG_Z;
    for (const [line, spots] of lines) {
      const centre = (alongZ ? layout.xr : layout.zr)[line] ?? 0;
      for (const spot of spots) {
        const at = spot * 14;
        if (alongZ ? onRoadZ(layout, at) : onRoadX(layout, at)) continue;
        if (alongZ && (at < layout.z0 || at > layout.z1)) continue;
        if (!alongZ && (at < layout.x0 || at > layout.x1)) continue;
        for (const s of [-1, 1]) {
          if (alongZ) geo.box(centre + s * (ROAD / 2 + 0.25), 0, at, 0.4, 7.0, 0.4, "#6c7786");
          else geo.box(at, 0, centre + s * (ROAD / 2 + 0.25), 0.4, 7.0, 0.4, "#6c7786");
        }
        for (const y of LANES_Y) {
          if (alongZ) geo.box(centre, y - 0.42, at, ROAD + 0.9, 0.22, 0.3, "#6c7786");
          else geo.box(at, y - 0.42, centre, 0.3, 0.22, ROAD + 0.9, "#6c7786");
        }
      }
    }
  }
  return geo;
}

/** Lays a belt along every drawn edge of `layout`'s zones, swept in `material`, crates and supports in `solid`. */
export function beltsOf(
  layout: Layout,
  buildings: readonly Building[],
  edges: readonly ZoneEdge[],
  material: Material,
  solid: Material,
): Belts {
  const ledger: LaneLedger = new Map();
  const list: Belt[] = [];
  for (const edge of beltEdgesOf(edges, layout)) {
    // Note that `from` depends on `to`, so work rides out of `to` and into `from`.
    const source = layout.lotByPath.get(edge.to);
    const sink = layout.lotByPath.get(edge.from);
    if (source === undefined || sink === undefined || source === sink) continue;
    let best = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let lane = 0; lane < 10; lane += 1) {
      const cost = crowdingOf(ledger, stretchesOf(routeOf(layout, source, sink, lane)), lane);
      if (cost < bestCost) {
        bestCost = cost;
        best = lane;
      }
    }
    const route = routeOf(layout, source, sink, best);
    record(ledger, stretchesOf(route), best);
    const height = LANES_Y[Math.floor(best / 5)] ?? LANES_Y[0];
    const samples = resampled(rounded(route, 2.4), 0.5);
    const startY = Math.min(height, Math.max(1.6, (buildings[source.index]?.top ?? 4) * 0.55));
    const endY = Math.min(height, Math.max(1.6, (buildings[sink.index]?.top ?? 4) * 0.55));
    const ys = new Float32Array(samples.xs.length);
    for (let k = 0; k < ys.length; k += 1) {
      const at = k * samples.step;
      const rise = lerp(startY, height, smooth(clamp(at / 7, 0, 1)));
      ys[k] = lerp(rise, endY, smooth(clamp((at - (samples.length - 7)) / 7, 0, 1)));
    }
    list.push({
      source,
      sink,
      xs: samples.xs,
      zs: samples.zs,
      ys,
      step: samples.step,
      length: samples.length,
    });
  }

  const arrays: Sweep = { positions: [], colors: [], along: [], source: [], sink: [] };
  for (const belt of list) sweep(belt, arrays);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(arrays.positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(arrays.colors), 3));
  geometry.setAttribute("aU", new BufferAttribute(new Float32Array(arrays.along), 1));
  geometry.setAttribute("aSource", new BufferAttribute(new Float32Array(arrays.source), 1));
  geometry.setAttribute("aSink", new BufferAttribute(new Float32Array(arrays.sink), 1));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const supports = new Mesh(supportsOf(layout, list).build(), solid);
  supports.castShadow = true;
  supports.receiveShadow = true;

  const riders: Rider[] = [];
  list.forEach((belt, index) => {
    const count = Math.max(2, Math.floor(belt.length / 5.2));
    for (let k = 0; k < count && riders.length < MAX_RIDERS; k += 1) {
      riders.push({ belt: index, offset: (k / count) * belt.length });
    }
  });
  const crate = partGeo((g) => {
    g.box(0, 0, 0, 0.55, 0.42, 0.55, "#ffffff");
    g.box(0, 0.42, 0, 0.58, 0.05, 0.58, "#dddddd");
  });
  const crates = new InstancedMesh(crate, solid, Math.max(1, riders.length));
  crates.count = riders.length;
  crates.frustumCulled = false;
  crates.instanceMatrix.setUsage(DynamicDrawUsage);
  return { list, mesh, supports, crates, riders };
}

const placed = new Matrix4();

/**
 * Moves every crate `delta` seconds along its belt and places it: a belt out
 * of a damaged zone (`jammed`) stutters at a quarter of the speed, its
 * crates bunching at its start.
 */
export function rideBelts(
  belts: Belts,
  delta: number,
  time: number,
  jammed: (belt: Belt) => boolean,
): void {
  belts.riders.forEach((rider, index) => {
    const belt = belts.list[rider.belt];
    if (belt === undefined) return;
    const jam = jammed(belt);
    const speed = jam
      ? BELT_SPEED * 0.25 * Math.max(0, Math.sin(time * 0.9 + rider.belt))
      : BELT_SPEED;
    rider.offset = (rider.offset + speed * delta) % belt.length;
    const along = jam ? belt.length * (rider.offset / belt.length) ** 0.55 : rider.offset;
    const k = clamp(Math.floor(along / belt.step), 0, belt.xs.length - 2);
    const f = along / belt.step - k;
    const x = lerp(belt.xs[k] ?? 0, belt.xs[k + 1] ?? 0, f);
    const z = lerp(belt.zs[k] ?? 0, belt.zs[k + 1] ?? 0, f);
    const y = lerp(belt.ys[k] ?? 0, belt.ys[k + 1] ?? 0, f);
    placed.makeRotationY(
      Math.atan2(
        (belt.xs[k + 1] ?? 0) - (belt.xs[k] ?? 0),
        (belt.zs[k + 1] ?? 0) - (belt.zs[k] ?? 0),
      ),
    );
    placed.setPosition(x, y + 0.3, z);
    belts.crates.setMatrixAt(index, placed);
  });
  belts.crates.instanceMatrix.needsUpdate = true;
}

/** Paints every crate: `lit` ones in `glow`, the rest kraft. */
export function paintCrates(belts: Belts, lit: (belt: Belt) => boolean, glow: Color): void {
  const kraft = col("#c9a46e");
  belts.riders.forEach((rider, index) => {
    const belt = belts.list[rider.belt];
    belts.crates.setColorAt(index, belt !== undefined && lit(belt) ? glow : kraft);
  });
  if (belts.crates.instanceColor !== null) belts.crates.instanceColor.needsUpdate = true;
}
