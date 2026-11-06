// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS } from "@repo/features/agent-wire";
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

const AT = 1_792_000_000_000;

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE_ID = "26494df1-595a-4364-abf7-85781c65a9f8";
const TITLED_AGENT = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const UNTITLED_AGENT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e60";
const TASKLESS_AGENT = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f61";

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
  agents: {
    total: 2,
    working: 0,
    agents: [
      {
        id: TITLED_AGENT,
        title: "Wire the desktop",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: AGENT_STATUS.COMPLETED,
      },
      {
        id: UNTITLED_AGENT,
        title: null,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

const { agents: _agents, ...UNNAMED } = TASK;

const STATE: AppStateSnapshot = stateWith(
  {},
  {
    tasks: {
      ...IDLE_TASKS_VIEW,
      listStatus: TASKS_READ.READY,
      tasks: [TASK, { ...UNNAMED, id: UNTITLED_TASK, name: UNTITLED_TASK_NAME }],
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
  act(() => root?.render(onRegistry(registry, words(`${text} `))));
  await settle();
  return { container };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
}

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
