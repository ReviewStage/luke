import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationFiring,
  type AutomationGuards,
  type AutomationPause,
  type AutomationRunReason,
  type AutomationRunStatus,
  type AutomationTrigger,
  automationActionSchema,
  automationFiringSchema,
  automationGuardsSchema,
  automationPauseSchema,
  automationRunReasonSchema,
  automationRunStatusSchema,
  automationTriggerSchema,
} from "@sidecar/hosted/automation-wire";
import { and, asc, desc, eq, exists, gte, inArray, lte, type SQL } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { plan } from "../schemas/plan.js";
import { InstantColumnSchema } from "./columns.js";
import type { PlanStoreEffect } from "./plan-store.js";
import { planReachableBy, reachablePlan } from "./workspace-store.js";

/**
 * automation-store.ts -- an account's automations and their runs: made, listed, changed, and deleted by the account, and a run recorded once per firing.
 *
 * Every statement an account makes names it beside the automation, so no
 * account reads or changes another's, and gates on the account still
 * reaching the automation's plan, a member of the plan's workspace, as every
 * plan statement is gated (`workspace-store.ts`): an account that leaves the
 * workspace leaves its automations there with it, unread and unchanged,
 * and their runs fail on the same check when they fire. A trigger is kept
 * with only the columns it uses: a schedule's due instant and a webhook's
 * secret hash are cleared whenever the trigger is no longer of their kind. The trigger, the action, and the guards are decoded through
 * the wire's own schemas on every read. A run is recorded under its firing's
 * dedupe key, so a firing claimed twice answers nothing the second time,
 * and settled once, from queued to started, skipped, or failed. When a
 * schedule is next due is the caller's to compute and hand in; this module
 * reads no clock but the instant it stamps a write with.
 */

/** The longest history one read answers. */
const MAX_RUNS_READ = 100;

const AutomationRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  planId: Schema.String,
  planName: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  pausedReason: Schema.NullOr(automationPauseSchema),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

/** One automation as its account reads it, with the name of the plan it works on. */
export type Automation = typeof AutomationRowSchema.Type;

const AUTOMATION_COLUMNS = {
  id: automation.id,
  userId: automation.userId,
  planId: automation.planId,
  planName: plan.name,
  name: automation.name,
  enabled: automation.enabled,
  pausedReason: automation.pausedReason,
  trigger: automation.trigger,
  action: automation.action,
  guards: automation.guards,
  nextRunAt: automation.nextRunAt,
  createdAt: automation.createdAt,
  updatedAt: automation.updatedAt,
};

/** What making an automation takes: the plan, what fires it and what it starts, its guards, when a schedule is first due, and a webhook's secret hash. */
export interface NewAutomation {
  readonly planId: string;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly guards: AutomationGuards;
  readonly nextRunAt: Date | null;
  readonly webhookSecretHash: string | null;
}

/**
 * What a change names: any of the fields, at once; a field left out stands
 * as it was, but for a new trigger, which clears the columns its kind does
 * not use and takes the due instant and the secret hash the change names.
 */
export interface AutomationChanges {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly pausedReason?: AutomationPause | null;
  readonly trigger?: AutomationTrigger;
  readonly action?: AutomationAction;
  readonly guards?: AutomationGuards;
  readonly nextRunAt?: Date | null;
  readonly webhookSecretHash?: string | null;
}

const RunRowSchema = Schema.Struct({
  id: Schema.String,
  automationId: Schema.String,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: Schema.NullOr(automationRunReasonSchema),
  codingAgentId: Schema.NullOr(Schema.String),
  firedAt: InstantColumnSchema,
  settledAt: Schema.NullOr(InstantColumnSchema),
});

/** One run as the history reads it: what fired it, where it stands, why where it did not start, and the agent where it did. */
export type AutomationRun = typeof RunRowSchema.Type;

const RUN_COLUMNS = {
  id: automationRun.id,
  automationId: automationRun.automationId,
  firing: automationRun.firing,
  status: automationRun.status,
  reason: automationRun.reason,
  codingAgentId: automationRun.codingAgentId,
  firedAt: automationRun.firedAt,
  settledAt: automationRun.settledAt,
};

/** A firing to record: its identity, what it was, and when it fired. */
export interface NewAutomationRun {
  readonly dedupeKey: string;
  readonly firing: AutomationFiring;
  readonly firedAt: Date;
}

/** How a run settled: started with its agent, or skipped or failed for a reason. */
export type AutomationRunOutcome =
  | { readonly status: typeof AUTOMATION_RUN_STATUS.STARTED; readonly codingAgentId: string }
  | {
      readonly status: Exclude<
        AutomationRunStatus,
        typeof AUTOMATION_RUN_STATUS.STARTED | typeof AUTOMATION_RUN_STATUS.QUEUED
      >;
      readonly reason: AutomationRunReason;
    };

const AutomationKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** The condition that the account owns the automation a statement reads and still reaches its plan. */
function ownedAndReachable(userId: string, id?: string): SQL | undefined {
  return and(
    id === undefined ? undefined : eq(automation.id, id),
    eq(automation.userId, userId),
    inArray(
      automation.planId,
      queryBuilder.select({ id: plan.id }).from(plan).where(planReachableBy(userId)),
    ),
  );
}

/** The columns only one kind of trigger uses, cleared under any other kind. */
function triggerColumns(
  trigger: AutomationTrigger,
  nextRunAt: Date | null | undefined,
  webhookSecretHash: string | null | undefined,
) {
  return {
    triggerKind: trigger.kind,
    trigger,
    nextRunAt: trigger.kind === AUTOMATION_TRIGGER.SCHEDULE ? (nextRunAt ?? null) : null,
    webhookSecretHash:
      trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? (webhookSecretHash ?? null) : null,
  };
}

const findReachablePlan = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db.select({ id: plan.id }).from(plan).where(reachablePlan(userId, planId)),
    ),
});

const insertAutomation = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    name: Schema.String,
    trigger: automationTriggerSchema,
    action: automationActionSchema,
    guards: automationGuardsSchema,
    nextRunAt: Schema.NullOr(Schema.Date),
    webhookSecretHash: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(automation)
        .values({
          userId: row.userId,
          planId: row.planId,
          name: row.name,
          enabled: true,
          ...triggerColumns(row.trigger, row.nextRunAt, row.webhookSecretHash),
          action: row.action,
          guards: row.guards,
          createdAt: row.now,
          updatedAt: row.now,
        })
        .returning({ id: automation.id }),
    ),
});

const findAutomations = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.NullOr(Schema.String) }),
  Result: AutomationRowSchema,
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select(AUTOMATION_COLUMNS)
        .from(automation)
        .innerJoin(plan, eq(plan.id, automation.planId))
        .where(
          and(
            ownedAndReachable(userId),
            planId === null ? undefined : eq(automation.planId, planId),
          ),
        )
        .orderBy(desc(automation.createdAt), desc(automation.id)),
    ),
});

const findAutomation = SqlSchema.findOneOption({
  Request: AutomationKeySchema,
  Result: AutomationRowSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select(AUTOMATION_COLUMNS)
        .from(automation)
        .innerJoin(plan, eq(plan.id, automation.planId))
        .where(ownedAndReachable(userId, id)),
    ),
});

const writeAutomation = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AutomationKeySchema.fields,
    name: Schema.optionalKey(Schema.String),
    enabled: Schema.optionalKey(Schema.Boolean),
    pausedReason: Schema.optionalKey(Schema.NullOr(automationPauseSchema)),
    trigger: Schema.optionalKey(automationTriggerSchema),
    action: Schema.optionalKey(automationActionSchema),
    guards: Schema.optionalKey(automationGuardsSchema),
    nextRunAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    webhookSecretHash: Schema.optionalKey(Schema.NullOr(Schema.String)),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now, trigger, nextRunAt, webhookSecretHash, ...changes }) =>
    Database.use((db) =>
      db
        .update(automation)
        .set({
          ...changes,
          ...(nextRunAt === undefined ? undefined : { nextRunAt }),
          ...(webhookSecretHash === undefined ? undefined : { webhookSecretHash }),
          ...(trigger === undefined
            ? undefined
            : triggerColumns(trigger, nextRunAt, webhookSecretHash)),
          updatedAt: now,
        })
        .where(ownedAndReachable(userId, id))
        .returning({ id: automation.id }),
    ),
});

const removeAutomation = SqlSchema.findAll({
  Request: AutomationKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db.delete(automation).where(ownedAndReachable(userId, id)).returning({ id: automation.id }),
    ),
});

const insertRun = SqlSchema.findAll({
  Request: Schema.Struct({
    automationId: Schema.String,
    userId: Schema.String,
    dedupeKey: Schema.String,
    firing: automationFiringSchema,
    firedAt: Schema.Date,
  }),
  Result: RunRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(automationRun)
        .values({ ...row, status: AUTOMATION_RUN_STATUS.QUEUED })
        .onConflictDoNothing({ target: [automationRun.automationId, automationRun.dedupeKey] })
        .returning(RUN_COLUMNS),
    ),
});

const writeRunOutcome = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    status: automationRunStatusSchema,
    reason: Schema.NullOr(automationRunReasonSchema),
    codingAgentId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, status, reason, codingAgentId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status, reason, codingAgentId, settledAt: now })
        .where(
          and(eq(automationRun.id, id), eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED)),
        )
        .returning({ id: automationRun.id }),
    ),
});

const findRuns = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, automationId: Schema.String, limit: Schema.Int }),
  Result: RunRowSchema,
  execute: ({ userId, automationId, limit }) =>
    Database.use((db) =>
      db
        .select(RUN_COLUMNS)
        .from(automationRun)
        .where(
          inArray(
            automationRun.automationId,
            queryBuilder
              .select({ id: automation.id })
              .from(automation)
              .where(ownedAndReachable(userId, automationId)),
          ),
        )
        .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
        .limit(limit),
    ),
});

const DueRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  trigger: automationTriggerSchema,
  dueAt: InstantColumnSchema,
});

/** One schedule the sweep found due: its automation, what fires it, and the instant it was due. */
type DueAutomation = typeof DueRowSchema.Type;

/** A firing the sweep's claim recorded: the schedule it is of, and its run, queued. */
export interface ClaimedFiring {
  readonly automation: DueAutomation;
  readonly run: AutomationRun;
}

/** What a claim of the schedules due takes: the instant, how many at most, how late a firing may still run, and the next due instant of a schedule. */
export interface DueClaim {
  readonly now: Date;
  readonly limit: number;
  readonly graceMs: number;
  /** The first instant strictly after `after` the trigger is due; null where it never is again. */
  readonly nextAfter: (trigger: AutomationTrigger, after: Date) => Date | null;
}

/**
 * The condition that the automation's owner still reaches its plan, read
 * per row, since the sweep claims every account's automations at once.
 */
const OWNER_REACHES_PLAN = exists(
  queryBuilder
    .select({ id: plan.id })
    .from(plan)
    .innerJoin(
      member,
      and(eq(member.organizationId, plan.organizationId), eq(member.userId, automation.userId)),
    )
    .where(eq(plan.id, automation.planId)),
);

/**
 * The enabled schedules due, soonest first, of owners who still reach
 * their plans, locked for this claim. Note that a row another claim holds is
 * skipped rather than waited on, because the cron may call twice in one
 * minute and the second call must find nothing left rather than queue
 * behind the first; and that the trigger's kind is read beside the due
 * instant, so a due instant left on a trigger of another kind fires nothing.
 */
const lockDue = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, limit: Schema.Int }),
  Result: DueRowSchema,
  execute: ({ now, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: automation.id,
          userId: automation.userId,
          trigger: automation.trigger,
          dueAt: automation.nextRunAt,
        })
        .from(automation)
        .where(
          and(
            eq(automation.enabled, true),
            eq(automation.triggerKind, AUTOMATION_TRIGGER.SCHEDULE),
            lte(automation.nextRunAt, now),
            OWNER_REACHES_PLAN,
          ),
        )
        .orderBy(asc(automation.nextRunAt), asc(automation.id))
        .limit(limit)
        .for("update", { skipLocked: true }),
    ),
});

const writeNextRun = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, nextRunAt: Schema.NullOr(Schema.Date) }),
  execute: ({ id, nextRunAt }) =>
    Database.use((db) => db.update(automation).set({ nextRunAt }).where(eq(automation.id, id))),
});

const findRunsSince = SqlSchema.findAll({
  Request: Schema.Struct({ automationId: Schema.String, since: Schema.Date }),
  Result: RunRowSchema,
  execute: ({ automationId, since }) =>
    Database.use((db) =>
      db
        .select(RUN_COLUMNS)
        .from(automationRun)
        .where(and(eq(automationRun.automationId, automationId), gte(automationRun.firedAt, since)))
        .orderBy(desc(automationRun.firedAt), desc(automationRun.id)),
    ),
});

/** Re-reads one automation after a write, which answered only that a row was written. */
function readWritten(userId: string, id: string): PlanStoreEffect<Option.Option<Automation>> {
  return findAutomation({ userId, id });
}

/** Makes the account's automation on the plan, enabled; nothing where the account does not reach the plan. */
export function createAutomation(
  userId: string,
  made: NewAutomation,
): PlanStoreEffect<Option.Option<Automation>> {
  return Effect.gen(function* () {
    const reached = yield* findReachablePlan({ userId, planId: made.planId });
    if (Option.isNone(reached)) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const [row] = yield* insertAutomation({ ...made, userId, now });
    return row === undefined ? Option.none() : yield* readWritten(userId, row.id);
  });
}

/** The account's automations, newest first, or those of one plan where it names one. */
export function listAutomations(
  userId: string,
  planId?: string,
): PlanStoreEffect<readonly Automation[]> {
  return findAutomations({ userId, planId: planId ?? null });
}

/** One of the account's automations; nothing for an id that is not the account's. */
export function readAutomation(
  userId: string,
  id: string,
): PlanStoreEffect<Option.Option<Automation>> {
  return findAutomation({ userId, id });
}

/** Writes the changes onto one of the account's automations and answers it as it now stands; nothing for an id that is not the account's. */
export function updateAutomation(
  userId: string,
  id: string,
  changes: AutomationChanges,
): PlanStoreEffect<Option.Option<Automation>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const written = yield* writeAutomation({ ...changes, userId, id, now });
    if (written.length === 0) return Option.none();
    return yield* readWritten(userId, id);
  });
}

/** Deletes one of the account's automations and its history; false for an id that is not the account's. */
export function deleteAutomation(userId: string, id: string): PlanStoreEffect<boolean> {
  return Effect.map(removeAutomation({ userId, id }), (rows) => rows.length > 0);
}

/** Records a firing of the automation, queued; nothing where a run under the same dedupe key stands already. */
export function recordAutomationRun(
  owner: Pick<Automation, "id" | "userId">,
  run: NewAutomationRun,
): PlanStoreEffect<Option.Option<AutomationRun>> {
  return Effect.map(insertRun({ ...run, automationId: owner.id, userId: owner.userId }), (rows) =>
    Option.fromUndefinedOr(rows[0]),
  );
}

/** Settles a queued run as it came out; false where it was settled already, so a run settles once. */
export function settleAutomationRun(
  runId: string,
  outcome: AutomationRunOutcome,
): PlanStoreEffect<boolean> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const written = yield* writeRunOutcome({
      id: runId,
      status: outcome.status,
      reason: outcome.status === AUTOMATION_RUN_STATUS.STARTED ? null : outcome.reason,
      codingAgentId:
        outcome.status === AUTOMATION_RUN_STATUS.STARTED ? outcome.codingAgentId : null,
      now,
    });
    return written.length > 0;
  });
}

/** The automation's runs, newest first, as many as asked up to the bound; none for an automation that is not the account's. */
export function listAutomationRuns(
  userId: string,
  automationId: string,
  limit: number = MAX_RUNS_READ,
): PlanStoreEffect<readonly AutomationRun[]> {
  return findRuns({ userId, automationId, limit: Math.min(Math.max(limit, 1), MAX_RUNS_READ) });
}

/** The automation's runs fired at or after the instant, newest first, which its guards count. */
export function automationRunsSince(
  automationId: string,
  since: Date,
): PlanStoreEffect<readonly AutomationRun[]> {
  return findRunsSince({ automationId, since });
}

/**
 * Claims the schedules due at `now`, at most `limit` of them, in one
 * transaction: each one's next due instant is written first, so a claim
 * that comes after finds it not due, and a firing no later than the grace
 * past its due instant is recorded as a run under that instant, which the
 * run's dedupe key holds to once even if two claims read the same row. A
 * firing later than the grace, a sweep that was down or a schedule just
 * resumed, is moved on without a run, so a backlog is never replayed.
 */
export function claimDueAutomations(claim: DueClaim): PlanStoreEffect<readonly ClaimedFiring[]> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const due = yield* lockDue({ now: claim.now, limit: claim.limit });
        const claimed: ClaimedFiring[] = [];
        for (const each of due) {
          yield* writeNextRun({ id: each.id, nextRunAt: claim.nextAfter(each.trigger, claim.now) });
          if (claim.now.getTime() - each.dueAt.getTime() > claim.graceMs) continue;
          const run = yield* recordAutomationRun(each, {
            dedupeKey: each.dueAt.toISOString(),
            firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: each.dueAt.getTime() },
            firedAt: claim.now,
          });
          if (Option.isSome(run)) claimed.push({ automation: each, run: run.value });
        }
        return claimed;
      }),
    ),
  );
}
