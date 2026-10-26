import { pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { conversations } from "./storage.js";

/**
 * native-call-key.ts -- the key a native agent's call of a Luke tool runs under, kept so the call run again runs under the same one.
 *
 * eve keys a tool call on its own id for the call, so a call run again
 * sends or starts once. A Claude Code or Codex agent reaches Luke's tools
 * over MCP (`packages/service/src/agents/luke-mcp/`), whose server keeps no
 * session and whose harness names a retry by nothing the first call had, so
 * the server keys a call on a row here: one per conversation, tool, and
 * input, holding the key the first call was given and when, which a call of
 * the same input within the window reads back, and one past it replaces.
 * The rows go with their conversation.
 */
export const nativeCallKey = pgTable(
  "native_call_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The digest of the tool's name and the call's input, as the server takes them. */
    digest: text("digest").notNull(),
    /** The key the call runs under, as eve's id for a call is. */
    key: text("key").notNull(),
    /** When the key was minted, which bounds the window a call of the same input reads it within. */
    mintedAt: timestamptz("minted_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.conversationId, table.digest] })],
);
