/**
 * session-sandbox-cleanup.ts -- the queue of eve sessions whose Vercel Sandbox the sweep still has to delete.
 *
 * Whatever lets go of a session for good queues it here in the transaction
 * that lets go of it: the purge of a deleted task's conversations, and the
 * deletion of an account. The sweep takes the queue a bounded batch at a
 * time, the sessions never tried first and then the ones tried longest
 * ago, so a few Vercel will not delete cannot hold up the rest; a session
 * whose sandbox went is removed from the queue, and one whose delete was
 * not confirmed is stamped tried and waits its turn again.
 */

import { asc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { sessionSandboxCleanup } from "../schemas/session-sandbox.js";

type CleanupFailure = QueryError | Schema.SchemaError;

type CleanupEffect<A> = Effect.Effect<A, CleanupFailure, DatabaseServices>;

const insertSessions = SqlSchema.void({
  Request: Schema.Array(Schema.String),
  execute: (sessionIds) =>
    Database.use((db) =>
      db
        .insert(sessionSandboxCleanup)
        .values(sessionIds.map((sessionId) => ({ sessionId })))
        .onConflictDoNothing({ target: sessionSandboxCleanup.sessionId }),
    ),
});

const findNext = SqlSchema.findAll({
  Request: Schema.Number,
  Result: Schema.Struct({ sessionId: Schema.String }),
  execute: (limit) =>
    Database.use((db) =>
      db
        .select({ sessionId: sessionSandboxCleanup.sessionId })
        .from(sessionSandboxCleanup)
        .orderBy(
          sql`${sessionSandboxCleanup.triedAt} asc nulls first`,
          asc(sessionSandboxCleanup.queuedAt),
        )
        .limit(limit),
    ),
});

const removeSession = SqlSchema.void({
  Request: Schema.String,
  execute: (sessionId) =>
    Database.use((db) =>
      db.delete(sessionSandboxCleanup).where(eq(sessionSandboxCleanup.sessionId, sessionId)),
    ),
});

const stampTried = SqlSchema.void({
  Request: Schema.Struct({ sessionId: Schema.String, now: Schema.Date }),
  execute: ({ sessionId, now }) =>
    Database.use((db) =>
      db
        .update(sessionSandboxCleanup)
        .set({ triedAt: now })
        .where(eq(sessionSandboxCleanup.sessionId, sessionId)),
    ),
});

/** The sessions rows ran in, each once, leaving out a row that never opened one. */
export function sessionsOf(
  rows: readonly { readonly runtimeSessionId: string | null }[],
): readonly string[] {
  return [...new Set(rows.flatMap(({ runtimeSessionId }) => runtimeSessionId ?? []))];
}

/** Queues each session named for its sandbox's deletion; one already queued stays as it stands. */
export function queueSessionSandboxes(sessionIds: readonly string[]): CleanupEffect<void> {
  return sessionIds.length === 0 ? Effect.void : insertSessions(sessionIds);
}

/** The next sessions a sweep takes, at most `limit`: never tried first, then tried longest ago. */
export function nextSessionSandboxes(limit: number): CleanupEffect<readonly string[]> {
  return Effect.map(findNext(limit), (rows) => rows.map((row) => row.sessionId));
}

/** The session's sandbox is gone, so it leaves the queue. */
export function sessionSandboxDeleted(sessionId: string): CleanupEffect<void> {
  return removeSession(sessionId);
}

/** The session's sandbox could not be deleted now; it waits behind the rest for a later sweep. */
export function sessionSandboxDeferred(sessionId: string, now: Date): CleanupEffect<void> {
  return stampTried({ sessionId, now });
}
