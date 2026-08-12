import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderAdapter,
} from "@sidecar/core";

const CLAUDE_CODE_PROVIDER_ID = "claude-code";
const CLAUDE_CODE_PROVIDER_NAME = "Claude Code";
const CLAUDE_PROJECTS_DIRECTORY = "projects";
const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";
const UNKNOWN_WORKSPACE_LABEL = "workspace";

const CLAUDE_ENVIRONMENT = {
  CONFIG_DIRECTORY: "CLAUDE_CONFIG_DIR",
} as const;

const CLAUDE_EVENT_TYPE = {
  ASSISTANT: "assistant",
  RESULT: "result",
  SUMMARY: "summary",
  SYSTEM: "system",
  USER: "user",
} as const;

type ClaudeEventType = (typeof CLAUDE_EVENT_TYPE)[keyof typeof CLAUDE_EVENT_TYPE];

const CLAUDE_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_SESSION_FILES: 40,
  MAXIMUM_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
  ACTIVE_SESSION_FRESHNESS_MS: 15 * 60 * 1000,
  READ_TAIL_BYTES: 64 * 1024,
} as const;

export const CLAUDE_CODE_PROVIDER: SessionProvider = {
  id: CLAUDE_CODE_PROVIDER_ID,
  displayName: CLAUDE_CODE_PROVIDER_NAME,
};

export interface ClaudeCodeAdapterOptions {
  claudeHome?: string;
  now?: () => number;
  maximumProjectDirectories?: number;
  maximumSessionFiles?: number;
  maximumSessionAgeMs?: number;
  activeSessionFreshnessMs?: number;
  readTailBytes?: number;
}

interface SessionFileCandidate {
  filePath: string;
  providerSessionId: string;
  mtimeMs: number;
}

interface ParsedClaudeSessionTail {
  cwd?: string;
  eventType?: ClaudeEventType;
  timestampMs?: number;
}

interface DirectoryEntry {
  directoryPath: string;
  name: string;
  stats: Stats;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function canIgnoreFilesystemError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

async function readDirectory(directoryPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return [];
    throw error;
  }
}

async function statDirectoryEntry(
  directoryPath: string,
  entry: Dirent,
): Promise<DirectoryEntry | undefined> {
  const entryPath = path.join(directoryPath, entry.name);
  try {
    const stats = await fs.lstat(entryPath);
    return { directoryPath: entryPath, name: entry.name, stats };
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return undefined;
    throw error;
  }
}

function sessionIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(CLAUDE_SESSION_FILE_EXTENSION)) return undefined;
  const providerSessionId = fileName.slice(0, -CLAUDE_SESSION_FILE_EXTENSION.length).trim();
  return providerSessionId || undefined;
}

async function sessionFilesInProject(
  projectDirectory: DirectoryEntry,
): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory.directoryPath);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name);
      if (!providerSessionId) return undefined;
      const candidate = await statDirectoryEntry(projectDirectory.directoryPath, entry);
      if (!candidate?.stats.isFile()) return undefined;
      return {
        filePath: candidate.directoryPath,
        providerSessionId,
        mtimeMs: candidate.stats.mtimeMs,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is SessionFileCandidate => candidate !== undefined,
  );
}

async function discoverSessionFiles(
  projectsDirectory: string,
  maximumProjectDirectories: number,
  maximumSessionFiles: number,
): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectsDirectory);
  const projectDirectories = (
    await Promise.all(entries.map((entry) => statDirectoryEntry(projectsDirectory, entry)))
  )
    .filter((entry): entry is DirectoryEntry => entry?.stats.isDirectory() === true)
    .sort((first, second) => second.stats.mtimeMs - first.stats.mtimeMs)
    .slice(0, maximumProjectDirectories);

  const files = (await Promise.all(projectDirectories.map(sessionFilesInProject))).flat();
  return files
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, maximumSessionFiles);
}

async function readTail(filePath: string, maximumBytes: number): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0) return "";
    const length = Math.min(stats.size, maximumBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stats.size - length);
    return buffer.toString("utf8");
  } catch (error) {
    if (canIgnoreFilesystemError(error)) return "";
    throw error;
  } finally {
    await handle?.close();
  }
}

function tailLines(tail: string): string[] {
  const lines = tail.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!tail.startsWith("{")) lines.shift();
  return lines;
}

function recordFromJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function eventTypeFromRecord(record: Record<string, unknown>): ClaudeEventType | undefined {
  const eventType = record.type;
  return typeof eventType === "string" &&
    Object.values(CLAUDE_EVENT_TYPE).includes(eventType as ClaudeEventType)
    ? (eventType as ClaudeEventType)
    : undefined;
}

function timestampFromRecord(record: Record<string, unknown>): number | undefined {
  const timestamp = record.timestamp;
  if (typeof timestamp !== "string") return undefined;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function cwdFromRecord(record: Record<string, unknown>): string | undefined {
  const cwd = record.cwd;
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : undefined;
}

function parseClaudeSessionTail(tail: string): ParsedClaudeSessionTail {
  const parsed: ParsedClaudeSessionTail = {};
  for (const line of tailLines(tail)) {
    const record = recordFromJsonLine(line);
    if (!record) continue;
    parsed.cwd = cwdFromRecord(record) ?? parsed.cwd;
    parsed.timestampMs = timestampFromRecord(record) ?? parsed.timestampMs;
    parsed.eventType = eventTypeFromRecord(record) ?? parsed.eventType;
  }
  return parsed;
}

function statusFromTail(
  parsed: ParsedClaudeSessionTail,
  observedAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  const isFresh = now - observedAt <= activeSessionFreshnessMs;
  if (parsed.eventType === CLAUDE_EVENT_TYPE.RESULT) return SESSION_STATUS.COMPLETE;
  if (parsed.eventType === CLAUDE_EVENT_TYPE.ASSISTANT) {
    return isFresh ? SESSION_STATUS.WAITING : SESSION_STATUS.UNKNOWN;
  }
  if (parsed.eventType === CLAUDE_EVENT_TYPE.USER) {
    return isFresh ? SESSION_STATUS.WORKING : SESSION_STATUS.UNKNOWN;
  }
  return SESSION_STATUS.UNKNOWN;
}

function workspaceLabel(cwd: string | undefined): string {
  if (!cwd) return UNKNOWN_WORKSPACE_LABEL;
  const label = path.basename(cwd.trim());
  return label || UNKNOWN_WORKSPACE_LABEL;
}

function titleFromTail(parsed: ParsedClaudeSessionTail): string {
  return `${CLAUDE_CODE_PROVIDER_NAME}: ${workspaceLabel(parsed.cwd)}`;
}

function summaryFromStatus(status: ProviderSessionObservation["status"]): string {
  return `${CLAUDE_CODE_PROVIDER_NAME} ${status}; transcript content is not retained.`;
}

function observationFromSessionFile(
  candidate: SessionFileCandidate,
  parsed: ParsedClaudeSessionTail,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation {
  const observedAt = Math.max(candidate.mtimeMs, parsed.timestampMs ?? 0);
  const status = statusFromTail(parsed, observedAt, now, activeSessionFreshnessMs);
  return {
    providerSessionId: candidate.providerSessionId,
    title: titleFromTail(parsed),
    status,
    observedAt,
    summary: summaryFromStatus(status),
  };
}

function defaultClaudeHome(): string {
  const configuredHome = process.env[CLAUDE_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".claude");
}

export class ClaudeCodeSessionAdapter implements SessionProviderAdapter {
  readonly provider = CLAUDE_CODE_PROVIDER;

  readonly #claudeHome: string;
  readonly #now: () => number;
  readonly #maximumProjectDirectories: number;
  readonly #maximumSessionFiles: number;
  readonly #maximumSessionAgeMs: number;
  readonly #activeSessionFreshnessMs: number;
  readonly #readTailBytes: number;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#claudeHome = options.claudeHome ?? defaultClaudeHome();
    this.#now = options.now ?? Date.now;
    this.#maximumProjectDirectories = positiveInteger(
      options.maximumProjectDirectories,
      CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
    );
    this.#maximumSessionFiles = positiveInteger(
      options.maximumSessionFiles,
      CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_SESSION_FILES,
    );
    this.#maximumSessionAgeMs = nonNegativeNumber(
      options.maximumSessionAgeMs,
      CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_SESSION_AGE_MS,
    );
    this.#activeSessionFreshnessMs = nonNegativeNumber(
      options.activeSessionFreshnessMs,
      CLAUDE_ADAPTER_DEFAULTS.ACTIVE_SESSION_FRESHNESS_MS,
    );
    this.#readTailBytes = positiveInteger(
      options.readTailBytes,
      CLAUDE_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
    );
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.#now();
    const candidates = await discoverSessionFiles(
      path.join(this.#claudeHome, CLAUDE_PROJECTS_DIRECTORY),
      this.#maximumProjectDirectories,
      this.#maximumSessionFiles,
    );
    const observations = new Map<string, ProviderSessionObservation>();

    for (const candidate of candidates) {
      if (now - candidate.mtimeMs > this.#maximumSessionAgeMs) continue;
      const tail = await readTail(candidate.filePath, this.#readTailBytes);
      const observation = observationFromSessionFile(
        candidate,
        parseClaudeSessionTail(tail),
        now,
        this.#activeSessionFreshnessMs,
      );
      if (!observations.has(observation.providerSessionId)) {
        observations.set(observation.providerSessionId, observation);
      }
    }

    return [...observations.values()];
  }
}
