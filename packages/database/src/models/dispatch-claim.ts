import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { Data, DateTime, Duration, Effect, Option, Ref, Schedule, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations, dispatchWaiters } from "../schemas/storage.js";
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
 *
 * Note that the claim goes to waiters in the order they queued, as the
 * advisory lock's waiters were served, so sends reach the runtime in the
 * order they arrived: a claimant that finds the claim taken queues
 * (`dispatch_waiters`, numbered by the database), and a claim is taken only
 * while no live waiter queued before the claimant. A waiter is live while
 * it keeps asking, judged by the database's own clock, so one that died
 * holds the queue a couple of seconds at most.
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
  /** How long the write of what a hand-over answered is tried again: what the expiry leaves past a hand-over's thirty seconds, less a margin. */
  RECORD_RETRY: Duration.seconds(25),
  FIRST_RETRY: Duration.millis(50),
  LONGEST_RETRY: Duration.millis(400),
} as const;

/** How long after a waiter last asked for the claim it stops holding the queue: several of its tries at the longest spacing. */
const WAITER_STALE = Duration.seconds(2);

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

/** The instant, by the database's clock, before which a waiter's last ask leaves it holding the queue no longer. */
const waiterStaleBefore = sql`now() - (${Duration.toMillis(WAITER_STALE)} * interval '1 millisecond')`;

/** Queues a waiter for the conversation's claim, answering its place. */
const queueWaiter = SqlSchema.findAll({
  Request: ConversationIdSchema,
  Result: Schema.Struct({ place: Schema.Number }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .insert(dispatchWaiters)
        .values({ conversationId })
        .returning({ place: dispatchWaiters.place }),
    ),
});

const PlaceSchema = Schema.Struct({ place: Schema.Number });

/** The waiter asking again, which keeps it holding its place. */
const refreshWaiter = SqlSchema.void({
  Request: PlaceSchema,
  execute: ({ place }) =>
    Database.use((db) =>
      db
        .update(dispatchWaiters)
        .set({ seenAt: sql`now()` })
        .where(eq(dispatchWaiters.place, place)),
    ),
});

const removeWaiter = SqlSchema.void({
  Request: PlaceSchema,
  execute: ({ place }) =>
    Database.use((db) => db.delete(dispatchWaiters).where(eq(dispatchWaiters.place, place))),
});

/** The conversation's waiters that died, cleared as a claim is taken. */
const removeStaleWaiters = SqlSchema.void({
  Request: ConversationIdSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .delete(dispatchWaiters)
        .where(
          and(
            eq(dispatchWaiters.conversationId, conversationId),
            sql`${dispatchWaiters.seenAt} <= ${waiterStaleBefore}`,
          ),
        ),
    ),
});

/** A live waiter of the conversation that queued before the place given, or any live waiter where none is given. */
const findWaiterAhead = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, place: Schema.NullOr(Schema.Number) }),
  Result: PlaceSchema,
  execute: ({ conversationId, place }) =>
    Database.use((db) =>
      db
        .select({ place: dispatchWaiters.place })
        .from(dispatchWaiters)
        .where(
          and(
            eq(dispatchWaiters.conversationId, conversationId),
            sql`${dispatchWaiters.seenAt} > ${waiterStaleBefore}`,
            place === null ? undefined : lt(dispatchWaiters.place, place),
          ),
        )
        .limit(1),
    ),
});

/** Whether a claim taken at the instant given still stands at `now`. */
function claimLive(claimedAt: Date, now: Date): boolean {
  return now.getTime() - claimedAt.getTime() < Duration.toMillis(DISPATCH_CLAIM.EXPIRY);
}

/** Whether the claim read stands: one past its expiry stands no longer, and is logged as taken over by the conversation's id alone. */
const claimStanding = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationId: string,
  row: Option.Option<{ readonly claim: string | null; readonly claimedAt: Date | null }>,
) {
  if (Option.isNone(row) || row.value.claim === null || row.value.claimedAt === null) return false;
  if (claimLive(row.value.claimedAt, yield* DateTime.nowAsDate)) return true;
  yield* Effect.logWarning("a dispatch claim past its expiry was taken over", {
    conversationId,
    claimedAt: row.value.claimedAt.toISOString(),
  });
  return false;
});

/**
 * Whether the conversation is not this claimant's to claim yet, read under
 * its row lock, which this takes and the caller's transaction keeps: another
 * hand-over's claim stands, or a live waiter queued before the claimant, at
 * the place it holds (`waitingOutDispatchClaim`), or at all where it holds
 * none. A claimant holding a place asks again here, which keeps it live.
 */
export const dispatchClaimStands = /* @__PURE__ */ Effect.fnUntraced(function* (
  conversationId: string,
  place?: number,
): Effect.fn.Return<boolean, StoreFailure, DatabaseServices> {
  const row = yield* lockClaim({ conversationId });
  if (place !== undefined) yield* refreshWaiter({ place });
  if (yield* claimStanding(conversationId, row)) return true;
  const ahead = yield* findWaiterAhead({ conversationId, place: place ?? null });
  return ahead.length > 0;
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
  place?: number,
): Effect.fn.Return<string, StoreFailure, DatabaseServices> {
  const claim = randomUUID();
  yield* writeClaim({ conversationId, claim, at: yield* DateTime.nowAsDate, line: line ?? null });
  if (place !== undefined) yield* removeWaiter({ place });
  yield* removeStaleWaiters({ conversationId });
  return claim;
});

/** The instant a claim taken before is past its expiry at `now`. */
export function claimExpiredBefore(now: Date): Date {
  return new Date(now.getTime() - Duration.toMillis(DISPATCH_CLAIM.EXPIRY));
}

/**
 * The write of what a hand-over answered, tried again a short while apart
 * for as long as the claim stands: given up, the claim would expire with the
 * holder's line or ask read as handed over (`dispatchClaimStands`), though
 * the runtime may have refused it, so a passing store failure must not end
 * it.
 */
export function recordedWithinExpiry<A, E, R>(
  record: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.retry(
    record.pipe(
      Effect.tapError(() => Effect.logWarning("a hand-over's record failed, trying it again")),
    ),
    { schedule: claimRetry(DISPATCH_CLAIM.RECORD_RETRY) },
  );
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
 * wait it fails as `DispatchClaimHeld`. The first refusal queues the
 * claimant, and every later try is handed the place it holds, which the
 * attempt passes to `dispatchClaimStands` and `takeDispatchClaim`; the place
 * is given up however the wait ends. How long the wait took is logged where
 * it was long, by the conversation's id alone.
 */
export function waitingOutDispatchClaim<A, E, R>(
  conversationId: string,
  attempt: (place: number | undefined) => Effect.Effect<A, E | DispatchClaimHeld, R>,
  bound: Duration.Duration = DISPATCH_CLAIM.WAIT,
): Effect.Effect<A, E | DispatchClaimHeld | StoreFailure, R | DatabaseServices> {
  return Effect.gen(function* () {
    const queued = yield* Ref.make<number | undefined>(undefined);
    const once = Effect.flatMap(Ref.get(queued), (place) =>
      attempt(place).pipe(
        Effect.tapError((failure) =>
          failure instanceof DispatchClaimHeld && place === undefined
            ? Effect.flatMap(queueWaiter({ conversationId }), ([waiter]) =>
                waiter === undefined
                  ? Effect.die(new Error("the waiter's insert answered no place"))
                  : Ref.set(queued, waiter.place),
              )
            : Effect.void,
        ),
      ),
    );
    const [waited, exit] = yield* Effect.timed(
      Effect.exit(
        Effect.retry(once, {
          schedule: claimRetry(bound),
          while: (failure) => failure instanceof DispatchClaimHeld,
        }),
      ),
    );
    const place = yield* Ref.get(queued);
    if (place !== undefined) yield* removeWaiter({ place });
    if (Duration.isGreaterThanOrEqualTo(waited, CLAIM_WAIT_LOGGED)) {
      yield* Effect.logInfo("a write waited for its conversation's dispatch claim", {
        conversationId,
        waitedMs: Duration.toMillis(waited),
      });
    }
    return yield* exit;
  });
}
