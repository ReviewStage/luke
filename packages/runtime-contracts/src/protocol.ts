import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { isIdentifier } from "./identifiers.js";

/**
 * The Gateway protocol: what a client asks the host and what the host tells
 * every client, as versioned envelopes. The vocabulary lives here, below
 * every implementation, because the desktop, the voice window's main-process
 * relay, and one day a process on the other side of a socket all read the
 * same shapes. Nothing in this file performs anything; it says what a request,
 * an answer, and an event look like, and refuses shapes it does not know.
 */
export const GATEWAY_PROTOCOL_VERSION = 1;

export const GATEWAY_METHOD = {
  HELLO: "gateway.hello",
  RECONNECT: "gateway.reconnect",
  CONVERSATION_LIST: "conversation.list",
  CONVERSATION_CREATE: "conversation.create",
  CONVERSATION_HISTORY: "conversation.history",
  CONVERSATION_RESET: "conversation.reset",
  CONVERSATION_ARCHIVE: "conversation.archive",
  CONVERSATION_UNARCHIVE: "conversation.unarchive",
  CONVERSATION_DELETE: "conversation.delete",
  CONVERSATION_RESTORE: "conversation.restore",
  RUN_SUBMIT: "run.submit",
  RUN_STEER: "run.steer",
  RUN_CANCEL: "run.cancel",
  RUN_WAIT: "run.wait",
  RUN_STATUS: "run.status",
  RUN_LIST: "run.list",
  CHILD_LIST: "child.list",
  CHILD_STATUS: "child.status",
  CHILD_CANCEL: "child.cancel",
  CHILD_COMPLETIONS: "child.completions",
  MEMORY_SEARCH: "memory.search",
  MEMORY_GET: "memory.get",
  MEMORY_FORGET: "memory.forget",
  MEMORY_STATUS: "memory.status",
  CONFIGURATION_SNAPSHOT: "configuration.snapshot",
  CONFIGURATION_UPDATE: "configuration.update",
  OBSERVATION_STATE: "observation.state",
  NODE_REGISTER: "node.register",
  NODE_UNREGISTER: "node.unregister",
  NODE_INVOKE: "node.invoke",
  DELIVERY_LIST: "delivery.list",
  DELIVERY_CLAIM: "delivery.claim",
  DELIVERY_ACKNOWLEDGE: "delivery.acknowledge",
  DELIVERY_GRANT_ON_CALL: "delivery.grantOnCall",
} as const;

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

const GATEWAY_METHOD_LIST: readonly GatewayMethod[] = Object.values(GATEWAY_METHOD);

export function isGatewayMethod(value: UnparsedWireValue): value is GatewayMethod {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && GATEWAY_METHOD_LIST.includes(value as GatewayMethod);
}

/**
 * The methods that change something. Each must carry an idempotency key, so a
 * transport that retries finds the first answer rather than a second effect;
 * a read needs none, because reading twice is reading.
 */
export const MUTATING_GATEWAY_METHODS: ReadonlySet<GatewayMethod> = new Set<GatewayMethod>([
  GATEWAY_METHOD.CONVERSATION_CREATE,
  GATEWAY_METHOD.CONVERSATION_RESET,
  GATEWAY_METHOD.CONVERSATION_ARCHIVE,
  GATEWAY_METHOD.CONVERSATION_UNARCHIVE,
  GATEWAY_METHOD.CONVERSATION_DELETE,
  GATEWAY_METHOD.CONVERSATION_RESTORE,
  GATEWAY_METHOD.RUN_SUBMIT,
  GATEWAY_METHOD.RUN_STEER,
  GATEWAY_METHOD.RUN_CANCEL,
  GATEWAY_METHOD.CHILD_CANCEL,
  GATEWAY_METHOD.MEMORY_FORGET,
  GATEWAY_METHOD.CONFIGURATION_UPDATE,
  GATEWAY_METHOD.NODE_REGISTER,
  GATEWAY_METHOD.NODE_UNREGISTER,
  GATEWAY_METHOD.NODE_INVOKE,
  GATEWAY_METHOD.DELIVERY_CLAIM,
  GATEWAY_METHOD.DELIVERY_ACKNOWLEDGE,
  GATEWAY_METHOD.DELIVERY_GRANT_ON_CALL,
]);

export function isMutatingGatewayMethod(method: GatewayMethod): boolean {
  return MUTATING_GATEWAY_METHODS.has(method);
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
  HISTORY_CHANGED: "history.changed",
  DIRECTORY_CHANGED: "directory.changed",
  DELIVERY_OFFERED: "delivery.offered",
  DELIVERIES_WITHDRAWN: "deliveries.withdrawn",
  CHILD_CHANGED: "child.changed",
  CONFIGURATION_CHANGED: "configuration.changed",
  OBSERVATION_CHANGED: "observation.changed",
  NODE_CHANGED: "node.changed",
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
 * connected leaves the act undone and says so, so nothing records it as done.
 */
export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
} as const;

export type NodeCapabilityStatus =
  (typeof NODE_CAPABILITY_STATUS)[keyof typeof NODE_CAPABILITY_STATUS];

export type NodeCapabilityResult =
  | { status: typeof NODE_CAPABILITY_STATUS.OK; value: WireValue | undefined }
  | { status: typeof NODE_CAPABILITY_STATUS.UNAVAILABLE; capability: string; reason: string }
  | { status: typeof NODE_CAPABILITY_STATUS.FAILED; capability: string; reason: string };

/**
 * Where one delivery to the ear stands. Queued is owed and not yet offered to
 * any receiver; offered went to one receiver epoch and awaits its claim;
 * claimed was granted its words, once; the three terminal states say how it
 * ended. What the ledger guarantees is at most one grant to speak per
 * delivery, never that the grant was audible.
 */
export const DELIVERY_STATE = {
  QUEUED: "queued",
  OFFERED: "offered",
  CLAIMED: "claimed",
  ACKNOWLEDGED: "acknowledged",
  GRANTED_ON_CALL: "granted_on_call",
  WITHDRAWN: "withdrawn",
} as const;

export type DeliveryState = (typeof DELIVERY_STATE)[keyof typeof DELIVERY_STATE];

export const TERMINAL_DELIVERY_STATES: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  DELIVERY_STATE.ACKNOWLEDGED,
  DELIVERY_STATE.GRANTED_ON_CALL,
  DELIVERY_STATE.WITHDRAWN,
]);

export function isTerminalDeliveryState(state: DeliveryState): boolean {
  return TERMINAL_DELIVERY_STATES.has(state);
}

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

export function nodeCapabilityResultFromWire(
  value: UnparsedWireValue,
): NodeCapabilityResult | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === NODE_CAPABILITY_STATUS.OK) {
    return { status: NODE_CAPABILITY_STATUS.OK, value: value.value };
  }
  if (
    (value.status === NODE_CAPABILITY_STATUS.UNAVAILABLE ||
      value.status === NODE_CAPABILITY_STATUS.FAILED) &&
    isWireString(value.capability) &&
    isWireString(value.reason)
  ) {
    return { status: value.status, capability: value.capability, reason: value.reason };
  }
  return undefined;
}
