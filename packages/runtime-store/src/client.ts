import type { RememberedFact } from "@sidecar/acts";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type { HistoryAppendOutcome, SessionKey } from "@sidecar/runtime-contracts";
import { brainStateSave } from "./envelope.js";
import type { LegacyImportReport } from "./legacy-import.js";
import {
  RUNTIME_STORE_METHOD,
  type RuntimeStoreMethod,
  type RuntimeStoreMethods,
  type RuntimeStoreOpenOptions,
  type RuntimeStorePort,
  type RuntimeStoreRequest,
  type RuntimeStoreResponse,
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
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;
  #failure: Error | undefined;

  constructor(port: RuntimeStorePort) {
    this.#port = port;
    port.on("message", (message) => this.#answered(message as RuntimeStoreResponse));
    port.on("error", (error) => this.#fail(error));
    port.on("exit", (code) =>
      this.#fail(new Error(`runtime store worker exited with code ${code}`)),
    );
  }

  /** Whether the worker behind this client has failed; nothing will answer after it has. */
  failed(): Error | undefined {
    return this.#failure;
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

  open(options: RuntimeStoreOpenOptions): Promise<LegacyImportReport> {
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
    let saved: BrainPersistedState | undefined;
    let observed: string | undefined;
    return {
      load: async (): Promise<BrainStateLoad> => {
        const loaded = await this.request(RUNTIME_STORE_METHOD.BRAIN_LOAD, { sessionKey });
        saved = loaded.state;
        observed = loaded.standingGeneration;
        return loaded.state ? { state: loaded.state } : { unreadable: loaded.unreadable === true };
      },
      save: async (state: BrainPersistedState): Promise<boolean> => {
        const save = brainStateSave(saved, observed, state);
        const landed = await this.request(RUNTIME_STORE_METHOD.BRAIN_SAVE, { sessionKey, save });
        if (landed) {
          saved = state;
          observed = state.generationId;
        }
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

  clearHistoryAtOrBefore(sessionKey: SessionKey, clearedAt: number): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.HISTORY_CLEAR, { sessionKey, clearedAt });
  }

  eraseRecovery(): Promise<boolean> {
    return this.request(RUNTIME_STORE_METHOD.RECOVERY_ERASE, {});
  }

  personalFacts(): Promise<readonly RememberedFact[]> {
    return this.request(RUNTIME_STORE_METHOD.FACTS_LIST, {});
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
