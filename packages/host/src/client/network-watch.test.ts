import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkNetworkWatch } from "./network-watch.js";

/**
 * What a window reads of the network: the document's `network` slice follows
 * the platform's probe within one interval, either way, moves the version
 * only when the answer moved, runs what catches up once each time the
 * network comes back, and stops following once the client's scope closes.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

/** A store and a probe whose answer the test sets, first `online`, the watch linked into `scope`, and how many times it ran `regained`. */
function watched(scope: Scope.Closeable, online = true) {
  return Effect.gen(function* () {
    const machine = { online };
    const regained = { times: 0 };
    const state = new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context());
    yield* linkNetworkWatch({
      state,
      isOnline: () => machine.online,
      regained: Effect.sync(() => {
        regained.times += 1;
      }),
    }).pipe(Scope.provide(scope));
    return { machine, state, regained };
  });
}

it.effect("a network lost and regained reaches the document within one interval", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { machine, state } = yield* watched(scope);
    assert.equal(state.snapshot().network.online, true);

    machine.online = false;
    yield* TestClock.adjust("2 seconds");
    assert.equal(state.snapshot().network.online, false);

    machine.online = true;
    yield* TestClock.adjust("2 seconds");
    assert.equal(state.snapshot().network.online, true);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("a network found again catches up once, and a loss or a steady network does not", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { machine, regained } = yield* watched(scope);
    yield* TestClock.adjust("10 seconds");
    assert.equal(regained.times, 0, "a network there at launch was never lost");

    machine.online = false;
    yield* TestClock.adjust("10 seconds");
    assert.equal(regained.times, 0);

    machine.online = true;
    yield* TestClock.adjust("10 seconds");
    assert.equal(regained.times, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("a machine offline at launch is said at once, not an interval later", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { state } = yield* watched(scope, false);
    yield* Effect.yieldNow;

    assert.equal(state.snapshot().network.online, false);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("a steady network moves no version", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { state } = yield* watched(scope);
    const before = state.snapshot().version;

    yield* TestClock.adjust("1 minute");

    assert.equal(state.snapshot().version, before);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("the watch stops with the client's scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const { machine, state } = yield* watched(scope);
    yield* Scope.close(scope, Exit.void);

    machine.online = false;
    yield* TestClock.adjust("1 minute");

    assert.equal(state.snapshot().network.online, true);
  }),
);
