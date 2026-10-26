import assert from "node:assert/strict";
import { CODING_AGENT_KIND, CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { backendToolsOf } from "./call-backend.js";

test("a call into an agent on no task, in no repository, on the developer's Mac, with Memory off, is told none of the tools that agent is not offered, nor sleep, and still the ones it holds", () => {
  const told = new Set(
    backendToolsOf(
      {
        taskId: null,
        repository: null,
        kind: CODING_AGENT_KIND.CODER,
        machine: CODING_AGENT_MACHINE.MAC,
      },
      false,
    ),
  );
  for (const withheld of [
    AGENT_TOOL.EDIT_PLAN,
    AGENT_TOOL.DRAW_ON_BOARD,
    AGENT_TOOL.READ_COMMENTS,
    AGENT_TOOL.OPEN_PULL_REQUEST,
    AGENT_TOOL.APPLY_PATCH,
    AGENT_TOOL.SHOW_CODE,
    AGENT_TOOL.LIST_OPEN_ASKS,
    AGENT_TOOL.REMEMBER,
    AGENT_TOOL.RECALL,
    AGENT_TOOL.SLEEP,
    AGENT_TOOL.BROWSER,
  ]) {
    assert.equal(told.has(withheld), false, withheld);
  }
  for (const held of [
    AGENT_TOOL.SHOW_PAGE,
    AGENT_TOOL.DELETE_SECTION,
    AGENT_TOOL.START_AGENT,
    AGENT_TOOL.END_CALL,
  ]) {
    assert.equal(told.has(held), true, held);
  }
});
