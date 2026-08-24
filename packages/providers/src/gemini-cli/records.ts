import os from "node:os";
import path from "node:path";
import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { LOCAL_TOOL_ARGUMENT_KEYS } from "../shared/tool-arguments.js";

/**
 * The vocabulary of Gemini CLI's session recordings, shared by the adapter
 * that observes their tails and the transcript read that renders them. A
 * session file is not a transcript to read top to bottom: a `$set` line
 * updates the session's metadata, a `$rewindTo` line drops a message and
 * everything after it, and a message line whose id was already seen
 * supersedes the earlier one. Anything reading these files must replay them
 * the way the CLI's own resume does.
 */

/**
 * Gemini CLI's own home override: its `homedir()` answers `GEMINI_CLI_HOME`
 * before the OS home, and `.gemini` is joined onto whichever answered.
 */
const GEMINI_ENVIRONMENT = { HOME: "GEMINI_CLI_HOME" } as const;
const GEMINI_DIRECTORY_NAME = ".gemini";

export const GEMINI_TMP_DIRECTORY = "tmp";
export const GEMINI_CHATS_DIRECTORY = "chats";

/**
 * Only the append-only JSONL recording format is read. Gemini CLI wrote each
 * session as one whole JSON document before April 2026; a conversation that
 * size cannot be read boundedly, and the CLI itself rewrites such a file into
 * JSONL when it is resumed, so the old shape keeps the honest refusal rather
 * than a partial parse.
 */
export const GEMINI_SESSION_FILE_EXTENSION = ".jsonl";

export function defaultGeminiCliHome(): string {
  const configured = process.env[GEMINI_ENVIRONMENT.HOME]?.trim();
  return path.join(configured || os.homedir(), GEMINI_DIRECTORY_NAME);
}

export const GEMINI_MESSAGE_TYPE = {
  USER: "user",
  GEMINI: "gemini",
  ERROR: "error",
  INFO: "info",
  WARNING: "warning",
} as const;

const GEMINI_REPLAY_KEY = {
  SET: "$set",
  REWIND_TO: "$rewindTo",
} as const;

export const GEMINI_TOOL_CALL_STATUS = {
  VALIDATING: "validating",
  SCHEDULED: "scheduled",
  EXECUTING: "executing",
  AWAITING_APPROVAL: "awaiting_approval",
  SUCCESS: "success",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

/** A tool call that has not settled is the work the session is doing now. */
export const GEMINI_OPEN_TOOL_STATUSES: ReadonlySet<string> = new Set([
  GEMINI_TOOL_CALL_STATUS.VALIDATING,
  GEMINI_TOOL_CALL_STATUS.SCHEDULED,
  GEMINI_TOOL_CALL_STATUS.EXECUTING,
]);

/**
 * Tool inputs whose value names the work, in the order they read best. The
 * set matches what the other local adapters report — a URL is deliberately
 * not in it, because a signed URL is a credential and no other adapter sends
 * one anywhere; a fetch is named by its tool alone.
 */
export const GEMINI_TOOL_INPUT_KEY = LOCAL_TOOL_ARGUMENT_KEYS;

/** The words inside a Gemini content value: a string, a part, or a part list. */
export function geminiContentText(content: UnparsedWireValue): string | undefined {
  if (isWireString(content)) return text(content);
  const parts = Array.isArray(content) ? content : isRecord(content) ? [content] : [];
  const words = parts
    .filter(isRecord)
    .map((part) => text(part.text))
    .filter((part): part is string => part !== undefined);
  return words.length > 0 ? words.join(" ") : undefined;
}

/** A message line is the one record kind that carries its own string id. */
export function isGeminiMessageRecord(record: WireRecord): boolean {
  return isWireString(record.id) && isWireString(record.type);
}

export function geminiToolCallsFrom(record: WireRecord): WireRecord[] {
  return Array.isArray(record.toolCalls) ? record.toolCalls.filter(isRecord) : [];
}

export interface GeminiReplay {
  summary?: string;
  /** The conversation as it stands after supersedes and rewinds, oldest first. */
  messages: readonly WireRecord[];
}

/**
 * Replays a slice of a session file into the conversation it describes. A
 * superseded message keeps its place — the CLI re-appends a message line to
 * merge tool-call updates into it, not to move it. A rewind whose target sits
 * before the slice began drops everything replayed so far, because the
 * messages in hand are the newest and a rewind only ever drops from the
 * newest backwards.
 */
export function replayGeminiRecords(records: readonly WireRecord[]): GeminiReplay {
  let summary: string | undefined;
  let order: string[] = [];
  const byId = new Map<string, WireRecord>();

  for (const record of records) {
    const set = record[GEMINI_REPLAY_KEY.SET];
    if (isRecord(set)) {
      summary = text(set.summary) ?? summary;
      continue;
    }
    const rewindTo = text(record[GEMINI_REPLAY_KEY.REWIND_TO]);
    if (rewindTo !== undefined) {
      const index = order.indexOf(rewindTo);
      const kept = index >= 0 ? order.slice(0, index) : [];
      for (const dropped of order.slice(kept.length)) byId.delete(dropped);
      order = kept;
      continue;
    }
    if (!isGeminiMessageRecord(record)) continue;
    const id = text(record.id);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, record);
  }

  return {
    summary,
    messages: order
      .map((id) => byId.get(id))
      .filter((record): record is WireRecord => record !== undefined),
  };
}
