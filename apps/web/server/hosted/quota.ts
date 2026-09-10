import { eq, isNull, sql } from "drizzle-orm";
import type { HostedQuota } from "../core.js";
import { user } from "../db/auth-schema.js";
import type { createDatabase } from "../db/index.js";
import { hostedUsage, introductionUsage, voiceSessionUsage } from "../db/usage-schema.js";
import type { HostedStoreDatabase } from "./store/database.js";

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

type UsageDatabase = Pick<ReturnType<typeof createDatabase>, "insert">;

/**
 * Spends one hosted use and answers whether it fit inside the day. The
 * increment is a single atomic upsert taken before the upstream call, so two
 * racing requests cannot both be the last allowed use: whichever lands second
 * is refused. A refused attempt still counts — the counter
 * records what was asked, and past the ceiling every answer is the same no.
 */
export async function spendHostedMeter(
  database: UsageDatabase,
  input: { userId: string; now: number },
): Promise<HostedSpend> {
  const day = utcDayKey(input.now);
  const [row] = await database
    .insert(hostedUsage)
    .values({ userId: input.userId, day, calls: 1 })
    .onConflictDoUpdate({
      target: [hostedUsage.userId, hostedUsage.day],
      set: { calls: sql`${hostedUsage.calls} + 1` },
    })
    .returning();
  if (!row) throw new Error("The usage upsert returned no row.");

  return {
    allowed: row.calls <= HOSTED_DAILY_LIMIT,
    quota: { used: row.calls, limit: HOSTED_DAILY_LIMIT, resetsAt: utcDayEnd(day) },
  };
}

/** The one row every introduction request shares, holding the global count. */
const INTRODUCTION_USAGE_KEY = "global";

/** Increments the shared introduction row for the day and answers the new count. */
async function incrementIntroductionUsage(database: UsageDatabase, day: string): Promise<number> {
  const [row] = await database
    .insert(introductionUsage)
    .values({ caller: INTRODUCTION_USAGE_KEY, day, mints: 1 })
    .onConflictDoUpdate({
      target: [introductionUsage.caller, introductionUsage.day],
      set: { mints: sql`${introductionUsage.mints} + 1` },
    })
    .returning();
  if (!row) throw new Error("The introduction usage upsert returned no row.");
  return row.mints;
}

/**
 * Whether an introduction mint fit inside the day. Unlike a metered spend it
 * carries no quota: the introduction is not an allowance anyone tracks, and a
 * refusal that reported the shared counter's standing would tell an anonymous
 * caller how busy the endpoint is for no one's benefit.
 */
export interface IntroductionSpend {
  allowed: boolean;
}

/**
 * Spends one introduction mint and answers whether it fit inside the shared
 * ceiling. Like the metered spend, the increment is a single atomic upsert
 * taken before the upstream call, and a refused attempt still counts.
 */
export async function spendIntroductionMeter(
  database: UsageDatabase,
  input: { now: number },
): Promise<IntroductionSpend> {
  const day = utcDayKey(input.now);
  const used = await incrementIntroductionUsage(database, day);
  return { allowed: used <= HOSTED_DAILY_LIMIT };
}

/** Whichever driver stands behind the hosted schema, as the store's tables already take it. */
type VoiceUsageDatabase = Pick<HostedStoreDatabase, "transaction" | "select" | "insert">;

/**
 * What recording a session's seconds came to: recorded, repeated for a
 * session whose seconds already stand, and unknown user for an account the
 * report names that the database no longer holds.
 */
export const VOICE_SECONDS_OUTCOME = {
  RECORDED: "recorded",
  REPEATED: "repeated",
  UNKNOWN_USER: "unknown-user",
} as const;

export type VoiceSecondsOutcome =
  (typeof VOICE_SECONDS_OUTCOME)[keyof typeof VOICE_SECONDS_OUTCOME];

/**
 * Writes down which account a GPT Live session was created for, the moment
 * it is created, as a session row with no seconds yet. The row is what a
 * later function connection checks before it re-attaches to the session: only
 * the account that created a session may attach to it. A session id seen
 * twice keeps its first owner.
 */
export async function registerVoiceSession(
  database: VoiceUsageDatabase,
  input: { userId: string; sessionId: string },
): Promise<void> {
  await database
    .insert(voiceSessionUsage)
    .values({ sessionId: input.sessionId, userId: input.userId })
    .onConflictDoNothing({ target: voiceSessionUsage.sessionId });
}

/** The account a session was created for, or nothing for a session this deployment never created. */
export async function voiceSessionOwner(
  database: VoiceUsageDatabase,
  sessionId: string,
): Promise<string | undefined> {
  const [row] = await database
    .select({ userId: voiceSessionUsage.userId })
    .from(voiceSessionUsage)
    .where(eq(voiceSessionUsage.sessionId, sessionId))
    .limit(1);
  return row?.userId;
}

/**
 * Records the seconds OpenAI billed for one closed GPT Live session, once. The
 * session row is the ledger: the seconds land only where none stand yet, on
 * the row creation registered or on one this report creates, and only a
 * report that landed them moves the day's `voice_seconds`, so a report
 * repeated after a lost answer, or seen by two function connections, adds
 * nothing. Both writes share one transaction so a crash between them cannot
 * leave a session recorded and a day uncounted. The day is the report's, not
 * the session's start: the function reports at `session.closed`, and that is
 * the instant it knows.
 */
export async function recordVoiceSeconds(
  database: VoiceUsageDatabase,
  input: { userId: string; sessionId: string; seconds: number; now: number },
): Promise<VoiceSecondsOutcome> {
  return database.transaction(async (transaction) => {
    const [account] = await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (!account) return VOICE_SECONDS_OUTCOME.UNKNOWN_USER;

    const landed = await transaction
      .insert(voiceSessionUsage)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        seconds: input.seconds,
        recordedAt: input.now,
      })
      .onConflictDoUpdate({
        target: voiceSessionUsage.sessionId,
        set: { seconds: input.seconds, recordedAt: input.now },
        setWhere: isNull(voiceSessionUsage.seconds),
      })
      .returning({ sessionId: voiceSessionUsage.sessionId });
    if (landed.length === 0) return VOICE_SECONDS_OUTCOME.REPEATED;

    await transaction
      .insert(hostedUsage)
      .values({ userId: input.userId, day: utcDayKey(input.now), voiceSeconds: input.seconds })
      .onConflictDoUpdate({
        target: [hostedUsage.userId, hostedUsage.day],
        set: { voiceSeconds: sql`${hostedUsage.voiceSeconds} + ${input.seconds}` },
      });
    return VOICE_SECONDS_OUTCOME.RECORDED;
  });
}
