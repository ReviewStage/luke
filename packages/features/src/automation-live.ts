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
import { sealedLiveQuerySchema } from "./live-wire.js";
import { automationWebhookPath } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";

export const automationsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ automations: sealedLiveQuerySchema }),
});

export type AutomationsLiveAnswer = typeof automationsLiveAnswerSchema.Type;

export const automationRunsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ runs: sealedLiveQuerySchema }),
});

export type AutomationRunsLiveAnswer = typeof automationRunsLiveAnswerSchema.Type;

export const automationWorkspaceRunsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ runs: sealedLiveQuerySchema }),
});

export type AutomationWorkspaceRunsLiveAnswer = typeof automationWorkspaceRunsLiveAnswerSchema.Type;

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
  turnSessionEnded: EffectSchema.NullOr(EffectSchema.Boolean),
  awaitingLineAt: EffectSchema.NullOr(countedNumber),
  failureWord: EffectSchema.NullOr(EffectSchema.Literals(Object.values(AGENT_FAILURE))),
};

const runLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  firedAt: countedNumber,
  settledAt: EffectSchema.NullOr(countedNumber),
  ...runAgentFields,
});

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

export const automationsLiveRowsSchema = EffectSchema.Struct({
  automations: EffectSchema.Array(automationLiveRowSchema),
});

export type AutomationsLiveRows = typeof automationsLiveRowsSchema.Type;

export const automationRunsLiveRowsSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(runLiveRowSchema),
});

export type AutomationRunsLiveRows = typeof automationRunsLiveRowsSchema.Type;

export const automationWorkspaceRunsLiveRowsSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(
    EffectSchema.Struct({
      ...runLiveRowSchema.fields,
      automationId: EffectSchema.String,
      automationName: EffectSchema.String,
    }),
  ),
});

export type AutomationWorkspaceRunsLiveRows = typeof automationWorkspaceRunsLiveRowsSchema.Type;

type RunAgentRow = {
  readonly [Key in keyof typeof runAgentFields]: (typeof runAgentFields)[Key]["Type"];
};

function turnOf(row: RunAgentRow): StatusTurn | undefined {
  return row.turnId === null || row.turnStatus === null
    ? undefined
    : {
        status: row.turnStatus,
        cancelRequested: row.cancelRequested === true,
        queuedAt: row.turnQueuedAt ?? row.agentCreatedAt ?? 0,
        settledAt: row.turnSettledAt,
        sessionEnded: row.turnSessionEnded === true,
      };
}

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

function clockEdgeOf(row: RunAgentRow, now: number): number | undefined {
  if (row.agentCreatedAt === null) return undefined;
  return statusClockEdge(turnOf(row), {
    createdAt: row.agentCreatedAt,
    now,
    awaitingLineAt: row.awaitingLineAt ?? undefined,
  });
}

function earliest(edges: readonly (number | undefined)[]): number | undefined {
  const standing = edges.filter((edge): edge is number => edge !== undefined);
  return standing.length === 0 ? undefined : Math.min(...standing);
}

function latestFired(
  a: { readonly id: string; readonly firedAt: number },
  b: { readonly id: string; readonly firedAt: number },
): number {
  if (a.firedAt !== b.firedAt) return b.firedAt - a.firedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

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

export function withWebhookUrl(
  serviceBaseUrl: string,
  automation: AutomationSummary,
): AutomationSummary {
  if (automation.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) return automation;
  return { ...automation, webhookUrl: `${serviceBaseUrl}${automationWebhookPath(automation.id)}` };
}

export function automationsOfLiveRows(
  rows: AutomationsLiveRows,
  now: number,
  serviceBaseUrl: string,
): readonly AutomationSummary[] {
  return rows.automations
    .toSorted((a, b) =>
      a.createdAt !== b.createdAt
        ? b.createdAt - a.createdAt
        : a.id < b.id
          ? 1
          : a.id > b.id
            ? -1
            : 0,
    )
    .map((row) =>
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

export function automationRunsOfLiveRows(
  rows: AutomationRunsLiveRows,
  now: number,
): readonly AutomationRunSummary[] {
  const runs = rows.runs.toSorted(latestFired);
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

export function automationWorkspaceRunsOfLiveRows(
  rows: AutomationWorkspaceRunsLiveRows,
  now: number,
): readonly AutomationWorkspaceRun[] {
  const runs = rows.runs.toSorted(latestFired);
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

export function automationsGraceEdge(rows: AutomationsLiveRows, now: number): number | undefined {
  return earliest(rows.automations.map((row) => clockEdgeOf(row, now)));
}

export function automationRunsGraceEdge(
  rows: AutomationRunsLiveRows,
  now: number,
): number | undefined {
  return earliest(rows.runs.map((row) => clockEdgeOf(row, now)));
}

export function automationWorkspaceRunsGraceEdge(
  rows: AutomationWorkspaceRunsLiveRows,
  now: number,
): number | undefined {
  return earliest(rows.runs.map((row) => clockEdgeOf(row, now)));
}
