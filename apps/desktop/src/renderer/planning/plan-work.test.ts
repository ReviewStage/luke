// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TURN_ENDING, type TurnEnding } from "@sidecar/hosted/coding-agent-wire";
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
import { ACT_KIND } from "#shared/messages/acts";
import { installActBridge } from "#testing/act-bridge";
import { relayout } from "#testing/resize-observer";
import { PlanWork, SubagentTab } from "./plan-work";
import { workerOf, workRowsOf } from "./work-model";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  const card = tab.querySelector<HTMLDetailsElement>("[data-plan-card]");
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

/** A worker whose call is in `state` on a turn in the same state, its session drawn from `session` where it has one. */
function workerTurn(
  state: PlanWorkState,
  session?: {
    parts: readonly { type: typeof PLAN_WORK_PART.TEXT; text: string }[];
    ending?: TurnEnding;
  },
) {
  const [turn] = TURNS;
  const [part] = turn?.parts ?? [];
  assert.ok(turn && part);
  return [
    {
      ...turn,
      state,
      parts: [
        {
          ...part,
          state,
          ...(session === undefined
            ? undefined
            : { session: { earlierOmitted: false, ...session } }),
        },
      ],
    },
  ];
}

test("a subagent still starting says so once, on the working line at its tab's end, and says it is working once its session draws a row", () => {
  const tabOf = (turns: ReturnType<typeof workerTurn>) => {
    const worker = workerOf(workRowsOf(turns, true), "call-worker");
    assert.ok(worker);
    return mounted(createElement(SubagentTab, { worker, shown: false }));
  };
  const said = (tab: HTMLElement) => ({
    lines: [...tab.querySelectorAll("[data-working]")].map((line) => line.textContent),
    marks: tab.querySelectorAll(".working-mark").length,
  });

  assert.deepEqual(said(tabOf(workerTurn(PLAN_WORK_STATE.RUNNING))), {
    lines: ["Starting…"],
    marks: 0,
  });
  assert.deepEqual(said(tabOf(workerTurn(PLAN_WORK_STATE.RUNNING, { parts: [] }))), {
    lines: ["Starting…"],
    marks: 0,
  });
  const drawing = tabOf(
    workerTurn(PLAN_WORK_STATE.RUNNING, {
      parts: [{ type: PLAN_WORK_PART.TEXT, text: "Reading the plan routes." }],
    }),
  );
  assert.deepEqual(said(drawing).lines, ["Working…"]);
});

test("a turn or a subagent the service says failed reads Failed, as an agent's failed turn does, a subagent so even where its call was answered, and one stopped, left by its call, or from a service that said neither reads Stopped", () => {
  const [turn] = TURNS;
  assert.ok(turn);
  const ended = (ending: TurnEnding | undefined) => ({
    ...turn,
    turnId: `turn-${ending ?? "unsaid"}`,
    state: PLAN_WORK_STATE.FAILED,
    endedAt: 2,
    ...(ending === undefined ? undefined : { ending }),
  });
  const turns = [
    ended(TURN_ENDING.FAILED),
    ended(TURN_ENDING.ABANDONED),
    ended(TURN_ENDING.STOPPED),
    ended(undefined),
    { ...turn, turnId: "turn-left", state: PLAN_WORK_STATE.RUNNING },
  ];
  const work = mounted(
    createElement(PlanWork, {
      turns,
      callLive: false,
      earlier: undefined,
      onLoadEarlier: async () => undefined,
      onOpenSubagent: () => undefined,
      shown: true,
    }),
  );
  assert.deepEqual(
    [...work.querySelectorAll("[data-state]")].map((state) => state.textContent),
    ["Failed", "Failed", "Stopped", "Stopped", "Stopped"],
  );

  const endLine = (
    ending: TurnEnding | undefined,
    state: PlanWorkState = PLAN_WORK_STATE.FAILED,
  ) => {
    const worker = workerOf(
      workRowsOf(
        workerTurn(state, {
          parts: [{ type: PLAN_WORK_PART.TEXT, text: "Reading the plan routes." }],
          ...(ending === undefined ? undefined : { ending }),
        }),
        false,
      ),
      "call-worker",
    );
    assert.ok(worker);
    const tab = mounted(createElement(SubagentTab, { worker, shown: true }));
    return tab.querySelector("[data-ended]")?.textContent;
  };
  assert.equal(endLine(TURN_ENDING.FAILED), "Failed");
  assert.equal(endLine(TURN_ENDING.STOPPED), "Stopped");
  assert.equal(endLine(undefined), "Stopped");
  // The planning model answered the call and went on, and the subagent's own task failed.
  assert.equal(endLine(TURN_ENDING.FAILED, PLAN_WORK_STATE.DONE), "Failed");
  assert.equal(endLine(undefined, PLAN_WORK_STATE.DONE), undefined);
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

test("a worker's row names the model and effort its session ran on, with the mark of the harness its model's id names, and no effort where none was recorded; a worker whose session named none keeps the robot and no pair", () => {
  const [turn] = TURNS;
  assert.ok(turn);
  const [part] = turn.parts;
  assert.ok(part);
  const ranOn = (model: string | undefined, effort: string | undefined) => [
    {
      ...turn,
      parts: [
        {
          ...part,
          session: {
            earlierOmitted: false,
            parts: [],
            ...(model === undefined ? undefined : { model }),
            ...(effort === undefined ? undefined : { effort }),
          },
        },
      ],
    },
  ];
  const drawn = (model: string | undefined, effort?: string) =>
    mounted(
      createElement(PlanWork, {
        turns: ranOn(model, effort),
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

  const paired = drawn("openai/gpt-6.1-sol", "medium");
  assert.equal(paired?.querySelector("[data-subagent-pair]")?.textContent, "GPT-6.1 Sol Medium");
  assert.equal(paired?.querySelector(".model-label-detail")?.textContent, "Medium");

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
  assert.ok(
    unlisted?.querySelector('[data-subagent-harness="openai"] .provider-mark'),
    "Codex's mark, read from the model's id, as the worker's tab wears it",
  );

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

/** An observer that never sees its row come into view, so the older page is read only when the test asks. */
class UnseenObserver {
  observe(): void {}
  disconnect(): void {}
}

/** Lays out every element at the top of the window but the reveal mark, which stands `markTop` down, and the log, `logTop` down. */
function layOut(markTop: number, logTop: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute("data-reveal")) return new DOMRect(0, markTop, 0, 0);
    if (this.getAttribute("role") === "log") return new DOMRect(0, logTop, 300, 400);
    return new DOMRect();
  });
}

test("asked for a moment by a version's Open, the tab brings the turn that was running then to the top of its log, once", () => {
  layOut(340, 100);
  const said = (turnId: string, startedAt: number, text: string) => ({
    turnId,
    startedAt,
    state: PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    parts: [{ type: PLAN_WORK_PART.TEXT, text }],
  });
  const revealed = vi.fn();
  const work = mounted(
    createElement(PlanWork, {
      turns: [
        said("turn-1", 1_000, "First turn."),
        said("turn-2", 5_000, "Second turn."),
        said("turn-3", 9_000, "Third turn."),
      ],
      callLive: false,
      earlier: undefined,
      onLoadEarlier: async () => undefined,
      onOpenSubagent: () => undefined,
      shown: true,
      reveal: { at: 6_000, onRevealed: revealed },
    }),
  );

  const mark = work.querySelector("[data-reveal]");
  const words = (text: string) =>
    [...work.querySelectorAll("p")].find((line) => line.textContent === text);
  assert.ok(mark);
  assert.equal(work.querySelectorAll("[data-reveal]").length, 1);
  const precedes = (a: Node | undefined, b: Node | undefined) =>
    a !== undefined &&
    b !== undefined &&
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  assert.ok(precedes(words("First turn."), mark), "after the turn before it");
  assert.ok(precedes(mark, words("Second turn.")), "before the turn running at the moment");
  assert.equal(work.querySelector<HTMLElement>('[role="log"]')?.scrollTop, 240);
  assert.equal(revealed.mock.calls.length, 1);
});

test("asked for a moment older than every turn drawn, the tab reads older pages until the turn running then is drawn, and stops at a page that does not land", () => {
  layOut(340, 100);
  vi.stubGlobal("IntersectionObserver", UnseenObserver);
  const said = (turnId: string, startedAt: number, text: string) => ({
    turnId,
    startedAt,
    state: PLAN_WORK_STATE.DONE,
    earlierOmitted: false,
    parts: [{ type: PLAN_WORK_PART.TEXT, text }],
  });
  const revealed = vi.fn();
  const reads = vi.fn(() => Promise.resolve());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (turns: ReturnType<typeof said>[], earlier: string | undefined) =>
    act(() =>
      root.render(
        createElement(PlanWork, {
          turns,
          callLive: false,
          earlier,
          onLoadEarlier: reads,
          onOpenSubagent: () => undefined,
          shown: true,
          reveal: { at: 2_000, onRevealed: revealed },
        }),
      ),
    );

  draw([said("turn-3", 9_000, "Third turn.")], "turn-3");
  assert.equal(reads.mock.calls.length, 1);
  assert.equal(revealed.mock.calls.length, 0, "nothing is answered while an older page is read");
  draw([said("turn-1", 1_000, "First turn."), said("turn-3", 9_000, "Third turn.")], undefined);
  const mark = container.querySelector("[data-reveal]");
  const first = [...container.querySelectorAll("p")].find(
    (line) => line.textContent === "First turn.",
  );
  assert.ok(
    mark && first && (mark.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  assert.equal(revealed.mock.calls.length, 1);
});

test("an older page that does not land stops the seeking, and the ask is answered at the oldest turn drawn", async () => {
  layOut(340, 100);
  vi.stubGlobal("IntersectionObserver", UnseenObserver);
  const revealed = vi.fn();
  const reads = vi.fn(() => Promise.resolve());
  mounted(
    createElement(PlanWork, {
      turns: [
        {
          turnId: "turn-3",
          startedAt: 9_000,
          state: PLAN_WORK_STATE.DONE,
          earlierOmitted: false,
          parts: [{ type: PLAN_WORK_PART.TEXT, text: "Third turn." }],
        },
      ],
      callLive: false,
      earlier: "turn-3",
      onLoadEarlier: reads,
      onOpenSubagent: () => undefined,
      shown: true,
      reveal: { at: 2_000, onRevealed: revealed },
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(reads.mock.calls.length, 1, "asked once, not again for the same page");
  assert.equal(revealed.mock.calls.length, 1);
});

test("a link in Luke's words opens in the browser over the act channel, a GitHub page through github.open and any other web page through web.open, and a mail address is words that go nowhere", () => {
  const sent = installActBridge();
  const container = mounted(
    createElement(PlanWork, {
      turns: [
        {
          turnId: "turn-1",
          startedAt: 1,
          state: PLAN_WORK_STATE.DONE,
          earlierOmitted: false,
          parts: [
            {
              type: PLAN_WORK_PART.TEXT,
              text: "Read [the pull request](https://github.com/acme/relay/pull/7), [the docs](https://example.test/docs), and [mail](mailto:dean@example.test).",
            },
          ],
        },
      ],
      callLive: false,
      earlier: undefined,
      onLoadEarlier: () => Promise.resolve(),
      onOpenSubagent: () => undefined,
      shown: true,
    }),
  );
  assert.equal(container.querySelector('[href="mailto:dean@example.test"]'), null);
  assert.equal(container.querySelector(".agent-link-inert")?.textContent, "mail");
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a.agent-link")) {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    assert.equal(click.defaultPrevented, true);
  }
  assert.deepEqual(sent, [
    { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay/pull/7" } },
    { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.test/docs" } },
  ]);
});

test("Luke's turn is drawn by a coding agent's own message, so his words carry the Copy an agent's turn does, and a stopped turn's lead folds as an agent's does", () => {
  const work = mounted(
    createElement(PlanWork, {
      turns: [
        {
          turnId: "turn-words",
          startedAt: 1,
          endedAt: 2,
          state: PLAN_WORK_STATE.FAILED,
          earlierOmitted: false,
          parts: [
            {
              type: PLAN_WORK_PART.TOOL,
              id: "call-ls",
              tool: PLAN_WORK_TOOL.REPOSITORY,
              name: "run_in_repository",
              state: PLAN_WORK_STATE.DONE,
              subject: "ls",
              input: '{ "command": "ls" }',
              output: "src",
            },
            { type: PLAN_WORK_PART.TEXT, text: "Invites live in one file." },
          ],
        },
      ],
      callLive: false,
      earlier: undefined,
      onLoadEarlier: async () => undefined,
      onOpenSubagent: () => undefined,
      shown: true,
    }),
  );
  assert.ok(work.querySelector('button[aria-label="Copy"]'), "no Copy under Luke's words");
  // The call ahead of the last words folds under the turn's line, as a stopped agent turn's lead does.
  assert.ok(work.textContent?.includes("1 tool call"));
});

test("a subagent that ended having recorded nothing still says how long it worked, beside the line saying it recorded nothing", () => {
  const [row] = workRowsOf(
    [
      {
        turnId: "turn-empty",
        startedAt: 1,
        endedAt: 9_000,
        state: PLAN_WORK_STATE.DONE,
        earlierOmitted: false,
        parts: [
          {
            type: PLAN_WORK_PART.TOOL,
            id: "call-empty",
            tool: PLAN_WORK_TOOL.WORKER,
            name: "worker",
            state: PLAN_WORK_STATE.DONE,
            subject: "Find the admin check.",
            input: JSON.stringify({ message: "Find the admin check." }),
            session: {
              earlierOmitted: false,
              parts: [],
              startedAt: 1_000,
              endedAt: 4_000,
              model: "openai/gpt-6.1-sol",
              effort: "medium",
            },
          },
        ],
      },
    ],
    false,
  );
  assert.ok(row);
  const worker = workerOf([row], "call-empty");
  assert.ok(worker);
  const tab = mounted(createElement(SubagentTab, { worker, shown: true }));
  assert.ok(tab.textContent?.includes("Nothing recorded."));
  assert.ok(tab.textContent?.includes("Worked for 3s"), tab.textContent ?? "");
});
