import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  REALTIME_STATUS,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
  SESSION_TOOL_KIND,
} from "@sidecar/core";
import {
  activeVoiceStream,
  announcerNotices,
  carriedSessionIdentity,
  evaluatorSummaries,
  FIXTURE_SPEAKING_CAPTION,
  latestSpeech,
  latestSpeechReference,
  liveSpeedApplies,
  lukeCaptionToShow,
  talkKeyPress,
  talkOpeningHolds,
  typedAskHolds,
  VOICE_RESTART,
  voiceErrorToShow,
  voiceExchangeActive,
  voiceRestartAction,
  waveformVoice,
} from "../src/renderer/use-voice-conversation";
import { WAVEFORM_VOICE } from "../src/renderer/waveform";

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

test("a capture run always captions the fixture's words", () => {
  assert.equal(
    lukeCaptionToShow({
      fixtureSpeaking: true,
      captionsEnabled: false,
      typedAsk: false,
      outputSilent: false,
      voice: WAVEFORM_VOICE.LUKE,
      caption: "live words",
    }),
    FIXTURE_SPEAKING_CAPTION,
  );
});

test("Luke's caption is drawn only on his turn, and only with a reason to read it", () => {
  const shown = {
    fixtureSpeaking: false,
    captionsEnabled: true,
    typedAsk: false,
    outputSilent: false,
    voice: WAVEFORM_VOICE.LUKE,
    caption: "two sessions are waiting on you.",
  };
  assert.equal(lukeCaptionToShow(shown), "two sessions are waiting on you.");
  assert.equal(
    lukeCaptionToShow({ ...shown, voice: WAVEFORM_VOICE.DEVELOPER }),
    undefined,
    "a caption that raced a status change must not be drawn on the developer's turn",
  );
  assert.equal(
    lukeCaptionToShow({ ...shown, captionsEnabled: false }),
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

test("a typed ask, or an output that would swallow the reply, captions whatever the preference says", () => {
  const hidden = {
    fixtureSpeaking: false,
    captionsEnabled: false,
    typedAsk: false,
    outputSilent: false,
    voice: WAVEFORM_VOICE.LUKE,
    caption: "the words",
  };
  assert.equal(lukeCaptionToShow({ ...hidden, typedAsk: true }), "the words");
  assert.equal(lukeCaptionToShow({ ...hidden, outputSilent: true }), "the words");
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

function speech(source: AttentionSpeech["source"], id: string): AttentionSpeech {
  return {
    providerId: "claude-code",
    providerSessionId: id,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source,
    summary: `${id} finished.`,
    decidedAt: 1_000,
  };
}

test("edges and answered asks go to the announcer; unbidden summaries keep to an open call", () => {
  const edge = speech(ATTENTION_SPEECH_SOURCE.STATUS_EDGE, "checkout");
  const answered = speech(ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST, "schema");
  const summary = speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "payments");
  const mixed = [edge, answered, summary];
  assert.deepEqual(announcerNotices(mixed), [edge, answered]);
  assert.deepEqual(evaluatorSummaries(mixed), [summary]);
});

test("the newest mention is what a bare 'that chat' points back at", () => {
  // Every source counts — the evaluator's readout here is as much a mention as
  // the edges around it — and the newest by decision wins, whatever order the
  // batch arrived in.
  const older = { ...speech(ATTENTION_SPEECH_SOURCE.STATUS_EDGE, "checkout"), decidedAt: 1_000 };
  const newest = { ...speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "payments"), decidedAt: 3_000 };
  const newer = { ...speech(ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST, "schema"), decidedAt: 2_000 };

  assert.deepEqual(latestSpeechReference([older, newest, newer]), {
    providerId: "claude-code",
    providerSessionId: "payments",
  });
  // An empty batch moves the reference not at all.
  assert.equal(latestSpeechReference([]), undefined);
});

test("the newest announcement's words are what 'what did you just say?' points back at", () => {
  // The same pick the reference makes, carrying the whole speech: the
  // reference answers which session, this answers what was said, and the two
  // must never come from different items of one batch.
  const older = { ...speech(ATTENTION_SPEECH_SOURCE.STATUS_EDGE, "checkout"), decidedAt: 1_000 };
  const newest = { ...speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "payments"), decidedAt: 3_000 };
  const newer = { ...speech(ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST, "schema"), decidedAt: 2_000 };

  assert.equal(latestSpeech([older, newest, newer]), newest);
  // An empty batch keeps whatever announcement already stands.
  assert.equal(latestSpeech([]), undefined);
});

test("a carried act aims the reference at its session; a creation aims at none", () => {
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };

  assert.deepEqual(carriedSessionIdentity({ kind: SESSION_TOOL_KIND.OPEN, identity }), identity);
  assert.deepEqual(
    carriedSessionIdentity({ kind: SESSION_TOOL_KIND.MESSAGE, identity, text: "carry on" }),
    identity,
  );
  assert.equal(
    carriedSessionIdentity({
      kind: SESSION_TOOL_KIND.CREATE_WORKSPACE,
      providerId: "conductor",
      providerProjectId: "project-1",
    }),
    undefined,
  );
});
