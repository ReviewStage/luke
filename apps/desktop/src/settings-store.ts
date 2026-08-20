import path from "node:path";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  isRecord,
  isWireNumber,
  isWireString,
  REALTIME_DEFAULTS,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/core";
import { Effect, Ref } from "effect";
// The reader owns the shape it is fed: what this store resolves a stored
// account into is exactly what `readAccounts` promises it.
import type { CalendarAccountCredential } from "./google-calendar";
import { googleCalendarSignInConfig } from "./google-calendar-oauth";
// The same ownership the calendar reader has over its credential shape: what
// this store resolves a stored grant into is what the sign-in produced.
import { type LinearGrant, linearSignInConfig } from "./linear-oauth";
import { environmentRealtimeSpeed, environmentRealtimeVoice } from "./openai-realtime-credentials";
import { FileFailure, Files } from "./services/files";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  type AppSettings,
  CLI_CONNECTION,
  type CliConnection,
  CREDENTIAL_SOURCE,
  type CredentialSource,
  SECRET_STORAGE,
  type SecretStorage,
  type SettingsResetScope,
  type SettingsUpdateResult,
  VOICE_SOURCE,
  type VoiceSource,
} from "./shared/contracts";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  type CredentialFormat,
  type CredentialProvider,
  type CredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "./shared/credential-providers";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  type KeyedAppSettingField,
  type SettingEntryValue,
  type StoredAppSettings,
  sameSettingEntry,
} from "./shared/settings-schema";
import { resolveVoiceCapability } from "./voice-capability-assembler";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Version 2 keys credentials by provider id; version 1 held one Conductor key. */
const SETTINGS_FILE_VERSION = 2;
const SETTINGS_FILE_MODE = 0o600;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  API_KEYS: "apiKeys",
  CALENDAR_ACCOUNTS: "calendarAccounts",
  GRANTS: "grants",
  LEGACY_CONDUCTOR_API_KEY: "conductorApiKey",
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
  environment?: NodeJS.ProcessEnv;
  providers?: readonly CredentialProvider[];
  /**
   * Whether this run will use the credentials it resolves. A fixture or evidence
   * run will not, and the panel has to mark what would actually happen rather
   * than what is stored — so `voiceAvailable` is false there however good the
   * key is. Only the app knows which kind of run this is. True by default.
   */
  credentialsUsable?: boolean;
  /**
   * What the latest observation pass learned about the Codex CLI's login. It
   * rides the settings snapshot beside `credentialSources` because it answers
   * the same question for a provider whose connection is not a key — but the
   * fact lives with the observer, so the app supplies it rather than the
   * store resolving it. Absent, the snapshot says the question was never
   * asked, which is what a store without an app around it can honestly say.
   */
  codexCloudConnection?: () => CliConnection;
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
   // SAFETY: The preceding check establishes the asserted contract.
   * untouched for a provider this build does not know, exactly as a key is.
   */
  grants?: Readonly<Record<string, PersistedGrant>>;
  /** Account tokens encrypted together; only display identity stays plaintext. */
  account?: {
    tokenCipher: string;
    email: string;
    name?: string;
    pictureUrl?: string;
    provider: AccountProvider;
  };
  /**
   * The connected calendar accounts: each account's id, the grant its sign-in
   // SAFETY: The preceding check establishes the asserted contract.
   * produced as ciphertext, and the calendar ids the user chose to count.
   * Absent from the file while none are connected.
   */
  calendarAccounts?: readonly PersistedCalendarAccount[];
}

interface ResolvedApiKey {
  apiKey?: string;
  source: CredentialSource;
}

export interface StoredAccount {
  accessToken: string;
  refreshToken: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  provider: AccountProvider;
}

function isAccountProvider(value: UnparsedWireValue): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

function storedAccount(record: WireRecord): PersistedSettings["account"] {
  const value = record[SETTINGS_FIELD.ACCOUNT];
  if (!isRecord(value)) return undefined;
  // SAFETY: The preceding check establishes the asserted contract.
  const account = value as WireRecord;
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

// SAFETY: The preceding check establishes the asserted contract.
/** A calendar-world identifier as this store will keep it, or nothing. */
function calendarIdentifierText(value: UnparsedWireValue): string | undefined {
  if (!isWireString(value)) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAXIMUM_CALENDAR_IDENTIFIER_LENGTH) return undefined;
  return normalized;
}

/** Reads the stored calendar accounts, keeping only well-formed entries. */
function storedCalendarAccounts(record: WireRecord): readonly PersistedCalendarAccount[] {
  const persisted = record[SETTINGS_FIELD.CALENDAR_ACCOUNTS];
  if (!Array.isArray(persisted)) return [];
  const accounts: PersistedCalendarAccount[] = [];
  for (const entry of persisted) {
    if (accounts.length >= MAXIMUM_CALENDAR_ACCOUNTS) break;
    if (!isRecord(entry)) continue;
    // SAFETY: The preceding check establishes the asserted contract.
    const { id, token, calendars } = entry as WireRecord;
    const accountId = calendarIdentifierText(id);
    if (!accountId || !isWireString(token) || !token) continue;
    if (accounts.some((held) => held.id === accountId)) continue;
    const selected = Array.isArray(calendars)
      ? calendars
          .map(calendarIdentifierText)
          .filter((value): value is string => value !== undefined)
          .slice(0, MAXIMUM_SELECTED_CALENDARS)
      : [];
    accounts.push({ id: accountId, token, calendars: selected });
  }
  return accounts;
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

/** Reads the stored grants, keeping only well-formed entries. */
function storedGrants(record: WireRecord) {
  const grants: Record<string, PersistedGrant> = {};
  const persisted = record[SETTINGS_FIELD.GRANTS];
  if (!isRecord(persisted)) {
    return grants;
  }
  for (const [providerId, entry] of Object.entries(persisted)) {
    if (!isRecord(entry)) continue;
    // SAFETY: The preceding check establishes the asserted contract.
    const { tokenCipher, expiresAt } = entry as WireRecord;
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

/**
 * A rejected key never reaches disk, and the reason never echoes the submitted
 // SAFETY: The preceding check establishes the asserted contract.
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

function environmentApiKey(
  provider: CredentialProvider,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  for (const variable of provider.environmentVariables) {
    const value = environment[variable]?.trim();
    if (value && !apiKeyRejection(value, provider.keyFormat)) return value;
  }
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
  // An installation upgraded from version 1 keeps its Conductor key: the
  // ciphertext is unchanged, so it decrypts exactly as it did before.
  const legacy = record[SETTINGS_FIELD.LEGACY_CONDUCTOR_API_KEY];
  if (isWireString(legacy) && legacy && !apiKeys[CREDENTIAL_PROVIDER_ID.CONDUCTOR]) {
    apiKeys[CREDENTIAL_PROVIDER_ID.CONDUCTOR] = legacy;
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
  return APP_SETTING_FIELDS.reduce(
    (settings, field) => ({
      ...settings,
      [field]: APP_SETTING_SCHEMA[field].guard(record[field]).value,
    }),
    // SAFETY: The reducer fills every StoredAppSettings field from the schema guards.
    {} as StoredAppSettings,
  );
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
  const grants = storedGrants(record);
  const settings = readStoredSettings(record);
  const persisted = {
    ...settings,
    version: isWireNumber(version) ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record, providers),
    ...(Object.keys(grants).length > 0 ? { grants } : undefined),
    ...(storedAccount(record) ? { account: storedAccount(record) } : undefined),
    ...(calendarAccounts.length > 0 ? { calendarAccounts } : undefined),
  };
  // SAFETY: readStoredSettings validated every preference field before this spread.
  return persisted as PersistedSettings;
}

/**
 * Reads and writes the small set of user-owned settings Luke needs. A stored
 * credential stays in the main process: callers can learn that a provider has a
 * key and can replace it, but no accessor returns one to a renderer.
 */ export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #providers: readonly CredentialProvider[];
  readonly #credentialsUsable: boolean;
  readonly #codexCloudConnection: () => CliConnection;
  readonly #persistedCache = Ref.unsafeMake<PersistedSettings | undefined>(undefined);
  readonly #mutationLock = Effect.unsafeMakeSemaphore(1);
  #resolved = new Map<CredentialProviderId, ResolvedApiKey>();
  #resolvedCalendarAccounts: readonly CalendarAccountCredential[] | undefined;
  #resolvedGrants = new Map<CredentialProviderId, LinearGrant | undefined>();
  #secretStorage: SecretStorage = SECRET_STORAGE.UNKNOWN;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#environment = options.environment ?? process.env;
    this.#providers = options.providers ?? CREDENTIAL_PROVIDER_LIST;
    this.#credentialsUsable = options.credentialsUsable ?? true;
    this.#codexCloudConnection = options.codexCloudConnection ?? (() => CLI_CONNECTION.UNKNOWN);
  }

  get<Field extends AppSettingField>(
    field: Field,
  ): Effect.Effect<AppSettingValue<Field>, FileFailure, Files> {
    return Effect.map(this.#load(), (persisted) => persisted[field]);
  }

  set<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files>;
  set(
    field: AppSettingField,
    value: StoredAppSettings[AppSettingField],
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files>;
  set(
    field: AppSettingField,
    value: StoredAppSettings[AppSettingField],
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return this.#setField((persisted) => {
      if (persisted[field] === value) return;
      const next: PersistedSettings = { ...persisted };
      if (value === undefined) delete next[field];
      else Object.assign(next, { [field]: value });
      return next;
    });
  }

  setEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files>;
  setEntry(
    field: KeyedAppSettingField,
    key: string,
    value: UnparsedWireValue,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files>;
  setEntry(
    field: KeyedAppSettingField,
    key: string,
    value: UnparsedWireValue,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return this.#setField((persisted) => {
      const current = persisted[field] as WireRecord | undefined;
      if (sameSettingEntry(field, current?.[key], value)) return;
      const entries = { ...current };
      if (value === undefined) delete entries[key];
      else entries[key] = value;
      const next: PersistedSettings = { ...persisted };
      if (Object.keys(entries).length > 0) Object.assign(next, { [field]: entries });
      else delete next[field];
      return next;
    });
  }

  clearEntryIfUnchanged<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    expected: SettingEntryValue<Field>,
  ): Effect.Effect<SettingsUpdateResult & { cleared: boolean }, FileFailure, Files> {
    return Effect.gen(this, function* () {
      let cleared = false;
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const current = persisted[field] as WireRecord | undefined;
          if (!sameSettingEntry(field, current?.[key], expected)) return;
          const entries = { ...current };
          delete entries[key];
          const next: PersistedSettings = { ...persisted, version: SETTINGS_FILE_VERSION };
          if (Object.keys(entries).length > 0) Object.assign(next, { [field]: entries });
          else delete next[field];
          yield* this.#write(next);
          cleared = true;
        }),
      );
      return { settings: yield* this.snapshot(), cleared };
    });
  }

  snapshot(): Effect.Effect<AppSettings, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const persisted = yield* this.#load();
      const voiceCapability = resolveVoiceCapability({
        credentialsUsable: this.#credentialsUsable,
        keyConfigured:
          this.#credentialsUsable &&
          (yield* this.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)) !== undefined,
        accountSignedIn: this.#credentialsUsable && (yield* this.readAccount()) !== undefined,
        chosenSource: persisted.voiceSource,
      });
      const sources = yield* Effect.forEach(this.#providers, (provider) =>
        Effect.map(
          this.#resolveApiKey(provider),
          (resolved) => [provider.id, resolved.source] as const,
        ),
      );
      return {
        credentialSources: Object.fromEntries(sources) as Record<
          CredentialProviderId,
          CredentialSource
        >,
        codexCloudConnection: this.#codexCloudConnection(),
        secretStorage: this.#secretStorage,
        voiceAvailable: voiceCapability.available,
        voiceSource: voiceCapability.source,
        calendarSignInAvailable:
          this.#credentialsUsable && googleCalendarSignInConfig(this.#environment) !== undefined,
        linearSignInAvailable:
          this.#credentialsUsable && linearSignInConfig(this.#environment) !== undefined,
        calendarAccounts: (persisted.calendarAccounts ?? []).map((account) => ({
          id: account.id,
          selectedCalendarIds: account.calendars,
        })),
        showInDock: persisted.showInDock,
        voice:
          persisted.voice ?? environmentRealtimeVoice(this.#environment) ?? REALTIME_DEFAULTS.VOICE,
        voiceSpeed:
          persisted.voiceSpeed ??
          environmentRealtimeSpeed(this.#environment) ??
          REALTIME_DEFAULTS.SPEED,
        voiceCaptions: persisted.voiceCaptions,
        ...(persisted.voiceHotkey ? { voiceHotkey: persisted.voiceHotkey } : undefined),
        ...(persisted.askHotkey ? { askHotkey: persisted.askHotkey } : undefined),
        ...(persisted.stopHotkey ? { stopHotkey: persisted.stopHotkey } : undefined),
        duckOtherMedia: persisted.duckOtherMedia,
        preferBuiltInMicrophone: persisted.preferBuiltInMicrophone,
        quietDuringMeetings: persisted.quietDuringMeetings,
        showOnAllDisplays: persisted.showOnAllDisplays,
        shareUsageData: persisted.shareUsageData,
        formFactor: persisted.formFactor ?? DEFAULT_PANEL_FORM_FACTOR,
        ...(persisted.defaultWorkspaceProvider
          ? { defaultWorkspaceProvider: persisted.defaultWorkspaceProvider }
          : undefined),
        ...(persisted.workspaceAgentDefaults
          ? { workspaceAgentDefaults: persisted.workspaceAgentDefaults }
          : undefined),
        ...(persisted.workspaceProjectDefaults
          ? { workspaceProjectDefaults: persisted.workspaceProjectDefaults }
          : undefined),
        ...(persisted.supersetAgentDefault
          ? { supersetAgentDefault: persisted.supersetAgentDefault }
          : undefined),
      };
    });
  }

  readAccount(): Effect.Effect<StoredAccount | undefined, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const account = (yield* this.#load()).account;
      if (!account) return undefined;
      try {
        const tokens = JSON.parse(this.#cipher.decrypt(Buffer.from(account.tokenCipher, "base64")));
        if (!isRecord(tokens)) return undefined;
        const { accessToken, refreshToken } = tokens as WireRecord;
        if (!isWireString(accessToken) || !isWireString(refreshToken)) return undefined;
        return {
          accessToken,
          refreshToken,
          email: account.email,
          ...(account.name ? { name: account.name } : undefined),
          ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
          provider: account.provider,
        };
      } catch {
        return undefined;
      }
    });
  }

  accountSnapshot(): Effect.Effect<AccountSnapshot, FileFailure | Error, Files> {
    return Effect.gen(this, function* () {
      const account = yield* this.readAccount();
      return account
        ? {
            status: ACCOUNT_STATUS.SIGNED_IN,
            email: account.email,
            ...(account.name ? { name: account.name } : undefined),
            ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
            provider: account.provider,
          }
        : { status: ACCOUNT_STATUS.SIGNED_OUT };
    });
  }

  setAccount(account: StoredAccount): Effect.Effect<AccountSnapshot, FileFailure | Error, Files> {
    return Effect.gen(this, function* () {
      if (!this.#secretStorageUsable()) {
        return yield* Effect.fail(
          new Error("Encrypted credential storage is unavailable on this system."),
        );
      }
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
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
            version: SETTINGS_FILE_VERSION,
            account: {
              tokenCipher,
              email: account.email,
              ...(account.name ? { name: account.name } : undefined),
              ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
              provider: account.provider,
            },
          };
          yield* this.#write(next);
        }),
      );
      return yield* this.accountSnapshot();
    });
  }

  clearAccount(): Effect.Effect<AccountSnapshot, FileFailure, Files> {
    return Effect.gen(this, function* () {
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          if (!persisted.account) return;
          const { account: _account, ...withoutAccount } = persisted;
          yield* this.#write({ ...withoutAccount, version: SETTINGS_FILE_VERSION });
        }),
      );
      return { status: ACCOUNT_STATUS.SIGNED_OUT };
    });
  }

  readVoiceSource(): Effect.Effect<VoiceSource, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const persisted = yield* this.#load();
      return resolveVoiceCapability({
        credentialsUsable: this.#credentialsUsable,
        keyConfigured:
          this.#credentialsUsable &&
          (yield* this.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)) !== undefined,
        accountSignedIn: this.#credentialsUsable && (yield* this.readAccount()) !== undefined,
        chosenSource: persisted.voiceSource,
      }).source;
    });
  }

  readApiKey(
    providerId: CredentialProviderId,
  ): Effect.Effect<string | undefined, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const provider = this.#providers.find((candidate) => candidate.id === providerId);
      if (!provider) return undefined;
      return (yield* this.#resolveApiKey(provider)).apiKey;
    });
  }

  setApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const keyFormat = this.#providers.find((candidate) => candidate.id === providerId)?.keyFormat;
      const normalized = apiKey?.trim();
      const rejection = normalized
        ? !this.#secretStorageUsable()
          ? "Encrypted credential storage is unavailable on this system."
          : apiKeyRejection(normalized, keyFormat)
        : undefined;
      if (rejection) return { settings: yield* this.snapshot(), reason: rejection };
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const ciphertext = normalized
            ? this.#cipher.encrypt(normalized).toString("base64")
            : undefined;
          const chooses =
            providerId === VOICE_CREDENTIAL_PROVIDER_ID &&
            ciphertext !== undefined &&
            persisted.voiceSource !== VOICE_SOURCE.KEY;
          if (persisted.apiKeys[providerId] === ciphertext && !chooses) return;
          const apiKeys = { ...persisted.apiKeys };
          if (ciphertext) apiKeys[providerId] = ciphertext;
          else delete apiKeys[providerId];
          const next: PersistedSettings = { ...persisted, version: SETTINGS_FILE_VERSION, apiKeys };
          if (chooses) next.voiceSource = VOICE_SOURCE.KEY;
          yield* this.#write(next);
          this.#resolved.delete(providerId);
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  readGrant(
    providerId: CredentialProviderId,
  ): Effect.Effect<LinearGrant | undefined, FileFailure, Files> {
    return Effect.gen(this, function* () {
      if (this.#resolvedGrants.has(providerId)) return this.#resolvedGrants.get(providerId);
      const held = (yield* this.#load()).grants?.[providerId];
      const grant = held ? this.#decryptGrant(held) : undefined;
      this.#resolvedGrants.set(providerId, grant);
      return grant;
    });
  }

  setGrant(
    providerId: CredentialProviderId,
    grant: LinearGrant,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const accessToken = grant.accessToken.trim();
      const rejection = !this.#secretStorageUsable()
        ? "Encrypted credential storage is unavailable on this system."
        : apiKeyRejection(accessToken);
      if (rejection) return { settings: yield* this.snapshot(), reason: rejection };
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const tokenCipher = this.#cipher
            .encrypt(
              JSON.stringify({
                accessToken,
                ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : undefined),
              }),
            )
            .toString("base64");
          const grants = { ...(persisted.grants ?? {}) };
          grants[providerId] = { tokenCipher, expiresAt: grant.expiresAt };
          yield* this.#writeGrants(persisted, grants, providerId);
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  clearGrant(
    providerId: CredentialProviderId,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          if (!persisted.grants?.[providerId]) return;
          const grants = { ...persisted.grants };
          delete grants[providerId];
          yield* this.#writeGrants(persisted, grants, providerId);
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  addCalendarAccount(
    accountId: string,
    refreshToken: string,
    selectedCalendarIds: readonly string[],
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const id = calendarIdentifierText(accountId);
      const normalized = refreshToken.trim();
      const rejection = !id
        ? "Google answered the sign-in without naming an account."
        : !this.#secretStorageUsable()
          ? "Encrypted credential storage is unavailable on this system."
          : apiKeyRejection(normalized);
      if (rejection || !id) return { settings: yield* this.snapshot(), reason: rejection };
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const token = this.#cipher.encrypt(normalized).toString("base64");
          const existing = persisted.calendarAccounts ?? [];
          const held = existing.find((account) => account.id === id);
          if (!held && existing.length >= MAXIMUM_CALENDAR_ACCOUNTS) {
            return yield* Effect.fail(
              new FileFailure({
                operation: "addCalendarAccount",
                path: "calendarAccounts",
              }),
            );
          }
          const account: PersistedCalendarAccount = {
            id,
            token,
            calendars: held
              ? held.calendars
              : selectedCalendarIds
                  .map(calendarIdentifierText)
                  .filter((value): value is string => value !== undefined)
                  .slice(0, MAXIMUM_SELECTED_CALENDARS),
          };
          const calendarAccounts = held
            ? existing.map((candidate) => (candidate.id === id ? account : candidate))
            : [...existing, account];
          yield* this.#writeCalendarAccounts(persisted, calendarAccounts);
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  removeCalendarAccount(
    accountId: string,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const existing = persisted.calendarAccounts ?? [];
          const calendarAccounts = existing.filter((account) => account.id !== accountId);
          if (calendarAccounts.length === existing.length) return;
          yield* this.#writeCalendarAccounts(persisted, calendarAccounts);
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const id = calendarIdentifierText(calendarId);
      if (!id) return { settings: yield* this.snapshot(), reason: "That is not a calendar id." };
      let unknownAccount = false;
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const existing = persisted.calendarAccounts ?? [];
          const held = existing.find((account) => account.id === accountId);
          if (!held) {
            unknownAccount = true;
            return;
          }
          const calendars = held.calendars.filter((candidate) => candidate !== id);
          if (selected) calendars.push(id);
          if (calendars.length > MAXIMUM_SELECTED_CALENDARS) return;
          if (
            calendars.length === held.calendars.length &&
            held.calendars.includes(id) === selected
          )
            return;
          const calendarAccounts = existing.map((account) =>
            account.id === accountId ? { ...account, calendars } : account,
          );
          yield* this.#writeCalendarAccounts(persisted, calendarAccounts);
        }),
      );
      return {
        settings: yield* this.snapshot(),
        ...(unknownAccount ? { reason: "That calendar account is not connected." } : undefined),
      };
    });
  }

  readCalendarAccounts(): Effect.Effect<readonly CalendarAccountCredential[], FileFailure, Files> {
    return Effect.gen(this, function* () {
      if (this.#resolvedCalendarAccounts) return this.#resolvedCalendarAccounts;
      const persisted = yield* this.#load();
      const accounts: CalendarAccountCredential[] = [];
      for (const account of persisted.calendarAccounts ?? []) {
        try {
          const refreshToken = this.#cipher.decrypt(Buffer.from(account.token, "base64")).trim();
          if (!refreshToken || apiKeyRejection(refreshToken)) continue;
          accounts.push({ id: account.id, refreshToken, selectedCalendarIds: account.calendars });
        } catch {}
      }
      this.#resolvedCalendarAccounts = accounts;
      return accounts;
    });
  }

  resetSettings(
    scope: SettingsResetScope,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return this.#setField((persisted) => {
      const next: PersistedSettings = { ...persisted };
      for (const field of APP_SETTING_FIELDS) {
        const definition = APP_SETTING_SCHEMA[field];
        if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
        if (definition.guard(undefined).valid) delete next[field];
        else Object.assign(next, { [field]: definition.default });
      }
      const changed = (Object.keys(persisted) as (keyof PersistedSettings)[]).some(
        (field) => next[field] !== persisted[field],
      );
      return changed ? next : undefined;
    });
  }

  #writeGrants(
    persisted: PersistedSettings,
    grants: Readonly<Record<string, PersistedGrant>>,
    providerId: CredentialProviderId,
  ): Effect.Effect<void, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const next: PersistedSettings = { ...persisted, version: SETTINGS_FILE_VERSION };
      if (Object.keys(grants).length > 0) next.grants = grants;
      else delete next.grants;
      yield* this.#write(next);
      this.#resolvedGrants.delete(providerId);
      this.#resolved.delete(providerId);
    });
  }

  #decryptGrant(held: PersistedGrant): LinearGrant | undefined {
    try {
      const tokens = JSON.parse(this.#cipher.decrypt(Buffer.from(held.tokenCipher, "base64")));
      if (!isRecord(tokens)) return undefined;
      const { accessToken, refreshToken } = tokens as WireRecord;
      if (!isWireString(accessToken) || !accessToken) return undefined;
      return {
        accessToken,
        ...(isWireString(refreshToken) && refreshToken ? { refreshToken } : undefined),
        expiresAt: held.expiresAt,
      };
    } catch {
      return undefined;
    }
  }

  #writeCalendarAccounts(
    persisted: PersistedSettings,
    calendarAccounts: readonly PersistedCalendarAccount[],
  ): Effect.Effect<void, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const next: PersistedSettings = { ...persisted, version: SETTINGS_FILE_VERSION };
      if (calendarAccounts.length > 0) next.calendarAccounts = calendarAccounts;
      else delete next.calendarAccounts;
      yield* this.#write(next);
      this.#resolvedCalendarAccounts = undefined;
    });
  }

  #setField(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
  ): Effect.Effect<SettingsUpdateResult, FileFailure, Files> {
    return Effect.gen(this, function* () {
      yield* this.#serialize(
        Effect.gen(this, function* () {
          const persisted = yield* this.#load();
          const mutated = mutate(persisted);
          if (!mutated) return;
          yield* this.#write({ ...mutated, version: SETTINGS_FILE_VERSION });
        }),
      );
      return { settings: yield* this.snapshot() };
    });
  }

  #serialize<A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, Files | R> {
    return this.#mutationLock.withPermits(1)(operation);
  }

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

  #resolveApiKey(provider: CredentialProvider): Effect.Effect<ResolvedApiKey, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const cached = this.#resolved.get(provider.id);
      if (cached) return cached;
      if (provider.connection === CREDENTIAL_CONNECTION.CONSENT) {
        const held = (yield* this.#load()).grants?.[provider.id];
        const resolved: ResolvedApiKey = {
          source: held ? CREDENTIAL_SOURCE.ENCRYPTED_FILE : CREDENTIAL_SOURCE.NONE,
        };
        this.#resolved.set(provider.id, resolved);
        return resolved;
      }
      const stored = yield* this.#storedApiKey(provider);
      const fromEnvironment = stored ? undefined : environmentApiKey(provider, this.#environment);
      const resolved: ResolvedApiKey = stored
        ? { apiKey: stored, source: CREDENTIAL_SOURCE.ENCRYPTED_FILE }
        : fromEnvironment
          ? { apiKey: fromEnvironment, source: CREDENTIAL_SOURCE.ENVIRONMENT }
          : { source: CREDENTIAL_SOURCE.NONE };
      this.#resolved.set(provider.id, resolved);
      return resolved;
    });
  }

  #storedApiKey(
    provider: CredentialProvider,
  ): Effect.Effect<string | undefined, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const ciphertext = (yield* this.#load()).apiKeys[provider.id];
      if (!ciphertext) return undefined;
      try {
        const apiKey = this.#cipher.decrypt(Buffer.from(ciphertext, "base64")).trim();
        return apiKey && !apiKeyRejection(apiKey, provider.keyFormat) ? apiKey : undefined;
      } catch {
        return undefined;
      }
    });
  }

  #load(): Effect.Effect<PersistedSettings, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const cached = yield* Ref.get(this.#persistedCache);
      if (cached) return cached;
      const persisted = yield* this.#readPersisted();
      yield* Ref.set(this.#persistedCache, persisted);
      return persisted;
    });
  }

  #readPersisted(): Effect.Effect<PersistedSettings, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const files = yield* Files;
      const settingsPath = path.join(this.#directory(), SETTINGS_FILE_NAME);
      const source = yield* files.readTextFileUtf8(settingsPath);
      let persisted: PersistedSettings = {
        version: SETTINGS_FILE_VERSION,
        apiKeys: {},
        ...readStoredSettings({}),
      };
      if (source) {
        try {
          persisted = parsePersistedSettings(source, this.#providers);
        } catch {}
      }
      return persisted;
    });
  }

  #write(persisted: PersistedSettings): Effect.Effect<void, FileFailure, Files> {
    return Effect.gen(this, function* () {
      const files = yield* Files;
      const directory = this.#directory();
      const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
      const temporaryPath = path.join(directory, SETTINGS_TEMPORARY_FILE_NAME);
      yield* files.mkdir(directory, { recursive: true });
      yield* files.writeFile(temporaryPath, JSON.stringify(persisted, undefined, 2) + "\n", {
        mode: SETTINGS_FILE_MODE,
      });
      yield* files.chmod(temporaryPath, SETTINGS_FILE_MODE);
      yield* files.rename(temporaryPath, settingsPath);
      yield* Ref.set(this.#persistedCache, persisted);
    });
  }
}
