import { Effect } from "effect";

export interface ConversationDeletionDependencies {
  now: () => number;
  /**
   * Fences the brain's generation now and stands the successor's marker in
   * its place; answers whether the marker stands. The fence itself is
   * synchronous inside the call, before its first await.
   */
  fenceBrain: (deletedAt: number) => Promise<boolean>;
  report: (message: string) => void;
}

/**
 * How a deletion ended. Complete means the successor lifetime stands; refused
 * means the marker did not stand, so the old generation stays behind its
 * fence for the next landed write to replace.
 */
export const CONVERSATION_DELETE_OUTCOME = {
  COMPLETE: "complete",
  REFUSED: "refused",
} as const;

export type ConversationDeleteOutcome =
  (typeof CONVERSATION_DELETE_OUTCOME)[keyof typeof CONVERSATION_DELETE_OUTCOME];

const CONVERSATION_DELETION_REFUSED = "the brain's memory could not be marked erased";

/**
 * Delete conversation, in the order that makes a late arrival harmless. The
 * fence comes first and is synchronous: the brain's generation is fenced
 * before anything is awaited — the store forgets it and announces the empty
 * successor — so every run and every turn of the old lifetime loses its
 * execution at once and a late model answer, act result, or checkpoint of it
 * lands nowhere. The deletion is complete once the successor's marker
 * stands. Nothing is retired or reopened: the same brain works on from the
 * empty successor, and a credential rebuild landing meanwhile builds over the
 * same store, whose standing generation is that successor. This side keeps
 * no lines to forget: the Conversation the press clears is the service's,
 * and its soft delete is the conversation composer's own call. The fence is
 * the effect's own first step, so it stands as soon as whoever runs it
 * reaches that step and before it waits on anything.
 */
export const deleteConversationFlow = /* @__PURE__ */ Effect.fn("deleteConversationFlow")(
  function* (
    dependencies: ConversationDeletionDependencies,
  ): Effect.fn.Return<ConversationDeleteOutcome> {
    const deletedAt = dependencies.now();
    const marked = yield* Effect.promise(() => dependencies.fenceBrain(deletedAt));
    if (!marked) {
      // No marker, so the old generation is left for the next landed write to
      // replace: the fence already keeps it out of every context.
      dependencies.report(`Delete conversation incomplete: ${CONVERSATION_DELETION_REFUSED}`);
      return CONVERSATION_DELETE_OUTCOME.REFUSED;
    }
    return CONVERSATION_DELETE_OUTCOME.COMPLETE;
  },
);
