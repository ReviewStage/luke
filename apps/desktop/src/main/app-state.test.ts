import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { LIVE_SESSION_PHASE } from "@sidecar/gateway";
import { runModeFor } from "@sidecar/host";
import { test } from "vitest";
import { type AppState, sessionReplayBootstrap } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { AppStateStore, bootstrapPatch, initialAppState } from "./app-state";
import type { HostBootstrap } from "./gateway/host-operator";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of main now leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and one
 * announcement follows each applied patch.
 */

const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    fixtureName: undefined,
    startPeeked: false,
    startInSlot: false,
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

function store(): AppStateStore {
  return new AppStateStore(initialAppState(RUN, true));
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

test("a fresh document is version zero and carries this launch's own facts", () => {
  const state = store().snapshot();
  assert.equal(state.version, 0);
  assert.equal(state.run.appVersion, "1.2.3");
  assert.equal(state.run.observesProviders, true);
  assert.equal(state.sessions.settled, false);
  assert.equal(state.account.status, ACCOUNT_STATUS.SIGNED_OUT);
  assert.equal(state.update.currentVersion, "1.2.3");
  assert.equal(state.update.installSupported, true);
  assert.equal(state.audio.microphoneStatus, MICROPHONE_STATUS.NOT_DETERMINED);
});

test("nothing is introducing itself until the launch's own gate says so", () => {
  const app = store();
  assert.equal(app.snapshot().introduction.playing, false);
  app.update({ introduction: { playing: true } });
  assert.equal(app.snapshot().introduction.playing, true);
  // The standing is the whole of the takeover, so the ending is a write to it
  // and a second ending is no write at all.
  const versionAtEnding = app.snapshot().version + 1;
  app.update({ introduction: { playing: false } });
  app.update({ introduction: { playing: false } });
  assert.equal(app.snapshot().introduction.playing, false);
  assert.equal(app.snapshot().version, versionAtEnding);
});

test("one slice patched bumps the version once and announces once", () => {
  const app = store();
  let announced = 0;
  app.subscribe(() => {
    announced += 1;
  });
  app.update({ announcements: { held: true } });
  assert.equal(announced, 1);
  assert.equal(app.snapshot().version, 1);
  assert.equal(app.snapshot().announcements.held, true);
});

test("a patch that says nothing new is no patch at all", () => {
  const app = store();
  let announced = 0;
  app.subscribe(() => {
    announced += 1;
  });
  app.update({});
  app.update({ announcements: { held: false } });
  app.update({ calendars: [] });
  assert.equal(announced, 0);
  assert.equal(app.snapshot().version, 0);
});

test("two slices in one patch are one version", () => {
  const app = store();
  app.update({ announcements: { held: true }, calendars: [inert()] });
  assert.equal(app.snapshot().version, 1);
  assert.equal(app.snapshot().calendars.length, 1);
});

test("a touch re-announces the document without numbering it again", () => {
  const app = store();
  const versions: number[] = [];
  app.subscribe(() => versions.push(app.snapshot().version));
  app.update({ announcements: { held: true } });
  app.touch();
  app.touch();
  assert.deepEqual(versions, [1, 1, 1]);
});

test("a slice is replaced whole rather than merged field by field", () => {
  const app = store();
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.DENIED } });
  assert.deepEqual(app.snapshot().audio, { microphoneStatus: MICROPHONE_STATUS.DENIED });
});

test("listeners are announced in order and an unsubscribed one hears nothing", () => {
  const app = store();
  const heard: string[] = [];
  const first = app.subscribe(() => heard.push("first"));
  app.subscribe(() => heard.push("second"));
  app.update({ announcements: { held: true } });
  first();
  app.update({ announcements: { held: false } });
  assert.deepEqual(heard, ["first", "second", "second"]);
});

test("the version climbs once per applied patch, and a listener's own patch is not lost", () => {
  const app = store();
  for (let index = 0; index < 10; index += 1) {
    app.update({ announcements: { held: index % 2 === 0 } });
  }
  assert.equal(app.snapshot().version, 10);

  const echo = store();
  const seen: number[] = [];
  echo.subscribe(() => {
    seen.push(echo.snapshot().version);
    if (echo.snapshot().calendars.length === 0) echo.update({ calendars: [inert()] });
  });
  echo.update({ announcements: { held: true } });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(echo.snapshot().calendars.length, 1);
});

test("the live session's phase is a slice of the voice document beside the view, and a window going away keeps it", () => {
  const app = new AppStateStore(initialAppState(RUN, false));
  app.update({ voice: { view: IDLE_VOICE_VIEW } });
  app.update({
    voice: { ...app.snapshot().voice, liveSession: { phase: LIVE_SESSION_PHASE.WANTED } },
  });
  assert.deepEqual(app.snapshot().voice.liveSession, { phase: LIVE_SESSION_PHASE.WANTED });
  assert.equal(app.snapshot().voice.view, IDLE_VOICE_VIEW);
  app.update({
    voice: {
      ...app.snapshot().voice,
      liveSession: { sessionId: "sess_1", phase: LIVE_SESSION_PHASE.STARTED },
    },
  });
  assert.deepEqual(app.snapshot().voice.liveSession, {
    sessionId: "sess_1",
    phase: LIVE_SESSION_PHASE.STARTED,
  });
});

test("a voice window that went away leaves the document holding no view", () => {
  const app = store();
  app.update({ voice: { view: { ...IDLE_VOICE_VIEW, talkOpening: true } } });
  app.update({ voice: {} });
  assert.equal(app.snapshot().voice.view, undefined);
});

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessions: [],
  sessionsSettled: false,
  announcementsHeld: false,
  conversationView: { groups: [], settled: true },
  workspaceProjects: [],
  calendars: [],
  calendarOnboardingOwed: false,
  sessionReplay: { permitted: true, accountId: "person" },
  voiceAvailable: true,
  agentTraceEnabled: true,
};

test("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.equal(held.run.agentTraceEnabled, true);
  assert.equal(held.sessions.settled, false);
  assert.deepEqual(held.conversation, { groups: [], settled: true });
  assert.deepEqual(held.sessionReplay, { permitted: true, accountId: "person", halted: false });
});

test("a halt outlives every host read until the host's own event stands it down", () => {
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

test("a run that observes nothing is settled whatever the host answered", () => {
  const quiet = new AppStateStore(
    initialAppState({ ...RUN, runMode: runModeFor({ capture: false, fixture: true }) }, false),
  );
  quiet.update(bootstrapPatch(quiet.snapshot(), BOOT));
  assert.equal(quiet.snapshot().sessions.settled, true);
});

test("recording is what the host permitted less what an account's end stood down", () => {
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
