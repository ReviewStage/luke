import {
  type AutomationRun,
  type ClaimedFiring,
  claimDueAutomations,
  expireQueuedAutomationRuns,
  queuedAutomationRuns,
  strandedAutomationRuns,
} from "@sidecar/database/models/automation-store";
import type { PlanStoreEffect } from "@sidecar/database/models/plan-store";
import { AUTOMATION_SCHEDULE, nextScheduledRun } from "@sidecar/hosted/automation-schedule";
import {
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunStatus,
  type AutomationTrigger,
} from "@sidecar/hosted/automation-wire";
import { Effect } from "effect";
import { type EveForAccount, executeAutomationRun, recoverStrandedRun } from "./automation-runs.js";
import type { StartServices } from "./coder-host/start.js";

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
} as const;

/** What the sweep's share did: how many schedules it fired, and how the runs it acted on came out. */
export interface AutomationSweepOutcome {
  readonly fired: number;
  readonly started: number;
  readonly skipped: number;
  readonly failed: number;
}

/** When a trigger is next due after `after`: a schedule's next instant, and never for any other trigger. */
function nextAfter(trigger: AutomationTrigger, after: Date): Date | null {
  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE) return null;
  return nextScheduledRun(trigger, after) ?? null;
}

/** Claims the schedules due at `now`, answering the runs it queued. */
function claimDueSchedules(now: number): PlanStoreEffect<readonly ClaimedFiring[]> {
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

/** The sweep's share at `now`: the schedules due claimed and queued, then the runs queued acted on. */
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
  };
});
