import {
  type InitialItem,
  LIVE_INPUT_BOUNDS,
  LIVE_VOICE_LIST,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
} from "@luke/live";
import { EXCESS_KEYS, isWireString, SCHEMA_REFUSAL, type UnparsedWireValue } from "@luke/wire";
import { declareReader, emitJsonSchema, readEither, wireRefusal } from "@luke/wire/effect";
import { Result, Schema, SchemaGetter } from "effect";
import { AVATAR_GRANT_BOUNDS, avatarGrantSchema } from "./avatar-grant.js";
import { hostedQuotaSchema, wireUuidSchema } from "./service-wire.js";
import { planDocumentSchema, planSectionEditSchema } from "./task-wire.js";
import { taskActivitySchema, taskShownCodeSchema, taskWorkTurnSchema } from "./tasks-view.js";
import { VIDEO_AVATAR, VIDEO_AVATAR_LIST, type VideoAvatar } from "./video-avatar.js";

/**
 * The desktop's contract with the hosted voice service: the Vercel Function
 * of Luke's own service that holds the GPT Live project key. It creates a
 * WebRTC session at OpenAI (`POST /v1/live/sessions`) from the desktop's
 * offer, attaches the trusted sideband itself, and then carries Live events
 * between the desktop and OpenAI untouched. The desktop reaches it over one
 * WebSocket per function connection, and what travels on that socket before
 * the Live events do is declared here, once, for both ends.
 *
 * Note that `planId`, `planner`, and the `plan.*` frames keep the wire's legacy spelling of a task, because a
 * released desktop sends and reads them; they are renamed with the wire in a
 * follow-up, with no alias.
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
  TASK_ACTIVITY: "plan.activity",
  /**
   * The service's fourth frame to the desktop, on a planning call alone:
   * code of the plan's repository Luke is about to talk about, with its
   * lines as the service read them from the planning session's checkout,
   * sent as he starts to speak, so the Plans tab's code pane draws it as he
   * says it.
   */
  TASK_CODE: "plan.code",
  /**
   * The service's fifth frame to the desktop, on a planning call alone: one
   * planning turn's work as it stands, what the model wrote and each call
   * it made with its output, sent whole each time it changes, so the Plans
   * tab's Work tab reads like an agent's own transcript.
   */
  TASK_WORK: "plan.work",
  /**
   * The service's sixth frame to the desktop, on a planning call alone: the
   * developer said they are done and Luke is saying goodbye, so the desktop
   * hangs up through its own hang-up once that goodbye has played, and keeps
   * the call up if the developer speaks first. It carries no words.
   */
  TASK_CALL_ENDING: "plan.call_ending",
  /**
   * The desktop's ask for Luke's avatar on the call: the service mints a
   * Keyframe session for this voice session on its own key and answers
   * `avatar.started`, or `avatar.unavailable` where it cannot, each echoing
   * the request id the host minted for it, as `avatar.stop` does. The relay
   * reads it and forwards it nowhere, as it reads a report.
   */
  AVATAR_START: "avatar.start",
  /** The desktop's word that the avatar is down, with why; the voice goes on. */
  AVATAR_STOP: "avatar.stop",
  /**
   * The service's answer to `avatar.start`: the room Keyframe renders the
   * avatar into, the per-call token that joins it, and the identity the
   * avatar publishes under. The token is the one credential this vocabulary
   * carries, and it reaches the floating call window alone.
   */
  AVATAR_STARTED: "avatar.started",
  /** The service's answer to an `avatar.start` it could not honour, and why. */
  AVATAR_UNAVAILABLE: "avatar.unavailable",
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
 * One history message as `@luke/live` seeds it: the `message` type, a
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
 * Each names the save it was drawn over, so a window that saved an edit of
 * its own since can drop a draft that does not hold it; the saved one
 * carries who last changed each section, which each section's line reads.
 */
export const planDraftFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.PLAN_DRAFT),
  planId: wireUuidSchema,
  document: planDocumentSchema,
  /** Epoch milliseconds of the save the document is; absent while it is a draft. */
  savedAt: Schema.optionalKey(Schema.Number),
  /** Epoch milliseconds of the save the notetaker read before it wrote; absent from a service before editing. */
  readAt: Schema.optionalKey(Schema.Number),
  /** For a plan that is one document, the save that last changed each section after the save; absent while it is a draft, and for any other plan. */
  sectionEdits: Schema.optionalKey(Schema.Array(planSectionEditSchema)),
});

export type PlanDraftFrame = typeof planDraftFrameSchema.Type;

/** The activity on the call about the plan named, as the service sends it to the desktop. */
export const taskActivityFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.TASK_ACTIVITY),
  planId: wireUuidSchema,
  ...taskActivitySchema.fields,
});

export type TaskActivityFrame = typeof taskActivityFrameSchema.Type;

/**
 * Code Luke put on screen on the call about the plan named, with its lines
 * as the service read them from the plan's repository, and the `show_code`
 * call and turn that showed it, as the plan's work reads them back, so the
 * desktop holds a call's code and the record's copy of it once.
 */
export const taskCodeFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.TASK_CODE),
  planId: wireUuidSchema,
  ...taskShownCodeSchema.fields,
});

export type TaskCodeFrame = typeof taskCodeFrameSchema.Type;

/** One planning turn's work on the call about the plan named, as the service sends it to the desktop. */
export const taskWorkFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.TASK_WORK),
  planId: wireUuidSchema,
  turn: taskWorkTurnSchema,
});

export type TaskWorkFrame = typeof taskWorkFrameSchema.Type;

/** Luke is ending the call about the plan named, once his goodbye has played. */
export const taskCallEndingFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.TASK_CALL_ENDING),
  planId: wireUuidSchema,
});

export type TaskCallEndingFrame = typeof taskCallEndingFrameSchema.Type;

/**
 * Why the desktop took the avatar down: the developer turned video off,
 * Keyframe closed the call window's session, or the session failed there.
 * A hang-up needs no stop of its own, since the service closes the avatar
 * with the call.
 */
export const AVATAR_STOP_REASON = {
  USER: "user",
  SERVER_CLOSED: "server_closed",
  ERROR: "error",
} as const;

export type AvatarStopReason = (typeof AVATAR_STOP_REASON)[keyof typeof AVATAR_STOP_REASON];

/**
 * Why the service could not put the avatar up: this deployment holds no
 * Keyframe key or persona, the plan's concurrent sessions are all taken, or
 * anything else Keyframe answered.
 */
export const AVATAR_UNAVAILABLE_REASON = {
  NOT_CONFIGURED: "not_configured",
  NO_CAPACITY: "no_capacity",
  ERROR: "error",
} as const;

export type AvatarUnavailableReason =
  (typeof AVATAR_UNAVAILABLE_REASON)[keyof typeof AVATAR_UNAVAILABLE_REASON];

/**
 * The bounds of the avatar frames. A LiveKit participant token is a JWT of a
 * few hundred bytes, an identity a few dozen characters, a server URL not
 * much more, and a request id the host's own UUID, so each bound only
 * refuses a document standing in for one.
 */
export const AVATAR_FRAME_BOUNDS = {
  REQUEST_ID_CHARS: 64,
  ...AVATAR_GRANT_BOUNDS,
  REASON_CHARS: 64,
  AVATAR_CHARS: 64,
} as const;

/**
 * A reason the service answers with. One a newer service added reads as
 * `fallback` rather than refusing the frame, as an answer's unknown key is
 * dropped rather than refused, so the desktop still hears the avatar is not
 * coming when it cannot say why. Past the bound it is refused, since no
 * reason is that long.
 */
function answeredReason<const Reason extends string>(
  reasons: readonly Reason[],
  fallback: Reason,
): Schema.Codec<Reason, UnparsedWireValue> {
  const listed = Schema.Literals(reasons);
  const isListed = Schema.is(listed);
  return declareReader<Reason>((value) => {
    if (!isWireString(value) || value.length > AVATAR_FRAME_BOUNDS.REASON_CHARS) {
      return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] };
    }
    return { ok: true, value: isListed(value) ? value : fallback };
  }, emitJsonSchema(listed));
}

/**
 * The avatar a start asks for. One a newer Mac lists and this service does
 * not reads as the default rather than refusing the start, so the call
 * still shows Luke on video, as the deployment's own persona. Past the
 * bound it is refused, since no avatar's key is that long.
 */
const askedAvatar: Schema.Codec<VideoAvatar, UnparsedWireValue> = (() => {
  const listed = Schema.Literals(VIDEO_AVATAR_LIST);
  const isListed = Schema.is(listed);
  return declareReader<VideoAvatar>((value) => {
    if (!isWireString(value) || value.length > AVATAR_FRAME_BOUNDS.AVATAR_CHARS) {
      return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] };
    }
    return { ok: true, value: isListed(value) ? value : VIDEO_AVATAR.DEFAULT };
  }, emitJsonSchema(listed));
})();

/**
 * The id the host mints for one `avatar.start`, echoed on every frame about
 * the session that ask put up, so an answer or a stop that belongs to an
 * earlier ask is told apart from the current one.
 */
const avatarRequestId = verbatimText(AVATAR_FRAME_BOUNDS.REQUEST_ID_CHARS);

/**
 * The desktop's ask for the avatar: its request id, and the avatar the
 * developer chose by its key, never Keyframe's persona id, since the service
 * maps the key to the persona it mints. A start naming none asks for the
 * deployment's default, as every start from a build before the choice did.
 */
export const avatarStartFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.AVATAR_START),
  requestId: avatarRequestId,
  avatar: Schema.optionalKey(askedAvatar),
});

export type AvatarStartFrame = typeof avatarStartFrameSchema.Type;

/** The desktop's word that the avatar its request put up is down, and why. */
export const avatarStopFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.AVATAR_STOP),
  requestId: avatarRequestId,
  reason: Schema.Literals(Object.values(AVATAR_STOP_REASON)),
});

export type AvatarStopFrame = typeof avatarStopFrameSchema.Type;

/** Either avatar frame the desktop sends after the handshake, read by the service and forwarded nowhere. */
export const avatarRequestFrameSchema = Schema.Union([
  avatarStartFrameSchema,
  avatarStopFrameSchema,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export type AvatarRequestFrame = typeof avatarRequestFrameSchema.Type;

/**
 * The avatar the request asked for is coming up: Keyframe's session grant
 * as its create-session call answered it, the LiveKit server, the participant token the call
 * window joins with, and the identity the avatar publishes its tracks under.
 */
export const avatarStartedFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.AVATAR_STARTED),
  requestId: avatarRequestId,
  ...avatarGrantSchema.fields,
});

export type AvatarStartedFrame = typeof avatarStartedFrameSchema.Type;

/** The avatar the request asked for could not come up, and why; the call goes on as voice. */
export const avatarUnavailableFrameSchema = Schema.Struct({
  type: Schema.Literal(VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE),
  requestId: avatarRequestId,
  reason: answeredReason(Object.values(AVATAR_UNAVAILABLE_REASON), AVATAR_UNAVAILABLE_REASON.ERROR),
});

export type AvatarUnavailableFrame = typeof avatarUnavailableFrameSchema.Type;

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
export function taskActivityFrameFromWire(value: UnparsedWireValue): TaskActivityFrame | undefined {
  return admittedAnswer(taskActivityFrameSchema, value);
}

/** The code Luke put on screen on a planning call, read the same answering way. */
export function taskCodeFrameFromWire(value: UnparsedWireValue): TaskCodeFrame | undefined {
  return admittedAnswer(taskCodeFrameSchema, value);
}

/** One planning turn's work on a planning call, read the same answering way. */
export function taskWorkFrameFromWire(value: UnparsedWireValue): TaskWorkFrame | undefined {
  return admittedAnswer(taskWorkFrameSchema, value);
}

/** Luke ending a planning call, read the same answering way. */
export function taskCallEndingFrameFromWire(
  value: UnparsedWireValue,
): TaskCallEndingFrame | undefined {
  return admittedAnswer(taskCallEndingFrameSchema, value);
}

export function avatarRequestFrameFromWire(
  value: UnparsedWireValue,
): AvatarRequestFrame | undefined {
  return admitted(avatarRequestFrameSchema, value);
}

/** The avatar coming up, read the answering way. */
export function avatarStartedFrameFromWire(
  value: UnparsedWireValue,
): AvatarStartedFrame | undefined {
  return admittedAnswer(avatarStartedFrameSchema, value);
}

/** The avatar refused, read the same answering way. */
export function avatarUnavailableFrameFromWire(
  value: UnparsedWireValue,
): AvatarUnavailableFrame | undefined {
  return admittedAnswer(avatarUnavailableFrameSchema, value);
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
