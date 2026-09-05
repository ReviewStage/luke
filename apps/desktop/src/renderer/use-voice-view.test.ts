import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS } from "@sidecar/realtime";
import {
  IDLE_VOICE_VIEW,
  voiceErrorToShow,
  voiceNoticeToShow,
  waveformVoice,
} from "./use-voice-view";
import { WAVEFORM_VOICE } from "./waveform";

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

test("a panel that has heard nothing draws an idle voice", () => {
  assert.equal(IDLE_VOICE_VIEW.voiceStatus, REALTIME_STATUS.IDLE);
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
