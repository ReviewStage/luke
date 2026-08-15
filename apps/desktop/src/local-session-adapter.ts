import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { recordFromJsonLine, UNKNOWN_WORKSPACE_LABEL } from "@sidecar/core";

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

/** How one provider's directory layout turns into session files. */
export interface SessionFileDiscovery<Candidate extends SessionFileCandidate> {
  projectsDirectory: string;
  /**
   * The directory inside a project that its sessions land in, for a provider
   * that keeps them somewhere other than the project directory itself.
   */
  sessionsDirectoryName?: string;
  maximumProjectDirectories: number;
  maximumSessionFiles: number;
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

/**
 * A local session belongs on the surface only while the directory it ran in
 * still exists. Providers retain session metadata after a workspace is
 * deleted, so trusting that stored path would keep an orphaned row forever.
 */
export async function existingWorkspaceDirectory(
  directoryPath: string | undefined,
): Promise<string | undefined> {
  const normalized = directoryPath?.trim();
  if (!normalized) return undefined;
  const stats = await fileStats(normalized);
  return stats?.isDirectory() ? normalized : undefined;
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
  return files
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, discovery.maximumSessionFiles);
}
