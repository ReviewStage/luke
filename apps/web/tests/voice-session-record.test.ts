import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { voiceSessions, voiceTranscriptSegments } from "../server/db/voice-schema";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "../server/db/voice-vocabulary";
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
 * Synthetic fixtures: no real account, plan, or live session anywhere.
 */

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const record = voiceSessionRecord(() => NOW);

const PLAN = {
  name: "Teammate invitations",
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

/** A call registered about the plan, started at the instant given, with the segments said on it in order. */
const callWith = (
  input: { userId: string; planId: string; startedAt: number },
  segments: ReadonlyArray<readonly [VoiceSegmentRole, string]>,
) =>
  Effect.gen(function* () {
    const liveSessionId = `live_h_${randomUUID()}`;
    const voiceSessionId = yield* record.register({
      userId: input.userId,
      sessionId: liveSessionId,
      planId: input.planId,
    });
    assert.ok(voiceSessionId);
    yield* db
      .update(voiceSessions)
      .set({ startedAt: new Date(input.startedAt) })
      .where(eq(voiceSessions.id, voiceSessionId));
    for (const [seq, [role, text]] of segments.entries()) {
      yield* db
        .insert(voiceTranscriptSegments)
        .values({ voiceSessionId, seq, role, text, startMs: seq * 1000, endMs: seq * 1000 + 900 });
    }
    return voiceSessionId;
  });

it.layer(testSqlClient)("the voice session record over effect/unstable/sql", (it) => {
  it.effect(
    "a registered session names its account, keeps its first owner, and answers the owner's re-attach alone",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const liveSessionId = `live_r_${randomUUID()}`;
        const planId = randomUUID();
        const registered = yield* record.register({
          userId: owner,
          sessionId: liveSessionId,
          planId,
        });
        const taken = yield* record.register({
          userId: other,
          sessionId: liveSessionId,
          planId: randomUUID(),
        });

        // The owner is answered the store's id for the row, and another account nothing.
        const rows = yield* readVoiceSession(liveSessionId);
        assert.equal(registered, rows[0]?.id);
        assert.equal(taken, undefined);
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId,
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
    "a call names the owner's plan, and its re-attach reads that plan back even once the plan is deleted",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const plan = yield* createPlan(owner, PLAN);
        const liveSessionId = `live_p_${randomUUID()}`;

        assert.equal((yield* record.heldPlan({ userId: owner, planId: plan.id }))?.id, plan.id);
        assert.equal(yield* record.heldPlan({ userId: other, planId: plan.id }), undefined);
        yield* record.register({ userId: owner, sessionId: liveSessionId, planId: plan.id });
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId: plan.id,
        });

        // The binding is the session's for life: a deleted plan leaves it naming a plan that
        // no longer stands, never no plan at all.
        yield* deletePlan(owner, plan.id);
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          planId: plan.id,
        });
        assert.equal(yield* record.heldPlan({ userId: owner, planId: plan.id }), undefined);
      }),
  );

  it.effect(
    "a plan's earlier calls read back oldest first, one speaker's adjacent words on one call run together, and never another plan's or another account's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const other = yield* openUser;
        const planId = randomUUID();
        const { USER, ASSISTANT } = VOICE_SEGMENT_ROLE;
        // Registered newest first, so the order read back is the calls' and not the rows'.
        const second = yield* callWith({ userId: owner, planId, startedAt: NOW - 60_000 }, [
          [USER, "Seven days."],
        ]);
        const first = yield* callWith({ userId: owner, planId, startedAt: NOW - 3_600_000 }, [
          [USER, "Invites "],
          [USER, "should expire."],
          [ASSISTANT, "After how many days?"],
        ]);
        yield* callWith({ userId: owner, planId: randomUUID(), startedAt: NOW }, [
          [USER, "Another plan's words."],
        ]);
        yield* callWith({ userId: other, planId, startedAt: NOW }, [[USER, "Another account's."]]);

        assert.deepEqual(yield* record.earlierCalls({ userId: owner, planId }), [
          { voiceSessionId: first, role: USER, text: "Invites should expire." },
          { voiceSessionId: first, role: ASSISTANT, text: "After how many days?" },
          { voiceSessionId: second, role: USER, text: "Seven days." },
        ]);
        assert.deepEqual(yield* record.earlierCalls({ userId: owner, planId: randomUUID() }), []);
      }),
  );

  it.effect(
    "usage snapshots overwrite one another unconfirmed, the close confirms the seconds with when and why, and a late snapshot leaves the close standing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const liveSessionId = `live_u_${randomUUID()}`;
        yield* record.register({ userId: owner, sessionId: liveSessionId, planId: randomUUID() });
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
});
