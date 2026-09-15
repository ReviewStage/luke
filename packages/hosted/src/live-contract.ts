import {
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_VOICE_LIST,
  type LiveAudioFormat,
  LiveAudioFormatSchema,
  type LiveVoice,
  OBSERVED_VALUE_LENGTH,
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  ProactiveSpeechKindSchema,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "@sidecar/live";
import { EXCESS_KEYS, SCHEMA_REFUSAL, type UnparsedWireValue } from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Result, Schema, SchemaGetter } from "effect";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * A device's contract with the hosted voice service: the three Vercel
 * Functions of Luke's own service that hold the GPT Live project key. Two
 * create a WebRTC session at OpenAI (`POST /v1/live/sessions`) from the
 * device's offer, attach the trusted sideband themselves, and then carry Live
 * events between the device and OpenAI untouched; the third opens a primary
 * WebSocket to OpenAI of the service's own for a device with no WebRTC, and
 * carries that device's audio up and Luke's down over the one socket beside
 * the events. A device reaches each over one WebSocket per function
 * connection, and what travels on that socket before the Live events do is
 * declared here, once, for both ends.
 */

/** The origin of Luke's own service, the same one every hosted call is addressed to. */
export const HOSTED_SERVICE_ORIGIN = "https://tryluke.dev";

const WEB_SOCKET_SCHEME = {
  "https:": "wss:",
  "http:": "ws:",
  "wss:": "wss:",
  "ws:": "ws:",
} as const;

function isWebSocketReachable(protocol: string): protocol is keyof typeof WEB_SOCKET_SCHEME {
  return protocol in WEB_SOCKET_SCHEME;
}

/**
 * The socket origin of an HTTP or socket origin, or nothing for an address
 * that is not an absolute URL on a scheme a socket can be opened over.
 */
export function webSocketOrigin(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (!isWebSocketReachable(url.protocol)) return undefined;
    url.protocol = WEB_SOCKET_SCHEME[url.protocol];
    return url.origin === "null" ? undefined : url.origin;
  } catch {
    return undefined;
  }
}

/**
 * The one origin a hosted desktop opens a voice socket to: Luke's own
 * service, in its socket form (the test holds it to `webSocketOrigin` of
 * `HOSTED_SERVICE_ORIGIN`). Pinned by the build and compared as an origin —
 * scheme, host, and port — so a path or query can never make another host
 * read as Luke's service. A development build may be pointed elsewhere
 * through {@link hostedVoiceServiceOrigin}; a packaged one may not.
 */
export const HOSTED_VOICE_SERVICE_ORIGIN = "wss://tryluke.dev";

/** Whether an address is on the hosted voice service's origin, by `URL.origin` alone. */
export function isHostedVoiceServiceAddress(address: string, origin = HOSTED_VOICE_SERVICE_ORIGIN) {
  try {
    return new URL(address).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The variable a development build's own shell points the voice functions at,
 * read by name out of whatever provider the caller loads it under, the same
 * mechanism the account service's own override is read by.
 */
export const VOICE_SERVICE_ORIGIN_VARIABLE = "LUKE_VOICE_SERVICE_ORIGIN";

/**
 * The origin a build connects to: the pinned one, or — only where the caller
 * says the build is unpackaged and hands an override it read from its own
 * environment, the same mechanism the account service's development override
 * uses — that override reduced to its socket origin, so the account
 * service's own `http://localhost` override reaches the functions `vercel
 * dev` serves beside it. An override that is not an absolute URL is ignored
 * rather than reached.
 */
export function hostedVoiceServiceOrigin(options: {
  packaged: boolean;
  override: string | undefined;
}): string {
  if (options.packaged || options.override === undefined) return HOSTED_VOICE_SERVICE_ORIGIN;
  return webSocketOrigin(options.override) ?? HOSTED_VOICE_SERVICE_ORIGIN;
}

/**
 * The frames the desktop and the voice service exchange before Live events
 * flow. A socket opens with one of the desktop's two: `session.create` for a
 * new session, or `session.attach` for a session that stands already, because
 * the WebRTC session between the desktop and OpenAI outlives any one function
 * connection, which the platform closes at the function's maximum duration.
 */
export const VOICE_SERVICE_FRAME = {
  /** The device's opening frame for a new session: the offer, the voice, and the seed; or, on the audio route, the voice and the format. */
  SESSION_CREATE: "session.create",
  /** The service's answer once OpenAI has created the session and the sideband stands, or once the service's own socket to it has started. */
  SESSION_CREATED: "session.created",
  /** The desktop's opening frame on a fresh connection to a session this account created. */
  SESSION_ATTACH: "session.attach",
  /** The service's answer once its sideband stands on that session again. */
  SESSION_ATTACHED: "session.attached",
  /**
   * One of the two frames the desktop sends after the handshake in this
   * vocabulary: whether its peer has gone quiet, as the renderer's own idle
   * window reads it. The service's exchange decides the idle close against
   * the appends it made itself, so the report crosses to it; the relay reads
   * the frame and forwards it nowhere.
   */
  SESSION_ACTIVITY: "session.activity",
  /**
   * The other: the stop key. The desktop asks the service to tell the model
   * to stop and wait, and the service's exchange appends the one build-fixed
   * instruction that says so, so the desktop appends nothing to a session
   * and the relay forwards no instruction text of the desktop's choosing.
   */
  SESSION_STOP: "session.stop",
  /**
   * The third: a beat the desktop decided is owed, one of the build-fixed
   * scripts Luke says unprompted, with the bounded observed values that
   * script may mention and nothing else. The words are the service's: its
   * exchange speaks the script through `speakBeat`, so no sentence of the
   * desktop's composing reaches a session.
   */
  SESSION_BEAT: "session.beat",
  /**
   * The one frame the service sends the desktop after the handshake in this
   * vocabulary: a proactive turn was spoken to its end, by kind. The
   * decision and the record of what was spoken are the desktop's, so the
   * desktop is told rather than left to infer it from the transcript.
   */
  SESSION_SPOKEN: "session.spoken",
} as const;

/**
 * The one header the desktop adds to its `session.create` handshake beside
 * the bearer: the id of its own `devices` row, so the session the service
 * records names the installation that opened it, and a briefing offered to
 * the account can be claimed by that device and spoken into that session.
 * It rides the handshake rather than the frame because the service decides
 * who is asking before any frame is read. A fresh connection's
 * `session.attach` carries none: the session already names its device.
 * Absent, the session names no device, and a briefing on offer is left
 * unclaimed rather than claimed by nobody.
 */
export const VOICE_SERVICE_HEADER = {
  DEVICE_ID: "x-luke-device-id",
} as const;

/**
 * The character bounds of a `session.create` frame. The seed's message count
 * is the API's own, `LIVE_INPUT_BOUNDS.MESSAGES`; the bound per item's text is
 * the whole of the API's token budget for `input` at four characters a
 * token, so a frame the API would refuse is refused here before the service
 * spends a session on it. The offer bound is generous for an SDP, which is a
 * few kilobytes.
 */
export const SESSION_CREATE_BOUNDS = {
  ITEM_CHARS: LIVE_INPUT_BOUNDS.TOKENS * 4,
  SDP_CHARS: 65_536,
} as const;

/** What the service answered with: the session's opaque id and the SDP answer to set as the remote description. */
export interface LiveSessionCreated {
  sessionId: string;
  sdpAnswer: string;
}

/** The desktop's opening frame. */
export interface SessionCreateFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATE;
  sdp: string;
  voice: LiveVoice;
  input: InitialItem[];
}

/** The service's answer, and the allowance the session was spent against. */
export interface SessionCreatedFrame extends LiveSessionCreated {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATED;
  quota?: HostedQuota;
}

/**
 * The opening frame of a device that has no WebRTC of its own and streams
 * PCM through the service instead: the voice, and the one format the session
 * carries in both directions, chosen from `LIVE_AUDIO_FORMAT`. No offer,
 * since the service's own socket to OpenAI is the transport, and no seed,
 * since the phone seeds nothing and the watch follows it.
 */
export interface SessionAudioCreateFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATE;
  voice: LiveVoice;
  format: LiveAudioFormat;
}

/**
 * The service's answer on the audio route: the id `session.started` named,
 * which is the only place a session of the service's own socket names itself,
 * and the allowance the session was spent against. No SDP answer, since
 * nothing negotiated one.
 */
export interface SessionAudioCreatedFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_CREATED;
  sessionId: string;
  quota?: HostedQuota;
}

/** The desktop's opening frame on a connection to a session it already holds. */
export interface SessionAttachFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_ATTACH;
  sessionId: string;
}

/** The service's answer: the sideband stands again on the session named. */
export interface SessionAttachedFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_ATTACHED;
  sessionId: string;
}

/** Either frame a socket may open with. */
type SessionOpeningFrame = SessionCreateFrame | SessionAttachFrame;

/** The desktop's word on its peer after the handshake: idle, or heard again. */
export interface SessionActivityFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_ACTIVITY;
  idle: boolean;
}

/** The stop key pressed: the type alone, since what is said to the model is the service's fixed sentence. */
export interface SessionStopFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_STOP;
}

/**
 * A beat the desktop asks the service to speak. Each kind names exactly the
 * observed values its script may mention, each bounded as `@sidecar/live`
 * bounds a value before it enters an append; the calendar line mentions
 * nothing observed and carries nothing.
 */
export type SessionBeatFrame =
  | {
      type: typeof VOICE_SERVICE_FRAME.SESSION_BEAT;
      kind: typeof PROACTIVE_SPEECH_KIND.ARRIVAL;
      /** A working session's title, so the suggested first ask is about the developer's own work. */
      sessionTitle?: string;
      /** The talk key worded for a sentence, present only while holding it would open a turn. */
      talkKeyLabel?: string;
    }
  | {
      type: typeof VOICE_SERVICE_FRAME.SESSION_BEAT;
      kind: typeof PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING;
    }
  | {
      type: typeof VOICE_SERVICE_FRAME.SESSION_BEAT;
      kind: typeof PROACTIVE_SPEECH_KIND.LAUNCH;
      /** The signed-in account's first name, as the account service reported it. */
      firstName?: string;
    };

/** Any frame the desktop sends after the handshake in this vocabulary, read by the service and forwarded nowhere. */
export type SessionReportFrame = SessionActivityFrame | SessionStopFrame | SessionBeatFrame;

/** The service's word that a proactive turn was spoken to its end: the kind, and nothing of the words. */
export interface SessionSpokenFrame {
  type: typeof VOICE_SERVICE_FRAME.SESSION_SPOKEN;
  kind: ProactiveSpeechKind;
}

/**
 * A declaration handed the interface it decodes into, since Effect's `Schema`
 * is invariant in its decoded type and a struct assembled from field tables
 * only agrees with that interface rather than restating it. The same claim
 * the facade's own `schemaOver` made over its assembled AST.
 */
function schemaAs<Value>(schema: Schema.Top): Schema.Codec<Value, UnparsedWireValue> {
  return Schema.make<Schema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing, so nothing downstream sees a
 * `quota` it can ask `in` about unless one actually read.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Codec<Fields, Encoded>,
) {
  return schema.pipe(
    Schema.decodeTo(Schema.Unknown, {
      decode: SchemaGetter.transform((value) =>
        Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
      ),
      // Nothing here encodes a frame, and the shape the decode answers with
      // is `unknown`, so the way back is a passthrough that states it cannot
      // narrow.
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  );
}

/** A trimmed text, refused when only whitespace remains, and bounded past a maximum. */
function text(maximumChars?: number): Schema.Codec<string, string> {
  const trimmed = Schema.Trim.check(Schema.isNonEmpty());
  return maximumChars === undefined ? trimmed : trimmed.check(Schema.isMaxLength(maximumChars));
}

/**
 * An SDP is admitted as written: its lines are its syntax, and a reader that
 * trimmed or collapsed them would hand the peer something the other end did
 * not say. A seed item's text is kept the same way, for the reason the seed
 * wrote it. Whitespace-only is still refused, but — unlike {@link text} — the
 * refusal carries no bound a model is shown, since JSON Schema cannot say
 * "not only whitespace" without also claiming a character count it does not
 * enforce.
 */
function verbatimText(maximumChars: number): Schema.Codec<string, string> {
  return Schema.String.check(
    Schema.isMaxLength(maximumChars),
    Schema.makeFilter((value) => value.trim().length > 0, wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
  );
}

const itemText = verbatimText(SESSION_CREATE_BOUNDS.ITEM_CHARS);

/**
 * Exactly one part, answered as the one-element tuple the seed type names
 * rather than as a list that happens to hold one. The list bound already
 * refuses any other count; the reader is what lets the type say so.
 */
function onlyPart<Part, Encoded>(
  part: Schema.Codec<Part, Encoded>,
): Schema.Codec<readonly [Part], UnparsedWireValue> {
  const list = Schema.Array(part).check(Schema.isMinLength(1), Schema.isMaxLength(1));
  const read = readEither(list);
  return declareReader<readonly [Part]>((value) => {
    const result = read(value);
    if (Result.isFailure(result)) {
      return { ok: false, refusal: result.failure.refusal, path: result.failure.path };
    }
    const [only] = result.success;
    return only === undefined
      ? { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] }
      : { ok: true, value: [only] };
  }, emitJsonSchema(list));
}

/**
 * One history message as `@sidecar/live` seeds it: the `message` type, a
 * role, and exactly one text part of the type that role writes. The SDK's
 * `InitialItem` also allows an id, a status, and a plain `text` part; none
 * is admitted, because the service composes the request to OpenAI from this
 * frame and takes into it only what the desktop's seed has a reason to send.
 */
function seedMessage<
  Role extends InitialItem["role"],
  Part extends InitialItem["content"][0]["type"],
>(role: Role, part: Part) {
  return Schema.Struct({
    type: Schema.Literal(SEED_ITEM_TYPE),
    role: Schema.Literal(role),
    content: onlyPart(Schema.Struct({ type: Schema.Literal(part), text: itemText })),
  });
}

const liveInitialItemSchema = Schema.Union([
  seedMessage(SEED_ROLE.DEVELOPER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.USER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.ASSISTANT, SEED_CONTENT_TYPE.OUTPUT_TEXT),
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export const sessionCreateFrameSchema = schemaAs<SessionCreateFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATE),
    sdp: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
    voice: Schema.Literals(LIVE_VOICE_LIST),
    input: Schema.Array(liveInitialItemSchema).check(
      Schema.isMaxLength(LIVE_INPUT_BOUNDS.MESSAGES),
    ),
  }),
);

/** A GPT Live session id is opaque and short; the bound only refuses a document standing in for one. */
const SESSION_ID_CHARS = 256;

const sessionId = text(SESSION_ID_CHARS);

export const sessionAudioCreateFrameSchema = schemaAs<SessionAudioCreateFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATE),
    voice: Schema.Literals(LIVE_VOICE_LIST),
    format: LiveAudioFormatSchema,
  }),
);

export const sessionAttachFrameSchema = schemaAs<SessionAttachFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACH),
    sessionId,
  }),
);

export const sessionOpeningFrameSchema = schemaAs<SessionOpeningFrame>(
  Schema.Union([sessionCreateFrameSchema, sessionAttachFrameSchema]).annotate(
    wireRefusal(SCHEMA_REFUSAL.MALFORMED),
  ),
);

export const sessionActivityFrameSchema = schemaAs<SessionActivityFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ACTIVITY),
    idle: Schema.Boolean,
  }),
);

export const sessionStopFrameSchema = schemaAs<SessionStopFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_STOP),
  }),
);

/** An observed value a beat may mention, bounded here as the append that will carry it is bounded. */
const beatValue = Schema.optional(text(OBSERVED_VALUE_LENGTH));

export const sessionBeatFrameSchema = schemaAs<SessionBeatFrame>(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_BEAT),
      kind: Schema.Literal(PROACTIVE_SPEECH_KIND.ARRIVAL),
      sessionTitle: beatValue,
      talkKeyLabel: beatValue,
    }),
    Schema.Struct({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_BEAT),
      kind: Schema.Literal(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING),
    }),
    Schema.Struct({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_BEAT),
      kind: Schema.Literal(PROACTIVE_SPEECH_KIND.LAUNCH),
      firstName: beatValue,
    }),
  ]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
);

export const sessionReportFrameSchema = schemaAs<SessionReportFrame>(
  Schema.Union([
    sessionActivityFrameSchema,
    sessionStopFrameSchema,
    sessionBeatFrameSchema,
  ]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
);

export const sessionSpokenFrameSchema = schemaAs<SessionSpokenFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_SPOKEN),
    kind: ProactiveSpeechKindSchema,
  }),
);

export const sessionAttachedFrameSchema = schemaAs<SessionAttachedFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACHED),
    sessionId,
  }),
);

const CREATED_FIELDS = {
  sessionId,
  sdpAnswer: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
} as const;

export const liveSessionCreatedSchema = schemaAs<LiveSessionCreated>(Schema.Struct(CREATED_FIELDS));

/**
 * The value a frame's schema admitted, or nothing. A frame the desktop sends
 * is read as declared, refusing a key it does not name; a frame the service
 * answers with is read through {@link admittedAnswer}, which drops one a
 * newer service added rather than refusing the whole frame. That grain is
 * the read's now rather than the declaration's, and the option reaches every
 * record nested inside.
 */
function admitted<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/** The same read, for a frame the service answers with. */
function admittedAnswer<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

export function sessionAudioCreateFrameFromWire(
  value: UnparsedWireValue,
): SessionAudioCreateFrame | undefined {
  return admitted(sessionAudioCreateFrameSchema, value);
}

export function sessionOpeningFrameFromWire(
  value: UnparsedWireValue,
): SessionOpeningFrame | undefined {
  return admitted(sessionOpeningFrameSchema, value);
}

export function sessionActivityFrameFromWire(
  value: UnparsedWireValue,
): SessionActivityFrame | undefined {
  return admitted(sessionActivityFrameSchema, value);
}

export function sessionReportFrameFromWire(
  value: UnparsedWireValue,
): SessionReportFrame | undefined {
  return admitted(sessionReportFrameSchema, value);
}

/**
 * The service says a beat was spoken, so the read is the answering one: a key
 * a newer service added is dropped rather than refusing the whole frame. On
 * the v3 side this record carried its own `onExcessProperty: "ignore"`; v4
 * states that grain at the read, which is what {@link admittedAnswer} is.
 */
export function sessionSpokenFrameFromWire(
  value: UnparsedWireValue,
): SessionSpokenFrame | undefined {
  return admittedAnswer(sessionSpokenFrameSchema, value);
}

export function sessionAttachedFrameFromWire(
  value: UnparsedWireValue,
): SessionAttachedFrame | undefined {
  return admittedAnswer(sessionAttachedFrameSchema, value);
}

export function liveSessionCreatedFromWire(
  value: UnparsedWireValue,
): LiveSessionCreated | undefined {
  return admittedAnswer(liveSessionCreatedSchema, value);
}

/** The value a `dropRefused` field admits: whatever the schema read, or nothing. */
function droppedField<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
): Schema.Codec<Value | undefined, UnparsedWireValue> {
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: admittedAnswer(schema, value) }),
    emitJsonSchema(schema),
  );
}

export const sessionCreatedFrameSchema = schemaAs<SessionCreatedFrame>(
  omittingUndefinedKeys(
    Schema.Struct({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATED),
      ...CREATED_FIELDS,
      quota: Schema.optionalKey(droppedField(hostedQuotaSchema)),
    }),
  ),
);

export function sessionCreatedFrameFromWire(
  value: UnparsedWireValue,
): SessionCreatedFrame | undefined {
  return admittedAnswer(sessionCreatedFrameSchema, value);
}

export const sessionAudioCreatedFrameSchema = schemaAs<SessionAudioCreatedFrame>(
  omittingUndefinedKeys(
    Schema.Struct({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATED),
      sessionId,
      quota: Schema.optionalKey(droppedField(hostedQuotaSchema)),
    }),
  ),
);

export function sessionAudioCreatedFrameFromWire(
  value: UnparsedWireValue,
): SessionAudioCreatedFrame | undefined {
  return admittedAnswer(sessionAudioCreatedFrameSchema, value);
}
