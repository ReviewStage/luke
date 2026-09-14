/**
 * How many characters stand for a token where no real count is at hand,
 * pinned to OpenClaw `b7528507`, which sizes a context by it.
 */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

/**
 * The most characters one memory query carries, pinned to the same
 * revision's `extensions/active-memory/types.ts`.
 */
export const MEMORY_QUERY_MAXIMUM_CHARS = 480;
