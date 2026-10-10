import assert from "node:assert/strict";
import { test } from "vitest";
import {
  APP_SETTING_SCHEMA,
  isTheme,
  SETTING_SECTION,
  SETTINGS_PAGE,
  SETTINGS_RESET_SCOPE,
  settingFromOption,
  settingRowsForPage,
  settingsScopeChanged,
  THEME,
} from "./index.js";
import { APP_SETTING_DEFAULTS } from "./schema-access.js";
import { settingsView, settingsVisibility } from "./testing.js";
import { type AppSettings, appSettingsView } from "./wire.js";

/** The settings wire with every other field at its default and the theme as given. */
function wireWithTheme(theme: AppSettings["stored"]["theme"]): AppSettings {
  const { theme: _default, ...stored } = APP_SETTING_DEFAULTS;
  return {
    stored: theme === undefined ? stored : { ...stored, theme },
    status: { voiceAvailable: false },
  };
}

test("a theme nobody chose is Dark, and System is kept as System", () => {
  // An installation from before the setting existed has no theme at all.
  assert.equal(appSettingsView(wireWithTheme(undefined)).theme, THEME.DARK);
  assert.equal(appSettingsView(wireWithTheme(THEME.SYSTEM)).theme, THEME.SYSTEM);
  assert.equal(appSettingsView(wireWithTheme(THEME.LIGHT)).theme, THEME.LIGHT);
});

test("the store takes the three themes and nothing else", () => {
  const { guard } = APP_SETTING_SCHEMA.theme;
  for (const theme of [THEME.LIGHT, THEME.DARK, THEME.SYSTEM]) {
    assert.deepEqual(guard(theme), { valid: true, value: theme });
  }
  for (const refused of ["sepia", "Dark", "auto", "", 1, true, null]) {
    assert.equal(isTheme(refused), false, String(refused));
    assert.deepEqual(guard(refused), { valid: false, value: undefined }, String(refused));
  }
});

test("the theme heads the Appearance page as a Light, Dark, System pop-up", () => {
  const [first] = settingRowsForPage(
    SETTINGS_PAGE.APPEARANCE,
    SETTING_SECTION.MAIN,
    settingsVisibility(),
  );
  assert.equal(first?.field, APP_SETTING_SCHEMA.theme.field);
  assert.deepEqual(first?.control, {
    value: THEME.DARK,
    options: [
      { value: THEME.LIGHT, label: "Light" },
      { value: THEME.DARK, label: "Dark" },
      { value: THEME.SYSTEM, label: "System" },
    ],
  });
  assert.equal(first?.changed, false);
  const view = settingsVisibility();
  assert.equal(settingFromOption("theme", "system", view), THEME.SYSTEM);
  assert.equal(settingFromOption("theme", "sepia", view), undefined);
});

test("a theme away from Dark is what the Appearance reset is offered for", () => {
  assert.equal(settingsScopeChanged(settingsView(), SETTINGS_RESET_SCOPE.APPEARANCE), false);
  const light = settingsView({ theme: THEME.LIGHT });
  assert.equal(settingsScopeChanged(light, SETTINGS_RESET_SCOPE.APPEARANCE), true);
});
