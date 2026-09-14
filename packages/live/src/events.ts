import {
  EXCESS_KEYS,
  isRecord,
  isWireString,
  SCHEMA_REFUSAL,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Result, Schema, SchemaTransformation } from "effect";

/**
 * The Live wire grammar: how far a session has progressed, the events both
 * sides send, the builders that speak the client's, and one schema per
 * server event so a second file cannot re-encode what arrives. The names are
 * the API's own and stay the discriminant, so a switch over a parsed event
 * is a switch on the protocol and not a second vocabulary.
 */

/** How far the voice session has progressed, as the host and the panel both read it. */
export const LIVE_STATUS = {
  /** Nothing to run on: no key, no account, or a fixture run. */
  UNAVAILABLE: "unavailable",
  IDLE: "idle",
  CONNECTING: "connecting",
  /** A session stands with the microphone muted; Luke may still speak into it. */
  MUTED: "muted",
  LISTENING: "listening",
  SPEAKING: "speaking",
  /** `session.close` was sent and `session.closed` is awaited. */
  CLOSING: "closing",
  FAILED: "failed",
} as const;

export type LiveStatus = (typeof LIVE_STATUS)[keyof typeof LIVE_STATUS];

export const LiveStatusSchema = Schema.Literals(Object.values(LIVE_STATUS));

/**
 * Whether a spoken exchange is live: the session coming up for a press, the
 * developer being listened to, or Luke speaking. A press still waiting on its
 * session counts, since the session passes through muted between starting and
 * hearing the developer; a standing session with the microphone muted and
 * Luke silent does not, so the media duck that follows this lets the music
 * back up between exchanges rather than for as long as the session stands.
 */
export function liveExchangeActive(view: {
  voiceStatus: LiveStatus;
  talkOpening: boolean;
}): boolean {
  return (
    view.talkOpening ||
    view.voiceStatus === LIVE_STATUS.CONNECTING ||
    view.voiceStatus === LIVE_STATUS.LISTENING ||
    view.voiceStatus === LIVE_STATUS.SPEAKING
  );
}

/**
 * The client events this build sends. Nothing here starts a session: a WebRTC
 * session is started by the HTTP request that created it and must not receive
 * `session.start` on its data channel, and nothing here appends audio, which
 * the negotiated media track carries.
 */
export const LIVE_CLIENT_EVENT = {
  INPUT_AUDIO_MUTE: "session.input_audio.mute",
  INPUT_AUDIO_UNMUTE: "session.input_audio.unmute",
  /** Trusted application instructions that change behavior and speech. */
  INSTRUCTIONS_APPEND: "session.instructions.append",
  /** Factual context the model keeps without saying it. */
  THINKING_APPEND: "session.thinking.append",
  /** Words for the model to say aloud, which it may paraphrase. */
  COMMENTARY_APPEND: "session.commentary.append",
  CLOSE: "session.close",
} as const;

export type LiveClientEventType = (typeof LIVE_CLIENT_EVENT)[keyof typeof LIVE_CLIENT_EVENT];

export const LiveClientEventTypeSchema = Schema.Literals(Object.values(LIVE_CLIENT_EVENT));

export const LIVE_SERVER_EVENT = {
  SESSION_STARTED: "session.started",
  SESSION_CLOSED: "session.closed",
  INPUT_AUDIO_MUTED: "session.input_audio.muted",
  INPUT_AUDIO_UNMUTED: "session.input_audio.unmuted",
  INSTRUCTIONS_APPENDED: "session.instructions.appended",
  THINKING_APPENDED: "session.thinking.appended",
  COMMENTARY_APPENDED: "session.commentary.appended",
  INPUT_TRANSCRIPT_DELTA: "session.input_transcript.delta",
  OUTPUT_TRANSCRIPT_DELTA: "session.output_transcript.delta",
  DELEGATION_CREATED: "session.delegation.created",
  USAGE_UPDATED: "session.usage.updated",
  /** The developer's own audio, reflected to a sideband and never to the renderer. */
  INPUT_AUDIO_APPEND: "session.input_audio.append",
  /** Luke's audio, reflected to a sideband and never to the renderer. */
  OUTPUT_AUDIO_DELTA: "session.output_audio.delta",
  ERROR: "error",
  INFO: "info",
} as const;

export type LiveServerEventType = (typeof LIVE_SERVER_EVENT)[keyof typeof LIVE_SERVER_EVENT];

export const LiveServerEventTypeSchema = Schema.Literals(Object.values(LIVE_SERVER_EVENT));

/** Why a session ended, as `session.closed` names it. */
export const LIVE_CLOSE_REASON = {
  CLOSE_REQUESTED: "close_requested",
  EXPIRED: "expired",
  CONTENT: "content",
  REMOTE_HANGUP: "remote_hangup",
  CONNECTION_LOST: "connection_lost",
} as const;

export type LiveCloseReason = (typeof LIVE_CLOSE_REASON)[keyof typeof LIVE_CLOSE_REASON];

export const LiveCloseReasonSchema = Schema.Literals(Object.values(LIVE_CLOSE_REASON));

export const LIVE_DELEGATION_TARGET = {
  CLIENT: "client",
  RESPONSES: "responses",
} as const;

export type LiveDelegationTarget =
  (typeof LIVE_DELEGATION_TARGET)[keyof typeof LIVE_DELEGATION_TARGET];

export const LiveDelegationTargetSchema = Schema.Literals(Object.values(LIVE_DELEGATION_TARGET));

/** A schema handed the interface it decodes into, since a struct assembled field by field only agrees with that interface rather than restating it. */
function schemaAs<Value>(schema: Schema.Top): Schema.Codec<Value, UnparsedWireValue> {
  return Schema.make<Schema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/** A trimmed text, refused when only whitespace remains. */
const text: Schema.Codec<string, string> = Schema.Trim.check(Schema.isNonEmpty());

/**
 * An identifier as the service wrote it. Session and delegation ids are
 * opaque and are returned unchanged, prefix included, so nothing here trims
 * or reshapes one; only a blank one is refused, by a check of its own beside
 * the length bound, since the bound is what a model is shown and the blank is
 * the rule no node can say.
 */
const opaqueId: Schema.Codec<string, string> = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter<string>((value) => value.trim().length > 0),
);

/**
 * A transcript fragment exactly as received. The captions recipe forbids
 * trimming a fragment or inserting a space between two, so a delta of one
 * space is a delta and not a blank.
 */
const transcriptDelta: Schema.Codec<string, string> = Schema.String;

const sessionTimeMs = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const nonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The value a dropped field admits: whatever the inner schema read, or
 * nothing. Wrapped with `Schema.optionalKey` at the field, this is the
 * per-field counterpart of an array that skips a refused entry: a value worth
 * having when well formed and worth nothing when it is not, where refusing
 * the whole event over one of them would cost the reader everything else it
 * carried. The inner read drops a key the declaration does not name, on the
 * same terms as the read of the event around it.
 */
function dropped<Value, Encoded>(
  inner: Schema.Codec<Value, Encoded>,
): Schema.Codec<Value | undefined, UnparsedWireValue> {
  const read = readEither(inner, { excess: EXCESS_KEYS.DROP });
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Result.getOrUndefined(read(value)) }),
    emitJsonSchema(inner),
  );
}

/** The open record a cleanup's two ends are stated in, since it keeps no key table of its own. */
const anyRecord = Schema.Record(Schema.String, Schema.Unknown);

/**
 * A struct that carries a dropped field leaves the key out entirely when
 * that field's value came back `undefined`, exactly as an absent optional key
 * is left out — a struct's own decode still writes the key when it arrived,
 * even holding nothing, so this is the cleanup every such record needs on top
 * of it.
 */
function cleaned<Value>(schema: Schema.Top): Schema.Codec<Value, UnparsedWireValue> {
  return schemaAs<Value>(
    schemaAs<typeof anyRecord.Type>(schema).pipe(
      Schema.decodeTo(
        anyRecord,
        SchemaTransformation.transform({
          decode: (value) =>
            Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
          encode: (value) => value,
        }),
      ),
    ),
  );
}

/**
 * The fields every server event carries: its own id and, when it answers a
 * client event, the id that event was sent with, which is how an
 * acknowledgment or an error is matched to the command it is about.
 */
const acknowledgment = {
  event_id: opaqueId,
  client_event_id: Schema.optionalKey(opaqueId),
};

export type LiveSessionSnapshot = {
  id: string;
  model?: string;
  expires_at?: number;
};

const sessionSnapshotSchema = cleaned<LiveSessionSnapshot>(
  Schema.Struct({
    id: opaqueId,
    model: Schema.optionalKey(dropped(text)),
    expires_at: Schema.optionalKey(dropped(sessionTimeMs)),
  }),
);

export type LiveUsageSnapshot = {
  seconds: number;
};

const usageSchema: Schema.Codec<LiveUsageSnapshot, UnparsedWireValue> = schemaAs(
  Schema.Struct({ seconds: nonNegativeNumber }),
);

type Acknowledged = {
  event_id: string;
  client_event_id?: string;
};

function appended<const Type extends string>(type: Type) {
  return Schema.Struct({
    type: Schema.Literal(type),
    ...acknowledgment,
    start_ms: sessionTimeMs,
    end_ms: sessionTimeMs,
  });
}

export type LiveAppendedEvent<Type extends string> = Acknowledged & {
  type: Type;
  start_ms: number;
  end_ms: number;
};

function transcriptDeltaEvent<const Type extends string>(type: Type) {
  return Schema.Struct({
    type: Schema.Literal(type),
    ...acknowledgment,
    delta: transcriptDelta,
    start_ms: sessionTimeMs,
    end_ms: sessionTimeMs,
  });
}

export type LiveTranscriptDeltaEvent<Type extends string> = Acknowledged & {
  type: Type;
  delta: string;
  start_ms: number;
  end_ms: number;
};

function microphoneAcknowledgment<const Type extends string>(type: Type) {
  return Schema.Struct({ type: Schema.Literal(type), ...acknowledgment });
}

export type LiveMicrophoneAckEvent<Type extends string> = Acknowledged & {
  type: Type;
};

export type LiveSessionStartedEvent = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.SESSION_STARTED;
  session: LiveSessionSnapshot;
};

const sessionStartedSchema: Schema.Codec<LiveSessionStartedEvent, UnparsedWireValue> = schemaAs(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.SESSION_STARTED),
    ...acknowledgment,
    session: sessionSnapshotSchema,
  }),
);

export type LiveSessionClosed = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.SESSION_CLOSED;
  reason: LiveCloseReason;
  usage: LiveUsageSnapshot;
  session?: LiveSessionSnapshot;
};

const sessionClosedSchema = cleaned<LiveSessionClosed>(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.SESSION_CLOSED),
    ...acknowledgment,
    reason: LiveCloseReasonSchema,
    usage: usageSchema,
    session: Schema.optionalKey(dropped(sessionSnapshotSchema)),
  }),
);

const inputAudioMutedSchema = microphoneAcknowledgment(LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED);
const inputAudioUnmutedSchema = microphoneAcknowledgment(LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED);
const instructionsAppendedSchema = appended(LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED);
const thinkingAppendedSchema = appended(LIVE_SERVER_EVENT.THINKING_APPENDED);
const commentaryAppendedSchema = appended(LIVE_SERVER_EVENT.COMMENTARY_APPENDED);
const inputTranscriptDeltaSchema = transcriptDeltaEvent(LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA);
const outputTranscriptDeltaSchema = transcriptDeltaEvent(LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA);

export type LiveDelegation = {
  id: string;
  target: LiveDelegationTarget;
  response_id?: string;
};

const delegationSchema = cleaned<LiveDelegation>(
  Schema.Struct({
    id: opaqueId,
    target: LiveDelegationTargetSchema,
    response_id: Schema.optionalKey(dropped(opaqueId)),
  }),
);

export type LiveDelegationCreated = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.DELEGATION_CREATED;
  offset_ms: number;
  delegation: LiveDelegation;
};

/**
 * A delegation carries metadata and a place on the session timeline, never
 * the developer's words: what was asked is read from the transcript the
 * application kept, from the previous delegation's offset on.
 */
const delegationCreatedSchema: Schema.Codec<LiveDelegationCreated, UnparsedWireValue> = schemaAs(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.DELEGATION_CREATED),
    ...acknowledgment,
    offset_ms: sessionTimeMs,
    delegation: delegationSchema,
  }),
);

export type LiveContextWindow = {
  usage_ratio: number;
};

export type LiveUsageUpdatedEvent = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.USAGE_UPDATED;
  usage: LiveUsageSnapshot;
  context_window?: LiveContextWindow;
};

/** Cumulative seconds as a snapshot, never an increment to sum. */
const usageUpdatedSchema = cleaned<LiveUsageUpdatedEvent>(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.USAGE_UPDATED),
    ...acknowledgment,
    usage: usageSchema,
    context_window: Schema.optionalKey(dropped(Schema.Struct({ usage_ratio: nonNegativeNumber }))),
  }),
);

export type LiveInputAudioAppendEvent = {
  type: typeof LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND;
};

export type LiveOutputAudioDeltaEvent = {
  type: typeof LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA;
};

/**
 * Reflected audio, read for its type alone: a sideband drops both by type
 * before anything else looks at them, and the payload is never parsed.
 */
const inputAudioAppendSchema: Schema.Codec<LiveInputAudioAppendEvent, UnparsedWireValue> = schemaAs(
  Schema.Struct({ type: Schema.Literal(LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND) }),
);
const outputAudioDeltaSchema: Schema.Codec<LiveOutputAudioDeltaEvent, UnparsedWireValue> = schemaAs(
  Schema.Struct({ type: Schema.Literal(LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA) }),
);

/**
 * Which client event an error is about may sit at the event's top level as
 * `client_event_id`, inside `error` under the same name, or inside `error`
 * as `event_id`, the placement the Realtime API reference documents. The
 * GPT-Live server-events reference could not be read when this was written,
 * so all three are carried and a reader matches on whichever arrived.
 */
export type LiveErrorDetail = {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  event_id?: string;
  client_event_id?: string;
};

const errorDetailSchema = cleaned<LiveErrorDetail>(
  Schema.Struct({
    type: Schema.optionalKey(dropped(text)),
    code: Schema.optionalKey(dropped(text)),
    message: Schema.optionalKey(dropped(text)),
    param: Schema.optionalKey(dropped(text)),
    event_id: Schema.optionalKey(dropped(opaqueId)),
    client_event_id: Schema.optionalKey(dropped(opaqueId)),
  }),
);

export type LiveErrorEvent = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.ERROR;
  error: LiveErrorDetail;
};

/**
 * An error may or may not name the client event it is about, and its code
 * may be null; one that names none is never read as any command's success.
 */
const errorEventSchema: Schema.Codec<LiveErrorEvent, UnparsedWireValue> = schemaAs(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.ERROR),
    ...acknowledgment,
    error: errorDetailSchema,
  }),
);

export type LiveInfoEvent = Acknowledged & {
  type: typeof LIVE_SERVER_EVENT.INFO;
  code?: string;
  message?: string;
};

const infoEventSchema = cleaned<LiveInfoEvent>(
  Schema.Struct({
    type: Schema.Literal(LIVE_SERVER_EVENT.INFO),
    ...acknowledgment,
    code: Schema.optionalKey(dropped(text)),
    message: Schema.optionalKey(dropped(text)),
  }),
);

export type LiveServerEvent =
  | LiveSessionStartedEvent
  | LiveSessionClosed
  | LiveMicrophoneAckEvent<typeof LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED>
  | LiveMicrophoneAckEvent<typeof LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED>
  | LiveAppendedEvent<typeof LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED>
  | LiveAppendedEvent<typeof LIVE_SERVER_EVENT.THINKING_APPENDED>
  | LiveAppendedEvent<typeof LIVE_SERVER_EVENT.COMMENTARY_APPENDED>
  | LiveTranscriptDeltaEvent<typeof LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA>
  | LiveTranscriptDeltaEvent<typeof LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA>
  | LiveDelegationCreated
  | LiveUsageUpdatedEvent
  | LiveInputAudioAppendEvent
  | LiveOutputAudioDeltaEvent
  | LiveErrorEvent
  | LiveInfoEvent;

export const liveServerEventSchema: Schema.Codec<LiveServerEvent, UnparsedWireValue> = schemaAs(
  Schema.Union([
    sessionStartedSchema,
    sessionClosedSchema,
    inputAudioMutedSchema,
    inputAudioUnmutedSchema,
    instructionsAppendedSchema,
    thinkingAppendedSchema,
    commentaryAppendedSchema,
    inputTranscriptDeltaSchema,
    outputTranscriptDeltaSchema,
    delegationCreatedSchema,
    usageUpdatedSchema,
    inputAudioAppendSchema,
    outputAudioDeltaSchema,
    errorEventSchema,
    infoEventSchema,
  ]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
);

/**
 * Decodes one data-channel or socket payload to the record it carries, or
 * nothing. Exported so a tap on the channel reads the payload the same way
 * the parser below does rather than re-encoding the grammar.
 */
export function decodeLivePayload(data: UnparsedWireValue): WireRecord | undefined {
  let payload: UnparsedWireValue = data;
  if (isWireString(data)) {
    try {
      // SAFETY: JSON.parse returns a runtime value; isRecord validates the object contract.
      payload = JSON.parse(data) as UnparsedWireValue;
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }
  return isRecord(payload) ? payload : undefined;
}

/**
 * Reads one inbound Live event: a JSON string from the data channel or the
 * sideband, or an already-decoded payload. An event this build does not
 * act on, or one missing a field its schema requires, is discarded rather
 * than repaired. The read drops a key a newer service added rather than
 * refusing the event over it, which is the grain every answer here is read
 * with and is the read's to decide, not the declaration's.
 */
export function parseLiveServerEvent(data: UnparsedWireValue): LiveServerEvent | undefined {
  const payload = decodeLivePayload(data);
  return payload === undefined
    ? undefined
    : Result.getOrUndefined(
        readEither(liveServerEventSchema, { excess: EXCESS_KEYS.DROP })(payload),
      );
}

/**
 * The delegation an append is about: a known client delegation's id, or
 * `null` for session-wide context. The field is required on every append,
 * `null` included, so a builder takes it rather than defaulting it.
 */
export type LiveDelegationId = string | null;

export type LiveAppendInput = {
  eventId: string;
  delegationId: LiveDelegationId;
  /** Plain text of at most 500 tokens; `chunkForAppend` cuts a longer text. */
  content: string;
};

type AppendType =
  | typeof LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND
  | typeof LIVE_CLIENT_EVENT.THINKING_APPEND
  | typeof LIVE_CLIENT_EVENT.COMMENTARY_APPEND;

export type LiveAppendEvent<Type extends AppendType = AppendType> = {
  type: Type;
  event_id: string;
  delegation_id: LiveDelegationId;
  content: string;
};

export type LiveCommandEvent<
  Type extends
    | typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE
    | typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE
    | typeof LIVE_CLIENT_EVENT.CLOSE,
> = {
  type: Type;
  event_id: string;
};

export type LiveClientEvent =
  | LiveAppendEvent
  | LiveCommandEvent<typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE>
  | LiveCommandEvent<typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE>
  | LiveCommandEvent<typeof LIVE_CLIENT_EVENT.CLOSE>;

function appendEvent<Type extends AppendType>(
  type: Type,
  input: LiveAppendInput,
): LiveAppendEvent<Type> {
  return {
    type,
    event_id: input.eventId,
    delegation_id: input.delegationId,
    content: input.content,
  };
}

/** Mutes the developer's input; the acknowledgment is `session.input_audio.muted`. Output continues. */
export function muteEvent(
  eventId: string,
): LiveCommandEvent<typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE> {
  return { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE, event_id: eventId };
}

/** Resumes the developer's input; the acknowledgment is `session.input_audio.unmuted`. */
export function unmuteEvent(
  eventId: string,
): LiveCommandEvent<typeof LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE> {
  return { type: LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE, event_id: eventId };
}

export function instructionsAppend(
  input: LiveAppendInput,
): LiveAppendEvent<typeof LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND> {
  return appendEvent(LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, input);
}

export function thinkingAppend(
  input: LiveAppendInput,
): LiveAppendEvent<typeof LIVE_CLIENT_EVENT.THINKING_APPEND> {
  return appendEvent(LIVE_CLIENT_EVENT.THINKING_APPEND, input);
}

export function commentaryAppend(
  input: LiveAppendInput,
): LiveAppendEvent<typeof LIVE_CLIENT_EVENT.COMMENTARY_APPEND> {
  return appendEvent(LIVE_CLIENT_EVENT.COMMENTARY_APPEND, input);
}

/**
 * Asks the session to finish. The `session.closed` listener is registered
 * before this is sent, and every transport stays open until that event or
 * the application's own timeout; a socket closed first leaves the final
 * usage unconfirmed.
 */
export function closeEvent(eventId: string): LiveCommandEvent<typeof LIVE_CLIENT_EVENT.CLOSE> {
  return { type: LIVE_CLIENT_EVENT.CLOSE, event_id: eventId };
}

/** One server event the renderer's data channel may receive, as `client.data_channel` names it. */
export type LiveServerEventSelector = {
  type: LiveServerEventType;
};

/**
 * What an untrusted renderer may send on its data channel: the microphone
 * switch and the hang-up, and nothing that appends to the model. Every
 * append is the host's, over its trusted sideband, so no secret and no
 * authority to speak reaches the window.
 */
export const RENDERER_CLIENT_EVENTS: readonly LiveClientEventType[] = [
  LIVE_CLIENT_EVENT.INPUT_AUDIO_MUTE,
  LIVE_CLIENT_EVENT.INPUT_AUDIO_UNMUTE,
  LIVE_CLIENT_EVENT.CLOSE,
];

/**
 * What the renderer's data channel is shown: the lifecycle, both captions,
 * its own microphone acknowledgments, usage, and the error and info events.
 * Delegations and append acknowledgments are the host's business and stay
 * off the channel.
 */
export const RENDERER_SERVER_EVENTS: readonly LiveServerEventSelector[] = [
  { type: LIVE_SERVER_EVENT.SESSION_STARTED },
  { type: LIVE_SERVER_EVENT.SESSION_CLOSED },
  { type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA },
  { type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA },
  { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED },
  { type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED },
  { type: LIVE_SERVER_EVENT.USAGE_UPDATED },
  { type: LIVE_SERVER_EVENT.ERROR },
  { type: LIVE_SERVER_EVENT.INFO },
];
