import assert from "node:assert/strict";
import { test } from "vitest";
import { voiceStatus } from "./luke-identity";

const quiet = { listening: false, lukeSpeaking: false };

test("a quiet voice says nothing in the title bar", () => {
  assert.equal(voiceStatus({ speakers: quiet, voiceOpening: false }), undefined);
});

test("a call still opening says it is connecting", () => {
  assert.equal(voiceStatus({ speakers: quiet, voiceOpening: true }), "Connecting");
});

test("an open microphone says it is listening, even while the call settles", () => {
  assert.equal(
    voiceStatus({ speakers: { ...quiet, listening: true }, voiceOpening: true }),
    "Listening",
  );
});

test("Luke speaking over an open microphone says he is speaking", () => {
  assert.equal(
    voiceStatus({ speakers: { listening: true, lukeSpeaking: true }, voiceOpening: false }),
    "Speaking",
  );
});
