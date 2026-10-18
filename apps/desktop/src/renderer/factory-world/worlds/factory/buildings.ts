import { ZONE_LAYER, type ZoneLayer } from "@luke/ui/factory-world";
import type { BufferGeometry } from "three";
import {
  ACCENT,
  type Geo,
  GLOW,
  hashOf,
  PAL,
  type Paint,
  PRIM,
  partGeo,
  rngOf,
  shade,
} from "./geo";

/**
 * buildings.ts -- the Factory's buildings: one low-poly archetype per kind of zone, welded where it stands.
 *
 * A zone's layer picks the family of its building, and its path the one it
 * gets, so the same repository builds the same factory every time without
 * naming a directory of it: the core is heavy industry (silos, tank farms, a
 * refinery, a smelter), the domain sawtooth-roofed processing halls with a
 * rooftop extra each, the surface vaulted warehouses and the shopfronts a
 * developer meets, and tooling workshops under a gantry. A building's size
 * is its zone's footprint.
 *
 * A building draws about its own centre into the yard's shared welders (the
 * solid one and the one that glows), tagged with its zone's index, and
 * answers what moves or lights on it, in its own coordinates: the slots its
 * shipped work's lamps hang in, its chimneys and steam vents, its spinners,
 * and its flare stacks.
 */

/** The buildings a zone may get. */
const ARCH = {
  HALL: "hall",
  WAREHOUSE: "warehouse",
  SILOS: "silos",
  REFINERY: "refinery",
  SMELTER: "smelter",
  TANKS: "tanks",
  SPHERES: "spheres",
  MAST: "mast",
  STOREFRONT: "storefront",
  TOWER: "tower",
  WORKSHOP: "workshop",
  PAINTSHOP: "paintshop",
  BILLBOARD: "billboard",
  SHOWROOM: "showroom",
} as const;

type Arch = (typeof ARCH)[keyof typeof ARCH];

/** What a processing hall carries on its roof or beside it. */
const EXTRA = {
  DISH: "dish",
  VAULT: "vault",
  ANTENNA: "antenna",
  FANS: "fans",
  DOME: "dome",
  ARM: "arm",
  PIPES: "pipes",
  TANKS: "tanks",
  NONE: "none",
} as const;

type Extra = (typeof EXTRA)[keyof typeof EXTRA];

/** Each layer's buildings, one picked per zone by its path; a name twice is twice as likely. */
const FAMILY = {
  [ZONE_LAYER.CORE]: [ARCH.SILOS, ARCH.TANKS, ARCH.SPHERES, ARCH.MAST, ARCH.REFINERY, ARCH.SMELTER],
  [ZONE_LAYER.DOMAIN]: [ARCH.HALL],
  [ZONE_LAYER.SURFACE]: [
    ARCH.WAREHOUSE,
    ARCH.WAREHOUSE,
    ARCH.WAREHOUSE,
    ARCH.STOREFRONT,
    ARCH.SHOWROOM,
    ARCH.PAINTSHOP,
    ARCH.BILLBOARD,
    ARCH.TOWER,
  ],
  [ZONE_LAYER.TOOLING]: [ARCH.WORKSHOP, ARCH.WORKSHOP, ARCH.HALL],
} as const satisfies Record<ZoneLayer, readonly Arch[]>;

const HALL_EXTRAS = [
  EXTRA.DISH,
  EXTRA.VAULT,
  EXTRA.ANTENNA,
  EXTRA.FANS,
  EXTRA.DOME,
  EXTRA.ARM,
  EXTRA.PIPES,
  EXTRA.TANKS,
] as const;

/** The geometries a building's moving parts share, each drawn as one instanced mesh across the yard. */
export const SPINNER = {
  FAN: "fan",
  DISH: "dish",
  RADAR: "radar",
  ARM: "arm",
} as const;

export type SpinnerKind = (typeof SPINNER)[keyof typeof SPINNER];

/** A moving part: what it is, where it stands, how large, and how it turns. */
export interface Spinner {
  readonly kind: SpinnerKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  /** Radians a second; a swinging part's rate of swing. */
  readonly speed: number;
  /** Swings to and fro rather than turning round. */
  readonly swing: boolean;
}

/** A point on a building, in its own coordinates. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A chimney's or a vent's mouth, and how wide it puffs. */
interface Vent extends Spot {
  readonly size: number;
}

/** What a building answers once drawn, in its own coordinates. */
export interface Building {
  readonly arch: Arch;
  readonly w: number;
  readonly d: number;
  /** Its highest point above its plinth. */
  readonly top: number;
  /** Room it takes beyond its walls: an annex east, tanks behind, a forecourt in front. */
  readonly eastX: number;
  readonly backX: number;
  readonly frontX: number;
  readonly lamps: readonly Spot[];
  readonly chimneys: readonly Vent[];
  readonly steam: readonly Vent[];
  readonly spinners: readonly Spinner[];
  readonly flares: readonly Spot[];
}

/** A building's outline before it is drawn: its walls and the room around them. */
export interface BuildingPlan {
  readonly arch: Arch;
  readonly extra: Extra;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly eastX: number;
  readonly backX: number;
  readonly frontX: number;
}

/** What a building draws into, and what it collects while it does. */
interface Draft {
  readonly g: Geo;
  readonly gl: Geo;
  readonly accent: string;
  readonly rng: () => number;
  readonly lamps: Spot[];
  readonly chimneys: Vent[];
  readonly steam: Vent[];
  readonly spinners: Spinner[];
  readonly flares: Spot[];
  top: number;
}

function plinth(o: Draft, w: number, d: number): void {
  o.g.box(0, 0, 0, w + 0.9, 0.4, d + 0.9, PAL.concreteDark);
}

function lampRow(
  o: Draft,
  from: number,
  to: number,
  y: number,
  at: number,
  step: number,
  alongZ = false,
) {
  for (let t = from; t <= to + 1e-6; t += step) {
    o.lamps.push(alongZ ? { x: at, y, z: t } : { x: t, y, z: at });
  }
}

function chimney(o: Draft, x: number, z: number, r: number, height: number, band: Paint = PAL.red) {
  const g = o.g;
  g.cyl(x, 0, z, r * 1.25, 1.2, PAL.concreteDark, 12);
  g.cyl(x, 0, z, r, height, "#ddd6c8", 12);
  g.cyl(x, height - 1.0, z, r * 1.05, 0.55, band, 12);
  g.cyl(x, height - 2.3, z, r * 1.05, 0.55, band, 12);
  g.cyl(x, height, z, r * 1.12, 0.3, PAL.iron, 12);
  o.chimneys.push({ x, y: height + 0.4, z, size: r });
}

function vent(g: Geo, x: number, y: number, z: number, s = 1): void {
  g.box(x, y, z, 1.1 * s, 0.5 * s, 1.1 * s, PAL.steel);
  g.cyl(x, y + 0.5 * s, z, 0.42 * s, 0.25 * s, PAL.steelDark, 8);
}

function dish(o: Draft, x: number, y: number, z: number, r: number, speed: number): void {
  o.g.cyl(x, y, z, r * 0.18, r * 0.8, PAL.steelDark, 8);
  o.spinners.push({ kind: SPINNER.DISH, x, y: y + r * 0.85, z, scale: r, speed, swing: false });
}

function doors(o: Draft, w: number, d: number, count: number, dh: number): void {
  const g = o.g;
  const paint = "#5a6271";
  for (let index = 0; index < count; index += 1) {
    const x = -w / 2 + (w * (index + 0.5)) / count;
    g.box(x, 0.4, d / 2 + 0.02, 2.3, dh, 0.12, paint);
    for (let k = 1; k < 5; k += 1) {
      g.box(x, 0.4 + (dh * k) / 5, d / 2 + 0.09, 2.3, 0.05, 0.04, shade(paint, 0.8));
    }
    g.box(x, 0.4 + dh, d / 2 + 0.05, 2.7, 0.26, 0.14, PAL.hazard);
    o.gl.box(x, 0.4 + dh + 0.42, d / 2 + 0.14, 0.55, 0.16, 0.06, GLOW.warm);
  }
}

/** A sawtooth-roofed processing hall, with its extra on the roof or beside it. */
function hall(o: Draft, w: number, d: number, h: number, extra: Extra): void {
  const { g, gl, accent: ac, rng } = o;
  const roof = shade(ac, 0.8);
  plinth(o, w, d);
  g.box(0, 0.4, 0, w, h - 0.4, d, PAL.wall);
  g.box(0, 0.4, 0, w + 0.05, 0.9, d + 0.05, PAL.wallShade);
  g.box(0, h - 1.05, 0, w + 0.12, 0.8, d + 0.12, ac);
  g.box(0, h, 0, w + 0.22, 0.2, d + 0.22, shade(PAL.wall, 0.92));
  const pilasters = Math.floor(w / 3);
  for (let index = 0; index <= pilasters; index += 1) {
    g.box(-w / 2 + (w * index) / pilasters, 0.4, d / 2 + 0.06, 0.35, h - 1.4, 0.14, PAL.wallShade);
  }
  const teeth = Math.max(2, Math.round(d / 4.2));
  const td = d / teeth;
  const th = Math.min(2.5, td * 0.6);
  for (let index = 0; index < teeth; index += 1) {
    const zc = -d / 2 + td * (index + 0.5);
    g.add(PRIM.prism, roof, 0, h + 0.2, zc, w - 0.7, th, td);
    gl.box(0, h + 0.2 + th * 0.1, zc + td / 2 + 0.02, (w - 0.7) * 0.94, th * 0.72, 0.06, GLOW.sky);
  }
  o.top = h + 0.2 + th;
  doors(o, w, d, Math.max(1, Math.floor(w / 6)), Math.min(h * 0.5, 3.4));
  const windows = Math.max(2, Math.floor(d / 1.9));
  for (let index = 0; index < windows; index += 1) {
    const zc = -d / 2 + (d * (index + 0.5)) / windows;
    const tall = Math.min(1.0, h * 0.16);
    gl.box(w / 2 + 0.03, h * 0.5, zc, 0.06, tall, (d / windows) * 0.6, GLOW.warm);
    gl.box(-w / 2 - 0.03, h * 0.5, zc, 0.06, tall, (d / windows) * 0.6, GLOW.warm);
  }
  chimney(o, -w / 2 + 1.3, -d / 2 + 1.3, 0.7, h + 4 + rng() * 3);
  if (w > 9) chimney(o, -w / 2 + 3.2, -d / 2 + 1.3, 0.55, h + 2.5 + rng() * 2, ac);
  // Note that the annex and its pipes stand east of the walls, in the room the plan's eastX keeps.
  const aw = Math.min(3.2, w * 0.25);
  const ad = d * 0.45;
  const ah = h * 0.55;
  g.box(w / 2 + aw / 2 + 0.2, 0.4, -d / 2 + ad / 2 + 0.6, aw, ah, ad, PAL.wallShade);
  g.box(w / 2 + aw / 2 + 0.2, 0.4 + ah, -d / 2 + ad / 2 + 0.6, aw + 0.2, 0.2, ad + 0.2, roof);
  g.pipe(
    w / 2,
    ah * 0.8,
    -d / 2 + 1.0,
    w / 2 + aw + 0.2,
    ah * 0.8,
    -d / 2 + 1.0,
    0.18,
    PAL.steelDark,
  );
  lampRow(o, -w / 2 + 0.8, w / 2 - 0.8, h - 0.65, d / 2 + 0.22, 0.95);
  lampRow(o, -d / 2 + 0.8, d / 2 - 0.8, h - 0.65, w / 2 + 0.22, 0.95, true);
  const vents = Math.max(1, Math.floor(w / 4.5));
  for (let index = 0; index < vents; index += 1) {
    vent(g, -w / 2 + 1.5 + index * 4.2, o.top - 0.3, -d / 2 + 0.6 + rng() * 0.5, 0.8);
  }
  hallExtra(o, w, d, h, extra);
}

function hallExtra(o: Draft, w: number, d: number, h: number, extra: Extra): void {
  const { g, gl, accent: ac, rng } = o;
  switch (extra) {
    case EXTRA.DISH:
      dish(o, w * 0.18, o.top - 0.3, d * 0.1, 2.2, 0.25);
      return;
    case EXTRA.DOME:
      g.cyl(w * 0.15, o.top - 0.3, 0, 2.6, 0.6, PAL.steelDark, 16);
      gl.dome(w * 0.15, o.top + 0.3, 0, 2.4, 2.2, GLOW.teal);
      for (let index = 0; index < 6; index += 1) {
        g.rbox(w * 0.15, o.top + 1.3, 0, 0.12, 2.4, 4.9, PAL.iron, 0, (index * Math.PI) / 6, 0);
      }
      o.top += 2.5;
      return;
    case EXTRA.ANTENNA:
      for (let index = 0; index < 3; index += 1) {
        const x = -w * 0.2 + index * 1.6;
        g.add(PRIM.taper, PAL.steelDark, x, o.top + 2.5, d * 0.15, 0.35, 5.5, 0.35);
        gl.sph(x, o.top + 5.4, d * 0.15, 0.22, GLOW.teal);
      }
      return;
    case EXTRA.VAULT:
      g.add(
        PRIM.cyl24,
        PAL.steel,
        w * 0.3,
        h * 0.45,
        d / 2 + 0.25,
        h * 0.32,
        0.5,
        h * 0.32,
        Math.PI / 2,
      );
      g.add(
        PRIM.cyl16,
        PAL.steelDark,
        w * 0.3,
        h * 0.45,
        d / 2 + 0.55,
        h * 0.16,
        0.3,
        h * 0.16,
        Math.PI / 2,
      );
      for (let index = 0; index < 3; index += 1) {
        g.rbox(
          w * 0.3,
          h * 0.45,
          d / 2 + 0.72,
          h * 0.42,
          0.1,
          0.1,
          PAL.iron,
          0,
          0,
          (index * Math.PI) / 3,
        );
      }
      return;
    case EXTRA.TANKS:
      for (let index = 0; index < 3; index += 1) {
        const x = w / 2 + 2.2;
        const zz = d / 2 - 1.4 - index * 2.4;
        g.cyl(x, 0.4, zz, 1.0, h * 0.75, PAL.steel, 12);
        g.dome(x, 0.4 + h * 0.75, zz, 1.0, 0.5, PAL.steel);
        g.cyl(x, 0.4 + h * 0.5, zz, 1.03, 0.35, ac, 12);
      }
      return;
    case EXTRA.FANS:
      for (let index = 0; index < 3; index += 1) {
        const x = -w / 2 + (w * (index + 0.5)) / 3;
        g.cyl(x, o.top - 0.4, d * 0.05, 1.1, 0.9, PAL.steel, 12);
        o.spinners.push({
          kind: SPINNER.FAN,
          x,
          y: o.top + 0.55,
          z: d * 0.05,
          scale: 1,
          speed: 4 + rng() * 2,
          swing: false,
        });
      }
      return;
    case EXTRA.ARM:
      o.spinners.push({
        kind: SPINNER.ARM,
        x: w * 0.2,
        y: o.top - 0.3,
        z: 0,
        scale: 1,
        speed: 0.6,
        swing: true,
      });
      return;
    case EXTRA.PIPES:
      for (let index = 0; index < 4; index += 1) {
        const y = 1.2 + index * 0.6;
        const z = -d / 2 + 1 + index * 0.5;
        g.pipe(-w / 2 - 0.5, y, z, -w / 2 - 0.5, y, d / 2 - 1, 0.22, index % 2 ? PAL.steel : ac);
      }
      return;
    case EXTRA.NONE:
      return;
  }
}

/** A vaulted shipping hall with loading docks along its front. */
function warehouse(o: Draft, w: number, d: number, h: number): void {
  const { g, gl, accent: ac, rng } = o;
  plinth(o, w, d);
  g.box(0, 0.4, 0, w, h - 0.4, d, PAL.wall);
  g.box(0, 0.4, 0, w + 0.05, 1.0, d + 0.05, PAL.wallShade);
  g.box(0, h - 0.7, 0, w + 0.1, 0.7, d + 0.1, ac);
  const rh = Math.min(d * 0.24, 3.4);
  g.add(PRIM.vault, "#9aa5b3", 0, h, 0, w + 0.5, rh, d / 2 + 0.25);
  g.add(PRIM.capPX, PAL.wallShade, w / 2 + 0.01, h, 0, 1, rh, d / 2);
  g.add(PRIM.capNX, PAL.wallShade, -w / 2 - 0.01, h, 0, 1, rh, d / 2);
  const ribs = Math.max(3, Math.floor(w / 2.6));
  for (let index = 0; index <= ribs; index += 1) {
    g.add(
      PRIM.vault,
      shade("#9aa5b3", 0.82),
      -w / 2 + (w * index) / ribs,
      h + 0.02,
      0,
      0.16,
      rh + 0.06,
      d / 2 + 0.3,
    );
  }
  for (let index = 0; index < ribs; index += 1) {
    gl.box(
      -w / 2 + (w * (index + 0.5)) / ribs,
      h + rh * 0.86,
      0,
      (w / ribs) * 0.5,
      0.18,
      1.1,
      GLOW.sky,
    );
  }
  o.top = h + rh;
  const docks = Math.max(2, Math.floor(w / 3.4));
  const dh = Math.min(3.0, h * 0.55);
  for (let index = 0; index < docks; index += 1) {
    const x = -w / 2 + (w * (index + 0.5)) / docks;
    g.box(x, 0.4, d / 2 + 0.02, 2.1, dh, 0.1, "#596170");
    for (let k = 1; k < 5; k += 1)
      g.box(x, 0.4 + (dh * k) / 5, d / 2 + 0.08, 2.1, 0.05, 0.04, "#4b525f");
    g.box(x, 0.0, d / 2 + 0.8, 2.6, 1.0, 1.6, PAL.concreteDark);
    g.box(x - 1.15, 0.3, d / 2 + 1.62, 0.25, 0.5, 0.08, PAL.dark);
    g.box(x + 1.15, 0.3, d / 2 + 1.62, 0.25, 0.5, 0.08, PAL.dark);
    g.box(x, 0.4 + dh + 0.2, d / 2 + 0.6, 2.6, 0.14, 1.3, ac);
    gl.box(
      x + 0.9,
      0.4 + dh + 0.05,
      d / 2 + 0.16,
      0.22,
      0.22,
      0.06,
      index % 3 === 0 ? GLOW.green : GLOW.warm,
    );
  }
  const front = Math.max(3, Math.floor(w / 1.6));
  for (let index = 0; index < front; index += 1) {
    gl.box(
      -w / 2 + (w * (index + 0.5)) / front,
      h - 1.45,
      d / 2 + 0.03,
      (w / front) * 0.6,
      0.55,
      0.06,
      GLOW.warm,
    );
  }
  const side = Math.max(2, Math.floor(d / 1.6));
  for (let index = 0; index < side; index += 1) {
    gl.box(
      w / 2 + 0.03,
      h - 1.45,
      -d / 2 + (d * (index + 0.5)) / side,
      0.06,
      0.55,
      (d / side) * 0.6,
      GLOW.warm,
    );
  }
  const ow = Math.min(4, w * 0.22);
  g.box(w / 2 + ow / 2 + 0.1, 0.4, d / 2 - 1.8, ow, h * 0.5, 3.2, PAL.wall);
  g.box(w / 2 + ow / 2 + 0.1, 0.4 + h * 0.5, d / 2 - 1.8, ow + 0.2, 0.2, 3.4, ac);
  gl.box(w / 2 + ow / 2 + 0.1, 0.4 + h * 0.25, d / 2 - 0.18, ow * 0.8, h * 0.18, 0.06, GLOW.cool);
  vent(g, -w * 0.3, h + rh * 0.55, 0, 0.9);
  vent(g, w * 0.25, h + rh * 0.55, 0, 0.9);
  lampRow(o, -w / 2 + 0.7, w / 2 - 0.7, h - 0.38, d / 2 + 0.2, 0.9);
  lampRow(o, -d / 2 + 0.7, d / 2 - 0.7, h - 0.38, w / 2 + 0.2, 0.9, true);
  if (rng() < 0.6) chimney(o, -w / 2 + 1.2, -d / 2 + 1.0, 0.45, h + rh + 2);
}

/** Four silos round an elevator tower: raw material in store. */
function silos(o: Draft, w: number, d: number, h: number): void {
  const { g, gl, accent: ac } = o;
  plinth(o, w, d);
  const r = Math.min(w, d) / 4.7;
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;
  let top = 0;
  corners.forEach(([sx, sz], index) => {
    const x = sx * (w / 4.3);
    const zz = sz * (d / 4.3);
    const hh = h * (0.82 + 0.1 * index);
    g.cyl(x, 0.4, zz, r, hh, "#d9dee4", 16);
    for (let y = 1.8; y < hh - 1; y += 1.8) g.cyl(x, 0.4 + y, zz, r * 1.015, 0.12, "#b7bec7", 16);
    g.cyl(x, 0.4 + hh * 0.72, zz, r * 1.02, 0.7, ac, 16);
    g.cone(x, 0.4 + hh, zz, r * 1.02, r * 0.55, "#a9b2bc", 16);
    g.cyl(x, 0.4 + hh + r * 0.55, zz, 0.3, 0.4, PAL.steelDark, 8);
    g.box(x + r * 0.98, 0.4, zz, 0.12, hh, 0.5, PAL.iron);
    const band = 0.4 + hh * 0.72 + 0.35;
    o.lamps.push(
      { x, y: band, z: zz + r + 0.05 },
      { x: x + r * 0.7, y: band, z: zz + r * 0.72 },
      { x: x - r * 0.7, y: band, z: zz + r * 0.72 },
    );
    top = Math.max(top, 0.4 + hh + r * 0.55);
  });
  const th = top + 2;
  g.box(0, 0.4, 0, 1.4, th, 1.4, ac);
  g.box(0, 0.4 + th, 0, 2.2, 1.4, 2.2, PAL.wall);
  gl.box(0, 0.4 + th + 0.55, 1.12, 1.6, 0.45, 0.06, GLOW.warm);
  g.box(0, 0.4 + th + 1.4, 0, 2.4, 0.2, 2.4, shade(ac, 0.8));
  for (const [sx, sz] of corners) {
    g.beam(0, th - 0.2, 0, sx * (w / 4.3), th - 1.8, sz * (d / 4.3), 0.3, PAL.steelDark);
  }
  o.top = 0.4 + th + 1.6;
  o.steam.push({ x: 0, y: o.top + 0.2, z: 0, size: 0.6 });
}

/** Distillation columns, spherical tanks, and a flare stack. */
function refinery(o: Draft, w: number, d: number, h: number): void {
  const { g, accent: ac } = o;
  plinth(o, w, d);
  const columns = [
    [-w * 0.3, -d * 0.22, 1.1, 1.0],
    [-w * 0.05, -d * 0.3, 0.85, 1.25],
    [w * 0.2, -d * 0.18, 1.0, 0.85],
    [-w * 0.18, d * 0.05, 0.7, 0.7],
  ] as const;
  for (const [x, zz, r, k] of columns) {
    const hh = h * k;
    g.cyl(x, 0.4, zz, r * 1.3, 0.8, PAL.concreteDark, 12);
    g.cyl(x, 0.4, zz, r, hh, "#e6e9ed", 12);
    g.dome(x, 0.4 + hh, zz, r, r * 0.6, "#d5dae0");
    for (let y = 2.5; y < hh - 0.5; y += 3.2) {
      g.cyl(x, 0.4 + y, zz, r + 0.55, 0.14, PAL.steelDark, 12);
      g.add(PRIM.ring, PAL.hazard, x, 0.4 + y + 0.75, zz, r + 0.55, 1, r + 0.55);
      o.lamps.push({ x, y: 0.4 + y + 0.4, z: zz + r + 0.6 });
    }
    g.cyl(x, 0.4 + hh * 0.6, zz, r * 1.02, 0.5, ac, 12);
    g.box(x + r + 0.15, 0.4, zz, 0.12, hh, 0.45, PAL.iron);
    o.top = Math.max(o.top, 0.4 + hh + r * 0.6);
  }
  const spheres = [
    [w * 0.28, d * 0.22, d * 0.17],
    [w * 0.05, d * 0.3, d * 0.13],
  ] as const;
  for (const [x, zz, r] of spheres) {
    for (let index = 0; index < 6; index += 1) {
      const a = (index / 6) * Math.PI * 2;
      g.box(
        x + Math.cos(a) * r * 0.8,
        0.4,
        zz + Math.sin(a) * r * 0.8,
        0.2,
        r * 1.1,
        0.2,
        PAL.steelDark,
      );
    }
    g.sph(x, 0.4 + r * 1.3, zz, r, "#eef0f2", true);
    g.cyl(x, 0.4 + r * 1.25, zz, r * 1.01, 0.3, ac, 16);
    o.lamps.push({ x, y: 0.4 + r * 1.3, z: zz + r + 0.05 });
  }
  g.add(PRIM.cyl16, "#dfe3e8", -w * 0.33, 1.8, d * 0.3, 1.0, w * 0.28, 1.0, 0, 0, Math.PI / 2);
  for (let index = 0; index < 3; index += 1) {
    g.box(-w * 0.33 + (index - 1) * w * 0.1, 0.4, d * 0.3, 0.3, 0.9, 1.6, PAL.steelDark);
  }
  for (let index = 0; index < 4; index += 1) {
    const y = 1.4 + index * 0.45;
    const z = -d * 0.05 + index * 0.3;
    g.pipe(-w / 2 + 0.5, y, z, w / 2 - 0.5, y, z, 0.16, index % 2 ? ac : PAL.steel);
  }
  for (let x = -w / 2 + 0.8; x < w / 2; x += 3) g.box(x, 0.4, 0.4, 0.2, 3.0, 1.8, PAL.iron);
  const fx = w / 2 - 1.0;
  const fz = -d / 2 + 1.0;
  const fh = h * 1.45;
  g.add(PRIM.taper, PAL.steelDark, fx, 0.4 + fh / 2, fz, 0.9, fh, 0.9);
  g.cyl(fx, 0.4, fz, 0.22, fh + 0.5, "#e6e2da", 8);
  g.cyl(fx, 0.4 + fh * 0.8, fz, 0.26, 0.6, PAL.red, 8);
  o.flares.push({ x: fx, y: 0.4 + fh + 0.6, z: fz });
  o.top = Math.max(o.top, fh);
}

/** A brick furnace with tall stacks and a molten mouth. */
function smelter(o: Draft, w: number, d: number, h: number): void {
  const { g, gl, accent: ac } = o;
  plinth(o, w, d);
  const fw = w * 0.72;
  const fd = d * 0.7;
  const fx = -w * 0.1;
  const fz = d * 0.05;
  g.box(fx, 0.4, fz, fw, h * 0.62, fd, "#9b5b45");
  g.box(fx, 0.4, fz, fw + 0.05, 0.9, fd + 0.05, "#7d4636");
  for (let index = 0; index <= 5; index += 1) {
    g.box(fx - fw / 2 + (fw * index) / 5, 0.4, fz + fd / 2 + 0.06, 0.4, h * 0.62, 0.14, PAL.iron);
  }
  g.box(fx, 0.4 + h * 0.62, fz - fd * 0.1, fw * 0.75, h * 0.28, fd * 0.6, "#87503d");
  g.box(fx, 0.4 + h * 0.9, fz - fd * 0.1, fw * 0.8, 0.25, fd * 0.65, PAL.iron);
  g.box(fx, 0.4 + h * 0.62, fz, fw + 0.2, 0.25, fd + 0.2, ac);
  g.box(fx, 0.4, fz + fd / 2 + 0.05, fw * 0.5, h * 0.36, 0.3, PAL.dark);
  gl.box(fx, 0.5, fz + fd / 2 + 0.22, fw * 0.42, h * 0.28, 0.06, GLOW.molten);
  g.box(fx, 0.4 + h * 0.36, fz + fd / 2 + 0.4, fw * 0.6, 0.35, 0.8, PAL.hazard);
  g.box(fx, 0.4, fz + fd / 2 + 1.4, 1.0, 0.4, 2.0, PAL.iron);
  gl.box(fx, 0.82, fz + fd / 2 + 1.4, 0.6, 0.05, 1.9, GLOW.molten);
  g.cyl(fx + 2.0, 0.4, fz + fd / 2 + 1.6, 1.0, 1.3, PAL.iron, 12);
  gl.cyl(fx + 2.0, 1.55, fz + fd / 2 + 1.6, 0.8, 0.2, GLOW.molten, 12);
  const hx = w / 2 - 1.7;
  const hz = -d * 0.15;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    g.box(hx + a * 1.0, 0.4, hz + b * 1.0, 0.25, h * 0.5, 0.25, PAL.steelDark);
  }
  g.add(PRIM.cone8, ac, hx, 0.4 + h * 0.5 + 1.1, hz, 1.8, 2.2, 1.8, Math.PI);
  g.cyl(hx, 0.4 + h * 0.5 + 2.2, hz, 1.8, 1.2, shade(ac, 0.9), 8);
  g.cone(hx + 0.3, 0.4, hz + d * 0.38, 1.9, 1.6, "#5a4a40", 8);
  g.beam(
    hx,
    0.4 + h * 0.5 + 2.9,
    hz,
    fx + fw / 2 - 0.5,
    0.4 + h * 0.75,
    fz - fd * 0.2,
    0.5,
    PAL.hazard,
  );
  const stack = h * 1.75;
  [-0.32, 0, 0.32].forEach((k, index) => {
    chimney(o, fx + fw * k, fz - fd / 2 + 1.1, 0.95 - index * 0.08, stack - index * 1.5, PAL.red);
  });
  lampRow(o, fx - fw / 2 + 0.8, fx + fw / 2 - 0.8, h * 0.62 + 0.15, fz + fd / 2 + 0.25, 0.95);
  o.top = stack;
}

/** A tank farm, or a pair of spherical tanks on legs. */
function tanks(o: Draft, w: number, d: number, h: number, spheres: boolean): void {
  const { g, gl, accent: ac } = o;
  plinth(o, w, d);
  if (spheres) {
    const r = Math.min(w, d) * 0.24;
    const places = [
      [-w * 0.22, -d * 0.1],
      [w * 0.24, d * 0.08],
    ] as const;
    places.forEach(([x, zz], index) => {
      const rr = r * (1 - index * 0.18);
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2;
        g.box(
          x + Math.cos(a) * rr * 0.8,
          0.4,
          zz + Math.sin(a) * rr * 0.8,
          0.22,
          rr * 1.1,
          0.22,
          PAL.steelDark,
        );
      }
      g.sph(x, 0.4 + rr * 1.35, zz, rr, "#f0eee9", true);
      g.cyl(x, 0.4 + rr * 1.3, zz, rr * 1.01, 0.35, ac, 16);
      o.lamps.push(
        { x, y: 0.4 + rr * 1.35, z: zz + rr + 0.05 },
        { x: x + rr * 0.7, y: 0.4 + rr * 1.35, z: zz + rr * 0.7 },
      );
      o.top = Math.max(o.top, 0.4 + rr * 2.4);
    });
    g.pipe(-w * 0.22, 1.2, -d * 0.1, w * 0.24, 1.2, d * 0.08, 0.2, PAL.steel);
    return;
  }
  const r = Math.min(w, d) * 0.3;
  g.cyl(-w * 0.08, 0.4, -d * 0.05, r, h * 0.8, "#e9e6df", 16);
  g.dome(-w * 0.08, 0.4 + h * 0.8, -d * 0.05, r, r * 0.35, "#cfd4da");
  g.cyl(-w * 0.08, 0.4 + h * 0.55, -d * 0.05, r * 1.01, 0.5, ac, 16);
  for (let index = 0; index < 9; index += 1) {
    const a = index * 0.45;
    g.box(
      -w * 0.08 + Math.cos(a) * (r + 0.25),
      0.4 + (index * (h * 0.8)) / 9,
      -d * 0.05 + Math.sin(a) * (r + 0.25),
      0.5,
      0.12,
      0.5,
      PAL.iron,
    );
  }
  g.box(w * 0.3, 0.4, d * 0.25, 2.0, 1.8, 1.8, PAL.wall);
  g.box(w * 0.3, 2.2, d * 0.25, 2.2, 0.2, 2.0, ac);
  gl.box(w * 0.3, 1.2, d * 0.25 + 0.92, 1.2, 0.4, 0.05, GLOW.warm);
  o.lamps.push({ x: -w * 0.08, y: 0.4 + h * 0.55 + 0.25, z: -d * 0.05 + r + 0.05 });
  o.top = 0.4 + h * 0.8 + r * 0.35;
}

/** A broadcast mast over a low equipment house. */
function mast(o: Draft, w: number, d: number, h: number): void {
  const { g, gl, accent: ac } = o;
  plinth(o, w, d);
  g.box(w * 0.18, 0.4, d * 0.15, w * 0.45, 2.4, d * 0.4, PAL.wall);
  g.box(w * 0.18, 2.8, d * 0.15, w * 0.47, 0.2, d * 0.42, ac);
  gl.box(w * 0.18, 1.6, d * 0.15 + d * 0.2 + 0.03, w * 0.3, 0.5, 0.05, GLOW.cool);
  const mh = h * 1.6;
  const mx = -w * 0.2;
  const mz = -d * 0.15;
  g.add(PRIM.taper, PAL.red, mx, 0.4 + mh / 2, mz, 1.0, mh, 1.0);
  for (let y = 1.5; y < mh; y += 1.6) {
    const r = 1.0 * (1 - (y / mh) * 0.65);
    g.add(PRIM.cyl6, "#eef0f2", mx, 0.4 + y, mz, r, 0.18, r);
  }
  gl.sph(mx, 0.4 + mh + 0.2, mz, 0.3, GLOW.teal);
  dish(o, mx + 0.6, 0.4 + mh * 0.55, mz, 0.9, 0);
  o.lamps.push({ x: w * 0.18, y: 2.6, z: d * 0.15 + d * 0.2 + 0.1 });
  o.top = mh;
}

/** A glazed shopfront under a striped awning, with a glowing sign on its roof. */
function storefront(o: Draft, w: number, d: number, h: number): void {
  const { g, gl } = o;
  plinth(o, w, d);
  g.box(0, 0.4, 0, w, h - 0.4, d, "#f3efe6");
  g.box(0, h, 0, w + 0.3, 0.3, d + 0.3, PAL.iron);
  gl.box(0, 0.6, d / 2 + 0.03, w * 0.88, h * 0.55, 0.06, GLOW.cool);
  for (let index = 0; index <= 6; index += 1) {
    g.box(-w * 0.44 + (w * 0.88 * index) / 6, 0.5, d / 2 + 0.08, 0.14, h * 0.58, 0.1, PAL.iron);
  }
  const stripes = 10;
  for (let index = 0; index < stripes; index += 1) {
    const x = -w * 0.45 + (w * 0.9 * (index + 0.5)) / stripes;
    g.rbox(
      x,
      h * 0.66,
      d / 2 + 0.8,
      (w * 0.9) / stripes,
      0.12,
      1.7,
      index % 2 ? "#f6f1e7" : "#6b7cff",
      -0.35,
    );
  }
  const bw = w * 0.62;
  const bh = Math.min(5, w * 0.3);
  for (const s of [-1, 1]) g.box(s * bw * 0.35, h + 0.3, -d * 0.1, 0.3, 1.4, 0.3, PAL.iron);
  g.box(0, h + 1.6, -d * 0.1, bw, bh, 0.4, "#1f2433");
  // Note that the sign is bars of light, never letters: the scene draws no words.
  const face = -d * 0.1 + 0.22;
  gl.box(-bw * 0.18, h + 1.6 + bh * 0.18, face, bw * 0.08, bh * 0.66, 0.05, GLOW.violet);
  gl.box(-bw * 0.04, h + 1.6 + bh * 0.18, face, bw * 0.28, bh * 0.1, 0.05, GLOW.violet);
  for (const k of [0.2, 0.42, 0.64]) {
    gl.box(bw * 0.28, h + 1.6 + bh * k, face, bw * 0.22, bh * 0.08, 0.05, GLOW.cool);
  }
  lampRow(o, -w / 2 + 0.8, w / 2 - 0.8, h - 0.4, d / 2 + 0.2, 0.95);
  lampRow(o, -d / 2 + 0.8, d / 2 - 0.8, h - 0.4, w / 2 + 0.2, 0.95, true);
  o.top = h + 1.6 + bh;
}

/** A control tower with a turning radar over its operations block. */
function tower(o: Draft, w: number, d: number, h: number): void {
  const { g, gl, accent: ac } = o;
  const tint = GLOW.teal;
  plinth(o, w, d);
  g.box(0, 0.4, d * 0.12, w * 0.8, 2.6, d * 0.55, PAL.wall);
  g.box(0, 3.0, d * 0.12, w * 0.82, 0.22, d * 0.57, ac);
  gl.box(0, 1.6, d * 0.12 + d * 0.275 + 0.03, w * 0.6, 0.6, 0.05, GLOW.warm);
  const tx = -w * 0.18;
  const tz = -d * 0.18;
  const r = Math.max(0.9, w * 0.14);
  g.add(PRIM.frustum, "#e8e4dc", tx, 0.4 + h / 2, tz, r, h, r);
  for (let y = 2; y < h - 1; y += 2.4)
    g.cyl(tx, 0.4 + y, tz, r * (1 - (y / h) * 0.3) + 0.04, 0.16, ac, 12);
  g.cyl(tx, 0.4 + h, tz, r * 1.7, 0.35, PAL.iron, 12);
  gl.cyl(tx, 0.75 + h, tz, r * 1.55, 1.3, tint, 12);
  for (let index = 0; index < 8; index += 1) {
    const a = (index / 8) * Math.PI * 2;
    g.box(
      tx + Math.cos(a) * r * 1.58,
      0.75 + h,
      tz + Math.sin(a) * r * 1.58,
      0.12,
      1.3,
      0.12,
      PAL.iron,
    );
  }
  g.cyl(tx, 2.05 + h, tz, r * 1.8, 0.3, PAL.iron, 12);
  g.cone(tx, 2.35 + h, tz, r * 1.2, 0.7, ac, 12);
  g.cyl(tx, 3.0 + h, tz, 0.06, 2.0, PAL.iron, 6);
  gl.sph(tx, 5.05 + h, tz, 0.2, tint);
  o.spinners.push({
    kind: SPINNER.RADAR,
    x: tx,
    y: 3.2 + h,
    z: tz,
    scale: 1,
    speed: 1.4,
    swing: false,
  });
  for (let index = 0; index < 10; index += 1) {
    o.lamps.push({
      x: -w * 0.35 + (index * (w * 0.7)) / 9,
      y: 2.75,
      z: d * 0.12 + d * 0.275 + 0.2,
    });
  }
  o.top = h + 5;
}

/** A gabled workshop with a gantry crane over its yard. */
function workshop(o: Draft, w: number, d: number, h: number): void {
  const { g, gl } = o;
  plinth(o, w, d);
  const sw = w * 0.55;
  const sd = d * 0.7;
  const sx = -w * 0.2;
  const sz = -d * 0.1;
  g.box(sx, 0.4, sz, sw, h, sd, "#e3dccb");
  g.add(PRIM.gable, "#8a6f55", sx, 0.4 + h, sz, sw + 0.5, 2.2, sd + 0.5);
  g.box(sx, 0.4, sz + sd / 2 + 0.03, sw * 0.5, h * 0.7, 0.1, "#5a6271");
  gl.box(sx - sw * 0.35, h * 0.55, sz + sd / 2 + 0.04, sw * 0.16, 0.6, 0.05, GLOW.warm);
  gl.box(sx + sw * 0.35, h * 0.55, sz + sd / 2 + 0.04, sw * 0.16, 0.6, 0.05, GLOW.warm);
  chimney(o, sx - sw / 2 + 0.8, sz - sd / 2 + 0.8, 0.35, h + 3);
  const gx = w * 0.28;
  const gh = h + 2.5;
  const span = d * 0.85;
  for (const s of [-1, 1]) {
    g.beam(gx - 1.4, 0.4, (s * span) / 2, gx, gh, (s * span) / 2, 0.3, PAL.hazard);
    g.beam(gx + 1.4, 0.4, (s * span) / 2, gx, gh, (s * span) / 2, 0.3, PAL.hazard);
  }
  g.box(gx, gh, 0, 0.6, 0.6, span + 0.6, PAL.hazard);
  g.box(gx, gh - 0.5, d * 0.1, 0.9, 0.5, 1.0, PAL.iron);
  g.box(gx, 1.2, d * 0.1, 0.04, gh - 1.6, 0.04, PAL.iron);
  g.box(gx, 0.4, d * 0.1, 1.2, 0.9, 1.2, PAL.wood);
  for (let index = 0; index < 4; index += 1) {
    g.cyl(
      w / 2 - 0.8,
      0.4,
      -d / 2 + 0.8 + index * 0.9,
      0.38,
      1.0,
      index % 2 ? "#3b6fb0" : PAL.red,
      8,
    );
  }
  for (let index = 0; index < 4; index += 1) {
    g.box(gx, 0.4 + index * 0.25, -d * 0.3, 2.8, 0.22, 0.4, index % 2 ? PAL.steel : PAL.steelDark);
  }
  lampRow(o, sx - sw / 2 + 0.7, sx + sw / 2 - 0.7, h - 0.2, sz + sd / 2 + 0.15, 0.9);
  o.top = gh;
}

/** A hall with a row of colour tanks behind it: the paint shop. */
function paintshop(o: Draft, w: number, d: number, h: number): void {
  hall(o, w * 0.82, d, h, EXTRA.FANS);
  const colours = ["#ff6b6b", "#ffd23f", "#3ddc84", "#4d96ff", "#b07cff"];
  colours.forEach((paint, index) => {
    const x = -w * 0.41 + (w * 0.82 * (index + 0.5)) / 5;
    const zz = -d / 2 - 1.6;
    o.g.cyl(x, 0, zz, 0.85, h * 0.7, paint, 12);
    o.g.dome(x, h * 0.7, zz, 0.85, 0.4, shade(paint, 0.85));
    o.g.cyl(x, h * 0.35, zz, 0.88, 0.25, "#ffffff", 12);
    o.g.pipe(x, h * 0.55, zz + 0.8, x, h * 0.55, -d / 2, 0.14, PAL.steelDark);
  });
}

/** A billboard of coloured light bars over a kiosk. */
function billboard(o: Draft, w: number, d: number, h: number): void {
  const { g, gl } = o;
  plinth(o, w, d);
  g.box(w * 0.2, 0.4, d * 0.2, w * 0.35, 1.8, d * 0.35, PAL.wall);
  g.box(w * 0.2, 2.2, d * 0.2, w * 0.38, 0.15, d * 0.38, ACCENT[ZONE_LAYER.SURFACE]);
  const bh = h * 0.45;
  const bw = w * 0.95;
  for (const s of [-1, 1]) g.box(s * bw * 0.3, 0.4, -d * 0.15, 0.35, h - bh / 2, 0.35, PAL.iron);
  g.box(0, h - bh / 2, -d * 0.15, bw, bh, 0.35, "#1f2433");
  ["#ff7b54", "#ffb26b", "#a98bff"].forEach((paint, index) => {
    gl.box(
      0,
      h - bh / 2 + 0.3 + (index * (bh - 0.6)) / 3,
      -d * 0.15 + 0.2,
      bw * 0.88,
      (bh - 0.6) / 3 - 0.15,
      0.05,
      paint,
    );
  });
  g.box(0, h + bh / 2 - 0.05, -d * 0.15 + 0.5, bw, 0.12, 0.6, PAL.iron);
  o.lamps.push({ x: w * 0.2, y: 2.0, z: d * 0.2 + d * 0.175 + 0.1 });
  o.top = h + bh / 2;
}

/** A glass showroom with its wares on the roof. */
function showroom(o: Draft, w: number, d: number, h: number): void {
  const { g, gl } = o;
  plinth(o, w, d);
  g.box(0, 0.4, 0, w, h, d, "#cfe0ea");
  for (let index = 0; index <= 6; index += 1)
    g.box(-w / 2 + (w * index) / 6, 0.4, d / 2 + 0.05, 0.18, h, 0.1, PAL.iron);
  g.box(0, 0.4 + h, 0, w + 0.3, 0.3, d + 0.3, PAL.iron);
  gl.box(0, 0.4 + h * 0.15, d / 2 + 0.02, w * 0.96, h * 0.7, 0.04, "#b9d9ff");
  ["#ff6b6b", "#4d96ff", "#3ddc84", "#ffd23f"].forEach((paint, index) => {
    const x = -w * 0.36 + (index * w * 0.72) / 3;
    g.box(x, 0.4 + h + 0.3, 0, 1.2, 0.3, 1.2, PAL.concreteDark);
    g.box(x, 0.7 + h + 0.3, 0, 0.8, 0.8, 0.8, paint);
  });
  lampRow(o, -w / 2 + 0.7, w / 2 - 0.7, 0.4 + h - 0.3, d / 2 + 0.2, 0.9);
  o.top = h + 1.6;
}

/** The building a zone gets, and its walls: by its layer and path, as large as its footprint. */
export function buildingPlanOf(path: string, layer: ZoneLayer, footprint: number): BuildingPlan {
  const family: readonly Arch[] = FAMILY[layer];
  const seed = hashOf(path);
  const arch = family[seed % family.length] ?? ARCH.HALL;
  const extra =
    arch === ARCH.HALL
      ? (HALL_EXTRAS[(seed >>> 8) % HALL_EXTRAS.length] ?? EXTRA.NONE)
      : EXTRA.NONE;
  // Note that a footprint of 1 is the largest zone; its side grows with the square root of its bytes, as the layout's does.
  const s = 0.6 + 7.4 * footprint;
  const b = 5 + 1.8 * s;
  const dims = dimensionsOf(arch, b, s);
  const eastX =
    arch === ARCH.HALL
      ? extra === EXTRA.TANKS
        ? 4.2
        : 3.5
      : arch === ARCH.PAINTSHOP
        ? 3.5
        : arch === ARCH.WAREHOUSE
          ? Math.min(4, dims.w * 0.22) + 0.3
          : 0;
  return {
    arch,
    extra,
    ...dims,
    eastX,
    backX: arch === ARCH.PAINTSHOP ? 2.6 : 0,
    frontX: arch === ARCH.SMELTER ? 1.6 : arch === ARCH.WAREHOUSE ? 1.8 : 0.4,
  };
}

/** A building's walls: its width, depth, and height. */
interface Walls {
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

function dimensionsOf(arch: Arch, b: number, s: number): Walls {
  switch (arch) {
    case ARCH.HALL:
    case ARCH.PAINTSHOP:
      return { w: b * 1.15, d: b * 0.85, h: 4.6 + s };
    case ARCH.WAREHOUSE:
      return { w: b * 1.3, d: b * 0.72, h: 4.2 + 0.7 * s };
    case ARCH.SILOS:
      return { w: b, d: b, h: 8 + 1.3 * s };
    case ARCH.REFINERY:
      return { w: b * 1.1, d: b * 0.9, h: 9 + s };
    case ARCH.SMELTER:
      return { w: b * 1.1, d: b * 0.85, h: 6.5 + 0.8 * s };
    case ARCH.STOREFRONT:
      return { w: b * 1.2, d: b * 0.8, h: 5 + 0.6 * s };
    case ARCH.TOWER:
      return { w: b, d: b, h: 9 + 2 * s };
    case ARCH.WORKSHOP:
      return { w: b * 1.25, d: b * 0.85, h: 3.6 + 0.4 * s };
    case ARCH.SHOWROOM:
      return { w: b * 1.2, d: b * 0.8, h: 4 };
    case ARCH.BILLBOARD:
      return { w: b, d: b, h: 8 };
    case ARCH.MAST:
      return { w: b, d: b, h: 7 + s };
    case ARCH.TANKS:
    case ARCH.SPHERES:
      return { w: b, d: b, h: 5 + s };
  }
}

/** Draws `plan` into the yard's welders where their origins stand, for the zone at `path` in `layer`. */
export function drawBuilding(
  g: Geo,
  gl: Geo,
  plan: BuildingPlan,
  path: string,
  layer: ZoneLayer,
): Building {
  const o: Draft = {
    g,
    gl,
    accent: ACCENT[layer],
    rng: rngOf(path),
    lamps: [],
    chimneys: [],
    steam: [],
    spinners: [],
    flares: [],
    top: plan.h,
  };
  const { w, d, h } = plan;
  switch (plan.arch) {
    case ARCH.HALL:
      hall(o, w, d, h, plan.extra);
      break;
    case ARCH.WAREHOUSE:
      warehouse(o, w, d, h);
      break;
    case ARCH.SILOS:
      silos(o, w, d, h);
      break;
    case ARCH.REFINERY:
      refinery(o, w, d, h);
      break;
    case ARCH.SMELTER:
      smelter(o, w, d, h);
      break;
    case ARCH.TANKS:
      tanks(o, w, d, h, false);
      break;
    case ARCH.SPHERES:
      tanks(o, w, d, h, true);
      break;
    case ARCH.MAST:
      mast(o, w, d, h);
      break;
    case ARCH.STOREFRONT:
      storefront(o, w, d, h);
      break;
    case ARCH.TOWER:
      tower(o, w, d, h);
      break;
    case ARCH.WORKSHOP:
      workshop(o, w, d, h);
      break;
    case ARCH.PAINTSHOP:
      paintshop(o, w, d, h);
      break;
    case ARCH.BILLBOARD:
      billboard(o, w, d, h);
      break;
    case ARCH.SHOWROOM:
      showroom(o, w, d, h);
      break;
  }
  return {
    arch: plan.arch,
    w,
    d,
    top: o.top,
    eastX: plan.eastX,
    backX: plan.backX,
    frontX: plan.frontX,
    lamps: o.lamps,
    chimneys: o.chimneys,
    steam: o.steam,
    spinners: o.spinners,
    flares: o.flares,
  };
}

/** The unit geometry of each spinner kind, drawn about its own pivot. */
export function spinnerGeometryOf(kind: SpinnerKind): BufferGeometry {
  switch (kind) {
    case SPINNER.FAN:
      return partGeo((f) => {
        for (let index = 0; index < 4; index += 1) {
          f.rbox(0, 0, 0, 1.8, 0.06, 0.32, PAL.iron, 0, (index * Math.PI) / 4 + 0.2, 0.25);
        }
        f.cyl(0, -0.1, 0, 0.18, 0.2, PAL.iron, 8);
      });
    case SPINNER.DISH:
      return partGeo((f) => {
        f.add(PRIM.dome, "#eef1f4", 0, 0, 0, 1, 0.38, 1, Math.PI - 0.7, 0, 0);
        f.beam(0, 0, 0, 0, 0.55, 0.55, 0.08, PAL.iron);
        f.sph(0, 0.55, 0.55, 0.16, PAL.iron);
      });
    case SPINNER.RADAR:
      return partGeo((f) => {
        f.box(0, 0, 0, 2.6, 0.5, 0.25, "#eef1f4");
        f.box(0, -0.35, 0, 0.2, 0.4, 0.2, PAL.iron);
      });
    case SPINNER.ARM:
      return partGeo((f) => {
        f.cyl(0, 0, 0, 0.6, 0.6, PAL.hazard, 12);
        f.beam(0, 0.6, 0, 1.6, 2.6, 0, 0.45, PAL.hazard);
        f.beam(1.6, 2.6, 0, 3.0, 1.8, 0, 0.35, PAL.hazard);
        f.box(3.0, 1.2, 0, 0.5, 0.6, 0.5, PAL.iron);
      });
  }
}
