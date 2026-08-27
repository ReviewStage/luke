import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ACT_RESULT_STATUS,
  agedStatus,
  OBSERVATION_WINDOW,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  SessionProviderAdapterBase,
  type SessionStatus,
  sessionMessageText,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/session";
import { recordFromJsonLine, resolveOptions, type WireRecord } from "@sidecar/wire";

export function localSessionStatus(
  status: SessionStatus,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (status === SESSION_STATUS.WORKING && now - observedAt > freshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, observedAt, now, freshnessMs);
}

export interface HookEventStatus<Event extends string> {
  event: Event;
  fresh: SessionStatus;
  stale?: SessionStatus;
}

export interface HookStatusRefinement<Event extends string> {
  definitive: readonly HookEventStatus<Event>[];
  fresh: readonly HookEventStatus<Event>[];
  /**
   * The token meaning the session is holding on a question only the developer
   * can answer. It is the one event granted no tolerance against the
   * provider's clock — holding writes nothing, so provider state at or past
   * the event is itself the news that the hold ended — and the one that marks
   * the observation as holding for the developer while it stands. A provider
   * whose hooks carry no such moment omits it, and the honest absence stands.
   */
  notificationEvent?: Event;
  /**
   * The token meaning the provider closed the session for good, which is what
   * lets the observation report the closure as the completion's cause. A
   * provider that fires no closing hook omits it.
   */
  sessionEndEvent?: Event;
}

function refineStatusWithHookEvent<Event extends string>(
  status: SessionStatus,
  event: Event,
  isFresh: boolean,
  refinement: HookStatusRefinement<Event>,
): SessionStatus {
  const definitive = refinement.definitive.find((candidate) => candidate.event === event);
  if (definitive) return definitive.fresh;
  if (status === SESSION_STATUS.COMPLETE || status === SESSION_STATUS.ERROR) return status;
  const candidate = refinement.fresh.find((entry) => entry.event === event);
  if (!candidate) return status;
  return isFresh ? candidate.fresh : (candidate.stale ?? status);
}

/**
 * How much older than the provider's clock a hook event may run and still
 * describe the same moment. The hook fires as a turn boundary happens and the
 * provider's own closing records land moments later under their own
 * timestamps, so a boundary's event usually trails the record it belongs with
 * by a breath — never by more than this. An event further behind describes a
 * turn the provider has already moved past, and refines nothing.
 */
export const HOOK_EVENT_TOLERANCE_MS = 5_000;

/**
 * How long a standing notification hold is believed. A hold is a live fact
 * rather than an inference — answering it writes provider state at or past
 * the event, which discards it — so it rightly outlives the freshness decay.
 * But the proof assumes a process still holding the dialog, and its one
 * failure mode is silent: a process killed mid-hold, a closed terminal tab, a
 * crash, writes neither the answer nor a closing hook, and leaves the event
 * standing for a dialog no longer on any screen. Four hours believes every
 * hold a developer plausibly comes back to — a meeting, a long review, a
 * lunch — and retires a dead one the same working day, instead of pinning
 * "needs you" on a ghost until the day-scale spool prune drops the file.
 */
export const HOOK_NOTIFICATION_HOLD_HORIZON_MS = 4 * 60 * 60 * 1000;

/** What the hook settled for one observation, beyond the status itself. */
export interface HookRefinedStatus {
  status: SessionStatus;
  /**
   * The clock the freshness decay runs on: the provider's own, or the
   * event's when it stands past it.
   */
  observedAt: number;
  /** The provider closed the session, on the hook's word. */
  sessionClosed: boolean;
  /** The session is holding on a question only the developer can answer. */
  holdingForDeveloper: boolean;
}

/**
 * Sharpens a provider's own verdict with what the observation hook last said,
 * in the order the meanings bind: a definitive event outranks the provider,
 * a provider that already settled on complete or error is never talked out
 * of it by a softer event, and the rest refine only a fresh session — the
 * decay to unknown exists because a hook can go silent (a killed process
 * fires no session end), so an old event must age the same way old provider
 * state does. A hook event trailing the provider's clock by more than the
 * tolerance describes a turn the session already moved past, so it is
 * ignored whole. One that stands is proof the session moved — only Luke's
 * own script writes the spool, so its date cannot suffer the bulk-touch
 * problem a provider's files can — and dates the session for the freshness
 * decay as well. A notification alone gets no tolerance: a granted
 * permission must not read as waiting for even one more pass. It is also the
 * one event with a horizon of its own: its hold rightly outlives the
 * freshness decay, because holding writes nothing and the standing event is
 * the proof, but that proof holds only while a process is alive to show the
 * dialog, so past {@link HOOK_NOTIFICATION_HOLD_HORIZON_MS} the event is
 * ignored whole too and the provider's own state answers alone.
 */
export function hookRefinedStatus<Event extends string>(options: {
  refinement: HookStatusRefinement<Event>;
  /** The spool's last word about the session, if the hook said anything. */
  hookEvent: { event: Event; atMs: number } | undefined;
  /** When the provider's own state last said the session moved. */
  providerAtMs: number;
  /** The provider's own verdict, given the clock the refinement settles on. */
  statusAt: (observedAt: number) => SessionStatus;
  now: number;
  activeSessionFreshnessMs: number;
}): HookRefinedStatus {
  const { refinement, hookEvent, providerAtMs } = options;
  const isNotification =
    refinement.notificationEvent !== undefined && hookEvent?.event === refinement.notificationEvent;
  const toleranceMs = isNotification ? 0 : HOOK_EVENT_TOLERANCE_MS;
  const eventStands =
    hookEvent !== undefined &&
    hookEvent.atMs + toleranceMs >= providerAtMs &&
    !(isNotification && options.now - hookEvent.atMs > HOOK_NOTIFICATION_HOLD_HORIZON_MS);
  const observedAt = eventStands ? Math.max(providerAtMs, hookEvent.atMs) : providerAtMs;
  let status = options.statusAt(observedAt);
  if (eventStands) {
    const isFresh = options.now - observedAt <= options.activeSessionFreshnessMs;
    status = refineStatusWithHookEvent(status, hookEvent.event, isFresh, refinement);
  }
  return {
    status,
    observedAt,
    sessionClosed:
      status === SESSION_STATUS.COMPLETE &&
      eventStands &&
      hookEvent.event === refinement.sessionEndEvent,
    holdingForDeveloper:
      status === SESSION_STATUS.WAITING &&
      eventStands &&
      hookEvent.event === refinement.notificationEvent,
  };
}

/**
 * The shared half of every adapter that observes sessions on this machine:
 * bounded, failure-tolerant reads of the files a provider already writes for
 * itself. Nothing here opens a file for writing, and no caller may.
 */

/** How much of a transcript one local observation pass may read. */
export const LOCAL_ADAPTER_DEFAULTS = {
  READ_TAIL_BYTES: 64 * 1024,
} as const;

export interface DirectoryEntry {
  directoryPath: string;
  name: string;
  stats: Stats;
}

/** The least an adapter has to know about a session file to place it in time. */
export interface SessionFileCandidate {
  filePath: string;
  providerSessionId: string;
  mtimeMs: number;
}

export function sessionIdFromFileName(fileName: string, extension: string): string | undefined {
  if (!fileName.endsWith(extension)) return undefined;
  const providerSessionId = fileName.slice(0, -extension.length).trim();
  return providerSessionId || undefined;
}

export interface LocalSessionAdapterOptions {
  now?: () => number;
  activeSessionFreshnessMs?: number;
}

/**
 * The shared observation lifecycle for transcript-backed local providers:
 * discover, prepare provider-specific lookup state, parse only changed files,
 * assemble one observation per session, and prune parses for vanished files.
 */
export abstract class LocalSessionAdapter extends SessionProviderAdapterBase {
  readonly #now: () => number;
  #observations: readonly ProviderSessionObservation[] = [];
  protected readonly activeSessionFreshnessMs: number;

  protected constructor(options: LocalSessionAdapterOptions = {}) {
    super();
    this.#now = options.now ?? Date.now;
    const resolved = resolveOptions(
      options,
      { activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS },
      { nonNegative: ["activeSessionFreshnessMs"] },
    );
    this.activeSessionFreshnessMs = resolved.activeSessionFreshnessMs;
  }

  protected observationTime(): number {
    return this.#now();
  }

  /** Publishes exactly the roster a local write must re-check against. */
  protected observed(
    observations: readonly ProviderSessionObservation[],
  ): readonly ProviderSessionObservation[] {
    this.#observations = observations;
    return observations;
  }

  /**
   * Shared local-message guard. A local adapter gains no write by inheriting
   * this: the default delivery remains unsupported. An adapter that overrides
   * `deliverMessage` receives only a session the latest roster advertised and
   * already-bounded developer text.
   */
  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    const observation = this.#observations.find(
      (candidate) => candidate.providerSessionId === message.providerSessionId,
    );
    if (!observation?.canReceiveMessage) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    }
    const text = sessionMessageText(message.text);
    if (!text) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That message is empty or too long.",
      };
    }
    return this.deliverMessage(observation, text);
  }

  protected async deliverMessage(
    _observation: ProviderSessionObservation,
    _text: string,
  ): Promise<ProviderMessageResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider has no such control.",
    };
  }
}

export abstract class LocalFileSessionAdapter<
  Candidate extends SessionFileCandidate,
  Parsed,
> extends LocalSessionAdapter {
  abstract override readonly provider: SessionProvider;

  readonly #parsed = new Map<string, { mtimeMs: number; value: Parsed }>();

  protected constructor(options: LocalSessionAdapterOptions = {}) {
    super(options);
  }

  protected abstract discover(): Promise<readonly Candidate[]>;
  protected abstract parse(candidate: Candidate): Promise<Parsed>;
  protected abstract observation(
    candidate: Candidate,
    parsed: Parsed,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> | ProviderSessionObservation;

  protected prepare(_candidates: readonly Candidate[]): Promise<void> | void {}

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.observationTime();
    const candidates = await this.discover();
    await this.prepare(candidates);
    const observations = new Map<string, ProviderSessionObservation>();
    for (const candidate of candidates) {
      if (observations.has(candidate.providerSessionId)) continue;
      const cached = this.#parsed.get(candidate.filePath);
      const parsed =
        cached?.mtimeMs === candidate.mtimeMs ? cached.value : await this.parseAndCache(candidate);
      observations.set(
        candidate.providerSessionId,
        await this.observation(candidate, parsed, now, this.activeSessionFreshnessMs),
      );
    }
    const discovered = new Set(candidates.map((candidate) => candidate.filePath));
    for (const filePath of this.#parsed.keys()) {
      if (!discovered.has(filePath)) this.#parsed.delete(filePath);
    }
    return this.observed([...observations.values()]);
  }

  private async parseAndCache(candidate: Candidate): Promise<Parsed> {
    const value = await this.parse(candidate);
    this.#parsed.set(candidate.filePath, { mtimeMs: candidate.mtimeMs, value });
    return value;
  }
}

/** How one provider's directory layout turns into session files. */
export interface SessionFileDiscovery<Candidate extends SessionFileCandidate> {
  projectsDirectory: string;
  /**
   * The directory inside a project that its sessions land in, for a provider
   * that keeps them somewhere other than the project directory itself.
   */
  sessionsDirectoryName?: string;
  maximumProjectDirectories: number;
  sessionFilesIn: (sessionsDirectory: string, project: DirectoryEntry) => Promise<Candidate[]>;
}

/** Where one project keeps its sessions, and when it last started one. */
interface ProjectSessionsDirectory {
  project: DirectoryEntry;
  sessionsDirectory: string;
  mtimeMs: number;
}

function isNodeError(error: Error): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A provider directory that is absent, or that this user cannot read, means
 * Luke observes nothing there — never that the observation pass failed.
 */
export function canIgnoreFilesystemError(error: Error): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

export async function readDirectory(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return [];
  }
}

export async function fileStats(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return undefined;
  }
}

/** `lstat`, so a link out of a provider directory is never followed. */
export async function statDirectoryEntry(
  directoryPath: string,
  name: string,
): Promise<DirectoryEntry | undefined> {
  const entryPath = path.join(directoryPath, name);
  try {
    const stats = await fs.lstat(entryPath);
    return { directoryPath: entryPath, name, stats };
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return undefined;
  }
}

export async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return undefined;
  }
}

/**
 * Reads a bounded region of a session file. A transcript grows without bound,
 * so no adapter may read one whole, and the file is opened for reading alone.
 */
async function readRegion(
  filePath: string,
  maximumBytes: number,
  offset: (size: number, length: number) => number,
): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0) return "";
    const length = Math.min(stats.size, maximumBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset(stats.size, length));
    return buffer.toString("utf8");
  } catch (error) {
    if (!(error instanceof Error) || !canIgnoreFilesystemError(error)) throw error;
    return "";
  } finally {
    await handle?.close();
  }
}

/** The end of a session file, where its newest records say what it is doing. */
export function readTail(filePath: string, maximumBytes: number): Promise<string> {
  return readRegion(filePath, maximumBytes, (size, length) => size - length);
}

/** The start of a session file, for the records a provider writes only once. */
export function readHead(filePath: string, maximumBytes: number): Promise<string> {
  return readRegion(filePath, maximumBytes, () => 0);
}

function tailLines(tail: string): string[] {
  const lines = tail.split(/\r?\n/).filter((line) => line.trim().length > 0);
  // A bounded read lands mid-record, and a provider appending right now can
  // leave the last one unfinished; neither half-record is a record.
  if (!tail.startsWith("{")) lines.shift();
  return lines;
}

/** The whole records a tail holds, oldest first. */
export function tailRecords(tail: string): WireRecord[] {
  return tailLines(tail)
    .map(recordFromJsonLine)
    .filter((record): record is WireRecord => record !== undefined);
}

/** Sessions are labelled by the folder they run in, never by a provider's own name for them. */
export function workspaceLabel(directoryPath: string | undefined): string {
  if (!directoryPath) return UNKNOWN_WORKSPACE_LABEL;
  const label = path.basename(directoryPath.trim());
  return label || UNKNOWN_WORKSPACE_LABEL;
}

/** Drops duplicate paths while keeping first-seen order. */
export function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Places a project in time by the directory its sessions land in, which is the
 * one a new session moves. A project directory's own mtime stops moving the
 * moment a provider nests its transcripts inside it — nothing done to a session
 * afterwards reaches it — so ranking by it would rank a folder used every day
 * by the day the provider first wrote there. A project with no sessions
 * directory has no sessions, and takes none of the bound below.
 */
async function projectSessionsDirectory(
  project: DirectoryEntry,
  sessionsDirectoryName: string | undefined,
): Promise<ProjectSessionsDirectory | undefined> {
  if (sessionsDirectoryName === undefined) {
    return {
      project,
      sessionsDirectory: project.directoryPath,
      mtimeMs: project.stats.mtimeMs,
    };
  }
  const sessionsDirectory = path.join(project.directoryPath, sessionsDirectoryName);
  const stats = await fileStats(sessionsDirectory);
  if (!stats?.isDirectory()) return undefined;
  return { project, sessionsDirectory, mtimeMs: stats.mtimeMs };
}

/**
 * Finds the newest session files across a provider's project directories. Both
 * levels are bounded and ordered by recency, so a machine with years of
 * projects costs the same pass as a machine with one. A directory's mtime does
 * not move when a file inside it is appended to, so the project bound keeps the
 * projects that most recently *started* a session; the session bound that
 * follows it is ordered by each transcript's own last write.
 */
export async function discoverSessionFiles<Candidate extends SessionFileCandidate>(
  discovery: SessionFileDiscovery<Candidate>,
): Promise<Candidate[]> {
  const entries = await readDirectory(discovery.projectsDirectory);
  const projects = (
    await Promise.all(
      entries.map((entry) => statDirectoryEntry(discovery.projectsDirectory, entry.name)),
    )
  ).filter((entry): entry is DirectoryEntry => entry?.stats.isDirectory() === true);

  const sessionsDirectories = (
    await Promise.all(
      projects.map((project) => projectSessionsDirectory(project, discovery.sessionsDirectoryName)),
    )
  )
    .filter((entry): entry is ProjectSessionsDirectory => entry !== undefined)
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, discovery.maximumProjectDirectories);

  const files = (
    await Promise.all(
      sessionsDirectories.map((entry) =>
        discovery.sessionFilesIn(entry.sessionsDirectory, entry.project),
      ),
    )
  ).flat();
  // Newest first, so a duplicate session id resolves to its latest file.
  // There is deliberately no cap: a conversation is never dropped for being
  // old, and what keeps a pass cheap is each adapter re-reading only the
  // files that changed since the last one.
  return files.sort((first, second) => second.mtimeMs - first.mtimeMs);
}
