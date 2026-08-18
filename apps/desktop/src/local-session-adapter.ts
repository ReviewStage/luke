import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  agedStatus,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  recordFromJsonLine,
  resolveOptions,
  SESSION_STATUS,
  type SessionProvider,
  SessionProviderAdapterBase,
  type SessionStatus,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/core";

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
}

export function refineStatusWithHookEvent<Event extends string>(
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
    return [...observations.values()];
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * A provider directory that is absent, or that this user cannot read, means
 * Luke observes nothing there — never that the observation pass failed.
 */
export function canIgnoreFilesystemError(error: unknown): boolean {
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
    if (canIgnoreFilesystemError(error)) return [];
    throw error;
  }
}

export async function fileStats(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
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
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

export async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
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
    if (canIgnoreFilesystemError(error)) return "";
    throw error;
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
export function tailRecords(tail: string): Record<string, unknown>[] {
  return tailLines(tail)
    .map(recordFromJsonLine)
    .filter((record): record is Record<string, unknown> => record !== undefined);
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
