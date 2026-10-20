import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Cause, Effect, Exit, Fiber, Logger, Option, Stream } from "effect";
import { TestClock } from "effect/testing";
import { test } from "vitest";
import {
  type LiveClient,
  LiveSignedOut,
  liveRows,
  logLiveBroken,
  type SealedRead,
  shareLiveClients,
} from "./live-follow.js";

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
  const listeners: ((snapshot: {
    readonly status: string;
    readonly data: undefined;
    readonly error?: { readonly code: string };
  }) => void)[] = [];
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
  const fail = (code = "connection_lost") => {
    for (const listener of listeners)
      listener({ status: "error", data: undefined, error: { code } });
  };
  return { open, opened, closed, subscribed, fail };
}

/** Every step the read has to take, taken. */
const settled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

const sealed = (capability: string) => ({ capability, queryFingerprint: capability, expiresAt: 0 });

test("reads at one address share one client, closed once the last lets go", async () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);

  const [inbox, plan] = await Promise.all([
    open("wss://realtime.example/v1"),
    open("wss://realtime.example/v1"),
  ]);
  inbox.subscribe(sealed("inbox"));
  plan.subscribe(sealed("plan"));
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
  inbox.subscribe(sealed("inbox"));
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

it.effect(
  "a renewal refused as signed out ends the read as signed out and is never asked again, where an unanswered one is asked again a second later",
  () =>
    Effect.gen(function* () {
      const clients = scriptedClients();
      const answers: (SealedRead<"items"> | { readonly failure: string })[] = [
        { failure: "unanswered" },
        LIVE_SIGNED_OUT,
      ];
      let asked = 0;
      const first: SealedRead<"items"> = {
        url: "wss://realtime.example/v1",
        queries: { items: { capability: "items", queryFingerprint: "items", expiresAt: 20_000 } },
      };
      const reading = yield* Effect.forkChild(
        Stream.runDrain(
          liveRows(
            {
              openLive: clients.open,
              reseal: () =>
                Effect.sync(() => {
                  asked += 1;
                  return answers.shift() ?? { failure: "unanswered" };
                }),
              now: () => 0,
            },
            first,
          ),
        ),
      );
      yield* settled;
      yield* TestClock.adjust("10 seconds");
      yield* settled;
      assert.equal(asked, 1);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.equal(asked, 2);
      const ended = yield* Fiber.await(reading);
      assert.ok(Exit.isFailure(ended));
      assert.deepEqual(Cause.findErrorOption(ended.cause), Option.some(new LiveSignedOut()));
      yield* TestClock.adjust("1 minute");
      assert.equal(asked, 2, "signed out, it renews no more");
    }),
);

it.effect(
  "a subscription Realtime stopped breaks the read, which says why in the log by Realtime's code and never the sealed statement",
  () =>
    Effect.gen(function* () {
      const logged: string[] = [];
      const recorder = Logger.map(Logger.formatStructured, (line) => {
        logged.push(JSON.stringify(line));
      });
      const clients = scriptedClients();
      const first: SealedRead<"items"> = {
        url: "wss://realtime.example/v1",
        queries: {
          items: { capability: "sealed-secret", queryFingerprint: "items", expiresAt: 60_000 },
        },
      };
      const reading = yield* Effect.forkChild(
        Stream.runDrain(
          liveRows(
            {
              openLive: clients.open,
              reseal: () => Effect.succeed({ failure: "unanswered" }),
              now: () => 0,
            },
            first,
          ),
        ).pipe(
          Effect.catchTag("LiveBroken", (broken) => logLiveBroken("the account inbox", broken)),
          Effect.provide(Logger.layer([recorder])),
        ),
      );
      yield* settled;
      clients.fail("authorization_failed");
      yield* Fiber.join(reading);
      assert.equal(logged.length, 1);
      assert.match(logged[0] ?? "", /the account inbox broke: the subscription stopped/);
      assert.match(logged[0] ?? "", /"code":"authorization_failed"/);
      assert.ok(!logged.some((line) => line.includes("sealed-secret")));
    }),
);
