/**
 * When a conversation's context folds. The policy is OpenClaw's at the pinned
 * revision: the context is compacted once it crosses the model's window less
 * a reserve of 20,000 tokens, the reserve capped at one quarter of the
 * window. It lives here, in the vocabulary, because it is a rule about Luke's
 * conversations rather than about whichever runtime folds them: the desktop's
 * own fold reads it, and the hosted brain hands the same threshold to the
 * runtime that owns compaction there.
 */

export const COMPACTION_RESERVE = {
  TOKENS: 20_000,
  WINDOW_DIVISOR: 4,
} as const;

export function reserveTokens(contextWindowTokens: number): number {
  return Math.min(
    COMPACTION_RESERVE.TOKENS,
    Math.floor(contextWindowTokens / COMPACTION_RESERVE.WINDOW_DIVISOR),
  );
}

/** Whether a context this large folds: past the window less its reserve. */
export function shouldCompact(contextTokens: number, contextWindowTokens: number): boolean {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return false;
  return contextTokens > contextWindowTokens - reserveTokens(contextWindowTokens);
}
