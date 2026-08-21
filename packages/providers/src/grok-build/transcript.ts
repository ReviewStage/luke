import path from "node:path";
import { isRecord, oneLine, recordFromJsonLine, text, type WireRecord } from "@sidecar/wire";
import {
  readDirectory,
  readTail,
  statDirectoryEntry,
  tailRecords,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  defaultGrokBuildHome,
  GROK_DATABASE_FILE,
  GROK_MESSAGE_COLUMN,
  GROK_MESSAGE_PART,
  GROK_MESSAGE_ROLE,
  GROK_SESSION_FILE,
  GROK_SESSIONS_DIRECTORY,
  GROK_SETTLED_TOOL_STATUSES,
  GROK_STOP_REASON,
  GROK_UPDATE_KIND,
  grokContentText,
  grokMessageParts,
  grokMessageText,
  grokToolDetail,
  grokToolInputDetail,
  grokToolName,
  grokToolResultText,
  grokUpdateFrom,
  grokUpdateKind,
} from "./records.js";

/**
 * On-demand reading of one Grok Build session's transcript, for a question
 * the developer just asked. The conversation the CLI already stores is the
 * transcript — the `messages` rows of its database, or the `updates.jsonl`
 * recording of the directory store before it — read bounded, rendered into a
 * bounded conversation, and discarded. Nothing here is retained, watched, or
 * written; a session is re-read the next time it is asked about.
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
  sqlite?: SqliteModuleLoader;
}

/** How many stored messages one transcript read may load, newest first. */
const GROK_TRANSCRIPT_MESSAGE_LIMIT = 200;

const GROK_TRANSCRIPT_MESSAGES_QUERY = `
  SELECT role, message_json
  FROM messages
  WHERE session_id = ?
  ORDER BY seq DESC
  LIMIT ?
`;

function linesFromStoredMessage(role: string | undefined, message: WireRecord): string[] {
  if (role === GROK_MESSAGE_ROLE.USER) {
    const prompt = oneLine(grokMessageText(message), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    return prompt ? [transcriptLine.developer(prompt)] : [];
  }
  if (role === GROK_MESSAGE_ROLE.ASSISTANT) {
    const lines: string[] = [];
    const words = oneLine(grokMessageText(message), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
    if (words) lines.push(transcriptLine.agent(GROK_SPEAKER_NAME, words));
    for (const part of grokMessageParts(message)) {
      if (text(part.type) !== GROK_MESSAGE_PART.TOOL_CALL) continue;
      const name = text(part.toolName);
      if (!name) continue;
      const input = isRecord(part.input) ? part.input : undefined;
      const detail = input
        ? grokToolInputDetail(input, TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
        : undefined;
      lines.push(transcriptLine.toolCall(name, detail));
    }
    return lines;
  }
  if (role === GROK_MESSAGE_ROLE.TOOL) {
    return grokMessageParts(message)
      .filter((part) => text(part.type) === GROK_MESSAGE_PART.TOOL_RESULT)
      .map((part) => oneLine(grokToolResultText(part), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH))
      .filter((answer): answer is string => answer !== undefined)
      .map((answer) => transcriptLine.toolResult(answer));
  }
  return [];
}

/**
 * The session's recent conversation out of the database, rendered — or
 * nothing when no database exists, it holds no such session, or its schema is
 * not one this build reads.
 */
async function databaseTranscript(
  grokHome: string,
  providerSessionId: string,
  sqlite: SqliteModuleLoader,
  maximumRenderedLength: number,
): Promise<string | undefined> {
  const database = await openReadOnlyDatabase(sqlite, path.join(grokHome, GROK_DATABASE_FILE));
  if (!database) return undefined;
  try {
    const rows = messageRows(database, providerSessionId);
    if (rows.length === 0) return undefined;
    const lines = [...rows]
      .reverse()
      .flatMap((row) =>
        linesFromStoredMessage(
          textFromRow(row, GROK_MESSAGE_COLUMN.ROLE),
          recordFromJsonLine(textFromRow(row, GROK_MESSAGE_COLUMN.MESSAGE_JSON) ?? "") ?? {},
        ),
      );
    return boundedTranscript(lines, maximumRenderedLength);
  } finally {
    database.close();
  }
}

function messageRows(database: SqliteDatabase, providerSessionId: string): WireRecord[] {
  try {
    return database
      .prepare(GROK_TRANSCRIPT_MESSAGES_QUERY)
      .all(providerSessionId, GROK_TRANSCRIPT_MESSAGE_LIMIT)
      .filter(isRecord);
  } catch (error) {
    if (error instanceof Error && canIgnoreSqliteError(error)) return [];
    throw error;
  }
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
 * when no store holds a recording for that id: the database's own rows when
 * it knows the session, the legacy directory recording otherwise.
 */
export async function readGrokBuildSessionTranscript(
  request: GrokBuildTranscriptRequest,
): Promise<string | undefined> {
  const grokHome = request.grokHome ?? defaultGrokBuildHome();
  const maximumRenderedLength =
    request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH;
  const fromDatabase = await databaseTranscript(
    grokHome,
    request.providerSessionId,
    request.sqlite ?? defaultSqliteModule,
    maximumRenderedLength,
  );
  if (fromDatabase !== undefined) return fromDatabase;

  const filePath = await transcriptFilePath(grokHome, request.providerSessionId);
  if (!filePath) return undefined;

  const tail = await readTail(filePath, request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
  const lines = renderUpdates(tailRecords(tail));
  return boundedTranscript(lines, maximumRenderedLength);
}
