/**
 * The vocabulary Claude Code's own records are read with. It is one table per
 * fact the provider writes down, seeded here with the one thing the
 * observation pass and the transcript read both need to say.
 */

/**
 * Tool inputs whose value names the work, in the order they read best. The
 * observation pass and the transcript read look at the same tool blocks, so a
 * second copy of this order would let a tool's activity be named one way on a
 * row and another in a rendering.
 */
export const CLAUDE_TOOL_INPUT_KEYS = [
  "description",
  "file_path",
  "pattern",
  "command",
  "prompt",
] as const;
