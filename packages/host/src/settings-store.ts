import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { APPLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import {
  CREDENTIAL_PROVIDER_LIST,
  type CredentialFormat,
  type CredentialProvider,
  type CredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  isAccountProvider,
} from "@sidecar/credentials/snapshot";
import {
  CREDENTIAL_SOURCE,
  type CredentialSource,
  SECRET_STORAGE,
  type SecretStorage,
} from "@sidecar/credentials/vocabulary";
import { LIVE_DEFAULTS } from "@sidecar/live";
import {
  type AppSettings,
  type SettingsResetScope,
  type SettingsUpdateResult,
  VOICE_SOURCE,
  type VoiceSource,
} from "@sidecar/settings/wire";
import { DEFAULT_PANEL_FORM_FACTOR } from "@sidecar/surface";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireNumber,
  isWireString,
  wireRecord as readWireRecord,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { Effect, Either, Redacted } from "effect";
// The reader owns the shape it is fed: what this store resolves a stored
// connection into is exactly what `readAppleCalendarConnection` promises it.
import type { AppleCalendarConnection } from "./apple-calendar.js";
import type { SettingsEnvironmentOverrides } from "./effect/settings-overrides.js";
import {
  parsePersistedSettingsEither,
  readSettingsFileText,
  writeSettingsFileAtomic,
} from "./effect/settings-store-io.js";

export type { StoredAccount } from "@sidecar/credentials";

import type { CalendarAccountCredential } from "@sidecar/calendar";
import type { StoredAccount } from "@sidecar/credentials";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  accountPreferencesFromStored,
  type KeyedAppSettingField,
  type SettingEntryValue,
  type StoredAppSettings,
  sameSettingEntry,
} from "@sidecar/settings";
import { resolveVoiceCapability } from "@sidecar/voice";

const SETTINGS_FILE_VERSION = 2;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  API_KEYS: "apiKeys",
  APPLE_CALENDAR: "appleCalendar",
  CALENDAR_ACCOUNTS: "calendarAccounts",
  ACCOUNT_PREFERENCES_SYNC: "accountPreferencesSync",
  VAULT_SYNC_ACCOUNT: "vaultSyncAccount",
  VERSION: "version",
} as const;

const API_KEY_LENGTH = {
  MINIMUM: 8,
  MAXIMUM: 512,
} as const;

/** Printable ASCII with no spaces — the bytes an authorization header accepts. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * A credential is only ever written through OS-provided encryption. Electron's
 * `safeStorage` satisfies this on macOS by deriving its key from the Keychain.
 *
 * Every member of this interface reaches the Keychain, `isAvailable` included:
 * it answers by fetching the same key the other two use. So none of them may be
 * called to fill in a display value — only to protect or recover a credential
 * the user has.
 */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

export interface SettingsStoreOptions {
  directory: () => string;
  cipher: SecretCipher;
  /**
   * What the launch environment overrides, already read: the store reads no
   * environment of its own, so nothing it answers depends on a variable this
   * composition was not handed through the `Environment` seam.
   */
  overrides: SettingsEnvironmentOverrides;
  /**
   * Whether this run will use the credentials it resolves. A fixture or evidence
   * run will not, and the panel has to mark what would actually happen rather
   * than what is stored — so `voiceAvailable` is false there however good the
   * key is. Only the app knows which kind of run this is. True by default.
   */
  credentialsUsable?: boolean;
  /**
   * The file system `#readPersisted` and `#write` below reach the settings
   * file through, resolved once by the composer from the host's own assembly
   * rather than by a layer this class stands up for itself. It is the service
   * and not a runtime, so every method here is an effect with nothing left in
   * its context for a caller to provide.
   */
  fileSystem: FileSystem.FileSystem;
}

export interface PersistedSettings extends StoredAppSettings {
  version: number;
  /**
   * Ciphertext by provider id. A provider this build does not know is carried
   * through untouched so an older build cannot discard a newer one's key.
   */
  apiKeys: Readonly<Record<string, string>>;
  /** Account tokens encrypted together; only display identity stays plaintext. */
  account?: {
    tokenCipher: string;
    /** Absent where the sign-in's identity carried none; see `AccountIdentity`. */
    id?: string;
    email: string;
    name?: string;
    pictureUrl?: string;
    provider: AccountProvider;
  };
  /**
   * The connected calendar accounts: each account's id, the grant its sign-in
   * produced as ciphertext, and the calendar ids the user chose to count.
   * Absent from the file while none are connected.
   */
  calendarAccounts?: readonly PersistedCalendarAccount[];
  /**
   * Last account-preference baseline used for hosted sync. It is local
   * bookkeeping only: when the hosted write fails and the app restarts, this
   * is what lets the next hosted read keep local edits made since the last
   * successful baseline instead of treating the current local file as already
   * synced.
   */
  accountPreferencesSync?: {
    accountEmail: string;
    preferences: AccountPreferences;
  };
  /**
   * The Apple Calendar connection: present exactly while connected, holding
   * only the calendar ids the user chose to count. No credential rides with
   * it — the grant lives with macOS, withdrawable in System Settings.
   */
  appleCalendar?: { calendars: readonly string[] };
  /**
   * Which account this Mac's provider keys were last synced for — the
   * account's opaque id, or its address where the identity carried no id. It
   * outlives a sign-out on purpose: it is what keeps an automatic sweep from
   * handing one person's keys to whoever signs in next, so it must remember
   * the person after they have gone.
   */
  vaultSyncAccount?: string;
}

interface ResolvedApiKey {
  apiKey?: string;
  source: CredentialSource;
}

function storedAccount(record: WireRecord): PersistedSettings["account"] {
  const value = record[SETTINGS_FIELD.ACCOUNT];
  if (!isRecord(value)) return undefined;
  const account = value;
  if (
    !isWireString(account.tokenCipher) ||
    !account.tokenCipher ||
    !isWireString(account.email) ||
    !account.email ||
    !isAccountProvider(account.provider)
  ) {
    return undefined;
  }
  return {
    tokenCipher: account.tokenCipher,
    ...(isWireString(account.id) && account.id ? { id: account.id } : undefined),
    email: account.email,
    ...(isWireString(account.name) && account.name ? { name: account.name } : undefined),
    ...(isWireString(account.pictureUrl) && account.pictureUrl
      ? { pictureUrl: account.pictureUrl }
      : undefined),
    provider: account.provider,
  };
}

interface PersistedCalendarAccount {
  id: string;
  /** The sign-in's grant, encrypted like every credential. */
  token: string;
  /** The calendar ids the user chose to count toward meetings. */
  calendars: readonly string[];
}

/** An account or calendar id reads like one wire value; longer is not an id. */
const MAXIMUM_CALENDAR_IDENTIFIER_LENGTH = 200;
/** More accounts than one person signs into; a cap, not a plan. */
const MAXIMUM_CALENDAR_ACCOUNTS = 10;
/** More calendars than anyone counts meetings from. */
const MAXIMUM_SELECTED_CALENDARS = 50;

/** A calendar-world identifier as this store will keep it, or nothing. */
function calendarIdentifierText(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAXIMUM_CALENDAR_IDENTIFIER_LENGTH) return undefined;
  return normalized;
}

/**
 * A stored selection as this store will keep it: well-formed ids, bounded
 * count. Every path that writes one — parsed from disk or handed in — passes
 * this one gate.
 */
function sanitizedCalendarIds(value: UnparsedWireValue): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => calendarIdentifierText(unparsedWire(entry)))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, MAXIMUM_SELECTED_CALENDARS);
}

/**
 * The selection after one calendar's toggle, or nothing to write — the same
 * edit for every source, stated once. Nothing to write is a toggle to the
 * value already held, or one past the cap.
 */
function toggledCalendarSelection(
  held: readonly string[],
  id: string,
  selected: boolean,
): readonly string[] | undefined {
  if (held.includes(id) === selected) return undefined;
  const calendars = held.filter((candidate) => candidate !== id);
  if (selected) calendars.push(id);
  return calendars.length > MAXIMUM_SELECTED_CALENDARS ? undefined : calendars;
}

/** Reads the stored calendar accounts, keeping only well-formed entries. */
function storedCalendarAccounts(record: WireRecord): readonly PersistedCalendarAccount[] {
  const persisted = record[SETTINGS_FIELD.CALENDAR_ACCOUNTS];
  if (!Array.isArray(persisted)) return [];
  const accounts: PersistedCalendarAccount[] = [];
  for (const entry of persisted) {
    if (accounts.length >= MAXIMUM_CALENDAR_ACCOUNTS) break;
    if (!isRecord(entry)) continue;
    const { id, token, calendars } = entry;
    const accountId = calendarIdentifierText(id);
    if (!accountId || !isWireString(token) || !token) continue;
    if (accounts.some((held) => held.id === accountId)) continue;
    accounts.push({ id: accountId, token, calendars: sanitizedCalendarIds(calendars) });
  }
  return accounts;
}

/** The stored Apple Calendar connection; its presence is the connection. */
function storedAppleCalendar(record: WireRecord): PersistedSettings["appleCalendar"] {
  const held = readWireRecord(record[SETTINGS_FIELD.APPLE_CALENDAR]);
  if (!held) return undefined;
  return { calendars: sanitizedCalendarIds(held.calendars) };
}

/**
 * The settings with this account list, kept the way an emptied map is kept: an
 * empty list is a deleted field, so a disconnection reads as no calendars
 * rather than as a connection with none.
 */
function withCalendarAccounts(
  persisted: PersistedSettings,
  calendarAccounts: readonly PersistedCalendarAccount[],
): PersistedSettings {
  const next: PersistedSettings = { ...persisted };
  if (calendarAccounts.length > 0) next.calendarAccounts = calendarAccounts;
  else delete next.calendarAccounts;
  return next;
}

/** The settings with this Mac's connection, on the same terms. */
function withAppleCalendar(
  persisted: PersistedSettings,
  appleCalendar: PersistedSettings["appleCalendar"],
): PersistedSettings {
  const next: PersistedSettings = { ...persisted };
  if (appleCalendar) next.appleCalendar = appleCalendar;
  else delete next.appleCalendar;
  return next;
}

/**
 * A rejected key never reaches disk, and the reason never echoes the submitted
 * value. Most of what this rules out is a value that cannot be sent as an HTTP
 * authorization header at all. A provider that publishes more than one kind of
 * key also has the kind Luke cannot use ruled out here, so a credential that
 * would only ever be refused is refused at the door rather than stored and
 * quietly unused.
 */
export function apiKeyRejection(apiKey: string, format?: CredentialFormat): string | undefined {
  if (apiKey.length < API_KEY_LENGTH.MINIMUM) return "That API key is too short.";
  if (apiKey.length > API_KEY_LENGTH.MAXIMUM) return "That API key is too long.";
  if (!PRINTABLE_ASCII.test(apiKey)) return "That API key contains unsupported characters.";
  if (format && !apiKey.startsWith(format.prefix)) return format.rejection;
  return undefined;
}

function storedApiKeys(record: WireRecord) {
  const apiKeys: Record<string, string> = {};
  const persisted = record[SETTINGS_FIELD.API_KEYS];
  if (isRecord(persisted)) {
    for (const [providerId, ciphertext] of Object.entries(persisted)) {
      if (!isWireString(ciphertext) || !ciphertext) continue;
      apiKeys[providerId] = ciphertext;
    }
  }
  return apiKeys;
}

/**
 * Reads the stored per-provider agent choices, keeping only entries the
 * build's own table lists. A file written by another build may pair an agent
 * with a model this one does not know; honouring it would send a value no
 * documented endpoint takes, so it is dropped the way an unknown voice is.
 */
function readStoredSettings(record: WireRecord): StoredAppSettings {
  // SAFETY: Each field is paired with the value its own schema guard accepts.
  return Object.fromEntries(
    APP_SETTING_FIELDS.map((field) => [
      field,
      APP_SETTING_SCHEMA[field].guard(record[field]).value,
    ]),
  ) as StoredAppSettings;
}

function storedSettingsFromPersisted(persisted: PersistedSettings): StoredAppSettings {
  const entries = Object.fromEntries(APP_SETTING_FIELDS.map((field) => [field, persisted[field]]));
  // SAFETY: APP_SETTING_FIELDS copies every StoredAppSettings member and no persistence metadata.
  return entries as StoredAppSettings;
}

function sameAccountPreferenceValue(current: UnparsedWireValue, next: UnparsedWireValue): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

function accountPreferenceRecord(value: UnparsedWireValue): WireRecord {
  return isRecord(value) ? value : {};
}

function accountPreferenceWithLocalChanges(
  field: AccountPreferenceField,
  remote: UnparsedWireValue,
  current: UnparsedWireValue,
  expected: UnparsedWireValue,
): UnparsedWireValue {
  if (
    field === APP_SETTING_SCHEMA.workspaceAgentDefaults.field ||
    field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field
  ) {
    const entries = { ...accountPreferenceRecord(remote) };
    const currentEntries = accountPreferenceRecord(current);
    const expectedEntries = accountPreferenceRecord(expected);
    const keys = new Set<string>();
    for (const key of Object.keys(currentEntries)) keys.add(key);
    for (const key of Object.keys(expectedEntries)) keys.add(key);
    for (const key of keys) {
      const currentEntry = currentEntries[key];
      if (sameAccountPreferenceValue(currentEntry, expectedEntries[key])) continue;
      if (currentEntry === undefined) delete entries[key];
      else entries[key] = currentEntry;
    }
    return Object.keys(entries).length > 0 ? entries : undefined;
  }
  return sameAccountPreferenceValue(current, expected) ? remote : current;
}

function accountPreferencesWithLocalChanges(
  remote: AccountPreferences,
  current: AccountPreferences,
  expected: AccountPreferences,
): AccountPreferences {
  const settings: Record<string, WireValue> = {};
  for (const field of ACCOUNT_PREFERENCE_FIELDS) {
    // SAFETY: AccountPreferenceField selects JSON-compatible account preference values.
    const value = accountPreferenceWithLocalChanges(
      field,
      remote[field] as UnparsedWireValue,
      current[field] as UnparsedWireValue,
      expected[field] as UnparsedWireValue,
    );
    if (value !== undefined) settings[field] = value;
  }
  return accountPreferencesFromStored(settings) ?? {};
}

function accountPreferencesFromPersisted(persisted: PersistedSettings): AccountPreferences {
  const settings: Record<string, WireValue> = {};
  for (const field of ACCOUNT_PREFERENCE_FIELDS) {
    // SAFETY: AccountPreferenceField selects JSON-compatible stored app settings.
    const value = persisted[field] as UnparsedWireValue;
    if (value !== undefined) settings[field] = value;
  }
  return accountPreferencesFromStored(settings) ?? {};
}

function storedAccountPreferencesSync(
  record: WireRecord,
): PersistedSettings["accountPreferencesSync"] {
  const held = readWireRecord(record[SETTINGS_FIELD.ACCOUNT_PREFERENCES_SYNC]);
  if (!held || !isWireString(held.accountEmail) || !held.accountEmail) return undefined;
  const storedPreferences = readWireRecord(held.preferences);
  if (!storedPreferences) return undefined;
  const preferences = accountPreferencesFromStored(storedPreferences);
  if (preferences === undefined) return undefined;
  return { accountEmail: held.accountEmail, preferences };
}

function defaultPersistedSettings(): PersistedSettings {
  return {
    version: SETTINGS_FILE_VERSION,
    apiKeys: {},
    ...readStoredSettings({}),
  };
}

/**
 * The throwing parse this store's earlier body kept; `SettingsParseRefusal`
 * over `parsePersistedSettingsEither` in `./effect/settings-store-io.js` is
 * what a caller reads today, and this stays private to that Either's own
 * `Either.try` rather than a second parse a caller could reach directly.
 */
export function parsePersistedSettingsThrowing(source: string): PersistedSettings {
  const parsed = JSON.parse(source);
  if (!isRecord(parsed)) {
    throw new Error("Settings file is not an object");
  }
  const record = parsed;
  const version = record[SETTINGS_FIELD.VERSION];
  const calendarAccounts = storedCalendarAccounts(record);
  const appleCalendar = storedAppleCalendar(record);
  const settings = readStoredSettings(record);
  const vaultSyncAccount = record[SETTINGS_FIELD.VAULT_SYNC_ACCOUNT];
  const account = storedAccount(record);
  const accountPreferencesSync = storedAccountPreferencesSync(record);
  const persisted = {
    ...settings,
    version: isWireNumber(version) ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record),
    ...(account ? { account } : undefined),
    ...(account && accountPreferencesSync?.accountEmail === account.email
      ? { accountPreferencesSync }
      : undefined),
    ...(calendarAccounts.length > 0 ? { calendarAccounts } : undefined),
    ...(appleCalendar ? { appleCalendar } : undefined),
    ...(isWireString(vaultSyncAccount) && vaultSyncAccount ? { vaultSyncAccount } : undefined),
  };
  // SAFETY: readStoredSettings validated every preference field before this spread.
  return persisted as PersistedSettings;
}

/**
 * Reads and writes the small set of user-owned settings Luke needs. A stored
 * credential stays in the main process: callers can learn that a provider has a
 * key and can replace it, but no accessor returns one to a renderer.
 */
export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher;
  readonly #overrides: SettingsEnvironmentOverrides;
  readonly #credentialsUsable: boolean;
  readonly #fileSystem: FileSystem.FileSystem;
  /**
   * The settings as last read or written. The gate beside it is what makes a
   * read shared rather than repeated: a second reader waits for the first
   * read to land and then finds it here, and a read that failed leaves
   * nothing behind, so the next reader tries the file again.
   */
  #held: PersistedSettings | undefined;
  readonly #reads = Effect.unsafeMakeSemaphore(1);
  #resolved = new Map<CredentialProviderId, ResolvedApiKey>();
  /** Decrypted accounts, cached like the keys so timers never drum the Keychain. */
  #resolvedCalendarAccounts: readonly CalendarAccountCredential[] | undefined;
  /**
   * Runs one settings change at a time. Serializing only the file write is not
   * enough: a user with more than one provider row can start a second save
   * before the first lands, and both would read the same stored keys before
   * either wrote, so the later write would drop the other provider's key.
   */
  readonly #writes = Effect.unsafeMakeSemaphore(1);

  get<Field extends AppSettingField>(
    field: Field,
  ): Effect.Effect<AppSettingValue<Field>, PlatformError> {
    // SAFETY: PersistedSettings extends the schema-derived stored shape; the
    // generic field selects the same schema member on both sides.
    return Effect.map(this.#load(), (persisted) => persisted[field] as AppSettingValue<Field>);
  }

  set<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      yield* this.#mutate((persisted) => {
        if (persisted[field] === value) return undefined;
        const next: PersistedSettings = { ...persisted };
        if (value === undefined) delete next[field];
        else Object.assign(next, { [field]: value });
        return next;
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /**
   * Writes one entry of a map-valued setting, or forgets it when the value is
   * omitted. The merge happens inside the mutation rather than in the caller so
   * one key's write cannot drop another's: a caller holding the map it read
   * before an overlapping write landed would put the stale copy back. A map
   * left with no entries is deleted, so an emptied setting reads as unset
   * rather than as an empty object.
   */
  setEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    // SAFETY: a setting entry's own value is one of the wire values it was parsed from.
    const entry = value as UnparsedWireValue;
    return Effect.gen(this, function* () {
      yield* this.#mutate((persisted) => {
        // SAFETY: KeyedAppSettingField identifies fields whose stored value is a wire record.
        const current = persisted[field] as WireRecord | undefined;
        if (sameSettingEntry(field, current?.[key], entry)) return undefined;
        const entries = { ...current };
        if (entry === undefined) delete entries[key];
        else entries[key] = entry;
        const next: PersistedSettings = { ...persisted };
        if (Object.keys(entries).length > 0) Object.assign(next, { [field]: entries });
        else delete next[field];
        return next;
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  accountPreferences(): Effect.Effect<AccountPreferences, PlatformError> {
    return Effect.map(this.#load(), accountPreferencesFromPersisted);
  }

  applyAccountPreferences(
    settings: AccountPreferences,
    expected?: { accountEmail: string; preferences: AccountPreferences },
  ): Effect.Effect<
    SettingsUpdateResult & { changed: readonly AccountPreferenceField[] },
    PlatformError
  > {
    return Effect.gen(this, function* () {
      const changed: AccountPreferenceField[] = [];
      yield* this.#mutate((persisted) => {
        if (expected && persisted.account?.email !== expected.accountEmail) return undefined;
        const nextSettings = expected
          ? accountPreferencesWithLocalChanges(
              settings,
              accountPreferencesFromPersisted(persisted),
              expected.preferences,
            )
          : settings;
        const next: PersistedSettings = { ...persisted };
        for (const field of ACCOUNT_PREFERENCE_FIELDS) {
          // SAFETY: AccountPreferences is the parsed subset of JSON-compatible stored app settings.
          const value = nextSettings[field] as UnparsedWireValue;
          // SAFETY: AccountPreferenceField selects the same persisted JSON-compatible setting value.
          if (!sameAccountPreferenceValue(persisted[field] as UnparsedWireValue, value)) {
            changed.push(field);
          }
          if (value === undefined) delete next[field];
          else Object.assign(next, { [field]: value });
        }
        return changed.length > 0 ? next : undefined;
      });
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        settings: yield* this.snapshot(),
        changed,
      };
    });
  }

  accountPreferencesSyncBaseline(
    accountEmail: string,
  ): Effect.Effect<AccountPreferences | undefined, PlatformError> {
    return Effect.map(this.#load(), ({ accountPreferencesSync: sync }) =>
      sync?.accountEmail === accountEmail ? sync.preferences : undefined,
    );
  }

  setAccountPreferencesSyncBaseline(
    accountEmail: string,
    preferences: AccountPreferences,
  ): Effect.Effect<boolean, PlatformError> {
    return Effect.gen(this, function* () {
      let saved = false;
      yield* this.#mutate((persisted) => {
        if (persisted.account?.email !== accountEmail) return undefined;
        saved = true;
        if (
          persisted.accountPreferencesSync?.accountEmail === accountEmail &&
          JSON.stringify(persisted.accountPreferencesSync.preferences) ===
            JSON.stringify(preferences)
        ) {
          return undefined;
        }
        return { ...persisted, accountPreferencesSync: { accountEmail, preferences } };
      });
      return saved;
    });
  }

  /** Clears one map entry only if it still holds the value the caller read. */
  clearEntryIfUnchanged<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    expected: SettingEntryValue<Field>,
  ): Effect.Effect<SettingsUpdateResult & { cleared: boolean }, PlatformError> {
    // SAFETY: a setting entry's own value is one of the wire values it was parsed from.
    const held = expected as UnparsedWireValue;
    return Effect.gen(this, function* () {
      const cleared = yield* this.#mutate((persisted) => {
        // SAFETY: KeyedAppSettingField identifies fields whose stored value is a wire record.
        const current = persisted[field] as WireRecord | undefined;
        if (!sameSettingEntry(field, current?.[key], held)) return undefined;
        const entries = { ...current };
        delete entries[key];
        const next: PersistedSettings = { ...persisted };
        if (Object.keys(entries).length > 0) Object.assign(next, { [field]: entries });
        else delete next[field];
        return next;
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot(), cleared };
    });
  }
  #secretStorage: SecretStorage = SECRET_STORAGE.UNKNOWN;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#overrides = options.overrides;
    this.#credentialsUsable = options.credentialsUsable ?? true;
    this.#fileSystem = options.fileSystem;
  }

  snapshot(): Effect.Effect<AppSettings, PlatformError> {
    return Effect.gen(this, function* () {
      const persisted = yield* this.#load();
      const voiceCapability = yield* this.#voiceCapability(persisted);
      const sources = yield* Effect.forEach(CREDENTIAL_PROVIDER_LIST, (provider) =>
        Effect.map(
          this.#resolveApiKey(provider),
          (resolved) => [provider.id, resolved.source] as const,
        ),
      );
      return {
        stored: {
          ...storedSettingsFromPersisted(persisted),
          // Resolved the way the session source resolves it, so the panel marks
          // what would actually be heard while the persisted file remains optional.
          voice: persisted.voice ?? this.#overrides.voice ?? LIVE_DEFAULTS.VOICE,
          voiceSource: voiceCapability.source,
          formFactor: persisted.formFactor ?? DEFAULT_PANEL_FORM_FACTOR,
        },
        status: {
          // SAFETY: the registry list contains every credential provider exactly once.
          credentialSources: Object.fromEntries(sources) as Record<
            CredentialProviderId,
            CredentialSource
          >,
          // Reports what storing a key has already established, and asks nothing on
          // its own: a snapshot is taken on every launch, and most of them are for
          // a user with no key to protect.
          secretStorage: this.#secretStorage,
          // Whether a spoken turn could actually be minted: a key resolved, and this
          // run will use it. Resolved here rather than left to the panel because it
          // is the same question the voice and the pace are answered by — what would
          // actually happen — and it travels with every settings reply, so storing a
          // key is what turns voice on and deleting one is what turns it off.
          voiceAvailable: voiceCapability.available,
          // Whether this build can offer the Google Calendar sign-in at all: a
          // registered OAuth client resolved, and this run would use what it
          // grants. Without one the integration is not drawn at all.
          calendarSignInAvailable:
            this.#credentialsUsable && this.#overrides.googleCalendarSignIn !== undefined,
          // Whether this build can offer the Apple Calendar connection: a Mac to
          // read, and a run that would use what macOS grants. No client gates it
          // the way the sign-ins are gated — the grant lives with the system.
          appleCalendarAvailable: this.#credentialsUsable && process.platform === "darwin",
          // The accounts without their grants: which are connected and which
          // calendars count is the renderer's to draw; the tokens never travel.
          calendarAccounts: (persisted.calendarAccounts ?? []).map((account) => ({
            id: account.id,
            selectedCalendarIds: account.calendars,
          })),
          // The Apple Calendar connection on the same terms: the fact and the
          // chosen calendars, with nothing behind them to keep from travelling.
          ...(persisted.appleCalendar
            ? {
                appleCalendar: {
                  id: APPLE_CALENDAR_ID,
                  selectedCalendarIds: persisted.appleCalendar.calendars,
                },
              }
            : undefined),
        },
      };
    });
  }

  /** Returns account credentials only to the main process. */
  readAccount(): Effect.Effect<StoredAccount | undefined, PlatformError> {
    return Effect.map(this.#load(), ({ account }) => {
      if (!account) return undefined;
      return this.#decryptRecord(account.tokenCipher, (tokens) => {
        const { accessToken, refreshToken } = tokens;
        if (!isWireString(accessToken) || !isWireString(refreshToken)) return undefined;
        return {
          accessToken,
          refreshToken,
          ...(account.id ? { id: account.id } : undefined),
          email: account.email,
          ...(account.name ? { name: account.name } : undefined),
          ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
          provider: account.provider,
        };
      });
    });
  }

  accountSnapshot(): Effect.Effect<AccountSnapshot, PlatformError> {
    return Effect.map(this.readAccount(), (account) =>
      account
        ? {
            status: ACCOUNT_STATUS.SIGNED_IN,
            email: account.email,
            ...(account.name ? { name: account.name } : undefined),
            ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
            provider: account.provider,
          }
        : { status: ACCOUNT_STATUS.SIGNED_OUT },
    );
  }

  /** Stores both OAuth tokens under one Keychain-backed ciphertext. */
  setAccount(account: StoredAccount): Effect.Effect<AccountSnapshot, PlatformError> {
    return Effect.gen(this, function* () {
      if (!this.#secretStorageUsable()) {
        throw new Error("Encrypted credential storage is unavailable on this system.");
      }
      yield* this.#mutate((persisted) => {
        const tokenCipher = this.#cipher
          .encrypt(
            JSON.stringify({
              accessToken: account.accessToken,
              refreshToken: account.refreshToken,
            }),
          )
          .toString("base64");
        const next: PersistedSettings = {
          ...persisted,
          account: {
            tokenCipher,
            ...(account.id ? { id: account.id } : undefined),
            email: account.email,
            ...(account.name ? { name: account.name } : undefined),
            ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
            provider: account.provider,
          },
        };
        if (persisted.account?.email && persisted.account.email !== account.email) {
          for (const field of ACCOUNT_PREFERENCE_FIELDS) {
            delete next[field];
          }
          delete next.accountPreferencesSync;
        }
        return next;
      });
      return yield* this.accountSnapshot();
    });
  }

  clearAccount(): Effect.Effect<AccountSnapshot, PlatformError> {
    return Effect.as(
      this.#mutate((persisted) => {
        if (!persisted.account) return undefined;
        const { account: _account, ...withoutAccount } = persisted;
        const next: PersistedSettings = { ...withoutAccount };
        for (const field of ACCOUNT_PREFERENCE_FIELDS) {
          delete next[field];
        }
        delete next.accountPreferencesSync;
        return next;
      }),
      { status: ACCOUNT_STATUS.SIGNED_OUT },
    );
  }

  /** Main-process only: the source the minter and the reviewer are built for. */
  readVoiceSource(): Effect.Effect<VoiceSource, PlatformError> {
    return Effect.map(
      Effect.flatMap(this.#load(), (persisted) => this.#voiceCapability(persisted)),
      (capability) => capability.source,
    );
  }

  /**
   * What a spoken turn would actually run on: the stored choice read against
   * what this run holds. One resolution, so the panel's snapshot and the
   * minter's own read can never answer the question differently.
   */
  #voiceCapability(persisted: PersistedSettings) {
    return Effect.gen(this, function* () {
      const key = yield* this.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID);
      const account = yield* this.readAccount();
      return resolveVoiceCapability({
        credentialsUsable: this.#credentialsUsable,
        keyConfigured: this.#credentialsUsable && key !== undefined,
        accountSignedIn: this.#credentialsUsable && account !== undefined,
        chosenSource: persisted.voiceSource,
      });
    });
  }

  /**
   * Main-process only: the resolved key used to authenticate that provider's
   * reads. A provider with no key resolves to nothing, so its adapter observes
   * nothing and issues no request.
   */
  readApiKey(providerId: CredentialProviderId): Effect.Effect<string | undefined, PlatformError> {
    const provider = CREDENTIAL_PROVIDER_LIST.find((candidate) => candidate.id === providerId);
    if (!provider) return Effect.succeed(undefined);
    return Effect.map(this.#resolveApiKey(provider), (resolved) => resolved.apiKey);
  }

  /**
   * Main-process only: the key stored encrypted in Luke's own file, and never
   * one resolved from the launch environment. The vault sweep is the caller —
   * an environment key was configured for this machine's shell, not entered
   * into Luke, so it is not Luke's to send anywhere.
   */
  readStoredApiKey(
    providerId: CredentialProviderId,
  ): Effect.Effect<string | undefined, PlatformError> {
    const provider = CREDENTIAL_PROVIDER_LIST.find((candidate) => candidate.id === providerId);
    if (!provider) return Effect.succeed(undefined);
    return Effect.map(this.#resolveApiKey(provider), (resolved) =>
      resolved.source === CREDENTIAL_SOURCE.ENCRYPTED_FILE ? resolved.apiKey : undefined,
    );
  }

  /** Which account this Mac's provider keys were last synced for; see the field. */
  readVaultSyncAccount(): Effect.Effect<string | undefined, PlatformError> {
    return Effect.map(this.#load(), (persisted) => persisted.vaultSyncAccount);
  }

  setVaultSyncAccount(accountKey: string): Effect.Effect<void, PlatformError> {
    return Effect.asVoid(
      this.#mutate((persisted) =>
        persisted.vaultSyncAccount === accountKey
          ? undefined
          : { ...persisted, vaultSyncAccount: accountKey },
      ),
    );
  }

  /**
   * Stores one provider's key encrypted at rest, or clears it when omitted. A
   * key the user cannot use comes back as a `reason` rather than an exception,
   * so only an unexpected filesystem failure throws.
   */
  setApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      const keyFormat = CREDENTIAL_PROVIDER_LIST.find(
        (candidate) => candidate.id === providerId,
      )?.keyFormat;
      const normalized = apiKey?.trim();
      // Clearing a key needs no cipher, so only a key on its way in asks whether
      // there is anywhere to put it.
      const rejection = normalized
        ? !this.#secretStorageUsable()
          ? "Encrypted credential storage is unavailable on this system."
          : apiKeyRejection(normalized, keyFormat)
        : undefined;
      if (rejection)
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          settings: yield* this.snapshot(),
          reason: rejection,
        };

      yield* this.#mutate(
        (persisted) => {
          const ciphertext = normalized
            ? this.#cipher.encrypt(normalized).toString("base64")
            : undefined;
          // Connecting the key voice runs on is choosing it: someone who parked on
          // the free allowance and later pastes a key means to use that key, and a
          // stored preference quietly ignoring it would look like the key failed
          // to save. Deleting one leaves the choice alone — there is nothing left
          // for it to hold back, and it says where to land if another key arrives.
          const chooses =
            providerId === VOICE_CREDENTIAL_PROVIDER_ID &&
            ciphertext !== undefined &&
            persisted.voiceSource !== VOICE_SOURCE.KEY;
          // A key that is already stored is not a write — unless it is also the
          // act of choosing it, which pasting the same key back while parked on
          // the allowance is.
          if (persisted.apiKeys[providerId] === ciphertext && !chooses) return undefined;
          // Every other provider's ciphertext is carried over, so saving one key
          // never disturbs another.
          const apiKeys = { ...persisted.apiKeys };
          if (ciphertext) apiKeys[providerId] = ciphertext;
          else delete apiKeys[providerId];
          const next: PersistedSettings = { ...persisted, apiKeys };
          if (chooses) next.voiceSource = VOICE_SOURCE.KEY;
          return next;
        },
        () => this.#resolved.delete(providerId),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /**
   * Connects one calendar account: the grant its sign-in produced, encrypted
   * at rest like every credential, under the account's own id. Signing into
   * an account already connected replaces its grant and keeps its calendar
   * choices — the choices are the user's, and a fresh grant is not a fresh
   * mind about them.
   */
  addCalendarAccount(
    accountId: string,
    refreshToken: string,
    selectedCalendarIds: readonly string[],
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      const id = calendarIdentifierText(accountId);
      const normalized = refreshToken.trim();
      const rejection = !id
        ? "Google answered the sign-in without naming an account."
        : !this.#secretStorageUsable()
          ? "Encrypted credential storage is unavailable on this system."
          : // The shape rules a pasted key answers to: a grant is Google's to
            // shape, and only sendability is checked.
            apiKeyRejection(normalized);
      if (rejection || !id) {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          settings: yield* this.snapshot(),
          reason: rejection ?? "Google answered the sign-in without naming an account.",
        };
      }

      yield* this.#mutate(
        (persisted) => {
          const token = this.#cipher.encrypt(normalized).toString("base64");
          const existing = persisted.calendarAccounts ?? [];
          const held = existing.find((account) => account.id === id);
          if (!held && existing.length >= MAXIMUM_CALENDAR_ACCOUNTS) {
            throw new Error("More calendar accounts than the store keeps");
          }
          const account: PersistedCalendarAccount = {
            id,
            token,
            calendars: held
              ? held.calendars
              : sanitizedCalendarIds(unparsedWire(selectedCalendarIds)),
          };
          return withCalendarAccounts(
            persisted,
            held
              ? existing.map((candidate) => (candidate.id === id ? account : candidate))
              : [...existing, account],
          );
        },
        () => this.#forgetCalendarAccounts(),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /** Disconnects one account, deleting its stored grant with it. */
  removeCalendarAccount(accountId: string): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      yield* this.#mutate(
        (persisted) => {
          const existing = persisted.calendarAccounts ?? [];
          const calendarAccounts = existing.filter((account) => account.id !== accountId);
          return calendarAccounts.length === existing.length
            ? undefined
            : withCalendarAccounts(persisted, calendarAccounts);
        },
        () => this.#forgetCalendarAccounts(),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /**
   * Chooses whether one of a connection's calendars counts toward meetings —
   * the Google accounts and this Mac's connection through one door, routed
   * by the account id, so no caller has to know the two are stored apart.
   * Whether the calendar exists is answered where the list lives — the main
   * process validates a selection against its latest observation — so only
   * the value's shape is held here.
   */
  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      const id = calendarIdentifierText(calendarId);
      if (!id)
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          settings: yield* this.snapshot(),
          reason: "That is not a calendar id.",
        };
      let missing: string | undefined;
      const apple = accountId === APPLE_CALENDAR_ID;
      yield* this.#mutate(
        (persisted) => {
          if (apple) {
            const held = persisted.appleCalendar;
            if (!held) {
              missing = "Apple Calendar is not connected.";
              return undefined;
            }
            const calendars = toggledCalendarSelection(held.calendars, id, selected);
            return calendars ? withAppleCalendar(persisted, { calendars }) : undefined;
          }
          const existing = persisted.calendarAccounts ?? [];
          const held = existing.find((account) => account.id === accountId);
          if (!held) {
            missing = "That calendar account is not connected.";
            return undefined;
          }
          const calendars = toggledCalendarSelection(held.calendars, id, selected);
          if (!calendars) return undefined;
          return withCalendarAccounts(
            persisted,
            existing.map((account) =>
              account.id === accountId ? { ...account, calendars } : account,
            ),
          );
        },
        // Only a Google account's grant is decrypted, so only its edit costs the
        // cache; this Mac's connection carries no grant to have cached.
        apple ? undefined : () => this.#forgetCalendarAccounts(),
      );
      const settings = yield* this.snapshot();
      return missing
        ? { status: ACTION_RESULT_STATUS.REJECTED, settings, reason: missing }
        : { status: ACTION_RESULT_STATUS.ACCEPTED, settings };
    });
  }

  /**
   * Main-process only, like the resolved keys: every connected account with
   * its grant decrypted, for the reader. A grant that no longer decrypts —
   * another OS account, a rotated Keychain — is skipped; its row still shows
   * connected, and the failing read is what says to sign in again.
   */
  readCalendarAccounts(): Effect.Effect<readonly CalendarAccountCredential[], PlatformError> {
    return Effect.gen(this, function* () {
      if (this.#resolvedCalendarAccounts) return this.#resolvedCalendarAccounts;
      const persisted = yield* this.#load();
      const accounts: CalendarAccountCredential[] = [];
      for (const account of persisted.calendarAccounts ?? []) {
        const refreshToken = this.#decryptSecret(account.token);
        if (!refreshToken) continue;
        accounts.push({ id: account.id, refreshToken, selectedCalendarIds: account.calendars });
      }
      this.#resolvedCalendarAccounts = accounts;
      return accounts;
    });
  }

  /**
   * Connects this Mac's Calendar. Nothing secret is stored — the grant lives
   * with macOS — only the fact of the connection and the calendar ids the
   * user chose to count. Connecting while already connected keeps the held
   * choices: the choices are the user's, and asking again is not a fresh
   * mind about them.
   */
  connectAppleCalendar(
    selectedCalendarIds: readonly string[],
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      yield* this.#mutate((persisted) =>
        persisted.appleCalendar
          ? undefined
          : withAppleCalendar(persisted, {
              calendars: sanitizedCalendarIds(unparsedWire(selectedCalendarIds)),
            }),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /**
   * Disconnects this Mac's Calendar. Only the connection is Luke's to delete:
   * the system grant stays macOS's, withdrawable in System Settings.
   */
  disconnectAppleCalendar(): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      yield* this.#mutate((persisted) =>
        persisted.appleCalendar ? withAppleCalendar(persisted, undefined) : undefined,
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /** The decrypted account list a written one makes stale. */
  #forgetCalendarAccounts(): void {
    this.#resolvedCalendarAccounts = undefined;
  }

  /**
   * Whether any calendar connection is stored at all — presence alone, with
   * no grant decrypted and no keychain touched, for the onboarding reconcile
   * that only needs to know the step's purpose is already standing.
   */
  calendarConnectionStored(): Effect.Effect<boolean, PlatformError> {
    return Effect.map(
      this.#load(),
      (persisted) =>
        (persisted.calendarAccounts ?? []).length > 0 || persisted.appleCalendar !== undefined,
    );
  }

  /** The connection as the reader is fed it; absent means never run the helper. */
  readAppleCalendarConnection(): Effect.Effect<AppleCalendarConnection | undefined, PlatformError> {
    return Effect.map(this.#load(), ({ appleCalendar: held }) =>
      held ? { selectedCalendarIds: held.calendars } : undefined,
    );
  }

  /**
   * Returns one group of preferences to its defaults in a single write, by
   * forgetting the choices rather than storing copies of the defaults: an
   * optional field is deleted the way its own clear deletes it, and a plain
   * boolean goes back to the value `APP_SETTING_DEFAULTS` states — so a
   * default that moves in a later build moves these settings with it. The
   * scopes are fixed by this build and none reaches a credential, an account,
   * or the agent pairing, whose own row already offers the provider's default.
   * A scope already at its defaults writes nothing, like any other setter
   * asked for the value it holds.
   */
  resetSettings(scope: SettingsResetScope): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen(this, function* () {
      yield* this.#mutate((persisted) => {
        const next: PersistedSettings = { ...persisted };
        for (const field of APP_SETTING_FIELDS) {
          const definition = APP_SETTING_SCHEMA[field];
          if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
          if (definition.guard(undefined).valid) delete next[field];
          else Object.assign(next, { [field]: definition.default });
        }
        const changed = APP_SETTING_FIELDS.some((field) => next[field] !== persisted[field]);
        return changed ? next : undefined;
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  /**
   * The one settings write: serialize, load, mutate, stamp, write, cache, and
   * invalidate. A mutator answering nothing means the stored value is already
   * the one asked for, so nothing is written. It runs exactly once per call,
   * so it may record what it decided for its caller to read afterwards.
   *
   * `invalidate` drops the caches the write made stale, and runs only after
   * one actually landed: dropping a decrypted value a no-op change did not
   * disturb would cost a Keychain read for nothing. Answers whether a write
   * landed.
   */
  #mutate(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
    invalidate?: () => void,
  ): Effect.Effect<boolean, PlatformError> {
    return this.#writes.withPermits(1)(
      Effect.gen(this, function* () {
        const persisted = yield* this.#load();
        const mutated = mutate(persisted);
        if (!mutated) return false;
        const next: PersistedSettings = { ...mutated, version: SETTINGS_FILE_VERSION };
        yield* this.#write(next);
        this.#held = next;
        invalidate?.();
        return true;
      }),
    );
  }

  /**
   * Asks the cipher whether it can protect a key, and remembers the answer. The
   * question is asked at most once per run, and only from a path that has a
   * credential in hand: on macOS asking is a Keychain read, which is the
   * permission dialog this deliberately keeps out of an ordinary launch.
   */
  #secretStorageUsable(): boolean {
    if (this.#secretStorage === SECRET_STORAGE.UNKNOWN) {
      let available = false;
      try {
        available = this.#cipher.isAvailable();
      } catch {
        available = false;
      }
      this.#secretStorage = available ? SECRET_STORAGE.AVAILABLE : SECRET_STORAGE.UNAVAILABLE;
    }
    return this.#secretStorage === SECRET_STORAGE.AVAILABLE;
  }

  /**
   * The resolved key is cached because the observation timer asks for it every
   * few seconds, and decrypting on each tick would hit the OS keychain
   * thousands of times a day for a value only the user can change.
   */
  #resolveApiKey(provider: CredentialProvider): Effect.Effect<ResolvedApiKey, PlatformError> {
    return Effect.gen(this, function* () {
      const cached = this.#resolved.get(provider.id);
      if (cached) return cached;
      const stored = yield* this.#storedApiKey(provider);
      const fromEnvironment = stored ? undefined : this.#overrides.apiKeys.get(provider.id);
      const resolved: ResolvedApiKey = stored
        ? { apiKey: stored, source: CREDENTIAL_SOURCE.ENCRYPTED_FILE }
        : fromEnvironment
          ? { apiKey: Redacted.value(fromEnvironment), source: CREDENTIAL_SOURCE.ENVIRONMENT }
          : { source: CREDENTIAL_SOURCE.NONE };
      this.#resolved.set(provider.id, resolved);
      return resolved;
    });
  }

  #storedApiKey(provider: CredentialProvider): Effect.Effect<string | undefined, PlatformError> {
    return Effect.map(this.#load(), (persisted) => {
      const ciphertext = persisted.apiKeys[provider.id];
      return ciphertext ? this.#decryptSecret(ciphertext, provider.keyFormat) : undefined;
    });
  }

  /**
   * One stored ciphertext's JSON object, read by the caller's own reader, or
   * nothing. Unrecoverable is an answer: a value encrypted under a different OS
   * account, or against a rotated Keychain entry, cannot be read back, and the
   * row it draws is what says to connect again.
   */
  #decryptRecord<Value>(
    cipherText: string,
    read: (record: WireRecord) => Value | undefined,
  ): Value | undefined {
    try {
      const parsed = JSON.parse(this.#cipher.decrypt(Buffer.from(cipherText, "base64")));
      return isRecord(parsed) ? read(parsed) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * One stored ciphertext's plain secret, held to the same sendability rule a
   * pasted key answers to — so a secret stored before this build learned which
   * kind its provider issues is held to the rule added later. Unrecoverable
   * reads as absent, exactly as a record's does.
   */
  #decryptSecret(cipherText: string, format?: CredentialFormat): string | undefined {
    try {
      const secret = this.#cipher.decrypt(Buffer.from(cipherText, "base64")).trim();
      return secret && !apiKeyRejection(secret, format) ? secret : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Shares one read, but lets a transient failure retry next time. The gate is
   * what shares it: a second reader waits for the first read rather than
   * making its own, and a read that failed leaves nothing held, so the next
   * one tries the file again rather than turning an I/O failure into writable
   * defaults.
   */
  #load(): Effect.Effect<PersistedSettings, PlatformError> {
    return this.#reads.withPermits(1)(
      Effect.suspend(() =>
        this.#held
          ? Effect.succeed(this.#held)
          : Effect.tap(this.#readPersisted(), (persisted) =>
              Effect.sync(() => {
                this.#held = persisted;
              }),
            ),
      ),
    );
  }

  #readPersisted(): Effect.Effect<PersistedSettings, PlatformError> {
    return Effect.map(this.#onFileSystem(readSettingsFileText(this.#directory())), (source) =>
      source === undefined
        ? defaultPersistedSettings()
        : // A corrupt settings file is replaced by the next write rather than
          // failing app start, so a refusal here falls back to defaults exactly
          // as an absent file does.
          Either.getOrElse(parsePersistedSettingsEither(source), defaultPersistedSettings),
    );
  }

  /** Only ever run inside `#mutate`'s gate, so writes cannot interleave. */
  #write(persisted: PersistedSettings): Effect.Effect<void, PlatformError> {
    return this.#onFileSystem(
      writeSettingsFileAtomic(this.#directory(), `${JSON.stringify(persisted, undefined, 2)}\n`),
    );
  }

  /**
   * The file system this store was handed, provided to its own reads and
   * writes, so a caller of any method above is left nothing to provide.
   */
  #onFileSystem<A>(
    effect: Effect.Effect<A, PlatformError, FileSystem.FileSystem>,
  ): Effect.Effect<A, PlatformError> {
    return Effect.provideService(effect, FileSystem.FileSystem, this.#fileSystem);
  }
}
