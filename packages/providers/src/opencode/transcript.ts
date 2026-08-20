import { isRecord, oneLine, recordFromJsonLine, text, type WireRecord } from "@sidecar/wire";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import {
  boundedTranscript,
  TRANSCRIPT_BOUNDS,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  defaultOpenCodeDataDirectory,
  OPENCODE_TOOL_INPUT_KEY,
  openCodeDatabasePaths,
} from "./adapter.js";

/**
 * On-demand reading of one OpenCode session's transcript, for a question the
 * developer just asked. The message and part rows in OpenCode's own database
 * are the transcript — the same tables the adapter reads bookkeeping from,
 * here opened for their words: a bounded slice of the newest messages, read
 * through parameterized point queries against the read-only handle, rendered
 * into a bounded conversation, and discarded. Nothing here is retained,
 * watched, or written; a session is re-read the next time it is asked about.
 *
 * Installs from before OpenCode moved its sessions into the database keep
 * their conversations in per-part JSON files this build does not read, so a
 * legacy session answers as no transcript rather than a partial one.
 */

const OPENCODE_SPEAKER_NAME = "OpenCode";

const OPENCODE_DATA_COLUMN = "data";

const OPENCODE_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

const OPENCODE_PART_TYPE = {
  TEXT: "text",
  TOOL: "tool",
} as const;

/** The tool states whose bookkeeping carries an answer worth a line. */
const OPENCODE_TOOL_STATUS = {
  COMPLETED: "completed",
  ERROR: "error",
} as const;

/**
 * The error OpenCode records when its own user stops a turn. A stopped turn
 * is something the developer did, not something that happened to them, so it
 * takes no error line.
 */
const OPENCODE_ABORT_ERROR_NAME = "MessageAbortedError";

const OPENCODE_TRANSCRIPT_BOUNDS = {
  /** How many of the session's newest messages one read may load. */
  MAXIMUM_MESSAGES: 40,
  /** How many of a message's parts one read may load. */
  MAXIMUM_PARTS: 32,
} as const;

/** Newest first, so the bound keeps the turns the question is about. */
const OPENCODE_RECENT_MESSAGE_QUERY = `
  SELECT *
  FROM message
  WHERE session_id = ?
  ORDER BY time_created DESC, id DESC
  LIMIT ?
`;

// Newest first here too: a tool-heavy turn can outgrow the bound, and the
// concluding words sit on its newest parts. Ordered by the row's own clock
// before its id, like every other query over these tables — ids sort in
// creation order only until their timestamp half wraps — and put back in the
// order they were said before rendering.
const OPENCODE_MESSAGE_PART_QUERY = `
  SELECT *
  FROM part
  WHERE message_id = ?
  ORDER BY time_created DESC, id DESC
  LIMIT ?
`;

type OpenCodeRow = WireRecord;

export interface OpenCodeTranscriptRequest {
  dataDirectory?: string;
  providerSessionId: string;
  sqlite?: SqliteModuleLoader;
  maximumRenderedLength?: number;
}

function rowData(row: OpenCodeRow): WireRecord | undefined {
  return recordFromJsonLine(text(row[OPENCODE_DATA_COLUMN]) ?? "");
}

function toolLine(part: WireRecord): string[] {
  const name = text(part.tool);
  if (!name) return [];
  const state = isRecord(part.state) ? part.state : {};
  const input = isRecord(state.input) ? state.input : {};
  let call = transcriptLine.toolCall(name);
  for (const key of OPENCODE_TOOL_INPUT_KEY) {
    const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    if (detail) {
      call = transcriptLine.toolCall(name, detail);
      break;
    }
  }
  const answer =
    state.status === OPENCODE_TOOL_STATUS.COMPLETED
      ? oneLine(text(state.output), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
      : state.status === OPENCODE_TOOL_STATUS.ERROR
        ? oneLine(text(state.error), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
        : undefined;
  return answer ? [call, transcriptLine.toolResult(answer)] : [call];
}

/**
 * The failure that ended a message's turn early, in the provider's words. An
 * abort is left out: the developer stopping a turn is not news to them.
 */
function errorLine(data: WireRecord): string | undefined {
  const error = isRecord(data.error) ? data.error : undefined;
  if (!error || error.name === OPENCODE_ABORT_ERROR_NAME) return undefined;
  const errorData = isRecord(error.data) ? error.data : undefined;
  const words = oneLine(
    text(errorData?.message) ?? text(error.name),
    TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
  );
  return words ? transcriptLine.error(words) : undefined;
}

/**
 * Renders one message and its parts into the lines a conversation can carry.
 * A text part's words are the message's own — the role rides the message row,
 * not the part — and a synthetic or ignored text part is OpenCode's own
 * scaffolding, not something anyone said.
 */
function linesFromMessage(data: WireRecord, parts: readonly OpenCodeRow[]): string[] {
  const role = text(data.role);
  if (role !== OPENCODE_MESSAGE_ROLE.USER && role !== OPENCODE_MESSAGE_ROLE.ASSISTANT) return [];
  const lines: string[] = [];
  const spokenParts: string[] = [];
  for (const row of parts) {
    const part = rowData(row);
    if (!part) continue;
    if (part.type === OPENCODE_PART_TYPE.TEXT) {
      if (part.synthetic === true || part.ignored === true) continue;
      const words = text(part.text);
      if (words) spokenParts.push(words);
      continue;
    }
    if (part.type === OPENCODE_PART_TYPE.TOOL && role === OPENCODE_MESSAGE_ROLE.ASSISTANT) {
      lines.push(...toolLine(part));
    }
  }
  const said = oneLine(spokenParts.join(" "), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
  if (said) {
    lines.unshift(
      role === OPENCODE_MESSAGE_ROLE.USER
        ? transcriptLine.developer(said)
        : transcriptLine.agent(OPENCODE_SPEAKER_NAME, said),
    );
  }

  const failure = errorLine(data);
  if (failure) lines.push(failure);
  return lines;
}

function readRows(
  database: SqliteDatabase,
  query: string,
  parameters: readonly unknown[],
): OpenCodeRow[] {
  try {
    return database
      .prepare(query)
      .all(...parameters)
      .filter((row): row is OpenCodeRow => isRecord(row));
  } catch (error) {
    if (error instanceof Error && canIgnoreSqliteError(error)) return [];
    throw error;
  }
}

function renderedFromDatabase(
  database: SqliteDatabase,
  providerSessionId: string,
  maximumLength: number,
): string | undefined {
  const messages = readRows(database, OPENCODE_RECENT_MESSAGE_QUERY, [
    providerSessionId,
    OPENCODE_TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGES,
  ]).toReversed();
  const lines = messages.flatMap((message) => {
    const data = rowData(message);
    const messageId = text(message.id);
    if (!data || !messageId) return [];
    const parts = readRows(database, OPENCODE_MESSAGE_PART_QUERY, [
      messageId,
      OPENCODE_TRANSCRIPT_BOUNDS.MAXIMUM_PARTS,
    ]).toReversed();
    return linesFromMessage(data, parts);
  });
  return boundedTranscript(lines, maximumLength);
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no database holds messages for that id.
 */
export async function readOpenCodeSessionTranscript(
  request: OpenCodeTranscriptRequest,
): Promise<string | undefined> {
  const dataDirectory = request.dataDirectory ?? defaultOpenCodeDataDirectory();
  const sqlite = request.sqlite ?? defaultSqliteModule;
  for (const databasePath of openCodeDatabasePaths(dataDirectory)) {
    const database = await openReadOnlyDatabase(sqlite, databasePath);
    if (!database) continue;
    try {
      const rendered = renderedFromDatabase(
        database,
        request.providerSessionId,
        request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
      );
      if (rendered) return rendered;
    } finally {
      database.close();
    }
  }
  return undefined;
}
