// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_WORK_PART, PLAN_WORK_STATE, PLAN_WORK_TOOL } from "@sidecar/hosted/planning-view";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PlanWork, SubagentTab } from "./plan-work";
import { workerOf, workRowsOf } from "./work-model";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mounted(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A task written as the planning model is asked to write one: a goal on its first line, then short sections. */
const TASK = [
  "Find how the **plan list** learns that a plan changed.",
  "",
  "## Inspect",
  "- `apps/desktop/src/renderer/desktop/desktop-plans.tsx`",
  "- The service's plan routes",
  "",
  "## Return",
  "The refresh path, with file paths and line numbers.",
].join("\n");

/** The turns of a plan whose one turn handed a worker the task, its subject the service's cut of it. */
const TURNS = [
  {
    turnId: "turn-1",
    startedAt: 1,
    state: PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    parts: [
      {
        type: PLAN_WORK_PART.TOOL,
        id: "call-worker",
        tool: PLAN_WORK_TOOL.WORKER,
        name: "worker",
        state: PLAN_WORK_STATE.DONE,
        subject: TASK.slice(0, 80),
        input: JSON.stringify({ message: TASK }, null, 2),
      },
    ],
  },
];

test("a worker's line and its task card name the task by its first line as plain words, and the opened card draws the task as markdown", () => {
  const work = mounted(
    createElement(PlanWork, {
      turns: TURNS,
      callLive: false,
      earlier: undefined,
      onLoadEarlier: async () => undefined,
      onOpenSubagent: () => undefined,
      shown: true,
    }),
  );
  const line = work.querySelector(".work-worker-line");
  assert.equal(line?.textContent, "Find how the plan list learns that a plan changed.");

  const worker = workerOf(workRowsOf(TURNS, false), "call-worker");
  assert.ok(worker);
  const tab = mounted(createElement(SubagentTab, { worker }));
  const card = tab.querySelector<HTMLDetailsElement>("[data-task-card]");
  assert.ok(card);
  assert.equal(
    card.querySelector("summary")?.textContent,
    "Task · Find how the plan list learns that a plan changed.",
  );

  act(() => card.querySelector("summary")?.click());
  assert.deepEqual(
    [...card.querySelectorAll("h2")].map((heading) => heading.textContent),
    ["Inspect", "Return"],
  );
  assert.deepEqual(
    [...card.querySelectorAll("li")].map((item) => item.textContent),
    ["apps/desktop/src/renderer/desktop/desktop-plans.tsx", "The service's plan routes"],
  );
  assert.equal(
    card.querySelector("li code")?.textContent,
    "apps/desktop/src/renderer/desktop/desktop-plans.tsx",
  );
});
