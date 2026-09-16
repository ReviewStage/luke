import { pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";
import { instant } from "./instant.js";

/**
 * One row per account for scalar cross-device preferences. Platform-local
 * settings stay in each app's own store; only preferences that should follow
 * the signed-in account belong here.
 */
export const accountPreference = pgTable("account_preference", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  voice: text("voice"),
  defaultWorkspaceProvider: text("default_workspace_provider"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * Workspace creation defaults are keyed by provider. Keeping them as rows
 * avoids turning account preferences into an open-ended JSON settings bag.
 */
export const accountWorkspacePreference = pgTable(
  "account_workspace_preference",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    defaultProjectId: text("default_project_id"),
    agent: text("agent"),
    model: text("model"),
    effort: text("effort"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.providerId] })],
);
