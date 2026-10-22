// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import {
  BROWSER_TAB_OPEN_FAILURE,
  type TasksBrowserTabOpenParams,
} from "@luke/features/tasks-view";
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
 * offers New tab in the agent's browser too, which asks for an address and
 * whose browser, opens the tab through the host, and lands on it, already
 * taken over by the member; a refusal stays up in words. A synthetic plan
 * and agents throughout.
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

/** The tab the service answers an open with, taken over by the member. */
const OPENED: AgentBrowserTab = {
  id: "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
  agentId: AGENT.id,
  address: "http://localhost:3000/",
  title: "http://localhost:3000/",
  openedBy: { kind: "member", userId: "user-ada" },
  driver: { userId: "user-ada", heldUntil: 62_000 },
  createdAt: 5,
  lastActedAt: 5,
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
    mainTabs: { ...base.mainTabs, tabs: [], tab: undefined },
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

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The open dialog's address field and its Open tab press. */
function openDialog(): { readonly field: HTMLInputElement; readonly open: HTMLButtonElement } {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog, "the dialog asking for an address");
  const field = dialog.querySelector<HTMLInputElement>("input");
  const open = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Open tab",
  );
  assert.ok(field && open, "its address and its Open tab");
  return { field, open };
}

test("on a task with a coding agent, the panel's + offers a new tab in its browser, which opens one at the address typed and lands on it, taken over", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const asked: TasksBrowserTabOpenParams[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      return Promise.resolve({ tab: OPENED });
    },
  });
  const task = await mount([AGENT]);

  const rows = await browserRows();
  assert.deepEqual(rowWords(rows), ["New Browser tab", "New tab in Invite expiry's browser"]);
  await act(async () => rows[1]?.click());
  await settle();
  const { field, open } = openDialog();
  type(field, "localhost:3000");
  await act(async () => open.click());
  await settle();

  assert.deepEqual(asked, [
    { taskId: TASK.id, agentId: AGENT.id, address: "http://localhost:3000/" },
  ]);
  assert.deepEqual(task.chosen, [{ cloudBrowser: OPENED.id }]);
  assert.equal(document.querySelector('[role="dialog"]'), null, "the dialog is put away");
});

test("with several agents, the dialog opens in the browser of the agent chosen, and a refusal stays up in words", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const asked: TasksBrowserTabOpenParams[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      return Promise.resolve({ failure: BROWSER_TAB_OPEN_FAILURE.NOT_READY });
    },
  });
  const task = await mount([AGENT, OTHER_AGENT]);

  const rows = await browserRows();
  assert.deepEqual(rowWords(rows), ["New Browser tab", "New tab in Invite expiry's browser"]);
  await act(async () => rows[1]?.click());
  await settle();
  const agent = document.querySelector<HTMLButtonElement>(
    '[role="dialog"] button[aria-label^="Agent"]',
  );
  assert.equal(agent?.getAttribute("aria-label"), "Agent: Invite expiry", "the agent viewed first");
  await act(async () => agent?.click());
  const other = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((item) =>
    item.textContent?.includes("Invite emails"),
  );
  assert.ok(other, "the other agent to choose");
  await act(async () => other.click());
  await settle();
  const { field, open } = openDialog();
  type(field, "https://accounts.test/sign-in");
  await act(async () => open.click());
  await settle();

  assert.deepEqual(asked, [
    { taskId: TASK.id, agentId: OTHER_AGENT.id, address: "https://accounts.test/sign-in" },
  ]);
  assert.deepEqual(task.chosen, []);
  assert.match(
    document.querySelector('[role="dialog"]')?.textContent ?? "",
    /Invite emails hasn't opened its sandbox yet/,
  );
});

test("with the experiment off, the panel's + offers no tab in an agent's browser", async () => {
  handState({});
  await mount([AGENT]);

  assert.deepEqual(await browserRows(), []);
});
