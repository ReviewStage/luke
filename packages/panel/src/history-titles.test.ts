import assert from "node:assert/strict";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { test } from "vitest";
import { stepTitle } from "./history-titles.js";
import { PANEL_TAB } from "./panel-tabs.js";
import { SIDE_PANEL_TAB } from "./tasks/use-side-panel.js";
import type { InboxChoice } from "./tasks/use-tasks-tab.js";
import { tasksControl } from "./testing/tasks-control.js";

/**
 * history-titles.test.ts -- each step of the history is named as Back's menu
 * lists it: a task by its name with the tabs it showed, the Inbox with the
 * task its item is of, and every other page by what the window's title
 * calls it.
 */

const TASK = {
  id: "task-1",
  workspaceId: "workspace-acme",
  name: "Auth refactor",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
};

/** The window on the task, its side panel open on the tab given or shut. */
function onTask(
  side: (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB] | { file: string } | undefined,
) {
  const base = tasksControl();
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [TASK],
    activeTaskId: TASK.id,
    boundFor: TASK.id,
    sidePanel: { ...base.sidePanel, open: side !== undefined, tab: side ?? SIDE_PANEL_TAB.PLAN },
  });
}

test("a task's step is named by the task, with the side panel's tab while it is open", () => {
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, onTask(SIDE_PANEL_TAB.CODE)), {
    label: "Auth refactor",
    detail: "Code",
    panes: { column: undefined, side: "Code" },
  });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, onTask({ file: "apps/web/session-store.ts" })), {
    label: "Auth refactor",
    detail: "session-store.ts",
    panes: { column: undefined, side: "session-store.ts" },
  });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, onTask(undefined)), {
    label: "Auth refactor",
    detail: undefined,
  });
});

test("a task on its way, its strips still another's, is named by the task alone", () => {
  const opening = { ...onTask(SIDE_PANEL_TAB.CODE), activeTaskId: "task-before" };
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, opening), { label: "Auth refactor" });
});

test("the Inbox's step names the task its item is of, and Settings and a new account's welcome are named alone", () => {
  const chosen: InboxChoice = { itemId: "item-1", taskId: TASK.id };
  const base = tasksControl({ tasks: [TASK] });
  const inbox = tasksControl({
    tasks: [TASK],
    inboxView: { ...base.inboxView, open: true, chosen },
  });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, inbox), { label: "Inbox", detail: "Auth refactor" });
  assert.deepEqual(stepTitle(PANEL_TAB.SETTINGS, base), { label: "Settings" });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, base), { label: "Welcome" });
});

test("an Inbox showing one column names no item while its list stands, as its step holds none", () => {
  const chosen: InboxChoice = { itemId: "item-1", taskId: TASK.id };
  const base = tasksControl({ tasks: [TASK] });
  const listed = tasksControl({
    tasks: [TASK],
    inboxView: { ...base.inboxView, open: true, chosen, single: true, listed: true },
  });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, listed), { label: "Inbox", detail: undefined });
  const narrowListed = tasksControl({
    tasks: [TASK],
    inboxView: { ...base.inboxView, open: true, chosen, listed: true },
  });
  assert.deepEqual(stepTitle(PANEL_TAB.TASKS, narrowListed, true), {
    label: "Inbox",
    detail: undefined,
  });
});
