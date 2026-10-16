import type { IntegrationProvider } from "@luke/features/integration-wire";
import { pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * workspace-integration.ts -- one workspace's connection to one integration, which an owner or admin made for every member.
 *
 * The workspace's counterpart of `integration.ts`'s account row, on the same
 * terms: Vercel Connect keeps the grant, under the workspace's own id as its
 * subject, and this row is Luke's word on whether anyone may use it. Only
 * Linear is connected this way today. A row standing `connected` is what
 * lets a member read issues through it; no row is a disconnected workspace,
 * so a Disconnect deletes the row before anything is asked of Connect.
 * `state` is the one-time value the browser sign-in carries back, unique
 * across every workspace so the callback finds the row by it alone, and
 * `connectVerifier` stands and goes with it. Who connected it is kept for
 * the settings row, and set null when that account goes, since the
 * connection is the workspace's and outlives them. The row leaves with its
 * workspace.
 */
export const workspaceIntegrationConnection = pgTable(
  "workspace_integration_connection",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    /** `integration-store.ts`'s `INTEGRATION_ROW_STATUS`: pending, connected, or expired. */
    status: text("status").notNull(),
    /** The sign-in under way's own value, which only its callback carries back; null when none is. */
    state: text("state"),
    /** When the sign-in under way began; null when none is. */
    stateIssuedAt: timestamptz("state_issued_at"),
    /** Connect's handle on the sign-in under way; null when none is. Never logged, and never answered to a window. */
    connectVerifier: text("connect_verifier"),
    /** The owner or admin who last began a sign-in; null once that account is deleted. */
    connectedByUserId: text("connected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** When a sign-in last completed; null until one has. */
    connectedAt: timestamptz("connected_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.provider] }),
    uniqueIndex("workspace_integration_connection_state_idx").on(table.state),
  ],
);
