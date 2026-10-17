import {
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  type AutomationActionJson,
  type AutomationFiring,
  type AutomationGuards,
  type AutomationRunReason,
  type AutomationRunStatus,
  type AutomationScope,
  type AutomationTargetKind,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "@luke/features/automation-wire";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { task } from "./task.js";

/**
 * automation.ts -- an account's automations, each a trigger and a coding agent to start on one plan, and every run one made.
 *
 * An automation is its account's and works on one plan: the trigger, the
 * action, and the guards are the wire's own JSON
 * (`@luke/features/automation-wire`), so a trigger kind added later is a
 * member of that JSON rather than a column. Two things are columns because a
 * statement reads them: `trigger_kind`, which a GitHub delivery finds its
 * automations by, and `next_run_at`, the instant a schedule is next due,
 * which the minute sweep claims by (null for every other trigger and while
 * paused). `webhook_secret_hash` is the SHA-256 of the secret a webhook
 * trigger's address carries, never the secret itself, and null for every
 * other trigger. `enabled` false is turned off, by the developer alone:
 * nothing pauses an automation for its failures. The row goes with its
 * account and its plan alike.
 *
 * An automation belongs to a workspace (`organization_id`), as its owner's
 * (`scope` personal) or the workspace's own (`scope` workspace), and works
 * in `repositories`, an ordered list of `owner/name` whose first is where
 * the agent starts; one entry until full multi-repo. `task_id` stands only
 * on the rows made before automations left plans, and goes in the contract
 * step. `target_kind` says where a run lands: a new agent each run, or the
 * agent `target_agent_id` names, which goes null where that agent is
 * deleted. `archive_successful` archives a new agent once its run finishes
 * without failing.
 */
export const automation = pgTable(
  "automation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope").$type<AutomationScope>().notNull().default(AUTOMATION_SCOPE.PERSONAL),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull(),
    triggerKind: text("trigger_kind").$type<AutomationTriggerKind>().notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    // Note that the column holds the action as JSON writes it, its servers not yet read against the providers known.
    action: jsonb("action").$type<AutomationActionJson>().notNull(),
    guards: jsonb("guards").$type<AutomationGuards>().notNull(),
    /** When a schedule is next due; null for any other trigger and while paused. */
    nextRunAt: timestamptz("next_run_at"),
    /** The SHA-256 of a webhook trigger's secret, hex; null for any other trigger. */
    webhookSecretHash: text("webhook_secret_hash"),
    /** Where the agent works, `owner/name` each, the first where it starts. */
    repositories: jsonb("repositories").$type<readonly string[]>().notNull().default([]),
    targetKind: text("target_kind")
      .$type<AutomationTargetKind>()
      .notNull()
      .default(AUTOMATION_TARGET.NEW_AGENT),
    /** The agent a run continues where `target_kind` is the same agent; null otherwise or once it is deleted. */
    targetAgentId: uuid("target_agent_id").references(() => codingAgent.id, {
      onDelete: "set null",
    }),
    archiveSuccessful: boolean("archive_successful").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The settings list reads one account's automations newest first.
    index("automation_user_created").on(table.userId, table.createdAt),
    // The sweep claims the schedules due, soonest first.
    index("automation_next_run").on(table.nextRunAt).where(sql`${table.nextRunAt} is not null`),
    // A delivery finds the automations of its trigger kind, then reads each one's repositories.
    index("automation_trigger_task").on(table.triggerKind, table.taskId),
    // A workspace's automations, each scope newest first.
    index("automation_org_scope_created").on(table.organizationId, table.scope, table.createdAt),
  ],
);

/**
 * One firing of an automation: what fired it, in brief, and what came of
 * it. `dedupe_key` is the firing's own identity, unique per automation, so
 * a schedule claimed twice, a webhook GitHub delivers again, or a caller's
 * retry under the same key records one run: the due instant for a
 * schedule, GitHub's delivery id for an event, the caller's idempotency key
 * for a webhook or a "Run now". A webhook's body is kept beside it as
 * `payload`, since the sweep that starts the run's agent comes after the
 * request that brought it. The status is the firing's; how the agent it
 * started is doing is the agent's own, read through `coding_agent_id`,
 * which goes null where the agent is deleted while the run stays in the
 * history. The row goes with its automation.
 */
export const automationRun = pgTable(
  "automation_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    firing: jsonb("firing").$type<AutomationFiring>().notNull(),
    /** A webhook firing's body as its caller sent it, bounded, for the agent's prompt; null for every other firing. */
    payload: text("payload"),
    status: text("status").$type<AutomationRunStatus>().notNull(),
    /** Why it was skipped or failed; null while queued and once started. */
    reason: text("reason").$type<AutomationRunReason>(),
    /** The coding agent it started; null before, and where that agent is gone. */
    codingAgentId: uuid("coding_agent_id").references(() => codingAgent.id, {
      onDelete: "set null",
    }),
    firedAt: timestamptz("fired_at").notNull(),
    /** When it was started, skipped, or failed; null while queued. */
    settledAt: timestamptz("settled_at"),
    /**
     * The agent a run of an automation that hands every run to the same
     * agent was claimed to send its task to, as it was at the claim, so the
     * run is recovered by that agent's line whatever the automation names
     * since; null for any other run, and once that agent is deleted.
     */
    claimedAgentId: uuid("claimed_agent_id").references(() => codingAgent.id, {
      onDelete: "set null",
    }),
    /**
     * When the sweep settled what becomes of the agent a run started for an
     * automation that archives its successful runs: archived once it
     * finished well, or left standing for good as failed, stopped, or put
     * away by hand; null until then, and for every other run.
     */
    archiveSettledAt: timestamptz("archive_settled_at"),
  },
  (table) => [
    // One run per firing: a second claim of the same firing finds this row.
    uniqueIndex("automation_run_dedupe").on(table.automationId, table.dedupeKey),
    // The history reads one automation's runs newest first, and the guards count its recent ones.
    index("automation_run_automation_fired").on(table.automationId, table.firedAt),
  ],
);
