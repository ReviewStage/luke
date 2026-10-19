// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { TOOL_STATE, ToolLine, type ToolState } from "@luke/panel/ai-elements/tool";
import { TaskStatusMark } from "@luke/panel/desktop/task-card";
import { AgentGlyph, agentEndMark } from "@luke/panel/tasks/tab-look";
import { TerminalIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

/**
 * state-glyph.test.ts -- work that is working or failed wears one mark for
 * it wherever it is drawn: a sidebar task's row, an agent's tab, and a
 * call's row in a transcript draw the same working mark under the same
 * name, and a call that failed wears the failed mark an agent's tab does.
 */

const MODEL = "anthropic/claude-opus-5.5";

/** A task an agent is working on, as the sidebar's list sums its agents up. */
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
        status: CODING_AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

/** The node drawn as `node` is, in a box of its own. */
function drawn(node: ReactNode): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(createElement("div", null, node));
  return box;
}

/** A call's row in a transcript, standing in `state`. */
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

/** The one mark a reader is told where work stands by, as its markup. */
function namedMark(surface: HTMLElement): string {
  const marks = surface.querySelectorAll("[role='img']");
  assert.equal(marks.length, 1, "one mark says where the work stands");
  return marks[0]?.outerHTML ?? "";
}

test("a sidebar plan's row, an agent's tab, and a running call draw one working mark under one name", () => {
  const surfaces = {
    sidebar: drawn(createElement(TaskStatusMark, { task: WORKED_ON })),
    tab: drawn(
      createElement(AgentGlyph, { agent: { model: MODEL, status: CODING_AGENT_STATUS.RUNNING } }),
    ),
    toolRow: toolRow(TOOL_STATE.INPUT_AVAILABLE),
  };
  const names = Object.values(surfaces).map(
    (surface) => surface.querySelector("[role='img']")?.getAttribute("aria-label") ?? "",
  );
  assert.deepEqual(names, ["Working", "Working", "Working"]);
  const marks = Object.values(surfaces).map(namedMark);
  assert.ok(marks[0]?.includes("working-mark"), "the mark is the working mark");
  assert.deepEqual(marks, [marks[0], marks[0], marks[0]]);
});

test("a call that failed wears the failed mark a failed agent's tab does", () => {
  const tab = drawn(agentEndMark({ status: CODING_AGENT_STATUS.FAILED }, false));
  const row = toolRow(TOOL_STATE.OUTPUT_ERROR);
  assert.equal(row.querySelector("[role='img']")?.getAttribute("aria-label"), "Failed");
  assert.equal(namedMark(row), namedMark(tab));
});

test("a call that ended well wears no mark", () => {
  assert.equal(toolRow(TOOL_STATE.OUTPUT_AVAILABLE).querySelector("[role='img']"), null);
});
