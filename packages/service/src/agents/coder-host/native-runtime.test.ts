import assert from "node:assert/strict";
import { test } from "vitest";
import { nativeRuntimeOfSession } from "./native-runtime.js";

test.each([
  ["claude-code-000000000001-x", "claude_code"],
  ["codex-000000000001-x", "codex"],
  ["luke-claude-code-000000000001-x", "claude_code"],
  ["luke-codex-000000000001-x", "codex"],
  ["wrun_eve", undefined],
])("a session named %s was minted by the %s harness", (sessionId, runtime) => {
  assert.equal(nativeRuntimeOfSession(sessionId), runtime);
});
