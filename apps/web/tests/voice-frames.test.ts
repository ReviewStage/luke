import assert from "node:assert/strict";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { test } from "vitest";
import { LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "../server/live";
import {
  deviceFrameDecision,
  FRAME_DECISION,
  frameType,
  isVoicePath,
  SESSIONS_REPORT_FRAMES,
  upstreamFrameDecision,
} from "../server/voice/frames";
import { frameBytes, frameText } from "../server/voice/socket";

test("the sessions path is the one upgrade path, and nothing else is", () => {
  assert.equal(isVoicePath(VOICE_SERVICE_PATH.SESSIONS), true);
  assert.equal(isVoicePath(`${VOICE_SERVICE_PATH.SESSIONS}/`), false);
  assert.equal(isVoicePath("/api/voice/audio"), false);
  assert.equal(isVoicePath("/"), false);
});

test("a frame's type is read from its JSON record alone", () => {
  assert.equal(frameType(JSON.stringify({ type: LIVE_SERVER_EVENT.INFO })), LIVE_SERVER_EVENT.INFO);
  assert.equal(frameType(JSON.stringify({ type: 4 })), undefined);
  assert.equal(frameType(JSON.stringify([1, 2])), undefined);
  assert.equal(frameType("not json"), undefined);
  assert.equal(frameType(undefined), undefined);
});

test("a binary frame reads as nothing, a text frame as its text, and each counts the bytes it carried", () => {
  assert.equal(frameText({ bytes: Buffer.from("{}") }), undefined);
  assert.equal(frameText({ text: "{}" }), "{}");
  assert.equal(frameBytes({ bytes: new Uint8Array([123, 125]) }), 2);
  assert.equal(frameBytes({ text: "é" }), 2);
});

test("reflected audio is dropped by type toward the device", () => {
  assert.equal(
    upstreamFrameDecision(LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND),
    FRAME_DECISION.DROP_AUDIO,
  );
  assert.equal(
    upstreamFrameDecision(LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA),
    FRAME_DECISION.DROP_AUDIO,
  );
});

test("a signed-in session is shown every frame OpenAI sends, unread ones included", () => {
  assert.equal(upstreamFrameDecision(LIVE_SERVER_EVENT.DELEGATION_CREATED), FRAME_DECISION.FORWARD);
  assert.equal(upstreamFrameDecision(undefined), FRAME_DECISION.FORWARD);
});

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
