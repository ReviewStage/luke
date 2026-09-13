import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Duration, Effect, Pull, Schedule } from "effect";
import {
  housekeepingEffect,
  MEMORY_HOUSEKEEPING_SHORTFALL,
  markerWriteSchedule,
} from "./flush.effect.js";
import { MEMORY_FLUSH_DEFAULTS, MEMORY_HOUSEKEEPING_OUTCOME } from "./flush.js";

describe("housekeepingEffect", () => {
  it.effect("succeeds with a result that completed", () =>
    Effect.gen(function* () {
      const result = yield* housekeepingEffect({
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
        writes: 1,
      });

      assert.equal(result.outcome, MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED);
    }),
  );

  it.effect("succeeds with a result that had nothing to store", () =>
    Effect.gen(function* () {
      const result = yield* housekeepingEffect({
        outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE,
        writes: 0,
      });

      assert.equal(result.outcome, MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE);
    }),
  );

  it.effect("fails with the interrupted code on an interrupted result", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(
        housekeepingEffect({ outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED, writes: 0 }),
      );

      assert.equal(refusal._tag, "MemoryHousekeepingFellShort");
      assert.equal(refusal.code, MEMORY_HOUSEKEEPING_SHORTFALL.INTERRUPTED);
    }),
  );

  it.effect("fails with the failed code and carries the reason on a failed result", () =>
    Effect.gen(function* () {
      const refusal = yield* Effect.flip(
        housekeepingEffect({
          outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED,
          writes: 0,
          reason: "no brain standing",
        }),
      );

      assert.equal(refusal.code, MEMORY_HOUSEKEEPING_SHORTFALL.FAILED);
      assert.equal(refusal.result.reason, "no brain standing");
    }),
  );
});

/**
 * Drives a schedule to exhaustion the way v4 states one: `Schedule.toStep`
 * hands back a step, and the step is pulled with each attempt's own instant
 * until it ends with `Cause.done`. v3's `Schedule.run` collected this for a
 * caller; v4 has no such collector, so the walk stands here.
 */
const stepsOf = <Output>(
  schedule: Schedule.Schedule<Output, undefined>,
  attempts: number,
): Effect.Effect<ReadonlyArray<readonly [Output, Duration.Duration]>> =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule);
    const taken: Array<readonly [Output, Duration.Duration]> = [];
    let now = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const pulled = yield* Pull.catchDone(step(now, undefined), () => Effect.succeed(undefined));
      if (pulled === undefined) break;
      taken.push(pulled);
      now += Duration.toMillis(pulled[1]);
    }
    return taken;
  });

describe("markerWriteSchedule", () => {
  it.effect("recurs one fewer time than the port's marker-write attempts", () =>
    Effect.gen(function* () {
      const taken = yield* stepsOf(
        markerWriteSchedule,
        MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS + 2,
      );

      // One step per recurrence, which is one fewer than the attempts the port
      // states: `Effect.retry` makes the opening attempt before it consults a
      // schedule at all. v3's `Schedule.run` collected the initial output
      // beside each recurrence's and so counted the attempts themselves; the
      // v4 walk above counts what the schedule actually yields.
      assert.equal(taken.length, MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS - 1);
    }),
  );
});
