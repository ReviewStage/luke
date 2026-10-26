import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AGENT_LEAD, AgentMessage } from "../../../packages/panel/src/tasks/agent-tab.js";
import { dockedTodos, newestTodos, taskTodos } from "../../../packages/panel/src/tasks/agent-todos.js";
import { fakeAppPlatform, QUIET_PANEL } from "../../../packages/panel/src/testing/app-platform.js";
import { TranscriptTodosDock } from "../../../packages/panel/src/tasks/transcript-blocks.js";
import { todoFocus } from "../../../packages/panel/src/tasks/tool-call-model.js";

fakeAppPlatform(QUIET_PANEL);

function part(id: string, tool: string, input: WireRecord, output?: string): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: id,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

const message: CodingAgentMessage = {
  id: "turn",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    { type: "text", text: "I'll keep the to-dos as tasks and work through them." },
    part("c1", "TaskCreate", { subject: "Read the SDK's Task tool types", description: "" }, "Task #1 created successfully: Read the SDK's Task tool types"),
    part("c2", "TaskCreate", { subject: "Fold TaskCreate and TaskUpdate into one list", description: "" }, "Task #2 created successfully: Fold TaskCreate and TaskUpdate into one list"),
    part("c3", "TaskCreate", { subject: "Draw it through TranscriptTodos", description: "" }, "Task #3 created successfully: Draw it through TranscriptTodos"),
    part("c4", "TaskCreate", { subject: "Test the fold across pages", description: "" }, "Task #4 created successfully: Test the fold across pages"),
    part("u1", "TaskUpdate", { taskId: "1", status: "in_progress" }, "Updated task #1 status"),
    part("b1", "Read", { file_path: "sdk-tools.d.ts" }, "export interface TaskCreateInput {}"),
    part("u2", "TaskUpdate", { taskId: "1", status: "completed" }, "Updated task #1 status"),
    part("u3", "TaskUpdate", { taskId: "2", status: "in_progress" }, "Updated task #2 status"),
  ],
};

const lists = taskTodos([message]);
const standing = newestTodos([message], lists);
const docked = dockedTodos(standing, true);
const todos = standing === undefined ? undefined : { kept: standing.callId, open: standing.callId, live: standing.callId, lists };

const root = document.getElementById("root");
if (root === null) throw new Error("no root");
createRoot(root).render(
  createElement(
    "div",
    { style: { maxWidth: 720, padding: 24, display: "flex", flexDirection: "column", gap: 24 } },
    createElement(AgentMessage, {
      message,
      plan: false,
      lead: AGENT_LEAD,
      moving: true,
      delegation: { models: [], onOpenTarget: () => undefined },
      ...(todos === undefined ? undefined : { todos }),
    }),
    docked === undefined
      ? null
      : createElement(
          "div",
          { className: "agent-todos-dock" },
          createElement(TranscriptTodosDock, { todos: docked.todos, focus: todoFocus(docked.todos) }),
        ),
  ),
);
