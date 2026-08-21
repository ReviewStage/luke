import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  maximumSessionRecapLength,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionStatus,
  sessionMessageText,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
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
  type HookStatusRefinement,
  LOCAL_ADAPTER_DEFAULTS,
  LocalFileSessionAdapter,
  localSessionStatus,
  readDirectory,
  readTail,
  readTextFile,
  refineStatusWithHookEvent,
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
 * filed a chat away. Only the presence of a positively archived row is ever
 * read — the header's own value column is the chat's name and standing, which
 * Cursor writes from the conversation, and observation never opens it.
 */
const CURSOR_APP_ARCHIVED_CHAT_QUERY =
  "SELECT 1 FROM composerHeaders WHERE composerId = ? AND isArchived = 1";

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
  HOOK_EVENT_TOLERANCE_MS: 5_000,
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
}

const EMPTY_APP_CHAT_INDEX: CursorAppChatIndex = { held: new Set(), archived: new Set() };

/**
 * Sharpens the transcript's verdict with what the observation hook last said,
 * in the order the meanings bind. A closed session is definite: the hook
 * saying so outranks the transcript, and a transcript that says error is
 * never talked out of it by a softer event. Past that, the events refine only
 * a fresh session — the decay to `UNKNOWN` exists because a hook can go
 * silent (a killed process fires no `sessionEnd`), so an old "waiting" must
 * age the same way an old transcript does. What the refinement actually buys
 * is the state the transcript cannot show at all: a chat whose window or CLI
 * closed looks exactly like one holding for its developer.
 */
const CURSOR_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: CURSOR_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    { event: CURSOR_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CURSOR_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
  ],
} as const satisfies HookStatusRefinement<CursorHookEvent>;

function statusWithHookEvent(
  status: SessionStatus,
  event: CursorHookEvent,
  isFresh: boolean,
): SessionStatus {
  return refineStatusWithHookEvent(status, event, isFresh, CURSOR_HOOK_STATUS_REFINEMENT);
}

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
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;
  readonly #cursorAgent: CursorAgentRunner;
  #cursorAgentBinaryPath: string | undefined;
  #trustedFoldersByProject: ReadonlyMap<string, string> = new Map();
  readonly #sendTargets = new Map<string, CursorSendTarget>();

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
    const projectDirectoryNames = [
      ...new Set(candidates.map((candidate) => candidate.projectDirectoryName)),
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
  protected async observation(
    candidate: CursorTranscriptCandidate,
    parsed: ParsedCursorTail,
    now: number,
    activeSessionFreshnessMs: number,
  ): Promise<ProviderSessionObservation> {
    const label = this.#workspaceLabels.label(candidate.projectDirectoryName);
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    const hookEvent: ObservedCursorHookEvent | undefined = hookEventsDirectory
      ? await readCursorHookEvent(hookEventsDirectory, candidate.providerSessionId).catch(
          () => undefined,
        )
      : undefined;
    // A transcript carries no timestamps of its own, so when it was last
    // written is Cursor's only account of when this session last did anything.
    // A hook event trailing that clock by more than the tolerance describes a
    // turn the transcript already moved past, so it is ignored whole; one that
    // stands is proof the session moved — only Luke's own script writes the
    // spool — and dates the session for the freshness decay as well.
    const transcriptAt = candidate.mtimeMs;
    const eventStands =
      hookEvent !== undefined &&
      hookEvent.atMs + CURSOR_LOCAL_ADAPTER_DEFAULTS.HOOK_EVENT_TOLERANCE_MS >= transcriptAt;
    const observedAt = eventStands ? Math.max(transcriptAt, hookEvent.atMs) : transcriptAt;
    let status = statusFromTurn(parsed.turn, observedAt, now, activeSessionFreshnessMs);
    if (eventStands) {
      const isFresh = now - observedAt <= activeSessionFreshnessMs;
      status = statusWithHookEvent(status, hookEvent.event, isFresh);
    }
    const appHeld = this.#appChats.has(candidate.providerSessionId);
    const link = appHeld ? cursorChatLink(candidate.providerSessionId) : undefined;
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
    const folderPath =
      this.#trustedFoldersByProject.get(candidate.projectDirectoryName) ??
      this.#workspaceLabels.folder(candidate.projectDirectoryName);
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
      title: label,
      status,
      observedAt,
      detail: detailFor(label, status, link, parsed.activity),
      ...(parsed.recap ? { recap: parsed.recap } : undefined),
      ...(canReceiveMessage ? { canReceiveMessage: true } : undefined),
      ...(status === SESSION_STATUS.COMPLETE
        ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
        : undefined),
      ...(link ? { applications: [cursorApplication(link)] } : undefined),
    };
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
  override async sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    const text = sessionMessageText(message.text);
    if (!text) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "That message is empty or too long.",
      };
    }
    const target = this.#sendTargets.get(message.providerSessionId);
    if (!target) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const stats = await fileStats(target.transcriptFilePath);
    if (!stats?.isFile()) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "That chat's transcript is gone, so nothing was sent.",
      };
    }
    const binaryPath =
      this.#cursorAgentBinaryPath ?? (await this.#cursorAgent.locate().catch(() => undefined));
    if (!binaryPath) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI is not installed, so nothing was sent.",
      };
    }
    let loggedIn: boolean;
    try {
      loggedIn = await this.#cursorAgent.probeLogin(binaryPath);
    } catch {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI could not answer, so nothing was sent.",
      };
    }
    if (!loggedIn) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI is signed out, so nothing was sent.",
      };
    }
    let launch: CursorAgentLaunch;
    try {
      launch = await this.#cursorAgent.launch(binaryPath, [
        CURSOR_AGENT_CLI.RESUME_FLAG,
        message.providerSessionId,
        CURSOR_AGENT_CLI.WORKSPACE_FLAG,
        target.folderPath,
        ...CURSOR_AGENT_CLI.SEND_ARGV,
        CURSOR_AGENT_CLI.ARGUMENT_SEPARATOR,
        text,
      ]);
    } catch {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI could not be started, so nothing was sent.",
      };
    }
    if (launch !== "running" && launch.exitCode !== 0) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "Cursor's agent CLI refused the message.",
      };
    }
    return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
  }
}
