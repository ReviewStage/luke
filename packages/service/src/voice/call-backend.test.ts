import assert from "node:assert/strict";
import { sessionInstructions } from "@luke/live";
import { test } from "vitest";
import { BRAIN_TOOL_NAMES } from "../agents/brain-host/brain.js";
import { backendToolsOf, CALL_BACKEND } from "./call-backend.js";

/**
 * The backend tools a task's call is told about, against what the brain is
 * offered: the list is generated from the registry rather than kept by hand,
 * so it is held here to the brain root's own set (`BRAIN_TOOL_NAMES`, which
 * `apps/luke/tools/brain.ts` offers), and to every tool the hand-written list
 * named before it was generated, so a call about a task loses none.
 */

/** The tools `CALL_DELEGATION_POLICY` named by hand before the list was generated. */
const HAND_LISTED_TOOLS = [
  "run_in_repository",
  "search_web",
  "read_web_page",
  "edit_plan",
  "draw_on_board",
  "list_agents",
  "read_agent",
  "message_agent",
  "start_agent",
  "stop_agent",
  "update_agent",
  "list_tasks",
  "read_task",
  "create_task",
  "update_task",
  "list_models",
  "create_section",
  "delete_section",
  "end_call",
] as const;

test("a task's call is told exactly the tools the brain is offered, every tool the hand list named among them", () => {
  const told = backendToolsOf(CALL_BACKEND.TASK);
  assert.deepEqual(new Set(told), new Set(BRAIN_TOOL_NAMES));
  assert.equal(told.length, BRAIN_TOOL_NAMES.size);
  assert.deepEqual(
    HAND_LISTED_TOOLS.filter((tool) => !told.includes(tool)),
    [],
  );
  const instructions = sessionInstructions(told);
  assert.deepEqual(
    told.filter((tool) => !instructions.includes(tool)),
    [],
  );
});
