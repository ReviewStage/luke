// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_MODE, TASK_STATUS, type Task, type TaskSummary } from "@luke/features/task-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PlanBreakdown } from "./plan-breakdown.js";

/**
 * plan-breakdown.test.ts -- a pilot tree's top task lists the child tasks
 * waiting to start while its Running switch is off, pointing at the switch
 * and offering no answer of its own, and the list goes once Running is on.
 */

const PARENT = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const CHILDREN: readonly TaskSummary[] = ["Schema", "Sidebar nesting"].map((name, index) => ({
  id: `00000000-0000-4000-8000-00000000000${String(index + 1)}`,
  workspaceId: "workspace",
  name,
  createdAt: index,
  updatedAt: index,
  repository: "acme/app",
  parentTaskId: PARENT,
  status: TASK_STATUS.TODO,
  number: index + 11,
}));

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The breakdown of a top pilot task whose switch reads `running`, every child it opens recorded. */
function mount(running: boolean | undefined): { host: HTMLElement; opened: string[] } {
  const opened: string[] = [];
  const task: Pick<Task, "id" | "mode" | "parentTaskId" | "running"> = {
    id: PARENT,
    mode: TASK_MODE.PILOT,
    ...(running === undefined ? {} : { running }),
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(PlanBreakdown, {
        task,
        tasks: CHILDREN,
        workspaceName: "Acme",
        onOpenTask: (taskId) => opened.push(taskId),
      }),
    ),
  );
  return { host, opened };
}

test("while Running is off the waiting children are listed under words pointing at the switch, with no buttons but the rows, and a row opens its task", () => {
  const { host, opened } = mount(undefined);
  assert.ok(
    host.textContent?.includes(
      "The pilot proposed 2 child tasks. Switch on Running to start their agents.",
    ),
  );
  const list =
    host.querySelector('ul[aria-label="Child tasks waiting to start"]') ??
    assert.fail("no list of waiting child tasks");
  const rows = [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");
  assert.equal(rows.length, 2);
  assert.ok(rows[0]?.includes("Schema") && rows[0].includes("ACME-11"));
  const buttons = [...host.querySelectorAll("button")];
  assert.equal(buttons.filter((button) => !list.contains(button)).length, 0);
  act(() => list.querySelector("button")?.click());
  assert.deepEqual(opened, [CHILDREN[0]?.id]);
});

test("once Running is on the breakdown goes", () => {
  assert.equal(mount(true).host.childElementCount, 0);
});
