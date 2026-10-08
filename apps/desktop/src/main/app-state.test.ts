import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { runModeFor } from "@sidecar/host";
import { Context, Effect, Fiber, Stream } from "effect";
import { type AppState, sessionReplayBootstrap } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { AppStateStore, bootstrapPatch, initialAppState } from "./app-state";
import type { HostBootstrap } from "./gateway/host-operator";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of main now leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and `changes`
 * carries exactly one document per applied patch.
 */

const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

function store(): AppStateStore {
  return new AppStateStore(initialAppState(RUN, true), Context.empty());
}

/**
 * The `count` documents `changes` carries once `act` has run, starting with
 * the one standing before it: `SubscriptionRef.changes` is the current value
 * concatenated with every value set after, so this always opens with the
 * document as it stood before `act`'s own writes. The collector is forked and
 * given one turn to reach its own subscription — a `SubscriptionRef`'s
 * `changes` only delivers a write to a subscriber already reading when it
 * happens — before `act`'s synchronous writes run.
 */
function watchChanges(
  app: AppStateStore,
  count: number,
  act: () => void,
): Effect.Effect<AppState[]> {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(app.changes, count)));
    yield* Effect.yieldNow;
    act();
    return yield* Fiber.join(fiber);
  });
}

/**
 * A payload the document only ever carries whole. The store never reads
 * inside one — it compares and holds — so what stands in for a settings
 * snapshot, a roster entry, or a run record is an empty record, and the one
 * assertion that says so is here rather than at each of them.
 */
function inert<Value>(): Value {
  // SAFETY: nothing under test reads a field of these payloads; only their identity and equality are exercised.
  return {} as Value;
}

const SETTINGS = inert<NonNullable<AppState["settings"]>>();

it("a fresh document is version zero and carries this launch's own facts", () => {
  const state = store().snapshot();
  assert.equal(state.version, 0);
  assert.equal(state.run.appVersion, "1.2.3");
  assert.equal(state.account.status, ACCOUNT_STATUS.SIGNED_OUT);
  assert.equal(state.update.currentVersion, "1.2.3");
  assert.equal(state.update.installSupported, true);
  assert.equal(state.audio.microphoneStatus, MICROPHONE_STATUS.NOT_DETERMINED);
});

it.effect("one slice patched bumps the version once and announces once on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.version, 1);
    assert.equal(seen[1]?.audio.microphoneStatus, MICROPHONE_STATUS.GRANTED);
  }),
);

it.effect("a patch that says nothing new announces nothing on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({});
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED } });
      app.update({ voice: {} });
      // The one real patch is the second document `changes` ever carries; the
      // three no-ops before it wrote nothing for a collector to see.
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.version, 0);
    assert.equal(seen[1]?.version, 1);
  }),
);

it("two slices in one patch are one version", () => {
  const app = store();
  app.update({
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    voice: { view: IDLE_VOICE_VIEW },
  });
  assert.equal(app.snapshot().version, 1);
  assert.equal(app.snapshot().voice.view, IDLE_VOICE_VIEW);
});

it.effect("a touch re-announces the document without numbering it again", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 4, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      app.touch();
      app.touch();
    });
    assert.deepEqual(
      seen.map((state) => state.version),
      [0, 1, 1, 1],
    );
  }),
);

it("a slice is replaced whole rather than merged field by field", () => {
  const app = store();
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.DENIED } });
  assert.deepEqual(app.snapshot().audio, { microphoneStatus: MICROPHONE_STATUS.DENIED });
});

it("the version climbs once per applied patch", () => {
  const app = store();
  for (let index = 0; index < 10; index += 1) {
    app.update({
      audio: {
        microphoneStatus:
          index % 2 === 0 ? MICROPHONE_STATUS.GRANTED : MICROPHONE_STATUS.NOT_DETERMINED,
      },
    });
  }
  assert.equal(app.snapshot().version, 10);
});

it("a voice window that went away leaves the document holding no view", () => {
  const app = store();
  app.update({ voice: { view: { ...IDLE_VOICE_VIEW, talkOpening: true } } });
  app.update({ voice: {} });
  assert.equal(app.snapshot().voice.view, undefined);
});

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessionReplay: { permitted: true, accountId: "person" },
  voiceAvailable: true,
  agentTraceEnabled: true,
};

it("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.equal(held.run.agentTraceEnabled, true);
  assert.deepEqual(held.sessionReplay, { permitted: true, accountId: "person", halted: false });
});

it("a halt outlives every host read until the host's own event stands it down", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  // The account is going and the host still answers `permitted` until its
  // store has caught up; a window bootstrapping in that window must not
  // restart a recording that was stood down.
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  assert.equal(app.snapshot().sessionReplay.halted, true);
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("recording is what the host permitted less what an account's end stood down", () => {
  const app = store();
  app.update({ sessionReplay: { permitted: true, accountId: "person", halted: false } });
  assert.deepEqual(sessionReplayBootstrap(app.snapshot()), {
    permitted: true,
    appVersion: "1.2.3",
    accountId: "person",
  });
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});
