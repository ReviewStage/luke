import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { recordVoiceSeconds, utcDayKey, VOICE_SECONDS_OUTCOME } from "../server/hosted/quota";
import { testSqlClient } from "./support/sql-client";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return userId;
});

it.layer(testSqlClient)("recording a live session's billed seconds", (it) => {
  it.effect(
    "records a session's seconds once and moves the day's counter only the first time",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
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

        const sessions = yield* sql<{ session_id: string; seconds: number; recorded_at: number }>`
          select session_id, seconds, recorded_at from voice_session_usage
          where user_id = ${userId} order by session_id
        `;
        assert.deepEqual(
          sessions.map((row) => ({
            sessionId: row.session_id,
            seconds: row.seconds,
            recordedAt: Number(row.recorded_at),
          })),
          [
            { sessionId: "sess_a", seconds: 61, recordedAt: NOW },
            { sessionId: "sess_b", seconds: 30.5, recordedAt: NOW + 2_000 },
          ],
        );

        const [day] = yield* sql<{ calls: number; voice_seconds: number }>`
          select calls, voice_seconds from hosted_usage
          where user_id = ${userId} and day = ${utcDayKey(NOW)}
        `;
        assert.deepEqual(day && { calls: day.calls, voiceSeconds: day.voice_seconds }, {
          calls: 0,
          voiceSeconds: 91.5,
        });
        assert.equal(utcDayKey(NOW), "2026-09-10");
      }),
  );

  it.effect("recording for an account the database does not hold writes nothing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const outcome = yield* recordVoiceSeconds({
        userId: "user-gone",
        sessionId: "sess_x",
        seconds: 5,
        now: NOW,
      });
      assert.equal(outcome, VOICE_SECONDS_OUTCOME.UNKNOWN_USER);
      const rows =
        yield* sql`select session_id from voice_session_usage where session_id = ${"sess_x"}`;
      assert.deepEqual([...rows], []);
    }),
  );

  it.effect("deleting the account takes its session usage rows with it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const userId = yield* openUser;
      yield* recordVoiceSeconds({ userId, sessionId: "sess_c", seconds: 5, now: NOW });
      yield* sql`delete from "user" where id = ${userId}`;
      const rows =
        yield* sql`select session_id from voice_session_usage where session_id = ${"sess_c"}`;
      assert.deepEqual([...rows], []);
    }),
  );
});
