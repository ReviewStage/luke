// Explicit package exports keep this compatibility barrel linkable while the
// package owning a vocabulary imports it during its own tests.
export {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/account/snapshot";
export type { AccountCalendar, ObservedAccountCalendars } from "@sidecar/calendar/observation";
export {
  CLI_CONNECTION,
  type CliConnection,
  isWorkspaceProviderId,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
} from "@sidecar/session";
export {
  APP_SETTING_DEFAULTS,
  type AppSettingField,
  type AppSettingValue,
  isSettingsResetScope,
  isVoiceSource,
  type KeyedAppSettingField,
  SETTINGS_RESET_SCOPE,
  type SettingEntryValue,
  type SettingsResetScope,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings";
export type { WindowMode } from "@sidecar/surface";
export { type AppBridge, BRIDGE, channels } from "./bridge";
export * from "./wire/account";
export * from "./wire/audio";
export * from "./wire/calendar";
export * from "./wire/session";
export * from "./wire/settings";
export * from "./wire/update";
