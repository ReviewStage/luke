import assert from "node:assert/strict";
import { test } from "vitest";
import { HOST_CAPABILITY } from "./capabilities.js";
import { SETTING_SECTION, SETTINGS_PAGE } from "./schema.js";
import {
  describedSettings,
  SETTING_KEEP,
  type SettingsRowsInput,
  settingKeepOf,
  settingKeepWords,
  settingRowsForPage,
  settingsPageKeep,
} from "./schema-access.js";
import { settingsView } from "./testing.js";

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

/** A signed-in desktop window over voice that can run, as `view` changes it. */
function signedInDesktop(view: Partial<SettingsRowsInput> = {}): SettingsRowsInput {
  return {
    settings: settingsView({ voiceAvailable: true }),
    voiceControlsDrawn: true,
    accountDrawn: true,
    capabilities: Object.values(HOST_CAPABILITY),
    ...view,
  };
}

test("every row a page draws is kept where its page's line says, or says where it is kept itself", () => {
  const view = signedInDesktop();
  for (const page of Object.values(SETTINGS_PAGE)) {
    const pageKeep = settingsPageKeep(page, view);
    for (const section of Object.values(SETTING_SECTION)) {
      for (const row of settingRowsForPage(page, section, view)) {
        assert.equal(
          row.keptElsewhere ?? pageKeep,
          settingKeepOf(row.field),
          `${row.field} on ${page}`,
        );
      }
    }
  }
});

test("a page's line follows the account only where most of what it keeps does, and stands over nothing signed out", () => {
  const view = signedInDesktop();
  // Voice: the voice follows the account, the media and microphone switches stay on the Mac.
  assert.equal(settingsPageKeep(SETTINGS_PAGE.VOICE, view), SETTING_KEEP.DEVICE);
  const voice = settingRowsForPage(SETTINGS_PAGE.VOICE, SETTING_SECTION.CONTROLS, view);
  assert.deepEqual(
    voice.flatMap((row) => (row.keptElsewhere === undefined ? [] : [row.field])),
    ["voice"],
  );
  // Account: the account itself and its links follow it, its usage counts stay on the Mac.
  assert.equal(settingsPageKeep(SETTINGS_PAGE.ACCOUNT, view), SETTING_KEEP.ACCOUNT);
  const privacy = settingRowsForPage(SETTINGS_PAGE.ACCOUNT, SETTING_SECTION.PRIVACY, view);
  assert.deepEqual(
    privacy.map((row) => row.keptElsewhere),
    [SETTING_KEEP.DEVICE],
  );
  assert.equal(settingsPageKeep(SETTINGS_PAGE.WORKSPACE, view), SETTING_KEEP.WORKSPACE);
  assert.equal(settingsPageKeep(SETTINGS_PAGE.ABOUT, view), undefined);
  assert.equal(
    settingsPageKeep(SETTINGS_PAGE.ACCOUNT, signedInDesktop({ accountDrawn: false })),
    undefined,
  );
});

test("the device is this Mac in the installed app and this browser elsewhere", () => {
  const browser = Object.values(HOST_CAPABILITY).filter(
    (each) => each !== HOST_CAPABILITY.DESKTOP_APP,
  );
  assert.equal(
    settingKeepWords(SETTING_KEEP.DEVICE, Object.values(HOST_CAPABILITY)),
    "Kept on this Mac",
  );
  assert.equal(settingKeepWords(SETTING_KEEP.DEVICE, browser), "Kept in this browser");
  assert.equal(settingKeepWords(SETTING_KEEP.ACCOUNT, browser), "Follows your account");
});
