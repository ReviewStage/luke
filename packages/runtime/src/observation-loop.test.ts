import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Scope, TestClock } from "effect";
import { test } from "vitest";
import { cadenceHome } from "./effect/cadence.js";
import { ObservationLoop, ObservationSupervisor } from "./observation-loop.js";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("coalesces overlapping refreshes into one immediate follow-up", async () => {
  const first = deferred();
  const generations: number[] = [];
  const loop = new ObservationLoop({
    gate: () => true,
    intervalMs: 60_000,
    run: async (generation) => {
      generations.push(generation);
      if (generations.length === 1) await first.promise;
    },
  });

  const running = loop.refresh();
  await loop.refresh();
  await loop.refresh();
  assert.deepEqual(generations, [0]);
  first.resolve();
  await running;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(generations, [0, 0]);
});

test("stop invalidates work already in flight and prevents gated work", async () => {
  let enabled = true;
  const pending = deferred();
  const loop = new ObservationLoop({
    gate: () => enabled,
    intervalMs: 60_000,
    run: () => pending.promise,
  });

  const generation = loop.generation;
  const running = loop.refresh();
  loop.stop();
  enabled = false;
  assert.equal(loop.isCurrent(generation), false);
  pending.resolve();
  await running;
  await loop.refresh();
  assert.equal(loop.generation, generation + 1);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("supervisor starts and stops every loop as one lifecycle", () => {
  let enabled = true;
  const events: string[] = [];
  const loops = ["sessions", "issues"].map(
    (name) =>
      new ObservationLoop({
        gate: () => enabled,
        intervalMs: 60_000,
        run: async () => {
          events.push(name);
        },
      }),
  );
  const supervisor = new ObservationSupervisor(loops);

  supervisor.setEnabled(true);
  supervisor.setEnabled(true);
  enabled = false;
  supervisor.setEnabled(false);
  assert.deepEqual(events, ["sessions", "issues"]);
  assert.deepEqual(
    loops.map((loop) => loop.generation),
    [1, 1],
  );
});

test("supervisor arms the loops when the gate opens after the first enable", () => {
  let enabled = false;
  const events: string[] = [];
  const loops = ["sessions", "issues"].map(
    (name) =>
      new ObservationLoop({
        gate: () => enabled,
        intervalMs: 60_000,
        run: async () => {
          events.push(name);
        },
      }),
  );
  const supervisor = new ObservationSupervisor(loops);

  supervisor.setEnabled(true);
  assert.deepEqual(events, []);
  enabled = true;
  supervisor.setEnabled(true);
  assert.deepEqual(events, ["sessions", "issues"]);
  supervisor.setEnabled(false);
});

test("a pass that outlives its stop does not run the after-run hook", async () => {
  let enabled = true;
  const pending = deferred();
  const hooks: number[] = [];
  const loop = new ObservationLoop({
    gate: () => enabled,
    intervalMs: 60_000,
    run: () => pending.promise,
    afterRun: () => hooks.push(1),
  });

  const running = loop.refresh();
  loop.stop();
  enabled = false;
  pending.resolve();
  await running;
  assert.deepEqual(hooks, []);

  enabled = true;
  await loop.refresh();
  assert.deepEqual(hooks, [1]);
});

describe("the cadence", () => {
  it.scoped("runs a pass at every spaced instant until the loop stops", () =>
    Effect.gen(function* () {
      const home = yield* cadenceHome;
      const clock = yield* Effect.clock;
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: async () => {
          passes.push(clock.unsafeCurrentTimeMillis());
        },
        home,
      });

      loop.start();
      assert.equal(passes.length, 1);

      yield* TestClock.adjust("30 seconds");
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(passes, [0, 30_000, 60_000]);

      loop.stop();
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(passes, [0, 30_000, 60_000]);
    }),
  );

  it.scoped("keeps its cadence over a pass that failed and reports it", () =>
    Effect.gen(function* () {
      const home = yield* cadenceHome;
      const reports: string[] = [];
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: async () => {
          passes.push(passes.length);
          if (passes.length === 2) throw new Error("provider unreachable");
        },
        report: (message) => reports.push(message),
        home,
      });

      loop.start();
      yield* TestClock.adjust("30 seconds");
      yield* TestClock.adjust("30 seconds");

      assert.equal(reports.length, 1);
      assert.deepEqual(passes, [0, 1, 2]);
      loop.stop();
    }),
  );

  it.effect("ends when the home's scope closes, whatever became of the stop that should have", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const home = yield* Effect.provideService(cadenceHome, Scope.Scope, scope);
      const passes: number[] = [];
      const loop = new ObservationLoop({
        gate: () => true,
        intervalMs: 30_000,
        run: async () => {
          passes.push(passes.length);
        },
        home,
      });

      loop.start();
      yield* TestClock.adjust("30 seconds");
      assert.deepEqual(passes, [0, 1]);

      yield* Scope.close(scope, Exit.void);
      yield* TestClock.adjust("5 minutes");
      assert.deepEqual(passes, [0, 1]);
    }),
  );
});
