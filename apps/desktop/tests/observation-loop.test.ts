import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { ObservationLoop, ObservationSupervisor } from "../src/observation-loop";

function deferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const runEffect = (effect: Effect.Effect<void>) => Effect.runPromise(effect);

test("coalesces overlapping refreshes into one immediate follow-up", async () => {
  const first = deferred();
  const generations: number[] = [];
  const loop = new ObservationLoop({
    gate: () => true,
    intervalMs: 60_000,
    run: (generation) =>
      Effect.gen(function* () {
        generations.push(generation);
        if (generations.length === 1) yield* Effect.promise(() => first.promise);
      }),
    runEffect,
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
    run: () => Effect.promise(() => pending.promise),
    runEffect,
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
test("supervisor starts and stops every loop as one lifecycle", async () => {
  let enabled = true;
  const events: string[] = [];
  const loops = ["sessions", "issues"].map(
    (name) =>
      new ObservationLoop({
        gate: () => enabled,
        intervalMs: 60_000,
        run: () =>
          Effect.sync(() => {
            events.push(name);
          }),
        runEffect,
      }),
  );
  const supervisor = new ObservationSupervisor(loops);

  supervisor.setEnabled(true);
  supervisor.setEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));
  enabled = false;
  supervisor.setEnabled(false);
  assert.deepEqual(events, ["sessions", "issues"]);
  assert.deepEqual(
    loops.map((loop) => loop.generation),
    [1, 1],
  );
});

test("supervisor arms the loops when the gate opens after the first enable", async () => {
  let enabled = false;
  const events: string[] = [];
  const loops = ["sessions", "issues"].map(
    (name) =>
      new ObservationLoop({
        gate: () => enabled,
        intervalMs: 60_000,
        run: () =>
          Effect.sync(() => {
            events.push(name);
          }),
        runEffect,
      }),
  );
  const supervisor = new ObservationSupervisor(loops);

  supervisor.setEnabled(true);
  assert.deepEqual(events, []);
  enabled = true;
  supervisor.setEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));
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
    run: () => Effect.promise(() => pending.promise),
    afterRun: () => hooks.push(1),
    runEffect,
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
