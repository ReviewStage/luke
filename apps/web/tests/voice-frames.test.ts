import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import {
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "../server/live";
import {
  desktopFrameDecision,
  FRAME_DECISION,
  frameText,
  frameType,
  routeForPath,
  upstreamFrameDecision,
  VOICE_ROUTE,
} from "../server/voice/frames";

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

test("a binary frame reads as nothing and a text frame as its text", () => {
  assert.equal(frameText(Buffer.from("{}"), true), undefined);
  assert.equal(frameText(Buffer.from("{}"), false), "{}");
  assert.equal(frameText([Buffer.from("{"), Buffer.from("}")], false), "{}");
  assert.equal(frameText(new Uint8Array([123, 125]).buffer, false), "{}");
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

test("a signed-in session forwards every other frame in both directions, unread ones included", () => {
  assert.equal(
    upstreamFrameDecision(LIVE_SERVER_EVENT.DELEGATION_CREATED, VOICE_ROUTE.SESSIONS),
    FRAME_DECISION.FORWARD,
  );
  assert.equal(upstreamFrameDecision(undefined, VOICE_ROUTE.SESSIONS), FRAME_DECISION.FORWARD);
  assert.equal(
    desktopFrameDecision(LIVE_CLIENT_EVENT.COMMENTARY_APPEND, VOICE_ROUTE.SESSIONS),
    FRAME_DECISION.FORWARD,
  );
  assert.equal(desktopFrameDecision(undefined, VOICE_ROUTE.SESSIONS), FRAME_DECISION.FORWARD);
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
