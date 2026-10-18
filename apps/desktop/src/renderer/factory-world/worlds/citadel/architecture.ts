import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldPoint } from "../../world";
import { type Kit, PART, type Part } from "./kit";
import type { ZoneSite } from "./layout";
import { HUE, ROOF_HUES } from "./materials";
import { angleBetween, facingOut, hash2, lerp, placed, polar, seeded, seedOf, TAU } from "./math";
import {
  type Clearing,
  HILL,
  heightAt,
  INNER_GATES,
  KEEP_GATES,
  PLATFORM_LEVEL,
  profile,
} from "./terrain";

/**
 * architecture.ts -- the Citadel's stonework: the keep's foundation and donjon, its towers, the bailey's halls and workshops, the three curtains and their gates, the town outside, and the mills in the fields, each zone built by its layer and sized by its bytes.
 *
 * A build is a walk that `put`s parts into the kit (`kit.ts`) and records
 * what stands where: each zone's foot, top, and crown, the slots its
 * torches stand in, its windows, and its flags. The walls and towers that
 * belong to no zone are built in the same walk, so a repository with no zone
 * on a terrace still stands as a citadel. Every random choice is seeded by a
 * zone's path or a fixed number, so the same zones build the same town.
 */

/** A window: a pane on a wall, lit or dark. */
interface WindowSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly width: number;
  readonly height: number;
}

/** A flag on a pole: where its hoist stands, its cloth's colour, and its size. */
export interface FlagSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: string;
  readonly size: number;
}

/** A gap blown in the outer curtain: at `angle`, `width` across, and how far down, from 0 to 1. */
export interface Breach {
  readonly angle: number;
  readonly width: number;
  readonly depth: number;
}

/** What a build found standing: the windows, the flags, the windmills' hubs, and the clearings the forest gives way to. */
export interface Stonework {
  readonly windows: WindowSpot[];
  readonly flags: FlagSpot[];
  readonly mills: Matrix4[];
  readonly clearings: Clearing[];
  /** The outer curtain's gates, as angles. */
  readonly gates: readonly number[];
}

/** The outer curtain: its foot, its height, and its line. */
const CURTAIN = {
  FOOT: profile(HILL.OUTER_RADIUS) - 1.4,
  HEIGHT: 6.4,
  LEVEL: profile(HILL.OUTER_RADIUS),
} as const;

/** The flags each layer flies, all cream: the signals' colours are kept for the signals. */
const LAYER_FLAG = {
  CORE: "#f4e8cc",
  DOMAIN: "#eadcbe",
  SURFACE: "#efe2c4",
  TOOLING: "#e4d6b8",
} as const;

/** Where the outer curtain's gates stand when no surface zone is large enough to keep one: facing the inner curtain's first gate and opposite it. */
const DEFAULT_OUTER_GATES = [Math.PI / 2 - 0.42, Math.PI / 2 - 0.42 + Math.PI];

/** How much stretch of curtain, and how large a zone, earns a gatehouse. */
const GATEHOUSE = { MIN_SPAN: 10, MIN_FOOTPRINT: 0.42 } as const;

/** The town's houses stand outside this radius, leaving the yard against the curtain for the agents' worksites. */
const TOWN_FROM = 57;

/** One build's walk: the kit it puts into and what it records. */
class Mason {
  readonly matrix = new Matrix4();
  readonly found: Stonework;

  constructor(
    readonly kit: Kit,
    gates: readonly number[],
  ) {
    this.found = { windows: [], flags: [], mills: [], clearings: [], gates };
  }

  /** A box standing on `y`: `w` along its own x, `d` along its z, turned by `yaw`. */
  box(
    part: Part,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    yaw = 0,
    color: string = HUE.STONE,
    pitch = 0,
    roll = 0,
  ): void {
    this.kit.put(part, placed(this.matrix, x, y + h / 2, z, yaw, w, h, d, pitch, roll), color);
  }

  /** A round part standing on `y`, `r` wide at its foot and `h` tall. */
  round(
    part: Part,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string = HUE.STONE,
    yaw = 0,
  ): void {
    this.kit.put(part, placed(this.matrix, x, y + h / 2, z, yaw, r, h, r), color);
  }

  /** A gilded ball, as on a spire's tip. */
  finial(x: number, y: number, z: number, size = 0.16): void {
    this.kit.put(PART.TRIM_BALL, placed(this.matrix, x, y, z, 0, size, size, size), HUE.GOLD);
  }

  window(x: number, y: number, z: number, yaw: number, width = 0.32, height = 0.75): void {
    this.found.windows.push({ x, y, z, yaw, width, height });
  }

  /** A flagpole `h` tall on `y`, its gilt knob, and its cloth. */
  flag(x: number, y: number, z: number, color: string, size = 1, h = 2.2): void {
    this.round(PART.TRIM_POLE, x, y, z, 0.05, h, HUE.POLE);
    this.finial(x, y + h + 0.06, z, 0.1);
    this.found.flags.push({ x, y: y + h - 0.05, z, color, size });
  }
}

/** Battlements: `n` merlons round a circle `r` wide at `y`. */
function crenels(mason: Mason, x: number, y: number, z: number, r: number, n: number): void {
  for (let k = 0; k < n; k += 1) {
    const angle = (k / n) * TAU;
    const [dx, dz] = polar(r, angle);
    mason.box(PART.STONE_BOX, x + dx, y, z + dz, 0.46, 0.62, 0.34, facingOut(angle));
  }
}

/** How a round tower is finished: a cone roof `roof` times its radius tall, or battlements; a flag; and, damaged, a broken crown round embers. */
interface TowerFinish {
  readonly roof?: number | undefined;
  readonly roofColor?: string | undefined;
  readonly flag?: string | undefined;
  readonly turn?: number | undefined;
  readonly broken?: boolean | undefined;
  readonly torches?: WorldPoint[] | undefined;
}

/** A round tower on its battered foot; answers its top. */
function roundTower(
  mason: Mason,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  finish: TowerFinish = {},
): number {
  const turn = finish.turn ?? 0;
  mason.round(PART.STONE_FOOT, x, y - 2.2, z, r * 1.14, 3, HUE.STONE_DARK);
  const floors = Math.max(1, Math.floor((h - 2) / 3.2));
  for (let floor = 0; floor < floors; floor += 1) {
    const n = r > 2 ? 3 : 2;
    for (let k = 0; k < n; k += 1) {
      const angle = (k / n) * TAU + floor * 1.1 + turn;
      const [dx, dz] = polar(r + 0.03, angle);
      mason.window(x + dx, y + 2.2 + floor * 3.2, z + dz, facingOut(angle), 0.26, 0.82);
    }
  }
  finish.torches?.push(
    ...[0, 2.1, 4.2].map((angle) => {
      const [dx, dz] = polar(r + 0.6, angle + turn);
      return { x: x + dx, y: y + 1.6, z: z + dz };
    }),
  );
  if (finish.broken === true) return brokenCrown(mason, x, y, z, r, h * 0.84, turn);
  mason.round(PART.STONE_DRUM, x, y, z, r, h);
  mason.round(PART.STONE_DRUM, x, y + h - 0.1, z, r * 1.13, 0.5);
  const top = y + h + 0.4;
  if (finish.roof !== undefined && finish.roof > 0) {
    mason.round(
      PART.ROOF_CONE,
      x,
      top - 0.05,
      z,
      r * 1.24,
      r * finish.roof,
      finish.roofColor ?? HUE.SLATE,
    );
    mason.finial(x, top + r * finish.roof + 0.05, z);
    if (finish.flag !== undefined) mason.flag(x, top + r * finish.roof, z, finish.flag, 1, 1.8);
    return top + r * finish.roof;
  }
  crenels(mason, x, top, z, r * 1.06, Math.max(6, Math.round(r * 4.2)));
  if (finish.flag !== undefined) mason.flag(x, top, z, finish.flag, 1.1, 3.2);
  return top + 0.62;
}

/** A tower whose crown is broken: a ring of jagged stubs round a smouldering core, and glowing cracks down its face. Answers its top. */
function brokenCrown(
  mason: Mason,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  turn: number,
): number {
  const random = seeded(Math.round(x * 31 + z * 17));
  mason.round(PART.STONE_DRUM, x, y, z, r, h);
  for (let k = 0; k < 18; k += 1) {
    const angle = (k / 18) * TAU;
    const [dx, dz] = polar(r - 0.32, angle);
    const stub = 0.3 + random() ** 1.7 * 3.6 * (0.5 + 0.5 * Math.cos(angle - turn + 2.6));
    mason.box(
      PART.STONE_BOX,
      x + dx,
      y + h - 0.2,
      z + dz,
      0.9 + random() * 0.5,
      stub,
      0.66,
      facingOut(angle),
      HUE.STONE,
      (random() - 0.5) * 0.3,
      (random() - 0.5) * 0.4,
    );
  }
  mason.round(PART.EMBER_DRUM, x, y + h - 0.6, z, r - 0.55, 0.65, HUE.PLASTER);
  for (let k = 0; k < 9; k += 1) {
    const angle = turn + 0.15 + (random() - 0.5) * 0.9;
    const [dx, dz] = polar(r + 0.02, angle);
    mason.box(
      PART.EMBER_BOX,
      x + dx,
      y + h * (0.35 + k * 0.07),
      z + dz,
      0.07,
      1.1 + random() * 1.4,
      0.06,
      facingOut(angle),
      HUE.PLASTER,
      0,
      (random() - 0.5) * 1.6,
    );
  }
  return y + h + 1;
}

/** A square tower `w` across, turned by `yaw`, roofed with a pyramid `roof` times its width tall or crenellated; answers its top. */
function squareTower(
  mason: Mason,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw: number,
  roof = 0,
  roofColor: string = HUE.SLATE,
): number {
  mason.box(PART.STONE_BOX, x, y - 2.2, z, w * 1.12, 2.8, w * 1.12, yaw, HUE.STONE_DARK);
  mason.box(PART.STONE_BOX, x, y, z, w, h, w, yaw);
  mason.box(PART.STONE_BOX, x, y + h - 0.1, z, w * 1.12, 0.5, w * 1.12, yaw);
  const floors = Math.max(1, Math.floor((h - 2) / 3));
  for (let floor = 0; floor < floors; floor += 1) {
    for (let side = 0; side < 4; side += 1) {
      const facing = yaw + (side * Math.PI) / 2;
      mason.window(
        x + Math.sin(facing) * (w / 2 + 0.03),
        y + 2.2 + floor * 3,
        z + Math.cos(facing) * (w / 2 + 0.03),
        facing,
        0.34,
        0.9,
      );
    }
  }
  const top = y + h + 0.4;
  if (roof > 0) {
    mason.box(PART.ROOF_PYRAMID, x, top - 0.05, z, w * 1.22, w * roof, w * 1.22, yaw, roofColor);
    mason.finial(x, top + w * roof, z);
    return top + w * roof;
  }
  const per = Math.max(2, Math.round(w * 1.1));
  for (let side = 0; side < 4; side += 1) {
    for (let k = 0; k < per; k += 1) {
      const t = (k + 0.5) / per - 0.5;
      const along = side < 2 ? t * w * 1.06 : (side === 2 ? 1 : -1) * w * 0.53;
      const across = side < 2 ? (side === 0 ? 1 : -1) * w * 0.53 : t * w * 1.06;
      const mx = x + along * Math.cos(yaw) + across * Math.sin(yaw);
      const mz = z - along * Math.sin(yaw) + across * Math.cos(yaw);
      mason.box(PART.STONE_BOX, mx, top, mz, 0.48, 0.62, 0.34, yaw + (side < 2 ? 0 : Math.PI / 2));
    }
  }
  return top + 0.62;
}

/** A hall `w` long and `d` deep under a gable roof, its long side along its own x; answers its ridge. */
function hall(
  mason: Mason,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  yaw: number,
  roof: {
    color?: string;
    height?: number;
    slate?: boolean;
    buttress?: boolean;
    torches?: WorldPoint[];
  } = {},
): number {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const local = (lx: number, lz: number) =>
    [x + lx * cos + lz * sin, z - lx * sin + lz * cos] as const;
  const ridge = roof.height ?? d * 0.75;
  mason.box(PART.STONE_BOX, x, y - 2, z, w + 0.4, 2.3, d + 0.4, yaw, HUE.STONE_DARK);
  mason.box(PART.STONE_BOX, x, y, z, w, h, d, yaw);
  mason.kit.put(
    PART.ROOF_GABLE,
    placed(mason.matrix, x, y + h, z, yaw, w + 0.5, ridge, d + 0.7),
    roof.color ?? (roof.slate === true ? HUE.SLATE : "#b4573a"),
  );
  const bays = Math.max(2, Math.round(w / 1.8));
  for (let k = 0; k < bays; k += 1) {
    const lx = ((k + 0.5) / bays - 0.5) * w;
    for (const side of [1, -1]) {
      const [bx, bz] = local(lx, side * (d / 2 + 0.2));
      if (roof.buttress === true && k > 0) {
        const [px, pz] = local(lx - w / bays / 2, side * (d / 2 + 0.25));
        mason.box(PART.STONE_BOX, px, y - 0.3, pz, 0.45, h * 0.8, 0.55, yaw);
      }
      mason.window(
        bx - side * sin * 0.17,
        y + h * 0.45,
        bz - side * cos * 0.17,
        yaw + (side > 0 ? 0 : Math.PI),
        0.42,
        Math.min(1.5, h * 0.35),
      );
    }
  }
  roof.torches?.push(
    ...[
      [w / 2 + 0.7, 0.8],
      [-w / 2 - 0.7, -0.8],
      [0, d / 2 + 0.8],
      [0, -d / 2 - 0.8],
    ].map(([lx = 0, lz = 0]) => {
      const [tx, tz] = local(lx, lz);
      return { x: tx, y: y + 1.5, z: tz };
    }),
  );
  return y + h + ridge;
}

/** A timber-framed house under a tile roof, with a chimney now and then; answers its ridge. */
function house(
  mason: Mason,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  yaw: number,
  roofColor: string,
  random: () => number,
): number {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  mason.box(PART.STONE_BOX, x, y - 0.8, z, w + 0.12, 1.1, d + 0.12, yaw, HUE.STONE_DARK);
  mason.box(PART.PLASTER_BOX, x, y + 0.3, z, w, h, d, yaw, HUE.PLASTER);
  const ridge = d * (0.55 + random() * 0.35);
  mason.kit.put(
    PART.ROOF_GABLE,
    placed(mason.matrix, x, y + 0.3 + h, z, yaw, w + 0.4, ridge, d + 0.55),
    roofColor,
  );
  if (random() < 0.55) {
    const lx = (random() - 0.5) * w * 0.6;
    mason.box(
      PART.STONE_BOX,
      x + lx * cos + d * 0.22 * sin,
      y + h,
      z - lx * sin + d * 0.22 * cos,
      0.42,
      ridge + 0.7,
      0.42,
      yaw,
      HUE.STONE_DARK,
    );
  }
  for (const side of [1, -1]) {
    for (const lx of [-w * 0.25, w * 0.25]) {
      mason.window(
        x + lx * cos + side * sin * (d / 2 + 0.02),
        y + 0.3 + h * 0.55,
        z - lx * sin + side * cos * (d / 2 + 0.02),
        yaw + (side > 0 ? 0 : Math.PI),
        0.32,
        0.5,
      );
    }
  }
  return y + 0.3 + h + ridge;
}

/** A curtain wall round the hill at `r`, from `foot` to `crest`, open at its gates and broken at its breaches. */
function ringWall(
  mason: Mason,
  r: number,
  foot: number,
  crest: number,
  thick: number,
  gates: readonly number[],
  gateHalf: number,
  step: number,
  breaches: readonly Breach[] = [],
): void {
  const n = Math.ceil((TAU * r) / step);
  for (let k = 0; k < n; k += 1) {
    const angle = ((k + 0.5) / n) * TAU;
    if (gates.some((gate) => Math.abs(angleBetween(angle, gate)) * r < gateHalf)) continue;
    let broken = 0;
    for (const breach of breaches) {
      const off = Math.abs(angleBetween(angle, breach.angle)) * r;
      if (off < breach.width) broken = Math.max(broken, (1 - off / breach.width) * breach.depth);
    }
    const top = broken > 0 ? lerp(crest, foot + 1.2, broken) - hash2(k, 7) * broken * 1.6 : crest;
    const [x, z] = polar(r, angle);
    mason.box(
      PART.STONE_BOX,
      x,
      foot,
      z,
      (TAU * r) / n + 0.05,
      top - foot,
      thick,
      facingOut(angle),
    );
    if (broken >= 0.12) continue;
    if (k % 2 === 0) {
      const [mx, mz] = polar(r + thick / 2 - 0.18, angle);
      mason.box(PART.STONE_BOX, mx, top, mz, step * 0.62, 0.66, 0.36, facingOut(angle));
    }
    const [ix, iz] = polar(r - thick / 2 + 0.12, angle);
    mason.box(PART.STONE_BOX, ix, top, iz, (TAU * r) / n + 0.05, 0.38, 0.22, facingOut(angle));
  }
}

/** The stonework that belongs to no zone: the crown's foundation, the keep's wall and towers, the inner curtain with its towers and gatehouses, and the tents in the lists between the curtains. */
function buildFrame(mason: Mason): void {
  const face = Math.PI / 8 + Math.PI / 2 + 0.62;
  const platform = HILL.PLATFORM_RADIUS;
  mason.kit.put(
    PART.STONE_OCTAGON,
    placed(
      mason.matrix,
      0,
      HILL.KEEP_LEVEL - 0.7 + (HILL.PLATFORM_HEIGHT + 0.7) / 2,
      0,
      face,
      platform,
      HILL.PLATFORM_HEIGHT + 0.7,
      platform,
    ),
    HUE.STONE_DARK,
  );
  mason.kit.put(
    PART.STONE_OCTAGON,
    placed(mason.matrix, 0, PLATFORM_LEVEL - 0.12, 0, face, platform + 0.18, 0.3, platform + 0.18),
    HUE.STONE,
  );
  for (const gate of KEEP_GATES) {
    for (let stair = 0; stair < 5; stair += 1) {
      const [sx, sz] = polar(platform * 0.94 + stair * 0.42, gate);
      mason.box(
        PART.STONE_BOX,
        sx,
        HILL.KEEP_LEVEL - 0.6,
        sz,
        3.4,
        0.6 + HILL.PLATFORM_HEIGHT * (1 - stair / 5),
        0.45,
        facingOut(gate),
      );
    }
  }
  ringWall(mason, HILL.KEEP_RADIUS + 0.55, 9, HILL.KEEP_LEVEL + 1.5, 1.7, KEEP_GATES, 2.4, 1.4);
  for (let k = 0; k < 8; k += 1) {
    const angle = (KEEP_GATES[0] ?? 0) + ((k + 0.5) * TAU) / 8;
    if (KEEP_GATES.some((gate) => Math.abs(angleBetween(angle, gate)) < 0.25)) continue;
    const [x, z] = polar(HILL.KEEP_RADIUS + 0.7, angle);
    roundTower(mason, x, 9.5, z, 1.55, HILL.KEEP_LEVEL - 9.5 + 3.6, { roof: 1.7 });
  }
  for (const gate of KEEP_GATES) {
    for (const side of [-1, 1]) {
      const [x, z] = polar(HILL.KEEP_RADIUS + 0.7, gate + (side * 2.9) / (HILL.KEEP_RADIUS + 0.7));
      squareTower(mason, x, 9.4, z, 2.2, HILL.KEEP_LEVEL - 9.4 + 3.4, facingOut(gate));
    }
  }
  const inner = HILL.INNER_RADIUS + 0.75;
  ringWall(mason, inner, 3.4, HILL.BAILEY_LEVEL + 1.6, 2.2, INNER_GATES, 2.6, 1.4);
  const firstGate = INNER_GATES[0] ?? 0;
  for (let k = 0; k < 12; k += 1) {
    const angle = firstGate + ((k + 0.5) * TAU) / 12;
    if (INNER_GATES.some((gate) => Math.abs(angleBetween(angle, gate)) < 0.16)) continue;
    const [x, z] = polar(inner + 0.3, angle);
    roundTower(mason, x, 3.8, z, 2.1, HILL.BAILEY_LEVEL + 0.4, {
      roof: k % 3 === 0 ? 1.8 : 0,
      turn: angle,
    });
  }
  for (const gate of INNER_GATES) {
    for (const side of [-1, 1]) {
      const [x, z] = polar(inner + 0.2, gate + (side * 3.6) / inner);
      squareTower(mason, x, 3.6, z, 3, HILL.BAILEY_LEVEL + 1.6, facingOut(gate), 0.9);
      mason.flag(x, HILL.BAILEY_LEVEL + 5.2 + 0.4 + 2.7, z, LAYER_FLAG.DOMAIN, 1, 0.2);
    }
  }
  // Note that a little life in the lists between the curtains: striped tents.
  const random = seeded(31);
  for (let k = 0; k < 14; k += 1) {
    const angle = random() * TAU;
    const r = 41.2 + random() * 1.6;
    if (INNER_GATES.some((gate) => Math.abs(angleBetween(angle, gate)) * r < 5)) continue;
    if (mason.found.gates.some((gate) => Math.abs(angleBetween(angle, gate)) * r < 4)) continue;
    const [x, z] = polar(r, angle);
    const y = heightAt(x, z);
    mason.round(
      PART.TENT,
      x,
      y - 0.1,
      z,
      1.2,
      2.1,
      ["#d9c9a8", "#a8835a", "#8c9a78", "#c9b48a"][k % 4] ?? HUE.PLASTER,
    );
    mason.finial(x, y + 2.05, z, 0.08);
  }
}

/** The keep's donjon: a great square tower with four turrets, a lantern, a pyramid roof, and the core's flag. */
function buildHeart(mason: Mason, site: ZoneSite, damaged: boolean): void {
  const width = 4.6 + site.zone.footprint * 1.8;
  const height = 6.6 + site.zone.footprint * 8;
  const face = Math.PI / 2 + 0.62;
  const yaw = facingOut(face) + Math.PI / 4;
  const top = squareTower(mason, 0, PLATFORM_LEVEL, 0, width, height, yaw);
  for (let k = 0; k < 4; k += 1) {
    const [x, z] = polar(width * 0.7, face + (k * Math.PI) / 2);
    mason.round(PART.STONE_DRUM, x, PLATFORM_LEVEL + height - 2.2, z, 0.75, 2.9);
    mason.round(PART.ROOF_CONE, x, PLATFORM_LEVEL + height + 0.7, z, 0.95, 2, HUE.SLATE);
  }
  site.base = PLATFORM_LEVEL;
  // Note that a defect burning in the heart takes its lantern and roof, leaving a broken crown round embers.
  if (damaged) {
    site.top = brokenCrown(mason, 0, top - 0.6, 0, 1.6, 2.2, face);
    site.crown = { x: 0, y: site.top - 0.4, z: 0 };
  } else {
    mason.box(PART.STONE_BOX, 0, top - 0.6, 0, 2.6, 2.2, 2.6, yaw);
    mason.box(PART.ROOF_PYRAMID, 0, top + 1.6, 0, 3.4, 3.2, 3.4, yaw, HUE.SLATE);
    mason.flag(0, top + 4.8, 0, LAYER_FLAG.CORE, 1.4, 2.6);
    site.top = top + 5;
    site.crown = { x: 0, y: top + 1.6, z: 0 };
  }
  for (let k = 0; k < 8; k += 1) {
    const [x, z] = polar(
      HILL.PLATFORM_RADIUS,
      face + Math.PI / 8 + (k * Math.PI) / 4 + Math.PI / 8,
    );
    site.torches.push({ x, y: PLATFORM_LEVEL + 0.2, z });
  }
}

/** A core zone: a round tower in the keep, roofed in slate, its crown broken where a defect burns in it. */
function buildCore(mason: Mason, site: ZoneSite, damaged: boolean): void {
  const random = seeded(seedOf(site.zone.path));
  const onPlatform = Math.hypot(site.x, site.z) + site.size < HILL.PLATFORM_RADIUS * 1.02;
  const base = onPlatform ? PLATFORM_LEVEL : HILL.KEEP_LEVEL;
  const height = 4 + site.zone.footprint * 12;
  const roofs = [2.3, 1.7, 1.5] as const;
  site.base = base;
  site.top = roundTower(mason, site.x, base, site.z, site.size, height, {
    roof: roofs[Math.floor(random() * roofs.length)] ?? 1.7,
    flag: site.zone.footprint > 0.5 ? LAYER_FLAG.CORE : undefined,
    turn: site.angle,
    broken: damaged,
    torches: site.torches,
  });
  site.crown = { x: site.x, y: base + (damaged ? height * 0.84 + 0.6 : height + 0.6), z: site.z };
}

/** The kinds of building a bailey zone may be, its own seed choosing among them by its size. */
const DOMAIN_BUILDING = {
  FORGE: "forge",
  BELFRY: "belfry",
  CHAPTER: "chapter",
  MANOR: "manor",
  GUILDHALL: "guildhall",
  TOWER: "tower",
  WORKSHOPS: "workshops",
} as const;

type DomainBuilding = (typeof DOMAIN_BUILDING)[keyof typeof DOMAIN_BUILDING];

function domainBuildingOf(site: ZoneSite, random: () => number): DomainBuilding {
  const large = [
    DOMAIN_BUILDING.FORGE,
    DOMAIN_BUILDING.CHAPTER,
    DOMAIN_BUILDING.MANOR,
    DOMAIN_BUILDING.GUILDHALL,
  ] as const;
  const small = [
    DOMAIN_BUILDING.BELFRY,
    DOMAIN_BUILDING.TOWER,
    DOMAIN_BUILDING.WORKSHOPS,
    DOMAIN_BUILDING.WORKSHOPS,
  ] as const;
  const pick = random();
  if (site.zone.footprint > 0.45)
    return large[Math.floor(pick * large.length)] ?? DOMAIN_BUILDING.MANOR;
  return small[Math.floor(pick * small.length)] ?? DOMAIN_BUILDING.WORKSHOPS;
}

/** A bailey zone: a forge, a belfry, a chapter house, a manor, a guildhall, a tower, or a knot of workshops, by its own seed and size. */
function buildDomain(mason: Mason, site: ZoneSite, damaged: boolean): void {
  const random = seeded(seedOf(site.zone.path));
  const kind = damaged ? DOMAIN_BUILDING.TOWER : domainBuildingOf(site, random);
  const y = profile(site.radius) - 0.02;
  const f = site.size;
  const yaw = facingOut(site.angle);
  const { x, z } = site;
  const local = (lx: number, lz: number) =>
    [
      x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
    ] as const;
  const roofColor = ROOF_HUES[Math.floor(random() * ROOF_HUES.length)] ?? "#9a4a33";
  const torches = site.torches;
  let top = y;
  switch (kind) {
    case DOMAIN_BUILDING.FORGE: {
      top = hall(mason, x, y, z, f * 1.7, f * 1.05, 3.6 + f * 0.4, yaw, {
        color: roofColor,
        torches,
      });
      const [cx, cz] = local(f * 0.55, -f * 0.15);
      mason.box(PART.STONE_BOX, cx, y, cz, 1.6, top - y + 4.2, 1.6, yaw, HUE.STONE_DARK);
      const [fx, fz] = local(-f * 0.2, f * 0.53 + 0.02);
      mason.box(PART.TRIM_BOX, fx, y + 0.2, fz, 1.6, 1.3, 0.12, yaw, HUE.IRON);
      for (const side of [-1.6, 1.6]) {
        const [ax, az] = local(-f * 0.2 + side, f * 0.53 + 1.2);
        mason.box(PART.TRIM_BOX, ax, y, az, 0.5, 0.55, 0.35, yaw, HUE.IRON);
        mason.box(PART.TRIM_BOX, ax, y + 0.55, az, 0.85, 0.22, 0.32, yaw, HUE.IRON);
      }
      top += 4;
      break;
    }
    case DOMAIN_BUILDING.BELFRY: {
      const w = 2 + f * 0.35;
      const h = 8 + f * 1.2;
      mason.box(PART.STONE_BOX, x, y - 2, z, w * 1.15, 2.4, w * 1.15, yaw, HUE.STONE_DARK);
      mason.box(PART.STONE_BOX, x, y, z, w, h, w, yaw);
      for (const [px, pz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        const [qx, qz] = local(px * w * 0.42, pz * w * 0.42);
        mason.box(PART.STONE_BOX, qx, y + h, qz, 0.42, 2.6, 0.42, yaw);
      }
      mason.box(PART.STONE_BOX, x, y + h + 2.6, z, w * 1.1, 0.5, w * 1.1, yaw);
      mason.kit.put(
        PART.TRIM_BALL,
        placed(mason.matrix, x, y + h + 1.45, z, 0, 0.8, 0.95, 0.8),
        HUE.GOLD,
      );
      mason.box(PART.TRIM_BOX, x, y + h + 0.6, z, 1.5, 0.16, 1.5, yaw, HUE.GOLD);
      mason.box(PART.ROOF_PYRAMID, x, y + h + 3.1, z, w * 1.25, w * 1.5, w * 1.25, yaw, HUE.SLATE);
      for (let floor = 0; floor < 2; floor += 1) {
        for (let side = 0; side < 4; side += 1) {
          const facing = yaw + (side * Math.PI) / 2;
          mason.window(
            x + Math.sin(facing) * (w / 2 + 0.03),
            y + 2.5 + floor * 3.2,
            z + Math.cos(facing) * (w / 2 + 0.03),
            facing,
            0.36,
            1,
          );
        }
      }
      mason.flag(x, y + h + 3.1 + w * 1.5, z, LAYER_FLAG.DOMAIN, 1, 1.6);
      torches.push(
        ...[0, 1.6, 3.2, 4.8].map((angle) => {
          const [dx, dz] = polar(w * 0.9, angle);
          return { x: x + dx, y: y + 1.5, z: z + dz };
        }),
      );
      top = y + h + 3.1 + w * 1.5;
      break;
    }
    case DOMAIN_BUILDING.CHAPTER: {
      top = hall(mason, x, y, z, f * 1.8, f * 0.95, 4.6 + f * 0.3, yaw + Math.PI / 2, {
        slate: true,
        buttress: true,
        height: f,
        torches,
      });
      const [rx, rz] = local(0, f * 0.9 + 0.03);
      mason.kit.put(
        PART.TRIM_POLE,
        placed(mason.matrix, rx, y + 3.4, rz, yaw, 0.95, 0.06, 0.95, Math.PI / 2),
        HUE.IRON,
      );
      mason.round(PART.ROOF_CONE, x, top - 0.4, z, 0.5, 3.4, HUE.SLATE);
      mason.flag(x, top + 2.9, z, LAYER_FLAG.DOMAIN, 0.9, 1.4);
      top += 4.3;
      break;
    }
    case DOMAIN_BUILDING.MANOR: {
      top = hall(mason, x, y, z, f * 1.6, f, 4.4 + f * 0.3, yaw, {
        color: roofColor,
        buttress: true,
        torches,
      });
      const [qx, qz] = local(-f * 0.85, -f * 0.25);
      top = Math.max(
        top,
        roundTower(mason, qx, y, qz, 1.6 + f * 0.1, 8.5 + f * 0.6, {
          roof: 1.8,
          flag: LAYER_FLAG.DOMAIN,
          turn: site.angle,
        }),
      );
      break;
    }
    case DOMAIN_BUILDING.GUILDHALL: {
      top = hall(mason, x, y, z, f * 1.5, f * 0.9, 3.8, yaw + Math.PI / 2, {
        slate: true,
        buttress: true,
        torches,
      });
      const [qx, qz] = local(0, f * 0.8);
      top = Math.max(top, squareTower(mason, qx, y, qz, 1.8, 7.5, yaw, 2.4));
      break;
    }
    case DOMAIN_BUILDING.TOWER: {
      top = roundTower(mason, x, y, z, f * 0.62, 6 + f * 1.2, {
        roof: damaged ? 0 : 1.5,
        roofColor: "#7a6a98",
        flag: LAYER_FLAG.DOMAIN,
        turn: site.angle,
        broken: damaged,
        torches,
      });
      const [ix, iz] = local(0, f * 0.62 + 0.02);
      mason.box(PART.TRIM_BOX, ix, y, iz, 0.9, 1.6, 0.1, yaw, HUE.IRON);
      break;
    }
    case DOMAIN_BUILDING.WORKSHOPS: {
      const houses = 2 + Math.round(f / 2.2);
      top = squareTower(mason, x, y, z, 2 + f * 0.15, 5 + f * 0.6, yaw, 1.1, roofColor);
      for (let k = 0; k < houses; k += 1) {
        const angle = site.angle + Math.PI * 0.25 + (k / houses) * TAU * 0.85;
        const [hx, hz] = [x + Math.cos(angle) * f * 0.72, z + Math.sin(angle) * f * 0.72];
        const hue = ROOF_HUES[(seedOf(site.zone.path) + k) % ROOF_HUES.length] ?? roofColor;
        top = Math.max(
          top,
          house(
            mason,
            hx,
            y,
            hz,
            2.3 + random() * 0.9,
            2 + random() * 0.6,
            1.8 + random() * 1.3,
            facingOut(angle) + Math.PI / 2,
            hue,
            random,
          ),
        );
        torches.push({ x: hx + Math.cos(angle) * 1.8, y: y + 1.4, z: hz + Math.sin(angle) * 1.8 });
      }
      break;
    }
  }
  site.base = y;
  site.top = top;
  site.crown = { x, y: top + 0.6, z };
}

/** The outer curtain's gates: one at each surface zone large enough and wide enough to keep one, or two by default. */
export function outerGatesOf(sites: readonly ZoneSite[]): number[] {
  const gates = sites
    .filter((site) => site.layer === ZONE_LAYER.SURFACE && hasGatehouse(site))
    .map((site) => site.angle);
  return gates.length >= 2
    ? gates
    : [
        ...gates,
        ...DEFAULT_OUTER_GATES.filter(
          (gate) => !gates.some((kept) => Math.abs(angleBetween(gate, kept)) < 0.3),
        ),
      ];
}

function hasGatehouse(site: ZoneSite): boolean {
  return (
    (site.to - site.from) * HILL.OUTER_RADIUS >= GATEHOUSE.MIN_SPAN &&
    site.zone.footprint >= GATEHOUSE.MIN_FOOTPRINT
  );
}

/** A gatehouse at `angle` in the outer curtain: two drum towers, the arch between, its portcullis, and a gilt plaque. Answers its towers' top. */
function gatehouse(
  mason: Mason,
  angle: number,
  footprint: number,
  roofColor: string,
  torches?: WorldPoint[],
): number {
  const y = CURTAIN.LEVEL;
  const height = CURTAIN.HEIGHT + 3 + footprint * 3;
  const r = 2.1 + footprint * 0.5;
  let top = y;
  for (const side of [-1, 1]) {
    const [gx, gz] = polar(
      HILL.OUTER_RADIUS + 0.5,
      angle + (side * (2.2 + r * 0.85)) / HILL.OUTER_RADIUS,
    );
    top = Math.max(
      top,
      roundTower(mason, gx, y, gz, r, height, {
        roof: 1.7,
        roofColor,
        flag: LAYER_FLAG.SURFACE,
        turn: angle,
        torches,
      }),
    );
  }
  const [ax, az] = polar(HILL.OUTER_RADIUS, angle);
  mason.box(
    PART.STONE_BOX,
    ax,
    y + 4.3,
    az,
    4.6,
    CURTAIN.HEIGHT - 4.3 + 1.2,
    2.4,
    facingOut(angle),
  );
  for (let k = -3; k <= 3; k += 1) {
    const [px, pz] = polar(HILL.OUTER_RADIUS + 1.05, angle + (k * 0.27) / HILL.OUTER_RADIUS);
    mason.box(PART.TRIM_BOX, px, y + 2.6, pz, 0.08, 1.8, 0.08, facingOut(angle), HUE.IRON);
  }
  const [px, pz] = polar(HILL.OUTER_RADIUS + 1.05, angle);
  mason.box(PART.TRIM_BOX, px, y + 3.1, pz, 4.4, 0.08, 0.08, facingOut(angle), HUE.IRON);
  const [gx, gz] = polar(HILL.OUTER_RADIUS + 1.25, angle);
  mason.box(PART.TRIM_BOX, gx, y + 5.4, gz, 1.1, 0.7, 0.08, facingOut(angle), HUE.GOLD);
  return top;
}

/** The outer curtain, broken where defects burn, and each surface zone's stretch of it: its corner tower, its gatehouse or keep tower, its wall-walk torches, and its houses in the town outside. */
function buildSurface(
  mason: Mason,
  sites: readonly ZoneSite[],
  breaches: readonly Breach[],
  clearings: readonly Clearing[],
): void {
  ringWall(
    mason,
    HILL.OUTER_RADIUS,
    CURTAIN.FOOT,
    CURTAIN.LEVEL + CURTAIN.HEIGHT,
    1.8,
    mason.found.gates,
    2.2,
    1.3,
    breaches,
  );
  const ownGates = new Set(sites.filter(hasGatehouse));
  for (const gate of mason.found.gates) {
    if (sites.some((site) => ownGates.has(site) && site.angle === gate)) continue;
    gatehouse(mason, gate, 0.3, "#9c5236");
  }
  const houses: Clearing[] = [...clearings];
  for (const site of sites) {
    const y = CURTAIN.LEVEL;
    const roofColor = ROOF_HUES[seedOf(site.zone.path) % ROOF_HUES.length] ?? "#b4573a";
    const span = site.to - site.from;
    const [bx, bz] = polar(HILL.OUTER_RADIUS + 0.2, site.from);
    site.base = y;
    site.top = roundTower(
      mason,
      bx,
      y,
      bz,
      1.9 + site.zone.footprint * 0.8,
      CURTAIN.HEIGHT + 1.6 + site.zone.footprint * 2.4,
      {
        roof: site.zone.footprint > 0.45 ? 1.6 : 0,
        roofColor,
        turn: site.from,
      },
    );
    site.crown = { x: bx, y: site.top + 0.4, z: bz };
    if (hasGatehouse(site)) {
      const top = gatehouse(mason, site.angle, site.zone.footprint, roofColor, site.torches);
      const [gx, gz] = polar(HILL.OUTER_RADIUS + 0.5, site.angle);
      if (top > site.top) site.crown = { x: gx, y: top + 0.6, z: gz };
      site.top = Math.max(site.top, top);
    } else if (site.zone.footprint > 0.22 && span * HILL.OUTER_RADIUS > 5) {
      const [sx, sz] = polar(HILL.OUTER_RADIUS + 0.4, site.angle);
      const top = squareTower(
        mason,
        sx,
        y,
        sz,
        3.1,
        CURTAIN.HEIGHT + 2 + site.zone.footprint * 3,
        facingOut(site.angle),
      );
      mason.flag(sx, top - 0.2, sz, LAYER_FLAG.SURFACE, 1, 2.6);
      if (top > site.top) site.crown = { x: sx, y: top + 0.2, z: sz };
      site.top = Math.max(site.top, top);
    }
    const walk = Math.max(2, Math.round((span * HILL.OUTER_RADIUS) / 3));
    for (let k = 0; k < walk; k += 1) {
      const [x, z] = polar(HILL.OUTER_RADIUS - 0.55, site.from + ((k + 0.5) / walk) * span);
      site.torches.push({ x, y: y + CURTAIN.HEIGHT + 0.4, z });
    }
    buildTown(mason, site, roofColor, houses);
  }
}

/** A surface zone's houses in the town outside its stretch of curtain: more for a larger zone, each where it fits. */
function buildTown(mason: Mason, site: ZoneSite, roofColor: string, placedSoFar: Clearing[]): void {
  const random = seeded(seedOf(site.zone.path) ^ 0x5bd1e995);
  const wanted = 3 + Math.round(site.zone.footprint * 12);
  const span = site.to - site.from;
  const depth = 6 + site.zone.footprint * 8;
  let built = 0;
  for (let tries = 0; built < wanted && tries < 120; tries += 1) {
    const angle = site.from + (0.04 + random() * 0.92) * span;
    const r = TOWN_FROM + random() ** 0.8 * depth;
    if (mason.found.gates.some((gate) => Math.abs(angleBetween(angle, gate)) * r < 2.8)) continue;
    const [x, z] = polar(r, angle);
    const w = 2.2 + random() * 1.3;
    const d = 2 + random() * 0.8;
    const reach = Math.max(w, d) * 0.62;
    if (placedSoFar.some((other) => Math.hypot(other.x - x, other.z - z) < reach + other.radius))
      continue;
    const y = Math.min(heightAt(x - 1, z - 1), heightAt(x + 1, z + 1), heightAt(x, z));
    const tint = new Color(roofColor).offsetHSL(
      (random() - 0.5) * 0.04,
      (random() - 0.5) * 0.1,
      (random() - 0.5) * 0.12,
    );
    const turn = facingOut(angle) + (random() < 0.7 ? Math.PI / 2 : 0) + (random() - 0.5) * 0.3;
    house(mason, x, y, z, w, d, 1.7 + random() * 1.6, turn, `#${tint.getHexString()}`, random);
    placedSoFar.push({ x, z, radius: reach });
    mason.found.clearings.push({ x, z, radius: reach + 1.2 });
    built += 1;
  }
}

/** The kinds of building a field zone may be. */
const TOOLING_BUILDING = { MILL: "mill", QUARRY: "quarry", BARN: "barn" } as const;

/** A field zone: a windmill, a quarry with its stone yard, or a barn and its round store, by its own seed; the largest is always a mill. */
function buildTooling(mason: Mason, site: ZoneSite, largest: boolean): void {
  const random = seeded(seedOf(site.zone.path));
  const pick = random();
  const kind =
    largest || pick < 0.34
      ? TOOLING_BUILDING.MILL
      : pick < 0.67
        ? TOOLING_BUILDING.QUARRY
        : TOOLING_BUILDING.BARN;
  const { x, z } = site;
  const y = Math.min(
    ...[0, 1, 2, 3].map((k) =>
      heightAt(x + Math.cos(k * 1.6) * site.size, z + Math.sin(k * 1.6) * site.size),
    ),
    heightAt(x, z),
  );
  site.base = y;
  mason.found.clearings.push({ x, z, radius: site.size * 2.2 + 3 });
  const torches = [0, 2, 4].map((angle) => ({
    x: x + Math.cos(angle) * (site.size + 1.2),
    y: y + 1.3,
    z: z + Math.sin(angle) * (site.size + 1.2),
  }));
  site.torches.push(...torches);
  switch (kind) {
    case TOOLING_BUILDING.MILL: {
      const scale = site.size / 4;
      mason.round(PART.STONE_FOOT, x, y - 1, z, 2.3 * scale + 0.4, 8 * scale + 1);
      mason.round(PART.ROOF_CONE, x, y + 7 * scale, z, 2.4 * scale + 0.4, 2.8 * scale, "#8f5a36");
      mason.window(x + 2 * scale + 0.3, y + 3 * scale, z, Math.PI / 2, 0.4, 0.7);
      mason.flag(x, y + 9.7 * scale + 0.3, z, LAYER_FLAG.TOOLING, 0.8, 1.2);
      const inward = Math.atan2(-x, -z);
      const hub = new Matrix4().compose(
        new Vector3(
          x + Math.sin(inward) * (2.0 * scale + 0.4),
          y + 6.6 * scale,
          z + Math.cos(inward) * (2.0 * scale + 0.4),
        ),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), inward),
        new Vector3(scale, scale, scale),
      );
      mason.found.mills.push(hub);
      site.top = y + 10 * scale + 1;
      site.crown = { x, y: y + 9.9 * scale + 0.6, z };
      break;
    }
    case TOOLING_BUILDING.QUARRY: {
      for (let k = 0; k < 9; k += 1) {
        const angle = site.angle + (random() - 0.5) * 1.4 + Math.PI;
        const [dx, dz] = polar(site.size * 0.8 + random() * site.size, angle);
        mason.kit.put(
          PART.RUBBLE,
          placed(
            mason.matrix,
            x + dx,
            y + 0.8,
            z + dz,
            random() * 6,
            2 + random() * 2.4,
            1.4 + random() * 2.6,
            2 + random() * 2,
            random(),
            random(),
          ),
          HUE.ROCK,
        );
      }
      for (let k = 0; k < 14; k += 1) {
        const angle = site.angle + (random() - 0.5) * 2.2;
        const [dx, dz] = polar(1 + random() * site.size * 0.8, angle);
        mason.box(
          k % 3 === 0 ? PART.FRESH_BOX : PART.STONE_BOX,
          x + dx,
          y + (k > 9 ? 0.7 : 0) - 0.1,
          z + dz,
          1.1,
          0.7,
          0.8,
          random() * 3,
          k % 3 === 0 ? HUE.FRESH : HUE.STONE,
        );
      }
      const [hx, hz] = [
        x + Math.cos(site.angle + 1.2) * site.size,
        z + Math.sin(site.angle + 1.2) * site.size,
      ];
      site.top = Math.max(
        y + 5,
        house(mason, hx, y, hz, 2.6, 2.2, 1.9, facingOut(site.angle), "#7a5a3a", random),
      );
      site.crown = { x, y: y + 4, z };
      break;
    }
    case TOOLING_BUILDING.BARN: {
      const ridge = hall(
        mason,
        x,
        y,
        z,
        site.size * 1.4,
        site.size * 0.9,
        2.6 + site.size * 0.3,
        facingOut(site.angle),
        { color: "#8a4a3a" },
      );
      const [sx, sz] = [
        x + Math.cos(site.angle + 1.6) * site.size,
        z + Math.sin(site.angle + 1.6) * site.size,
      ];
      const store = roundTower(mason, sx, y, sz, 1.2, 4 + site.size * 0.4, {
        roof: 1.4,
        roofColor: "#7a6a4a",
      });
      site.top = Math.max(ridge, store);
      site.crown = { x, y: ridge + 0.6, z };
      break;
    }
  }
}

/** Builds the whole Citadel into `kit`: the frame, then every zone by its layer, damaged where defects burn, leaving the clearings clear. */
export function buildStonework(
  kit: Kit,
  sites: readonly ZoneSite[],
  breaches: readonly Breach[],
  damaged: ReadonlySet<string>,
  clearings: readonly Clearing[],
): Stonework {
  const surface = sites.filter((site) => site.layer === ZONE_LAYER.SURFACE);
  const mason = new Mason(kit, outerGatesOf(surface));
  kit.begin();
  buildFrame(mason);
  const fields = sites.filter((site) => site.layer === ZONE_LAYER.TOOLING);
  const largestField = [...fields].sort((left, right) => right.zone.bytes - left.zone.bytes)[0];
  for (const site of sites) {
    if (site.heart) buildHeart(mason, site, damaged.has(site.zone.path));
    else if (site.layer === ZONE_LAYER.CORE) buildCore(mason, site, damaged.has(site.zone.path));
    else if (site.layer === ZONE_LAYER.DOMAIN)
      buildDomain(mason, site, damaged.has(site.zone.path));
    else if (site.layer === ZONE_LAYER.TOOLING) buildTooling(mason, site, site === largestField);
  }
  buildSurface(mason, surface, breaches, clearings);
  kit.end();
  return mason.found;
}

/** A windmill's four sails and their stocks, as one geometry painted per vertex, turning about its own z. */
export function sailGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const paint = (geometry: BufferGeometry, hex: string) => {
    const color = new Color(hex);
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let at = 0; at < colors.length; at += 3) color.toArray(colors, at);
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    return geometry;
  };
  for (let k = 0; k < 4; k += 1) {
    const turn = new Matrix4().makeRotationZ((k * Math.PI) / 2);
    parts.push(
      paint(new BoxGeometry(6.6, 0.16, 0.16).translate(3.4, 0, 0).applyMatrix4(turn), "#5f4128"),
    );
    parts.push(
      paint(new BoxGeometry(5.4, 1.2, 0.05).translate(3.6, 0.5, 0).applyMatrix4(turn), "#efe2c4"),
    );
  }
  return mergeGeometries(parts);
}

/** The material the sails are drawn in, their own colours per vertex. */
export function sailMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
}

/** Breaches in the outer curtain where defects burn in a surface zone: one per defect, wider and deeper the more events it reached. */
export function breachesOf(
  defects: readonly { readonly events: number; readonly zonePaths: readonly string[] }[],
  sites: ReadonlyMap<string, ZoneSite>,
): Breach[] {
  const seen = new Map<string, number>();
  return defects.flatMap((defect) => {
    const site = defect.zonePaths[0] === undefined ? undefined : sites.get(defect.zonePaths[0]);
    if (site === undefined || site.layer !== ZONE_LAYER.SURFACE) return [];
    const k = seen.get(site.zone.path) ?? 0;
    seen.set(site.zone.path, k + 1);
    return [
      {
        angle: breachAngleOf(site, k),
        width: 0.9 + Math.sqrt(defect.events) * 0.48,
        depth: Math.min(0.92, 0.32 + defect.events / 36),
      },
    ];
  });
}

/** Where the `k`th defect of a surface zone breaks its stretch of curtain. */
export function breachAngleOf(site: ZoneSite, k: number): number {
  const span = site.to - site.from;
  return k === 0 ? site.from + span * 0.52 : site.from + span * (0.18 + ((k * 0.37) % 1) * 0.7);
}
