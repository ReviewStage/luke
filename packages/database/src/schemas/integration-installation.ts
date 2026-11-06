import type { TriggerProvider } from "@repo/features/trigger-catalog";
import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { IntegrationInstallationStatus } from "../integration-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

export const integrationInstallation = pgTable(
  "integration_installation",
  {
    provider: text("provider").$type<TriggerProvider>().notNull(),
    externalId: text("external_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status").$type<IntegrationInstallationStatus>().notNull(),
    accountLabel: text("account_label"),
    linkedByUserId: text("linked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.externalId] }),
    index("integration_installation_organization_id_idx").on(t.organizationId),
  ],
);

export const integrationInstallIntent = pgTable("integration_install_intent", {
  stateHash: text("state_hash").primaryKey(),
  provider: text("provider").$type<TriggerProvider>().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
