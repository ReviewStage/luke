import assert from "node:assert/strict";
import { test } from "vitest";
import { type LiveClient, shareLiveClients } from "./live-follow.js";

/**
 * Every read the host follows at one address shares one Realtime client and
 * its one socket: a second read opens nothing new, letting one go leaves the
 * other's subscriptions standing, the socket closes once the last is let go,
 * a handle let go twice counts once, and the next read opens a fresh one.
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

test("reads at one address share one client, closed once the last lets go", () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);

  const inbox = open("wss://realtime.example/v1");
  const plan = open("wss://realtime.example/v1");
  inbox.subscribe(sealed("inbox"));
  plan.subscribe(sealed("plan"));
  assert.deepEqual(clients.opened, ["wss://realtime.example/v1"]);
  assert.deepEqual(clients.subscribed, ["inbox", "plan"]);

  inbox.close();
  inbox.close();
  assert.deepEqual(clients.closed, [], "a handle let go twice counts once, and the plan's stands");
  plan.close();
  assert.deepEqual(clients.closed, ["wss://realtime.example/v1"]);

  open("wss://realtime.example/v1");
  assert.equal(clients.opened.length, 2, "the next read opens a fresh client");
});

test("reads at two addresses each have their own client", () => {
  const clients = scriptedClients();
  const open = shareLiveClients(clients.open);
  open("wss://one.example/v1");
  open("wss://two.example/v1");
  assert.deepEqual(clients.opened, ["wss://one.example/v1", "wss://two.example/v1"]);
});
