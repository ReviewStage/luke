import type { IntegrationProvider } from "@luke/features/integration-wire";
import { pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * integration.ts -- one account's connection to one integration, as Luke holds it.
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
 */
export const integrationConnection = pgTable(
  "integration_connection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IntegrationProvider>().notNull(),
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
    primaryKey({ columns: [table.userId, table.provider] }),
    uniqueIndex("integration_connection_state_idx").on(table.state),
  ],
);
