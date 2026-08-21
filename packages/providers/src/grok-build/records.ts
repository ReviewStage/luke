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

/**
 * The vocabulary of Grok Build's session store, shared by the adapter that
 * observes it and the transcript read that renders it. The CLI keeps each
 * session as a directory under `~/.grok/sessions/<percent-encoded-cwd>/`,
 * holding three recordings this code reads: `summary.json`, the session's own
 * metadata (title, model, working directory, clocks); `events.jsonl`, the
 * CLI's append-only turn lifecycle (phases, permission prompts, turn
 * outcomes), which is what answers whose move it is; and `updates.jsonl`, the
 * conversation itself as ACP `session/update` notifications, which is what a
 * recap or a transcript rendering is read from.
 */

const GROK_DIRECTORY_NAME = ".grok";

export const GROK_SESSIONS_DIRECTORY = "sessions";

export const GROK_SESSION_FILE = {
  SUMMARY: "summary.json",
  EVENTS: "events.jsonl",
  UPDATES: "updates.jsonl",
} as const;

export function defaultGrokBuildHome(): string {
  return path.join(os.homedir(), GROK_DIRECTORY_NAME);
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
export const GROK_TOOL_INPUT_KEY = [
  "description",
  "command",
  "file_path",
  "path",
  "pattern",
  "prompt",
  "query",
] as const;

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
  return GROK_TOOL_INPUT_KEY.map((key) => oneLine(text(rawInput[key]), maximumLength)).find(
    (candidate) => candidate !== undefined,
  );
}
