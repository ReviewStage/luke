import { isRecord, isWireString, text, type WireRecord } from "@sidecar/wire";

/**
 * The vocabulary Claude Code's own records are read with: one table per fact
 * the provider writes down, and the readers the observation pass and the
 * transcript read both reach for. A second copy of any of these would let the
 * same record be read one way on a row and another in a rendering.
 */

export const CLAUDE_PROJECTS_DIRECTORY = "projects";
export const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";

/** The same shape the observation hook accepts: the ids Claude Code mints. */
export const CLAUDE_SESSION_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

export const CLAUDE_EVENT_TYPE = {
  ASSISTANT: "assistant",
  RESULT: "result",
  USER: "user",
} as const;

export type ClaudeEventType = (typeof CLAUDE_EVENT_TYPE)[keyof typeof CLAUDE_EVENT_TYPE];

/** Records Claude Code writes alongside the conversation itself. */
export const CLAUDE_RECORD_TYPE = {
  AI_TITLE: "ai-title",
  /**
   * A name chosen for the session rather than generated from it: a rename in
   * Claude Code's own UI, or the title the Claude desktop app gives a Code
   * tab session. It is what the developer reads wherever that session is
   * listed, so it outranks the generated title.
   */
  CUSTOM_TITLE: "custom-title",
  PR_LINK: "pr-link",
  SYSTEM: "system",
} as const;

export const CLAUDE_SYSTEM_SUBTYPE = {
  API_ERROR: "api_error",
} as const;

/**
 * Why the model stopped. This says what the tail alone cannot: a turn that ended
 * is holding for the developer, and a turn that stopped to call a tool is not.
 */
export const CLAUDE_STOP_REASON = {
  END_TURN: "end_turn",
  TOOL_USE: "tool_use",
} as const;

export const CLAUDE_CONTENT_TYPE = {
  TEXT: "text",
  TOOL_RESULT: "tool_result",
  TOOL_USE: "tool_use",
} as const;

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

/**
 * Where Claude Code puts a record's content: inside `message` for a
 * conversation record, and directly on the record for the bookkeeping shapes
 * it also writes.
 */
function claudeContent(record: WireRecord): WireRecord[string] | undefined {
  const message = record.message;
  return isRecord(message) ? message.content : record.content;
}

export function claudeContentBlocks(record: WireRecord): WireRecord[] {
  const content = claudeContent(record);
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/** The words of a record, which Claude Code writes as one string or as text blocks. */
export function claudeMessageText(record: WireRecord): string | undefined {
  const content = claudeContent(record);
  if (isWireString(content)) return text(content);
  const parts = claudeContentBlocks(record)
    .filter((block) => block.type === CLAUDE_CONTENT_TYPE.TEXT)
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function claudeEventType(record: WireRecord): ClaudeEventType | undefined {
  const eventType = record.type;
  if (!isWireString(eventType)) return undefined;
  for (const candidate of Object.values(CLAUDE_EVENT_TYPE)) {
    if (eventType === candidate) return candidate;
  }
  return undefined;
}

/**
 * Whether a user record carries a tool's output rather than a person's prompt.
 * The two look alike at the top level and mean opposite things: one continues
 * the turn under way, the other opens a new one.
 */
export function isClaudeToolResult(record: WireRecord): boolean {
  if (record.toolUseResult !== undefined) return true;
  return claudeContentBlocks(record).some(
    (block) => block.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT,
  );
}
