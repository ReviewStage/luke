import type { ConversationRecord, SessionKey } from "@sidecar/runtime/vocabulary";
import type { Effect } from "effect";
import {
  type ConversationDeleteOutcome,
  deleteConversationFlow,
} from "./brain/conversation-deletion.js";
import type { BrainWiring } from "./brain/wiring.js";
import type { HeldConversations } from "./held-conversations.js";

/**
 * The conversation operations the host carries out over the two wirings,
 * each on a key the directory lists: the directory itself, and Delete
 * conversation — the deletion the panel's Clear is, in the order its own
 * module states.
 */
export interface ConversationOperations {
  directory: () => readonly ConversationRecord[];
  deleteConversation: (sessionKey: SessionKey) => Effect.Effect<ConversationDeleteOutcome>;
}

export interface ConversationOperationsDependencies {
  conversations: Pick<HeldConversations, "directory" | "thread" | "erase">;
  brain: Pick<BrainWiring, "store">;
  now: () => number;
  report: (message: string) => void;
}

export function conversationOperations(
  dependencies: ConversationOperationsDependencies,
): ConversationOperations {
  const { conversations, brain } = dependencies;
  return {
    directory: () => conversations.directory(),
    deleteConversation: (sessionKey) => {
      const generations = brain.store(sessionKey);
      return deleteConversationFlow({
        now: dependencies.now,
        // The voice window is told of main's Clear by the voice IPC that
        // carried the press, in its own synchronous prefix; nothing here
        // sends that command a second time.
        fence: (deletedAt) => conversations.thread(sessionKey).fence(deletedAt),
        fenceBrain: (deletedAt) => generations.clear(deletedAt),
        erase: (deletedAt) => conversations.erase(sessionKey, deletedAt),
        report: dependencies.report,
      });
    },
  };
}
