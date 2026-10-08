import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  isAccountProvider,
} from "@sidecar/credentials/snapshot";
import { LIVE_DEFAULTS } from "@sidecar/live";
import { PROVIDER_ID } from "@sidecar/session";
import type { AppSettings, SettingsResetScope, SettingsUpdateResult } from "@sidecar/settings/wire";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireNumber,
  isWireString,
  wireRecord as readWireRecord,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { declareReader } from "@sidecar/wire/effect";
import { Data, Effect, Result, Schema, Semaphore, type Types } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import type { SettingsEnvironmentOverrides } from "./effect/settings-overrides.js";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";

export type { StoredAccount } from "@sidecar/credentials";

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
  type StoredAppSettings,
} from "@sidecar/settings";

const SETTINGS_FILE_VERSION = 2;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  ACCOUNT_PREFERENCES_SYNC: "accountPreferencesSync",
  VERSION: "version",
} as const;

/** Where an earlier build kept its provider keys, ciphertext by provider id. */
const STORED_API_KEYS_FIELD = "apiKeys";

/**
 * The providers whose stored key an earlier build could still use: the set
 * its credential provider list last named. A ciphertext under any other id
 * (the developer's own OpenAI key, until LUKE-205) is dropped by
 * `retireStoredApiKeys`; these are carried.
 */
const KEPT_API_KEY_PROVIDERS: ReadonlySet<string> = new Set([PROVIDER_ID.CONDUCTOR]);

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
   * Whether this run will use the account it holds. A fixture or evidence run
   * will not, and the panel has to mark what would actually happen rather
   * than what is stored — so `voiceAvailable` is false there however good the
   * account is. Only the app knows which kind of run this is. True by default.
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
  /** The path service the settings file's own path is joined through, resolved by the same composer. */
  path: Path.Path;
}

/* ----- The settings file's record ----- */

/**
 * The settings file is read as a `Schema` whose every field is a total
 * reader: what a field cannot read is that field's fallback, never a refused
 * file, because a file this build half-understands still carries the
 * account an older or newer build wrote, and the next write must not lose it.
 * The one refusal is a file whose top level is not an object, which
 * `parsePersistedSettingsEither` below answers as `SettingsParseRefusal`. No
 * model is ever shown this record, so the node a reader declares is a
 * placeholder and nothing draws it.
 */
const SETTINGS_FIELD_NODE = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

/** A field read by a total reader, over the raw value the file holds under its key. */
function settingsField<Value>(read: (value: UnparsedWireValue) => Value) {
  return declareReader<Value>((value) => ({ ok: true, value: read(value) }), SETTINGS_FIELD_NODE);
}

/** A key the file does not hold is read as if it held nothing, so the reader answers its fallback. */
const ABSENT = Effect.succeed(undefined);

/** Account tokens encrypted together; only display identity stays plaintext. */
interface PersistedAccount {
  tokenCipher: string;
  /** Absent where the sign-in's identity carried none; see `AccountIdentity`. */
  id?: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  provider: AccountProvider;
}

function storedAccount(value: UnparsedWireValue): PersistedAccount | undefined {
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

/**
 * The stored settings, each read through its own guard, so an entry the
 * build's own table does not list is dropped: a file written by another
 * build may pair an agent with a model this one does not know, and honouring
 * it would send a value no documented endpoint takes. A guard answers a value
 * on both branches, the default where it refuses, so every field decodes.
 */
function storedSettingCodecs<
  Table extends {
    readonly [field: string]: { readonly guard: (value: UnparsedWireValue) => { value: unknown } };
  },
>(
  table: Table,
): {
  readonly [Field in keyof Table]: Schema.Codec<
    ReturnType<Table[Field]["guard"]>["value"],
    UnparsedWireValue
  >;
} {
  const codecs: { readonly [field: string]: Schema.Top } = Object.fromEntries(
    Object.entries(table).map(([field, setting]) => [
      field,
      settingsField((value) => setting.guard(value).value).pipe(Schema.withDecodingDefault(ABSENT)),
    ]),
  );
  // SAFETY: each key's codec reads through that key's own guard, so the pairing the
  // mapped type states is the one built here; `Object.fromEntries` alone cannot say so.
  return codecs as {
    readonly [Field in keyof Table]: Schema.Codec<
      ReturnType<Table[Field]["guard"]>["value"],
      UnparsedWireValue
    >;
  };
}

const storedSettingFields = storedSettingCodecs(APP_SETTING_SCHEMA);

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

/**
 * Last account-preference baseline used for hosted sync. It is local
 * bookkeeping only: when the hosted write fails and the app restarts, this
 * is what lets the next hosted read keep local edits made since the last
 * successful baseline instead of treating the current local file as already
 * synced.
 */
interface PersistedAccountPreferencesSync {
  accountEmail: string;
  preferences: AccountPreferences;
}

function storedAccountPreferencesSync(
  value: UnparsedWireValue,
): PersistedAccountPreferencesSync | undefined {
  const held = readWireRecord(value);
  if (!held || !isWireString(held.accountEmail) || !held.accountEmail) return undefined;
  const storedPreferences = readWireRecord(held.preferences);
  if (!storedPreferences) return undefined;
  const preferences = accountPreferencesFromStored(storedPreferences);
  if (preferences === undefined) return undefined;
  return { accountEmail: held.accountEmail, preferences };
}

/**
 * The settings file's record: the version and the keys every file carries,
 * the sections a file holds only while something stands in them, and every
 * stored setting. Read by `parsePersistedSettingsEither` and written by
 * `#write`; a key beside these is carried through every write as the file
 * held it (`carriedSettingsFields`). `settledPersistedSettings` below is the
 * rule between two fields no one field's reader can hold.
 */
const PersistedSettingsSchema = Schema.Struct({
  [SETTINGS_FIELD.VERSION]: settingsField((value) =>
    isWireNumber(value) ? value : SETTINGS_FILE_VERSION,
  ).pipe(Schema.withDecodingDefault(ABSENT)),
  [SETTINGS_FIELD.ACCOUNT]: Schema.optionalKey(settingsField(storedAccount)),
  [SETTINGS_FIELD.ACCOUNT_PREFERENCES_SYNC]: Schema.optionalKey(
    settingsField(storedAccountPreferencesSync),
  ),
  ...storedSettingFields,
});

/** Mutable, because the store edits a copy section by section before it writes. */
export type PersistedSettings = Types.Mutable<typeof PersistedSettingsSchema.Type>;

const decodePersistedSettings = Schema.decodeUnknownSync(PersistedSettingsSchema);
const encodePersistedSettings = Schema.encodeSync(PersistedSettingsSchema);

/** The two OAuth tokens one Keychain-backed ciphertext holds, as `setAccount` sealed them. */
const AccountTokensSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
});

type AccountTokens = typeof AccountTokensSchema.Type;

const decodeAccountTokens = Schema.decodeUnknownResult(Schema.fromJsonString(AccountTokensSchema));

/**
 * The record as the store keeps it: a section its reader could not read is
 * not a key holding `undefined` but no key at all, and a sync baseline is
 * kept only for the account signed in, since one left by another account
 * would let that account's edits stand in for this one's.
 */
function settledPersistedSettings(persisted: PersistedSettings): PersistedSettings {
  const { account, accountPreferencesSync, ...settings } = persisted;
  return {
    ...settings,
    ...(account ? { account } : undefined),
    ...(account && accountPreferencesSync?.accountEmail === account.email
      ? { accountPreferencesSync }
      : undefined),
  };
}

const DECLARED_SETTINGS_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(PersistedSettingsSchema.fields),
);

/**
 * Every top-level key of the file this build's record does not declare, as
 * the file holds it. Another build's keys, credentials, and choices are
 * written back unchanged and never decrypted, so a build that reads less
 * than an earlier one does not erase what the earlier one stored, and that
 * build finds it again once it is back.
 */
function carriedSettingsFields(source: string): WireRecord {
  const parsed = Result.try(() => JSON.parse(source));
  if (Result.isFailure(parsed) || !isRecord(parsed.success)) return {};
  return Object.fromEntries(
    Object.entries(parsed.success).filter(([field]) => !DECLARED_SETTINGS_FIELDS.has(field)),
  );
}

/** Every field at its fallback: the record an empty file decodes to. */
function defaultPersistedSettings(): PersistedSettings {
  return settledPersistedSettings(decodePersistedSettings({}));
}

/** A stored file this build cannot read as settings; `reason` is the legacy message. */
export class SettingsParseRefusal extends Data.TaggedError("SettingsParseRefusal")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

const NOT_AN_OBJECT = "Settings file is not an object";

const decodePersistedSettingsFile = Schema.decodeUnknownResult(
  Schema.fromJsonString(PersistedSettingsSchema),
);

/**
 * Why a file was refused, in the legacy words: text that is JSON but not an
 * object is the one refusal the record's own readers leave standing, since
 * each field reads to its fallback; anything else is text that is not JSON,
 * named as the parser names it.
 */
function refusalReason(source: string, error: Schema.SchemaError): string {
  const parsed = Result.try(() => JSON.parse(source));
  return Result.isSuccess(parsed) && !isRecord(parsed.success) ? NOT_AN_OBJECT : error.message;
}

/**
 * The settings file's shape, decoded once through `PersistedSettingsSchema`.
 * A malformed file answers a refusal rather than throwing; every caller today
 * still folds that refusal into `defaultPersistedSettings()`, so the
 * fallback is a caller's decision and not this function's.
 */
export function parsePersistedSettingsEither(
  source: string,
): Result.Result<PersistedSettings, SettingsParseRefusal> {
  return decodePersistedSettingsFile(source).pipe(
    Result.map(settledPersistedSettings),
    Result.mapError((error) => new SettingsParseRefusal({ reason: refusalReason(source, error) })),
  );
}

/**
 * Reads and writes the small set of user-owned settings Luke needs. The
 * stored account's tokens stay in the main process: no accessor returns them
 * to a renderer.
 */
export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher;
  readonly #overrides: SettingsEnvironmentOverrides;
  readonly #credentialsUsable: boolean;
  readonly #fileSystem: FileSystem.FileSystem;
  readonly #path: Path.Path;
  /**
   * The settings as last read or written. The gate beside it is what makes a
   * read shared rather than repeated: a second reader waits for the first
   * read to land and then finds it here, and a read that failed leaves
   * nothing behind, so the next reader tries the file again.
   */
  #held: PersistedSettings | undefined;
  readonly #reads = Semaphore.makeUnsafe(1);
  /** The file's undeclared keys as last read, written back beside every write. */
  #carried: WireRecord = {};
  /**
   * Runs one settings change at a time. Serializing only the file write is not
   * enough: two changes started together would both read the same file before
   * either wrote, so the later write would drop the other's change.
   */
  readonly #writes = Semaphore.makeUnsafe(1);

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
    return Effect.gen({ self: this }, function* () {
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
    return Effect.gen({ self: this }, function* () {
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
    return Effect.gen({ self: this }, function* () {
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

  /** Whether the cipher can protect a secret, asked at most once a run; unasked until then. */
  #secretStorageAvailable: boolean | undefined;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#overrides = options.overrides;
    this.#credentialsUsable = options.credentialsUsable ?? true;
    this.#fileSystem = options.fileSystem;
    this.#path = options.path;
  }

  snapshot(): Effect.Effect<AppSettings, PlatformError> {
    return Effect.gen({ self: this }, function* () {
      const persisted = yield* this.#load();
      const voiceAvailable = yield* this.#voiceAvailable();
      return {
        stored: {
          ...storedSettingsFromPersisted(persisted),
          // Resolved the way the session source resolves it, so the panel marks
          // what would actually be heard while the persisted file remains optional.
          voice: persisted.voice ?? this.#overrides.voice ?? LIVE_DEFAULTS.VOICE,
        },
        status: {
          // Whether a spoken turn could actually be opened: an account signed in,
          // and this run will use it. Resolved here rather than left to the panel
          // because it is the same question the voice is answered by — what
          // would actually happen — and it travels with every settings reply,
          // so signing in is what turns voice on and signing out is what turns
          // it off.
          voiceAvailable,
        },
      };
    });
  }

  /** Returns account credentials only to the main process. */
  readAccount(): Effect.Effect<StoredAccount | undefined, PlatformError> {
    return Effect.map(this.#load(), ({ account }) => {
      if (!account) return undefined;
      const tokens = this.#decryptTokens(account.tokenCipher);
      if (tokens === undefined) return undefined;
      return {
        ...tokens,
        ...(account.id ? { id: account.id } : undefined),
        email: account.email,
        ...(account.name ? { name: account.name } : undefined),
        ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
        provider: account.provider,
      };
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
    return Effect.gen({ self: this }, function* () {
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

  /**
   * Whether a spoken turn has anything to run on: a signed-in account, in a
   * run that may use credentials. The assembler decides the same way from
   * the same reads, so the panel's snapshot and the host's own build never
   * answer the question differently.
   */
  #voiceAvailable(): Effect.Effect<boolean, PlatformError> {
    return Effect.map(
      this.readAccount(),
      (account) => this.#credentialsUsable && account !== undefined,
    );
  }

  /**
   * Drops the ciphertext of every provider an earlier build no longer named,
   * so a key nothing would read does not stay on disk, and carries the rest.
   * A ciphertext is never decrypted to be dropped.
   */
  retireStoredApiKeys(): Effect.Effect<void, PlatformError> {
    return this.#mutate((persisted) => {
      const apiKeys = this.#carried[STORED_API_KEYS_FIELD];
      if (!isRecord(apiKeys)) return undefined;
      const kept = Object.fromEntries(
        Object.entries(apiKeys).filter(([providerId]) => KEPT_API_KEY_PROVIDERS.has(providerId)),
      );
      if (Object.keys(kept).length === Object.keys(apiKeys).length) return undefined;
      this.#carried = { ...this.#carried, [STORED_API_KEYS_FIELD]: kept };
      return { ...persisted };
    });
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
    return Effect.gen({ self: this }, function* () {
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
   * The one settings write: serialize, load, mutate, stamp, write, and cache.
   * A mutator answering nothing means the stored value is already the one
   * asked for, so nothing is written. It runs exactly once per call, so it
   * may record what it decided for its caller to read afterwards.
   */
  #mutate(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
  ): Effect.Effect<void, PlatformError> {
    return this.#writes.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const persisted = yield* this.#load();
        const mutated = mutate(persisted);
        if (!mutated) return;
        const next: PersistedSettings = { ...mutated, version: SETTINGS_FILE_VERSION };
        yield* this.#write(next);
        this.#held = next;
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
    if (this.#secretStorageAvailable === undefined) {
      let available = false;
      try {
        available = this.#cipher.isAvailable();
      } catch {
        available = false;
      }
      this.#secretStorageAvailable = available;
    }
    return this.#secretStorageAvailable;
  }

  /**
   * One stored ciphertext's token pair, or nothing. Unrecoverable is an
   * answer: a value encrypted under a different OS account, or against a
   * rotated Keychain entry, cannot be read back, and the row it draws is what
   * says to connect again.
   */
  #decryptTokens(cipherText: string): AccountTokens | undefined {
    const plain = Result.try(() => this.#cipher.decrypt(Buffer.from(cipherText, "base64")));
    if (Result.isFailure(plain)) return undefined;
    return Result.getOrUndefined(decodeAccountTokens(plain.success));
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
    return Effect.map(this.#onFileSystem(readSettingsFileText(this.#directory())), (source) => {
      this.#carried = {};
      if (source === undefined) return defaultPersistedSettings();
      // A corrupt settings file is replaced by the next write rather than
      // failing app start, so a refusal here falls back to defaults exactly
      // as an absent file does, and carries nothing.
      const parsed = parsePersistedSettingsEither(source);
      if (Result.isFailure(parsed)) return defaultPersistedSettings();
      this.#carried = carriedSettingsFields(source);
      return parsed.success;
    });
  }

  /**
   * Only ever run inside `#mutate`'s gate, so writes cannot interleave. The
   * carried keys never share a name with a declared one, so nothing this
   * build writes is overridden by them.
   */
  #write(persisted: PersistedSettings): Effect.Effect<void, PlatformError> {
    const written = { ...encodePersistedSettings(persisted), ...this.#carried };
    return this.#onFileSystem(
      writeSettingsFileAtomic(this.#directory(), `${JSON.stringify(written, undefined, 2)}\n`),
    );
  }

  /**
   * The file system this store was handed, provided to its own reads and
   * writes, so a caller of any method above is left nothing to provide.
   */
  #onFileSystem<A>(
    effect: Effect.Effect<A, PlatformError, FileSystem.FileSystem | Path.Path>,
  ): Effect.Effect<A, PlatformError> {
    return effect.pipe(
      Effect.provideService(FileSystem.FileSystem, this.#fileSystem),
      Effect.provideService(Path.Path, this.#path),
    );
  }
}
