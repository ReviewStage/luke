import {
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  isAccountProvider,
} from "@repo/credentials/snapshot";
import type { AppSettings, SettingsResetScope, SettingsUpdateResult } from "@repo/settings/wire";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireNumber,
  isWireString,
  wireRecord as readWireRecord,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@repo/wire";
import { declareReader } from "@repo/wire/effect";
import { Data, Effect, Result, Schema, Semaphore, type Types } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";

export type { StoredAccount } from "@repo/credentials";

import type { StoredAccount } from "@repo/credentials";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  accountPreferencesFromStored,
  type ExperimentChoices,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
  type StoredAppSettings,
} from "@repo/settings";

const SETTINGS_FILE_VERSION = 2;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  ACCOUNT_PREFERENCES_SYNC: "accountPreferencesSync",
  EXPERIMENTS: "experiments",
  PRODUCT_EVENT_DAYS: "productEventDays",
  VERSION: "version",
} as const;

const STORED_API_KEYS_FIELD = "apiKeys";

export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Uint8Array;
  decrypt(cipherText: Uint8Array): string;
}

export interface SettingsStoreOptions {
  directory: () => string;
  cipher: SecretCipher | undefined;
  packaged?: boolean;
  sessionAccountEmail?: () => Effect.Effect<string | undefined>;
  fileSystem: FileSystem.FileSystem;
  path: Path.Path;
  writer?: string;
}

const SETTINGS_FIELD_NODE = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

function settingsField<Value>(read: (value: UnparsedWireValue) => Value) {
  return declareReader<Value>((value) => ({ ok: true, value: read(value) }), SETTINGS_FIELD_NODE);
}

const ABSENT = Effect.succeed(undefined);

interface PersistedAccount {
  tokenCipher: string;
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
  return entries as StoredAppSettings;
}

function sameAccountPreferenceValue(current: UnparsedWireValue, next: UnparsedWireValue): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

function accountPreferenceWithLocalChanges(
  remote: UnparsedWireValue,
  current: UnparsedWireValue,
  expected: UnparsedWireValue,
): UnparsedWireValue {
  return sameAccountPreferenceValue(current, expected) ? remote : current;
}

function accountPreferencesWithLocalChanges(
  remote: AccountPreferences,
  current: AccountPreferences,
  expected: AccountPreferences,
): AccountPreferences {
  const settings: Record<string, WireValue> = {};
  for (const field of ACCOUNT_PREFERENCE_FIELDS) {
    const value = accountPreferenceWithLocalChanges(
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
    const value = persisted[field] as UnparsedWireValue;
    if (value !== undefined) settings[field] = value;
  }
  return accountPreferencesFromStored(settings) ?? {};
}

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

interface PersistedExperiments {
  accountEmail: string;
  choices: ExperimentChoices;
}

function storedExperiments(value: UnparsedWireValue): PersistedExperiments | undefined {
  const held = readWireRecord(value);
  if (!held || !isWireString(held.accountEmail) || !held.accountEmail) return undefined;
  const choices = experimentChoicesFrom(held.choices);
  return choices === undefined ? undefined : { accountEmail: held.accountEmail, choices };
}

export interface KeptProductEventDay {
  readonly name: string;
  readonly discriminator: string;
  readonly account: string;
  readonly day: string;
}

type ProductEventDays = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
>;

function productEventDayEntries(days: ProductEventDays | undefined): KeptProductEventDay[] {
  const entries: KeptProductEventDay[] = [];
  for (const [name, byDiscriminator] of Object.entries(days ?? {})) {
    for (const [discriminator, byAccount] of Object.entries(byDiscriminator)) {
      for (const [account, day] of Object.entries(byAccount)) {
        entries.push({ name, discriminator, account, day });
      }
    }
  }
  return entries;
}

function productEventDaysFrom(entries: readonly KeptProductEventDay[]): ProductEventDays {
  const byName = new Map<string, Map<string, Map<string, string>>>();
  for (const { name, discriminator, account, day } of entries) {
    const byDiscriminator = byName.get(name) ?? new Map<string, Map<string, string>>();
    const byAccount = byDiscriminator.get(discriminator) ?? new Map<string, string>();
    byAccount.set(account, day);
    byDiscriminator.set(discriminator, byAccount);
    byName.set(name, byDiscriminator);
  }
  return Object.fromEntries(
    [...byName].map(([name, byDiscriminator]) => [
      name,
      Object.fromEntries(
        [...byDiscriminator].map(([discriminator, byAccount]) => [
          discriminator,
          Object.fromEntries(byAccount),
        ]),
      ),
    ]),
  );
}

function storedProductEventDays(value: UnparsedWireValue): ProductEventDays | undefined {
  const kept: KeptProductEventDay[] = [];
  for (const [name, byDiscriminator] of Object.entries(readWireRecord(value) ?? {})) {
    for (const [discriminator, byAccount] of Object.entries(
      readWireRecord(byDiscriminator) ?? {},
    )) {
      for (const [account, day] of Object.entries(readWireRecord(byAccount) ?? {})) {
        if (isWireString(day) && day) kept.push({ name, discriminator, account, day });
      }
    }
  }
  return kept.length === 0 ? undefined : productEventDaysFrom(kept);
}

const PersistedSettingsSchema = Schema.Struct({
  [SETTINGS_FIELD.VERSION]: settingsField((value) =>
    isWireNumber(value) ? value : SETTINGS_FILE_VERSION,
  ).pipe(Schema.withDecodingDefault(ABSENT)),
  [SETTINGS_FIELD.ACCOUNT]: Schema.optionalKey(settingsField(storedAccount)),
  [SETTINGS_FIELD.ACCOUNT_PREFERENCES_SYNC]: Schema.optionalKey(
    settingsField(storedAccountPreferencesSync),
  ),
  [SETTINGS_FIELD.EXPERIMENTS]: Schema.optionalKey(settingsField(storedExperiments)),
  [SETTINGS_FIELD.PRODUCT_EVENT_DAYS]: Schema.optionalKey(settingsField(storedProductEventDays)),
  ...storedSettingFields,
});

export type PersistedSettings = Types.Mutable<typeof PersistedSettingsSchema.Type>;

const decodePersistedSettings = Schema.decodeUnknownSync(PersistedSettingsSchema);
const encodePersistedSettings = Schema.encodeSync(PersistedSettingsSchema);

const AccountTokensSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  sessionToken: Schema.optionalKey(Schema.String),
});

type AccountTokens = typeof AccountTokensSchema.Type;

const decodeAccountTokens = Schema.decodeUnknownResult(Schema.fromJsonString(AccountTokensSchema));

function settledPersistedSettings(
  persisted: PersistedSettings,
  keepsOwnAccount = true,
): PersistedSettings {
  const { account, accountPreferencesSync, experiments, ...settings } = persisted;
  const keptFor = (section: { readonly accountEmail: string } | undefined) =>
    section !== undefined && (!keepsOwnAccount || section.accountEmail === account?.email);
  return {
    ...settings,
    ...(account ? { account } : undefined),
    ...(keptFor(accountPreferencesSync) ? { accountPreferencesSync } : undefined),
    ...(keptFor(experiments) ? { experiments } : undefined),
  };
}

function experimentsOf(
  persisted: PersistedSettings,
  accountEmail: string | undefined,
): ExperimentChoices {
  const { experiments } = persisted;
  return accountEmail !== undefined && experiments?.accountEmail === accountEmail
    ? experiments.choices
    : NO_EXPERIMENTS;
}

type AccountEmailOf = (persisted: PersistedSettings) => string | undefined;

const STORED_ACCOUNT_EMAIL: AccountEmailOf = (persisted) => persisted.account?.email;

const DECLARED_SETTINGS_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(PersistedSettingsSchema.fields),
);

function carriedSettingsFields(source: string): WireRecord {
  const parsed = Result.try(() => JSON.parse(source));
  if (Result.isFailure(parsed) || !isRecord(parsed.success)) return {};
  return Object.fromEntries(
    Object.entries(parsed.success).filter(([field]) => !DECLARED_SETTINGS_FIELDS.has(field)),
  );
}

function defaultPersistedSettings(): PersistedSettings {
  return settledPersistedSettings(decodePersistedSettings({}));
}

export class EncryptedStorageUnavailable extends Data.TaggedError("EncryptedStorageUnavailable") {
  override get message(): string {
    return "Encrypted credential storage is unavailable on this system.";
  }
}

class SettingsParseRefusal extends Data.TaggedError("SettingsParseRefusal")<{
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

function refusalReason(source: string, error: Schema.SchemaError): string {
  const parsed = Result.try(() => JSON.parse(source));
  return Result.isSuccess(parsed) && !isRecord(parsed.success) ? NOT_AN_OBJECT : error.message;
}

function parsePersistedSettingsEither(
  source: string,
  keepsOwnAccount: boolean,
): Result.Result<PersistedSettings, SettingsParseRefusal> {
  return decodePersistedSettingsFile(source).pipe(
    Result.map((persisted) => settledPersistedSettings(persisted, keepsOwnAccount)),
    Result.mapError((error) => new SettingsParseRefusal({ reason: refusalReason(source, error) })),
  );
}

export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher | undefined;
  readonly #packaged: boolean;
  readonly #sessionAccountEmail: (() => Effect.Effect<string | undefined>) | undefined;
  readonly #fileSystem: FileSystem.FileSystem;
  readonly #path: Path.Path;
  readonly #writer: string | undefined;
  #held: PersistedSettings | undefined;
  readonly #reads = Semaphore.makeUnsafe(1);
  #carried: WireRecord = {};
  readonly #writes = Semaphore.makeUnsafe(1);
  #accountRead: string | undefined;

  get<Field extends AppSettingField>(
    field: Field,
  ): Effect.Effect<AppSettingValue<Field>, PlatformError> {
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
      const signedIn = yield* this.#accountEmailOf();
      yield* this.#mutate((persisted) => {
        if (expected && signedIn(persisted) !== expected.accountEmail) return undefined;
        const nextSettings = expected
          ? accountPreferencesWithLocalChanges(
              settings,
              accountPreferencesFromPersisted(persisted),
              expected.preferences,
            )
          : settings;
        const next: PersistedSettings = { ...persisted };
        for (const field of ACCOUNT_PREFERENCE_FIELDS) {
          const value = nextSettings[field] as UnparsedWireValue;
          if (!sameAccountPreferenceValue(persisted[field] as UnparsedWireValue, value)) {
            changed.push(field);
          }
          Object.assign(next, { [field]: value });
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
      const signedIn = yield* this.#accountEmailOf();
      yield* this.#mutate((persisted) => {
        if (signedIn(persisted) !== accountEmail) return undefined;
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

  cacheExperiments(
    accountEmail: string,
    choices: ExperimentChoices,
  ): Effect.Effect<boolean, PlatformError> {
    return Effect.gen({ self: this }, function* () {
      let changed = false;
      const signedIn = yield* this.#accountEmailOf();
      yield* this.#mutate((persisted) => {
        if (signedIn(persisted) !== accountEmail) return undefined;
        if (JSON.stringify(experimentsOf(persisted, accountEmail)) === JSON.stringify(choices)) {
          return undefined;
        }
        changed = true;
        return { ...persisted, experiments: { accountEmail, choices } };
      });
      return changed;
    });
  }

  forgetAccountRead(): void {
    this.#accountRead = undefined;
  }

  markAccountRead(accountEmail: string): Effect.Effect<boolean> {
    return Effect.sync(() => {
      if (this.#accountRead === accountEmail) return false;
      this.#accountRead = accountEmail;
      return true;
    });
  }

  lastProductEventDay(
    name: string,
    discriminator: string,
    account: string,
  ): Effect.Effect<string | undefined, PlatformError> {
    return Effect.map(
      this.#load(),
      (persisted) =>
        productEventDayEntries(persisted.productEventDays).find(
          (entry) =>
            entry.name === name &&
            entry.discriminator === discriminator &&
            entry.account === account,
        )?.day,
    );
  }

  keepProductEventDay(kept: KeptProductEventDay): Effect.Effect<void, PlatformError> {
    return this.#mutate((persisted) => {
      const entries = productEventDayEntries(persisted.productEventDays);
      const held = entries.find(
        (entry) =>
          entry.name === kept.name &&
          entry.discriminator === kept.discriminator &&
          entry.account === kept.account,
      );
      if (held?.day === kept.day) return undefined;
      const others = entries.filter((entry) => entry !== held && entry.day >= kept.day);
      return { ...persisted, productEventDays: productEventDaysFrom([...others, kept]) };
    });
  }

  #secretStorageAvailable: boolean | undefined;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#packaged = options.packaged ?? true;
    this.#sessionAccountEmail = options.sessionAccountEmail;
    this.#fileSystem = options.fileSystem;
    this.#path = options.path;
    this.#writer = options.writer;
  }

  snapshot(): Effect.Effect<AppSettings, PlatformError> {
    return Effect.gen({ self: this }, function* () {
      const persisted = yield* this.#load();
      const accountEmail = (yield* this.#accountEmailOf())(persisted);
      return {
        stored: {
          ...storedSettingsFromPersisted(persisted),
          usageData:
            persisted.usageData ??
            (this.#packaged
              ? APP_SETTING_SCHEMA.usageData.default
              : APP_SETTING_SCHEMA.usageData.unpackagedDefault),
        },
        experiments: experimentsOf(persisted, accountEmail),
        accountRead: accountEmail !== undefined && this.#accountRead === accountEmail,
      };
    });
  }

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
            ...(account.id ? { id: account.id } : undefined),
            email: account.email,
            ...(account.name ? { name: account.name } : undefined),
            ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : undefined),
            provider: account.provider,
          }
        : { status: ACCOUNT_STATUS.SIGNED_OUT },
    );
  }

  setAccount(
    account: StoredAccount,
  ): Effect.Effect<AccountSnapshot, PlatformError | EncryptedStorageUnavailable> {
    return Effect.gen({ self: this }, function* () {
      const cipher = this.#cipher;
      if (!cipher || !this.#secretStorageUsable()) {
        return yield* new EncryptedStorageUnavailable();
      }
      yield* this.#mutate((persisted) => {
        const tokenCipher = Base64.encode(
          cipher.encrypt(
            JSON.stringify({
              accessToken: account.accessToken,
              refreshToken: account.refreshToken,
              ...(account.sessionToken ? { sessionToken: account.sessionToken } : undefined),
            }),
          ),
        );
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
          for (const field of ACCOUNT_PREFERENCE_FIELDS) next[field] = undefined;
          delete next.accountPreferencesSync;
          delete next.experiments;
        }
        return next;
      });
      return yield* this.accountSnapshot();
    });
  }

  clearAccount(): Effect.Effect<AccountSnapshot, PlatformError> {
    const keepsOwnAccount = this.#cipher !== undefined;
    return Effect.as(
      this.#mutate((persisted) => {
        this.forgetAccountRead();
        if (keepsOwnAccount && !persisted.account) return undefined;
        const { account: _account, ...withoutAccount } = persisted;
        const next: PersistedSettings = { ...withoutAccount };
        for (const field of ACCOUNT_PREFERENCE_FIELDS) next[field] = undefined;
        delete next.accountPreferencesSync;
        delete next.experiments;
        return next;
      }),
      { status: ACCOUNT_STATUS.SIGNED_OUT },
    );
  }

  settleSessionAccount(accountEmail: string): Effect.Effect<void, PlatformError> {
    if (this.#cipher !== undefined) return Effect.void;
    return this.#mutate((persisted) => {
      const keptFor =
        persisted.accountPreferencesSync?.accountEmail ?? persisted.experiments?.accountEmail;
      if (keptFor === undefined || keptFor === accountEmail) return undefined;
      const next: PersistedSettings = { ...persisted };
      for (const field of ACCOUNT_PREFERENCE_FIELDS) next[field] = undefined;
      delete next.accountPreferencesSync;
      delete next.experiments;
      return next;
    });
  }

  retireStoredApiKeys(): Effect.Effect<void, PlatformError> {
    return this.#mutate((persisted) => {
      if (!(STORED_API_KEYS_FIELD in this.#carried)) return undefined;
      const { [STORED_API_KEYS_FIELD]: _retired, ...carried } = this.#carried;
      this.#carried = carried;
      return { ...persisted };
    });
  }

  resetSettings(
    scope: SettingsResetScope,
    kept: readonly AppSettingField[] = [],
  ): Effect.Effect<SettingsUpdateResult, PlatformError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#mutate((persisted) => {
        const next: PersistedSettings = { ...persisted };
        for (const field of APP_SETTING_FIELDS) {
          const definition = APP_SETTING_SCHEMA[field];
          if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
          if (kept.includes(field)) continue;
          if (definition.guard(undefined).valid) delete next[field];
          else Object.assign(next, { [field]: definition.default });
        }
        const changed = APP_SETTING_FIELDS.some((field) => next[field] !== persisted[field]);
        return changed ? next : undefined;
      });
      return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* this.snapshot() };
    });
  }

  #accountEmailOf(): Effect.Effect<AccountEmailOf> {
    const read = this.#sessionAccountEmail;
    if (this.#cipher !== undefined || read === undefined)
      return Effect.succeed(STORED_ACCOUNT_EMAIL);
    return Effect.map(read(), (email) => () => email);
  }

  #mutate(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
  ): Effect.Effect<void, PlatformError> {
    return this.#writes.withPermits(1)(
      Effect.gen({ self: this }, function* () {
        const persisted = yield* this.#rereadForWrite();
        const mutated = mutate(persisted);
        if (!mutated) return;
        const next: PersistedSettings = { ...mutated, version: SETTINGS_FILE_VERSION };
        yield* this.#write(next);
        this.#held = next;
      }),
    );
  }

  #secretStorageUsable(): boolean {
    if (this.#secretStorageAvailable === undefined) {
      let available = false;
      try {
        available = this.#cipher?.isAvailable() ?? false;
      } catch {
        available = false;
      }
      this.#secretStorageAvailable = available;
    }
    return this.#secretStorageAvailable;
  }

  #decryptTokens(cipherText: string): AccountTokens | undefined {
    const cipher = this.#cipher;
    if (!cipher) return undefined;
    const plain = Result.flatMap(Base64.decode(cipherText), (bytes) =>
      Result.try(() => cipher.decrypt(bytes)),
    );
    if (Result.isFailure(plain)) return undefined;
    return Result.getOrUndefined(decodeAccountTokens(plain.success));
  }

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

  reload(): Effect.Effect<void, PlatformError> {
    return Effect.asVoid(this.#reread());
  }

  #rereadForWrite(): Effect.Effect<PersistedSettings, PlatformError> {
    if (this.#writer !== undefined) return this.#reread();
    return Effect.catch(this.#reread(), (error) => {
      const held = this.#held;
      return held === undefined ? Effect.fail(error) : Effect.succeed(held);
    });
  }

  #reread(): Effect.Effect<PersistedSettings, PlatformError> {
    return this.#reads.withPermits(1)(
      Effect.tap(this.#readPersisted(), (persisted) =>
        Effect.sync(() => {
          this.#held = persisted;
        }),
      ),
    );
  }

  #readPersisted(): Effect.Effect<PersistedSettings, PlatformError> {
    return Effect.map(this.#onFileSystem(readSettingsFileText(this.#directory())), (source) => {
      this.#carried = {};
      if (source === undefined) return defaultPersistedSettings();
      const parsed = parsePersistedSettingsEither(source, this.#cipher !== undefined);
      if (Result.isFailure(parsed)) return defaultPersistedSettings();
      this.#carried = carriedSettingsFields(source);
      return parsed.success;
    });
  }

  #write(persisted: PersistedSettings): Effect.Effect<void, PlatformError> {
    const written = { ...encodePersistedSettings(persisted), ...this.#carried };
    return this.#onFileSystem(
      writeSettingsFileAtomic(
        this.#directory(),
        `${JSON.stringify(written, undefined, 2)}\n`,
        this.#writer,
      ),
    );
  }

  #onFileSystem<A>(
    effect: Effect.Effect<A, PlatformError, FileSystem.FileSystem | Path.Path>,
  ): Effect.Effect<A, PlatformError> {
    return effect.pipe(
      Effect.provideService(FileSystem.FileSystem, this.#fileSystem),
      Effect.provideService(Path.Path, this.#path),
    );
  }
}
