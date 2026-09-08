import type { HistoryErasure } from "../runtime-store-wiring";

/**
 * Delete history, in the order that makes a late arrival harmless and the
 * erasure recoverable. The fence comes first and is synchronous: the relayed
 * thread is emptied and every window told, so from here on no history write,
 * window report, or publication can carry a line from before the press. The
 * conversation's brain is then retired — its runs revoked, its follower
 * drained — so nothing of the old lifetime can checkpoint or publish into
 * the rows about to go. Only then does the store remove the rows, in one
 * transaction with the compressed recovery archive and the raised cutoff,
 * and publish the archive to disk; and only then is a fresh brain stood up
 * over the now-empty conversation, which loads no generation and begins one.
 *
 * The answer is honest about the seam: complete only when the archive file
 * is published and verified; incomplete when the rows are gone and the
 * archive committed but not yet on disk, which the next launch retries; and
 * refused when the store did not take the deletion at all — the fence and
 * the cutoff stand either way, and what the developer sees is an emptied
 * History rather than a panel that says done over rows still there.
 */
export interface ConversationDeletionDependencies {
  now: () => number;
  /** Empties the relayed thread and tells every window, before anything is erased. */
  fence: (deletedAt: number) => void;
  /** Stops the conversation's brain and drains its publication; settles once nothing of it can write. */
  retireBrain: () => Promise<void>;
  /** The store's deletion: rows removed behind a committed archive, publication attempted; a memory thread has nothing to publish. */
  erase: (deletedAt: number) => Promise<HistoryErasure | undefined>;
  /** Stands a fresh brain up over the emptied conversation. */
  rebuildBrain: () => Promise<void>;
  report: (message: string) => void;
}

/**
 * How a deletion ended. Complete means the rows are gone and the recovery
 * archive is published and verified on disk; incomplete means the rows are
 * gone and the archive is committed in the database but its file is not yet
 * published, which the next launch retries; refused means nothing changed.
 */
export const CONVERSATION_DELETE_OUTCOME = {
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  REFUSED: "refused",
} as const;

export type ConversationDeleteOutcome =
  (typeof CONVERSATION_DELETE_OUTCOME)[keyof typeof CONVERSATION_DELETE_OUTCOME];

export async function deleteConversationHistoryFlow(
  dependencies: ConversationDeletionDependencies,
): Promise<ConversationDeleteOutcome> {
  const deletedAt = dependencies.now();
  dependencies.fence(deletedAt);
  await dependencies.retireBrain();
  let outcome: HistoryErasure | undefined;
  try {
    outcome = await dependencies.erase(deletedAt);
  } finally {
    await dependencies.rebuildBrain();
  }
  if (!outcome) {
    dependencies.report("Delete history refused: the store did not remove the conversation");
    return CONVERSATION_DELETE_OUTCOME.REFUSED;
  }
  if (!outcome.published) {
    dependencies.report(
      "Delete history incomplete: the recovery archive is committed but not yet published; the next launch retries",
    );
    return CONVERSATION_DELETE_OUTCOME.INCOMPLETE;
  }
  return CONVERSATION_DELETE_OUTCOME.COMPLETE;
}
