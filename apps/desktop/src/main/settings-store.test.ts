import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  type CredentialProvider,
  type CredentialProviderId,
} from "@sidecar/credentials";
import { REALTIME_DEFAULTS, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import {
  PROVIDER_ID,
  type ProviderId,
  SESSION_FILTER,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  isKeyedAppSettingField,
  settingEntryGuard,
  VOICE_HOTKEY_NONE,
} from "@sidecar/settings";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { type UnparsedWireValue, unparsedWire, type WireRecord } from "@sidecar/wire";
import {
  ACCOUNT_STATUS,
  appSettingsView,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  SETTINGS_RESET_SCOPE,
  VOICE_SOURCE,
} from "#shared/contracts";
import { type SecretCipher, SettingsStore, type SettingsStoreOptions } from "./settings-store";

const TEST_API_KEY = "conductor-live-key";
const SETTINGS_FILE_NAME = "settings.json";
const CIPHER_PREFIX = "sealed:";
const CONDUCTOR = CREDENTIAL_PROVIDER_ID.CONDUCTOR;

const TEST_ENVIRONMENT_VARIABLE = {
  API_KEY: "CONDUCTOR_API_KEY",
  API_TOKEN: "CONDUCTOR_API_TOKEN",
  FIRST_CLOUD_API_KEY: "FIRST_CLOUD_API_KEY",
  SECOND_CLOUD_API_KEY: "SECOND_CLOUD_API_KEY",
  THIRD_CLOUD_API_KEY: "THIRD_CLOUD_API_KEY",
} as const;

/**
 * Two providers the registry does not ship, so per-provider behavior is covered
 * without waiting for a second cloud adapter to exist.
 */
const FIRST_CLOUD_PROVIDER: CredentialProvider = {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  id: "first-cloud" as CredentialProviderId,
  displayName: "First Cloud",
  connection: CREDENTIAL_CONNECTION.KEY,
  hint: "Create a key in First Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.FIRST_CLOUD_API_KEY],
};

const SECOND_CLOUD_PROVIDER: CredentialProvider = {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  id: "second-cloud" as CredentialProviderId,
  displayName: "Second Cloud",
  connection: CREDENTIAL_CONNECTION.KEY,
  hint: "Create a key in Second Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.SECOND_CLOUD_API_KEY],
};

/** Publishes a key format, which only some providers do. */
const THIRD_CLOUD_PROVIDER: CredentialProvider = {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  id: "third-cloud" as CredentialProviderId,
  displayName: "Third Cloud",
  connection: CREDENTIAL_CONNECTION.KEY,
  hint: "Create a key in Third Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.THIRD_CLOUD_API_KEY],
  keyFormat: {
    label: "API key",
    prefix: "current_",
    rejection: "Third Cloud's current keys start with current_.",
  },
};

/** Connected on the provider's own consent page rather than by a pasted key. */
const CONSENT_PROVIDER: CredentialProvider = {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  id: "consent-service" as CredentialProviderId,
  displayName: "Consent Service",
  connection: CREDENTIAL_CONNECTION.CONSENT,
  environmentVariables: [],
};

const TEST_PROVIDERS = [
  FIRST_CLOUD_PROVIDER,
  SECOND_CLOUD_PROVIDER,
  THIRD_CLOUD_PROVIDER,
  CONSENT_PROVIDER,
];
const CONSENT_SERVICE = CONSENT_PROVIDER.id;
const FIRST_CLOUD = FIRST_CLOUD_PROVIDER.id;
const SECOND_CLOUD = SECOND_CLOUD_PROVIDER.id;
const THIRD_CLOUD = THIRD_CLOUD_PROVIDER.id;

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

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-settings-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function storeIn(
  directory: string,
  options: {
    cipher?: SecretCipher;
    environment?: NodeJS.ProcessEnv;
    providers?: readonly CredentialProvider[];
    appleCalendarSupported?: boolean;
  } = {},
): SettingsStore {
  const config: SettingsStoreOptions = {
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    environment: options.environment ?? {},
  };
  if (options.providers) {
    config.providers = options.providers;
  }
  if (options.appleCalendarSupported !== undefined) {
    config.appleCalendarSupported = options.appleCalendarSupported;
  }
  return new SettingsStore(config);
}

test("a failed first load is retried before a later write", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
      showInDock: true,
    }),
  );
  let directoryReads = 0;
  const store = new SettingsStore({
    directory: () => {
      directoryReads += 1;
      if (directoryReads === 1) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return directory;
    },
    cipher: testCipher(),
    environment: {},
  });

  await assert.rejects(store.get(APP_SETTING_SCHEMA.showInDock.field), /permission denied/);
  await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), TEST_API_KEY);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.duckOtherMedia.field), false);
});

async function readWorkspaceAgentDefault(store: SettingsStore, providerId: ProviderId) {
  return (await store.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[providerId];
}

async function setWorkspaceAgentDefault(
  store: SettingsStore,
  providerId: ProviderId,
  selection: WorkspaceAgentSelection | undefined,
) {
  return store.setEntry(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, providerId, selection);
}

async function readWorkspaceProjectDefault(store: SettingsStore, providerId: ProviderId) {
  return (await store.get(APP_SETTING_SCHEMA.workspaceProjectDefaults.field))?.[providerId];
}

async function setWorkspaceProjectDefault(
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

async function readSettingsFile(directory: string): Promise<string> {
  return fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8");
}

test("stores an API key encrypted, private to the owner, and never in a snapshot", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  const { settings, reason } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  const contents = await readSettingsFile(directory);
  const stats = await fs.stat(path.join(directory, SETTINGS_FILE_NAME));

  assert.equal(reason, undefined);
  assert.equal(
    appSettingsView(settings).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.AVAILABLE);
  assert.equal(contents.includes(TEST_API_KEY), false, "the key was written in plaintext");
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(JSON.stringify(settings).includes(TEST_API_KEY), false);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("round-trips an encrypted account without exposing either token in snapshots", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  const account = {
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    email: "developer@example.com",
    name: "Developer",
    provider: "github" as const,
  };

  const snapshot = await store.setAccount(account);
  const contents = await readSettingsFile(directory);
  const reopened = storeIn(directory);

  assert.deepEqual(snapshot, {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: account.email,
    name: account.name,
    provider: account.provider,
  });
  assert.deepEqual(await reopened.readAccount(), account);
  assert.equal(contents.includes(account.accessToken), false);
  assert.equal(contents.includes(account.refreshToken), false);
  assert.equal(JSON.stringify(await reopened.accountSnapshot()).includes("token-secret"), false);
  assert.equal(
    JSON.stringify(appSettingsView(await reopened.snapshot())).includes("token-secret"),
    false,
  );
});

test("decrypts once and re-decrypts only after the key changes", async (t) => {
  // The observation timer reads the credential every few seconds, so decrypting
  // on each read would reach the OS keychain thousands of times a day.
  const directory = await temporaryDirectory(t);
  let decryptions = 0;
  const cipher = testCipher();
  const store = storeIn(directory, {
    cipher: {
      ...cipher,
      decrypt: (cipherText) => {
        decryptions += 1;
        return cipher.decrypt(cipherText);
      },
    },
  });
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  const afterStore = decryptions;
  for (let read = 0; read < 5; read += 1) await store.readApiKey(CONDUCTOR);
  const afterReads = decryptions;
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");
  await store.readApiKey(CONDUCTOR);

  assert.equal(afterReads, afterStore, "a repeated read decrypted again");
  assert.ok(decryptions > afterReads, "a replaced key was not re-read");
  assert.equal(await store.readApiKey(CONDUCTOR), "conductor-replacement-key");
});

test("reads a stored key back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  await storeIn(directory).setApiKey(CONDUCTOR, TEST_API_KEY);

  const reopened = storeIn(directory);

  assert.equal(await reopened.readApiKey(CONDUCTOR), TEST_API_KEY);
  assert.equal(
    appSettingsView(await reopened.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
});

test("clears a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  const { settings } = await store.setApiKey(CONDUCTOR, undefined);

  assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  assert.equal((await readSettingsFile(directory)).includes(CONDUCTOR), false);
});

test("captions are off until switched on, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference is not a credential, so choosing it must reach the Keychain
  // not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(appSettingsView(await store.snapshot()).voiceCaptions, false);
  const enabled = await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);

  assert.equal(appSettingsView(enabled.settings).voiceCaptions, true);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).voiceCaptions, true);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("switching captions never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);
  const off = await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, false);

  assert.equal(appSettingsView(off.settings).voiceCaptions, false);
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt captions value reads as off rather than switching them on", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voiceCaptions: "yes" }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).voiceCaptions, false);
});

test("other media is quieted until asked otherwise, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference is not a credential, so choosing it must reach the Keychain
  // not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(appSettingsView(await store.snapshot()).duckOtherMedia, true);
  const disabled = await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

  assert.equal(appSettingsView(disabled.settings).duckOtherMedia, false);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).duckOtherMedia, false);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("switching the media duck never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);
  const on = await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, true);

  assert.equal(appSettingsView(on.settings).duckOtherMedia, true);
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt media duck value reads as the default rather than as off", async (t) => {
  const directory = await temporaryDirectory(t);
  // The mirror of the captions rule: each lands on its own default, and this
  // one's default is on.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, duckOtherMedia: "no" }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).duckOtherMedia, true);
});

test("the microphone preference persists, defaults on, and shrugs off corruption", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).preferBuiltInMicrophone, true);
  const disabled = await store.set(APP_SETTING_SCHEMA.preferBuiltInMicrophone.field, false);

  assert.equal(appSettingsView(disabled.settings).preferBuiltInMicrophone, false);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).preferBuiltInMicrophone, false);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt microphone preference reads as the default rather than as off", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, preferBuiltInMicrophone: "no" }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).preferBuiltInMicrophone, true);
});

test("the session filter selection starts unset and survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A view preference is not a credential, so storing it must reach the
  // Keychain not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(appSettingsView(await store.snapshot()).sessionFilters, undefined);
  const chosen = [SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX];
  const narrowed = await store.set(APP_SETTING_SCHEMA.sessionFilters.field, chosen);

  assert.deepEqual(appSettingsView(narrowed.settings).sessionFilters, chosen);
  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).sessionFilters, chosen);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("clearing the session filter selection reads as unset after a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.sessionFilters.field, [SESSION_FILTER.CLOUD]);

  const cleared = await store.set(APP_SETTING_SCHEMA.sessionFilters.field, undefined);

  assert.equal(appSettingsView(cleared.settings).sessionFilters, undefined);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionFilters, undefined);
});

test("storing the session filter selection never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.set(APP_SETTING_SCHEMA.sessionFilters.field, [SESSION_FILTER.VOICE]);

  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stored selection keeps only the filters this build recognizes", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: {},
      sessionFilters: ["local", "a-future-builds-filter", 7, "local", PROVIDER_ID.CODEX],
    }),
    "utf8",
  );

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).sessionFilters, [
    SESSION_FILTER.LOCAL,
    PROVIDER_ID.CODEX,
  ]);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt session filter value reads as unset rather than narrowing the list", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, sessionFilters: "local" }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionFilters, undefined);
});

test("the session search query starts unset and survives a reopen as typed", async (t) => {
  const directory = await temporaryDirectory(t);
  // A view preference is not a credential, so storing it must reach the
  // Keychain not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(appSettingsView(await store.snapshot()).sessionSearchQuery, undefined);
  const held = await store.set(APP_SETTING_SCHEMA.sessionSearchQuery.field, "Fix CI  on main");

  assert.equal(appSettingsView(held.settings).sessionSearchQuery, "Fix CI  on main");
  assert.equal(
    appSettingsView(await storeIn(directory).snapshot()).sessionSearchQuery,
    "Fix CI  on main",
  );
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("clearing the session search query reads as unset after a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.sessionSearchQuery.field, "conductor");

  const cleared = await store.set(APP_SETTING_SCHEMA.sessionSearchQuery.field, undefined);

  assert.equal(appSettingsView(cleared.settings).sessionSearchQuery, undefined);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionSearchQuery, undefined);
});

test("storing the session search query never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.set(APP_SETTING_SCHEMA.sessionSearchQuery.field, "review");

  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stored query of nothing but whitespace reads as unset rather than narrowing", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, sessionSearchQuery: "   " }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionSearchQuery, undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt session search query reads as unset rather than refilling the field", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, sessionSearchQuery: 7 }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionSearchQuery, undefined);
});

test("a calendar account stores its grant encrypted and survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.deepEqual(await store.readCalendarAccounts(), []);
  const stored = await store.addCalendarAccount("dev@example.com", "1//grant-from-sign-in", [
    "dev@example.com",
  ]);

  assert.equal(stored.reason, undefined);
  assert.deepEqual(appSettingsView(stored.settings).calendarAccounts, [
    { id: "dev@example.com", selectedCalendarIds: ["dev@example.com"] },
  ]);
  // At rest the grant is ciphertext, never the plain token.
  const persisted = JSON.parse(await readSettingsFile(directory));
  assert.equal(persisted.calendarAccounts[0].token, sealed("1//grant-from-sign-in"));
  assert.ok(!JSON.stringify(persisted).includes("1//grant-from-sign-in"));
  // The account outlives the run that stored it, grant and choices together.
  assert.deepEqual(await storeIn(directory).readCalendarAccounts(), [
    {
      id: "dev@example.com",
      refreshToken: "1//grant-from-sign-in",
      selectedCalendarIds: ["dev@example.com"],
    },
  ]);
});

test("accounts stand side by side, and reconnecting one keeps its choices", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.addCalendarAccount("work@example.com", "1//work-grant", ["work@example.com"]);
  await store.addCalendarAccount("home@example.com", "1//home-grant", ["home@example.com"]);
  await store.setCalendarSelected("work@example.com", "team-calendar", true);
  // Signing into work again replaces the grant, not the user's choices.
  await store.addCalendarAccount("work@example.com", "1//fresh-work-grant", ["work@example.com"]);

  const accounts = await store.readCalendarAccounts();
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
});

test("selection changes one calendar on one account, and removal takes the grant with it", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);

  await store.setCalendarSelected("dev@example.com", "team-calendar", true);
  await store.setCalendarSelected("dev@example.com", "dev@example.com", false);
  const unknown = await store.setCalendarSelected("nobody@example.com", "team-calendar", true);
  assert.equal(unknown.reason, "That calendar account is not connected.");

  assert.deepEqual((await store.readCalendarAccounts())[0]?.selectedCalendarIds, ["team-calendar"]);

  const removed = await store.removeCalendarAccount("dev@example.com");
  assert.deepEqual(appSettingsView(removed.settings).calendarAccounts, []);
  assert.deepEqual(await store.readCalendarAccounts(), []);
  // Nothing empty is written down: a file with no accounts carries no field.
  assert.equal(JSON.parse(await readSettingsFile(directory)).calendarAccounts, undefined);
});

test("the Apple Calendar connection stores only the choice and survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { appleCalendarSupported: true });

  assert.equal(await store.readAppleCalendarConnection(), undefined);
  assert.equal(appSettingsView(await store.snapshot()).appleCalendar, undefined);
  assert.equal(appSettingsView(await store.snapshot()).appleCalendarAvailable, true);

  const connected = await store.connectAppleCalendar(["home", "work"]);
  assert.equal(connected.reason, undefined);
  assert.deepEqual(appSettingsView(connected.settings).appleCalendar, {
    id: "apple-calendar",
    selectedCalendarIds: ["home", "work"],
  });
  // Nothing secret is at rest: the file carries the choice and no token, so
  // nothing here ever reaches the cipher.
  const persisted = JSON.parse(await readSettingsFile(directory));
  assert.deepEqual(persisted.appleCalendar, { calendars: ["home", "work"] });
  // The connection outlives the run that stored it.
  assert.deepEqual(
    await storeIn(directory, { appleCalendarSupported: true }).readAppleCalendarConnection(),
    { selectedCalendarIds: ["home", "work"] },
  );
});

test("connecting Apple Calendar again keeps the held choices, and selection edits them", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { appleCalendarSupported: true });
  await store.connectAppleCalendar(["default-calendar"]);
  // Asking to connect while connected is not a fresh mind about the choices.
  await store.connectAppleCalendar(["another"]);
  // The Apple selection goes through the same door as every account's,
  // routed by the fixed id, so callers never learn it is stored apart.
  await store.setCalendarSelected("apple-calendar", "team", true);
  await store.setCalendarSelected("apple-calendar", "default-calendar", false);
  assert.deepEqual(await store.readAppleCalendarConnection(), { selectedCalendarIds: ["team"] });

  const disconnected = await store.disconnectAppleCalendar();
  assert.equal(appSettingsView(disconnected.settings).appleCalendar, undefined);
  assert.equal(await store.readAppleCalendarConnection(), undefined);
  const idle = await store.setCalendarSelected("apple-calendar", "team", true);
  assert.equal(idle.reason, "Apple Calendar is not connected.");
  // Nothing empty is written down: a disconnected file carries no field.
  assert.equal(JSON.parse(await readSettingsFile(directory)).appleCalendar, undefined);
});

test("Apple Calendar is not offered where there is no Mac calendar to read", async (t) => {
  const directory = await temporaryDirectory(t);
  const snapshot = await storeIn(directory, { appleCalendarSupported: false }).snapshot();
  assert.equal(appSettingsView(snapshot).appleCalendarAvailable, false);
});

test("a calendar account never disturbs a stored key, nor a key an account", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);
  await store.setApiKey(CONDUCTOR, undefined);

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), undefined);
  assert.equal((await reopened.readCalendarAccounts()).length, 1);
});

test("announcements wait out meetings until asked otherwise, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference is not a credential, so choosing it must reach the Keychain
  // not at all — and the shallow reader main asks on every announcement pass
  // must answer from the file alone.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(appSettingsView(await store.snapshot()).quietDuringMeetings, true);
  assert.equal(await store.get(APP_SETTING_SCHEMA.quietDuringMeetings.field), true);
  const disabled = await store.set(APP_SETTING_SCHEMA.quietDuringMeetings.field, false);

  assert.equal(appSettingsView(disabled.settings).quietDuringMeetings, false);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.quietDuringMeetings.field), false);
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).quietDuringMeetings, false);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("switching the meeting quiet never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.set(APP_SETTING_SCHEMA.quietDuringMeetings.field, false);
  const on = await store.set(APP_SETTING_SCHEMA.quietDuringMeetings.field, true);

  assert.equal(appSettingsView(on.settings).quietDuringMeetings, true);
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a corrupt meeting quiet value reads as the default rather than as off", async (t) => {
  const directory = await temporaryDirectory(t);
  // The media duck's rule: this one's default is on, so nonsense lands on on.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, quietDuringMeetings: "no" }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).quietDuringMeetings, true);
});

test("keeps each provider's key, environment fallback, and reported source separate", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    providers: TEST_PROVIDERS,
    environment: { [TEST_ENVIRONMENT_VARIABLE.SECOND_CLOUD_API_KEY]: "second-cloud-environment" },
  });

  await store.setApiKey(FIRST_CLOUD, "first-cloud-key");
  const settings = appSettingsView(await store.snapshot());

  assert.equal(settings.credentialSources[FIRST_CLOUD], CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(settings.credentialSources[SECOND_CLOUD], CREDENTIAL_SOURCE.ENVIRONMENT);
  assert.equal(await store.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.equal(await store.readApiKey(SECOND_CLOUD), "second-cloud-environment");

  // Storing and then clearing one provider's key leaves the other untouched.
  await store.setApiKey(SECOND_CLOUD, "second-cloud-key");
  assert.equal(await store.readApiKey(FIRST_CLOUD), "first-cloud-key");
  await store.setApiKey(FIRST_CLOUD, undefined);

  assert.equal(await store.readApiKey(SECOND_CLOUD), "second-cloud-key");
  assert.equal(await store.readApiKey(FIRST_CLOUD), undefined);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[FIRST_CLOUD],
    CREDENTIAL_SOURCE.NONE,
    "a provider with no key must report nothing",
  );
});

test("keeps both keys when two providers are saved at once", async (t) => {
  // Each settings row carries its own busy flag, so a user with more than one
  // provider can start a second save before the first has landed.
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: TEST_PROVIDERS });

  await Promise.all([
    store.setApiKey(FIRST_CLOUD, "first-cloud-key"),
    store.setApiKey(SECOND_CLOUD, "second-cloud-key"),
  ]);

  assert.equal(await store.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.equal(await store.readApiKey(SECOND_CLOUD), "second-cloud-key");
  assert.deepEqual(
    JSON.parse(await readSettingsFile(directory)),
    expectedPersistedSettings({
      apiKeys: {
        [FIRST_CLOUD]: sealed("first-cloud-key"),
        [SECOND_CLOUD]: sealed("second-cloud-key"),
      },
    }),
  );
  const reopened = storeIn(directory, { providers: TEST_PROVIDERS });
  assert.equal(await reopened.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.equal(await reopened.readApiKey(SECOND_CLOUD), "second-cloud-key");
});

test("reports nothing for a provider this store does not know", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: [FIRST_CLOUD_PROVIDER] });

  assert.equal(await store.readApiKey(SECOND_CLOUD), undefined);
  assert.equal(appSettingsView(await store.snapshot()).credentialSources[SECOND_CLOUD], undefined);
});

test("falls back to an API key from the environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_TOKEN]: `  ${TEST_API_KEY}  ` },
  });

  const settings = appSettingsView(await store.snapshot());

  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENVIRONMENT);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("prefers a stored key over one from the environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment-key" },
  });
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("rejects a key that cannot be sent as an authorization header", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.match((await store.setApiKey(CONDUCTOR, "short")).reason ?? "", /too short/);
  assert.match((await store.setApiKey(CONDUCTOR, "key with spaces")).reason ?? "", /unsupported/);
  assert.match((await store.setApiKey(CONDUCTOR, "k".repeat(513))).reason ?? "", /too long/);
  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("holds a key only in the form its provider says it issues", async (t) => {
  // A credential in a form the provider no longer accepts would be refused on
  // the first request, and a key Luke cannot use is worth saying so about
  // rather than storing and then going quiet.
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    providers: TEST_PROVIDERS,
    environment: { [TEST_ENVIRONMENT_VARIABLE.THIRD_CLOUD_API_KEY]: "legacy-third-cloud-key" },
  });

  const refused = await store.setApiKey(THIRD_CLOUD, "legacy-third-cloud-key");

  assert.match(refused.reason ?? "", /start with current_/);
  assert.equal(await store.readApiKey(THIRD_CLOUD), undefined);
  // The same rule holds a key read from the environment, so a shell profile is
  // not a way around it.
  assert.equal(
    appSettingsView(refused.settings).credentialSources[THIRD_CLOUD],
    CREDENTIAL_SOURCE.NONE,
  );

  const accepted = await store.setApiKey(THIRD_CLOUD, "current_third-cloud-key");
  assert.equal(accepted.reason, undefined);
  assert.equal(await store.readApiKey(THIRD_CLOUD), "current_third-cloud-key");
  // A provider that publishes no format still takes whatever it issues.
  assert.equal((await store.setApiKey(FIRST_CLOUD, "legacy-third-cloud-key")).reason, undefined);
});

test("stops honouring a stored key the moment its provider names a form it is not", async (t) => {
  // The rule arrived after the key did, so the key was stored under an older
  // build that had no format to hold it to.
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: { [THIRD_CLOUD]: sealed("legacy-third-cloud-key") } }),
  );

  const store = storeIn(directory, { providers: TEST_PROVIDERS });

  assert.equal(await store.readApiKey(THIRD_CLOUD), undefined);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[THIRD_CLOUD],
    CREDENTIAL_SOURCE.NONE,
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    "a key the provider no longer accepts must not read as connected",
  );
});

test("refuses to store a key when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { cipher: testCipher(false) });

  const { settings, reason } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.match(reason ?? "", /unavailable/);
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNAVAILABLE);
  assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("asks the cipher nothing on a launch with no key to protect", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const settings = appSettingsView(await store.snapshot());

  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  // Nothing has asked, so nothing is claimed either way.
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("asks the cipher nothing to clear a key", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.setApiKey(CONDUCTOR, undefined);

  assert.equal(reason, undefined);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("asks once when a key is stored and reports that answer from then on", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  const afterwards = appSettingsView(await store.snapshot());
  await store.setApiKey(CONDUCTOR, `${TEST_API_KEY}-rotated`);

  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.AVAILABLE);
  assert.equal(afterwards.secretStorage, SECRET_STORAGE.AVAILABLE);
  // Once per run, however many keys pass through it.
  assert.equal(cipher.calls.isAvailable, 1);
});

test("decrypts a stored key without asking whether storage is available", async (t) => {
  const directory = await temporaryDirectory(t);
  await storeIn(directory).setApiKey(CONDUCTOR, TEST_API_KEY);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
  // Recovering a key the user has is the one reason to reach the Keychain on a
  // launch, and it is reason enough on its own.
  assert.equal(cipher.calls.decrypt, 1);
  assert.equal(cipher.calls.isAvailable, 0);
});

test("ignores a stored key that can no longer be decrypted", async (t) => {
  const directory = await temporaryDirectory(t);
  await storeIn(directory).setApiKey(CONDUCTOR, TEST_API_KEY);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: { [CONDUCTOR]: Buffer.from("rotated").toString("base64") },
    }),
  );

  const store = storeIn(directory);

  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.NONE,
  );
});

test("keeps a Conductor key stored by an earlier version working", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 1, conductorApiKey: sealed(TEST_API_KEY) }),
  );
  const store = storeIn(directory);

  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );

  // The migrated key moves under its provider id the next time settings are
  // written, and the version 1 field does not survive that write.
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");
  const persisted: unknown = JSON.parse(await readSettingsFile(directory));

  assert.deepEqual(
    persisted,
    expectedPersistedSettings({
      apiKeys: { [CONDUCTOR]: sealed("conductor-replacement-key") },
    }),
  );
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), "conductor-replacement-key");
});

test("carries a key belonging to a provider this build does not know", async (t) => {
  // A file written by a newer build must not lose credentials to an older one.
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: { "later-cloud": sealed("later-cloud-key") } }),
  );

  await storeIn(directory).setApiKey(CONDUCTOR, TEST_API_KEY);
  const persisted: unknown = JSON.parse(await readSettingsFile(directory));

  assert.deepEqual(
    persisted,
    expectedPersistedSettings({
      apiKeys: { "later-cloud": sealed("later-cloud-key"), [CONDUCTOR]: sealed(TEST_API_KEY) },
    }),
  );
});

test("drops the retired menu bar preference on the next settings write", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showInMenuBar: false }),
  );
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.showInDock.field, true);

  const persisted = JSON.parse(await readSettingsFile(directory));
  assert.equal(persisted.showInMenuBar, undefined);
  assert.equal(persisted.showInDock, true);
});

test("keeps Luke out of the Dock until asked, and remembers the answer", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).showInDock, false);

  const { settings, reason } = await store.set(APP_SETTING_SCHEMA.showInDock.field, true);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).showInDock, true);
  assert.deepEqual(
    JSON.parse(await readSettingsFile(directory)),
    expectedPersistedSettings({
      showInDock: true,
    }),
  );
  // The choice outlives the run that heard it.
  assert.equal(appSettingsView(await storeIn(directory).snapshot()).showInDock, true);
});

test("changes the Dock preference without touching the cipher", async (t) => {
  // A preference is not a credential, so storing one must never be the reason
  // the Keychain dialog appears.
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.set(APP_SETTING_SCHEMA.showInDock.field, true);

  assert.equal(appSettingsView(settings).showInDock, true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("decides the Dock icon from the file alone, never the keychain", async (t) => {
  // The icon is drawn at launch from this answer, so a locked or slow
  // Keychain — which decrypting a stored key can wait on — must not be able to
  // delay it.
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
      showInDock: true,
    }),
  );
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("keeps Luke out of the Dock when the file says something a boolean is not", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showInDock: "always" }),
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).showInDock, false);
});

test("reports the default voice until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
});

test("stores the chosen voice plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.voice.field,
    REALTIME_VOICE.MARIN,
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voice, REALTIME_VOICE.MARIN);
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voice.field), REALTIME_VOICE.MARIN);
});

test("prefers the chosen voice over the environment, and the environment over the default", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { LUKE_REALTIME_VOICE: REALTIME_VOICE.SAGE },
  });

  assert.equal(appSettingsView(await store.snapshot()).voice, REALTIME_VOICE.SAGE);
  // The environment names the voice only until the user does, so it is
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // reported in the snapshot but never as something the user stored.
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);

  await store.set(APP_SETTING_SCHEMA.voice.field, REALTIME_VOICE.MARIN);
  assert.equal(appSettingsView(await store.snapshot()).voice, REALTIME_VOICE.MARIN);

  await store.set(APP_SETTING_SCHEMA.voice.field, undefined);
  assert.equal(appSettingsView(await store.snapshot()).voice, REALTIME_VOICE.SAGE);
});

test("ignores a stored or environment voice this build does not offer", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voice: "baritone" }),
  );
  const store = storeIn(directory, { environment: { LUKE_REALTIME_VOICE: "baritone" } });

  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).voice, REALTIME_DEFAULTS.VOICE);
});

test("reports the natural pace until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).voiceSpeed, REALTIME_DEFAULTS.SPEED);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voiceSpeed.field), undefined);
});

test("stores the chosen pace plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.voiceSpeed.field,
    REALTIME_VOICE_SPEED.QUICK,
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voiceSpeed, REALTIME_VOICE_SPEED.QUICK);
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.voiceSpeed.field),
    REALTIME_VOICE_SPEED.QUICK,
  );
});

test("prefers the chosen pace over the environment, and the environment over the default", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { LUKE_REALTIME_SPEED: String(REALTIME_VOICE_SPEED.SLOW) },
  });

  assert.equal(appSettingsView(await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.SLOW);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voiceSpeed.field), undefined);

  await store.set(APP_SETTING_SCHEMA.voiceSpeed.field, REALTIME_VOICE_SPEED.FAST);
  assert.equal(appSettingsView(await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.FAST);

  await store.set(APP_SETTING_SCHEMA.voiceSpeed.field, undefined);
  assert.equal(appSettingsView(await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.SLOW);
});

test("ignores a stored or environment pace this build does not offer", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voiceSpeed: 3 }),
  );
  const store = storeIn(directory, { environment: { LUKE_REALTIME_SPEED: "0.1" } });

  assert.equal(await store.get(APP_SETTING_SCHEMA.voiceSpeed.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).voiceSpeed, REALTIME_DEFAULTS.SPEED);
});

test("reports no talk-key chord until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(await store.get(APP_SETTING_SCHEMA.voiceHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).voiceHotkey, undefined);
});

test("stores the chosen talk-key chord plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.voiceHotkey.field,
    "Shift+Command+L",
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voiceHotkey, "Shift+Command+L");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.voiceHotkey.field),
    "Shift+Command+L",
  );
});

test("clearing the talk-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Shift+Command+L");
  const { settings } = await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, undefined);

  assert.equal(appSettingsView(settings).voiceHotkey, undefined);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voiceHotkey.field), undefined);
});

test("stores a deleted talk key as the none token and reads it back", async (t) => {
  const directory = await temporaryDirectory(t);
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

test("ignores a stored talk-key chord this build cannot register", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voiceHotkey: "F13" }),
  );
  const store = storeIn(directory);

  // A hand-edited chord the registrars would refuse is dropped rather than
  // carried: honouring it would claim a key nothing was ever told about.
  assert.equal(await store.get(APP_SETTING_SCHEMA.voiceHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).voiceHotkey, undefined);
});

test("stores the chosen ask-key chord on the talk key's terms and reads it back", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.get(APP_SETTING_SCHEMA.askHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).askHotkey, undefined);

  const { settings, reason } = await store.set(APP_SETTING_SCHEMA.askHotkey.field, "Control+Alt+K");

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).askHotkey, "Control+Alt+K");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.askHotkey.field), "Control+Alt+K");
});

test("clearing the ask-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.askHotkey.field, "Control+Alt+K");
  const { settings } = await store.set(APP_SETTING_SCHEMA.askHotkey.field, undefined);

  assert.equal(appSettingsView(settings).askHotkey, undefined);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.askHotkey.field), undefined);
});

test("ignores a stored ask-key chord this build cannot register", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, askHotkey: "F13" }),
  );
  const store = storeIn(directory);

  // A hand-edited chord the registrar would refuse is dropped rather than
  // carried: honouring it would claim a key nothing was ever told about.
  assert.equal(await store.get(APP_SETTING_SCHEMA.askHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).askHotkey, undefined);
});

test("stores the chosen stop-key chord on the other keys' terms and reads it back", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.get(APP_SETTING_SCHEMA.stopHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).stopHotkey, undefined);

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.stopHotkey.field,
    "Control+Alt+X",
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).stopHotkey, "Control+Alt+X");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.stopHotkey.field), "Control+Alt+X");
});

test("clearing the stop-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");
  const { settings } = await store.set(APP_SETTING_SCHEMA.stopHotkey.field, undefined);

  assert.equal(appSettingsView(settings).stopHotkey, undefined);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.stopHotkey.field), undefined);
});

test("ignores a stored stop-key chord this build cannot register", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, stopHotkey: "F13" }),
  );
  const store = storeIn(directory);

  // A hand-edited chord the registrar would refuse is dropped rather than
  // carried: honouring it would claim a key nothing was ever told about.
  assert.equal(await store.get(APP_SETTING_SCHEMA.stopHotkey.field), undefined);
  assert.equal(appSettingsView(await store.snapshot()).stopHotkey, undefined);
});

test("the three Luke keys survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Control+Alt+Space");
  await store.set(APP_SETTING_SCHEMA.askHotkey.field, "Control+Alt+K");
  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), "Control+Alt+Space");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.askHotkey.field), "Control+Alt+K");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.stopHotkey.field), "Control+Alt+X");
});

test("the talk-key chord and a stored key survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Control+Alt+Space");
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-replacement-key");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), "Control+Alt+Space");
});

test("keeps Luke to the main display until asked, and remembers the answer", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).showOnAllDisplays, false);
  assert.equal(await store.get(APP_SETTING_SCHEMA.showOnAllDisplays.field), false);

  const { settings, reason } = await store.set(APP_SETTING_SCHEMA.showOnAllDisplays.field, true);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).showOnAllDisplays, true);
  // The choice outlives the run that heard it.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.showOnAllDisplays.field), true);
});

test("changes the displays preference without touching the cipher", async (t) => {
  // A preference is not a credential, so storing one must never be the reason
  // the Keychain dialog appears.
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.set(APP_SETTING_SCHEMA.showOnAllDisplays.field, true);

  assert.equal(appSettingsView(settings).showOnAllDisplays, true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("keeps Luke to the main display when the file says something a boolean is not", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showOnAllDisplays: "every one of them" }),
  );

  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.showOnAllDisplays.field), false);
});

test("draws the bubble until a form is chosen, and remembers the choice", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).formFactor, PANEL_FORM_FACTOR.BUBBLE);
  assert.equal(await store.get(APP_SETTING_SCHEMA.formFactor.field), undefined);

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.formFactor.field,
    PANEL_FORM_FACTOR.NOTCH,
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).formFactor, PANEL_FORM_FACTOR.NOTCH);
  // The choice outlives the run that heard it.
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.formFactor.field),
    PANEL_FORM_FACTOR.NOTCH,
  );
});

test("changes the form without touching the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.set(
    APP_SETTING_SCHEMA.formFactor.field,
    PANEL_FORM_FACTOR.NOTCH,
  );

  assert.equal(appSettingsView(settings).formFactor, PANEL_FORM_FACTOR.NOTCH);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("ignores a stored form this build does not draw", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, formFactor: "hexagon" }),
  );

  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.formFactor.field), undefined);
  assert.equal(
    appSettingsView(await storeIn(directory).snapshot()).formFactor,
    PANEL_FORM_FACTOR.BUBBLE,
  );
});

test("asks each time until a default workspace provider is chosen, and remembers the choice", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  // Unset on purpose: the default is always a choice the user made — by hand
  // or by their first creation — never one made for them.
  assert.equal(appSettingsView(await store.snapshot()).defaultWorkspaceProvider, undefined);
  assert.equal(await store.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field), undefined);

  const { settings, reason } = await store.set(
    APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
    PROVIDER_ID.CONDUCTOR,
  );

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).defaultWorkspaceProvider, PROVIDER_ID.CONDUCTOR);
  // The choice outlives the run that heard it.
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
    PROVIDER_ID.CONDUCTOR,
  );

  // Clearing is returning to asking each time, not storing an answer.
  const cleared = await store.set(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field, undefined);
  assert.equal(appSettingsView(cleared.settings).defaultWorkspaceProvider, undefined);
  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
    undefined,
  );
});

test("changes the default workspace provider without touching the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.set(
    APP_SETTING_SCHEMA.defaultWorkspaceProvider.field,
    PROVIDER_ID.CURSOR,
  );

  assert.equal(appSettingsView(settings).defaultWorkspaceProvider, PROVIDER_ID.CURSOR);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("ignores a stored default provider this build does not know", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, defaultWorkspaceProvider: "someone-else" }),
  );

  assert.equal(
    await storeIn(directory).get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
    undefined,
  );
  assert.equal(
    appSettingsView(await storeIn(directory).snapshot()).defaultWorkspaceProvider,
    undefined,
  );
});

test("stores Superset workspace and agent defaults without touching credentials", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field, "superset");
  await store.setEntry(APP_SETTING_SCHEMA.workspaceProjectDefaults.field, "superset", "project-1");
  const { settings } = await store.setEntry(
    APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
    "superset",
    { agent: "codex" },
  );

  assert.equal(appSettingsView(settings).defaultWorkspaceProvider, "superset");
  assert.equal(appSettingsView(settings).workspaceProjectDefaults?.superset, "project-1");
  assert.deepEqual(appSettingsView(settings).workspaceAgentDefaults?.superset, { agent: "codex" });
  assert.deepEqual(
    appSettingsView(await storeIn(directory).snapshot()).workspaceAgentDefaults?.superset,
    { agent: "codex" },
  );
});

test("folds a Superset agent default stored apart by an earlier build into the record", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, supersetAgentDefault: "codex" }),
  );

  const store = storeIn(directory);
  assert.deepEqual(appSettingsView(await store.snapshot()).workspaceAgentDefaults?.superset, {
    agent: "codex",
  });

  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);
  const written = JSON.parse(await fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8"));
  assert.equal(written.supersetAgentDefault, undefined);
  assert.deepEqual(written.workspaceAgentDefaults, { superset: { agent: "codex" } });
});

test("a folded Superset entry outranks the legacy field it replaced", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: {},
      supersetAgentDefault: "codex",
      workspaceAgentDefaults: { superset: { agent: "claude-code" } },
    }),
  );

  assert.deepEqual(
    appSettingsView(await storeIn(directory).snapshot()).workspaceAgentDefaults?.superset,
    { agent: "claude-code" },
  );
});

test("ignores a legacy Superset agent default that is not an agent kind", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, supersetAgentDefault: "Not An Agent!" }),
  );

  assert.equal(
    appSettingsView(await storeIn(directory).snapshot()).workspaceAgentDefaults,
    undefined,
  );
});

test("starts new workspaces on the provider's defaults until a pairing is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(appSettingsView(await store.snapshot()).workspaceAgentDefaults, undefined);
  assert.equal(await readWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR), undefined);

  const chosen = { agent: "claude", model: "sonnet", effort: "max" };
  const { settings, reason } = await setWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR, chosen);

  assert.equal(reason, undefined);
  assert.deepEqual(appSettingsView(settings).workspaceAgentDefaults, {
    [PROVIDER_ID.CONDUCTOR]: chosen,
  });
  // The choice outlives the run that heard it.
  assert.deepEqual(
    await readWorkspaceAgentDefault(storeIn(directory), PROVIDER_ID.CONDUCTOR),
    chosen,
  );

  // Clearing returns that one provider to its own defaults.
  const cleared = await setWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
  assert.equal(appSettingsView(cleared.settings).workspaceAgentDefaults, undefined);
  assert.equal(
    await readWorkspaceAgentDefault(storeIn(directory), PROVIDER_ID.CONDUCTOR),
    undefined,
  );
});

test("changes a workspace agent pairing without touching the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await setWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR, {
    agent: "codex",
    model: "gpt-5.6-sol",
  });

  assert.deepEqual(appSettingsView(settings).workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR], {
    agent: "codex",
    model: "gpt-5.6-sol",
  });
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("lets the first creation choose each provider's project until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  // Unset on purpose, the provider default's own terms: the default is always
  // a choice the user made — by hand or by their first creation there.
  assert.equal(appSettingsView(await store.snapshot()).workspaceProjectDefaults, undefined);
  assert.equal(await readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);

  const { settings, reason } = await setWorkspaceProjectDefault(
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
    await readWorkspaceProjectDefault(storeIn(directory), PROVIDER_ID.CONDUCTOR),
    "proj-1",
  );

  // Clearing returns that one provider to its first creation choosing.
  const cleared = await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
  assert.equal(appSettingsView(cleared.settings).workspaceProjectDefaults, undefined);
  assert.equal(
    await readWorkspaceProjectDefault(storeIn(directory), PROVIDER_ID.CONDUCTOR),
    undefined,
  );
});

test("changes a default project without touching the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await setWorkspaceProjectDefault(store, PROVIDER_ID.CURSOR, "proj-2");

  assert.deepEqual(appSettingsView(settings).workspaceProjectDefaults, {
    [PROVIDER_ID.CURSOR]: "proj-2",
  });
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("keeps one provider's default project apart from another's", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");
  const { settings } = await setWorkspaceProjectDefault(store, PROVIDER_ID.CURSOR, "proj-2");

  assert.deepEqual(appSettingsView(settings).workspaceProjectDefaults, {
    [PROVIDER_ID.CONDUCTOR]: "proj-1",
    [PROVIDER_ID.CURSOR]: "proj-2",
  });

  const cleared = await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
  assert.deepEqual(appSettingsView(cleared.settings).workspaceProjectDefaults, {
    [PROVIDER_ID.CURSOR]: "proj-2",
  });
});

test("forgetting a default no provider offers survives the reload it was written for", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-gone");
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CURSOR, "proj-2");

  // The write the observation pass makes when a provider stops offering the
  // project a default names. It has to reach the file, not just the snapshot:
  // the entry it forgets is one an earlier launch wrote.
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CURSOR]: "proj-2",
  });
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("a stale cleanup cannot clear a newer project default", async (t) => {
  const store = storeIn(await temporaryDirectory(t));
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-old");
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-new");

  const stale = await store.clearEntryIfUnchanged(
    APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
    PROVIDER_ID.CONDUCTOR,
    "proj-old",
  );

  assert.equal(stale.cleared, false);
  assert.equal(
    appSettingsView(stale.settings).workspaceProjectDefaults?.[PROVIDER_ID.CONDUCTOR],
    "proj-new",
  );
});

test("an entry the field cannot hold is refused rather than quietly dropped", () => {
  // The map guards drop what they cannot hold, which is right when reading a
  // stored file and wrong for a write: a whole map of unholdable entries would
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // read as valid and clear what is stored. Every write goes one entry at a
  // time so the refusal is the guard's own answer.
  assert.equal(
    settingEntryGuard(
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      PROVIDER_ID.CONDUCTOR,
      "   ",
    ).valid,
    false,
  );
  assert.equal(
    settingEntryGuard(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, PROVIDER_ID.CONDUCTOR, {
      agent: "codex",
      model: "no-such-model",
    }).valid,
    false,
  );

  // Clearing carries no value to check, and a holdable entry comes back whole.
  assert.equal(
    settingEntryGuard(
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      PROVIDER_ID.CONDUCTOR,
      undefined,
    ).valid,
    true,
  );
  assert.deepEqual(
    settingEntryGuard(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, PROVIDER_ID.CONDUCTOR, {
      agent: "codex",
      model: "gpt-5.6-sol",
    }),
    { valid: true, value: { agent: "codex", model: "gpt-5.6-sol" } },
  );
  assert.equal(
    settingEntryGuard(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, "superset", {
      agent: "codex",
      model: "gpt-5.6-sol",
    }).valid,
    false,
  );
  assert.deepEqual(
    settingEntryGuard(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, "superset", {
      agent: "codex",
    }),
    { valid: true, value: { agent: "codex" } },
  );
});

test("every map-valued setting is written one entry at a time", () => {
  // The keyed set is what the whole-map write path refuses, so a new map field
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // that forgot its entry declaration would be writable as a whole map again.
  for (const field of APP_SETTING_FIELDS) {
    const holdsMap =
      field === APP_SETTING_SCHEMA.workspaceAgentDefaults.field ||
      field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field;
    assert.equal(isKeyedAppSettingField(field), holdsMap, field);
  }
});

test("overlapping default projects each survive the other's write", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  // Both start before either lands, the way two provider rows saved in quick
  // succession do. The merge belongs to the store for exactly this reason: a
  // caller holding the map it read before the first write would put that stale
  // copy back, and the later write would drop the other provider's choice.
  await Promise.all([
    setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1"),
    setWorkspaceProjectDefault(store, PROVIDER_ID.CURSOR, "proj-2"),
  ]);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CONDUCTOR]: "proj-1",
    [PROVIDER_ID.CURSOR]: "proj-2",
  });
});

test("an overlapping clear forgets its own entry and no other", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");

  // A row cleared while another row is being saved forgets one entry, never
  // the map the clear was composed against.
  await Promise.all([
    setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined),
    setWorkspaceProjectDefault(store, PROVIDER_ID.CURSOR, "proj-2"),
  ]);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CURSOR]: "proj-2",
  });
});

test("ignores stored default projects this store cannot hold", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
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

  const store = storeIn(directory);
  assert.equal(await readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
  assert.equal(appSettingsView(await store.snapshot()).workspaceProjectDefaults, undefined);
});

test("ignores a stored pairing this build's table does not list", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
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

  const store = storeIn(directory);
  assert.equal(await readWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
  assert.equal(appSettingsView(await store.snapshot()).workspaceAgentDefaults, undefined);
});

test("the voice and a stored key survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.set(APP_SETTING_SCHEMA.voice.field, REALTIME_VOICE.MARIN);
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-replacement-key");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voice.field), REALTIME_VOICE.MARIN);
});

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(
    appSettingsView(settings).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("a voice reset forgets the voice, pace, captions, and duck in one act", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.voice.field, REALTIME_VOICE.MARIN);
  await store.set(APP_SETTING_SCHEMA.voiceSpeed.field, REALTIME_VOICE_SPEED.QUICK);
  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);
  await store.set(APP_SETTING_SCHEMA.duckOtherMedia.field, false);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(appSettingsView(settings).voiceSpeed, REALTIME_DEFAULTS.SPEED);
  assert.equal(appSettingsView(settings).voiceCaptions, false);
  assert.equal(appSettingsView(settings).duckOtherMedia, true);
  // The choices are forgotten rather than restated, so a default that moves
  // in a later build moves these settings with it.
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voice.field), undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voiceSpeed.field), undefined);
});

test("a voice reset returns to the environment's voice where one stands behind the choice", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { LUKE_REALTIME_VOICE: REALTIME_VOICE.SAGE },
  });
  await store.set(APP_SETTING_SCHEMA.voice.field, REALTIME_VOICE.MARIN);

  const { settings } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // Forgetting the choice is the reset's whole meaning: what stands afterwards
  // is whatever would have stood had none been made.
  assert.equal(appSettingsView(settings).voice, REALTIME_VOICE.SAGE);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
});

test("an appearance reset returns Luke's stances without touching the voice page", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.showInDock.field, true);
  await store.set(APP_SETTING_SCHEMA.showOnAllDisplays.field, true);
  await store.set(APP_SETTING_SCHEMA.formFactor.field, PANEL_FORM_FACTOR.NOTCH);
  await store.set(APP_SETTING_SCHEMA.voice.field, REALTIME_VOICE.MARIN);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).showInDock, false);
  assert.equal(appSettingsView(settings).showOnAllDisplays, false);
  assert.equal(appSettingsView(settings).formFactor, PANEL_FORM_FACTOR.BUBBLE);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.formFactor.field), undefined);
  // One scope's reset is that scope's alone.
  assert.equal(appSettingsView(settings).voice, REALTIME_VOICE.MARIN);
});

test("a shortcuts reset forgets all three chords at once", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Shift+Command+L");
  await store.set(APP_SETTING_SCHEMA.askHotkey.field, "Control+Alt+K");
  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.SHORTCUTS);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voiceHotkey, undefined);
  assert.equal(appSettingsView(settings).askHotkey, undefined);
  assert.equal(appSettingsView(settings).stopHotkey, undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.voiceHotkey.field), undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.askHotkey.field), undefined);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.stopHotkey.field), undefined);
});

test("a workspaces reset forgets the provider and project defaults but never the agent pairing", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  const pairing = { agent: "claude", model: "sonnet" };
  await store.set(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field, PROVIDER_ID.CONDUCTOR);
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");
  await setWorkspaceAgentDefault(store, PROVIDER_ID.CONDUCTOR, pairing);
  await store.setEntry(APP_SETTING_SCHEMA.workspaceAgentDefaults.field, "superset", {
    agent: "codex",
  });

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.WORKSPACES);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).defaultWorkspaceProvider, undefined);
  assert.equal(appSettingsView(settings).workspaceProjectDefaults, undefined);
  // Agent choices live on their provider rows, whose own menus offer the
  // defaults — no reset here may reach either one.
  assert.deepEqual(appSettingsView(settings).workspaceAgentDefaults, {
    [PROVIDER_ID.CONDUCTOR]: pairing,
    superset: { agent: "codex" },
  });
});

test("a reset of settings already at their defaults writes nothing", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).voice, REALTIME_DEFAULTS.VOICE);
  // Nothing changed, so no file was created — the same silence every setter
  // keeps when asked for the value it already holds.
  await assert.rejects(readSettingsFile(directory));
});

test("a reset never touches the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });
  await store.set(APP_SETTING_SCHEMA.voiceCaptions.field, true);

  await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // A preference is not a credential, so resetting a page of them never
  // reaches the Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("a reset leaves a stored key standing", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
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
  const store = storeIn(directory);

  await store.resetSettings(SETTINGS_RESET_SCOPE.VOICE);

  // No scope reaches a credential: the ciphertext rides the write untouched.
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const contents = JSON.parse(await readSettingsFile(directory)) as {
    apiKeys: Record<string, string>;
    voiceCaptions: boolean;
  };
  assert.deepEqual(contents.apiKeys, { [CONDUCTOR]: sealed(TEST_API_KEY) });
  assert.equal(contents.voiceCaptions, false);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

/** A signed-in account, which is what makes the free allowance answerable. */
const TEST_ACCOUNT = {
  accessToken: "access-token-secret",
  refreshToken: "refresh-token-secret",
  email: "developer@example.com",
  name: "Developer",
  provider: "github" as const,
};

test("with no key stored there is only one source to run on", async (t) => {
  const store = storeIn(await temporaryDirectory(t));
  await store.setAccount(TEST_ACCOUNT);

  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);
  assert.equal(appSettingsView(await store.snapshot()).voiceSource, VOICE_SOURCE.ACCOUNT);

  // Choosing the key with none stored changes nothing about what runs: there
  // is nothing there to spend, and a resolution that answered otherwise would
  // send the minter to a credential that does not exist.
  await store.set(APP_SETTING_SCHEMA.voiceSource.field, VOICE_SOURCE.KEY);
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);
});

test("connecting the voice key chooses it, and the allowance can take it back", async (t) => {
  const store = storeIn(await temporaryDirectory(t));
  await store.setAccount(TEST_ACCOUNT);
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-developers-own");

  // Connecting is choosing: someone who pastes a key means to use it, and a
  // stored preference quietly ignoring it would look like the save failed.
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.KEY);

  // And back again, with the key still stored — the whole point of the
  // choice: changing sources never costs a credential.
  await store.set(APP_SETTING_SCHEMA.voiceSource.field, VOICE_SOURCE.ACCOUNT);
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[CREDENTIAL_PROVIDER_ID.OPENAI],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
    "parking on the allowance keeps the key",
  );
  // Voice is still on: what changed is whose credential answers, not whether
  // one does.
  assert.equal(appSettingsView(await store.snapshot()).voiceAvailable, true);
});

test("a choice that would start spending a key is never made by fallback", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-developers-own");
  await store.set(APP_SETTING_SCHEMA.voiceSource.field, VOICE_SOURCE.ACCOUNT);
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);

  // Signed out, the allowance they chose cannot answer. The stored key is
  // what is left, so voice keeps working — the fallback that costs nothing
  // is the account's, and this one only runs when the free half has gone.
  await store.clearAccount();
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.KEY);

  // Signing back in returns them to what they chose: the preference was
  // stored, not spent.
  await store.setAccount(TEST_ACCOUNT);
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the chosen source survives a reopen, and a corrupt one reads as no choice", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-developers-own");
  await store.set(APP_SETTING_SCHEMA.voiceSource.field, VOICE_SOURCE.ACCOUNT);
  assert.equal(await storeIn(directory).readVoiceSource(), VOICE_SOURCE.ACCOUNT);

  // A source this build does not offer is dropped rather than carried, and
  // dropping it lands where no choice lands: whichever credential is there,
  // the key first.
  const contents = JSON.parse(await readSettingsFile(directory));
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ ...contents, voiceSource: "someone-elses-account" }),
    "utf8",
  );
  assert.equal(await storeIn(directory).readVoiceSource(), VOICE_SOURCE.KEY);
});

test("pasting a key back while parked on the allowance is still choosing it", async (t) => {
  const store = storeIn(await temporaryDirectory(t));
  await store.setAccount(TEST_ACCOUNT);
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-developers-own");
  await store.set(APP_SETTING_SCHEMA.voiceSource.field, VOICE_SOURCE.ACCOUNT);
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.ACCOUNT);

  // The same key again is no change to what is stored, but it is still the
  // act of connecting one — and a save that quietly changed nothing would
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // read as a key that failed to take.
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-developers-own");
  assert.equal(await store.readVoiceSource(), VOICE_SOURCE.KEY);
});

test("a grant is stored encrypted, and read back only in the main process", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: TEST_PROVIDERS });

  const { settings } = await store.setGrant(CONSENT_SERVICE, {
    accessToken: "granted-access",
    refreshToken: "granted-refresh",
    expiresAt: 1_760_000_000_000,
  });

  // The row says connected the way every other credential's row does.
  assert.equal(
    appSettingsView(settings).credentialSources[CONSENT_SERVICE],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  // Neither token is anywhere in what a renderer receives.
  const rendered = JSON.stringify(settings);
  assert.doesNotMatch(rendered, /granted-access/);
  assert.doesNotMatch(rendered, /granted-refresh/);

  // Both tokens travel under one ciphertext; only the expiry stays readable,
  // which is what lets a pass skip a refresh it does not need.
  const file = JSON.parse(await readSettingsFile(directory));
  assert.equal(file.grants[CONSENT_SERVICE].expiresAt, 1_760_000_000_000);
  assert.doesNotMatch(file.grants[CONSENT_SERVICE].tokenCipher, /granted-access/);

  assert.deepEqual(await store.readGrant(CONSENT_SERVICE), {
    accessToken: "granted-access",
    refreshToken: "granted-refresh",
    expiresAt: 1_760_000_000_000,
  });

  // A stored grant outlives the process that made it.
  const reopened = storeIn(directory, { providers: TEST_PROVIDERS });
  assert.equal((await reopened.readGrant(CONSENT_SERVICE))?.accessToken, "granted-access");
});

test("clearing a grant leaves nothing behind, and keys alone", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: TEST_PROVIDERS });
  await store.setApiKey(FIRST_CLOUD, "first-cloud-key");
  await store.setGrant(CONSENT_SERVICE, { accessToken: "granted-access", expiresAt: 1 });

  const { settings } = await store.clearGrant(CONSENT_SERVICE);
  assert.equal(
    appSettingsView(settings).credentialSources[CONSENT_SERVICE],
    CREDENTIAL_SOURCE.NONE,
  );
  assert.equal(await store.readGrant(CONSENT_SERVICE), undefined);
  // Disconnecting one service never disturbs another's credential.
  assert.equal(await store.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.doesNotMatch(await readSettingsFile(directory), /granted-access/);
});

test("a key left by a build that asked for one is dropped, never carried", async (t) => {
  const directory = await temporaryDirectory(t);
  // What an installation upgraded from a build that pasted this service's key
  // would hold: a credential this build can never send anywhere.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: {
        [CONSENT_SERVICE]: sealed("stale-pasted-key"),
        [FIRST_CLOUD]: sealed("first-cloud-key"),
      },
    }),
    "utf8",
  );
  const store = storeIn(directory, { providers: TEST_PROVIDERS });

  const settings = appSettingsView(await store.snapshot());
  assert.equal(settings.credentialSources[CONSENT_SERVICE], CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readApiKey(CONSENT_SERVICE), undefined);

  // A provider this build does know, and knows takes no key, has its key let
  // go on the next write — a credential Luke will not use is not one to keep.
  await store.setApiKey(FIRST_CLOUD, "replaced-key");
  const file = JSON.parse(await readSettingsFile(directory));
  assert.equal(file.apiKeys[CONSENT_SERVICE], undefined);
  assert.ok(file.apiKeys[FIRST_CLOUD]);
});
