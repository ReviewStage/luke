import { Schema as EffectSchema } from "effect";
import { codingAgentStatusAt, type StatusTurn, startingGraceEdge } from "./coding-agent-status.js";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentArchivedBy,
  type CodingAgentStatus,
  type CodingAgentSummary,
  codingAgentPullRequestSchema,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "./coding-agent-wire.js";
import { integrationConnectionOf } from "./integration-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";
import {
  TASK_AGENTS_BOUNDS,
  type TaskAgentLine,
  type TaskAgentsSummary,
  type TaskListAnswer,
  type TaskPullRequestLine,
  type TaskSummary,
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
 * names. Everything the held read derives from them is derived here, at
 * the instant the reader reads at, since an agent's status turns on the
 * clock (`coding-agent-status.ts`): `taskListGraceEdge` is the next instant
 * the clock alone moves the list, which the reader builds it again at.
 * Realtime keeps no order, so the list is ordered here as the held read
 * orders it.
 */

/** The plan list sealed for following: the address, and its two statements. The service answers `unavailable` where its deployment has no Realtime. */
export const taskListLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    plans: sealedLiveQuerySchema,
    agents: sealedLiveQuerySchema,
  }),
});

export type TaskListLiveAnswer = typeof taskListLiveAnswerSchema.Type;

const plan = taskSummarySchema.fields;

/** One plan as its row delivers it: the reader's own pin and the owner's name beside it, null where none stands. */
const planLiveRowSchema = EffectSchema.Struct({
  id: plan.id,
  workspaceId: plan.workspaceId,
  name: plan.name,
  repository: plan.repository,
  ownerId: EffectSchema.String,
  ownerName: EffectSchema.NullOr(EffectSchema.String),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  archivedAt: EffectSchema.NullOr(countedNumber),
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

/** Who archived an agent as its row holds it. */
const archiveLiveSchema = EffectSchema.Struct({
  by: EffectSchema.Literals(Object.values(CODING_AGENT_ARCHIVER)),
  userId: EffectSchema.String,
  agentId: EffectSchema.optionalKey(EffectSchema.String),
  agentName: EffectSchema.optionalKey(EffectSchema.String),
  reason: EffectSchema.optionalKey(EffectSchema.String),
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
  /** Whether the agent was handed a prompt rather than its plan. */
  prompted: EffectSchema.Boolean,
  repository: EffectSchema.String,
  starterId: EffectSchema.String,
  starterName: EffectSchema.NullOr(EffectSchema.String),
  automationId: EffectSchema.NullOr(EffectSchema.String),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  archivedAt: EffectSchema.NullOr(countedNumber),
  archivedBy: EffectSchema.NullOr(archiveLiveSchema),
  archiverName: EffectSchema.NullOr(EffectSchema.String),
  disabledServers: EffectSchema.NullOr(EffectSchema.Array(EffectSchema.String)),
  published: EffectSchema.NullOr(codingAgentPullRequestSchema),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  queuedAt: EffectSchema.NullOr(countedNumber),
  startedAt: EffectSchema.NullOr(countedNumber),
  settledAt: EffectSchema.NullOr(countedNumber),
  lineAwaits: EffectSchema.Boolean,
});

/** The plan list's rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const taskListLiveRowsSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(planLiveRowSchema),
  agents: EffectSchema.Array(agentLiveRowSchema),
});

export type TaskListLiveRows = typeof taskListLiveRowsSchema.Type;

type PlanLiveRow = typeof planLiveRowSchema.Type;
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
    : { status: row.turnStatus, cancelRequested: row.cancelRequested === true };
}

function statusOf(row: AgentLiveRow, now: number): CodingAgentStatus {
  return codingAgentStatusAt(turnOf(row), {
    createdAt: row.createdAt,
    now,
    lineAwaits: row.lineAwaits,
  });
}

/** When the run the status is read from began: the newest turn's start, or its queueing, the agent's own before any turn, and none while a line awaits its turn. */
function runStartedAt(row: AgentLiveRow): number | undefined {
  if (row.lineAwaits) return undefined;
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
    ? runStartedAt(row)
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
 * One plan's agents in brief, as the held read sums them: those at work
 * named first, then the rest, newest started first within each; each pull
 * request once by its page, those still open first, newest agent's first
 * within a rank; and the latest settled activity of every agent, archived
 * or not.
 */
function agentsSummaryOf(rows: readonly AgentLiveRow[], now: number): TaskAgentsSummary {
  const newest = rows
    .filter((row) => row.archivedAt === null)
    .toSorted(newestStarted)
    .map((row) => ({ row, line: agentLine(row, now) }));
  const working = newest.filter(({ line }) => WORKING_STATUSES.has(line.status));
  const resting = newest.filter(({ line }) => !WORKING_STATUSES.has(line.status));
  const pullRequests = new Map<string, TaskPullRequestLine>();
  for (const { row } of newest) {
    const { published } = row;
    if (published === null || pullRequests.has(published.url)) continue;
    const { number, title, state, checks, additions, deletions, url } = published;
    pullRequests.set(url, { number, title, state, checks, additions, deletions, url });
  }
  return {
    total: newest.length,
    working: working.length,
    ...(rows.length === 0 ? undefined : { activityAt: Math.max(...rows.map(activityAt)) }),
    agents: [...working, ...resting]
      .slice(0, TASK_AGENTS_BOUNDS.MAX_AGENTS)
      .map(({ line }) => line),
    pullRequestTotal: pullRequests.size,
    pullRequests: [...pullRequests.values()]
      .toSorted((a, b) => PULL_REQUEST_RANK[a.state] - PULL_REQUEST_RANK[b.state])
      .slice(0, TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

/** One plan as the list's row says it, its agents in brief where it has any. */
function taskSummaryOf(
  row: PlanLiveRow,
  agents: readonly AgentLiveRow[] | undefined,
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
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt }),
    ...(row.pinnedAt === null || row.pinPosition === null
      ? undefined
      : { pinPosition: row.pinPosition }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt }),
    ...(agents === undefined ? undefined : { agents: agentsSummaryOf(agents, now) }),
  };
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
  };
}

/** One agent as the tabs draw it, on a plan or with none, its status read at `now`, as the service's summary of it says it. */
function agentSummaryOf(row: AgentLiveRow, now: number): CodingAgentSummary {
  const servers = (row.disabledServers ?? []).filter(
    (name) => integrationConnectionOf(name) !== undefined,
  );
  const archivedBy = archivedByOf(row);
  const started = runStartedAt(row);
  return {
    id: row.id,
    planId: row.planId,
    model: row.model,
    effort: row.effort,
    ...(row.contextWindow === CONTEXT_WINDOW.STANDARD
      ? { contextWindow: CONTEXT_WINDOW.STANDARD }
      : undefined),
    title: row.title,
    createdAt: row.createdAt,
    status: statusOf(row, now),
    turnId: row.turnId,
    brief: row.prompted ? CODING_AGENT_BRIEF.PROMPT : CODING_AGENT_BRIEF.PLAN,
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt }),
    ...(archivedBy === undefined ? undefined : { archivedBy }),
    ...(servers.length === 0 ? undefined : { disabledServers: servers }),
    ...(row.starterName === null
      ? undefined
      : { startedBy: { userId: row.starterId, name: row.starterName } }),
    ...(row.automationId === null ? undefined : { automationId: row.automationId }),
    ...(row.automationName === null ? undefined : { automationName: row.automationName }),
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
export function planAgentsOfLiveRows(
  rows: TaskListLiveRows,
  now: number,
): readonly CodingAgentSummary[] {
  return rows.agents
    .filter((row) => row.planId !== null && row.archivedAt === null)
    .toSorted(firstStarted)
    .map((row) => agentSummaryOf(row, now));
}

/**
 * The plan list as the held read answers it with every archived plan and
 * agent included, as the live rows stand at `now`: the plans newest started
 * first, each with its agents in brief, and the agents with no plan newest
 * started first.
 */
export function taskListOfLiveRows(rows: TaskListLiveRows, now: number): TaskListAnswer {
  const byPlan = new Map<string, AgentLiveRow[]>();
  for (const agent of rows.agents) {
    if (agent.planId === null) continue;
    byPlan.set(agent.planId, [...(byPlan.get(agent.planId) ?? []), agent]);
  }
  return {
    plans: rows.plans
      .toSorted(newestFirst)
      .map((row) => taskSummaryOf(row, byPlan.get(row.id), now)),
    planlessAgents: rows.agents
      .filter((agent) => agent.planId === null)
      .toSorted(newestFirst)
      .map((agent) => tasklessAgentOf(agent, now)),
  };
}
/** The next instant past `now` the clock alone moves the list: the first agent with no turn whose grace ends; none where none waits on one. */
export function taskListGraceEdge(rows: TaskListLiveRows, now: number): number | undefined {
  const edges = rows.agents.flatMap((row) => {
    const edge = startingGraceEdge(turnOf(row), {
      createdAt: row.createdAt,
      now,
      lineAwaits: row.lineAwaits,
    });
    return edge === undefined ? [] : [edge];
  });
  return edges.length === 0 ? undefined : Math.min(...edges);
}
