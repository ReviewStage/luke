import path from "node:path";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  providerTranscriptResult,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, isWireString, oneLine, text, type WireRecord } from "@sidecar/wire";
import {
  discoverSessionFiles,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  localSessionStatus,
  readDirectory,
  readHead,
  readTail,
  type SessionFileCandidate,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import { defaultOmpHome, OMP_SESSIONS_DIRECTORY, sessionIdFromOmpFileName } from "./records.js";
import { readOmpSessionTranscript } from "./transcript.js";

const OMP_PROVIDER_ID = PROVIDER_ID.OMP;
const OMP_PROVIDER_NAME = "OMP";

const OMP_RECORD_TYPE = {
  TITLE: "title",
  SESSION: "session",
  MESSAGE: "message",
  CUSTOM: "custom",
} as const;

const OMP_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_RESULT: "toolResult",
} as const;

const OMP_CONTENT_TYPE = {
  TEXT: "text",
  TOOL_CALL: "toolCall",
} as const;

const OMP_CUSTOM_TYPE = {
  TOOL_EXECUTION_START: "tool_execution_start",
  SESSION_EXIT: "session_exit",
} as const;

const OMP_EXIT_KIND = {
  FATAL: "fatal",
} as const;

const OMP_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_ACTIVITY_LENGTH: 80,
  /** Title slot plus session header live at the start of every recording. */
  READ_HEAD_BYTES: 16 * 1024,
} as const;

export const OMP_PROVIDER: SessionProvider = {
  id: OMP_PROVIDER_ID,
  displayName: OMP_PROVIDER_NAME,
};

export interface OmpAdapterOptions {
  ompHome?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
  transcriptMaximumRenderedLength?: number;
}

function timestampMsFrom(record: WireRecord): number | undefined {
  const timestamp = record.timestamp;
  if (!isWireString(timestamp)) return undefined;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

function messageFrom(record: WireRecord): WireRecord | undefined {
  if (record.type !== OMP_RECORD_TYPE.MESSAGE) return undefined;
  return isRecord(record.message) ? record.message : undefined;
}

function contentBlocks(message: WireRecord): WireRecord[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : [];
}

function textFromMessage(message: WireRecord): string | undefined {
  const parts = contentBlocks(message)
    .filter((block) => block.type === OMP_CONTENT_TYPE.TEXT)
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

interface OpenTool {
  name?: string;
  intent?: string;
}

function rememberOpenTool(open: Map<string, OpenTool>, id: string, tool: OpenTool): void {
  const existing = open.get(id) ?? {};
  open.set(id, {
    name: tool.name ?? existing.name,
    intent: tool.intent ?? existing.intent,
  });
}

function activityFromOpenTools(open: ReadonlyMap<string, OpenTool>): string | undefined {
  let last: OpenTool | undefined;
  for (const tool of open.values()) last = tool;
  if (!last) return undefined;
  const intent = oneLine(last.intent, OMP_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
  const name = oneLine(last.name, OMP_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
  if (name && intent) return `${name}: ${intent}`;
  return intent ?? name;
}

export interface ParsedOmpSession {
  cwd?: string;
  title?: string;
  model?: string;
  timestampMs?: number;
  recap?: string;
  activity?: string;
  failure?: string;
  sessionClosed?: boolean;
  fatalExit?: boolean;
  openTools?: boolean;
  lastRole?: string;
}

function parseHead(head: string): Pick<ParsedOmpSession, "cwd" | "title"> {
  const parsed: Pick<ParsedOmpSession, "cwd" | "title"> = {};
  for (const record of tailRecords(head)) {
    if (record.type === OMP_RECORD_TYPE.TITLE) {
      const title = oneLine(text(record.title), maximumSessionTitleLength);
      if (title) parsed.title = title;
      continue;
    }
    if (record.type === OMP_RECORD_TYPE.SESSION) {
      parsed.cwd = text(record.cwd);
      if (parsed.title === undefined) {
        const title = oneLine(text(record.title), maximumSessionTitleLength);
        if (title) parsed.title = title;
      }
      return parsed;
    }
  }
  return parsed;
}

function parseTail(tail: string): Omit<ParsedOmpSession, "cwd" | "title"> {
  const open = new Map<string, OpenTool>();
  const parsed: Omit<ParsedOmpSession, "cwd" | "title"> = {};

  for (const record of tailRecords(tail)) {
    const at = timestampMsFrom(record);
    if (at !== undefined) parsed.timestampMs = at;

    if (record.type === OMP_RECORD_TYPE.CUSTOM) {
      if (record.customType === OMP_CUSTOM_TYPE.TOOL_EXECUTION_START && isRecord(record.data)) {
        const id = text(record.data.toolCallId);
        if (id) {
          rememberOpenTool(open, id, {
            name: text(record.data.toolName),
            intent: text(record.data.intent),
          });
        }
        continue;
      }
      if (record.customType === OMP_CUSTOM_TYPE.SESSION_EXIT) {
        parsed.sessionClosed = true;
        parsed.fatalExit = isRecord(record.data) && record.data.kind === OMP_EXIT_KIND.FATAL;
      }
      continue;
    }

    const message = messageFrom(record);
    if (!message) continue;
    const role = text(message.role);
    if (!role) continue;
    parsed.lastRole = role;

    if (role === OMP_MESSAGE_ROLE.USER) {
      parsed.recap = undefined;
      continue;
    }

    if (role === OMP_MESSAGE_ROLE.TOOL_RESULT) {
      const id = text(message.toolCallId);
      if (id) open.delete(id);
      continue;
    }

    if (role !== OMP_MESSAGE_ROLE.ASSISTANT) continue;
    if (text(message.model)) parsed.model = text(message.model);
    if (message.isError === true) {
      parsed.failure = oneLine(
        textFromMessage(message),
        OMP_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
      );
    }
    for (const block of contentBlocks(message)) {
      if (block.type !== OMP_CONTENT_TYPE.TOOL_CALL) continue;
      const id = text(block.id);
      if (!id) continue;
      rememberOpenTool(open, id, {
        name: text(block.name),
        intent: text(block.intent),
      });
    }
    if (open.size === 0 && message.isError !== true) {
      parsed.recap = oneLine(textFromMessage(message), maximumSessionRecapLength);
    } else {
      parsed.recap = undefined;
    }
  }

  parsed.openTools = open.size > 0;
  parsed.activity = activityFromOpenTools(open);
  return parsed;
}

export function parseOmpSession(head: string, tail: string): ParsedOmpSession {
  return { ...parseHead(head), ...parseTail(tail) };
}

/**
 * A fatal exit or a recorded assistant error is stuck until someone comes
 * back to it. A `session_exit` otherwise means the process closed, which the
 * recording can say without a hook. Past that, open tools or a prompt the
 * model has not answered are working, and a settled assistant turn is holding
 * for the developer. A killed process can leave an open tool on disk forever,
 * so a working turn gone quiet is unknown rather than still working.
 */
function statusFromParsed(
  parsed: ParsedOmpSession,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (parsed.fatalExit === true || parsed.failure !== undefined) return SESSION_STATUS.ERROR;
  if (parsed.sessionClosed === true) return SESSION_STATUS.COMPLETE;
  const working =
    parsed.openTools === true ||
    parsed.lastRole === OMP_MESSAGE_ROLE.USER ||
    parsed.lastRole === OMP_MESSAGE_ROLE.TOOL_RESULT;
  const status = working ? SESSION_STATUS.WORKING : SESSION_STATUS.WAITING;
  return localSessionStatus(status, observedAt, now, freshnessMs);
}

/**
 * No address is reported, because OMP publishes none that opens a session:
 * its own resume is a terminal invocation, not a route the operating system
 * can be handed.
 */
function detailFromParsed(parsed: ParsedOmpSession, workspace: string): SessionDetail {
  return {
    ...(parsed.activity ? { activity: parsed.activity } : undefined),
    repository: workspace,
    ...(parsed.model ? { model: parsed.model } : undefined),
    ...(parsed.failure ? { error: parsed.failure } : undefined),
  };
}
interface OmpSessionFileCandidate extends SessionFileCandidate {
  projectDirectory: string;
}

/**
 * The sessions directly inside one encoded-cwd directory. A sidecar directory
 * named after a session holds blobs, not a row of its own, so only files are
 * read.
 */
async function sessionFilesIn(
  sessionsDirectory: string,
  project: { directoryPath: string },
): Promise<OmpSessionFileCandidate[]> {
  const entries = await readDirectory(sessionsDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = sessionIdFromOmpFileName(entry.name);
      if (!providerSessionId) return undefined;
      const candidate = await statDirectoryEntry(sessionsDirectory, entry.name);
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
    (candidate): candidate is OmpSessionFileCandidate => candidate !== undefined,
  );
}

/**
 * Observes the OMP sessions on this machine from the JSONL recordings the
 * CLI already writes for itself. Observation is read-only; OMP documents no
 * way to message or open a live session from outside its own process.
 */
export class OmpSessionAdapter extends LocalFileSessionAdapter<
  OmpSessionFileCandidate,
  ParsedOmpSession
> {
  readonly provider = OMP_PROVIDER;

  readonly #ompHome: string;
  readonly #transcriptMaximumRenderedLength: number | undefined;

  constructor(options: OmpAdapterOptions = {}) {
    super(options);
    this.#ompHome = options.ompHome ?? defaultOmpHome();
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
  }

  protected discover(): Promise<OmpSessionFileCandidate[]> {
    return discoverSessionFiles({
      projectsDirectory: path.join(this.#ompHome, OMP_SESSIONS_DIRECTORY),
      maximumProjectDirectories: OMP_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
      sessionFilesIn,
    });
  }

  protected async parse(candidate: OmpSessionFileCandidate): Promise<ParsedOmpSession> {
    const [head, tail] = await Promise.all([
      readHead(candidate.filePath, OMP_ADAPTER_DEFAULTS.READ_HEAD_BYTES),
      readTail(candidate.filePath, LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES),
    ]);
    return parseOmpSession(head, tail);
  }

  protected observation(
    candidate: OmpSessionFileCandidate,
    parsed: ParsedOmpSession,
    now: number,
    activeSessionFreshnessMs: number,
  ): ProviderSessionObservation {
    const workspace = workspaceLabel(parsed.cwd);
    const conversationAt = parsed.timestampMs ?? candidate.mtimeMs;
    const status = statusFromParsed(parsed, conversationAt, now, activeSessionFreshnessMs);
    return {
      providerSessionId: candidate.providerSessionId,
      title: parsed.title ?? workspace,
      status,
      ...(status === SESSION_STATUS.COMPLETE && parsed.sessionClosed === true
        ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
        : undefined),
      observedAt: conversationAt,
      ...(parsed.recap ? { recap: parsed.recap } : undefined),
      detail: detailFromParsed(parsed, workspace),
    };
  }

  override readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return providerTranscriptResult(
      readOmpSessionTranscript({
        ompHome: this.#ompHome,
        providerSessionId,
        maximumRenderedLength: this.#transcriptMaximumRenderedLength,
      }),
    );
  }
}
