import {
  MAC_COMMAND_KIND,
  type MacCommandImage,
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
 * belongs to the account and leaves with it. A browser command's image,
 * such as a screenshot, waits here beside its JSON result rather than in
 * it, and leaves with the row as its call reads it, so nothing keeps it.
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
    /** What a command of any other kind carries; null for a shell command. */
    params: jsonb("params").$type<Schema.Json>(),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    queuedAt: timestamptz("queued_at").notNull(),
    /** When a Mac took it; null while it waits. */
    claimedAt: timestamptz("claimed_at"),
    /** What it came to, once the Mac that took it said; null until then. Never its image. */
    result: jsonb("result").$type<MacCommandResult>(),
    /** The image a browser command's result carries, as its bytes; null for every other result. */
    resultImage: bytea("result_image"),
    /** The type `resultImage` is, null where it is. */
    resultImageType: text("result_image_type").$type<MacCommandImage["mediaType"]>(),
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
 * When a Mac of the account last held the read naming a kind beyond
 * `shell`, which is what a call of that kind reads as a Mac listening that
 * can run it. One row per account and kind, moved on every read that names
 * it, so two Macs of different versions are each counted for what they run.
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
