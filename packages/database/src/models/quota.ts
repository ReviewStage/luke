import { sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { hostedUsage } from "../schemas/usage.js";

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type QuotaEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.die(new Error(absent)), onSome: Effect.succeed });
}

const HostedUsageWriteSchema = Schema.Struct({ userId: Schema.String, day: Schema.String });
const HostedUsageCallsRowSchema = Schema.Struct({ calls: Schema.Number });

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
