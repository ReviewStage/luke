import type { ConversationRecord, SessionKey } from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { Duration, Effect, Exit, Runtime, Schedule, Scope } from "effect";
import {
  type ConversationDeleteOutcome,
  deleteConversationFlow,
} from "./brain/conversation-deletion.js";
import type { BrainWiring } from "./brain/wiring.js";
import type { StoreWiring } from "./store-wiring.js";

/**
 * The conversation operations the host carries out over the two wirings,
 * each on a key the directory lists: the directory itself, one conversation's
 * thread, and Delete conversation — the recoverable deletion the panel's Clear is,
 * in the order its own module states.
 */
export interface ConversationOperations {
  directory: () => readonly ConversationRecord[];
  holds: (sessionKey: SessionKey) => boolean;
  lines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  deleteConversation: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
}

export interface ConversationOperationsDependencies {
  store: Pick<
    StoreWiring,
    "directory" | "holds" | "thread" | "conversationCutoff" | "eraseConversation"
  >;
  brain: Pick<BrainWiring, "store">;
  now: () => number;
  report: (message: string) => void;
}

export function conversationOperations(
  dependencies: ConversationOperationsDependencies,
): ConversationOperations {
  const { store, brain } = dependencies;
  return {
    directory: () => store.directory(),
    holds: (sessionKey) => store.holds(sessionKey),
    lines: (sessionKey) => store.thread(sessionKey).entries(),
    deleteConversation: (sessionKey) => {
      const generations = brain.store(sessionKey);
      return deleteConversationFlow({
        now: dependencies.now,
        // The voice window is told of main's Clear by the voice IPC that
        // carried the press, in its own synchronous prefix; nothing here
        // sends that command a second time.
        fence: (deletedAt) => store.thread(sessionKey).fence(deletedAt),
        readCutoffBefore: () => store.conversationCutoff(sessionKey),
        fenceBrain: (deletedAt) => generations.clear(deletedAt),
        // The successor the fence began stands; the deletion takes every
        // lifetime before it and nothing recorded after the press.
        erase: (deletedAt, cutoffBefore) =>
          store.eraseConversation(sessionKey, deletedAt, generations.generationId(), cutoffBefore),
        report: dependencies.report,
      });
    },
  };
}

/** How often maintenance looks again between launches; a store crosses none of its bounds faster than this. */
export const CONVERSATION_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

export interface ConversationMaintenanceDependencies {
  store: Pick<StoreWiring, "runMaintenance">;
  brain: Pick<BrainWiring, "busyConversations">;
  /** The runtime the cadence is forked on, for a caller (a test today) that holds its own. */
  runtime?: Runtime.Runtime<never>;
}

/**
 * Maintenance runs at every live launch — interrupted archive publications
 * retried first — and then on its own hourly clock, keeping the
 * conversations with a run under way whatever their age. Answers the stop,
 * which closes the scope the cadence's fiber was forked into. `Effect.repeat`
 * rather than `Effect.schedule`: the launch's own first pass is the cadence's
 * first repetition rather than one a caller awaits separately, exactly as the
 * `setInterval` this replaces ran its first pass at once. A pass that fails
 * is dropped rather than let end the cadence, since nothing else would
 * restart it before the next launch.
 */
export function startConversationMaintenance(
  dependencies: ConversationMaintenanceDependencies,
): () => void {
  const runtime = dependencies.runtime ?? Runtime.defaultRuntime;
  const pass = Effect.catchAllCause(
    Effect.promise(() =>
      dependencies.store
        .runMaintenance(dependencies.brain.busyConversations())
        .then(() => undefined),
    ),
    () => Effect.void,
  );
  const scope = Runtime.runSync(runtime)(Scope.make());
  Runtime.runSync(runtime)(
    Effect.provideService(
      Effect.forkScoped(
        Effect.repeat(pass, Schedule.spaced(Duration.millis(CONVERSATION_MAINTENANCE_INTERVAL_MS))),
      ),
      Scope.Scope,
      scope,
    ),
  );
  return () => {
    Runtime.runFork(runtime)(Scope.close(scope, Exit.void));
  };
}
