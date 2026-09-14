import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Clock, Duration, Effect } from "effect";
import { advanceHarness } from "./harness.js";

/**
 * `BrainAgent#arm`'s own shape, built here from the test's services and clock:
 * a wait begun on the calling stack, so its sleep stands registered on the
 * `TestClock` by the time the call returns, running a synchronous callback
 * when it is out. That is the caller `advanceHarness` exists for, and running
 * the fiber here is the test's own edge rather than the harness's.
 */
const arming = Effect.gen(function* () {
  const context = yield* Effect.context<never>();
  const clock: Clock.Clock = yield* Clock.Clock;
  const fork = Effect.runForkWith(context);
  return {
    now: () => clock.currentTimeMillisUnsafe(),
    arm: (delayMs: number, callback: () => void): void => {
      fork(Effect.andThen(clock.sleep(Duration.millis(delayMs)), Effect.sync(callback)));
    },
  };
});

describe("advanceHarness", () => {
  it.effect(
    "fires a timer a callback's own promise chain reschedules, within the same advance",
    () =>
      Effect.gen(function* () {
        const { now, arm } = yield* arming;
        const fired: number[] = [];

        arm(500, () => {
          fired.push(now());
          // A real promise chain, the way a Promise-based caller reschedules
          // after an await, rather than another timer fired synchronously
          // inside this one — the case a single `TestClock.setTime` call
          // would miss by reading `now` as already jumped to the target.
          void new Promise<void>((resolve) => setImmediate(resolve)).then(() => {
            arm(500, () => fired.push(now()));
          });
        });

        yield* advanceHarness(2_000);

        assert.deepEqual(fired, [500, 1_000]);
      }),
  );

  it.effect("advances straight to the target when nothing is scheduled", () =>
    Effect.gen(function* () {
      const { now } = yield* arming;

      yield* advanceHarness(2_000);

      assert.equal(now(), 2_000);
    }),
  );
});
