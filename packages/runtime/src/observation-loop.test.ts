import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Scope, TestClock } from "effect";
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

    const running = yield* Effect.fork(loop.refresh);
    yield* Effect.yieldNow();
    yield* loop.refresh;
    yield* loop.refresh;
    assert.deepEqual(generations, [0]);
    yield* Deferred.succeed(first, undefined);
    yield* running.await;
    // The follow-up the coalesced pokes earned is a daemon, so it begins on
    // the scheduler's next turn rather than inside the pass that queued it.
    yield* Effect.yieldNow();
    assert.deepEqual(generations, [0, 0]);
  }),
);

it.scoped("a disarm invalidates work already in flight and prevents gated work", () =>
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
    const running = yield* Effect.fork(loop.refresh);
    yield* gate.disarm;
    enabled = false;
    assert.equal(loop.isCurrent(generation), false);
    yield* Deferred.succeed(pending, undefined);
    yield* running.await;
    yield* loop.refresh;
    assert.equal(loop.generation, generation + 1);
  }),
);

it.scoped("the supervisor arms and disarms every loop as one lifecycle", () =>
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
    yield* Effect.yieldNow();
    yield* supervisor.disarm;
    assert.deepEqual(events, ["sessions", "calendars"]);
    assert.deepEqual(
      loops.map((loop) => loop.generation),
      [1, 1],
    );
  }),
);

it.scoped("a loop behind a closed gate arms nothing and is disarmed all the same", () =>
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

it.scoped("a pass that outlives its disarm does not run the after-run hook", () =>
  Effect.gen(function* () {
    let enabled = true;
    const pending = yield* Deferred.make<void>();
    const hooks: number[] = [];
    const loop = new ObservationLoop({
      gate: () => enabled,
      intervalMs: 60_000,
      run: () => Deferred.await(pending),
      afterRun: () => hooks.push(1),
    });
    const gate = yield* cadenceGate(loop.cadence);
    yield* gate.arm;

    const running = yield* Effect.fork(loop.refresh);
    yield* gate.disarm;
    enabled = false;
    yield* Deferred.succeed(pending, undefined);
    yield* running.await;
    assert.deepEqual(hooks, []);

    enabled = true;
    yield* loop.refresh;
    assert.deepEqual(hooks, [1]);
  }),
);

describe("the cadence", () => {
  it.scoped("runs a pass at every spaced instant until the loop is disarmed", () =>
    Effect.gen(function* () {
      const clock = yield* Effect.clock;
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: () =>
          Effect.sync(() => {
            passes.push(clock.unsafeCurrentTimeMillis());
          }),
      });
      const gate = yield* cadenceGate(loop.cadence);

      yield* gate.arm;
      yield* Effect.yieldNow();
      assert.equal(passes.length, 1);

      yield* TestClock.adjust("30 seconds");
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(passes, [0, 30_000, 60_000]);

      yield* gate.disarm;
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(passes, [0, 30_000, 60_000]);
    }),
  );

  it.scoped("keeps its cadence over a pass that failed and reports it", () =>
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
