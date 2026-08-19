import path from "node:path";
import { isRecord, oneLine, text } from "@sidecar/core";
import { readDirectory, readTail, statDirectoryEntry, tailRecords } from "./local-session-adapter";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptContentBlocks,
  transcriptLine,
  transcriptMessageText,
} from "./local-transcript";

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
const CLAUDE_SESSION_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

/** Tool inputs whose value names the work, in the order they read best. */
const TOOL_INPUT_KEYS = ["description", "file_path", "pattern", "command", "prompt"] as const;

export interface ClaudeTranscriptRequest {
  claudeHome: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

function toolLine(block: Record<string, unknown>): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const input = isRecord(block.input) ? block.input : {};
  for (const key of TOOL_INPUT_KEYS) {
    const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return transcriptLine.toolCall(name, detail);
  }
  return transcriptLine.toolCall(name);
}

/** The words inside one value, whether it is a string or text blocks. */
function wordsFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return text(content);
  if (Array.isArray(content)) {
    const parts = content
      .filter(isRecord)
      .filter((part) => part.type === "text")
      .map((part) => text(part.text))
      .filter((part): part is string => part !== undefined);
    if (parts.length > 0) return parts.join(" ");
  }
  return undefined;
}

/**
 * The words a tool answered with, wherever this build finds them. The
 * `tool_result` blocks carry what the model was shown and are preferred;
 * `toolUseResult` is the fallback, because Claude Code often writes a record
 * with only that bookkeeping shape — a string outright, or an object whose
 * output rides `stdout`, `stderr`, or `content`.
 */
function toolResultText(record: Record<string, unknown>): string | undefined {
  for (const block of transcriptContentBlocks(record, true)) {
    if (block.type !== "tool_result") continue;
    const words = wordsFromContent(block.content);
    if (words) return words;
  }
  const result = record.toolUseResult;
  if (typeof result === "string") return text(result);
  if (isRecord(result)) {
    return (
      wordsFromContent(result.content) ?? text(result.stdout) ?? text(result.stderr) ?? undefined
    );
  }
  return undefined;
}

function isToolResult(record: Record<string, unknown>): boolean {
  if (record.toolUseResult !== undefined) return true;
  return transcriptContentBlocks(record, true).some((block) => block.type === "tool_result");
}

/** Renders one record into the lines a conversation can carry, oldest first. */
function linesFromRecord(record: Record<string, unknown>): string[] {
  if (record.type === "user") {
    if (isToolResult(record)) {
      const answer = oneLine(toolResultText(record), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      return answer ? [transcriptLine.toolResult(answer)] : [];
    }
    const prompt = oneLine(
      transcriptMessageText(record, true),
      TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
    );
    return prompt ? [transcriptLine.developer(prompt)] : [];
  }
  if (record.type === "assistant") {
    const lines: string[] = [];
    const words = oneLine(
      transcriptMessageText(record, true),
      TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
    );
    if (words) lines.push(transcriptLine.agent("Claude", words));
    for (const block of transcriptContentBlocks(record, true)) {
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
    return words ? [transcriptLine.error(words)] : [];
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
  if (!CLAUDE_SESSION_ID_PATTERN.test(providerSessionId)) return undefined;
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
 * when no transcript file exists for that id.
 */
export async function readClaudeSessionTranscript(
  request: ClaudeTranscriptRequest,
): Promise<string | undefined> {
  const filePath = await transcriptFilePath(request.claudeHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = tailRecords(tail).flatMap(linesFromRecord);
  return boundedTranscript(
    lines,
    request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
  );
}
