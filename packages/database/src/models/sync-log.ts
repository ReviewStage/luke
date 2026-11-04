/**
 * sync-log.ts -- where the sync log stands for a reader, and its pruning.
 *
 * A logged table's capture writes one row per row written
 * (`../sync/render.ts`) under its transaction's id, and transactions commit
 * in no particular order, so a reader handed the newest id it sees could
 * pass over a smaller one still to commit. It is handed the settled id
 * instead: the oldest transaction id still running as its snapshot was taken
 * (`pg_snapshot_xmin`), below which every transaction has ended, committed
 * or rolled back. Note that a snapshot's `xmax` is no such bound: it is one
 * past the newest transaction to end, so a transaction that took its id
 * after that one and still runs stands at or above it, outside the
 * snapshot's list of running ids, and `xmin` is never above `xmax`. A
 * transaction left
 * open anywhere, a migration among them, holds the settled id back until it
 * ends, and every reader's deltas with it.
 *
 * A reader past id N reads the rows N <= txid < S. They need not be read in
 * the snapshot S was read in, only in one taken after it: every transaction
 * below S had ended before S's snapshot, so every later snapshot sees each
 * one's rows, or none of a rolled-back one's, and the rows at or past S a
 * later snapshot sees beside them are the bound's to leave out.
 *
 * Pruning cuts a prefix of whole transactions, never a row from the middle:
 * it deletes every row below the first young row's transaction
 * (`SYNC_LOG.KEEP_MS`), never at or past the settled id, so a row still to
 * commit stays, and never the newest transaction's, so the floor stands. A
 * reader at or past the floor is therefore missing no row between its id and
 * the settled one. Note that a row's `at` is when its transaction began, so
 * a long transaction's row can stand old above young ones, which is why the
 * cut is by id up to the first young row rather than by age.
 */

import { lt, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { syncLog } from "../schemas/sync-log.js";

type SyncLogEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export const SYNC_LOG = {
  /** How long a row is kept: three days, so a host asleep over a weekend still catches up by deltas. */
  KEEP_MS: 3 * 24 * 60 * 60 * 1_000,
  /** How many transactions' rows one sweep prunes at most. */
  PRUNE_TRANSACTIONS: 5_000,
  /** How many of a window's rows a delta carries at most; a reader further behind is answered whole. */
  MOST: 50_000,
} as const;

/** Where the log stands for a reader, each as a transaction id. */
export interface SyncStanding {
  /** The settled id: every transaction below it has ended. */
  readonly settled: number;
  /** The oldest transaction id pruning left; undefined where nothing is logged. */
  readonly floor: number | undefined;
}

/** One topic a log row names: its kind, then its id. */
const LoggedTopicSchema = Schema.Tuple([Schema.String, Schema.String]);

/** A distinct row of a reader's window: its table, its keys by column, the topics it names, and whether one is the reader's. */
const SyncWindowRowSchema = Schema.Struct({
  table: Schema.String,
  key: Schema.Array(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))),
  topics: Schema.Array(LoggedTopicSchema),
  reached: Schema.Boolean,
});

export type SyncWindowRow = typeof SyncWindowRowSchema.Type;

/** What a reader past an id is told of the log up to the settled one. */
export interface SyncWindow {
  /** The oldest transaction id pruning left; undefined where nothing is logged. */
  readonly floor: number | undefined;
  /**
   * The window's distinct rows that name one of the reader's topics, or are
   * of a table taken whatever it names, at most `SYNC_LOG.MOST` and one
   * more, so a window past the bound is told by its length.
   */
  readonly rows: readonly SyncWindowRow[];
  /** The ids of the transactions whose rows name one of the reader's topics, each once. */
  readonly txids: readonly string[];
}

/** What a window is read over. */
export interface SyncWindowAsk {
  /** The id the reader holds every row below. */
  readonly past: number;
  /** The settled id the window ends below. */
  readonly settled: number;
  /** The tables whose rows the read follows. */
  readonly tables: readonly string[];
  /** The tables whose rows are taken whatever topics they name. */
  readonly anyTopic: readonly string[];
  /** The reader's topics, each a kind and an id. */
  readonly topics: readonly (readonly [string, string])[];
}

/** The settled id: the oldest transaction still running as the statement's snapshot was taken. */
const SETTLED_TXID = sql`pg_snapshot_xmin(pg_current_snapshot())::text::bigint`;

/**
 * The settled id and the oldest logged transaction's id, in one statement
 * written as SQL, since the builder takes no select of expressions alone,
 * each read as text so every driver answers them alike.
 */
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

/**
 * The window's distinct rows the reader's topics reach or that are of a
 * table taken whatever they name, the txids of those it reaches, and the
 * floor, in one statement written as SQL for the same reason as the
 * standing's, its lists bound as JSON text so one placeholder carries each.
 */
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

/**
 * The rows of every transaction below the first young row's, the settled id,
 * the newest logged transaction, and a sweep's worth of transactions past the
 * oldest, deleted; their ids, one per row.
 */
const deletePrunable = SqlSchema.findAll({
  Request: Schema.Struct({ youngAfter: Schema.Date, transactions: Schema.Int }),
  Result: Schema.Struct({ txid: Schema.Number }),
  execute: ({ youngAfter, transactions }) =>
    Database.use((db) => {
      const firstYoung = sql`(select ${syncLog.txid} from ${syncLog} where ${syncLog.at} > ${youngAfter.toISOString()}::timestamptz order by ${syncLog.txid} limit 1)`;
      const newest = sql`(select ${syncLog.txid} from ${syncLog} order by ${syncLog.txid} desc limit 1)`;
      const sweepEnd = sql`(select distinct ${syncLog.txid} from ${syncLog} order by ${syncLog.txid} offset ${transactions} limit 1)`;
      // Note that `least` passes over a null, so a log with no young row is cut below its newest transaction alone.
      return db
        .delete(syncLog)
        .where(lt(syncLog.txid, sql`least(${firstYoung}, ${SETTLED_TXID}, ${newest}, ${sweepEnd})`))
        .returning({ txid: syncLog.txid });
    }),
});

/** Where the log stands for a reader: its settled id and its floor. */
export function syncStanding(): SyncLogEffect<SyncStanding> {
  // Note that a select of expressions alone answers one row, so no row is a defect rather than a failure a caller reads.
  return findStanding(undefined).pipe(
    Effect.map(({ settled, floor }) => ({ settled, floor: floor ?? undefined })),
    Effect.catchTag("NoSuchElementError", (error) => Effect.die(error)),
  );
}

/**
 * The log between the reader's id and the settled one, as a delta read
 * reads it: the rows the reader's topics reach, and those of the tables
 * taken whatever they name, whose keys only narrow a statement that keeps
 * its own rule of who reads it. It is read after the settled id was, in a
 * later snapshot, which is all the window needs (see the header).
 */
export function readSyncWindow(ask: SyncWindowAsk): SyncLogEffect<SyncWindow> {
  // Note that a select of expressions alone answers one row, so no row is a defect rather than a failure a caller reads.
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

/** The scheduled sweep's prune: a sweep's worth of the transactions older than `SYNC_LOG.KEEP_MS` at `now`, cut from the oldest; how many rows went. */
export function pruneSyncLog(now: Date): SyncLogEffect<number> {
  return Effect.map(
    deletePrunable({
      youngAfter: new Date(now.getTime() - SYNC_LOG.KEEP_MS),
      transactions: SYNC_LOG.PRUNE_TRANSACTIONS,
    }),
    (rows) => rows.length,
  );
}
