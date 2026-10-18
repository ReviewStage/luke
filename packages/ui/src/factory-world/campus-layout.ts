/**
 * campus-layout.ts -- where everything on the campus stands, in tiles: each task's plot and building, the districts of code, the merge gate's lanes, and the shipped lot.
 *
 * The campus is a grid of tiles, x running down to the right on screen, y
 * down to the left, z up. Its top band is fixed: a lawn, the avenue, the gate's
 * yard and the lot past it. Below it stand the plots, laid out one of two
 * ways (`CAMPUS_LAYOUT`):
 *
 *   - Town: plots in the order tasks started, the oldest at the back. The
 *     first eight are a hand-made master plan; past them the town grows in
 *     pairs of plot columns with an avenue between each pair, and in rows,
 *     taking as many pairs as keep it about as deep as it is wide. The
 *     planned issues take the plots after the tasks.
 *   - Districts: each zone with something in it is a district, as near square
 *     as its plots allow, holding the tasks whose zone it is and the planned
 *     issues placed on it; work that has touched no code has a district of
 *     its own. The districts are packed into a square, the gaps between them
 *     its streets.
 *
 * A building's silhouette is art direction and means nothing: a plot takes
 * the architecture its place in the order gives it. A container is as long
 * as its pull request's lines, one tile per `CONTAINER.LINES_PER_TILE`, no
 * longer than a lane; a lane, or the lot, stacks its next container on top
 * once a row is full. All of it is worked out on every draw from the reading
 * alone; nothing is stored.
 */

import type { FactoryPlanned } from "@luke/features/factory-world-wire";
import {
  type CampusContainer,
  type CampusReading,
  type CampusTask,
  GATE_LANE,
  type GateLane,
} from "./campus-reading.js";
import type { FactoryWorldView } from "./factory-world.js";

/** How the plots are laid out. */
export const CAMPUS_LAYOUT = {
  DISTRICTS: "districts",
  TOWN: "town",
} as const;

export type CampusLayout = (typeof CAMPUS_LAYOUT)[keyof typeof CAMPUS_LAYOUT];

/** What a building's part is built of, which the drawing colours by the appearance. */
export const CAMPUS_MATERIAL = {
  WALL: "wall",
  BRICK: "brick",
  GLASS: "glass",
  ROOF: "roof",
  METAL: "metal",
} as const;

export type CampusMaterial = (typeof CAMPUS_MATERIAL)[keyof typeof CAMPUS_MATERIAL];

/** What a part is to its building: the walls, which an open building drops; what stands on them, which it lifts off; or what it keeps. */
export const PART_ROLE = {
  SHELL: "shell",
  UPPER: "upper",
  KEEP: "keep",
} as const;

export type PartRole = (typeof PART_ROLE)[keyof typeof PART_ROLE];

/** A container's size and the most it may be. */
export const CONTAINER = {
  LINES_PER_TILE: 150,
  /** The shortest a container is drawn, for a pull request of a few lines. */
  MIN_TILES: 0.4,
  /** The longest: a lane's length, so the largest pull request still fits one. */
  MAX_TILES: 5.5,
  WIDE: 0.55,
  HIGH: 0.5,
} as const;

/** A box on the grid; `hs` gives its top's four corners their own heights, so a slope or a gable is a box too. */
export interface CampusBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly z: number;
  readonly h: number;
  /** The heights at (x, y), (x + w, y), (x + w, y + d), and (x, y + d). */
  readonly hs?: readonly [number, number, number, number];
}

/** How a wall's windows are set out: rows a face, columns a tile, and the seed of which are lit. */
export interface CampusWindows {
  readonly rows: number;
  readonly per: number;
  readonly seed: number;
  /** A ribbon of glazing rather than windows, as a glass studio has. */
  readonly band?: boolean;
  /** How much fewer of these windows are lit than the building's others, in (0, 1]. */
  readonly dim?: number;
}

/** One part of a building: a box, or a cylinder. */
type CampusPart =
  | {
      readonly box: CampusBox;
      readonly material: CampusMaterial;
      readonly role: PartRole;
      readonly windows?: CampusWindows;
      /** A lit band under the eaves, in the windows' colour. */
      readonly stripe?: boolean;
    }
  | {
      readonly cylinder: {
        readonly x: number;
        readonly y: number;
        readonly r: number;
        readonly z: number;
        readonly h: number;
      };
      readonly material: CampusMaterial;
      readonly role: PartRole;
      readonly bands: readonly number[];
      /** It stands on its own beside the building, drawn before or after the whole of it rather than among its floors. */
      readonly beside?: boolean;
    };

/** A point on the grid, `z` up. */
export interface CampusPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A rectangle on the ground. */
export interface CampusRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

/** A plot and the building on it. */
export interface CampusSlot {
  readonly plot: CampusRect;
  /** The building's hall, which an open building shows the inside of. */
  readonly hollow: CampusRect & { readonly h: number; readonly material: CampusMaterial };
  readonly parts: readonly CampusPart[];
  /** Where its roof's sign stands. */
  readonly roof: CampusPoint;
  /** Its stack's mouth, where smoke rises; none without one. */
  readonly stack: CampusPoint | null;
  /** A tower crane beside it, raised while it goes up; none without room for one. */
  readonly crane: {
    readonly x: number;
    readonly y: number;
    readonly h: number;
    readonly jib: number;
  } | null;
}

/** One district: the zone it is, where it stands, and how many plots it holds. */
export interface CampusDistrict extends CampusRect {
  /** The zone's path; `NOT_IN_CODE` for work that touched none. */
  readonly path: string;
  /** Its place among the view's zones, which tints it; -1 for no zone. */
  readonly tint: number;
}

/** A container where it stands: its middle, its size, and how high it is stacked. */
export interface PlacedContainer {
  readonly container: CampusContainer;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** Where everything stands. */
export interface CampusPlan {
  readonly layout: CampusLayout;
  /** How far the ground runs, in tiles. */
  readonly width: number;
  readonly depth: number;
  readonly plots: ReadonlyMap<string, CampusSlot>;
  readonly blueprints: ReadonlyMap<string, CampusSlot>;
  /** Every district with something in it; none in the town. */
  readonly districts: readonly CampusDistrict[];
  /** The town's grown rows of plots and the avenues down them: a street before each row, an avenue between each pair of columns. */
  readonly streets: { readonly rows: readonly number[]; readonly avenues: readonly number[] };
  readonly containers: readonly PlacedContainer[];
  /** The shipped lot, as wide as what stands in it needs. */
  readonly lot: CampusRect;
  readonly trees: readonly (readonly [number, number])[];
  readonly lamps: readonly (readonly [number, number])[];
}

/** The path the district of work in no code yet goes by. */
export const NOT_IN_CODE = "";

/** The tiles the master plan's first block spans, and the lawn above the plots in districts. */
export const CAMPUS_GRID = 20;
/** Where the districts start, below the gate's band. */
export const DISTRICTS_TOP = 13.8;
/** The avenue across the top band, and the one down the town's middle. */
export const AVENUE = { y: 9, x: 9, wide: 2 } as const;
/** The merge gate's yard. */
export const YARD: CampusRect = { x: 12, y: 5.2, w: 6.6, d: 3.7 };
/** Each lane's near edge, failing furthest from the gate and ready nearest it. */
export const LANES: readonly { readonly lane: GateLane; readonly y: number }[] = [
  { lane: GATE_LANE.FAILING, y: 5.3 },
  { lane: GATE_LANE.RUNNING, y: 6.5 },
  { lane: GATE_LANE.READY, y: 7.7 },
];
export const LANE_DEPTH = 1.2;
export const GATEHOUSE: CampusRect = { x: 18.9, y: 8.1, w: 0.8, d: 0.8 };
export const BARRIER = { x: 19.78, y: 9.0, d: 1.4 } as const;
const LOT_ORIGIN: CampusRect = { x: 20.4, y: 7.6, w: 6.4, d: 4.8 };
/** How many layers the lot stacks before it opens another block beside. */
const LOT_LAYERS = 3;

const TREES: readonly (readonly [number, number])[] = [
  [1.2, 6.8],
  [2.4, 7.6],
  [3.6, 6.7],
  [4.9, 7.8],
  [6.3, 7],
  [7.6, 7.9],
  [8.2, 6.6],
  [1.2, 9.4],
  [17.2, 18.4],
  [18.6, 17.6],
  [7.5, 16.6],
  [8.3, 18.4],
  [7.2, 19.3],
  [0.6, 15.4],
];
const LAMPS: readonly (readonly [number, number])[] = [
  [8.7, 8.7],
  [11.3, 8.7],
  [8.7, 11.3],
  [11.3, 11.3],
  [8.7, 3],
  [11.3, 16],
  [3, 8.7],
  [16, 11.3],
  [19.5, 11.3],
];

const { WALL, BRICK, GLASS, ROOF, METAL } = CAMPUS_MATERIAL;
const { SHELL, UPPER, KEEP } = PART_ROLE;

/** A slope's four corner heights, front high or back high. */
const SLOPE_BACK: readonly [number, number, number, number] = [0.75, 0, 0, 0.75];

function box(x: number, y: number, w: number, d: number, z: number, h: number): CampusBox {
  return { x, y, w, d, z, h };
}

/**
 * The master plan: the first eight plots, each with its own architecture. A
 * tower, a hall with a raised back, a warehouse, a sawtooth works with silos
 * and a stack, a block that goes up under a crane, a gabled workshop with a
 * chimney, a glass studio, and a small gabled hall.
 */
const MASTER_PLAN: readonly CampusSlot[] = [
  {
    plot: { x: 1, y: 1, w: 4.2, d: 4.2 },
    hollow: { x: 1.6, y: 1.6, w: 3, d: 3, h: 3.3, material: WALL },
    parts: [
      {
        box: box(1.6, 1.6, 3, 3, 0, 3.3),
        material: WALL,
        role: SHELL,
        windows: { rows: 5, per: 2, seed: 13 },
      },
      { box: box(2.1, 2.1, 2, 2, 3.3, 0.5), material: ROOF, role: UPPER },
    ],
    roof: { x: 3.1, y: 3.1, z: 3.8 },
    stack: null,
    crane: null,
  },
  {
    plot: { x: 5.8, y: 1, w: 3, d: 5.2 },
    hollow: { x: 6.2, y: 1.5, w: 2.2, d: 4.2, h: 1.9, material: BRICK },
    parts: [
      {
        box: box(6.2, 1.5, 2.2, 4.2, 0, 1.9),
        material: BRICK,
        role: SHELL,
        windows: { rows: 2, per: 1.6, seed: 17 },
      },
      {
        box: box(6.2, 1.5, 2.2, 2, 1.9, 0.7),
        material: BRICK,
        role: UPPER,
        windows: { rows: 1, per: 1.6, seed: 2, dim: 0.4 },
      },
    ],
    roof: { x: 7.3, y: 2.5, z: 2.6 },
    stack: null,
    crane: null,
  },
  {
    plot: { x: 11.6, y: 0.6, w: 7.6, d: 4.2 },
    hollow: { x: 12.2, y: 1.1, w: 6.2, d: 3, h: 1.5, material: WALL },
    parts: [
      {
        box: box(12.2, 1.1, 6.2, 3, 0, 1.5),
        material: WALL,
        role: SHELL,
        windows: { rows: 1, per: 1.5, seed: 7 },
      },
      { box: box(12.1, 1, 6.4, 3.2, 1.5, 0.14), material: ROOF, role: UPPER },
    ],
    roof: { x: 17.6, y: 1.8, z: 1.64 },
    stack: null,
    crane: null,
  },
  {
    plot: { x: 0.6, y: 10.9, w: 8, d: 4.4 },
    hollow: { x: 1.2, y: 11.5, w: 5, d: 3.2, h: 1.2, material: WALL },
    parts: [
      {
        box: box(1.2, 11.5, 5, 3.2, 0, 1.2),
        material: WALL,
        role: SHELL,
        windows: { rows: 1, per: 1.6, seed: 5 },
        stripe: true,
      },
      ...[0, 1, 2, 3].map(
        (tooth): CampusPart => ({
          box: { ...box(1.2 + tooth * 1.25, 11.5, 1.25, 3.2, 1.2, 0), hs: SLOPE_BACK },
          material: ROOF,
          role: UPPER,
        }),
      ),
      {
        cylinder: { x: 7.1, y: 12.1, r: 0.55, z: 0, h: 2.2 },
        material: METAL,
        role: KEEP,
        bands: [0.33, 0.66],
        beside: true,
      },
      {
        cylinder: { x: 7.1, y: 13.6, r: 0.55, z: 0, h: 2.2 },
        material: METAL,
        role: KEEP,
        bands: [0.33, 0.66],
        beside: true,
      },
      {
        cylinder: { x: 5.6, y: 12.1, r: 0.22, z: 1.2, h: 1.9 },
        material: BRICK,
        role: UPPER,
        bands: [0.85],
      },
    ],
    roof: { x: 3.2, y: 12.6, z: 2.4 },
    stack: { x: 5.6, y: 12.1, z: 3.15 },
    crane: null,
  },
  {
    plot: { x: 16.8, y: 11.4, w: 3, d: 5 },
    hollow: { x: 17.2, y: 11.9, w: 2.3, d: 3.6, h: 2.2, material: WALL },
    parts: [
      {
        box: box(17.2, 11.9, 2.3, 3.6, 0, 2.2),
        material: WALL,
        role: SHELL,
        windows: { rows: 3, per: 1.8, seed: 21 },
      },
      { box: box(17.25, 11.95, 2.2, 1.6, 2.2, 0.5), material: ROOF, role: UPPER },
    ],
    roof: { x: 18.35, y: 13.7, z: 2.9 },
    stack: null,
    crane: { x: 19.55, y: 11.75, h: 3.8, jib: 2.7 },
  },
  {
    plot: { x: 1, y: 15.8, w: 5.6, d: 3.8 },
    hollow: { x: 1.5, y: 16.3, w: 4.6, d: 2.8, h: 1.35, material: BRICK },
    parts: [
      {
        box: box(1.5, 16.3, 4.6, 2.8, 0, 1.35),
        material: BRICK,
        role: SHELL,
        windows: { rows: 1, per: 1.4, seed: 11 },
      },
      {
        box: { ...box(1.4, 16.2, 4.8, 1.5, 1.35, 0), hs: [0, 0, 0.9, 0.9] },
        material: ROOF,
        role: UPPER,
      },
      {
        box: { ...box(1.4, 17.7, 4.8, 1.5, 1.35, 0), hs: [0.9, 0.9, 0, 0] },
        material: ROOF,
        role: UPPER,
      },
      { box: box(4.6, 16.6, 0.4, 0.4, 1.6, 0.9), material: WALL, role: UPPER },
    ],
    roof: { x: 2.4, y: 17.7, z: 2.3 },
    stack: { x: 4.8, y: 16.8, z: 2.55 },
    crane: null,
  },
  {
    plot: { x: 12, y: 12, w: 4.4, d: 4.4 },
    hollow: { x: 12.6, y: 12.6, w: 3.2, d: 3.2, h: 1.1, material: GLASS },
    parts: [
      {
        box: box(12.6, 12.6, 3.2, 3.2, 0, 1.1),
        material: GLASS,
        role: SHELL,
        windows: { rows: 1, per: 1.6, seed: 3, band: true },
      },
      { box: box(12.45, 12.45, 3.5, 3.5, 1.1, 0.16), material: ROOF, role: UPPER },
      {
        cylinder: { x: 14.2, y: 14.2, r: 0.07, z: 1.26, h: 1.3 },
        material: METAL,
        role: UPPER,
        bands: [],
      },
    ],
    roof: { x: 14.2, y: 14.2, z: 2.6 },
    stack: null,
    crane: null,
  },
  {
    plot: { x: 12, y: 17.4, w: 4.4, d: 2.2 },
    hollow: { x: 12.4, y: 17.75, w: 3.0, d: 1.3, h: 1.0, material: BRICK },
    parts: [
      {
        box: box(12.4, 17.75, 3.0, 1.3, 0, 1.0),
        material: BRICK,
        role: SHELL,
        windows: { rows: 1, per: 1.6, seed: 27 },
      },
      {
        box: { ...box(12.3, 17.65, 3.2, 0.75, 1.0, 0), hs: [0, 0, 0.55, 0.55] },
        material: ROOF,
        role: UPPER,
      },
      {
        box: { ...box(12.3, 18.4, 3.2, 0.75, 1.0, 0), hs: [0.55, 0.55, 0, 0] },
        material: ROOF,
        role: UPPER,
      },
    ],
    roof: { x: 13.9, y: 18.4, z: 1.55 },
    stack: null,
    crane: { x: 15.95, y: 17.6, h: 3.0, jib: 2.1 },
  },
];

/** The architectures a grown plot takes in turn, the ones that fit a cell: the tower, the hall, the block, the studio, and the small hall. */
const GROWN = [0, 1, 4, 6, 7] as const;

/** A grown row's first street, how far apart rows and pairs stand, and a plot's cell. */
const GROWTH = {
  FIRST_ROW: 20.6,
  ROW_STEP: 6.0,
  CELL_W: 4.4,
  CELL_D: 5.4,
  PAIR_STEP: 10.9,
  CELL_X: [0.2, 4.6],
} as const;

/** A district's street, its head above its plots, and its pad round them. */
const DISTRICT = { STREET: 1.2, HEAD: 0.9, PAD: 0.3, MIN_WIDTH: 26 } as const;

function moved<T extends { readonly x: number; readonly y: number }>(
  at: T,
  dx: number,
  dy: number,
): T {
  return { ...at, x: at.x + dx, y: at.y + dy };
}

/** A slot moved by `dx`, `dy` tiles. */
function shifted(slot: CampusSlot, dx: number, dy: number): CampusSlot {
  return {
    plot: moved(slot.plot, dx, dy),
    hollow: moved(slot.hollow, dx, dy),
    parts: slot.parts.map((part) =>
      "box" in part
        ? { ...part, box: moved(part.box, dx, dy) }
        : { ...part, cylinder: moved(part.cylinder, dx, dy) },
    ),
    roof: moved(slot.roof, dx, dy),
    stack: slot.stack === null ? null : moved(slot.stack, dx, dy),
    crane: slot.crane === null ? null : moved(slot.crane, dx, dy),
  };
}

/** The architecture of the `k`th grown plot, centred in the cell at (`x`, `y`). */
function grownAt(k: number, x: number, y: number): CampusSlot {
  const base = MASTER_PLAN[GROWN[k % GROWN.length] ?? 0] ?? MASTER_PLAN[0];
  if (base === undefined) throw new Error("the master plan holds no plot");
  const left = x + (GROWTH.CELL_W - base.plot.w) / 2;
  const top = y + (GROWTH.CELL_D - base.plot.d) / 2;
  return shifted(base, left - base.plot.x, top - base.plot.y);
}

/** The fewest pairs of columns that keep a town of `extra` grown plots about as deep as it is wide. */
function pairsFor(extra: number): number {
  for (let pairs = 2; ; pairs += 1) {
    const rows = Math.ceil(extra / (2 * pairs));
    if (GROWTH.FIRST_ROW + rows * GROWTH.ROW_STEP <= pairs * GROWTH.PAIR_STEP + 8) return pairs;
  }
}

/** The town's `count` slots in order: the master plan, then the grown rows. */
/** The town's slots in order, and how many pairs of columns and grown rows it took. */
interface TownSlots {
  readonly slots: CampusSlot[];
  readonly pairs: number;
  readonly rows: number;
}

function townSlots(count: number): TownSlots {
  const extra = Math.max(0, count - MASTER_PLAN.length);
  const pairs = pairsFor(extra);
  const columns = pairs * 2;
  const slots = MASTER_PLAN.slice(0, count);
  for (let k = 0; k < extra; k += 1) {
    const column = k % columns;
    const x = Math.floor(column / 2) * GROWTH.PAIR_STEP + (GROWTH.CELL_X[column % 2] ?? 0);
    const y = GROWTH.FIRST_ROW + Math.floor(k / columns) * GROWTH.ROW_STEP;
    slots.push(grownAt(k, x, y));
  }
  return { slots, pairs, rows: Math.ceil(extra / columns) };
}

/** A container's length in tiles for its pull request's lines. */
export function containerLengthOf(lines: number): number {
  return Math.min(
    CONTAINER.MAX_TILES,
    Math.max(CONTAINER.MIN_TILES, lines / CONTAINER.LINES_PER_TILE),
  );
}

function sized(container: CampusContainer): number {
  return containerLengthOf(container.additions + container.deletions);
}

/** The gate's containers in their lanes: down a lane's middle while they fit one row, else two rows a layer, stacked once both are full. */
function gatePlaced(gate: readonly CampusContainer[]): PlacedContainer[] {
  const placed: PlacedContainer[] = [];
  const start = YARD.x + 0.9;
  const end = YARD.x + YARD.w - 0.2;
  for (const { lane, y } of LANES) {
    const waiting = gate.filter((container) => container.lane === lane);
    // Note that a lane whose containers fit one row stands them down its middle; a fuller one holds two rows a layer.
    const oneRow =
      waiting.reduce((sum, container) => sum + sized(container) + 0.25, 0) <= end - start + 0.25;
    const rows = oneRow
      ? [y + LANE_DEPTH / 2]
      : [y + 0.05 + CONTAINER.WIDE / 2, y + LANE_DEPTH - 0.05 - CONTAINER.WIDE / 2];
    let x = start;
    let row = 0;
    let layer = 0;
    for (const container of waiting) {
      const w = sized(container);
      if (x + w > end && x > start) {
        row += 1;
        if (row >= rows.length) {
          row = 0;
          layer += 1;
        }
        x = start + Math.min((layer % 3) * 0.15, end - start - w);
      }
      placed.push({
        container,
        x: x + w / 2,
        y: rows[row] ?? y + LANE_DEPTH / 2,
        z: layer * CONTAINER.HIGH,
        w,
        d: CONTAINER.WIDE,
        h: CONTAINER.HIGH,
      });
      x += w + 0.25;
    }
  }
  return placed;
}

/** The lot's containers in rows, stacked `LOT_LAYERS` high, then in another block beside; and the lot as wide as its blocks. */
/** The lot's containers where they stand, and the lot as wide as they need. */
interface LotPlacement {
  readonly placed: PlacedContainer[];
  readonly rect: CampusRect;
}

function lotPlaced(lot: readonly CampusContainer[]): LotPlacement {
  const placed: PlacedContainer[] = [];
  const rowStep = CONTAINER.WIDE + 0.35;
  let block = 0;
  let layer = 0;
  let x = LOT_ORIGIN.x + 0.5;
  let y = LOT_ORIGIN.y + 0.5;
  const left = () => LOT_ORIGIN.x + block * LOT_ORIGIN.w + 0.5;
  for (const container of lot) {
    const w = sized(container);
    if (x + w > left() - 0.5 + LOT_ORIGIN.w - 0.4) {
      x = left();
      y += rowStep;
    }
    if (y + CONTAINER.WIDE > LOT_ORIGIN.y + LOT_ORIGIN.d - 0.3) {
      layer += 1;
      if (layer >= LOT_LAYERS) {
        layer = 0;
        block += 1;
      }
      x = left();
      y = LOT_ORIGIN.y + 0.5;
    }
    placed.push({
      container,
      x: x + w / 2,
      y: y + CONTAINER.WIDE / 2,
      z: layer * CONTAINER.HIGH,
      w,
      d: CONTAINER.WIDE,
      h: CONTAINER.HIGH,
    });
    x += w + 0.3;
  }
  return { placed, rect: { ...LOT_ORIGIN, w: (block + 1) * LOT_ORIGIN.w } };
}

/** Whether (`x`, `y`) stands clear of every plot. */
function clearOf(plots: readonly CampusRect[], x: number, y: number): boolean {
  return !plots.some(
    (plot) =>
      x > plot.x - 0.3 &&
      x < plot.x + plot.w + 0.3 &&
      y > plot.y - 0.3 &&
      y < plot.y + plot.d + 0.3,
  );
}

/** The zone a planned issue stands in: the first of its places the view holds. */
function zoneOfIssue(issue: FactoryPlanned, view: FactoryWorldView): string {
  return issue.zonePaths.find((path) => view.zoneByPath.has(path)) ?? NOT_IN_CODE;
}

/** One district's items before it is placed: its tasks, then its issues. */
interface DistrictGroup {
  readonly path: string;
  readonly tasks: CampusTask[];
  readonly issues: FactoryPlanned[];
}

function districtGroups(campus: CampusReading, view: FactoryWorldView): DistrictGroup[] {
  const groups = new Map<string, DistrictGroup>();
  const groupOf = (path: string): DistrictGroup => {
    const held = groups.get(path);
    if (held !== undefined) return held;
    const made: DistrictGroup = { path, tasks: [], issues: [] };
    groups.set(path, made);
    return made;
  };
  groupOf(NOT_IN_CODE);
  for (const zone of view.zones) groupOf(zone.path);
  for (const task of campus.tasks) {
    const zone = task.zone !== null && view.zoneByPath.has(task.zone) ? task.zone : NOT_IN_CODE;
    groupOf(zone).tasks.push(task);
  }
  for (const issue of campus.planned) groupOf(zoneOfIssue(issue, view)).issues.push(issue);
  return [...groups.values()].filter((group) => group.tasks.length + group.issues.length > 0);
}

/** The districts packed into a square below the gate's band, each holding its plots. */
function districtsPlan(
  campus: CampusReading,
  view: FactoryWorldView,
): Pick<CampusPlan, "plots" | "blueprints" | "districts" | "width" | "depth"> {
  const tintOf = new Map(view.zones.map((zone, index) => [zone.path, index]));
  const sizedGroups = districtGroups(campus, view).map((group) => {
    const count = group.tasks.length + group.issues.length;
    const columns = Math.max(1, Math.ceil(Math.sqrt((count * GROWTH.CELL_D) / GROWTH.CELL_W)));
    const rows = Math.ceil(count / columns);
    return {
      group,
      columns,
      w: columns * GROWTH.CELL_W + 2 * DISTRICT.PAD,
      d: rows * GROWTH.CELL_D + DISTRICT.HEAD + DISTRICT.PAD,
    };
  });
  const area = sizedGroups.reduce(
    (sum, each) => sum + (each.w + DISTRICT.STREET) * (each.d + DISTRICT.STREET),
    0,
  );
  const width = Math.max(DISTRICT.MIN_WIDTH, Math.sqrt(area) * 1.15);
  const plots = new Map<string, CampusSlot>();
  const blueprints = new Map<string, CampusSlot>();
  const districts: CampusDistrict[] = [];
  let x = 0;
  let y = DISTRICTS_TOP;
  let rowDepth = 0;
  let k = 0;
  for (const { group, columns, w, d } of sizedGroups) {
    if (x > 0 && x + w > width) {
      x = 0;
      y += rowDepth + DISTRICT.STREET;
      rowDepth = 0;
    }
    const cellOf = (index: number) =>
      grownAt(
        k++,
        x + DISTRICT.PAD + (index % columns) * GROWTH.CELL_W,
        y + DISTRICT.HEAD + Math.floor(index / columns) * GROWTH.CELL_D,
      );
    for (const [index, task] of group.tasks.entries()) plots.set(task.id, cellOf(index));
    for (const [index, issue] of group.issues.entries()) {
      blueprints.set(issue.identifier, cellOf(group.tasks.length + index));
    }
    districts.push({ path: group.path, x, y, w, d, tint: tintOf.get(group.path) ?? -1 });
    x += w + DISTRICT.STREET;
    rowDepth = Math.max(rowDepth, d);
  }
  return {
    plots,
    blueprints,
    districts,
    width: Math.max(CAMPUS_GRID, ...districts.map((each) => each.x + each.w)),
    depth: Math.max(DISTRICTS_TOP + 1, ...districts.map((each) => each.y + each.d)) + 0.4,
  };
}

/** The town: the tasks' plots in start order, then the planned issues' after them. */
function townPlan(
  campus: CampusReading,
): Pick<CampusPlan, "plots" | "blueprints" | "districts" | "width" | "depth" | "streets"> {
  const count = campus.tasks.length + campus.planned.length;
  const { slots, pairs, rows } = townSlots(count);
  const plots = new Map<string, CampusSlot>();
  const blueprints = new Map<string, CampusSlot>();
  campus.tasks.forEach((task, index) => {
    const slot = slots[index];
    if (slot !== undefined) plots.set(task.id, slot);
  });
  campus.planned.forEach((issue, index) => {
    const slot = slots[campus.tasks.length + index];
    if (slot !== undefined) blueprints.set(issue.identifier, slot);
  });
  const bottom = Math.max(
    LOT_ORIGIN.y + LOT_ORIGIN.d + 0.6,
    ...slots.map((slot) => slot.plot.y + slot.plot.d + 0.6),
  );
  return {
    plots,
    blueprints,
    districts: [],
    width: rows > 0 ? Math.max(CAMPUS_GRID, pairs * GROWTH.PAIR_STEP - 1.1) : CAMPUS_GRID,
    depth: Math.max(13.4, Math.ceil(bottom * 2) / 2),
    streets: {
      rows: Array.from(
        { length: rows },
        (_, row) => GROWTH.FIRST_ROW + row * GROWTH.ROW_STEP - 0.75,
      ),
      avenues: Array.from(
        { length: Math.max(0, pairs - 2) },
        (_, pair) => (pair + 2) * GROWTH.PAIR_STEP - 1.9,
      ),
    },
  };
}

/** Where everything on the campus stands, in the layout chosen. */
export function campusPlanOf(
  campus: CampusReading,
  view: FactoryWorldView,
  layout: CampusLayout,
): CampusPlan {
  const ground =
    layout === CAMPUS_LAYOUT.DISTRICTS
      ? { ...districtsPlan(campus, view), streets: { rows: [], avenues: [] } }
      : townPlan(campus);
  const { placed: inLot, rect: lot } = lotPlaced(campus.lot);
  const used = [...ground.plots.values(), ...ground.blueprints.values()].map((slot) => slot.plot);
  const scenery = (points: readonly (readonly [number, number])[]) =>
    points.filter(
      ([x, y]) =>
        y < ground.depth - 0.4 &&
        (layout === CAMPUS_LAYOUT.TOWN ? clearOf(used, x, y) : y < DISTRICTS_TOP - 0.5),
    );
  const grownLamps = ground.streets.rows.flatMap((row) =>
    [AVENUE.x, ...ground.streets.avenues].flatMap((avenue) =>
      [avenue - 0.3, avenue + AVENUE.wide + 0.3].map((x): readonly [number, number] => [
        x,
        row - 0.25,
      ]),
    ),
  );
  return {
    layout,
    ...ground,
    containers: [...gatePlaced(campus.gate), ...inLot],
    lot,
    trees: scenery(TREES),
    lamps: [...scenery(LAMPS), ...grownLamps.filter(([, y]) => y < ground.depth)],
  };
}
