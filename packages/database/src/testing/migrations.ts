import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { MIGRATIONS_FOLDER } from "../core/migrator.js";
import { renderSyncTable } from "../sync/render.js";
import { SYNC_TABLES } from "../sync/tables.js";

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export const RENAME_PLAN_TO_TASK = "20261017014941_rename_plan_to_task";

export function syncCaptureTakenOff(): readonly string[] {
  return SYNC_TABLES.flatMap((table) => renderSyncTable(table).drop);
}

export function migrationStatements(migration: string): Effect.Effect<readonly string[]> {
  return Effect.promise(async () =>
    (await readFile(join(MIGRATIONS_FOLDER, migration, "migration.sql"), "utf8"))
      .split(STATEMENT_BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  );
}

export function undoneRename(statement: string): string {
  const table = /^ALTER TABLE "([^"]+)" RENAME TO "([^"]+)";?$/u.exec(statement);
  if (table) return `ALTER TABLE "${table[2]}" RENAME TO "${table[1]}"`;
  const column = /^ALTER TABLE "([^"]+)" RENAME COLUMN "([^"]+)" TO "([^"]+)";?$/u.exec(statement);
  if (column) return `ALTER TABLE "${column[1]}" RENAME COLUMN "${column[3]}" TO "${column[2]}"`;
  const constraint = /^ALTER TABLE "([^"]+)" RENAME CONSTRAINT "([^"]+)" TO "([^"]+)";?$/u.exec(
    statement,
  );
  if (constraint) {
    return `ALTER TABLE "${constraint[1]}" RENAME CONSTRAINT "${constraint[3]}" TO "${constraint[2]}"`;
  }
  const index = /^ALTER INDEX "([^"]+)" RENAME TO "([^"]+)";?$/u.exec(statement);
  if (index) return `ALTER INDEX "${index[2]}" RENAME TO "${index[1]}"`;
  throw new Error(`the migration holds a statement that is no rename: ${statement}`);
}

export const RENAME_AGENT_TABLES = "20261029021951_agent_tables_rename";

const RENAME_DESCRIPTION = "20261106055235_description_rename";

function renamesOf(migration: string): Effect.Effect<{
  readonly back: readonly string[];
  readonly forward: readonly string[];
}> {
  return Effect.map(migrationStatements(migration), (statements) => {
    const forward = replayable(statements).filter((statement) =>
      /^ALTER (TABLE|INDEX) "[^"]+" RENAME /u.test(statement),
    );
    return { back: [...forward].reverse().map(undoneRename), forward };
  });
}

export function laterRenames(): Effect.Effect<{
  readonly back: readonly string[];
  readonly forward: readonly string[];
}> {
  return Effect.map(
    Effect.all([renamesOf(RENAME_AGENT_TABLES), renamesOf(RENAME_DESCRIPTION)]),
    ([agentTables, description]) => ({
      back: [...description.back, ...agentTables.back],
      forward: [...agentTables.forward, ...description.forward],
    }),
  );
}

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
  "asks",
  "account_plan_template_revision",
  "task_board",
  "task_issue",
  "workspace_integration_connection",
  "voice_avatar_sessions",
  "voice_transcript_segments",
  "voice_sessions",
  "voice_session_usage",
  "operator_notice",
  "operator_wake",
] as const;

const DROPPED_INDEXES = ["coding_agent_member_operator", "agent_member_operator"] as const;

const DROPPED_COLUMNS = [
  {
    table: "automation",
    columns: ["plan_id", "task_id"],
    indexes: ["automation_trigger_plan", "automation_trigger_task"],
  },
  { table: "memory", columns: ["private_to"], indexes: [] },
] as const;

function namesDroppedColumn(statement: string): boolean {
  return DROPPED_COLUMNS.some(
    ({ table, columns, indexes }) =>
      indexes.some((index) => statement.includes(`"${index}"`)) ||
      (statement.includes(`"${table}"`) &&
        columns.some((column) => statement.includes(`"${column}"`))),
  );
}

export function replayable(statements: readonly string[]): readonly string[] {
  return statements.filter(
    (statement) =>
      DROPPED_TABLES.every((table) => !statement.includes(`"${table}`)) &&
      DROPPED_INDEXES.every((index) => !statement.includes(`"${index}"`)) &&
      !namesDroppedColumn(statement),
  );
}
