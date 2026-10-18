/**
 * zone-layout.ts -- where a zone stands on the floor, and how much of it it covers, in units a world maps into its own geometry.
 *
 * The floor is polar. Each layer is a ring one unit wide, the core's from
 * the centre out to 1, the domain's from 1 to 2, and so on
 * (`zone-graph.ts`'s `LAYER_RING`); a zone stands inside its ring's band,
 * kept `BAND_INSET` off either edge, at a radius seeded by its own path.
 *
 * Each ring is used all the way round. Its zones are dealt out in one sweep
 * from angle zero, each taking a slot of the turn in proportion to its
 * footprint and standing at the slot's middle, so the slots tile the ring
 * and two zones' slots never overlap: a world that draws a zone as wide as
 * its footprint draws neighbours apart, a large zone given the room it
 * covers. The sweep takes the zones by their top-level directory, so a
 * directory's zones hold one unbroken arc, and the directories in the order
 * of an angle seeded by each one's name, then each directory's zones by
 * path.
 *
 * Note that a zone's angle therefore reads the other zones on its ring,
 * because a ring filled all the way round has to. It stays deterministic,
 * and a change moves the others only by what it adds or takes away: a zone
 * coming or going shifts every other zone on its ring by less than its own
 * slot, the zones before it in the sweep drawn together and those after
 * pushed on, and a zone on another ring not at all. The seeded order keeps
 * a new directory's arc from reshuffling the rest, which it would if
 * directories were sorted by size.
 *
 * A zone's footprint is `sqrt(bytes)` against the snapshot's largest zone,
 * so its area grows with its bytes, and never under `FOOTPRINT_FLOOR`, so the
 * smallest zone is still there to see, and holds a slot of the ring.
 */

import { AREA_PATH } from "@luke/features/pull-request-area";

export const ZONE_LAYOUT = {
  /** How far a zone stands off either edge of its ring's band, of the band's unit width. */
  BAND_INSET: 0.2,
  /** The smallest footprint a zone has, of the largest zone's. */
  FOOTPRINT_FLOOR: 0.15,
} as const;

/** Where one zone stands: polar, and the same point on the plane. */
export interface ZonePlacement {
  /** Radians from the plane's +x axis, in [0, 2π). */
  readonly angle: number;
  /** Units from the centre. */
  readonly radius: number;
  readonly x: number;
  readonly y: number;
}

/** What the layout reads of one zone: its path, its layer's ring, and its footprint. */
interface ZoneSlot {
  readonly path: string;
  readonly ring: number;
  readonly footprint: number;
}

const FULL_TURN = 2 * Math.PI;

/** The seeds a directory's angle and a zone's radius are hashed under, so the two are independent. */
const SEED = {
  GROUP: 0x811c9dc5,
  RADIUS: 0x85ebca6b,
} as const;

/**
 * Hashes `text` into [0, 1): FNV-1a under `seed`, then MurmurHash3's 32-bit
 * finaliser, so paths that differ in their last character still land far
 * apart.
 */
function unitHash(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32;
}

function groupOf(path: string): string {
  if (path === AREA_PATH.ROOT) return AREA_PATH.ROOT;
  return path.split("/")[0] ?? path;
}

function byText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The zones of one ring in the order the sweep deals them: by directory, seeded, then by path. */
function sweepOrderOf(zones: readonly ZoneSlot[]): ZoneSlot[] {
  const keyed = zones.map((zone) => {
    const group = groupOf(zone.path);
    return { zone, group, seat: unitHash(group, SEED.GROUP) };
  });
  keyed.sort(
    (left, right) =>
      left.seat - right.seat ||
      byText(left.group, right.group) ||
      byText(left.zone.path, right.zone.path),
  );
  return keyed.map((each) => each.zone);
}

function placementAt(angle: number, radius: number): ZonePlacement {
  return { angle, radius, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** Where each zone stands, by path, every ring dealt round its whole turn. */
export function zonePlacementsOf(zones: readonly ZoneSlot[]): Map<string, ZonePlacement> {
  const ringZones = new Map<number, ZoneSlot[]>();
  for (const zone of zones) {
    if (!(zone.footprint > 0)) throw new Error(`zone ${zone.path} has no footprint to hold a slot`);
    const members = ringZones.get(zone.ring);
    if (members === undefined) ringZones.set(zone.ring, [zone]);
    else members.push(zone);
  }
  const band = 1 - 2 * ZONE_LAYOUT.BAND_INSET;
  const placements = new Map<string, ZonePlacement>();
  for (const [ring, members] of ringZones) {
    const total = members.reduce((sum, zone) => sum + zone.footprint, 0);
    let swept = 0;
    for (const zone of sweepOrderOf(members)) {
      const angle = ((swept + zone.footprint / 2) / total) * FULL_TURN;
      swept += zone.footprint;
      const radius = ring + ZONE_LAYOUT.BAND_INSET + unitHash(zone.path, SEED.RADIUS) * band;
      placements.set(zone.path, placementAt(angle, radius));
    }
  }
  return placements;
}

/** A zone's footprint, from `FOOTPRINT_FLOOR` up to 1 for the snapshot's largest. */
export function zoneFootprintOf(bytes: number, largestBytes: number): number {
  if (largestBytes <= 0) return ZONE_LAYOUT.FOOTPRINT_FLOOR;
  return Math.max(ZONE_LAYOUT.FOOTPRINT_FLOOR, Math.sqrt(bytes / largestBytes));
}
