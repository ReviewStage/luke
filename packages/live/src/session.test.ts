import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Either } from "effect";
import { test } from "vitest";
import { RENDERER_CLIENT_EVENTS, RENDERER_SERVER_EVENTS } from "./events.js";
import { LIVE_SCENE, sessionInstructions } from "./instructions.js";
import { developerSeedItem } from "./seed.js";
import {
  LIVE_DELEGATION_TYPE,
  LIVE_SESSIONS_PATH,
  LIVE_TRANSPORT_TYPE,
  liveAttachPath,
  liveCreateAnswerSchema,
  liveCreateRequest,
  liveSessionConfig,
} from "./session.js";
import { LIVE_DEFAULTS, LIVE_VOICE } from "./voices.js";

test("a session is the client's delegation, unstored, with the renderer's channel restricted", () => {
  const config = liveSessionConfig({ scene: LIVE_SCENE.DESKTOP });

  assert.equal(config.model, LIVE_DEFAULTS.MODEL);
  assert.equal(config.delegation.type, LIVE_DELEGATION_TYPE);
  assert.equal(config.store, false);
  assert.equal(config.audio.output.voice, LIVE_DEFAULTS.VOICE);
  assert.deepEqual(config.client.data_channel.allowed_client_events, [...RENDERER_CLIENT_EVENTS]);
  assert.deepEqual(config.client.data_channel.allowed_server_events, [...RENDERER_SERVER_EVENTS]);
  assert.equal(config.instructions, sessionInstructions(LIVE_SCENE.DESKTOP));
});

test("a session names nothing the Live API does not document", () => {
  const config = liveSessionConfig({ scene: LIVE_SCENE.DESKTOP });

  assert.deepEqual(Object.keys(config).sort(), [
    "audio",
    "client",
    "delegation",
    "instructions",
    "model",
    "store",
  ]);
  assert.equal(Object.hasOwn(config, "tools"), false);
  assert.equal(Object.hasOwn(config, "truncation"), false);
  assert.equal(Object.hasOwn(config, "type"), false);
  assert.deepEqual(Object.keys(config.audio), ["output"]);
  assert.deepEqual(Object.keys(config.audio.output), ["voice"]);
});

test("the voice, model, and history are the caller's, and an empty history is omitted", () => {
  const seeded = liveSessionConfig({
    scene: LIVE_SCENE.INTRODUCTION,
    voice: LIVE_VOICE.CEDAR,
    model: "gpt-live-1-pinned",
    input: [developerSeedItem("Detected sessions: one.")],
  });

  assert.equal(seeded.audio.output.voice, LIVE_VOICE.CEDAR);
  assert.equal(seeded.model, "gpt-live-1-pinned");
  assert.equal(seeded.input?.length, 1);
  assert.equal(
    Object.hasOwn(liveSessionConfig({ scene: LIVE_SCENE.DESKTOP, input: [] }), "input"),
    false,
  );
});

test("the creation request carries the session and the WebRTC offer", () => {
  const session = liveSessionConfig({ scene: LIVE_SCENE.DESKTOP });
  const request = liveCreateRequest(session, "v=0\r\n");

  assert.deepEqual(Object.keys(request).sort(), ["session", "transport"]);
  assert.equal(request.session, session);
  assert.deepEqual(request.transport, { type: LIVE_TRANSPORT_TYPE, sdp: "v=0\r\n" });
});

function parseLiveCreateAnswer(value: UnparsedWireValue) {
  return Either.getOrUndefined(readEither(liveCreateAnswerSchema)(value));
}

test("the creation answer is read for its id and SDP, ignoring what else the service adds", () => {
  const answer = parseLiveCreateAnswer({
    session: { id: "live_123", status: "active" },
    transport: { type: "webrtc", sdp: "v=0\r\na=answer\r\n", extra: true },
  });

  assert.deepEqual(answer, {
    session: { id: "live_123" },
    transport: { type: "webrtc", sdp: "v=0\r\na=answer\r\n" },
  });
});

test("an answer without an id or an SDP, or on another transport, is refused whole", () => {
  assert.equal(
    parseLiveCreateAnswer({ session: {}, transport: { type: "webrtc", sdp: "x" } }),
    undefined,
  );
  assert.equal(
    parseLiveCreateAnswer({ session: { id: "live_1" }, transport: { type: "webrtc" } }),
    undefined,
  );
  assert.equal(
    parseLiveCreateAnswer({
      session: { id: "live_1" },
      transport: { type: "websocket", sdp: "x" },
    }),
    undefined,
  );
});

test("the attach path is under the sessions path and keeps the id opaque", () => {
  assert.equal(liveAttachPath("live_123"), `${LIVE_SESSIONS_PATH}/live_123/attach`);
  assert.equal(liveAttachPath("a/b"), `${LIVE_SESSIONS_PATH}/a%2Fb/attach`);
});
