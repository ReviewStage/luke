import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./task.js";

/**
 * task-read.ts -- one member's read mark on one task: the newest change they looked at, and whether they marked it unread.
 *
 * A mark lives on the account rather than on the window because it is the
 * member's reading of their own work, as a pin is (`task-pin.ts`), so it
 * follows their sign-in to every Mac and browser. A task is unread for a
 * member while it changed after the instant their mark reads through, or
 * while they marked it unread and have not opened it since. A member with no
 * mark reads the task through its own `read_through` (`task.ts`), or its
 * start where that is null. The instant is the service's, never a window's
 * clock, and a look only ever moves it forward. Each row leaves with its
 * account or its task.
 */
export const taskRead = pgTable(
  "task_read",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** The task's newest change the member looked at; null where they marked it unread before ever looking. */
    readThrough: timestamptz("read_through"),
    /** Whether the member marked the task unread and has not opened it since. */
    markedUnread: boolean("marked_unread").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    // A task's delete cascades to its marks, found by the task alone.
    index("task_read_task").on(table.taskId),
  ],
);
