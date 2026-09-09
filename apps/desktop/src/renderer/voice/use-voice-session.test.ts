import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { REPLY_KIND } from "./captions";
import {
  activeVoiceStream,
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

const EVERY_PART = Object.values(VOICE_READINESS_PART);

test("the readiness report names the epoch the document gave this load, whichever raced first", () => {
  const reported: number[] = [];
  const readiness = new VoiceReadiness((epoch) => reported.push(epoch));
  // Every subscription stood before the document was adopted, as when a
  // version of it lands first: nothing is reported until the epoch lands.
  for (const part of EVERY_PART) readiness.installed(part);
  assert.deepEqual(reported, []);
  readiness.bootstrapped(3);
  assert.deepEqual(reported, [3]);

  // The other order — the document adopted first, subscriptions after —
  // reports once too, under the same epoch, and a later epoch cannot
  // re-report a settled window.
  const late: number[] = [];
  const lateReadiness = new VoiceReadiness((epoch) => late.push(epoch));
  lateReadiness.bootstrapped(3);
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
