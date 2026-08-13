import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { type SecretCipher, SettingsStore } from "../src/settings-store";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../src/shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  type CredentialProvider,
  type CredentialProviderId,
} from "../src/shared/credential-providers";

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
  id: "first-cloud" as CredentialProviderId,
  displayName: "First Cloud",
  hint: "Create a key in First Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.FIRST_CLOUD_API_KEY],
};

const SECOND_CLOUD_PROVIDER: CredentialProvider = {
  id: "second-cloud" as CredentialProviderId,
  displayName: "Second Cloud",
  hint: "Create a key in Second Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.SECOND_CLOUD_API_KEY],
};

/** Publishes a key format, which only some providers do. */
const THIRD_CLOUD_PROVIDER: CredentialProvider = {
  id: "third-cloud" as CredentialProviderId,
  displayName: "Third Cloud",
  hint: "Create a key in Third Cloud.",
  environmentVariables: [TEST_ENVIRONMENT_VARIABLE.THIRD_CLOUD_API_KEY],
  keyFormat: {
    prefix: "current_",
    rejection: "Third Cloud's current keys start with current_.",
  },
};

const TEST_PROVIDERS = [FIRST_CLOUD_PROVIDER, SECOND_CLOUD_PROVIDER, THIRD_CLOUD_PROVIDER];
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
  } = {},
): SettingsStore {
  return new SettingsStore({
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    environment: options.environment ?? {},
    ...(options.providers ? { providers: options.providers } : {}),
  });
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
  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(settings.secretStorage, SECRET_STORAGE.AVAILABLE);
  assert.equal(contents.includes(TEST_API_KEY), false, "the key was written in plaintext");
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(JSON.stringify(settings).includes(TEST_API_KEY), false);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
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
    (await reopened.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );
});

test("clears a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  const { settings } = await store.setApiKey(CONDUCTOR, undefined);

  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readApiKey(CONDUCTOR), undefined);
  assert.equal((await readSettingsFile(directory)).includes(CONDUCTOR), false);
});

test("keeps each provider's key, environment fallback, and reported source separate", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    providers: TEST_PROVIDERS,
    environment: { [TEST_ENVIRONMENT_VARIABLE.SECOND_CLOUD_API_KEY]: "second-cloud-environment" },
  });

  await store.setApiKey(FIRST_CLOUD, "first-cloud-key");
  const settings = await store.snapshot();

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
    (await store.snapshot()).credentialSources[FIRST_CLOUD],
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
  assert.deepEqual(JSON.parse(await readSettingsFile(directory)), {
    version: 2,
    apiKeys: {
      [FIRST_CLOUD]: sealed("first-cloud-key"),
      [SECOND_CLOUD]: sealed("second-cloud-key"),
    },
  });
  const reopened = storeIn(directory, { providers: TEST_PROVIDERS });
  assert.equal(await reopened.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.equal(await reopened.readApiKey(SECOND_CLOUD), "second-cloud-key");
});

test("reports nothing for a provider this store does not know", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: [FIRST_CLOUD_PROVIDER] });

  assert.equal(await store.readApiKey(SECOND_CLOUD), undefined);
  assert.equal((await store.snapshot()).credentialSources[SECOND_CLOUD], undefined);
});

test("falls back to an API key from the environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_TOKEN]: `  ${TEST_API_KEY}  ` },
  });

  const settings = await store.snapshot();

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
  assert.equal(refused.settings.credentialSources[THIRD_CLOUD], CREDENTIAL_SOURCE.NONE);

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
    (await store.snapshot()).credentialSources[THIRD_CLOUD],
    CREDENTIAL_SOURCE.NONE,
    "a key the provider no longer accepts must not read as connected",
  );
});

test("refuses to store a key when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { cipher: testCipher(false) });

  const { settings, reason } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.match(reason ?? "", /unavailable/);
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNAVAILABLE);
  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("asks the cipher nothing on a launch with no key to protect", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const settings = await store.snapshot();

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
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("asks once when a key is stored and reports that answer from then on", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  const afterwards = await store.snapshot();
  await store.setApiKey(CONDUCTOR, `${TEST_API_KEY}-rotated`);

  assert.equal(settings.secretStorage, SECRET_STORAGE.AVAILABLE);
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
  assert.equal((await store.snapshot()).credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
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
    (await store.snapshot()).credentialSources[CONDUCTOR],
    CREDENTIAL_SOURCE.ENCRYPTED_FILE,
  );

  // The migrated key moves under its provider id the next time settings are
  // written, and the version 1 field does not survive that write.
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");
  const persisted: unknown = JSON.parse(await readSettingsFile(directory));

  assert.deepEqual(persisted, {
    version: 2,
    apiKeys: { [CONDUCTOR]: sealed("conductor-replacement-key") },
  });
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

  assert.deepEqual(persisted, {
    version: 2,
    apiKeys: { "later-cloud": sealed("later-cloud-key"), [CONDUCTOR]: sealed(TEST_API_KEY) },
  });
});

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});
