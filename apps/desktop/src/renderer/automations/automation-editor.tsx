import {
  nextScheduledRun,
  readSchedule,
  SCHEDULE_REFUSAL,
} from "@sidecar/hosted/automation-schedule";
import { AUTOMATION_CALL_FAILURE } from "@sidecar/hosted/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
  type AutomationGuards,
  type AutomationSummary,
  type AutomationTrigger,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
} from "@sidecar/hosted/automation-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { Result } from "effect";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { ModalShell } from "../modal-shell";
import { BusyLabel } from "../spinner";
import { GITHUB_EVENT_CHOICES, zoneCity } from "./automation-words";
import type { AutomationWrite } from "./use-automations";

/**
 * automation-editor.tsx -- the New and Edit automation dialog: when it fires, the plan its agent works on, what the agent is told, and how far it may go.
 *
 * A dialog over the window, as New plan is, a form's width. A schedule is
 * picked as most schedules are said, hourly, daily, on weekdays, or weekly,
 * at a time in a zone, with the cron beneath for anything else; it is read
 * as the service reads it (`@sidecar/hosted/automation-schedule`), so a
 * schedule the service would refuse is said here before it travels, and
 * the next two times it would fire are shown as it is set. A GitHub
 * trigger is one of the events the Luke App hears, with the labels and
 * branches it keeps to. A webhook's secret is minted here, in the window,
 * and handed to the page to show once (`webhook-secret-dialog.tsx`); the
 * service keeps only its hash. Only plans with a repository are offered,
 * since an agent works in one.
 */

/** How a schedule repeats in the picker; anything else is its cron. */
const REPEAT = {
  HOURLY: "hourly",
  DAILY: "daily",
  WEEKDAYS: "weekdays",
  WEEKLY: "weekly",
  CUSTOM: "custom",
} as const;

type Repeat = (typeof REPEAT)[keyof typeof REPEAT];

const REPEAT_CHOICES = [
  { repeat: REPEAT.HOURLY, name: "Hourly" },
  { repeat: REPEAT.DAILY, name: "Daily" },
  { repeat: REPEAT.WEEKDAYS, name: "Weekdays" },
  { repeat: REPEAT.WEEKLY, name: "Weekly" },
] as const;

const TRIGGER_CHOICES = [
  { kind: AUTOMATION_TRIGGER.SCHEDULE, name: "Schedule" },
  { kind: AUTOMATION_TRIGGER.GITHUB, name: "GitHub event" },
  { kind: AUTOMATION_TRIGGER.WEBHOOK, name: "Webhook" },
] as const;

const WEEKDAY_CHOICES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The events whose label filter is the label just applied. */
const LABELLED_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
]);

/** The events a label filter is read against: an issue's or pull request's opening, and its labelling. */
const LABEL_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
  GITHUB_TRIGGER_EVENT.ISSUE_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
]);

/** The events a branch filter is read against: a pull request's base, a check's, and a push's branch. */
const BRANCH_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.CHECK_FAILED,
  GITHUB_TRIGGER_EVENT.PUSH,
]);

/** What a refused schedule says under its fields. */
const SCHEDULE_WORDS = {
  [SCHEDULE_REFUSAL.CRON]: "That isn't a five-field cron: minute, hour, day, month, weekday.",
  [SCHEDULE_REFUSAL.TIMEZONE]: "That time zone isn't one Luke knows.",
  [SCHEDULE_REFUSAL.TOO_FREQUENT]: "Runs must be at least 15 minutes apart.",
} as const;

/** What a refused save says. */
const SAVE_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Couldn't reach Luke. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "That plan is gone, or no longer yours.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "That plan has no repository yet.",
  [AUTOMATION_CALL_FAILURE.INVALID]: "Luke couldn't save that. Check the schedule and the task.",
} as const;

const NEXT_RUN = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** The bytes of randomness in a webhook secret the window mints. */
const SECRET_BYTES = 24;

/** The schedule as the picker holds it. */
interface ScheduleDraft {
  readonly repeat: Repeat;
  readonly time: string;
  readonly weekday: number;
  readonly timezone: string;
  readonly cron: string;
}

/** Everything the form holds before it is saved. */
export interface AutomationDraft {
  readonly name: string;
  readonly kind: AutomationTrigger["kind"];
  readonly schedule: ScheduleDraft;
  readonly event: GitHubTriggerEvent;
  readonly labels: string;
  readonly branches: string;
  readonly planId: string | undefined;
  readonly prompt: string;
  readonly guards: AutomationGuards;
}

/** What a save hands the page: the automation's parts, and a webhook's new secret where one was minted. */
export interface AutomationSave {
  readonly planId: string;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly prompt: string;
  readonly guards: AutomationGuards;
  readonly webhookSecret: string | undefined;
}

/** The zone this Mac keeps. */
function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A 192-bit secret in base64url, minted in the window. */
export function mintWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/** The cron a picked schedule spells. */
function cronOf(schedule: ScheduleDraft): string {
  const [hour = "9", minute = "0"] = schedule.time.split(":");
  const at = `${Number(minute)} ${Number(hour)}`;
  switch (schedule.repeat) {
    case REPEAT.HOURLY:
      return "0 * * * *";
    case REPEAT.DAILY:
      return `${at} * * *`;
    case REPEAT.WEEKDAYS:
      return `${at} * * 1-5`;
    case REPEAT.WEEKLY:
      return `${at} * * ${schedule.weekday}`;
    case REPEAT.CUSTOM:
      return schedule.cron.trim();
  }
}

/** The picker's reading of a cron it may have written: its repeat, time, and weekday, or custom; in this Mac's zone where none is named. */
export function scheduleOf(cron: string, timezone: string = localZone()): ScheduleDraft {
  const custom = { repeat: REPEAT.CUSTOM, time: "09:00", weekday: 1, timezone, cron };
  if (cron === "0 * * * *") return { ...custom, repeat: REPEAT.HOURLY };
  const match = /^(\d+) (\d+) \* \* (\*|1-5|\d)$/u.exec(cron);
  if (match === null) return custom;
  const [, minute = "0", hour = "9", days = "*"] = match;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (days === "*") return { ...custom, repeat: REPEAT.DAILY, time };
  if (days === "1-5") return { ...custom, repeat: REPEAT.WEEKDAYS, time };
  return { ...custom, repeat: REPEAT.WEEKLY, time, weekday: Number(days) };
}

/** A comma-separated field as the list it names. */
function listOf(text: string): readonly string[] {
  return text
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each.length > 0);
}

/** The trigger the draft spells. */
function triggerOf(draft: AutomationDraft): AutomationTrigger {
  switch (draft.kind) {
    case AUTOMATION_TRIGGER.SCHEDULE:
      return {
        kind: AUTOMATION_TRIGGER.SCHEDULE,
        cron: cronOf(draft.schedule),
        timezone: draft.schedule.timezone,
      };
    case AUTOMATION_TRIGGER.GITHUB: {
      // Only the filters the event reads are kept, so one left from another event never holds it back.
      const labels = LABEL_EVENTS.has(draft.event) ? listOf(draft.labels) : [];
      const branches = BRANCH_EVENTS.has(draft.event) ? listOf(draft.branches) : [];
      return {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: draft.event,
        ...(labels.length === 0 ? undefined : { labels }),
        ...(branches.length === 0 ? undefined : { branches }),
      };
    }
    case AUTOMATION_TRIGGER.WEBHOOK:
      return { kind: AUTOMATION_TRIGGER.WEBHOOK };
  }
}

/** A fresh draft: a template's where one was chosen, an automation's to edit, or blank on the plan given. */
export function draftOf(
  from: Partial<AutomationDraft> | AutomationSummary | undefined,
  planId: string | undefined,
): AutomationDraft {
  const blank: AutomationDraft = {
    name: "",
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    schedule: scheduleOf("0 9 * * 1-5", localZone()),
    event: GITHUB_TRIGGER_EVENT.ISSUE_OPENED,
    labels: "",
    branches: "",
    planId,
    prompt: "",
    guards: AUTOMATION_DEFAULT_GUARDS,
  };
  if (from === undefined) return blank;
  if (!("id" in from)) return { ...blank, ...from, planId: from.planId ?? planId };
  const { trigger } = from;
  return {
    ...blank,
    name: from.name,
    kind: trigger.kind,
    planId: from.planId,
    prompt: from.action.prompt,
    guards: from.guards,
    ...(trigger.kind === AUTOMATION_TRIGGER.SCHEDULE
      ? { schedule: scheduleOf(trigger.cron, trigger.timezone) }
      : undefined),
    ...(trigger.kind === AUTOMATION_TRIGGER.GITHUB
      ? {
          event: trigger.event,
          labels: (trigger.labels ?? []).join(", "),
          branches: (trigger.branches ?? []).join(", "),
        }
      : undefined),
  };
}

/** What a schedule says under its fields: whether the service would take it, and the words. */
interface ScheduleNote {
  readonly ok: boolean;
  readonly text: string;
}

/** What the schedule says under its fields: why it would be refused, or the next two times it fires. */
function scheduleNote(schedule: ScheduleDraft): ScheduleNote {
  const cron = cronOf(schedule);
  const now = new Date();
  const read = readSchedule({ cron, timezone: schedule.timezone }, now);
  if (Result.isFailure(read)) return { ok: false, text: SCHEDULE_WORDS[read.failure] };
  const first = nextScheduledRun({ cron, timezone: schedule.timezone }, now);
  const second =
    first === undefined
      ? undefined
      : nextScheduledRun({ cron, timezone: schedule.timezone }, first);
  const times = [first, second].flatMap((at) => (at === undefined ? [] : [NEXT_RUN.format(at)]));
  return { ok: true, text: `Next: ${times.join(", then ")}` };
}

/** A row of segments, one pressed. */
function Segments<Value extends string | number>({
  label,
  choices,
  value,
  onChoose,
}: {
  label: string;
  choices: readonly { readonly value: Value; readonly name: string }[];
  value: Value;
  onChoose: (value: Value) => void;
}): React.JSX.Element {
  return (
    <fieldset className="settings-segments" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="settings-segment"
          aria-pressed={choice.value === value}
          onClick={() => onChoose(choice.value)}
        >
          {choice.name}
        </button>
      ))}
    </fieldset>
  );
}

/** A labelled field of the form. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="automation-field">
      <p className="automation-field-label">
        {label}
        {hint === undefined ? null : <small>{hint}</small>}
      </p>
      {children}
    </div>
  );
}

/** The schedule's fields: how it repeats, when, in which zone, or its cron. */
function ScheduleFields({
  schedule,
  onChange,
}: {
  schedule: ScheduleDraft;
  onChange: (schedule: ScheduleDraft) => void;
}): React.JSX.Element {
  const note = scheduleNote(schedule);
  const zones = Intl.supportedValuesOf("timeZone");
  const timed = schedule.repeat !== REPEAT.HOURLY && schedule.repeat !== REPEAT.CUSTOM;
  return (
    <>
      <Field label="Repeats">
        <div className="automation-field-row">
          <Segments
            label="Repeats"
            choices={REPEAT_CHOICES.map(({ repeat, name }) => ({ value: repeat, name }))}
            value={schedule.repeat}
            onChoose={(repeat) => onChange({ ...schedule, repeat })}
          />
          <button
            type="button"
            className="automation-disclosure"
            aria-expanded={schedule.repeat === REPEAT.CUSTOM}
            onClick={() =>
              onChange(
                schedule.repeat === REPEAT.CUSTOM
                  ? scheduleOf(schedule.cron, schedule.timezone)
                  : { ...schedule, repeat: REPEAT.CUSTOM, cron: cronOf(schedule) },
              )
            }
          >
            <ChevronRightIcon />
            Custom cron
          </button>
        </div>
      </Field>
      <div className="automation-field-row">
        {schedule.repeat === REPEAT.WEEKLY ? (
          <Field label="On">
            <Segments
              label="Day of the week"
              choices={WEEKDAY_CHOICES.map((name, value) => ({ value, name }))}
              value={schedule.weekday}
              onChoose={(weekday) => onChange({ ...schedule, weekday })}
            />
          </Field>
        ) : null}
        {timed ? (
          <Field label="At">
            <input
              type="time"
              className="automation-input"
              data-width="time"
              aria-label="Time of day"
              value={schedule.time}
              onChange={(event) => onChange({ ...schedule, time: event.currentTarget.value })}
            />
          </Field>
        ) : null}
        {schedule.repeat === REPEAT.CUSTOM ? (
          <Field label="Cron" hint="minute hour day month weekday">
            <input
              type="text"
              className="automation-input"
              data-mono="true"
              data-width="cron"
              aria-label="Cron"
              spellCheck={false}
              value={schedule.cron}
              onChange={(event) => onChange({ ...schedule, cron: event.currentTarget.value })}
            />
          </Field>
        ) : null}
        <Field label="Time zone">
          <select
            className="automation-input"
            aria-label="Time zone"
            value={schedule.timezone}
            onChange={(event) => onChange({ ...schedule, timezone: event.currentTarget.value })}
          >
            {(zones.includes(schedule.timezone) ? zones : [schedule.timezone, ...zones]).map(
              (zone) => (
                <option key={zone} value={zone}>
                  {zoneCity(zone)} ({zone})
                </option>
              ),
            )}
          </select>
        </Field>
      </div>
      <p
        className="automation-next"
        data-refused={String(!note.ok)}
        role={note.ok ? undefined : "alert"}
      >
        {note.text}
      </p>
    </>
  );
}

/** The GitHub trigger's fields: the event, and the labels and branches it keeps to. */
function GitHubFields({
  draft,
  repository,
  onPatch,
}: {
  draft: AutomationDraft;
  repository: string | null;
  onPatch: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const labelled = LABELLED_EVENTS.has(draft.event);
  return (
    <>
      <Field label="Event" hint={repository === null ? undefined : `on ${repository}`}>
        <div className="automation-events">
          {GITHUB_EVENT_CHOICES.map((choice) => (
            <button
              key={choice.event}
              type="button"
              className="inbox-option"
              aria-pressed={choice.event === draft.event}
              onClick={() => onPatch({ event: choice.event })}
            >
              {choice.name}
            </button>
          ))}
        </div>
      </Field>
      <div className="automation-field-row">
        {LABEL_EVENTS.has(draft.event) ? (
          <Field label="Labels" hint="any of, comma-separated">
            <input
              type="text"
              className="automation-input"
              aria-label="Labels"
              placeholder={labelled ? "bug" : "Any label"}
              value={draft.labels}
              onChange={(event) => onPatch({ labels: event.currentTarget.value })}
            />
          </Field>
        ) : null}
        {BRANCH_EVENTS.has(draft.event) ? (
          <Field label="Branches" hint="any of, comma-separated">
            <input
              type="text"
              className="automation-input"
              aria-label="Branches"
              placeholder="Any branch"
              value={draft.branches}
              onChange={(event) => onPatch({ branches: event.currentTarget.value })}
            />
          </Field>
        ) : null}
      </div>
      <p className="automation-field-note">
        Events from bots, Luke's own among them, never fire it, so an agent's pull request can't
        start another.
      </p>
    </>
  );
}

/** A guard's number, held to its bounds. */
function GuardField({
  label,
  value,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  maximum: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="automation-guard">
      <input
        type="number"
        className="automation-input"
        data-width="guard"
        min={1}
        max={maximum}
        value={value}
        onChange={(event) =>
          onChange(
            Math.min(maximum, Math.max(1, Math.round(Number(event.currentTarget.value) || 1))),
          )
        }
      />
      {label}
    </label>
  );
}

/** The dialog's frame: the app's modal shell round a card with its title, put away only while it is not at work. */
export function DialogFrame({
  title,
  busy,
  onClose,
  className,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <ModalShell
      className={`confirm-dialog automation-dialog ph-no-capture ${className ?? ""}`}
      labelledBy={titleId}
      busy={busy}
      onDismiss={() => {
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId} className="confirm-dialog-title">
        {title}
      </h2>
      {children}
    </ModalShell>
  );
}

/** The New or Edit automation dialog over the window. */
export function AutomationEditor({
  editing,
  initial,
  plans,
  onSave,
  onClose,
}: {
  /** The automation edited; none for a new one. */
  editing: AutomationSummary | undefined;
  initial: AutomationDraft;
  plans: readonly PlanSummary[];
  onSave: (save: AutomationSave) => Promise<AutomationWrite>;
  onClose: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const patch = (change: Partial<AutomationDraft>) => setDraft((held) => ({ ...held, ...change }));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const offered = plans.filter((plan) => plan.repository !== null);
  // An edit keeps the automation's own plan, which the form names and does not offer to change.
  const plan =
    editing === undefined
      ? (offered.find((each) => each.id === draft.planId) ?? offered[0])
      : {
          id: editing.planId,
          repository: plans.find((each) => each.id === editing.planId)?.repository ?? null,
        };
  const trigger = triggerOf(draft);
  const scheduleOk = draft.kind !== AUTOMATION_TRIGGER.SCHEDULE || scheduleNote(draft.schedule).ok;
  const canSave =
    !saving &&
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    plan !== undefined &&
    scheduleOk;
  const save = () => {
    if (!canSave || plan === undefined) return;
    setSaving(true);
    setNote(undefined);
    // A webhook's secret is minted only where the trigger becomes one; one already a webhook keeps its own.
    const becomesWebhook =
      trigger.kind === AUTOMATION_TRIGGER.WEBHOOK &&
      editing?.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK;
    onSave({
      planId: plan.id,
      name: draft.name.trim(),
      trigger,
      prompt: draft.prompt.trim(),
      guards: draft.guards,
      webhookSecret: becomesWebhook ? mintWebhookSecret() : undefined,
    })
      .then((answer) => {
        if ("failure" in answer) setNote(SAVE_WORDS[answer.failure]);
      })
      .finally(() => setSaving(false));
  };
  return (
    <DialogFrame
      title={editing === undefined ? "New automation" : "Edit automation"}
      busy={saving}
      onClose={onClose}
    >
      <div className="automation-dialog-body">
        <input
          type="text"
          className="automation-input"
          data-size="name"
          aria-label="Automation name"
          placeholder="Name"
          maxLength={AUTOMATION_BOUNDS.MAX_NAME_CHARS}
          value={draft.name}
          onChange={(event) => patch({ name: event.currentTarget.value })}
        />
        <Field label="When">
          <Segments
            label="Trigger"
            choices={TRIGGER_CHOICES.map(({ kind, name }) => ({ value: kind, name }))}
            value={draft.kind}
            onChoose={(kind) => patch({ kind })}
          />
        </Field>
        {draft.kind === AUTOMATION_TRIGGER.SCHEDULE ? (
          <ScheduleFields schedule={draft.schedule} onChange={(schedule) => patch({ schedule })} />
        ) : null}
        {draft.kind === AUTOMATION_TRIGGER.GITHUB ? (
          <GitHubFields draft={draft} repository={plan?.repository ?? null} onPatch={patch} />
        ) : null}
        {draft.kind === AUTOMATION_TRIGGER.WEBHOOK ? (
          <p className="automation-field-note">
            {editing?.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK
              ? "Its address and secret stay as they are."
              : "Its address and secret are shown once, after you save. Anything that can send a POST can call it: Sentry, a CI job, a script."}
          </p>
        ) : null}
        <hr className="automation-dialog-rule" />
        <Field label="Plan" hint="the agent works on its repository">
          {editing !== undefined ? (
            // An automation keeps the plan it was made on; a new one is made for another.
            <p className="automation-field-note">{editing.planName}</p>
          ) : offered.length === 0 ? (
            <p className="automation-field-note">
              Give a plan a repository first; an agent works in one.
            </p>
          ) : (
            <select
              className="automation-input"
              aria-label="Plan"
              value={plan?.id}
              onChange={(event) => patch({ planId: event.currentTarget.value })}
            >
              {offered.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name} · {each.repository}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Task" hint="what the agent is told each run">
          <textarea
            className="automation-input automation-textarea"
            aria-label="Task"
            rows={5}
            maxLength={AUTOMATION_BOUNDS.MAX_PROMPT_CHARS}
            placeholder="Find the flakiest test in CI this week and fix it."
            value={draft.prompt}
            onChange={(event) => patch({ prompt: event.currentTarget.value })}
          />
        </Field>
        <Field label="Limits" hint="a run past either is skipped, not queued">
          <div className="automation-field-row">
            <GuardField
              label="at a time"
              value={draft.guards.maxConcurrentRuns}
              maximum={AUTOMATION_BOUNDS.MAX_CONCURRENT_RUNS}
              onChange={(maxConcurrentRuns) =>
                setDraft((held) => ({ ...held, guards: { ...held.guards, maxConcurrentRuns } }))
              }
            />
            <GuardField
              label="a day"
              value={draft.guards.dailyRunCap}
              maximum={AUTOMATION_BOUNDS.MAX_DAILY_RUNS}
              onChange={(dailyRunCap) =>
                setDraft((held) => ({ ...held, guards: { ...held.guards, dailyRunCap } }))
              }
            />
          </div>
        </Field>
        <p className="automation-field-note">
          It runs a coding agent on your model and keys, as you, whether or not this Mac is awake.
        </p>
      </div>
      {note === undefined ? null : (
        <p className="confirm-dialog-error" role="alert">
          {note}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <button type="button" className="toolbar-button" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          aria-busy={saving}
          disabled={!canSave}
          onClick={save}
        >
          <BusyLabel busy={saving} label="Saving">
            {editing === undefined ? "Create automation" : "Save"}
          </BusyLabel>
        </button>
      </div>
    </DialogFrame>
  );
}

/** The action an automation carries, from what the form saved. */
export function actionOf(save: AutomationSave) {
  return { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: save.prompt } as const;
}
