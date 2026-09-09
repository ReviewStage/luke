import { isWireNumber, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The vocabulary of what Codex writes into a rollout, and the readers over it
 * the observation pass and the transcript rendering both reach for.
 */

/**
 * The Codex app's own address for a local thread. Codex registers the `codex`
 * scheme for its windows and documents `threads/<thread-id>` as the route to an
 * existing local chat, keyed by the same `threads.id` the pass reads — so the
 * row and the address it opens name one thread rather than two.
 */
export const CODEX_THREAD_LINK_PREFIX = "codex://threads/";

/**
 * Codex uses this synthetic title for locally-created delegation sessions.
 * It identifies the source chat for Codex itself, but is not a user-facing
 * title and can be misleading when shown in Luke's session list.
 */
export const CODEX_DELEGATION_TITLE =
  /<codex_delegation>\s*<source_thread_id>\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*<\/source_thread_id>/i;

export const CODEX_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CODEX_SUBAGENT_SOURCE_FIELD = {
  SUBAGENT: "subagent",
  THREAD_SPAWN: "thread_spawn",
  PARENT_THREAD_ID: "parent_thread_id",
} as const;

/** Records Codex appends to the rollout file named by a thread's `rollout_path`. */
export const CODEX_ROLLOUT_TYPE = {
  EVENT_MSG: "event_msg",
  RESPONSE_ITEM: "response_item",
  WORLD_STATE: "world_state",
} as const;

/**
 * The realtime section of Codex's persisted world state: `{ active: boolean }`,
 * written into every turn's snapshot. This is the durable record of whether a
 * realtime voice conversation was open over the thread when its last turn ran —
 * the voice lifecycle events themselves are transient and never reach the
 * rollout. A `full` snapshot carries every section, so one without this key is
 * a build with no realtime at all; a patch reports the section only when it
 * changed.
 */
export const CODEX_WORLD_STATE_SECTION = {
  REALTIME: "realtime",
} as const;

export const CODEX_REALTIME_ACTIVE_KEY = "active";

/**
 * The turn boundary. `threads` carries no status column at all, so without the
 * rollout a Codex session can only be guessed at from how recently its row was
 * touched — and could never be reported as waiting for its developer.
 */
export const CODEX_EVENT_PAYLOAD = {
  TASK_STARTED: "task_started",
  TASK_COMPLETE: "task_complete",
  /**
   * The failure that ended a turn early. Current Codex builds carry the error
   * on `task_complete` itself; older ones wrote this event standing alone, so
   * both shapes are read — the same pair the transcript reader renders.
   */
  ERROR: "error",
} as const;

export const CODEX_RESPONSE_PAYLOAD = {
  FUNCTION_CALL: "function_call",
  MESSAGE: "message",
} as const;

export const CODEX_MESSAGE_ROLE = {
  USER: "user",
} as const;

/**
 * Function-call arguments whose value names the work, in the order they read
 * best. `cmd` leads because `exec_command` is by far the most common call Codex
 * makes and that is what it calls its command line.
 */
export const CODEX_CALL_ARGUMENT_KEY = [
  "cmd",
  "command",
  "path",
  "file_path",
  "query",
  "search_query",
  "pattern",
] as const;

const CODEX_REALTIME_DELEGATION_MARKER = "<realtime_delegation>";

/**
 * Reads one argument as the phrase that names the work. Codex passes some of
 * them as a list rather than a string — a search's terms, a command's argv —
 * so a list of plain values is joined instead of dropped. A list of anything
 * else, such as a plan's steps, is not a phrase and is left alone.
 */
export function argumentPhrase(value: UnparsedWireValue): string | undefined {
  if (isWireString(value)) return text(value);
  if (isWireNumber(value)) return String(value);
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tokens = value.map((entry) =>
    isWireString(entry) || isWireNumber(entry) ? String(entry) : undefined,
  );
  return tokens.every((token) => token !== undefined) ? text(tokens.join(" ")) : undefined;
}

export function isCodexRealtimeDelegationText(value: string | undefined): boolean {
  return text(value)?.trimStart().startsWith(CODEX_REALTIME_DELEGATION_MARKER) === true;
}
