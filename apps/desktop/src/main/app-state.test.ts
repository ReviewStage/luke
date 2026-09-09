import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { runModeFor } from "@sidecar/host";
import { channels } from "#shared/bridge";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import {
  type AppState,
  type AppStateChange,
  AppStateStore,
  bootstrapPatch,
  initialAppState,
  sessionReplayBootstrap,
} from "./app-state";
import { fanOutAppState } from "./app-state-channels";
import type { HostBootstrap } from "./gateway/host-operator";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of main now leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and a channel
 * travels exactly when what it carries moved.
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
 * A payload the document only ever carries whole. Neither the store nor the
 * fan-out reads inside one — they compare and hand on — so what stands in for
 * a settings snapshot, a roster entry, or a run record is an empty record,
 * and the one assertion that says so is here rather than at each of them.
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

test("one slice patched names that slice alone and bumps the version once", () => {
  const app = store();
  const change = app.update({ announcements: { held: true } });
  assert.ok(change);
  assert.deepEqual([...change.changed], ["announcements"]);
  assert.equal(change.state.version, 1);
  assert.equal(change.previous.version, 0);
  assert.equal(app.snapshot().announcements.held, true);
});

test("a patch that says nothing new is no patch at all", () => {
  const app = store();
  assert.equal(app.update({}), undefined);
  assert.equal(app.update({ announcements: { held: false } }), undefined);
  assert.equal(app.update({ calendars: [] }), undefined);
  assert.equal(app.snapshot().version, 0);
});

test("two slices in one patch are one version", () => {
  const app = store();
  const change = app.update({ announcements: { held: true }, calendars: [inert()] });
  assert.ok(change);
  assert.equal(change.changed.size, 2);
  assert.equal(app.snapshot().version, 1);
});

test("a slice is replaced whole rather than merged field by field", () => {
  const app = store();
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED, outputAudio: undefined } });
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
    app.update({ voice: { level: (index + 1) / 10 } });
  }
  assert.equal(app.snapshot().version, 10);

  const echo = store();
  const seen: number[] = [];
  echo.subscribe((change) => {
    seen.push(change.state.version);
    if (change.changed.has("announcements")) echo.update({ calendars: [inert()] });
  });
  echo.update({ announcements: { held: true } });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(echo.snapshot().calendars.length, 1);
});

test("the reporter rides the change rather than the document", () => {
  const app = store();
  const change = app.update({ settings: SETTINGS }, { reporter: "window-1" });
  assert.equal(change?.reporter, "window-1");
  assert.equal(Object.hasOwn(app.snapshot(), "reporter"), false);
});

/** Every channel a fan-out produced, in the order it produced them. */
function fannedOut(change: AppStateChange): { channel: string; except?: string }[] {
  const sent: { channel: string; except?: string }[] = [];
  fanOutAppState(change, (channel, _payload, exceptReporter) => {
    if (exceptReporter === undefined) sent.push({ channel });
    else sent.push({ channel, except: exceptReporter });
  });
  return sent;
}

test("a slice two channels read wakes only the channel that moved", () => {
  const app = store();
  const change = app.update({
    sessions: { ...app.snapshot().sessions, workspaceProjects: [inert()] },
  });
  assert.ok(change);
  assert.deepEqual(fannedOut(change), [{ channel: channels.onWorkspaceProjectsChanged }]);
});

test("each host slice reaches the channel the renderer already listens on", () => {
  const cases: { patch: Parameters<AppStateStore["update"]>[0]; channel: string }[] = [
    { patch: { settings: SETTINGS }, channel: channels.onSettingsChanged },
    {
      patch: { account: inert() },
      channel: channels.onAccountChanged,
    },
    {
      patch: {
        sessions: { roster: { sessions: [inert()] }, settled: true, workspaceProjects: [] },
      },
      channel: channels.onSessionsChanged,
    },
    { patch: { calendars: [inert()] }, channel: channels.onCalendarsChanged },
    { patch: { announcements: { held: true } }, channel: channels.onAnnouncementsHeldChanged },
    {
      patch: { superset: { installed: true, connected: true, signIn: inert() } },
      channel: channels.onSupersetSignInChanged,
    },
    {
      patch: { onboarding: { calendarOwed: true } },
      channel: channels.onCalendarOnboardingChanged,
    },
    { patch: { brain: { runs: [inert()] } }, channel: channels.onBrainRequestsChanged },
    {
      patch: { conversation: { entries: [inert()], cleared: false } },
      channel: channels.onConversationHistoryChanged,
    },
    {
      patch: { update: { ...store().snapshot().update, currentVersion: "9.9.9" } },
      channel: channels.onUpdateChanged,
    },
    {
      patch: { audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } },
      channel: channels.onMicrophoneStatusChanged,
    },
    {
      patch: { voice: { level: 0, view: { ...IDLE_VOICE_VIEW, talkOpening: true } } },
      channel: channels.onVoiceViewChanged,
    },
    { patch: { voice: { level: 0.5 } }, channel: channels.onVoiceLevelChanged },
    {
      patch: { hotkeys: { talk: "Alt+L", talkHeld: true } },
      channel: channels.onVoiceHotkeyChanged,
    },
    { patch: { hotkeys: { talkHeld: true, ask: "Alt+K" } }, channel: channels.onAskHotkeyChanged },
    {
      patch: { hotkeys: { talkHeld: true, stop: "Escape" } },
      channel: channels.onStopHotkeyChanged,
    },
    {
      patch: { sessionReplay: { permitted: true, halted: true } },
      channel: channels.onSessionReplayChanged,
    },
  ];
  for (const { patch, channel } of cases) {
    const change = store().update(patch);
    assert.ok(change, `${channel} was never patched`);
    assert.deepEqual(fannedOut(change), [{ channel }]);
  }
});

test("a first roster reading travels even when it draws what the bootstrap did", () => {
  const app = store();
  const settling = app.update({
    sessions: { ...app.snapshot().sessions, settled: true },
  });
  assert.ok(settling);
  assert.deepEqual(fannedOut(settling), [{ channel: channels.onSessionsChanged }]);
  // Settled already, and the same roster: nothing a window has not drawn.
  assert.equal(app.update({ sessions: { ...app.snapshot().sessions } }), undefined);
});

test("a settings write is not echoed to the window that reported it", () => {
  const app = store();
  const change = app.update({ settings: SETTINGS }, { reporter: "window-1" });
  assert.ok(change);
  assert.deepEqual(fannedOut(change), [
    { channel: channels.onSettingsChanged, except: "window-1" },
  ]);
});

test("an absent value travels only where its absence is the news", () => {
  const app = store();
  app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED, outputAudio: inert() } });
  app.update({ hotkeys: { talkHeld: true, ask: "Alt+K" } });
  const gone = app.update({
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    hotkeys: { talkHeld: true },
  });
  assert.ok(gone);
  assert.deepEqual(fannedOut(gone), [
    { channel: channels.onOutputAudioChanged },
    { channel: channels.onAskHotkeyChanged },
  ]);

  // The host has answered no settings yet, so the gap reaches no window.
  const nothing = store().update({ announcements: { held: true } });
  assert.ok(nothing);
  assert.deepEqual(
    fannedOut(nothing).map((sent) => sent.channel),
    [channels.onAnnouncementsHeldChanged],
  );
});

test("a voice window that went away leaves every panel an idle voice", () => {
  const app = store();
  app.update({ voice: { level: 0.5, view: { ...IDLE_VOICE_VIEW, talkOpening: true } } });
  const gone = app.update({ voice: { level: 0 } });
  assert.ok(gone);
  const sent: unknown[] = [];
  fanOutAppState(gone, (channel, payload) => {
    if (channel === channels.onVoiceViewChanged) sent.push(payload);
  });
  assert.deepEqual(sent, [IDLE_VOICE_VIEW]);
});

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessions: [],
  sessionsSettled: false,
  announcementsHeld: false,
  conversationHistory: [],
  workspaceProjects: [],
  calendars: [],
  calendarOnboardingOwed: false,
  supersetInstalled: true,
  supersetConnected: false,
  sessionReplay: { permitted: true, accountId: "person" },
  receiverEpoch: 7,
  voiceAvailable: true,
  agentTraceEnabled: true,
};

test("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.equal(held.run.agentTraceEnabled, true);
  assert.equal(held.superset.installed, true);
  assert.equal(held.voice.epoch, 7);
  assert.equal(held.sessions.settled, false);
  assert.equal(held.conversation.cleared, true);
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
