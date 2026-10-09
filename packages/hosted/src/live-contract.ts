import {
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_VOICE_LIST,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "@sidecar/live";
import { EXCESS_KEYS, SCHEMA_REFUSAL, type UnparsedWireValue } from "@sidecar/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Result, Schema, SchemaGetter } from "effect";
import { codeRefSchema, planDocumentSchema } from "./plan-wire.js";
import { planActivitySchema, planWorkTurnSchema } from "./planning-view.js";
import { hostedQuotaSchema, wireUuidSchema } from "./service-wire.js";

/**
 * The desktop's contract with the hosted voice service: the Vercel Function
 * of Luke's own service that holds the GPT Live project key. It creates a
 * WebRTC session at OpenAI (`POST /v1/live/sessions`) from the desktop's
 * offer, attaches the trusted sideband itself, and then carries Live events
 * between the desktop and OpenAI untouched. The desktop reaches it over one
 * WebSocket per function connection, and what travels on that socket before
 * the Live events do is declared here, once, for both ends.
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
  /** The desktop's opening frame for a new session: the offer, the voice, the seed, and the plan the call is about. */
  SESSION_CREATE: "session.create",
  /** The service's answer once OpenAI has created the session and the sideband stands. */
  SESSION_CREATED: "session.created",
  /** The desktop's opening frame on a fresh connection to a session this account created. */
  SESSION_ATTACH: "session.attach",
  /** The service's answer once its sideband stands on that session again. */
  SESSION_ATTACHED: "session.attached",
  /**
   * One of the three frames the desktop sends after the handshake in this
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
   * The third: the hang-up. The service owns a session's `session.close`,
   * as the server-controls guide asks one owner per action, so the desktop
   * asks for the close rather than sending it, and the service's exchange
   * sends the one close and records what `session.closed` reports. The
   * relay reads it by its type, as it reads a device's own `session.close`,
   * so it is no report and nothing past its type is read.
   */
  SESSION_HANG_UP: "session.hangup",
  /**
   * The service's frame to the desktop after the handshake: the plan's
   * document as its notetaker is writing it,
   * sent again as the draft grows and once more as saved, so the Plans tab
   * types the plan in while the call goes on rather than waiting for a read.
   */
  PLAN_DRAFT: "plan.draft",
  /**
   * The service's other frame to the desktop: what each part of Luke is
   * doing now, the voice, the planning model, and the
   * notetaker, sent whole each time any of them changes, so the Plans tab
   * says each part's own state rather than one word for all of them.
   */
  PLAN_ACTIVITY: "plan.activity",
  /**
   * The service's fourth frame to the desktop, on a planning call alone:
   * code of the plan's folder Luke is about to talk about, by place, sent as
   * he starts to speak, so the Plans tab's code pane draws it from the
   * Mac's own folder as he says it.
   */
  PLAN_CODE: "plan.code",
  /**
   * The service's fifth frame to the desktop, on a planning call alone: one
   * planning turn's work as it stands, what the model wrote and each call
   * it made with its output, sent whole each time it changes, so the Plans
   * tab's Work tab reads like an agent's own transcript.
   */
  PLAN_WORK: "plan.work",
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

/** A struct's type with every key that could hold `undefined` holding a value or absent instead. */
type OmittingUndefined<Fields> = { [Key in keyof Fields]: Exclude<Fields[Key], undefined> };

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing, so nothing downstream sees a
 * `quota` it can ask `in` about unless one actually read. The decode's
 * target is stated as the struct's own type less those `undefined`s, since
 * the transform is what makes that true and no declaration can say it.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Codec<Fields, Encoded>,
): Schema.Codec<OmittingUndefined<Fields>, UnparsedWireValue> {
  const omitting = schema.pipe(
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
  return Schema.make<Schema.Codec<OmittingUndefined<Fields>, UnparsedWireValue>>(omitting.ast);
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

/**
 * The desktop's opening frame: the offer, the voice, the seed, and the id of
 * the saved plan the call is about. The service checks the plan is the
 * account's, creates the session under the planning scene, lands its asks in
 * the plan's conversation, and writes the binding on the session's row, so a
 * later `session.attach` is bound to the same plan by that row and never by
 * anything the attaching connection says. The id names the plan and nothing
 * of its document.
 */
export const sessionCreateFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATE),
  sdp: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
  voice: Schema.Literals(LIVE_VOICE_LIST),
  input: Schema.Array(liveInitialItemSchema).check(Schema.isMaxLength(LIVE_INPUT_BOUNDS.MESSAGES)),
  planId: wireUuidSchema,
});

export type SessionCreateFrame = typeof sessionCreateFrameSchema.Type;

/** A GPT Live session id is opaque and short; the bound only refuses a document standing in for one. */
const SESSION_ID_CHARS = 256;

const sessionId = text(SESSION_ID_CHARS);

/** The desktop's opening frame on a connection to a session it already holds. */
export const sessionAttachFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACH),
  sessionId,
});

export type SessionAttachFrame = typeof sessionAttachFrameSchema.Type;

/** Either frame a socket may open with. */
export const sessionOpeningFrameSchema = Schema.Union([
  sessionCreateFrameSchema,
  sessionAttachFrameSchema,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

type SessionOpeningFrame = typeof sessionOpeningFrameSchema.Type;

/** The desktop's word on its peer after the handshake: idle, or heard again. */
export const sessionActivityFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ACTIVITY),
  idle: Schema.Boolean,
});

export type SessionActivityFrame = typeof sessionActivityFrameSchema.Type;

/** The stop key pressed: the type alone, since what is said to the model is the service's fixed sentence. */
export const sessionStopFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_STOP),
});

export type SessionStopFrame = typeof sessionStopFrameSchema.Type;

/** The hang-up: the type alone, since the close it asks for is the service's to send. */
export const sessionHangUpFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_HANG_UP),
});

export type SessionHangUpFrame = typeof sessionHangUpFrameSchema.Type;

/** Any frame the desktop sends after the handshake in this vocabulary, read by the service and forwarded nowhere. */
export const sessionReportFrameSchema = Schema.Union([
  sessionActivityFrameSchema,
  sessionStopFrameSchema,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export type SessionReportFrame = typeof sessionReportFrameSchema.Type;

/**
 * The plan's document as the notetaker has it now: a draft while its model is
 * still writing, and the saved document with the instant it was saved once
 * the save lands, or the document as it stood where the run saved nothing.
 */
export const planDraftFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.PLAN_DRAFT),
  planId: wireUuidSchema,
  document: planDocumentSchema,
  /** Epoch milliseconds of the save the document is; absent while it is a draft. */
  savedAt: Schema.optionalKey(Schema.Number),
});

export type PlanDraftFrame = typeof planDraftFrameSchema.Type;

/** The activity on the call about the plan named, as the service sends it to the desktop. */
export const planActivityFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.PLAN_ACTIVITY),
  planId: wireUuidSchema,
  ...planActivitySchema.fields,
});

export type PlanActivityFrame = typeof planActivityFrameSchema.Type;

/** Code Luke put on screen on the call about the plan named, by place, as the service sends it to the desktop. */
export const planCodeFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.PLAN_CODE),
  planId: wireUuidSchema,
  ref: codeRefSchema,
});

export type PlanCodeFrame = typeof planCodeFrameSchema.Type;

/** One planning turn's work on the call about the plan named, as the service sends it to the desktop. */
export const planWorkFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.PLAN_WORK),
  planId: wireUuidSchema,
  turn: planWorkTurnSchema,
});

export type PlanWorkFrame = typeof planWorkFrameSchema.Type;

/** The service's answer: the sideband stands again on the session named. */
export const sessionAttachedFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_ATTACHED),
  sessionId,
});

export type SessionAttachedFrame = typeof sessionAttachedFrameSchema.Type;

/**
 * What the service answered with: the session's opaque id, the SDP answer to
 * set as the remote description, and, for a session an account opened, the
 * store's own id for the session's row, the one a stored spoken row names as
 * its `voice_session_id`.
 */
const liveSessionCreatedSchema = Schema.Struct({
  sessionId,
  sdpAnswer: verbatimText(SESSION_CREATE_BOUNDS.SDP_CHARS),
  voiceSessionId: Schema.optionalKey(sessionId),
});

export type LiveSessionCreated = typeof liveSessionCreatedSchema.Type;

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
 * The service's draft of the open plan, read the answering way: a key a
 * newer service added is dropped rather than refusing the whole frame.
 */
export function planDraftFrameFromWire(value: UnparsedWireValue): PlanDraftFrame | undefined {
  return admittedAnswer(planDraftFrameSchema, value);
}

/** What each part of Luke is doing on a planning call, read the same answering way. */
export function planActivityFrameFromWire(value: UnparsedWireValue): PlanActivityFrame | undefined {
  return admittedAnswer(planActivityFrameSchema, value);
}

/** The code Luke put on screen on a planning call, read the same answering way. */
export function planCodeFrameFromWire(value: UnparsedWireValue): PlanCodeFrame | undefined {
  return admittedAnswer(planCodeFrameSchema, value);
}

/** One planning turn's work on a planning call, read the same answering way. */
export function planWorkFrameFromWire(value: UnparsedWireValue): PlanWorkFrame | undefined {
  return admittedAnswer(planWorkFrameSchema, value);
}

export function sessionAttachedFrameFromWire(
  value: UnparsedWireValue,
): SessionAttachedFrame | undefined {
  return admittedAnswer(sessionAttachedFrameSchema, value);
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

/** The service's answer, and the allowance the session was spent against. */
export const sessionCreatedFrameSchema = omittingUndefinedKeys(
  Schema.Struct({
    type: Schema.Literal(VOICE_SERVICE_FRAME.SESSION_CREATED),
    ...liveSessionCreatedSchema.fields,
    quota: Schema.optionalKey(droppedField(hostedQuotaSchema)),
  }),
);

export type SessionCreatedFrame = typeof sessionCreatedFrameSchema.Type;

export function sessionCreatedFrameFromWire(
  value: UnparsedWireValue,
): SessionCreatedFrame | undefined {
  return admittedAnswer(sessionCreatedFrameSchema, value);
}
