import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Context, Effect } from "effect";
import { type ActRouter, createActRouter } from "../act-router/index.js";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "../acts.js";
import type { AppStateSnapshot } from "../app-state.js";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, createInProcessBridge, initialAppState } from "./index.js";

/**
 * The bridge a shell installs when the host runs in its own page: an act
 * reaches the real router and comes back, answered unknown now that every
 * act rides the act port, the document is read and pushed from the store,
 * and a subscription ended hears nothing more.
 */

const RUN = {
  launch: { profile: "web", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "web",
} as const;

const REPORTER = "reporter-1";

const AGENT_PLACE = { taskId: "task-1", agentId: "agent-1" };

/** A bridge over the real router and a fresh store, its acts run on the test's own services. */
const bridgeFixture = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
  const reported: string[] = [];
  const made = yield* createInProcessBridge({
    sender: Symbol("page"),
    routerFor: (): ActRouter<symbol> => createActRouter({}),
    run: (effect) => Effect.runPromiseWith(services)(effect),
    state,
    windowFacts: () => ({ fullScreen: false }),
    createId: () => REPORTER,
    reports: { notifyReady: () => {}, recordSurfaceEvent: () => {} },
    report: (message) => reported.push(message),
  });
  // The push's first reading is of the document as it stood, before anything subscribed.
  yield* Effect.yieldNow;
  return { ...made, state, reported };
});

it.effect("an act the port answers comes back from the router unknown to app:act", () =>
  Effect.gen(function* () {
    const { bridge } = yield* bridgeFixture;
    const outcome = yield* Effect.promise(() =>
      // SAFETY: a forged act, as a page that kept the old channel would send it; `Act` describes none.
      bridge.act({
        kind: ACT_KIND.WINDOW_COPY_TEXT,
        payload: { words: "copied" },
      } as unknown as Act),
    );
    assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }).pipe(Effect.scoped),
);

it.effect("the document is read on request and every change of it reaches a subscription", () =>
  Effect.gen(function* () {
    const { bridge, state } = yield* bridgeFixture;
    const read = yield* Effect.promise(() => bridge.requestAppState());
    assert.deepEqual(read, { ...state.snapshot(), window: { fullScreen: false } });

    const heard: AppStateSnapshot[] = [];
    bridge.onAppState((snapshot) => heard.push(snapshot));
    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    yield* Effect.yieldNow;
    assert.equal(heard.length, 1);
    assert.equal(heard[0]?.version, read.version + 1);
    assert.equal(heard[0]?.audio.microphoneStatus, MICROPHONE_STATUS.GRANTED);
  }).pipe(Effect.scoped),
);

it.effect("a voice subscription ends cleanly", () =>
  Effect.gen(function* () {
    const { bridge } = yield* bridgeFixture;
    const unsubscribe = bridge.onVoiceHotkeyPress(() => assert.fail("no talk key in the page"));
    unsubscribe();
  }).pipe(Effect.scoped),
);

it.effect("an ended subscription hears neither the document nor an event again", () =>
  Effect.gen(function* () {
    const { bridge, events, state } = yield* bridgeFixture;
    const versions: number[] = [];
    const shown: unknown[] = [];
    const endState = bridge.onAppState((snapshot) => versions.push(snapshot.version));
    const endShow = bridge.onShowAgent((place) => shown.push(place));

    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    events.onShowAgent(AGENT_PLACE);
    yield* Effect.yieldNow;
    endState();
    endShow();
    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.DENIED } });
    events.onShowAgent(AGENT_PLACE);
    yield* Effect.yieldNow;

    assert.deepEqual(versions, [1]);
    assert.deepEqual(shown, [AGENT_PLACE]);
  }).pipe(Effect.scoped),
);

it.effect("a listener that throws is reported, and the others still hear the event", () =>
  Effect.gen(function* () {
    const { bridge, events, reported } = yield* bridgeFixture;
    const shown: unknown[] = [];
    bridge.onShowAgent(() => {
      throw new Error("the view went away");
    });
    bridge.onShowAgent((place) => shown.push(place));
    events.onShowAgent(AGENT_PLACE);
    assert.deepEqual(shown, [AGENT_PLACE]);
    assert.deepEqual(reported, ["a page's bridge listener failed: the view went away"]);
  }).pipe(Effect.scoped),
);

it.effect("a closed bridge tells its page nothing more, nor takes a new subscription", () =>
  Effect.gen(function* () {
    const shown: unknown[] = [];
    const { bridge, events } = yield* Effect.scoped(
      Effect.tap(bridgeFixture, ({ bridge }) =>
        Effect.sync(() => bridge.onShowAgent((place) => shown.push(place))),
      ),
    );
    bridge.onShowAgent((place) => shown.push(place));
    events.onShowAgent(AGENT_PLACE);
    assert.deepEqual(shown, []);
  }),
);
