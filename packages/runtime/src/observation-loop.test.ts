import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import { cadenceGate } from "./effect/cadence.js";
import { ObservationLoop, observationSupervisor } from "./observation-loop.js";

it.effect("coalesces overlapping refreshes into one immediate follow-up", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    const generations: number[] = [];
    const loop = new ObservationLoop({
      gate: () => true,
      intervalMs: 60_000,
      run: (generation) =>
        Effect.suspend(() => {
          generations.push(generation);
          return generations.length === 1 ? Deferred.await(first) : Effect.void;
        }),
    });

    const running = yield* Effect.forkChild(loop.refresh);
    yield* Effect.yieldNow;
    yield* loop.refresh;
    yield* loop.refresh;
    assert.deepEqual(generations, [0]);
    yield* Deferred.succeed(first, undefined);
    yield* Fiber.await(running);
    // The follow-up the coalesced pokes earned is a daemon, so it begins on
    // the scheduler's next turn rather than inside the pass that queued it.
    yield* Effect.yieldNow;
    assert.deepEqual(generations, [0, 0]);
  }),
);

/** Gives the scheduler a few turns, so a fiber that could settle has. */
const turns = Effect.forEach([1, 2, 3, 4], () => Effect.yieldNow, { discard: true });

it.effect("settled answers at once while the loop is idle", () =>
  Effect.gen(function* () {
    const loop = new ObservationLoop({
      gate: () => true,
      intervalMs: 60_000,
      run: () => Effect.void,
    });
    yield* loop.settled;
    yield* loop.refresh;
    yield* loop.settled;
  }),
);

it.effect("settled waits for the pass in flight and answers once it ends with nothing queued", () =>
  Effect.gen(function* () {
    const pending = yield* Deferred.make<void>();
    const loop = new ObservationLoop({
      gate: () => true,
      intervalMs: 60_000,
      run: () => Deferred.await(pending),
    });
    const running = yield* Effect.forkChild(loop.refresh);
    yield* Effect.yieldNow;
    const waiting = yield* Effect.forkChild(loop.settled);
    yield* turns;
    assert.equal(waiting.pollUnsafe() === undefined, true, "a pass is still running");
    yield* Deferred.succeed(pending, undefined);
    yield* Fiber.join(running);
    yield* Fiber.join(waiting);
  }),
);

it.effect(
  "refresh then settled reads past the follow-up a coalesced poke earned, which refresh alone does not",
  () =>
    Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 60_000,
        run: () =>
          Effect.suspend(() => {
            passes.push(passes.length + 1);
            return passes.length === 1 ? Deferred.await(first) : Effect.void;
          }),
      });
      const cadence = yield* Effect.forkChild(loop.refresh);
      yield* Effect.yieldNow;
      // The arrival's shape: a poke while the cadence's pass is in flight,
      // then the wait for whatever that poke earned.
      const arrival = yield* Effect.forkChild(
        Effect.gen(function* () {
          yield* loop.refresh;
          const afterRefresh = passes.length;
          yield* loop.settled;
          return { afterRefresh, afterSettled: passes.length };
        }),
      );
      yield* turns;
      assert.equal(arrival.pollUnsafe() === undefined, true, "the first pass still runs");
      yield* Deferred.succeed(first, undefined);
      yield* Fiber.join(cadence);
      const seen = yield* Fiber.join(arrival);
      // refresh answered with the pass it found running; settled answered
      // only once the follow-up behind it had run too.
      assert.deepEqual(seen, { afterRefresh: 1, afterSettled: 2 });
      assert.deepEqual(passes, [1, 2]);
      yield* loop.settled;
    }),
);

it.effect("a follow-up that finds the gate closed still settles the wait", () =>
  Effect.gen(function* () {
    let enabled = true;
    const first = yield* Deferred.make<void>();
    let passes = 0;
    const loop = new ObservationLoop({
      gate: () => enabled,
      intervalMs: 60_000,
      run: () =>
        Effect.suspend(() => {
          passes += 1;
          return passes === 1 ? Deferred.await(first) : Effect.void;
        }),
    });
    const running = yield* Effect.forkChild(loop.refresh);
    yield* Effect.yieldNow;
    yield* loop.refresh;
    const waiting = yield* Effect.forkChild(loop.settled);
    yield* turns;
    assert.equal(waiting.pollUnsafe() === undefined, true);
    // The gate closes while the pass runs; the follow-up it queued runs nothing.
    enabled = false;
    yield* Deferred.succeed(first, undefined);
    yield* Fiber.join(running);
    yield* Fiber.join(waiting);
    assert.equal(passes, 1);
  }),
);

it.effect(
  "a poke that finds the gate closed while a pass still runs does not settle the wait early",
  () =>
    Effect.gen(function* () {
      let enabled = true;
      const pending = yield* Deferred.make<void>();
      const loop = new ObservationLoop({
        gate: () => enabled,
        intervalMs: 60_000,
        run: () => Deferred.await(pending),
      });
      const running = yield* Effect.forkChild(loop.refresh);
      yield* Effect.yieldNow;
      const waiting = yield* Effect.forkChild(loop.settled);
      enabled = false;
      // The gate dropped mid-pass; a poke now runs nothing, and must not tell
      // the waiter the roster is written while the pass is still writing it.
      yield* loop.refresh;
      yield* turns;
      assert.equal(waiting.pollUnsafe() === undefined, true, "the pass is still running");
      yield* Deferred.succeed(pending, undefined);
      yield* Fiber.join(running);
      yield* Fiber.join(waiting);
    }),
);

it.effect("a disarm invalidates work already in flight and prevents gated work", () =>
  Effect.gen(function* () {
    let enabled = true;
    const pending = yield* Deferred.make<void>();
    const loop = new ObservationLoop({
      gate: () => enabled,
      intervalMs: 60_000,
      run: () => Deferred.await(pending),
    });
    const gate = yield* cadenceGate(loop.cadence);
    yield* gate.arm;

    const generation = loop.generation;
    const running = yield* Effect.forkChild(loop.refresh);
    yield* gate.disarm;
    enabled = false;
    assert.equal(loop.isCurrent(generation), false);
    yield* Deferred.succeed(pending, undefined);
    yield* Fiber.await(running);
    yield* loop.refresh;
    assert.equal(loop.generation, generation + 1);
  }),
);

it.effect("the supervisor arms and disarms every loop as one lifecycle", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const loops = ["sessions", "calendars"].map(
      (name) =>
        new ObservationLoop({
          gate: () => true,
          intervalMs: 60_000,
          run: () =>
            Effect.sync(() => {
              events.push(name);
            }),
        }),
    );
    const supervisor = yield* observationSupervisor(loops);

    yield* supervisor.arm;
    yield* supervisor.arm;
    // The cadences are fibers the arming forked, so their first pass is the
    // scheduler's next turn rather than the arming's own.
    yield* Effect.yieldNow;
    yield* supervisor.disarm;
    assert.deepEqual(events, ["sessions", "calendars"]);
    assert.deepEqual(
      loops.map((loop) => loop.generation),
      [1, 1],
    );
  }),
);

it.effect("a loop behind a closed gate arms nothing and is disarmed all the same", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const loop = new ObservationLoop({
      gate: () => false,
      intervalMs: 60_000,
      run: () =>
        Effect.sync(() => {
          events.push("pass");
        }),
    });
    const supervisor = yield* observationSupervisor([loop]);

    yield* supervisor.arm;
    assert.deepEqual(events, []);
    yield* supervisor.disarm;
    assert.equal(loop.generation, 0);
  }),
);

it.effect("a pass that outlives its disarm does not run the after-run hook", () =>
  Effect.gen(function* () {
    let enabled = true;
    const pending = yield* Deferred.make<void>();
    const hooks: number[] = [];
    const loop = new ObservationLoop({
      gate: () => enabled,
      intervalMs: 60_000,
      run: () => Deferred.await(pending),
      afterRun: () =>
        Effect.sync(() => {
          hooks.push(1);
        }),
    });
    const gate = yield* cadenceGate(loop.cadence);
    yield* gate.arm;

    const running = yield* Effect.forkChild(loop.refresh);
    yield* gate.disarm;
    enabled = false;
    yield* Deferred.succeed(pending, undefined);
    yield* Fiber.await(running);
    assert.deepEqual(hooks, []);

    enabled = true;
    yield* loop.refresh;
    assert.deepEqual(hooks, [1]);
  }),
);

describe("the cadence", () => {
  it.effect("runs a pass at every spaced instant until the loop is disarmed", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: () =>
          Effect.sync(() => {
            passes.push(clock.currentTimeMillisUnsafe());
          }),
      });
      const gate = yield* cadenceGate(loop.cadence);

      yield* gate.arm;
      yield* Effect.yieldNow;
      assert.equal(passes.length, 1);

      yield* TestClock.adjust("30 seconds");
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(passes, [0, 30_000, 60_000]);

      yield* gate.disarm;
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(passes, [0, 30_000, 60_000]);
    }),
  );

  it.effect("keeps its cadence over a pass that failed and reports it", () =>
    Effect.gen(function* () {
      const reports: string[] = [];
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: () =>
          Effect.sync(() => {
            passes.push(passes.length);
            if (passes.length === 2) throw new Error("provider unreachable");
          }),
        report: (message) => reports.push(message),
      });
      const gate = yield* cadenceGate(loop.cadence);

      yield* gate.arm;
      yield* TestClock.adjust("30 seconds");
      yield* TestClock.adjust("30 seconds");

      assert.deepEqual(reports, ["Observation pass failed: provider unreachable"]);
      assert.deepEqual(passes, [0, 1, 2]);
      yield* gate.disarm;
    }),
  );

  it.effect("ends when the gate's own scope closes, whatever became of the disarm", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: () =>
          Effect.sync(() => {
            passes.push(passes.length);
          }),
      });
      const gate = yield* Effect.provideService(cadenceGate(loop.cadence), Scope.Scope, scope);

      yield* gate.arm;
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(passes, [0, 1]);

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(passes, [0, 1]);
    }),
  );
});
