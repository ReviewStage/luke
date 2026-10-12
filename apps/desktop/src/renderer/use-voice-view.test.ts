import assert from "node:assert/strict";
import { LIVE_STATUS } from "@sidecar/live";
import { test } from "vitest";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { fixtureVoice, voiceErrorToShow, voiceNoticeToShow } from "./use-voice-view";

const NOBODY = { listening: false, lukeSpeaking: false };
const LUKE = { listening: false, lukeSpeaking: true };
const DEVELOPER = { listening: true, lukeSpeaking: false };

test("a capture run stages its speakers from the launch profile alone", () => {
  assert.deepEqual(fixtureVoice(RUN_PROFILE.SPEAKING), { speakers: LUKE, muted: false });
  assert.deepEqual(fixtureVoice(RUN_PROFILE.MUTED), { speakers: LUKE, muted: true });
  assert.deepEqual(fixtureVoice(RUN_PROFILE.DUPLEX), {
    speakers: { listening: true, lukeSpeaking: true },
    muted: false,
  });
  // The idle run, and a word this build does not know, stage nothing.
  assert.equal(fixtureVoice(RUN_PROFILE.IDLE), undefined);
  assert.equal(fixtureVoice("rehearsal"), undefined);
});

test("a panel that has heard nothing draws an idle voice with neither speaker", () => {
  assert.equal(IDLE_VOICE_VIEW.voiceStatus, LIVE_STATUS.IDLE);
  assert.equal(IDLE_VOICE_VIEW.listening, false);
  assert.equal(IDLE_VOICE_VIEW.lukeSpeaking, false);
  assert.equal(IDLE_VOICE_VIEW.talkOpening, false);
  assert.equal(IDLE_VOICE_VIEW.lukeCaptions, undefined);
});

test("a voice failure is drawn on the strip, but never over a speaker or a fixture", () => {
  const failure = {
    fixtureSpeaking: false,
    speakers: NOBODY,
    error: "The voice service refused the call (status 401).",
  };
  assert.equal(voiceErrorToShow(failure), failure.error);
  assert.equal(voiceErrorToShow({ ...failure, error: undefined }), undefined);
  assert.equal(
    voiceErrorToShow({ ...failure, speakers: LUKE }),
    undefined,
    "words being said are the thing to read over words that already failed",
  );
  assert.equal(
    voiceErrorToShow({ ...failure, speakers: DEVELOPER }),
    undefined,
    "the developer's own turn is not the moment to report an old fault",
  );
  assert.equal(
    voiceErrorToShow({ ...failure, fixtureSpeaking: true }),
    undefined,
    "a fixture has no call to fail, so a capture run never draws one",
  );
});

test("a notice yields to Luke's voice alone, because the developer's draws nothing on the strip", () => {
  const notice = {
    fixtureSpeaking: false,
    speakers: NOBODY,
    notice: "The microphone is open. Finish saying it.",
  };
  assert.equal(voiceNoticeToShow(notice), notice.notice);
  assert.equal(voiceNoticeToShow({ ...notice, notice: undefined }), undefined);
  assert.equal(
    voiceNoticeToShow({ ...notice, speakers: DEVELOPER }),
    notice.notice,
    "the one refusal an open microphone causes is exactly what the strip should answer with",
  );
  assert.equal(
    voiceNoticeToShow({ ...notice, speakers: LUKE }),
    undefined,
    "Luke's words own the box whether or not the captions draw them",
  );
  assert.equal(
    voiceNoticeToShow({ ...notice, speakers: { listening: true, lukeSpeaking: true } }),
    undefined,
  );
  assert.equal(voiceNoticeToShow({ ...notice, fixtureSpeaking: true }), undefined);
});
