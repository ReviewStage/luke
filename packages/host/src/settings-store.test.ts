import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { CREDENTIAL_PROVIDER_ID, type CredentialProviderId } from "@sidecar/credentials";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "@sidecar/credentials/vocabulary";
import { VAULT_KEY_MAX_LENGTH, vaultKeyIsStorable } from "@sidecar/hosted";
import { LIVE_DEFAULTS, LIVE_VOICE } from "@sidecar/live";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  PROVIDER_ID,
  type ProviderId,
  SESSION_FILTER,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  VOICE_HOTKEY_NONE,
} from "@sidecar/settings";
import { appSettingsView, SETTINGS_RESET_SCOPE } from "@sidecar/settings/wire";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import {
  ACTION_RESULT_STATUS,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
} from "@sidecar/wire";
import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted, Result, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { test } from "vitest";
import { Environment } from "./effect/seams.js";
import { settingsOverrides } from "./effect/settings-overrides.js";
import {
  apiKeyRejection,
  parsePersistedSettingsEither,
  type SecretCipher,
  SettingsParseRefusal,
  SettingsStore,
  type SettingsStoreOptions,
} from "./settings-store.js";

const TEST_API_KEY = "conductor-live-key";
const SETTINGS_FILE_NAME = "settings.json";
const CIPHER_PREFIX = "sealed:";
const CONDUCTOR = CREDENTIAL_PROVIDER_ID.CONDUCTOR;

const TEST_ENVIRONMENT_VARIABLE = {
  API_KEY: "CONDUCTOR_API_KEY",
  API_TOKEN: "CONDUCTOR_API_TOKEN",
} as const;

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

function expectedPersistedSettings(overrides: WireRecord = {}): UnparsedWireValue {
  return unparsedWire(
    JSON.parse(
      JSON.stringify({
        version: 2,
        apiKeys: {},
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

/** The file system and path services every store this suite opens reads and writes through. */
const PLATFORM = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/**
 * One test of the store: its effects yielded in the order they are written, on
 * the Node file system, in a scope that takes the directories it made with it.
 */
function storeTest(
  name: string,
  body: () => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path | Scope.Scope>,
): void {
  it.effect(name, () => Effect.scoped(body()).pipe(Effect.provide(PLATFORM)));
}

/** The store hands a key out sealed; the assertions here are written against the string it seals. */
function revealed(key: Redacted.Redacted | undefined): string | undefined {
  return key === undefined ? undefined : Redacted.value(key);
}

function readApiKey(
  store: SettingsStore,
  providerId: CredentialProviderId,
): Effect.Effect<string | undefined, PlatformError> {
  return Effect.map(store.readApiKey(providerId), revealed);
}

function readStoredApiKey(
  store: SettingsStore,
  providerId: CredentialProviderId,
): Effect.Effect<string | undefined, PlatformError> {
  return Effect.map(store.readStoredApiKey(providerId), revealed);
}

function overridesFor(environment: NodeJS.ProcessEnv) {
  return Effect.provide(
    settingsOverrides,
    Layer.succeed(Environment, ConfigProvider.fromEnvRecord(environment)),
  );
}

interface StoreFixture {
  cipher?: SecretCipher;
  environment?: NodeJS.ProcessEnv;
  vaultKeyHeld?: SettingsStoreOptions["vaultKeyHeld"];
}

/** A store's seams over one directory: the fixture cipher and environment, and the platform the test runs on. */
function storeOptions(
  directory: string,
  options: StoreFixture = {},
): Effect.Effect<SettingsStoreOptions, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    return {
      directory: () => directory,
      cipher: options.cipher ?? testCipher(),
      overrides: yield* overridesFor(options.environment ?? {}),
      vaultKeyHeld: options.vaultKeyHeld ?? (() => false),
      fileSystem: yield* FileSystem.FileSystem,
      path: yield* Path.Path,
    };
  });
}

function storeIn(
  directory: string,
  options: StoreFixture = {},
): Effect.Effect<SettingsStore, unknown, FileSystem.FileSystem | Path.Path> {
  return Effect.map(storeOptions(directory, options), (config) => new SettingsStore(config));
}

storeTest("a failed first load is retried before a later write", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
        showInDock: true,
      }),
    );
    let directoryReads = 0;
    const store = new SettingsStore({
      ...(yield* storeOptions(directory)),
      directory: () => {
        directoryReads += 1;
        if (directoryReads === 1) {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        }
        return directory;
      },
    });

    const refused = yield* Effect.exit(store.get(APP_SETTING_SCHEMA.showInDock.field));
    assert.ok(Exit.isFailure(refused));
    assert.match(String(Cause.squash(refused.cause)), /permission denied/);
    yield* store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

    const reopened = yield* storeIn(directory);
    assert.equal(yield* readApiKey(reopened, CONDUCTOR), TEST_API_KEY);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.duckOtherMedia.field), false);
  }),
);

function readWorkspaceAgentDefault(store: SettingsStore, providerId: ProviderId) {
  return Effect.map(
    store.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field),
    (defaults) => defaults?.[providerId],
  );
}

function setWorkspaceAgentDefault(
  store: SettingsStore,
  providerId: ProviderId,
  selection: WorkspaceAgentSelection | undefined,
) {
  return store.setEntry(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, providerId, selection);
}

function readWorkspaceProjectDefault(store: SettingsStore, providerId: ProviderId) {
  return Effect.map(
    store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field),
    (defaults) => defaults?.[providerId],
  );
}

function setWorkspaceProjectDefault(
  store: SettingsStore,
  providerId: ProviderId,
  providerProjectId: string | undefined,
) {
  return store.setEntry(
    APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
    providerId,
    providerProjectId,
  );
}

/** The file as it stands, or the error the read answered: a test asks for the second where nothing was written. */
function readSettingsFile(directory: string): Effect.Effect<string, unknown> {
  return Effect.tryPromise({
    try: () => fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8"),
    catch: (error) => error,
  });
}

function writeSettingsFile(directory: string, contents: string): Effect.Effect<void> {
  return Effect.promise(() =>
    fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), contents, "utf8"),
  );
}

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
  announceSessions: false,
  quietDuringMeetings: false,
  showOnAllDisplays: true,
  formFactor: PANEL_FORM_FACTOR.NOTCH,
  sessionFilters: [SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX],
  sessionSearchQuery: "review",
  defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
  workspaceAgentDefaults: { [PROVIDER_ID.CONDUCTOR]: { agent: "claude", model: "sonnet" } },
  workspaceProjectDefaults: { [PROVIDER_ID.CONDUCTOR]: "project-one" },
} satisfies { [Field in AppSettingField]: NonNullable<AppSettingValue<Field>> };

/**
 * The settings a snapshot resolves rather than reports: what the panel draws
 * for them comes from the environment, or from what this run could actually
 * do, so only their own tests below can state it. What the file holds for them
 * is still the table's business.
 */
const RESOLVED_FIELDS = new Set<AppSettingField>([
  APP_SETTING_SCHEMA.voice.field,
  APP_SETTING_SCHEMA.formFactor.field,
]);

/** A number is no setting's shape, so one file corrupts every field at once. */
const CORRUPT_VALUE = 7;

storeTest("every setting starts at its default, survives a reopen, and can be cleared", () =>
  Effect.gen(function* () {
    for (const field of APP_SETTING_FIELDS) {
      const fallback = APP_SETTING_SCHEMA[field].guard(undefined).value;
      const sample = SAMPLE_VALUE[field];
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory);

      assert.deepEqual(yield* store.get(field), fallback, `${field} did not start at its default`);

      const written = yield* store.set(field, sample);
      assert.equal(written.reason, undefined, field);
      assert.deepEqual(yield* store.get(field), sample, field);
      assert.deepEqual(
        yield* (yield* storeIn(directory)).get(field),
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
        yield* store.set(field, undefined);
        assert.deepEqual(
          yield* (yield* storeIn(directory)).get(field),
          fallback,
          `${field} did not clear back to its default`,
        );
      }
    }
  }),
);

storeTest("every setting reads as its default when the file holds a shape it cannot be", () =>
  Effect.gen(function* () {
    for (const field of APP_SETTING_FIELDS) {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      yield* writeSettingsFile(
        directory,
        JSON.stringify({ version: 2, apiKeys: {}, [field]: CORRUPT_VALUE }),
      );

      assert.deepEqual(
        yield* (yield* storeIn(directory)).get(field),
        APP_SETTING_SCHEMA[field].guard(undefined).value,
        `${field} honoured a value it cannot hold`,
      );
    }
  }),
);

storeTest("no setting's write reaches the cipher, and none disturbs a stored key", () =>
  Effect.gen(function* () {
    for (const field of APP_SETTING_FIELDS) {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const cipher = countingCipher();
      const store = yield* storeIn(directory, { cipher });
      yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
      const protectingTheKey = { ...cipher.calls };

      yield* store.set(field, SAMPLE_VALUE[field]);

      // A preference is not a credential, so choosing one must reach the
      // Keychain not at all — and never raise its permission dialog.
      assert.deepEqual(cipher.calls, protectingTheKey, `${field} reached the cipher`);
      assert.equal(
        yield* readApiKey(yield* storeIn(directory), CONDUCTOR),
        TEST_API_KEY,
        `${field} disturbed a stored key`,
      );
    }
  }),
);

storeTest("stores an API key encrypted, private to the owner, and never in a snapshot", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    const { settings, reason } = yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
    const stats = yield* Effect.promise(() => fs.stat(path.join(directory, SETTINGS_FILE_NAME)));

    assert.equal(reason, undefined);
    // A cloud provider's row answers for the vault, never for the file: a key
    // still kept here is one the migration has yet to hand over.
    assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
    assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.AVAILABLE);
    assert.equal(stats.mode & 0o777, 0o600);
    assert.equal(yield* readApiKey(store, CONDUCTOR), TEST_API_KEY);
  }),
);

storeTest("round-trips an encrypted account without exposing either token in snapshots", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    const account = {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      email: "developer@example.com",
      name: "Developer",
      provider: "github" as const,
    };

    const snapshot = yield* store.setAccount(account);
    const reopened = yield* storeIn(directory);

    assert.deepEqual(snapshot, {
      status: ACCOUNT_STATUS.SIGNED_IN,
      email: account.email,
      name: account.name,
      provider: account.provider,
    });
    assert.deepEqual(yield* reopened.readAccount(), account);
  }),
);

storeTest("decrypts once and re-decrypts only after the key changes", () =>
  Effect.gen(function* () {
    // The observation timer reads the credential every few seconds, so decrypting
    // on each read would reach the OS keychain thousands of times a day.
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    let decryptions = 0;
    const cipher = testCipher();
    const store = yield* storeIn(directory, {
      cipher: {
        ...cipher,
        decrypt: (cipherText) => {
          decryptions += 1;
          return cipher.decrypt(cipherText);
        },
      },
    });
    yield* store.setApiKey(CONDUCTOR, "conductor-stored-key");

    // The snapshot a save answers with reports a cloud provider's key from the
    // vault and resolves nothing locally, so the first read is the one decrypt.
    yield* readApiKey(store, CONDUCTOR);
    const afterFirstRead = decryptions;
    assert.equal(afterFirstRead, 1);
    for (let read = 0; read < 5; read += 1) yield* readApiKey(store, CONDUCTOR);
    const afterReads = decryptions;
    yield* store.setApiKey(CONDUCTOR, "conductor-replacement-key");
    yield* readApiKey(store, CONDUCTOR);

    assert.equal(afterReads, afterFirstRead, "a repeated read decrypted again");
    assert.ok(decryptions > afterReads, "a replaced key was not re-read");
    assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-replacement-key");
  }),
);

test("a key the door admits is one the vault stores, and each refusal names its own reason", () => {
  // The cloud path holds a key to apiKeyRejection alone, so the vault's shape
  // rule has to be inside it: the same length cap, and no whitespace.
  const longest = "k".repeat(VAULT_KEY_MAX_LENGTH);
  assert.equal(apiKeyRejection(longest), undefined);
  assert.equal(vaultKeyIsStorable(longest), true);
  assert.equal(apiKeyRejection(`${longest}k`), "That API key is too long.");
  assert.equal(vaultKeyIsStorable(`${longest}k`), false);
  for (const key of ["key with spaces", "key\twith\ttabs", "key\nwith\nnewlines"]) {
    assert.equal(apiKeyRejection(key), "That API key contains unsupported characters.");
    assert.equal(vaultKeyIsStorable(key), false);
  }
});

storeTest(
  "a cloud provider's source is the vault's answer for the account signed in, whatever this Mac holds or reads",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const held = yield* storeIn(directory, {
        environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment" },
        vaultKeyHeld: () => true,
      });
      // The vault's list is the account's: signed out, a held key is nobody's to show.
      assert.equal(
        appSettingsView(yield* held.snapshot()).credentialSources[CONDUCTOR],
        CREDENTIAL_SOURCE.NONE,
      );
      yield* held.setAccount({
        accessToken: "access-token-secret",
        refreshToken: "refresh-token-secret",
        email: "developer@example.com",
        name: "Developer",
        provider: "github",
      });
      assert.equal(
        appSettingsView(yield* held.snapshot()).credentialSources[CONDUCTOR],
        CREDENTIAL_SOURCE.SERVICE,
      );
      const unheld = yield* storeIn(directory, {
        environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment" },
      });
      assert.equal(
        appSettingsView(yield* unheld.snapshot()).credentialSources[CONDUCTOR],
        CREDENTIAL_SOURCE.NONE,
      );
    }),
);

storeTest("a stored selection keeps only the filters this build recognizes", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: {},
        sessionFilters: ["local", "a-future-builds-filter", 7, "local", PROVIDER_ID.CODEX],
      }),
    );

    assert.deepEqual(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).sessionFilters,
      [SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX],
    );
  }),
);

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
storeTest("a stored query of nothing but whitespace reads as unset rather than narrowing", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({ version: 2, apiKeys: {}, sessionSearchQuery: "   " }),
    );

    assert.equal(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).sessionSearchQuery,
      undefined,
    );
  }),
);

storeTest("a stored connection answers presence without touching any grant", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    assert.equal(yield* store.calendarConnectionStored(), false);
    yield* store.connectAppleCalendar(["home"]);
    assert.equal(yield* store.calendarConnectionStored(), true);
    yield* store.disconnectAppleCalendar();
    assert.equal(yield* store.calendarConnectionStored(), false);
    yield* store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);
    assert.equal(yield* store.calendarConnectionStored(), true);
  }),
);

storeTest("a calendar account stores its grant encrypted and survives a reopen", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    assert.deepEqual(yield* store.readCalendarAccounts(), []);
    const stored = yield* store.addCalendarAccount("dev@example.com", "1//grant-from-sign-in", [
      "dev@example.com",
    ]);

    assert.equal(stored.reason, undefined);
    assert.deepEqual(appSettingsView(stored.settings).calendarAccounts, [
      { id: "dev@example.com", selectedCalendarIds: ["dev@example.com"] },
    ]);
    // At rest the grant is ciphertext, never the plain token.
    const persisted = JSON.parse(yield* readSettingsFile(directory));
    assert.equal(persisted.calendarAccounts[0].token, sealed("1//grant-from-sign-in"));
    // The account outlives the run that stored it, grant and choices together.
    assert.deepEqual(yield* (yield* storeIn(directory)).readCalendarAccounts(), [
      {
        id: "dev@example.com",
        refreshToken: "1//grant-from-sign-in",
        selectedCalendarIds: ["dev@example.com"],
      },
    ]);
  }),
);

storeTest("accounts stand side by side, and reconnecting one keeps its choices", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    yield* store.addCalendarAccount("work@example.com", "1//work-grant", ["work@example.com"]);
    yield* store.addCalendarAccount("home@example.com", "1//home-grant", ["home@example.com"]);
    yield* store.setCalendarSelected("work@example.com", "team-calendar", true);
    // Signing into work again replaces the grant, not the user's choices.
    yield* store.addCalendarAccount("work@example.com", "1//fresh-work-grant", [
      "work@example.com",
    ]);

    const accounts = yield* store.readCalendarAccounts();
    assert.deepEqual(accounts, [
      {
        id: "work@example.com",
        refreshToken: "1//fresh-work-grant",
        selectedCalendarIds: ["work@example.com", "team-calendar"],
      },
      {
        id: "home@example.com",
        refreshToken: "1//home-grant",
        selectedCalendarIds: ["home@example.com"],
      },
    ]);
  }),
);

storeTest(
  "selection changes one calendar on one account, and removal takes the grant with it",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory);
      yield* store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);

      yield* store.setCalendarSelected("dev@example.com", "team-calendar", true);
      yield* store.setCalendarSelected("dev@example.com", "dev@example.com", false);
      const unknown = yield* store.setCalendarSelected("nobody@example.com", "team-calendar", true);
      assert.equal(unknown.reason, "That calendar account is not connected.");

      assert.deepEqual((yield* store.readCalendarAccounts())[0]?.selectedCalendarIds, [
        "team-calendar",
      ]);

      const removed = yield* store.removeCalendarAccount("dev@example.com");
      assert.deepEqual(appSettingsView(removed.settings).calendarAccounts, []);
      assert.deepEqual(yield* store.readCalendarAccounts(), []);
      // Nothing empty is written down: a file with no accounts carries no field.
      assert.equal(JSON.parse(yield* readSettingsFile(directory)).calendarAccounts, undefined);
    }),
);

storeTest("the Apple Calendar connection stores only the choice and survives a reopen", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    assert.equal(yield* store.readAppleCalendarConnection(), undefined);
    assert.equal(appSettingsView(yield* store.snapshot()).appleCalendar, undefined);

    const connected = yield* store.connectAppleCalendar(["home", "work"]);
    assert.equal(connected.reason, undefined);
    assert.deepEqual(appSettingsView(connected.settings).appleCalendar, {
      id: "apple-calendar",
      selectedCalendarIds: ["home", "work"],
    });
    // Nothing secret is at rest: the file carries the choice and no token, so
    // nothing here ever reaches the cipher.
    const persisted = JSON.parse(yield* readSettingsFile(directory));
    assert.deepEqual(persisted.appleCalendar, { calendars: ["home", "work"] });
    // The connection outlives the run that stored it.
    assert.deepEqual(yield* (yield* storeIn(directory)).readAppleCalendarConnection(), {
      selectedCalendarIds: ["home", "work"],
    });
  }),
);

storeTest("connecting Apple Calendar again keeps the held choices, and selection edits them", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* store.connectAppleCalendar(["default-calendar"]);
    // Asking to connect while connected is not a fresh mind about the choices.
    yield* store.connectAppleCalendar(["another"]);
    // The Apple selection goes through the same door as every account's,
    // routed by the fixed id, so callers never learn it is stored apart.
    yield* store.setCalendarSelected("apple-calendar", "team", true);
    yield* store.setCalendarSelected("apple-calendar", "default-calendar", false);
    assert.deepEqual(yield* store.readAppleCalendarConnection(), { selectedCalendarIds: ["team"] });

    const disconnected = yield* store.disconnectAppleCalendar();
    assert.equal(appSettingsView(disconnected.settings).appleCalendar, undefined);
    assert.equal(yield* store.readAppleCalendarConnection(), undefined);
    const idle = yield* store.setCalendarSelected("apple-calendar", "team", true);
    assert.equal(idle.reason, "Apple Calendar is not connected.");
    // Nothing empty is written down: a disconnected file carries no field.
    assert.equal(JSON.parse(yield* readSettingsFile(directory)).appleCalendar, undefined);
  }),
);

storeTest("a calendar account never disturbs a stored key, nor a key an account", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
    yield* store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);
    yield* store.setApiKey(CONDUCTOR, undefined);

    const reopened = yield* storeIn(directory);
    assert.equal(yield* readApiKey(reopened, CONDUCTOR), undefined);
    assert.equal((yield* reopened.readCalendarAccounts()).length, 1);
  }),
);

storeTest(
  "a stored key outranks the environment fallback in a read, and clearing it returns the read to the environment",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory, {
        environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment" },
      });

      assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-environment");
      yield* store.setApiKey(CONDUCTOR, "conductor-stored-key");
      assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-stored-key");
      // The stored key alone is Luke's to send anywhere; the environment's is
      // the shell's, and a caller that asks for what is stored is told so.
      assert.equal(yield* readStoredApiKey(store, CONDUCTOR), "conductor-stored-key");

      // Clearing the stored key does not clear the environment, which was never
      // Luke's to hold.
      yield* store.setApiKey(CONDUCTOR, undefined);
      assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-environment");
      assert.equal(yield* readStoredApiKey(store, CONDUCTOR), undefined);
      // A cloud provider's row answers for the vault, never for a key this Mac
      // holds or reads from its shell.
      assert.equal(
        appSettingsView(yield* store.snapshot()).credentialSources[CONDUCTOR],
        CREDENTIAL_SOURCE.NONE,
      );
    }),
);

storeTest(
  "a launch drops the ciphertext of a provider this build no longer names, and keeps the rest",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory);
      yield* store.setApiKey(CONDUCTOR, "conductor-stored-key");
      // The developer's own OpenAI key, as a build before LUKE-205 stored it.
      const contents = JSON.parse(yield* readSettingsFile(directory));
      yield* writeSettingsFile(
        directory,
        JSON.stringify({
          ...contents,
          apiKeys: { ...contents.apiKeys, openai: sealed("sk-retired") },
        }),
      );

      const reopened = yield* storeIn(directory);
      assert.equal(yield* reopened.retireStoredApiKeys(), true, "the file moved");
      assert.deepEqual(
        JSON.parse(yield* readSettingsFile(directory)),
        expectedPersistedSettings({ apiKeys: { [CONDUCTOR]: sealed("conductor-stored-key") } }),
      );
      assert.equal(yield* readApiKey(reopened, CONDUCTOR), "conductor-stored-key");
      // Nothing left to drop is no write at all.
      assert.equal(yield* reopened.retireStoredApiKeys(), false);
    }),
);

storeTest("the last of two overlapping saves of one key is what the file keeps", () =>
  Effect.gen(function* () {
    // Each settings row carries its own busy flag, so a save can begin before
    // the one before it has landed; the write gate orders them.
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    yield* Effect.all(
      [
        store.setApiKey(CONDUCTOR, "conductor-first-key"),
        store.setApiKey(CONDUCTOR, "conductor-stored-key"),
      ],
      { concurrency: "unbounded" },
    );

    assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-stored-key");
    assert.deepEqual(
      JSON.parse(yield* readSettingsFile(directory)),
      expectedPersistedSettings({ apiKeys: { [CONDUCTOR]: sealed("conductor-stored-key") } }),
    );
    const reopened = yield* storeIn(directory);
    assert.equal(yield* readApiKey(reopened, CONDUCTOR), "conductor-stored-key");
  }),
);

storeTest("reports nothing for a provider the registry does not name", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    const unknown = "no-such-service" as CredentialProviderId;

    assert.equal(yield* readApiKey(store, unknown), undefined);
    assert.equal(appSettingsView(yield* store.snapshot()).credentialSources[unknown], undefined);
  }),
);

storeTest("falls back to an API key from the environment", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory, {
      environment: { [TEST_ENVIRONMENT_VARIABLE.API_TOKEN]: `  ${TEST_API_KEY}  ` },
    });

    const settings = appSettingsView(yield* store.snapshot());

    // The key resolves for a caller that asks, but a cloud provider's row does
    // not answer for the shell: the vault is the one place its key connects from.
    assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
    assert.equal(yield* readApiKey(store, CONDUCTOR), TEST_API_KEY);
  }),
);

storeTest("rejects a key that cannot be sent as an authorization header", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    for (const candidate of ["short", "key with spaces", "k".repeat(513)]) {
      // The store answers with the rule's own reason rather than one of its
      // own, and a refused key leaves the file it would have been written to
      // uncreated.
      assert.equal(
        (yield* store.setApiKey(CONDUCTOR, candidate)).reason,
        apiKeyRejection(candidate),
      );
    }
    assert.equal(yield* readApiKey(store, CONDUCTOR), undefined);
    assert.match(String(yield* Effect.flip(readSettingsFile(directory))), /ENOENT/);
  }),
);

test("holds a key only in the form its provider says it issues", () => {
  // A credential in a form the provider no longer accepts would be refused on
  // the first request, and a key Luke cannot use is worth saying so about
  // rather than storing and then going quiet. No provider this build ships
  // publishes a format, so the rule is read where it lives: the same pure
  // check every stored, pasted, and environment key passes through.
  const format = {
    label: "API key",
    prefix: "current_",
    rejection: "Third Cloud's current keys start with current_.",
  };
  assert.equal(apiKeyRejection("current_third-cloud-key", format), undefined);
  // A provider that publishes no format still takes whatever it issues.
  assert.equal(apiKeyRejection("legacy-third-cloud-key"), undefined);
});

storeTest("refuses to store a key when encrypted storage is unavailable", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory, { cipher: testCipher(false) });

    const { settings } = yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
    assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNAVAILABLE);
    assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
    assert.match(String(yield* Effect.flip(readSettingsFile(directory))), /ENOENT/);
  }),
);

storeTest("asks the cipher nothing on a launch with no key to protect", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });

    const settings = appSettingsView(yield* store.snapshot());

    assert.equal(yield* readApiKey(store, CONDUCTOR), undefined);
    assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
    // Nothing has asked, so nothing is claimed either way.
    assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
  }),
);

storeTest("asks the cipher nothing to clear a key", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });

    const { settings, reason } = yield* store.setApiKey(CONDUCTOR, undefined);

    assert.equal(reason, undefined);
    assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
    assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNKNOWN);
  }),
);

storeTest("asks once when a key is stored and reports that answer from then on", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });

    const { settings } = yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
    const afterwards = appSettingsView(yield* store.snapshot());
    yield* store.setApiKey(CONDUCTOR, `${TEST_API_KEY}-rotated`);

    assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.AVAILABLE);
    assert.equal(afterwards.secretStorage, SECRET_STORAGE.AVAILABLE);
    // Once per run, however many keys pass through it.
    assert.equal(cipher.calls.isAvailable, 1);
  }),
);

storeTest("decrypts a stored key without asking whether storage is available", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* (yield* storeIn(directory)).setApiKey(CONDUCTOR, TEST_API_KEY);
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });

    assert.equal(yield* readApiKey(store, CONDUCTOR), TEST_API_KEY);
    // Recovering a key the user has is the one reason to reach the Keychain on a
    // launch, and it is reason enough on its own.
    assert.equal(cipher.calls.decrypt, 1);
    assert.equal(cipher.calls.isAvailable, 0);
  }),
);

storeTest("ignores a stored key that can no longer be decrypted", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* (yield* storeIn(directory)).setApiKey(CONDUCTOR, TEST_API_KEY);
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: { [CONDUCTOR]: Buffer.from("rotated").toString("base64") },
      }),
    );

    const store = yield* storeIn(directory);

    assert.equal(yield* readApiKey(store, CONDUCTOR), undefined);
    assert.equal(
      appSettingsView(yield* store.snapshot()).credentialSources[CONDUCTOR],
      CREDENTIAL_SOURCE.NONE,
    );
  }),
);

storeTest("carries a key belonging to a provider this build does not know", () =>
  Effect.gen(function* () {
    // A file written by a newer build must not lose credentials to an older one.
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({ version: 2, apiKeys: { "later-cloud": sealed("later-cloud-key") } }),
    );

    yield* (yield* storeIn(directory)).setApiKey(CONDUCTOR, TEST_API_KEY);
    const persisted: unknown = JSON.parse(yield* readSettingsFile(directory));

    assert.deepEqual(
      persisted,
      expectedPersistedSettings({
        apiKeys: { "later-cloud": sealed("later-cloud-key"), [CONDUCTOR]: sealed(TEST_API_KEY) },
      }),
    );
  }),
);

storeTest("decides the Dock icon from the file alone, never the keychain", () =>
  Effect.gen(function* () {
    // The icon is drawn at launch from this answer, so a locked or slow
    // Keychain — which decrypting a stored key can wait on — must not be able to
    // delay it.
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
        showInDock: true,
      }),
    );
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });

    assert.equal(yield* store.get(APP_SETTING_SCHEMA.showInDock.field), true);
    assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  }),
);

storeTest(
  "prefers the chosen voice over the environment, and the environment over the default",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory, {
        environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
      });

      assert.equal(appSettingsView(yield* store.snapshot()).voice, LIVE_VOICE.SAGE);
      // The environment names the voice only until the user does, so it is
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // reported in the snapshot but never as something the user stored.
      assert.equal(yield* store.get(APP_SETTING_SCHEMA.voice.field), undefined);

      yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);
      assert.equal(appSettingsView(yield* store.snapshot()).voice, LIVE_VOICE.MARIN);

      yield* store.set(APP_SETTING_SCHEMA.voice.field, undefined);
      assert.equal(appSettingsView(yield* store.snapshot()).voice, LIVE_VOICE.SAGE);
    }),
);

storeTest("ignores a stored or environment voice this build does not offer", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({ version: 2, apiKeys: {}, voice: "baritone" }),
    );
    const store = yield* storeIn(directory, { environment: { LUKE_LIVE_VOICE: "baritone" } });

    assert.equal(yield* store.get(APP_SETTING_SCHEMA.voice.field), undefined);
    assert.equal(appSettingsView(yield* store.snapshot()).voice, LIVE_DEFAULTS.VOICE);
  }),
);

storeTest(
  "account preferences extraction excludes resolved defaults and local-only preferences",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory, {
        environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
      });

      yield* store.set(APP_SETTING_SCHEMA.showInDock.field, true);
      yield* store.set(APP_SETTING_SCHEMA.voiceHotkey.field, VOICE_HOTKEY_NONE);
      yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.CEDAR);

      assert.deepEqual(yield* store.accountPreferences(), {
        voice: LIVE_VOICE.CEDAR,
      });
    }),
);

storeTest("applies account preferences to disk and restores them from a new store", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* store.set(APP_SETTING_SCHEMA.showInDock.field, true);
    yield* store.set(APP_SETTING_SCHEMA.voiceHotkey.field, VOICE_HOTKEY_NONE);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "project-local");

    const result = yield* store.applyAccountPreferences({
      voice: LIVE_VOICE.MARIN,
      workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-sol" } },
    });

    assert.deepEqual(result.changed, [
      APP_SETTING_SCHEMA.voice.field,
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
    ]);
    const reopened = yield* storeIn(directory);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), VOICE_HOTKEY_NONE);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.MARIN);
    assert.equal(yield* readWorkspaceProjectDefault(reopened, PROVIDER_ID.CONDUCTOR), undefined);
    assert.deepEqual(yield* readWorkspaceAgentDefault(reopened, PROVIDER_ID.CONDUCTOR), {
      agent: "codex",
      model: "gpt-5.6-sol",
    });
  }),
);

storeTest("merges hosted account preferences around concurrent local preference edits", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    const account = {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      email: "developer@example.com",
      name: "Developer",
      provider: "github" as const,
    };
    yield* store.setAccount(account);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
    const expected = yield* store.accountPreferences();

    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "local-project");
    const result = yield* store.applyAccountPreferences(
      {
        voice: LIVE_VOICE.MARIN,
        defaultWorkspaceProvider: PROVIDER_ID.CODEX,
        workspaceProjectDefaults: { [PROVIDER_ID.CODEX]: "remote-project" },
      },
      { accountEmail: account.email, preferences: expected },
    );

    assert.deepEqual(result.changed, [
      APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
    ]);
    assert.equal(yield* store.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
    assert.equal(
      yield* store.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      PROVIDER_ID.CODEX,
    );
    assert.equal(yield* readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), "local-project");
    assert.equal(yield* readWorkspaceProjectDefault(store, PROVIDER_ID.CODEX), "remote-project");
  }),
);

storeTest("keeps local account preference edits across a failed hosted write and restart", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const account = {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      email: "developer@example.com",
      name: "Developer",
      provider: "github" as const,
    };
    const store = yield* storeIn(directory);
    yield* store.setAccount(account);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
    yield* store.setAccountPreferencesSyncBaseline(
      account.email,
      yield* store.accountPreferences(),
    );

    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
    const reopened = yield* storeIn(directory);
    const baseline = yield* reopened.accountPreferencesSyncBaseline(account.email);
    assert.deepEqual(baseline, { voice: LIVE_VOICE.SAGE });
    const result = yield* reopened.applyAccountPreferences(
      { voice: LIVE_VOICE.SAGE, defaultWorkspaceProvider: PROVIDER_ID.CODEX },
      { accountEmail: account.email, preferences: baseline ?? {} },
    );

    assert.deepEqual(result.changed, [APP_SETTING_SCHEMA.defaultWorkspaceProvider.field]);
    assert.equal(yield* reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
    assert.equal(
      yield* reopened.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      PROVIDER_ID.CODEX,
    );
  }),
);

storeTest("skips a guarded account preference apply after account sign-out", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    const account = {
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      email: "developer@example.com",
      name: "Developer",
      provider: "github" as const,
    };
    yield* store.setAccount(account);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "local-project");
    const expected = yield* store.accountPreferences();

    yield* store.clearAccount();
    const result = yield* store.applyAccountPreferences(
      { voice: LIVE_VOICE.MARIN },
      { accountEmail: account.email, preferences: expected },
    );

    assert.deepEqual(result.changed, []);
    assert.equal(yield* store.get(APP_SETTING_SCHEMA.voice.field), undefined);
    assert.equal(yield* readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
    assert.equal(yield* store.accountPreferencesSyncBaseline(account.email), undefined);
  }),
);

storeTest("stores a deleted talk key as the none token and reads it back", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    const { settings, reason } = yield* store.set(
      APP_SETTING_SCHEMA.voiceHotkey.field,
      VOICE_HOTKEY_NONE,
    );

    assert.equal(reason, undefined);
    // A deletion is a choice, not an absence: unlike a reset it survives the
    // file being reopened, or the key would come back on the next launch.
    assert.equal(appSettingsView(settings).voiceHotkey, VOICE_HOTKEY_NONE);
    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.voiceHotkey.field),
      VOICE_HOTKEY_NONE,
    );
  }),
);

storeTest("ignores a stored chord this build cannot register", () =>
  Effect.gen(function* () {
    for (const field of [
      APP_SETTING_SCHEMA.voiceHotkey.field,
      APP_SETTING_SCHEMA.stopHotkey.field,
    ]) {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      yield* writeSettingsFile(
        directory,
        JSON.stringify({ version: 2, apiKeys: {}, [field]: "F13" }),
      );
      const store = yield* storeIn(directory);

      // A hand-edited chord the registrars would refuse is dropped rather than
      // carried: honouring it would claim a key nothing was ever told about.
      assert.equal(yield* store.get(field), undefined, field);
      assert.equal(appSettingsView(yield* store.snapshot())[field], undefined, field);
    }
  }),
);

storeTest("a stored key and a chosen preference survive each other's writes", () =>
  Effect.gen(function* () {
    for (const field of APP_SETTING_FIELDS) {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory);

      yield* store.setApiKey(CONDUCTOR, TEST_API_KEY);
      yield* store.set(field, SAMPLE_VALUE[field]);
      yield* store.setApiKey(CONDUCTOR, "conductor-replacement-key");

      const reopened = yield* storeIn(directory);
      assert.equal(yield* readApiKey(reopened, CONDUCTOR), "conductor-replacement-key");
      assert.deepEqual(yield* reopened.get(field), SAMPLE_VALUE[field], `${field} did not survive`);
    }
  }),
);

storeTest("ignores a stored form this build does not draw", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({ version: 2, apiKeys: {}, formFactor: "hexagon" }),
    );

    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.formFactor.field),
      undefined,
    );
    assert.equal(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).formFactor,
      PANEL_FORM_FACTOR.BUBBLE,
    );
  }),
);

storeTest("ignores a stored default provider this build does not know", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({ version: 2, apiKeys: {}, defaultWorkspaceProvider: "someone-else" }),
    );

    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
      undefined,
    );
    assert.equal(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).defaultWorkspaceProvider,
      undefined,
    );
  }),
);

storeTest("lets the first creation choose each provider's project until one is chosen", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    // Unset on purpose, the provider default's own terms: the default is always
    // a choice the user made — by hand or by their first creation there.
    assert.equal(appSettingsView(yield* store.snapshot()).workspaceProjectDefaults, undefined);
    assert.equal(yield* readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);

    const { settings, reason } = yield* setWorkspaceProjectDefault(
      store,
      PROVIDER_ID.CONDUCTOR,
      "proj-1",
    );

    assert.equal(reason, undefined);
    assert.deepEqual(appSettingsView(settings).workspaceProjectDefaults, {
      [PROVIDER_ID.CONDUCTOR]: "proj-1",
    });
    // The choice outlives the run that heard it.
    assert.equal(
      yield* readWorkspaceProjectDefault(yield* storeIn(directory), PROVIDER_ID.CONDUCTOR),
      "proj-1",
    );

    // Clearing returns that one provider to its first creation choosing.
    const cleared = yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
    assert.equal(appSettingsView(cleared.settings).workspaceProjectDefaults, undefined);
    assert.equal(
      yield* readWorkspaceProjectDefault(yield* storeIn(directory), PROVIDER_ID.CONDUCTOR),
      undefined,
    );
  }),
);

storeTest("keeps one provider's default project apart from another's", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");
    const { settings } = yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2");

    assert.deepEqual(appSettingsView(settings).workspaceProjectDefaults, {
      [PROVIDER_ID.CONDUCTOR]: "proj-1",
      [PROVIDER_ID.CODEX]: "proj-2",
    });

    const cleared = yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
    assert.deepEqual(appSettingsView(cleared.settings).workspaceProjectDefaults, {
      [PROVIDER_ID.CODEX]: "proj-2",
    });
  }),
);

storeTest("forgetting a default no provider offers survives the reload it was written for", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-gone");
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2");

    // The write the observation pass makes when a provider stops offering the
    // project a default names. It has to reach the file, not just the snapshot:
    // the entry it forgets is one an earlier launch wrote.
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);

    assert.deepEqual(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).workspaceProjectDefaults,
      {
        [PROVIDER_ID.CODEX]: "proj-2",
      },
    );
    assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  }),
);

storeTest("a stale cleanup cannot clear a newer project default", () =>
  Effect.gen(function* () {
    const store = yield* storeIn(yield* temporaryDirectoryScoped("luke-settings-"));
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-old");
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-new");

    const stale = yield* store.clearEntryIfUnchanged(
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      PROVIDER_ID.CONDUCTOR,
      "proj-old",
    );

    assert.equal(stale.cleared, false);
    assert.equal(
      appSettingsView(stale.settings).workspaceProjectDefaults?.[PROVIDER_ID.CONDUCTOR],
      "proj-new",
    );
  }),
);

storeTest("overlapping default projects each survive the other's write", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    // Both start before either lands, the way two provider rows saved in quick
    // succession do. The merge belongs to the store for exactly this reason: a
    // caller holding the map it read before the first write would put that stale
    // copy back, and the later write would drop the other provider's choice.
    yield* Effect.all(
      [
        setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1"),
        setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2"),
      ],
      { concurrency: "unbounded" },
    );

    assert.deepEqual(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).workspaceProjectDefaults,
      {
        [PROVIDER_ID.CONDUCTOR]: "proj-1",
        [PROVIDER_ID.CODEX]: "proj-2",
      },
    );
  }),
);

storeTest("an overlapping clear forgets its own entry and no other", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");

    // A row cleared while another row is being saved forgets one entry, never
    // the map the clear was composed against.
    yield* Effect.all(
      [
        setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined),
        setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2"),
      ],
      { concurrency: "unbounded" },
    );

    assert.deepEqual(
      appSettingsView(yield* (yield* storeIn(directory)).snapshot()).workspaceProjectDefaults,
      {
        [PROVIDER_ID.CODEX]: "proj-2",
      },
    );
  }),
);

storeTest("ignores stored default projects this store cannot hold", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: {},
        workspaceProjectDefaults: {
          // A provider this build does not know, a value that is not an id at
          // all, an empty one, and one too long to be an id: each names nowhere
          // a creation ask could be steered.
          "someone-else": "proj-1",
          conductor: 7,
          cursor: "   ",
          codex: "x".repeat(501),
        },
      }),
    );

    const store = yield* storeIn(directory);
    assert.equal(yield* readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
    assert.equal(appSettingsView(yield* store.snapshot()).workspaceProjectDefaults, undefined);
  }),
);

storeTest("ignores a stored pairing this build's table does not list", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: {},
        workspaceAgentDefaults: {
          // A listed model under an effort its agent does not document, a
          // provider the table documents nothing for, and a provider this build
          // does not know: each names a request no endpoint takes.
          conductor: { agent: "claude", model: "sonnet", effort: "sideways" },
          cursor: { agent: "cursor", model: "composer-2.5" },
          "someone-else": { agent: "claude", model: "sonnet" },
        },
      }),
    );

    const store = yield* storeIn(directory);
    assert.equal(yield* readWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
    assert.equal(appSettingsView(yield* store.snapshot()).workspaceAgentDefaults, undefined);
  }),
);

test("a settings file whose top level is not an object is refused with the legacy reason", () => {
  const parsed = parsePersistedSettingsEither(JSON.stringify([1, 2, 3]));
  assert.equal(Result.isFailure(parsed), true);
  assert.deepEqual(
    Result.getFailure(parsed),
    Result.getFailure(
      Result.fail(new SettingsParseRefusal({ reason: "Settings file is not an object" })),
    ),
  );
});

storeTest("recovers from a corrupt settings file", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(directory, "{ not json");
    const store = yield* storeIn(directory);

    const { status, settings } = yield* store.setApiKey(CONDUCTOR, "conductor-stored-key");

    assert.equal(status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.ok(appSettingsView(settings));
    assert.equal(yield* readApiKey(store, CONDUCTOR), "conductor-stored-key");
  }),
);

storeTest("a voice reset forgets the voice, captions, and duck in one action", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.CEDAR);
    yield* store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);
    yield* store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

    const { settings, reason } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

    assert.equal(reason, undefined);
    assert.equal(appSettingsView(settings).voice, LIVE_DEFAULTS.VOICE);
    assert.equal(appSettingsView(settings).voiceCaptions, false);
    assert.equal(appSettingsView(settings).duckOtherMedia, true);
    // The choices are forgotten rather than restated, so a default that moves
    // in a later build moves these settings with it.
    assert.equal(yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.voice.field), undefined);
  }),
);

storeTest(
  "a voice reset returns to the environment's voice where one stands behind the choice",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory, {
        environment: { LUKE_LIVE_VOICE: LIVE_VOICE.SAGE },
      });
      yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);

      const { settings } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

      // Forgetting the choice is the reset's whole meaning: what stands afterwards
      // is whatever would have stood had none been made.
      assert.equal(appSettingsView(settings).voice, LIVE_VOICE.SAGE);
      assert.equal(yield* store.get(APP_SETTING_SCHEMA.voice.field), undefined);
    }),
);

storeTest("an appearance reset returns Luke's stances without touching the voice page", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* store.set(APP_SETTING_SCHEMA.showInDock.field, true);
    yield* store.set(APP_SETTING_SCHEMA.showOnAllDisplays.field, true);
    yield* store.set(APP_SETTING_SCHEMA.formFactor.field, PANEL_FORM_FACTOR.NOTCH);
    yield* store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);

    const { settings, reason } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE);

    assert.equal(reason, undefined);
    assert.equal(appSettingsView(settings).showInDock, false);
    assert.equal(appSettingsView(settings).showOnAllDisplays, false);
    assert.equal(appSettingsView(settings).formFactor, PANEL_FORM_FACTOR.BUBBLE);
    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.formFactor.field),
      undefined,
    );
    // One scope's reset is that scope's alone.
    assert.equal(appSettingsView(settings).voice, LIVE_VOICE.MARIN);
  }),
);

storeTest("a shortcuts reset forgets both chords at once", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);
    yield* store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Shift+Command+L");
    yield* store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

    const { settings, reason } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.SHORTCUTS);

    assert.equal(reason, undefined);
    assert.equal(appSettingsView(settings).voiceHotkey, undefined);
    assert.equal(appSettingsView(settings).stopHotkey, undefined);
    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.voiceHotkey.field),
      undefined,
    );
    assert.equal(
      yield* (yield* storeIn(directory)).get(APP_SETTING_SCHEMA.stopHotkey.field),
      undefined,
    );
  }),
);

storeTest(
  "a workspaces reset forgets the provider and project defaults but never the agent pairing",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("luke-settings-");
      const store = yield* storeIn(directory);
      const pairing = { agent: "claude", model: "sonnet" };
      yield* store.set(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field, PROVIDER_ID.CONDUCTOR);
      yield* setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");
      yield* setWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR, pairing);

      const { settings, reason } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.WORKSPACES);

      assert.equal(reason, undefined);
      assert.equal(appSettingsView(settings).defaultWorkspaceProvider, undefined);
      assert.equal(appSettingsView(settings).workspaceProjectDefaults, undefined);
      // Agent choices live on their provider rows, whose own menus offer the
      // defaults — no reset here may reach either one.
      assert.deepEqual(appSettingsView(settings).workspaceAgentDefaults, {
        [PROVIDER_ID.CONDUCTOR]: pairing,
      });
    }),
);

storeTest("a reset of settings already at their defaults writes nothing", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const store = yield* storeIn(directory);

    const { settings, reason } = yield* store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

    assert.equal(reason, undefined);
    assert.equal(appSettingsView(settings).voice, LIVE_DEFAULTS.VOICE);
    // Nothing changed, so no file was created — the same silence every setter
    // keeps when asked for the value it already holds.
    yield* Effect.flip(readSettingsFile(directory));
  }),
);

storeTest("a reset never touches the cipher", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    const cipher = countingCipher();
    const store = yield* storeIn(directory, { cipher });
    yield* store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);

    yield* store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

    // A preference is not a credential, so resetting a page of them never
    // reaches the Keychain — and never raises its permission dialog.
    assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  }),
);

storeTest("a reset leaves a stored key standing", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-settings-");
    yield* writeSettingsFile(
      directory,
      JSON.stringify({
        version: 2,
        apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
        voiceCaptions: true,
        duckOtherMedia: true,
        preferBuiltInMicrophone: true,
        showInDock: false,
        showOnAllDisplays: false,
      }),
    );
    const store = yield* storeIn(directory);

    yield* store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

    // No scope reaches a credential: the ciphertext rides the write untouched.
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    const contents = JSON.parse(yield* readSettingsFile(directory)) as {
      apiKeys: Record<string, string>;
      voiceCaptions: boolean;
    };
    assert.deepEqual(contents.apiKeys, { [CONDUCTOR]: sealed(TEST_API_KEY) });
    assert.equal(contents.voiceCaptions, false);
    assert.equal(yield* readApiKey(store, CONDUCTOR), TEST_API_KEY);
  }),
);

/** Concurrent reads share one read of the file rather than each making their own. */
storeTest("concurrent reads of an unread store read the file once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      let directoryReads = 0;
      const store = new SettingsStore({
        ...(yield* storeOptions(directory)),
        directory: () => {
          directoryReads += 1;
          return directory;
        },
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
  ),
);
