import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Fiber, Option, TestClock } from "effect";
import { claimedUnlessAborted, settledUnlessAborted, whenAborted } from "./settled.js";

interface CountedSignal {
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly listening: () => number;
}

/**
 * A real signal that counts what is attached to it, so a wait that leaves a
 * listener behind on a signal outliving it is a failing assertion rather than
 * a slow leak.
 */
const countedSignal = (): CountedSignal => {
  const controller = new AbortController();
  const signal = controller.signal;
  const attach = AbortSignal.prototype.addEventListener.bind(signal);
  const detach = AbortSignal.prototype.removeEventListener.bind(signal);
  const attached = new Set<EventListenerOrEventListenerObject>();
  Object.defineProperty(signal, "addEventListener", {
    value: (type: string, listener: EventListenerOrEventListenerObject) => {
      attached.add(listener);
      attach(type, listener);
    },
  });
  Object.defineProperty(signal, "removeEventListener", {
    value: (type: string, listener: EventListenerOrEventListenerObject) => {
      attached.delete(listener);
      detach(type, listener);
    },
  });
  return {
    signal,
    abort: () => {
      controller.abort();
    },
    listening: () => attached.size,
  };
};

const answeredAfter = <A>(delay: Duration.Duration, value: A): Effect.Effect<A> =>
  Effect.as(Effect.sleep(delay), value);

describe("whenAborted", () => {
  it.effect("completes when the signal fires and leaves nothing attached", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const fiber = yield* Effect.fork(whenAborted(counted.signal));
      yield* Effect.yieldNow();
      assert.equal(counted.listening(), 1);

      counted.abort();
      yield* Fiber.join(fiber);

      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("leaves nothing attached when it is interrupted instead", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const fiber = yield* Effect.fork(whenAborted(counted.signal));
      yield* Effect.yieldNow();
      assert.equal(counted.listening(), 1);

      yield* Fiber.interrupt(fiber);

      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("completes at once on a signal that already fired", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      counted.abort();

      yield* whenAborted(counted.signal);

      assert.equal(counted.listening(), 0);
    }),
  );
});

describe("settledUnlessAborted", () => {
  it.effect("refuses the work when the signal fires before it completes", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const fiber = yield* Effect.fork(
        settledUnlessAborted(answeredAfter(Duration.minutes(1), "answer"), counted.signal),
      );
      yield* Effect.yieldNow();

      counted.abort();
      yield* TestClock.adjust(Duration.minutes(2));

      assert.deepEqual(yield* Fiber.join(fiber), Option.none());
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("answers the work's value when it completes while the signal stands", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const fiber = yield* Effect.fork(
        settledUnlessAborted(answeredAfter(Duration.minutes(1), "answer"), counted.signal),
      );

      yield* TestClock.adjust(Duration.minutes(1));

      assert.deepEqual(yield* Fiber.join(fiber), Option.some("answer"));
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("refuses work needing no suspension on a signal that had already fired", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      counted.abort();

      const settled = yield* settledUnlessAborted(Effect.succeed("answer"), counted.signal);

      assert.deepEqual(settled, Option.none());
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("carries the work's own failure when nothing was decided yet", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const failure = { reason: "refused" } as const;

      const exit = yield* Effect.exit(settledUnlessAborted(Effect.fail(failure), counted.signal));

      assert.deepEqual(exit, Effect.runSyncExit(Effect.fail(failure)));
      assert.equal(counted.listening(), 0);
    }),
  );
});

describe("claimedUnlessAborted", () => {
  it.effect("keeps a claim already taken when the signal fires after it", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const discarded: string[] = [];
      const fiber = yield* Effect.fork(
        claimedUnlessAborted(answeredAfter(Duration.minutes(1), "held"), counted.signal, (value) =>
          discarded.push(value),
        ),
      );

      yield* TestClock.adjust(Duration.minutes(1));
      const settled = yield* Fiber.join(fiber);

      counted.abort();
      yield* TestClock.adjust(Duration.minutes(1));

      assert.deepEqual(settled, Option.some("held"));
      assert.deepEqual(discarded, []);
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("hands a value arriving after the abort to the discard, exactly once", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const discarded: string[] = [];
      const fiber = yield* Effect.fork(
        claimedUnlessAborted(answeredAfter(Duration.minutes(1), "held"), counted.signal, (value) =>
          discarded.push(value),
        ),
      );
      yield* Effect.yieldNow();

      counted.abort();
      const settled = yield* Fiber.join(fiber);
      assert.deepEqual(settled, Option.none());
      assert.deepEqual(discarded, []);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* Effect.yieldNow();

      assert.deepEqual(discarded, ["held"]);
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("discards work needing no suspension on a signal that had already fired", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const discarded: string[] = [];
      counted.abort();

      const settled = yield* claimedUnlessAborted(Effect.succeed("held"), counted.signal, (value) =>
        discarded.push(value),
      );
      yield* Effect.yieldNow();

      assert.deepEqual(settled, Option.none());
      assert.deepEqual(discarded, ["held"]);
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("discards the value of a signal that had already fired", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const discarded: string[] = [];
      counted.abort();

      const settled = yield* claimedUnlessAborted(
        answeredAfter(Duration.minutes(1), "held"),
        counted.signal,
        (value) => discarded.push(value),
      );
      assert.deepEqual(settled, Option.none());

      yield* TestClock.adjust(Duration.minutes(1));
      yield* Effect.yieldNow();

      assert.deepEqual(discarded, ["held"]);
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect("carries the work's own failure when nothing was decided yet", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const failure = { reason: "refused" } as const;

      const exit = yield* Effect.exit(
        claimedUnlessAborted(Effect.fail(failure), counted.signal, () => undefined),
      );

      assert.deepEqual(exit, Effect.runSyncExit(Effect.fail(failure)));
      assert.equal(counted.listening(), 0);
    }),
  );

  it.effect(
    "leaves a value owned by exactly one party when the claim and the interruption race",
    () =>
      Effect.gen(function* () {
        const counted = countedSignal();
        const discarded: string[] = [];
        const gate = yield* Deferred.make<string>();
        const fiber = yield* Effect.fork(
          claimedUnlessAborted(Deferred.await(gate), counted.signal, (value) =>
            discarded.push(value),
          ),
        );
        yield* Effect.yieldNow();

        // The work answers and the wait is taken away in the same moment: the
        // claim may land first or the interruption may, and either way the
        // value is the discard's rather than nobody's.
        yield* Deferred.succeed(gate, "held");
        yield* Fiber.interrupt(fiber);
        yield* Effect.yieldNow();

        assert.deepEqual(discarded, ["held"]);
        assert.equal(counted.listening(), 0);
      }),
  );

  it.effect("hands the value to the discard when the waiting fiber is interrupted", () =>
    Effect.gen(function* () {
      const counted = countedSignal();
      const discarded: string[] = [];
      const fiber = yield* Effect.fork(
        claimedUnlessAborted(answeredAfter(Duration.minutes(1), "held"), counted.signal, (value) =>
          discarded.push(value),
        ),
      );
      yield* Effect.yieldNow();

      yield* Fiber.interrupt(fiber);
      counted.abort();
      yield* TestClock.adjust(Duration.minutes(1));
      yield* Effect.yieldNow();

      assert.deepEqual(discarded, ["held"]);
      assert.equal(counted.listening(), 0);
    }),
  );
});
