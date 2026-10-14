import { SCHEDULE_PRESET } from "@sidecar/hosted/automation-schedule";
import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationFiring,
  type AutomationRunReason,
  type AutomationRunSummary,
  type AutomationTrigger,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
} from "@sidecar/hosted/automation-wire";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";

/**
 * automation-words.ts -- how the Automations page says an automation and its runs: a trigger in a line, a run's state as a pill, why one did not start.
 *
 * Every sentence here is the page's alone and reads nothing but the wire's
 * own values, so the list, the detail, and the editor's preview say a
 * trigger the same way. A schedule is said in words where its cron is one
 * the picker writes (a minute and an hour, every day, on weekdays, or on one
 * day of the week, or every hour) and as its cron otherwise, with its zone
 * named by its city.
 */

/** How a run's pill is coloured. */
export const RUN_TONE = {
  WORKING: "working",
  COMPLETE: "complete",
  ATTENTION: "attention",
  DANGER: "danger",
  QUIET: "quiet",
} as const;

export type RunTone = (typeof RUN_TONE)[keyof typeof RUN_TONE];

/** A run's state as its pill says it: a word and a tone. */
export interface RunState {
  readonly word: string;
  readonly tone: RunTone;
}

/** The days of the week as cron numbers them. */
const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

/** What each GitHub event says after "When". */
const GITHUB_EVENT_WORDS = {
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED]: "a pull request is opened",
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED]: "a pull request is labelled",
  [GITHUB_TRIGGER_EVENT.ISSUE_OPENED]: "an issue is opened",
  [GITHUB_TRIGGER_EVENT.ISSUE_LABELED]: "an issue is labelled",
  [GITHUB_TRIGGER_EVENT.CHECK_FAILED]: "a check fails",
  [GITHUB_TRIGGER_EVENT.PUSH]: "commits are pushed",
} as const satisfies Record<GitHubTriggerEvent, string>;

/** Each GitHub event as a run's title says it, around the number and the branch it names. */
const GITHUB_FIRING_WORDS = {
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED]: (number, _on) => `Pull request${number} opened`,
  [GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED]: (number, _on) => `Pull request${number} labelled`,
  [GITHUB_TRIGGER_EVENT.ISSUE_OPENED]: (number, _on) => `Issue${number} opened`,
  [GITHUB_TRIGGER_EVENT.ISSUE_LABELED]: (number, _on) => `Issue${number} labelled`,
  [GITHUB_TRIGGER_EVENT.CHECK_FAILED]: (_number, on) => `Check failed${on}`,
  [GITHUB_TRIGGER_EVENT.PUSH]: (_number, on) => `Pushed${on}`,
} as const satisfies Record<GitHubTriggerEvent, (number: string, on: string) => string>;

/** The GitHub events in the order the picker offers them, each with its short name. */
export const GITHUB_EVENT_CHOICES = [
  { event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED, name: "Issue opened" },
  { event: GITHUB_TRIGGER_EVENT.ISSUE_LABELED, name: "Issue labelled" },
  { event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED, name: "Pull request opened" },
  { event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED, name: "Pull request labelled" },
  { event: GITHUB_TRIGGER_EVENT.CHECK_FAILED, name: "Check failed" },
  { event: GITHUB_TRIGGER_EVENT.PUSH, name: "Push to a branch" },
] as const;

/** Why a run did not start, as the history says it. */
const REASON_WORDS = {
  [AUTOMATION_RUN_REASON.CONCURRENCY]: "An earlier run's agent was still at work.",
  [AUTOMATION_RUN_REASON.DAILY_CAP]:
    "It had already started as many runs today as its limit allows.",
  [AUTOMATION_RUN_REASON.PLAN_UNREACHABLE]:
    "Its plan is gone, or no longer in one of your workspaces.",
  [AUTOMATION_RUN_REASON.NO_REPOSITORY]: "Its plan has no repository.",
  [AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE]:
    "Luke can no longer reach the plan's repository on GitHub.",
  [AUTOMATION_RUN_REASON.GITHUB_SIGN_IN]: "Sign in with GitHub again, then turn it back on.",
  [AUTOMATION_RUN_REASON.MODEL]: "Its model is no longer offered. Choose another.",
  [AUTOMATION_RUN_REASON.UNAVAILABLE]: "Coding agents couldn't be reached.",
  [AUTOMATION_RUN_REASON.REPOSITORY_CHANGED]:
    "Its plan moved to another repository after the event.",
  [AUTOMATION_RUN_REASON.PAUSED]: "The automation was paused before the run could start.",
  [AUTOMATION_RUN_REASON.MISSED]: "It waited too long to start.",
} as const satisfies Record<AutomationRunReason, string>;

/** A time of day as the page writes it, the minute in two figures. */
function clockText(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

/** The city of an IANA zone, its underscores spaced: "America/New_York" is "New York". */
export function zoneCity(timezone: string): string {
  return (timezone.split("/").at(-1) ?? timezone).replaceAll("_", " ");
}

/** A whole number a cron field spells, or nothing for any other field. */
function cronNumber(field: string | undefined): number | undefined {
  return field !== undefined && /^\d+$/u.test(field) ? Number(field) : undefined;
}

/** A schedule in words where the picker could have written it; its cron otherwise. */
function scheduleText(cron: string, timezone: string): string {
  const city = zoneCity(timezone);
  if (cron.trim() === SCHEDULE_PRESET.HOURLY) return "Every hour";
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/u);
  const minute = cronNumber(minuteField);
  const hour = cronNumber(hourField);
  if (minute === undefined || hour === undefined || dayOfMonth !== "*" || month !== "*") {
    return `${cron.trim()} · ${city}`;
  }
  const at = clockText(hour, minute);
  if (dayOfWeek === "*") return `Every day at ${at} · ${city}`;
  if (dayOfWeek === "1-5") return `Weekdays at ${at} · ${city}`;
  const day = cronNumber(dayOfWeek);
  const name = day === undefined ? undefined : WEEKDAY_NAMES[day % 7];
  return name === undefined ? `${cron.trim()} · ${city}` : `${name} at ${at} · ${city}`;
}

/** A trigger in one line, as a list row and the detail's head say it. */
export function triggerText(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return scheduleText(trigger.cron, trigger.timezone);
    case AUTOMATION_TRIGGER.GITHUB: {
      const labels = trigger.labels ?? [];
      const branches = trigger.branches ?? [];
      const labelled = labels.length === 0 ? "" : ` · labelled ${labels.join(", ")}`;
      const on = branches.length === 0 ? "" : ` · on ${branches.join(", ")}`;
      return `When ${GITHUB_EVENT_WORDS[trigger.event]}${labelled}${on}`;
    }
    case AUTOMATION_TRIGGER.WEBHOOK:
      return "When its webhook is called";
  }
}

/** What fired a run, as its row's title says it. */
export function firingText(firing: AutomationFiring): string {
  switch (firing.kind) {
    case AUTOMATION_FIRING.SCHEDULE:
      return "Scheduled run";
    case AUTOMATION_FIRING.MANUAL:
      return "Run now";
    case AUTOMATION_FIRING.WEBHOOK:
      return "Webhook called";
    case AUTOMATION_FIRING.GITHUB: {
      const number = firing.number === undefined ? "" : ` #${firing.number}`;
      const on = firing.branch === undefined ? "" : ` on ${firing.branch}`;
      const subject = GITHUB_FIRING_WORDS[firing.event](number, on);
      return firing.title === undefined ? subject : `${subject}: ${firing.title}`;
    }
  }
}

/** A run's state for its pill: the firing's own where it started nothing, and its agent's where it did. */
export function runState(run: AutomationRunSummary): RunState {
  switch (run.status) {
    case AUTOMATION_RUN_STATUS.QUEUED:
      return { word: "Queued", tone: RUN_TONE.QUIET };
    case AUTOMATION_RUN_STATUS.SKIPPED:
      return { word: "Skipped", tone: RUN_TONE.ATTENTION };
    case AUTOMATION_RUN_STATUS.FAILED:
      return { word: "Failed", tone: RUN_TONE.DANGER };
    case AUTOMATION_RUN_STATUS.STARTED:
      break;
  }
  switch (run.agent?.status) {
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
      return { word: "Running", tone: RUN_TONE.WORKING };
    case CODING_AGENT_STATUS.COMPLETED:
      return { word: "Completed", tone: RUN_TONE.COMPLETE };
    case CODING_AGENT_STATUS.FAILED:
      return { word: "Agent failed", tone: RUN_TONE.DANGER };
    case CODING_AGENT_STATUS.CANCELLED:
      return { word: "Cancelled", tone: RUN_TONE.QUIET };
    case undefined:
      return { word: "Started", tone: RUN_TONE.QUIET };
  }
}

/** Why a run did not start, in a sentence; nothing for a run that did or still may. */
export function reasonText(reason: AutomationRunReason | null): string | undefined {
  return reason === null ? undefined : REASON_WORDS[reason];
}
