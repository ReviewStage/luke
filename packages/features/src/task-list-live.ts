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
import {
  type ListedPullRequest,
  DESCRIPTION_ACTOR,
  TASK_AGENTS_BOUNDS,
  type TaskAgentLine,
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
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  completedAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  createdAt: countedNumber,
  updatedAt: countedNumber,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  number: EffectSchema.optionalKey(EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1))),
  creatorActor: EffectSchema.optionalKey(
    EffectSchema.Literals([
      DESCRIPTION_ACTOR.DEVELOPER,
      DESCRIPTION_ACTOR.NOTETAKER,
      DESCRIPTION_ACTOR.AGENT,
    ]),
  ),
  creatorAgentId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  parentTaskId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  mode: plan.mode,
  blocked: EffectSchema.optionalKey(EffectSchema.Boolean),
  madeByRun: EffectSchema.optionalKey(EffectSchema.Boolean),
});

const archiveLiveSchema = EffectSchema.Struct({
  by: agentArchiverSchema,
  userId: EffectSchema.String,
  agentId: EffectSchema.optionalKey(EffectSchema.String),
  agentName: EffectSchema.optionalKey(EffectSchema.String),
  reason: EffectSchema.optionalKey(EffectSchema.String),
  withTask: EffectSchema.optionalKey(EffectSchema.Boolean),
});

const agentLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  planId: EffectSchema.NullOr(EffectSchema.String),
  workspaceId: EffectSchema.String,
  model: EffectSchema.String,
  effort: EffectSchema.String,
  contextWindow: EffectSchema.NullOr(EffectSchema.String),
  title: EffectSchema.NullOr(EffectSchema.String),
  pilot: EffectSchema.optionalKey(EffectSchema.Boolean),
  brief: EffectSchema.Literals(Object.values(AGENT_BRIEF)),
  repository: EffectSchema.NullOr(EffectSchema.String),
  starterId: EffectSchema.String,
  starterName: EffectSchema.NullOr(EffectSchema.String),
  starterPilotId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotTaskId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotTitle: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  starterPilotModel: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  automationId: EffectSchema.NullOr(EffectSchema.String),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  runId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  runAutomationId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  archivedAt: EffectSchema.NullOr(countedNumber),
  archivedBy: EffectSchema.NullOr(archiveLiveSchema),
  archiverName: EffectSchema.NullOr(EffectSchema.String),
  disabledServers: EffectSchema.NullOr(EffectSchema.Array(EffectSchema.String)),
  published: EffectSchema.NullOr(agentPullRequestSchema),
  startedFrom: EffectSchema.NullOr(agentSummarySchema.fields.from.schema),
  source: EffectSchema.optionalKey(EffectSchema.NullOr(agentSourceSchema)),
  pinnedAt: EffectSchema.NullOr(countedNumber),
  pinPosition: EffectSchema.NullOr(EffectSchema.String),
  readThrough: EffectSchema.optionalKey(countedNumber),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  createdAt: countedNumber,
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  cancelRequestedAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  queuedAt: EffectSchema.NullOr(countedNumber),
  startedAt: EffectSchema.NullOr(countedNumber),
  settledAt: EffectSchema.NullOr(countedNumber),
  turnSessionEnded: EffectSchema.NullOr(EffectSchema.Boolean),
  awaitingLineAt: EffectSchema.NullOr(countedNumber),
  lastSettledAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  runtime: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  machine: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  deviceId: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
  deviceName: EffectSchema.optionalKey(EffectSchema.NullOr(EffectSchema.String)),
});

export const taskListLiveRowsSchema = EffectSchema.Struct({
  plans: EffectSchema.Array(taskLiveRowSchema),
  agents: EffectSchema.Array(agentLiveRowSchema),
});

export type TaskListLiveRows = typeof taskListLiveRowsSchema.Type;

type TaskLiveRow = typeof taskLiveRowSchema.Type;
type AgentLiveRow = typeof agentLiveRowSchema.Type;

const WORKING_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

const PULL_REQUEST_RANK = {
  [PULL_REQUEST_STATE.OPEN]: 0,
  [PULL_REQUEST_STATE.DRAFT]: 0,
  [PULL_REQUEST_STATE.MERGED]: 1,
  [PULL_REQUEST_STATE.CLOSED]: 2,
} as const satisfies Record<TaskPullRequestLine["state"], number>;

function newestFirst<Row extends { readonly id: string; readonly createdAt: number }>(
  a: Row,
  b: Row,
): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

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
      };
}

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

function runStartedAt(row: AgentLiveRow, now: number): number | undefined {
  if (lineAwaitsTurn(turnOf(row), standingOf(row, now))) return undefined;
  return turnOf(row) === undefined ? row.createdAt : (row.startedAt ?? row.queuedAt ?? undefined);
}

function activityAt(row: AgentLiveRow): number {
  return Math.max(row.createdAt, row.lastSettledAt ?? row.settledAt ?? 0);
}

function newestStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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

interface AgentGroup {
  readonly agents: readonly AgentLiveRow[];
  readonly pullRequests: readonly TaskPullRequestLine[];
}

function agentsSummaryOf(group: AgentGroup, now: number): TaskAgentsSummary {
  const { agents: rows, pullRequests } = group;
  const newest = rows
    .filter((row) => row.archivedAt === null)
    .toSorted(newestStarted)
    .map((row) => ({ row, line: agentLine(row, now) }));
  const working = newest.filter(({ line }) => WORKING_STATUSES.has(line.status));
  const resting = newest.filter(({ line }) => !WORKING_STATUSES.has(line.status));
  return {
    total: newest.length,
    working: working.length,
    failed: newest.filter(({ line }) => line.status === AGENT_STATUS.FAILED).length,
    ...(rows.length === 0 ? undefined : { activityAt: Math.max(...rows.map(activityAt)) }),
    agents: [...working, ...resting]
      .slice(0, TASK_AGENTS_BOUNDS.MAX_AGENTS)
      .map(({ line }) => line),
    pullRequestTotal: pullRequests.length,
    pullRequests: pullRequests.slice(0, TASK_AGENTS_BOUNDS.MAX_PULL_REQUESTS),
  };
}

function originOf(row: TaskLiveRow): { readonly origin?: TaskOrigin } {
  const actor = row.creatorActor;
  if (actor === undefined || actor === DESCRIPTION_ACTOR.DEVELOPER) return {};
  const agentId = row.creatorAgentId;
  return {
    origin: { actor, ...(agentId === undefined || agentId === null ? undefined : { agentId }) },
  };
}

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

type ContinuedBy = NonNullable<AgentSummary["continuedBy"]>;

function continuationOf(row: AgentLiveRow, messageId: string | undefined): ContinuedBy[number] {
  return messageId === undefined
    ? { agentId: row.id, title: row.title, forked: false }
    : { agentId: row.id, title: row.title, forked: true, messageId };
}

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
  };
}

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

function firstStarted(a: AgentLiveRow, b: AgentLiveRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function clockEdgeOf(row: AgentLiveRow, now: number): number | undefined {
  return statusClockEdge(turnOf(row), standingOf(row, now));
}

function earlierEdge(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  return b === undefined ? a : Math.min(a, b);
}

function agentPinOf(row: AgentLiveRow): TaskAgentPin | undefined {
  const { planId, pinnedAt, pinPosition } = row;
  if (planId === null || pinnedAt === null || row.archivedAt !== null) return undefined;
  const at = { agentId: row.id, taskId: planId, pinnedAt };
  return pinPosition === null ? at : { ...at, pinPosition };
}

function agentPullRequestOf(row: AgentLiveRow): ListedPullRequest | undefined {
  return row.published === null
    ? undefined
    : { agentId: row.id, taskId: row.planId, pullRequest: row.published };
}

function sameItems<Item>(a: readonly Item[], b: readonly Item[]): boolean {
  return a.length === b.length && a.every((item, at) => item === b[at]);
}

function keptItems<Item>(
  held: readonly Item[] | undefined,
  next: readonly Item[],
): readonly Item[] {
  return held !== undefined && sameItems(held, next) ? held : next;
}

interface Built<Row, Value> {
  readonly row: Row;
  readonly beside: unknown;
  readonly from: number;
  readonly until: number | undefined;
  readonly value: Value;
}

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

interface Continued {
  readonly rows: readonly AgentLiveRow[];
  readonly by: ContinuedBy;
}

interface DrawnGroup extends AgentGroup {
  readonly listing: TaskPullRequests | undefined;
}

export interface TaskListDrawing {
  readonly list: TaskListAnswer;
  readonly taskAgents: readonly ListedAgent[];
  readonly taskPullRequests: readonly TaskPullRequests[];
  readonly agentPullRequests: readonly ListedPullRequest[];
  readonly taskAgentPins: readonly TaskAgentPin[];
  readonly edge: number | undefined;
}

export function taskListDrawer(): (rows: TaskListLiveRows, now: number) => TaskListDrawing {
  let continued = new Map<string, Continued>();
  let groups = new Map<string, DrawnGroup>();
  let listed = new Map<string, Built<AgentLiveRow, ListedAgent>>();
  let taskless = new Map<string, Built<AgentLiveRow, TasklessAgent>>();
  let summaries = new Map<string, Built<TaskLiveRow, TaskSummary>>();
  let drawn: TaskListDrawing | undefined;
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
        value: {
          ...agentSummaryOf(row, now, continuedBy),
          workspaceId: row.workspaceId,
          repository: row.repository,
        },
        until: clockEdgeOf(row, now),
      }));
      nextListed.set(row.id, built);
      edge = earlierEdge(edge, built.until);
    }

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

export function taskAgentsOfLiveRows(rows: TaskListLiveRows, now: number): readonly ListedAgent[] {
  return taskListDrawer()(rows, now).taskAgents;
}

export function taskAgentPinsOfLiveRows(rows: TaskListLiveRows): readonly TaskAgentPin[] {
  return rows.agents.flatMap((row) => {
    const pin = agentPinOf(row);
    return pin === undefined ? [] : [pin];
  });
}

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

export function agentPullRequestsOfLiveRows(rows: TaskListLiveRows): readonly ListedPullRequest[] {
  return rows.agents.flatMap((row) => {
    const pullRequest = agentPullRequestOf(row);
    return pullRequest === undefined ? [] : [pullRequest];
  });
}

export function taskListOfLiveRows(rows: TaskListLiveRows, now: number): TaskListAnswer {
  return taskListDrawer()(rows, now).list;
}
