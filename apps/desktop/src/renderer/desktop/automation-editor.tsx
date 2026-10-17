import {
  type AutomationPresetName,
  automationPreset,
  type CodeReviewSettings,
  readCodeReviewSettings,
  withCodeReviewSettings,
} from "@luke/features/automation-code-review";
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
  type GitHubTriggerSettings,
  presetDraft,
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
  GITHUB_SENDER,
  GITHUB_TRIGGER_EVENT,
  type GitHubSender,
  type GitHubTriggerEvent,
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
} from "@luke/features/automation-wire";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { ModelChoice } from "@luke/features/models-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  ChipName,
  ConfirmDialog,
  EllipsisIcon,
  IconButton,
  POPOVER_ALIGN,
  ProviderMark,
  SETTINGS_SECTION_FRAME,
  SettingsRow,
  SettingsSection,
  SidePanelIcon,
  Switch,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { useClipped } from "@luke/ui/use-clipped";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { ChevronRightIcon, PlayIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useAppCommand } from "../app-commands";
import { CHIP_LOOK, Chip } from "../chip";
import { CopyGlyph, copyHint, useCopyFeedback } from "../copy-feedback";
import { useCopyLinkItem } from "../copy-link-item";
import { ExperimentTag, SendFeedbackButton } from "../experiment-marks";
import { FoldingButton } from "../folding-button";
import { useIntegrationStatuses } from "../integration-statuses";
import { useOpenSettings } from "../open-settings";
import { Picker, PickerRow } from "../settings/picker-row";
import { SelectRow } from "../settings/select-row";
import { SwitchRow } from "../settings/switch-row";
import { Spinner } from "../spinner";
import { AgentModelChip } from "../tasks/agent-model-chip";
import { AgentServersButton } from "../tasks/agent-servers";
import { ModelMenu } from "../tasks/model-menu";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "../tasks/repository-chip";
import { dayAndTimeText, sinceText, useMinute } from "../tasks/task-time";
import type { LeaveAsk, LeaveGuard } from "../tasks/use-tasks-tab";
import { Tooltip } from "../tooltip";
import { ActionMenu, type MenuAction } from "./action-menu";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner";
import { AutomationRunsPanel } from "./automation-runs-panel";
import { type RunsPanel, useRunsPanel } from "./folded-groups";
import { PaneGlide } from "./pane-motion";
import { useAutomationRuns } from "./use-automation-runs";
import { type AgentsRead, type RunChoices, useRunChoices } from "./use-run-choices";

/**
 * automation-editor.tsx -- one automation's page, or a new one's: who owns it, its name, its schedule, its task, and its repository, saved by an explicit Create or Save.
 *
 * It stands where the list stood, in the task's place, and the first crumb
 * goes back to the list. Its form is drawn as a Settings page is, from
 * Settings' own rows: a group per part, each a card of rows naming a
 * setting and why on the left and its control on the right, every pick a
 * Settings picker on the window's menu and every yes or no a switch. Who
 * owns it is the form's first row, wherever a team workspace offers the
 * choice: Personal under the account's own picture, or the workspace under
 * its photo (`automation-owner.tsx`). Where its runs land is picked: a new agent each
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

/**
 * Who owns it, the form's first row: Personal under the account's own
 * picture, or the workspace under its photo, on the chip and in its menu
 * alike.
 */
function OwnerRow({
  owner,
  owners,
  mine,
  workspace,
  onOwner,
}: {
  owner: AutomationScope;
  owners: readonly { value: AutomationScope; label: string }[];
  /** Whether the reading account made it, so Personal is drawn as its own; a new one is. */
  mine: boolean;
  workspace: Workspace | undefined;
  onOwner: (owner: AutomationScope) => void;
}): React.JSX.Element {
  const parse = optionValue(owners);
  return (
    <PickerRow
      label="Owner"
      detail={
        owner === AUTOMATION_SCOPE.WORKSPACE
          ? `Everyone in ${workspace?.name ?? "the workspace"} sees it, runs it, and turns it off. You, owners, and admins change it.`
          : "Only you see and change it. Owners and admins can see it and turn it off."
      }
      value={owner}
      valueLabel={ownerName(owner, workspace)}
      valueIcon={
        <OwnerMark owner={owner} workspace={workspace} mine={mine} size={OWNER_MARK_SIZE.INLINE} />
      }
      rows={owners.map((each) => ({
        id: each.value,
        label: each.label,
        icon: (
          <OwnerMark
            owner={each.value}
            workspace={workspace}
            mine={mine}
            size={OWNER_MARK_SIZE.ROW}
          />
        ),
      }))}
      noMatch="No owner matches"
      onPick={(id) => {
        const picked = parse(id);
        if (picked !== undefined) onOwner(picked);
      }}
    />
  );
}

/** A server the creator switched off, as another reader sees it: its provider's name, and its place where it is not the provider's first account. */
function switchedOffName(connection: string): string {
  const account = integrationConnectionOf(connection);
  if (account === undefined) return connection;
  const name = INTEGRATION_NAME[account.provider];
  return account.place === 1 ? name : `${name} (account ${account.place})`;
}

/**
 * Which of the owner's connected MCP servers a run's new agent is handed:
 * a field chip like its neighbours', holding the marks of those left on and
 * opening the agent box's own servers popover, whose switches, search, and
 * way to Settings › Integrations are the ones a task's Start offers, with the
 * row's words naming those switched off. Every server is on until switched
 * off. Note that a run starts on its creator's connections, so only its
 * creator is shown them to switch; anyone else reads which the creator
 * switched off.
 */
function ServersRow({
  mine,
  disabled,
  onSwitch,
}: {
  /** Whether the reading account made it, so its connections are the ones a run is handed. */
  mine: boolean;
  disabled: readonly string[];
  onSwitch: (disabled: readonly string[]) => void;
}): React.JSX.Element {
  if (!mine) {
    return (
      <SettingsRow
        label="MCP servers"
        description={
          disabled.length === 0
            ? "All of its creator's connected servers."
            : `Its creator's connected servers, but ${disabled.map(switchedOffName).join(", ")} switched off.`
        }
      >
        {() => null}
      </SettingsRow>
    );
  }
  return <OwnServersRow disabled={disabled} onSwitch={onSwitch} />;
}

/** Names as a sentence says them: "Linear", "Linear and Notion", "Linear, Notion and Sentry". */
function namesSaid(providers: readonly IntegrationProvider[]): string {
  const names = providers.map((provider) => INTEGRATION_NAME[provider]);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The most marks the servers chip holds before it counts the rest, so it stays a picker's width. */
const SERVERS_CHIP_MARKS = 4;

/** The servers row as the automation's creator sees it: their connections, switched in the agent box's own popover from a field chip. */
function OwnServersRow({
  disabled,
  onSwitch,
}: {
  disabled: readonly string[];
  onSwitch: (disabled: readonly string[]) => void;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const openSettings = useOpenSettings();
  const connected = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => statuses.statusOf(provider) === INTEGRATION_STATUS.CONNECTED,
  );
  const on = connected.filter((provider) => !disabled.includes(provider));
  const off = connected.filter((provider) => disabled.includes(provider));
  const shown = on.slice(0, SERVERS_CHIP_MARKS);
  return (
    <SettingsRow
      label="MCP servers"
      description={
        connected.length === 0
          ? "None connected yet."
          : off.length === 0
            ? "Every connected server is on."
            : `${namesSaid(off)} off.`
      }
    >
      {() => (
        <AgentServersButton
          servers={{
            disabled,
            onSwitch,
            onOpenSettings: () => openSettings({ page: SETTINGS_VIEW.INTEGRATIONS }),
          }}
          statuses={statuses}
          face={
            on.length === 0 ? (
              <ChipName>None</ChipName>
            ) : (
              <span className="automation-servers">
                {shown.map((provider) => (
                  <ProviderMark key={provider} provider={provider} />
                ))}
                {on.length > shown.length ? (
                  <ChipName>{`+${on.length - shown.length}`}</ChipName>
                ) : null}
              </span>
            )
          }
        />
      )}
    </SettingsRow>
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
  // The cron's and the time's Escape lets go of the caret and keeps the press, as every field's here does (releaseOnEscape).
  const cron = useRef<HTMLInputElement>(null);
  const time = useRef<HTMLInputElement>(null);
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
        <SettingsRow label="Cron">
          {(control) => (
            <span className="automation-field">
              <TextField
                ref={cron}
                label="Cron"
                describedBy={control["aria-describedby"]}
                font={TEXT_FIELD_FONT.MONO}
                spellCheck={false}
                value={schedule.cron}
                onEscape={() => cron.current?.blur()}
                onChange={(text) => onSchedule({ ...schedule, cron: text })}
              />
            </span>
          )}
        </SettingsRow>
      ) : (
        <SettingsRow label={schedule.kind === SCHEDULE_KIND.WEEKLY ? "Day and time" : "Time"}>
          {(control) => (
            <>
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
                <span className="automation-field">
                  <TextField
                    ref={time}
                    type={TEXT_FIELD_TYPE.TIME}
                    label="Time"
                    describedBy={control["aria-describedby"]}
                    value={clockValue(schedule.hour, schedule.minute)}
                    onEscape={() => time.current?.blur()}
                    onChange={(text) => {
                      const clock = clockOf(text);
                      if (clock !== undefined) onSchedule({ ...schedule, ...clock });
                    }}
                  />
                </span>
              )}
            </>
          )}
        </SettingsRow>
      )}
      <PickerRow
        label="Time zone"
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

/** What the editor's ⋯ is called. */
const ACTIONS_LABEL = "Automation actions";

/** The editor's ⋯: Copy link, the automation's, where the page hands down a workspace, and Delete, red, which asks first. */
function AutomationActions({
  automation,
  onDelete,
}: {
  automation: AutomationSummary;
  onDelete: () => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  const remove: MenuAction = {
    label: "Delete",
    icon: <Trash2Icon />,
    onSelect: onDelete,
    danger: true,
  };
  return (
    <>
      <Tooltip label={ACTIONS_LABEL}>
        <IconButton icon={<EllipsisIcon />} label={ACTIONS_LABEL} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={ACTIONS_LABEL}
          menu={menu.drawn}
          groups={copyLink === undefined ? [[remove]] : [[copyLink], [remove]]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The crumb naming the automation, cut short with an ellipsis where the toolbar is narrow, the pointer reading it whole. */
function CurrentCrumb({ name }: { name: string }): React.JSX.Element {
  const [words, clipped] = useClipped();
  return (
    <Tooltip label={clipped ? name : undefined}>
      <span ref={words} className="automation-crumb">
        {name}
      </span>
    </Tooltip>
  );
}

/** The editor's toolbar: the crumbs back to the list, then where the draft stands, its save, its switch, and its ⋯ holding Copy link and Delete. */
function EditorToolbar({
  automation,
  dirty,
  saving,
  onBack,
  onSave,
  onToggle,
  onDelete,
  running,
  onRunNow,
  runsPanel,
}: {
  automation: AutomationSummary | undefined;
  dirty: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  /** Whether a Run now is out. */
  running: boolean;
  onRunNow: () => void;
  runsPanel: RunsPanel;
}): React.JSX.Element {
  const runsLabel = runsPanel.open ? "Hide runs" : "Show runs";
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
      {/* The toolbar's own width, which a container query reads, folds its acts' words before they crowd its crumbs. */}
      <div className="automation-toolbar">
        <div className="desktop-toolbar-heading">
          <nav className="automation-crumbs" aria-label="Path">
            <FoldingButton label="Automations" icon={<ZapIcon />} onClick={onBack} />
            <ChevronRightIcon aria-hidden="true" />
            <CurrentCrumb name={automation === undefined ? "New automation" : automation.name} />
          </nav>
          <ExperimentTag />
        </div>
        <div className="desktop-toolbar-actions">
          <SendFeedbackButton experiment={EXPERIMENT.AUTOMATIONS} />
          <span className="automation-editor-status">
            <Text
              variant={TEXT_VARIANT.CAPTION}
              tone={dirty ? TEXT_TONE.MUTED : TEXT_TONE.SUBTLE}
              as={TEXT_ELEMENT.SPAN}
            >
              {status}
            </Text>
          </span>
          {automation === undefined ? null : (
            <FoldingButton
              label="Run now"
              icon={<PlayIcon />}
              variant={BUTTON_VARIANT.OUTLINE}
              busy={running ? "Running" : undefined}
              onClick={onRunNow}
            />
          )}
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            busy={saving}
            busyLabel="Saving"
            disabled={!(automation === undefined || dirty)}
            onClick={onSave}
          >
            {automation === undefined ? "Create" : "Save"}
          </Button>
          {automation === undefined ? null : (
            <>
              <Switch
                checked={automation.enabled}
                label={
                  automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`
                }
                onChange={(enabled) => onToggle(enabled)}
              />
              <AutomationActions automation={automation} onDelete={onDelete} />
            </>
          )}
          {/* The Runs panel's toggle, the side panel's own button and chord at the window's top right. */}
          <Tooltip label={runsLabel} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
            <IconButton
              icon={<SidePanelIcon />}
              label={runsLabel}
              aria-expanded={runsPanel.open}
              onClick={runsPanel.onToggle}
            />
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

/** Whose events a GitHub trigger may hear, as its switches name them. */
const SENDER_CHOICES: readonly { value: GitHubSender; label: string; detail?: string }[] = [
  { value: GITHUB_SENDER.PEOPLE, label: "From people" },
  {
    value: GITHUB_SENDER.LUKE_AGENTS,
    label: "From Luke's agents",
    detail: "What Luke's coding agents open, as you or as the workspace's GitHub App.",
  },
  {
    value: GITHUB_SENDER.OTHER_BOTS,
    label: "From other bots",
    detail: "Dependabot, Renovate, and every other app.",
  },
];

/** The moments of a pull request an update may fire on, as its switches name them. */
const MOMENT_CHOICES: readonly { value: PullRequestMoment; label: string; detail?: string }[] = [
  { value: PULL_REQUEST_MOMENT.OPENED, label: "When opened" },
  { value: PULL_REQUEST_MOMENT.READY, label: "When marked ready" },
  {
    value: PULL_REQUEST_MOMENT.PUSHED,
    label: "When pushed to",
    detail: "A push by Luke's own agents never starts a run.",
  },
];

/** The GitHub events a pull request's drafts and forks speak to. */
const PULL_REQUEST_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
]);

/** A list with a value in it or out of it, as a switch leaves it. */
function toggled<Value>(list: readonly Value[], value: Value, on: boolean): readonly Value[] {
  return on
    ? [...list.filter((each) => each !== value), value]
    : list.filter((each) => each !== value);
}

/**
 * A GitHub trigger's settings, as rows of the Trigger card, a switch each
 * as Settings lists several: whose events fire it, the moments an update
 * fires on, and whether drafts are skipped and forks heard, each shown
 * only for the events it speaks to. A check names no sender, so it shows none.
 */
function GitHubSettingsRows({
  event,
  settings,
  onSettings,
}: {
  event: GitHubTriggerEvent;
  settings: GitHubTriggerSettings;
  onSettings: (settings: GitHubTriggerSettings) => void;
}): React.JSX.Element | null {
  if (event === GITHUB_TRIGGER_EVENT.CHECK_FAILED) return null;
  return (
    <>
      {SENDER_CHOICES.map((choice) => (
        <SwitchRow
          key={choice.value}
          label={choice.label}
          detail={choice.detail}
          checked={settings.senders.includes(choice.value)}
          onChange={(on) =>
            onSettings({ ...settings, senders: toggled(settings.senders, choice.value, on) })
          }
        />
      ))}
      {event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED
        ? MOMENT_CHOICES.map((choice) => (
            <SwitchRow
              key={choice.value}
              label={choice.label}
              detail={choice.detail}
              checked={settings.moments.includes(choice.value)}
              onChange={(on) =>
                onSettings({ ...settings, moments: toggled(settings.moments, choice.value, on) })
              }
            />
          ))
        : null}
      {PULL_REQUEST_EVENTS.has(event) ? (
        <>
          <SwitchRow
            label="Skip drafts"
            detail="A draft starts a run once it is marked ready."
            checked={!settings.drafts}
            onChange={(skip) => onSettings({ ...settings, drafts: !skip })}
          />
          <SwitchRow
            label="Include forks"
            detail="A fork's pull request is code from outside the repository, read by an agent that can push to it."
            checked={settings.forks}
            onChange={(forks) => onSettings({ ...settings, forks })}
          />
        </>
      ) : null}
    </>
  );
}

/** The most findings a review may be set to post, as its picker offers them. */
const MOST_FINDINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((most) => ({
  value: most,
  label: String(most),
}));

/** The most findings a review may post, read back from its picker's row. */
function mostFindingsOf(raw: string): number | undefined {
  return MOST_FINDINGS.find((option) => String(option.value) === raw)?.value;
}

/**
 * A code review's own settings, modelled on Cursor Bugbot's, as a card of
 * Settings rows: whether a clean first review says so, the most findings it
 * posts, the rules file it reads, and whether it pushes fixes. Each is a
 * line the task opens with, written back as it changes, so the task stays
 * the one place the review is described; when it runs and on whose pull
 * requests are the Trigger card's.
 */
function CodeReviewGroup({
  settings,
  onSettings,
}: {
  settings: CodeReviewSettings;
  onSettings: (settings: CodeReviewSettings) => void;
}): React.JSX.Element {
  // The rules file's Escape lets go of the caret and keeps the press, as every field's here does (releaseOnEscape).
  const rulesFile = useRef<HTMLInputElement>(null);
  return (
    <SettingsSection title="Code review">
      <SwitchRow
        label="Comment when no issues are found"
        detail="Only on a pull request's first review."
        checked={settings.commentWhenClean}
        onChange={(commentWhenClean) => onSettings({ ...settings, commentWhenClean })}
      />
      <SelectRow
        label="Most findings"
        detail="Per review, most severe first."
        value={settings.mostFindings}
        options={MOST_FINDINGS}
        parse={mostFindingsOf}
        onChange={(mostFindings) => onSettings({ ...settings, mostFindings })}
      />
      <SettingsRow
        label="Rules file"
        description="Read from the base branch, beside AGENTS.md and CLAUDE.md."
      >
        {(control) => (
          <span className="automation-field">
            <TextField
              ref={rulesFile}
              label="Rules file"
              describedBy={control["aria-describedby"]}
              font={TEXT_FIELD_FONT.MONO}
              spellCheck={false}
              value={settings.rulesFile}
              onEscape={() => rulesFile.current?.blur()}
              onChange={(text) => onSettings({ ...settings, rulesFile: text })}
            />
          </span>
        )}
      </SettingsRow>
      <SwitchRow
        label="Fix what it finds"
        detail="Pushes its fixes to the pull request as Luke. Luke's own pushes start no review."
        checked={settings.fix}
        onChange={(fix) => onSettings({ ...settings, fix })}
      />
    </SettingsSection>
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
    <div className="ph-no-capture">
      <SettingsRow
        label="Secret"
        description="You won't be able to see this again. Copy it into your sender now."
      >
        {() => (
          <>
            <span className="automation-webhook-field">
              <TextField
                label="Secret"
                font={TEXT_FIELD_FONT.MONO}
                spellCheck={false}
                readOnly
                value={secret}
                onChange={() => undefined}
              />
            </span>
            <IconButton
              icon={<CopyGlyph state={copy.state} />}
              label={copyHint(copy.state, "Copy secret")}
              onClick={() => copy.copy(secret)}
            />
            <Button onClick={onDone}>Done</Button>
          </>
        )}
      </SettingsRow>
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
      <SettingsRow
        label="Address"
        description="Save it as a webhook to get its address and a secret to call it with."
      >
        {() => null}
      </SettingsRow>
    );
  }
  return (
    <>
      <SettingsRow
        label="Address"
        description={
          <>
            POST to the address with the secret as <code>Authorization: Bearer</code>. Don't send
            secrets in the body: Luke hands the body to the run's agent, and it shows in the run's
            transcript.
          </>
        }
      >
        {() => (
          <>
            <span className="automation-webhook-field">
              <TextField
                label="Webhook address"
                font={TEXT_FIELD_FONT.MONO}
                spellCheck={false}
                readOnly
                value={url}
                onChange={() => undefined}
              />
            </span>
            <IconButton
              icon={<CopyGlyph state={address.state} />}
              label={copyHint(address.state, "Copy address")}
              onClick={() => address.copy(url)}
            />
          </>
        )}
      </SettingsRow>
      {secret === undefined ? (
        <SettingsRow label="Secret">
          {() => (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={rotation.ask}>
              New secret
            </Button>
          )}
        </SettingsRow>
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

/** What the agent row says under its name. */
const AGENT_DETAIL =
  "Each run is sent to that agent as a message, even mid-turn. It keeps its own model and effort.";

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
  if (agents !== undefined && "failed" in agents) {
    return (
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Agent</strong>
          <small>{AGENT_DETAIL}</small>
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
      detail={AGENT_DETAIL}
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
          <div className="task-compose-menu-note">
            <Spinner label="Loading agents" />
          </div>
        ) : rows.length === 0 ? (
          <p className="task-compose-menu-note">No agents of this workspace work in it yet.</p>
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
  mine,
  savedAgentId,
  workspace,
  problems,
  taskBacked,
  repositories,
  onDraft,
}: {
  draft: AutomationDraft;
  /** Whether the reading account made it, whose connections its runs are handed. */
  mine: boolean;
  /** The agent its runs go to as saved, or none. */
  savedAgentId: string | null;
  workspace: Workspace | undefined;
  problems: DraftProblems;
  taskBacked: boolean;
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
    <SettingsSection title="Runs">
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Repository</strong>
          {taskBacked ? (
            <small>Its task's repository.</small>
          ) : also.length === 0 ? null : (
            <small>{`Runs start here, and also work in ${also.join(", ")}.`}</small>
          )}
        </span>
        {taskBacked ? null : (
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
          <ServersRow
            mine={mine}
            disabled={draft.disabledServers}
            onSwitch={(disabledServers) => onDraft({ disabledServers })}
          />
          <SwitchRow
            label="Archive successful runs"
            detail="Its transcript and pull request are kept."
            checked={draft.archiveSuccessful}
            onChange={(archiveSuccessful) => onDraft({ archiveSuccessful })}
          />
        </>
      )}
      <Problem problem={problems[DRAFT_FIELD.AGENT]} />
    </SettingsSection>
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
  taskBacked,
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
  taskBacked: boolean;
  workspace: Workspace | undefined;
  offersOwner: boolean;
  repositories: RepositoryChooser;
  shownSecret: string | undefined;
  onSecret: (secret: string | undefined) => void;
  /** The agent its runs go to as saved, while the draft is still on the repository it was saved on; none otherwise. */
  savedAgentId: string | null;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  // A code review's own settings are the lines its task opens with, so its card reads them there and writes them back.
  const review = readCodeReviewSettings(draft.prompt);
  // The prompt's Escape lets go of the caret and keeps the press, as every field's here does (releaseOnEscape).
  const prompt = useRef<HTMLTextAreaElement>(null);
  const workspaceName = workspace?.name ?? "Workspace";
  const owners = [
    { value: AUTOMATION_SCOPE.PERSONAL, label: "Personal" },
    { value: AUTOMATION_SCOPE.WORKSPACE, label: workspaceName },
  ] as const;
  return (
    <div className="automation-form">
      {offersOwner ? (
        <SettingsSection title="Sharing">
          <OwnerRow
            owner={draft.owner}
            owners={owners}
            mine={automation === undefined || automation.mine === true}
            workspace={workspace}
            onOwner={(owner) => onDraft({ owner })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Trigger">
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
          <>
            <SelectRow
              label="Event"
              detail="Heard through the workspace's GitHub App."
              value={draft.githubEvent}
              options={GITHUB_EVENTS}
              parse={githubEventOf}
              onChange={(event) => onDraft(withGithubEvent(draft, event))}
            />
            <GitHubSettingsRows
              event={draft.githubEvent}
              settings={draft.githubSettings}
              onSettings={(githubSettings) => onDraft({ githubSettings })}
            />
          </>
        ) : (
          <WebhookRows
            automation={automation}
            writes={writes}
            secret={shownSecret}
            onSecret={onSecret}
          />
        )}
        <Problem problem={problems[DRAFT_FIELD.SCHEDULE]} />
      </SettingsSection>
      {review === undefined ? null : (
        <CodeReviewGroup
          settings={review}
          onSettings={(next) => onDraft({ prompt: withCodeReviewSettings(draft.prompt, next) })}
        />
      )}
      <SettingsSection title="Prompt" frame={SETTINGS_SECTION_FRAME.NONE}>
        <TextArea
          ref={prompt}
          label="Prompt"
          rows={5}
          placeholder="Find the flakiest test in CI this week and fix it."
          value={draft.prompt}
          onEscape={() => prompt.current?.blur()}
          onChange={(text) => onDraft({ prompt: text })}
        />
        <Problem problem={problems[DRAFT_FIELD.PROMPT]} />
      </SettingsSection>
      <RunsGroup
        draft={draft}
        mine={automation === undefined || automation.mine === true}
        savedAgentId={savedAgentId}
        workspace={workspace}
        problems={problems}
        taskBacked={taskBacked}
        repositories={repositories}
        onDraft={onDraft}
      />
    </div>
  );
}

/**
 * One automation's page, or a new one's where none is given. A new one,
 * opened from a suggestion on the list, starts filled in from its preset;
 * once made, it is handed to `onCreated`, which stands its own page where
 * this one stood. A deleted one is handed to `onDeleted`, which goes back
 * to the list.
 */
export function AutomationEditor({
  automation,
  preset,
  workspace,
  offersOwner,
  repositories,
  writes,
  onBack,
  onCreated,
  onDeleted,
  onOpenAgent,
  linked,
  leaveGuard,
}: {
  automation: AutomationSummary | undefined;
  /** The preset a new automation starts filled in from, as the list's suggestion it was opened from names it; none for a blank one. */
  preset?: AutomationPresetName | undefined;
  workspace: Workspace | undefined;
  /** Whether the workspace is shared, so an automation in it may be the workspace's rather than its maker's. */
  offersOwner: boolean;
  repositories: RepositoryChooser;
  writes: AutomationWrites;
  onBack: () => void;
  onCreated: (automationId: string) => void;
  onDeleted: (automationId: string) => void;
  /** Opens a run's agent on its own page. */
  onOpenAgent: (agentId: string) => void;
  /**
   * The page as the window was last sent to it, by a link or a press: the
   * run a link named, which its runs mark and bring into view, none where
   * no link named one. Each sending is a new value, so a link opened again
   * shows the runs again.
   */
  linked?: { readonly runId?: string | undefined } | undefined;
  /** The window's ask before leaving unsaved work, which this page stands while it holds some. */
  leaveGuard: LeaveGuard;
}): React.JSX.Element {
  const runs = useAutomationRuns(automation?.id);
  const linkedRun = linked?.runId;
  const [running, setRunning] = useState(false);
  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: windowZone(),
    owner: AUTOMATION_SCOPE.PERSONAL,
  }));
  // A new automation starts in the repository the workspace's plans were about lately, as a new plan does,
  // filled in from the preset of the suggestion it was opened from.
  const [start] = useState(() => {
    if (automation !== undefined) return automationDraft(automation, defaults);
    const blank = {
      ...automationDraft(undefined, defaults),
      repository: repositories.recent[0] ?? null,
    };
    return preset === undefined ? blank : presetDraft(blank, automationPreset(preset));
  });
  const [draft, setDraft] = useState(start);
  const [shownProblems, setShownProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // The webhook secret a write just minted, shown once on this page and gone when it is left.
  const [shownSecret, setShownSecret] = useState<string | undefined>(undefined);
  const taskBacked = automation !== undefined && automation.planId !== null;
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
  // Escape goes back to the list, asking first, as every way out does, where something written would be lost.
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, onBack);
  const runsPanel = useRunsPanel();
  // The form glides to its new middle as the Runs panel comes and goes (pane-motion.tsx).
  const editorLayout = useRef<HTMLDivElement>(null);
  // ⌥⌘B shows and hides the Runs panel, as it does a plan's side panel.
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, runsPanel.onToggle);
  // A link to a run shows the Runs panel it is listed in, once each time it is opened, so a fold after it stands.
  const showRuns = useRef(runsPanel.onShow);
  showRuns.current = runsPanel.onShow;
  useEffect(() => {
    if (linked?.runId !== undefined) showRuns.current();
  }, [linked]);
  const problems = draftProblems(draft, taskBacked, new Date());
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
    // Note that the page it now stands as is this one, saved, so the move there passes the ask.
    if (automation === undefined) leaveGuard.pass(() => onCreated(answer.automation.id));
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
  // Note that any way out of the page, a crumb, Escape, a run's agent, the sidebar, ⌘K, history,
  // or Settings, asks first while something written would be lost, and goes once Leave is pressed.
  const [leavingBy, setLeavingBy] = useState<{ readonly leave: () => void } | undefined>(undefined);
  const leaving = useConfirmDialog({ subject: leavingBy !== undefined, surfaceOpen: true }, () => {
    leavingBy?.leave();
    return Promise.resolve(ACCEPTED);
  });
  const askLeave = useRef<LeaveAsk>(() => undefined);
  askLeave.current = (leave) => {
    setLeavingBy({ leave });
    leaving.ask();
  };
  useEffect(
    () => (written ? leaveGuard.stand((leave) => askLeave.current(leave)) : undefined),
    [written, leaveGuard],
  );
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
        leaveGuard.pass(() => onDeleted(automation.id));
        return ACCEPTED;
      });
    },
  );
  return (
    <section className="automations-view" aria-label="Automation">
      <EditorToolbar
        automation={automation}
        dirty={dirty}
        saving={saving}
        onBack={onBack}
        onSave={save}
        onToggle={toggle}
        onDelete={deletion.ask}
        running={running}
        onRunNow={runNow}
        runsPanel={runsPanel}
      />
      <div ref={editorLayout} className="automation-editor-layout">
        <div className="automations-scroll scroll-fade-top">
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
              taskBacked={taskBacked}
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
          panel={runsPanel}
          mine={automation === undefined || automation.mine === true}
          created={automation !== undefined}
          automationId={automation?.id}
          linkedRun={linkedRun}
          runs={runs.read}
          onRetry={runs.reload}
          onOpenAgent={onOpenAgent}
        />
        <PaneGlide root={editorLayout} layout={{ runsOpen: runsPanel.open }} />
      </div>
      <ConfirmDialog
        confirm={leaving}
        question={{
          title: "Leave with unsaved changes?",
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
