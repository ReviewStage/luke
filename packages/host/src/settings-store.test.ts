import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import type { MacRepository } from "@luke/features/mac-terminal-wire";
import { VIDEO_AVATAR } from "@luke/features/video-avatar";
import { LIVE_VOICE } from "@luke/live";
import {
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  EXPERIMENT,
  type ExperimentChoices,
  THEME,
} from "@luke/settings";
import {
  type AppSettings,
  appSettingsView,
  type SettingsResetScope,
  type SettingsUpdateResult,
} from "@luke/settings/wire";
import { temporaryDirectory } from "@luke/wire/testing";
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

/**
 * Counts what reaches the cipher. Every call is a Keychain read on macOS, so
 // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.

function sealed(plainText: string): string {
  return Buffer.from(`${CIPHER_PREFIX}${plainText}`, "utf8").toString("base64");
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
  retireStoredApiKeys(): Promise<void>;
  cacheExperiments(accountEmail: string, choices: ExperimentChoices): Promise<boolean>;
  macRepositories(): Promise<readonly MacRepository[]>;
  setMacRepository(entry: MacRepository): Promise<void>;
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
    retireStoredApiKeys: () => awaited(store.retireStoredApiKeys()),
    cacheExperiments: (accountEmail, choices) =>
      awaited(store.cacheExperiments(accountEmail, choices)),
    macRepositories: () => awaited(store.macRepositories()),
    setMacRepository: (entry) => awaited(store.setMacRepository(entry)),
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

async function readSettingsFile(directory: string): Promise<string> {
  return fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8");
}

/**
 * A value each setting can hold that is not the value it falls back to, so a
 * write can be told from the state it replaced. The table is total over
 * `APP_SETTING_FIELDS`, so a setting added without one fails to compile rather
 * than going quietly untested.
 */
const SAMPLE_VALUE = {
  // System is what an absent theme falls back to, so Dark is the explicit
  // choice that has to survive a reopen as itself.
  theme: THEME.DARK,
  zoom: 150,
  openAtLogin: false,
  voice: LIVE_VOICE.MARIN,
  voiceCaptions: true,
  voiceHotkey: "Shift+Command+L",
  stopHotkey: "Control+Alt+P",
  duckOtherMedia: false,
  preferBuiltInMicrophone: false,
  // On is the default, so Off is the choice that has to survive a reopen.
  agentNotifications: false,
  macCommands: false,
  // The deployment's own avatar is the default, so a stock one is the choice that has to survive a reopen.
  videoAvatar: VIDEO_AVATAR.CELIA,
} satisfies { [Field in AppSettingField]: NonNullable<AppSettingValue<Field>> };

/**
 * The settings a snapshot resolves rather than reports: what the panel draws
 * for them comes from the environment, or from what this run could actually
 * do, so only their own tests below can state it. What the file holds for them
 * is still the table's business.
 */
const RESOLVED_FIELDS = new Set<AppSettingField>([APP_SETTING_SCHEMA.voice.field]);

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

test("a repository's run command on this Mac survives a reopen, by name in any case, and none forgets it", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  const app: MacRepository = { repository: "acme/app", command: "pnpm dev" };
  const site: MacRepository = { repository: "acme/site", command: "make serve" };

  assert.deepEqual(await store.macRepositories(), []);
  await store.setMacRepository(app);
  await store.setMacRepository(site);
  await store.set("theme", THEME.DARK);
  const renamed = { repository: "Acme/App", command: "pnpm start" };
  await store.setMacRepository(renamed);

  const reopened = await storeIn(directory).macRepositories();
  assert.deepEqual(
    [...reopened].sort((a, b) => a.repository.localeCompare(b.repository)),
    [renamed, site],
  );
  assert.equal(await storeIn(directory).get("theme"), THEME.DARK);

  await store.setMacRepository({ repository: "acme/site", command: null });
  assert.deepEqual(await storeIn(directory).macRepositories(), [renamed]);
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

test("the Mac's session rides sealed beside the OAuth tokens, and reads back with them", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const withSession = {
    ...TEST_ACCOUNT,
    sessionToken: "session-token-secret.signature",
  } as const satisfies StoredAccount;
  await storeIn(directory).setAccount(withSession);

  const reopened = storeIn(directory);
  const contents = await readSettingsFile(directory);

  assert.deepEqual(await reopened.readAccount(), withSession);
  assert.equal(contents.includes(withSession.sessionToken), false);
  assert.equal(JSON.stringify(await reopened.snapshot()).includes(withSession.sessionToken), false);
  // A sign-in that stores no session leaves none behind from the last.
  await reopened.setAccount(TEST_ACCOUNT);
  assert.deepEqual(await storeIn(directory).readAccount(), TEST_ACCOUNT);
});

test("a stored account that signed in with Google still loads", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const signedInWithGoogle = {
    ...TEST_ACCOUNT,
    provider: "google",
  } as const satisfies StoredAccount;
  await storeIn(directory).setAccount(signedInWithGoogle);

  const store = storeIn(directory);

  assert.deepEqual(await store.readAccount(), signedInWithGoogle);
  assert.deepEqual(await store.accountSnapshot(), {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: signedInWithGoogle.email,
    name: signedInWithGoogle.name,
    provider: "google",
  });
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

test("the experiments the service answered stand for the account signed in, across a reopen", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  const factoryOn = { [EXPERIMENT.FACTORY]: true };

  assert.deepEqual((await store.snapshot()).experiments, {});
  assert.equal(await store.cacheExperiments(TEST_ACCOUNT.email, factoryOn), true);
  assert.deepEqual((await store.snapshot()).experiments, factoryOn);
  assert.deepEqual((await storeIn(directory).snapshot()).experiments, factoryOn);

  // The same answer again changes nothing, and an answer for an account not signed in is no choice of this one's.
  assert.equal(await store.cacheExperiments(TEST_ACCOUNT.email, factoryOn), false);
  assert.equal(await store.cacheExperiments("someone-else@example.com", {}), false);
  assert.deepEqual((await store.snapshot()).experiments, factoryOn);
});

test("a sign-out, or another account's sign-in, leaves no experiment of the last account on", async (t) => {
  const factoryOn = { [EXPERIMENT.FACTORY]: true };

  const signedOut = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(signedOut);
  await store.setAccount(TEST_ACCOUNT);
  await store.cacheExperiments(TEST_ACCOUNT.email, factoryOn);
  await store.clearAccount();
  assert.deepEqual((await store.snapshot()).experiments, {});
  await store.setAccount(TEST_ACCOUNT);
  assert.deepEqual((await storeIn(signedOut).snapshot()).experiments, {});

  const switched = await temporaryDirectory(t, "luke-settings-");
  const other = storeIn(switched);
  await other.setAccount(TEST_ACCOUNT);
  await other.cacheExperiments(TEST_ACCOUNT.email, factoryOn);
  await other.setAccount({ ...TEST_ACCOUNT, email: "teammate@example.com" });
  assert.deepEqual((await storeIn(switched).snapshot()).experiments, {});
});
