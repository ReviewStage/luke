import os from "node:os";
import path from "node:path";
import { isRecord, oneLine, text } from "@sidecar/core";
import { readDirectory, readTail, statDirectoryEntry, tailRecords } from "./local-session-adapter";
import { boundedTranscript, TRANSCRIPT_BOUNDS } from "./local-transcript";

/**
 * On-demand reading of one local Cursor session's transcript, for a question
 * the developer just asked. The JSONL file under Cursor's own projects
 * directory is the transcript — the same file the adapter reads its turn
 * markers from — so this reads it the way the adapter reads its tail, only
 * deeper: a bounded slice, parsed in memory, rendered into a bounded
 * conversation, and discarded. Nothing here is retained, watched, or written;
 * a session is re-read the next time it is asked about.
 *
 * Cursor deliberately keeps tool outputs out of these files, so the rendering
 * carries the developer's words, the agent's replies, its tool calls, and how
 * a failed turn failed — and no `←` lines, because there is honestly nothing
 * to put on them.
 */

const CURSOR_SPEAKER_NAME = "Cursor";

const CURSOR_PROJECTS_DIRECTORY = "projects";
const CURSOR_TRANSCRIPTS_DIRECTORY = "agent-transcripts";
const CURSOR_TRANSCRIPT_FILE_EXTENSION = ".jsonl";

/**
 * The id becomes path segments under Cursor's home, so only a plain file-name
 * shape is accepted at all: it must start on a letter or digit, and nothing
 * that could climb a directory gets past the first character.
 */
const CURSOR_SESSION_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const CURSOR_RECORD_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

/** The turn marker the adapter already reads, here for how a turn failed. */
const CURSOR_RECORD_TYPE = {
  TURN_ENDED: "turn_ended",
} as const;

const CURSOR_TURN_STATUS = {
  ERROR: "error",
} as const;

const CURSOR_CONTENT_TYPE = {
  TEXT: "text",
  TOOL_USE: "tool_use",
} as const;

/** Tool inputs whose value names the work, in the order they read best. */
const CURSOR_TOOL_INPUT_KEY = [
  "description",
  "file_path",
  "pattern",
  "command",
  "query",
  "prompt",
] as const;

/**
 * The tags Cursor wraps around what the developer typed. The words live
 * inside `user_query`; everything else a user record carries — timestamps,
 * attached files, reminders — is Cursor's own scaffolding.
 */
const CURSOR_USER_QUERY_SHAPE = /<user_query>([\s\S]*?)<\/user_query>/g;

/**
 * A user message that is entirely XML-tagged blocks with no query among them
 * is scaffolding alone, not something the developer said.
 */
const CURSOR_SCAFFOLDING_SHAPE = /^(?:<([a-z_]+)>[\s\S]*?<\/\1>\s*)+$/;

export interface CursorTranscriptRequest {
  cursorHome?: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

function defaultCursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
  const message = record.message;
  const content = isRecord(message) ? message.content : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/** The words of a message, whether the content is a string or text blocks. */
function messageText(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return text(content);
  const parts = contentBlocks(record)
    .filter((block) => block.type === CURSOR_CONTENT_TYPE.TEXT)
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The developer's own words in a user record: the `user_query` blocks when
 * Cursor wrapped them, the whole text when it did not, and nothing when the
 * record is scaffolding alone.
 */
function developerWords(words: string): string | undefined {
  const queries = [...words.matchAll(CURSOR_USER_QUERY_SHAPE)]
    .map((match) => text(match[1]))
    .filter((query): query is string => query !== undefined);
  if (queries.length > 0) return queries.join(" ");
  if (CURSOR_SCAFFOLDING_SHAPE.test(words.trim())) return undefined;
  return text(words);
}

function toolLine(block: Record<string, unknown>): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const input = isRecord(block.input) ? block.input : {};
  for (const key of CURSOR_TOOL_INPUT_KEY) {
    const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return `→ ${name}: ${detail}`;
  }
  return `→ ${name}`;
}

/** Renders one record into the lines a conversation can carry, oldest first. */
function linesFromRecord(record: Record<string, unknown>): string[] {
  if (record.type === CURSOR_RECORD_TYPE.TURN_ENDED) {
    if (record.status !== CURSOR_TURN_STATUS.ERROR) return [];
    const reason = isRecord(record.error)
      ? oneLine(text(record.error.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
      : undefined;
    return [reason ? `Error: ${reason}` : "Error: The turn failed"];
  }
  if (record.role === CURSOR_RECORD_ROLE.USER) {
    const words = messageText(record);
    const typed = words
      ? oneLine(developerWords(words), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH)
      : undefined;
    return typed ? [`Developer: ${typed}`] : [];
  }
  if (record.role === CURSOR_RECORD_ROLE.ASSISTANT) {
    const lines: string[] = [];
    const words = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (words) lines.push(`${CURSOR_SPEAKER_NAME}: ${words}`);
    for (const block of contentBlocks(record)) {
      if (block.type !== CURSOR_CONTENT_TYPE.TOOL_USE) continue;
      const line = toolLine(block);
      if (line) lines.push(line);
    }
    return lines;
  }
  return [];
}

/**
 * Finds the session's transcript file the way discovery does — the file named
 * by the session's own id, inside that session's directory under one of the
 * project directories — without trusting the id as a path: an id outside a
 * plain file-name shape names nothing.
 */
async function transcriptFilePath(
  cursorHome: string,
  providerSessionId: string,
): Promise<string | undefined> {
  if (!CURSOR_SESSION_ID_SHAPE.test(providerSessionId)) return undefined;
  const projectsDirectory = path.join(cursorHome, CURSOR_PROJECTS_DIRECTORY);
  const fileName = `${providerSessionId}${CURSOR_TRANSCRIPT_FILE_EXTENSION}`;
  for (const entry of await readDirectory(projectsDirectory)) {
    const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
    if (!projectDirectory?.stats.isDirectory()) continue;
    const sessionDirectory = await statDirectoryEntry(
      path.join(projectDirectory.directoryPath, CURSOR_TRANSCRIPTS_DIRECTORY),
      providerSessionId,
    );
    if (!sessionDirectory?.stats.isDirectory()) continue;
    const candidate = await statDirectoryEntry(sessionDirectory.directoryPath, fileName);
    if (candidate?.stats.isFile()) return candidate.directoryPath;
  }
  return undefined;
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no transcript file exists for that id.
 */
export async function readCursorSessionTranscript(
  request: CursorTranscriptRequest,
): Promise<string | undefined> {
  const filePath = await transcriptFilePath(
    request.cursorHome ?? defaultCursorHome(),
    request.providerSessionId,
  );
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = tailRecords(tail).flatMap(linesFromRecord);
  return boundedTranscript(
    lines,
    request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
  );
}
