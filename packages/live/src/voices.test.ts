import assert from "node:assert/strict";
import { test } from "vitest";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE, LIVE_VOICE_LIST } from "./voices.js";

test("the voice list is the SDK's built-in set, each name once", () => {
  assert.equal(LIVE_VOICE_LIST.length, 22);
  assert.equal(new Set(LIVE_VOICE_LIST).size, LIVE_VOICE_LIST.length);
  assert.deepEqual(LIVE_VOICE_LIST, Object.values(LIVE_VOICE));
});

test("the default voice is the API's own default and a member of the list", () => {
  assert.equal(LIVE_DEFAULTS.VOICE, LIVE_VOICE.MARIN);
  assert.ok(LIVE_VOICE_LIST.includes(LIVE_DEFAULTS.VOICE));
  assert.equal(LIVE_DEFAULTS.MODEL, "gpt-live-1");
});

test("a voice arriving from storage is admitted only from the list", () => {
  for (const voice of LIVE_VOICE_LIST) assert.ok(isLiveVoice(voice));
  assert.equal(isLiveVoice("Marin"), false);
  assert.equal(isLiveVoice("onyx"), false);
  assert.equal(isLiveVoice(1), false);
  assert.equal(isLiveVoice(undefined), false);
});
