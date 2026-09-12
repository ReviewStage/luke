import {
  isRecord,
  RATING_EVENT_PAYLOAD_FIELDS,
  RECORD_EXTRA_KEYS,
  type RecordOf,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
  type WireRecord,
  WireValueSchema,
} from "@sidecar/wire";
import { Option, Schema } from "effect";

/**
 * The Gateway protocol: what a client asks the host and what the host tells
 * every client, as versioned envelopes. The vocabulary lives here, below
 * every implementation, because the desktop, the voice window's main-process
 * relay, and one day a process on the other side of a socket all read the
 * same shapes. Nothing in this file performs anything; it says what a request,
 * an answer, and an event look like, and refuses shapes it does not know.
 */
export const GATEWAY_PROTOCOL_VERSION = 1;

/**
 * Every method the protocol knows, each saying whether it changes something.
 * A mutating method must carry an idempotency key, so a transport that
 * retries finds the first answer rather than a second effect; a read needs
 * none, because reading twice is reading. The flag rides on the entry so a
 * method added here cannot be forgotten in a set beside it.
 */
interface MethodEntry {
  readonly name: string;
  readonly mutates: boolean;
}

const GATEWAY_METHODS = {
  HELLO: { name: "gateway.hello", mutates: false },
  RECONNECT: { name: "gateway.reconnect", mutates: false },
  SHUTDOWN: { name: "gateway.shutdown", mutates: true },
  CONVERSATION_LINES: { name: "conversation.lines", mutates: false },
  CONVERSATION_DELETE: { name: "conversation.delete", mutates: true },
  /** The Conversation tab's Clear as the service's soft delete of the account's main conversation. */
  CONVERSATION_CLEAR: { name: "conversation.clear", mutates: true },
  /** The developer's thumb on one of Luke's messages, carried to the service as a rating event beside it. */
  CONVERSATION_RATE_MESSAGE: { name: "conversation.rateMessage", mutates: true },
  RUN_SUBMIT: { name: "run.submit", mutates: true },
  RUN_CANCEL: { name: "run.cancel", mutates: true },
  RUN_WAIT: { name: "run.wait", mutates: false },
  RUN_LIST: { name: "run.list", mutates: false },
  CHILD_LIST: { name: "child.list", mutates: false },
  MEMORY_STATUS: { name: "memory.status", mutates: false },
  CONFIGURATION_UPDATE: { name: "configuration.update", mutates: true },
  NODE_REGISTER: { name: "node.register", mutates: true },
  NODE_UNREGISTER: { name: "node.unregister", mutates: true },
  NODE_INVOKE: { name: "node.invoke", mutates: true },
  /** Everything a window's bootstrap reads of the host, in one answer. */
  CLIENT_BOOTSTRAP: { name: "client.bootstrap", mutates: false },
  SETTINGS_SNAPSHOT: { name: "settings.snapshot", mutates: false },
  SETTINGS_UPDATE: { name: "settings.update", mutates: true },
  SETTINGS_UPDATE_ENTRY: { name: "settings.updateEntry", mutates: true },
  SETTINGS_RESET: { name: "settings.reset", mutates: true },
  CREDENTIAL_SET_API_KEY: { name: "credential.setApiKey", mutates: true },
  ACCOUNT_SNAPSHOT: { name: "account.snapshot", mutates: false },
  ACCOUNT_BEGIN_SIGN_IN: { name: "account.beginSignIn", mutates: true },
  ACCOUNT_CANCEL_SIGN_IN: { name: "account.cancelSignIn", mutates: true },
  ACCOUNT_SIGN_OUT: { name: "account.signOut", mutates: true },
  ACCOUNT_DELETE: { name: "account.delete", mutates: true },
  CALENDAR_CONNECT_GOOGLE: { name: "calendar.connectGoogle", mutates: true },
  CALENDAR_CANCEL_GOOGLE_SIGN_IN: { name: "calendar.cancelGoogleSignIn", mutates: true },
  CALENDAR_REOPEN_GOOGLE_SIGN_IN: { name: "calendar.reopenGoogleSignIn", mutates: true },
  CALENDAR_REMOVE_ACCOUNT: { name: "calendar.removeAccount", mutates: true },
  CALENDAR_CONNECT_APPLE: { name: "calendar.connectApple", mutates: true },
  CALENDAR_DISCONNECT_APPLE: { name: "calendar.disconnectApple", mutates: true },
  CALENDAR_APPLE_ACCESS_STATUS: { name: "calendar.appleAccessStatus", mutates: false },
  CALENDAR_CANCEL_APPLE_CONNECT: { name: "calendar.cancelAppleConnect", mutates: true },
  CALENDAR_REFRESH: { name: "calendar.refresh", mutates: true },
  CALENDAR_SET_SELECTED: { name: "calendar.setSelected", mutates: true },
  SESSION_ROSTER: { name: "session.roster", mutates: false },
  SESSION_OPEN: { name: "session.open", mutates: true },
  SESSION_OPEN_APPLICATION: { name: "session.openApplication", mutates: true },
  SESSION_OPEN_CHANGE: { name: "session.openChange", mutates: true },
  /** The two writes a session's own row asks for, each admitted in the host against the roster it reads for itself. */
  SESSION_SEND_MESSAGE: { name: "session.sendMessage", mutates: true },
  SESSION_EXECUTE_CONTROL: { name: "session.executeControl", mutates: true },
  WORKSPACE_PROJECTS: { name: "workspace.projects", mutates: false },
  VOICE_DIAGNOSTICS: { name: "voice.diagnostics", mutates: false },
  VOICE_CREATE_LIVE_SESSION: { name: "voice.createLiveSession", mutates: true },
  VOICE_END_LIVE_SESSION: { name: "voice.endLiveSession", mutates: true },
  VOICE_REPORT_LIVE_TRANSPORT: { name: "voice.reportLiveTransport", mutates: true },
  VOICE_REPORT_LIVE_ACTIVITY: { name: "voice.reportLiveActivity", mutates: true },
  VOICE_STOP_SPEAKING: { name: "voice.stopSpeaking", mutates: true },
  /** One live event the renderer's tap saw cross the data channel, for the host's development trace; a no-op where no writer stands. */
  VOICE_RECORD_TRACE: { name: "voice.recordTrace", mutates: true },
  GUIDE_REPORT: { name: "guide.report", mutates: true },
  ANALYTICS_RECORD: { name: "analytics.record", mutates: true },
  CONVERSATION_APPEND: { name: "conversation.append", mutates: true },
  ONBOARDING_STATE: { name: "onboarding.state", mutates: false },
  ONBOARDING_SKIP_CALENDAR: { name: "onboarding.skipCalendar", mutates: true },
  ONBOARDING_COMPLETE_CALENDAR: { name: "onboarding.completeCalendar", mutates: true },
} as const satisfies Record<string, MethodEntry>;

export const GATEWAY_METHOD =
  // SAFETY: the entries are this same table's, so every key answers its own entry's name.
  Object.fromEntries(
    Object.entries(GATEWAY_METHODS).map(([held, entry]) => [held, entry.name]),
  ) as { readonly [K in keyof typeof GATEWAY_METHODS]: (typeof GATEWAY_METHODS)[K]["name"] };

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

export const GatewayMethodSchema = Schema.Literal(...Object.values(GATEWAY_METHOD));

/** One method as the table names it: its wire name and whether it changes something. */
export interface GatewayMethodEntry {
  readonly name: GatewayMethod;
  readonly mutates: boolean;
}

/** Every entry of the one table, in its order, for whatever derives a vocabulary from it rather than keeping a list beside it. */
export const GATEWAY_METHOD_ENTRIES: readonly GatewayMethodEntry[] = Object.values(GATEWAY_METHODS);

/** What a method takes: a record the host reads under its own declared shape, admitted here only as a record. */
export const GatewayParamsSchema = WireValueSchema.pipe(Schema.filter(isRecord));

/** What a method answers: a wire value, or nothing at all, which the envelope carries as an absent field. */
export const GatewayResultSchema = Schema.UndefinedOr(WireValueSchema);

/**
 * The live voice session's vocabulary, declared beside the four methods and
 * the one event that speak it, so the host that answers them and the client
 * that sends them read one shape. The session itself belongs to the host; the
 * renderer is a WebRTC peer that hands over an SDP offer, reports what its
 * transport and microphone are doing, and asks for the end, and no credential
 * of any kind travels in these shapes.
 */

/** Where the one live session stands, as `voiceLiveSession.changed` reports it. */
export const LIVE_SESSION_PHASE = {
  /** The host wants a session and no peer has offered one yet. */
  WANTED: "wanted",
  /** The provider created the session; its answer is on its way to the peer. */
  CREATED: "created",
  /** The provider announced the session live. */
  STARTED: "started",
  /** The host asked for a graceful close and is waiting for it to be confirmed. */
  CLOSING: "closing",
  CLOSED: "closed",
} as const;

export type LiveSessionPhase = (typeof LIVE_SESSION_PHASE)[keyof typeof LIVE_SESSION_PHASE];

const LIVE_SESSION_PHASES: readonly LiveSessionPhase[] = Object.values(LIVE_SESSION_PHASE);

/** What a peer's transport reports of itself, after the peer connection's own states. */
export const LIVE_TRANSPORT_STATE = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
  CLOSED: "closed",
} as const;

export type LiveTransportState = (typeof LIVE_TRANSPORT_STATE)[keyof typeof LIVE_TRANSPORT_STATE];

const LIVE_TRANSPORT_STATES: readonly LiveTransportState[] = Object.values(LIVE_TRANSPORT_STATE);

/**
 * The most characters an SDP document may carry. A WebRTC offer for one audio
 * track and one data channel is a few kilobytes; the bound refuses an offer
 * no peer of this build composes rather than carrying it to a provider.
 */
export const LIVE_SDP_MAX_CHARACTERS = 65_536;

/** SDP is line-oriented and ends its lines with CRLF, so it travels verbatim: nothing is trimmed, collapsed, or cut. */
const sdpSchema = s.text({ max: LIVE_SDP_MAX_CHARACTERS, ends: TEXT_ENDS.KEEP });

/** `voice.createLiveSession`: the peer's SDP offer, and nothing else. */
export const voiceCreateLiveSessionParamsSchema = s.record({ sdp: sdpSchema });

const VOICE_CREATE_LIVE_SESSION_RESULT = { sessionId: s.text(), sdpAnswer: sdpSchema } as const;

/** What `voice.createLiveSession` answers: the session the provider named, and the SDP answer the peer sets. */
export const voiceCreateLiveSessionResultSchema = s.record(VOICE_CREATE_LIVE_SESSION_RESULT, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

export type VoiceCreateLiveSessionResult = RecordOf<typeof VOICE_CREATE_LIVE_SESSION_RESULT>;

/** `voice.reportLiveTransport`: the peer connection's state as the peer saw it change. */
export const voiceReportLiveTransportParamsSchema = s.record({
  state: s.enumOf(LIVE_TRANSPORT_STATES),
});

/** `voice.reportLiveActivity`: whether the peer has decided, from its own local signals, that the exchange is idle. */
export const voiceReportLiveActivityParamsSchema = s.record({ idle: s.boolean() });

const VOICE_STOP_SPEAKING_RESULT = { stopped: s.boolean() } as const;

/**
 * What `voice.stopSpeaking` answers: whether a standing session was told to
 * stop. The stop key is the one ask that carries this; a muted microphone
 * says nothing about Luke's own output, so the method takes no parameters
 * and the mute carries none of its meaning.
 */
export const voiceStopSpeakingResultSchema = s.record(VOICE_STOP_SPEAKING_RESULT, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

const VOICE_LIVE_SESSION_CHANGED = {
  sessionId: s.text().optional(),
  phase: s.enumOf(LIVE_SESSION_PHASES),
  reason: s.text().optional(),
} as const;

/** `voiceLiveSession.changed`: the phase the host's one session moved to, the id once the provider named one, and the reason of a close. */
export const voiceLiveSessionChangedSchema = s.record(VOICE_LIVE_SESSION_CHANGED, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

export type VoiceLiveSessionChanged = RecordOf<typeof VOICE_LIVE_SESSION_CHANGED>;

const CONVERSATION_RATE_MESSAGE_PARAMS = {
  /** The message as the view holds it, by its own id, admitted as written so it matches the row the host holds. */
  messageId: s.text({ max: 512, ends: TEXT_ENDS.KEEP }),
  /** The verdict under the stored event's own rule, so the method and the row cannot say different things. */
  rating: RATING_EVENT_PAYLOAD_FIELDS.rating,
} as const;

/** `conversation.rateMessage`: which of Luke's messages, and the developer's verdict on it. */
export const conversationRateMessageParamsSchema = s.record(CONVERSATION_RATE_MESSAGE_PARAMS);

export type ConversationRateMessageParams = RecordOf<typeof CONVERSATION_RATE_MESSAGE_PARAMS>;

/**
 * How `conversation.rateMessage` ended. A rating is recorded or it is not,
 * and a control that asked has three different things to say about a
 * refusal: the service could not be asked at all, the message is not one the
 * account still holds, or it stands but is not one of Luke's — which no
 * control should have offered, so a client reads it as a row the thread has
 * moved past rather than as a rating to retry.
 */
export const CONVERSATION_RATE_STATUS = {
  RATED: "rated",
  /** The run sends nothing, the account gate is closed, this device has no row on the service yet, or the call did not land. */
  UNAVAILABLE: "unavailable",
  /** No message by that id stands for the account on this device or on the service. */
  NOT_FOUND: "not-found",
  /** The message stands and is the account's, but only Luke's words take a rating. */
  NOT_RATEABLE: "not-rateable",
} as const;

export type ConversationRateStatus =
  (typeof CONVERSATION_RATE_STATUS)[keyof typeof CONVERSATION_RATE_STATUS];

const CONVERSATION_RATE_MESSAGE_RESULT = {
  status: s.enumOf(Object.values(CONVERSATION_RATE_STATUS)),
} as const;

/** What `conversation.rateMessage` answers: whether the rating was recorded, and if not, which of the three refusals stands. */
export const conversationRateMessageResultSchema = s.record(CONVERSATION_RATE_MESSAGE_RESULT, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

export type ConversationRateMessageResult = RecordOf<typeof CONVERSATION_RATE_MESSAGE_RESULT>;

const GATEWAY_METHODS_BY_NAME: ReadonlyMap<string, GatewayMethodEntry> = new Map(
  GATEWAY_METHOD_ENTRIES.map((entry) => [entry.name, entry]),
);

const readsGatewayMethod = Schema.is(GatewayMethodSchema);

export function isGatewayMethod(value: UnparsedWireValue): value is GatewayMethod {
  return readsGatewayMethod(value);
}

export function isMutatingGatewayMethod(method: GatewayMethod): boolean {
  return GATEWAY_METHODS_BY_NAME.get(method)?.mutates === true;
}

/** An id the protocol carries: a request's, an event's, a node's, a key's. Never empty, and otherwise the minter's own. */
const GatewayIdentifierSchema = Schema.NonEmptyString;

/** What a caller may say it expects to still stand when its request lands. */
export const GatewayExpectedRevisionSchema = Schema.Struct({
  /** The conversation whose lifetime the caller read, and the generation it read there. */
  sessionKey: Schema.optionalWith(GatewayIdentifierSchema, { exact: true }),
  sessionRevision: Schema.optionalWith(Schema.String, { exact: true }),
  /** The configuration revision the caller read. */
  configurationRevision: Schema.optionalWith(Schema.Number, { exact: true }),
});

export type GatewayExpectedRevision = typeof GatewayExpectedRevisionSchema.Type;

/**
 * The envelopes, each declared once as the schema that both reads it off the
 * wire and writes it back. Key order is the contract, and a struct encodes
 * its keys in the order declared here, so what `fixtures/protocol` records
 * is what these declarations say; an explicitly absent field leaves rather
 * than travelling as null, and the readers refuse a shape they never sent.
 */
export const GatewayRequestSchema = Schema.Struct({
  protocolVersion: Schema.Number,
  id: GatewayIdentifierSchema,
  method: GatewayMethodSchema,
  params: GatewayParamsSchema,
  idempotencyKey: Schema.optionalWith(GatewayIdentifierSchema, { exact: true }),
  expectedRevision: Schema.optionalWith(GatewayExpectedRevisionSchema, { exact: true }),
});

export type GatewayRequest = typeof GatewayRequestSchema.Type;

export const GATEWAY_ERROR = {
  UNSUPPORTED_VERSION: "unsupported_version",
  UNKNOWN_METHOD: "unknown_method",
  INVALID_PARAMS: "invalid_params",
  MISSING_IDEMPOTENCY_KEY: "missing_idempotency_key",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  REVISION_MISMATCH: "revision_mismatch",
  NOT_FOUND: "not_found",
  REFUSED: "refused",
  UNAUTHORIZED: "unauthorized",
  NODE_UNAVAILABLE: "node_unavailable",
  UNKNOWN_CAPABILITY: "unknown_capability",
  DISCONNECTED: "disconnected",
  SHUTTING_DOWN: "shutting_down",
  INTERNAL: "internal",
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR)[keyof typeof GATEWAY_ERROR];

export const GatewayErrorCodeSchema = Schema.Literal(...Object.values(GATEWAY_ERROR));

const readsGatewayErrorCode = Schema.is(GatewayErrorCodeSchema);

export function isGatewayErrorCode(value: UnparsedWireValue): value is GatewayErrorCode {
  return readsGatewayErrorCode(value);
}

/** An error as the envelope carries it: the code, and a sentence for a person. */
export const GatewayErrorSchema = Schema.Struct({
  code: GatewayErrorCodeSchema,
  message: Schema.String,
});

export type GatewayError = typeof GatewayErrorSchema.Type;

/** One refusal's code, fixed by its class: the constructor takes the message alone. */
function refusalCode<Code extends GatewayErrorCode>(code: Code) {
  return Schema.Literal(code).pipe(
    Schema.propertySignature,
    Schema.withConstructorDefault(() => code),
  );
}

/**
 * Every error code as its own tagged error, so a handler that refuses has a
 * typed failure to fail with rather than a bare code. Each class's `code` is
 * the exact string `GATEWAY_ERROR` already names, and the family crosses the
 * wire as `GatewayRefusalSchema` writes it: today's `{ code, message }` object,
 * with no tag beside them, so a client of an earlier build reads the same
 * envelope it always did.
 */
export class UnsupportedVersionRefusal extends Schema.TaggedError<UnsupportedVersionRefusal>()(
  "UnsupportedVersionRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNSUPPORTED_VERSION), message: Schema.String },
) {}

export class UnknownMethodRefusal extends Schema.TaggedError<UnknownMethodRefusal>()(
  "UnknownMethodRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_METHOD), message: Schema.String },
) {}

export class InvalidParamsRefusal extends Schema.TaggedError<InvalidParamsRefusal>()(
  "InvalidParamsRefusal",
  { code: refusalCode(GATEWAY_ERROR.INVALID_PARAMS), message: Schema.String },
) {}

export class MissingIdempotencyKeyRefusal extends Schema.TaggedError<MissingIdempotencyKeyRefusal>()(
  "MissingIdempotencyKeyRefusal",
  { code: refusalCode(GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY), message: Schema.String },
) {}

export class IdempotencyConflictRefusal extends Schema.TaggedError<IdempotencyConflictRefusal>()(
  "IdempotencyConflictRefusal",
  { code: refusalCode(GATEWAY_ERROR.IDEMPOTENCY_CONFLICT), message: Schema.String },
) {}

export class RevisionMismatchRefusal extends Schema.TaggedError<RevisionMismatchRefusal>()(
  "RevisionMismatchRefusal",
  { code: refusalCode(GATEWAY_ERROR.REVISION_MISMATCH), message: Schema.String },
) {}

export class NotFoundRefusal extends Schema.TaggedError<NotFoundRefusal>()("NotFoundRefusal", {
  code: refusalCode(GATEWAY_ERROR.NOT_FOUND),
  message: Schema.String,
}) {}

export class RefusedRefusal extends Schema.TaggedError<RefusedRefusal>()("RefusedRefusal", {
  code: refusalCode(GATEWAY_ERROR.REFUSED),
  message: Schema.String,
}) {}

export class UnauthorizedRefusal extends Schema.TaggedError<UnauthorizedRefusal>()(
  "UnauthorizedRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNAUTHORIZED), message: Schema.String },
) {}

export class NodeUnavailableRefusal extends Schema.TaggedError<NodeUnavailableRefusal>()(
  "NodeUnavailableRefusal",
  { code: refusalCode(GATEWAY_ERROR.NODE_UNAVAILABLE), message: Schema.String },
) {}

export class UnknownCapabilityRefusal extends Schema.TaggedError<UnknownCapabilityRefusal>()(
  "UnknownCapabilityRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_CAPABILITY), message: Schema.String },
) {}

export class DisconnectedRefusal extends Schema.TaggedError<DisconnectedRefusal>()(
  "DisconnectedRefusal",
  { code: refusalCode(GATEWAY_ERROR.DISCONNECTED), message: Schema.String },
) {}

export class ShuttingDownRefusal extends Schema.TaggedError<ShuttingDownRefusal>()(
  "ShuttingDownRefusal",
  { code: refusalCode(GATEWAY_ERROR.SHUTTING_DOWN), message: Schema.String },
) {}

export class InternalRefusal extends Schema.TaggedError<InternalRefusal>()("InternalRefusal", {
  code: refusalCode(GATEWAY_ERROR.INTERNAL),
  message: Schema.String,
}) {}

/** Every refusal class this module declares, one per error code, for a membership check and the family's union. */
export const GATEWAY_REFUSALS = [
  UnsupportedVersionRefusal,
  UnknownMethodRefusal,
  InvalidParamsRefusal,
  MissingIdempotencyKeyRefusal,
  IdempotencyConflictRefusal,
  RevisionMismatchRefusal,
  NotFoundRefusal,
  RefusedRefusal,
  UnauthorizedRefusal,
  NodeUnavailableRefusal,
  UnknownCapabilityRefusal,
  DisconnectedRefusal,
  ShuttingDownRefusal,
  InternalRefusal,
] as const;

export type GatewayRefusal = InstanceType<(typeof GATEWAY_REFUSALS)[number]>;

/** The refusal class an error's code names, carrying its message: how an outcome a handler wrote as a code becomes a typed failure. */
export function gatewayRefusalFromError(error: GatewayError): GatewayRefusal {
  const message = error.message;
  switch (error.code) {
    case GATEWAY_ERROR.UNSUPPORTED_VERSION:
      return new UnsupportedVersionRefusal({ message });
    case GATEWAY_ERROR.UNKNOWN_METHOD:
      return new UnknownMethodRefusal({ message });
    case GATEWAY_ERROR.INVALID_PARAMS:
      return new InvalidParamsRefusal({ message });
    case GATEWAY_ERROR.MISSING_IDEMPOTENCY_KEY:
      return new MissingIdempotencyKeyRefusal({ message });
    case GATEWAY_ERROR.IDEMPOTENCY_CONFLICT:
      return new IdempotencyConflictRefusal({ message });
    case GATEWAY_ERROR.REVISION_MISMATCH:
      return new RevisionMismatchRefusal({ message });
    case GATEWAY_ERROR.NOT_FOUND:
      return new NotFoundRefusal({ message });
    case GATEWAY_ERROR.REFUSED:
      return new RefusedRefusal({ message });
    case GATEWAY_ERROR.UNAUTHORIZED:
      return new UnauthorizedRefusal({ message });
    case GATEWAY_ERROR.NODE_UNAVAILABLE:
      return new NodeUnavailableRefusal({ message });
    case GATEWAY_ERROR.UNKNOWN_CAPABILITY:
      return new UnknownCapabilityRefusal({ message });
    case GATEWAY_ERROR.DISCONNECTED:
      return new DisconnectedRefusal({ message });
    case GATEWAY_ERROR.SHUTTING_DOWN:
      return new ShuttingDownRefusal({ message });
    case GATEWAY_ERROR.INTERNAL:
      return new InternalRefusal({ message });
  }
}

/**
 * The refusal family as the wire carries it. Decoding an envelope's error
 * object answers the class its code names; encoding a refusal writes the
 * `{ code, message }` object and nothing else, so the class's own tag never
 * reaches the wire and the envelope goldens hold.
 */
export const GatewayRefusalSchema: Schema.Schema<GatewayRefusal, GatewayError> = Schema.transform(
  GatewayErrorSchema,
  Schema.typeSchema(Schema.Union(...GATEWAY_REFUSALS)),
  {
    strict: true,
    decode: gatewayRefusalFromError,
    encode: (refusal) => ({ code: refusal.code, message: refusal.message }),
  },
);

/**
 * The one refusal the protocol decides before any method is named: a request
 * on another protocol version is refused outright, whatever it asked.
 */
export function gatewayVersionRefusal(
  protocolVersion: number,
): Option.Option<UnsupportedVersionRefusal> {
  return protocolVersion === GATEWAY_PROTOCOL_VERSION
    ? Option.none()
    : Option.some(
        new UnsupportedVersionRefusal({
          message: `this host speaks protocol ${GATEWAY_PROTOCOL_VERSION}`,
        }),
      );
}

/** The revisions that stood when an answer was formed, so a client can name them on its next ask. */
export const GatewayRevisionSchema = Schema.Struct({
  configuration: Schema.Number,
  sequence: Schema.Number,
});

export type GatewayRevision = typeof GatewayRevisionSchema.Type;

/**
 * A value that may be absent, read as `undefined` and written as no field at
 * all. `null` is a value here and travels; only `undefined` leaves.
 */
function absentOrWireValue() {
  return Schema.optionalToRequired(WireValueSchema, Schema.UndefinedOr(WireValueSchema), {
    decode: Option.getOrUndefined,
    encode: (value) => (value === undefined ? Option.none() : Option.some(value)),
  });
}

export const GatewayResponseSchema = Schema.Union(
  Schema.Struct({
    id: GatewayIdentifierSchema,
    ok: Schema.Literal(true),
    result: absentOrWireValue(),
    revision: GatewayRevisionSchema,
  }),
  Schema.Struct({
    id: GatewayIdentifierSchema,
    ok: Schema.Literal(false),
    error: GatewayErrorSchema,
    revision: GatewayRevisionSchema,
  }),
);

export type GatewayResponse = typeof GatewayResponseSchema.Type;

export const GATEWAY_EVENT = {
  RUNS_CHANGED: "runs.changed",
  CONVERSATION_CHANGED: "conversation.changed",
  /** The Conversation as the service's reads compose it, whole, whenever a poll moved it. */
  CONVERSATION_VIEW_CHANGED: "conversationView.changed",
  DIRECTORY_CHANGED: "directory.changed",
  CHILD_CHANGED: "child.changed",
  CONFIGURATION_CHANGED: "configuration.changed",
  OBSERVATION_CHANGED: "observation.changed",
  NODE_CHANGED: "node.changed",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CHANGED: "account.changed",
  SESSIONS_CHANGED: "sessions.changed",
  WORKSPACE_PROJECTS_CHANGED: "workspaceProjects.changed",
  CALENDARS_CHANGED: "calendars.changed",
  ANNOUNCEMENTS_HELD_CHANGED: "announcementsHeld.changed",
  CALENDAR_ONBOARDING_CHANGED: "calendarOnboarding.changed",
  VOICE_LIVE_SESSION_CHANGED: "voiceLiveSession.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

export const GatewayEventKindSchema = Schema.Literal(...Object.values(GATEWAY_EVENT));

const readsGatewayEventKind = Schema.is(GatewayEventKindSchema);

export function isGatewayEventKind(value: UnparsedWireValue): value is GatewayEventKind {
  return readsGatewayEventKind(value);
}

export const GatewayEventSchema = Schema.Struct({
  eventId: GatewayIdentifierSchema,
  /** One more than the event before it, from 1, so a gap is a number a client can see. */
  sequence: Schema.Number,
  kind: GatewayEventKindSchema,
  at: Schema.Number,
  sessionKey: Schema.optionalWith(GatewayIdentifierSchema, { exact: true }),
  runId: Schema.optionalWith(GatewayIdentifierSchema, { exact: true }),
  payload: WireValueSchema,
});

export type GatewayEvent = typeof GatewayEventSchema.Type;

/**
 * What a reconnecting client is handed for the sequence it last saw: every
 * event since, when the window still holds them, or a fresh snapshot with
 * the sequence it stands at, because a window that has moved on must never
 * skip what it can no longer replay.
 */
export const GATEWAY_RECONNECT_KIND = {
  REPLAY: "replay",
  SNAPSHOT: "snapshot",
} as const;

export type GatewayReconnectKind =
  (typeof GATEWAY_RECONNECT_KIND)[keyof typeof GATEWAY_RECONNECT_KIND];

export const GatewayReconnectAnswerSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal(GATEWAY_RECONNECT_KIND.REPLAY),
    events: Schema.Array(GatewayEventSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal(GATEWAY_RECONNECT_KIND.SNAPSHOT),
    sequence: Schema.Number,
    snapshot: WireValueSchema,
  }),
);

export type GatewayReconnectAnswer = typeof GatewayReconnectAnswerSchema.Type;

/**
 * What a client and a host settle before any request crosses a connection:
 * the protocol version each speaks, carried on the connection's own
 * handshake and never in an address. The credential that authenticates the
 * client travels the same way, behind the authorization header, so it is
 * never part of a URL a log or a history could keep.
 */
export const GATEWAY_HANDSHAKE_HEADER = {
  AUTHORIZATION: "authorization",
  PROTOCOL_VERSION: "x-luke-gateway-protocol",
  CLIENT_ID: "x-luke-gateway-client",
  CLIENT_ROLE: "x-luke-gateway-role",
} as const;

/** How a handshake ended, when it did not end in a connection. */
export const GATEWAY_HANDSHAKE_REFUSAL = {
  UNAUTHORIZED: "unauthorized",
  UNSUPPORTED_VERSION: "unsupported_version",
  SHUTTING_DOWN: "shutting_down",
  MALFORMED: "malformed",
} as const;

export type GatewayHandshakeRefusal =
  (typeof GATEWAY_HANDSHAKE_REFUSAL)[keyof typeof GATEWAY_HANDSHAKE_REFUSAL];

/** Who is asking: the one operator client, or a node offering capabilities. */
export const GATEWAY_CLIENT_ROLE = {
  OPERATOR: "operator",
  NODE: "node",
} as const;

export type GatewayClientRole = (typeof GATEWAY_CLIENT_ROLE)[keyof typeof GATEWAY_CLIENT_ROLE];

export interface GatewayClientIdentity {
  clientId: string;
  role: GatewayClientRole;
}

/**
 * What a node capability's invocation answers. Unavailable is a typed answer,
 * never a thrown error and never a success: a required node that is not
 * connected leaves the action undone and says so, so nothing records it as done.
 * Unknown is the other typed answer an absent node can give, and it is not
 * unavailable: the ask was dispatched to the node and the node's connection
 * closed before it answered, so the effect may have happened. What reads an
 * unknown must record the action as uncertain, never as failed and never as
 * safe to repeat.
 */
export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  /** Never dispatched: no connected node offered the capability. */
  UNAVAILABLE: "unavailable",
  /** The node performed and reported a failure. */
  FAILED: "failed",
  /** Dispatched, and the answer lost with the node's connection; the effect is uncertain. */
  UNKNOWN: "unknown",
} as const;

export type NodeCapabilityStatus =
  (typeof NODE_CAPABILITY_STATUS)[keyof typeof NODE_CAPABILITY_STATUS];

export const NodeCapabilityResultSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal(NODE_CAPABILITY_STATUS.OK), value: absentOrWireValue() }),
  Schema.Struct({
    status: Schema.Literal(NODE_CAPABILITY_STATUS.UNAVAILABLE),
    capability: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal(NODE_CAPABILITY_STATUS.FAILED),
    capability: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal(NODE_CAPABILITY_STATUS.UNKNOWN),
    capability: Schema.String,
    reason: Schema.String,
  }),
);

export type NodeCapabilityResult = typeof NodeCapabilityResultSchema.Type;

const readGatewayRequest = Schema.decodeUnknownOption(GatewayRequestSchema);
const writeGatewayRequest = Schema.encodeSync(GatewayRequestSchema);
const readGatewayResponse = Schema.decodeUnknownOption(GatewayResponseSchema);
const writeGatewayResponse = Schema.encodeSync(GatewayResponseSchema);
const readGatewayEvent = Schema.decodeUnknownOption(GatewayEventSchema);
const writeGatewayEvent = Schema.encodeSync(GatewayEventSchema);
const readGatewayReconnectAnswer = Schema.decodeUnknownOption(GatewayReconnectAnswerSchema);

export function gatewayRequestToWire(request: GatewayRequest): WireRecord {
  return writeGatewayRequest(request);
}

export function gatewayResponseToWire(response: GatewayResponse): WireRecord {
  return writeGatewayResponse(response);
}

export function gatewayEventToWire(event: GatewayEvent): WireRecord {
  return writeGatewayEvent(event);
}

/** A refusal the protocol itself answers, for a request no handler ever saw. */
export function gatewayRefusal(
  id: string,
  code: GatewayErrorCode,
  message: string,
  revision: GatewayRevision = { configuration: 0, sequence: 0 },
): GatewayResponse {
  return { id, ok: false, error: { code, message }, revision };
}

export function gatewayRequestFromWire(value: UnparsedWireValue): GatewayRequest | undefined {
  return Option.getOrUndefined(readGatewayRequest(value));
}

export function gatewayResponseFromWire(value: UnparsedWireValue): GatewayResponse | undefined {
  return Option.getOrUndefined(readGatewayResponse(value));
}

export function gatewayEventFromWire(value: UnparsedWireValue): GatewayEvent | undefined {
  return Option.getOrUndefined(readGatewayEvent(value));
}

export function gatewayReconnectAnswerFromWire(
  value: UnparsedWireValue,
): GatewayReconnectAnswer | undefined {
  return Option.getOrUndefined(readGatewayReconnectAnswer(value));
}

/**
 * The host asking one connected node to perform one of its capabilities. It
 * travels on that node's own connection and nowhere else: never in the event
 * log, so a reconnecting client is never replayed an ask to act, and never to
 * another client, so no other process sees the parameters or can answer for
 * the node. The id binds the answer to the ask; a connection that closes
 * before answering leaves the ask unavailable and the effect uncertain.
 */
export const NodeInvocationSchema = Schema.Struct({
  invocationId: GatewayIdentifierSchema,
  nodeId: GatewayIdentifierSchema,
  capability: Schema.String,
  params: GatewayParamsSchema,
});

export type NodeInvocation = typeof NodeInvocationSchema.Type;

export const NodeInvocationAnswerSchema = Schema.Struct({
  invocationId: GatewayIdentifierSchema,
  result: NodeCapabilityResultSchema,
});

export type NodeInvocationAnswer = typeof NodeInvocationAnswerSchema.Type;

const writeNodeCapabilityResult = Schema.encodeSync(NodeCapabilityResultSchema);
const readNodeCapabilityResult = Schema.decodeUnknownOption(NodeCapabilityResultSchema);
const writeNodeInvocation = Schema.encodeSync(NodeInvocationSchema);
const readNodeInvocation = Schema.decodeUnknownOption(NodeInvocationSchema);
const writeNodeInvocationAnswer = Schema.encodeSync(NodeInvocationAnswerSchema);
const readNodeInvocationAnswer = Schema.decodeUnknownOption(NodeInvocationAnswerSchema);

export function nodeCapabilityResultToWire(result: NodeCapabilityResult): WireRecord {
  return writeNodeCapabilityResult(result);
}

export function nodeInvocationToWire(invocation: NodeInvocation): WireRecord {
  return writeNodeInvocation(invocation);
}

export function nodeInvocationFromWire(value: UnparsedWireValue): NodeInvocation | undefined {
  return Option.getOrUndefined(readNodeInvocation(value));
}

export function nodeInvocationAnswerToWire(answer: NodeInvocationAnswer): WireRecord {
  return writeNodeInvocationAnswer(answer);
}

export function nodeInvocationAnswerFromWire(
  value: UnparsedWireValue,
): NodeInvocationAnswer | undefined {
  return Option.getOrUndefined(readNodeInvocationAnswer(value));
}

export function nodeCapabilityResultFromWire(
  value: UnparsedWireValue,
): NodeCapabilityResult | undefined {
  return Option.getOrUndefined(readNodeCapabilityResult(value));
}
