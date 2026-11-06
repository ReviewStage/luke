import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { conversations } from "./storage.js";

export const sandboxTerminalLease = pgTable("sandbox_terminal_lease", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  heldUntil: timestamptz("held_until").notNull(),
  credentialAt: timestamptz("credential_at"),
  credentialSession: text("credential_session"),
});
