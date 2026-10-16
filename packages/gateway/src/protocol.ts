/**
 * protocol.ts -- the Gateway's vocabulary: the methods a client asks the host,
 * the events the host tells every client, the refusals a handler fails with,
 * and the parameter and result shapes the desktop reads.
 *
 * The vocabulary lives here, below every implementation, so the host that
 * answers a method and the client that calls it read the same words from one
 * contract. Nothing in this file performs anything.
 */
import type { WireValue } from "@luke/wire";
import { Effect, Schema } from "effect";

/** Every method the host answers, by the name a client calls it. */
export const GATEWAY_METHOD = {
  SHUTDOWN: "gateway.shutdown",
  /** The panel's Plans tab shows: the plan list read now, and the active plan's document with it. */
  PLANNING_REFRESH: "planning.refresh",
  /** One plan made the active one and its saved document read, replacing whichever was active. */
  PLANNING_OPEN: "planning.open",
  /** The developer left the open plan: its call ends and no plan is active. */
  PLANNING_CLOSE: "planning.close",
  /** A named plan started on the service, on the repository it names where it names one, and made the active one. */
  PLANNING_START: "planning.start",
  /** One plan deleted on the service; deleting the open plan ends its call and leaves no plan active. */
  PLANNING_DELETE: "planning.delete",
  /** One plan renamed on the service; the list and the open document take the name it answered without reading either again. */
  PLANNING_RENAME: "planning.rename",
  /** One plan pinned or unpinned on the service; the list and the open document take the plan it answered without reading either again. */
  PLANNING_PIN: "planning.pin",
  PLANNING_PIN_REPOSITORY: "planning.pinRepository",
  /** One plan archived or brought back on the service, taken in place as a pin is; the open plan stays open either way. */
  PLANNING_ARCHIVE: "planning.archive",
  /** The repositories the account reaches through the Luke GitHub App, read from the service now. */
  PLANNING_REPOSITORIES: "planning.repositories",
  /** One plan given its repository on the service, or none; the list and the open document take what it answered without reading either again. */
  PLANNING_SET_REPOSITORY: "planning.setRepository",
  /** One plan moved to another of the account's workspaces on the service; the list and the open document take the plan it answered without reading either again. */
  PLANNING_MOVE: "planning.move",
  /** The developer's edit of a plan's document saved on the service; the open document takes the plan it answered, and a conflict leaves it unchanged. */
  PLANNING_EDIT: "planning.edit",
  /** The page of the open plan's work before the oldest turn held, read from the service where an older one stands; the view takes it. */
  PLANNING_WORK_EARLIER: "planning.workEarlier",
  /** The page of the open plan's conversation before the oldest turn held, read from the service where an older one stands; the view takes it before the rest, and the held read's cursor stays. */
  PLANNING_CONVERSATION_EARLIER: "planning.conversationEarlier",
  /** One page of a plan's conversation as an agent's transcript is read, or a planning worker's under the call that started it, held open by the service while a turn or the worker runs; answered to the caller, never held in the view. */
  PLANNING_MESSAGES: "planning.messages",
  /** A window of a file of one plan's repository, read from GitHub through the service as it stands now and coloured here; answered to the caller, never held in the view. */
  PLANNING_FILE: "planning.file",
  /** One folder of one plan's repository, listed from GitHub through the service as it stands now; answered to the caller, never held in the view. */
  PLANNING_TREE: "planning.tree",
  /** The skills a developer may choose of one plan's repository, read from GitHub through the service as it stands now; answered to the caller, never held in the view. */
  PLANNING_SKILLS: "planning.skills",
  /** One pull request of a repository a workspace's installation reaches, by its number, read from GitHub through the service as it stands now; answered to the caller, never held in the view. */
  PLANNING_PULL_REQUEST: "planning.pullRequest",
  /** A page of one plan's history, read from the service; answered to the caller, never held in the view. */
  PLANNING_REVISIONS: "planning.revisions",
  /** One revision of one plan beside the one before it, read from the service; answered to the caller, never held in the view. */
  PLANNING_REVISION: "planning.revision",
  /** One version of one page of one plan with its HTML, read from the service for the frame that draws it; answered to the caller, never held in the view. */
  PLANNING_PAGE: "planning.page",
  /** One picture of one plan, read from the service now as its bytes in base64; answered to the caller, never held in the view. */
  PLANNING_PICTURE: "planning.picture",
  /** One picture kept on one plan on the service, sent as a `data:` URL, answered with the id its text names it by; never held in the view. */
  PLANNING_PICTURE_KEEP: "planning.pictureKeep",
  /** One revision of one plan put back as its content on the service; the view takes the plan as the service answered it. */
  PLANNING_RESTORE: "planning.restore",
  /** The developer's scene of the open plan's whiteboard, saved over the revision it was drawn on; the view takes the board as the service answered it. */
  PLANNING_BOARD_SAVE: "planning.boardSave",
  /** The account's workspaces read again from the service where the last read is a minute old or none stands; the view takes them. */
  WORKSPACES_REFRESH: "workspaces.refresh",
  /** A workspace made on the service under a name, owned by the account; the view's workspaces are read again. */
  WORKSPACES_CREATE: "workspaces.create",
  /** A workspace renamed on the service by an owner or admin; the view's workspaces are read again. */
  WORKSPACES_RENAME: "workspaces.rename",
  /** A workspace's photo set or removed on the service by an owner or admin; the view's workspaces are read again. */
  WORKSPACES_PHOTO_SET: "workspaces.photoSet",
  /** A GitHub organization's connection to a workspace begun on the service: the Luke GitHub App's install address, for the caller to open. */
  WORKSPACES_GITHUB_CONNECT: "workspaces.githubConnect",
  /** A workspace's GitHub organization disconnected on the service; the view's workspaces are read again. */
  WORKSPACES_GITHUB_DISCONNECT: "workspaces.githubDisconnect",
  /** A workspace's Linear connection begun on the service by an owner or admin: Vercel Connect's sign-in address, for the caller to open. */
  WORKSPACES_LINEAR_CONNECT: "workspaces.linearConnect",
  /** A workspace's Linear disconnected on the service; the view's workspaces are read again. */
  WORKSPACES_LINEAR_DISCONNECT: "workspaces.linearDisconnect",
  /** The Linear issues a workspace's connection reaches, read from the service now; answered to the caller, never held in the view. */
  WORKSPACES_LINEAR_ISSUES: "workspaces.linearIssues",
  /** One workspace's members, read from the service now; answered to the caller, never held in the view. */
  WORKSPACES_MEMBERS: "workspaces.members",
  /** One workspace's photo, read from the service now as its bytes in base64; answered to the caller, never held in the view. */
  WORKSPACES_PHOTO: "workspaces.photo",
  /** One member removed from a workspace on the service, answered with the members who remain; the view's workspaces are read again. */
  WORKSPACES_MEMBER_REMOVE: "workspaces.memberRemove",
  /** Another member made an admin or an admin a member on the service by the owner, answered with the members as they then stand; the view's workspaces are read again. */
  WORKSPACES_MEMBER_ROLE: "workspaces.memberRole",
  /** A workspace handed by its owner to one of its admins on the service, the owner becoming an admin, answered with the members as they then stand; the view's workspaces are read again, the account's role in it among them. */
  WORKSPACES_TRANSFER: "workspaces.transfer",
  /** The account left one workspace on the service; the view's workspaces and plans are read again. */
  WORKSPACES_LEAVE: "workspaces.leave",
  /** One workspace's pending invitations, read from the service now; answered to the caller, never held in the view. */
  WORKSPACES_INVITATIONS: "workspaces.invitations",
  /** An invitation to a workspace made on the service, answered with its accept link. */
  WORKSPACES_INVITE: "workspaces.invite",
  /** A pending invitation canceled on the service, answered with those still pending. */
  WORKSPACES_INVITATION_CANCEL: "workspaces.invitationCancel",
  /** The page that connects the account's GitHub, asked of the service now and used once; the next workspaces read is owed at once. */
  GITHUB_CONNECT: "github.connect",
  /** The account's GitHub disconnected on the service under the Mac's session; the view takes the connection, and the next workspaces read is owed at once. */
  GITHUB_DISCONNECT: "github.disconnect",
  /** The models a coding agent may run on, read from the service's catalog now. */
  CODING_AGENTS_MODELS: "codingAgents.models",
  /** The account's default model and effort for a coding agent, read from the service now. */
  CODING_AGENTS_DEFAULT_READ: "codingAgents.defaultRead",
  /** The account's default model and effort for a coding agent, written to the service; the default as kept, or why it is unchanged. */
  CODING_AGENTS_DEFAULT_WRITE: "codingAgents.defaultWrite",
  /** One plan's coding agents with their status, read from the service now. */
  CODING_AGENTS_LIST: "codingAgents.list",
  /** A workspace's coding agents, newest started first, narrowed to one repository where one is named. */
  CODING_AGENTS_WORKSPACE_LIST: "codingAgents.workspaceList",
  /** A coding agent started on one plan under the panel's own key; the agent, or why none started. */
  CODING_AGENTS_START: "codingAgents.start",
  /** One agent's transcript past a cursor, held open by the service while the agent runs. */
  CODING_AGENTS_MESSAGES: "codingAgents.messages",
  /** One agent sent a message, naming how it reaches a turn under way; the agent as it then stands, or why it was not. */
  CODING_AGENTS_MESSAGE: "codingAgents.message",
  /** One agent's model and effort changed for its next step; the agent as it then stands, or why it is unchanged. */
  CODING_AGENTS_CHOOSE: "codingAgents.choose",
  /** One agent renamed, or its title cleared; the agent as it then stands, or why it is unchanged. */
  CODING_AGENTS_RENAME: "codingAgents.rename",
  /** One agent's MCP servers switched, the whole list of those off, for its next turn on; the agent as it then stands, or why it is unchanged. */
  CODING_AGENTS_SERVERS: "codingAgents.servers",
  /** One agent stopped; the agent as it then stands, or why it was not. */
  CODING_AGENTS_STOP: "codingAgents.stop",
  /** One agent archived, a turn it still runs stopped first, or brought back; the agent as it then stands, or why it is unchanged. */
  CODING_AGENTS_ARCHIVE: "codingAgents.archive",
  /** One agent pinned for the account alone, or unpinned; the agent as it then stands, or why it is unchanged. */
  CODING_AGENTS_PIN: "codingAgents.pin",
  /** What one agent published: the branch it pushed and the pull request from it, as GitHub holds them now. */
  CODING_AGENTS_PAGE: "codingAgents.page",
  AUTOMATIONS_LIST: "automations.list",
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  AUTOMATIONS_RUNS: "automations.runs",
  /** A webhook trigger's secret minted again by the host, its hash sent to the service, and the secret answered once to the window that asked (root AGENTS.md's carve-out). */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
  CODING_AGENTS_PULL_REQUEST: "codingAgents.pullRequest",
  /** One agent's changes: the files of its pull request as GitHub holds them now, each with its patch. */
  CODING_AGENTS_CHANGES: "codingAgents.changes",
  /** One agent's pull request as its Pull request tab draws it: its description, checks, reviewers, and conversation as GitHub holds them now. */
  CODING_AGENTS_OVERVIEW: "codingAgents.overview",
  /** One image an agent's pull request's overview names, read by the service on the App's token: its bytes in base64 and their type. */
  CODING_AGENTS_GITHUB_IMAGE: "codingAgents.githubImage",
  /** The account's own provider keys an agent runs on, read from the service now as hints and statuses; never a key. */
  PROVIDER_KEYS_READ: "providerKeys.read",
  /** One provider key saved on the service, the key carried once in the params; the keys as they then stand, or why nothing was kept. */
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  /** One provider's key removed on the service; the keys as they then stand. */
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  /** The Markdown the account's new plans start from, read from the service now: its own, or the default while it keeps none. */
  PLAN_TEMPLATE_READ: "planTemplate.read",
  /** The account's plan template kept verbatim on the service, or the default again for null; the template as kept, or why it is unchanged. */
  PLAN_TEMPLATE_WRITE: "planTemplate.write",
  /** A page of the account's plan template history, read from the service now, newest first; or why there is none. */
  PLAN_TEMPLATE_REVISIONS: "planTemplate.revisions",
  /** One revision of the account's plan template beside the one before it; or why there is none. */
  PLAN_TEMPLATE_REVISION: "planTemplate.revision",
  /** One revision of the account's plan template put back as the template; the template as kept, or why it is unchanged. */
  PLAN_TEMPLATE_RESTORE: "planTemplate.restore",
  /** One clip dictated into an agent's message box, carried once to the service; its words, or why there are none. Nothing of it is kept. */
  DICTATION_TRANSCRIBE: "dictation.transcribe",
  /** One plan's inbox past a cursor: every item its coding agents posted for the developer, held open by the service while nothing changed. */
  CODING_AGENTS_INBOX: "codingAgents.inbox",
  CODING_AGENTS_AGENT_INBOX: "codingAgents.agentInbox",
  /** One item of a plan's inbox answered against the revision the panel drew, under the panel's own key; the item as it then stands and whether the answer was taken, or why there is no answer. */
  CODING_AGENTS_INBOX_ANSWER: "codingAgents.inboxAnswer",
  /** Where every one of the account's integrations stands, read from the service now. */
  INTEGRATIONS_STATUS: "integrations.status",
  /** A browser sign-in to one account at a provider, or to a new one, begun on the service and opened on this Mac; whether it was opened and the account it signs in, never the address. */
  INTEGRATIONS_CONNECT: "integrations.connect",
  /** The tools one account's server offers the account's agents, read from the service now. */
  INTEGRATIONS_TOOLS: "integrations.tools",
  /** The account's sign-in to one account at a provider under way ended on the service, revoking nothing; where it then stands. */
  INTEGRATIONS_CANCEL: "integrations.cancel",
  /** The account's connection to one account at a provider ended on the service; where it then stands. */
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  /** One account at a provider named as the developer calls it, on the service; the account as it then stands. */
  INTEGRATIONS_RENAME: "integrations.rename",
  /** What waits on the developer across the account's plans past a cursor: every open inbox item, held open by the service while nothing changed. Main's own read, which no window asks. */
  CODING_AGENTS_ACCOUNT_INBOX: "codingAgents.accountInbox",
  /** One image of an inbox item, fetched under the account: its bytes in base64 under the media type the service kept, or why there is none. */
  CODING_AGENTS_INBOX_ATTACHMENT: "codingAgents.inboxAttachment",
  /** One picture a tool answered an agent or one of its workers, fetched under the account: its bytes in base64 under the media type the service kept, or why there is none. */
  CODING_AGENTS_PICTURE: "codingAgents.picture",
  /**
   * A coding agent's terminals (`@luke/features/terminal-view`): its shells
   * listed, started, named, and ended, and its sandbox resumed on the
   * developer's click; and a shell attached for one panel under a
   * connection id the desktop minted, typed into, resized, acked, woken
   * after a sleep, and detached. What a shell prints is heard as
   * `TERMINAL_OUTPUT` events, never answered.
   */
  TERMINALS_LIST: "terminals.list",
  TERMINALS_CREATE: "terminals.create",
  TERMINALS_RENAME: "terminals.rename",
  TERMINALS_KILL: "terminals.kill",
  TERMINALS_RESUME: "terminals.resume",
  TERMINALS_CONNECT: "terminals.connect",
  TERMINALS_INPUT: "terminals.input",
  TERMINALS_RESIZE: "terminals.resize",
  TERMINALS_ACK: "terminals.ack",
  TERMINALS_DISCONNECT: "terminals.disconnect",
  TERMINALS_WAKE: "terminals.wake",
  /** Everything a window's bootstrap reads of the host, in one answer. */
  CLIENT_BOOTSTRAP: "client.bootstrap",
  SETTINGS_SNAPSHOT: "settings.snapshot",
  SETTINGS_UPDATE: "settings.update",
  SETTINGS_UPDATE_ENTRY: "settings.updateEntry",
  SETTINGS_RESET: "settings.reset",
  /** One experiment turned on or off for the signed-in account on the service; the settings as they then stand, the experiments among them. */
  EXPERIMENTS_SET: "experiments.set",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  /** The sign-in taken again over the session that stands, answering whether a new one landed. */
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  /** Luke's avatar on the standing call asked for or taken down; whether the service was asked. The grant it draws never crosses here. */
  VOICE_SET_VIDEO: "voice.setVideo",
  /** One live event the renderer's tap saw cross the data channel, for the host's development trace; a no-op where no writer stands. */
  VOICE_RECORD_TRACE: "voice.recordTrace",
  ANALYTICS_RECORD: "analytics.record",
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
  /** The provider created the session; its answer is on its way to the peer. */
  CREATED: "created",
  /** The provider announced the session live. */
  STARTED: "started",
  /**
   * Luke said goodbye and is ending the call: the peer hangs up through its
   * own hang-up once the goodbye has played, or keeps the call up if the
   * developer speaks first. The host ends nothing on it.
   */
  ENDING: "ending",
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
 * Why the peer ended its side of a call, told with the closed transport it
 * reports, so the host's line about the end names the peer's own reason.
 */
export const LIVE_PEER_END_REASON = {
  /** The developer or the policy above the peer hung up. */
  HUNG_UP: "hung_up",
  /** The hang-up's `session.closed` did not arrive within its bound. */
  CLOSE_TIMED_OUT: "close_timed_out",
  /** `session.closed` reached the peer unasked. */
  SERVICE_CLOSED: "service_closed",
  /** The data channel closed under the peer. */
  CHANNEL_CLOSED: "channel_closed",
  /** The peer connection reported itself failed. */
  TRANSPORT_FAILED: "transport_failed",
  /** The created session never announced itself started. */
  START_TIMED_OUT: "start_timed_out",
} as const;

export type LivePeerEndReason = (typeof LIVE_PEER_END_REASON)[keyof typeof LIVE_PEER_END_REASON];

const LIVE_PEER_END_REASONS: readonly LivePeerEndReason[] = Object.values(LIVE_PEER_END_REASON);

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

/**
 * `voice.createLiveSession`: the peer's SDP offer, and the plan the call is
 * about. The host creates a call only for the plan the panel has open.
 */
export const voiceCreateLiveSessionParamsSchema = Schema.Struct({
  sdp: sdpSchema,
  planId: text,
});

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

/**
 * `voice.endLiveSession`: the peer's hang-up, naming the session it hangs up,
 * so an old call still closing behind a newer one ends nothing but its own.
 */
export const voiceEndLiveSessionParamsSchema = Schema.Struct({ sessionId: text });

export type VoiceEndLiveSessionParams = typeof voiceEndLiveSessionParamsSchema.Type;

/**
 * `voice.reportLiveTransport`: the peer connection's state as the peer saw it
 * change, the session that peer was created for, and why the peer ended where
 * it did. The session is named for the same reason the hang-up names it: an
 * old peer's late close is about its own session and never the next one.
 */
export const voiceReportLiveTransportParamsSchema = Schema.Struct({
  sessionId: text,
  state: Schema.Literals(LIVE_TRANSPORT_STATES),
  reason: Schema.optionalKey(Schema.Literals(LIVE_PEER_END_REASONS)),
});

export type VoiceReportLiveTransportParams = typeof voiceReportLiveTransportParamsSchema.Type;

/** `voice.reportLiveActivity`: whether the peer has decided, from its own local signals, that the exchange is idle. */
export const voiceReportLiveActivityParamsSchema = Schema.Struct({ idle: Schema.Boolean });

/**
 * What `voice.stopSpeaking` answers: whether a standing session was told to
 * stop. The stop key is the one ask that carries this; a muted microphone
 * says nothing about Luke's own output, so the method takes no parameters
 * and the mute carries none of its meaning.
 */
export const voiceStopSpeakingResultSchema = Schema.Struct({ stopped: Schema.Boolean });

/** `voice.setVideo`: the developer turning Luke's avatar on or off on the standing call. */
export const voiceSetVideoParamsSchema = Schema.Struct({ on: Schema.Boolean });

/**
 * What `voice.setVideo` answers: whether the service was asked. The avatar's
 * grant answers the ask on the voice socket and goes from the host to the
 * call window in process alone, so this answer never carries it, and nor
 * does any Gateway event.
 */
export const voiceSetVideoResultSchema = Schema.Struct({ requested: Schema.Boolean });

/** `voiceLiveSession.changed`: the phase the host's one session moved to, the id once the provider named one, and the reason of a close. */
export const voiceLiveSessionChangedSchema = Schema.Struct({
  sessionId: Schema.optionalKey(text),
  phase: Schema.Literals(LIVE_SESSION_PHASES),
  reason: Schema.optionalKey(text),
});

export type VoiceLiveSessionChanged = typeof voiceLiveSessionChangedSchema.Type;

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
  NODE_CHANGED: "node.changed",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CHANGED: "account.changed",
  VOICE_LIVE_SESSION_CHANGED: "voiceLiveSession.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
  /** The panel's plans, active plan, and document, whole, whenever a read moved them. */
  PLANNING_CHANGED: "planning.changed",
  /** What an attached shell printed, named by its connection, for the one panel that connection's port reaches. */
  TERMINAL_OUTPUT: "terminal.output",
  /** How an attached shell's connection stands, named by its connection. */
  TERMINAL_STATE: "terminal.state",
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
