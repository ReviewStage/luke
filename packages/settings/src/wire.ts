import type { ActionResult } from "@sidecar/wire";
import { VOICE_SOURCE } from "./schema.js";
import { APP_SETTING_DEFAULTS, type StoredAppSettings } from "./schema-access.js";
import type { RuntimeStatus } from "./status.js";

export type { AccountCalendar, ObservedAccountCalendars } from "@sidecar/calendar/observation";
export type { SettingsResetScope, VoiceSource } from "./schema.js";
export { isVoiceSource, SETTINGS_RESET_SCOPE, VOICE_SOURCE } from "./schema.js";
export type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
} from "./schema-access.js";
export { APP_SETTING_DEFAULTS, isSettingsResetScope } from "./schema-access.js";

export type { CalendarAccount, RuntimeStatus } from "./status.js";

/** Renderer-safe settings. Credentials are never sent to a renderer. */
export interface AppSettings {
  stored: StoredAppSettings;
  status: RuntimeStatus;
}

/** A renderer-local view over the two disjoint halves of the settings wire. */
type ResolvedSettingField = "voice" | "voiceSpeed" | "voiceSource" | "formFactor";
export type AppSettingsView = Omit<StoredAppSettings, ResolvedSettingField> & {
  [Field in ResolvedSettingField]-?: NonNullable<StoredAppSettings[Field]>;
} & RuntimeStatus;

export function appSettingsView(settings: AppSettings): AppSettingsView {
  return {
    ...settings.stored,
    ...settings.status,
    voice: settings.stored.voice ?? APP_SETTING_DEFAULTS.voice,
    voiceSpeed: settings.stored.voiceSpeed ?? APP_SETTING_DEFAULTS.voiceSpeed,
    voiceSource: settings.stored.voiceSource ?? VOICE_SOURCE.ACCOUNT,
    formFactor: settings.stored.formFactor ?? APP_SETTING_DEFAULTS.formFactor,
  };
}

/** Every settings write returns the canonical action result and the latest stored snapshot. */
export type SettingsUpdateResult = ActionResult & {
  settings: AppSettings;
  /** Present only when the canonical action result is rejected or unsupported. */
  reason?: string;
};
