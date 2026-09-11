import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Chunk, Effect, Schedule } from "effect";
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

describe("markerWriteSchedule", () => {
  it.effect("recurs one fewer time than the port's marker-write attempts", () =>
    Effect.gen(function* () {
      const outputs = yield* Schedule.run(
        markerWriteSchedule,
        0,
        Array.from({ length: MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS + 2 }, () => undefined),
      );

      assert.equal(Chunk.size(outputs), MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS);
    }),
  );
});
