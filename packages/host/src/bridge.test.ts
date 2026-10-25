import assert from "node:assert/strict";
import { IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import { test } from "vitest";
import { BRIDGE } from "./bridge.js";

test("the voice window's report carries what moved in the transcript or nothing, and a change its Schema refuses is dropped", () => {
  const passes = (value: readonly unknown[]) => BRIDGE.reportVoiceView.args(value);
  const line = { rowId: "row-1", speaker: "user", words: "Seven days.", startMs: 0, endMs: 900 };
  const change = { voiceSessionId: "voice-session-1", from: 0, lines: [line] };
  assert.equal(passes([IDLE_VOICE_VIEW, undefined, undefined]), true);
  assert.equal(passes([IDLE_VOICE_VIEW, undefined, change]), true);
  assert.equal(
    passes([IDLE_VOICE_VIEW, undefined, { ...change, voiceSessionId: undefined }]),
    true,
  );
  assert.equal(passes([IDLE_VOICE_VIEW, undefined, { ...change, from: -1 }]), false);
  assert.equal(passes([IDLE_VOICE_VIEW, undefined, { ...change, from: 0.5 }]), false);
  assert.equal(
    passes([IDLE_VOICE_VIEW, undefined, { ...change, lines: [{ ...line, speaker: "system" }] }]),
    false,
  );
  // A report without the third argument is a sender this build does not know.
  assert.equal(passes([IDLE_VOICE_VIEW, undefined]), false);
});
