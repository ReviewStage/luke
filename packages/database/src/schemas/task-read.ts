import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./task.js";

export const taskRead = pgTable(
  "task_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    readThrough: timestamptz("read_through"),
    markedUnread: boolean("marked_unread").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    index("task_read_task").on(table.taskId),
  ],
);
