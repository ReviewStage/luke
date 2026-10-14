import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type {
  AvatarEndReason,
  VOICE_DELEGATION_MODE,
  VoiceCloseReason,
  VoiceSegmentRole,
} from "../voice-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

/**
 * Voice, stored the way a call platform stores a call: one row per live
 * session and the timed segments of what was said on it. Nothing spoken is
 * ever a message. The brain's reply is the assistant message the model's
 * context replays; what the voice actually said is a paraphrase of it, and
 * the paraphrase lives here as segments (role, text, start and end on the
 * session's own clock) and nowhere else. No audio is ever stored.
 *
 * These tables stand beside the storage rework's conversation tables in
 * `storage.ts`, keyed by the user and cascading with the account, and
 * a session's segments cascade with the session. The vocabularies the two
 * text columns are held to live in `voice-vocabulary.ts`, which the writer
 * and the session record read as well, so a column's union and a caller's
 * constant are the one set of words.
 */

/** Who the session hands a delegation to; `voice-vocabulary.ts` holds the words. */
type VoiceDelegationMode = (typeof VOICE_DELEGATION_MODE)[keyof typeof VOICE_DELEGATION_MODE];

/**
 * What a session cost, as the Live API bills it: by session time. The API
 * bills the elapsed seconds even when the session never delivered a clean
 * `session.closed` — a connection lost, or a close that never arrived — so a
 * writer with only a number would have to record zero, understating a real
 * bill, or record its estimate as though the API had confirmed it. The flag
 * keeps the two apart: `confirmed` seconds are the API's own count from its
 * usage event, unconfirmed ones the writer's elapsed estimate.
 */
export interface VoiceSessionUsage {
  readonly seconds: number;
  readonly confirmed: boolean;
}

/**
 * One live session. `live_session_id` is the Live API's own id for it, and
 * it is unique: one live session is one row, so a client re-attaching to the
 * same live session on a fresh function instance finds the row it had rather
 * than forking the record. The pair over the user and that id is indexed
 * because a re-attach is checked against it — the user asking must own the
 * live session named — and an ownership check has to be one lookup. The
 * device is a plain column, as on `events`, because a device row goes at
 * sign-out and a session's record should not go with it.
 */
export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The `devices` row's id an earlier build's session named; nothing writes it any more. */
    deviceId: text("device_id"),
    /**
     * The plan the call was opened about; null only for a session an
     * earlier build opened with none, which a re-attach refuses. A plain
     * column rather than a reference: a session is bound to its plan for its
     * whole life, so a re-attach after the plan was deleted must still read
     * the binding and find no plan to land in. The session goes once it has
     * ended: with the plan's delete, or the sweep after it (`soft-delete.ts`).
     */
    planId: uuid("plan_id"),
    liveSessionId: text("live_session_id").notNull().unique(),
    delegationMode: text("delegation_mode").$type<VoiceDelegationMode>().notNull(),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    closedAt: timestamptz("closed_at"),
    closeReason: text("close_reason").$type<VoiceCloseReason>(),
    usage: jsonb("usage").$type<VoiceSessionUsage>(),
    /** The Live API model the session was created on; null only for a row an earlier build wrote. */
    model: text("model"),
    /**
     * When the device's socket last went without a hang-up, leaving the
     * WebRTC session standing for a re-attach; null while a connection holds
     * the session, and cleared by the re-attach. An open row stamped longer
     * ago than the grace is an orphan the scheduled sweep closes.
     */
    detachedAt: timestamptz("detached_at"),
    /**
     * Which connection holds the session now: minted by the connection that
     * created it or last re-attached to it, so a detach the connection it
     * replaced writes late cannot stamp a session a newer connection holds;
     * null only for a row an earlier build wrote.
     */
    attachId: text("attach_id"),
  },
  (table) => [
    index("voice_sessions_by_owner").on(table.userId, table.liveSessionId),
    index("voice_sessions_detached")
      .on(table.detachedAt)
      .where(sql`${table.closedAt} is null and ${table.detachedAt} is not null`),
  ],
);

/**
 * One spoken segment of a session: who spoke, the words, and the span on the
 * session's own clock in milliseconds. `seq` orders the segments within the
 * session and is its key beside the session id, so two writers placing a
 * segment at one position fail loudly rather than leaving two.
 */
export const voiceTranscriptSegments = pgTable(
  "voice_transcript_segments",
  {
    voiceSessionId: uuid("voice_session_id")
      .notNull()
      .references(() => voiceSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<VoiceSegmentRole>().notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.voiceSessionId, table.seq] })],
);

/**
 * One Keyframe avatar session shown on a call: the face a voice session
 * streamed Luke's voice to, on the stock persona named. Keyframe answers no
 * session id of its own, so the row is addressed by its own id, which the
 * service holds for as long as the avatar stands. A row is open while
 * `ended_at` is null; the first close writes when and why it ended and the
 * seconds it ran, which are an estimate from start to end rather than
 * Keyframe's own count. A row cascades with its voice session and its
 * account.
 */
export const voiceAvatarSessions = pgTable(
  "voice_avatar_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voiceSessionId: uuid("voice_session_id")
      .notNull()
      .references(() => voiceSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    personaId: text("persona_id").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at"),
    /** Whole seconds from start to end, rounded up; written once, by the first close. */
    seconds: integer("seconds"),
    endReason: text("end_reason").$type<AvatarEndReason>(),
  },
  (table) => [
    index("voice_avatar_sessions_open")
      .on(table.voiceSessionId)
      .where(sql`${table.endedAt} is null`),
  ],
);
