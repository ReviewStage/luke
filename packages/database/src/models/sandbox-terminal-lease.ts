/**
 * sandbox-terminal-lease.ts -- the lease a developer's typing holds on a coding agent's sandbox, and the reads its two readers take.
 *
 * The terminal relay moves a conversation's lease on as the developer types,
 * never back, so two relays writing at once leave the later instant. The
 * coding agent's turn-end stop asks whether the lease still holds, and leaves
 * a held sandbox running; the scheduled sweep takes the leases that lapsed
 * past a grace, a bounded batch at a time, with the session each sandbox is
 * tagged with and whether a turn of the agent is running, stops what no turn
 * still needs, and removes the lease. Nothing here reads a word of the
 * account: a lease is a conversation and an instant.
 */

import { TURN_STATUS } from "@sidecar/wire";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";
import { conversations, turns } from "../schemas/storage.js";

type LeaseFailure = QueryError | Schema.SchemaError;

type LeaseEffect<A> = Effect.Effect<A, LeaseFailure, DatabaseServices>;

/** A lapsed lease as the sweep reads it: whose it is, the session its sandbox is tagged with, and whether a turn still runs there. */
export interface LapsedSandboxLease {
  readonly conversationId: string;
  /** The eve session the sandbox carries as its tag; null for a conversation that never opened one. */
  readonly sessionId: string | null;
  readonly turnRunning: boolean;
}

const LapsedLeaseSchema = Schema.Struct({
  conversationId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  turnRunning: Schema.Boolean,
});

const upsertLease = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, heldUntil: Schema.Date }),
  execute: ({ conversationId, heldUntil }) =>
    Database.use((db) =>
      db
        .insert(sandboxTerminalLease)
        .values({ conversationId, heldUntil })
        .onConflictDoUpdate({
          target: sandboxTerminalLease.conversationId,
          // The later of the two, so a slower writer never moves the lease back.
          set: {
            heldUntil: sql`greatest(${sandboxTerminalLease.heldUntil}, excluded.held_until)`,
          },
        }),
    ),
});

const findHeld = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ conversationId, now }) =>
    Database.use((db) =>
      db
        .select({ conversationId: sandboxTerminalLease.conversationId })
        .from(sandboxTerminalLease)
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            gt(sandboxTerminalLease.heldUntil, now),
          ),
        ),
    ),
});

const findLapsed = SqlSchema.findAll({
  Request: Schema.Struct({ lapsedBefore: Schema.Date, limit: Schema.Int }),
  Result: LapsedLeaseSchema,
  execute: ({ lapsedBefore, limit }) =>
    Database.use((db) =>
      db
        .select({
          conversationId: sandboxTerminalLease.conversationId,
          sessionId: conversations.runtimeSessionId,
          turnRunning: sql<boolean>`exists (
            select 1 from ${turns}
            where ${turns.conversationId} = ${sandboxTerminalLease.conversationId}
              and ${turns.status} = ${TURN_STATUS.RUNNING}
          )`,
        })
        .from(sandboxTerminalLease)
        .innerJoin(conversations, eq(conversations.id, sandboxTerminalLease.conversationId))
        .where(lt(sandboxTerminalLease.heldUntil, lapsedBefore))
        .orderBy(asc(sandboxTerminalLease.heldUntil))
        .limit(limit),
    ),
});

const removeLease = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, lapsedBefore: Schema.Date }),
  execute: ({ conversationId, lapsedBefore }) =>
    Database.use((db) =>
      db.delete(sandboxTerminalLease).where(
        and(
          eq(sandboxTerminalLease.conversationId, conversationId),
          // A lease the developer took up again since it was read stays.
          lt(sandboxTerminalLease.heldUntil, lapsedBefore),
        ),
      ),
    ),
});

/** Holds the conversation's sandbox until the instant given, or later where the lease already reaches further. */
export function holdSandbox(conversationId: string, heldUntil: Date): LeaseEffect<void> {
  return upsertLease({ conversationId, heldUntil });
}

/** Whether a developer's terminal holds the conversation's sandbox at the instant given. */
export function sandboxHeld(conversationId: string, now: Date): LeaseEffect<boolean> {
  return Effect.map(findHeld({ conversationId, now }), (rows) => rows.length > 0);
}

/** The leases that lapsed before the instant given, longest lapsed first, at most `limit`. */
export function lapsedSandboxLeases(
  lapsedBefore: Date,
  limit: number,
): LeaseEffect<readonly LapsedSandboxLease[]> {
  return findLapsed({ lapsedBefore, limit });
}

/** Removes a lease the sweep has dealt with, unless the developer took it up again after the instant it was read as lapsed by. */
export function releaseSandboxLease(conversationId: string, lapsedBefore: Date): LeaseEffect<void> {
  return removeLease({ conversationId, lapsedBefore });
}
