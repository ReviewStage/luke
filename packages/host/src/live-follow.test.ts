import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Clock, Duration, Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import {
  LiveBroken,
  type LiveClient,
  liveRows,
  openRealtimeClient,
  type SealedRead,
  shareLiveClients,
  type TxWait,
} from "./live-follow.js";

/**
 * A read followed over Realtime answers every part's rows whole once each
 * part has its first result, renews every seal before the earliest expires,
 * is polled while Realtime fails it and no longer once Realtime delivers
 * again, and fails where the read is gone.
 */

const URL = "wss://realtime.example/v1";

/** Every step the read has to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

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
function fakeRealtime(
  options: { readonly refuseRenewal?: boolean; readonly arrivesOn?: string } = {},
) {
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
      // A transaction arrives on the one part named, as a write reaches only the parts whose rows it changes.
      awaitTxId: () =>
        query.capability === (options.arrivesOn ?? query.capability)
          ? Promise.resolve()
          : Promise.reject(new Error("timed out")),
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
          poll: () => Effect.succeed({ failure: "unavailable" }),
          now: () => clock.currentTimeMillisUnsafe(),
        },
        read(0, expiresAt),
      ).pipe(Stream.take(2), Stream.runCollect),
    );
    yield* settled;
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
            poll: () => Effect.succeed({ failure: "unavailable" }),
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
          poll: () => Effect.succeed({ failure: "unavailable" }),
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

it.effect(
  "a subscription in error switches the read to polling, its rows fed on, until Realtime delivers again",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime();
      let polled: unknown[] = [{ id: "polled-1" }];
      const rows: unknown[] = [];
      const following = yield* Effect.forkChild(
        Stream.runForEach(
          liveRows<Part>(
            {
              openLive: () => realtime.client,
              reseal: () => Effect.succeed(read(1, 3_600_000)),
              poll: () =>
                Effect.sync(() => ({
                  url: LIVE_POLL_URL,
                  queries: {
                    left: { ...sealed("left", 9, 0), rows: polled },
                    right: { ...sealed("right", 9, 0), rows: [] },
                  },
                })),
              now: () => 0,
            },
            read(0, 3_600_000),
          ),
          (whole) => Effect.sync(() => void rows.push(whole)),
        ),
      );
      yield* settled;
      realtime.fail("left-0");
      yield* settled;
      assert.deepEqual(rows, [{ left: [{ id: "polled-1" }], right: [] }]);
      polled = [{ id: "polled-2" }];
      yield* TestClock.adjust(Duration.seconds(3));
      yield* settled;
      assert.deepEqual(rows.at(-1), { left: [{ id: "polled-2" }], right: [] }, "polled again");

      yield* TestClock.adjust(Duration.seconds(15));
      yield* settled;
      realtime.deliver("left-1", [{ id: "live" }]);
      realtime.deliver("right-1", []);
      yield* settled;
      polled = [{ id: "stale" }];
      yield* TestClock.adjust(Duration.seconds(30));
      yield* settled;
      assert.deepEqual(rows.at(-1), { left: [{ id: "live" }], right: [] }, "no polling once back");
      yield* Fiber.interrupt(following);
    }),
);

/**
 * Every read the host follows at one address shares one Realtime client and
 * its one socket: a second read opens nothing new, letting one go leaves the
 * other's subscriptions standing, the socket closes once the last is let go,
 * a handle let go twice counts once, and the next read opens a fresh one.
 * Reads that wait on a client still loading share it too, and a client that
 * failed to load is asked for afresh by the next read.
 *
 * Realtime's client is a script that counts what it opened and closed.
 */

function scriptedClients() {
  const opened: string[] = [];
  const closed: string[] = [];
  const subscribed: string[] = [];
  const listeners: ((snapshot: { readonly status: string; readonly data: undefined }) => void)[] =
    [];
  const open = (url: string): LiveClient => {
    opened.push(url);
    return {
      subscribe: (query) => {
        subscribed.push(query.capability);
        return {
          onChange: (listener) => {
            listeners.push(listener);
            return () => undefined;
          },
          renew: () => Promise.resolve(),
          awaitTxId: () => Promise.resolve(),
          unsubscribe: () => undefined,
        };
      },
      close: () => void closed.push(url),
    };
  };
  /** Every subscription so far moves to `error`, as a failed connection moves them. */
  const fail = () => {
    for (const listener of listeners) listener({ status: "error", data: undefined });
  };
  return { open, opened, closed, subscribed, fail };
}

const sealedAs = (capability: string) => ({
  capability,
  queryFingerprint: capability,
  expiresAt: 0,
});

test("reads at one address share one client, closed once the last lets go", async () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);

  const [inbox, plan] = await Promise.all([
    open("wss://realtime.example/v1"),
    open("wss://realtime.example/v1"),
  ]);
  inbox.subscribe(sealedAs("inbox"));
  plan.subscribe(sealedAs("plan"));
  assert.deepEqual(clients.opened, ["wss://realtime.example/v1"]);
  assert.deepEqual(clients.subscribed, ["inbox", "plan"]);

  inbox.close();
  inbox.close();
  assert.deepEqual(clients.closed, [], "a handle let go twice counts once, and the plan's stands");
  plan.close();
  assert.deepEqual(clients.closed, ["wss://realtime.example/v1"]);

  await open("wss://realtime.example/v1");
  assert.equal(clients.opened.length, 2, "the next read opens a fresh client");
});

test("a client a subscription saw fail is replaced for the next read, and closed once its holders let go", async () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);
  const inbox = await open("wss://realtime.example/v1");
  inbox.subscribe(sealedAs("inbox"));
  clients.fail();

  const plan = await open("wss://realtime.example/v1");
  assert.equal(clients.opened.length, 2, "the next read opens a new client");
  inbox.close();
  assert.deepEqual(clients.closed, ["wss://realtime.example/v1"], "the failed one closes");
  plan.close();
  assert.equal(clients.closed.length, 2);
});

test("reads at two addresses each have their own client", async () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);
  await open("wss://one.example/v1");
  await open("wss://two.example/v1");
  assert.deepEqual(clients.opened, ["wss://one.example/v1", "wss://two.example/v1"]);
});

test("a client that failed to load is opened afresh by the next read", async () => {
  const clients = scriptedClients();
  let loads = 0;
  const open = shareLiveClients((url) => {
    loads += 1;
    return loads === 1 ? Promise.reject(new Error("offline")) : clients.open(url);
  });
  await assert.rejects(open("wss://realtime.example/v1"));
  await open("wss://realtime.example/v1");
  assert.deepEqual(clients.opened, ["wss://realtime.example/v1"]);
});

it.effect("a read whose session the service refuses as signed out ends, and is asked no more", () =>
  Effect.gen(function* () {
    const exit = yield* liveRows<Part>(
      {
        openLive: () => fakeRealtime().client,
        reseal: () => Effect.succeed(LIVE_SIGNED_OUT),
        poll: () => Effect.succeed(LIVE_SIGNED_OUT),
        now: () => 0,
      },
      { ...read(0, 0), url: LIVE_POLL_URL },
    ).pipe(Stream.runDrain, Effect.exit);
    assert.ok(Exit.isFailure(exit));
  }),
);

it.effect(
  "hands out a wait for a write's transaction once subscribed, settled by the part it reaches, and none once let go",
  () =>
    Effect.gen(function* () {
      const realtime = fakeRealtime({ arrivesOn: "right-0" });
      let wait: TxWait | undefined;
      const following = yield* Effect.forkChild(
        liveRows<Part>(
          {
            openLive: () => realtime.client,
            reseal: () => Effect.succeed(read(1, 3_600_000)),
            poll: () => Effect.succeed({ failure: "unavailable" }),
            now: () => 0,
            onTxWait: (next) => {
              wait = next;
            },
          },
          read(0, 3_600_000),
        ).pipe(Stream.runDrain),
      );
      yield* settled;
      assert.ok(wait, "a wait once subscribed");
      yield* wait("42", Duration.seconds(5));
      yield* Fiber.interrupt(following);
      assert.equal(wait, undefined, "none once let go");
    }),
);
