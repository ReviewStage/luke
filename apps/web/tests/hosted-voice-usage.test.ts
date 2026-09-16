import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { voiceSessionUsage } from "../server/db/usage-schema";
import { recordVoiceSeconds, utcDayKey, VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The usage rows one live session left behind, which a test expects to be none. */
const sessionUsageRows = (sessionId: string) =>
  db
    .select({ sessionId: voiceSessionUsage.sessionId })
    .from(voiceSessionUsage)
    .where(eq(voiceSessionUsage.sessionId, sessionId));

it.layer(testSqlClient)("recording a live session's billed seconds", (it) => {
  it.effect(
    "records a session's seconds once, and a report repeated for the same session records nothing",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;

        const first = yield* recordVoiceSeconds({
          userId,
          sessionId: "sess_a",
          seconds: 61,
          now: NOW,
        });
        const again = yield* recordVoiceSeconds({
          userId,
          sessionId: "sess_a",
          seconds: 61,
          now: NOW + 1_000,
        });
        const second = yield* recordVoiceSeconds({
          userId,
          sessionId: "sess_b",
          seconds: 30.5,
          now: NOW + 2_000,
        });

        assert.equal(first, VOICE_SECONDS_OUTCOME.RECORDED);
        assert.equal(again, VOICE_SECONDS_OUTCOME.REPEATED);
        assert.equal(second, VOICE_SECONDS_OUTCOME.RECORDED);

        const sessions = yield* db
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

        assert.equal(utcDayKey(NOW), "2026-09-10");
      }),
  );

  it.effect("recording for an account the database does not hold writes nothing", () =>
    Effect.gen(function* () {
      const outcome = yield* recordVoiceSeconds({
        userId: "user-gone",
        sessionId: "sess_x",
        seconds: 5,
        now: NOW,
      });
      assert.equal(outcome, VOICE_SECONDS_OUTCOME.UNKNOWN_USER);
      assert.deepEqual(yield* sessionUsageRows("sess_x"), []);
    }),
  );

  it.effect("deleting the account takes its session usage rows with it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* recordVoiceSeconds({ userId, sessionId: "sess_c", seconds: 5, now: NOW });
      yield* db.delete(user).where(eq(user.id, userId));
      assert.deepEqual(yield* sessionUsageRows("sess_c"), []);
    }),
  );
});
