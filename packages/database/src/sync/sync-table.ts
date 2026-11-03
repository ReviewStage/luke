/**
 * sync-table.ts -- a synced table's declaration: the topics a write to it touches, and the hot columns whose change touches none.
 *
 * A declaration is all a table's capture is made from: `render.ts` writes
 * its trigger function and triggers from it, and the drift check holds the
 * database to what it renders. It names the topics a row touches, read from
 * the row's own columns or looked up through a parent the row names by a
 * foreign key, and the columns to `ignore`. Every other column is watched,
 * so a column added to the table later notifies by default rather than
 * leaving a view silently stale, and the column list read here off the
 * Drizzle table is what makes the drift check fail until its triggers are
 * regenerated. A table a delta read reads is also `log`ged: its capture
 * writes one row of the sync log (`../schemas/sync-log.ts`) per row written,
 * naming it by its primary key.
 */
import { getColumnTable } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import type { TopicKind } from "./notification.js";

/** The prefix of every function and trigger Sync's capture renders, which the drift check reads by. */
export const SYNC_OBJECT_PREFIX = "app_sync_";

/** Postgres's longest identifier, in bytes; a longer name is cut short without a word. */
const IDENTIFIER_BYTES = 63;

/** Which of a logged table's writes its capture logs. */
export const LOG = {
  /** Every insert, delete, and update of a watched column. */
  EVERY: "every",
  /** Inserts and deletes alone: a row's arrival and removal, for a table rewritten in place more often than any delta read reads it. */
  ROWS: "rows",
} as const;

export type SyncLogWrites = (typeof LOG)[keyof typeof LOG];

type ColumnOf<T extends PgTable> = T["_"]["columns"][keyof T["_"]["columns"]];

/** A topic the row names itself: its kind, and the row's column holding its id. */
interface SyncOwnTopic<T extends PgTable> {
  readonly kind: TopicKind;
  readonly column: ColumnOf<T>;
}

/**
 * Topics a row takes from a parent it names by a foreign key: those of every
 * `through` row whose `key` equals the row's `by`, so a lookup on a key that
 * is not unique (a user's memberships) yields one set of topics per match.
 */
interface SyncLookup<T extends PgTable> {
  readonly through: PgTable;
  readonly key: PgColumn;
  readonly by: ColumnOf<T>;
  readonly topics: readonly { readonly kind: TopicKind; readonly column: PgColumn }[];
}

type SyncTopicSource<T extends PgTable> = SyncOwnTopic<T> | SyncLookup<T>;

export interface SyncTableOptions<T extends PgTable> {
  readonly topics: readonly SyncTopicSource<T>[];
  /** The hot columns no view reads, whose change alone notifies nothing. */
  readonly ignore?: readonly ColumnOf<T>[];
  /** Which writes are logged; none, for a table no delta read reads. */
  readonly log?: SyncLogWrites;
}

/** A topic as the trigger reads it: its kind, and the SQL name of the column holding its id. */
export interface SyncColumnTopic {
  readonly kind: TopicKind;
  readonly column: string;
}

/** A lookup as the trigger runs it, in SQL names. */
export interface SyncTableLookup {
  readonly table: string;
  readonly key: string;
  readonly by: string;
  readonly topics: readonly SyncColumnTopic[];
}

/** How a logged table's capture logs its writes, in SQL names. */
export interface SyncTableLog {
  readonly writes: SyncLogWrites;
  /** The primary-key columns a log row names the row written by. */
  readonly key: readonly string[];
}

/** A declaration, resolved to the SQL names its capture is rendered from. */
export interface SyncTable {
  readonly name: string;
  /** Every column but the ignored, in the table's order. */
  readonly watched: readonly string[];
  readonly ignored: readonly string[];
  readonly topics: readonly SyncColumnTopic[];
  readonly lookups: readonly SyncTableLookup[];
  /** How its writes are logged; undefined for a table not logged. */
  readonly log: SyncTableLog | undefined;
}

/** Fails the declaration unless the column is one of the table's. */
function assertColumnOf(table: PgTable, column: PgColumn, role: string): void {
  if (getColumnTable(column) !== table) {
    throw new Error(
      `${role} ${column.name} is not a column of ${getTableConfig(table).name}, which declares it`,
    );
  }
}

function lookupOf<T extends PgTable>(table: T, lookup: SyncLookup<T>): SyncTableLookup {
  assertColumnOf(table, lookup.by, "the lookup's key");
  assertColumnOf(lookup.through, lookup.key, "the lookup's parent key");
  for (const topic of lookup.topics)
    assertColumnOf(lookup.through, topic.column, "a looked-up topic");
  if (lookup.topics.length === 0) throw new Error("a lookup names no topics");
  return {
    table: getTableConfig(lookup.through).name,
    key: lookup.key.name,
    by: lookup.by.name,
    topics: lookup.topics.map((topic) => ({ kind: topic.kind, column: topic.column.name })),
  };
}

/** The table's primary-key columns, its composite key's where it declares one; fails a table with none, which no log row could name a row of. */
function primaryKeyOf(table: PgTable): readonly string[] {
  const config = getTableConfig(table);
  const key =
    config.primaryKeys[0]?.columns.map((column) => column.name) ??
    config.columns.flatMap((column) => (column.primary ? [column.name] : []));
  if (key.length === 0) throw new Error(`${config.name} is logged but has no primary key`);
  return key;
}

/**
 * Declares a table synced: its writes notify the topics `topics` names, of
 * the row before and after, and an update notifies only where a column
 * outside `ignore` changed. A column a topic is read from can't be ignored,
 * since a row moving between tasks must notify both. A table given `log`
 * logs the writes it names too.
 */
export function defineSyncTable<T extends PgTable>(
  table: T,
  { topics, ignore = [], log }: SyncTableOptions<T>,
): SyncTable {
  const config = getTableConfig(table);
  if (config.schema !== undefined) throw new Error(`${config.name} is synced outside public`);
  if (Buffer.byteLength(`${SYNC_OBJECT_PREFIX}${config.name}`) > IDENTIFIER_BYTES) {
    throw new Error(`${config.name} is too long a name for its sync function`);
  }
  if (topics.length === 0) throw new Error(`${config.name} is synced on no topics`);
  for (const column of ignore) assertColumnOf(table, column, "an ignored column");
  const own = topics.flatMap((source) => ("column" in source ? [source] : []));
  const lookups = topics.flatMap((source) =>
    "through" in source ? [lookupOf(table, source)] : [],
  );
  for (const topic of own) assertColumnOf(table, topic.column, "a topic's column");
  const ignored = new Set(ignore.map((column) => column.name));
  const read = [...own.map((topic) => topic.column.name), ...lookups.map((lookup) => lookup.by)];
  for (const column of read) {
    if (ignored.has(column)) {
      throw new Error(`${config.name} ignores ${column}, which it reads topics from`);
    }
  }
  return {
    name: config.name,
    watched: config.columns.flatMap((column) => (ignored.has(column.name) ? [] : [column.name])),
    ignored: [...ignored],
    topics: own.map((topic) => ({ kind: topic.kind, column: topic.column.name })),
    lookups,
    log: log === undefined ? undefined : { writes: log, key: primaryKeyOf(table) },
  };
}
