import type { IntegrationProvider } from "@luke/features/integration-wire";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * integration.ts -- one account's connection to one account at an integration, as Luke holds it.
 *
 * Vercel Connect keeps each provider's grant and refreshes it; this row is
 * Luke's own word on whether its agents may use that grant, because Connect
 * has no way to ask whether a sign-in finished and its SDK caches tokens in
 * process. A row standing `connected` is what lets an agent read a token
 * (`packages/service/src/integrations/integration-connection.ts`); no row is a disconnected provider, so
 * a Disconnect deletes the row before anything is asked of Connect, and no
 * cache anywhere outlives it. `state` is the one-time value a browser sign-in
 * carries back to the callback, unique across every provider so the callback
 * finds the row by it alone; it stands only while a sign-in is under way, and
 * a connected row keeps its status while the account signs in again.
 * `connectVerifier` stands and goes with it.
 *
 * A Luke account may hold more than one account at a provider (two Notion
 * workspaces), each its own row and its own grant: `connectSubject` is the
 * subject every ask of Connect names for it, so two rows are two grants, and
 * `connectionName` is the one name the account goes by everywhere else (eve's
 * connection, a coding agent's switches and mentions, the routes' query).
 * The account first connected at a provider is named after the provider and
 * asks under the Luke account's own user id, as every row did before a second
 * one was possible.
 */
export const integrationConnection = pgTable(
  "integration_connection",
  {
    /** The row's own id, minted when its first sign-in begins. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
    /** The subject Connect holds this account's grant under: the user id for the first account at a provider, a minted id for another. */
    connectSubject: text("connect_subject").notNull(),
    /** `notion`, `notion-2`, …: `@luke/features/integration-wire`'s connection name, minted once and never renamed. */
    connectionName: text("connection_name").notNull(),
    /** The account's name at the provider ("Acme"), or the developer's own for it; null until either is known. */
    label: text("label"),
    /** `integration-store.ts`'s `INTEGRATION_ROW_STATUS`: pending, connected, or expired. */
    status: text("status").notNull(),
    /** The sign-in under way's own value, which only its callback carries back; null when none is. */
    state: text("state"),
    /** When the sign-in under way began; null when none is. */
    stateIssuedAt: timestamptz("state_issued_at"),
    /**
     * The handle Connect answered the sign-in under way with, which asks it
     * how that sign-in ended when the browser never comes back; null when
     * none is. Never logged, and never answered to a window.
     */
    connectVerifier: text("connect_verifier"),
    /** When a sign-in last completed; null until one has. */
    connectedAt: timestamptz("connected_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connection_user_name_idx").on(table.userId, table.connectionName),
    // One grant per subject at each provider: the first account at every provider shares the user id as its subject.
    uniqueIndex("integration_connection_provider_subject_idx").on(
      table.provider,
      table.connectSubject,
    ),
    uniqueIndex("integration_connection_state_idx").on(table.state),
    index("integration_connection_user_provider_idx").on(table.userId, table.provider),
  ],
);
