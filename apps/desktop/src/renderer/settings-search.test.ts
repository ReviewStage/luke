import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@sidecar/hosted/workspace-wire";
import { settingsView } from "@sidecar/settings/testing";
import { test } from "vitest";
import { type SettingsSearchInput, searchSettings, settingsSearchEntries } from "./settings-search";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "./settings-views";

/**
 * Settings search over what the pages draw: a Workspace group is found only where
 * the page draws it for the workspace Settings shows, and a row elsewhere
 * only while its page draws it. Synthetic workspaces.
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

/** The ids of every row a query for `query` finds, signed in or not, with no workspace shown. */
function found(query: string, accountDrawn: boolean): readonly string[] {
  const input: SettingsSearchInput = {
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn,
  };
  return (searchSettings(settingsSearchEntries(input), query)?.groups ?? []).flatMap((group) =>
    group.items.map((entry) => entry.id),
  );
}

test("searching GitHub finds Connected accounts while signed in, and not while signed out, when it is not drawn", () => {
  assert.ok(found("GitHub", true).includes(SETTINGS_SECTION.CONNECTED_ACCOUNTS));
  assert.ok(found("reconnect", true).includes(SETTINGS_SECTION.CONNECTED_ACCOUNTS));
  assert.equal(found("GitHub", false).includes(SETTINGS_SECTION.CONNECTED_ACCOUNTS), false);
});
