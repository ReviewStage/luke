/**
 * migration-renames.ts -- finds a table or column a migration renames in place.
 *
 * A deployment's migration runs while the deployment before it is still
 * serving: its functions, and every turn it has running, still spell the old
 * names. `20261017014941_rename_plan_to_task` renamed tables and columns in
 * place, and the 26 turns the old deployment had running broke on their next
 * statement and stranded their sandboxes. Squawk's `renaming-column` rule
 * (squawkhq.com/docs/renaming-column) names the same hazard. So no migration
 * renames a table or a column, bar the ones already applied, which are never
 * edited. An index or a constraint renamed is not refused, since no statement
 * spells either by name but a migration.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The applied migrations that rename in place, left as they are. Note that
 * these are named one by one rather than by a cutoff timestamp, because a
 * branch cut before the cutoff lands its folder after it.
 */
const APPLIED_RENAMES: ReadonlySet<string> = new Set(["20261017014941_rename_plan_to_task"]);

/**
 * `ALTER TABLE` renaming the table (`RENAME TO`) or a column (`RENAME [COLUMN] a
 * TO b`), never a constraint, found anywhere in the text, so a `DO` block or
 * an `EXECUTE` string is read too.
 */
const TABLE_OR_COLUMN_RENAME = /\bALTER\s+TABLE\b[^;]*?\bRENAME\s+(?!CONSTRAINT\b)[^;']*/giu;

/** Line and block comments, which may hold the words of a statement no one runs. */
const COMMENTS = /--[^\n]*|\/\*[\s\S]*?\*\//gu;

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

/** Every in-place table or column rename in a migration folder not already applied. */
export function migrationRenames(
  migrationsDirectory: string,
  applied: ReadonlySet<string> = APPLIED_RENAMES,
): MigrationRename[] {
  const renames: MigrationRename[] = [];
  const folders = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(migrationsDirectory, folder, "migration.sql"), "utf8");
    for (const match of sql.replace(COMMENTS, "").matchAll(TABLE_OR_COLUMN_RENAME)) {
      renames.push({ folder, statement: match[0].replace(/\s+/gu, " ").trim() });
    }
  }
  return renames;
}
