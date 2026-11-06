import { asc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sessionSandboxCleanup } from "../schemas/session-sandbox.js";

type CleanupEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

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

export function sessionsOf(
  rows: readonly { readonly runtimeSessionId: string | null }[],
): readonly string[] {
  return [...new Set(rows.flatMap(({ runtimeSessionId }) => runtimeSessionId ?? []))];
}

export function queueSessionSandboxes(sessionIds: readonly string[]): CleanupEffect<void> {
  return sessionIds.length === 0 ? Effect.void : insertSessions(sessionIds);
}

export function nextSessionSandboxes(limit: number): CleanupEffect<readonly string[]> {
  return Effect.map(findNext(limit), (rows) => rows.map((row) => row.sessionId));
}

export function sessionSandboxDeleted(sessionId: string): CleanupEffect<void> {
  return removeSession(sessionId);
}

export function sessionSandboxDeferred(sessionId: string, now: Date): CleanupEffect<void> {
  return stampTried({ sessionId, now });
}
