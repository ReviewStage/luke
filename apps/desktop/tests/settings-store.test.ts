import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { type SecretCipher, SettingsStore } from "../src/settings-store";
import { CREDENTIAL_SOURCE } from "../src/shared/contracts";
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

const TEST_PROVIDERS = [FIRST_CLOUD_PROVIDER, SECOND_CLOUD_PROVIDER];
const FIRST_CLOUD = FIRST_CLOUD_PROVIDER.id;
const SECOND_CLOUD = SECOND_CLOUD_PROVIDER.id;

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
  assert.equal(settings.secretStorageAvailable, true);
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

test("refuses to store a key when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { cipher: testCipher(false) });

  const { settings, reason } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.match(reason ?? "", /unavailable/);
  assert.equal(settings.secretStorageAvailable, false);
  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.NONE);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
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
