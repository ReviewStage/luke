/**
 * protocol.ts -- the Gateway's vocabulary: the methods a client asks the host,
 * the events the host tells every client, the refusals a handler fails with,
 * and the parameter and result shapes the desktop reads.
 *
 * The vocabulary lives here, below every implementation, so the host that
 * answers a method and the client that calls it read the same words from one
 * contract. Nothing in this file performs anything.
 */
import { RatingWordSchema, TRANSCRIPT_KIND, type WireValue } from "@sidecar/wire";
import { Effect, Schema } from "effect";

/** Every method the host answers, by the name a client calls it. */
export const GATEWAY_METHOD = {
  SHUTDOWN: "gateway.shutdown",
  /** The Conversation tab's Clear as the service's soft delete of the account's main conversation. */
  CONVERSATION_CLEAR: "conversation.clear",
  /** The developer's thumb on one of Luke's messages, or the press that takes it back, carried to the service as a rating event beside it. */
  CONVERSATION_RATE_MESSAGE: "conversation.rateMessage",
  /** A read of the Conversation asked for now rather than at the poll's cadence: a spoken line settled, so the record is being written. */
  CONVERSATION_REFRESH: "conversation.refresh",
  /** One page of older turns read back from where this device's history stands, for a reader at the top of the thread; the page arrives on the view, the answer says whether one landed. */
  CONVERSATION_LOAD_OLDER: "conversation.loadOlder",
  /** One transcript held open on this device, a child's or an observed session's: read to its end now and again whenever its list's head moves, until closed. */
  // Named for the child's transcript still, an observed session's opening through the same method.
  CONVERSATION_OPEN_CHILD_TRANSCRIPT: "conversation.openChildTranscript",
  CONVERSATION_CLOSE_CHILD_TRANSCRIPT: "conversation.closeChildTranscript",
  /** Luke's notebook as the service holds it, read whole and bounded for the Settings page that shows what he has saved. */
  NOTEBOOK_READ: "notebook.read",
  /** The planning window stands: the plan list read now, the active plan's document with it, and both followed until it closes. */
  PLANNING_REFRESH: "planning.refresh",
  /** One plan made the active one and its saved document read, replacing whichever was active. */
  PLANNING_OPEN: "planning.open",
  /** The planning window closed: no plan is active and nothing is followed. */
  PLANNING_CLOSE: "planning.close",
  /** A named plan started on a repository the account's GitHub connection reads, and made the active one. */
  PLANNING_START: "planning.start",
  /** The repositories the account's GitHub connection can read, for a new plan's picker. */
  PLANNING_REPOSITORIES: "planning.repositories",
  /** Everything a window's bootstrap reads of the host, in one answer. */
  CLIENT_BOOTSTRAP: "client.bootstrap",
  SETTINGS_SNAPSHOT: "settings.snapshot",
  SETTINGS_UPDATE: "settings.update",
  SETTINGS_UPDATE_ENTRY: "settings.updateEntry",
  SETTINGS_RESET: "settings.reset",
  CREDENTIAL_SET_API_KEY: "credential.setApiKey",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  CALENDAR_CONNECT_GOOGLE: "calendar.connectGoogle",
  CALENDAR_CANCEL_GOOGLE_SIGN_IN: "calendar.cancelGoogleSignIn",
  CALENDAR_REOPEN_GOOGLE_SIGN_IN: "calendar.reopenGoogleSignIn",
  CALENDAR_REMOVE_ACCOUNT: "calendar.removeAccount",
  CALENDAR_CONNECT_APPLE: "calendar.connectApple",
  CALENDAR_DISCONNECT_APPLE: "calendar.disconnectApple",
  CALENDAR_APPLE_ACCESS_STATUS: "calendar.appleAccessStatus",
  CALENDAR_CANCEL_APPLE_CONNECT: "calendar.cancelAppleConnect",
  CALENDAR_REFRESH: "calendar.refresh",
  CALENDAR_SET_SELECTED: "calendar.setSelected",
  SESSION_ROSTER: "session.roster",
  SESSION_OPEN: "session.open",
  SESSION_OPEN_APPLICATION: "session.openApplication",
  SESSION_OPEN_CHANGE: "session.openChange",
  /** The two writes a session's own row asks for, each admitted in the host against the roster it reads for itself. */
  SESSION_SEND_MESSAGE: "session.sendMessage",
  SESSION_EXECUTE_CONTROL: "session.executeControl",
  WORKSPACE_PROJECTS: "workspace.projects",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  /** One live event the renderer's tap saw cross the data channel, for the host's development trace; a no-op where no writer stands. */
  VOICE_RECORD_TRACE: "voice.recordTrace",
  ANALYTICS_RECORD: "analytics.record",
  ONBOARDING_STATE: "onboarding.state",
  ONBOARDING_SKIP_CALENDAR: "onboarding.skipCalendar",
  ONBOARDING_COMPLETE_CALENDAR: "onboarding.completeCalendar",
  /** The spoken introduction was given to its end; the host records the moment and stands the introduction down for good. */
  ONBOARDING_COMPLETE_INTRODUCTION: "onboarding.completeIntroduction",
  /** The developer declined the Conductor key step of onboarding; the settings row stays the way to connect later. */
  ONBOARDING_SKIP_CONDUCTOR_KEY: "onboarding.skipConductorKey",
} as const;

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

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

/**
 * The representation a check carries so the node a model is shown says the
 * bound the check stands for. Effect's own length filters annotate themselves
 * with it, and a filter of this module's own that means the same bound says so
 * under the same id rather than emitting nothing.
 */
const SCHEMA_CHECK_REPRESENTATION = {
  MIN_LENGTH: "effect/schema/isMinLength",
} as const;

/** A trimmed text, refused when only whitespace remains. */
const text: Schema.Codec<string, string> = Schema.Trim.check(Schema.isNonEmpty());

/** A text admitted as written, refused when only whitespace remains, and bounded by `max`. */
function keptText(max: number): Schema.Codec<string, string> {
  return Schema.String.check(
    Schema.makeFilter<string>((value) => value.trim().length > 0, {
      representation: {
        id: SCHEMA_CHECK_REPRESENTATION.MIN_LENGTH,
        payload: { minLength: 1 },
      },
    }),
    Schema.isMaxLength(max),
  );
}

/**
 * Every answer below is a plain struct that names exactly its own keys. A key
 * a newer service added is ignored at the read rather than in the declaration,
 * because whether an unnamed key refuses a value is a parse option a caller
 * passes and no longer something a schema can say for itself: the readers of
 * these answers hand `readEither` `{ excess: EXCESS_KEYS.DROP }`, and what a
 * model is shown still says `additionalProperties: false`.
 */

/** SDP is line-oriented and ends its lines with CRLF, so it travels verbatim: nothing is trimmed, collapsed, or cut. */
const sdpSchema = keptText(LIVE_SDP_MAX_CHARACTERS);

/** `voice.createLiveSession`: the peer's SDP offer, and nothing else. */
export const voiceCreateLiveSessionParamsSchema = Schema.Struct({ sdp: sdpSchema });

/**
 * What `voice.createLiveSession` answers: the session the provider named, the
 * SDP answer the peer sets, and, where the account holds a row for the
 * session, the store's own id for it, which is what a stored spoken row names
 * as its `voice_session_id`.
 */
export const voiceCreateLiveSessionResultSchema = Schema.Struct({
  sessionId: text,
  sdpAnswer: sdpSchema,
  voiceSessionId: Schema.optionalKey(text),
});

export type VoiceCreateLiveSessionResult = typeof voiceCreateLiveSessionResultSchema.Type;

/** `voice.reportLiveTransport`: the peer connection's state as the peer saw it change. */
export const voiceReportLiveTransportParamsSchema = Schema.Struct({
  state: Schema.Literals(LIVE_TRANSPORT_STATES),
});

/** `voice.reportLiveActivity`: whether the peer has decided, from its own local signals, that the exchange is idle. */
export const voiceReportLiveActivityParamsSchema = Schema.Struct({ idle: Schema.Boolean });

/**
 * What `voice.stopSpeaking` answers: whether a standing session was told to
 * stop. The stop key is the one ask that carries this; a muted microphone
 * says nothing about Luke's own output, so the method takes no parameters
 * and the mute carries none of its meaning.
 */
export const voiceStopSpeakingResultSchema = Schema.Struct({ stopped: Schema.Boolean });

/** `voiceLiveSession.changed`: the phase the host's one session moved to, the id once the provider named one, and the reason of a close. */
export const voiceLiveSessionChangedSchema = Schema.Struct({
  sessionId: Schema.optionalKey(text),
  phase: Schema.Literals(LIVE_SESSION_PHASES),
  reason: Schema.optionalKey(text),
});

export type VoiceLiveSessionChanged = typeof voiceLiveSessionChangedSchema.Type;

/** `conversation.rateMessage`: which of Luke's messages, and the developer's verdict on it, or the word that takes one back. */
export const conversationRateMessageParamsSchema = Schema.Struct({
  /** The message as the view holds it, by its own id, admitted as written so it matches the row the host holds. */
  messageId: keptText(512),
  /** The word under the stored event's own rule, so the method and the row cannot say different things. */
  rating: RatingWordSchema,
});

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

/** What `conversation.rateMessage` answers: whether the rating was recorded, and if not, which of the three refusals stands. */
export const conversationRateMessageResultSchema = Schema.Struct({
  status: Schema.Literals(Object.values(CONVERSATION_RATE_STATUS)),
});

export type ConversationRateMessageResult = typeof conversationRateMessageResultSchema.Type;

/** What `conversation.loadOlder` answers: whether a page of older turns landed on the view, so the panel knows its ask is spent. */
export const conversationLoadOlderResultSchema = Schema.Struct({
  loaded: Schema.Boolean,
});

export type ConversationLoadOlderResult = typeof conversationLoadOlderResultSchema.Type;

/**
 * `conversation.openChildTranscript`: which conversation, by the id its list
 * read it under, admitted as written so it matches the row the service
 * holds, and which list that was, a child's or an observed session's, since
 * the kind says whose head moving means the transcript has more to read.
 */
export const conversationOpenChildTranscriptParamsSchema = Schema.Struct({
  conversationId: keptText(512),
  kind: Schema.Literals(Object.values(TRANSCRIPT_KIND)),
});

/**
 * One file of Luke's notebook as `notebook.read` carries it: where it stands
 * in the workspace, its Markdown from the front and cut at the service's own
 * bound, how many characters the whole row holds, and when it last changed.
 * The shape is the hosted wire's `notebookFileSchema` said again here,
 * because this package cannot reach `@sidecar/hosted` and the renderer's
 * act vocabulary reads its answers through this one.
 */
export const notebookFileSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  content: Schema.String,
  chars: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Epoch milliseconds of the row's last write. */
  updatedAt: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type NotebookFile = typeof notebookFileSchema.Type;

/**
 * What `notebook.read` answers when the service answered: the curated files
 * first and the newest dated notes after, and how many older notes stand
 * behind them uncarried. A host that could not ask — the run sends nothing,
 * the account gate is closed, the call did not land — answers an empty
 * record instead, which a client reads as the notebook being unreadable
 * just now rather than empty.
 */
export const notebookReadResultSchema = Schema.Struct({
  files: Schema.Array(notebookFileSchema),
  omittedNotes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type NotebookReadResult = typeof notebookReadResultSchema.Type;

/** Every way a call can be refused: the dispatcher's own two, and the codes a handler fails with. */
export const GATEWAY_ERROR = {
  UNKNOWN_METHOD: "unknown_method",
  INVALID_PARAMS: "invalid_params",
  NOT_FOUND: "not_found",
  REFUSED: "refused",
  NODE_UNAVAILABLE: "node_unavailable",
  UNKNOWN_CAPABILITY: "unknown_capability",
  INTERNAL: "internal",
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR)[keyof typeof GATEWAY_ERROR];

/** A refused call as the client reads it: the code, and a sentence for a person. */
export interface GatewayError {
  readonly code: GatewayErrorCode;
  readonly message: string;
}

/** One refusal's code, fixed by its class: the constructor takes the message alone. */
function refusalCode<Code extends GatewayErrorCode>(code: Code) {
  return Schema.Literal(code).pipe(Schema.withConstructorDefault(Effect.succeed(code)));
}

/**
 * Every error code as its own tagged error, so a handler that refuses has a
 * typed failure to fail with rather than a bare code. Each class's `code` is
 * the exact string `GATEWAY_ERROR` already names, and the dispatcher hands a
 * client the `{ code, message }` of whichever one a handler failed with.
 */
export class UnknownMethodRefusal extends Schema.TaggedError<UnknownMethodRefusal>()(
  "UnknownMethodRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_METHOD), message: Schema.String },
) {}

export class InvalidParamsRefusal extends Schema.TaggedError<InvalidParamsRefusal>()(
  "InvalidParamsRefusal",
  { code: refusalCode(GATEWAY_ERROR.INVALID_PARAMS), message: Schema.String },
) {}

export class NotFoundRefusal extends Schema.TaggedError<NotFoundRefusal>()("NotFoundRefusal", {
  code: refusalCode(GATEWAY_ERROR.NOT_FOUND),
  message: Schema.String,
}) {}

export class RefusedRefusal extends Schema.TaggedError<RefusedRefusal>()("RefusedRefusal", {
  code: refusalCode(GATEWAY_ERROR.REFUSED),
  message: Schema.String,
}) {}

export class NodeUnavailableRefusal extends Schema.TaggedError<NodeUnavailableRefusal>()(
  "NodeUnavailableRefusal",
  { code: refusalCode(GATEWAY_ERROR.NODE_UNAVAILABLE), message: Schema.String },
) {}

export class UnknownCapabilityRefusal extends Schema.TaggedError<UnknownCapabilityRefusal>()(
  "UnknownCapabilityRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_CAPABILITY), message: Schema.String },
) {}

export class InternalRefusal extends Schema.TaggedError<InternalRefusal>()("InternalRefusal", {
  code: refusalCode(GATEWAY_ERROR.INTERNAL),
  message: Schema.String,
}) {}

/** Every refusal a handler may fail with, one per error code. */
export type GatewayRefusal =
  | UnknownMethodRefusal
  | InvalidParamsRefusal
  | NotFoundRefusal
  | RefusedRefusal
  | NodeUnavailableRefusal
  | UnknownCapabilityRefusal
  | InternalRefusal;

export const GATEWAY_EVENT = {
  /** The Conversation as the service's reads compose it, whole, whenever a poll moved it. */
  CONVERSATION_VIEW_CHANGED: "conversationView.changed",
  /** The account's children as the service's read lists them, whole, whenever a poll moved the list. */
  CHILDREN_CHANGED: "children.changed",
  /** The account's agents as the service's read lists them, whole, whenever a poll moved the list. */
  AGENTS_CHANGED: "agents.changed",
  /** The open transcript, whole, whenever a poll moved it; an empty payload says none is open. */
  // Named for the child's transcript still, whichever kind is open.
  CHILD_TRANSCRIPT_CHANGED: "childTranscript.changed",
  NODE_CHANGED: "node.changed",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CHANGED: "account.changed",
  SESSIONS_CHANGED: "sessions.changed",
  WORKSPACE_PROJECTS_CHANGED: "workspaceProjects.changed",
  CALENDARS_CHANGED: "calendars.changed",
  ANNOUNCEMENTS_HELD_CHANGED: "announcementsHeld.changed",
  CALENDAR_ONBOARDING_CHANGED: "calendarOnboarding.changed",
  /** Whether the spoken introduction is owed moved: the first sign-in this install observed put it up, or its completion took it down. */
  INTRODUCTION_CHANGED: "introduction.changed",
  /** Whether the Conductor key step of onboarding stands moved: the first sign-in put it up, a key in the vault or the skip took it down. */
  CONDUCTOR_KEY_ONBOARDING_CHANGED: "conductorKeyOnboarding.changed",
  VOICE_LIVE_SESSION_CHANGED: "voiceLiveSession.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
  /** The planning window's plans, active plan, and document, whole, whenever a read moved them. */
  PLANNING_CHANGED: "planning.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

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
 * unavailable: the ask reached the node and no answer came back, so the
 * effect may have happened. What reads an unknown must record the action as
 * uncertain, never as failed and never as safe to repeat.
 */
export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  /** Never dispatched: no connected node offered the capability. */
  UNAVAILABLE: "unavailable",
  /** The node performed and reported a failure. */
  FAILED: "failed",
  /** Dispatched, and the answer lost; the effect is uncertain. */
  UNKNOWN: "unknown",
} as const;

export type NodeCapabilityResult =
  | { readonly status: typeof NODE_CAPABILITY_STATUS.OK; readonly value: WireValue | undefined }
  | {
      readonly status:
        | typeof NODE_CAPABILITY_STATUS.UNAVAILABLE
        | typeof NODE_CAPABILITY_STATUS.FAILED
        | typeof NODE_CAPABILITY_STATUS.UNKNOWN;
      readonly capability: string;
      readonly reason: string;
    };
