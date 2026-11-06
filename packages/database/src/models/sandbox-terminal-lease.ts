import { and, eq, gt, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";

type LeaseEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const upsertLease = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, heldUntil: Schema.Date }),
  execute: ({ conversationId, heldUntil }) =>
    Database.use((db) =>
      db
        .insert(sandboxTerminalLease)
        .values({ conversationId, heldUntil })
        .onConflictDoUpdate({
          target: sandboxTerminalLease.conversationId,
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

const claimCredential = SqlSchema.findAll({
  Request: Schema.Struct({
    conversationId: Schema.String,
    sandboxSessionId: Schema.String,
    now: Schema.Date,
    renewedBefore: Schema.Date,
  }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ conversationId, sandboxSessionId, now, renewedBefore }) =>
    Database.use((db) =>
      db
        .update(sandboxTerminalLease)
        .set({ credentialAt: now, credentialSession: sandboxSessionId })
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            sql`(${sandboxTerminalLease.credentialAt} is null or ${sandboxTerminalLease.credentialAt} < ${renewedBefore} or ${sandboxTerminalLease.credentialSession} is distinct from ${sandboxSessionId})`,
          ),
        )
        .returning({ conversationId: sandboxTerminalLease.conversationId }),
    ),
});

export function holdSandbox(conversationId: string, heldUntil: Date): LeaseEffect<void> {
  return upsertLease({ conversationId, heldUntil });
}

export function sandboxHeld(conversationId: string, now: Date): LeaseEffect<boolean> {
  return Effect.map(findHeld({ conversationId, now }), (rows) => rows.length > 0);
}

const unclaimCredential = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    sandboxSessionId: Schema.String,
    claimedAt: Schema.Date,
  }),
  execute: ({ conversationId, sandboxSessionId, claimedAt }) =>
    Database.use((db) =>
      db
        .update(sandboxTerminalLease)
        .set({ credentialAt: null })
        .where(
          and(
            eq(sandboxTerminalLease.conversationId, conversationId),
            eq(sandboxTerminalLease.credentialAt, claimedAt),
            eq(sandboxTerminalLease.credentialSession, sandboxSessionId),
          ),
        ),
    ),
});

export function claimCredentialRenewal(
  conversationId: string,
  sandboxSessionId: string,
  now: Date,
  renewedBefore: Date,
): LeaseEffect<boolean> {
  return Effect.map(
    claimCredential({ conversationId, sandboxSessionId, now, renewedBefore }),
    (rows) => rows.length > 0,
  );
}

export function releaseCredentialRenewal(
  conversationId: string,
  sandboxSessionId: string,
  claimedAt: Date,
): LeaseEffect<void> {
  return unclaimCredential({ conversationId, sandboxSessionId, claimedAt });
}
