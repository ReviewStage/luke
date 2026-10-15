import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { user } from "@luke/database/schemas/auth";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import { getTestDB, joinWorkspace, startPlan } from "@luke/database/testing";
import {
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "@luke/database/voice-vocabulary";
import { LIVE_DEFAULTS } from "@luke/live";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

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

const openUser = Effect.gen(function* () {
  const db = yield* Database;
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
  model: Schema.NullOr(Schema.String),
});
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

const readVoiceSession = (liveSessionId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select().from(voiceSessions).where(eq(voiceSessions.liveSessionId, liveSessionId)),
    ),
    (rows) => rows.map((row) => decodeVoiceSessionRow(row)),
  );

/** A call registered about the plan, started at the instant given, with the segments said on it in order. */
const callWith = (
  input: { userId: string; planId: string; startedAt: number },
  segments: ReadonlyArray<readonly [VoiceSegmentRole, string]>,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const liveSessionId = `live_h_${randomUUID()}`;
    const voiceSessionId = yield* record.register({
      userId: input.userId,
      sessionId: liveSessionId,
      planId: input.planId,
      attachId: randomUUID(),
      model: LIVE_DEFAULTS.MODEL,
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

it.layer(getTestDB())("the voice session record over effect/sql", (it) => {
  it.effect(
    "a registered session names its account and its model, keeps its first owner, and answers the owner's re-attach alone",
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
          attachId: randomUUID(),
          model: LIVE_DEFAULTS.MODEL,
        });
        const taken = yield* record.register({
          userId: other,
          sessionId: liveSessionId,
          planId: randomUUID(),
          attachId: randomUUID(),
          model: LIVE_DEFAULTS.MODEL,
        });

        // The owner is answered the store's id for the row, and another account nothing.
        const rows = yield* readVoiceSession(liveSessionId);
        assert.equal(registered, rows[0]?.id);
        assert.equal(taken, undefined);
        assert.deepEqual(yield* record.owned({ userId: owner, sessionId: liveSessionId }), {
          voiceSessionId: registered,
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
            model: row.model,
          })),
          [
            {
              userId: owner,
              delegationMode: VOICE_DELEGATION_MODE.CLIENT,
              closedAt: null,
              usage: null,
              model: LIVE_DEFAULTS.MODEL,
            },
          ],
        );
      }),
  );

  it.effect(
    "a member of the plan's workspace holds a teammate's plan for a call, and no one else does",
    () =>
      Effect.gen(function* () {
        const starter = yield* openUser;
        const teammate = yield* openUser;
        const stranger = yield* openUser;
        const plan = yield* startPlan(starter, { name: "Teammate invitations" });
        yield* joinWorkspace(plan.workspaceId, teammate);

        assert.equal((yield* record.heldPlan({ userId: teammate, planId: plan.id }))?.id, plan.id);
        assert.equal(yield* record.heldPlan({ userId: stranger, planId: plan.id }), undefined);
      }),
  );

  it.effect(
    "a plan's earlier calls read back oldest first, one speaker's adjacent words on one call run together, every member's and never another plan's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openUser;
        const teammate = yield* openUser;
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
        const teammates = yield* callWith({ userId: teammate, planId, startedAt: NOW }, [
          [USER, "A teammate's."],
        ]);

        assert.deepEqual(yield* record.earlierCalls({ userId: owner, planId }), [
          { voiceSessionId: first, role: USER, text: "Invites should expire." },
          { voiceSessionId: first, role: ASSISTANT, text: "After how many days?" },
          { voiceSessionId: second, role: USER, text: "Seven days." },
          { voiceSessionId: teammates, role: USER, text: "A teammate's." },
        ]);
        assert.deepEqual(yield* record.earlierCalls({ userId: owner, planId: randomUUID() }), []);
      }),
  );
});
