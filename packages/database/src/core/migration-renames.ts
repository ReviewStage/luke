/**
 * migration-renames.ts -- finds a table or column renamed in place by a migration written after the cutoff.
 *
 * A deployment's migration runs while the deployment before it is still
 * serving: its functions, and every turn it has running, still spell the old
 * names. `20261017014941_rename_plan_to_task` renamed tables and columns in
 * place, and the 26 turns the old deployment had running broke on their next
 * statement and stranded their sandboxes. Squawk's `renaming-column` rule
 * (squawkhq.com/docs/renaming-column) names the same hazard. So a migration
 * newer than the cutoff renames no table and no column; the migrations up to
 * it have run and are never edited, so they are left as they are. An index or
 * a constraint renamed is not refused, since no statement spells either by
 * name but a migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The newest migration on main when the rule began; every folder after it is held to it. */
export const RENAME_CUTOFF = "20261017143603_turns_cancel_request_key";

/** The length of the UTC timestamp `drizzle-kit generate` opens a folder's name with. */
const TIMESTAMP_LENGTH = 14;

/** `ALTER TABLE` renaming the table (`RENAME TO`) or a column (`RENAME [COLUMN] a TO b`), never a constraint. */
const TABLE_OR_COLUMN_RENAME = /^ALTER\s+TABLE\b.*\bRENAME\s+(?!CONSTRAINT\b)/isu;

/** What the refusal says instead: the safe ways to the same end. */
export const RENAME_ADVICE =
  "rename the field in code and keep the database name (Drizzle maps a property to any column, " +
  'as in `taskId: text("plan_id")`); a true rename is add, backfill, switch the code, then drop ' +
  "in a later deploy, so the deployment still serving never meets a name it does not know";

/** One statement that renames a table or column in place. */
export interface MigrationRename {
  readonly folder: string;
  readonly statement: string;
}

/** The statements of one migration file, comments dropped and whitespace collapsed. */
function statementsOf(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/gu, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/gu, " ").trim())
    .filter((statement) => statement.length > 0);
}

/** Every in-place table or column rename in a migration folder newer than the cutoff. */
export function migrationRenames(
  migrationsDirectory: string,
  cutoff: string = RENAME_CUTOFF,
): MigrationRename[] {
  const after = cutoff.slice(0, TIMESTAMP_LENGTH);
  const renames: MigrationRename[] = [];
  const folders = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.slice(0, TIMESTAMP_LENGTH) > after)
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(migrationsDirectory, folder, "migration.sql"), "utf8");
    for (const statement of statementsOf(sql)) {
      if (TABLE_OR_COLUMN_RENAME.test(statement)) renames.push({ folder, statement });
    }
  }
  return renames;
}
