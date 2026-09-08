import { MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import { VOICE_COMMAND } from "#shared/wire/voice-view";
import { deleteConversationHistoryFlow } from "./brain/conversation-deletion";
import type { BrainWiring } from "./brain/wiring";
import type { ConversationOperations } from "./ipc/conversations";
import type { RuntimeStoreWiring } from "./runtime-store-wiring";

/**
 * The conversation controls as the desktop carries them out, each on a key
 * the directory listed when the panel asked. New thread opens a brain over a
 * fresh conversation; Start fresh replaces a conversation's lifetime and
 * touches none of its history; Archive retires a thread's brain and leaves
 * its history in the store; Delete history is the recoverable deletion, in
 * the order its own module states; Restore brings an archive back where no
 * newer conversation stands. Main's turns in the voice window are retired
 * whenever main starts fresh or loses its history.
 */

/** The two things the voice window is told about main: its turns are retired, with or without its copy of the thread. */
export type VoiceRetirement =
  | typeof VOICE_COMMAND.CLEAR_CONVERSATION
  | typeof VOICE_COMMAND.RETIRE_TURNS;

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
  retireVoiceTurns: (command: VoiceRetirement) => void;
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
    startFresh: async (sessionKey) => {
      const reset = await brain.resetConversation(sessionKey);
      if (sessionKey === MAIN_SESSION_KEY)
        dependencies.retireVoiceTurns(VOICE_COMMAND.RETIRE_TURNS);
      return reset;
    },
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
          if (sessionKey === MAIN_SESSION_KEY) {
            dependencies.retireVoiceTurns(VOICE_COMMAND.CLEAR_CONVERSATION);
          }
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
