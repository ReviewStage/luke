import type { ConversationErasure } from "../store-wiring.js";

/** The durable cutoff as read, which may itself be absent when no deletion ever raised one. */
export interface CutoffBefore {
  value: number | undefined;
}

export interface ConversationDeletionDependencies {
  now: () => number;
  /** Empties the relayed thread and tells every window, before anything is awaited. */
  fence: (deletedAt: number) => void;
  /**
   * Fences the brain's generation now and writes the successor's marker over
   * the old content; answers whether the marker reached storage. The fence
   * itself is synchronous inside the call, before its first await.
   */
  fenceBrain: (deletedAt: number) => Promise<boolean>;
  /**
   * Reads the conversation's durable cutoff as the store holds it, for the
   * archive to record as the cutoff before this press. Called before the
   * brain is fenced, so the store answers it ahead of the marker that raises
   * the cutoff to the press itself; the thread's own fence is no substitute,
   * since it advances whether or not an earlier marker reached the disk.
   * Answers nothing when the store could not be read.
   */
  readCutoffBefore: () => Promise<CutoffBefore | undefined>;
  /** The store's deletion of what stood at or before the instant, behind a committed archive; publication attempted. */
  erase: (
    deletedAt: number,
    cutoffBefore: number | undefined,
  ) => Promise<ConversationErasure | undefined>;
  report: (message: string) => void;
}

/**
 * How a deletion ended. Complete means the rows are gone and the recovery
 * archive is published and verified on disk; incomplete means the rows are
 * gone and the archive is committed in the database but its file is not yet
 * published, which the next launch retries; refused means the rows still
 * stand on disk behind the fences, for the next landed write to replace.
 */
export const CONVERSATION_DELETE_OUTCOME = {
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  REFUSED: "refused",
} as const;

export type ConversationDeleteOutcome =
  (typeof CONVERSATION_DELETE_OUTCOME)[keyof typeof CONVERSATION_DELETE_OUTCOME];

const CONVERSATION_DELETION_INCOMPLETE = {
  MARKER: "the brain's memory could not be marked erased on disk",
  CUTOFF: "the conversation's earlier cutoff could not be read for the recovery archive",
  ROWS: "the stored conversation could not be removed",
  ARCHIVE: "the recovery archive is committed but not yet published; the next launch retries",
} as const;

/**
 * Delete conversation, in the order that makes a late arrival harmless and the
 * erasure recoverable. The fences come first and are synchronous: the relayed
 * thread is emptied and every window told, and the brain's generation is
 * fenced in the same breath — the store forgets it and announces the empty
 * successor before waiting on anything, so every run and every turn of the
 * old lifetime loses its execution at once and a late model answer, act
 * result, or checkpoint of it lands nowhere. The successor's marker is then
 * written over the old content, and only once it is durable does the store
 * remove what stood at or before the press: the lines and transcript of that
 * instant and earlier, in one transaction with the compressed recovery
 * archive and the raised cutoff, while a line accepted after the press stays
 * and the successor lifetime stands. Nothing is retired or reopened: the same
 * brain works on from the empty successor, and a credential rebuild landing
 * meanwhile builds over the same store, whose standing generation is that
 * successor.
 */
export async function deleteConversationFlow(
  dependencies: ConversationDeletionDependencies,
): Promise<ConversationDeleteOutcome> {
  const deletedAt = dependencies.now();
  dependencies.fence(deletedAt);
  const cutoffRead = dependencies.readCutoffBefore();
  const marked = await dependencies.fenceBrain(deletedAt);
  if (!marked) {
    // No durable marker, so the rows are left for the next landed write to
    // replace: the fences already keep them out of every view and context,
    // and rows removed without their marker would be a deletion the next
    // launch could not tell had happened.
    dependencies.report(
      `Delete conversation incomplete: ${CONVERSATION_DELETION_INCOMPLETE.MARKER}`,
    );
    return CONVERSATION_DELETE_OUTCOME.REFUSED;
  }
  const cutoffBefore = await cutoffRead;
  if (!cutoffBefore) {
    // An archive recording a guessed cutoff would make its restore hide
    // lines it brings back; the rows stay, behind the fences and the marker.
    dependencies.report(
      `Delete conversation incomplete: ${CONVERSATION_DELETION_INCOMPLETE.CUTOFF}`,
    );
    return CONVERSATION_DELETE_OUTCOME.REFUSED;
  }
  const outcome = await dependencies.erase(deletedAt, cutoffBefore.value);
  if (!outcome) {
    dependencies.report(`Delete conversation incomplete: ${CONVERSATION_DELETION_INCOMPLETE.ROWS}`);
    return CONVERSATION_DELETE_OUTCOME.REFUSED;
  }
  if (!outcome.published) {
    dependencies.report(
      `Delete conversation incomplete: ${CONVERSATION_DELETION_INCOMPLETE.ARCHIVE}`,
    );
    return CONVERSATION_DELETE_OUTCOME.INCOMPLETE;
  }
  return CONVERSATION_DELETE_OUTCOME.COMPLETE;
}
