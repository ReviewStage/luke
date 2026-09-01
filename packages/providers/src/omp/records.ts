import os from "node:os";
import path from "node:path";
import { isRecord, isWireString, text, type WireRecord } from "@sidecar/wire";

export const OMP_SESSIONS_DIRECTORY = "sessions";
export const OMP_SESSION_FILE_EXTENSION = ".jsonl";

export const OMP_RECORD_TYPE = {
  TITLE: "title",
  SESSION: "session",
  MESSAGE: "message",
  CUSTOM: "custom",
} as const;

export const OMP_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_RESULT: "toolResult",
} as const;

export const OMP_CONTENT_TYPE = {
  TEXT: "text",
  TOOL_CALL: "toolCall",
} as const;

export const OMP_CUSTOM_TYPE = {
  TOOL_EXECUTION_START: "tool_execution_start",
  SESSION_EXIT: "session_exit",
} as const;

export const OMP_STOP_REASON = {
  ERROR: "error",
  ABORTED: "aborted",
} as const;

export const OMP_EXIT_KIND = {
  FATAL: "fatal",
} as const;

/**
 * Session ids OMP mints in filenames and headers. Tight enough that an id is
 * never a path: no separators, no dots, nothing relative.
 */
export const OMP_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;

export function defaultOmpHome(): string {
  return path.join(os.homedir(), ".omp", "agent");
}

export function sessionIdFromOmpFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(OMP_SESSION_FILE_EXTENSION)) return undefined;
  const stem = fileName.slice(0, -OMP_SESSION_FILE_EXTENSION.length);
  const separator = stem.lastIndexOf("_");
  if (separator <= 0 || separator === stem.length - 1) return undefined;
  const id = stem.slice(separator + 1);
  return OMP_SESSION_ID_PATTERN.test(id) ? id : undefined;
}

export function ompMessageFrom(record: WireRecord): WireRecord | undefined {
  if (record.type !== OMP_RECORD_TYPE.MESSAGE) return undefined;
  return isRecord(record.message) ? record.message : undefined;
}

export function ompContentBlocks(message: WireRecord): WireRecord[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

/** The words of a message, which OMP stores as one string or as text blocks. */
export function ompMessageText(message: WireRecord): string | undefined {
  if (isWireString(message.content)) return text(message.content);
  const parts = ompContentBlocks(message)
    .filter((block) => block.type === OMP_CONTENT_TYPE.TEXT)
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}
