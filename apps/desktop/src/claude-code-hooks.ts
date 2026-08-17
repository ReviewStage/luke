import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isRecord } from "@sidecar/core";
import { canIgnoreFilesystemError } from "./local-session-adapter";

/**
 * Hook-fed observation for Claude Code, strictly additive to the transcript
 * tail the adapter already reads. Claude Code runs a registered command at a
 * session's turn boundaries; ours writes one fixed token into a spool Luke
 * owns, and the adapter reads that token back to answer what the tail alone
 * cannot: a turn that just ended versus a session someone walked away from, a
 * tool call holding for permission, a session that was closed. Everything
 * here degrades to the tail: no registration, no script, and no spool ever
 * costs an observation — they only cost the sharper status.
 *
 * The registration is the one file of a provider's Luke writes, and it is
 * bounded the way the trust constraints demand: entries are merged into
 * `settings.json` beside whatever the user put there, recognized by the
 * script's own name, stripped cleanly on removal, and never written at all
 * when the existing file cannot be parsed — a file Luke cannot read back is a
 * file Luke must not rewrite.
 */

const CLAUDE_SETTINGS_FILE_NAME = "settings.json";
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

/** The spool file holds one fixed token, so anything longer is not ours. */
const HOOK_EVENT_FILE_READ_BYTES = 256;

const HOOK_EVENT_FILE_EXTENSION = ".json";

/**
 * How old a spool file may grow before pruning drops it. An event this far
 * behind cannot out-date any transcript it would refine, and the session
 * behind it has almost always closed for good; a day keeps the spool sized
 * to the sessions actually moving rather than every session ever observed.
 */
export const CLAUDE_HOOK_SPOOL_MAXIMUM_AGE_MS = 24 * 60 * 60 * 1000;

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

const CLAUDE_HOOK_EVENT_LIST: readonly ClaudeHookEvent[] = Object.values(CLAUDE_HOOK_EVENT);

function isClaudeHookEvent(value: unknown): value is ClaudeHookEvent {
  return typeof value === "string" && CLAUDE_HOOK_EVENT_LIST.includes(value as ClaudeHookEvent);
}

/** The latest thing the hook reported about one session, dated by the spool. */
export interface ObservedClaudeHookEvent {
  event: ClaudeHookEvent;
  atMs: number;
}

/**
 * Which Claude Code lifecycle moments are registered, and the token each one
 * hands the script. Turn boundaries and lifecycle edges only: a per-tool-call
 * hook would run a subprocess inside every step of every session for status
 * the transcript tail already carries. The notification entry is matched down
 * to the two kinds that mean the session is holding for the user — a
 * permission prompt and an open question — because those are exactly the
 * moments the transcript shows nothing new.
 */
const CLAUDE_HOOK_REGISTRATION = {
  SessionStart: { event: CLAUDE_HOOK_EVENT.SESSION_START },
  UserPromptSubmit: { event: CLAUDE_HOOK_EVENT.PROMPT },
  Stop: { event: CLAUDE_HOOK_EVENT.STOP },
  StopFailure: { event: CLAUDE_HOOK_EVENT.STOP_FAILURE },
  Notification: {
    event: CLAUDE_HOOK_EVENT.NOTIFICATION,
    matcher: "permission_prompt|elicitation_dialog",
  },
  SessionEnd: { event: CLAUDE_HOOK_EVENT.SESSION_END },
} as const satisfies Record<string, { event: ClaudeHookEvent; matcher?: string }>;

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

/**
 * The script Claude Code runs. It writes one fixed token into the spool and
 * nothing else: the envelope on stdin is read only to name the session, its
 * text never reaches disk, and a token or session id it does not recognize
 * ends it without a write. A missing spool ends it too — that is what turning
 * the setting off means — so a stale registration is an instant no-op.
 */
function claudeHookScript(spoolDirectory: string): string {
  return `#!/bin/sh
# Luke Claude Code observation hook v1
#
# Claude Code runs this at a session's turn boundaries. It writes one fixed
# status token into Luke's own spool — never into any provider file — naming
# the file by the session's own id. The envelope piped in is read only for
# that id; its text never reaches disk. Luke installs and removes this file.

SPOOL_DIRECTORY="${spoolDirectory}"

# The token is fixed at registration, one per hook entry, so nothing piped in
# can choose what is written.
case "$1" in
  ${CLAUDE_HOOK_EVENT_LIST.join("|")}) EVENT_TOKEN="$1" ;;
  *) exit 0 ;;
esac

# No spool means observation hooks are off or Luke is gone; leave quietly.
[ -d "$SPOOL_DIRECTORY" ] || exit 0

ENVELOPE=$(cat)

# A subagent's turns are not the session's: they start and stop while the
# main loop is mid-turn, so recording them would flap the row. The envelope
# names an agent only inside one, at the price that a prompt quoting the
# field's name is skipped too — the transcript still carries that turn.
case "$ENVELOPE" in
  *'"agent_id"'*) exit 0 ;;
esac

# The id becomes the spool file's name, so only the shape Claude Code mints —
# hex and hyphens — is accepted at all.
SESSION_ID=$(printf '%s' "$ENVELOPE" \\
  | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[0-9a-fA-F-]{8,64}"' \\
  | head -n 1 | grep -oE '[0-9a-fA-F-]{8,64}')
[ -n "$SESSION_ID" ] || exit 0

# One tiny file per session, replaced on every event: only the newest event
# matters, and replacement is what bounds the spool. Writing beside the spool
# file and moving over it keeps a concurrent reader off half a write.
TEMPORARY_FILE="$SPOOL_DIRECTORY/.$SESSION_ID.$$.tmp"
printf '{"event":"%s"}' "$EVENT_TOKEN" > "$TEMPORARY_FILE" || exit 0
mv -f "$TEMPORARY_FILE" "$SPOOL_DIRECTORY/$SESSION_ID${HOOK_EVENT_FILE_EXTENSION}"
`;
}

/**
 * The command registered in Claude Code's settings. Guarded on the script
 * being present and executable, so an entry outliving an uninstalled Luke is
 * an instant no-op rather than a "not found" in every session on the machine.
 */
function claudeHookCommand(hookScriptPath: string, event: ClaudeHookEvent): string {
  return `[ -x "${hookScriptPath}" ] && "${hookScriptPath}" ${event} || true`;
}

/**
 * Whether a hook command is one of ours. The script's distinctive file name is
 * the marker, so entries written by an older build — a different data path, a
 * different guard — are still recognized and reconciled rather than left to
 * pile up beside the current one.
 */
function isLukeHookCommand(command: unknown): boolean {
  return typeof command === "string" && command.includes(CLAUDE_HOOK_SCRIPT_NAME);
}

/**
 * Strips Luke's inner hooks from one settings entry, returning the entry
 * unchanged when it is entirely the user's, a copy when it mixed the user's
 * hooks with ours, and nothing when nothing of the user's remains.
 */
function withoutLukeHooks(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return entry;
  const kept = hooks.filter((hook) => !(isRecord(hook) && isLukeHookCommand(hook.command)));
  if (kept.length === hooks.length) return entry;
  if (kept.length === 0) return undefined;
  return { ...entry, hooks: kept };
}

/**
 * Strips Luke's entries from every event in place — including events this
 * build no longer registers, so an entry from an older build is cleaned up by
 * the newer one rather than left behind. Anything that is not the nested
 * shape Claude Code documents is preserved verbatim: a malformed entry is the
 * user's problem to notice, never ours to discard. Answers whether anything
 * of Luke's was actually there, so removal can decline to rewrite a file it
 * only ever read — a formatting difference must not read as a change.
 */
function stripLukeEntries(events: Record<string, unknown>): boolean {
  let stripped = false;
  for (const [eventName, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;
    let strippedHere = false;
    const kept = entries.flatMap((entry) => {
      if (!isRecord(entry)) return [entry];
      const cleaned = withoutLukeHooks(entry);
      if (cleaned !== entry) strippedHere = true;
      return cleaned === undefined ? [] : [cleaned];
    });
    if (!strippedHere) continue;
    stripped = true;
    if (kept.length === 0) delete events[eventName];
    else events[eventName] = kept;
  }
  return stripped;
}

/**
 * The settings content with Luke's current entries in place: the user's own
 * settings and hooks are preserved as parsed, stale Luke entries are stripped
 * everywhere, and one entry per registered event is appended. Nothing is
 * returned for a file that cannot be read as a JSON object — never rewrite a
 * file that cannot be read back.
 */
export function claudeSettingsWithObservationHooks(
  source: string | undefined,
  hookScriptPath: string,
): string | undefined {
  let root: Record<string, unknown> = {};
  if (source !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return undefined;
    }
    if (!isRecord(parsed)) return undefined;
    root = parsed;
  }

  const events = isRecord(root.hooks) ? root.hooks : {};
  root.hooks = events;
  stripLukeEntries(events);

  for (const [eventName, registration] of Object.entries(CLAUDE_HOOK_REGISTRATION)) {
    const existing = events[eventName];
    const kept = Array.isArray(existing) ? existing : [];
    events[eventName] = [
      ...kept,
      {
        ...("matcher" in registration ? { matcher: registration.matcher } : {}),
        hooks: [
          {
            type: "command",
            command: claudeHookCommand(hookScriptPath, registration.event),
            timeout: CLAUDE_HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ];
  }

  return `${JSON.stringify(root, undefined, 2)}\n`;
}

/**
 * The settings content with every Luke entry stripped, or nothing when there
 * is nothing to change — including a file that cannot be parsed, which is
 * left exactly as found for the same reason the merge leaves it.
 */
export function claudeSettingsWithoutObservationHooks(source: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const events = parsed.hooks;
  if (!isRecord(events)) return undefined;
  // Only a file that actually held Luke's entries is written at all. Removal
  // runs at every disabled launch, and a file that merely formats its JSON
  // differently than this module would must be left byte-for-byte alone.
  if (!stripLukeEntries(events)) return undefined;
  if (Object.keys(events).length === 0) delete parsed.hooks;

  return `${JSON.stringify(parsed, undefined, 2)}\n`;
}

async function readFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

/**
 * Replaces the settings file through a sibling temporary file and a rename,
 * because a write interrupted halfway would leave behind the one thing this
 * module refuses to touch again: an unparseable `settings.json` would break
 * the user's own configuration, not just the registration. The original
 * file's mode is carried over — the file is the user's, and so is however
 * they protected it.
 *
 * The rename lands on the file the path finally names, not the path itself: a
 * dotfiles-managed `settings.json` is often a symlink, and renaming over the
 * link would quietly swap it for a plain copy while the synced original went
 * stale. A path that does not resolve yet is a file being created, placed by
 * its directory's own resolution for the same reason.
 */
async function replaceSettingsFile(settingsPath: string, content: string): Promise<void> {
  let targetPath: string;
  try {
    targetPath = await fs.realpath(settingsPath);
  } catch (error) {
    if (!canIgnoreFilesystemError(error)) throw error;
    const directory = await fs
      .realpath(path.dirname(settingsPath))
      .catch(() => path.dirname(settingsPath));
    targetPath = path.join(directory, path.basename(settingsPath));
  }
  let mode = 0o644;
  try {
    mode = (await fs.stat(targetPath)).mode & 0o777;
  } catch (error) {
    if (!canIgnoreFilesystemError(error)) throw error;
  }
  const temporaryPath = `${targetPath}.luke-tmp`;
  await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode });
  // `mode` only applies when the file is created, so a temporary file left
  // behind by an interrupted write keeps whatever mode it already had.
  await fs.chmod(temporaryPath, mode);
  await fs.rename(temporaryPath, targetPath);
}

async function writeFileIfChanged(filePath: string, content: string, mode: number): Promise<void> {
  const existing = await readFileIfPresent(filePath);
  if (existing === content) {
    await fs.chmod(filePath, mode);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf8", mode });
  // `mode` only applies when the file is created; an existing script must not
  // keep whatever mode an older write left it.
  await fs.chmod(filePath, mode);
}

/**
 * Puts the whole arrangement in place: the script, the spool it writes into,
 * and the registration naming the script. Run at every launch while the
 * setting is on — like every other managed piece of Luke's own state, the
 * installation is converged rather than performed once — and safe to run
 * again at any time: an unchanged file is left untouched down to its mtime.
 */
export async function installClaudeCodeObservationHooks(
  installation: ClaudeCodeHookInstallation,
): Promise<void> {
  // A machine with no Claude Code home gets nothing at all: registering would
  // create another product's directory on its behalf, for sessions that do
  // not exist. Installation converges at every launch, so a Claude Code that
  // arrives later is picked up the next time Luke starts.
  try {
    await fs.stat(installation.claudeHome);
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return;
    throw error;
  }

  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  await writeFileIfChanged(
    installation.hookScriptPath,
    claudeHookScript(installation.spoolDirectory),
    0o755,
  );

  const settingsPath = path.join(installation.claudeHome, CLAUDE_SETTINGS_FILE_NAME);
  const source = await readFileIfPresent(settingsPath);
  const merged = claudeSettingsWithObservationHooks(source, installation.hookScriptPath);
  if (merged === undefined || merged === source) return;
  await replaceSettingsFile(settingsPath, merged);
}

/**
 * Takes the whole arrangement back out: the registration entries, the script,
 * and the spool with whatever events it held. The settings file is the one
 * thing never created here — a teardown that leaves new files behind has the
 * relationship backwards — and a file that cannot be parsed is left as found.
 */
export async function removeClaudeCodeObservationHooks(
  installation: ClaudeCodeHookInstallation,
): Promise<void> {
  const settingsPath = path.join(installation.claudeHome, CLAUDE_SETTINGS_FILE_NAME);
  const source = await readFileIfPresent(settingsPath);
  if (source !== undefined) {
    const stripped = claudeSettingsWithoutObservationHooks(source);
    if (stripped !== undefined) await replaceSettingsFile(settingsPath, stripped);
  }
  await fs.rm(installation.hookScriptPath, { force: true });
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });
}

/**
 * Reads what the hook last said about one session: the token, dated by the
 * spool file's own mtime — the one clock the script and the reader share
 * without writing timestamps at all. Only Luke's script writes here, so the
 * mtime cannot suffer the bulk-touch problem the transcripts do. Anything
 * unexpected — no file, a foreign shape, an unknown token — reads as no event,
 * because the tail this refines is always there to fall back on.
 */
export async function readClaudeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
): Promise<ObservedClaudeHookEvent | undefined> {
  const filePath = path.join(spoolDirectory, `${providerSessionId}${HOOK_EVENT_FILE_EXTENSION}`);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (stats.size > HOOK_EVENT_FILE_READ_BYTES) return undefined;
    const content = await handle.readFile({ encoding: "utf8" });
    let record: unknown;
    try {
      record = JSON.parse(content);
    } catch {
      return undefined;
    }
    if (!isRecord(record) || !isClaudeHookEvent(record.event)) return undefined;
    return { event: record.event, atMs: stats.mtimeMs };
  } finally {
    await handle.close();
  }
}

/**
 * Drops spool files old enough that the adapter would no longer read them:
 * an event beyond the observation window refines nothing, and the sessions
 * behind such files are mostly gone for good. Run where install is run, so
 * the spool's size tracks the sessions actually alive rather than every
 * session ever observed.
 */
export async function pruneClaudeHookSpool(
  spoolDirectory: string,
  maximumAgeMs: number,
  now: number,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(spoolDirectory);
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(spoolDirectory, entry);
    try {
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maximumAgeMs) await fs.rm(filePath, { force: true });
    } catch (error) {
      if (!canIgnoreFilesystemError(error)) throw error;
    }
  }
}
