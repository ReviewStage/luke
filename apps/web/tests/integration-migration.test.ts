import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  type JournalEntry,
  runWebMigrations,
  webMigrationJournal,
} from "@sidecar/database/core/migrator";
import { db } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { unmigratedPgliteSqlClient } from "@sidecar/database/testing";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  INTEGRATION_ROW_STATUS,
  readIntegrationConnection,
  readIntegrationSignIn,
} from "../server/hosted/integration-store";

/**
 * The migration that makes `integration_connection` copies every
 * `linear_connection` row into it as Linear's, so an account connected
 * before it is connected after it, and a sign-in under way before it still
 * settles by its state. The database is migrated to the entry before it,
 * rows are written as the deployment before it wrote them, and the migration
 * is applied over them.
 *
 * Synthetic accounts throughout.
 */

const MIGRATION = "20261013045713_integration_connection";
const BEFORE = "20261013044623_session_sandbox_cleanup";

const JOURNAL_FILE = ["meta", "_journal.json"] as const;

/** The real folder's migrations, copied into a folder of the test's own whose journal ends where the test says. */
const migrationsThrough = (tag: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const source = path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "database",
      "migrations",
    );
    const folder = yield* fileSystem.makeTempDirectoryScoped();
    yield* fileSystem.makeDirectory(path.join(folder, JOURNAL_FILE[0]));
    const entries = yield* webMigrationJournal(source);
    yield* Effect.forEach(entries, (entry) =>
      fileSystem.copyFile(
        path.join(source, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      ),
    );
    const journal = (through: string) => {
      const end = entries.findIndex((entry) => entry.tag === through);
      assert.notEqual(end, -1, `no migration ${through}`);
      const named: ReadonlyArray<JournalEntry> = entries.slice(0, end + 1);
      return fileSystem.writeFileString(
        path.join(folder, ...JOURNAL_FILE),
        JSON.stringify({ version: "7", dialect: "postgresql", entries: named }),
      );
    };
    yield* journal(tag);
    return { folder, journal };
  });

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

it.effect(
  "an account connected to Linear before the migration is connected after it, and a sign-in under way still settles by its state",
  () =>
    Effect.provide(
      Effect.scoped(
        Effect.gen(function* () {
          const { folder, journal } = yield* migrationsThrough(BEFORE);
          yield* runWebMigrations(folder);
          const connected = yield* openAccount;
          const signingIn = yield* openAccount;
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            insert into linear_connection (user_id, status, connected_at)
            values (${connected}, 'connected', now())
          `;
          yield* sql`
            insert into linear_connection (user_id, status, state, state_issued_at)
            values (${signingIn}, 'pending', 'state-under-way', now())
          `;

          yield* journal(MIGRATION);
          const applied = yield* runWebMigrations(folder);
          assert.deepEqual(
            applied.map(([, name]) => name),
            [MIGRATION],
          );

          const linear = INTEGRATION_PROVIDER.LINEAR;
          assert.equal(
            (yield* readIntegrationConnection(connected, linear))?.status,
            INTEGRATION_ROW_STATUS.CONNECTED,
          );
          const signIn = yield* readIntegrationSignIn("state-under-way");
          assert.equal(signIn?.userId, signingIn);
          assert.equal(signIn?.provider, linear);
          assert.equal(signIn?.status, INTEGRATION_ROW_STATUS.PENDING);
        }),
      ),
      Layer.provideMerge(unmigratedPgliteSqlClient, NodeServices.layer),
    ),
);
