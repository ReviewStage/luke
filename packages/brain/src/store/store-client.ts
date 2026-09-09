import type { NotebookMemoryStore } from "@sidecar/memory";
import type { ChildStore, ScheduledJobStore } from "@sidecar/runtime";
import type { SessionKey, TranscriptEvent } from "@sidecar/runtime/vocabulary";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "../state-store.js";
import { EnvelopeTracker } from "./envelope.js";
import {
  type AnyOperationParams,
  type OperationParams,
  type OperationResult,
  STORE_LIFECYCLE,
  type StoreOpenOptions,
  type StoreOperationName,
} from "./store-operations.js";
import {
  type StorePort,
  type StoreRequest,
  type StoreResponse,
  storeResponseFromWire,
} from "./wire.js";

/**
 * The main thread's handle on the store: every operation is a message to the
 * worker and a promise of its answer. One `ask` serves the whole table —
 * the name it takes selects the parameters it demands and the answer it
 * promises — so an operation is declared once, in the table, and neither end
 * keeps a second list to forget a name in. A worker that errors or exits
 * settles every request still out as rejected and refuses every later one, so
 * a caller never waits on a thread that is gone; what a rejected write means
 * for the act it guarded is the caller's decision, as it always was.
 */
export interface StoreClient {
  ask<Name extends StoreOperationName>(
    name: Name,
    params: OperationParams<Name>,
  ): Promise<OperationResult<Name>>;
  open(options: StoreOpenOptions): Promise<boolean>;
  close(): Promise<boolean>;
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
  brainStateRepository(sessionKey: SessionKey): BrainStateRepository;
  /** The scheduler's jobs as a store: listed, written whole, and deleted through the worker. */
  scheduledJobStore(): ScheduledJobStore;
  /** The notebook's index and History's search under the names the memory package's host asks for. */
  notebookMemoryStore(): NotebookMemoryStore;
  /** The child service's records and completions as a store, each written whole through the worker. */
  childStore(): ChildStore;
}

export function storeClient(port: StorePort): StoreClient {
  const pending = new Map<
    number,
    { resolve: (value: UnparsedWireValue) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let failure: Error | undefined;

  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };

  const answered = (response: StoreResponse): void => {
    const waiting = pending.get(response.id);
    if (!waiting) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.result);
    else waiting.reject(new Error(response.error));
  };

  port.on("message", (message) => {
    const response = storeResponseFromWire(message);
    if (response) answered(response);
  });
  port.on("error", (error) => fail(error));
  port.on("exit", (code) => fail(new Error(`the brain's store worker exited with code ${code}`)));

  /**
   * One request out, answered once or rejected once. The id is minted by the
   * caller rather than here, because a request is one of three arms and
   * spreading an id onto it would widen it past the arm it belongs to.
   */
  const send = (request: StoreRequest): Promise<UnparsedWireValue> => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      try {
        port.postMessage(request);
      } catch (error) {
        pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const ask = <Name extends StoreOperationName>(
    name: Name,
    params: OperationParams<Name>,
  ): Promise<OperationResult<Name>> =>
    // SAFETY: the name selects both ends of one table entry — the parameters
    // sent and the answer awaited — and the worker answers a request with
    // exactly that entry's result. This is the one place the correlation
    // TypeScript cannot express through an index is narrowed by hand, and it
    // is narrowed once rather than per operation.
    send({
      id: nextId++,
      name,
      params: params as AnyOperationParams,
    }) as Promise<OperationResult<Name>>;

  const brainStateRepository = (sessionKey: SessionKey): BrainStateRepository => {
    const tracker = new EnvelopeTracker();
    return {
      load: async (): Promise<BrainStateLoad> => {
        const loaded = await ask("brain.load", { sessionKey });
        tracker.observe(loaded);
        return loaded.state ? { state: loaded.state } : { unreadable: loaded.unreadable === true };
      },
      save: async (
        state: BrainPersistedState,
        transcript?: readonly TranscriptEvent[],
      ): Promise<boolean> => {
        const save = tracker.saveFor(state, transcript);
        const landed = await ask("brain.save", { sessionKey, save });
        if (landed) tracker.landed(state);
        return landed;
      },
    };
  };

  return {
    ask,
    // SAFETY: the two lifecycle messages each answer whether they took effect.
    open: (options) =>
      send({ id: nextId++, name: STORE_LIFECYCLE.OPEN, params: options }) as Promise<boolean>,
    // SAFETY: as above.
    close: () =>
      send({ id: nextId++, name: STORE_LIFECYCLE.CLOSE, params: {} }) as Promise<boolean>,
    brainStateRepository,
    notebookMemoryStore: () => ({
      planMemorySync: (identity, now) =>
        ask("memory.plan-sync", { ...(identity ? { identity } : undefined), now }),
      applyMemorySync: (apply) => ask("memory.apply-sync", apply),
      searchMemory: (query) => ask("memory.search", query),
      readMemory: (path, from, lines) =>
        ask("memory.get", {
          path,
          ...(from !== undefined ? { from } : undefined),
          ...(lines !== undefined ? { lines } : undefined),
        }),
      searchHistory: (sessionKeys, query, limit, now) =>
        ask("history.search", { sessionKeys, query, limit, now }),
    }),
    scheduledJobStore: () => ({
      list: () => ask("jobs.list", {}),
      put: (job) => ask("jobs.put", { job }),
      delete: (id) => ask("jobs.delete", { id }),
    }),
    childStore: () => ({
      listChildren: () => ask("children.list", {}),
      putChild: (record) => ask("children.put", { record }),
      deleteChild: (childId) => ask("children.delete", { childId }),
      listCompletions: () => ask("completions.list", {}),
      putCompletion: (completion) => ask("completions.put", { completion }),
      deleteCompletion: (completionId) => ask("completions.delete", { completionId }),
    }),
  };
}
