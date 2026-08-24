import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACT_RESULT_STATUS,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  type ProviderMessageResult,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  providerTranscriptResult,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionDiffSummary,
  type SessionStatus,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  isWireString,
  oneLine,
  recordFromJsonLine,
  resolveOptions,
  text,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";
import {
  type DirectoryEntry,
  discoverSessionFiles,
  fileStats,
  type HookStatusRefinement,
  hookRefinedStatus,
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
import { transcriptContentBlocks, transcriptMessageText } from "../shared/local-transcript.js";
import { CURSOR_PROVIDER } from "./adapter.js";
import { cursorApplication, cursorChatLink } from "./app-links.js";
import {
  CURSOR_CHAT_STORE_DIRECTORY,
  type CursorChatStoreMeta,
  chatStoreSessionsIn,
  readCursorChatStoreMeta,
} from "./chat-store.js";
import {
  CURSOR_HOOK_EVENT,
  type CursorHookEvent,
  type ObservedCursorHookEvent,
  readCursorHookEvent,
} from "./hooks.js";
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
 * filed a chat away, read as the presence of a positively archived row.
 */
const CURSOR_APP_ARCHIVED_CHAT_QUERY =
  "SELECT 1 FROM composerHeaders WHERE composerId = ? AND isArchived = 1";

/**
 * The same header row's own bookkeeping value, read for the fixed fields
 * {@link chatHeaderFromValue} names — the chat's name, branch, folder, held
 * call, and change counts, everything *about* the chat and nothing of it. The
 * conversation lives in the separate `composerData` records, whose values
 * observation still never opens.
 */
const CURSOR_CHAT_HEADER_QUERY = "SELECT value FROM composerHeaders WHERE composerId = ?";

const CURSOR_TRANSCRIPT_FILE_EXTENSION = ".jsonl";
const CURSOR_WORKSPACE_FILE = "workspace.json";

/**
 * Cursor's own record, inside a project directory, of the folder the project
 * runs in and the fact that its CLI trusts it. Where it exists it names the
 * exact folder — no reduced-name matching — and a folder the CLI trusts is
 * one a resume pinned there will not refuse.
 */
const CURSOR_WORKSPACE_TRUSTED_FILE = ".workspace-trusted";
const CURSOR_WORKSPACE_TRUSTED_FIELD = {
  WORKSPACE_PATH: "workspacePath",
} as const;

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
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud adapters' credentials, because the app decides
   * the path after this adapter is declared. Absent — or answering nothing —
   * the adapter reads the transcripts alone, exactly as it always has: the
   * hooks only ever sharpen what those already showed.
   */
  hookEventsDirectory?: () => string | undefined;
  /** How the adapter reaches Cursor's own CLI; tests inject one that spawns nothing. */
  cursorAgent?: CursorAgentRunner;
}

/** Everything a send must still know about one chat that advertised taking one. */
interface CursorSendTarget {
  folderPath: string;
  transcriptFilePath: string;
}

const CURSOR_CANDIDATE_KIND = {
  /** A chat with a transcript in the projects tree, the richer read. */
  TRANSCRIPT: "transcript",
  /** A chat only the chat store holds, drawn from its metadata record alone. */
  CHAT_STORE: "chat-store",
} as const;

interface CursorTranscriptCandidate extends SessionFileCandidate {
  kind: typeof CURSOR_CANDIDATE_KIND.TRANSCRIPT;
  projectDirectoryName: string;
  /**
   * The chat store's metadata record for this same chat, when one exists: the
   * name Cursor gave the chat and the exact folder it ran in, which the
   * transcript itself never records.
   */
  meta?: CursorChatStoreMeta;
  /**
   * The store's own file clock for the same chat — its journal is what moves
   * while a turn runs, which neither the transcript nor the metadata record's
   * timestamp shows.
   */
  storeAtMs?: number;
}

interface CursorChatStoreCandidate extends SessionFileCandidate {
  kind: typeof CURSOR_CANDIDATE_KIND.CHAT_STORE;
  meta: CursorChatStoreMeta;
}

type CursorSessionCandidate = CursorTranscriptCandidate | CursorChatStoreCandidate;

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
  readonly #foldersByProjectName = new Map<string, string | undefined>();
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
        this.#foldersByProjectName.has(canonicalProjectName(name)),
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

  /**
   * The folder Cursor's own record names for a project, when exactly one does.
   * Stricter than the label on purpose: two folders can reduce to one project
   * name and still agree on what to call it, but a message pinned to the wrong
   * folder would fork the chat it meant to continue, so any ambiguity names
   * nowhere to send.
   */
  folder(projectDirectoryName: string): string | undefined {
    return this.#foldersByProjectName.get(canonicalProjectName(projectDirectoryName));
  }

  #record(folderPath: string): void {
    const projectName = canonicalProjectName(folderPath);
    const label = workspaceLabel(folderPath);
    if (!this.#labelsByProjectName.has(projectName)) {
      this.#labelsByProjectName.set(projectName, label);
      this.#foldersByProjectName.set(projectName, folderPath);
      return;
    }
    // Two folders can reduce to one project name. When they disagree about
    // what to call it, Luke names neither.
    if (this.#labelsByProjectName.get(projectName) !== label) {
      this.#labelsByProjectName.set(projectName, undefined);
    }
    if (this.#foldersByProjectName.get(projectName) !== folderPath) {
      this.#foldersByProjectName.set(projectName, undefined);
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
        kind: CURSOR_CANDIDATE_KIND.TRANSCRIPT,
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
  /** A cleanly settled turn's parting words, the same standing as Codex's recap. */
  recap?: string;
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
 * Reads the turn boundary, the current tool call, and a settled turn's recap
 * out of a transcript tail. Cursor marks the end of a turn explicitly, so an
 * open turn is read from the absence of that mark rather than inferred from
 * what the assistant last said. The conversation's words stay in the records
 * they were parsed from, with one bounded exception: a cleanly settled turn's
 * parting words become the session's recap, the same standing as the recap
 * Codex writes — a failed turn keeps none, because the agent's parting words
 * predate what went wrong. A record this build does not know is passed over
 * rather than taken for anything.
 */
function parseCursorTail(tail: string): ParsedCursorTail {
  const parsed: ParsedCursorTail = {};
  let partingWords: string | undefined;
  for (const record of tailRecords(tail)) {
    if (record[CURSOR_RECORD_FIELD.TYPE] === CURSOR_RECORD_TYPE.TURN_ENDED) {
      const failed = record[CURSOR_RECORD_FIELD.STATUS] === CURSOR_TURN_STATUS.ERROR;
      parsed.turn = { failed };
      // A turn that ended is not running its last call, and holding it would
      // keep a stale line on the row until some other tool runs.
      parsed.activity = undefined;
      parsed.recap = failed ? undefined : oneLine(partingWords, maximumSessionRecapLength);
      partingWords = undefined;
      continue;
    }
    if (!isMessageRecord(record)) continue;
    parsed.turn = undefined;
    if (record[CURSOR_RECORD_FIELD.ROLE] === CURSOR_ROLE.USER) {
      // A new turn is not running the previous turn's call, and its work is
      // not summed up by the previous turn's parting words.
      parsed.activity = undefined;
      parsed.recap = undefined;
      partingWords = undefined;
      continue;
    }
    partingWords = transcriptMessageText(record, false) ?? partingWords;
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
  /** Each observed chat's bounded header bookkeeping, where a header exists. */
  headers: ReadonlyMap<string, CursorChatHeader>;
}

const EMPTY_APP_CHAT_INDEX: CursorAppChatIndex = {
  held: new Set(),
  archived: new Set(),
  headers: new Map(),
};

/**
 * The bounded bookkeeping Cursor's own header row keeps about one chat —
 * fields *about* the session, read from the header's value by fixed names and
 * discarded past what a row can show. The conversation itself lives in the
 * separate `composerData` records, which observation still never opens.
 */
interface CursorChatHeader {
  /** The name Cursor gave the chat, the same standing as Claude Code's generated title. */
  name?: string;
  /** The branch the chat works on: the active branch where recorded, else the one it began on. */
  branch?: string;
  /** The folder the chat runs in, exactly as Cursor's own header names it. */
  folderPath?: string;
  /** Whether a tool call is holding for the user's answer right now. */
  blockedPending?: boolean;
  diff?: SessionDiffSummary;
}

/** The header fields this build reads, by Cursor's own names. */
const CURSOR_HEADER_FIELD = {
  NAME: "name",
  CREATED_ON_BRANCH: "createdOnBranch",
  ACTIVE_BRANCH: "activeBranch",
  BRANCH_NAME: "branchName",
  WORKSPACE_IDENTIFIER: "workspaceIdentifier",
  URI: "uri",
  FS_PATH: "fsPath",
  HAS_BLOCKING_PENDING_ACTIONS: "hasBlockingPendingActions",
  FILES_CHANGED_COUNT: "filesChangedCount",
  TOTAL_LINES_ADDED: "totalLinesAdded",
  TOTAL_LINES_REMOVED: "totalLinesRemoved",
} as const;

const CURSOR_HEADER_BOUNDS = {
  MAXIMUM_BRANCH_LENGTH: 120,
} as const;

/** One chat's header value, reduced to the fixed fields a row can show. */
function chatHeaderFromValue(source: string): CursorChatHeader | undefined {
  const record = recordFromJsonLine(source);
  if (!record) return undefined;
  const header: CursorChatHeader = {};
  const name = oneLine(text(record[CURSOR_HEADER_FIELD.NAME]), maximumSessionTitleLength);
  if (name) header.name = name;
  const activeBranchValue = record[CURSOR_HEADER_FIELD.ACTIVE_BRANCH];
  const activeBranch = isRecord(activeBranchValue) ? activeBranchValue : undefined;
  const branch = oneLine(
    text(activeBranch?.[CURSOR_HEADER_FIELD.BRANCH_NAME]) ??
      text(record[CURSOR_HEADER_FIELD.CREATED_ON_BRANCH]),
    CURSOR_HEADER_BOUNDS.MAXIMUM_BRANCH_LENGTH,
  );
  if (branch) header.branch = branch;
  const workspaceValue = record[CURSOR_HEADER_FIELD.WORKSPACE_IDENTIFIER];
  const workspace = isRecord(workspaceValue) ? workspaceValue : undefined;
  const uriValue = workspace?.[CURSOR_HEADER_FIELD.URI];
  const uri = isRecord(uriValue) ? uriValue : undefined;
  const folderPath = text(uri?.[CURSOR_HEADER_FIELD.FS_PATH]);
  if (folderPath && path.isAbsolute(folderPath)) header.folderPath = folderPath;
  if (record[CURSOR_HEADER_FIELD.HAS_BLOCKING_PENDING_ACTIONS] === true) {
    header.blockedPending = true;
  }
  const filesChanged = wholeNumber(record[CURSOR_HEADER_FIELD.FILES_CHANGED_COUNT]);
  const linesAdded = wholeNumber(record[CURSOR_HEADER_FIELD.TOTAL_LINES_ADDED]);
  const linesRemoved = wholeNumber(record[CURSOR_HEADER_FIELD.TOTAL_LINES_REMOVED]);
  if (filesChanged !== undefined && linesAdded !== undefined && linesRemoved !== undefined) {
    header.diff = { filesChanged, linesAdded, linesRemoved };
  }
  return header;
}

/**
 * What the refinement actually buys here is the state the transcript cannot
 * show at all: a chat whose window or CLI closed looks exactly like one
 * holding for its developer. No notification token is registered — Cursor
 * documents no event that fires only while a call holds for approval — so
 * the refinement names no such moment, the honest absence.
 */
const CURSOR_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: CURSOR_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    { event: CURSOR_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CURSOR_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
  ],
  sessionEndEvent: CURSOR_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<CursorHookEvent>;

/**
 * Reads what Cursor's own index says about the observed chats: which the app
 * holds and which the user archived, each as the presence of a row, and each
 * chat's header bookkeeping, reduced to the fixed fields a row can show. Every
 * read is a point lookup per observed chat. The `composerData` values — the
 * conversations themselves — are never opened. An absent app, an unreadable or
 * mid-write database, or a schema this build does not know holds nothing,
 * which withholds the annotations rather than inventing an address the app
 * cannot resolve or a filing away nobody performed — and never fails the pass
 * the rows come from.
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
        headers: chatHeaders(database, providerSessionIds),
      };
    } finally {
      database.close();
    }
  }
}

function chatHeaders(
  database: SqliteDatabase,
  providerSessionIds: readonly string[],
): ReadonlyMap<string, CursorChatHeader> {
  const headers = new Map<string, CursorChatHeader>();
  try {
    const statement = database.prepare(CURSOR_CHAT_HEADER_QUERY);
    for (const providerSessionId of providerSessionIds) {
      const row = statement.all(providerSessionId)[0];
      const value = isRecord(row) ? row.value : undefined;
      const header = isWireString(value) ? chatHeaderFromValue(value) : undefined;
      if (header) headers.set(providerSessionId, header);
    }
    return headers;
  } catch {
    return headers;
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

/** The shape a symbolic HEAD names its branch in; a detached HEAD names none. */
const GIT_HEAD_BRANCH_PATTERN = /^ref: refs\/heads\/(.+)$/m;
const GIT_DIRECTORY_POINTER_PATTERN = /^gitdir: (.+)$/m;

/**
 * The branch the chat's folder stands on right now, from the folder's own
 * `.git` HEAD — the one fact read outside Cursor's files, two bounded file
 * reads and never a git invocation, because the header's `createdOnBranch`
 * says where a chat began rather than where its folder stands after a
 * checkout. A worktree's `.git` is a pointer file to its own git directory,
 * followed for the same HEAD; a detached HEAD, an unreadable file, or a
 * folder that is not a repository names no branch at all.
 */
async function branchFromGitHead(folderPath: string): Promise<string | undefined> {
  const gitPath = path.join(folderPath, ".git");
  const stats = await fileStats(gitPath);
  let headPath: string | undefined;
  if (stats?.isDirectory()) {
    headPath = path.join(gitPath, "HEAD");
  } else if (stats?.isFile()) {
    const pointer = GIT_DIRECTORY_POINTER_PATTERN.exec((await readTextFile(gitPath)) ?? "")?.[1];
    const gitDirectory = text(pointer);
    if (gitDirectory) headPath = path.resolve(folderPath, gitDirectory, "HEAD");
  }
  if (!headPath) return undefined;
  const head = await readTextFile(headPath);
  if (!head) return undefined;
  return oneLine(
    text(GIT_HEAD_BRANCH_PATTERN.exec(head)?.[1]),
    CURSOR_HEADER_BOUNDS.MAXIMUM_BRANCH_LENGTH,
  );
}

/**
 * What Cursor knows about a local session beyond its state: the folder, the
 * tool call an open turn is running, that a turn failed, the branch and
 * change counts its header records, and — for a chat the app holds — the
 * chat's own address. Cursor records why a turn failed, but that reason is
 * written from the turn itself, so the fact of the failure is reported and
 * its wording is not — the same fixed line the cloud half reports for a
 * failed run.
 */
function detailFor(
  label: string,
  status: SessionStatus,
  link: string | undefined,
  activity: string | undefined,
  branch: string | undefined,
  diff: SessionDiffSummary | undefined,
): SessionDetail {
  return {
    ...(activity ? { activity } : undefined),
    repository: label,
    ...(branch ? { branch } : undefined),
    ...(link ? { link } : undefined),
    ...(status === SESSION_STATUS.ERROR ? { error: CURSOR_TURN_FAILED_MESSAGE } : undefined),
    ...(diff ? { diff } : undefined),
  };
}

/**
 * The invocations this adapter may make of Cursor's own `cursor-agent` CLI,
 * fixed by the build the way a cloud adapter's routes are. `status` answers by
 * exit code alone whether the CLI holds the user's login. The send is the
 * CLI's documented resume: `--resume` names the observed chat, `--workspace`
 * pins the turn to the folder Cursor's own record names — a resume run
 * anywhere else appends the turn under that other folder's project and forks
 * the chat it meant to continue — `--print` keeps it non-interactive, and the
 * `--` before the message ends option parsing, so the developer's own words
 * can never read as a flag.
 */
const CURSOR_AGENT_CLI = {
  BINARY: "cursor-agent",
  LOGIN_PROBE_ARGV: ["status"],
  RESUME_FLAG: "--resume",
  WORKSPACE_FLAG: "--workspace",
  SEND_ARGV: ["--print", "--output-format", "json"],
  ARGUMENT_SEPARATOR: "--",
} as const;

const CURSOR_SEND_DEFAULTS = {
  LOGIN_PROBE_TIMEOUT_MS: 8_000,
  /**
   * How long a launched resume is watched for an early refusal — a folder the
   * CLI does not trust, a login gone since the probe — before the turn is let
   * run. A resumed turn is a whole agent turn and can take minutes; holding
   * the send open for it would be a deadline that kills the very turn it
   * delivered, so past this window the send is delivered and the transcript
   * the adapter already observes is the report.
   */
  EARLY_REFUSAL_WINDOW_MS: 8_000,
} as const;

/**
 * Where `cursor-agent` actually lands on a Mac, beside whatever PATH an app
 * launched from the Finder inherits: the CLI's own installer uses
 * `~/.local/bin`, and package managers use the usual two.
 */
function wellKnownCursorAgentDirectories(): readonly string[] {
  return [path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
}

/** The one launch result: an exit inside the refusal window, or a turn running. */
export type CursorAgentLaunch = { exitCode: number } | "running";

/**
 * How the adapter reaches Cursor's own CLI, injectable so tests never spawn
 * one. Every method runs the binary directly — no shell, so nothing in an
 * argument can become a second command.
 */
export interface CursorAgentRunner {
  /** The installed binary's path, or nothing on a machine without one. */
  locate(): Promise<string | undefined>;
  /** Whether the CLI holds a login, by exit code alone; stdout is never read. */
  probeLogin(binaryPath: string): Promise<boolean>;
  /** Starts the resume detached and watches only for an early refusal. */
  launch(binaryPath: string, argv: readonly string[]): Promise<CursorAgentLaunch>;
}

async function locateCursorAgent(): Promise<string | undefined> {
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of [...pathDirectories, ...wellKnownCursorAgentDirectories()]) {
    const candidate = path.join(directory, CURSOR_AGENT_CLI.BINARY);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; the next directory may hold it.
    }
  }
  return undefined;
}

const defaultCursorAgentRunner: CursorAgentRunner = {
  locate: locateCursorAgent,
  probeLogin: (binaryPath) =>
    new Promise((resolve, reject) => {
      execFile(
        binaryPath,
        CURSOR_AGENT_CLI.LOGIN_PROBE_ARGV,
        { timeout: CURSOR_SEND_DEFAULTS.LOGIN_PROBE_TIMEOUT_MS, windowsHide: true },
        (error) => {
          if (error === null) {
            resolve(true);
            return;
          }
          // SAFETY: Node's execFile callback reports command failures as ErrnoException objects.
          const commandError = error as NodeJS.ErrnoException & { code?: unknown };
          if (isWireNumber(commandError.code)) {
            resolve(false);
            return;
          }
          reject(new Error(`${CURSOR_AGENT_CLI.BINARY} could not be run`));
        },
      );
    }),
  launch: (binaryPath, argv) =>
    new Promise((resolve) => {
      // Detached with no pipes: the turn's output lives in the transcript the
      // adapter already observes, and the send must not hold a handle open
      // for however long the turn runs.
      const child = spawn(binaryPath, [...argv], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      let settled = false;
      const settle = (result: CursorAgentLaunch) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const window = setTimeout(() => {
        child.unref();
        settle("running");
      }, CURSOR_SEND_DEFAULTS.EARLY_REFUSAL_WINDOW_MS);
      window.unref();
      child.once("exit", (code) => {
        clearTimeout(window);
        settle({ exitCode: code ?? 1 });
      });
      child.once("error", () => {
        clearTimeout(window);
        settle({ exitCode: 1 });
      });
    }),
};

export function defaultCursorHome(): string {
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
 * Cursor already writes for itself. It reads the turn markers, the open
 * turn's tool calls, and a settled turn's parting words as the recap — nothing
 * else of the conversation — needs no credential, and reports nothing that
 * Cursor has not written down.
 */
export class CursorLocalSessionAdapter extends LocalFileSessionAdapter<
  CursorSessionCandidate,
  ParsedCursorTail
> {
  readonly provider = CURSOR_PROVIDER;

  readonly #cursorHome: string;
  readonly #workspaceLabels: CursorWorkspaceLabels;
  readonly #appChatRegistry: CursorAppChatRegistry;
  #appChatIndex: CursorAppChatIndex = EMPTY_APP_CHAT_INDEX;
  readonly #maximumProjectDirectories: number;
  readonly #readTailBytes: number;
  readonly #transcriptReadTailBytes: number | undefined;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;
  readonly #cursorAgent: CursorAgentRunner;
  #cursorAgentBinaryPath: string | undefined;
  #trustedFoldersByProject: ReadonlyMap<string, string> = new Map();
  readonly #sendTargets = new Map<string, CursorSendTarget>();
  readonly #chatStoreMetaCache = new Map<string, { mtimeMs: number; meta?: CursorChatStoreMeta }>();

  constructor(options: CursorLocalAdapterOptions = {}) {
    super(options);
    this.#hookEventsDirectory = options.hookEventsDirectory;
    this.#cursorAgent = options.cursorAgent ?? defaultCursorAgentRunner;
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

  protected async discover(): Promise<CursorSessionCandidate[]> {
    const [transcripts, storeFiles] = await Promise.all([
      discoverSessionFiles({
        projectsDirectory: path.join(this.#cursorHome, CURSOR_DIRECTORY.PROJECTS),
        sessionsDirectoryName: CURSOR_DIRECTORY.TRANSCRIPTS,
        maximumProjectDirectories: this.#maximumProjectDirectories,
        sessionFilesIn: transcriptsIn,
      }),
      discoverSessionFiles({
        projectsDirectory: path.join(this.#cursorHome, CURSOR_CHAT_STORE_DIRECTORY),
        maximumProjectDirectories: this.#maximumProjectDirectories,
        sessionFilesIn: (sessionsDirectory) => chatStoreSessionsIn(sessionsDirectory),
      }),
    ]);
    const metaByFile = await this.#chatStoreMetas(storeFiles);
    // Newest first from discovery, so a chat resumed from another folder — the
    // store keys chats by folder, and a resume re-files one — reads its
    // freshest record.
    const metaById = new Map<string, { meta: CursorChatStoreMeta; atMs: number }>();
    const transcriptIds = new Set(transcripts.map((candidate) => candidate.providerSessionId));
    const stores: CursorChatStoreCandidate[] = [];
    for (const file of storeFiles) {
      const meta = metaByFile.get(file.filePath);
      if (!meta) continue;
      if (!metaById.has(file.providerSessionId)) {
        metaById.set(file.providerSessionId, { meta, atMs: file.mtimeMs });
      }
      // A chat with a transcript is read from the transcript — the richer
      // record — and its store metadata rides that candidate instead.
      if (transcriptIds.has(file.providerSessionId)) continue;
      stores.push({ ...file, kind: CURSOR_CANDIDATE_KIND.CHAT_STORE, meta });
    }
    const candidates: CursorSessionCandidate[] = [
      ...transcripts.map((candidate) => {
        const store = metaById.get(candidate.providerSessionId);
        return store ? { ...candidate, meta: store.meta, storeAtMs: store.atMs } : candidate;
      }),
      ...stores,
    ].sort((first, second) => second.mtimeMs - first.mtimeMs);
    const index = await this.#appChatRegistry.index(
      candidates.map((candidate) => candidate.providerSessionId),
    );
    this.#appChatIndex = index;
    // A chat the user filed away in the app draws no row, the same answer an
    // archived cloud agent gives. The transcript Cursor keeps for it is left
    // unread; a chat the index cannot vouch for either way stays.
    return candidates.filter((candidate) => !index.archived.has(candidate.providerSessionId));
  }

  /**
   * Each candidate's metadata record, re-read only when its chat has moved —
   * the same clock the parse cache runs on — and dropped when the chat is
   * gone. An unreadable, foreign, or conversation-less record resolves to
   * nothing, which is what drops its candidate.
   */
  async #chatStoreMetas(
    storeFiles: readonly SessionFileCandidate[],
  ): Promise<ReadonlyMap<string, CursorChatStoreMeta | undefined>> {
    const metas = new Map<string, CursorChatStoreMeta | undefined>();
    await Promise.all(
      storeFiles.map(async (file) => {
        const cached = this.#chatStoreMetaCache.get(file.filePath);
        if (cached && cached.mtimeMs === file.mtimeMs) {
          metas.set(file.filePath, cached.meta);
          return;
        }
        const source = await readTextFile(file.filePath);
        const meta = source === undefined ? undefined : readCursorChatStoreMeta(source);
        this.#chatStoreMetaCache.set(file.filePath, { mtimeMs: file.mtimeMs, meta });
        metas.set(file.filePath, meta);
      }),
    );
    for (const filePath of this.#chatStoreMetaCache.keys()) {
      if (!metas.has(filePath)) this.#chatStoreMetaCache.delete(filePath);
    }
    return metas;
  }

  protected override async prepare(candidates: readonly CursorSessionCandidate[]): Promise<void> {
    // A send target lives exactly as long as its chat stays on the roster this
    // pass discovered. A chat archived or gone since the last pass never
    // reaches observation() again, so its entry is pruned here rather than
    // waiting to be replaced — while a chat still discovered keeps its entry
    // through the pass, so a send arriving mid-pass is not refused by a map
    // half-built.
    const discovered = new Set(candidates.map((candidate) => candidate.providerSessionId));
    for (const providerSessionId of this.#sendTargets.keys()) {
      if (!discovered.has(providerSessionId)) this.#sendTargets.delete(providerSessionId);
    }
    const projectDirectoryNames = [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.kind === CURSOR_CANDIDATE_KIND.TRANSCRIPT
            ? [candidate.projectDirectoryName]
            : [],
        ),
      ),
    ];
    const [binaryPath, trustedFolders] = await Promise.all([
      // Located every pass, so an install or removal is honoured on the next
      // one — the same cadence a signed-out CLI is honoured on.
      this.#cursorAgent.locate().catch(() => undefined),
      this.#trustedFolders(projectDirectoryNames),
      this.#workspaceLabels.resolve(projectDirectoryNames),
    ]);
    this.#cursorAgentBinaryPath = binaryPath;
    this.#trustedFoldersByProject = trustedFolders;
  }

  /**
   * The folder each project's own `.workspace-trusted` record names, where one
   * exists. It is the send path's preferred source: exact where the workspace
   * records need reduced-name matching, and present exactly where the CLI
   * already trusts the folder a resume would be pinned to.
   */
  async #trustedFolders(
    projectDirectoryNames: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const folders = new Map<string, string>();
    await Promise.all(
      projectDirectoryNames.map(async (projectDirectoryName) => {
        const record = await readTextFile(
          path.join(
            this.#cursorHome,
            CURSOR_DIRECTORY.PROJECTS,
            projectDirectoryName,
            CURSOR_WORKSPACE_TRUSTED_FILE,
          ),
        );
        if (!record) return;
        let parsed: WireBoundaryInput;
        try {
          parsed = JSON.parse(record);
        } catch {
          return;
        }
        const wire = wireRecord(unparsedWire(parsed));
        const workspacePath = wire?.[CURSOR_WORKSPACE_TRUSTED_FIELD.WORKSPACE_PATH];
        if (isWireString(workspacePath) && path.isAbsolute(workspacePath)) {
          folders.set(projectDirectoryName, workspacePath);
        }
      }),
    );
    return folders;
  }

  override readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return providerTranscriptResult(
      readCursorSessionTranscript({
        cursorHome: this.#cursorHome,
        providerSessionId,
        readTailBytes: this.#transcriptReadTailBytes,
        maximumRenderedLength: this.#transcriptMaximumRenderedLength,
      }),
    );
  }

  protected async parse(candidate: CursorSessionCandidate): Promise<ParsedCursorTail> {
    // A chat-store candidate's tail is legitimately empty: the store's
    // conversation is a blob graph this build cannot read, so no turn, tool
    // call, or recap can honestly come out of it.
    if (candidate.kind === CURSOR_CANDIDATE_KIND.CHAT_STORE) return {};
    return parseCursorTail(await readTail(candidate.filePath, this.#readTailBytes));
  }

  /**
   * A session is named by the name Cursor's own header keeps for the chat —
   * the same standing as the title Claude Code generates and Gemini CLI's
   * summary — falling back to the folder it ran in for a chat whose header
   * carries none. The location is left unsaid, which is how an adapter
   * reading this machine reports one that runs on it.
   */
  protected async observation(
    candidate: CursorSessionCandidate,
    parsed: ParsedCursorTail,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> {
    if (candidate.kind === CURSOR_CANDIDATE_KIND.CHAT_STORE) {
      return this.#chatStoreObservation(candidate, now, activeSessionFreshnessMs);
    }
    const header = this.#appChatIndex.headers.get(candidate.providerSessionId);
    // The send pin's folder, in the order of how exactly each source names
    // it: the chat's own header, the project's trust record, and last the
    // reduced-name workspace match. Deliberately not the chat store's cwd:
    // the messaging exception pins a resume to the folder Cursor's workspace
    // records name, and widening that set is a product decision, not an
    // implementation detail.
    const folderPath =
      header?.folderPath ??
      this.#trustedFoldersByProject.get(candidate.projectDirectoryName) ??
      this.#workspaceLabels.folder(candidate.projectDirectoryName);
    // What the row shows and groups by is the chat's own folder, and the
    // store's record of it is the most exact where one stands — the cwd the
    // chat actually ran in, which is also what a workspace manager's worktree
    // is matched against.
    const directory = candidate.meta?.cwd ?? folderPath;
    const label = directory
      ? workspaceLabel(directory)
      : this.#workspaceLabels.label(candidate.projectDirectoryName);
    const hookEvent = await this.#hookEvent(candidate.providerSessionId);
    // A transcript carries no timestamps of its own, so when it was last
    // written is Cursor's only account of when this session last did anything —
    // sharpened by the chat store's own clock where the store holds this chat,
    // because the store is written while a turn runs and the transcript is not.
    const transcriptAt = Math.max(
      candidate.mtimeMs,
      candidate.storeAtMs ?? 0,
      candidate.meta?.updatedAtMs ?? 0,
    );
    const refined = hookRefinedStatus({
      refinement: CURSOR_HOOK_STATUS_REFINEMENT,
      hookEvent,
      providerAtMs: transcriptAt,
      statusAt: (observedAt) =>
        statusFromTurn(parsed.turn, observedAt, now, activeSessionFreshnessMs),
      now,
      activeSessionFreshnessMs,
    });
    const { observedAt } = refined;
    let status = refined.status;
    // A tool call holding for the user's answer is the one state neither the
    // transcript nor the hooks can show — the header's own record of it
    // upgrades only a live working row, so a stale hold decays with the turn
    // it belongs to.
    if (parsed.turn === undefined && header?.blockedPending && status === SESSION_STATUS.WORKING) {
      status = SESSION_STATUS.WAITING;
    }
    const appHeld = this.#appChatIndex.held.has(candidate.providerSessionId);
    const link = appHeld ? cursorChatLink(candidate.providerSessionId) : undefined;
    // The branch is the folder's own HEAD wherever the folder is known — a
    // header's created-on branch says where a chat began, not where its
    // folder stands after a checkout — with that header record standing in
    // where the folder cannot say.
    const branch = (directory ? await branchFromGitHead(directory) : undefined) ?? header?.branch;
    // A message is advertised only where the CLI's documented resume can
    // honestly land one: the turn is settled and nothing newer says work is
    // running — a prompt hook can know about a turn the transcript has not
    // written yet — the folder to pin the resume to is named by Cursor's own
    // record, the CLI is installed, and the app does not hold the chat,
    // because Cursor does not document whether an app window shows a turn
    // landed behind it, and a message the developer cannot see land is worse
    // than none. A target outlives the pass that advertised it — clearing at
    // the pass's start would fail a send arriving mid-pass — and a session
    // gone from the roster is caught by the act-time transcript re-check.
    const canReceiveMessage =
      parsed.turn !== undefined &&
      status !== SESSION_STATUS.WORKING &&
      folderPath !== undefined &&
      this.#cursorAgentBinaryPath !== undefined &&
      !appHeld;
    if (canReceiveMessage && folderPath !== undefined) {
      this.#sendTargets.set(candidate.providerSessionId, {
        folderPath,
        transcriptFilePath: candidate.filePath,
      });
    } else {
      this.#sendTargets.delete(candidate.providerSessionId);
    }
    return {
      providerSessionId: candidate.providerSessionId,
      title: header?.name ?? oneLine(candidate.meta?.title, maximumSessionTitleLength) ?? label,
      status,
      observedAt,
      ...(directory ? { directory } : undefined),
      detail: detailFor(label, status, link, parsed.activity, branch, header?.diff),
      ...(parsed.recap ? { recap: parsed.recap } : undefined),
      ...(canReceiveMessage ? { canReceiveMessage: true } : undefined),
      ...(refined.sessionClosed
        ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
        : undefined),
      ...(link ? { applications: [cursorApplication(link)] } : undefined),
    };
  }

  /**
   * A chat only the chat store holds, drawn from its metadata record alone.
   * The store's conversation is a blob graph this build cannot read, so the
   * turn boundary is unreadable: a store still being written is a chat doing
   * something, one gone quiet is unknown rather than holding, and the hooks
   * sharpen both exactly as they do for a transcript. No tool call, recap, or
   * message advertisement can honestly come out of a record this thin — the
   * send stays with chats whose settled turn the transcript can show.
   */
  async #chatStoreObservation(
    candidate: CursorChatStoreCandidate,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> {
    const header = this.#appChatIndex.headers.get(candidate.providerSessionId);
    const label = workspaceLabel(candidate.meta.cwd);
    const hookEvent = await this.#hookEvent(candidate.providerSessionId);
    const providerAt = Math.max(candidate.mtimeMs, candidate.meta.updatedAtMs ?? 0);
    const refined = hookRefinedStatus({
      refinement: CURSOR_HOOK_STATUS_REFINEMENT,
      hookEvent,
      providerAtMs: providerAt,
      statusAt: (observedAt) =>
        statusFromTurn(undefined, observedAt, now, activeSessionFreshnessMs),
      now,
      activeSessionFreshnessMs,
    });
    const { observedAt } = refined;
    let status = refined.status;
    // The same held-call upgrade a transcript row gets: a store row's turn is
    // always unreadable, so the header's record of a live hold is the one
    // word there is, decaying with the freshness that made the row working.
    if (header?.blockedPending && status === SESSION_STATUS.WORKING) {
      status = SESSION_STATUS.WAITING;
    }
    const appHeld = this.#appChatIndex.held.has(candidate.providerSessionId);
    const link = appHeld ? cursorChatLink(candidate.providerSessionId) : undefined;
    const branch =
      (candidate.meta.cwd ? await branchFromGitHead(candidate.meta.cwd) : undefined) ??
      header?.branch;
    this.#sendTargets.delete(candidate.providerSessionId);
    return {
      providerSessionId: candidate.providerSessionId,
      title: header?.name ?? oneLine(candidate.meta.title, maximumSessionTitleLength) ?? label,
      status,
      observedAt,
      ...(candidate.meta.cwd ? { directory: candidate.meta.cwd } : undefined),
      detail: detailFor(label, status, link, undefined, branch, header?.diff),
      ...(refined.sessionClosed
        ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
        : undefined),
      ...(link ? { applications: [cursorApplication(link)] } : undefined),
    };
  }

  /** The observation hook's last word about one session, where hooks are on at all. */
  async #hookEvent(providerSessionId: string): Promise<ObservedCursorHookEvent | undefined> {
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    if (!hookEventsDirectory) return undefined;
    return readCursorHookEvent(hookEventsDirectory, providerSessionId).catch(() => undefined);
  }

  /**
   * Hands the developer's own message to one observed chat through Cursor's
   * documented CLI resume — the bounded exception CLAUDE.md's trust
   * constraints describe. The chat must have advertised taking one on the
   * latest pass, and the moment of the act re-checks what the advertisement
   * rested on: the transcript must still stand — the CLI silently starts a
   * fresh chat under an id it does not know, so a stale id must refuse rather
   * than fork — and the login is probed again, because a CLI signed out since
   * the pass must refuse before anything runs. Nothing is read out of a
   * launched turn: the transcript the adapter already observes is the report.
   */
  protected override async deliverMessage(
    observation: ProviderSessionObservation,
    text: string,
  ): Promise<ProviderMessageResult> {
    const providerSessionId = observation.providerSessionId;
    const target = this.#sendTargets.get(providerSessionId);
    if (!target) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    }
    const stats = await fileStats(target.transcriptFilePath);
    if (!stats?.isFile()) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That chat's transcript is gone, so nothing was sent.",
      };
    }
    const binaryPath =
      this.#cursorAgentBinaryPath ?? (await this.#cursorAgent.locate().catch(() => undefined));
    if (!binaryPath) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI is not installed, so nothing was sent.",
      };
    }
    let loggedIn: boolean;
    try {
      loggedIn = await this.#cursorAgent.probeLogin(binaryPath);
    } catch {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI could not answer, so nothing was sent.",
      };
    }
    if (!loggedIn) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI is signed out, so nothing was sent.",
      };
    }
    let launch: CursorAgentLaunch;
    try {
      launch = await this.#cursorAgent.launch(binaryPath, [
        CURSOR_AGENT_CLI.RESUME_FLAG,
        providerSessionId,
        CURSOR_AGENT_CLI.WORKSPACE_FLAG,
        target.folderPath,
        ...CURSOR_AGENT_CLI.SEND_ARGV,
        CURSOR_AGENT_CLI.ARGUMENT_SEPARATOR,
        text,
      ]);
    } catch {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI could not be started, so nothing was sent.",
      };
    }
    if (launch !== "running" && launch.exitCode !== 0) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI refused the message.",
      };
    }
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  }
}
