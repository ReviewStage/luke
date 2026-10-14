import assert from "node:assert/strict";
import { APP_TOGGLE_VALUE } from "@sidecar/wire/app-settings";
import { test } from "vitest";
import { APP_SETTING_ID } from "./schema.js";
import { describedSettings, settingRowsForPage } from "./schema-access.js";
import { SETTING_SECTION, SETTINGS_PAGE } from "./schema-types.js";
import { settingsView } from "./testing.js";
import type { AppSettingsView } from "./wire.js";

test("nothing a setting says about itself names a credential or its shape", () => {
  // No settings description may carry a key, a key's shape, or an
  // environment variable's name.
  const forbidden = [/sk-/i, /_API_KEY/, /secret/i, /token/i, /password/i];
  for (const entry of describedSettings(settingsView())) {
    const lines = [entry.label, entry.detail ?? "", entry.value];
    for (const line of lines) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(line), `${entry.id} says "${line}"`);
      }
    }
  }
});

test("the Voice page draws video calls among its controls, off until the developer turns them on", () => {
  const rowsWith = (settings: AppSettingsView) =>
    settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, {
      settings,
      voiceControlsDrawn: true,
      accountDrawn: true,
    }).filter((row) => row.entry.id === APP_SETTING_ID.VOICE_VIDEO);

  const [standing] = rowsWith(settingsView());
  assert.equal(standing?.entry.value, APP_TOGGLE_VALUE.OFF);
  assert.equal(standing?.changed, false);
  const [turnedOn] = rowsWith(settingsView({ voiceVideo: true }));
  assert.equal(turnedOn?.entry.value, APP_TOGGLE_VALUE.ON);
  assert.equal(turnedOn?.changed, true);
});
