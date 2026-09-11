import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import type { HostedQuota } from "../core.js";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day a moment falls on, as the usage table's YYYY-MM-DD key. */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The moment a UTC day's counters reset, as epoch milliseconds. */
export function utcDayEnd(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00.000Z`) + DAY_MS;
}

/** How a statement here fails: the driver's own refusal, or a row this build cannot decode. */
type QuotaFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E, R = never>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/**
 * A row a statement had to answer. Its absence is this module's own
 * invariant broken — an upsert that returned nothing — which is a defect
 * rather than an outcome a caller could act on.
 */
function required<A>(row: Option.Option<A>, absent: string): Effect.Effect<A> {
  return Option.match(row, { onNone: () => Effect.dieMessage(absent), onSome: Effect.succeed });
}

const HostedUsageWriteSchema = Schema.Struct({ userId: Schema.String, day: Schema.String });
const HostedUsageCallsRowSchema = Schema.Struct({ calls: Schema.Number });

const spendHostedUsage = SqlSchema.findOne({
  Request: HostedUsageWriteSchema,
  Result: HostedUsageCallsRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into hosted_usage (user_id, day, calls)
        values (${write.userId}, ${write.day}, 1)
        on conflict (user_id, day) do update
          set calls = hosted_usage.calls + 1
        returning calls
      `,
    ),
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

const spendIntroductionUsage = SqlSchema.findOne({
  Request: IntroductionUsageWriteSchema,
  Result: IntroductionUsageMintsRowSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into introduction_usage (caller, day, mints)
        values (${write.caller}, ${write.day}, 1)
        on conflict (caller, day) do update
          set mints = introduction_usage.mints + 1
        returning mints
      `,
    ),
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

const findUserId = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) => statement((sql) => sql`select id from "user" where id = ${userId} limit 1`),
});

const VoiceSessionUsageInsertSchema = Schema.Struct({
  sessionId: Schema.String,
  userId: Schema.String,
  seconds: Schema.Number,
  recordedAt: Schema.Number,
});

const insertVoiceSessionUsage = SqlSchema.findAll({
  Request: VoiceSessionUsageInsertSchema,
  Result: Schema.Struct({
    sessionId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("session_id")),
  }),
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into voice_session_usage (session_id, user_id, seconds, recorded_at)
        values (${write.sessionId}, ${write.userId}, ${write.seconds}, ${write.recordedAt})
        on conflict (session_id) do nothing
        returning session_id
      `,
    ),
});

const HostedVoiceSecondsWriteSchema = Schema.Struct({
  userId: Schema.String,
  day: Schema.String,
  seconds: Schema.Number,
});

const addHostedVoiceSeconds = SqlSchema.void({
  Request: HostedVoiceSecondsWriteSchema,
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into hosted_usage (user_id, day, voice_seconds)
        values (${write.userId}, ${write.day}, ${write.seconds})
        on conflict (user_id, day) do update
          set voice_seconds = hosted_usage.voice_seconds + excluded.voice_seconds
      `,
    ),
});

/**
 * Records the seconds OpenAI billed for one closed GPT Live session, once. The
 * session row is the ledger: its insert is the idempotent step, and only a
 * report that created the row moves the day's `voice_seconds`, so a report
 * repeated after a lost answer, or seen by two function connections, adds
 * nothing. Both writes share one transaction so a crash between them cannot
 * leave a session recorded and a day uncounted. The day is the report's, not
 * the session's start: the service reports at `session.closed`, and that is
 * the instant it knows.
 */
export function recordVoiceSeconds(input: {
  readonly userId: string;
  readonly sessionId: string;
  readonly seconds: number;
  readonly now: number;
}): Effect.Effect<VoiceSecondsOutcome, QuotaFailure, SqlClient.SqlClient> {
  return statement((sql) =>
    sql.withTransaction(
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

        yield* addHostedVoiceSeconds({
          userId: input.userId,
          day: utcDayKey(input.now),
          seconds: input.seconds,
        });
        return VOICE_SECONDS_OUTCOME.RECORDED;
      }),
    ),
  );
}
