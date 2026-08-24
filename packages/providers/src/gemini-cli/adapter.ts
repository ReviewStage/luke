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
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, isWireString, oneLine, text, type WireRecord } from "@sidecar/wire";
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
  readTextFile,
  type SessionFileCandidate,
  sessionIdFromFileName,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import { GEMINI_HOOK_EVENT, type GeminiHookEvent, readGeminiHookEvent } from "./hooks.js";
import {
  defaultGeminiCliHome,
  GEMINI_CHATS_DIRECTORY,
  GEMINI_MESSAGE_TYPE,
  GEMINI_OPEN_TOOL_STATUSES,
  GEMINI_SESSION_FILE_EXTENSION,
  GEMINI_TMP_DIRECTORY,
  GEMINI_TOOL_CALL_STATUS,
  GEMINI_TOOL_INPUT_KEY,
  geminiContentText,
  geminiToolCallsFrom,
  isGeminiMessageRecord,
  replayGeminiRecords,
} from "./records.js";
import { readGeminiSessionTranscript } from "./transcript.js";

const GEMINI_CLI_PROVIDER_ID = PROVIDER_ID.GEMINI_CLI;
const GEMINI_CLI_PROVIDER_NAME = "Gemini CLI";

/**
 * The marker Gemini CLI writes into each per-project directory, holding the
 * normalized absolute path of the project the directory belongs to. It is what
 * the CLI's own project registry self-heals from, so it is the authoritative
 * on-disk answer to which workspace a chats directory observes.
 */
const GEMINI_PROJECT_ROOT_FILE = ".project_root";

/**
 * A per-project directory from before Gemini CLI's readable slugs: named by
 * the sha256 of the project path, which labels nothing a person can read.
 */
const GEMINI_LEGACY_HASH_DIRECTORY_PATTERN = /^[0-9a-f]{64}$/;

const GEMINI_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_ACTIVITY_LENGTH: 80,
  /** Enough of a recording's start to hold its one opening metadata line. */
  READ_HEAD_BYTES: 16 * 1024,
} as const;

export const GEMINI_CLI_PROVIDER: SessionProvider = {
  id: GEMINI_CLI_PROVIDER_ID,
  displayName: GEMINI_CLI_PROVIDER_NAME,
};

export interface GeminiCliAdapterOptions {
  geminiHome?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
  transcriptMaximumRenderedLength?: number;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud adapters' credentials, because the app decides
   * the path after this adapter is declared. Absent — or answering nothing —
   * the adapter reads the recordings alone, exactly as it always has: the
   * hooks only ever sharpen what the tail already showed.
   */
  hookEventsDirectory?: () => string | undefined;
}

function timestampMsFrom(record: WireRecord): number | undefined {
  const timestamp = record.timestamp;
  if (!isWireString(timestamp)) return undefined;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

/**
 * The conversation's own clock: the newest stamp on any message or tool call
 * in the slice, superseded and rewound lines included, because each proved the
 * session moved when it was written. The metadata line's `startTime` stands in
 * for a session too new to have said anything. `lastUpdated` is deliberately
 * never read: Gemini CLI appends a `$set` carrying it — and a generated
 * summary — to a session it merely listed at a later startup, so trusting it
 * would date a settled conversation to the moment nothing happened to it.
 */
function conversationClockMs(records: readonly WireRecord[]): number | undefined {
  let clock: number | undefined;
  for (const record of records) {
    if (isGeminiMessageRecord(record)) {
      for (const stamp of [
        timestampMsFrom(record),
        ...geminiToolCallsFrom(record).map(timestampMsFrom),
      ]) {
        if (stamp !== undefined && (clock === undefined || stamp > clock)) clock = stamp;
      }
      continue;
    }
    const startTime = record.startTime;
    if (isWireString(startTime)) {
      const startTimeMs = Date.parse(startTime);
      if (Number.isFinite(startTimeMs) && (clock === undefined || startTimeMs > clock)) {
        clock = startTimeMs;
      }
    }
  }
  return clock;
}

/**
 * Whose move the conversation's newest turn says it is. Only the message's
 * bookkeeping is read into it — type, tool-call statuses, model, and the words
 * of an error the CLI recorded; the conversation's own words stay in the
 * records they were parsed from.
 */
interface ParsedGeminiSessionTail {
  summary?: string;
  /** The full id the opening metadata line names, keying the hook spool. */
  sessionId?: string;
  model?: string;
  timestampMs?: number;
  tipType?: string;
  toolCallsOpen?: boolean;
  holdingForApproval?: boolean;
  activity?: string;
  failure?: string;
  recap?: string;
}

/**
 * Names the tool the session is running, from the newest still-open call on
 * the turn's own message. The CLI's `description` on the call is preferred —
 * it says what the call is for — and the arguments name it otherwise.
 */
function activityFromToolCalls(calls: readonly WireRecord[]): string | undefined {
  for (const call of [...calls].reverse()) {
    const status = text(call.status);
    if (status === undefined || !GEMINI_OPEN_TOOL_STATUSES.has(status)) continue;
    const name = text(call.displayName) ?? text(call.name);
    if (!name) continue;
    const args = isRecord(call.args) ? call.args : {};
    const detail =
      oneLine(text(call.description), GEMINI_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ??
      GEMINI_TOOL_INPUT_KEY.map((key) =>
        oneLine(text(args[key]), GEMINI_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH),
      ).find((candidate) => candidate !== undefined);
    return detail ? `${name}: ${detail}` : name;
  }
  return undefined;
}

export function parseGeminiSessionTail(tail: string): ParsedGeminiSessionTail {
  const records = tailRecords(tail);
  const replay = replayGeminiRecords(records);
  const parsed: ParsedGeminiSessionTail = {
    summary: replay.summary,
    timestampMs: conversationClockMs(records),
  };

  for (const message of [...replay.messages].reverse()) {
    if (parsed.model === undefined && message.type === GEMINI_MESSAGE_TYPE.GEMINI) {
      parsed.model = text(message.model);
    }
    if (parsed.tipType !== undefined) continue;
    const type = text(message.type);
    // Info and warning lines are the CLI's own bookkeeping — compression
    // notices and the like — and say nothing about whose move it is.
    if (type === GEMINI_MESSAGE_TYPE.INFO || type === GEMINI_MESSAGE_TYPE.WARNING) continue;
    parsed.tipType = type;
    if (type === GEMINI_MESSAGE_TYPE.ERROR) {
      parsed.failure = oneLine(
        geminiContentText(message.content),
        GEMINI_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
      );
    }
    if (type === GEMINI_MESSAGE_TYPE.GEMINI) {
      const calls = geminiToolCallsFrom(message);
      parsed.holdingForApproval = calls.some(
        (call) => call.status === GEMINI_TOOL_CALL_STATUS.AWAITING_APPROVAL,
      );
      parsed.toolCallsOpen = calls.some((call) => {
        const status = text(call.status);
        return status !== undefined && GEMINI_OPEN_TOOL_STATUSES.has(status);
      });
      if (parsed.toolCallsOpen) parsed.activity = activityFromToolCalls(calls);
      // A settled turn's parting words say where the work stands — the same
      // recap Codex local sessions report — where half a sentence mid-turn,
      // or ahead of a call still holding for permission, poses as an outcome.
      // A newer prompt or a recorded failure makes a different message the
      // tip, so neither can inherit a stale recap.
      if (parsed.holdingForApproval !== true && parsed.toolCallsOpen !== true) {
        parsed.recap = oneLine(geminiContentText(message.content), maximumSessionRecapLength);
      }
    }
  }
  return parsed;
}

/**
 * A turn that stopped on an error the CLI recorded is stuck until someone
 * comes back to it. Past that, the tip message answers what recency alone
 * cannot: a reply holding a call for permission — or one whose calls all
 * settled — is holding for the developer, and one with a call still open is
 * working. A killed process leaves an open call on disk forever, so an open
 * turn gone quiet is unknown rather than still working. Nothing in the
 * recording marks a session closed, so the tail alone never reports a local
 * Gemini session complete; the hook's own `session-end` is what can.
 */
function statusFromTail(
  parsed: ParsedGeminiSessionTail,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (parsed.tipType === GEMINI_MESSAGE_TYPE.ERROR) return SESSION_STATUS.ERROR;
  const settled =
    parsed.tipType === GEMINI_MESSAGE_TYPE.GEMINI &&
    (parsed.holdingForApproval === true || parsed.toolCallsOpen !== true);
  const status = settled ? SESSION_STATUS.WAITING : SESSION_STATUS.WORKING;
  return localSessionStatus(status, observedAt, now, freshnessMs);
}

/**
 * What the refinement buys here is what the recording cannot say: the
 * `session-end` token is the one thing that can ever report a local Gemini
 * session complete, a notification marks a hold the moment it starts rather
 * than when the awaiting call reaches the tail, and a stop keeps a settled
 * turn waiting past the freshness decay. The notification keeps waiting past
 * freshness too — a standing event is proof the hold still stands, because
 * any record at or past it would have discarded it, and a crash mid-hold
 * leaves that proof standing only until the spool prune retires it.
 */
const GEMINI_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: GEMINI_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    { event: GEMINI_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: GEMINI_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
    {
      event: GEMINI_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.WAITING,
    },
  ],
  notificationEvent: GEMINI_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: GEMINI_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<GeminiHookEvent>;

/**
 * The session's full id, from the metadata line the CLI writes once as a
 * recording opens. The file's own name truncates the id to eight characters,
 * but the hook envelope names sessions whole, so this line is the one join
 * between the spool and the recording it refines.
 */
function sessionIdFromHead(head: string): string | undefined {
  for (const record of tailRecords(head)) {
    const sessionId = text(record.sessionId);
    if (sessionId) return sessionId;
  }
  return undefined;
}

/**
 * Gemini CLI writes a one-sentence summary of what the session is about, and
 * that is the name a developer is looking for. The workspace stands in for a
 * session the CLI has not summarized yet.
 */
function titleFromTail(parsed: ParsedGeminiSessionTail, workspace: string): string {
  return oneLine(parsed.summary, maximumSessionTitleLength) ?? workspace;
}

/**
 * No address is reported, because Gemini CLI publishes none that opens a
 * session: its own resume is a terminal invocation, not a route the operating
 * system can be handed.
 */
function detailFromTail(parsed: ParsedGeminiSessionTail, workspace: string): SessionDetail {
  return {
    ...(parsed.activity ? { activity: parsed.activity } : undefined),
    repository: workspace,
    ...(parsed.model ? { model: parsed.model } : undefined),
    ...(parsed.failure ? { error: parsed.failure } : undefined),
  };
}

interface GeminiSessionFileCandidate extends SessionFileCandidate {
  projectDirectory: string;
}

/**
 * The sessions directly inside one project's chats directory. A subdirectory
 * holds a subagent's conversation, which is part of the session that spawned
 * it rather than a row of its own, so only files are read.
 */
async function sessionFilesIn(
  chatsDirectory: string,
  project: { directoryPath: string },
): Promise<GeminiSessionFileCandidate[]> {
  const entries = await readDirectory(chatsDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromFileName(entry.name, GEMINI_SESSION_FILE_EXTENSION);
      if (!providerSessionId) return undefined;
      const candidate = await statDirectoryEntry(chatsDirectory, entry.name);
      if (!candidate?.stats.isFile()) return undefined;
      return {
        filePath: candidate.directoryPath,
        providerSessionId,
        mtimeMs: candidate.stats.mtimeMs,
        projectDirectory: project.directoryPath,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is GeminiSessionFileCandidate => candidate !== undefined,
  );
}

/**
 * The workspace a project directory observes: the project path its
 * `.project_root` marker names, or the directory's own readable slug for a
 * marker that is missing — a slug is the project's basename, which is the
 * label anyway. A legacy sha256-named directory labels nothing a person can
 * read, so it falls back to the unknown label rather than posing as one.
 */
function workspaceFrom(projectRoot: string | undefined, projectDirectory: string): string {
  if (projectRoot?.trim()) return workspaceLabel(projectRoot);
  const slug = path.basename(projectDirectory);
  if (!slug || GEMINI_LEGACY_HASH_DIRECTORY_PATTERN.test(slug)) return workspaceLabel(undefined);
  return slug;
}

/**
 * Observes the Gemini CLI sessions on this machine from the recordings the
 * CLI already writes for itself: the append-only JSONL files under its own
 * per-project chats directories. It runs no server, needs no credential, and
 * opens everything read-only; the observation hook registered beside it only
 * ever sharpens what those recordings already showed.
 */
export class GeminiCliSessionAdapter extends LocalFileSessionAdapter<
  GeminiSessionFileCandidate,
  ParsedGeminiSessionTail
> {
  readonly provider = GEMINI_CLI_PROVIDER;

  readonly #geminiHome: string;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;
  /** What each project's marker named, refreshed every pass and never grown past it. */
  #projectRoots = new Map<string, string | undefined>();

  constructor(options: GeminiCliAdapterOptions = {}) {
    super(options);
    this.#geminiHome = options.geminiHome ?? defaultGeminiCliHome();
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
    this.#hookEventsDirectory = options.hookEventsDirectory;
  }

  protected discover(): Promise<GeminiSessionFileCandidate[]> {
    return discoverSessionFiles({
      projectsDirectory: path.join(this.#geminiHome, GEMINI_TMP_DIRECTORY),
      sessionsDirectoryName: GEMINI_CHATS_DIRECTORY,
      maximumProjectDirectories: GEMINI_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
      sessionFilesIn,
    });
  }

  protected override async prepare(
    candidates: readonly GeminiSessionFileCandidate[],
  ): Promise<void> {
    const projectRoots = new Map<string, string | undefined>();
    for (const candidate of candidates) {
      if (projectRoots.has(candidate.projectDirectory)) continue;
      const marker = await readTextFile(
        path.join(candidate.projectDirectory, GEMINI_PROJECT_ROOT_FILE),
      );
      projectRoots.set(candidate.projectDirectory, marker?.trim() || undefined);
    }
    this.#projectRoots = projectRoots;
  }

  protected async parse(candidate: GeminiSessionFileCandidate): Promise<ParsedGeminiSessionTail> {
    const parsed = parseGeminiSessionTail(
      await readTail(candidate.filePath, LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES),
    );
    // The head is read only where a spool could answer for it: the full id
    // matters to nothing else this adapter reports.
    if (this.#hookEventsDirectory !== undefined) {
      parsed.sessionId = sessionIdFromHead(
        await readHead(candidate.filePath, GEMINI_ADAPTER_DEFAULTS.READ_HEAD_BYTES),
      );
    }
    return parsed;
  }

  protected async observation(
    candidate: GeminiSessionFileCandidate,
    parsed: ParsedGeminiSessionTail,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> {
    const workspace = workspaceFrom(
      this.#projectRoots.get(candidate.projectDirectory),
      candidate.projectDirectory,
    );
    // The conversation's own clock, not the file's: Gemini CLI appends
    // summary bookkeeping to old sessions at later startups, bumping their
    // mtimes the way any bulk touch would. The file's date remains the
    // fallback for a slice holding no conversation stamp at all.
    const conversationAt = parsed.timestampMs ?? candidate.mtimeMs;
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    const hookEvent =
      hookEventsDirectory !== undefined && parsed.sessionId !== undefined
        ? await readGeminiHookEvent(hookEventsDirectory, parsed.sessionId).catch(() => undefined)
        : undefined;
    // A prompt event always precedes the reply it opened, so a tip already
    // holding a call for approval has outrun it: the hold stands rather than
    // reading as busy for the tolerance window before the notification lands.
    const standingHookEvent =
      hookEvent?.event === GEMINI_HOOK_EVENT.PROMPT && parsed.holdingForApproval === true
        ? undefined
        : hookEvent;
    const refined = hookRefinedStatus({
      refinement: GEMINI_HOOK_STATUS_REFINEMENT,
      hookEvent: standingHookEvent,
      providerAtMs: conversationAt,
      statusAt: (observedAt) => statusFromTail(parsed, observedAt, now, activeSessionFreshnessMs),
      now,
      activeSessionFreshnessMs,
    });
    const holdingForDeveloper =
      refined.holdingForDeveloper ||
      (refined.status === SESSION_STATUS.WAITING && parsed.holdingForApproval === true);
    return {
      providerSessionId: candidate.providerSessionId,
      title: titleFromTail(parsed, workspace),
      status: refined.status,
      ...(refined.sessionClosed
        ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
        : undefined),
      observedAt: refined.observedAt,
      ...(parsed.recap ? { recap: parsed.recap } : undefined),
      detail: detailFromTail(parsed, workspace),
      ...(holdingForDeveloper ? { holdingForDeveloper: true } : undefined),
    };
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return readGeminiSessionTranscript({
      geminiHome: this.#geminiHome,
      providerSessionId,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }
}
