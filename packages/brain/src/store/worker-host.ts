import type { WorkerError } from "@effect/platform/WorkerError";
import type * as WorkerRunner from "@effect/platform/WorkerRunner";
import { type Rpc, RpcServer, RpcTest } from "@effect/rpc";
import type { SqlClient } from "@effect/sql/SqlClient";
import { Effect, Exit, Layer, Option, Ref, Scope } from "effect";
import { deleteConversation } from "./archives.js";
import { loadBrainEnvelopeEffect, saveBrainEnvelopeEffect } from "./brain-envelope.js";
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
  conversationClearedAtEffect,
  listConversationEffect,
  searchConversationEffect,
} from "./conversation-table.js";
import {
  archiveConversationEffect,
  createConversationEffect,
  listConversationsEffect,
  pinConversationEffect,
  unarchiveConversationEffect,
} from "./conversations-table.js";
import { runConversationMaintenance } from "./maintenance-run.js";
import { flushStateEffect, recordFlushEffect } from "./memory-flush-table.js";
import {
  applyMemorySyncEffect,
  memoryIndexStatusEffect,
  planMemorySyncEffect,
  readMemoryLines,
  rebuildMemoryIndexEffect,
  searchMemoryIndexEffect,
} from "./memory-index-table.js";
import {
  forgetNotebookEntryEffect,
  listNotebookEntriesEffect,
  rememberNotebookEntryEffect,
} from "./notebook-table.js";
import type { StoreTransport } from "./store-client.js";
import {
  type OpenStore,
  openStore,
  STORE_NOT_OPEN,
  StoreOperationFailed,
  type StoreRpc,
  StoreRpcs,
} from "./store-operations.js";

/**
 * The database's side of the boundary: the handlers for every operation the
 * group declares, and the server that answers them on the worker thread.
 *
 * The server takes one request at a time, in the order they arrive, so two
 * writes from the main thread land in the order they were sent and the
 * synchronous database underneath is never asked two things at once. A
 * handler's failure is the request's own answer and nothing more: a
 * statement that fails, a port that throws, and a store that is not open
 * are each the operation's typed refusal under the request's id, and a
 * defect in one handler answers that request rather than ending the client,
 * so a caller always hears back. The database is opened by the `store.open`
 * request and released by `store.close`, by the next open, or with the
 * server's own scope when the worker is told to end, whichever comes first.
 */

/** The database a `store.open` stood up, and the scope that releases it. */
interface HeldStore {
  readonly store: OpenStore;
  readonly scope: Scope.CloseableScope;
}

const failed = (cause: unknown): StoreOperationFailed =>
  new StoreOperationFailed({
    message: cause instanceof Error ? cause.message : String(cause),
  });

/** A port's synchronous call as the request's own answer: a throw is the operation's refusal, never a defect. */
const ported = <A>(call: () => A): Effect.Effect<A, StoreOperationFailed> =>
  Effect.try({ try: call, catch: failed });

/**
 * The handlers, closing over the one slot the open store stands in. The
 * layer's scope owns the slot: whatever stands in it when the scope closes is
 * released then, so a worker told to end closes its database on the way out.
 */
const storeHandlers: Layer.Layer<Rpc.ToHandler<StoreRpc>> = StoreRpcs.toLayer(
  Effect.gen(function* () {
    const held = yield* Ref.make(Option.none<HeldStore>());

    const release = Effect.flatMap(Ref.getAndSet(held, Option.none()), (standing) =>
      Option.match(standing, {
        onNone: () => Effect.void,
        onSome: (current) => Scope.close(current.scope, Exit.void),
      }),
    );
    yield* Effect.addFinalizer(() => release);

    const requireOpen = Effect.flatMap(Ref.get(held), (standing) =>
      Option.match(standing, {
        onNone: () => Effect.fail(new StoreOperationFailed({ message: STORE_NOT_OPEN })),
        onSome: (current) => Effect.succeed(current.store),
      }),
    );

    /** A table effect over the open store's own client; what it fails with is the request's refusal. */
    const over = <A, E>(
      run: (store: OpenStore) => Effect.Effect<A, E, SqlClient>,
    ): Effect.Effect<A, StoreOperationFailed> =>
      Effect.flatMap(requireOpen, (store) =>
        Effect.provide(run(store), store.db.sql).pipe(Effect.mapError(failed)),
      );

    /** A port's synchronous call over the open store. */
    const overPort = <A>(call: (store: OpenStore) => A): Effect.Effect<A, StoreOperationFailed> =>
      Effect.flatMap(requireOpen, (store) => ported(() => call(store)));

    return StoreRpcs.of({
      "store.open": (options) =>
        Effect.gen(function* () {
          // The old store is let go before the new one is opened, so an open
          // that fails leaves the worker honestly closed rather than holding a
          // handle to a database it already closed; the whole exchange runs
          // uninterrupted so no scope is made that nothing then holds.
          yield* release;
          const scope = yield* Scope.make();
          const store = yield* Scope.extend(openStore(options), scope).pipe(
            Effect.onError(() => Scope.close(scope, Exit.void)),
          );
          yield* Ref.set(held, Option.some({ store, scope }));
          return true;
        }).pipe(
          Effect.uninterruptible,
          Effect.catchTag("SqlError", (error) => Effect.fail(failed(error))),
        ),
      "store.close": () => Effect.as(release, true),

      "brain.load": (p) => over(() => loadBrainEnvelopeEffect(p.sessionKey)),
      "brain.save": (p) => over(() => saveBrainEnvelopeEffect(p.sessionKey, p.save)),

      "conversation.append": (p) =>
        over(() => appendConversationEffect(p.sessionKey, p.entries, p.now)),
      "conversation.list": (p) => over(() => listConversationEffect(p.sessionKey, p.now)),
      "conversation.cutoff": (p) => over(() => conversationClearedAtEffect(p.sessionKey)),
      "conversation.search": (p) =>
        over(() => searchConversationEffect(p.sessionKeys, p.query, p.limit, p.now)),

      "notebook.list": (p) => over((s) => listNotebookEntriesEffect(s.workspace, p.now)),
      "notebook.remember": (p) => over((s) => rememberNotebookEntryEffect(s.workspace, p, p.now)),
      "notebook.forget": (p) => over((s) => forgetNotebookEntryEffect(s.workspace, p.id, p.now)),

      "memory.plan-sync": (p) =>
        over((s) =>
          Effect.flatMap(listNotebookEntriesEffect(s.workspace, p.now), (entries) =>
            planMemorySyncEffect(s.workspace, p.identity, entries),
          ),
        ),
      "memory.apply-sync": (p) =>
        over(() =>
          applyMemorySyncEffect(
            { changed: p.changed, removed: p.removed },
            p.embeddings,
            p.identity,
            p.now,
          ),
        ),
      "memory.search": (p) => over(() => searchMemoryIndexEffect(p)),
      "memory.get": (p) => overPort((s) => readMemoryLines(s.workspace, p.path, p.from, p.lines)),
      "memory.rebuild": () => over(() => rebuildMemoryIndexEffect),
      "memory.status": () => over(() => memoryIndexStatusEffect),
      "memory.flush-state.get": (p) => over(() => flushStateEffect(p.sessionKey, p.generationId)),
      "memory.flush-state.put": (p) =>
        over(() => Effect.as(recordFlushEffect(p.sessionKey, p.state), true)),

      "conversations.list": () => over(() => listConversationsEffect),
      "conversations.create": (p) => over(() => createConversationEffect(p)),
      "conversations.archive": (p) =>
        over(() => archiveConversationEffect(p.sessionKey, p.now, p.reason)),
      "conversations.unarchive": (p) => over(() => unarchiveConversationEffect(p.sessionKey)),
      "conversations.pin": (p) => over(() => pinConversationEffect(p.sessionKey, p.pinnedAt)),
      "conversations.delete": (p) =>
        overPort((s) => deleteConversation(s.db, s.agentRoot, p.sessionKey, p.now, p)),

      "maintenance.run": (p) => overPort((s) => runConversationMaintenance(s.db, s.agentRoot, p)),

      "children.list": () => over(() => listChildRunsEffect),
      "children.put": (p) => over(() => putChildRunEffect(p.record)),
      "children.delete": (p) => over(() => deleteChildRunEffect(p.childId)),
      "completions.list": () => over(() => listChildCompletionsEffect),
      "completions.put": (p) => over(() => putChildCompletionEffect(p.completion)),
      "completions.delete": (p) => over(() => deleteChildCompletionEffect(p.completionId)),
    });
  }),
);

/**
 * The server as the worker thread runs it: the handlers above behind the
 * worker-runner protocol, one request at a time. The runner the platform
 * supplies is what the worker's entry provides; nothing here knows it is a
 * `node:worker_threads` worker rather than any other runner.
 */
export const storeWorkerLayer: Layer.Layer<never, WorkerError, WorkerRunner.PlatformRunner> =
  RpcServer.layer(StoreRpcs, {
    concurrency: 1,
    disableTracing: true,
    disableFatalDefects: true,
  }).pipe(Layer.provide(storeHandlers), Layer.provide(RpcServer.layerProtocolWorkerRunner));

/**
 * The same handlers served in the calling thread, with no worker between:
 * what a test that wants the store without a thread connects its client to.
 * Nothing can end this connection but its scope, so it is never gone.
 */
export const inProcessStoreTransport = (): StoreTransport => ({
  connect: Effect.gen(function* () {
    const handlers = yield* Layer.build(storeHandlers);
    const client = yield* Effect.provide(
      RpcTest.makeClient(StoreRpcs, { flatten: true }),
      handlers,
    );
    return { client: Effect.succeed(client), gone: Effect.never };
  }),
});
