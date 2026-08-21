import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ProviderSessionObservation,
  SESSION_STATUS,
  type SessionDetail,
  type SessionStatus,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/session";
import {
  isRecord,
  isWireString,
  oneLine,
  resolveOptions,
  text,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
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
  tailRecords,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import { transcriptContentBlocks } from "../shared/local-transcript.js";
import { CURSOR_PROVIDER } from "./adapter.js";
import { cursorApplication, cursorChatLink } from "./app-links.js";
import { CURSOR_TOOL_INPUT_KEY, readCursorSessionTranscript } from "./transcript.js";

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

/** Where the app indexes the chats its own windows hold, one record per chat. */
const CURSOR_GLOBAL_STORAGE_STATE_SEGMENTS = [
  "Library",
  "Application Support",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb",
] as const;

/**
 * The app's record of one chat it holds, keyed by the chat's id. Only the
 * key's presence is ever read — the value is the conversation itself, and
 * observation never opens message content.
 */
const CURSOR_APP_CHAT_KEY_PREFIX = "composerData:";
const CURSOR_APP_CHAT_QUERY = "SELECT 1 FROM cursorDiskKV WHERE key = ?";

/**
 * The app's per-chat header row, which is where Cursor records that the user
 * filed a chat away. Only the presence of a positively archived row is ever
 * read — the header's own value column is the chat's name and standing, which
 * Cursor writes from the conversation, and observation never opens it.
 */
const CURSOR_APP_ARCHIVED_CHAT_QUERY =
  "SELECT 1 FROM composerHeaders WHERE composerId = ? AND isArchived = 1";

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

/** Who a message record belongs to. The conversation's words are never read. */
const CURSOR_ROLE = {
  ASSISTANT: "assistant",
  USER: "user",
} as const;

/** The one content block observation reads: the tool call a turn is running. */
const CURSOR_CONTENT_TYPE = {
  TOOL_USE: "tool_use",
} as const;

const CURSOR_LOCAL_ADAPTER_DEFAULTS = {
  MAXIMUM_PROJECT_DIRECTORIES: 200,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

export interface CursorLocalAdapterOptions {
  cursorHome?: string;
  workspaceStorageDirectory?: string;
  globalStorageStatePath?: string;
  sqlite?: SqliteModuleLoader;
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
  let parsed: WireBoundaryInput;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const record = wireRecord(unparsedWire(parsed));
  if (!record) return undefined;
  const folder = record[CURSOR_WORKSPACE_FIELD.FOLDER];
  if (!isWireString(folder)) return undefined;
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

function isMessageRecord(record: WireRecord): boolean {
  const role = record[CURSOR_RECORD_FIELD.ROLE];
  return Object.values(CURSOR_ROLE).some((knownRole) => knownRole === role);
}

/** What the bounded tail says about the newest turn. */
interface ParsedCursorTail {
  /** How the newest turn ended, or nothing while one is still open. */
  turn?: { failed: boolean };
  /** The tool call the open turn is running, named the way Codex's rows name theirs. */
  activity?: string;
}

/** Names the tool a turn called, preferring whichever input says what it is for. */
function activityFromToolUse(block: WireRecord): string | undefined {
  const name = text(block.name);
  if (!name) return undefined;
  const input = isRecord(block.input) ? block.input : {};
  for (const key of CURSOR_TOOL_INPUT_KEY) {
    const detail = oneLine(text(input[key]), CURSOR_LOCAL_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
    if (detail) return `${name}: ${detail}`;
  }
  return name;
}

/**
 * Reads the turn boundary and the current tool call out of a transcript tail.
 * Cursor marks the end of a turn explicitly, so an open turn is read from the
 * absence of that mark rather than inferred from what the assistant last said
 * — the conversation's words are not read here at all, only the tool-call
 * blocks that say what the turn is doing right now. A record this build does
 * not know is passed over rather than taken for either.
 */
function parseCursorTail(tail: string): ParsedCursorTail {
  const parsed: ParsedCursorTail = {};
  for (const record of tailRecords(tail)) {
    if (record[CURSOR_RECORD_FIELD.TYPE] === CURSOR_RECORD_TYPE.TURN_ENDED) {
      parsed.turn = { failed: record[CURSOR_RECORD_FIELD.STATUS] === CURSOR_TURN_STATUS.ERROR };
      // A turn that ended is not running its last call, and holding it would
      // keep a stale line on the row until some other tool runs.
      parsed.activity = undefined;
      continue;
    }
    if (!isMessageRecord(record)) continue;
    parsed.turn = undefined;
    if (record[CURSOR_RECORD_FIELD.ROLE] === CURSOR_ROLE.USER) {
      // A new turn is not running the previous turn's call either.
      parsed.activity = undefined;
      continue;
    }
    for (const block of transcriptContentBlocks(record, false)) {
      if (block.type !== CURSOR_CONTENT_TYPE.TOOL_USE) continue;
      parsed.activity = activityFromToolUse(block) ?? parsed.activity;
    }
  }
  return parsed;
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

/** What the app's own index says about the observed chats. */
interface CursorAppChatIndex {
  /** The chats the app holds a window record for, which can carry an address. */
  held: ReadonlySet<string>;
  /** The chats the user positively filed away, which draw no row. */
  archived: ReadonlySet<string>;
}

const EMPTY_APP_CHAT_INDEX: CursorAppChatIndex = { held: new Set(), archived: new Set() };

/**
 * Reads which of the observed chats Cursor's app holds, and which of them the
 * user has archived — each as the presence of a row in the app's own index, a
 * point lookup per chat, never a value, because the values are the
 * conversations themselves. An absent app, an unreadable or mid-write
 * database, or a schema this build does not know holds nothing, which
 * withholds addresses and keeps every row rather than inventing an address
 * the app cannot resolve or a filing away nobody performed — and never fails
 * the pass the rows come from.
 */
class CursorAppChatRegistry {
  readonly #statePath: string;
  readonly #sqlite: SqliteModuleLoader;

  constructor(statePath: string, sqlite: SqliteModuleLoader) {
    this.#statePath = statePath;
    this.#sqlite = sqlite;
  }

  // The index read is auxiliary to observing at all: a database Cursor holds
  // mid-write, or one this build cannot parse, answers nothing — never a
  // failed pass, because losing the app addresses must not cost the rows.
  async index(providerSessionIds: readonly string[]): Promise<CursorAppChatIndex> {
    if (providerSessionIds.length === 0) return EMPTY_APP_CHAT_INDEX;
    let database: SqliteDatabase | undefined;
    try {
      database = await openReadOnlyDatabase(this.#sqlite, this.#statePath);
    } catch {
      return EMPTY_APP_CHAT_INDEX;
    }
    if (!database) return EMPTY_APP_CHAT_INDEX;
    try {
      // Each lookup stands its own failure alone: a Cursor build too old to
      // keep header rows still addresses the chats it holds, and one whose
      // chat index this build cannot read still honours what the user filed
      // away.
      return {
        held: matchingChats(
          database,
          CURSOR_APP_CHAT_QUERY,
          providerSessionIds,
          (id) => `${CURSOR_APP_CHAT_KEY_PREFIX}${id}`,
        ),
        archived: matchingChats(
          database,
          CURSOR_APP_ARCHIVED_CHAT_QUERY,
          providerSessionIds,
          (id) => id,
        ),
      };
    } finally {
      database.close();
    }
  }
}

function matchingChats(
  database: SqliteDatabase,
  query: string,
  providerSessionIds: readonly string[],
  parameter: (providerSessionId: string) => string,
): ReadonlySet<string> {
  try {
    const statement = database.prepare(query);
    const matched = new Set<string>();
    for (const providerSessionId of providerSessionIds) {
      if (statement.all(parameter(providerSessionId)).length > 0) {
        matched.add(providerSessionId);
      }
    }
    return matched;
  } catch {
    return new Set();
  }
}

/**
 * What Cursor knows about a local session beyond its state: the folder, the
 * tool call an open turn is running, that a turn failed, and — for a chat the
 * app holds — the chat's own address. Cursor records why a turn failed, but
 * that reason is written from the turn itself, so the fact of the failure is
 * reported and its wording is not — the same fixed line the cloud half
 * reports for a failed run.
 */
function detailFor(
  label: string,
  status: SessionStatus,
  link: string | undefined,
  activity: string | undefined,
): SessionDetail {
  return {
    ...(activity ? { activity } : undefined),
    repository: label,
    ...(link ? { link } : undefined),
    ...(status === SESSION_STATUS.ERROR ? { error: CURSOR_TURN_FAILED_MESSAGE } : undefined),
  };
}

function defaultCursorHome(): string {
  return path.join(os.homedir(), ".cursor");
}

function defaultWorkspaceStorageDirectory(): string {
  return path.join(os.homedir(), ...CURSOR_WORKSPACE_STORAGE_SEGMENTS);
}

function defaultGlobalStorageStatePath(): string {
  return path.join(os.homedir(), ...CURSOR_GLOBAL_STORAGE_STATE_SEGMENTS);
}

/**
 * Observes the Cursor sessions that run on this machine, from the transcripts
 * Cursor already writes for itself. It reads the turn markers and the open
 * turn's tool calls — never the conversation's words — needs no credential,
 * and reports nothing that Cursor has not written down.
 */
export class CursorLocalSessionAdapter extends LocalFileSessionAdapter<
  CursorTranscriptCandidate,
  ParsedCursorTail
> {
  readonly provider = CURSOR_PROVIDER;

  readonly #cursorHome: string;
  readonly #workspaceLabels: CursorWorkspaceLabels;
  readonly #appChatRegistry: CursorAppChatRegistry;
  #appChats: ReadonlySet<string> = new Set();
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
    this.#appChatRegistry = new CursorAppChatRegistry(
      options.globalStorageStatePath ?? defaultGlobalStorageStatePath(),
      options.sqlite ?? defaultSqliteModule,
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

  protected async discover(): Promise<CursorTranscriptCandidate[]> {
    const candidates = await discoverSessionFiles({
      projectsDirectory: path.join(this.#cursorHome, CURSOR_DIRECTORY.PROJECTS),
      sessionsDirectoryName: CURSOR_DIRECTORY.TRANSCRIPTS,
      maximumProjectDirectories: this.#maximumProjectDirectories,
      sessionFilesIn: transcriptsIn,
    });
    const index = await this.#appChatRegistry.index(
      candidates.map((candidate) => candidate.providerSessionId),
    );
    this.#appChats = index.held;
    // A chat the user filed away in the app draws no row, the same answer an
    // archived cloud agent gives. The transcript Cursor keeps for it is left
    // unread; a chat the index cannot vouch for either way stays.
    return candidates.filter((candidate) => !index.archived.has(candidate.providerSessionId));
  }

  protected override async prepare(
    candidates: readonly CursorTranscriptCandidate[],
  ): Promise<void> {
    await this.#workspaceLabels.resolve(
      candidates.map((candidate) => candidate.projectDirectoryName),
    );
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return readCursorSessionTranscript({
      cursorHome: this.#cursorHome,
      providerSessionId,
      readTailBytes: this.#transcriptReadTailBytes,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }

  protected async parse(candidate: CursorTranscriptCandidate): Promise<ParsedCursorTail> {
    return parseCursorTail(await readTail(candidate.filePath, this.#readTailBytes));
  }

  /**
   * A session is named by the folder it ran in and by nothing else. Cursor
   * names a chat from its opening prompt, so that name is the prompt and never
   * reaches an observation — and the location is left unsaid, which is how an
   * adapter reading this machine reports one that runs on it.
   */
  protected observation(
    candidate: CursorTranscriptCandidate,
    parsed: ParsedCursorTail,
    now: number,
    activeSessionFreshnessMs: number,
  ): ProviderSessionObservation {
    const label = this.#workspaceLabels.label(candidate.projectDirectoryName);
    const status = statusFromTurn(parsed.turn, candidate.mtimeMs, now, activeSessionFreshnessMs);
    const link = this.#appChats.has(candidate.providerSessionId)
      ? cursorChatLink(candidate.providerSessionId)
      : undefined;
    return {
      providerSessionId: candidate.providerSessionId,
      title: label,
      status,
      // A transcript carries no timestamps of its own, so when it was last
      // written is the only account Cursor keeps of when this session last did
      // anything.
      observedAt: candidate.mtimeMs,
      detail: detailFor(label, status, link, parsed.activity),
      ...(link ? { applications: [cursorApplication(link)] } : undefined),
    };
  }
}
