import assert from "node:assert/strict";
import { EXPERIMENT, NO_EXPERIMENTS } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { test } from "vitest";
import { settingsPageRouteStands, workspaceRouteStands } from "./route-gates.js";

/**
 * route-gates.test.ts -- a Settings page a workspace experiment holds waits on
 * the reader's workspaces while they are unread, as a reloaded address's does,
 * rather than giving way to Profile for good before the read answers, and then
 * stands by the choice of the workspace Settings stands under; a workspace's
 * place waits on the reader's workspaces the same way.
 */

test("a page a workspace experiment holds stands while the reader's workspaces are unread, and then by the choice of the workspace Settings stands under", () => {
  const unread = {
    admin: false,
    experiments: NO_EXPERIMENTS,
    experimentsRead: true,
    workspaces: [],
    listed: "acme",
  };
  const read = {
    ...unread,
    workspaces: [
      { id: "workspace-acme", slug: "acme" },
      {
        id: "workspace-stage",
        slug: "stage",
        experiments: [{ experiment: EXPERIMENT.MEMORY, on: true, changedBy: null, changedAt: 1 }],
      },
    ],
  };

  assert.equal(settingsPageRouteStands(SETTINGS_VIEW.MEMORY, unread, "acme"), true);
  assert.equal(settingsPageRouteStands(SETTINGS_VIEW.MEMORY, read, "acme"), false);
  assert.equal(settingsPageRouteStands(SETTINGS_VIEW.MEMORY, read, "stage"), true);
});

test("a workspace's place stands while the reader's workspaces are unread, under a former slug of theirs, and gives way under one they are not in", () => {
  const unread = {
    admin: false,
    experiments: NO_EXPERIMENTS,
    experimentsRead: true,
    workspaces: [],
    listed: undefined,
  };
  const read = {
    ...unread,
    workspaces: [{ id: "workspace-acme", slug: "acme", formerSlugs: ["acme-old"] }],
  };

  assert.equal(workspaceRouteStands("left", unread), true);
  assert.equal(workspaceRouteStands("acme-old", read), true);
  assert.equal(workspaceRouteStands("left", read), false);
});
