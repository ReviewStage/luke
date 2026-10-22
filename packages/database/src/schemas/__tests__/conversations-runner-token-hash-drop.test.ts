import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { getTestDB, migrationStatements } from "../../testing/index.js";

/**
 * The migration that drops `conversations.runner_token_hash` and its index,
 * which nothing has read or written since the digest moved to the agent's
 * row: over a database from before it, both go, and running it twice
 * changes nothing.
 */

const MIGRATION = "20261022022109_conversations_runner_token_hash_drop";

/** The migration undone, so the database stands as one from before it. */
const UNDO = [
  `ALTER TABLE "conversations" ADD COLUMN "runner_token_hash" text`,
  `CREATE UNIQUE INDEX "conversations_runner_token_hash" ON "conversations" ("runner_token_hash") WHERE "runner_token_hash" is not null`,
];

it.layer(getTestDB())(
  "conversations_runner_token_hash_drop over a database from before it",
  (it) => {
    it.effect("the column and its index go, and running it twice changes nothing", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const statement of UNDO) yield* sql.unsafe(statement);

        const migration = yield* migrationStatements(MIGRATION);
        for (const statement of migration) yield* sql.unsafe(statement);
        for (const statement of migration) yield* sql.unsafe(statement);

        const columns = yield* sql<{ readonly column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'runner_token_hash'
      `;
        const indexes = yield* sql<{ readonly indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE indexname = 'conversations_runner_token_hash'
      `;
        assert.deepEqual([columns.length, indexes.length], [0, 0]);
      }),
    );
  },
);
