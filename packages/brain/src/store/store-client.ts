import type { ChildStore, ScheduledJobStore } from "@sidecar/runtime";
import type { SessionKey, TranscriptEvent } from "@sidecar/runtime/vocabulary";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "../state-store.js";
import { EnvelopeTracker } from "./envelope.js";
import {
  STORE_LIFECYCLE,
  STORE_OPERATION_NAMES,
  type STORE_OPERATIONS,
  type StoreOpenOptions,
  type StoreOperationName,
} from "./store-operations.js";
import {
  type StorePort,
  type StoreRequest,
  type StoreResponse,
  storeResponseFromWire,
} from "./wire.js";

type OperationParams<Name extends StoreOperationName> = Parameters<
  (typeof STORE_OPERATIONS)[Name]
>[1];
type OperationResult<Name extends StoreOperationName> = ReturnType<(typeof STORE_OPERATIONS)[Name]>;

/** Every operation as a promise-returning method under its own name, derived from the table. */
export type StoreCalls = {
  [Name in StoreOperationName]: (params: OperationParams<Name>) => Promise<OperationResult<Name>>;
};

/**
 * The main thread's handle on the store: every operation is a message to the
 * worker and a promise of its answer. A worker that errors or exits settles
 * every request still out as rejected and refuses every later one, so a
 * caller never waits on a thread that is gone; what a rejected write means
 * for the act it guarded is the caller's decision, as it always was.
 */
export type StoreClient = StoreCalls & {
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
  /** The child service's records and completions as a store, each written whole through the worker. */
  childStore(): ChildStore;
};

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

  const request = (name: StoreRequest["name"], params: unknown): Promise<UnparsedWireValue> => {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        port.postMessage({ id, name, params });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const calls = {} as Record<StoreOperationName, (params: unknown) => Promise<UnparsedWireValue>>;
  for (const name of STORE_OPERATION_NAMES) {
    calls[name] = (params) => request(name, params);
  }

  const brainStateRepository = (sessionKey: SessionKey): BrainStateRepository => {
    const tracker = new EnvelopeTracker();
    return {
      load: async (): Promise<BrainStateLoad> => {
        const loaded = await client["brain.load"]({ sessionKey });
        tracker.observe(loaded);
        return loaded.state ? { state: loaded.state } : { unreadable: loaded.unreadable === true };
      },
      save: async (
        state: BrainPersistedState,
        transcript?: readonly TranscriptEvent[],
      ): Promise<boolean> => {
        const save = tracker.saveFor(state, transcript);
        const landed = await client["brain.save"]({ sessionKey, save });
        if (landed) tracker.landed(state);
        return landed;
      },
    };
  };

  // SAFETY: every name of the table has a method above, built from the table's
  // own keys, and each one answers with the result its operation declares;
  // TypeScript cannot correlate a name with its own params and result through
  // an index, which is the one place this file narrows by hand.
  const client: StoreClient = {
    ...(calls as unknown as StoreCalls),
    open: (options) => request(STORE_LIFECYCLE.OPEN, options) as Promise<boolean>,
    close: () => request(STORE_LIFECYCLE.CLOSE, {}) as Promise<boolean>,
    brainStateRepository,
    scheduledJobStore: () => ({
      list: () => client["jobs.list"]({}),
      put: (job) => client["jobs.put"]({ job }),
      delete: (id) => client["jobs.delete"]({ id }),
    }),
    childStore: () => ({
      listChildren: () => client["children.list"]({}),
      putChild: (record) => client["children.put"]({ record }),
      deleteChild: (childId) => client["children.delete"]({ childId }),
      listCompletions: () => client["completions.list"]({}),
      putCompletion: (completion) => client["completions.put"]({ completion }),
      deleteCompletion: (completionId) => client["completions.delete"]({ completionId }),
    }),
  };
  return client;
}
