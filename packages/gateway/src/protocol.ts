import { isIdentifier } from "@sidecar/runtime/vocabulary";
import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  RECORD_EXTRA_KEYS,
  type RecordOf,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";

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
interface GatewayMethodEntry {
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
  TRACKER_CONNECT: { name: "tracker.connect", mutates: true },
  TRACKER_CANCEL_SIGN_IN: { name: "tracker.cancelSignIn", mutates: true },
  TRACKER_REOPEN_SIGN_IN: { name: "tracker.reopenSignIn", mutates: true },
  TRACKER_DISCONNECT: { name: "tracker.disconnect", mutates: true },
  SUPERSET_STATUS: { name: "superset.status", mutates: false },
  SUPERSET_BEGIN_SIGN_IN: { name: "superset.beginSignIn", mutates: true },
  SUPERSET_SUBMIT_CODE: { name: "superset.submitCode", mutates: true },
  SUPERSET_CHOOSE_ORGANIZATION: { name: "superset.chooseOrganization", mutates: true },
  SUPERSET_REOPEN_SIGN_IN: { name: "superset.reopenSignIn", mutates: true },
  SUPERSET_CANCEL_SIGN_IN: { name: "superset.cancelSignIn", mutates: true },
  SUPERSET_DISCONNECT: { name: "superset.disconnect", mutates: true },
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
} as const satisfies Record<string, GatewayMethodEntry>;

export const GATEWAY_METHOD =
  // SAFETY: the entries are this same table's, so every key answers its own entry's name.
  Object.fromEntries(
    Object.entries(GATEWAY_METHODS).map(([held, entry]) => [held, entry.name]),
  ) as { readonly [K in keyof typeof GATEWAY_METHODS]: (typeof GATEWAY_METHODS)[K]["name"] };

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

const GATEWAY_METHODS_BY_NAME: ReadonlyMap<string, GatewayMethodEntry> = new Map(
  Object.values(GATEWAY_METHODS).map((entry) => [entry.name, entry]),
);

export function isGatewayMethod(value: UnparsedWireValue): value is GatewayMethod {
  return isWireString(value) && GATEWAY_METHODS_BY_NAME.has(value);
}

export function isMutatingGatewayMethod(method: GatewayMethod): boolean {
  return GATEWAY_METHODS_BY_NAME.get(method)?.mutates === true;
}

/** What a caller may say it expects to still stand when its request lands. */
export interface GatewayExpectedRevision {
  /** The conversation whose lifetime the caller read, and the generation it read there. */
  sessionKey?: string;
  sessionRevision?: string;
  /** The configuration revision the caller read. */
  configurationRevision?: number;
}

export interface GatewayRequest {
  protocolVersion: number;
  id: string;
  method: GatewayMethod;
  params: WireRecord;
  idempotencyKey?: string;
  expectedRevision?: GatewayExpectedRevision;
}

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

const GATEWAY_ERROR_LIST: readonly GatewayErrorCode[] = Object.values(GATEWAY_ERROR);

export function isGatewayErrorCode(value: UnparsedWireValue): value is GatewayErrorCode {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && GATEWAY_ERROR_LIST.includes(value as GatewayErrorCode);
}

export interface GatewayError {
  code: GatewayErrorCode;
  message: string;
}

/** The revisions that stood when an answer was formed, so a client can name them on its next ask. */
export interface GatewayRevision {
  configuration: number;
  sequence: number;
}

export type GatewayResponse =
  | { id: string; ok: true; result: WireValue | undefined; revision: GatewayRevision }
  | { id: string; ok: false; error: GatewayError; revision: GatewayRevision };

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
  SUPERSET_SIGN_IN_CHANGED: "supersetSignIn.changed",
  CALENDAR_ONBOARDING_CHANGED: "calendarOnboarding.changed",
  VOICE_LIVE_SESSION_CHANGED: "voiceLiveSession.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

const GATEWAY_EVENT_LIST: readonly GatewayEventKind[] = Object.values(GATEWAY_EVENT);

export function isGatewayEventKind(value: UnparsedWireValue): value is GatewayEventKind {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && GATEWAY_EVENT_LIST.includes(value as GatewayEventKind);
}

export interface GatewayEvent {
  eventId: string;
  /** One more than the event before it, from 1, so a gap is a number a client can see. */
  sequence: number;
  kind: GatewayEventKind;
  at: number;
  sessionKey?: string;
  runId?: string;
  payload: WireValue;
}

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

export type GatewayReconnectAnswer =
  | { kind: typeof GATEWAY_RECONNECT_KIND.REPLAY; events: readonly GatewayEvent[] }
  | { kind: typeof GATEWAY_RECONNECT_KIND.SNAPSHOT; sequence: number; snapshot: WireValue };

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

export type NodeCapabilityResult =
  | { status: typeof NODE_CAPABILITY_STATUS.OK; value: WireValue | undefined }
  | { status: typeof NODE_CAPABILITY_STATUS.UNAVAILABLE; capability: string; reason: string }
  | { status: typeof NODE_CAPABILITY_STATUS.FAILED; capability: string; reason: string }
  | { status: typeof NODE_CAPABILITY_STATUS.UNKNOWN; capability: string; reason: string };

function expectedRevisionFromWire(
  value: UnparsedWireValue,
): GatewayExpectedRevision | undefined | false {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return false;
  const revision: GatewayExpectedRevision = {};
  if (value.sessionKey !== undefined) {
    if (!isIdentifier(value.sessionKey)) return false;
    revision.sessionKey = value.sessionKey;
  }
  if (value.sessionRevision !== undefined) {
    if (!isWireString(value.sessionRevision)) return false;
    revision.sessionRevision = value.sessionRevision;
  }
  if (value.configurationRevision !== undefined) {
    if (!isWireNumber(value.configurationRevision)) return false;
    revision.configurationRevision = value.configurationRevision;
  }
  return revision;
}

/**
 * The two envelopes on their way out, beside the readers that take them back
 * in. Every transport that carries the protocol as text writes them the same
 * way, so an explicitly absent field leaves rather than travelling as null:
 * the readers refuse a shape they never sent.
 */
export function gatewayRequestToWire(request: GatewayRequest): WireRecord {
  return {
    protocolVersion: request.protocolVersion,
    id: request.id,
    method: request.method,
    params: request.params,
    ...(request.idempotencyKey !== undefined
      ? { idempotencyKey: request.idempotencyKey }
      : undefined),
    ...(request.expectedRevision !== undefined
      ? { expectedRevision: { ...request.expectedRevision } }
      : undefined),
  };
}

export function gatewayResponseToWire(response: GatewayResponse): WireRecord {
  const revision = {
    configuration: response.revision.configuration,
    sequence: response.revision.sequence,
  };
  return response.ok
    ? {
        id: response.id,
        ok: true,
        ...(response.result !== undefined ? { result: response.result } : undefined),
        revision,
      }
    : { id: response.id, ok: false, error: { ...response.error }, revision };
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
  if (!isRecord(value)) return undefined;
  if (!isWireNumber(value.protocolVersion) || !isIdentifier(value.id)) return undefined;
  if (!isGatewayMethod(value.method) || !isRecord(value.params)) return undefined;
  const expected = expectedRevisionFromWire(value.expectedRevision);
  if (expected === false) return undefined;
  if (value.idempotencyKey !== undefined && !isIdentifier(value.idempotencyKey)) return undefined;
  return {
    protocolVersion: value.protocolVersion,
    id: value.id,
    method: value.method,
    params: value.params,
    ...(value.idempotencyKey !== undefined ? { idempotencyKey: value.idempotencyKey } : undefined),
    ...(expected ? { expectedRevision: expected } : undefined),
  };
}

function revisionFromWire(value: UnparsedWireValue): GatewayRevision | undefined {
  if (!isRecord(value) || !isWireNumber(value.configuration) || !isWireNumber(value.sequence)) {
    return undefined;
  }
  return { configuration: value.configuration, sequence: value.sequence };
}

export function gatewayResponseFromWire(value: UnparsedWireValue): GatewayResponse | undefined {
  if (!isRecord(value) || !isIdentifier(value.id) || !isWireBoolean(value.ok)) return undefined;
  const revision = revisionFromWire(value.revision);
  if (!revision) return undefined;
  if (value.ok) return { id: value.id, ok: true, result: value.result, revision };
  if (
    !isRecord(value.error) ||
    !isGatewayErrorCode(value.error.code) ||
    !isWireString(value.error.message)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ok: false,
    error: { code: value.error.code, message: value.error.message },
    revision,
  };
}

export function gatewayEventFromWire(value: UnparsedWireValue): GatewayEvent | undefined {
  if (!isRecord(value) || !isIdentifier(value.eventId)) return undefined;
  if (!isWireNumber(value.sequence) || !isGatewayEventKind(value.kind)) return undefined;
  if (!isWireNumber(value.at) || value.payload === undefined) return undefined;
  if (value.sessionKey !== undefined && !isIdentifier(value.sessionKey)) return undefined;
  if (value.runId !== undefined && !isIdentifier(value.runId)) return undefined;
  return {
    eventId: value.eventId,
    sequence: value.sequence,
    kind: value.kind,
    at: value.at,
    ...(value.sessionKey !== undefined ? { sessionKey: value.sessionKey } : undefined),
    ...(value.runId !== undefined ? { runId: value.runId } : undefined),
    payload: value.payload,
  };
}

export function gatewayReconnectAnswerFromWire(
  value: UnparsedWireValue,
): GatewayReconnectAnswer | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === GATEWAY_RECONNECT_KIND.REPLAY) {
    if (!Array.isArray(value.events)) return undefined;
    const events: GatewayEvent[] = [];
    for (const event of value.events) {
      const parsed = gatewayEventFromWire(event);
      if (!parsed) return undefined;
      events.push(parsed);
    }
    return { kind: GATEWAY_RECONNECT_KIND.REPLAY, events };
  }
  if (value.kind === GATEWAY_RECONNECT_KIND.SNAPSHOT) {
    if (!isWireNumber(value.sequence) || value.snapshot === undefined) return undefined;
    return {
      kind: GATEWAY_RECONNECT_KIND.SNAPSHOT,
      sequence: value.sequence,
      snapshot: value.snapshot,
    };
  }
  return undefined;
}

export function nodeCapabilityResultToWire(result: NodeCapabilityResult): WireRecord {
  return result.status === NODE_CAPABILITY_STATUS.OK
    ? {
        status: result.status,
        ...(result.value !== undefined ? { value: result.value } : undefined),
      }
    : { status: result.status, capability: result.capability, reason: result.reason };
}

/**
 * The host asking one connected node to perform one of its capabilities. It
 * travels on that node's own connection and nowhere else: never in the event
 * log, so a reconnecting client is never replayed an ask to act, and never to
 * another client, so no other process sees the parameters or can answer for
 * the node. The id binds the answer to the ask; a connection that closes
 * before answering leaves the ask unavailable and the effect uncertain.
 */
export interface NodeInvocation {
  invocationId: string;
  nodeId: string;
  capability: string;
  params: WireRecord;
}

export interface NodeInvocationAnswer {
  invocationId: string;
  result: NodeCapabilityResult;
}

export function nodeInvocationToWire(invocation: NodeInvocation): WireRecord {
  return {
    invocationId: invocation.invocationId,
    nodeId: invocation.nodeId,
    capability: invocation.capability,
    params: invocation.params,
  };
}

export function nodeInvocationFromWire(value: UnparsedWireValue): NodeInvocation | undefined {
  if (!isRecord(value) || !isIdentifier(value.invocationId) || !isIdentifier(value.nodeId)) {
    return undefined;
  }
  if (!isWireString(value.capability) || !isRecord(value.params)) return undefined;
  return {
    invocationId: value.invocationId,
    nodeId: value.nodeId,
    capability: value.capability,
    params: value.params,
  };
}

export function nodeInvocationAnswerToWire(answer: NodeInvocationAnswer): WireRecord {
  return { invocationId: answer.invocationId, result: nodeCapabilityResultToWire(answer.result) };
}

export function nodeInvocationAnswerFromWire(
  value: UnparsedWireValue,
): NodeInvocationAnswer | undefined {
  if (!isRecord(value) || !isIdentifier(value.invocationId)) return undefined;
  const result = nodeCapabilityResultFromWire(value.result);
  return result ? { invocationId: value.invocationId, result } : undefined;
}

export function nodeCapabilityResultFromWire(
  value: UnparsedWireValue,
): NodeCapabilityResult | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === NODE_CAPABILITY_STATUS.OK) {
    return { status: NODE_CAPABILITY_STATUS.OK, value: value.value };
  }
  if (
    (value.status === NODE_CAPABILITY_STATUS.UNAVAILABLE ||
      value.status === NODE_CAPABILITY_STATUS.FAILED ||
      value.status === NODE_CAPABILITY_STATUS.UNKNOWN) &&
    isWireString(value.capability) &&
    isWireString(value.reason)
  ) {
    return { status: value.status, capability: value.capability, reason: value.reason };
  }
  return undefined;
}
