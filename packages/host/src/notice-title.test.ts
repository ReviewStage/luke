import assert from "node:assert/strict";
import { IDLE_TASKS_VIEW, type TasksView } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { test } from "vitest";
import { noticeTaskTitle } from "./agent-notices.js";

/**
 * notice-title.test.ts -- a notice names the task it is about, and, once the
 * account is in more than one workspace, the workspace first, so a notice from
 * a workspace the window is not listing says whose it is. Synthetic throughout.
 */

const ACME: Workspace = { id: "ws-acme", name: "Acme", role: WORKSPACE_ROLE.ADMIN, github: null };
const NORTHWIND: Workspace = {
  id: "ws-north",
  name: "Northwind",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const RETRIES = {
  id: "6f2a8cae-4b7d-4e95-9abd-7c8d9eafb0c6",
  workspaceId: NORTHWIND.id,
  name: "Checkout retries",
  createdAt: 1,
  updatedAt: 1,
  repository: null,
};

function tasks(workspaces: readonly Workspace[]): TasksView {
  return { ...IDLE_TASKS_VIEW, tasks: [RETRIES], workspaces };
}

test("a notice's title leads with the plan's workspace once the account is in more than one", () => {
  assert.equal(
    noticeTaskTitle(tasks([ACME, NORTHWIND]), RETRIES.id),
    "Northwind · Checkout retries",
  );
  assert.equal(noticeTaskTitle(tasks([NORTHWIND]), RETRIES.id), "Checkout retries");
  assert.equal(noticeTaskTitle(tasks([ACME, NORTHWIND]), "unknown-plan"), undefined);
});
