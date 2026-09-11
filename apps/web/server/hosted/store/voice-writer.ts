import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, type SpokenAskMetadata } from "../../core.js";
import { VOICE_SEGMENT_ROLE, type VoiceSegmentRole } from "../../db/voice-schema.js";
import { LIVE_SERVER_EVENT, type LiveServerEvent } from "../../live.js";
import type { HostedStoreRun } from "./database.js";
import { markSpeechSpoken, SPEECH_REFUSAL } from "./speech.js";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "./writer.js";

/**
 * The voice writer: what a GPT Live session's event stream leaves in the
 * record. It writes the tables the plan gives the voice and no other — the
 * timed segments of what was actually said, by whom, in milliseconds on the
 * session's own clock; the `speech.spoken` transition that says a briefing
 * was heard rather than merely offered, taken through the speech module as
 * the device the session belongs to, so only a briefing that device claimed
 * is marked; and the one thing a voice session says
 * that is a message, the developer's own spoken ask, cut from the transcript
 * where a delegation places it. The `voice_sessions` row itself is another
 * writer's: the voice service creates it when it creates the session and
 * closes it on `session.closed`, and this writer only reads it for its id,
 * so a session whose row it cannot find is refused rather than invented.
 *
 * The row's own state decides nothing here. A function instance dies at its
 * duration bound without a `session.closed`, and the desktop re-attaches to
 * the same live session on a fresh instance, landing on the same row; so a
 * row with `closed_at` null may still gain segments, a row that has segments
 * is not thereby closed, and nothing this writer keeps between events lives
 * anywhere but the record: the ask a delegation cuts is read back from the
 * segments already written, from the previous ask's end on, and the only
 * memory kept in the process is which message a commentary append carried,
 * which the same connection that sent the append learns the answer to.
 *
 * Nothing spoken becomes a message. The brain's reply is the assistant
 * message the model's context replays; what the voice spoke of it is a
 * paraphrase, and it lives as segments. Segments may overlap, because timed
 * deltas do, and no audio is ever stored.
 *
 * Every statement here is an `Effect` over the ambient `SqlClient`, decoded
 * by a `Schema` rather than trusted, and run through the runner the edge that
 * composed the writer handed it; the position a segment takes is allocated
 * inside the session row's own lock, which is the transaction the client
 * opens.
 */

/** The live session a stream belongs to, and the conversation its asks and briefings belong to. */
export interface VoiceTarget {
  readonly userId: string;
  readonly liveSessionId: string;
  readonly conversation: ConversationTarget;
}

/** A commentary append the voice service sent, so the ack and the speech that follows can be tied to the message it carried. */
export interface CommentaryAppend {
  /** The client event id the append was sent with, which the `commentary.appended` ack names back. */
  readonly clientEventId: string;
  readonly messageId: string;
}

export const VOICE_WRITE_REFUSAL = {
  /** No `voice_sessions` row stands for this account and live session. */
  NO_SESSION: "no_session",
  NO_CONVERSATION: STORE_WRITE_REFUSAL.NO_CONVERSATION,
  NO_MESSAGE: STORE_WRITE_REFUSAL.NO_MESSAGE,
  MESSAGE_REFUSED: STORE_WRITE_REFUSAL.MESSAGE_REFUSED,
  /** The briefing was not this session's device's to say: nobody claimed it, another device did, or it had already ended. */
  NOT_CLAIMANT: SPEECH_REFUSAL.NOT_CLAIMANT,
} as const;

type VoiceWriteRefusal = (typeof VOICE_WRITE_REFUSAL)[keyof typeof VOICE_WRITE_REFUSAL];

type VoiceWriteEffect = (typeof STORE_WRITE_EFFECT)[keyof typeof STORE_WRITE_EFFECT];

export type VoiceWriteResult =
  | { readonly ok: true; readonly effect: VoiceWriteEffect }
  | { readonly ok: false; readonly refusal: VoiceWriteRefusal };

const IGNORED: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.IGNORED };
const WRITTEN: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };
const REPEATED: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.REPEATED };
const NO_SESSION: VoiceWriteResult = { ok: false, refusal: VOICE_WRITE_REFUSAL.NO_SESSION };

export interface VoiceWriter {
  /** Consumes one server event of the live session's stream. */
  consume(target: VoiceTarget, event: LiveServerEvent): Promise<VoiceWriteResult>;
  /** Tells the writer which message a commentary append carries, before the stream acknowledges it. */
  noteAppend(target: VoiceTarget, append: CommentaryAppend): void;
}

interface VoiceWriterOptions {
  /** The runner of the edge that composed the writer, which is what answers every statement below. */
  readonly run: HostedStoreRun;
  /** The messages and events writer, which the spoken ask and the speech event go through. */
  readonly store: StoreWriter;
}

/** An append the service sent, from the ack that placed it to the speech that followed it. */
interface PendingAppend {
  readonly messageId: string;
  readonly conversation: ConversationTarget;
  /** Where the appended commentary ends on the session's clock; unknown until the ack. */
  spokenFromMs?: number;
}

type SegmentDelta = Extract<
  LiveServerEvent,
  {
    type:
      | typeof LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA
      | typeof LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA;
  }
>;

type DelegationCreated = Extract<
  LiveServerEvent,
  { type: typeof LIVE_SERVER_EVENT.DELEGATION_CREATED }
>;

type CommentaryAppended = Extract<
  LiveServerEvent,
  { type: typeof LIVE_SERVER_EVENT.COMMENTARY_APPENDED }
>;

const SEGMENT_ROLE_OF_DELTA = {
  [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA]: VOICE_SEGMENT_ROLE.USER,
  [LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA]: VOICE_SEGMENT_ROLE.ASSISTANT,
} as const satisfies Record<SegmentDelta["type"], VoiceSegmentRole>;

/** How a statement here fails: the driver's own refusal, or a row the schema refused. */
type VoiceWriteFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const VoiceSessionKeySchema = Schema.Struct({
  userId: Schema.String,
  liveSessionId: Schema.String,
});

/** The `voice_sessions` row this writer reads: its id, and the device the session belongs to. */
const VoiceSessionRowSchema = Schema.Struct({
  id: Schema.String,
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
});

type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;

const VoiceSegmentRoleSchema = Schema.Literal(...Object.values(VOICE_SEGMENT_ROLE));

const findVoiceSession = SqlSchema.findOne({
  Request: VoiceSessionKeySchema,
  Result: VoiceSessionRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id, device_id
        from voice_sessions
        where user_id = ${key.userId} and live_session_id = ${key.liveSessionId}
      `,
    ),
});

/** The same row, locked, where the caller is about to take a position in the session's sequence. */
const lockVoiceSession = SqlSchema.findOne({
  Request: VoiceSessionKeySchema,
  Result: VoiceSessionRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id, device_id
        from voice_sessions
        where user_id = ${key.userId} and live_session_id = ${key.liveSessionId}
        for update
      `,
    ),
});

const findLastSegmentSeq = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: (voiceSessionId) =>
    statement(
      (sql) => sql`
        select coalesce(max(seq), 0)::int as seq
        from voice_transcript_segments
        where voice_session_id = ${voiceSessionId}
      `,
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
    statement(
      (sql) => sql`
        insert into voice_transcript_segments (voice_session_id, seq, role, text, start_ms, end_ms)
        values (
          ${row.voiceSessionId}, ${row.seq}, ${row.role}, ${row.text}, ${row.startMs}, ${row.endMs}
        )
      `,
    ),
});

/** The developer's own segments of one session inside a span, in the order the deltas came. */
const findSpokenSegments = SqlSchema.findAll({
  Request: Schema.Struct({
    voiceSessionId: Schema.String,
    fromMs: Schema.Int,
    toMs: Schema.Int,
  }),
  Result: Schema.Struct({
    text: Schema.String,
    startMs: Schema.propertySignature(Schema.Number).pipe(Schema.fromKey("start_ms")),
  }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select text, start_ms
        from voice_transcript_segments
        where voice_session_id = ${request.voiceSessionId}
          and role = ${VOICE_SEGMENT_ROLE.USER}
          and start_ms >= ${request.fromMs}
          and start_ms < ${request.toMs}
        order by seq asc
      `,
    ),
});

export function voiceWriter({ run, store }: VoiceWriterOptions): VoiceWriter {
  /** Appends by live session and client event id: the one thing kept in memory, and only until the speech lands. */
  const pending = new Map<string, Map<string, PendingAppend>>();

  const appendsOf = (liveSessionId: string): Map<string, PendingAppend> => {
    const standing = pending.get(liveSessionId);
    if (standing !== undefined) return standing;
    const created = new Map<string, PendingAppend>();
    pending.set(liveSessionId, created);
    return created;
  };

  /** One segment, at the next position of the session's own sequence; the primary key is the backstop. Answers the session row. */
  function appendSegment(
    target: VoiceTarget,
    delta: SegmentDelta,
  ): Effect.Effect<Option.Option<VoiceSessionRow>, VoiceWriteFailure, SqlClient.SqlClient> {
    return Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const voiceSession = yield* lockVoiceSession({
            userId: target.userId,
            liveSessionId: target.liveSessionId,
          });
          if (Option.isNone(voiceSession)) return voiceSession;
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
   * A briefing is known to have been said when the session's own voice
   * follows the append: the first output delta that begins at or after the
   * appended commentary's end marks the briefing spoken, once, as the device
   * the session belongs to — the speech module admits the mark only from the
   * device that claimed the offer, so a session with no device, or one whose
   * device did not claim, marks nothing — and the append is forgotten.
   * Every append the delta has reached is marked by it, since two briefings
   * appended back to back may both be answered by one delta and a second
   * would otherwise wait for speech that never comes.
   */
  async function markSpoken(
    target: VoiceTarget,
    delta: SegmentDelta,
    voiceSession: VoiceSessionRow,
  ): Promise<VoiceWriteResult | undefined> {
    const appends = appendsOf(target.liveSessionId);
    let outcome: VoiceWriteResult | undefined;
    for (const [clientEventId, append] of appends) {
      if (append.spokenFromMs === undefined || delta.start_ms < append.spokenFromMs) continue;
      appends.delete(clientEventId);
      if (voiceSession.deviceId === null) {
        outcome = { ok: false, refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT };
        continue;
      }
      const marked = await markSpeechSpoken(
        { run, writer: store },
        target.userId,
        append.messageId,
        voiceSession.deviceId,
        // Which session said it, and when on that session's clock.
        { voiceSessionId: voiceSession.id, atMs: delta.start_ms },
      );
      if (marked.ok) {
        outcome ??= WRITTEN;
      } else {
        outcome = {
          ok: false,
          refusal:
            marked.refusal === SPEECH_REFUSAL.NOT_FOUND
              ? VOICE_WRITE_REFUSAL.NO_MESSAGE
              : VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
        };
      }
    }
    return outcome;
  }

  function placeAppend(target: VoiceTarget, appended: CommentaryAppended): VoiceWriteResult {
    const clientEventId = appended.client_event_id;
    if (clientEventId === undefined) return IGNORED;
    const append = appendsOf(target.liveSessionId).get(clientEventId);
    if (append === undefined) return IGNORED;
    append.spokenFromMs = appended.end_ms;
    return WRITTEN;
  }

  /**
   * The developer's spoken ask, cut where the delegation places it: every
   * segment of the developer's own words from the previous ask's end (or the
   * session's start) up to the delegation's offset, joined exactly as the
   * deltas came, and written as a user message on the voice channel naming
   * the session, the delegation, and the span. A delegation with no words
   * before it writes nothing.
   */
  async function recordSpokenAsk(
    target: VoiceTarget,
    created: DelegationCreated,
  ): Promise<VoiceWriteResult> {
    const voiceSession = await run(
      findVoiceSession({ userId: target.userId, liveSessionId: target.liveSessionId }),
    );
    if (Option.isNone(voiceSession)) return NO_SESSION;
    const voiceSessionId = voiceSession.value.id;
    const previous = await store.spokenAskEnd(target.conversation, {
      voiceSessionId,
      delegationId: created.delegation.id,
    });
    if (!previous.ok) return { ok: false, refusal: previous.refusal };
    const spoken = await run(
      findSpokenSegments({
        voiceSessionId,
        fromMs: previous.toMs,
        toMs: created.offset_ms,
      }),
    );
    const text = spoken.map((segment) => segment.text).join("");
    if (text.length === 0) return IGNORED;
    const metadata: SpokenAskMetadata = {
      author: MESSAGE_AUTHOR.DEVELOPER,
      channel: MESSAGE_CHANNEL.VOICE,
      voice_session_id: voiceSessionId,
      delegation_id: created.delegation.id,
      from_ms: Math.min(...spoken.map((segment) => segment.startMs)),
      to_ms: created.offset_ms,
    };
    const written = await store.recordUserMessage(target.conversation, {
      clientId: created.delegation.id,
      text,
      metadata,
    });
    if (written.ok) return written.effect === STORE_WRITE_EFFECT.REPEATED ? REPEATED : WRITTEN;
    return { ok: false, refusal: written.refusal };
  }

  return {
    noteAppend(target, append) {
      appendsOf(target.liveSessionId).set(append.clientEventId, {
        messageId: append.messageId,
        conversation: target.conversation,
      });
    },
    async consume(target, event) {
      switch (event.type) {
        case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
          return Option.isNone(await run(appendSegment(target, event))) ? NO_SESSION : WRITTEN;
        case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA: {
          const voiceSession = await run(appendSegment(target, event));
          if (Option.isNone(voiceSession)) return NO_SESSION;
          return (await markSpoken(target, event, voiceSession.value)) ?? WRITTEN;
        }
        case LIVE_SERVER_EVENT.COMMENTARY_APPENDED:
          return placeAppend(target, event);
        case LIVE_SERVER_EVENT.DELEGATION_CREATED:
          return recordSpokenAsk(target, event);
        default:
          return IGNORED;
      }
    },
  };
}
