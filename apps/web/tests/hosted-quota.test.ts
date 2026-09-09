import assert from "node:assert/strict";
import test from "node:test";
import { hostedUsage, introductionUsage } from "../server/db/usage-schema";
import {
  HOSTED_DAILY_LIMIT,
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
  calls: number;
}

interface RecordedUpsert {
  values?: HostedUsageInsert;
  set?: { calls: unknown };
}

/**
 * A database that answers the one upsert the meter makes, recording what was
 * asked. The chain mirrors drizzle's fluent insert.
 */
function usageDatabase(calls: number) {
  const recorded: RecordedUpsert = {};
  // SAFETY: Test double implements only the insert chain spendHostedMeter exercises.
  const database = {
    insert(table: typeof hostedUsage) {
      assert.equal(table, hostedUsage);
      return {
        values(values: HostedUsageInsert) {
          recorded.values = values;
          return {
            onConflictDoUpdate(update: { set: { calls: unknown } }) {
              recorded.set = update.set;
              return {
                returning: async () => [{ ...values, calls }],
              };
            },
          };
        },
      };
    },
  } as unknown as UsageDatabase;
  return { database, recorded };
}

test("a day key is the UTC date and resets at the following midnight", () => {
  assert.equal(utcDayKey(NOON_UTC), "2026-08-17");
  assert.equal(utcDayEnd("2026-08-17"), Date.parse("2026-08-18T00:00:00.000Z"));
});

test("a hosted spend increments the day's one counter", async () => {
  const { database, recorded } = usageDatabase(1);
  const spend = await spendHostedMeter(database, { userId: "user-1", now: NOON_UTC });

  assert.deepEqual(recorded.values, { userId: "user-1", day: "2026-08-17", calls: 1 });
  assert.deepEqual(Object.keys(recorded.set ?? {}), ["calls"]);
  assert.equal(spend.allowed, true);
  assert.deepEqual(spend.quota, {
    used: 1,
    limit: HOSTED_DAILY_LIMIT,
    resetsAt: utcDayEnd("2026-08-17"),
  });
});

test("every hosted operation spends the same counter", async () => {
  const { database } = usageDatabase(3);
  const spend = await spendHostedMeter(database, { userId: "user-1", now: NOON_UTC });

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
 * count, so a test can walk the endpoint through its cap.
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

test("an introduction spend moves the shared counter", async () => {
  const counts = new Map<string, number>();
  const spend = await spendIntroductionMeter(introductionDatabase(counts), {
    now: NOON_UTC,
  });

  assert.equal(spend.allowed, true);
  assert.deepEqual([...counts.values()], [1]);
});

test("a spent introduction ceiling refuses the next mint", async () => {
  const counts = new Map<string, number>([["global", HOSTED_DAILY_LIMIT]]);
  const spend = await spendIntroductionMeter(introductionDatabase(counts), {
    now: NOON_UTC,
  });

  assert.equal(spend.allowed, false);
  assert.deepEqual([...counts.values()], [HOSTED_DAILY_LIMIT + 1]);
});

test("the emergency ceiling stays high", () => {
  assert.equal(HOSTED_DAILY_LIMIT, 5_000);
});

test("the hosted ceiling allows its last use and refuses the next", async () => {
  const atLimit = await spendHostedMeter(usageDatabase(HOSTED_DAILY_LIMIT).database, {
    userId: "user-1",
    now: NOON_UTC,
  });
  assert.equal(atLimit.allowed, true);

  const overLimit = await spendHostedMeter(usageDatabase(HOSTED_DAILY_LIMIT + 1).database, {
    userId: "user-1",
    now: NOON_UTC,
  });
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.quota.used, HOSTED_DAILY_LIMIT + 1);
});
