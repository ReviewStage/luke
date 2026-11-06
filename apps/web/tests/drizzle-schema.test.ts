import assert from "node:assert/strict";
import { DRIZZLE_MIGRATIONS, EFFECT_MIGRATIONS_TABLE } from "@repo/database/core/migrator";
import * as schema from "@repo/database/schemas";
import { openHostedStoreTestDatabase } from "@repo/database/testing";
import { getColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, test } from "vitest";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const UNDECLARED_TABLES: ReadonlySet<string> = new Set([
  DRIZZLE_MIGRATIONS.TABLE,
  EFFECT_MIGRATIONS_TABLE,
]);

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

const ARRAY_DATA_TYPE = "ARRAY";

const IS_NULLABLE = { NO: "NO" } as const;

interface Column {
  readonly type: string;
  readonly notNull: boolean;
}

interface Table {
  readonly columns: ReadonlyMap<string, Column>;
  readonly primaryKey: ReadonlySet<string>;
}

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
      const dimensions = is(column, PgColumn) ? (column.dimensions ?? 0) : 0;
      const type = `${column.getSQLType()}${"[]".repeat(dimensions)}`;
      columns.set(column.name, { type, notNull: column.notNull });
    }
    tables.set(getTableName(exported), { columns, primaryKey });
  }
  return tables;
}

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

function columnType(row: Schema.Schema.Type<typeof ColumnRow>): string {
  if (row.data_type !== ARRAY_DATA_TYPE) return row.data_type;
  return `${row.udt_name.replace(/^_/, "")}[]`;
}

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

const DECLARED = declaredTables();
const MIGRATED = await migratedTables();

const SHARED_TABLES = [...DECLARED.keys()].filter((name) => MIGRATED.has(name)).sort();

test("every declared column carries the type and the nullability the migrated database gives it", () => {
  const drift: string[] = [];
  for (const table of SHARED_TABLES) {
    const migrated = MIGRATED.get(table)?.columns;
    for (const [column, declared] of DECLARED.get(table)?.columns ?? []) {
      const actual = migrated?.get(column);
      if (actual === undefined) continue;
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
