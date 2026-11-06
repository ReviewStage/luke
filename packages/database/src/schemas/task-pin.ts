import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./task.js";

export const taskPin = pgTable(
  "task_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    position: text("position"),
    pinnedAt: timestamptz("pinned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    index("task_pin_task").on(table.taskId),
  ],
);
