import type { CalendarAccountCredential } from "@sidecar/calendar";
import type { CredentialProviderId } from "@sidecar/credentials";
import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import type {
  AccountPreferenceField,
  AccountPreferences,
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
} from "@sidecar/settings";
import type {
  AppSettings,
  SettingsResetScope,
  SettingsUpdateResult,
  VoiceSource,
} from "@sidecar/settings/wire";
import { type Effect, Runtime } from "effect";
import type { AppleCalendarConnection } from "./apple-calendar.js";
import type { SettingsStore, StoredAccount } from "./settings-store.js";

/**
 * The settings store's own methods, as the Promises the callers that have not
 * migrated still hold. Every method here is the store's effect run on the
 * runtime the host is composed on, so nothing reaches for an ambient default
 * one, and no read or write behaves differently from the one a migrated
 * caller yields.
 *
 * @deprecated The strangler shim on the `docs/adr/0001-effect.md` allowlist,
 * standing in for the two callers still promise-shaped: `compose-calendars.ts`'s
 * `GoogleCalendarReader`/`AppleCalendarReader` readers, and the type this
 * interface still names for `session-action-performer.ts`'s one field read
 * (`Pick<AwaitedSettingsStore, "get">`), even though that read no longer runs
 * on this file's own instance. It is deleted by P12-14i once both move onto
 * the store itself.
 */
export interface AwaitedSettingsStore {
  get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>>;
  set<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
  setEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Promise<SettingsUpdateResult>;
  clearEntryIfUnchanged<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    expected: SettingEntryValue<Field>,
  ): Promise<SettingsUpdateResult & { cleared: boolean }>;
  snapshot(): Promise<AppSettings>;
  resetSettings(scope: SettingsResetScope): Promise<SettingsUpdateResult>;
  readAccount(): Promise<StoredAccount | undefined>;
  setAccount(account: StoredAccount): Promise<AccountSnapshot>;
  clearAccount(): Promise<AccountSnapshot>;
  accountSnapshot(): Promise<AccountSnapshot>;
  accountPreferences(): Promise<AccountPreferences>;
  applyAccountPreferences(
    settings: AccountPreferences,
    expected?: { accountEmail: string; preferences: AccountPreferences },
  ): Promise<SettingsUpdateResult & { changed: readonly AccountPreferenceField[] }>;
  accountPreferencesSyncBaseline(accountEmail: string): Promise<AccountPreferences | undefined>;
  setAccountPreferencesSyncBaseline(
    accountEmail: string,
    preferences: AccountPreferences,
  ): Promise<boolean>;
  readVoiceSource(): Promise<VoiceSource>;
  readApiKey(providerId: CredentialProviderId): Promise<string | undefined>;
  readStoredApiKey(providerId: CredentialProviderId): Promise<string | undefined>;
  setApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Promise<SettingsUpdateResult>;
  readVaultSyncAccount(): Promise<string | undefined>;
  readCalendarAccounts(): Promise<readonly CalendarAccountCredential[]>;
  addCalendarAccount(
    accountId: string,
    refreshToken: string,
    selectedCalendarIds: readonly string[],
  ): Promise<SettingsUpdateResult>;
  removeCalendarAccount(accountId: string): Promise<SettingsUpdateResult>;
  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Promise<SettingsUpdateResult>;
  connectAppleCalendar(selectedCalendarIds: readonly string[]): Promise<SettingsUpdateResult>;
  disconnectAppleCalendar(): Promise<SettingsUpdateResult>;
  calendarConnectionStored(): Promise<boolean>;
  readAppleCalendarConnection(): Promise<AppleCalendarConnection | undefined>;
}

/** @deprecated See {@link AwaitedSettingsStore}; deleted by P12-14d..g. */
export function awaitedSettingsStore(
  store: SettingsStore,
  runtime: Runtime.Runtime<never>,
): AwaitedSettingsStore {
  const awaited = <Value>(effect: Effect.Effect<Value, unknown>): Promise<Value> =>
    Runtime.runPromise(runtime)(effect);
  return {
    get: (field) => awaited(store.get(field)),
    set: (field, value) => awaited(store.set(field, value)),
    setEntry: (field, key, value) => awaited(store.setEntry(field, key, value)),
    clearEntryIfUnchanged: (field, key, expected) =>
      awaited(store.clearEntryIfUnchanged(field, key, expected)),
    snapshot: () => awaited(store.snapshot()),
    resetSettings: (scope) => awaited(store.resetSettings(scope)),
    readAccount: () => awaited(store.readAccount()),
    setAccount: (account) => awaited(store.setAccount(account)),
    clearAccount: () => awaited(store.clearAccount()),
    accountSnapshot: () => awaited(store.accountSnapshot()),
    accountPreferences: () => awaited(store.accountPreferences()),
    applyAccountPreferences: (settings, expected) =>
      awaited(store.applyAccountPreferences(settings, expected)),
    accountPreferencesSyncBaseline: (accountEmail) =>
      awaited(store.accountPreferencesSyncBaseline(accountEmail)),
    setAccountPreferencesSyncBaseline: (accountEmail, preferences) =>
      awaited(store.setAccountPreferencesSyncBaseline(accountEmail, preferences)),
    readVoiceSource: () => awaited(store.readVoiceSource()),
    readApiKey: (providerId) => awaited(store.readApiKey(providerId)),
    readStoredApiKey: (providerId) => awaited(store.readStoredApiKey(providerId)),
    setApiKey: (providerId, apiKey) => awaited(store.setApiKey(providerId, apiKey)),
    readVaultSyncAccount: () => awaited(store.readVaultSyncAccount()),
    readCalendarAccounts: () => awaited(store.readCalendarAccounts()),
    addCalendarAccount: (accountId, refreshToken, selectedCalendarIds) =>
      awaited(store.addCalendarAccount(accountId, refreshToken, selectedCalendarIds)),
    removeCalendarAccount: (accountId) => awaited(store.removeCalendarAccount(accountId)),
    setCalendarSelected: (accountId, calendarId, selected) =>
      awaited(store.setCalendarSelected(accountId, calendarId, selected)),
    connectAppleCalendar: (selectedCalendarIds) =>
      awaited(store.connectAppleCalendar(selectedCalendarIds)),
    disconnectAppleCalendar: () => awaited(store.disconnectAppleCalendar()),
    calendarConnectionStored: () => awaited(store.calendarConnectionStored()),
    readAppleCalendarConnection: () => awaited(store.readAppleCalendarConnection()),
  };
}
