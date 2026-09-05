import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EXCHANGE_KIND } from "@sidecar/analytics";
import { FIXTURE_SPEAKING_CAPTION } from "@sidecar/fixtures";
import {
  CONVERSATION_ENTRY_KIND,
  REALTIME_STATUS,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
} from "@sidecar/realtime";
import { voiceExchangeActive, voiceExchangeKind } from "#shared/wire/voice-view";
import { REPLY_KIND } from "./realtime-session";
import {
  activeVoiceStream,
  authorizeConversationAct,
  conversationEntryBelongsToConversation,
  conversationHistoryMayPersist,
  liveConversationEntries,
  liveSpeedApplies,
  lukeCaptionsToShow,
  rebaseSpokenTurnMarks,
  spokenAskBelongsToConversation,
  spokenAskPreviewSurvives,
  talkKeyPress,
  talkOpeningHolds,
  typedAskHolds,
  VOICE_RESTART,
  voiceErrorToShow,
  voiceNoticeToShow,
  voiceRestartAction,
  waitForConversationContext,
  waveformVoice,
} from "./use-voice-conversation";
import { WAVEFORM_VOICE } from "./waveform";

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
    transcriptSpoken: false,
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

test("a briefing's live line settles as an announcement, a transcript reading notwithstanding", () => {
  assert.deepEqual(
    liveConversationEntries({
      spokenAskPreviews: new Map(),
      captions: ["Claude Code finished checkout-service."],
      kind: REPLY_KIND.BRIEFING,
      transcriptSpoken: true,
    }),
    [
      {
        kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
        words: "Claude Code finished checkout-service.",
      },
    ],
  );
});

test("a transcript reading's reply previews nothing it may never record", () => {
  // The record keeps the act and not a word of the rendering, so the live
  // line keeps the same silence the settled thread will.
  assert.deepEqual(
    liveConversationEntries({
      spokenAskPreviews: new Map(),
      captions: ["The session said the tests pass."],
      kind: undefined,
      transcriptSpoken: true,
    }),
    [],
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

test("restore anchors pending speech and is the first point history may persist", () => {
  const restoredTail = { kind: "reply", words: "Earlier reply." } as const;
  const unanchored = { after: undefined };
  const anchored = { after: { kind: "reply", words: "Current reply." } as const };

  rebaseSpokenTurnMarks([unanchored, anchored], restoredTail);

  assert.equal(unanchored.after, restoredTail);
  assert.equal(anchored.after.words, "Current reply.");
  assert.equal(conversationHistoryMayPersist(false, false), false);
  assert.equal(conversationHistoryMayPersist(true, true), false);
  assert.equal(conversationHistoryMayPersist(true, false), true);
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

test("an authorization that outlives Clear cannot record its act", async () => {
  let resolveAuthorization: ((value: string) => void) | undefined;
  const authorization = new Promise<string>((resolve) => {
    resolveAuthorization = resolve;
  });
  let activeReplyGeneration: number | undefined = 3;
  const activeReply = {
    get current(): number | undefined {
      return activeReplyGeneration;
    },
  };
  let conversationGeneration = 3;
  const history: string[] = [];
  const pending = authorizeConversationAct(activeReply, () => authorization);

  conversationGeneration = 4;
  activeReplyGeneration = undefined;
  resolveAuthorization?.("accepted");
  const stale = await pending;
  if (conversationEntryBelongsToConversation(stale.generation, conversationGeneration)) {
    history.push("stale act");
  }
  assert.equal(history.length, 0);

  activeReplyGeneration = conversationGeneration;
  const current = await authorizeConversationAct(activeReply, async () => "accepted");
  if (conversationEntryBelongsToConversation(current.generation, conversationGeneration)) {
    history.push("current act");
  }
  assert.deepEqual(history, ["current act"]);
});

test("the meter follows whoever is actually talking", () => {
  assert.equal(waveformVoice(REALTIME_STATUS.RESPONDING), WAVEFORM_VOICE.LUKE);
  assert.equal(waveformVoice(REALTIME_STATUS.LISTENING), WAVEFORM_VOICE.DEVELOPER);
  for (const status of [
    REALTIME_STATUS.IDLE,
    REALTIME_STATUS.CONNECTING,
    REALTIME_STATUS.READY,
    REALTIME_STATUS.FAILED,
    REALTIME_STATUS.UNAVAILABLE,
  ] as const) {
    assert.equal(waveformVoice(status), undefined);
  }
});

test("the analyser listens to the stream of whoever holds the turn", () => {
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

test("the media duck follows the exchange, not a settled call", () => {
  assert.equal(voiceExchangeActive(REALTIME_STATUS.CONNECTING), true);
  assert.equal(voiceExchangeActive(REALTIME_STATUS.LISTENING), true);
  assert.equal(voiceExchangeActive(REALTIME_STATUS.RESPONDING), true);
  assert.equal(voiceExchangeActive(REALTIME_STATUS.READY), false);
  assert.equal(voiceExchangeActive(REALTIME_STATUS.IDLE), false);
});

test("Luke's own speak-only call is never counted as somebody speaking to him", () => {
  assert.equal(
    voiceExchangeKind({ microphoneCall: false, typedAsk: false }),
    PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT,
  );
  assert.equal(
    voiceExchangeKind({ microphoneCall: true, typedAsk: true }),
    PRODUCT_EXCHANGE_KIND.TYPED,
  );
  assert.equal(
    voiceExchangeKind({ microphoneCall: true, typedAsk: false }),
    PRODUCT_EXCHANGE_KIND.SPOKEN,
  );
});

test("a capture run always captions the fixture's words", () => {
  assert.deepEqual(
    lukeCaptionsToShow({
      fixtureSpeaking: true,
      captionsEnabled: false,
      typedAsk: false,
      outputSilent: false,
      voice: WAVEFORM_VOICE.LUKE,
      captions: ["live words"],
    }),
    [FIXTURE_SPEAKING_CAPTION],
  );
});

test("Luke's captions are drawn only on his turn, and only with a reason to read them", () => {
  const shown = {
    fixtureSpeaking: false,
    captionsEnabled: true,
    typedAsk: false,
    outputSilent: false,
    voice: WAVEFORM_VOICE.LUKE,
    captions: ["two sessions are waiting on you.", "and the build just finished."],
  };
  assert.deepEqual(lukeCaptionsToShow(shown), [
    "two sessions are waiting on you.",
    "and the build just finished.",
  ]);
  assert.equal(
    lukeCaptionsToShow({ ...shown, voice: WAVEFORM_VOICE.DEVELOPER }),
    undefined,
    "a caption that raced a status change must not be drawn on the developer's turn",
  );
  assert.equal(
    lukeCaptionsToShow({ ...shown, captionsEnabled: false }),
    undefined,
    "the preference is about speech being duplicated, and with it off there is no reason to read",
  );
});

test("a voice failure is drawn on the strip, but never over a live turn or a fixture", () => {
  const failure = {
    fixtureSpeaking: false,
    voice: undefined,
    error: "The voice service refused the call (status 401).",
  };
  assert.equal(voiceErrorToShow(failure), failure.error);
  assert.equal(voiceErrorToShow({ ...failure, error: undefined }), undefined);
  assert.equal(
    voiceErrorToShow({ ...failure, voice: WAVEFORM_VOICE.LUKE }),
    undefined,
    "words being said are the thing to read over words that already failed",
  );
  assert.equal(
    voiceErrorToShow({ ...failure, voice: WAVEFORM_VOICE.DEVELOPER }),
    undefined,
    "the developer's own turn is not the moment to report an old fault",
  );
  assert.equal(
    voiceErrorToShow({ ...failure, fixtureSpeaking: true }),
    undefined,
    "a fixture has no call to fail, so a capture run never draws one",
  );
});

test("a notice yields to Luke's turn alone, because the developer's draws nothing on the strip", () => {
  const notice = {
    fixtureSpeaking: false,
    voice: undefined,
    notice: "The microphone is open. Finish saying it.",
  };
  assert.equal(voiceNoticeToShow(notice), notice.notice);
  assert.equal(voiceNoticeToShow({ ...notice, notice: undefined }), undefined);
  assert.equal(
    voiceNoticeToShow({ ...notice, voice: WAVEFORM_VOICE.DEVELOPER }),
    notice.notice,
    "the one refusal an open microphone causes is exactly what the strip should answer with",
  );
  assert.equal(
    voiceNoticeToShow({ ...notice, voice: WAVEFORM_VOICE.LUKE }),
    undefined,
    "Luke's words own the box whether or not the captions draw them",
  );
  assert.equal(voiceNoticeToShow({ ...notice, fixtureSpeaking: true }), undefined);
});

test("a typed ask, or an output that would swallow the reply, captions whatever the preference says", () => {
  const hidden = {
    fixtureSpeaking: false,
    captionsEnabled: false,
    typedAsk: false,
    outputSilent: false,
    voice: WAVEFORM_VOICE.LUKE,
    captions: ["the words"],
  };
  assert.deepEqual(lukeCaptionsToShow({ ...hidden, typedAsk: true }), ["the words"]);
  assert.deepEqual(lukeCaptionsToShow({ ...hidden, outputSilent: true }), ["the words"]);
});

test("a latched press is the release's to answer, and does not open a second call", () => {
  assert.deepEqual(talkKeyPress({ latched: true, microphoneCall: false }), {
    deferToRelease: true,
    openCall: false,
  });
  assert.deepEqual(talkKeyPress({ latched: true, microphoneCall: true }), {
    deferToRelease: true,
    openCall: false,
  });
});

test("a press against no microphone call has to open one, and the meter answers the press", () => {
  assert.deepEqual(talkKeyPress({ latched: false, microphoneCall: false }), {
    deferToRelease: false,
    openCall: true,
  });
  assert.deepEqual(talkKeyPress({ latched: false, microphoneCall: true }), {
    deferToRelease: false,
    openCall: false,
  });
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

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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
