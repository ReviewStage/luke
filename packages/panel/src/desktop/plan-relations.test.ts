// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskBlockRelation,
  type TaskRelationChangeRequest,
  type TaskSummary,
} from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { PlanRelations } from "./plan-relations.js";

/**
 * plan-relations.test.ts -- the open task's Sub-tasks and Relations groups:
 * a sub-task's own nested under it once its fold opens, a group drawn only
 * while it holds a row, and a relation's kind moved from its pill in one
 * call, never a block taken away and added again, and Remove relation
 * taking the block away through the door that offers Undo. Synthetic tasks.
 */

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
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]) });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A task of the workspace, `id`, standing under `parentTaskId` where one is named. */
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

/** Draws the groups for the open task, its blocks as given, over `listed`, its sends kept in `sent`. */
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
        }),
      ),
    ),
  );
  return container;
}

/** The ids of the rows a group's list draws, in order. */
function rowIds(container: HTMLElement, list: string): (string | null)[] {
  return [...container.querySelectorAll(`ul[aria-label='${list}'] > li[data-task-id]`)].map((row) =>
    row.getAttribute("data-task-id"),
  );
}

test("a sub-task's own stand under it once its fold opens, and a task with no relations draws no Relations group", () => {
  const sent = { changes: [], removed: [] };
  const container = draw(
    [summary("t-2", 2, DOCUMENT_TASK.id), summary("t-3", 3, "t-2"), summary("t-4", 4)],
    {},
    sent,
  );

  assert.deepEqual(rowIds(container, "Sub-tasks"), ["t-2"]);
  assert.equal(container.querySelector("ul[aria-label='Relations']"), null);

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
  // Note that a task the list does not hold yet still stands, so a list still read hides no relation.
  assert.deepEqual(rowIds(container, "Relations"), ["t-5", "t-9"]);
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
