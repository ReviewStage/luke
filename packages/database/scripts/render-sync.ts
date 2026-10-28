/**
 * render-sync.ts -- writes synced tables' capture into a migration, around the statements it already holds.
 *
 * A table's capture is rendered from its declaration (`src/sync/tables.ts`)
 * and never written by hand, so a migration that syncs a table, or changes
 * the columns of one already synced, carries the capture this writes:
 *
 *     pnpm db:generate --custom --name=sync_<what>      (or a plain generate)
 *     pnpm --filter @luke/database sync:render <migration folder> <table>…
 *
 * The tables' triggers are dropped before the migration's own statements and
 * created after them, so a column a trigger's `WHEN` names can be dropped or
 * renamed, and the capture is rendered over the columns as they then stand.
 * The drift check (`src/sync/__tests__/capture.test.ts`) fails until the
 * migrated database carries what the declarations render.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../src/core/migrator.js";
import { syncFunctionName, syncMigration } from "../src/sync/render.js";
import type { SyncTable } from "../src/sync/sync-table.js";
import { SYNC_TABLES } from "../src/sync/tables.js";

/** What `db:generate --custom` writes into a migration it leaves for us to fill. */
const CUSTOM_PLACEHOLDER = "-- Custom SQL migration file, put your code below! --";

function declared(name: string): SyncTable {
  const table = SYNC_TABLES.find((candidate) => candidate.name === name);
  if (table === undefined) throw new Error(`${name} is not declared in src/sync/tables.ts`);
  return table;
}

const [folder, ...names] = process.argv.slice(2);
if (folder === undefined || names.length === 0) {
  throw new Error("usage: sync:render <migration folder> <table>…");
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
writeFileSync(file, `${syncMigration(tables, statements)}\n`);
