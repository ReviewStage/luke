import type {
  CredentialProviderId,
  CredentialSource,
  SecretStorage,
} from "@sidecar/credentials/vocabulary";
import type { CliConnection } from "@sidecar/session";
import type { ActionResult } from "@sidecar/wire";
import { APP_SETTING_DEFAULTS, type StoredAppSettings, VOICE_SOURCE } from "./schema.js";

export type { AccountCalendar, ObservedAccountCalendars } from "@sidecar/calendar/observation";
export { CLI_CONNECTION, type CliConnection } from "@sidecar/session";
export type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
  SettingsResetScope,
  VoiceSource,
} from "./schema.js";
export {
  APP_SETTING_DEFAULTS,
  isSettingsResetScope,
  isVoiceSource,
  SETTINGS_RESET_SCOPE,
  VOICE_SOURCE,
} from "./schema.js";

/**
 * One connected calendar source as a renderer may know it: which account,
 * and which of its calendars the user chose to count. For Google the grant
 * behind it stays in the main process, like every credential; for Apple
 * Calendar there is no grant to keep — it lives with macOS.
 */
export interface CalendarAccount {
  /**
   * The account's primary calendar id — its address, which is its name — or
   * the fixed Apple Calendar id for the one source this Mac itself holds.
   */
  id: string;
  selectedCalendarIds: readonly string[];
}

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

/** Every settings write returns the canonical action result and the latest stored snapshot. */
export type SettingsUpdateResult = ActionResult & {
  settings: AppSettings;
  /** Present only when the canonical action result is rejected or unsupported. */
  reason?: string;
};
