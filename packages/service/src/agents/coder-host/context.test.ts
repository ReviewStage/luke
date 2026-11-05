import assert from "node:assert/strict";
import type { AgentContextRow } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { test } from "vitest";
import { agentContextOf } from "./context.js";

/**
 * context.test.ts -- where an agent's context ring says its harness compacts: Claude Code's own line, not eve's share.
 */

/** An agent that has taken one step, in Opus 5.5's long window. */
const ROW: AgentContextRow = {
  model: "anthropic/claude-opus-5.5",
  contextWindow: CONTEXT_WINDOW.LONG,
  lastStep: {
    inputTokens: 963_700,
    outputTokens: 146,
    systemPromptTokens: 0,
    toolDefinitionTokens: 0,
    briefTokens: 57,
    at: 0,
  },
  compactedAt: null,
};

test("a Claude Code agent's ring compacts where Claude Code does, the window less its 20K output reserve and 13K buffer", () => {
  // Note that 967K is Claude Code's own threshold on a 1M window, which 963.7K has not reached.
  const context = agentContextOf(ROW, 1_000_000, CONVERSATION_RUNTIME.CLAUDE_CODE);

  assert.equal(context?.compactionThresholdTokens, 967_000);
});
