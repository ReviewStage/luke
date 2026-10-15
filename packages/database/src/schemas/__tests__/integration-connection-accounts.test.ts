import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { MIGRATIONS_FOLDER } from "../../core/migrator.js";
import { Database } from "../../core/query.js";
import { getTestDB } from "../../testing/index.js";
import { user } from "../auth.js";

/**
 * The migration that makes an integration row one account's, over a
 * database from before it: an account connected at two providers keeps both
 * rows, each its provider's first account, asking under the account's own
 * user id, and primary, though the two share that subject; and the
 * migration run again, as a run that stopped partway is finished by the
 * next, changes nothing. The table is put back as it stood before the
 * migration, and the migration's own statements are run over it. Synthetic
 * accounts throughout.
 */

const MIGRATION = "20261015191901_integration_connection_accounts";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** The migration's statements, as the migrator runs them. */
const statements = Effect.promise(async () =>
  (await readFile(join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql"), "utf8"))
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0),
);

/** The table as the migration before it left it: one row per account and provider, keyed by the pair. */
const BEFORE = [
  `DROP INDEX IF EXISTS "integration_connection_user_name_idx"`,
  `DROP INDEX IF EXISTS "integration_connection_provider_subject_idx"`,
  `DROP INDEX IF EXISTS "integration_connection_user_provider_idx"`,
  `ALTER TABLE "integration_connection" DROP CONSTRAINT "integration_connection_pkey"`,
  `ALTER TABLE "integration_connection" DROP COLUMN "id", DROP COLUMN "connect_subject", DROP COLUMN "connection_name", DROP COLUMN "label", DROP COLUMN "is_primary"`,
  `ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_user_id_provider_pk" PRIMARY KEY ("user_id", "provider")`,
];

it.layer(getTestDB())("the integration accounts migration", (it) => {
  it.effect(
    "an account connected at two providers keeps both rows, each its provider's first account under its own user id, and a second run changes nothing",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const db = yield* Database;
        const userId = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
        for (const statement of BEFORE) yield* sql.unsafe(statement);
        for (const provider of ["linear", "notion"]) {
          yield* sql`
            INSERT INTO integration_connection (user_id, provider, status, updated_at)
            VALUES (${userId}, ${provider}, 'connected', now())
          `;
        }

        const migration = yield* statements;
        for (const statement of migration) yield* sql.unsafe(statement);
        const read = sql<{
          readonly id: string;
          readonly provider: string;
          readonly connect_subject: string;
          readonly connection_name: string;
          readonly is_primary: boolean;
        }>`
          SELECT id, provider, connect_subject, connection_name, is_primary
          FROM integration_connection WHERE user_id = ${userId} ORDER BY provider
        `;
        const migrated = yield* read;
        assert.deepEqual(
          migrated.map((row) => [
            row.provider,
            row.connect_subject,
            row.connection_name,
            row.is_primary,
          ]),
          [
            ["linear", userId, "linear", true],
            ["notion", userId, "notion", true],
          ],
        );
        assert.ok(migrated.every((row) => row.id.length > 0));

        for (const statement of migration) yield* sql.unsafe(statement);
        assert.deepEqual(yield* read, migrated);
      }),
  );
});
