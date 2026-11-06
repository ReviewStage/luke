import { Result } from "effect";
import {
  nextScheduledRun,
  readSchedule,
  SCHEDULE_REFUSAL,
  type ScheduleRefusal,
} from "./automation-schedule.js";
import type { AutomationChangeParams, AutomationCreateParams } from "./automation-view.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationAction,
  type AutomationGuards,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTarget,
  type AutomationTargetKind,
  type AutomationTrigger,
  type AutomationTriggerKind,
  GITHUB_DEFAULT_SENDERS,
  GITHUB_TRIGGER_EVENT,
  type GitHubSender,
  type GitHubTriggerEvent,
  type IntegrationTrigger,
  type IntegrationTriggerFilters,
  PULL_REQUEST_DEFAULT_MOMENTS,
  type PullRequestMoment,
} from "./automation-wire.js";
import type { ModelChoice } from "./models-wire.js";
import { formatCount } from "./number-format.js";
import { PRODUCT_NAME } from "./product-name.js";
import {
  SENTRY_TRIGGER_EVENT,
  type SentryTriggerEvent,
  TRIGGER_PROVIDER,
} from "./trigger-catalog.js";

export const SCHEDULE_KIND = {
  HOURLY: "hourly",
  DAILY: "daily",
  WEEKDAYS: "weekdays",
  WEEKLY: "weekly",
  CUSTOM: "custom",
} as const;

export type ScheduleKind = (typeof SCHEDULE_KIND)[keyof typeof SCHEDULE_KIND];

export const DRAFT_FIELD = {
  NAME: "name",
  SCHEDULE: "schedule",
  PROMPT: "prompt",
  REPOSITORY: "repository",
  FILTERS: "filters",
  COOLDOWN: "cooldown",
} as const;

type DraftField = (typeof DRAFT_FIELD)[keyof typeof DRAFT_FIELD];

export interface ScheduleDraft {
  readonly kind: ScheduleKind;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
  readonly cron: string;
}

export interface AutomationDraft {
  readonly name: string;
  readonly schedule: ScheduleDraft;
  readonly timezone: string;
  readonly prompt: string;
  readonly triggerKind: AutomationTriggerKind;
  readonly githubEvent: GitHubTriggerEvent;
  readonly githubFilters: {
    readonly labels?: readonly string[];
    readonly branches?: readonly string[];
  };
  readonly githubSettings: GitHubTriggerSettings;
  readonly integrationTrigger: IntegrationTrigger;
  readonly repository: string | null;
  readonly alsoRepositories: readonly string[];
  readonly owner: AutomationScope;
  readonly target: AutomationTargetKind;
  readonly agentId: string | null;
  readonly choice: ModelChoice | null;
  readonly archiveSuccessful: boolean;
  readonly slackDelivery: boolean;
  readonly disabledServers: readonly string[];
  readonly guards: AutomationGuards | null;
  readonly subjectCooldownHours: number | undefined;
}

export interface GitHubTriggerSettings {
  readonly senders: readonly GitHubSender[];
  readonly moments: readonly PullRequestMoment[];
  readonly drafts: boolean;
  readonly forks: boolean;
}

const GITHUB_DEFAULT_SETTINGS: GitHubTriggerSettings = {
  senders: GITHUB_DEFAULT_SENDERS,
  moments: PULL_REQUEST_DEFAULT_MOMENTS,
  drafts: false,
  forks: false,
};

const NEW_INTEGRATION_TRIGGER: IntegrationTrigger = {
  kind: AUTOMATION_TRIGGER.INTEGRATION,
  provider: TRIGGER_PROVIDER.SENTRY,
  event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
};

export interface DraftDefaults {
  readonly timezone: string;
  readonly owner: AutomationScope;
}

type ChangeDraft = {
  -readonly [Key in keyof AutomationChangeParams["change"]]: AutomationChangeParams["change"][Key];
};

export type DraftProblems = { readonly [Field in DraftField]?: string };

const NEW_SCHEDULE: ScheduleDraft = {
  kind: SCHEDULE_KIND.WEEKDAYS,
  hour: 9,
  minute: 0,
  weekday: 1,
  cron: "0 9 * * 1-5",
};

const SCHEDULE_REFUSAL_WORDS = {
  [SCHEDULE_REFUSAL.CRON]: `That isn't a schedule ${PRODUCT_NAME} can read.`,
  [SCHEDULE_REFUSAL.TIMEZONE]: "Pick a time zone.",
  [SCHEDULE_REFUSAL.TOO_FREQUENT]: "It can run at most every 15 minutes.",
} as const satisfies Record<ScheduleRefusal, string>;

function cronNumber(field: string | undefined, most: number): number | undefined {
  if (field === undefined || !/^\d+$/u.test(field)) return undefined;
  const value = Number(field);
  return value <= most ? value : undefined;
}

export function draftRepositories(draft: AutomationDraft): readonly string[] {
  if (draft.repository === null) return [];
  const first = draft.repository;
  return [first, ...draft.alsoRepositories.filter((repository) => repository !== first)];
}

function sameChoice(one: ModelChoice | null, other: ModelChoice | null): boolean {
  if (one === null || other === null) return one === other;
  return (
    one.model === other.model &&
    one.effort === other.effort &&
    one.contextWindow === other.contextWindow
  );
}

function landingAgent(draft: AutomationDraft): string | null {
  return draft.target === AUTOMATION_TARGET.SAME_AGENT ? draft.agentId : null;
}

function actionOf(draft: AutomationDraft): AutomationAction {
  return {
    kind: AUTOMATION_ACTION.AGENT,
    prompt: draft.prompt.trim(),
    ...(draft.choice === null ? undefined : { choice: draft.choice }),
    ...(draft.disabledServers.length === 0
      ? undefined
      : { disabledServers: draft.disabledServers }),
  };
}

function targetOf(draft: AutomationDraft): AutomationTarget {
  return draft.target === AUTOMATION_TARGET.SAME_AGENT
    ? { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: draft.agentId }
    : { kind: AUTOMATION_TARGET.NEW_AGENT };
}

function githubSettingsOf(
  trigger: Extract<AutomationTrigger, { kind: typeof AUTOMATION_TRIGGER.GITHUB }>,
): GitHubTriggerSettings {
  return {
    senders: trigger.senders ?? GITHUB_DEFAULT_SETTINGS.senders,
    moments: trigger.moments ?? GITHUB_DEFAULT_SETTINGS.moments,
    drafts: trigger.drafts ?? GITHUB_DEFAULT_SETTINGS.drafts,
    forks: trigger.forks ?? GITHUB_DEFAULT_SETTINGS.forks,
  };
}

function sameSet(one: readonly string[] = [], other: readonly string[] = []): boolean {
  return one.length === other.length && one.every((each) => other.includes(each));
}

function sameFilters(
  one: AutomationDraft["githubFilters"],
  other: AutomationDraft["githubFilters"],
) {
  return sameSet(one.labels, other.labels) && sameSet(one.branches, other.branches);
}

function sameSettings(one: GitHubTriggerSettings, other: GitHubTriggerSettings): boolean {
  return (
    sameSet(one.senders, other.senders) &&
    sameSet(one.moments, other.moments) &&
    one.drafts === other.drafts &&
    one.forks === other.forks
  );
}

function sameIntegrationTrigger(one: IntegrationTrigger, other: IntegrationTrigger): boolean {
  return (
    one.provider === other.provider &&
    one.event === other.event &&
    sameSet(one.filters?.project, other.filters?.project) &&
    sameSet(one.filters?.environment, other.filters?.environment) &&
    sameSet(one.filters?.level, other.filters?.level)
  );
}

function cooldownAdmitted(hours: number | undefined): hours is number {
  return (
    hours !== undefined &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS
  );
}

function cooldownOf(guards: AutomationGuards | null): number {
  return guards?.subjectCooldownHours ?? AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS;
}

function guardsOf(draft: AutomationDraft): AutomationGuards | null {
  if (draft.triggerKind !== AUTOMATION_TRIGGER.INTEGRATION) return draft.guards;
  if (!cooldownAdmitted(draft.subjectCooldownHours)) return draft.guards;
  return {
    ...(draft.guards ?? AUTOMATION_DEFAULT_GUARDS),
    subjectCooldownHours: draft.subjectCooldownHours,
  };
}

export function filterAdmitted(values: readonly string[] = []): boolean {
  return (
    values.length <= AUTOMATION_BOUNDS.MAX_FILTER_VALUES &&
    values.every((value) => value.length <= AUTOMATION_BOUNDS.MAX_FILTER_VALUE_CHARS)
  );
}

function filtersAdmitted(filters: IntegrationTriggerFilters | undefined): boolean {
  return [filters?.project, filters?.environment, filters?.level].every(filterAdmitted);
}

export function draftTrigger(draft: AutomationDraft): AutomationTrigger {
  switch (draft.triggerKind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return {
        kind: AUTOMATION_TRIGGER.SCHEDULE,
        cron: cronOf(draft.schedule),
        timezone: draft.timezone,
      };
    case AUTOMATION_TRIGGER.GITHUB: {
      const { senders, moments, drafts, forks } = draft.githubSettings;
      const updated = draft.githubEvent === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED;
      return {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: draft.githubEvent,
        ...draft.githubFilters,
        senders,
        ...(updated ? { moments } : undefined),
        drafts,
        forks,
      };
    }
    case AUTOMATION_TRIGGER.WEBHOOK:
      return { kind: AUTOMATION_TRIGGER.WEBHOOK };
    case AUTOMATION_TRIGGER.INTEGRATION:
      return draft.integrationTrigger;
  }
}

function textProblem(text: string, most: number, empty: string, long: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return empty;
  return trimmed.length > most ? long : undefined;
}

export function scheduleDraftOf(cron: string): ScheduleDraft {
  const spelled = cron.trim();
  const custom = { ...NEW_SCHEDULE, kind: SCHEDULE_KIND.CUSTOM, cron: spelled };
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek, ...rest] = spelled.split(/\s+/u);
  const minute = cronNumber(minuteField, 59);
  if (rest.length > 0 || minute === undefined || dayOfMonth !== "*" || month !== "*") return custom;
  if (hourField === "*" && dayOfWeek === "*") {
    return { ...NEW_SCHEDULE, kind: SCHEDULE_KIND.HOURLY, minute, cron: spelled };
  }
  const hour = cronNumber(hourField, 23);
  if (hour === undefined) return custom;
  const at = { ...NEW_SCHEDULE, hour, minute, cron: spelled };
  if (dayOfWeek === "*") return { ...at, kind: SCHEDULE_KIND.DAILY };
  if (dayOfWeek === "1-5") return { ...at, kind: SCHEDULE_KIND.WEEKDAYS };
  const weekday = cronNumber(dayOfWeek, 7);
  return weekday === undefined
    ? custom
    : { ...at, kind: SCHEDULE_KIND.WEEKLY, weekday: weekday % 7 };
}

export function cronOf(schedule: ScheduleDraft): string {
  const { minute, hour } = schedule;
  switch (schedule.kind) {
    case SCHEDULE_KIND.HOURLY:
      return `${minute} * * * *`;
    case SCHEDULE_KIND.DAILY:
      return `${minute} ${hour} * * *`;
    case SCHEDULE_KIND.WEEKDAYS:
      return `${minute} ${hour} * * 1-5`;
    case SCHEDULE_KIND.WEEKLY:
      return `${minute} ${hour} * * ${schedule.weekday}`;
    case SCHEDULE_KIND.CUSTOM:
      return schedule.cron.trim();
  }
}

export function automationDraft(
  automation: AutomationSummary | undefined,
  defaults: DraftDefaults,
): AutomationDraft {
  if (automation === undefined) {
    return {
      name: "",
      schedule: NEW_SCHEDULE,
      timezone: defaults.timezone,
      prompt: "",
      triggerKind: AUTOMATION_TRIGGER.SCHEDULE,
      githubEvent: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
      githubFilters: {},
      githubSettings: GITHUB_DEFAULT_SETTINGS,
      integrationTrigger: NEW_INTEGRATION_TRIGGER,
      repository: null,
      alsoRepositories: [],
      owner: defaults.owner,
      target: AUTOMATION_TARGET.NEW_AGENT,
      agentId: null,
      choice: null,
      archiveSuccessful: false,
      slackDelivery: false,
      disabledServers: [],
      guards: null,
      subjectCooldownHours: AUTOMATION_DEFAULT_SUBJECT_COOLDOWN_HOURS,
    };
  }
  const { trigger } = automation;
  const scheduled = trigger.kind === AUTOMATION_TRIGGER.SCHEDULE;
  const github = trigger.kind === AUTOMATION_TRIGGER.GITHUB;
  return {
    name: automation.name,
    schedule: scheduled ? scheduleDraftOf(trigger.cron) : NEW_SCHEDULE,
    timezone: scheduled ? trigger.timezone : defaults.timezone,
    prompt: automation.action.prompt,
    triggerKind: trigger.kind,
    githubEvent: github ? trigger.event : GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
    githubFilters: github
      ? {
          ...(trigger.labels === undefined ? undefined : { labels: trigger.labels }),
          ...(trigger.branches === undefined ? undefined : { branches: trigger.branches }),
        }
      : {},
    githubSettings: github ? githubSettingsOf(trigger) : GITHUB_DEFAULT_SETTINGS,
    integrationTrigger:
      trigger.kind === AUTOMATION_TRIGGER.INTEGRATION ? trigger : NEW_INTEGRATION_TRIGGER,
    repository: automation.repositories?.[0] ?? null,
    alsoRepositories: automation.repositories?.slice(1) ?? [],
    owner: automation.scope ?? AUTOMATION_SCOPE.PERSONAL,
    target: automation.target?.kind ?? AUTOMATION_TARGET.NEW_AGENT,
    agentId:
      automation.target?.kind === AUTOMATION_TARGET.SAME_AGENT ? automation.target.agentId : null,
    choice: automation.action.choice ?? null,
    archiveSuccessful: automation.archiveSuccessful ?? false,
    slackDelivery: automation.slackDelivery ?? false,
    disabledServers: automation.action.disabledServers ?? [],
    guards: automation.guards,
    subjectCooldownHours: cooldownOf(automation.guards),
  };
}

export function repositoryHeld(automation: AutomationSummary | undefined): boolean {
  return automation !== undefined && automation.planId !== null;
}

export function draftProblems(draft: AutomationDraft, held: boolean, now: Date): DraftProblems {
  const name = textProblem(
    draft.name,
    AUTOMATION_BOUNDS.MAX_NAME_CHARS,
    "Name the automation.",
    `Keep the name under ${AUTOMATION_BOUNDS.MAX_NAME_CHARS} characters.`,
  );
  const prompt = textProblem(
    draft.prompt,
    AUTOMATION_BOUNDS.MAX_PROMPT_CHARS,
    "Tell the agent what to do.",
    `Keep the prompt under ${formatCount(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS)} characters.`,
  );
  const read = readSchedule({ cron: cronOf(draft.schedule), timezone: draft.timezone }, now);
  const schedule =
    draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE && Result.isFailure(read)
      ? SCHEDULE_REFUSAL_WORDS[read.failure]
      : draft.triggerKind === AUTOMATION_TRIGGER.GITHUB
        ? githubSettingsProblem(draft)
        : undefined;
  const integration = draft.triggerKind === AUTOMATION_TRIGGER.INTEGRATION;
  const filters =
    integration && !filtersAdmitted(draft.integrationTrigger.filters)
      ? `Keep each filter to ${AUTOMATION_BOUNDS.MAX_FILTER_VALUES} values of up to ${AUTOMATION_BOUNDS.MAX_FILTER_VALUE_CHARS} characters.`
      : undefined;
  const cooldown =
    integration && !cooldownAdmitted(draft.subjectCooldownHours)
      ? `Wait a whole number of hours, from 1 to ${AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS}.`
      : undefined;
  const repository =
    !held && draft.repository === null && draft.triggerKind === AUTOMATION_TRIGGER.GITHUB
      ? "Choose the repository whose events start it."
      : undefined;
  const problems: { [Field in DraftField]?: string } = {};
  if (name !== undefined) problems[DRAFT_FIELD.NAME] = name;
  if (schedule !== undefined) problems[DRAFT_FIELD.SCHEDULE] = schedule;
  if (prompt !== undefined) problems[DRAFT_FIELD.PROMPT] = prompt;
  if (repository !== undefined) problems[DRAFT_FIELD.REPOSITORY] = repository;
  if (filters !== undefined) problems[DRAFT_FIELD.FILTERS] = filters;
  if (cooldown !== undefined) problems[DRAFT_FIELD.COOLDOWN] = cooldown;
  return problems;
}

function githubSettingsProblem(draft: AutomationDraft): string | undefined {
  const { senders, moments } = draft.githubSettings;
  if (draft.githubEvent !== GITHUB_TRIGGER_EVENT.CHECK_FAILED && senders.length === 0) {
    return "Choose whose events start it.";
  }
  if (draft.githubEvent === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED && moments.length === 0) {
    return "Choose when it starts.";
  }
  return undefined;
}

export function draftNextRuns(draft: AutomationDraft, now: Date, count: number): readonly number[] {
  if (draft.triggerKind !== AUTOMATION_TRIGGER.SCHEDULE) return [];
  const schedule = { cron: cronOf(draft.schedule), timezone: draft.timezone };
  const runs: number[] = [];
  let after = now;
  while (runs.length < count) {
    const next = nextScheduledRun(schedule, after);
    if (next === undefined) break;
    runs.push(next.getTime());
    after = next;
  }
  return runs;
}

export function createRequestOf(
  draft: AutomationDraft,
  workspaceId: string,
): AutomationCreateParams {
  const guards = guardsOf(draft);
  const made = {
    workspaceId,
    name: draft.name.trim(),
    trigger: draftTrigger(draft),
    action: actionOf(draft),
    scope: draft.owner,
    target: targetOf(draft),
    archiveSuccessful: draft.archiveSuccessful,
    slackDelivery: draft.slackDelivery,
    ...(guards === null ? undefined : { guards }),
  } as const;
  return { ...made, repositories: draftRepositories(draft) };
}

export function sameDraft(one: AutomationDraft, other: AutomationDraft): boolean {
  return (
    one.name.trim() === other.name.trim() &&
    one.prompt.trim() === other.prompt.trim() &&
    one.triggerKind === other.triggerKind &&
    (one.triggerKind !== AUTOMATION_TRIGGER.GITHUB ||
      (one.githubEvent === other.githubEvent &&
        sameFilters(one.githubFilters, other.githubFilters) &&
        sameSettings(one.githubSettings, other.githubSettings))) &&
    (one.triggerKind !== AUTOMATION_TRIGGER.INTEGRATION ||
      (sameIntegrationTrigger(one.integrationTrigger, other.integrationTrigger) &&
        one.subjectCooldownHours === other.subjectCooldownHours)) &&
    (one.guards === null ||
      other.guards === null ||
      (one.guards.maxConcurrentRuns === other.guards.maxConcurrentRuns &&
        one.guards.dailyRunCap === other.guards.dailyRunCap &&
        one.guards.subjectCooldownHours === other.guards.subjectCooldownHours)) &&
    cronOf(one.schedule) === cronOf(other.schedule) &&
    one.timezone === other.timezone &&
    one.repository === other.repository &&
    one.owner === other.owner &&
    one.target === other.target &&
    landingAgent(one) === landingAgent(other) &&
    sameChoice(one.choice, other.choice) &&
    sameSet(one.disabledServers, other.disabledServers) &&
    one.archiveSuccessful === other.archiveSuccessful &&
    one.slackDelivery === other.slackDelivery
  );
}

export function changeOf(
  draft: AutomationDraft,
  automation: AutomationSummary,
  defaults: DraftDefaults,
): AutomationChangeParams["change"] | undefined {
  const was = automationDraft(automation, defaults);
  const scheduleMoved =
    draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE &&
    (cronOf(draft.schedule) !== cronOf(was.schedule) || draft.timezone !== was.timezone);
  const eventMoved =
    draft.triggerKind === AUTOMATION_TRIGGER.GITHUB &&
    (draft.githubEvent !== was.githubEvent ||
      !sameFilters(draft.githubFilters, was.githubFilters) ||
      !sameSettings(draft.githubSettings, was.githubSettings));
  const integrationMoved =
    draft.triggerKind === AUTOMATION_TRIGGER.INTEGRATION &&
    !sameIntegrationTrigger(draft.integrationTrigger, was.integrationTrigger);
  const triggerMoved =
    draft.triggerKind !== was.triggerKind || scheduleMoved || eventMoved || integrationMoved;
  const cooldownMoved =
    draft.triggerKind === AUTOMATION_TRIGGER.INTEGRATION &&
    cooldownAdmitted(draft.subjectCooldownHours) &&
    draft.subjectCooldownHours !== was.subjectCooldownHours;
  const actionMoved =
    draft.prompt.trim() !== was.prompt ||
    !sameChoice(draft.choice, was.choice) ||
    !sameSet(draft.disabledServers, was.disabledServers);
  const targetMoved = draft.target !== was.target || landingAgent(draft) !== landingAgent(was);
  const repositoryMoved = automation.planId === null && draft.repository !== was.repository;
  const change: ChangeDraft = {};
  if (draft.name.trim() !== was.name) change.name = draft.name.trim();
  if (triggerMoved) change.trigger = draftTrigger(draft);
  if (cooldownMoved) {
    change.guards = { ...automation.guards, subjectCooldownHours: draft.subjectCooldownHours };
  }
  if (actionMoved) change.action = { ...actionOf(draft), disabledServers: draft.disabledServers };
  if (targetMoved) change.target = targetOf(draft);
  if (draft.archiveSuccessful !== was.archiveSuccessful) {
    change.archiveSuccessful = draft.archiveSuccessful;
  }
  if (draft.slackDelivery !== was.slackDelivery) change.slackDelivery = draft.slackDelivery;
  if (repositoryMoved) change.repositories = draftRepositories(draft);
  if (draft.owner !== was.owner) change.scope = draft.owner;
  return Object.keys(change).length === 0 ? undefined : change;
}

export function withGithubEvent(
  draft: AutomationDraft,
  event: GitHubTriggerEvent,
): AutomationDraft {
  if (event === draft.githubEvent) return draft;
  return { ...draft, githubEvent: event, githubFilters: {} };
}

export function withIntegrationEvent(
  draft: AutomationDraft,
  event: SentryTriggerEvent,
): AutomationDraft {
  return { ...draft, integrationTrigger: { ...draft.integrationTrigger, event } };
}

export function withIntegrationFilters(
  draft: AutomationDraft,
  filters: IntegrationTriggerFilters,
): AutomationDraft {
  const { filters: had, ...trigger } = draft.integrationTrigger;
  const merged = { ...had, ...filters };
  const kept: {
    -readonly [Key in keyof IntegrationTriggerFilters]: IntegrationTriggerFilters[Key];
  } = {};
  if (merged.project !== undefined && merged.project.length > 0) kept.project = merged.project;
  if (merged.environment !== undefined && merged.environment.length > 0) {
    kept.environment = merged.environment;
  }
  if (merged.level !== undefined && merged.level.length > 0) kept.level = merged.level;
  const integrationTrigger =
    Object.keys(kept).length === 0 ? trigger : { ...trigger, filters: kept };
  return { ...draft, integrationTrigger };
}

export function filterValuesOf(text: string): readonly string[] {
  const values = text.split(",").map((value) => value.trim());
  return values.filter((value, at) => value !== "" && values.indexOf(value) === at);
}

export function withRepository(draft: AutomationDraft, repository: string | null): AutomationDraft {
  if (repository === draft.repository) return draft;
  return { ...draft, repository, agentId: null };
}
