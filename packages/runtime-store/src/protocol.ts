import type {
  CandidateSeed,
  CandidateStatus,
  ConsolidationPhase,
  EmbeddingModelIdentity,
  IndexedFileWrite,
  MemoryCandidate,
  MemoryReadResult,
} from "@sidecar/memory";
import type { ConversationEntry } from "@sidecar/realtime";
import type { ScheduledJob } from "@sidecar/runtime";
import type {
  AgentId,
  ArchiveReason,
  ChildCompletionRecord,
  ChildRunRecord,
  ConversationRecord,
  HistoryAppendOutcome,
  SessionKey,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { DeletionOptions, DeletionOutcome } from "./archives.js";
import type { EnvelopeRead } from "./brain-envelope.js";
import type { ConversationCreation } from "./conversations-table.js";
import type { BrainStateSave } from "./envelope.js";
import type { HistorySearchHit } from "./history-table.js";
import type { MaintenanceReport } from "./maintenance-run.js";
import type {
  EmbeddingWrite,
  MemoryApplyReport,
  MemoryIndexStatus,
  MemoryScanPlan,
  MemorySearchOutcome,
  MemorySearchQuery,
} from "./memory-index-table.js";
import type {
  CandidateStagingReport,
  FlushState,
  ForgottenSource,
  ForgottenSourceKind,
  MemoryForgetAsk,
  MemoryForgetReport,
  MemoryRewriteAsk,
  MemoryRewriteOutcome,
  MemoryRewriteRecord,
} from "./memory-maintenance-table.js";
import type { NotebookEntry, NotebookMutation } from "./notebook-table.js";

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
  HISTORY_CUTOFF: "history.cutoff",
  HISTORY_SEARCH: "history.search",
  NOTEBOOK_LIST: "notebook.list",
  NOTEBOOK_REMEMBER: "notebook.remember",
  NOTEBOOK_FORGET: "notebook.forget",
  MEMORY_PLAN_SYNC: "memory.plan-sync",
  MEMORY_APPLY_SYNC: "memory.apply-sync",
  MEMORY_SEARCH: "memory.search",
  MEMORY_GET: "memory.get",
  MEMORY_REBUILD: "memory.rebuild",
  MEMORY_STATUS: "memory.status",
  MEMORY_CANDIDATES_STAGE: "memory.candidates.stage",
  MEMORY_CANDIDATES_LIST: "memory.candidates.list",
  MEMORY_CANDIDATES_STATUS: "memory.candidates.status",
  MEMORY_CANDIDATES_RECONCILE: "memory.candidates.reconcile",
  MEMORY_PHASE_HITS: "memory.phase-hits",
  MEMORY_INGESTION_CURSOR: "memory.ingestion.cursor",
  MEMORY_INGESTION_SEEN: "memory.ingestion.seen",
  MEMORY_INGESTION_ADVANCE: "memory.ingestion.advance",
  MEMORY_TOMBSTONES_LIST: "memory.tombstones.list",
  MEMORY_TOMBSTONE: "memory.tombstone",
  MEMORY_DURABLE_READ: "memory.durable.read",
  MEMORY_REWRITE_PUBLISH: "memory.rewrite.publish",
  MEMORY_REWRITES_LIST: "memory.rewrites.list",
  MEMORY_FLUSH_STATE_GET: "memory.flush-state.get",
  MEMORY_FLUSH_STATE_PUT: "memory.flush-state.put",
  MEMORY_FORGET: "memory.forget",
  CONVERSATIONS_LIST: "conversations.list",
  CONVERSATION_CREATE: "conversations.create",
  CONVERSATION_ARCHIVE: "conversations.archive",
  CONVERSATION_UNARCHIVE: "conversations.unarchive",
  CONVERSATION_PIN: "conversations.pin",
  CONVERSATION_DELETE: "conversations.delete",
  MAINTENANCE_RUN: "maintenance.run",
  JOBS_LIST: "jobs.list",
  JOB_PUT: "jobs.put",
  JOB_DELETE: "jobs.delete",
  CHILDREN_LIST: "children.list",
  CHILD_PUT: "children.put",
  CHILD_DELETE: "children.delete",
  COMPLETIONS_LIST: "completions.list",
  COMPLETION_PUT: "completions.put",
  COMPLETION_DELETE: "completions.delete",
  CLOSE: "close",
} as const;

export type RuntimeStoreMethod = (typeof RUNTIME_STORE_METHOD)[keyof typeof RUNTIME_STORE_METHOD];

export interface RuntimeStoreOpenOptions {
  /** The agent's own directory under Luke's application data; the database lives in it. */
  agentRoot: string;
  /** The agent's identity workspace, the notebook's root; `<agentRoot>/workspace` by default. */
  workspaceDirectory?: string;
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
  [RUNTIME_STORE_METHOD.HISTORY_SEARCH]: {
    params: { sessionKeys: readonly SessionKey[]; query: string; limit: number; now: number };
    result: readonly HistorySearchHit[];
  };
  [RUNTIME_STORE_METHOD.NOTEBOOK_LIST]: {
    params: { now: number };
    result: readonly NotebookEntry[];
  };
  [RUNTIME_STORE_METHOD.NOTEBOOK_REMEMBER]: {
    params: { id: string; words: string; replaces?: string; now: number };
    result: NotebookMutation;
  };
  [RUNTIME_STORE_METHOD.NOTEBOOK_FORGET]: {
    params: { id: string; now: number };
    result: NotebookMutation;
  };
  [RUNTIME_STORE_METHOD.MEMORY_PLAN_SYNC]: {
    params: { identity?: EmbeddingModelIdentity; now: number };
    result: MemoryScanPlan;
  };
  [RUNTIME_STORE_METHOD.MEMORY_APPLY_SYNC]: {
    params: {
      changed: readonly IndexedFileWrite[];
      removed: readonly string[];
      embeddings: readonly EmbeddingWrite[];
      identity?: EmbeddingModelIdentity;
      now: number;
    };
    result: MemoryApplyReport;
  };
  [RUNTIME_STORE_METHOD.MEMORY_SEARCH]: {
    params: MemorySearchQuery;
    result: MemorySearchOutcome;
  };
  [RUNTIME_STORE_METHOD.MEMORY_GET]: {
    params: { path: string; from?: number; lines?: number };
    result: MemoryReadResult | undefined;
  };
  [RUNTIME_STORE_METHOD.MEMORY_REBUILD]: { params: Record<string, never>; result: boolean };
  [RUNTIME_STORE_METHOD.MEMORY_STATUS]: {
    params: Record<string, never>;
    result: MemoryIndexStatus;
  };
  [RUNTIME_STORE_METHOD.MEMORY_CANDIDATES_STAGE]: {
    params: { seeds: readonly CandidateSeed[]; now: number };
    result: CandidateStagingReport;
  };
  [RUNTIME_STORE_METHOD.MEMORY_CANDIDATES_LIST]: {
    params: { status?: CandidateStatus };
    result: readonly MemoryCandidate[];
  };
  [RUNTIME_STORE_METHOD.MEMORY_CANDIDATES_STATUS]: {
    params: { keys: readonly string[]; status: CandidateStatus; now: number };
    result: number;
  };
  [RUNTIME_STORE_METHOD.MEMORY_CANDIDATES_RECONCILE]: {
    params: { now: number };
    result: number;
  };
  [RUNTIME_STORE_METHOD.MEMORY_PHASE_HITS]: {
    params: { phase: ConsolidationPhase; keys: readonly string[]; now: number };
    result: number;
  };
  [RUNTIME_STORE_METHOD.MEMORY_INGESTION_CURSOR]: {
    params: { sessionKey: SessionKey };
    result: number;
  };
  [RUNTIME_STORE_METHOD.MEMORY_INGESTION_SEEN]: {
    params: { sessionKey: SessionKey; hashes: readonly string[] };
    result: readonly string[];
  };
  [RUNTIME_STORE_METHOD.MEMORY_INGESTION_ADVANCE]: {
    params: {
      sessionKey: SessionKey;
      lastRecordedAt: number;
      hashes: readonly string[];
      now: number;
    };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.MEMORY_TOMBSTONES_LIST]: {
    params: Record<string, never>;
    result: readonly ForgottenSource[];
  };
  [RUNTIME_STORE_METHOD.MEMORY_TOMBSTONE]: {
    params: {
      sources: readonly { kind: ForgottenSourceKind; id: string; reason: string }[];
      now: number;
    };
    result: number;
  };
  [RUNTIME_STORE_METHOD.MEMORY_DURABLE_READ]: {
    params: { name: string };
    result: { content: string; hash: string } | undefined;
  };
  [RUNTIME_STORE_METHOD.MEMORY_REWRITE_PUBLISH]: {
    params: { ask: MemoryRewriteAsk; now: number };
    result: MemoryRewriteOutcome;
  };
  [RUNTIME_STORE_METHOD.MEMORY_REWRITES_LIST]: {
    params: Record<string, never>;
    result: readonly MemoryRewriteRecord[];
  };
  [RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_GET]: {
    params: { sessionKey: SessionKey; generationId: string };
    result: FlushState | undefined;
  };
  [RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_PUT]: {
    params: { sessionKey: SessionKey; state: FlushState };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.MEMORY_FORGET]: {
    params: { ask: MemoryForgetAsk; now: number };
    result: MemoryForgetReport;
  };
  [RUNTIME_STORE_METHOD.CONVERSATIONS_LIST]: {
    params: Record<string, never>;
    result: readonly ConversationRecord[];
  };
  [RUNTIME_STORE_METHOD.CONVERSATION_CREATE]: {
    params: ConversationCreation;
    result: ConversationRecord;
  };
  [RUNTIME_STORE_METHOD.CONVERSATION_ARCHIVE]: {
    params: { sessionKey: SessionKey; now: number; reason: ArchiveReason };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.CONVERSATION_UNARCHIVE]: {
    params: { sessionKey: SessionKey };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.CONVERSATION_PIN]: {
    params: { sessionKey: SessionKey; pinnedAt: number | undefined };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.CONVERSATION_DELETE]: {
    params: { sessionKey: SessionKey; now: number } & DeletionOptions;
    result: DeletionOutcome | undefined;
  };
  [RUNTIME_STORE_METHOD.MAINTENANCE_RUN]: {
    params: { now: number; preserve: readonly SessionKey[] };
    result: MaintenanceReport;
  };
  [RUNTIME_STORE_METHOD.JOBS_LIST]: {
    params: Record<string, never>;
    result: readonly ScheduledJob[];
  };
  [RUNTIME_STORE_METHOD.JOB_PUT]: { params: { job: ScheduledJob }; result: boolean };
  [RUNTIME_STORE_METHOD.JOB_DELETE]: { params: { id: string }; result: boolean };
  [RUNTIME_STORE_METHOD.CHILDREN_LIST]: {
    params: Record<string, never>;
    result: readonly ChildRunRecord[];
  };
  [RUNTIME_STORE_METHOD.CHILD_PUT]: { params: { record: ChildRunRecord }; result: boolean };
  [RUNTIME_STORE_METHOD.CHILD_DELETE]: { params: { childId: string }; result: boolean };
  [RUNTIME_STORE_METHOD.COMPLETIONS_LIST]: {
    params: Record<string, never>;
    result: readonly ChildCompletionRecord[];
  };
  [RUNTIME_STORE_METHOD.COMPLETION_PUT]: {
    params: { completion: ChildCompletionRecord };
    result: boolean;
  };
  [RUNTIME_STORE_METHOD.COMPLETION_DELETE]: {
    params: { completionId: string };
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
