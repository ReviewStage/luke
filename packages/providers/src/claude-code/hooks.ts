import os from "node:os";
import path from "node:path";
import { HOOK_EVENT } from "../shared/hook-events.js";
import {
  HOOK_ENTRY_NESTING,
  type ObservationHookSpec,
  type ObservedHookEvent,
  observationHooksFor,
} from "../shared/hook-merge.js";

/**
 * Claude Code's observation hooks, described for the shared machinery in
 * `hook-merge.ts`: which file the registration merges into, which
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
 * The base of the installed script's name — the registry splices a channel
 * qualifier in ahead of the extension — and the installed name is the marker
 * a managed entry is recognized by, so renaming it is a migration: an entry
 * naming the old script would stop being recognized as ours and would be
 * left behind.
 */
export const CLAUDE_HOOK_SCRIPT_NAME = "luke-claude-observation-hook.sh";

/** How long Claude Code lets the spool write run before giving up on it. */
const CLAUDE_HOOK_TIMEOUT_SECONDS = 10;

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Claude Code pipes in can choose what lands in the spool.
 */
export const CLAUDE_HOOK_EVENT = {
  SESSION_START: HOOK_EVENT.SESSION_START,
  PROMPT: HOOK_EVENT.PROMPT,
  STOP: HOOK_EVENT.STOP,
  STOP_FAILURE: HOOK_EVENT.STOP_FAILURE,
  NOTIFICATION: HOOK_EVENT.NOTIFICATION,
  SESSION_END: HOOK_EVENT.SESSION_END,
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
  entryNesting: HOOK_ENTRY_NESTING.NESTED,
};

/** Where Claude Code keeps its transcripts and its user-level settings. */
export function defaultClaudeHome(): string {
  const configuredHome = process.env[CLAUDE_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".claude");
}

const claudeHooks = observationHooksFor(CLAUDE_HOOK_SPEC);

export const installClaudeCodeObservationHooks = claudeHooks.install;
export const removeClaudeCodeObservationHooks = claudeHooks.remove;
export const readClaudeHookEvent = claudeHooks.read;
