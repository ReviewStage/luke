/**
 * campus-drawing.ts -- the campus as shapes: every plot, building, container, and sign projected onto the screen's plane as plain SVG shapes, coloured for the appearance.
 *
 * The campus is drawn isometrically: a tile `TILE.X` wide and `TILE.Y` deep
 * on screen, and a unit up `TILE.Z` high. A face is shaded by how it meets
 * one light, so walls read without a texture. Each drawing answers a list of
 * shapes, each an SVG element's name and its attributes, which the window's
 * scene puts into the page as they are; nothing here touches the DOM.
 *
 * A drawing is as cheap as the campus is large, so three things vary it:
 *
 *   - Far out (`CAMPUS_DETAIL.FAR`), a wall's windows are one lit band a face,
 *     and a scene draws no shadows.
 *   - In a big campus (`big`), a lit window glows by a soft stroke rather
 *     than the scene's blur filter, and smoke stands still.
 *   - Under `still`, smoke stands still as well: a still frame says that an
 *     agent runs as a moving one does.
 *
 * What a drawing marks (`SHAPE_MARK`) is what the scene's stylesheet answers:
 * a glow, a loop, or a lit window a switched-off layer puts out. The signals
 * keep `SIGNAL_COLOR` unchanged; the ground, walls and props are the campus's
 * own, in `CAMPUS_PALETTE`.
 */

import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { FactoryPlanned } from "@luke/features/factory-world-wire";
import { AGENT_STATE, type AgentView } from "./agent-reading.js";
import {
  AVENUE,
  BARRIER,
  CAMPUS_GRID,
  CAMPUS_LAYOUT,
  CAMPUS_MATERIAL,
  type CampusBox,
  type CampusDistrict,
  type CampusMaterial,
  type CampusPlan,
  type CampusPoint,
  type CampusRect,
  type CampusSlot,
  type CampusWindows,
  DISTRICTS_TOP,
  GATEHOUSE,
  LANE_DEPTH,
  LANES,
  PART_ROLE,
  type PartRole,
  type PlacedContainer,
  YARD,
} from "./campus-layout.js";
import {
  CAMPUS_SIGNAL,
  type CampusSignal,
  type CampusTask,
  CONTAINER_PLACE,
  GATE_LANE,
  type GateLane,
} from "./campus-reading.js";
import { SIGNAL_COLOR } from "./signal-palette.js";

/** One tile on screen: its half-width, its half-depth, and a unit's height, in pixels at a scale of one. */
const TILE = { X: 22, Y: 11, Z: 25 } as const;

/** How much a drawing shows: all of it close in, or one band a wall far out. */
export const CAMPUS_DETAIL = {
  NEAR: "near",
  FAR: "far",
} as const;

export type CampusDetail = (typeof CAMPUS_DETAIL)[keyof typeof CAMPUS_DETAIL];

/** The layers of the pipeline bar a shape belongs to, by the same names the bar switches. */
const CAMPUS_LAYER = {
  PLANNED: "planned",
  BUILDING: "building",
  SHIPPED: "shipped",
  DEFECTS: "defects",
} as const;

type CampusLayer = (typeof CAMPUS_LAYER)[keyof typeof CAMPUS_LAYER];

/** What the scene's stylesheet does with a shape. */
export const SHAPE_MARK = {
  /** A lit window: it glows where the scene affords a blur, and goes out with its layer. */
  LIT: "lit",
  /** A light that glows where the scene affords a blur. */
  GLOW: "glow",
  SMOKE: "smoke",
  PULSE: "pulse",
  FLAG: "flag",
  BELT: "belt",
} as const;

export type ShapeMark = (typeof SHAPE_MARK)[keyof typeof SHAPE_MARK];

/** The SVG elements a shape is. */
const SHAPE_TAG = {
  POLYGON: "polygon",
  POLYLINE: "polyline",
  LINE: "line",
  CIRCLE: "circle",
  ELLIPSE: "ellipse",
  PATH: "path",
  RECT: "rect",
} as const;

type ShapeTag = (typeof SHAPE_TAG)[keyof typeof SHAPE_TAG];

/** A shape's attributes, by the names a React SVG element takes them. */
interface ShapeAttributes {
  readonly points?: string;
  readonly d?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly x1?: number;
  readonly y1?: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly cx?: number;
  readonly cy?: number;
  readonly r?: number;
  readonly fill?: string;
  readonly fillOpacity?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly strokeOpacity?: number;
  readonly strokeDasharray?: string | undefined;
  readonly strokeLinecap?: "round";
  readonly strokeLinejoin?: "round";
  readonly opacity?: number;
}

/** A gradient a shape is filled with, which the scene defines once. */
export const CAMPUS_GRADIENT = {
  METAL: "metal",
  BRICK: "brick",
  POOL: "pool",
} as const;

export type CampusGradient = (typeof CAMPUS_GRADIENT)[keyof typeof CAMPUS_GRADIENT];

/** One shape: its element, its attributes, and what the stylesheet does with it. */
export interface CampusShape {
  readonly tag: ShapeTag;
  readonly attributes: ShapeAttributes;
  readonly mark?: ShapeMark | undefined;
  /** The layer that, switched off, puts it out. */
  readonly layer?: CampusLayer | undefined;
  /** Filled with this gradient rather than `fill`. */
  readonly gradient?: CampusGradient;
}

/** The campus's own colours in one appearance: its ground, its walls, and its props. */
export interface CampusColours {
  readonly ground: string;
  readonly slab: string;
  readonly grass: string;
  readonly road: string;
  readonly plaza: string;
  readonly line: string;
  readonly pad: string;
  readonly yard: string;
  readonly lot: string;
  readonly lotFloor: string;
  readonly wall: string;
  readonly brick: string;
  readonly glass: string;
  readonly roof: string;
  readonly metal: string;
  readonly floor: string;
  readonly unlit: string;
  readonly idle: string;
  readonly tree: string;
  readonly treeLit: string;
  readonly trunk: string;
  readonly shadow: string;
  readonly smoke: string;
  readonly lamp: string;
  readonly crate: string;
  readonly barrier: string;
  readonly belt: string;
  readonly beltMark: string;
  readonly openContainer: string;
  readonly mergedContainer: string;
  readonly scaffold: string;
  readonly crane: string;
  readonly edge: string;
  readonly corrugation: string;
  readonly cut: string;
  /** A district's tint, by its zone's place among the view's. */
  readonly districts: readonly string[];
}

/** The campus's colours in each appearance. */
const CAMPUS_PALETTE = {
  DARK: {
    ground: "#101115",
    slab: "#18191e",
    grass: "#141a17",
    road: "#1f2026",
    plaza: "#24252c",
    line: "rgba(255,255,255,0.16)",
    pad: "#1d1e24",
    yard: "#1c1d23",
    lot: "#1b1c22",
    lotFloor: "#1f1d27",
    wall: "#3a3c46",
    brick: "#45403c",
    glass: "#1f2a36",
    roof: "#2c2e36",
    metal: "#4b4e5a",
    floor: "#2a2b33",
    unlit: "#16171c",
    idle: "#e7d9bd",
    tree: "#1f3a2d",
    treeLit: "#2a4a39",
    trunk: "#3a2f28",
    shadow: "rgba(0,0,0,0.42)",
    smoke: "#8a8d99",
    lamp: "#ffd9a0",
    crate: "#5a4a36",
    barrier: "#e6e8ee",
    belt: "#2a2c33",
    beltMark: "#6b6f7c",
    openContainer: "#555b69",
    mergedContainer: "#5f5675",
    scaffold: "#8a7a4a",
    crane: "#e0b42e",
    edge: "rgba(255,255,255,0.05)",
    corrugation: "rgba(0,0,0,0.28)",
    cut: "rgba(255,255,255,0.25)",
    districts: ["#5b8def", "#d6a243", "#4fb38a", "#c770c9", "#e07a5f", "#7aa3b8"],
  },
  LIGHT: {
    ground: "#f2f1ec",
    slab: "#e7e8ec",
    grass: "#dfe7df",
    road: "#d3d4da",
    plaza: "#e2e3e8",
    line: "rgba(255,255,255,0.9)",
    pad: "#f1f1f4",
    yard: "#e9eaee",
    lot: "#e4e5ea",
    lotFloor: "#ebe8f2",
    wall: "#f7f7f9",
    brick: "#efe7df",
    glass: "#bfd3e6",
    roof: "#e3e4ea",
    metal: "#c4c7d0",
    floor: "#ececf0",
    unlit: "#c8d2df",
    idle: "#8b93a3",
    tree: "#8fb89a",
    treeLit: "#a8cbb0",
    trunk: "#9b8572",
    shadow: "rgba(30,30,60,0.16)",
    smoke: "#c9ccd4",
    lamp: "#ffd9a0",
    crate: "#c9a77a",
    barrier: "#ffffff",
    belt: "#9a9eaa",
    beltMark: "#e8e9ee",
    openContainer: "#c3c7d1",
    mergedContainer: "#b9b0cf",
    scaffold: "#b89a52",
    crane: "#c9a227",
    edge: "rgba(0,0,0,0.06)",
    corrugation: "rgba(0,0,0,0.12)",
    cut: "rgba(0,0,0,0.15)",
    districts: ["#3d6fd6", "#b8861f", "#2f9470", "#a650a8", "#c45a3f", "#4f7f96"],
  },
} satisfies { readonly DARK: CampusColours; readonly LIGHT: CampusColours };

/** What every drawing is drawn for: the appearance, how near, and how big the campus is. */
export interface CampusDrawing {
  readonly dark: boolean;
  readonly detail: CampusDetail;
  /** Past `CAMPUS_BIG_FROM` tasks: glows are strokes, smoke stands still, and no crane turns. */
  readonly big: boolean;
  /** Motion held still: smoke stands still. */
  readonly still: boolean;
}

/** The number of tasks past which a campus is big. */
export const CAMPUS_BIG_FROM = 20;

/** The most stacks that smoke at once; the rest of a busy campus is lit, not animated. */
const SMOKE_MAX = 24;

type Vector = readonly [number, number, number];

const LIGHT_DIRECTION: Vector = (() => {
  const raw: Vector = [0.38, -0.32, 0.87];
  const length = Math.hypot(...raw);
  return [raw[0] / length, raw[1] / length, raw[2] / length];
})();
const TOP: Vector = [0, 0, 1];
const FACE_X: Vector = [1, 0, 0];
const FACE_Y: Vector = [0, 1, 0];
/** How far a shadow falls for a unit of height. */
const SHADOW_REACH = 1.25;

/** The colours of the appearance drawn. */
export function campusColoursOf(dark: boolean): CampusColours {
  return dark ? CAMPUS_PALETTE.DARK : CAMPUS_PALETTE.LIGHT;
}

/** Where a point on the grid falls on screen, at a scale of one. */
export function campusProject(x: number, y: number, z: number): readonly [number, number] {
  return [(x - y) * TILE.X, (x + y) * TILE.Y - z * TILE.Z];
}

/** How near the viewer a point on the ground stands: what is drawn later stands in front. */
function campusDepthOf(x: number, y: number): number {
  return x + y;
}

/** The detail a scale on screen affords: far once a tile is under 13 pixels across. */
export function campusDetailOf(scale: number): CampusDetail {
  return scale * TILE.X < 13 ? CAMPUS_DETAIL.FAR : CAMPUS_DETAIL.NEAR;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function pointsOf(list: readonly (readonly [number, number])[]): string {
  return list.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

function projected(list: readonly (readonly [number, number, number])[]): string {
  return pointsOf(list.map(([x, y, z]) => campusProject(x, y, z)));
}

function polygon(points: string, fill: string, more: ShapeAttributes = {}): CampusShape {
  return { tag: SHAPE_TAG.POLYGON, attributes: { points, fill, ...more } };
}

function line(
  from: readonly [number, number],
  to: readonly [number, number],
  stroke: string,
  strokeWidth: number,
  more: ShapeAttributes = {},
): CampusShape {
  return {
    tag: SHAPE_TAG.LINE,
    attributes: {
      x1: round(from[0]),
      y1: round(from[1]),
      x2: round(to[0]),
      y2: round(to[1]),
      stroke,
      strokeWidth,
      ...more,
    },
  };
}

function toRgb(colour: string): Vector {
  if (colour.startsWith("#")) {
    const value = Number.parseInt(colour.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b];
}

/** `colour` as a face turned to `normal` shows it under the campus's light. */
function shade(colour: string, normal: Vector, dark: boolean): string {
  const facing = Math.max(
    0,
    normal[0] * LIGHT_DIRECTION[0] +
      normal[1] * LIGHT_DIRECTION[1] +
      normal[2] * LIGHT_DIRECTION[2],
  );
  const factor = (dark ? 0.62 : 0.8) + (dark ? 0.5 : 0.22) * facing;
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  const [r, g, b] = toRgb(colour);
  return `rgb(${channel(r)},${channel(g)},${channel(b)})`;
}

function normalOf(a: Vector, b: Vector, c: Vector): Vector {
  const u: Vector = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vector = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vector = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(...n) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

function materialColour(material: CampusMaterial, colours: CampusColours): string {
  return colours[material];
}

/** How a building's windows are lit: their colour, how many of them, how bright, and the layer that puts them out. */
interface Lit {
  readonly colour: string;
  readonly ratio: number;
  readonly opacity: number;
  readonly layer: CampusLayer | null;
}

/** What a building's windows say for what its task says. */
function litOf(signal: CampusSignal, drawing: CampusDrawing): Lit {
  const idle = {
    colour: campusColoursOf(drawing.dark).idle,
    ratio: 0.16,
    opacity: drawing.dark ? 0.32 : 0.45,
    layer: null,
  };
  const full = drawing.dark ? 0.92 : 0.75;
  switch (signal) {
    case CAMPUS_SIGNAL.FAILED:
      return {
        colour: SIGNAL_COLOR.DEFECT,
        ratio: 0.7,
        opacity: full,
        layer: CAMPUS_LAYER.DEFECTS,
      };
    case CAMPUS_SIGNAL.WORKING:
      return {
        colour: SIGNAL_COLOR.BUILDING,
        ratio: 0.85,
        opacity: full,
        layer: CAMPUS_LAYER.BUILDING,
      };
    case CAMPUS_SIGNAL.WAITING:
      return {
        colour: SIGNAL_COLOR.BUILDING,
        ratio: 0.5,
        opacity: full * 0.8,
        layer: CAMPUS_LAYER.BUILDING,
      };
    case CAMPUS_SIGNAL.STUCK:
      return {
        colour: SIGNAL_COLOR.BUILDING,
        ratio: 0.3,
        opacity: 0.55,
        layer: CAMPUS_LAYER.BUILDING,
      };
    case CAMPUS_SIGNAL.SHIPPED:
    case CAMPUS_SIGNAL.IDLE:
      return idle;
  }
}

/** A box's corners on the ground and its top's four heights. */
interface Corners {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  readonly h00: number;
  readonly h10: number;
  readonly h11: number;
  readonly h01: number;
}

function cornersOf(box: CampusBox): Corners {
  const [h00, h10, h11, h01] = box.hs ?? [box.h, box.h, box.h, box.h];
  return {
    x0: box.x,
    x1: box.x + box.w,
    y0: box.y,
    y1: box.y + box.d,
    z: box.z,
    h00,
    h10,
    h11,
    h01,
  };
}

/** One wall's windows, a face at a time: the face along y at x1, then the face along x at y1. */
function windowShapes(
  corners: Corners,
  windows: CampusWindows,
  lit: Lit | null,
  drawing: CampusDrawing,
): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const { x0, x1, y0, y1, z } = corners;
  const top = Math.min(corners.h00, corners.h10, corners.h11, corners.h01);
  const unlit = (normal: Vector) =>
    windows.band === true ? shade(colours.glass, normal, drawing.dark) : colours.unlit;
  const ratio = (lit?.ratio ?? 0) * (windows.dim ?? 1);
  const litMark = {
    mark: lit === null ? undefined : SHAPE_MARK.LIT,
    layer: lit?.layer ?? undefined,
  };
  if (drawing.detail === CAMPUS_DETAIL.FAR) {
    const low = z + 0.18;
    const high = z + top - 0.14;
    if (high <= low) return [];
    const fill = lit === null ? unlit(FACE_X) : lit.colour;
    const opacity = lit === null ? 1 : Math.min(0.85, ratio * lit.opacity);
    return [
      {
        ...polygon(
          projected([
            [x1, y0 + 0.12, low],
            [x1, y1 - 0.12, low],
            [x1, y1 - 0.12, high],
            [x1, y0 + 0.12, high],
          ]),
          fill,
          { opacity: round(opacity * 100) / 100 },
        ),
        ...litMark,
      },
      {
        ...polygon(
          projected([
            [x0 + 0.12, y1, low],
            [x1 - 0.12, y1, low],
            [x1 - 0.12, y1, high],
            [x0 + 0.12, y1, high],
          ]),
          fill,
          { opacity: round(opacity * 100) / 100 },
        ),
        ...litMark,
      },
    ];
  }
  const shapes: CampusShape[] = [];
  let seed = windows.seed;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const rowHeight = (top - 0.3) / windows.rows;
  for (const along of ["y", "x"] as const) {
    const length = along === "y" ? y1 - y0 : x1 - x0;
    const columns = Math.max(1, Math.round(length * windows.per));
    const width = length / columns;
    const normal = along === "y" ? FACE_X : FACE_Y;
    for (let row = 0; row < windows.rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const u0 = column * width + width * 0.22;
        const u1 = (column + 1) * width - width * 0.22;
        const low = z + 0.18 + row * rowHeight + rowHeight * 0.2;
        const high = z + 0.18 + (row + 1) * rowHeight - rowHeight * 0.2;
        const points =
          along === "y"
            ? projected([
                [x1, y0 + u0, low],
                [x1, y0 + u1, low],
                [x1, y0 + u1, high],
                [x1, y0 + u0, high],
              ])
            : projected([
                [x0 + u0, y1, low],
                [x0 + u1, y1, low],
                [x0 + u1, y1, high],
                [x0 + u0, y1, high],
              ]);
        const on = lit !== null && random() < ratio;
        if (!on || lit === null) {
          shapes.push(polygon(points, unlit(normal)));
          continue;
        }
        const halo: ShapeAttributes = drawing.big
          ? { stroke: lit.colour, strokeOpacity: 0.35, strokeWidth: 2.4, strokeLinejoin: "round" }
          : {};
        shapes.push({
          ...polygon(points, lit.colour, { opacity: lit.opacity, ...halo }),
          ...litMark,
        });
      }
    }
  }
  return shapes;
}

/** A box's top and its two faces the viewer sees, with its windows and its lit band where it has them. */
function boxShapes(
  box: CampusBox,
  base: string,
  drawing: CampusDrawing,
  extra: {
    readonly windows?: CampusWindows | undefined;
    readonly lit?: Lit | null;
    readonly stripe?: boolean;
    readonly topFill?: string;
  } = {},
): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const corners = cornersOf(box);
  const { x0, x1, y0, y1, z } = corners;
  const top: Vector[] = [
    [x0, y0, z + corners.h00],
    [x1, y0, z + corners.h10],
    [x1, y1, z + corners.h11],
    [x0, y1, z + corners.h01],
  ];
  const [a, b, , d] = top;
  const normal = a === undefined || b === undefined || d === undefined ? TOP : normalOf(a, b, d);
  const edge: ShapeAttributes = { stroke: colours.edge, strokeWidth: 0.6 };
  const shapes = [
    polygon(
      projected(top),
      extra.topFill ?? shade(base, normal[2] < 0 ? TOP : normal, drawing.dark),
      edge,
    ),
    polygon(
      projected([
        [x1, y0, z],
        [x1, y1, z],
        [x1, y1, z + corners.h11],
        [x1, y0, z + corners.h10],
      ]),
      shade(base, FACE_X, drawing.dark),
      edge,
    ),
    polygon(
      projected([
        [x0, y1, z],
        [x1, y1, z],
        [x1, y1, z + corners.h11],
        [x0, y1, z + corners.h01],
      ]),
      shade(base, FACE_Y, drawing.dark),
      edge,
    ),
  ];
  if (extra.windows !== undefined)
    shapes.push(...windowShapes(corners, extra.windows, extra.lit ?? null, drawing));
  if (extra.stripe === true && extra.lit !== undefined && extra.lit !== null) {
    const height = Math.min(corners.h00, corners.h10, corners.h11, corners.h01);
    const low = z + height - 0.12;
    const high = z + height - 0.02;
    const layer = { layer: extra.lit.layer ?? undefined };
    shapes.push(
      {
        ...polygon(
          projected([
            [x1, y0, low],
            [x1, y1, low],
            [x1, y1, high],
            [x1, y0, high],
          ]),
          extra.lit.colour,
        ),
        mark: SHAPE_MARK.LIT,
        ...layer,
      },
      {
        ...polygon(
          projected([
            [x0, y1, low],
            [x1, y1, low],
            [x1, y1, high],
            [x0, y1, high],
          ]),
          extra.lit.colour,
        ),
        mark: SHAPE_MARK.LIT,
        ...layer,
      },
    );
  }
  return shapes;
}

/** A cylinder standing at (`x`, `y`): its side in its material's gradient, its bands, and its top. */
function cylinderShapes(
  cylinder: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly z: number;
    readonly h: number;
  },
  material: CampusMaterial,
  bands: readonly number[],
  drawing: CampusDrawing,
): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const [bx, by] = campusProject(cylinder.x, cylinder.y, cylinder.z);
  const [tx, ty] = campusProject(cylinder.x, cylinder.y, cylinder.z + cylinder.h);
  const rx = cylinder.r * TILE.X * Math.SQRT2;
  const ry = cylinder.r * TILE.Y * Math.SQRT2;
  const gradient =
    material === CAMPUS_MATERIAL.BRICK ? CAMPUS_GRADIENT.BRICK : CAMPUS_GRADIENT.METAL;
  const shapes: CampusShape[] = [
    {
      tag: SHAPE_TAG.PATH,
      attributes: {
        d: `M${round(bx - rx)},${round(by)} L${round(tx - rx)},${round(ty)} L${round(tx + rx)},${round(ty)} L${round(bx + rx)},${round(by)} A${round(rx)},${round(ry)} 0 0 1 ${round(bx - rx)},${round(by)} Z`,
      },
      gradient,
    },
  ];
  for (const band of bands) {
    const [, y] = campusProject(cylinder.x, cylinder.y, cylinder.z + cylinder.h * band);
    shapes.push({
      tag: SHAPE_TAG.PATH,
      attributes: {
        d: `M${round(bx - rx)},${round(y)} A${round(rx)},${round(ry)} 0 0 0 ${round(bx + rx)},${round(y)}`,
        fill: "none",
        stroke: colours.corrugation,
        strokeWidth: 1,
      },
    });
  }
  shapes.push({
    tag: SHAPE_TAG.ELLIPSE,
    attributes: {
      cx: round(tx),
      cy: round(ty),
      rx: round(rx),
      ry: round(ry),
      fill: shade(materialColour(material, colours), TOP, drawing.dark),
    },
  });
  return shapes;
}

/** The stops of each gradient the scene defines, in the appearance drawn: left, middle, right. */
export function campusGradientStopsOf(gradient: CampusGradient, dark: boolean): readonly string[] {
  const colours = campusColoursOf(dark);
  if (gradient === CAMPUS_GRADIENT.POOL) return [colours.lamp];
  const base = gradient === CAMPUS_GRADIENT.BRICK ? colours.brick : colours.metal;
  return [shade(base, FACE_Y, dark), shade(base, [0.6, 0.6, 0.2], dark), shade(base, FACE_X, dark)];
}

function hull(points: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const cross = (
    o: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly (readonly [number, number])[]) => {
    const kept: (readonly [number, number])[] = [];
    for (const point of list) {
      while (kept.length >= 2) {
        const last = kept[kept.length - 1];
        const before = kept[kept.length - 2];
        if (last === undefined || before === undefined || cross(before, last, point) > 0) break;
        kept.pop();
      }
      kept.push(point);
    }
    return kept.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The shadow a footprint of `ring` casts from `height`, as a closed subpath. */
function shadowOf(ring: readonly (readonly [number, number])[], height: number): string {
  const sx = (-LIGHT_DIRECTION[0] / LIGHT_DIRECTION[2]) * height * SHADOW_REACH;
  const sy = (-LIGHT_DIRECTION[1] / LIGHT_DIRECTION[2]) * height * SHADOW_REACH;
  const outline = hull([
    ...ring,
    ...ring.map(([x, y]): readonly [number, number] => [x + sx, y + sy]),
  ]);
  return `M${pointsOf(outline.map(([x, y]) => campusProject(x, y, 0.02)))}Z`;
}

function boxRing(box: CampusRect): (readonly [number, number])[] {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.d],
    [box.x, box.y + box.d],
  ];
}

function circleRing(x: number, y: number, r: number): (readonly [number, number])[] {
  return Array.from({ length: 12 }, (_, step) => {
    const angle = (step / 12) * Math.PI * 2;
    return [x + Math.cos(angle) * r, y + Math.sin(angle) * r] as const;
  });
}

/** The shadows a building casts: every part standing on the ground. */
export function buildingShadowOf(slot: CampusSlot): string {
  return slot.parts
    .map((part) => {
      if ("box" in part) {
        if (part.box.z !== 0) return "";
        const corners = cornersOf(part.box);
        return shadowOf(
          boxRing(part.box),
          Math.max(corners.h00, corners.h10, corners.h11, corners.h01),
        );
      }
      return part.beside === true
        ? shadowOf(circleRing(part.cylinder.x, part.cylinder.y, part.cylinder.r), part.cylinder.h)
        : "";
    })
    .join("");
}

/** The shadow a container on the ground casts; none for one stacked. */
export function containerShadowOf(placed: PlacedContainer): string {
  if (placed.z > 0) return "";
  return shadowOf(
    boxRing({ x: placed.x - placed.w / 2, y: placed.y - placed.d / 2, w: placed.w, d: placed.d }),
    placed.h,
  );
}

/** The shadow a tree casts. */
export function treeShadowOf(x: number, y: number): string {
  return shadowOf(circleRing(x, y, 0.3), 1.1);
}

/** The gatehouse's shadow. */
export function gateShadowOf(): string {
  return shadowOf(boxRing(GATEHOUSE), 1);
}

/** The campus's shadows' fill. */
export function shadowFillOf(dark: boolean): string {
  return campusColoursOf(dark).shadow;
}

function flat(rect: CampusRect, fill: string, z: number, more: ShapeAttributes = {}): CampusShape {
  return polygon(
    projected([
      [rect.x, rect.y, z],
      [rect.x + rect.w, rect.y, z],
      [rect.x + rect.w, rect.y + rect.d, z],
      [rect.x, rect.y + rect.d, z],
    ]),
    fill,
    more,
  );
}

/** A rectangle's outline on the ground, for a selection to edge. */
export function outlineOf(rect: CampusRect, z: number): string {
  return projected([
    [rect.x, rect.y, z],
    [rect.x + rect.w, rect.y, z],
    [rect.x + rect.w, rect.y + rect.d, z],
    [rect.x, rect.y + rect.d, z],
  ]);
}

function slabBox(rect: CampusRect): CampusBox {
  return { ...rect, z: -0.6, h: 0.6 };
}

/** The ground: its slabs, its avenues and lane marks, the yard, and the lot. */
export function groundShapesOf(plan: CampusPlan, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const shapes: CampusShape[] = [];
  const { width, depth, lot } = plan;
  const districts = plan.layout === CAMPUS_LAYOUT.DISTRICTS;
  const lawnDepth = districts ? DISTRICTS_TOP - 0.2 : Math.min(depth, CAMPUS_GRID);
  shapes.push(
    ...boxShapes(slabBox({ x: 0, y: 0, w: CAMPUS_GRID, d: lawnDepth }), colours.slab, drawing, {
      topFill: colours.grass,
    }),
  );
  if (districts) {
    shapes.push(
      ...boxShapes(
        slabBox({ x: 0, y: lawnDepth, w: width, d: depth - lawnDepth }),
        colours.slab,
        drawing,
        { topFill: colours.road },
      ),
    );
  } else if (depth > CAMPUS_GRID) {
    shapes.push(
      ...boxShapes(
        slabBox({ x: 0, y: CAMPUS_GRID, w: width, d: depth - CAMPUS_GRID }),
        colours.slab,
        drawing,
        { topFill: colours.grass },
      ),
    );
  }
  shapes.push(
    ...boxShapes(
      slabBox({
        x: CAMPUS_GRID,
        y: lot.y - 0.3,
        w: lot.x + lot.w - CAMPUS_GRID + 0.3,
        d: lot.d + 0.6,
      }),
      colours.slab,
      drawing,
      { topFill: colours.lot },
    ),
  );
  shapes.push(flat({ x: 0, y: AVENUE.y, w: CAMPUS_GRID, d: AVENUE.wide }, colours.road, 0.01));
  shapes.push(
    flat(
      { x: CAMPUS_GRID, y: AVENUE.y, w: lot.x - CAMPUS_GRID + 0.2, d: AVENUE.wide },
      colours.road,
      0.01,
    ),
  );
  const downTo = districts ? DISTRICTS_TOP : depth;
  shapes.push(
    flat(
      {
        x: AVENUE.x,
        y: districts ? AVENUE.y : 0,
        w: AVENUE.wide,
        d: districts ? downTo - AVENUE.y : depth,
      },
      colours.road,
      0.01,
    ),
  );
  for (const row of plan.streets.rows)
    shapes.push(flat({ x: 0, y: row, w: width, d: 0.6 }, colours.road, 0.01));
  for (const avenue of plan.streets.avenues) {
    if (depth > CAMPUS_GRID)
      shapes.push(
        flat(
          { x: avenue, y: CAMPUS_GRID, w: AVENUE.wide, d: depth - CAMPUS_GRID },
          colours.road,
          0.01,
        ),
      );
  }
  for (let at = 0.4; at < Math.max(CAMPUS_GRID, downTo); at += 1.2) {
    if (at > 8.6 && at < 11.4) continue;
    if (at < CAMPUS_GRID)
      shapes.push(flat({ x: at, y: 9.96, w: 0.6, d: 0.08 }, colours.line, 0.02));
    if (!districts || at < DISTRICTS_TOP)
      shapes.push(flat({ x: 9.96, y: at, w: 0.08, d: 0.6 }, colours.line, 0.02));
  }
  shapes.push(
    flat({ x: AVENUE.x, y: AVENUE.y, w: AVENUE.wide, d: AVENUE.wide }, colours.plaza, 0.015),
  );
  shapes.push(flat(YARD, colours.yard, 0.012));
  for (const lane of LANES)
    shapes.push(
      flat(
        { x: YARD.x + 0.15, y: lane.y + LANE_DEPTH - 0.04, w: YARD.w - 0.3, d: 0.04 },
        colours.line,
        0.02,
      ),
    );
  shapes.push(
    flat(
      { x: lot.x + 0.1, y: lot.y + 0.1, w: lot.w - 0.2, d: lot.d - 0.2 },
      colours.lotFloor,
      0.012,
    ),
  );
  return shapes;
}

/** A district's ground: its tint over the lawn, edged in it. */
export function districtShapesOf(district: CampusDistrict, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const tint =
    district.tint < 0
      ? colours.idle
      : (colours.districts[district.tint % colours.districts.length] ?? colours.idle);
  return [
    flat(district, colours.grass, 0.01),
    flat(district, tint, 0.01, {
      fillOpacity: drawing.dark ? 0.07 : 0.06,
      stroke: tint,
      strokeOpacity: 0.5,
      strokeWidth: 1.2,
    }),
  ];
}

/** A plot's pad. */
export function plotShapesOf(slot: CampusSlot, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  return boxShapes({ ...slot.plot, z: 0, h: 0.1 }, colours.pad, drawing, { topFill: colours.pad });
}

/** What a building is drawn in, in order: what stands behind it, its hall's inside (only when open), its parts, its crane, its scaffold, what stands before it, and its roof's sign. */
export const PIECE = {
  BESIDE: "beside",
  INSIDE: "inside",
  SHELL: "shell",
  UPPER: "upper",
  KEEP: "keep",
  CRANE: "crane",
  SCAFFOLD: "scaffold",
  SIGN: "sign",
} as const;

export type PieceKind = (typeof PIECE)[keyof typeof PIECE];

/** One piece of a building: its kind, its shapes, and the layer that hides it. */
export interface BuildingPiece {
  readonly kind: PieceKind;
  readonly shapes: readonly CampusShape[];
  readonly layer?: CampusLayer;
}

/** An open building's inside: its floor and back walls, its line's stations, and its cut walls in front. */
interface InsideShapes {
  readonly back: readonly CampusShape[];
  readonly stations: readonly StationPiece[];
  readonly front: readonly CampusShape[];
}

/** Where the gate's name and the lot's hang, on screen at a scale of one. */
interface YardAnchors {
  readonly gate: readonly [number, number];
  readonly lot: readonly [number, number];
}

/** A rectangle on screen at a scale of one. */
export interface ScreenBounds {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** A station of an open building's line: the agent it is, and how it is drawn. */
interface StationPiece {
  readonly agentId: string | null;
  readonly shapes: readonly CampusShape[];
}

const ROLE_PIECE = {
  [PART_ROLE.SHELL]: PIECE.SHELL,
  [PART_ROLE.UPPER]: PIECE.UPPER,
  [PART_ROLE.KEEP]: PIECE.KEEP,
} as const satisfies Record<PartRole, PieceKind>;

/** The pause sign, the failed light, or the flag on a roof, and the smoke from its stack. */
function signShapes(
  task: CampusTask,
  slot: CampusSlot,
  drawing: CampusDrawing,
  smokes: boolean,
): BuildingPiece[] {
  const colours = campusColoursOf(drawing.dark);
  const [px, py] = campusProject(slot.roof.x, slot.roof.y, slot.roof.z);
  const pieces: BuildingPiece[] = [];
  if (task.signal === CAMPUS_SIGNAL.FAILED) {
    pieces.push({
      kind: PIECE.SIGN,
      layer: CAMPUS_LAYER.DEFECTS,
      shapes: [
        {
          tag: SHAPE_TAG.CIRCLE,
          attributes: { cx: round(px), cy: round(py), r: 5, fill: SIGNAL_COLOR.DEFECT },
          mark: SHAPE_MARK.PULSE,
        },
      ],
    });
  } else if (task.signal === CAMPUS_SIGNAL.STUCK) {
    pieces.push({
      kind: PIECE.SIGN,
      layer: CAMPUS_LAYER.BUILDING,
      shapes: [
        line([px, py + 14], [px, py], colours.metal, 2),
        {
          tag: SHAPE_TAG.CIRCLE,
          attributes: { cx: round(px), cy: round(py - 4), r: 8, fill: SIGNAL_COLOR.BUILDING },
        },
        {
          tag: SHAPE_TAG.RECT,
          attributes: {
            x: round(px - 3.6),
            y: round(py - 8),
            width: 2.4,
            height: 8,
            rx: 0.6,
            fill: colours.barrier,
          },
        },
        {
          tag: SHAPE_TAG.RECT,
          attributes: {
            x: round(px + 1.2),
            y: round(py - 8),
            width: 2.4,
            height: 8,
            rx: 0.6,
            fill: colours.barrier,
          },
        },
      ],
    });
  } else if (task.shipped && !task.working) {
    pieces.push({
      kind: PIECE.SIGN,
      layer: CAMPUS_LAYER.SHIPPED,
      shapes: [
        line([px, py], [px, py - 34], colours.metal, 1.6),
        {
          tag: SHAPE_TAG.PATH,
          attributes: {
            d: `M${round(px)},${round(py - 34)} l18,4 l-18,6 Z`,
            fill: SIGNAL_COLOR.SHIPPED,
          },
          mark: SHAPE_MARK.FLAG,
        },
      ],
    });
  }
  if (smokes) {
    // Note that a building with no stack of its own smokes from its roof.
    const mouth = slot.stack ?? slot.roof;
    const [sx, sy] = campusProject(mouth.x, mouth.y, mouth.z);
    const moving = !drawing.big && !drawing.still;
    // Note that still smoke is three puffs drifting off the stack, which a moving one passes through.
    const puffs = moving
      ? [0, 1, 2, 3, 4].map(
          (): CampusShape => ({
            tag: SHAPE_TAG.CIRCLE,
            attributes: { cx: round(sx), cy: round(sy), r: 5, fill: colours.smoke, opacity: 0 },
            mark: SHAPE_MARK.SMOKE,
          }),
        )
      : [0, 1, 2].map(
          (step): CampusShape => ({
            tag: SHAPE_TAG.CIRCLE,
            attributes: {
              cx: round(sx - step * 6),
              cy: round(sy - 8 - step * 16),
              r: 4 + step * 2.5,
              fill: colours.smoke,
              opacity: 0.55 - step * 0.15,
            },
          }),
        );
    pieces.push({ kind: PIECE.SIGN, layer: CAMPUS_LAYER.BUILDING, shapes: puffs });
  }
  return pieces;
}

/** A tower crane at its jib's `angle`, in radians. */
export function craneShapesOf(
  crane: NonNullable<CampusSlot["crane"]>,
  angle: number,
  dark: boolean,
): CampusShape[] {
  const colours = campusColoursOf(dark);
  const drawing: CampusDrawing = { dark, detail: CAMPUS_DETAIL.NEAR, big: false, still: true };
  const { x, y, h, jib } = crane;
  const shapes = boxShapes(
    { x: x - 0.09, y: y - 0.09, w: 0.18, d: 0.18, z: 0, h },
    colours.crane,
    drawing,
  );
  const [tx, ty] = campusProject(x, y, h);
  const tip = campusProject(x + Math.cos(angle) * jib, y + Math.sin(angle) * jib, h + 0.1);
  const back = campusProject(x - Math.cos(angle) * 1.1, y - Math.sin(angle) * 1.1, h + 0.1);
  const trolley = [x + Math.cos(angle) * jib * 0.7, y + Math.sin(angle) * jib * 0.7] as const;
  const hook = campusProject(trolley[0], trolley[1], h + 0.1);
  const load = campusProject(trolley[0], trolley[1], h - 1.6);
  shapes.push(
    line(back, tip, colours.crane, 3, { strokeLinecap: "round" }),
    line([tx, ty - 14], tip, colours.crane, 0.8),
    line([tx, ty - 14], back, colours.crane, 0.8),
    line([tx, ty], [tx, ty - 14], colours.crane, 2),
    {
      tag: SHAPE_TAG.RECT,
      attributes: {
        x: round(back[0] - 5),
        y: round(back[1] - 2),
        width: 10,
        height: 7,
        fill: colours.metal,
      },
    },
    line(hook, load, colours.metal, 0.8),
    {
      tag: SHAPE_TAG.RECT,
      attributes: {
        x: round(load[0] - 6),
        y: round(load[1]),
        width: 12,
        height: 7,
        fill: colours.crate,
      },
    },
  );
  return shapes;
}

function scaffoldShapes(hollow: CampusSlot["hollow"], colours: CampusColours): CampusShape[] {
  const { x, y, w, d, h } = hollow;
  const corners: (readonly [number, number])[] = [
    [x - 0.1, y - 0.1],
    [x + w + 0.1, y - 0.1],
    [x + w + 0.1, y + d + 0.1],
    [x - 0.1, y + d + 0.1],
  ];
  const shapes = corners.map(([px, py]) =>
    line(campusProject(px, py, 0), campusProject(px, py, h + 0.6), colours.scaffold, 1.2),
  );
  for (const level of [0.5, 0.85]) {
    shapes.push(
      polygon(projected(corners.map(([px, py]) => [px, py, (h + 0.6) * level])), "none", {
        stroke: colours.scaffold,
        strokeWidth: 1,
      }),
    );
  }
  return shapes;
}

/** The colour a station's lamp is lit in, by its agent's state; none for one at rest. */
function stationLamp(agent: AgentView): string | null {
  switch (agent.state) {
    case AGENT_STATE.WORKING:
    case AGENT_STATE.WAITING:
      return SIGNAL_COLOR.BUILDING;
    case AGENT_STATE.STUCK:
      return SIGNAL_COLOR.BUILDING;
    case AGENT_STATE.FAILED:
      return SIGNAL_COLOR.DEFECT;
    case AGENT_STATE.IDLE:
      return null;
  }
}

/** A container's steel box, its corrugations, and its diff painted along the side the viewer sees. */
function containerBody(
  at: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
    readonly d: number;
    readonly h: number;
  },
  lines: { readonly additions: number; readonly deletions: number },
  merged: boolean,
  drawing: CampusDrawing,
): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const box: CampusBox = {
    x: at.x - at.w / 2,
    y: at.y - at.d / 2,
    w: at.w,
    d: at.d,
    z: at.z,
    h: at.h,
  };
  const shapes = boxShapes(box, merged ? colours.mergedContainer : colours.openContainer, drawing);
  const alongX = at.w >= at.d;
  const length = alongX ? at.w : at.d;
  const side = (u0: number, u1: number, low: number, high: number) =>
    alongX
      ? projected([
          [box.x + u0, box.y + box.d, low],
          [box.x + u1, box.y + box.d, low],
          [box.x + u1, box.y + box.d, high],
          [box.x + u0, box.y + box.d, high],
        ])
      : projected([
          [box.x + box.w, box.y + u0, low],
          [box.x + box.w, box.y + u1, low],
          [box.x + box.w, box.y + u1, high],
          [box.x + box.w, box.y + u0, high],
        ]);
  if (drawing.detail === CAMPUS_DETAIL.NEAR) {
    for (let u = 0.09; u < length - 0.04; u += 0.11) {
      const from = alongX
        ? campusProject(box.x + u, box.y + box.d, at.z + 0.04)
        : campusProject(box.x + box.w, box.y + u, at.z + 0.04);
      const to = alongX
        ? campusProject(box.x + u, box.y + box.d, at.z + at.h - 0.04)
        : campusProject(box.x + box.w, box.y + u, at.z + at.h - 0.04);
      shapes.push(line(from, to, colours.corrugation, 0.7));
    }
  }
  const total = lines.additions + lines.deletions;
  const share = total === 0 ? 1 : lines.additions / total;
  const low = at.z + at.h * 0.36;
  const high = at.z + at.h * 0.56;
  if (share > 0)
    shapes.push(
      polygon(side(0, length * share, low, high), SIGNAL_COLOR.SHIPPED, { opacity: 0.95 }),
    );
  if (share < 1)
    shapes.push(
      polygon(side(length * share, length, low, high), SIGNAL_COLOR.DEFECT, { opacity: 0.95 }),
    );
  return shapes;
}

/** A container where it stands. */
export function containerShapesOf(placed: PlacedContainer, drawing: CampusDrawing): CampusShape[] {
  return containerBody(
    placed,
    placed.container,
    placed.container.place === CONTAINER_PLACE.LOT,
    drawing,
  );
}

/** A container's outline, for a selection to edge. */
export function containerOutlineOf(placed: PlacedContainer): string {
  const x0 = placed.x - placed.w / 2;
  const y0 = placed.y - placed.d / 2;
  const x1 = x0 + placed.w;
  const y1 = y0 + placed.d;
  const z0 = placed.z;
  const z1 = z0 + placed.h;
  return pointsOf(
    hull(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ].map(([x = 0, y = 0, z = 0]) => campusProject(x, y, z)),
    ),
  );
}

/**
 * An open building's inside, its roof off: its floor and back walls, an
 * assembly line through the hall with a station per agent, lit in its
 * agent's state and its belt moving while that agent works, the task's open
 * pull requests packed at the line's end, and the cut walls in front.
 */
export function insideShapesOf(
  task: CampusTask,
  slot: CampusSlot,
  drawing: CampusDrawing,
): InsideShapes {
  const colours = campusColoursOf(drawing.dark);
  const hall = slot.hollow;
  const { x: x0, y: y0 } = hall;
  const x1 = hall.x + hall.w;
  const y1 = hall.y + hall.d;
  const material = materialColour(hall.material, colours);
  const back = [
    polygon(
      projected([
        [x0, y0, 0.03],
        [x1, y0, 0.03],
        [x1, y1, 0.03],
        [x0, y1, 0.03],
      ]),
      colours.floor,
    ),
    polygon(
      projected([
        [x0, y0, 0],
        [x0, y1, 0],
        [x0, y1, hall.h],
        [x0, y0, hall.h],
      ]),
      shade(material, FACE_X, drawing.dark),
    ),
    polygon(
      projected([
        [x0, y0, 0],
        [x1, y0, 0],
        [x1, y0, hall.h],
        [x0, y0, hall.h],
      ]),
      shade(material, FACE_Y, drawing.dark),
    ),
  ];
  const alongX = hall.w >= hall.d;
  const length = (alongX ? hall.w : hall.d) - 0.5;
  const start = (alongX ? hall.x : hall.y) + 0.25;
  const middle = alongX ? hall.y + hall.d / 2 : hall.x + hall.w / 2;
  const at = (u: number, v: number): readonly [number, number] =>
    alongX ? [start + u, middle + v] : [middle + v, start + u];
  const packLength = Math.min(0.9, length * 0.25);
  const step = (length - packLength) / Math.max(1, task.agents.length);
  const items: { depth: number; agentId: string | null; shapes: CampusShape[] }[] = [];
  task.agents.forEach((agent, index) => {
    const u0 = index * step;
    const u1 = (index + 1) * step;
    const working = agent.state === AGENT_STATE.WORKING;
    const [bx, by] = at(u0, -0.16);
    const belt: CampusBox = alongX
      ? { x: bx, y: by, w: u1 - u0, d: 0.32, z: 0, h: 0.2 }
      : { x: middle - 0.16, y: start + u0, w: 0.32, d: u1 - u0, z: 0, h: 0.2 };
    const beltShapes = boxShapes(belt, colours.belt, drawing);
    const [ax, ay] = at(u0 + 0.05, 0);
    const [cx, cy] = at(u1 - 0.05, 0);
    beltShapes.push({
      ...line(campusProject(ax, ay, 0.21), campusProject(cx, cy, 0.21), colours.beltMark, 3, {
        strokeDasharray: "3 3",
      }),
      mark: working ? SHAPE_MARK.BELT : undefined,
    });
    if (working) {
      const [px, py] = at((u0 + u1) / 2, 0);
      beltShapes.push(
        ...boxShapes(
          { x: px - 0.12, y: py - 0.12, w: 0.24, d: 0.24, z: 0.2, h: 0.18 },
          colours.crate,
          drawing,
        ),
      );
    }
    items.push({
      depth: campusDepthOf(belt.x + belt.w / 2, belt.y + belt.d / 2) - 0.2,
      agentId: null,
      shapes: beltShapes,
    });
    const side = index % 2 === 0 ? -1 : 1;
    const [mx, my] = at((u0 + u1) / 2, side * 0.55);
    const station = boxShapes(
      { x: mx - 0.2, y: my - 0.2, w: 0.4, d: 0.4, z: 0, h: 0.5 },
      agent.state === AGENT_STATE.FAILED ? colours.brick : colours.metal,
      drawing,
    );
    const [lx, ly] = campusProject(mx, my, 0.62);
    station.push(line(campusProject(mx, my, 0.5), [lx, ly], colours.metal, 1.4));
    const lamp = stationLamp(agent);
    station.push({
      tag: SHAPE_TAG.CIRCLE,
      attributes: { cx: round(lx), cy: round(ly), r: 3.4, fill: lamp ?? colours.unlit },
      mark: working ? SHAPE_MARK.PULSE : lamp === null ? undefined : SHAPE_MARK.GLOW,
    });
    const [rx, ry] = at((u0 + u1) / 2, side * 0.18);
    station.push(
      line(campusProject(mx, my, 0.45), campusProject(rx, ry, 0.4), SIGNAL_COLOR.BUILDING, 2.2, {
        strokeLinecap: "round",
      }),
    );
    items.push({ depth: campusDepthOf(mx, my), agentId: agent.id, shapes: station });
  });
  const open = task.agents.flatMap((agent) =>
    agent.agent.pullRequest !== null && agent.agent.pullRequest.state === PULL_REQUEST_STATE.OPEN
      ? [agent.agent.pullRequest]
      : [],
  );
  const [ex, ey] = at(length - packLength / 2, 0);
  const pack = boxShapes(
    { x: ex - 0.35, y: ey - 0.35, w: 0.7, d: 0.7, z: 0, h: 0.06 },
    colours.crate,
    drawing,
  );
  open.slice(0, 3).forEach((pullRequest, k) => {
    const long = Math.min(
      0.6,
      Math.max(0.25, (pullRequest.additions + pullRequest.deletions) / 400),
    );
    pack.push(
      ...containerBody(
        {
          x: ex,
          y: ey,
          z: 0.06 + k * 0.22,
          w: alongX ? 0.3 : long,
          d: alongX ? long : 0.3,
          h: 0.22,
        },
        pullRequest,
        false,
        drawing,
      ),
    );
  });
  items.push({ depth: campusDepthOf(ex, ey), agentId: null, shapes: pack });
  items.sort((left, right) => left.depth - right.depth);
  const cut = 0.28;
  const front = [
    polygon(
      projected([
        [x1, y0, 0],
        [x1, y1, 0],
        [x1, y1, cut],
        [x1, y0, cut],
      ]),
      shade(material, FACE_X, drawing.dark),
    ),
    polygon(
      projected([
        [x0, y1, 0],
        [x1, y1, 0],
        [x1, y1, cut],
        [x0, y1, cut],
      ]),
      shade(material, FACE_Y, drawing.dark),
    ),
    {
      tag: SHAPE_TAG.POLYLINE,
      attributes: {
        points: projected([
          [x1, y0, cut],
          [x1, y1, cut],
          [x0, y1, cut],
        ]),
        fill: "none",
        stroke: colours.cut,
        strokeWidth: 1.2,
      },
    },
  ] satisfies CampusShape[];
  return { back, stations: items.map(({ agentId, shapes }) => ({ agentId, shapes })), front };
}

/**
 * A building, piece by piece, in the order it is drawn: what stands on its
 * own behind it, its parts by height then depth (its inside's place held
 * just before its walls), its crane among them, its scaffold, what stands on
 * its own in front, and its roof's signs. `smokes` is whether its stack
 * smokes, which a busy campus rations (`smokeRationOf`).
 */
export function buildingPiecesOf(
  task: CampusTask,
  slot: CampusSlot,
  drawing: CampusDrawing,
  smokes: boolean,
): BuildingPiece[] {
  const colours = campusColoursOf(drawing.dark);
  const lit = litOf(task.signal, drawing);
  const hall = slot.hollow;
  const middle = campusDepthOf(hall.x + hall.w / 2, hall.y + hall.d / 2);
  const parts = slot.parts.map((part) => {
    if ("box" in part) {
      return {
        z: part.box.z,
        depth: campusDepthOf(part.box.x + part.box.w / 2, part.box.y + part.box.d / 2),
        piece: ROLE_PIECE[part.role],
        beside: false,
        shapes: boxShapes(part.box, materialColour(part.material, colours), drawing, {
          windows: part.windows,
          lit,
          stripe: part.stripe === true,
        }),
      };
    }
    return {
      z: part.cylinder.z,
      depth: campusDepthOf(part.cylinder.x, part.cylinder.y),
      piece: ROLE_PIECE[part.role],
      beside: part.beside === true,
      shapes: cylinderShapes(part.cylinder, part.material, part.bands, drawing),
    };
  });
  const beside = parts.filter((part) => part.beside);
  const pieces: BuildingPiece[] = beside
    .filter((part) => part.depth < middle)
    .map((part) => ({ kind: PIECE.BESIDE, shapes: part.shapes }));
  const crane = task.underway && slot.crane !== null ? slot.crane : null;
  const standing = [
    ...parts.filter((part) => !part.beside),
    ...(crane === null
      ? []
      : [
          {
            z: 0,
            depth: campusDepthOf(crane.x, crane.y),
            piece: PIECE.CRANE,
            beside: false,
            shapes: [],
          },
        ]),
  ].sort((left, right) => left.z - right.z || left.depth - right.depth);
  let inside = false;
  for (const part of standing) {
    if (part.piece === PIECE.SHELL && !inside) {
      pieces.push({ kind: PIECE.INSIDE, shapes: [] });
      inside = true;
    }
    pieces.push(
      part.piece === PIECE.CRANE
        ? { kind: PIECE.CRANE, shapes: [], layer: CAMPUS_LAYER.BUILDING }
        : { kind: part.piece, shapes: part.shapes },
    );
  }
  if (task.underway)
    pieces.push({
      kind: PIECE.SCAFFOLD,
      shapes: scaffoldShapes(hall, colours),
      layer: CAMPUS_LAYER.BUILDING,
    });
  pieces.push(
    ...beside
      .filter((part) => part.depth >= middle)
      .map((part) => ({ kind: PIECE.BESIDE, shapes: part.shapes })),
  );
  pieces.push(...signShapes(task, slot, drawing, smokes));
  return pieces;
}

/** Which tasks' buildings smoke: those at work and standing, the first `SMOKE_MAX` of them, and none far out. */
export function smokeRationOf(
  tasks: readonly CampusTask[],
  plots: ReadonlyMap<string, CampusSlot>,
  detail: CampusDetail,
): ReadonlySet<string> {
  if (detail === CAMPUS_DETAIL.FAR) return new Set();
  return new Set(
    tasks
      .filter((task) => task.working && plots.has(task.id))
      .slice(0, SMOKE_MAX)
      .map((task) => task.id),
  );
}

/** A planned issue: its plot pegged out and its building drawn in dashed blueprint lines. */
export function blueprintShapesOf(slot: CampusSlot, drawing: CampusDrawing): CampusShape[] {
  const colour = SIGNAL_COLOR.PLANNED;
  const { plot, hollow } = slot;
  const x0 = hollow.x;
  const y0 = hollow.y;
  const x1 = hollow.x + hollow.w;
  const y1 = hollow.y + hollow.d;
  const h = hollow.h;
  const dashed: ShapeAttributes = {
    stroke: colour,
    strokeWidth: 1.1,
    strokeDasharray: "4 3",
    strokeLinejoin: "round",
  };
  const face = (points: string) =>
    polygon(points, colour, { fillOpacity: drawing.dark ? 0.1 : 0.08, ...dashed });
  return [
    flat(plot, "transparent", 0.03, {
      stroke: colour,
      strokeOpacity: 0.55,
      strokeWidth: 1,
      strokeDasharray: "2 4",
    }),
    {
      tag: SHAPE_TAG.POLYLINE,
      attributes: {
        points: projected([
          [x0, y1, 0],
          [x0, y0, 0],
          [x1, y0, 0],
        ]),
        fill: "none",
        ...dashed,
        opacity: 0.45,
      },
    },
    line(campusProject(x0, y0, 0), campusProject(x0, y0, h), colour, 1.1, {
      strokeDasharray: "4 3",
      opacity: 0.45,
    }),
    face(
      projected([
        [x1, y0, 0],
        [x1, y1, 0],
        [x1, y1, h],
        [x1, y0, h],
      ]),
    ),
    face(
      projected([
        [x0, y1, 0],
        [x1, y1, 0],
        [x1, y1, h],
        [x0, y1, h],
      ]),
    ),
    face(
      projected([
        [x0, y0, h],
        [x1, y0, h],
        [x1, y1, h],
        [x0, y1, h],
      ]),
    ),
  ];
}

/** A tree. */
export function treeShapesOf(x: number, y: number, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const [bx, by] = campusProject(x, y, 0);
  const [tx, ty] = campusProject(x, y, 1.25);
  const r = 0.34 * TILE.X * Math.SQRT2;
  return [
    line([bx, by], [bx, by - 10], colours.trunk, 2.4, { strokeLinecap: "round" }),
    {
      tag: SHAPE_TAG.PATH,
      attributes: {
        d: `M${round(tx)},${round(ty)} L${round(bx - r)},${round(by - 7)} Q${round(bx)},${round(by - 2)} ${round(bx)},${round(by - 2)} Z`,
        fill: colours.tree,
      },
    },
    {
      tag: SHAPE_TAG.PATH,
      attributes: {
        d: `M${round(tx)},${round(ty)} L${round(bx + r)},${round(by - 7)} Q${round(bx)},${round(by - 2)} ${round(bx)},${round(by - 2)} Z`,
        fill: colours.treeLit,
      },
    },
  ];
}

/** A street lamp, and its pool of light at night. */
export function lampShapesOf(x: number, y: number, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const [bx, by] = campusProject(x, y, 0);
  const [, ty] = campusProject(x, y, 1.1);
  const shapes: CampusShape[] = [];
  if (drawing.dark && drawing.detail === CAMPUS_DETAIL.NEAR) {
    shapes.push({
      tag: SHAPE_TAG.ELLIPSE,
      attributes: {
        cx: round(bx),
        cy: round(by),
        rx: round(1.3 * TILE.X),
        ry: round(1.3 * TILE.Y),
      },
      gradient: CAMPUS_GRADIENT.POOL,
    });
  }
  shapes.push(line([bx, by], [bx, ty], colours.metal, 1.4), {
    tag: SHAPE_TAG.CIRCLE,
    attributes: {
      cx: round(bx),
      cy: round(ty),
      r: 2.4,
      fill: drawing.dark ? colours.lamp : colours.metal,
    },
    mark: drawing.dark ? SHAPE_MARK.GLOW : undefined,
  });
  return shapes;
}

const LANE_COLOUR = {
  [GATE_LANE.FAILING]: SIGNAL_COLOR.DEFECT,
  [GATE_LANE.RUNNING]: SIGNAL_COLOR.BUILDING,
  [GATE_LANE.READY]: SIGNAL_COLOR.SHIPPED,
} as const satisfies Record<GateLane, string>;

/** A lane's lamp at its head, lit in its checks' colour while anything waits in it. */
export function laneLampShapesOf(
  lane: GateLane,
  occupied: boolean,
  drawing: CampusDrawing,
): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const y = (LANES.find((each) => each.lane === lane)?.y ?? YARD.y) + LANE_DEPTH / 2;
  const foot = campusProject(YARD.x + 0.35, y, 0);
  const [px, py] = campusProject(YARD.x + 0.35, y, 0.85);
  return [
    line(foot, [px, py], colours.metal, 1.6),
    {
      tag: SHAPE_TAG.CIRCLE,
      attributes: {
        cx: round(px),
        cy: round(py),
        r: 3.6,
        fill: occupied ? LANE_COLOUR[lane] : colours.unlit,
      },
      mark: occupied
        ? lane === GATE_LANE.RUNNING
          ? SHAPE_MARK.PULSE
          : SHAPE_MARK.GLOW
        : undefined,
    },
  ];
}

/** The gatehouse and its barrier, lowered: merging happens on GitHub, not here. */
export function gateShapesOf(drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const lamp: Lit | null = drawing.dark
    ? { colour: colours.lamp, ratio: 1, opacity: 0.6, layer: null }
    : null;
  const shapes = boxShapes({ ...GATEHOUSE, z: 0, h: 1 }, colours.wall, drawing, {
    windows: { rows: 1, per: 1.4, seed: 4 },
    lit: lamp,
  });
  shapes.push(
    ...boxShapes(
      {
        x: GATEHOUSE.x - 0.08,
        y: GATEHOUSE.y - 0.08,
        w: GATEHOUSE.w + 0.16,
        d: GATEHOUSE.d + 0.16,
        z: 1,
        h: 0.1,
      },
      colours.roof,
      drawing,
    ),
  );
  const hinge = campusProject(BARRIER.x, BARRIER.y, 0.62);
  const end = campusProject(BARRIER.x, BARRIER.y + BARRIER.d, 0.62);
  shapes.push(
    line(campusProject(BARRIER.x, BARRIER.y, 0), hinge, colours.metal, 2.2),
    line(hinge, end, colours.barrier, 3, { strokeLinecap: "round" }),
    line(hinge, end, SIGNAL_COLOR.DEFECT, 3, { strokeDasharray: "6 6" }),
  );
  return shapes;
}

/** The shipped lot's flag. */
export function lotFlagShapesOf(lot: CampusRect, drawing: CampusDrawing): CampusShape[] {
  const colours = campusColoursOf(drawing.dark);
  const [px, py] = campusProject(lot.x + lot.w - 0.4, lot.y + 0.4, 0);
  return [
    line([px, py], [px, py - 46], colours.metal, 1.6),
    {
      tag: SHAPE_TAG.PATH,
      attributes: {
        d: `M${round(px)},${round(py - 46)} l20,4 l-20,7 Z`,
        fill: SIGNAL_COLOR.SHIPPED,
      },
      mark: SHAPE_MARK.FLAG,
    },
  ];
}

/**
 * The blast radius on the districts: each district the selection's work
 * ripples to, outlined in the blast colour and fainter with each step, and
 * a belt to it from the nearest district it touched. A zone with no
 * district of its own is not drawn.
 */
export function blastShapesOf(plan: CampusPlan, blast: ReadonlyMap<string, number>): CampusShape[] {
  const colour = SIGNAL_COLOR.BLAST_RADIUS;
  const byPath = new Map(plan.districts.map((district) => [district.path, district]));
  const home = [...blast].find(([path, distance]) => distance === 0 && byPath.has(path));
  const from = home === undefined ? undefined : byPath.get(home[0]);
  const shapes: CampusShape[] = [];
  for (const [path, distance] of blast) {
    const district = byPath.get(path);
    if (district === undefined) continue;
    const touched = distance === 0;
    shapes.push(
      flat(district, colour, 0.02, {
        fillOpacity: touched ? 0.16 : 0.1 / distance,
        stroke: colour,
        strokeWidth: touched ? 2.4 : 1.6,
        strokeOpacity: touched ? 1 : 0.85 / distance,
        strokeDasharray: touched ? undefined : "6 4",
      }),
    );
    if (!touched && from !== undefined) {
      shapes.push(
        line(
          campusProject(from.x + from.w / 2, from.y + from.d / 2, 0.05),
          campusProject(district.x + district.w / 2, district.y + district.d / 2, 0.05),
          colour,
          2,
          { strokeDasharray: "3 5", strokeOpacity: 0.8 / distance, strokeLinecap: "round" },
        ),
      );
    }
  }
  return shapes;
}

/** A dashed route along the avenues from a task's plot to each of its containers. */
export function routePointsOf(
  slot: CampusSlot,
  placed: readonly PlacedContainer[],
  lot: CampusRect,
): string[] {
  const door = [slot.plot.x + slot.plot.w / 2, slot.plot.y + slot.plot.d / 2] as const;
  const middle = AVENUE.x + AVENUE.wide / 2;
  return placed.map((each) =>
    projected(
      [
        [door[0], door[1]],
        [middle, door[1]],
        [middle, middle],
        [each.container.place === CONTAINER_PLACE.GATE ? YARD.x + 1 : lot.x, middle],
        [each.x, each.y],
      ].map(([x = 0, y = 0]) => [x, y, 0.04] as const),
    ),
  );
}

/** Where a name hangs over a building: above its roof, higher for a sign or a crane. */
export function nameAnchorOf(task: CampusTask, slot: CampusSlot): readonly [number, number] {
  const lift =
    task.shipped && !task.working ? 1.5 : task.signal === CAMPUS_SIGNAL.STUCK ? 1.1 : 0.35;
  return campusProject(slot.roof.x, slot.roof.y, slot.roof.z + lift + (task.underway ? 1.4 : 0));
}

/** Where a district's name is painted: on the street below its nearest corner. */
export function districtAnchorOf(district: CampusDistrict): readonly [number, number] {
  return campusProject(district.x + district.w, district.y + district.d, 0);
}

/** Where the gate's name and the lot's hang. */
export function yardAnchorsOf(lot: CampusRect): YardAnchors {
  return {
    gate: campusProject(GATEHOUSE.x + GATEHOUSE.w / 2, GATEHOUSE.y + GATEHOUSE.d / 2, 1.5),
    lot: campusProject(lot.x + lot.w / 2, lot.y + lot.d, -0.2),
  };
}

/** The campus's extent on screen at a scale of one, with room above for its tallest building and below for its slab. */
export function campusBoundsOf(plan: CampusPlan): ScreenBounds {
  const corners = [
    campusProject(0, 0, 0),
    campusProject(CAMPUS_GRID, 0, 0),
    campusProject(plan.width, CAMPUS_GRID, 0),
    campusProject(plan.width, plan.depth, 0),
    campusProject(0, plan.depth, 0),
    campusProject(plan.lot.x + plan.lot.w, plan.lot.y, 0),
    campusProject(plan.lot.x + plan.lot.w, plan.lot.y + plan.lot.d, 0),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys) - 4.4 * TILE.Z,
    y1: Math.max(...ys) + 1.5 * TILE.Z,
  };
}

/** What stands on the campus. */
export const CAMPUS_OBJECT = {
  BUILDING: "building",
  CONTAINER: "container",
  BLUEPRINT: "blueprint",
  TREE: "tree",
  LAMP: "lamp",
  LANE: "lane",
  GATE: "gate",
  FLAG: "flag",
} as const;

/** One thing standing on the campus, at the point it is culled by. */
export type CampusObject =
  | {
      readonly kind: typeof CAMPUS_OBJECT.BUILDING;
      readonly task: CampusTask;
      readonly slot: CampusSlot;
      readonly at: CampusPoint;
    }
  | {
      readonly kind: typeof CAMPUS_OBJECT.CONTAINER;
      readonly placed: PlacedContainer;
      readonly at: CampusPoint;
    }
  | {
      readonly kind: typeof CAMPUS_OBJECT.BLUEPRINT;
      readonly issue: FactoryPlanned;
      readonly slot: CampusSlot;
      readonly at: CampusPoint;
    }
  | {
      readonly kind: typeof CAMPUS_OBJECT.TREE | typeof CAMPUS_OBJECT.LAMP;
      readonly at: CampusPoint;
    }
  | {
      readonly kind: typeof CAMPUS_OBJECT.LANE;
      readonly lane: GateLane;
      readonly occupied: boolean;
      readonly at: CampusPoint;
    }
  | {
      readonly kind: typeof CAMPUS_OBJECT.GATE | typeof CAMPUS_OBJECT.FLAG;
      readonly at: CampusPoint;
    };

/** Everything standing on the campus, sorted so that what stands nearer is drawn later. */
export function campusObjectsOf(
  plan: CampusPlan,
  tasks: readonly CampusTask[],
  planned: readonly FactoryPlanned[],
): CampusObject[] {
  const middleOf = (rect: CampusRect): CampusPoint => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.d / 2,
    z: 0,
  });
  const objects: CampusObject[] = [];
  for (const task of tasks) {
    const slot = plan.plots.get(task.id);
    if (slot !== undefined)
      objects.push({ kind: CAMPUS_OBJECT.BUILDING, task, slot, at: middleOf(slot.plot) });
  }
  for (const issue of planned) {
    const slot = plan.blueprints.get(issue.identifier);
    if (slot !== undefined)
      objects.push({ kind: CAMPUS_OBJECT.BLUEPRINT, issue, slot, at: middleOf(slot.plot) });
  }
  for (const placed of plan.containers)
    objects.push({
      kind: CAMPUS_OBJECT.CONTAINER,
      placed,
      at: { x: placed.x, y: placed.y, z: placed.z },
    });
  for (const [x, y] of plan.trees) objects.push({ kind: CAMPUS_OBJECT.TREE, at: { x, y, z: 0 } });
  for (const [x, y] of plan.lamps) objects.push({ kind: CAMPUS_OBJECT.LAMP, at: { x, y, z: 0 } });
  const occupied = new Set(
    plan.containers.flatMap((placed) =>
      placed.container.lane === null ? [] : [placed.container.lane],
    ),
  );
  for (const { lane, y } of LANES)
    objects.push({
      kind: CAMPUS_OBJECT.LANE,
      lane,
      occupied: occupied.has(lane),
      at: { x: YARD.x + 0.35, y: y + LANE_DEPTH / 2, z: 0 },
    });
  objects.push({
    kind: CAMPUS_OBJECT.GATE,
    at: { x: GATEHOUSE.x + 0.4, y: GATEHOUSE.y + 0.4, z: 0 },
  });
  objects.push({
    kind: CAMPUS_OBJECT.FLAG,
    at: { x: plan.lot.x + plan.lot.w - 0.4, y: plan.lot.y + 0.4, z: 0 },
  });
  // Note that a stacked container is drawn after the one under it, so its weight in depth is half its height.
  const depth = (object: CampusObject) =>
    campusDepthOf(object.at.x, object.at.y) + object.at.z * 0.5;
  return objects.sort((left, right) => depth(left) - depth(right));
}

/** How far, on screen at a scale of one, the largest building or a stack of containers reaches from the point it is culled by. */
const CULL_REACH = 180;

/**
 * Whether a thing standing at `point` may show in `window`, a rectangle on
 * screen at a scale of one; anything does where nothing is culled. Note that
 * a thing is culled by one point, its middle, so the window is widened by
 * the most anything reaches from its own: a building whose middle has passed
 * the edge while its walls still cross it is drawn.
 */
export function campusSeen(window: ScreenBounds | null, point: CampusPoint): boolean {
  if (window === null) return true;
  const [x, y] = campusProject(point.x, point.y, point.z);
  return (
    x > window.x0 - CULL_REACH &&
    x < window.x1 + CULL_REACH &&
    y > window.y0 - CULL_REACH &&
    y < window.y1 + CULL_REACH
  );
}
