import assert from "node:assert/strict";
import { test } from "vitest";
import { REALTIME_VOICE_SPEED } from "../server/core.js";
import { phoneVoiceSpeed } from "../server/hosted/account-preferences.js";

test("the phone's pace is absent from a snapshot with no field, no pace, or nothing at all", () => {
  assert.deepEqual(phoneVoiceSpeed("not a record"), { valid: true, value: undefined });
  assert.deepEqual(phoneVoiceSpeed({}), { valid: true, value: undefined });
  assert.deepEqual(phoneVoiceSpeed({ voiceSpeed: null }), { valid: true, value: undefined });
});

test("the phone's pace is read out when it names a pace the Realtime contract offers", () => {
  assert.deepEqual(phoneVoiceSpeed({ voiceSpeed: REALTIME_VOICE_SPEED.SLOW }), {
    valid: true,
    value: REALTIME_VOICE_SPEED.SLOW,
  });
});

test("a pace outside the Realtime contract refuses the whole snapshot", () => {
  assert.deepEqual(phoneVoiceSpeed({ voiceSpeed: 9 }), { valid: false });
  assert.deepEqual(phoneVoiceSpeed({ voiceSpeed: "quick" }), { valid: false });
});
