import {
  type AutomationRun,
  archivableRunAgents,
  type ClaimedFiring,
  claimDueAutomations,
  expireQueuedAutomationRuns,
  queuedAutomationRuns,
  settleRunArchive,
  strandedAutomationRuns,
} from "@luke/database/models/automation-store";
import {
  archiveUnmovedCodingAgent,
  awaitingLinesOfReached,
  latestTurnsOfReached,
} from "@luke/database/models/coding-agent-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { AUTOMATION_SCHEDULE, nextScheduledRun } from "@luke/features/automation-schedule";
import {
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunStatus,
  type AutomationTrigger,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS, type CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { Effect } from "effect";
import type { StartServices } from "../agents/coder-host/start.js";
import { codingAgentStatusOf } from "../agents/coder-host/status.js";
import { type EveForAccount, executeAutomationRun, recoverStrandedRun } from "./automation-runs.js";

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
 * function's sixty seconds.
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
 * Last, the agents runs started for automations that archive their
 * successful runs are archived once each finished well, read as its tab
 * reads it, and holds nothing open in the inbox. Each is settled once: an
 * agent archived here, one that failed or was stopped, and one the
 * developer already put away are marked so and never read again, so one
 * brought back stays; one still at work or waiting on the inbox is read
 * again by a later sweep, for a week.
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
const ENDED_UNWELL: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.FAILED,
  CODING_AGENT_STATUS.CANCELLED,
]);

/** The agents of runs that finished well archived for automations that ask it, as above, answering how many. */
const archiveFinishedRunAgents = Effect.fnUntraced(function* (now: number) {
  const agents = yield* archivableRunAgents(
    new Date(now - AUTOMATION_SWEEP.ARCHIVE_WITHIN_MS),
    AUTOMATION_SWEEP.MAX_ARCHIVE_READS,
  );
  const conversations = agents.map((agent) => agent.conversationId);
  const turns = yield* latestTurnsOfReached(conversations);
  const awaiting = yield* awaitingLinesOfReached(conversations);
  const archived = yield* Effect.forEach(agents, (agent) =>
    Effect.gen(function* () {
      const status = codingAgentStatusOf(turns.get(agent.conversationId), {
        createdAt: agent.createdAt,
        now,
        lineAwaits: awaiting.has(agent.conversationId),
      });
      const finishedWell = agent.archivedAt === null && status === CODING_AGENT_STATUS.COMPLETED;
      // Note that the archive takes only while the agent's lines stand where they were read, so
      // one woken since, or whose starter left, stands and is read again by a later sweep.
      const archived =
        finishedWell &&
        (yield* archiveUnmovedCodingAgent(
          agent.userId,
          agent.codingAgentId,
          agent.conversationSeq,
        ));
      if (archived || agent.archivedAt !== null || ENDED_UNWELL.has(status)) {
        yield* settleRunArchive(agent.runId);
      }
      return archived;
    }),
  );
  return archived.filter(Boolean).length;
});

/** The sweep's share at `now`: the schedules due claimed and queued, then the runs queued acted on, then the finished runs' agents archived where asked. */
export const sweepAutomations = /* @__PURE__ */ Effect.fn("web/sweepAutomations")(function* (
  eveFor: EveForAccount,
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
    (runs) => Effect.forEach(runs, (run) => executeAutomationRun(eveFor, run)),
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
