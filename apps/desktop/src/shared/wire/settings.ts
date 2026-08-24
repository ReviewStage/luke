import type { CredentialProviderId } from "@sidecar/credentials";
import type { CliConnection } from "@sidecar/session";
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_FIELDS,
  type StoredAppSettings,
  VOICE_SOURCE,
} from "@sidecar/settings";
import type { ActResult } from "@sidecar/wire";
import type { CredentialSource, SecretStorage } from "./account";
import type { CalendarAccount } from "./calendar";

export { CLI_CONNECTION, type CliConnection } from "@sidecar/session";
export type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
  SettingsResetScope,
  VoiceSource,
} from "@sidecar/settings";
export {
  APP_SETTING_DEFAULTS,
  isSettingsResetScope,
  isVoiceSource,
  SETTINGS_RESET_SCOPE,
  VOICE_SOURCE,
} from "@sidecar/settings";

/** Runtime facts that travel beside, but never masquerade as, stored choices. */
export interface RuntimeStatus {
  credentialSources: Readonly<Record<CredentialProviderId, CredentialSource>>;
  codexCloudConnection: CliConnection;
  secretStorage: SecretStorage;
  voiceAvailable: boolean;
  calendarSignInAvailable: boolean;
  linearSignInAvailable: boolean;
  calendarAccounts: readonly CalendarAccount[];
  appleCalendarAvailable: boolean;
  appleCalendar?: CalendarAccount;
}

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

export function appSettingsWire(settings: AppSettingsView): AppSettings {
  const storedEntries = Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [field, settings[field]]),
  );
  // SAFETY: APP_SETTING_FIELDS enumerates every schema-derived stored field exactly once.
  const stored = storedEntries as StoredAppSettings;
  const status: RuntimeStatus = {
    credentialSources: settings.credentialSources,
    codexCloudConnection: settings.codexCloudConnection,
    secretStorage: settings.secretStorage,
    voiceAvailable: settings.voiceAvailable,
    calendarSignInAvailable: settings.calendarSignInAvailable,
    linearSignInAvailable: settings.linearSignInAvailable,
    calendarAccounts: settings.calendarAccounts,
    appleCalendarAvailable: settings.appleCalendarAvailable,
    ...(settings.appleCalendar ? { appleCalendar: settings.appleCalendar } : undefined),
  };
  return { stored, status };
}

/** Every settings write returns the canonical act result and the latest stored snapshot. */
export type SettingsUpdateResult = ActResult & {
  settings: AppSettings;
  /** Present only when the canonical act result is rejected or unsupported. */
  reason?: string;
};
