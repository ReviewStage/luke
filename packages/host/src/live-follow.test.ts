import assert from "node:assert/strict";
import { test } from "vitest";
import { type LiveClient, shareLiveClients } from "./live-follow.js";

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
  const open = (url: string): LiveClient => {
    opened.push(url);
    return {
      subscribe: (query) => {
        subscribed.push(query.capability);
        return {
          onChange: () => () => undefined,
          renew: () => Promise.resolve(),
          unsubscribe: () => undefined,
        };
      },
      close: () => void closed.push(url),
    };
  };
  return { open, opened, closed, subscribed };
}

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
