import assert from "node:assert/strict";
import { IDLE_PLANNING_VIEW, type PlanningView } from "@luke/features/planning-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { test } from "vitest";
import { noticePlanTitle } from "./agent-notices";

/**
 * notice-title.test.ts -- a notice names the plan it is about, and, once the
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

function planning(workspaces: readonly Workspace[]): PlanningView {
  return { ...IDLE_PLANNING_VIEW, plans: [RETRIES], workspaces };
}

test("a notice's title leads with the plan's workspace once the account is in more than one", () => {
  assert.equal(
    noticePlanTitle(planning([ACME, NORTHWIND]), RETRIES.id),
    "Northwind · Checkout retries",
  );
  assert.equal(noticePlanTitle(planning([NORTHWIND]), RETRIES.id), "Checkout retries");
  assert.equal(noticePlanTitle(planning([ACME, NORTHWIND]), "unknown-plan"), undefined);
});
