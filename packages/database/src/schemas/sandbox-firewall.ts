import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * sandbox-firewall.ts -- the swaps a runner's launch holds at one Vercel Sandbox session's firewall, so every write to it sends them beside what its writer gathered.
 *
 * Vercel's network-policy write replaces a session's whole policy, and the
 * policy reads back with every header value redacted, so each write composes
 * the whole policy from its sources; the one source no writer can gather
 * again is a launch's placeholders, which only its runner's environment
 * holds. The service keeps here the swaps the launch running in a session
 * holds: one row per sandbox session and the account whose agent the
 * session is, naming the agent, with the swaps as the service sealed them
 * under the deployment's key ring, bound to that account and session
 * (`../models/sandbox-firewall-store.ts`, `@repo/service`'s
 * `agents/sandbox-firewall.ts`). The row goes as its launch ends or the session is cleared ahead of its stop,
 * and the scheduled sweep drops a row left past the longest a session can
 * run. Every row goes with its account.
 */
export const sandboxFirewall = pgTable(
  "sandbox_firewall",
  {
    /** The Vercel Sandbox session the policy stands on. */
    sandboxSessionId: text("sandbox_session_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Minted as the launch is kept. Nothing reads it now; the code this replaced compared it, so it stays until no deployment runs that code. */
    version: uuid("version").notNull(),
    /** The agent the launch runs, whose repository credential a write made apart from the launch mints; none in a row kept before agents were named here. */
    agentId: text("agent_id"),
    /** The launch's swaps as the service sealed them. */
    sealedEntries: text("sealed_entries").notNull(),
    /** When the row was last written, from the writer's own clock. */
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    // An account's own row for a session; its account leads, so the account's deletion finds its rows by it.
    primaryKey({ columns: [table.userId, table.sandboxSessionId] }),
    // A clear ahead of a stop names the session alone.
    index("sandbox_firewall_session").on(table.sandboxSessionId),
    // The sweep drops the rows of sessions long gone by age.
    index("sandbox_firewall_updated").on(table.updatedAt),
  ],
);
