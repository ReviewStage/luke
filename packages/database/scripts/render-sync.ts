/**
 * render-sync.ts -- writes synced tables' capture into a migration, around the statements it already holds.
 *
 * A table's capture is rendered from its declaration (`src/sync/tables.ts`)
 * and never written by hand, so a migration that syncs a table, or changes
 * the columns of one already synced, carries the capture this writes:
 *
 *     pnpm db:generate --custom --name=sync_<what>      (or a plain generate)
 *     pnpm --filter @repo/database sync:render <migration folder> <table>…
 *
 * The tables' triggers are dropped before the migration's own statements and
 * created after them, so a column a trigger's `WHEN` names can be dropped or
 * renamed, and the capture is rendered over the columns as they then stand.
 * With `--functions` only the tables' functions are replaced, after the
 * migration's own statements, for a change that leaves their columns and
 * triggers as they stand, such as logging a table:
 *
 *     pnpm --filter @repo/database sync:render <migration folder> --functions <table>…
 * The drift check (`src/sync/__tests__/capture.test.ts`) fails until the
 * migrated database carries what the declarations render.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../src/core/migrator.js";
import { syncFunctionMigration, syncFunctionName, syncMigration } from "../src/sync/render.js";
import type { SyncTable } from "../src/sync/sync-table.js";
import { SYNC_TABLES } from "../src/sync/tables.js";

/** What `db:generate --custom` writes into a migration it leaves for us to fill. */
const CUSTOM_PLACEHOLDER = "-- Custom SQL migration file, put your code below! --";

/** The flag that replaces the tables' functions alone. */
const FUNCTIONS_ONLY = "--functions";

function declared(name: string): SyncTable {
  const table = SYNC_TABLES.find((candidate) => candidate.name === name);
  if (table === undefined) throw new Error(`${name} is not declared in src/sync/tables.ts`);
  return table;
}

const [folder, ...rest] = process.argv.slice(2);
const functionsOnly = rest[0] === FUNCTIONS_ONLY;
const names = functionsOnly ? rest.slice(1) : rest;
if (folder === undefined || names.length === 0) {
  throw new Error(`usage: sync:render <migration folder> [${FUNCTIONS_ONLY}] <table>…`);
}
const file = join(MIGRATIONS_FOLDER, folder, "migration.sql");
if (!existsSync(file)) throw new Error(`${file} does not exist`);
const tables = names.map(declared);
const statements = readFileSync(file, "utf8").replace(CUSTOM_PLACEHOLDER, "");
for (const table of tables) {
  if (statements.includes(`"${syncFunctionName(table)}"`)) {
    throw new Error(`${folder} already carries ${table.name}'s capture`);
  }
}
const migration = functionsOnly
  ? syncFunctionMigration(tables, statements)
  : syncMigration(tables, statements);
writeFileSync(file, `${migration}\n`);
