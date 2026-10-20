import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  LiveBroken,
  type LiveClient,
  liveRows,
  openRealtimeClient,
  type SealedRead,
} from "./live-follow.js";

/**
 * A read followed over Realtime answers every part's rows whole once each
 * part has its first result, renews every seal before the earliest expires,
 * and fails where a subscription stops for good or a renewal is refused.
 */

const URL = "wss://realtime.example/v1";

type Part = "left" | "right";

/** A sealed statement as the service answers one, named by its part and the round it was sealed in. */
function sealed(part: Part, round: number, expiresAt: number): SealedLiveQueryWire {
  return { capability: `${part}-${round}`, queryFingerprint: `fingerprint-${part}`, expiresAt };
}

/** The read sealed in `round`, every part expiring at `expiresAt`. */
function read(round: number, expiresAt: number): SealedRead<Part> {
  return {
    url: URL,
    queries: { left: sealed("left", round, expiresAt), right: sealed("right", round, expiresAt) },
  };
}

/**
 * Realtime as a script: each part's subscription by the capability it was
 * subscribed with, the seals it was renewed with, a way to deliver rows to
 * one or stop it for good, and whether the client was closed.
 */
function fakeRealtime(options: { readonly refuseRenewal?: boolean } = {}) {
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const renewed: string[] = [];
  const state = { closed: false };
  const client: LiveClient = {
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: (next) => {
        renewed.push(next.capability);
        return options.refuseRenewal === true
          ? Promise.reject(new Error("refused"))
          : Promise.resolve();
      },
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => {
      state.closed = true;
    },
  };
  const listener = (capability: string) => {
    const found = listeners.get(capability);
    assert.ok(found, `no subscription to ${capability}`);
    return found;
  };
  return {
    client,
    renewed,
    state,
    subscribed: () => [...listeners.keys()].toSorted(),
    deliver: (capability: string, data: readonly unknown[] | undefined) =>
      listener(capability)({ status: "live", data }),
    fail: (capability: string) => listener(capability)({ status: "error", data: undefined }),
  };
}

it.effect("answers every part's rows whole, once each has its first result", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const clock = yield* Clock.Clock;
    const expiresAt = clock.currentTimeMillisUnsafe() + 60_000;
    const rows = yield* Effect.forkChild(
      liveRows<Part>(
        {
          openLive: () => realtime.client,
          reseal: () => Effect.succeed(read(1, expiresAt + 60_000)),
          now: () => clock.currentTimeMillisUnsafe(),
        },
        read(0, expiresAt),
      ).pipe(Stream.take(2), Stream.runCollect),
    );
    yield* TestClock.adjust(Duration.millis(1));
    assert.deepEqual(realtime.subscribed(), ["left-0", "right-0"]);
    realtime.deliver("left-0", [{ id: "a" }]);
    realtime.deliver("right-0", undefined);
    realtime.deliver("right-0", []);
    realtime.deliver("left-0", [{ id: "a" }, { id: "b" }]);
    const answered = yield* Fiber.join(rows);
    assert.deepEqual(answered, [
      { left: [{ id: "a" }], right: [] },
      { left: [{ id: "a" }, { id: "b" }], right: [] },
    ]);
    assert.deepEqual(realtime.subscribed(), []);
    assert.equal(realtime.state.closed, true);
  }),
);

it.effect(
  "renews every seal ten seconds before the earliest expires, asking again a second after a reseal fails",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      const clock = yield* Clock.Clock;
      const start = clock.currentTimeMillisUnsafe();
      const reseals: (SealedRead<Part> | { readonly failure: string })[] = [
        { failure: "unavailable" },
        read(1, start + 120_000),
      ];
      const following = yield* Effect.forkChild(
        liveRows<Part>(
          {
            openLive: () => realtime.client,
            reseal: () => Effect.sync(() => reseals.shift() ?? read(2, start + 600_000)),
            now: () => clock.currentTimeMillisUnsafe(),
          },
          read(0, start + 60_000),
        ).pipe(Stream.runDrain),
      );
      yield* TestClock.adjust(Duration.seconds(49));
      assert.deepEqual(realtime.renewed, []);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.deepEqual(realtime.renewed, []);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.deepEqual(realtime.renewed.toSorted(), ["left-1", "right-1"]);
      yield* Fiber.interrupt(following);
    }),
);

it.effect("fails where a subscription stops for good", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const clock = yield* Clock.Clock;
    const expiresAt = clock.currentTimeMillisUnsafe() + 60_000;
    const following = yield* Effect.forkChild(
      liveRows<Part>(
        {
          openLive: () => realtime.client,
          reseal: () => Effect.succeed(read(1, expiresAt)),
          now: () => clock.currentTimeMillisUnsafe(),
        },
        read(0, expiresAt),
      ).pipe(Stream.runDrain),
    );
    yield* TestClock.adjust(Duration.millis(1));
    realtime.fail("right-0");
    const exit = yield* Fiber.await(following);
    assert.deepEqual(exit, Exit.fail(new LiveBroken({ reason: "the subscription stopped" })));
    assert.equal(realtime.state.closed, true);
  }),
);

it.effect("fails where a renewal is refused", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime({ refuseRenewal: true });
    const clock = yield* Clock.Clock;
    const start = clock.currentTimeMillisUnsafe();
    const following = yield* Effect.forkChild(
      liveRows<Part>(
        {
          openLive: () => realtime.client,
          reseal: () => Effect.succeed(read(1, start + 120_000)),
          now: () => clock.currentTimeMillisUnsafe(),
        },
        read(0, start + 60_000),
      ).pipe(Stream.runDrain),
    );
    yield* TestClock.adjust(Duration.seconds(50));
    const exit = yield* Fiber.await(following);
    assert.deepEqual(exit, Exit.fail(new LiveBroken({ reason: "a renewal was refused" })));
  }),
);

it.effect("fails where Realtime's client does not load", () =>
  Effect.gen(function* () {
    const exit = yield* liveRows<Part>(
      {
        openLive: () => Promise.reject(new Error("no module")),
        reseal: () => Effect.succeed(read(1, 0)),
        now: () => 0,
      },
      read(0, 60_000),
    ).pipe(Stream.runDrain, Effect.exit);
    assert.deepEqual(exit, Exit.fail(new LiveBroken({ reason: "Realtime's client did not load" })));
  }),
);

it.effect(
  "loads Realtime's own client when first asked, which refuses a seal not in Realtime's shape",
  () =>
    Effect.gen(function* () {
      const client = yield* Effect.promise(() => openRealtimeClient(URL));
      assert.throws(() => client.subscribe(sealed("left", 0, 60_000)));
      client.close();
    }),
);

it.effect("fails, rather than asking again, where a renewal finds the read gone", () =>
  Effect.gen(function* () {
    const realtime = fakeRealtime();
    const clock = yield* Clock.Clock;
    const start = clock.currentTimeMillisUnsafe();
    const following = yield* Effect.forkChild(
      liveRows<Part>(
        {
          openLive: () => realtime.client,
          reseal: () => Effect.succeed({ failure: "not-found", gone: true }),
          now: () => clock.currentTimeMillisUnsafe(),
        },
        read(0, start + 60_000),
      ).pipe(Stream.runDrain),
    );
    yield* TestClock.adjust(Duration.seconds(55));
    const exit = yield* Fiber.await(following);
    assert.deepEqual(exit, Exit.fail(new LiveBroken({ reason: "the read is gone" })));
  }),
);
