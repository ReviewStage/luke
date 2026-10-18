import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  IcosahedronGeometry,
  MathUtils,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * kit.ts -- the Sky Archipelago's workshop: seeded randomness and noise, the palette its islands are dressed in, and the low-poly prefabs (houses, towers, windmills, ruins, trees) every island is built from.
 *
 * Every prefab is a list of geometries already tinted by vertex colour, so
 * an island merges all of its props into one mesh, and the whole archipelago
 * into one draw call. A prefab names its parts by how they are lit: `solid`
 * parts take the sun, and `glow` parts (a window, a lantern) also give light
 * of their own, carried in a `glow` attribute the island's material adds as
 * emission. Randomness is seeded by a zone's path, so the same zone is
 * always dressed the same way.
 */

export const TAU = Math.PI * 2;
export const UP = new Vector3(0, 1, 0);

/** The island dress: grass, stone, strata, walls, roofs, wood, foliage, and the builders' clothes. */
export const PALETTE = {
  GRASS: ["#9cc153", "#86b04a", "#b4cc5e", "#74a245"],
  GRASS_DARK: "#5f8a3c",
  CORE_GRASS: ["#b9b46c", "#a7aa5f", "#c8bf7c", "#9aa45a"],
  STONE: "#ddd0b4",
  STONE_2: "#c9bb9c",
  STONE_DARK: "#9c9080",
  MOSS: "#7f9450",
  DIRT: "#8c5c3c",
  STRATA: ["#c39467", "#a37e60", "#86716a", "#6e5d6c", "#cfa274", "#94705a"],
  CORE_STRATA: ["#d3cab8", "#b5ad9d", "#99928a", "#807b84", "#ddd1b6", "#a79c8a"],
  SURFACE_STRATA: ["#e3b58c", "#cc9470", "#b47b68", "#916672", "#eec89c", "#ab786a"],
  TOOLING_STRATA: ["#cdbce8", "#ab9cd2", "#8c80ba", "#706ca2", "#e0d3f2", "#b3a3da"],
  WALL: ["#f4e7d0", "#ecdcc0", "#f7f0e3", "#e8d6bb"],
  ROOF: ["#c9553e", "#da7a3f", "#3f8090", "#5a70aa", "#a9463b", "#d99a3e"],
  TOWER_ROOF: ["#3d6fa8", "#2f8c8c", "#c9553e", "#5b4f9e", "#d07a3c"],
  WOOD: "#9a6b45",
  WOOD_DARK: "#6a4630",
  ROPE: "#d8c39a",
  IRON: "#3d3843",
  WINDOW: "#ffb35c",
  LAMP: "#ffb860",
  CREAM: "#f6ecdc",
  LEAF: ["#78a845", "#5f9a43", "#8fb84c"],
  BLOSSOM: ["#f0a8b8", "#f4b6c2", "#e98fa7"],
  AUTUMN: ["#e7a35f", "#d9c35a", "#e08a4a"],
  PINE: ["#4f7d45", "#5d8a4a", "#466f44"],
  TENT: ["#e65a4f", "#f2b134", "#4fa3e6", "#9b6fe0", "#55c08a", "#f27fb0"],
  OVERALL: ["#3f6fb5", "#d9643a", "#4a8f5a", "#8a4fb0", "#c23b4a", "#2f8f9a", "#d69a2a"],
  SKIN: ["#f1c7a0", "#d9a47a", "#a9744f", "#7a4f35", "#ffe0c4"],
  CANVAS: ["#f2e3c8", "#e9d2b0", "#f6ead6"],
} as const;

// ---------------------------------------------------------------- randomness & noise

/** FNV-1a over `text`: the seed a zone's or an agent's randomness grows from. */
export function hashOf(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A seeded generator of [0, 1): mulberry32. */
export type Random = () => number;

export function randomOf(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random item of `items`. */
export function pickOf<T>(random: Random, items: readonly [T, ...T[]]): T {
  return items[Math.floor(random() * items.length) % items.length] ?? items[0];
}

function lattice(i: number, j: number, k: number): number {
  let hash = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1103515245);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const mix = MathUtils.lerp;
  const near = mix(
    mix(lattice(i, j, k), lattice(i + 1, j, k), u),
    mix(lattice(i, j + 1, k), lattice(i + 1, j + 1, k), u),
    v,
  );
  const far = mix(
    mix(lattice(i, j, k + 1), lattice(i + 1, j, k + 1), u),
    mix(lattice(i, j + 1, k + 1), lattice(i + 1, j + 1, k + 1), u),
    v,
  );
  return mix(near, far, w);
}

/** Fractal value noise: `octaves` of it, each finer and fainter. */
export function fbm(x: number, y: number, z: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, z * frequency);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// ---------------------------------------------------------------- geometry helpers

const scratchColor = new Color();
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchEuler = new Euler();
const scratchScale = new Vector3();
const scratchPosition = new Vector3();

/**
 * A geometry unindexed and painted one colour, `k` times as bright, with a
 * `glow` attribute of `glow` times that colour: zero for a solid part, and
 * the light it gives for one that glows.
 */
export function tint(geometry: BufferGeometry, hex: string, k = 1, glow = 0): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
  }
  if (flat.getAttribute("normal") === undefined) flat.computeVertexNormals();
  const count = flat.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const glows = new Float32Array(count * 3);
  scratchColor.set(hex);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = scratchColor.r * k;
    colors[index * 3 + 1] = scratchColor.g * k;
    colors[index * 3 + 2] = scratchColor.b * k;
    glows[index * 3] = scratchColor.r * glow;
    glows[index * 3 + 1] = scratchColor.g * glow;
    glows[index * 3 + 2] = scratchColor.b * glow;
  }
  flat.setAttribute("color", new BufferAttribute(colors, 3));
  flat.setAttribute("glow", new BufferAttribute(glows, 3));
  return flat;
}

/** Moves, turns, and scales a geometry in place, and hands it back. */
export function xf(
  geometry: BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): BufferGeometry {
  scratchEuler.set(rx, ry, rz);
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchMatrix.compose(
    scratchPosition.set(x, y, z),
    scratchQuaternion,
    scratchScale.set(sx, sy, sz),
  );
  return geometry.applyMatrix4(scratchMatrix);
}

export const box = (w: number, h: number, d: number, hex: string, k = 1): BufferGeometry =>
  tint(new BoxGeometry(w, h, d), hex, k);
export const cylinder = (
  top: number,
  bottom: number,
  h: number,
  segments: number,
  hex: string,
  k = 1,
): BufferGeometry => tint(new CylinderGeometry(top, bottom, h, segments), hex, k);
const cone = (r: number, h: number, segments: number, hex: string, k = 1): BufferGeometry =>
  tint(new ConeGeometry(r, h, segments), hex, k);
const ico = (r: number, hex: string, detail = 0): BufferGeometry =>
  tint(new IcosahedronGeometry(r, detail), hex);
export const sphere = (r: number, ws: number, hs: number, hex: string, k = 1): BufferGeometry =>
  tint(new SphereGeometry(r, ws, hs), hex, k);

/** A part that gives light: a window or a lamp, dim by day and lit by its own glow. */
export const lit = (geometry: BufferGeometry, hex: string, glow = 1.3): BufferGeometry =>
  tint(geometry, hex, 0.45, glow);
export const windowPane = (w: number, h: number, d: number): BufferGeometry =>
  lit(new BoxGeometry(w, h, d), PALETTE.WINDOW);

/** A triangular prism, a gable roof: `w` wide, `h` high, `d` deep. */
export function prism(w: number, h: number, d: number, hex: string): BufferGeometry {
  const a = w / 2;
  const b = d / 2;
  const corners = {
    A: [-a, 0, -b],
    B: [-a, 0, b],
    C: [-a, h, 0],
    D: [a, 0, -b],
    E: [a, 0, b],
    F: [a, h, 0],
  } as const;
  const { A, B, C, D, E, F } = corners;
  const triangles = [A, B, C, D, F, E, B, E, F, B, F, C, A, C, F, A, F, D];
  const geometry = new Geometry();
  geometry.setAttribute("position", new Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return tint(geometry, hex);
}

/** A rod from `from` to `to`. */
export function beam(
  from: Vector3,
  to: Vector3,
  radius: number,
  hex: string,
  k = 1,
  segments = 5,
): BufferGeometry {
  const direction = new Vector3().subVectors(to, from);
  const geometry = tint(new CylinderGeometry(radius, radius, direction.length(), segments), hex, k);
  scratchQuaternion.setFromUnitVectors(UP, direction.normalize());
  return geometry.applyMatrix4(
    scratchMatrix.compose(
      new Vector3().addVectors(from, to).multiplyScalar(0.5),
      scratchQuaternion,
      scratchScale.set(1, 1, 1),
    ),
  );
}

/** Every geometry merged into one, or none for none. */
export function merged(geometries: readonly BufferGeometry[]): BufferGeometry | null {
  if (geometries.length === 0) return null;
  const geometry = mergeGeometries([...geometries], false);
  for (const part of geometries) part.dispose();
  return geometry;
}

/** One merged geometry, which must exist: a prefab's parts, never none. */
export function mergedSome(geometries: readonly BufferGeometry[]): BufferGeometry {
  const geometry = merged(geometries);
  if (geometry === null) throw new Error("a prefab merged no parts");
  return geometry;
}

// ---------------------------------------------------------------- prefabs

/**
 * One prop: the parts that take the sun, the ones that glow, where its
 * chimneys smoke, and the hub of a windmill's sails, each in its own frame
 * with its foot at the origin.
 */
export interface Prefab {
  readonly solid: BufferGeometry[];
  readonly glow?: BufferGeometry[];
  readonly smoke?: readonly (readonly [number, number, number])[];
  readonly hub?: readonly [number, number, number];
}

export function house(random: Random): Prefab {
  const w = 0.9 + random() * 0.5;
  const h = 0.7 + random() * 0.35;
  const d = 0.8 + random() * 0.4;
  const solid = [
    xf(box(w, h, d, pickOf(random, PALETTE.WALL)), 0, h / 2, 0),
    xf(prism(w + 0.22, 0.5 + random() * 0.3, d + 0.24, pickOf(random, PALETTE.ROOF)), 0, h, 0),
    xf(box(0.22, 0.38, 0.04, PALETTE.WOOD_DARK), 0, 0.19, d / 2 + 0.01),
  ];
  const glow = [
    xf(windowPane(0.17, 0.19, 0.03), -w * 0.28, h * 0.6, d / 2 + 0.012),
    xf(windowPane(0.17, 0.19, 0.03), w * 0.28, h * 0.6, d / 2 + 0.012),
    xf(windowPane(0.03, 0.19, 0.17), w / 2 + 0.012, h * 0.6, 0),
  ];
  if (random() >= 0.45) return { solid, glow };
  solid.push(xf(box(0.16, 0.55, 0.16, PALETTE.STONE_DARK), w * 0.25, h + 0.4, -d * 0.18));
  return { solid, glow, smoke: [[w * 0.25, h + 0.75, -d * 0.18]] };
}

export function windmill(random: Random): Prefab {
  const h = 2.0 + random() * 0.9;
  return {
    solid: [
      xf(cylinder(0.34, 0.58, h, 8, pickOf(random, PALETTE.WALL)), 0, h / 2, 0),
      xf(cone(0.52, 0.75, 8, pickOf(random, PALETTE.ROOF)), 0, h + 0.37, 0),
      xf(box(0.24, 0.42, 0.06, PALETTE.WOOD_DARK), 0, 0.21, 0.55),
    ],
    glow: [xf(windowPane(0.14, 0.2, 0.05), 0, h * 0.62, 0.43)],
    hub: [0, h - 0.05, 0.5],
  };
}

export function workshop(random: Random): Prefab {
  return {
    solid: [
      xf(box(1.8, 1.0, 1.25, PALETTE.STONE_2), 0, 0.5, 0),
      xf(prism(2.05, 0.65, 1.5, pickOf(random, PALETTE.ROOF)), 0, 1.0, 0),
      xf(cylinder(0.13, 0.17, 1.0, 6, PALETTE.STONE_DARK), 0.55, 1.4, -0.25),
      xf(cylinder(0.11, 0.14, 0.8, 6, PALETTE.STONE_DARK), -0.5, 1.3, -0.3),
    ],
    glow: [
      xf(windowPane(0.5, 0.28, 0.03), -0.45, 0.55, 0.63),
      xf(windowPane(0.5, 0.28, 0.03), 0.45, 0.55, 0.63),
      xf(lit(new BoxGeometry(0.36, 0.42, 0.03), "#ffb070", 1.4), 0, 0.21, 0.64),
    ],
    smoke: [
      [0.55, 1.95, -0.25],
      [-0.5, 1.75, -0.3],
    ],
  };
}

export function tower(random: Random, h: number, roofHex?: string): Prefab {
  const radius = 0.5 + random() * 0.25;
  const roof = roofHex ?? pickOf(random, PALETTE.TOWER_ROOF);
  const wall = pickOf(random, PALETTE.WALL);
  const top = h + 0.78 + radius * 2.4;
  const solid = [
    xf(cylinder(radius * 0.94, radius, h, 10, wall), 0, h / 2, 0),
    xf(cylinder(radius * 1.18, radius * 1.18, 0.16, 10, PALETTE.STONE_DARK), 0, h, 0),
    xf(cylinder(radius * 1.06, radius * 1.06, 0.7, 10, wall), 0, h + 0.43, 0),
    xf(cone(radius * 1.38, radius * 2.4, 10, roof), 0, h + 0.78 + radius * 1.2, 0),
    xf(cylinder(0.02, 0.02, 0.7, 4, PALETTE.WOOD_DARK), 0, top + 0.3, 0),
    xf(box(0.4, 0.22, 0.015, roof), 0.2, top + 0.52, 0),
  ];
  const glow: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + 0.4;
    glow.push(
      xf(
        windowPane(0.13, 0.24, 0.05),
        Math.cos(a) * radius * 1.06,
        h + 0.45,
        Math.sin(a) * radius * 1.06,
        0,
        -a + Math.PI / 2,
      ),
    );
  }
  for (let y = 0.8; y < h - 0.3; y += 1.1) {
    const a = random() * TAU;
    glow.push(
      xf(
        windowPane(0.08, 0.2, 0.05),
        Math.cos(a) * radius * 0.97,
        y,
        Math.sin(a) * radius * 0.97,
        0,
        -a + Math.PI / 2,
      ),
    );
  }
  return { solid, glow };
}

export function lighthouse(h: number): Prefab {
  const solid: BufferGeometry[] = [];
  const segments = 4;
  for (let i = 0; i < segments; i += 1) {
    const r0 = MathUtils.lerp(0.62, 0.36, i / segments);
    const r1 = MathUtils.lerp(0.62, 0.36, (i + 1) / segments);
    solid.push(
      xf(
        cylinder(r1, r0, h / segments, 12, i % 2 === 1 ? "#c9473c" : "#f6efe4"),
        0,
        (h / segments) * (i + 0.5),
        0,
      ),
    );
  }
  solid.push(
    xf(cylinder(0.66, 0.66, 0.08, 12, PALETTE.IRON), 0, h + 0.04, 0),
    xf(cone(0.5, 0.55, 10, "#c9473c"), 0, h + 0.85, 0),
  );
  return {
    solid,
    glow: [xf(lit(new CylinderGeometry(0.36, 0.36, 0.5, 8), "#fff2c8", 3), 0, h + 0.33, 0)],
  };
}

export function dock(length: number): Prefab {
  const solid = [xf(box(length, 0.09, 1.1, PALETTE.WOOD), length / 2, 0, 0)];
  for (let x = 0.3; x < length; x += 0.9) {
    for (const z of [-0.5, 0.5]) {
      solid.push(xf(cylinder(0.055, 0.055, 1.4, 5, PALETTE.WOOD_DARK), x, -0.55, z));
    }
  }
  solid.push(
    xf(box(length, 0.05, 0.05, PALETTE.WOOD_DARK), length / 2, 0.42, 0.52),
    xf(box(length, 0.05, 0.05, PALETTE.WOOD_DARK), length / 2, 0.42, -0.52),
    xf(cylinder(0.04, 0.04, 1.0, 5, PALETTE.IRON), length - 0.1, 0.5, 0.5),
    xf(cylinder(0.04, 0.04, 1.0, 5, PALETTE.IRON), length - 0.1, 0.5, -0.5),
  );
  return {
    solid,
    glow: [
      xf(lit(new SphereGeometry(0.11, 8, 6), PALETTE.LAMP, 2.2), length - 0.1, 1.05, 0.5),
      xf(lit(new SphereGeometry(0.11, 8, 6), PALETTE.LAMP, 2.2), length - 0.1, 1.05, -0.5),
    ],
  };
}

export function column(random: Random, h: number, broken: boolean): Prefab {
  const solid = [
    xf(box(0.62, 0.16, 0.62, PALETTE.STONE_2), 0, 0.08, 0),
    xf(cylinder(0.21, 0.24, h, 9, PALETTE.STONE), 0, 0.16 + h / 2, 0),
    xf(
      cylinder(0.245, 0.245, Math.min(0.5, h * 0.3), 9, PALETTE.MOSS),
      0,
      0.16 + Math.min(0.25, h * 0.15),
      0,
    ),
  ];
  if (!broken) solid.push(xf(box(0.58, 0.15, 0.58, PALETTE.STONE_2), 0, 0.16 + h + 0.07, 0));
  else
    solid.push(
      xf(
        cylinder(0.21, 0.21, 0.9, 9, PALETTE.STONE),
        0.55,
        0.22,
        0.2,
        0,
        random() * 3,
        Math.PI / 2,
      ),
    );
  return { solid };
}

export function arch(random: Random, w: number, h: number): Prefab {
  return {
    solid: [
      ...column(random, h, false).solid.map((part) => xf(part, -w / 2, 0, 0)),
      ...column(random, h, false).solid.map((part) => xf(part, w / 2, 0, 0)),
      xf(box(w + 0.8, 0.32, 0.6, PALETTE.STONE_2), 0, h + 0.4, 0),
    ],
  };
}

export function ziggurat(size: number, levels: number): Prefab {
  const solid: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  let y = 0;
  for (let i = 0; i < levels; i += 1) {
    const w = size * (1 - i * 0.2);
    const h = 0.75;
    solid.push(xf(box(w, h, w, i % 2 === 1 ? PALETTE.STONE_2 : PALETTE.STONE), 0, y + h / 2, 0));
    glow.push(
      xf(lit(new BoxGeometry(w + 0.02, 0.05, w + 0.02), PALETTE.CREAM, 1.6), 0, y + h * 0.75, 0),
    );
    y += h;
  }
  solid.push(
    xf(
      box(size * 0.22, levels * 0.75, size * 0.55, PALETTE.STONE_2),
      0,
      levels * 0.375,
      size * 0.48,
    ),
  );
  glow.push(
    xf(lit(new OctahedronGeometry(0.55), PALETTE.CREAM, 2.4), 0, y + 1.0, 0, 0, 0.5, 0, 1, 1.5, 1),
  );
  return { solid, glow };
}

export function obelisk(h: number): Prefab {
  return {
    solid: [
      xf(box(0.7, 0.2, 0.7, PALETTE.STONE_2), 0, 0.1, 0),
      xf(cylinder(0.1, 0.3, h, 4, PALETTE.STONE_DARK), 0, 0.2 + h / 2, 0, 0, Math.PI / 4),
    ],
    glow: [
      xf(
        lit(new ConeGeometry(0.12, 0.3, 4), PALETTE.CREAM, 2.4),
        0,
        0.2 + h + 0.15,
        0,
        0,
        Math.PI / 4,
      ),
    ],
  };
}

export function portal(radius: number): Prefab {
  const pane = () => lit(new SphereGeometry(radius * 0.86, 24, 2, 0, TAU, 0, 0.0001), "#efe4ff", 1);
  return {
    solid: [
      xf(tint(new TorusGeometry(radius, 0.28, 6, 22), PALETTE.STONE), 0, radius + 0.3, 0),
      xf(box(radius * 2.6, 0.3, 0.9, PALETTE.STONE_2), 0, 0.15, 0),
    ],
    glow: [
      xf(pane(), 0, radius + 0.3, 0, Math.PI / 2),
      xf(pane(), 0, radius + 0.3, 0, -Math.PI / 2),
    ],
  };
}

export function vault(): Prefab {
  return {
    solid: [
      xf(cylinder(1.1, 1.2, 1.1, 14, PALETTE.STONE_2), 0, 0.55, 0),
      xf(tint(new SphereGeometry(1.1, 14, 7, 0, TAU, 0, Math.PI / 2), "#b8a27a"), 0, 1.1, 0),
      xf(box(0.5, 0.7, 0.1, PALETTE.IRON), 0, 0.35, 1.15),
    ],
    glow: [
      xf(lit(new BoxGeometry(0.12, 0.12, 0.04), PALETTE.CREAM, 1.6), 0, 0.45, 1.21),
      xf(lit(new TorusGeometry(1.15, 0.03, 4, 28), PALETTE.CREAM, 1.4), 0, 1.1, 0, Math.PI / 2),
    ],
  };
}

export function tent(random: Random): Prefab {
  return {
    solid: [
      xf(cone(0.65, 0.9, 6, pickOf(random, PALETTE.TENT)), 0, 0.45, 0),
      xf(cylinder(0.02, 0.02, 0.4, 4, PALETTE.WOOD_DARK), 0, 1.0, 0),
      xf(box(0.2, 0.12, 0.01, "#fff3dd"), 0.1, 1.15, 0),
    ],
    glow: [xf(lit(new SphereGeometry(0.07, 6, 4), "#ffc070", 2.4), 0, 0.15, 0.62)],
  };
}

export function antenna(h: number): Prefab {
  return {
    solid: [
      xf(cylinder(0.05, 0.14, h, 5, PALETTE.IRON), 0, h / 2, 0),
      xf(cylinder(0.5, 0.5, 0.05, 8, PALETTE.IRON), 0, h * 0.6, 0),
      xf(cylinder(0.35, 0.35, 0.05, 8, PALETTE.IRON), 0, h * 0.8, 0),
    ],
    glow: [xf(lit(new SphereGeometry(0.12, 8, 6), "#fff0d8", 1.6), 0, h + 0.1, 0)],
  };
}

export function crane(): Prefab {
  return {
    solid: [
      xf(box(0.18, 4.2, 0.18, PALETTE.WOOD), 0, 2.1, 0),
      xf(box(3.2, 0.14, 0.14, PALETTE.WOOD), 0.9, 4.1, 0),
      xf(box(0.6, 0.4, 0.6, PALETTE.STONE_DARK), -0.6, 3.95, 0),
      xf(cylinder(0.015, 0.015, 2.0, 3, PALETTE.IRON), 2.3, 3.05, 0),
      xf(box(0.45, 0.35, 0.45, PALETTE.WOOD), 2.3, 1.9, 0),
    ],
  };
}

export function silo(random: Random): Prefab {
  return {
    solid: [
      xf(cylinder(0.55, 0.55, 1.8, 10, pickOf(random, PALETTE.WALL)), 0, 0.9, 0),
      xf(cone(0.7, 0.7, 10, pickOf(random, PALETTE.ROOF)), 0, 2.15, 0),
    ],
  };
}

export function monolith(random: Random): Prefab {
  return {
    solid: [xf(box(0.7, 1.6 + random() * 1.5, 0.35, PALETTE.STONE_DARK), 0, 0.8, 0, 0.08, 0, 0.12)],
  };
}

export const TREE = {
  ROUND: "round",
  PINE: "pine",
  BLOSSOM: "blossom",
  AUTUMN: "autumn",
} as const;

export type TreeKind = (typeof TREE)[keyof typeof TREE];

export function tree(random: Random, kind: TreeKind): Prefab {
  if (kind === TREE.PINE) {
    return {
      solid: [
        xf(cylinder(0.05, 0.08, 0.5, 5, PALETTE.WOOD_DARK), 0, 0.25, 0),
        xf(cone(0.42, 1.0, 7, pickOf(random, PALETTE.PINE)), 0, 0.85, 0),
        xf(cone(0.3, 0.7, 7, pickOf(random, PALETTE.PINE)), 0, 1.3, 0),
      ],
    };
  }
  const leaves =
    kind === TREE.BLOSSOM ? PALETTE.BLOSSOM : kind === TREE.AUTUMN ? PALETTE.AUTUMN : PALETTE.LEAF;
  const leaf = pickOf<string>(random, leaves);
  const solid = [
    xf(cylinder(0.05, 0.085, 0.55, 5, PALETTE.WOOD_DARK), 0, 0.27, 0),
    xf(ico(0.42 + random() * 0.18, leaf), 0, 0.82, 0, random(), random(), 0, 1, 0.92, 1),
  ];
  if (random() < 0.5) solid.push(xf(ico(0.26, leaf), 0.22, 1.08, 0.1, random(), random(), 0));
  return { solid };
}

export function flag(hex: string, h = 1.4): Prefab {
  return {
    solid: [
      xf(cylinder(0.025, 0.025, h, 4, PALETTE.WOOD_DARK), 0, h / 2, 0),
      xf(box(0.6, 0.34, 0.015, hex), 0.3, h - 0.2, 0),
    ],
  };
}

/** A small moored airship, as the docks hold and the builders' sky docks float. */
export function airshipHull(canvas: string): BufferGeometry {
  return mergedSome([
    xf(sphere(1, 14, 10, canvas), 0, 0, 0, 0, 0, 0, 1.1, 0.42, 0.42),
    xf(box(0.34, 0.28, 0.02, "#c9553e"), -1.0, 0.18, 0),
    xf(box(0.34, 0.02, 0.28, "#c9553e"), -1.0, 0, 0),
    xf(box(0.5, 0.16, 0.22, PALETTE.WOOD), 0, -0.52, 0),
    beam(new Vector3(-0.2, -0.44, 0), new Vector3(-0.3, -0.25, 0), 0.01, PALETTE.WOOD_DARK, 1, 3),
    beam(new Vector3(0.2, -0.44, 0), new Vector3(0.3, -0.25, 0), 0.01, PALETTE.WOOD_DARK, 1, 3),
    xf(lit(new SphereGeometry(0.07, 8, 6), PALETTE.LAMP, 2.4), 0.25, -0.62, 0),
  ]);
}

/** A windmill's four sails about their hub, turning on z. */
export function sails(): BufferGeometry {
  const parts = [xf(cylinder(0.08, 0.08, 0.2, 6, PALETTE.WOOD_DARK), 0, 0, 0, Math.PI / 2)];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU;
    parts.push(
      xf(
        box(0.05, 1.25, 0.03, PALETTE.WOOD_DARK),
        Math.cos(a) * 0.62,
        Math.sin(a) * 0.62,
        0,
        0,
        0,
        a - Math.PI / 2,
      ),
      xf(
        box(0.26, 1.0, 0.02, "#f1e4cc"),
        Math.cos(a) * 0.68 + Math.cos(a + Math.PI / 2) * 0.15,
        Math.sin(a) * 0.68 + Math.sin(a + Math.PI / 2) * 0.15,
        0.02,
        0,
        0,
        a - Math.PI / 2,
      ),
    );
  }
  return mergedSome(parts);
}
