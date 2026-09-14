/**
 * The names of the notebook's two memory tools, fixed in a file of their own
 * that imports nothing, so a surface that only words a call by its tool's
 * name — the desktop's Conversation — reaches the names without the provider
 * behind them.
 */
export const NOTEBOOK_MEMORY_TOOL = {
  SEARCH: "memory_search",
  GET: "memory_get",
} as const;

export type NotebookMemoryToolName =
  (typeof NOTEBOOK_MEMORY_TOOL)[keyof typeof NOTEBOOK_MEMORY_TOOL];
