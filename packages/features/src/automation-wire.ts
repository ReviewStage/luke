import { Schema as EffectSchema } from "effect";
import {
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  disabledServersSchema,
} from "./coding-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { modelChoiceSchema } from "./models-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { SENTRY_LEVEL, SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "./trigger-catalog.js";

/**
 * automation-wire.ts -- an automation as the service keeps it: what fires it, what it starts, the guards on how often, and each run it made.
 *
 * An automation belongs to the account that made it and works on one of its
 * tasks: when its trigger fires, the service starts a coding agent on the
 * task's repository with the automation's prompt as the agent's prompt, the
 * firing described beneath it, exactly as a developer's own Start with a
 * task would. A trigger is a schedule, a cron expression read in an IANA
 * time zone, or an event of the task's repository the Luke GitHub App is
 * told of, filtered by label or branch, a call to the automation's own
 * webhook address, or an event of an integration installed on the
 * automation's workspace (`trigger-catalog.ts`), filtered by its fields. Every firing is a run, kept whether it started an agent,
 * was held back by a guard, or failed to start, so the history says why an
 * automation did or did not act. The shapes here are what the store keeps
 * as JSON (`packages/database/src/schemas/automation.ts`) and what the
 * routes answer, declared once.
 *
 * Note that `planId` and `planName` keep the wire's legacy spelling of a task, because a
 * released desktop sends and reads them; they are renamed with the wire in a
 * follow-up, with no alias.
 */

export const AUTOMATION_BOUNDS = {
  /** The most characters an automation's name may spell. */
  MAX_NAME_CHARS: 80,
  /** The most characters of a prompt: under a coding agent's prompt bound, with room for what Luke adds about the firing. */
  MAX_PROMPT_CHARS: 12_000,
  /** The most characters of a cron expression. */
  MAX_CRON_CHARS: 120,
  /** The most characters of an IANA time zone name. */
  MAX_TIMEZONE_CHARS: 64,
  /** The most labels or branches a GitHub trigger filters on. */
  MAX_FILTER_VALUES: 10,
  /** The most characters of one label or branch a filter names. */
  MAX_FILTER_VALUE_CHARS: 100,
  /** The most repositories one automation's runs work in; a run starts in the first until full multi-repo. */
  MAX_REPOSITORIES: 10,
  /** The most agents one automation may have at work at once. */
  MAX_CONCURRENT_RUNS: 5,
  /** The most runs one automation may start in a day. */
  MAX_DAILY_RUNS: 50,
  /** The most characters of a "Run now" key. */
  MAX_KEY_CHARS: 128,
  /** The most runs one history read answers. */
  MAX_RUNS_READ: 100,
  /** The longest an integration trigger waits before the same subject fires it again, in hours: a week. */
  MAX_SUBJECT_COOLDOWN_HOURS: 168,
} as const;

/** What fires an automation. */
export const AUTOMATION_TRIGGER = {
  /** A cron schedule in a time zone, fired by the service's once-a-minute sweep. */
  SCHEDULE: "schedule",
  /** An event of the task's repository, delivered by the Luke GitHub App's webhook. */
  GITHUB: "github",
  /** A POST to the automation's own secret address. */
  WEBHOOK: "webhook",
  /** An event of an integration installed on the automation's workspace (`trigger-catalog.ts`). */
  INTEGRATION: "integration",
} as const;

export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER)[keyof typeof AUTOMATION_TRIGGER];

/** The repository events a GitHub trigger listens for. */
export const GITHUB_TRIGGER_EVENT = {
  PULL_REQUEST_OPENED: "pull-request-opened",
  PULL_REQUEST_LABELED: "pull-request-labeled",
  /** A pull request ready for review opened, reopened, marked ready, or pushed to: what a review runs on. */
  PULL_REQUEST_UPDATED: "pull-request-updated",
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
  /** A coding agent on the task's repository, handed the prompt as its task. */
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

/** Who caused a GitHub event, as a trigger chooses whose events fire it. */
export const GITHUB_SENDER = {
  /** A person's own account. */
  PEOPLE: "people",
  /** Luke's coding agents: the Luke GitHub App, and a developer an agent opening its pull request from a `luke/` branch writes as. */
  LUKE_AGENTS: "luke-agents",
  /** Any other App or bot account: Dependabot, Renovate, and their like. */
  OTHER_BOTS: "other-bots",
} as const;

export type GitHubSender = (typeof GITHUB_SENDER)[keyof typeof GITHUB_SENDER];

/** The moments of a pull request a `pull-request-updated` trigger may fire on. */
export const PULL_REQUEST_MOMENT = {
  /** Opened, or reopened. */
  OPENED: "opened",
  /** A draft marked ready for review. */
  READY: "ready",
  /** New commits pushed to it. */
  PUSHED: "pushed",
} as const;

export type PullRequestMoment = (typeof PULL_REQUEST_MOMENT)[keyof typeof PULL_REQUEST_MOMENT];

/** Whose events a trigger hears where it names none: people's alone, so no automation hears its own agents unasked. */
export const GITHUB_DEFAULT_SENDERS: readonly GitHubSender[] = [GITHUB_SENDER.PEOPLE];

/** The moments a `pull-request-updated` trigger fires on where it names none: every one. */
export const PULL_REQUEST_DEFAULT_MOMENTS: readonly PullRequestMoment[] =
  Object.values(PULL_REQUEST_MOMENT);

/**
 * An event of the automation's repositories. `labels` keeps a labelled
 * event to those labels and `branches` an event to those branches (a pull
 * request's base, a push's or a check's branch); an empty or absent list
 * keeps nothing out. `senders` says whose events fire it, people's alone
 * where absent; `moments` which moments of a pull request an update fires
 * on, every one where absent. A draft pull request fires it only where
 * `drafts` is true, and one from a fork only where `forks` is.
 */
const githubTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.GITHUB),
  event: EffectSchema.Literals(Object.values(GITHUB_TRIGGER_EVENT)),
  labels: EffectSchema.optionalKey(filterValuesSchema),
  branches: EffectSchema.optionalKey(filterValuesSchema),
  senders: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(Object.values(GITHUB_SENDER))),
  ),
  moments: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(Object.values(PULL_REQUEST_MOMENT))),
  ),
  drafts: EffectSchema.optionalKey(EffectSchema.Boolean),
  forks: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/** A call to the automation's own address; the secret that admits it is the store's, never on this wire. */
const webhookTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.WEBHOOK),
});

/**
 * What a Sentry trigger keeps its events to: within a field any value
 * named matches, across fields every one named must, and an empty or
 * absent field keeps nothing out.
 */
const sentryTriggerFiltersSchema = EffectSchema.Struct({
  project: EffectSchema.optionalKey(filterValuesSchema),
  environment: EffectSchema.optionalKey(filterValuesSchema),
  level: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(Object.values(SENTRY_LEVEL))).check(
      EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_FILTER_VALUES),
    ),
  ),
});

/**
 * An event of the Sentry organization installed on the automation's
 * workspace; only deliveries from that workspace's installation fire it.
 */
const sentryTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.INTEGRATION),
  provider: EffectSchema.Literal(TRIGGER_PROVIDER.SENTRY),
  event: EffectSchema.Literals(Object.values(SENTRY_TRIGGER_EVENT)),
  filters: EffectSchema.optionalKey(sentryTriggerFiltersSchema),
});

export const automationTriggerSchema = EffectSchema.Union([
  scheduleTriggerSchema,
  githubTriggerSchema,
  webhookTriggerSchema,
  sentryTriggerSchema,
]);

export type AutomationTrigger = typeof automationTriggerSchema.Type;

/** A trigger on an integration's event, whichever the provider. */
export type IntegrationTrigger = Extract<
  AutomationTrigger,
  { kind: typeof AUTOMATION_TRIGGER.INTEGRATION }
>;

/** A coding agent handed the prompt as its task, on the model and effort named, or the account's default, with the MCP servers named switched off. */
const codingAgentActionSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_ACTION.CODING_AGENT),
  prompt: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS),
  ),
  choice: EffectSchema.optionalKey(modelChoiceSchema),
  /** The owner's connected MCP servers a run's new agent is not handed; every one is, where none are named. */
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
});

export const automationActionSchema = codingAgentActionSchema;

export type AutomationAction = typeof automationActionSchema.Type;

/** An action as JSON holds it, before its servers are read against the providers this build knows. */
export type AutomationActionJson = typeof automationActionSchema.Encoded;

/**
 * How far one automation may go: how many of its agents may be at work at
 * once, past which a firing is skipped rather than queued, how many
 * runs it may start in a day, counted over the last twenty-four hours, and,
 * for an integration trigger, how many hours pass before the same subject
 * (one Sentry issue) may start another run, a day where absent.
 */
export const automationGuardsSchema = EffectSchema.Struct({
  maxConcurrentRuns: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS }),
  ),
  dailyRunCap: EffectSchema.Int.check(
    EffectSchema.isBetween({ minimum: 1, maximum: AUTOMATION_BOUNDS.MAX_DAILY_RUNS }),
  ),
  subjectCooldownHours: EffectSchema.optionalKey(
    EffectSchema.Int.check(
      EffectSchema.isBetween({
        minimum: 1,
        maximum: AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS,
      }),
    ),
  ),
});

export type AutomationGuards = typeof automationGuardsSchema.Type;

/** The guards an automation gets where its maker names none: one agent at a time, ten a day. */
export const AUTOMATION_DEFAULT_GUARDS: AutomationGuards = {
  maxConcurrentRuns: 1,
  dailyRunCap: 10,
};

/** Who an automation belongs to: its owner alone, or the workspace it was made in. */
export const AUTOMATION_SCOPE = {
  /** Its creator's: only they see and change it; the workspace's owners and admins see and pause it. */
  PERSONAL: "personal",
  /** The workspace's: every member sees, runs, and pauses it; its creator, owners, and admins change it. */
  WORKSPACE: "workspace",
} as const;

export type AutomationScope = (typeof AUTOMATION_SCOPE)[keyof typeof AUTOMATION_SCOPE];

export const automationScopeSchema = EffectSchema.Literals(Object.values(AUTOMATION_SCOPE));

/** Where an automation's run lands. */
export const AUTOMATION_TARGET = {
  /** A fresh agent each run. */
  NEW_AGENT: "new-agent",
  /** A follow-up to one chosen agent each run. */
  SAME_AGENT: "same-agent",
} as const;

export type AutomationTargetKind = (typeof AUTOMATION_TARGET)[keyof typeof AUTOMATION_TARGET];

export const automationTargetKindSchema = EffectSchema.Literals(Object.values(AUTOMATION_TARGET));

/** Where a run lands: a new agent, or the one agent a run continues. */
const automationTargetSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AUTOMATION_TARGET.NEW_AGENT) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_TARGET.SAME_AGENT),
    agentId: wireUuidSchema,
  }),
]);

export type AutomationTarget = typeof automationTargetSchema.Type;

/** Where a run came from, beyond the automation's own trigger. */
export const AUTOMATION_FIRING = {
  ...AUTOMATION_TRIGGER,
  /** The developer's own "Run now", whatever the trigger is. */
  MANUAL: "manual",
} as const;

/**
 * What fired a run, in brief: the instant a schedule was due, the GitHub
 * event with the issue or pull request it names, a webhook call with how
 * large its body was, an integration's event with the subject it is about
 * (a Sentry issue), or a "Run now" with who asked for it. Only what the
 * run's history shows is kept; a webhook's body reaches the agent's prompt
 * and is kept nowhere else here.
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
    kind: EffectSchema.Literal(AUTOMATION_FIRING.INTEGRATION),
    provider: EffectSchema.Literal(TRIGGER_PROVIDER.SENTRY),
    event: EffectSchema.Literals(Object.values(SENTRY_TRIGGER_EVENT)),
    /** What the event is about, by the provider's own id (a Sentry issue's), which the cooldown keys on. */
    subject: EffectSchema.Struct({
      id: EffectSchema.String,
      title: EffectSchema.optionalKey(EffectSchema.String),
      url: EffectSchema.optionalKey(EffectSchema.String),
    }),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.MANUAL),
    /** The member who asked for the run; absent on a run recorded before it was kept. */
    userId: EffectSchema.optionalKey(EffectSchema.String),
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
  /** The task is gone, or no longer reachable by the account. */
  TASK_UNREACHABLE: "plan-unreachable",
  /** Its creator is no longer a member of its workspace, and a run starts as its creator. */
  CREATOR_LEFT: "creator-left",
  /** The task names no repository. */
  NO_REPOSITORY: "no-repository",
  /** The GitHub installation connected to the task's workspace no longer reaches the repository. */
  REPOSITORY_UNREACHABLE: "repository-unreachable",
  /** No longer produced, but still read: rows written before repositories came only from the workspace's installation hold it. */
  GITHUB_SIGN_IN: "github-sign-in",
  /** The model or effort named is no longer offered. */
  MODEL: "model",
  /** The coding agents' service could not be reached. */
  UNAVAILABLE: "unavailable",
  /** The task moved to another repository after this run's GitHub event was queued. */
  REPOSITORY_CHANGED: "repository-changed",
  /** The automation was paused after this run was queued and before it was acted on. */
  PAUSED: "paused",
  /** It waited queued past the hour it could still be started in, the sweep down or failing all that while. */
  MISSED: "missed",
  /** The agent the automation hands each run to is gone, archived, or no longer its creator's to reach. */
  AGENT_GONE: "agent-gone",
  /** A run on the same subject (one Sentry issue) started within the trigger's cooldown. */
  SAME_SUBJECT: "same-subject",
} as const;

export type AutomationRunReason =
  (typeof AUTOMATION_RUN_REASON)[keyof typeof AUTOMATION_RUN_REASON];

export const automationRunStatusSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_STATUS),
);
export const automationRunReasonSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_REASON),
);

/** The query an automation list may narrow by: one task's automations alone. */
export const AUTOMATION_LIST_QUERY = { TASK_ID: "planId", WORKSPACE_ID: "workspaceId" } as const;

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
      /** Whether it runs on the reading account's own keys; absent from a service before it. */
      ownKey: EffectSchema.optionalKey(EffectSchema.Boolean),
      /** Why it failed, where it did, as its own end line says; absent otherwise, and from a service before it. */
      failureReason: EffectSchema.optionalKey(
        EffectSchema.Literals(Object.values(CODING_AGENT_FAILURE)),
      ),
    }),
  ),
  firedAt: countedNumber,
  settledAt: EffectSchema.NullOr(countedNumber),
});

export type AutomationRunSummary = typeof automationRunSummarySchema.Type;

/**
 * One automation as the list shows it: the task it works on, whether it
 * runs and why not where the service paused it, what fires it and what it
 * starts, its guards, when a schedule is next due, and its newest run.
 */
export const automationSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** The task it was made on; null for an automation made on its workspace with no task, which its repositories stand in for. */
  planId: EffectSchema.NullOr(wireUuidSchema),
  planName: EffectSchema.NullOr(EffectSchema.String),
  /** The workspace it belongs to, whose members its scope lets reach it; absent from a service before it. */
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  name: EffectSchema.String,
  enabled: EffectSchema.Boolean,
  /**
   * Always null: nothing pauses an automation for its failures. The service
   * still sends it, because a desktop from before reads it as required, and
   * a desktop reads past it.
   */
  pausedReason: EffectSchema.optionalKey(EffectSchema.Null),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: EffectSchema.NullOr(countedNumber),
  lastRun: EffectSchema.NullOr(automationRunSummarySchema),
  createdAt: countedNumber,
  scope: EffectSchema.optionalKey(automationScopeSchema),
  repositories: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  /** Where a run lands; a same-agent target whose agent was deleted reads as no agent. */
  target: EffectSchema.optionalKey(
    EffectSchema.Union([
      automationTargetSchema,
      EffectSchema.Struct({
        kind: EffectSchema.Literal(AUTOMATION_TARGET.SAME_AGENT),
        agentId: EffectSchema.Null,
      }),
    ]),
  ),
  archiveSuccessful: EffectSchema.optionalKey(EffectSchema.Boolean),
  /**
   * The address a webhook trigger's caller posts to, as the client that read
   * the automation reaches the service; the service sends none, since the
   * one origin that holds is the caller's.
   */
  webhookUrl: EffectSchema.optionalKey(EffectSchema.String),
  /** Whether the account reading it created it, which a run starts as; absent from a service before it. */
  mine: EffectSchema.optionalKey(EffectSchema.Boolean),
  /** The account that created it, which its creator's page lists it under; absent from a service before it. */
  creatorId: EffectSchema.optionalKey(EffectSchema.String),
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

/** The repositories an automation's runs work in, `owner/name` each, the first where a run starts: at least one, and a handful at most. */
const automationRepositoriesSchema = EffectSchema.Array(githubRepositoryFullNameSchema).check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_REPOSITORIES),
);

/**
 * An automation to make (POST): where it stands, its name, trigger, and
 * action, and its guards or the defaults. It stands on a task, whose
 * workspace and repository it takes, or on a workspace with the
 * repositories its runs work in, which is how an automation is made with no
 * task; a request naming both, or neither, is refused.
 */
export const automationCreateRequestSchema = EffectSchema.Struct({
  planId: EffectSchema.optionalKey(wireUuidSchema),
  workspaceId: EffectSchema.optionalKey(EffectSchema.NonEmptyString),
  repositories: EffectSchema.optionalKey(automationRepositoriesSchema),
  name: nameSchema,
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: EffectSchema.optionalKey(automationGuardsSchema),
  scope: EffectSchema.optionalKey(automationScopeSchema),
  target: EffectSchema.optionalKey(automationTargetSchema),
  archiveSuccessful: EffectSchema.optionalKey(EffectSchema.Boolean),
});

/**
 * How a webhook trigger's caller is admitted and deduplicated: the secret as
 * the `Authorization: Bearer` value, never in the address; a retry carrying
 * the same `Idempotency-Key` header is the same run. A body larger than the
 * bound is refused, and one that is no UTF-8 text, or holds a NUL, too.
 */
export const AUTOMATION_WEBHOOK = {
  IDEMPOTENCY_HEADER: "idempotency-key",
  MAX_BODY_BYTES: 64 * 1024,
} as const;

/**
 * A change to an automation (PATCH): any of its fields, a field left out
 * standing as it was. `webhookSecretHash` replaces a webhook trigger's
 * secret with one the caller minted, by its SHA-256 in hex, so the caller
 * holds the secret before the one before stops admitting calls and the
 * service never sees it.
 */
export const automationChangeRequestSchema = EffectSchema.Struct({
  webhookSecretHash: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isPattern(/^[0-9a-f]{64}$/u)),
  ),
  name: EffectSchema.optionalKey(nameSchema),
  repositories: EffectSchema.optionalKey(automationRepositoriesSchema),
  enabled: EffectSchema.optionalKey(EffectSchema.Boolean),
  trigger: EffectSchema.optionalKey(automationTriggerSchema),
  action: EffectSchema.optionalKey(automationActionSchema),
  guards: EffectSchema.optionalKey(automationGuardsSchema),
  scope: EffectSchema.optionalKey(automationScopeSchema),
  target: EffectSchema.optionalKey(automationTargetSchema),
  archiveSuccessful: EffectSchema.optionalKey(EffectSchema.Boolean),
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
