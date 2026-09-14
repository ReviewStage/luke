/**
 * The housekeeping flush's one Effect-shaped bound. `flush.ts` is a port of
 * OpenClaw `b7528507` and stays faithful to it — it imports nothing from
 * `effect` — so the marker-write bound the port states as a plain retry count
 * is exposed here as a `Schedule` a caller composes rather than counting
 * attempts by hand.
 */
import { Schedule } from "effect";
import { MEMORY_FLUSH_DEFAULTS } from "./flush.js";

/**
 * The port's marker-write attempts as a schedule, so a caller using
 * `Effect.retry` composes the same bound as a `Schedule` rather than a loop
 * counter of its own. `recurs` counts retries after the first attempt, so
 * the total attempts made match the port's constant exactly.
 */
export const markerWriteSchedule: Schedule.Schedule<number> = Schedule.recurs(
  MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS - 1,
);
