import assert from "node:assert/strict";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { test } from "vitest";
import {
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "../server/live";
import {
  desktopFrameDecision,
  FRAME_DECISION,
  frameType,
  routeForPath,
  SESSIONS_CLIENT_EVENTS,
  SESSIONS_REPORT_FRAMES,
  upstreamFrameDecision,
  VOICE_ROUTE,
} from "../server/voice/frames";
import { frameBytes, frameText } from "../server/voice/socket";

test("the two upgrade paths map to the two routes and nothing else does", () => {
  assert.equal(routeForPath(VOICE_SERVICE_PATH.SESSIONS), VOICE_ROUTE.SESSIONS);
  assert.equal(routeForPath(VOICE_SERVICE_PATH.INTRODUCTION), VOICE_ROUTE.INTRODUCTION);
  assert.equal(routeForPath(`${VOICE_SERVICE_PATH.SESSIONS}/`), undefined);
  assert.equal(routeForPath("/"), undefined);
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

test("reflected audio is dropped by type toward the desktop on both routes", () => {
  for (const route of Object.values(VOICE_ROUTE)) {
    assert.equal(
      upstreamFrameDecision(LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, route),
      FRAME_DECISION.DROP_AUDIO,
    );
    assert.equal(
      upstreamFrameDecision(LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, route),
      FRAME_DECISION.DROP_AUDIO,
    );
  }
});

test("a signed-in session is shown every frame OpenAI sends, unread ones included", () => {
  assert.equal(
    upstreamFrameDecision(LIVE_SERVER_EVENT.DELEGATION_CREATED, VOICE_ROUTE.SESSIONS),
    FRAME_DECISION.FORWARD,
  );
  assert.equal(upstreamFrameDecision(undefined, VOICE_ROUTE.SESSIONS), FRAME_DECISION.FORWARD);
});

test("a signed-in desktop may send the stop and the hang-up, is read for its idle report, and is refused on anything else", () => {
  assert.deepEqual(SESSIONS_CLIENT_EVENTS, [
    LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
    LIVE_CLIENT_EVENT.CLOSE,
  ]);
  assert.deepEqual(SESSIONS_REPORT_FRAMES, [VOICE_SERVICE_FRAME.SESSION_ACTIVITY]);
  for (const type of SESSIONS_CLIENT_EVENTS) {
    assert.equal(desktopFrameDecision(type, VOICE_ROUTE.SESSIONS), FRAME_DECISION.FORWARD);
  }
  assert.equal(
    desktopFrameDecision(VOICE_SERVICE_FRAME.SESSION_ACTIVITY, VOICE_ROUTE.SESSIONS),
    FRAME_DECISION.REPORT,
  );
  // The exchange's own appends from an older desktop build, the microphone
  // switch that never crosses this socket, a handshake frame after the
  // handshake, and a frame whose type cannot be read: each closes the socket.
  for (const type of [
    LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    LIVE_CLIENT_EVENT.THINKING_APPEND,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
    LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
    VOICE_SERVICE_FRAME.SESSION_CREATE,
    VOICE_SERVICE_FRAME.SESSION_ATTACH,
    undefined,
  ]) {
    assert.equal(desktopFrameDecision(type, VOICE_ROUTE.SESSIONS), FRAME_DECISION.REFUSE);
  }
});

test("the introduction is shown exactly the renderer's server events and may send exactly its client events", () => {
  for (const selector of RENDERER_SERVER_EVENTS) {
    assert.equal(
      upstreamFrameDecision(selector.type, VOICE_ROUTE.INTRODUCTION),
      FRAME_DECISION.FORWARD,
    );
  }
  for (const type of [
    LIVE_SERVER_EVENT.DELEGATION_CREATED,
    LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
    LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
    undefined,
  ]) {
    assert.equal(
      upstreamFrameDecision(type, VOICE_ROUTE.INTRODUCTION),
      FRAME_DECISION.DROP_UNPERMITTED,
    );
  }
  for (const type of RENDERER_CLIENT_EVENTS) {
    assert.equal(desktopFrameDecision(type, VOICE_ROUTE.INTRODUCTION), FRAME_DECISION.FORWARD);
  }
  for (const type of [
    LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
    LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
    LIVE_CLIENT_EVENT.THINKING_APPEND,
    undefined,
  ]) {
    assert.equal(
      desktopFrameDecision(type, VOICE_ROUTE.INTRODUCTION),
      FRAME_DECISION.DROP_UNPERMITTED,
    );
  }
});
