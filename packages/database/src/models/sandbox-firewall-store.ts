/**
 * sandbox-firewall-store.ts -- the swaps a runner's launch holds at its sandbox session's firewall: kept as it launches, read under its account, and deleted by its agent's next launch elsewhere.
 *
 * Every write to a session's firewall composes the whole policy, and the one
 * source a writer cannot gather again is the launch's, whose placeholders are
 * in its runner's environment alone (`@repo/service`'s
 * `agents/sandbox-firewall.ts`). So the launch keeps them here, one row per
 * sandbox session and the account whose agent the session is, beside the
 * agent it runs, replacing an earlier launch's; nothing but the launch keeps
 * a row. A row is the account's own, keyed by the account and the session,
 * so a read and a keep reach that account's row alone. The row holds the
 * swaps only as the service sealed them (`provider-key-seal.ts`'s
 * `sealFirewallEntries`).
 *
 * Note that nothing deletes a row on a timer, because nothing reads one
 * past its session: a read names its session, and a sandbox session that
 * stopped never runs again. A launch deletes the rows its agent's launches
 * kept for the account's other sessions, since an agent runs in one
 * session at a time, so what stands past its session is at most one row an
 * agent, until its next launch or its agent's deletion.
 */

import { and, eq, ne } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxFirewall } from "../schemas/sandbox-firewall.js";
import type { FirewallOwner } from "./provider-key-seal.js";

type FirewallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** What a session's row holds: the agent the launch runs and its swaps as the service sealed them. */
export interface FirewallLaunchRow {
  readonly agentId: string;
  readonly sealedEntries: string;
}

const OwnerFields = { userId: Schema.String, sandboxSessionId: Schema.String };

const LaunchSchema = Schema.Struct({
  agentId: Schema.String,
  sealedEntries: Schema.String,
});

/** The row of the account's session given, where one stands. */
const ownRow = (userId: string, sandboxSessionId: string) =>
  and(eq(sandboxFirewall.sandboxSessionId, sandboxSessionId), eq(sandboxFirewall.userId, userId));

const findLaunch = SqlSchema.findAll({
  Request: Schema.Struct(OwnerFields),
  Result: LaunchSchema,
  execute: ({ userId, sandboxSessionId }) =>
    Database.use((db) =>
      db
        .select({
          agentId: sandboxFirewall.agentId,
          sealedEntries: sandboxFirewall.sealedEntries,
        })
        .from(sandboxFirewall)
        .where(ownRow(userId, sandboxSessionId)),
    ),
});

const upsertLaunch = SqlSchema.void({
  Request: Schema.Struct({
    ...OwnerFields,
    version: Schema.String,
    agentId: Schema.String,
    sealedEntries: Schema.String,
    updatedAt: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(sandboxFirewall)
        .values(row)
        .onConflictDoUpdate({
          target: [sandboxFirewall.userId, sandboxFirewall.sandboxSessionId],
          set: {
            version: row.version,
            agentId: row.agentId,
            sealedEntries: row.sealedEntries,
            updatedAt: row.updatedAt,
          },
        }),
    ),
});

const deleteOtherSessions = SqlSchema.void({
  Request: Schema.Struct({ ...OwnerFields, agentId: Schema.String }),
  execute: ({ userId, sandboxSessionId, agentId }) =>
    Database.use((db) =>
      db
        .delete(sandboxFirewall)
        .where(
          and(
            eq(sandboxFirewall.userId, userId),
            eq(sandboxFirewall.agentId, agentId),
            ne(sandboxFirewall.sandboxSessionId, sandboxSessionId),
          ),
        ),
    ),
});

/** The launch kept for the account's session; none where none is, or it is another account's. */
export function readFirewallLaunch(
  owner: FirewallOwner,
): FirewallEffect<FirewallLaunchRow | undefined> {
  return Effect.map(findLaunch(owner), ([row]) => row);
}

/** The launch given kept for the account's session, in place of any launch kept there before, and the rows its agent's launches kept for the account's other sessions deleted. */
export function keepFirewallLaunch(
  owner: FirewallOwner,
  launch: { readonly version: string; readonly agentId: string; readonly sealedEntries: string },
  updatedAt: Date,
): FirewallEffect<void> {
  return Effect.andThen(
    deleteOtherSessions({ ...owner, agentId: launch.agentId }),
    upsertLaunch({ ...owner, ...launch, updatedAt }),
  );
}
