import { catalogIdOf } from "@luke/features/model-label";
import {
  type TaskTranscript,
  TRANSCRIPT_BOUNDS,
  TRANSCRIPT_PART_TYPE,
  type TranscriptCall,
} from "@luke/features/transcript-wire";
import { TRANSCRIPT_SPEAKER, TranscriptLedger, type TranscriptUtterance } from "@luke/live";
import { desc, eq, inArray } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import { voiceSessions, voiceTranscriptSegments } from "../schemas/voice.js";
import { VOICE_CLOSE_REASON, VOICE_SEGMENT_ROLE } from "../voice-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";
import { type SpokenRow, spokenRowsOn } from "./message-reads.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask } from "./workspace-store.js";

/**
 * transcript-store.ts -- what was said on a task's voice calls, read back for the Tasks tab.
 *
 * The voice writer keeps each call's words as timed fragments
 * (`@luke/database/models/voice-writer`); this reads the newest of them for one task and
 * groups each call's through the ledger the live captions keep, so a call
 * reads back in the lines its captions drew, each line one `UIMessage`
 * whose id is its place on the call and whose metadata names the rows the
 * voice wrote for it in the task's conversation, found by its call, its
 * speaker, and where on the call their words began. Beside its words, each call says what
 * its session row recorded of it: when and why it ended, its metered
 * seconds, and its model by the catalog's id (`catalogIdOf`), each only where the row holds it. The task is read
 * under the account's membership of its workspace, so a task of a workspace
 * the account is not in reads as no task, exactly as in `task-store.ts`;
 * past that gate a shared task's transcript is every member's calls about
 * it, so the calls are gathered by the task alone. Nothing is written here.
 */

const SPEAKER_OF_ROLE = {
  [VOICE_SEGMENT_ROLE.USER]: TRANSCRIPT_SPEAKER.USER,
  [VOICE_SEGMENT_ROLE.ASSISTANT]: TRANSCRIPT_SPEAKER.ASSISTANT,
} as const;

const TaskKeySchema = Schema.Struct({ userId: Schema.String, taskId: Schema.String });

const findReachableTask = SqlSchema.findOneOption({
  Request: TaskKeySchema,
  Result: Schema.Struct({ id: Schema.String, conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, conversationId: task.conversationId })
        .from(task)
        .where(reachableTask(userId, taskId)),
    ),
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
 * The newest fragments of every member's calls about the task, newest first:
 * the call by its start, then the fragment by its place. One more than the
 * bound is asked for, so the read can tell whether older words stand.
 */
const findNewestSegments = SqlSchema.findAll({
  Request: Schema.String,
  Result: SegmentRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
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
        .where(eq(voiceSessions.taskId, taskId))
        .orderBy(
          desc(voiceSessions.startedAt),
          desc(voiceSessions.id),
          desc(voiceTranscriptSegments.seq),
        )
        .limit(TRANSCRIPT_BOUNDS.MAX_SEGMENTS + 1),
    ),
});

const CallRecordRowSchema = Schema.Struct({
  id: Schema.String,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.Literals(Object.values(VOICE_CLOSE_REASON))),
  usage: Schema.NullOr(Schema.Struct({ seconds: Schema.Number, confirmed: Schema.Boolean })),
  model: Schema.NullOr(Schema.String),
  callerId: Schema.NullOr(Schema.String),
  callerName: Schema.NullOr(Schema.String),
});

type CallRecordRow = typeof CallRecordRowSchema.Type;

/** What the session rows recorded of the calls named, whichever member made each: how each ended, what it metered, its model, and whose call it was. */
const findCallRecords = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: CallRecordRowSchema,
  execute: (ids) =>
    Database.use((db) =>
      db
        .select({
          id: voiceSessions.id,
          closedAt: voiceSessions.closedAt,
          closeReason: voiceSessions.closeReason,
          usage: voiceSessions.usage,
          model: voiceSessions.model,
          callerId: user.id,
          callerName: user.name,
        })
        .from(voiceSessions)
        .leftJoin(user, eq(user.id, voiceSessions.userId))
        .where(inArray(voiceSessions.id, [...ids])),
    ),
});

/** The rows a line was written as: each of its speaker's on its call whose words began inside the line's span, more than one where a call that reattached split one utterance across rows. */
function rowsOf(line: TranscriptUtterance, rows: readonly SpokenRow[]): readonly string[] {
  return rows
    .filter(
      (row) => row.role === line.speaker && row.fromMs >= line.startMs && row.fromMs <= line.endMs,
    )
    .map((row) => row.clientId);
}

/** One call as it is read: its first fragment, which names it, and the ledger its fragments are grouped by. */
interface CallRead {
  readonly first: SegmentRow;
  readonly ledger: TranscriptLedger;
}

/** What a call's record adds to its words: each field its row holds, the caller among them, and nothing where it holds none. */
function recordOf(row: CallRecordRow | undefined): Partial<TranscriptCall> {
  if (row === undefined) return {};
  return {
    ...(row.closedAt === null ? undefined : { endedAt: row.closedAt.getTime() }),
    ...(row.closeReason === null ? undefined : { ending: row.closeReason }),
    ...(row.usage === null ? undefined : { usage: row.usage }),
    ...(row.model === null ? undefined : { model: catalogIdOf(row.model) }),
    ...(row.callerId === null || row.callerName === null
      ? undefined
      : { by: { userId: row.callerId, name: row.callerName } }),
  };
}

/**
 * Fragments read newest first, as the calls they were said on, oldest
 * first, each call's fragments appended to its ledger in the order they
 * were written. Note that the ledger's row ids are never read, because a
 * line's place on its call is what names it here and its rows on record
 * are found by its span (`rowsOf`).
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

/** The calls read, each with its lines, where on the call each began and ended, the row each was written as, and what its record holds of it. */
function transcriptOf(
  calls: readonly CallRead[],
  records: ReadonlyMap<string, CallRecordRow>,
  spoken: ReadonlyMap<string, readonly SpokenRow[]>,
  earlierOmitted: boolean,
): TaskTranscript {
  return {
    calls: calls.map(({ first, ledger }) => ({
      id: first.voiceSessionId,
      startedAt: first.startedAt.getTime(),
      messages: ledger.captionLines().map((line, index) => {
        const rowIds = rowsOf(line, spoken.get(first.voiceSessionId) ?? []);
        return {
          id: String(index),
          role: line.speaker,
          parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text: line.text }],
          metadata: {
            span: { startMs: line.startMs, endMs: line.endMs },
            ...(rowIds.length === 0 ? undefined : { rowIds: [...rowIds] }),
          },
        };
      }),
      ...recordOf(records.get(first.voiceSessionId)),
    })),
    earlierOmitted,
  };
}

/** The rows the voice wrote for the calls named, by call; none where the task has no conversation yet. */
function spokenRowsOf(
  userId: string,
  conversationId: string | null,
  ids: readonly string[],
): TaskStoreEffect<ReadonlyMap<string, readonly SpokenRow[]>> {
  if (conversationId === null || ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(spokenRowsOn(userId, conversationId, ids), (rows) => {
    const byCall = new Map<string, SpokenRow[]>();
    for (const row of rows)
      byCall.set(row.voiceSessionId, [...(byCall.get(row.voiceSessionId) ?? []), row]);
    return byCall;
  });
}

/** What was said on the task's calls, oldest call first; nothing where the account reaches no such task. */
export function readTranscript(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<TaskTranscript>> {
  return Effect.gen(function* () {
    const owned = yield* findReachableTask({ userId, taskId });
    if (Option.isNone(owned)) return Option.none();
    const newestFirst = yield* findNewestSegments(taskId);
    const calls = callsOf(newestFirst);
    const ids = calls.map((call) => call.first.voiceSessionId);
    const records = ids.length === 0 ? [] : yield* findCallRecords(ids);
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
