import assert from "node:assert/strict";
import { test } from "vitest";
import { tasksControl } from "../testing/tasks-control.js";
import { welcomed } from "./desktop-welcome.js";

/** A plan of the account's, standing in some workspace. */
const PLAN = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-team",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

test.each([
  {
    case: "signed in, its list read, holding nothing",
    signedIn: true,
    listRead: true,
    tasks: [],
    fresh: true,
  },
  { case: "its task list still unread", signedIn: true, listRead: false, tasks: [], fresh: false },
  { case: "signed out", signedIn: false, listRead: true, tasks: [], fresh: false },
  {
    case: "holding a plan in any workspace",
    signedIn: true,
    listRead: true,
    tasks: [PLAN],
    fresh: false,
  },
])("an account $case is new: $fresh", ({ signedIn, listRead, tasks, fresh }) => {
  assert.equal(welcomed(tasksControl({ signedIn, listRead, tasks })), fresh);
});
