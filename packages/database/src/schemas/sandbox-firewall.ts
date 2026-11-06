import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const sandboxFirewall = pgTable(
  "sandbox_firewall",
  {
    sandboxSessionId: text("sandbox_session_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: uuid("version").notNull(),
    agentId: text("agent_id"),
    sealedEntries: text("sealed_entries").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.sandboxSessionId] }),
    index("sandbox_firewall_session").on(table.sandboxSessionId),
    index("sandbox_firewall_updated").on(table.updatedAt),
  ],
);
