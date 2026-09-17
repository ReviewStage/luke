import { eq, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { DAY_MS, type HostedQuota } from "../core.js";
import { user } from "../db/auth-schema.js";
import { db } from "../db/query.js";
import { hostedUsage, introductionUsage, voiceSessionUsage } from "../db/usage-schema.js";

/**
 * The free tier's daily ceiling, spent by every hosted operation alike — a
 * voice call opened and a brain turn weighed come out of the same allowance.
 * A product knob, not an implementation detail: the OpenAI project budget
 * behind the key is the backstop it exists to keep distant.
 */
export const HOSTED_DAILY_LIMIT = 5_000;
/* The quota shape is the wire contract's, imported rather than restated, so
   the endpoint and the desktop reading it cannot drift. */

export interface HostedSpend {
  allowed: boolean;
  quota: HostedQuota;
}

/** The UTC day a moment falls on, as the usage table's YYYY-MM-DD key. */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The moment a UTC day's counters reset, as epoch milliseconds. */
export function utcDayEnd(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00.000Z`) + DAY_MS;
}

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
type QuotaFailure = SqlError | Schema.SchemaError;

/** What a meter seam answers: an effect over the ambient client, composed into the request that spent it. */
export type QuotaEffect<A> = Effect.Effect<A, QuotaFailure, SqlClient.SqlClient>;

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
    db
      .insert(hostedUsage)
      .values({ userId: write.userId, day: write.day, calls: 1 })
      .onConflictDoUpdate({
        target: [hostedUsage.userId, hostedUsage.day],
        set: { calls: ONE_MORE_CALL },
      })
      .returning({ calls: hostedUsage.calls }),
});

/**
 * Spends one hosted use and answers whether it fit inside the day. The
 * increment is a single atomic upsert taken before the upstream call, so two
 * racing requests cannot both be the last allowed use: whichever lands second
 * is refused. A refused attempt still counts — the counter
 * records what was asked, and past the ceiling every answer is the same no.
 */
export function spendHostedMeter(input: {
  readonly userId: string;
  readonly now: number;
}): Effect.Effect<HostedSpend, QuotaFailure, SqlClient.SqlClient> {
  const day = utcDayKey(input.now);
  return spendHostedUsage({ userId: input.userId, day }).pipe(
    Effect.flatMap((row) => required(row, "The usage upsert returned no row.")),
    Effect.map((row) => ({
      allowed: row.calls <= HOSTED_DAILY_LIMIT,
      quota: { used: row.calls, limit: HOSTED_DAILY_LIMIT, resetsAt: utcDayEnd(day) },
    })),
  );
}

/** The one row every introduction request shares, holding the global count. */
const INTRODUCTION_USAGE_KEY = "global";

/**
 * Whether an introduction mint fit inside the day. Unlike a metered spend it
 * carries no quota: the introduction is not an allowance anyone tracks, and a
 * refusal that reported the shared counter's standing would tell an anonymous
 * caller how busy the endpoint is for no one's benefit.
 */
export interface IntroductionSpend {
  allowed: boolean;
}

const IntroductionUsageWriteSchema = Schema.Struct({ caller: Schema.String, day: Schema.String });
const IntroductionUsageMintsRowSchema = Schema.Struct({ mints: Schema.Number });

/** The shared day's mints as the conflicting row already has it, counted up; the same fragment as the metered spend's. */
const ONE_MORE_MINT = sql`${introductionUsage.mints} + 1`;

const spendIntroductionUsage = SqlSchema.findOneOption({
  Request: IntroductionUsageWriteSchema,
  Result: IntroductionUsageMintsRowSchema,
  execute: (write) =>
    db
      .insert(introductionUsage)
      .values({ caller: write.caller, day: write.day, mints: 1 })
      .onConflictDoUpdate({
        target: [introductionUsage.caller, introductionUsage.day],
        set: { mints: ONE_MORE_MINT },
      })
      .returning({ mints: introductionUsage.mints }),
});

/**
 * Spends one introduction mint and answers whether it fit inside the shared
 * ceiling. Like the metered spend, the increment is a single atomic upsert
 * taken before the upstream call, and a refused attempt still counts.
 */
export function spendIntroductionMeter(input: {
  readonly now: number;
}): Effect.Effect<IntroductionSpend, QuotaFailure, SqlClient.SqlClient> {
  const day = utcDayKey(input.now);
  return spendIntroductionUsage({ caller: INTRODUCTION_USAGE_KEY, day }).pipe(
    Effect.flatMap((row) => required(row, "The introduction usage upsert returned no row.")),
    Effect.map((row) => ({ allowed: row.mints <= HOSTED_DAILY_LIMIT })),
  );
}

/**
 * What recording a session's seconds came to: recorded, repeated for a
 * session already recorded, and unknown user for an account the report names
 * that the database no longer holds.
 */
export const VOICE_SECONDS_OUTCOME = {
  RECORDED: "recorded",
  REPEATED: "repeated",
  UNKNOWN_USER: "unknown-user",
} as const;

export type VoiceSecondsOutcome =
  (typeof VOICE_SECONDS_OUTCOME)[keyof typeof VOICE_SECONDS_OUTCOME];

const findUserId = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) => db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1),
});

const VoiceSessionUsageInsertSchema = Schema.Struct({
  sessionId: Schema.String,
  userId: Schema.String,
  seconds: Schema.Number,
  recordedAt: Schema.Number,
});

const insertVoiceSessionUsage = SqlSchema.findAll({
  Request: VoiceSessionUsageInsertSchema,
  Result: Schema.Struct({ sessionId: Schema.String }),
  execute: (write) =>
    db
      .insert(voiceSessionUsage)
      .values({
        sessionId: write.sessionId,
        userId: write.userId,
        seconds: write.seconds,
        recordedAt: write.recordedAt,
      })
      .onConflictDoNothing({ target: voiceSessionUsage.sessionId })
      .returning({ sessionId: voiceSessionUsage.sessionId }),
});

/**
 * Records the seconds OpenAI billed for one closed GPT Live session, once. The
 * session row is the ledger: its insert is the idempotent step, so a report
 * repeated after a lost answer, or seen by two function connections, records
 * nothing and answers repeated. The lookup and the insert share one
 * transaction, so an account deleted between them cannot leave a session
 * recorded against nobody.
 */
export function recordVoiceSeconds(input: {
  readonly userId: string;
  readonly sessionId: string;
  readonly seconds: number;
  readonly now: number;
}): Effect.Effect<VoiceSecondsOutcome, QuotaFailure, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const account = yield* findUserId(input.userId);
        if (Option.isNone(account)) return VOICE_SECONDS_OUTCOME.UNKNOWN_USER;

        const inserted = yield* insertVoiceSessionUsage({
          sessionId: input.sessionId,
          userId: input.userId,
          seconds: input.seconds,
          recordedAt: input.now,
        });
        if (inserted.length === 0) return VOICE_SECONDS_OUTCOME.REPEATED;

        return VOICE_SECONDS_OUTCOME.RECORDED;
      }),
    ),
  );
}
