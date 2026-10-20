// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS, type Task, type TaskStanding } from "@luke/features/task-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { assigneeRows, TaskKeyLine, TaskStandingChips } from "./task-standing.js";

/**
 * task-standing.test.ts -- a task's head names it by its key and says where
 * it stands and how much it matters: a pick from the status chip's menu is
 * handed to the page to send, the chips take no pick without a door to send
 * it through, and a task from a service before keys draws neither.
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
  document: { body: "", assumptions: [] },
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws the task's key and its chips into the document, with the door a pick is sent through. */
function drawn(task: Task, onSet: ((standing: TaskStanding) => void) | undefined): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render([
      createElement(TaskKeyLine, { key: "key", task, workspaceName: "Acme" }),
      createElement(TaskStandingChips, { key: "chips", task, onSet }),
    ]),
  );
  return host;
}

/** The chip a label names. */
function chip(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((button) =>
    (button.getAttribute("aria-label") ?? button.textContent ?? "").includes(label),
  );
  return found ?? assert.fail(`no ${label} chip`);
}

test("names the task by its workspace's prefix and its number, with its status and priority on its chips", () => {
  const host = drawn(TASK, () => undefined);

  assert.ok(host.textContent?.includes("ACME-42"));
  assert.ok(chip(host, "Status").textContent?.includes("Todo"));
  assert.ok(chip(host, "Priority").textContent?.includes("High"));
});

test("a status picked from the menu is handed to the page, and the one standing is not picked again", () => {
  const sent: TaskStanding[] = [];
  const host = drawn(TASK, (standing) => sent.push(standing));

  const pick = (words: string) => {
    act(() => chip(host, "Status").click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes(words),
    );
    act(() => (row ?? assert.fail(`no ${words} row`)).click());
  };
  pick("Todo");
  pick("Done");

  assert.deepEqual(sent, [{ status: TASK_STATUS.DONE }]);
});

test("the chips take no pick without a door to send it, and a task from a service before keys draws neither", () => {
  const archived = drawn(TASK, undefined);
  assert.equal(chip(archived, "Status").disabled, true);
  assert.equal(chip(archived, "Priority").disabled, true);
  assert.equal(chip(archived, "Assignee").disabled, true);

  const { status: _status, priority: _priority, number: _number, ...older } = TASK;
  const before = drawn(older, () => undefined);
  assert.equal(before.textContent, "");
});

test("the assignee chip names who the task is assigned to, or no one, and No assignee picked is handed to the page as null", () => {
  const sent: TaskStanding[] = [];
  const unassigned = drawn(TASK, (standing) => sent.push(standing));
  assert.ok(chip(unassigned, "Assignee").textContent?.includes("No assignee"));

  const assigned = drawn(
    { ...TASK, assignee: { userId: "user-ada", name: "Ada Lovelace" } },
    (standing) => sent.push(standing),
  );
  assert.ok(chip(assigned, "Assignee").textContent?.includes("Ada Lovelace"));
  const pickNoAssignee = (host: HTMLElement) => {
    act(() => chip(host, "Assignee").click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes("No assignee"),
    );
    act(() => (row ?? assert.fail("no No assignee row")).click());
  };
  pickNoAssignee(unassigned);
  pickNoAssignee(assigned);

  assert.deepEqual(sent, [{ assigneeId: null }]);
});

test("the assignee's menu lists No assignee, then the reader, then every other member by name, each searchable by email", () => {
  const member = (userId: string, name: string) => ({
    userId,
    name,
    email: `${userId}@acme.test`,
    role: "member" as const,
  });
  const rows = assigneeRows(
    [
      member("user-grace", "Grace Hopper"),
      member("user-dean", "Dean"),
      member("user-ada", "Ada Lovelace"),
    ],
    "user-dean",
  );

  assert.deepEqual(
    rows.map((row) => [row.id, row.label, row.detail, row.terms]),
    [
      ["no-assignee", "No assignee", undefined, undefined],
      ["user-dean", "Dean", "You", ["user-dean@acme.test"]],
      ["user-ada", "Ada Lovelace", "user-ada@acme.test", ["user-ada@acme.test"]],
      ["user-grace", "Grace Hopper", "user-grace@acme.test", ["user-grace@acme.test"]],
    ],
  );
  assert.deepEqual(
    assigneeRows(undefined, "user-dean").map((row) => row.id),
    ["no-assignee"],
  );
});
