import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  maximumSessionSummaryLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionProviderAdapter,
} from "@sidecar/core";

const CLAUDE_CODE_PROVIDER_ID = PROVIDER_ID.CLAUDE_CODE;
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
  USER: "user",
} as const;

type ClaudeEventType = (typeof CLAUDE_EVENT_TYPE)[keyof typeof CLAUDE_EVENT_TYPE];

/** Records Claude Code writes alongside the conversation itself. */
const CLAUDE_RECORD_TYPE = {
  AI_TITLE: "ai-title",
  PR_LINK: "pr-link",
  SYSTEM: "system",
} as const;

const CLAUDE_SYSTEM_SUBTYPE = {
  /**
   * A recap Claude Code composes for a developer who stepped away. It is the
   * only summary this adapter reports, because it is the only one Claude Code
   * designates as being *about* the session. The closing text of the last
   * assistant message would read similarly, but it is the message stream
   * itself, and a summary reaches the attention evaluator off-machine.
   */
  AWAY_SUMMARY: "away_summary",
  API_ERROR: "api_error",
} as const;

/**
 * Why the model stopped. This says what the tail alone cannot: a turn that ended
 * is holding for the developer, and a turn that stopped to call a tool is not.
 */
const CLAUDE_STOP_REASON = {
  END_TURN: "end_turn",
  TOOL_USE: "tool_use",
} as const;

const CLAUDE_CONTENT_TYPE = {
  TEXT: "text",
  TOOL_RESULT: "tool_result",
  TOOL_USE: "tool_use",
} as const;

/** Tool inputs whose value names the work, in the order they read best. */
const CLAUDE_TOOL_INPUT_KEY = ["description", "file_path", "pattern", "command", "prompt"] as const;

const CLAUDE_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_SESSION_FILES: 40,
  MAXIMUM_SESSION_AGE_MS: 24 * 60 * 60 * 1000,
  ACTIVE_SESSION_FRESHNESS_MS: 15 * 60 * 1000,
  READ_TAIL_BYTES: 64 * 1024,
  /**
   * Claude Code writes its generated title early and then only when the subject
   * changes, so a long session's title sits far behind the tail. Only a file
   * whose tail carried no title pays for this second read.
   */
  READ_HEAD_BYTES: 64 * 1024,
  MAXIMUM_ACTIVITY_LENGTH: 80,
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
  readHeadBytes?: number;
}

interface SessionFileCandidate {
  filePath: string;
  providerSessionId: string;
  mtimeMs: number;
}

interface ParsedClaudeSessionTail {
  activity?: string;
  aiTitle?: string;
  apiError?: string;
  awaySummary?: string;
  branch?: string;
  cwd?: string;
  eventType?: ClaudeEventType;
  model?: string;
  pullRequestUrl?: string;
  stopReason?: string;
  timestampMs?: number;
  usedTool?: boolean;
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

async function readHead(filePath: string, maximumBytes: number): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0) return "";
    const length = Math.min(stats.size, maximumBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

/** Collapses the newlines and runs of spaces a one-line row cannot show. */
function oneLine(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength - 1).trimEnd()}…`
    : normalized;
}

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
  const message = record.message;
  const content = isRecord(message) ? message.content : record.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Names the tool the assistant reached for, preferring whichever input says
 * what the call is for. `Bash: Run the macOS packaging check` is the line a
 * developer can act on; `Bash` alone is not.
 */
function activityFromAssistant(record: Record<string, unknown>): string | undefined {
  for (const block of contentBlocks(record).reverse()) {
    if (block.type !== CLAUDE_CONTENT_TYPE.TOOL_USE) continue;
    const name = text(block.name);
    if (!name) continue;
    const input = isRecord(block.input) ? block.input : {};
    for (const key of CLAUDE_TOOL_INPUT_KEY) {
      const detail = oneLine(text(input[key]), CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
      if (detail) return `${name}: ${detail}`;
    }
    return name;
  }
  return undefined;
}

function stopReasonFromRecord(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  return isRecord(message) ? text(message.stop_reason) : undefined;
}

function modelFromRecord(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  return isRecord(message) ? text(message.model) : undefined;
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Reads the failure Claude Code recorded, but only once it has stopped trying.
 *
 * Claude Code writes `api_error` for every retry as it backs off, not only for
 * the one that gives up: a rate limit or a dropped connection produces a run of
 * them counting `retryAttempt` up to `maxRetries`. Reporting the first would
 * interrupt a developer about a blip the session is already recovering from,
 * which is the one thing a background companion must not do. A record with no
 * retry bookkeeping at all is not a retry, so it stands on its own.
 */
function apiErrorFromRecord(record: Record<string, unknown>): string | undefined {
  const error = record.error;
  if (!isRecord(error)) return undefined;

  const attempt = wholeNumber(record.retryAttempt);
  const maximumAttempts = wholeNumber(record.maxRetries);
  if (attempt !== undefined && maximumAttempts !== undefined && attempt < maximumAttempts) {
    return undefined;
  }
  return oneLine(
    text(error.formatted) ?? text(error.message),
    CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
  );
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

/**
 * Whether a user record carries a tool's output rather than a person's prompt.
 * The two look alike at the top level and mean opposite things: one continues
 * the turn under way, the other opens a new one.
 */
function isToolResult(record: Record<string, unknown>): boolean {
  if (record.toolUseResult !== undefined) return true;
  return contentBlocks(record).some((block) => block.type === CLAUDE_CONTENT_TYPE.TOOL_RESULT);
}

/**
 * Whether the assistant record just read closed the turn. `stop_reason` answers
 * it directly; the tool blocks in the message are the fallback for a build that
 * stops reporting one.
 */
function turnEnded(parsed: ParsedClaudeSessionTail): boolean {
  return parsed.stopReason
    ? parsed.stopReason !== CLAUDE_STOP_REASON.TOOL_USE
    : parsed.usedTool !== true;
}

/** Folds one record into the running picture of the session. */
function readClaudeRecord(record: Record<string, unknown>, parsed: ParsedClaudeSessionTail): void {
  parsed.cwd = cwdFromRecord(record) ?? parsed.cwd;
  parsed.branch = text(record.gitBranch) ?? parsed.branch;
  parsed.timestampMs = timestampFromRecord(record) ?? parsed.timestampMs;

  if (record.type === CLAUDE_RECORD_TYPE.AI_TITLE) {
    parsed.aiTitle = oneLine(text(record.aiTitle), maximumSessionTitleLength) ?? parsed.aiTitle;
    return;
  }
  if (record.type === CLAUDE_RECORD_TYPE.PR_LINK) {
    parsed.pullRequestUrl = text(record.prUrl) ?? parsed.pullRequestUrl;
    return;
  }
  if (record.type === CLAUDE_RECORD_TYPE.SYSTEM) {
    if (record.subtype === CLAUDE_SYSTEM_SUBTYPE.AWAY_SUMMARY) {
      parsed.awaySummary = oneLine(text(record.content), maximumSessionSummaryLength);
    }
    if (record.subtype === CLAUDE_SYSTEM_SUBTYPE.API_ERROR) {
      parsed.apiError = apiErrorFromRecord(record);
    }
    return;
  }

  const eventType = eventTypeFromRecord(record);
  if (!eventType) return;
  parsed.eventType = eventType;
  // Anything the session went on to do means it got past the failure it
  // recorded earlier, so a stale error must not outlive it.
  parsed.apiError = undefined;

  if (eventType !== CLAUDE_EVENT_TYPE.ASSISTANT) {
    parsed.stopReason = undefined;
    parsed.usedTool = false;
    // A result ends the session's work, so what it last ran is no longer what it
    // is doing. A tool result does not: it sits between one call and the next,
    // and clearing there would blank the line every other record.
    if (eventType === CLAUDE_EVENT_TYPE.RESULT) parsed.activity = undefined;
    // A new prompt opens a new turn, so the previous turn's recap has stopped
    // describing this session. Keeping it would let a stale recap outrank the
    // closing words of the turn that actually just ended.
    if (eventType === CLAUDE_EVENT_TYPE.USER && !isToolResult(record)) {
      parsed.activity = undefined;
      parsed.awaySummary = undefined;
    }
    return;
  }
  parsed.stopReason = stopReasonFromRecord(record);
  parsed.usedTool = contentBlocks(record).some(
    (block) => block.type === CLAUDE_CONTENT_TYPE.TOOL_USE,
  );
  parsed.model = modelFromRecord(record) ?? parsed.model;
  // A turn that ended is not running anything. Holding the last call would keep
  // it ahead of the recap the surface should show instead, so the session would
  // read as though it were still working.
  parsed.activity = turnEnded(parsed)
    ? undefined
    : (activityFromAssistant(record) ?? parsed.activity);
}

function parseClaudeSessionTail(tail: string): ParsedClaudeSessionTail {
  const parsed: ParsedClaudeSessionTail = {};
  for (const line of tailLines(tail)) {
    const record = recordFromJsonLine(line);
    if (record) readClaudeRecord(record, parsed);
  }
  return parsed;
}

/** Recovers only the generated title from a session too long to hold one in its tail. */
function titleFromHead(head: string): string | undefined {
  let title: string | undefined;
  for (const line of head.split(/\r?\n/)) {
    const record = recordFromJsonLine(line);
    if (record?.type === CLAUDE_RECORD_TYPE.AI_TITLE) {
      title = oneLine(text(record.aiTitle), maximumSessionTitleLength) ?? title;
    }
  }
  return title;
}

/**
 * A session that stopped on a failed request is stuck until someone comes back
 * to it, so the error outranks whatever the tail otherwise looked like. Past
 * that, `stop_reason` answers the question the tail cannot: a turn Claude Code
 * ended is holding for the developer, and one it ended to call a tool is not.
 */
function statusFromTail(
  parsed: ParsedClaudeSessionTail,
  observedAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  const isFresh = now - observedAt <= activeSessionFreshnessMs;
  if (parsed.eventType === CLAUDE_EVENT_TYPE.RESULT) return SESSION_STATUS.COMPLETE;
  if (parsed.apiError) return isFresh ? SESSION_STATUS.ERROR : SESSION_STATUS.UNKNOWN;
  if (!isFresh) return SESSION_STATUS.UNKNOWN;
  if (parsed.eventType === CLAUDE_EVENT_TYPE.ASSISTANT) {
    return turnEnded(parsed) ? SESSION_STATUS.WAITING : SESSION_STATUS.WORKING;
  }
  return SESSION_STATUS.WORKING;
}

function workspaceLabel(cwd: string | undefined): string {
  if (!cwd) return UNKNOWN_WORKSPACE_LABEL;
  const label = path.basename(cwd.trim());
  return label || UNKNOWN_WORKSPACE_LABEL;
}

/**
 * Claude Code names its own sessions, and that name is what a developer is
 * looking for. The workspace is the fallback for a session too new to have been
 * named, which is also the only case where two rows can still read alike.
 */
function titleFromTail(parsed: ParsedClaudeSessionTail): string {
  return parsed.aiTitle ?? workspaceLabel(parsed.cwd);
}

function detailFromTail(parsed: ParsedClaudeSessionTail): SessionDetail {
  return {
    ...(parsed.activity ? { activity: parsed.activity } : {}),
    repository: workspaceLabel(parsed.cwd),
    ...(parsed.branch ? { branch: parsed.branch } : {}),
    ...(parsed.model ? { model: parsed.model } : {}),
    ...(parsed.apiError ? { error: parsed.apiError } : {}),
    ...(parsed.pullRequestUrl ? { change: parsed.pullRequestUrl } : {}),
  };
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
    ...(parsed.awaySummary ? { summary: parsed.awaySummary } : {}),
    detail: detailFromTail(parsed),
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
  readonly #readHeadBytes: number;

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
    this.#readHeadBytes = positiveInteger(
      options.readHeadBytes,
      CLAUDE_ADAPTER_DEFAULTS.READ_HEAD_BYTES,
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
      const parsed = parseClaudeSessionTail(tail);
      if (!parsed.aiTitle) {
        parsed.aiTitle = titleFromHead(await readHead(candidate.filePath, this.#readHeadBytes));
      }
      const observation = observationFromSessionFile(
        candidate,
        parsed,
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
