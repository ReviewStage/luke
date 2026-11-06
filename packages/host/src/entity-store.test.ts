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
  ENTITY_STORE_FILE_NAME,
  KEPT_READ,
  type KeptRows,
  openEntityStore,
} from "./entity-store.js";
import { planListRow } from "./testing/task-list-rows.js";
import { testCipher } from "./testing/test-cipher.js";

/**
 * The account's lists kept on disk, over a state root of the test's own and
 * a cipher standing in for the Keychain's: what a store kept comes back to
 * the same account at the same row shapes, and a file kept for another
 * account, or at other row shapes, draws nothing and is deleted as the store
 * opens. Synthetic accounts and rows throughout.
 */

const DANA = "user-dana";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** The task list as one answer left it, read at sync id 7. */
const LIST: KeptRows[typeof KEPT_READ.TASK_LIST] = {
  rows: {
    plans: [planListRow("7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", "Teammate invitations")],
    agents: [],
  },
  at: "7",
};

/** A store opened over `directory` for `accountId` in a scope of its own, which the test closes as a quit does. */
function opened(directory: string, accountId: string) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const store = yield* Scope.provide(scope)(
      openEntityStore({ directory, cipher: testCipher(), accountId }),
    );
    return { store, closed: Scope.close(scope, Exit.void) };
  });
}

/** The sealed file's path under `directory`. */
const fileOf = (directory: string) =>
  Effect.map(Path.Path, (path) => path.join(directory, ENTITY_STORE_FILE_NAME));

/** The sealed file's text opened as the test cipher seals it. */
const openedText = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const sealed = yield* fileSystem.readFileString(yield* fileOf(directory));
    return testCipher().decrypt(Result.getOrThrow(Base64.decode(sealed)));
  });

/** The sealed file's text once a save has written it. */
const writtenText = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const file = yield* fileOf(directory);
    // Note that the write is the disk's own, which no test clock moves, so the test waits on the file itself.
    yield* Effect.repeat(fileSystem.exists(file), { until: (exists) => exists, times: 10_000 });
    return yield* fileSystem.readFileString(file);
  });

/** The file kept again as a build of other row shapes would have kept it: every byte its own but the hash. */
const keptAtOtherShapes = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const kept = { ...JSON.parse(yield* openedText(directory)), hash: "another build's" };
    const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
    yield* fileSystem.writeFileString(yield* fileOf(directory), sealed);
  });

it.effect.each([
  { kept: "the same account at the same row shapes", reopenedAs: DANA, otherShapes: false },
  { kept: "another account", reopenedAs: "user-ravi", otherShapes: false },
  { kept: "other row shapes", reopenedAs: DANA, otherShapes: true },
])("a file kept for $kept", ({ reopenedAs, otherShapes }) =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const first = yield* opened(directory, DANA);
    yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
    yield* first.closed;
    if (otherShapes) yield* keptAtOtherShapes(directory);

    const reopened = yield* opened(directory, reopenedAs);
    const stays = yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
      Effect.flatMap(fileOf(directory), (file) => fileSystem.exists(file)),
    );

    const fits = reopenedAs === DANA && !otherShapes;
    assert.deepEqual(reopened.store.stored(KEPT_READ.TASK_LIST), fits ? LIST : undefined);
    assert.equal(stays, fits);
  }).pipe(Effect.provide(files)),
);

it.effect(
  "lists that moved are written within thirty seconds, sealed, while the store stands",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const { store } = yield* opened(directory, DANA);
      yield* store.keep(KEPT_READ.TASK_LIST, LIST);

      yield* TestClock.adjust("30 seconds");
      const sealed = yield* writtenText(directory);

      assert.equal(sealed.includes("Teammate invitations"), false, "nothing is kept in the clear");
      assert.deepEqual(JSON.parse(yield* openedText(directory)).reads, {
        [KEPT_READ.TASK_LIST]: LIST,
      });
    }).pipe(Effect.provide(files)),
);

it.effect("a write waiting for the service is written within two seconds of its queuing", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const waiting: QueuedEntry[] = [];
    const scope = yield* Scope.make();
    yield* Scope.provide(scope)(
      openEntityStore({ directory, cipher: testCipher(), accountId: DANA, queued: () => waiting }),
    );
    waiting.push({ name: "plans.rename", key: "rename-1", input: { name: "Invites" } });

    yield* TestClock.adjust("2 seconds");
    yield* writtenText(directory);

    assert.deepEqual(JSON.parse(yield* openedText(directory)).queue, waiting);
    yield* Scope.close(scope, Exit.void);
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
      // Note that the store is closed before the folder is removed, so a save its open forked late, after the keeps above, is not still writing into it.
      yield* closed;

      assert.deepEqual(store.storedIn(KEPT_READ.MEMBERS, "workspace-acme"), people);
      assert.equal(store.storedIn(KEPT_READ.MEMBERS, "workspace-relay"), undefined);
    }).pipe(Effect.provide(files)),
);
