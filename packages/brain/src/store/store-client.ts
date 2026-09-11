import type * as WorkerThreads from "node:worker_threads";
import type { WorkerError } from "@effect/platform/WorkerError";
import { NodeWorker } from "@effect/platform-node";
import { type Rpc, RpcClient } from "@effect/rpc";
import type { RpcClientError } from "@effect/rpc/RpcClientError";
import type { NotebookMemoryStore } from "@sidecar/memory";
import type { ChildStore } from "@sidecar/runtime";
import type { ExecutionRuntime, SessionKey, TranscriptEvent } from "@sidecar/runtime/vocabulary";
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Runtime,
  Scope,
} from "effect";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "../envelope.js";
import { EnvelopeTracker } from "./envelope.js";
import type { StoreSchemaRefused } from "./migration.js";
import {
  type OperationParams,
  type OperationResult,
  type StoreOpenOptions,
  type StoreOperationFailed,
  type StoreOperationName,
  type StoreRpc,
  StoreRpcs,
} from "./store-operations.js";

/**
 * The main thread's handle on the store: every operation is one request to
 * the worker and a promise of its answer. One `ask` serves the whole group —
 * the name it takes selects the parameters it demands and the answer it
 * promises — so an operation is declared once, in the group, and neither end
 * keeps a second list to forget a name in.
 *
 * Three things hold by construction here. A request executes once: the Rpc
 * client sends each under an id of its own and settles it on the one answer
 * carrying that id. Answers come back in the order the asks were made: the
 * asks of one client are admitted one at a time through `sends`, so the next
 * request leaves only when the previous answer has landed, and the worker
 * pool beneath is one worker taking one request at a time. And a worker that
 * dies is a typed failure, never a hang: the transport watches the thread's
 * own exit, so the ask in flight and every ask after it fails with
 * `StoreWorkerGone`, and a client that was closed refuses every ask with
 * `StoreNotOpen`. What a refused write means for the action it guarded is
 * the caller's decision, as it always was.
 */
export interface StoreClient {
  ask<Name extends StoreOperationName>(
    name: Name,
    params: OperationParams<Name>,
  ): Promise<OperationResult<Name>>;
  /** Connects to the worker, if not yet connected, and opens the store at these options. */
  open(options: StoreOpenOptions): Promise<boolean>;
  /** Closes the store and ends the worker; every later ask is refused. */
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
  /** The notebook's index and Conversation's search under the names the memory package's host asks for. */
  notebookMemoryStore(): NotebookMemoryStore;
  /** The child service's records and completions as a store, each written whole through the worker. */
  childStore(): ChildStore;
}

/** An ask made of a client that is not open: never connected, or closed. */
export class StoreNotOpen extends Data.TaggedError("StoreNotOpen") {
  override get message(): string {
    return "the brain's store is not open";
  }
}

/** The worker thread ended, by exit or by error; nothing more will be answered. */
export class StoreWorkerGone extends Data.TaggedError("StoreWorkerGone")<{
  readonly code: number | undefined;
  readonly cause: Error | undefined;
}> {
  override get message(): string {
    return this.code === undefined
      ? `the brain's store worker failed: ${this.cause?.message ?? "no cause"}`
      : `the brain's store worker exited with code ${this.code}`;
  }
}

/** The Rpc client for the group, as one function of the operation's tag. */
type StoreRpcClient = RpcClient.RpcClient.Flat<StoreRpc, RpcClientError>;

/** A standing connection to a store server, wherever it runs. */
interface StoreConnection {
  /** The client, once the server is ready to be asked; fails where the server went before it was. */
  readonly client: Effect.Effect<StoreRpcClient, WorkerError | StoreWorkerGone>;
  /** Settles, as a failure, the moment the server can answer nothing more; never, for a server that cannot go. */
  readonly gone: Effect.Effect<never, StoreWorkerGone>;
}

/** How a client reaches a store server: the worker thread in the app, the calling thread in a test. */
export interface StoreTransport {
  readonly connect: Effect.Effect<StoreConnection, never, Scope.Scope>;
}

/** What an ask can fail with, over any transport. */
export type StoreAskFailure =
  | StoreNotOpen
  | StoreWorkerGone
  | WorkerError
  | StoreOperationFailed
  | StoreSchemaRefused
  | RpcClientError;

/**
 * The transport over a `node:worker_threads` worker the caller spawns: one
 * worker in the pool, one request at a time, and the thread's own `exit` and
 * `error` events as the signal that it is gone. The signal is watched here
 * rather than read out of the pool, because a pool hands a dead worker back
 * for the next request as readily as a live one, and a request posted to a
 * dead thread is never answered. Readiness is waited for on the connection's
 * own fiber rather than here, because the pool waits for the worker's first
 * word in a region nothing can interrupt: a worker that dies before it
 * speaks would otherwise hold the connect open forever, where racing the
 * wait against `gone` fails it at once and the scope's close lets the pool
 * down after.
 */
export const workerStoreTransport = (spawn: () => WorkerThreads.Worker): StoreTransport => ({
  connect: Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const gone = yield* Deferred.make<never, StoreWorkerGone>();
    const watched = (): WorkerThreads.Worker => {
      const worker = spawn();
      worker.once("exit", (code) => {
        Deferred.unsafeDone(gone, Exit.fail(new StoreWorkerGone({ code, cause: undefined })));
      });
      worker.once("error", (cause: Error) => {
        Deferred.unsafeDone(gone, Exit.fail(new StoreWorkerGone({ code: undefined, cause })));
      });
      return worker;
    };
    const protocol = RpcClient.layerProtocolWorker({ size: 1, concurrency: 1 }).pipe(
      Layer.provide(NodeWorker.layerPlatform(watched)),
    );
    const ready = yield* Effect.forkDaemon(
      Scope.extend(
        Effect.flatMap(Layer.build(protocol), (context) =>
          Effect.provide(
            RpcClient.make(StoreRpcs, { flatten: true, disableTracing: true }),
            context,
          ),
        ),
        scope,
      ).pipe(Effect.withUnhandledErrorLogLevel(Option.none())),
    );
    return {
      client: Effect.raceFirst(Fiber.join(ready), Deferred.await(gone)),
      gone: Deferred.await(gone),
    };
  }),
});

/**
 * Settles an effect as the promise its caller still holds, on the runtime it
 * was handed rather than one built here, rejecting with the failure itself
 * rather than a wrapper of it, so a caller reads the same `message` the store
 * wrote.
 */
const settledOn = (
  execution: ExecutionRuntime,
): (<A, E>(effect: Effect.Effect<A, E>) => Promise<A>) => {
  const exits =
    ManagedRuntime.TypeId in execution
      ? <A, E>(effect: Effect.Effect<A, E>) => execution.runPromiseExit(effect)
      : Runtime.runPromiseExit(execution);
  return (effect) =>
    exits(effect).then((exit) =>
      Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
    );
};

/**
 * The Promise face over a transport, every ask of it run on the execution the
 * caller composed: the host's own runtime in the app, so the store's asks are
 * fibers of the one runtime the host holds rather than of a second one built
 * where the work lives.
 *
 * @deprecated A strangler shim on the `Effect.runPromise` allowlist in
 * `docs/adr/0001-effect.md`: `StoreClient` answers the promises
 * `BrainStateRepository`, `NotebookMemoryStore`, and `ChildStore` declare, so
 * the face lives as long as those three interfaces do.
 */
export function storeClient(transport: StoreTransport, execution: ExecutionRuntime): StoreClient {
  const settled = settledOn(execution);
  const sends = Effect.unsafeMakeSemaphore(1);
  interface Standing extends StoreConnection {
    readonly scope: Scope.CloseableScope;
    /** Hears the server go and lets the connection down; interrupted by a close that came first. */
    readonly watcher: Fiber.RuntimeFiber<void>;
  }
  let standing: Standing | undefined;
  let gone: StoreWorkerGone | undefined;

  const connected = Effect.suspend(
    (): Effect.Effect<StoreConnection, StoreNotOpen | StoreWorkerGone> => {
      if (gone) return Effect.fail(gone);
      return standing ? Effect.succeed(standing) : Effect.fail(new StoreNotOpen());
    },
  );

  /**
   * Opens the connection where none stands. The scope is made and held under
   * one mask, so an interruption cannot part the two and leave a scope nothing
   * holds; the transport connects, and the watcher is forked, interruptible.
   */
  const connect: Effect.Effect<StoreConnection, StoreWorkerGone> = Effect.uninterruptibleMask(
    (restore) =>
      Effect.gen(function* () {
        if (gone) return yield* Effect.fail(gone);
        if (standing) return standing;
        const scope = yield* Scope.make();
        const connection = yield* restore(Scope.extend(transport.connect, scope)).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit) ? Effect.void : Scope.close(scope, Exit.void),
          ),
        );
        const watcher = yield* restore(
          Effect.forkDaemon(
            Effect.catchAll(connection.gone, (failure) =>
              Effect.suspend(() => {
                gone = failure;
                standing = undefined;
                return Scope.close(scope, Exit.void);
              }),
            ),
          ),
        );
        standing = { ...connection, scope, watcher };
        return connection;
      }),
  );

  /**
   * One request, answered once or failed once. The overload states the
   * correlation the flat client cannot carry through a tag it holds generic:
   * the tag selects both ends of one Rpc, the payload sent and the answer
   * awaited, so the answer for `name` is that Rpc's own success and refusal.
   */
  function call<Name extends StoreOperationName>(
    connection: StoreConnection,
    name: Name,
    params: OperationParams<Name>,
  ): Effect.Effect<OperationResult<Name>, StoreAskFailure>;
  function call<Name extends StoreOperationName>(
    connection: StoreConnection,
    name: Name,
    params: OperationParams<Name>,
  ): Effect.Effect<Rpc.Success<StoreRpc>, StoreAskFailure, unknown> {
    return Effect.raceFirst(
      Effect.flatMap(connection.client, (client) => client(name, params)),
      connection.gone,
    );
  }

  const ask = <Name extends StoreOperationName>(
    name: Name,
    params: OperationParams<Name>,
  ): Promise<OperationResult<Name>> =>
    settled(
      sends.withPermits(1)(
        Effect.flatMap(connected, (connection) => call(connection, name, params)),
      ),
    );

  const open = (options: StoreOpenOptions): Promise<boolean> =>
    settled(
      sends.withPermits(1)(
        Effect.flatMap(connect, (connection) => call(connection, "store.open", options)),
      ),
    );

  const close = (): Promise<boolean> =>
    settled(
      sends.withPermits(1)(
        Effect.gen(function* () {
          const connection = standing;
          if (!connection) return true;
          standing = undefined;
          yield* Fiber.interrupt(connection.watcher);
          yield* Effect.ignore(call(connection, "store.close", {}));
          yield* Scope.close(connection.scope, Exit.void);
          return true;
        }),
      ),
    );

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
    open,
    close,
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
      searchConversation: (sessionKeys, query, limit, now) =>
        ask("conversation.search", { sessionKeys, query, limit, now }),
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
