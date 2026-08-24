import os from "node:os";
import path from "node:path";
import {
  agedStatus,
  maximumSessionTitleLength,
  type ProviderSessionObservation,
  type ProviderTranscriptResult,
  providerTranscriptResult,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionDetail,
  type SessionStatus,
} from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  oneLine,
  recordFromJsonLine,
  text,
  type WireRecord,
} from "@sidecar/wire";
import {
  type HookStatusRefinement,
  hookRefinedStatus,
  LocalSessionAdapter,
  uniquePaths,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
} from "../shared/local-sqlite.js";
import { DEVIN_PROVIDER, millisecondsFromRecord } from "./adapter.js";
import {
  DEVIN_HOOK_EVENT,
  type DevinHookEvent,
  type ObservedDevinHookEvent,
  readDevinHookEvent,
} from "./hooks.js";
import { readDevinSessionTranscript } from "./transcript.js";

/**
 * Observes the Devin sessions running on this machine — the ones its CLI
 * starts in a terminal — from the state the CLI already writes for itself:
 * the SQLite database it keeps every session's conversation in. It runs no
 * server, needs no credential, and opens everything read-only. Sessions
 * handed to Devin's cloud live with the Devin API and are the cloud
 * adapter's to observe; the two halves share one provider through the
 * composite, exactly like Cursor's.
 */

const DEVIN_ENVIRONMENT = {
  DATA_HOME: "XDG_DATA_HOME",
  /** The CLI's own override, so a relocated database is observed where it is. */
  DATABASE_FILE: "CHISEL_SESSION_DB",
} as const;

/** The Devin CLI keeps XDG data paths on every platform, macOS included. */
const DEVIN_DATA_HOME_SEGMENTS = [".local", "share"] as const;
const DEVIN_DATA_DIRECTORY_SEGMENTS = ["devin", "cli"] as const;
const DEVIN_DATABASE_FILE = "sessions.db";

const DEVIN_SESSION_COLUMN = {
  ID: "id",
  WORKING_DIRECTORY: "working_directory",
  MODEL: "model",
  TITLE: "title",
  MAIN_CHAIN_ID: "main_chain_id",
  HIDDEN: "hidden",
  CREATED_AT: "created_at",
  LAST_ACTIVITY_AT: "last_activity_at",
} as const;

const DEVIN_NODE_COLUMN = {
  CHAT_MESSAGE: "chat_message",
} as const;

const DEVIN_TOOL_CALL_COLUMN = {
  CALL: "tool_call_json",
} as const;

/**
 * The roles a chat message may carry. The CLI interleaves system context into
 * the same chain — prompts, skill listings, workspace notes — and those say
 * nothing about whose move it is, so only the conversation's own three roles
 * decide the turn.
 */
export const DEVIN_ROLE = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
} as const;

/**
 * The states of a tool call that is still someone's live work. The CLI stores
 * each call as an ACP `ToolCall` record whose final update lands in a second
 * column, so a call is open while that update is missing — unless the call's
 * own status already says it settled, which an interrupted session can leave
 * behind without ever committing the update.
 */
const DEVIN_TOOL_CALL_SETTLED_STATUS = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

const DEVIN_ADAPTER_DEFAULTS = {
  /**
   * How far up the main chain the turn may be. System context arrives in
   * runs of a handful of nodes between conversation turns, so the newest
   * user, assistant, or tool node is well inside this.
   */
  MAXIMUM_CHAIN_WALK: 24,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

// Every column is read defensively from the row, so the projection stays `*`:
// the CLI adds columns by migration, and naming one this build expects but an
// older install lacks would fail the whole query rather than one field.
const DEVIN_SESSION_QUERY = `
  SELECT *
  FROM sessions
  WHERE hidden = 0
  ORDER BY last_activity_at DESC, id DESC
`;

// The WHERE clause above is the one thing that can name a column an old schema
// lacks, so a database it fails on is asked again with the filter moved into
// code, where an absent column is one missing field rather than no sessions.
const DEVIN_SESSION_QUERY_MINIMAL = `
  SELECT *
  FROM sessions
  ORDER BY last_activity_at DESC, id DESC
`;

/**
 * The main chain's newest nodes, tip first. The chain is walked by parent
 * pointers from the tip the session row names rather than taken from the top
 * of the table, because a rewound session leaves its abandoned branch as the
 * newest nodes while the tip points where the conversation actually stands.
 */
const DEVIN_CHAIN_QUERY = `
  WITH RECURSIVE chain (node_id, parent_node_id, chat_message, depth) AS (
    SELECT node_id, parent_node_id, chat_message, 0
    FROM message_nodes
    WHERE session_id = ?1 AND node_id = ?2
    UNION ALL
    SELECT nodes.node_id, nodes.parent_node_id, nodes.chat_message, chain.depth + 1
    FROM message_nodes AS nodes
    JOIN chain ON nodes.node_id = chain.parent_node_id
    WHERE nodes.session_id = ?1 AND chain.depth < ?3
  )
  SELECT chat_message FROM chain ORDER BY depth
`;

/** For a session row from before the tip pointer: newest nodes stand in. */
const DEVIN_NEWEST_NODES_QUERY = `
  SELECT chat_message
  FROM message_nodes
  WHERE session_id = ?1
  ORDER BY node_id DESC
  LIMIT ?2
`;

// The open tool calls, newest first. Openness is asked of the database — the
// update column a settled call's output lands in is named only in the WHERE
// clause, so its contents are never selected — and the projection carries the
// call record alone. This is also the one query that must name its columns
// rather than read them defensively, because leaving the output column out of
// the projection is the point; a schema it does not fit costs the activity
// field, never the pass.
const DEVIN_TOOL_CALL_QUERY = `
  SELECT tool_call_json
  FROM tool_call_state
  WHERE session_id = ?1 AND tool_call_update_json IS NULL
  ORDER BY rowid DESC
`;

type DevinRow = WireRecord;

export interface DevinLocalAdapterOptions {
  cliDirectory?: string;
  now?: () => number;
  activeSessionFreshnessMs?: number;
  sqlite?: SqliteModuleLoader;
  transcriptMaximumRenderedLength?: number;
  /**
   * Where the observation hook spools its events, when hooks are on at all.
   * Read lazily like the cloud adapters' credentials, because the app decides
   * the path after this adapter is declared. Absent — or answering nothing —
   * the adapter reads the session database alone, exactly as it always has:
   * the hooks only ever sharpen what the rows already showed.
   */
  hookEventsDirectory?: () => string | undefined;
}

/**
 * Whose move the conversation's newest turn says it is. Only the message's
 * role and whether it opened tool calls are read — the words of the message
 * stay in the record they were parsed from and go no further.
 */
interface DevinTurn {
  role?: string;
  toolCallsOpen?: boolean;
}

interface DevinLocalSessionSnapshot {
  providerSessionId: string;
  workingDirectory?: string;
  title?: string;
  model?: string;
  mainChainId?: number;
  observedAt: number;
  turn?: DevinTurn;
  activity?: string;
}

export function defaultDevinCliDirectory(): string {
  const dataHome = process.env[DEVIN_ENVIRONMENT.DATA_HOME]?.trim();
  const base = dataHome || path.join(os.homedir(), ...DEVIN_DATA_HOME_SEGMENTS);
  return path.join(base, ...DEVIN_DATA_DIRECTORY_SEGMENTS);
}

/**
 * Where the database may be, most authoritative first: wherever the CLI's own
 * `CHISEL_SESSION_DB` points, then the file every install writes.
 */
export function devinDatabasePaths(cliDirectory: string): string[] {
  const configured = process.env[DEVIN_ENVIRONMENT.DATABASE_FILE]?.trim();
  const configuredPath = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.join(cliDirectory, configured)
    : undefined;
  return uniquePaths(
    [configuredPath, path.join(cliDirectory, DEVIN_DATABASE_FILE)].filter(
      (candidate): candidate is string => candidate !== undefined,
    ),
  );
}

function textFromRow(row: DevinRow, key: string): string | undefined {
  return text(row[key]);
}

/**
 * Devin names a session after its first prompt and lets the developer rename
 * it, and that name is what they are looking for. The workspace stands in for
 * a session that has not been prompted yet, whose title is still empty.
 */
function sessionTitle(title: string | undefined, workingDirectory: string | undefined): string {
  return oneLine(title, maximumSessionTitleLength) ?? workspaceLabel(workingDirectory);
}

/**
 * Reads the turn out of the chain's newest conversation node, passing over the
 * system context the CLI interleaves. Only the role and the presence of open
 * tool calls are taken; content is never reported anywhere.
 */
function turnFromChainRecords(records: readonly WireRecord[]): DevinTurn | undefined {
  for (const record of records) {
    const role = text(record.role);
    if (role === DEVIN_ROLE.SYSTEM || role === undefined) continue;
    return {
      role,
      toolCallsOpen: Array.isArray(record.tool_calls) && record.tool_calls.length > 0,
    };
  }
  return undefined;
}

/**
 * A settled turn is an assistant message that opened no tool calls — the CLI
 * commits a message when its turn resolves, so an assistant reply on the tip
 * is holding for the developer, while their own prompt or a tool still in
 * flight is work under way. The database records no failure this build can
 * read, so a local Devin session never reports an error. A killed process
 * leaves an open turn on disk forever, so an open turn gone quiet is unknown
 * rather than still working.
 */
function statusFromTurn(
  turn: DevinTurn | undefined,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  const settled = turn?.role === DEVIN_ROLE.ASSISTANT && turn.toolCallsOpen !== true;
  const status = settled ? SESSION_STATUS.WAITING : SESSION_STATUS.WORKING;
  if (status === SESSION_STATUS.WORKING && now - observedAt > freshnessMs) {
    return SESSION_STATUS.UNKNOWN;
  }
  return agedStatus(status, observedAt, now, freshnessMs);
}

/**
 * Names the work the newest still-open tool call is doing, from the call's
 * own ACP record: the title the CLI wrote for it, or failing that its kind.
 * The rows arrive newest first and already hold only open calls, so the one
 * check left to code is the settled status an interrupted session can leave
 * inside a call whose update never landed.
 */
function activityFromToolCallRows(rows: readonly DevinRow[]): string | undefined {
  for (const row of rows) {
    const call = recordFromJsonLine(textFromRow(row, DEVIN_TOOL_CALL_COLUMN.CALL) ?? "");
    if (!call) continue;
    const status = text(call.status);
    if (
      status === DEVIN_TOOL_CALL_SETTLED_STATUS.COMPLETED ||
      status === DEVIN_TOOL_CALL_SETTLED_STATUS.FAILED
    ) {
      continue;
    }
    const activity =
      oneLine(text(call.title), DEVIN_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH) ?? text(call.kind);
    if (activity) return activity;
  }
  return undefined;
}

/**
 * What the refinement actually buys here is the states the session database
 * cannot show: a tool call holding for approval writes no node while it
 * holds, a settled turn and a session walked away from write the same rows,
 * and the database records no closure at all. The notification keeps waiting
 * past freshness for the same reason Codex's does — a standing event is
 * proof the approval dialog is still up, because any row at or past it would
 * have discarded it, and a process killed mid-hold leaves that proof
 * standing only until the spool prune retires it.
 */
const DEVIN_HOOK_STATUS_REFINEMENT = {
  definitive: [{ event: DEVIN_HOOK_EVENT.SESSION_END, fresh: SESSION_STATUS.COMPLETE }],
  fresh: [
    {
      event: DEVIN_HOOK_EVENT.NOTIFICATION,
      fresh: SESSION_STATUS.WAITING,
      stale: SESSION_STATUS.WAITING,
    },
    { event: DEVIN_HOOK_EVENT.PROMPT, fresh: SESSION_STATUS.WORKING },
    { event: DEVIN_HOOK_EVENT.STOP, fresh: SESSION_STATUS.WAITING },
  ],
  notificationEvent: DEVIN_HOOK_EVENT.NOTIFICATION,
  sessionEndEvent: DEVIN_HOOK_EVENT.SESSION_END,
} as const satisfies HookStatusRefinement<DevinHookEvent>;

function detailFromSnapshot(snapshot: DevinLocalSessionSnapshot): SessionDetail {
  return {
    ...(snapshot.activity ? { activity: snapshot.activity } : undefined),
    repository: workspaceLabel(snapshot.workingDirectory),
    ...(snapshot.model ? { model: snapshot.model } : undefined),
  };
}

function observationFromSnapshot(
  snapshot: DevinLocalSessionSnapshot,
  hookEvent: ObservedDevinHookEvent | undefined,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation {
  const refined = hookRefinedStatus({
    refinement: DEVIN_HOOK_STATUS_REFINEMENT,
    hookEvent,
    providerAtMs: snapshot.observedAt,
    statusAt: (observedAt) =>
      statusFromTurn(snapshot.turn, observedAt, now, activeSessionFreshnessMs),
    now,
    activeSessionFreshnessMs,
  });
  return {
    providerSessionId: snapshot.providerSessionId,
    title: sessionTitle(snapshot.title, snapshot.workingDirectory),
    status: refined.status,
    ...(refined.sessionClosed
      ? { completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED }
      : undefined),
    observedAt: refined.observedAt,
    detail: detailFromSnapshot(snapshot),
    ...(refined.holdingForDeveloper ? { holdingForDeveloper: true } : undefined),
  };
}

function snapshotFromSessionRow(row: DevinRow): DevinLocalSessionSnapshot | undefined {
  const providerSessionId = textFromRow(row, DEVIN_SESSION_COLUMN.ID);
  if (!providerSessionId) return undefined;
  const mainChainId = row[DEVIN_SESSION_COLUMN.MAIN_CHAIN_ID];
  return {
    providerSessionId,
    workingDirectory: textFromRow(row, DEVIN_SESSION_COLUMN.WORKING_DIRECTORY),
    title: textFromRow(row, DEVIN_SESSION_COLUMN.TITLE),
    model: textFromRow(row, DEVIN_SESSION_COLUMN.MODEL),
    ...(isWireNumber(mainChainId) && Number.isInteger(mainChainId) ? { mainChainId } : undefined),
    observedAt: Math.max(
      millisecondsFromRecord(row, DEVIN_SESSION_COLUMN.LAST_ACTIVITY_AT) ?? 0,
      millisecondsFromRecord(row, DEVIN_SESSION_COLUMN.CREATED_AT) ?? 0,
    ),
  };
}

/**
 * A hidden session is one the CLI itself keeps off its own listing; it is not
 * a row here either. Also named in the primary query's WHERE clause — this is
 * the same reading applied to rows the minimal query let through.
 */
function isObservableSessionRow(row: DevinRow): boolean {
  return row[DEVIN_SESSION_COLUMN.HIDDEN] !== 1;
}

export class DevinLocalSessionAdapter extends LocalSessionAdapter {
  readonly provider = DEVIN_PROVIDER;

  readonly #cliDirectory: string;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;
  readonly #hookEventsDirectory: (() => string | undefined) | undefined;

  constructor(options: DevinLocalAdapterOptions = {}) {
    super(options);
    this.#cliDirectory = options.cliDirectory ?? defaultDevinCliDirectory();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
    this.#hookEventsDirectory = options.hookEventsDirectory;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    for (const databasePath of devinDatabasePaths(this.#cliDirectory)) {
      const database = await openReadOnlyDatabase(this.#sqlite, databasePath);
      if (!database) continue;
      let snapshots: DevinLocalSessionSnapshot[] | undefined;
      let now = 0;
      try {
        now = this.observationTime();
        snapshots = this.#databaseSnapshots(database, now);
      } finally {
        database.close();
      }
      // A database whose schema was unusable answers nothing; the next
      // candidate may still answer.
      if (snapshots === undefined) continue;
      const hookEvents = await this.#hookEvents(snapshots);
      return snapshots.map((snapshot) =>
        observationFromSnapshot(
          snapshot,
          hookEvents.get(snapshot.providerSessionId),
          now,
          this.activeSessionFreshnessMs,
        ),
      );
    }
    return [];
  }

  override readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult> {
    return providerTranscriptResult(
      readDevinSessionTranscript({
        cliDirectory: this.#cliDirectory,
        providerSessionId,
        sqlite: this.#sqlite,
        maximumRenderedLength: this.#transcriptMaximumRenderedLength,
      }),
    );
  }

  /** The session rows, or nothing when neither query fits this database. */
  #sessionRows(database: SqliteDatabase): DevinRow[] | undefined {
    for (const query of [DEVIN_SESSION_QUERY, DEVIN_SESSION_QUERY_MINIMAL]) {
      try {
        return database
          .prepare(query)
          .all()
          .filter((row): row is DevinRow => isRecord(row));
      } catch (error) {
        if (!(error instanceof Error) || !canIgnoreSqliteError(error)) throw error;
      }
    }
    return undefined;
  }

  #databaseSnapshots(
    database: SqliteDatabase,
    now: number,
  ): DevinLocalSessionSnapshot[] | undefined {
    const rows = this.#sessionRows(database);
    if (rows === undefined) return undefined;

    const snapshots = rows
      .filter(isObservableSessionRow)
      .map(snapshotFromSessionRow)
      .filter((snapshot): snapshot is DevinLocalSessionSnapshot => snapshot !== undefined);

    // Every reported session gets its turn read, because a session without one
    // would default to working on freshness alone — inventing live work for a
    // row whose turn actually settled. Each read is an indexed walk from one
    // session's tip, so the pass costs one cheap query per row.
    for (const snapshot of snapshots) {
      snapshot.turn = this.#turnFor(database, snapshot);
      if (
        statusFromTurn(snapshot.turn, snapshot.observedAt, now, this.activeSessionFreshnessMs) ===
        SESSION_STATUS.WORKING
      ) {
        snapshot.activity = this.#activityFor(database, snapshot.providerSessionId);
      }
    }
    return snapshots;
  }

  #turnFor(database: SqliteDatabase, snapshot: DevinLocalSessionSnapshot): DevinTurn | undefined {
    const rows =
      snapshot.mainChainId !== undefined
        ? this.#rowsFor(database, DEVIN_CHAIN_QUERY, [
            snapshot.providerSessionId,
            snapshot.mainChainId,
            DEVIN_ADAPTER_DEFAULTS.MAXIMUM_CHAIN_WALK,
          ])
        : this.#rowsFor(database, DEVIN_NEWEST_NODES_QUERY, [
            snapshot.providerSessionId,
            DEVIN_ADAPTER_DEFAULTS.MAXIMUM_CHAIN_WALK,
          ]);
    return turnFromChainRecords(
      rows
        .map((row) => recordFromJsonLine(textFromRow(row, DEVIN_NODE_COLUMN.CHAT_MESSAGE) ?? ""))
        .filter((record): record is WireRecord => record !== undefined),
    );
  }

  #activityFor(database: SqliteDatabase, providerSessionId: string): string | undefined {
    return activityFromToolCallRows(
      this.#rowsFor(database, DEVIN_TOOL_CALL_QUERY, [providerSessionId]),
    );
  }

  /**
   * Reads what the observation hook last said about each session. The spool
   * is a refinement, never a dependency: a directory that is missing,
   * unreadable, or holding something unexpected reads as no event, and the
   * row's own verdict stands.
   */
  async #hookEvents(
    snapshots: readonly DevinLocalSessionSnapshot[],
  ): Promise<Map<string, ObservedDevinHookEvent>> {
    const events = new Map<string, ObservedDevinHookEvent>();
    const hookEventsDirectory = this.#hookEventsDirectory?.();
    if (!hookEventsDirectory) return events;
    await Promise.all(
      snapshots.map(async (snapshot) => {
        const event = await readDevinHookEvent(
          hookEventsDirectory,
          snapshot.providerSessionId,
        ).catch(() => undefined);
        if (event) events.set(snapshot.providerSessionId, event);
      }),
    );
    return events;
  }

  /** A node or tool table this build cannot read costs a field, not the pass. */
  #rowsFor(database: SqliteDatabase, query: string, parameters: readonly unknown[]): DevinRow[] {
    try {
      return database
        .prepare(query)
        .all(...parameters)
        .filter((row): row is DevinRow => isRecord(row));
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    }
  }
}
