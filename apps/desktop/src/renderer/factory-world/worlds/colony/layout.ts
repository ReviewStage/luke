import {
  type FactoryWorldView,
  ZONE_LAYER,
  type ZoneEdge,
  type ZoneLayer,
  type ZoneView,
} from "@luke/ui/factory-world";
import { Vector3 } from "three";
import { clamp, hashUnit, UP } from "./shapes";

/**
 * layout.ts -- the repository cut open as an ant farm: where each zone's chamber is dug, the tunnels its dependencies bore between them, the shafts up to the meadow, and the routes an ant walks.
 *
 * The terrarium is a slab of soil seen in cross-section through its glass,
 * and the view model's polar floor is unrolled into it: a zone's angle on the
 * floor is how far across the slab it digs, and its ring is how deep. The
 * surface zones are anthills on the meadow with a chamber just under the
 * turf, set back on the meadow by their place in the ring; the domain digs
 * in the band below them and the core in the band below that, each zone
 * shallower the further out it stands in its ring. Tooling stands apart from
 * the product, as workshops stacked against the two side walls, each wall's
 * own shaft up to the meadow.
 *
 * So the same path lands in the same place every time, and a directory's
 * zones dig side by side. Where two chambers would overlap they are pushed
 * apart, and nothing else moves them; a band too crowded for its chambers
 * shrinks them all alike.
 *
 * Every dependency is a tunnel from the dependent's floor to its
 * dependency's, after a transitive reduction, so a zone that reaches the
 * core through another is not bored to it twice.
 */

export const COLONY = {
  /** The slab's width, x from -HALF to HALF. */
  WIDTH: 130,
  HALF: 65,
  /** The soil's depth, y from 0 down. */
  DEPTH: 54,
  /** The slab's thickness, z from 0 back. */
  SLAB: 16,
  TUNNEL_RADIUS: 0.86,
  /** The ant highway along the meadow's front. */
  TRAIL_Z: -1.9,
  /** Where the anthills stand on the meadow. */
  MOUND_Z: -8.5,
  GLASS_Z: 0.36,
} as const;

/** What a surface zone's anthill is dressed as. */
export const MOUND_KIND = {
  HILL: "hill",
  LEAF: "leaf",
  MUSHROOM: "mushroom",
  TWIGS: "twigs",
  CAIRN: "cairn",
} as const;

type MoundKind = (typeof MOUND_KIND)[keyof typeof MOUND_KIND];

/** How deep each underground layer digs: its ring's outer edge at the top of its band, its inner edge at the bottom. */
const BAND = {
  DOMAIN: { top: -11.5, bottom: -33 },
  CORE: { top: -36.5, bottom: -51 },
} as const;

/** How many rounds overlapping chambers are pushed apart for. */
const RELAX_ROUNDS = 240;

/** The least room between two neighbours in a row. */
const GAP = 0.8;

/** How far the tunnel's floor stands above its chamber's floor. */
const PORT_HEIGHT = COLONY.TUNNEL_RADIUS * 0.84;

/** The most tunnels drawn; a reduced graph of the contract's 200 zones comes nowhere near it. */
export const MAX_TUNNELS = 400;

/** The node the routing graph names the meadow by. */
const MEADOW = -1;

/** The extra length a route pays to cross the meadow, so ants keep to the tunnels. */
const MEADOW_TOLL = 18;

/** One zone's chamber in the slab. */
export interface Chamber {
  readonly zone: ZoneView;
  /** Its place in `Burrows.chambers`, which every per-zone instance and texel is indexed by. */
  readonly index: number;
  readonly surface: boolean;
  readonly tooling: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rz: number;
  /** The packed floor, a little above the cavity's bottom. */
  floorY: number;
  /** The floor's half extents. */
  fx: number;
  fz: number;
  /** Where its tunnels leave it. */
  portY: number;
  /** The two phases its outline wobbles by. */
  readonly sa: number;
  readonly sb: number;
  /** Its shaft's x, where one climbs from it. */
  shaftX: number | undefined;
  mound: Mound | undefined;
}

/** A surface zone's anthill on the meadow. */
export interface Mound {
  x: number;
  z: number;
  /** Its radius across, and along the slab. */
  r: number;
  rz: number;
  readonly kind: MoundKind;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** A tunnel bored for one dependency: `from` depends on `to`. */
interface Tunnel {
  readonly from: Chamber;
  readonly to: Chamber;
  /** Its centreline, from `from`'s port to `to`'s. */
  readonly center: readonly Point2[];
  /** The stretch of the centreline outside both chambers, where the tube is drawn. */
  readonly open: { readonly first: number; readonly last: number };
  /** The line an ant's feet follow, from `from` to `to`. */
  readonly line: Poly;
  readonly length: number;
}

/** A vertical bore: x, from `bottom` up to `top`. */
interface Bore {
  readonly x: number;
  readonly bottom: number;
  readonly top: number;
}

/** Where a team works: on a chamber's floor, around an anthill on the meadow, or out on the meadow. */
export interface WorkPoint {
  readonly chamber: Chamber | undefined;
  readonly p: Vector3;
  /** Around an anthill: its angle and its distance out. */
  readonly th: number;
  readonly d: number;
}

/** A walkable polyline: each point with its own up and whether the passage is narrow there. */
export class Poly {
  readonly points: Vector3[] = [];
  readonly ups: Vector3[] = [];
  readonly narrow: number[] = [];

  add(point: Vector3, up: Vector3 = UP, narrow = 0): Poly {
    const last = this.points.at(-1);
    if (last !== undefined && last.distanceToSquared(point) < 1e-4) return this;
    this.points.push(point.clone());
    this.ups.push(up.clone().normalize());
    this.narrow.push(narrow);
    return this;
  }

  addPoly(other: Poly): Poly {
    other.points.forEach((point, index) => {
      this.add(point, other.ups[index], other.narrow[index]);
    });
    return this;
  }

  reversed(): Poly {
    const poly = new Poly();
    poly.points.push(...[...this.points].reverse());
    poly.ups.push(...[...this.ups].reverse());
    poly.narrow.push(...[...this.narrow].reverse());
    return poly;
  }

  length(): number {
    let length = 0;
    for (let index = 1; index < this.points.length; index += 1) {
      length += this.points[index]?.distanceTo(this.points[index - 1] ?? UP) ?? 0;
    }
    return length;
  }
}

/** A polyline measured for walking: `at(s)` is where an ant stands `s` along it. */
export class Path {
  readonly poly: Poly;
  readonly lengths: number[] = [0];
  readonly length: number;

  constructor(poly: Poly) {
    this.poly = poly;
    const points = poly.points;
    for (let index = 1; index < points.length; index += 1) {
      const step = points[index]?.distanceTo(points[index - 1] ?? UP) ?? 0;
      this.lengths.push((this.lengths[index - 1] ?? 0) + step);
    }
    this.length = this.lengths.at(-1) ?? 0;
  }

  /** Writes where `s` along stands into `position` and its up into `up`; answers how narrow it is there. */
  at(s: number, position: Vector3, up: Vector3): number {
    const { points, ups, narrow } = this.poly;
    const first = points[0];
    if (first === undefined) return 0;
    if (points.length === 1) {
      position.copy(first);
      up.copy(ups[0] ?? UP);
      return narrow[0] ?? 0;
    }
    const along = clamp(s, 0, this.length);
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if ((this.lengths[middle] ?? 0) <= along) low = middle;
      else high = middle;
    }
    const from = this.lengths[low] ?? 0;
    const t = (along - from) / Math.max(1e-6, (this.lengths[high] ?? 0) - from);
    position.lerpVectors(points[low] ?? first, points[high] ?? first, t);
    up.lerpVectors(ups[low] ?? UP, ups[high] ?? UP, t).normalize();
    return (narrow[low] ?? 0) + ((narrow[high] ?? 0) - (narrow[low] ?? 0)) * t;
  }
}

/** The whole cross-section, laid out once per shape of the reading. */
export interface Burrows {
  readonly chambers: readonly Chamber[];
  readonly byPath: ReadonlyMap<string, Chamber>;
  readonly tunnels: readonly Tunnel[];
  /** Every vertical bore: each surface chamber's shaft, and the workshops' wall shafts. */
  readonly bores: readonly Bore[];
  /** The lines ants climb between a chamber and the meadow or the workshop above it. */
  readonly climbs: readonly Poly[];
  /** The bedrock chambers, the most leaned on first, where the queens hold court. */
  readonly heart: readonly Chamber[];
  readonly route: (from: WorkPoint, to: WorkPoint) => Path;
}

/* ----- Outlines ----- */

/** How far a chamber's outline stands out at angle `a`, of its radii: a gentle wobble, the same for the same zone. */
export function blobOf(chamber: Chamber, a: number): number {
  return 1 + 0.06 * Math.sin(3 * a + chamber.sa) + 0.04 * Math.sin(5 * a + chamber.sb);
}

function clipAbove(polygon: readonly Point2[], floor: number): Point2[] {
  const out: Point2[] = [];
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length] ?? a;
    const aIn = a.y >= floor;
    if (aIn) out.push(a);
    if (aIn !== b.y >= floor) {
      const t = (floor - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: floor });
    }
  });
  return out;
}

/** Of `polygon`, what lies below `level`. */
export function clipBelow(polygon: readonly Point2[], level: number): Point2[] {
  return clipAbove(
    polygon.map((point) => ({ x: point.x, y: -point.y })),
    -level,
  ).map((point) => ({ x: point.x, y: -point.y }));
}

/** The cut-open outline of a chamber, about its centre: its wobbling ellipse, cut flat at its floor. */
export function holeOutline(chamber: Chamber, segments = 96): Point2[] {
  const points: Point2[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const f = blobOf(chamber, a);
    points.push({ x: Math.cos(a) * chamber.rx * f, y: Math.sin(a) * chamber.ry * f });
  }
  return clipAbove(points, chamber.floorY - chamber.cy);
}

function insideChamber(chamber: Chamber, x: number, y: number): boolean {
  const dx = (x - chamber.cx) / chamber.rx;
  const dy = (y - chamber.cy) / chamber.ry;
  return dx * dx + dy * dy < 1 && y > chamber.floorY - 0.1;
}

/* ----- Placing chambers ----- */

function moundKindOf(path: string): MoundKind {
  const h = hashUnit(path, 11);
  if (h < 0.55) return MOUND_KIND.HILL;
  if (h < 0.7) return MOUND_KIND.LEAF;
  if (h < 0.8) return MOUND_KIND.MUSHROOM;
  if (h < 0.9) return MOUND_KIND.TWIGS;
  return MOUND_KIND.CAIRN;
}

/** A zone's chamber at its natural size, not yet placed. */
function chamberOf(zone: ZoneView, index: number): Chamber {
  const surface = zone.layer === ZONE_LAYER.SURFACE;
  const tooling = zone.layer === ZONE_LAYER.TOOLING;
  const f = zone.footprint;
  const r = surface ? 1 + 2.2 * f : tooling ? 1.1 + 2.6 * f : 1.3 + 4.4 * f;
  const moundR = 1.2 + 4.8 * f;
  return {
    zone,
    index,
    surface,
    tooling,
    cx: 0,
    cy: 0,
    rx: 1.45 * r,
    ry: (surface ? 0.86 : 0.8) * r,
    rz: Math.min(1.15 * r, surface ? 6.5 : 6.8),
    floorY: 0,
    fx: 0,
    fz: 0,
    portY: 0,
    sa: hashUnit(zone.path, 3) * Math.PI * 2,
    sb: hashUnit(zone.path, 5) * Math.PI * 2,
    shaftX: undefined,
    mound: surface
      ? {
          x: 0,
          z: COLONY.MOUND_Z,
          r: moundR,
          rz: Math.min(moundR, 6),
          kind: moundKindOf(zone.path),
        }
      : undefined,
  };
}

function shrink(chamber: Chamber, scale: number): void {
  chamber.rx *= scale;
  chamber.ry *= scale;
  chamber.rz *= scale;
  if (chamber.mound !== undefined) {
    chamber.mound.r *= scale;
    chamber.mound.rz *= scale;
  }
}

/** How much of the meadow's row a surface chamber takes either side of its centre: its anthill's, or its chamber's where that is wider. */
function halfOf(chamber: Chamber): number {
  return chamber.mound === undefined ? chamber.rx : Math.max(chamber.mound.r + 0.35, chamber.rx);
}

/** Where a zone stands across its ring, from 0 at the inner edge to 1 at the outer: how far its place on the floor is from the centre, past its ring's start. */
function outwardOf(zone: ZoneView): number {
  return clamp(Math.hypot(zone.x, zone.y) - zone.ring, 0, 1);
}

/** Where a zone stands across the slab, between `low` and `high`: its bearing on the floor from the centre, unrolled. */
function acrossOf(zone: ZoneView, low: number, high: number): number {
  const bearing = (Math.atan2(zone.y, zone.x) + Math.PI * 2) % (Math.PI * 2);
  return low + (bearing / (Math.PI * 2)) * (high - low);
}

/** Orders zones by where they stand across the slab. */
function byBearing(a: Chamber, b: Chamber): number {
  return acrossOf(a.zone, 0, 1) - acrossOf(b.zone, 0, 1) || (a.zone.path < b.zone.path ? -1 : 1);
}

/**
 * Centres for items of `halves` between `low` and `high`, in their order, as
 * near their `targets` as keeps `GAP` between neighbours: pushed right past
 * the one before, then back left inside the end.
 */
function pack(
  targets: readonly number[],
  halves: readonly number[],
  low: number,
  high: number,
): number[] {
  const half = (index: number) => halves[index] ?? 0;
  const packed = [...targets];
  for (let index = 0; index < packed.length; index += 1) {
    const floor =
      index === 0 ? low + half(0) : (packed[index - 1] ?? 0) + half(index - 1) + GAP + half(index);
    packed[index] = Math.max(packed[index] ?? 0, floor);
  }
  for (let index = packed.length - 1; index >= 0; index -= 1) {
    const ceiling =
      index === packed.length - 1
        ? high - half(index)
        : (packed[index + 1] ?? 0) - half(index + 1) - GAP - half(index);
    packed[index] = Math.min(packed[index] ?? 0, ceiling);
  }
  return packed;
}

/** Shrinks `chambers` alike until all of them could stand in `rows` rows of `span`. */
function shrinkToFit(chambers: readonly Chamber[], span: number, rows: number): void {
  const needed = chambers.reduce((sum, chamber) => sum + 2 * halfOf(chamber) + GAP, 0);
  const scale = Math.min(1, (span * rows) / Math.max(needed, 1e-6));
  for (const chamber of chambers) shrink(chamber, scale);
}

/** Lines the surface's anthills up along the meadow, each over its chamber just under the turf, at its angle across and its place in the ring set back. */
function placeSurface(chambers: Chamber[], low: number, high: number): void {
  chambers.sort(byBearing);
  shrinkToFit(chambers, high - low, 1);
  const xs = pack(
    chambers.map((chamber) => acrossOf(chamber.zone, low, high)),
    chambers.map(halfOf),
    low,
    high,
  );
  chambers.forEach((chamber, index) => {
    chamber.cx = xs[index] ?? 0;
    chamber.cy = -4.4 - chamber.ry;
    const mound = chamber.mound;
    if (mound === undefined) return;
    mound.x = chamber.cx;
    const front = -2.6 - mound.rz * 0.9;
    const back = -COLONY.SLAB + mound.rz * 0.9 + 0.3;
    mound.z =
      front < back
        ? COLONY.MOUND_Z
        : clamp(COLONY.MOUND_Z + (outwardOf(chamber.zone) - 0.5) * 6, back, front);
  });
}

/**
 * Digs one underground layer's chambers in its band: across at their angle,
 * down by their place in the ring, its outer edge shallowest, then pushed
 * apart, mostly sideways, wherever two would overlap.
 */
function placeBand(
  chambers: Chamber[],
  band: { top: number; bottom: number },
  low: number,
  high: number,
): void {
  if (chambers.length === 0) return;
  const tallest = Math.max(...chambers.map((chamber) => chamber.ry));
  shrinkToFit(
    chambers,
    high - low,
    Math.max(1, Math.floor((band.top - band.bottom) / (2 * tallest + GAP))) * 0.7,
  );
  const keep = (chamber: Chamber) => {
    chamber.cx = clamp(chamber.cx, low + chamber.rx, high - chamber.rx);
    chamber.cy = clamp(chamber.cy, band.bottom + chamber.ry * 0.62, band.top - chamber.ry);
  };
  for (const chamber of chambers) {
    chamber.cx = acrossOf(chamber.zone, low, high);
    chamber.cy = band.bottom + outwardOf(chamber.zone) * (band.top - band.bottom);
    keep(chamber);
  }
  for (let round = 0; round < RELAX_ROUNDS; round += 1) {
    let moved = false;
    for (let i = 0; i < chambers.length; i += 1) {
      for (let j = i + 1; j < chambers.length; j += 1) {
        const a = chambers[i];
        const b = chambers[j];
        if (a === undefined || b === undefined) continue;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const overX = a.rx + b.rx + GAP - Math.abs(dx);
        const overY = a.ry + b.ry + GAP * 0.75 - Math.abs(dy);
        if (overX <= 0 || overY <= 0) continue;
        moved = true;
        // Note that a pair is parted the shorter way, sideways preferred, since a band is wider than it is deep.
        if (overX < overY * 1.6) {
          const side = dx === 0 ? (a.zone.path < b.zone.path ? 1 : -1) : Math.sign(dx);
          a.cx -= (side * overX) / 2;
          b.cx += (side * overX) / 2;
        } else {
          const side = dy === 0 ? (a.zone.path < b.zone.path ? 1 : -1) : Math.sign(dy);
          a.cy -= (side * overY) / 2;
          b.cy += (side * overY) / 2;
        }
        keep(a);
        keep(b);
      }
    }
    if (!moved) return;
  }
}

/** Stacks one wall's workshops down the wall at `side`, by their place in the ring; answers the room they take from the product. */
function placeColumn(chambers: Chamber[], side: number): number {
  if (chambers.length === 0) return 0;
  chambers.sort(
    (a, b) => outwardOf(a.zone) - outwardOf(b.zone) || (a.zone.path < b.zone.path ? -1 : 1),
  );
  const top = 9;
  const bottom = COLONY.DEPTH - 3;
  const needed = chambers.reduce((sum, chamber) => sum + 2 * chamber.ry + GAP, 0);
  const scale = Math.min(1, (bottom - top) / needed);
  for (const chamber of chambers) shrink(chamber, scale);
  const widest = Math.max(...chambers.map((chamber) => chamber.rx));
  const depths = pack(
    chambers.map((chamber) => top + outwardOf(chamber.zone) * (bottom - top)),
    chambers.map((chamber) => chamber.ry),
    top,
    bottom,
  );
  chambers.forEach((chamber, index) => {
    chamber.cx = side * (COLONY.HALF - 1.4 - widest);
    chamber.cy = -(depths[index] ?? top);
  });
  return 2 * widest + 2.8;
}

/** Fills in what follows from a chamber's place: its floor, its port, and its shaft. */
function settle(chamber: Chamber): void {
  chamber.floorY = chamber.cy - 0.62 * chamber.ry;
  chamber.fx = 0.785 * chamber.rx;
  chamber.fz = 0.785 * chamber.rz;
  chamber.portY = chamber.floorY + PORT_HEIGHT;
  if (chamber.surface) chamber.shaftX = chamber.cx + 0.42 * chamber.fx;
  if (chamber.tooling) chamber.shaftX = chamber.cx;
}

/* ----- Tunnels ----- */

function bezier(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Turns a centreline into the line an ant's feet follow: the floor where it is level, the back wall where it climbs. */
function antLine(center: readonly Point2[]): Poly {
  const poly = new Poly();
  center.forEach((point, index) => {
    const a = center[Math.max(0, index - 1)] ?? point;
    const b = center[Math.min(center.length - 1, index + 1)] ?? point;
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / length;
    const ty = (b.y - a.y) / length;
    const level = Math.abs(tx);
    const [nx, ny] = tx >= 0 ? [ty, -tx] : [-ty, tx];
    const direction = new Vector3(
      nx * 0.88 * level,
      ny * 0.88 * level,
      -(0.47 + 0.53 * (1 - level)),
    ).normalize();
    const foot = new Vector3(point.x, point.y, 0).addScaledVector(
      direction,
      COLONY.TUNNEL_RADIUS - 0.04,
    );
    poly.add(foot, direction.clone().negate(), 1);
  });
  return poly;
}

/**
 * Numbers each zone's strongly connected component by Tarjan's walk, so the
 * zones of one dependency cycle share a number. A cycle's own tunnels are
 * all kept, and only the acyclic graph between components is reduced, so a
 * reduction never cuts a zone off.
 */
function componentsOf(
  paths: readonly string[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const component = new Map<string, number>();
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;
  let components = 0;
  const visit = (path: string) => {
    order.set(path, counter);
    low.set(path, counter);
    counter += 1;
    stack.push(path);
    onStack.add(path);
    for (const to of dependsOn.get(path) ?? []) {
      if (!order.has(to)) {
        visit(to);
        low.set(path, Math.min(low.get(path) ?? 0, low.get(to) ?? 0));
      } else if (onStack.has(to)) low.set(path, Math.min(low.get(path) ?? 0, order.get(to) ?? 0));
    }
    if (low.get(path) !== order.get(path)) return;
    const number = components;
    components += 1;
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      onStack.delete(top);
      component.set(top, number);
      if (top === path) break;
    }
  };
  for (const path of paths) if (!order.has(path)) visit(path);
  return component;
}

/** The dependencies left once one reached through another is dropped, in path order, at most `MAX_TUNNELS`. */
function reducedEdges(edges: readonly ZoneEdge[], laid: ReadonlyMap<string, Chamber>): ZoneEdge[] {
  const bored = edges
    .filter((edge) => laid.has(edge.from) && laid.has(edge.to) && edge.from !== edge.to)
    .filter(
      (edge, index, all) =>
        all.findIndex((other) => other.from === edge.from && other.to === edge.to) === index,
    );
  const dependsOn = new Map<string, string[]>();
  for (const edge of bored)
    dependsOn.set(edge.from, [...(dependsOn.get(edge.from) ?? []), edge.to]);
  const component = componentsOf([...laid.keys()], dependsOn);
  const of = (path: string) => component.get(path) ?? -1;
  const next = new Map<number, Set<number>>();
  for (const edge of bored) {
    if (of(edge.from) !== of(edge.to))
      next.set(of(edge.from), (next.get(of(edge.from)) ?? new Set()).add(of(edge.to)));
  }
  const reaches = new Map<number, Set<number>>();
  // Note that the components' graph has no cycle, so each component's reach is whole once stored.
  const reach = (from: number): Set<number> => {
    const known = reaches.get(from);
    if (known !== undefined) return known;
    const found = new Set<number>();
    for (const to of next.get(from) ?? []) {
      found.add(to);
      for (const further of reach(to)) found.add(further);
    }
    reaches.set(from, found);
    return found;
  };
  return bored
    .filter((edge) => {
      const from = of(edge.from);
      const to = of(edge.to);
      if (from === to) return true;
      return ![...(next.get(from) ?? [])].some((other) => other !== to && reach(other).has(to));
    })
    .slice(0, MAX_TUNNELS);
}

function tunnelOf(from: Chamber, to: Chamber, index: number): Tunnel {
  const dx = to.cx - from.cx;
  const near = Math.abs(dx) < (from.rx + to.rx) * 0.55;
  const side = near ? (index % 2 ? 1 : -1) : Math.sign(dx) || 1;
  const p0 = { x: from.cx + side * 0.5 * from.fx, y: from.portY };
  const p3 = { x: to.cx + (near ? side : -side) * 0.5 * to.fx, y: to.portY };
  const reachOut = near
    ? Math.max(from.rx, to.rx) + 4 + Math.abs(p3.y - p0.y) * 0.15
    : Math.abs(p3.x - p0.x) * 0.5;
  const p1 = { x: p0.x + side * reachOut, y: p0.y };
  const p2 = { x: p3.x + (near ? side : -side) * reachOut, y: p3.y };
  const center: Point2[] = [];
  for (let step = 0; step <= 70; step += 1) center.push(bezier(p0, p1, p2, p3, step / 70));
  const line = antLine(center);
  // Note that the stretch inside either chamber is open floor, not a narrow passage.
  center.forEach((point, at) => {
    if (insideChamber(from, point.x, point.y) || insideChamber(to, point.x, point.y))
      line.narrow[at] = 0;
  });
  const leaves = center.findIndex((point) => !insideChamber(from, point.x, point.y));
  const enters =
    center.length -
    1 -
    [...center].reverse().findIndex((point) => !insideChamber(to, point.x, point.y));
  return {
    from,
    to,
    center,
    open: { first: Math.max(0, leaves - 1), last: Math.min(center.length - 1, enters + 1) },
    line,
    length: line.length(),
  };
}

/* ----- Shafts ----- */

/** The line an ant climbs from a chamber's floor at `x`, up the back wall, to the meadow's trail or onto the floor at `topY`. */
function climbOf(x: number, floorY: number, topY: number | undefined): Poly {
  const poly = new Poly()
    .add(new Vector3(x, floorY, -0.47), UP, 0)
    .add(new Vector3(x, floorY + 0.35, -0.86), new Vector3(0, 0.55, 0.85), 1)
    .add(new Vector3(x, floorY + 1.3, -0.99), new Vector3(0, 0, 1), 1);
  if (topY !== undefined) {
    return poly
      .add(new Vector3(x, topY - 0.9, -0.99), new Vector3(0, 0, 1), 1)
      .add(new Vector3(x, topY - 0.1, -0.7), new Vector3(0, 0.6, 0.8), 1)
      .add(new Vector3(x, topY, -0.47), UP, 0);
  }
  return poly
    .add(new Vector3(x, -0.9, -0.99), new Vector3(0, 0, 1), 1)
    .add(new Vector3(x, -0.12, -0.92), new Vector3(0, 0.6, 0.8), 1)
    .add(new Vector3(x, 0.02, -1.35), UP, 0)
    .add(new Vector3(x, 0.02, COLONY.TRAIL_Z), UP, 0);
}

/** Where a shaft at `x` meets a chamber's ceiling. */
function ceilingAt(chamber: Chamber, x: number): number {
  const across = (x - chamber.cx) / chamber.rx;
  return chamber.cy + chamber.ry * Math.sqrt(Math.max(0, 1 - across * across)) * 0.92;
}

/* ----- Routing ----- */

interface Hop {
  readonly to: number;
  readonly poly: Poly;
  readonly length: number;
}

function trailPoint(x: number): Vector3 {
  return new Vector3(x, 0.02, COLONY.TRAIL_Z);
}

/** Where on the meadow a point around an anthill stands. */
export function aroundMound(mound: Mound, th: number, d: number): Vector3 {
  return new Vector3(
    mound.x + Math.cos(th) * (mound.r + d),
    0.02,
    clamp(mound.z + Math.sin(th) * (mound.rz + d), -COLONY.SLAB + 0.8, -0.9),
  );
}

/** The router over `hops`: the shortest chain of tunnels and shafts between two chambers, remembered once asked. */
function routerOf(hops: ReadonlyMap<number, readonly Hop[]>, climbs: ReadonlyMap<number, Poly>) {
  const cache = new Map<number, Map<number, readonly Hop[]>>();
  const shortest = (source: number, target: number): readonly Hop[] => {
    const known = cache.get(source)?.get(target);
    if (known !== undefined) return known;
    const distance = new Map([[source, 0]]);
    const previous = new Map<number, { from: number; hop: Hop }>();
    const open = new Set([source]);
    while (open.size > 0) {
      let nearest = source;
      let best = Number.POSITIVE_INFINITY;
      for (const node of open) {
        const at = distance.get(node) ?? Number.POSITIVE_INFINITY;
        if (at < best) [nearest, best] = [node, at];
      }
      open.delete(nearest);
      if (nearest === target) break;
      for (const hop of hops.get(nearest) ?? []) {
        const through = best + hop.length;
        if (through < (distance.get(hop.to) ?? Number.POSITIVE_INFINITY)) {
          distance.set(hop.to, through);
          previous.set(hop.to, { from: nearest, hop });
          open.add(hop.to);
        }
      }
    }
    const chain: Hop[] = [];
    for (let node = target; node !== source; ) {
      const step = previous.get(node);
      if (step === undefined) break;
      chain.unshift(step.hop);
      node = step.from;
    }
    cache.set(source, (cache.get(source) ?? new Map()).set(target, chain));
    return chain;
  };
  const onMeadow = (point: WorkPoint) => point.chamber === undefined || point.chamber.surface;
  const nodeOf = (point: WorkPoint) => point.chamber?.index ?? MEADOW;
  // Note that a team leaves an anthill down its own shaft, and an open meadow by the trail.
  const leave = (point: WorkPoint): Poly => {
    const chamber = point.chamber;
    if (chamber === undefined) return new Poly().add(trailPoint(point.p.x));
    const climb = climbs.get(chamber.index);
    if (!chamber.surface || climb === undefined) return new Poly();
    return new Poly().add(trailPoint(chamber.shaftX ?? point.p.x)).addPoly(climb.reversed());
  };
  return (from: WorkPoint, to: WorkPoint): Path => {
    const poly = new Poly().add(from.p, UP, 0);
    const a = from.chamber;
    if (a !== undefined && a === to.chamber) {
      const mound = a.mound;
      for (let step = 1; mound !== undefined && step <= 14; step += 1) {
        const t = step / 14;
        poly.add(aroundMound(mound, from.th + (to.th - from.th) * t, from.d + (to.d - from.d) * t));
      }
    } else if (onMeadow(from) && onMeadow(to)) {
      poly.add(trailPoint(from.p.x)).add(trailPoint(to.p.x));
    } else {
      poly.addPoly(leave(from));
      for (const hop of shortest(nodeOf(from), nodeOf(to))) poly.addPoly(hop.poly);
      poly.addPoly(leave(to).reversed());
    }
    poly.add(to.p, UP, 0);
    return new Path(poly);
  };
}

/** The routing graph: every tunnel both ways, every climb both ways. */
function hopsOf(
  tunnels: readonly Tunnel[],
  climbs: readonly { from: number; to: number; poly: Poly }[],
) {
  const hops = new Map<number, Hop[]>();
  const link = (from: number, to: number, poly: Poly, length: number) =>
    hops.set(from, [...(hops.get(from) ?? []), { to, poly, length }]);
  for (const tunnel of tunnels) {
    link(tunnel.from.index, tunnel.to.index, tunnel.line, tunnel.length);
    link(tunnel.to.index, tunnel.from.index, tunnel.line.reversed(), tunnel.length);
  }
  for (const climb of climbs) {
    const length = climb.poly.length() + (climb.to === MEADOW ? MEADOW_TOLL : 0);
    link(climb.from, climb.to, climb.poly, length);
    link(climb.to, climb.from, climb.poly.reversed(), length);
  }
  return hops;
}

/* ----- Public ----- */

/** Whether two readings dig the same burrows: the same zones, sized and placed alike, and the same dependencies. */
export function sameShape(a: FactoryWorldView, b: FactoryWorldView): boolean {
  if (a.zones.length !== b.zones.length || a.edges.length !== b.edges.length) return false;
  const zonesAlike = a.zones.every((zone, index) => {
    const other = b.zones[index];
    return (
      other !== undefined &&
      zone.path === other.path &&
      zone.layer === other.layer &&
      zone.footprint === other.footprint &&
      zone.x === other.x &&
      zone.y === other.y &&
      zone.ring === other.ring &&
      zone.depth === other.depth &&
      zone.transitiveDependents === other.transitiveDependents
    );
  });
  return (
    zonesAlike &&
    a.edges.every(
      (edge, index) => edge.from === b.edges[index]?.from && edge.to === b.edges[index]?.to,
    )
  );
}

/** A work point for a team or a beetle in `chamber`: around its anthill, or on its floor; out on the meadow for none. */
export function workPointIn(chamber: Chamber | undefined, random: () => number, x = 0): WorkPoint {
  if (chamber === undefined) {
    return {
      chamber,
      p: new Vector3(
        clamp(x + (random() - 0.5) * 6, -COLONY.HALF + 3, COLONY.HALF - 3),
        0.02,
        -3 - random() * 4,
      ),
      th: 0,
      d: 0,
    };
  }
  if (chamber.mound !== undefined) {
    const th = 0.12 + random() * (Math.PI - 0.24);
    const d = 0.9 + random() * 1.7;
    return { chamber, p: aroundMound(chamber.mound, th, d), th, d };
  }
  let x0 = 0;
  let z0 = 0;
  do {
    x0 = random() * 1.7 - 0.85;
    z0 = -0.2 - random() * 0.65;
  } while (x0 * x0 + z0 * z0 > 0.7);
  return {
    chamber,
    p: new Vector3(chamber.cx + x0 * chamber.fx, chamber.floorY, Math.min(-0.4, z0 * chamber.fz)),
    th: 0,
    d: 0,
  };
}

/** Lays out the reading's zones as an ant farm. */
export function burrowsOf(view: FactoryWorldView): Burrows {
  const chambers = view.zones.map(chamberOf);
  const byPath = new Map(chambers.map((chamber) => [chamber.zone.path, chamber]));
  const tooling = chambers.filter((chamber) => chamber.tooling);
  const leftRoom = placeColumn(
    tooling.filter((chamber) => chamber.zone.x < 0),
    -1,
  );
  const rightRoom = placeColumn(
    tooling.filter((chamber) => chamber.zone.x >= 0),
    1,
  );
  const low = -COLONY.HALF + 2 + leftRoom;
  const high = COLONY.HALF - 2 - rightRoom;
  const inLayer = (layer: ZoneLayer) => chambers.filter((chamber) => chamber.zone.layer === layer);
  placeSurface(inLayer(ZONE_LAYER.SURFACE), low, high);
  placeBand(inLayer(ZONE_LAYER.DOMAIN), BAND.DOMAIN, low, high);
  placeBand(inLayer(ZONE_LAYER.CORE), BAND.CORE, low, high);
  for (const chamber of chambers) settle(chamber);

  const tunnels = reducedEdges(view.edges, byPath).flatMap((edge, index) => {
    const from = byPath.get(edge.from);
    const to = byPath.get(edge.to);
    return from === undefined || to === undefined ? [] : [tunnelOf(from, to, index)];
  });

  const bores: Bore[] = [];
  const climbs: { from: number; to: number; poly: Poly }[] = [];
  for (const chamber of chambers) {
    if (!chamber.surface || chamber.shaftX === undefined) continue;
    bores.push({ x: chamber.shaftX, bottom: ceilingAt(chamber, chamber.shaftX), top: 0 });
    climbs.push({
      from: chamber.index,
      to: MEADOW,
      poly: climbOf(chamber.shaftX, chamber.floorY, undefined),
    });
  }
  for (const side of [-1, 1]) {
    const wall = tooling
      .filter((chamber) => Math.sign(chamber.cx) === side)
      .sort((a, b) => b.cy - a.cy);
    wall.forEach((chamber, index) => {
      const above = wall[index - 1];
      const x = chamber.cx;
      bores.push({ x, bottom: ceilingAt(chamber, x), top: above?.floorY ?? 0 });
      climbs.push({
        from: chamber.index,
        to: above?.index ?? MEADOW,
        poly: climbOf(x, chamber.floorY, above?.floorY),
      });
    });
  }
  const climbOut = new Map(
    climbs.filter((climb) => climb.to === MEADOW).map((climb) => [climb.from, climb.poly]),
  );
  const heart = inLayer(ZONE_LAYER.CORE)
    .sort(
      (a, b) =>
        b.zone.transitiveDependents - a.zone.transitiveDependents ||
        (a.zone.path < b.zone.path ? -1 : 1),
    )
    .slice(0, 2);
  return {
    chambers,
    byPath,
    tunnels,
    bores,
    climbs: climbs.map((climb) => climb.poly),
    heart,
    route: routerOf(hopsOf(tunnels, climbs), climbOut),
  };
}
