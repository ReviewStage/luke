import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationFiring,
  type AutomationGuards,
  type AutomationRunReason,
  type AutomationRunStatus,
  type AutomationScope,
  type AutomationTargetKind,
  type AutomationTrigger,
  automationActionSchema,
  automationFiringSchema,
  automationGuardsSchema,
  automationRunReasonSchema,
  automationRunStatusSchema,
  automationScopeSchema,
  automationTargetKindSchema,
  automationTriggerSchema,
  type GitHubTriggerEvent,
} from "@repo/features/automation-wire";
import type { SentryTriggerEvent, TriggerProvider } from "@repo/features/trigger-catalog";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
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
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, type DatabaseServices, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member } from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { conversations } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { noOpenInboxItem, noOpenPullRequest } from "./agent-store.js";
import { InstantColumnSchema } from "./columns.js";
import { taskMadeByRun } from "./run-tasks.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";
import { AGENT_WORKSPACE, isWorkspaceMember, roleAmong } from "./workspace-store.js";

const MAX_RUNS_READ = 100;

const AutomationRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: Schema.NullOr(InstantColumnSchema),
  organizationId: Schema.String,
  scope: automationScopeSchema,
  repositories: Schema.Array(Schema.String),
  targetKind: automationTargetKindSchema,
  targetAgentId: Schema.NullOr(Schema.String),
  archiveSuccessful: Schema.Boolean,
  slackDelivery: Schema.Boolean,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

export type Automation = typeof AutomationRowSchema.Type;

export const AUTOMATION_COLUMNS = {
  id: automation.id,
  userId: automation.userId,
  name: automation.name,
  enabled: automation.enabled,
  trigger: automation.trigger,
  action: automation.action,
  guards: automation.guards,
  nextRunAt: automation.nextRunAt,
  organizationId: automation.organizationId,
  scope: automation.scope,
  repositories: automation.repositories,
  targetKind: automation.targetKind,
  targetAgentId: automation.targetAgentId,
  archiveSuccessful: automation.archiveSuccessful,
  slackDelivery: automation.slackDelivery,
  createdAt: automation.createdAt,
  updatedAt: automation.updatedAt,
};

export interface NewAutomation {
  readonly id?: string;
  readonly organizationId: string;
  readonly repositories?: readonly string[] | undefined;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  readonly guards: AutomationGuards;
  readonly nextRunAt: Date | null;
  readonly webhookSecretHash: string | null;
  readonly scope?: AutomationScope;
  readonly targetKind?: AutomationTargetKind;
  readonly targetAgentId?: string | null;
  readonly archiveSuccessful?: boolean;
  readonly slackDelivery?: boolean;
}

export interface AutomationChanges {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly trigger?: AutomationTrigger;
  readonly action?: AutomationAction;
  readonly guards?: AutomationGuards;
  readonly nextRunAt?: Date | null;
  readonly webhookSecretHash?: string | null;
  readonly scope?: AutomationScope;
  readonly repositories?: readonly string[];
  readonly targetKind?: AutomationTargetKind;
  readonly targetAgentId?: string | null;
  readonly archiveSuccessful?: boolean;
  readonly slackDelivery?: boolean;
}

const RunRowSchema = Schema.Struct({
  id: Schema.String,
  automationId: Schema.String,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: Schema.NullOr(automationRunReasonSchema),
  agentId: Schema.NullOr(Schema.String),
  firedAt: InstantColumnSchema,
  settledAt: Schema.NullOr(InstantColumnSchema),
});

export type AutomationRun = typeof RunRowSchema.Type;

const RUN_COLUMNS = {
  id: automationRun.id,
  automationId: automationRun.automationId,
  firing: automationRun.firing,
  status: automationRun.status,
  reason: automationRun.reason,
  agentId: automationRun.agentId,
  firedAt: automationRun.firedAt,
  settledAt: automationRun.settledAt,
};

const QueuedRunSchema = Schema.Struct({
  ...RunRowSchema.fields,
  payload: Schema.NullOr(Schema.String),
});

export type QueuedRun = typeof QueuedRunSchema.Type;

const QUEUED_RUN_COLUMNS = { ...RUN_COLUMNS, payload: automationRun.payload };

export interface NewAutomationRun {
  readonly dedupeKey: string;
  readonly firing: AutomationFiring;
  readonly firedAt: Date;
  readonly payload?: string;
}

export type AutomationRunOutcome =
  | { readonly status: typeof AUTOMATION_RUN_STATUS.STARTED; readonly agentId: string }
  | {
      readonly status: Exclude<
        AutomationRunStatus,
        typeof AUTOMATION_RUN_STATUS.STARTED | typeof AUTOMATION_RUN_STATUS.QUEUED
      >;
      readonly reason: AutomationRunReason;
    };

const AutomationKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

export const AUTOMATION_ACCESS = {
  READ: "read",
  CHANGE: "change",
  TOGGLE: "toggle",
  RUN: "run",
  DELETE: "delete",
} as const;

export type AutomationAccess = (typeof AUTOMATION_ACCESS)[keyof typeof AUTOMATION_ACCESS];

const automationAccessSchema = Schema.Literals(Object.values(AUTOMATION_ACCESS));

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
          eq(member.organizationId, automation.organizationId),
          eq(member.userId, userId),
          roles === undefined ? undefined : roleAmong(roles),
        ),
      ),
  );
}

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

export function automationReadableBy(userId: string): SQL | undefined {
  return allowedTo(userId, AUTOMATION_ACCESS.READ);
}

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

const TXID = sql<string>`pg_current_xact_id()::text`;

const WrittenSchema = Schema.Struct({ id: Schema.String, txid: Schema.String });

const insertAutomation = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    userId: Schema.String,
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
    slackDelivery: Schema.Boolean,
    now: Schema.Date,
  }),
  Result: WrittenSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(automation)
        .values({
          ...(row.id === undefined ? undefined : { id: row.id }),
          userId: row.userId,
          organizationId: row.organizationId,
          repositories: row.repositories,
          scope: row.scope,
          targetKind: row.targetKind,
          targetAgentId: row.targetAgentId,
          archiveSuccessful: row.archiveSuccessful,
          slackDelivery: row.slackDelivery,
          name: row.name,
          enabled: true,
          ...triggerColumns(row.trigger, row.nextRunAt, row.webhookSecretHash),
          action: row.action,
          guards: row.guards,
          createdAt: row.now,
          updatedAt: row.now,
        })
        .onConflictDoNothing({ target: automation.id })
        .returning({ id: automation.id, txid: TXID }),
    ),
});

const findAutomations = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.NullOr(Schema.String),
  }),
  Result: AutomationRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select(AUTOMATION_COLUMNS)
        .from(automation)
        .where(
          and(
            allowedTo(userId, AUTOMATION_ACCESS.READ),
            organizationId === null ? undefined : eq(automation.organizationId, organizationId),
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
        .where(allowedTo(userId, access, id)),
    ),
});

const writeAutomation = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AutomationKeySchema.fields,
    access: automationAccessSchema,
    name: Schema.optionalKey(Schema.String),
    enabled: Schema.optionalKey(Schema.Boolean),
    trigger: Schema.optionalKey(automationTriggerSchema),
    action: Schema.optionalKey(automationActionSchema),
    guards: Schema.optionalKey(automationGuardsSchema),
    nextRunAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    webhookSecretHash: Schema.optionalKey(Schema.NullOr(Schema.String)),
    scope: Schema.optionalKey(automationScopeSchema),
    repositories: Schema.optionalKey(Schema.Array(Schema.String)),
    targetKind: Schema.optionalKey(automationTargetKindSchema),
    targetAgentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    archiveSuccessful: Schema.optionalKey(Schema.Boolean),
    slackDelivery: Schema.optionalKey(Schema.Boolean),
    now: Schema.Date,
  }),
  Result: WrittenSchema,
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
        .returning({ id: automation.id, txid: TXID }),
    ),
});

const removeAutomation = SqlSchema.findAll({
  Request: AutomationKeySchema,
  Result: WrittenSchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(automation)
        .where(allowedTo(userId, AUTOMATION_ACCESS.DELETE, id))
        .returning({ id: automation.id, txid: TXID }),
    ),
});

const insertRun = SqlSchema.findAll({
  Request: Schema.Struct({
    automationId: Schema.String,
    userId: Schema.String,
    dedupeKey: Schema.String,
    firing: automationFiringSchema,
    payload: Schema.NullOr(Schema.String),
    firedAt: Schema.Date,
  }),
  Result: Schema.Struct({ ...QueuedRunSchema.fields, txid: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(automationRun)
        .values({ ...row, status: AUTOMATION_RUN_STATUS.QUEUED })
        .onConflictDoNothing({ target: [automationRun.automationId, automationRun.dedupeKey] })
        .returning({ ...QUEUED_RUN_COLUMNS, txid: TXID }),
    ),
});

const writeRunOutcome = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    status: automationRunStatusSchema,
    reason: Schema.NullOr(automationRunReasonSchema),
    agentId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, status, reason, agentId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status, reason, agentId, settledAt: now })
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
  agentUserId: Schema.NullOr(Schema.String),
});

export type AutomationRunInHistory = typeof HistoryRowSchema.Type;

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
  agentConversationId: agentTable.conversationId,
  agentTitle: agentTable.title,
  agentCreatedAt: agentTable.createdAt,
  agentUserId: agentTable.userId,
};

const findRuns = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, automationId: Schema.String, limit: Schema.Int }),
  Result: HistoryRowSchema,
  execute: ({ userId, automationId, limit }) =>
    Database.use((db) =>
      db
        .select(HISTORY_COLUMNS)
        .from(automationRun)
        .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
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
        .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
        .where(and(historyOf(userId, automationId), eq(automationRun.dedupeKey, dedupeKey))),
    ),
});

const DueRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  trigger: automationTriggerSchema,
  dueAt: InstantColumnSchema,
});

type DueAutomation = typeof DueRowSchema.Type;

export interface ClaimedFiring {
  readonly automation: DueAutomation;
  readonly run: AutomationRun;
}

export interface DueClaim {
  readonly now: Date;
  readonly limit: number;
  readonly graceMs: number;
  readonly nextAfter: (trigger: AutomationTrigger, after: Date) => Date | null;
}

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
      db.select(AUTOMATION_COLUMNS).from(automation).where(eq(automation.id, id)),
    ),
});

const findQueuedRuns = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, limit: Schema.Int }),
  Result: QueuedRunSchema,
  execute: ({ since, limit }) =>
    Database.use((db) =>
      db
        .select(QUEUED_RUN_COLUMNS)
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
  agentId: Schema.String,
  conversationId: Schema.String,
  createdAt: InstantColumnSchema,
});

export type StartedRunAgent = typeof StartedAgentSchema.Type;

const findStartedAgents = SqlSchema.findAll({
  Request: Schema.Struct({ automationId: Schema.String, since: Schema.Date }),
  Result: StartedAgentSchema,
  execute: ({ automationId, since }) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentTable.id,
          conversationId: agentTable.conversationId,
          createdAt: agentTable.createdAt,
        })
        .from(automationRun)
        .innerJoin(agentTable, eq(agentTable.id, automationRun.agentId))
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
  agentId: Schema.String,
  conversationId: Schema.String,
  createdAt: InstantColumnSchema,
  archivedAt: Schema.NullOr(InstantColumnSchema),
  conversationSeq: Schema.Number,
  runAgents: Schema.Number,
});

export type ArchivableRunAgent = typeof ArchivableAgentSchema.Type;

const runAgent = alias(agentTable, "run_agent");

const findArchivableAgents = SqlSchema.findAll({
  Request: Schema.Struct({ since: Schema.Date, limit: Schema.Number }),
  Result: ArchivableAgentSchema,
  execute: ({ since, limit }) =>
    Database.use((db) =>
      db
        .select({
          runId: automationRun.id,
          userId: agentTable.userId,
          agentId: agentTable.id,
          conversationId: agentTable.conversationId,
          createdAt: agentTable.createdAt,
          archivedAt: agentTable.archivedAt,
          conversationSeq: conversations.nextMessageSeq,
          runAgents: sql<number>`(${queryBuilder
            .select({ count: sql`count(*)::int` })
            .from(runAgent)
            .where(eq(runAgent.automationRunId, automationRun.id))})`,
        })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .innerJoin(agentTable, eq(agentTable.automationRunId, automationRun.id))
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            eq(automation.archiveSuccessful, true),
            eq(automation.targetKind, AUTOMATION_TARGET.NEW_AGENT),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            gte(automationRun.firedAt, since),
            isNull(automationRun.archiveSettledAt),
            exists(
              queryBuilder
                .select({ one: member.id })
                .from(member)
                .where(
                  and(
                    eq(member.userId, agentTable.userId),
                    eq(member.organizationId, AGENT_WORKSPACE),
                  ),
                ),
            ),
            noOpenInboxItem,
            noOpenPullRequest,
          ),
        )
        .orderBy(asc(automationRun.firedAt), asc(automationRun.id), asc(agentTable.id))
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
  Request: Schema.Struct({
    id: Schema.String,
    claimedAgentId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, claimedAgentId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.STARTED, claimedAgentId, settledAt: now })
        .where(
          and(eq(automationRun.id, id), eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED)),
        )
        .returning({ id: automationRun.id }),
    ),
});

const CLAIMED = and(
  eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
  isNull(automationRun.agentId),
);

const writeAgent = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    agentId: Schema.String,
    reason: Schema.NullOr(automationRunReasonSchema),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, agentId, reason, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ status: AUTOMATION_RUN_STATUS.STARTED, agentId, reason, settledAt: now })
        .where(
          and(
            eq(automationRun.id, id),
            or(eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED), CLAIMED),
          ),
        )
        .returning({ id: automationRun.id }),
    ),
});

const writeAgentAdopted = SqlSchema.findAll({
  Request: Schema.Struct({
    id: Schema.String,
    held: Schema.NullOr(Schema.String),
    agentId: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, held, agentId, now }) =>
    Database.use((db) =>
      db
        .update(automation)
        .set({ targetAgentId: agentId, updatedAt: now })
        .where(
          and(
            eq(automation.id, id),
            eq(automation.targetKind, AUTOMATION_TARGET.SAME_AGENT),
            held === null ? isNull(automation.targetAgentId) : eq(automation.targetAgentId, held),
          ),
        )
        .returning({ id: automation.id }),
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
  Result: Schema.Struct({
    id: Schema.String,
    automationId: Schema.String,
    userId: Schema.String,
    claimedAgentId: Schema.NullOr(Schema.String),
  }),
  execute: ({ before, limit }) =>
    Database.use((db) =>
      db
        .select({
          id: automationRun.id,
          automationId: automationRun.automationId,
          userId: automationRun.userId,
          claimedAgentId: automationRun.claimedAgentId,
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

export type ListeningAutomation = typeof ListeningRowSchema.Type;

const findGithubAutomations = SqlSchema.findAll({
  Request: Schema.Struct({ repository: Schema.String, event: Schema.String, limit: Schema.Int }),
  Result: ListeningRowSchema,
  execute: ({ repository, event, limit }) =>
    Database.use((db) =>
      db
        .select({ id: automation.id, userId: automation.userId, trigger: automation.trigger })
        .from(automation)
        .where(
          and(
            eq(automation.enabled, true),
            eq(automation.triggerKind, AUTOMATION_TRIGGER.GITHUB),
            sql`exists (select 1 from jsonb_array_elements_text(${automation.repositories}) as listed(name) where lower(listed.name) = lower(${repository}))`,
            sql`${automation.trigger}->>'event' = ${event}`,
            memberOfAutomationWorkspace(automation.userId),
          ),
        )
        .orderBy(asc(automation.createdAt), asc(automation.id))
        .limit(limit),
    ),
});

const findIntegrationAutomations = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    provider: Schema.String,
    event: Schema.String,
    limit: Schema.Int,
  }),
  Result: ListeningRowSchema,
  execute: ({ organizationId, provider, event, limit }) =>
    Database.use((db) =>
      db
        .select({ id: automation.id, userId: automation.userId, trigger: automation.trigger })
        .from(automation)
        .where(
          and(
            eq(automation.enabled, true),
            eq(automation.organizationId, organizationId),
            eq(automation.triggerKind, AUTOMATION_TRIGGER.INTEGRATION),
            sql`${automation.trigger}->>'provider' = ${provider}`,
            sql`${automation.trigger}->>'event' = ${event}`,
            memberOfAutomationWorkspace(automation.userId),
          ),
        )
        .orderBy(asc(automation.createdAt), asc(automation.id))
        .limit(limit),
    ),
});

const findSubjectRun = SqlSchema.findAll({
  Request: Schema.Struct({
    automationId: Schema.String,
    subjectId: Schema.String,
    since: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ automationId, subjectId, since }) =>
    Database.use((db) =>
      db
        .select({ id: automationRun.id })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.automationId, automationId),
            gte(automationRun.settledAt, since),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            sql`${automationRun.firing}->>'kind' = ${AUTOMATION_FIRING.INTEGRATION}`,
            sql`${automationRun.firing}->'subject'->>'id' = ${subjectId}`,
          ),
        )
        .limit(1),
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

const FailedRunRowSchema = Schema.Struct({
  id: Schema.String,
  automationId: Schema.String,
  automationName: Schema.String,
  workspaceId: Schema.String,
  reason: Schema.NullOr(automationRunReasonSchema),
  failedAt: InstantColumnSchema,
});

const findOwnFailedRuns = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: FailedRunRowSchema,
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .selectDistinctOn([automationRun.automationId], {
          id: automationRun.id,
          automationId: automationRun.automationId,
          automationName: automation.name,
          workspaceId: automation.organizationId,
          reason: automationRun.reason,
          failedAt: automationRun.settledAt,
        })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(
          and(
            eq(automation.userId, userId),
            memberOfAutomationWorkspace(userId),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.FAILED),
            gte(automationRun.settledAt, since),
          ),
        )
        .orderBy(
          asc(automationRun.automationId),
          desc(automationRun.settledAt),
          desc(automationRun.id),
        ),
    ),
});

export function ownFailedRunsLiveStatement(userId: string): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .selectDistinctOn(
        [automationRun.automationId],
        liveSelection(
          {
            id: automationRun.id,
            automationId: automationRun.automationId,
            automationName: automation.name,
            workspaceId: automation.organizationId,
            reason: automationRun.reason,
          },
          { failedAt: automationRun.settledAt },
        ),
      )
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(
        and(
          eq(automation.userId, userId),
          memberOfAutomationWorkspace(userId),
          eq(automationRun.status, AUTOMATION_RUN_STATUS.FAILED),
        ),
      )
      .orderBy(
        asc(automationRun.automationId),
        desc(automationRun.settledAt),
        desc(automationRun.id),
      ),
  );
}

function readWritten(userId: string, id: string): TaskStoreEffect<Option.Option<Automation>> {
  return findAutomation({ userId, id, access: AUTOMATION_ACCESS.READ });
}

export function createAutomation(
  userId: string,
  made: NewAutomation,
): TaskStoreEffect<Option.Option<Automation>> {
  return Effect.map(createAutomationCommitted(userId, made), Option.map(automationOf));
}

export interface AutomationCommitted {
  readonly automation: Automation;
  readonly txid: string;
}

function automationOf({ automation: written }: AutomationCommitted): Automation {
  return written;
}

export function createAutomationCommitted(
  userId: string,
  made: NewAutomation,
): TaskStoreEffect<Option.Option<AutomationCommitted>> {
  return Effect.gen(function* () {
    if (!(yield* isWorkspaceMember(userId, made.organizationId))) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const [row] = yield* insertAutomation({
      ...made,
      userId,
      repositories: made.repositories ?? [],
      scope: made.scope ?? AUTOMATION_SCOPE.PERSONAL,
      targetKind: made.targetKind ?? AUTOMATION_TARGET.NEW_AGENT,
      targetAgentId: made.targetAgentId ?? null,
      archiveSuccessful: made.archiveSuccessful ?? false,
      slackDelivery: made.slackDelivery ?? false,
      now,
    });
    if (row === undefined) return Option.none();
    const { txid } = row;
    return Option.map(yield* readWritten(userId, row.id), (written) => ({
      automation: written,
      txid,
    }));
  });
}

export interface AutomationListFilter {
  readonly organizationId?: string | undefined;
}

export function listAutomations(
  userId: string,
  filter: AutomationListFilter = {},
): TaskStoreEffect<readonly Automation[]> {
  return findAutomations({
    userId,
    organizationId: filter.organizationId ?? null,
  });
}

export function readAutomation(
  userId: string,
  id: string,
  access: AutomationAccess = AUTOMATION_ACCESS.READ,
): TaskStoreEffect<Option.Option<Automation>> {
  return findAutomation({ userId, id, access });
}

export function updateAutomation(
  userId: string,
  id: string,
  changes: AutomationChanges,
  access:
    | typeof AUTOMATION_ACCESS.CHANGE
    | typeof AUTOMATION_ACCESS.TOGGLE = AUTOMATION_ACCESS.CHANGE,
): TaskStoreEffect<Option.Option<Automation>> {
  return Effect.map(
    updateAutomationCommitted(userId, id, changes, access),
    Option.map(automationOf),
  );
}

export function updateAutomationCommitted(
  userId: string,
  id: string,
  changes: AutomationChanges,
  access:
    | typeof AUTOMATION_ACCESS.CHANGE
    | typeof AUTOMATION_ACCESS.TOGGLE = AUTOMATION_ACCESS.CHANGE,
): TaskStoreEffect<Option.Option<AutomationCommitted>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const [written] = yield* writeAutomation({ ...changes, userId, id, access, now });
    if (written === undefined) return Option.none();
    const { txid } = written;
    return Option.map(yield* readWritten(userId, id), (automation) => ({ automation, txid }));
  });
}

export function deleteAutomation(userId: string, id: string): TaskStoreEffect<boolean> {
  return Effect.map(deleteAutomationCommitted(userId, id), Option.isSome);
}

export function deleteAutomationCommitted(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<{ readonly txid: string }>> {
  return Effect.map(removeAutomation({ userId, id }), (rows) =>
    Option.map(Option.fromUndefinedOr(rows[0]), ({ txid }) => ({ txid })),
  );
}

export function recordAutomationRun(
  owner: Pick<Automation, "id" | "userId">,
  run: NewAutomationRun,
): TaskStoreEffect<Option.Option<QueuedRun & { readonly txid: string }>> {
  const row = {
    dedupeKey: run.dedupeKey,
    firing: run.firing,
    payload: run.payload ?? null,
    firedAt: run.firedAt,
    automationId: owner.id,
    userId: owner.userId,
  };
  return Effect.map(insertRun(row), (rows) => Option.fromUndefinedOr(rows[0]));
}

export function settleAutomationRun(
  runId: string,
  outcome: AutomationRunOutcome,
): TaskStoreEffect<boolean> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const written = yield* writeRunOutcome({
      id: runId,
      status: outcome.status,
      reason: outcome.status === AUTOMATION_RUN_STATUS.STARTED ? null : outcome.reason,
      agentId: outcome.status === AUTOMATION_RUN_STATUS.STARTED ? outcome.agentId : null,
      now,
    });
    return written.length > 0;
  });
}

export function listAutomationRuns(
  userId: string,
  automationId: string,
  limit: number = MAX_RUNS_READ,
): TaskStoreEffect<readonly AutomationRunInHistory[]> {
  return findRuns({ userId, automationId, limit: Math.min(Math.max(limit, 1), MAX_RUNS_READ) });
}

export function automationRunByKey(
  userId: string,
  automationId: string,
  dedupeKey: string,
): TaskStoreEffect<Option.Option<AutomationRunInHistory>> {
  return findRunByKey({ userId, automationId, dedupeKey });
}

export function automationRunsSince(
  automationId: string,
  since: Date,
): TaskStoreEffect<readonly AutomationRun[]> {
  return findRunsSince({ automationId, since });
}

export type OwnFailedRun = typeof FailedRunRowSchema.Type;

export function ownFailedAutomationRuns(
  userId: string,
  since: Date,
): TaskStoreEffect<readonly OwnFailedRun[]> {
  return Effect.map(findOwnFailedRuns({ userId, since }), (runs) =>
    runs.toSorted((a, b) => b.failedAt.getTime() - a.failedAt.getTime()),
  );
}

export function claimDueAutomations(claim: DueClaim): TaskStoreEffect<readonly ClaimedFiring[]> {
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

export function readAutomationToRun(id: string): TaskStoreEffect<Option.Option<Automation>> {
  return findAutomationToRun(id);
}

export function queuedAutomationRuns(
  since: Date,
  limit: number,
): TaskStoreEffect<readonly QueuedRun[]> {
  return findQueuedRuns({ since, limit });
}

export function startedRunAgents(
  automationId: string,
  since: Date,
): TaskStoreEffect<readonly StartedRunAgent[]> {
  return findStartedAgents({ automationId, since });
}

export function archivableRunAgents(
  since: Date,
  limit: number,
): TaskStoreEffect<readonly ArchivableRunAgent[]> {
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

export function settleRunArchive(runId: string): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => writeArchiveSettled({ runId, now }));
}

const SlackDeliverySchema = Schema.Struct({
  runId: Schema.String,
  automationId: Schema.String,
  automationName: Schema.String,
  userId: Schema.String,
  organizationId: Schema.String,
});

export type RunSlackDelivery = typeof SlackDeliverySchema.Type;

const findUndeliveredRun = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: SlackDeliverySchema,
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({
          runId: automationRun.id,
          automationId: automation.id,
          automationName: automation.name,
          userId: automation.userId,
          organizationId: automation.organizationId,
        })
        .from(automationRun)
        .innerJoin(automation, eq(automation.id, automationRun.automationId))
        .where(
          and(
            eq(automationRun.agentId, agentId),
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            isNull(automationRun.slackDeliveredAt),
            eq(automation.slackDelivery, true),
          ),
        )
        .orderBy(desc(automationRun.firedAt))
        .limit(1),
    ),
});

const writeSlackDelivered = SqlSchema.findAll({
  Request: Schema.Struct({ runId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ runId, now }) =>
    Database.use((db) =>
      db
        .update(automationRun)
        .set({ slackDeliveredAt: now })
        .where(and(eq(automationRun.id, runId), isNull(automationRun.slackDeliveredAt)))
        .returning({ id: automationRun.id }),
    ),
});

export function claimRunSlackDelivery(
  agentId: string,
): TaskStoreEffect<Option.Option<RunSlackDelivery>> {
  return Effect.gen(function* () {
    const found = yield* findUndeliveredRun({ agentId });
    if (Option.isNone(found)) return found;
    const now = yield* DateTime.nowAsDate;
    const claimed = yield* writeSlackDelivered({ runId: found.value.runId, now });
    return claimed.length === 0 ? Option.none() : found;
  });
}

export function expireQueuedAutomationRuns(
  before: Date,
  reason: AutomationRunReason,
): TaskStoreEffect<number> {
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

export function creatorStillMember(automationId: string): TaskStoreEffect<boolean> {
  return Effect.map(findCreatorMembership(automationId), (rows) => rows.length > 0);
}

export function withAutomationLocked<A, E, R>(
  automationId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(Effect.andThen(lockAutomationRow(automationId), effect)),
  );
}

const findCurrentRun = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ id: automationRun.id })
        .from(automationRun)
        .where(
          and(
            eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
            or(eq(automationRun.agentId, agentId), eq(automationRun.claimedAgentId, agentId)),
          ),
        )
        .orderBy(desc(automationRun.settledAt), desc(automationRun.firedAt))
        .limit(1),
    ),
});

export function currentAutomationRun(agentId: string): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findCurrentRun(agentId),
    Option.map((run) => run.id),
  );
}

export function claimAutomationRun(
  runId: string,
  claimedAgentId: string | null = null,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeClaim({ id: runId, claimedAgentId, now }), (rows) => rows.length > 0),
  );
}

export function attachRunAgent(
  runId: string,
  agentId: string,
  reason: AutomationRunReason | null = null,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeAgent({ id: runId, agentId, reason, now }), (rows) => rows.length > 0),
  );
}

const writeRunTask = SqlSchema.void({
  Request: Schema.Struct({ runId: Schema.String, taskId: Schema.String }),
  execute: ({ runId, taskId }) =>
    Database.use((db) =>
      db.update(automationRun).set({ taskId }).where(eq(automationRun.id, runId)),
    ),
});

export function attachRunTask(runId: string, taskId: string): TaskStoreEffect<void> {
  return writeRunTask({ runId, taskId });
}

const findRunMadeTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.id, taskId), taskMadeByRun(task.id)))
        .limit(1),
    ),
});

export function isRunTask(taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(findRunMadeTask({ taskId }), Option.isSome);
}

export function adoptAutomationAgent(
  automationId: string,
  held: string | null,
  agentId: string,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      writeAgentAdopted({ id: automationId, held, agentId, now }),
      (rows) => rows.length > 0,
    ),
  );
}

export function failClaimedRun(
  runId: string,
  reason: AutomationRunReason,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeClaimFailed({ id: runId, reason, now }), (rows) => rows.length > 0),
  );
}

export function claimedRunsStarting(automationId: string, since: Date): TaskStoreEffect<number> {
  return Effect.map(findClaimed({ automationId, since }), (rows) => rows.length);
}

export interface StrandedRun {
  readonly id: string;
  readonly automationId: string;
  readonly userId: string;
  readonly claimedAgentId: string | null;
}

export function strandedAutomationRuns(
  before: Date,
  limit: number,
): TaskStoreEffect<readonly StrandedRun[]> {
  return findStranded({ before, limit });
}

const WebhookRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  enabled: Schema.Boolean,
  webhookSecretHash: Schema.NullOr(Schema.String),
});

export type WebhookAutomation = typeof WebhookRowSchema.Type;

const findWebhookAutomation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: WebhookRowSchema,
  execute: (id) =>
    Database.use((db) =>
      db
        .select({
          id: automation.id,
          userId: automation.userId,
          enabled: automation.enabled,
          webhookSecretHash: automation.webhookSecretHash,
        })
        .from(automation)
        .where(
          and(
            eq(automation.id, id),
            eq(automation.triggerKind, AUTOMATION_TRIGGER.WEBHOOK),
            memberOfAutomationWorkspace(automation.userId),
          ),
        ),
    ),
});

export function readWebhookAutomation(
  id: string,
): TaskStoreEffect<Option.Option<WebhookAutomation>> {
  return findWebhookAutomation(id);
}

export function githubAutomationsOn(
  repository: string,
  event: GitHubTriggerEvent,
  limit: number,
): TaskStoreEffect<readonly ListeningAutomation[]> {
  return findGithubAutomations({ repository, event, limit });
}

export function integrationAutomationsOn(
  organizationId: string,
  provider: TriggerProvider,
  event: SentryTriggerEvent,
  limit: number,
): TaskStoreEffect<readonly ListeningAutomation[]> {
  return findIntegrationAutomations({ organizationId, provider, event, limit });
}

export function subjectRunStartedSince(
  automationId: string,
  subjectId: string,
  since: Date,
): TaskStoreEffect<boolean> {
  return Effect.map(findSubjectRun({ automationId, subjectId, since }), (rows) => rows.length > 0);
}
