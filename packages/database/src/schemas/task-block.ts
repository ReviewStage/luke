import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { task } from "./task.js";

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
    primaryKey({ columns: [table.blockedTaskId, table.blockerTaskId] }),
    index("task_block_blocker").on(table.blockerTaskId),
    check("task_block_not_self", sql`${table.blockerTaskId} <> ${table.blockedTaskId}`),
  ],
);
