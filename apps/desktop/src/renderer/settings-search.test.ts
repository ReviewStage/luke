import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { test } from "vitest";
import { type SettingsSearchInput, searchSettings, settingsSearchEntries } from "./settings-search";

/**
 * Settings search over what the pages draw: a Workspace group is found only where
 * the page draws it for the workspace Settings shows, a row elsewhere
 * only while its page draws it, and an integration by its tools once the
 * Integrations page has read them. Synthetic workspaces and tools.
 */

const TEAM: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const FIRST: Workspace = {
  id: "workspace-personal",
  name: "Dana",
  slug: "dana",
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

test("Invite people finds Members for every workspace, the account's first one too", () => {
  assert.deepEqual(workspaceFound("Invite people", TEAM), [SETTINGS_SECTION.MEMBERS]);
  assert.deepEqual(workspaceFound("Invite people", FIRST), [SETTINGS_SECTION.MEMBERS]);
});

test("Integrations, and every word GitHub repositories was found by, find the Workspace page's group for every workspace, a member's and the account's first one's too", () => {
  const found = [SETTINGS_SECTION.GITHUB_REPOSITORIES];
  const queries = [
    "Integrations",
    "manage",
    "GitHub repositories",
    "GitHub",
    "organization",
    "connect",
    "choose",
    "disconnect",
  ];
  for (const workspace of [FIRST, TEAM, { ...TEAM, role: WORKSPACE_ROLE.ADMIN }]) {
    for (const query of queries) {
      assert.deepEqual(workspaceFound(query, workspace), found, `${query} for ${workspace.role}`);
    }
  }
});

test("the Workspace page's group reads Integrations, under its Workspace page apart from the Integrations page's rows", () => {
  const groups =
    searchSettings(
      settingsSearchEntries({
        settings: settingsView(),
        voiceControlsDrawn: true,
        accountDrawn: true,
        workspace: TEAM,
      }),
      "Integrations",
    )?.groups ?? [];
  const workspaceGroup = groups.find((group) => group.page === SETTINGS_VIEW.WORKSPACE);

  assert.deepEqual(
    workspaceGroup?.items.map((entry) => [entry.id, entry.label]),
    [[SETTINGS_SECTION.GITHUB_REPOSITORIES, "Integrations"]],
  );
  assert.equal(
    groups
      .find((group) => group.page === SETTINGS_VIEW.INTEGRATIONS)
      ?.items.some((entry) => entry.id === SETTINGS_SECTION.GITHUB_REPOSITORIES),
    false,
  );
});

test("searching GitHub while signed in finds Integrations' GitHub row and nothing on the Account page", () => {
  const entries = settingsSearchEntries({
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn: true,
  });
  const groups = searchSettings(entries, "GitHub")?.groups ?? [];

  assert.deepEqual(
    groups
      .find((group) => group.page === SETTINGS_VIEW.INTEGRATIONS)
      ?.items.map((entry) => entry.id),
    [INTEGRATION_PROVIDER.GITHUB],
  );
  assert.equal(
    groups.some((group) => group.page === SETTINGS_VIEW.ACCOUNT),
    false,
  );
});

/** Where `query` leads on the Experimental page, signed in or not. */
function experimentalFound(query: string, accountDrawn: boolean): readonly string[] {
  const input: SettingsSearchInput = {
    settings: settingsView(),
    voiceControlsDrawn: false,
    accountDrawn,
  };
  const found = searchSettings(settingsSearchEntries(input), query);
  return (found?.groups ?? [])
    .filter((group) => group.page === SETTINGS_VIEW.EXPERIMENTAL)
    .flatMap((group) => group.items.map((entry) => entry.label));
}

test("an experiment is found by its name, what it brings, and what other apps call the page, while signed in", () => {
  for (const query of ["Factory", "Plan to Build to Ship", "Experimental", "beta", "labs"]) {
    assert.deepEqual(experimentalFound(query, true), ["Factory"], query);
  }
  assert.deepEqual(experimentalFound("Factory", false), []);
});

test("no two rows the search can land on wear the same id", () => {
  const ids = settingsSearchEntries({
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    workspace: TEAM,
  }).map((entry) => entry.id);
  assert.deepEqual(
    ids.filter((id, at) => ids.indexOf(id) !== at),
    [],
  );
});
