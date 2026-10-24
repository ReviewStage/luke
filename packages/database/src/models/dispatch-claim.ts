import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Data, DateTime, Duration, Effect, Option, Schedule, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * dispatch-claim.ts -- one hand-over to a conversation's runtime at a time, claimed on its row rather than held under a lock.
 *
 * The conversation's dispatch claim: one hand-over to its runtime at a time,
 * committed on the conversation's row before the hand-over is made and
 * cleared once what the runtime answered is written, so no transaction, pool
 * connection, or lock is held while the runtime answers. A claim is taken
 * under the conversation's row lock, in the same short transaction that
 * writes what the hand-over hands (a line's row, an ask's mark), so whatever
 * reads that row under the same lock sees the hand-over's line standing
 * before the runtime hears it; and a write that must not cross a hand-over
 * (a rewind's cut) refuses while a claim stands, under that lock, and tries
 * again after.
 *
 * Note that a claim is the claimant's own fresh id and the instant it was
 * taken, and it expires: a holder that died between its claim and its record
 * leaves a claim no one clears, which the next claimant past the expiry
 * takes over. What the dead holder handed over is never handed over again,
 * since neither eve nor a native runner refuses a message it already took:
 * its line stands as written, and its ask stays marked as handed
 * (`asks.ts`). The expiry is twice the longest a hand-over may take, so a
 * live holder always records before it.
 */

/**
 * How long a claim stands, how long a claimant waits for another's to clear,
 * and how often it asks again meanwhile. A send that waits out the wait is
 * refused as busy, with nothing written and the runtime told nothing, which
 * its caller answers as an outage the same key may retry: a busy agent's
 * conversation queues several hand-overs of up to thirty seconds each, and
 * five seconds and a hand-over's thirty are what the client's send deadline
 * outlasts (`HOSTED_DEADLINE.STEER`).
 */
export const DISPATCH_CLAIM = {
  EXPIRY: Duration.minutes(1),
  WAIT: Duration.seconds(5),
  FIRST_RETRY: Duration.millis(50),
  LONGEST_RETRY: Duration.millis(400),
} as const;

/** A wait for a claim as long as this is logged, so a slow send names what it waited on. */
const CLAIM_WAIT_LOGGED = Duration.seconds(1);

/** Another hand-over's claim stands on the conversation, so this one waits or is refused as busy. */
export class DispatchClaimHeld extends Data.TaggedError("DispatchClaimHeld")<
  Record<never, never>
> {}

/** How a claimant asks again for a claim to clear: soon at first, then a little less often, for as long as the bound. */
export function claimRetry(bound: Duration.Duration) {
  return Schedule.exponential(DISPATCH_CLAIM.FIRST_RETRY).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, DISPATCH_CLAIM.LONGEST_RETRY)),
    ),
    Schedule.upTo({ duration: bound }),
  );
}

const ConversationIdSchema = Schema.Struct({ conversationId: Schema.String });

/** The conversation's claim, read under its row lock. */
const lockClaim = SqlSchema.findOneOption({
  Request: ConversationIdSchema,
  Result: Schema.Struct({
    claim: Schema.NullOr(Schema.String),
    claimedAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ claim: conversations.dispatchClaim, claimedAt: conversations.dispatchClaimedAt })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update"),
    ),
});

const writeClaim = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    claim: Schema.String,
    at: Schema.Date,
    line: Schema.NullOr(Schema.String),
  }),
  execute: ({ conversationId, claim, at, line }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ dispatchClaim: claim, dispatchClaimedAt: at, dispatchLine: line })
        .where(eq(conversations.id, conversationId)),
    ),
});

const clearClaim = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, claim: Schema.String }),
  execute: ({ conversationId, claim }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ dispatchClaim: null, dispatchClaimedAt: null, dispatchLine: null })
        .where(and(eq(conversations.id, conversationId), eq(conversations.dispatchClaim, claim))),
    ),
});

/** Whether a claim taken at the instant given still stands at `now`. */
function claimLive(claimedAt: Date, now: Date): boolean {
  return now.getTime() - claimedAt.getTime() < Duration.toMillis(DISPATCH_CLAIM.EXPIRY);
}

/**
 * Whether another hand-over's claim stands on the conversation, read under
 * its row lock, which this takes and the caller's transaction keeps; one
 * past its expiry stands no longer, and is logged as taken over by the
 * conversation's id alone.
 */
export const dispatchClaimStands = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationId: string,
): Effect.fn.Return<boolean, StoreFailure, DatabaseServices> {
  const row = yield* lockClaim({ conversationId });
  if (Option.isNone(row) || row.value.claim === null || row.value.claimedAt === null) return false;
  if (claimLive(row.value.claimedAt, yield* DateTime.nowAsDate)) return true;
  yield* Effect.logWarning("a dispatch claim past its expiry was taken over", {
    conversationId,
    claimedAt: row.value.claimedAt.toISOString(),
  });
  return false;
});

/**
 * Takes the claim for a hand-over about to be made, under the row lock
 * `dispatchClaimStands` took, answering the claimant's id; naming the line's
 * row where it hands one over, which `sentLineStands` does not read as sent
 * while the claim stands, since its hand-over may yet withdraw it.
 */
export const takeDispatchClaim = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationId: string,
  line?: string,
): Effect.fn.Return<string, StoreFailure, DatabaseServices> {
  const claim = randomUUID();
  yield* writeClaim({ conversationId, claim, at: yield* DateTime.nowAsDate, line: line ?? null });
  return claim;
});

/** The instant a claim taken before is past its expiry at `now`. */
export function claimExpiredBefore(now: Date): Date {
  return new Date(now.getTime() - Duration.toMillis(DISPATCH_CLAIM.EXPIRY));
}

/** Clears the claim, where it is still the claimant's: one taken over past its expiry is the new holder's. */
export function releaseDispatchClaim(
  conversationId: string,
  claim: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return clearClaim({ conversationId, claim });
}

/**
 * Runs the attempt again while it fails because another claim stands, a
 * short while apart and no longer than the bound, `DISPATCH_CLAIM.WAIT`
 * unless the caller names another, holding nothing between tries; past the
 * wait it fails as `DispatchClaimHeld`. How long the wait took is logged
 * where it was long, by the conversation's id alone.
 */
export function waitingOutDispatchClaim<A, E, R>(
  conversationId: string,
  attempt: Effect.Effect<A, E | DispatchClaimHeld, R>,
  bound: Duration.Duration = DISPATCH_CLAIM.WAIT,
): Effect.Effect<A, E | DispatchClaimHeld, R> {
  return Effect.gen(function* () {
    const [waited, exit] = yield* Effect.timed(
      Effect.exit(
        Effect.retry(attempt, {
          schedule: claimRetry(bound),
          while: (failure) => failure instanceof DispatchClaimHeld,
        }),
      ),
    );
    if (Duration.isGreaterThanOrEqualTo(waited, CLAIM_WAIT_LOGGED)) {
      yield* Effect.logInfo("a write waited for its conversation's dispatch claim", {
        conversationId,
        waitedMs: Duration.toMillis(waited),
      });
    }
    return yield* exit;
  });
}
