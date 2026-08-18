import path from "node:path";
import {
  isRecord,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  oneLine,
  PROVIDER_ID,
  type ProviderSessionObservation,
  recordFromJsonLine,
  resolveOptions,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  text,
  wholeNumber,
} from "@sidecar/core";
import {
  CLAUDE_HOOK_EVENT,
  type ClaudeHookEvent,
  defaultClaudeHome,
  type ObservedClaudeHookEvent,
  readClaudeHookEvent,
} from "./claude-code-hooks";
import {
  discoverSessionFiles,
  type HookStatusRefinement,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  localSessionStatus,
  readDirectory,
  readHead,
  readTail,
  refineStatusWithHookEvent,
  type SessionFileCandidate,
  sessionIdFromFileName,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "./local-session-adapter";
import { boundedTranscript, TRANSCRIPT_BOUNDS } from "./local-transcript";

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
  /**
   * How much older than the transcript's clock a hook event may run and still
   * describe the same moment. The hook fires as a turn boundary happens and
   * the closing records land moments later under their own timestamps, so a
   * boundary's event usually trails the record it belongs with by a breath —
   * never by more than this. An event further behind describes a turn the
   * transcript has already moved past, and refines nothing.
   */
  HOOK_EVENT_TOLERANCE_MS: 5_000,
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

/** Claude Code keeps a session's transcript directly in its project directory. */
async function sessionFilesIn(projectDirectory: string): Promise<SessionFileCandidate[]> {
  const entries = await readDirectory(projectDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name, CLAUDE_SESSION_FILE_EXTENSION);
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
 * Whether a record belongs to the conversation itself rather than to the
 * bookkeeping Claude Code writes beside it. Only the conversation may date the
 * session: bookkeeping is appended in bulk long after a conversation settled,
 * so its stamps say when something handled the file, not when the session last
 * moved — the same distinction that keeps mtime from dating it.
 */
function isConversationRecord(record: Record<string, unknown>): boolean {
  return record.type === CLAUDE_RECORD_TYPE.SYSTEM || eventTypeFromRecord(record) !== undefined;
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
 * Sharpens the tail's verdict with what the observation hook last said, in the
 * order the meanings bind. A failed or closed session is definite in either
 * direction: the hook saying so outranks the tail, and a tail that says so is
 * never talked out of it by a softer event. Past those, the events refine only
 * a fresh session — the decay to `UNKNOWN` exists because a hook can go
 * silent (a crash fires no `SessionEnd`), so an old "waiting" must age the
 * same way an old tail does. What the refinement actually buys is the states
 * the transcript cannot show: a tool call holding for permission writes no
 * records while it holds, and a turn's true end can sit past the tail's read.
 */
const CLAUDE_HOOK_STATUS_REFINEMENT = {
  definitive: [
    { event: CLAUDE_HOOK_EVENT.STOP_FAILURE, fresh: SESSION_STATUS.ERROR },
    { event: CLAUDE_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE },
  ],
  fresh: [
    { event: CLAUDE_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CLAUDE_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
    { event: CLAUDE_HOOK_EVENT.NOTIFICATION, fresh: SESSION_STATUS.WAITING },
  ],
} as const satisfies HookStatusRefinement<ClaudeHookEvent>;

function statusWithHookEvent(
  status: ProviderSessionObservation["status"],
  event: ClaudeHookEvent,
  isFresh: boolean,
): ProviderSessionObservation["status"] {
  return refineStatusWithHookEvent(status, event, isFresh, CLAUDE_HOOK_STATUS_REFINEMENT);
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
  // A hook event trailing the transcript's clock by more than the tolerance
  // describes a turn the transcript already moved past, so it is ignored
  // whole. One that stands is proof the session moved — only Luke's own
  // script writes the spool, so its date cannot suffer the bulk-touch problem
  // above — and dates the session for the freshness decay as well. A
  // notification alone gets no tolerance: it means the session is holding for
  // the user, and holding writes nothing, so a record at or past the event is
  // itself the news that the hold ended — a granted permission must not read
  // as waiting for even one more pass.
  const toleranceMs =
    hookEvent?.event === CLAUDE_HOOK_EVENT.NOTIFICATION
      ? 0
      : CLAUDE_ADAPTER_DEFAULTS.HOOK_EVENT_TOLERANCE_MS;
  const eventStands = hookEvent !== undefined && hookEvent.atMs + toleranceMs >= transcriptAt;
  const observedAt = eventStands ? Math.max(transcriptAt, hookEvent.atMs) : transcriptAt;
  let status = statusFromTail(parsed, observedAt, now, activeSessionFreshnessMs);
  if (eventStands) {
    const isFresh = now - observedAt <= activeSessionFreshnessMs;
    status = statusWithHookEvent(status, hookEvent.event, isFresh);
  }
  const completionCause =
    status === SESSION_STATUS.COMPLETE
      ? eventStands && hookEvent.event === CLAUDE_HOOK_EVENT.SESSION_END
        ? SESSION_COMPLETION_CAUSE.SESSION_CLOSED
        : parsed.eventType === CLAUDE_EVENT_TYPE.RESULT
          ? SESSION_COMPLETION_CAUSE.WORK_FINISHED
          : undefined
      : undefined;
  return {
    providerSessionId: candidate.providerSessionId,
    title: titleFromTail(parsed),
    status,
    ...(completionCause ? { completionCause } : {}),
    observedAt,
    ...(parsed.awaySummary ? { recap: parsed.awaySummary } : {}),
    detail: detailFromTail(parsed),
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
    return ClaudeTranscript.read({
      claudeHome: this.#claudeHome,
      providerSessionId,
      readTailBytes: this.#transcriptReadTailBytes,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }
}

namespace ClaudeTranscript {
  /**
   * On-demand reading of one Claude Code session's transcript, for a question
   * the developer just asked. The JSONL file under the provider's own projects
   * directory is the transcript — Claude Code documents no other local source,
   * and the hook envelope's `transcript_path` names these same files — so this
   * reads it the way the adapter reads its tail, only deeper: a bounded slice,
   * parsed in memory, rendered into a bounded conversation, and discarded.
   * Nothing here is retained, watched, or written; a session is re-read the
   * next time it is asked about.
   */

  const CLAUDE_PROJECTS_DIRECTORY = "projects";
  const CLAUDE_SESSION_FILE_EXTENSION = ".jsonl";

  /** The same shape the observation hook accepts: the ids Claude Code mints. */
  const CLAUDE_SESSION_ID_SHAPE = /^[0-9a-fA-F-]{8,64}$/;

  /** Tool inputs whose value names the work, in the order they read best. */
  const TOOL_INPUT_KEYS = ["description", "file_path", "pattern", "command", "prompt"] as const;

  interface Request {
    claudeHome: string;
    providerSessionId: string;
    readTailBytes?: number;
    maximumRenderedLength?: number;
  }

  function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
    const message = record.message;
    const content = isRecord(message) ? message.content : record.content;
    return Array.isArray(content) ? content.filter(isRecord) : [];
  }

  /** The words of a message, whether the content is a string or text blocks. */
  function messageText(record: Record<string, unknown>): string | undefined {
    const message = record.message;
    const content = isRecord(message) ? message.content : record.content;
    if (typeof content === "string") return text(content);
    const parts = contentBlocks(record)
      .filter((block) => block.type === "text")
      .map((block) => text(block.text))
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  function toolLine(block: Record<string, unknown>): string | undefined {
    const name = text(block.name);
    if (!name) return undefined;
    const input = isRecord(block.input) ? block.input : {};
    for (const key of TOOL_INPUT_KEYS) {
      const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (detail) return `→ ${name}: ${detail}`;
    }
    return `→ ${name}`;
  }

  /** The words inside one value, whether it is a string or text blocks. */
  function wordsFromContent(content: unknown): string | undefined {
    if (typeof content === "string") return text(content);
    if (Array.isArray(content)) {
      const parts = content
        .filter(isRecord)
        .filter((part) => part.type === "text")
        .map((part) => text(part.text))
        .filter((part): part is string => part !== undefined);
      if (parts.length > 0) return parts.join(" ");
    }
    return undefined;
  }

  /**
   * The words a tool answered with, wherever this build finds them. The
   * `tool_result` blocks carry what the model was shown and are preferred;
   * `toolUseResult` is the fallback, because Claude Code often writes a record
   * with only that bookkeeping shape — a string outright, or an object whose
   * output rides `stdout`, `stderr`, or `content`.
   */
  function toolResultText(record: Record<string, unknown>): string | undefined {
    for (const block of contentBlocks(record)) {
      if (block.type !== "tool_result") continue;
      const words = wordsFromContent(block.content);
      if (words) return words;
    }
    const result = record.toolUseResult;
    if (typeof result === "string") return text(result);
    if (isRecord(result)) {
      return (
        wordsFromContent(result.content) ?? text(result.stdout) ?? text(result.stderr) ?? undefined
      );
    }
    return undefined;
  }

  function isToolResult(record: Record<string, unknown>): boolean {
    if (record.toolUseResult !== undefined) return true;
    return contentBlocks(record).some((block) => block.type === "tool_result");
  }

  /** Renders one record into the lines a conversation can carry, oldest first. */
  function linesFromRecord(record: Record<string, unknown>): string[] {
    if (record.type === "user") {
      if (isToolResult(record)) {
        const answer = oneLine(toolResultText(record), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
        return answer ? [`← ${answer}`] : [];
      }
      const prompt = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      return prompt ? [`Developer: ${prompt}`] : [];
    }
    if (record.type === "assistant") {
      const lines: string[] = [];
      const words = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      if (words) lines.push(`Claude: ${words}`);
      for (const block of contentBlocks(record)) {
        if (block.type !== "tool_use") continue;
        const line = toolLine(block);
        if (line) lines.push(line);
      }
      return lines;
    }
    if (record.type === "system" && record.subtype === "api_error") {
      const error = record.error;
      const words = isRecord(error)
        ? oneLine(
            text(error.formatted) ?? text(error.message),
            TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH,
          )
        : undefined;
      return words ? [`Error: ${words}`] : [];
    }
    if (record.type === "result") {
      const words = oneLine(text(record.result), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      return words ? [`Result: ${words}`] : [];
    }
    return [];
  }

  /**
   * Finds the session's transcript file the way discovery does — the file named
   * by the session's own id, directly inside one of the project directories —
   * without trusting the id as a path: an id outside the shape Claude Code
   * mints names nothing.
   */
  async function transcriptFilePath(
    claudeHome: string,
    providerSessionId: string,
  ): Promise<string | undefined> {
    if (!CLAUDE_SESSION_ID_SHAPE.test(providerSessionId)) return undefined;
    const projectsDirectory = path.join(claudeHome, CLAUDE_PROJECTS_DIRECTORY);
    const fileName = `${providerSessionId}${CLAUDE_SESSION_FILE_EXTENSION}`;
    for (const entry of await readDirectory(projectsDirectory)) {
      const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
      if (!projectDirectory?.stats.isDirectory()) continue;
      const candidate = await statDirectoryEntry(projectDirectory.directoryPath, fileName);
      if (candidate?.stats.isFile()) return candidate.directoryPath;
    }
    return undefined;
  }

  /**
   * Reads one session's recent transcript into a bounded rendering, or nothing
   * when no transcript file exists for that id.
   */
  export async function read(request: Request): Promise<string | undefined> {
    const filePath = await transcriptFilePath(request.claudeHome, request.providerSessionId);
    if (!filePath) return undefined;

    const tail = await readTail(
      filePath,
      request.readTailBytes ?? TRANSCRIPT_BOUNDS.READ_TAIL_BYTES,
    );
    const lines = tailRecords(tail).flatMap(linesFromRecord);
    return boundedTranscript(
      lines,
      request.maximumRenderedLength ?? TRANSCRIPT_BOUNDS.MAXIMUM_RENDERED_LENGTH,
    );
  }
}
