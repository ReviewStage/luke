import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { accountCall, NO_CREDENTIAL, ServiceReach, type ServiceReachState } from "@repo/features";
import { HTTP_METHOD } from "@repo/wire";
import { jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { Effect, Exit, Scope, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkNetworkWatch } from "./network-watch.js";

/**
 * What a window reads of the network: the document's `network` slice follows
 * the platform's probe within one interval, either way, and the service's
 * reach as its calls set it, moves the version only when the answer moved,
 * runs what catches up once each time the app can reach the service again,
 * survives a probe that throws, and stops following once the client's scope
 * closes.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

/**
 * A store, a probe whose answer the test sets, first `online`, which throws
 * `fault` once where one is set, and the service's reach its calls would
 * set, first answered at the clock's start, the watch linked into `scope`,
 * how many times it ran `regained`, which reads again as `reRead` does, and
 * what the watch reported.
 */
function watched(
  scope: Scope.Closeable,
  online = true,
  reRead: (reach: SubscriptionRef.SubscriptionRef<ServiceReachState>) => Effect.Effect<void> = () =>
    Effect.void,
) {
  return Effect.gen(function* () {
    const machine: { online: boolean; fault?: Error | undefined } = { online };
    const regained = { times: 0 };
    const reported: string[] = [];
    const reach = yield* SubscriptionRef.make<ServiceReachState>({
      reachable: true,
      answeredAt: 0,
    });
    const state = new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context());
    yield* linkNetworkWatch({
      state,
      isOnline: () => {
        const { fault } = machine;
        machine.fault = undefined;
        if (fault !== undefined) throw fault;
        return machine.online;
      },
      regained: Effect.andThen(
        Effect.sync(() => {
          regained.times += 1;
        }),
        reRead(reach),
      ),
      report: (message) => reported.push(message),
    }).pipe(Scope.provide(scope), Effect.provideService(ServiceReach, reach));
    return { machine, reach, state, regained, reported };
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

it.effect(
  "the service unanswered is said at once, and catches up only once it answers again with the network back",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { machine, reach, state, regained } = yield* watched(scope);

      yield* SubscriptionRef.set(reach, { reachable: false, answeredAt: 0 });
      machine.online = false;
      yield* TestClock.adjust("2 seconds");
      assert.deepEqual(state.snapshot().network, { online: false, reachable: false });

      machine.online = true;
      yield* TestClock.adjust("10 seconds");
      assert.equal(regained.times, 0, "the network back while the service still does not answer");

      yield* SubscriptionRef.set(reach, { reachable: true, answeredAt: 12_000 });
      yield* Effect.yieldNow;
      assert.deepEqual(state.snapshot().network, { online: true, reachable: true });
      assert.equal(regained.times, 1);
      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect(
  "a re-read caught up with once the service answered again that runs out its deadline leaves the service reachable",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      // The service fails one call, answers the next, and then answers nothing.
      let asked = 0;
      const service = recordingHttpClient(() => {
        asked += 1;
        if (asked === 1) throw new TypeError("Load failed");
        return asked === 2 ? jsonResponse({ ok: true }) : new Promise<Response>(() => undefined);
      });
      const call = accountCall({ baseUrl: "https://app.test", credential: NO_CREDENTIAL });
      const reReads: unknown[] = [];
      const send = (reach: SubscriptionRef.SubscriptionRef<ServiceReachState>) =>
        call
          .send({ method: HTTP_METHOD.GET, path: "/api/live/tasks" })
          .pipe(Effect.provide(service.layer), Effect.provideService(ServiceReach, reach));
      const { reach, state, regained } = yield* watched(scope, true, (reach) =>
        Effect.map(send(reach), (answer) => reReads.push(answer)),
      );

      yield* TestClock.adjust("1 minute");
      yield* send(reach);
      yield* Effect.yieldNow;
      assert.deepEqual(state.snapshot().network, { online: true, reachable: false });

      yield* send(reach);
      while (asked < 3) yield* Effect.yieldNow;
      assert.equal(regained.times, 1);
      yield* TestClock.adjust("10 seconds");
      while (reReads.length === 0) yield* Effect.yieldNow;

      assert.deepEqual(reReads, [{ fault: "network", errorName: "TimeoutError" }]);
      assert.deepEqual(state.snapshot().network, { online: true, reachable: true });
      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect(
  "a probe that throws is reported, to Sentry as well, and the next still writes the network",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const { machine, state, reported } = yield* watched(scope);
      machine.fault = new Error("the probe went away");
      yield* TestClock.adjust("2 seconds");

      machine.online = false;
      yield* TestClock.adjust("2 seconds");

      assert.equal(state.snapshot().network.online, false);
      assert.deepEqual(reported, [
        "the network watch could not note a change: the probe went away",
      ]);
      assert.deepEqual(sentry.reported, ["the probe went away"]);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(sentry.layer));
  },
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
