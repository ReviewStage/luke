import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { lookedUntil } from "../http/held-read.js";
import { type LiveSubscriber, LiveWake, type LiveWatch, realtimeWake } from "./live-wake.js";

/**
 * A wait on a row, woken by Neon Realtime: it looks again as soon as the
 * rows change, and on a safety beat beside; with no wake provided it fails
 * rather than polling; and the wake over Realtime's direct server subscribes
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

/** A watch a test changes by hand. */
function scriptedWatch() {
  let wake: (() => void) | undefined;
  const watch: LiveWatch = {
    changed: Effect.callback<void>((resume) => {
      wake = () => resume(Effect.void);
    }),
  };
  return {
    wake: { watch: () => Effect.succeed(watch) },
    change: () => wake?.(),
  };
}

it.effect("with no wake provided a wait fails rather than looking on a clock", () =>
  Effect.gen(function* () {
    const script = scriptedLook();
    const exit = yield* Effect.exit(lookedUntil(script.look, "10 seconds", [STATEMENT]));
    assert.ok(Exit.isFailure(exit));
    assert.equal(script.looks(), 0);
  }),
);

it.effect(
  "watched, a wait looks again the moment its rows change rather than on its poll, and on the safety beat beside",
  () =>
    Effect.gen(function* () {
      const script = scriptedLook();
      const watch = scriptedWatch();
      const waiting = yield* Effect.forkChild(
        lookedUntil(script.look, "1 minute", [STATEMENT]).pipe(
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

/** Realtime's direct server as a script: each subscription's listeners, and which are let go. */
function scriptedSubscriber() {
  const updates: (() => void)[] = [];
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
    refuse: () => {
      refuse = true;
    },
  };
}

it.effect(
  "the wake over Realtime subscribes to each statement for the length of a wait, wakes it on any update, and lets go after; a refused subscription leaves the wait on its safety beat",
  () =>
    Effect.gen(function* () {
      const realtime = scriptedSubscriber();
      const wake = realtimeWake(realtime.subscriber);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* wake.watch([STATEMENT, STATEMENT]);
          assert.deepEqual(realtime.subscribed, ["query-0", "query-1"]);
          const changed = yield* Effect.forkChild(watch.changed);
          yield* settled;
          realtime.update();
          yield* Fiber.join(changed);
          // A change no wait took yet is taken by the next one at once.
          realtime.update();
          yield* watch.changed;
        }),
      );
      assert.deepEqual(realtime.unsubscribed.toSorted(), ["query-0", "query-1"]);

      realtime.refuse();
      const script = scriptedLook();
      const waiting = yield* Effect.forkChild(
        lookedUntil(script.look, "1 minute", [STATEMENT]).pipe(
          Effect.provideService(LiveWake, wake),
        ),
      );
      yield* settled;
      assert.equal(script.looks(), 1);
      yield* TestClock.adjust("5 seconds");
      assert.equal(script.looks(), 2);
      yield* Fiber.interrupt(waiting);
    }),
);
