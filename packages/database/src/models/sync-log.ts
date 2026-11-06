import { lt, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { syncLog } from "../schemas/sync-log.js";

type SyncLogEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export const SYNC_LOG = {
  KEEP_MS: 3 * 24 * 60 * 60 * 1_000,
  PRUNE_TRANSACTIONS: 5_000,
  MOST: 50_000,
} as const;

export interface SyncStanding {
  readonly settled: number;
  readonly floor: number | undefined;
}

const LoggedTopicSchema = Schema.Tuple([Schema.String, Schema.String]);

const SyncWindowRowSchema = Schema.Struct({
  table: Schema.String,
  key: Schema.Array(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
  topics: Schema.Array(LoggedTopicSchema),
  reached: Schema.Boolean,
});

export type SyncWindowRow = typeof SyncWindowRowSchema.Type;

export interface SyncWindow {
  readonly floor: number | undefined;
  readonly rows: readonly SyncWindowRow[];
  readonly txids: readonly string[];
}

export interface SyncWindowAsk {
  readonly past: number;
  readonly settled: number;
  readonly tables: readonly string[];
  readonly anyTopic: readonly string[];
  readonly topics: readonly (readonly [string, string])[];
}

const SETTLED_TXID = sql`pg_snapshot_xmin(pg_current_snapshot())::text::bigint`;

const findStanding = SqlSchema.findOne({
  Request: Schema.Void,
  Result: Schema.Struct({
    settled: Schema.NumberFromString,
    floor: Schema.NullOr(Schema.NumberFromString),
  }),
  execute: () =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (client) => client`
        select pg_snapshot_xmin(pg_current_snapshot())::text as settled,
          (select txid from sync_log order by txid limit 1)::text as floor`,
    ),
});

const findWindow = SqlSchema.findOne({
  Request: Schema.Struct({
    past: Schema.Number,
    settled: Schema.Number,
    tables: Schema.String,
    anyTopic: Schema.String,
    topics: Schema.String,
    most: Schema.Number,
  }),
  Result: Schema.Struct({
    floor: Schema.NullOr(Schema.NumberFromString),
    rows: Schema.Array(SyncWindowRowSchema),
    txids: Schema.Array(Schema.String),
  }),
  execute: ({ past, settled, tables, anyTopic, topics, most }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (client) => client`
        with sync_window as (
          select txid, table_name, key, topics,
            exists (
              select 1 from jsonb_array_elements(${topics}::jsonb) as reader(topic)
              where sync_log.topics @> jsonb_build_array(reader.topic)
            ) as reached
          from sync_log
          where txid >= ${past} and txid < ${settled}
            and table_name in (select jsonb_array_elements_text(${tables}::jsonb))
        )
        select
          (select txid from sync_log order by txid limit 1)::text as floor,
          coalesce((
            select jsonb_agg(taken) from (
              select distinct table_name as "table", key, topics, reached from sync_window
              where reached or table_name in (select jsonb_array_elements_text(${anyTopic}::jsonb))
              limit ${most + 1}
            ) as taken
          ), '[]'::jsonb) as rows,
          coalesce((
            select jsonb_agg(distinct txid::text) from sync_window where reached
          ), '[]'::jsonb) as txids`,
    ),
});

const deletePrunable = SqlSchema.findAll({
  Request: Schema.Struct({ youngAfter: Schema.Date, transactions: Schema.Int }),
  Result: Schema.Struct({ txid: Schema.Number }),
  execute: ({ youngAfter, transactions }) =>
    Database.use((db) => {
      const firstYoung = sql`(select ${syncLog.txid} from ${syncLog} where ${syncLog.at} > ${youngAfter.toISOString()}::timestamptz order by ${syncLog.txid} limit 1)`;
      const newest = sql`(select ${syncLog.txid} from ${syncLog} order by ${syncLog.txid} desc limit 1)`;
      const sweepEnd = sql`(select distinct ${syncLog.txid} from ${syncLog} order by ${syncLog.txid} offset ${transactions} limit 1)`;
      return db
        .delete(syncLog)
        .where(lt(syncLog.txid, sql`least(${firstYoung}, ${SETTLED_TXID}, ${newest}, ${sweepEnd})`))
        .returning({ txid: syncLog.txid });
    }),
});

export function syncStanding(): SyncLogEffect<SyncStanding> {
  return findStanding(undefined).pipe(
    Effect.map(({ settled, floor }) => ({ settled, floor: floor ?? undefined })),
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}

export function readSyncWindow(ask: SyncWindowAsk): SyncLogEffect<SyncWindow> {
  return findWindow({
    past: ask.past,
    settled: ask.settled,
    tables: JSON.stringify(ask.tables),
    anyTopic: JSON.stringify(ask.anyTopic),
    topics: JSON.stringify(ask.topics),
    most: SYNC_LOG.MOST,
  }).pipe(
    Effect.map(({ floor, rows, txids }) => ({ floor: floor ?? undefined, rows, txids })),
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}

export function pruneSyncLog(now: Date): SyncLogEffect<number> {
  return Effect.map(
    deletePrunable({
      youngAfter: new Date(now.getTime() - SYNC_LOG.KEEP_MS),
      transactions: SYNC_LOG.PRUNE_TRANSACTIONS,
    }),
    (rows) => rows.length,
  );
}
