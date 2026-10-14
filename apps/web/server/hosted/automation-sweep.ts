import {
  type ClaimedFiring,
  claimDueAutomations,
  queuedAutomationRuns,
} from "@sidecar/database/models/automation-store";
import type { PlanStoreEffect } from "@sidecar/database/models/plan-store";
import { AUTOMATION_SCHEDULE, nextScheduledRun } from "@sidecar/hosted/automation-schedule";
import {
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunStatus,
  type AutomationTrigger,
} from "@sidecar/hosted/automation-wire";
import { Effect } from "effect";
import { type EveForAccount, executeAutomationRun } from "./automation-runs.js";
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
 * on (`automation-runs.ts`), a few at once and at most `MAX_RUNS` a sweep,
 * oldest first. A run two sweeps both act on starts one agent, since the
 * run's id is its Start's key, and settles once.
 */

const AUTOMATION_SWEEP = {
  /** The most schedules one sweep claims. */
  MAX_CLAIMS: 25,
  /** The most queued runs one sweep acts on. */
  MAX_RUNS: 12,
  /** How many runs are acted on at once. */
  CONCURRENCY: 4,
  /** How far back a queued run is still acted on; older is left as it stands. */
  QUEUED_WITHIN_MS: 60 * 60_000,
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
  const outcomes = yield* Effect.forEach(queued, (run) => executeAutomationRun(eveFor, run), {
    concurrency: AUTOMATION_SWEEP.CONCURRENCY,
  });
  const counted = (status: AutomationRunStatus) =>
    outcomes.filter((outcome) => outcome?.status === status).length;
  return {
    fired: claimed.length,
    started: counted(AUTOMATION_RUN_STATUS.STARTED),
    skipped: counted(AUTOMATION_RUN_STATUS.SKIPPED),
    failed: counted(AUTOMATION_RUN_STATUS.FAILED),
  };
});
