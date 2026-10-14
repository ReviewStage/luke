import { and, asc, eq, isNotNull, isNull, lte, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { voiceAvatarSessions, voiceSessions } from "../schemas/voice.js";
import { AVATAR_END_REASON, type AvatarEndReason } from "../voice-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";

/**
 * voice-avatar-sessions.ts -- the Keyframe avatar sessions a call showed, and the seconds each ran.
 *
 * Every function is an effect over the ambient `SqlClient`. A session is
 * opened against a voice session its account owns, and closed once: the
 * first close writes when and why it ended and the seconds it ran, and every
 * later close (the service's stop racing the hang-up, the sweep finding a
 * row the service already closed) changes nothing and answers those same
 * seconds. Keyframe answers no session id, so a row is named by its own id,
 * and the seconds are the elapsed estimate rather than Keyframe's count.
 */

type AvatarSessionEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** An avatar session as the service that started it names it. */
export interface AvatarSessionOpening {
  readonly userId: string;
  readonly voiceSessionId: string;
  readonly personaId: string;
  readonly startedAt: Date;
}

/** The close of one avatar session: which row, when, and why. */
export interface AvatarSessionClosing {
  readonly id: string;
  readonly endedAt: Date;
  readonly reason: AvatarEndReason;
}

/** The close of every avatar session still open on a voice session. */
export interface OpenAvatarSessionsClosing {
  readonly voiceSessionId: string;
  readonly endedAt: Date;
  readonly reason: AvatarEndReason;
  /** Only the sessions started at or before this instant; every open one where absent. */
  readonly startedBy?: Date | undefined;
}

/** A voice session as the account that owns it names it. */
export interface AvatarSessionsQuery {
  readonly userId: string;
  readonly voiceSessionId: string;
}

/** An avatar session still open, as a reader sees it. */
export interface OpenAvatarSession {
  readonly id: string;
  readonly personaId: string;
  readonly startedAt: Date;
}

const ReasonSchema = Schema.Literals(Object.values(AVATAR_END_REASON));

const IdRowSchema = Schema.Struct({ id: Schema.String });

const SecondsRowSchema = Schema.Struct({ seconds: Schema.Number });

/** Whole seconds from start to the instant given, rounded up and never below zero. */
function elapsedSeconds(endedAt: Date) {
  return elapsedSecondsTo(sql`${endedAt.toISOString()}::timestamptz`);
}

/** The same seconds, up to an instant the statement reads. */
function elapsedSecondsTo(end: SQL) {
  return sql`greatest(0, ceil(extract(epoch from (${end} - ${voiceAvatarSessions.startedAt}))))::integer`;
}

/**
 * Note that the row is inserted from a select over the voice session, so a
 * voice session the account does not own, or one already closed, opens
 * nothing. The select shares a lock on the voice session row, because a
 * close racing the open must land either before it (and the open sees the
 * close) or after it (and the close's sweep of open avatars sees the row).
 */
const insertOpening = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    voiceSessionId: Schema.String,
    personaId: Schema.String,
    startedAt: Schema.Date,
  }),
  Result: IdRowSchema,
  execute: (opening) =>
    Database.use((db) =>
      db
        .insert(voiceAvatarSessions)
        .select(
          queryBuilder
            .select({
              id: sql`gen_random_uuid()`.as("id"),
              voiceSessionId: voiceSessions.id,
              userId: voiceSessions.userId,
              personaId: sql`${opening.personaId}`.as("persona_id"),
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
                isNull(voiceSessions.closedAt),
              ),
            )
            .for("share"),
        )
        .returning({ id: voiceAvatarSessions.id }),
    ),
});

const writeClosing = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String, endedAt: Schema.Date, reason: ReasonSchema }),
  Result: SecondsRowSchema,
  execute: (closing) =>
    Database.use((db) =>
      db
        .update(voiceAvatarSessions)
        .set({
          endedAt: closing.endedAt,
          endReason: closing.reason,
          seconds: elapsedSeconds(closing.endedAt),
        })
        .where(and(eq(voiceAvatarSessions.id, closing.id), isNull(voiceAvatarSessions.endedAt)))
        .returning({ seconds: sql<number>`${voiceAvatarSessions.seconds}` }),
    ),
});

const findClosedSeconds = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String }),
  Result: SecondsRowSchema,
  execute: ({ id }) =>
    Database.use((db) =>
      db
        .select({ seconds: sql<number>`${voiceAvatarSessions.seconds}` })
        .from(voiceAvatarSessions)
        .where(and(eq(voiceAvatarSessions.id, id), isNotNull(voiceAvatarSessions.seconds))),
    ),
});

const writeClosingOf = SqlSchema.findAll({
  Request: Schema.Struct({
    voiceSessionId: Schema.String,
    endedAt: Schema.Date,
    reason: ReasonSchema,
    startedBy: Schema.optional(Schema.Date),
  }),
  Result: IdRowSchema,
  execute: (closing) =>
    Database.use((db) =>
      db
        .update(voiceAvatarSessions)
        .set({
          endedAt: closing.endedAt,
          endReason: closing.reason,
          seconds: elapsedSeconds(closing.endedAt),
        })
        .where(
          and(
            eq(voiceAvatarSessions.voiceSessionId, closing.voiceSessionId),
            isNull(voiceAvatarSessions.endedAt),
            closing.startedBy === undefined
              ? undefined
              : lte(voiceAvatarSessions.startedAt, closing.startedBy),
          ),
        )
        .returning({ id: voiceAvatarSessions.id }),
    ),
});

/**
 * Note that the close is the voice session's own instant, read in the same
 * statement, so a row closed late says when the call ended rather than when
 * it was found.
 */
const writeClosingOfEndedCalls = SqlSchema.findAll({
  Request: Schema.Void,
  Result: IdRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .update(voiceAvatarSessions)
        .set({
          endedAt: sql`${voiceSessions.closedAt}`,
          endReason: AVATAR_END_REASON.CALL_ENDED,
          seconds: elapsedSecondsTo(sql`${voiceSessions.closedAt}`),
        })
        .from(voiceSessions)
        .where(
          and(
            eq(voiceSessions.id, voiceAvatarSessions.voiceSessionId),
            isNotNull(voiceSessions.closedAt),
            isNull(voiceAvatarSessions.endedAt),
          ),
        )
        .returning({ id: voiceAvatarSessions.id }),
    ),
});

const findOpen = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, voiceSessionId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    personaId: Schema.String,
    startedAt: InstantColumnSchema,
  }),
  execute: ({ userId, voiceSessionId }) =>
    Database.use((db) =>
      db
        .select({
          id: voiceAvatarSessions.id,
          personaId: voiceAvatarSessions.personaId,
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
    ),
});

/**
 * Records an avatar session as started on the voice session named, and
 * answers the row's id; nothing where the account does not own that voice
 * session or it has already closed.
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
 * where no row has that id.
 */
export function closeAvatarSession(
  closing: AvatarSessionClosing,
): AvatarSessionEffect<Option.Option<number>> {
  return Effect.gen(function* () {
    const closed = yield* writeClosing(closing);
    const row = Option.isSome(closed) ? closed : yield* findClosedSeconds({ id: closing.id });
    return Option.map(row, (found) => found.seconds);
  });
}

/**
 * Closes every avatar session still open on the voice session named, as a
 * hang-up or the sweep of an orphaned call does, and answers how many it
 * closed; a session already closed keeps its first close.
 */
export function closeOpenAvatarSessionsOf(
  closing: OpenAvatarSessionsClosing,
): AvatarSessionEffect<number> {
  return Effect.map(writeClosingOf(closing), (rows) => rows.length);
}

/**
 * Closes every avatar session still open on a voice session that has itself
 * closed, as of that close and as the call's end, and answers how many: the
 * sweep's repair for a close that landed on the voice row and not behind it.
 */
export function closeAvatarSessionsOfEndedCalls(): AvatarSessionEffect<number> {
  return Effect.map(writeClosingOfEndedCalls(undefined), (rows) => rows.length);
}

/** The avatar sessions still open on the account's voice session, oldest first. */
export function openAvatarSessionsOf(
  query: AvatarSessionsQuery,
): AvatarSessionEffect<readonly OpenAvatarSession[]> {
  return findOpen(query);
}
