import { and, count, eq, lt } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxFirewall } from "../schemas/sandbox-firewall.js";
import type { FirewallOwner } from "./provider-key-seal.js";

type FirewallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export interface FirewallLaunchRow {
  readonly agentId: string | null;
  readonly sealedEntries: string;
}

const OwnerFields = { userId: Schema.String, sandboxSessionId: Schema.String };

const LaunchSchema = Schema.Struct({
  agentId: Schema.NullOr(Schema.String),
  sealedEntries: Schema.String,
});

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

const updateLaunch = SqlSchema.void({
  Request: Schema.Struct({
    ...OwnerFields,
    sealedEntries: Schema.String,
    updatedAt: Schema.Date,
  }),
  execute: ({ userId, sandboxSessionId, sealedEntries, updatedAt }) =>
    Database.use((db) =>
      db
        .update(sandboxFirewall)
        .set({ sealedEntries, updatedAt })
        .where(ownRow(userId, sandboxSessionId)),
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

export function readFirewallLaunch(
  owner: FirewallOwner,
): FirewallEffect<FirewallLaunchRow | undefined> {
  return Effect.map(findLaunch(owner), ([row]) => row);
}

export function keepFirewallLaunch(
  owner: FirewallOwner,
  launch: { readonly version: string; readonly agentId: string; readonly sealedEntries: string },
  updatedAt: Date,
): FirewallEffect<void> {
  return upsertLaunch({ ...owner, ...launch, updatedAt });
}

export function renewFirewallLaunch(
  owner: FirewallOwner,
  sealedEntries: string,
  updatedAt: Date,
): FirewallEffect<void> {
  return updateLaunch({ ...owner, sealedEntries, updatedAt });
}

export function letGoFirewallLaunch(owner: FirewallOwner): FirewallEffect<void> {
  return deleteLaunch(owner);
}

export function clearStandingFirewall(sandboxSessionId: string): FirewallEffect<void> {
  return deleteSession({ sandboxSessionId });
}

export function countStandingFirewalls(): FirewallEffect<number> {
  return Effect.map(countSessions({}), ([row]) => row?.count ?? 0);
}

export function listStandingFirewalls(
  offset: number,
  limit: number,
): FirewallEffect<readonly FirewallOwner[]> {
  return listSessions({ offset, limit });
}

export function dropStaleFirewalls(updatedBefore: Date): FirewallEffect<number> {
  return Effect.map(deleteStale({ updatedBefore }), (rows) => rows.length);
}
