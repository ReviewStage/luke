import type { BrainStateStore } from "@sidecar/brain";

/**
 * The History Clear, in the order that makes a late arrival harmless. The
 * fence comes first and is synchronous: the cutoff is raised, the relayed
 * thread is emptied and every window told, so from here on no history write,
 * window report, model context, or publication can carry a line from before
 * the press, whatever the disk does next. The brain's generation is fenced in
 * the same breath — the store forgets it and announces the empty successor
 * before waiting on anything, and the host's own listener withdraws the
 * speech that generation had queued — and its marker is then written over
 * the old content. Only after that is the thread's file removed. A step that
 * fails leaves the fence standing and answers that the erasure did not
 * complete, never that it did: the developer sees an emptied History and is
 * told the file may still hold the words, rather than a panel that says done
 * over a disk that kept them.
 */
export interface ConversationClearDependencies {
  /** The one writer of the brain's state; its Clear fences the generation and writes the marker. */
  store: Pick<BrainStateStore, "clear">;
  now: () => number;
  /** Raises the cutoff, empties the relayed thread, and tells every window, before anything is erased. */
  fence: (clearedAt: number) => void;
  /** Removes the stored thread; answers whether it went. */
  removeConversation: () => boolean;
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
  const marking = dependencies.store.clear(clearedAt);
  const removed = dependencies.removeConversation();
  const marked = await marking;
  if (!marked)
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.MARKER}`);
  if (!removed)
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.THREAD}`);
  return marked && removed;
}
