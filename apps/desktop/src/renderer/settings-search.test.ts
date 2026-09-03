import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_AGENT_PROVIDER_LIST, CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { APP_SETTING_SCHEMA, settingFieldForGuideId, settingGuideEntries } from "@sidecar/settings";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "#shared/wire/account";
import type { AppSettingsView } from "#shared/wire/settings";
import { APP_SETTING_DEFAULTS, CLI_CONNECTION, VOICE_SOURCE } from "#shared/wire/settings";
import {
  type SettingsSearchEntry,
  type SettingsSearchInput,
  type SettingsSearchOutcome,
  searchSettings,
  settingsSearchEntries,
} from "./settings-search";
import { SETTINGS_VIEW } from "./settings-views";

function settings(overrides: Partial<AppSettingsView> = {}): AppSettingsView {
  return Object.assign<AppSettingsView, Partial<AppSettingsView>>(
    {
      ...APP_SETTING_DEFAULTS,
      credentialSources: {
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
        [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
        [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
      },
      secretStorage: SECRET_STORAGE.UNKNOWN,
      codexCloudConnection: CLI_CONNECTION.UNKNOWN,
      voiceAvailable: true,
      voiceSource: VOICE_SOURCE.ACCOUNT,
      showInDock: false,
      voice: REALTIME_VOICE.CEDAR,
      voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
      voiceCaptions: false,
      duckOtherMedia: true,
      preferBuiltInMicrophone: true,
      quietDuringMeetings: true,
      pauseAnnouncements: false,
      calendarSignInAvailable: false,
      appleCalendarAvailable: false,
      linearSignInAvailable: false,
      calendarAccounts: [],
      showOnAllDisplays: false,
      formFactor: PANEL_FORM_FACTOR.BUBBLE,
    },
    overrides,
  );
}

function searchInput(overrides: Partial<SettingsSearchInput> = {}): SettingsSearchInput {
  return {
    settings: settings(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    superset: { installed: false, connected: false, agentsOffered: false },
    workspaceProjects: [],
    ...overrides,
  };
}

/** An input with every conditional row drawn, so the corpus is at its widest. */
function everythingDrawn(): SettingsSearchInput {
  return searchInput({
    settings: settings({
      credentialSources: {
        ...settings().credentialSources,
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
        [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
      },
      // The key half live is what draws the OpenAI row on the front page.
      voiceSource: VOICE_SOURCE.KEY,
      calendarSignInAvailable: true,
      linearSignInAvailable: true,
      calendarAccounts: [{ id: "dev@example.com", selectedCalendarIds: [] }],
    }),
    superset: { installed: true, connected: true, agentsOffered: true },
    workspaceProjects: [
      { id: CREDENTIAL_PROVIDER_ID.CONDUCTOR, name: "Conductor" },
      { id: "superset", name: "Superset" },
    ],
  });
}

function labels(entries: readonly SettingsSearchEntry[]): readonly string[] {
  return entries.map((entry) => entry.label);
}

/** The kept rows across every group, in the order the groups draw them. */
function found(outcome: SettingsSearchOutcome | undefined): readonly SettingsSearchEntry[] {
  assert.ok(outcome, "the query is a search");
  return outcome.groups.flatMap((group) => group.items);
}

test("every setting the guide lists is findable on the page its schema names", () => {
  // The corpus is built from the same guide entries the voice conversation is
  // handed, so a setting Luke can describe is a setting the search can find —
  // under its guide label, on its schema page, carrying its own id as the
  // landing anchor.
  const input = everythingDrawn();
  const entries = settingsSearchEntries(input);
  for (const setting of settingGuideEntries(input.settings)) {
    const field = settingFieldForGuideId(setting.id);
    assert.ok(field, `${setting.id} belongs to a schema field`);
    const entry = entries.find((candidate) => candidate.id === setting.id);
    assert.ok(entry, `the corpus offers ${setting.label}`);
    assert.equal(entry.label, setting.label, setting.id);
    assert.equal(entry.page, APP_SETTING_SCHEMA[field].settingsPage, setting.label);
  }
});

test("a row a page is not drawing is not offered", () => {
  // A result that leads to a page without its row is a promise the page
  // cannot keep, so each conditional row answers to the condition that
  // draws it.
  const bare = labels(settingsSearchEntries(searchInput({ voiceControlsDrawn: false })));
  assert.ok(!bare.includes("Captions"), "no voice controls until voice can run");
  assert.ok(!bare.includes("Pause announcements"), "the pause rides the voice controls");
  assert.ok(!bare.includes("Quiet during meetings"), "no quiet row without a calendar account");
  assert.ok(!bare.includes("Linear"), "no Linear row without its OAuth client");
  assert.ok(!bare.includes("Superset"), "no Superset row while it is not installed");
  assert.ok(!bare.includes("New Conductor agents run"), "no agent row while disconnected");
  assert.ok(
    !bare.includes("Conductor default project"),
    "no project row while none offers projects",
  );

  const wide = labels(settingsSearchEntries(everythingDrawn()));
  for (const label of [
    "Captions",
    "Quiet during meetings",
    "Linear",
    "Superset",
    "New Conductor agents run",
    // Two providers offer projects, so each Default project row is its own
    // result, named for its provider and landing on its own row.
    "Conductor default project",
    "Superset default project",
  ]) {
    assert.ok(wide.includes(label), `${label} is offered once its row is drawn`);
  }

  // The ways out — and the Provider section, key row included —
  // belong to a signed-in account alone.
  const signedOut = labels(settingsSearchEntries(searchInput({ accountDrawn: false })));
  assert.ok(!signedOut.includes("Sign out"));
  assert.ok(!signedOut.includes("Delete account"));
  assert.ok(!signedOut.includes("Provider"));
  assert.ok(!signedOut.includes("OpenAI API key"));

  // On the account, the key row is not drawn — the section's own entry is
  // what a key-shaped query finds, because its toggle is where a key begins.
  const hosted = settingsSearchEntries(searchInput());
  assert.ok(!labels(hosted).includes("OpenAI API key"));
  assert.ok(labels(found(searchSettings(hosted, "openai"))).includes("Provider"));
});

test("ids and labels are unique, so a result names exactly one row", () => {
  // The id is the drawn list's key and the landing's anchor; the label is
  // what a reader tells results apart by. Neither may collide.
  const entries = settingsSearchEntries(everythingDrawn());
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  assert.equal(new Set(labels(entries)).size, entries.length);
});

test("a query narrows by every word, case-blind, and a blank query is no search", () => {
  const entries = settingsSearchEntries(everythingDrawn());
  assert.equal(searchSettings(entries, ""), undefined);
  assert.equal(searchSettings(entries, "   "), undefined);

  const dock = searchSettings(entries, "DOCK");
  assert.ok(dock);
  assert.deepEqual(labels(found(dock)), ["Show Luke in the Dock"]);
  assert.equal(dock.matched, 1);
  assert.equal(dock.searched, entries.length);

  // Both words must land: "quiet" alone finds several rows, "quiet music" one.
  const quiet = labels(found(searchSettings(entries, "quiet")));
  assert.ok(quiet.includes("Quiet Music and Spotify"));
  assert.ok(quiet.includes("Quiet during meetings"));
  assert.deepEqual(labels(found(searchSettings(entries, "quiet music"))), [
    "Quiet Music and Spotify",
  ]);

  // A description is part of the haystack, so a row is found by what it does.
  const bluetooth = labels(found(searchSettings(entries, "bluetooth")));
  assert.ok(bluetooth.includes("Prefer the Mac's microphone"));

  const captions = searchSettings(entries, "captions");
  assert.equal(found(captions)[0]?.page, SETTINGS_VIEW.VOICE);
});

test("the kept rows come back grouped under their pages, in the pages' order", () => {
  const entries = settingsSearchEntries(everythingDrawn());

  // "shortcut" lands only on the Keyboard shortcuts page, so one group holds
  // the three key rows.
  const shortcuts = searchSettings(entries, "shortcut");
  assert.ok(shortcuts);
  assert.equal(shortcuts.groups.length, 1);
  assert.equal(shortcuts.groups[0]?.page, SETTINGS_VIEW.SHORTCUTS);
  assert.deepEqual(labels(shortcuts.groups[0]?.items ?? []), [
    "Talk to Luke",
    "Ask Luke",
    "Stop Luke",
  ]);
  assert.equal(shortcuts.matched, 3);

  // "key" lands on Voice and two later pages; the groups keep the front
  // page's navigation order.
  const keys = searchSettings(entries, "key");
  assert.ok(keys);
  assert.equal(keys.groups[0]?.page, SETTINGS_VIEW.VOICE);
  const pages = keys.groups.map((group) => group.page);
  assert.deepEqual(
    pages,
    [SETTINGS_VIEW.VOICE, SETTINGS_VIEW.SHORTCUTS, SETTINGS_VIEW.CONNECTIONS],
    "groups follow the nav's order",
  );
});
test("the rows that are not settings are found by what they are", () => {
  const entries = settingsSearchEntries(everythingDrawn());

  // Every key row answers to "api key": the voice key on the Voice page and
  // each cloud agent's under Connections.
  const keys = labels(found(searchSettings(entries, "api key")));
  assert.ok(keys.includes("OpenAI API key"));
  for (const provider of CLOUD_AGENT_PROVIDER_LIST) {
    assert.ok(keys.includes(provider.displayName), provider.displayName);
  }

  const signOut = found(searchSettings(entries, "sign out"));
  assert.equal(signOut.find((entry) => entry.label === "Sign out")?.page, SETTINGS_VIEW.ROOT);
});

test("a page's own name finds everything the page holds", () => {
  // Each entry carries its page's word in its haystack, so someone who only
  // remembers where a row lives can still get there — the whole page comes
  // back as one group.
  const entries = settingsSearchEntries(everythingDrawn());
  const connections = searchSettings(entries, "connections");
  assert.ok(connections);
  assert.equal(connections.groups.length, 1);
  assert.equal(connections.groups[0]?.page, SETTINGS_VIEW.CONNECTIONS);
  assert.equal(
    connections.matched,
    entries.filter((entry) => entry.page === SETTINGS_VIEW.CONNECTIONS).length,
  );
});
