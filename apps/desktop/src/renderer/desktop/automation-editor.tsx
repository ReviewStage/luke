import {
  type AutomationDraft,
  automationDraft,
  changeOf,
  createRequestOf,
  DRAFT_FIELD,
  type DraftDefaults,
  type DraftProblems,
  draftNextRuns,
  draftProblems,
  SCHEDULE_KIND,
  type ScheduleDraft,
  type ScheduleKind,
  sameDraft,
  withRepository,
} from "@luke/features/automation-draft-model";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationView,
} from "@luke/features/automation-view";
import {
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTargetKind,
} from "@luke/features/automation-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import {
  BuildingIcon,
  ChevronRightIcon,
  LockIcon,
  PlayIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { AgentModelChip } from "../planning/agent-model-chip";
import { dayAndTimeText, sinceText, useMinute } from "../planning/plan-time";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "../planning/repository-chip";
import { Segmented } from "../segmented";
import { ConfirmDialog, useConfirmDialog } from "../settings/confirm-dialog";
import { BusyLabel } from "../spinner";
import { Switch } from "../switch";
import { AutomationRunsPanel } from "./automation-runs-panel";
import { useAutomationRuns } from "./use-automation-runs";
import { type AgentsRead, type RunChoices, useRunChoices } from "./use-run-choices";

/**
 * automation-editor.tsx -- one automation's page, or a new one's: under breadcrumbs that name its owner, its name, its schedule, its task, its repository, and who owns it, saved by an explicit Create or Save.
 *
 * It stands where the list stood, in the plan's place, and the first crumb
 * goes back to the list. Who owns it is said three times over, since it is
 * what the list must never leave in doubt: in the crumbs, under its name,
 * and in the Owner row a team workspace offers. Where its runs land is
 * one row: a new agent each run, on the agent box's model chip and
 * archived once it succeeds where asked, or the same agent, chosen from
 * the workspace's agents on its repository. Its runs stand in the panel on
 * the right (`automation-runs-panel.tsx`), with Run now in the toolbar. A schedule is chosen as the
 * picker writes one, every hour, every day, on weekdays, or on one day of
 * the week, at a time in a zone, and a cron the picker did not write stands
 * as custom, kept as it was; its next two runs are said under it. What
 * stops a draft saving is said at its field once a save is pressed, and a
 * save the service refuses says why in one line under the name. A save
 * sends only what moved (`automation-draft-model.ts`), so the model and the
 * target it runs on stand as they were.
 */

/** The writes the editor makes, as the list's hook answers them (`use-automations.ts`). */
export interface AutomationWrites {
  create(params: AutomationCreateParams): Promise<AutomationView>;
  change(params: AutomationChangeParams): Promise<AutomationView>;
  toggle(automationId: string, enabled: boolean): Promise<AutomationView>;
  remove(automationId: string): Promise<AutomationDeletedView>;
  /** Reads the list again, as a Run now settling moves an automation's newest run. */
  reload(): void;
}

/** The kinds of schedule as the picker offers them, in its order. */
const SCHEDULE_KINDS: readonly { value: ScheduleKind; label: string }[] = [
  { value: SCHEDULE_KIND.HOURLY, label: "Hourly" },
  { value: SCHEDULE_KIND.DAILY, label: "Daily" },
  { value: SCHEDULE_KIND.WEEKDAYS, label: "Weekdays" },
  { value: SCHEDULE_KIND.WEEKLY, label: "Weekly" },
  { value: SCHEDULE_KIND.CUSTOM, label: "Custom" },
];

/** The days of the week as cron numbers them. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The minutes past the hour an hourly schedule offers. */
const HOURLY_MINUTES = [0, 15, 30, 45] as const;

/** Every zone this Mac knows, as the zone menu lists them. */
const TIME_ZONES = Intl.supportedValuesOf("timeZone");

/** Why a save the service refused did not land, as the line under the name says it. */
const SAVE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Couldn't save it. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "Choose the repository it works in.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't reach that repository from this workspace on GitHub.",
  [AUTOMATION_CALL_FAILURE.INVALID]:
    "Luke couldn't save it as written. Check its schedule and task.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can change it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** Why a Run now did not start a run, as the line under the name says it. */
const RUN_REFUSAL_WORDS = {
  ...SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Couldn't run it now. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can run it.",
} as const satisfies Record<AutomationCallFailure, string>;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/**
 * A field's own Escape: it lets go of the caret and keeps the press, so
 * Escape while writing never leaves the page and the draft with it.
 */
function releaseOnEscape(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.currentTarget.blur();
}

/** Escape kept and spent on nothing, while leaving would lose what was written. */
function keepEscape(): void {}

/** A time of day as the time field holds it, the hour and minute in two figures each. */
function clockValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour and minute a time field holds, or nothing while it holds none. */
function clockOf(value: string): { hour: number; minute: number } | undefined {
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return undefined;
  }
  return { hour, minute };
}

/** The zone this Mac is in, which a new automation runs in until another is chosen. */
function windowZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** An owner as the crumbs and the Owner row name it. */
function ownerName(owner: AutomationScope, workspace: Workspace | undefined): string {
  return owner === AUTOMATION_SCOPE.WORKSPACE ? (workspace?.name ?? "Workspace") : "Personal";
}

/** The line under the name that says who sees and changes it. */
function ownerLine(
  owner: AutomationScope,
  workspace: Workspace | undefined,
  offersOwner: boolean,
): string {
  if (owner === AUTOMATION_SCOPE.WORKSPACE) {
    return `A workspace automation: everyone in ${workspace?.name ?? "the workspace"} sees and runs it.`;
  }
  return offersOwner
    ? "A personal automation: only you see and change it."
    : "Your automation, in your personal workspace.";
}

/** Who owns it, as a glyph and its name. */
function OwnerMark({
  owner,
  workspace,
}: {
  owner: AutomationScope;
  workspace: Workspace | undefined;
}): React.JSX.Element {
  const name = ownerName(owner, workspace);
  return (
    <span className="automation-owner" data-owner={owner} title={name}>
      {owner === AUTOMATION_SCOPE.WORKSPACE ? (
        <BuildingIcon aria-hidden="true" />
      ) : (
        <LockIcon aria-hidden="true" />
      )}
      <span className="automation-owner-name">{name}</span>
    </span>
  );
}

/** One row of the form: its label on the left, its control and any problem on the right. */
function FormRow({
  label,
  problem,
  children,
}: {
  label: string;
  problem: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="automation-form-row" data-invalid={problem === undefined ? undefined : "true"}>
      <span className="automation-form-label">{label}</span>
      <div className="automation-form-control">
        {children}
        {problem === undefined ? null : (
          <p className="error-message automation-form-problem" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

/** The schedule's controls: its kind, then the time, day, or cron that kind asks for, then its zone. */
function ScheduleControl({
  schedule,
  timezone,
  onSchedule,
  onTimezone,
}: {
  schedule: ScheduleDraft;
  timezone: string;
  onSchedule: (schedule: ScheduleDraft) => void;
  onTimezone: (timezone: string) => void;
}): React.JSX.Element {
  const choose = (kind: ScheduleKind) => onSchedule({ ...schedule, kind });
  return (
    <div className="automation-schedule">
      <Segmented legend="Runs" options={SCHEDULE_KINDS} value={schedule.kind} onChange={choose} />
      <div className="automation-schedule-at">
        {schedule.kind === SCHEDULE_KIND.WEEKLY ? (
          <select
            className="settings-input automation-select"
            aria-label="Day"
            value={schedule.weekday}
            onChange={(event) => onSchedule({ ...schedule, weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, weekday) => (
              <option key={day} value={weekday}>
                {day}
              </option>
            ))}
          </select>
        ) : null}
        {schedule.kind === SCHEDULE_KIND.HOURLY ? (
          <select
            className="settings-input automation-select"
            aria-label="Minutes past the hour"
            value={schedule.minute}
            onChange={(event) => onSchedule({ ...schedule, minute: Number(event.target.value) })}
          >
            {HOURLY_MINUTES.map((minute) => (
              <option key={minute} value={minute}>
                {`At :${String(minute).padStart(2, "0")}`}
              </option>
            ))}
          </select>
        ) : schedule.kind === SCHEDULE_KIND.CUSTOM ? (
          <input
            className="settings-input automation-cron"
            aria-label="Cron"
            spellCheck={false}
            onKeyDown={releaseOnEscape}
            value={schedule.cron}
            onChange={(event) => onSchedule({ ...schedule, cron: event.target.value })}
          />
        ) : (
          <input
            type="time"
            className="settings-input automation-time"
            aria-label="Time"
            value={clockValue(schedule.hour, schedule.minute)}
            onKeyDown={releaseOnEscape}
            onChange={(event) => {
              const clock = clockOf(event.target.value);
              if (clock !== undefined) onSchedule({ ...schedule, ...clock });
            }}
          />
        )}
        <select
          className="settings-input automation-select automation-zone"
          aria-label="Time zone"
          value={timezone}
          onChange={(event) => onTimezone(event.target.value)}
        >
          {(TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES]).map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** When the draft runs next, its next two runs said under the schedule; nothing for one Luke cannot read. */
function NextRuns({ draft }: { draft: AutomationDraft }): React.JSX.Element | null {
  const [first, second] = draftNextRuns(draft, new Date(), 2);
  if (first === undefined) return null;
  const then = second === undefined ? "" : `, then ${dayAndTimeText(second)}`;
  return <p className="automation-form-note">{`Next: ${dayAndTimeText(first)}${then}`}</p>;
}

/** The editor's toolbar: the crumbs back to the list, then where the draft stands, its save, its switch, and its delete. */
function EditorToolbar({
  draft,
  automation,
  workspace,
  dirty,
  saving,
  onBack,
  onSave,
  onToggle,
  onDelete,
  running,
  onRunNow,
}: {
  draft: AutomationDraft;
  automation: AutomationSummary | undefined;
  workspace: Workspace | undefined;
  dirty: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  /** Whether a Run now is out. */
  running: boolean;
  onRunNow: () => void;
}): React.JSX.Element {
  const status =
    automation === undefined
      ? "Not created yet"
      : saving
        ? "Saving…"
        : dirty
          ? "Unsaved changes"
          : "Saved";
  return (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <nav className="automation-crumbs" aria-label="Path">
          <button type="button" className="toolbar-button" onClick={onBack}>
            <ZapIcon />
            Automations
          </button>
          <ChevronRightIcon aria-hidden="true" />
          <OwnerMark owner={draft.owner} workspace={workspace} />
          <ChevronRightIcon aria-hidden="true" />
          <span className="automation-crumb">
            {automation === undefined ? "New automation" : automation.name}
          </span>
        </nav>
      </div>
      <div className="desktop-toolbar-actions">
        <span className="automation-editor-status" data-dirty={String(dirty)}>
          {status}
        </span>
        {automation === undefined ? null : (
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={running}
            onClick={onRunNow}
          >
            <PlayIcon />
            <BusyLabel busy={running} label="Running">
              Run now
            </BusyLabel>
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={saving || !(automation === undefined || dirty)}
          onClick={onSave}
        >
          <BusyLabel busy={saving} label="Saving">
            {automation === undefined ? "Create" : "Save"}
          </BusyLabel>
        </button>
        {automation === undefined ? null : (
          <>
            <Switch
              checked={automation.enabled}
              label={
                automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`
              }
              onChange={(enabled) => onToggle(enabled)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${automation.name}`}
              onClick={onDelete}
            >
              <Trash2Icon />
            </button>
          </>
        )}
      </div>
    </header>
  );
}

/** Where a run may land, as the row's segments name them. */
const TARGETS: readonly { value: AutomationTargetKind; label: string }[] = [
  { value: AUTOMATION_TARGET.NEW_AGENT, label: "New agent each run" },
  { value: AUTOMATION_TARGET.SAME_AGENT, label: "Same agent" },
];

/** A new agent's model: the chip the agent box wears, on the account's default until one is chosen. */
function ModelControl({
  draft,
  choices,
  onDraft,
}: {
  draft: AutomationDraft;
  choices: RunChoices;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  // Note that a default that could not be read still lets a model be chosen once the catalog is
  // read, drawing the service's own default in its place, so the picker is never out of reach.
  const shown =
    draft.choice ??
    choices.defaultChoice ??
    (choices.models === undefined ? undefined : CODING_AGENT_DEFAULT_CHOICE);
  if (shown === undefined) return <p className="automation-form-note">Your default model.</p>;
  return (
    <div className="automation-model">
      <AgentModelChip
        model={{ choice: shown, note: undefined, choose: (choice) => onDraft({ choice }) }}
        models={choices.models}
        readModels={choices.readModels}
        usage={undefined}
      />
      {draft.choice !== null ? null : (
        <span className="automation-form-note">
          {choices.defaultChoice === undefined
            ? "It runs on your default model until you choose one."
            : "Your default, until you choose one."}
        </span>
      )}
    </div>
  );
}

/** The agent each run goes to, chosen from the workspace's agents on the repository, the one it goes to now kept where the list no longer holds it. */
function AgentPicker({
  draft,
  agents,
  onDraft,
}: {
  draft: AutomationDraft;
  agents: AgentsRead;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const now = useMinute();
  if (agents !== undefined && "failed" in agents) {
    return <p className="error-message">The workspace's agents could not be read.</p>;
  }
  const listed = agents?.agents ?? [];
  const kept = draft.agentId !== null && !listed.some((agent) => agent.id === draft.agentId);
  return (
    <>
      <select
        className="settings-input automation-select automation-agent"
        aria-label="Agent"
        value={draft.agentId ?? ""}
        onChange={(event) =>
          onDraft({ agentId: event.target.value === "" ? null : event.target.value })
        }
      >
        <option value="" disabled>
          {agents === undefined ? "Reading the workspace's agents…" : "Choose an agent"}
        </option>
        {kept && draft.agentId !== null ? (
          <option value={draft.agentId}>The agent it goes to now</option>
        ) : null}
        {listed.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {`${agent.title ?? "Untitled agent"} · ${sinceText(agent.createdAt, now)}`}
          </option>
        ))}
      </select>
      <p className="automation-form-note">
        Each run goes to that agent as a message, as if you'd typed it, even mid-turn, and it keeps
        its own model and effort.
      </p>
    </>
  );
}

/** Where a run lands: a new agent each time, on a model, archived once it succeeds where asked, or the one agent chosen. */
function RunsLandIn({
  draft,
  workspace,
  problem,
  onDraft,
}: {
  draft: AutomationDraft;
  workspace: Workspace | undefined;
  problem: string | undefined;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const sameAgent = draft.target === AUTOMATION_TARGET.SAME_AGENT;
  const choices = useRunChoices({
    workspaceId: workspace?.id,
    repository: draft.repository,
    wantsAgents: sameAgent,
  });
  return (
    <FormRow label="Runs land in" problem={problem}>
      <Segmented
        legend="Runs land in"
        options={TARGETS}
        value={draft.target}
        onChange={(target) => onDraft({ target })}
      />
      {sameAgent ? (
        <AgentPicker draft={draft} agents={choices.agents} onDraft={onDraft} />
      ) : (
        <>
          <ModelControl draft={draft} choices={choices} onDraft={onDraft} />
          <label className="automation-check">
            <input
              type="checkbox"
              checked={draft.archiveSuccessful}
              onChange={(event) => onDraft({ archiveSuccessful: event.target.checked })}
            />
            <span className="settings-copy">
              <strong>Archive successful runs</strong>
              <small>
                A run's agent is archived once it finishes without failing. Its transcript and pull
                request stay reachable.
              </small>
            </span>
          </label>
        </>
      )}
    </FormRow>
  );
}

/** The form: its schedule, task, repository, and, where the workspace is shared, its owner. */
function EditorForm({
  draft,
  problems,
  planBacked,
  workspace,
  offersOwner,
  repositories,
  onDraft,
}: {
  draft: AutomationDraft;
  problems: DraftProblems;
  planBacked: boolean;
  workspace: Workspace | undefined;
  offersOwner: boolean;
  repositories: RepositoryChooser;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const promptId = useId();
  // The other repositories as a save would send them: the one shown first left out.
  const also = draft.alsoRepositories.filter((repository) => repository !== draft.repository);
  return (
    <div className="settings-card automation-form">
      <FormRow label="Schedule" problem={problems[DRAFT_FIELD.SCHEDULE]}>
        {draft.scheduled ? (
          <>
            <ScheduleControl
              schedule={draft.schedule}
              timezone={draft.timezone}
              onSchedule={(schedule) => onDraft({ schedule })}
              onTimezone={(timezone) => onDraft({ timezone })}
            />
            <NextRuns draft={draft} />
          </>
        ) : (
          <p className="automation-form-note">
            It runs on an event rather than a schedule, which this page leaves as it is.
          </p>
        )}
      </FormRow>
      <FormRow label="Task" problem={problems[DRAFT_FIELD.PROMPT]}>
        <textarea
          id={promptId}
          className="settings-input automation-prompt"
          aria-label="Task"
          placeholder="What the agent is told each run: find the flakiest test in CI this week and fix it."
          value={draft.prompt}
          onKeyDown={releaseOnEscape}
          onChange={(event) => onDraft({ prompt: event.target.value })}
        />
      </FormRow>
      <FormRow label="Repository" problem={problems[DRAFT_FIELD.REPOSITORY]}>
        {planBacked ? (
          <p className="automation-form-note">Its plan's repository.</p>
        ) : (
          <>
            <RepositoryChip
              key={repositories.scope}
              place={CHIP_PLACE.COMPOSER}
              value={draft.repository}
              chooser={repositories}
              onChoose={(repository) => onDraft(withRepository(draft, repository))}
            />
            {also.length === 0 ? null : (
              <p className="automation-form-note">
                {`Runs start here, and also work in ${also.join(", ")}.`}
              </p>
            )}
          </>
        )}
      </FormRow>
      <RunsLandIn
        draft={draft}
        workspace={workspace}
        problem={problems[DRAFT_FIELD.AGENT]}
        onDraft={onDraft}
      />
      {offersOwner ? (
        <FormRow label="Owner" problem={undefined}>
          <Segmented
            legend="Owner"
            options={[
              { value: AUTOMATION_SCOPE.PERSONAL, label: "Personal" },
              { value: AUTOMATION_SCOPE.WORKSPACE, label: workspace?.name ?? "Workspace" },
            ]}
            value={draft.owner}
            onChange={(owner) => onDraft({ owner })}
          />
          <p className="automation-form-note">
            {draft.owner === AUTOMATION_SCOPE.WORKSPACE
              ? `Everyone in ${workspace?.name ?? "the workspace"} sees it, runs it, and turns it off. You, owners, and admins change it.`
              : "Only you see and change it. Owners and admins can see it and turn it off."}
          </p>
        </FormRow>
      ) : null}
    </div>
  );
}

/**
 * One automation's page, or a new one's where none is given. A new one,
 * once made, is handed to `onCreated`, which stands its own page where
 * this one stood; a deleted one goes back to the list.
 */
export function AutomationEditor({
  automation,
  workspace,
  offersOwner,
  repositories,
  writes,
  onBack,
  onCreated,
  onOpenAgent,
}: {
  automation: AutomationSummary | undefined;
  workspace: Workspace | undefined;
  /** Whether the workspace is shared, so an automation in it may be the workspace's rather than its maker's. */
  offersOwner: boolean;
  repositories: RepositoryChooser;
  writes: AutomationWrites;
  onBack: () => void;
  onCreated: (automationId: string) => void;
  /** Opens a run's agent on its own page. */
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const runs = useAutomationRuns(automation?.id);
  const [running, setRunning] = useState(false);
  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: windowZone(),
    owner: AUTOMATION_SCOPE.PERSONAL,
  }));
  // A new automation starts in the repository the workspace's plans were about lately, as a new plan does.
  const [start] = useState(() =>
    automation === undefined
      ? { ...automationDraft(undefined, defaults), repository: repositories.recent[0] ?? null }
      : automationDraft(automation, defaults),
  );
  const [draft, setDraft] = useState(start);
  const [shownProblems, setShownProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const planBacked = automation !== undefined && automation.planId !== null;
  const change = automation === undefined ? undefined : changeOf(draft, automation, defaults);
  // Note that a draft is unsaved wherever it differs from the automation, even where what differs
  // cannot be written yet, a same agent with none chosen, so Save stands to say what is missing.
  const dirty =
    automation === undefined || !sameDraft(draft, automationDraft(automation, defaults));
  // Note that a new draft nothing was changed in is no work to lose, so Escape may leave it.
  const written = automation === undefined ? !sameDraft(draft, start) : dirty;
  // Escape goes back to the list while nothing written would be lost, and is kept, doing nothing, while it would.
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, written ? keepEscape : onBack);
  const problems = draftProblems(draft, planBacked, new Date());
  const editDraft = (patch: Partial<AutomationDraft>) => {
    setDraft((was) => ({ ...was, ...patch }));
    setRefusal(undefined);
  };
  const landed = (answer: AutomationView) => {
    setSaving(false);
    if ("failure" in answer) {
      setRefusal(SAVE_REFUSAL_WORDS[answer.failure]);
      return;
    }
    // Note that the draft is kept rather than replaced by the answer, so what was typed while the save was out stands, unsaved.
    setShownProblems(false);
    if (automation === undefined) onCreated(answer.automation.id);
  };
  const save = () => {
    if (Object.keys(problems).length > 0) {
      setShownProblems(true);
      return;
    }
    if (workspace === undefined || (automation !== undefined && change === undefined)) return;
    setSaving(true);
    setRefusal(undefined);
    const saved =
      automation === undefined
        ? writes.create(createRequestOf(draft, workspace.id))
        : writes.change({ automationId: automation.id, change: change ?? {} });
    saved.then(landed);
  };
  const runNow = () => {
    setRunning(true);
    setRefusal(undefined);
    runs.runNow().then((answer) => {
      setRunning(false);
      // The automation's newest run moved, so the list it stands in is read again too.
      writes.reload();
      if ("failure" in answer) setRefusal(RUN_REFUSAL_WORDS[answer.failure]);
    });
  };
  // Note that opening a run's agent leaves the page and its draft with it, so unsaved changes ask first.
  const [leavingFor, setLeavingFor] = useState<string | undefined>(undefined);
  const leaving = useConfirmDialog({ subject: leavingFor !== undefined, surfaceOpen: true }, () => {
    if (leavingFor !== undefined) onOpenAgent(leavingFor);
    return Promise.resolve(ACCEPTED);
  });
  const openRun = (agentId: string) => {
    if (!dirty) {
      onOpenAgent(agentId);
      return;
    }
    setLeavingFor(agentId);
    leaving.ask();
  };
  const toggle = (enabled: boolean) => {
    if (automation === undefined) return;
    writes.toggle(automation.id, enabled).then((answer) => {
      if ("failure" in answer) setRefusal(SAVE_REFUSAL_WORDS[answer.failure]);
    });
  };
  const deletion = useConfirmDialog(
    { subject: automation !== undefined, surfaceOpen: true },
    () => {
      if (automation === undefined) return Promise.resolve(ACCEPTED);
      return writes.remove(automation.id).then((answer): ActionResult => {
        if ("failure" in answer) {
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: SAVE_REFUSAL_WORDS[answer.failure],
          };
        }
        onBack();
        return ACCEPTED;
      });
    },
  );
  return (
    <section className="automations-view" aria-label="Automation">
      <EditorToolbar
        draft={draft}
        automation={automation}
        workspace={workspace}
        dirty={dirty}
        saving={saving}
        onBack={onBack}
        onSave={save}
        onToggle={toggle}
        onDelete={deletion.ask}
        running={running}
        onRunNow={runNow}
      />
      <div className="automation-editor-layout">
        <div className="automations-scroll">
          <div className="automation-editor">
            <input
              className="automation-editor-name"
              aria-label="Automation name"
              placeholder="Untitled automation"
              value={draft.name}
              onKeyDown={releaseOnEscape}
              onChange={(event) => editDraft({ name: event.target.value })}
            />
            {shownProblems && problems[DRAFT_FIELD.NAME] !== undefined ? (
              <p className="error-message automation-form-problem" role="alert">
                {problems[DRAFT_FIELD.NAME]}
              </p>
            ) : null}
            <p className="automation-owner-line">
              <OwnerMark owner={draft.owner} workspace={workspace} />
              {ownerLine(draft.owner, workspace, offersOwner)}
            </p>
            {refusal === undefined ? null : (
              <p className="error-message automation-save-refusal" role="alert">
                {refusal}
              </p>
            )}
            <EditorForm
              draft={draft}
              problems={shownProblems ? problems : {}}
              planBacked={planBacked}
              workspace={workspace}
              offersOwner={offersOwner}
              repositories={repositories}
              onDraft={editDraft}
            />
          </div>
        </div>
        <AutomationRunsPanel
          created={automation !== undefined}
          runs={runs.read}
          onRetry={runs.reload}
          onOpenAgent={openRun}
        />
      </div>
      <ConfirmDialog
        confirm={leaving}
        question={{
          title: "Leave with unsaved changes?",
          body: "Opening the run's agent leaves this page, and what you changed here is lost.",
          verb: "Leave",
          running: "Leaving",
        }}
      />
      <ConfirmDialog
        confirm={deletion}
        question={{
          title: `Delete ${automation?.name ?? "this automation"}?`,
          body: "Its schedule stops and its run history goes. Agents its runs started stay.",
          verb: "Delete",
          running: "Deleting",
        }}
      />
    </section>
  );
}
