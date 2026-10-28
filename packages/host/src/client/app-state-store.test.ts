import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { TRANSCRIPT_SPEAKER } from "@luke/live";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import { Context, Effect, Fiber, Stream } from "effect";
import { WindowPushes } from "../act-port/push-procedures.js";
import { type AppState, sessionReplayBootstrap } from "../app-state.js";
import { PUSH, type PushEvent } from "../contract/index.js";
import type { HostBootstrap } from "../host-operator.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import {
  AppStateStore,
  bootstrapPatch,
  initialAppState,
  publishAppStateChanges,
  voiceWindowGaveUp,
  voiceWindowGone,
  windowAppState,
} from "./app-state-store.js";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of the client leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and `changes`
 * carries exactly one document per applied patch.
 */

/** Two pages of a plan and the agent that showed them, as the store's identity test holds them. */
const PAGE_ONE = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d01";
const PAGE_TWO = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d02";
const AGENT = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d03";

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
  return new AppStateStore(initialAppState(RUN, true, []), Context.empty());
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

it("a slice that moved keeps every part of it that did not, so what a reader held of it is the object it still holds", () => {
  const app = store();
  const page = (id: string, title: string, agentId: string) => ({
    id,
    title,
    version: 1,
    at: 0,
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId },
  });
  app.update({
    tasks: {
      ...app.snapshot().tasks,
      activeTaskId: "plan-1",
      pages: [page(PAGE_ONE, "Invites", AGENT), page(PAGE_TWO, "Billing", AGENT)],
    },
  });
  const held = app.snapshot().tasks;

  // The host's next view: the same data, every object of it new, and the second page retitled.
  const next = {
    ...structuredClone(held),
    pages: [page(PAGE_ONE, "Invites", AGENT), page(PAGE_TWO, "Billing and plans", AGENT)],
  };
  app.update({ tasks: next });
  const now = app.snapshot().tasks;

  assert.equal(app.snapshot().version, 2);
  assert.deepEqual(now, next);
  assert.equal(now.document, held.document);
  assert.equal(now.pages?.[0], held.pages?.[0]);
  assert.notEqual(now.pages?.[1], held.pages?.[1]);
  assert.equal(now.pages?.[1]?.shownBy, held.pages?.[1]?.shownBy);
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

it("a voice window that went away leaves the document holding no view", () => {
  const app = store();
  app.update({ voice: { view: { ...IDLE_VOICE_VIEW, talkOpening: true } } });
  app.update({ voice: voiceWindowGone() });
  assert.equal(app.snapshot().voice.view, undefined);
});

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessionReplay: { permitted: true, accountId: "person" },
  access: { admin: true },
  voiceAvailable: true,
  agentTraceEnabled: true,
};

it("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.equal(held.run.agentTraceEnabled, true);
  assert.deepEqual(held.sessionReplay, { permitted: true, accountId: "person", halted: false });
  assert.deepEqual(held.access, { admin: true });
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
    packaged: true,
    accountId: "person",
  });
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("an unpackaged run never records, whatever the host permitted", () => {
  const app = new AppStateStore(
    initialAppState({ ...RUN, packaged: false }, true, []),
    Context.empty(),
  );
  app.update({ sessionReplay: { permitted: true, accountId: "person", halted: false } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it.effect(
  "a push that dies is reported, to Sentry as well, and the next change is still pushed",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const app = store();
      const reported: string[] = [];
      let pushes = 0;
      const publish = () =>
        Effect.suspend(() => {
          pushes += 1;
          return pushes === 1 ? Effect.die(new Error("the window went away")) : Effect.void;
        });
      yield* publishAppStateChanges(app, publish, (message) => reported.push(message));
      yield* Effect.yieldNow;
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      yield* Effect.yieldNow;
      assert.equal(pushes, 2);
      assert.deepEqual(reported, ["the app-state push to windows failed: the window went away"]);
      assert.deepEqual(sentry.reported, ["the window went away"]);
    }).pipe(Effect.scoped, Effect.provide(sentry.layer));
  },
);

/** One line said on a call, its words as given. */
function said(rowId: string, words: string) {
  return { rowId, speaker: TRANSCRIPT_SPEAKER.USER, words, startMs: 0, endMs: 100 };
}

it("a caption on a standing call hands a panel the voice and the line that grew, never the tasks, the call window the voice alone, and the voice window nothing", async () => {
  const pushes = new WindowPushes<object>();
  const voiceWindow = { handle: {}, role: { voice: true, call: false } };
  const panelWindow = { handle: {}, role: { voice: false, call: false } };
  const callWindow = { handle: {}, role: { voice: false, call: true } };
  const windows = [voiceWindow, panelWindow, callWindow];
  const [voice, panel, call] = windows.map(({ handle }) => pushes.stream(handle, undefined));
  if (voice === undefined || panel === undefined || call === undefined) throw new Error("unopened");
  const app = store();
  const publish = () => {
    for (const { handle, role } of windows) {
      pushes.pushState(handle, windowAppState(app.snapshot(), role, { fullScreen: false }));
    }
  };
  const delivered = async (stream: AsyncIteratorObject<PushEvent>) => {
    const read = await stream.next();
    if (read.done || read.value.push !== PUSH.APP_STATE) throw new Error("no document was sent");
    return read.value.payload;
  };
  const first = said("row-1", "Invite a teammate");
  app.update({
    voice: { view: IDLE_VOICE_VIEW },
    callTranscript: { voiceSessionId: "session-1", lines: [first] },
  });
  publish();
  for (const stream of [voice, panel, call]) await delivered(stream);

  // The voice window reports the next caption: the line said grows.
  const view = { ...IDLE_VOICE_VIEW, listening: true };
  app.update({
    voice: { ...app.snapshot().voice, view },
    callTranscript: { voiceSessionId: "session-1", lines: [first, said("row-2", "by email")] },
  });
  publish();
  assert.deepEqual(await delivered(panel), {
    version: 2,
    entries: { voice: { view } },
    callTranscript: {
      voiceSessionId: "session-1",
      from: 1,
      lines: [said("row-2", "by email")],
    },
  });
  assert.deepEqual(await delivered(call), {
    version: 2,
    entries: { voice: { view } },
  });
  pushes.push(voiceWindow.handle, PUSH.SHOW_AGENT, { taskId: "task-1", agentId: "agent-1" });
  assert.deepEqual((await voice.next()).value, {
    push: PUSH.SHOW_AGENT,
    payload: { taskId: "task-1", agentId: "agent-1" },
  });
});

it("a voice window given up on sets voice unavailable for the run: no view, and a later bootstrap keeps it", () => {
  const app = store();
  assert.equal(app.snapshot().voice.unavailable, undefined);
  app.update({ voice: { view: { ...IDLE_VOICE_VIEW, talkOpening: true } } });
  app.update({ voice: voiceWindowGaveUp() });
  assert.equal(app.snapshot().voice.unavailable, true);
  assert.equal(app.snapshot().voice.view, undefined);
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  assert.equal(app.snapshot().voice.unavailable, true);
});
