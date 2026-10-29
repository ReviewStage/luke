import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { task } from "./task.js";

/**
 * task-block.ts -- one task blocking another, as Linear's blocks and blocked-by are.
 *
 * A row says the blocker blocks the blocked: the blocked task waits on the
 * blocker's work, and the blocker is the blocked task's blocked-by. Any two
 * tasks of one workspace may be joined, many to many, which the write that
 * adds a row holds to, since a column can't; nothing refuses to start a
 * blocked task, so a row is advice, never a lock. The pair is the row's
 * key, so a block is written once, and a task never blocks itself. A row
 * goes with either of its tasks.
 */
export const taskBlock = pgTable(
  "task_block",
  {
    blockerTaskId: uuid("blocker_task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    blockedTaskId: uuid("blocked_task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    // A task's blocked-by, read by the blocked task, which leads the key.
    primaryKey({ columns: [table.blockedTaskId, table.blockerTaskId] }),
    // What a task blocks, and its delete taking each of those rows.
    index("task_block_blocker").on(table.blockerTaskId),
    check("task_block_not_self", sql`${table.blockerTaskId} <> ${table.blockedTaskId}`),
  ],
);
