import { ZONE_LAYER, type ZoneView } from "@luke/ui/factory-world";
import { Vector3 } from "three";
import { unitHashOf } from "./geometry";

/**
 * city.ts -- where each zone stands in Atlantis: the core's crystals under the great dome at the heart, the domain's glass domes in the ring around it, the surface's reefs with their lighthouses beyond, and the tooling's rigs on the rim.
 *
 * A district's place is its zone's place in the view model's layout
 * (`ZoneView`'s `x` and `y`), stretched out from the heart onto the sea
 * floor ring by ring (`sceneRadiusOf`), so the same path lands in the same
 * place every time. Two zones can land close, so the layout then pushes apart any two
 * districts that would overlap, a few passes, always in the same order: the
 * same zones always settle the same way. A district's size is its zone's
 * footprint, and its height follows from what it is.
 */

/** The great dome over the core, and the rings the rest stand in, in scene units. */
export const CITY = {
  /** The great dome's radius. */
  DOME_RADIUS: 42,
  /** The height of the great dome's floor. */
  DOME_FLOOR: 1.9,
  /** How far out from the heart the core's crystals may stand. */
  CORE_REACH: 30,
  /** Where the domain's ring begins: the layout's radius 1. */
  RING_START: 64,
  /** How wide each ring past the core is: one layout unit. */
  RING_WIDTH: 58,
  /** How far from the great dome's wall an outer district's edge keeps. */
  DOME_CLEARANCE: 16,
  /** The open water between two districts. */
  GAP: 2,
} as const;

/** What a district is, by its zone's layer. */
export const DISTRICT_KIND = {
  /** A core zone: a crystal cluster under the great dome. */
  CRYSTAL: "crystal",
  /** A domain zone: a glass dome over a town. */
  DOME: "dome",
  /** A surface zone: a reef with its lighthouse. */
  REEF: "reef",
  /** A tooling zone: a rig on a rock. */
  RIG: "rig",
} as const;

type DistrictKind = (typeof DISTRICT_KIND)[keyof typeof DISTRICT_KIND];

/** One zone as Atlantis builds it. */
export interface District {
  readonly zone: ZoneView;
  /** Its place in the layout's `districts`. */
  readonly index: number;
  readonly kind: DistrictKind;
  /** Where it stands on the floor, y = 0. */
  readonly centre: Vector3;
  /** Its bearing from the heart, in radians. */
  readonly bearing: number;
  /** Its radius: the dome's, the reef's, the crystal's. */
  readonly radius: number;
  /** Where what stands on it stands: the plinth's, the reef's, or the dome floor's height. */
  readonly base: number;
  /** The height of what it raises: the crystal, the lighthouse, the rig. */
  readonly height: number;
  /** Its highest point. */
  readonly top: number;
  /** What it is picked by: an upright cylinder from the floor. */
  readonly hit: { readonly radius: number; readonly height: number };
  /** The shell a defect cracks: its own dome, the great dome for a crystal, none for a reef or a rig, whose rock cracks instead. */
  readonly shell: { readonly centre: Vector3; readonly radius: number } | undefined;
  /** A seed from its path, for everything placed on it. */
  readonly seed: number;
}

/** Every district of one view's zones. */
export interface CityLayout {
  readonly zones: readonly ZoneView[];
  readonly districts: readonly District[];
  readonly byPath: ReadonlyMap<string, District>;
}

/** The layout's polar radius stretched onto the sea floor: the core under the dome, each ring past it one `RING_WIDTH` wide. */
export function sceneRadiusOf(layoutRadius: number): number {
  if (layoutRadius < 1) return (layoutRadius / 0.8) * CITY.CORE_REACH;
  return CITY.RING_START + (layoutRadius - 1) * CITY.RING_WIDTH;
}

/** The band between the domain's ring and the surface's, where planned work waits. */
export const SURVEY_BAND = {
  INNER: sceneRadiusOf(1.92),
  OUTER: sceneRadiusOf(2.18),
} as const;

function kindOf(zone: ZoneView): DistrictKind {
  switch (zone.layer) {
    case ZONE_LAYER.CORE:
      return DISTRICT_KIND.CRYSTAL;
    case ZONE_LAYER.DOMAIN:
      return DISTRICT_KIND.DOME;
    case ZONE_LAYER.SURFACE:
      return DISTRICT_KIND.REEF;
    case ZONE_LAYER.TOOLING:
      return DISTRICT_KIND.RIG;
  }
}

function radiusOf(kind: DistrictKind, footprint: number): number {
  if (kind === DISTRICT_KIND.CRYSTAL) return 1.4 + 2.8 * footprint;
  if (kind === DISTRICT_KIND.RIG) return 3.4 + 9 * footprint;
  return 3.4 + 15 * footprint;
}

/** How far around it a district needs open water: its ring, its corals. */
function clearanceOf(kind: DistrictKind, radius: number): number {
  if (kind === DISTRICT_KIND.CRYSTAL) return radius * 2.6;
  if (kind === DISTRICT_KIND.DOME) return radius + 5;
  return radius * 1.25 + 4;
}

/** The plinth's or the reef's height, and what stands on it. */
function heightsOf(kind: DistrictKind, radius: number, footprint: number) {
  switch (kind) {
    case DISTRICT_KIND.CRYSTAL:
      return { base: CITY.DOME_FLOOR, height: 6 + 26 * footprint };
    case DISTRICT_KIND.DOME:
      return { base: 1.6, height: radius };
    case DISTRICT_KIND.REEF:
      return { base: 2.4 + radius * 0.16, height: 9 + radius * 1.25 };
    case DISTRICT_KIND.RIG:
      return { base: 2.4 + radius * 0.16, height: 10 + radius * 1.6 };
  }
}

/** One district pushed out of another's water, both moving half the overlap. */
function pushApart(
  points: { x: number; z: number }[],
  clearances: readonly number[],
  left: number,
  right: number,
): void {
  const a = points[left];
  const b = points[right];
  const ca = clearances[left];
  const cb = clearances[right];
  if (a === undefined || b === undefined || ca === undefined || cb === undefined) return;
  const need = ca + cb + CITY.GAP;
  let dx = a.x - b.x;
  let dz = a.z - b.z;
  let distance = Math.hypot(dx, dz);
  if (distance >= need) return;
  // Note that two districts standing on one point part along the line their indices name, so the push stays deterministic.
  if (distance < 1e-6) {
    dx = Math.cos(left * 2.399 + right);
    dz = Math.sin(left * 2.399 + right);
    distance = 1;
  }
  const push = (need - Math.min(distance, need)) / 2;
  a.x += (dx / distance) * push;
  a.z += (dz / distance) * push;
  b.x -= (dx / distance) * push;
  b.z -= (dz / distance) * push;
}

/** Holds a district to its side of the great dome's wall: a crystal within it, the rest well clear of it. */
function holdToSide(point: { x: number; z: number }, inside: boolean, clearance: number): void {
  const distance = Math.hypot(point.x, point.z);
  const limit = inside
    ? Math.max(0, CITY.DOME_RADIUS - 4 - clearance)
    : CITY.DOME_RADIUS + CITY.DOME_CLEARANCE + clearance;
  if (inside ? distance <= limit : distance >= limit) return;
  if (distance < 1e-6) {
    if (!inside) point.x = limit;
    return;
  }
  point.x *= limit / distance;
  point.z *= limit / distance;
}

/** How many passes the layout makes to push overlapping districts apart. */
const SETTLE_PASSES = 48;

/** Lays `zones` out as districts on the sea floor. */
export function cityLayoutOf(zones: readonly ZoneView[]): CityLayout {
  const kinds = zones.map(kindOf);
  const radii = zones.map((zone, index) =>
    radiusOf(kinds[index] ?? DISTRICT_KIND.DOME, zone.footprint),
  );
  const clearances = radii.map((radius, index) =>
    clearanceOf(kinds[index] ?? DISTRICT_KIND.DOME, radius),
  );
  const inside = kinds.map((kind) => kind === DISTRICT_KIND.CRYSTAL);
  const points = zones.map((zone) => {
    const out = Math.hypot(zone.x, zone.y);
    const stretch = out < 1e-9 ? 0 : sceneRadiusOf(out) / out;
    return { x: zone.x * stretch, z: zone.y * stretch };
  });
  for (let pass = 0; pass < SETTLE_PASSES; pass += 1) {
    for (let left = 0; left < points.length; left += 1) {
      for (let right = left + 1; right < points.length; right += 1) {
        if (inside[left] === inside[right]) pushApart(points, clearances, left, right);
      }
    }
    points.forEach((point, index) => {
      holdToSide(point, inside[index] === true, clearances[index] ?? 0);
    });
  }
  const districts = zones.map((zone, index): District => {
    const kind = kinds[index] ?? DISTRICT_KIND.DOME;
    const radius = radii[index] ?? 1;
    const point = points[index] ?? { x: 0, z: 0 };
    const centre = new Vector3(point.x, 0, point.z);
    const { base, height } = heightsOf(kind, radius, zone.footprint);
    const top = kind === DISTRICT_KIND.DOME ? base + radius : base + height;
    const hit = {
      [DISTRICT_KIND.CRYSTAL]: { radius: radius * 1.6, height: base + height },
      [DISTRICT_KIND.DOME]: { radius: radius * 1.05, height: top },
      [DISTRICT_KIND.REEF]: { radius: radius * 1.1, height: base + height * 0.6 },
      [DISTRICT_KIND.RIG]: { radius: radius * 0.95, height: top },
    }[kind];
    const shell =
      kind === DISTRICT_KIND.CRYSTAL
        ? { centre: new Vector3(0, CITY.DOME_FLOOR, 0), radius: CITY.DOME_RADIUS }
        : kind === DISTRICT_KIND.DOME
          ? { centre: new Vector3(point.x, base, point.z), radius }
          : undefined;
    return {
      zone,
      index,
      kind,
      centre,
      bearing: Math.atan2(point.z, point.x),
      radius,
      base,
      height,
      top,
      hit,
      shell,
      seed: unitHashOf(zone.path),
    };
  });
  return {
    zones,
    districts,
    byPath: new Map(districts.map((district) => [district.zone.path, district])),
  };
}

/** Whether `layout` was laid out from the same zones, by path and size, as `zones`. */
export function laidOutFrom(layout: CityLayout, zones: readonly ZoneView[]): boolean {
  if (layout.zones === zones) return true;
  if (layout.zones.length !== zones.length) return false;
  return zones.every((zone, index) => {
    const before = layout.zones[index];
    return (
      before !== undefined &&
      before.path === zone.path &&
      before.layer === zone.layer &&
      before.footprint === zone.footprint
    );
  });
}

/** The point on the floor a district is measured from: the heart for a crystal, whose ripples spread from the great dome, its own centre for the rest. */
export function groundOf(district: District): Vector3 {
  return district.kind === DISTRICT_KIND.CRYSTAL ? new Vector3() : district.centre;
}

/** A unit vector along the floor from the heart out through `district`. */
export function outwardOf(district: District): Vector3 {
  return new Vector3(Math.cos(district.bearing), 0, Math.sin(district.bearing));
}
