import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { MIGRATIONS_FOLDER } from "../core/migrator.js";
import { renderSyncTable } from "../sync/render.js";
import { SYNC_TABLES } from "../sync/tables.js";

/**
 * migrations.ts -- one migration's statements as the migrator runs them, and a rename's undone, for a test that stands a database where it stood before a migration.
 */

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** The migration that names a plan's row a task, which a test of an earlier migration walks back first. */
export const RENAME_PLAN_TO_TASK = "20261017014941_rename_plan_to_task";

/**
 * The statements that take Luke Sync's capture off every synced table, as
 * the database stood before it. A test that walks today's schema back past
 * an earlier migration runs them first, because a capture's triggers name
 * the columns that walk renames or drops, just as a migration that drops
 * one takes the capture off first (`render.ts`).
 */
export function syncCaptureTakenOff(): readonly string[] {
  return SYNC_TABLES.flatMap((table) => renderSyncTable(table).drop);
}

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

/** The tables a later migration dropped: the attachments' old names (`20261021000416_attachment_views_drop`) and Chat's (`drop_chat`). */
const DROPPED_TABLES = [
  "chat_attachment",
  "inbox_attachment",
  "plan_attachment",
  "conversation_attachment",
  "chat_member",
  "chat_channel",
  "chat_read",
  "chat_message",
  "workspace_chat",
] as const;

/** The columns a later migration dropped, by every name each held, and the indexes that went with them: an automation's task (`20261028195432_automation_task_drop`). */
const DROPPED_COLUMNS = [
  {
    table: "automation",
    columns: ["plan_id", "task_id"],
    indexes: ["automation_trigger_plan", "automation_trigger_task"],
  },
] as const;

/** Whether the statement names a column since dropped, or an index that went with it. */
function namesDroppedColumn(statement: string): boolean {
  return DROPPED_COLUMNS.some(
    ({ table, columns, indexes }) =>
      indexes.some((index) => statement.includes(`"${index}"`)) ||
      (statement.includes(`"${table}"`) &&
        columns.some((column) => statement.includes(`"${column}"`))),
  );
}

/** An earlier migration's statements as a replay over today's schema can run them: every one naming a table or column since dropped, or an index or constraint named after one, left out. */
export function replayable(statements: readonly string[]): readonly string[] {
  return statements.filter(
    (statement) =>
      DROPPED_TABLES.every((table) => !statement.includes(`"${table}`)) &&
      !namesDroppedColumn(statement),
  );
}
