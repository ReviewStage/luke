import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Schedule, Scope, TestClock } from "effect";
import { scheduleOnce, scheduleRepeat, timersFromRuntime } from "./timers.js";

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

describe("timersFromRuntime", () => {
  it.effect("reads now from the runtime's own clock", () =>
    Effect.gen(function* () {
      const timers = timersFromRuntime(yield* Effect.runtime<never>());

      assert.equal(timers.now(), 0);

      yield* TestClock.adjust("90 seconds");

      assert.equal(timers.now(), 90_000);
    }),
  );

  it.effect("fires a scheduled callback at the advanced instant", () =>
    Effect.gen(function* () {
      const timers = timersFromRuntime(yield* Effect.runtime<never>());
      const fired: number[] = [];

      timers.schedule(() => fired.push(timers.now()), 2_000);

      yield* TestClock.adjust("1999 millis");
      assert.deepEqual(fired, []);

      yield* TestClock.adjust("1 milli");
      assert.deepEqual(fired, [2_000]);
    }),
  );

  it.effect("runs nothing for a cancelled timer", () =>
    Effect.gen(function* () {
      const timers = timersFromRuntime(yield* Effect.runtime<never>());
      const fired: number[] = [];

      const handle = timers.schedule(() => fired.push(1), 2_000);
      timers.cancel(handle);

      yield* TestClock.adjust("1 minute");

      assert.deepEqual(fired, []);
    }),
  );

  it.effect("cancels only the timer it was handed", () =>
    Effect.gen(function* () {
      const timers = timersFromRuntime(yield* Effect.runtime<never>());
      const fired: number[] = [];

      const first = timers.schedule(() => fired.push(1), 1_000);
      timers.schedule(() => fired.push(2), 2_000);
      timers.cancel(first);

      yield* TestClock.adjust("1 minute");

      assert.deepEqual(fired, [2]);
    }),
  );

  it.effect("takes a cancel of a timer that already fired", () =>
    Effect.gen(function* () {
      const timers = timersFromRuntime(yield* Effect.runtime<never>());
      const fired: number[] = [];

      const handle = timers.schedule(() => fired.push(1), 1_000);
      yield* TestClock.adjust("1 second");
      timers.cancel(handle);

      assert.deepEqual(fired, [1]);
    }),
  );
});
