import { Schema as EffectSchema } from "effect";
import {
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  automationActionSchema,
  automationFiringSchema,
  automationGuardsSchema,
  automationRunReasonSchema,
  automationRunStatusSchema,
  automationScopeSchema,
  automationTargetKindSchema,
  automationTriggerSchema,
} from "./automation-wire.js";
import { codingAgentStatusAt, type StatusTurn, startingGraceEdge } from "./coding-agent-status.js";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { automationWebhookPath } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";

/**
 * automation-live.ts -- a workspace's automations and one automation's runs followed over Neon Realtime: the sealed statements the service answers, the rows they deliver, and the list and the history as the held reads answer them, built from the rows at an instant.
 *
 * A run's agent's status turns on the clock (`coding-agent-status.ts`), so
 * the reader builds each at the instant it reads, and again at
 * `automationsGraceEdge` or `automationRunsGraceEdge`, the next instant the
 * clock alone moves one. A webhook automation is answered with the address
 * its caller posts to on the service the reader reaches, as the held read's
 * client answers it. Realtime keeps no order, so the reader orders.
 */

/** A workspace's automations sealed for following: the address, and one statement. The service answers `unavailable` where its deployment has no Realtime. */
export const automationsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ automations: sealedLiveQuerySchema }),
});

export type AutomationsLiveAnswer = typeof automationsLiveAnswerSchema.Type;

/** An automation's runs sealed for following: the address, and one statement. The service answers `not-found` for an automation the account does not read. */
export const automationRunsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({ runs: sealedLiveQuerySchema }),
});

export type AutomationRunsLiveAnswer = typeof automationRunsLiveAnswerSchema.Type;

/** The agent a run started as its row delivers it, and what its status is read from; null throughout where it started none, or it is gone. */
const runAgentFields = {
  agentId: EffectSchema.NullOr(EffectSchema.String),
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  agentCreatedAt: EffectSchema.NullOr(countedNumber),
  ownKey: EffectSchema.NullOr(EffectSchema.Boolean),
  turnId: EffectSchema.NullOr(EffectSchema.String),
  turnStatus: EffectSchema.NullOr(EffectSchema.String),
  cancelRequested: EffectSchema.NullOr(EffectSchema.Boolean),
  lineAwaits: EffectSchema.Boolean,
  failureWord: EffectSchema.NullOr(EffectSchema.Literals(Object.values(CODING_AGENT_FAILURE))),
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
  targetKind: automationTargetKindSchema,
  targetAgentId: EffectSchema.NullOr(EffectSchema.String),
  archiveSuccessful: EffectSchema.Boolean,
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

/** A workspace's automations as Realtime delivers them, decoded at the boundary before anything reads them. */
export const automationsLiveRowsSchema = EffectSchema.Struct({
  automations: EffectSchema.Array(automationLiveRowSchema),
});

export type AutomationsLiveRows = typeof automationsLiveRowsSchema.Type;

/** An automation's runs as Realtime delivers them, decoded at the boundary before anything reads them. */
export const automationRunsLiveRowsSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(runLiveRowSchema),
});

export type AutomationRunsLiveRows = typeof automationRunsLiveRowsSchema.Type;

type RunAgentRow = {
  readonly [Key in keyof typeof runAgentFields]: (typeof runAgentFields)[Key]["Type"];
};

/** The newest turn as the status rule reads it; none where the agent has none. */
function turnOf(row: RunAgentRow): StatusTurn | undefined {
  return row.turnId === null || row.turnStatus === null
    ? undefined
    : { status: row.turnStatus, cancelRequested: row.cancelRequested === true };
}

/** A run's agent as the wire says it, its status read at `now` and why it failed where it did; none where the run started none. */
function runAgentOf(row: RunAgentRow, now: number): AutomationRunSummary["agent"] {
  if (row.agentId === null || row.agentCreatedAt === null) return null;
  const status = codingAgentStatusAt(turnOf(row), {
    createdAt: row.agentCreatedAt,
    now,
    lineAwaits: row.lineAwaits,
  });
  const failureReason =
    status === CODING_AGENT_STATUS.FAILED && row.failureWord !== null ? row.failureWord : undefined;
  return {
    id: row.agentId,
    title: row.agentTitle,
    status,
    ownKey: row.ownKey === true,
    ...(failureReason === undefined ? undefined : { failureReason }),
  };
}

/** The next instant past `now` the clock alone moves a run's agent; none where nothing but a row moves it. */
function graceEdgeOf(row: RunAgentRow, now: number): number | undefined {
  if (row.agentCreatedAt === null) return undefined;
  return startingGraceEdge(turnOf(row), {
    createdAt: row.agentCreatedAt,
    now,
    lineAwaits: row.lineAwaits,
  });
}

/** The earliest of the edges given; none where there is none. */
function earliest(edges: readonly (number | undefined)[]): number | undefined {
  const standing = edges.filter((edge): edge is number => edge !== undefined);
  return standing.length === 0 ? undefined : Math.min(...standing);
}

/** Latest fired first, and by id among those fired at one instant, as the held history orders runs. */
function latestFired(
  a: { readonly id: string; readonly firedAt: number },
  b: { readonly id: string; readonly firedAt: number },
): number {
  if (a.firedAt !== b.firedAt) return b.firedAt - a.firedAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
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
        repositories: row.repositories,
        target:
          row.targetKind === AUTOMATION_TARGET.SAME_AGENT
            ? { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: row.targetAgentId }
            : { kind: AUTOMATION_TARGET.NEW_AGENT },
        archiveSuccessful: row.archiveSuccessful,
        mine: row.mine,
        creatorId: row.userId,
      }),
    );
}

/** An automation's runs as the held history answers them, as the live rows stand at `now`: latest fired first. */
export function automationRunsOfLiveRows(
  rows: AutomationRunsLiveRows,
  now: number,
): readonly AutomationRunSummary[] {
  return rows.runs.toSorted(latestFired).map((row) => ({
    id: row.id,
    firing: row.firing,
    status: row.status,
    reason: row.reason,
    agent: runAgentOf(row, now),
    firedAt: row.firedAt,
    settledAt: row.settledAt,
  }));
}

/** The next instant past `now` the clock alone moves the automations' newest runs. */
export function automationsGraceEdge(rows: AutomationsLiveRows, now: number): number | undefined {
  return earliest(rows.automations.map((row) => graceEdgeOf(row, now)));
}

/** The next instant past `now` the clock alone moves an automation's runs. */
export function automationRunsGraceEdge(
  rows: AutomationRunsLiveRows,
  now: number,
): number | undefined {
  return earliest(rows.runs.map((row) => graceEdgeOf(row, now)));
}
