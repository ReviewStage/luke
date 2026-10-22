import {
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
  TRANSCRIPT_SPEAKER,
  type TranscriptSpeaker,
} from "@luke/live";
import {
  type AssistantMessageMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SpokenAskMetadata,
} from "@luke/wire";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  Database,
  type DatabaseServices,
  type DatabaseShape,
  type QueryError,
} from "../core/query.js";
import { conversations } from "../schemas/storage.js";
import { voiceSessions, voiceTranscriptSegments } from "../schemas/voice.js";
import { MESSAGE_SENDER } from "../storage-vocabulary.js";
import { VOICE_SEGMENT_ROLE, type VoiceSegmentRole } from "../voice-vocabulary.js";
import {
  type ConversationTarget,
  type SpokenAskAttach,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "./writer.js";

/**
 * The voice writer: what a GPT Live session's event stream leaves in the
 * record. It writes the tables the plan gives the voice and no other — the
 * timed segments of what was actually said, by whom, in milliseconds on the
 * session's own clock, and each speaker's utterance as a row of the
 * conversation. The
 * `voice_sessions` row itself is another writer's: the voice service creates
 * it when it creates the session and closes it on `session.closed`, and this
 * writer only reads it for its id, so a session whose row it cannot find is
 * refused rather than invented.
 *
 * The row's own state decides nothing here. A function instance dies at its
 * duration bound without a `session.closed`, and the desktop re-attaches to
 * the same live session on a fresh instance, landing on the same row; so a
 * row with `closed_at` null may still gain segments, a row that has segments
 * is not thereby closed, and nothing this writer keeps between events lives
 * anywhere but the record: a row's words are read back from the segments
 * already written over the span the service names.
 *
 * What is spoken becomes a message through one door, `upsertSpokenRow`,
 * called by the live session service behind each fragment: the row is named
 * by the id the service's ledger minted when the utterance opened, which is
 * its client id for life, and the span the ledger holds it at, and the write
 * cuts the words from the segments already on record over that span. The
 * first write inserts the row; each later one grows it in place — its parts,
 * its span's end, its finish, its revision — so a socket closing mid-sentence
 * leaves the words said so far on the row, and a row on a device grows rather
 * than being drawn twice. The developer's utterance is a user row on the
 * voice channel naming the session and its span. A delegation cuts nothing
 * and re-keys nothing: the service decides from its ledger which developer
 * rows the delegation is about and names them here (`attachSpokenAsk`), and
 * the store gives those rows the delegation in place, so the ask's rows keep
 * their ids and keep growing after the handover. Every utterance of Luke's is
 * an assistant row authored by the voice model, whatever prompted the words —
 * an answer he gave himself, what he said before handing an ask to the brain,
 * the brain's reply read aloud, the opening — so the record shows what the developer
 * actually heard, and a reading stands beside the message it was read from
 * rather than in place of it. Segments may overlap, because timed deltas do,
 * and no audio is ever stored.
 *
 * Every statement here is an `Effect` over the ambient `SqlClient`, decoded
 * by a `Schema` rather than trusted, and answered as an effect to whoever
 * composed the writer; the position a segment takes is allocated inside the
 * session row's own lock, which is the transaction the client opens.
 */

/** The live session a stream belongs to, and the conversation its asks belong to. */
export interface VoiceTarget {
  readonly userId: string;
  readonly liveSessionId: string;
  readonly conversation: ConversationTarget;
}

export const VOICE_WRITE_REFUSAL = {
  /** No `voice_sessions` row stands for this account and live session. */
  NO_SESSION: "no_session",
  NO_CONVERSATION: STORE_WRITE_REFUSAL.NO_CONVERSATION,
  MESSAGE_REFUSED: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
} as const;

type VoiceWriteRefusal = (typeof VOICE_WRITE_REFUSAL)[keyof typeof VOICE_WRITE_REFUSAL];

type VoiceWriteEffect = (typeof STORE_WRITE_EFFECT)[keyof typeof STORE_WRITE_EFFECT];

/** What a live event did to the record, or why the record refused it. */
export type VoiceWriteResult = Result.Result<VoiceWriteEffect, VoiceWriteRefusal>;

const IGNORED: VoiceWriteResult = Result.succeed(STORE_WRITE_EFFECT.IGNORED);
const WRITTEN: VoiceWriteResult = Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
const NO_SESSION: VoiceWriteResult = Result.fail(VOICE_WRITE_REFUSAL.NO_SESSION);

/** The span one utterance covers on the session's own clock, as the ledger grouped it. */
interface SpokenUtteranceSpan {
  readonly startMs: number;
  readonly endMs: number;
}

/** One speaker's row as the service's ledger holds it now: the id it minted for the row, and the span the words are read over. */
interface SpokenRowWrite extends SpokenUtteranceSpan {
  readonly rowId: string;
  readonly speaker: TranscriptSpeaker;
}

/** A line the developer typed into the call, under the id the service minted for its ask, at the instant on the call's clock it was typed. */
interface TypedRowWrite {
  readonly rowId: string;
  readonly text: string;
  readonly atMs: number;
}

export interface VoiceWriter {
  /** Consumes one server event of the live session's stream. */
  consume(
    target: VoiceTarget,
    event: LiveServerEvent,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices>;
  /** One speaker's utterance as it stands: inserted under the ledger's id on first sight, grown in place after, cut from the session's segments over its span each time. */
  upsertSpokenRow(
    target: VoiceTarget,
    row: SpokenRowWrite,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices>;
  /**
   * The developer's rows a delegation is about take that delegation, and its
   * turn where the ask has learned one. The service names the rows by the
   * ids its ledger minted, having written each as it stands; the store gives
   * them the delegation in place. Nothing is cut here: a row's words are what
   * its own writes left, and it keeps growing under its own id. Written where
   * any named row stands on record and took the delegation, or already had
   * it; ignored where none does.
   */
  attachSpokenAsk(
    target: VoiceTarget,
    attach: SpokenAskAttach,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices>;
  /**
   * A line the developer typed into the call: one typed row, sent by the
   * member on the call, naming the session and the instant it was typed at,
   * so Luke's words after it read as following it. Nothing of it is a
   * segment, since nothing of it was said.
   */
  writeTypedRow(
    target: VoiceTarget,
    row: TypedRowWrite,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices>;
}

interface VoiceWriterOptions {
  /** The messages writer, which the spoken rows and the spoken ask go through. */
  readonly store: StoreWriter;
}

type SegmentDelta = Extract<
  LiveServerEvent,
  {
    type:
      | typeof LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA
      | typeof LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA;
  }
>;

const SEGMENT_ROLE_OF_DELTA = {
  [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA]: VOICE_SEGMENT_ROLE.USER,
  [LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA]: VOICE_SEGMENT_ROLE.ASSISTANT,
} as const satisfies Record<SegmentDelta["type"], VoiceSegmentRole>;

/** Whose segments a speaker's row is cut from. */
const SEGMENT_ROLE_OF_SPEAKER = {
  [TRANSCRIPT_SPEAKER.USER]: VOICE_SEGMENT_ROLE.USER,
  [TRANSCRIPT_SPEAKER.ASSISTANT]: VOICE_SEGMENT_ROLE.ASSISTANT,
} as const satisfies Record<TranscriptSpeaker, VoiceSegmentRole>;

/** How a statement here fails: the driver's own refusal, or a row the schema refused. */
type VoiceWriteFailure = QueryError | Schema.SchemaError;

/** The store's answer to a row write, as this writer reports it: written or grown is written, a refusal is the store's own. */
const upserted = <E, R>(
  write: Effect.Effect<Result.Result<unknown, { readonly refusal: VoiceWriteRefusal }>, E, R>,
): Effect.Effect<VoiceWriteResult, E, R> =>
  Effect.map(write, (written) =>
    Result.isSuccess(written) ? WRITTEN : Result.fail(written.failure.refusal),
  );

const VoiceSessionKeySchema = Schema.Struct({
  userId: Schema.String,
  liveSessionId: Schema.String,
});

/** The `voice_sessions` row this writer reads: its id. */
const VoiceSessionRowSchema = Schema.Struct({ id: Schema.String });

/** The `voice_sessions` row read by its account and the Live API's own id for it, locked or not. */
const voiceSessionOf = (db: DatabaseShape, key: { userId: string; liveSessionId: string }) =>
  db
    .select({ id: voiceSessions.id })
    .from(voiceSessions)
    .where(
      and(eq(voiceSessions.userId, key.userId), eq(voiceSessions.liveSessionId, key.liveSessionId)),
    );

type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;

const VoiceSegmentRoleSchema = Schema.Literals(Object.values(VOICE_SEGMENT_ROLE));

const findVoiceSession = SqlSchema.findOneOption({
  Request: VoiceSessionKeySchema,
  Result: VoiceSessionRowSchema,
  execute: (key) => Database.use((db) => voiceSessionOf(db, key)),
});

/** The same row, locked, where the caller is about to take a position in the session's sequence. */
const lockVoiceSession = SqlSchema.findOneOption({
  Request: VoiceSessionKeySchema,
  Result: VoiceSessionRowSchema,
  execute: (key) => Database.use((db) => voiceSessionOf(db, key).for("update")),
});

/** The call's conversation where it still stands, unstamped by a delete. */
const findStandingConversation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: VoiceSessionRowSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt))),
    ),
});

/** The session's last position, zero where it holds no segment yet; the builder has no spelling for that fallback, so it is a fragment. */
const LAST_SEGMENT_SEQ = sql<number>`coalesce(max(${voiceTranscriptSegments.seq}), 0)::int`;

const findLastSegmentSeq = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (voiceSessionId) =>
    Database.use((db) =>
      db
        .select({ seq: LAST_SEGMENT_SEQ })
        .from(voiceTranscriptSegments)
        .where(eq(voiceTranscriptSegments.voiceSessionId, voiceSessionId)),
    ),
});

const insertSegment = SqlSchema.void({
  Request: Schema.Struct({
    voiceSessionId: Schema.String,
    seq: Schema.Int,
    role: VoiceSegmentRoleSchema,
    text: Schema.String,
    startMs: Schema.Int,
    endMs: Schema.Int,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(voiceTranscriptSegments).values({
        voiceSessionId: row.voiceSessionId,
        seq: row.seq,
        role: row.role,
        text: row.text,
        startMs: row.startMs,
        endMs: row.endMs,
      }),
    ),
});

/** One speaker's segments of one session over an utterance's span, both ends included, in the order the deltas came. */
const findUtteranceSegments = SqlSchema.findAll({
  Request: Schema.Struct({
    voiceSessionId: Schema.String,
    role: VoiceSegmentRoleSchema,
    startMs: Schema.Int,
    endMs: Schema.Int,
  }),
  Result: Schema.Struct({
    text: Schema.String,
    startMs: Schema.Number,
  }),
  execute: (request) =>
    Database.use((db) =>
      db
        .select({ text: voiceTranscriptSegments.text, startMs: voiceTranscriptSegments.startMs })
        .from(voiceTranscriptSegments)
        .where(
          and(
            eq(voiceTranscriptSegments.voiceSessionId, request.voiceSessionId),
            eq(voiceTranscriptSegments.role, request.role),
            gte(voiceTranscriptSegments.startMs, request.startMs),
            lte(voiceTranscriptSegments.startMs, request.endMs),
          ),
        )
        .orderBy(asc(voiceTranscriptSegments.seq)),
    ),
});

export function voiceWriter({ store }: VoiceWriterOptions): VoiceWriter {
  /** One segment, at the next position of the session's own sequence; the primary key is the backstop. Answers the session row. */
  function appendSegment(
    target: VoiceTarget,
    delta: SegmentDelta,
  ): Effect.Effect<Option.Option<VoiceSessionRow>, VoiceWriteFailure, DatabaseServices> {
    return Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.withTransaction(
        Effect.gen(function* () {
          const voiceSession = yield* lockVoiceSession({
            userId: target.userId,
            liveSessionId: target.liveSessionId,
          });
          if (Option.isNone(voiceSession)) return voiceSession;
          // Note that a call into an agent deleted since takes no more words: the delete took the
          // ones it had, under this same row's lock (`deleteCodingAgent`), so a word racing it
          // either landed first and went with them, or waited and finds the conversation stamped.
          const standing = yield* findStandingConversation(target.conversation.conversationId);
          if (Option.isNone(standing)) return Option.none();
          const last = yield* findLastSegmentSeq(voiceSession.value.id);
          yield* insertSegment({
            voiceSessionId: voiceSession.value.id,
            seq: Option.match(last, { onNone: () => 0, onSome: (row) => row.seq }) + 1,
            role: SEGMENT_ROLE_OF_DELTA[delta.type],
            text: delta.delta,
            startMs: delta.start_ms,
            endMs: delta.end_ms,
          });
          return voiceSession;
        }),
      ),
    );
  }

  /**
   * One speaker's utterance as the service's ledger holds it: its own
   * segments over the span, joined as the deltas came, on the voice channel
   * naming the session and the span. The developer's is a user row with no
   * delegation; Luke's is an assistant row authored by the voice model, whose
   * metadata names the delegation the words followed where the developer's
   * latest line before them was handed to the brain, so the store can read
   * what the words were read from and the Conversation can fold that message
   * behind the words actually said while the record keeps both. The row is
   * inserted under the ledger's id on first sight and grown in place after;
   * a span that holds no segment on record writes nothing, since the words
   * are not there to write.
   */
  function upsertSpokenRow(
    target: VoiceTarget,
    row: SpokenRowWrite,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices> {
    return Effect.gen(function* () {
      const voiceSession = yield* findVoiceSession({
        userId: target.userId,
        liveSessionId: target.liveSessionId,
      });
      if (Option.isNone(voiceSession)) return NO_SESSION;
      const voiceSessionId = voiceSession.value.id;
      const spoken = yield* findUtteranceSegments({
        voiceSessionId,
        role: SEGMENT_ROLE_OF_SPEAKER[row.speaker],
        startMs: row.startMs,
        endMs: row.endMs,
      });
      const text = spoken.map((segment) => segment.text).join("");
      if (text.length === 0) return IGNORED;
      const span = {
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: voiceSessionId,
        from_ms: Math.min(...spoken.map((segment) => segment.startMs)),
        to_ms: row.endMs,
      } as const;
      if (row.speaker === TRANSCRIPT_SPEAKER.USER) {
        const metadata: SpokenAskMetadata = { author: MESSAGE_AUTHOR.DEVELOPER, ...span };
        return yield* upserted(
          store.upsertSpokenRow(target.conversation, {
            clientId: row.rowId,
            role: MESSAGE_ROLE.USER,
            text,
            metadata,
          }),
        );
      }
      // The developer's latest line before the words, where one was handed to the brain, names the
      // delegation the words followed; the store reads from that what the words were read from.
      const latest = yield* store.latestSpokenLine(target.conversation, {
        voiceSessionId,
        startingAtOrBeforeMs: row.startMs,
      });
      if (Result.isFailure(latest)) return Result.fail(latest.failure.refusal);
      const delegationId = Option.getOrUndefined(latest.success)?.delegationId;
      const metadata: AssistantMessageMetadata = {
        author: MESSAGE_AUTHOR.VOICE_MODEL,
        ...span,
        ...(delegationId === undefined ? undefined : { delegation_id: delegationId }),
      };
      return yield* upserted(
        store.upsertSpokenRow(target.conversation, {
          clientId: row.rowId,
          role: MESSAGE_ROLE.ASSISTANT,
          text,
          metadata,
        }),
      );
    });
  }

  /** The store's answer to an attach, as this writer reports it: rows found and given the delegation is written; none is ignored. */
  function attachSpokenAsk(
    target: VoiceTarget,
    attach: SpokenAskAttach,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices> {
    return Effect.map(store.attachSpokenAsk(target.conversation, attach), (attached) =>
      Result.isSuccess(attached)
        ? attached.success.length > 0
          ? WRITTEN
          : IGNORED
        : Result.fail(attached.failure.refusal),
    );
  }

  function writeTypedRow(
    target: VoiceTarget,
    row: TypedRowWrite,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, DatabaseServices> {
    return Effect.gen(function* () {
      const voiceSession = yield* findVoiceSession({
        userId: target.userId,
        liveSessionId: target.liveSessionId,
      });
      if (Option.isNone(voiceSession)) return NO_SESSION;
      return yield* upserted(
        store.writeTypedCallLine(target.conversation, {
          clientId: row.rowId,
          text: row.text,
          metadata: {
            author: MESSAGE_AUTHOR.DEVELOPER,
            channel: MESSAGE_CHANNEL.TYPED,
            voice_session_id: voiceSession.value.id,
            from_ms: Math.max(0, Math.round(row.atMs)),
          },
          sender: { kind: MESSAGE_SENDER.MEMBER, userId: target.userId },
        }),
      );
    });
  }

  return {
    upsertSpokenRow,
    attachSpokenAsk,
    writeTypedRow,
    consume: (target, event) =>
      Effect.gen(function* () {
        switch (event.type) {
          case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
          case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA:
            return Option.isNone(yield* appendSegment(target, event)) ? NO_SESSION : WRITTEN;
          default:
            return IGNORED;
        }
      }),
  };
}
