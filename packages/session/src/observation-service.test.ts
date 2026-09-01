import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Fiber, TestClock } from "effect";
import * as TestContext from "effect/TestContext";
import { makeObservationLoopRuntime } from "./observation-service.js";

test("scheduled refresh runs on the fixed interval", async () => {
  const generations: number[] = [];
  const program = Effect.gen(function* () {
    const loop = yield* makeObservationLoopRuntime({
      gate: () => true,
      intervalMs: 1_000,
      run: async (generation) => {
        generations.push(generation);
      },
    });
    yield* loop.start;
    yield* TestClock.adjust("1 second");
    yield* Effect.yieldNow();
    yield* TestClock.adjust("1 second");
    yield* Effect.yieldNow();
    yield* loop.stop;
    assert.deepEqual(generations, [0, 0, 0]);
  }).pipe(Effect.provide(TestContext.TestContext));

  await Effect.runPromise(program);
});

test("stop invalidates an in-flight pass under TestClock", async () => {
  let enabled = true;
  const pending = deferred();
  const program = Effect.gen(function* () {
    const loop = yield* makeObservationLoopRuntime({
      gate: () => enabled,
      intervalMs: 60_000,
      run: () => pending.promise,
    });
    const generation = yield* loop.generation;
    const running = yield* Effect.fork(loop.refresh);
    yield* loop.stop;
    enabled = false;
    assert.equal(yield* loop.isCurrent(generation), false);
    pending.resolve();
    yield* Fiber.join(running);
  }).pipe(Effect.provide(TestContext.TestContext));

  await Effect.runPromise(program);
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
