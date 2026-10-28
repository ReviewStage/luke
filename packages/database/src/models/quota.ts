import { sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { hostedUsage, } from "../schemas/usage.js";

/** The UTC day a moment falls on, as the usage table's YYYY-MM-DD key. */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** What a meter seam answers: an effect over the ambient client, composed into the request that spent it. */
export type QuotaEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * A row a statement had to answer. Its absence is this module's own
 * invariant broken — an upsert that returned nothing — which is a defect
 * rather than an outcome a caller could act on.
 */
function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.die(new Error(absent)), onSome: Effect.succeed });
}

const HostedUsageWriteSchema = Schema.Struct({ userId: Schema.String, day: Schema.String });
const HostedUsageCallsRowSchema = Schema.Struct({ calls: Schema.Number });

/**
 * The day's count as the conflicting row already has it, counted up. This is
 * the one conflicting update that cannot set what the insert carried: the new
 * value is a function of the standing row rather than of the values offered,
 * so the column is named through the builder's own reference to it and the
 * increment is a fragment inside the one rendered statement.
 */
const ONE_MORE_CALL = sql`${hostedUsage.calls} + 1`;

const spendHostedUsage = SqlSchema.findOneOption({
  Request: HostedUsageWriteSchema,
  Result: HostedUsageCallsRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(hostedUsage)
        .values({ userId: write.userId, day: write.day, calls: 1 })
        .onConflictDoUpdate({
          target: [hostedUsage.userId, hostedUsage.day],
          set: { calls: ONE_MORE_CALL },
        })
        .returning({ calls: hostedUsage.calls }),
    ),
});

/**
 * Counts one hosted use against the account's UTC day and answers the day's
 * count so far. The increment is a single atomic upsert taken before the
 * upstream call, so the counter records what was asked whether or not the
 * call then succeeded. Nothing is refused on the count: the admin pages read
 * it, and the OpenAI project's own spend limit is the backstop.
 */
export function spendHostedMeter(input: {
  readonly userId: string;
  readonly now: number;
}): Effect.Effect<number, StoreFailure, DatabaseServices> {
  const day = utcDayKey(input.now);
  return spendHostedUsage({ userId: input.userId, day }).pipe(
    Effect.flatMap((row) => required(row, "The usage upsert returned no row.")),
    Effect.map((row) => row.calls),
  );
}

const DictationUsageWriteSchema = Schema.Struct({
  userId: Schema.String,
  day: Schema.String,
  seconds: Schema.Number,
});

/**
 * One dictated clip on the account's day: one more call, and its seconds
 * added to the day's dictated seconds. Both are functions of the standing
 * row, so the conflicting update names each column through the builder's
 * own reference, as `ONE_MORE_CALL` does.
 */
const spendDictationUsage = SqlSchema.void({
  Request: DictationUsageWriteSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(hostedUsage)
        .values({ userId: write.userId, day: write.day, calls: 1, dictationSeconds: write.seconds })
        .onConflictDoUpdate({
          target: [hostedUsage.userId, hostedUsage.day],
          set: {
            calls: ONE_MORE_CALL,
            dictationSeconds: sql`${hostedUsage.dictationSeconds} + ${write.seconds}`,
          },
        }),
    ),
});

/**
 * Counts one transcribed clip against the account's UTC day: a call, as
 * every hosted operation is, and its seconds of audio beside it. It is taken
 * once the transcription answered, since the seconds are what the model
 * billed, and nothing is refused on it, as nothing is on the calls.
 */
export function spendDictationMeter(input: {
  readonly userId: string;
  readonly seconds: number;
  readonly now: number;
}): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return spendDictationUsage({
    userId: input.userId,
    day: utcDayKey(input.now),
    seconds: input.seconds,
  });
}

