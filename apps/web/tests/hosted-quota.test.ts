import assert from "node:assert/strict";
import test from "node:test";
import { hostedUsage } from "../server/db/usage-schema";
import {
  HOSTED_DAILY_LIMIT,
  HOSTED_METER,
  spendHostedMeter,
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
