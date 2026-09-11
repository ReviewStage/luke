import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { CREDENTIAL_PROVIDER_ID, type CredentialProviderId } from "@sidecar/credentials";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "@sidecar/credentials/vocabulary";
import { LIVE_DEFAULTS, LIVE_VOICE } from "@sidecar/live";
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
  isKeyedAppSettingField,
  settingEntryGuard,
  VOICE_HOTKEY_NONE,
} from "@sidecar/settings";
import { appSettingsView, SETTINGS_RESET_SCOPE, VOICE_SOURCE } from "@sidecar/settings/wire";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { type UnparsedWireValue, unparsedWire, type WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import {
  apiKeyRejection,
  type SecretCipher,
  SettingsStore,
  type SettingsStoreOptions,
} from "./settings-store.js";
import { temporaryDirectory } from "./testing/temporary-directory.js";

const TEST_API_KEY = "conductor-live-key";
const SETTINGS_FILE_NAME = "settings.json";
const CIPHER_PREFIX = "sealed:";
const CONDUCTOR = CREDENTIAL_PROVIDER_ID.CONDUCTOR;

const TEST_ENVIRONMENT_VARIABLE = {
  API_KEY: "CONDUCTOR_API_KEY",
  API_TOKEN: "CONDUCTOR_API_TOKEN",
} as const;

/** The one service connected on its own consent page rather than by a pasted key. */
const CONSENT_SERVICE = CREDENTIAL_PROVIDER_ID.LINEAR;

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

function storeIn(
  directory: string,
  options: { cipher?: SecretCipher; environment?: NodeJS.ProcessEnv } = {},
): SettingsStore {
  const config: SettingsStoreOptions = {
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    environment: options.environment ?? {},
  };
  return new SettingsStore(config);
}

test("a failed first load is retried before a later write", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  askHotkey: "Control+Alt+K",
  stopHotkey: "Control+Alt+P",
  duckOtherMedia: false,
  voiceSource: VOICE_SOURCE.ACCOUNT,
  preferBuiltInMicrophone: false,
  announceSessions: false,
  quietDuringMeetings: false,
  syncProviderKeys: false,
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
  APP_SETTING_SCHEMA.voiceSource.field,
  APP_SETTING_SCHEMA.formFactor.field,
]);

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
      JSON.stringify({ version: 2, apiKeys: {}, [field]: CORRUPT_VALUE }),
      "utf8",
    );

    assert.deepEqual(
      await storeIn(directory).get(field),
      APP_SETTING_SCHEMA[field].guard(undefined).value,
      `${field} honoured a value it cannot hold`,
    );
  }
});

test("no setting's write reaches the cipher, and none disturbs a stored key", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    const cipher = countingCipher();
    const store = storeIn(directory, { cipher });
    await store.setApiKey(CONDUCTOR, TEST_API_KEY);
    const protectingTheKey = { ...cipher.calls };

    await store.set(field, SAMPLE_VALUE[field]);

    // A preference is not a credential, so choosing one must reach the
    // Keychain not at all — and never raise its permission dialog.
    assert.deepEqual(cipher.calls, protectingTheKey, `${field} reached the cipher`);
    assert.equal(
      await storeIn(directory).readApiKey(CONDUCTOR),
      TEST_API_KEY,
      `${field} disturbed a stored key`,
    );
  }
});

test("stores an API key encrypted, private to the owner, and never in a snapshot", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  const { settings, reason } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  const stats = await fs.stat(path.join(directory, SETTINGS_FILE_NAME));

  assert.equal(reason, undefined);
  assert.equal(
    appSettingsView(settings).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.AVAILABLE);
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("round-trips an encrypted account without exposing either token in snapshots", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  const account = {
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    email: "developer@example.com",
    name: "Developer",
    provider: "github" as const,
  };

  const snapshot = await store.setAccount(account);
  const reopened = storeIn(directory);

  assert.deepEqual(snapshot, {
    status: ACCOUNT_STATUS.SIGNED_IN,
    email: account.email,
    name: account.name,
    provider: account.provider,
  });
  assert.deepEqual(await reopened.readAccount(), account);
});

test("decrypts once and re-decrypts only after the key changes", async (t) => {
  // The observation timer reads the credential every few seconds, so decrypting
  // on each read would reach the OS keychain thousands of times a day.
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
  await storeIn(directory).setApiKey(CONDUCTOR, TEST_API_KEY);

  const reopened = storeIn(directory);

  assert.equal(await reopened.readApiKey(CONDUCTOR), TEST_API_KEY);
  assert.equal(
    appSettingsView(await reopened.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
});

test("clears a stored key", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  const { settings } = await store.setApiKey(CONDUCTOR, undefined);

  assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stored selection keeps only the filters this build recognizes", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
test("a stored query of nothing but whitespace reads as unset rather than narrowing", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, sessionSearchQuery: "   " }),
    "utf8",
  );

  assert.equal(appSettingsView(await storeIn(directory).snapshot()).sessionSearchQuery, undefined);
});

test("a stored connection answers presence without touching any grant", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  assert.equal(await store.calendarConnectionStored(), false);
  await store.connectAppleCalendar(["home"]);
  assert.equal(await store.calendarConnectionStored(), true);
  await store.disconnectAppleCalendar();
  assert.equal(await store.calendarConnectionStored(), false);
  await store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);
  assert.equal(await store.calendarConnectionStored(), true);
});

test("a calendar account stores its grant encrypted and survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  assert.equal(await store.readAppleCalendarConnection(), undefined);
  assert.equal(appSettingsView(await store.snapshot()).appleCalendar, undefined);

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
  assert.deepEqual(await storeIn(directory).readAppleCalendarConnection(), {
    selectedCalendarIds: ["home", "work"],
  });
});

test("connecting Apple Calendar again keeps the held choices, and selection edits them", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
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

test("Apple Calendar is offered only where there is a Mac calendar to read", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const snapshot = await storeIn(directory).snapshot();
  assert.equal(appSettingsView(snapshot).appleCalendarAvailable, process.platform === "darwin");
});

test("a calendar account never disturbs a stored key, nor a key an account", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.addCalendarAccount("dev@example.com", "1//grant", ["dev@example.com"]);
  await store.setApiKey(CONDUCTOR, undefined);

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), undefined);
  assert.equal((await reopened.readCalendarAccounts()).length, 1);
});

test("keeps each provider's key, environment fallback, and reported source separate", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment" },
  });

  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-stored-key");
  const settings = appSettingsView(await store.snapshot());

  assert.equal(
    settings.credentialSources[CREDENTIAL_PROVIDER_ID.OPENAI],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENVIRONMENT);
  assert.equal(await store.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), "sk-stored-key");
  assert.equal(await store.readApiKey(CONDUCTOR), "conductor-environment");

  // Storing and then clearing one provider's key leaves the other untouched.
  await store.setApiKey(CONDUCTOR, "conductor-stored-key");
  assert.equal(await store.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), "sk-stored-key");
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, undefined);

  assert.equal(await store.readApiKey(CONDUCTOR), "conductor-stored-key");
  assert.equal(await store.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), undefined);
  assert.equal(
    appSettingsView(await store.snapshot()).credentialSources[CREDENTIAL_PROVIDER_ID.OPENAI],
    CREDENTIAL_SOURCE.NONE,
    "a provider with no key must report nothing",
  );
});

test("keeps both keys when two providers are saved at once", async (t) => {
  // Each settings row carries its own busy flag, so a user with more than one
  // provider can start a second save before the first has landed.
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  await Promise.all([
    store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-stored-key"),
    store.setApiKey(CONDUCTOR, "conductor-stored-key"),
  ]);

  assert.equal(await store.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), "sk-stored-key");
  assert.equal(await store.readApiKey(CONDUCTOR), "conductor-stored-key");
  assert.deepEqual(
    JSON.parse(await readSettingsFile(directory)),
    expectedPersistedSettings({
      apiKeys: {
        [CREDENTIAL_PROVIDER_ID.OPENAI]: sealed("sk-stored-key"),
        [CONDUCTOR]: sealed("conductor-stored-key"),
      },
      // Storing the voice key is choosing it, so the file records the choice.
      voiceSource: VOICE_SOURCE.KEY,
    }),
  );
  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), "sk-stored-key");
  assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-stored-key");
});

test("reports nothing for a provider the registry does not name", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  const unknown = "no-such-service" as CredentialProviderId;

  assert.equal(await store.readApiKey(unknown), undefined);
  assert.equal(appSettingsView(await store.snapshot()).credentialSources[unknown], undefined);
});

test("falls back to an API key from the environment", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_TOKEN]: `  ${TEST_API_KEY}  ` },
  });

  const settings = appSettingsView(await store.snapshot());

  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENVIRONMENT);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("prefers a stored key over one from the environment", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment-key" },
  });
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("rejects a key that cannot be sent as an authorization header", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  for (const candidate of ["short", "key with spaces", "k".repeat(513)]) {
    // The store answers with the rule's own reason rather than one of its
    // own, and a refused key leaves the file it would have been written to
    // uncreated.
    assert.equal((await store.setApiKey(CONDUCTOR, candidate)).reason, apiKeyRejection(candidate));
  }
  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

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

test("refuses to store a key when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory, { cipher: testCipher(false) });

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNAVAILABLE);
  assert.equal(appSettingsView(settings).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("asks the cipher nothing on a launch with no key to protect", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const settings = appSettingsView(await store.snapshot());

  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  // Nothing has asked, so nothing is claimed either way.
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("asks the cipher nothing to clear a key", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.setApiKey(CONDUCTOR, undefined);

  assert.equal(reason, undefined);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(appSettingsView(settings).secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("asks once when a key is stored and reports that answer from then on", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("carries a key belonging to a provider this build does not know", async (t) => {
  // A file written by a newer build must not lose credentials to an older one.
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("decides the Dock icon from the file alone, never the keychain", async (t) => {
  // The icon is drawn at launch from this answer, so a locked or slow
  // Keychain — which decrypting a stored key can wait on — must not be able to
  // delay it.
  const directory = await temporaryDirectory(t, "luke-settings-");
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
    JSON.stringify({ version: 2, apiKeys: {}, voice: "baritone" }),
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
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "project-local");

  const result = await store.applyAccountPreferences({
    voice: LIVE_VOICE.MARIN,
    workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-sol" } },
  });

  assert.deepEqual(result.changed, [
    APP_SETTING_SCHEMA.voice.field,
    APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
    APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
  ]);
  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.showInDock.field), true);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), VOICE_HOTKEY_NONE);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.MARIN);
  assert.equal(await readWorkspaceProjectDefault(reopened, PROVIDER_ID.CONDUCTOR), undefined);
  assert.deepEqual(await readWorkspaceAgentDefault(reopened, PROVIDER_ID.CONDUCTOR), {
    agent: "codex",
    model: "gpt-5.6-sol",
  });
});

test("merges hosted account preferences around concurrent local preference edits", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  const account = {
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    email: "developer@example.com",
    name: "Developer",
    provider: "github" as const,
  };
  await store.setAccount(account);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  const expected = await store.accountPreferences();

  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "local-project");
  const result = await store.applyAccountPreferences(
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
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
  assert.equal(
    await store.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
    PROVIDER_ID.CODEX,
  );
  assert.equal(await readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), "local-project");
  assert.equal(await readWorkspaceProjectDefault(store, PROVIDER_ID.CODEX), "remote-project");
});

test("keeps local account preference edits across a failed hosted write and restart", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const account = {
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    email: "developer@example.com",
    name: "Developer",
    provider: "github" as const,
  };
  const store = storeIn(directory);
  await store.setAccount(account);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  await store.setAccountPreferencesSyncBaseline(account.email, await store.accountPreferences());

  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.ECHO);
  const reopened = storeIn(directory);
  const baseline = await reopened.accountPreferencesSyncBaseline(account.email);
  assert.deepEqual(baseline, { voice: LIVE_VOICE.SAGE });
  const result = await reopened.applyAccountPreferences(
    { voice: LIVE_VOICE.SAGE, defaultWorkspaceProvider: PROVIDER_ID.CODEX },
    { accountEmail: account.email, preferences: baseline ?? {} },
  );

  assert.deepEqual(result.changed, [APP_SETTING_SCHEMA.defaultWorkspaceProvider.field]);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voice.field), LIVE_VOICE.ECHO);
  assert.equal(
    await reopened.get(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field),
    PROVIDER_ID.CODEX,
  );
});

test("skips a guarded account preference apply after account sign-out", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  const account = {
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    email: "developer@example.com",
    name: "Developer",
    provider: "github" as const,
  };
  await store.setAccount(account);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.SAGE);
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "local-project");
  const expected = await store.accountPreferences();

  await store.clearAccount();
  const result = await store.applyAccountPreferences(
    { voice: LIVE_VOICE.MARIN },
    { accountEmail: account.email, preferences: expected },
  );

  assert.deepEqual(result.changed, []);
  assert.equal(await store.get(APP_SETTING_SCHEMA.voice.field), undefined);
  assert.equal(await readWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR), undefined);
  assert.equal(await store.accountPreferencesSyncBaseline(account.email), undefined);
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
  for (const field of [
    APP_SETTING_SCHEMA.voiceHotkey.field,
    APP_SETTING_SCHEMA.askHotkey.field,
    APP_SETTING_SCHEMA.stopHotkey.field,
  ]) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    await fs.writeFile(
      path.join(directory, SETTINGS_FILE_NAME),
      JSON.stringify({ version: 2, apiKeys: {}, [field]: "F13" }),
    );
    const store = storeIn(directory);

    // A hand-edited chord the registrars would refuse is dropped rather than
    // carried: honouring it would claim a key nothing was ever told about.
    assert.equal(await store.get(field), undefined, field);
    assert.equal(appSettingsView(await store.snapshot())[field], undefined, field);
  }
});

test("the three Luke keys survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  await store.set(APP_SETTING_SCHEMA.voiceHotkey.field, "Control+Alt+Space");
  await store.set(APP_SETTING_SCHEMA.askHotkey.field, "Control+Alt+K");
  await store.set(APP_SETTING_SCHEMA.stopHotkey.field, "Control+Alt+X");

  const reopened = storeIn(directory);
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.voiceHotkey.field), "Control+Alt+Space");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.askHotkey.field), "Control+Alt+K");
  assert.equal(await reopened.get(APP_SETTING_SCHEMA.stopHotkey.field), "Control+Alt+X");
});

test("a stored key and a chosen preference survive each other's writes", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "luke-settings-");
    const store = storeIn(directory);

    await store.setApiKey(CONDUCTOR, TEST_API_KEY);
    await store.set(field, SAMPLE_VALUE[field]);
    await store.setApiKey(CONDUCTOR, "conductor-replacement-key");

    const reopened = storeIn(directory);
    assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-replacement-key");
    assert.deepEqual(await reopened.get(field), SAMPLE_VALUE[field], `${field} did not survive`);
  }
});

test("ignores a stored form this build does not draw", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("ignores a stored default provider this build does not know", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("lets the first creation choose each provider's project until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("keeps one provider's default project apart from another's", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");
  const { settings } = await setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2");

  assert.deepEqual(appSettingsView(settings).workspaceProjectDefaults, {
    [PROVIDER_ID.CONDUCTOR]: "proj-1",
    [PROVIDER_ID.CODEX]: "proj-2",
  });

  const cleared = await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);
  assert.deepEqual(appSettingsView(cleared.settings).workspaceProjectDefaults, {
    [PROVIDER_ID.CODEX]: "proj-2",
  });
});

test("forgetting a default no provider offers survives the reload it was written for", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-gone");
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2");

  // The write the observation pass makes when a provider stops offering the
  // project a default names. It has to reach the file, not just the snapshot:
  // the entry it forgets is one an earlier launch wrote.
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CODEX]: "proj-2",
  });
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("a stale cleanup cannot clear a newer project default", async (t) => {
  const store = storeIn(await temporaryDirectory(t, "luke-settings-"));
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
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

  // Both start before either lands, the way two provider rows saved in quick
  // succession do. The merge belongs to the store for exactly this reason: a
  // caller holding the map it read before the first write would put that stale
  // copy back, and the later write would drop the other provider's choice.
  await Promise.all([
    setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1"),
    setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2"),
  ]);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CONDUCTOR]: "proj-1",
    [PROVIDER_ID.CODEX]: "proj-2",
  });
});

test("an overlapping clear forgets its own entry and no other", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, "proj-1");

  // A row cleared while another row is being saved forgets one entry, never
  // the map the clear was composed against.
  await Promise.all([
    setWorkspaceProjectDefault(store, PROVIDER_ID.CONDUCTOR, undefined),
    setWorkspaceProjectDefault(store, PROVIDER_ID.CODEX, "proj-2"),
  ]);

  assert.deepEqual(appSettingsView(await storeIn(directory).snapshot()).workspaceProjectDefaults, {
    [PROVIDER_ID.CODEX]: "proj-2",
  });
});

test("ignores stored default projects this store cannot hold", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(
    appSettingsView(settings).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
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
  await store.set(APP_SETTING_SCHEMA.showOnAllDisplays.field, true);
  await store.set(APP_SETTING_SCHEMA.formFactor.field, PANEL_FORM_FACTOR.NOTCH);
  await store.set(APP_SETTING_SCHEMA.voice.field, LIVE_VOICE.MARIN);

  const { settings, reason } = await store.resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE);

  assert.equal(reason, undefined);
  assert.equal(appSettingsView(settings).showInDock, false);
  assert.equal(appSettingsView(settings).showOnAllDisplays, false);
  assert.equal(appSettingsView(settings).formFactor, PANEL_FORM_FACTOR.BUBBLE);
  assert.equal(await storeIn(directory).get(APP_SETTING_SCHEMA.formFactor.field), undefined);
  // One scope's reset is that scope's alone.
  assert.equal(appSettingsView(settings).voice, LIVE_VOICE.MARIN);
});

test("a shortcuts reset forgets all three chords at once", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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

test("a reset leaves a stored key standing", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const store = storeIn(await temporaryDirectory(t, "luke-settings-"));
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
  const store = storeIn(await temporaryDirectory(t, "luke-settings-"));
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const directory = await temporaryDirectory(t, "luke-settings-");
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
  const store = storeIn(await temporaryDirectory(t, "luke-settings-"));
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
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);

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

  // Both tokens travel under one ciphertext; only the expiry stays readable,
  // which is what lets a pass skip a refresh it does not need.
  const file = JSON.parse(await readSettingsFile(directory));
  assert.equal(file.grants[CONSENT_SERVICE].expiresAt, 1_760_000_000_000);

  assert.deepEqual(await store.readGrant(CONSENT_SERVICE), {
    accessToken: "granted-access",
    refreshToken: "granted-refresh",
    expiresAt: 1_760_000_000_000,
  });

  // A stored grant outlives the process that made it.
  const reopened = storeIn(directory);
  assert.equal((await reopened.readGrant(CONSENT_SERVICE))?.accessToken, "granted-access");
});

test("clearing a grant leaves nothing behind, and keys alone", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  const store = storeIn(directory);
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-stored-key");
  await store.setGrant(CONSENT_SERVICE, { accessToken: "granted-access", expiresAt: 1 });

  const { settings } = await store.clearGrant(CONSENT_SERVICE);
  assert.equal(
    appSettingsView(settings).credentialSources[CONSENT_SERVICE],
    CREDENTIAL_SOURCE.NONE,
  );
  assert.equal(await store.readGrant(CONSENT_SERVICE), undefined);
  // Disconnecting one service never disturbs another's credential.
  assert.equal(await store.readApiKey(CREDENTIAL_PROVIDER_ID.OPENAI), "sk-stored-key");
});

test("a key left by a build that asked for one is dropped, never carried", async (t) => {
  const directory = await temporaryDirectory(t, "luke-settings-");
  // What an installation upgraded from a build that pasted this service's key
  // would hold: a credential this build can never send anywhere.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: {
        [CONSENT_SERVICE]: sealed("stale-pasted-key"),
        [CREDENTIAL_PROVIDER_ID.OPENAI]: sealed("sk-stored-key"),
      },
    }),
    "utf8",
  );
  const store = storeIn(directory);

  const settings = appSettingsView(await store.snapshot());
  assert.equal(settings.credentialSources[CONSENT_SERVICE], CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readApiKey(CONSENT_SERVICE), undefined);

  // A provider this build does know, and knows takes no key, has its key let
  // go on the next write — a credential Luke will not use is not one to keep.
  await store.setApiKey(CREDENTIAL_PROVIDER_ID.OPENAI, "sk-replaced-key");
  const file = JSON.parse(await readSettingsFile(directory));
  assert.equal(file.apiKeys[CONSENT_SERVICE], undefined);
  assert.ok(file.apiKeys[CREDENTIAL_PROVIDER_ID.OPENAI]);
});
