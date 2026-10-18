import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Euler,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  type ShaderMaterial,
  Vector3,
} from "three";
import {
  type Building,
  drawBuilding,
  SPINNER,
  type Spinner,
  type SpinnerKind,
  type Spot,
  spinnerGeometryOf,
} from "./buildings";
import {
  ACCENT,
  clamp,
  col,
  fbm,
  Geo,
  GLOW,
  lerp,
  PADS,
  PAL,
  PRIM,
  partGeo,
  rngOf,
  shade,
  smooth,
} from "./geo";
import { DECOR, type DecorBlock, type Layout, type Lot, ROAD } from "./layout";

/**
 * yard.ts -- everything in the Factory that stands still for as long as its zones do: the land, the roads and lots, every building, the dressing of empty blocks, the street lamps, the railway, and the picking volumes and highlight overlays each lot is drawn with.
 *
 * A yard is built from a layout once, when the zones change, and torn down
 * whole when they change again: every static prop is welded into four
 * geometries (the land, the flat paint, the solid props, and what glows),
 * every building into one more tagged by zone, and everything there are
 * many of (trees, lamps, spinners) is one instanced mesh each. What moves
 * on it, its spinners, turbines, flares, train, and clouds, is listed for
 * the world's frame to turn.
 */

/** What puffs from a chimney or a cooling tower. */
export const PUFF = {
  SMOKE: "smoke",
  STEAM: "steam",
} as const;

type Puff = (typeof PUFF)[keyof typeof PUFF];

/** A source of smoke or steam, in scene coordinates. */
interface Emitter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly puff: Puff;
  /** Puffs a second. */
  readonly rate: number;
  readonly size: number;
  /** Puffs owed, carried between frames. */
  owed: number;
}

/** A turning part placed in the scene, with its own phase. */
interface PlacedSpinner extends Spinner {
  readonly phase: number;
}

/** One kind of spinner across the yard: the instanced mesh, and where each instance stands. */
interface SpinnerSet {
  readonly mesh: InstancedMesh;
  readonly placed: readonly PlacedSpinner[];
}

/** The materials a yard shares with the rest of the world, made once in `create`. */
export interface YardMaterials {
  /** Vertex-coloured, flat-shaded: every static prop. */
  readonly solid: Material;
  /** The solid material with the building shader's zone highlight and dimming. */
  readonly building: Material;
  /** Vertex-coloured, unlit, overdriven: windows, signs, a furnace's mouth. */
  readonly glow: Material;
  /** A lamp's head, brighter at night. */
  readonly lampHead: Material;
  /** A lamp's pool of light on the road, only at night. */
  readonly lampPool: Material;
  /** A flare stack's flame. */
  readonly flare: Material;
  /** The lot highlight's floor and its walls. */
  readonly highlightFloor: ShaderMaterial;
  readonly highlightWalls: ShaderMaterial;
  /** Never drawn: what the pointer is cast against. */
  readonly invisible: Material;
}

/** A built yard. */
export interface Yard {
  /** Everything the yard drew; removing it and disposing what is under it takes the yard down. */
  readonly group: Group;
  readonly layout: Layout;
  /** Each lot's building, by lot index. */
  readonly buildings: readonly Building[];
  /** Each lot's lamp slots, in scene coordinates, the front's middle first. */
  readonly lampSlots: readonly (readonly Spot[])[];
  readonly emitters: readonly Emitter[];
  readonly spinners: readonly SpinnerSet[];
  readonly turbines: SpinnerSet;
  readonly flares: { readonly mesh: InstancedMesh; readonly spots: readonly Spot[] };
  readonly train: Mesh;
  readonly railZ: number;
  readonly clouds: Mesh;
  /** One box over each lot's building, and one slab over each whole lot: the zone's picking volumes, by lot index. */
  readonly pickBuildings: InstancedMesh;
  readonly pickLots: InstancedMesh;
  /** The lot highlight's floor and walls, an instance per lit lot, set on each update. */
  readonly highlightFloor: InstancedMesh;
  readonly highlightWalls: InstancedMesh;
}

const placing = {
  matrix: new Matrix4(),
  quaternion: new Quaternion(),
  euler: new Euler(),
  position: new Vector3(),
  scale: new Vector3(),
} as const;

function compose(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
): Matrix4 {
  placing.euler.set(0, ry, 0);
  placing.quaternion.setFromEuler(placing.euler);
  return placing.matrix.compose(
    placing.position.set(x, y, z),
    placing.quaternion,
    placing.scale.set(sx, sy, sz),
  );
}

/** How far outside the yard `x`, `z` stands, past a margin. */
function outside(layout: Layout, x: number, z: number, margin: number): number {
  const dx = Math.max(layout.x0 - margin - x, 0, x - layout.x1 - margin);
  const dz = Math.max(layout.z0 - margin - z, 0, z - layout.z1 - margin);
  return Math.hypot(dx, dz);
}

/** The land's height at `x`, `z`: flat at the yard, rolling into hills beyond it. */
function groundHeight(layout: Layout, x: number, z: number): number {
  const k = layout.span / 200;
  const out = outside(layout, x, z, 14);
  if (out <= 0) return -0.25;
  const n = fbm(x * 0.012, z * 0.012);
  const hill = smooth(clamp((out - 90 * k) / (380 * k), 0, 1));
  return hill * (n * 70 + fbm(x * 0.004 + 9, z * 0.004) * 90) * Math.sqrt(k) - 0.25;
}

function terrain(layout: Layout, material: Material): Mesh {
  const size = layout.span * 13;
  const geometry = new PlaneGeometry(size, size, 180, 180).rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const grass = new Color(PAL.ground);
  const dark = new Color(PAL.grassDark);
  const straw = new Color("#c2b27f");
  const verge = new Color("#b9ad8f");
  const tint = new Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    position.setY(index, groundHeight(layout, x, z));
    const n = fbm(x * 0.012, z * 0.012);
    tint
      .copy(grass)
      .lerp(dark, clamp(n * 1.3 - 0.2, 0, 1))
      .lerp(straw, clamp((fbm(x * 0.03 + 3, z * 0.03) - 0.55) * 2.5, 0, 0.6));
    if (outside(layout, x, z, 14) < 10) tint.lerp(verge, 0.5);
    colors.set([tint.r, tint.g, tint.b], index * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The yard slab, the road grid with its markings, the highway out of the gate, and each lot's pad. */
function paint(flat: Geo, layout: Layout): void {
  const { xr, zr, n, x0, x1, z0, z1, gateX } = layout;
  flat.box(0, -0.2, 0, x1 - x0 + 20, 0.22, z1 - z0 + 20, "#a9a190");
  for (let index = 0; index <= n; index += 1) {
    flat.box(xr[index] ?? 0, 0, 0, ROAD, 0.06, z1 - z0, PAL.asphalt);
    flat.box(0, 0.005, zr[index] ?? 0, x1 - x0, 0.06, ROAD, PAL.asphalt);
  }
  const nearCrossing = (t: number, lines: readonly number[]) =>
    lines.some((line) => Math.abs(t - line) < ROAD / 2 + 1.2);
  for (const x of xr) {
    for (let t = z0; t < z1; t += 4.2) {
      if (!nearCrossing(t, zr)) flat.box(x, 0.065, t, 0.18, 0.02, 1.8, PAL.line);
    }
  }
  for (const z of zr) {
    for (let t = x0; t < x1; t += 4.2) {
      if (!nearCrossing(t, xr)) flat.box(t, 0.065, z, 1.8, 0.02, 0.18, PAL.line);
    }
  }
  for (const x of xr) {
    for (const z of zr) {
      for (const s of [-1, 1]) {
        flat.box(x + s * (ROAD / 2 + 0.4), 0.07, z - s * 1.6, 0.35, 0.02, 3.2, "#e8e2d2");
        flat.box(x + s * 1.6, 0.07, z + s * (ROAD / 2 + 0.4), 3.2, 0.02, 0.35, "#e8e2d2");
      }
    }
  }
  const highway = layout.span * 7;
  flat.box(gateX, -0.02, z1 + highway / 2, 10, 0.06, highway, PAL.asphalt);
  for (let t = z1 + 6; t < z1 + highway; t += 5)
    flat.box(gateX, 0.045, t, 0.2, 0.02, 2.4, PAL.hazard);
  for (const s of [-1, 1])
    flat.box(gateX + s * 5.4, 0, z1 + highway / 2, 0.5, 0.1, highway, "#d9d3c4");
  for (const lot of layout.lots) lotPad(flat, lot);
}

function lotPad(flat: Geo, lot: Lot): void {
  const { W, D, cx, cz } = lot;
  const accent = ACCENT[lot.zone.layer];
  flat.box(cx, 0, cz, W, 0.24, D, PADS[lot.zone.layer]);
  const kerbs = [
    [cx, lot.z0 + 0.15, W, 0.3],
    [cx, lot.z1 - 0.15, W, 0.3],
    [lot.x0 + 0.15, cz, 0.3, D],
    [lot.x1 - 0.15, cz, 0.3, D],
  ] as const;
  for (const [x, z, w, d] of kerbs) flat.box(x, 0.24, z, w, 0.1, d, shade(accent, 0.95));
  const corners = [
    [lot.x0, lot.z0],
    [lot.x1, lot.z0],
    [lot.x0, lot.z1],
    [lot.x1, lot.z1],
  ] as const;
  for (const [x, z] of corners) {
    for (let k = 0; k < 3; k += 1) {
      const hx = x + Math.sign(cx - x) * (0.6 + k * 0.7);
      flat.box(
        hx,
        0.25,
        z + Math.sign(cz - z) * 0.15,
        0.35,
        0.11,
        0.3,
        k % 2 ? PAL.dark : PAL.hazard,
      );
    }
  }
}

/** The perimeter fence with its gate, gatehouse, and booms. */
function fence(solid: Geo, glow: Geo, layout: Layout): void {
  const margin = 3.2;
  const fx0 = layout.x0 - margin;
  const fx1 = layout.x1 + margin;
  const fz0 = layout.z0 - margin;
  const fz1 = layout.z1 + margin;
  const gateX = layout.gateX;
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const length = Math.hypot(bx - ax, bz - az);
    const posts = Math.ceil(length / 3.2);
    for (let index = 0; index <= posts; index += 1) {
      const t = index / posts;
      solid.box(lerp(ax, bx, t), 0, lerp(az, bz, t), 0.14, 2.3, 0.14, "#6f7884");
    }
    for (const y of [0.6, 1.4, 2.15]) solid.beam(ax, y, az, bx, y, bz, 0.06, "#8d96a3");
  };
  run(fx0, fz0, fx1, fz0);
  run(fx0, fz0, fx0, fz1);
  run(fx1, fz0, fx1, fz1);
  run(fx0, fz1, gateX - 7, fz1);
  run(gateX + 7, fz1, fx1, fz1);
  solid.box(gateX + 9.5, 0, fz1 + 1.5, 3.2, 2.8, 2.6, PAL.wall);
  solid.box(gateX + 9.5, 2.8, fz1 + 1.5, 3.8, 0.3, 3.2, ACCENT.surface);
  glow.box(gateX + 9.5, 1.3, fz1 + 2.82, 2.2, 0.8, 0.05, GLOW.warm);
  for (const s of [-1, 1]) {
    solid.box(gateX + s * 6.5, 0, fz1, 0.6, 1.1, 0.6, PAL.hazard);
    for (let k = 0; k < 6; k += 1) {
      solid.box(gateX + s * 6.5, 1.1 + k * 0.7, fz1, 0.2, 0.7, 0.2, k % 2 ? "#ffffff" : PAL.red);
    }
  }
}

function parkedTruck(g: Geo, x: number, z: number, facing: number, rng: () => number): void {
  const paints = ["#e8e4dc", "#c4513a", "#2f6fa8", "#2e8a7b", "#e0a031"];
  const body = paints[Math.floor(rng() * paints.length)] ?? PAL.wall;
  g.box(x, 0.18, z - facing * 0.8, 2.2, 2.5, 5, body);
  g.box(x, 0.18, z + facing * 2.6, 2.1, 2.2, 1.7, "#f1eee6");
  g.box(x, 1.4, z + facing * 3.46, 1.8, 0.7, 0.04, "#3a4658");
}

/** What dressing a block collects beside its welded props. */
interface Dressing {
  readonly solid: Geo;
  readonly flat: Geo;
  readonly emitters: Emitter[];
  readonly turbines: PlacedSpinner[];
  readonly trees: { x: number; z: number; s: number }[];
}

/** Dresses one empty block. */
function dress(block: DecorBlock, into: Dressing, rng: () => number): void {
  const { solid: g, flat } = into;
  const { cx, cz, W, D } = block;
  flat.box(cx, 0, cz, W - 1, 0.18, D - 1, "#bdb5a2");
  switch (block.decor) {
    case DECOR.COOLING:
      for (const [dx, dz, s] of [
        [-0.22, -0.1, 1],
        [0.24, 0.12, 0.85],
      ] as const) {
        const r = Math.min(W, D) * 0.2 * s;
        const h = r * 2.6;
        g.add(PRIM.hyper, "#e2ddd2", cx + dx * W, 0.18, cz + dz * D, r, h, r);
        g.cyl(cx + dx * W, 0.18 + h * 0.82, cz + dz * D, r * 0.66, 0.4, "#c9553e", 24);
        into.emitters.push({
          x: cx + dx * W,
          y: h + 1,
          z: cz + dz * D,
          puff: PUFF.STEAM,
          rate: 2.2,
          size: r * 0.6,
          owed: rng(),
        });
      }
      g.box(cx + W * 0.25, 0.18, cz - D * 0.28, 5, 3.5, 3.5, PAL.wall);
      g.box(cx + W * 0.25, 3.68, cz - D * 0.28, 5.4, 0.25, 3.9, ACCENT.core);
      return;
    case DECOR.TANKFARM: {
      for (let index = 0; index < 6; index += 1) {
        const x = cx - W * 0.3 + (index % 3) * W * 0.3;
        const z = cz - D * 0.2 + Math.floor(index / 3) * D * 0.4;
        const r = 1.6 + rng() * 0.9;
        const h = 3 + rng() * 3;
        g.cyl(x, 0.18, z, r + 0.4, 0.4, PAL.concreteDark, 16);
        g.cyl(x, 0.18, z, r, h, index % 2 ? "#e6e3dc" : "#d9dfe5", 16);
        g.dome(x, 0.18 + h, z, r, 0.5, "#c5ccd4");
        g.cyl(x, 0.18 + h * 0.6, z, r * 1.01, 0.4, ACCENT.core, 16);
      }
      const wx = cx + W * 0.36;
      const wz = cz + D * 0.36;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        g.beam(
          wx + a * 1.6,
          0.18,
          wz + b * 1.6,
          wx + a * 0.9,
          9,
          wz + b * 0.9,
          0.22,
          PAL.steelDark,
        );
      }
      g.cyl(wx, 9, wz, 2.0, 2.6, "#7fa7c4", 16);
      g.cone(wx, 11.6, wz, 2.1, 1.0, "#6a8fab", 16);
      return;
    }
    case DECOR.ORE: {
      const ores = ["#b46b3f", "#6f7f93", "#3d3a38", "#c9a35a"];
      ores.forEach((ore, index) => {
        const x = cx - W * 0.28 + (index % 2) * W * 0.5;
        const z = cz - D * 0.22 + Math.floor(index / 2) * D * 0.45;
        const r = Math.min(W, D) * 0.17;
        g.add(PRIM.cone8, ore, x, 0.18 + r * 0.45, z, r, r * 0.9, r, 0, rng(), 0);
        g.add(
          PRIM.ico,
          shade(ore, 0.85),
          x + r * 0.4,
          0.4,
          z + r * 0.3,
          r * 0.35,
          r * 0.25,
          r * 0.35,
        );
      });
      g.beam(cx - W * 0.4, 0.5, cz, cx + W * 0.1, 5, cz, 0.6, PAL.hazard);
      g.box(cx + W * 0.1, 0.18, cz, 0.6, 5, 0.6, PAL.steelDark);
      const ex = cx + W * 0.3;
      const ez = cz + D * 0.05;
      g.box(ex, 0.18, ez, 2.6, 0.6, 3.2, PAL.iron);
      g.box(ex, 0.8, ez, 2.4, 1.4, 2.4, PAL.hazard);
      g.box(ex - 0.6, 2.2, ez + 0.5, 1.0, 1.1, 1.0, "#3a4658");
      g.beam(ex + 0.6, 1.8, ez + 0.8, ex + 0.6, 4.2, ez + 3.2, 0.4, PAL.hazard);
      g.beam(ex + 0.6, 4.2, ez + 3.2, ex + 0.6, 1.0, ez + 4.6, 0.32, PAL.hazard);
      g.box(ex + 0.6, 0.5, ez + 4.8, 1.2, 0.7, 0.8, PAL.iron);
      return;
    }
    case DECOR.SOLAR:
      for (let row = 0; row < Math.floor((D - 3) / 3.2); row += 1) {
        for (let k = 0; k < Math.floor((W - 3) / 2.6); k += 1) {
          const x = cx - W / 2 + 2.6 + k * 2.6;
          const z = cz - D / 2 + 2.8 + row * 3.2;
          g.box(x, 0.18, z, 0.15, 0.9, 0.15, PAL.steelDark);
          g.rbox(x, 1.15, z, 2.4, 0.08, 2.0, "#2c4a7a", -0.5);
          g.rbox(x, 1.19, z, 2.2, 0.02, 1.8, "#3f6ab0", -0.5);
        }
      }
      return;
    case DECOR.CONTAINERS: {
      const paints = ["#c4513a", "#2f6fa8", "#2e8a7b", "#e0a031", "#6b5ea8", "#d9d4c8", "#8a4a3a"];
      for (let row = 0; row < Math.floor((D - 4) / 3.1); row += 1) {
        for (let k = 0; k < Math.floor((W - 3) / 6.6); k += 1) {
          const stack = 1 + Math.floor(rng() * 3.2);
          for (let s = 0; s < stack; s += 1) {
            const x = cx - W / 2 + 4.6 + k * 6.6;
            const z = cz - D / 2 + 3 + row * 3.1;
            const box = paints[Math.floor(rng() * paints.length)] ?? PAL.wall;
            g.box(x, 0.18 + s * 2.6, z, 6.1, 2.5, 2.45, box);
            for (let q = -2; q <= 2; q += 1)
              g.box(x + q * 1.2, 0.18 + s * 2.6 + 0.1, z + 1.24, 0.12, 2.3, 0.04, shade(box, 0.8));
          }
        }
      }
      const gx = cx + W * 0.05;
      for (const s of [-1, 1]) {
        const x = gx + s * (W / 2 - 1.5);
        g.box(x, 0.18, cz - D * 0.4, 0.5, 10, 0.5, "#2f7fd0");
        g.box(x, 0.18, cz + D * 0.4, 0.5, 10, 0.5, "#2f7fd0");
        g.box(x, 10, cz, 0.6, 0.6, D * 0.85, "#2f7fd0");
      }
      g.box(gx, 10.2, cz, W - 2.4, 0.8, 0.8, "#2f7fd0");
      return;
    }
    case DECOR.PARKING:
    case DECOR.DEPOT:
      for (let row = 0; row < 2; row += 1) {
        for (let k = 0; k < Math.floor((W - 2) / 3.2); k += 1) {
          const x = cx - W / 2 + 2.4 + k * 3.2;
          const z = cz - D * 0.22 + row * D * 0.44;
          flat.box(x - 1.6, 0.19, z, 0.12, 0.02, 7.2, "#f0eadb");
          if (rng() < 0.7) parkedTruck(g, x, z, row ? 1 : -1, rng);
        }
      }
      if (block.decor === DECOR.DEPOT) {
        g.box(cx, 0.18, cz - D * 0.42, W * 0.7, 0.3, 2.0, PAL.concreteDark);
        for (const s of [-1, 1]) g.box(cx + s * W * 0.33, 0.18, cz, 0.5, 6.5, 0.5, PAL.steelDark);
        g.box(cx, 6.6, cz, W * 0.75, 0.4, D * 0.2, ACCENT.surface);
      }
      return;
    case DECOR.WIND:
      for (const [dx, dz] of [
        [-0.2, -0.2],
        [0.22, 0.18],
      ] as const) {
        const x = cx + dx * W;
        const z = cz + dz * D;
        const h = 22;
        g.add(PRIM.frustum, "#f2f2ef", x, 0.18 + h / 2, z, 0.55, h, 0.55);
        g.box(x, h, z - 0.5, 1.0, 1.0, 2.2, "#f2f2ef");
        into.turbines.push({
          kind: SPINNER.FAN,
          x,
          y: h + 0.5,
          z: z + 0.75,
          scale: 1,
          speed: 1.1 + rng() * 0.4,
          swing: false,
          phase: rng() * 6,
        });
      }
      return;
    case DECOR.PARK:
    case DECOR.WATERTOWER:
      if (block.decor === DECOR.WATERTOWER) {
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const) {
          g.beam(
            cx + a * 2.2,
            0.18,
            cz + b * 2.2,
            cx + a * 1.3,
            13,
            cz + b * 1.3,
            0.26,
            PAL.steelDark,
          );
        }
        g.add(PRIM.sph2, "#e9e5dc", cx, 15, cz, 3.2, 2.6, 3.2);
        g.cyl(cx, 13.5, cz, 3.25, 0.5, ACCENT.surface, 24);
      } else {
        flat.box(cx + W * 0.1, 0.2, cz + D * 0.05, W * 0.45, 0.04, D * 0.35, "#5f9fb8");
      }
      for (let index = 0; index < 14; index += 1) {
        into.trees.push({
          x: cx + (rng() - 0.5) * (W - 4),
          z: cz + (rng() - 0.5) * (D - 4),
          s: 0.8 + rng() * 0.5,
        });
      }
      return;
  }
}

/** The woods round the yard: pines and round canopies, instanced. */
function woods(
  group: Group,
  layout: Layout,
  spots: { x: number; z: number; s: number }[],
  material: Material,
) {
  const rng = rngOf("trees");
  const reach = layout.span * 4.5;
  let planted = 0;
  for (let tries = 0; planted < 900 && tries < 20000; tries += 1) {
    const x = (rng() - 0.5) * reach;
    const z = (rng() - 0.5) * reach;
    const out = outside(layout, x, z, 10);
    if (out < 4) continue;
    if (Math.abs(x - layout.gateX) < 14 && z > layout.z1) continue;
    if (Math.abs(z - (layout.z0 - 22)) < 7) continue;
    if (fbm(x * 0.02, z * 0.02) < 0.42 && out > 30) continue;
    spots.push({ x, z, s: 0.8 + rng() * 0.9 + Math.min(out / 300, 0.6) });
    planted += 1;
  }
  const pine = partGeo((g) => {
    g.cyl(0, 0, 0, 0.22, 1.2, "#7a5a3c", 6);
    g.cone(0, 1.0, 0, 1.3, 2.2, "#ffffff", 7);
    g.cone(0, 2.3, 0, 0.95, 1.9, "#ffffff", 7);
  });
  const round = partGeo((g) => {
    g.cyl(0, 0, 0, 0.22, 1.4, "#7a5a3c", 6);
    g.add(PRIM.ico, "#ffffff", 0, 2.3, 0, 1.4, 1.25, 1.4);
  });
  const greens = ["#5f8f4e", "#6e9b55", "#4f7f4a", "#7ea35c", "#8aa865", "#c99a4a", "#5b8a63"];
  const tint = rngOf("treecols");
  for (const [geometry, parity] of [
    [pine, 0],
    [round, 1],
  ] as const) {
    const mine = spots.filter((_, index) => index % 2 === parity);
    const mesh = new InstancedMesh(geometry, material, Math.max(1, mine.length));
    mesh.count = mine.length;
    mine.forEach((spot, index) => {
      const y =
        outside(layout, spot.x, spot.z, 14) > 0 ? groundHeight(layout, spot.x, spot.z) : 0.2;
      mesh.setMatrixAt(
        index,
        compose(spot.x, y, spot.z, spot.s, spot.s * (0.85 + tint() * 0.4), spot.s, tint() * 6),
      );
      mesh.setColorAt(index, col(greens[Math.floor(tint() * greens.length)] ?? PAL.ground));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** A street lamp at every crossing's corner: post, head, and the pool of light under it at night. */
function streetLamps(group: Group, layout: Layout, materials: YardMaterials): void {
  const spots: { x: number; z: number }[] = [];
  for (const x of layout.xr)
    for (const z of layout.zr) spots.push({ x: x + ROAD / 2 + 0.6, z: z + ROAD / 2 + 0.6 });
  const post = partGeo((g) => {
    g.box(0, 0, 0, 0.18, 6.2, 0.18, "#59616d");
    g.box(-0.6, 6.1, 0, 1.4, 0.14, 0.18, "#59616d");
    g.box(-1.2, 5.95, 0, 0.6, 0.18, 0.35, "#3e444d");
  });
  const posts = new InstancedMesh(post, materials.solid, spots.length);
  const heads = new InstancedMesh(
    new BoxGeometry(0.5, 0.08, 0.3),
    materials.lampHead,
    spots.length,
  );
  const pools = new InstancedMesh(
    new PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
    materials.lampPool,
    spots.length,
  );
  const turn = -Math.PI / 4;
  spots.forEach(({ x, z }, index) => {
    posts.setMatrixAt(index, compose(x, 0.2, z, 1, 1, 1, turn));
    const hx = x - Math.cos(Math.PI / 4) * 1.2;
    const hz = z - Math.sin(Math.PI / 4) * 1.2;
    heads.setMatrixAt(index, compose(hx, 6.08, hz, 1, 1, 1, turn));
    pools.setMatrixAt(index, compose(hx, 0.32, hz, 1, 1, 1));
  });
  pools.renderOrder = 4;
  group.add(posts, heads, pools);
}

/** The railway along the north edge, and the freight train that runs it. */
function railway(solid: Geo, railZ: number, span: number, material: Material): Mesh {
  const length = span * 8;
  solid.box(0, -0.1, railZ, length, 0.35, 5.2, "#8e8577");
  for (let x = -length / 2; x < length / 2; x += 1.2)
    solid.box(x, 0.2, railZ, 0.35, 0.12, 3.6, "#6b5440");
  for (const s of [-0.9, 0.9]) solid.box(0, 0.32, railZ + s, length, 0.14, 0.14, "#9aa1a8");
  const train = new Geo();
  train.box(0, 0.4, 0, 9, 0.5, 2.6, PAL.iron);
  train.box(-0.5, 0.9, 0, 7, 2.4, 2.4, "#d24a33");
  train.box(2.8, 0.9, 0, 2.2, 3.3, 2.5, "#d24a33");
  train.box(3.9, 2.6, 0, 0.06, 0.9, 2.0, "#3a4658");
  train.box(-0.5, 3.3, 0, 6.6, 0.25, 2.0, "#9aa1a8");
  train.box(0, 3.3, 0, 1.2, 0.5, 1.2, PAL.iron);
  for (let car = 1; car <= 14; car += 1) {
    const x = -car * 9.2;
    train.box(x, 0.4, 0, 8.6, 0.5, 2.6, PAL.iron);
    train.add(PRIM.frustum, "#4a4f58", x, 2.2, 0, 1.0, 2.6, 1.0);
    train.box(x, 0.9, 0, 8.2, 2.4, 2.6, "#7b5b45");
    for (let rib = -3; rib <= 3; rib += 1)
      train.box(x + rib * 1.2, 0.9, 1.32, 0.12, 2.4, 0.06, "#5f4535");
    train.add(PRIM.ico, "#3d3a38", x, 3.3, 0, 3.4, 0.5, 1.1);
  }
  return new Mesh(train.build(), material);
}

/** Two walls round a unit square, `height` tall, their uv's v running up them; drawn round a lot at its own width and depth. */
function wallsGeometry(height: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const sides = [
    [-0.5, 0.5, 0.5, 0.5],
    [0.5, -0.5, -0.5, -0.5],
    [0.5, 0.5, 0.5, -0.5],
    [-0.5, -0.5, -0.5, 0.5],
  ] as const;
  for (const [ax, az, bx, bz] of sides) {
    positions.push(ax, 0, az, bx, 0, bz, bx, height, bz, ax, 0, az, bx, height, bz, ax, height, az);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  return geometry;
}

/** Builds the yard `layout` plans, with `materials`. */
export function yardOf(layout: Layout, materials: YardMaterials): Yard {
  const group = new Group();
  const flat = new Geo();
  const solid = new Geo();
  const glow = new Geo();
  const building = new Geo();
  const buildingGlow = new Geo();
  const emitters: Emitter[] = [];
  const turbines: PlacedSpinner[] = [];
  const trees: { x: number; z: number; s: number }[] = [];
  const placedSpinners = new Map<SpinnerKind, PlacedSpinner[]>();
  const flareSpots: Spot[] = [];

  group.add(terrain(layout, materials.solid));
  paint(flat, layout);
  fence(solid, glow, layout);
  const decorRng = rngOf("decor");
  for (const block of layout.decor)
    dress(block, { solid, flat, emitters, turbines, trees }, decorRng);

  const lampSlots: Spot[][] = [];
  const buildings = layout.lots.map((lot) => {
    building.zone = lot.index;
    buildingGlow.zone = lot.index;
    building.origin.set(lot.bx, 0.24, lot.bz);
    buildingGlow.origin.set(lot.bx, 0.24, lot.bz);
    const drawn = drawBuilding(building, buildingGlow, lot.plan, lot.zone.path, lot.zone.layer);
    const world = (spot: Spot): Spot => ({
      x: lot.bx + spot.x,
      y: 0.24 + spot.y,
      z: lot.bz + spot.z,
    });
    const middle = (drawn.lamps.length - 1) / 2;
    lampSlots.push(
      drawn.lamps
        .map((spot, index) => ({ spot, index }))
        .sort((left, right) => Math.abs(left.index - middle) - Math.abs(right.index - middle))
        .map(({ spot }) => world(spot)),
    );
    const rng = rngOf(lot.zone.path);
    for (const vent of drawn.chimneys) {
      emitters.push({
        ...world(vent),
        puff: PUFF.SMOKE,
        rate: 1.6,
        size: 1.3 + vent.size,
        owed: rng(),
      });
    }
    for (const vent of drawn.steam) {
      emitters.push({ ...world(vent), puff: PUFF.STEAM, rate: 1.2, size: vent.size, owed: rng() });
    }
    for (const spinner of drawn.spinners) {
      const list = placedSpinners.get(spinner.kind) ?? [];
      list.push({ ...spinner, ...world(spinner), phase: rng() * 6 });
      placedSpinners.set(spinner.kind, list);
    }
    for (const flare of drawn.flares) flareSpots.push(world(flare));
    return drawn;
  });
  const railZ = layout.z0 - 22;
  const train = railway(solid, railZ, layout.span, materials.solid);

  const welded = (geo: Geo, material: Material, cast: boolean, tagged = false) => {
    const mesh = new Mesh(geo.build(tagged), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  welded(flat, materials.solid, false);
  welded(solid, materials.solid, true);
  welded(building, materials.building, true, true);
  welded(glow, materials.glow, false).receiveShadow = false;
  welded(buildingGlow, materials.glow, false).receiveShadow = false;
  train.castShadow = true;
  train.position.set(-layout.span * 4, 0.38, railZ);
  group.add(train);

  const spinners = [...placedSpinners].map(([kind, placed]) => {
    const mesh = new InstancedMesh(spinnerGeometryOf(kind), materials.solid, placed.length);
    group.add(mesh);
    return { mesh, placed };
  });
  const rotor = partGeo((g) => {
    g.sph(0, 0, 0, 0.45, "#e6e6e2");
    for (let blade = 0; blade < 3; blade += 1) {
      const a = (blade * Math.PI * 2) / 3;
      g.rbox(Math.sin(a) * 4.5, Math.cos(a) * 4.5, 0, 0.6, 9, 0.12, "#f7f7f4", 0, 0, -a);
    }
  });
  const turbineMesh = new InstancedMesh(rotor, materials.solid, Math.max(1, turbines.length));
  turbineMesh.count = turbines.length;
  turbineMesh.visible = turbines.length > 0;
  turbineMesh.castShadow = true;
  group.add(turbineMesh);
  const flareMesh = new InstancedMesh(
    new ConeGeometry(0.55, 2.6, 7),
    materials.flare,
    Math.max(1, flareSpots.length),
  );
  flareMesh.count = flareSpots.length;
  flareMesh.visible = flareSpots.length > 0;
  flareSpots.forEach((spot, index) => {
    flareMesh.setMatrixAt(index, compose(spot.x, spot.y + 1.1, spot.z, 1, 1, 1));
  });
  group.add(flareMesh);

  woods(group, layout, trees, materials.solid);
  streetLamps(group, layout, materials);

  const clouds = new Geo();
  const cloudRng = rngOf("clouds");
  for (let cloud = 0; cloud < 7; cloud += 1) {
    const ox = (cloudRng() - 0.5) * layout.span * 2.5;
    const oz = (cloudRng() - 0.5) * layout.span * 2;
    for (let puff = 0; puff < 6; puff += 1) {
      clouds.sph(
        ox + (cloudRng() - 0.5) * 40,
        (cloudRng() - 0.5) * 4,
        oz + (cloudRng() - 0.5) * 22,
        9 + cloudRng() * 8,
        "#ffffff",
      );
    }
  }
  const cloudMesh = new Mesh(
    clouds.build(),
    new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  cloudMesh.castShadow = true;
  cloudMesh.position.y = 120;
  group.add(cloudMesh);

  const pickBuildings = new InstancedMesh(
    new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    materials.invisible,
    Math.max(1, layout.lots.length),
  );
  const pickLots = new InstancedMesh(
    new BoxGeometry(1, 0.6, 1).translate(0, 0.3, 0),
    materials.invisible,
    Math.max(1, layout.lots.length),
  );
  pickBuildings.count = layout.lots.length;
  pickLots.count = layout.lots.length;
  layout.lots.forEach((lot, index) => {
    const drawn = buildings[index];
    if (drawn === undefined) return;
    pickBuildings.setMatrixAt(
      index,
      compose(
        lot.bx + lot.plan.eastX / 2,
        0.24,
        lot.bz,
        drawn.w + lot.plan.eastX,
        drawn.top,
        drawn.d,
      ),
    );
    pickLots.setMatrixAt(index, compose(lot.cx, 0, lot.cz, lot.W, 1, lot.D));
  });
  group.add(pickBuildings, pickLots);

  const highlightFloor = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    materials.highlightFloor,
    Math.max(1, layout.lots.length),
  );
  const highlightWalls = new InstancedMesh(
    wallsGeometry(6),
    materials.highlightWalls,
    Math.max(1, layout.lots.length),
  );
  for (const mesh of [highlightFloor, highlightWalls]) {
    mesh.count = 0;
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new Color(0, 0, 0));
    group.add(mesh);
  }

  return {
    group,
    layout,
    buildings,
    lampSlots,
    emitters,
    spinners,
    turbines: { mesh: turbineMesh, placed: turbines },
    flares: { mesh: flareMesh, spots: flareSpots },
    train,
    railZ,
    clouds: cloudMesh,
    pickBuildings,
    pickLots,
    highlightFloor,
    highlightWalls,
  };
}

/** Turns every spinner, turbine, and flare to `time` seconds in; at zero, each stands at its phase. */
export function turnYard(yard: Yard, time: number): void {
  for (const set of [...yard.spinners, yard.turbines]) {
    set.placed.forEach((spinner, index) => {
      const angle = spinner.swing
        ? Math.sin(time * spinner.speed + spinner.phase) * 1.2
        : spinner.phase + time * spinner.speed;
      if (set === yard.turbines) {
        placing.euler.set(0, 0, angle);
      } else {
        placing.euler.set(0, angle, 0);
      }
      placing.quaternion.setFromEuler(placing.euler);
      placing.matrix.compose(
        placing.position.set(spinner.x, spinner.y, spinner.z),
        placing.quaternion,
        placing.scale.setScalar(spinner.scale),
      );
      set.mesh.setMatrixAt(index, placing.matrix);
    });
    set.mesh.instanceMatrix.needsUpdate = true;
  }
  const flicker = (index: number) => 0.85 + Math.sin(time * 17 + index * 1.7) * 0.1;
  yard.flares.spots.forEach((spot, index) => {
    const k = time === 0 ? 1 : flicker(index);
    yard.flares.mesh.setMatrixAt(
      index,
      compose(spot.x, spot.y + 1.1, spot.z, k, 0.9 + 0.35 * flicker(index + 3), k),
    );
  });
  yard.flares.mesh.instanceMatrix.needsUpdate = true;
}
