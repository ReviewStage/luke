/**
 * Local tool arguments whose value names the work, in display order. URLs are
 * deliberately absent: a signed URL can be a credential, so a fetch is named
 * by its tool alone.
 */
export const LOCAL_TOOL_ARGUMENT_KEYS = [
  "description",
  "command",
  "file_path",
  "path",
  "pattern",
  "prompt",
  "query",
] as const;
