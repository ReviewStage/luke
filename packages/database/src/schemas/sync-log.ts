import { bigint, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

export const syncLog = pgTable(
  "sync_log",
  {
    txid: bigint("txid", { mode: "number" }).notNull(),
    at: timestamptz("at").notNull().defaultNow(),
    tableName: text("table_name").notNull(),
    key: jsonb("key").notNull(),
    topics: jsonb("topics").notNull(),
  },
  (table) => [index("sync_log_txid").on(table.txid)],
);
