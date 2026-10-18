import type { ZoneView } from "@luke/ui/factory-world";
import { type BuildingPlan, buildingPlanOf } from "./buildings";
import { clamp, lerp } from "./geo";

/**
 * layout.ts -- the Factory's plan: the reading's polar floor snapped to a street grid, a lot for each zone, and the roads between them.
 *
 * The view model places every zone on a polar floor, the core at the heart
 * and tooling outermost (`@luke/ui/factory-world`'s `zone-layout.ts`). The
 * Factory is a grid of blocks with roads between, so each zone takes the
 * free block nearest its place on that floor, the core first, so the heart
 * stays industrial and the edge stays where a developer meets it. The same
 * snapshot lands the same zones in the same blocks every time, without a
 * zone's name entering into it. Blocks no zone takes are dressed: a tank
 * farm, a container yard, wind turbines in the corners.
 *
 * A lot is its building plus an apron in front, where the zone's build
 * sites, blueprints, and wreckage stand in rows. A column is as wide as its
 * widest lot and a row as deep as its deepest, so roads run straight. The
 * apron is deep enough for the most it has had to hold since the zones last
 * changed (`reserve`), so scrubbing back never shifts a road.
 */

/** Road width, in scene units. */
export const ROAD = 7;

/** The least a block measures either way. */
const MIN_BLOCK = 14;

/** Of the grid's blocks, about how many zones take, the rest left for dressing. */
const ZONE_SHARE = 0.68;

/** The radius the polar floor's outermost zones reach, a little inside its four rings. */
const FLOOR_RADIUS = 3.9;

/** What an empty block is dressed as. */
export const DECOR = {
  COOLING: "cooling",
  TANKFARM: "tankfarm",
  ORE: "ore",
  SOLAR: "solar",
  CONTAINERS: "containers",
  PARKING: "parking",
  DEPOT: "depot",
  WIND: "wind",
  PARK: "park",
  WATERTOWER: "watertower",
} as const;

type Decor = (typeof DECOR)[keyof typeof DECOR];

const INNER_DECOR = [
  DECOR.COOLING,
  DECOR.TANKFARM,
  DECOR.ORE,
  DECOR.SOLAR,
  DECOR.CONTAINERS,
  DECOR.PARKING,
  DECOR.DEPOT,
  DECOR.WATERTOWER,
  DECOR.PARK,
  DECOR.CONTAINERS,
] as const;

const CORNER_DECOR = [DECOR.WIND, DECOR.PARK] as const;

/** A point on the yard's floor. */
export interface Spot {
  readonly x: number;
  readonly z: number;
}

/** One thing an apron holds, by the room it takes. */
export interface Footprint {
  readonly w: number;
  readonly d: number;
}

/** Footprints packed into rows across a width: each one's offset into its row, and each row's depth. */
export interface Packing<Item extends Footprint> {
  readonly rows: readonly {
    readonly items: readonly { readonly item: Item; readonly rx: number }[];
    readonly w: number;
    readonly d: number;
  }[];
  readonly depth: number;
}

/** A zone's lot: its block, its bounds, where its building stands, and where its apron opens. */
export interface Lot {
  readonly zone: ZoneView;
  /** Its index among the lots, which tags its building for the building shader. */
  readonly index: number;
  readonly plan: BuildingPlan;
  readonly col: number;
  readonly row: number;
  readonly cx: number;
  readonly cz: number;
  readonly W: number;
  readonly D: number;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Its building's centre. */
  readonly bx: number;
  readonly bz: number;
  /** Where its apron's first row begins. */
  readonly apronZ: number;
}

/** An empty block and what it is dressed as. */
export interface DecorBlock {
  readonly decor: Decor;
  readonly cx: number;
  readonly cz: number;
  readonly W: number;
  readonly D: number;
}

/** The whole plan. */
export interface Layout {
  /** Blocks per side. */
  readonly n: number;
  /** Each road's centre line, west to east and north to south, one more than the blocks. */
  readonly xr: readonly number[];
  readonly zr: readonly number[];
  /** The yard's bounds, to the outer roads' edges. */
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** The gate's x, where the highway leaves the yard southward. */
  readonly gateX: number;
  /** The yard's larger side. */
  readonly span: number;
  readonly lots: readonly Lot[];
  readonly lotByPath: ReadonlyMap<string, Lot>;
  readonly decor: readonly DecorBlock[];
}

/** Packs `items` into rows no wider than `width`, in order. */
export function packRows<Item extends Footprint>(
  width: number,
  items: readonly Item[],
): Packing<Item> {
  const rows: { items: { item: Item; rx: number }[]; w: number; d: number }[] = [];
  let current: (typeof rows)[number] | undefined;
  for (const item of items) {
    if (current === undefined || current.w + item.w > width - 2) {
      current = { items: [], w: 0, d: 0 };
      rows.push(current);
    }
    current.items.push({ item, rx: current.w });
    current.w += item.w + 0.4;
    current.d = Math.max(current.d, item.d);
  }
  return { rows, depth: rows.reduce((sum, row) => sum + row.d + 0.4, 0) };
}

/** The width a zone's lot takes for its building. */
export function lotWidthOf(plan: BuildingPlan): number {
  return Math.max(plan.w + plan.eastX + 3.2, 12);
}

/** Whether a zone is placed before another: inner rings first, then those more depended on, then by path. */
function placedBefore(left: ZoneView, right: ZoneView): number {
  return (
    left.ring - right.ring ||
    right.transitiveDependents - left.transitiveDependents ||
    (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  );
}

/** The free block nearest (gx, gy), the lowest index among equals. */
function nearestFree(taken: readonly boolean[], n: number, gx: number, gy: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let cell = 0; cell < n * n; cell += 1) {
    if (taken[cell] === true) continue;
    const distance = ((cell % n) - gx) ** 2 + (Math.floor(cell / n) - gy) ** 2;
    if (distance < bestDistance - 1e-9) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

/** Each line's centre from the widths between them, centred on zero. */
function linesOf(widths: readonly number[]): number[] {
  const lines = [0];
  for (const width of widths) lines.push((lines.at(-1) ?? 0) + ROAD + width);
  const half = (lines.at(-1) ?? 0) / 2;
  return lines.map((line) => line - half);
}

/** What the empty block at `col`, `row` is dressed as: wind or a park in a corner, and inside, a dressing no neighbour across a road shares. */
function decorOf(col: number, row: number, n: number): Decor {
  const corner = (col === 0 || col === n - 1) && (row === 0 || row === n - 1);
  if (corner) return CORNER_DECOR[(col + row) % CORNER_DECOR.length] ?? DECOR.WIND;
  return INNER_DECOR[(col * 3 + row * 7) % INNER_DECOR.length] ?? DECOR.SOLAR;
}

/**
 * The plan for `zones`, each apron at least as deep as `reserve` holds for
 * its path. A zone's apron depth is what its rows of items take; one with
 * none keeps a strip.
 */
export function layoutOf(zones: readonly ZoneView[], reserve: ReadonlyMap<string, number>): Layout {
  const n = Math.max(5, Math.ceil(Math.sqrt(zones.length / ZONE_SHARE)));
  const centre = (n - 1) / 2;
  const scale = (n / 2 - 0.5) / FLOOR_RADIUS;
  const taken = Array.from({ length: n * n }, () => false);
  const placed = [...zones].sort(placedBefore).map((zone) => {
    const cell = nearestFree(taken, n, centre + zone.x * scale, centre + zone.y * scale);
    taken[cell] = true;
    const plan = buildingPlanOf(zone.path, zone.layer, zone.footprint);
    const apron = reserve.get(zone.path) ?? 0;
    const W = lotWidthOf(plan);
    const D = 1.2 + plan.backX + plan.d + plan.frontX + (apron > 0 ? 1.2 + apron + 0.8 : 1.4);
    return { zone, plan, col: cell % n, row: Math.floor(cell / n), W, D };
  });
  const colW = Array.from({ length: n }, () => MIN_BLOCK);
  const rowD = Array.from({ length: n }, () => MIN_BLOCK);
  for (const lot of placed) {
    colW[lot.col] = Math.max(colW[lot.col] ?? MIN_BLOCK, lot.W);
    rowD[lot.row] = Math.max(rowD[lot.row] ?? MIN_BLOCK, lot.D);
  }
  const xr = linesOf(colW);
  const zr = linesOf(rowD);
  const centreX = (col: number) => ((xr[col] ?? 0) + (xr[col + 1] ?? 0)) / 2;
  const centreZ = (row: number) => ((zr[row] ?? 0) + (zr[row + 1] ?? 0)) / 2;
  const lots: Lot[] = placed.map((lot, index) => {
    const cx = centreX(lot.col);
    const cz = centreZ(lot.row);
    const z0 = cz - lot.D / 2;
    const bz = z0 + 1.2 + lot.plan.backX + lot.plan.d / 2;
    return {
      ...lot,
      index,
      cx,
      cz,
      x0: cx - lot.W / 2,
      z0,
      x1: cx + lot.W / 2,
      z1: cz + lot.D / 2,
      bx: cx - lot.plan.eastX / 2,
      bz,
      apronZ: bz + lot.plan.d / 2 + lot.plan.frontX + 1.2,
    };
  });
  const decor: DecorBlock[] = [];
  for (let cell = 0; cell < n * n; cell += 1) {
    if (taken[cell] === true) continue;
    const col = cell % n;
    const row = Math.floor(cell / n);
    decor.push({
      decor: decorOf(col, row, n),
      cx: centreX(col),
      cz: centreZ(row),
      W: colW[col] ?? MIN_BLOCK,
      D: rowD[row] ?? MIN_BLOCK,
    });
  }
  const x0 = (xr[0] ?? 0) - ROAD / 2;
  const x1 = (xr[n] ?? 0) + ROAD / 2;
  const z0 = (zr[0] ?? 0) - ROAD / 2;
  const z1 = (zr[n] ?? 0) + ROAD / 2;
  return {
    n,
    xr,
    zr,
    x0,
    x1,
    z0,
    z1,
    gateX: centreX(Math.floor(n / 2)),
    span: Math.max(x1 - x0, z1 - z0),
    lots,
    lotByPath: new Map(lots.map((lot) => [lot.zone.path, lot])),
    decor,
  };
}

/** Whether `x` stands on a north-south road, and `z` on an east-west one. */
export function onRoadX(layout: Layout, x: number): boolean {
  return layout.xr.some((line) => Math.abs(x - line) < ROAD / 2 + 0.3);
}

export function onRoadZ(layout: Layout, z: number): boolean {
  return layout.zr.some((line) => Math.abs(z - line) < ROAD / 2 + 0.3);
}

/** A polyline walked by arc length. */
export class Path {
  private readonly points: readonly Spot[];
  private readonly lengths: readonly number[];
  readonly length: number;
  constructor(points: readonly Spot[]) {
    this.points = points;
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      lengths.push(
        (lengths.at(-1) ?? 0) +
          (a === undefined || b === undefined ? 0 : Math.hypot(b.x - a.x, b.z - a.z)),
      );
    }
    this.lengths = lengths;
    this.length = lengths.at(-1) ?? 0;
  }
  at(distance: number, out: { x: number; z: number; yaw: number }): void {
    const d = clamp(distance, 0, this.length);
    let index = 1;
    while (index < this.lengths.length - 1 && (this.lengths[index] ?? 0) < d) index += 1;
    const a = this.points[index - 1] ?? this.points[0];
    const b = this.points[index] ?? a;
    if (a === undefined || b === undefined) return;
    const from = this.lengths[index - 1] ?? 0;
    const piece = (this.lengths[index] ?? 0) - from || 1;
    const t = (d - from) / piece;
    out.x = lerp(a.x, b.x, t);
    out.z = lerp(a.z, b.z, t);
    out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }
}

/** A polyline moved `offset` to its right, so traffic keeps to its side of the road. */
export function keptRight(points: readonly Spot[], offset: number): Spot[] {
  const normal = (a: Spot, b: Spot) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: -dz / length, z: dx / length };
  };
  return points.map((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];
    const n1 = before === undefined ? undefined : normal(before, point);
    const n2 = after === undefined ? undefined : normal(point, after);
    let nx = 0;
    let nz = 0;
    if (n1 !== undefined && n2 !== undefined) {
      const same = Math.abs(n1.x - n2.x) + Math.abs(n1.z - n2.z) < 1e-3;
      nx = same ? n1.x : n1.x + n2.x;
      nz = same ? n1.z : n1.z + n2.z;
    } else {
      const n = n1 ?? n2 ?? { x: 0, z: 0 };
      nx = n.x;
      nz = n.z;
    }
    return { x: point.x - nx * offset, z: point.z - nz * offset };
  });
}

/** The route over the road grid from a point in one block to a point in another, by each block's south road. */
export function roadRoute(layout: Layout, from: Spot, fromLot: Lot, to: Spot, toLot: Lot): Spot[] {
  const za = layout.zr[fromLot.row + 1] ?? from.z;
  const zb = layout.zr[toLot.row + 1] ?? to.z;
  const points: Spot[] = [from, { x: from.x, z: za }];
  if (fromLot.row !== toLot.row) {
    const k =
      toLot.col > fromLot.col
        ? fromLot.col + 1
        : toLot.col < fromLot.col
          ? fromLot.col
          : fromLot.col + 1;
    const x = layout.xr[k] ?? from.x;
    points.push({ x, z: za }, { x, z: zb });
  }
  points.push({ x: to.x, z: zb }, to);
  const kept: Spot[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last === undefined || Math.hypot(point.x - last.x, point.z - last.z) > 0.05)
      kept.push(point);
  }
  return kept;
}

/** The route a truck takes out of `lot`: down to its south road, along to the gate, and away down the highway. */
export function truckRoute(layout: Layout, lot: Lot): Spot[] {
  const { xr, zr, n, gateX, span } = layout;
  const middle = Math.floor(n / 2);
  const x0 = lot.cx + (lot.col === middle ? 0 : (lot.cx < gateX ? 1 : -1) * lot.W * 0.25);
  const south = zr[lot.row + 1] ?? lot.z1;
  const last = zr[n] ?? lot.z1;
  const points: Spot[] = [
    { x: x0, z: lot.z1 - 0.5 },
    { x: x0, z: south },
  ];
  if (lot.row + 1 < n) {
    const x = xr[x0 < gateX ? lot.col + 1 : lot.col] ?? x0;
    points.push({ x, z: south }, { x, z: last });
  }
  points.push({ x: gateX, z: last }, { x: gateX, z: last + span * 2.6 });
  const kept: Spot[] = [];
  for (const point of points) {
    const end = kept.at(-1);
    if (end === undefined || Math.hypot(point.x - end.x, point.z - end.z) > 0.05) kept.push(point);
  }
  return keptRight(kept, 1.7);
}
