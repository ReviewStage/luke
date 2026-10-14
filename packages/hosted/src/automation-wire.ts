import { Schema as EffectSchema } from "effect";
import { modelChoiceSchema } from "./models-wire.js";

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

const AUTOMATION_BOUNDS = {
  /** The most characters an automation's name may spell. */
  MAX_NAME_CHARS: 80,
  /** The most characters of a prompt, the same bound a coding agent's task is held to. */
  MAX_PROMPT_CHARS: 20_000,
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
const GITHUB_TRIGGER_EVENT = {
  PULL_REQUEST_OPENED: "pull-request-opened",
  PULL_REQUEST_LABELED: "pull-request-labeled",
  ISSUE_OPENED: "issue-opened",
  ISSUE_LABELED: "issue-labeled",
  /** A check suite on a branch completed without passing. */
  CHECK_FAILED: "check-failed",
  /** Commits pushed to a branch. */
  PUSH: "push",
} as const;

/** What an automation starts when it fires. */
export const AUTOMATION_ACTION = {
  /** A coding agent on the plan's repository, handed the prompt as its task. */
  CODING_AGENT: "coding-agent",
} as const;

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
  /** The account no longer reaches the repository through the Luke GitHub App. */
  REPOSITORY_UNREACHABLE: "repository-unreachable",
  /** The account must sign in with GitHub again before the App can act for it. */
  GITHUB_SIGN_IN: "github-sign-in",
  /** The model or effort named is no longer offered. */
  MODEL: "model",
  /** The coding agents' service could not be reached. */
  UNAVAILABLE: "unavailable",
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
