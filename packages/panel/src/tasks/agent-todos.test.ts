import assert from "node:assert/strict";
import {
  CODING_AGENT_TODO_STATUS,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { test } from "vitest";
import { dockedTodos, newestTodos, taskTodos } from "./agent-todos.js";

/**
 * agent-todos.test.ts -- a coding agent on Claude Code keeps its to-dos one
 * task at a time, with TaskCreate, TaskUpdate, TaskList, and TaskGet, and
 * the tab folds those calls into the list as it stood after each, in
 * creation order, across every page of the transcript, which it draws as a
 * whole list's call. The CLI's answers are spelled as CLI 2.1.304 spells
 * them. Synthetic words.
 */

const { PENDING, IN_PROGRESS, DONE } = CODING_AGENT_TODO_STATUS;

/** One stored part of a task call: answered with the CLI's words where given, still running where not, and failed where `failed`. */
function call(
  callId: string,
  tool: string,
  input: WireRecord,
  output?: string,
  failed = false,
): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: callId,
    state: failed ? "output-error" : output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
    ...(failed && output !== undefined ? { errorText: output } : undefined),
  };
}

function turn(id: string, parts: readonly WireRecord[]): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts };
}

const created = (callId: string, id: string, subject: string) =>
  call(
    callId,
    "TaskCreate",
    { subject, description: subject },
    `Task #${id} created successfully: ${subject}`,
  );

const updated = (callId: string, taskId: string, status: string) =>
  call(callId, "TaskUpdate", { taskId, status }, `Updated task #${taskId} status`);

test("creates and updates fold into one list in creation order, each call's list the one after it, across pages", () => {
  const first = turn("turn-1", [
    created("c1", "1", "Round the totals"),
    created("c2", "2", "Export the invoices"),
    updated("u1", "1", "in_progress"),
  ]);
  const second = turn("turn-2", [
    updated("u2", "1", "completed"),
    updated("u3", "2", "in_progress"),
    call("c3", "TaskCreate", { subject: "Open the pull request" }),
  ]);
  const lists = taskTodos([first, second]);
  assert.deepEqual(lists.get("c1"), [{ content: "Round the totals", status: PENDING }]);
  assert.deepEqual(lists.get("u1"), [
    { content: "Round the totals", status: IN_PROGRESS },
    { content: "Export the invoices", status: PENDING },
  ]);
  // The second page's first call folds on from the first page's last.
  assert.deepEqual(lists.get("u2"), [
    { content: "Round the totals", status: DONE },
    { content: "Export the invoices", status: PENDING },
  ]);
  // A create still running lists its subject pending, as the list stands while the CLI answers.
  assert.deepEqual(lists.get("c3"), [
    { content: "Round the totals", status: DONE },
    { content: "Export the invoices", status: IN_PROGRESS },
    { content: "Open the pull request", status: PENDING },
  ]);
  const standing = newestTodos([first, second], lists);
  assert.equal(standing?.callId, "c3");
  assert.deepEqual(dockedTodos(standing, true)?.todos, lists.get("c3"));
  assert.equal(dockedTodos(standing, false), undefined);
});

test("a list answer in another order keeps creation order, moves each task, adds one the fold never saw, and drops one it no longer lists", () => {
  const message = turn("turn", [
    created("c1", "1", "Round the totals"),
    created("c2", "2", "Export the invoices"),
    created("c3", "3", "Open the pull request"),
    call(
      "l1",
      "TaskList",
      {},
      [
        "#4 [pending] Tell the orchestrator (ada) [blocked by #2]",
        "#2 [in_progress] Export the invoices",
        "#1 [completed] Round the totals",
      ].join("\n"),
    ),
  ]);
  assert.deepEqual(taskTodos([message]).get("l1"), [
    { content: "Round the totals", status: DONE },
    { content: "Export the invoices", status: IN_PROGRESS },
    { content: "Tell the orchestrator (ada)", status: PENDING },
  ]);
});

test("a deleted task leaves the list, a read of one moves it, and a failed call or a task not found moves nothing", () => {
  const message = turn("turn", [
    created("c1", "1", "Round the totals"),
    created("c2", "2", "Export the invoices"),
    call("u1", "TaskUpdate", { taskId: "1", status: "deleted" }, "Updated task #1 status"),
    call(
      "g1",
      "TaskGet",
      { taskId: "2" },
      "Task #2: Export the invoices\nStatus: in_progress\nDescription: Export them",
    ),
    call("u2", "TaskUpdate", { taskId: "2", status: "completed" }, "Task #2 not found"),
    call("u3", "TaskUpdate", { taskId: "2", status: "completed" }, "Error: no such task", true),
  ]);
  const lists = taskTodos([message]);
  assert.deepEqual(lists.get("u1"), [{ content: "Export the invoices", status: PENDING }]);
  assert.deepEqual(lists.get("g1"), [{ content: "Export the invoices", status: IN_PROGRESS }]);
  assert.deepEqual(lists.get("u2"), lists.get("g1"));
  assert.deepEqual(lists.get("u3"), lists.get("g1"));
});
