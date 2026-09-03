import { ACT_RESULT_STATUS, type ProviderTranscriptSinceResult } from "@sidecar/session";
import {
  isRecord,
  isWireString,
  oneLine,
  recordFromJsonLine,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { readTail, tailRecords } from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import {
  boundedTranscript,
  readRecordsSince,
  TRANSCRIPT_BOUNDS,
  type TranscriptPathCache,
  transcriptLine,
} from "../shared/local-transcript.js";
import {
  argumentPhrase,
  CODEX_CALL_ARGUMENT_KEY,
  defaultCodexHome,
  stateDatabasePaths,
} from "./adapter.js";

/**
 * On-demand reading of one Codex session's transcript, for a question the
 * developer just asked. The rollout JSONL named by the thread's own
 * `rollout_path` is the transcript — the same file the adapter already reads
 * a boundary event from, and the one the hook envelope's `transcript_path`
 * names — so this reads it the way the adapter reads its tail, only deeper: a
 * bounded slice, parsed in memory, rendered into a bounded conversation, and
 * discarded. Nothing here is retained, watched, or written; a session is
 * re-read the next time it is asked about.
 */

const CODEX_SPEAKER_NAME = "Codex";

/** The rollout line kinds a rendering reads; everything else is bookkeeping. */
const CODEX_ROLLOUT_LINE_TYPE = {
  RESPONSE_ITEM: "response_item",
  EVENT_MSG: "event_msg",
} as const;

/**
 * The response items a conversation is made of. Messages and calls are read
 * from these alone — the `event_msg` lines duplicate them for Codex's own
 * UI, and rendering both would say everything twice.
 */
const CODEX_ITEM_TYPE = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  CUSTOM_TOOL_CALL: "custom_tool_call",
  CUSTOM_TOOL_CALL_OUTPUT: "custom_tool_call_output",
  LOCAL_SHELL_CALL: "local_shell_call",
  WEB_SEARCH_CALL: "web_search_call",
} as const;

const CODEX_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

/** The one event kind rendered: the failure that ended a turn early. */
const CODEX_EVENT_TYPE = {
  ERROR: "error",
  TASK_COMPLETE: "task_complete",
} as const;

/**
 * The marker Codex writes between its injected context and the words the
 * developer actually typed, when it folds both into one user message.
 */
const CODEX_USER_MESSAGE_MARKER = "## My request for Codex:";

/**
 * A user message that is entirely one XML-tagged block is Codex's own
 * scaffolding — instructions, environment context, and their relatives —
 * not something the developer said.
 */
const CODEX_SCAFFOLDING_PATTERN = /^<([a-z_]+)>[\s\S]*<\/\1>$/;

const CODEX_ROLLOUT_TAIL_BYTES = TRANSCRIPT_BOUNDS.READ_TAIL_BYTES;

const CODEX_THREAD_ROLLOUT_QUERY = `
  SELECT rollout_path
  FROM threads
  WHERE id = ?
`;

export interface CodexTranscriptRequest {
  codexHome?: string;
  sqliteHome?: string;
  providerSessionId: string;
  sqlite?: SqliteModuleLoader;
  maximumRenderedLength?: number;
}

export interface CodexTranscriptSinceRequest extends CodexTranscriptRequest {
  cursor?: string;
  pathCache: TranscriptPathCache;
}

const CODEX_COMPRESSED_ROLLOUT_EXTENSION = ".zst";

/** The words of one message's content blocks, whichever direction they face. */
function messageWords(content: UnparsedWireValue): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter(isRecord)
    .filter((block) => block.type === "input_text" || block.type === "output_text")
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The developer's own words in a user message, or nothing when the message is
 * Codex's scaffolding. Codex wraps instructions and environment context in
 * XML-tagged user messages, and sometimes folds context and prompt into one
 * message with a marker between them; only what follows the marker — or the
 * whole message when there is neither wrapper nor marker — was typed.
 */
function developerWords(words: string): string | undefined {
  const markerIndex = words.indexOf(CODEX_USER_MESSAGE_MARKER);
  if (markerIndex >= 0) {
    return text(words.slice(markerIndex + CODEX_USER_MESSAGE_MARKER.length));
  }
  if (CODEX_SCAFFOLDING_PATTERN.test(words.trim())) return undefined;
  return text(words);
}

/** Names the tool Codex called, preferring whichever argument says what it is for. */
function callLine(payload: WireRecord): string | undefined {
  const name = text(payload.name);
  if (!name) return undefined;
  const argumentText = text(payload.arguments);
  const parsedArguments = argumentText ? recordFromJsonLine(argumentText) : undefined;
  for (const key of CODEX_CALL_ARGUMENT_KEY) {
    const detail = oneLine(
      argumentPhrase(parsedArguments?.[key]),
      TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
    );
    if (detail) return transcriptLine.toolCall(name, detail);
  }
  return transcriptLine.toolCall(name);
}

/**
 * The words a call answered with, wherever this build finds them. Codex wrote
 * the output as a plain string for years, then as a list of text blocks; the
 * string itself often holds one more JSON layer whose `output` key carries
 * the human-readable text of a shell call.
 */
function callOutputText(output: UnparsedWireValue): string | undefined {
  if (isWireString(output)) {
    const wrapped = recordFromJsonLine(output);
    if (wrapped && isWireString(wrapped.output)) return text(wrapped.output);
    return text(output);
  }
  if (Array.isArray(output)) {
    const parts = output
      .filter(isRecord)
      .filter((block) => block.type === "input_text")
      .map((block) => text(block.text))
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  return undefined;
}

function linesFromResponseItem(payload: WireRecord): string[] {
  if (payload.type === CODEX_ITEM_TYPE.MESSAGE) {
    const words = messageWords(payload.content);
    if (!words) return [];
    if (payload.role === CODEX_MESSAGE_ROLE.USER) {
      const typed = oneLine(developerWords(words), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      return typed ? [transcriptLine.developer(typed)] : [];
    }
    if (payload.role === CODEX_MESSAGE_ROLE.ASSISTANT) {
      const said = oneLine(words, TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      return said ? [transcriptLine.agent(CODEX_SPEAKER_NAME, said)] : [];
    }
    return [];
  }
  if (payload.type === CODEX_ITEM_TYPE.FUNCTION_CALL) {
    const line = callLine(payload);
    return line ? [line] : [];
  }
  if (payload.type === CODEX_ITEM_TYPE.CUSTOM_TOOL_CALL) {
    const name = text(payload.name);
    if (!name) return [];
    const detail = oneLine(text(payload.input), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return [transcriptLine.toolCall(name, detail)];
  }
  if (
    payload.type === CODEX_ITEM_TYPE.FUNCTION_CALL_OUTPUT ||
    payload.type === CODEX_ITEM_TYPE.CUSTOM_TOOL_CALL_OUTPUT
  ) {
    const answer = oneLine(callOutputText(payload.output), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return answer ? [transcriptLine.toolResult(answer)] : [];
  }
  if (payload.type === CODEX_ITEM_TYPE.LOCAL_SHELL_CALL) {
    const action = isRecord(payload.action) ? payload.action : undefined;
    const command = oneLine(argumentPhrase(action?.command), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return [transcriptLine.toolCall("shell", command)];
  }
  if (payload.type === CODEX_ITEM_TYPE.WEB_SEARCH_CALL) {
    const action = isRecord(payload.action) ? payload.action : undefined;
    const query = oneLine(text(action?.query), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return [transcriptLine.toolCall("web_search", query)];
  }
  return [];
}

/**
 * The failure an event line recorded, when it recorded one. Errors ride
 * `task_complete` in current builds and stood alone in older ones; either
 * way the message is the one thing worth a line, because the response items
 * around it never say why a turn stopped.
 */
function linesFromEvent(payload: WireRecord): string[] {
  if (payload.type === CODEX_EVENT_TYPE.ERROR) {
    const words = oneLine(text(payload.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return words ? [transcriptLine.error(words)] : [];
  }
  if (payload.type === CODEX_EVENT_TYPE.TASK_COMPLETE && isRecord(payload.error)) {
    const words = oneLine(text(payload.error.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
    return words ? [transcriptLine.error(words)] : [];
  }
  return [];
}

/** Renders one rollout line into the lines a conversation can carry. */
function linesFromRecord(record: WireRecord): string[] {
  const payload = isRecord(record.payload) ? record.payload : undefined;
  if (!payload) return [];
  if (record.type === CODEX_ROLLOUT_LINE_TYPE.RESPONSE_ITEM) {
    return linesFromResponseItem(payload);
  }
  if (record.type === CODEX_ROLLOUT_LINE_TYPE.EVENT_MSG) return linesFromEvent(payload);
  return [];
}

/**
 * Finds the session's rollout file the way observation does: named by the
 * thread's own row in the state database, read through a parameterized
 * lookup, never composed from the id. A compressed rollout is named as it
 * stands, for each reader to refuse in its own words: a bounded window cannot
 * be cut from one.
 */
async function rolloutPathForThread(request: CodexTranscriptRequest): Promise<string | undefined> {
  const codexHome = request.codexHome ?? defaultCodexHome();
  const sqlite = request.sqlite ?? defaultSqliteModule;
  for (const databasePath of await stateDatabasePaths(codexHome, request.sqliteHome)) {
    const database = await openReadOnlyDatabase(sqlite, databasePath);
    if (!database) continue;
    try {
      const row = database.prepare(CODEX_THREAD_ROLLOUT_QUERY).all(request.providerSessionId)[0];
      const rolloutPath = isRecord(row) ? text(row.rollout_path) : undefined;
      if (rolloutPath) return rolloutPath;
    } catch (error) {
      if (!(error instanceof Error) || !canIgnoreSqliteError(error)) throw error;
    } finally {
      database.close();
    }
  }
  return undefined;
}

function isCompressedRollout(rolloutPath: string): boolean {
  return rolloutPath.endsWith(CODEX_COMPRESSED_ROLLOUT_EXTENSION);
}

/**
 * Reads one session's recent transcript into a bounded rendering, or nothing
 * when no rollout file exists for that id or the rollout is compressed.
 */
export async function readCodexSessionTranscript(
  request: CodexTranscriptRequest,
): Promise<string | undefined> {
  const rolloutPath = await rolloutPathForThread(request);
  if (!rolloutPath || isCompressedRollout(rolloutPath)) return undefined;

  const tail = await readTail(rolloutPath, CODEX_ROLLOUT_TAIL_BYTES);
  const lines = tailRecords(tail).flatMap(linesFromRecord);
  return boundedTranscript(lines, request.maximumRenderedLength);
}

/**
 * Renders what the session's rollout has gained since `cursor`. A thread with
 * no rollout file answers rejected, and a compressed rollout unsupported: it
 * is a transcript this build cannot walk, not one that went missing.
 */
export async function readCodexSessionTranscriptSince(
  request: CodexTranscriptSinceRequest,
): Promise<ProviderTranscriptSinceResult> {
  const rolloutPath = await request.pathCache.resolve(request.providerSessionId, () =>
    rolloutPathForThread(request),
  );
  if (!rolloutPath) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session's transcript could not be found.",
    };
  }
  if (isCompressedRollout(rolloutPath)) {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "That session's rollout is compressed, which this build cannot read incrementally.",
    };
  }

  const since = await readRecordsSince(rolloutPath, request.cursor, CODEX_ROLLOUT_TAIL_BYTES);
  return {
    status: ACT_RESULT_STATUS.ACCEPTED,
    text: boundedTranscript(since.records.flatMap(linesFromRecord)) ?? "",
    cursor: since.cursor,
    truncated: since.truncated,
  };
}
