import type { ConversationEntry } from "@sidecar/realtime";
import { MAIN_SESSION_KEY, type RestoreOutcome, type SessionKey } from "@sidecar/runtime-contracts";
import {
  type ConversationDeleteOutcome,
  deleteConversationHistoryFlow,
} from "./brain/conversation-deletion";
import type { BrainWiring } from "./brain/wiring";
import type { ConversationDirectorySnapshot, RuntimeStoreWiring } from "./runtime-store-wiring";

/**
 * The conversation operations the desktop carries out over the two wirings,
 * each on a key the directory lists. New thread opens a brain over a fresh
 * conversation; Start fresh replaces a conversation's lifetime and touches
 * none of its history; Archive retires a thread's brain and leaves its
 * history in the store; Delete history is the recoverable deletion, in the
 * order its own module states; Restore brings an archive back where no newer
 * conversation stands. The panel reaches exactly one of them: its Clear is
 * Delete history on main. The rest have no control until a product decision
 * draws one, and stand here exercised by their tests.
 */
export interface ConversationOperations {
  directory: () => ConversationDirectorySnapshot;
  holds: (sessionKey: SessionKey) => boolean;
  history: (sessionKey: SessionKey) => readonly ConversationEntry[];
  createThread: (temporary: boolean) => Promise<SessionKey | undefined>;
  startFresh: (sessionKey: SessionKey) => Promise<boolean>;
  archive: (sessionKey: SessionKey) => Promise<boolean>;
  unarchive: (sessionKey: SessionKey) => Promise<boolean>;
  deleteHistory: (sessionKey: SessionKey) => Promise<ConversationDeleteOutcome>;
  restoreArchive: (archiveId: string) => Promise<RestoreOutcome>;
}

export interface ConversationOperationsDependencies {
  store: Pick<
    RuntimeStoreWiring,
    | "directory"
    | "holds"
    | "thread"
    | "createThread"
    | "archive"
    | "unarchive"
    | "eraseHistory"
    | "restoreArchive"
  >;
  brain: Pick<BrainWiring, "openConversation" | "closeConversation" | "resetConversation">;
  /** Tells the voice window main's history is gone, so it retires its turns and empties its copy of the thread. */
  retireVoiceTurns: () => void;
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
    createThread: async (temporary) => {
      const record = await store.createThread(temporary);
      await brain.openConversation(record.sessionKey);
      return record.sessionKey;
    },
    startFresh: (sessionKey) => brain.resetConversation(sessionKey),
    archive: async (sessionKey) => {
      if (sessionKey === MAIN_SESSION_KEY) return false;
      await brain.closeConversation(sessionKey);
      return store.archive(sessionKey);
    },
    unarchive: async (sessionKey) => {
      const restored = await store.unarchive(sessionKey);
      if (restored) await brain.openConversation(sessionKey);
      return restored;
    },
    deleteHistory: (sessionKey) =>
      deleteConversationHistoryFlow({
        now: dependencies.now,
        fence: (deletedAt) => {
          store.thread(sessionKey).fence(deletedAt);
          if (sessionKey === MAIN_SESSION_KEY) dependencies.retireVoiceTurns();
        },
        retireBrain: () => brain.closeConversation(sessionKey),
        erase: (deletedAt) => store.eraseHistory(sessionKey, deletedAt),
        rebuildBrain: () => brain.openConversation(sessionKey),
        report: dependencies.report,
      }),
    restoreArchive: (archiveId) => store.restoreArchive(archiveId),
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
