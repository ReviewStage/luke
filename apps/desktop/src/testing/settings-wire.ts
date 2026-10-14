import { APP_SETTING_FIELDS, type StoredAppSettings } from "@luke/settings";
import type { AppSettings, AppSettingsView, RuntimeStatus } from "@luke/settings/wire";

/** Turns a renderer view back into wire state for settings-update fixtures. */
export function appSettingsWire(settings: AppSettingsView): AppSettings {
  const storedEntries = Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [field, settings[field]]),
  );
  // SAFETY: APP_SETTING_FIELDS enumerates every schema-derived stored field exactly once.
  const stored = storedEntries as StoredAppSettings;
  const status: RuntimeStatus = { voiceAvailable: settings.voiceAvailable };
  return { stored, status };
}
