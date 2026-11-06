/**
 * sandbox-firewall-store.ts -- the swaps a runner's launch holds at its sandbox session's firewall: kept as it launches, read under its account, renewed only while it stands, let go at its end or cleared ahead of a stop, and dropped once its session is long gone.
 *
 * Every write to a session's firewall composes the whole policy, and the one
 * source a writer cannot gather again is the launch's, whose placeholders are
 * in its runner's environment alone (`@repo/service`'s
 * `agents/sandbox-firewall.ts`). So the launch keeps them here, one row per
 * sandbox session and the account whose agent the session is, beside the
 * agent it runs, replacing an earlier launch's; nothing but the launch keeps
 * a row. `version` is minted as the launch is kept, and the sweep's renewal
 * of a swap's value lands only where the row still holds that launch, so a
 * renewal never sets an ended launch's swaps over a new one's or back after
 * its end. A row is the account's own, keyed by the account and the session,
 * so a read, a keep, a renewal, and a let-go reach that account's row alone;
 * a clear, made by the service ahead of a stop, and the sweep's drop read
 * nothing and are the deployment's, as are the sweep's count and list of the
 * sessions whose row stands, which name each row's account and session and
 * nothing it holds. The row holds the swaps only as the service sealed them
 * (`provider-key-seal.ts`'s `sealFirewallEntries`).
 */

import { and, count, eq, lt } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxFirewall } from "../schemas/sandbox-firewall.js";
import type { FirewallOwner } from "./provider-key-seal.js";

type FirewallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** What a session's row holds: the launch's id, minted as it was kept; the agent it runs, none in a row kept before agents were named; and its swaps as the service sealed them. */
export interface FirewallLaunchRow {
  readonly version: string;
  readonly agentId: string | null;
  readonly sealedEntries: string;
}

const OwnerFields = { userId: Schema.String, sandboxSessionId: Schema.String };

const LaunchSchema = Schema.Struct({
  version: Schema.String,
  agentId: Schema.NullOr(Schema.String),
  sealedEntries: Schema.String,
});

const VersionSchema = Schema.Struct({ version: Schema.String });

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
          version: sandboxFirewall.version,
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

const updateLaunch = SqlSchema.findAll({
  Request: Schema.Struct({
    ...OwnerFields,
    version: Schema.String,
    sealedEntries: Schema.String,
    updatedAt: Schema.Date,
  }),
  Result: VersionSchema,
  execute: ({ userId, sandboxSessionId, version, sealedEntries, updatedAt }) =>
    Database.use((db) =>
      db
        .update(sandboxFirewall)
        .set({ sealedEntries, updatedAt })
        .where(and(ownRow(userId, sandboxSessionId), eq(sandboxFirewall.version, version)))
        .returning({ version: sandboxFirewall.version }),
    ),
});

const deleteLaunch = SqlSchema.void({
  Request: Schema.Struct(OwnerFields),
  execute: ({ userId, sandboxSessionId }) =>
    Database.use((db) => db.delete(sandboxFirewall).where(ownRow(userId, sandboxSessionId))),
});

const deleteSession = SqlSchema.void({
  Request: Schema.Struct({ sandboxSessionId: Schema.String }),
  execute: ({ sandboxSessionId }) =>
    Database.use((db) =>
      db.delete(sandboxFirewall).where(eq(sandboxFirewall.sandboxSessionId, sandboxSessionId)),
    ),
});

const countSessions = SqlSchema.findAll({
  Request: Schema.Struct({}),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: () => Database.use((db) => db.select({ count: count() }).from(sandboxFirewall)),
});

const listSessions = SqlSchema.findAll({
  Request: Schema.Struct({ offset: Schema.Number, limit: Schema.Number }),
  Result: Schema.Struct(OwnerFields),
  execute: ({ offset, limit }) =>
    Database.use((db) =>
      db
        .select({
          userId: sandboxFirewall.userId,
          sandboxSessionId: sandboxFirewall.sandboxSessionId,
        })
        .from(sandboxFirewall)
        .orderBy(sandboxFirewall.sandboxSessionId, sandboxFirewall.userId)
        .offset(offset)
        .limit(limit),
    ),
});

const deleteStale = SqlSchema.findAll({
  Request: Schema.Struct({ updatedBefore: Schema.Date }),
  Result: Schema.Struct({ sandboxSessionId: Schema.String }),
  execute: ({ updatedBefore }) =>
    Database.use((db) =>
      db
        .delete(sandboxFirewall)
        .where(lt(sandboxFirewall.updatedAt, updatedBefore))
        .returning({ sandboxSessionId: sandboxFirewall.sandboxSessionId }),
    ),
});

/** The launch kept for the account's session; none where none is, or it is another account's. */
export function readFirewallLaunch(
  owner: FirewallOwner,
): FirewallEffect<FirewallLaunchRow | undefined> {
  return Effect.map(findLaunch(owner), ([row]) => row);
}

/** The launch given kept for the account's session, in place of any launch kept there before. */
export function keepFirewallLaunch(
  owner: FirewallOwner,
  launch: { readonly version: string; readonly agentId: string; readonly sealedEntries: string },
  updatedAt: Date,
): FirewallEffect<void> {
  return upsertLaunch({ ...owner, ...launch, updatedAt });
}

/**
 * The swaps of the launch kept for the account's session sealed anew, only
 * where the row still holds the launch `version` names, answering whether it
 * landed; a launch let go or replaced since is left as it stands.
 */
export function renewFirewallLaunch(
  owner: FirewallOwner,
  version: string,
  sealedEntries: string,
  updatedAt: Date,
): FirewallEffect<boolean> {
  return Effect.map(
    updateLaunch({ ...owner, version, sealedEntries, updatedAt }),
    (rows) => rows.length > 0,
  );
}

/** The launch kept for the account's session let go, as its runner ends. */
export function letGoFirewallLaunch(owner: FirewallOwner): FirewallEffect<void> {
  return deleteLaunch(owner);
}

/** The session's rows deleted, whoever's they are, as the session's firewall is cleared ahead of a stop. */
export function clearStandingFirewall(sandboxSessionId: string): FirewallEffect<void> {
  return deleteSession({ sandboxSessionId });
}

/** How many sessions' rows stand, whoever's they are: the sweep's to size its window by. */
export function countStandingFirewalls(): FirewallEffect<number> {
  return Effect.map(countSessions({}), ([row]) => row?.count ?? 0);
}

/**
 * The sessions whose row stands, whoever's they are, in the order of their
 * ids, from `offset` on and at most `limit` of them, each by its account and
 * session alone: the sweep's to renew what lapses in them.
 */
export function listStandingFirewalls(
  offset: number,
  limit: number,
): FirewallEffect<readonly FirewallOwner[]> {
  return listSessions({ offset, limit });
}

/** Every row last written before the instant given deleted, answering how many went: sessions that ended long since. */
export function dropStaleFirewalls(updatedBefore: Date): FirewallEffect<number> {
  return Effect.map(deleteStale({ updatedBefore }), (rows) => rows.length);
}
