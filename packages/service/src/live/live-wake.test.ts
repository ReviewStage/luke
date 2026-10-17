import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { lookedUntil } from "../http/held-read.js";
import { type LiveSubscriber, LiveWake, type LiveWatch, realtimeWake } from "./live-wake.js";

/**
 * A wait on a row, woken by Neon Realtime where the deployment has it: with
 * no Realtime it looks on its own poll; watched, it looks again as soon as
 * the rows change, and on a safety beat beside; a watch that breaks hands
 * it back to its poll; and the wake over Realtime's direct server subscribes
 * to each statement for the length of the wait and lets go after.
 *
 * Statements and rows are synthetic; Realtime is a script.
 */

const STATEMENT = { sql: "select 1 as one where $1 = $1", params: ["user-dana"] } as const;

/** Every step the wait has to take, taken. */
const settled = Effect.repeat(Effect.yieldNow, { times: 50 });

/** A look that finds nothing until `found` is set, counting each time it looks. */
function scriptedLook() {
  let found: string | undefined;
  let looks = 0;
  return {
    look: Effect.sync(() => {
      looks += 1;
      return Option.fromNullishOr(found);
    }),
    find: (value: string) => {
      found = value;
    },
    looks: () => looks,
  };
}

/** A watch a test changes and breaks by hand. */
function scriptedWatch() {
  let live = true;
  let wake: (() => void) | undefined;
  const watch: LiveWatch = {
    live: Effect.sync(() => live),
    changed: Effect.callback<void>((resume) => {
      wake = () => resume(Effect.void);
    }),
  };
  return {
    wake: { watch: () => Effect.succeed(watch) },
    change: () => wake?.(),
    break: () => {
      live = false;
      wake?.();
    },
  };
}

it.effect("with no Realtime a wait looks on its own poll, and none is found past the hold", () =>
  Effect.gen(function* () {
    const script = scriptedLook();
    const waiting = yield* Effect.forkChild(
      lookedUntil(script.look, "1 second", "10 seconds", [STATEMENT]),
    );
    yield* settled;
    assert.equal(script.looks(), 1);
    yield* TestClock.adjust("3 seconds");
    assert.equal(script.looks(), 4);
    yield* TestClock.adjust("10 seconds");
    assert.deepEqual(yield* Fiber.join(waiting), Option.none());
  }),
);

it.effect(
  "watched, a wait looks again the moment its rows change rather than on its poll, and on the safety beat beside",
  () =>
    Effect.gen(function* () {
      const script = scriptedLook();
      const watch = scriptedWatch();
      const waiting = yield* Effect.forkChild(
        lookedUntil(script.look, "1 hour", "1 minute", [STATEMENT]).pipe(
          Effect.provideService(LiveWake, watch.wake),
        ),
      );
      yield* settled;
      assert.equal(script.looks(), 1);
      yield* TestClock.adjust("5 seconds");
      assert.equal(script.looks(), 2, "the safety beat looks though nothing said the rows changed");
      script.find("settled");
      watch.change();
      yield* settled;
      assert.deepEqual(yield* Fiber.join(waiting), Option.some("settled"));
      assert.equal(script.looks(), 3);
    }),
);

it.effect("a watch that breaks hands the wait back to its own poll", () =>
  Effect.gen(function* () {
    const script = scriptedLook();
    const watch = scriptedWatch();
    const waiting = yield* Effect.forkChild(
      lookedUntil(script.look, "1 second", "1 minute", [STATEMENT]).pipe(
        Effect.provideService(LiveWake, watch.wake),
      ),
    );
    yield* settled;
    watch.break();
    yield* settled;
    const before = script.looks();
    yield* TestClock.adjust("2 seconds");
    assert.equal(script.looks(), before + 2);
    script.find("late");
    yield* TestClock.adjust("1 second");
    assert.deepEqual(yield* Fiber.join(waiting), Option.some("late"));
  }),
);

/** Realtime's direct server as a script: each subscription's listeners, and which are let go. */
function scriptedSubscriber() {
  const updates: (() => void)[] = [];
  const states: ((state: { readonly status: string }) => void)[] = [];
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  let refuse = false;
  const subscriber: LiveSubscriber = {
    subscribe: () => {
      if (refuse) return Promise.reject(new Error("refused"));
      const name = `query-${subscribed.length}`;
      subscribed.push(name);
      return Promise.resolve({
        onUpdate: (listener) => {
          updates.push(listener);
          return () => undefined;
        },
        onStateChange: (listener) => {
          states.push(listener);
          return () => undefined;
        },
        unsubscribe: () => void unsubscribed.push(name),
      });
    },
  };
  return {
    subscriber,
    subscribed,
    unsubscribed,
    update: () => {
      for (const listener of updates) listener();
    },
    fail: () => {
      for (const listener of states) listener({ status: "error" });
    },
    refuse: () => {
      refuse = true;
    },
  };
}

it.effect(
  "the wake over Realtime subscribes to each statement for the length of a wait, wakes it on any update, breaks on an error, and lets go after",
  () =>
    Effect.gen(function* () {
      const realtime = scriptedSubscriber();
      const wake = realtimeWake(realtime.subscriber);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* wake.watch([STATEMENT, STATEMENT]);
          assert.deepEqual(realtime.subscribed, ["query-0", "query-1"]);
          assert.equal(yield* watch.live, true);
          const changed = yield* Effect.forkChild(watch.changed);
          yield* settled;
          realtime.update();
          yield* Fiber.join(changed);
          // A change no wait took yet is taken by the next one at once.
          realtime.update();
          yield* watch.changed;
          realtime.fail();
          assert.equal(yield* watch.live, false);
          yield* watch.changed;
        }),
      );
      assert.deepEqual(realtime.unsubscribed.toSorted(), ["query-0", "query-1"]);

      realtime.refuse();
      const refused = yield* Effect.scoped(wake.watch([STATEMENT]));
      assert.equal(yield* refused.live, false);
    }),
);
