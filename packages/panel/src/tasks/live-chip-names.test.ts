// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { type TaskSummary, UNTITLED_TASK_NAME } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ } from "@repo/features/tasks-view";
import type { AppStateSnapshot } from "@repo/host/app-state";
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
 * Untitled by its name, an agent by its tab's name (its model for one
 * untitled), a page by its title, a section by its
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
const TASKLESS_AGENT = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f61";

/** A plan the window lists, still Untitled, and one it lists not. */
const UNTITLED_TASK = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a72";
const UNLISTED_TASK = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b83";

const HOME = "https://vespin.dev/acme";
const PLAN = `${HOME}/plan/${TASK_ID}`;

const TASK: TaskSummary = {
  id: TASK_ID,
  workspaceId: "workspace-acme",
  name: "Teammate invitations",
  createdAt: AT,
  updatedAt: AT,
  repository: "acme/relay",
  agents: { total: 2, working: 0, pullRequestTotal: 0 },
};

/** The plan's agents, as the list followed live holds them. */
const TASK_AGENTS: readonly ListedAgent[] = [
  { id: TITLED_AGENT, title: "Wire the desktop", status: AGENT_STATUS.COMPLETED },
  { id: UNTITLED_AGENT, title: null, status: AGENT_STATUS.RUNNING },
].map((agent) => ({
  ...agent,
  planId: TASK_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: AT,
  turnId: null,
  workspaceId: "workspace-acme",
  repository: "acme/relay",
}));

/** A plan whose agents have not named it yet. */
const { agents: _agents, ...UNNAMED } = TASK;

/** Main's document: the plans listed, an agent on no task, and the open plan's page. */
const STATE: AppStateSnapshot = stateWith(
  {},
  {
    tasks: {
      ...IDLE_TASKS_VIEW,
      listStatus: TASKS_READ.READY,
      tasks: [TASK, { ...UNNAMED, id: UNTITLED_TASK, name: UNTITLED_TASK_NAME }],
      taskAgents: TASK_AGENTS,
      tasklessAgents: [
        {
          id: TASKLESS_AGENT,
          planId: null,
          turnId: null,
          title: "Answer workspace questions",
          model: "openai/gpt-5.5",
          effort: "medium",
          status: AGENT_STATUS.COMPLETED,
          createdAt: AT,
          automationId: null,
          workspaceId: "workspace-acme",
          repository: null,
          activityAt: AT,
        },
      ],
      activeTaskId: TASK_ID,
    },
    [LIVE_READ.PAGES]: {
      [PAGE_OWNER.TASK]: {
        [TASK_ID]: { rows: [{ id: PAGE_ID, title: "Invite funnel", version: 2, at: AT }] },
      },
      [PAGE_OWNER.AGENT]: {},
    },
  },
);

/** The plan's page, whose heading was renamed after a section's link was written. */
const PAGE: TaskMentionsValue = {
  holder: { taskId: TASK_ID },
  taskName: TASK.name,
  workspace: "acme",
  repository: "acme/relay",
  text: () => "## Rollout plan\n\nStore first.\n",
  doors: {
    holder: { taskId: TASK_ID },
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

/** The words drawn on the plan's page in a window holding `STATE`. */
async function drawn(text: string): Promise<{ container: HTMLElement }> {
  fakeAppBridge({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(STATE),
  });
  fakeActPort({});
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
  return { container };
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
    chip.querySelector(".ui-inline-ref-label")?.textContent ?? null,
  ]);
}

test("a chip written under an old name is called by the name the window holds now, and one it cannot read by the words it was written with", async () => {
  const { container } = await drawn(
    [
      `[@Untitled](${PLAN}),`,
      `[@Wire it](${PLAN}/agent/${TITLED_AGENT}),`,
      `[@Agent](${PLAN}/agent/${UNTITLED_AGENT}),`,
      `[@Workspace questions](${HOME}/agent/${TASKLESS_AGENT}),`,
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
    ["agent", "Answer workspace questions"],
    ["page", "Invite funnel"],
    ["section", "Rollout plan"],
    ["section", "Rollout"],
    ["plan", UNTITLED_TASK_NAME],
    ["plan", "Billing revamp"],
  ]);
});
