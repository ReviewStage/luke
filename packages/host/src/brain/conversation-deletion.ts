import { Effect } from "effect";

export interface ConversationDeletionDependencies {
  now: () => number;
  /** Empties the relayed thread and tells every window, before anything is awaited. */
  fence: (deletedAt: number) => void;
  /**
   * Fences the brain's generation now and stands the successor's marker in
   * its place; answers whether the marker stands. The fence itself is
   * synchronous inside the call, before its first await.
   */
  fenceBrain: (deletedAt: number) => Promise<boolean>;
  /** Forgets the lines recorded at or before the instant. */
  erase: (deletedAt: number) => void;
  report: (message: string) => void;
}

/**
 * How a deletion ended. Complete means the lines at or before the press are
 * gone and the successor lifetime stands; refused means the marker did not
 * stand, so the lines are left behind the fences for the next landed write
 * to replace.
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
 * fences come first and are synchronous: the relayed thread is emptied and
 * every window told, and the brain's generation is fenced in the same breath
 * — the store forgets it and announces the empty successor before waiting on
 * anything, so every run and every turn of the old lifetime loses its
 * execution at once and a late model answer, act result, or checkpoint of it
 * lands nowhere. Only once the successor's marker stands are the lines of
 * that instant and earlier forgotten, while a line accepted after the press
 * stays and the successor lifetime stands. Nothing is retired or reopened:
 * the same brain works on from the empty successor, and a credential rebuild
 * landing meanwhile builds over the same store, whose standing generation is
 * that successor. The fences are the effect's own first step, so they stand
 * as soon as whoever runs it reaches that step and before it waits on
 * anything.
 */
export const deleteConversationFlow = /* @__PURE__ */ Effect.fn("deleteConversationFlow")(
  function* (
    dependencies: ConversationDeletionDependencies,
  ): Effect.fn.Return<ConversationDeleteOutcome> {
    const deletedAt = dependencies.now();
    dependencies.fence(deletedAt);
    const marked = yield* Effect.promise(() => dependencies.fenceBrain(deletedAt));
    if (!marked) {
      // No marker, so the lines are left for the next landed write to replace:
      // the fences already keep them out of every view and context.
      dependencies.report(`Delete conversation incomplete: ${CONVERSATION_DELETION_REFUSED}`);
      return CONVERSATION_DELETE_OUTCOME.REFUSED;
    }
    dependencies.erase(deletedAt);
    return CONVERSATION_DELETE_OUTCOME.COMPLETE;
  },
);
