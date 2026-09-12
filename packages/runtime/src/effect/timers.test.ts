import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Schedule, Scope, TestClock } from "effect";
import { scheduleOnce, scheduleRepeat } from "./timers.js";

describe("scheduleOnce", () => {
  it.effect("runs its work at the advanced instant and not before", () =>
    Effect.gen(function* () {
      const fired: number[] = [];
      const scope = yield* Scope.make();

      const fiber = yield* Effect.provideService(
        scheduleOnce(
          5_000,
          Effect.flatMap(TestClock.currentTimeMillis, (at) => Effect.sync(() => fired.push(at))),
        ),
        Scope.Scope,
        scope,
      );

      yield* TestClock.adjust("4 seconds");
      assert.deepEqual(fired, []);

      yield* TestClock.adjust("1 second");
      yield* Fiber.join(fiber);
      assert.deepEqual(fired, [5_000]);
    }),
  );

  it.effect("is cancelled with the scope it was forked into", () =>
    Effect.gen(function* () {
      const fired: number[] = [];
      const scope = yield* Scope.make();

      const fiber = yield* Effect.provideService(
        scheduleOnce(
          5_000,
          Effect.sync(() => fired.push(1)),
        ),
        Scope.Scope,
        scope,
      );

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("1 minute");

      assert.equal(Exit.isInterrupted(yield* Fiber.await(fiber)), true);
      assert.deepEqual(fired, []);
    }),
  );
});

describe("scheduleRepeat", () => {
  it.effect("runs its work on the schedule's cadence until its scope closes", () =>
    Effect.gen(function* () {
      const rounds: number[] = [];
      const scope = yield* Scope.make();

      const fiber = yield* Effect.provideService(
        scheduleRepeat(
          Schedule.spaced("1 second"),
          Effect.sync(() => rounds.push(rounds.length)),
        ),
        Scope.Scope,
        scope,
      );

      yield* TestClock.adjust("3 seconds");
      assert.deepEqual(rounds, [0, 1, 2, 3]);

      yield* Scope.close(scope, Exit.void);
      yield* Fiber.await(fiber);
      yield* TestClock.adjust("1 minute");

      assert.deepEqual(rounds, [0, 1, 2, 3]);
    }),
  );
});
