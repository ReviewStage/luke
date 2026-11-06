import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { Data, DateTime, Duration, Effect, Option, Schedule, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations, dispatchWaiters } from "../schemas/storage.js";
import { InstantColumnSchema } from "./columns.js";

export const DISPATCH_CLAIM = {
  EXPIRY: Duration.minutes(1),
  WAIT: Duration.seconds(5),
  RECORD_RETRY: Duration.seconds(25),
  FIRST_RETRY: Duration.millis(50),
  LONGEST_RETRY: Duration.millis(400),
} as const;

const WAITER_STALE = Duration.seconds(2);

const CLAIM_WAIT_LOGGED = Duration.seconds(1);

export class DispatchClaimHeld extends Data.TaggedError("DispatchClaimHeld")<
  Record<never, never>
> {}

export function claimRetry(bound: Duration.Duration) {
  return Schedule.exponential(DISPATCH_CLAIM.FIRST_RETRY).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(Duration.min(duration, DISPATCH_CLAIM.LONGEST_RETRY)),
    ),
    Schedule.upTo({ duration: bound }),
  );
}

const ConversationIdSchema = Schema.Struct({ conversationId: Schema.String });

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

const waiterStaleBefore = sql`now() - (${Duration.toMillis(WAITER_STALE)} * interval '1 millisecond')`;

const queueWaiter = SqlSchema.findAll({
  Request: ConversationIdSchema,
  Result: Schema.Struct({ place: Schema.Number }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .insert(dispatchWaiters)
        .select(
          db
            .select({ conversationId: conversations.id })
            .from(conversations)
            .where(eq(conversations.id, conversationId)),
        )
        .returning({ place: dispatchWaiters.place }),
    ),
});

const NO_PLACE = 0;

const PlaceSchema = Schema.Struct({ place: Schema.Number });

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

const findWaiterAhead = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, place: Schema.Number }),
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
            lt(dispatchWaiters.place, place),
          ),
        )
        .limit(1),
    ),
});

function claimLive(claimedAt: Date, now: Date): boolean {
  return now.getTime() - claimedAt.getTime() < Duration.toMillis(DISPATCH_CLAIM.EXPIRY);
}

const claimStanding = Effect.fnUntraced(function* (
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

export const dispatchClaimStands = Effect.fnUntraced(function* (
  conversationId: string,
  place: number,
): Effect.fn.Return<boolean, StoreFailure, DatabaseServices> {
  const row = yield* lockClaim({ conversationId });
  if (yield* claimStanding(conversationId, row)) return true;
  const ahead = yield* findWaiterAhead({ conversationId, place });
  return ahead.length > 0;
});

export const takeDispatchClaim = Effect.fnUntraced(function* (
  conversationId: string,
  place: number,
  line?: string,
): Effect.fn.Return<string, StoreFailure, DatabaseServices> {
  const claim = randomUUID();
  yield* writeClaim({ conversationId, claim, at: yield* DateTime.nowAsDate, line: line ?? null });
  yield* removeWaiter({ place });
  yield* removeStaleWaiters({ conversationId });
  return claim;
});

export function claimExpiredBefore(now: Date): Date {
  return new Date(now.getTime() - Duration.toMillis(DISPATCH_CLAIM.EXPIRY));
}

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

export function releaseDispatchClaim(
  conversationId: string,
  claim: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return clearClaim({ conversationId, claim });
}

export function waitingOutDispatchClaim<A, E, R>(
  conversationId: string,
  attempt: (place: number) => Effect.Effect<A, E | DispatchClaimHeld, R>,
  bound: Duration.Duration = DISPATCH_CLAIM.WAIT,
): Effect.Effect<A, E | DispatchClaimHeld | StoreFailure, R | DatabaseServices> {
  return Effect.gen(function* () {
    const [waiter] = yield* queueWaiter({ conversationId });
    if (waiter === undefined) return yield* attempt(NO_PLACE);
    const [waited, exit] = yield* Effect.timed(
      Effect.exit(
        Effect.retry(
          Effect.andThen(refreshWaiter({ place: waiter.place }), attempt(waiter.place)),
          {
            schedule: claimRetry(bound),
            while: (failure) => failure instanceof DispatchClaimHeld,
          },
        ),
      ),
    );
    yield* removeWaiter({ place: waiter.place });
    if (Duration.isGreaterThanOrEqualTo(waited, CLAIM_WAIT_LOGGED)) {
      yield* Effect.logInfo("a write waited for its conversation's dispatch claim", {
        conversationId,
        waitedMs: Duration.toMillis(waited),
      });
    }
    return yield* exit;
  });
}
