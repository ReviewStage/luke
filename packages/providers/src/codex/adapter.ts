import os from "node:os";
import path from "node:path";
import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionProvider,
} from "@sidecar/session";
import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  oneLine,
  recordFromJsonLine,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import {
  type HookStatusRefinement,
  hookRefinedStatus,
  LocalSessionAdapter,
  readTail,
  readTextFile,
  uniquePaths,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import {
  CODEX_HOOK_EVENT,
  type CodexHookEvent,
  type ObservedCodexHookEvent,
  readCodexHookEvent,
} from "./hooks.js";
import { readCodexSessionTranscript } from "./transcript.js";

const CODEX_PROVIDER_ID = PROVIDER_ID.CODEX;
const CODEX_PROVIDER_NAME = "Codex";

const CODEX_ENVIRONMENT = {
  CONFIG_DIRECTORY: "CODEX_HOME",
  SQLITE_DIRECTORY: "CODEX_SQLITE_HOME",
} as const;

const CODEX_DATABASE_FILE = {
  STATE: "state_5.sqlite",
} as const;

const CODEX_SESSION_INDEX_FILE = "session_index.jsonl";

const CODEX_CONFIG_FILE = {
  USER: "config.toml",
} as const;

const CODEX_CONFIG_KEY = {
  SQLITE_DIRECTORY: "sqlite_home",
} as const;

/**
 * The Codex app's own address for a local thread. Codex registers the `codex`
 * scheme for its windows and documents `threads/<thread-id>` as the route to an
 * existing local chat, keyed by the same `threads.id` this adapter reads — so
 * the row and the address it opens name one thread rather than two.
 */
const CODEX_THREAD_LINK_PREFIX = "codex://threads/";

/**
 * Codex uses this synthetic title for locally-created delegation sessions.
 * It identifies the source chat for Codex itself, but is not a user-facing
 * title and can be misleading when shown in Luke's session list.
 */
const CODEX_DELEGATION_TITLE =
  /<codex_delegation>\s*<source_thread_id>\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*<\/source_thread_id>/i;

const CODEX_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODEX_THREAD_COLUMN = {
  ID: "id",
  SOURCE: "source",
  CWD: "cwd",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  CREATED_AT_MS: "created_at_ms",
  UPDATED_AT_MS: "updated_at_ms",
  RECENCY_AT_MS: "recency_at_ms",
  TITLE: "title",
  FIRST_USER_MESSAGE: "first_user_message",
  GIT_BRANCH: "git_branch",
  MODEL: "model",
  REASONING_EFFORT: "reasoning_effort",
  ROLLOUT_PATH: "rollout_path",
} as const;

const CODEX_SUBAGENT_SOURCE_FIELD = {
  SUBAGENT: "subagent",
  THREAD_SPAWN: "thread_spawn",
  PARENT_THREAD_ID: "parent_thread_id",
} as const;

/** Records Codex appends to the rollout file named by a thread's `rollout_path`. */
const CODEX_ROLLOUT_TYPE = {
  EVENT_MSG: "event_msg",
  RESPONSE_ITEM: "response_item",
  WORLD_STATE: "world_state",
} as const;

/**
 * The realtime section of Codex's persisted world state: `{ active: boolean }`,
 * written into every turn's snapshot. This is the durable record of whether a
 * realtime voice conversation was open over the thread when its last turn ran —
 * the voice lifecycle events themselves are transient and never reach the
 * rollout. A `full` snapshot carries every section, so one without this key is
 * a build with no realtime at all; a patch reports the section only when it
 * changed.
 */
const CODEX_WORLD_STATE_SECTION = {
  REALTIME: "realtime",
} as const;

const CODEX_REALTIME_ACTIVE_KEY = "active";

/**
 * The turn boundary. `threads` carries no status column at all, so without the
 * rollout a Codex session can only be guessed at from how recently its row was
 * touched — and could never be reported as waiting for its developer.
 */
const CODEX_EVENT_PAYLOAD = {
  TASK_STARTED: "task_started",
  TASK_COMPLETE: "task_complete",
  /**
   * The failure that ended a turn early. Current Codex builds carry the error
   * on `task_complete` itself; older ones wrote this event standing alone, so
   * both shapes are read — the same pair the transcript reader renders.
   */
  ERROR: "error",
} as const;

const CODEX_RESPONSE_PAYLOAD = {
  FUNCTION_CALL: "function_call",
  MESSAGE: "message",
} as const;

const CODEX_MESSAGE_ROLE = {
  USER: "user",
} as const;

/**
 * Function-call arguments whose value names the work, in the order they read
 * best. `cmd` leads because `exec_command` is by far the most common call Codex
 * makes and that is what it calls its command line.
 */
export const CODEX_CALL_ARGUMENT_KEY = [
  "cmd",
  "command",
  "path",
  "file_path",
  "query",
  "search_query",
  "pattern",
] as const;

const CODEX_ADAPTER_DEFAULTS = {
  /** Enough to reach past one turn's token accounting to its boundary event. */
  READ_ROLLOUT_TAIL_BYTES: 64 * 1024,
  /** Only the threads that can still change are worth a second file read. */
  MAXIMUM_ROLLOUT_READS: 12,
  /**
   * How far back into Codex's append-only name index one pass reads. The
   * newest entry per thread wins and a delegated chat is created moments
   * before its title needs resolving, so the names worth having live at the
   * end; a bounded tail keeps a file that only ever grows from becoming an
   * unbounded read on every pass.
   */
  READ_SESSION_INDEX_TAIL_BYTES: 128 * 1024,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

const CODEX_REALTIME_DELEGATION_MARKER = "<realtime_delegation>";

// Every column is read defensively from the row, so the projection stays `*`:
// Codex adds columns by migration, and naming one this build expects but an
// older install lacks would fail the whole query rather than one field.
// An archived thread is one the user filed away in Codex's own UI, so it is
// no row at all rather than a completed one — the same reading OpenCode's
// archived sessions get — and archiving touches the row's clock, so anything
// short of excluding it outright would resurface it as fresh.
const CODEX_THREAD_QUERY = `
  WITH observed_threads AS (
    SELECT
      *,
      MAX(
        COALESCE(recency_at_ms, 0),
        COALESCE(updated_at_ms, 0),
        COALESCE(created_at_ms, 0),
        COALESCE(updated_at, 0) * 1000,
        COALESCE(created_at, 0) * 1000
      ) AS luke_observed_at_ms
    FROM threads
  )
  SELECT *
  FROM observed_threads
  WHERE id <> ''
    AND cwd <> ''
    AND archived = 0
  ORDER BY luke_observed_at_ms DESC,
    id DESC
`;

type CodexThreadRow = WireRecord;

export const CODEX_PROVIDER: SessionProvider = {
  id: CODEX_PROVIDER_ID,
  displayName: CODEX_PROVIDER_NAME,
};

export interface CodexAdapterOptions {
  codexHome?: string;
  sqliteHome?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
  sqlite?: SqliteModuleLoader;
  transcriptMaximumRenderedLength?: number;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud adapters' credentials, because the app decides
   * the path after this adapter is declared. Absent — or answering nothing —
   * the adapter reads the state database and rollouts alone, exactly as it
   * always has: the hooks only ever sharpen what those already showed.
   */
  hookEventsDirectory?: () => string | undefined;
}

/**
 * Reads one argument as the phrase that names the work. Codex passes some of
 * them as a list rather than a string — a search's terms, a command's argv —
 * so a list of plain values is joined instead of dropped. A list of anything
 * else, such as a plan's steps, is not a phrase and is left alone.
 */
export function argumentPhrase(value: UnparsedWireValue): string | undefined {
  if (isWireString(value)) return text(value);
  if (isWireNumber(value)) return String(value);
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tokens = value.map((entry) =>
    isWireString(entry) || isWireNumber(entry) ? String(entry) : undefined,
  );
  return tokens.every((token) => token !== undefined) ? text(tokens.join(" ")) : undefined;
}

/** Names the tool Codex called, preferring whichever argument says what it is for. */
function activityFromCall(payload: WireRecord): string | undefined {
  const name = text(payload.name);
  if (!name) return undefined;
  const parsedArguments = text(payload.arguments)
    ? recordFromJsonLine(
        // SAFETY: text() narrows arguments to string before JSON parsing.
        payload.arguments as string,
      )
    : undefined;
  for (const key of CODEX_CALL_ARGUMENT_KEY) {
    const detail = oneLine(
      argumentPhrase(parsedArguments?.[key]),
      CODEX_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
    );
    if (detail) return `${name}: ${detail}`;
  }
  return name;
}

interface ParsedCodexRollout {
  activity?: string;
  error?: string;
  lastAgentMessage?: string;
  turnComplete?: boolean;
  /** Whether a realtime voice conversation is live over this thread, when the tail says. */
  realtimeVoiceLive?: boolean;
}

/**
 * Reads whether the realtime voice conversation is open out of one world-state
 * snapshot, or nothing when the snapshot does not say. A patch that omits the
 * realtime section left it unchanged; a full snapshot omitting it comes from a
 * build with no realtime to be in.
 */
function realtimeActiveFromWorldState(payload: WireRecord): boolean | undefined {
  const state = isRecord(payload.state) ? payload.state : undefined;
  if (!state) return undefined;
  const realtime = state[CODEX_WORLD_STATE_SECTION.REALTIME];
  if (isRecord(realtime)) {
    const active = realtime[CODEX_REALTIME_ACTIVE_KEY];
    return isWireBoolean(active) ? active : undefined;
  }
  return payload.full === true ? false : undefined;
}

/** Whether a message is the realtime conversation delegating its turn to the thread. */
function isRealtimeDelegationMessage(payload: WireRecord): boolean {
  if (payload.role !== CODEX_MESSAGE_ROLE.USER || !Array.isArray(payload.content)) return false;
  return payload.content.some(
    (block) => isRecord(block) && isCodexRealtimeDelegationText(text(block.text)),
  );
}

/**
 * Reads the turn boundary and the current call out of a rollout tail. A
 * `task_complete` that nothing followed means the turn ended and the session is
 * holding for its developer; a `task_started` means it is still running.
 */
function parseCodexRolloutTail(tail: string): ParsedCodexRollout {
  const parsed: ParsedCodexRollout = {};
  const lines = tail.split(/\r?\n/);
  for (const line of lines) {
    const record = recordFromJsonLine(line);
    if (!record) continue;
    const payload = isRecord(record.payload) ? record.payload : undefined;
    if (!payload) continue;

    if (record.type === CODEX_ROLLOUT_TYPE.EVENT_MSG) {
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_STARTED) {
        parsed.turnComplete = false;
        parsed.lastAgentMessage = undefined;
        // A new turn is not running the previous turn's last call, and holding
        // it would keep a stale line on the row until some other tool runs.
        parsed.activity = undefined;
        // A new turn is also not stuck on the previous turn's failure, and
        // holding it would keep the row at error while the session works.
        parsed.error = undefined;
      }
      if (payload.type === CODEX_EVENT_PAYLOAD.ERROR) {
        parsed.error =
          oneLine(text(payload.message), CODEX_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ??
          parsed.error;
      }
      if (payload.type === CODEX_EVENT_PAYLOAD.TASK_COMPLETE) {
        parsed.turnComplete = true;
        parsed.activity = undefined;
        if (isRecord(payload.error)) {
          // A turn that ended on a failure gets no recap: the agent's parting
          // words predate what went wrong, and the error is what the row now
          // has to say. The fallback keeps a standalone error event's message
          // when the boundary's own error carries none.
          parsed.error =
            oneLine(text(payload.error.message), CODEX_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ??
            parsed.error;
          parsed.lastAgentMessage = undefined;
        } else {
          // A turn that settled cleanly got past any failure it recorded on
          // the way, so a stale error must not outlive it.
          parsed.error = undefined;
          parsed.lastAgentMessage = oneLine(
            text(payload.last_agent_message),
            maximumSessionRecapLength,
          );
        }
      }
      continue;
    }
    if (record.type === CODEX_ROLLOUT_TYPE.WORLD_STATE) {
      parsed.realtimeVoiceLive = realtimeActiveFromWorldState(payload) ?? parsed.realtimeVoiceLive;
      continue;
    }
    if (record.type === CODEX_ROLLOUT_TYPE.RESPONSE_ITEM) {
      if (payload.type === CODEX_RESPONSE_PAYLOAD.FUNCTION_CALL) {
        parsed.activity = activityFromCall(payload) ?? parsed.activity;
      }
      // A delegation is written only while the conversation is open, so one is
      // proof of the conversation even when the world-state snapshot that
      // opened it has scrolled past the bounded tail. The snapshot that closes
      // it always lands after the last delegation, so last-in-file-order wins.
      if (payload.type === CODEX_RESPONSE_PAYLOAD.MESSAGE && isRealtimeDelegationMessage(payload)) {
        parsed.realtimeVoiceLive = true;
      }
    }
  }
  return parsed;
}

function timestampFromRow(row: CodexThreadRow): number {
  return Math.max(
    numberFromRow(row, CODEX_THREAD_COLUMN.RECENCY_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT_MS) ?? 0,
    numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT_MS) ?? 0,
    (numberFromRow(row, CODEX_THREAD_COLUMN.UPDATED_AT) ?? 0) * 1000,
    (numberFromRow(row, CODEX_THREAD_COLUMN.CREATED_AT) ?? 0) * 1000,
  );
}

function normalizeDirectory(value: string | undefined, baseDirectory: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === "~") return os.homedir();
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  if (path.isAbsolute(normalized)) return normalized;
  return path.resolve(baseDirectory, normalized);
}

function unescapeBasicTomlString(value: string): string {
  return value.replace(/\\(["\\bfnrt])/g, (_match, character: string) => {
    if (character === "b") return "\b";
    if (character === "f") return "\f";
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    if (character === "t") return "\t";
    return character;
  });
}

function tomlStringValue(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return unescapeBasicTomlString(normalized.slice(1, -1)).trim() || undefined;
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).trim() || undefined;
  }
  return normalized.trim() || undefined;
}

function topLevelTomlString(source: string, key: string): string | undefined {
  let inTopLevel = true;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    if (trimmed.slice(0, separatorIndex).trim() !== key) continue;
    return tomlStringValue(trimmed.slice(separatorIndex + 1).replace(/\s+#.*$/, ""));
  }
  return undefined;
}

async function sqliteHomeFromConfig(codexHome: string): Promise<string | undefined> {
  const config = await readTextFile(path.join(codexHome, CODEX_CONFIG_FILE.USER));
  return config
    ? normalizeDirectory(topLevelTomlString(config, CODEX_CONFIG_KEY.SQLITE_DIRECTORY), codexHome)
    : undefined;
}

/**
 * Where Codex's state database may be, most authoritative first: an explicit
 * home, then the one `config.toml` names, then wherever `CODEX_SQLITE_HOME`
 * points, then the paths Codex writes by default.
 */
export async function stateDatabasePaths(
  codexHome: string,
  configuredSqliteHome: string | undefined,
): Promise<string[]> {
  const sqliteHome =
    normalizeDirectory(configuredSqliteHome, codexHome) ??
    (await sqliteHomeFromConfig(codexHome)) ??
    normalizeDirectory(process.env[CODEX_ENVIRONMENT.SQLITE_DIRECTORY], codexHome);
  return uniquePaths(
    [
      sqliteHome && path.join(sqliteHome, CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, "sqlite", CODEX_DATABASE_FILE.STATE),
      path.join(codexHome, CODEX_DATABASE_FILE.STATE),
    ].filter((candidate): candidate is string => candidate !== undefined),
  );
}

interface CodexThreadNameSources {
  /**
   * The newest name per thread from Codex's own index, read only on a pass
   * where a marker title actually needs resolving.
   */
  indexNames: ReadonlyMap<string, string>;
  /** Each observed thread's own titled name, for resolving a delegation's source in the same pass. */
  rowTitles: ReadonlyMap<string, string>;
}

/**
 * Codex names its own threads, and that name is what a developer is looking
 * for. A delegated chat's derived title is the delegation marker itself, so it
 * resolves through names Codex actually keeps — the chat's own newest indexed
 * name first, for one renamed since it was spawned, then the source
 * conversation's title or indexed name, because the delegated chat is that
 * conversation's work. The workspace is the fallback for a thread too new to
 * have been named — or one whose only title is the realtime delegation
 * scaffolding, which names no source to borrow from.
 */
function titleFromRow(row: CodexThreadRow, names: CodexThreadNameSources): string {
  const title = oneLine(textFromRow(row, CODEX_THREAD_COLUMN.TITLE), maximumSessionTitleLength);
  const workspace = workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD));
  if (!title) return workspace;
  const ownName = indexedName(names, textFromRow(row, CODEX_THREAD_COLUMN.ID));
  const sourceThreadId = CODEX_DELEGATION_TITLE.exec(title)?.[1];
  if (sourceThreadId) {
    return (
      ownName ??
      names.rowTitles.get(sourceThreadId) ??
      indexedName(names, sourceThreadId) ??
      workspace
    );
  }
  if (isCodexRealtimeDelegationText(title)) return ownName ?? workspace;
  return title;
}

/**
 * The newest indexed name for a thread, unless that name is itself delegation
 * scaffolding: the marker leaking into the index is still not a name, so every
 * candidate passes the same test the title failed.
 */
function indexedName(
  names: CodexThreadNameSources,
  threadId: string | undefined,
): string | undefined {
  const name = names.indexNames.get(threadId ?? "");
  if (name === undefined) return undefined;
  if (CODEX_DELEGATION_TITLE.test(name) || isCodexRealtimeDelegationText(name)) return undefined;
  return name;
}

/**
 * The newest name Codex's own index holds for each thread. Entries are
 * append-only and a later line wins; a line with an empty name is the name
 * being removed, and unmakes what an earlier line said rather than being
 * skipped past it. The read is a bounded tail: the file only ever grows, and
 * the names worth having — a delegated chat's, its source's — are recent by
 * construction.
 */
async function readCodexSessionTitles(codexHome: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const tail = await readTail(
    path.join(codexHome, CODEX_SESSION_INDEX_FILE),
    CODEX_ADAPTER_DEFAULTS.READ_SESSION_INDEX_TAIL_BYTES,
  );
  for (const line of tail.split(/\r?\n/u)) {
    const record = recordFromJsonLine(line);
    const id = text(record?.id);
    if (!id) continue;
    const title = oneLine(text(record?.thread_name), maximumSessionTitleLength);
    if (title) titles.set(id, title);
    else titles.delete(id);
  }
  return titles;
}

/**
 * Codex keeps the initial user message in the thread row even after it gives
 * the chat a user-facing name. That makes it a more durable signal than the
 * provisional title, while the title fallback covers older rows that do not
 * carry the column's value.
 */
export function isCodexRealtimeDelegationText(value: string | undefined): boolean {
  return text(value)?.trimStart().startsWith(CODEX_REALTIME_DELEGATION_MARKER) === true;
}

function isCodexRealtimeDelegationThread(row: CodexThreadRow): boolean {
  return (
    isCodexRealtimeDelegationText(textFromRow(row, CODEX_THREAD_COLUMN.FIRST_USER_MESSAGE)) ||
    isCodexRealtimeDelegationText(textFromRow(row, CODEX_THREAD_COLUMN.TITLE))
  );
}

/**
 * The source conversation a delegated chat was born from. Current Codex rows
 * carry an exact parent id in their structured thread source. Older delegated
 * chats used the first-message marker instead: the row keeps that message for
 * its whole life, so the link outlives a rename, while the title stands in for
 * still older rows whose column carries nothing.
 */
function delegationSourceFromRow(row: CodexThreadRow): string | undefined {
  const source = recordFromJsonLine(textFromRow(row, CODEX_THREAD_COLUMN.SOURCE) ?? "");
  const subagentValue = source?.[CODEX_SUBAGENT_SOURCE_FIELD.SUBAGENT];
  const subagent = isRecord(subagentValue) ? subagentValue : undefined;
  const threadSpawnValue = subagent?.[CODEX_SUBAGENT_SOURCE_FIELD.THREAD_SPAWN];
  const threadSpawn = isRecord(threadSpawnValue) ? threadSpawnValue : undefined;
  const parentThreadId = text(threadSpawn?.[CODEX_SUBAGENT_SOURCE_FIELD.PARENT_THREAD_ID]);
  if (parentThreadId && CODEX_THREAD_ID.test(parentThreadId)) return parentThreadId;

  for (const column of [CODEX_THREAD_COLUMN.FIRST_USER_MESSAGE, CODEX_THREAD_COLUMN.TITLE]) {
    const sourceId = CODEX_DELEGATION_TITLE.exec(textFromRow(row, column) ?? "")?.[1];
    if (sourceId) return sourceId;
  }
  return undefined;
}

/**
 * A chat another conversation delegated is a limb of that conversation: while
 * the source thread's rollout says its realtime voice conversation is open,
 * the delegated chat's turn boundaries belong to the same spoken exchange and
 * hold their announcements the same way. The link is the marker Codex itself
 * wrote the chat's first message with, and the source's state is the same
 * pass's rollout read — arithmetic against observed state, nothing decided.
 */
function linkDelegatedVoiceConversations(
  rows: readonly CodexThreadRow[],
  rollouts: Map<string, ParsedCodexRollout>,
): void {
  for (const row of rows) {
    const sourceId = delegationSourceFromRow(row);
    if (!sourceId || rollouts.get(sourceId)?.realtimeVoiceLive !== true) continue;
    const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
    if (!id) continue;
    const parsed = rollouts.get(id);
    if (parsed) parsed.realtimeVoiceLive = true;
    else rollouts.set(id, { realtimeVoiceLive: true });
  }
}

function modelFromRow(row: CodexThreadRow): string | undefined {
  const model = textFromRow(row, CODEX_THREAD_COLUMN.MODEL);
  if (!model) return undefined;
  const effort = textFromRow(row, CODEX_THREAD_COLUMN.REASONING_EFFORT);
  return effort ? `${model} · ${effort}` : model;
}

function statusFromRow(
  rollout: ParsedCodexRollout | undefined,
  observedAt: number,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation["status"] {
  // A turn that failed is stuck until someone comes back to it, so the error
  // outranks freshness: going stale is exactly what a session waiting on a
  // rescue looks like, and decaying it to unknown would hide the one row
  // that most needs a person.
  if (rollout?.error) return SESSION_STATUS.ERROR;
  const isFresh = now - observedAt <= activeSessionFreshnessMs;
  // A turn that ended is holding for the developer however the row's timestamp
  // reads, but once it is stale Luke cannot tell a turn that just finished from
  // a thread abandoned hours ago.
  if (rollout?.turnComplete === true) {
    return isFresh ? SESSION_STATUS.WAITING : SESSION_STATUS.UNKNOWN;
  }
  if (rollout?.turnComplete === false) return SESSION_STATUS.WORKING;
  return isFresh ? SESSION_STATUS.WORKING : SESSION_STATUS.UNKNOWN;
}

/**
 * What the refinement actually buys here is the states the state database
 * cannot show: a tool call holding for approval writes no records while it
 * holds, and a turn's true end can sit past the rollout's read.
 */
const CODEX_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: CODEX_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    {
      event: CODEX_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.UNKNOWN,
    },
    { event: CODEX_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: CODEX_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
  ],
  notificationEvent: CODEX_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: CODEX_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<CodexHookEvent>;

function detailFromRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
): SessionDetail {
  const activity = rollout?.activity;
  const branch = textFromRow(row, CODEX_THREAD_COLUMN.GIT_BRANCH);
  const model = modelFromRow(row);
  const error = rollout?.error;
  const threadId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  return {
    ...(activity ? { activity } : undefined),
    repository: workspaceLabel(textFromRow(row, CODEX_THREAD_COLUMN.CWD)),
    ...(branch ? { branch } : undefined),
    ...(model ? { model } : undefined),
    ...(error ? { error } : undefined),
    ...(threadId
      ? { link: `${CODEX_THREAD_LINK_PREFIX}${encodeURIComponent(threadId)}` }
      : undefined),
  };
}

function chatGptApplication(link: string) {
  return {
    id: SESSION_APPLICATION_ID.CHATGPT,
    displayName: "ChatGPT",
    scope: SESSION_APPLICATION_SCOPE.SESSION,
    link,
  } as const;
}

function observationFromThreadRow(
  row: CodexThreadRow,
  rollout: ParsedCodexRollout | undefined,
  names: CodexThreadNameSources,
  now: number,
  activeSessionFreshnessMs: number,
  hookEvent?: ObservedCodexHookEvent,
): ProviderSessionObservation | undefined {
  const providerSessionId = textFromRow(row, CODEX_THREAD_COLUMN.ID);
  if (!providerSessionId) return undefined;

  const rowAt = timestampFromRow(row);
  const refined = hookRefinedStatus({
    refinement: CODEX_HOOK_STATUS_REFINEMENT,
    hookEvent,
    providerAtMs: rowAt,
    statusAt: (observedAt) => statusFromRow(rollout, observedAt, now, activeSessionFreshnessMs),
    now,
    activeSessionFreshnessMs,
  });
  const completionCause = refined.sessionClosed
    ? SESSION_COMPLETION_CAUSE.SESSION_CLOSED
    : undefined;
  const detail = detailFromRow(row, rollout);
  const parentProviderSessionId = delegationSourceFromRow(row);
  const observation: ProviderSessionObservation = {
    providerSessionId,
    ...(parentProviderSessionId ? { parentProviderSessionId } : undefined),
    title: titleFromRow(row, names),
    status: refined.status,
    ...(completionCause ? { completionCause } : undefined),
    observedAt: refined.observedAt,
    ...(rollout?.lastAgentMessage ? { recap: rollout.lastAgentMessage } : undefined),
    detail,
    ...(detail.link ? { applications: [chatGptApplication(detail.link)] } : undefined),
    ...(refined.holdingForDeveloper ? { holdingForDeveloper: true } : undefined),
  };
  if (isCodexRealtimeDelegationThread(row)) observation.realtimeVoice = true;
  if (rollout?.realtimeVoiceLive === true) observation.realtimeVoiceLive = true;
  return observation;
}

export function defaultCodexHome(): string {
  const configuredHome = process.env[CODEX_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".codex");
}

export class CodexSessionAdapter extends LocalSessionAdapter {
  readonly provider = CODEX_PROVIDER;

  readonly #codexHome: string;
  readonly #sqliteHome: string | undefined;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;

  constructor(options: CodexAdapterOptions = {}) {
    super(options);
    this.#codexHome = options.codexHome ?? defaultCodexHome();
    this.#sqliteHome = options.sqliteHome;
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
    this.#hookEventsDirectory = options.hookEventsDirectory;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    for (const databasePath of await stateDatabasePaths(this.#codexHome, this.#sqliteHome)) {
      const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (!database) continue;
      let rows: CodexThreadRow[];
      let now: number;
      try {
        now = this.observationTime();
        rows = database
          .prepare(CODEX_THREAD_QUERY)
          .all()
          .filter((row): row is CodexThreadRow => isRecord(row));
      } catch (error) {
        if (error instanceof Error && canIgnoreSqliteError(error)) continue;
        throw error;
      } finally {
        database.close();
      }

      // The rollout and spool reads happen with the database already closed,
      // so a slow disk never holds a read lock on state Codex itself is
      // writing.
      const rollouts = await this.#rollouts(rows);
      const hookEvents = await this.#hookEvents(rows);
      const names = await this.#threadNames(rows);
      linkDelegatedVoiceConversations(rows, rollouts);
      return rows
        .map((row) =>
          observationFromThreadRow(
            row,
            rollouts.get(textFromRow(row, CODEX_THREAD_COLUMN.ID) ?? ""),
            names,
            now,
            this.activeSessionFreshnessMs,
            hookEvents.get(textFromRow(row, CODEX_THREAD_COLUMN.ID) ?? ""),
          ),
        )
        .filter(
          (observation): observation is ProviderSessionObservation => observation !== undefined,
        );
    }
    return [];
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return readCodexSessionTranscript({
      codexHome: this.#codexHome,
      sqliteHome: this.#sqliteHome,
      providerSessionId,
      sqlite: this.#sqlite,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }

  /**
   * Reads the turn boundary for each observed thread, newest first. The cap
   * keeps a crowded day from turning one observation pass into dozens of file
   * reads.
   */
  async #rollouts(rows: readonly CodexThreadRow[]): Promise<Map<string, ParsedCodexRollout>> {
    const candidates = rows
      .slice(0, CODEX_ADAPTER_DEFAULTS.MAXIMUM_ROLLOUT_READS)
      .map((row) => ({
        id: textFromRow(row, CODEX_THREAD_COLUMN.ID),
        rolloutPath: textFromRow(row, CODEX_THREAD_COLUMN.ROLLOUT_PATH),
      }))
      .filter(
        (candidate): candidate is { id: string; rolloutPath: string } =>
          candidate.id !== undefined && candidate.rolloutPath !== undefined,
      );

    const parsed = await Promise.all(
      candidates.map(async (candidate) => {
        const tail = await readTail(
          candidate.rolloutPath,
          CODEX_ADAPTER_DEFAULTS.READ_ROLLOUT_TAIL_BYTES,
        );
        return [candidate.id, parseCodexRolloutTail(tail)] as const;
      }),
    );
    return new Map(parsed);
  }

  /**
   * Gathers the names a delegated chat's marker title can resolve through. The
   * pass's own rows already carry every titled thread; the name index is a
   * second file read, so it is opened only when some row actually shows a
   * marker in need of a name.
   */
  async #threadNames(rows: readonly CodexThreadRow[]): Promise<CodexThreadNameSources> {
    const rowTitles = new Map<string, string>();
    let hasMarkerTitle = false;
    for (const row of rows) {
      const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
      const title = oneLine(textFromRow(row, CODEX_THREAD_COLUMN.TITLE), maximumSessionTitleLength);
      if (!id || !title) continue;
      if (CODEX_DELEGATION_TITLE.test(title) || isCodexRealtimeDelegationText(title)) {
        hasMarkerTitle = true;
        continue;
      }
      rowTitles.set(id, title);
    }
    const indexNames = hasMarkerTitle
      ? await readCodexSessionTitles(this.#codexHome)
      : new Map<string, string>();
    return { indexNames, rowTitles };
  }

  /**
   * Reads what the observation hook last said about each thread. The spool is
   * a refinement, never a dependency: a directory that is missing, unreadable,
   * or holding something unexpected reads as no event, and the row's own
   * verdict stands.
   */
  async #hookEvents(rows: readonly CodexThreadRow[]): Promise<Map<string, ObservedCodexHookEvent>> {
    const events = new Map<string, ObservedCodexHookEvent>();
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    if (!hookEventsDirectory) return events;
    await Promise.all(
      rows.map(async (row) => {
        const id = textFromRow(row, CODEX_THREAD_COLUMN.ID);
        if (!id) return;
        const event = await readCodexHookEvent(hookEventsDirectory, id).catch(() => undefined);
        if (event) events.set(id, event);
      }),
    );
    return events;
  }
}
