import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { db } from "../core/query.js";
import { voiceAvatarSessions, voiceSessions } from "../schemas/voice.js";
import { AVATAR_END_REASON, type AvatarEndReason } from "../voice-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * voice-avatar-sessions.ts -- the LiveAvatar sessions a call showed, and the seconds each ran.
 *
 * Every function is an effect over the ambient `SqlClient`. A session is
 * opened against a voice session its account owns, and closed once: the
 * first close writes when and why it ended and the seconds it ran, and every
 * later close (the service's stop racing the hang-up, the sweep finding a
 * row the service already closed) changes nothing and answers those same
 * seconds. The open sessions of a call are read by the account that owns it.
 */

type AvatarSessionEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** An avatar session as the service that started it names it. */
export interface AvatarSessionOpening {
  readonly userId: string;
  readonly voiceSessionId: string;
  readonly liveAvatarSessionId: string;
  readonly startedAt: Date;
}

/** The close of an avatar session: when and why it ended. */
export interface AvatarSessionClosing {
  readonly liveAvatarSessionId: string;
  readonly endedAt: Date;
  readonly reason: AvatarEndReason;
}

/** A voice session as the account that owns it names it. */
export interface AvatarSessionsQuery {
  readonly userId: string;
  readonly voiceSessionId: string;
}

/** An avatar session still open, as a stop reads it. */
export interface OpenAvatarSession {
  readonly liveAvatarSessionId: string;
  readonly startedAt: Date;
}

const OpeningSchema = Schema.Struct({
  userId: Schema.String,
  voiceSessionId: Schema.String,
  liveAvatarSessionId: Schema.String,
  startedAt: Schema.Date,
});

/**
 * Note that the row is inserted from a select over the voice session, so a
 * voice session the account does not own opens nothing, and a LiveAvatar
 * session already recorded is not recorded twice.
 */
const insertOpening = SqlSchema.findOneOption({
  Request: OpeningSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (opening) =>
    db
      .insert(voiceAvatarSessions)
      .select(
        db
          .select({
            id: sql`gen_random_uuid()`.as("id"),
            voiceSessionId: voiceSessions.id,
            userId: voiceSessions.userId,
            liveAvatarSessionId: sql`${opening.liveAvatarSessionId}`.as("liveavatar_session_id"),
            startedAt: sql`${opening.startedAt.toISOString()}::timestamptz`.as("started_at"),
            endedAt: sql`null`.as("ended_at"),
            seconds: sql`null`.as("seconds"),
            endReason: sql`null`.as("end_reason"),
          })
          .from(voiceSessions)
          .where(
            and(
              eq(voiceSessions.id, opening.voiceSessionId),
              eq(voiceSessions.userId, opening.userId),
            ),
          ),
      )
      .onConflictDoNothing({ target: voiceAvatarSessions.liveAvatarSessionId })
      .returning({ id: voiceAvatarSessions.id }),
});

const ClosingSchema = Schema.Struct({
  liveAvatarSessionId: Schema.String,
  endedAt: Schema.Date,
  reason: Schema.Literals(Object.values(AVATAR_END_REASON)),
});

const SecondsRowSchema = Schema.Struct({ seconds: Schema.Number });

/** Writes the close of a row still open, its seconds rounded up from start to end and never below zero. */
const writeClosing = SqlSchema.findOneOption({
  Request: ClosingSchema,
  Result: SecondsRowSchema,
  execute: (closing) => {
    const endedAt = sql`${closing.endedAt.toISOString()}::timestamptz`;
    return db
      .update(voiceAvatarSessions)
      .set({
        endedAt: closing.endedAt,
        endReason: closing.reason,
        seconds: sql`greatest(0, ceil(extract(epoch from (${endedAt} - ${voiceAvatarSessions.startedAt}))))::integer`,
      })
      .where(
        and(
          eq(voiceAvatarSessions.liveAvatarSessionId, closing.liveAvatarSessionId),
          isNull(voiceAvatarSessions.endedAt),
        ),
      )
      .returning({ seconds: sql<number>`${voiceAvatarSessions.seconds}` });
  },
});

const findClosedSeconds = SqlSchema.findOneOption({
  Request: Schema.Struct({ liveAvatarSessionId: Schema.String }),
  Result: SecondsRowSchema,
  execute: ({ liveAvatarSessionId }) =>
    db
      .select({ seconds: sql<number>`${voiceAvatarSessions.seconds}` })
      .from(voiceAvatarSessions)
      .where(
        and(
          eq(voiceAvatarSessions.liveAvatarSessionId, liveAvatarSessionId),
          isNotNull(voiceAvatarSessions.seconds),
        ),
      ),
});

const findOpen = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, voiceSessionId: Schema.String }),
  Result: Schema.Struct({ liveAvatarSessionId: Schema.String, startedAt: InstantColumnSchema }),
  execute: ({ userId, voiceSessionId }) =>
    db
      .select({
        liveAvatarSessionId: voiceAvatarSessions.liveAvatarSessionId,
        startedAt: voiceAvatarSessions.startedAt,
      })
      .from(voiceAvatarSessions)
      .where(
        and(
          eq(voiceAvatarSessions.voiceSessionId, voiceSessionId),
          eq(voiceAvatarSessions.userId, userId),
          isNull(voiceAvatarSessions.endedAt),
        ),
      )
      .orderBy(asc(voiceAvatarSessions.startedAt)),
});

/**
 * Records an avatar session as started on the voice session named, and
 * answers the row's id; nothing where the account does not own that voice
 * session or the LiveAvatar session is already recorded.
 */
export function openAvatarSession(
  opening: AvatarSessionOpening,
): AvatarSessionEffect<Option.Option<string>> {
  return Effect.map(
    insertOpening(opening),
    Option.map((row) => row.id),
  );
}

/**
 * Closes the avatar session named and answers the seconds it ran: the first
 * close writes them, and a later one answers what the first wrote. Nothing
 * where no row names that LiveAvatar session.
 */
export function closeAvatarSession(
  closing: AvatarSessionClosing,
): AvatarSessionEffect<Option.Option<number>> {
  return Effect.gen(function* () {
    const closed = yield* writeClosing(closing);
    const row = Option.isSome(closed)
      ? closed
      : yield* findClosedSeconds({ liveAvatarSessionId: closing.liveAvatarSessionId });
    return Option.map(row, (found) => found.seconds);
  });
}

/** The avatar sessions still open on the account's voice session, oldest first. */
export function openAvatarSessionsOf(
  query: AvatarSessionsQuery,
): AvatarSessionEffect<readonly OpenAvatarSession[]> {
  return findOpen(query);
}
