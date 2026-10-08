import type { ActionResult } from "@sidecar/wire";
import { APP_SETTING_DEFAULTS, type StoredAppSettings } from "./schema-access.js";
import type { RuntimeStatus } from "./status.js";

export type { SettingsResetScope } from "./schema.js";
export { SETTINGS_RESET_SCOPE } from "./schema.js";
export type {
  AppSettingField,
  AppSettingValue,
} from "./schema-access.js";

export type { RuntimeStatus } from "./status.js";

/** Renderer-safe settings. Credentials are never sent to a renderer. */
export interface AppSettings {
  stored: StoredAppSettings;
  status: RuntimeStatus;
}

/** A renderer-local view over the two disjoint halves of the settings wire. */
type ResolvedSettingField = "voice";
export type AppSettingsView = Omit<StoredAppSettings, ResolvedSettingField> & {
  [Field in ResolvedSettingField]-?: NonNullable<StoredAppSettings[Field]>;
} & RuntimeStatus;

export function appSettingsView(settings: AppSettings): AppSettingsView {
  return {
    ...settings.stored,
    ...settings.status,
    voice: settings.stored.voice ?? APP_SETTING_DEFAULTS.voice,
  };
}

/** Every settings write returns the canonical action result and the latest stored snapshot. */
export type SettingsUpdateResult = ActionResult & {
  settings: AppSettings;
  /** Present only when the canonical action result is rejected or unsupported. */
  reason?: string;
};
