import path from "node:path";
import type {
  EmbeddingModelIdentity,
  EmbeddingWrite,
  IndexedFileWrite,
  MemoryApplyReport,
  MemoryReadResult,
  MemoryScanPlan,
  MemorySearchOutcome,
  MemorySearchQuery,
} from "@sidecar/memory";
import type { ScheduledJob } from "@sidecar/runtime";
import type {
  AgentId,
  ArchiveReason,
  ChildCompletionRecord,
  ChildRunRecord,
  ConversationRecord,
  HistoryAppendOutcome,
  SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import {
  type DeletionOptions,
  type DeletionOutcome,
  deleteConversationHistory,
} from "./archives.js";
import { type EnvelopeRead, loadBrainEnvelope, saveBrainEnvelope } from "./brain-envelope.js";
import {
  deleteChildCompletion,
  deleteChildRun,
  listChildCompletions,
  listChildRuns,
  putChildCompletion,
  putChildRun,
} from "./children-table.js";
import {
  archiveConversation,
  type ConversationCreation,
  createConversation,
  listConversations,
  pinConversation,
  unarchiveConversation,
} from "./conversations-table.js";
import { AGENT_DATABASE_FILE, StoreDatabase } from "./database.js";
import type { BrainStateSave } from "./envelope.js";
import {
  appendHistory,
  type HistorySearchHit,
  historyClearedAt,
  listHistory,
  searchHistory,
} from "./history-table.js";
import { deleteScheduledJob, listScheduledJobs, putScheduledJob } from "./jobs-table.js";
import { type MaintenanceReport, runHistoryMaintenance } from "./maintenance-run.js";
import { type FlushState, flushState, recordFlush } from "./memory-flush-table.js";
import {
  applyMemorySync,
  type MemoryIndexStatus,
  memoryIndexStatus,
  planMemorySync,
  readMemoryLines,
  rebuildMemoryIndex,
  searchMemoryIndex,
} from "./memory-index-table.js";
import {
  forgetNotebookEntry,
  listNotebookEntries,
  migrateFactsIntoNotebook,
  type NotebookEntry,
  type NotebookMutation,
  rememberNotebookEntry,
} from "./notebook-table.js";

/**
 * Every operation the store answers, as one function each. The name a caller
 * sends is the key here; the parameters and the answer are the function's own
 * types, so an operation is declared once and the client's methods, the
 * worker's dispatch, and the wire's vocabulary check all derive from this
 * table. Every parameter and every answer is structured-cloneable — nothing
 * here is a function or a handle — so the same table runs over a
 * `MessagePort` in a test and a `Worker` in the app.
 *
 * The keys are written as raw strings rather than gathered into an `as const`
 * constants object, which is the one place this file departs from the
 * repository's rule for fixed value sets. They are that set's declaration:
 * the name and what it does are one entry, `StoreOperationName` derives from
 * them by `keyof`, and a caller's typo is a compile error. A constants object
 * beside them would be the second list the rule exists to prevent.
 */

/** An open store as an operation sees it: the database, and the two directories it owns. */
export interface OpenStore {
  readonly db: StoreDatabase;
  /** The agent's own directory under Luke's application data: the database file and the archives live in it. */
  readonly agentRoot: string;
  /** The agent's identity workspace, the notebook's root. */
  readonly workspace: string;
}

/** An operation that takes nothing beyond the open store. */
export type NoParams = Record<string, never>;

/**
 * The floor an operation's answer stands on: enough to keep `void` and
 * `null` out of the table, and no more. It is deliberately not a proof of
 * structured-cloneability — `object` admits a function and a live database
 * handle both — so what keeps every answer cloneable is each entry's own
 * narrower return type, which is the thing to read when adding one.
 */
export type StoreAnswer = boolean | number | undefined | object;

type StoreOperation = (store: OpenStore, params: never) => StoreAnswer;

export const STORE_OPERATIONS = {
  "brain.load": (s, p: { sessionKey: SessionKey }): EnvelopeRead =>
    loadBrainEnvelope(s.db, p.sessionKey),
  "brain.save": (s, p: { sessionKey: SessionKey; save: BrainStateSave }): boolean =>
    saveBrainEnvelope(s.db, p.sessionKey, p.save),

  "history.append": (
    s,
    p: { sessionKey: SessionKey; entries: readonly ConversationEntry[]; now: number },
  ): HistoryAppendOutcome<ConversationEntry> => appendHistory(s.db, p.sessionKey, p.entries, p.now),
  "history.list": (s, p: { sessionKey: SessionKey; now: number }): readonly ConversationEntry[] =>
    listHistory(s.db, p.sessionKey, p.now),
  "history.cutoff": (s, p: { sessionKey: SessionKey }): number | undefined =>
    historyClearedAt(s.db, p.sessionKey),
  "history.search": (
    s,
    p: { sessionKeys: readonly SessionKey[]; query: string; limit: number; now: number },
  ): readonly HistorySearchHit[] => searchHistory(s.db, p.sessionKeys, p.query, p.limit, p.now),

  "notebook.list": (s, p: { now: number }): readonly NotebookEntry[] =>
    listNotebookEntries(s.db, s.workspace, p.now),
  "notebook.remember": (
    s,
    p: { id: string; words: string; replaces?: string; now: number },
  ): NotebookMutation => rememberNotebookEntry(s.db, s.workspace, p, p.now),
  "notebook.forget": (s, p: { id: string; now: number }): NotebookMutation =>
    forgetNotebookEntry(s.db, s.workspace, p.id, p.now),

  "memory.plan-sync": (s, p: { identity?: EmbeddingModelIdentity; now: number }): MemoryScanPlan =>
    planMemorySync(s.db, s.workspace, p.identity, listNotebookEntries(s.db, s.workspace, p.now)),
  "memory.apply-sync": (
    s,
    p: {
      changed: readonly IndexedFileWrite[];
      removed: readonly string[];
      embeddings: readonly EmbeddingWrite[];
      identity?: EmbeddingModelIdentity;
      now: number;
    },
  ): MemoryApplyReport =>
    applyMemorySync(
      s.db,
      { changed: p.changed, removed: p.removed },
      p.embeddings,
      p.identity,
      p.now,
    ),
  "memory.search": (s, p: MemorySearchQuery): MemorySearchOutcome => searchMemoryIndex(s.db, p),
  "memory.get": (
    s,
    p: { path: string; from?: number; lines?: number },
  ): MemoryReadResult | undefined => readMemoryLines(s.workspace, p.path, p.from, p.lines),
  "memory.rebuild": (s, _p: NoParams): boolean => rebuildMemoryIndex(s.db),
  "memory.status": (s, _p: NoParams): MemoryIndexStatus => memoryIndexStatus(s.db),
  "memory.flush-state.get": (
    s,
    p: { sessionKey: SessionKey; generationId: string },
  ): FlushState | undefined => flushState(s.db, p.sessionKey, p.generationId),
  "memory.flush-state.put": (s, p: { sessionKey: SessionKey; state: FlushState }): boolean => {
    recordFlush(s.db, p.sessionKey, p.state);
    return true;
  },

  "conversations.list": (s, _p: NoParams): readonly ConversationRecord[] => listConversations(s.db),
  "conversations.create": (s, p: ConversationCreation): ConversationRecord =>
    createConversation(s.db, p),
  "conversations.archive": (
    s,
    p: { sessionKey: SessionKey; now: number; reason: ArchiveReason },
  ): boolean => archiveConversation(s.db, p.sessionKey, p.now, p.reason),
  "conversations.unarchive": (s, p: { sessionKey: SessionKey }): boolean =>
    unarchiveConversation(s.db, p.sessionKey),
  "conversations.pin": (s, p: { sessionKey: SessionKey; pinnedAt: number | undefined }): boolean =>
    pinConversation(s.db, p.sessionKey, p.pinnedAt),
  "conversations.delete": (
    s,
    p: { sessionKey: SessionKey; now: number } & DeletionOptions,
  ): DeletionOutcome | undefined =>
    deleteConversationHistory(s.db, s.agentRoot, p.sessionKey, p.now, p),

  "maintenance.run": (s, p: { now: number; preserve: readonly SessionKey[] }): MaintenanceReport =>
    runHistoryMaintenance(s.db, s.agentRoot, p),

  "jobs.list": (s, _p: NoParams): readonly ScheduledJob[] => listScheduledJobs(s.db),
  "jobs.put": (s, p: { job: ScheduledJob }): boolean => putScheduledJob(s.db, p.job),
  "jobs.delete": (s, p: { id: string }): boolean => deleteScheduledJob(s.db, p.id),

  "children.list": (s, _p: NoParams): readonly ChildRunRecord[] => listChildRuns(s.db),
  "children.put": (s, p: { record: ChildRunRecord }): boolean => putChildRun(s.db, p.record),
  "children.delete": (s, p: { childId: string }): boolean => deleteChildRun(s.db, p.childId),
  "completions.list": (s, _p: NoParams): readonly ChildCompletionRecord[] =>
    listChildCompletions(s.db),
  "completions.put": (s, p: { completion: ChildCompletionRecord }): boolean =>
    putChildCompletion(s.db, p.completion),
  "completions.delete": (s, p: { completionId: string }): boolean =>
    deleteChildCompletion(s.db, p.completionId),
} as const satisfies Record<string, StoreOperation>;

export type StoreOperationName = keyof typeof STORE_OPERATIONS;

/** One operation's parameters and answer, read off the table by name. */
export type OperationParams<Name extends StoreOperationName> = Parameters<
  (typeof STORE_OPERATIONS)[Name]
>[1];
export type OperationResult<Name extends StoreOperationName> = ReturnType<
  (typeof STORE_OPERATIONS)[Name]
>;

/** The parameters of some operation: what a request carries before its name selects one. */
export type AnyOperationParams = OperationParams<StoreOperationName>;

export function isStoreOperationName(value: UnparsedWireValue): value is StoreOperationName {
  return isWireString(value) && Object.hasOwn(STORE_OPERATIONS, value);
}

/**
 * The two messages that are not operations: they create and destroy the
 * `OpenStore` every operation's first parameter is, so the worker owns them
 * and the table holds neither.
 */
export const STORE_LIFECYCLE = { OPEN: "open", CLOSE: "close" } as const;

export interface StoreOpenOptions {
  /** The agent's own directory under Luke's application data; the database lives in it. */
  agentRoot: string;
  /** The agent's identity workspace, the notebook's root; `<agentRoot>/workspace` by default. */
  workspaceDirectory?: string;
  agentId: AgentId;
  sessionKey: SessionKey;
  conversationName: string;
  now: number;
}

const WORKSPACE_DIRECTORY = "workspace";

/** Opens the database under the agent root given, creating the conversation the open names. */
export function openStore(options: StoreOpenOptions): OpenStore {
  const workspace = options.workspaceDirectory ?? path.join(options.agentRoot, WORKSPACE_DIRECTORY);
  const db = StoreDatabase.open(path.join(options.agentRoot, AGENT_DATABASE_FILE));
  const store: OpenStore = { db, agentRoot: options.agentRoot, workspace };
  createConversation(db, {
    agentId: options.agentId,
    sessionKey: options.sessionKey,
    name: options.conversationName,
    now: options.now,
  });
  // The stable facts an earlier build kept move into the notebook at the
  // first open that finds them, under their own ids, and never again.
  migrateFactsIntoNotebook(db, workspace, options.now);
  return store;
}
