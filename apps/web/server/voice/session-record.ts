import { Effect, Option, type ParseResult, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  type VoiceCloseReason,
} from "../db/voice-vocabulary.js";
import { findHeldDevice } from "../hosted/device-store.js";

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
 * The device the session names is the one the desktop's handshake claimed,
 * and the write can name only a `devices` row the same account holds: the
 * id is read back out of that table under the account, so a claim on
 * another account's device, or on a row that has gone, leaves the column
 * null — the column's own word for a session that names no device — and a
 * briefing on offer stays unclaimed rather than claimed as someone else's.
 */
/**
 * What every method answers: an effect over the ambient client, so the socket
 * that drives the record composes it into a fiber of its own and the edge
 * that owns the connection is the one that runs it.
 */
type VoiceSessionRecordEffect<A> = Effect.Effect<
  A,
  SqlError | ParseResult.ParseError,
  SqlClient.SqlClient
>;

/** The session as its creation names it: the account, the live session, and the device the handshake claimed, if any. */
interface VoiceSessionRegistration {
  userId: string;
  sessionId: string;
  deviceId?: string | undefined;
}

/** A device row as the account claiming it names it. */
interface VoiceSessionDeviceClaim {
  userId: string;
  deviceId: string;
}

/** A live session as the account that opened it names it. */
interface VoiceSessionOwnership {
  userId: string;
  sessionId: string;
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
  register(input: VoiceSessionRegistration): VoiceSessionRecordEffect<void>;
  /** Whether the account holds the device row named: the check the door makes before a session is spent on the claim. */
  deviceOwned(input: VoiceSessionDeviceClaim): VoiceSessionRecordEffect<boolean>;
  /** Whether the account created the live session named: one lookup over the indexed pair. */
  owned(input: VoiceSessionOwnership): VoiceSessionRecordEffect<boolean>;
  noteUsage(input: VoiceSessionUsage): VoiceSessionRecordEffect<void>;
  close(input: VoiceSessionClose): VoiceSessionRecordEffect<void>;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const VoiceCloseReasonSchema = Schema.Literal(...Object.values(VOICE_CLOSE_REASON));

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
});

const registerSession = SqlSchema.void({
  Request: RegisterRequestSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        insert into voice_sessions (user_id, live_session_id, delegation_mode, device_id)
        values (
          ${row.userId}, ${row.liveSessionId}, ${row.delegationMode},
          (select id from devices where id = ${row.deviceId} and user_id = ${row.userId})
        )
        on conflict (live_session_id) do nothing
      `,
    ),
});

const OwnedKeySchema = Schema.Struct({ userId: Schema.String, liveSessionId: Schema.String });
const OwnedRowSchema = Schema.Struct({ id: Schema.String });

const findOwnedSession = SqlSchema.findOne({
  Request: OwnedKeySchema,
  Result: OwnedRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id from voice_sessions
        where user_id = ${key.userId} and live_session_id = ${key.liveSessionId}
      `,
    ),
});

const NoteUsageRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  usage: Schema.parseJson(VoiceUsageColumnSchema),
});

const noteSessionUsage = SqlSchema.void({
  Request: NoteUsageRequestSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        update voice_sessions
        set usage = ${row.usage}::jsonb
        where live_session_id = ${row.liveSessionId} and closed_at is null
      `,
    ),
});

const CloseRequestSchema = Schema.Struct({
  liveSessionId: Schema.String,
  closedAt: Schema.DateFromSelf,
  closeReason: VoiceCloseReasonSchema,
  usage: Schema.parseJson(VoiceUsageColumnSchema),
});

const closeSession = SqlSchema.void({
  Request: CloseRequestSchema,
  execute: (row) =>
    statement(
      (sql) => sql`
        update voice_sessions
        set closed_at = ${row.closedAt}, close_reason = ${row.closeReason}, usage = ${row.usage}::jsonb
        where live_session_id = ${row.liveSessionId}
      `,
    ),
});

export function voiceSessionRecord(now: () => number = Date.now): VoiceSessionRecord {
  const usage = (seconds: number, confirmed: boolean) => ({ seconds, confirmed });
  return {
    register: (input) =>
      registerSession({
        userId: input.userId,
        liveSessionId: input.sessionId,
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        deviceId: input.deviceId ?? null,
      }),
    deviceOwned: (input) => Effect.map(findHeldDevice(input), Option.isSome),
    owned: (input) =>
      Effect.map(
        findOwnedSession({ userId: input.userId, liveSessionId: input.sessionId }),
        Option.isSome,
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
