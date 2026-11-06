import { getColumnTable } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import type { TopicKind } from "./notification.js";

export const SYNC_OBJECT_PREFIX = "app_sync_";

const IDENTIFIER_BYTES = 63;

export const LOG = {
  EVERY: "every",
  ROWS: "rows",
} as const;

export type SyncLogWrites = (typeof LOG)[keyof typeof LOG];

type ColumnOf<T extends PgTable> = T["_"]["columns"][keyof T["_"]["columns"]];

interface SyncOwnTopic<T extends PgTable> {
  readonly kind: TopicKind;
  readonly column: ColumnOf<T>;
}

interface SyncLookup<T extends PgTable> {
  readonly through: PgTable;
  readonly key: PgColumn;
  readonly by: ColumnOf<T>;
  readonly topics: readonly { readonly kind: TopicKind; readonly column: PgColumn }[];
}

type SyncTopicSource<T extends PgTable> = SyncOwnTopic<T> | SyncLookup<T>;

export interface SyncTableOptions<T extends PgTable> {
  readonly topics: readonly SyncTopicSource<T>[];
  readonly ignore?: readonly ColumnOf<T>[];
  readonly log?: SyncLogWrites;
  readonly logUpdatesOf?: readonly ColumnOf<T>[];
}

export interface SyncColumnTopic {
  readonly kind: TopicKind;
  readonly column: string;
}

export interface SyncTableLookup {
  readonly table: string;
  readonly key: string;
  readonly by: string;
  readonly topics: readonly SyncColumnTopic[];
}

export interface SyncTableLog {
  readonly writes: SyncLogWrites;
  readonly key: readonly string[];
  readonly updatesOf: readonly string[];
}

export interface SyncTable {
  readonly name: string;
  readonly watched: readonly string[];
  readonly ignored: readonly string[];
  readonly topics: readonly SyncColumnTopic[];
  readonly lookups: readonly SyncTableLookup[];
  readonly log: SyncTableLog | undefined;
}

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

function primaryKeyOf(table: PgTable): readonly string[] {
  const config = getTableConfig(table);
  const key =
    config.primaryKeys[0]?.columns.map((column) => column.name) ??
    config.columns.flatMap((column) => (column.primary ? [column.name] : []));
  if (key.length === 0) throw new Error(`${config.name} is logged but has no primary key`);
  return key;
}

export function defineSyncTable<T extends PgTable>(
  table: T,
  { topics, ignore = [], log, logUpdatesOf = [] }: SyncTableOptions<T>,
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
  if (logUpdatesOf.length > 0 && log !== LOG.ROWS) {
    throw new Error(`${config.name} names updates to log but does not log its rows alone`);
  }
  for (const column of logUpdatesOf) {
    assertColumnOf(table, column, "a logged update's column");
    if (ignored.has(column.name)) {
      throw new Error(`${config.name} ignores ${column.name}, whose updates it logs`);
    }
  }
  return {
    name: config.name,
    watched: config.columns.flatMap((column) => (ignored.has(column.name) ? [] : [column.name])),
    ignored: [...ignored],
    topics: own.map((topic) => ({ kind: topic.kind, column: topic.column.name })),
    lookups,
    log:
      log === undefined
        ? undefined
        : {
            writes: log,
            key: primaryKeyOf(table),
            updatesOf: logUpdatesOf.map((column) => column.name),
          },
  };
}
