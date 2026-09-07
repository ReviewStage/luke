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
 * the old content. Only once that marker is durable is the thread's file
 * erased, and erased to what the thread holds now rather than to nothing,
 * so a line recorded after the fence while the disk was answering is not
 * taken with the old ones. A step that
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
  /**
   * Erases the stored thread as it stood before the fence, once the cutoff
   * is durable: what the thread holds now — only lines recorded after the
   * fence, if any — is what the file keeps. Answers whether the write landed.
   */
  eraseConversation: () => boolean;
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
  if (!marked) {
    // No durable cutoff, so the old thread's file is left for the next thread
    // write to replace: the fence already keeps it out of every view and
    // context, and a file removed without its marker would be a Clear the
    // next launch could not tell had happened.
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.MARKER}`);
    return false;
  }
  const erased = dependencies.eraseConversation();
  if (!erased) {
    dependencies.report(`History Clear incomplete: ${CONVERSATION_CLEAR_INCOMPLETE.THREAD}`);
  }
  return erased;
}
