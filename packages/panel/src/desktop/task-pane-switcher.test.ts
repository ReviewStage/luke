// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";
import { TASK_PANE, taskPaneOf } from "./task-pane-switcher.js";

/** The buttons Activity's rows offer beside their press. */
function page(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '.side-panel-activity ul[aria-label="Activity"] button:not(.luke-list-row-main)',
    ),
  ];
}

/**
 * task-pane-switcher.test.ts -- a phone's task is headed by Plan, Agents, and Activity in place of the side panel's strip: each view reads what the panel holds, Activity lists every tab but the plan's and shows the one pressed, and a wide window keeps its strip.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  handState({});
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

test("the view standing follows the panel: Agents while it is shut, Plan on the plan, and Activity on its list or any other tab", () => {
  assert.equal(
    taskPaneOf({ open: false, tab: SIDE_PANEL_TAB.PLAN, listed: true }),
    TASK_PANE.AGENTS,
  );
  assert.equal(taskPaneOf({ open: true, tab: SIDE_PANEL_TAB.PLAN, listed: false }), TASK_PANE.PLAN);
  assert.equal(
    taskPaneOf({ open: true, tab: SIDE_PANEL_TAB.PLAN, listed: true }),
    TASK_PANE.ACTIVITY,
  );
  assert.equal(
    taskPaneOf({ open: true, tab: SIDE_PANEL_TAB.BOARD, listed: false }),
    TASK_PANE.ACTIVITY,
  );
});

/** The task's page in `room`, its panel open on `tab` over the plan, the Inbox, and the board, every press on the panel told; `draw` draws it again over a panel opened or shut on another tab. */
function mount(room: ShellRoom, open = true, tab: SidePanelTab | undefined = SIDE_PANEL_TAB.PLAN) {
  const told: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const narrow = room === SHELL_ROOM.NARROW;
  const registry = AtomRegistry.make();
  const draw = (shown: boolean, on: SidePanelTab | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            room,
            tasks: tasksControl({
              page: TASKS_PAGE.DOCUMENT,
              activeTaskId: TASK.id,
              region: { kind: DOCUMENT_REGION.READY, task: TASK },
              sidePanel: {
                ...tasksControl().sidePanel,
                open: shown,
                fullScreen: shown && narrow,
                fullScreenOnly: shown && narrow,
                tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.BOARD],
                strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.BOARD],
                tab: on,
                onChoose: (chosen) => told.push(`choose ${String(chosen)}`),
                onToggle: () => told.push("toggle"),
                onClose: (closed) => told.push(`close ${String(closed)}`),
              },
            }),
          }),
        ),
      ),
    );
  draw(open, tab);
  const views = () =>
    [...container.querySelectorAll<HTMLElement>('.task-pane-switcher [role="radio"]')].map(
      (each) => `${each.getAttribute("aria-checked") === "true" ? "*" : ""}${each.textContent}`,
    );
  const view = (name: string) => {
    const found = [
      ...container.querySelectorAll<HTMLElement>('.task-pane-switcher [role="radio"]'),
    ].find((each) => each.textContent === name);
    assert.ok(found, `the switcher offers ${name}`);
    act(() => found.click());
  };
  const rows = () =>
    [
      ...container.querySelectorAll(
        '.side-panel-activity ul[aria-label="Activity"] .luke-list-row-title',
      ),
    ].map((each) => each.textContent);
  const row = (name: string) => {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '.side-panel-activity ul[aria-label="Activity"] .luke-list-row-main',
      ),
    ].find((each) => each.textContent?.includes(name));
    assert.ok(found, `Activity lists ${name}`);
    act(() => found.click());
  };
  const close = (name: string) => {
    const found = page(container).find(
      (each) => each.getAttribute("aria-label") === `Close ${name}`,
    );
    assert.ok(found, `Activity offers to close ${name}`);
    act(() => found.click());
  };
  return { container, told, views, view, rows, row, close, draw };
}

test("on a phone a task is headed by its three views, Plan standing over the plan, and Activity lists every tab but the plan's, a press showing it", () => {
  const page = mount(SHELL_ROOM.NARROW);
  assert.deepEqual(page.views(), ["*Plan", "Agents", "Activity"]);
  assert.ok(
    page.container.querySelector(".side-panel[data-pane-switch]"),
    "the panel's strip gives way to the views",
  );
  assert.deepEqual(page.rows(), [], "no list until Activity is asked for");

  page.view("Activity");
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);

  page.row("Board");
  assert.deepEqual(page.told, [`choose ${SIDE_PANEL_TAB.BOARD}`]);
  assert.deepEqual(page.rows(), [], "the list gives way to the tab pressed");
});

test("on a phone Agents shuts the panel by its own toggle, and Activity opens a shut one on its list", () => {
  const open = mount(SHELL_ROOM.NARROW);
  open.view("Agents");
  assert.deepEqual(open.told, ["toggle"]);
  document.body.innerHTML = "";

  const shut = mount(SHELL_ROOM.NARROW, false);
  assert.deepEqual(shut.views(), ["Plan", "*Agents", "Activity"]);
  shut.view("Activity");
  assert.deepEqual(shut.told, ["toggle"]);
});

test("on a phone Activity closes a tab from its row, as the strip's × did, without showing it", () => {
  const page = mount(SHELL_ROOM.NARROW);
  page.view("Activity");
  page.close("Board");
  assert.deepEqual(page.told, [`close ${SIDE_PANEL_TAB.BOARD}`]);
});

test("on a phone Activity asked over a shut panel lists the tabs whatever tab the panel opens on, as one with every tab closed chooses as it opens", async () => {
  const page = mount(SHELL_ROOM.NARROW, false, undefined);
  page.view("Activity");
  assert.deepEqual(page.told, ["toggle"]);
  page.draw(true, SIDE_PANEL_TAB.PLAN);
  await act(async () => undefined);
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);
});

test("on a phone a tab chosen from Activity leads the panel's bar with the way back to the list", () => {
  const page = mount(SHELL_ROOM.NARROW, true, SIDE_PANEL_TAB.BOARD);
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);
  const back = [
    ...page.container.querySelectorAll<HTMLButtonElement>(".side-panel-bar button"),
  ].find((each) => each.textContent === "Activity");
  assert.ok(back, "the bar leads with Activity");
  act(() => back.click());
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);
});

test("a wide window keeps the panel's strip and draws no views", () => {
  const page = mount(SHELL_ROOM.WIDE);
  assert.equal(page.container.querySelector(".task-pane-switcher"), null);
  assert.equal(page.container.querySelector(".side-panel[data-pane-switch]"), null);
});
