import assert from "node:assert/strict";
import test from "node:test";
import {
  VOICE_SERVICE_SECRET_HEADER,
  VOICE_USAGE_RECORD,
  voiceUsageAnswerSchema,
} from "@sidecar/hosted";
import { eq } from "drizzle-orm";
import { hostedUsage, voiceSessionUsage } from "../server/db/usage-schema";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import { recordVoiceSeconds, utcDayKey, VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import { handleVoiceUsage } from "../server/hosted/voice-usage";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const SECRET = "voice-service-secret";
const REPORT = { userId: "user-1", sessionId: "sess_1", seconds: 90.5 };

const NO_BODY = null;

function usageRequest(
  body: string | typeof NO_BODY = JSON.stringify(REPORT),
  headers: Record<string, string> = { [VOICE_SERVICE_SECRET_HEADER]: SECRET },
  method = "POST",
): Request {
  const init: RequestInit = { method, headers };
  if (body !== NO_BODY) init.body = body;
  return new Request("https://luke.test/api/internal/voice/usage", init);
}

function options(overrides: Partial<Parameters<typeof handleVoiceUsage>[0]> = {}) {
  return {
    request: usageRequest(),
    serviceSecret: SECRET,
    record: async () => VOICE_SECONDS_OUTCOME.RECORDED,
    ...overrides,
  };
}

test("a report is recorded under the account and session it names", async () => {
  const recorded: unknown[] = [];
  const response = await handleVoiceUsage(
    options({
      record: async (report) => {
        recorded.push(report);
        return VOICE_SECONDS_OUTCOME.RECORDED;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(voiceUsageAnswerSchema.parse(await response.json()), {
    record: VOICE_USAGE_RECORD.RECORDED,
  });
  assert.deepEqual(recorded, [REPORT]);
});

test("a repeated report is answered as repeated, not as an error", async () => {
  const response = await handleVoiceUsage(
    options({ record: async () => VOICE_SECONDS_OUTCOME.REPEATED }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(voiceUsageAnswerSchema.parse(await response.json()), {
    record: VOICE_USAGE_RECORD.REPEATED,
  });
});

test("a report naming an account the database no longer holds is refused", async () => {
  const response = await handleVoiceUsage(
    options({ record: async () => VOICE_SECONDS_OUTCOME.UNKNOWN_USER }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("a missing or wrong service secret is refused before anything is recorded", async () => {
  let records = 0;
  const record = async () => {
    records += 1;
    return VOICE_SECONDS_OUTCOME.RECORDED;
  };
  const missing = await handleVoiceUsage(
    options({ request: usageRequest(JSON.stringify(REPORT), {}), record }),
  );
  const wrong = await handleVoiceUsage(
    options({
      request: usageRequest(JSON.stringify(REPORT), {
        [VOICE_SERVICE_SECRET_HEADER]: `${SECRET}x`,
      }),
      record,
    }),
  );
  for (const response of [missing, wrong]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const off = await handleVoiceUsage(options({ serviceSecret: undefined, record }));
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const method = await handleVoiceUsage(
    options({
      request: usageRequest(NO_BODY, { [VOICE_SERVICE_SECRET_HEADER]: SECRET }, "GET"),
      record,
    }),
  );
  assert.equal(method.status, 405);
  assert.equal(records, 0);
});

test("a report that is not one session's bounded seconds is refused", async () => {
  for (const body of [
    NO_BODY,
    "not json",
    JSON.stringify({}),
    JSON.stringify({ ...REPORT, seconds: -1 }),
    JSON.stringify({ ...REPORT, seconds: 86_401 }),
    JSON.stringify({ ...REPORT, sessionId: "" }),
    JSON.stringify({ ...REPORT, extra: true }),
  ]) {
    const response = await handleVoiceUsage(options({ request: usageRequest(body) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  }
});

test("recording takes a session's seconds once and moves the day's counter only the first time", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const userId = await opened.createUser();
    const first = await recordVoiceSeconds(opened.db, {
      userId,
      sessionId: "sess_a",
      seconds: 61,
      now: NOW,
    });
    const again = await recordVoiceSeconds(opened.db, {
      userId,
      sessionId: "sess_a",
      seconds: 61,
      now: NOW + 1_000,
    });
    const second = await recordVoiceSeconds(opened.db, {
      userId,
      sessionId: "sess_b",
      seconds: 30.5,
      now: NOW + 2_000,
    });

    assert.equal(first, VOICE_SECONDS_OUTCOME.RECORDED);
    assert.equal(again, VOICE_SECONDS_OUTCOME.REPEATED);
    assert.equal(second, VOICE_SECONDS_OUTCOME.RECORDED);

    const sessions = await opened.db
      .select({
        sessionId: voiceSessionUsage.sessionId,
        seconds: voiceSessionUsage.seconds,
        recordedAt: voiceSessionUsage.recordedAt,
      })
      .from(voiceSessionUsage)
      .where(eq(voiceSessionUsage.userId, userId))
      .orderBy(voiceSessionUsage.sessionId);
    assert.deepEqual(sessions, [
      { sessionId: "sess_a", seconds: 61, recordedAt: NOW },
      { sessionId: "sess_b", seconds: 30.5, recordedAt: NOW + 2_000 },
    ]);

    const [day] = await opened.db
      .select({ calls: hostedUsage.calls, voiceSeconds: hostedUsage.voiceSeconds })
      .from(hostedUsage)
      .where(eq(hostedUsage.userId, userId));
    assert.deepEqual(day, { calls: 0, voiceSeconds: 91.5 });
    assert.equal(utcDayKey(NOW), "2026-09-10");
  } finally {
    await opened.close();
  }
});

test("recording for an account the database does not hold writes nothing", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const outcome = await recordVoiceSeconds(opened.db, {
      userId: "user-gone",
      sessionId: "sess_x",
      seconds: 5,
      now: NOW,
    });
    assert.equal(outcome, VOICE_SECONDS_OUTCOME.UNKNOWN_USER);
    const rows = await opened.db.select().from(voiceSessionUsage);
    assert.deepEqual(rows, []);
  } finally {
    await opened.close();
  }
});

test("deleting the account takes its session usage rows with it", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const userId = await opened.createUser();
    await recordVoiceSeconds(opened.db, { userId, sessionId: "sess_c", seconds: 5, now: NOW });
    const { user } = await import("../server/db/auth-schema");
    await opened.db.delete(user).where(eq(user.id, userId));
    const rows = await opened.db.select().from(voiceSessionUsage);
    assert.deepEqual(rows, []);
  } finally {
    await opened.close();
  }
});
