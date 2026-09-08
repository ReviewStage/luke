import type { ConversationRecord, SessionKey } from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
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
}

/**
 * Maintenance runs at every live launch — interrupted archive publications
 * retried first — and then on its own hourly clock, keeping the
 * conversations with a run under way whatever their age. Answers the stop.
 */
export function startConversationMaintenance(
  dependencies: ConversationMaintenanceDependencies,
): () => void {
  const run = () => void dependencies.store.runMaintenance(dependencies.brain.busyConversations());
  run();
  const timer = setInterval(run, CONVERSATION_MAINTENANCE_INTERVAL_MS).unref();
  return () => clearInterval(timer);
}
