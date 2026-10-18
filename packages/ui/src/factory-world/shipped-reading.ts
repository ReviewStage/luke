/**
 * shipped-reading.ts -- the pull requests merged within the window: how alive each zone is with them, and the order the scrubber plays them in.
 *
 * A zone is alive with what recently landed in it. Each merged pull request
 * adds its weight to every zone it landed in, a weight that halves every
 * `ALIVE_HALF_LIFE_MS` since it merged, and a zone's score is
 * `1 - e^(-sum)`: zero for nothing merged, about 0.63 for one pull request
 * merged this instant, and towards 1, never past it, as more land. A pull
 * request merged after `now` adds nothing.
 */

import type { FactoryShipped } from "@luke/features/factory-world-wire";

/** How long a merge takes to lose half its glow. */
const ALIVE_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;

/** One merged pull request on the scrubber's timeline, with the zones it landed in. */
export type TimelineEntry = FactoryShipped & {
  /** The zones its areas land in, sorted. */
  readonly zonePaths: readonly string[];
};

function zonesOf(
  merged: FactoryShipped,
  zoneOfArea: (areaPath: string) => string | null,
): string[] {
  const zones = new Set<string>();
  for (const area of merged.areas) {
    const zone = zoneOfArea(area.path);
    if (zone !== null) zones.add(zone);
  }
  return [...zones].sort();
}

/** Every merged pull request in the order it merged, the earliest first; equal instants by number. */
export function timelineOf(
  shipped: readonly FactoryShipped[],
  zoneOfArea: (areaPath: string) => string | null,
): TimelineEntry[] {
  return [...shipped]
    .sort((left, right) => left.mergedAt - right.mergedAt || left.number - right.number)
    .map((merged) => ({ ...merged, zonePaths: zonesOf(merged, zoneOfArea) }));
}

/** Each zone's alive score at `now`, by path; a zone nothing landed in is absent. */
export function aliveByZoneOf(
  timeline: readonly TimelineEntry[],
  now: number,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const entry of timeline) {
    if (entry.mergedAt > now) continue;
    const weight = 0.5 ** ((now - entry.mergedAt) / ALIVE_HALF_LIFE_MS);
    for (const zone of entry.zonePaths) sums.set(zone, (sums.get(zone) ?? 0) + weight);
  }
  return new Map([...sums].map(([zone, sum]) => [zone, 1 - Math.exp(-sum)]));
}
