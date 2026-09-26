import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { type DevicePlatform, isDevicePlatform } from "../core.js";
import { devices } from "../db/devices-schema.js";
import { db } from "../db/query.js";
import { voiceSessions } from "../db/voice-schema.js";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  type VoiceCloseReason,
} from "../db/voice-vocabulary.js";
import { findHeldDevice } from "../hosted/device-store.js";
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
 * The device the session names is the one the handshake claimed, a Mac's row
 * or a phone's alike, and the write can name only a `devices` row the same
 * account holds: the id is read back out of that table under the account, so
 * a claim on another account's device, or on a row that has gone, leaves the
 * column null — the column's own word for a session that names no device —
 * and a briefing on offer stays unclaimed rather than claimed as someone
 * else's.
 *
 * A planning call's row also names the plan it was opened about, checked to
 * be the account's before anything is spent, and that binding is what a
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

/** The session as its creation names it: the account, the live session, the device the handshake claimed, and the plan a planning call is about, if any. */
interface VoiceSessionRegistration {
  userId: string;
  sessionId: string;
  deviceId?: string | undefined;
  planId?: string | undefined;
}

/** A plan as the account asking for a call about it names it. */
interface VoiceSessionPlanClaim {
  userId: string;
  planId: string;
}

/** A device row as the account claiming it names it. */
interface VoiceSessionDeviceClaim {
  userId: string;
  deviceId: string;
}

/**
 * A device row the account was shown to hold, as the session that claimed it
 * reads it: the platform the row named, and nothing where it named a word
 * this build does not know. It is the one place the caller's platform is
 * read, since the row is the account's own and the header the caller sent
 * names an id and never a platform.
 */
interface HeldVoiceDevice {
  readonly platform: DevicePlatform | undefined;
}

/** A live session as the account that opened it names it. */
interface VoiceSessionOwnership {
  userId: string;
  sessionId: string;
}

/** A live session the account was shown to have opened: the plan its creation bound it to, if it was a planning call. */
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

export interface VoiceSessionRecord {
  /**
   * Writes the session down and answers the store's own id for its row, the
   * one a stored spoken row names as its `voice_session_id`, so the device
   * can tell its own rows from another session's; nothing where the live
   * session is already another account's, since the first owner keeps it.
   */
  register(input: VoiceSessionRegistration): VoiceSessionRecordEffect<string | undefined>;
  /** The device row the account holds under the id named, or nothing: the check the door makes before a session is spent on the claim. */
  heldDevice(input: VoiceSessionDeviceClaim): VoiceSessionRecordEffect<HeldVoiceDevice | undefined>;
  /** Whether the account holds the plan named: the check the door makes before a planning call is spent. */
  heldPlan(input: VoiceSessionPlanClaim): VoiceSessionRecordEffect<boolean>;
  /** The live session named, where the account created it, with the plan it was bound to: one lookup over the indexed pair. */
  owned(input: VoiceSessionOwnership): VoiceSessionRecordEffect<OwnedVoiceSession | undefined>;
  noteUsage(input: VoiceSessionUsage): VoiceSessionRecordEffect<void>;
  close(input: VoiceSessionClose): VoiceSessionRecordEffect<void>;
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
  deviceId: Schema.NullOr(Schema.String),
  planId: Schema.NullOr(Schema.String),
});

/**
 * The device id the row may carry, read back out of the account's own
 * `devices` rows rather than taken from the handshake: a claim on another
 * account's device, or on a row that has gone, selects nothing and the
 * column keeps the null that is its word for a session naming no device.
 * There is no builder spelling for a scalar subquery standing as an inserted
 * value, so it is a fragment over the same table, still inside the one
 * rendered statement and with both ids bound as its parameters.
 */
const heldDeviceId = (deviceId: string | null, userId: string) =>
  sql`(select ${devices.id} from ${devices} where ${devices.id} = ${deviceId} and ${devices.userId} = ${userId})`;

const registerSession = SqlSchema.void({
  Request: RegisterRequestSchema,
  execute: (row) =>
    db
      .insert(voiceSessions)
      .values({
        userId: row.userId,
        liveSessionId: row.liveSessionId,
        delegationMode: row.delegationMode,
        deviceId: heldDeviceId(row.deviceId, row.userId),
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

export function voiceSessionRecord(now: () => number = Date.now): VoiceSessionRecord {
  const usage = (seconds: number, confirmed: boolean) => ({ seconds, confirmed });
  return {
    register: (input) =>
      Effect.andThen(
        registerSession({
          userId: input.userId,
          liveSessionId: input.sessionId,
          delegationMode: VOICE_DELEGATION_MODE.CLIENT,
          deviceId: input.deviceId ?? null,
          planId: input.planId ?? null,
        }),
        Effect.map(
          findOwnedSession({ userId: input.userId, liveSessionId: input.sessionId }),
          Option.match({ onNone: () => undefined, onSome: (row) => row.id }),
        ),
      ),
    heldDevice: (input) =>
      Effect.map(
        findHeldDevice(input),
        Option.match({
          onNone: () => undefined,
          onSome: (row) => ({
            platform: isDevicePlatform(row.platform) ? row.platform : undefined,
          }),
        }),
      ),
    heldPlan: (input) => Effect.map(readPlan(input.userId, input.planId), Option.isSome),
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
  };
}
