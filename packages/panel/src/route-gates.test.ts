import assert from "node:assert/strict";
import { NO_EXPERIMENTS } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { test } from "vitest";
import { settingsPageRouteStands, workspaceRouteStands } from "./route-gates.js";

/**
 * route-gates.test.ts -- a Settings page an experiment holds waits on the
 * account's settings while they are unread, as a reloaded address's does,
 * rather than giving way to Profile for good before the read answers; a
 * workspace's place waits on the reader's workspaces the same way.
 */

test("a page an experiment holds stands while the account's settings are unread, and gives way once they are read with it off", () => {
  const unread = {
    admin: false,
    experiments: NO_EXPERIMENTS,
    experimentsRead: false,
    workspaces: [],
  };

  assert.equal(settingsPageRouteStands(SETTINGS_VIEW.MEMORY, unread), true);
  assert.equal(
    settingsPageRouteStands(SETTINGS_VIEW.MEMORY, { ...unread, experimentsRead: true }),
    false,
  );
});

test("a workspace's place stands while the reader's workspaces are unread, under a former slug of theirs, and gives way under one they are not in", () => {
  const unread = {
    admin: false,
    experiments: NO_EXPERIMENTS,
    experimentsRead: true,
    workspaces: [],
  };
  const read = {
    ...unread,
    workspaces: [{ id: "workspace-acme", slug: "acme", formerSlugs: ["acme-old"] }],
  };

  assert.equal(workspaceRouteStands("left", unread), true);
  assert.equal(workspaceRouteStands("acme-old", read), true);
  assert.equal(workspaceRouteStands("left", read), false);
});
