/**
 * The housekeeping flush in Effect's own terms. `flush.ts` is a port of
 * OpenClaw `b7528507` and stays faithful to it — it imports nothing from
 * `effect` — so everything Effect needs of it lives here beside it: the
 * outcomes that mean a turn fell short as a typed failure carrying the code
 * the port already decides, and the marker-write bound the port states as a
 * plain retry count exposed as a `Schedule` a caller composes rather than
 * counting attempts by hand.
 *
 * This is the shape every OpenClaw wrap in this repository copies: a sibling
 * named for the ported file, wrapping its exported API and reaching inside
 * none of it.
 */
import { Data, Effect, Schedule } from "effect";
import {
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingOutcome,
  type MemoryHousekeepingResult,
} from "./flush.js";

/** The outcomes `housekeepingFellShort` already names as a shortfall, held as their own set. */
export const MEMORY_HOUSEKEEPING_SHORTFALL = {
  INTERRUPTED: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
  FAILED: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
} as const satisfies Record<string, MemoryHousekeepingOutcome>;

export type MemoryHousekeepingShortfall =
  (typeof MEMORY_HOUSEKEEPING_SHORTFALL)[keyof typeof MEMORY_HOUSEKEEPING_SHORTFALL];

export class MemoryHousekeepingFellShort extends Data.TaggedError("MemoryHousekeepingFellShort")<{
  readonly code: MemoryHousekeepingShortfall;
  readonly result: MemoryHousekeepingResult;
}> {}

/**
 * A completed housekeeping result as a success, and a result that fell short
 * as a failure carrying its own outcome code — the same distinction
 * `housekeepingFellShort` already draws, read into Effect's failure channel
 * for a caller that wants to `Effect.retry` or `Effect.catchTag` over it
 * rather than branch on the outcome by hand.
 */
export const housekeepingEffect = (
  result: MemoryHousekeepingResult,
): Effect.Effect<MemoryHousekeepingResult, MemoryHousekeepingFellShort> =>
  Effect.suspend(() => {
    switch (result.outcome) {
      case MEMORY_HOUSEKEEPING_SHORTFALL.INTERRUPTED:
      case MEMORY_HOUSEKEEPING_SHORTFALL.FAILED:
        return Effect.fail(new MemoryHousekeepingFellShort({ code: result.outcome, result }));
      default:
        return Effect.succeed(result);
    }
  });

/**
 * The marker-write bound as a cadence rather than a count: the port offers
 * the completed-flush marker to its store `MARKER_WRITE_ATTEMPTS` times
 * before leaving the cycle unflushed, so a caller retrying that write under
 * `Effect.retry` composes the same bound as a `Schedule` rather than a loop
 * counter of its own. `recurs` counts retries after the first attempt, so
 * the total attempts made match the port's constant exactly.
 */
export const markerWriteSchedule: Schedule.Schedule<number> = Schedule.recurs(
  MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS - 1,
);
