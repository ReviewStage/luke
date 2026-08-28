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
 * Devin's observation hooks, described for the shared machinery in
 * `hook-merge.ts`. The Devin CLI keeps its user-level configuration in
 * `~/.config/devin/config.json` (under `XDG_CONFIG_HOME` where that is set),
 * a settings file that carries hooks under a `hooks` key beside the user's
 * other settings, nested the same way Claude Code's are, and it pipes a
 * registered command its envelope as JSON on stdin. The envelope's
 * `session_id` is the same id the CLI writes as the session row's primary key
 * in its own SQLite — verified against a live CLI, six sessions for six — so
 * the spool token lands under the name the roster already knows. The CLI runs
 * a newly registered user-level hook without a review gate of its own; the
 * consent here is the same as every provider's, the registration Luke
 * converges and removes.
 */

/**
 * The base of the installed script's name — the registry splices a channel
 * qualifier in ahead of the extension — and the installed name is the marker
 * a managed entry is recognized by, so renaming it is a migration: an entry
 * naming the old script would stop being recognized as ours and would be
 * left behind.
 */
export const DEVIN_HOOK_SCRIPT_NAME = "luke-devin-observation-hook.sh";

/** How long Devin lets the spool write run before giving up on it. */
const DEVIN_HOOK_TIMEOUT_SECONDS = 10;

const DEVIN_ENVIRONMENT = {
  CONFIG_HOME: "XDG_CONFIG_HOME",
} as const;

const DEVIN_CONFIG_HOME_SEGMENT = ".config";
const DEVIN_CONFIG_DIRECTORY = "devin";

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Devin pipes in can choose what lands in the spool. The same
 * vocabulary Codex's spool speaks, minus nothing — Devin documents the same
 * five moments — though the CLI observed today fires no `SessionEnd` for a
 * quit, so the closing token is registered on the documentation's word and
 * refines a row only if a build ever sends it.
 */
export const DEVIN_HOOK_EVENT = {
  SESSION_START: HOOK_EVENT.SESSION_START,
  PROMPT: HOOK_EVENT.PROMPT,
  STOP: HOOK_EVENT.STOP,
  NOTIFICATION: HOOK_EVENT.NOTIFICATION,
  SESSION_END: HOOK_EVENT.SESSION_END,
} as const;

export type DevinHookEvent = (typeof DEVIN_HOOK_EVENT)[keyof typeof DEVIN_HOOK_EVENT];

/** The latest thing the hook reported about one session, dated by the spool. */
export type ObservedDevinHookEvent = ObservedHookEvent<DevinHookEvent>;

/**
 * Which Devin lifecycle moments are registered, and the token each one hands
 * the script. Turn boundaries and lifecycle edges only, for the same reason
 * Claude Code's registration stops there. `PermissionRequest` is Devin's own
 * name for a tool call holding for approval — the one moment the session
 * database shows nothing new — and the entry only observes it: the command
 * always exits zero and prints nothing, which Devin reads as no decision, so
 * nothing here can answer the request. Subagent turns are not skipped by an
 * envelope field because Devin's envelope carries none; its subagents end
 * under their own `SubagentStop` event, which is simply not registered.
 */
const DEVIN_HOOK_SPEC: ObservationHookSpec<DevinHookEvent> = {
  configurationFileName: "config.json",
  scriptTitle: "Luke Devin observation hook v1",
  registration: {
    SessionStart: { event: DEVIN_HOOK_EVENT.SESSION_START },
    UserPromptSubmit: { event: DEVIN_HOOK_EVENT.PROMPT },
    Stop: { event: DEVIN_HOOK_EVENT.STOP },
    PermissionRequest: { event: DEVIN_HOOK_EVENT.NOTIFICATION },
    SessionEnd: { event: DEVIN_HOOK_EVENT.SESSION_END },
  },
  timeoutSeconds: DEVIN_HOOK_TIMEOUT_SECONDS,
  sessionIdField: "session_id",
  // The shape Devin mints: lowercase words joined by hyphens ("solid-rest").
  // The hyphen is required because the script greps this pattern back out of
  // the matched `"session_id":"…"` fragment, and a single-word pattern would
  // match the field's own name before the id.
  sessionIdPattern: "[a-z0-9]{1,24}(-[a-z0-9]{1,24}){1,5}",
  entryNesting: HOOK_ENTRY_NESTING.NESTED,
  // Devin documents a schema version beside the settings; a file being
  // created gets it, and a user's own value is never rewritten.
  rootDefaults: { version: 1 },
};

/**
 * Where the Devin CLI keeps its user-level configuration. Deliberately not
 * the data home the session database lives under: the CLI splits the two
 * along the XDG lines, and each side keeps its own resolution.
 */
export function defaultDevinConfigHome(): string {
  const configHome = process.env[DEVIN_ENVIRONMENT.CONFIG_HOME]?.trim();
  const base = configHome || path.join(os.homedir(), DEVIN_CONFIG_HOME_SEGMENT);
  return path.join(base, DEVIN_CONFIG_DIRECTORY);
}

const devinHooks = observationHooksFor(DEVIN_HOOK_SPEC);

export const installDevinObservationHooks = devinHooks.install;
export const removeDevinObservationHooks = devinHooks.remove;
export const readDevinHookEvent = devinHooks.read;
