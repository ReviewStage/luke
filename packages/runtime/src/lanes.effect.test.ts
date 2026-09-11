import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect";
import { acquireLane, laneSnapshot, withLane } from "./lanes.effect.js";
import { LANE, type LaneConfiguration, LaneScheduler, laneConfiguration } from "./lanes.js";

/** A real macrotask boundary, so every pending promise the port's `run` chained settles first. */
const tick = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

/** Every lane at the same width, so a single-lane test is not diluted by the others' defaults. */
const uniformWidths = (width: number): LaneConfiguration => ({
  widths: {
    [LANE.AGENT]: width,
    [LANE.CHILD]: width,
    [LANE.HOOK_DISPATCH]: width,
    [LANE.BACKGROUND]: width,
  },
});

describe("withLane", () => {
  it.effect("admits a lane's width and queues the rest in the port's own order", () =>
    Effect.gen(function* () {
      const scheduler = new LaneScheduler(laneConfiguration(8));
      const started: number[] = [];
      const gates = yield* Effect.all(Array.from({ length: 4 }, () => Deferred.make<void>()));
      const fibers = yield* Effect.all(
        gates.map((gate, index) =>
          Effect.fork(
            withLane(
              scheduler,
              LANE.BACKGROUND,
              Effect.gen(function* () {
                started.push(index);
                yield* Deferred.await(gate);
                return index;
              }),
            ),
          ),
        ),
      );
      yield* tick;
      assert.deepEqual(started, [0, 1, 2]);
      assert.deepEqual(yield* laneSnapshot(scheduler, LANE.BACKGROUND), {
        width: 3,
        active: 3,
        queued: 1,
      });

      const firstGate = gates[0];
      assert.ok(firstGate);
      yield* Deferred.succeed(firstGate, undefined);
      yield* tick;
      assert.deepEqual(started, [0, 1, 2, 3]);

      for (const gate of gates) yield* Deferred.succeed(gate, undefined);
      const results = yield* Effect.all(fibers.map(Fiber.join));
      assert.deepEqual(results, [0, 1, 2, 3]);
    }),
  );

  it.effect("releases the lane only once the effect settles, admitting the next waiter", () =>
    Effect.gen(function* () {
      const scheduler = new LaneScheduler(uniformWidths(1));
      const gate = yield* Deferred.make<void>();
      const secondStarted = yield* Deferred.make<void>();
      const first = yield* Effect.fork(withLane(scheduler, LANE.CHILD, Deferred.await(gate)));
      yield* tick;
      const second = yield* Effect.fork(
        withLane(scheduler, LANE.CHILD, Deferred.succeed(secondStarted, undefined)),
      );
      yield* tick;
      assert.equal(yield* Deferred.isDone(secondStarted), false);

      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.equal(yield* Deferred.isDone(secondStarted), true);
    }),
  );

  it.effect("propagates the wrapped effect's own failure and still frees the lane", () =>
    Effect.gen(function* () {
      const scheduler = new LaneScheduler(uniformWidths(1));
      const outcome = yield* Effect.exit(withLane(scheduler, LANE.CHILD, Effect.fail("boom")));
      assert.ok(Exit.isFailure(outcome));
      assert.equal(Option.getOrThrow(Cause.failureOption(outcome.cause)), "boom");
      yield* tick;
      assert.deepEqual(yield* laneSnapshot(scheduler, LANE.CHILD), {
        width: 1,
        active: 0,
        queued: 0,
      });
    }),
  );
});

describe("acquireLane", () => {
  it.effect("frees the slot at once when a queued acquire is interrupted before admission", () =>
    Effect.gen(function* () {
      const scheduler = new LaneScheduler(uniformWidths(1));
      const holding = yield* Deferred.make<void>();
      const first = yield* Effect.fork(
        Effect.scoped(Effect.zipRight(acquireLane(scheduler, LANE.CHILD), Deferred.await(holding))),
      );
      yield* tick;

      // Owns its own scope, so interrupting the fiber is what closes it: once
      // the port admits this waiter for real, the scope's own interruption
      // handling is what releases the slot right back, before anything runs
      // under it.
      const queued = yield* Effect.fork(Effect.scoped(acquireLane(scheduler, LANE.CHILD)));
      yield* tick;
      assert.deepEqual(yield* laneSnapshot(scheduler, LANE.CHILD), {
        width: 1,
        active: 1,
        queued: 1,
      });

      // `Fiber.interrupt` would itself wait for `queued` to terminate, which
      // cannot happen until `first` releases the slot below, so the signal is
      // sent without waiting for it.
      yield* Fiber.interruptFork(queued);
      yield* Deferred.succeed(holding, undefined);
      yield* Fiber.join(first);
      yield* Fiber.await(queued);
      yield* tick;

      assert.deepEqual(yield* laneSnapshot(scheduler, LANE.CHILD), {
        width: 1,
        active: 0,
        queued: 0,
      });
    }),
  );
});
