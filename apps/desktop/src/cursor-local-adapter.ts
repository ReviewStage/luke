import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRecord,
  oneLine,
  type ProviderSessionObservation,
  resolveOptions,
  SESSION_STATUS,
  type SessionDetail,
  type SessionStatus,
  text,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/core";
import { CURSOR_PROVIDER } from "./cursor-adapter";
import {
  type DirectoryEntry,
  discoverSessionFiles,
  fileStats,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  localSessionStatus,
  readDirectory,
  readTail,
  readTextFile,
  type SessionFileCandidate,
  statDirectoryEntry,
  tailRecords,
  workspaceLabel,
} from "./local-session-adapter";
import { boundedTranscript, TRANSCRIPT_BOUNDS } from "./local-transcript";

/** A turn Cursor failed records its own reason, which is transcript content. */
const CURSOR_TURN_FAILED_MESSAGE = "The turn failed";

const CURSOR_DIRECTORY = {
  /** One directory per folder Cursor has been opened on, named after that folder. */
  PROJECTS: "projects",
  /** One directory per session inside a project, named after the session. */
  TRANSCRIPTS: "agent-transcripts",
} as const;

/** Where the app keeps a record of each folder it has opened, one directory each. */
const CURSOR_WORKSPACE_STORAGE_SEGMENTS = [
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "workspaceStorage",
] as const;

const CURSOR_TRANSCRIPT_FILE_EXTENSION = ".jsonl";
const CURSOR_WORKSPACE_FILE = "workspace.json";

const CURSOR_WORKSPACE_FIELD = {
  /** A window opened on a single folder. Cursor omits it for every other window. */
  FOLDER: "folder",
} as const;

const CURSOR_RECORD_FIELD = {
  ROLE: "role",
  STATUS: "status",
  TYPE: "type",
} as const;

/** The one record type Luke reads: Cursor marking the end of a turn. */
const CURSOR_RECORD_TYPE = {
  TURN_ENDED: "turn_ended",
} as const;

/**
 * How a turn ended. Only failure is named: every other outcome is a turn that
 * finished and is holding for the user, including one this build cannot name.
 */
const CURSOR_TURN_STATUS = {
  ERROR: "error",
} as const;

/** Who a message record belongs to. Its content is never read. */
const CURSOR_ROLE = {
  ASSISTANT: "assistant",
  USER: "user",
} as const;

const CURSOR_LOCAL_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
} as const;

export interface CursorLocalAdapterOptions {
  cursorHome?: string;
  workspaceStorageDirectory?: string;
  now?: () => number;
  maximumProjectDirectories?: number;
  activeSessionFreshnessMs?: number;
  transcriptReadTailBytes?: number;
  transcriptMaximumRenderedLength?: number;
  readTailBytes?: number;
}

interface CursorTranscriptCandidate extends SessionFileCandidate {
  projectDirectoryName: string;
}

/**
 * Reduces a name to what both halves of Cursor's local state can still agree
 * on. Cursor files a project under a directory named after its folder, with the
 * characters it will not put in one rewritten — but exactly which characters a
 * given build rewrites is Cursor's business, not Luke's. Rather than reproduce
 * that rule and be wrong whenever it differs, the directory Cursor wrote and
 * the folder Luke is matching it to are reduced the same way, so any character
 * either side may have rewritten stops being the difference between them.
 *
 * This deliberately loses information: two folders can reduce alike, and the
 * caller names neither rather than guessing. That is the safe direction — the
 * cost is a session labelled `workspace`, which is what it would have been.
 */
function canonicalProjectName(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function folderPathFromWorkspaceRecord(source: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const folder = (parsed as Record<string, unknown>)[CURSOR_WORKSPACE_FIELD.FOLDER];
  if (typeof folder !== "string") return undefined;
  try {
    return fileURLToPath(folder);
  } catch {
    // A window opened on something that is not a folder on this machine.
    return undefined;
  }
}

/**
 * Names the folder a session ran in. A transcript records neither its folder
 * nor its own path — only the project directory Cursor filed it under, whose
 * name has already lost the separators of the path it was made from. Cursor
 * keeps the folder itself in its workspace records, so the label is recovered
 * by reducing both to the name they still share, and never by guessing at
 * where the hyphens in a directory name used to be.
 */
class CursorWorkspaceLabels {
  readonly #directory: string;
  readonly #labelsByProjectName = new Map<string, string | undefined>();
  readonly #readWorkspaceRecords = new Set<string>();

  constructor(directory: string) {
    this.#directory = directory;
  }

  /**
   * Reads Cursor's workspace records for any project this pass cannot already
   * name. A record is read once; a project that stays unnamed is looked for
   * again, because the folder it belongs to may be opened later.
   */
  async resolve(projectDirectoryNames: readonly string[]): Promise<void> {
    if (
      projectDirectoryNames.every((name) =>
        this.#labelsByProjectName.has(canonicalProjectName(name)),
      )
    ) {
      return;
    }
    for (const entry of await readDirectory(this.#directory)) {
      if (this.#readWorkspaceRecords.has(entry.name)) continue;
      this.#readWorkspaceRecords.add(entry.name);
      const record = await readTextFile(
        path.join(this.#directory, entry.name, CURSOR_WORKSPACE_FILE),
      );
      const folderPath = record ? folderPathFromWorkspaceRecord(record) : undefined;
      if (folderPath) this.#record(folderPath);
    }
  }

  label(projectDirectoryName: string): string {
    return (
      this.#labelsByProjectName.get(canonicalProjectName(projectDirectoryName)) ??
      UNKNOWN_WORKSPACE_LABEL
    );
  }

  #record(folderPath: string): void {
    const projectName = canonicalProjectName(folderPath);
    const label = workspaceLabel(folderPath);
    if (!this.#labelsByProjectName.has(projectName)) {
      this.#labelsByProjectName.set(projectName, label);
      return;
    }
    // Two folders can reduce to one project name. When they disagree about
    // what to call it, Luke names neither.
    if (this.#labelsByProjectName.get(projectName) !== label) {
      this.#labelsByProjectName.set(projectName, undefined);
    }
  }
}

async function transcriptsIn(
  transcriptsDirectory: string,
  projectDirectory: DirectoryEntry,
): Promise<CursorTranscriptCandidate[]> {
  const entries = await readDirectory(transcriptsDirectory);
  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const providerSessionId = entry.name.trim();
      if (!providerSessionId) return undefined;
      // Cursor names a session's own transcript after the session, so this
      // reads that file rather than everything in the directory: the subagents
      // a session spawns file their transcripts beside it, and they are part of
      // the session rather than sessions of their own.
      const filePath = path.join(
        transcriptsDirectory,
        entry.name,
        `${entry.name}${CURSOR_TRANSCRIPT_FILE_EXTENSION}`,
      );
      const stats = await fileStats(filePath);
      if (!stats?.isFile()) return undefined;
      return {
        filePath,
        providerSessionId,
        mtimeMs: stats.mtimeMs,
        projectDirectoryName: projectDirectory.name,
      };
    }),
  );
  return candidates.filter(
    (candidate): candidate is CursorTranscriptCandidate => candidate !== undefined,
  );
}

function isMessageRecord(record: Record<string, unknown>): boolean {
  const role = record[CURSOR_RECORD_FIELD.ROLE];
  return Object.values(CURSOR_ROLE).some((knownRole) => knownRole === role);
}

/**
 * How the newest turn ended, or nothing while one is still open. Cursor marks
 * the end of a turn explicitly, so an open turn is read from the absence of
 * that mark rather than inferred from what the assistant last said — which is
 * transcript content, and is not read here at all. A record this build does not
 * know is passed over rather than taken for either.
 */
function closedTurn(tail: string): { failed: boolean } | undefined {
  for (const record of tailRecords(tail).toReversed()) {
    if (record[CURSOR_RECORD_FIELD.TYPE] === CURSOR_RECORD_TYPE.TURN_ENDED) {
      return { failed: record[CURSOR_RECORD_FIELD.STATUS] === CURSOR_TURN_STATUS.ERROR };
    }
    if (isMessageRecord(record)) return undefined;
  }
  return undefined;
}

/**
 * A turn Cursor has closed is holding for the user; one it failed is stuck
 * until someone comes back to it, which asks something different and is
 * reported as such. Anything else is a turn still in progress. A transcript
 * has no heartbeat, so an open turn that has gone quiet is unknown rather
 * than still working.
 */
function statusFromTurn(
  turn: { failed: boolean } | undefined,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (turn?.failed) return SESSION_STATUS.ERROR;
  const status = turn ? SESSION_STATUS.WAITING : SESSION_STATUS.WORKING;
  return localSessionStatus(status, observedAt, now, freshnessMs);
}

/**
 * What Cursor knows about a local session beyond its state: the folder, and
 * that a turn failed. Cursor records why it failed, but that reason is written
 * from the turn itself, so the fact of the failure is reported and its wording
 * is not — the same fixed line the cloud half reports for a failed run.
 *
 * No address, unlike the cloud half, which reports the agent's own page. Cursor
 * registers `cursor://` for its windows but publishes no route to a chat: its
 * handler answers a prompt, a command, a rule, and a background agent, and none
 * of them is a chat that already exists. The folder the chat was held in is not
 * the chat, so it is not offered as one.
 */
function detailFor(label: string, status: SessionStatus): SessionDetail {
  return {
    repository: label,
    ...(status === SESSION_STATUS.ERROR ? { error: CURSOR_TURN_FAILED_MESSAGE } : {}),
  };
}

function defaultCursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

function defaultWorkspaceStorageDirectory(): string {
  return path.join(os.homedir(), ...CURSOR_WORKSPACE_STORAGE_SEGMENTS);
}

/**
 * Observes the Cursor sessions that run on this machine, from the transcripts
 * Cursor already writes for itself. It reads no message content, needs no
 * credential, and reports nothing that Cursor has not written down.
 */
export class CursorLocalSessionAdapter extends LocalFileSessionAdapter<
  CursorTranscriptCandidate,
  { failed: boolean } | undefined
> {
  readonly provider = CURSOR_PROVIDER;

  readonly #cursorHome: string;
  readonly #workspaceLabels: CursorWorkspaceLabels;
  readonly #maximumProjectDirectories: number;
  readonly #readTailBytes: number;
  readonly #transcriptReadTailBytes: number | undefined;
  readonly #transcriptMaximumRenderedLength: number | undefined;

  constructor(options: CursorLocalAdapterOptions = {}) {
    super(options);
    this.#cursorHome = options.cursorHome ?? defaultCursorHome();
    this.#workspaceLabels = new CursorWorkspaceLabels(
      options.workspaceStorageDirectory ?? defaultWorkspaceStorageDirectory(),
    );
    const resolved = resolveOptions(
      options,
      {
        maximumProjectDirectories: CURSOR_LOCAL_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
        readTailBytes: LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
      },
      {
        positive: ["maximumProjectDirectories", "readTailBytes"],
      },
    );
    this.#maximumProjectDirectories = resolved.maximumProjectDirectories;
    this.#readTailBytes = resolved.readTailBytes;
    this.#transcriptReadTailBytes = options.transcriptReadTailBytes;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
  }

  protected discover(): Promise<CursorTranscriptCandidate[]> {
    return discoverSessionFiles({
      projectsDirectory: path.join(this.#cursorHome, CURSOR_DIRECTORY.PROJECTS),
      sessionsDirectoryName: CURSOR_DIRECTORY.TRANSCRIPTS,
      maximumProjectDirectories: this.#maximumProjectDirectories,
      sessionFilesIn: transcriptsIn,
    });
  }

  protected override prepare(candidates: readonly CursorTranscriptCandidate[]): Promise<void> {
    return this.#workspaceLabels.resolve(
      candidates.map((candidate) => candidate.projectDirectoryName),
    );
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return CursorTranscript.read({
      cursorHome: this.#cursorHome,
      providerSessionId,
      readTailBytes: this.#transcriptReadTailBytes,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }

  protected async parse(
    candidate: CursorTranscriptCandidate,
  ): Promise<{ failed: boolean } | undefined> {
    return closedTurn(await readTail(candidate.filePath, this.#readTailBytes));
  }

  /**
   * A session is named by the folder it ran in and by nothing else. Cursor
   * names a chat from its opening prompt, so that name is the prompt and never
   * reaches an observation — and the location is left unsaid, which is how an
   * adapter reading this machine reports one that runs on it.
   */
  protected observation(
    candidate: CursorTranscriptCandidate,
    turn: { failed: boolean } | undefined,
    now: number,
    activeSessionFreshnessMs: number,
  ): ProviderSessionObservation {
    const label = this.#workspaceLabels.label(candidate.projectDirectoryName);
    const status = statusFromTurn(turn, candidate.mtimeMs, now, activeSessionFreshnessMs);
    return {
      providerSessionId: candidate.providerSessionId,
      title: label,
      status,
      // A transcript carries no timestamps of its own, so when it was last
      // written is the only account Cursor keeps of when this session last did
      // anything.
      observedAt: candidate.mtimeMs,
      detail: detailFor(label, status),
    };
  }
}

namespace CursorTranscript {
  /**
   * On-demand reading of one local Cursor session's transcript, for a question
   * the developer just asked. The JSONL file under Cursor's own projects
   * directory is the transcript — the same file the adapter reads its turn
   * markers from — so this reads it the way the adapter reads its tail, only
   * deeper: a bounded slice, parsed in memory, rendered into a bounded
   * conversation, and discarded. Nothing here is retained, watched, or written;
   * a session is re-read the next time it is asked about.
   *
   * Cursor deliberately keeps tool outputs out of these files, so the rendering
   * carries the developer's words, the agent's replies, its tool calls, and how
   * a failed turn failed — and no `←` lines, because there is honestly nothing
   * to put on them.
   */

  const CURSOR_SPEAKER_NAME = "Cursor";

  const CURSOR_PROJECTS_DIRECTORY = "projects";
  const CURSOR_TRANSCRIPTS_DIRECTORY = "agent-transcripts";
  const CURSOR_TRANSCRIPT_FILE_EXTENSION = ".jsonl";

  /**
   * The id becomes path segments under Cursor's home, so only a plain file-name
   * shape is accepted at all: it must start on a letter or digit, and nothing
   * that could climb a directory gets past the first character.
   */
  const CURSOR_SESSION_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

  const CURSOR_RECORD_ROLE = {
    USER: "user",
    ASSISTANT: "assistant",
  } as const;

  /** The turn marker the adapter already reads, here for how a turn failed. */
  const CURSOR_RECORD_TYPE = {
    TURN_ENDED: "turn_ended",
  } as const;

  const CURSOR_TURN_STATUS = {
    ERROR: "error",
  } as const;

  const CURSOR_CONTENT_TYPE = {
    TEXT: "text",
    TOOL_USE: "tool_use",
  } as const;

  /** Tool inputs whose value names the work, in the order they read best. */
  const CURSOR_TOOL_INPUT_KEY = [
    "description",
    "file_path",
    "pattern",
    "command",
    "query",
    "prompt",
  ] as const;

  /**
   * The tags Cursor wraps around what the developer typed. The words live
   * inside `user_query`; everything else a user record carries — timestamps,
   * attached files, reminders — is Cursor's own scaffolding.
   */
  const CURSOR_USER_QUERY_SHAPE = /<user_query>([\s\S]*?)<\/user_query>/g;

  /**
   * A user message that is entirely XML-tagged blocks with no query among them
   * is scaffolding alone, not something the developer said.
   */
  const CURSOR_SCAFFOLDING_SHAPE = /^(?:<([a-z_]+)>[\s\S]*?<\/\1>\s*)+$/;

  interface Request {
    cursorHome?: string;
    providerSessionId: string;
    readTailBytes?: number;
    maximumRenderedLength?: number;
  }

  function defaultCursorHome(): string {
    return path.join(os.homedir(), ".cursor");
  }

  function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
    const message = record.message;
    const content = isRecord(message) ? message.content : undefined;
    return Array.isArray(content) ? content.filter(isRecord) : [];
  }

  /** The words of a message, whether the content is a string or text blocks. */
  function messageText(record: Record<string, unknown>): string | undefined {
    const message = record.message;
    const content = isRecord(message) ? message.content : undefined;
    if (typeof content === "string") return text(content);
    const parts = contentBlocks(record)
      .filter((block) => block.type === CURSOR_CONTENT_TYPE.TEXT)
      .map((block) => text(block.text))
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  /**
   * The developer's own words in a user record: the `user_query` blocks when
   * Cursor wrapped them, the whole text when it did not, and nothing when the
   * record is scaffolding alone.
   */
  function developerWords(words: string): string | undefined {
    const queries = [...words.matchAll(CURSOR_USER_QUERY_SHAPE)]
      .map((match) => text(match[1]))
      .filter((query): query is string => query !== undefined);
    if (queries.length > 0) return queries.join(" ");
    if (CURSOR_SCAFFOLDING_SHAPE.test(words.trim())) return undefined;
    return text(words);
  }

  function toolLine(block: Record<string, unknown>): string | undefined {
    const name = text(block.name);
    if (!name) return undefined;
    const input = isRecord(block.input) ? block.input : {};
    for (const key of CURSOR_TOOL_INPUT_KEY) {
      const detail = oneLine(text(input[key]), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH);
      if (detail) return `→ ${name}: ${detail}`;
    }
    return `→ ${name}`;
  }

  /** Renders one record into the lines a conversation can carry, oldest first. */
  function linesFromRecord(record: Record<string, unknown>): string[] {
    if (record.type === CURSOR_RECORD_TYPE.TURN_ENDED) {
      if (record.status !== CURSOR_TURN_STATUS.ERROR) return [];
      const reason = isRecord(record.error)
        ? oneLine(text(record.error.message), TRANSCRIPT_BOUNDS.MAXIMUM_TOOL_LENGTH)
        : undefined;
      return [reason ? `Error: ${reason}` : "Error: The turn failed"];
    }
    if (record.role === CURSOR_RECORD_ROLE.USER) {
      const words = messageText(record);
      const typed = words
        ? oneLine(developerWords(words), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH)
        : undefined;
      return typed ? [`Developer: ${typed}`] : [];
    }
    if (record.role === CURSOR_RECORD_ROLE.ASSISTANT) {
      const lines: string[] = [];
      const words = oneLine(messageText(record), TRANSCRIPT_BOUNDS.MAXIMUM_MESSAGE_LENGTH);
      if (words) lines.push(`${CURSOR_SPEAKER_NAME}: ${words}`);
      for (const block of contentBlocks(record)) {
        if (block.type !== CURSOR_CONTENT_TYPE.TOOL_USE) continue;
        const line = toolLine(block);
        if (line) lines.push(line);
      }
      return lines;
    }
    return [];
  }

  /**
   * Finds the session's transcript file the way discovery does — the file named
   * by the session's own id, inside that session's directory under one of the
   * project directories — without trusting the id as a path: an id outside a
   * plain file-name shape names nothing.
   */
  async function transcriptFilePath(
    cursorHome: string,
    providerSessionId: string,
  ): Promise<string | undefined> {
    if (!CURSOR_SESSION_ID_SHAPE.test(providerSessionId)) return undefined;
    const projectsDirectory = path.join(cursorHome, CURSOR_PROJECTS_DIRECTORY);
    const fileName = `${providerSessionId}${CURSOR_TRANSCRIPT_FILE_EXTENSION}`;
    for (const entry of await readDirectory(projectsDirectory)) {
      const projectDirectory = await statDirectoryEntry(projectsDirectory, entry.name);
      if (!projectDirectory?.stats.isDirectory()) continue;
      const sessionDirectory = await statDirectoryEntry(
        path.join(projectDirectory.directoryPath, CURSOR_TRANSCRIPTS_DIRECTORY),
        providerSessionId,
      );
      if (!sessionDirectory?.stats.isDirectory()) continue;
      const candidate = await statDirectoryEntry(sessionDirectory.directoryPath, fileName);
      if (candidate?.stats.isFile()) return candidate.directoryPath;
    }
    return undefined;
  }

  /**
   * Reads one session's recent transcript into a bounded rendering, or nothing
   * when no transcript file exists for that id.
   */
  export async function read(request: Request): Promise<string | undefined> {
    const filePath = await transcriptFilePath(
      request.cursorHome ?? defaultCursorHome(),
      request.providerSessionId,
    );
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
