import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import { LINK_OPEN } from "@repo/features/link-open";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import {
  type AccountPreferenceField,
  type AccountPreferences,
  AGENT_ENTER,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  accountPreferencesFromParts,
  accountPreferencesParts,
  COMMIT_AUTHOR,
  EXPERIMENT,
  type ExperimentChoices,
  MAC_COMMAND_MODE,
  SETTINGS_RESET_SCOPE,
  snapshotAccountPreferences,
  THEME,
} from "@repo/settings";
import {
  DIFF_FONT,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  INLINE_DIFF,
} from "@repo/settings/diff-view";
import {
  type AppSettings,
  appSettingsView,
  type SettingsResetScope,
  type SettingsUpdateResult,
} from "@repo/settings/wire";
import { isRecord, unparsedWire } from "@repo/wire";
import { temporaryDirectory } from "@repo/wire/testing";
import { Context, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { systemError } from "effect/PlatformError";
import { test } from "vitest";
import {
  type KeptProductEventDay,
  type SecretCipher,
  SettingsStore,
  type SettingsStoreOptions,
  type StoredAccount,
} from "./settings-store.js";
import { TEST_CIPHER_PREFIX, testCipher } from "./testing/test-cipher.js";

const SETTINGS_FILE_NAME = "settings.json";

const TEST_ACCOUNT = {
  accessToken: "access-token-secret",
  refreshToken: "refresh-token-secret",
  email: "developer@example.com",
  name: "Developer",
  provider: "github",
} as const satisfies StoredAccount;

function sealed(plainText: string): string {
  return Buffer.from(`${TEST_CIPHER_PREFIX}${plainText}`, "utf8").toString("base64");
}

const FILE_SYSTEM: FileSystem.FileSystem = Effect.runSync(
  Effect.provide(FileSystem.FileSystem, NodeFileSystem.layer),
);

const PATH: Path.Path = Effect.runSync(Effect.provide(Path.Path, NodePath.layer));

const SERVICES: Context.Context<never> = Context.empty();

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
  lastProductEventDay(
    name: string,
    discriminator: string,
    account: string,
  ): Promise<string | undefined>;
  keepProductEventDay(kept: KeptProductEventDay): Promise<void>;
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
    lastProductEventDay: (name, discriminator, account) =>
      awaited(store.lastProductEventDay(name, discriminator, account)),
    keepProductEventDay: (kept) => awaited(store.keepProductEventDay(kept)),
  };
}

function storeIn(
  directory: string,
  options: {
    cipher?: SecretCipher;
  } = {},
): PromisedSettingsStore {
  const config: SettingsStoreOptions = {
    directory: () => directory,
    cipher: options.cipher ?? testCipher(),
    fileSystem: FILE_SYSTEM,
    path: PATH,
  };
  return awaitedStoreOf(new SettingsStore(config), SERVICES);
}

async function readSettingsFile(directory: string): Promise<string> {
  return fs.readFile(path.join(directory, SETTINGS_FILE_NAME), "utf8");
}

const SAMPLE_VALUE = {
  theme: THEME.DARK,
  zoom: 150,
  openAtLogin: false,
  preferBuiltInMicrophone: false,
  macCommands: MAC_COMMAND_MODE.NEVER,
  agentEnter: AGENT_ENTER.QUEUE,
  commitAuthor: COMMIT_AUTHOR.APP,
  setupFinished: true,
  setupPlace: '{"audience":"team","at":2,"team":"workspace-ada"}',
  lineNumbers: false,
  wordWrap: false,
  diffLayout: DIFF_LAYOUT.SPLIT,
  diffIndicators: DIFF_INDICATORS.CLASSIC,
  inlineDiff: INLINE_DIFF.CHAR,
  diffBackgrounds: false,
  diffDarkTheme: "dracula",
  diffLightTheme: "one-light",
  diffFont: DIFF_FONT.MENLO,
  diffFontSize: "13",
  diffLineHeight: DIFF_LINE_HEIGHT.SPACIOUS,
  diffLigatures: true,
  diffMinimizeComments: true,
  linkOpen: LINK_OPEN.MAC_APP,
  openNewTask: false,
  usageData: false,
} satisfies { [Field in AppSettingField]: NonNullable<AppSettingValue<Field>> };

test("every setting starts at its default, survives a reopen, and can be cleared", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const fallback = APP_SETTING_SCHEMA[field].guard(undefined).value;
    const sample = SAMPLE_VALUE[field];
    const directory = await temporaryDirectory(t, "settings-");
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
    assert.deepEqual(
      appSettingsView(written.settings)[field],
      sample,
      `${field} was not drawn as it was stored`,
    );

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

it.effect(
  "a reset returns its group to the defaults but for the fields it keeps, which stand as the file holds them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("settings-");
      const opened = () =>
        new SettingsStore({
          directory: () => directory,
          cipher: testCipher(),
          fileSystem: FILE_SYSTEM,
          path: PATH,
        });
      const store = opened();
      yield* store.set("theme", THEME.DARK);
      yield* store.set("zoom", 125);

      const reset = yield* store.resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE, ["zoom"]);

      assert.equal(reset.reason, undefined);
      const reopened = opened();
      assert.equal(yield* reopened.get("theme"), undefined);
      assert.equal(yield* reopened.get("zoom"), 125);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "Open Vespin at login, which stands on This Mac, keeps the choice already stored through a reopen and through Appearance's reset",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("settings-");
      const opened = () =>
        new SettingsStore({
          directory: () => directory,
          cipher: testCipher(),
          fileSystem: FILE_SYSTEM,
          path: PATH,
        });
      yield* opened().set("openAtLogin", false);
      yield* opened().set("theme", THEME.DARK);

      const reset = yield* opened().resetSettings(SETTINGS_RESET_SCOPE.APPEARANCE, []);

      assert.equal(reset.reason, undefined);
      const reopened = opened();
      assert.equal(yield* reopened.get("theme"), undefined);
      assert.equal(yield* reopened.get("openAtLogin"), false);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "usage data is shared by default in a packaged build, not in a run from source, and as chosen in either",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("settings-");
      const opened = (packaged: boolean) =>
        new SettingsStore({
          directory: () => directory,
          cipher: testCipher(),
          packaged,
          fileSystem: FILE_SYSTEM,
          path: PATH,
        });
      const shared = (packaged: boolean) =>
        Effect.map(opened(packaged).snapshot(), (snapshot) => snapshot.stored.usageData);

      assert.equal(yield* shared(true), true);
      assert.equal(yield* shared(false), false);

      yield* opened(false).set("usageData", true);
      assert.equal(yield* shared(false), true);
      yield* opened(true).set("usageData", false);
      assert.equal(yield* shared(true), false);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

test("the Mac commands switch an earlier build stored reads as a mode: on as Ask, off as Never", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
  await storeIn(directory).set("macCommands", MAC_COMMAND_MODE.ALWAYS);
  const file = path.join(directory, SETTINGS_FILE_NAME);
  const stored = await readSettingsFile(directory);
  assert.ok(stored.includes(`"${MAC_COMMAND_MODE.ALWAYS}"`));

  await fs.writeFile(file, stored.replace(`"${MAC_COMMAND_MODE.ALWAYS}"`, "true"));
  assert.equal(await storeIn(directory).get("macCommands"), MAC_COMMAND_MODE.ASK);

  await fs.writeFile(file, stored.replace(`"${MAC_COMMAND_MODE.ALWAYS}"`, "false"));
  assert.equal(await storeIn(directory).get("macCommands"), MAC_COMMAND_MODE.NEVER);
});

test.for([
  { setting: "the notifications switch", field: "agentNotifications" },
  { setting: "Run agents on this Mac", field: "localAgents" },
  { setting: "Each repository's run command", field: "macRepositories" },
])(
  "$setting, which an earlier build stored, is let go unread, and the choices beside it stay",
  async ({ field }, t) => {
    const directory = await temporaryDirectory(t, "settings-");
    await storeIn(directory).set("theme", THEME.DARK);
    const file = path.join(directory, SETTINGS_FILE_NAME);
    const stored = JSON.parse(await readSettingsFile(directory));
    await fs.writeFile(file, JSON.stringify({ ...stored, [field]: false }));

    const reopened = storeIn(directory);
    assert.equal(await reopened.get("theme"), THEME.DARK);
    assert.equal(field in appSettingsView(await reopened.snapshot()), false);
  },
);

test("every provider key an earlier build stored is dropped, and the choices beside it stay", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
  await storeIn(directory).set("theme", THEME.DARK);
  const file = path.join(directory, SETTINGS_FILE_NAME);
  const stored = JSON.parse(await readSettingsFile(directory));
  await fs.writeFile(
    file,
    JSON.stringify({ ...stored, apiKeys: { "provider-a": "c2VhbGVk", "provider-b": "c2VhbGVk" } }),
  );

  const reopened = storeIn(directory);
  await reopened.retireStoredApiKeys();

  const written = JSON.parse(await readSettingsFile(directory));
  assert.equal("apiKeys" in written, false);
  assert.equal(await storeIn(directory).get("theme"), THEME.DARK);
});

test("a stored account and a chosen preference survive each other's writes", async (t) => {
  for (const field of APP_SETTING_FIELDS) {
    const directory = await temporaryDirectory(t, "settings-");
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

test("the day a usage count was sent survives a reopen and a sign-out, by account, and only the newest day stays", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
  const store = storeIn(directory);
  const dayActive = { name: "app:day_active", discriminator: "day" } as const;

  await store.setAccount(TEST_ACCOUNT);
  await store.keepProductEventDay({ ...dayActive, account: "ada@app.test", day: "2026-08-19" });
  await store.keepProductEventDay({ ...dayActive, account: "grace@app.test", day: "2026-08-19" });
  await store.clearAccount();

  const reopened = storeIn(directory);
  assert.equal(
    await reopened.lastProductEventDay("app:day_active", "day", "ada@app.test"),
    "2026-08-19",
  );
  assert.equal(
    await reopened.lastProductEventDay("app:day_active", "day", "grace@app.test"),
    "2026-08-19",
  );
  assert.equal(await reopened.lastProductEventDay("app:launch", "day", "ada@app.test"), undefined);

  await reopened.keepProductEventDay({ ...dayActive, account: "ada@app.test", day: "2026-08-20" });
  const nextDay = storeIn(directory);
  assert.equal(
    await nextDay.lastProductEventDay("app:day_active", "day", "ada@app.test"),
    "2026-08-20",
  );
  assert.equal(
    await nextDay.lastProductEventDay("app:day_active", "day", "grace@app.test"),
    undefined,
  );
  assert.ok(!(await readSettingsFile(directory)).includes("grace@app.test"));
});

test("round-trips an encrypted account without exposing either token in snapshots", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
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
  assert.equal(stats.mode & 0o777, 0o600);
  assert.equal(contents.includes(TEST_ACCOUNT.accessToken), false);
  assert.equal(contents.includes(TEST_ACCOUNT.refreshToken), false);
  const settings = JSON.stringify(await reopened.snapshot());
  assert.equal(settings.includes(TEST_ACCOUNT.accessToken), false);
  assert.equal(settings.includes(TEST_ACCOUNT.refreshToken), false);
});

test("an account's ciphertext is kept as the standard base64 of the cipher's bytes, as earlier builds wrote it", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
  await storeIn(directory).setAccount(TEST_ACCOUNT);

  const written = unparsedWire(JSON.parse(await readSettingsFile(directory)));
  const tokens = { accessToken: TEST_ACCOUNT.accessToken, refreshToken: TEST_ACCOUNT.refreshToken };

  assert.ok(isRecord(written) && isRecord(written.account), "the file holds an account");
  assert.equal(written.account.tokenCipher, sealed(JSON.stringify(tokens)));
});

test("the Mac's session rides sealed beside the OAuth tokens, and reads back with them", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
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
  await reopened.setAccount(TEST_ACCOUNT);
  assert.deepEqual(await storeIn(directory).readAccount(), TEST_ACCOUNT);
});

test("a stored account that signed in with Google still loads", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
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

it.effect(
  "refuses to store an account when encrypted storage is unavailable, as a typed failure",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("settings-");
      const store = new SettingsStore({
        directory: () => directory,
        cipher: testCipher(false),
        fileSystem: FILE_SYSTEM,
        path: PATH,
      });

      const refused = yield* Effect.flip(store.setAccount(TEST_ACCOUNT));

      assert.equal(refused._tag, "EncryptedStorageUnavailable");
      assert.deepEqual(yield* store.accountSnapshot(), { status: ACCOUNT_STATUS.SIGNED_OUT });
      assert.equal(yield* FILE_SYSTEM.exists(path.join(directory, SETTINGS_FILE_NAME)), false);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);

function throughSnapshot(preferences: AccountPreferences): AccountPreferences | undefined {
  const wire = unparsedWire(JSON.parse(JSON.stringify(accountPreferencesParts(preferences))));
  return isRecord(wire) ? accountPreferencesFromParts(wire) : undefined;
}

test("a link choice made on one Mac reaches another through the snapshot", async (t) => {
  const chooser = storeIn(await temporaryDirectory(t, "settings-"));
  await chooser.setAccount(TEST_ACCOUNT);
  await chooser.set("linkOpen", LINK_OPEN.MAC_APP);

  const other = storeIn(await temporaryDirectory(t, "settings-"));
  await other.setAccount(TEST_ACCOUNT);
  const baseline = await other.accountPreferences();
  await other.setAccountPreferencesSyncBaseline(TEST_ACCOUNT.email, baseline);

  const remote = throughSnapshot(await chooser.accountPreferences());
  assert.ok(remote, "the snapshot's parts did not read back");
  const applied = await other.applyAccountPreferences(remote, {
    accountEmail: TEST_ACCOUNT.email,
    preferences: baseline,
  });

  assert.ok(applied.changed.includes("linkOpen"));
  assert.equal(await other.get("linkOpen"), LINK_OPEN.MAC_APP);
  assert.equal(appSettingsView(await other.snapshot()).linkOpen, LINK_OPEN.MAC_APP);
});

test("a Mac takes the web's newer link choice over the one it last synced, and keeps one it made since", async (t) => {
  const synced = { linkOpen: LINK_OPEN.BROWSER };
  const remote = { linkOpen: LINK_OPEN.MAC_APP };

  const untouched = storeIn(await temporaryDirectory(t, "settings-"));
  await untouched.setAccount(TEST_ACCOUNT);
  await untouched.set("linkOpen", LINK_OPEN.BROWSER);
  await untouched.applyAccountPreferences(
    snapshotAccountPreferences(remote, false, await untouched.accountPreferences()),
    { accountEmail: TEST_ACCOUNT.email, preferences: synced },
  );
  assert.equal(await untouched.get("linkOpen"), LINK_OPEN.MAC_APP);

  const changed = storeIn(await temporaryDirectory(t, "settings-"));
  await changed.setAccount(TEST_ACCOUNT);
  await changed.set("linkOpen", LINK_OPEN.BROWSER);
  await changed.applyAccountPreferences(
    snapshotAccountPreferences(remote, false, await changed.accountPreferences()),
    { accountEmail: TEST_ACCOUNT.email, preferences: {} },
  );
  assert.equal(await changed.get("linkOpen"), LINK_OPEN.BROWSER);
});

test("a first link choice made before the first sync is kept to be written, whether or not a shared part was written", async (t) => {
  for (const sharedWritten of [false, true]) {
    const mac = storeIn(await temporaryDirectory(t, "settings-"));
    await mac.setAccount(TEST_ACCOUNT);
    await mac.set("linkOpen", LINK_OPEN.MAC_APP);
    const baseline = await mac.accountPreferences();

    await mac.applyAccountPreferences(
      snapshotAccountPreferences({}, sharedWritten, await mac.accountPreferences()),
      { accountEmail: TEST_ACCOUNT.email, preferences: baseline },
    );

    assert.equal(
      await mac.get("linkOpen"),
      LINK_OPEN.MAC_APP,
      `shared part written: ${sharedWritten}`,
    );
    assert.deepEqual(
      accountPreferencesParts(await mac.accountPreferences()).linkOpen,
      LINK_OPEN.MAC_APP,
    );
  }
});

test("the experiments the service answered stand for the account signed in, across a reopen", async (t) => {
  const directory = await temporaryDirectory(t, "settings-");
  const store = storeIn(directory);
  await store.setAccount(TEST_ACCOUNT);
  const memoryOn = { [EXPERIMENT.MEMORY]: true };

  assert.deepEqual((await store.snapshot()).experiments, {});
  assert.equal(await store.cacheExperiments(TEST_ACCOUNT.email, memoryOn), true);
  assert.deepEqual((await store.snapshot()).experiments, memoryOn);
  assert.deepEqual((await storeIn(directory).snapshot()).experiments, memoryOn);

  assert.equal(await store.cacheExperiments(TEST_ACCOUNT.email, memoryOn), false);
  assert.equal(await store.cacheExperiments("someone-else@example.com", {}), false);
  assert.deepEqual((await store.snapshot()).experiments, memoryOn);
});

test("a sign-out, or another account's sign-in, leaves no experiment of the last account on", async (t) => {
  const memoryOn = { [EXPERIMENT.MEMORY]: true };

  const signedOut = await temporaryDirectory(t, "settings-");
  const store = storeIn(signedOut);
  await store.setAccount(TEST_ACCOUNT);
  await store.cacheExperiments(TEST_ACCOUNT.email, memoryOn);
  await store.clearAccount();
  assert.deepEqual((await store.snapshot()).experiments, {});
  await store.setAccount(TEST_ACCOUNT);
  assert.deepEqual((await storeIn(signedOut).snapshot()).experiments, {});

  const switched = await temporaryDirectory(t, "settings-");
  const other = storeIn(switched);
  await other.setAccount(TEST_ACCOUNT);
  await other.cacheExperiments(TEST_ACCOUNT.email, memoryOn);
  await other.setAccount({ ...TEST_ACCOUNT, email: "teammate@example.com" });
  assert.deepEqual((await storeIn(switched).snapshot()).experiments, {});
});

it.effect("two stores on one file, as two browser tabs are, each keep the other's change", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("settings-tabs-");
    const tab = () =>
      new SettingsStore({
        directory: () => directory,
        cipher: undefined,
        fileSystem: FILE_SYSTEM,
        path: PATH,
      });
    const first = tab();
    const second = tab();
    yield* first.snapshot();
    yield* second.snapshot();

    yield* first.set("theme", THEME.DARK);
    yield* second.set("zoom", 150);

    const reopened = (yield* tab().snapshot()).stored;
    assert.equal(reopened.theme, THEME.DARK);
    assert.equal(reopened.zoom, 150);
  }).pipe(Effect.provide(NodeFileSystem.layer)),
);

function flakyReads(failing: { reads: boolean }): FileSystem.FileSystem {
  return {
    ...FILE_SYSTEM,
    readFileString: (filePath, encoding) =>
      failing.reads
        ? Effect.fail(
            systemError({
              _tag: "Unknown",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: filePath,
              cause: Object.assign(new Error("EIO: i/o error"), { code: "EIO" }),
            }),
          )
        : FILE_SYSTEM.readFileString(filePath, encoding),
  };
}

it.effect(
  "the file's one writer, as the desktop is, writes over its held copy when the read before a write fails, and one of several writers does not",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("settings-");
      const failing = { reads: false };
      const storeOf = (writer?: string) =>
        new SettingsStore({
          directory: () => directory,
          cipher: undefined,
          fileSystem: flakyReads(failing),
          path: PATH,
          ...(writer === undefined ? undefined : { writer }),
        });
      const desktop = storeOf();
      const tab = storeOf("tab-1");
      yield* desktop.snapshot();
      yield* tab.snapshot();

      failing.reads = true;
      yield* desktop.set("theme", THEME.DARK);
      const refused = yield* Effect.flip(tab.set("zoom", 150));
      failing.reads = false;

      assert.equal(refused._tag, "PlatformError");
      const reopened = (yield* storeOf().snapshot()).stored;
      assert.equal(reopened.theme, THEME.DARK);
      assert.notEqual(reopened.zoom, 150);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
);
