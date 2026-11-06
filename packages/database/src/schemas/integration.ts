import type { IntegrationProvider } from "@repo/features/integration-wire";
import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const integrationConnection = pgTable(
  "integration_connection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    connectSubject: text("connect_subject").notNull(),
    connectionName: text("connection_name").notNull(),
    label: text("label"),
    status: text("status").notNull(),
    state: text("state"),
    stateIssuedAt: timestamptz("state_issued_at"),
    connectVerifier: text("connect_verifier"),
    connectedAt: timestamptz("connected_at"),
    tools: jsonb("tools").$type<unknown>(),
    toolsListedAt: timestamptz("tools_listed_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connection_user_name_idx").on(table.userId, table.connectionName),
    uniqueIndex("integration_connection_provider_subject_idx").on(
      table.provider,
      table.connectSubject,
    ),
    uniqueIndex("integration_connection_state_idx").on(table.state),
    index("integration_connection_user_provider_idx").on(table.userId, table.provider),
  ],
);
