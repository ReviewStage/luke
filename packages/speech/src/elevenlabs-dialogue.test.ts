import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDialogueAudio,
  dialogueCloseFrame,
  dialogueInputFrame,
  dialogueKeepAliveFrame,
  dialogueVoicesFrame,
  ELEVENLABS_KEEP_ALIVE_MS,
  elevenlabsDialogueUrl,
  MAXIMUM_DIALOGUE_ERROR_LENGTH,
  parseDialogueFrame,
} from "./elevenlabs-dialogue.js";

test("opens the documented socket, with the token as its only variable", () => {
  const url = new URL(elevenlabsDialogueUrl("single-use"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "api.elevenlabs.io");
  assert.equal(url.pathname, "/v1/text-to-dialogue/stream-input");
  assert.equal(url.searchParams.get("model_id"), "eleven_v3_conversational");
  assert.equal(url.searchParams.get("output_format"), "pcm_24000");
  assert.equal(url.searchParams.get("single_use_token"), "single-use");
  assert.deepEqual([...url.searchParams.keys()], ["model_id", "output_format", "single_use_token"]);
});

test("sends only the four documented frames", () => {
  assert.deepEqual(dialogueVoicesFrame("v1"), { voices: ["v1"] });
  assert.deepEqual(dialogueInputFrame("v1", "Hello"), {
    inputs: [{ text: "Hello", voice_id: "v1", new_turn: false }],
  });
  assert.deepEqual(dialogueKeepAliveFrame(), { keep_alive: true });
  assert.deepEqual(dialogueCloseFrame(), { close_socket: true });
});

test("pings inside the twenty seconds ElevenLabs closes an idle socket after", () => {
  assert.ok(ELEVENLABS_KEEP_ALIVE_MS < 20_000);
});

test("reads only the documented server fields", () => {
  assert.deepEqual(parseDialogueFrame(JSON.stringify({ audio: "AAA=", alignment: {} })), {
    audio: "AAA=",
    finalForTurn: false,
    final: false,
  });
  assert.deepEqual(
    parseDialogueFrame(JSON.stringify({ is_final_audio_for_turn: true, is_final: true })),
    { finalForTurn: true, final: true },
  );
  assert.equal(
    parseDialogueFrame(JSON.stringify({ error: `  ${"e".repeat(400)}  ` }))?.error?.length,
    MAXIMUM_DIALOGUE_ERROR_LENGTH,
  );
  // An empty audio field is no audio, not a frame of silence to schedule.
  assert.equal(parseDialogueFrame(JSON.stringify({ audio: "" }))?.audio, undefined);
  assert.equal(parseDialogueFrame("not json"), undefined);
  assert.equal(parseDialogueFrame(JSON.stringify(["audio"])), undefined);
});

test("decodes signed little-endian samples into the ±1 range", () => {
  // 0, 1, -1, 32767, -32768 as 16-bit little-endian.
  const bytes = new Uint8Array([0, 0, 1, 0, 0xff, 0xff, 0xff, 0x7f, 0x00, 0x80]);
  const base64 = btoa(String.fromCharCode(...bytes));
  const samples = decodeDialogueAudio(base64);
  assert.equal(samples.length, 5);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs((samples[1] ?? 0) - 1 / 32768) < 1e-9);
  assert.ok(Math.abs((samples[2] ?? 0) + 1 / 32768) < 1e-9);
  assert.ok(Math.abs((samples[3] ?? 0) - 32767 / 32768) < 1e-9);
  assert.equal(samples[4], -1);
});

test("drops a trailing half sample rather than clicking on it", () => {
  const base64 = btoa(String.fromCharCode(...new Uint8Array([0, 0, 7])));
  assert.equal(decodeDialogueAudio(base64).length, 1);
  assert.equal(decodeDialogueAudio("").length, 0);
});
