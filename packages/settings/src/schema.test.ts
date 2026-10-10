import assert from "node:assert/strict";
import { PRODUCT_SETTING_VALUE } from "@sidecar/analytics";
import { APP_SETTING_ID, APP_SETTING_KIND, isAppSettingId } from "@sidecar/guide";
import { isLiveVoice, LIVE_DEFAULTS, LIVE_VOICE, LIVE_VOICE_LIST } from "@sidecar/live";
import { test } from "vitest";
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
  describedSettings,
  isAppSettingField,
  isSettingsResetScope,
  settingAnalytics,
  settingFieldForId,
  settingIdVisible,
  settingRowsForPage,
  settingsScopeChanged,
} from "./schema-access.js";
import type { StoredSettingValue } from "./schema-types.js";
import { settingsView, settingsVisibility } from "./testing.js";

/** Every description one field builds, over the defaults. */
function entriesFor(field: AppSettingField) {
  const read = (name: string): StoredSettingValue =>
    // SAFETY: The guard narrows the name to a field the defaults are keyed by.
    isAppSettingField(name) ? APP_SETTING_DEFAULTS[name] : undefined;
  const built = APP_SETTING_SCHEMA[field].describe(read);
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

    // A row `SchemaSettingRows` draws is one with an id, since the row wears
    // it as the anchor the settings search lands on.
    if (entry.rows === SETTING_ROWS.SCHEMA) assert.ok(entry.ids.length > 0, field);

    // Nothing is counted that has no id to count under.
    assert.ok(entry.analytics === undefined || entry.ids.length > 0, field);

    const built = entriesFor(field);
    for (const described of built) {
      // A row has to say what it is set to; a choice with no default and no
      // word for nothing would read as blank.
      assert.notEqual(described.value, "", described.id);

      // SAFETY: The built entry's id is checked against the field's own list.
      assert.ok(entry.ids.includes(described.id as never), `${field} builds ${described.id}`);
    }

    // `SchemaSettingRows` draws a switch or a pop-up and nothing else, and
    // whichever it draws reads its own stored value back unchanged.
    if (entry.rows === SETTING_ROWS.SCHEMA) {
      assert.equal(built.length, 1, field);
      const drawn = built[0];
      if (drawn?.kind !== APP_SETTING_KIND.TOGGLE) {
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
  }
});

test("every settings id a field describes is described by that field alone", () => {
  // The ids the rows, the search, and the counts all name are one set, and
  // every member a field claims belongs to that one field — an id described
  // twice would be two rows claiming the same change.
  const claimed = new Map<string, AppSettingField>();
  for (const field of APP_SETTING_FIELDS) {
    for (const id of APP_SETTING_SCHEMA[field].ids) {
      assert.equal(claimed.get(id), undefined, `${id} is claimed twice`);
      claimed.set(id, field);
      assert.equal(settingFieldForId(id), field, id);
    }
  }
});

test("a change is counted under the field's first id, and never carries a value", () => {
  // Several descriptions can ride one stored write, so the field's first id
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

test("an id no field claims is drawn nowhere rather than everywhere", () => {
  const view = settingsVisibility({ voiceControlsDrawn: true, accountDrawn: true });
  assert.equal(settingIdVisible(APP_SETTING_ID.CALENDAR_SELECTED, view), false);
  assert.equal(settingIdVisible(APP_SETTING_ID.VOICE, view), true);
});

test("a page's section draws its own members, in the order they claim", () => {
  const view = settingsVisibility({ voiceControlsDrawn: true, accountDrawn: true });
  const appearance = settingRowsForPage(SETTINGS_PAGE.APPEARANCE, SETTING_SECTION.MAIN, view);
  assert.deepEqual(
    appearance.map((row) => row.field),
    ["theme", "openAtLogin", "showInDock"],
  );
  const voice = settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view);
  assert.deepEqual(
    voice.map((row) => row.field),
    ["voice", "voiceCaptions", "duckOtherMedia", "preferBuiltInMicrophone"],
  );
  // Nothing draws a row for a setting whose condition is unmet.
  assert.deepEqual(
    settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, settingsVisibility()),
    [],
  );
});

test("a choice row's control offers what its own values say, worded for a control", () => {
  const view = settingsVisibility({ voiceControlsDrawn: true });
  const [voice] = settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view).filter(
    (row) => row.field === "voice",
  );
  assert.ok(voice?.control);
  // Every voice the Live API speaks is offered, with the default among them;
  // the default carries its status into the menu alone.
  const offered = voice.control.options.map((option) => option.value);
  assert.deepEqual(offered, LIVE_VOICE_LIST);
  assert.equal(offered.every(isLiveVoice), true);
  assert.equal(offered.includes(LIVE_DEFAULTS.VOICE), true);
  assert.deepEqual(
    voice.control.options
      .filter((option) => option.label.endsWith("(default)"))
      .map((option) => option.value),
    [LIVE_DEFAULTS.VOICE],
  );
  assert.equal(voice.control.value, LIVE_VOICE.CEDAR);
  assert.equal(voice.changed, true);
  const [resting] = settingRowsForPage(
    SETTINGS_PAGE.VOICE,
    SETTING_SECTION.CONTROLS,
    settingsVisibility({ voiceControlsDrawn: true, settings: { voice: LIVE_DEFAULTS.VOICE } }),
  ).filter((row) => row.field === "voice");
  assert.equal(resting?.changed, false);
});

test("nothing a setting says about itself names a credential or its shape", () => {
  // No settings description may carry a key, a key's shape, or an
  // environment variable's name.
  const forbidden = [/sk-/i, /_API_KEY/, /secret/i, /token/i, /password/i];
  for (const entry of describedSettings(settingsView())) {
    const lines = [entry.label, entry.description, entry.value];
    for (const line of lines) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(line), `${entry.id} says "${line}"`);
      }
    }
  }
});
