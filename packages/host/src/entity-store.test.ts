import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import type { QueuedEntry } from "@repo/sync";
import { Effect, Exit, Layer, Path, Result, Scope } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import {
  ENTITY_DATABASE_FILE_NAME,
  ENTITY_KEY_FILE_NAME,
  ENTITY_SEALED_FILE_NAME,
  type EntityStoreOptions,
  KEPT_READ,
  type KeptRows,
  openEntityStore,
  type SqliteDriverSeam,
} from "./entity-store.js";
import { planListRow } from "./testing/task-list-rows.js";
import { testCipher } from "./testing/test-cipher.js";
import { testSqliteDriver, unloadableSqliteDriver } from "./testing/test-sqlite-driver.js";

/**
 * The account's lists kept on disk, in a database under a state root of the
 * test's own, a cipher standing in for the Keychain's: what a store kept
 * comes back to the same account at the same row shapes, row by row as it
 * moved, and a database kept for another account, or at other row shapes,
 * draws nothing; the sealed file a build before the database kept is written
 * into it once. Synthetic accounts and rows throughout.
 */

const DANA = "user-dana";
const RAVI = "user-ravi";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "0c1e8a52-6d3f-4b8e-8f0a-2a9d4e7c5b31";

/** The task list as one answer left it, read at sync id 7. */
const LIST: KeptRows[typeof KEPT_READ.TASK_LIST] = {
  rows: { plans: [planListRow(INVITES, "Teammate invitations")], agents: [] },
  at: "7",
};

/** A rename made while the service could not be reached, as the engine hands it out. */
const RENAME: QueuedEntry = {
  name: "tasks.rename",
  key: "rename-key",
  input: { taskId: INVITES, name: "Invitations" },
};

/** A store opened over `directory` for `accountId` in a scope of its own, which the test closes as a quit does. */
function opened(directory: string, accountId: string, options: Partial<EntityStoreOptions> = {}) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const store = yield* Scope.provide(scope)(
      openEntityStore({
        directory,
        cipher: testCipher(),
        driver: testSqliteDriver(),
        accountId,
        ...options,
      }),
    );
    if (store === undefined) return yield* Effect.die("the store did not open");
    return { store, closed: Scope.close(scope, Exit.void) };
  });
}

/** The database under `directory` opened beside the store as a second connection, under the key the store sealed, closed with the test's scope. */
const database = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sealed = yield* fileSystem.readFileString(path.join(directory, ENTITY_KEY_FILE_NAME));
    const key = testCipher().decrypt(Result.getOrThrow(Base64.decode(sealed)));
    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        const opened = testSqliteDriver().open(path.join(directory, ENTITY_DATABASE_FILE_NAME));
        opened.pragma(`key = '${key}'`);
        return opened;
      }),
      (opened) => Effect.sync(() => opened.close()),
    );
  });

/** The driver, recording the id of each row of a kept read it writes. */
function recordingDriver(): { readonly driver: SqliteDriverSeam; readonly rows: string[] } {
  const rows: string[] = [];
  const base = testSqliteDriver();
  const driver: SqliteDriverSeam = {
    open: (file) => {
      const opened = base.open(file);
      return {
        prepare: (source) => {
          const statement = opened.prepare(source);
          if (!source.startsWith("INSERT OR REPLACE INTO kept_row")) return statement;
          return {
            run: (...parameters) => {
              rows.push(String(parameters[3]));
              return statement.run(...parameters);
            },
            get: (...parameters) => statement.get(...parameters),
            all: (...parameters) => statement.all(...parameters),
          };
        },
        transaction: (run) => opened.transaction(run),
        exec: (source) => opened.exec(source),
        pragma: (source, options) => opened.pragma(source, options),
        close: () => opened.close(),
      };
    },
  };
  return { driver, rows };
}

/** The bytes of the database and its log under `directory`, as they stand on disk. */
const onDisk = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const file = (yield* Path.Path).join(directory, ENTITY_DATABASE_FILE_NAME);
    const log = yield* Effect.orElseSucceed(fileSystem.readFile(`${file}-wal`), () => []);
    return Buffer.concat([yield* fileSystem.readFile(file), Buffer.from(log)]);
  });

it.effect.each([
  { kept: "the same account at the same row shapes", reopenedAs: DANA, otherShapes: false },
  { kept: "another account", reopenedAs: RAVI, otherShapes: false },
  { kept: "other row shapes", reopenedAs: DANA, otherShapes: true },
])("a database kept for $kept", ({ reopenedAs, otherShapes }) =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const first = yield* opened(directory, DANA, { queued: () => [RENAME] });
    yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
    yield* first.closed;
    if (otherShapes) {
      const kept = yield* database(directory);
      kept.prepare("UPDATE meta SET value = ? WHERE name = ?").run("another build's", "shapesHash");
    }

    const reopened = yield* opened(directory, reopenedAs);

    const fits = reopenedAs === DANA && !otherShapes;
    assert.deepEqual(reopened.store.stored(KEPT_READ.TASK_LIST), fits ? LIST : undefined);
    // Note that the account's own waiting writes outlast other row shapes, and another account's are never sent.
    assert.deepEqual(reopened.store.queue, reopenedAs === DANA ? [RENAME] : []);
  }).pipe(Effect.provide(files)),
);

it.effect("only the rows that moved are written, within a second, and none in the clear", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const { driver, rows } = recordingDriver();
    const { store } = yield* opened(directory, DANA, { driver });
    const invites = planListRow(INVITES, "Teammate invitations");
    const billing = planListRow(BILLING, "Billing export");
    yield* store.keep(KEPT_READ.TASK_LIST, {
      rows: { plans: [invites, billing], agents: [] },
      at: "7",
    });
    yield* TestClock.adjust("1 second");
    const first = rows.splice(0);

    yield* store.keep(KEPT_READ.TASK_LIST, {
      rows: { plans: [invites, { ...billing, name: "Billing exports" }], agents: [] },
      at: "8",
    });
    yield* TestClock.adjust("1 second");

    assert.deepEqual(first, [INVITES, BILLING]);
    assert.deepEqual(rows, [BILLING]);
    assert.equal((yield* onDisk(directory)).includes("Billing exports"), false);
  }).pipe(Effect.provide(files)),
);

it.effect(
  "a write waiting for the service is on disk within a second, before the store closes",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      yield* opened(directory, DANA, { queued: () => [RENAME] });

      yield* TestClock.adjust("1 second");
      const kept = yield* database(directory);

      assert.deepEqual(kept.prepare("SELECT key FROM queued_write").all(), [{ key: RENAME.key }]);
    }).pipe(Effect.provide(files)),
);

it.effect("the writes waiting at the last launch stay on disk until the pool takes them back", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const first = yield* opened(directory, DANA, { queued: () => [RENAME] });
    yield* first.closed;
    let waiting: readonly QueuedEntry[] = [];

    const relaunched = yield* opened(directory, DANA, { queued: () => waiting });
    const meanwhile = (yield* database(directory)).prepare("SELECT key FROM queued_write").all();
    waiting = relaunched.store.queue;
    yield* TestClock.adjust("1 second");

    assert.deepEqual(meanwhile, [{ key: RENAME.key }]);
  }).pipe(Effect.provide(files)),
);

it.effect.each([
  { sealedFor: "this account at these row shapes", accountId: DANA, otherShapes: false },
  { sealedFor: "this account at other row shapes", accountId: DANA, otherShapes: true },
  { sealedFor: "another account", accountId: RAVI, otherShapes: false },
])("a sealed file a build before kept for $sealedFor", ({ accountId, otherShapes }) =>
  Effect.gen(function* () {
    // The shapes this build keeps at, as a database it made names them.
    const earlier = yield* temporaryDirectoryScoped("entity-store-");
    yield* Effect.flatMap(opened(earlier, DANA), (store) => store.closed);
    const meta = (yield* database(earlier))
      .prepare("SELECT value FROM meta WHERE name = ?")
      .get("shapesHash");
    const hash = otherShapes ? "another build's" : (meta as { value: string }).value;
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const fileSystem = yield* FileSystem.FileSystem;
    const sealedFile = (yield* Path.Path).join(directory, ENTITY_SEALED_FILE_NAME);
    const kept = { hash, accountId, reads: { [KEPT_READ.TASK_LIST]: LIST }, queue: [RENAME] };
    yield* fileSystem.writeFileString(
      sealedFile,
      Base64.encode(testCipher().encrypt(JSON.stringify(kept))),
    );

    const first = yield* opened(directory, DANA);
    const stays = yield* fileSystem.exists(sealedFile);
    yield* first.closed;
    const reopened = yield* opened(directory, DANA);

    const ours = accountId === DANA;
    const rows = ours && !otherShapes ? LIST : undefined;
    assert.equal(stays, false);
    assert.deepEqual(
      [first.store.stored(KEPT_READ.TASK_LIST), reopened.store.stored(KEPT_READ.TASK_LIST)],
      [rows, rows],
    );
    assert.deepEqual(
      [first.store.queue, reopened.store.queue],
      ours ? [[RENAME], [RENAME]] : [[], []],
    );
  }).pipe(Effect.provide(files)),
);

it.effect("a database that is no database is made again, empty", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const first = yield* opened(directory, DANA);
    yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
    yield* first.closed;
    const fileSystem = yield* FileSystem.FileSystem;
    const file = (yield* Path.Path).join(directory, ENTITY_DATABASE_FILE_NAME);
    yield* fileSystem.writeFileString(file, "not a database ".repeat(512));

    const reopened = yield* opened(directory, DANA);
    yield* reopened.store.keep(KEPT_READ.TASK_LIST, LIST);
    yield* reopened.closed;

    assert.equal(reopened.store.stored(KEPT_READ.TASK_LIST), undefined);
    assert.deepEqual((yield* opened(directory, DANA)).store.stored(KEPT_READ.TASK_LIST), LIST);
  }).pipe(Effect.provide(files)),
);

it.effect("a driver that cannot load keeps no store", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");

    const store = yield* openEntityStore({
      directory,
      cipher: testCipher(),
      driver: unloadableSqliteDriver(),
      accountId: DANA,
    });

    assert.equal(store, undefined);
  }).pipe(Effect.provide(files)),
);

it.effect(
  "a workspace the kept list no longer names leaves with its people, and a late answer for it is not kept",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const { store, closed } = yield* opened(directory, DANA);
      const people = {
        members: [
          { userId: "user-ada", name: "Ada", email: "ada@app.test", role: "owner", image: null },
        ],
        former: [{ userId: "user-lee", name: "Lee", image: null }],
      };
      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-acme", people);
      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-relay", people);
      yield* TestClock.adjust("1 second");

      yield* store.keep(KEPT_READ.WORKSPACES, [
        {
          id: "workspace-acme",
          name: "acme",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
          githubInstallations: [],
          memberCount: 2,
        },
      ]);
      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-relay", people);
      yield* closed;
      const reopened = yield* opened(directory, DANA);

      assert.deepEqual(store.storedIn(KEPT_READ.MEMBERS, "workspace-acme"), people);
      assert.equal(store.storedIn(KEPT_READ.MEMBERS, "workspace-relay"), undefined);
      assert.deepEqual(reopened.store.stored(KEPT_READ.MEMBERS), { "workspace-acme": people });
    }).pipe(Effect.provide(files)),
);
