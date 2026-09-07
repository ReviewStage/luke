import path from "node:path";
import type { ProviderTranscriptSinceReading } from "@sidecar/session";
import { isRecord, oneLine, text, type WireRecord } from "@sidecar/wire";
import {
  readDirectory,
  readTail,
  statDirectoryEntry,
  tailRecords,
} from "../shared/local-session-adapter.js";
import {
  boundedTranscript,
  readRecordsSince,
  TRANSCRIPT_BOUNDS,
  type TranscriptPathCache,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  OMP_CONTENT_TYPE,
  OMP_MESSAGE_ROLE,
  OMP_SESSION_ID_PATTERN,
  OMP_SESSIONS_DIRECTORY,
  OMP_STOP_REASON,
  ompContentBlocks,
  ompMessageFrom,
  ompMessageText,
  sessionIdFromOmpFileName,
} from "./records.js";

/**
 * On-demand reading of one OMP session's transcript, for a question
 * asked of Luke in a turn the developer opened. The rendering is bounded
 * and kept nowhere.
 */

const OMP_SPEAKER_NAME = "OMP";
const OMP_TOOL_INPUT_KEY = ["command", "path", "file_path", "pattern", "prompt"] as const;

export interface OmpTranscriptRequest {
  ompHome: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

export interface OmpTranscriptSinceRequest extends OmpTranscriptRequest {
  cursor?: string;
  pathCache: TranscriptPathCache;
}

function toolCallLine(block: WireRecord): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const intent = oneLine(text(block.intent), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
  if (intent) return transcriptLine.toolCall(name, intent);
  const args = isRecord(block.arguments) ? block.arguments : {};
  for (const key of OMP_TOOL_INPUT_KEY) {
    const detail = oneLine(text(args[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) return transcriptLine.toolCall(name, detail);
  }
  return transcriptLine.toolCall(name);
}

function linesFromRecord(record: WireRecord): string[] {
  const message = ompMessageFrom(record);
  if (!message) return [];
  const role = text(message.role);
  if (role === OMP_MESSAGE_ROLE.USER) {
    // A synthetic user message is OMP's own auto-continue, not the
    // developer's words, so it takes no attributed line.
    if (message.synthetic === true) return [];
    const prompt = oneLine(ompMessageText(message), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    return prompt ? [transcriptLine.developer(prompt)] : [];
  }
  if (role === OMP_MESSAGE_ROLE.TOOL_RESULT) {
    const answer = oneLine(ompMessageText(message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (!answer) return [];
    return message.isError === true
      ? [transcriptLine.error(answer)]
      : [transcriptLine.toolResult(answer)];
  }
  if (role !== OMP_MESSAGE_ROLE.ASSISTANT) return [];
  const lines: string[] = [];
  const words = oneLine(ompMessageText(message), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
  if (words) lines.push(transcriptLine.agent(OMP_SPEAKER_NAME, words));
  for (const block of ompContentBlocks(message)) {
    if (block.type !== OMP_CONTENT_TYPE.TOOL_CALL) continue;
    const line = toolCallLine(block);
    if (line) lines.push(line);
  }
  if (text(message.stopReason) === OMP_STOP_REASON.ERROR) {
    const reason = oneLine(text(message.errorMessage), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (reason) lines.push(transcriptLine.error(reason));
  }
  return lines;
}

/**
 * Finds the session's recording the way discovery does: the file whose name
 * ends in `_<id>.jsonl` inside one encoded-cwd directory, without trusting
 * the id as a path.
 */
async function transcriptFilePath(
  ompHome: string,
  providerSessionId: string,
): Promise<string | undefined> {
  if (!OMP_SESSION_ID_PATTERN.test(providerSessionId)) return undefined;
  const projectsDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY);
  for (const entry of await readDirectory(projectsDirectory)) {
    const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
    if (!projectDirectory?.stats.isDirectory()) continue;
    for (const file of await readDirectory(projectDirectory.directoryPath)) {
      if (sessionIdFromOmpFileName(file.name) !== providerSessionId) continue;
      const candidate = await statDirectoryEntry(projectDirectory.directoryPath, file.name);
      if (candidate?.stats.isFile()) return candidate.directoryPath;
    }
  }
  return undefined;
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no recording exists for that id.
 */
export async function readOmpSessionTranscript(
  request: OmpTranscriptRequest,
): Promise<string | undefined> {
  const filePath = await transcriptFilePath(request.ompHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  return boundedTranscript(
    tailRecords(tail).flatMap(linesFromRecord),
    request.maximumRenderedLength,
  );
}

/**
 * Renders what the session's recording has gained since `cursor`, or nothing
 * when no recording exists for that id.
 */
export async function readOmpSessionTranscriptSince(
  request: OmpTranscriptSinceRequest,
): Promise<ProviderTranscriptSinceReading | undefined> {
  const filePath = await request.pathCache.resolve(request.providerSessionId, () =>
    transcriptFilePath(request.ompHome, request.providerSessionId),
  );
  if (!filePath) return undefined;

  const since = await readRecordsSince(
    filePath,
    request.cursor,
    request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES,
  );
  return {
    text: boundedTranscript(since.records.flatMap(linesFromRecord)) ?? "",
    cursor: since.cursor,
    truncated: since.truncated,
  };
}
