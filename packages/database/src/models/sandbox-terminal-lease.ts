/**
 * sandbox-terminal-lease.ts -- the lease a developer's typing holds on a coding agent's sandbox, and the reads and claims its two readers take.
 *
 * The terminal relay moves a conversation's lease on as the developer types,
 * never back, so two relays writing at once leave the later instant, and a
 * keystroke clears a sweep's stamp. The coding agent's turn-end stop asks
 * whether the lease still holds, and leaves a held sandbox running. The
 * scheduled sweep reads the leases that lapsed past a grace while no turn of
 * their agent runs, the ones never tried first, and claims each one before
 * it stops anything: the claim stamps the lease on the condition it is still
 * lapsed, no turn of its agent runs, and no sweep stamped it lately, so a
 * keystroke or a turn that landed after the read keeps the sandbox, and two
 * sweeps never stop one sandbox at once. The lease is let go only once the
 * stop is confirmed, and only while it is still lapsed; a stop Vercel did
 * not confirm, or a sweep that ended before it heard, leaves the stamp, and
 * a sweep after the retry bound takes it up again behind the leases not yet
 * tried. A lease whose agent still runs a turn stays for that turn's own end
 * to stop the sandbox, and for the sweep to take up once the turn is over,
 * however it ends. Nothing here reads a word of the account: a lease is a
 * conversation and its instants.
 */

import { TURN_STATUS } from "@sidecar/wire";
import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";
import { conversations, turns } from "../schemas/storage.js";

type LeaseFailure = QueryError | Schema.SchemaError;

type LeaseEffect<A> = Effect.Effect<A, LeaseFailure, DatabaseServices>;

/** A lapsed lease as the sweep reads it: whose it is, the session its sandbox is tagged with, and the instant it lapsed at. */
export interface LapsedSandboxLease {
  readonly conversationId: string;
  /** The eve session the sandbox carries as its tag; null for a conversation that never opened one. */
  readonly sessionId: string | null;
  readonly heldUntil: Date;
}

const LapsedLeaseSchema = Schema.Struct({
  conversationId: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  heldUntil: Schema.Date,
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
          // The later of the two, so a slower writer never moves the lease back; typing clears a failed stop's stamp.
          set: {
            heldUntil: sql`greatest(${sandboxTerminalLease.heldUntil}, excluded.held_until)`,
            triedAt: null,
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

/** No turn of the lease's agent runs: a running turn's own end stops its sandbox. */
const noTurnRuns = sql`not exists (
  select 1 from ${turns}
  where ${turns.conversationId} = ${sandboxTerminalLease.conversationId}
    and ${turns.status} = ${TURN_STATUS.RUNNING}
)`;

/** No sweep stamped the lease since the instant given. */
const untriedSince = (triedBefore: Date) =>
  or(isNull(sandboxTerminalLease.triedAt), lt(sandboxTerminalLease.triedAt, triedBefore));

const findLapsed = SqlSchema.findAll({
  Request: Schema.Struct({
    lapsedBefore: Schema.Date,
    triedBefore: Schema.Date,
    limit: Schema.Int,
  }),
  Result: LapsedLeaseSchema,
  execute: ({ lapsedBefore, triedBefore, limit }) =>
    Database.use((db) =>
      db
        .select({
          conversationId: sandboxTerminalLease.conversationId,
          sessionId: conversations.runtimeSessionId,
          heldUntil: sandboxTerminalLease.heldUntil,
        })
        .from(sandboxTerminalLease)
        .innerJoin(conversations, eq(conversations.id, sandboxTerminalLease.conversationId))
        .where(
          and(
            lt(sandboxTerminalLease.heldUntil, lapsedBefore),
            untriedSince(triedBefore),
            noTurnRuns,
          ),
        )
        .orderBy(
          sql`${sandboxTerminalLease.triedAt} asc nulls first`,
          asc(sandboxTerminalLease.heldUntil),
        )
        .limit(limit),
    ),
});

const stampLapsed = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    lapsedBefore: Schema.Date,
    triedBefore: Schema.Date,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ conversationId, lapsedBefore, triedBefore, now }) =>
    Database.use((db) =>
      db
        .update(sandboxTerminalLease)
        .set({ triedAt: now })
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            lt(sandboxTerminalLease.heldUntil, lapsedBefore),
            untriedSince(triedBefore),
            noTurnRuns,
          ),
        )
        .returning({ conversationId: sandboxTerminalLease.conversationId }),
    ),
});

const deleteLapsed = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, lapsedBefore: Schema.Date }),
  execute: ({ conversationId, lapsedBefore }) =>
    Database.use((db) =>
      db
        .delete(sandboxTerminalLease)
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
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

/** The leases that lapsed before the instant given while no turn of their agent runs and no sweep stamped them since `triedBefore`, never tried first and then longest lapsed, at most `limit`. */
export function lapsedSandboxLeases(
  lapsedBefore: Date,
  triedBefore: Date,
  limit: number,
): LeaseEffect<readonly LapsedSandboxLease[]> {
  return findLapsed({ lapsedBefore, triedBefore, limit });
}

/** Stamps a lapsed lease as the sweep's to stop, answering whether it was still lapsed with no turn running and no sweep's stamp since `triedBefore`; one the developer took up again, or an agent's turn began on, stays as it is, and nothing is to be stopped. */
export function claimLapsedLease(
  conversationId: string,
  lapsedBefore: Date,
  triedBefore: Date,
  now: Date,
): LeaseEffect<boolean> {
  return Effect.map(
    stampLapsed({ conversationId, lapsedBefore, triedBefore, now }),
    (rows) => rows.length > 0,
  );
}

/** Lets go of a lease whose sandbox the sweep stopped, while it is still lapsed; one the developer took up again during the stop stands. */
export function releaseLapsedLease(conversationId: string, lapsedBefore: Date): LeaseEffect<void> {
  return deleteLapsed({ conversationId, lapsedBefore });
}
