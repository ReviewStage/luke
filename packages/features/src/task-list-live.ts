import { Schema as EffectSchema } from "effect";
import {
  agentStatusAt,
  lineAwaitsTurn,
  type StatusTurn,
  statusClockEdge,
  turnStoppable,
} from "./agent-status.js";
import {
  AGENT_BRIEF,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentArchivedBy,
  type AgentStatus,
  type AgentSummary,
  agentArchiverSchema,
  agentOwnerOf,
  agentPullRequestSchema,
  agentSourceSchema,
  agentSummarySchema,
  CONTEXT_WINDOW,
  type ListedAgent,
  NATIVE_AGENT_RUNTIMES,
  PULL_REQUEST_STATE,
  pullRequestAuthorOf,
  type TasklessAgent,
} from "./agent-wire.js";
import { integrationConnectionOf } from "./integration-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { readMarkOf } from "./read-mark.js";
import { countedNumber } from "./service-wire.js";
import { standingFailures } from "./task-agents-model.js";
import {
  DESCRIPTION_ACTOR,
  type ListedPullRequest,
  type TaskAgentPin,
  type TaskAgentsSummary,
  type TaskListAnswer,
  type TaskOrigin,
  type TaskPullRequestLine,
  type TaskPullRequests,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
  taskSummarySchema,
} from "./task-wire.js";

/**
 * task-list-live.ts -- the plan list followed over Neon Realtime: the sealed statements the service answers, the rows they deliver, and the list as the held read answers it, built from them at an instant.
 *
 * The plan list is two statements: the plans the account reaches, each with
 * its reader's own pin and its owner's name, and every agent of those plans
 * and every agent with no plan in the account's workspaces, archived ones
 * among them, each with its newest turn, whether a line of the developer's
 * awaits its turn, what it last published, and the names of the members it
 * names. A third, the issues those plans linked (`issues`), answers no rows
 * now that a plan links none, and stands because a released desktop
 * requires it. Everything the held read derives from them is derived here, at
 * the instant the reader reads at, since an agent's status turns on the
 * clock (`agent-status.ts`): a drawing's `edge` is the next instant the
 * clock alone moves the list, which the reader draws it again at, and a
 * reader that draws it again and again (`taskListDrawer`) builds again only
 * what a row that moved, or that edge, reaches. Realtime keeps no order, so
 * the list is ordered here as the held read orders it.
 */

/** The plan list sealed for following: the address, and its statements. The service answers `unavailable` where its deployment's Realtime is misconfigured. */
export const taskListLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    plans: sealedLiveQuerySchema,
    agents: sealedLiveQuerySchema,
    /** The issues plans linked: no rows, for a released desktop that follows it. */
    issues: sealedLiveQuerySchema,
  }),
});

export type TaskListLiveAnswer = typeof taskListLiveAnswerSchema.Type;

const plan = taskSummarySchema.fields;

/** One plan as its row delivers it: the reader's own pin and the owner's name beside it, null where none stands. */
const taskLiveRowSchema = EffectSchema.Struct({
  id: plan.id,
  workspaceId: plan.workspaceId,
  name: plan.name,
  repository: plan.repository,
  ownerId: EffectSchema.String,
  ownerName: EffectSchema.NullOr(EffectSchema.String),
  assigneeId: EffectSchema.NullOr(EffectSchema.String),
  assigneeName: EffectSchema.NullOr(EffectSchema.String),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  /** The reader's read mark (`read-mark.ts`); absent from a service before read marks were kept. */
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Absent from a service before it kept when a task was finished. */
  completedAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  createdAt: countedNumber,
  updatedAt: countedNumber,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  /** The task's number in its workspace, from 1, as the list says it; absent from a row the host draws for a task it started before the service numbered it. */
  number: EffectSchema.optionalKey(EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1))),
  /** Who made the task for its owner (`DESCRIPTION_ACTOR`); absent from a service before it was sent, read as made by hand. */
  creatorActor: EffectSchema.optionalKey(
    EffectSchema.Literals([
      DESCRIPTION_ACTOR.DEVELOPER,
      DESCRIPTION_ACTOR.NOTETAKER,
      DESCRIPTION_ACTOR.AGENT,
    ]),
  ),
  /** The coding agent that made the task; null for any other maker and once its row is gone. */
  creatorAgentId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  /** The task this one is a child of; null for a task at the top. Absent from a service before child tasks. */
  parentTaskId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  /** How the task is worked; absent from a service before modes. */
  mode: plan.mode,
  /** Whether it waits on an open task the reader reaches; absent from a service before blocks. */
  blocked: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Whether an automation's run made it for itself alone; absent from a service before it. */
  madeByRun: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** Who archived an agent as its row holds it. */
const archiveLiveSchema = EffectSchema.Struct({
  by: agentArchiverSchema,
  userId: EffectSchema.String,
  agentId: EffectSchema.optionalKey(EffectSchema.String),
  agentName: EffectSchema.optionalKey(EffectSchema.String),
  reason: EffectSchema.optionalKey(EffectSchema.String),
  withTask: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** One agent as its row delivers it: its own columns, its newest turn's, and what stands beside it, null where none does. */
const agentLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  planId: EffectSchema.NullOr(EffectSchema.String),
  workspaceId: EffectSchema.String,
  model: EffectSchema.String,
  effort: EffectSchema.String,
  contextWindow: EffectSchema.NullOr(EffectSchema.String),
  title: EffectSchema.NullOr(EffectSchema.String),
  /** Whether the agent is its task's pilot; absent from a statement before pilots. */
  pilot: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** Whether the agent was handed a prompt rather than its description. */
  /** What the agent was handed as its first message: the description, the developer's prompt, or nothing, for one started blank. */
  brief: EffectSchema.Literals(Object.values(AGENT_BRIEF)),
  /** The repository the agent works in; null for one that works in none. */
  repository: EffectSchema.NullOr(EffectSchema.String),
  starterId: EffectSchema.String,
  starterName: EffectSchema.NullOr(EffectSchema.String),
  /** The pilot that started the agent, by its id, task, title, and model; null where no pilot did, and absent from a statement before it was carried. */
  starterPilotId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotTaskId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotTitle: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotModel: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  automationId: EffectSchema.NullOr(EffectSchema.String),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  /** The run the agent belongs to, and the automation that run belongs to; null where it belongs to none, and absent from a statement before they were carried. */
  runId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  runAutomationId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  archivedAt: EffectSchema.NullOr(countedNumber),
  archivedBy: EffectSchema.NullOr(archiveLiveSchema),
  archiverName: EffectSchema.NullOr(EffectSchema.String),
  disabledServers: EffectSchema.NullOr(EffectSchema.Array(EffectSchema.String)),
  published: EffectSchema.NullOr(agentPullRequestSchema),
  /** The agent this one continues or forks, as its summary's `from` says it. */
  startedFrom: EffectSchema.NullOr(agentSummarySchema.fields.from.schema),
  /** What outside the app the agent was started from, as its summary's `source` says it; absent from a statement before it was carried. */
  source: EffectSchema.optionalKey(EffectSchema.NullOr(agentSourceSchema)),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  /** The reader's read mark (`read-mark.ts`); absent from a service before read marks were kept. */
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  createdAt: countedNumber,
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  /** When the newest turn's Stop was asked; absent from a statement before it was carried. */
  cancelRequestedAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  queuedAt: EffectSchema.NullOr(countedNumber),
  startedAt: EffectSchema.NullOr(countedNumber),
  settledAt: EffectSchema.NullOr(countedNumber),
  /** Until when the newest turn's runner is held to be at work; absent from a statement before it was carried. */
  leaseUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  turnSessionEnded: EffectSchema.NullOr(EffectSchema.Boolean),
  awaitingLineAt: EffectSchema.NullOr(countedNumber),
  /** When the newest turn to end ended, the newest turn's own end being null while it runs; absent from a statement before it was carried. */
  lastSettledAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  /** The harness the agent's conversation runs on, as it was started; absent from a statement before it was carried, as is each below. */
  runtime: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  /** Where the agent's runner lives (`AGENT_MACHINE`). */
  machine: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  /** The Mac a local agent runs on, by its id and its name; null for an agent in a sandbox, or whose Mac is gone. */
  deviceId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  deviceName: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  /** Whether the agent's conversation records its sandbox's session; absent from a statement before it was carried. */
  sandboxOpen: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** The plan list's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const taskListLiveRowsSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(taskLiveRowSchema),
  agents: EffectSchema.Array(agentLiveRowSchema),
});

export type TaskListLiveRows = typeof taskListLiveRowsSchema.Type;

type TaskLiveRow = typeof taskLiveRowSchema.Type;
type AgentLiveRow = typeof agentLiveRowSchema.Type;

/** The statuses under which an agent is at work. */
const WORKING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** The order a plan's pull requests stand in: those still to act on first, then merged, then closed. */
const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<TaskPullRequestLine["state"], number>;

/** Newest started first, and by id among those started at one instant, as the held read orders plans and agents with no plan. */
function newestFirst<Row extends { readonly id: string; readonly createdAt: number }>(
  a: Row,
  b: Row,
): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The newest turn as the status rule reads it; none where the agent has none. */
function turnOf(row: AgentLiveRow): StatusTurn | undefined {
  return row.turnId === null || row.turnStatus === null
    ? undefined
    : {
        status: row.turnStatus,
        cancelRequested: row.cancelRequested === true,
        cancelRequestedAt: row.cancelRequestedAt ?? undefined,
        queuedAt: row.queuedAt ?? row.createdAt,
        settledAt: row.settledAt,
        sessionEnded: row.turnSessionEnded === true,
        leaseUntil: row.leaseUntil ?? undefined,
      };
}

/** Where the agent stands at `now`, as the status rule reads it: its Start, its newest awaiting line where one stands, and whether it was started blank. */
function standingOf(row: AgentLiveRow, now: number) {
  return {
    createdAt: row.createdAt,
    now,
    awaitingLineAt: row.awaitingLineAt ?? undefined,
    blank: row.brief === AGENT_BRIEF.BLANK,
  };
}

function statusOf(row: AgentLiveRow, now: number): AgentStatus {
  return agentStatusAt(turnOf(row), standingOf(row, now));
}

/** When the run the status is read from began: the newest turn's start, or its queueing, the agent's own before any turn, and none while a line awaits its turn. */
function runStartedAt(row: AgentLiveRow, now: number): number | undefined {
  if (lineAwaitsTurn(turnOf(row), standingOf(row, now))) return undefined;
  return turnOf(row) === undefined ? row.createdAt : (row.startedAt ?? row.queuedAt ?? undefined);
}

/** When the agent last did something settled, as the service's `agentActivityAt` reads it: its start, or its newest turn to end's end, whichever is later; a turn's start is none. A statement from before that end was carried names the newest turn's own. */
function activityAt(row: AgentLiveRow): number {
  return Math.max(row.createdAt, row.lastSettledAt ?? row.settledAt ?? 0);
}

/** Newest started first, and the first started among those of one instant, as the held read sums a plan's agents. */
function newestStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every pull request a plan's agents opened, the archived agents' left out,
 * each once by its page: those still open first, the newest agent's first
 * within a rank, every one of them.
 */
function pullRequestLinesOf(rows: readonly AgentLiveRow[]): readonly TaskPullRequestLine[] {
  const pullRequests = new Map<string, TaskPullRequestLine>();
  for (const row of rows.filter((each) => each.archivedAt === null).toSorted(newestStarted)) {
    const { published } = row;
    if (published === null || pullRequests.has(published.url)) continue;
    const { number, title, state, checks, additions, deletions, url } = published;
    pullRequests.set(url, {
      number,
      title,
      state,
      checks,
      additions,
      deletions,
      url,
      agentId: row.id,
      ...(published.queued === true ? { queued: true } : undefined),
      ...pullRequestAuthorOf(published),
    });
  }
  return [...pullRequests.values()].toSorted(
    (a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state],
  );
}

/** One plan's agents, in the order the rows name them, and every pull request they opened (`pullRequestLinesOf`). */
interface AgentGroup {
  readonly agents: readonly AgentLiveRow[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

/**
 * One plan's agents counted, as the held read counts them: the archived
 * left out, how many are at work and how many failed with no agent
 * started since (`standingFailures`), how many pull
 * requests they opened, and the latest settled activity of every agent,
 * archived or not. The agents and pull requests themselves are the
 * drawing's `taskAgents` and `taskPullRequests`.
 */
function agentsSummaryOf(group: AgentGroup, now: number): TaskAgentsSummary {
  const { agents: rows, pullRequests } = group;
  const standing = rows
    .filter((row) => row.archivedAt === null)
    .map((row) => ({
      createdAt: row.createdAt,
      status: statusOf(row, now),
      at: turnOf(row) === undefined ? undefined : (row.settledAt ?? undefined),
    }));
  return {
    total: standing.length,
    working: standing.filter(({ status }) => WORKING_STATUSES.has(status)).length,
    failed: standingFailures(standing, Math.max(...rows.map((row) => row.createdAt))),
    ...(rows.length === 0 ? undefined : { activityAt: Math.max(...rows.map(activityAt)) }),
    pullRequestTotal: pullRequests.length,
  };
}

/** Who made a task for its owner, as the summary names them: nothing for a task made by hand. */
function originOf(row: TaskLiveRow): { readonly origin?: TaskOrigin } {
  const actor = row.creatorActor;
  if (actor === undefined || actor === DESCRIPTION_ACTOR.DEVELOPER) return {};
  const agentId = row.creatorAgentId;
  return {
    origin: { actor, ...(agentId === undefined || agentId === null ? undefined : { agentId }) },
  };
}

/** One plan as the list's row says it, its agents in brief where it has any. */
function taskSummaryOf(row: TaskLiveRow, agents: AgentGroup | undefined, now: number): TaskSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    repository: row.repository,
    openedAt: row.createdAt,
    ownerId: row.ownerId,
    ...(row.ownerName === null
      ? undefined
      : { createdBy: { userId: row.ownerId, name: row.ownerName } }),
    ...originOf(row),
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt }),
    ...(row.pinnedAt === null || row.pinPosition === null
      ? undefined
      : { pinPosition: row.pinPosition }),
    ...readMarkOf(row),
    ...(row.completedAt === undefined || row.completedAt === null
      ? undefined
      : { completedAt: row.completedAt }),
    status: row.status,
    priority: row.priority,
    ...(row.number === undefined ? undefined : { number: row.number }),
    ...(row.assigneeId === null || row.assigneeName === null
      ? undefined
      : { assignee: { userId: row.assigneeId, name: row.assigneeName } }),
    ...(row.parentTaskId === undefined || row.parentTaskId === null
      ? undefined
      : { parentTaskId: row.parentTaskId }),
    ...(row.mode === undefined ? undefined : { mode: row.mode }),
    ...(row.blocked === true ? { blocked: true } : undefined),
    ...(row.madeByRun === true ? { madeByRun: true } : undefined),
    ...(agents === undefined ? undefined : { agents: agentsSummaryOf(agents, now) }),
  };
}

/** Who archived an agent as its banner says it: the member where their account stands, the agent acting for them, and why. */
function archivedByOf(row: AgentLiveRow): AgentArchivedBy | undefined {
  const archive = row.archivedBy;
  if (row.archivedAt === null || archive === null) return undefined;
  return {
    by: archive.by,
    ...(row.archiverName === null
      ? undefined
      : { member: { userId: archive.userId, name: row.archiverName } }),
    ...(archive.agentId === undefined
      ? undefined
      : { agent: { id: archive.agentId, name: archive.agentName ?? "" } }),
    ...(archive.reason === undefined ? undefined : { reason: archive.reason }),
    ...(archive.withTask === true ? { withTask: true } : undefined),
  };
}

/** The agents started from an agent, first started first, as its summary's `continuedBy` names them. */
type ContinuedBy = NonNullable<AgentSummary["continuedBy"]>;

/** An agent started from another as that one's summary names it among its continues and forks, `messageId` the message a fork was made at. */
function continuationOf(row: AgentLiveRow, messageId: string | undefined): ContinuedBy[number] {
  return messageId === undefined
    ? { agentId: row.id, title: row.title, forked: false }
    : { agentId: row.id, title: row.title, forked: true, messageId };
}

/** The Mac a local agent runs on as its summary names it, with no beat; none for one in a sandbox, or whose Mac is gone. */
/** The pilot that started the agent, as its summary names it; none where no pilot did. */
function startedByPilotOf(row: AgentLiveRow): AgentSummary["startedByPilot"] {
  const { starterPilotId, starterPilotTaskId, starterPilotModel } = row;
  if (starterPilotId == null || starterPilotTaskId == null || starterPilotModel == null) {
    return undefined;
  }
  return {
    agentId: starterPilotId,
    taskId: starterPilotTaskId,
    title: row.starterPilotTitle ?? null,
    model: starterPilotModel,
  };
}

function macOf(row: AgentLiveRow): AgentSummary["mac"] {
  const { deviceId, deviceName } = row;
  if (row.machine !== AGENT_MACHINE.DEVICE || deviceId == null || deviceName == null) {
    return undefined;
  }
  return { name: deviceName, deviceId };
}

/** One agent as the tabs draw it, on a plan or with none, its status read at `now`, as the service's summary of it says it, with the agents `continuedBy` from it. */
function agentSummaryOf(
  row: AgentLiveRow,
  now: number,
  continuedBy: ContinuedBy | undefined,
): AgentSummary {
  const servers = (row.disabledServers ?? []).filter(
    (name) => integrationConnectionOf(name) !== undefined,
  );
  const archivedBy = archivedByOf(row);
  const started = runStartedAt(row, now);
  const status = statusOf(row, now);
  const stoppable = status !== AGENT_STATUS.RUNNING || turnStoppable(turnOf(row));
  const runtime = NATIVE_AGENT_RUNTIMES.find((each) => each === row.runtime);
  const mac = macOf(row);
  const startedByPilot = startedByPilotOf(row);
  const owner = agentOwnerOf({
    taskId: row.planId,
    runId: row.runId ?? null,
    runAutomationId: row.runAutomationId ?? null,
  });
  return {
    id: row.id,
    planId: row.planId,
    model: row.model,
    effort: row.effort,
    ...(row.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: CONTEXT_WINDOW.STANDARD }
      : undefined),
    ...(runtime === undefined ? undefined : { runtime }),
    title: row.title,
    ...(row.pilot === true ? { pilot: true } : undefined),
    ...(row.machine === AGENT_MACHINE.DEVICE ? { machine: AGENT_MACHINE.DEVICE } : undefined),
    ...(mac === undefined ? undefined : { mac }),
    createdAt: row.createdAt,
    status,
    turnId: row.turnId,
    brief: row.brief,
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt }),
    ...(archivedBy === undefined ? undefined : { archivedBy }),
    ...(servers.length === 0 ? undefined : { disabledServers: servers }),
    ...(row.starterName === null
      ? undefined
      : { startedBy: { userId: row.starterId, name: row.starterName } }),
    ...(startedByPilot === undefined ? undefined : { startedByPilot }),
    ...(row.automationId === null ? undefined : { automationId: row.automationId }),
    ...(row.automationName === null ? undefined : { automationName: row.automationName }),
    ...(row.source == null ? undefined : { source: row.source }),
    ...(owner === undefined ? undefined : { owner }),
    ...(row.startedFrom === null ? undefined : { from: row.startedFrom }),
    ...(continuedBy === undefined ? undefined : { continuedBy }),
    ...(started === undefined ? undefined : { runStartedAt: started }),
    ...(stoppable ? undefined : { stoppable: false }),
    ...(row.sandboxOpen === undefined ? undefined : { sandboxOpen: row.sandboxOpen }),
  };
}

/** An agent with no plan as the list carries it, as its own page reads it, its status read at `now`. */
function tasklessAgentOf(
  row: AgentLiveRow,
  now: number,
  continuedBy: ContinuedBy | undefined,
): TasklessAgent {
  return {
    ...agentSummaryOf(row, now, continuedBy),
    planId: null,
    automationId: row.automationId,
    workspaceId: row.workspaceId,
    repository: row.repository,
    activityAt: activityAt(row),
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt }),
    ...(row.pinnedAt === null || row.pinPosition === null
      ? undefined
      : { pinPosition: row.pinPosition }),
    ...readMarkOf(row),
    ...pullRequestOf(row.published),
  };
}

/** An agent's pull request as its sidebar row carries it, where it opened one, as the held list projects it. */
function pullRequestOf(published: AgentLiveRow["published"]) {
  if (published === null) return undefined;
  const { number, title, url, state, checks, queued } = published;
  return {
    pullRequest: {
      number,
      title,
      url,
      state,
      checks,
      ...(queued === true ? { queued } : undefined),
    },
  };
}

/** One agent on a plan as the list carries it, its status read at `now`, with its own workspace and repository, and when its newest turn ended where one has. */
function listedAgentOf(
  row: AgentLiveRow,
  now: number,
  continuedBy: ContinuedBy | undefined,
): ListedAgent {
  const settledAt = turnOf(row) === undefined ? null : row.settledAt;
  return {
    ...agentSummaryOf(row, now, continuedBy),
    workspaceId: row.workspaceId,
    repository: row.repository,
    ...(settledAt === null ? undefined : { settledAt }),
  };
}

/** First started first, and by id among those started at one instant, as a plan's agents are listed. */
function firstStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The next instant past `now` the clock alone moves the agent's status (`statusClockEdge`); none where only its row moving can. */
function clockEdgeOf(row: AgentLiveRow, now: number): number | undefined {
  return statusClockEdge(turnOf(row), standingOf(row, now));
}

/** The earlier of two edges, none standing for never. */
function earlierEdge(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined ? a : Math.min(a, b);
}

/** The reader's pin of an agent on a plan; none for an agent on no plan, unpinned, or archived, since an archived agent stands in no list a pin is drawn in. */
function agentPinOf(row: AgentLiveRow): TaskAgentPin | undefined {
  const { planId, pinnedAt, pinPosition } = row;
  if (planId === null || pinnedAt === null || row.archivedAt !== null) return undefined;
  const at = { agentId: row.id, taskId: planId, pinnedAt };
  return pinPosition === null ? at : { ...at, pinPosition };
}

/** The pull request an agent's row keeps, as the service last read it on GitHub; none where it opened none. */
function agentPullRequestOf(row: AgentLiveRow): ListedPullRequest | undefined {
  return row.published === null
    ? undefined
    : { agentId: row.id, taskId: row.planId, pullRequest: row.published };
}

/** Whether two lists hold the very same objects in one order. */
function sameItems<Item>(a: readonly Item[], b: readonly Item[]): boolean {
  return a.length === b.length && a.every((item, at) => item === b[at]);
}

/** `next`, or `held` where it holds the very same objects, so a list nothing in moved is the list drawn before. */
function keptItems<Item>(
  held: readonly Item[] | undefined,
  next: readonly Item[],
): readonly Item[] {
  return held !== undefined && sameItems(held, next) ? held : next;
}

/** A value built from one row at an instant, as a drawing keeps it: what it was built from, and the instants it holds for. */
interface Built<Row, Value> {
  readonly row: Row;
  /** What else it was built from, compared by identity: the agents started from an agent, or a plan's agents. */
  readonly beside: unknown;
  readonly from: number;
  /** The first instant the clock alone moves it; none where only what it was built from moving can. */
  readonly until: number | undefined;
  readonly value: Value;
}

/** `held` where it was built from `row` and `beside` and still holds at `now`, else what `build` builds now. */
function rebuilt<Row, Value>(
  held: Built<Row, Value> | undefined,
  row: Row,
  beside: unknown,
  now: number,
  build: () => { readonly value: Value; readonly until: number | undefined },
): Built<Row, Value> {
  const holds =
    held !== undefined &&
    held.row === row &&
    held.beside === beside &&
    now >= held.from &&
    (held.until === undefined || now < held.until);
  return holds ? held : { row, beside, from: now, ...build() };
}

/** The agents started from one agent: their rows, first started first, and the list its summary names them by. */
interface Continued {
  readonly rows: readonly AgentLiveRow[];
  readonly by: ContinuedBy;
}

/** One plan's agents as a drawing keeps them, with the plan's line of every pull request they opened where they opened any. */
interface DrawnGroup extends AgentGroup {
  readonly listing: TaskPullRequests | undefined;
}

/** The plan list and every part drawn beside it, as the live rows stand at one instant. */
export interface TaskListDrawing {
  /** The plans newest started first, each with its agents in brief, and the agents with no plan newest started first, the archived among them. */
  readonly list: TaskListAnswer;
  /** Every agent on a plan, the archived among them, first started first, with the workspace and repository its own row names. */
  readonly taskAgents: readonly ListedAgent[];
  /** Every pull request of each plan that has one, those still open first, the newest agent's first within each. */
  readonly taskPullRequests: readonly TaskPullRequests[];
  /** The pull request of every agent whose row keeps one, on a plan or none, the archived among them. */
  readonly agentPullRequests: readonly ListedPullRequest[];
  /** The reader's pins of agents on a plan, the archived left out. */
  readonly taskAgentPins: readonly TaskAgentPin[];
  /** The next instant past the one drawn at that the clock alone moves it: the first agent whose starting grace or awaiting line's grace ends; none where none waits on one. */
  readonly edge: number | undefined;
}

/**
 * Draws the plan list from its live rows again and again, building again
 * only what a row that moved reaches: an agent whose row, or the rows of
 * the agents started from it, are other objects, a plan whose row or whose
 * agents' rows are, and anything whose status the clock has moved since it
 * was built. Everything else is the very object drawn before, and so is
 * every list nothing in moved, so a reader comparing one drawing with the
 * last stops at `===`. Note that it leans on a row that did not move being
 * the object it was, as the sync engine's pool hands it out (`@repo/sync`):
 * a row handed out equal but new is built again, which costs time and never
 * draws anything wrong.
 */
export function taskListDrawer(): (rows: TaskListLiveRows, now: number) => TaskListDrawing {
  let continued = new Map<string, Continued>();
  let groups = new Map<string, DrawnGroup>();
  let listed = new Map<string, Built<AgentLiveRow, ListedAgent>>();
  let taskless = new Map<string, Built<AgentLiveRow, TasklessAgent>>();
  let summaries = new Map<string, Built<TaskLiveRow, TaskSummary>>();
  let drawn: TaskListDrawing | undefined;
  /** What an agent's row alone builds, its pin and its pull request, built once for as long as the row stands. */
  const ofRow = new WeakMap<
    AgentLiveRow,
    { readonly pin: TaskAgentPin | undefined; readonly pullRequest: ListedPullRequest | undefined }
  >();
  const partsOf = (row: AgentLiveRow) => {
    const held = ofRow.get(row);
    if (held !== undefined) return held;
    const parts = { pin: agentPinOf(row), pullRequest: agentPullRequestOf(row) };
    ofRow.set(row, parts);
    return parts;
  };

  return (rows, now) => {
    // The agents started from each agent, built again only where their rows moved.
    const startedFrom = new Map<string, AgentLiveRow[]>();
    for (const row of rows.agents
      .filter((each) => each.startedFrom !== null)
      .toSorted(firstStarted)) {
      const source = row.startedFrom?.agentId;
      if (source === undefined) continue;
      const from = startedFrom.get(source);
      if (from === undefined) startedFrom.set(source, [row]);
      else from.push(row);
    }
    const nextContinued = new Map<string, Continued>();
    for (const [source, from] of startedFrom) {
      const held = continued.get(source);
      nextContinued.set(
        source,
        held !== undefined && sameItems(held.rows, from)
          ? held
          : { rows: from, by: from.map((row) => continuationOf(row, row.startedFrom?.messageId)) },
      );
    }

    // Each plan's agents in the order the rows name them, and their pull requests, built again only where their rows moved.
    const byTask = new Map<string, AgentLiveRow[]>();
    for (const row of rows.agents) {
      if (row.planId === null) continue;
      const group = byTask.get(row.planId);
      if (group === undefined) byTask.set(row.planId, [row]);
      else group.push(row);
    }
    const nextGroups = new Map<string, DrawnGroup>();
    for (const [taskId, agents] of byTask) {
      const held = groups.get(taskId);
      if (held !== undefined && sameItems(held.agents, agents)) {
        nextGroups.set(taskId, held);
        continue;
      }
      const lines = pullRequestLinesOf(agents);
      nextGroups.set(taskId, {
        agents,
        pullRequests: lines,
        listing: lines.length === 0 ? undefined : { taskId, pullRequests: lines },
      });
    }

    // Each agent as the tabs draw it, built again where its row or those started from it moved, or the clock moved its status.
    const nextListed = new Map<string, Built<AgentLiveRow, ListedAgent>>();
    const nextTaskless = new Map<string, Built<AgentLiveRow, TasklessAgent>>();
    let edge: number | undefined;
    for (const row of rows.agents) {
      const continuedBy = nextContinued.get(row.id)?.by;
      if (row.planId === null) {
        const built = rebuilt(taskless.get(row.id), row, continuedBy, now, () => ({
          value: tasklessAgentOf(row, now, continuedBy),
          until: clockEdgeOf(row, now),
        }));
        nextTaskless.set(row.id, built);
        edge = earlierEdge(edge, built.until);
        continue;
      }
      const built = rebuilt(listed.get(row.id), row, continuedBy, now, () => ({
        value: listedAgentOf(row, now, continuedBy),
        until: clockEdgeOf(row, now),
      }));
      nextListed.set(row.id, built);
      edge = earlierEdge(edge, built.until);
    }

    // Each plan as the list's row says it, built again where its row or its agents moved, or the clock moved one of their statuses.
    const nextSummaries = new Map<string, Built<TaskLiveRow, TaskSummary>>();
    const plans = rows.plans.toSorted(newestFirst).map((row) => {
      const group = nextGroups.get(row.id);
      const built = rebuilt(summaries.get(row.id), row, group, now, () => ({
        value: taskSummaryOf(row, group, now),
        until: (group?.agents ?? []).reduce<number | undefined>(
          (at, agent) => earlierEdge(at, clockEdgeOf(agent, now)),
          undefined,
        ),
      }));
      nextSummaries.set(row.id, built);
      return built.value;
    });

    const held = drawn;
    const keptPlans = keptItems(held?.list.plans, plans);
    const planlessAgents = keptItems(
      held?.list.planlessAgents,
      [...nextTaskless.values()]
        .toSorted((a, b) => newestFirst(a.row, b.row))
        .map((built) => built.value),
    );
    continued = nextContinued;
    groups = nextGroups;
    listed = nextListed;
    taskless = nextTaskless;
    summaries = nextSummaries;
    drawn = {
      list:
        held !== undefined &&
        held.list.plans === keptPlans &&
        held.list.planlessAgents === planlessAgents
          ? held.list
          : { plans: keptPlans, planlessAgents },
      taskAgents: keptItems(
        held?.taskAgents,
        [...nextListed.values()]
          .toSorted((a, b) => firstStarted(a.row, b.row))
          .map((built) => built.value),
      ),
      taskPullRequests: keptItems(
        held?.taskPullRequests,
        [...nextGroups.values()].flatMap((group) =>
          group.listing === undefined ? [] : [group.listing],
        ),
      ),
      agentPullRequests: keptItems(
        held?.agentPullRequests,
        rows.agents.flatMap((row) => {
          const { pullRequest } = partsOf(row);
          return pullRequest === undefined ? [] : [pullRequest];
        }),
      ),
      taskAgentPins: keptItems(
        held?.taskAgentPins,
        rows.agents.flatMap((row) => {
          const { pin } = partsOf(row);
          return pin === undefined ? [] : [pin];
        }),
      ),
      edge,
    };
    return drawn;
  };
}

/**
 * Every agent on a plan, the archived ones among them, each as the plan's
 * own list of agents names it with its status read at `now`, and with the
 * workspace and repository its own row names, the first
 * started first: what the open plan's tabs and its agents' pages draw, and what the desktop's
 * ledger of agents reads, the archived left out, where it once listed each
 * plan's agents again on a clock.
 */
export function taskAgentsOfLiveRows(rows: TaskListLiveRows, now: number): readonly ListedAgent[] {
  return taskListDrawer()(rows, now).taskAgents;
}

/**
 * The reader's pins of agents on a plan, the archived ones left out, since
 * an archived agent stands in no list a pin is drawn in: what the sidebar's
 * Pinned section draws beside the pinned plans.
 */
export function taskAgentPinsOfLiveRows(rows: TaskListLiveRows): readonly TaskAgentPin[] {
  return rows.agents.flatMap((row) => {
    const pin = agentPinOf(row);
    return pin === undefined ? [] : [pin];
  });
}

/**
 * Every pull request of each plan that has one, uncapped, in the order its
 * plan's readers name them (`pullRequestLinesOf`): what every reader of a
 * plan's pull requests reads.
 */
export function taskPullRequestsOfLiveRows(rows: TaskListLiveRows): readonly TaskPullRequests[] {
  const byTask = new Map<string, AgentLiveRow[]>();
  for (const row of rows.agents) {
    if (row.planId === null) continue;
    byTask.set(row.planId, [...(byTask.get(row.planId) ?? []), row]);
  }
  return [...byTask].flatMap(([taskId, agents]) => {
    const pullRequests = pullRequestLinesOf(agents);
    return pullRequests.length === 0 ? [] : [{ taskId, pullRequests }];
  });
}

/**
 * The pull request of every agent whose row keeps one, on a plan or none,
 * the archived among them, as the service last read it on GitHub: what a
 * plan's or an agent's tabs offer each agent's Changes by.
 */
export function agentPullRequestsOfLiveRows(rows: TaskListLiveRows): readonly ListedPullRequest[] {
  return rows.agents.flatMap((row) => {
    const pullRequest = agentPullRequestOf(row);
    return pullRequest === undefined ? [] : [pullRequest];
  });
}

/**
 * The plan list as the held read answers it with every archived agent
 * included, as the live rows stand at `now`: the plans newest started
 * first, each with its agents in brief, and the agents with no plan newest
 * started first.
 */
export function taskListOfLiveRows(rows: TaskListLiveRows, now: number): TaskListAnswer {
  return taskListDrawer()(rows, now).list;
}
