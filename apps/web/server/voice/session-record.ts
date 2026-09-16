import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { type DevicePlatform, isDevicePlatform } from "../core.js";
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
 * The device the session names is the one the handshake claimed, a Mac's row
 * or a phone's alike, and the write can name only a `devices` row the same
 * account holds: the id is read back out of that table under the account, so
 * a claim on another account's device, or on a row that has gone, leaves the
 * column null — the column's own word for a session that names no device —
 * and a briefing on offer stays unclaimed rather than claimed as someone
 * else's.
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
  /** Whether the account created the live session named: one lookup over the indexed pair. */
  owned(input: VoiceSessionOwnership): VoiceSessionRecordEffect<boolean>;
  noteUsage(input: VoiceSessionUsage): VoiceSessionRecordEffect<void>;
  close(input: VoiceSessionClose): VoiceSessionRecordEffect<void>;
}

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

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

const findOwnedSession = SqlSchema.findOneOption({
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
  usage: Schema.fromJsonString(VoiceUsageColumnSchema),
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
  closedAt: Schema.Date,
  closeReason: VoiceCloseReasonSchema,
  usage: Schema.fromJsonString(VoiceUsageColumnSchema),
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
      Effect.andThen(
        registerSession({
          userId: input.userId,
          liveSessionId: input.sessionId,
          delegationMode: VOICE_DELEGATION_MODE.CLIENT,
          deviceId: input.deviceId ?? null,
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
