import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_ASK_REFUSAL,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmissionRejection,
} from "@sidecar/brain/requests";
import type { BrainAskSubmissionResult } from "@sidecar/brain/requests-wire";
import { LIVE_STATUS } from "@sidecar/live";
import { NoticeStrip, VOICE_ERROR_NOTICE_MS } from "@sidecar/voice/orchestrator";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import {
  ASK_UNSENT_REASON,
  askDraftReason,
  CLEAR_FAILED_REASON,
  panelVoiceView,
  submitTypedAsk,
  voiceActiveFor,
  voiceErrorToShow,
  voiceNoticeToShow,
  waveformVoice,
} from "./use-voice-view";
import { VOICE_ACTIVITY_HANGOVER_MS } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE } from "./waveform";

test("the meter follows whoever is actually talking", () => {
  assert.equal(waveformVoice(LIVE_STATUS.SPEAKING), WAVEFORM_VOICE.LUKE);
  assert.equal(waveformVoice(LIVE_STATUS.LISTENING), WAVEFORM_VOICE.DEVELOPER);
  for (const status of [
    LIVE_STATUS.IDLE,
    LIVE_STATUS.CONNECTING,
    LIVE_STATUS.MUTED,
    LIVE_STATUS.CLOSING,
    LIVE_STATUS.FAILED,
    LIVE_STATUS.UNAVAILABLE,
  ] as const) {
    assert.equal(waveformVoice(status), undefined);
  }
});

test("a panel that has heard nothing draws an idle voice", () => {
  assert.equal(IDLE_VOICE_VIEW.voiceStatus, LIVE_STATUS.IDLE);
  assert.equal(IDLE_VOICE_VIEW.talkOpening, false);
  assert.equal(IDLE_VOICE_VIEW.lukeCaptions, undefined);
  assert.deepEqual(IDLE_VOICE_VIEW.liveConversationEntries, []);
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

test("a refused or unanswered typed ask keeps its draft; an accepted one clears it", () => {
  // The composer clears the field only on a falsy answer, so an accepted ask
  // must answer nothing and every other outcome must answer a reason.
  assert.equal(askDraftReason({ outcome: "accepted", runId: "run-1", acceptedAt: 1 }), undefined);
  assert.equal(askDraftReason({ outcome: "rejected", reason: "absent" }), BRAIN_ASK_REFUSAL.absent);
  assert.equal(
    askDraftReason(undefined),
    ASK_UNSENT_REASON,
    "an ask nobody answered is the developer's words to retry, not to lose",
  );
});

/**
 * A strip whose clock is held by the test: what it was asked to draw, and
 * when each line would have left on its own.
 */
function panelStrip() {
  const expiries: { at: number; fire: () => void }[] = [];
  const strip = new NoticeStrip({
    onChanged: () => undefined,
    schedule: (fire, at) => {
      expiries.push({ at, fire });
      return expiries.length;
    },
    cancel: () => undefined,
  });
  const handed = () =>
    panelVoiceView(IDLE_VOICE_VIEW, { error: strip.error, notice: strip.notice });
  return { strip, expiries, handed };
}

function rejected(reason: BrainSubmissionRejection): BrainAskSubmissionResult {
  return { outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED, reason };
}

test("a refused typed ask lands its reason on the strip the panel is handed, as a notice and never a caption", async () => {
  for (const rejection of Object.values(BRAIN_SUBMISSION_REJECTION)) {
    const { strip, handed } = panelStrip();
    const reason = await submitTypedAsk({ strip, submit: async () => rejected(rejection) });
    assert.equal(reason, BRAIN_ASK_REFUSAL[rejection]);
    const view = handed();
    assert.equal(
      view.voiceNotice,
      BRAIN_ASK_REFUSAL[rejection],
      `${rejection}: the sentence is drawn where the reply would have landed`,
    );
    assert.equal(view.voiceError, undefined, "a refusal is the notice tone, not a fault");
    assert.equal(
      view.lukeCaptions,
      undefined,
      "nothing was said, so nothing is captioned: the captions preference does not decide a refusal",
    );
  }
});

test("an ask nobody answered is reported on the strip too, and leaves on the failure's own clock", async () => {
  const { strip, expiries, handed } = panelStrip();
  assert.equal(
    await submitTypedAsk({
      strip,
      submit: () => Promise.reject(new Error("the bridge is gone")),
    }),
    ASK_UNSENT_REASON,
  );
  assert.equal(handed().voiceNotice, ASK_UNSENT_REASON);
  assert.equal(expiries.at(-1)?.at, VOICE_ERROR_NOTICE_MS);
  expiries.at(-1)?.fire();
  assert.equal(handed().voiceNotice, undefined, "the strip takes no pointer, so time dismisses it");
});

test("an accepted ask clears the refusal the strip was still reading and answers the composer nothing", async () => {
  const { strip, handed } = panelStrip();
  await submitTypedAsk({ strip, submit: async () => rejected(BRAIN_SUBMISSION_REJECTION.ABSENT) });
  assert.equal(handed().voiceNotice, BRAIN_ASK_REFUSAL.absent);
  const reason = await submitTypedAsk({
    strip,
    submit: async () => ({
      outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED,
      runId: "run-1",
      acceptedAt: 1,
    }),
  });
  assert.equal(reason, undefined);
  assert.equal(handed().voiceNotice, undefined, "a sent ask outdates the refusal before it");
});

test("the panel's own strip lines stand over the voice window's while they last, and otherwise the report is handed on whole", () => {
  const reported = {
    ...IDLE_VOICE_VIEW,
    voiceError: "The voice service refused the call (status 401).",
    voiceNotice: "Listening on the built-in microphone.",
  };
  assert.equal(
    panelVoiceView(reported, { error: undefined, notice: undefined }),
    reported,
    "nothing of the panel's own leaves the report untouched",
  );
  const both = panelVoiceView(reported, {
    error: CLEAR_FAILED_REASON,
    notice: BRAIN_ASK_REFUSAL.full,
  });
  assert.equal(both.voiceError, CLEAR_FAILED_REASON);
  assert.equal(both.voiceNotice, BRAIN_ASK_REFUSAL.full);
  assert.equal(both.voiceStatus, reported.voiceStatus);
  const noticeOnly = panelVoiceView(reported, {
    error: undefined,
    notice: BRAIN_ASK_REFUSAL.conflict,
  });
  assert.equal(noticeOnly.voiceError, reported.voiceError, "a refusal displaces no fault");
  assert.equal(noticeOnly.voiceNotice, BRAIN_ASK_REFUSAL.conflict);
});

test("a quiet level lets the hangover run out from the last loud one, never past it", () => {
  const loud = voiceActiveFor({ level: 0.8, now: 1_000, lastLoudAt: undefined });
  assert.equal(loud.lastLoudAt, 1_000);
  assert.equal(loud.remainingMs, VOICE_ACTIVITY_HANGOVER_MS);
  // A quiet report mid-hangover keeps the clock the loud one started.
  const quiet = voiceActiveFor({ level: 0.01, now: 1_100, lastLoudAt: 1_000 });
  assert.equal(quiet.lastLoudAt, 1_000);
  assert.equal(quiet.remainingMs, VOICE_ACTIVITY_HANGOVER_MS - 100);
  // A quiet report past it ends the voice at once.
  const late = voiceActiveFor({
    level: 0.01,
    now: 1_000 + VOICE_ACTIVITY_HANGOVER_MS,
    lastLoudAt: 1_000,
  });
  assert.equal(late.remainingMs, 0);
  // Silence with no loud frame ever is not a voice.
  assert.equal(voiceActiveFor({ level: 0, now: 5, lastLoudAt: undefined }).remainingMs, 0);
});
