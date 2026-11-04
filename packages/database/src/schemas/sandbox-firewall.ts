import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * sandbox-firewall.ts -- what stands at one Vercel Sandbox session's firewall, so every write to it composes the whole policy.
 *
 * Vercel's network-policy write replaces a session's whole policy, and the
 * policy reads back with every header value redacted, so the service keeps
 * here what each part of the session set at its firewall: one row per
 * sandbox session, under the account whose agent the session is, with the
 * standing entries as the service sealed them under the deployment's key
 * ring, bound to that account and session (`../models/sandbox-firewall-store.ts`,
 * `@repo/service`'s `agents/sandbox-firewall.ts`). `version` is minted
 * afresh at every write, which is how a writer knows the row moved on since
 * its own. An entry withdrawn leaves the sealed column at once, the row
 * goes when the last one does or the session is cleared ahead of its stop,
 * and the scheduled sweep drops a row left past the longest a session can
 * run. Every row goes with its account.
 */
export const sandboxFirewall = pgTable(
  "sandbox_firewall",
  {
    /** The Vercel Sandbox session the policy stands on. */
    sandboxSessionId: text("sandbox_session_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Minted at every write, so a writer that reads it back knows whether another wrote since. */
    version: uuid("version").notNull(),
    /** The standing entries as the service sealed them. */
    sealedEntries: text("sealed_entries").notNull(),
    /** When the row was last written, from the writer's own clock. */
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // The sweep drops the rows of sessions long gone by age.
    index("sandbox_firewall_updated").on(table.updatedAt),
  ],
);
