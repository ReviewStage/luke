import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LatheGeometry,
  Matrix3,
  type Matrix4,
  Vector2,
  Vector3,
} from "three";
import {
  Builder,
  hashOf,
  jitter,
  type Pen,
  pickOf,
  placing,
  put,
  seeded,
  shade,
  shapeOf,
  TAU,
  turned,
  UNIT,
} from "./kit";
import { BOARD, DISTRICT_STYLE, type District, type Layout } from "./layout";

/**
 * town.ts -- every district's buildings: its landmark, and the houses, shops, blocks, sheds and tanks that fill the rest of its plot, welded into one mesh with their windows in another.
 *
 * A district's plot is cut into a grid of cells. Its landmark takes the
 * ground it needs first; each free cell then grows the building its style
 * fills with, seeded by the zone's path, so a district always grows the same
 * street. The town is built once per board (`layout.ts`'s `sameBoard`), never
 * per update.
 *
 * Each part carries the cell it stands on (`aCell`), and a small texture the
 * world rewrites on each update holds, per cell, whether it stands and how
 * many of its windows are lit (`cellTexture`). That is how a construction
 * site, a shipped house, or a burnt-out shell takes a cell over, and how a
 * zone alive with merges lights up, without the town being rebuilt. A
 * district's landmark stands on its district's own cell, which is never
 * cleared.
 *
 * The streets keep to quiet creams, stones and pastels, so the signal colours
 * stay the signals'.
 */

const STONE = new Color("#d9cfbd");
const BRICK = new Color("#a4513a");
const SLATE = new Color("#55606e");
const DARK = new Color("#2a2724");
const STEEL = new Color("#8b9096");
const WOOD = new Color("#8a5a35");
const GLASS = new Color("#9fc4d6");
const WHITE = new Color("#f6f3ec");

const SHOP_WALLS = [
  "#efe7d8",
  "#dcd6ca",
  "#c9d4d8",
  "#cfe1d4",
  "#e4dae6",
  "#d9cdbb",
  "#c3cbd3",
  "#e9e3d2",
  "#d6dccf",
  "#e2d6cf",
] as const;
const AWNINGS = ["#4e6b62", "#6a5a7a", "#5d6670", "#7a6a58", "#3f5f6a", "#6b7a5a"] as const;
const ROOFS = ["#5d6670", "#6c5a4d", "#4e6b62", "#7d7f86", "#5a5560"] as const;

/** One storey's height. */
const FLOOR = 0.78;

/** How many cells' state the cell texture holds a row of. */
export const CELL_ROW = 256;

/** One free cell of a district's plot, where a building grows and a site or a shipped house may take over. */
export interface Cell {
  readonly id: number;
  readonly district: District;
  /** Its centre on the board, and its width. */
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

/** Ground a landmark keeps clear, in the district's own frame. */
type Reserve =
  | { readonly x: number; readonly z: number; readonly r: number }
  | { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number };

/** A point smoke rises from, and what kind. */
interface Emitter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: "smoke" | "steam";
  readonly scale: number;
}

/** A clock face, for its hands. */
interface ClockFace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ry: number;
  readonly r: number;
}

/** A light that blinks on a mast or a tower. */
interface Beacon {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly phase: number;
  readonly white: boolean;
}

/** A windmill's hub, which way it faces, and its height. */
interface Windmill {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly face: number;
}

export interface Tree {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly scale: number;
  readonly pine: boolean;
  readonly turn: number;
}

/** What the town's builders set out beside the buildings: what smokes, ticks, blinks, turns, and grows. */
interface Furniture {
  readonly emitters: Emitter[];
  readonly clocks: ClockFace[];
  readonly beacons: Beacon[];
  readonly windmills: Windmill[];
  readonly trees: Tree[];
  /** Short sidings of the yards, as their two ends. */
  readonly sidings: (readonly [Vector3, Vector3])[];
  /** Street lamps around each district: where, and how tall. */
  readonly lamps: { readonly x: number; readonly z: number; readonly h: number }[];
}

/** Everything the town built: its meshes' geometry, its cells, and its furniture. */
export interface Town extends Furniture {
  readonly buildings: BufferGeometry;
  readonly windows: BufferGeometry;
  readonly cells: readonly Cell[];
  /** How many cell ids are in use: one per district for its landmark, then one per free cell. */
  readonly cellCount: number;
}

const UP = new Vector3(0, 1, 0);
const NORMAL = new Vector3();
const CORNER = new Vector3();

/** The quads every lit window is, each with its cell and the share of its zone's glow it lights at. */
class Windows {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly cells: number[] = [];
  private readonly lights: number[] = [];

  private quad(
    matrix: Matrix4,
    normalMatrix: Matrix3,
    centre: Vector3,
    tangent: Vector3,
    cell: number,
    lit: number,
  ): void {
    const up = UP;
    const normal = NORMAL.copy(tangent).cross(up).negate().applyMatrix3(normalMatrix).normalize();
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const corner = CORNER.copy(centre)
        .addScaledVector(tangent, (a * 0.21) / 2)
        .addScaledVector(up, (b * 0.29) / 2)
        .applyMatrix4(matrix);
      this.positions.push(corner.x, corner.y, corner.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.cells.push(cell);
      this.lights.push(lit);
    }
  }

  /** Rows of windows round a `w` by `d` box `h` tall, from `y0` up, a storey `floor` apart and `step` along. */
  box(
    matrix: Matrix4,
    w: number,
    d: number,
    h: number,
    y0: number,
    cell: number,
    rnd: () => number,
    floor = FLOOR,
    step = 0.56,
  ): void {
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    const floors = Math.max(1, Math.floor((h - y0 - 0.12) / floor));
    for (const [nx, nz, width, offset] of [
      [0, 1, w, d / 2],
      [0, -1, w, d / 2],
      [1, 0, d, w / 2],
      [-1, 0, d, w / 2],
    ] as const) {
      const columns = Math.floor(width / step);
      if (columns < 1) continue;
      const spacing = width / columns;
      const tangent = new Vector3(nz, 0, -nx);
      for (let storey = 0; storey < floors; storey += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (rnd() < 0.08) continue;
          const along = -width / 2 + spacing * (column + 0.5);
          const centre = new Vector3(
            nx * (offset + 0.012),
            y0 + floor * (storey + 0.52),
            nz * (offset + 0.012),
          ).addScaledVector(tangent, along);
          this.quad(matrix, normalMatrix, centre, tangent, cell, rnd());
        }
      }
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(Float32Array.from(this.positions), 3));
    geometry.setAttribute("normal", new BufferAttribute(Float32Array.from(this.normals), 3));
    geometry.setAttribute("aCell", new BufferAttribute(Float32Array.from(this.cells), 1));
    geometry.setAttribute("aLit", new BufferAttribute(Float32Array.from(this.lights), 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** What one district's builders write into while it is built. */
interface Street {
  readonly pen: Pen;
  readonly windows: Windows;
  readonly district: District;
  readonly rnd: () => number;
  readonly out: Furniture;
}

/** A point in the district's frame, on the board. */
function onBoard(district: District, x: number, z: number, y = 0): Vector3 {
  const [wx, wz] = turned(district.x, district.z, district.rot, x, z);
  return new Vector3(wx, y, wz);
}

function windowsOn(
  street: Street,
  x: number,
  z: number,
  ry: number,
  w: number,
  d: number,
  h: number,
  y0: number,
  floor?: number,
  step?: number,
): void {
  const matrix = placing(x, 0, z, ry).premultiply(street.district.frame);
  street.windows.box(matrix, w, d, h, y0, street.pen.extra[0] ?? 0, street.rnd, floor, step);
}

// ---------- generic buildings, in the district's frame

function house(
  street: Street,
  x: number,
  z: number,
  ry: number,
  w: number,
  d: number,
  floors: number,
  wall: Color,
  roof: Color,
): void {
  const { pen, rnd } = street;
  const h = floors * FLOOR;
  put(pen, UNIT.box, wall, x, 0, z, ry, w, h, d);
  put(pen, UNIT.gable, roof, x, h, z, ry, w * 1.1, Math.min(w, d) * 0.6, d * 1.08);
  if (rnd() < 0.6) {
    const [cx, cz] = turned(x, z, ry, w * 0.25, d * 0.2);
    put(pen, UNIT.box, BRICK, cx, h, cz, ry, 0.18, Math.min(w, d) * 0.55, 0.18);
  }
  windowsOn(street, x, z, ry, w, d, h, 0);
}

function shop(
  street: Street,
  x: number,
  z: number,
  ry: number,
  w: number,
  d: number,
  floors: number,
  wall: Color,
  awning: Color,
): void {
  const { pen, rnd } = street;
  const h = floors * FLOOR + 0.15;
  put(pen, UNIT.box, wall, x, 0, z, ry, w, h, d);
  put(pen, UNIT.box, shade(wall, -0.12), x, h, z, ry, w + 0.08, 0.12, d + 0.08);
  for (const side of [1, -1]) {
    const [ax, az] = turned(x, z, ry, 0, side * (d / 2 + 0.22));
    put(pen, UNIT.box, awning, ax, 0.62, az, ry, w * 0.86, 0.05, 0.44, side * 0.32);
    const [sx, sz] = turned(x, z, ry, 0, side * (d / 2 + 0.02));
    put(pen, UNIT.box, new Color("#f1d9a8"), sx, 0.12, sz, ry, w * 0.7, 0.4, 0.04);
  }
  if (rnd() < 0.5) {
    const [px, pz] = turned(x, z, ry, w * 0.2, 0);
    put(pen, UNIT.box, STEEL, px, h + 0.12, pz, ry, 0.4, 0.25, 0.3);
  }
  windowsOn(street, x, z, ry, w, d, h, FLOOR * 0.9);
}

function block(
  street: Street,
  x: number,
  z: number,
  ry: number,
  w: number,
  d: number,
  floors: number,
  wall: Color,
): void {
  const { pen, rnd } = street;
  const h = floors * FLOOR + 0.2;
  put(pen, UNIT.box, wall, x, 0, z, ry, w, h, d);
  put(pen, UNIT.box, shade(wall, -0.15), x, h, z, ry, w + 0.1, 0.14, d + 0.1);
  put(pen, UNIT.box, shade(wall, -0.25), x, h, z, ry, w * 0.88, 0.04, d * 0.88);
  if (rnd() < 0.7) {
    const [px, pz] = turned(x, z, ry, (rnd() - 0.5) * w * 0.4, (rnd() - 0.5) * d * 0.4);
    put(pen, UNIT.box, STEEL, px, h + 0.1, pz, ry, 0.5, 0.35, 0.4);
  }
  if (rnd() < 0.35) {
    const [tx, tz] = turned(x, z, ry, -w * 0.22, d * 0.2);
    put(pen, UNIT.cyl8, WOOD, tx, h + 0.1, tz, 0, 0.45, 0.55, 0.45);
    put(pen, UNIT.cone, DARK, tx, h + 0.65, tz, 0, 0.5, 0.25, 0.5);
  }
  windowsOn(street, x, z, ry, w, d, h, 0.1);
}

function shed(
  street: Street,
  x: number,
  z: number,
  ry: number,
  w: number,
  d: number,
  wall: Color,
  roof: Color,
): void {
  const { pen, rnd } = street;
  const h = 1.1 + rnd() * 0.5;
  put(pen, UNIT.box, wall, x, 0, z, ry, w, h, d);
  const teeth = Math.max(1, Math.round(w));
  const toothWidth = w / teeth;
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const [tx, tz] = turned(x, z, ry, -w / 2 + toothWidth * (tooth + 0.5), 0);
    put(pen, UNIT.tooth, tooth % 2 ? roof : shade(roof, 0.05), tx, h, tz, ry, toothWidth, 0.55, d);
  }
  windowsOn(street, x, z, ry, w, d, h, 0.1, 0.9, 0.7);
}

function tank(street: Street, x: number, z: number, r: number, h: number, color: Color): void {
  const { pen } = street;
  put(pen, UNIT.cyl, color, x, 0, z, 0, r * 2, h, r * 2);
  put(pen, UNIT.hemi, shade(color, -0.05), x, h, z, 0, r * 2, r, r * 2);
  put(pen, UNIT.cyl8, DARK, x, 0, z, 0, r * 2.08, 0.1, r * 2.08);
}

function chimney(
  street: Street,
  x: number,
  z: number,
  r: number,
  h: number,
  color = BRICK,
  kind: Emitter["kind"] = "smoke",
): void {
  const { pen } = street;
  put(pen, UNIT.cyl, color, x, 0, z, 0, r * 2, h, r * 2);
  for (let band = 1; band <= 2; band += 1)
    put(pen, UNIT.cyl, WHITE, x, h - band * 0.55, z, 0, r * 2.06, 0.14, r * 2.06);
  put(pen, UNIT.cyl, DARK, x, h, z, 0, r * 2.15, 0.12, r * 2.15);
  const at = onBoard(street.district, x, z, h + 0.2);
  street.out.emitters.push({ x: at.x, y: at.y, z: at.z, kind, scale: r * 2.2 });
}

// ---------- landmarks, each answering the ground it keeps clear

function station(street: Street): Reserve[] {
  const { pen, district } = street;
  const ri = district.plotRadius;
  const length = ri * 1.25;
  const width = ri * 0.62;
  const z0 = -ri * 0.12;
  put(pen, UNIT.box, STONE, 0, 0, z0, 0, width, 1.5, length);
  put(pen, UNIT.halfCyl, GLASS, 0, 1.5, z0, Math.PI / 2, length, width * 0.86, width);
  for (let rib = 0; rib <= 8; rib += 1) {
    put(
      pen,
      UNIT.halfCyl,
      new Color("#5d5a55"),
      0,
      1.5,
      z0 - length / 2 + (length * rib) / 8,
      Math.PI / 2,
      0.12,
      width * 0.9,
      width + 0.06,
    );
  }
  const hz = z0 + length / 2 + 1.1;
  const hw = width * 1.45;
  put(pen, UNIT.box, new Color("#eadcc1"), 0, 0, hz, 0, hw, 3.2, 2.2);
  put(pen, UNIT.box, new Color("#c7b597"), 0, 3.2, hz, 0, hw + 0.2, 0.2, 2.4);
  windowsOn(street, 0, hz, 0, hw, 2.2, 3.2, 0.3, 0.9, 0.62);
  put(pen, UNIT.box, new Color("#eadcc1"), 0, 0, hz + 0.2, 0, 2.0, 7.2, 2.0);
  put(pen, UNIT.pyr, SLATE, 0, 7.2, hz + 0.2, 0, 2.2, 2.4, 2.2);
  put(pen, UNIT.cone, new Color("#d9c27a"), 0, 9.6, hz + 0.2, 0, 0.2, 0.9, 0.2);
  put(pen, UNIT.disc, WHITE, 0, 5.8, hz + 1.22, 0, 1.3, 1.3, 0.06);
  put(pen, UNIT.disc, new Color("#b8a06e"), 0, 5.8, hz + 1.2, 0, 1.45, 1.45, 0.04);
  for (const side of [-1, 1]) {
    put(pen, UNIT.box, new Color("#eadcc1"), side * (hw / 2 - 0.6), 0, hz, 0, 1.4, 4.4, 2.4);
    put(pen, UNIT.pyr, SLATE, side * (hw / 2 - 0.6), 4.4, hz, 0, 1.5, 1.2, 2.5);
  }
  const face = onBoard(district, 0, hz + 1.26, 5.8);
  street.out.clocks.push({ x: face.x, y: face.y, z: face.z, ry: district.rot, r: 0.55 });
  return [{ x: 0, z: z0 + 1, r: length / 2 + 2.6 }];
}

function yard(street: Street): Reserve[] {
  const { pen, district, rnd } = street;
  const ri = district.plotRadius;
  const frame = pen.frame;
  for (let k = -2; k <= 2; k += 1) {
    const offset = k * 1.3;
    const half = Math.sqrt(Math.max(0, ri * ri - offset * offset)) - 0.6;
    if (half < 2) continue;
    street.out.sidings.push([onBoard(district, -half, offset), onBoard(district, half, offset)]);
    for (let x = -half + 0.9; x < half - 1; x += 1.35) {
      if (rnd() >= 0.72) continue;
      const color = new Color(pickOf(["#e8e4da", "#c9cdd2", "#b3593a", "#3a6a8a"], rnd));
      pen.frame = placing(x + 0.6, BOARD.RAIL_Y, offset, 0).premultiply(frame);
      put(pen, UNIT.cbox, DARK, 0, 0.12, 0, 0, 1.18, 0.12, 0.5);
      put(pen, UNIT.cyl, color, 0, 0.44, 0, 0, 0.5, 1.05, 0.5, 0, Math.PI / 2);
      put(pen, UNIT.cyl8, shade(color, -0.1), 0, 0.68, 0, 0, 0.2, 0.12, 0.2);
    }
  }
  pen.frame = frame;
  return [{ x0: -ri, x1: ri, z0: -3.4, z1: 3.4 }];
}

function clockTower(street: Street): Reserve[] {
  const { pen, district } = street;
  const h = 11;
  put(pen, UNIT.box, new Color("#d8cdb8"), 0, 0, 0, 0, 2.4, h, 2.4);
  put(pen, UNIT.box, new Color("#bfb39c"), 0, h, 0, 0, 2.7, 0.3, 2.7);
  put(pen, UNIT.box, new Color("#d8cdb8"), 0, h + 0.3, 0, 0, 2.2, 1.6, 2.2);
  put(pen, UNIT.pyr, new Color("#3f6b5a"), 0, h + 1.9, 0, 0, 2.6, 3.4, 2.6);
  put(pen, UNIT.cone, new Color("#d9c27a"), 0, h + 5.2, 0, 0, 0.18, 1.0, 0.18);
  for (let side = 0; side < 4; side += 1) {
    const angle = (side * Math.PI) / 2;
    const [cx, cz] = turned(0, 0, angle, 0, 1.23);
    put(pen, UNIT.disc, WHITE, cx, h - 1.3, cz, angle, 1.6, 1.6, 0.05);
    const [fx, fz] = turned(0, 0, angle, 0, 1.27);
    const face = onBoard(district, fx, fz, h - 1.3);
    street.out.clocks.push({ x: face.x, y: face.y, z: face.z, ry: angle + district.rot, r: 0.65 });
  }
  windowsOn(street, 0, 0, 0, 2.4, 2.4, h - 2.5, 0.4, 1.1, 0.8);
  put(pen, UNIT.box, new Color("#e3cfae"), 0, 0, 3.0, 0, 6.0, 2.6, 2.6);
  put(pen, UNIT.gable, SLATE, 0, 2.6, 3.0, Math.PI / 2, 2.8, 1.3, 6.2);
  windowsOn(street, 0, 3.0, 0, 6.0, 2.6, 2.6, 0.2);
  return [{ x: 0, z: 1.2, r: 4.4 }];
}

function factory(street: Street): Reserve[] {
  shed(street, 0, -1.2, 0, 7.5, 4.2, new Color("#9a8476"), new Color("#6c6f74"));
  for (let stack = 0; stack < 3; stack += 1) {
    chimney(street, -2.5 + stack * 2.5, 2.4, 0.45, 7.5 + stack * 0.8, new Color("#8a7a70"));
  }
  return [{ x: 0, z: 0.4, r: 5.4 }];
}

function radio(street: Street): Reserve[] {
  const { pen, district, rnd } = street;
  const h = 6 + district.plotRadius * 0.9;
  for (let leg = 0; leg < 3; leg += 1) {
    const [lx, lz] = turned(0, 0, (leg * TAU) / 3, 0, 0.9);
    put(
      pen,
      UNIT.box,
      new Color("#c43c2f"),
      lx * 0.5,
      0,
      lz * 0.5,
      0,
      0.09,
      h,
      0.09,
      Math.atan2(-lz, h) * 0.12,
      0,
    );
  }
  for (let ring = 0; ring < 10; ring += 1) {
    const taper = 0.75 * (1 - ring / 14);
    put(
      pen,
      UNIT.cyl8,
      ring % 2 ? new Color("#eeeeee") : new Color("#c43c2f"),
      0,
      (h * ring) / 10,
      0,
      0,
      taper,
      h / 10,
      taper,
    );
  }
  put(pen, UNIT.sphere, new Color("#c43c2f"), 0, h + 0.1, 0, 0, 0.25, 0.25, 0.25);
  const top = onBoard(district, 0, 0, h + 0.15);
  street.out.beacons.push({ x: top.x, y: top.y, z: top.z, phase: rnd() * TAU, white: false });
  block(street, 2.0, 0.8, 0.3, 2.2, 1.6, 2, new Color("#e3d8c4"));
  put(pen, UNIT.hemi, new Color("#f0f0f0"), 2.0, 2 * FLOOR + 0.35, 0.8, 0, 1.0, 0.6, 1.0, -0.6);
  return [{ x: 0.8, z: 0.4, r: 3.0 }];
}

function windmill(street: Street): Reserve[] {
  const { pen, district } = street;
  put(pen, UNIT.cyl, new Color("#efe6d4"), 0, 0, 0, 0, 2.0, 4.6, 2.0);
  put(pen, UNIT.cone, new Color("#5a6b7a"), 0, 4.6, 0, 0, 2.2, 1.4, 2.2);
  // Note that the sails face the board's centre, so they read from the establishing shot.
  const face = Math.atan2(district.x, district.z) + Math.PI;
  street.out.windmills.push({
    x: district.x + Math.sin(face) * 1.15,
    z: district.z + Math.cos(face) * 1.15,
    y: 4.9,
    face,
  });
  return [{ x: 0, z: 0, r: 2.8 }];
}

function waterTower(street: Street): Reserve[] {
  const { pen } = street;
  for (let leg = 0; leg < 4; leg += 1) {
    const [x, z] = turned(0, 0, (leg * Math.PI) / 2 + Math.PI / 4, 0, 0.9);
    put(pen, UNIT.box, new Color("#7a6250"), x, 0, z, 0, 0.14, 3.2, 0.14);
  }
  put(pen, UNIT.cyl, new Color("#a0703f"), 0, 3.2, 0, 0, 2.2, 1.5, 2.2);
  put(pen, UNIT.cone, new Color("#5a4636"), 0, 4.7, 0, 0, 2.4, 0.8, 2.4);
  return [{ x: 0, z: 0, r: 1.6 }];
}

function mast(street: Street): Reserve[] {
  const { pen, district, rnd } = street;
  put(pen, UNIT.box, new Color("#9a2a22"), 0, 0, 0, 0, 0.16, 7.5, 0.16);
  for (let arm = 1; arm < 4; arm += 1)
    put(pen, UNIT.box, new Color("#e8e8e8"), 0, arm * 1.8, 0, 0, 1.4 - arm * 0.25, 0.06, 0.06);
  put(pen, UNIT.sphere, new Color("#c43c2f"), 0, 7.6, 0, 0, 0.22, 0.22, 0.22);
  const top = onBoard(district, 0, 0, 7.6);
  street.out.beacons.push({ x: top.x, y: top.y, z: top.z, phase: rnd() * TAU, white: false });
  block(street, 1.6, 0.4, 0.2, 1.8, 1.4, 2, new Color("#efe1c2"));
  return [{ x: 0.8, z: 0.2, r: 2.0 }];
}

function signalBox(street: Street): Reserve[] {
  const { pen } = street;
  put(pen, UNIT.box, new Color("#7b4b33"), 0, 0, 0, 0, 2.2, 1.0, 1.6);
  put(pen, UNIT.box, new Color("#f1e7d0"), 0, 1.0, 0, 0, 2.3, 1.1, 1.7);
  put(pen, UNIT.gable, new Color("#3e4f5c"), 0, 2.1, 0, Math.PI / 2, 1.9, 0.8, 2.5);
  windowsOn(street, 0, 0, 0, 2.3, 1.7, 2.1, 1.0, 1.0, 0.4);
  return [{ x: 0, z: 0, r: 1.8 }];
}

function control(street: Street): Reserve[] {
  block(street, 0, 0, 0, 2.6, 2.0, 2, new Color("#e6d6b4"));
  put(street.pen, UNIT.hemi, WHITE, 0, 2 * FLOOR + 0.6, 0, 0, 1.3, 0.7, 1.3, -0.5);
  return [{ x: 0, z: 0, r: 2.0 }];
}

function gate(street: Street): Reserve[] {
  const { pen, district, rnd } = street;
  const ri = district.plotRadius;
  put(pen, UNIT.sphere, new Color("#6f9a4a"), 0, 0, 0, 0, ri * 1.6, 3.6, ri * 1.4);
  put(pen, UNIT.box, STONE, 0, 0, ri * 0.62, 0, 2.4, 1.9, 0.6);
  put(pen, UNIT.halfCyl, STONE, 0, 1.9, ri * 0.62, Math.PI / 2, 0.6, 2.4, 2.4);
  put(pen, UNIT.box, new Color("#1a1a1a"), 0, 0, ri * 0.66, 0, 1.4, 1.5, 0.58);
  for (let tree = 0; tree < 6; tree += 1) {
    const angle = rnd() * TAU;
    const r = rnd() * ri * 0.5;
    street.out.trees.push({
      x: district.x + Math.cos(angle) * r,
      z: district.z + Math.sin(angle) * r,
      y: 1.4 + rnd() * 0.8,
      scale: 0.8 + rnd() * 0.5,
      pine: true,
      turn: rnd() * TAU,
    });
  }
  return [{ x: 0, z: 0, r: ri * 0.85 }];
}

function bank(street: Street): Reserve[] {
  const { pen } = street;
  const w = 3.6;
  const d = 2.6;
  put(pen, UNIT.box, STONE, 0, 0, 0, 0, w + 0.6, 0.3, d + 0.6);
  put(pen, UNIT.box, new Color("#efe8da"), 0, 0.3, -0.3, 0, w, 2.2, d - 0.6);
  for (let column = 0; column < 6; column += 1) {
    put(
      pen,
      UNIT.cyl8,
      WHITE,
      -w / 2 + 0.3 + (column * (w - 0.6)) / 5,
      0.3,
      d / 2 - 0.25,
      0,
      0.26,
      2.2,
      0.26,
    );
  }
  put(pen, UNIT.box, new Color("#e4dccb"), 0, 2.5, 0, 0, w + 0.2, 0.3, d);
  put(pen, UNIT.gable, new Color("#e4dccb"), 0, 2.8, 0, Math.PI / 2, d, 0.8, w + 0.2);
  return [{ x: 0, z: 0, r: 2.6 }];
}

function office(street: Street): Reserve[] {
  block(street, 0, 0, 0.2, 2.6, 2.6, 9, new Color("#c9d2d6"));
  return [{ x: 0, z: 0, r: 2.2 }];
}

function warehouse(street: Street): Reserve[] {
  const { pen, rnd } = street;
  const crates = ["#9c5a4a", "#4f7a96", "#c9a85a", "#6a8a64", "#b07a4e", "#7a6a8e"] as const;
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const height = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < height; k += 1) {
        put(
          pen,
          UNIT.box,
          new Color(pickOf(crates, rnd)),
          -1.8 + i * 1.2,
          k * 0.55,
          -0.9 + j * 0.62,
          0,
          1.1,
          0.53,
          0.56,
        );
      }
    }
  }
  for (const side of [-1, 1])
    put(pen, UNIT.box, new Color("#e8b92f"), side * 3.0, 0, 0, 0, 0.18, 3.6, 0.18);
  put(pen, UNIT.box, new Color("#e8b92f"), 0, 3.6, 0, 0, 6.4, 0.3, 0.3);
  return [{ x: 0, z: 0, r: 3.4 }];
}

function paint(street: Street): Reserve[] {
  const { pen } = street;
  const swatches = ["#e98aab", "#f4c95d", "#6fc5a8", "#7fa3d9", "#a69ad9", "#f08a5d"] as const;
  put(pen, UNIT.cyl, new Color("#e8e2d6"), 0, 0, 0, 0, 4.6, 0.12, 4.6);
  swatches.forEach((swatch, index) => {
    const angle = (index * TAU) / 6;
    put(
      pen,
      UNIT.cyl,
      new Color(swatch),
      Math.cos(angle) * 1.4,
      0,
      Math.sin(angle) * 1.4,
      0,
      0.9,
      1.0 + (index % 3) * 0.5,
      0.9,
    );
  });
  put(pen, UNIT.sphere, new Color("#f4c95d"), 0, 1.6, 0, 0, 1.2, 1.2, 1.2);
  put(pen, UNIT.box, new Color("#e98aab"), 0, 0, 0, Math.PI / 4, 0.5, 1.4, 0.5);
  return [{ x: 0, z: 0, r: 2.6 }];
}

function billboard(street: Street): Reserve[] {
  const { pen } = street;
  for (const side of [-1, 1]) put(pen, UNIT.box, DARK, side * 1.1, 0, 0, 0, 0.12, 2.2, 0.12);
  ["#e98aab", "#f4c95d", "#77bfc9"].forEach((panel, index) => {
    put(pen, UNIT.box, new Color(panel), -0.95 + index * 0.95, 2.0, 0.08, 0, 0.95, 1.4, 0.08);
  });
  return [{ x: 0, z: 0, r: 1.5 }];
}

const COOLING_TOWER = shapeOf(
  new LatheGeometry(
    Array.from({ length: 11 }, (_, step) => {
      const t = step / 10;
      return new Vector2(0.95 - 0.42 * Math.sin(t * Math.PI * 0.9), t * 3.6);
    }),
    16,
  ),
);

function power(street: Street): Reserve[] {
  const { pen, district } = street;
  put(pen, UNIT.box, new Color("#9aa3a8"), -1.2, 0, 0, 0, 3.6, 2.6, 2.8);
  put(pen, UNIT.box, new Color("#7f878c"), -1.2, 2.6, 0, 0, 3.8, 0.2, 3.0);
  windowsOn(street, -1.2, 0, 0, 3.6, 2.8, 2.6, 0.3, 1.0, 0.7);
  for (const z of [-1.3, 1.3]) {
    put(pen, COOLING_TOWER, new Color("#d7d2c8"), 2.2, 0, z);
    const top = onBoard(district, 2.2, z, 3.8);
    street.out.emitters.push({ x: top.x, y: top.y, z: top.z, kind: "steam", scale: 1.6 });
  }
  chimney(street, -2.4, -0.6, 0.25, 4.6, new Color("#c9c3b8"));
  return [{ x: 0, z: 0, r: 3.9 }];
}

function church(street: Street): Reserve[] {
  const { pen } = street;
  put(pen, UNIT.box, new Color("#efe6d2"), 0, 0, 0, 0, 2.0, 2.0, 4.0);
  put(pen, UNIT.gable, SLATE, 0, 2.0, 0, 0, 2.2, 1.3, 4.2);
  put(pen, UNIT.box, new Color("#efe6d2"), 0, 0, 2.4, 0, 1.3, 4.8, 1.3);
  put(pen, UNIT.pyr, SLATE, 0, 4.8, 2.4, 0, 1.35, 3.4, 1.35);
  windowsOn(street, 0, 0, 0, 2.0, 4.0, 2.0, 0.4, 1.0, 0.8);
  return [{ x: 0, z: 0.4, r: 2.8 }];
}

function harbor(street: Street): Reserve[] {
  const { pen, district } = street;
  const ri = district.plotRadius;
  ["#c56a4a", "#4c8fa8", "#d9b25a"].forEach((wall, index) => {
    shed(
      street,
      -ri * 0.45,
      -3 + index * 3,
      Math.PI / 2,
      2.6,
      2.0,
      new Color(wall),
      new Color("#6a6f75"),
    );
  });
  for (const z of [-1.6, 1.6]) {
    put(pen, UNIT.box, new Color("#c0623f"), -ri + 0.6, 0, z - 0.6, 0, 0.16, 3.6, 0.16);
    put(pen, UNIT.box, new Color("#c0623f"), -ri + 0.6, 0, z + 0.6, 0, 0.16, 3.6, 0.16);
    put(pen, UNIT.box, new Color("#c0623f"), -ri - 0.4, 3.6, z, 0, 3.2, 0.25, 0.3);
  }
  return [{ x: -ri * 0.45, z: 0, r: ri * 0.55 }];
}

function airport(street: Street): Reserve[] {
  const { pen, district, rnd } = street;
  put(pen, UNIT.halfCyl, new Color("#b9c2c8"), 0, 0, -0.3, 0, 3.2, 3.0, 2.8);
  put(pen, UNIT.box, new Color("#5a6066"), 0, 0, 1.08, 0, 2.4, 1.0, 0.05);
  put(pen, UNIT.cyl, new Color("#e8e4da"), 2.0, 0, 1.2, 0, 0.7, 3.2, 0.7);
  put(pen, UNIT.cyl, new Color("#7fb3c9"), 2.0, 3.2, 1.2, 0, 1.2, 0.55, 1.2);
  put(pen, UNIT.cyl, DARK, 2.0, 3.75, 1.2, 0, 1.3, 0.12, 1.3);
  const top = onBoard(district, 2.0, 1.2, 4.0);
  street.out.beacons.push({ x: top.x, y: top.y, z: top.z, phase: rnd() * TAU, white: true });
  return [{ x: 0.6, z: 0.4, r: 2.6 }];
}

function museum(street: Street): Reserve[] {
  const { pen } = street;
  put(pen, UNIT.box, new Color("#efe8da"), 0, 0, 0, 0, 3.4, 1.8, 2.6);
  put(pen, UNIT.hemi, new Color("#6d9fa0"), 0, 1.8, 0, 0, 2.2, 2.0, 2.2);
  for (let column = 0; column < 5; column += 1)
    put(pen, UNIT.cyl8, WHITE, -1.4 + column * 0.7, 0, 1.4, 0, 0.22, 1.8, 0.22);
  return [{ x: 0, z: 0, r: 2.4 }];
}

function lumber(street: Street): Reserve[] {
  const { pen } = street;
  for (let layer = 0; layer < 3; layer += 1) {
    for (let log = 0; log < 3 - layer; log += 1) {
      put(
        pen,
        UNIT.cyl8,
        new Color("#9a6a3e"),
        -1.0 + log * 0.42 + layer * 0.21,
        0.2 + layer * 0.36,
        0,
        Math.PI / 2,
        0.4,
        2.6,
        0.4,
        0,
        Math.PI / 2,
      );
    }
  }
  shed(street, 1.2, -1.2, 0, 2.2, 1.8, WOOD, new Color("#5d4a3a"));
  return [{ x: 0, z: -0.4, r: 2.2 }];
}

function utility(street: Street): Reserve[] {
  const { pen } = street;
  for (let pylon = 0; pylon < 2; pylon += 1) {
    put(pen, UNIT.box, STEEL, -1 + pylon * 2, 0, -1, 0, 0.14, 4.4, 0.14);
    put(pen, UNIT.box, STEEL, -1 + pylon * 2, 3.8, -1, 0, 1.4, 0.1, 0.1);
  }
  put(pen, UNIT.box, new Color("#7d8a6a"), 0, 0, 0.8, 0, 1.8, 1.0, 1.2);
  tank(street, 1.6, 1.0, 0.6, 1.4, new Color("#d8d8d0"));
  return [{ x: 0, z: 0, r: 2.0 }];
}

function workshop(street: Street): Reserve[] {
  chimney(street, 0, 0, 0.3, 4.2, BRICK);
  return [{ x: 0, z: 0, r: 0.9 }];
}

const LANDMARK = {
  [DISTRICT_STYLE.STATION]: station,
  [DISTRICT_STYLE.YARD]: yard,
  [DISTRICT_STYLE.SIGNAL]: signalBox,
  [DISTRICT_STYLE.WATER_TOWER]: waterTower,
  [DISTRICT_STYLE.MAST]: mast,
  [DISTRICT_STYLE.CONTROL]: control,
  [DISTRICT_STYLE.CLOCK_TOWER]: clockTower,
  [DISTRICT_STYLE.FACTORY]: factory,
  [DISTRICT_STYLE.WORKSHOP]: workshop,
  [DISTRICT_STYLE.OFFICE]: office,
  [DISTRICT_STYLE.WAREHOUSE]: warehouse,
  [DISTRICT_STYLE.BANK]: bank,
  [DISTRICT_STYLE.RADIO]: radio,
  [DISTRICT_STYLE.WINDMILL]: windmill,
  [DISTRICT_STYLE.GATE]: gate,
  [DISTRICT_STYLE.SHOPS]: () => [],
  [DISTRICT_STYLE.TOWN]: church,
  [DISTRICT_STYLE.PAINT]: paint,
  [DISTRICT_STYLE.BILLBOARD]: billboard,
  [DISTRICT_STYLE.MUSEUM]: museum,
  [DISTRICT_STYLE.POWER]: power,
  [DISTRICT_STYLE.HARBOR]: harbor,
  [DISTRICT_STYLE.LUMBER]: lumber,
  [DISTRICT_STYLE.UTILITY]: utility,
  [DISTRICT_STYLE.AIRPORT]: airport,
} as const satisfies { readonly [Style in District["style"]]: (street: Street) => Reserve[] };

/** The styles whose free cells grow sheds and tanks rather than houses. */
const WORKS: ReadonlySet<District["style"]> = new Set([
  DISTRICT_STYLE.YARD,
  DISTRICT_STYLE.WAREHOUSE,
  DISTRICT_STYLE.WORKSHOP,
  DISTRICT_STYLE.LUMBER,
  DISTRICT_STYLE.UTILITY,
  DISTRICT_STYLE.POWER,
  DISTRICT_STYLE.AIRPORT,
]);

/** What grows in one free cell, by the district's style. */
function grow(street: Street, x: number, z: number, ry: number, size: number): void {
  const { district, rnd } = street;
  const style = district.style;
  const w = size * (0.62 + rnd() * 0.26);
  const d = size * (0.6 + rnd() * 0.3);
  const wall = jitter(
    district.color.clone().lerp(new Color(pickOf(SHOP_WALLS, rnd)), 0.86),
    rnd,
    0.02,
    0.04,
    0.05,
  );
  const roof = jitter(new Color(pickOf(ROOFS, rnd)), rnd, 0.02, 0.04, 0.05);
  const core = district.layer === ZONE_LAYER.CORE;
  if (style === DISTRICT_STYLE.SHOPS) {
    const front = jitter(
      new Color(pickOf(SHOP_WALLS, rnd)).lerp(district.color, 0.1),
      rnd,
      0.02,
      0.04,
      0.05,
    );
    shop(street, x, z, ry, w, d, 1 + Math.floor(rnd() * 3), front, new Color(pickOf(AWNINGS, rnd)));
  } else if (style === DISTRICT_STYLE.PAINT) {
    const pastel = new Color(pickOf(["#f1d3dc", "#d8ecdf", "#d6e2f3", "#e4dcf3", "#efe2cf"], rnd));
    house(street, x, z, ry, w, d, 2 + Math.floor(rnd() * 2), pastel, new Color("#5a5560"));
  } else if (WORKS.has(style)) {
    const tanked =
      style === DISTRICT_STYLE.YARD ? 0.45 : style === DISTRICT_STYLE.UTILITY ? 0.5 : 0;
    if (rnd() < tanked)
      tank(street, x, z, size * 0.32, 1.1 + rnd() * 1.4, jitter(new Color("#e2dfd6"), rnd));
    else
      shed(
        street,
        x,
        z,
        ry,
        w,
        d,
        jitter(style === DISTRICT_STYLE.WORKSHOP ? new Color("#a99686") : wall, rnd),
        jitter(SLATE, rnd),
      );
  } else if (style === DISTRICT_STYLE.FACTORY) {
    if (rnd() < 0.6)
      shed(street, x, z, ry, w, d, jitter(new Color("#9a8476"), rnd), jitter(SLATE, rnd));
    else
      block(street, x, z, ry, w, d, 2 + Math.floor(rnd() * 2), jitter(new Color("#a38f80"), rnd));
  } else if (
    style === DISTRICT_STYLE.OFFICE ||
    style === DISTRICT_STYLE.BANK ||
    style === DISTRICT_STYLE.STATION ||
    core
  ) {
    const floors = (core ? 3 : 2) + Math.floor(rnd() * 4);
    block(
      street,
      x,
      z,
      ry,
      w,
      d,
      floors,
      core ? jitter(new Color("#e6dccb"), rnd, 0.02, 0.04, 0.06) : wall,
    );
  } else if (style === DISTRICT_STYLE.HARBOR) {
    if (rnd() < 0.5) shed(street, x, z, ry, w, d, wall, SLATE);
    else block(street, x, z, ry, w, d, 2 + Math.floor(rnd() * 3), wall);
  } else if (district.layer === ZONE_LAYER.DOMAIN && rnd() < 0.5) {
    block(street, x, z, ry, w, d, 2 + Math.floor(rnd() * 3), wall);
  } else {
    house(street, x, z, ry, w, d, 1 + Math.floor(rnd() * 2), wall, roof);
  }
}

function blocked(reserves: readonly Reserve[], x: number, z: number, r: number): boolean {
  return reserves.some((reserve) =>
    "r" in reserve
      ? Math.hypot(x - reserve.x, z - reserve.z) < reserve.r + r
      : x + r > reserve.x0 && x - r < reserve.x1 && z + r > reserve.z0 && z - r < reserve.z1,
  );
}

/** Builds one district: its landmark on its own cell, then a building in each free cell. */
function buildDistrict(
  builder: Builder,
  windows: Windows,
  district: District,
  firstCell: number,
  out: Furniture,
): Cell[] {
  const pen: Pen = { builder, frame: district.frame, extra: [district.index] };
  const street: Street = { pen, windows, district, rnd: seeded(hashOf(district.path)), out };
  const reserves = LANDMARK[district.style](street);
  const rnd = seeded(hashOf(`fill:${district.path}`));
  const size =
    district.style === DISTRICT_STYLE.SHOPS ? 2.0 : district.layer === ZONE_LAYER.CORE ? 2.3 : 2.2;
  const reach = Math.ceil(district.plotRadius / size) + 1;
  const cells: Cell[] = [];
  const fillStreet: Street = { ...street, rnd };
  for (let i = -reach; i <= reach; i += 1) {
    for (let j = -reach; j <= reach; j += 1) {
      const x = i * size + (rnd() - 0.5) * 0.2;
      const z = j * size + (rnd() - 0.5) * 0.2;
      if (Math.hypot(x, z) + size * 0.55 > district.plotRadius) continue;
      if (blocked(reserves, x, z, size * 0.42)) continue;
      const at = onBoard(district, x, z);
      if (rnd() < 0.07) {
        out.trees.push({
          x: at.x,
          z: at.z,
          y: 0,
          scale: 0.5 + rnd() * 0.3,
          pine: rnd() < 0.25,
          turn: rnd() * TAU,
        });
        continue;
      }
      const id = firstCell + cells.length;
      cells.push({ id, district, x: at.x, z: at.z, size });
      pen.extra = [id];
      grow(fillStreet, x, z, (Math.floor(rnd() * 4) * Math.PI) / 2, size);
    }
  }
  const lampCount = Math.max(4, Math.round(district.radius / 2.2));
  for (let lamp = 0; lamp < lampCount; lamp += 1) {
    const angle = (lamp / lampCount) * TAU + 0.3;
    out.lamps.push({
      x: district.x + Math.cos(angle) * (district.radius - 1.75),
      z: district.z + Math.sin(angle) * (district.radius - 1.75),
      h: 1.25,
    });
  }
  return cells;
}

/** Builds every district's buildings for a board. */
export function buildTown(layout: Layout): Town {
  const builder = new Builder(["aCell"]);
  const windows = new Windows();
  const out: Furniture = {
    emitters: [],
    clocks: [],
    beacons: [],
    windmills: [],
    trees: [],
    sidings: [],
    lamps: [],
  };
  const cells: Cell[] = [];
  for (const district of layout.districts) {
    cells.push(
      ...buildDistrict(builder, windows, district, layout.districts.length + cells.length, out),
    );
  }
  return {
    buildings: builder.build(),
    windows: windows.build(),
    cells,
    cellCount: layout.districts.length + cells.length,
    ...out,
  };
}
