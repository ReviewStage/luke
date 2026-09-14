import assert from "node:assert/strict";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { test } from "vitest";
import {
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
} from "./events.js";
import { LIVE_SCENE, sessionInstructions } from "./instructions.js";
import { developerSeedItem } from "./seed.js";
import {
  LIVE_AUDIO_ENCODING,
  LIVE_AUDIO_FORMAT,
  LIVE_DEFAULT_AUDIO_FORMAT,
  LIVE_DELEGATION_TYPE,
  LIVE_INPUT_AUDIO_APPEND,
  LIVE_SESSION_START,
  LIVE_SESSIONS_PATH,
  LIVE_TRANSPORT_TYPE,
  type LiveAudioFormat,
  LiveAudioFormatSchema,
  liveAttachPath,
  liveCreateAnswerSchema,
  liveCreateRequest,
  livePrimarySessionConfig,
  liveSessionConfig,
  liveStartRequest,
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

test("a primary WebSocket session is the same document with a format and no data channel", () => {
  const config = livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP });
  const webrtc = liveSessionConfig({ scene: LIVE_SCENE.DESKTOP });

  assert.deepEqual(Object.keys(config).sort(), [
    "audio",
    "delegation",
    "instructions",
    "model",
    "store",
  ]);
  assert.equal(Object.hasOwn(config, "client"), false);
  assert.equal(Object.hasOwn(config, "transport"), false);
  assert.equal(config.model, webrtc.model);
  assert.equal(config.instructions, webrtc.instructions);
  assert.equal(config.delegation.type, LIVE_DELEGATION_TYPE);
  assert.equal(config.store, false);
  assert.equal(config.audio.output.voice, LIVE_DEFAULTS.VOICE);
  assert.deepEqual(Object.keys(config.audio).sort(), ["format", "output"]);
});

test("the four formats are the API's own, and a session with no format named is PCM16 at 16 kHz", () => {
  assert.deepEqual(Object.values(LIVE_AUDIO_FORMAT), [
    { type: LIVE_AUDIO_ENCODING.PCM16, rate: 24_000 },
    { type: LIVE_AUDIO_ENCODING.PCM16, rate: 16_000 },
    { type: LIVE_AUDIO_ENCODING.G711_ULAW, rate: 8_000 },
    { type: LIVE_AUDIO_ENCODING.G711_ALAW, rate: 8_000 },
  ]);
  assert.deepEqual(LIVE_DEFAULT_AUDIO_FORMAT, LIVE_AUDIO_FORMAT.PCM16_16K);
  assert.deepEqual(
    livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP }).audio.format,
    LIVE_AUDIO_FORMAT.PCM16_16K,
  );
  assert.deepEqual(
    livePrimarySessionConfig({
      scene: LIVE_SCENE.DESKTOP,
      format: LIVE_AUDIO_FORMAT.G711_ULAW_8K,
    }).audio.format,
    LIVE_AUDIO_FORMAT.G711_ULAW_8K,
  );
});

test("the format schema admits each of the four formats as itself and refuses every other pairing", () => {
  const read = readEither(LiveAudioFormatSchema);
  for (const format of Object.values(LIVE_AUDIO_FORMAT)) {
    const admitted: LiveAudioFormat | undefined = Result.getOrUndefined(read({ ...format }));
    assert.deepEqual(admitted, format);
  }
  for (const refused of [
    { type: LIVE_AUDIO_ENCODING.PCM16, rate: 8_000 },
    { type: LIVE_AUDIO_ENCODING.G711_ULAW, rate: 16_000 },
    { type: LIVE_AUDIO_ENCODING.G711_ALAW, rate: 24_000 },
    { type: "audio/opus", rate: 48_000 },
    { type: LIVE_AUDIO_ENCODING.PCM16 },
    { rate: 16_000 },
    { type: LIVE_AUDIO_ENCODING.PCM16, rate: 16_000, channels: 1 },
    "audio/pcm",
  ]) {
    assert.equal(Result.isFailure(read(refused)), true);
  }
});

test("the audio append is the primary socket's own client event, named as its reflection is and outside the renderer's set", () => {
  assert.equal(LIVE_INPUT_AUDIO_APPEND, LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND);
  const inSessionEvents: readonly string[] = Object.values(LIVE_CLIENT_EVENT);
  assert.equal(inSessionEvents.includes(LIVE_INPUT_AUDIO_APPEND), false);
  const rendererEvents: readonly string[] = RENDERER_CLIENT_EVENTS;
  assert.equal(rendererEvents.includes(LIVE_INPUT_AUDIO_APPEND), false);
});

test("a primary session takes the caller's voice, model, and history on the same terms", () => {
  const seeded = livePrimarySessionConfig({
    scene: LIVE_SCENE.INTRODUCTION,
    voice: LIVE_VOICE.CEDAR,
    model: "gpt-live-1-pinned",
    input: [developerSeedItem("Detected sessions: one.")],
  });

  assert.equal(seeded.audio.output.voice, LIVE_VOICE.CEDAR);
  assert.equal(seeded.model, "gpt-live-1-pinned");
  assert.equal(seeded.input?.length, 1);
  assert.equal(seeded.instructions, sessionInstructions(LIVE_SCENE.INTRODUCTION));
  assert.equal(
    Object.hasOwn(livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP, input: [] }), "input"),
    false,
  );
});

test("the start message carries the session under the API's own type and nothing else", () => {
  const session = livePrimarySessionConfig({ scene: LIVE_SCENE.DESKTOP });
  const request = liveStartRequest(session);

  assert.deepEqual(Object.keys(request).sort(), ["session", "type"]);
  assert.equal(request.type, LIVE_SESSION_START);
  assert.equal(request.session, session);
  const inSessionEvents: readonly string[] = Object.values(LIVE_CLIENT_EVENT);
  assert.equal(inSessionEvents.includes(LIVE_SESSION_START), false);
});

test("the creation request carries the session and the WebRTC offer", () => {
  const session = liveSessionConfig({ scene: LIVE_SCENE.DESKTOP });
  const request = liveCreateRequest(session, "v=0\r\n");

  assert.deepEqual(Object.keys(request).sort(), ["session", "transport"]);
  assert.equal(request.session, session);
  assert.deepEqual(request.transport, { type: LIVE_TRANSPORT_TYPE, sdp: "v=0\r\n" });
});

function parseLiveCreateAnswer(value: UnparsedWireValue) {
  return Result.getOrUndefined(
    readEither(liveCreateAnswerSchema, { excess: EXCESS_KEYS.DROP })(value),
  );
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
