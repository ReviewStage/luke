import path from "node:path";
import { isRecord, oneLine, text } from "@sidecar/core";
import { readDirectory, readTail, statDirectoryEntry, tailRecords } from "./local-session-adapter";

/**
 * On-demand reading of one Claude Code session's transcript, for a question
 * the developer just asked. The JSONL file under the provider's own projects
 * directory is the transcript — Claude Code documents no other local source,
 * and the hook envelope's `transcript_path` names these same files — so this
 * reads it the way the adapter reads its tail, only deeper: a bounded slice,
 * parsed in memory, rendered into a bounded conversation, and discarded.
 * Nothing here is retained, watched, or written; a session is re-read the
 * next time it is asked about.
 */

const CLAUDE_PROJECTS_DIRECTORY = "projects";
const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";

/** The same shape the observation hook accepts: the ids Claude Code mints. */
const CLAUDE_SESSION_ID_SHAPE = /^[0-9a-fA-F-]{8,64}$/;

const TRANSCRIPT_BOUNDS = {
  /** How much of the file's end one read may load. */
  READ_TAIL_BYTES: 256 * 1024,
  /** A rendered message line: enough to carry meaning, not a document. */
  MAXIMUM_MESSAGE_LENGTH: 400,
  /** A rendered tool call or its result: the gist, never the payload. */
  MAXIMUM_TOOL_LENGTH: 200,
  /**
   * The whole rendering. It enters a live conversation as one tool output,
   * so it is sized for answering a question about the session, not for
   * carrying the session.
   */
  MAXIMUM_RENDERED_LENGTH: 8_000,
} as const;

const OMISSION_MARKER = "[earlier turns omitted]";

/** Tool inputs whose value names the work, in the order they read best. */
const TOOL_INPUT_KEYS = ["description", "file_path", "pattern", "command", "prompt"] as const;

export interface ClaudeTranscriptRequest {
  claudeHome: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
  const message = record.message;
  const content = isRecord(message) ? message.content : record.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/** The words of a message, whether the content is a string or text blocks. */
function messageText(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  const content = isRecord(message) ? message.content : record.content;
  if (typeof content === "string") return text(content);
  const parts = contentBlocks(record)
    .filter((block) => block.type === "text")
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function toolLine(block: Record<string, unknown>): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const input = isRecord(block.input) ? block.input : {};
  for (const key of TOOL_INPUT_KEYS) {
    const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return `→ ${name}: ${detail}`;
  }
  return `→ ${name}`;
}

/** The words a tool answered with, wherever this build finds them. */
function toolResultText(record: Record<string, unknown>): string | undefined {
  for (const block of contentBlocks(record)) {
    if (block.type !== "tool_result") continue;
    const content = block.content;
    if (typeof content === "string") return text(content);
    if (Array.isArray(content)) {
      const parts = content
        .filter(isRecord)
        .filter((part) => part.type === "text")
        .map((part) => text(part.text))
        .filter((part): part is string => part !== undefined);
      if (parts.length > 0) return parts.join(" ");
    }
  }
  return undefined;
}

function isToolResult(record: Record<string, unknown>): boolean {
  if (record.toolUseResult !== undefined) return true;
  return contentBlocks(record).some((block) => block.type === "tool_result");
}

/** Renders one record into the lines a conversation can carry, oldest first. */
function linesFromRecord(record: Record<string, unknown>): string[] {
  if (record.type === "user") {
    if (isToolResult(record)) {
      const answer = oneLine(toolResultText(record), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      return answer ? [`← ${answer}`] : [];
    }
    const prompt = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    return prompt ? [`Developer: ${prompt}`] : [];
  }
  if (record.type === "assistant") {
    const lines: string[] = [];
    const words = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (words) lines.push(`Claude: ${words}`);
    for (const block of contentBlocks(record)) {
      if (block.type !== "tool_use") continue;
      const line = toolLine(block);
      if (line) lines.push(line);
    }
    return lines;
  }
  if (record.type === "system" && record.subtype === "api_error") {
    const error = record.error;
    const words = isRecord(error)
      ? oneLine(text(error.formatted) ?? text(error.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
      : undefined;
    return words ? [`Error: ${words}`] : [];
  }
  if (record.type === "result") {
    const words = oneLine(text(record.result), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    return words ? [`Result: ${words}`] : [];
  }
  return [];
}

/**
 * Finds the session's transcript file the way discovery does — the file named
 * by the session's own id, directly inside one of the project directories —
 * without trusting the id as a path: an id outside the shape Claude Code
 * mints names nothing.
 */
async function transcriptFilePath(
  claudeHome: string,
  providerSessionId: string,
): Promise<string | undefined> {
  if (!CLAUDE_SESSION_ID_SHAPE.test(providerSessionId)) return undefined;
  const projectsDirectory = path.join(claudeHome, CLAUDE_PROJECTS_DIRECTORY);
  const fileName = `${providerSessionId}${CLAUDE_SESSION_FILE_EXTENSION}`;
  for (const entry of await readDirectory(projectsDirectory)) {
    const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
    if (!projectDirectory?.stats.isDirectory()) continue;
    const candidate = await statDirectoryEntry(projectDirectory.directoryPath, fileName);
    if (candidate?.stats.isFile()) return candidate.directoryPath;
  }
  return undefined;
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no transcript file exists for that id. The newest turns win the space:
 * a question about a session is almost always about where it is now, so the
 * rendering is cut from the front, at a line, and says so.
 */
export async function readClaudeSessionTranscript(
  request: ClaudeTranscriptRequest,
): Promise<string | undefined> {
  const filePath = await transcriptFilePath(request.claudeHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = tailRecords(tail).flatMap(linesFromRecord);
  if (lines.length === 0) return undefined;

  const maximumLength = request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH;
  let rendered = lines.join("\n");
  if (rendered.length > maximumLength) {
    const kept = rendered.slice(rendered.length - maximumLength);
    const firstWholeLine = kept.indexOf("\n");
    rendered = `${OMISSION_MARKER}\n${firstWholeLine >= 0 ? kept.slice(firstWholeLine + 1) : kept}`;
  }
  return rendered;
}
