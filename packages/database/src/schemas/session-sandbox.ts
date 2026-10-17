import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * session-sandbox.ts -- an eve session whose Vercel Sandbox is still to be deleted.
 *
 * A row is queued where Luke lets go of a session for good: the purge of a
 * deleted task's conversations thirty days on, and an account's deletion.
 * The scheduled sweep deletes the sandbox eve tagged with the session's id,
 * with the snapshots only it kept, and then the row; a delete Vercel did not
 * confirm stamps `tried_at` and waits for a later sweep. The row names the
 * session alone and no account, because it must outlive the account whose
 * deletion queued it, and an eve run id says nothing of what was said in it.
 */
export const sessionSandboxCleanup = pgTable(
  "session_sandbox_cleanup",
  {
    sessionId: text("session_id").primaryKey(),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    /** When a sweep last tried and Vercel did not confirm the delete; null until one has. */
    triedAt: timestamptz("tried_at"),
  },
  (table) => [index("session_sandbox_cleanup_next").on(table.triedAt, table.queuedAt)],
);
