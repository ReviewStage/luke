import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { lookedUntil } from "../http/held-read.js";
import {
  type LiveSubscriber,
  LiveWake,
  type LiveWatch,
  realtimeServers,
  realtimeWake,
} from "./live-wake.js";

/**
 * A wait on a row, woken by Neon Realtime: it looks again as soon as the
 * rows change, and on a safety beat beside; with no wake provided it fails
 * rather than polling; and the wake over Realtime's direct server subscribes
 * to each statement for the length of the wait, subscribes again where one
 * moves to error, on a new server where the connection failed, and lets go
 * after.
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

/** Realtime's direct servers as a script: each one opened, its subscriptions by name, and which are let go. */
function scriptedRealtime() {
  const subscriptions: {
    readonly name: string;
    readonly update: Set<() => void>;
    readonly state: Set<(state: { readonly status: string }) => void>;
  }[] = [];
  const unsubscribed: string[] = [];
  const closed: number[] = [];
  let opened = 0;
  let refuse = false;
  /** Servers whose connection failed, on which a subscription is in error the moment it is made. */
  const failed = new Set<number>();
  const open = (): LiveSubscriber => {
    const server = opened++;
    return {
      subscribe: () => {
        if (refuse) return Promise.reject(new Error("refused"));
        const name = `server-${server}/query-${subscriptions.length}`;
        const update = new Set<() => void>();
        const state = new Set<(state: { readonly status: string }) => void>();
        subscriptions.push({ name, update, state });
        const status = failed.has(server) ? "error" : "live";
        return Promise.resolve({
          onUpdate: (listener) => {
            update.add(listener);
            return () => void update.delete(listener);
          },
          onStateChange: (listener) => {
            state.add(listener);
            return () => void state.delete(listener);
          },
          getState: () => ({ status }),
          unsubscribe: () => void unsubscribed.push(name),
        });
      },
      close: () => void closed.push(server),
    };
  };
  const standing = () => subscriptions.filter(({ name }) => !unsubscribed.includes(name));
  return {
    open,
    closed,
    unsubscribed,
    names: () => subscriptions.map(({ name }) => name),
    update: () => {
      for (const { update } of standing()) for (const listener of update) listener();
    },
    /** Every standing subscription moves to `error`, and with `connection`, its server can no longer subscribe. */
    fail: (connection: boolean) => {
      if (connection) failed.add(opened - 1);
      for (const { state } of standing())
        for (const listener of state) listener({ status: "error" });
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
      const realtime = scriptedRealtime();
      const wake = realtimeWake(yield* realtimeServers(realtime.open));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watch = yield* wake.watch([STATEMENT, STATEMENT]);
          assert.deepEqual(realtime.names(), ["server-0/query-0", "server-0/query-1"]);
          const changed = yield* Effect.forkChild(watch.changed);
          yield* settled;
          realtime.update();
          yield* Fiber.join(changed);
          // A change no wait took yet is taken by the next one at once.
          realtime.update();
          yield* watch.changed;
        }),
      );
      assert.deepEqual(realtime.unsubscribed.toSorted(), ["server-0/query-0", "server-0/query-1"]);

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

it.effect(
  "a subscription that moves to error is made again and wakes the wait; where the connection failed, it is made again on a new server and the old one closed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const realtime = scriptedRealtime();
        const wake = realtimeWake(yield* realtimeServers(realtime.open));
        const watch = yield* wake.watch([STATEMENT]);
        assert.deepEqual(realtime.names(), ["server-0/query-0"]);

        realtime.fail(false);
        yield* watch.changed;
        yield* settled;
        assert.deepEqual(realtime.names(), ["server-0/query-0", "server-0/query-1"]);
        assert.deepEqual(realtime.closed, []);

        realtime.fail(true);
        yield* watch.changed;
        yield* settled;
        assert.deepEqual(realtime.names(), [
          "server-0/query-0",
          "server-0/query-1",
          "server-0/query-2",
          "server-1/query-3",
        ]);
        assert.deepEqual(realtime.closed, [0]);
        const changed = yield* Effect.forkChild(watch.changed);
        yield* settled;
        realtime.update();
        yield* Fiber.join(changed);
      }),
    ),
);
