import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { hostedUsage, voiceSessionUsage } from "../server/db/usage-schema";
import { recordVoiceSeconds, utcDayKey, VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

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
