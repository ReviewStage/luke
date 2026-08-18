import assert from "node:assert/strict";
import test from "node:test";
import { hostedUsage } from "../server/db/usage-schema";
import {
  HOSTED_DAILY_LIMIT,
  HOSTED_METER,
  readHostedUsage,
  utcDayEnd,
} from "../server/hosted/quota";
import { handleUsage } from "../server/hosted/usage";

const NOON_UTC = Date.parse("2026-08-17T12:00:00.000Z");

/** A database that answers the one select the read makes. */
function usageDatabase(rows: Array<{ voiceCalls: number; attentionReviews: number }>) {
  return {
    select() {
      return {
        from(table: unknown) {
          assert.equal(table, hostedUsage);
          return { where: async () => rows };
        },
      };
    },
  } as unknown as Parameters<typeof readHostedUsage>[0];
}

test("a day with spending reads back both meters without touching either", async () => {
  const usage = await readHostedUsage(usageDatabase([{ voiceCalls: 3, attentionReviews: 41 }]), {
    userId: "user-1",
    now: NOON_UTC,
  });

  assert.deepEqual(usage.voice, {
    used: 3,
    limit: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL],
    remaining: HOSTED_DAILY_LIMIT[HOSTED_METER.VOICE_CALL] - 3,
    resetsAt: utcDayEnd("2026-08-17"),
  });
  assert.deepEqual(usage.attention, {
    used: 41,
    limit: HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW],
    remaining: HOSTED_DAILY_LIMIT[HOSTED_METER.ATTENTION_REVIEW] - 41,
    resetsAt: utcDayEnd("2026-08-17"),
  });
});

test("a day with no row yet has spent nothing, which is an answer", async () => {
  const usage = await readHostedUsage(usageDatabase([]), { userId: "user-1", now: NOON_UTC });
  assert.equal(usage.voice.used, 0);
  assert.equal(usage.voice.remaining, usage.voice.limit);
  assert.equal(usage.attention.used, 0);
});

test("the endpoint answers GET for the signed-in account and nobody else", async () => {
  const answer = {
    voice: { used: 1, limit: 50, remaining: 49, resetsAt: NOON_UTC + 43_200_000 },
    attention: { used: 2, limit: 500, remaining: 498, resetsAt: NOON_UTC + 43_200_000 },
  };
  const options = {
    resolveUserId: async () => "user-1" as string | undefined,
    readUsage: async () => answer,
  };

  const ok = await handleUsage({
    ...options,
    request: new Request("https://luke.test/api/usage"),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), answer);

  const wrongMethod = await handleUsage({
    ...options,
    request: new Request("https://luke.test/api/usage", { method: "POST" }),
  });
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleUsage({
    ...options,
    resolveUserId: async () => undefined,
    request: new Request("https://luke.test/api/usage"),
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "invalid-token");
});
