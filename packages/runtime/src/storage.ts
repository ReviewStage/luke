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
