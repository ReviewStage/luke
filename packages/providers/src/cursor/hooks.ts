import { HOOK_EVENT } from "../shared/hook-events.js";
import {
  HOOK_ENTRY_NESTING,
  type ObservationHookSpec,
  type ObservedHookEvent,
  observationHooksFor,
} from "../shared/hook-merge.js";

/**
 * Cursor's observation hooks, described for the shared machinery in
 * `hook-merge.ts`. Cursor keeps user-level hooks in `~/.cursor/hooks.json`,
 * honored by the app's own composer and the `agents` CLI alike, with entries
 * that are the command records themselves rather than Claude Code's nested
 * lists, and it pipes a registered command its envelope as JSON on stdin. The
 * envelope's `conversation_id` is the same id the adapter reads transcripts
 * under, so the spool token lands under the name the roster already knows —
 * and Cursor reads the hook's stdout as its JSON answer, so the script
 * replies with the empty decision on every path out.
 *
 * Cursor documents no event that fires only while a tool call holds for
 * approval — `beforeShellExecution` fires before every run, held or not — so
 * no permission token is registered and a held call stays invisible here,
 * the honest absence, rather than every shell call reading as a wait.
 */

/**
 * The script's name is also the marker a managed entry is recognized by, so
 * renaming it is a migration: an entry naming the old script would stop being
 * recognized as ours and would be left behind.
 */
export const CURSOR_HOOK_SCRIPT_NAME = "luke-cursor-observation-hook.sh";

/** How long Cursor lets the spool write run before giving up on it. */
const CURSOR_HOOK_TIMEOUT_SECONDS = 10;

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Cursor pipes in can choose what lands in the spool. The same
 * vocabulary Codex's spool speaks, minus the permission token — see above —
 * and minus a failure token, because the transcript's own `turn_ended`
 * marker keeps that verdict.
 */
export const CURSOR_HOOK_EVENT = {
  SESSION_START: HOOK_EVENT.SESSION_START,
  PROMPT: HOOK_EVENT.PROMPT,
  STOP: HOOK_EVENT.STOP,
  SESSION_END: HOOK_EVENT.SESSION_END,
} as const;

export type CursorHookEvent = (typeof CURSOR_HOOK_EVENT)[keyof typeof CURSOR_HOOK_EVENT];

/** The latest thing the hook reported about one session, dated by the spool. */
export type ObservedCursorHookEvent = ObservedHookEvent<CursorHookEvent>;

const CURSOR_HOOK_SPEC: ObservationHookSpec<CursorHookEvent> = {
  scriptName: CURSOR_HOOK_SCRIPT_NAME,
  configurationFileName: "hooks.json",
  scriptTitle: "Luke Cursor observation hook v1",
  registration: {
    sessionStart: { event: CURSOR_HOOK_EVENT.SESSION_START },
    beforeSubmitPrompt: { event: CURSOR_HOOK_EVENT.PROMPT },
    stop: { event: CURSOR_HOOK_EVENT.STOP },
    sessionEnd: { event: CURSOR_HOOK_EVENT.SESSION_END },
  },
  timeoutSeconds: CURSOR_HOOK_TIMEOUT_SECONDS,
  sessionIdField: "conversation_id",
  // Cursor chat ids are UUIDs: hex and hyphens, like Claude Code's.
  sessionIdPattern: "[0-9a-fA-F-]{8,64}",
  entryNesting: HOOK_ENTRY_NESTING.FLAT,
  repliesWithJson: true,
  // Cursor documents a schema version beside the hooks; a file being created
  // gets it, and a user's own value is never rewritten.
  rootDefaults: { version: 1 },
};

const cursorHooks = observationHooksFor(CURSOR_HOOK_SPEC);

export const installCursorObservationHooks = cursorHooks.install;
export const removeCursorObservationHooks = cursorHooks.remove;
export const readCursorHookEvent = cursorHooks.read;
