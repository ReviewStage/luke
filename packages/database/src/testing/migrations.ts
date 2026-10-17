import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { MIGRATIONS_FOLDER } from "../core/migrator.js";

/**
 * migrations.ts -- one migration's statements as the migrator runs them, and a rename's undone, for a test that stands a database where it stood before a migration.
 */

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** The migration that names a plan's row a task, which a test of an earlier migration walks back first. */
export const RENAME_PLAN_TO_TASK = "20261017014941_rename_plan_to_task";

/** The migration's statements, in the order the migrator runs them. */
export function migrationStatements(migration: string): Effect.Effect<readonly string[]> {
  return Effect.promise(async () =>
    (await readFile(join(MIGRATIONS_FOLDER, migration, "migration.sql"), "utf8"))
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}

/** A rename's statement undone: the names it moved swapped back. A statement that is no rename is refused, since it has no undoing. */
export function undoneRename(statement: string): string {
  const table = /^ALTER TABLE "([^"]+)" RENAME TO "([^"]+)";?$/u.exec(statement);
  if (table) return `ALTER TABLE "${table[2]}" RENAME TO "${table[1]}"`;
  const column = /^ALTER TABLE "([^"]+)" RENAME COLUMN "([^"]+)" TO "([^"]+)";?$/u.exec(statement);
  if (column) return `ALTER TABLE "${column[1]}" RENAME COLUMN "${column[3]}" TO "${column[2]}"`;
  const index = /^ALTER INDEX "([^"]+)" RENAME TO "([^"]+)";?$/u.exec(statement);
  if (index) return `ALTER INDEX "${index[2]}" RENAME TO "${index[1]}"`;
  throw new Error(`the migration holds a statement that is no rename: ${statement}`);
}
