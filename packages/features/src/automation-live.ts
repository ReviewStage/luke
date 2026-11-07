import { Schema as EffectSchema } from "effect";
import { agentStatusAt, type StatusTurn, statusClockEdge } from "./agent-status.js";
import { AGENT_FAILURE, AGENT_STATUS } from "./agent-wire.js";
import {
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  type AutomationWorkspaceRun,
  automationActionSchema,
  automationFiringSchema,
  automationGuardsSchema,
  automationRunReasonSchema,
  automationRunStatusSchema,
  automationScopeSchema,
  automationTargetKindSchema,
  automationTriggerSchema,
} from "./automation-wire.js";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { automationWebhookPath, HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/**
 * automation-live.ts -- a workspace's automations and runs, and one automation's runs, as the host follows them over the service's held poll: the statements the service answers, the rows they deliver, and the list and the histories as the held reads answer them, built from the rows at an instant.
 *
 * A run's agent's status turns on the clock (`agent-status.ts`), so
 * the reader builds each at the instant it reads, and again at
 * `automationsGraceEdge` or `automationRunsGraceEdge`, the next instant the
 * clock alone moves one. A webhook automation is answered with the address
 * its caller posts to on the service the reader reaches, as the held read's
 * client answers it. The rows come in no order, so the reader orders.
 */

/** The agent a run started as its row delivers it, and what its status is read from; null throughout where it started none, or it is gone. */
const runAgentFields = {
  agentId: EffectSchema.NullOr(EffectSchema.String),
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  agentCreatedAt: EffectSchema.NullOr(countedNumber),
  ownKey: EffectSchema.NullOr(EffectSchema.Boolean),
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  turnQueuedAt: EffectSchema.NullOr(countedNumber),
  turnSettledAt: EffectSchema.NullOr(countedNumber),
  /** Until when the newest turn's runner is held to be at work; absent from a statement before it was carried. */
  turnLeaseUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  turnSessionEnded: EffectSchema.NullOr(EffectSchema.Boolean),
  awaitingLineAt: EffectSchema.NullOr(countedNumber),
  failureWord: EffectSchema.NullOr(EffectSchema.Literals(Object.values(AGENT_FAILURE))),
};

/** One run as its row delivers it. */
const runLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  firedAt: countedNumber,
  settledAt: EffectSchema.NullOr(countedNumber),
  ...runAgentFields,
});

/** Latest fired first, and by id among those fired at one instant, as the held history orders runs. */
const LATEST_FIRED = [
  ["firedAt", ORDER.DESC],
  ["id", ORDER.DESC],
] as const;

/** One automation as its row delivers it, its newest run's columns beside it, null where it has run none. */
const automationLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  userId: EffectSchema.String,
  taskId: EffectSchema.NullOr(EffectSchema.String),
  taskName: EffectSchema.NullOr(EffectSchema.String),
  name: EffectSchema.String,
  enabled: EffectSchema.Boolean,
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: EffectSchema.NullOr(countedNumber),
  organizationId: EffectSchema.NullOr(EffectSchema.String),
  scope: automationScopeSchema,
  repositories: EffectSchema.Array(EffectSchema.String),
  /** The task's repository, which an automation with none of its own works in, as the held read reads it. */
  taskRepository: EffectSchema.NullOr(EffectSchema.String),
  targetKind: automationTargetKindSchema,
  targetAgentId: EffectSchema.NullOr(EffectSchema.String),
  archiveSuccessful: EffectSchema.Boolean,
  slackDelivery: EffectSchema.Boolean,
  createdAt: countedNumber,
  mine: EffectSchema.Boolean,
  runId: EffectSchema.NullOr(EffectSchema.String),
  runFiring: EffectSchema.NullOr(automationFiringSchema),
  runStatus: EffectSchema.NullOr(automationRunStatusSchema),
  runReason: EffectSchema.NullOr(automationRunReasonSchema),
  runFiredAt: EffectSchema.NullOr(countedNumber),
  runSettledAt: EffectSchema.NullOr(countedNumber),
  ...runAgentFields,
});

/**
 * A workspace's automations as its Automations page follows them: one part,
 * every automation of the workspace under `?workspaceId=` the account may
 * read, each with its newest run, newest made first. The service refuses an
 * empty workspace as `invalid-request`, and answers `unavailable` where its
 * deployment's Realtime is misconfigured.
 */
export const AUTOMATIONS_READ = liveRead({
  name: LIVE_READ.AUTOMATIONS,
  path: HOSTED_SERVICE_PATH.LIVE_AUTOMATIONS,
  params: { workspaceId: LIVE_PARAM.TEXT, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    automations: liveRows({
      row: automationLiveRowSchema,
      key: "id",
      order: [
        ["createdAt", ORDER.DESC],
        ["id", ORDER.DESC],
      ],
    }),
  },
});

/**
 * A workspace's runs as its Runs tab follows them: one part, the newest
 * runs of every automation of the workspace under `?workspaceId=` the
 * account may read, each with the automation it is a run of, latest fired
 * first, on the terms the automations are.
 */
export const AUTOMATION_WORKSPACE_RUNS_READ = liveRead({
  name: LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
  path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_WORKSPACE_RUNS,
  params: { workspaceId: LIVE_PARAM.TEXT, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    runs: liveRows({
      row: EffectSchema.Struct({
        ...runLiveRowSchema.fields,
        automationId: EffectSchema.String,
        automationName: EffectSchema.String,
      }),
      key: "id",
      order: LATEST_FIRED,
    }),
  },
});

/**
 * One automation's runs as its history follows them: one part, the newest
 * runs of the automation under `?id=`, latest fired first, woken on the
 * topic of the workspace it stands in, which the service reads it by. The
 * service answers `not-found` for an automation the account does not read.
 */
export const AUTOMATION_RUNS_READ = liveRead({
  name: LIVE_READ.AUTOMATION_RUNS,
  path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_RUNS,
  params: {
    id: LIVE_PARAM.ID,
    workspaceId: LIVE_PARAM.SERVED,
    [LIVE_USER_QUERY]: LIVE_PARAM.USER,
  },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { runs: liveRows({ row: runLiveRowSchema, key: "id", order: LATEST_FIRED }) },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type AutomationRunsLiveAnswer = LiveReadAnswer<typeof AUTOMATION_RUNS_READ>;

export type AutomationsLiveRows = typeof AUTOMATIONS_READ.rows.Type;

export type AutomationRunsLiveRows = typeof AUTOMATION_RUNS_READ.rows.Type;

export type AutomationWorkspaceRunsLiveRows = typeof AUTOMATION_WORKSPACE_RUNS_READ.rows.Type;

type RunAgentRow = EffectSchema.Struct<typeof runAgentFields>["Type"];

/** The newest turn as the status rule reads it; none where the agent has none. */
function turnOf(row: RunAgentRow): StatusTurn | undefined {
  return row.turnId === null || row.turnStatus === null
    ? undefined
    : {
        status: row.turnStatus,
        cancelRequested: row.cancelRequested === true,
        queuedAt: row.turnQueuedAt ?? row.agentCreatedAt ?? 0,
        settledAt: row.turnSettledAt,
        sessionEnded: row.turnSessionEnded === true,
        leaseUntil: row.turnLeaseUntil ?? undefined,
      };
}

/**
 * A run's agent as the wire says it, its status read at `now` and why it
 * failed where it did, and finished where a later run went to the same
 * agent (`handedOnRuns`); none where the run started none.
 */
function runAgentOf(
  row: RunAgentRow,
  now: number,
  handedOn = false,
): AutomationRunSummary["agent"] {
  if (row.agentId === null || row.agentCreatedAt === null) return null;
  const status = handedOn
    ? AGENT_STATUS.COMPLETED
    : agentStatusAt(turnOf(row), {
        createdAt: row.agentCreatedAt,
        now,
        awaitingLineAt: row.awaitingLineAt ?? undefined,
      });
  const failureReason =
    status === AGENT_STATUS.FAILED && row.failureWord !== null ? row.failureWord : undefined;
  return {
    id: row.agentId,
    title: row.agentTitle,
    status,
    ownKey: row.ownKey === true,
    ...(failureReason === undefined ? undefined : { failureReason }),
  };
}

/** The next instant past `now` the clock alone moves a run's agent; none where only a row moves it. */
function clockEdgeOf(row: RunAgentRow, now: number): number | undefined {
  if (row.agentCreatedAt === null) return undefined;
  return statusClockEdge(turnOf(row), {
    createdAt: row.agentCreatedAt,
    now,
    awaitingLineAt: row.awaitingLineAt ?? undefined,
  });
}

/** The earliest of the edges given; none where there is none. */
function earliest(edges: readonly (number | undefined)[]): number | undefined {
  const standing = edges.filter((edge): edge is number => edge !== undefined);
  return standing.length === 0 ? undefined : Math.min(...standing);
}

/**
 * The runs, latest fired first, whose agent a later run went to. Note that a
 * same-agent automation hands every run to one agent, whose newest turn is
 * its latest run's work, so the agent's status is said on that run alone,
 * and an earlier one reads as finished, rather than every run it ever took
 * reading as at work.
 */
function handedOnRuns(
  rows: readonly { readonly id: string; readonly agentId: string | null }[],
): ReadonlySet<string> {
  const taken = new Set<string>();
  const handedOn = new Set<string>();
  for (const row of rows) {
    if (row.agentId === null) continue;
    if (taken.has(row.agentId)) handedOn.add(row.id);
    taken.add(row.agentId);
  }
  return handedOn;
}

/** One automation's newest run as the list says it; none where it has run none. */
function lastRunOf(
  row: typeof automationLiveRowSchema.Type,
  now: number,
): AutomationRunSummary | null {
  if (
    row.runId === null ||
    row.runFiring === null ||
    row.runStatus === null ||
    row.runFiredAt === null
  ) {
    return null;
  }
  return {
    id: row.runId,
    firing: row.runFiring,
    status: row.runStatus,
    reason: row.runReason,
    agent: runAgentOf(row, now),
    firedAt: row.runFiredAt,
    settledAt: row.runSettledAt,
  };
}

/** A webhook automation with the address its caller posts to, on the service at `serviceBaseUrl`; any other as it came. */
export function withWebhookUrl(
  serviceBaseUrl: string,
  automation: AutomationSummary,
): AutomationSummary {
  if (automation.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) return automation;
  return { ...automation, webhookUrl: `${serviceBaseUrl}${automationWebhookPath(automation.id)}` };
}

/**
 * A workspace's automations as the held list answers them through a client
 * of the service at `serviceBaseUrl`, as the live rows stand at `now`:
 * newest made first, each with its newest run.
 */
export function automationsOfLiveRows(
  rows: AutomationsLiveRows,
  now: number,
  serviceBaseUrl: string,
): readonly AutomationSummary[] {
  return orderedLiveRows(AUTOMATIONS_READ.parts.automations, rows.automations).map((row) =>
    withWebhookUrl(serviceBaseUrl, {
      id: row.id,
      planId: row.taskId,
      planName: row.taskName,
      ...(row.organizationId === null ? undefined : { workspaceId: row.organizationId }),
      name: row.name,
      enabled: row.enabled,
      pausedReason: null,
      trigger: row.trigger,
      action: row.action,
      guards: row.guards,
      nextRunAt: row.nextRunAt,
      lastRun: lastRunOf(row, now),
      createdAt: row.createdAt,
      scope: row.scope,
      repositories:
        row.repositories.length === 0 && row.taskRepository !== null
          ? [row.taskRepository]
          : row.repositories,
      target:
        row.targetKind === AUTOMATION_TARGET.SAME_AGENT
          ? { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: row.targetAgentId }
          : { kind: AUTOMATION_TARGET.NEW_AGENT },
      archiveSuccessful: row.archiveSuccessful,
      slackDelivery: row.slackDelivery,
      mine: row.mine,
      creatorId: row.userId,
    }),
  );
}

/** An automation's runs as the held history answers them, as the live rows stand at `now`: latest fired first, an agent's status said on the latest run it took. */
export function automationRunsOfLiveRows(
  rows: AutomationRunsLiveRows,
  now: number,
): readonly AutomationRunSummary[] {
  const runs = orderedLiveRows(AUTOMATION_RUNS_READ.parts.runs, rows.runs);
  const handedOn = handedOnRuns(runs);
  return runs.map((row) => ({
    id: row.id,
    firing: row.firing,
    status: row.status,
    reason: row.reason,
    agent: runAgentOf(row, now, handedOn.has(row.id)),
    firedAt: row.firedAt,
    settledAt: row.settledAt,
  }));
}

/** A workspace's runs as the Runs tab reads them, newest first, each run's agent read at `now` and said on the latest run it took. */
export function automationWorkspaceRunsOfLiveRows(
  rows: AutomationWorkspaceRunsLiveRows,
  now: number,
): readonly AutomationWorkspaceRun[] {
  const runs = orderedLiveRows(AUTOMATION_WORKSPACE_RUNS_READ.parts.runs, rows.runs);
  const handedOn = handedOnRuns(runs);
  return runs.map((row) => ({
    id: row.id,
    firing: row.firing,
    status: row.status,
    reason: row.reason,
    agent: runAgentOf(row, now, handedOn.has(row.id)),
    firedAt: row.firedAt,
    settledAt: row.settledAt,
    automation: { id: row.automationId, name: row.automationName },
  }));
}

/** The next instant past `now` the clock alone moves the automations' newest runs; none where only a row moves them. */
export function automationsGraceEdge(rows: AutomationsLiveRows, now: number): number | undefined {
  return earliest(rows.automations.map((row) => clockEdgeOf(row, now)));
}

/** The next instant past `now` the clock alone moves an automation's runs; none where only a row moves them. */
export function automationRunsGraceEdge(
  rows: AutomationRunsLiveRows,
  now: number,
): number | undefined {
  return earliest(rows.runs.map((row) => clockEdgeOf(row, now)));
}

/** The next instant past `now` the clock alone moves a workspace's runs; none where only a row moves them. */
export function automationWorkspaceRunsGraceEdge(
  rows: AutomationWorkspaceRunsLiveRows,
  now: number,
): number | undefined {
  return earliest(rows.runs.map((row) => clockEdgeOf(row, now)));
}
