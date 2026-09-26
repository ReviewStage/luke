import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { voiceSessions } from "../server/db/voice-schema";
import { VOICE_CLOSE_REASON, VOICE_DELEGATION_MODE } from "../server/db/voice-vocabulary";
import { registerDevice } from "../server/hosted/device-store";
import { createPlan, deletePlan } from "../server/hosted/plan-store";
import { InstantColumnSchema } from "../server/hosted/store/database";
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

const PLAN = {
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
} as const;

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The row as the suite reads it back, the instant column through the schema the two drivers agree on. */
const VoiceSessionRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
  delegationMode: Schema.String,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.Unknown),
});
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

const readVoiceSession = (liveSessionId: string) =>
  Effect.map(
    db.select().from(voiceSessions).where(eq(voiceSessions.liveSessionId, liveSessionId)),
    (rows) => rows.map((row) => decodeVoiceSessionRow(row)),
  );

/** The device the row names, which is null for a session that named none and for a claim the account did not hold. */
const namedDevice = (liveSessionId: string) =>
  Effect.map(readVoiceSession(liveSessionId), (rows) => rows[0]?.deviceId);

it.layer(testSqlClient)("the voice session record over effect/unstable/sql", (it) => {
  it.effect(
    "a registered session names its account, keeps its first owner, and answers the owner's re-attach alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const liveSessionId = `live_r_${randomUUID()}`;
        const registered = yield* record.register({ userId: owner, sessionId: liveSessionId });
        const taken = yield* record.register({ userId: other, sessionId: liveSessionId });

        // The owner is answered the store's id for the row, and another account nothing.
        const rows = yield* readVoiceSession(liveSessionId);
        assert.equal(registered, rows[0]?.id);
        assert.equal(taken, undefined);
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId: undefined,
        });
        assert.equal(yield* record.owned({ userId: other, sessionId: liveSessionId }), undefined);
        assert.equal(yield* record.owned({ userId: owner, sessionId: "live_never" }), undefined);
        assert.deepEqual(
          rows.map((row) => ({
            userId: row.userId,
            delegationMode: row.delegationMode,
            closedAt: row.closedAt,
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
    "a planning call names the owner's plan, and its re-attach reads that plan back even once the plan is deleted",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const plan = yield* createPlan(owner, PLAN);
        const liveSessionId = `live_p_${randomUUID()}`;

        assert.equal(yield* record.heldPlan({ userId: owner, planId: plan.id }), true);
        assert.equal(yield* record.heldPlan({ userId: other, planId: plan.id }), false);
        yield* record.register({ userId: owner, sessionId: liveSessionId, planId: plan.id });
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId: plan.id,
        });

        // The binding is the session's for life: a deleted plan leaves it naming a plan that
        // no longer stands, never a desk session.
        yield* deletePlan(owner, plan.id);
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId: plan.id,
        });
        assert.equal(yield* record.heldPlan({ userId: owner, planId: plan.id }), false);
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
            closedAt: row.closedAt,
            closeReason: row.closeReason,
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

        assert.deepEqual(yield* record.heldDevice({ userId: owner, deviceId }), {
          platform: DEVICE_PLATFORM.MACOS,
        });
        assert.equal(yield* record.heldDevice({ userId: other, deviceId }), undefined);
        assert.equal(
          yield* record.heldDevice({ userId: owner, deviceId: randomUUID() }),
          undefined,
        );

        const owned = `live_d_owned_${randomUUID()}`;
        const foreign = `live_d_foreign_${randomUUID()}`;
        const none = `live_d_none_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: owned, deviceId });
        yield* record.register({ userId: other, sessionId: foreign, deviceId });
        yield* record.register({ userId: owner, sessionId: none });
        assert.equal(yield* namedDevice(owned), deviceId);
        assert.equal(yield* namedDevice(foreign), null);
        assert.equal(yield* namedDevice(none), null);
      }),
  );

  it.effect(
    "a phone's row is read as the phone it is, a session of its own names it, and a phone claiming a Mac's row of another account is held by neither",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const phone = yield* registerDevice({
          id: randomUUID(),
          userId: owner,
          installationId: randomUUID(),
          platform: DEVICE_PLATFORM.IOS,
          now: new Date(NOW),
          push: undefined,
        });
        const theirMac = yield* registerDevice({
          id: randomUUID(),
          userId: other,
          installationId: randomUUID(),
          platform: DEVICE_PLATFORM.MACOS,
          now: new Date(NOW),
          push: undefined,
        });

        assert.deepEqual(yield* record.heldDevice({ userId: owner, deviceId: phone.deviceId }), {
          platform: DEVICE_PLATFORM.IOS,
        });
        assert.equal(
          yield* record.heldDevice({ userId: owner, deviceId: theirMac.deviceId }),
          undefined,
        );

        const called = `live_d_phone_${randomUUID()}`;
        const claimed = `live_d_claimed_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: called, deviceId: phone.deviceId });
        yield* record.register({
          userId: owner,
          sessionId: claimed,
          deviceId: theirMac.deviceId,
        });
        assert.equal(yield* namedDevice(called), phone.deviceId);
        assert.equal(yield* namedDevice(claimed), null);
      }),
  );
});
