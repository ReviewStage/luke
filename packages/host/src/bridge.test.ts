import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@luke/wire";
import { test } from "vitest";
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
