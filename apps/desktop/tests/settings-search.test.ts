import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_FORM_FACTOR, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/core";
import {
  type SettingsSearchEntry,
  type SettingsSearchInput,
  searchSettings,
  settingsSearchEntries,
} from "../src/renderer/settings-search";
import { SETTINGS_VIEW } from "../src/renderer/settings-views";
import type { AppSettings } from "../src/shared/contracts";
import {
  CLI_CONNECTION,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  VOICE_SOURCE,
} from "../src/shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDER_ID,
} from "../src/shared/credential-providers";
import { isAppSettingId, SETTING_PAGE, settingGuideEntries } from "../src/shared/settings-schema";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.COPILOT]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.CURSOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.DEVIN]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.JULES]: CREDENTIAL_SOURCE.NONE,
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
    calendarSignInAvailable: false,
    linearSignInAvailable: false,
    calendarAccounts: [],
    showOnAllDisplays: false,
    shareUsageData: true,
    formFactor: PANEL_FORM_FACTOR.BUBBLE,
    ...overrides,
  };
}

function searchInput(overrides: Partial<SettingsSearchInput> = {}): SettingsSearchInput {
  return {
    settings: settings(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    superset: { installed: false, connected: false, agentsOffered: false },
    defaultProjectOffered: false,
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
      },
      calendarSignInAvailable: true,
      linearSignInAvailable: true,
      calendarAccounts: [{ id: "dev@example.com", selectedCalendarIds: [] }],
    }),
    superset: { installed: true, connected: true, agentsOffered: true },
    defaultProjectOffered: true,
  });
}

function labels(entries: readonly SettingsSearchEntry[]): readonly string[] {
  return entries.map((entry) => entry.label);
}

test("every setting the guide lists is findable on the page its schema names", () => {
  // The corpus is built from the same guide entries the voice conversation is
  // handed, so a setting Luke can describe is a setting the search can find —
  // under its guide label, on its schema page, carrying its own id as the
  // landing mark.
  const input = everythingDrawn();
  const entries = settingsSearchEntries(input);
  for (const setting of settingGuideEntries(input.settings)) {
    assert.ok(isAppSettingId(setting.id), `${setting.id} is a schema id`);
    const found = entries.find((entry) => entry.label === setting.label);
    assert.ok(found, `the corpus offers ${setting.label}`);
    assert.equal(found.page, SETTING_PAGE[setting.id], setting.label);
    assert.equal(found.target, setting.id, setting.label);
  }
});

test("a row a page is not drawing is not offered", () => {
  // A result that leads to a page without its row is a promise the page
  // cannot keep, so each conditional row answers to the condition that
  // draws it.
  const bare = labels(settingsSearchEntries(searchInput({ voiceControlsDrawn: false })));
  assert.ok(!bare.includes("Captions"), "no voice controls until voice can run");
  assert.ok(!bare.includes("Quiet during meetings"), "no quiet row without a calendar account");
  assert.ok(!bare.includes("Linear"), "no Linear row without its OAuth client");
  assert.ok(!bare.includes("Superset"), "no Superset row while it is not installed");
  assert.ok(!bare.includes("New Conductor agents run"), "no agent row while disconnected");
  assert.ok(!bare.includes("Default project"), "no project row while none offers projects");

  const wide = labels(settingsSearchEntries(everythingDrawn()));
  for (const label of [
    "Captions",
    "Quiet during meetings",
    "Linear",
    "Superset",
    "New Conductor agents run",
    "Default project",
  ]) {
    assert.ok(wide.includes(label), `${label} is offered once its row is drawn`);
  }

  // The ways out belong to a signed-in account alone.
  const signedOut = labels(settingsSearchEntries(searchInput({ accountDrawn: false })));
  assert.ok(!signedOut.includes("Sign out"));
  assert.ok(!signedOut.includes("Delete account"));
});

test("labels are unique, so a result names exactly one row", () => {
  const entries = settingsSearchEntries(everythingDrawn());
  assert.equal(new Set(labels(entries)).size, entries.length);
});

test("a query narrows by every word, case-blind, and a blank query is no search", () => {
  const entries = settingsSearchEntries(everythingDrawn());
  assert.equal(searchSettings(entries, ""), undefined);
  assert.equal(searchSettings(entries, "   "), undefined);

  const dock = searchSettings(entries, "DOCK");
  assert.ok(dock);
  assert.deepEqual(labels(dock.results), ["Show Luke in the Dock"]);
  assert.equal(dock.searched, entries.length);

  // Both words must land: "quiet" alone finds two rows, "quiet music" one.
  const quiet = searchSettings(entries, "quiet");
  assert.ok(quiet);
  assert.ok(labels(quiet.results).includes("Quiet Music and Spotify"));
  assert.ok(labels(quiet.results).includes("Quiet during meetings"));
  const quietMusic = searchSettings(entries, "quiet music");
  assert.ok(quietMusic);
  assert.deepEqual(labels(quietMusic.results), ["Quiet Music and Spotify"]);

  // A description is part of the haystack, so a row is found by what it does.
  const bluetooth = searchSettings(entries, "bluetooth");
  assert.ok(bluetooth);
  assert.ok(labels(bluetooth.results).includes("Prefer the Mac's microphone"));

  const captions = searchSettings(entries, "captions");
  assert.ok(captions);
  assert.equal(captions.results[0]?.page, SETTINGS_VIEW.VOICE);
});

test("the rows that are not settings are found by what they are", () => {
  const entries = settingsSearchEntries(everythingDrawn());

  const shortcuts = searchSettings(entries, "shortcut");
  assert.ok(shortcuts);
  assert.deepEqual(labels(shortcuts.results), ["Talk to Luke", "Ask Luke", "Stop Luke"]);
  for (const entry of shortcuts.results) {
    assert.equal(entry.page, SETTINGS_VIEW.SHORTCUTS);
  }

  // Every key row answers to "api key": the voice key on the front page and
  // each cloud agent's under Connections.
  const keys = searchSettings(entries, "api key");
  assert.ok(keys);
  assert.ok(labels(keys.results).includes("OpenAI API key"));
  for (const provider of CLOUD_AGENT_PROVIDER_LIST) {
    assert.ok(labels(keys.results).includes(provider.displayName), provider.displayName);
  }

  const signOut = searchSettings(entries, "sign out");
  assert.ok(signOut);
  assert.ok(labels(signOut.results).includes("Sign out"));
  assert.equal(
    signOut.results.find((entry) => entry.label === "Sign out")?.page,
    SETTINGS_VIEW.ROOT,
  );
});

test("a page's own name finds everything the page holds", () => {
  // Each entry carries its page's word in its haystack, so someone who only
  // remembers where a row lives can still get there.
  const entries = settingsSearchEntries(everythingDrawn());
  const connections = searchSettings(entries, "connections");
  assert.ok(connections);
  assert.ok(connections.results.length > 0);
  for (const entry of connections.results) {
    assert.equal(entry.page, SETTINGS_VIEW.CONNECTIONS);
  }
  assert.equal(
    connections.results.length,
    entries.filter((entry) => entry.page === SETTINGS_VIEW.CONNECTIONS).length,
  );
});
