import type {
  AutomationAction,
  AutomationFiring,
  AutomationGuards,
  AutomationPause,
  AutomationRunReason,
  AutomationRunStatus,
  AutomationTrigger,
  AutomationTriggerKind,
} from "@sidecar/hosted/automation-wire";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { user } from "./auth.js";
import { codingAgent } from "./coding-agent.js";
import { plan } from "./plan.js";

/**
 * automation.ts -- an account's automations, each a trigger and a coding agent to start on one plan, and every run one made.
 *
 * An automation is its account's and works on one plan: the trigger, the
 * action, and the guards are the wire's own JSON
 * (`@sidecar/hosted/automation-wire`), so a trigger kind added later is a
 * member of that JSON rather than a column. Two things are columns because a
 * statement reads them: `trigger_kind`, which a GitHub delivery finds its
 * automations by, and `next_run_at`, the instant a schedule is next due,
 * which the minute sweep claims by (null for every other trigger and while
 * paused). `webhook_secret_hash` is the SHA-256 of the secret a webhook
 * trigger's address carries, never the secret itself, and null for every
 * other trigger. `enabled` false is paused; `paused_reason` says why where
 * the service paused it rather than the developer. The row goes with its
 * account and its plan alike.
 */
export const automation = pgTable(
  "automation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull(),
    /** Why the service paused it; null where it runs or the developer paused it. */
    pausedReason: text("paused_reason").$type<AutomationPause>(),
    triggerKind: text("trigger_kind").$type<AutomationTriggerKind>().notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    action: jsonb("action").$type<AutomationAction>().notNull(),
    guards: jsonb("guards").$type<AutomationGuards>().notNull(),
    /** When a schedule is next due; null for any other trigger and while paused. */
    nextRunAt: timestamptz("next_run_at"),
    /** The SHA-256 of a webhook trigger's secret, hex; null for any other trigger. */
    webhookSecretHash: text("webhook_secret_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The settings list reads one account's automations newest first.
    index("automation_user_created").on(table.userId, table.createdAt),
    // The sweep claims the schedules due, soonest first.
    index("automation_next_run").on(table.nextRunAt).where(sql`${table.nextRunAt} is not null`),
    // A delivery finds the automations of its trigger kind on the plans of its repository.
    index("automation_trigger_plan").on(table.triggerKind, table.planId),
  ],
);

/**
 * One firing of an automation: what fired it, in brief, and what came of
 * it. `dedupe_key` is the firing's own identity, unique per automation, so
 * a schedule claimed twice, a webhook GitHub delivers again, or a caller's
 * retry under the same key records one run: the due instant for a
 * schedule, GitHub's delivery id for an event, the caller's idempotency key
 * for a webhook or a "Run now". The status is the firing's; how the agent it
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
  },
  (table) => [
    // One run per firing: a second claim of the same firing finds this row.
    uniqueIndex("automation_run_dedupe").on(table.automationId, table.dedupeKey),
    // The history reads one automation's runs newest first, and the guards count its recent ones.
    index("automation_run_automation_fired").on(table.automationId, table.firedAt),
  ],
);
