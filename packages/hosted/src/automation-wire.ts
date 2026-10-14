import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import { modelChoiceSchema } from "./models-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * automation-wire.ts -- an automation as the service keeps it: what fires it, what it starts, the guards on how often, and each run it made.
 *
 * An automation belongs to the account that made it and works on one of its
 * plans: when its trigger fires, the service starts a coding agent on the
 * plan's repository with the automation's prompt as the agent's task, the
 * firing described beneath it, exactly as a developer's own Start with a
 * task would. A trigger is a schedule, a cron expression read in an IANA
 * time zone, or an event of the plan's repository the Luke GitHub App is
 * told of, filtered by label or branch, or a call to the automation's own
 * webhook address. Every firing is a run, kept whether it started an agent,
 * was held back by a guard, or failed to start, so the history says why an
 * automation did or did not act. The shapes here are what the store keeps
 * as JSON (`packages/database/src/schemas/automation.ts`) and what the
 * routes answer, declared once.
 */

export const AUTOMATION_BOUNDS = {
  /** The most characters an automation's name may spell. */
  MAX_NAME_CHARS: 80,
  /** The most characters of a prompt: under a coding agent's task bound, with room for what Luke adds about the firing. */
  MAX_PROMPT_CHARS: 12_000,
  /** The most characters of a cron expression. */
  MAX_CRON_CHARS: 120,
  /** The most characters of an IANA time zone name. */
  MAX_TIMEZONE_CHARS: 64,
  /** The most labels or branches a GitHub trigger filters on. */
  MAX_FILTER_VALUES: 10,
  /** The most characters of one label or branch a filter names. */
  MAX_FILTER_VALUE_CHARS: 100,
  /** The most agents one automation may have at work at once. */
  MAX_CONCURRENT_RUNS: 5,
  /** The most runs one automation may start in a day. */
  MAX_DAILY_RUNS: 50,
  /** The most characters of a "Run now" key. */
  MAX_KEY_CHARS: 128,
  /** The most runs one history read answers. */
  MAX_RUNS_READ: 100,
} as const;

/** What fires an automation. */
export const AUTOMATION_TRIGGER = {
  /** A cron schedule in a time zone, fired by the service's once-a-minute sweep. */
  SCHEDULE: "schedule",
  /** An event of the plan's repository, delivered by the Luke GitHub App's webhook. */
  GITHUB: "github",
  /** A POST to the automation's own secret address. */
  WEBHOOK: "webhook",
} as const;

export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER)[keyof typeof AUTOMATION_TRIGGER];

/** The repository events a GitHub trigger listens for. */
export const GITHUB_TRIGGER_EVENT = {
  PULL_REQUEST_OPENED: "pull-request-opened",
  PULL_REQUEST_LABELED: "pull-request-labeled",
  ISSUE_OPENED: "issue-opened",
  ISSUE_LABELED: "issue-labeled",
  /** A check suite on a branch completed without passing. */
  CHECK_FAILED: "check-failed",
  /** Commits pushed to a branch. */
  PUSH: "push",
} as const;

export type GitHubTriggerEvent = (typeof GITHUB_TRIGGER_EVENT)[keyof typeof GITHUB_TRIGGER_EVENT];

/** What an automation starts when it fires. */
export const AUTOMATION_ACTION = {
  /** A coding agent on the plan's repository, handed the prompt as its task. */
  CODING_AGENT: "coding-agent",
} as const;

const nameSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_NAME_CHARS),
);

const filterValuesSchema = EffectSchema.Array(
  EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_FILTER_VALUE_CHARS),
  ),
).check(EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_FILTER_VALUES));

/**
 * A schedule: five-field cron, read in the IANA zone named, so "9 every
 * weekday" stays nine o'clock across a daylight-saving change. Whether the
 * expression parses and the zone exists is the schedule module's check
 * (`automation-schedule.ts` beside this module), since it is the one
 * that reads them.
 */
const scheduleTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.SCHEDULE),
  cron: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_CRON_CHARS),
  ),
  timezone: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_TIMEZONE_CHARS),
  ),
});

/**
 * An event of the plan's repository. `labels` keeps a labelled event to
 * those labels and `branches` an event to those branches (a pull request's
 * base, a push's or a check's branch); an empty or absent list keeps
 * nothing out.
 */
const githubTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.GITHUB),
  event: EffectSchema.Literals(Object.values(GITHUB_TRIGGER_EVENT)),
  labels: EffectSchema.optionalKey(filterValuesSchema),
  branches: EffectSchema.optionalKey(filterValuesSchema),
});

/** A call to the automation's own address; the secret that admits it is the store's, never on this wire. */
const webhookTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.WEBHOOK),
});

export const automationTriggerSchema = EffectSchema.Union([
  scheduleTriggerSchema,
  githubTriggerSchema,
  webhookTriggerSchema,
]);

export type AutomationTrigger = typeof automationTriggerSchema.Type;

/** A coding agent handed the prompt as its task, on the model and effort named, or the account's default. */
const codingAgentActionSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_ACTION.CODING_AGENT),
  prompt: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS),
  ),
  choice: EffectSchema.optionalKey(modelChoiceSchema),
});

export const automationActionSchema = codingAgentActionSchema;

export type AutomationAction = typeof automationActionSchema.Type;

/**
 * How far one automation may go: how many of its agents may be at work at
 * once, past which a firing is skipped rather than queued, and how many
 * runs it may start in a day, counted over the last twenty-four hours.
 */
export const automationGuardsSchema = EffectSchema.Struct({
  maxConcurrentRuns: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS }),
  ),
  dailyRunCap: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: AUTOMATION_BOUNDS.MAX_DAILY_RUNS }),
  ),
});

export type AutomationGuards = typeof automationGuardsSchema.Type;

/** The guards an automation gets where its maker names none: one agent at a time, ten a day. */
export const AUTOMATION_DEFAULT_GUARDS: AutomationGuards = {
  maxConcurrentRuns: 1,
  dailyRunCap: 10,
};

/** Why an automation stands paused where the developer did not pause it. */
export const AUTOMATION_PAUSE = {
  /** Its last runs failed one after another, so the service stopped firing it. */
  FAILURES: "failures",
} as const;

export type AutomationPause = (typeof AUTOMATION_PAUSE)[keyof typeof AUTOMATION_PAUSE];

/** Where a run came from, beyond the automation's own trigger. */
export const AUTOMATION_FIRING = {
  ...AUTOMATION_TRIGGER,
  /** The developer's own "Run now", whatever the trigger is. */
  MANUAL: "manual",
} as const;

/**
 * What fired a run, in brief: the instant a schedule was due, the GitHub
 * event with the issue or pull request it names, or a webhook call with how
 * large its body was. Only what the run's history shows is kept; a
 * webhook's body reaches the agent's task and is kept nowhere else here.
 */
export const automationFiringSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.SCHEDULE),
    /** The instant the schedule was due, in epoch milliseconds. */
    dueAt: EffectSchema.Number,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.GITHUB),
    event: EffectSchema.Literals(Object.values(GITHUB_TRIGGER_EVENT)),
    repository: EffectSchema.String,
    /** The issue's or pull request's number, where the event names one. */
    number: EffectSchema.optionalKey(EffectSchema.Int),
    title: EffectSchema.optionalKey(EffectSchema.String),
    branch: EffectSchema.optionalKey(EffectSchema.String),
    url: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.WEBHOOK),
    bytes: EffectSchema.Int,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.MANUAL),
  }),
]);

export type AutomationFiring = typeof automationFiringSchema.Type;

/** Where a run stands. */
export const AUTOMATION_RUN_STATUS = {
  /** Recorded and not yet acted on. */
  QUEUED: "queued",
  /** Its coding agent was started; how the agent is doing is the agent's own status. */
  STARTED: "started",
  /** A guard held it back; nothing was started. */
  SKIPPED: "skipped",
  /** The service could not start its agent. */
  FAILED: "failed",
} as const;

export type AutomationRunStatus =
  (typeof AUTOMATION_RUN_STATUS)[keyof typeof AUTOMATION_RUN_STATUS];

/** Why a run was skipped or failed, one fixed word each, so nothing a provider said reaches the history. */
export const AUTOMATION_RUN_REASON = {
  /** As many of its agents as the guard allows were still at work. */
  CONCURRENCY: "concurrency",
  /** It had already started as many runs as its daily cap allows. */
  DAILY_CAP: "daily-cap",
  /** The plan is gone, or no longer reachable by the account. */
  PLAN_UNREACHABLE: "plan-unreachable",
  /** The plan names no repository. */
  NO_REPOSITORY: "no-repository",
  /** The GitHub installation connected to the plan's workspace no longer reaches the repository. */
  REPOSITORY_UNREACHABLE: "repository-unreachable",
  /** No longer produced, but still read: rows written before repositories came only from the workspace's installation hold it. */
  GITHUB_SIGN_IN: "github-sign-in",
  /** The model or effort named is no longer offered. */
  MODEL: "model",
  /** The coding agents' service could not be reached. */
  UNAVAILABLE: "unavailable",
  /** The plan moved to another repository after this run's GitHub event was queued. */
  REPOSITORY_CHANGED: "repository-changed",
  /** The automation was paused after this run was queued and before it was acted on. */
  PAUSED: "paused",
  /** It waited queued past the hour it could still be started in, the sweep down or failing all that while. */
  MISSED: "missed",
} as const;

export type AutomationRunReason =
  (typeof AUTOMATION_RUN_REASON)[keyof typeof AUTOMATION_RUN_REASON];

export const automationRunStatusSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_STATUS),
);
export const automationRunReasonSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_REASON),
);
export const automationPauseSchema = EffectSchema.Literals(Object.values(AUTOMATION_PAUSE));

/** The query an automation list may narrow by: one plan's automations alone. */
export const AUTOMATION_LIST_QUERY = { PLAN_ID: "planId" } as const;

/**
 * One run as the history shows it: what fired it, where it stands, why
 * where it did not start, and the agent it started with that agent's own
 * status and title as its tab reads them, null where it started none or
 * the agent is gone. Instants are epoch milliseconds.
 */
const automationRunSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  agent: EffectSchema.NullOr(
    EffectSchema.Struct({
      id: wireUuidSchema,
      title: EffectSchema.NullOr(EffectSchema.String),
      status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
    }),
  ),
  firedAt: countedNumber,
  settledAt: EffectSchema.NullOr(countedNumber),
});

export type AutomationRunSummary = typeof automationRunSummarySchema.Type;

/**
 * One automation as the list shows it: the plan it works on, whether it
 * runs and why not where the service paused it, what fires it and what it
 * starts, its guards, when a schedule is next due, and its newest run.
 */
const automationSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: wireUuidSchema,
  planName: EffectSchema.String,
  name: EffectSchema.String,
  enabled: EffectSchema.Boolean,
  pausedReason: EffectSchema.NullOr(automationPauseSchema),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: EffectSchema.NullOr(countedNumber),
  lastRun: EffectSchema.NullOr(automationRunSummarySchema),
  createdAt: countedNumber,
});

export type AutomationSummary = typeof automationSummarySchema.Type;

/** The account's automations, newest first (GET). */
export const automationListAnswerSchema = EffectSchema.Struct({
  automations: EffectSchema.Array(automationSummarySchema),
});

/**
 * One automation as a write answers it; a webhook trigger's secret rides
 * along only on the answer that made it, the one time it is shown.
 */
export const automationAnswerSchema = EffectSchema.Struct({
  automation: automationSummarySchema,
  webhookSecret: EffectSchema.optionalKey(EffectSchema.String),
});

/** An automation to make (POST): its plan, name, trigger, and action, and its guards or the defaults. */
export const automationCreateRequestSchema = EffectSchema.Struct({
  planId: wireUuidSchema,
  name: nameSchema,
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: EffectSchema.optionalKey(automationGuardsSchema),
});

/** A change to an automation (PATCH): any of its fields, a field left out standing as it was. */
export const automationChangeRequestSchema = EffectSchema.Struct({
  name: EffectSchema.optionalKey(nameSchema),
  enabled: EffectSchema.optionalKey(EffectSchema.Boolean),
  trigger: EffectSchema.optionalKey(automationTriggerSchema),
  action: EffectSchema.optionalKey(automationActionSchema),
  guards: EffectSchema.optionalKey(automationGuardsSchema),
});

/**
 * A "Run now" (POST), under the client's own key, a UUID, so a retry after a
 * lost answer is the same run and the key can never be the instant a
 * schedule's own run is recorded under.
 */
export const automationRunRequestSchema = EffectSchema.Struct({
  idempotencyKey: wireUuidSchema,
});

/** The run a "Run now" made, as it came out. */
export const automationRunAnswerSchema = EffectSchema.Struct({
  run: automationRunSummarySchema,
});

/** An automation's runs, newest first (GET). */
export const automationRunsAnswerSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(automationRunSummarySchema),
});
