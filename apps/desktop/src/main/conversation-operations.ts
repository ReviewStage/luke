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
  brain: Pick<
    BrainWiring,
    "openConversation" | "closeConversation" | "resetConversation" | "store"
  >;
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
      // The store decides first: a thread it refuses to archive keeps its
      // brain, so an active record never stands with nothing to answer it.
      const archived = await store.archive(sessionKey);
      if (archived) await brain.closeConversation(sessionKey);
      return archived;
    },
    unarchive: async (sessionKey) => {
      const restored = await store.unarchive(sessionKey);
      if (restored) await brain.openConversation(sessionKey);
      return restored;
    },
    deleteHistory: (sessionKey) => {
      const generations = brain.store(sessionKey);
      return deleteConversationHistoryFlow({
        now: dependencies.now,
        // The voice window is told of main's Clear by the voice IPC that
        // carried the press, in its own synchronous prefix; nothing here
        // sends that command a second time.
        fence: (deletedAt) => store.thread(sessionKey).fence(deletedAt),
        fenceBrain: (deletedAt) => generations.clear(deletedAt),
        // The successor the fence began stands; the deletion takes every
        // lifetime before it and nothing recorded after the press.
        erase: (deletedAt) => store.eraseHistory(sessionKey, deletedAt, generations.generationId()),
        report: dependencies.report,
      });
    },
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
