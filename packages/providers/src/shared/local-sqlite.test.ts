import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { wireRecord } from "@sidecar/wire";
import { Effect, Exit, Option, Scope } from "effect";
import {
  defaultSqliteModule,
  type SqliteModuleLoader,
  scopedReadOnlyDatabase,
  textFromRow,
} from "./local-sqlite.js";

const PROVIDER_DATABASE = "provider.sqlite";

/** A provider's own database, written the way the provider itself would. */
const writeProviderDatabase = (directory: string): Effect.Effect<string> =>
  Effect.sync(() => {
    const filePath = path.join(directory, PROVIDER_DATABASE);
    const database = new DatabaseSync(filePath, {});
    try {
      database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
      database.prepare("INSERT INTO sessions (id) VALUES (?)").run("session-one");
    } finally {
      database.close();
    }
    return filePath;
  });

/** A loader that refuses the way a runtime or another process would. */
const refusingLoader =
  (refusal: Error): SqliteModuleLoader =>
  () =>
    Promise.reject(refusal);

const unknownBuiltinModule = (): Error => {
  const refusal: NodeJS.ErrnoException = new Error("No such built-in module: node:sqlite");
  refusal.code = "ERR_UNKNOWN_BUILTIN_MODULE";
  return refusal;
};

describe("a provider's own database, read read-only", () => {
  it.effect("answers the handle and closes it when the scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filePath = yield* writeProviderDatabase(directory);
        const scope = yield* Scope.make();

        const held = yield* Scope.extend(
          scopedReadOnlyDatabase(defaultSqliteModule, filePath),
          scope,
        );
        assert.equal(Option.isSome(held), true);
        const database = Option.getOrThrow(held);
        const [row] = database.prepare("SELECT id FROM sessions").all();
        const record = wireRecord(row ?? null);
        assert.ok(record);
        assert.equal(textFromRow(record, "id"), "session-one");

        yield* Scope.close(scope, Exit.void);
        // A closed handle refuses the next statement, which is what says the
        // scope closed it rather than a caller's own `finally`.
        assert.throws(() => database.prepare("SELECT id FROM sessions").all());
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("answers nothing for an open the runtime or another process refused", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filePath = yield* writeProviderDatabase(directory);

        // The refusals that mean "observe nothing here": a runtime without
        // `node:sqlite`, and a database another process holds.
        for (const refusal of [unknownBuiltinModule(), new Error("unable to open database file")]) {
          const held = yield* scopedReadOnlyDatabase(refusingLoader(refusal), filePath);
          assert.equal(Option.isNone(held), true);
        }
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails the pass for an open refused for any other reason", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filePath = yield* writeProviderDatabase(directory);

        const exit = yield* Effect.exit(
          scopedReadOnlyDatabase(refusingLoader(new Error("the disk is on fire")), filePath),
        );
        assert.equal(Exit.isFailure(exit), true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("answers nothing where there is nothing to observe", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();

        const absent = yield* scopedReadOnlyDatabase(
          defaultSqliteModule,
          path.join(directory, PROVIDER_DATABASE),
        );
        assert.equal(Option.isNone(absent), true);

        // A directory where the provider's file would be is the same answer:
        // nothing to observe, not a failed pass.
        const notAFile = yield* scopedReadOnlyDatabase(defaultSqliteModule, directory);
        assert.equal(Option.isNone(notAFile), true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
