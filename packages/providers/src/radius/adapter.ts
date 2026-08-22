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
   * How many chat rows one pass loads before ranking them. It stands well
   * above the number reported because the conversation clock this read orders
   * by is stamped at turn boundaries: a chat can be live and still rank below
   * chats touched more recently, so the read has to reach past the reported
   * count for the ranking to have anything to correct. The bound exists only
   * so a store nobody has ever pruned cannot cost unbounded memory.
   */
  MAXIMUM_CONVERSATION_ROWS: 1_000,
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

/**
 * Every chat's newest turn, in one read. Radius indexes `turns` by its own id
 * and by request id alone — nothing on `conversation_id` — so asking per chat
 * is a full scan of the table each time, and a roster of two hundred chats
 * would scan it two hundred times a pass. The grouped join pays for one.
 */
const RADIUS_NEWEST_TURNS_QUERY = `
  SELECT turns.conversation_id AS conversation_id, turns.id AS id,
         turns.status AS status, turns.model AS model,
         turns.created_at AS created_at, turns.completed_at AS completed_at,
         turns.error AS error
  FROM turns
  JOIN (
    SELECT conversation_id, MAX(created_at) AS newest_at
    FROM turns
    GROUP BY conversation_id
  ) newest
    ON newest.conversation_id = turns.conversation_id
   AND newest.newest_at = turns.created_at
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
 * that lands on a chat. Workspace scope is only half the arrangement: a tray
 * hides a workspace-scoped chip on its rows and names the manager once on its
 * own header instead, so the workspace has to carry `scopeId` and
 * `managerName` too or two chats in one project lose every trace of Radius
 * between them — the exact reading this mark exists to prevent.
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
            scopeId: PROVIDER_ID.RADIUS,
            managerName: RADIUS_PROVIDER_NAME,
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

/**
 * The chats one pass reports, newest first. The ranking runs here rather than
 * in the read because the clock the read can order by — the conversation's
 * own `updated_at` — is stamped at turn boundaries, so a chat can be an hour
 * into live work and still sort below chats nobody has touched since. Ranking
 * on the turn's clock as well corrects that, and a chat whose newest turn has
 * not settled is kept whatever it ranks: an unsettled turn is the one state
 * where dropping the row would hide work actually happening.
 */
function reportedChats(chats: readonly RadiusChat[]): RadiusChat[] {
  const ranked = [...chats].sort(
    (left, right) =>
      chatClockMs(right) - chatClockMs(left) ||
      left.providerSessionId.localeCompare(right.providerSessionId),
  );
  const reported = ranked.slice(0, RADIUS_ADAPTER_DEFAULTS.MAXIMUM_CONVERSATIONS);
  const held = new Set(reported.map((chat) => chat.providerSessionId));
  const live = ranked
    .slice(RADIUS_ADAPTER_DEFAULTS.MAXIMUM_CONVERSATIONS)
    .filter(
      (chat) => chat.turn !== undefined && !chat.turn.settled && !held.has(chat.providerSessionId),
    );
  return [...reported, ...live];
}

function chatClockMs(chat: RadiusChat): number {
  return Math.max(chat.observedAt, chat.turn?.atMs ?? 0);
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
      RADIUS_ADAPTER_DEFAULTS.MAXIMUM_CONVERSATION_ROWS,
    ])
      .map(chatFromRow)
      .filter((chat): chat is RadiusChat => chat !== undefined);
    // Every chat gets its newest turn, because a chat without one would report
    // as working on freshness alone — inventing live work for a row whose turn
    // actually settled.
    const turns = new Map<string, RadiusTurn>();
    for (const row of this.#rows(database, RADIUS_NEWEST_TURNS_QUERY, [])) {
      const conversationId = textFromRow(row, RADIUS_TURN_COLUMN.CONVERSATION_ID);
      const turn = turnFromRow(row);
      // Two turns of one chat can share a created_at, and the grouped read
      // answers with both; the first stands rather than a coin toss.
      if (conversationId && turn && !turns.has(conversationId)) turns.set(conversationId, turn);
    }
    for (const chat of chats) {
      chat.turn = turns.get(chat.providerSessionId);
    }
    // Only the chats that survive the cap pay for an events read.
    const reported = reportedChats(chats);
    for (const chat of reported) {
      if (!chat.turn) continue;
      chat.tip = tipFromEvents(
        this.#rows(database, RADIUS_TURN_EVENTS_QUERY, [
          chat.turn.turnId,
          RADIUS_ADAPTER_DEFAULTS.MAXIMUM_TURN_EVENTS,
        ]),
      );
    }
    return reported;
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
