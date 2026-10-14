import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { WORKSPACE_ROLE, type Workspace } from "@sidecar/hosted/workspace-wire";
import { settingsView } from "@sidecar/settings/testing";
import { test } from "vitest";
import { type SettingsSearchInput, searchSettings, settingsSearchEntries } from "./settings-search";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "./settings-views";

/**
 * Settings search over what the pages draw: a Workspace group is found only where
 * the page draws it for the workspace Settings shows, a row elsewhere
 * only while its page draws it, and an integration by its tools once the
 * Integrations page has read them. Synthetic workspaces and tools.
 */

const TEAM: Workspace = {
  id: "workspace-acme",
  name: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};
const FIRST: Workspace = {
  id: "workspace-personal",
  name: "Dana",
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

test("GitHub repositories is found for every workspace, a member's and the account's first one's too", () => {
  const found = [SETTINGS_SECTION.GITHUB_REPOSITORIES];
  assert.deepEqual(workspaceFound("GitHub repositories", FIRST), found);
  assert.deepEqual(workspaceFound("GitHub repositories", TEAM), found);
  assert.deepEqual(
    workspaceFound("GitHub repositories", { ...TEAM, role: WORKSPACE_ROLE.ADMIN }),
    found,
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

test("an integration is found by its tools' names and descriptions once the Integrations page has handed them up", () => {
  const input: SettingsSearchInput = {
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    integrationTools: new Map([
      [
        INTEGRATION_PROVIDER.VERCEL,
        [{ name: "get_deployment_build_logs", description: "Reads a build's output." }],
      ],
    ]),
  };
  const integrationsFound = (query: string, from: SettingsSearchInput) =>
    (searchSettings(settingsSearchEntries(from), query)?.groups ?? [])
      .filter((group) => group.page === SETTINGS_VIEW.INTEGRATIONS)
      .flatMap((group) => group.items.map((entry) => entry.id));

  assert.deepEqual(integrationsFound("build_logs", input), [INTEGRATION_PROVIDER.VERCEL]);
  assert.deepEqual(integrationsFound("build's output", input), [INTEGRATION_PROVIDER.VERCEL]);
  assert.deepEqual(integrationsFound("build_logs", { ...input, integrationTools: undefined }), []);
});
