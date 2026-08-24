import os from "node:os";
import path from "node:path";
import {
  isRecord,
  isWireString,
  oneLine,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { LOCAL_TOOL_ARGUMENT_KEYS } from "../shared/tool-arguments.js";

/**
 * The vocabulary of Grok Build's session stores, shared by the adapter that
 * observes them and the transcript read that renders them. The CLI has kept
 * sessions in two shapes. Since 1.1.x everything lives in one SQLite database,
 * `~/.grok/grok.db`: a `sessions` row carries the title, the recap the CLI
 * writes itself, the model, and the working directory, and the newest
 * `messages` row answers whose move it is. The 1.0.x releases kept each
 * session as a directory under `~/.grok/sessions/<percent-encoded-cwd>/`
 * instead, holding three recordings: `summary.json`, the session's metadata;
 * `events.jsonl`, the turn lifecycle (phases, permission prompts, turn
 * outcomes); and `updates.jsonl`, the conversation as ACP `session/update`
 * notifications. A machine whose CLI has written the database answers from
 * it alone; the directories are read only where no database exists.
 */

/**
 * Grok Build's own home override: `GROK_HOME` names the directory the CLI
 * keeps everything in — the sessions store included — standing in for
 * `~/.grok` whole rather than re-rooting it.
 */
const GROK_ENVIRONMENT = { HOME: "GROK_HOME" } as const;
const GROK_DIRECTORY_NAME = ".grok";

/** Where the CLI keeps every session since 1.1.x. */
export const GROK_DATABASE_FILE = "grok.db";

export const GROK_SESSIONS_DIRECTORY = "sessions";

export const GROK_SESSION_FILE = {
  SUMMARY: "summary.json",
  EVENTS: "events.jsonl",
  UPDATES: "updates.jsonl",
} as const;

export function defaultGrokBuildHome(): string {
  const configured = process.env[GROK_ENVIRONMENT.HOME]?.trim();
  return configured || path.join(os.homedir(), GROK_DIRECTORY_NAME);
}

/** The lifecycle event types whose meaning this code consults. */
export const GROK_EVENT_TYPE = {
  PHASE_CHANGED: "phase_changed",
  PERMISSION_REQUESTED: "permission_requested",
  TURN_ENDED: "turn_ended",
} as const;

/** The one phase that means the session is holding on the developer. */
export const GROK_PHASE = { PERMISSION_PROMPT: "permission_prompt" } as const;

export const GROK_TURN_OUTCOME = {
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  ERROR: "error",
} as const;

/** The `sessionUpdate` kinds `updates.jsonl` lines carry that this code reads. */
export const GROK_UPDATE_KIND = {
  USER_MESSAGE_CHUNK: "user_message_chunk",
  AGENT_MESSAGE_CHUNK: "agent_message_chunk",
  TOOL_CALL: "tool_call",
  TOOL_CALL_UPDATE: "tool_call_update",
  TURN_COMPLETED: "turn_completed",
} as const;

export const GROK_STOP_REASON = { ERROR: "error" } as const;

/** A tool call whose status reached either of these has settled. */
export const GROK_SETTLED_TOOL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

/**
 * Tool inputs whose value names the work, in the order they read best. The
 * set matches what the other local adapters report — a URL is deliberately
 * not in it, because a signed URL is a credential and no other adapter sends
 * one anywhere; a fetch is named by its tool alone.
 */
export const GROK_TOOL_INPUT_KEY = LOCAL_TOOL_ARGUMENT_KEYS;

/** The tool metadata key the CLI namespaces its own bookkeeping under. */
const GROK_TOOL_META_KEY = "x.ai/tool";

/** The `update` object inside one `session/update` line of `updates.jsonl`. */
export function grokUpdateFrom(record: WireRecord): WireRecord | undefined {
  const params = record.params;
  if (!isRecord(params)) return undefined;
  const update = params.update;
  return isRecord(update) ? update : undefined;
}

export function grokUpdateKind(update: WireRecord): string | undefined {
  return text(update.sessionUpdate);
}

/**
 * The words inside an update's content value. A message chunk carries
 * `{ type: "text", text }`; a tool result wraps the same shape one level
 * deeper, as a list of `{ type: "content", content: { … } }` blocks. A
 * chunk's words keep their whitespace — a chunk is a stream delta, so a
 * trailing space is the seam between it and the next — and every reader
 * normalizes the joined result instead.
 */
export function grokContentText(content: UnparsedWireValue): string | undefined {
  if (isRecord(content)) {
    if (isWireString(content.text)) return content.text;
    return grokContentText(content.content);
  }
  if (!Array.isArray(content)) return undefined;
  const words = content
    .filter(isRecord)
    .map((part) => grokContentText(part))
    .filter((part): part is string => part !== undefined);
  return words.length > 0 ? words.join(" ") : undefined;
}

/**
 * What the CLI's own bookkeeping calls the tool an update describes — the
 * human label from its `x.ai/tool` metadata when present, the update's own
 * title otherwise.
 */
export function grokToolName(update: WireRecord): string | undefined {
  const meta = update._meta;
  if (isRecord(meta)) {
    const tool = meta[GROK_TOOL_META_KEY];
    if (isRecord(tool)) {
      const label = text(tool.label) ?? text(tool.name);
      if (label !== undefined) return label;
    }
  }
  return text(update.title);
}

/** The input detail that names a tool call's work, if any input carries one. */
export function grokToolDetail(update: WireRecord, maximumLength: number): string | undefined {
  const rawInput = update.rawInput;
  if (!isRecord(rawInput)) return undefined;
  return grokToolInputDetail(rawInput, maximumLength);
}

export function grokToolInputDetail(input: WireRecord, maximumLength: number): string | undefined {
  return GROK_TOOL_INPUT_KEY.map((key) => oneLine(text(input[key]), maximumLength)).find(
    (candidate) => candidate !== undefined,
  );
}

/** The columns this code reads off the database's `sessions` rows. */
export const GROK_SESSION_COLUMN = {
  ID: "id",
  TITLE: "title",
  RECAP_TEXT: "recap_text",
  MODEL: "model",
  CWD_LAST: "cwd_last",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

/** The columns this code reads off the database's `messages` rows. */
export const GROK_MESSAGE_COLUMN = {
  ROLE: "role",
  MESSAGE_JSON: "message_json",
  CREATED_AT: "created_at",
} as const;

/** The roles the database's `messages` rows carry that this code reads. */
export const GROK_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
} as const;

/** The content-part kinds inside a stored message that this code reads. */
export const GROK_MESSAGE_PART = {
  TEXT: "text",
  TOOL_CALL: "tool-call",
  TOOL_RESULT: "tool-result",
} as const;

/** The parts of a stored message's content, or none for plain-string content. */
export function grokMessageParts(message: WireRecord): WireRecord[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

/** The words of a stored message: its string content, or its text parts. */
export function grokMessageText(message: WireRecord): string | undefined {
  if (isWireString(message.content)) return text(message.content);
  const words = grokMessageParts(message)
    .filter((part) => text(part.type) === GROK_MESSAGE_PART.TEXT)
    .map((part) => text(part.text))
    .filter((part): part is string => part !== undefined);
  return words.length > 0 ? words.join(" ") : undefined;
}

/**
 * The words a stored tool result carries. The CLI wraps a result as
 * `output: { type, value }`, where the value is the tool's own JSON — a
 * string, or an object whose `output` field holds the printable answer. A
 * structured value with no such field is a shape this rendering cannot carry
 * faithfully, so it takes no words.
 */
export function grokToolResultText(part: WireRecord): string | undefined {
  const output = part.output;
  if (!isRecord(output)) return undefined;
  const value = output.value;
  if (isWireString(value)) return text(value);
  if (isRecord(value)) return text(value.output);
  return undefined;
}
