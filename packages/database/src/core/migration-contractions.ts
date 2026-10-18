/**
 * migration-contractions.ts -- finds what a migration renames or drops that old code still reads.
 *
 * A deployment's migration runs while the deployment before it is still
 * serving: its functions, and every coding agent's Workflow run pinned to it
 * for up to twenty-five hours, still spell the old names.
 * `20261017014941_rename_plan_to_task` renamed tables and columns in place,
 * and the turns the old deployment had running broke on their next statement
 * with `relation "plan" does not exist` and stranded their sandboxes.
 * Squawk's `renaming-column` rule (squawkhq.com/docs/renaming-column) names
 * the same hazard. So a migration renames no table, column, type, or view and
 * drops no table, column, type, or view, unless it says why the old readers
 * have drained (`CONTRACT_MARKER`) or it is one already applied, which is never
 * edited. The rule is the db-migrations skill's "Expand, migrate, contract".
 *
 * An index or a constraint renamed or dropped is not refused: no statement the
 * code runs spells either by name, since Drizzle names an upsert's conflict
 * target by its columns, so the old deployment never meets the change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shipped before this rule, and a shipped migration is never edited. Named one
 * by one, not by a cutoff, because a branch cut earlier lands its folder later.
 */
const APPLIED_CONTRACTIONS: ReadonlySet<string> = new Set([
  "20260829003641_famous_fallen_one",
  "20260909011954_pretty_wendell_rand",
  "20260909193638_devices",
  "20260911093332_g4_drop_v1_conversation_tables",
  "20260911165115_c4_drop_prompts",
  "20260914194320_h7_drop_voice_speed",
  "20260915002640_memory_1_drop_personal_fact",
  "20260918025320_workspace_file_content",
  "20260921141320_dead_tool_sets",
  "20260923005640_roster_bookmark_dropped",
  "20260924114000_dead_conversations_fork_of_seq",
  "20260924183640_dead_hosted_usage_voice_seconds",
  "20260925013320_dead_asks_question",
  "20260927021000_plan_command",
  "20260927090640_plan_folder_off_service",
  "20260928195000_plan_drop_opened_at",
  "20260930202640_drop_plan_command",
  "20261008061320_plan_drop_template_columns",
  "20261013045959_linear_connection_drop",
  "20261013123642_dead_tables_drop",
  "20261013153724_plan_section_writers_drop",
  "20261013210943_voice_avatar_sessions_drop",
  "20261015212832_integration_connection_drop_primary",
  "20261017014941_rename_plan_to_task",
]);

/**
 * `ALTER <anything but an index> … RENAME`, never a constraint: a table
 * (`RENAME TO`), a column (`RENAME [COLUMN] a TO b`), a type or its value, a
 * view. Found anywhere in the text, so a `DO` block or an `EXECUTE` string is
 * read too.
 */
const RENAME = /\bALTER\s+(?!INDEX\b)[^;]*?\bRENAME\s+(?!CONSTRAINT\b)[^;']*/giu;

/** `DROP TABLE`, `DROP TYPE`, `DROP VIEW`, and `DROP MATERIALIZED VIEW`. */
const DROP_OBJECT = /\bDROP\s+(?:TABLE|TYPE|VIEW|MATERIALIZED\s+VIEW)\b[^;']*/giu;

/**
 * `ALTER TABLE … DROP [COLUMN] c`, with or without the keyword, never a
 * constraint, nor a column's default, `NOT NULL`, expression, or identity,
 * which loosen what old code may write rather than take away what it reads.
 */
const DROP_COLUMN =
  /\bALTER\s+TABLE\b[^;]*?\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\b|EXPRESSION\b|IDENTITY\b)[^;']*/giu;

/** Line and block comments, which may hold the words of a statement no one runs. */
const COMMENTS = /--[^\n]*|\/\*[\s\S]*?\*\//gu;

/** The comment a deliberate contract step carries: `-- contract: <why old readers have drained>`. */
const CONTRACT_MARKER = /^[ \t]*--[ \t]*contract:[ \t]*\S/imu;

/** What the refusal says instead: the safe ways to the same end. */
export const CONTRACTION_ADVICE =
  "rename the field in code and keep the database name (Drizzle maps a property to any column, " +
  'as in `taskId: text("plan_id")`), or expand, migrate, contract: add the new name beside the old, ' +
  "write both until no run still reads the old one, and drop it in a later migration at least 25 hours " +
  "after the code that stopped writing it reached production; mark that migration " +
  "`-- contract: <why old readers have drained>` " +
  '(the db-migrations skill\'s "Expand, migrate, contract")';

/** One statement that renames or drops what the deployment still serving may read. */
export interface MigrationContraction {
  readonly folder: string;
  readonly statement: string;
}

/** Every unmarked rename or drop in a migration folder not already applied. */
export function migrationContractions(
  migrationsDirectory: string,
  applied: ReadonlySet<string> = APPLIED_CONTRACTIONS,
): MigrationContraction[] {
  const contractions: MigrationContraction[] = [];
  const folders = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(migrationsDirectory, folder, "migration.sql"), "utf8");
    if (CONTRACT_MARKER.test(sql)) continue;
    const code = sql.replace(COMMENTS, "");
    const matches = [RENAME, DROP_OBJECT, DROP_COLUMN]
      .flatMap((pattern) => [...code.matchAll(pattern)])
      .sort((a, b) => a.index - b.index);
    for (const match of matches) {
      contractions.push({ folder, statement: match[0].replace(/\s+/gu, " ").trim() });
    }
  }
  return contractions;
}
