import assert from "node:assert/strict";
import { IDLE_VOICE_VIEW } from "@luke/voice/voice-view";
import type { UnparsedWireValue } from "@luke/wire";
import { test } from "vitest";
import { BRIDGE } from "./bridge.js";
import { PUSH, PUSH_GUARD } from "./contract/index.js";

/** A chat message main tells the window is waiting, as `toastChatMessage` sends it. */
const WAITING = {
  messageId: "00000000-0000-4000-8000-000000000051",
  workspaceId: "workspace-acme",
  taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  words: "@agent-2 asked you",
  detail: "Chat",
};

test("a waiting chat message reaches the window under its task, or under none, and one naming neither is dropped", () => {
  const passes = (value: UnparsedWireValue) => PUSH_GUARD[PUSH.CHAT_MESSAGE_WAITING](value);
  assert.equal(passes(WAITING), true);
  assert.equal(passes({ ...WAITING, taskId: null }), true);
  const { taskId: _taskId, ...unplaced } = WAITING;
  assert.equal(passes(unplaced), false);
});

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
