import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EXCHANGE_KIND } from "@sidecar/analytics";
import { FIXTURE_SPEAKING_CAPTION } from "@sidecar/fixtures";
import { ISSUE_TRACKER_ID, normalizeTrackedIssue, type TrackedIssue } from "@sidecar/issues";
import {
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  REALTIME_STATUS,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
} from "@sidecar/realtime";
import {
  ATTENTION_DISPOSITION,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_MENTION_KIND,
  SESSION_STATUS,
  type Session,
} from "@sidecar/session";
import {
  activeVoiceStream,
  announcerNotices,
  authorizeConversationAct,
  conversationEntryBelongsToConversation,
  liveSpeedApplies,
  lukeCaptionsToShow,
  replyIssueMentions,
  replyMentions,
  speechByDecision,
  spokenAskBelongsToConversation,
  talkKeyPress,
  talkOpeningHolds,
  typedAskHolds,
  VOICE_RESTART,
  voiceErrorToShow,
  voiceExchangeActive,
  voiceExchangeKind,
  voiceNoticeToShow,
  voiceRestartAction,
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

test("every approved attention update can open the announcer", () => {
  const status = speech(ATTENTION_SPEECH_SOURCE.STATUS_EDGE, "schema");
  const summary = speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "payments");
  const mixed = [status, summary];
  assert.deepEqual(announcerNotices(mixed), mixed);
});

test("a batch enters the history in the order it was decided", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Every source counts, and the decision order holds whatever
  // order the batch arrived in, so the history reads the way things happened.
  const older = { ...speech(ATTENTION_SPEECH_SOURCE.STATUS_EDGE, "checkout"), decidedAt: 1_000 };
  const newest = { ...speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "payments"), decidedAt: 3_000 };
  const newer = { ...speech(ATTENTION_SPEECH_SOURCE.EVALUATOR, "schema"), decidedAt: 2_000 };

  assert.deepEqual(speechByDecision([newest, older, newer]), [older, newer, newest]);
  assert.deepEqual(speechByDecision([]), []);
});

function rosterSession(
  providerSessionId: string,
  title: string,
  workspace?: { providerWorkspaceId: string; name?: string },
): Session {
  const session: ProviderSessionObservation = {
    providerSessionId,
    title,
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
    detail: {},
  };
  if (workspace) {
    session.workspace = workspace;
  }
  return normalizeSession({ id: "conductor", displayName: "Conductor" }, session);
}

test("an announcement's one validated subject is the whole answer", () => {
  const roster = [rosterSession("a", "Checkout service"), rosterSession("b", "Payments schema")];
  assert.deepEqual(
    replyMentions({
      fixtureSpeaking: false,
      about: { providerId: "conductor", providerSessionId: "b" },
      // The sentence brushes past another roster title; the update was still
      // about one session, and the chip must say so.
      captions: ["Payments schema finished, right after Checkout service did."],
      sessions: roster,
    }),
    [
      {
        kind: SESSION_MENTION_KIND.SESSION,
        providerId: "conductor",
        providerSessionId: "b",
      },
    ],
  );
});

test("a conversation reply's previews are what its words name off the roster", () => {
  const roster = [
    rosterSession("a", "Checkout service"),
    rosterSession("b", "Payments schema"),
    rosterSession("c", "amber-shoal", { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" }),
  ];
  // Back-to-back replies stack their captions, and every caption still on
  // screen feeds the chips: the first names one session, the second another.
  assert.deepEqual(
    replyMentions({
      fixtureSpeaking: false,
      about: undefined,
      captions: ["Payments schema is migrating.", "And lisbon-v2 is waiting on you."],
      sessions: roster,
    }),
    [
      { kind: SESSION_MENTION_KIND.SESSION, providerId: "conductor", providerSessionId: "b" },
      { kind: SESSION_MENTION_KIND.WORKSPACE, providerId: "conductor", providerSessionId: "c" },
    ],
  );
  assert.deepEqual(
    replyMentions({
      fixtureSpeaking: false,
      about: undefined,
      captions: undefined,
      sessions: roster,
    }),
    [],
  );
});

test("a capture run's chips are earned by the fixture's own words", () => {
  // The fixture sentence names this title and this workspace on purpose: the
  // chips they earn are what the speaking evidence photographs.
  const roster = [
    rosterSession("fixture", "Bootstrap the desktop shell"),
    rosterSession("chat", "gentle-cove", { providerWorkspaceId: "ws-lisbon", name: "lisbon-v2" }),
  ];
  assert.deepEqual(
    replyMentions({
      fixtureSpeaking: true,
      about: undefined,
      captions: undefined,
      sessions: roster,
    }),
    [
      {
        kind: SESSION_MENTION_KIND.SESSION,
        providerId: "conductor",
        providerSessionId: "fixture",
      },
      {
        kind: SESSION_MENTION_KIND.WORKSPACE,
        providerId: "conductor",
        providerSessionId: "chat",
      },
    ],
  );
});

function trackedIssue(identifier: string, title: string): TrackedIssue {
  const issue = normalizeTrackedIssue(
    { id: ISSUE_TRACKER_ID.LINEAR, displayName: "Linear" },
    {
      trackerIssueId: `issue-uuid-${identifier}`,
      identifier,
      title,
      stateName: "Todo",
      observedAt: 1_800_000_000_000,
    },
  );
  assert.ok(issue);
  return issue;
}

test("a conversation reply's issue previews are what its words name off the tracker", () => {
  const board = [trackedIssue("LUKE-1", "Fix login"), trackedIssue("LUKE-2", "Ship captions")];
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Back-to-back replies stack their captions, exactly as the session
  // mentions read them: everything still on screen feeds the chips.
  assert.deepEqual(
    replyIssueMentions({
      fixtureSpeaking: false,
      about: undefined,
      captions: ["LUKE-2 is nearly done.", "And Fix login is still waiting."],
      issues: board,
    }),
    [board[1], board[0]],
  );
  assert.deepEqual(
    replyIssueMentions({
      fixtureSpeaking: false,
      about: undefined,
      captions: undefined,
      issues: board,
    }),
    [],
  );
});

test("an announcement's session subject leaves issue identifiers unclaimed", () => {
  const board = [trackedIssue("LUKE-1", "Fix login")];
  assert.deepEqual(
    replyIssueMentions({
      fixtureSpeaking: false,
      about: { providerId: "conductor", providerSessionId: "b" },
      captions: ["Checkout service finished LUKE-1."],
      issues: board,
    }),
    [],
  );
});

test("a capture run observes no tracker, so its fixture words draw no issue chips", () => {
  assert.deepEqual(
    replyIssueMentions({
      fixtureSpeaking: true,
      about: undefined,
      captions: undefined,
      issues: undefined,
    }),
    [],
  );
});
