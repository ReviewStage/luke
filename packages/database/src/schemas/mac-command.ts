import {
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandResult,
} from "@repo/features/mac-command-wire";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const macCommand = pgTable(
  "mac_command",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MacCommandKind>().notNull().default(MAC_COMMAND_KIND.SHELL),
    command: text("command"),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    queuedAt: timestamptz("queued_at").notNull(),
    claimedAt: timestamptz("claimed_at"),
    result: jsonb("result").$type<MacCommandResult>(),
  },
  (table) => [index("mac_command_waiting").on(table.userId, table.claimedAt)],
);

export const macCommandListener = pgTable("mac_command_listener", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seenAt: timestamptz("seen_at").notNull(),
});
