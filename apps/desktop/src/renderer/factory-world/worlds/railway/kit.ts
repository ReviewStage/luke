import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from "three";

/**
 * kit.ts -- the railway's workbench: seeded randomness, the unit shapes every building is cut from, and the builder that welds thousands of them into one mesh.
 *
 * A model railway is thousands of small parts. Each is a unit shape (a box
 * standing on its base, a gable, a cylinder) placed by a matrix and painted
 * one colour; a `Builder` copies the placed triangles of all of them into one
 * geometry with a colour per vertex, so a whole town is one draw call. A
 * shape's triangles are kept unindexed once, here, so a build only copies and
 * transforms floats.
 *
 * Everything is seeded: the same path always grows the same buildings.
 */

export const TAU = Math.PI * 2;

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hashes `text` to 32 bits (FNV-1a), the seed a path or an id grows from. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Smoothstep over [0, 1]. */
export function smooth(t: number): number {
  const held = clamp(t, 0, 1);
  return held * held * (3 - 2 * held);
}

/** One of `items`, drawn by `rnd`. */
export function pickOf<T>(items: readonly [T, ...T[]], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)] ?? items[0];
}

/** Turns the local point (`x`, `z`) by `ry` about the origin and moves it to (`ox`, `oz`). */
export function turned(ox: number, oz: number, ry: number, x: number, z: number): [number, number] {
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  return [ox + x * cos + z * sin, oz - x * sin + z * cos];
}

const SCRATCH_POSITION = new Vector3();
const SCRATCH_SCALE = new Vector3();
const SCRATCH_TURN = new Quaternion();
const SCRATCH_EULER = new Euler(0, 0, 0, "YXZ");

/** The matrix that places a part: moved, turned (yaw, then pitch and roll), and scaled. */
export function placing(
  x: number,
  y: number,
  z: number,
  ry = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  rx = 0,
  rz = 0,
  into = new Matrix4(),
): Matrix4 {
  SCRATCH_EULER.set(rx, ry, rz, "YXZ");
  return into.compose(
    SCRATCH_POSITION.set(x, y, z),
    SCRATCH_TURN.setFromEuler(SCRATCH_EULER),
    SCRATCH_SCALE.set(sx, sy, sz),
  );
}

/** A matrix that hides an instance where it stands: scaled to nothing, so a picked anchor still lands near it. */
export function hidden(x: number, y: number, z: number, into = new Matrix4()): Matrix4 {
  return into.makeScale(0, 0, 0).setPosition(x, y, z);
}

export function shade(color: Color, lightness: number): Color {
  return color.clone().offsetHSL(0, 0, lightness);
}

/** A colour nudged a little in hue, saturation and lightness, so a row of houses is never one paint. */
export function jitter(
  color: Color,
  rnd: () => number,
  hue = 0.02,
  sat = 0.08,
  light = 0.07,
): Color {
  return color.clone().offsetHSL((rnd() - 0.5) * hue, (rnd() - 0.5) * sat, (rnd() - 0.5) * light);
}

/** A unit shape's triangles, unindexed, ready to be copied into a build. */
export interface UnitShape {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

function unitOf(geometry: BufferGeometry): UnitShape {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  flat.computeVertexNormals();
  const shape = {
    positions: Float32Array.from(flat.getAttribute("position").array),
    normals: Float32Array.from(flat.getAttribute("normal").array),
  };
  flat.dispose();
  geometry.dispose();
  return shape;
}

/** An extruded outline one unit deep, centred on z. */
function prismOf(points: readonly (readonly [number, number])[]): ExtrudeGeometry {
  const outline = new Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  });
  outline.closePath();
  return new ExtrudeGeometry(outline, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

/** The unit shapes, each standing on its base unless it says otherwise, as fresh geometries. */
export const UNIT_GEOMETRY = {
  box: () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  /** Centred on its middle rather than its base. */
  cbox: () => new BoxGeometry(1, 1, 1),
  cyl: () => new CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0),
  cyl8: () => new CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0),
  cone: () => new ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0),
  pyr: () => new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
  sphere: () => new SphereGeometry(0.5, 14, 9),
  hemi: () => new SphereGeometry(0.5, 14, 6, 0, TAU, 0, Math.PI / 2),
  gable: () =>
    prismOf([
      [-0.5, 0],
      [0.5, 0],
      [0, 1],
    ]),
  /** A sawtooth roof's one tooth. */
  tooth: () =>
    prismOf([
      [-0.5, 0],
      [0.5, 0],
      [0.5, 1],
    ]),
  halfCyl: () => new CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2),
  /** A coin standing on its edge, facing z. */
  disc: () => new CylinderGeometry(0.5, 0.5, 1, 18).rotateX(Math.PI / 2),
} as const;

export type UnitName = keyof typeof UNIT_GEOMETRY;

/** The unit shapes' triangles, read once. */
export const UNIT = {
  box: unitOf(UNIT_GEOMETRY.box()),
  cbox: unitOf(UNIT_GEOMETRY.cbox()),
  cyl: unitOf(UNIT_GEOMETRY.cyl()),
  cyl8: unitOf(UNIT_GEOMETRY.cyl8()),
  cone: unitOf(UNIT_GEOMETRY.cone()),
  pyr: unitOf(UNIT_GEOMETRY.pyr()),
  sphere: unitOf(UNIT_GEOMETRY.sphere()),
  hemi: unitOf(UNIT_GEOMETRY.hemi()),
  gable: unitOf(UNIT_GEOMETRY.gable()),
  tooth: unitOf(UNIT_GEOMETRY.tooth()),
  halfCyl: unitOf(UNIT_GEOMETRY.halfCyl()),
  disc: unitOf(UNIT_GEOMETRY.disc()),
} as const satisfies { readonly [Name in UnitName]: UnitShape };

/** Any geometry's triangles as a unit shape, for a part only one building needs. */
export function shapeOf(geometry: BufferGeometry): UnitShape {
  return unitOf(geometry);
}

/** A float array that grows as it is written. */
class Floats {
  private data = new Float32Array(1024);
  length = 0;

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) this.grow();
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.length += 3;
  }

  push(value: number): void {
    if (this.length + 1 > this.data.length) this.grow();
    this.data[this.length] = value;
    this.length += 1;
  }

  done(): Float32Array {
    return this.data.slice(0, this.length);
  }

  private grow(): void {
    const next = new Float32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }
}

const SCRATCH_NORMAL = new Matrix3();

/**
 * Welds placed, painted unit shapes into one geometry: position, normal, a
 * colour per vertex, and one float per vertex for each extra attribute the
 * builder was made with (which zone a part belongs to, which plot it stands
 * on), so a shader can tell the parts of one mesh apart.
 */
export class Builder {
  private readonly positions = new Floats();
  private readonly normals = new Floats();
  private readonly colors = new Floats();
  private readonly extras: Floats[];

  constructor(private readonly extraNames: readonly string[] = []) {
    this.extras = extraNames.map(() => new Floats());
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  add(shape: UnitShape, color: Color, matrix: Matrix4, extra: readonly number[] = []): void {
    // Note that the placing is an affine matrix, so each point is moved by its elements directly, a town being millions of points.
    const [
      m0 = 1,
      m1 = 0,
      m2 = 0,
      ,
      m4 = 0,
      m5 = 1,
      m6 = 0,
      ,
      m8 = 0,
      m9 = 0,
      m10 = 1,
      ,
      m12 = 0,
      m13 = 0,
      m14 = 0,
    ] = matrix.elements;
    const [n0 = 1, n1 = 0, n2 = 0, n3 = 0, n4 = 1, n5 = 0, n6 = 0, n7 = 0, n8 = 1] =
      SCRATCH_NORMAL.getNormalMatrix(matrix).elements;
    const { positions, normals } = shape;
    for (let at = 0; at < positions.length; at += 3) {
      const x = positions[at] ?? 0;
      const y = positions[at + 1] ?? 0;
      const z = positions[at + 2] ?? 0;
      this.positions.push3(
        m0 * x + m4 * y + m8 * z + m12,
        m1 * x + m5 * y + m9 * z + m13,
        m2 * x + m6 * y + m10 * z + m14,
      );
      const nx = normals[at] ?? 0;
      const ny = normals[at + 1] ?? 1;
      const nz = normals[at + 2] ?? 0;
      const tx = n0 * nx + n3 * ny + n6 * nz;
      const ty = n1 * nx + n4 * ny + n7 * nz;
      const tz = n2 * nx + n5 * ny + n8 * nz;
      const length = Math.hypot(tx, ty, tz) || 1;
      this.normals.push3(tx / length, ty / length, tz / length);
      this.colors.push3(color.r, color.g, color.b);
      for (let index = 0; index < this.extras.length; index += 1)
        this.extras[index]?.push(extra[index] ?? 0);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions.done(), 3));
    geometry.setAttribute("normal", new BufferAttribute(this.normals.done(), 3));
    geometry.setAttribute("color", new BufferAttribute(this.colors.done(), 3));
    this.extraNames.forEach((name, index) => {
      const floats = this.extras[index];
      if (floats !== undefined) geometry.setAttribute(name, new BufferAttribute(floats.done(), 1));
    });
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Where `put` draws: a builder, the frame its parts are placed in, and the extra attributes they carry. */
export interface Pen {
  readonly builder: Builder;
  frame: Matrix4;
  extra: readonly number[];
}

const SCRATCH_PART = new Matrix4();

/** Places one painted part in the pen's frame. */
export function put(
  pen: Pen,
  shape: UnitShape,
  color: Color,
  x: number,
  y: number,
  z: number,
  ry = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  rx = 0,
  rz = 0,
): void {
  placing(x, y, z, ry, sx, sy, sz, rx, rz, SCRATCH_PART).premultiply(pen.frame);
  pen.builder.add(shape, color, SCRATCH_PART, pen.extra);
}
