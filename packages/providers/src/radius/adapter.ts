import {
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionApplication,
  type SessionProvider,
  type SessionStatus,
  type SessionWorkspace,
} from "@sidecar/session";
import { isRecord, oneLine, recordFromJsonLine, text, type WireRecord } from "@sidecar/wire";
import {
  LocalSessionAdapter,
  type LocalSessionAdapterOptions,
  localSessionStatus,
  workspaceLabel,
} from "../shared/local-session-adapter.js";
import {
  canIgnoreSqliteError,
  defaultSqliteModule,
  numberFromRow,
  openReadOnlyDatabase,
  type SqliteDatabase,
  type SqliteModuleLoader,
  textFromRow,
} from "../shared/local-sqlite.js";
import {
  defaultRadiusHome,
  RADIUS_CONVERSATION_COLUMN,
  RADIUS_EVENT_COLUMN,
  RADIUS_EVENT_KIND,
  RADIUS_MESSAGE_ROLE,
  RADIUS_TURN_COLUMN,
  RADIUS_TURN_STATUS,
  radiusDatabasePath,
  radiusEventPayload,
  radiusToolDetail,
  radiusToolName,
  radiusTurnModel,
} from "./records.js";
import { readRadiusChatTranscript } from "./transcript.js";

const RADIUS_PROVIDER_NAME = "Radius";

export const RADIUS_PROVIDER: SessionProvider = {
  id: PROVIDER_ID.RADIUS,
  displayName: RADIUS_PROVIDER_NAME,
};

const RADIUS_ADAPTER_DEFAULTS = {
  /** How many chats one observation pass reports, newest first. */
  MAXIMUM_CONVERSATIONS: 200,
  /**
   * How far back into a turn's events one pass looks for the tool still
   * running, the agent's closing words, and the clock proving the turn is
   * still moving. All three stand at the turn's tip, so the newest events are
   * the whole answer; the bound is what keeps a long turn's history off the
   * read. A turn whose closing words fall further back than this reports no
   * recap rather than an older line dressed as its outcome.
   */
  MAXIMUM_TURN_EVENTS: 40,
  MAXIMUM_ACTIVITY_LENGTH: 80,
} as const;

const RADIUS_CONVERSATIONS_QUERY = `
  SELECT conversation_id, label, project_id, project_label, project_path,
         updated_at, last_message_at
  FROM chat_conversations
  WHERE archived = 0
  ORDER BY updated_at DESC
  LIMIT ?
`;

const RADIUS_NEWEST_TURN_QUERY = `
  SELECT id, status, model, created_at, completed_at, error
  FROM turns
  WHERE conversation_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`;

const RADIUS_TURN_EVENTS_QUERY = `
  SELECT kind, payload_json, created_at
  FROM events
  WHERE turn_id = ?
  ORDER BY seq DESC
  LIMIT ?
`;

/**
 * The Radius mark rides as the chat's own app association, the way Conductor's
 * and Replicas' do, because the row itself is led by the agent that runs the
 * chat: without it a Radius chat would be indistinguishable from a bare local
 * one. It is workspace-scoped, on the reasoning Replicas states — the
 * association belongs to the project the chats sit in rather than to any one
 * of them — and carries no address, because Radius registers no deep link
 * that lands on a chat.
 */
const RADIUS_APPLICATIONS: readonly SessionApplication[] = [
  {
    id: SESSION_APPLICATION_ID.RADIUS,
    displayName: RADIUS_PROVIDER_NAME,
    scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
  },
];

/** What the newest turn's own row says about where the chat stands. */
interface RadiusTurn {
  turnId: string;
  /** The turn ran to its own end, which is what lets its words be a recap. */
  completed: boolean;
  /** The turn is over, however it ended. */
  settled: boolean;
  atMs: number;
  model?: string;
  agent?: SessionProvider;
  failure?: string;
}

/** What the turn's newest events say the agent is doing and last said. */
interface RadiusTurnTip {
  activity?: string;
  recap?: string;
  /**
   * The newest event's own stamp. It is the only proof a long turn is still
   * moving: Radius stamps the conversation and the turn row at turn
   * boundaries, so a turn that has run for an hour still carries the clock it
   * started with, and dating the row by that alone would decay live work to
   * unknown while its tools were still landing.
   */
  atMs?: number;
}

interface RadiusChat {
  providerSessionId: string;
  title?: string;
  directory?: string;
  workspace?: SessionWorkspace;
  repository: string;
  observedAt: number;
  turn?: RadiusTurn;
  tip?: RadiusTurnTip;
}

function turnFromRow(row: WireRecord): RadiusTurn | undefined {
  const turnId = textFromRow(row, RADIUS_TURN_COLUMN.ID);
  if (!turnId) return undefined;
  const completedAtMs = numberFromRow(row, RADIUS_TURN_COLUMN.COMPLETED_AT);
  const createdAtMs = numberFromRow(row, RADIUS_TURN_COLUMN.CREATED_AT) ?? 0;
  return {
    turnId,
    // A turn's own row settles it: `completed_at` is written whatever ended
    // it, so a status word this build has never seen still reads as over
    // rather than as work that is somehow still running.
    settled: completedAtMs !== undefined,
    completed: textFromRow(row, RADIUS_TURN_COLUMN.STATUS) === RADIUS_TURN_STATUS.COMPLETED,
    atMs: Math.max(completedAtMs ?? 0, createdAtMs),
    ...radiusTurnModel(textFromRow(row, RADIUS_TURN_COLUMN.MODEL)),
    ...(textFromRow(row, RADIUS_TURN_COLUMN.ERROR)
      ? {
          failure: oneLine(
            textFromRow(row, RADIUS_TURN_COLUMN.ERROR),
            RADIUS_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH,
          ),
        }
      : undefined),
  };
}

/**
 * The turn's tip, read from its newest events backwards. The tool still
 * running is the newest `tool.started` reached before any `tool.completed` —
 * a settled call newest means the turn has moved past its tools — and the
 * closing words are the newest message the agent itself completed. Radius
 * writes the developer's own messages into the same stream, so the role is
 * checked: only the agent's words may become a recap.
 */
function tipFromEvents(events: readonly WireRecord[]): RadiusTurnTip {
  let activity: string | undefined;
  let toolsSettled = false;
  let recap: string | undefined;
  let atMs: number | undefined;
  for (const row of events) {
    const stamp = numberFromRow(row, RADIUS_EVENT_COLUMN.CREATED_AT);
    // Every event in the slice proved the turn moved when it was written, so
    // the newest stamp is the turn's own clock however the slice is ordered.
    if (stamp !== undefined && (atMs === undefined || stamp > atMs)) atMs = stamp;
    const kind = textFromRow(row, RADIUS_EVENT_COLUMN.KIND);
    const event = recordFromJsonLine(textFromRow(row, RADIUS_EVENT_COLUMN.PAYLOAD_JSON) ?? "");
    const payload = event ? radiusEventPayload(event) : undefined;
    if (kind === RADIUS_EVENT_KIND.TOOL_COMPLETED) toolsSettled = true;
    if (kind === RADIUS_EVENT_KIND.TOOL_STARTED && !toolsSettled && payload) {
      toolsSettled = true;
      const name = radiusToolName(payload);
      if (name) {
        const detail = radiusToolDetail(payload, RADIUS_ADAPTER_DEFAULTS.MAXIMUM_ACTIVITY_LENGTH);
        activity = detail ? `${name}: ${detail}` : name;
      }
    }
    if (kind === RADIUS_EVENT_KIND.MESSAGE_COMPLETED && recap === undefined && payload) {
      if (text(payload.role) === RADIUS_MESSAGE_ROLE.ASSISTANT) {
        recap = oneLine(text(payload.text), maximumSessionRecapLength);
      }
    }
  }
  return {
    ...(activity ? { activity } : undefined),
    ...(recap ? { recap } : undefined),
    ...(atMs !== undefined ? { atMs } : undefined),
  };
}

/**
 * A turn the runtime recorded a failure for is stuck until someone comes back
 * to it. A turn that is over any other way is the developer's move. A turn
 * still open is working, and a killed browser leaves its last turn open on
 * disk forever, so an open turn gone quiet decays to unknown rather than
 * claiming live work. A chat that has never run a turn is idle in the same
 * way a settled one is: nothing marks a Radius chat closed, so it is never
 * complete.
 */
function statusFromTurn(
  turn: RadiusTurn | undefined,
  observedAt: number,
  now: number,
  freshnessMs: number,
): SessionStatus {
  if (turn?.failure) return SESSION_STATUS.ERROR;
  const working = turn !== undefined && !turn.settled;
  return localSessionStatus(
    working ? SESSION_STATUS.WORKING : SESSION_STATUS.WAITING,
    observedAt,
    now,
    freshnessMs,
  );
}

function chatFromRow(row: WireRecord): RadiusChat | undefined {
  const providerSessionId = textFromRow(row, RADIUS_CONVERSATION_COLUMN.CONVERSATION_ID);
  if (!providerSessionId) return undefined;
  const directory = textFromRow(row, RADIUS_CONVERSATION_COLUMN.PROJECT_PATH);
  const projectId = textFromRow(row, RADIUS_CONVERSATION_COLUMN.PROJECT_ID);
  const projectLabel = textFromRow(row, RADIUS_CONVERSATION_COLUMN.PROJECT_LABEL);
  return {
    providerSessionId,
    title: textFromRow(row, RADIUS_CONVERSATION_COLUMN.LABEL),
    ...(directory ? { directory } : undefined),
    // Radius opens chats inside a project and keeps several of them there, so
    // the project is the group the rows belong under rather than a label the
    // row repeats.
    ...(projectId
      ? {
          workspace: {
            providerWorkspaceId: projectId,
            ...(projectLabel ? { name: projectLabel } : undefined),
          },
        }
      : undefined),
    repository: projectLabel?.trim() || workspaceLabel(directory),
    observedAt: Math.max(
      numberFromRow(row, RADIUS_CONVERSATION_COLUMN.UPDATED_AT) ?? 0,
      numberFromRow(row, RADIUS_CONVERSATION_COLUMN.LAST_MESSAGE_AT) ?? 0,
    ),
  };
}

function observationFromChat(
  chat: RadiusChat,
  now: number,
  activeSessionFreshnessMs: number,
): ProviderSessionObservation {
  const observedAt = Math.max(chat.observedAt, chat.turn?.atMs ?? 0, chat.tip?.atMs ?? 0);
  const status = statusFromTurn(chat.turn, observedAt, now, activeSessionFreshnessMs);
  // Only the words of a turn that ran to its own end: a turn the developer
  // stopped was cut mid-thought, so its trailing words pose as an outcome the
  // chat never reached, and a turn still running describes the turn before.
  const recap =
    chat.turn?.settled === true && chat.turn.completed && !chat.turn.failure
      ? chat.tip?.recap
      : undefined;
  return {
    providerSessionId: chat.providerSessionId,
    title: oneLine(chat.title, maximumSessionTitleLength) ?? chat.repository,
    status,
    observedAt,
    ...(chat.turn?.agent ? { agent: chat.turn.agent } : undefined),
    ...(recap ? { recap } : undefined),
    ...(chat.directory ? { directory: chat.directory } : undefined),
    ...(chat.workspace ? { workspace: chat.workspace } : undefined),
    applications: RADIUS_APPLICATIONS,
    detail: {
      ...(chat.turn?.settled === false && chat.tip?.activity
        ? { activity: chat.tip.activity }
        : undefined),
      repository: chat.repository,
      ...(chat.turn?.model ? { model: chat.turn.model } : undefined),
      ...(chat.turn?.failure ? { error: chat.turn.failure } : undefined),
    },
  };
}

export interface RadiusAdapterOptions extends LocalSessionAdapterOptions {
  radiusHome?: string;
  transcriptMaximumRenderedLength?: number;
  sqlite?: SqliteModuleLoader;
}

/**
 * Observes the Radius browser's agent chats from the database it already
 * writes for itself. It runs no server, needs no credential, registers no
 * hook, and opens the database read-only.
 *
 * Radius is a host rather than an agent, the way Conductor and Replicas are:
 * every row is a chat led by the Claude Code, Codex, or Cursor agent its own
 * turn names, grouped under the project it was opened in, wearing the Radius
 * mark. Nothing is written back — the browser's CLI exposes tabs, windows,
 * and groups and no agent resource at all, and the one URL scheme it
 * registers is an authentication callback — so a chat advertises no control,
 * takes no message, and reports no address, and pressing its row opens Luke's
 * own panel.
 */
export class RadiusSessionAdapter extends LocalSessionAdapter {
  readonly provider = RADIUS_PROVIDER;

  readonly #radiusHome: string;
  readonly #sqlite: SqliteModuleLoader;
  readonly #transcriptMaximumRenderedLength: number | undefined;

  constructor(options: RadiusAdapterOptions = {}) {
    super(options);
    this.#radiusHome = options.radiusHome ?? defaultRadiusHome();
    this.#sqlite = options.sqlite ?? defaultSqliteModule;
    this.#transcriptMaximumRenderedLength = options.transcriptMaximumRenderedLength;
  }

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    const database = await openReadOnlyDatabase(this.#sqlite, radiusDatabasePath(this.#radiusHome));
    if (!database) return [];
    try {
      const now = this.observationTime();
      const chats = this.#chats(database);
      return chats.map((chat) => observationFromChat(chat, now, this.activeSessionFreshnessMs));
    } finally {
      database.close();
    }
  }

  override readTranscript(providerSessionId: string): Promise<string | undefined> {
    return readRadiusChatTranscript({
      radiusHome: this.#radiusHome,
      providerSessionId,
      sqlite: this.#sqlite,
      maximumRenderedLength: this.#transcriptMaximumRenderedLength,
    });
  }

  /** The chats the database holds, each with the state of its newest turn. */
  #chats(database: SqliteDatabase): RadiusChat[] {
    const chats = this.#rows(database, RADIUS_CONVERSATIONS_QUERY, [
      RADIUS_ADAPTER_DEFAULTS.MAXIMUM_CONVERSATIONS,
    ])
      .map(chatFromRow)
      .filter((chat): chat is RadiusChat => chat !== undefined);
    // Every chat gets its newest turn read, because a chat without one would
    // report as working on freshness alone — inventing live work for a row
    // whose turn actually settled. Each read is an indexed point query
    // against one conversation's id, not a scan.
    for (const chat of chats) {
      const turn = this.#rows(database, RADIUS_NEWEST_TURN_QUERY, [chat.providerSessionId])
        .map(turnFromRow)
        .find((candidate): candidate is RadiusTurn => candidate !== undefined);
      if (!turn) continue;
      chat.turn = turn;
      chat.tip = tipFromEvents(
        this.#rows(database, RADIUS_TURN_EVENTS_QUERY, [
          turn.turnId,
          RADIUS_ADAPTER_DEFAULTS.MAXIMUM_TURN_EVENTS,
        ]),
      );
    }
    return chats;
  }

  /**
   * A table or column this build does not know costs the rows it asked for,
   * never the pass: Radius owns this schema and may move it, and the honest
   * answer to a store shaped differently is the one an absent store gives.
   */
  #rows(
    database: SqliteDatabase,
    query: string,
    parameters: readonly unknown[],
  ): readonly WireRecord[] {
    try {
      return database
        .prepare(query)
        .all(...parameters)
        .filter(isRecord);
    } catch (error) {
      if (error instanceof Error && canIgnoreSqliteError(error)) return [];
      throw error;
    }
  }
}
