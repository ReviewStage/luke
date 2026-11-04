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

/**
 * automation-sweep.ts -- the minute sweep's share of automations: claim the schedules due, once each, as queued runs, then act on the runs queued.
 *
 * Vercel's cron calls the sweep once a minute and may call the same minute
 * twice, so the claim is the store's own (`claimDueAutomations`): a row
 * locked by one claim is skipped by the other, each due schedule is moved
 * on to its next instant in the zone it names before its run is recorded,
 * and the run is recorded under its due instant, which its dedupe key
 * holds to once. A schedule missed by more than the grace is moved on
 * without a run. At most `MAX_CLAIMS` are claimed a sweep, the soonest due
 * first, so a backlog drains over the minutes after rather than in one
 * sweep.
 *
 * Then every run still queued from the last hour, the schedules just
 * claimed and any a trigger recorded but did not finish acting on, is acted
 * on (`automation-runs.ts`), at most `MAX_RUNS` a sweep, oldest first: a few
 * automations at once, but one automation's runs one after another, since
 * each run's guards read what the one before it settled. A run two sweeps
 * both act on starts one agent, since the run's id is its Start's key, and
 * settles once. A run claimed for its start and left without its agent,
 * the function that claimed it gone, is settled as the agent its key made
 * where one stands and failed where none does. A run still queued two hours on, an hour past the last
 * sweep that would act on it, is settled as missed, so the history never
 * holds a run that will not come.
 *
 * Last, the agents of runs for automations that archive their successful
 * runs, the run's own agent and the helpers it started with no task alike,
 * are archived once each finished well, read as its tab reads it, holds
 * nothing open in the inbox, and has no pull request open or in draft,
 * since an archived agent hears nothing of a review on it. A run is
 * archived as one, once all its agents are done with, and settled once: an
 * agent archived here, one that failed or was stopped, and one the
 * developer already put away are marked so and never read again, so one
 * brought back stays; a run with an agent still at work, waiting on the
 * inbox, or with its pull request open is read again by a later sweep, for
 * a week.
 */

const AUTOMATION_SWEEP = {
  /** The most schedules one sweep claims. */
  MAX_CLAIMS: 25,
  /** The most queued runs one sweep acts on. */
  MAX_RUNS: 12,
  /** How many runs are acted on at once. */
  CONCURRENCY: 4,
  /** How long a claimed run may stand without its agent before it is recovered: a start runs in seconds. */
  STRANDED_AFTER_MS: 10 * 60_000,
  /** How far back a queued run is still acted on. */
  QUEUED_WITHIN_MS: 60 * 60_000,
  /**
   * How old a queued run is before it is settled as missed. Note that it is
   * an hour past the window above, because a run acted on near the window's
   * edge must settle on its own before the expiry could reach it.
   */
  EXPIRED_AFTER_MS: 2 * 60 * 60_000,
  /** How far back a run's agent is still archived once it finished: a week, so one whose inbox item was answered days later still is. */
  ARCHIVE_WITHIN_MS: 7 * 24 * 60 * 60_000,
  /** The most run agents one sweep reads for archiving. */
  MAX_ARCHIVE_READS: 100,
} as const;

/** What the sweep's share did: how many schedules it fired, and how the runs it acted on came out. */
export interface AutomationSweepOutcome {
  readonly fired: number;
  readonly started: number;
  readonly skipped: number;
  readonly failed: number;
  /** How many agents of runs that finished well were archived for their automations. */
  readonly archived: number;
}

/** When a trigger is next due after `after`: a schedule's next instant, and never for any other trigger. */
function nextAfter(trigger: AutomationTrigger, after: Date): Date | null {
  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return null;
  return nextScheduledRun(trigger, after) ?? null;
}

/** Claims the schedules due at `now`, answering the runs it queued. */
function claimDueSchedules(now: number): TaskStoreEffect<readonly ClaimedFiring[]> {
  return claimDueAutomations({
    now: new Date(now),
    limit: AUTOMATION_SWEEP.MAX_CLAIMS,
    graceMs: AUTOMATION_SCHEDULE.MISFIRE_GRACE_MS,
    nextAfter,
  });
}

/** The runs grouped by their automation, each group oldest first as the runs came. */
function byAutomation(runs: readonly AutomationRun[]): readonly (readonly AutomationRun[])[] {
  const groups = new Map<string, AutomationRun[]>();
  for (const run of runs) {
    const group = groups.get(run.automationId);
    if (group === undefined) groups.set(run.automationId, [run]);
    else group.push(run);
  }
  return [...groups.values()];
}

/** The statuses an agent ends on that its automation never archives: it failed, or it was stopped. */
const ENDED_UNWELL: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.FAILED,
  AGENT_STATUS.CANCELED,
]);

/** An agent "Archive finished runs" may put away, as its reader saw it: whose it is, its id, its conversation and how far its lines had run, when it was made, and when it was put away where it already was. */
export type FinishedAgentRead = Pick<
  ArchivableRunAgent,
  "userId" | "agentId" | "conversationId" | "createdAt" | "archivedAt" | "conversationSeq"
>;

/** What came of one: the agent as read, where it stands, whether it was archived now, and whether nothing failed letting it go on its device. */
export interface FinishedAgentArchive<A extends FinishedAgentRead> {
  readonly agent: A;
  readonly status: AgentStatus;
  readonly archived: boolean;
  readonly discarded: boolean;
}

/** Where each agent stands at `now`, read as its tab reads it, by agent id. */
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

/** The agents archived as their statuses were read, each answered in order, as `archiveFinishedAgents` says. */
function archiveAsRead<A extends FinishedAgentRead>(
  agents: readonly A[],
  statuses: ReadonlyMap<string, AgentStatus>,
) {
  return Effect.forEach(agents, (agent) =>
    Effect.gen(function* () {
      const status = statuses.get(agent.agentId) ?? AGENT_STATUS.RUNNING;
      const finishedWell = agent.archivedAt === null && status === AGENT_STATUS.COMPLETED;
      // Note that the archive takes only while the agent's lines stand where they were read, so
      // one woken since, or whose starter left, stands and is read again later.
      const archived =
        finishedWell &&
        (yield* archiveUnmovedAgent(agent.userId, agent.agentId, agent.conversationSeq));
      // A local agent archived is let go of on its device, as an archive by hand lets it go.
      const discarded =
        archived || agent.archivedAt !== null
          ? yield* discardedOrLogged({ id: agent.agentId, userId: agent.userId })
          : true;
      return { agent, status, archived, discarded } satisfies FinishedAgentArchive<A>;
    }),
  );
}

/**
 * The agents archived under "Archive finished runs"' rule, each answered in
 * order: one standing unarchived that finished well, read as its tab reads
 * it, is archived only while its lines stand where they were read and it
 * holds no pull request or inbox item open (`archiveUnmovedAgent`), and a
 * local one archived, now or before, is let go of on its device. Note that
 * the rule is shared, because an agent started from Slack is archived by it
 * too once a turn of its settles (`../slack/slack-agent-starts.ts`).
 */
export function archiveFinishedAgents<A extends FinishedAgentRead>(
  agents: readonly A[],
  now: number,
) {
  return Effect.flatMap(finishedStatuses(agents, now), (statuses) =>
    archiveAsRead(agents, statuses),
  );
}

/** Whether the agent is done with, for its run: put away already, or ended well or not. */
const doneWith = (agent: ArchivableRunAgent, status: AgentStatus) =>
  agent.archivedAt !== null || status === AGENT_STATUS.COMPLETED || ENDED_UNWELL.has(status);

/** The agents read grouped by their run, each group in the order read. */
function byRun(agents: readonly ArchivableRunAgent[]): readonly (readonly ArchivableRunAgent[])[] {
  const groups = new Map<string, ArchivableRunAgent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.runId);
    if (group === undefined) groups.set(agent.runId, [agent]);
    else group.push(agent);
  }
  return [...groups.values()];
}

/**
 * The agents of runs that finished well archived for automations that ask
 * it, answering how many. Note that a run is archived as one, because its
 * agents are kept together: only once every agent it has was read and is
 * done with, so a helper still at work, or held back by its inbox item or
 * pull request, keeps the whole run standing for a later sweep, and the run
 * is settled only once each of its agents is, so none is left unread.
 */
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
  // A run stays unsettled until every agent's discard is queued, so a later sweep asks again.
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

/** The sweep's share at `now`: the schedules due claimed and queued, then the runs queued acted on, then the finished runs' agents archived where asked. */
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
