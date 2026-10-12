// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanWorkState,
} from "@sidecar/hosted/planning-view";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { relayout } from "#testing/resize-observer";
import { PlanWork, SubagentTab } from "./plan-work";
import { workerOf, workRowsOf } from "./work-model";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
  const line = work.querySelector("[data-subagent-row]");
  assert.equal(line?.textContent, "Find how the plan list learns that a plan changed.");

  const worker = workerOf(workRowsOf(TURNS, false), "call-worker");
  assert.ok(worker);
  const tab = mounted(createElement(SubagentTab, { worker, shown: true }));
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

test("a worker's job cut short by its line is marked to fade at its end, while a job shown whole is not", () => {
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
  const faded = () =>
    work.querySelector("[data-subagent-row] .subagent-job")?.getAttribute("data-overflow");
  act(() => relayout());
  assert.equal(faded(), "false");

  // The panel narrowed under the line, so the job no longer fits it.
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("subagent-job") ? 600 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("subagent-job") ? 160 : 0;
  });
  act(() => relayout());
  assert.equal(faded(), "true");
});

test("a worker's row names the model its session ran on, with its harness's mark where the catalog lists it, and no effort where none was recorded; a worker whose session named none keeps the robot and no pair", () => {
  const [turn] = TURNS;
  assert.ok(turn);
  const [part] = turn.parts;
  assert.ok(part);
  const ranOn = (model: string | undefined) => [
    {
      ...turn,
      parts: [
        {
          ...part,
          session: {
            earlierOmitted: false,
            parts: [],
            ...(model === undefined ? undefined : { model }),
          },
        },
      ],
    },
  ];
  const drawn = (model: string | undefined) =>
    mounted(
      createElement(PlanWork, {
        turns: ranOn(model),
        callLive: false,
        earlier: undefined,
        onLoadEarlier: async () => undefined,
        onOpenSubagent: () => undefined,
        shown: true,
        models: [
          {
            id: "openai/gpt-6.1-sol",
            name: "GPT-6.1 Sol",
            provider: MODEL_PROVIDER.OPENAI,
            efforts: ["low", "medium", "high"],
          },
        ],
      }),
    ).querySelector("[data-subagent-row]");

  const named = drawn("openai/gpt-6.1-sol");
  assert.equal(named?.querySelector("[data-subagent-pair]")?.textContent, "GPT-6.1 Sol");
  assert.equal(named?.querySelector(".model-label-detail"), null, "no effort said");
  assert.ok(
    named?.querySelector('[data-subagent-harness="openai"] .provider-mark'),
    "Codex's mark",
  );
  assert.equal(named?.querySelector("svg.lucide-bot"), null);

  const unlisted = drawn("openai/gpt-7-terra");
  assert.equal(unlisted?.querySelector("[data-subagent-pair]")?.textContent, "GPT 7 Terra");
  assert.ok(unlisted?.querySelector("svg.lucide-bot"), "the robot where the catalog names none");

  const unnamed = drawn(undefined);
  assert.equal(unnamed?.querySelector("[data-subagent-pair]"), null);
  assert.ok(unnamed?.querySelector("svg.lucide-bot"));
});

test("a coding agent's start, once the agent began, is the one button that opens the agent's tab, saying what it did; a start still running or refused folds its input and answer open in place", () => {
  const start = (id: string, state: PlanWorkState, output: string | undefined) => ({
    type: PLAN_WORK_PART.TOOL,
    id,
    tool: PLAN_WORK_TOOL.START_AGENT,
    name: "start_coding_agent",
    state,
    subject: "Investigate a Tailwind migration.",
    input: JSON.stringify({ task: "Investigate a Tailwind migration." }),
    ...(output === undefined ? undefined : { output }),
  });
  const opened: string[] = [];
  const work = mounted(
    createElement(PlanWork, {
      turns: [
        {
          turnId: "turn-1",
          startedAt: 1,
          state: PLAN_WORK_STATE.RUNNING,
          earlierOmitted: false,
          parts: [
            start(
              "call-started",
              PLAN_WORK_STATE.DONE,
              JSON.stringify({
                status: "accepted",
                agent: { id: "agent-1", modelName: "Opus 5.5" },
              }),
            ),
            { type: PLAN_WORK_PART.TEXT, text: "Started Opus 5.5." },
            start("call-refused", PLAN_WORK_STATE.FAILED, "Not run: no repository."),
            { type: PLAN_WORK_PART.TEXT, text: "That did not start." },
            start("call-starting", PLAN_WORK_STATE.RUNNING, undefined),
          ],
        },
      ],
      callLive: true,
      earlier: undefined,
      onLoadEarlier: async () => undefined,
      onOpenSubagent: () => undefined,
      onOpenAgent: (agentId) => opened.push(agentId),
      shown: true,
    }),
  );

  const started = work.querySelector<HTMLElement>('[data-call-id="call-started"]');
  assert.equal(started?.tagName, "BUTTON");
  assert.match(started?.textContent ?? "", /^Started .+ Investigate a Tailwind migration\.$/u);
  act(() => started?.click());
  assert.deepEqual(opened, ["agent-1"]);
  for (const id of ["call-refused", "call-starting"]) {
    assert.equal(work.querySelector(`[data-call-id="${id}"]`)?.tagName, "DETAILS", id);
  }
});
