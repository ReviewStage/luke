import type { TriggerProvider } from "@luke/features/trigger-catalog";
import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { IntegrationInstallationStatus } from "../integration-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * integration-installation.ts -- an integration's own app installed on a workspace, whose deliveries fire that workspace's automations.
 *
 * A provider that fires automations (`@luke/features/trigger-catalog`)
 * delivers its events through an app of Luke's that an owner or admin
 * installs on their account at the provider: a Sentry organization installs
 * Luke's Sentry integration. Each installation stands for exactly one
 * workspace, keyed on the provider and the provider's own id for it (a
 * Sentry installation's uuid), so a delivery finds its workspace by the
 * installation it names and fires no other workspace's automations. The
 * status is the provider's word: an uninstall marks the row deleted rather
 * than removing it. `linked_by_user_id` is the member who installed it,
 * null once their account is gone. The row leaves with its workspace.
 */
export const integrationInstallation = pgTable(
  "integration_installation",
  {
    provider: text("provider").$type<TriggerProvider>().notNull(),
    /** The provider's own id for the installation. */
    externalId: text("external_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status").$type<IntegrationInstallationStatus>().notNull(),
    /** The account's name at the provider (a Sentry organization's slug), as the settings row names it; null where none was read. */
    accountLabel: text("account_label"),
    linkedByUserId: text("linked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.externalId] }),
    // A workspace's settings list its installations.
    index("integration_installation_organization_id_idx").on(t.organizationId),
  ],
);

/**
 * An owner's or admin's intent to install an integration's app on a
 * workspace: made when the Mac asks where to install it, carried to the
 * provider and back as the install address's opaque `state`, and spent the
 * one time the provider returns the browser. Only the state's SHA-256 is
 * stored, so the table holds nothing a browser could replay. An intent past
 * its expiry, or already spent, links nothing; it leaves with its account
 * or its workspace.
 */
export const integrationInstallIntent = pgTable("integration_install_intent", {
  /** The hex SHA-256 of the state the install address carried. */
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
