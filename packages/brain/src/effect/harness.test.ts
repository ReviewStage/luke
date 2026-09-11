import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { timersFromRuntime } from "@sidecar/runtime/effect";
import { Effect } from "effect";
import { advanceHarness } from "./harness.js";

describe("advanceHarness", () => {
  it.effect(
    "fires a timer a callback's own promise chain reschedules, within the same advance",
    () =>
      Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();
        const { now, schedule } = timersFromRuntime(runtime);
        const fired: number[] = [];

        schedule(() => {
          fired.push(now());
          // A real promise chain, the way a Promise-based caller reschedules
          // after an await, rather than another timer fired synchronously
          // inside this one — the case a single `TestClock.setTime` call
          // would miss by reading `now` as already jumped to the target.
          void new Promise<void>((resolve) => setImmediate(resolve)).then(() => {
            schedule(() => fired.push(now()), 500);
          });
        }, 500);

        yield* advanceHarness(2_000);

        assert.deepEqual(fired, [500, 1_000]);
      }),
  );

  it.effect("advances straight to the target when nothing is scheduled", () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const { now } = timersFromRuntime(runtime);

      yield* advanceHarness(2_000);

      assert.equal(now(), 2_000);
    }),
  );
});
