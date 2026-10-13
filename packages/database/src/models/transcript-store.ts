import {
  type PlanTranscript,
  TRANSCRIPT_BOUNDS,
  TRANSCRIPT_PART_TYPE,
  type TranscriptCall,
} from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER, TranscriptLedger, type TranscriptUtterance } from "@sidecar/live";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";
import { db } from "../core/query.js";
import { plan } from "../schemas/plan.js";
import { messages } from "../schemas/storage.js";
import { voiceSessions, voiceTranscriptSegments } from "../schemas/voice.js";
import { VOICE_CLOSE_REASON, VOICE_SEGMENT_ROLE } from "../voice-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";
import type { PlanStoreEffect } from "./plan-store.js";

/**
 * transcript-store.ts -- what was said on a plan's voice calls, read back for the Plans tab.
 *
 * The voice writer keeps each call's words as timed fragments
 * (`@sidecar/database/models/voice-writer`); this reads the newest of them for one plan and
 * groups each call's through the ledger the live captions keep, so a call
 * reads back in the lines its captions drew, each line one `UIMessage`
 * whose id is its place on the call and whose metadata names the row the
 * voice wrote for it in the plan's conversation, found by its call, its
 * speaker, and where on the call it began. Beside its words, each call says what
 * its session row recorded of it: when and why it ended, its metered
 * seconds, and its model, each only where the row holds it. Every statement names the
 * account beside the plan, so a plan another account owns reads as no plan,
 * exactly as in `plan-store.ts`, and a call another account made about a
 * plan of the same id is never gathered. Nothing is written here.
 */

const SPEAKER_OF_ROLE = {
  [VOICE_SEGMENT_ROLE.USER]: TRANSCRIPT_SPEAKER.USER,
  [VOICE_SEGMENT_ROLE.ASSISTANT]: TRANSCRIPT_SPEAKER.ASSISTANT,
} as const;

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const findOwnedPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ id: Schema.String, conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, planId }) =>
    db
      .select({ id: plan.id, conversationId: plan.conversationId })
      .from(plan)
      .where(and(eq(plan.id, planId), eq(plan.userId, userId))),
});

const SegmentRowSchema = Schema.Struct({
  voiceSessionId: Schema.String,
  startedAt: InstantColumnSchema,
  role: Schema.Literals(Object.values(VOICE_SEGMENT_ROLE)),
  text: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
});

type SegmentRow = typeof SegmentRowSchema.Type;

/**
 * The newest fragments of the account's calls about the plan, newest first:
 * the call by its start, then the fragment by its place. One more than the
 * bound is asked for, so the read can tell whether older words stand.
 */
const findNewestSegments = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: SegmentRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select({
        voiceSessionId: voiceTranscriptSegments.voiceSessionId,
        startedAt: voiceSessions.startedAt,
        role: voiceTranscriptSegments.role,
        text: voiceTranscriptSegments.text,
        startMs: voiceTranscriptSegments.startMs,
        endMs: voiceTranscriptSegments.endMs,
      })
      .from(voiceTranscriptSegments)
      .innerJoin(voiceSessions, eq(voiceSessions.id, voiceTranscriptSegments.voiceSessionId))
      .where(and(eq(voiceSessions.userId, userId), eq(voiceSessions.planId, planId)))
      .orderBy(
        desc(voiceSessions.startedAt),
        desc(voiceSessions.id),
        desc(voiceTranscriptSegments.seq),
      )
      .limit(TRANSCRIPT_BOUNDS.MAX_SEGMENTS + 1),
});

const CallRecordRowSchema = Schema.Struct({
  id: Schema.String,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.Literals(Object.values(VOICE_CLOSE_REASON))),
  usage: Schema.NullOr(Schema.Struct({ seconds: Schema.Number, confirmed: Schema.Boolean })),
  model: Schema.NullOr(Schema.String),
});

type CallRecordRow = typeof CallRecordRowSchema.Type;

/** What the account's session rows recorded of the calls named: how each ended, what it metered, and its model. */
const findCallRecords = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, ids: Schema.Array(Schema.String) }),
  Result: CallRecordRowSchema,
  execute: ({ userId, ids }) =>
    db
      .select({
        id: voiceSessions.id,
        closedAt: voiceSessions.closedAt,
        closeReason: voiceSessions.closeReason,
        usage: voiceSessions.usage,
        model: voiceSessions.model,
      })
      .from(voiceSessions)
      .where(and(inArray(voiceSessions.id, [...ids]), eq(voiceSessions.userId, userId))),
});

const SpokenRowSchema = Schema.Struct({
  clientId: Schema.String,
  role: Schema.Literals(Object.values(TRANSCRIPT_SPEAKER)),
  voiceSessionId: Schema.String,
  fromMs: Schema.Number,
});

type SpokenRow = typeof SpokenRowSchema.Type;

/** The rows the voice wrote in the plan's conversation for what was said on the calls named, each with its call and where on it its words began. */
const findSpokenRows = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    ids: Schema.Array(Schema.String),
  }),
  Result: SpokenRowSchema,
  execute: ({ userId, conversationId, ids }) =>
    db
      .select({
        clientId: messages.clientId,
        role: messages.role,
        voiceSessionId: sql<string>`${messages.metadata}->>'voice_session_id'`,
        fromMs: sql<number>`(${messages.metadata}->>'from_ms')::double precision`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.conversationId, conversationId),
          inArray(sql`${messages.metadata}->>'voice_session_id'`, [...ids]),
          sql`${messages.metadata}->>'from_ms' is not null`,
        ),
      ),
});

/** The row a line was written as: one of its speaker's on its call whose words began inside the line's span; none where the record holds no such row. */
function rowOf(line: TranscriptUtterance, rows: readonly SpokenRow[]): string | undefined {
  return rows.find(
    (row) => row.role === line.speaker && row.fromMs >= line.startMs && row.fromMs <= line.endMs,
  )?.clientId;
}

/** One call as it is read: its first fragment, which names it, and the ledger its fragments are grouped by. */
interface CallRead {
  readonly first: SegmentRow;
  readonly ledger: TranscriptLedger;
}

/** What a call's record adds to its words: each field its row holds, and nothing where it holds none. */
function recordOf(row: CallRecordRow | undefined): Partial<TranscriptCall> {
  if (row === undefined) return {};
  return {
    ...(row.closedAt === null ? undefined : { endedAt: row.closedAt.getTime() }),
    ...(row.closeReason === null ? undefined : { ending: row.closeReason }),
    ...(row.usage === null ? undefined : { usage: row.usage }),
    ...(row.model === null ? undefined : { model: row.model }),
  };
}

/**
 * Fragments read newest first, as the calls they were said on, oldest
 * first, each call's fragments appended to its ledger in the order they
 * were written. Note that the ledger's row ids are never read, because a
 * line's place on its call is what names it here and its row on record is
 * found by its span (`rowOf`).
 */
function callsOf(newestFirst: readonly SegmentRow[]): readonly CallRead[] {
  const calls: CallRead[] = [];
  for (const segment of newestFirst.slice(0, TRANSCRIPT_BOUNDS.MAX_SEGMENTS).reverse()) {
    let call = calls.at(-1);
    if (call?.first.voiceSessionId !== segment.voiceSessionId) {
      call = { first: segment, ledger: new TranscriptLedger({ mintRowId: () => "" }) };
      calls.push(call);
    }
    call.ledger.append({
      speaker: SPEAKER_OF_ROLE[segment.role],
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
    });
  }
  return calls;
}

/** The calls read, each with its lines, the row each line was written as, and what its record holds of it. */
function transcriptOf(
  calls: readonly CallRead[],
  records: ReadonlyMap<string, CallRecordRow>,
  spoken: ReadonlyMap<string, readonly SpokenRow[]>,
  earlierOmitted: boolean,
): PlanTranscript {
  return {
    calls: calls.map(({ first, ledger }) => ({
      id: first.voiceSessionId,
      startedAt: first.startedAt.getTime(),
      messages: ledger.captionLines().map((line, index) => {
        const rowId = rowOf(line, spoken.get(first.voiceSessionId) ?? []);
        return {
          id: String(index),
          role: line.speaker,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: line.text }],
          ...(rowId === undefined ? undefined : { metadata: { rowId } }),
        };
      }),
      ...recordOf(records.get(first.voiceSessionId)),
    })),
    earlierOmitted,
  };
}

/** The rows the voice wrote for the calls named, by call; none where the plan has no conversation yet. */
function spokenRowsOf(
  userId: string,
  conversationId: string | null,
  ids: readonly string[],
): PlanStoreEffect<ReadonlyMap<string, readonly SpokenRow[]>> {
  if (conversationId === null || ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(findSpokenRows({ userId, conversationId, ids }), (rows) => {
    const byCall = new Map<string, SpokenRow[]>();
    for (const row of rows)
      byCall.set(row.voiceSessionId, [...(byCall.get(row.voiceSessionId) ?? []), row]);
    return byCall;
  });
}

/** What was said on the plan's calls, oldest call first; nothing where the account owns no such plan. */
export function readTranscript(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<PlanTranscript>> {
  return Effect.gen(function* () {
    const owned = yield* findOwnedPlan({ userId, planId });
    if (Option.isNone(owned)) return Option.none();
    const newestFirst = yield* findNewestSegments({ userId, planId });
    const calls = callsOf(newestFirst);
    const ids = calls.map((call) => call.first.voiceSessionId);
    const records = ids.length === 0 ? [] : yield* findCallRecords({ userId, ids });
    const spoken = yield* spokenRowsOf(userId, owned.value.conversationId, ids);
    return Option.some(
      transcriptOf(
        calls,
        new Map(records.map((row) => [row.id, row])),
        spoken,
        newestFirst.length > TRANSCRIPT_BOUNDS.MAX_SEGMENTS,
      ),
    );
  });
}
