import { getTableConfig } from "drizzle-orm/pg-core";
import { syncLog } from "../schemas/sync-log.js";
import { SYNC_CHANNEL, SYNC_PAYLOAD_BYTES } from "./notification.js";
import {
  LOG,
  SYNC_OBJECT_PREFIX,
  type SyncColumnTopic,
  type SyncTable,
  type SyncTableLog,
  type SyncTableLookup,
} from "./sync-table.js";

export const SYNC_TRIGGER = {
  WRITE: `${SYNC_OBJECT_PREFIX}write`,
  UPDATE: `${SYNC_OBJECT_PREFIX}update`,
} as const;

const RECORD = { OLD: "OLD", NEW: "NEW" } as const;

type Record = (typeof RECORD)[keyof typeof RECORD];

const STATEMENT_BREAKPOINT = "\n--> statement-breakpoint\n";

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

export function syncFunctionName(table: SyncTable): string {
  return `${SYNC_OBJECT_PREFIX}${table.name}`;
}

function topicJson(topic: SyncColumnTopic, owner: string): string {
  return `jsonb_build_array(${quoteLiteral(topic.kind)}, ${owner}.${quoteIdentifier(topic.column)}::text)`;
}

function ownTopics(table: SyncTable, record: Record): readonly string[] {
  if (table.topics.length === 0) return [];
  const pairs = table.topics.map((topic) => topicJson(topic, record)).join(", ");
  return [`sync_topics := sync_topics || jsonb_build_array(${pairs});`];
}

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

function keyJson(key: readonly string[], record: Record): string {
  const pairs = key.map(
    (column) => `${quoteLiteral(column)}, ${record}.${quoteIdentifier(column)}`,
  );
  return `jsonb_build_object(${pairs.join(", ")})`;
}

function logColumns(): string {
  const columns = [syncLog.txid, syncLog.tableName, syncLog.key, syncLog.topics];
  return columns.map((column) => quoteIdentifier(column.name)).join(", ");
}

function logStatements(table: SyncTable, log: SyncTableLog): readonly string[] {
  return [
    "IF TG_OP <> 'INSERT' THEN",
    `\tsync_keys := sync_keys || jsonb_build_array(${keyJson(log.key, RECORD.OLD)});`,
    "END IF;",
    "IF TG_OP <> 'DELETE' THEN",
    `\tsync_keys := sync_keys || jsonb_build_array(${keyJson(log.key, RECORD.NEW)});`,
    "END IF;",
    `INSERT INTO ${quoteIdentifier(getTableConfig(syncLog).name)} (${logColumns()}) SELECT`,
    `\tpg_current_xact_id()::text::bigint, ${quoteLiteral(table.name)},`,
    `\t(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),`,
    `\tcoalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');`,
  ];
}

function rowsLogged(log: SyncTableLog): string {
  const changed = log.updatesOf.map(
    (column) => `OLD.${quoteIdentifier(column)} IS DISTINCT FROM NEW.${quoteIdentifier(column)}`,
  );
  return ["TG_OP <> 'UPDATE'", ...changed].join(" OR ");
}

function logBlock(table: SyncTable, log: SyncTableLog): string {
  const statements = logStatements(table, log);
  if (log.writes === LOG.EVERY) return statements.map((line) => `\t${line}`).join("\n");
  return [
    `\tIF ${rowsLogged(log)} THEN`,
    ...statements.map((line) => `\t\t${line}`),
    "\tEND IF;",
  ].join("\n");
}

function payload(batch: string): string {
  return `'{"t":[' || ${batch} || '],"x":"' || sync_txid || '"}'`;
}

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
  const log = table.log;
  return [
    `CREATE OR REPLACE FUNCTION ${quoteIdentifier(syncFunctionName(table))}() RETURNS trigger LANGUAGE plpgsql AS $app_sync$`,
    "DECLARE",
    "\tsync_topics jsonb := '[]';",
    "\tsync_topic jsonb;",
    "\tsync_batch text := '';",
    "\tsync_txid text := pg_current_xact_id()::text;",
    ...(log === undefined ? [] : ["\tsync_keys jsonb := '[]';"]),
    "BEGIN",
    recordBlock(table, RECORD.OLD),
    recordBlock(table, RECORD.NEW),
    ...(log === undefined ? [] : [logBlock(table, log)]),
    notifyBlock(),
    "\tRETURN NULL;",
    "END",
    "$app_sync$;",
  ].join("\n");
}

function updateCondition(table: SyncTable): string {
  return table.watched
    .map(
      (column) => `OLD.${quoteIdentifier(column)} IS DISTINCT FROM NEW.${quoteIdentifier(column)}`,
    )
    .join(" OR ");
}

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

export function syncMigration(tables: readonly SyncTable[], statements: string): string {
  const rendered = tables.map(renderSyncTable);
  const own = statements.trim();
  return [
    ...rendered.flatMap((capture) => capture.drop),
    ...(own.length === 0 ? [] : [own]),
    ...rendered.flatMap((capture) => capture.create),
  ].join(STATEMENT_BREAKPOINT);
}

export function syncFunctionMigration(tables: readonly SyncTable[], statements: string): string {
  const own = statements.trim();
  return [...(own.length === 0 ? [] : [own]), ...tables.map(functionStatement)].join(
    STATEMENT_BREAKPOINT,
  );
}
