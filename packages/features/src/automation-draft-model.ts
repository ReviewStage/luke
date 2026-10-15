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
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationScope,
  type AutomationSummary,
} from "./automation-wire.js";

/**
 * automation-draft-model.ts -- an automation as its editor holds it while it is written: a schedule in the picker's terms, the task, the repository, and the owner, with what stops it saving and the write that saves it.
 *
 * The picker writes a schedule as a kind and a time, every hour, every day,
 * on weekdays, or on one day of the week, and keeps a cron it did not write
 * as it was, so opening an automation made elsewhere never rewrites its
 * schedule. A save sends only what changed, so a field the editor does not
 * show, a model or a target, stands as the service holds it. Every word a
 * field's problem says is here, beside the rule it states.
 */

/** How the picker spells a schedule. */
export const SCHEDULE_KIND = {
  HOURLY: "hourly",
  DAILY: "daily",
  WEEKDAYS: "weekdays",
  WEEKLY: "weekly",
  /** A cron the picker did not write, kept as it was. */
  CUSTOM: "custom",
} as const;

export type ScheduleKind = (typeof SCHEDULE_KIND)[keyof typeof SCHEDULE_KIND];

/** The fields a draft's problems are said at. */
export const DRAFT_FIELD = {
  NAME: "name",
  SCHEDULE: "schedule",
  PROMPT: "prompt",
  REPOSITORY: "repository",
} as const;

type DraftField = (typeof DRAFT_FIELD)[keyof typeof DRAFT_FIELD];

/** A schedule as the picker holds it: the kind, the time of day, the day of the week cron numbers, and the cron a custom one keeps. */
export interface ScheduleDraft {
  readonly kind: ScheduleKind;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
  readonly cron: string;
}

/** An automation as its editor holds it. */
export interface AutomationDraft {
  readonly name: string;
  readonly schedule: ScheduleDraft;
  readonly timezone: string;
  readonly prompt: string;
  /** The repository its runs work in, `owner/name`, or none chosen yet. */
  readonly repository: string | null;
  readonly owner: AutomationScope;
}

/** What a draft starts from where nothing is written: nine on weekdays, in the zone the window is in. */
export interface DraftDefaults {
  readonly timezone: string;
  readonly owner: AutomationScope;
}

/** A change to an automation as it is gathered, a field at a time. */
type ChangeDraft = {
  -readonly [Key in keyof AutomationChangeParams["change"]]: AutomationChangeParams["change"][Key];
};

/** What each field says while it stops the draft saving. */
export type DraftProblems = { readonly [Field in DraftField]?: string };

/** A new automation's schedule: nine on weekdays. */
const NEW_SCHEDULE: ScheduleDraft = {
  kind: SCHEDULE_KIND.WEEKDAYS,
  hour: 9,
  minute: 0,
  weekday: 1,
  cron: "0 9 * * 1-5",
};

/** Why a schedule was refused, as its field says it. */
const SCHEDULE_REFUSAL_WORDS = {
  [SCHEDULE_REFUSAL.CRON]: "That isn't a schedule Luke can read.",
  [SCHEDULE_REFUSAL.TIMEZONE]: "Pick a time zone.",
  [SCHEDULE_REFUSAL.TOO_FREQUENT]: "It can run at most every 15 minutes.",
} as const satisfies Record<ScheduleRefusal, string>;

/** A whole number a cron field spells, within its bounds, or nothing for any other field. */
function cronNumber(field: string | undefined, most: number): number | undefined {
  if (field === undefined || !/^\d+$/u.test(field)) return undefined;
  const value = Number(field);
  return value <= most ? value : undefined;
}

/** A trimmed text past its bound, or empty, as its field says it; nothing while it reads. */
function textProblem(text: string, most: number, empty: string, long: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return empty;
  return trimmed.length > most ? long : undefined;
}

/** The schedule a cron reads as in the picker's terms, a cron it did not write kept as custom. */
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

/** The cron a schedule draft spells. */
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

/**
 * The draft an automation opens as, or a new one's from the defaults. A
 * trigger the picker does not write, which the window never makes, opens
 * as a new schedule, since the editor shows a schedule alone.
 */
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
      repository: null,
      owner: defaults.owner,
    };
  }
  const { trigger } = automation;
  const scheduled = trigger.kind === AUTOMATION_TRIGGER.SCHEDULE;
  return {
    name: automation.name,
    schedule: scheduled ? scheduleDraftOf(trigger.cron) : NEW_SCHEDULE,
    timezone: scheduled ? trigger.timezone : defaults.timezone,
    prompt: automation.action.prompt,
    repository: automation.repositories?.[0] ?? null,
    owner: automation.scope ?? AUTOMATION_SCOPE.PERSONAL,
  };
}

/**
 * What stops a draft saving, at the field it is about: a name and a task
 * written, a schedule Luke reads and that fires no more often than its
 * floor, and a repository chosen where the automation is not on a plan,
 * whose repository is its plan's.
 */
export function draftProblems(
  draft: AutomationDraft,
  planBacked: boolean,
  now: Date,
): DraftProblems {
  const name = textProblem(
    draft.name,
    AUTOMATION_BOUNDS.MAX_NAME_CHARS,
    "Name it.",
    `Keep the name under ${AUTOMATION_BOUNDS.MAX_NAME_CHARS} characters.`,
  );
  const prompt = textProblem(
    draft.prompt,
    AUTOMATION_BOUNDS.MAX_PROMPT_CHARS,
    "Tell the agent what to do.",
    `Keep the task under ${AUTOMATION_BOUNDS.MAX_PROMPT_CHARS.toLocaleString("en-US")} characters.`,
  );
  const read = readSchedule({ cron: cronOf(draft.schedule), timezone: draft.timezone }, now);
  const schedule = Result.isFailure(read) ? SCHEDULE_REFUSAL_WORDS[read.failure] : undefined;
  const repository =
    !planBacked && draft.repository === null ? "Choose the repository it works in." : undefined;
  const problems: { [Field in DraftField]?: string } = {};
  if (name !== undefined) problems[DRAFT_FIELD.NAME] = name;
  if (schedule !== undefined) problems[DRAFT_FIELD.SCHEDULE] = schedule;
  if (prompt !== undefined) problems[DRAFT_FIELD.PROMPT] = prompt;
  if (repository !== undefined) problems[DRAFT_FIELD.REPOSITORY] = repository;
  return problems;
}

/** The next instants a draft's schedule is due after `now`, as many as asked; none for one Luke cannot read. */
export function draftNextRuns(draft: AutomationDraft, now: Date, count: number): readonly number[] {
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

/** The write that makes a draft an automation in the workspace named, its runs on a new agent each, as the service starts one. */
export function createRequestOf(
  draft: AutomationDraft,
  workspaceId: string,
): AutomationCreateParams {
  const made = {
    workspaceId,
    name: draft.name.trim(),
    trigger: {
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      cron: cronOf(draft.schedule),
      timezone: draft.timezone,
    },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: draft.prompt.trim() },
    scope: draft.owner,
  } as const;
  return draft.repository === null ? made : { ...made, repositories: [draft.repository] };
}

/**
 * What a draft changes of the automation it opened as, each field only
 * where it moved, or nothing where none did. The task keeps the model the
 * automation runs on, which this editor does not show, and a repository is
 * sent only where the automation is not on a plan.
 */
export function changeOf(
  draft: AutomationDraft,
  automation: AutomationSummary,
  defaults: DraftDefaults,
): AutomationChangeParams["change"] | undefined {
  const was = automationDraft(automation, defaults);
  const cron = cronOf(draft.schedule);
  const scheduleMoved = cron !== cronOf(was.schedule) || draft.timezone !== was.timezone;
  const promptMoved = draft.prompt.trim() !== was.prompt;
  const repositoryMoved = automation.planId === null && draft.repository !== was.repository;
  const change: ChangeDraft = {};
  if (draft.name.trim() !== was.name) change.name = draft.name.trim();
  if (scheduleMoved) {
    change.trigger = { kind: AUTOMATION_TRIGGER.SCHEDULE, cron, timezone: draft.timezone };
  }
  if (promptMoved) change.action = { ...automation.action, prompt: draft.prompt.trim() };
  if (repositoryMoved && draft.repository !== null) change.repositories = [draft.repository];
  if (draft.owner !== was.owner) change.scope = draft.owner;
  return Object.keys(change).length === 0 ? undefined : change;
}
