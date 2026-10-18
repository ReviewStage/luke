import { ZONE_LAYER, type ZoneLayer } from "@luke/ui/factory-world";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";

/**
 * geo.ts -- the Factory's palette, its seeded randomness and noise, and the builder every one of its props is welded from.
 *
 * Every static thing in the Factory, a hall, a fence, a tank farm, is a few
 * hundred coloured primitives welded into one geometry, so the whole yard
 * draws in a handful of calls. `Geo` is that welder: each `box`, `cyl`, or
 * `beam` appends a transformed, vertex-coloured copy of a unit primitive,
 * tagged with the zone it belongs to where the building shader needs one,
 * and `build` hands back one `BufferGeometry`. Randomness is seeded by path
 * (`rngOf`), so the same repository dresses the same way every time.
 */

/** The yard's own dressing: concrete, asphalt, steel, and paint. */
export const PAL = {
  ground: "#93b06f",
  grassDark: "#6f9058",
  concreteDark: "#b8b09f",
  asphalt: "#3b414e",
  line: "#f1ece0",
  wall: "#ece5d5",
  wallShade: "#d3cab6",
  steel: "#c4cbd3",
  steelDark: "#77818e",
  iron: "#4b525d",
  dark: "#2d323c",
  wood: "#c8995a",
  woodDark: "#94693c",
  hazard: "#f2bf2f",
  red: "#d9503b",
} as const;

/** The pad each layer's lots stand on. */
export const PADS = {
  [ZONE_LAYER.CORE]: "#e3c3a2",
  [ZONE_LAYER.DOMAIN]: "#c4d0d9",
  [ZONE_LAYER.SURFACE]: "#e7ddc4",
  [ZONE_LAYER.TOOLING]: "#d2cdc2",
} as const satisfies Record<ZoneLayer, string>;

/** Each layer's trim: the band under a roof, a kerb, a tank's stripe. */
export const ACCENT = {
  [ZONE_LAYER.CORE]: "#d77a3c",
  [ZONE_LAYER.DOMAIN]: "#4f87aa",
  [ZONE_LAYER.SURFACE]: "#d9a53b",
  [ZONE_LAYER.TOOLING]: "#8c949f",
} as const satisfies Record<ZoneLayer, string>;

/** What glows by itself: windows, skylights, a furnace's mouth. */
export const GLOW = {
  warm: "#ffcf8a",
  cool: "#bfe6ff",
  sky: "#9ccbea",
  molten: "#ff6a12",
  green: "#6dff7a",
  violet: "#a98bff",
  teal: "#dfe8ff",
} as const;

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** FNV-1a of `text`, as an unsigned 32-bit seed. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

/** A seeded generator of numbers in [0, 1): mulberry32 over `seed`'s hash. */
export function rngOf(seed: string): () => number {
  let state = hashOf(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cornerHash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  return lerp(
    lerp(cornerHash(xi, yi), cornerHash(xi + 1, yi), u),
    lerp(cornerHash(xi, yi + 1), cornerHash(xi + 1, yi + 1), u),
    v,
  );
}

/** Three octaves of value noise, in about [0, 1]. */
export function fbm(x: number, y: number): number {
  return (
    valueNoise(x, y) * 0.55 +
    valueNoise(x * 2.1, y * 2.1) * 0.3 +
    valueNoise(x * 4.3, y * 4.3) * 0.15
  );
}

/** One colour a prop names: a hex, or a colour already made. */
export type Paint = string | Color;

const colors = new Map<string, Color>();

/** The colour `paint` names, made once per hex. */
export function col(paint: Paint): Color {
  if (paint instanceof Color) return paint;
  const made = colors.get(paint);
  if (made !== undefined) return made;
  const color = new Color(paint);
  colors.set(paint, color);
  return color;
}

/** `paint` scaled by `factor`: darker under 1, an emissive's overdrive over it. */
export function shade(paint: Paint, factor: number): Color {
  return col(paint).clone().multiplyScalar(factor);
}

/** One unit primitive, as the triangles `Geo` copies: positions and normals, unindexed. */
interface Primitive {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

function primitiveOf(geometry: BufferGeometry): Primitive {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  flat.computeVertexNormals();
  const positions = new Float32Array(flat.getAttribute("position").array);
  const normals = new Float32Array(flat.getAttribute("normal").array);
  geometry.dispose();
  flat.dispose();
  return { positions, normals };
}

/** A prism whose upright face stands at +z, so a sawtooth roof shows its glazing to the camera. */
function prismGeometry(ridgeZ: number): BufferGeometry {
  const a = [-0.5, 0, -0.5];
  const b = [0.5, 0, -0.5];
  const c = [-0.5, 0, 0.5];
  const d = [0.5, 0, 0.5];
  const e = [-0.5, 1, ridgeZ];
  const f = [0.5, 1, ridgeZ];
  const triangles = [c, d, f, c, f, e, a, e, f, a, f, b, a, b, d, a, d, c, a, c, e, b, f, d];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(triangles.flat()), 3));
  return geometry;
}

function hyperboloidGeometry(): BufferGeometry {
  const profile: Vector2[] = [];
  for (let step = 0; step <= 10; step += 1) {
    const t = step / 10;
    profile.push(new Vector2(0.62 + 0.38 * (Math.abs(t - 0.62) / 0.62) ** 1.6, t));
  }
  return new LatheGeometry(profile, 18);
}

/** The unit primitives every prop is welded from. */
export const PRIM = {
  box: primitiveOf(new BoxGeometry(1, 1, 1)),
  cyl6: primitiveOf(new CylinderGeometry(1, 1, 1, 6)),
  cyl8: primitiveOf(new CylinderGeometry(1, 1, 1, 8)),
  cyl12: primitiveOf(new CylinderGeometry(1, 1, 1, 12)),
  cyl16: primitiveOf(new CylinderGeometry(1, 1, 1, 16)),
  cyl24: primitiveOf(new CylinderGeometry(1, 1, 1, 24)),
  cone4: primitiveOf(new ConeGeometry(1, 1, 4)),
  cone6: primitiveOf(new ConeGeometry(1, 1, 6)),
  cone7: primitiveOf(new ConeGeometry(1, 1, 7)),
  cone8: primitiveOf(new ConeGeometry(1, 1, 8)),
  cone12: primitiveOf(new ConeGeometry(1, 1, 12)),
  cone16: primitiveOf(new ConeGeometry(1, 1, 16)),
  taper: primitiveOf(new CylinderGeometry(0.35, 1, 1, 4)),
  frustum: primitiveOf(new CylinderGeometry(0.7, 1, 1, 12)),
  sph: primitiveOf(new IcosahedronGeometry(1, 1)),
  sph2: primitiveOf(new IcosahedronGeometry(1, 2)),
  ico: primitiveOf(new IcosahedronGeometry(1, 0)),
  dome: primitiveOf(new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  prism: primitiveOf(prismGeometry(0.5)),
  gable: primitiveOf(prismGeometry(0)),
  vault: primitiveOf(new CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)),
  capPX: primitiveOf(new CircleGeometry(1, 16, 0, Math.PI).rotateY(Math.PI / 2)),
  capNX: primitiveOf(new CircleGeometry(1, 16, 0, Math.PI).rotateY(-Math.PI / 2)),
  ring: primitiveOf(new TorusGeometry(1, 0.06, 4, 20).rotateX(Math.PI / 2)),
  hyper: primitiveOf(hyperboloidGeometry()),
} as const;

/** The segment counts a cylinder or cone comes in. */
type CylSegments = 6 | 8 | 12 | 16 | 24;
type ConeSegments = 4 | 6 | 7 | 8 | 12 | 16;

const CYL = { 6: PRIM.cyl6, 8: PRIM.cyl8, 12: PRIM.cyl12, 16: PRIM.cyl16, 24: PRIM.cyl24 } as const;
const CONE = {
  4: PRIM.cone4,
  6: PRIM.cone6,
  7: PRIM.cone7,
  8: PRIM.cone8,
  12: PRIM.cone12,
  16: PRIM.cone16,
} as const;

const scratch = {
  matrix: new Matrix4(),
  normal: new Matrix3(),
  quaternion: new Quaternion(),
  euler: new Euler(),
  scale: new Vector3(),
  position: new Vector3(),
  up: new Vector3(0, 1, 0),
  direction: new Vector3(),
  point: new Vector3(),
} as const;

/** A growable run of floats, so welding never reallocates per primitive. */
class Floats {
  array = new Float32Array(4096);
  length = 0;
  push(value: number): void {
    if (this.length === this.array.length) {
      const grown = new Float32Array(this.array.length * 2);
      grown.set(this.array);
      this.array = grown;
    }
    this.array[this.length] = value;
    this.length += 1;
  }
  take(): Float32Array {
    return this.array.slice(0, this.length);
  }
}

/**
 * Welds coloured primitives into one geometry. `zone` tags what follows it
 * with a zone's index, which `build` writes as the `aZone` attribute where
 * it was asked for, so one draw of every building can still light one.
 */
export class Geo {
  private readonly positions = new Floats();
  private readonly normals = new Floats();
  private readonly colors = new Floats();
  private readonly zones = new Floats();
  /** The zone index what follows is tagged with. */
  zone = 0;
  /** Where what follows is drawn from: a building draws about its own centre, and lands at its lot. */
  readonly origin = new Vector3();

  get empty(): boolean {
    return this.positions.length === 0;
  }

  /** Appends `primitive` under `matrix`, in `paint`. */
  mat(primitive: Primitive, paint: Paint, matrix: Matrix4): this {
    const color = col(paint);
    scratch.normal.getNormalMatrix(matrix);
    const { positions, normals } = primitive;
    const point = scratch.point;
    for (let index = 0; index < positions.length; index += 3) {
      point
        .set(positions[index] ?? 0, positions[index + 1] ?? 0, positions[index + 2] ?? 0)
        .applyMatrix4(matrix)
        .add(this.origin);
      this.positions.push(point.x);
      this.positions.push(point.y);
      this.positions.push(point.z);
      point
        .set(normals[index] ?? 0, normals[index + 1] ?? 0, normals[index + 2] ?? 0)
        .applyMatrix3(scratch.normal)
        .normalize();
      this.normals.push(point.x);
      this.normals.push(point.y);
      this.normals.push(point.z);
      this.colors.push(color.r);
      this.colors.push(color.g);
      this.colors.push(color.b);
      this.zones.push(this.zone);
    }
    return this;
  }

  /** Appends `primitive` centred at (x, y, z), scaled, and turned by Euler angles in YXZ order. */
  add(
    primitive: Primitive,
    paint: Paint,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    scratch.euler.set(rx, ry, rz, "YXZ");
    scratch.quaternion.setFromEuler(scratch.euler);
    scratch.matrix.compose(
      scratch.position.set(x, y, z),
      scratch.quaternion,
      scratch.scale.set(sx, sy, sz),
    );
    return this.mat(primitive, paint, scratch.matrix);
  }

  /** A box standing on y. */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    paint: Paint,
    ry = 0,
  ): this {
    return this.add(PRIM.box, paint, x, y + h / 2, z, w, h, d, 0, ry, 0);
  }

  /** A box centred at y and turned. */
  rbox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    paint: Paint,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    return this.add(PRIM.box, paint, x, y, z, w, h, d, rx, ry, rz);
  }

  /** An upright cylinder standing on y. */
  cyl(x: number, y: number, z: number, r: number, h: number, paint: Paint, seg: CylSegments = 12) {
    return this.add(CYL[seg], paint, x, y + h / 2, z, r, h, r);
  }

  /** A cylinder centred at y and turned. */
  rcyl(
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    paint: Paint,
    rx: number,
    ry: number,
    rz: number,
    seg: CylSegments = 8,
  ): this {
    return this.add(CYL[seg], paint, x, y, z, r, h, r, rx, ry, rz);
  }

  /** An upright cone standing on y. */
  cone(x: number, y: number, z: number, r: number, h: number, paint: Paint, seg: ConeSegments = 8) {
    return this.add(CONE[seg], paint, x, y + h / 2, z, r, h, r);
  }

  sph(x: number, y: number, z: number, r: number, paint: Paint, fine = false): this {
    return this.add(fine ? PRIM.sph2 : PRIM.sph, paint, x, y, z, r, r, r);
  }

  dome(x: number, y: number, z: number, r: number, h: number, paint: Paint): this {
    return this.add(PRIM.dome, paint, x, y, z, r, h, r);
  }

  /** A square beam `t` thick between two points. */
  beam(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    t: number,
    paint: Paint,
  ): this {
    return this.between(PRIM.box, x1, y1, z1, x2, y2, z2, t, paint);
  }

  /** A round pipe of radius `r` between two points. */
  pipe(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    r: number,
    paint: Paint,
  ): this {
    return this.between(PRIM.cyl8, x1, y1, z1, x2, y2, z2, r, paint);
  }

  private between(
    primitive: Primitive,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    t: number,
    paint: Paint,
  ): this {
    const length = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    if (length < 1e-4) return this;
    scratch.direction.set((x2 - x1) / length, (y2 - y1) / length, (z2 - z1) / length);
    scratch.quaternion.setFromUnitVectors(scratch.up, scratch.direction);
    scratch.matrix.compose(
      scratch.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2),
      scratch.quaternion,
      scratch.scale.set(t, length, t),
    );
    return this.mat(primitive, paint, scratch.matrix);
  }

  /** One geometry of everything appended, with `aZone` where `tagged`; empty where nothing was. */
  build(tagged = false): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions.take(), 3));
    geometry.setAttribute("normal", new BufferAttribute(this.normals.take(), 3));
    geometry.setAttribute("color", new BufferAttribute(this.colors.take(), 3));
    if (tagged) geometry.setAttribute("aZone", new BufferAttribute(this.zones.take(), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

/** One geometry welded by `draw`. */
export function partGeo(draw: (geo: Geo) => void): BufferGeometry {
  const geo = new Geo();
  draw(geo);
  return geo.build();
}
