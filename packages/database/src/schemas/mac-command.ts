import {
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * mac-command.ts -- a command an agent asked to run on the developer's Mac, queued until a Mac of the account runs it.
 *
 * The agent's call inserts the row and waits on it; a signed-in Mac holding
 * the account's read claims it, runs it, and writes its result; the call
 * reads the result and deletes the row, so a row stands only while its call
 * does. A Mac claims only rows of the kinds its read named. Every row
 * belongs to the account and leaves with it.
 */
export const macCommand = pgTable(
  "mac_command",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** What the command asks; a row queued before kinds were is a shell command. */
    kind: text("kind").$type<MacCommandKind>().notNull().default(MAC_COMMAND_KIND.SHELL),
    /** A shell command's text; null for any other kind. */
    command: text("command"),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    queuedAt: timestamptz("queued_at").notNull(),
    /** When a Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** What it came to, once the Mac that took it said; null until then. */
    result: jsonb("result").$type<MacCommandResult>(),
  },
  (table) => [index("mac_command_waiting").on(table.userId, table.claimedAt)],
);

/**
 * When a Mac of the account last held the read for its commands, which is
 * what an agent's call reads as Luke running on the developer's Mac with
 * the setting on, and so taking shell commands, which every Mac runs. One
 * row per account, moved on every read.
 */
export const macCommandListener = pgTable("mac_command_listener", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seenAt: timestamptz("seen_at").notNull(),
});
