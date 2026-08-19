import os from "node:os";
import path from "node:path";
import {
  HOOK_SPOOL_MAXIMUM_AGE_MS,
  type ObservationHookSpec,
  type ObservedHookEvent,
  observationHooksFor,
} from "./observation-hooks";

/**
 * Claude Code's observation hooks, described for the shared machinery in
 * `observation-hooks.ts`: which file the registration merges into, which
 * lifecycle moments are registered, and what the envelope Claude Code pipes
 * the script looks like. Everything the arrangement guarantees — the merge
 * beside the user's entries, the refusal to rewrite an unparseable file, the
 * fixed token as the only thing that reaches disk — is the shared module's;
 * this file only says what Claude Code calls things.
 */

const CLAUDE_ENVIRONMENT = {
  CONFIG_DIRECTORY: "CLAUDE_CONFIG_DIR",
} as const;

/**
 * The script's name is also the marker a managed entry is recognized by, so
 * renaming it is a migration: an entry naming the old script would stop being
 * recognized as ours and would be left behind.
 */
export const CLAUDE_HOOK_SCRIPT_NAME = "luke-claude-observation-hook.sh";

/** How long Claude Code lets the spool write run before giving up on it. */
const CLAUDE_HOOK_TIMEOUT_SECONDS = 10;

export const CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS = HOOK_SPOOL_MAXIMUM_AGE_MS;

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Claude Code pipes in can choose what lands in the spool.
 */
export const CLAUDE_HOOK_EVENT = {
  SESSION_START: "session-start",
  PROMPT: "prompt",
  STOP: "stop",
  STOP_FAILURE: "stop-failure",
  NOTIFICATION: "notification",
  SESSION_END: "session-end",
} as const;

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENT)[keyof typeof CLAUDE_HOOK_EVENT];

/** The latest thing the hook reported about one session, dated by the spool. */
export type ObservedClaudeHookEvent = ObservedHookEvent<ClaudeHookEvent>;

/**
 * Which Claude Code lifecycle moments are registered, and the token each one
 * hands the script. Turn boundaries and lifecycle edges only: a per-tool-call
 * hook would run a subprocess inside every step of every session for status
 * the transcript tail already carries. The notification entry is matched down
 * to the two kinds that mean the session is holding for the user — a
 * permission prompt and an open question — because those are exactly the
 * moments the transcript shows nothing new.
 */
const CLAUDE_HOOK_SPEC: ObservationHookSpec<ClaudeHookEvent> = {
  scriptName: CLAUDE_HOOK_SCRIPT_NAME,
  configurationFileName: "settings.json",
  scriptTitle: "Luke Claude Code observation hook v1",
  registration: {
    SessionStart: { event: CLAUDE_HOOK_EVENT.SESSION_START },
    UserPromptSubmit: { event: CLAUDE_HOOK_EVENT.PROMPT },
    Stop: { event: CLAUDE_HOOK_EVENT.STOP },
    StopFailure: { event: CLAUDE_HOOK_EVENT.STOP_FAILURE },
    Notification: {
      event: CLAUDE_HOOK_EVENT.NOTIFICATION,
      matcher: "permission_prompt|elicitation_dialog",
    },
    SessionEnd: { event: CLAUDE_HOOK_EVENT.SESSION_END },
  },
  timeoutSeconds: CLAUDE_HOOK_TIMEOUT_SECONDS,
  sessionIdField: "session_id",
  // The shape Claude Code mints: hex and hyphens.
  sessionIdPattern: "[0-9a-fA-F-]{8,64}",
  subagentField: "agent_id",
};

/** Where Claude Code keeps its transcripts and its user-level settings. */
export function defaultClaudeHome(): string {
  const configuredHome = process.env[CLAUDE_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".claude");
}

export interface ClaudeCodeHookInstallation {
  /** Claude Code's own home, holding the `settings.json` entries merge into. */
  claudeHome: string;
  /** Where Luke keeps the script, under Luke's own application data. */
  hookScriptPath: string;
  /** Where the script writes its event files, under Luke's own data too. */
  spoolDirectory: string;
}

const claudeHooks = observationHooksFor(
  CLAUDE_HOOK_SPEC,
  (installation: ClaudeCodeHookInstallation) => installation.claudeHome,
);

export const installClaudeCodeObservationHooks = claudeHooks.install;
export const removeClaudeCodeObservationHooks = claudeHooks.remove;
export const readClaudeHookEvent = claudeHooks.read;
export const pruneClaudeHookSpool = claudeHooks.prune;
