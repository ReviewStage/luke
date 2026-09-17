import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { serialQueue } from "./serial-queue.js";

it.effect("work is taken in the order it was offered, one piece at a time", () =>
  Effect.gen(function* () {
    const taken: number[] = [];
    const home = yield* Scope.make();
    const queue = yield* Effect.provideService(
      serialQueue({ onDefect: () => Effect.void }),
      Scope.Scope,
      home,
    );

    // The first piece sleeps, so a second taken concurrently would land first.
    queue.offerUnsafe(
      Effect.delay(
        Effect.sync(() => void taken.push(1)),
        "1 second",
      ),
    );
    queue.offerUnsafe(Effect.sync(() => void taken.push(2)));
    yield* queue.offer(Effect.sync(() => void taken.push(3)));
    const done = yield* Deferred.make<void>();
    yield* queue.offer(Effect.asVoid(Deferred.succeed(done, undefined)));
    yield* TestClock.adjust("1 second");
    yield* Deferred.await(done);
    assert.deepEqual(taken, [1, 2, 3]);

    yield* Scope.close(home, Exit.void);
  }),
);

it.effect("a piece that dies is handed to onDefect and the next piece is still taken", () =>
  Effect.gen(function* () {
    const defects: string[] = [];
    const taken: string[] = [];
    const home = yield* Scope.make();
    const queue = yield* Effect.provideService(
      serialQueue({
        onDefect: (cause) => Effect.sync(() => void defects.push(String(cause))),
      }),
      Scope.Scope,
      home,
    );

    queue.offerUnsafe(Effect.die(new Error("boom")));
    queue.offerUnsafe(Effect.sync(() => void taken.push("after")));
    yield* TestClock.adjust("1 millis");
    assert.equal(defects.length, 1);
    assert.match(defects[0] ?? "", /boom/u);
    assert.deepEqual(taken, ["after"]);

    yield* Scope.close(home, Exit.void);
  }),
);

it.effect("the scope closing ends the fiber, and drainOnClose runs what was still waiting", () =>
  Effect.gen(function* () {
    const taken: string[] = [];
    const home = yield* Scope.make();
    const gate = yield* Deferred.make<void>();
    const queue = yield* Effect.provideService(
      serialQueue({ onDefect: () => Effect.void, drainOnClose: true }),
      Scope.Scope,
      home,
    );

    // The first piece holds the fiber at the gate, so the second is still on the queue at the close.
    queue.offerUnsafe(Effect.uninterruptible(Effect.andThen(Deferred.await(gate), Effect.void)));
    queue.offerUnsafe(Effect.sync(() => void taken.push("drained")));
    yield* TestClock.adjust("1 millis");
    assert.equal(taken.length, 0);

    yield* Deferred.succeed(gate, undefined);
    yield* Scope.close(home, Exit.void);
    assert.deepEqual(taken, ["drained"]);

    // A close without the drain would have lost it: nothing takes after the fiber has ended.
    queue.offerUnsafe(Effect.sync(() => void taken.push("late")));
    yield* TestClock.adjust("1 second");
    assert.deepEqual(taken, ["drained"]);
  }),
);
