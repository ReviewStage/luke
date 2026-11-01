// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type Task,
  type TaskSummary,
} from "@luke/features/task-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import type { TaskRelationAsk, TaskRelationDoor } from "./task-relation-menu.js";
import { TaskStandingChips } from "./task-standing.js";

/**
 * task-relation-menu.test.ts -- the add menu, as the task's head opens it on
 * an ask from the task's menus or ⌘K: a pick is sent as the relation its kind
 * names, the task and the one picked each on their own side, and a task that
 * cannot take the kind is listed dimmed with why.
 */

const TASK: Task = {
  id: "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60",
  workspaceId: "workspace-acme",
  name: "Fix Safari login cookie",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  status: TASK_STATUS.TODO,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  parentTaskId: "1a2b3c4d-0000-4000-8000-000000000001",
  document: { body: "", assumptions: [] },
};

/** A task of the workspace beside it, by id, name, and repository. */
function summary(
  id: string,
  name: string,
  repository: string | null,
  parent?: string,
): TaskSummary {
  return {
    id,
    workspaceId: TASK.workspaceId,
    name,
    createdAt: 1,
    updatedAt: 1,
    repository,
    ...(parent === undefined ? {} : { parentTaskId: parent }),
  };
}

const ROOT = summary("1a2b3c4d-0000-4000-8000-000000000000", "Ship login", "acme/web");
const PARENT = summary("1a2b3c4d-0000-4000-8000-000000000001", "Cookies", "acme/web", ROOT.id);
const PEER = summary("1a2b3c4d-0000-4000-8000-000000000002", "Docs pass", "acme/web");
const ELSEWHERE = summary("1a2b3c4d-0000-4000-8000-000000000003", "API rate limit", "acme/api");

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Draws the task's head with its relations' door, answering each ask as it stands; drawing again hands the head the next ask. */
function head(door: TaskRelationDoor, task: Task = TASK): (ask: TaskRelationAsk) => void {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  return (ask) =>
    act(() =>
      root.render(
        createElement(TaskStandingChips, {
          task,
          onSet: undefined,
          relations: { ...door, ask },
        }),
      ),
    );
}

/** The menu's row for the task `name`. */
function row(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.startsWith(name),
    ) ?? assert.fail(`no row ${name}`)
  );
}

const DOOR = {
  workspaceName: "Acme",
  tasks: [ROOT, PARENT, PEER, ELSEWHERE, { ...summary(TASK.id, TASK.name, TASK.repository) }],
  onChange: () => undefined,
};

test("a pick on Parent sets the task's parent to it, and on Sub-task sets its parent to the task", () => {
  const parents: [string, string | null][] = [];
  const ask = head({
    ...DOOR,
    onSetParent: (taskId, parentTaskId) => parents.push([taskId, parentTaskId]),
  });

  ask({ kind: TASK_RELATION_KIND.PARENT, request: 1 });
  act(() => row("Docs pass").click());
  ask({ kind: TASK_RELATION_KIND.SUB_TASK, request: 2 });
  act(() => row("Docs pass").click());

  assert.deepEqual(parents, [
    [TASK.id, PEER.id],
    [PEER.id, TASK.id],
  ]);
});

/** The pinned New task row, which opens New task related to this task. */
function newTaskRow(): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[data-steered="true"]')].find(
      (each) => each.textContent === "New task",
    ) ?? assert.fail("no New task row")
  );
}

test("on Sub-task a task above this one or in another repository says why and takes no pick", () => {
  const parents: string[] = [];
  const ask = head({ ...DOOR, onSetParent: (taskId) => parents.push(taskId) });

  ask({ kind: TASK_RELATION_KIND.SUB_TASK, request: 1 });

  assert.match(row("Ship login").textContent ?? "", /A parent of this task/u);
  assert.match(row("API rate limit").textContent ?? "", /Another repository/u);
  act(() => row("Ship login").click());
  act(() => row("API rate limit").click());
  assert.deepEqual(parents, []);
});

test("New task opens New task from the new task's side: on Sub-task as a sub-task of this task, on Blocked by as one blocking it", () => {
  const asked: string[] = [];
  const ask = head({
    ...DOOR,
    onSetParent: () => undefined,
    onNewTask: (kind) => asked.push(kind),
  });

  ask({ kind: TASK_RELATION_KIND.SUB_TASK, request: 1 });
  act(() => newTaskRow().click());
  ask({ kind: TASK_RELATION_KIND.BLOCKED_BY, request: 2 });
  act(() => newTaskRow().click());

  assert.deepEqual(asked, ["sub-task-of", "blocks"]);
});

test("a task from a service before statuses, which draws no chips, still opens the add menu on an ask", () => {
  const parents: [string, string | null][] = [];
  const { status: _status, priority: _priority, ...before } = TASK;
  const ask = head(
    { ...DOOR, onSetParent: (taskId, parentTaskId) => parents.push([taskId, parentTaskId]) },
    before,
  );

  ask({ kind: TASK_RELATION_KIND.PARENT, request: 1 });
  act(() => row("Docs pass").click());

  assert.deepEqual(parents, [[TASK.id, PEER.id]]);
});
