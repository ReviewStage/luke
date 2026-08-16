import os from "node:os";
import path from "node:path";
import {
  agedStatus,
  isRecord,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  OBSERVATION_WINDOW,
  oneLine,
  PROVIDER_ID,
  type ProviderSessionObservation,
  recordFromJsonLine,
  resolveOptions,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionProviderAdapter,
  text,
  wholeNumber,
} from "@sidecar/core";
import {
  discoverSessionFiles,
  LOCAL_ADAPTER_DEFAULTS,
  readDirectory,
  readHead,
  readTail,
  type SessionFileCandidate,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "./local-session-adapter";

const CLAUDE_CODE_PROVIDER_ID = PROVIDER_ID.CLAUDE_CODE;
const CLAUDE_CODE_PROVIDER_NAME = "Claude Code";
const CLAUDE_PROJECTS_DIRECTORY = "projects";
const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";

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
   * only recap this adapter reports, because it is the only one Claude Code
   * designates as being *about* the session. The closing text of the last
   * assistant message would read similarly, but it is the message stream
   * itself, and a recap reaches the attention evaluator off-machine.
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
  activeSessionFreshnessMs?: number;
  readTailBytes?: number;
  readHeadBytes?: number;
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

function sessionIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(CLAUDE_SESSION_FILE_EXTENSION)) return undefined;
  const providerSessionId = fileName.slice(0, -CLAUDE_SESSION_FILE_EXTENSION.length).trim();
  return providerSessionId || undefined;
}

/** Claude Code keeps a session's transcript directly in its project directory. */
async function sessionFilesIn(projectDirectory: string): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name);
      if (!providerSessionId) return undefined;
      const candidate = await statDirectoryEntry(projectDirectory, entry.name);
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

function eventTypeFromRecord(record: Record<string, unknown>): ClaudeEventType | undefined {
  const eventType = record.type;
  return typeof eventType === "string" &&
    Object.values(CLAUDE_EVENT_TYPE).includes(eventType as ClaudeEventType)
    ? (eventType as ClaudeEventType)
    : undefined;
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
      parsed.awaySummary = oneLine(text(record.content), maximumSessionRecapLength);
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
  for (const record of tailRecords(tail)) readClaudeRecord(record, parsed);
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
  if (parsed.eventType === CLAUDE_EVENT_TYPE.RESULT) return SESSION_STATUS.COMPLETE;
  if (parsed.apiError) return SESSION_STATUS.ERROR;
  const status =
    parsed.eventType === CLAUDE_EVENT_TYPE.ASSISTANT && turnEnded(parsed)
      ? SESSION_STATUS.WAITING
      : SESSION_STATUS.WORKING;
  // A transcript has no heartbeat, so an open turn that has gone quiet is
  // unknown rather than still working.
  if (status === SESSION_STATUS.WORKING && now - observedAt > activeSessionFreshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, observedAt, now, activeSessionFreshnessMs);
}

/**
 * Claude Code names its own sessions, and that name is what a developer is
 * looking for. The workspace is the fallback for a session too new to have been
 * named, which is also the only case where two rows can still read alike.
 */
function titleFromTail(parsed: ParsedClaudeSessionTail): string {
  return parsed.aiTitle ?? workspaceLabel(parsed.cwd);
}

/**
 * No address is reported, because Claude Code publishes none that opens *this*
 * session. Its own `claude-cli://open` handler takes a directory and a prompt
 * and starts a new terminal session; the one route that names a session at all,
 * the VS Code extension's `session` parameter, resolves against whichever
 * workspace that editor happens to have open and starts a fresh conversation
 * when it does not match. A row that opened a new chat instead of the one it
 * named would be worse than a row that opens nothing.
 */
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
  // The transcript's own clock, not the file's. Claude Code touches session
  // files in bulk long after their conversations ended — appending bookkeeping
  // records and bumping mtimes — so mtime says when something last handled the
  // file, while the last timestamped record says when the session last moved.
  // Trusting mtime made every touched session read as active just now. The
  // file's date remains the fallback for a tail that carried no timestamp.
  const observedAt = parsed.timestampMs ?? candidate.mtimeMs;
  const status = statusFromTail(parsed, observedAt, now, activeSessionFreshnessMs);
  return {
    providerSessionId: candidate.providerSessionId,
    title: titleFromTail(parsed),
    status,
    observedAt,
    ...(parsed.awaySummary ? { recap: parsed.awaySummary } : {}),
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
  readonly #activeSessionFreshnessMs: number;
  readonly #readTailBytes: number;
  readonly #readHeadBytes: number;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#claudeHome = options.claudeHome ?? defaultClaudeHome();
    this.#now = options.now ?? Date.now;
    const resolved = resolveOptions(
      options,
      {
        maximumProjectDirectories: CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
        maximumSessionFiles: CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_SESSION_FILES,
        activeSessionFreshnessMs: OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
        readTailBytes: LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
        readHeadBytes: CLAUDE_ADAPTER_DEFAULTS.READ_HEAD_BYTES,
      },
      {
        positive: [
          "maximumProjectDirectories",
          "maximumSessionFiles",
          "readTailBytes",
          "readHeadBytes",
        ],
        nonNegative: ["activeSessionFreshnessMs"],
      },
    );
    this.#maximumProjectDirectories = resolved.maximumProjectDirectories;
    this.#maximumSessionFiles = resolved.maximumSessionFiles;
    this.#activeSessionFreshnessMs = resolved.activeSessionFreshnessMs;
    this.#readTailBytes = resolved.readTailBytes;
    this.#readHeadBytes = resolved.readHeadBytes;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.#now();
    const candidates = await discoverSessionFiles({
      projectsDirectory: path.join(this.#claudeHome, CLAUDE_PROJECTS_DIRECTORY),
      maximumProjectDirectories: this.#maximumProjectDirectories,
      maximumSessionFiles: this.#maximumSessionFiles,
      sessionFilesIn,
    });
    const observations = new Map<string, ProviderSessionObservation>();

    for (const candidate of candidates) {
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
