import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { type SecretCipher, SettingsStore } from "../src/settings-store";
import { CREDENTIAL_SOURCE } from "../src/shared/contracts";

const TEST_API_KEY = "conductor-live-key";
const SETTINGS_FILE_NAME = "settings.json";
const CIPHER_PREFIX = "sealed:";

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

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-settings-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function storeIn(
  directory: string,
  options: { cipher?: SecretCipher; environment?: NodeJS.ProcessEnv } = {},
): SettingsStore {
  return new SettingsStore({
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    environment: options.environment ?? {},
  });
}

async function readSettingsFile(directory: string): Promise<string> {
  return fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8");
}

test("stores an API key encrypted, private to the owner, and never in a snapshot", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  const { settings, reason } = await store.setConductorApiKey(TEST_API_KEY);
  const contents = await readSettingsFile(directory);
  const stats = await fs.stat(path.join(directory, SETTINGS_FILE_NAME));

  assert.equal(reason, undefined);
  assert.equal(settings.conductorApiKeySource, CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(settings.secretStorageAvailable, true);
  assert.equal(contents.includes(TEST_API_KEY), false, "the key was written in plaintext");
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(JSON.stringify(settings).includes(TEST_API_KEY), false);
  assert.equal(await store.readConductorApiKey(), TEST_API_KEY);
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
  await store.setConductorApiKey(TEST_API_KEY);

  const afterStore = decryptions;
  for (let read = 0; read < 5; read += 1) await store.readConductorApiKey();
  const afterReads = decryptions;
  await store.setConductorApiKey("conductor-replacement-key");
  await store.readConductorApiKey();

  assert.equal(afterReads, afterStore, "a repeated read decrypted again");
  assert.ok(decryptions > afterReads, "a replaced key was not re-read");
  assert.equal(await store.readConductorApiKey(), "conductor-replacement-key");
});

test("reads a stored key back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  await storeIn(directory).setConductorApiKey(TEST_API_KEY);

  const reopened = storeIn(directory);

  assert.equal(await reopened.readConductorApiKey(), TEST_API_KEY);
  assert.equal((await reopened.snapshot()).conductorApiKeySource, CREDENTIAL_SOURCE.ENCRYPTED_FILE);
});

test("clears a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setConductorApiKey(TEST_API_KEY);

  const { settings } = await store.setConductorApiKey(undefined);

  assert.equal(settings.conductorApiKeySource, CREDENTIAL_SOURCE.NONE);
  assert.equal(await store.readConductorApiKey(), undefined);
  assert.equal((await readSettingsFile(directory)).includes("conductorApiKey"), false);
});

test("falls back to an API key from the environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_TOKEN]: `  ${TEST_API_KEY}  ` },
  });

  const settings = await store.snapshot();

  assert.equal(settings.conductorApiKeySource, CREDENTIAL_SOURCE.ENVIRONMENT);
  assert.equal(await store.readConductorApiKey(), TEST_API_KEY);
});

test("prefers a stored key over one from the environment", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { [TEST_ENVIRONMENT_VARIABLE.API_KEY]: "conductor-environment-key" },
  });
  await store.setConductorApiKey(TEST_API_KEY);

  assert.equal(await store.readConductorApiKey(), TEST_API_KEY);
});

test("rejects a key that cannot be sent as an authorization header", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.match((await store.setConductorApiKey("short")).reason ?? "", /too short/);
  assert.match((await store.setConductorApiKey("key with spaces")).reason ?? "", /unsupported/);
  assert.match((await store.setConductorApiKey("k".repeat(513))).reason ?? "", /too long/);
  assert.equal(await store.readConductorApiKey(), undefined);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("refuses to store a key when encrypted storage is unavailable", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { cipher: testCipher(false) });

  const { settings, reason } = await store.setConductorApiKey(TEST_API_KEY);

  assert.match(reason ?? "", /unavailable/);
  assert.equal(settings.secretStorageAvailable, false);
  assert.equal(settings.conductorApiKeySource, CREDENTIAL_SOURCE.NONE);
  await assert.rejects(() => readSettingsFile(directory), /ENOENT/);
});

test("ignores a stored key that can no longer be decrypted", async (t) => {
  const directory = await temporaryDirectory(t);
  await storeIn(directory).setConductorApiKey(TEST_API_KEY);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 1, conductorApiKey: Buffer.from("rotated").toString("base64") }),
  );

  const store = storeIn(directory);

  assert.equal(await store.readConductorApiKey(), undefined);
  assert.equal((await store.snapshot()).conductorApiKeySource, CREDENTIAL_SOURCE.NONE);
});

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { settings } = await store.setConductorApiKey(TEST_API_KEY);

  assert.equal(settings.conductorApiKeySource, CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(await store.readConductorApiKey(), TEST_API_KEY);
});
