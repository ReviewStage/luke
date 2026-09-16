import type { ConversationKind, SessionKey } from "./identifiers.js";

/**
 * The vocabulary of conversation state as the host and the brain speak it:
 * a conversation's record in the directory and the transcript's events.
 * Nothing here names a database; whoever holds the state, in memory here or
 * in Luke's service, speaks these shapes.
 */

/**
 * Where a compaction came from. This build folds a context one way, behind a
 * summary the model writes; the two provider sources name folds earlier
 * builds asked OpenAI for, inline inside an answer or as an explicit
 * compaction, and stay in the vocabulary so the boundaries those builds
 * recorded still read back rather than dropping from a transcript.
 */
export const COMPACTION_SOURCE = {
  PROVIDER_INLINE: "provider_inline",
  PROVIDER_EXPLICIT: "provider_explicit",
  LOCAL_SUMMARY: "local_summary",
  /** A child's context adopted whole from its requester's at its start; nothing was dropped. */
  FORK: "fork",
} as const;

export type CompactionSource = (typeof COMPACTION_SOURCE)[keyof typeof COMPACTION_SOURCE];

/**
 * Why a conversation left the active list. The developer's own press is one
 * reason; the others are maintenance's, ported from OpenClaw's store: a
 * conversation untouched past the stale threshold, a private thread idle past
 * its own shorter one, and the cap on unarchived conversations. Only the cap's
 * victims are ever eligible for the disk budget's permanent deletion.
 */
const ARCHIVE_REASON = {
  USER: "user",
  AGE_RETENTION: "age-retention",
  IDLE_THREAD: "idle-thread",
  ACTIVE_SESSION_CAP: "active-session-cap",
} as const;

type ArchiveReason = (typeof ARCHIVE_REASON)[keyof typeof ARCHIVE_REASON];

/** One conversation as the directory lists it: its address, its kind, and where it stands in its lifecycle. */
export interface ConversationRecord {
  readonly sessionKey: SessionKey;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly createdAt: number;
  /** The latest moment anything was written for it: a conversation line, a checkpoint, a transcript event. */
  readonly lastActivityAt: number;
  readonly archivedAt?: number;
  readonly archiveReason?: ArchiveReason;
  readonly pinnedAt?: number;
  /** The lifetime standing for it, when one does. */
  readonly sessionId?: string;
  /** A thread held in memory alone, gone at the next launch; never stored, so never true on a stored record. */
  readonly temporary?: boolean;
}
