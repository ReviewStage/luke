import { ZONE_LAYER, type ZoneLayer, type ZoneView } from "@luke/ui/factory-world";
import { Color } from "three";
import { FILL_SLOT } from "./glsl";

/**
 * layout.ts -- the Neon Megacity's ground plan: where each zone's district stands on its ring, how wide and how tall it is, every building in it, and the filler city and sprawl around them.
 *
 * The plan reads the view model's polar layout and nothing else, so the same
 * path lands in the same place every time. A zone's ring band maps onto a
 * ring of the city between two ring roads (`CITY`), its angle is kept, and
 * its offset within the band is kept as far as its district fits. A
 * district's width follows its footprint, shrunk where its ring holds more
 * than the ring can seat, and districts that overlap are pushed apart in
 * path order until they stand clear, so the result depends on the zones
 * alone.
 *
 * Each district is generated from its path's own seed: a core zone is a
 * stepped arcology at its heart, any other a central tower, and a block grid
 * of lesser towers fills the rest, tallest towards the centre, leaving a few
 * empty lots at the edge where planned work stands as a ghost tower. The
 * filler city covers the ground between districts out to the last ring
 * road, and the sprawl runs from there to the horizon.
 */

/** The city's rings, in scene units. */
export const CITY = {
  /** The plaza around the data core, where nothing is built. */
  PLAZA: 15,
  /** Where the layout's centre ring starts, from the city's centre. */
  RING_START: 22,
  /** How wide one of the layout's rings stands. */
  RING_WIDTH: 70,
  /** How far the sprawl runs, from the centre. */
  SPRAWL: 600,
  /** The narrowest a district gets, however crowded its ring. */
  MIN_RADIUS: 4,
  /** The space kept between two districts, and between a district and a road. */
  GAP: 4,
  /** Where the establishing shot stands on the ground, which the sprawl keeps low around so no tower stands in front of it. */
  HOME_X: 270,
  HOME_Z: 315,
} as const;

/** How a building is drawn: the shader's branch for its windows and trim. */
export const BUILDING_STYLE = {
  FILL: 0,
  DOMAIN: 1,
  ARCOLOGY: 2,
  SURFACE: 3,
  CORE_SAT: 4,
  SPRAWL: 5,
} as const;

type BuildingStyle = (typeof BUILDING_STYLE)[keyof typeof BUILDING_STYLE];

/** The most buildings districts hold between them, and the most around them. */
export const BUILDING_BOUNDS = {
  DISTRICT: 12_000,
  FILLER: 10_000,
} as const;

/** How many empty lots a district keeps at its edge for ghost towers. */
const LOTS_PER_ZONE = 3;

/** How many rounds districts are pushed apart. */
const RELAX_ROUNDS = 160;

/** Each layer's neon accents, a district taking one by its path. */
const LAYER_ACCENTS = {
  [ZONE_LAYER.CORE]: ["#7fe3ff", "#9fd4ff"],
  [ZONE_LAYER.DOMAIN]: ["#8f7dff", "#7a8cff", "#a07dff"],
  [ZONE_LAYER.SURFACE]: ["#c27dff", "#9d8bff", "#d08cff", "#8fa0ff"],
  [ZONE_LAYER.TOOLING]: ["#7f8db0"],
} as const satisfies Record<ZoneLayer, readonly string[]>;

/** One building: a box on the ground, in scene units. */
export interface Building {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly style: BuildingStyle;
  readonly rot: number;
  /** Its zone's slot in the state texture, or `FILL_SLOT`. */
  readonly slot: number;
  readonly seed: number;
  /** Whether a worker or a shipped beam may stand on its roof. */
  readonly site: boolean;
}

/** A point on the ground. */
interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/** One zone's district. */
export interface District {
  readonly zone: ZoneView;
  readonly slot: number;
  readonly x: number;
  readonly z: number;
  /** Its radius on the ground. */
  readonly r: number;
  /** Its crown: the tallest roof in it. */
  readonly height: number;
  readonly accent: Color;
  readonly buildings: readonly Building[];
  /** The roofs a worker or a beam may stand on, the tallest first. */
  readonly sites: readonly Building[];
  /** The empty lots at its edge. */
  readonly lots: readonly GroundPoint[];
}

/** The whole plan. */
export interface CityLayout {
  readonly districts: readonly District[];
  readonly districtByPath: ReadonlyMap<string, District>;
  readonly buildings: readonly Building[];
  readonly fillers: readonly Building[];
  /** The three ring roads, from the centre out. */
  readonly roads: readonly [number, number, number];
}

/** A seeded generator of numbers in [0, 1): mulberry32. */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What one item's separate draws are hashed under, so each is independent of the others. */
export const HASH_SALT = {
  X: 1,
  Z: 2,
  WIDTH: 3,
  SIDE: 4,
  HEIGHT: 5,
  RISE: 6,
  BOARD: 7,
  SPEED: 8,
  TRIP: 9,
  BLINK: 10,
} as const;

/**
 * `parts` hashed into [0, 1): FNV-1a over each part's length and then its
 * characters, so two lists of parts never hash alike merely because they
 * read alike end to end.
 */
export function unitHash(...parts: readonly (string | number)[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    const text = String(part);
    hash = Math.imul(hash ^ text.length, 16777619);
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
  }
  return (hash >>> 0) / 4294967296;
}

/** The scene radius of the layout's radius `u`. */
function ringRadius(u: number): number {
  return CITY.RING_START + u * CITY.RING_WIDTH;
}

/** How tall a zone's district rises: a core zone an arcology, the rest by layer, each growing with its files. */
function heightOf(zone: ZoneView): number {
  const grown = Math.min(5.5, Math.log1p(zone.files) * 0.9);
  switch (zone.layer) {
    case ZONE_LAYER.CORE:
      return 44 + 8 * grown;
    case ZONE_LAYER.DOMAIN:
      return 10 + 4.4 * grown;
    case ZONE_LAYER.SURFACE:
      return 5 + 3.4 * grown;
    case ZONE_LAYER.TOOLING:
      return 6 + 2.6 * grown;
  }
}

/** A district's place before its neighbours push it: the layout's, mapped onto the city's rings. */
interface Seat {
  readonly zone: ZoneView;
  x: number;
  z: number;
  r: number;
  readonly inner: number;
  readonly outer: number;
}

/** Holds a seat inside its ring's band. */
function clampToBand(seat: Seat): void {
  const radius = Math.hypot(seat.x, seat.z);
  const inner = seat.inner + seat.r;
  const outer = Math.max(inner, seat.outer - seat.r);
  const held = Math.min(outer, Math.max(inner, radius));
  if (radius < 1e-6) {
    seat.x = held;
    return;
  }
  seat.x *= held / radius;
  seat.z *= held / radius;
}

/**
 * One ring's seats, each at the layout's own angle and its own offset
 * within the band, a district's width following its footprint and shrunk
 * where the ring holds more than it can seat in two staggered rows.
 */
function ringSeats(ring: number, members: readonly ZoneView[]): Seat[] {
  const inner = ring === 0 ? CITY.PLAZA + 6 : ringRadius(ring) + 6;
  const outer = ringRadius(ring + 1) - 6;
  const wanted = members.map((zone) => 7 + 21 * zone.footprint);
  const need = wanted.reduce((sum, r) => sum + 2 * r + CITY.GAP, 0);
  const room = 2 * Math.PI * ((inner + outer) / 2) * 2;
  const shrink = Math.min(1, room / need);
  return members.map((zone, index) => {
    // Note that the layout's point is mapped outward past the plaza, keeping its bearing from the centre.
    const out = Math.hypot(zone.x, zone.y);
    const radius = ringRadius(out);
    const angle = Math.atan2(zone.y, zone.x);
    return {
      zone,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      r: Math.max(CITY.MIN_RADIUS, (wanted[index] ?? 0) * shrink),
      inner,
      outer,
    };
  });
}

/** Every zone's seat, placed on its ring and pushed clear of its neighbours. */
function seatsOf(zones: readonly ZoneView[]): Seat[] {
  const byRing = new Map<number, ZoneView[]>();
  for (const zone of zones) byRing.set(zone.ring, [...(byRing.get(zone.ring) ?? []), zone]);
  const seats = [...byRing].flatMap(([ring, members]) => ringSeats(ring, members));
  seats.sort((left, right) => (left.zone.path < right.zone.path ? -1 : 1));
  for (const seat of seats) clampToBand(seat);
  for (let round = 0; round < RELAX_ROUNDS; round += 1) {
    let moved = false;
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const a = seats[i];
        const b = seats[j];
        if (a === undefined || b === undefined) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const least = a.r + b.r + CITY.GAP;
        const apart = Math.hypot(dx, dz);
        if (apart >= least) continue;
        const ux = apart < 1e-6 ? 1 : dx / apart;
        const uz = apart < 1e-6 ? 0 : dz / apart;
        const push = (least - apart) / 2;
        a.x -= ux * push;
        a.z -= uz * push;
        b.x += ux * push;
        b.z += uz * push;
        moved = true;
      }
    }
    for (const seat of seats) clampToBand(seat);
    if (!moved) break;
  }
  return seats;
}

/** The empty lots at a district's edge, spread evenly around it from its path's own angle. */
function lotsOf(zone: ZoneView, x: number, z: number, r: number): GroundPoint[] {
  const start = unitHash(zone.path) * Math.PI * 2;
  const reach = r * (zone.layer === ZONE_LAYER.CORE ? 0.86 : 0.7);
  return Array.from({ length: LOTS_PER_ZONE }, (_, index) => {
    const angle = start + (index * Math.PI * 2) / LOTS_PER_ZONE;
    return { x: x + Math.cos(angle) * reach, z: z + Math.sin(angle) * reach };
  });
}

/** One district's buildings: its heart and the block grid around it, clear of its lots. */
function districtBuildings(
  seat: Seat,
  slot: number,
  height: number,
  lots: readonly GroundPoint[],
): Building[] {
  const { zone, x: cx, z: cz, r } = seat;
  const random = seededRandom(Math.floor(unitHash(zone.path) * 1e9));
  const core = zone.layer === ZONE_LAYER.CORE;
  const style = core
    ? BUILDING_STYLE.CORE_SAT
    : zone.layer === ZONE_LAYER.SURFACE
      ? BUILDING_STYLE.SURFACE
      : BUILDING_STYLE.DOMAIN;
  const cell = core ? 6.0 : zone.layer === ZONE_LAYER.SURFACE ? 4.6 : 5.2;
  const out: Building[] = [];
  const add = (building: Omit<Building, "slot" | "seed">) =>
    out.push({ ...building, slot, seed: random() });
  let inner: number;
  if (core) {
    // Note that an arcology is five nested tiers turned to face the plaza, the top two its roofs.
    const rot = -Math.atan2(cz, cx) + Math.PI / 4;
    const tiers = [
      [1.3, 0.13],
      [1.0, 0.4],
      [0.76, 0.68],
      [0.52, 0.88],
      [0.2, 1.0],
    ] as const;
    for (const [index, [width, rise]] of tiers.entries()) {
      add({
        x: cx,
        z: cz,
        w: width * r,
        d: width * r,
        h: height * rise,
        style: BUILDING_STYLE.ARCOLOGY,
        rot,
        site: index >= tiers.length - 2,
      });
    }
    inner = r * 0.78;
  } else {
    const width = Math.min(r * 1.1, cell * (zone.layer === ZONE_LAYER.DOMAIN ? 1.35 : 1.1));
    add({ x: cx, z: cz, w: width, d: width, h: height, style, rot: 0, site: true });
    inner = width * 0.72;
  }
  const n = Math.ceil(r / cell) + 1;
  for (let i = -n; i <= n; i += 1) {
    for (let j = -n; j <= n; j += 1) {
      const x = cx + i * cell + (random() - 0.5) * 0.6;
      const z = cz + j * cell + (random() - 0.5) * 0.6;
      const from = Math.hypot(x - cx, z - cz);
      if (from > r - cell * 0.45 || from < inner + cell * 0.42) continue;
      if (lots.some((lot) => Math.hypot(lot.x - x, lot.z - z) < 5.5)) continue;
      if (random() < 0.08) continue;
      const nearness = 1 - from / r;
      const h = Math.max(
        2.5,
        height * (0.14 + 0.62 * nearness ** 1.25) * (0.55 + 0.7 * random()) * (core ? 0.75 : 1),
      );
      add({
        x,
        z,
        w: cell * (0.52 + 0.3 * random()),
        d: cell * (0.52 + 0.3 * random()),
        h,
        style,
        rot: 0,
        site: h > 6,
      });
    }
  }
  return out;
}

/** The filler city between the districts, out to the last ring road, and the sprawl beyond it to the horizon. */
function fillersOf(
  districts: readonly District[],
  roads: readonly [number, number, number],
): Building[] {
  const random = seededRandom(99);
  const inDistrict = (x: number, z: number, pad: number) =>
    districts.some((district) => Math.hypot(x - district.x, z - district.z) < district.r + pad);
  const onRoad = (radius: number) => roads.some((road) => Math.abs(radius - road) < 6.5);
  const out: Building[] = [];
  const cellIn = 6.6;
  const cellOut = 10.5;
  const edge = roads[2] + 6;
  for (let x = -edge; x <= edge; x += cellIn) {
    for (let z = -edge; z <= edge; z += cellIn) {
      const radius = Math.hypot(x, z);
      if (radius < CITY.PLAZA + 8 || radius > edge || onRoad(radius)) continue;
      if (inDistrict(x, z, 3.5) || random() > 0.62) continue;
      out.push({
        x: x + (random() - 0.5) * 1.2,
        z: z + (random() - 0.5) * 1.2,
        w: cellIn * (0.5 + 0.28 * random()),
        d: cellIn * (0.5 + 0.28 * random()),
        h: 2.2 + random() * random() * 11,
        style: BUILDING_STYLE.FILL,
        rot: 0,
        slot: FILL_SLOT,
        seed: random(),
        site: false,
      });
    }
  }
  for (let x = -CITY.SPRAWL; x <= CITY.SPRAWL; x += cellOut) {
    for (let z = -CITY.SPRAWL; z <= CITY.SPRAWL; z += cellOut) {
      const radius = Math.hypot(x, z);
      if (radius < edge + 4 || radius > CITY.SPRAWL) continue;
      if (inDistrict(x, z, 5) || random() > 0.55) continue;
      const far = Math.min(1, Math.max(0, (radius - edge) / 300));
      const facing = Math.abs(Math.atan2(z, x) - Math.atan2(CITY.HOME_Z, CITY.HOME_X)) < 0.3;
      const inView = facing && radius < Math.hypot(CITY.HOME_X, CITY.HOME_Z) + 60;
      const tall = !inView && radius > edge + 120 && random() < 0.1 + far * 0.12;
      out.push({
        x: x + (random() - 0.5) * 2,
        z: z + (random() - 0.5) * 2,
        w: cellOut * (0.5 + 0.35 * random()),
        d: cellOut * (0.5 + 0.35 * random()),
        h: tall
          ? 40 + random() * random() * 150
          : 3 + random() * random() * (inView ? 8 : 8 + far * 40),
        style: BUILDING_STYLE.SPRAWL,
        rot: 0,
        slot: FILL_SLOT,
        seed: random(),
        site: false,
      });
    }
  }
  return out.slice(0, BUILDING_BOUNDS.FILLER);
}

/** Whether two zone lists would draw the same plan: the same paths, in the same rings, at the same footprints. */
export function samePlan(left: readonly ZoneView[], right: readonly ZoneView[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((zone, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.path === zone.path &&
      other.ring === zone.ring &&
      other.footprint === zone.footprint &&
      other.x === zone.x &&
      other.y === zone.y &&
      other.files === zone.files
    );
  });
}

/** The city's plan for `zones`, each zone's slot its index among them. */
export function cityLayoutOf(zones: readonly ZoneView[]): CityLayout {
  const slotOf = new Map(zones.map((zone, index) => [zone.path, index]));
  const districts: District[] = [];
  const buildings: Building[] = [];
  for (const seat of seatsOf(zones)) {
    const slot = slotOf.get(seat.zone.path) ?? FILL_SLOT;
    const height = heightOf(seat.zone);
    const lots = lotsOf(seat.zone, seat.x, seat.z, seat.r);
    const accents = LAYER_ACCENTS[seat.zone.layer];
    const accent = accents[Math.floor(unitHash(seat.zone.path) * accents.length)] ?? accents[0];
    const room = BUILDING_BOUNDS.DISTRICT - buildings.length;
    const own = districtBuildings(seat, slot, height, lots).slice(0, Math.max(0, room));
    buildings.push(...own);
    districts.push({
      zone: seat.zone,
      slot,
      x: seat.x,
      z: seat.z,
      r: seat.r,
      height,
      accent: new Color(accent),
      buildings: own,
      sites: own.filter((building) => building.site).sort((left, right) => right.h - left.h),
      lots,
    });
  }
  const roads = [ringRadius(1), ringRadius(2), ringRadius(3)] as const;
  return {
    districts,
    districtByPath: new Map(districts.map((district) => [district.zone.path, district])),
    buildings,
    fillers: fillersOf(districts, roads),
    roads,
  };
}

/** The roof a district offers at `index`, cycling its sites; its heart where it has none. */
export function siteOf(district: District, index: number): Building | undefined {
  const sites = district.sites.length > 0 ? district.sites : district.buildings;
  return sites[((index % sites.length) + sites.length) % sites.length];
}
