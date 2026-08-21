import path from "node:path";
import { oneLine, text, type WireRecord } from "@sidecar/wire";
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
  defaultGrokBuildHome,
  GROK_SESSION_FILE,
  GROK_SESSIONS_DIRECTORY,
  GROK_SETTLED_TOOL_STATUSES,
  GROK_STOP_REASON,
  GROK_UPDATE_KIND,
  grokContentText,
  grokToolDetail,
  grokToolName,
  grokUpdateFrom,
  grokUpdateKind,
} from "./records.js";

/**
 * On-demand reading of one Grok Build session's transcript, for a question
 * the developer just asked. The `updates.jsonl` recording under the CLI's own
 * sessions store is the transcript — the same file the adapter reads its tail
 * from, here read deeper and rendered into a bounded conversation, and
 * discarded. Nothing here is retained, watched, or written; a session is
 * re-read the next time it is asked about.
 */

const GROK_SPEAKER_NAME = "Grok";

/**
 * The shape of the session ids the CLI mints — UUIDs, which its own
 * `--session-id` flag requires — kept tight enough that an id is never a
 * path: no separators, no dots, nothing relative.
 */
export const GROK_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrokBuildTranscriptRequest {
  grokHome?: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}

/** One message accumulated from its stream chunks, or one tool exchange. */
interface RenderedTurn {
  kind: string;
  words: string[];
}

function flushMessage(turn: RenderedTurn, lines: string[]): void {
  // Chunks are stream deltas of one message, so they join without separators.
  const words = oneLine(turn.words.join(""), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
  if (!words) return;
  if (turn.kind === GROK_UPDATE_KIND.USER_MESSAGE_CHUNK) {
    lines.push(transcriptLine.developer(words));
    return;
  }
  lines.push(transcriptLine.agent(GROK_SPEAKER_NAME, words));
}

function toolCallLine(update: WireRecord): string | undefined {
  const name = grokToolName(update);
  if (!name) return undefined;
  return transcriptLine.toolCall(
    name,
    grokToolDetail(update, TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH),
  );
}

/**
 * Only a settled call's recorded answer takes a line, and only the words the
 * CLI wrote into the update's content blocks; the raw output beside them is
 * the payload, not the gist.
 */
function toolResultLine(update: WireRecord): string | undefined {
  const status = text(update.status);
  if (status === undefined || !GROK_SETTLED_TOOL_STATUSES.has(status)) return undefined;
  const answer = oneLine(grokContentText(update.content), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
  return answer ? transcriptLine.toolResult(answer) : undefined;
}

function renderUpdates(updates: readonly WireRecord[]): string[] {
  const lines: string[] = [];
  let openMessage: RenderedTurn | undefined;
  const flushOpenMessage = () => {
    if (openMessage) flushMessage(openMessage, lines);
    openMessage = undefined;
  };

  for (const record of updates) {
    const update = grokUpdateFrom(record);
    if (!update) continue;
    const kind = grokUpdateKind(update);
    if (
      kind === GROK_UPDATE_KIND.USER_MESSAGE_CHUNK ||
      kind === GROK_UPDATE_KIND.AGENT_MESSAGE_CHUNK
    ) {
      if (openMessage?.kind !== kind) {
        flushOpenMessage();
        openMessage = { kind, words: [] };
      }
      const words = grokContentText(update.content);
      if (words !== undefined) openMessage?.words.push(words);
      continue;
    }
    flushOpenMessage();
    if (kind === GROK_UPDATE_KIND.TOOL_CALL) {
      const line = toolCallLine(update);
      if (line) lines.push(line);
      continue;
    }
    if (kind === GROK_UPDATE_KIND.TOOL_CALL_UPDATE) {
      const line = toolResultLine(update);
      if (line) lines.push(line);
      continue;
    }
    if (kind === GROK_UPDATE_KIND.TURN_COMPLETED) {
      if (text(update.stop_reason) !== GROK_STOP_REASON.ERROR) continue;
      const reason = oneLine(text(update.agent_result), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (reason) lines.push(transcriptLine.error(reason));
    }
  }
  flushOpenMessage();
  return lines;
}

/**
 * Finds the session's recording the way discovery does — the directory named
 * by the session's own id, directly inside one working-directory directory —
 * without trusting the id as a path: an id outside the shape the CLI mints
 * names nothing.
 */
async function transcriptFilePath(
  grokHome: string,
  providerSessionId: string,
): Promise<string | undefined> {
  if (!GROK_SESSION_ID_PATTERN.test(providerSessionId)) return undefined;
  const projectsDirectory = path.join(grokHome, GROK_SESSIONS_DIRECTORY);
  for (const entry of await readDirectory(projectsDirectory)) {
    const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
    if (!projectDirectory?.stats.isDirectory()) continue;
    const sessionDirectory = await statDirectoryEntry(
      projectDirectory.directoryPath,
      providerSessionId,
    );
    if (!sessionDirectory?.stats.isDirectory()) continue;
    const candidate = await statDirectoryEntry(
      sessionDirectory.directoryPath,
      GROK_SESSION_FILE.UPDATES,
    );
    if (candidate?.stats.isFile()) return candidate.directoryPath;
  }
  return undefined;
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no recording exists for that id.
 */
export async function readGrokBuildSessionTranscript(
  request: GrokBuildTranscriptRequest,
): Promise<string | undefined> {
  const grokHome = request.grokHome ?? defaultGrokBuildHome();
  const filePath = await transcriptFilePath(grokHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = renderUpdates(tailRecords(tail));
  return boundedTranscript(
    lines,
    request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
  );
}
