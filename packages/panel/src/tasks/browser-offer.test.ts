// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import { BROWSER_TAB_OPEN_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DesktopTasks } from "../desktop/desktop-tasks.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./use-side-panel.js";
import { NO_LOOKS } from "./use-task-looks.js";

/**
 * Where a Browser tab is offered: the side panel's "+" lists New Browser tab
 * under Browser while the account has the Browser tab experiment on, and a
 * pick opens one; with it off, the "+" offers none, as a feature still behind
 * Settings › Experimental stands nowhere. On a task with coding agents it
 * offers a new tab in each agent's browser too, the agent viewed first, and
 * a pick lands on a draft of it, which opens nothing until its bar's Enter
 * (`cloud-browser-tab.test.ts`). A synthetic plan and agents throughout.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  document: { body: "", assumptions: [] },
};

const SUMMARY: TaskSummary = {
  id: TASK.id,
  workspaceId: TASK.workspaceId,
  name: TASK.name,
  createdAt: TASK.createdAt,
  updatedAt: TASK.updatedAt,
  repository: TASK.repository,
};

/** A coding agent on the task, and a second beside it. */
const AGENT: CodingAgentSummary = {
  id: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry",
  createdAt: 3,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const OTHER_AGENT: CodingAgentSummary = {
  ...AGENT,
  id: "1c6a9d2f-5e4b-4f7c-9a3d-0b2e8f4c6d51",
  title: "Invite emails",
  createdAt: 4,
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({
    onMenuCommand: () => () => undefined,
    onBrowserState: () => () => undefined,
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets the window's state, and the redraws it causes, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The plan drawn with its side panel open on its Board, answering how many Browser tabs the panel was asked to open, and the tabs it was asked to show. */
async function mount(
  agents: readonly CodingAgentSummary[] = [],
  viewed?: string,
): Promise<{ readonly opened: () => number; readonly chosen: readonly SidePanelTab[] }> {
  let opened = 0;
  const chosen: SidePanelTab[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [SUMMARY],
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...base.mainTabs,
      tabs: viewed === undefined ? [] : [{ agent: viewed }],
      tab: viewed === undefined ? undefined : { agent: viewed },
    },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      tab: SIDE_PANEL_TAB.BOARD,
      onOpenBrowser: () => {
        opened += 1;
      },
      onChoose: (tab) => {
        chosen.push(tab);
      },
    },
    agents: codingAgentsControl({ agents, agentIds: agents.map((agent) => agent.id) }),
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  await settle();
  return { opened: () => opened, chosen };
}

/** Opens the side panel's "+" and answers its rows under Browser. */
async function browserRows(): Promise<HTMLElement[]> {
  const add = document.querySelector<HTMLButtonElement>(
    '.side-panel-tabs button[aria-label="Open a tab"]',
  );
  assert.ok(add, "the panel's +");
  await act(async () => add.click());
  await settle();
  return [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="option"]')].filter(
    (row) => row.closest('[role="group"]')?.textContent?.startsWith("Browser") === true,
  );
}

test("with the experiment on, the panel's + offers New Browser tab, which opens one", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const task = await mount();

  const rows = await browserRows();
  assert.deepEqual(
    rows.map((row) => row.querySelector(".luke-combobox-option-label")?.textContent),
    ["New Browser tab"],
  );
  await act(async () => rows[0]?.click());
  assert.equal(task.opened(), 1);
});

test("with the experiment off, the panel's + offers no Browser tab", async () => {
  handState({});
  await mount();

  assert.deepEqual(await browserRows(), []);
});

/** The words of the rows under Browser. */
function rowWords(rows: readonly HTMLElement[]): readonly (string | null | undefined)[] {
  return rows.map((row) => row.querySelector(".luke-combobox-option-label")?.textContent);
}

test("on a task with coding agents, the panel's + offers a new tab in each agent's browser, the one viewed first, and a pick drafts one in its browser and opens nothing", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const asked: unknown[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      return Promise.resolve({ failure: BROWSER_TAB_OPEN_FAILURE.UNANSWERED });
    },
  });
  const task = await mount([AGENT, OTHER_AGENT], OTHER_AGENT.id);

  const rows = await browserRows();
  assert.deepEqual(rowWords(rows), [
    "New Browser tab",
    "New tab in Invite emails's browser",
    "New tab in Invite expiry's browser",
  ]);
  await act(async () => rows[2]?.click());
  await settle();

  const [drafted] = task.chosen;
  assert.ok(
    drafted instanceof Object && "cloudBrowser" in drafted && drafted.cloudBrowser.length > 0,
    "the panel lands on a draft cloud Browser tab",
  );
  assert.deepEqual(asked, [], "nothing opens in the agent's sandbox until the draft's Enter");
});

test("with the experiment off, the panel's + offers no tab in an agent's browser", async () => {
  handState({});
  await mount([AGENT]);

  assert.deepEqual(await browserRows(), []);
});
