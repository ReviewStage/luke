import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

export const sessionSandboxCleanup = pgTable(
  "session_sandbox_cleanup",
  {
    sessionId: text("session_id").primaryKey(),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    triedAt: timestamptz("tried_at"),
  },
  (table) => [index("session_sandbox_cleanup_next").on(table.triedAt, table.queuedAt)],
);
