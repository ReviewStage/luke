import assert from "node:assert/strict";
import test from "node:test";
import type { AppStateSnapshot, AppWindowFacts } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import { type AppStateSource, createAppStateClient } from "./use-app-state";

/**
 * The one rule a window reads state by. Nothing here reads inside a slice —
 * the version and this window's own facts are the whole of what decides
 * whether a delivery is adopted — so a snapshot stands in as its version and
 * its facts.
 */
function snapshot(version: number, window?: Partial<AppWindowFacts>): AppStateSnapshot {
  // SAFETY: nothing under test reads a slice; only the version and the window facts are exercised.
  return {
    version,
    window: { role: WINDOW_ROLE.PANEL, mode: "compact", ...window },
  } as AppStateSnapshot;
}

/** A bridge that records what it was asked and delivers exactly when told. */
function source(answer: () => Promise<AppStateSnapshot>) {
  const deliveries: ((delivered: AppStateSnapshot) => void)[] = [];
  let subscriptions = 0;
  let reads = 0;
  const bridge: AppStateSource = {
    subscribe: (onDelivered) => {
      subscriptions += 1;
      deliveries.push(onDelivered);
      return () => {
        deliveries.splice(deliveries.indexOf(onDelivered), 1);
      };
    },
    read: () => {
      reads += 1;
      return answer();
    },
  };
  return {
    bridge,
    deliver: (delivered: AppStateSnapshot) => {
      for (const onDelivered of Array.from(deliveries)) onDelivered(delivered);
    },
    counts: () => ({ subscriptions, reads }),
  };
}

test("the read installs the subscription before it asks for anything", async () => {
  const held = source(async () => snapshot(4));
  const client = createAppStateClient(held.bridge);
  assert.equal(client.snapshot(), undefined);
  await client.read();
  assert.deepEqual(held.counts(), { subscriptions: 1, reads: 1 });
  assert.equal(client.snapshot()?.version, 4);
});

test("a delivery that raced past the read is the newer reading and the answer is dropped", async () => {
  const held = source(() => Promise.resolve(snapshot(4)));
  const client = createAppStateClient(held.bridge);
  const reading = client.read();
  // The push leaves the main process before the invoke's reply returns.
  held.deliver(snapshot(5));
  assert.equal((await reading).version, 5);
  assert.equal(client.snapshot()?.version, 5);
});

test("a delivery older than the one held changes nothing", async () => {
  const held = source(async () => snapshot(5));
  const client = createAppStateClient(held.bridge);
  await client.read();
  let redraws = 0;
  client.subscribe(() => {
    redraws += 1;
  });
  held.deliver(snapshot(4));
  assert.equal(client.snapshot()?.version, 5);
  assert.equal(redraws, 0);
});

test("a delivery repeating the version is this window's own facts having moved", async () => {
  const held = source(async () => snapshot(5));
  const client = createAppStateClient(held.bridge);
  await client.read();
  held.deliver(snapshot(5, { mode: "expanded" }));
  assert.equal(client.snapshot()?.window.mode, "expanded");
  assert.equal(client.snapshot()?.version, 5);
});

test("a gap in the versions is adopted rather than waited on", async () => {
  const held = source(async () => snapshot(1));
  const client = createAppStateClient(held.bridge);
  await client.read();
  // A version this window was never sent — its renderer had not subscribed
  // yet — leaves nothing to reconcile: each delivery is the whole document.
  held.deliver(snapshot(9));
  assert.equal(client.snapshot()?.version, 9);
  assert.deepEqual(held.counts(), { subscriptions: 1, reads: 1 });
});

test("every reader shares one subscription, and an unsubscribed one hears nothing", async () => {
  const held = source(async () => snapshot(1));
  const client = createAppStateClient(held.bridge);
  await client.read();
  const heard: string[] = [];
  const stop = client.subscribe(() => heard.push("first"));
  client.subscribe(() => heard.push("second"));
  held.deliver(snapshot(2));
  stop();
  held.deliver(snapshot(3));
  assert.deepEqual(heard, ["first", "second", "second"]);
  assert.equal(held.counts().subscriptions, 1);
});

test("a second read reuses the standing subscription", async () => {
  const held = source(async () => snapshot(1));
  const client = createAppStateClient(held.bridge);
  await client.read();
  await client.read();
  assert.deepEqual(held.counts(), { subscriptions: 1, reads: 2 });
});
