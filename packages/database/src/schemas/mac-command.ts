import {
  MAC_COMMAND_KIND,
  type MacCommandKind,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { Schema } from "effect";
import { bytea, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * mac-command.ts -- a command an agent asked to run on the developer's Mac, queued until a Mac of the account runs it.
 *
 * The agent's call inserts the row and waits on it; a signed-in Mac holding
 * the account's read claims it, runs it, and writes its result; the call
 * reads the result and deletes the row, so a row stands only while its call
 * does. A Mac claims only rows of the kinds its read named. Every row
 * belongs to the account and leaves with it.
 *
 * `params`, `result_image`, and `result_image_type` are written by nothing
 * now: they carried the Mac Browser commands agents no longer send, and are
 * left in place, unused, until a later migration drops them.
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
    /** Unused: what a command of another kind carried; null for a shell command. */
    params: jsonb("params").$type<Schema.Json>(),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    queuedAt: timestamptz("queued_at").notNull(),
    /** When a Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** What it came to, once the Mac that took it said; null until then. */
    result: jsonb("result").$type<MacCommandResult>(),
    /** Unused: the image a Mac Browser command's result carried; always null now. */
    resultImage: bytea("result_image"),
    /** Unused: the type `resultImage` was; always null now. */
    resultImageType: text("result_image_type"),
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

/**
 * Unused: when a Mac of the account last held the read naming a kind beyond
 * `shell`. No kind beyond `shell` is run now, so nothing writes or reads it;
 * it is left in place until a later migration drops it.
 */
export const macCommandListenerKind = pgTable(
  "mac_command_listener_kind",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MacCommandKind>().notNull(),
    seenAt: timestamptz("seen_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.kind] })],
);
