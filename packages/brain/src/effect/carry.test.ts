import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Runtime } from "effect";
import { detachOn } from "./carry.js";

/**
 * The detach door's whole reason is the step it stands in, so what these pin
 * is the start rather than the answer: `BrainAgent#detach` and `BrainHost`'s
 * retirement drain both need the detached effect's first step — the queue's
 * own acquisition, a revocation — to have run by the time the call returns,
 * and no fork Effect offers gives that.
 */
describe("the detach door", () => {
  it("begins the effect on the calling stack", () => {
    const steps: string[] = [];
    detachOn(Runtime.defaultRuntime)(Effect.sync(() => steps.push("detached")));
    assert.deepEqual(steps, ["detached"]);
  });

  it.effect("is what `Effect.forkDaemon` is not: a fork only schedules the fiber", () =>
    Effect.gen(function* () {
      const steps: string[] = [];
      yield* Effect.forkDaemon(Effect.sync(() => steps.push("forked")));
      assert.deepEqual(steps, []);
      yield* Effect.yieldNow();
      assert.deepEqual(steps, ["forked"]);
    }),
  );

  it("runs the first step even when the effect suspends right behind it", async () => {
    // The miniature of `BrainAgent#enqueue`: a turn is counted queued by the
    // acquisition, and only then asks for the conversation's one permit.
    const runPromise = Runtime.runPromise(Runtime.defaultRuntime);
    const permit = Effect.unsafeMakeSemaphore(1);
    let queued = 0;
    await runPromise(permit.take(1));
    const detached = detachOn(Runtime.defaultRuntime)(
      Effect.acquireUseRelease(
        Effect.sync(() => {
          queued += 1;
        }),
        () => permit.withPermits(1)(Effect.void),
        () =>
          Effect.sync(() => {
            queued -= 1;
          }),
      ),
    );
    // Counted queued before the call returned, though the work behind the
    // acquisition has not begun: the one permit is still held elsewhere.
    assert.equal(queued, 1);
    await runPromise(permit.release(1));
    await runPromise(Fiber.join(detached));
    assert.equal(queued, 0);
  });

  it("answers the fiber, so a caller that must know how the work ended awaits it", async () => {
    const fiber = detachOn(Runtime.defaultRuntime)(Effect.succeed("ended"));
    const exit = await Runtime.runPromise(Runtime.defaultRuntime)(Fiber.await(fiber));
    assert.deepEqual(exit, Exit.succeed("ended"));
  });

  it("dispatches a built `ManagedRuntime` onto the same synchronous start", async () => {
    const managed = ManagedRuntime.make(Layer.empty);
    await managed.runtime();
    const steps: string[] = [];
    detachOn(managed)(Effect.sync(() => steps.push("detached")));
    assert.deepEqual(steps, ["detached"]);
    await managed.dispose();
  });
});
