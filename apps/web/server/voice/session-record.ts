import type { Plan } from "@sidecar/hosted/plan-wire";
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../db/query.js";
import { voiceSessions, voiceTranscriptSegments } from "../db/voice-schema.js";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceCloseReason,
  type VoiceSegmentRole,
} from "../db/voice-vocabulary.js";
import { readPlan } from "../hosted/plan-store.js";
import { InstantColumnSchema } from "../hosted/store/database.js";

/**
 * The one row per live session the storage rework keeps, written only here.
 * Creation writes the row, so a later function connection can prove the
 * account asking to re-attach is the one that opened the session; every
 * `session.usage.updated` overwrites the usage with an unconfirmed snapshot,
 * never a sum, and only while the row is still open, so a snapshot arriving
 * late on an earlier connection cannot unconfirm a close; and `session.closed`
 * writes the confirmed seconds beside when and why the session ended. A connection that ends without `session.closed`
 * writes nothing more: the last snapshot standing with `closed_at` null is
 * the honest record, and a later connection's `session.closed` confirms it.
 * The seconds the quota meters are a separate ledger, `recordVoiceSeconds`.
 *
 * A connection that ends without `session.closed` — its device socket gone
 * without a hang-up, a close OpenAI never confirmed, a refusal after the
 * session stood — stamps `detached_at` on the open row, and a re-attach
 * clears it, so an open row stamped longer ago than the grace is a session no
 * connection holds: the scheduled sweep reads those rows, oldest first and
 * bounded, and ends each one, writing its close here like any other. A
 * session that is gone at OpenAI by then, or past its duration limit, is
 * closed with its last unconfirmed snapshot standing, so no row is read for
 * closing twice. Each connection that holds the session names itself with
 * an attach id, written at creation and at every re-attach, and a stamp is
 * written only by the connection that still holds the row: the Mac re-attaches
 * within seconds, so the connection it replaced may write its detach after
 * the newer one attached, and that late stamp must not hand a live call to
 * the sweep.
 *
 * The row also names the plan the call was opened about, checked to be the
 * account's before anything is spent, and that binding is what a
 * re-attach reads back: the attaching connection says nothing of a plan, so
 * a session cannot be moved onto another plan, or off its own, by what a
 * later connection sends. The same binding is what a new call about the
 * plan reads its earlier calls back by, so a call picks up the conversation
 * the last one left off.
 */
/**
 * What every method answers: an effect over the ambient client, so the socket
 * that drives the record composes it into a fiber of its own and the edge
 * that owns the connection is the one that runs it.
 */
type VoiceSessionRecordEffect<A> = Effect.Effect<
  A,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
>;

/** The session as its creation names it: the account, the live session, the plan the call is about, and the connection that holds it. */
interface VoiceSessionRegistration {
  userId: string;
  sessionId: string;
  planId: string;
  attachId: string;
}

/** A plan as the account asking for a call about it names it. */
interface VoiceSessionPlanClaim {
  userId: string;
  planId: string;
}

/** A live session as the account that opened it names it. */
interface VoiceSessionOwnership {
  userId: string;
  sessionId: string;
}

/** A live session the account was shown to have opened: the plan its creation bound it to, where its row names one. */
interface OwnedVoiceSession {
  readonly planId: string | undefined;
}

/** One stretch of words on an earlier call, by one speaker, in the order it was said. */
export interface EarlierCallLine {
  /** The store's id of the call the words were said on, so lines of two calls are never run together. */
  readonly voiceSessionId: string;
  readonly role: VoiceSegmentRole;
  readonly text: string;
}

/** A usage snapshot, unconfirmed until the close. */
interface VoiceSessionUsage {
  sessionId: string;
  seconds: number;
}

/** The close: the confirmed seconds and why the session ended. */
interface VoiceSessionClose extends VoiceSessionUsage {
  reason: VoiceCloseReason;
}

/** A live session as one connection holding it names it. */
interface VoiceSessionAttachment {
  sessionId: string;
  attachId: string;
}

/** The close the sweep writes for a session that answered nothing: lost, or past its duration limit. */
interface VoiceSessionLost {
  sessionId: string;
  reason: typeof VOICE_CLOSE_REASON.CONNECTION_LOST | typeof VOICE_CLOSE_REASON.EXPIRED;
}

/** An open session no connection holds, as the orphan sweep reads it: the account billed, the live session, and when it started. */
export interface DetachedVoiceSession {
  readonly userId: string;
  readonly sessionId: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
}

/** Which open sessions were detached before the instant, oldest first, at most `limit`. */
interface DetachedVoiceSessionQuery {
  detachedBefore: number;
  limit: number;
}

export interface VoiceSessionRecord {
  /**
   * Writes the session down and answers the store's own id for its row, the
   * one a stored spoken row names as its `voice_session_id`, so the device
   * can tell its own rows from another session's; nothing where the live
   * session is already another account's, since the first owner keeps it.
   */
  register(input: VoiceSessionRegistration): VoiceSessionRecordEffect<string | undefined>;
  /** The plan named, where the account holds it: the check the door makes before a planning call is spent, and what the call opens knowing. */
  heldPlan(input: VoiceSessionPlanClaim): VoiceSessionRecordEffect<Plan | undefined>;
  /** The live session named, where the account created it, with the plan it was bound to: one lookup over the indexed pair. */
  owned(input: VoiceSessionOwnership): VoiceSessionRecordEffect<OwnedVoiceSession | undefined>;
  /**
   * What was said on the plan's calls so far, oldest first, adjacent words of
   * one speaker on one call run together: the newest `EARLIER_CALL_SEGMENTS`
   * segments, which is more than a session's startup history holds.
   */
  earlierCalls(input: VoiceSessionPlanClaim): VoiceSessionRecordEffect<EarlierCallLine[]>;
  noteUsage(input: VoiceSessionUsage): VoiceSessionRecordEffect<void>;
  /** Confirms the close of a session still open; a second close changes nothing. */
  close(input: VoiceSessionClose): VoiceSessionRecordEffect<void>;
  /** Stamps the open session detached now, where the connection named still holds it: it ended without `session.closed`. */
  detach(input: VoiceSessionAttachment): VoiceSessionRecordEffect<void>;
  /** Clears the stamp and names the connection that holds the session again. */
  attached(input: VoiceSessionAttachment): VoiceSessionRecordEffect<void>;
  /** The open sessions detached before the instant, oldest first, at most `limit`. */
  detached(input: DetachedVoiceSessionQuery): VoiceSessionRecordEffect<DetachedVoiceSession[]>;
  /** Closes an open session for the reason named, its last unconfirmed snapshot standing: what the sweep writes when the session is gone at OpenAI. */
  closeLost(input: VoiceSessionLost): VoiceSessionRecordEffect<void>;
}

/**
 * How many of the newest segments a new call reads back. A segment is a
 * transcript fragment, often a few words, so this is a bound on the read
 * rather than on the history: the opener cuts what it keeps to the startup
 * bound.
 */
const EARLIER_CALL_SEGMENTS = 2_000;

const VoiceCloseReasonSchema = Schema.Literals(Object.values(VOICE_CLOSE_REASON));

/** The usage column: the session's seconds and whether they are the API's own confirmed count. */
const VoiceUsageColumnSchema = Schema.Struct({
  seconds: Schema.Number,
  confirmed: Schema.Boolean,
});

const RegisterRequestSchema = Schema.Struct({
  userId: Schema.String,
  liveSessionId: Schema.String,
  delegationMode: Schema.Literal(VOICE_DELEGATION_MODE.CLIENT),
  planId: Schema.String,
  attachId: Schema.String,
  startedAt: Schema.Date,
});

const registerSession = SqlSchema.void({
  Request: RegisterRequestSchema,
  execute: (row) =>
    db
      .insert(voiceSessions)
      .values({
        userId: row.userId,
        liveSessionId: row.liveSessionId,
        delegationMode: row.delegationMode,
        planId: row.planId,
        attachId: row.attachId,
        startedAt: row.startedAt,
      })
      .onConflictDoNothing({ target: voiceSessions.liveSessionId }),
});

const OwnedKeySchema = Schema.Struct({ userId: Schema.String, liveSessionId: Schema.String });
const OwnedRowSchema = Schema.Struct({ id: Schema.String, planId: Schema.NullOr(Schema.String) });

const findOwnedSession = SqlSchema.findOneOption({
  Request: OwnedKeySchema,
  Result: OwnedRowSchema,
  execute: (key) =>
    db
      .select({ id: voiceSessions.id, planId: voiceSessions.planId })
      .from(voiceSessions)
      .where(
        and(
          eq(voiceSessions.userId, key.userId),
          eq(voiceSessions.liveSessionId, key.liveSessionId),
        ),
      ),
});

const EarlierCallsRequestSchema = Schema.Struct({
  userId: Schema.String,
  planId: Schema.String,
  limit: Schema.Number,
});

const EarlierSegmentSchema = Schema.Struct({
  voiceSessionId: Schema.String,
  role: Schema.Literals(Object.values(VOICE_SEGMENT_ROLE)),
  text: Schema.String,
});

/** The newest segments of the plan's calls, newest first: the call by its start, then the segment by its place. */
const findEarlierSegments = SqlSchema.findAll({
  Request: EarlierCallsRequestSchema,
  Result: EarlierSegmentSchema,
  execute: (request) =>
    db
      .select({
        voiceSessionId: voiceTranscriptSegments.voiceSessionId,
        role: voiceTranscriptSegments.role,
        text: voiceTranscriptSegments.text,
      })
      .from(voiceTranscriptSegments)
      .innerJoin(voiceSessions, eq(voiceSessions.id, voiceTranscriptSegments.voiceSessionId))
      .where(
        and(eq(voiceSessions.userId, request.userId), eq(voiceSessions.planId, request.planId)),
      )
      .orderBy(
        desc(voiceSessions.startedAt),
        desc(voiceSessions.id),
        desc(voiceTranscriptSegments.seq),
      )
      .limit(request.limit),
});

/** Segments read newest first, as lines oldest first: one speaker's adjacent words on one call joined untrimmed, as a spoken row's are. */
function earlierLines(newestFirst: readonly EarlierCallLine[]): EarlierCallLine[] {
  const lines: EarlierCallLine[] = [];
  for (const segment of [...newestFirst].reverse()) {
    const last = lines.at(-1);
    const continues =
      last !== undefined &&
      last.voiceSessionId === segment.voiceSessionId &&
      last.role === segment.role;
    if (continues) lines[lines.length - 1] = { ...last, text: last.text + segment.text };
    else lines.push({ ...segment });
  }
  return lines;
}

const NoteUsageRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  usage: VoiceUsageColumnSchema,
});

const noteSessionUsage = SqlSchema.void({
  Request: NoteUsageRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ usage: row.usage })
      .where(
        and(eq(voiceSessions.liveSessionId, row.liveSessionId), isNull(voiceSessions.closedAt)),
      ),
});

const CloseRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  closedAt: Schema.Date,
  closeReason: VoiceCloseReasonSchema,
  usage: VoiceUsageColumnSchema,
});

const closeSession = SqlSchema.void({
  Request: CloseRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ closedAt: row.closedAt, closeReason: row.closeReason, usage: row.usage })
      .where(
        and(eq(voiceSessions.liveSessionId, row.liveSessionId), isNull(voiceSessions.closedAt)),
      ),
});

const AttachmentRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  attachId: Schema.String,
});

const DetachRequestSchema = Schema.Struct({
  ...AttachmentRequestSchema.fields,
  detachedAt: Schema.Date,
});

/** Note that the attach id is matched, because a connection replaced by a re-attach no longer holds the row it would stamp. */
const stampDetached = SqlSchema.void({
  Request: DetachRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ detachedAt: row.detachedAt })
      .where(
        and(
          eq(voiceSessions.liveSessionId, row.liveSessionId),
          eq(voiceSessions.attachId, row.attachId),
          isNull(voiceSessions.closedAt),
        ),
      ),
});

const stampAttached = SqlSchema.void({
  Request: AttachmentRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ detachedAt: null, attachId: row.attachId })
      .where(
        and(eq(voiceSessions.liveSessionId, row.liveSessionId), isNull(voiceSessions.closedAt)),
      ),
});

const DetachedRequestSchema = Schema.Struct({ before: Schema.Date, limit: Schema.Number });
const DetachedRowSchema = Schema.Struct({
  userId: Schema.String,
  sessionId: Schema.String,
  startedAt: InstantColumnSchema,
});

const findDetached = SqlSchema.findAll({
  Request: DetachedRequestSchema,
  Result: DetachedRowSchema,
  execute: (request) =>
    db
      .select({
        userId: voiceSessions.userId,
        sessionId: voiceSessions.liveSessionId,
        startedAt: voiceSessions.startedAt,
      })
      .from(voiceSessions)
      .where(
        and(
          isNull(voiceSessions.closedAt),
          isNotNull(voiceSessions.detachedAt),
          lt(voiceSessions.detachedAt, request.before),
        ),
      )
      .orderBy(asc(voiceSessions.detachedAt))
      .limit(request.limit),
});

const CloseLostRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  closedAt: Schema.Date,
  closeReason: VoiceCloseReasonSchema,
});

const closeLostSession = SqlSchema.void({
  Request: CloseLostRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ closedAt: row.closedAt, closeReason: row.closeReason })
      .where(
        and(eq(voiceSessions.liveSessionId, row.liveSessionId), isNull(voiceSessions.closedAt)),
      ),
});

export function voiceSessionRecord(now: () => number = Date.now): VoiceSessionRecord {
  const usage = (seconds: number, confirmed: boolean) => ({ seconds, confirmed });
  return {
    register: (input) =>
      Effect.andThen(
        registerSession({
          userId: input.userId,
          liveSessionId: input.sessionId,
          delegationMode: VOICE_DELEGATION_MODE.CLIENT,
          planId: input.planId,
          attachId: input.attachId,
          startedAt: new Date(now()),
        }),
        Effect.map(
          findOwnedSession({ userId: input.userId, liveSessionId: input.sessionId }),
          Option.match({ onNone: () => undefined, onSome: (row) => row.id }),
        ),
      ),
    heldPlan: (input) =>
      Effect.map(
        readPlan(input.userId, input.planId),
        Option.match({ onNone: () => undefined, onSome: (stored) => stored.plan }),
      ),
    owned: (input) =>
      Effect.map(
        findOwnedSession({ userId: input.userId, liveSessionId: input.sessionId }),
        Option.match({
          onNone: () => undefined,
          onSome: (row) => ({ planId: row.planId ?? undefined }),
        }),
      ),
    earlierCalls: (input) =>
      Effect.map(
        findEarlierSegments({
          userId: input.userId,
          planId: input.planId,
          limit: EARLIER_CALL_SEGMENTS,
        }),
        earlierLines,
      ),
    noteUsage: (input) =>
      noteSessionUsage({
        liveSessionId: input.sessionId,
        usage: usage(input.seconds, false),
      }),
    close: (input) =>
      closeSession({
        liveSessionId: input.sessionId,
        closedAt: new Date(now()),
        closeReason: input.reason,
        usage: usage(input.seconds, true),
      }),
    detach: (input) =>
      stampDetached({
        liveSessionId: input.sessionId,
        attachId: input.attachId,
        detachedAt: new Date(now()),
      }),
    attached: (input) =>
      stampAttached({ liveSessionId: input.sessionId, attachId: input.attachId }),
    detached: (input) =>
      Effect.map(
        findDetached({ before: new Date(input.detachedBefore), limit: input.limit }),
        (rows) => rows.map((row) => ({ ...row, startedAt: row.startedAt.getTime() })),
      ),
    closeLost: (input) =>
      closeLostSession({
        liveSessionId: input.sessionId,
        closedAt: new Date(now()),
        closeReason: input.reason,
      }),
  };
}
