import assert from "node:assert/strict";
import { VOICE_SERVICE_FRAME } from "@luke/features";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "@luke/live";
import { test } from "vitest";
import { deviceFrameDecision, FRAME_DECISION, SESSIONS_REPORT_FRAMES } from "./frames.js";

test("a signed-in device forwards nothing, is read for its hang-up, its idle report, and its stop, and is refused on anything else", () => {
  assert.deepEqual(SESSIONS_REPORT_FRAMES, [
    VOICE_SERVICE_FRAME.SESSION_ACTIVITY,
    VOICE_SERVICE_FRAME.SESSION_STOP,
  ]);
  // The close is the service's to send: the Mac's hang-up and an older build's own close are both an ask for it.
  for (const type of [VOICE_SERVICE_FRAME.SESSION_HANG_UP, LIVE_CLIENT_EVENT.CLOSE]) {
    assert.equal(deviceFrameDecision(type), FRAME_DECISION.HANG_UP);
  }
  for (const type of SESSIONS_REPORT_FRAMES) {
    assert.equal(deviceFrameDecision(type), FRAME_DECISION.REPORT);
  }
  assert.equal(deviceFrameDecision(VOICE_SERVICE_FRAME.SESSION_ACTIVITY), FRAME_DECISION.REPORT);
  // The avatar asks are the service's to answer, never OpenAI's to hear.
  for (const type of [VOICE_SERVICE_FRAME.AVATAR_START, VOICE_SERVICE_FRAME.AVATAR_STOP]) {
    assert.equal(deviceFrameDecision(type), FRAME_DECISION.AVATAR);
  }
  // The service's own answers are never the device's to send.
  for (const type of [VOICE_SERVICE_FRAME.AVATAR_STARTED, VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE]) {
    assert.equal(deviceFrameDecision(type), FRAME_DECISION.REFUSE);
  }
  // The exchange's own appends from an older build, the microphone switch
  // that never crosses this socket, the device's own audio, a handshake frame
  // after the handshake, and a frame whose type cannot be read: each closes
  // the socket.
  for (const type of [
    LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND,
    LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    LIVE_CLIENT_EVENT.THINKING_APPEND,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    VOICE_SERVICE_FRAME.SESSION_CREATE,
    VOICE_SERVICE_FRAME.SESSION_ATTACH,
    undefined,
  ]) {
    assert.equal(deviceFrameDecision(type), FRAME_DECISION.REFUSE);
  }
});
