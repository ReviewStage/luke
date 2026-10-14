import { type ClaimedFiring, claimDueAutomations } from "@sidecar/database/models/automation-store";
import type { PlanStoreEffect } from "@sidecar/database/models/plan-store";
import { AUTOMATION_SCHEDULE, nextScheduledRun } from "@sidecar/hosted/automation-schedule";
import { AUTOMATION_TRIGGER, type AutomationTrigger } from "@sidecar/hosted/automation-wire";
import { Effect } from "effect";

/**
 * automation-sweep.ts -- the minute sweep's share of automations: claim the schedules due, once each, as queued runs.
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
 */

const AUTOMATION_SWEEP = {
  /** The most schedules one sweep claims. */
  MAX_CLAIMS: 25,
} as const;

/** What the sweep's share did: how many schedules it fired. */
export interface AutomationSweepOutcome {
  readonly fired: number;
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

/** The sweep's share at `now`: the schedules due claimed and queued. */
export function sweepAutomations(now: number): PlanStoreEffect<AutomationSweepOutcome> {
  return Effect.map(claimDueSchedules(now), (claimed) => ({ fired: claimed.length }));
}
