import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * write-receipt.ts -- the idempotency key a write was taken under, kept so the write sent again under it is answered without running twice.
 *
 * A Mac that sent a write and heard no answer sends it again under the
 * same key (`Idempotency-Key`), and a key that stands here is answered as
 * already written (`packages/service/src/orpc/base.ts`'s
 * `writeReceiptMiddleware`). A receipt is written once its write commits,
 * and the account's receipts older than the window are pruned as each is
 * written. The rows go with their account.
 */
export const writeReceipt = pgTable(
  "write_receipt",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The key the write was sent under, as its sender minted it. */
    key: text("key").notNull(),
    /** When the write was taken, which bounds how long its key is held. */
    writtenAt: timestamptz("written_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);
