import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./plan.js";

/**
 * plan-pin.ts -- one plan an account pinned in its sidebar, and when.
 *
 * A pin lives on the account rather than on the plan because it is the
 * developer's reading of their own work, as a repository's pin is
 * (`repository-pin.ts`): a plan of a shared workspace pinned by one member
 * stands pinned for them alone, and follows their sign-in to every Mac.
 * Pinning a plan already pinned keeps the instant it was first pinned;
 * dragging it in the sidebar gives it a position, which a pin with none
 * stands beside by that instant; unpinning deletes the row. Each row
 * leaves with its account or its plan, whichever goes first, and one left
 * behind by a member who has since left the workspace reads as nothing,
 * since every read gates on membership first.
 */
export const taskPin = pgTable(
  "plan_pin",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("plan_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    // Where the pin stands in the sidebar's Pinned section once it has been dragged, a fractional index (`@luke/features/pin-order`); null stands it by `pinnedAt`.
    position: text("position"),
    pinnedAt: timestamptz("pinned_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    // A plan's delete cascades to its pins, found by the plan alone.
    index("plan_pin_plan").on(table.taskId),
  ],
);
