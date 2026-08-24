import assert from "node:assert/strict";
import test from "node:test";
import { hostedUsage, introductionUsage } from "../server/db/usage-schema";
import {
  HOSTED_DAILY_LIMIT,
  HOSTED_METER,
  INTRODUCTION_DAILY_LIMIT,
  INTRODUCTION_GLOBAL_CALLER,
  spendHostedMeter,
  spendIntroductionMeter,
  utcDayEnd,
  utcDayKey,
} from "../server/hosted/quota";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

type UsageDatabase = Parameters<typeof spendHostedMeter>[0];

interface HostedUsageInsert {
  userId: string;
  day: string;
  voiceCalls: number;
  attentionReviews: number;
}

type HostedUsageConflictSet = { voiceCalls: unknown } | { attentionReviews: unknown };

interface RecordedUpsert {
  values?: HostedUsageInsert;
  set?: HostedUsageConflictSet;
}

/**
 * A database that answers the one upsert the meter makes, recording what was
 * asked. The chain mirrors drizzle's fluent insert.
 */
function usageDatabase(row: Pick<HostedUsageInsert, "voiceCalls" | "attentionReviews">) {
  const calls: RecordedUpsert = {};
  // SAFETY: Test double implements only the insert chain spendHostedMeter exercises.
  const database = {
    insert(table: typeof hostedUsage) {
      assert.equal(table, hostedUsage);
      return {
        values(values: HostedUsageInsert) {
          calls.values = values;
          return {
            onConflictDoUpdate(update: { set: HostedUsageConflictSet }) {
              calls.set = update.set;
              return {
                returning: async () => [{ ...values, ...row }],
              };
            },
          };
        },
      };
    },
  } as unknown as UsageDatabase;
  return { database, calls };
}

test("a day key is the UTC date and resets at the following midnight", () => {
  assert.equal(utcDayKey(NOON_UTC), "2026-08-17");
  assert.equal(utcDayEnd("2026-08-17"), Date.parse("2026-08-18T00:00:00.000Z"));
});

test("spending a voice call increments only its own counter", async () => {
  const { database, calls } = usageDatabase({ voiceCalls: 1, attentionReviews: 0 });
  const spend = await spendHostedMeter(database, {
    userId: "user-1",
    meter: HOSTED_METER.VOICE_CALL,
    now: NOON_UTC,
  });

  assert.deepEqual(
    { userId: calls.values?.userId, day: calls.values?.day },
    { userId: "user-1", day: "2026-08-17" },
  );
  assert.equal(calls.values?.voiceCalls, 1);
  assert.equal(calls.values?.attentionReviews, 0);
  assert.deepEqual(Object.keys(calls.set ?? {}), ["voiceCalls"]);
  assert.equal(spend.allowed, true);
  assert.deepEqual(spend.quota, {
    used: 1,
    limit: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL],
    remaining: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL] - 1,
    resetsAt: utcDayEnd("2026-08-17"),
  });
});

test("an attention review spends its own meter, not the voice one", async () => {
  const { database, calls } = usageDatabase({ voiceCalls: 0, attentionReviews: 3 });
  const spend = await spendHostedMeter(database, {
    userId: "user-1",
    meter: HOSTED_METER.ATTENTION_REVIEW,
    now: NOON_UTC,
  });

  assert.equal(calls.values?.voiceCalls, 0);
  assert.equal(calls.values?.attentionReviews, 1);
  assert.deepEqual(Object.keys(calls.set ?? {}), ["attentionReviews"]);
  assert.equal(spend.allowed, true);
  assert.equal(spend.quota.used, 3);
});

type IntroductionDatabase = Parameters<typeof spendIntroductionMeter>[0];

interface IntroductionUsageInsert {
  caller: string;
  day: string;
  mints: number;
}

/**
 * A database that answers the introduction meter's upserts by keeping real
 * per-caller counts, so a test can walk a caller through its cap.
 */
function introductionDatabase(counts: Map<string, number>): IntroductionDatabase {
  // SAFETY: Test double implements only the insert chain spendIntroductionMeter exercises.
  return {
    insert(table: typeof introductionUsage) {
      assert.equal(table, introductionUsage);
      return {
        values(values: IntroductionUsageInsert) {
          return {
            onConflictDoUpdate() {
              const mints = (counts.get(values.caller) ?? 0) + 1;
              counts.set(values.caller, mints);
              return { returning: async () => [{ ...values, mints }] };
            },
          };
        },
      };
    },
  } as unknown as IntroductionDatabase;
}

test("an introduction spend moves the caller's row and the global row together", async () => {
  const counts = new Map<string, number>();
  const spend = await spendIntroductionMeter(introductionDatabase(counts), {
    callerKey: "caller-hash",
    now: NOON_UTC,
  });

  assert.equal(spend.allowed, true);
  assert.equal(counts.get("caller-hash"), 1);
  assert.equal(counts.get(INTRODUCTION_GLOBAL_CALLER), 1);
});

test("a caller past its own cap is refused without spending the shared allowance", async () => {
  const counts = new Map<string, number>([["caller-hash", INTRODUCTION_DAILY_LIMIT.PER_CALLER]]);
  const spend = await spendIntroductionMeter(introductionDatabase(counts), {
    callerKey: "caller-hash",
    now: NOON_UTC,
  });

  assert.equal(spend.allowed, false);
  // The refused attempt still counts against its own row — past the ceiling
  // every answer is the same no — but the global row never moves.
  assert.equal(counts.get("caller-hash"), INTRODUCTION_DAILY_LIMIT.PER_CALLER + 1);
  assert.equal(counts.get(INTRODUCTION_GLOBAL_CALLER), undefined);
});

test("a spent global ceiling refuses a caller who has minted nothing today", async () => {
  const counts = new Map<string, number>([
    [INTRODUCTION_GLOBAL_CALLER, INTRODUCTION_DAILY_LIMIT.GLOBAL],
  ]);
  const spend = await spendIntroductionMeter(introductionDatabase(counts), {
    callerKey: "fresh-caller",
    now: NOON_UTC,
  });

  assert.equal(spend.allowed, false);
  assert.equal(counts.get("fresh-caller"), 1);
});

test("the introduction ceilings stay a handful per caller under a bounded day", () => {
  assert.equal(INTRODUCTION_DAILY_LIMIT.PER_CALLER, 5);
  assert.equal(INTRODUCTION_DAILY_LIMIT.GLOBAL, 500);
});

test("the ceiling itself is allowed and the next use is refused with nothing left", async () => {
  const limit = HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL];

  const atLimit = await spendHostedMeter(
    usageDatabase({ voiceCalls: limit, attentionReviews: 0 }).database,
    { userId: "user-1", meter: HOSTED_METER.VOICE_CALL, now: NOON_UTC },
  );
  assert.equal(atLimit.allowed, true);
  assert.equal(atLimit.quota.remaining, 0);

  const overLimit = await spendHostedMeter(
    usageDatabase({ voiceCalls: limit + 1, attentionReviews: 0 }).database,
    { userId: "user-1", meter: HOSTED_METER.VOICE_CALL, now: NOON_UTC },
  );
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.quota.remaining, 0);
});
