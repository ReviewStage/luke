// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskBlockRelation,
  type TaskRelationChangeRequest,
  type TaskSummary,
} from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handMembers } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { PlanRelations } from "./plan-relations.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACME = {
  id: DOCUMENT_TASK.workspaceId,
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  fakeActPort({});
  handMembers(() => ({ rows: { members: [] } }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function summary(id: string, number: number, parentTaskId?: string): TaskSummary {
  return {
    id,
    workspaceId: ACME.id,
    name: `Task ${number}`,
    repository: null,
    createdAt: number,
    updatedAt: number,
    status: TASK_STATUS.TODO,
    priority: TASK_PRIORITY.NONE,
    number,
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  };
}

function draw(
  listed: readonly TaskSummary[],
  blocks: { blockedBy?: string[]; blocks?: string[] },
  sent: { changes: TaskRelationChangeRequest[]; removed: [TaskBlockRelation, string][] },
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const tasks = tasksControl({
    tasks: [...listed],
    workspace: ACME,
    workspaces: [ACME],
    listRead: true,
    onChangeTaskRelation: (_taskId, change) => sent.changes.push(change),
    onRemoveTaskBlock: (_taskId, relation, otherId) => sent.removed.push([relation, otherId]),
  });
  const task = { ...DOCUMENT_TASK, ...blocks };
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(PlanRelations, {
          task,
          tasks,
          door: { workspaceName: ACME.name, tasks: listed },
          room: { scroller: { current: container }, column: { current: container } },
          onOpenTask: tasks.onSelect,
        }),
      ),
    ),
  );
  return container;
}

function rowIds(container: HTMLElement, list: string): (string | null)[] {
  return [...container.querySelectorAll(`ul[aria-label='${list}'] > li[data-task-id]`)].map((row) =>
    row.getAttribute("data-task-id"),
  );
}

test("a sub-task's own stand under it once its fold opens, and a task with no relations draws no Task relations group", () => {
  const sent = { changes: [], removed: [] };
  const container = draw(
    [summary("t-2", 2, DOCUMENT_TASK.id), summary("t-3", 3, "t-2"), summary("t-4", 4)],
    {},
    sent,
  );

  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2"]);
  assert.equal(container.querySelector("ul[aria-label='Task relations']"), null);

  act(() =>
    container.querySelector<HTMLButtonElement>("button[aria-label='Sub-tasks of Task 2']")?.click(),
  );
  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2", "t-3"]);
});

test("a relation stands while the list does not hold its task, and picking another kind on its pill moves it in one call, and Remove relation takes the block away", () => {
  const sent: { changes: TaskRelationChangeRequest[]; removed: [TaskBlockRelation, string][] } = {
    changes: [],
    removed: [],
  };
  const container = draw([summary("t-5", 5)], { blockedBy: ["t-5"], blocks: ["t-9"] }, sent);
  assert.equal(container.querySelector("ul[aria-label='Sub-tasks']"), null);
  assert.deepEqual(rowIds(container, "Task relations"), ["t-5", "t-9"]);
  const unlisted = container.querySelector("li[data-task-id='t-9']");
  assert.equal(
    unlisted?.querySelector("[data-cell='status'] button"),
    null,
    "a task not listed yet offers no status to change",
  );
  const pill = () =>
    container.querySelector<HTMLButtonElement>("button[aria-label='Relation: Blocked by']");

  act(() => pill()?.click());
  const blocks = [...document.querySelectorAll<HTMLElement>("[role='option']")].find(
    (option) => option.textContent?.includes("Blocks") && !option.textContent.includes("Blocked"),
  );
  assert.ok(blocks, "the menu offers Blocks");
  act(() => blocks.click());
  assert.deepEqual(sent.changes, [{ taskId: "t-5", from: "blocked-by", to: "blocks" }]);
  assert.deepEqual(sent.removed, []);

  act(() => pill()?.click());
  const remove = [...document.querySelectorAll<HTMLElement>("button, [role='option']")].find(
    (each) => each.textContent?.trim() === "Remove relation",
  );
  assert.ok(remove, "the menu offers Remove relation");
  act(() => remove.click());
  assert.deepEqual(sent.removed, [["blocked-by", "t-5"]]);
});
