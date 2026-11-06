import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_FOLDER } from "../src/core/migrator.js";
import { syncFunctionMigration, syncFunctionName, syncMigration } from "../src/sync/render.js";
import type { SyncTable } from "../src/sync/sync-table.js";
import { SYNC_TABLES } from "../src/sync/tables.js";

const CUSTOM_PLACEHOLDER = "-- Custom SQL migration file, put your code below! --";

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
