import { and, eq, sql } from "drizzle-orm";
import type { HostedQuota, HostedUsageAnswer } from "../core.js";
import type { createDatabase } from "../db/index.js";
import { hostedUsage } from "../db/usage-schema.js";

/** The two things the hosted tier spends, each metered on its own ceiling. */
export const HOSTED_METER = {
  VOICE_CALL: "voice-call",
  ATTENTION_REVIEW: "attention-review",
} as const;

export type HostedMeter = (typeof HOSTED_METER)[keyof typeof HOSTED_METER];

/**
 * The free tier's daily ceilings. Product knobs, not implementation details:
 * a voice call is a conversation opened or an announcement spoken, and an
 * attention review is one session update weighed. The OpenAI project budget
 * behind the key is the backstop these ceilings exist to keep distant.
 */
export const HOSTED_DAILY_LIMIT = {
  [HOSTED_METER.VOICE_CALL]: 50,
  [HOSTED_METER.ATTENTION_REVIEW]: 500,
} as const satisfies Record<HostedMeter, number>;

/* The quota shape is the wire contract's, imported rather than restated, so
   the endpoint and the desktop reading it cannot drift. */
export type { HostedQuota } from "../core.js";

export interface HostedSpend {
  allowed: boolean;
  quota: HostedQuota;
}

/** Where one meter stands on one day, worded once for the spend and the read. */
function meterStanding(used: number, meter: HostedMeter, day: string): HostedQuota {
  const limit = HOSTED_DAILY_LIMIT[meter];
  return { used, limit, remaining: Math.max(0, limit - used), resetsAt: utcDayEnd(day) };
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
 * Spends one use of a meter and answers whether it fit inside the day. The
 * increment is a single atomic upsert taken before the upstream call, so two
 * racing requests cannot both be the fiftieth: whichever lands second reads
 * fifty-one and is refused. A refused attempt still counts — the counter
 * records what was asked, and past the ceiling every answer is the same no.
 */
export async function spendHostedMeter(
  database: UsageDatabase,
  input: { userId: string; meter: HostedMeter; now: number },
): Promise<HostedSpend> {
  const day = utcDayKey(input.now);
  const spendsVoice = input.meter === HOSTED_METER.VOICE_CALL;
  const [row] = await database
    .insert(hostedUsage)
    .values({
      userId: input.userId,
      day,
      voiceCalls: spendsVoice ? 1 : 0,
      attentionReviews: spendsVoice ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: [hostedUsage.userId, hostedUsage.day],
      set: spendsVoice
        ? { voiceCalls: sql`${hostedUsage.voiceCalls} + 1` }
        : { attentionReviews: sql`${hostedUsage.attentionReviews} + 1` },
    })
    .returning();
  if (!row) throw new Error("The usage upsert returned no row.");

  const used = spendsVoice ? row.voiceCalls : row.attentionReviews;
  return {
    allowed: used <= HOSTED_DAILY_LIMIT[input.meter],
    quota: meterStanding(used, input.meter, day),
  };
}

type UsageReadDatabase = Pick<ReturnType<typeof createDatabase>, "select">;

/**
 * Reads where today's allowance stands on both meters without spending
 * either. A day with no row yet has spent nothing, which is an answer, not
 * an absence — the panel asks this before the first call of the day.
 */
export async function readHostedUsage(
  database: UsageReadDatabase,
  input: { userId: string; now: number },
): Promise<HostedUsageAnswer> {
  const day = utcDayKey(input.now);
  const [row] = await database
    .select()
    .from(hostedUsage)
    .where(and(eq(hostedUsage.userId, input.userId), eq(hostedUsage.day, day)));
  return {
    voice: meterStanding(row?.voiceCalls ?? 0, HOSTED_METER.VOICE_CALL, day),
    attention: meterStanding(row?.attentionReviews ?? 0, HOSTED_METER.ATTENTION_REVIEW, day),
  };
}
