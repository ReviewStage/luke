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
  draftRepositories,
  draftTrigger,
  SCHEDULE_KIND,
  type ScheduleDraft,
  type ScheduleKind,
  sameDraft,
  withGithubEvent,
  withRepository,
} from "@luke/features/automation-draft-model";
import { automationTriggerText } from "@luke/features/automation-list-model";
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
  AUTOMATION_TRIGGER,
  type AutomationScope,
  type AutomationSummary,
  type AutomationTargetKind,
  type AutomationTriggerKind,
  GITHUB_TRIGGER_EVENT,
  type GitHubTriggerEvent,
} from "@luke/features/automation-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import {
  BuildingIcon,
  ChevronRightIcon,
  LockIcon,
  PlayIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { AnchoredPopover, POPOVER_ALIGN } from "../anchored-popover";
import { useAppCommand } from "../app-commands";
import { CHIP_LOOK, Chip } from "../chip";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { AgentModelChip } from "../planning/agent-model-chip";
import { ModelMenu } from "../planning/model-menu";
import { dayAndTimeText, sinceText, useMinute } from "../planning/plan-time";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "../planning/repository-chip";
import { ConfirmDialog, useConfirmDialog } from "../settings/confirm-dialog";
import { Picker, PickerRow } from "../settings/picker-row";
import { SelectRow } from "../settings/select-row";
import { SettingsGroup } from "../settings/settings-group";
import { SwitchRow } from "../settings/switch-row";
import { BusyLabel, Spinner } from "../spinner";
import { Switch } from "../switch";
import { useDisclosure } from "../use-disclosure";
import { AutomationRunsPanel } from "./automation-runs-panel";
import { useAutomationRuns } from "./use-automation-runs";
import { type AgentsRead, type RunChoices, useRunChoices } from "./use-run-choices";

/**
 * automation-editor.tsx -- one automation's page, or a new one's: under breadcrumbs that name its owner, its name, its schedule, its task, its repository, and who owns it, saved by an explicit Create or Save.
 *
 * It stands where the list stood, in the plan's place, and the first crumb
 * goes back to the list. Its form is drawn as a Settings page is, from
 * Settings' own rows: a group per part, each a card of rows naming a
 * setting and why on the left and its control on the right, every pick a
 * Settings picker on the window's menu and every yes or no a switch. Who
 * owns it is said three times over, since it is what the list must never
 * leave in doubt: in the crumbs, under its name, and in the Owner row a
 * team workspace offers. Where its runs land is picked: a new agent each
 * run, on the agent box's model chip and archived once it succeeds where
 * asked, or the same agent, chosen from the workspace's agents on its
 * repository. Its runs stand in the panel on
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
  /** Mints a webhook's secret again, answering it once for this page to show. */
  newWebhookSecret(automationId: string): Promise<AutomationView>;
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

/** What may fire an automation, as the Type picker names them. */
const TRIGGERS: readonly { value: AutomationTriggerKind; label: string }[] = [
  { value: AUTOMATION_TRIGGER.SCHEDULE, label: "Schedule" },
  { value: AUTOMATION_TRIGGER.GITHUB, label: "GitHub event" },
  { value: AUTOMATION_TRIGGER.WEBHOOK, label: "Webhook" },
];

/** The GitHub events the event menu offers, in its order. */
const GITHUB_EVENTS: readonly { value: GitHubTriggerEvent; label: string }[] = [
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, label: "Pull request opened or updated" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED, label: "Pull request opened" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED, label: "Pull request labelled" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_OPENED, label: "Issue opened" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_LABELED, label: "Issue labelled" },
  { value: GITHUB_TRIGGER_EVENT.CHECK_FAILED, label: "Checks failed" },
  { value: GITHUB_TRIGGER_EVENT.PUSH, label: "Commits pushed" },
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

/** What a short menu says where a search matches nothing, which it has no search to say. */
const NO_MATCH = "Nothing matches.";

/** Why a save the service refused did not land, as the line under the name says it. */
const SAVE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Couldn't save it. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "Choose the repository it works in.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't reach that repository from this workspace on GitHub.",
  [AUTOMATION_CALL_FAILURE.INVALID]:
    "Luke couldn't save it as written. Check its schedule and prompt.",
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

/** A minute past the hour as the hourly picker names it: "At :15". */
function hourlyLabel(minute: number): string {
  return `At :${String(minute).padStart(2, "0")}`;
}

/** A zone as the zone picker names it, its underscores read as spaces. */
function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
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

/** What stops a save, said under the row it belongs to once a save was pressed. */
function Problem({ problem }: { problem: string | undefined }): React.JSX.Element | null {
  if (problem === undefined) return null;
  return (
    <p className="error-message automation-form-problem" role="alert">
      {problem}
    </p>
  );
}

/** The parse a picker of `options` reads its picked id back with: the option of that value, or none. */
function optionValue<Value extends string>(
  options: readonly { value: Value; label: string }[],
): (raw: string) => Value | undefined {
  return (raw) => options.find((option) => option.value === raw)?.value;
}

/** When the draft runs next, its next two runs; nothing for one Luke cannot read. */
function nextRunsText(draft: AutomationDraft): string | undefined {
  const [first, second] = draftNextRuns(draft, new Date(), 2);
  if (first === undefined) return undefined;
  const then = second === undefined ? "" : `, then ${dayAndTimeText(second)}`;
  return `Next: ${dayAndTimeText(first)}${then}`;
}

/** The parse the schedule's picker reads its kind back with. */
const scheduleKindOf = optionValue(SCHEDULE_KINDS);

/**
 * A schedule's rows: how often, under its next runs; then the time, day,
 * or cron that kind asks for; then its zone, searched since every zone this
 * Mac knows is listed.
 */
function ScheduleRows({
  draft,
  onSchedule,
  onTimezone,
}: {
  draft: AutomationDraft;
  onSchedule: (schedule: ScheduleDraft) => void;
  onTimezone: (timezone: string) => void;
}): React.JSX.Element {
  const { schedule, timezone } = draft;
  const zones = TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES];
  return (
    <>
      <SelectRow
        label="Repeats"
        detail={nextRunsText(draft)}
        value={schedule.kind}
        options={SCHEDULE_KINDS}
        parse={scheduleKindOf}
        onChange={(kind) => onSchedule({ ...schedule, kind })}
      />
      {schedule.kind === SCHEDULE_KIND.CUSTOM ? (
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Cron</strong>
          </span>
          <input
            className="settings-input automation-cron"
            aria-label="Cron"
            spellCheck={false}
            onKeyDown={releaseOnEscape}
            value={schedule.cron}
            onChange={(event) => onSchedule({ ...schedule, cron: event.target.value })}
          />
        </div>
      ) : (
        <div className="settings-row">
          <span className="settings-copy">
            <strong>{schedule.kind === SCHEDULE_KIND.WEEKLY ? "Day and time" : "Time"}</strong>
          </span>
          <span className="automation-row-controls">
            {schedule.kind === SCHEDULE_KIND.WEEKLY ? (
              <Picker
                label="Day"
                value={String(schedule.weekday)}
                valueLabel={WEEKDAYS[schedule.weekday] ?? WEEKDAYS[0]}
                rows={WEEKDAYS.map((day, weekday) => ({ id: String(weekday), label: day }))}
                noMatch={NO_MATCH}
                onPick={(id) => onSchedule({ ...schedule, weekday: Number(id) })}
              />
            ) : null}
            {schedule.kind === SCHEDULE_KIND.HOURLY ? (
              <Picker
                label="Minutes past the hour"
                value={String(schedule.minute)}
                valueLabel={hourlyLabel(schedule.minute)}
                rows={HOURLY_MINUTES.map((minute) => ({
                  id: String(minute),
                  label: hourlyLabel(minute),
                }))}
                noMatch={NO_MATCH}
                onPick={(id) => onSchedule({ ...schedule, minute: Number(id) })}
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
          </span>
        </div>
      )}
      <PickerRow
        label="Time zone"
        copy={<strong>Time zone</strong>}
        value={timezone}
        valueLabel={zoneLabel(timezone)}
        rows={zones.map((zone) => ({ id: zone, label: zoneLabel(zone) }))}
        placeholder="Search time zones"
        noMatch="No time zones match"
        onPick={onTimezone}
      />
    </>
  );
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
        ? "Saving"
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
        <ExperimentTag />
      </div>
      <div className="desktop-toolbar-actions">
        <SendFeedbackButton experiment={EXPERIMENT.AUTOMATIONS} />
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

/** Why a new secret could not be made, as its dialog says it. */
const NEW_SECRET_REFUSAL_WORDS = {
  ...SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Couldn't make a new secret. Try again.",
} as const satisfies Record<AutomationCallFailure, string>;

/**
 * A webhook's secret, shown the one time the write that minted it answers:
 * read-only, with Copy and Done, and said never to be shown again. Note that
 * it is left out of the screen recording whole (`ph-no-capture`), beside the
 * masking every input already has, because it is a credential; and that it
 * is keyed by the secret, so a Copied said of one is never said of the next.
 */
function ShownSecretRow({
  secret,
  onDone,
}: {
  secret: string;
  onDone: () => void;
}): React.JSX.Element {
  const copy = useCopyFeedback();
  return (
    <div className="settings-row ph-no-capture">
      <span className="settings-copy">
        <strong>Secret</strong>
        <small>You won't be able to see this again. Copy it into your sender now.</small>
      </span>
      <span className="automation-row-controls">
        <input
          className="settings-input automation-webhook-url"
          aria-label="Secret"
          readOnly
          value={secret}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={copyHint(copy.state, "Copy secret")}
          onClick={() => copy.copy(secret)}
        >
          <CopyGlyph state={copy.state} />
        </button>
        <button type="button" className="toolbar-button" onClick={onDone}>
          Done
        </button>
      </span>
    </div>
  );
}

/**
 * A webhook's rows: its address to copy once it is saved as a webhook, and
 * its secret, shown once where the write that minted it just answered, and
 * New secret, which asks first, since the new one stops the one a sender
 * holds, and then shows the new one once. Note that a shown secret stands
 * in this page's state alone, never the window's app state, so it is gone
 * once Done is pressed or the page is left.
 */
function WebhookRows({
  automation,
  writes,
  secret,
  onSecret,
}: {
  automation: AutomationSummary | undefined;
  writes: AutomationWrites;
  /** The secret a write just minted for this page to show once, or none. */
  secret: string | undefined;
  onSecret: (secret: string | undefined) => void;
}): React.JSX.Element {
  const address = useCopyFeedback();
  const rotation = useConfirmDialog(
    { subject: automation !== undefined, surfaceOpen: true },
    () => {
      if (automation === undefined) return Promise.resolve(ACCEPTED);
      onSecret(undefined);
      return writes.newWebhookSecret(automation.id).then((answer): ActionResult => {
        if ("failure" in answer) {
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: NEW_SECRET_REFUSAL_WORDS[answer.failure],
          };
        }
        onSecret(answer.webhookSecret);
        return ACCEPTED;
      });
    },
  );
  const url =
    automation?.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? automation.webhookUrl : undefined;
  if (automation === undefined || url === undefined) {
    return (
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Address</strong>
          <small>Save it as a webhook to get its address and a secret to call it with.</small>
        </span>
      </div>
    );
  }
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Address</strong>
          <small>
            POST to the address with the secret as <code>Authorization: Bearer</code>. Don't send
            secrets in the body: Luke hands the body to the run's agent, and it shows in the run's
            transcript.
          </small>
        </span>
        <span className="automation-row-controls">
          <input
            className="settings-input automation-webhook-url"
            aria-label="Webhook address"
            readOnly
            value={url}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={copyHint(address.state, "Copy address")}
            onClick={() => address.copy(url)}
          >
            <CopyGlyph state={address.state} />
          </button>
        </span>
      </div>
      {secret === undefined ? (
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Secret</strong>
            <small>A new secret stops the one before.</small>
          </span>
          <button type="button" className="toolbar-button bordered-button" onClick={rotation.ask}>
            New secret
          </button>
        </div>
      ) : (
        <ShownSecretRow key={secret} secret={secret} onDone={() => onSecret(undefined)} />
      )}
      <ConfirmDialog
        confirm={rotation}
        question={{
          title: "Make a new secret?",
          body: "The secret your sender uses now stops working until you give it the new one, which Luke shows you once.",
          verb: "New secret",
          running: "Making",
        }}
      />
    </>
  );
}

/** Where a run may land, as the row's picker names them. */
const TARGETS: readonly { value: AutomationTargetKind; label: string }[] = [
  { value: AUTOMATION_TARGET.NEW_AGENT, label: "New agent each run" },
  { value: AUTOMATION_TARGET.SAME_AGENT, label: "Same agent" },
];

/**
 * Choose a model, where the default could not be read: a chip naming no
 * model, whose menu is the agent box's model menu with nothing checked, so
 * nothing is chosen until a model is picked in it.
 */
function ModelPicker({
  models,
  readModels,
  onChoose,
}: {
  models: RunChoices["models"];
  /** Reads the catalog now, as the menu opens, so a catalog that failed to read is asked for again. */
  readModels: () => void;
  onChoose: (choice: ModelChoice) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="automation-model-picker" ref={root}>
      <Chip
        ref={trigger}
        look={CHIP_LOOK.FIELD}
        chevron
        className="settings-picker-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) readModels();
          setOpen(!open);
        }}
      >
        <span className="chip-name">Choose a model</span>
      </Chip>
      {drawn.mounted ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <ModelMenu
            leaving={drawn.leaving}
            ref={drawn.ref}
            id={menuId}
            className="agent-model-menu"
            models={models}
            chosen={undefined}
            onChoose={(choice) => {
              onChoose(choice);
              setOpen(false);
            }}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}

/** A new agent's model: the agent box's chip and menu at a form's look, on the account's default until one is chosen. */
function ModelRow({
  draft,
  choices,
  onDraft,
}: {
  draft: AutomationDraft;
  choices: RunChoices;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const shown = draft.choice ?? choices.defaultChoice;
  // Note that a default that could not be read is said as unknown rather than drawn as some
  // model it may not be, and a model can still be chosen, which the chip then names.
  const note =
    shown !== undefined
      ? draft.choice === null
        ? "Your default, until you choose one."
        : undefined
      : choices.defaultFailed
        ? "It runs on your default model, which could not be read."
        : "Your default model.";
  return (
    <div className="settings-row">
      <span className="settings-copy">
        <strong>Model</strong>
        {note === undefined ? null : <small>{note}</small>}
      </span>
      {shown !== undefined ? (
        <AgentModelChip
          model={{ choice: shown, note: undefined, choose: (choice) => onDraft({ choice }) }}
          models={choices.models}
          readModels={choices.readModels}
          usage={undefined}
          look={CHIP_LOOK.FIELD}
          className="settings-picker-chip"
        />
      ) : choices.defaultFailed ? (
        <ModelPicker
          models={choices.models}
          readModels={choices.readModels}
          onChoose={(choice) => onDraft({ choice })}
        />
      ) : null}
    </div>
  );
}

/** An agent as the agent picker names it. */
function agentLabel(agent: { title: string | null }): string {
  return agent.title ?? "Untitled agent";
}

/** What the agent picker names the saved agent the workspace's list no longer holds. */
const KEPT_AGENT_LABEL = "The agent it goes to now";

/**
 * The agent each run goes to, chosen from the workspace's agents on the
 * repository. The agent it goes to as saved is kept first in the menu where
 * the list no longer holds it, so another pick can still be taken back.
 */
function AgentRow({
  draft,
  savedAgentId,
  agents,
  onDraft,
}: {
  draft: AutomationDraft;
  /** The agent its runs go to as saved, or none. */
  savedAgentId: string | null;
  agents: AgentsRead;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const now = useMinute();
  const copy = (
    <>
      <strong>Agent</strong>
      <small>
        Each run goes to that agent as a message, as if you'd typed it, even mid-turn, and it keeps
        its own model and effort.
      </small>
    </>
  );
  if (agents !== undefined && "failed" in agents) {
    return (
      <div className="settings-row">
        <span className="settings-copy">
          {copy}
          <small className="error-message">The workspace's agents could not be read.</small>
        </span>
      </div>
    );
  }
  const listed = agents?.agents ?? [];
  const chosen = listed.find((agent) => agent.id === draft.agentId);
  const kept =
    savedAgentId !== null && !listed.some((agent) => agent.id === savedAgentId)
      ? savedAgentId
      : undefined;
  const rows = [
    ...(kept === undefined ? [] : [{ id: kept, label: KEPT_AGENT_LABEL }]),
    ...listed.map((agent) => ({
      id: agent.id,
      label: agentLabel(agent),
      detail: sinceText(agent.createdAt, now),
    })),
  ];
  return (
    <PickerRow
      label="Agent"
      copy={copy}
      value={draft.agentId ?? ""}
      valueLabel={
        chosen !== undefined
          ? agentLabel(chosen)
          : draft.agentId !== null && draft.agentId === kept
            ? KEPT_AGENT_LABEL
            : "Choose an agent"
      }
      rows={rows}
      note={
        agents === undefined ? (
          <div className="plan-compose-menu-note">
            <Spinner label="Loading agents" />
          </div>
        ) : rows.length === 0 ? (
          <p className="plan-compose-menu-note">No agents of this workspace work in it yet.</p>
        ) : undefined
      }
      noMatch={NO_MATCH}
      onPick={(agentId) => onDraft({ agentId })}
    />
  );
}

/** The parse the Runs land in picker reads its target back with. */
const targetOf = optionValue(TARGETS);

/** Where a run lands, under the repository it works in: a new agent each time, on a model, archived once it succeeds where asked, or the one agent chosen. */
function RunsGroup({
  draft,
  savedAgentId,
  workspace,
  problems,
  planBacked,
  repositories,
  onDraft,
}: {
  draft: AutomationDraft;
  /** The agent its runs go to as saved, or none. */
  savedAgentId: string | null;
  workspace: Workspace | undefined;
  problems: DraftProblems;
  planBacked: boolean;
  repositories: RepositoryChooser;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const sameAgent = draft.target === AUTOMATION_TARGET.SAME_AGENT;
  const choices = useRunChoices({
    workspaceId: workspace?.id,
    repository: draft.repository,
    wantsAgents: sameAgent,
  });
  // The other repositories as a save would send them: the one shown first left out.
  const also = draft.alsoRepositories.filter((repository) => repository !== draft.repository);
  return (
    <SettingsGroup title="Runs">
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Repository</strong>
          {planBacked ? (
            <small>Its task's repository.</small>
          ) : also.length === 0 ? null : (
            <small>{`Runs start here, and also work in ${also.join(", ")}.`}</small>
          )}
        </span>
        {planBacked ? null : (
          <RepositoryChip
            key={repositories.scope}
            place={CHIP_PLACE.FIELD}
            value={draft.repository}
            chooser={repositories}
            onChoose={(repository) => onDraft(withRepository(draft, repository))}
          />
        )}
      </div>
      <Problem problem={problems[DRAFT_FIELD.REPOSITORY]} />
      <SelectRow
        label="Runs land in"
        value={draft.target}
        options={TARGETS}
        parse={targetOf}
        onChange={(target) => onDraft({ target })}
      />
      {sameAgent ? (
        <AgentRow
          draft={draft}
          savedAgentId={savedAgentId}
          agents={choices.agents}
          onDraft={onDraft}
        />
      ) : (
        <>
          <ModelRow draft={draft} choices={choices} onDraft={onDraft} />
          <SwitchRow
            label="Archive successful runs"
            detail="A run's agent is archived once it finishes without failing. Its transcript and pull request stay reachable."
            checked={draft.archiveSuccessful}
            onChange={(archiveSuccessful) => onDraft({ archiveSuccessful })}
          />
        </>
      )}
      <Problem problem={problems[DRAFT_FIELD.AGENT]} />
    </SettingsGroup>
  );
}

/** The parse the Trigger picker reads its kind back with. */
const triggerKindOf = optionValue(TRIGGERS);

/** The parse the event picker reads its event back with. */
const githubEventOf = optionValue(GITHUB_EVENTS);

/**
 * The form, as Settings draws a page: its trigger, its task, where its runs
 * land, and, where the workspace is shared, its owner, each a group of rows.
 */
function EditorForm({
  draft,
  automation,
  writes,
  problems,
  planBacked,
  workspace,
  offersOwner,
  repositories,
  shownSecret,
  onSecret,
  savedAgentId,
  onDraft,
}: {
  draft: AutomationDraft;
  automation: AutomationSummary | undefined;
  writes: AutomationWrites;
  problems: DraftProblems;
  planBacked: boolean;
  workspace: Workspace | undefined;
  offersOwner: boolean;
  repositories: RepositoryChooser;
  shownSecret: string | undefined;
  onSecret: (secret: string | undefined) => void;
  /** The agent its runs go to as saved, while the draft is still on the repository it was saved on; none otherwise. */
  savedAgentId: string | null;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const workspaceName = workspace?.name ?? "Workspace";
  const owners = [
    { value: AUTOMATION_SCOPE.PERSONAL, label: "Personal" },
    { value: AUTOMATION_SCOPE.WORKSPACE, label: workspaceName },
  ] as const;
  return (
    <div className="automation-form">
      <SettingsGroup title="Trigger">
        <SelectRow
          label="Type"
          detail={automationTriggerText(draftTrigger(draft), draftRepositories(draft))}
          value={draft.triggerKind}
          options={TRIGGERS}
          parse={triggerKindOf}
          onChange={(triggerKind) => onDraft({ triggerKind })}
        />
        {draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE ? (
          <ScheduleRows
            draft={draft}
            onSchedule={(schedule) => onDraft({ schedule })}
            onTimezone={(timezone) => onDraft({ timezone })}
          />
        ) : draft.triggerKind === AUTOMATION_TRIGGER.GITHUB ? (
          <SelectRow
            label="Event"
            detail="Heard through the workspace's GitHub App, in the repositories below. Events Luke's own agents cause, and draft pull requests, start nothing."
            value={draft.githubEvent}
            options={GITHUB_EVENTS}
            parse={githubEventOf}
            onChange={(event) => onDraft(withGithubEvent(draft, event))}
          />
        ) : (
          <WebhookRows
            automation={automation}
            writes={writes}
            secret={shownSecret}
            onSecret={onSecret}
          />
        )}
        <Problem problem={problems[DRAFT_FIELD.SCHEDULE]} />
      </SettingsGroup>
      <SettingsGroup title="Prompt">
        <textarea
          className="automation-prompt"
          aria-label="Prompt"
          placeholder="What the agent is told each run: find the flakiest test in CI this week and fix it."
          value={draft.prompt}
          onKeyDown={releaseOnEscape}
          onChange={(event) => onDraft({ prompt: event.target.value })}
        />
        <Problem problem={problems[DRAFT_FIELD.PROMPT]} />
      </SettingsGroup>
      <RunsGroup
        draft={draft}
        savedAgentId={savedAgentId}
        workspace={workspace}
        problems={problems}
        planBacked={planBacked}
        repositories={repositories}
        onDraft={onDraft}
      />
      {offersOwner ? (
        <SettingsGroup title="Sharing">
          <SelectRow
            label="Owner"
            detail={
              draft.owner === AUTOMATION_SCOPE.WORKSPACE
                ? `Everyone in ${workspace?.name ?? "the workspace"} sees it, runs it, and turns it off. You, owners, and admins change it.`
                : "Only you see and change it. Owners and admins can see it and turn it off."
            }
            value={draft.owner}
            options={owners}
            parse={optionValue(owners)}
            onChange={(owner) => onDraft({ owner })}
          />
        </SettingsGroup>
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
  // The webhook secret a write just minted, shown once on this page and gone when it is left.
  const [shownSecret, setShownSecret] = useState<string | undefined>(undefined);
  const planBacked = automation !== undefined && automation.planId !== null;
  const change = automation === undefined ? undefined : changeOf(draft, automation, defaults);
  const saved = automation === undefined ? undefined : automationDraft(automation, defaults);
  // Note that a draft is unsaved wherever it differs from the automation, even where what differs
  // cannot be written yet, a same agent with none chosen, so Save stands to say what is missing.
  const dirty = saved === undefined || !sameDraft(draft, saved);
  // Note that the saved agent is offered back only on the repository it was saved on, because an agent works in its own repository.
  const savedAgentId =
    saved !== undefined && saved.repository === draft.repository ? saved.agentId : null;
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
    // A save that leaves it no webhook lets go of any secret shown, since that secret no longer admits anything.
    if (answer.automation.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) setShownSecret(undefined);
    else if (answer.webhookSecret !== undefined) setShownSecret(answer.webhookSecret);
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
              automation={automation}
              writes={writes}
              problems={shownProblems ? problems : {}}
              planBacked={planBacked}
              workspace={workspace}
              offersOwner={offersOwner}
              repositories={repositories}
              shownSecret={shownSecret}
              onSecret={setShownSecret}
              savedAgentId={savedAgentId}
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
