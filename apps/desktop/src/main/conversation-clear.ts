import type { BrainStateStore } from "@sidecar/brain";

/**
 * The History Clear, in the order that makes a late arrival harmless. The
 * cutoff is raised first, so every history write and window report from here
 * on is judged against it before anything is erased; the brain's generation
 * is fenced and its marker written next, in the store's one write, so no run
 * of the old generation can checkpoint or publish again and a launch that
 * finds the marker knows which lines to refuse; only then is the speech not
 * yet in the mouth withdrawn and the thread's file removed; and the windows
 * are told last, once there is nothing left that could stand the lines back
 * up. A step that fails leaves everything before it standing — fenced,
 * withdrawn, refused — and answers that the erasure did not complete, never
 * that it did: a Clear the developer is told succeeded must have reached the
 * disk on both files.
 */
export interface ConversationClearDependencies {
  /** The one writer of the brain's state; its Clear fences the generation and writes the marker. */
  store: Pick<BrainStateStore, "clear">;
  now: () => number;
  /** Raises the cutoff every later history write and report is checked against. */
  fence: (clearedAt: number) => void;
  /** Withdraws every briefing that has not reached the mouth. */
  withdrawSpeech: () => void;
  /** Removes the stored thread; answers whether it went. */
  removeConversation: () => boolean;
  /** Empties the relayed thread and tells every window it was cleared. */
  emptyConversation: () => void;
  report: (message: string) => void;
}

export const CONVERSATION_CLEAR_INCOMPLETE = {
  MARKER: "the brain's memory could not be marked erased on disk",
  THREAD: "the stored conversation could not be removed",
} as const;

export async function clearConversationAndBrain(
  dependencies: ConversationClearDependencies,
): Promise<boolean> {
  const clearedAt = dependencies.now();
  dependencies.fence(clearedAt);
  const marked = await dependencies.store.clear(clearedAt);
  dependencies.withdrawSpeech();
  const removed = dependencies.removeConversation();
  if (!marked)
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.MARKER}`);
  if (!removed)
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.THREAD}`);
  if (!marked || !removed) return false;
  dependencies.emptyConversation();
  return true;
}
