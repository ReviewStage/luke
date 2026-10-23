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
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./use-side-panel.js";
import { NO_LOOKS } from "./use-task-looks.js";

/**
 * Where a Browser tab is offered: the side panel's "+" lists New Browser tab
 * under Browser while the account has the Browser tab experiment on and the
 * task has a coding agent, always in an agent's cloud browser: one agent's
 * at once, and with several, a submenu of whose, the one viewed first. A
 * pick lands on a draft, which opens nothing until its bar's Enter
 * (`cloud-browser-tab.test.ts`). With no agent, or the experiment off, the
 * "+" offers none. A synthetic plan and agents throughout.
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
  strip?: readonly SidePanelTab[],
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
      ...(strip === undefined ? undefined : { strip }),
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

test("on a task with no coding agent, the panel's + offers no Browser tab, and none with the experiment off", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  await mount();
  assert.deepEqual(await browserRows(), []);

  for (const root of roots.splice(0)) act(() => root.unmount());
  handState({});
  await mount([AGENT]);
  assert.deepEqual(await browserRows(), []);
});

/** The words of the rows under Browser. */
function rowWords(rows: readonly HTMLElement[]): readonly (string | null | undefined)[] {
  return rows.map((row) => row.querySelector(".luke-combobox-option-label")?.textContent);
}

/** Whether a draft cloud Browser tab is among the tabs the panel was asked to show. */
function landedOnDraft(chosen: readonly SidePanelTab[]): boolean {
  return chosen.some(
    (tab) => tab instanceof Object && "cloudBrowser" in tab && tab.cloudBrowser.length > 0,
  );
}

test("on a task with one coding agent, the panel's + New Browser tab drafts a tab in its browser at once, with no submenu, and opens nothing", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const asked: unknown[] = [];
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TAB_OPEN]: (payload) => {
      asked.push(payload);
      return Promise.resolve({ failure: BROWSER_TAB_OPEN_FAILURE.UNANSWERED });
    },
  });
  const task = await mount([AGENT]);

  const rows = await browserRows();
  assert.deepEqual(rowWords(rows), ["New Browser tab"]);
  await act(async () => rows[0]?.click());
  await settle();

  assert.deepEqual(submenuChoices(), [], "no submenu stands");
  assert.ok(landedOnDraft(task.chosen), "the panel lands on a draft cloud Browser tab");
  assert.equal(task.opened(), 0, "the Mac's own Browser tab is never opened");
  assert.deepEqual(asked, [], "nothing opens in the agent's sandbox until the draft's Enter");
});

/** The choices of the submenu standing open beside a row of the "+". */
function submenuChoices(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.task-compose-submenu [role="option"]')];
}

test("on a task with several coding agents, the panel's + New Browser tab opens a submenu of the agents alone, the one viewed first, and an agent drafts a tab in its browser and opens nothing", async () => {
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
  assert.deepEqual(rowWords(rows), ["New Browser tab"]);
  const [row] = rows;
  assert.ok(row, "the one row");
  // Choosing the row opens its submenu rather than a tab.
  await act(async () => row.click());
  await settle();
  assert.deepEqual(task.chosen, []);
  const choices = submenuChoices();
  assert.deepEqual(rowWords(choices), ["Invite emails", "Invite expiry"]);

  await act(async () => choices[1]?.click());
  await settle();
  assert.ok(landedOnDraft(task.chosen), "the panel lands on a draft cloud Browser tab");
  assert.equal(task.opened(), 0, "the Mac's own Browser tab is never opened");
  assert.deepEqual(asked, [], "nothing opens in the agent's sandbox until the draft's Enter");
});

test("a cloud Browser tab wears its agent's glyph in the strip and hangs a card naming the agent's browser and the page's address", async () => {
  handState(experimentsOn(EXPERIMENT.BROWSER));
  const tab = {
    id: "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b",
    agentId: OTHER_AGENT.id,
    address: "https://accounts.test/sign-in",
    title: "Sign in",
    openedBy: { kind: "member", userId: "user-ada" },
    driver: null,
    createdAt: 5,
    lastActedAt: 5,
  } as const;
  const held = {
    next: () => new Promise<never>(() => undefined),
    return: async () => ({ done: true, value: undefined }) as const,
    [Symbol.asyncIterator]() {
      return held;
    },
    [Symbol.asyncDispose]: async () => undefined,
  };
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TABS]: () => Promise.resolve({ tabs: [tab] }),
    // SAFETY: the window reads oRPC's stream as an async iterator alone, which this is.
    [ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: () => Promise.resolve(held as never),
  });
  await mount([AGENT, OTHER_AGENT], undefined, [SIDE_PANEL_TAB.BOARD, { cloudBrowser: tab.id }]);

  const drawn = [...document.querySelectorAll<HTMLElement>('.side-panel-tabs [role="tab"]')].find(
    (each) => each.textContent?.includes("Sign in"),
  );
  assert.ok(drawn, "the cloud tab stands in the strip, named by its page");
  assert.ok(!drawn.textContent?.includes("Invite emails"), "the strip names no agent in words");
  assert.ok(drawn.querySelector(".harness-mark"), "it wears its agent's glyph");
  restOn(drawn);
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Sign in");
  assert.equal(
    card?.querySelector(".luke-hover-card-sub")?.textContent,
    "In Invite emails' browser",
  );
  assert.equal(
    card?.querySelector(".luke-hover-card-note")?.textContent,
    "https://accounts.test/sign-in",
  );
});
