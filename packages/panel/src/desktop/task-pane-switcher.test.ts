// @vitest-environment jsdom

import assert from "node:assert/strict";
import { pageFrameUrl } from "@luke/features/page-frame";
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
 * task-pane-switcher.test.ts -- a phone's task is headed by one row, the way back, the title of what is on screen, and one ⋯ whose menu leads with Plan, Agents, and Activity: each view reads what the panel holds, Activity lists every tab but the plan's and shows the one pressed, a tab shown names the row and leads back to the list, and a wide window keeps its strip and toolbar.
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

/** A page an agent showed on the plan, whose tab offers a link to itself. */
const PAGE = {
  id: "5d0c1f2e-7a3b-4c9d-8e1f-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 1,
  at: 1,
};

beforeEach(() => {
  fakeAppPlatform({ ...QUIET_PANEL, pageFrameUrl });
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

/** The task's page in `room`, its panel open on `tab` over the plan, the Inbox, and the board, and a page of the plan's where `paged`, every press on the panel, the way out, and a rename told; `draw` draws it again over a panel opened or shut on another tab. */
function mount(
  room: ShellRoom,
  open = true,
  tab: SidePanelTab | undefined = SIDE_PANEL_TAB.PLAN,
  paged = false,
) {
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
            away: { label: "Inbox", onPress: () => told.push("away") },
            tasks: tasksControl({
              page: TASKS_PAGE.DOCUMENT,
              activeTaskId: TASK.id,
              region: { kind: DOCUMENT_REGION.READY, task: TASK },
              pages: paged ? [PAGE] : undefined,
              onRenameTask: (taskId, name) => {
                told.push(`rename ${taskId} ${name}`);
                return Promise.resolve(true);
              },
              sidePanel: {
                ...tasksControl().sidePanel,
                open: shown,
                fullScreen: shown && narrow,
                fullScreenOnly: shown && narrow,
                tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.BOARD],
                strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX, SIDE_PANEL_TAB.BOARD],
                pages: paged ? [{ page: PAGE.id }] : [],
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
  const more = () => {
    const found = container.querySelector<HTMLButtonElement>(
      '.task-head [aria-label="Task actions"]',
    );
    assert.ok(found, "the row holds its ⋯");
    return found;
  };
  // The ⋯'s menu, opened to be read and closed again by the press that opened it.
  const menu = () => {
    act(() => more().click());
    const groups = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].map(
      (each) =>
        `${each.getAttribute("aria-checked") === "true" ? "*" : ""}${each.textContent ?? ""}`,
    );
    act(() => more().click());
    return groups;
  };
  const views = () =>
    menu().filter((each) => ["Plan", "Agents", "Activity"].includes(each.replace(/^\*/, "")));
  const choose = (name: string) => {
    act(() => more().click());
    const found = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].find(
      (each) => each.textContent === name,
    );
    assert.ok(found, `the ⋯ offers ${name}`);
    act(() => found.click());
  };
  const head = () => ({
    buttons: [...container.querySelectorAll(".task-head button")].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    title: container.querySelector(".task-head h1")?.textContent,
  });
  const back = () => {
    const found = container.querySelector<HTMLButtonElement>(
      ".task-head .luke-toolbar-lead button",
    );
    assert.ok(found, "the row leads with its way back");
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
  const labelled = (label: string) =>
    [...container.querySelectorAll("button")].some(
      (each) => each.getAttribute("aria-label") === label,
    );
  return { container, told, menu, views, choose, head, back, rows, row, close, draw, labelled };
}

test("on a phone a task is headed by one row, the way back named for the page it came from, the task's title, and one ⋯, whose menu leads with its views over the task's own actions", () => {
  const page = mount(SHELL_ROOM.NARROW);
  assert.deepEqual(page.head(), { buttons: ["Back to Inbox", "Task actions"], title: TASK.name });
  assert.deepEqual(page.views(), ["*Plan", "Agents", "Activity"]);
  const menu = page.menu();
  assert.deepEqual(menu.slice(0, 3), ["*Plan", "Agents", "Activity"], "the views come first");
  assert.ok(menu.includes("Rename") && menu.includes("Permanently delete"), "then the task's own");
  assert.ok(
    page.container.querySelector(".side-panel[data-pane-switch]"),
    "the panel's bar gives way to the row",
  );
  assert.equal(page.labelled("Title actions"), false, "the plan's title draws no second ⋯");
  assert.equal(
    page.labelled(`${TASK.name} actions`),
    false,
    "the panel draws no ⋯ of the plan's tab",
  );

  page.back();
  assert.deepEqual(page.told, ["away"], "the way back goes where the shell says, pushing nothing");
});

test("on a phone Activity lists every tab but the plan's, a press showing it", () => {
  const page = mount(SHELL_ROOM.NARROW);
  assert.deepEqual(page.rows(), [], "no list until Activity is asked for");

  page.choose("Activity");
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);
  assert.equal(page.head().title, TASK.name, "the list is the task's, which names the row");

  page.row("Board");
  assert.deepEqual(page.told, [`choose ${SIDE_PANEL_TAB.BOARD}`]);
  assert.deepEqual(page.rows(), [], "the list gives way to the tab pressed");
});

test("on a phone Agents shuts the panel by its own toggle, and Activity opens a shut one on its list", () => {
  const open = mount(SHELL_ROOM.NARROW);
  open.choose("Agents");
  assert.deepEqual(open.told, ["toggle"]);
  document.body.innerHTML = "";

  const shut = mount(SHELL_ROOM.NARROW, false);
  assert.deepEqual(shut.views(), ["Plan", "*Agents", "Activity"]);
  assert.deepEqual(shut.head(), { buttons: ["Back to Inbox", "Task actions"], title: TASK.name });
  assert.equal(
    shut.container.querySelectorAll('[aria-label="Task actions"]').length,
    1,
    "the agents' column's toolbar draws no second ⋯ of the task's",
  );
  shut.choose("Activity");
  assert.deepEqual(shut.told, ["toggle"]);
});

test("on a phone Activity closes a tab from its row, as the strip's × did, without showing it", () => {
  const page = mount(SHELL_ROOM.NARROW);
  page.choose("Activity");
  page.close("Board");
  assert.deepEqual(page.told, [`close ${SIDE_PANEL_TAB.BOARD}`]);
});

test("on a phone Activity asked over a shut panel lists the tabs whatever tab the panel opens on, as one with every tab closed chooses as it opens", async () => {
  const page = mount(SHELL_ROOM.NARROW, false, undefined);
  page.choose("Activity");
  assert.deepEqual(page.told, ["toggle"]);
  page.draw(true, SIDE_PANEL_TAB.PLAN);
  await act(async () => undefined);
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);
});

test("on a phone a tab chosen from Activity names the row and leads it back to the list, and the ⋯ still leads with the views", () => {
  const page = mount(SHELL_ROOM.NARROW, true, SIDE_PANEL_TAB.BOARD);
  assert.deepEqual(page.head(), { buttons: ["Back to Activity", "Task actions"], title: "Board" });
  assert.deepEqual(page.views(), ["Plan", "Agents", "*Activity"]);

  page.back();
  assert.deepEqual(page.rows(), ["Inbox", "Board"]);
  assert.deepEqual(
    page.head(),
    { buttons: ["Back to Inbox", "Task actions"], title: TASK.name },
    "on the list the row names the task again and leads out of it",
  );
  assert.deepEqual(page.told, [], "going back to the list leaves the panel's tab as it stands");
});

test("on a phone the ⋯ offers what the tab shown offers on what it shows, between the views and the task's own actions", () => {
  const page = mount(SHELL_ROOM.NARROW, true, { page: PAGE.id }, true);
  assert.equal(page.head().title, PAGE.title);
  const menu = page.menu();
  // Note that each of the tab's items says under it what it acts on, so its Copy link is told from the task's.
  const link = menu.indexOf(`Copy link${PAGE.title}`);
  assert.ok(link > menu.indexOf("Activity"), "after the views");
  assert.ok(link < menu.indexOf("Copy plan"), "before the task's own");
  assert.ok(menu.includes("Copy link"), "the task's own Copy link stands under it");
});

test("on a phone the ⋯'s Rename edits the task's name in the row's title", async () => {
  const page = mount(SHELL_ROOM.NARROW);
  page.choose("Rename");
  const field = page.container.querySelector<HTMLInputElement>(
    '.task-head input[aria-label="Task name"]',
  );
  assert.ok(field, "the title is the name's field");
  field.value = "Invite teammates";
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.deepEqual(page.told, [`rename ${TASK.id} Invite teammates`]);
});

test("a wide window keeps the panel's strip and the column's toolbar, and draws no row of a phone's", () => {
  const page = mount(SHELL_ROOM.WIDE);
  assert.equal(page.container.querySelector(".task-head"), null);
  assert.equal(page.container.querySelector(".side-panel[data-pane-switch]"), null);
  assert.ok(page.labelled("Task actions"), "the column's toolbar keeps the task's ⋯");
});

test("on a phone the ⋯'s Rename on a tab opens the task's name in the title's place, the tab hiding the plan's own title", async () => {
  const page = mount(SHELL_ROOM.NARROW, true, SIDE_PANEL_TAB.BOARD);
  assert.equal(page.head().title, "Board");
  page.choose("Rename");
  const field = page.container.querySelector<HTMLInputElement>(
    '.task-head input[aria-label="Task name"]',
  );
  assert.equal(field?.value, TASK.name);
});
