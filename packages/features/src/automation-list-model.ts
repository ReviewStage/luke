import { agentFailureWords } from "./agent-failure-words.js";
import { AGENT_STATUS, type AgentStatus } from "./agent-wire.js";
import { SCHEDULE_PRESET } from "./automation-schedule.js";
import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationRunReason,
  type AutomationRunSummary,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTrigger,
  GITHUB_DEFAULT_SENDERS,
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  type GitHubSender,
  type GitHubTriggerEvent,
  PULL_REQUEST_DEFAULT_MOMENTS,
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
} from "./automation-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import { titlesNothing } from "./task-wire.js";
import { clockText } from "./time-format.js";
import { SENTRY_LEVEL, TRIGGER_CATALOG } from "./trigger-catalog.js";
import { andList, orList } from "./words.js";

const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

const RUN_REASON_WORDS = {
  [AUTOMATION_RUN_REASON.CONCURRENCY]: "Skipped: an earlier run's agent was still at work.",
  [AUTOMATION_RUN_REASON.DAILY_CAP]:
    "Skipped: it had already started as many runs today as it may.",
  [AUTOMATION_RUN_REASON.TASK_UNREACHABLE]:
    "Its task is gone, or no longer in one of your workspaces.",
  [AUTOMATION_RUN_REASON.CREATOR_LEFT]: "Its creator is no longer in the workspace.",
  [AUTOMATION_RUN_REASON.NO_REPOSITORY]: "It names no repository to work in.",
  [AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE]: `${PRODUCT_NAME} can no longer reach its repository on GitHub.`,
  [AUTOMATION_RUN_REASON.GITHUB_SIGN_IN]: "Its GitHub sign-in expired.",
  [AUTOMATION_RUN_REASON.MODEL]: "Its model is no longer offered. Choose another.",
  [AUTOMATION_RUN_REASON.CREDENTIAL_MISSING]: "Connect its model's provider in settings to run it.",
  [AUTOMATION_RUN_REASON.UNAVAILABLE]: "Agents could not be reached.",
  [AUTOMATION_RUN_REASON.REPOSITORY_CHANGED]:
    "It no longer works in the repository the event came from.",
  [AUTOMATION_RUN_REASON.PAUSED]: "It was turned off before the run could start.",
  [AUTOMATION_RUN_REASON.MISSED]: "It waited too long to start.",
  [AUTOMATION_RUN_REASON.AGENT_GONE]: "The agent its runs go to is gone or archived.",
  [AUTOMATION_RUN_REASON.SAME_SUBJECT]: "Skipped: already ran for this issue within its cooldown.",
  [AUTOMATION_RUN_REASON.AGENT_REPLACED]:
    "Started a fresh agent: the one its runs went to was gone or archived.",
} as const satisfies Record<AutomationRunReason, string>;

const GITHUB_EVENT_WORDS = {
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED]: { what: "a pull request", happens: "is opened" },
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED]: { what: "a pull request", happens: "is labeled" },
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED]: { what: "a pull request", happens: "is updated" },
  [GITHUB_TRIGGER_EVENT.ISSUE_OPENED]: { what: "an issue", happens: "is opened" },
  [GITHUB_TRIGGER_EVENT.ISSUE_LABELED]: { what: "an issue", happens: "is labeled" },
  [GITHUB_TRIGGER_EVENT.CHECK_FAILED]: { what: "a check", happens: "fails" },
  [GITHUB_TRIGGER_EVENT.PUSH]: { what: "commits", happens: "are pushed" },
} as const satisfies Record<GitHubTriggerEvent, { what: string; happens: string }>;

const GITHUB_SENDER_WORDS = {
  [GITHUB_SENDER.PEOPLE]: "people",
  [GITHUB_SENDER.APP_AGENTS]: `${PRODUCT_NAME}'s agents`,
  [GITHUB_SENDER.OTHER_BOTS]: "other bots",
} as const satisfies Record<GitHubSender, string>;

const PULL_REQUEST_MOMENT_WORDS = {
  [PULL_REQUEST_MOMENT.OPENED]: "opened",
  [PULL_REQUEST_MOMENT.READY]: "marked ready",
  [PULL_REQUEST_MOMENT.PUSHED]: "pushed to",
} as const satisfies Record<PullRequestMoment, string>;

const PULL_REQUEST_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
]);

const FIRING_WORDS = {
  [AUTOMATION_FIRING.SCHEDULE]: "Scheduled run",
  [AUTOMATION_FIRING.MANUAL]: "Run now",
  [AUTOMATION_FIRING.GITHUB]: "GitHub event",
  [AUTOMATION_FIRING.WEBHOOK]: "Webhook called",
  [AUTOMATION_FIRING.INTEGRATION]: "Integration event",
} as const satisfies Record<AutomationRunSummary["firing"]["kind"], string>;

const AGENT_OWNER = "its owner";

function agentLine(
  agent: NonNullable<AutomationRunSummary["agent"]>,
  keyHolder: string | undefined,
): string {
  const standing = AGENT_STATUS_WORDS[agent.status];
  const holder = agent.ownKey === undefined ? keyHolder : agent.ownKey ? undefined : AGENT_OWNER;
  const why =
    agent.failureReason === undefined ? undefined : agentFailureWords(agent.failureReason, holder);
  return agent.status === AGENT_STATUS.FAILED && why !== undefined
    ? `${standing}: ${why}`
    : standing;
}

export const AGENT_STATUS_WORDS = {
  [AGENT_STATUS.STARTING]: "Starting…",
  [AGENT_STATUS.RUNNING]: "Working",
  [AGENT_STATUS.COMPLETED]: "Finished",
  [AGENT_STATUS.FAILED]: "Failed",
  [AGENT_STATUS.CANCELED]: "Stopped",
} as const satisfies Record<AgentStatus, string>;

const OWNER_ORDER = [AUTOMATION_SCOPE.WORKSPACE, AUTOMATION_SCOPE.PERSONAL] as const;

export const AUTOMATION_RUN_STANDING = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type AutomationRunStanding =
  (typeof AUTOMATION_RUN_STANDING)[keyof typeof AUTOMATION_RUN_STANDING];

export const AUTOMATION_NEXT = {
  OFF: "off",
  EVENT: "event",
  UNSCHEDULED: "unscheduled",
  AT: "at",
} as const;

export type AutomationNext =
  | { readonly kind: typeof AUTOMATION_NEXT.OFF }
  | { readonly kind: typeof AUTOMATION_NEXT.EVENT }
  | { readonly kind: typeof AUTOMATION_NEXT.UNSCHEDULED }
  | { readonly kind: typeof AUTOMATION_NEXT.AT; readonly at: number };

export interface AutomationGroup {
  readonly owner: AutomationScope;
  readonly automations: readonly AutomationSummary[];
}

function cronNumber(field: string | undefined): number | undefined {
  return field !== undefined && /^\d+$/u.test(field) ? Number(field) : undefined;
}

function zoneCity(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replaceAll("_", " ");
}

const TYPED_CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/iu;

export function parseAutomationClock(
  text: string,
): { readonly hour: number; readonly minute: number } | undefined {
  const typed = TYPED_CLOCK.exec(text.trim());
  if (typed === null) return undefined;
  const [, hourDigits = "", minuteDigits = "0", half] = typed;
  const spoken = Number(hourDigits);
  const minute = Number(minuteDigits);
  if (minute > 59) return undefined;
  if (half === undefined) return spoken > 23 ? undefined : { hour: spoken, minute };
  if (spoken < 1 || spoken > 12) return undefined;
  return { hour: (spoken % 12) + (half.toLowerCase() === "p" ? 12 : 0), minute };
}

function scheduleText(cron: string, timezone: string): string {
  const spelled = cron.trim();
  const city = zoneCity(timezone);
  if (spelled === SCHEDULE_PRESET.HOURLY) return `Every hour · ${city}`;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = spelled.split(/\s+/u);
  const minute = cronNumber(minuteField);
  const hour = cronNumber(hourField);
  const daily = dayOfMonth === "*" && month === "*";
  if (minute === undefined || hour === undefined || !daily) return `${spelled} · ${city}`;
  const at = clockText(hour, minute);
  if (dayOfWeek === "*") return `Every day at ${at} · ${city}`;
  if (dayOfWeek === "1-5") return `Weekdays at ${at} · ${city}`;
  const day = cronNumber(dayOfWeek);
  const name = day === undefined ? undefined : WEEKDAY_NAMES[day % 7];
  return name === undefined ? `${spelled} · ${city}` : `${name} at ${at} · ${city}`;
}

export function automationOwner(automation: AutomationSummary): AutomationScope {
  return automation.scope ?? AUTOMATION_SCOPE.PERSONAL;
}

export function automationGroups(
  automations: readonly AutomationSummary[],
): readonly AutomationGroup[] {
  return OWNER_ORDER.map((owner) => ({
    owner,
    automations: automations.filter((automation) => automationOwner(automation) === owner),
  })).filter((group) => group.automations.length > 0);
}

export function automationTriggerText(
  trigger: AutomationTrigger,
  repositories: readonly string[] = [],
): string {
  switch (trigger.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return scheduleText(trigger.cron, trigger.timezone);
    case AUTOMATION_TRIGGER.GITHUB: {
      const words = GITHUB_EVENT_WORDS[trigger.event];
      const named = trigger.senders ?? GITHUB_DEFAULT_SENDERS;
      const senders = Object.values(GITHUB_SENDER).filter((sender) => named.includes(sender));
      const fires = trigger.moments ?? PULL_REQUEST_DEFAULT_MOMENTS;
      const moments = Object.values(PULL_REQUEST_MOMENT).filter((moment) => fires.includes(moment));
      const by =
        trigger.event === GITHUB_TRIGGER_EVENT.CHECK_FAILED
          ? ""
          : senders.length === Object.values(GITHUB_SENDER).length
            ? " by anyone"
            : ` by ${orList(senders.map((sender) => GITHUB_SENDER_WORDS[sender]))}`;
      const happens =
        trigger.event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED && moments.length > 0
          ? `is ${orList(moments.map((moment) => PULL_REQUEST_MOMENT_WORDS[moment]))}`
          : words.happens;
      const pullRequest = PULL_REQUEST_EVENTS.has(trigger.event);
      const included = [
        ...(pullRequest && trigger.drafts === true ? ["drafts"] : []),
        ...(pullRequest && trigger.forks === true ? ["forks"] : []),
      ];
      const also = included.length === 0 ? "" : `, ${andList(included)} included`;
      const where = repositories.length === 0 ? "" : ` in ${orList(repositories)}`;
      const labels = trigger.labels ?? [];
      const branches = trigger.branches ?? [];
      const labeled = labels.length === 0 ? "" : ` labeled ${orList(labels)}`;
      const on = branches.length === 0 ? "" : ` on ${orList(branches)}`;
      return `When ${words.what}${by} ${happens}${where}${labeled}${on}${also}`;
    }
    case AUTOMATION_TRIGGER.WEBHOOK:
      return "When its webhook is called";
    case AUTOMATION_TRIGGER.INTEGRATION: {
      const provider = TRIGGER_CATALOG[trigger.provider];
      const picked = trigger.filters?.level ?? [];
      const levels = Object.values(SENTRY_LEVEL).filter((level) => picked.includes(level));
      const kept = [trigger.filters?.project ?? [], trigger.filters?.environment ?? [], levels]
        .filter((values) => values.length > 0)
        .map((values) => ` · ${values.join(", ")}`);
      return `When ${provider.events[trigger.event].words} in ${provider.name}${kept.join("")}`;
    }
  }
}

export function automationRunStanding(run: AutomationRunSummary | null): AutomationRunStanding {
  if (run === null) return AUTOMATION_RUN_STANDING.REST;
  if (run.status === AUTOMATION_RUN_STATUS.FAILED) return AUTOMATION_RUN_STANDING.FAILED;
  switch (run.agent?.status) {
    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
      return AUTOMATION_RUN_STANDING.WORKING;
    case AGENT_STATUS.FAILED:
      return AUTOMATION_RUN_STANDING.FAILED;
    default:
      return AUTOMATION_RUN_STANDING.REST;
  }
}

export function automationNext(automation: AutomationSummary): AutomationNext {
  if (!automation.enabled) return { kind: AUTOMATION_NEXT.OFF };
  if (automation.trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE)
    return { kind: AUTOMATION_NEXT.EVENT };
  if (automation.nextRunAt === null) return { kind: AUTOMATION_NEXT.UNSCHEDULED };
  return { kind: AUTOMATION_NEXT.AT, at: automation.nextRunAt };
}

export function automationFiringTitle(firing: AutomationRunSummary["firing"]): string {
  if (firing.kind === AUTOMATION_FIRING.INTEGRATION) {
    return firing.subject.title ?? `${TRIGGER_CATALOG[firing.provider].name} event`;
  }
  if (firing.kind === AUTOMATION_FIRING.GITHUB && firing.title !== undefined) return firing.title;
  return FIRING_WORDS[firing.kind];
}

export function automationRunTitle(run: AutomationRunSummary): string {
  const title = run.agent?.title ?? null;
  if (title !== null && !titlesNothing(title)) return title;
  return automationFiringTitle(run.firing);
}

export interface AutomationRunPlace {
  readonly run: AutomationRunSummary;
  readonly at: number;
  readonly count: number;
  readonly newer: string | undefined;
  readonly older: string | undefined;
}

export function automationRunPlace(
  runs: readonly AutomationRunSummary[],
  agentId: string,
): AutomationRunPlace | undefined {
  const seen = new Set<string>();
  const steps = runs.filter((run) => {
    if (run.agent === null || seen.has(run.agent.id)) return false;
    seen.add(run.agent.id);
    return true;
  });
  const index = steps.findIndex((run) => run.agent?.id === agentId);
  const run = steps[index];
  if (run === undefined) return undefined;
  return {
    run,
    at: steps.length - index,
    count: steps.length,
    newer: steps[index - 1]?.agent?.id,
    older: steps[index + 1]?.agent?.id,
  };
}

export function automationRunLine(
  run: AutomationRunSummary,
  keyHolder?: string | undefined,
): string {
  if (run.status === AUTOMATION_RUN_STATUS.STARTED) {
    const standing = run.agent === null ? "Its agent is gone" : agentLine(run.agent, keyHolder);
    return run.reason === null ? standing : `${standing} · ${RUN_REASON_WORDS[run.reason]}`;
  }
  if (run.reason !== null) return RUN_REASON_WORDS[run.reason];
  switch (run.status) {
    case AUTOMATION_RUN_STATUS.QUEUED:
      return "Waiting to start";
    case AUTOMATION_RUN_STATUS.FAILED:
      return "Couldn't start";
    case AUTOMATION_RUN_STATUS.SKIPPED:
      return "Skipped";
  }
}
