/**
 * sandbox-terminal-lease.ts -- the lease a developer's typing holds on a coding agent's sandbox, and the renewal claim of the GitHub token at its firewall.
 *
 * The terminal relay moves a conversation's lease on as the developer types,
 * never back, so two relays writing at once leave the later instant. The
 * coding agent's turn-end stop asks whether the lease still holds, and
 * leaves a held sandbox running for Vercel's own timeout to stop. Nothing
 * here reads a word of the account: a lease is a conversation and its
 * instants.
 */

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
            // Never renewed, renewed before the bound, or renewed on another session's firewall than this one.
            sql`(${sandboxTerminalLease.credentialAt} is null or ${sandboxTerminalLease.credentialAt} < ${renewedBefore} or ${sandboxTerminalLease.credentialSession} is distinct from ${sandboxSessionId})`,
          ),
        )
        .returning({ conversationId: sandboxTerminalLease.conversationId }),
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

/**
 * Claims the renewal of the GitHub token at the running sandbox session's
 * firewall, answering whether this caller is to renew it now: once per lease
 * when it was never renewed, last renewed before the instant given, or last
 * renewed on another session, which a resumed sandbox is, so two windows on
 * one session mint one token between them and a resumed one is never left
 * without.
 */
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

/** Gives back a renewal this caller claimed on the session and at the instant given and could not finish, so the next check claims it again; a later claim, or another session's at the same instant, stands. */
export function releaseCredentialRenewal(
  conversationId: string,
  sandboxSessionId: string,
  claimedAt: Date,
): LeaseEffect<void> {
  return unclaimCredential({ conversationId, sandboxSessionId, claimedAt });
}
