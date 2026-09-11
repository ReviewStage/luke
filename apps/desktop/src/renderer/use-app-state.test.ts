import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Registry from "@effect-atom/atom/Registry";
import * as Result from "@effect-atom/atom/Result";
import { Effect, Fiber, Option } from "effect";
import type { AppStateSnapshot, AppWindowFacts } from "#shared/messages/app-state";
import { WINDOW_ROLE } from "#shared/messages/session";
import { type AppStateSource, appStateAtom, appStateSourceAtom } from "./use-app-state";

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

/**
 * A registry of this test's own, holding the atom over a bridge of its own.
 * Every window has one; nothing is shared between two of them.
 */
function reading(answer: () => Promise<AppStateSnapshot>) {
  const held = source(answer);
  const registry = Registry.make();
  registry.set(appStateSourceAtom, held.bridge);
  return {
    ...held,
    registry,
    read: () => Registry.getResult(registry, appStateAtom),
    held: () => Option.getOrUndefined(Result.value(registry.get(appStateAtom))),
  };
}

/**
 * A delivery reaches the atom on the runtime's own fiber rather than inside
 * the bridge's call, so what a delivery did — or did not do — is read after
 * the runtime has had it.
 */
const settled = Effect.sleep(20);

it.live("the read installs the subscription before it asks for anything", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(4));
    assert.equal(state.held(), undefined);
    yield* state.read();
    assert.deepEqual(state.counts(), { subscriptions: 1, reads: 1 });
    assert.equal(state.held()?.version, 4);
  }),
);

it.live("a delivery that raced past the read is the newer reading and the answer is dropped", () =>
  Effect.gen(function* () {
    let answer: (delivered: AppStateSnapshot) => void = () => {};
    const state = reading(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const reader = yield* Effect.fork(state.read());
    yield* settled;
    // The push leaves the main process before the invoke's reply returns.
    state.deliver(snapshot(5));
    answer(snapshot(4));
    yield* settled;
    assert.equal((yield* Fiber.join(reader)).version, 5);
    assert.equal(state.held()?.version, 5);
  }),
);

it.live("a delivery older than the one held changes nothing", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(5));
    yield* state.read();
    let redraws = 0;
    state.registry.subscribe(appStateAtom, () => {
      redraws += 1;
    });
    state.deliver(snapshot(4));
    yield* settled;
    assert.equal(state.held()?.version, 5);
    assert.equal(redraws, 0);
  }),
);

it.live("a delivery repeating the version is this window's own facts having moved", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(5));
    yield* state.read();
    state.deliver(snapshot(5, { mode: "expanded" }));
    yield* settled;
    assert.equal(state.held()?.window.mode, "expanded");
    assert.equal(state.held()?.version, 5);
  }),
);

it.live("a gap in the versions is adopted rather than waited on", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(1));
    yield* state.read();
    // A version this window was never sent — its renderer had not subscribed
    // yet — leaves nothing to reconcile: each delivery is the whole document.
    state.deliver(snapshot(9));
    yield* settled;
    assert.equal(state.held()?.version, 9);
    assert.deepEqual(state.counts(), { subscriptions: 1, reads: 1 });
  }),
);

it.live("every reader shares one subscription, and an unsubscribed one hears nothing", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(1));
    yield* state.read();
    const heard: string[] = [];
    const stop = state.registry.subscribe(appStateAtom, () => heard.push("first"));
    state.registry.subscribe(appStateAtom, () => heard.push("second"));
    state.deliver(snapshot(2));
    yield* settled;
    stop();
    state.deliver(snapshot(3));
    yield* settled;
    assert.deepEqual(heard, ["first", "second", "second"]);
    assert.equal(state.counts().subscriptions, 1);
  }),
);

it.live("a second read asks the bridge nothing, since the document already stands", () =>
  Effect.gen(function* () {
    const state = reading(async () => snapshot(1));
    yield* state.read();
    yield* state.read();
    assert.deepEqual(state.counts(), { subscriptions: 1, reads: 1 });
  }),
);
