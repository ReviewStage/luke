// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DesktopTasks } from "../desktop/desktop-tasks.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { MAIN_TAB } from "./use-main-tabs.js";
import { SIDE_PANEL_TAB } from "./use-side-panel.js";
import { NO_LOOKS } from "./use-task-looks.js";

/**
 * Where a Browser tab is offered: the side panel's "+" lists New Browser tab
 * under Browser while the account has the Browser tab experiment on, and a
 * pick opens one; with it off, the "+" offers none, as a feature still behind
 * Settings › Experimental stands nowhere. A synthetic plan throughout.
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

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined }),
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

/** The plan drawn with its side panel open on its Board, answering how many Browser tabs the panel was asked to open. */
async function mount(): Promise<{ readonly opened: () => number }> {
  let opened = 0;
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
    mainTabs: { ...base.mainTabs, tabs: [MAIN_TAB.CALL], tab: MAIN_TAB.CALL },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      tab: SIDE_PANEL_TAB.BOARD,
      onOpenBrowser: () => {
        opened += 1;
      },
    },
    agents: codingAgentsControl({ agents: [], agentIds: [] }),
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
  return { opened: () => opened };
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
