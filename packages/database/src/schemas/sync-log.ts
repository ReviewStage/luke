/**
 * sync-log.ts -- the log of Sync's logged writes: one row per row a logged table's write touched, in the order of the transactions that wrote them.
 *
 * A logged table's capture (`../sync/render.ts`) writes here inside the
 * write's own transaction, so a row stands exactly when the write it logs
 * committed. Its order is its transaction's id, the one counter every
 * transaction takes its id from, and a reader is handed only an id below
 * which nothing can still commit (`../models/sync-log.ts`). A row names the
 * row written by its key alone, never its data, so no column of a logged
 * table, a credential among them, reaches the log.
 */

import { bigint, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * One row a logged write touched: the logging transaction's id, Postgres's
 * 64-bit `xid8` cast to a bigint (it reaches 2^63 only after two billion
 * wraparounds of the 32-bit counter), which every driver reads as a number
 * where the `xid8` itself comes back in binary none decodes; when that
 * transaction began, the table, the row's primary-key columns by name (one
 * key, or the old and the new where an update moved it), and the write's
 * topics, each once, as it notified them.
 */
export const syncLog = pgTable(
  "sync_log",
  {
    txid: bigint("txid", { mode: "number" }).notNull(),
    at: timestamptz("at").notNull().defaultNow(),
    tableName: text("table_name").notNull(),
    key: jsonb("key").notNull(),
    topics: jsonb("topics").notNull(),
  },
  (table) => [
    // A reader reads the transactions between two ids, and pruning cuts from the oldest.
    index("sync_log_txid").on(table.txid),
  ],
);
