import { bigint, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

/**
 * The hosted brain's identity workspace and notebook, one row per user per
 * file: the operating instructions, persona, and curated memory the desktop
 * keeps under `agents/main/workspace`, and the dated notes under `memory/`,
 * seeded once and edited only by the brain's own workspace tools. The path
 * is the workspace-relative file name and the contents stand beside it as
 * plain text, migration 0033 having unsealed the column: an operator can
 * read a notebook, and what keeps it the developer's own is the account the
 * row is keyed by, not a cipher.
 */
export const workspaceFile = pgTable(
  "workspace_file",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    /** The file's whole contents. */
    content: text("content").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.path] })],
);

/**
 * The embedding cache behind the notebook's search: one row per user per
 * passage hash, holding the vector the embeddings model answered for the
 * passage and the model it was answered under, and never a word of the
 * passage. The hash is SHA-256 of the words, which names the passage to a
 * search that has just cut the same words again and identifies nothing to
 * anyone else; the words themselves stand only in `workspace_file`.
 */
export const workspaceEmbedding = pgTable(
  "workspace_embedding",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    model: text("model").notNull(),
    /** The vector whole, as the model answered it. */
    embedding: jsonb("embedding").$type<readonly number[]>().notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.hash] })],
);
