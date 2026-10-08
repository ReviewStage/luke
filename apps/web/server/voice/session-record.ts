import type { Plan } from "@sidecar/hosted/plan-wire";
import { and, asc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../db/query.js";
import { voiceSessions } from "../db/voice-schema.js";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  type VoiceCloseReason,
} from "../db/voice-vocabulary.js";
import { readPlan } from "../hosted/plan-store.js";

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
 * A connection whose device socket went without a hang-up
 * stamps `detached_at` on the open row, and a re-attach clears it, so an open
 * row stamped longer ago than the grace is a session no device came back for:
 * the scheduled sweep reads those rows, oldest first and bounded, and ends
 * each one, writing its close here like any other. A session that is gone at
 * OpenAI by then is closed as a lost connection with its last unconfirmed
 * snapshot standing, so no row is read for closing twice.
 *
 * The row also names the plan the call was opened about, checked to be the
 * account's before anything is spent, and that binding is what a
 * re-attach reads back: the attaching connection says nothing of a plan, so
 * a session cannot be moved onto another plan, or off its own, by what a
 * later connection sends.
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

/** The session as its creation names it: the account, the live session, and the plan the call is about. */
interface VoiceSessionRegistration {
  userId: string;
  sessionId: string;
  planId: string;
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

/** A usage snapshot, unconfirmed until the close. */
interface VoiceSessionUsage {
  sessionId: string;
  seconds: number;
}

/** The close: the confirmed seconds and why the session ended. */
interface VoiceSessionClose extends VoiceSessionUsage {
  reason: VoiceCloseReason;
}

/** A live session named by the id alone, for a write that needs nothing else. */
interface VoiceSessionNamed {
  sessionId: string;
}

/** An open session no connection holds, as the orphan sweep reads it: the account billed and the live session. */
export interface DetachedVoiceSession {
  readonly userId: string;
  readonly sessionId: string;
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
  noteUsage(input: VoiceSessionUsage): VoiceSessionRecordEffect<void>;
  close(input: VoiceSessionClose): VoiceSessionRecordEffect<void>;
  /** Stamps the open session detached now: its device's socket went without a hang-up. */
  detach(input: VoiceSessionNamed): VoiceSessionRecordEffect<void>;
  /** Clears the stamp: a connection holds the session again. */
  attached(input: VoiceSessionNamed): VoiceSessionRecordEffect<void>;
  /** The open sessions detached before the instant, oldest first, at most `limit`. */
  detached(input: DetachedVoiceSessionQuery): VoiceSessionRecordEffect<DetachedVoiceSession[]>;
  /** Closes an open session as a lost connection, its last unconfirmed snapshot standing: what the sweep writes when the session answered nothing. */
  closeLost(input: VoiceSessionNamed): VoiceSessionRecordEffect<void>;
}

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
      .where(eq(voiceSessions.liveSessionId, row.liveSessionId)),
});

const DetachRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  detachedAt: Schema.NullOr(Schema.Date),
});

const stampDetached = SqlSchema.void({
  Request: DetachRequestSchema,
  execute: (row) =>
    db
      .update(voiceSessions)
      .set({ detachedAt: row.detachedAt })
      .where(
        and(eq(voiceSessions.liveSessionId, row.liveSessionId), isNull(voiceSessions.closedAt)),
      ),
});

const DetachedRequestSchema = Schema.Struct({ before: Schema.Date, limit: Schema.Number });
const DetachedRowSchema = Schema.Struct({ userId: Schema.String, sessionId: Schema.String });

const findDetached = SqlSchema.findAll({
  Request: DetachedRequestSchema,
  Result: DetachedRowSchema,
  execute: (request) =>
    db
      .select({ userId: voiceSessions.userId, sessionId: voiceSessions.liveSessionId })
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
      stampDetached({ liveSessionId: input.sessionId, detachedAt: new Date(now()) }),
    attached: (input) => stampDetached({ liveSessionId: input.sessionId, detachedAt: null }),
    detached: (input) =>
      Effect.map(
        findDetached({ before: new Date(input.detachedBefore), limit: input.limit }),
        (rows) => [...rows],
      ),
    closeLost: (input) =>
      closeLostSession({
        liveSessionId: input.sessionId,
        closedAt: new Date(now()),
        closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
      }),
  };
}
