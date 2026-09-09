import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_SETTING_VALUE } from "@sidecar/analytics";
import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_SOURCE } from "@sidecar/credentials/vocabulary";
import {
  APP_SETTING_ID,
  APP_SETTING_ID_LIST,
  APP_SETTING_KIND,
  isAppSettingId,
} from "@sidecar/guide";
import { PROVIDER_ID, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  SETTING_ROWS,
  SETTING_SECTION,
  SETTING_SIDE_EFFECT,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
} from "./schema.js";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_FIELDS,
  type AppSettingField,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingsResetScope,
  SETTING_PAGE,
  settingAnalytics,
  settingEntryGuard,
  settingFieldForGuideId,
  settingGuideEntries,
  settingIdVisible,
  settingRowsForPage,
  settingsScopeChanged,
  settingVisible,
  spokenSettingValue,
} from "./schema-access.js";
import type { StoredSettingValue } from "./schema-types.js";
import { settingsView, settingsVisibility } from "./testing.js";

/** Every guide entry one field builds, over the defaults. */
function entriesFor(field: AppSettingField) {
  const read = (name: string): StoredSettingValue =>
    // SAFETY: The guard narrows the name to a field the defaults are keyed by.
    isAppSettingField(name) ? APP_SETTING_DEFAULTS[name] : undefined;
  const built = APP_SETTING_SCHEMA[field].guide(read);
  if (built === undefined) return [];
  return Array.isArray(built) ? built : [built];
}

/** One value of each runtime family, so every guard is offered a wrong shape. */
const HOSTILE_VALUES = ["nonsense", 7, true, ["nonsense"], { nonsense: true }, null] as const;

test("every field's own declaration answers for everything read of it", () => {
  const orders = new Map<number, AppSettingField>();
  for (const field of APP_SETTING_FIELDS) {
    const entry = APP_SETTING_SCHEMA[field];

    // The key and the declared name agree, or a write lands on another field.
    assert.equal(entry.field, field);

    // A default no guard accepts is a store that rejects its own initial state.
    const parsedDefault = entry.guard(entry.default);
    assert.equal(parsedDefault.valid, true, field);
    assert.deepEqual(parsedDefault.value, entry.default, field);

    // Absence is either the stored value or refused for the default; a guard
    // that answered something else would put a third state in the store.
    const parsedAbsent = entry.guard(undefined);
    if (parsedAbsent.valid) assert.equal(parsedAbsent.value, undefined, field);
    else assert.deepEqual(parsedAbsent.value, entry.default, field);

    // Whatever a guard answers is a value it would answer again: a store
    // reading its own file back can never be handed a third shape.
    for (const hostile of HOSTILE_VALUES) {
      const parsed = entry.guard(hostile);
      // SAFETY: A guard's own answer is a stored value, which every guard reads.
      const reparsed = entry.guard(parsed.value as never);
      assert.equal(reparsed.valid, true, `${field} re-reads ${JSON.stringify(hostile)}`);
      assert.deepEqual(reparsed.value, parsed.value, field);
    }

    // The order is what places the row, so two rows cannot claim one place.
    assert.equal(orders.get(entry.order), undefined, `${field} shares an order`);
    orders.set(entry.order, field);

    assert.ok(Object.values(SETTINGS_PAGE).includes(entry.page), field);
    assert.ok(Object.values(SETTING_SECTION).includes(entry.section), field);
    assert.ok(Object.values(SETTING_SIDE_EFFECT).includes(entry.sideEffect), field);
    assert.ok(entry.resetScope === undefined || isSettingsResetScope(entry.resetScope), field);
    for (const id of entry.ids) assert.ok(isAppSettingId(id), `${field} names ${id}`);

    // A row `SchemaSettingRows` draws is one the guide describes, since the
    // guide entry is what it draws from; a field nothing draws describes no
    // row of its own. A bespoke row in between may have neither, because what
    // covers it is the context its own provider's projects travel in.
    if (entry.rows === SETTING_ROWS.SCHEMA) assert.ok(entry.ids.length > 0, field);
    if (entry.rows === SETTING_ROWS.NONE) assert.equal(entry.ids.length, 0, field);

    // Nothing is counted that has no id to count under.
    assert.ok(entry.analytics === undefined || entry.ids.length > 0, field);

    // A row cannot answer to two records of the same condition.
    assert.ok(entry.visible === undefined || entry.visibleById === undefined, field);

    const built = entriesFor(field);
    for (const guideEntry of built) {
      // A row has to say what it is set to and what its default is; a choice
      // with no default and no word for nothing would read as blank.
      assert.notEqual(guideEntry.value, "", guideEntry.id);
      assert.notEqual(guideEntry.defaultValue, "", guideEntry.id);

      // SAFETY: The built entry's id is checked against the field's own list.
      assert.ok(entry.ids.includes(guideEntry.id as never), `${field} builds ${guideEntry.id}`);

      // The by-hand path names the page the schema puts the row on, so the
      // sentence and the page cannot say different things.
      const page = SETTINGS_PAGE_WORD[entry.page];
      assert.ok(guideEntry.manual.includes(page), `${guideEntry.id} points at ${page}`);
    }

    // `SchemaSettingRows` draws a switch or a pop-up and nothing else, and
    // whichever it draws reads its own stored value back unchanged.
    if (entry.rows === SETTING_ROWS.SCHEMA) {
      assert.equal(built.length, 1, field);
      const drawn = built[0];
      if (drawn?.kind === APP_SETTING_KIND.TOGGLE) {
        assert.deepEqual(
          spokenSettingValue(field, drawn.value),
          APP_SETTING_DEFAULTS[field],
          field,
        );
      } else {
        assert.equal(drawn?.kind, APP_SETTING_KIND.CHOICE, field);
        const control = entry.control;
        assert.ok(control, `${field} draws a pop-up`);
        const view = settingsVisibility();
        // SAFETY: The control belongs to this entry, so its stored type is this default's.
        const stored = entry.default as never;
        assert.deepEqual(
          control.stored(control.value(stored), view),
          entry.default,
          `${field} reads its own token back`,
        );
      }
    }

    // A map-valued field is exactly one that declares how a key is written.
    assert.equal(isKeyedAppSettingField(field), "entry" in entry, field);
  }
});

/** How each page's own name reads in a by-hand path. */
const SETTINGS_PAGE_WORD = {
  [SETTINGS_PAGE.ROOT]: "Settings tab",
  [SETTINGS_PAGE.VOICE]: "Voice page",
  [SETTINGS_PAGE.APPEARANCE]: "Appearance page",
  [SETTINGS_PAGE.SHORTCUTS]: "Settings tab",
  [SETTINGS_PAGE.CONNECTIONS]: "Connections page",
} satisfies Record<string, string>;

test("every settings id is described by exactly one field, and placed on one page", () => {
  // The ids the guide, the counts, and a spoken change all name are one set,
  // and every member of it belongs to one field — an id described twice would
  // be two rows claiming the same change.
  const claimed = new Map<string, AppSettingField>();
  for (const field of APP_SETTING_FIELDS) {
    for (const id of APP_SETTING_SCHEMA[field].ids) {
      assert.equal(claimed.get(id), undefined, `${id} is claimed twice`);
      claimed.set(id, field);
      assert.equal(settingFieldForGuideId(id), field, id);
    }
  }
  for (const id of APP_SETTING_ID_LIST) {
    // Which calendars count is chosen on the rows themselves, so it is the one
    // id no field stores; the page table names it all the same.
    if (id === APP_SETTING_ID.CALENDAR_SELECTED) {
      assert.equal(claimed.get(id), undefined);
      assert.equal(SETTING_PAGE[id], SETTINGS_PAGE.CONNECTIONS);
      continue;
    }
    const field = claimed.get(id);
    assert.ok(field, `${id} is described by a field`);
    assert.equal(SETTING_PAGE[id], APP_SETTING_SCHEMA[field].page, id);
  }
});

test("a change is counted under the field's first id, and never carries a value", () => {
  // Several guide entries can ride one stored write, so the field's first id
  // is what a count is filed under; the reading is the shape of the value and
  // never the value.
  for (const field of APP_SETTING_FIELDS) {
    const entry = APP_SETTING_SCHEMA[field];
    const analytics = settingAnalytics(field, settingsView());
    if (!entry.analytics) {
      assert.equal(analytics, undefined, field);
      continue;
    }
    assert.ok(analytics, field);
    assert.equal(analytics.id, entry.ids[0], field);
    assert.ok(Object.values(PRODUCT_SETTING_VALUE).includes(analytics.value), field);
  }
});

test("a scope reads unchanged at its defaults and changed by one of its own fields", () => {
  const defaults = settingsView(APP_SETTING_DEFAULTS);
  for (const scope of Object.values(SETTINGS_RESET_SCOPE)) {
    assert.equal(settingsScopeChanged(defaults, scope), false, scope);
  }
  const moved = settingsView({ ...APP_SETTING_DEFAULTS, openAtLogin: false });
  assert.equal(settingsScopeChanged(moved, SETTINGS_RESET_SCOPE.APPEARANCE), true);
  // A field outside the scope moves nothing in it.
  assert.equal(settingsScopeChanged(moved, SETTINGS_RESET_SCOPE.VOICE), false);
});

test("a keyed field validates one entry exactly as its whole map would", () => {
  assert.deepEqual(settingEntryGuard("workspaceProjectDefaults", PROVIDER_ID.CONDUCTOR, "repo"), {
    valid: true,
    value: "repo",
  });
  // A key the map's own guard drops is one no entry write can slip past.
  assert.equal(
    settingEntryGuard("workspaceProjectDefaults", PROVIDER_ID.CONDUCTOR, "   ").valid,
    false,
  );
  assert.equal(
    settingEntryGuard("workspaceAgentDefaults", SUPERSET_WORKSPACE_PROVIDER_ID, { agent: 7 }).valid,
    false,
  );
});

test("a setting says for itself whether its row is drawn", () => {
  // The panel and the search read this one answer, so a result can never lead
  // to a page without its row.
  const resting = settingsVisibility();
  assert.equal(settingVisible("voiceCaptions", resting), false);
  assert.equal(settingVisible("voiceSource", resting), false);
  assert.equal(settingVisible("quietDuringMeetings", resting), false);
  // A setting that names no condition is always drawn.
  assert.equal(settingVisible("openAtLogin", resting), true);

  assert.equal(
    settingVisible("voiceCaptions", settingsVisibility({ voiceControlsDrawn: true })),
    true,
  );
  assert.equal(settingVisible("voiceSource", settingsVisibility({ accountDrawn: true })), true);
  // The quiet rides the calendars: a Google account, or this Mac's own.
  assert.equal(
    settingVisible(
      "quietDuringMeetings",
      settingsVisibility({
        settings: {
          calendarSignInAvailable: true,
          calendarAccounts: [{ id: "dev@example.com", selectedCalendarIds: [] }],
        },
      }),
    ),
    true,
  );
  assert.equal(
    settingVisible(
      "quietDuringMeetings",
      settingsVisibility({ settings: { appleCalendar: { id: "apple", selectedCalendarIds: [] } } }),
    ),
    true,
  );
});

test("a field whose entries stand under conditions of their own answers per id", () => {
  // The Conductor rows need a connected Conductor the build has a model table
  // for; the Superset row needs a connected Superset offering agents.
  const conductor = settingsVisibility({
    settings: {
      credentialSources: {
        ...settingsView().credentialSources,
        [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
      },
    },
  });
  assert.equal(settingIdVisible(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, conductor), true);
  assert.equal(settingIdVisible(APP_SETTING_ID.SUPERSET_AGENT, conductor), false);

  const superset = settingsVisibility({
    superset: { installed: true, connected: true, agents: ["codex"] },
  });
  assert.equal(settingIdVisible(APP_SETTING_ID.SUPERSET_AGENT, superset), true);
  assert.equal(settingIdVisible(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, superset), false);

  // An id no field claims is drawn nowhere rather than everywhere.
  assert.equal(settingIdVisible(APP_SETTING_ID.CALENDAR_SELECTED, superset), false);
});

test("a page's section draws its own members, in the order they claim", () => {
  const view = settingsVisibility({ voiceControlsDrawn: true, accountDrawn: true });
  const appearance = settingRowsForPage(SETTINGS_PAGE.APPEARANCE, SETTING_SECTION.MAIN, view);
  assert.deepEqual(
    appearance.map((row) => row.field),
    ["openAtLogin", "showInDock", "showOnAllDisplays", "formFactor"],
  );
  const voice = settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view);
  assert.deepEqual(
    voice.map((row) => row.field),
    [
      "voice",
      "voiceSpeed",
      "voiceCaptions",
      "duckOtherMedia",
      "preferBuiltInMicrophone",
      "announceSessions",
    ],
  );
  // The credential picker draws the source itself, so the controls do not.
  assert.ok(!voice.some((row) => row.field === "voiceSource"));
  // Nothing draws a row for a setting whose condition is unmet.
  assert.deepEqual(
    settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, settingsVisibility()),
    [],
  );
});

test("a choice row's control offers what its own values say, worded for a control", () => {
  const view = settingsVisibility({ voiceControlsDrawn: true });
  const [speed] = settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view).filter(
    (row) => row.field === "voiceSpeed",
  );
  assert.ok(speed?.control);
  // The guide offers the word and the multiple; the control wears the
  // multiple alone, and the token it stores is the word either way.
  assert.deepEqual(
    speed.control.options.map((option) => option.value),
    ["slow", "normal", "quick", "fast"],
  );
  assert.deepEqual(
    speed.control.options.map((option) => option.label),
    ["0.75×", "1× (default)", "1.25×", "1.5×"],
  );
  assert.equal(speed.control.value, "normal");
  assert.equal(speed.changed, false);

  // The default-workspace row offers what the observation reported and one
  // token for no default at all, which no provider id can collide with.
  const workspaces = settingRowsForPage(
    SETTINGS_PAGE.CONNECTIONS,
    SETTING_SECTION.WORKSPACES,
    settingsVisibility({
      workspaceProviders: [{ id: PROVIDER_ID.CODEX, name: "Codex", offersProjects: true }],
    }),
  );
  assert.deepEqual(workspaces[0]?.control?.options, [
    { value: "", label: "Ask each time" },
    { value: PROVIDER_ID.CODEX, label: "Codex" },
  ]);
  assert.equal(workspaces[0]?.control?.value, "");
});

test("nothing the guide says about a setting names a credential or its shape", () => {
  // The guide leaves the machine, so no settings entry may carry a key, a
  // key's shape, or an environment variable's name.
  const forbidden = [/sk-/i, /_API_KEY/, /secret/i, /token/i, /password/i];
  for (const entry of settingGuideEntries(settingsView())) {
    const lines = [
      entry.label,
      entry.description,
      entry.value,
      entry.defaultValue ?? "",
      entry.manual,
      ...(entry.choices ?? []),
    ];
    for (const line of lines) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(line), `${entry.id} says "${line}"`);
      }
    }
  }
});
