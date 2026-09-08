import type { RememberedFact } from "@sidecar/acts";
import type { ConversationEntry } from "@sidecar/realtime";
import type { AgentId, HistoryAppendOutcome, SessionKey } from "@sidecar/runtime-contracts";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { EnvelopeRead } from "./brain-envelope.js";
import type { BrainStateSave } from "./envelope.js";

/**
 * What crosses between the store's client on the main thread and the worker
 * that owns the database: one request at a time per id, each answered once.
 * Every value is structured-cloneable; nothing here is a function or a
 * handle, so the same protocol runs over a `MessagePort` in tests and a
 * `Worker` in the app.
 */

export const RUNTIME_STORE_METHOD = {
  OPEN: "open",
  BRAIN_LOAD: "brain.load",
  BRAIN_SAVE: "brain.save",
  HISTORY_APPEND: "history.append",
  HISTORY_LIST: "history.list",
  HISTORY_CLEAR: "history.clear",
  HISTORY_CUTOFF: "history.cutoff",
  FACTS_LIST: "facts.list",
  FACTS_REPLACE: "facts.replace",
  CLOSE: "close",
} as const;

export type RuntimeStoreMethod = (typeof RUNTIME_STORE_METHOD)[keyof typeof RUNTIME_STORE_METHOD];

export interface RuntimeStoreOpenOptions {
  /** The agent's own directory under Luke's application data; the database lives in it. */
  agentRoot: string;
  agentId: AgentId;
  sessionKey: SessionKey;
  conversationName: string;
  now: number;
}

export interface RuntimeStoreMethods {
  [RUNTIME_STORE_METHOD.OPEN]: { params: RuntimeStoreOpenOptions; result: boolean };
  [RUNTIME_STORE_METHOD.BRAIN_LOAD]: {
    params: { sessionKey: SessionKey };
    result: EnvelopeRead;
  };
  [RUNTIME_STORE_METHOD.BRAIN_SAVE]: {
    params: { sessionKey: SessionKey; save: BrainStateSave };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.HISTORY_APPEND]: {
    params: { sessionKey: SessionKey; entries: readonly ConversationEntry[]; now: number };
    result: HistoryAppendOutcome<ConversationEntry>;
  };
  [RUNTIME_STORE_METHOD.HISTORY_LIST]: {
    params: { sessionKey: SessionKey; now: number };
    result: readonly ConversationEntry[];
  };
  [RUNTIME_STORE_METHOD.HISTORY_CUTOFF]: {
    params: { sessionKey: SessionKey };
    result: number | undefined;
  };
  [RUNTIME_STORE_METHOD.HISTORY_CLEAR]: {
    params: { sessionKey: SessionKey; clearedAt: number };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.FACTS_LIST]: {
    params: Record<string, never>;
    result: readonly RememberedFact[];
  };
  [RUNTIME_STORE_METHOD.FACTS_REPLACE]: {
    params: { facts: readonly RememberedFact[] };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.CLOSE]: { params: Record<string, never>; result: boolean };
}

export interface RuntimeStoreRequest<Method extends RuntimeStoreMethod = RuntimeStoreMethod> {
  id: number;
  method: Method;
  params: RuntimeStoreMethods[Method]["params"];
}

export type RuntimeStoreResponse =
  | { id: number; ok: true; result: UnparsedWireValue }
  | { id: number; ok: false; error: string };

/** What travels on the channel in either direction: a structured-clone value, parsed on arrival. */
export type RuntimeStoreMessage = RuntimeStoreRequest | RuntimeStoreResponse;

/** The two ends of a message channel as both sides use them: a `Worker`, a `MessagePort`, or a test double. */
export interface RuntimeStorePort {
  postMessage(message: RuntimeStoreMessage): void;
  on(event: "message", listener: (message: UnparsedWireValue) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
}

/**
 * Reads a message off the channel. Both ends are Luke's own code on the
 * same machine, so what arrives is one of the two envelopes above; the read
 * establishes the envelope's shape and leaves the payload to the method's
 * own types, which the sender chose.
 */
export function runtimeStoreResponseFromWire(
  value: UnparsedWireValue,
): RuntimeStoreResponse | undefined {
  if (!isRecord(value) || !isWireNumber(value.id)) return undefined;
  if (value.ok === true) return { id: value.id, ok: true, result: value.result };
  if (value.ok === false && isWireString(value.error)) {
    return { id: value.id, ok: false, error: value.error };
  }
  return undefined;
}

export function runtimeStoreRequestFromWire(
  value: UnparsedWireValue,
): RuntimeStoreRequest | undefined {
  if (!isRecord(value) || !isWireNumber(value.id) || !isRuntimeStoreMethod(value.method)) {
    return undefined;
  }
  // SAFETY: the method name selects the params type; the sender is the same build's client, which typed them.
  return {
    id: value.id,
    method: value.method,
    params: value.params as RuntimeStoreRequest["params"],
  };
}

const RUNTIME_STORE_METHOD_LIST: readonly RuntimeStoreMethod[] =
  Object.values(RUNTIME_STORE_METHOD);

export function isRuntimeStoreMethod(value: UnparsedWireValue): value is RuntimeStoreMethod {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && RUNTIME_STORE_METHOD_LIST.includes(value as RuntimeStoreMethod);
}
