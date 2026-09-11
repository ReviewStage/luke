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
import type {
  AgentId,
  ArchiveReason,
  ChildCompletionRecord,
  ChildRunRecord,
  ConversationAppendOutcome,
  ConversationRecord,
  SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { type DeletionOptions, type DeletionOutcome, deleteConversation } from "./archives.js";
import {
  type EnvelopeRead,
  loadBrainEnvelopeEffect,
  saveBrainEnvelopeEffect,
} from "./brain-envelope.js";
import {
  deleteChildCompletionEffect,
  deleteChildRunEffect,
  listChildCompletionsEffect,
  listChildRunsEffect,
  putChildCompletionEffect,
  putChildRunEffect,
} from "./children-table.js";
import {
  appendConversationEffect,
  type ConversationSearchHit,
  conversationClearedAtEffect,
  listConversationEffect,
  searchConversationEffect,
} from "./conversation-table.js";
import {
  archiveConversationEffect,
  type ConversationCreation,
  createConversationEffect,
  listConversationsEffect,
  pinConversationEffect,
  unarchiveConversationEffect,
} from "./conversations-table.js";
import { AGENT_DATABASE_FILE, StoreDatabase } from "./database.js";
import type { BrainStateSave } from "./envelope.js";
import { type MaintenanceReport, runConversationMaintenance } from "./maintenance-run.js";
import { type FlushState, flushStateEffect, recordFlushEffect } from "./memory-flush-table.js";
import {
  applyMemorySyncEffect,
  type MemoryIndexStatus,
  memoryIndexStatusEffect,
  planMemorySyncEffect,
  readMemoryLines,
  rebuildMemoryIndexEffect,
  searchMemoryIndexEffect,
} from "./memory-index-table.js";
import {
  forgetNotebookEntryEffect,
  listNotebookEntriesEffect,
  migrateFactsIntoNotebookEffect,
  type NotebookEntry,
  type NotebookMutation,
  rememberNotebookEntryEffect,
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
    s.db.run(loadBrainEnvelopeEffect(p.sessionKey)),
  "brain.save": (s, p: { sessionKey: SessionKey; save: BrainStateSave }): boolean =>
    s.db.run(saveBrainEnvelopeEffect(p.sessionKey, p.save)),

  "conversation.append": (
    s,
    p: { sessionKey: SessionKey; entries: readonly ConversationEntry[]; now: number },
  ): ConversationAppendOutcome<ConversationEntry> =>
    s.db.run(appendConversationEffect(p.sessionKey, p.entries, p.now)),
  "conversation.list": (
    s,
    p: { sessionKey: SessionKey; now: number },
  ): readonly ConversationEntry[] => s.db.run(listConversationEffect(p.sessionKey, p.now)),
  "conversation.cutoff": (s, p: { sessionKey: SessionKey }): number | undefined =>
    s.db.run(conversationClearedAtEffect(p.sessionKey)),
  "conversation.search": (
    s,
    p: { sessionKeys: readonly SessionKey[]; query: string; limit: number; now: number },
  ): readonly ConversationSearchHit[] =>
    s.db.run(searchConversationEffect(p.sessionKeys, p.query, p.limit, p.now)),

  "notebook.list": (s, p: { now: number }): readonly NotebookEntry[] =>
    s.db.run(listNotebookEntriesEffect(s.workspace, p.now)),
  "notebook.remember": (
    s,
    p: { id: string; words: string; replaces?: string; now: number },
  ): NotebookMutation => s.db.run(rememberNotebookEntryEffect(s.workspace, p, p.now)),
  "notebook.forget": (s, p: { id: string; now: number }): NotebookMutation =>
    s.db.run(forgetNotebookEntryEffect(s.workspace, p.id, p.now)),

  "memory.plan-sync": (s, p: { identity?: EmbeddingModelIdentity; now: number }): MemoryScanPlan =>
    s.db.run(
      planMemorySyncEffect(
        s.workspace,
        p.identity,
        s.db.run(listNotebookEntriesEffect(s.workspace, p.now)),
      ),
    ),
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
    s.db.run(
      applyMemorySyncEffect(
        { changed: p.changed, removed: p.removed },
        p.embeddings,
        p.identity,
        p.now,
      ),
    ),
  "memory.search": (s, p: MemorySearchQuery): MemorySearchOutcome =>
    s.db.run(searchMemoryIndexEffect(p)),
  "memory.get": (
    s,
    p: { path: string; from?: number; lines?: number },
  ): MemoryReadResult | undefined => readMemoryLines(s.workspace, p.path, p.from, p.lines),
  "memory.rebuild": (s, _p: NoParams): boolean => s.db.run(rebuildMemoryIndexEffect),
  "memory.status": (s, _p: NoParams): MemoryIndexStatus => s.db.run(memoryIndexStatusEffect),
  "memory.flush-state.get": (
    s,
    p: { sessionKey: SessionKey; generationId: string },
  ): FlushState | undefined => s.db.run(flushStateEffect(p.sessionKey, p.generationId)),
  "memory.flush-state.put": (s, p: { sessionKey: SessionKey; state: FlushState }): boolean => {
    s.db.run(recordFlushEffect(p.sessionKey, p.state));
    return true;
  },

  "conversations.list": (s, _p: NoParams): readonly ConversationRecord[] =>
    s.db.run(listConversationsEffect),
  "conversations.create": (s, p: ConversationCreation): ConversationRecord =>
    s.db.run(createConversationEffect(p)),
  "conversations.archive": (
    s,
    p: { sessionKey: SessionKey; now: number; reason: ArchiveReason },
  ): boolean => s.db.run(archiveConversationEffect(p.sessionKey, p.now, p.reason)),
  "conversations.unarchive": (s, p: { sessionKey: SessionKey }): boolean =>
    s.db.run(unarchiveConversationEffect(p.sessionKey)),
  "conversations.pin": (s, p: { sessionKey: SessionKey; pinnedAt: number | undefined }): boolean =>
    s.db.run(pinConversationEffect(p.sessionKey, p.pinnedAt)),
  "conversations.delete": (
    s,
    p: { sessionKey: SessionKey; now: number } & DeletionOptions,
  ): DeletionOutcome | undefined => deleteConversation(s.db, s.agentRoot, p.sessionKey, p.now, p),

  "maintenance.run": (s, p: { now: number; preserve: readonly SessionKey[] }): MaintenanceReport =>
    runConversationMaintenance(s.db, s.agentRoot, p),

  "children.list": (s, _p: NoParams): readonly ChildRunRecord[] => s.db.run(listChildRunsEffect),
  "children.put": (s, p: { record: ChildRunRecord }): boolean =>
    s.db.run(putChildRunEffect(p.record)),
  "children.delete": (s, p: { childId: string }): boolean =>
    s.db.run(deleteChildRunEffect(p.childId)),
  "completions.list": (s, _p: NoParams): readonly ChildCompletionRecord[] =>
    s.db.run(listChildCompletionsEffect),
  "completions.put": (s, p: { completion: ChildCompletionRecord }): boolean =>
    s.db.run(putChildCompletionEffect(p.completion)),
  "completions.delete": (s, p: { completionId: string }): boolean =>
    s.db.run(deleteChildCompletionEffect(p.completionId)),
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
  db.run(
    createConversationEffect({
      agentId: options.agentId,
      sessionKey: options.sessionKey,
      name: options.conversationName,
      now: options.now,
    }),
  );
  // The stable facts an earlier build kept move into the notebook at the
  // first open that finds them, under their own ids, and never again.
  db.run(migrateFactsIntoNotebookEffect(workspace, options.now));
  return store;
}
