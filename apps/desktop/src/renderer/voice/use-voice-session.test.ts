import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "@sidecar/credentials/vocabulary";
import { REALTIME_STATUS, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { CONVERSATION_ENTRY_KIND, normalizeSession, SESSION_STATUS } from "@sidecar/session";
import { APP_SETTING_DEFAULTS } from "@sidecar/settings";
import { type AppSettings, appSettingsView, CLI_CONNECTION } from "@sidecar/settings/wire";
import type { VoiceBootstrap } from "#shared/messages/session";
import { REPLY_KIND } from "./captions";
import {
  activeVoiceStream,
  applyVoiceBootstrap,
  conversationEntryBelongsToConversation,
  liveConversationEntries,
  liveSpeedApplies,
  lukeCaptionsToShow,
  rebaseSpokenTurnMarks,
  spokenAskBelongsToConversation,
  spokenAskPreviewSurvives,
  talkKeyPress,
  talkOpeningHolds,
  typedAskHolds,
  VOICE_READINESS_PART,
  VOICE_RESTART,
  VoiceReadiness,
  voiceRestartAction,
  waitForConversationContext,
} from "./use-voice-session";

test("a delayed transcription cannot repopulate history after Clear", () => {
  assert.equal(spokenAskBelongsToConversation(3, 4), false);
  assert.equal(spokenAskBelongsToConversation(4, 4), true);
  assert.equal(spokenAskBelongsToConversation(undefined, 4), false);
});

test("work that began before Clear cannot repopulate conversation history", () => {
  assert.equal(conversationEntryBelongsToConversation(3, 4), false);
  assert.equal(conversationEntryBelongsToConversation(4, 4), true);
  assert.equal(conversationEntryBelongsToConversation(undefined, 4), false);
});

test("the live lines mirror exactly what their recording paths will keep", () => {
  const lines = liveConversationEntries({
    spokenAskPreviews: new Map([
      ["item-1", "how is the checkout agent"],
      ["item-2", "and the deploy?"],
    ]),
    captions: ["Checkout is", "nearly done."],
    kind: undefined,
  });

  // The asks precede the answer, and the reply's segments join into the one
  // line onReplyEnded will record.
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, words: line.words })),
    [
      { kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "how is the checkout agent" },
      { kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "and the deploy?" },
      { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Checkout is nearly done." },
    ],
  );
  // A line still growing has not happened yet, so none is stamped.
  assert.ok(lines.every((line) => line.recordedAt === undefined));
});

test("a briefing's live line settles as an announcement", () => {
  assert.deepEqual(
    liveConversationEntries({
      spokenAskPreviews: new Map(),
      captions: ["Claude Code finished checkout-service."],
      kind: REPLY_KIND.BRIEFING,
    }),
    [
      {
        kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
        words: "Claude Code finished checkout-service.",
      },
    ],
  );
});

test("a gone call takes its half-transcribed previews with it", () => {
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.IDLE), false);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.FAILED), false);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.UNAVAILABLE), false);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.CONNECTING), true);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.READY), true);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.LISTENING), true);
  assert.equal(spokenAskPreviewSurvives(REALTIME_STATUS.RESPONDING), true);
});

test("restore anchors pending speech behind the restored thread", () => {
  const restoredTail = { kind: "reply", words: "Earlier reply." } as const;
  const unanchored = { after: undefined };
  const anchored = { after: { kind: "reply", words: "Current reply." } as const };

  rebaseSpokenTurnMarks([unanchored, anchored], restoredTail);

  assert.equal(unanchored.after, restoredTail);
  assert.equal(anchored.after.words, "Current reply.");
});

test("the first call waits for durable conversation context", async () => {
  const waiters = new Set<() => void>();
  let settled = false;
  const waiting = waitForConversationContext(false, waiters).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  for (const resolve of waiters) resolve();
  await waiting;
  assert.equal(settled, true);

  const readyWaiters = new Set<() => void>();
  await waitForConversationContext(true, readyWaiters);
  assert.equal(readyWaiters.size, 0);
});

test("the meter listens to the stream of whoever holds the turn", () => {
  assert.equal(
    activeVoiceStream({ status: REALTIME_STATUS.RESPONDING, local: "mic", remote: "luke" }),
    "luke",
  );
  assert.equal(
    activeVoiceStream({ status: REALTIME_STATUS.LISTENING, local: "mic", remote: "luke" }),
    "mic",
  );
  assert.equal(
    activeVoiceStream({ status: REALTIME_STATUS.READY, local: "mic", remote: "luke" }),
    undefined,
  );
});

test("Luke's captions are offered only on his turn, and only with a reason to read them", () => {
  const shown = {
    captionsEnabled: true,
    typedAsk: false,
    outputSilent: false,
    status: REALTIME_STATUS.RESPONDING,
    captions: ["two sessions are waiting on you.", "and the build just finished."],
  };
  assert.deepEqual(lukeCaptionsToShow(shown), [
    "two sessions are waiting on you.",
    "and the build just finished.",
  ]);
  assert.equal(
    lukeCaptionsToShow({ ...shown, status: REALTIME_STATUS.LISTENING }),
    undefined,
    "a caption that raced a status change must not be drawn on the developer's turn",
  );
  assert.equal(
    lukeCaptionsToShow({ ...shown, captionsEnabled: false }),
    undefined,
    "the preference is about speech being duplicated, and with it off there is no reason to read",
  );
});

test("a typed ask, or an output that would swallow the reply, captions whatever the preference says", () => {
  const hidden = {
    captionsEnabled: false,
    typedAsk: false,
    outputSilent: false,
    status: REALTIME_STATUS.RESPONDING,
    captions: ["the words"],
  };
  assert.deepEqual(lukeCaptionsToShow({ ...hidden, typedAsk: true }), ["the words"]);
  assert.deepEqual(lukeCaptionsToShow({ ...hidden, outputSilent: true }), ["the words"]);
});

test("a latched press is the release's to answer, and does not open a second call", () => {
  assert.deepEqual(talkKeyPress({ latched: true, microphoneCall: false }), { openCall: false });
  assert.deepEqual(talkKeyPress({ latched: true, microphoneCall: true }), { openCall: false });
});

test("a press against no microphone call has to open one, and the meter answers the press", () => {
  assert.deepEqual(talkKeyPress({ latched: false, microphoneCall: false }), { openCall: true });
  assert.deepEqual(talkKeyPress({ latched: false, microphoneCall: true }), { openCall: false });
});

test("the press-wait meter rides a handshake and a pending takeover, nothing else", () => {
  assert.equal(talkOpeningHolds({ status: REALTIME_STATUS.CONNECTING, turnPending: false }), true);
  assert.equal(talkOpeningHolds({ status: REALTIME_STATUS.READY, turnPending: true }), true);
  assert.equal(talkOpeningHolds({ status: REALTIME_STATUS.LISTENING, turnPending: false }), false);
  assert.equal(talkOpeningHolds({ status: REALTIME_STATUS.READY, turnPending: false }), false);
  assert.equal(talkOpeningHolds({ status: REALTIME_STATUS.FAILED, turnPending: false }), false);
});

test("a typed ask's caption holds only for the reply it opened", () => {
  assert.equal(typedAskHolds(REALTIME_STATUS.RESPONDING), true);
  assert.equal(typedAskHolds(REALTIME_STATUS.READY), false);
  assert.equal(typedAskHolds(REALTIME_STATUS.LISTENING), false);
});

test("the first stored pace is not a change, and a later one is", () => {
  assert.equal(liveSpeedApplies(undefined, REALTIME_VOICE_SPEED.QUICK), false);
  assert.equal(liveSpeedApplies(REALTIME_VOICE_SPEED.NORMAL, REALTIME_VOICE_SPEED.NORMAL), false);
  assert.equal(liveSpeedApplies(REALTIME_VOICE_SPEED.NORMAL, REALTIME_VOICE_SPEED.QUICK), true);
  assert.equal(liveSpeedApplies(REALTIME_VOICE_SPEED.QUICK, undefined), false);
});

test("a changed voice on a live call waits for the turn to end, then restarts", () => {
  const change = {
    previous: REALTIME_VOICE.CEDAR,
    next: REALTIME_VOICE.MARIN,
    live: true,
    due: false,
    status: REALTIME_STATUS.RESPONDING,
  };
  assert.deepEqual(voiceRestartAction(change), { due: true, action: VOICE_RESTART.WAIT });
  assert.deepEqual(voiceRestartAction({ ...change, status: REALTIME_STATUS.LISTENING }), {
    due: true,
    action: VOICE_RESTART.WAIT,
  });
  assert.deepEqual(voiceRestartAction({ ...change, status: REALTIME_STATUS.READY }), {
    due: false,
    action: VOICE_RESTART.RESTART,
  });
});

test("a call that ended on its own owes the new voice nothing", () => {
  const owed = {
    previous: REALTIME_VOICE.CEDAR,
    next: REALTIME_VOICE.MARIN,
    live: false,
    due: true,
    status: REALTIME_STATUS.IDLE,
  };
  assert.deepEqual(voiceRestartAction(owed), { due: false, action: VOICE_RESTART.DROP });
  assert.deepEqual(voiceRestartAction({ ...owed, status: REALTIME_STATUS.FAILED }), {
    due: false,
    action: VOICE_RESTART.DROP,
  });
  assert.deepEqual(voiceRestartAction({ ...owed, status: REALTIME_STATUS.UNAVAILABLE }), {
    due: false,
    action: VOICE_RESTART.DROP,
  });
});

test("the first snapshot of the voice is stored, not restarted", () => {
  assert.deepEqual(
    voiceRestartAction({
      previous: undefined,
      next: REALTIME_VOICE.CEDAR,
      live: true,
      due: false,
      status: REALTIME_STATUS.READY,
    }),
    { due: false, action: VOICE_RESTART.NONE },
  );
});

test("a voice change with no call up is not owed a restart", () => {
  assert.deepEqual(
    voiceRestartAction({
      previous: REALTIME_VOICE.CEDAR,
      next: REALTIME_VOICE.MARIN,
      live: false,
      due: false,
      status: REALTIME_STATUS.IDLE,
    }),
    { due: false, action: VOICE_RESTART.NONE },
  );
});

test("a connecting call counts as one to reopen: its credential may already be the old voice", () => {
  assert.deepEqual(
    voiceRestartAction({
      previous: REALTIME_VOICE.CEDAR,
      next: REALTIME_VOICE.MARIN,
      live: true,
      due: false,
      status: REALTIME_STATUS.CONNECTING,
    }),
    { due: true, action: VOICE_RESTART.WAIT },
  );
});

const BOOTSTRAP_SETTINGS: AppSettings = {
  stored: { ...APP_SETTING_DEFAULTS, voiceCaptions: true },
  status: {
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
    },
    codexCloudConnection: CLI_CONNECTION.UNKNOWN,
    secretStorage: SECRET_STORAGE.UNKNOWN,
    voiceAvailable: false,
    calendarSignInAvailable: false,
    linearSignInAvailable: false,
    calendarAccounts: [],
    appleCalendarAvailable: false,
  },
};

const VOICE_BOOTSTRAP: VoiceBootstrap = {
  agentTraceEnabled: false,
  microphoneStatus: "granted",
  voiceEpoch: 3,
  voiceHotkey: "Alt+Space",
  outputAudio: { muted: false, volume: 0.5 },
  sessionRoster: { sessions: [] },
  announcementsHeld: true,
  conversationHistory: [],
  settings: BOOTSTRAP_SETTINGS,
};

const NOTHING_PUSHED = {
  settings: undefined,
  sessions: [],
  outputAudio: undefined,
  announcementsHeld: false,
};

const NOTHING_PUSHED_YET = { sessions: false, announcementsHeld: false, microphoneStatus: false };

test("the voice bootstrap fills only what no push has said yet", () => {
  // Nothing pushed: the snapshot is the whole answer, and the first turn may open.
  const fresh = applyVoiceBootstrap(NOTHING_PUSHED, VOICE_BOOTSTRAP, NOTHING_PUSHED_YET);
  assert.equal(fresh.surroundings.settings?.voiceCaptions, true);
  assert.deepEqual(fresh.surroundings.sessions, []);
  assert.deepEqual(fresh.surroundings.outputAudio, { muted: false, volume: 0.5 });
  assert.equal(fresh.surroundings.announcementsHeld, true);
  assert.equal(fresh.surroundings.bootstrapVoiceHotkey, "Alt+Space");
  assert.equal(fresh.surroundings.conversationContextReady, true);
  assert.equal(fresh.microphoneStatus, "granted");

  // Every push that raced past the bootstrap is newer than it and is kept:
  // a settings change, a roster, an output edge, a hold released to
  // `false`, and a permission the developer answered, none of which is a gap
  // for the snapshot to fill.
  const pushedSettings = appSettingsView({
    ...BOOTSTRAP_SETTINGS,
    stored: { ...BOOTSTRAP_SETTINGS.stored, voiceCaptions: false },
  });
  const pushedSession = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "s-1",
      title: "checkout",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1_800_000_000_000,
    },
  );
  const raced = applyVoiceBootstrap(
    {
      settings: pushedSettings,
      sessions: [pushedSession],
      outputAudio: { muted: true, volume: 0 },
      announcementsHeld: false,
    },
    VOICE_BOOTSTRAP,
    { sessions: true, announcementsHeld: true, microphoneStatus: true },
  );
  assert.equal(raced.surroundings.settings, pushedSettings);
  assert.deepEqual(raced.surroundings.sessions, [pushedSession]);
  assert.deepEqual(raced.surroundings.outputAudio, { muted: true, volume: 0 });
  assert.equal(raced.surroundings.announcementsHeld, false);
  assert.equal(raced.microphoneStatus, undefined);
  // The gate and the key's name come from the bootstrap alone; no push carries them.
  assert.equal(raced.surroundings.agentTraceEnabled, false);
  assert.equal(raced.surroundings.bootstrapVoiceHotkey, "Alt+Space");
  assert.equal(raced.surroundings.conversationContextReady, true);
});

test("a roster pushed empty, or a permission pushed back, is not undone by a stale bootstrap", () => {
  // The bootstrap was captured while a session stood; the roster then pushed
  // [] — the last row gone, or a sign-out — before the bootstrap landed. An
  // empty push is an observation, not an absence, so the stale row must not
  // come back; the same for a permission a push has since moved.
  const staleSession = normalizeSession(
    { id: "codex", displayName: "Codex" },
    {
      providerSessionId: "thread-1",
      title: "gone already",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: 1_800_000_000_000,
    },
  );
  const stale: VoiceBootstrap = {
    ...VOICE_BOOTSTRAP,
    sessionRoster: { sessions: [staleSession] },
    microphoneStatus: "not-determined",
  };
  const applied = applyVoiceBootstrap({ ...NOTHING_PUSHED, sessions: [] }, stale, {
    sessions: true,
    announcementsHeld: false,
    microphoneStatus: true,
  });
  assert.deepEqual(applied.surroundings.sessions, []);
  assert.equal(applied.microphoneStatus, undefined);
  // With no roster push at all, the bootstrap's row is the only reading and stands.
  const unpushed = applyVoiceBootstrap(NOTHING_PUSHED, stale, NOTHING_PUSHED_YET);
  assert.deepEqual(unpushed.surroundings.sessions, [staleSession]);
  assert.equal(unpushed.microphoneStatus, "not-determined");
});

const EVERY_PART = Object.values(VOICE_READINESS_PART);

test("the readiness report names the voice bootstrap's epoch however the pushes and subscriptions raced it", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  // Every subscription stood before the narrow bootstrap answered, as when the
  // main process's pushes all beat it: nothing is reported until the epoch lands.
  for (const part of EVERY_PART) readiness.installed(part);
  assert.deepEqual(reported, []);
  readiness.bootstrapped(VOICE_BOOTSTRAP.voiceEpoch);
  assert.deepEqual(reported, [3]);

  // The other order — bootstrap first, subscriptions after — reports once too,
  // under the same epoch, and a later epoch cannot re-report a settled window.
  const late: number[] = [];
  const lateReadiness = new VoiceReadiness((epoch) => late.push(epoch));
  lateReadiness.bootstrapped(VOICE_BOOTSTRAP.voiceEpoch);
  assert.deepEqual(late, []);
  for (const part of EVERY_PART) lateReadiness.installed(part);
  assert.deepEqual(late, [3]);
  lateReadiness.bootstrapped(4);
  assert.deepEqual(late, [3]);
});

test("readiness is reported once, only when every subscription stands and the bootstrap has named the epoch", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  // Subscriptions in whatever order React installs them, the bootstrap last.
  for (const part of EVERY_PART) readiness.installed(part);
  assert.equal(readiness.complete, false);
  assert.deepEqual(reported, []);
  readiness.bootstrapped(7);
  assert.equal(readiness.complete, true);
  assert.deepEqual(reported, [7]);
  // Nothing re-reports: not a repeated install, not a repeated bootstrap.
  readiness.installed(VOICE_READINESS_PART.COMMANDS);
  readiness.bootstrapped(7);
  assert.deepEqual(reported, [7]);
});

test("a bootstrap that lands before the last subscription waits for it", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  readiness.bootstrapped(3);
  for (const part of EVERY_PART.slice(1)) readiness.installed(part);
  assert.equal(reported.length, 0);
  readiness.installed(VOICE_READINESS_PART.COMMANDS);
  assert.deepEqual(reported, [3]);
});

test("a bootstrap naming no epoch — a panel's — never readies a voice receiver", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  for (const part of EVERY_PART) readiness.installed(part);
  readiness.bootstrapped(undefined);
  assert.equal(readiness.complete, false);
  assert.deepEqual(reported, []);
});

test("a subscription torn down after the report is not re-reported when it comes back", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  for (const part of EVERY_PART) readiness.installed(part);
  readiness.bootstrapped(1);
  readiness.uninstalled(VOICE_READINESS_PART.SPEECH_OFFERS);
  assert.equal(readiness.complete, false);
  readiness.installed(VOICE_READINESS_PART.SPEECH_OFFERS);
  assert.deepEqual(reported, [1]);
});
