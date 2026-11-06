import {
  archiveUnmovedAgent,
  awaitingLinesOfReached,
  latestTurnsOfReached,
} from "@repo/database/models/agent-store";
import {
  type ArchivableRunAgent,
  type AutomationRun,
  archivableRunAgents,
  type ClaimedFiring,
  claimDueAutomations,
  expireQueuedAutomationRuns,
  queuedAutomationRuns,
  settleRunArchive,
  strandedAutomationRuns,
} from "@repo/database/models/automation-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import { AUTOMATION_SCHEDULE, nextScheduledRun } from "@repo/features/automation-schedule";
import {
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunStatus,
  type AutomationTrigger,
} from "@repo/features/automation-wire";
import { Effect } from "effect";
import type { StartServices } from "../agents/coder-host/start.js";
import { agentStatusOf } from "../agents/coder-host/status.js";
import { discardedOrLogged } from "../agents/device-discard.js";
import {
  executeAutomationRun,
  recoverStrandedRun,
  type SessionsForAccount,
} from "./automation-runs.js";

const AUTOMATION_SWEEP = {
  MAX_CLAIMS: 25,
  MAX_RUNS: 12,
  CONCURRENCY: 4,
  STRANDED_AFTER_MS: 10 * 60_000,
  QUEUED_WITHIN_MS: 60 * 60_000,
  EXPIRED_AFTER_MS: 2 * 60 * 60_000,
  ARCHIVE_WITHIN_MS: 7 * 24 * 60 * 60_000,
  MAX_ARCHIVE_READS: 100,
} as const;

export interface AutomationSweepOutcome {
  readonly fired: number;
  readonly started: number;
  readonly skipped: number;
  readonly failed: number;
  readonly archived: number;
}

function nextAfter(trigger: AutomationTrigger, after: Date): Date | null {
  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return null;
  return nextScheduledRun(trigger, after) ?? null;
}

function claimDueSchedules(now: number): TaskStoreEffect<readonly ClaimedFiring[]> {
  return claimDueAutomations({
    now: new Date(now),
    limit: AUTOMATION_SWEEP.MAX_CLAIMS,
    graceMs: AUTOMATION_SCHEDULE.MISFIRE_GRACE_MS,
    nextAfter,
  });
}

function byAutomation(runs: readonly AutomationRun[]): readonly (readonly AutomationRun[])[] {
  const groups = new Map<string, AutomationRun[]>();
  for (const run of runs) {
    const group = groups.get(run.automationId);
    if (group === undefined) groups.set(run.automationId, [run]);
    else group.push(run);
  }
  return [...groups.values()];
}

const ENDED_UNWELL: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.FAILED,
  AGENT_STATUS.CANCELED,
]);

export type FinishedAgentRead = Pick<
  ArchivableRunAgent,
  "userId" | "agentId" | "conversationId" | "createdAt" | "archivedAt" | "conversationSeq"
>;

export interface FinishedAgentArchive<A extends FinishedAgentRead> {
  readonly agent: A;
  readonly status: AgentStatus;
  readonly archived: boolean;
  readonly discarded: boolean;
}

function finishedStatuses(agents: readonly FinishedAgentRead[], now: number) {
  return Effect.gen(function* () {
    const conversations = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(conversations);
    const awaiting = yield* awaitingLinesOfReached(conversations);
    return new Map(
      agents.map((agent) => [
        agent.agentId,
        agentStatusOf(turns.get(agent.conversationId), {
          createdAt: agent.createdAt,
          now,
          awaitingLineAt: awaiting.get(agent.conversationId),
        }),
      ]),
    );
  });
}

function archiveAsRead<A extends FinishedAgentRead>(
  agents: readonly A[],
  statuses: ReadonlyMap<string, AgentStatus>,
) {
  return Effect.forEach(agents, (agent) =>
    Effect.gen(function* () {
      const status = statuses.get(agent.agentId) ?? AGENT_STATUS.RUNNING;
      const finishedWell = agent.archivedAt === null && status === AGENT_STATUS.COMPLETED;
      const archived =
        finishedWell &&
        (yield* archiveUnmovedAgent(agent.userId, agent.agentId, agent.conversationSeq));
      const discarded =
        archived || agent.archivedAt !== null
          ? yield* discardedOrLogged({ id: agent.agentId, userId: agent.userId })
          : true;
      return { agent, status, archived, discarded } satisfies FinishedAgentArchive<A>;
    }),
  );
}

export function archiveFinishedAgents<A extends FinishedAgentRead>(
  agents: readonly A[],
  now: number,
) {
  return Effect.flatMap(finishedStatuses(agents, now), (statuses) =>
    archiveAsRead(agents, statuses),
  );
}

const doneWith = (agent: ArchivableRunAgent, status: AgentStatus) =>
  agent.archivedAt !== null || status === AGENT_STATUS.COMPLETED || ENDED_UNWELL.has(status);

function byRun(agents: readonly ArchivableRunAgent[]): readonly (readonly ArchivableRunAgent[])[] {
  const groups = new Map<string, ArchivableRunAgent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.runId);
    if (group === undefined) groups.set(agent.runId, [agent]);
    else group.push(agent);
  }
  return [...groups.values()];
}

const archiveFinishedRunAgents = Effect.fnUntraced(function* (now: number) {
  const read = yield* archivableRunAgents(
    new Date(now - AUTOMATION_SWEEP.ARCHIVE_WITHIN_MS),
    AUTOMATION_SWEEP.MAX_ARCHIVE_READS,
  );
  const statuses = yield* finishedStatuses(read, now);
  const finishedRuns = byRun(read).filter(
    (run) =>
      run.length === run[0]?.runAgents &&
      run.every((agent) => doneWith(agent, statuses.get(agent.agentId) ?? AGENT_STATUS.RUNNING)),
  );
  const outcomes = yield* Effect.forEach(finishedRuns, (run) => archiveAsRead(run, statuses));
  yield* Effect.forEach(
    outcomes,
    (run) =>
      run.every(
        ({ agent, status, archived, discarded }) =>
          discarded && (archived || agent.archivedAt !== null || ENDED_UNWELL.has(status)),
      ) && run[0] !== undefined
        ? settleRunArchive(run[0].agent.runId)
        : Effect.void,
    { discard: true },
  );
  return outcomes.flat().filter((outcome) => outcome.archived).length;
});

export const sweepAutomations = /* @__PURE__ */ Effect.fn("web/sweepAutomations")(function* (
  sessionsFor: SessionsForAccount,
  now: number,
): Effect.fn.Return<AutomationSweepOutcome, unknown, StartServices> {
  const claimed = yield* claimDueSchedules(now);
  const queued = yield* queuedAutomationRuns(
    new Date(now - AUTOMATION_SWEEP.QUEUED_WITHIN_MS),
    AUTOMATION_SWEEP.MAX_RUNS,
  );
  yield* expireQueuedAutomationRuns(
    new Date(now - AUTOMATION_SWEEP.EXPIRED_AFTER_MS),
    AUTOMATION_RUN_REASON.MISSED,
  );
  yield* Effect.forEach(
    yield* strandedAutomationRuns(
      new Date(now - AUTOMATION_SWEEP.STRANDED_AFTER_MS),
      AUTOMATION_SWEEP.MAX_RUNS,
    ),
    recoverStrandedRun,
  );
  const outcomes = (yield* Effect.forEach(
    byAutomation(queued),
    (runs) => Effect.forEach(runs, (run) => executeAutomationRun(sessionsFor, run)),
    { concurrency: AUTOMATION_SWEEP.CONCURRENCY },
  )).flat();
  const counted = (status: AutomationRunStatus) =>
    outcomes.filter((outcome) => outcome?.status === status).length;
  return {
    fired: claimed.length,
    started: counted(AUTOMATION_RUN_STATUS.STARTED),
    skipped: counted(AUTOMATION_RUN_STATUS.SKIPPED),
    failed: counted(AUTOMATION_RUN_STATUS.FAILED),
    archived: yield* archiveFinishedRunAgents(now),
  };
});
