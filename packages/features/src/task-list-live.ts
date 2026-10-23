import { Schema as EffectSchema } from "effect";
import {
  codingAgentStatusAt,
  lineAwaitsTurn,
  type StatusTurn,
  statusClockEdge,
} from "./coding-agent-status.js";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BRIEF,
  CODING_AGENT_KIND,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentArchivedBy,
  type CodingAgentStatus,
  type CodingAgentSummary,
  codingAgentPullRequestSchema,
  codingAgentSummarySchema,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "./coding-agent-wire.js";
import { integrationConnectionOf } from "./integration-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";
import { type TaskIssueTag, taskIssueTagSchema } from "./task-issue-wire.js";
import {
  PLAN_ACTOR,
  TASK_AGENTS_BOUNDS,
  type TaskAgentLine,
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
 * The plan list is three statements: the plans the account reaches, each with
 * its reader's own pin and its owner's name, the issues those plans link,
 * which each plan names as its tags, oldest linked first, and every agent of those plans
 * and every agent with no plan in the account's workspaces, archived ones
 * among them, each with its newest turn, whether a line of the developer's
 * awaits its turn, what it last published, and the names of the members it
 * names. Everything the held read derives from them is derived here, at
 * the instant the reader reads at, since an agent's status turns on the
 * clock (`coding-agent-status.ts`): `taskListGraceEdge` is the next instant
 * the clock alone moves the list, which the reader builds it again at.
 * Realtime keeps no order, so the list is ordered here as the held read
 * orders it.
 */

/** The plan list sealed for following: the address, and its three statements. The service answers `unavailable` where its deployment's Realtime is misconfigured. */
export const taskListLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    plans: sealedLiveQuerySchema,
    agents: sealedLiveQuerySchema,
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
  /** Absent from a service before it kept when a task was finished. */
  completedAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  createdAt: countedNumber,
  updatedAt: countedNumber,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  /** The task's number in its workspace, from 1, as the list says it. */
  number: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  /** Who made the task for its owner (`PLAN_ACTOR`); absent from a service before it was sent, read as made by hand. */
  creatorActor: EffectSchema.optionalKey(
    EffectSchema.Literals([PLAN_ACTOR.DEVELOPER, PLAN_ACTOR.NOTETAKER, PLAN_ACTOR.AGENT]),
  ),
  /** The coding agent that made the task; null for any other maker and once its row is gone. */
  creatorAgentId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
});

/** Who archived an agent as its row holds it. */
const archiveLiveSchema = EffectSchema.Struct({
  by: EffectSchema.Literals(Object.values(CODING_AGENT_ARCHIVER)),
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
  /** What kind of agent it is, a coder or a member's operator; absent from a statement before operators. */
  kind: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(CODING_AGENT_KIND))),
  /** Whether the agent was handed a prompt rather than its plan. */
  /** What the agent was handed as its first message: the plan, the developer's prompt, or nothing, for one started blank. */
  brief: EffectSchema.Literals(Object.values(CODING_AGENT_BRIEF)),
  /** The repository the agent works in; null for a member's operator, which works in none. */
  repository: EffectSchema.NullOr(EffectSchema.String),
  starterId: EffectSchema.String,
  starterName: EffectSchema.NullOr(EffectSchema.String),
  automationId: EffectSchema.NullOr(EffectSchema.String),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  archivedAt: EffectSchema.NullOr(countedNumber),
  archivedBy: EffectSchema.NullOr(archiveLiveSchema),
  archiverName: EffectSchema.NullOr(EffectSchema.String),
  disabledServers: EffectSchema.NullOr(EffectSchema.Array(EffectSchema.String)),
  published: EffectSchema.NullOr(codingAgentPullRequestSchema),
  /** The agent this one continues or forks, as its summary's `from` says it. */
  startedFrom: EffectSchema.NullOr(codingAgentSummarySchema.fields.from.schema),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  queuedAt: EffectSchema.NullOr(countedNumber),
  startedAt: EffectSchema.NullOr(countedNumber),
  settledAt: EffectSchema.NullOr(countedNumber),
  turnSessionEnded: EffectSchema.NullOr(EffectSchema.Boolean),
  awaitingLineAt: EffectSchema.NullOr(countedNumber),
  /** Whether the newest turn's reply is a member's operator's quiet reply alone; absent from a statement before heartbeats. */
  quietTurn: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.Boolean)),
});

/** One issue a plan links as its row delivers it: its tag, the plan it is of, and when it was linked. */
const issueLiveRowSchema = EffectSchema.Struct({
  ...taskIssueTagSchema.fields,
  planId: EffectSchema.String,
  createdAt: countedNumber,
});

type IssueLiveRow = typeof issueLiveRowSchema.Type;

/** The plan list's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const taskListLiveRowsSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(taskLiveRowSchema),
  agents: EffectSchema.Array(agentLiveRowSchema),
  issues: EffectSchema.Array(issueLiveRowSchema),
});

export type TaskListLiveRows = typeof taskListLiveRowsSchema.Type;

type TaskLiveRow = typeof taskLiveRowSchema.Type;
type AgentLiveRow = typeof agentLiveRowSchema.Type;

/** The statuses under which an agent is at work. */
const WORKING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** The order the pull requests a row names stand in: those still to act on first, then merged, then closed. */
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
        queuedAt: row.queuedAt ?? row.createdAt,
        settledAt: row.settledAt,
        sessionEnded: row.turnSessionEnded === true,
      };
}

/** Where the agent stands at `now`, as the status rule reads it: its Start, its newest awaiting line where one stands, and whether it was started blank. */
function standingOf(row: AgentLiveRow, now: number) {
  return {
    createdAt: row.createdAt,
    now,
    awaitingLineAt: row.awaitingLineAt ?? undefined,
    blank: row.brief === CODING_AGENT_BRIEF.BLANK,
  };
}

function statusOf(row: AgentLiveRow, now: number): CodingAgentStatus {
  return codingAgentStatusAt(turnOf(row), standingOf(row, now));
}

/** When the run the status is read from began: the newest turn's start, or its queueing, the agent's own before any turn, and none while a line awaits its turn. */
function runStartedAt(row: AgentLiveRow, now: number): number | undefined {
  if (lineAwaitsTurn(turnOf(row), standingOf(row, now))) return undefined;
  return turnOf(row) === undefined ? row.createdAt : (row.startedAt ?? row.queuedAt ?? undefined);
}

/** When the agent last did something settled: its start, its newest turn's start or queueing, or that turn's end, whichever is latest. */
function activityAt(row: AgentLiveRow): number {
  if (turnOf(row) === undefined) return row.createdAt;
  return Math.max(row.createdAt, row.startedAt ?? row.queuedAt ?? 0, row.settledAt ?? 0);
}

/** Newest started first, and the first started among those of one instant, as the held read sums a plan's agents. */
function newestStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One agent as its plan's row names it, its status read at `now`. */
function agentLine(row: AgentLiveRow, now: number): TaskAgentLine {
  const status = statusOf(row, now);
  const at = WORKING_STATUSES.has(status)
    ? runStartedAt(row, now)
    : turnOf(row) === undefined
      ? undefined
      : (row.settledAt ?? undefined);
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    effort: row.effort,
    status,
    ...(at === undefined ? undefined : { at }),
    ...(row.starterName === null
      ? undefined
      : { startedBy: { userId: row.starterId, name: row.starterName } }),
    ...(row.automationId === null ? undefined : { automationId: row.automationId }),
  };
}

/**
 * Every pull request a plan's agents opened, the archived agents' left out,
 * each once by its page: those still open first, the newest agent's first
 * within a rank. Uncapped, so a card can name every one; the plan's row
 * names the first few.
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
    });
  }
  return [...pullRequests.values()].toSorted(
    (a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state],
  );
}

/**
 * One plan's agents in brief, as the held read sums them: those at work
 * named first, then the rest, newest started first within each; each pull
 * request once by its page, those still open first, newest agent's first
 * within a rank; and the latest settled activity of every agent, archived
 * or not.
 */
function agentsSummaryOf(rows: readonly AgentLiveRow[], now: number): TaskAgentsSummary {
  const pullRequests = pullRequestLinesOf(rows);
  const newest = rows
    .filter((row) => row.archivedAt === null)
    .toSorted(newestStarted)
    .map((row) => ({ row, line: agentLine(row, now) }));
  const working = newest.filter(({ line }) => WORKING_STATUSES.has(line.status));
  const resting = newest.filter(({ line }) => !WORKING_STATUSES.has(line.status));
  return {
    total: newest.length,
    working: working.length,
    ...(rows.length === 0 ? undefined : { activityAt: Math.max(...rows.map(activityAt)) }),
    agents: [...working, ...resting]
      .slice(0, TASK_AGENTS_BOUNDS.MAX_AGENTS)
      .map(({ line }) => line),
    pullRequestTotal: pullRequests.length,
    pullRequests: pullRequests.slice(0, TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

/** One plan as the list's row says it, its agents in brief where it has any. */
/** Who made a task for its owner, as the summary names them: nothing for a task made by hand. */
function originOf(row: TaskLiveRow): { readonly origin?: TaskOrigin } {
  const actor = row.creatorActor;
  if (actor === undefined || actor === PLAN_ACTOR.DEVELOPER) return {};
  const agentId = row.creatorAgentId;
  return {
    origin: { actor, ...(agentId === undefined || agentId === null ? undefined : { agentId }) },
  };
}

function taskSummaryOf(
  row: TaskLiveRow,
  agents: readonly AgentLiveRow[] | undefined,
  issues: readonly TaskIssueTag[] | undefined,
  now: number,
): TaskSummary {
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
    ...(row.completedAt === undefined || row.completedAt === null
      ? undefined
      : { completedAt: row.completedAt }),
    status: row.status,
    priority: row.priority,
    number: row.number,
    ...(row.assigneeId === null || row.assigneeName === null
      ? undefined
      : { assignee: { userId: row.assigneeId, name: row.assigneeName } }),
    ...(agents === undefined ? undefined : { agents: agentsSummaryOf(agents, now) }),
    ...(issues === undefined ? undefined : { issues }),
  };
}

/** Each plan's issues as its tags, oldest linked first, as the held read orders them; a plan that links none is absent. */
function tagsByPlan(rows: readonly IssueLiveRow[]): ReadonlyMap<string, readonly TaskIssueTag[]> {
  const byPlan = new Map<string, TaskIssueTag[]>();
  const ordered = rows.toSorted(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const { planId, createdAt: _createdAt, ...tag } of ordered) {
    const held = byPlan.get(planId);
    if (held === undefined) byPlan.set(planId, [tag]);
    else held.push(tag);
  }
  return byPlan;
}

/** Who archived an agent as its banner says it: the member where their account stands, the agent acting for them, and why. */
function archivedByOf(row: AgentLiveRow): CodingAgentArchivedBy | undefined {
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

/** One agent as the tabs draw it, on a plan or with none, its status read at `now`, as the service's summary of it says it. */
function agentSummaryOf(row: AgentLiveRow, now: number): CodingAgentSummary {
  const servers = (row.disabledServers ?? []).filter(
    (name) => integrationConnectionOf(name) !== undefined,
  );
  const archivedBy = archivedByOf(row);
  const started = runStartedAt(row, now);
  return {
    id: row.id,
    planId: row.planId,
    model: row.model,
    effort: row.effort,
    ...(row.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: CONTEXT_WINDOW.STANDARD }
      : undefined),
    title: row.title,
    ...(row.kind === CODING_AGENT_KIND.OPERATOR ? { kind: row.kind } : undefined),
    createdAt: row.createdAt,
    status: statusOf(row, now),
    ...(row.quietTurn === true ? { quietTurn: true } : undefined),
    turnId: row.turnId,
    brief: row.brief,
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt }),
    ...(archivedBy === undefined ? undefined : { archivedBy }),
    ...(servers.length === 0 ? undefined : { disabledServers: servers }),
    ...(row.starterName === null
      ? undefined
      : { startedBy: { userId: row.starterId, name: row.starterName } }),
    ...(row.automationId === null ? undefined : { automationId: row.automationId }),
    ...(row.automationName === null ? undefined : { automationName: row.automationName }),
    ...(row.startedFrom === null ? undefined : { from: row.startedFrom }),
    ...(started === undefined ? undefined : { runStartedAt: started }),
  };
}

/** An agent with no plan as the list carries it, as its own page reads it, its status read at `now`. */
function tasklessAgentOf(row: AgentLiveRow, now: number): TasklessAgent {
  return {
    ...agentSummaryOf(row, now),
    planId: null,
    automationId: row.automationId,
    workspaceId: row.workspaceId,
    repository: row.repository,
    activityAt: activityAt(row),
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt }),
    ...(row.pinnedAt === null || row.pinPosition === null
      ? undefined
      : { pinPosition: row.pinPosition }),
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

/** First started first, and by id among those started at one instant, as a plan's agents are listed. */
function firstStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every agent on a plan, the archived ones left out, each as the plan's own
 * list of agents names it with its status read at `now`, the first started
 * first: what the desktop's ledger of agents reads where it once listed
 * each plan's agents again on a clock.
 */
export function taskAgentsOfLiveRows(
  rows: TaskListLiveRows,
  now: number,
): readonly CodingAgentSummary[] {
  return rows.agents
    .filter((row) => row.planId !== null && row.archivedAt === null)
    .toSorted(firstStarted)
    .map((row) => agentSummaryOf(row, now));
}

/**
 * Every pull request of each plan that has one, uncapped, in the order its
 * row names them (`pullRequestLinesOf`): what a card naming a plan's pull
 * requests reads, where its row names only the first few.
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
 * The plan list as the held read answers it with every archived agent
 * included, as the live rows stand at `now`: the plans newest started
 * first, each with its agents in brief, and the agents with no plan newest
 * started first.
 */
export function taskListOfLiveRows(rows: TaskListLiveRows, now: number): TaskListAnswer {
  const byTask = new Map<string, AgentLiveRow[]>();
  for (const agent of rows.agents) {
    if (agent.planId === null) continue;
    byTask.set(agent.planId, [...(byTask.get(agent.planId) ?? []), agent]);
  }
  const tags = tagsByPlan(rows.issues);
  return {
    plans: rows.plans
      .toSorted(newestFirst)
      .map((row) => taskSummaryOf(row, byTask.get(row.id), tags.get(row.id), now)),
    planlessAgents: rows.agents
      .filter((agent) => agent.planId === null)
      .toSorted(newestFirst)
      .map((agent) => tasklessAgentOf(agent, now)),
  };
}

/** The next instant past `now` the clock alone moves the list: the first agent whose starting grace or awaiting line's grace ends; none where none waits on one. */
export function taskListGraceEdge(rows: TaskListLiveRows, now: number): number | undefined {
  const edges = rows.agents.flatMap((row) => {
    const edge = statusClockEdge(turnOf(row), standingOf(row, now));
    return edge === undefined ? [] : [edge];
  });
  return edges.length === 0 ? undefined : Math.min(...edges);
}
