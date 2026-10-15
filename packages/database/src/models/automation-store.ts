import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationFiring,
  type AutomationGuards,
  type AutomationPause,
  type AutomationRunReason,
  type AutomationRunStatus,
  type AutomationScope,
  type AutomationTargetKind,
  type AutomationTrigger,
  automationActionSchema,
  automationFiringSchema,
  automationGuardsSchema,
  automationPauseSchema,
  automationRunReasonSchema,
  automationRunStatusSchema,
  automationScopeSchema,
  automationTargetKindSchema,
  automationTriggerSchema,
  type GitHubTriggerEvent,
} from "@luke/features/automation-wire";
import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { member } from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { inboxItem } from "../schemas/inbox.js";
import { plan } from "../schemas/plan.js";
import { InstantColumnSchema } from "./columns.js";
import type { PlanStoreEffect, PlanStoreFailure } from "./plan-store.js";
import { reachablePlan } from "./workspace-store.js";

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
  /** The plan's repository as `owner/name`, or null where it names none. */
  planRepository: Schema.NullOr(Schema.String),
  name: Schema.String,
  enabled: Schema.Boolean,
  pausedReason: Schema.NullOr(automationPauseSchema),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: Schema.NullOr(InstantColumnSchema),
  organizationId: Schema.NullOr(Schema.String),
  scope: automationScopeSchema,
  repositories: Schema.Array(Schema.String),
  targetKind: automationTargetKindSchema,
  targetAgentId: Schema.NullOr(Schema.String),
  archiveSuccessful: Schema.Boolean,
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
  planRepository: plan.repository,
  name: automation.name,
  enabled: automation.enabled,
  pausedReason: automation.pausedReason,
  trigger: automation.trigger,
  action: automation.action,
  guards: automation.guards,
  nextRunAt: automation.nextRunAt,
  // Note that a row an older build wrote after the backfill, its workspace null and its
  // repositories empty, reads its plan's, until the contract step fills it for good.
  organizationId: sql<
    string | null
  >`coalesce(${automation.organizationId}, ${plan.organizationId})`,
  scope: automation.scope,
  repositories: sql<
    readonly string[]
  >`case when ${automation.repositories} = '[]'::jsonb and ${plan.repository} is not null then jsonb_build_array(${plan.repository}) else ${automation.repositories} end`,
  targetKind: automation.targetKind,
  targetAgentId: automation.targetAgentId,
  archiveSuccessful: automation.archiveSuccessful,
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
  /** Whose it is; personal where left out. */
  readonly scope?: AutomationScope;
  /** Where a run lands; a new agent each run where left out. */
  readonly targetKind?: AutomationTargetKind;
  readonly targetAgentId?: string | null;
  readonly archiveSuccessful?: boolean;
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
  readonly scope?: AutomationScope;
  readonly targetKind?: AutomationTargetKind;
  readonly targetAgentId?: string | null;
  readonly archiveSuccessful?: boolean;
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

/**
 * What an account asks to do with an automation, each allowed by its own
 * rule (`docs/proposals/automations-scope.md`, D2): a personal automation
 * is its creator's, which the workspace's owners and admins see, pause, and
 * delete; a workspace's every member sees, runs, and pauses, and its
 * creator, owners, and admins change and delete.
 */
export const AUTOMATION_ACCESS = {
  READ: "read",
  CHANGE: "change",
  TOGGLE: "toggle",
  RUN: "run",
  DELETE: "delete",
} as const;

export type AutomationAccess = (typeof AUTOMATION_ACCESS)[keyof typeof AUTOMATION_ACCESS];

const automationAccessSchema = Schema.Literals(Object.values(AUTOMATION_ACCESS));

/** The condition that the account is a member of the automation's workspace, in one of `roles` where it names any. */
function memberOfAutomationWorkspace(
  userId: string | typeof automation.userId,
  roles?: readonly WorkspaceRole[],
): SQL {
  return exists(
    queryBuilder
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          // A row an older build wrote, its workspace still null, is its plan's workspace's.
          eq(
            member.organizationId,
            sql`coalesce(${automation.organizationId}, (select ${plan.organizationId} from ${plan} where ${plan.id} = ${automation.planId}))`,
          ),
          eq(member.userId, userId),
          // The plugin's role text may name several roles, comma-separated, as `roleOf` reads it.
          roles === undefined
            ? undefined
            : sql`string_to_array(replace(${member.role}, ' ', ''), ',') && array[${sql.join(
                roles.map((role) => sql`${role}`),
                sql`, `,
              )}]::text[]`,
        ),
      ),
  );
}

/**
 * The condition that the account may do `access` with the automation a
 * statement names. Note that every rule asks the account to be a member of
 * the automation's workspace still, so a creator who left reaches nothing
 * of it, while its owners and admins go on seeing and deleting it.
 */
function allowedTo(userId: string, access: AutomationAccess, id?: string): SQL | undefined {
  const mine = eq(automation.userId, userId);
  const shared = eq(automation.scope, AUTOMATION_SCOPE.WORKSPACE);
  const managing = memberOfAutomationWorkspace(userId, [
    WORKSPACE_ROLE.OWNER,
    WORKSPACE_ROLE.ADMIN,
  ]);
  const rule = (() => {
    switch (access) {
      case AUTOMATION_ACCESS.READ:
      case AUTOMATION_ACCESS.TOGGLE:
        return or(mine, shared, managing);
      case AUTOMATION_ACCESS.CHANGE:
        return or(mine, and(shared, managing));
      case AUTOMATION_ACCESS.RUN:
        return or(mine, shared);
      case AUTOMATION_ACCESS.DELETE:
        return or(mine, managing);
    }
  })();
  return and(
    id === undefined ? undefined : eq(automation.id, id),
    memberOfAutomationWorkspace(userId),
    rule,
  );
}

/** The condition that the account may read the automation row a statement reads, by the rule above: what a read naming an automation from beside it, such as an agent its run started, gates the automation's own words on. */
export function automationReadableBy(userId: string): SQL | undefined {
  return allowedTo(userId, AUTOMATION_ACCESS.READ);
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
  Result: Schema.Struct({
    id: Schema.String,
    organizationId: Schema.String,
    repository: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, planId }) =>
    Database.use((db) =>
      db
        .select({ id: plan.id, organizationId: plan.organizationId, repository: plan.repository })
        .from(plan)
        .where(reachablePlan(userId, planId)),
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
    organizationId: Schema.String,
    repositories: Schema.Array(Schema.String),
    scope: automationScopeSchema,
    targetKind: automationTargetKindSchema,
    targetAgentId: Schema.NullOr(Schema.String),
    archiveSuccessful: Schema.Boolean,
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
          organizationId: row.organizationId,
          repositories: row.repositories,
          scope: row.scope,
          targetKind: row.targetKind,
          targetAgentId: row.targetAgentId,
          archiveSuccessful: row.archiveSuccessful,
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
            allowedTo(userId, AUTOMATION_ACCESS.READ),
            planId === null ? undefined : eq(automation.planId, planId),
          ),
        )
        .orderBy(desc(automation.createdAt), desc(automation.id)),
    ),
});

const findAutomation = SqlSchema.findOneOption({
  Request: Schema.Struct({ ...AutomationKeySchema.fields, access: automationAccessSchema }),
  Result: AutomationRowSchema,
  execute: ({ userId, id, access }) =>
    Database.use((db) =>
      db
        .select(AUTOMATION_COLUMNS)
        .from(automation)
        .innerJoin(plan, eq(plan.id, automation.planId))
        .where(allowedTo(userId, access, id)),
    ),
});

const writeAutomation = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AutomationKeySchema.fields,
    access: automationAccessSchema,
    name: Schema.optionalKey(Schema.String),
    enabled: Schema.optionalKey(Schema.Boolean),
    pausedReason: Schema.optionalKey(Schema.NullOr(automationPauseSchema)),
    trigger: Schema.optionalKey(automationTriggerSchema),
    action: Schema.optionalKey(automationActionSchema),
    guards: Schema.optionalKey(automationGuardsSchema),
    nextRunAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    webhookSecretHash: Schema.optionalKey(Schema.NullOr(Schema.String)),
    scope: Schema.optionalKey(automationScopeSchema),
    targetKind: Schema.optionalKey(automationTargetKindSchema),
    targetAgentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    archiveSuccessful: Schema.optionalKey(Schema.Boolean),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, access, now, trigger, nextRunAt, webhookSecretHash, ...changes }) =>
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
        .where(allowedTo(userId, access, id))
        .returning({ id: automation.id }),
    ),
});

const removeAutomation = SqlSchema.findAll({
  Request: AutomationKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(automation)
        .where(allowedTo(userId, AUTOMATION_ACCESS.DELETE, id))
        .returning({ id: automation.id }),
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

const HistoryRowSchema = Schema.Struct({
  ...RunRowSchema.fields,
  agentConversationId: Schema.NullOr(Schema.String),
  agentTitle: Schema.NullOr(Schema.String),
  agentCreatedAt: Schema.NullOr(InstantColumnSchema),
});

/** One run as the history reads it, with the conversation, title, and start of the agent it started where that agent stands. */
export type AutomationRunInHistory = typeof HistoryRowSchema.Type;

/** The runs of one automation the account may read, with each one's agent, newest first. */
function historyOf(userId: string, automationId: string): SQL {
  return inArray(
    automationRun.automationId,
    queryBuilder
      .select({ id: automation.id })
      .from(automation)
      .where(allowedTo(userId, AUTOMATION_ACCESS.READ, automationId)),
  );
}

const HISTORY_COLUMNS = {
  ...RUN_COLUMNS,
  agentConversationId: codingAgent.conversationId,
  agentTitle: codingAgent.title,
  agentCreatedAt: codingAgent.createdAt,
};

const findRuns = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, automationId: Schema.String, limit: Schema.Int }),
  Result: HistoryRowSchema,
  execute: ({ userId, automationId, limit }) =>
    Database.use((db) =>
      db
        .select(HISTORY_COLUMNS)
        .from(automationRun)
        .leftJoin(codingAgent, eq(codingAgent.id, automationRun.codingAgentId))
        .where(historyOf(userId, automationId))
        .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
        .limit(limit),
    ),
});

const findRunByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    automationId: Schema.String,
    dedupeKey: Schema.String,
  }),
  Result: HistoryRowSchema,
  execute: ({ userId, automationId, dedupeKey }) =>
    Database.use((db) =>
      db
        .select(HISTORY_COLUMNS)
        .from(automationRun)
        .leftJoin(codingAgent, eq(codingAgent.id, automationRun.codingAgentId))
        .where(and(historyOf(userId, automationId), eq(automationRun.dedupeKey, dedupeKey))),
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

const findAutomationToRun = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: AutomationRowSchema,
  execute: (id) =>
    Database.use((db) =>
      db
        .select(AUTOMATION_COLUMNS)
        .from(automation)
        .innerJoin(plan, eq(plan.id, automation.planId))
        .where(eq(automation.id, id)),
    ),
});

const findQueuedRuns = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, limit: Schema.Int }),
  Result: RunRowSchema,
  execute: ({ since, limit }) =>
    Database.use((db) =>
      db
        .select(RUN_COLUMNS)
        .from(automationRun)
        .where(
          and(
            eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED),
            gte(automationRun.firedAt, since),
          ),
        )
        .orderBy(asc(automationRun.firedAt), asc(automationRun.id))
        .limit(limit),
    ),
});

const StartedAgentSchema = Schema.Struct({
  codingAgentId: Schema.String,
  conversationId: Schema.String,
  createdAt: InstantColumnSchema,
});

/** An agent one of an automation's runs started: its id, its conversation, and when it was made. */
export type StartedRunAgent = typeof StartedAgentSchema.Type;

const findStartedAgents = SqlSchema.findAll({
  Request: Schema.Struct({ automationId: Schema.String, since: Schema.Date }),
  Result: StartedAgentSchema,
  execute: ({ automationId, since }) =>
    Database.use((db) =>
      db
        .select({
          codingAgentId: codingAgent.id,
          conversationId: codingAgent.conversationId,
          createdAt: codingAgent.createdAt,
        })
        .from(automationRun)
        .innerJoin(codingAgent, eq(codingAgent.id, automationRun.codingAgentId))
        .where(
          and(
            eq(automationRun.automationId, automationId),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            gte(automationRun.firedAt, since),
          ),
        ),
    ),
});

const ArchivableAgentSchema = Schema.Struct({
  runId: Schema.String,
  userId: Schema.String,
  codingAgentId: Schema.String,
  conversationId: Schema.String,
  createdAt: InstantColumnSchema,
  archivedAt: Schema.NullOr(InstantColumnSchema),
});

/** An agent a run started that its automation archives once it finishes well: its run, whose it is, its id, its conversation, when it was made, and when it was put away where it already was. */
export type ArchivableRunAgent = typeof ArchivableAgentSchema.Type;

/**
 * The agents runs fired at or after `since` started for automations that
 * archive their successful runs and start a new agent each run, whose
 * archive the sweep has not settled yet and that hold no open inbox item,
 * at most `limit`, oldest run first. Note that an agent waiting on the
 * inbox is left for a later sweep, because archiving it would put away the
 * question it is waiting on, and that one the sweep settled is never read
 * again, so an agent the developer brought back stays.
 */
const findArchivableAgents = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, limit: Schema.Number }),
  Result: ArchivableAgentSchema,
  execute: ({ since, limit }) =>
    Database.use((db) =>
      db
        .select({
          runId: automationRun.id,
          userId: codingAgent.userId,
          codingAgentId: codingAgent.id,
          conversationId: codingAgent.conversationId,
          createdAt: codingAgent.createdAt,
          archivedAt: codingAgent.archivedAt,
        })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .innerJoin(codingAgent, eq(codingAgent.id, automationRun.codingAgentId))
        .where(
          and(
            eq(automation.archiveSuccessful, true),
            eq(automation.targetKind, AUTOMATION_TARGET.NEW_AGENT),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            gte(automationRun.firedAt, since),
            isNull(automationRun.archiveSettledAt),
            notExists(
              queryBuilder
                .select({ one: inboxItem.id })
                .from(inboxItem)
                .where(
                  and(
                    eq(inboxItem.agentId, codingAgent.id),
                    eq(inboxItem.status, INBOX_STATUS.OPEN),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(automationRun.firedAt))
        .limit(limit),
    ),
});

const writeExpired = SqlSchema.findAll({
  Request: Schema.Struct({
    before: Schema.Date,
    reason: automationRunReasonSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ before, reason, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.FAILED, reason, settledAt: now })
        .where(
          and(
            eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED),
            lte(automationRun.firedAt, before),
          ),
        )
        .returning({ id: automationRun.id }),
    ),
});

const lockAutomationRow = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (id) =>
    Database.use((db) =>
      db.select({ id: automation.id }).from(automation).where(eq(automation.id, id)).for("update"),
    ),
});

const writeClaim = SqlSchema.findAll({
  Request: Schema.Struct({ id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.STARTED, settledAt: now })
        .where(
          and(eq(automationRun.id, id), eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED)),
        )
        .returning({ id: automationRun.id }),
    ),
});

/** A run claimed for its start and not yet holding the agent it started: started, with no agent. */
const CLAIMED = and(
  eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
  isNull(automationRun.codingAgentId),
);

const writeAgent = SqlSchema.findAll({
  Request: Schema.Struct({ id: Schema.String, codingAgentId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, codingAgentId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.STARTED, codingAgentId, settledAt: now })
        .where(
          and(
            eq(automationRun.id, id),
            or(eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED), CLAIMED),
          ),
        )
        .returning({ id: automationRun.id }),
    ),
});

const writeClaimFailed = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    reason: automationRunReasonSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, reason, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.FAILED, reason, settledAt: now })
        .where(and(eq(automationRun.id, id), CLAIMED))
        .returning({ id: automationRun.id }),
    ),
});

const findClaimed = SqlSchema.findAll({
  Request: Schema.Struct({ automationId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ automationId, since }) =>
    Database.use((db) =>
      db
        .select({ id: automationRun.id })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.automationId, automationId),
            CLAIMED,
            gte(automationRun.settledAt, since),
          ),
        ),
    ),
});

const findStranded = SqlSchema.findAll({
  Request: Schema.Struct({ before: Schema.Date, limit: Schema.Int }),
  Result: Schema.Struct({ id: Schema.String, automationId: Schema.String, userId: Schema.String }),
  execute: ({ before, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: automationRun.id,
          automationId: automationRun.automationId,
          userId: automationRun.userId,
        })
        .from(automationRun)
        .where(and(CLAIMED, lte(automationRun.settledAt, before)))
        .orderBy(asc(automationRun.settledAt))
        .limit(limit),
    ),
});

const ListeningRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  trigger: automationTriggerSchema,
});

/** One automation a repository's event may fire: its id, its owner, and what fires it. */
export type ListeningAutomation = typeof ListeningRowSchema.Type;

const findGithubAutomations = SqlSchema.findAll({
  Request: Schema.Struct({ repository: Schema.String, event: Schema.String, limit: Schema.Int }),
  Result: ListeningRowSchema,
  execute: ({ repository, event, limit }) =>
    Database.use((db) =>
      db
        .select({ id: automation.id, userId: automation.userId, trigger: automation.trigger })
        .from(automation)
        .innerJoin(plan, eq(plan.id, automation.planId))
        .where(
          and(
            eq(automation.enabled, true),
            eq(automation.triggerKind, AUTOMATION_TRIGGER.GITHUB),
            // GitHub folds a repository's name; a plan keeps it as GitHub spelled it when it was named.
            sql`lower(${plan.repository}) = lower(${repository})`,
            sql`${automation.trigger}->>'event' = ${event}`,
            OWNER_REACHES_PLAN,
          ),
        )
        .orderBy(asc(automation.createdAt), asc(automation.id))
        .limit(limit),
    ),
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
  return findAutomation({ userId, id, access: AUTOMATION_ACCESS.READ });
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
    const { repository, organizationId } = reached.value;
    const [row] = yield* insertAutomation({
      ...made,
      userId,
      organizationId,
      repositories: repository === null ? [] : [repository],
      scope: made.scope ?? AUTOMATION_SCOPE.PERSONAL,
      targetKind: made.targetKind ?? AUTOMATION_TARGET.NEW_AGENT,
      targetAgentId: made.targetAgentId ?? null,
      archiveSuccessful: made.archiveSuccessful ?? false,
      now,
    });
    return row === undefined ? Option.none() : yield* readWritten(userId, row.id);
  });
}

/** The automations the account may read, newest first, or those of one plan where it names one. */
export function listAutomations(
  userId: string,
  planId?: string,
): PlanStoreEffect<readonly Automation[]> {
  return findAutomations({ userId, planId: planId ?? null });
}

/** One automation the account may do `access` with, reading by default; nothing for any other id. */
export function readAutomation(
  userId: string,
  id: string,
  access: AutomationAccess = AUTOMATION_ACCESS.READ,
): PlanStoreEffect<Option.Option<Automation>> {
  return findAutomation({ userId, id, access });
}

/**
 * Writes the changes onto an automation the account may change, or turn on
 * or off where `access` is the toggle, and answers it as it now stands;
 * nothing for any other id.
 */
export function updateAutomation(
  userId: string,
  id: string,
  changes: AutomationChanges,
  access:
    | typeof AUTOMATION_ACCESS.CHANGE
    | typeof AUTOMATION_ACCESS.TOGGLE = AUTOMATION_ACCESS.CHANGE,
): PlanStoreEffect<Option.Option<Automation>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const written = yield* writeAutomation({ ...changes, userId, id, access, now });
    if (written.length === 0) return Option.none();
    return yield* readWritten(userId, id);
  });
}

/** Deletes an automation the account may delete, and its history; false for any other id. */
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

/** The automation's runs, newest first, each with its agent, as many as asked up to the bound; none for an automation that is not the account's. */
export function listAutomationRuns(
  userId: string,
  automationId: string,
  limit: number = MAX_RUNS_READ,
): PlanStoreEffect<readonly AutomationRunInHistory[]> {
  return findRuns({ userId, automationId, limit: Math.min(Math.max(limit, 1), MAX_RUNS_READ) });
}

/** The account's run of the automation recorded under the key, as the history reads it; nothing where none was. */
export function automationRunByKey(
  userId: string,
  automationId: string,
  dedupeKey: string,
): PlanStoreEffect<Option.Option<AutomationRunInHistory>> {
  return findRunByKey({ userId, automationId, dedupeKey });
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

/**
 * One automation by id, whoever owns it, for a run the service fires: the
 * sweep and a trigger hold no account's bearer, and the run's own start
 * checks the owner still reaches the plan, as every Start does.
 */
export function readAutomationToRun(id: string): PlanStoreEffect<Option.Option<Automation>> {
  return findAutomationToRun(id);
}

/** The runs still queued that fired at or after `since`, oldest first, at most `limit`, for the sweep to act on. */
export function queuedAutomationRuns(
  since: Date,
  limit: number,
): PlanStoreEffect<readonly AutomationRun[]> {
  return findQueuedRuns({ since, limit });
}

/** The agents the automation's runs fired at or after `since` started, and that stand still. */
export function startedRunAgents(
  automationId: string,
  since: Date,
): PlanStoreEffect<readonly StartedRunAgent[]> {
  return findStartedAgents({ automationId, since });
}

/** The agents of runs fired at or after `since` that their automations archive once finished well, as above, at most `limit`, oldest run first. */
export function archivableRunAgents(
  since: Date,
  limit: number,
): PlanStoreEffect<readonly ArchivableRunAgent[]> {
  return findArchivableAgents({ since, limit });
}

const writeArchiveSettled = SqlSchema.void({
  Request: Schema.Struct({ runId: Schema.String, now: Schema.Date }),
  execute: ({ runId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ archiveSettledAt: now })
        .where(and(eq(automationRun.id, runId), isNull(automationRun.archiveSettledAt))),
    ),
});

/** Marks what becomes of the run's agent as settled, archived or left standing for good, so no later sweep reads it again. */
export function settleRunArchive(runId: string): PlanStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => writeArchiveSettled({ runId, now }));
}

/** Settles every run still queued that fired at or before `before` as failed for the reason given, answering how many. */
export function expireQueuedAutomationRuns(
  before: Date,
  reason: AutomationRunReason,
): PlanStoreEffect<number> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeExpired({ before, reason, now }), (rows) => rows.length),
  );
}

const findCreatorMembership = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (automationId) =>
    Database.use((db) =>
      db
        .select({ id: automation.id })
        .from(automation)
        .where(
          and(eq(automation.id, automationId), memberOfAutomationWorkspace(automation.userId)),
        ),
    ),
});

/** Whether the automation's creator is a member of its workspace still, which a run that starts as them needs. */
export function creatorStillMember(automationId: string): PlanStoreEffect<boolean> {
  return Effect.map(findCreatorMembership(automationId), (rows) => rows.length > 0);
}

/**
 * Runs `effect` holding the automation's row lock, in one transaction, so
 * two acts on one automation's runs, two sweeps or a sweep and a "Run now",
 * read its guards and claim a start one after the other rather than both
 * reading the same count.
 */
export function withAutomationLocked<A, E, R>(
  automationId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlanStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(Effect.andThen(lockAutomationRow(automationId), effect)),
  );
}

/** Claims a queued run for its start: started, with no agent yet; false where it was not queued. */
export function claimAutomationRun(runId: string): PlanStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeClaim({ id: runId, now }), (rows) => rows.length > 0),
  );
}

/** The run started with the agent named, from queued or from its claim; false where it settled otherwise. */
export function attachRunAgent(runId: string, codingAgentId: string): PlanStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeAgent({ id: runId, codingAgentId, now }), (rows) => rows.length > 0),
  );
}

/** A claimed run whose start was refused, failed for the reason given; false where it holds an agent or was not claimed. */
export function failClaimedRun(
  runId: string,
  reason: AutomationRunReason,
): PlanStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeClaimFailed({ id: runId, reason, now }), (rows) => rows.length > 0),
  );
}

/** How many of the automation's runs claimed at or after `since` are still starting, which count against its concurrency; a claim is dated by when it was made, whenever its run fired. */
export function claimedRunsStarting(automationId: string, since: Date): PlanStoreEffect<number> {
  return Effect.map(findClaimed({ automationId, since }), (rows) => rows.length);
}

/** One claimed run left without its agent: its id, its automation, and its owner. */
export interface StrandedRun {
  readonly id: string;
  readonly automationId: string;
  readonly userId: string;
}

/** Claimed runs whose start never settled by `before`, a function that died between the claim and the agent: oldest first, at most `limit`. */
export function strandedAutomationRuns(
  before: Date,
  limit: number,
): PlanStoreEffect<readonly StrandedRun[]> {
  return findStranded({ before, limit });
}

/**
 * The enabled automations listening for the GitHub event on plans of the
 * repository, whoever owns them, of owners who still reach those plans,
 * oldest first, at most `limit`: what a delivery about the repository may
 * fire, its filters still to read.
 */
export function githubAutomationsOn(
  repository: string,
  event: GitHubTriggerEvent,
  limit: number,
): PlanStoreEffect<readonly ListeningAutomation[]> {
  return findGithubAutomations({ repository, event, limit });
}
