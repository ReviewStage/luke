import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { settingsView } from "@luke/settings/testing";
import { test } from "vitest";
import {
  type SettingsSearchEntry,
  type SettingsSearchInput,
  searchSettings,
  settingsSearchEntries,
} from "./settings-search.js";
import { DESKTOP_CAPABILITIES } from "./testing/app-state.js";

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
    capabilities: DESKTOP_CAPABILITIES,
    workspace,
  };
  const found = searchSettings(settingsSearchEntries(input), query);
  return (found?.groups ?? [])
    .filter((group) => group.page === SETTINGS_VIEW.WORKSPACE)
    .flatMap((group) => group.items.map((entry) => entry.id));
}

test("Invite people finds Invitations where the reader may invite, the account's first workspace too, and nothing for a member", () => {
  assert.deepEqual(workspaceFound("Invite people", { ...TEAM, role: WORKSPACE_ROLE.ADMIN }), [
    SETTINGS_SECTION.INVITATIONS,
  ]);
  assert.deepEqual(workspaceFound("Invite people", FIRST), [SETTINGS_SECTION.INVITATIONS]);
  assert.deepEqual(workspaceFound("Invite people", TEAM), []);
});

test("Leave finds the workspace's leave where the reader may leave, and nothing for its owner", () => {
  assert.deepEqual(workspaceFound("Leave", TEAM), [SETTINGS_SECTION.LEAVE]);
  assert.deepEqual(workspaceFound("Leave", { ...TEAM, role: WORKSPACE_ROLE.ADMIN }), [
    SETTINGS_SECTION.LEAVE,
  ]);
  assert.deepEqual(workspaceFound("Leave", FIRST), []);
});

test("Members finds the members for every workspace", () => {
  for (const workspace of [FIRST, TEAM]) {
    assert.deepEqual(workspaceFound("Members", workspace), [SETTINGS_SECTION.MEMBERS]);
  }
});

test("Workspace connections, Integrations, Linear, and every word GitHub repositories was found by, find the Workspace page's group for every workspace, a member's and the account's first one's too", () => {
  const found = [SETTINGS_SECTION.GITHUB_REPOSITORIES];
  const queries = [
    "Workspace connections",
    "Integrations",
    "Linear",
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

test("Integrations finds the Workspace page's group as Workspace connections, under its Workspace page apart from the Integrations page's rows", () => {
  const groups =
    searchSettings(
      settingsSearchEntries({
        settings: settingsView(),
        voiceControlsDrawn: true,
        accountDrawn: true,
        capabilities: DESKTOP_CAPABILITIES,
        workspace: TEAM,
      }),
      "Integrations",
    )?.groups ?? [];
  const workspaceGroup = groups.find((group) => group.page === SETTINGS_VIEW.WORKSPACE);

  assert.deepEqual(
    workspaceGroup?.items.map((entry) => [entry.id, entry.label]),
    [[SETTINGS_SECTION.GITHUB_REPOSITORIES, "Workspace connections"]],
  );
  assert.equal(
    groups
      .find((group) => group.page === SETTINGS_VIEW.INTEGRATIONS)
      ?.items.some((entry) => entry.id === SETTINGS_SECTION.GITHUB_REPOSITORIES),
    false,
  );
});

test("searching GitHub while signed in finds Integrations' GitHub row and Profile's, and a personal access token finds Profile's alone", () => {
  const entries = settingsSearchEntries({
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  });
  const groups = searchSettings(entries, "GitHub")?.groups ?? [];

  assert.deepEqual(
    groups
      .find((group) => group.page === SETTINGS_VIEW.INTEGRATIONS)
      ?.items.map((entry) => entry.id),
    [INTEGRATION_PROVIDER.GITHUB],
  );
  assert.deepEqual(
    groups.find((group) => group.page === SETTINGS_VIEW.ACCOUNT)?.items.map((entry) => entry.id),
    [SETTINGS_SEARCH_ROW.GITHUB_ACCESS],
  );
  assert.deepEqual(
    (searchSettings(entries, "personal access token")?.groups ?? []).map((group) =>
      group.items.map((entry) => entry.id),
    ),
    [[SETTINGS_SEARCH_ROW.GITHUB_ACCESS]],
  );
});

test("the OpenAI key a call or dictation runs on is found by those words, on Codex's row in Agents, where it is kept", () => {
  const entries = settingsSearchEntries({
    settings: settingsView({ voiceAvailable: true }),
    voiceControlsDrawn: true,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
  });
  for (const query of ["voice key", "call key", "dictation key"]) {
    const agents = (searchSettings(entries, query)?.groups ?? []).find(
      (group) => group.page === SETTINGS_VIEW.CODING_AGENTS,
    );
    assert.deepEqual(
      agents?.items.map((entry) => entry.id),
      [SETTINGS_SECTION.CODEX],
      query,
    );
  }
});

/** Where `query` leads on the Experimental page, signed in or not. */
function experimentalFound(query: string, accountDrawn: boolean): readonly string[] {
  const input: SettingsSearchInput = {
    settings: settingsView(),
    voiceControlsDrawn: false,
    accountDrawn,
    capabilities: DESKTOP_CAPABILITIES,
  };
  const found = searchSettings(settingsSearchEntries(input), query);
  return (found?.groups ?? [])
    .filter((group) => group.page === SETTINGS_VIEW.EXPERIMENTAL)
    .flatMap((group) => group.items.map((entry) => entry.label));
}

test("an experiment is found by its name, what it brings, and what other apps call the page, while signed in", () => {
  for (const query of ["Code review", "reviews each pull request"]) {
    assert.deepEqual(experimentalFound(query, true), ["Code review"], query);
  }
  assert.deepEqual(experimentalFound("on a schedule", true), [], "Automations is no experiment");
  for (const query of ["Browser tab", "cloud browsers"]) {
    assert.deepEqual(experimentalFound(query, true), ["Browser tab"], query);
  }
  for (const query of ["Chat", "direct messages"]) {
    assert.deepEqual(experimentalFound(query, true), ["Chat"], query);
  }
  for (const query of ["Video calls", "Keyframe"]) {
    assert.deepEqual(experimentalFound(query, true), ["Video calls"], query);
  }
  for (const query of ["Inbox-first", "in place of your task list"]) {
    assert.deepEqual(experimentalFound(query, true), ["Inbox-first sidebar"], query);
  }
  for (const query of ["operator", "steers them"]) {
    assert.deepEqual(experimentalFound(query, true), ["Luke, your operator"], query);
  }
  for (const query of ["Experimental", "beta", "labs"]) {
    assert.deepEqual(
      experimentalFound(query, true),
      [
        "Memory",
        "Luke, your operator",
        "Inbox-first sidebar",
        "Code review",
        "Browser tab",
        "Chat",
        "Video calls",
      ],
      query,
    );
  }
  assert.deepEqual(experimentalFound("Chat", false), []);
});

test("Video calls is one switch, on the Experimental page, and not among the Voice page's controls", () => {
  const found = searchSettings(
    settingsSearchEntries({
      settings: settingsView(),
      voiceControlsDrawn: true,
      accountDrawn: true,
      capabilities: DESKTOP_CAPABILITIES,
    }),
    "Video calls",
  );
  assert.deepEqual(
    (found?.groups ?? []).map((group) => group.page),
    [SETTINGS_VIEW.EXPERIMENTAL],
  );
});

test("no two rows the search can land on wear the same id", () => {
  const ids = settingsSearchEntries({
    settings: settingsView(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
    workspace: TEAM,
  }).map((entry) => entry.id);
  assert.deepEqual(
    ids.filter((id, at) => ids.indexOf(id) !== at),
    [],
  );
});

test("a writing chord is found by its name and by the Markdown typed for it, on the Keyboard shortcuts page", () => {
  const entries = settingsSearchEntries({
    settings: settingsView(),
    voiceControlsDrawn: false,
    accountDrawn: true,
    capabilities: DESKTOP_CAPABILITIES,
    workspace: undefined,
  });
  const shortcutsFound = (query: string) =>
    (searchSettings(entries, query)?.groups ?? [])
      .filter((group) => group.page === SETTINGS_VIEW.SHORTCUTS)
      .flatMap((group) => group.items.map((entry) => entry.label));

  assert.deepEqual(shortcutsFound("Strikethrough"), ["Strikethrough"]);
  assert.deepEqual(shortcutsFound("~~"), ["Strikethrough"]);
  assert.ok(shortcutsFound("markdown").includes("Divider"), "a rule with no chord is listed too");
});

test("Escape and the keys that answer in place are found on the Keyboard shortcuts page, Escape by every word for leaving", () => {
  const shortcutsFound = (query: string) =>
    (
      searchSettings(
        settingsSearchEntries({
          settings: settingsView(),
          voiceControlsDrawn: false,
          accountDrawn: true,
          capabilities: DESKTOP_CAPABILITIES,
          workspace: undefined,
        }),
        query,
      )?.groups ?? []
    )
      .filter((group) => group.page === SETTINGS_VIEW.SHORTCUTS)
      .flatMap((group) => group.items.map((entry) => entry.label));

  assert.deepEqual(shortcutsFound("exit"), ["Close what's open, or step back"]);
  assert.deepEqual(shortcutsFound("inbox option"), ["Choose an inbox option by its number"]);
  assert.ok(shortcutsFound("link").includes("Link selected words"));
});

/** Every page's rows as a signed-in desktop reader of a workspace they administer sees them. */
const FULL_INPUT: SettingsSearchInput = {
  settings: settingsView({ voiceAvailable: true }),
  voiceControlsDrawn: true,
  accountDrawn: true,
  capabilities: DESKTOP_CAPABILITIES,
  workspace: { ...TEAM, role: WORKSPACE_ROLE.ADMIN },
};

/** The labels of the rows `query` finds, in the order they are listed. */
function labelsFound(query: string, input: SettingsSearchInput = FULL_INPUT): readonly string[] {
  return (searchSettings(settingsSearchEntries(input), query)?.groups ?? []).flatMap((group) =>
    group.items.map((entry) => entry.label),
  );
}

test("repositories, skills, test notification and rename each find the row the page draws", () => {
  assert.ok(labelsFound("repositories").includes("Repositories on this Mac"));
  assert.ok(labelsFound("skills").includes("Add a skill"));
  assert.deepEqual(labelsFound("test notification"), ["Test notification"]);
  assert.deepEqual(labelsFound("rename"), ["Rename workspace"]);
});

test("the Mac repositories need a terminal here, and renaming needs a workspace the reader manages that is not their own first", () => {
  const withoutTerminal = {
    ...FULL_INPUT,
    capabilities: DESKTOP_CAPABILITIES.filter(
      (capability) => capability !== HOST_CAPABILITY.MAC_TERMINAL,
    ),
  };
  assert.equal(
    labelsFound("repositories", withoutTerminal).includes("Repositories on this Mac"),
    false,
  );
  assert.equal(
    labelsFound("add a skill", { ...FULL_INPUT, workspace: undefined }).includes("Add a skill"),
    false,
    "the Skills page draws no Add a skill row while its workspace is unread or failed",
  );
  assert.deepEqual(labelsFound("rename", { ...FULL_INPUT, workspace: TEAM }), []);
  assert.deepEqual(
    labelsFound("rename", { ...FULL_INPUT, workspace: { ...FIRST, personal: true } }),
    [],
  );
});

test("model finds the default model and the Chapters model, each under a label no other page's row wears", () => {
  assert.deepEqual(
    labelsFound("model").filter((label) => label.toLowerCase().includes("model")),
    ["Default model", "Chapters model"],
  );
});

test("no two rows on different pages wear the same label", () => {
  const pagesOf = new Map<string, Set<string>>();
  for (const entry of settingsSearchEntries(FULL_INPUT)) {
    pagesOf.set(entry.label, (pagesOf.get(entry.label) ?? new Set()).add(entry.page));
  }
  assert.deepEqual(
    [...pagesOf].filter(([, pages]) => pages.size > 1).map(([label]) => label),
    [],
  );
});

test("a search that finds nothing says what to try", () => {
  assert.equal(searchSettings(settingsSearchEntries(FULL_INPUT), "zzzz")?.matched, 0);
});

/** Rows on one page, each its own words: what a query ranks and marks. */
function entryOf(id: string, label: string, ...words: string[]): SettingsSearchEntry {
  return { id, label, page: SETTINGS_VIEW.APPEARANCE, haystack: [label, ...words] };
}

test("a row named by the query or beginning with it ranks above one whose words are scattered, and one found by its description last", () => {
  const entries = [
    entryOf("described", "Colours", "Follows the system theme"),
    entryOf("scattered", "Dark theme for diffs"),
    entryOf("prefix", "Theme colours"),
    entryOf("exact", "Theme"),
  ];
  const found = searchSettings(entries, "theme");

  assert.deepEqual(
    found?.groups.flatMap((group) => group.items.map((entry) => entry.id)),
    ["exact", "prefix", "scattered", "described"],
  );
});

test("a result marks the letters of its name that the words typed found, and one found by its description marks none", () => {
  const found = searchSettings(
    [entryOf("diffs", "Dark theme for diffs"), entryOf("colours", "Colours", "System theme")],
    "theme",
  );
  const marks = new Map(found?.groups.flatMap((group) => group.items.map((e) => [e.id, e.marks])));

  assert.deepEqual(marks.get("diffs"), [{ start: 5, end: 10 }]);
  assert.deepEqual(marks.get("colours"), []);
});

test("letters typed in order do not find a row: thm no longer finds Theme", () => {
  assert.equal(searchSettings(settingsSearchEntries(FULL_INPUT), "thm")?.matched, 0);
  assert.ok(labelsFound("theme").includes("Theme"));
});
