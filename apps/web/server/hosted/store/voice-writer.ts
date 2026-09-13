import { createHash } from "node:crypto";
import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import {
  type AssistantMessageMetadata,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  type SpokenAskMetadata,
} from "../../core.js";
import { VOICE_SEGMENT_ROLE, type VoiceSegmentRole } from "../../db/voice-vocabulary.js";
import { LIVE_SERVER_EVENT, type LiveServerEvent } from "../../live.js";
import { markSpeechSpoken, SPEECH_REFUSAL } from "./speech.js";
import {
  type ConversationTarget,
  SPOKEN_LINE_BOUNDARY,
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
 * What is spoken becomes a message in one case: an exchange the voice model
 * answers itself. The two utterance doors (`recordSpokenLine`,
 * `recordSpokenReply`) are called by the live session service when an
 * utterance has settled by the ledger's own rule — no fragment has joined it
 * for the gap plus the margin — and each writes one finished row cut from
 * the segments already on record over the utterance's span, or nothing: a row
 * is never opened and amended, so a socket closing mid-sentence leaves the
 * words actually said or no row, never a row still being written. The
 * developer's settled utterance is a user row on the voice channel naming
 * the session and its span, with no delegation; a delegation that arrives
 * after the utterance settled adopts that row rather than cutting a second
 * (`adoptSpokenLine`), giving it the ask's own cut — the line's words with
 * any fragment that joined the utterance after it settled and any said after
 * it before the delegation — so an ask and its line share one id and one text
 * however the two writes were ordered. Luke's settled utterance is an assistant row authored
 * by the voice model only where it answered such a line: the developer's
 * latest line before it stands undelegated, the utterance is the first thing
 * Luke said after that line, and it begins within `SPOKEN_REPLY.WINDOW_MS` of
 * the line's end. Where that line is a delegation's the words are the brain's
 * reply spoken, already on record as the turn's journal; where no line
 * precedes them, or Luke has spoken since the line, or the line is long past,
 * they are a greeting, a beat, or a briefing spoken; and where the utterance
 * is the voice following a commentary append this instance sent, they are a
 * briefing's words. None of those becomes a second row. Segments may overlap, because timed deltas do,
 * and no audio is ever stored.
 *
 * Every statement here is an `Effect` over the ambient `SqlClient`, decoded
 * by a `Schema` rather than trusted, and answered as an effect to whoever
 * composed the writer; the position a segment takes is allocated inside the
 * session row's own lock, which is the transaction the client opens.
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

const SPOKEN_REPLY = {
  /**
   * How long after the developer's line Luke's first words may begin and still
   * be his answer to it, on the session's clock. The voice model answers at
   * once where it answers itself; words that begin later than this after a
   * line nobody answered are a beat or a briefing, not the answer.
   */
  WINDOW_MS: 30_000,
} as const;

/** The span one settled utterance covers on the session's own clock, as the ledger grouped it. */
interface SpokenUtteranceSpan {
  readonly startMs: number;
  readonly endMs: number;
}

export interface VoiceWriter {
  /** Consumes one server event of the live session's stream. */
  consume(
    target: VoiceTarget,
    event: LiveServerEvent,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient>;
  /** Tells the writer which message a commentary append carries, before the stream acknowledges it. */
  noteAppend(target: VoiceTarget, append: CommentaryAppend): void;
  /** The developer's settled utterance, undelegated: a finished user row cut from the session's segments over its span. */
  recordSpokenLine(
    target: VoiceTarget,
    utterance: SpokenUtteranceSpan,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient>;
  /** One of Luke's settled utterances: a finished assistant row over its span where it answered an undelegated line, and nothing otherwise. */
  recordSpokenReply(
    target: VoiceTarget,
    utterance: SpokenUtteranceSpan,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient>;
}

interface VoiceWriterOptions {
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

/**
 * The client id of a spoken row the voice writer cuts itself: one per
 * session, speaker, and utterance start, derived rather than minted so a
 * settle told twice, or told again from a fresh function instance, writes the
 * same row. A name-based UUID of the same construction as the brain host's,
 * under a namespace of this writer's own.
 */
const SPOKEN_ROW_NAMESPACE = "8f2d6c1a-5b3e-4a7f-9c0d-1e2f3a4b5c6d";
const UUID_VERSION_8 = 0x80;
const UUID_VARIANT_RFC_4122 = 0x80;

function spokenRowClientId(
  voiceSessionId: string,
  role: VoiceSegmentRole,
  startMs: number,
): string {
  const digest = createHash("sha256")
    .update(Buffer.from(SPOKEN_ROW_NAMESPACE.replaceAll("-", ""), "hex"))
    .update(JSON.stringify([voiceSessionId, role, startMs]), "utf8")
    .digest()
    .subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | UUID_VERSION_8;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | UUID_VARIANT_RFC_4122;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One speaker's segments of one session over a settled utterance's span, both ends included, in the order the deltas came. */
const findUtteranceSegments = SqlSchema.findAll({
  Request: Schema.Struct({
    voiceSessionId: Schema.String,
    role: VoiceSegmentRoleSchema,
    startMs: Schema.Int,
    endMs: Schema.Int,
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
          and role = ${request.role}
          and start_ms >= ${request.startMs}
          and start_ms <= ${request.endMs}
        order by seq asc
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

export function voiceWriter({ store }: VoiceWriterOptions): VoiceWriter {
  /** Appends by live session and client event id: the one thing kept in memory, and only until the speech lands. */
  const pending = new Map<string, Map<string, PendingAppend>>();
  /**
   * Where, on each session's clock, the session's voice was found following a
   * commentary append: the start of the output delta that marked it. Luke's
   * utterance covering such an instant is a briefing's words, not his own
   * answer. Kept beside the appends, for this instance's life like them.
   */
  const spokenAppendStarts = new Map<string, number[]>();

  const appendStartsOf = (liveSessionId: string): number[] => {
    const standing = spokenAppendStarts.get(liveSessionId);
    if (standing !== undefined) return standing;
    const created: number[] = [];
    spokenAppendStarts.set(liveSessionId, created);
    return created;
  };

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
  function markSpoken(
    target: VoiceTarget,
    delta: SegmentDelta,
    voiceSession: VoiceSessionRow,
  ): Effect.Effect<VoiceWriteResult | undefined, VoiceWriteFailure, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const appends = appendsOf(target.liveSessionId);
      let outcome: VoiceWriteResult | undefined;
      for (const [clientEventId, append] of appends) {
        if (append.spokenFromMs === undefined || delta.start_ms < append.spokenFromMs) continue;
        appends.delete(clientEventId);
        appendStartsOf(target.liveSessionId).push(delta.start_ms);
        if (voiceSession.deviceId === null) {
          outcome = { ok: false, refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT };
          continue;
        }
        const marked = yield* markSpeechSpoken(
          { writer: store },
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
    });
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
  function recordSpokenAsk(
    target: VoiceTarget,
    created: DelegationCreated,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const voiceSession = yield* findVoiceSession({
        userId: target.userId,
        liveSessionId: target.liveSessionId,
      });
      if (Option.isNone(voiceSession)) return NO_SESSION;
      const voiceSessionId = voiceSession.value.id;
      // The line the delegation is about, where one settled undelegated before it: the latest
      // developer line ending at or before the offset. A delegation told twice finds its own.
      // The line is found by where it starts: the API may place the delegation's offset before
      // the line's last fragment ended, and the line is the delegation's all the same, so the cut
      // then runs to the line's end rather than stopping at the offset.
      const latest = yield* store.latestSpokenLine(target.conversation, {
        voiceSessionId,
        boundary: SPOKEN_LINE_BOUNDARY.START,
        atOrBeforeMs: created.offset_ms,
      });
      if (!latest.ok) return { ok: false, refusal: latest.refusal };
      if (latest.line?.clientId === created.delegation.id) return REPEATED;
      const candidate =
        latest.line !== undefined && !latest.line.delegated ? latest.line : undefined;
      // A line Luke has already answered is not the one a later delegation is about: the
      // delegation's words are whatever the developer said since, which the cut takes from that
      // line's end. A line nobody answered is adopted whole.
      const answered =
        candidate === undefined || candidate.toMs >= created.offset_ms
          ? []
          : yield* findUtteranceSegments({
              voiceSessionId,
              role: VOICE_SEGMENT_ROLE.ASSISTANT,
              startMs: candidate.toMs,
              endMs: created.offset_ms - 1,
            });
      const adopting = answered.length === 0 ? candidate : undefined;
      const cutEndMs = Math.max(created.offset_ms, adopting?.toMs ?? created.offset_ms);
      // The cut starts where the developer's last written words end — the previous ask's, or the
      // last undelegated line's other than the one being adopted, whose own words the cut
      // includes again with whatever joined or followed them before the delegation.
      const previous = yield* store.spokenAskEnd(target.conversation, {
        voiceSessionId,
        delegationId: created.delegation.id,
        ...(adopting === undefined ? undefined : { exceptClientId: adopting.clientId }),
      });
      if (!previous.ok) return { ok: false, refusal: previous.refusal };
      const spoken = yield* findSpokenSegments({
        voiceSessionId,
        fromMs: previous.toMs,
        toMs: cutEndMs,
      });
      const text = spoken.map((segment) => segment.text).join("");
      if (text.length === 0) return IGNORED;
      const metadata: SpokenAskMetadata = {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: voiceSessionId,
        delegation_id: created.delegation.id,
        from_ms: Math.min(...spoken.map((segment) => segment.startMs)),
        to_ms: cutEndMs,
      };
      if (adopting !== undefined) {
        const adopted = yield* store.adoptSpokenLine(target.conversation, {
          lineClientId: adopting.clientId,
          delegationId: created.delegation.id,
          text,
          metadata,
        });
        if (adopted.ok) return adopted.effect === STORE_WRITE_EFFECT.REPEATED ? REPEATED : WRITTEN;
        return { ok: false, refusal: adopted.refusal };
      }
      const written = yield* store.recordUserMessage(target.conversation, {
        clientId: created.delegation.id,
        turnOfAsk: true,
        text,
        metadata,
      });
      if (written.ok) return written.effect === STORE_WRITE_EFFECT.REPEATED ? REPEATED : WRITTEN;
      return { ok: false, refusal: written.refusal };
    });
  }

  /**
   * The developer's settled utterance the voice model answered itself, as a
   * finished user row: its own segments over the span, joined as the deltas
   * came, on the voice channel naming the session and the span and no
   * delegation. An utterance whose span holds no segment on record writes
   * nothing, since the words are not there to write.
   */
  function recordSpokenLine(
    target: VoiceTarget,
    utterance: SpokenUtteranceSpan,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      const voiceSession = yield* findVoiceSession({
        userId: target.userId,
        liveSessionId: target.liveSessionId,
      });
      if (Option.isNone(voiceSession)) return NO_SESSION;
      const voiceSessionId = voiceSession.value.id;
      const spoken = yield* findUtteranceSegments({
        voiceSessionId,
        role: VOICE_SEGMENT_ROLE.USER,
        startMs: utterance.startMs,
        endMs: utterance.endMs,
      });
      const text = spoken.map((segment) => segment.text).join("");
      if (text.length === 0) return IGNORED;
      const metadata: SpokenAskMetadata = {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: voiceSessionId,
        from_ms: Math.min(...spoken.map((segment) => segment.startMs)),
        to_ms: utterance.endMs,
      };
      const written = yield* store.recordUserMessage(target.conversation, {
        clientId: spokenRowClientId(voiceSessionId, VOICE_SEGMENT_ROLE.USER, utterance.startMs),
        text,
        metadata,
      });
      if (written.ok) return written.effect === STORE_WRITE_EFFECT.REPEATED ? REPEATED : WRITTEN;
      return { ok: false, refusal: written.refusal };
    });
  }

  /**
   * One of Luke's settled utterances, as a finished assistant row authored by
   * the voice model, only where it is his own answer: the developer's latest
   * line before it stands undelegated, and no commentary append this instance
   * sent was found spoken inside its span. A delegated line's answer is the
   * turn's journal; words before any line are a greeting, a beat, or a
   * briefing; the voice following an append is a briefing's words. Each of
   * those is on record already and writes nothing here.
   */
  function recordSpokenReply(
    target: VoiceTarget,
    utterance: SpokenUtteranceSpan,
  ): Effect.Effect<VoiceWriteResult, VoiceWriteFailure, SqlClient.SqlClient> {
    return Effect.gen(function* () {
      if (
        appendStartsOf(target.liveSessionId).some(
          (startMs) => startMs >= utterance.startMs && startMs <= utterance.endMs,
        )
      ) {
        return IGNORED;
      }
      const voiceSession = yield* findVoiceSession({
        userId: target.userId,
        liveSessionId: target.liveSessionId,
      });
      if (Option.isNone(voiceSession)) return NO_SESSION;
      const voiceSessionId = voiceSession.value.id;
      const latest = yield* store.latestSpokenLine(target.conversation, {
        voiceSessionId,
        boundary: SPOKEN_LINE_BOUNDARY.END,
        atOrBeforeMs: utterance.startMs,
      });
      if (!latest.ok) return { ok: false, refusal: latest.refusal };
      if (latest.line === undefined || latest.line.delegated) return IGNORED;
      // His answer is the first thing he says after the line, and soon after it: words after a
      // long pause, or after he has already spoken since the line, are a beat or a briefing
      // whatever memory this instance kept of the appends that carried them.
      if (utterance.startMs - latest.line.toMs > SPOKEN_REPLY.WINDOW_MS) return IGNORED;
      if (utterance.startMs > latest.line.toMs) {
        const spokenSince = yield* findUtteranceSegments({
          voiceSessionId,
          role: VOICE_SEGMENT_ROLE.ASSISTANT,
          startMs: latest.line.toMs,
          endMs: utterance.startMs - 1,
        });
        if (spokenSince.length > 0) return IGNORED;
      }
      const spoken = yield* findUtteranceSegments({
        voiceSessionId,
        role: VOICE_SEGMENT_ROLE.ASSISTANT,
        startMs: utterance.startMs,
        endMs: utterance.endMs,
      });
      const text = spoken.map((segment) => segment.text).join("");
      if (text.length === 0) return IGNORED;
      const metadata: AssistantMessageMetadata = { author: MESSAGE_AUTHOR.VOICE_MODEL };
      const written = yield* store.recordSpokenReply(target.conversation, {
        clientId: spokenRowClientId(
          voiceSessionId,
          VOICE_SEGMENT_ROLE.ASSISTANT,
          utterance.startMs,
        ),
        text,
        metadata,
      });
      if (written.ok) return written.effect === STORE_WRITE_EFFECT.REPEATED ? REPEATED : WRITTEN;
      return { ok: false, refusal: written.refusal };
    });
  }

  return {
    recordSpokenLine,
    recordSpokenReply,
    noteAppend(target, append) {
      appendsOf(target.liveSessionId).set(append.clientEventId, {
        messageId: append.messageId,
        conversation: target.conversation,
      });
    },
    consume: (target, event) =>
      Effect.gen(function* () {
        switch (event.type) {
          case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
            return Option.isNone(yield* appendSegment(target, event)) ? NO_SESSION : WRITTEN;
          case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA: {
            const voiceSession = yield* appendSegment(target, event);
            if (Option.isNone(voiceSession)) return NO_SESSION;
            return (yield* markSpoken(target, event, voiceSession.value)) ?? WRITTEN;
          }
          case LIVE_SERVER_EVENT.COMMENTARY_APPENDED:
            return placeAppend(target, event);
          case LIVE_SERVER_EVENT.DELEGATION_CREATED:
            return yield* recordSpokenAsk(target, event);
          default:
            return IGNORED;
        }
      }),
  };
}
