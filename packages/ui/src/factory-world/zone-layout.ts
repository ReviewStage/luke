/**
 * zone-layout.ts -- where a zone stands on the floor, and how much of it it covers, in units a world maps into its own geometry.
 *
 * The floor is polar. Each layer is a ring one unit wide, the core's from
 * the centre out to 1, the domain's from 1 to 2, and so on
 * (`zone-graph.ts`'s `LAYER_RING`); a zone stands inside its ring's band,
 * kept `BAND_INSET` off either edge.
 *
 * Note that a zone's place is read from its own path and its layer alone,
 * never from the other zones, so the same path lands in the same place when
 * zones come and go around it. Its angle is its top-level directory's,
 * seeded by that directory's name, spread up to `GROUP_SPREAD` either side
 * by its own path, which keeps a directory's zones together; its radius
 * within the band is seeded by its path too. Two directories can seed near
 * angles, and two zones can land close: a world that must keep zones apart
 * nudges them in its own geometry.
 *
 * A zone's footprint is `sqrt(bytes)` against the snapshot's largest zone,
 * so its area grows with its bytes, and never under `FOOTPRINT_FLOOR`, so the
 * smallest zone is still there to see.
 */

import { AREA_PATH } from "@luke/features/pull-request-area";

export const ZONE_LAYOUT = {
  /** How far a zone stands off either edge of its ring's band, of the band's unit width. */
  BAND_INSET: 0.2,
  /** How far, in radians, a zone's angle reaches either side of its directory's. */
  GROUP_SPREAD: Math.PI / 6,
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

const FULL_TURN = 2 * Math.PI;

/** The seeds each of a zone's draws is hashed under, so its angle and its radius are independent. */
const SEED = {
  GROUP: 0x811c9dc5,
  SPREAD: 0x9e3779b9,
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

/** Where the zone at `path` stands on the ring numbered `ring`. */
export function zonePlacementOf(path: string, ring: number): ZonePlacement {
  const spread = (unitHash(path, SEED.SPREAD) * 2 - 1) * ZONE_LAYOUT.GROUP_SPREAD;
  const turned = unitHash(groupOf(path), SEED.GROUP) * FULL_TURN + spread;
  const angle = ((turned % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const band = 1 - 2 * ZONE_LAYOUT.BAND_INSET;
  const radius = ring + ZONE_LAYOUT.BAND_INSET + unitHash(path, SEED.RADIUS) * band;
  return { angle, radius, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/** A zone's footprint, from `FOOTPRINT_FLOOR` up to 1 for the snapshot's largest. */
export function zoneFootprintOf(bytes: number, largestBytes: number): number {
  if (largestBytes <= 0) return ZONE_LAYOUT.FOOTPRINT_FLOOR;
  return Math.max(ZONE_LAYOUT.FOOTPRINT_FLOOR, Math.sqrt(bytes / largestBytes));
}
