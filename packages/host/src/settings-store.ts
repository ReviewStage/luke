import fs from "node:fs/promises";
import path from "node:path";
import { APPLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_LIST,
  type CredentialFormat,
  type CredentialProvider,
  type CredentialProviderId,
  type LinearGrant,
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
import { Redacted } from "effect";
// The reader owns the shape it is fed: what this store resolves a stored
// connection into is exactly what `readAppleCalendarConnection` promises it.
import type { AppleCalendarConnection } from "./apple-calendar.js";
import type { SettingsEnvironmentOverrides } from "./effect/settings-overrides.js";

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

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
const SETTINGS_FILE_VERSION = 2;
const SETTINGS_FILE_MODE = 0o600;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  API_KEYS: "apiKeys",
  APPLE_CALENDAR: "appleCalendar",
  CALENDAR_ACCOUNTS: "calendarAccounts",
  GRANTS: "grants",
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
}

interface PersistedSettings extends StoredAppSettings {
  version: number;
  /**
   * Ciphertext by provider id. A provider this build does not know is carried
   * through untouched so an older build cannot discard a newer one's key.
   */
  apiKeys: Readonly<Record<string, string>>;
  /**
   * The consent grants, by provider id, kept apart from the pasted keys
   * because what is inside is not a credential the user could type back in:
   * two tokens and the moment the shorter-lived one lapses. Carried through
   * untouched for a provider this build does not know, exactly as a key is.
   */
  grants?: Readonly<Record<string, PersistedGrant>>;
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
 * One provider's consent grant at rest. The tokens travel together under one
 * ciphertext, the way the account's do — they are useless apart, and a single
 * decryption is a single trip to the Keychain. The expiry stays in plaintext
 * beside it: when a token lapses is not a secret, and knowing it without
 * decrypting is what lets a pass skip the refresh it does not need.
 */
interface PersistedGrant {
  tokenCipher: string;
  expiresAt: number;
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

/** Reads the stored grants, keeping only well-formed entries. */
function storedGrants(record: WireRecord) {
  const grants: Record<string, PersistedGrant> = {};
  const persisted = record[SETTINGS_FIELD.GRANTS];
  if (!isRecord(persisted)) {
    return grants;
  }
  for (const [providerId, entry] of Object.entries(persisted)) {
    if (!isRecord(entry)) continue;
    const { tokenCipher, expiresAt } = entry;
    if (!isWireString(tokenCipher) || !tokenCipher) continue;
    // A grant whose expiry did not survive the file is treated as lapsed
    // rather than as eternal, so the next pass refreshes it before riding it.
    grants[providerId] = {
      tokenCipher,
      expiresAt: isWireNumber(expiresAt) ? expiresAt : 0,
    };
  }
  return grants;
}
function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function canIgnoreFilesystemError(error: Error): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
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

function storedApiKeys(record: WireRecord, providers: readonly CredentialProvider[]) {
  const apiKeys: Record<string, string> = {};
  const persisted = record[SETTINGS_FIELD.API_KEYS];
  if (isRecord(persisted)) {
    for (const [providerId, ciphertext] of Object.entries(persisted)) {
      if (!isWireString(ciphertext) || !ciphertext) continue;
      // A provider this build connects by consent takes no key, so a key left
      // by a build that asked for one is dropped rather than carried: it can
      // never authorize anything again, and a credential Luke will not use is
      // not a credential Luke should keep. A provider this build does not
      // know is still carried through untouched — that is an older build
      // meeting a newer one's key, which is the opposite case.
      const provider = providers.find((candidate) => candidate.id === providerId);
      if (provider?.connection === CREDENTIAL_CONNECTION.CONSENT) continue;
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

function parsePersistedSettings(
  source: string,
  providers: readonly CredentialProvider[],
): PersistedSettings {
  const parsed = JSON.parse(source);
  if (!isRecord(parsed)) {
    throw new Error("Settings file is not an object");
  }
  const record = parsed;
  const version = record[SETTINGS_FIELD.VERSION];
  const calendarAccounts = storedCalendarAccounts(record);
  const appleCalendar = storedAppleCalendar(record);
  const grants = storedGrants(record);
  const settings = readStoredSettings(record);
  const vaultSyncAccount = record[SETTINGS_FIELD.VAULT_SYNC_ACCOUNT];
  const account = storedAccount(record);
  const accountPreferencesSync = storedAccountPreferencesSync(record);
  const persisted = {
    ...settings,
    version: isWireNumber(version) ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record, providers),
    ...(Object.keys(grants).length > 0 ? { grants } : undefined),
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
  #loading: Promise<PersistedSettings> | undefined;
  #resolved = new Map<CredentialProviderId, ResolvedApiKey>();
  /** Decrypted accounts, cached like the keys so timers never drum the Keychain. */
  #resolvedCalendarAccounts: readonly CalendarAccountCredential[] | undefined;
  /** Decrypted grants, cached for the same reason and cleared by the same writes. */
  #resolvedGrants = new Map<CredentialProviderId, LinearGrant | undefined>();
  #mutations: Promise<void> = Promise.resolve();

  async get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>> {
    // SAFETY: PersistedSettings extends the schema-derived stored shape; the
    // generic field selects the same schema member on both sides.
    return (await this.#load())[field] as AppSettingValue<Field>;
  }

  async set<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult> {
    await this.#mutate((persisted) => {
      if (persisted[field] === value) return undefined;
      const next: PersistedSettings = { ...persisted };
      if (value === undefined) delete next[field];
      else Object.assign(next, { [field]: value });
      return next;
    });
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /**
   * Writes one entry of a map-valued setting, or forgets it when the value is
   * omitted. The merge happens inside the mutation rather than in the caller so
   * one key's write cannot drop another's: a caller holding the map it read
   * before an overlapping write landed would put the stale copy back. A map
   * left with no entries is deleted, so an emptied setting reads as unset
   * rather than as an empty object.
   */
  async setEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Promise<SettingsUpdateResult> {
    // SAFETY: a setting entry's own value is one of the wire values it was parsed from.
    const entry = value as UnparsedWireValue;
    await this.#mutate((persisted) => {
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
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  async accountPreferences(): Promise<AccountPreferences> {
    return accountPreferencesFromPersisted(await this.#load());
  }

  async applyAccountPreferences(
    settings: AccountPreferences,
    expected?: { accountEmail: string; preferences: AccountPreferences },
  ): Promise<SettingsUpdateResult & { changed: readonly AccountPreferenceField[] }> {
    const changed: AccountPreferenceField[] = [];
    await this.#mutate((persisted) => {
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
      settings: await this.snapshot(),
      changed,
    };
  }

  async accountPreferencesSyncBaseline(
    accountEmail: string,
  ): Promise<AccountPreferences | undefined> {
    const sync = (await this.#load()).accountPreferencesSync;
    return sync?.accountEmail === accountEmail ? sync.preferences : undefined;
  }

  async setAccountPreferencesSyncBaseline(
    accountEmail: string,
    preferences: AccountPreferences,
  ): Promise<boolean> {
    let saved = false;
    await this.#mutate((persisted) => {
      if (persisted.account?.email !== accountEmail) return undefined;
      saved = true;
      if (
        persisted.accountPreferencesSync?.accountEmail === accountEmail &&
        JSON.stringify(persisted.accountPreferencesSync.preferences) === JSON.stringify(preferences)
      ) {
        return undefined;
      }
      return { ...persisted, accountPreferencesSync: { accountEmail, preferences } };
    });
    return saved;
  }

  /** Clears one map entry only if it still holds the value the caller read. */
  async clearEntryIfUnchanged<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    expected: SettingEntryValue<Field>,
  ): Promise<SettingsUpdateResult & { cleared: boolean }> {
    // SAFETY: a setting entry's own value is one of the wire values it was parsed from.
    const held = expected as UnparsedWireValue;
    const cleared = await this.#mutate((persisted) => {
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
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot(), cleared };
  }
  #secretStorage: SecretStorage = SECRET_STORAGE.UNKNOWN;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#overrides = options.overrides;
    this.#credentialsUsable = options.credentialsUsable ?? true;
  }

  async snapshot(): Promise<AppSettings> {
    const persisted = await this.#load();
    const voiceCapability = await this.#voiceCapability(persisted);
    const sources = await Promise.all(
      CREDENTIAL_PROVIDER_LIST.map(
        async (provider) => [provider.id, (await this.#resolveApiKey(provider)).source] as const,
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
        // The same question for Linear, answered the same way: without a
        // registered OAuth client there is no consent page to open, so the row
        // is not drawn rather than drawn refusing.
        linearSignInAvailable:
          this.#credentialsUsable && this.#overrides.linearSignIn !== undefined,
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
  }

  /** Returns account credentials only to the main process. */
  async readAccount(): Promise<StoredAccount | undefined> {
    const account = (await this.#load()).account;
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
  }

  async accountSnapshot(): Promise<AccountSnapshot> {
    const account = await this.readAccount();
    return account
      ? {
          status: ACCOUNT_STATUS.SIGNED_IN,
          email: account.email,
          ...(account.name ? { name: account.name } : undefined),
          ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
          provider: account.provider,
        }
      : { status: ACCOUNT_STATUS.SIGNED_OUT };
  }

  /** Stores both OAuth tokens under one Keychain-backed ciphertext. */
  async setAccount(account: StoredAccount): Promise<AccountSnapshot> {
    if (!this.#secretStorageUsable()) {
      throw new Error("Encrypted credential storage is unavailable on this system.");
    }
    await this.#mutate((persisted) => {
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
    return this.accountSnapshot();
  }

  async clearAccount(): Promise<AccountSnapshot> {
    await this.#mutate((persisted) => {
      if (!persisted.account) return undefined;
      const { account: _account, ...withoutAccount } = persisted;
      const next: PersistedSettings = { ...withoutAccount };
      for (const field of ACCOUNT_PREFERENCE_FIELDS) {
        delete next[field];
      }
      delete next.accountPreferencesSync;
      return next;
    });
    return { status: ACCOUNT_STATUS.SIGNED_OUT };
  }

  /** Main-process only: the source the minter and the reviewer are built for. */
  async readVoiceSource(): Promise<VoiceSource> {
    return (await this.#voiceCapability(await this.#load())).source;
  }

  /**
   * What a spoken turn would actually run on: the stored choice read against
   * what this run holds. One resolution, so the panel's snapshot and the
   * minter's own read can never answer the question differently.
   */
  async #voiceCapability(persisted: PersistedSettings) {
    return resolveVoiceCapability({
      credentialsUsable: this.#credentialsUsable,
      keyConfigured:
        this.#credentialsUsable &&
        (await this.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)) !== undefined,
      accountSignedIn: this.#credentialsUsable && (await this.readAccount()) !== undefined,
      chosenSource: persisted.voiceSource,
    });
  }

  /**
   * Main-process only: the resolved key used to authenticate that provider's
   * reads. A provider with no key resolves to nothing, so its adapter observes
   * nothing and issues no request.
   */
  async readApiKey(providerId: CredentialProviderId): Promise<string | undefined> {
    const provider = CREDENTIAL_PROVIDER_LIST.find((candidate) => candidate.id === providerId);
    if (!provider) return undefined;
    return (await this.#resolveApiKey(provider)).apiKey;
  }

  /**
   * Main-process only: the key stored encrypted in Luke's own file, and never
   * one resolved from the launch environment. The vault sweep is the caller —
   * an environment key was configured for this machine's shell, not entered
   * into Luke, so it is not Luke's to send anywhere.
   */
  async readStoredApiKey(providerId: CredentialProviderId): Promise<string | undefined> {
    const provider = CREDENTIAL_PROVIDER_LIST.find((candidate) => candidate.id === providerId);
    if (!provider) return undefined;
    const resolved = await this.#resolveApiKey(provider);
    return resolved.source === CREDENTIAL_SOURCE.ENCRYPTED_FILE ? resolved.apiKey : undefined;
  }

  /** Which account this Mac's provider keys were last synced for; see the field. */
  async readVaultSyncAccount(): Promise<string | undefined> {
    return (await this.#load()).vaultSyncAccount;
  }

  async setVaultSyncAccount(accountKey: string): Promise<void> {
    await this.#mutate((persisted) =>
      persisted.vaultSyncAccount === accountKey
        ? undefined
        : { ...persisted, vaultSyncAccount: accountKey },
    );
  }

  /**
   * Stores one provider's key encrypted at rest, or clears it when omitted. A
   * key the user cannot use comes back as a `reason` rather than an exception,
   * so only an unexpected filesystem failure throws.
   */
  async setApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Promise<SettingsUpdateResult> {
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
        settings: await this.snapshot(),
        reason: rejection,
      };

    await this.#mutate(
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
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /**
   * Main-process only, like the resolved keys: one provider's grant with its
   * tokens decrypted, for the reader that mints requests from it. A grant
   * that no longer decrypts — another OS account, a rotated Keychain — reads
   * as absent, and the row it draws says to connect again.
   */
  async readGrant(providerId: CredentialProviderId): Promise<LinearGrant | undefined> {
    if (this.#resolvedGrants.has(providerId)) return this.#resolvedGrants.get(providerId);
    const held = (await this.#load()).grants?.[providerId];
    const grant = held ? this.#decryptGrant(held) : undefined;
    this.#resolvedGrants.set(providerId, grant);
    return grant;
  }

  /**
   * Stores one provider's grant encrypted at rest. Every refresh comes back
   * through here as well as every connection, because Linear consumes the
   * refresh token it is given: a grant refreshed and not written is a grant
   * the user has to make again.
   */
  async setGrant(
    providerId: CredentialProviderId,
    grant: LinearGrant,
  ): Promise<SettingsUpdateResult> {
    const accessToken = grant.accessToken.trim();
    const rejection = !this.#secretStorageUsable()
      ? "Encrypted credential storage is unavailable on this system."
      : // The shape rules a pasted key answers to. What is inside is the
        // provider's to shape, so only sendability is checked.
        apiKeyRejection(accessToken);
    if (rejection)
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        settings: await this.snapshot(),
        reason: rejection,
      };

    await this.#mutate(
      (persisted) => {
        const tokenCipher = this.#cipher
          .encrypt(
            JSON.stringify({
              accessToken,
              ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : undefined),
            }),
          )
          .toString("base64");
        // Every other provider's grant is carried over, so connecting one never
        // disturbs another.
        const grants = { ...persisted.grants };
        grants[providerId] = { tokenCipher, expiresAt: grant.expiresAt };
        return { ...persisted, grants };
      },
      () => this.#forgetGrant(providerId),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /** Disconnects one provider, deleting its stored grant with it. */
  async clearGrant(providerId: CredentialProviderId): Promise<SettingsUpdateResult> {
    await this.#mutate(
      (persisted) => {
        if (!persisted.grants?.[providerId]) return undefined;
        const grants = { ...persisted.grants };
        delete grants[providerId];
        const next: PersistedSettings = { ...persisted };
        if (Object.keys(grants).length > 0) next.grants = grants;
        else delete next.grants;
        return next;
      },
      () => this.#forgetGrant(providerId),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /** Both caches a written grant makes stale: the grant itself and the row's source. */
  #forgetGrant(providerId: CredentialProviderId): void {
    this.#resolvedGrants.delete(providerId);
    // The row's own source is resolved from the same file, so it is stale now
    // for exactly the same reason.
    this.#resolved.delete(providerId);
  }

  /** Recovers one stored grant's tokens, or nothing if they cannot be read. */
  #decryptGrant(held: PersistedGrant): LinearGrant | undefined {
    return this.#decryptRecord(held.tokenCipher, (tokens) => {
      const { accessToken, refreshToken } = tokens;
      if (!isWireString(accessToken) || !accessToken) return undefined;
      return {
        accessToken,
        ...(isWireString(refreshToken) && refreshToken ? { refreshToken } : undefined),
        expiresAt: held.expiresAt,
      };
    });
  }

  /**
   * Connects one calendar account: the grant its sign-in produced, encrypted
   * at rest like every credential, under the account's own id. Signing into
   * an account already connected replaces its grant and keeps its calendar
   * choices — the choices are the user's, and a fresh grant is not a fresh
   * mind about them.
   */
  async addCalendarAccount(
    accountId: string,
    refreshToken: string,
    selectedCalendarIds: readonly string[],
  ): Promise<SettingsUpdateResult> {
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
        settings: await this.snapshot(),
        reason: rejection ?? "Google answered the sign-in without naming an account.",
      };
    }

    await this.#mutate(
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
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /** Disconnects one account, deleting its stored grant with it. */
  async removeCalendarAccount(accountId: string): Promise<SettingsUpdateResult> {
    await this.#mutate(
      (persisted) => {
        const existing = persisted.calendarAccounts ?? [];
        const calendarAccounts = existing.filter((account) => account.id !== accountId);
        return calendarAccounts.length === existing.length
          ? undefined
          : withCalendarAccounts(persisted, calendarAccounts);
      },
      () => this.#forgetCalendarAccounts(),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /**
   * Chooses whether one of a connection's calendars counts toward meetings —
   * the Google accounts and this Mac's connection through one door, routed
   * by the account id, so no caller has to know the two are stored apart.
   * Whether the calendar exists is answered where the list lives — the main
   * process validates a selection against its latest observation — so only
   * the value's shape is held here.
   */
  async setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Promise<SettingsUpdateResult> {
    const id = calendarIdentifierText(calendarId);
    if (!id)
      return {
        status: ACTION_RESULT_STATUS.REJECTED,
        settings: await this.snapshot(),
        reason: "That is not a calendar id.",
      };
    let missing: string | undefined;
    const apple = accountId === APPLE_CALENDAR_ID;
    await this.#mutate(
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
    const settings = await this.snapshot();
    return missing
      ? { status: ACTION_RESULT_STATUS.REJECTED, settings, reason: missing }
      : { status: ACTION_RESULT_STATUS.ACCEPTED, settings };
  }

  /**
   * Main-process only, like the resolved keys: every connected account with
   * its grant decrypted, for the reader. A grant that no longer decrypts —
   * another OS account, a rotated Keychain — is skipped; its row still shows
   * connected, and the failing read is what says to sign in again.
   */
  async readCalendarAccounts(): Promise<readonly CalendarAccountCredential[]> {
    if (this.#resolvedCalendarAccounts) return this.#resolvedCalendarAccounts;
    const persisted = await this.#load();
    const accounts: CalendarAccountCredential[] = [];
    for (const account of persisted.calendarAccounts ?? []) {
      const refreshToken = this.#decryptSecret(account.token);
      if (!refreshToken) continue;
      accounts.push({ id: account.id, refreshToken, selectedCalendarIds: account.calendars });
    }
    this.#resolvedCalendarAccounts = accounts;
    return accounts;
  }

  /**
   * Connects this Mac's Calendar. Nothing secret is stored — the grant lives
   * with macOS — only the fact of the connection and the calendar ids the
   * user chose to count. Connecting while already connected keeps the held
   * choices: the choices are the user's, and asking again is not a fresh
   * mind about them.
   */
  async connectAppleCalendar(
    selectedCalendarIds: readonly string[],
  ): Promise<SettingsUpdateResult> {
    await this.#mutate((persisted) =>
      persisted.appleCalendar
        ? undefined
        : withAppleCalendar(persisted, {
            calendars: sanitizedCalendarIds(unparsedWire(selectedCalendarIds)),
          }),
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
  }

  /**
   * Disconnects this Mac's Calendar. Only the connection is Luke's to delete:
   * the system grant stays macOS's, withdrawable in System Settings.
   */
  async disconnectAppleCalendar(): Promise<SettingsUpdateResult> {
    await this.#mutate((persisted) =>
      persisted.appleCalendar ? withAppleCalendar(persisted, undefined) : undefined,
    );
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
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
  async calendarConnectionStored(): Promise<boolean> {
    const persisted = await this.#load();
    return (persisted.calendarAccounts ?? []).length > 0 || persisted.appleCalendar !== undefined;
  }

  /** The connection as the reader is fed it; absent means never run the helper. */
  async readAppleCalendarConnection(): Promise<AppleCalendarConnection | undefined> {
    const held = (await this.#load()).appleCalendar;
    return held ? { selectedCalendarIds: held.calendars } : undefined;
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
  async resetSettings(scope: SettingsResetScope): Promise<SettingsUpdateResult> {
    await this.#mutate((persisted) => {
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
    return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: await this.snapshot() };
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
  async #mutate(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
    invalidate?: () => void,
  ): Promise<boolean> {
    let wrote = false;
    await this.#serialize(async () => {
      const persisted = await this.#load();
      const mutated = mutate(persisted);
      if (!mutated) return;
      const next: PersistedSettings = { ...mutated, version: SETTINGS_FILE_VERSION };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
      invalidate?.();
      wrote = true;
    });
    return wrote;
  }

  /**
   * Runs one settings change at a time. Serializing only the file write is not
   * enough: a user with more than one provider row can start a second save
   * before the first lands, and both would read the same stored keys before
   * either wrote, so the later write would drop the other provider's key.
   */
  async #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutations.then(operation);
    // A failed change must not wedge the queue, so the chain forgets its
    // outcome; the caller still receives the rejection.
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
  async #resolveApiKey(provider: CredentialProvider): Promise<ResolvedApiKey> {
    const cached = this.#resolved.get(provider.id);
    if (cached) return cached;
    // A consent grant is not a key and is never handed out as one: what
    // authorizes a request is minted from it, by the reader that holds it.
    // Only whether one is stored belongs here, because that is what the
    // provider's row draws — and a grant can only ever have come from this
    // file, never from a launch environment.
    if (provider.connection === CREDENTIAL_CONNECTION.CONSENT) {
      const held = (await this.#load()).grants?.[provider.id];
      const resolved: ResolvedApiKey = {
        source: held ? CREDENTIAL_SOURCE.ENCRYPTED_FILE : CREDENTIAL_SOURCE.NONE,
      };
      this.#resolved.set(provider.id, resolved);
      return resolved;
    }
    const stored = await this.#storedApiKey(provider);
    const fromEnvironment = stored ? undefined : this.#overrides.apiKeys.get(provider.id);
    const resolved: ResolvedApiKey = stored
      ? { apiKey: stored, source: CREDENTIAL_SOURCE.ENCRYPTED_FILE }
      : fromEnvironment
        ? { apiKey: Redacted.value(fromEnvironment), source: CREDENTIAL_SOURCE.ENVIRONMENT }
        : { source: CREDENTIAL_SOURCE.NONE };
    this.#resolved.set(provider.id, resolved);
    return resolved;
  }

  async #storedApiKey(provider: CredentialProvider): Promise<string | undefined> {
    const ciphertext = (await this.#load()).apiKeys[provider.id];
    return ciphertext ? this.#decryptSecret(ciphertext, provider.keyFormat) : undefined;
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

  /** Shares one in-flight read, but lets a transient failure retry next time. */
  async #load(): Promise<PersistedSettings> {
    const loading = this.#loading ?? this.#readPersisted();
    this.#loading = loading;
    try {
      return await loading;
    } catch (error) {
      // Defaults belong to an absent or corrupt file, both handled by the
      // reader. An unexpected I/O failure must not become writable defaults:
      // forget only this failed attempt so the next read can try the file again.
      if (this.#loading === loading) this.#loading = undefined;
      throw error;
    }
  }

  async #readPersisted(): Promise<PersistedSettings> {
    const settingsPath = path.join(this.#directory(), SETTINGS_FILE_NAME);
    let source: string | undefined;
    try {
      source = await fs.readFile(settingsPath, "utf8");
    } catch (error) {
      if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    }

    let persisted = defaultPersistedSettings();
    if (source) {
      try {
        persisted = parsePersistedSettings(source, CREDENTIAL_PROVIDER_LIST);
      } catch {
        // A corrupt settings file is replaced by the next write rather than
        // failing app start.
      }
    }
    return persisted;
  }

  /** Only ever called from inside `#serialize`, so writes cannot interleave. */
  async #write(persisted: PersistedSettings): Promise<void> {
    const directory = this.#directory();
    const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
    const temporaryPath = path.join(directory, SETTINGS_TEMPORARY_FILE_NAME);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, `${JSON.stringify(persisted, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: SETTINGS_FILE_MODE,
    });
    // `mode` only applies when the file is created, so a temporary file left
    // behind by an interrupted write keeps whatever mode it already had.
    await fs.chmod(temporaryPath, SETTINGS_FILE_MODE);
    await fs.rename(temporaryPath, settingsPath);
  }
}
