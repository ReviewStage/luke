import assert from "node:assert/strict";
import { EXPERIMENT, NO_EXPERIMENTS } from "@repo/settings";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { test } from "vitest";
import { stepTitle } from "../history-titles.js";
import { createPanelRouter } from "../panel-router.js";
import type { RouteAccess } from "../route-gates.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { type PlaceThere, ROUTED_PLACE, routedPlaceOf, routedStepStands } from "./routed-places.js";

/**
 * routed-places.test.ts -- each routed place as the window reads it from an
 * address: the place it stands on, what its gate refuses, what Back passes
 * over, and what its step is called. Synthetic ids.
 */

const TASK_ID = "a1000001-0000-4000-8000-0000000000d1";

/** An admin's access with every workspace's step read and the account's settings read with no experiment on. */
const ACCESS: RouteAccess = {
  admin: true,
  experiments: NO_EXPERIMENTS,
  experimentsRead: true,
  workspaces: [{ id: "workspace-acme", slug: "acme", formerSlugs: [] }],
  listed: "acme",
};

/** A window where everything a step names is still there, under Acme listed. */
const THERE: PlaceThere = {
  historyTask: undefined,
  taskStands: () => true,
  automationStands: () => true,
  listed: (workspace) => workspace === "acme",
};

/** The matches of `address` under the panel's own routes. */
function matchesOf(address: string) {
  const router = createPanelRouter(
    createMemoryHistory({ initialEntries: ["/app"] }),
    new QueryClient(),
  );
  return router.matchRoutes(new URL(address, "https://panel.invalid").pathname);
}

/** Whether Back may go to a step at `address`. */
function stepStands(address: string, access = ACCESS, there = THERE): boolean {
  const search = new URL(address, "https://panel.invalid").searchParams;
  return routedStepStands(matchesOf(address), search, access, there);
}

test.each([
  ["/acme/settings/profile", ROUTED_PLACE.SETTINGS],
  ["/app/settings", ROUTED_PLACE.SETTINGS],
  ["/acme/admin/users", ROUTED_PLACE.ADMIN],
  ["/acme/tasks", ROUTED_PLACE.BOARD],
  ["/acme/person/user-ada", ROUTED_PLACE.PERSON],
  ["/acme/automation/automation-1/runs", ROUTED_PLACE.AUTOMATIONS],
  ["/acme/task/7/version/3", ROUTED_PLACE.VERSION_HISTORY],
  ["/acme/inbox/item-1", ROUTED_PLACE.INBOX],
  ["/acme/task/7", undefined],
  ["/app", undefined],
] as const)("%s stands on its routed place, where it is one", (address, place) => {
  assert.equal(routedPlaceOf(matchesOf(address)), place);
});

test.each([
  ["Admin, to an account that is no admin", "/acme/admin", { ...ACCESS, admin: false }],
  ["a Settings page an experiment off holds", "/acme/settings/memory", ACCESS],
  ["a version history with Descriptions off", "/acme/task/7/versions", ACCESS],
  ["the Inbox under a workspace the reader is not in", "/left/inbox", ACCESS],
] as const)("the gate refuses %s, which Back passes over", (_refused, address, access) => {
  assert.equal(stepStands(address, access), false);
});

test.each<readonly [string, string, Partial<PlaceThere>]>([
  ["a Board of a workspace no longer listed", "/acme/tasks", { listed: () => false }],
  ["a person's page of a workspace no longer listed", "/acme/person/u", { listed: () => false }],
  [
    "a deleted automation's page",
    "/acme/automation/automation-1",
    { automationStands: () => false },
  ],
  [
    "an Inbox narrowed to a deleted task",
    `/acme/inbox/task/${TASK_ID}`,
    { taskStands: () => false },
  ],
  [
    "an Inbox item chosen in a list narrowed to a deleted task",
    `/acme/inbox/item-1?task=${TASK_ID}`,
    { taskStands: () => false },
  ],
  [
    "a version history of a deleted task",
    "/acme/task/7/version/3",
    { historyTask: TASK_ID, taskStands: () => false },
  ],
])("Back passes over %s", (_skipped, address, gone) => {
  const descriptionsOn = { ...ACCESS, experiments: { [EXPERIMENT.DESCRIPTIONS]: true } };
  assert.equal(stepStands(address, descriptionsOn, THERE), true, "it stands while there");
  assert.equal(stepStands(address, descriptionsOn, { ...THERE, ...gone }), false);
});

test("each place over the plan names its step for itself, and Admin's as the place under it", () => {
  const task = { ...DOCUMENT_TASK, id: TASK_ID, name: "Auth refactor" };
  const base = tasksControl({ tasks: [task] });
  const titled = (
    overrides: Parameters<typeof tasksControl>[0],
    place: keyof typeof ROUTED_PLACE,
  ) => stepTitle(ROUTED_PLACE[place], tasksControl({ tasks: [task], ...overrides }));

  assert.deepEqual(titled({ boardView: { ...base.boardView, open: true } }, "BOARD"), {
    label: "Tasks",
  });
  assert.deepEqual(
    titled({ automationsView: { ...base.automationsView, open: true } }, "AUTOMATIONS"),
    { label: "Automations" },
  );
  assert.deepEqual(
    titled({ personView: { ...base.personView, userId: "user-ada", name: "Ada" } }, "PERSON"),
    { label: "Ada" },
  );
  assert.deepEqual(
    titled({ inboxView: { ...base.inboxView, open: true, narrowed: TASK_ID } }, "INBOX"),
    { label: "Inbox", detail: "Auth refactor" },
  );
  assert.deepEqual(titled({ boundFor: TASK_ID }, "VERSION_HISTORY"), {
    label: "Auth refactor",
    detail: "Version history",
  });
  assert.deepEqual(titled({}, "ADMIN"), { label: "Home" });
});
