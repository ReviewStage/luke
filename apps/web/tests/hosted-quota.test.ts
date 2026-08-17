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

/**
 * A database that answers the one upsert the meter makes, recording what was
 * asked. The chain mirrors drizzle's fluent insert; the cast is the same seam
 * the migration tests use for `pg.Client`.
 */
function usageDatabase(row: { voiceCalls: number; attentionReviews: number }) {
  const calls: { values?: Record<string, unknown>; set?: Record<string, unknown> } = {};
  const database = {
    insert(table: unknown) {
      assert.equal(table, hostedUsage);
      return {
        values(values: Record<string, unknown>) {
          calls.values = values;
          return {
            onConflictDoUpdate(update: { set: Record<string, unknown> }) {
              calls.set = update.set;
              return {
                returning: async () => [{ ...values, ...row }],
              };
            },
          };
        },
      };
    },
  };
  return { database: database as Parameters<typeof spendHostedMeter>[0], calls };
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
