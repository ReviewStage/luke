import { sql } from "drizzle-orm";
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
export const HOSTED_DAILY_LIMIT: Record<HostedMeter, number> = {
  [HOSTED_METER.VOICE_CALL]: 50,
  [HOSTED_METER.ATTENTION_REVIEW]: 500,
};

export interface HostedQuota {
  used: number;
  limit: number;
  remaining: number;
  /** When the day's counters reset, as epoch milliseconds. */
  resetsAt: number;
}

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
  const limit = HOSTED_DAILY_LIMIT[input.meter];
  return {
    allowed: used <= limit,
    quota: {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: utcDayEnd(day),
    },
  };
}
