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
import { agentFailureWords } from "./coding-agent-failure-words.js";
import { CODING_AGENT_STATUS, type CodingAgentStatus } from "./coding-agent-wire.js";

/**
 * automation-list-model.ts -- the Automations list as a window draws it: grouped by who owns each, with its trigger in words, where its newest run stands, and when it runs next.
 *
 * Who owns an automation is the one thing the list must never leave in
 * doubt, so the list falls into the workspace's automations, then the
 * account's personal ones, and each row names its owner besides. A schedule
 * is said in words where its cron is one the picker writes, and as its cron
 * otherwise, with its zone named by its city; a GitHub event as what happens
 * and where, and a webhook as its call. Nothing here formats a date:
 * when a row's next run falls is handed back as an instant for the window to
 * say on its own clock.
 */

/** The days of the week as cron numbers them, as a schedule says them. */
const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

/** Why a run did not start, as its row's line says it. */
const RUN_REASON_WORDS = {
  [AUTOMATION_RUN_REASON.CONCURRENCY]: "Skipped: an earlier run's agent was still at work.",
  [AUTOMATION_RUN_REASON.DAILY_CAP]:
    "Skipped: it had already started as many runs today as it may.",
  [AUTOMATION_RUN_REASON.TASK_UNREACHABLE]:
    "Its task is gone, or no longer in one of your workspaces.",
  [AUTOMATION_RUN_REASON.CREATOR_LEFT]: "Its creator is no longer in the workspace.",
  [AUTOMATION_RUN_REASON.NO_REPOSITORY]: "It names no repository to work in.",
  [AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE]:
    "Luke can no longer reach its repository on GitHub.",
  [AUTOMATION_RUN_REASON.GITHUB_SIGN_IN]: "Its GitHub sign-in had lapsed.",
  [AUTOMATION_RUN_REASON.MODEL]: "Its model is no longer offered. Choose another.",
  [AUTOMATION_RUN_REASON.UNAVAILABLE]: "Coding agents couldn't be reached.",
  [AUTOMATION_RUN_REASON.REPOSITORY_CHANGED]:
    "It no longer works in the repository the event came from.",
  [AUTOMATION_RUN_REASON.PAUSED]: "It was turned off before the run could start.",
  [AUTOMATION_RUN_REASON.MISSED]: "It waited too long to start.",
  [AUTOMATION_RUN_REASON.AGENT_GONE]: "The agent its runs go to is gone or archived.",
} as const satisfies Record<AutomationRunReason, string>;

/** Each GitHub event as a trigger's sentence says what happens, after "When". */
const GITHUB_EVENT_WORDS = {
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED]: { what: "a pull request", happens: "is opened" },
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED]: { what: "a pull request", happens: "is labelled" },
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED]: { what: "a pull request", happens: "is updated" },
  [GITHUB_TRIGGER_EVENT.ISSUE_OPENED]: { what: "an issue", happens: "is opened" },
  [GITHUB_TRIGGER_EVENT.ISSUE_LABELED]: { what: "an issue", happens: "is labelled" },
  [GITHUB_TRIGGER_EVENT.CHECK_FAILED]: { what: "a check", happens: "fails" },
  [GITHUB_TRIGGER_EVENT.PUSH]: { what: "commits", happens: "are pushed" },
} as const satisfies Record<GitHubTriggerEvent, { what: string; happens: string }>;

/** Whose events a GitHub trigger hears, as its sentence names them after "by". */
const GITHUB_SENDER_WORDS = {
  [GITHUB_SENDER.PEOPLE]: "people",
  [GITHUB_SENDER.LUKE_AGENTS]: "Luke's agents",
  [GITHUB_SENDER.OTHER_BOTS]: "other bots",
} as const satisfies Record<GitHubSender, string>;

/** Each moment of a pull request's update, as its sentence says it after "is". */
const PULL_REQUEST_MOMENT_WORDS = {
  [PULL_REQUEST_MOMENT.OPENED]: "opened",
  [PULL_REQUEST_MOMENT.READY]: "marked ready",
  [PULL_REQUEST_MOMENT.PUSHED]: "pushed to",
} as const satisfies Record<PullRequestMoment, string>;

/** The events a draft or a fork's pull request may be, which a trigger's drafts and forks settings speak to. */
const PULL_REQUEST_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
]);

/** What fired a run, as its row's title says it while its agent has no title of its own. */
const FIRING_WORDS = {
  [AUTOMATION_FIRING.SCHEDULE]: "Scheduled run",
  [AUTOMATION_FIRING.MANUAL]: "Run now",
  [AUTOMATION_FIRING.GITHUB]: "GitHub event",
  [AUTOMATION_FIRING.WEBHOOK]: "Webhook called",
} as const satisfies Record<AutomationRunSummary["firing"]["kind"], string>;

/** Whose key a run's agent ran on, where it is not the reader's, as its line names it. */
const AGENT_OWNER = "its owner";

/** Where a started run's agent stands, and why it failed where it did, in the words its own end line uses. */
function agentLine(
  agent: NonNullable<AutomationRunSummary["agent"]>,
  keyHolder: string | undefined,
): string {
  const standing = AGENT_STATUS_WORDS[agent.status];
  // Note that the agent's own account is whose keys it ran on, a same-agent run's a teammate's agent's,
  // so the service's word for it goes before the guess the caller makes from the automation's maker.
  const holder = agent.ownKey === undefined ? keyHolder : agent.ownKey ? undefined : AGENT_OWNER;
  const why =
    agent.failureReason === undefined ? undefined : agentFailureWords(agent.failureReason, holder);
  return agent.status === CODING_AGENT_STATUS.FAILED && why !== undefined
    ? `${standing}: ${why}`
    : standing;
}

/** Where a started run's agent stands, as its row's line says it. */
const AGENT_STATUS_WORDS = {
  [CODING_AGENT_STATUS.STARTING]: "Starting",
  [CODING_AGENT_STATUS.RUNNING]: "Working",
  [CODING_AGENT_STATUS.COMPLETED]: "Finished",
  [CODING_AGENT_STATUS.FAILED]: "Its agent failed",
  [CODING_AGENT_STATUS.CANCELLED]: "Stopped",
} as const satisfies Record<CodingAgentStatus, string>;

/** The order the owners' groups stand in: the workspace's first, as the ones every member shares. */
const OWNER_ORDER = [AUTOMATION_SCOPE.WORKSPACE, AUTOMATION_SCOPE.PERSONAL] as const;

/** Where an automation's newest run stands, as its row's glyph wears it. */
export const AUTOMATION_RUN_STANDING = {
  /** Its agent is at work. */
  WORKING: "working",
  /** It could not start, or its agent failed. */
  FAILED: "failed",
  /** Nothing to say: it finished, was skipped as asked, or has not run. */
  REST: "rest",
} as const;

export type AutomationRunStanding =
  (typeof AUTOMATION_RUN_STANDING)[keyof typeof AUTOMATION_RUN_STANDING];

/** When an automation runs next, as its row ends. */
export const AUTOMATION_NEXT = {
  /** It is turned off. */
  OFF: "off",
  /** No instant is due: it fires on an event, or its schedule has no next run. */
  UNSCHEDULED: "unscheduled",
  /** It is due at an instant. */
  AT: "at",
} as const;

export type AutomationNext =
  | { readonly kind: typeof AUTOMATION_NEXT.OFF }
  | { readonly kind: typeof AUTOMATION_NEXT.UNSCHEDULED }
  | { readonly kind: typeof AUTOMATION_NEXT.AT; readonly at: number };

/** One owner's automations, in the order the service listed them. */
export interface AutomationGroup {
  readonly owner: AutomationScope;
  readonly automations: readonly AutomationSummary[];
}

/** A time of day as a schedule says it, the minute in two figures. */
function clockText(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

/** A whole number a cron field spells, or nothing for any other field. */
function cronNumber(field: string | undefined): number | undefined {
  return field !== undefined && /^\d+$/u.test(field) ? Number(field) : undefined;
}

/** The city of an IANA zone, its underscores spaced: "America/New_York" is "New York". */
function zoneCity(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replaceAll("_", " ");
}

/** A schedule in words where the picker could have written it, and its cron otherwise. */
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

/** Who owns an automation; one a service before scopes answered is its creator's own. */
export function automationOwner(automation: AutomationSummary): AutomationScope {
  return automation.scope ?? AUTOMATION_SCOPE.PERSONAL;
}

/** The list grouped by owner, the workspace's first, an owner with none left out. */
export function automationGroups(
  automations: readonly AutomationSummary[],
): readonly AutomationGroup[] {
  return OWNER_ORDER.map((owner) => ({
    owner,
    automations: automations.filter((automation) => automationOwner(automation) === owner),
  })).filter((group) => group.automations.length > 0);
}

/** Names in a run of words: "a", "a or b", "a, b, or c". */
function eitherOf(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" or ");
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

/**
 * A trigger as one sentence, as a row and the editor say what fires it: a
 * schedule in words, a GitHub event with the repositories it is heard in and
 * the labels and branches it keeps to, and a webhook's call.
 */
export function automationTriggerText(
  trigger: AutomationTrigger,
  repositories: readonly string[] = [],
): string {
  switch (trigger.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return scheduleText(trigger.cron, trigger.timezone);
    case AUTOMATION_TRIGGER.GITHUB: {
      const words = GITHUB_EVENT_WORDS[trigger.event];
      // Note that each list is read in its own order and once, because a trigger may name one twice.
      const named = trigger.senders ?? GITHUB_DEFAULT_SENDERS;
      const senders = Object.values(GITHUB_SENDER).filter((sender) => named.includes(sender));
      const fires = trigger.moments ?? PULL_REQUEST_DEFAULT_MOMENTS;
      const moments = Object.values(PULL_REQUEST_MOMENT).filter((moment) => fires.includes(moment));
      // A check names no sender, so its sentence says by whom nothing.
      const by =
        trigger.event === GITHUB_TRIGGER_EVENT.CHECK_FAILED
          ? ""
          : senders.length === Object.values(GITHUB_SENDER).length
            ? " by anyone"
            : ` by ${eitherOf(senders.map((sender) => GITHUB_SENDER_WORDS[sender]))}`;
      const happens =
        trigger.event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED && moments.length > 0
          ? `is ${eitherOf(moments.map((moment) => PULL_REQUEST_MOMENT_WORDS[moment]))}`
          : words.happens;
      const pullRequest = PULL_REQUEST_EVENTS.has(trigger.event);
      const included = [
        ...(pullRequest && trigger.drafts === true ? ["drafts"] : []),
        ...(pullRequest && trigger.forks === true ? ["forks"] : []),
      ];
      const also = included.length === 0 ? "" : `, ${included.join(" and ")} included`;
      const where = repositories.length === 0 ? "" : ` in ${eitherOf(repositories)}`;
      const labels = trigger.labels ?? [];
      const branches = trigger.branches ?? [];
      const labelled = labels.length === 0 ? "" : ` labelled ${eitherOf(labels)}`;
      const on = branches.length === 0 ? "" : ` on ${eitherOf(branches)}`;
      return `When ${words.what}${by} ${happens}${where}${labelled}${on}${also}`;
    }
    case AUTOMATION_TRIGGER.WEBHOOK:
      return "When its webhook is called";
  }
}

/**
 * Where a run stands: working while its agent works, failed where it could
 * not start or its agent failed, and at rest otherwise, a skip included,
 * since a skip is the automation doing as it was asked.
 */
export function automationRunStanding(run: AutomationRunSummary | null): AutomationRunStanding {
  if (run === null) return AUTOMATION_RUN_STANDING.REST;
  if (run.status === AUTOMATION_RUN_STATUS.FAILED) return AUTOMATION_RUN_STANDING.FAILED;
  switch (run.agent?.status) {
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
      return AUTOMATION_RUN_STANDING.WORKING;
    case CODING_AGENT_STATUS.FAILED:
      return AUTOMATION_RUN_STANDING.FAILED;
    default:
      return AUTOMATION_RUN_STANDING.REST;
  }
}

/** When an automation runs next: off before any instant, since it fires at all. */
export function automationNext(automation: AutomationSummary): AutomationNext {
  if (!automation.enabled) return { kind: AUTOMATION_NEXT.OFF };
  if (automation.nextRunAt === null) return { kind: AUTOMATION_NEXT.UNSCHEDULED };
  return { kind: AUTOMATION_NEXT.AT, at: automation.nextRunAt };
}

/** A run's title: its agent's own, where it has one, else what fired it. */
export function automationRunTitle(run: AutomationRunSummary): string {
  return run.agent?.title ?? FIRING_WORDS[run.firing.kind];
}

/** What its owner is told of a run that failed to start: that it could not, and why, in its row's own words. */
export function failedRunText(reason: AutomationRunReason | null): string {
  return reason === null
    ? "A run couldn't start."
    : `A run couldn't start. ${RUN_REASON_WORDS[reason]}`;
}

/** A run's line: why it did not start, where it did not, else where its agent stands, or that it waits to start. */
export function automationRunLine(
  run: AutomationRunSummary,
  /** Whose key the run's agent ran on where it is not the reader's: its creator, whose Settings the reader cannot mend. */
  keyHolder?: string | undefined,
): string {
  if (run.reason !== null) return RUN_REASON_WORDS[run.reason];
  switch (run.status) {
    case AUTOMATION_RUN_STATUS.QUEUED:
      return "Waiting to start";
    case AUTOMATION_RUN_STATUS.FAILED:
      return "It could not start.";
    case AUTOMATION_RUN_STATUS.SKIPPED:
      return "Skipped";
    case AUTOMATION_RUN_STATUS.STARTED:
      return run.agent === null ? "Its agent is gone" : agentLine(run.agent, keyHolder);
  }
}
