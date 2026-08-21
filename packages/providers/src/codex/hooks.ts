import {
  HOOK_ENTRY_NESTING,
  HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ObservationHookSpec,
  type ObservedHookEvent,
  observationHooksFor,
} from "../shared/hook-merge.js";

/**
 * Codex's observation hooks, described for the shared machinery in
 * `observation-hooks.ts`. Codex keeps user-level hooks in a `hooks.json` of
 * their own inside its home, nested the same way Claude Code's are, and hands
 * a registered command its envelope as JSON on stdin. The envelope's
 * `session_id` is the same thread id the adapter reads from `threads.id`, so
 * the spool token lands under the name the roster already knows.
 *
 * Codex reviews foreign hooks before running them: a new entry is shown to
 * the user at startup and runs only once they trust it. That gate is Codex's
 * own consent mechanism and Luke leaves it alone — until the user trusts the
 * entry, everything here observes from the state database and rollouts
 * exactly as before, which is also what the entry costs when declined.
 */

/**
 * The script's name is also the marker a managed entry is recognized by, so
 * renaming it is a migration: an entry naming the old script would stop being
 * recognized as ours and would be left behind.
 */
export const CODEX_HOOK_SCRIPT_NAME = "luke-codex-observation-hook.sh";

/** How long Codex lets the spool write run before giving up on it. */
const CODEX_HOOK_TIMEOUT_SECONDS = 10;

export const CODEX_HOOK_SPOOL_MAXIMUM_AGE_MS = HOOK_SPOOL_MAXIMUM_AGE_MS;

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Codex hands in can choose what lands in the spool. The same
 * vocabulary Claude Code's spool speaks, minus the failure token — Codex
 * fires no hook for a turn that failed, so the rollout keeps that verdict.
 */
export const CODEX_HOOK_EVENT = {
  SESSION_START: "session-start",
  PROMPT: "prompt",
  STOP: "stop",
  NOTIFICATION: "notification",
  SESSION_END: "session-end",
} as const;

export type CodexHookEvent = (typeof CODEX_HOOK_EVENT)[keyof typeof CODEX_HOOK_EVENT];

/** The latest thing the hook reported about one session, dated by the spool. */
export type ObservedCodexHookEvent = ObservedHookEvent<CodexHookEvent>;

/**
 * Which Codex lifecycle moments are registered, and the token each one hands
 * the script. Turn boundaries and lifecycle edges only, for the same reason
 * Claude Code's registration stops there. `PermissionRequest` is Codex's own
 * name for a tool call holding for approval — the one moment the state
 * database shows nothing new — and the entry only observes it: the command
 * always exits zero, so nothing here can answer the request.
 */
const CODEX_HOOK_SPEC: ObservationHookSpec<CodexHookEvent> = {
  scriptName: CODEX_HOOK_SCRIPT_NAME,
  configurationFileName: "hooks.json",
  scriptTitle: "Luke Codex observation hook v1",
  registration: {
    SessionStart: { event: CODEX_HOOK_EVENT.SESSION_START },
    UserPromptSubmit: { event: CODEX_HOOK_EVENT.PROMPT },
    Stop: { event: CODEX_HOOK_EVENT.STOP },
    PermissionRequest: { event: CODEX_HOOK_EVENT.NOTIFICATION },
    SessionEnd: { event: CODEX_HOOK_EVENT.SESSION_END },
  },
  timeoutSeconds: CODEX_HOOK_TIMEOUT_SECONDS,
  sessionIdField: "session_id",
  // Codex thread ids are UUIDs: hex and hyphens, like Claude Code's.
  sessionIdPattern: "[0-9a-fA-F-]{8,64}",
  subagentField: "agent_id",
  entryNesting: HOOK_ENTRY_NESTING.NESTED,
};

export interface CodexHookInstallation {
  /** Codex's own home, holding the `hooks.json` entries merge into. */
  codexHome: string;
  /** Where Luke keeps the script, under Luke's own application data. */
  hookScriptPath: string;
  /** Where the script writes its event files, under Luke's own data too. */
  spoolDirectory: string;
}

const codexHooks = observationHooksFor(
  CODEX_HOOK_SPEC,
  (installation: CodexHookInstallation) => installation.codexHome,
);

export const installCodexObservationHooks = codexHooks.install;
export const removeCodexObservationHooks = codexHooks.remove;
export const readCodexHookEvent = codexHooks.read;
export const pruneCodexHookSpool = codexHooks.prune;
