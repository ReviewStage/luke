import fs from "node:fs/promises";
import path from "node:path";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/core";
import { canIgnoreFilesystemError } from "./local-session-adapter";
import {
  wireRecord as readWireRecord,
  unparsedWire,
  type WireBoundaryInput,
} from "./wire-boundary";

/**
 * Hook-fed observation for the local providers that register hooks at all,
 * strictly additive to the state their adapters already read. A provider runs
 * a registered command at a session's turn boundaries; ours writes one fixed
 * token into a spool Luke owns, and the adapter reads that token back to
 * answer what the provider's own files alone cannot: a turn that just ended
 * versus a session someone walked away from, a session that was closed.
 * Everything here degrades to those files: no registration, no script, and no
 * spool ever costs an observation — they only cost the sharper status.
 *
 * The registration is the one file of a provider's Luke writes, and it is
 * bounded the way the trust constraints demand: entries are merged into the
 * provider's own hook configuration beside whatever the user put there,
 * recognized by the script's own name, stripped cleanly on removal, and never
 * written at all when the existing file cannot be parsed — a file Luke cannot
 * read back is a file Luke must not rewrite.
 *
 * One module, described per provider: everything a provider decides — its
 * hook file, its event names, how it hands the script its envelope — lives in
 * an {@link ObservationHookSpec}, and everything this module guarantees holds
 * for every spec alike. Widening to another provider is a product decision;
 * this module only keeps the widened set to one discipline.
 */

/** The spool file holds one fixed token, so anything longer is not ours. */
const HOOK_EVENT_FILE_READ_BYTES = 256;

const HOOK_EVENT_FILE_EXTENSION = ".json";

/**
 * How old a spool file may grow before pruning drops it. An event this far
 * behind cannot out-date any state it would refine, and the session behind it
 * has almost always closed for good; a day keeps the spool sized to the
 * sessions actually moving rather than every session ever observed.
 */
export const HOOK_SPOOL_MAXIMUM_AGE_MS = 24 * 60 * 60 * 1000;

/** One registered entry: the lifecycle event, and the token its hook writes. */
export interface ObservationHookRegistration<Event extends string> {
  event: Event;
  /** The provider-defined matcher narrowing which occurrences fire at all. */
  matcher?: string;
}

/**
 * Everything one provider decides about its observation hooks. The guarantees
 * — merge beside the user's entries, refuse an unparseable file, converge at
 * every launch, no envelope text on disk — are the module's; the spec only
 * names the provider's shapes.
 */
export interface ObservationHookSpec<Event extends string> {
  /**
   * The script's file name, which is also the marker a managed entry is
   * recognized by — so renaming it is a migration: an entry naming the old
   // SAFETY: The preceding check establishes the asserted contract.
   * script would stop being recognized as ours and would be left behind.
   */
  scriptName: string;
  /** The provider's own hook-configuration file, inside its home directory. */
  configurationFileName: string;
  /** The first line of the script's comment header, naming the provider. */
  scriptTitle: string;
  /**
   * Which lifecycle moments are registered, keyed by the provider's own event
   * names, and the token each one hands the script.
   */
  registration: Readonly<Record<string, ObservationHookRegistration<Event>>>;
  /**
   * How long the provider lets the spool write run before giving up on it,
   * for a provider whose entries take a timeout at all.
   */
  timeoutSeconds?: number;
  /** The envelope field naming the session the event belongs to. */
  sessionIdField: string;
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * The shape the provider's session ids take, as a POSIX ERE. The id becomes
   * the spool file's name, so nothing outside this shape is accepted at all.
   */
  sessionIdPattern: string;
  /**
   * An envelope field whose presence marks a subagent's event, skipped whole
   * — a subagent's turns start and stop while the main loop is mid-turn, so
   * recording them would flap the row.
   */
  subagentField?: string;
}

/** Where one installed arrangement lives: the provider's home, and Luke's own. */
export interface ObservationHookInstallation {
  /** The provider's own home, holding the configuration entries merge into. */
  providerHome: string;
  /** Where Luke keeps the script, under Luke's own application data. */
  hookScriptPath: string;
  /** Where the script writes its event files, under Luke's own data too. */
  spoolDirectory: string;
}

/** The latest thing a hook reported about one session, dated by the spool. */
export interface ObservedHookEvent<Event extends string> {
  event: Event;
  atMs: number;
}

function eventTokens<Event extends string>(spec: ObservationHookSpec<Event>): Event[] {
  return [...new Set(Object.values(spec.registration).map((entry) => entry.event))];
}

/**
 * The script a provider runs. It writes one fixed token into the spool and
 * nothing else: the envelope is read only to name the session, its text never
 * reaches disk, and a token or session id it does not recognize ends it
 * without a write. A missing spool ends it too — that is what turning
 * observation hooks off means — so a stale registration is an instant no-op.
 *
 * The envelope arrives however the provider hands it over — piped on stdin,
 // SAFETY: The preceding check establishes the asserted contract.
 * or passed as the argument after the token — so one script text serves every
 * spec: a provider that passes nothing on stdin must not leave the script
 * waiting on a pipe that never closes.
 */
function observationHookScript<Event extends string>(
  spec: ObservationHookSpec<Event>,
  spoolDirectory: string,
): string {
  const subagentSkip = spec.subagentField
    ? `
# A subagent's turns are not the session's: they start and stop while the
# main loop is mid-turn, so recording them would flap the row. The envelope
# names an agent only inside one, at the price that a prompt quoting the
# field with a value is skipped too — the session's own files still carry
# that turn.
if printf '%s' "$ENVELOPE" \\
  | grep -qE '"${spec.subagentField}"[[:space:]]*:[[:space:]]*"[^"]+"'; then
  exit 0
fi
`
    : "";
  return `#!/bin/sh
# ${spec.scriptTitle}
#
# The provider runs this at a session's turn boundaries. It writes one fixed
# status token into Luke's own spool — never into any provider file — naming
# the file by the session's own id. The envelope handed in is read only for
# that id; its text never reaches disk. Luke installs and removes this file.

SPOOL_DIRECTORY="${spoolDirectory}"

# The token is fixed at registration, one per hook entry, so nothing handed in
# can choose what is written.
case "$1" in
  ${eventTokens(spec).join("|")}) EVENT_TOKEN="$1" ;;
  *) exit 0 ;;
esac

# No spool means observation hooks are off or Luke is gone; leave quietly.
[ -d "$SPOOL_DIRECTORY" ] || exit 0

// SAFETY: The preceding check establishes the asserted contract.
# The envelope rides in as the argument after the token where the provider
# passes one, and on stdin where it pipes instead.
if [ "$#" -ge 2 ]; then ENVELOPE="$2"; else ENVELOPE=$(cat); fi
${subagentSkip}
# The id becomes the spool file's name, so only the shape the provider mints
# is accepted at all.
SESSION_ID=$(printf '%s' "$ENVELOPE" \\
  | grep -oE '"${spec.sessionIdField}"[[:space:]]*:[[:space:]]*"${spec.sessionIdPattern}"' \\
  | head -n 1 | grep -oE '${spec.sessionIdPattern}')
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
 * The command registered in the provider's configuration. Guarded on the
 * script being present and executable, so an entry outliving an uninstalled
 * Luke is an instant no-op rather than a "not found" in every session on the
 * machine — and always exiting zero, so no provider can read a missing spool
 // SAFETY: The preceding check establishes the asserted contract.
 * as a decision.
 */
function observationHookCommand<Event extends string>(
  hookScriptPath: string,
  event: Event,
): string {
  return `[ -x "${hookScriptPath}" ] && "${hookScriptPath}" ${event} || true`;
}

/**
 * Whether a hook command is one of ours. The script's distinctive file name is
 * the marker, so entries written by an older build — a different data path, a
 * different guard — are still recognized and reconciled rather than left to
 * pile up beside the current one.
 */
function isLukeHookCommand(command: UnparsedWireValue, scriptName: string): boolean {
  return isWireString(command) && command.includes(scriptName);
}

/**
 * Strips Luke's inner hooks from one settings entry, returning the entry
 * unchanged when it is entirely the user's, a copy when it mixed the user's
 * hooks with ours, and nothing when nothing of the user's remains.
 */
function withoutLukeHooks(entry: WireRecord, scriptName: string): WireRecord | undefined {
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return entry;
  const kept = hooks.filter(
    (hook) => !(isRecord(hook) && isLukeHookCommand(hook.command, scriptName)),
  );
  if (kept.length === hooks.length) return entry;
  if (kept.length === 0) return undefined;
  return { ...entry, hooks: kept };
}

/**
 * Strips Luke's entries from every event in place — including events this
 * build no longer registers, so an entry from an older build is cleaned up by
 * the newer one rather than left behind. Anything that is not the nested
 * shape the provider documents is preserved verbatim: a malformed entry is
 * the user's problem to notice, never ours to discard. Answers whether
 * anything of Luke's was actually there, so removal can decline to rewrite a
 // SAFETY: The preceding check establishes the asserted contract.
 * file it only ever read — a formatting difference must not read as a change.
 */
/** A JSON object this module may rewrite while merging hook entries. */
type MutableWireRecord = { [key: string]: WireValue };

function createMutableWireRecord(): MutableWireRecord {
  return {};
}

function mutableHooks(root: MutableWireRecord): MutableWireRecord {
  const hooks = readWireRecord(unparsedWire(root.hooks));
  return hooks ? { ...hooks } : createMutableWireRecord();
}

function stripLukeEntries(events: MutableWireRecord, scriptName: string): boolean {
  let stripped = false;
  for (const [eventName, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;
    let strippedHere = false;
    const kept = entries.flatMap((entry) => {
      if (!isRecord(entry)) return [entry];
      const cleaned = withoutLukeHooks(entry, scriptName);
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
 * The configuration content with Luke's current entries in place: the user's
 // SAFETY: The preceding check establishes the asserted contract.
 * own settings and hooks are preserved as parsed, stale Luke entries are
 * stripped everywhere, and one entry per registered event is appended.
 // SAFETY: The preceding check establishes the asserted contract.
 * Nothing is returned for a file that cannot be read as a JSON object — never
 * rewrite a file that cannot be read back.
 */
export function configurationWithObservationHooks<Event extends string>(
  spec: ObservationHookSpec<Event>,
  source: string | undefined,
  hookScriptPath: string,
): string | undefined {
  let root = createMutableWireRecord();
  if (source !== undefined) {
    let parsed: WireBoundaryInput;
    try {
      parsed = JSON.parse(source);
    } catch {
      return undefined;
    }
    const record = readWireRecord(unparsedWire(parsed));
    if (!record) return undefined;
    root = { ...record };
  }

  const events = mutableHooks(root);
  root.hooks = events;
  stripLukeEntries(events, spec.scriptName);

  for (const [eventName, registration] of Object.entries(spec.registration)) {
    const existing = events[eventName];
    const kept = Array.isArray(existing) ? existing : [];
    events[eventName] = [
      ...kept,
      {
        ...(registration.matcher !== undefined ? { matcher: registration.matcher } : undefined),
        hooks: [
          {
            type: "command",
            command: observationHookCommand(hookScriptPath, registration.event),
            ...(spec.timeoutSeconds !== undefined ? { timeout: spec.timeoutSeconds } : undefined),
          },
        ],
      },
    ];
  }

  return `${JSON.stringify(root, undefined, 2)}\n`;
}

/**
 * The configuration content with every Luke entry stripped, or nothing when
 * there is nothing to change — including a file that cannot be parsed, which
 // SAFETY: The preceding check establishes the asserted contract.
 * is left exactly as found for the same reason the merge leaves it.
 */
export function configurationWithoutObservationHooks<Event extends string>(
  spec: ObservationHookSpec<Event>,
  source: string,
): string | undefined {
  let parsed: WireBoundaryInput;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  const parsedRecord = readWireRecord(unparsedWire(parsed));
  if (!parsedRecord) return undefined;

  const root = { ...parsedRecord };
  const events = mutableHooks(root);
  if (!readWireRecord(unparsedWire(root.hooks))) return undefined;
  if (!stripLukeEntries(events, spec.scriptName)) return undefined;
  if (Object.keys(events).length === 0) delete root.hooks;
  else root.hooks = events;

  return `${JSON.stringify(root, undefined, 2)}\n`;
}

async function readFileIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

/**
 * Replaces the configuration file through a sibling temporary file and a
 * rename, because a write interrupted halfway would leave behind the one
 * thing this module refuses to touch again: an unparseable configuration
 * would break the user's own setup, not just the registration. The original
 * file's mode is carried over — the file is the user's, and so is however
 * they protected it.
 *
 * The rename lands on the file the path finally names, not the path itself: a
 * dotfiles-managed configuration is often a symlink, and renaming over the
 * link would quietly swap it for a plain copy while the synced original went
 * stale. A path that does not resolve yet is a file being created, placed by
 * its directory's own resolution for the same reason.
 */
async function replaceConfigurationFile(configurationPath: string, content: string): Promise<void> {
  let targetPath: string;
  try {
    targetPath = await fs.realpath(configurationPath);
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    const directory = await fs
      .realpath(path.dirname(configurationPath))
      .catch(() => path.dirname(configurationPath));
    targetPath = path.join(directory, path.basename(configurationPath));
  }
  let mode = 0o644;
  try {
    mode = (await fs.stat(targetPath)).mode & 0o777;
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
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
 * and the registration naming the script. Run at every launch — like every
 * other managed piece of Luke's own state, the installation is converged
 * rather than performed once — and safe to run again at any time: an
 * unchanged file is left untouched down to its mtime.
 */
export async function installObservationHooks<Event extends string>(
  spec: ObservationHookSpec<Event>,
  installation: ObservationHookInstallation,
): Promise<void> {
  // A machine with no provider home gets nothing at all: registering would
  // create another product's directory on its behalf, for sessions that do
  // not exist. Installation converges at every launch, so a provider that
  // arrives later is picked up the next time Luke starts.
  try {
    await fs.stat(installation.providerHome);
  } catch (error) {
    if (error instanceof Error && canIgnoreFilesystemError(error)) return;
    throw error;
  }

  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  await writeFileIfChanged(
    installation.hookScriptPath,
    observationHookScript(spec, installation.spoolDirectory),
    0o755,
  );

  const configurationPath = path.join(installation.providerHome, spec.configurationFileName);
  const source = await readFileIfPresent(configurationPath);
  const merged = configurationWithObservationHooks(spec, source, installation.hookScriptPath);
  if (merged === undefined || merged === source) return;
  await replaceConfigurationFile(configurationPath, merged);
}

/**
 * Takes the whole arrangement back out: the registration entries, the script,
 * and the spool with whatever events it held. The configuration file is the
 * one thing never created here — a teardown that leaves new files behind has
 * the relationship backwards — and a file that cannot be parsed is left as
 * found.
 */
export async function removeObservationHooks<Event extends string>(
  spec: ObservationHookSpec<Event>,
  installation: ObservationHookInstallation,
): Promise<void> {
  const configurationPath = path.join(installation.providerHome, spec.configurationFileName);
  const source = await readFileIfPresent(configurationPath);
  if (source !== undefined) {
    const stripped = configurationWithoutObservationHooks(spec, source);
    if (stripped !== undefined) await replaceConfigurationFile(configurationPath, stripped);
  }
  await fs.rm(installation.hookScriptPath, { force: true });
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });
}

/**
 * Reads what the hook last said about one session: the token, dated by the
 * spool file's own mtime — the one clock the script and the reader share
 * without writing timestamps at all. Only Luke's script writes here, so the
 * mtime cannot suffer the bulk-touch problem a provider's own files do.
 * Anything unexpected — no file, a foreign shape, an unknown token — reads as
 * no event, because the state this refines is always there to fall back on.
 */
export async function readObservationHookEvent<Event extends string>(
  spec: ObservationHookSpec<Event>,
  spoolDirectory: string,
  providerSessionId: string,
): Promise<ObservedHookEvent<Event> | undefined> {
  const filePath = path.join(spoolDirectory, `${providerSessionId}${HOOK_EVENT_FILE_EXTENSION}`);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    if (error instanceof Error && canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (stats.size > HOOK_EVENT_FILE_READ_BYTES) return undefined;
    const content = await handle.readFile({ encoding: "utf8" });
    let parsed: WireBoundaryInput;
    try {
      parsed = JSON.parse(content);
    } catch {
      return undefined;
    }
    const wire = readWireRecord(unparsedWire(parsed));
    if (!wire) return undefined;
    const tokens: readonly string[] = eventTokens(spec);
    if (!isWireString(wire.event) || !tokens.includes(wire.event)) return undefined;
    // SAFETY: eventTokens validated wire.event against the hook spec's allowed events.
    return { event: wire.event as Event, atMs: stats.mtimeMs };
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
export async function pruneObservationHookSpool(
  spoolDirectory: string,
  maximumAgeMs: number,
  now: number,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(spoolDirectory);
  } catch (error) {
    if (error instanceof Error && canIgnoreFilesystemError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(spoolDirectory, entry);
    try {
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maximumAgeMs) await fs.rm(filePath, { force: true });
    } catch (error) {
      if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    }
  }
}

interface BoundObservationHookInstallation {
  hookScriptPath: string;
  spoolDirectory: string;
}

export function observationHooksFor<
  Event extends string,
  Installation extends BoundObservationHookInstallation,
>(spec: ObservationHookSpec<Event>, providerHome: (installation: Installation) => string) {
  const sharedInstallation = (installation: Installation): ObservationHookInstallation => ({
    providerHome: providerHome(installation),
    hookScriptPath: installation.hookScriptPath,
    spoolDirectory: installation.spoolDirectory,
  });
  return {
    install: (installation: Installation) =>
      installObservationHooks(spec, sharedInstallation(installation)),
    remove: (installation: Installation) =>
      removeObservationHooks(spec, sharedInstallation(installation)),
    read: (spoolDirectory: string, providerSessionId: string) =>
      readObservationHookEvent(spec, spoolDirectory, providerSessionId),
    prune: pruneObservationHookSpool,
  } as const;
}
