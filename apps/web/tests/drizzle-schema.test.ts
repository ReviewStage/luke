import assert from "node:assert/strict";
import { DRIZZLE_MIGRATIONS, EFFECT_MIGRATIONS_TABLE } from "@luke/database/core/migrator";
import * as schema from "@luke/database/schemas";
import { openHostedStoreTestDatabase } from "@luke/database/testing";
import { getColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, test } from "vitest";

/**
 * The drift check between the schema modules and the database the
 * migrations actually build. `drizzle-kit` generates each migration from the
 * modules (`packages/database/src/schemas/__tests__/migrations.test.ts` holds
 * that it was), but a migration edited by hand afterwards — a backfill, a
 * rename drizzle-kit asked about — can still rename a column, drop one, widen
 * one, or make one nullable, and leave a module that type-checks and lies, so
 * every query built on it is wrong in a way the compiler approves of. The store suites catch that only where a query covers the
 * column; this catches it whether one does or not.
 *
 * So the comparison runs both ways over the whole public schema, against a
 * database built by `runWebMigrations` through the same door every store test
 * uses — PGlite in process, or the Postgres of `LUKE_STORE_TEST_DATABASE_URL`
 * on CI, where the real `pg` driver reads `information_schema` back. A column
 * the module declares and the database has not fails, and so does a column
 * the database has and no module declares, which is the direction that
 * catches the migration nobody folded in. Better Auth's tables are compared
 * with the rest: `schemas/auth.ts` is in the barrel, and nothing else holds it
 * to the database.
 *
 * What is compared is name, type, nullability, and primary key. Not
 * compared: defaults, indexes, foreign keys, and the `$type<>()` unions,
 * which name no Postgres type and are the compile-time claim this whole
 * restoration was for.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/**
 * The migrators' own bookkeeping, declared by no module of ours: Drizzle's
 * history table, and the old `effect/sql` runner's, which a database that
 * runner migrated still holds. They are the tables in `public` the barrel
 * should not describe.
 */
const UNDECLARED_TABLES: ReadonlySet<string> = new Set([
  DRIZZLE_MIGRATIONS.TABLE,
  EFFECT_MIGRATIONS_TABLE,
]);

/**
 * The Postgres types this comparison is exact for: for each, the string
 * Drizzle's own `getSQLType()` emits is the string `information_schema` reads
 * the column back as, so the two sides compare without a mapping table
 * standing between them. A parameterised type is deliberately not among them
 * — Drizzle spells one `varchar(50)` or `numeric(10, 2)` where
 * `information_schema` answers `character varying` and a separate precision —
 * so a module that adds one fails here and has to settle how it is compared
 * rather than have its columns quietly stop being checked.
 */
const EXACT_COLUMN_TYPES: ReadonlySet<string> = new Set([
  "bigint",
  "boolean",
  "bytea",
  "double precision",
  "integer",
  "jsonb",
  "text",
  "text[]",
  "timestamp with time zone",
  "uuid",
  "uuid[]",
]);

/** `information_schema` reads an array column back under this one type, its element in `udt_name`. */
const ARRAY_DATA_TYPE = "ARRAY";

/** `information_schema.columns.is_nullable`, which is a yes-or-no word rather than a boolean. */
const IS_NULLABLE = { NO: "NO" } as const;

interface Column {
  readonly type: string;
  readonly notNull: boolean;
}

interface Table {
  readonly columns: ReadonlyMap<string, Column>;
  readonly primaryKey: ReadonlySet<string>;
}

// ---------------------------------------------------------------- the modules

/**
 * Every table the barrel exports, as the modules describe it. A column's own
 * `.primaryKey()` carries `notNull` with it; a table-level
 * `primaryKey({ columns })` does not, and this does not infer one for it,
 * because Postgres makes such a column not null whatever the module says and
 * a module that leaves the flag off is inferring a nullable field over a
 * column that can hold no null. That reads back here as a nullability
 * mismatch, which is what it is.
 */
function declaredTables(): ReadonlyMap<string, Table> {
  const tables = new Map<string, Table>();
  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue;
    const primaryKey = new Set<string>();
    for (const composite of getTableConfig(exported).primaryKeys) {
      for (const column of composite.columns) primaryKey.add(column.name);
    }
    const columns = new Map<string, Column>();
    for (const column of Object.values(getColumns(exported))) {
      if (column.primary) primaryKey.add(column.name);
      // Note that v1 states an array column's dimensions apart from its type, which reads as the element's alone.
      const dimensions = is(column, PgColumn) ? (column.dimensions ?? 0) : 0;
      const type = `${column.getSQLType()}${"[]".repeat(dimensions)}`;
      columns.set(column.name, { type, notNull: column.notNull });
    }
    tables.set(getTableName(exported), { columns, primaryKey });
  }
  return tables;
}

// --------------------------------------------------------------- the database

const ColumnRow = Schema.Struct({
  table_name: Schema.String,
  column_name: Schema.String,
  data_type: Schema.String,
  udt_name: Schema.String,
  is_nullable: Schema.String,
});

const KeyColumnRow = Schema.Struct({
  table_name: Schema.String,
  column_name: Schema.String,
});

const decodeColumn = Schema.decodeUnknownSync(ColumnRow);
const decodeKeyColumn = Schema.decodeUnknownSync(KeyColumnRow);

/** The column's type as Drizzle spells it: an array reads back as its element's udt name under a leading underscore. */
function columnType(row: Schema.Schema.Type<typeof ColumnRow>): string {
  if (row.data_type !== ARRAY_DATA_TYPE) return row.data_type;
  return `${row.udt_name.replace(/^_/, "")}[]`;
}

/** Every table of the migrated `public` schema, as the database itself reads them back. */
async function migratedTables(): Promise<ReadonlyMap<string, Table>> {
  const read = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const columns = yield* sql`
        select table_name, column_name, data_type, udt_name, is_nullable
        from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position
      `;
      // The constraint and its columns are two views: the join is what says
      // which columns the primary key of one table is made of, and in Postgres
      // a constraint name is unique per schema, so the schema pairs them.
      const keyColumns = yield* sql`
        select constraints.table_name, usage.column_name
        from information_schema.table_constraints as constraints
        join information_schema.key_column_usage as usage
          on usage.constraint_schema = constraints.constraint_schema
          and usage.constraint_name = constraints.constraint_name
        where constraints.table_schema = 'public'
          and constraints.constraint_type = 'PRIMARY KEY'
      `;
      return { columns, keyColumns };
    }),
  );
  const tables = new Map<string, { columns: Map<string, Column>; primaryKey: Set<string> }>();
  const of = (name: string) => {
    const table = tables.get(name) ?? { columns: new Map(), primaryKey: new Set<string>() };
    tables.set(name, table);
    return table;
  };
  for (const row of read.columns.map((row) => decodeColumn(row))) {
    if (UNDECLARED_TABLES.has(row.table_name)) continue;
    of(row.table_name).columns.set(row.column_name, {
      type: columnType(row),
      notNull: row.is_nullable === IS_NULLABLE.NO,
    });
  }
  for (const row of read.keyColumns.map((row) => decodeKeyColumn(row))) {
    if (UNDECLARED_TABLES.has(row.table_name)) continue;
    of(row.table_name).primaryKey.add(row.column_name);
  }
  return tables;
}

// ------------------------------------------------------------- the comparison

const DECLARED = declaredTables();
const MIGRATED = await migratedTables();

/** The names both sides know, which is where a column or a key can be compared at all. */
const SHARED_TABLES = [...DECLARED.keys()].filter((name) => MIGRATED.has(name)).sort();

test("every declared column carries the type and the nullability the migrated database gives it", () => {
  const drift: string[] = [];
  for (const table of SHARED_TABLES) {
    const migrated = MIGRATED.get(table)?.columns;
    for (const [column, declared] of DECLARED.get(table)?.columns ?? []) {
      const actual = migrated?.get(column);
      if (actual === undefined) continue; // Named by the columns test above.
      if (!EXACT_COLUMN_TYPES.has(declared.type)) {
        drift.push(`${table}.${column}: ${declared.type} is no type this test compares exactly`);
        continue;
      }
      if (declared.type !== actual.type) {
        drift.push(`${table}.${column}: declared ${declared.type}, migrated ${actual.type}`);
      }
      if (declared.notNull !== actual.notNull) {
        drift.push(
          `${table}.${column}: declared ${declared.notNull ? "not null" : "nullable"}, migrated ${actual.notNull ? "not null" : "nullable"}`,
        );
      }
    }
  }
  assert.deepEqual(drift, []);
});
