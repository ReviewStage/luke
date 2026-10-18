import type { WorldPoint } from "@luke/panel/factory-world/world";
import { ZONE_LAYER, type ZoneLayer, type ZoneView } from "@luke/ui/factory-world";
import { angleBetween, clamp, polar, TAU } from "./math";
import { HILL, INNER_GATES, KEEP_GATES } from "./terrain";

/**
 * layout.ts -- where each zone stands on the hill: the core in the keep, the domain in the bailey, the surface along the outer curtain and in the town outside it, and the tooling out in the fields.
 *
 * Each zone keeps its place from the view model's layout (`zone-layout.ts`):
 * its angle is its own, and its radius within its ring's band is mapped into
 * its terrace's band here, so the same path stands in the same place every
 * time it is opened. Then the zones of a terrace are pushed apart until none
 * stands on another or on a gate's ramp, and a crowded terrace builds
 * smaller; that is the one way a zone's place depends on the others.
 *
 * The heart of the keep, its donjon, is the core zone the most of the
 * product depends on. A surface zone owns the stretch of the outer curtain
 * nearest it by angle, from midway to its neighbour on one side to midway
 * to its neighbour on the other.
 */

/** One zone as the Citadel builds it: where, how large, and what the build found there. */
export interface ZoneSite {
  /** The zone as of the latest view: its place and size are the layout's, its glow the instant's. */
  zone: ZoneView;
  /** Its index in the view's zones, which is its instance among the zones' pick proxies. */
  readonly index: number;
  readonly layer: ZoneLayer;
  /** Whether it is the keep's donjon. */
  readonly heart: boolean;
  /** Its place on the floor, polar and plain. */
  angle: number;
  radius: number;
  x: number;
  z: number;
  /** Its reach from its centre, in scene units: a tower's radius, a hall's half-length. */
  size: number;
  /** For a surface zone, the stretch of the outer curtain it owns, as angles from `from` turning to `to`. */
  from: number;
  to: number;
  /** Where its building's foot stands, and its highest point, which the build fills in. */
  base: number;
  top: number;
  /** The point at its crown a lantern hangs over and a beacon rises from. */
  crown: WorldPoint;
  /** Where its torches stand, one per pull request merged in it, in order. */
  readonly torches: WorldPoint[];
}

/** One terrace: the scene radii its layer's ring maps to, a building's least size and its growth with its footprint, and the room kept between buildings. */
interface Terrace {
  readonly inner: number;
  readonly outer: number;
  readonly size: number;
  readonly grow: number;
  readonly gap: number;
}

/** Each terrace's band, the scene radius the inner and outer edge of its layer's ring map to, and how large its buildings stand. */
const TERRACE = {
  [ZONE_LAYER.CORE]: { inner: 3, outer: 15.6, size: 1.1, grow: 1.25, gap: 0.8 },
  [ZONE_LAYER.DOMAIN]: { inner: 16.4, outer: 36.9, size: 1.9, grow: 4.4, gap: 2.2 },
  [ZONE_LAYER.SURFACE]: { inner: 49, outer: 64, size: 2.6, grow: 4, gap: 0 },
  [ZONE_LAYER.TOOLING]: { inner: 66, outer: 86, size: 3, grow: 3, gap: 7 },
} as const satisfies Record<ZoneLayer, Terrace>;

/** How far a building reaches past its size, for each terrace's kinds of building. */
const SPREAD = {
  [ZONE_LAYER.CORE]: 1.15,
  [ZONE_LAYER.DOMAIN]: 1.3,
  [ZONE_LAYER.SURFACE]: 1,
  [ZONE_LAYER.TOOLING]: 1.2,
} as const satisfies Record<ZoneLayer, number>;

/** Where on the floor a zone's terrace lets it stand: its nearest and farthest radius for its size. */
function bandOf(layer: ZoneLayer, size: number, heart: boolean): readonly [number, number] {
  const reach = size * SPREAD[layer];
  switch (layer) {
    case ZONE_LAYER.CORE:
      return [(heart ? 4.8 : 1.5) + reach, HILL.KEEP_RADIUS - 1.6 - reach];
    case ZONE_LAYER.DOMAIN:
      return [HILL.KEEP_RADIUS + 2.1 + reach, HILL.INNER_RADIUS - 1.3 - reach];
    case ZONE_LAYER.SURFACE:
      return [TERRACE[layer].inner, TERRACE[layer].outer];
    case ZONE_LAYER.TOOLING:
      return [68 + reach, 86 - reach * 0.5];
  }
}

/** The gate ramps a building stands clear of, as circles on the floor. */
const RAMPS = [
  ...KEEP_GATES.flatMap((gate) => [
    { ...circleAt(11.6, gate), radius: 2.3 },
    { ...circleAt(18.6, gate), radius: 2.6 },
  ]),
  ...INNER_GATES.flatMap((gate) => [
    { ...circleAt(34.6, gate), radius: 3 },
    { ...circleAt(39.5, gate), radius: 3 },
  ]),
];

/** A point on the floor. */
interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

function circleAt(radius: number, angle: number): FloorPoint {
  const [x, z] = polar(radius, angle);
  return { x, z };
}

/** The zone the product leans on most: the most dependents, then the most bytes, then the first path. */
function heartOf(zones: readonly ZoneView[]): ZoneView | undefined {
  return zones
    .filter((zone) => zone.layer === ZONE_LAYER.CORE)
    .sort(
      (left, right) =>
        right.transitiveDependents - left.transitiveDependents ||
        right.bytes - left.bytes ||
        (left.path < right.path ? -1 : 1),
    )[0];
}

/** Pushes a terrace's sites apart, and off the ramps, until none overlaps another. */
function settle(sites: readonly ZoneSite[]): void {
  for (let pass = 0; pass < 16; pass += 1) {
    for (const [index, site] of sites.entries()) {
      const reach = site.size * SPREAD[site.layer];
      for (const other of sites.slice(index + 1)) {
        const dx = other.x - site.x;
        const dz = other.z - site.z;
        const distance = Math.hypot(dx, dz) || 0.001;
        const wanted = reach + other.size * SPREAD[other.layer] + TERRACE[site.layer].gap;
        if (distance >= wanted) continue;
        const push = (wanted - distance) / 2 / distance;
        site.x -= dx * push;
        site.z -= dz * push;
        other.x += dx * push;
        other.z += dz * push;
      }
      if (site.layer === ZONE_LAYER.CORE || site.layer === ZONE_LAYER.DOMAIN) {
        for (const ramp of RAMPS) {
          const dx = site.x - ramp.x;
          const dz = site.z - ramp.z;
          const distance = Math.hypot(dx, dz) || 0.001;
          const wanted = reach * 0.8 + ramp.radius;
          if (distance >= wanted) continue;
          site.x += (dx / distance) * (wanted - distance);
          site.z += (dz / distance) * (wanted - distance);
        }
      }
    }
    for (const site of sites) {
      const [nearest, farthest] = bandOf(site.layer, site.size, site.heart);
      const radius = clamp(Math.hypot(site.x, site.z), nearest, Math.max(nearest, farthest));
      site.angle = Math.atan2(site.z, site.x);
      site.radius = radius;
      [site.x, site.z] = polar(radius, site.angle);
    }
  }
}

/** Shrinks a crowded terrace's buildings until their widths fit around it, two deep. */
function fitTerrace(sites: readonly ZoneSite[]): void {
  const first = sites[0];
  if (first === undefined || first.layer === ZONE_LAYER.SURFACE) return;
  const terrace = TERRACE[first.layer];
  const around = TAU * ((terrace.inner + terrace.outer) / 2) * 1.7;
  const wanted = sites.reduce(
    (sum, site) => sum + 2 * site.size * SPREAD[site.layer] + terrace.gap,
    0,
  );
  if (wanted <= around) return;
  const share = Math.max(0.35, around / wanted);
  for (const site of sites) site.size *= share;
}

/** Gives each surface site the stretch of curtain nearest it: midway to the neighbour on either side. */
function divideCurtain(sites: readonly ZoneSite[]): void {
  const sorted = [...sites].sort((left, right) => left.angle - right.angle);
  if (sorted.length === 1 && sorted[0] !== undefined) {
    sorted[0].from = sorted[0].angle - Math.PI;
    sorted[0].to = sorted[0].angle + Math.PI;
    return;
  }
  sorted.forEach((site, index) => {
    const before = sorted[(index - 1 + sorted.length) % sorted.length] ?? site;
    const after = sorted[(index + 1) % sorted.length] ?? site;
    site.from = site.angle - Math.abs(angleBetween(site.angle, before.angle)) / 2;
    site.to = site.angle + Math.abs(angleBetween(after.angle, site.angle)) / 2;
  });
}

/** Every zone's site on the hill, in the view's order. */
export function layoutOf(zones: readonly ZoneView[]): ZoneSite[] {
  const heart = heartOf(zones);
  const sites = zones.map((zone, index): ZoneSite => {
    const terrace = TERRACE[zone.layer];
    const isHeart = zone === heart;
    // Note that the layout's own place is read from its x and y alone: its angle, and how far across its ring's band it stands.
    const angle = Math.atan2(zone.y, zone.x);
    const across = clamp(Math.hypot(zone.x, zone.y) - zone.ring, 0, 1);
    const radius = isHeart ? 0 : terrace.inner + across * (terrace.outer - terrace.inner);
    const [x, z] = polar(radius, angle);
    return {
      zone,
      index,
      layer: zone.layer,
      heart: isHeart,
      angle,
      radius,
      x,
      z,
      size: isHeart ? 3.2 + zone.footprint * 1.2 : terrace.size + zone.footprint * terrace.grow,
      from: angle,
      to: angle,
      base: 0,
      top: 0,
      crown: { x, y: 0, z },
      torches: [],
    };
  });
  for (const layer of Object.values(ZONE_LAYER)) {
    const terrace = sites.filter((site) => site.layer === layer && !site.heart);
    if (terrace.length === 0) continue;
    if (layer === ZONE_LAYER.SURFACE) {
      divideCurtain(terrace);
      continue;
    }
    fitTerrace(terrace);
    settle(terrace);
  }
  return sites;
}

/** Whether two layouts were read from the same zones, placed and sized the same and ranked for the heart the same: the test for whether the town must be rebuilt. */
export function sameZones(left: readonly ZoneView[], right: readonly ZoneView[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((zone, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      other.path === zone.path &&
      other.layer === zone.layer &&
      other.x === zone.x &&
      other.y === zone.y &&
      other.ring === zone.ring &&
      other.footprint === zone.footprint &&
      other.bytes === zone.bytes &&
      other.transitiveDependents === zone.transitiveDependents
    );
  });
}
