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
  conversations: Pick<HeldConversations, "directory">;
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
        fenceBrain: (deletedAt) => generations.clear(deletedAt),
        report: dependencies.report,
      });
    },
  };
}
