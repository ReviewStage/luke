import {
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_VOICE_LIST,
  type LiveVoice,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "@sidecar/live";
import {
  effectSchema,
  SCHEMA_REFUSAL,
  type SchemaRead,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Either, Schema } from "effect";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * The desktop's contract with the hosted voice service: the two Vercel
 * Functions of Luke's own service that hold the GPT Live project key, create
 * the session at OpenAI (`POST /v1/live/sessions`), attach the trusted
 * sideband themselves, and then carry Live events between the desktop and
 * OpenAI untouched. The desktop reaches them over one WebSocket per function
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
  /** The desktop's opening frame for a new session: the offer, the voice, and the seed. */
  SESSION_CREATE: "session.create",
  /** The service's answer once OpenAI has created the session and the sideband stands. */
  SESSION_CREATED: "session.created",
  /** The desktop's opening frame on a fresh connection to a session this account created. */
  SESSION_ATTACH: "session.attach",
  /** The service's answer once its sideband stands on that session again. */
  SESSION_ATTACHED: "session.attached",
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
export type SessionOpeningFrame = SessionCreateFrame | SessionAttachFrame;

/**
 * A declaration handed the interface it decodes into, since Effect's `Schema`
 * is invariant in its decoded type and a struct assembled from field tables
 * only agrees with that interface rather than restating it. The same claim
 * the facade's own `schemaOver` made over its assembled AST.
 */
function schemaAs<Value>(schema: Schema.Schema.Any): Schema.Schema<Value, UnparsedWireValue> {
  return Schema.make<Value, UnparsedWireValue>(schema.ast);
}

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does and a request never does. Each record states its own rule, because
 * Effect hands a struct's parse options down to the structs inside it and a
 * read is strict wherever nothing says otherwise.
 */
const tolerantRecord = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing, so nothing downstream sees a
 * `quota` it can ask `in` about unless one actually read.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Schema<Fields, Encoded>,
) {
  return Schema.transform(schema, Schema.Unknown, {
    strict: false,
    decode: (value) =>
      Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
    encode: (value) => value,
  });
}

/** A trimmed text, refused when only whitespace remains, and bounded past a maximum. */
function text(maximumChars?: number): Schema.Schema<string, string> {
  const trimmed = Schema.transform(Schema.String, Schema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(Schema.minLength(1));
  return maximumChars === undefined ? trimmed : trimmed.pipe(Schema.maxLength(maximumChars));
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
function verbatimText(maximumChars: number): Schema.Schema<string, string> {
  return Schema.String.pipe(
    Schema.maxLength(maximumChars),
    Schema.filter((value) => value.trim().length > 0, wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
  );
}

const itemText = verbatimText(SESSION_CREATE_BOUNDS.ITEM_CHARS);

/**
 * Exactly one part, answered as the one-element tuple the seed type names
 * rather than as a list that happens to hold one. The list bound already
 * refuses any other count; the reader is what lets the type say so.
 */
function onlyPart<Part, Encoded>(
  part: Schema.Schema<Part, Encoded>,
): Schema.Schema<readonly [Part], UnparsedWireValue> {
  const list = Schema.Array(part).pipe(Schema.minItems(1), Schema.maxItems(1));
  const read = readEither(list);
  return declareReader<readonly [Part]>((value) => {
    const result = read(value);
    if (Either.isLeft(result)) {
      return { ok: false, refusal: result.left.refusal, path: result.left.path };
    }
    const [only] = result.right;
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

const liveInitialItemSchema = Schema.Union(
  seedMessage(SEED_ROLE.DEVELOPER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.USER, SEED_CONTENT_TYPE.INPUT_TEXT),
  seedMessage(SEED_ROLE.ASSISTANT, SEED_CONTENT_TYPE.OUTPUT_TEXT),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export const sessionCreateFrameSchema = schemaAs<SessionCreateFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATE),
    sdp: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
    voice: Schema.Literal(...LIVE_VOICE_LIST),
    input: Schema.Array(liveInitialItemSchema).pipe(Schema.maxItems(LIVE_INPUT_BOUNDS.MESSAGES)),
  }),
);

/** A GPT Live session id is opaque and short; the bound only refuses a document standing in for one. */
const SESSION_ID_CHARS = 256;

const sessionId = text(SESSION_ID_CHARS);

export const sessionAttachFrameSchema = schemaAs<SessionAttachFrame>(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACH),
    sessionId,
  }),
);

export const sessionOpeningFrameSchema = schemaAs<SessionOpeningFrame>(
  Schema.Union(sessionCreateFrameSchema, sessionAttachFrameSchema).annotations(
    wireRefusal(SCHEMA_REFUSAL.MALFORMED),
  ),
);

export const sessionAttachedFrameSchema = schemaAs<SessionAttachedFrame>(
  tolerantRecord({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACHED),
    sessionId,
  }),
);

const CREATED_FIELDS = {
  sessionId,
  sdpAnswer: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
} as const;

export const liveSessionCreatedSchema = schemaAs<LiveSessionCreated>(
  tolerantRecord(CREATED_FIELDS),
);

/** The value a schema admitted, or nothing, for a caller that only cares whether the value is admissible. */
function admitted<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

/** The value a schema admitted, or the refusal and where it happened. */
function read<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): SchemaRead<Value> {
  return Either.match(readEither(schema)(value), {
    onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
    onRight: (parsed) => ({ ok: true, value: parsed }),
  });
}

export function sessionCreateFrameFromWire(
  value: UnparsedWireValue,
): SessionCreateFrame | undefined {
  return admitted(sessionCreateFrameSchema, value);
}

export function sessionCreateFrameRead(value: UnparsedWireValue): SchemaRead<SessionCreateFrame> {
  return read(sessionCreateFrameSchema, value);
}

export function sessionAttachFrameFromWire(
  value: UnparsedWireValue,
): SessionAttachFrame | undefined {
  return admitted(sessionAttachFrameSchema, value);
}

export function sessionOpeningFrameFromWire(
  value: UnparsedWireValue,
): SessionOpeningFrame | undefined {
  return admitted(sessionOpeningFrameSchema, value);
}

export function sessionAttachedFrameFromWire(
  value: UnparsedWireValue,
): SessionAttachedFrame | undefined {
  return admitted(sessionAttachedFrameSchema, value);
}

export function liveSessionCreatedFromWire(
  value: UnparsedWireValue,
): LiveSessionCreated | undefined {
  return admitted(liveSessionCreatedSchema, value);
}

/** The value a `dropRefused` field admits: whatever the schema read, or nothing. */
function droppedField<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
): Schema.Schema<Value | undefined, UnparsedWireValue> {
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: admitted(schema, value) }),
    emitJsonSchema(schema),
  );
}

export const sessionCreatedFrameSchema = schemaAs<SessionCreatedFrame>(
  omittingUndefinedKeys(
    tolerantRecord({
      type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATED),
      ...CREATED_FIELDS,
      quota: Schema.optionalWith(droppedField(effectSchema(hostedQuotaSchema)), { exact: true }),
    }),
  ),
);

export function sessionCreatedFrameFromWire(
  value: UnparsedWireValue,
): SessionCreatedFrame | undefined {
  return admitted(sessionCreatedFrameSchema, value);
}
