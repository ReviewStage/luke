import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "@sidecar/brain";
import type { EmbeddingModelIdentity, MemoryReadResult } from "@sidecar/memory";
import type { ConversationEntry } from "@sidecar/realtime";
import type { ChildStore, ScheduledJob, ScheduledJobStore } from "@sidecar/runtime";
import type {
  ArchiveReason,
  ConversationRecord,
  HistoryAppendOutcome,
  SessionKey,
  TranscriptEvent,
} from "@sidecar/runtime-contracts";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { DeletionOptions, DeletionOutcome } from "./archives.js";
import type { ConversationCreation } from "./conversations-table.js";
import { EnvelopeTracker } from "./envelope.js";
import type { HistorySearchHit } from "./history-table.js";
import type { MaintenanceReport } from "./maintenance-run.js";
import type { FlushState } from "./memory-flush-table.js";
import type {
  MemoryApplyReport,
  MemoryIndexStatus,
  MemoryScanPlan,
  MemorySearchOutcome,
  MemorySearchQuery,
} from "./memory-index-table.js";
import type { NotebookEntry, NotebookMutation } from "./notebook-table.js";
import {
  RUNTIME_STORE_METHOD,
  type RuntimeStoreMethod,
  type RuntimeStoreMethods,
  type RuntimeStoreOpenOptions,
  type RuntimeStorePort,
  type RuntimeStoreRequest,
  type RuntimeStoreResponse,
  runtimeStoreResponseFromWire,
} from "./protocol.js";

/**
 * The main thread's handle on the store: every operation is a message to the
 * worker and a promise of its answer. A worker that errors or exits settles
 * every request still out as rejected and refuses every later one, so a
 * caller never waits on a thread that is gone; what a rejected write means
 * for the act it guarded is the caller's decision, as it always was.
 */
export class RuntimeStoreClient {
  readonly #port: RuntimeStorePort;
  readonly #pending = new Map<
    number,
    { resolve: (value: UnparsedWireValue) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;
  #failure: Error | undefined;

  constructor(port: RuntimeStorePort) {
    this.#port = port;
    port.on("message", (message) => {
      const response = runtimeStoreResponseFromWire(message);
      if (response) this.#answered(response);
    });
    port.on("error", (error) => this.#fail(error));
    port.on("exit", (code) =>
      this.#fail(new Error(`runtime store worker exited with code ${code}`)),
    );
  }

  request<Method extends RuntimeStoreMethod>(
    method: Method,
    params: RuntimeStoreMethods[Method]["params"],
  ): Promise<RuntimeStoreMethods[Method]["result"]> {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId++;
    const message: RuntimeStoreRequest<Method> = { id, method, params };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        // SAFETY: the worker answers a request with the result type its method declares; the id pairs them.
        resolve: (value) => resolve(value as RuntimeStoreMethods[Method]["result"]),
        reject,
      });
      try {
        this.#port.postMessage(message);
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  open(options: RuntimeStoreOpenOptions): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.OPEN, options);
  }

  /**
   * The brain's envelope as a repository. Each save is a compare-and-set
   * against the generation this handle last observed standing in the
   * database — loaded, readable or not, or saved — and carries only what
   * changed since the last envelope it saw land, or the whole envelope when
   * the generation itself changes. The worker applies it only while exactly
   * that generation stands, so after every save that answered true the
   * tables hold exactly the envelope given; a generation whose rows could not
   * be read is still observed by its id, so the store's repair of it lands;
   * and a save from a handle whose picture is stale answers false and changes
   * nothing: there is no fallback that would let an old generation overwrite
   * a newer one. A refused save leaves this handle's picture as it was, so
   * its next save is refused the same way until it loads again.
   */
  brainStateRepository(sessionKey: SessionKey): BrainStateRepository {
    const tracker = new EnvelopeTracker();
    return {
      load: async (): Promise<BrainStateLoad> => {
        const loaded = await this.request(RUNTIME_STORE_METHOD.BRAIN_LOAD, { sessionKey });
        tracker.observe(loaded);
        return loaded.state ? { state: loaded.state } : { unreadable: loaded.unreadable === true };
      },
      save: async (
        state: BrainPersistedState,
        transcript?: readonly TranscriptEvent[],
      ): Promise<boolean> => {
        const save = tracker.saveFor(state, transcript);
        const landed = await this.request(RUNTIME_STORE_METHOD.BRAIN_SAVE, { sessionKey, save });
        if (landed) tracker.landed(state);
        return landed;
      },
    };
  }

  appendHistory(
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    now: number,
  ): Promise<HistoryAppendOutcome<ConversationEntry>> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_APPEND, { sessionKey, entries, now });
  }

  listHistory(sessionKey: SessionKey, now: number): Promise<readonly ConversationEntry[]> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_LIST, { sessionKey, now });
  }

  /** The Clear cutoff the store holds for the conversation, durable past the generation that carried it. */
  historyClearedAt(sessionKey: SessionKey): Promise<number | undefined> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_CUTOFF, { sessionKey });
  }

  /** The retained lines of the conversations named that carry the words, most recent first. */
  searchHistory(
    sessionKeys: readonly SessionKey[],
    query: string,
    limit: number,
    now: number,
  ): Promise<readonly HistorySearchHit[]> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_SEARCH, { sessionKeys, query, limit, now });
  }

  /** The notebook's entries as they stand, the file reconciled first. */
  listNotebookEntries(now: number): Promise<readonly NotebookEntry[]> {
    return this.request(RUNTIME_STORE_METHOD.NOTEBOOK_LIST, { now });
  }

  rememberNotebookEntry(ask: {
    id: string;
    words: string;
    replaces?: string;
    now: number;
  }): Promise<NotebookMutation> {
    return this.request(RUNTIME_STORE_METHOD.NOTEBOOK_REMEMBER, ask);
  }

  forgetNotebookEntry(id: string, now: number): Promise<NotebookMutation> {
    return this.request(RUNTIME_STORE_METHOD.NOTEBOOK_FORGET, { id, now });
  }

  planMemorySync(
    identity: EmbeddingModelIdentity | undefined,
    now: number,
  ): Promise<MemoryScanPlan> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_PLAN_SYNC, {
      ...(identity ? { identity } : undefined),
      now,
    });
  }

  applyMemorySync(
    params: RuntimeStoreMethods[typeof RUNTIME_STORE_METHOD.MEMORY_APPLY_SYNC]["params"],
  ): Promise<MemoryApplyReport> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_APPLY_SYNC, params);
  }

  searchMemory(query: MemorySearchQuery): Promise<MemorySearchOutcome> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_SEARCH, query);
  }

  readMemory(path: string, from?: number, lines?: number): Promise<MemoryReadResult | undefined> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_GET, {
      path,
      ...(from !== undefined ? { from } : undefined),
      ...(lines !== undefined ? { lines } : undefined),
    });
  }

  rebuildMemoryIndex(): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_REBUILD, {});
  }

  memoryIndexStatus(): Promise<MemoryIndexStatus> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_STATUS, {});
  }

  memoryFlushState(sessionKey: SessionKey, generationId: string): Promise<FlushState | undefined> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_GET, { sessionKey, generationId });
  }

  recordMemoryFlush(sessionKey: SessionKey, state: FlushState): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.MEMORY_FLUSH_STATE_PUT, { sessionKey, state });
  }

  listConversations(): Promise<readonly ConversationRecord[]> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATIONS_LIST, {});
  }

  createConversation(creation: ConversationCreation): Promise<ConversationRecord> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_CREATE, creation);
  }

  archiveConversation(
    sessionKey: SessionKey,
    now: number,
    reason: ArchiveReason,
  ): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_ARCHIVE, { sessionKey, now, reason });
  }

  unarchiveConversation(sessionKey: SessionKey): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_UNARCHIVE, { sessionKey });
  }

  pinConversation(sessionKey: SessionKey, pinnedAt: number | undefined): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_PIN, { sessionKey, pinnedAt });
  }

  /** The recoverable deletion: the rows go behind a committed archive, and the answer says whether its file is published. */
  deleteConversationHistory(
    sessionKey: SessionKey,
    now: number,
    options: DeletionOptions = {},
  ): Promise<DeletionOutcome | undefined> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_DELETE, { sessionKey, now, ...options });
  }

  /** One maintenance pass under the pinned defaults, keeping the conversations named whatever their age. */
  runMaintenance(options: {
    now: number;
    preserve: readonly SessionKey[];
  }): Promise<MaintenanceReport> {
    return this.request(RUNTIME_STORE_METHOD.MAINTENANCE_RUN, options);
  }

  /** The scheduler's jobs as a store: listed, written whole, and deleted through the worker. */
  scheduledJobStore(): ScheduledJobStore {
    return {
      list: () => this.request(RUNTIME_STORE_METHOD.JOBS_LIST, {}),
      put: (job: ScheduledJob) => this.request(RUNTIME_STORE_METHOD.JOB_PUT, { job }),
      delete: (id: string) => this.request(RUNTIME_STORE_METHOD.JOB_DELETE, { id }),
    };
  }

  /** The child service's records and completions as a store, each written whole through the worker. */
  childStore(): ChildStore {
    return {
      listChildren: () => this.request(RUNTIME_STORE_METHOD.CHILDREN_LIST, {}),
      putChild: (record) => this.request(RUNTIME_STORE_METHOD.CHILD_PUT, { record }),
      deleteChild: (childId) => this.request(RUNTIME_STORE_METHOD.CHILD_DELETE, { childId }),
      listCompletions: () => this.request(RUNTIME_STORE_METHOD.COMPLETIONS_LIST, {}),
      putCompletion: (completion) =>
        this.request(RUNTIME_STORE_METHOD.COMPLETION_PUT, { completion }),
      deleteCompletion: (completionId) =>
        this.request(RUNTIME_STORE_METHOD.COMPLETION_DELETE, { completionId }),
    };
  }

  close(): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CLOSE, {});
  }

  #answered(response: RuntimeStoreResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error));
  }

  #fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
