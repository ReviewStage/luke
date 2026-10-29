import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { MICROPHONE_STATUS } from "@luke/settings/microphone";
import { Context, Effect } from "effect";
import type { AppStateDelivery } from "../app-state.js";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, createInProcessBridge, initialAppState } from "./index.js";

/**
 * The bridge a shell installs when the host runs in its own page: the
 * document is read and pushed from the store, and a subscription ended hears
 * nothing more.
 */

const RUN = {
  launch: { profile: "web", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "web",
} as const;

const LINK = {
  workspace: "workspace-1",
  place: { kind: LINK_PLACE.TASK, planId: "plan-1" },
} as const;

/** A bridge over a fresh store. */
const bridgeFixture = Effect.gen(function* () {
  const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
  const reported: string[] = [];
  const made = yield* createInProcessBridge({
    state,
    windowFacts: () => ({ fullScreen: false }),
    reports: { notifyReady: () => {}, recordSurfaceEvent: () => {} },
    report: (message) => reported.push(message),
  });
  // The push's first reading is of the document as it stood, before anything subscribed.
  yield* Effect.yieldNow;
  return { ...made, state, reported };
});

it.effect(
  "the document is read whole on request and every change of it reaches a subscription as what moved",
  () =>
    Effect.gen(function* () {
      const { bridge, state } = yield* bridgeFixture;
      const read = yield* Effect.promise(() => bridge.requestAppState());
      assert.deepEqual(read, { ...state.snapshot(), window: { fullScreen: false } });

      const heard: AppStateDelivery[] = [];
      bridge.onAppState((delivery) => heard.push(delivery));
      state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      yield* Effect.yieldNow;
      assert.deepEqual(heard, [
        {
          version: read.version + 1,
          entries: { audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } },
        },
      ]);
    }).pipe(Effect.scoped),
);

it.effect("an ended subscription hears neither the document nor an event again", () =>
  Effect.gen(function* () {
    const { bridge, events, state } = yield* bridgeFixture;
    const versions: number[] = [];
    const shown: unknown[] = [];
    const endState = bridge.onAppState((delivery) => versions.push(delivery.version));
    const endShow = bridge.onShowLink((place) => shown.push(place));

    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    events.onShowLink(LINK);
    yield* Effect.yieldNow;
    endState();
    endShow();
    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.DENIED } });
    events.onShowLink(LINK);
    yield* Effect.yieldNow;

    assert.deepEqual(versions, [1]);
    assert.deepEqual(shown, [LINK]);
  }).pipe(Effect.scoped),
);

it.effect("a listener that throws is reported, and the others still hear the event", () =>
  Effect.gen(function* () {
    const { bridge, events, reported } = yield* bridgeFixture;
    const shown: unknown[] = [];
    bridge.onShowLink(() => {
      throw new Error("the view went away");
    });
    bridge.onShowLink((place) => shown.push(place));
    events.onShowLink(LINK);
    assert.deepEqual(shown, [LINK]);
    assert.deepEqual(reported, ["a page's bridge listener failed: the view went away"]);
  }).pipe(Effect.scoped),
);

it.effect("a closed bridge tells its page nothing more, nor takes a new subscription", () =>
  Effect.gen(function* () {
    const shown: unknown[] = [];
    const { bridge, events } = yield* Effect.scoped(
      Effect.tap(bridgeFixture, ({ bridge }) =>
        Effect.sync(() => bridge.onShowLink((place) => shown.push(place))),
      ),
    );
    bridge.onShowLink((place) => shown.push(place));
    events.onShowLink(LINK);
    assert.deepEqual(shown, []);
  }),
);
