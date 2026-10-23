// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_KIND, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { type TaskSummary, UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * live-chip-names.test.ts -- a chip of a plan, an agent, a page, or a
 * section is called by what it is called now wherever the window holds it,
 * whatever words its link was written with: a plan written while still
 * Untitled by its name, an agent by its tab's name (Luke for an operator,
 * its model for one untitled), a page by its title, a section by its
 * heading; one the window cannot read keeps the words it was written with.
 * A chip naming a plan before the window ever read its task list has the
 * list followed, once between every chip and every draw, so the name lands;
 * a window already following it asks nothing. Synthetic
 * workspace, plans, agents, and page.
 */

const AT = 1_792_000_000_000;

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE_ID = "26494df1-595a-4364-abf7-85781c65a9f8";
const TITLED_AGENT = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const UNTITLED_AGENT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e60";
const OPERATOR = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f61";

/** A plan the window lists, still Untitled, and two it lists not. */
const UNTITLED_TASK = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a72";
const UNLISTED_TASK = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b83";
const LATER_TASK = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c94";

const HOME = "https://tryluke.dev/acme";
const PLAN = `${HOME}/plan/${TASK_ID}`;

const TASK: TaskSummary = {
  id: TASK_ID,
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
  agents: {
    total: 2,
    working: 0,
    agents: [
      {
        id: TITLED_AGENT,
        title: "Wire the desktop",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.COMPLETED,
      },
      {
        id: UNTITLED_AGENT,
        title: null,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

/** A plan whose agents have not named it yet. */
const { agents: _agents, ...UNNAMED } = TASK;

/** Main's document: the plans listed, the operator on no task, and the open plan's page. */
const STATE: AppStateSnapshot = stateWith(
  {},
  {
    tasks: {
      ...IDLE_TASKS_VIEW,
      listStatus: TASKS_READ.READY,
      tasks: [TASK, { ...UNNAMED, id: UNTITLED_TASK, name: UNTITLED_TASK_NAME }],
      tasklessAgents: [
        {
          id: OPERATOR,
          kind: CODING_AGENT_KIND.OPERATOR,
          planId: null,
          turnId: null,
          title: "Workspace questions",
          model: "openai/gpt-5.5",
          effort: "medium",
          status: CODING_AGENT_STATUS.COMPLETED,
          createdAt: AT,
          automationId: null,
          workspaceId: "workspace-acme",
          repository: null,
          activityAt: AT,
        },
      ],
      activeTaskId: TASK_ID,
      pages: [{ id: PAGE_ID, title: "Invite funnel", version: 2, at: AT }],
    },
  },
);

/** The plan's page, whose heading was renamed after a section's link was written. */
const PAGE: TaskMentionsValue = {
  taskId: TASK_ID,
  taskName: TASK.name,
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Rollout plan\n\nStore first.\n",
  doors: {
    taskId: TASK_ID,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(["rollout-plan"]),
    onOpenTask: () => undefined,
    onOpenFile: () => undefined,
  },
};

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn on the plan's page in a window holding `STATE`, every read of the task list counted. */
async function drawn(
  text: string,
  state: AppStateSnapshot = STATE,
): Promise<{ container: HTMLElement; refreshes: () => number }> {
  let refreshes = 0;
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  fakeActPort({
    [ACT_KIND.TASKS_REFRESH]: () => {
      refreshes += 1;
      return Promise.resolve();
    },
  });
  fakeAppPlatform(QUIET_PANEL);
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words = (said: string) =>
    createElement(TaskMentions, {
      value: PAGE,
      children: createElement(TranscriptWords, { text: said }),
    });
  const registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, words(text))));
  await settle();
  // Drawn again, as a transcript is drawn as its turn streams.
  act(() => root?.render(onRegistry(registry, words(`${text} `))));
  await settle();
  return { container, refreshes: () => refreshes };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
}

/** Each chip drawn: its kind and the name it says. */
function chips(container: HTMLElement): [string | undefined, string | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".luke-inline-ref-label")?.textContent ?? null,
  ]);
}

test("a chip written under an old name is called by the name the window holds now, and one it cannot read by the words it was written with", async () => {
  const { container } = await drawn(
    [
      `[@Untitled](${PLAN}),`,
      `[@Wire it](${PLAN}/agent/${TITLED_AGENT}),`,
      `[@Agent](${PLAN}/agent/${UNTITLED_AGENT}),`,
      `[@Workspace questions](${HOME}/agent/${OPERATOR}),`,
      `[@Old funnel](${PLAN}/page/${PAGE_ID}),`,
      `[@Rollout](${PLAN}#rollout-plan),`,
      `[@Rollout](${PLAN}#rollout),`,
      `[@Untitled](${HOME}/plan/${UNTITLED_TASK}),`,
      `and [@Billing revamp](${HOME}/plan/${UNLISTED_TASK}).`,
    ].join(" "),
  );

  assert.deepEqual(chips(container), [
    ["plan", "Teammate invitations"],
    ["agent", "Wire the desktop"],
    ["agent", "Opus 5.5"],
    ["agent", "Luke"],
    ["page", "Invite funnel"],
    ["section", "Rollout plan"],
    ["section", "Rollout"],
    ["plan", UNTITLED_TASK_NAME],
    ["plan", "Billing revamp"],
  ]);
});

test("chips naming plans before the window ever read its task list ask it to follow the list, once between them, however often they are drawn", async () => {
  const unread: AppStateSnapshot = {
    ...STATE,
    tasks: { ...STATE.tasks, listStatus: TASKS_READ.IDLE, tasks: [] },
  };
  const { refreshes } = await drawn(
    [
      `[@Untitled](${HOME}/plan/${UNTITLED_TASK})`,
      `[@Later](${HOME}/plan/${LATER_TASK})`,
      `[@Untitled](${PLAN})`,
    ].join(" "),
    unread,
  );

  assert.equal(refreshes(), 1);
});

test("a window already following its task list asks nothing, even for a plan it lists Untitled or not at all, whose name the follow brings", async () => {
  const { refreshes } = await drawn(
    `[@Untitled](${HOME}/plan/${UNTITLED_TASK}) and [@Later](${HOME}/plan/${LATER_TASK})`,
  );

  assert.equal(refreshes(), 0);
});
