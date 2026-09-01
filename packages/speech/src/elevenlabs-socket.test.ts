import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeSpeechAudio,
  elevenlabsSpeechUrl,
  MAXIMUM_SPEECH_ERROR_LENGTH,
  parseSpeechFrame,
  speechCloseFrame,
  speechOpeningFrame,
  speechTextFrame,
} from "./elevenlabs-socket.js";

test("opens the documented socket, with the voice and the token as its only variables", () => {
  const url = new URL(elevenlabsSpeechUrl("v1", "single-use"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "api.elevenlabs.io");
  assert.equal(url.pathname, "/v1/text-to-speech/v1/stream-input");
  assert.equal(url.searchParams.get("model_id"), "eleven_flash_v2_5");
  assert.equal(url.searchParams.get("output_format"), "pcm_24000");
  assert.equal(url.searchParams.get("single_use_token"), "single-use");
  assert.deepEqual([...url.searchParams.keys()], ["model_id", "output_format", "single_use_token"]);
});

test("a voice id addresses one voice and can never address anything else", () => {
  // The voice rides in the path, so a separator inside one would otherwise
  // reach a different endpoint entirely.
  const url = new URL(elevenlabsSpeechUrl("../../v1/history?x=", "single-use"));
  assert.equal(url.pathname, "/v1/text-to-speech/..%2F..%2Fv1%2Fhistory%3Fx%3D/stream-input");
  assert.deepEqual([...url.searchParams.keys()], ["model_id", "output_format", "single_use_token"]);
});

test("sends only the three documented frames", () => {
  assert.deepEqual(speechOpeningFrame(), { text: " " });
  assert.deepEqual(speechTextFrame("Hello"), { text: "Hello" });
  // An empty text closes the socket and flushes what is buffered on the way,
  // which is why the reply's last words never need a flush of their own.
  assert.deepEqual(speechCloseFrame(), { text: "" });
});

test("reads only the documented server fields", () => {
  assert.deepEqual(parseSpeechFrame(JSON.stringify({ audio: "AAA=", alignment: {} })), {
    audio: "AAA=",
    final: false,
  });
  assert.deepEqual(parseSpeechFrame(JSON.stringify({ isFinal: true })), { final: true });
  // This socket answers in camelCase; the snake spelling is a different
  // endpoint's and must not be read as an ending here.
  assert.deepEqual(parseSpeechFrame(JSON.stringify({ is_final: true })), { final: false });
  assert.equal(
    parseSpeechFrame(JSON.stringify({ error: `  ${"e".repeat(400)}  ` }))?.error?.length,
    MAXIMUM_SPEECH_ERROR_LENGTH,
  );
  // The sentence is preferred over the machine identifier beside it.
  assert.equal(
    parseSpeechFrame(JSON.stringify({ message: "voice not found", error: "not_found" }))?.error,
    "voice not found",
  );
  // An empty audio field is no audio, not a frame of silence to schedule.
  assert.equal(parseSpeechFrame(JSON.stringify({ audio: "" }))?.audio, undefined);
  assert.equal(parseSpeechFrame("not json"), undefined);
  assert.equal(parseSpeechFrame(JSON.stringify(["audio"])), undefined);
});

test("decodes signed little-endian samples into the ±1 range", () => {
  // 0, 1, -1, 32767, -32768 as 16-bit little-endian.
  const bytes = new Uint8Array([0, 0, 1, 0, 0xff, 0xff, 0xff, 0x7f, 0x00, 0x80]);
  const base64 = btoa(String.fromCharCode(...bytes));
  const samples = decodeSpeechAudio(base64);
  assert.equal(samples.length, 5);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs((samples[1] ?? 0) - 1 / 32768) < 1e-9);
  assert.ok(Math.abs((samples[2] ?? 0) + 1 / 32768) < 1e-9);
  assert.ok(Math.abs((samples[3] ?? 0) - 32767 / 32768) < 1e-9);
  assert.equal(samples[4], -1);
});

test("drops a trailing half sample rather than clicking on it", () => {
  const base64 = btoa(String.fromCharCode(...new Uint8Array([0, 0, 7])));
  assert.equal(decodeSpeechAudio(base64).length, 1);
  assert.equal(decodeSpeechAudio("").length, 0);
});
