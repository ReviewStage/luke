import type { RememberedFact } from "@sidecar/acts";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type {
  AgentId,
  ArchiveReason,
  ConversationKind,
  ConversationRecord,
  HistoryAppendOutcome,
  HistoryArchiveRecord,
  SessionKey,
  StoredTranscriptEvent,
  TranscriptEvent,
} from "@sidecar/runtime-contracts";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { DeletionOutcome, RestoreResult } from "./archives.js";
import { EnvelopeTracker } from "./envelope.js";
import type { HistoryMaintenanceConfig } from "./maintenance.js";
import type { MaintenanceReport } from "./maintenance-run.js";
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

  clearHistoryAtOrBefore(sessionKey: SessionKey, clearedAt: number): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_CLEAR, { sessionKey, clearedAt });
  }

  personalFacts(): Promise<readonly RememberedFact[]> {
    return this.request(RUNTIME_STORE_METHOD.FACTS_LIST, {});
  }

  listConversations(): Promise<readonly ConversationRecord[]> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATIONS_LIST, {});
  }

  createConversation(creation: {
    agentId: AgentId;
    sessionKey: SessionKey;
    name: string;
    kind?: ConversationKind;
    now: number;
  }): Promise<ConversationRecord> {
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

  renameConversation(sessionKey: SessionKey, name: string): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_RENAME, { sessionKey, name });
  }

  pinConversation(sessionKey: SessionKey, pinnedAt: number | undefined): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_PIN, { sessionKey, pinnedAt });
  }

  /** The recoverable deletion: the rows go behind a committed archive, and the answer says whether its file is published. */
  deleteConversationHistory(
    sessionKey: SessionKey,
    now: number,
    archiveId: string,
    removeConversation = false,
  ): Promise<DeletionOutcome | undefined> {
    return this.request(RUNTIME_STORE_METHOD.CONVERSATION_DELETE, {
      sessionKey,
      now,
      archiveId,
      removeConversation,
    });
  }

  listTranscript(
    sessionKey: SessionKey,
    options: { afterSequence?: number; limit?: number } = {},
  ): Promise<readonly StoredTranscriptEvent[]> {
    return this.request(RUNTIME_STORE_METHOD.TRANSCRIPT_LIST, { sessionKey, ...options });
  }

  searchTranscript(
    sessionKey: SessionKey,
    query: string,
    limit?: number,
  ): Promise<readonly StoredTranscriptEvent[]> {
    return this.request(RUNTIME_STORE_METHOD.TRANSCRIPT_SEARCH, {
      sessionKey,
      query,
      ...(limit !== undefined ? { limit } : undefined),
    });
  }

  listCompactionBoundaries(sessionKey: SessionKey) {
    return this.request(RUNTIME_STORE_METHOD.COMPACTIONS_LIST, { sessionKey });
  }

  listArchives(): Promise<readonly HistoryArchiveRecord[]> {
    return this.request(RUNTIME_STORE_METHOD.ARCHIVES_LIST, {});
  }

  restoreArchive(archiveId: string, agentId: AgentId, now: number): Promise<RestoreResult> {
    return this.request(RUNTIME_STORE_METHOD.ARCHIVE_RESTORE, { archiveId, agentId, now });
  }

  /** Retries every archive publication a crash interrupted; answers the ids still unpublished. */
  publishPendingArchives(): Promise<readonly string[]> {
    return this.request(RUNTIME_STORE_METHOD.ARCHIVES_PUBLISH_PENDING, {});
  }

  runMaintenance(options: {
    now: number;
    preserve: readonly SessionKey[];
    config?: Partial<HistoryMaintenanceConfig>;
    force?: boolean;
  }): Promise<MaintenanceReport> {
    return this.request(RUNTIME_STORE_METHOD.MAINTENANCE_RUN, options);
  }

  replacePersonalFacts(facts: readonly RememberedFact[]): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.FACTS_REPLACE, { facts });
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
