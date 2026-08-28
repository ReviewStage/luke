import os from "node:os";
import path from "node:path";
import {
  type ObservationHookInstallation,
  type ObservedHookEvent,
  readObservationHookEvent,
} from "../shared/hook-merge.js";
import {
  installManagedObservationPlugin,
  type ManagedObservationPluginSpec,
  removeManagedObservationPlugin,
} from "../shared/managed-plugin.js";

/**
 * OpenCode's observation hooks, carried by a managed plugin file rather than a
 * merged configuration entry, because OpenCode has no hook configuration to
 * merge into: it loads whole JavaScript plugin files from its own plugin
 * directory and runs them inside its own process, and its event bus is where
 * the moments the transcripts cannot show live — above all `permission.asked`,
 * the one signal that a tool call is holding for the developer, which writes
 * nothing to the session's own files while it holds. The file's whole content
 * is fixed by the build around the spool path; everything the arrangement
 * guarantees — recognition by marker, convergence at launch, refusal to touch
 * a foreign file — is `managed-plugin.ts`'s, and this file only says what
 * OpenCode calls things.
 *
 * Verified against OpenCode v1.4.9 and its dev branch: the loader globs
 * `{plugin,plugins}/*.{ts,js}` inside `$XDG_CONFIG_HOME/opencode` (default
 * `~/.config/opencode`) with no registration anywhere else, every payload
 * names its session as `sessionID` (or inside `info` on older releases), and
 * OpenCode fires a plugin's `event` hook without awaiting it — so the plugin
 * lets nothing escape, because its rejection would surface in the developer's
 * own session as an unhandled one.
 */

const OPENCODE_HOOK_ENVIRONMENT = {
  CONFIG_DIRECTORY: "OPENCODE_CONFIG_DIR",
  CONFIG_HOME: "XDG_CONFIG_HOME",
} as const;

const OPENCODE_CONFIG_HOME_SEGMENT = ".config";
const OPENCODE_CONFIG_DIRECTORY_NAME = "opencode";

/**
 * The singular form, because it is the one every plugin-loading OpenCode
 * release reads: v1.0.0 globs `plugin/*.{ts,js}` alone, and v1.2.0 onward
 * globs `{plugin,plugins}` — the plural is a later synonym.
 */
const OPENCODE_PLUGIN_DIRECTORY_NAME = "plugin";

/**
 * The base of the plugin file's name inside OpenCode's plugin directory — the
 * registry splices a channel qualifier in ahead of the extension, so each
 * always-on channel manages a file of its own. Ownership of a given file
 * still rests on the marker header, not the name — a foreign file wearing a
 * managed name is never touched — but renaming this strands a file under the
 * old name, so it is a migration too.
 */
export const OPENCODE_PLUGIN_FILE_NAME = "luke-opencode-observation-plugin.js";

/**
 * The versionless recognition text; the header states the version beside it.
 * Changing this is a migration: a file carrying only the old marker would
 * stop being recognized as ours and would be left behind.
 */
const OPENCODE_PLUGIN_MARKER = "Luke OpenCode observation plugin";

const OPENCODE_PLUGIN_VERSION = 1;

/**
 * The tokens the plugin may write, fixed in its generated content: each bus
 * event maps to its own token, so nothing in an event can choose what lands
 * in the spool. The same vocabulary Claude Code's spool speaks.
 */
export const OPENCODE_HOOK_EVENT = {
  SESSION_START: "session-start",
  PROMPT: "prompt",
  STOP: "stop",
  STOP_FAILURE: "stop-failure",
  NOTIFICATION: "notification",
  SESSION_END: "session-end",
} as const;

export type OpenCodeHookEvent = (typeof OPENCODE_HOOK_EVENT)[keyof typeof OPENCODE_HOOK_EVENT];

/** The latest thing the plugin reported about one session, dated by the spool. */
export type ObservedOpenCodeHookEvent = ObservedHookEvent<OpenCodeHookEvent>;

/** The bus events the plugin listens for, as OpenCode's own bus names them. */
const OPENCODE_BUS_EVENT = {
  SESSION_CREATED: "session.created",
  MESSAGE_UPDATED: "message.updated",
  PERMISSION_ASKED: "permission.asked",
  PERMISSION_UPDATED: "permission.updated",
  PERMISSION_REPLIED: "permission.replied",
  SESSION_IDLE: "session.idle",
  SESSION_ERROR: "session.error",
  SESSION_DELETED: "session.deleted",
} as const;

/**
 * Which bus events are recorded, and the token each one writes. The ask for a
 * permission appears under two names because OpenCode renamed it —
 * `permission.updated` through v1.0, `permission.asked` since — and no release
 * publishes both, so both map to the one holding token. A reply resumes the
 * turn whichever way it was answered — a rejection is fed back to the model,
 * which keeps going — so it reads as working, and `session.idle` says when the
 * turn truly ends. An error is written even though OpenCode usually follows it
 * with idle, because the paths that fail before a turn opens fire no idle at
 * all — where idle does follow, its token replaces this one, and the failure
 * still stands in the session's own records.
 */
const OPENCODE_PLUGIN_REGISTRATION = {
  [OPENCODE_BUS_EVENT.SESSION_CREATED]: OPENCODE_HOOK_EVENT.SESSION_START,
  [OPENCODE_BUS_EVENT.MESSAGE_UPDATED]: OPENCODE_HOOK_EVENT.PROMPT,
  [OPENCODE_BUS_EVENT.PERMISSION_ASKED]: OPENCODE_HOOK_EVENT.NOTIFICATION,
  [OPENCODE_BUS_EVENT.PERMISSION_UPDATED]: OPENCODE_HOOK_EVENT.NOTIFICATION,
  [OPENCODE_BUS_EVENT.PERMISSION_REPLIED]: OPENCODE_HOOK_EVENT.PROMPT,
  [OPENCODE_BUS_EVENT.SESSION_IDLE]: OPENCODE_HOOK_EVENT.STOP,
  [OPENCODE_BUS_EVENT.SESSION_ERROR]: OPENCODE_HOOK_EVENT.STOP_FAILURE,
  [OPENCODE_BUS_EVENT.SESSION_DELETED]: OPENCODE_HOOK_EVENT.SESSION_END,
} as const;

const OPENCODE_HOOK_EVENT_TOKENS: readonly OpenCodeHookEvent[] = [
  ...new Set(Object.values(OPENCODE_PLUGIN_REGISTRATION)),
];

/**
 * The shape OpenCode mints: `ses_` and an alphanumeric tail — today twelve
 * hex characters and fourteen base62, bounded generously the way the other
 * providers' patterns are. The id becomes the spool file's name, so nothing
 * outside this shape is accepted at all; it is also what keeps a message's
 * own `msg_` id, reached by the older payloads' fallback, out of the spool.
 */
const OPENCODE_SESSION_ID_PATTERN = "^ses_[0-9A-Za-z]{8,64}$";

/** Where OpenCode keeps its global configuration, and inside it, its plugins. */
export function defaultOpenCodeConfigDirectory(): string {
  const configured = process.env[OPENCODE_HOOK_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  if (configured) return configured;
  const configHome = process.env[OPENCODE_HOOK_ENVIRONMENT.CONFIG_HOME]?.trim();
  if (configHome) return path.join(configHome, OPENCODE_CONFIG_DIRECTORY_NAME);
  return path.join(os.homedir(), OPENCODE_CONFIG_HOME_SEGMENT, OPENCODE_CONFIG_DIRECTORY_NAME);
}

export function openCodePluginDirectory(configDirectory: string): string {
  return path.join(configDirectory, OPENCODE_PLUGIN_DIRECTORY_NAME);
}

/**
 * The plugin OpenCode runs. It writes one fixed token into the spool and
 * nothing else: an event is read only to name its session — and, for a
 * message event, which role wrote it, the same one-field filter the scripts
 * apply to a subagent's envelope — its text never reaches disk, and a token
 * or session id it does not recognize ends it without a write. A missing
 * spool ends it too — that is what turning observation hooks off means — so a
 * plugin outliving Luke is an instant no-op.
 */
function observationPluginContent(spoolDirectory: string): string {
  return `// ${OPENCODE_PLUGIN_MARKER} v${OPENCODE_PLUGIN_VERSION}
//
// OpenCode loads this file from its own plugin directory. It writes one fixed
// status token into Luke's own spool — never into any OpenCode file — naming
// the file by the session's own id. An event is read only for that id and,
// for a message event, which role wrote it; its text never reaches disk.
// Luke installs, converges, and removes this file.
import fs from "node:fs/promises";
import path from "node:path";

const SPOOL_DIRECTORY = ${JSON.stringify(spoolDirectory)};

// The id becomes the spool file's name, so only the shape OpenCode mints is
// accepted at all.
const SESSION_ID_PATTERN = /${OPENCODE_SESSION_ID_PATTERN}/;

// One fixed token per bus event, fixed when Luke generated this file, so
// nothing in an event can choose what is written.
const EVENT_TOKENS = ${JSON.stringify(OPENCODE_PLUGIN_REGISTRATION, undefined, 2)};

// OpenCode fires handlers without awaiting them, so two events for one
// session can be in flight at once; a temp name shared between them would
// let one write's rename race the other's. The process id still keeps two
// OpenCode instances off each other's writes.
let writeSequence = 0;

async function record(sessionId, token) {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) return;
  // No spool means observation hooks are off or Luke is gone; leave quietly
  // rather than resurrect a directory a removal tore down.
  const spool = await fs.stat(SPOOL_DIRECTORY).catch(() => undefined);
  if (!spool?.isDirectory()) return;
  // One tiny file per session, replaced on every event: only the newest event
  // matters, and replacement is what bounds the spool. Writing beside the
  // spool file and renaming over it keeps a concurrent reader off half a
  // write.
  writeSequence += 1;
  const temporaryPath = path.join(
    SPOOL_DIRECTORY,
    "." + sessionId + "." + process.pid + "." + writeSequence + ".tmp",
  );
  await fs.writeFile(temporaryPath, JSON.stringify({ event: token }));
  await fs.rename(temporaryPath, path.join(SPOOL_DIRECTORY, sessionId + ".json"));
}

export const LukeObservation = async () => ({
  event: async ({ event }) => {
    // OpenCode fires this hook without awaiting it, so nothing may escape:
    // a rejection here would surface in the developer's own session.
    try {
      // An own-property lookup, so an inherited name (toString, constructor)
      // can never read as a registered event.
      if (!Object.hasOwn(EVENT_TOKENS, event.type)) return;
      const token = EVENT_TOKENS[event.type];
      const properties = event.properties ?? {};
      // A message event fires for the assistant's own updates too; only the
      // developer's message marks a turn opening.
      if (event.type === "${OPENCODE_BUS_EVENT.MESSAGE_UPDATED}" && properties.info?.role !== "user") return;
      // Newer releases put the id beside the payload; older ones only inside
      // it. A message's own id is not a session's, and the pattern refuses it.
      await record(properties.sessionID ?? properties.info?.sessionID ?? properties.info?.id, token);
    } catch {
      // Observation decides nothing and must cost the session nothing.
    }
  },
});
`;
}

const OPENCODE_PLUGIN_SPEC: ManagedObservationPluginSpec = {
  marker: OPENCODE_PLUGIN_MARKER,
  content: observationPluginContent,
};

export function installOpenCodeObservationPlugin(
  installation: ObservationHookInstallation,
): Promise<void> {
  return installManagedObservationPlugin(OPENCODE_PLUGIN_SPEC, installation);
}

export function removeOpenCodeObservationPlugin(
  installation: ObservationHookInstallation,
): Promise<void> {
  return removeManagedObservationPlugin(OPENCODE_PLUGIN_SPEC, installation);
}

export function readOpenCodeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
): Promise<ObservedOpenCodeHookEvent | undefined> {
  return readObservationHookEvent(OPENCODE_HOOK_EVENT_TOKENS, spoolDirectory, providerSessionId);
}
