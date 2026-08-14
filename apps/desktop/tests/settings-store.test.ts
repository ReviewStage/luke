import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  PANEL_FORM_FACTOR,
  REALTIME_DEFAULTS,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
} from "@sidecar/core";
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

test("captions are off until switched on, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference is not a credential, so choosing it must reach the Keychain
  // not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal((await store.snapshot()).voiceCaptions, false);
  const enabled = await store.setVoiceCaptions(true);

  assert.equal(enabled.settings.voiceCaptions, true);
  assert.equal((await storeIn(directory).snapshot()).voiceCaptions, true);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("switching captions never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.setVoiceCaptions(true);
  const off = await store.setVoiceCaptions(false);

  assert.equal(off.settings.voiceCaptions, false);
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("a corrupt captions value reads as off rather than switching them on", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voiceCaptions: "yes" }),
    "utf8",
  );

  assert.equal((await storeIn(directory).snapshot()).voiceCaptions, false);
});

test("other media is quieted until asked otherwise, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference is not a credential, so choosing it must reach the Keychain
  // not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal((await store.snapshot()).duckOtherMedia, true);
  const disabled = await store.setDuckOtherMedia(false);

  assert.equal(disabled.settings.duckOtherMedia, false);
  assert.equal((await storeIn(directory).snapshot()).duckOtherMedia, false);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("switching the media duck never disturbs a stored key", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);
  await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  await store.setDuckOtherMedia(false);
  const on = await store.setDuckOtherMedia(true);

  assert.equal(on.settings.duckOtherMedia, true);
  assert.equal(await storeIn(directory).readApiKey(CONDUCTOR), TEST_API_KEY);
});

test("a corrupt media duck value reads as the default rather than as off", async (t) => {
  const directory = await temporaryDirectory(t);
  // The mirror of the captions rule: each lands on its own default, and this
  // one's default is on.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, duckOtherMedia: "no" }),
    "utf8",
  );

  assert.equal((await storeIn(directory).snapshot()).duckOtherMedia, true);
});

test("sessions notify until asked otherwise, and the choice survives a reopen", async (t) => {
  const directory = await temporaryDirectory(t);
  // A preference like the duck's: choosing it must reach the Keychain not at all.
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal((await store.snapshot()).sessionNotifications, true);
  assert.equal(await store.readSessionNotifications(), true);
  const disabled = await store.setSessionNotifications(false);

  assert.equal(disabled.settings.sessionNotifications, false);
  assert.equal((await storeIn(directory).snapshot()).sessionNotifications, false);
  assert.equal(await storeIn(directory).readSessionNotifications(), false);
  assert.equal(cipher.calls.isAvailable, 0);
  assert.equal(cipher.calls.encrypt, 0);
});

test("a corrupt notification value reads as the default rather than as off", async (t) => {
  const directory = await temporaryDirectory(t);
  // The duck's rule again: this switch's default is on, so nonsense lands on on.
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, sessionNotifications: "no" }),
    "utf8",
  );

  assert.equal((await storeIn(directory).snapshot()).sessionNotifications, true);
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
    // Written even at their defaults, so the file states what they are rather
    // than leaving them to be inferred from an absence.
    showInDock: false,
    showInMenuBar: true,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
    showOnAllDisplays: false,
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
    showInDock: false,
    showInMenuBar: true,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
    showOnAllDisplays: false,
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
    showInDock: false,
    showInMenuBar: true,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
    showOnAllDisplays: false,
  });
});

test("shows the menu bar item until asked otherwise, and remembers the answer", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).showInMenuBar, true);

  const { settings, reason } = await store.setShowInMenuBar(false);

  assert.equal(reason, undefined);
  assert.equal(settings.showInMenuBar, false);
  assert.deepEqual(JSON.parse(await readSettingsFile(directory)), {
    version: 2,
    apiKeys: {},
    showInDock: false,
    showInMenuBar: false,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
    showOnAllDisplays: false,
  });
  // The choice outlives the run that heard it.
  assert.equal((await storeIn(directory).snapshot()).showInMenuBar, false);
});

test("changes the menu bar preference without touching the cipher", async (t) => {
  // A preference is not a credential, so storing one must never be the reason
  // the Keychain dialog appears.
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setShowInMenuBar(false);

  assert.equal(settings.showInMenuBar, false);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
});

test("keeps stored keys when the menu bar preference changes beside them", async (t) => {
  // The preference and a key share the settings file, so a save of one racing a
  // save of the other must drop neither.
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, { providers: TEST_PROVIDERS });

  await Promise.all([
    store.setApiKey(FIRST_CLOUD, "first-cloud-key"),
    store.setShowInMenuBar(false),
  ]);

  assert.equal(await store.readApiKey(FIRST_CLOUD), "first-cloud-key");
  assert.equal((await store.snapshot()).showInMenuBar, false);
});

test("decides the menu bar item from the file alone, never the keychain", async (t) => {
  // The status item is drawn at launch from this answer, so a locked or slow
  // Keychain — which decrypting a stored key can wait on — must not be able to
  // delay it.
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({
      version: 2,
      apiKeys: { [CONDUCTOR]: sealed(TEST_API_KEY) },
      showInMenuBar: false,
    }),
  );
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.showInMenuBar(), false);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("shows the menu bar item when the file says something a boolean is not", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showInMenuBar: "sometimes" }),
  );

  assert.equal((await storeIn(directory).snapshot()).showInMenuBar, true);
});

test("keeps Luke out of the Dock until asked, and remembers the answer", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).showInDock, false);

  const { settings, reason } = await store.setShowInDock(true);

  assert.equal(reason, undefined);
  assert.equal(settings.showInDock, true);
  assert.deepEqual(JSON.parse(await readSettingsFile(directory)), {
    version: 2,
    apiKeys: {},
    showInDock: true,
    showInMenuBar: true,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
    showOnAllDisplays: false,
  });
  // The choice outlives the run that heard it.
  assert.equal((await storeIn(directory).snapshot()).showInDock, true);
});

test("changes the Dock preference without touching the cipher", async (t) => {
  // A preference is not a credential, so storing one must never be the reason
  // the Keychain dialog appears.
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setShowInDock(true);

  assert.equal(settings.showInDock, true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(settings.secretStorage, SECRET_STORAGE.UNKNOWN);
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

  assert.equal(await store.showInDock(), true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("keeps Luke out of the Dock when the file says something a boolean is not", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showInDock: "always" }),
  );

  assert.equal((await storeIn(directory).snapshot()).showInDock, false);
});

test("reports the default voice until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(await store.readVoice(), undefined);
});

test("stores the chosen voice plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.setVoice(REALTIME_VOICE.MARIN);

  assert.equal(reason, undefined);
  assert.equal(settings.voice, REALTIME_VOICE.MARIN);
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readVoice(), REALTIME_VOICE.MARIN);
});

test("prefers the chosen voice over the environment, and the environment over the default", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { LUKE_REALTIME_VOICE: REALTIME_VOICE.SAGE },
  });

  assert.equal((await store.snapshot()).voice, REALTIME_VOICE.SAGE);
  // The environment names the voice only until the user does, so it is
  // reported in the snapshot but never as something the user stored.
  assert.equal(await store.readVoice(), undefined);

  await store.setVoice(REALTIME_VOICE.MARIN);
  assert.equal((await store.snapshot()).voice, REALTIME_VOICE.MARIN);

  await store.setVoice(undefined);
  assert.equal((await store.snapshot()).voice, REALTIME_VOICE.SAGE);
});

test("ignores a stored or environment voice this build does not offer", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voice: "baritone" }),
  );
  const store = storeIn(directory, { environment: { LUKE_REALTIME_VOICE: "baritone" } });

  assert.equal(await store.readVoice(), undefined);
  assert.equal((await store.snapshot()).voice, REALTIME_DEFAULTS.VOICE);
});

test("reports the natural pace until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).voiceSpeed, REALTIME_DEFAULTS.SPEED);
  assert.equal(await store.readVoiceSpeed(), undefined);
});

test("stores the chosen pace plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.setVoiceSpeed(REALTIME_VOICE_SPEED.QUICK);

  assert.equal(reason, undefined);
  assert.equal(settings.voiceSpeed, REALTIME_VOICE_SPEED.QUICK);
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readVoiceSpeed(), REALTIME_VOICE_SPEED.QUICK);
});

test("prefers the chosen pace over the environment, and the environment over the default", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory, {
    environment: { LUKE_REALTIME_SPEED: String(REALTIME_VOICE_SPEED.SLOW) },
  });

  assert.equal((await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.SLOW);
  assert.equal(await store.readVoiceSpeed(), undefined);

  await store.setVoiceSpeed(REALTIME_VOICE_SPEED.FAST);
  assert.equal((await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.FAST);

  await store.setVoiceSpeed(undefined);
  assert.equal((await store.snapshot()).voiceSpeed, REALTIME_VOICE_SPEED.SLOW);
});

test("ignores a stored or environment pace this build does not offer", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, voiceSpeed: 3 }),
  );
  const store = storeIn(directory, { environment: { LUKE_REALTIME_SPEED: "0.1" } });

  assert.equal(await store.readVoiceSpeed(), undefined);
  assert.equal((await store.snapshot()).voiceSpeed, REALTIME_DEFAULTS.SPEED);
});

test("reports no talk-key chord until one is chosen", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal(await store.readVoiceHotkey(), undefined);
  assert.equal((await store.snapshot()).voiceHotkey, undefined);
});

test("stores the chosen talk-key chord plainly and reads it back from a new store instance", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings, reason } = await store.setVoiceHotkey("Shift+Command+L");

  assert.equal(reason, undefined);
  assert.equal(settings.voiceHotkey, "Shift+Command+L");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readVoiceHotkey(), "Shift+Command+L");
});

test("clearing the talk-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setVoiceHotkey("Shift+Command+L");
  const { settings } = await store.setVoiceHotkey(undefined);

  assert.equal(settings.voiceHotkey, undefined);
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).readVoiceHotkey(), undefined);
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
  assert.equal(await store.readVoiceHotkey(), undefined);
  assert.equal((await store.snapshot()).voiceHotkey, undefined);
});

test("stores the chosen ask-key chord on the talk key's terms and reads it back", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.readAskHotkey(), undefined);
  assert.equal((await store.snapshot()).askHotkey, undefined);

  const { settings, reason } = await store.setAskHotkey("Control+Alt+K");

  assert.equal(reason, undefined);
  assert.equal(settings.askHotkey, "Control+Alt+K");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readAskHotkey(), "Control+Alt+K");
});

test("clearing the ask-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setAskHotkey("Control+Alt+K");
  const { settings } = await store.setAskHotkey(undefined);

  assert.equal(settings.askHotkey, undefined);
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).readAskHotkey(), undefined);
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
  assert.equal(await store.readAskHotkey(), undefined);
  assert.equal((await store.snapshot()).askHotkey, undefined);
});

test("stores the chosen stop-key chord on the other keys' terms and reads it back", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  assert.equal(await store.readStopHotkey(), undefined);
  assert.equal((await store.snapshot()).stopHotkey, undefined);

  const { settings, reason } = await store.setStopHotkey("Control+Alt+X");

  assert.equal(reason, undefined);
  assert.equal(settings.stopHotkey, "Control+Alt+X");
  // A preference is not a credential, so choosing one never reaches the
  // Keychain — and never raises its permission dialog.
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
  assert.equal(await storeIn(directory).readStopHotkey(), "Control+Alt+X");
});

test("clearing the stop-key chord returns to no choice at all", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setStopHotkey("Control+Alt+X");
  const { settings } = await store.setStopHotkey(undefined);

  assert.equal(settings.stopHotkey, undefined);
  // Absent from the file rather than stored as an empty value: reset is the
  // absence of a choice, and a reopened store must read it the same way.
  assert.equal(await storeIn(directory).readStopHotkey(), undefined);
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
  assert.equal(await store.readStopHotkey(), undefined);
  assert.equal((await store.snapshot()).stopHotkey, undefined);
});

test("the three Luke keys survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setVoiceHotkey("Control+Alt+Space");
  await store.setAskHotkey("Control+Alt+K");
  await store.setStopHotkey("Control+Alt+X");

  const reopened = storeIn(directory);
  assert.equal(await reopened.readVoiceHotkey(), "Control+Alt+Space");
  assert.equal(await reopened.readAskHotkey(), "Control+Alt+K");
  assert.equal(await reopened.readStopHotkey(), "Control+Alt+X");
});

test("the talk-key chord and a stored key survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.setVoiceHotkey("Control+Alt+Space");
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-replacement-key");
  assert.equal(await reopened.readVoiceHotkey(), "Control+Alt+Space");
});

test("keeps Luke to the main display until asked, and remembers the answer", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).showOnAllDisplays, false);
  assert.equal(await store.readShowOnAllDisplays(), false);

  const { settings, reason } = await store.setShowOnAllDisplays(true);

  assert.equal(reason, undefined);
  assert.equal(settings.showOnAllDisplays, true);
  // The choice outlives the run that heard it.
  assert.equal(await storeIn(directory).readShowOnAllDisplays(), true);
});

test("changes the displays preference without touching the cipher", async (t) => {
  // A preference is not a credential, so storing one must never be the reason
  // the Keychain dialog appears.
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setShowOnAllDisplays(true);

  assert.equal(settings.showOnAllDisplays, true);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("keeps Luke to the main display when the file says something a boolean is not", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, showOnAllDisplays: "every one of them" }),
  );

  assert.equal(await storeIn(directory).readShowOnAllDisplays(), false);
});

test("draws the bubble until a form is chosen, and remembers the choice", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  assert.equal((await store.snapshot()).formFactor, PANEL_FORM_FACTOR.BUBBLE);
  assert.equal(await store.readFormFactor(), undefined);

  const { settings, reason } = await store.setFormFactor(PANEL_FORM_FACTOR.NOTCH);

  assert.equal(reason, undefined);
  assert.equal(settings.formFactor, PANEL_FORM_FACTOR.NOTCH);
  // The choice outlives the run that heard it.
  assert.equal(await storeIn(directory).readFormFactor(), PANEL_FORM_FACTOR.NOTCH);
});

test("changes the form without touching the cipher", async (t) => {
  const directory = await temporaryDirectory(t);
  const cipher = countingCipher();
  const store = storeIn(directory, { cipher });

  const { settings } = await store.setFormFactor(PANEL_FORM_FACTOR.NOTCH);

  assert.equal(settings.formFactor, PANEL_FORM_FACTOR.NOTCH);
  assert.deepEqual(cipher.calls, { isAvailable: 0, encrypt: 0, decrypt: 0 });
});

test("ignores a stored form this build does not draw", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(
    path.join(directory, SETTINGS_FILE_NAME),
    JSON.stringify({ version: 2, apiKeys: {}, formFactor: "hexagon" }),
  );

  assert.equal(await storeIn(directory).readFormFactor(), undefined);
  assert.equal((await storeIn(directory).snapshot()).formFactor, PANEL_FORM_FACTOR.BUBBLE);
});

test("the voice and a stored key survive each other's writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = storeIn(directory);

  await store.setApiKey(CONDUCTOR, TEST_API_KEY);
  await store.setVoice(REALTIME_VOICE.MARIN);
  await store.setApiKey(CONDUCTOR, "conductor-replacement-key");

  const reopened = storeIn(directory);
  assert.equal(await reopened.readApiKey(CONDUCTOR), "conductor-replacement-key");
  assert.equal(await reopened.readVoice(), REALTIME_VOICE.MARIN);
});

test("recovers from a corrupt settings file", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.writeFile(path.join(directory, SETTINGS_FILE_NAME), "{ not json");
  const store = storeIn(directory);

  const { settings } = await store.setApiKey(CONDUCTOR, TEST_API_KEY);

  assert.equal(settings.credentialSources[CONDUCTOR], CREDENTIAL_SOURCE.ENCRYPTED_FILE);
  assert.equal(await store.readApiKey(CONDUCTOR), TEST_API_KEY);
});
