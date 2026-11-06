import { literalsReadingLegacy } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { AGENT_FAILURE, AGENT_STATUS, disabledServersSchema } from "./agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { modelChoiceSchema } from "./models-wire.js";
import { chosenIdSchema, countedNumber, wireUuidSchema } from "./service-wire.js";
import { SENTRY_LEVEL, SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "./trigger-catalog.js";

export const AUTOMATION_BOUNDS = {
  MAX_NAME_CHARS: 80,
  MAX_PROMPT_CHARS: 12_000,
  MAX_CRON_CHARS: 120,
  MAX_TIMEZONE_CHARS: 64,
  MAX_FILTER_VALUES: 10,
  MAX_FILTER_VALUE_CHARS: 100,
  MAX_REPOSITORIES: 10,
  MAX_CONCURRENT_RUNS: 5,
  MAX_DAILY_RUNS: 50,
  MAX_KEY_CHARS: 128,
  MAX_RUNS_READ: 100,
  MAX_SUBJECT_COOLDOWN_HOURS: 168,
} as const;

export const AUTOMATION_TRIGGER = {
  SCHEDULE: "schedule",
  GITHUB: "github",
  WEBHOOK: "webhook",
  INTEGRATION: "integration",
} as const;

export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER)[keyof typeof AUTOMATION_TRIGGER];

export const GITHUB_TRIGGER_EVENT = {
  PULL_REQUEST_OPENED: "pull-request-opened",
  PULL_REQUEST_LABELED: "pull-request-labeled",
  PULL_REQUEST_UPDATED: "pull-request-updated",
  ISSUE_OPENED: "issue-opened",
  ISSUE_LABELED: "issue-labeled",
  CHECK_FAILED: "check-failed",
  PUSH: "push",
} as const;

export type GitHubTriggerEvent = (typeof GITHUB_TRIGGER_EVENT)[keyof typeof GITHUB_TRIGGER_EVENT];

export const AUTOMATION_ACTION = {
  AGENT: "agent",
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

export const scheduleTriggerSchema = EffectSchema.Struct({
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

export const GITHUB_SENDER = {
  PEOPLE: "people",
  APP_AGENTS: "app-agents",
  OTHER_BOTS: "other-bots",
} as const;

export type GitHubSender = (typeof GITHUB_SENDER)[keyof typeof GITHUB_SENDER];

export const PULL_REQUEST_MOMENT = {
  OPENED: "opened",
  READY: "ready",
  PUSHED: "pushed",
} as const;

export type PullRequestMoment = (typeof PULL_REQUEST_MOMENT)[keyof typeof PULL_REQUEST_MOMENT];

export const GITHUB_DEFAULT_SENDERS: readonly GitHubSender[] = [GITHUB_SENDER.PEOPLE];

export const PULL_REQUEST_DEFAULT_MOMENTS: readonly PullRequestMoment[] =
  Object.values(PULL_REQUEST_MOMENT);

export const githubTriggerSchema = EffectSchema.Struct({
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

const webhookTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.WEBHOOK),
});

const sentryTriggerFiltersSchema = EffectSchema.Struct({
  project: EffectSchema.optionalKey(filterValuesSchema),
  environment: EffectSchema.optionalKey(filterValuesSchema),
  level: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.Literals(Object.values(SENTRY_LEVEL))).check(
      EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_FILTER_VALUES),
    ),
  ),
});

export const sentryTriggerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_TRIGGER.INTEGRATION),
  provider: EffectSchema.Literal(TRIGGER_PROVIDER.SENTRY),
  event: EffectSchema.Literals(Object.values(SENTRY_TRIGGER_EVENT)),
  filters: EffectSchema.optionalKey(sentryTriggerFiltersSchema),
});

const LEGACY_APP_AGENTS = "luke-agents";

const storedGithubTriggerSchema = EffectSchema.Struct({
  ...githubTriggerSchema.fields,
  senders: EffectSchema.optionalKey(
    EffectSchema.Array(
      literalsReadingLegacy(
        Object.values(GITHUB_SENDER),
        LEGACY_APP_AGENTS,
        GITHUB_SENDER.APP_AGENTS,
      ),
    ),
  ),
});

export const automationTriggerSchema = EffectSchema.Union([
  scheduleTriggerSchema,
  storedGithubTriggerSchema,
  webhookTriggerSchema,
  sentryTriggerSchema,
]);

export type AutomationTrigger = typeof automationTriggerSchema.Type;

export type IntegrationTrigger = Extract<
  AutomationTrigger,
  { kind: typeof AUTOMATION_TRIGGER.INTEGRATION }
>;

export type IntegrationTriggerFilters = NonNullable<IntegrationTrigger["filters"]>;

const agentActionSchema = EffectSchema.Struct({
  kind: EffectSchema.Literal(AUTOMATION_ACTION.AGENT),
  prompt: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS),
  ),
  choice: EffectSchema.optionalKey(modelChoiceSchema),
  disabledServers: EffectSchema.optionalKey(disabledServersSchema),
});

export const automationActionSchema = agentActionSchema;

export type AutomationAction = typeof automationActionSchema.Type;

export type AutomationActionJson = typeof automationActionSchema.Encoded;

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

export const AUTOMATION_DEFAULT_GUARDS: AutomationGuards = {
  maxConcurrentRuns: 1,
  dailyRunCap: 10,
};

export const AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS = 24;

export const AUTOMATION_SCOPE = {
  PERSONAL: "personal",
  WORKSPACE: "workspace",
} as const;

export type AutomationScope = (typeof AUTOMATION_SCOPE)[keyof typeof AUTOMATION_SCOPE];

export const automationScopeSchema = EffectSchema.Literals(Object.values(AUTOMATION_SCOPE));

export const AUTOMATION_TARGET = {
  NEW_AGENT: "new-agent",
  SAME_AGENT: "same-agent",
} as const;

export type AutomationTargetKind = (typeof AUTOMATION_TARGET)[keyof typeof AUTOMATION_TARGET];

export const automationTargetKindSchema = EffectSchema.Literals(Object.values(AUTOMATION_TARGET));

const automationTargetSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(AUTOMATION_TARGET.NEW_AGENT) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_TARGET.SAME_AGENT),
    agentId: EffectSchema.NullOr(wireUuidSchema),
  }),
]);

export type AutomationTarget = typeof automationTargetSchema.Type;

export const AUTOMATION_FIRING = {
  ...AUTOMATION_TRIGGER,
  MANUAL: "manual",
} as const;

export const automationFiringSchema = EffectSchema.Union([
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.SCHEDULE),
    dueAt: EffectSchema.Number,
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.GITHUB),
    event: EffectSchema.Literals(Object.values(GITHUB_TRIGGER_EVENT)),
    repository: EffectSchema.String,
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
    subject: EffectSchema.Struct({
      id: EffectSchema.String,
      title: EffectSchema.optionalKey(EffectSchema.String),
      url: EffectSchema.optionalKey(EffectSchema.String),
    }),
  }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(AUTOMATION_FIRING.MANUAL),
    userId: EffectSchema.optionalKey(EffectSchema.String),
  }),
]);

export type AutomationFiring = typeof automationFiringSchema.Type;

export type AutomationFiringKind = (typeof AUTOMATION_FIRING)[keyof typeof AUTOMATION_FIRING];

export const FIRING_HANDS_OUTSIDE_WORDS = {
  [AUTOMATION_FIRING.SCHEDULE]: false,
  [AUTOMATION_FIRING.GITHUB]: true,
  [AUTOMATION_FIRING.WEBHOOK]: true,
  [AUTOMATION_FIRING.INTEGRATION]: true,
  [AUTOMATION_FIRING.MANUAL]: false,
} as const satisfies Record<AutomationFiringKind, boolean>;

export const AUTOMATION_RUN_STATUS = {
  QUEUED: "queued",
  STARTED: "started",
  SKIPPED: "skipped",
  FAILED: "failed",
} as const;

export type AutomationRunStatus =
  (typeof AUTOMATION_RUN_STATUS)[keyof typeof AUTOMATION_RUN_STATUS];

export const AUTOMATION_RUN_REASON = {
  CONCURRENCY: "concurrency",
  DAILY_CAP: "daily-cap",
  TASK_UNREACHABLE: "plan-unreachable",
  CREATOR_LEFT: "creator-left",
  NO_REPOSITORY: "no-repository",
  REPOSITORY_UNREACHABLE: "repository-unreachable",
  GITHUB_SIGN_IN: "github-sign-in",
  MODEL: "model",
  CREDENTIAL_MISSING: "credential-missing",
  UNAVAILABLE: "unavailable",
  REPOSITORY_CHANGED: "repository-changed",
  PAUSED: "paused",
  MISSED: "missed",
  AGENT_GONE: "agent-gone",
  SAME_SUBJECT: "same-subject",
  AGENT_REPLACED: "agent-replaced",
} as const;

export type AutomationRunReason =
  (typeof AUTOMATION_RUN_REASON)[keyof typeof AUTOMATION_RUN_REASON];

export const automationRunStatusSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_STATUS),
);
export const automationRunReasonSchema = EffectSchema.Literals(
  Object.values(AUTOMATION_RUN_REASON),
);

export const AUTOMATION_LIST_QUERY = { TASK_ID: "planId", WORKSPACE_ID: "workspaceId" } as const;

const automationRunSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  firing: automationFiringSchema,
  status: automationRunStatusSchema,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  agent: EffectSchema.NullOr(
    EffectSchema.Struct({
      id: wireUuidSchema,
      title: EffectSchema.NullOr(EffectSchema.String),
      status: EffectSchema.Literals(Object.values(AGENT_STATUS)),
      ownKey: EffectSchema.optionalKey(EffectSchema.Boolean),
      failureReason: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(AGENT_FAILURE))),
    }),
  ),
  firedAt: countedNumber,
  settledAt: EffectSchema.NullOr(countedNumber),
});

export type AutomationRunSummary = typeof automationRunSummarySchema.Type;

export const automationSummarySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: EffectSchema.NullOr(wireUuidSchema),
  planName: EffectSchema.NullOr(EffectSchema.String),
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  name: EffectSchema.String,
  enabled: EffectSchema.Boolean,
  pausedReason: EffectSchema.optionalKey(EffectSchema.Null),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  guards: automationGuardsSchema,
  nextRunAt: EffectSchema.NullOr(countedNumber),
  lastRun: EffectSchema.NullOr(automationRunSummarySchema),
  createdAt: countedNumber,
  scope: EffectSchema.optionalKey(automationScopeSchema),
  repositories: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  target: EffectSchema.optionalKey(automationTargetSchema),
  archiveSuccessful: EffectSchema.optionalKey(EffectSchema.Boolean),
  slackDelivery: EffectSchema.optionalKey(EffectSchema.Boolean),
  webhookUrl: EffectSchema.optionalKey(EffectSchema.String),
  mine: EffectSchema.optionalKey(EffectSchema.Boolean),
  creatorId: EffectSchema.optionalKey(EffectSchema.String),
});

export type AutomationSummary = typeof automationSummarySchema.Type;

export const automationListAnswerSchema = EffectSchema.Struct({
  automations: EffectSchema.Array(automationSummarySchema),
});

const automationTxidSchema = EffectSchema.String.check(EffectSchema.isPattern(/^[0-9]+$/u));

export const automationAnswerSchema = EffectSchema.Struct({
  automation: automationSummarySchema,
  webhookSecret: EffectSchema.optionalKey(EffectSchema.String),
  txid: EffectSchema.optionalKey(automationTxidSchema),
});

export const automationDeletedAnswerSchema = EffectSchema.Struct({
  txid: EffectSchema.optionalKey(automationTxidSchema),
});

const automationRepositoriesSchema = EffectSchema.Array(githubRepositoryFullNameSchema).check(
  EffectSchema.isMaxLength(AUTOMATION_BOUNDS.MAX_REPOSITORIES),
);

export const automationCreateRequestSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
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
  slackDelivery: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export const AUTOMATION_WEBHOOK = {
  IDEMPOTENCY_HEADER: "idempotency-key",
  MAX_BODY_BYTES: 64 * 1024,
} as const;

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
  slackDelivery: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export const automationRunRequestSchema = EffectSchema.Struct({
  idempotencyKey: wireUuidSchema,
});

export const automationRunAnswerSchema = EffectSchema.Struct({
  run: automationRunSummarySchema,
  txid: EffectSchema.optionalKey(automationTxidSchema),
});

export const automationRunsAnswerSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(automationRunSummarySchema),
});

export const automationWorkspaceRunSchema = EffectSchema.Struct({
  ...automationRunSummarySchema.fields,
  automation: EffectSchema.Struct({ id: wireUuidSchema, name: EffectSchema.String }),
});

export type AutomationWorkspaceRun = typeof automationWorkspaceRunSchema.Type;

export const automationWorkspaceRunsAnswerSchema = EffectSchema.Struct({
  runs: EffectSchema.Array(automationWorkspaceRunSchema),
});
