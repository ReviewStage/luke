/**
 * fixture-rebase.ts -- the planning fixture's own data with every timestamp moved to just before launch, for a shot that reuses it.
 *
 * Throwaway (`README.md`). `tasks-fixture.ts` stamps its plans 1 and 2 ms
 * past the epoch and its calls and turns on 2026-10-07, which drew
 * "Dec 31, 1969" in the sidebar and "Working… 146h" on the Call tab. A shot
 * reusing it reads it through {@link rebased}, which moves every timestamp
 * so the fixture's newest moment (its running turn's start) lands two
 * minutes before launch, and the epoch stamps a few minutes or a day back.
 */

import { ago, daysAgo, LAUNCHED_AT } from "./clock";

/** The fixture's newest moment: the running turn's start. */
const FIXTURE_NEWEST = Date.parse("2026-10-07T16:44:00Z");

/** Where that moment lands: two minutes before launch. */
const NEWEST_LANDS = LAUNCHED_AT - 2 * 60_000;

/** The keys whose numbers are epoch milliseconds in the fixture's data. */
const TIME_KEYS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "runStartedAt",
  "shownAt",
  "at",
  "pinnedAt",
  "archivedAt",
  "measuredAt",
]);

/** One timestamp moved: an epoch stamp (the fixture's 1 and 2) a day or minutes back, any other by the shift. */
function moved(key: string, value: number): number {
  if (value < 1_000_000_000_000) return key === "createdAt" || value <= 1 ? daysAgo(1) : ago(3);
  return value - FIXTURE_NEWEST + NEWEST_LANDS;
}

/** The value with every timestamp under a time key moved; everything else as it was. */
export function rebased<Value>(value: Value): Value {
  return walk(value, undefined) as Value;
}

function walk(value: unknown, key: string | undefined): unknown {
  if (typeof value === "number")
    return key !== undefined && TIME_KEYS.has(key) ? moved(key, value) : value;
  if (Array.isArray(value)) return value.map((each) => walk(each, undefined));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, each]) => [name, walk(each, name)]),
    );
  }
  return value;
}
