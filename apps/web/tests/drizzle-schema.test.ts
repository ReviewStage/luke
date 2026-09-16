import assert from "node:assert/strict";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import * as schema from "../server/db/schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The restored schema modules are hand-maintained beside the hand-written
 * migrations: `drizzle-kit` no longer generates one from the other, so a
 * migration that renames a column leaves a module that type-checks and lies.
 * This is the floor under that, run against the real migrations on the real
 * dialect: every table the barrel declares stands in the database under the
 * name the module gives it, and so does every one of its columns. The
 * comparison the other way — a column the database has and no module
 * declares — is its own test and lands with the drift check.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** Every table the barrel declares, by the Postgres name its module gives it. */
const DECLARED_COLUMNS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.values(schema)
    .filter((exported) => is(exported, PgTable))
    .map((table) => [
      getTableName(table),
      new Set(Object.values(getTableColumns(table)).map((column) => column.name)),
    ]),
);

const ColumnRowSchema = Schema.Struct({ table: Schema.String, column: Schema.String });

/** Every column of the public schema, as the migrated database reads it back. */
async function migratedColumns(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const rows = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select table_name as table, column_name as column
        from information_schema.columns
        where table_schema = 'public'
      `;
    }),
  );
  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const { table, column } = Schema.decodeUnknownSync(ColumnRowSchema)(row);
    const named = columns.get(table) ?? new Set<string>();
    named.add(column);
    columns.set(table, named);
  }
  return columns;
}

test("every table and column the schema modules declare stands in the migrated database", async () => {
  const migrated = await migratedColumns();
  // A module the barrel forgot would make the assertion below pass on nothing.
  assert.equal(DECLARED_COLUMNS.size, 30);
  const missing: string[] = [];
  for (const [table, declared] of DECLARED_COLUMNS) {
    const columns = migrated.get(table);
    if (columns === undefined) {
      missing.push(table);
      continue;
    }
    for (const column of declared) {
      if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
  }
  assert.deepEqual(missing, []);
});
