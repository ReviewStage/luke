/**
 * sandbox-firewall-store.ts -- the record of what stands at a sandbox session's firewall: read under its account, changed by compare-and-set on its version, cleared ahead of a stop, and dropped once its session is long gone.
 *
 * The service composes a session's whole policy from this row, so a write by
 * one part of the session never drops what another set
 * (`@repo/service`'s `agents/sandbox-firewall.ts`). A write is a
 * compare-and-set on the version the writer read: it lands only where the
 * row still stands at that version, or, for a session with no row, where
 * none was written meanwhile, and answers whether it landed, so two writers
 * at once never lose either's change. A write that leaves nothing standing
 * deletes the row, so a withdrawn entry's sealed value is gone with it. A
 * row is the account's own, keyed by the account whose agent the session
 * is and the session, so a read and a write reach that account's row
 * alone; a clear, made by the service ahead of a stop, and the sweep's drop
 * read nothing and are the deployment's. The row holds the entries only as the
 * service sealed them (`provider-key-seal.ts`'s `sealFirewallEntries`).
 */

import { and, eq, lt } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxFirewall } from "../schemas/sandbox-firewall.js";
import type { FirewallOwner } from "./provider-key-seal.js";

type FirewallEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** What a session's row holds: the version its last write minted, and the entries as the service sealed them. */
export interface StandingFirewall {
  readonly version: string;
  readonly sealedEntries: string;
}

const OwnerFields = { userId: Schema.String, sandboxSessionId: Schema.String };

const StandingSchema = Schema.Struct({ version: Schema.String, sealedEntries: Schema.String });

const VersionSchema = Schema.Struct({ version: Schema.String });

/** The row of the account's session given, where one stands. */
const ownRow = (userId: string, sandboxSessionId: string) =>
  and(eq(sandboxFirewall.sandboxSessionId, sandboxSessionId), eq(sandboxFirewall.userId, userId));

const findStanding = SqlSchema.findAll({
  Request: Schema.Struct(OwnerFields),
  Result: StandingSchema,
  execute: ({ userId, sandboxSessionId }) =>
    Database.use((db) =>
      db
        .select({ version: sandboxFirewall.version, sealedEntries: sandboxFirewall.sealedEntries })
        .from(sandboxFirewall)
        .where(ownRow(userId, sandboxSessionId)),
    ),
});

const insertStanding = SqlSchema.findAll({
  Request: Schema.Struct({
    ...OwnerFields,
    version: Schema.String,
    sealedEntries: Schema.String,
    updatedAt: Schema.Date,
  }),
  Result: VersionSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(sandboxFirewall)
        .values(row)
        .onConflictDoNothing({ target: [sandboxFirewall.userId, sandboxFirewall.sandboxSessionId] })
        .returning({ version: sandboxFirewall.version }),
    ),
});

const updateStanding = SqlSchema.findAll({
  Request: Schema.Struct({
    ...OwnerFields,
    expected: Schema.String,
    version: Schema.String,
    sealedEntries: Schema.String,
    updatedAt: Schema.Date,
  }),
  Result: VersionSchema,
  execute: ({ userId, sandboxSessionId, expected, version, sealedEntries, updatedAt }) =>
    Database.use((db) =>
      db
        .update(sandboxFirewall)
        .set({ version, sealedEntries, updatedAt })
        .where(and(ownRow(userId, sandboxSessionId), eq(sandboxFirewall.version, expected)))
        .returning({ version: sandboxFirewall.version }),
    ),
});

const deleteStanding = SqlSchema.findAll({
  Request: Schema.Struct({ ...OwnerFields, expected: Schema.String }),
  Result: VersionSchema,
  execute: ({ userId, sandboxSessionId, expected }) =>
    Database.use((db) =>
      db
        .delete(sandboxFirewall)
        .where(and(ownRow(userId, sandboxSessionId), eq(sandboxFirewall.version, expected)))
        .returning({ version: sandboxFirewall.version }),
    ),
});

const deleteSession = SqlSchema.void({
  Request: Schema.Struct({ sandboxSessionId: Schema.String }),
  execute: ({ sandboxSessionId }) =>
    Database.use((db) =>
      db.delete(sandboxFirewall).where(eq(sandboxFirewall.sandboxSessionId, sandboxSessionId)),
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

/** What stands at the account's session's firewall as its row holds it; none where no row stands, or it is another account's. */
export function readStandingFirewall(
  owner: FirewallOwner,
): FirewallEffect<StandingFirewall | undefined> {
  return Effect.map(findStanding(owner), ([row]) => row);
}

/**
 * The account's session's row moved from the version read to what stands
 * next, answering whether it landed: a row written where none stood, one
 * replaced where it still stands at `expected`, or deleted where nothing
 * stands next. Another account's row under the session is never read or
 * replaced.
 */
export function replaceStandingFirewall(
  owner: FirewallOwner,
  expected: string | undefined,
  next: StandingFirewall | undefined,
  updatedAt: Date,
): FirewallEffect<boolean> {
  const wrote = (rows: readonly unknown[]) => rows.length > 0;
  if (expected === undefined) {
    // Note that nothing read and nothing next lands only while still nothing stands.
    if (next === undefined) {
      return Effect.map(readStandingFirewall(owner), (row) => row === undefined);
    }
    return Effect.map(insertStanding({ ...owner, ...next, updatedAt }), wrote);
  }
  const landed =
    next === undefined
      ? deleteStanding({ ...owner, expected })
      : updateStanding({ ...owner, expected, ...next, updatedAt });
  return Effect.map(landed, wrote);
}

/** The session's rows deleted, whoever's they are, as the session's firewall is cleared ahead of a stop. */
export function clearStandingFirewall(sandboxSessionId: string): FirewallEffect<void> {
  return deleteSession({ sandboxSessionId });
}

/** Every row last written before the instant given deleted, answering how many went: sessions that ended long since. */
export function dropStaleFirewalls(updatedBefore: Date): FirewallEffect<number> {
  return Effect.map(deleteStale({ updatedBefore }), (rows) => rows.length);
}
