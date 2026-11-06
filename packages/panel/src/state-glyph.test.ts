// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { TerminalIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_STATE, ToolLine, type ToolState } from "./ai-elements/tool.js";
import { TaskRowStatus } from "./desktop/task-card.js";
import { AgentGlyph } from "./tasks/tab-look.js";

const MODEL = "anthropic/claude-opus-5.5";

const WORKED_ON: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  agents: {
    total: 1,
    working: 1,
    agents: [
      {
        id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
        title: "Alerts",
        model: MODEL,
        effort: "high",
        status: AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

function drawn(node: ReactNode): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(createElement("div", null, node));
  return box;
}

function toolRow(state: ToolState): HTMLElement {
  return drawn(
    createElement(ToolLine, {
      state,
      icon: createElement(TerminalIcon),
      label: "Ran",
      subject: "pnpm test",
    }),
  );
}

test("a sidebar plan's row, an agent's tab, and a running call draw one working mark under one name", () => {
  const surfaces = {
    sidebar: drawn(createElement(TaskRowStatus, { task: WORKED_ON })),
    tab: drawn(
      createElement(AgentGlyph, { agent: { model: MODEL, status: AGENT_STATUS.RUNNING } }),
    ),
    toolRow: toolRow(TOOL_STATE.INPUT_AVAILABLE),
  };
  const names = Object.values(surfaces).map(
    (surface) => surface.querySelector("[role='img']")?.getAttribute("aria-label") ?? "",
  );
  assert.deepEqual(names, ["Working", "Working", "Working"]);
});

test("a call that failed wears the failed mark a failed agent's tab does", () => {
  const row = toolRow(TOOL_STATE.OUTPUT_ERROR);
  assert.equal(row.querySelector("[role='img']")?.getAttribute("aria-label"), "Failed");
});

test("a call that ended well wears no mark", () => {
  assert.equal(toolRow(TOOL_STATE.OUTPUT_AVAILABLE).querySelector("[role='img']"), null);
});
