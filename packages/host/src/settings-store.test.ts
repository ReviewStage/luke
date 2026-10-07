import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { LIVE_DEFAULTS, LIVE_VOICE } from "@sidecar/live";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  VOICE_HOTKEY_NONE,
} from "@sidecar/settings";
import {
  type AppSettings,
  appSettingsView,
  SETTINGS_RESET_SCOPE,
  type SettingsResetScope,
  type SettingsUpdateResult,
} from "@sidecar/settings/wire";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
} from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { test } from "vitest";
import { Environment } from "./effect/seams.js";
import {
  type SettingsEnvironmentOverrides,
  settingsOverrides,
} from "./effect/settings-overrides.js";
import {
  type SecretCipher,
  SettingsStore,
  type SettingsStoreOptions,
  type StoredAccount,
} from "./settings-store.js";

const SETTINGS_FILE_NAME = "settings.json";
const CIPHER_PREFIX = "sealed:";

/** The account every test that needs one signs in, tokens and display identity together. */
const TEST_ACCOUNT = {
  accessToken: "access-token-secret",
  refreshToken: "refresh-token-secret",
  email: "developer@example.com",
  name: "Developer",
  provider: "github",
} as const satisfies StoredAccount;

/** Stands in for Electron's Keychain-backed `safeStorage`. */
function testCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: (plainText) => Buffer.from(`${CIPHER_PREFIX}${plainText}`, "utf8"),
    decrypt: (cipherText) => {
      const value = cipherText.toString("utf8");
      if (!value.startsWith(CIPHER_PREFIX)) throw new Error("Unreadable ciphertext");
      return value.slice(CIPHER_PREFIX.length);
    },
  };
}

interface CipherCallCount {
  isAvailable: number;
  encrypt: number;
  decrypt: number;
}

/**
 * Counts what reaches the cipher. Every call is a Keychain read on macOS, so
 // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
 * what a run does not ask for is as much a part of the behavior as what it
 * returns.
 */
function countingCipher(available = true): SecretCipher & { readonly calls: CipherCallCount } {
  const cipher = testCipher(available);
  const calls: CipherCallCount = { isAvailable: 0, encrypt: 0, decrypt: 0 };
  return {
    calls,
    isAvailable: () => {
      calls.isAvailable += 1;
      return cipher.isAvailable();
    },
    encrypt: (plainText) => {
      calls.encrypt += 1;
      return cipher.encrypt(plainText);
    },
    decrypt: (cipherText) => {
      calls.decrypt += 1;
      return cipher.decrypt(cipherText);
    },
  };
}

function sealed(plainText: string): string {
  return Buffer.from(`${CIPHER_PREFIX}${plainText}`, "utf8").toString("base64");
}

/** The account as the file holds it: both tokens under one ciphertext, the identity beside it. */
function persistedAccount(account: StoredAccount = TEST_ACCOUNT): WireRecord {
  return {
    tokenCipher: sealed(
      JSON.stringify({ accessToken: account.accessToken, refreshToken: account.refreshToken }),
    ),
    email: account.email,
    ...(account.name ? { name: account.name } : undefined),
    provider: account.provider,
  };
}

function expectedPersistedSettings(overrides: WireRecord = {}): UnparsedWireValue {
  return unparsedWire(
    JSON.parse(
      JSON.stringify({
        version: 2,
        ...Object.fromEntries(
          APP_SETTING_FIELDS.map((field) => [
            field,
            APP_SETTING_SCHEMA[field].guard(undefined).value,
          ]),
        ),
        ...overrides,
      }),
    ),
  );
}

/** The file system every store this suite opens reads and writes through. */
const FILE_SYSTEM: FileSystem.FileSystem = Effect.runSync(
  Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer),
);

/** The path service beside it, on the same terms. */
const PATH: Path.Path = Effect.runSync(Effect.provide(Path.Path, NodePath.layer));

/**
 * The services this suite's own promise face runs the store's effects under: the
 * store's own methods are effects, and this suite holds them as the promises
 * its assertions are written against. `settings-store-awaited.ts` once
 * answered production callers the same shape by name and is now deleted;
 * this is that shape kept for the suite alone, where the run-outside-an-edge
 * rule does not reach (tests are exempt by extension).
 */
const SERVICES: Context.Context<never> = Context.empty();

/**
 * The store's own methods, as this suite's assertions are written against
 * them — every one this file calls, never the store's whole face.
 */
interface PromisedSettingsStore {
  get<Field extends AppSettingField>(field: Field): Promise<AppSettingValue<Field>>;
  set<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
  snapshot(): Promise<AppSettings>;
  resetSettings(scope: SettingsResetScope): Promise<SettingsUpdateResult>;
  readAccount(): Promise<StoredAccount | undefined>;
  accountSnapshot(): Promise<AccountSnapshot>;
  setAccount(account: StoredAccount): Promise<AccountSnapshot>;
  clearAccount(): Promise<AccountSnapshot>;
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
  retireStoredSecrets(): Promise<boolean>;
}

function awaitedStoreOf(
  store: SettingsStore,
  services: Context.Context<never>,
): PromisedSettingsStore {
  const awaited = <Value>(effect: Effect.Effect<Value, unknown>): Promise<Value> =>
    Effect.runPromiseWith(services)(effect);
  return {
    get: (field) => awaited(store.get(field)),
    set: (field, value) => awaited(store.set(field, value)),
    snapshot: () => awaited(store.snapshot()),
    resetSettings: (scope) => awaited(store.resetSettings(scope)),
    readAccount: () => awaited(store.readAccount()),
    accountSnapshot: () => awaited(store.accountSnapshot()),
    setAccount: (account) => awaited(store.setAccount(account)),
    clearAccount: () => awaited(store.clearAccount()),
    accountPreferences: () => awaited(store.accountPreferences()),
    applyAccountPreferences: (settings, expected) =>
      awaited(store.applyAccountPreferences(settings, expected)),
    accountPreferencesSyncBaseline: (accountEmail) =>
      awaited(store.accountPreferencesSyncBaseline(accountEmail)),
    setAccountPreferencesSyncBaseline: (accountEmail, preferences) =>
      awaited(store.setAccountPreferencesSyncBaseline(accountEmail, preferences)),
    retireStoredSecrets: () => awaited(store.retireStoredSecrets()),
  };
}

function overridesFor(environment: NodeJS.ProcessEnv): SettingsEnvironmentOverrides {
  return Effect.runSync(
    Effect.provide(
      settingsOverrides,
      Layer.succeed(Environment, ConfigProvider.fromEnvRecord(environment)),
    ),
  );
}

function storeIn(
  directory: string,
  options: {
    cipher?: SecretCipher;
    environment?: NodeJS.ProcessEnv;
    credentialsUsable?: boolean;
  } = {},
): PromisedSettingsStore {
  const config: SettingsStoreOptions = {
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    overrides: overridesFor(options.environment ?? {}),
    ...(options.credentialsUsable === undefined
      ? undefined
      : { credentialsUsable: options.credentialsUsable }),
    fileSystem: FILE_SYSTEM,
    path: PATH,
  };
  return awaitedStoreOf(new SettingsStore(config), SERVICES);
}

async function writeSettingsFile(directory: string, contents: WireRecord): Promise<void> {
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), JSON.stringify(contents), "utf8");
}

async function readSettingsFile(directory: string): Promise<string> {
  return fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8");
}

test("a failed first load is retried before a later write", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, {
    version: 2,
    account: persistedAccount(),
    showInDock: true,
  });
  let directoryReads = 0;
  const store = awaitedStoreOf(
    new SettingsStore({
      directory: () => {
        directoryReads += 1;
        if (directoryReads === 1) {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }
        return directory;
      },
      cipher: testCipher(),
      overrides: overridesFor({}),
      fileSystem: FILE_SYSTEM,
      path: PATH,
    }),
    SERVICES,
  );

  await assert.rejects(store.get(APP_SETTING_SCHEMA.showInDock.field), /permission denied/);
  await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

  const reopened = storeIn(directory);
  assert.deepEqual(await reopened.readAccount(), TEST_ACCOUNT);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.duckOtherMedia.field), false);
});

/**
 * A value each setting can hold that is not the value it falls back to, so a
 * write can be told from the state it replaced. The table is total over
 * `APP_SETTING_FIELDS`, so a setting added without one fails to compile rather
 * than going quietly untested.
 */
const SAMPLE_VALUE = {
  openAtLogin: false,
  showInDock: true,
  voice: LIVE_VOICE.MARIN,
  voiceCaptions: true,
  voiceHotkey: "Shift+Command+L",
  stopHotkey: "Control+Alt+P",
  duckOtherMedia: false,
  preferBuiltInMicrophone: false,
} satisfies { [Field in AppSettingField]: NonNullable<AppSettingValue<Field>> };

/**
 * The settings a snapshot resolves rather than reports: what the panel draws
 * for them comes from the environment, or from what this run could actually
 * do, so only their own tests below can state it. What the file holds for them
 * is still the table's business.
 */
const RESOLVED_FIELDS = new Set<AppSettingField>([APP_SETTING_SCHEMA.voice.field]);

/** A number is no setting's shape, so one file corrupts every field at once. */
const CORRUPT_VALUE = 7;

test("every setting starts at its default, survives a reopen, and can be cleared", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const fallback = APP_SETTING_SCHEMA[field].guard(undefined).value;
    const sample = SAMPLE_VALUE[field];
    const directory = await temporaryDirectory(t, "luke-settings-");
    const store = storeIn(directory);

    assert.deepEqual(await store.get(field), fallback, `${field} did not start at its default`);

    const written = await store.set(field, sample);
    assert.equal(written.reason, undefined, field);
    assert.deepEqual(await store.get(field), sample, field);
    assert.deepEqual(
      await storeIn(directory).get(field),
      sample,
      `${field} did not survive a reopen`,
    );
    if (!RESOLVED_FIELDS.has(field)) {
      assert.deepEqual(
        appSettingsView(written.settings)[field],
        sample,
        `${field} was not drawn as it was stored`,
      );
    }

    // Clearing is the absence of a choice, not a stored empty value, so a
    // setting that can be unset reads as unset again from a reopened file.
    if (APP_SETTING_SCHEMA[field].guard(undefined).valid) {
      await store.set(field, undefined);
      assert.deepEqual(
        await storeIn(directory).get(field),
        fallback,
        `${field} did not clear back to its default`,
      );
    }
  }
});

test("every setting reads as its default when the file holds a shape it cannot be", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    await fs.writeFile(
      path.join(directory, SETTINGS_FILE_NAME),
      JSON.stringify({ version: 2, [field]: CORRUPT_VALUE }),
      "utf8",
    );

    assert.deepEqual(
      await storeIn(directory).get(field),
      APP_SETTING_SCHEMA[field].guard(undefined).value,
      `${field} honoured a value it cannot hold`,
    );
  }
});

test("no setting's write reaches the cipher", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    const cipher = countingCipher();
    const store = storeIn(directory, { cipher });

    await store.set(field, SAMPLE_VALUE[field]);

    // A preference is not a credential, so choosing one must reach the
    // Keychain not at all — and never raise its permission dialog.
    assert.deepEqual(
      cipher.calls,
      { isAvailable: 0, encrypt: 0, decrypt: 0 },
      `${field} reached the cipher`,
    );
  }
});

test("a stored account and a chosen preference survive each other's writes", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    const store = storeIn(directory);
    const replacement = { ...TEST_ACCOUNT, accessToken: "access-token-replacement" };

    await store.setAccount(TEST_ACCOUNT);
    await store.set(field, SAMPLE_VALUE[field]);
    await store.setAccount(replacement);

    const reopened = storeIn(directory);
    assert.deepEqual(await reopened.readAccount(), replacement, `${field} disturbed the account`);
    assert.deepEqual(await reopened.get(field), SAMPLE_VALUE[field], `${field} did not survive`);
  }
});

test("round-trips an encrypted account without exposing either token in snapshots", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  const snapshot = await store.setAccount(TEST_ACCOUNT);
  const reopened = storeIn(directory);
  const stats = await fs.stat(path.join(directory, SETTINGS_FILE_NAME));
  const contents = await readSettingsFile(directory);

  assert.deepEqual(snapshot, {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: TEST_ACCOUNT.email,
    name: TEST_ACCOUNT.name,
    provider: TEST_ACCOUNT.provider,
  });
  assert.deepEqual(await reopened.readAccount(), TEST_ACCOUNT);
  // At rest the tokens are ciphertext, private to the owner, and never plain.
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(contents.includes(TEST_ACCOUNT.accessToken), false);
  assert.equal(contents.includes(TEST_ACCOUNT.refreshToken), false);
  const settings = JSON.stringify(await reopened.snapshot());
  assert.equal(settings.includes(TEST_ACCOUNT.accessToken), false);
  assert.equal(settings.includes(TEST_ACCOUNT.refreshToken), false);
});

test("voice is available only to a signed-in account in a run that will use it", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).voiceAvailable, false);
  await store.setAccount(TEST_ACCOUNT);
  assert.equal(appSettingsView(await store.snapshot()).voiceAvailable, true);
  // A fixture run holds the same account and still opens no spoken turn on it.
  const fixture = storeIn(directory, { credentialsUsable: false });
  assert.equal(appSettingsView(await fixture.snapshot()).voiceAvailable, false);
  await store.clearAccount();
  assert.equal(appSettingsView(await store.snapshot()).voiceAvailable, false);
});

test("refuses to store an account when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, { cipher: testCipher(false) });

  await assert.rejects(
    store.setAccount(TEST_ACCOUNT),
    /Encrypted credential storage is unavailable/,
  );
  assert.deepEqual(await store.accountSnapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("asks the cipher nothing on a launch with no account to protect", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const settings = appSettingsView(await store.snapshot());

  assert.equal(await store.readAccount(), undefined);
  assert.equal(settings.voiceAvailable, false);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("asks the cipher nothing to sign out", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, { version: 2, account: persistedAccount() });
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.deepEqual(await store.clearAccount(), { status: ACCOUNT_STATUS.SIGNED_OUT });

  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readAccount(), undefined);
});

test("asks once when an account is stored and keeps that answer from then on", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  await store.setAccount(TEST_ACCOUNT);
  await store.setAccount({ ...TEST_ACCOUNT, accessToken: "access-token-rotated" });

  // Once per run, however many sign-ins pass through it.
  assert.equal(cipher.calls.isAvailable, 1);
});

test("decrypts a stored account without asking whether storage is available", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await storeIn(directory).setAccount(TEST_ACCOUNT);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.deepEqual(await store.readAccount(), TEST_ACCOUNT);
  // Recovering an account the user has is the one reason to reach the
  // Keychain on a launch, and it is reason enough on its own.
  assert.equal(cipher.calls.decrypt, 1);
  assert.equal(cipher.calls.isAvailable, 0);
});

test("ignores a stored account that can no longer be decrypted", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, {
    version: 2,
    account: { ...persistedAccount(), tokenCipher: Buffer.from("rotated").toString("base64") },
  });

  const store = storeIn(directory);

  assert.equal(await store.readAccount(), undefined);
  assert.deepEqual(await store.accountSnapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
  assert.equal(appSettingsView(await store.snapshot()).voiceAvailable, false);
});

test("decides the Dock icon from the file alone, never the keychain", async (t) => {
  // The icon is drawn at launch from this answer, so a locked or slow
  // Keychain — which decrypting a stored account can wait on — must not be
  // able to delay it.
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, {
    version: 2,
    account: persistedAccount(),
    showInDock: true,
  });
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("retiring stored secrets drops what an earlier build kept and nothing else", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  // A file as a build that kept provider keys, calendar grants, and the
  // vault's account wrote it, beside a choice and the account this build reads.
  await writeSettingsFile(directory, {
    version: 2,
    apiKeys: { conductor: sealed("conductor-retired-key") },
    calendarAccounts: [
      { id: "dev@example.com", token: sealed("1//grant"), calendars: ["dev@example.com"] },
    ],
    appleCalendar: { calendars: ["home"] },
    vaultSyncAccount: "developer@example.com",
    account: persistedAccount(),
    voiceCaptions: true,
  });
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.retireStoredSecrets(), true, "the file moved");

  assert.deepEqual(
    JSON.parse(await readSettingsFile(directory)),
    expectedPersistedSettings({ account: persistedAccount(), voiceCaptions: true }),
  );
  // A ciphertext is dropped as it stands, never opened to be dropped.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  // Nothing left to drop is no write at all.
  assert.equal(await store.retireStoredSecrets(), false);
  const reopened = storeIn(directory);
  assert.equal(await reopened.retireStoredSecrets(), false);
  assert.deepEqual(await reopened.readAccount(), TEST_ACCOUNT);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceCaptions.field), true);
});

test("retiring stored secrets leaves a file that never held them as it was", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, {
    version: 2,
    account: persistedAccount(),
    voiceCaptions: true,
  });
  const before = await readSettingsFile(directory);

  assert.equal(await storeIn(directory).retireStoredSecrets(), false);
  assert.equal(await readSettingsFile(directory), before);

  // A launch with no file yet creates none for this.
  const empty = await temporaryDirectory(t, "luke-settings-");
  assert.equal(await storeIn(empty).retireStoredSecrets(), false);
  await assert.rejects(() => readSettingsFile(empty), /ENOENT/);
});

test("prefers the chosen voice over the environment, and the environment over the default", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
  });

  assert.equal(appSettingsView(await store.snapshot()).voice, LIVE_VOICE.SAGE);
  // The environment names the voice only until the user does, so it is
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // reported in the snapshot but never as something the user stored.
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);

  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);
  assert.equal(appSettingsView(await store.snapshot()).voice, LIVE_VOICE.MARIN);

  await store.set(APP_SETTING_SCHEMA.voice.field, undefined);
  assert.equal(appSettingsView(await store.snapshot()).voice, LIVE_VOICE.SAGE);
});

test("ignores a stored or environment voice this build does not offer", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, voice: "baritone" }),
  );
  const store = storeIn(directory, { environment: { LUKE_LIVE_VOICE: "baritone" } });

  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).voice, LIVE_DEFAULTS.VOICE);
});

test("account preferences extraction excludes resolved defaults and local-only preferences", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
  });

  await store.set(APP_SETTING_SCHEMA.showInDock.field, true);
  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, VOICE_HOTKEY_NONE);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.CEDAR);

  assert.deepEqual(await store.accountPreferences(), {
    voice: LIVE_VOICE.CEDAR,
  });
});

test("applies account preferences to disk and restores them from a new store", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.showInDock.field, true);
  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, VOICE_HOTKEY_NONE);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);

  const result = await store.applyAccountPreferences({ voice: LIVE_VOICE.MARIN });

  assert.deepEqual(result.changed, [APP_SETTING_SCHEMA.voice.field]);
  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), VOICE_HOTKEY_NONE);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.MARIN);
});

test("merges hosted account preferences around concurrent local preference edits", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  const expected = await store.accountPreferences();

  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
  const result = await store.applyAccountPreferences(
    { voice: LIVE_VOICE.MARIN },
    { accountEmail: TEST_ACCOUNT.email, preferences: expected },
  );

  // The local edit since the baseline stands over the remote value.
  assert.deepEqual(result.changed, []);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
});

test("keeps local account preference edits across a failed hosted write and restart", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  await store.setAccountPreferencesSyncBaseline(
    TEST_ACCOUNT.email,
    await store.accountPreferences(),
  );

  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
  const reopened = storeIn(directory);
  const baseline = await reopened.accountPreferencesSyncBaseline(TEST_ACCOUNT.email);
  assert.deepEqual(baseline, { voice: LIVE_VOICE.SAGE });
  const result = await reopened.applyAccountPreferences(
    { voice: LIVE_VOICE.MARIN },
    { accountEmail: TEST_ACCOUNT.email, preferences: baseline ?? {} },
  );

  assert.deepEqual(result.changed, []);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
});

test("skips a guarded account preference apply after account sign-out", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  const expected = await store.accountPreferences();

  await store.clearAccount();
  const result = await store.applyAccountPreferences(
    { voice: LIVE_VOICE.MARIN },
    { accountEmail: TEST_ACCOUNT.email, preferences: expected },
  );

  assert.deepEqual(result.changed, []);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
  assert.equal(await store.accountPreferencesSyncBaseline(TEST_ACCOUNT.email), undefined);
});

test("stores a deleted talk key as the none token and reads it back", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.voiceHotkey.field,
    VOICE_HOTKEY_NONE,
  );

  assert.equal(reason, undefined);
  // A deletion is a choice, not an absence: unlike a reset it survives the
  // file being reopened, or the key would come back on the next launch.
  assert.equal(appSettingsView(settings).voiceHotkey, VOICE_HOTKEY_NONE);
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.voiceHotkey.field),
    VOICE_HOTKEY_NONE,
  );
});

test("ignores a stored chord this build cannot register", async (t) => {
  for (const field of [APP_SETTING_SCHEMA.voiceHotkey.field, APP_SETTING_SCHEMA.stopHotkey.field]) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    await fs.writeFile(
      path.join(directory, SETTINGS_FILE_NAME),
      JSON.stringify({ version: 2, [field]: "F13" }),
    );
    const store = storeIn(directory);

    // A hand-edited chord the registrars would refuse is dropped rather than
    // carried: honouring it would claim a key nothing was ever told about.
    assert.equal(await store.get(field), undefined, field);
    assert.equal(appSettingsView(await store.snapshot())[field], undefined, field);
  }
});

test("the two Luke keys survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Control+Alt+Space");
  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), "Control+Alt+Space");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.stopHotkey.field), "Control+Alt+X");
});

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { status, settings } = await store.set(APP_SETTING_SCHEMA.showInDock.field, true);
  await store.setAccount(TEST_ACCOUNT);

  assert.equal(status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(appSettingsView(settings).showInDock, true);
  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.deepEqual(await reopened.readAccount(), TEST_ACCOUNT);
});

test("a voice reset forgets the voice, captions, and duck in one action", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.CEDAR);
  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);
  await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voice, LIVE_DEFAULTS.VOICE);
  assert.equal(appSettingsView(settings).voiceCaptions, false);
  assert.equal(appSettingsView(settings).duckOtherMedia, true);
  // The choices are forgotten rather than restated, so a default that moves
  // in a later build moves these settings with it.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voice.field), undefined);
});

test("a voice reset returns to the environment's voice where one stands behind the choice", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
  });
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);

  const { settings } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // Forgetting the choice is the reset's whole meaning: what stands afterwards
  // is whatever would have stood had none been made.
  assert.equal(appSettingsView(settings).voice, LIVE_VOICE.SAGE);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
});

test("an appearance reset returns Luke's stances without touching the voice page", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.showInDock.field, true);
  await store.set(APP_SETTING_SCHEMA.openAtLogin.field, false);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).showInDock, false);
  assert.equal(appSettingsView(settings).openAtLogin, true);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.openAtLogin.field), true);
  // One scope's reset is that scope's alone.
  assert.equal(appSettingsView(settings).voice, LIVE_VOICE.MARIN);
});

test("a shortcuts reset forgets both chords at once", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Shift+Command+L");
  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.SHORTCUTS);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voiceHotkey, undefined);
  assert.equal(appSettingsView(settings).stopHotkey, undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voiceHotkey.field), undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.stopHotkey.field), undefined);
});

test("a reset of settings already at their defaults writes nothing", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voice, LIVE_DEFAULTS.VOICE);
  // Nothing changed, so no file was created — the same silence every setter
  // keeps when asked for the value it already holds.
  await assert.rejects(readSettingsFile(directory));
});

test("a reset never touches the cipher", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });
  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);

  await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // A preference is not a credential, so resetting a page of them never
  // reaches the Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("a reset leaves a stored account standing", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await writeSettingsFile(directory, {
    version: 2,
    account: persistedAccount(),
    voiceCaptions: true,
    duckOtherMedia: true,
    preferBuiltInMicrophone: true,
    showInDock: false,
  });
  const store = storeIn(directory);

  await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // No scope reaches a credential: the ciphertext rides the write untouched.
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const contents = JSON.parse(await readSettingsFile(directory)) as {
    account: WireRecord;
    voiceCaptions: boolean;
  };
  assert.deepEqual(contents.account, persistedAccount());
  assert.equal(contents.voiceCaptions, false);
  assert.deepEqual(await store.readAccount(), TEST_ACCOUNT);
});

/**
 * The store's own face, yielded rather than awaited: what every caller above
 * reads through one run apiece is one fiber here, and a write and the read
 * after it settle in the order the effects are sequenced in.
 */
it.effect("the store's own methods are effects a caller sequences itself", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      const store = new SettingsStore({
        directory: () => directory,
        cipher: testCipher(),
        overrides: overridesFor({}),
        fileSystem: FILE_SYSTEM,
        path: PATH,
      });

      assert.equal(
        yield* store.get(APP_SETTING_SCHEMA.showInDock.field),
        APP_SETTING_SCHEMA.showInDock.guard(undefined).value,
      );
      const saved = yield* store.set(APP_SETTING_SCHEMA.showInDock.field, true);
      assert.equal(saved.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(yield* store.get(APP_SETTING_SCHEMA.showInDock.field), true);

      const reopened = new SettingsStore({
        directory: () => directory,
        cipher: testCipher(),
        overrides: overridesFor({}),
        fileSystem: FILE_SYSTEM,
        path: PATH,
      });
      assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
    }),
  ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

/** Concurrent reads share one read of the file rather than each making their own. */
it.effect("concurrent reads of an unread store read the file once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      let directoryReads = 0;
      const store = new SettingsStore({
        directory: () => {
          directoryReads += 1;
          return directory;
        },
        cipher: testCipher(),
        overrides: overridesFor({}),
        fileSystem: FILE_SYSTEM,
        path: PATH,
      });

      yield* Effect.all(
        [
          store.get(APP_SETTING_SCHEMA.showInDock.field),
          store.get(APP_SETTING_SCHEMA.duckOtherMedia.field),
          store.get(APP_SETTING_SCHEMA.voice.field),
        ],
        { concurrency: 3 },
      );

      assert.equal(directoryReads, 1);
    }),
  ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
