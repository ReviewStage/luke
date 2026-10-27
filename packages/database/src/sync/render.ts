/**
 * render.ts -- a synced table's declaration rendered to the SQL of its capture: one trigger function and the two triggers that call it.
 *
 * The capture runs inside every write to its table whatever the `LUKE_SYNC`
 * flag says, so a broken trigger would fail users' writes; it is therefore
 * rendered from the declaration here and never written by hand, and the
 * drift check (`@luke/database/testing`) holds the migrated database to what
 * this renders.
 *
 * A row trigger fires on every insert and delete, and on an update only
 * where a watched column changed. That takes two triggers on one function,
 * because Postgres refuses a `WHEN` that names `OLD` on a trigger that also
 * fires on insert. The function gathers the topics of the row before
 * (`OLD`, on an update or delete) and after (`NEW`, on an insert or update),
 * so a row moving between tasks notifies both, skips a topic whose id is
 * null, and runs each lookup as a `SELECT` on the parent. A parent deleted
 * in the same transaction is no longer there to look up, so its child
 * yields no topics through it, and the parent's own trigger notifies them.
 * The topics are sent once each, sorted, with the transaction's id, in as
 * many notifications as keep each payload under Postgres's limit; Postgres
 * delivers them only once the transaction commits, and folds identical
 * payloads within one transaction into one.
 *
 * A migration that drops or renames a column a `WHEN` names would be refused
 * by Postgres while the update trigger stands, so a migration writes a
 * table's drops before its own statements and the creates after them
 * (`syncMigration`), all in the one transaction the migrator runs.
 */
import { SYNC_CHANNEL, SYNC_PAYLOAD_BYTES } from "./notification.js";
import {
  SYNC_OBJECT_PREFIX,
  type SyncColumnTopic,
  type SyncTable,
  type SyncTableLookup,
} from "./sync-table.js";

/** The two triggers every synced table carries, both calling its one function. */
export const SYNC_TRIGGER = {
  /** `AFTER INSERT OR DELETE`, on every row. */
  WRITE: `${SYNC_OBJECT_PREFIX}write`,
  /** `AFTER UPDATE`, on a row whose watched columns changed. */
  UPDATE: `${SYNC_OBJECT_PREFIX}update`,
} as const;

/** The row a trigger reads its topics from: the row before the write, or after it. */
const RECORD = { OLD: "OLD", NEW: "NEW" } as const;

type Record = (typeof RECORD)[keyof typeof RECORD];

/** Where a migration's statements part, as Drizzle's migrator splits a migration file. */
const STATEMENT_BREAKPOINT = "\n--> statement-breakpoint\n";

/** A table's capture: the drops a migration runs before its own statements, and the creates it runs after them. */
export interface SyncStatements {
  readonly drop: readonly string[];
  readonly create: readonly string[];
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The name of the table's trigger function. */
export function syncFunctionName(table: SyncTable): string {
  return `${SYNC_OBJECT_PREFIX}${table.name}`;
}

/** One topic as a JSON pair, its id cast to text so an integer id is sent as one too. */
function topicJson(topic: SyncColumnTopic, owner: string): string {
  return `jsonb_build_array(${quoteLiteral(topic.kind)}, ${owner}.${quoteIdentifier(topic.column)}::text)`;
}

/** The statement adding the topics the row itself names. */
function ownTopics(table: SyncTable, record: Record): readonly string[] {
  if (table.topics.length === 0) return [];
  const pairs = table.topics.map((topic) => topicJson(topic, record)).join(", ");
  return [`sync_topics := sync_topics || jsonb_build_array(${pairs});`];
}

/** The statement adding the topics of every parent row the lookup matches, none where it matches none. */
function lookupTopics(lookup: SyncTableLookup, record: Record): string {
  const parent = quoteIdentifier(lookup.table);
  const pairs = lookup.topics.map((topic) => `(${topicJson(topic, parent)})`).join(", ");
  return [
    "sync_topics := sync_topics || coalesce((",
    `\t\t\tSELECT jsonb_agg("sync_lookup"."topic") FROM ${parent}`,
    `\t\t\tCROSS JOIN LATERAL (VALUES ${pairs}) AS "sync_lookup"("topic")`,
    `\t\t\tWHERE ${parent}.${quoteIdentifier(lookup.key)} = ${record}.${quoteIdentifier(lookup.by)}`,
    "\t\t), '[]');",
  ].join("\n");
}

/** The block gathering one record's topics, run only where the write has that record. */
function recordBlock(table: SyncTable, record: Record): string {
  const absentOn = record === RECORD.OLD ? "INSERT" : "DELETE";
  const statements = [
    ...ownTopics(table, record),
    ...table.lookups.map((lookup) => lookupTopics(lookup, record)),
  ];
  return [
    `\tIF TG_OP <> '${absentOn}' THEN`,
    ...statements.map((statement) => `\t\t${statement}`),
    "\tEND IF;",
  ].join("\n");
}

/** The payload of the topics batched so far, as `SyncChangeSchema` reads it. */
function payload(batch: string): string {
  return `'{"t":[' || ${batch} || '],"x":"' || sync_txid || '"}'`;
}

/** The loop sending each distinct topic once, batched under the payload limit. */
function notifyBlock(): string {
  const channel = quoteLiteral(SYNC_CHANNEL);
  return [
    "\tFOR sync_topic IN",
    `\t\tSELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"`,
    "\tLOOP",
    `\t\tIF sync_batch <> '' AND octet_length(${payload(`sync_batch || ',' || sync_topic::text`)}) >= ${SYNC_PAYLOAD_BYTES} THEN`,
    `\t\t\tPERFORM pg_notify(${channel}, ${payload("sync_batch")});`,
    "\t\t\tsync_batch := '';",
    "\t\tEND IF;",
    "\t\tsync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;",
    "\tEND LOOP;",
    "\tIF sync_batch <> '' THEN",
    `\t\tPERFORM pg_notify(${channel}, ${payload("sync_batch")});`,
    "\tEND IF;",
  ].join("\n");
}

function functionStatement(table: SyncTable): string {
  return [
    `CREATE OR REPLACE FUNCTION ${quoteIdentifier(syncFunctionName(table))}() RETURNS trigger LANGUAGE plpgsql AS $luke_sync$`,
    "DECLARE",
    "\tsync_topics jsonb := '[]';",
    "\tsync_topic jsonb;",
    "\tsync_batch text := '';",
    "\tsync_txid text := pg_current_xact_id()::text;",
    "BEGIN",
    recordBlock(table, RECORD.OLD),
    recordBlock(table, RECORD.NEW),
    notifyBlock(),
    "\tRETURN NULL;",
    "END",
    "$luke_sync$;",
  ].join("\n");
}

/** The `WHEN` of the update trigger: any watched column changed. */
function updateCondition(table: SyncTable): string {
  return table.watched
    .map(
      (column) => `OLD.${quoteIdentifier(column)} IS DISTINCT FROM NEW.${quoteIdentifier(column)}`,
    )
    .join(" OR ");
}

/** Renders the declaration's capture. */
export function renderSyncTable(table: SyncTable): SyncStatements {
  const on = quoteIdentifier(table.name);
  const execute = `EXECUTE FUNCTION ${quoteIdentifier(syncFunctionName(table))}()`;
  return {
    drop: [SYNC_TRIGGER.UPDATE, SYNC_TRIGGER.WRITE].map(
      (trigger) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(trigger)} ON ${on};`,
    ),
    create: [
      functionStatement(table),
      `CREATE TRIGGER ${quoteIdentifier(SYNC_TRIGGER.WRITE)} AFTER INSERT OR DELETE ON ${on} FOR EACH ROW ${execute};`,
      `CREATE TRIGGER ${quoteIdentifier(SYNC_TRIGGER.UPDATE)} AFTER UPDATE ON ${on} FOR EACH ROW WHEN (${updateCondition(table)}) ${execute};`,
    ],
  };
}

/**
 * A migration file carrying the tables' capture around its own statements:
 * their triggers dropped first, so a column a `WHEN` names can be dropped or
 * renamed, and the capture created last, over the columns as they then stand.
 */
export function syncMigration(tables: readonly SyncTable[], statements: string): string {
  const rendered = tables.map(renderSyncTable);
  const own = statements.trim();
  return [
    ...rendered.flatMap((capture) => capture.drop),
    ...(own.length === 0 ? [] : [own]),
    ...rendered.flatMap((capture) => capture.create),
  ].join(STATEMENT_BREAKPOINT);
}
