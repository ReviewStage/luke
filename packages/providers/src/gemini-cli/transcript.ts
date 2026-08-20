import path from "node:path";
import { isRecord, isWireString, oneLine, text, type WireRecord } from "@sidecar/wire";
import {
  readDirectory,
  readTail,
  statDirectoryEntry,
  tailRecords,
} from "../shared/local-session-adapter.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  defaultGeminiCliHome,
  GEMINI_CHATS_DIRECTORY,
  GEMINI_MESSAGE_TYPE,
  GEMINI_SESSION_FILE_EXTENSION,
  GEMINI_TMP_DIRECTORY,
  GEMINI_TOOL_CALL_STATUS,
  GEMINI_TOOL_INPUT_KEY,
  geminiContentText,
  geminiToolCallsFrom,
  replayGeminiRecords,
} from "./records.js";

/**
 * On-demand reading of one Gemini CLI session's transcript, for a question
 * the developer just asked. The JSONL recording under the CLI's own chats
 * directories is the transcript — the same files the adapter reads its tail
 * from, here read deeper and replayed the way the CLI's own resume replays
 * them: a bounded slice, superseded lines folded and rewinds honored in
 * memory, rendered into a bounded conversation, and discarded. Nothing here
 * is retained, watched, or written; a session is re-read the next time it is
 * asked about.
 */

const GEMINI_SPEAKER_NAME = "Gemini";

/**
 * The shape of the file names Gemini CLI mints — `session-<timestamp>-<id8>`
 * — kept loose enough for the shapes it has minted before, and tight enough
 * that an id is never a path: no separators, no dots, nothing relative.
 */
const GEMINI_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface GeminiTranscriptRequest {
  geminiHome?: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

/** The tool states whose bookkeeping carries an answer worth a line. */
const GEMINI_SETTLED_TOOL_STATUS = {
  SUCCESS: GEMINI_TOOL_CALL_STATUS.SUCCESS,
  ERROR: GEMINI_TOOL_CALL_STATUS.ERROR,
} as const;

function toolLines(call: WireRecord): string[] {
  const name = text(call.displayName) ?? text(call.name);
  if (!name) return [];
  const args = isRecord(call.args) ? call.args : {};
  const detail =
    oneLine(text(call.description), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH) ??
    GEMINI_TOOL_INPUT_KEY.map((key) =>
      oneLine(text(args[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH),
    ).find((candidate) => candidate !== undefined);
  const lines = [transcriptLine.toolCall(name, detail)];

  // Only a settled call's display answer is rendered, and only when the CLI
  // wrote it as words: a structured display — a diff, a directory listing —
  // is a shape this rendering cannot carry faithfully, so it takes no line.
  const status = text(call.status);
  if (
    status === GEMINI_SETTLED_TOOL_STATUS.SUCCESS ||
    status === GEMINI_SETTLED_TOOL_STATUS.ERROR
  ) {
    const answer = isWireString(call.resultDisplay)
      ? oneLine(text(call.resultDisplay), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
      : undefined;
    if (answer) lines.push(transcriptLine.toolResult(answer));
  }
  return lines;
}

/** Renders one replayed message into the lines a conversation can carry. */
function linesFromMessage(message: WireRecord): string[] {
  const type = text(message.type);
  if (type === GEMINI_MESSAGE_TYPE.USER) {
    const prompt = oneLine(
      geminiContentText(message.content),
      TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
    );
    return prompt ? [transcriptLine.developer(prompt)] : [];
  }
  if (type === GEMINI_MESSAGE_TYPE.GEMINI) {
    const lines: string[] = [];
    const words = oneLine(
      geminiContentText(message.content),
      TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH,
    );
    if (words) lines.push(transcriptLine.agent(GEMINI_SPEAKER_NAME, words));
    for (const call of geminiToolCallsFrom(message)) lines.push(...toolLines(call));
    return lines;
  }
  if (type === GEMINI_MESSAGE_TYPE.ERROR) {
    const words = oneLine(
      geminiContentText(message.content),
      TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
    );
    return words ? [transcriptLine.error(words)] : [];
  }
  return [];
}

/**
 * Finds the session's recording the way discovery does — the file named by
 * the session's own file stem, directly inside one project's chats directory
 * — without trusting the id as a path: an id outside the shape Gemini CLI
 * mints names nothing.
 */
async function transcriptFilePath(
  geminiHome: string,
  providerSessionId: string,
): Promise<string | undefined> {
  if (!GEMINI_SESSION_ID_PATTERN.test(providerSessionId)) return undefined;
  const projectsDirectory = path.join(geminiHome, GEMINI_TMP_DIRECTORY);
  const fileName = `${providerSessionId}${GEMINI_SESSION_FILE_EXTENSION}`;
  for (const entry of await readDirectory(projectsDirectory)) {
    const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
    if (!projectDirectory?.stats.isDirectory()) continue;
    const candidate = await statDirectoryEntry(
      path.join(projectDirectory.directoryPath, GEMINI_CHATS_DIRECTORY),
      fileName,
    );
    if (candidate?.stats.isFile()) return candidate.directoryPath;
  }
  return undefined;
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no recording exists for that id.
 */
export async function readGeminiSessionTranscript(
  request: GeminiTranscriptRequest,
): Promise<string | undefined> {
  const geminiHome = request.geminiHome ?? defaultGeminiCliHome();
  const filePath = await transcriptFilePath(geminiHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = replayGeminiRecords(tailRecords(tail)).messages.flatMap(linesFromMessage);
  return boundedTranscript(
    lines,
    request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
  );
}
