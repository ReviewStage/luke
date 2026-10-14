import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@sidecar/hosted/workspace-wire";
import { settingsView } from "@sidecar/settings/testing";
import { test } from "vitest";
import { type SettingsSearchInput, searchSettings, settingsSearchEntries } from "./settings-search";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "./settings-views";

/**
 * Settings search over the Workspace page: a query finds a group only where
 * the page draws it for the workspace Settings shows. Synthetic workspaces.
 */

const TEAM: Workspace = {
  id: "workspace-acme",
  name: "acme",
  personal: false,
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Personal",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

/** Where `query` leads on the Workspace page while `workspace` is shown. */
function workspaceFound(query: string, workspace: Workspace): readonly string[] {
  const input: SettingsSearchInput = {
    settings: settingsView(),
    voiceControlsDrawn: false,
    accountDrawn: true,
    workspace,
  };
  const found = searchSettings(settingsSearchEntries(input), query);
  return (found?.groups ?? [])
    .filter((group) => group.page === SETTINGS_VIEW.WORKSPACE)
    .flatMap((group) => group.items.map((entry) => entry.id));
}

test("Invite people finds Members for a team workspace and nothing for the personal one", () => {
  assert.deepEqual(workspaceFound("Invite people", TEAM), [SETTINGS_SECTION.MEMBERS]);
  assert.deepEqual(workspaceFound("Invite people", PERSONAL), []);
});

test("GitHub repositories is found only for an owner or an admin of a team workspace", () => {
  const found = [SETTINGS_SECTION.GITHUB_REPOSITORIES];
  assert.deepEqual(
    workspaceFound("GitHub repositories", { ...TEAM, role: WORKSPACE_ROLE.OWNER }),
    found,
  );
  assert.deepEqual(
    workspaceFound("GitHub repositories", { ...TEAM, role: WORKSPACE_ROLE.ADMIN }),
    found,
  );
  assert.deepEqual(workspaceFound("GitHub repositories", TEAM), []);
  assert.deepEqual(workspaceFound("GitHub repositories", PERSONAL), []);
});
