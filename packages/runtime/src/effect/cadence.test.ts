import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber, Schedule, Scope } from "effect";
import { TestClock } from "effect/testing";
import { cadenceGate } from "./cadence.js";

it.effect("a disarm ends the fibers an arming forked from inside an uninterruptible region", () =>
  Effect.gen(function* () {
    const beats: number[] = [];
    let armedFiber: Fiber.RuntimeFiber<number, never> | undefined;
    const armed = Effect.gen(function* () {
      armedFiber = yield* Effect.forkScoped(
        Effect.interruptible(
          Effect.schedule(
            Effect.sync(() => beats.push(beats.length)),
            Schedule.spaced(Duration.seconds(1)),
          ),
        ),
      );
    });

    const home = yield* Scope.make();
    const gate = yield* Effect.provideService(cadenceGate(armed), Scope.Scope, home);

    // The arm runs the way a composer's start and an account gate's opening
    // run it: uninterruptibly, which is what a fork inherits.
    yield* Effect.uninterruptible(gate.arm);
    yield* TestClock.adjust("3 seconds");
    assert.deepEqual(beats, [0, 1, 2]);

    yield* gate.disarm;
    assert.ok(armedFiber !== undefined);
    assert.equal(Exit.isInterrupted(yield* Fiber.await(armedFiber)), true);

    yield* TestClock.adjust("1 minute");
    assert.deepEqual(beats, [0, 1, 2]);

    yield* Scope.close(home, Exit.void);
  }),
);
