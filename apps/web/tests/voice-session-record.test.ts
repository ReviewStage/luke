import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { VOICE_CLOSE_REASON, VOICE_DELEGATION_MODE } from "../server/db/voice-vocabulary";
import { registerDevice } from "../server/hosted/device-store";
import { voiceSessionRecord } from "../server/voice/session-record";
import { testSqlClient } from "./support/sql-client";

/**
 * The live session row as the record now writes it: five effects over the
 * ambient `SqlClient`, composed here by the suite itself rather than run to
 * promises through a door, which is what the service's own session effect
 * does with them.
 *
 * Synthetic fixtures: no real account, device, or live session anywhere.
 */

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const record = voiceSessionRecord(() => NOW);

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return userId;
});

const readVoiceSession = (liveSessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql`select * from voice_sessions where live_session_id = ${liveSessionId}`;
  });

it.layer(testSqlClient)("the voice session record over effect/unstable/sql", (it) => {
  it.effect(
    "a registered session names its account, keeps its first owner, and answers the owner's re-attach alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const liveSessionId = `live_r_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: liveSessionId });
        yield* record.register({ userId: other, sessionId: liveSessionId });

        assert.equal(yield* record.owned({ userId: owner, sessionId: liveSessionId }), true);
        assert.equal(yield* record.owned({ userId: other, sessionId: liveSessionId }), false);
        assert.equal(yield* record.owned({ userId: owner, sessionId: "live_never" }), false);
        const rows = yield* readVoiceSession(liveSessionId);
        assert.deepEqual(
          rows.map((row) => ({
            userId: row.user_id,
            delegationMode: row.delegation_mode,
            closedAt: row.closed_at,
            usage: row.usage,
          })),
          [
            {
              userId: owner,
              delegationMode: VOICE_DELEGATION_MODE.CLIENT,
              closedAt: null,
              usage: null,
            },
          ],
        );
      }),
  );

  it.effect(
    "usage snapshots overwrite one another unconfirmed, the close confirms the seconds with when and why, and a late snapshot leaves the close standing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const liveSessionId = `live_u_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: liveSessionId });
        yield* record.noteUsage({ sessionId: liveSessionId, seconds: 10 });
        yield* record.noteUsage({ sessionId: liveSessionId, seconds: 25 });
        const read = Effect.map(readVoiceSession(liveSessionId), (rows) =>
          rows.map((row) => ({
            closedAt: row.closed_at,
            closeReason: row.close_reason,
            usage: row.usage,
          })),
        );

        assert.deepEqual(yield* read, [
          { closedAt: null, closeReason: null, usage: { seconds: 25, confirmed: false } },
        ]);

        yield* record.close({
          sessionId: liveSessionId,
          seconds: 26.5,
          reason: VOICE_CLOSE_REASON.REMOTE_HANGUP,
        });
        assert.deepEqual(yield* read, [
          {
            closedAt: new Date(NOW),
            closeReason: VOICE_CLOSE_REASON.REMOTE_HANGUP,
            usage: { seconds: 26.5, confirmed: true },
          },
        ]);
        yield* record.noteUsage({ sessionId: liveSessionId, seconds: 30 });
        assert.deepEqual(
          (yield* read).map((row) => row.usage),
          [{ seconds: 26.5, confirmed: true }],
        );
        yield* record.noteUsage({ sessionId: "live_unknown", seconds: 1 });
        assert.equal((yield* readVoiceSession("live_unknown")).length, 0);
      }),
  );

  it.effect(
    "a session names the device the handshake claimed only where the account holds that row, and another account's row leaves it unnamed",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const { deviceId } = yield* registerDevice({
          id: randomUUID(),
          userId: owner,
          installationId: randomUUID(),
          platform: DEVICE_PLATFORM.MACOS,
          now: new Date(NOW),
          push: undefined,
        });

        assert.equal(yield* record.deviceOwned({ userId: owner, deviceId }), true);
        assert.equal(yield* record.deviceOwned({ userId: other, deviceId }), false);
        assert.equal(yield* record.deviceOwned({ userId: owner, deviceId: randomUUID() }), false);

        const owned = `live_d_owned_${randomUUID()}`;
        const foreign = `live_d_foreign_${randomUUID()}`;
        const none = `live_d_none_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: owned, deviceId });
        yield* record.register({ userId: other, sessionId: foreign, deviceId });
        yield* record.register({ userId: owner, sessionId: none });
        const named = (sessionId: string) =>
          Effect.map(readVoiceSession(sessionId), (rows) => rows[0]?.device_id);

        assert.equal(yield* named(owned), deviceId);
        assert.equal(yield* named(foreign), null);
        assert.equal(yield* named(none), null);
      }),
  );
});
