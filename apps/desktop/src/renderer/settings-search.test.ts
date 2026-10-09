import assert from "node:assert/strict";
import { APP_SETTING_SCHEMA, settingFieldForGuideId, settingGuideEntries } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettingsView } from "@sidecar/settings/wire";
import { test } from "vitest";
import {
  type SettingsSearchEntry,
  type SettingsSearchInput,
  type SettingsSearchOutcome,
  searchSettings,
  settingsSearchEntries,
} from "./settings-search";
import { SETTINGS_VIEW } from "./settings-views";

function settings(overrides: Partial<AppSettingsView> = {}): AppSettingsView {
  return settingsView({ voiceAvailable: true, preferBuiltInMicrophone: true, ...overrides });
}

function searchInput(overrides: Partial<SettingsSearchInput> = {}): SettingsSearchInput {
  return {
    settings: settings(),
    voiceControlsDrawn: true,
    accountDrawn: true,
    ...overrides,
  };
}

/** An input with every conditional row drawn, so the corpus is at its widest. */
function everythingDrawn(): SettingsSearchInput {
  return searchInput();
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
    assert.equal(entry.page, APP_SETTING_SCHEMA[field].page, setting.label);
  }
});

test("a row a page is not drawing is not offered", () => {
  // A result that leads to a page without its row is a promise the page
  // cannot keep, so each conditional row answers to the condition that
  // draws it — a setting's own, declared on its schema entry, and the
  // remaining rows' here.
  const bare = labels(settingsSearchEntries(searchInput({ voiceControlsDrawn: false })));
  assert.ok(!bare.includes("Captions"), "no voice controls until voice can run");

  const wide = labels(settingsSearchEntries(everythingDrawn()));
  assert.ok(wide.includes("Captions"), "Captions is offered once its row is drawn");

  // The ways out belong to a signed-in account alone.
  const signedOut = labels(settingsSearchEntries(searchInput({ accountDrawn: false })));
  assert.ok(!signedOut.includes("Sign out"));
  assert.ok(!signedOut.includes("Delete account"));

  // Voice runs on the account alone, so no row offers a key for it and no
  // key-shaped query finds one.
  const hosted = settingsSearchEntries(searchInput());
  assert.ok(!labels(hosted).includes("OpenAI API key"));
  assert.deepEqual(labels(found(searchSettings(hosted, "openai"))), []);
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

  // Both words must land: "microphone" alone finds several rows, "microphone
  // bluetooth" one.
  const microphone = labels(found(searchSettings(entries, "microphone")));
  assert.ok(microphone.length > 1);
  assert.deepEqual(labels(found(searchSettings(entries, "microphone bluetooth"))), [
    "Prefer the Mac's microphone",
  ]);
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
  // the two keys first and the window's own chords after them.
  const shortcuts = searchSettings(entries, "shortcut");
  assert.ok(shortcuts);
  assert.equal(shortcuts.groups.length, 1);
  assert.equal(shortcuts.groups[0]?.page, SETTINGS_VIEW.SHORTCUTS);
  const kept = labels(shortcuts.groups[0]?.items ?? []);
  assert.deepEqual(kept.slice(0, 2), ["Talk to Luke", "Stop Luke"]);
  assert.ok(kept.includes("New plan"));
  assert.ok(kept.includes("Toggle sidebar"));

  // "microphone" lands on the Voice page's rows and on the talk key, which
  // holds one open, and the groups keep the front page's navigation order.
  const microphone = searchSettings(entries, "microphone");
  assert.ok(microphone);
  assert.deepEqual(
    microphone.groups.map((group) => group.page),
    [SETTINGS_VIEW.VOICE, SETTINGS_VIEW.SHORTCUTS],
    "groups follow the nav's order",
  );
});

test("the rows that are not settings are found by what they are", () => {
  const entries = settingsSearchEntries(everythingDrawn());

  const signOut = found(searchSettings(entries, "sign out"));
  assert.equal(signOut.find((entry) => entry.label === "Sign out")?.page, SETTINGS_VIEW.ROOT);
});

test("a page's own name finds everything the page holds", () => {
  // Each entry carries its page's word in its haystack, so someone who only
  // remembers where a row lives can still get there — the whole page comes
  // back as one group.
  const entries = settingsSearchEntries(everythingDrawn());
  const appearance = searchSettings(entries, "appearance");
  assert.ok(appearance);
  assert.equal(appearance.groups.length, 1);
  assert.equal(appearance.groups[0]?.page, SETTINGS_VIEW.APPEARANCE);
  assert.equal(
    appearance.matched,
    entries.filter((entry) => entry.page === SETTINGS_VIEW.APPEARANCE).length,
  );
});

test("each of the window's own shortcuts is found by its name, on the Keyboard shortcuts page", () => {
  const entries = settingsSearchEntries(everythingDrawn());

  const remove = found(searchSettings(entries, "delete plan"));
  assert.deepEqual(labels(remove), ["Delete plan"]);
  assert.equal(remove[0]?.page, SETTINGS_VIEW.SHORTCUTS);
  // Removing is the two keys' own; no window chord offers it.
  assert.deepEqual(labels(found(searchSettings(entries, "shortcut remove"))), [
    "Talk to Luke",
    "Stop Luke",
  ]);
});
