import { bigint, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The hosted brain's identity workspace and notebook, one row per user per
 * file: the operating instructions, persona, and curated memory the desktop
 * keeps under `agents/main/workspace`, and the dated notes under `memory/`,
 * seeded once and edited only by the brain's own workspace tools. The path
 * is the workspace-relative file name and stands clear; the contents are
 * sealed, because every word of them is the developer's or the brain's.
 */
export const workspaceFile = pgTable(
  "workspace_file",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    /** The file's whole contents. Sealed. */
    sealedContent: text("sealed_content").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.path] })],
);

/**
 * The durable facts Luke keeps about the developer, in the order they were
 * remembered. The list is replaced whole, as the desktop's fact store was, so
 * a changed fact takes the place of the one it corrects rather than standing
 * beside it. The words are sealed; the id is what a request to forget names.
 */
export const personalFact = pgTable(
  "personal_fact",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    ordinal: integer("ordinal").notNull(),
    /** The fact's words. Sealed. */
    sealedWords: text("sealed_words").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);
