import type { ConversationEntry } from "@sidecar/realtime";
import type { ConversationRecord, SessionKey } from "@sidecar/runtime-contracts";
import {
  type ConversationDeleteOutcome,
  deleteConversationHistoryFlow,
} from "./brain/conversation-deletion";
import type { BrainWiring } from "./brain/wiring";
import type { RuntimeStoreWiring } from "./runtime-store-wiring";

/**
 * The conversation operations the desktop carries out over the two wirings,
 * each on a key the directory lists: the directory itself, one conversation's
 * thread, and Delete history — the recoverable deletion the panel's Clear is,
 * in the order its own module states.
 */
export interface ConversationOperations {
  directory: () => readonly ConversationRecord[];
  holds: (sessionKey: SessionKey) => boolean;
  history: (sessionKey: SessionKey) => readonly ConversationEntry[];
  deleteHistory: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
}

export interface ConversationOperationsDependencies {
  store: Pick<
    RuntimeStoreWiring,
    "directory" | "holds" | "thread" | "historyCutoff" | "eraseHistory"
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
    history: (sessionKey) => store.thread(sessionKey).entries(),
    deleteHistory: (sessionKey) => {
      const generations = brain.store(sessionKey);
      return deleteConversationHistoryFlow({
        now: dependencies.now,
        // The voice window is told of main's Clear by the voice IPC that
        // carried the press, in its own synchronous prefix; nothing here
        // sends that command a second time.
        fence: (deletedAt) => store.thread(sessionKey).fence(deletedAt),
        readCutoffBefore: () => store.historyCutoff(sessionKey),
        fenceBrain: (deletedAt) => generations.clear(deletedAt),
        // The successor the fence began stands; the deletion takes every
        // lifetime before it and nothing recorded after the press.
        erase: (deletedAt, cutoffBefore) =>
          store.eraseHistory(sessionKey, deletedAt, generations.generationId(), cutoffBefore),
        report: dependencies.report,
      });
    },
  };
}

/** How often maintenance looks again between launches; a store crosses none of its bounds faster than this. */
export const HISTORY_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

type MaintenanceTimer = ReturnType<typeof setInterval>;

/** The clock maintenance runs on; the process's own unless a test supplies one. */
export interface MaintenanceTimers {
  setInterval: (work: () => void, ms: number) => MaintenanceTimer;
  clearInterval: (timer: MaintenanceTimer) => void;
}

export interface HistoryMaintenanceDependencies {
  store: Pick<RuntimeStoreWiring, "runMaintenance">;
  brain: Pick<BrainWiring, "busyConversations">;
  timers?: MaintenanceTimers;
}

/**
 * Maintenance runs at every live launch — interrupted archive publications
 * retried first — and then on its own hourly clock, keeping the
 * conversations with a run under way whatever their age. Answers the stop.
 */
export function startHistoryMaintenance(dependencies: HistoryMaintenanceDependencies): () => void {
  const timers: MaintenanceTimers = dependencies.timers ?? {
    setInterval: (work, ms) => setInterval(work, ms).unref(),
    clearInterval,
  };
  const run = () => void dependencies.store.runMaintenance(dependencies.brain.busyConversations());
  run();
  const timer = timers.setInterval(run, HISTORY_MAINTENANCE_INTERVAL_MS);
  return () => timers.clearInterval(timer);
}
