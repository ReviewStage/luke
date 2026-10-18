import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import { ZONE_LAYER, type ZoneLayer, type ZoneView } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry as Geometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Points,
  Quaternion,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import {
  airshipHull,
  antenna,
  arch,
  box,
  column,
  crane,
  cylinder,
  dock,
  fbm,
  flag,
  hashOf,
  house,
  lighthouse,
  lit,
  merged,
  monolith,
  obelisk,
  PALETTE,
  type Prefab,
  pickOf,
  portal,
  prism,
  type Random,
  randomOf,
  sails,
  silo,
  TAU,
  TREE,
  type TreeKind,
  tent,
  tower,
  tree,
  valueNoise,
  vault,
  windmill,
  windowPane,
  workshop,
  xf,
  ziggurat,
} from "./kit";
import { GLSL_NOISE, GLSL_OUTPUT } from "./mood";
import {
  haloMaterial,
  lanternMaterial,
  ZONE_SURFACE,
  type ZoneUniforms,
  zoneLitMaterial,
} from "./zone-light";

/**
 * islands.ts -- the archipelago itself: where each zone's island floats, its grass top and its strata beneath, the props it is dressed in by its layer, the lanterns on its rim, and its waterfalls.
 *
 * Each zone is an island sized by its footprint, the many small zones
 * islets. The layers are rings, the core at the heart and the edge a
 * developer meets outside: an island floats where the view model lays its
 * zone out (`@luke/ui/factory-world`'s `ZONE_LAYOUT`), scaled into the sky,
 * at its layer's height, the core lowest and the surface highest. A last
 * pass nudges any two islands apart that touch, and nothing else moves
 * them, so the same zones always land in the same places.
 *
 * Nothing here depends on the hover or the scrubber: the islands are built
 * once per set of zones, merged across the whole archipelago into a few
 * meshes, and lit afterwards through `zone-light.ts`. Each island reserves
 * its bridge anchors (`bridges.ts`) and its building plots (`builders.ts`)
 * before it is dressed, so nothing is built on top of either.
 */

/** How the archipelago is laid out, in scene units. */
const ISLE = {
  /** Scene units per layout unit: the surface ring floats about eighty units out, as the mockup's does. */
  SCALE: 32,
  /** The smallest island's radius, and how much a full footprint adds to it, on a curve that keeps the many small zones islets. */
  MIN_RADIUS: 1.4,
  RADIUS_PER_FOOTPRINT: 8.8,
  RADIUS_CURVE: 1.25,
  /** How much wider a core island is than its footprint alone would make it. */
  CORE_GROWTH: 1.15,
  /** The least air between two islands. */
  GAP: 2.4,
  /** How many times the islands that touch are nudged apart, at most. */
  RELAX_PASSES: 120,
} as const;

/** How high each layer floats, and how far its islands spread above that. */
const LAYER_HEIGHT = {
  [ZONE_LAYER.CORE]: { base: 0, spread: 5 },
  [ZONE_LAYER.DOMAIN]: { base: 8, spread: 5 },
  [ZONE_LAYER.SURFACE]: { base: 14, spread: 12 },
  [ZONE_LAYER.TOOLING]: { base: 6, spread: 6 },
} as const satisfies Record<ZoneLayer, { base: number; spread: number }>;

/** Each layer's strata, the rock its island hangs from. */
const LAYER_STRATA = {
  [ZONE_LAYER.CORE]: PALETTE.CORE_STRATA,
  [ZONE_LAYER.DOMAIN]: PALETTE.STRATA,
  [ZONE_LAYER.SURFACE]: PALETTE.SURFACE_STRATA,
  [ZONE_LAYER.TOOLING]: PALETTE.TOOLING_STRATA,
} as const satisfies Record<ZoneLayer, readonly string[]>;

/** The most of each moving prop the archipelago holds. */
const MOVING = {
  SAILS: 360,
  MOORED: 160,
  FRAGMENTS: 900,
} as const;

/** One reserved patch of an island's top, in its own frame: nothing else is built within `clearance` of it. */
interface Spot {
  readonly x: number;
  readonly z: number;
  readonly clearance: number;
}

/** One zone's island as built: where it floats, its shape, and what it has reserved. */
export interface Isle {
  readonly zone: ZoneView;
  /** Its texel in the zone texture, its place in the view's zones. */
  readonly index: number;
  readonly position: Vector3;
  readonly radius: number;
  /** How far its rock hangs below its top. */
  readonly depth: number;
  /** The direction, in radians, from the archipelago's centre out through it. */
  readonly outward: number;
  readonly random: Random;
  /** How far its rim stands from its centre at angle `theta`. */
  readonly edgeRadius: (theta: number) => number;
  /** Its top's height at `(x, z)` in its own frame. */
  readonly topHeight: (x: number, z: number) => number;
  readonly spots: Spot[];
  /** The plots its builders build on, in its own frame, the most central first. */
  readonly plots: Vector3[];
}

/** One island before it is built: its zone, where it floats, and how wide. */
interface Placement {
  readonly zone: ZoneView;
  readonly index: number;
  readonly position: Vector3;
  readonly radius: number;
}

function radiusOf(zone: ZoneView): number {
  const radius = ISLE.MIN_RADIUS + ISLE.RADIUS_PER_FOOTPRINT * zone.footprint ** ISLE.RADIUS_CURVE;
  return zone.layer === ZONE_LAYER.CORE ? radius * ISLE.CORE_GROWTH : radius;
}

/** A unit draw for `path` under `salt`, so one zone's draws are independent of each other. */
function unitOf(path: string, salt: number): number {
  return randomOf(hashOf(path) ^ salt)();
}

/** Nudges any two islands that still touch apart, in the plane, each by half the overlap. */
function relax(placements: readonly Placement[]): void {
  for (let pass = 0; pass < ISLE.RELAX_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i];
        const b = placements[j];
        if (a === undefined || b === undefined) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distance = Math.hypot(dx, dz) || 0.001;
        const overlap = a.radius + b.radius + ISLE.GAP - distance;
        if (overlap <= 0) continue;
        moved = true;
        const push = overlap / 2 / distance;
        a.position.x -= dx * push;
        a.position.z -= dz * push;
        b.position.x += dx * push;
        b.position.z += dz * push;
      }
    }
    if (!moved) return;
  }
}

/** Where every zone's island floats: its layout's place scaled into the sky, at its layer's height, with any two that touch nudged apart; and how far the archipelago reaches. */
function layoutOf(zones: readonly ZoneView[]) {
  const placements: Placement[] = zones
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_ZONES)
    .map((zone, index) => {
      const height = LAYER_HEIGHT[zone.layer];
      const y = height.base + unitOf(zone.path, 0x52) * height.spread;
      return {
        zone,
        index,
        radius: radiusOf(zone),
        position: new Vector3(zone.x * ISLE.SCALE, y, zone.y * ISLE.SCALE),
      };
    });
  relax(placements);
  const extent = Math.max(
    30,
    ...placements.map((p) => Math.hypot(p.position.x, p.position.z) + p.radius),
  );
  const xs = placements.flatMap((p) => [p.position.x - p.radius, p.position.x + p.radius]);
  const zs = placements.flatMap((p) => [p.position.z - p.radius, p.position.z + p.radius]);
  const middle = new Vector3(
    (Math.min(0, ...xs) + Math.max(0, ...xs)) / 2,
    0,
    (Math.min(0, ...zs) + Math.max(0, ...zs)) / 2,
  );
  const span = Math.max(
    30,
    ...placements.map(
      (p) => Math.hypot(p.position.x - middle.x, p.position.z - middle.z) + p.radius,
    ),
  );
  return { placements, extent, middle, span };
}

// ---------------------------------------------------------------- one island's shape

/** The island's grass top and the rock it hangs from, in the archipelago's frame. */
function islandShape(placement: Placement) {
  const { zone, radius: r } = placement;
  const seed = hashOf(zone.path);
  const s = (seed % 997) * 0.173;
  const random = randomOf(seed ^ 0x9e3779b9);
  const core = zone.layer === ZONE_LAYER.CORE;
  const segments = Math.round(MathUtils.clamp(r * 6, 30, 96));
  const rings = Math.round(MathUtils.clamp(r * 0.75, 4, 12));
  const edgeRadius = (theta: number) =>
    r * (0.84 + 0.32 * fbm(Math.cos(theta) * 1.5 + s, Math.sin(theta) * 1.5 - s, s, 3));
  const bump = Math.min(1.6, 0.25 + r * 0.1);
  const topHeight = (x: number, z: number) => {
    const q = Math.hypot(x, z) / r;
    return (
      (fbm(x * 0.11 + s, z * 0.11 - s, s + 3, 3) - 0.5) * bump * 2 +
      0.6 * Math.max(0, 1 - q * q) * Math.min(1, r / 7)
    );
  };
  const depth = r * (1.2 + random() * 0.35) * (core ? 1.25 : 1) + Math.min(3, r * 0.8);
  const isle: Isle = {
    zone,
    index: placement.index,
    position: placement.position,
    radius: r,
    depth,
    outward: Math.atan2(placement.position.z, placement.position.x),
    random,
    edgeRadius,
    topHeight,
    spots: [],
    plots: [],
  };
  const top = islandTop(isle, s, segments, rings, core);
  const under = islandUnderside(isle, s, segments, random);
  return { isle, top, under };
}

function zoneAttribute(geometry: BufferGeometry, index: number): BufferGeometry {
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("zone", new BufferAttribute(new Float32Array(count).fill(index), 1));
  return geometry;
}

function islandTop(
  isle: Isle,
  s: number,
  segments: number,
  rings: number,
  core: boolean,
): BufferGeometry {
  const { position: at } = isle;
  const grass = core ? PALETTE.CORE_GRASS : PALETTE.GRASS;
  const positions: number[] = [at.x, at.y + isle.topHeight(0, 0), at.z];
  const color = new Color(grass[0]);
  const blend = new Color();
  const colors: number[] = [color.r, color.g, color.b];
  const indices: number[] = [];
  for (let k = 1; k <= rings; k += 1) {
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * TAU;
      const reach = (isle.edgeRadius(theta) * k) / rings;
      const x = Math.cos(theta) * reach;
      const z = Math.sin(theta) * reach;
      positions.push(at.x + x, at.y + isle.topHeight(x, z) - (k === rings ? 0.12 : 0), at.z + z);
      const f = fbm(x * 0.22 + s, z * 0.22, s + 9, 3);
      const f2 = valueNoise(x * 0.6, z * 0.6, s);
      color.set(grass[Math.floor(f * 3.99 * 1.3) % grass.length] ?? grass[0]);
      color.lerp(blend.set(grass[Math.floor(f2 * 4) % grass.length] ?? grass[0]), 0.35);
      if (core && fbm(x * 0.32 - s, z * 0.32, s + 2, 2) > 0.58) {
        color
          .set(f2 > 0.5 ? PALETTE.STONE_2 : PALETTE.STONE_DARK)
          .lerp(blend.set(PALETTE.MOSS), f2 * 0.4);
      }
      if (k === rings) color.lerp(blend.set(PALETTE.GRASS_DARK), 0.35);
      colors.push(color.r, color.g, color.b);
    }
  }
  const ringStart = (k: number) => (k === 0 ? 0 : 1 + (k - 1) * segments);
  for (let i = 0; i < segments; i += 1) {
    indices.push(0, ringStart(1) + ((i + 1) % segments), ringStart(1) + i);
  }
  for (let k = 1; k < rings; k += 1) {
    const a = ringStart(k);
    const b = ringStart(k + 1);
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      indices.push(a + i, b + j, b + i, a + i, a + j, b + j);
    }
  }
  const geometry = new Geometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return zoneAttribute(geometry, isle.index);
}

/** The rock beneath: the top's edge, a grassy lip, a band of dirt, then strata narrowing to a jagged tip. */
function islandUnderside(isle: Isle, s: number, segments: number, random: Random): BufferGeometry {
  const { position: at, depth } = isle;
  const strata = LAYER_STRATA[isle.zone.layer];
  const bands = 13;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const starts: number[] = [];
  const color = new Color();
  for (let m = 0; m < bands + 3; m += 1) {
    starts.push(positions.length / 3);
    const t = m < 3 ? 0 : (m - 2) / (bands + 1);
    for (let i = 0; i < segments; i += 1) {
      const theta = (i / segments) * TAU;
      const reach = isle.edgeRadius(theta);
      const cx = Math.cos(theta);
      const sz = Math.sin(theta);
      const ty = isle.topHeight(cx * reach, sz * reach);
      let x = cx * reach;
      let z = sz * reach;
      let y = ty - 0.12;
      let hex: string = PALETTE.GRASS_DARK;
      let k = 1;
      if (m === 1) {
        x *= 1.035;
        z *= 1.035;
        y = ty - 0.5;
        k = 0.8;
      } else if (m === 2) {
        y = ty - 1.4;
        hex = PALETTE.DIRT;
      } else if (m > 2) {
        const jag =
          1 +
          (valueNoise(cx * 3 + s, sz * 3 - s, t * 5 + s) - 0.5) * 0.55 +
          (valueNoise(theta * 9, t * 11, s) - 0.5) * 0.25;
        const narrowing = reach * (1 - t) ** 1.05 * jag;
        x = cx * narrowing;
        z = sz * narrowing;
        y =
          -1.4 -
          depth * t ** 0.92 +
          (valueNoise(cx * 4, sz * 4, t * 6 + s) - 0.5) * 2.2 * t +
          ty * (1 - t) * 0.5;
        const band = Math.sin(y * 0.85 + valueNoise(x * 0.3, y * 0.25, z * 0.3) * 3.2);
        hex = strata[Math.floor((band + 1) * 2.99) % strata.length] ?? PALETTE.DIRT;
        k = MathUtils.lerp(1.0, 0.5, t);
      }
      positions.push(at.x + x, at.y + y, at.z + z);
      color.set(hex).multiplyScalar(k);
      colors.push(color.r, color.g, color.b);
    }
  }
  const tip = positions.length / 3;
  positions.push(
    at.x + (random() - 0.5) * isle.radius * 0.3,
    at.y - 1.4 - depth - 2.5 - random() * 2,
    at.z + (random() - 0.5) * isle.radius * 0.3,
  );
  color.set(PALETTE.STRATA[3]).multiplyScalar(0.45);
  colors.push(color.r, color.g, color.b);
  for (let m = 0; m < starts.length - 1; m += 1) {
    const a = starts[m] ?? 0;
    const b = starts[m + 1] ?? 0;
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      indices.push(a + i, b + j, b + i, a + i, a + j, b + j);
    }
  }
  const last = starts[starts.length - 1] ?? 0;
  for (let i = 0; i < segments; i += 1) indices.push(last + i, last + ((i + 1) % segments), tip);
  const geometry = new Geometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return zoneAttribute(geometry, isle.index);
}

// ---------------------------------------------------------------- spots

/** A free spot on an island's top `clearance` wide, within `maxFraction` of its rim, reserved; none if there is no room. */
function findSpot(
  isle: Isle,
  clearance: number,
  maxFraction = 0.78,
  tries = 70,
): { x: number; y: number; z: number } | undefined {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const theta = isle.random() * TAU;
    const q = Math.sqrt(isle.random()) * maxFraction;
    const rim = isle.edgeRadius(theta);
    const d = q * rim;
    const x = Math.cos(theta) * d;
    const z = Math.sin(theta) * d;
    if (d + clearance > rim * 0.93) continue;
    if (isle.spots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < spot.clearance + clearance))
      continue;
    isle.spots.push({ x, z, clearance });
    return { x, y: isle.topHeight(x, z), z };
  }
  return undefined;
}

/** A point on an island's rim at angle `theta`, `fraction` of the way out, in its own frame. */
export function edgePoint(isle: Isle, theta: number, fraction = 0.95): Vector3 {
  const reach = isle.edgeRadius(theta) * fraction;
  const x = Math.cos(theta) * reach;
  const z = Math.sin(theta) * reach;
  return new Vector3(x, isle.topHeight(x, z), z);
}

export function reserve(isle: Isle, x: number, z: number, clearance: number): void {
  isle.spots.push({ x, z, clearance });
}

/** How many plots an island keeps for its builders: one per sixteen square units of it, at least one. */
function plotCount(isle: Isle): number {
  return MathUtils.clamp(Math.round((Math.PI * isle.radius * isle.radius) / 16), 1, 18);
}

function reservePlots(isle: Isle): void {
  for (let n = plotCount(isle); n > 0; n -= 1) {
    const spot = findSpot(isle, 1.5, 0.72) ?? findSpot(isle, 1.1, 0.85, 120);
    if (spot === undefined) break;
    isle.plots.push(new Vector3(spot.x, spot.y, spot.z));
  }
  isle.plots.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
}

// ---------------------------------------------------------------- dressing

/** What the archipelago's dressing gathers before it is merged: the props, the lanterns, and the parts that move. */
interface Dressing {
  readonly props: BufferGeometry[];
  readonly lamps: BufferGeometry[];
  readonly halos: number[];
  readonly haloZones: number[];
  readonly sails: Matrix4[];
  readonly moored: { matrix: Matrix4; phase: number }[];
  readonly smoke: Vector3[];
  readonly falls: BufferGeometry[];
}

const placing = new Matrix4();
const turning = new Quaternion();
const sizing = new Vector3();
const UP_AXIS = new Vector3(0, 1, 0);

/** Places a prefab on an island at `(x, y, z)` in its own frame, turned `ry` and scaled `s`, into the dressing. */
function put(
  isle: Isle,
  dressing: Dressing,
  prefab: Prefab,
  x: number,
  y: number,
  z: number,
  ry = 0,
  s = 1,
): void {
  turning.setFromAxisAngle(UP_AXIS, ry);
  placing.compose(
    new Vector3(isle.position.x + x, isle.position.y + y, isle.position.z + z),
    turning,
    sizing.set(s, s, s),
  );
  for (const part of [...prefab.solid, ...(prefab.glow ?? [])]) {
    dressing.props.push(zoneAttribute(part.applyMatrix4(placing), isle.index));
  }
  for (const [px, py, pz] of prefab.smoke ?? [])
    dressing.smoke.push(new Vector3(px, py, pz).applyMatrix4(placing));
  if (prefab.hub === undefined) return;
  const [hx, hy, hz] = prefab.hub;
  const hub = new Vector3(hx, hy, hz).applyMatrix4(placing);
  dressing.sails.push(
    new Matrix4().compose(
      hub,
      new Quaternion().setFromAxisAngle(UP_AXIS, ry),
      new Vector3(s * 1.1, s * 1.1, s * 1.1),
    ),
  );
}

/** Places `count` of a prop at free spots `clearance` wide. */
function scatter(
  isle: Isle,
  count: number,
  clearance: number,
  place: (spot: { x: number; y: number; z: number }) => void,
  maxFraction = 0.8,
): void {
  for (let n = 0; n < count; n += 1) {
    const spot = findSpot(isle, clearance, maxFraction);
    if (spot !== undefined) place(spot);
  }
}

/** The landmark at a core island's heart, by its rank among the core: the most depended on gets the ziggurat. */
function coreLandmark(isle: Isle, dressing: Dressing, rank: number): void {
  const random = isle.random;
  const h0 = isle.topHeight(0, 0);
  const landmark = rank % 6;
  if (landmark === 0) {
    const size = Math.min(6.2, isle.radius * 0.7);
    put(isle, dressing, ziggurat(size, 4), 0, h0 - 0.1, 0, 0.3);
    reserve(isle, 0, 0, size * 0.78);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU;
      const d = size;
      if (random() >= 0.75) continue;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      put(
        isle,
        dressing,
        column(random, 1.6 + random() * 1.6, random() < 0.45),
        x,
        isle.topHeight(x, z),
        z,
      );
      reserve(isle, x, z, 0.6);
    }
  } else if (landmark === 1) {
    const ring = Math.min(4.2, isle.radius * 0.55);
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * TAU;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      put(
        isle,
        dressing,
        i % 2 === 1 ? column(random, 2.4, random() < 0.3) : arch(random, 1.0, 2.4),
        x,
        isle.topHeight(x, z),
        z,
        -a + Math.PI / 2,
        0.8,
      );
    }
    reserve(isle, 0, 0, ring + 1);
    put(isle, dressing, obelisk(4.5), 0, h0, 0);
  } else if (landmark === 2) {
    const tips: Vector3[] = [];
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU;
      const x = Math.cos(a) * 2.4;
      const z = Math.sin(a) * 2.4;
      const h = 2.4 + random() * 1.2;
      put(isle, dressing, obelisk(h), x, isle.topHeight(x, z), z);
      tips.push(
        new Vector3(
          isle.position.x + x,
          isle.position.y + isle.topHeight(x, z) + h + 0.35,
          isle.position.z + z,
        ),
      );
    }
    for (let i = 0; i < 5; i += 1) {
      const from = tips[i];
      const to = tips[(i + 2) % 5];
      if (from !== undefined && to !== undefined)
        dressing.props.push(zoneAttribute(beamLit(from, to), isle.index));
    }
    reserve(isle, 0, 0, 3.2);
  } else if (landmark === 3) {
    put(isle, dressing, portal(1.5), 0, h0, 0, isle.outward + Math.PI / 2);
    reserve(isle, 0, 0, 2.5);
  } else if (landmark === 4) {
    put(
      isle,
      dressing,
      {
        solid: [
          xf(box(1.8, 1.0, 1.4, PALETTE.STONE), 0, 0.5, 0),
          xf(prism(2.0, 0.7, 1.7, PALETTE.STONE_2), 0, 1.0, 0),
          xf(box(2.4, 0.2, 2.0, PALETTE.STONE_2), 0, 0.1, 0),
        ],
        glow: [xf(windowPane(0.5, 0.4, 0.05), 0, 0.6, 0.72)],
      },
      0,
      h0,
      0,
      0.4,
    );
    reserve(isle, 0, 0, 2);
  } else {
    put(
      isle,
      dressing,
      {
        solid: [
          xf(cylinder(1.3, 1.4, 0.25, 16, PALETTE.STONE_2), 0, 0.12, 0),
          xf(box(0.1, 1.1, 0.9, PALETTE.STONE_DARK), 0, 0.6, 0, 0.5),
        ],
      },
      0,
      h0,
      0,
    );
    reserve(isle, 0, 0, 1.7);
  }
}

function beamLit(from: Vector3, to: Vector3): BufferGeometry {
  const direction = new Vector3().subVectors(to, from);
  const geometry = lit(new BoxGeometry(0.05, direction.length(), 0.05), PALETTE.CREAM, 1.8);
  return geometry.applyMatrix4(
    new Matrix4().compose(
      new Vector3().addVectors(from, to).multiplyScalar(0.5),
      new Quaternion().setFromUnitVectors(UP_AXIS, direction.normalize()),
      new Vector3(1, 1, 1),
    ),
  );
}

/** A domain island's landmark, chosen by its path: a guild hall, a bell tower, windmills, masts, a vault, a gate, or silos. */
function domainLandmark(isle: Isle, dressing: Dressing): void {
  const random = isle.random;
  const h0 = isle.topHeight(0, 0);
  const landmark = hashOf(isle.zone.path) % 8;
  if (landmark === 0) {
    put(isle, dressing, workshop(random), 0, h0, 0, 0.3, 1.5);
    put(isle, dressing, tower(random, 3.2, "#5b4f9e"), 2.4, isle.topHeight(2.4, 1), 1);
    dressing.props.push(
      zoneAttribute(
        xf(
          lit(new SphereGeometry(0.5, 14, 10), "#c9a2ff", 2.2),
          isle.position.x + 2.4,
          isle.position.y + isle.topHeight(2.4, 1) + 6,
          isle.position.z + 1,
        ),
        isle.index,
      ),
    );
    reserve(isle, 0.8, 0.4, 3.4);
  } else if (landmark === 1) {
    put(isle, dressing, workshop(random), 0, h0, 0, 0.8, 1.5);
    put(isle, dressing, workshop(random), 2.5, isle.topHeight(2.5, -1.4), -1.4, 0.2, 1.05);
    reserve(isle, 1, -0.5, 3.4);
  } else if (landmark === 2) {
    put(isle, dressing, tower(random, 3.5, "#d9a23e"), 0, h0, 0);
    reserve(isle, 0, 0, 1.4);
  } else if (landmark === 3) {
    scatter(
      isle,
      3,
      1.1,
      (spot) => put(isle, dressing, windmill(random), spot.x, spot.y, spot.z, random() * TAU),
      0.7,
    );
  } else if (landmark === 4) {
    scatter(
      isle,
      3,
      0.9,
      (spot) => put(isle, dressing, antenna(3 + random() * 2), spot.x, spot.y, spot.z),
      0.7,
    );
  } else if (landmark === 5) {
    put(isle, dressing, vault(), 0, h0, 0, isle.outward);
    reserve(isle, 0, 0, 1.8);
  } else if (landmark === 6) {
    put(isle, dressing, arch(random, 2.2, 2.6), 0, h0, 0, isle.outward + Math.PI / 2);
    reserve(isle, 0, 0, 2);
  } else {
    scatter(isle, 3, 0.9, (spot) => put(isle, dressing, silo(random), spot.x, spot.y, spot.z), 0.6);
  }
}

/** A surface or tooling island's landmark: the largest of the surface gets the castle, tooling its crane, and the rest a lighthouse, a fair, or a workshop by path. */
function edgeLandmark(isle: Isle, dressing: Dressing, largest: boolean): void {
  const random = isle.random;
  const h0 = isle.topHeight(0, 0);
  if (largest) {
    const solid = [xf(box(3, 2.4, 3, PALETTE.STONE), 0, 1.2, 0)];
    for (const [x, z] of [
      [-1.5, -1.5],
      [1.5, -1.5],
      [1.5, 1.5],
      [-1.5, 1.5],
    ] as const) {
      solid.push(
        xf(cylinder(0.55, 0.6, 3.2, 10, PALETTE.STONE_2), x, 1.6, z),
        xf(cylinder(0.01, 0.75, 1.3, 10, "#3d6fa8"), x, 3.85, z),
      );
    }
    put(
      isle,
      dressing,
      {
        solid,
        glow: [
          xf(windowPane(0.3, 0.5, 3.02), 0, 1.5, 0),
          xf(windowPane(3.02, 0.5, 0.3), 0, 1.5, 0),
        ],
      },
      0,
      h0,
      0,
      0.4,
    );
    reserve(isle, 0, 0, 2.8);
    return;
  }
  if (isle.zone.layer === ZONE_LAYER.TOOLING) {
    put(isle, dressing, crane(), 0, h0, 0, isle.outward);
    reserve(isle, 0, 0, 1.5);
    const spot = findSpot(isle, 1.4, 0.7);
    if (spot !== undefined)
      put(isle, dressing, workshop(random), spot.x, spot.y, spot.z, random() * TAU);
    return;
  }
  const landmark = hashOf(isle.zone.path) % 14;
  if (landmark === 0) {
    const p = edgePoint(isle, isle.outward, 0.75);
    put(isle, dressing, lighthouse(4.2), p.x, p.y, p.z);
    reserve(isle, p.x, p.z, 1.1);
  } else if (landmark === 1) {
    scatter(
      isle,
      Math.min(7, Math.round(isle.radius * 1.2)),
      0.75,
      (spot) => put(isle, dressing, tent(random), spot.x, spot.y, spot.z, random() * TAU),
      0.75,
    );
  } else if (landmark === 2) {
    put(isle, dressing, workshop(random), 0, h0, 0, 0.5);
    reserve(isle, 0, 0, 1.8);
  } else if (landmark === 3) {
    put(isle, dressing, flag("#ff7a59", 2.6), 0, h0, 0);
    reserve(isle, 0, 0, 1);
  }
}

/** Docks on a big island's outward rim, each with an airship moored at it, and a lighthouse to guide them. */
function harbour(isle: Isle, dressing: Dressing): void {
  const random = isle.random;
  const count = isle.radius > 7 ? 3 : 2;
  for (let i = 0; i < count; i += 1) {
    const theta = isle.outward + (i - (count - 1) / 2) * 0.55;
    const p = edgePoint(isle, theta, 0.9);
    const length = 2.4 + random() * 1.5;
    put(isle, dressing, dock(length), p.x, p.y + 0.05, p.z, -theta);
    reserve(isle, p.x, p.z, 1.0);
    const scale = 0.6 + random() * 0.35;
    const moor = new Vector3(
      p.x + Math.cos(theta) * length * 0.6 - Math.sin(theta) * 1.6,
      p.y + 1.6,
      p.z + Math.sin(theta) * length * 0.6 + Math.cos(theta) * 1.6,
    ).add(isle.position);
    dressing.moored.push({
      matrix: new Matrix4().compose(
        moor,
        new Quaternion().setFromAxisAngle(UP_AXIS, -theta - Math.PI / 2),
        new Vector3(scale, scale, scale),
      ),
      phase: random() * 6,
    });
  }
  const p = edgePoint(isle, isle.outward + 1.1, 0.78);
  put(isle, dressing, lighthouse(2.8 + random()), p.x, p.y, p.z);
  reserve(isle, p.x, p.z, 1);
}

/** Dresses one island by its layer: ruins in the core, a working countryside in the domain, towns and harbours at the edge. */
function populate(
  isle: Isle,
  dressing: Dressing,
  rank: { core: number; largestEdge: boolean },
): void {
  const random = isle.random;
  const area = Math.PI * isle.radius * isle.radius;
  const trees = (kinds: readonly [TreeKind, ...TreeKind[]], count: number, scale: number) =>
    scatter(
      isle,
      count,
      0.45,
      (spot) =>
        put(
          isle,
          dressing,
          tree(random, pickOf(random, kinds)),
          spot.x,
          spot.y,
          spot.z,
          random() * TAU,
          scale + random() * 0.3,
        ),
      0.9,
    );
  if (isle.zone.layer === ZONE_LAYER.CORE) {
    coreLandmark(isle, dressing, rank.core);
    scatter(isle, Math.round(isle.radius * 0.9), 0.55, (spot) =>
      put(
        isle,
        dressing,
        column(random, 1 + random() * 2.2, random() < 0.55),
        spot.x,
        spot.y,
        spot.z,
        random() * TAU,
        0.9,
      ),
    );
    scatter(isle, Math.round(isle.radius * 0.25), 1.3, (spot) =>
      put(
        isle,
        dressing,
        arch(random, 1.1, 1.8 + random()),
        spot.x,
        spot.y,
        spot.z,
        random() * TAU,
        0.85,
      ),
    );
    scatter(isle, Math.round(isle.radius * 0.3), 0.5, (spot) =>
      put(isle, dressing, monolith(random), spot.x, spot.y, spot.z, random() * TAU),
    );
    trees([TREE.AUTUMN, TREE.ROUND, TREE.ROUND], Math.round(area * 0.012), 1.0);
    return;
  }
  if (isle.zone.layer === ZONE_LAYER.DOMAIN) {
    domainLandmark(isle, dressing);
    scatter(isle, 1 + Math.floor(isle.radius / 5), 1.1, (spot) =>
      put(isle, dressing, windmill(random), spot.x, spot.y, spot.z, random() * TAU),
    );
    scatter(isle, Math.floor(isle.radius / 6), 1.4, (spot) =>
      put(isle, dressing, workshop(random), spot.x, spot.y, spot.z, random() * TAU),
    );
    scatter(isle, Math.min(24, Math.round(area * 0.04)), 0.8, (spot) =>
      put(isle, dressing, house(random), spot.x, spot.y, spot.z, random() * TAU, 1.1),
    );
    trees(
      [TREE.ROUND, TREE.ROUND, TREE.PINE, TREE.BLOSSOM, TREE.AUTUMN],
      Math.min(46, Math.round(area * 0.06)),
      0.9,
    );
    return;
  }
  edgeLandmark(isle, dressing, rank.largestEdge);
  if (isle.radius > 6.5) harbour(isle, dressing);
  scatter(
    isle,
    Math.min(10, Math.round(isle.radius * 0.65)),
    0.9,
    (spot) =>
      put(
        isle,
        dressing,
        tower(random, 1.6 + random() * 2.6 * Math.min(1.4, isle.radius / 8)),
        spot.x,
        spot.y,
        spot.z,
      ),
    0.75,
  );
  scatter(isle, Math.min(18, Math.round(area * 0.03)), 0.8, (spot) =>
    put(isle, dressing, house(random), spot.x, spot.y, spot.z, random() * TAU),
  );
  trees(
    [TREE.ROUND, TREE.PINE, TREE.PINE, TREE.BLOSSOM],
    Math.min(30, Math.round(area * 0.04)),
    0.9,
  );
}

/** Lantern posts around an island's rim, strung with lights between, lit by what shipped there. */
function rimLanterns(isle: Isle, dressing: Dressing): void {
  const count = Math.round(MathUtils.clamp(isle.radius * 1.6, 6, 26));
  const at = isle.position;
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * TAU + 0.13;
    const p = edgePoint(isle, theta, 0.9);
    dressing.props.push(
      zoneAttribute(
        xf(
          cylinder(0.03, 0.035, 0.9, 4, PALETTE.WOOD_DARK),
          at.x + p.x,
          at.y + p.y + 0.45,
          at.z + p.z,
        ),
        isle.index,
      ),
    );
    dressing.lamps.push(
      zoneAttribute(
        xf(
          new BoxGeometry(0.14, 0.18, 0.14).toNonIndexed(),
          at.x + p.x,
          at.y + p.y + 0.98,
          at.z + p.z,
        ),
        isle.index,
      ),
    );
    dressing.halos.push(at.x + p.x, at.y + p.y + 0.98, at.z + p.z);
    dressing.haloZones.push(isle.index);
    if (i % 2 === 1) continue;
    const q = edgePoint(isle, theta + Math.PI / count, 0.9);
    for (let k = 1; k < 5; k += 1) {
      const t = k / 5;
      dressing.lamps.push(
        zoneAttribute(
          xf(
            new OctahedronGeometry(0.055),
            at.x + MathUtils.lerp(p.x, q.x, t),
            at.y + MathUtils.lerp(p.y, q.y, t) + 0.9 - Math.sin(Math.PI * t) * 0.25,
            at.z + MathUtils.lerp(p.z, q.z, t),
          ),
          isle.index,
        ),
      );
    }
  }
}

/** A waterfall spilling off an island's rim at angle `theta` into the mist below. */
function waterfall(isle: Isle, theta: number): BufferGeometry {
  const p = edgePoint(isle, theta, 1.0).add(isle.position);
  const out = new Vector3(Math.cos(theta), 0, Math.sin(theta));
  const side = new Vector3(-out.z, 0, out.x);
  const length = 24 + isle.radius;
  const width = 0.6 + isle.radius * 0.06;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const spread = width * (1 + t * 1.6);
    for (const s of [-1, 1]) {
      const q = p
        .clone()
        .addScaledVector(out, Math.sqrt(t) * 2.4 + 0.2)
        .addScaledVector(side, s * spread);
      positions.push(q.x, q.y - t * length, q.z);
      uvs.push(s < 0 ? 0 : 1, 1 - t);
    }
    if (i < 24) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new Geometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function fallMaterial(time: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `${GLSL_NOISE}
      uniform float uTime; varying vec2 vUv;
      void main(){
        float n = fbm2(vec2(vUv.x * 7., vUv.y * 2. + uTime * 1.1)); float streak = smoothstep(0.35, 0.8, n);
        float edge = smoothstep(0., 0.2, vUv.x) * smoothstep(1., 0.8, vUv.x); float fade = smoothstep(0., 0.12, vUv.y) * smoothstep(0.0, 0.75, vUv.y);
        vec3 col = mix(vec3(0.55, 0.66, 0.9), vec3(1.0, 0.95, 0.92), streak);
        gl_FragColor = vec4(col, (0.25 + 0.5 * streak) * edge * fade * 0.6);
        ${GLSL_OUTPUT}
      }`,
  });
}

// ---------------------------------------------------------------- the archipelago

/** What reserves room on the islands before they are dressed: the bridges' anchors. */
type Anchoring = (isles: ReadonlyMap<string, Isle>) => void;

/** The archipelago as the world drives it. */
export interface Archipelago {
  /** Every island by its zone's path, as last built. */
  readonly isles: () => ReadonlyMap<string, Isle>;
  /** How far the archipelago reaches from the scene's centre. */
  readonly extent: () => number;
  /** The middle of the archipelago's bounds, and how far it reaches from there: what the establishing shot frames. */
  readonly framing: () => { readonly middle: Vector3; readonly span: number };
  /** Where chimneys smoke, in the scene's frame. */
  readonly chimneys: () => readonly Vector3[];
  /** Builds the islands for `zones`, letting `anchor` reserve room on them before they are dressed. */
  readonly build: (zones: readonly ZoneView[], anchor: Anchoring) => void;
  /** Rings the zones in the blast radius, by distance; none for an empty one. */
  readonly ring: (blast: ReadonlyMap<string, number>) => void;
  /** Whether the rim lanterns may burn: the shipped layer. */
  readonly setLanterns: (on: boolean) => void;
  readonly frame: (elapsed: number) => void;
  readonly placeStill: () => void;
}

/** The archipelago, its meshes allocated in `scene` and filled by `build`, each island picked by an invisible stand-in for its top and rock. */
export function archipelagoOf(
  scene: Scene,
  picking: WorldPicking,
  uniforms: ZoneUniforms,
  time: { value: number },
): Archipelago {
  const topMaterial = zoneLitMaterial(uniforms, ZONE_SURFACE.TOP);
  const underMaterial = zoneLitMaterial(uniforms, ZONE_SURFACE.UNDERSIDE);
  const propMaterial = zoneLitMaterial(uniforms, ZONE_SURFACE.PROPS);
  const lampsOn = { value: 1 };
  const top = new Mesh(new Geometry(), topMaterial);
  const under = new Mesh(new Geometry(), underMaterial);
  const props = new Mesh(new Geometry(), propMaterial);
  const lamps = new Mesh(new Geometry(), lanternMaterial(uniforms, lampsOn));
  const halos = new Points(new Geometry(), haloMaterial(uniforms, lampsOn));
  halos.frustumCulled = false;
  const falls = new Mesh(new Geometry(), fallMaterial(time));
  falls.renderOrder = 4;
  for (const mesh of [top, under, props]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const moving = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    flatShading: true,
  });
  const sailMesh = new InstancedMesh(sails(), moving, MOVING.SAILS);
  const mooredMesh = new InstancedMesh(airshipHull(PALETTE.CANVAS[0]), moving, MOVING.MOORED);
  const fragmentMesh = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ color: "#9c7f6a", roughness: 0.9, flatShading: true }),
    MOVING.FRAGMENTS,
  );
  const rings = new InstancedMesh(
    new RingGeometry(0.92, 1, 96).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
    FACTORY_WORLD_BOUNDS.MAX_ZONES * 2,
  );
  for (const mesh of [sailMesh, mooredMesh, fragmentMesh, rings]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  sailMesh.castShadow = true;
  mooredMesh.castShadow = true;
  fragmentMesh.castShadow = true;
  // Note that an island is picked by a column from its top down through its rock, so what stands on its top is met first.
  const stands = new InstancedMesh(
    new CylinderGeometry(1, 1, 1, 16).translate(0, -0.5, 0),
    new MeshBasicMaterial({ visible: false }),
    FACTORY_WORLD_BOUNDS.MAX_ZONES,
  );
  stands.count = 0;
  stands.frustumCulled = false;
  scene.add(
    top,
    under,
    props,
    lamps,
    halos,
    falls,
    sailMesh,
    mooredMesh,
    fragmentMesh,
    rings,
    stands,
  );

  let isles = new Map<string, Isle>();
  let standing: PickTarget[] = [];
  picking.addInstances(stands, (instanceId) => standing[instanceId]);
  let extent = 60;
  let framing = { middle: new Vector3(), span: 60 };
  let chimneys: Vector3[] = [];
  let sailBases: Matrix4[] = [];
  let mooredBases: { matrix: Matrix4; phase: number }[] = [];
  let fragments: { isle: Isle; at: Vector3; size: number; phase: number; spin: number }[] = [];
  let ringed: { isle: Isle; distance: number; touched: boolean }[] = [];
  const object = new Object3D();
  const spin = new Matrix4();
  const tint = new Color();

  const swap = (mesh: Mesh | Points, geometry: BufferGeometry | null) => {
    mesh.geometry.dispose();
    mesh.geometry = geometry ?? new Geometry();
  };

  const placeMoving = (elapsed: number) => {
    sailBases.forEach((base, index) => {
      sailMesh.setMatrixAt(
        index,
        spin.makeRotationZ(elapsed * (0.9 + (index % 5) * 0.12)).premultiply(base),
      );
    });
    sailMesh.instanceMatrix.needsUpdate = true;
    mooredBases.forEach(({ matrix, phase }, index) => {
      object.matrix.copy(matrix);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.position.y += Math.sin(elapsed * 0.9 + phase) * 0.18;
      object.rotateZ(Math.sin(elapsed * 0.7 + phase) * 0.04);
      object.updateMatrix();
      mooredMesh.setMatrixAt(index, object.matrix);
    });
    mooredMesh.instanceMatrix.needsUpdate = true;
    fragments.forEach((fragment, index) => {
      object.position.copy(fragment.at).add(fragment.isle.position);
      object.position.y += Math.sin(elapsed * 0.6 + fragment.phase) * 0.5;
      object.rotation.set(fragment.spin + elapsed * 0.05, fragment.spin, 0);
      object.scale.setScalar(fragment.size);
      object.updateMatrix();
      fragmentMesh.setMatrixAt(index, object.matrix);
    });
    fragmentMesh.instanceMatrix.needsUpdate = true;
  };

  const placeRings = (elapsed: number, still: boolean) => {
    let index = 0;
    for (const { isle, distance, touched } of ringed) {
      for (const k of [0, 0.5]) {
        const t = still ? 0.35 + k * 0.4 : (((elapsed * 0.6 - distance * 0.35 + k) % 1) + 1) % 1;
        object.position.set(
          isle.position.x,
          isle.position.y + isle.topHeight(0, 0) + 0.3,
          isle.position.z,
        );
        object.rotation.set(0, 0, 0);
        object.scale.setScalar(isle.radius * (0.7 + t * 0.75));
        object.updateMatrix();
        rings.setMatrixAt(index, object.matrix);
        rings.setColorAt(
          index,
          tint.copy(uniforms.uBlast.value).multiplyScalar((touched ? 2.2 : 1.6) * (1 - t)),
        );
        index += 1;
      }
    }
    rings.count = index;
    rings.instanceMatrix.needsUpdate = true;
    if (rings.instanceColor !== null) rings.instanceColor.needsUpdate = true;
  };

  return {
    isles: () => isles,
    extent: () => extent,
    framing: () => framing,
    chimneys: () => chimneys,
    build: (zones, anchor) => {
      const layout = layoutOf(zones);
      extent = layout.extent;
      framing = { middle: layout.middle, span: layout.span };
      const shapes = layout.placements.map(islandShape);
      isles = new Map(shapes.map(({ isle }) => [isle.zone.path, isle]));
      anchor(isles);
      for (const { isle } of shapes) reservePlots(isle);
      const dressing: Dressing = {
        props: [],
        lamps: [],
        halos: [],
        haloZones: [],
        sails: [],
        moored: [],
        smoke: [],
        falls: [],
      };
      const core = shapes
        .filter(({ isle }) => isle.zone.layer === ZONE_LAYER.CORE)
        .sort(
          (a, b) =>
            b.isle.zone.transitiveDependents - a.isle.zone.transitiveDependents ||
            (a.isle.zone.path < b.isle.zone.path ? -1 : 1),
        );
      const largestEdge = shapes
        .filter(({ isle }) => isle.zone.layer === ZONE_LAYER.SURFACE)
        .sort((a, b) => b.isle.radius - a.isle.radius)[0]?.isle;
      for (const { isle } of shapes) {
        populate(isle, dressing, {
          core: core.findIndex((entry) => entry.isle === isle),
          largestEdge: isle === largestEdge,
        });
        rimLanterns(isle, dressing);
      }
      const spilling = shapes
        .filter(({ isle }) => isle.zone.footprint >= 0.35)
        .sort((a, b) => b.isle.radius - a.isle.radius)
        .slice(0, 3);
      spilling.forEach(({ isle }, order) => {
        dressing.falls.push(waterfall(isle, isle.outward + (order % 2 === 0 ? 0.4 : 2.2)));
      });
      swap(top, merged(shapes.map((shape) => shape.top)));
      swap(under, merged(shapes.map((shape) => shape.under)));
      swap(props, merged(dressing.props));
      swap(lamps, merged(dressing.lamps));
      swap(falls, merged(dressing.falls));
      const haloGeometry = new Geometry();
      haloGeometry.setAttribute("position", new Float32BufferAttribute(dressing.halos, 3));
      haloGeometry.setAttribute("zone", new Float32BufferAttribute(dressing.haloZones, 1));
      haloGeometry.setAttribute(
        "aSize",
        new Float32BufferAttribute(
          dressing.haloZones.map(() => 1.4),
          1,
        ),
      );
      swap(halos, haloGeometry);
      chimneys = dressing.smoke;
      sailBases = dressing.sails.slice(0, MOVING.SAILS);
      mooredBases = dressing.moored.slice(0, MOVING.MOORED);
      sailMesh.count = sailBases.length;
      mooredMesh.count = mooredBases.length;
      fragments = shapes
        .flatMap(({ isle }) => {
          const random = randomOf(hashOf(isle.zone.path) ^ 0xf4a9);
          return Array.from({ length: Math.round(isle.radius * 0.5) }, () => {
            const theta = random() * TAU;
            const d = isle.radius * (0.5 + random() * 0.9);
            return {
              isle,
              at: new Vector3(
                Math.cos(theta) * d,
                -isle.depth * (0.3 + random() * 0.6) - 2,
                Math.sin(theta) * d,
              ),
              size: 0.3 + random() * isle.radius * 0.06,
              phase: random() * TAU,
              spin: random() * 6,
            };
          });
        })
        .slice(0, MOVING.FRAGMENTS);
      fragmentMesh.count = fragments.length;
      standing = shapes.map(({ isle }) => ({ kind: PICK_KIND.ZONE, id: isle.zone.path }));
      shapes.forEach(({ isle }, index) => {
        object.position.set(
          isle.position.x,
          isle.position.y + isle.topHeight(0, 0) - 0.05,
          isle.position.z,
        );
        object.rotation.set(0, 0, 0);
        object.scale.set(isle.radius * 0.95, isle.depth + 1.5, isle.radius * 0.95);
        object.updateMatrix();
        stands.setMatrixAt(index, object.matrix);
      });
      stands.count = shapes.length;
      stands.instanceMatrix.needsUpdate = true;
      placeMoving(0);
    },
    ring: (blast) => {
      ringed = [...blast].flatMap(([path, distance]) => {
        const isle = isles.get(path);
        return isle === undefined ? [] : [{ isle, distance, touched: distance === 0 }];
      });
      placeRings(time.value, uniforms.uStill.value > 0.5);
    },
    setLanterns: (on) => {
      lampsOn.value = on ? 1 : 0;
    },
    frame: (elapsed) => {
      placeMoving(elapsed);
      placeRings(elapsed, false);
    },
    placeStill: () => {
      placeMoving(0);
      placeRings(0, true);
    },
  };
}
