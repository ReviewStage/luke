import { HOOK_EVENT } from "../shared/hook-events.js";
import {
  HOOK_ENTRY_NESTING,
  type ObservationHookSpec,
  type ObservedHookEvent,
  observationHooksFor,
} from "../shared/hook-merge.js";

/**
 * Gemini CLI's observation hooks, described for the shared machinery in
 * `hook-merge.ts`. Gemini CLI keeps user-level hooks under the `hooks` key of
 * `~/.gemini/settings.json` — honoring the same `GEMINI_CLI_HOME` override its
 * transcripts do, so the registration and the adapter observe one install —
 * with entries nested the way Claude Code's are, and it pipes a registered
 * command its envelope as JSON on stdin. The CLI reads the hook's stdout as
 * its JSON answer, so the script replies with the empty decision on every
 * path out, and its entry timeout is documented in milliseconds where Claude
 * Code's is seconds.
 *
 * The envelope's `session_id` is the session's full id, but the CLI names the
 * recording the adapter observes by a timestamp and that id's first eight
 * characters, so the spool file cannot land under the adapter's own
 * `providerSessionId`. The recording's opening metadata line carries the same
 * full id, and the adapter joins the spool to the recording there.
 *
 * The agent events fire only from the CLI's own main loop — a subagent's
 * turns run through the chat layer beneath the one that fires hooks — so the
 * envelope carries no subagent field and needs none skipped.
 */

/**
 * The base of the installed script's name — the registry splices a channel
 * qualifier in ahead of the extension — and the installed name is the marker
 * a managed entry is recognized by, so renaming it is a migration: an entry
 * naming the old script would stop being recognized as ours and would be
 * left behind.
 */
export const GEMINI_HOOK_SCRIPT_NAME = "luke-gemini-observation-hook.sh";

/** How long Gemini CLI lets the spool write run before giving up on it. */
const GEMINI_HOOK_TIMEOUT_MILLISECONDS = 10_000;

/**
 * The tokens the script may write, fixed at registration: each hook entry
 * passes its own token as the script's one argument, so nothing in the
 * envelope Gemini CLI pipes in can choose what lands in the spool.
 */
export const GEMINI_HOOK_EVENT = {
  SESSION_START: HOOK_EVENT.SESSION_START,
  PROMPT: HOOK_EVENT.PROMPT,
  STOP: HOOK_EVENT.STOP,
  NOTIFICATION: HOOK_EVENT.NOTIFICATION,
  SESSION_END: HOOK_EVENT.SESSION_END,
} as const;

export type GeminiHookEvent = (typeof GEMINI_HOOK_EVENT)[keyof typeof GEMINI_HOOK_EVENT];

/** The latest thing the hook reported about one session, dated by the spool. */
export type ObservedGeminiHookEvent = ObservedHookEvent<GeminiHookEvent>;

/**
 * Which Gemini CLI lifecycle moments are registered, and the token each one
 * hands the script: turn boundaries and lifecycle edges only, like every
 * provider's. `Notification` fires for exactly one documented kind — a tool
 * call holding for permission — so it is registered whole, with no matcher to
 * narrow what is already the hold itself.
 */
const GEMINI_HOOK_SPEC: ObservationHookSpec<GeminiHookEvent> = {
  configurationFileName: "settings.json",
  scriptTitle: "Luke Gemini CLI observation hook v1",
  registration: {
    SessionStart: { event: GEMINI_HOOK_EVENT.SESSION_START },
    BeforeAgent: { event: GEMINI_HOOK_EVENT.PROMPT },
    AfterAgent: { event: GEMINI_HOOK_EVENT.STOP },
    Notification: { event: GEMINI_HOOK_EVENT.NOTIFICATION },
    SessionEnd: { event: GEMINI_HOOK_EVENT.SESSION_END },
  },
  timeoutMilliseconds: GEMINI_HOOK_TIMEOUT_MILLISECONDS,
  sessionIdField: "session_id",
  // The shape Gemini CLI mints: UUIDs, hex and hyphens.
  sessionIdPattern: "[0-9a-fA-F-]{8,64}",
  entryNesting: HOOK_ENTRY_NESTING.NESTED,
  repliesWithJson: true,
};

const geminiHooks = observationHooksFor(GEMINI_HOOK_SPEC);

export const installGeminiObservationHooks = geminiHooks.install;
export const removeGeminiObservationHooks = geminiHooks.remove;
export const readGeminiHookEvent = geminiHooks.read;
