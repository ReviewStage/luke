import type { RememberedFact } from "@sidecar/acts";
import type { BrainStateLoad } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type { AgentId, HistoryAppendOutcome, SessionKey } from "@sidecar/runtime-contracts";
import type { BrainStateSave } from "./envelope.js";
import type { LegacyImportReport, LegacySources } from "./legacy-import.js";

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
  RECOVERY_ERASE: "recovery.erase",
  FACTS_LIST: "facts.list",
  FACTS_REPLACE: "facts.replace",
  CLOSE: "close",
} as const;

export type RuntimeStoreMethod = (typeof RUNTIME_STORE_METHOD)[keyof typeof RUNTIME_STORE_METHOD];

export interface RuntimeStoreOpenOptions {
  /** The agent's own directory under Luke's application data; the database and recovery copies live in it. */
  agentRoot: string;
  agentId: AgentId;
  sessionKey: SessionKey;
  conversationName: string;
  /** The files an earlier build kept, to import once and retire; absent when there are none to look for. */
  legacy?: LegacySources;
  now: number;
}

export interface RuntimeStoreMethods {
  [RUNTIME_STORE_METHOD.OPEN]: { params: RuntimeStoreOpenOptions; result: LegacyImportReport };
  [RUNTIME_STORE_METHOD.BRAIN_LOAD]: { params: { sessionKey: SessionKey }; result: BrainStateLoad };
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
  [RUNTIME_STORE_METHOD.HISTORY_CLEAR]: {
    params: { sessionKey: SessionKey; clearedAt: number };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.RECOVERY_ERASE]: { params: Record<string, never>; result: boolean };
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
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/** The two ends of a message channel as both sides use them: a `Worker`, a `MessagePort`, or a test double. */
export interface RuntimeStorePort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
}
