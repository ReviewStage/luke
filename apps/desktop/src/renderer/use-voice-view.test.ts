import assert from "node:assert/strict";
import { BRAIN_ASK_REFUSAL } from "@sidecar/brain/requests";
import { LIVE_STATUS } from "@sidecar/live";
import { test } from "vitest";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import {
  CLEAR_FAILED_REASON,
  drawnLevel,
  panelVoiceView,
  voiceActiveFor,
  voiceErrorToShow,
  voiceNoticeToShow,
  waveformVoice,
} from "./use-voice-view";
import { VOICE_ACTIVITY_HANGOVER_MS } from "./voice/voice-level-meter";
import { WAVEFORM_VOICE } from "./waveform";

test("the one meter follows whoever is actually talking, and Luke wins the place from both", () => {
  assert.equal(waveformVoice({ listening: false, lukeSpeaking: true }), WAVEFORM_VOICE.LUKE);
  assert.equal(waveformVoice({ listening: true, lukeSpeaking: false }), WAVEFORM_VOICE.DEVELOPER);
  assert.equal(waveformVoice({ listening: true, lukeSpeaking: true }), WAVEFORM_VOICE.LUKE);
  assert.equal(waveformVoice({ listening: false, lukeSpeaking: false }), undefined);
});

test("the level drawn is the drawn voice's own reading", () => {
  const levels = { developer: 0.4, luke: 0.9 };
  assert.equal(drawnLevel(WAVEFORM_VOICE.LUKE, levels), levels.luke);
  assert.equal(drawnLevel(WAVEFORM_VOICE.DEVELOPER, levels), levels.developer);
  assert.equal(drawnLevel(undefined, levels), 0);
});

test("a panel that has heard nothing draws an idle voice with neither speaker", () => {
  assert.equal(IDLE_VOICE_VIEW.voiceStatus, LIVE_STATUS.IDLE);
  assert.equal(IDLE_VOICE_VIEW.listening, false);
  assert.equal(IDLE_VOICE_VIEW.lukeSpeaking, false);
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
