import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agedStatus,
  nonNegativeNumber,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  positiveInteger,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProviderAdapter,
  type SessionStatus,
  UNKNOWN_WORKSPACE_LABEL,
} from "@sidecar/core";
import { CURSOR_PROVIDER } from "./cursor-adapter";
import {
  type DirectoryEntry,
  discoverSessionFiles,
  fileStats,
  LOCAL_ADAPTER_DEFAULTS,
  readDirectory,
  readTail,
  readTextFile,
  type SessionFileCandidate,
  tailRecords,
  workspaceLabel,
} from "./local-session-adapter";

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
  MAXIMUM_SESSION_FILES: 40,
} as const;

export interface CursorLocalAdapterOptions {
  cursorHome?: string;
  workspaceStorageDirectory?: string;
  now?: () => number;
  maximumProjectDirectories?: number;
  maximumSessionFiles?: number;
  maximumSessionAgeMs?: number;
  activeSessionFreshnessMs?: number;
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
  } catch {
    return undefined;
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
  if (status === SESSION_STATUS.WORKING && now - observedAt > freshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, observedAt, now, freshnessMs);
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
export class CursorLocalSessionAdapter implements SessionProviderAdapter {
  readonly provider = CURSOR_PROVIDER;

  readonly #cursorHome: string;
  readonly #workspaceLabels: CursorWorkspaceLabels;
  readonly #now: () => number;
  readonly #maximumProjectDirectories: number;
  readonly #maximumSessionFiles: number;
  readonly #maximumSessionAgeMs: number;
  readonly #activeSessionFreshnessMs: number;
  readonly #readTailBytes: number;

  constructor(options: CursorLocalAdapterOptions = {}) {
    this.#cursorHome = options.cursorHome ?? defaultCursorHome();
    this.#workspaceLabels = new CursorWorkspaceLabels(
      options.workspaceStorageDirectory ?? defaultWorkspaceStorageDirectory(),
    );
    this.#now = options.now ?? Date.now;
    this.#maximumProjectDirectories = positiveInteger(
      options.maximumProjectDirectories,
      CURSOR_LOCAL_ADAPTER_DEFAULTS.MAXIMUM_PROJECT_DIRECTORIES,
    );
    this.#maximumSessionFiles = positiveInteger(
      options.maximumSessionFiles,
      CURSOR_LOCAL_ADAPTER_DEFAULTS.MAXIMUM_SESSION_FILES,
    );
    this.#maximumSessionAgeMs = nonNegativeNumber(
      options.maximumSessionAgeMs,
      OBSERVATION_WINDOW.MAXIMUM_SESSION_AGE_MS,
    );
    this.#activeSessionFreshnessMs = nonNegativeNumber(
      options.activeSessionFreshnessMs,
      OBSERVATION_WINDOW.ACTIVE_SESSION_FRESHNESS_MS,
    );
    this.#readTailBytes = positiveInteger(
      options.readTailBytes,
      LOCAL_ADAPTER_DEFAULTS.READ_TAIL_BYTES,
    );
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const now = this.#now();
    const candidates = (
      await discoverSessionFiles({
        projectsDirectory: path.join(this.#cursorHome, CURSOR_DIRECTORY.PROJECTS),
        sessionsDirectoryName: CURSOR_DIRECTORY.TRANSCRIPTS,
        maximumProjectDirectories: this.#maximumProjectDirectories,
        maximumSessionFiles: this.#maximumSessionFiles,
        sessionFilesIn: transcriptsIn,
      })
    ).filter((candidate) => now - candidate.mtimeMs <= this.#maximumSessionAgeMs);
    // Only the sessions this pass reports are worth naming a folder for.
    await this.#workspaceLabels.resolve(
      candidates.map((candidate) => candidate.projectDirectoryName),
    );

    const observations = new Map<string, ProviderSessionObservation>();
    for (const candidate of candidates) {
      if (observations.has(candidate.providerSessionId)) continue;
      observations.set(candidate.providerSessionId, await this.#observationFor(candidate, now));
    }
    return [...observations.values()];
  }

  /**
   * A session is named by the folder it ran in and by nothing else. Cursor
   * names a chat from its opening prompt, so that name is the prompt and never
   * reaches an observation — and the location is left unsaid, which is how an
   * adapter reading this machine reports one that runs on it.
   */
  async #observationFor(
    candidate: CursorTranscriptCandidate,
    now: number,
  ): Promise<ProviderSessionObservation> {
    const label = this.#workspaceLabels.label(candidate.projectDirectoryName);
    const tail = await readTail(candidate.filePath, this.#readTailBytes);
    const status = statusFromTurn(
      closedTurn(tail),
      candidate.mtimeMs,
      now,
      this.#activeSessionFreshnessMs,
    );
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
