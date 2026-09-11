import path from "node:path";
import { transcriptLine } from "@sidecar/session";
import {
  isRecord,
  isWireString,
  oneLine,
  text,
  type UnparsedWireValue,
  type WireRecord,
  wholeText,
} from "@sidecar/wire";
import { TRANSCRIPT_BOUNDS } from "../shared/jsonl-transcript.js";
import { readDirectory, statDirectoryEntry } from "../shared/local-files.js";
import {
  CLAUDE_CONTENT_TYPE,
  CLAUDE_EVENT_TYPE,
  CLAUDE_PROJECTS_DIRECTORY,
  CLAUDE_RECORD_TYPE,
  CLAUDE_SESSION_FILE_EXTENSION,
  CLAUDE_SESSION_ID_PATTERN,
  CLAUDE_SYSTEM_SUBTYPE,
  CLAUDE_TOOL_INPUT_KEYS,
  claudeContentBlocks,
  claudeMessageText,
  isClaudeToolResult,
} from "./records.js";

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

function toolLine(block: WireRecord): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const input = isRecord(block.input) ? block.input : {};
  for (const key of CLAUDE_TOOL_INPUT_KEYS) {
    const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return transcriptLine.toolCall(name, detail);
  }
  return transcriptLine.toolCall(name);
}

/** The words inside one value, whether it is a string or text blocks. */
function wordsFromContent(content: UnparsedWireValue): string | undefined {
  if (isWireString(content)) return text(content);
  if (Array.isArray(content)) {
    const parts = content
      .filter(isRecord)
      .filter((part) => part.type === CLAUDE_CONTENT_TYPE.TEXT)
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
function toolResultText(record: WireRecord): string | undefined {
  for (const block of claudeContentBlocks(record)) {
    if (block.type !== CLAUDE_CONTENT_TYPE.TOOL_RESULT) continue;
    const words = wordsFromContent(block.content);
    if (words) return words;
  }
  const result = record.toolUseResult;
  if (isWireString(result)) return text(result);
  if (isRecord(result)) {
    return (
      wordsFromContent(result.content) ?? text(result.stdout) ?? text(result.stderr) ?? undefined
    );
  }
  return undefined;
}

/** Renders one record into the lines a conversation can carry, oldest first. */
export function linesFromClaudeRecord(record: WireRecord): string[] {
  if (record.type === CLAUDE_EVENT_TYPE.USER) {
    if (isClaudeToolResult(record)) {
      const answer = oneLine(toolResultText(record), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      return answer ? [transcriptLine.toolResult(answer)] : [];
    }
    const prompt = wholeText(claudeMessageText(record));
    return prompt ? [transcriptLine.developer(prompt)] : [];
  }
  if (record.type === CLAUDE_EVENT_TYPE.ASSISTANT) {
    const lines: string[] = [];
    const words = wholeText(claudeMessageText(record));
    if (words) lines.push(transcriptLine.agent("Claude", words));
    for (const block of claudeContentBlocks(record)) {
      if (block.type !== CLAUDE_CONTENT_TYPE.TOOL_USE) continue;
      const line = toolLine(block);
      if (line) lines.push(line);
    }
    return lines;
  }
  if (
    record.type === CLAUDE_RECORD_TYPE.SYSTEM &&
    record.subtype === CLAUDE_SYSTEM_SUBTYPE.API_ERROR
  ) {
    const error = record.error;
    const words = isRecord(error)
      ? oneLine(text(error.formatted) ?? text(error.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
      : undefined;
    return words ? [transcriptLine.error(words)] : [];
  }
  if (record.type === CLAUDE_EVENT_TYPE.RESULT) {
    const words = wholeText(text(record.result));
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
export async function claudeTranscriptFilePath(
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
