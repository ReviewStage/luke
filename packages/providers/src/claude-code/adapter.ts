import fs from "node:fs/promises";
import path from "node:path";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
} from "@sidecar/session";
import {
  isRecord,
  isWireString,
  oneLine,
  recordFromJsonLine,
  resolveOptions,
  text,
  type WireRecord,
  wholeNumber,
} from "@sidecar/wire";
import {
  discoverSessionFiles,
  type HookStatusRefinement,
  hookRefinedStatus,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  localSessionStatus,
  readDirectory,
  readHead,
  readTail,
  type SessionFileCandidate,
  sessionIdFromFileName,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  CLAUDE_HOOK_EVENT,
  type ClaudeHookEvent,
  defaultClaudeHome,
  type ObservedClaudeHookEvent,
  readClaudeHookEvent,
} from "./hooks.js";
import { readClaudeSessionTranscript } from "./transcript.js";

const CLAUDE_CODE_PROVIDER_ID = PROVIDER_ID.CLAUDE_CODE;
const CLAUDE_CODE_PROVIDER_NAME = "Claude Code";
const CLAUDE_PROJECTS_DIRECTORY = "projects";
const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";

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
  /**
   * Claude Code writes its generated title early and then only when the subject
   * changes, so a long session's title sits far behind the tail. Only a file
   * whose tail carried no title pays for this second read.
   */
  READ_HEAD_BYTES: 64 * 1024,
  MAXIMUM_ACTIVITY_LENGTH: 80,
  /**
   * How far the one deeper read may reach when the bounded tail carries no
   * conversation clock at all — bookkeeping appended in bulk past the whole
   * tail, or a single record larger than it. Past this bound the file's date
   * is the only account left, and the mtime fallback stands.
   */
  CLOCK_RESCUE_TAIL_BYTES: 512 * 1024,
} as const;

export const CLAUDE_CODE_PROVIDER: SessionProvider = {
  id: CLAUDE_CODE_PROVIDER_ID,
  displayName: CLAUDE_CODE_PROVIDER_NAME,
};

export interface ClaudeCodeAdapterOptions {
  claudeHome?: string;
  now?: () => number;
  maximumProjectDirectories?: number;
  activeSessionFreshnessMs?: number;
  readTailBytes?: number;
  readHeadBytes?: number;
  transcriptReadTailBytes?: number;
  transcriptMaximumRenderedLength?: number;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud adapters' credentials, because the app decides
   * the path after this adapter is declared. Absent — or answering nothing —
   * the adapter reads the transcripts alone, exactly as it always has: the
   * hooks only ever sharpen what the tail already showed.
   */
  hookEventsDirectory?: () => string | undefined;
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

async function archivedSessionsIn(projectDirectory: string): Promise<ReadonlyMap<string, boolean>> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(projectDirectory, "sessions-index.json"), "utf8"),
    );
    if (!isRecord(raw) || !Array.isArray(raw.entries)) return new Map();
    const archived = new Map<string, boolean>();
    for (const entry of raw.entries) {
      if (!isRecord(entry)) continue;
      const sessionId = text(entry.sessionId);
      const isArchived = entry.isArchived;
      if (!sessionId || (isArchived !== true && isArchived !== false)) continue;
      archived.set(sessionId, isArchived);
    }
    return archived;
  } catch {
    // Metadata is a best-effort provider signal. A missing or unreadable index
    // leaves archive state unknown rather than treating every session as open.
    return new Map();
  }
}

/** Claude Code keeps a session's transcript directly in its project directory. */
async function sessionFilesIn(projectDirectory: string): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const archived = await archivedSessionsIn(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name, CLAUDE_SESSION_FILE_EXTENSION);
      if (!providerSessionId) return undefined;
      // Claude's index is authoritative when it explicitly marks a session
      // archived. Missing, invalid, or false metadata leaves the transcript
      // visible; archive state is never inferred from CLI resume membership.
      if (archived.get(providerSessionId) === true) return undefined;
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

function eventTypeFromRecord(record: WireRecord): ClaudeEventType | undefined {
  const eventType = record.type;
  if (!isWireString(eventType)) return undefined;
  for (const candidate of Object.values(CLAUDE_EVENT_TYPE)) {
    if (eventType === candidate) return candidate;
  }
  return undefined;
}

function contentBlocks(record: WireRecord): WireRecord[] {
  const message = record.message;
  const content = isRecord(message) ? message.content : record.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Names the tool the assistant reached for, preferring whichever input says
 * what the call is for. `Bash: Run the macOS packaging check` is the line a
 * developer can act on; `Bash` alone is not.
 */
function activityFromAssistant(record: WireRecord): string | undefined {
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

function stopReasonFromRecord(record: WireRecord): string | undefined {
  const message = record.message;
  return isRecord(message) ? text(message.stop_reason) : undefined;
}

function modelFromRecord(record: WireRecord): string | undefined {
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
function apiErrorFromRecord(record: WireRecord): string | undefined {
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

function timestampFromRecord(record: WireRecord): number | undefined {
  const timestamp = record.timestamp;
  if (!isWireString(timestamp)) return undefined;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function cwdFromRecord(record: WireRecord): string | undefined {
  const cwd = record.cwd;
  return isWireString(cwd) && cwd.trim().length > 0 ? cwd : undefined;
}

/**
 * Whether a record belongs to the conversation itself rather than to the
 * bookkeeping Claude Code writes beside it. Only the conversation may date the
 * session: bookkeeping is appended in bulk long after a conversation settled,
 * so its stamps say when something handled the file, not when the session last
 * moved — the same distinction that keeps mtime from dating it.
 */
function isConversationRecord(record: WireRecord): boolean {
  return record.type === CLAUDE_RECORD_TYPE.SYSTEM || eventTypeFromRecord(record) !== undefined;
}

/**
 * Whether a user record carries a tool's output rather than a person's prompt.
 * The two look alike at the top level and mean opposite things: one continues
 * the turn under way, the other opens a new one.
 */
function isToolResult(record: WireRecord): boolean {
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
function readClaudeRecord(record: WireRecord, parsed: ParsedClaudeSessionTail): void {
  parsed.cwd = cwdFromRecord(record) ?? parsed.cwd;
  parsed.branch = text(record.gitBranch) ?? parsed.branch;
  if (isConversationRecord(record)) {
    parsed.timestampMs = timestampFromRecord(record) ?? parsed.timestampMs;
  }

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
  return localSessionStatus(status, observedAt, now, activeSessionFreshnessMs);
}

/**
 * What the refinement actually buys here is the states the transcript cannot
 * show: a tool call holding for permission writes no records while it holds,
 * and a turn's true end can sit past the tail's read. A failed turn is
 * definite alongside a closed session because the tail may hold nothing about
 * either. The notification keeps waiting past freshness — a standing event is
 * proof the permission dialog is still up, because any record at or past it
 * would have discarded it, and a crash mid-hold leaves that proof standing
 * only until the spool prune retires it.
 */
const CLAUDE_HOOK_STATUS_REFINEMENT = {
  definitive: [
    { event: CLAUDE_HOOK_EVENT.STOP_FAILURE, fresh: SESSION_STATUS.ERROR },
    { event: CLAUDE_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE },
  ],
  fresh: [
    { event: CLAUDE_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CLAUDE_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
    {
      event: CLAUDE_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.WAITING,
    },
  ],
  notificationEvent: CLAUDE_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: CLAUDE_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<ClaudeHookEvent>;

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
    ...(parsed.activity ? { activity: parsed.activity } : undefined),
    repository: workspaceLabel(parsed.cwd),
    ...(parsed.branch ? { branch: parsed.branch } : undefined),
    ...(parsed.model ? { model: parsed.model } : undefined),
    ...(parsed.apiError ? { error: parsed.apiError } : undefined),
    ...(parsed.pullRequestUrl ? { change: parsed.pullRequestUrl } : undefined),
  };
}

function observationFromSessionFile(
  candidate: SessionFileCandidate,
  parsed: ParsedClaudeSessionTail,
  now: number,
  activeSessionFreshnessMs: number,
  hookEvent?: ObservedClaudeHookEvent,
): ProviderSessionObservation {
  // The conversation's own clock, not the file's. Claude Code touches session
  // files in bulk long after their conversations ended — appending bookkeeping
  // records, stamped or not, and bumping mtimes — so mtime says when something
  // last handled the file, while the last timestamped conversation record says
  // when the session last moved. Trusting mtime made every touched session
  // read as active just now. The file's date remains the fallback for a
  // transcript in which no conversation clock could be found at all.
  const transcriptAt = parsed.timestampMs ?? candidate.mtimeMs;
  const refined = hookRefinedStatus({
    refinement: CLAUDE_HOOK_STATUS_REFINEMENT,
    hookEvent,
    providerAtMs: transcriptAt,
    statusAt: (observedAt) => statusFromTail(parsed, observedAt, now, activeSessionFreshnessMs),
    now,
    activeSessionFreshnessMs,
  });
  const completionCause =
    refined.status === SESSION_STATUS.COMPLETE
      ? refined.sessionClosed
        ? SESSION_COMPLETION_CAUSE.SESSION_CLOSED
        : parsed.eventType === CLAUDE_EVENT_TYPE.RESULT
          ? SESSION_COMPLETION_CAUSE.WORK_FINISHED
          : undefined
      : undefined;
  return {
    providerSessionId: candidate.providerSessionId,
    title: titleFromTail(parsed),
    status: refined.status,
    ...(completionCause ? { completionCause } : undefined),
    observedAt: refined.observedAt,
    ...(parsed.awaySummary ? { recap: parsed.awaySummary } : undefined),
    detail: detailFromTail(parsed),
    ...(refined.holdingForDeveloper ? { holdingForDeveloper: true } : undefined),
  };
}

export class ClaudeCodeSessionAdapter extends LocalFileSessionAdapter<
  SessionFileCandidate,
  ParsedClaudeSessionTail
> {
  readonly provider = CLAUDE_CODE_PROVIDER;

  readonly #claudeHome: string;
  readonly #maximumProjectDirectories: number;
  readonly #readTailBytes: number;
  readonly #readHeadBytes: number;
  readonly #transcriptReadTailBytes: number | undefined;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    super(options);
    this.#claudeHome = options.claudeHome ?? defaultClaudeHome();
    const resolved = resolveOptions(
      options,
      {
        maximumProjectDirectories: CLAUDE_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
        readTailBytes: LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
        readHeadBytes: CLAUDE_ADAPTER_DEFAULTS.READ_HEAD_BYTES,
      },
      {
        positive: ["maximumProjectDirectories", "readTailBytes", "readHeadBytes"],
      },
    );
    this.#maximumProjectDirectories = resolved.maximumProjectDirectories;
    this.#readTailBytes = resolved.readTailBytes;
    this.#readHeadBytes = resolved.readHeadBytes;
    this.#transcriptReadTailBytes = options.transcriptReadTailBytes;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
    this.#hookEventsDirectory = options.hookEventsDirectory;
  }

  protected async parse(candidate: SessionFileCandidate): Promise<ParsedClaudeSessionTail> {
    const tail = await readTail(candidate.filePath, this.#readTailBytes);
    let parsed = parseClaudeSessionTail(tail);
    // A truncated tail holding no conversation clock says nothing about when
    // the session last moved, and the file's date is exactly what a bulk
    // touch falsifies — so one deeper read goes looking for the conversation
    // before the fallback is trusted. A file read whole is never re-read:
    // there is nothing further back to find.
    if (
      parsed.timestampMs === undefined &&
      Buffer.byteLength(tail, "utf8") >= this.#readTailBytes &&
      CLAUDE_ADAPTER_DEFAULTS.CLOCK_RESCUE_TAIL_BYTES > this.#readTailBytes
    ) {
      const rescued = parseClaudeSessionTail(
        await readTail(candidate.filePath, CLAUDE_ADAPTER_DEFAULTS.CLOCK_RESCUE_TAIL_BYTES),
      );
      if (rescued.timestampMs !== undefined) parsed = rescued;
    }
    if (!parsed.aiTitle) {
      parsed.aiTitle = titleFromHead(await readHead(candidate.filePath, this.#readHeadBytes));
    }
    return parsed;
  }

  protected discover(): Promise<SessionFileCandidate[]> {
    return discoverSessionFiles({
      projectsDirectory: path.join(this.#claudeHome, CLAUDE_PROJECTS_DIRECTORY),
      maximumProjectDirectories: this.#maximumProjectDirectories,
      sessionFilesIn,
    });
  }

  protected async observation(
    candidate: SessionFileCandidate,
    parsed: ParsedClaudeSessionTail,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> {
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    const hookEvent = hookEventsDirectory
      ? await readClaudeHookEvent(hookEventsDirectory, candidate.providerSessionId).catch(
          () => undefined,
        )
      : undefined;
    return observationFromSessionFile(candidate, parsed, now, activeSessionFreshnessMs, hookEvent);
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return readClaudeSessionTranscript({
      claudeHome: this.#claudeHome,
      providerSessionId,
      readTailBytes: this.#transcriptReadTailBytes,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }
}
