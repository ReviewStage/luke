import {
  type AutomationDraft,
  automationDraft,
  changeOf,
  createRequestOf,
  cronOf,
  DRAFT_FIELD,
  type DraftDefaults,
  type DraftProblems,
  draftNextRuns,
  draftProblems,
  draftRepositories,
  draftTrigger,
  filterAdmitted,
  filterValuesOf,
  type GitHubTriggerSettings,
  repositoryHeld,
  SCHEDULE_KIND,
  type ScheduleDraft,
  type ScheduleKind,
  sameDraft,
  withGithubEvent,
  withIntegrationEvent,
  withIntegrationFilters,
  withRepository,
} from "@repo/features/automation-draft-model";
import { automationTriggerText, parseAutomationClock } from "@repo/features/automation-list-model";
import { readSchedule, SCHEDULE_REFUSAL } from "@repo/features/automation-schedule";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationView,
} from "@repo/features/automation-view";
import {
  AUTOMATION_BOUNDS,
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
  type IntegrationTriggerFilters,
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
} from "@repo/features/automation-wire";
import { readerZone } from "@repo/features/date-mention";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { ModelChoice } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { clockText, dateOfText, dayAndTimeText, timeZoneNames } from "@repo/features/time-format";
import {
  SENTRY_LEVEL,
  SENTRY_TRIGGER_EVENT,
  type SentryLevel,
  type SentryTriggerEvent,
} from "@repo/features/trigger-catalog";
import {
  andList,
  INTEGRATION_LABEL,
  IRREVERSIBLE_WORDS,
  noMatchWords,
  readFailedWords,
  readingWords,
  TERM,
} from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BackButton,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  CHOICE_LOOK,
  CHOICE_SELECT,
  Chip,
  ChipName,
  ChoiceList,
  CONFIRM_LOSS,
  ConfirmDialog,
  CopyField,
  cssCustomProperties,
  DetailPage,
  ErrorState,
  FailureNote,
  Fill,
  FoldingButton,
  GAP,
  IconButton,
  Inline,
  MENU_ITEM_MARK,
  MoreButton,
  matchingRows,
  moreLabel,
  NO_CONTEXT_MENU,
  PAGE_FRAME,
  POPOVER_ALIGN,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  Reveal,
  RevealArea,
  RevealChoice,
  revealArea,
  SETTINGS_SECTION_FRAME,
  SETTINGS_SKELETON_CONTROL,
  SettingsControlSkeleton,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
  SidePanelIcon,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Spinner,
  STATUS_TONE,
  Switch,
  TEXT_ELEMENT,
  TEXT_FIELD_FONT,
  TEXT_FIELD_INPUT_MODE,
  TEXT_FIELD_SIZE,
  TEXT_FIELD_TYPE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TextField,
  Toolbar,
  type ToolbarPickUp,
  Tooltip,
  useConfirmDialog,
  useMenu,
  useMinute,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@repo/ui/actor-model";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { inputProblem, UNREPORTED } from "@repo/ui/reported-failure";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { Result } from "effect";
import { HistoryIcon, PlayIcon, SaveIcon, ZapIcon } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, actorMarkWidth, automationActor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useScreenRef, useScreenSplit } from "../column-split.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { confirmFailure, failureShown, unreadShown } from "../failure-report.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useCreator } from "../member-directory.js";
import { useOpenSettings } from "../open-settings.js";
import { Picker, PickerRow } from "../settings/picker-row.js";
import { SelectRow } from "../settings/select-row.js";
import { SwitchRow } from "../settings/switch-row.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { agentMenuRow, useAgentRowPlace } from "../tasks/agent-menu-row.js";
import { AgentModelChip } from "../tasks/agent-model-chip.js";
import { AgentServersButton } from "../tasks/agent-servers.js";
import type { MentionableAgent } from "../tasks/mention-picker.js";
import { ModelMenu } from "../tasks/model-menu.js";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "../tasks/repository-chip.js";
import { mentionableAgent } from "../tasks/task-mentions.js";
import { useKnownNames } from "../tasks/use-known-names.js";
import type { LeaveAsk, LeaveGuard } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner.js";
import { AutomationRunsPanel, AutomationRunsScreen } from "./automation-runs-panel.js";
import { automationDeleteQuestion, automationOwnerName } from "./automation-words.js";
import { useRunsPanel } from "./folded-groups.js";
import { type NarrowColumns, useNarrowFocus } from "./narrow-focus.js";
import { PaneGlide } from "./pane-motion.js";
import { PhoneHead, phoneFindGroups } from "./phone-head.js";
import { useAutomationRuns } from "./use-automation-runs.js";
import { AUTOMATION_DELETE_MUTATION, WEBHOOK_SECRET_MUTATION } from "./use-automations.js";
import { type RunChoices, useRunChoices } from "./use-run-choices.js";

const AUTOMATION_FIELD = "automation-field w-automation-field max-w-full";

export interface SentryOffer {
  readonly read: WorkspaceSentry | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly installing: boolean;
  readonly refusal: string | undefined;
  readonly onInstall: () => void;
}

function sentryWithheld(
  sentry: SentryOffer,
  automation: AutomationSummary | undefined,
  draft: AutomationDraft,
): boolean {
  return (
    sentry.read?.configured === false &&
    draft.triggerKind === AUTOMATION_TRIGGER.INTEGRATION &&
    automation?.trigger.kind !== AUTOMATION_TRIGGER.INTEGRATION
  );
}

const SENTRY_NOT_SET_UP = "Not set up on this deployment yet";

const SENTRY_WITHHELD = `${PRODUCT_NAME} cannot receive Sentry events here. Choose another trigger.`;

const SENTRY_UNREAD = readFailedWords("the workspace's Sentry");

export interface AutomationWrites {
  create(params: AutomationCreateParams): Promise<AutomationView>;
  change(params: AutomationChangeParams): Promise<AutomationView>;
  toggle(automationId: string, enabled: boolean): Promise<AutomationView>;
}

const SCHEDULE_KINDS: readonly { value: ScheduleKind; label: string }[] = [
  { value: SCHEDULE_KIND.HOURLY, label: "Hourly" },
  { value: SCHEDULE_KIND.DAILY, label: "Daily" },
  { value: SCHEDULE_KIND.WEEKDAYS, label: "Weekdays" },
  { value: SCHEDULE_KIND.WEEKLY, label: "Weekly" },
  { value: SCHEDULE_KIND.CUSTOM, label: "Custom" },
];

const TRIGGERS: readonly { value: AutomationTriggerKind; label: string }[] = [
  { value: AUTOMATION_TRIGGER.SCHEDULE, label: "Schedule" },
  { value: AUTOMATION_TRIGGER.GITHUB, label: "GitHub event" },
  { value: AUTOMATION_TRIGGER.WEBHOOK, label: "Webhook" },
  { value: AUTOMATION_TRIGGER.INTEGRATION, label: "Sentry" },
];

const SENTRY_EVENTS: readonly { value: SentryTriggerEvent; label: string }[] = [
  { value: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED, label: "Alert triggered (recommended)" },
  { value: SENTRY_TRIGGER_EVENT.ISSUE_CREATED, label: "New issue" },
];

const SENTRY_EVENT_DETAIL: Partial<Record<SentryTriggerEvent, string>> = {
  [SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED]: `Set the alert rule's action to send a notification to the ${PRODUCT_NAME} integration.`,
};

const SENTRY_LEVELS: readonly { value: SentryLevel; label: string }[] = [
  { value: SENTRY_LEVEL.DEBUG, label: "Debug" },
  { value: SENTRY_LEVEL.INFO, label: "Info" },
  { value: SENTRY_LEVEL.WARNING, label: "Warning" },
  { value: SENTRY_LEVEL.ERROR, label: "Error" },
  { value: SENTRY_LEVEL.FATAL, label: "Fatal" },
];

const GITHUB_EVENTS: readonly { value: GitHubTriggerEvent; label: string }[] = [
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED, label: "Pull request opened or updated" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED, label: "Pull request opened" },
  { value: GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED, label: "Pull request labeled" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_OPENED, label: "Issue opened" },
  { value: GITHUB_TRIGGER_EVENT.ISSUE_LABELED, label: "Issue labeled" },
  { value: GITHUB_TRIGGER_EVENT.CHECK_FAILED, label: "Checks failed" },
  { value: GITHUB_TRIGGER_EVENT.PUSH, label: "Commits pushed" },
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const HOURLY_MINUTES = [0, 15, 30, 45] as const;

const TIME_ZONES = timeZoneNames();

const NO_MATCH = {
  DAYS: "No days match",
  TIMES: "No times match",
  AGENTS: noMatchWords(TERM.AGENT),
} as const;

const SAVE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The automation could not be saved. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "Choose the repository whose events start it.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: `${PRODUCT_NAME} cannot reach that repository from this workspace on GitHub.`,
  [AUTOMATION_CALL_FAILURE.INVALID]:
    "The automation could not be saved as written. Check its schedule and prompt.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can change it.",
} as const satisfies Record<AutomationCallFailure, string>;

export const RUN_REFUSAL_WORDS = {
  ...SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Could not run it now. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can run it.",
} as const satisfies Record<AutomationCallFailure, string>;

function toggleRefusal(answer: AutomationView, enabled: boolean): string | undefined {
  if (!("failure" in answer)) return undefined;
  if (answer.failure === AUTOMATION_CALL_FAILURE.NOT_PERMITTED) {
    return SAVE_REFUSAL_WORDS[AUTOMATION_CALL_FAILURE.NOT_PERMITTED];
  }
  return enabled ? "Could not turn it on. Try again." : "Could not turn it off. Try again.";
}

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

export function AutomationSwitch({
  automation,
  write,
}: {
  automation: AutomationSummary;
  write: (enabled: boolean) => Promise<AutomationView>;
}): React.JSX.Element {
  const toast = useToast();
  const turn = (enabled: boolean) => {
    write(enabled).then((answer) => {
      const reason = toggleRefusal(answer, enabled);
      if (reason !== undefined) {
        toast({
          words: reason,
          replayUnmasked: true,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: {
            surface: FAILURE_SURFACE.AUTOMATION_TOGGLE,
            cause: answer,
            about: { automationId: automation.id },
          },
        });
      }
    });
  };
  return (
    <Switch
      checked={automation.enabled}
      label={automation.enabled ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
      onChange={turn}
      {...NO_CONTEXT_MENU}
    />
  );
}

const UNREADABLE_TIME = "Write the time as 2:00 AM.";

function ClockField({
  hour,
  minute,
  inputRef,
  describedBy,
  invalid,
  onClock,
  onUnreadable,
}: {
  hour: number;
  minute: number;
  inputRef: RefObject<HTMLInputElement | null>;
  describedBy: string | undefined;
  invalid: boolean | undefined;
  onClock: (clock: { readonly hour: number; readonly minute: number }) => void;
  onUnreadable: (unreadable: boolean) => void;
}): React.JSX.Element {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const unreadable = typed !== undefined && parseAutomationClock(typed) === undefined;
  useEffect(() => {
    onUnreadable(unreadable);
    return () => onUnreadable(false);
  }, [unreadable, onUnreadable]);
  return (
    <TextField
      ref={inputRef}
      label="Time"
      describedBy={describedBy}
      invalid={invalid === true || unreadable}
      value={typed ?? clockText(hour, minute)}
      onEscape={() => inputRef.current?.blur()}
      onChange={(text) => {
        setTyped(text);
        const clock = parseAutomationClock(text);
        if (clock !== undefined) onClock(clock);
      }}
      onBlur={() => setTyped(unreadable ? typed : undefined)}
    />
  );
}

function hourlyLabel(minute: number): string {
  return `At :${String(minute).padStart(2, "0")}`;
}

function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ");
}

function OwnerRow({
  owner,
  owners,
  mine,
  maker,
  workspace,
  onOwner,
}: {
  owner: AutomationScope;
  owners: readonly { value: AutomationScope; label: string }[];
  mine: boolean;
  maker: Actor;
  workspace: Workspace | undefined;
  onOwner: (owner: AutomationScope) => void;
}): React.JSX.Element {
  const parse = optionValue(owners);
  const changers = mine
    ? "You"
    : maker.kind === ACTOR_KIND.SOMEONE
      ? "Its creator"
      : actorName(maker);
  return (
    <PickerRow
      width={CHIP_WIDTH.MIN_FIELD}
      label="Owner"
      labelReplayUnmasked
      detail={
        <ReplayUnmask>
          {owner === AUTOMATION_SCOPE.WORKSPACE ? (
            <>
              Everyone in <ReplayMask>{workspace?.name ?? "the workspace"}</ReplayMask> sees it,
              runs it, and turns it off. <ReplayMask>{changers}</ReplayMask>, owners, and admins
              change it.
            </>
          ) : (
            "Only you see and change it. Owners and admins can see it and turn it off."
          )}
        </ReplayUnmask>
      }
      value={owner}
      valueLabel={automationOwnerName(owner, workspace?.name, mine)}
      replayUnmasked
      valueIcon={
        <OwnerMark owner={owner} workspace={workspace} mine={mine} size={OWNER_MARK_SIZE.INLINE} />
      }
      rows={owners.map((each) => ({
        id: each.value,
        label: each.label,
        replayMasked: each.value === AUTOMATION_SCOPE.WORKSPACE,
        icon: (
          <OwnerMark
            owner={each.value}
            workspace={workspace}
            mine={mine}
            size={OWNER_MARK_SIZE.ROW}
          />
        ),
      }))}
      noMatch="No owners match"
      onPick={(id) => {
        const picked = parse(id);
        if (picked !== undefined) onOwner(picked);
      }}
    />
  );
}

function MakerRow({ maker, at }: { maker: Actor; at: number }): React.JSX.Element | null {
  const now = useMinute();
  if (maker.kind === ACTOR_KIND.SOMEONE) return null;
  const name = actorName(maker, { sentence: true });
  const theirs = actorName(maker, { sentence: true, possessive: true });
  return (
    <SettingsRow
      label={<ReplayUnmask>Created by</ReplayUnmask>}
      description={
        <ReplayUnmask>
          Runs start as <ReplayMask>{name}</ReplayMask>, on <ReplayMask>{theirs}</ReplayMask> GitHub
          access, model keys, and integrations. Created {dateOfText(at, now)}.
        </ReplayUnmask>
      }
    >
      {() => (
        <SettingsRowValue>
          <ActorRef actor={maker} />
        </SettingsRowValue>
      )}
    </SettingsRow>
  );
}

function switchedOffName(connection: string): string {
  const account = integrationConnectionOf(connection);
  if (account === undefined) return connection;
  const name = INTEGRATION_NAME[account.provider];
  return account.place === 1 ? name : `${name} (account ${account.place})`;
}

function ServersRow({
  mine,
  disabled,
  onSwitch,
}: {
  mine: boolean;
  disabled: readonly string[];
  onSwitch: (disabled: readonly string[]) => void;
}): React.JSX.Element {
  if (!mine) {
    return (
      <SettingsRow
        label={<ReplayUnmask>{INTEGRATION_LABEL.many}</ReplayUnmask>}
        description={
          <ReplayUnmask>
            {disabled.length === 0 ? (
              "All of its creator's connected integrations."
            ) : (
              <>
                Its creator's connected integrations, but{" "}
                <ReplayMask>{andList(disabled.map(switchedOffName))}</ReplayMask> switched off.
              </>
            )}
          </ReplayUnmask>
        }
      >
        {() => null}
      </SettingsRow>
    );
  }
  return <OwnServersRow disabled={disabled} onSwitch={onSwitch} />;
}

function namesSaid(providers: readonly IntegrationProvider[]): string {
  return andList(providers.map((provider) => INTEGRATION_NAME[provider]));
}

const SERVERS_CHIP_MARKS = 4;

const SERVERS_DETAIL_SKELETON = "40%";

function UnreadServersRow({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  if (failed) {
    return (
      <SettingsRow
        label={<ReplayUnmask>{INTEGRATION_LABEL.many}</ReplayUnmask>}
        below={() => (
          <ReplayUnmask>
            <ErrorState
              onRetry={onRetry}
              failure={unreadShown(FAILURE_SURFACE.AUTOMATION_INTEGRATIONS_READ)}
            >
              Your connected integrations could not be read.
            </ErrorState>
          </ReplayUnmask>
        )}
      />
    );
  }
  return <ServersRowSkeleton />;
}

function ServersRowSkeleton(): React.JSX.Element {
  return (
    <SettingsRow
      label={<ReplayUnmask>{INTEGRATION_LABEL.many}</ReplayUnmask>}
      description={<Skeleton width={SERVERS_DETAIL_SKELETON} />}
    >
      {() => (
        <SkeletonRegion label="Reading your connected integrations…">
          <SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SELECT} />
        </SkeletonRegion>
      )}
    </SettingsRow>
  );
}

function OwnServersRow({
  disabled,
  onSwitch,
}: {
  disabled: readonly string[];
  onSwitch: (disabled: readonly string[]) => void;
}): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const openSettings = useOpenSettings();
  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));
  if (!read) {
    return <UnreadServersRow failed={statuses.readFailed} onRetry={() => void statuses.read()} />;
  }
  const connected = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => statuses.statusOf(provider) === INTEGRATION_STATUS.CONNECTED,
  );
  const on = connected.filter((provider) => !disabled.includes(provider));
  const off = connected.filter((provider) => disabled.includes(provider));
  const shown = on.slice(0, SERVERS_CHIP_MARKS);
  return (
    <SettingsRow
      label={<ReplayUnmask>{INTEGRATION_LABEL.many}</ReplayUnmask>}
      description={
        <ReplayUnmask>
          {connected.length === 0
            ? "None connected yet."
            : off.length === 0
              ? "Every connected integration is on."
              : `${namesSaid(off)} off.`}
        </ReplayUnmask>
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
              <ChipName>
                <ReplayUnmask>None</ReplayUnmask>
              </ChipName>
            ) : (
              <span className="automation-servers inline-flex items-center gap-tight-gap">
                {shown.map((provider) => (
                  <ProviderMark key={provider} provider={provider} size={PROVIDER_MARK_SIZE.ICON} />
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

function optionValue<Value extends string>(
  options: readonly { value: Value; label: string }[],
): (raw: string) => Value | undefined {
  return (raw) => options.find((option) => option.value === raw)?.value;
}

function nextRunsText(draft: AutomationDraft): string | undefined {
  const [first, second] = draftNextRuns(draft, new Date(), 2);
  if (first === undefined) return undefined;
  const then = second === undefined ? "" : `, then ${dayAndTimeText(second)}`;
  return `Next: ${dayAndTimeText(first)}${then}`;
}

const scheduleKindOf = optionValue(SCHEDULE_KINDS);

const SCHEDULE_FIELD = {
  CRON: "cron",
  CLOCK: "clock",
} as const;

function ScheduleRows({
  draft,
  problem,
  onSchedule,
  onTimezone,
  onUnreadableTime,
}: {
  draft: AutomationDraft;
  problem: string | undefined;
  onSchedule: (schedule: ScheduleDraft) => void;
  onTimezone: (timezone: string) => void;
  onUnreadableTime: (unreadable: boolean) => void;
}): React.JSX.Element {
  const cron = useRef<HTMLInputElement>(null);
  const time = useRef<HTMLInputElement>(null);
  const { schedule, timezone } = draft;
  const zones = TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES];
  const read =
    problem === undefined
      ? undefined
      : readSchedule({ cron: cronOf(schedule), timezone }, new Date());
  const zoneRefused =
    read !== undefined && Result.isFailure(read) && read.failure === SCHEDULE_REFUSAL.TIMEZONE;
  return (
    <>
      <SelectRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Repeats"
        labelReplayUnmasked
        detail={nextRunsText(draft)}
        value={schedule.kind}
        options={SCHEDULE_KINDS}
        parse={scheduleKindOf}
        onChange={(kind) => onSchedule({ ...schedule, kind })}
      />
      <RevealChoice
        value={schedule.kind === SCHEDULE_KIND.CUSTOM ? SCHEDULE_FIELD.CRON : SCHEDULE_FIELD.CLOCK}
      >
        {(field) =>
          field === SCHEDULE_FIELD.CRON ? (
            <SettingsRow
              label={<ReplayUnmask>Cron</ReplayUnmask>}
              error={zoneRefused ? undefined : inputProblem(problem)}
            >
              {(control) => (
                <span className={AUTOMATION_FIELD}>
                  <TextField
                    ref={cron}
                    label="Cron"
                    describedBy={control["aria-describedby"]}
                    invalid={control["aria-invalid"]}
                    font={TEXT_FIELD_FONT.MONO}
                    autoCorrect={false}
                    spellCheck={false}
                    value={schedule.cron}
                    onEscape={() => cron.current?.blur()}
                    onChange={(text) => onSchedule({ ...schedule, cron: text })}
                  />
                </span>
              )}
            </SettingsRow>
          ) : (
            <SettingsRow
              label={
                <ReplayUnmask>
                  {schedule.kind === SCHEDULE_KIND.WEEKLY ? "Day and time" : "Time"}
                </ReplayUnmask>
              }
              error={zoneRefused ? undefined : inputProblem(problem)}
            >
              {(control) => (
                <>
                  {schedule.kind === SCHEDULE_KIND.WEEKLY ? (
                    <Picker
                      width={CHIP_WIDTH.MIN_FIELD}
                      label="Day"
                      replayUnmasked
                      value={String(schedule.weekday)}
                      valueLabel={WEEKDAYS[schedule.weekday] ?? WEEKDAYS[0]}
                      rows={WEEKDAYS.map((day, weekday) => ({ id: String(weekday), label: day }))}
                      noMatch={NO_MATCH.DAYS}
                      onPick={(id) => onSchedule({ ...schedule, weekday: Number(id) })}
                    />
                  ) : null}
                  {schedule.kind === SCHEDULE_KIND.HOURLY ? (
                    <Picker
                      width={CHIP_WIDTH.MIN_FIELD}
                      label="Minutes past the hour"
                      replayUnmasked
                      value={String(schedule.minute)}
                      valueLabel={hourlyLabel(schedule.minute)}
                      rows={HOURLY_MINUTES.map((minute) => ({
                        id: String(minute),
                        label: hourlyLabel(minute),
                      }))}
                      noMatch={NO_MATCH.TIMES}
                      onPick={(id) => onSchedule({ ...schedule, minute: Number(id) })}
                    />
                  ) : (
                    <span
                      className={`${AUTOMATION_FIELD} automation-time-field [[data-ui-profile=web]_&]:w-automation-time`}
                    >
                      <ClockField
                        inputRef={time}
                        hour={schedule.hour}
                        minute={schedule.minute}
                        describedBy={control["aria-describedby"]}
                        invalid={control["aria-invalid"]}
                        onClock={(clock) => onSchedule({ ...schedule, ...clock })}
                        onUnreadable={onUnreadableTime}
                      />
                    </span>
                  )}
                </>
              )}
            </SettingsRow>
          )
        }
      </RevealChoice>
      <PickerRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Time zone"
        labelReplayUnmasked
        value={timezone}
        valueLabel={zoneLabel(timezone)}
        rows={zones.map((zone) => ({ id: zone, label: zoneLabel(zone) }))}
        placeholder="Search time zones"
        noMatch="No time zones match"
        error={zoneRefused ? inputProblem(problem) : undefined}
        onPick={onTimezone}
      />
    </>
  );
}

const EDITOR_SECTION = {
  SHARING: "Sharing",
  TRIGGER: "Trigger",
  PROMPT: "Prompt",
  WHERE_IT_RUNS: "Where it runs",
} as const;

const PROMPT_ROWS = 5;

const SCHEDULED_ROWS = {
  [EDITOR_SECTION.SHARING]: [
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.VALUE] },
  ],
  [EDITOR_SECTION.TRIGGER]: [
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
  ],
  [EDITOR_SECTION.WHERE_IT_RUNS]: [
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
  ],
} as const satisfies Record<string, readonly SettingsRowSkeletonShape[]>;

const SKELETON_NAME = { TITLE: "160px" } as const;

const SKELETON_ACTS = { STATUS: "34px", RUN_NOW: "100px", SAVE: "56px" } as const;

const ICON_PRESS_WIDTH = "var(--ui-control-height)";

const READING_AUTOMATION = "Reading the automation…";

const NEW_AUTOMATION = "New automation";

const AUTOMATIONS_PLACE = "Automations";

const UNTITLED_AUTOMATION = "Untitled automation";

function EditorTitle({
  automation,
  name,
  nameField,
  invalid,
  onName,
}: {
  automation: AutomationSummary | undefined;
  name: string;
  nameField: RefObject<HTMLInputElement | null>;
  invalid: boolean;
  onName: (name: string) => void;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL} wrap={false}>
      <ActorMark
        actor={
          automation === undefined
            ? { kind: ACTOR_KIND.AUTOMATION, name: NEW_AUTOMATION, state: ACTOR_STATE.REST }
            : automationActor(automation)
        }
        size={ACTOR_SIZE.PAGE}
      />
      <TextField
        ref={nameField}
        size={TEXT_FIELD_SIZE.TITLE}
        label="Automation name"
        placeholder={automation === undefined ? NEW_AUTOMATION : UNTITLED_AUTOMATION}
        invalid={invalid}
        value={name}
        onEscape={() => nameField.current?.blur()}
        onChange={onName}
      />
    </Inline>
  );
}

const ACTIONS_THING = "Automation";

export function runNowAction(running: boolean, onRunNow: () => void): MenuAction {
  return { label: "Run now", icon: <PlayIcon />, disabled: running, onSelect: onRunNow };
}

export function automationActionGroups({
  copyLink,
  runNow,
  onDelete,
}: {
  copyLink: MenuAction | undefined;
  runNow: MenuAction | undefined;
  onDelete: () => void;
}): MenuAction[][] {
  return [
    copyLink === undefined ? [] : [copyLink],
    runNow === undefined ? [] : [runNow],
    [{ label: "Delete", icon: <GLYPH.DELETE />, onSelect: onDelete, danger: true }],
  ].filter((group) => group.length > 0);
}

function AutomationActions({
  automation,
  onDelete,
  running,
  onRunNow,
  lead,
  heading,
}: {
  automation: AutomationSummary | undefined;
  onDelete: () => void;
  running: boolean;
  onRunNow: () => void;
  lead?: readonly MenuAction[][];
  heading?: ReactNode;
}): React.JSX.Element {
  const menu = useMenu(true);
  const linkItem = useCopyLinkItem();
  const own =
    automation === undefined
      ? []
      : automationActionGroups({
          copyLink: linkItem({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id }),
          runNow: lead === undefined ? undefined : runNowAction(running, onRunNow),
          onDelete,
        });
  return (
    <>
      <MoreButton thing={ACTIONS_THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(ACTIONS_THING)}
          replayUnmasked
          menu={menu.drawn}
          heading={heading}
          groups={[...(lead === undefined ? [] : [...lead, ...phoneFindGroups()]), ...own].filter(
            (group) => group.length > 0,
          )}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function EditorToolbarFrame({
  pickUp,
  onBack,
  children,
}: {
  pickUp: ToolbarPickUp;
  onBack: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="automation-toolbar flex-none @container/automation-toolbar">
      <Toolbar
        trail={[{ label: AUTOMATIONS_PLACE, icon: <ZapIcon />, onPress: onBack }]}
        pickUp={pickUp}
        actions={<ReplayUnmask>{children}</ReplayUnmask>}
      />
    </div>
  );
}

function EditorStatus({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="automation-editor-status whitespace-nowrap">{children}</span>;
}

interface RunsControl {
  readonly shown: boolean;
  readonly screen: string | undefined;
  readonly onPress: () => void;
}

const AUTOMATIONS_PLACE_NAME = "automations";

function AutomationsBack({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <BackButton
      label={AUTOMATIONS_PLACE}
      place={AUTOMATIONS_PLACE_NAME}
      command={APP_COMMAND.EXIT_AUTOMATIONS}
      onBack={onBack}
    />
  );
}

const RUNS_LABEL = "Runs";

function EditorToolbar({
  automation,
  pickUp,
  dirty,
  saving,
  saveRefused,
  onBack,
  onSave,
  onToggle,
  onDelete,
  running,
  onRunNow,
  runs,
  narrow,
}: {
  automation: AutomationSummary | undefined;
  pickUp: ToolbarPickUp;
  dirty: boolean;
  saving: boolean;
  saveRefused: boolean;
  onBack: () => void;
  onSave: () => void;
  onToggle: (enabled: boolean) => Promise<AutomationView>;
  onDelete: () => void;
  running: boolean;
  onRunNow: () => void;
  runs: RunsControl;
  narrow: boolean;
}): React.JSX.Element {
  const runsLabel = runs.shown ? "Hide runs" : "Show runs";
  const status =
    automation === undefined
      ? "Not created yet"
      : saving
        ? "Saving"
        : dirty
          ? "Unsaved changes"
          : "Saved";
  if (narrow) {
    const lead: MenuAction[][] = [
      [
        {
          label: automation === undefined ? "Create" : "Save",
          icon: <SaveIcon />,
          disabled: saving || !(automation === undefined || dirty),
          onSelect: onSave,
        },
      ],
      automation === undefined
        ? []
        : [
            {
              label: automation.enabled ? "On" : "Off",
              detail: automation.name,
              replayMasked: true,
              checked: automation.enabled,
              mark: MENU_ITEM_MARK.SWITCH,
              onSelect: () => onToggle(!automation.enabled),
            },
          ],
      [{ label: RUNS_LABEL, icon: <HistoryIcon />, onSelect: runs.onPress }],
    ];
    return (
      <PhoneHead
        place="automation"
        start={<AutomationsBack onBack={onBack} />}
        pickUp={pickUp}
        end={
          <AutomationActions
            automation={automation}
            onDelete={onDelete}
            running={running}
            onRunNow={onRunNow}
            lead={lead.filter((group) => group.length > 0)}
            heading={<ReplayUnmask>{status}</ReplayUnmask>}
          />
        }
      />
    );
  }
  return (
    <EditorToolbarFrame pickUp={pickUp} onBack={onBack}>
      <EditorStatus>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
          {status}
        </Text>
      </EditorStatus>
      {automation === undefined ? null : (
        <FoldingButton
          label="Run now"
          icon={<PlayIcon />}
          variant={BUTTON_VARIANT.OUTLINE}
          busy={running}
          busyLabel="Starting"
          onClick={onRunNow}
        />
      )}
      <Button
        variant={BUTTON_VARIANT.PRIMARY}
        busy={saving}
        busyLabel="Saving"
        succeeded={!saveRefused}
        disabled={!(automation === undefined || dirty)}
        onClick={onSave}
      >
        {automation === undefined ? "Create automation" : "Save"}
      </Button>
      {automation === undefined ? null : (
        <>
          <AutomationSwitch automation={automation} write={onToggle} />
          <AutomationActions
            automation={automation}
            onDelete={onDelete}
            running={running}
            onRunNow={onRunNow}
          />
        </>
      )}
      {runs.screen === undefined ? (
        <Tooltip label={runsLabel} command={APP_COMMAND.TOGGLE_SIDE_PANEL}>
          <IconButton
            icon={<SidePanelIcon />}
            label={runsLabel}
            aria-expanded={runs.shown}
            onClick={runs.onPress}
          />
        </Tooltip>
      ) : (
        <Tooltip label={RUNS_LABEL}>
          <IconButton
            icon={<HistoryIcon />}
            label={RUNS_LABEL}
            aria-controls={runs.screen}
            onClick={runs.onPress}
          />
        </Tooltip>
      )}
    </EditorToolbarFrame>
  );
}

const SENDER_CHOICES: readonly { value: GitHubSender; label: string; detail?: string }[] = [
  { value: GITHUB_SENDER.PEOPLE, label: "From people" },
  {
    value: GITHUB_SENDER.APP_AGENTS,
    label: `From ${PRODUCT_NAME}'s agents`,
    detail: `What ${PRODUCT_NAME}'s agents open, as you or as the workspace's GitHub App.`,
  },
  {
    value: GITHUB_SENDER.OTHER_BOTS,
    label: "From other bots",
    detail: "Dependabot, Renovate, and every other app.",
  },
];

const MOMENT_CHOICES: readonly { value: PullRequestMoment; label: string; detail?: string }[] = [
  { value: PULL_REQUEST_MOMENT.OPENED, label: "When opened" },
  { value: PULL_REQUEST_MOMENT.READY, label: "When marked ready" },
  {
    value: PULL_REQUEST_MOMENT.PUSHED,
    label: "When pushed to",
    detail: `A push by ${PRODUCT_NAME}'s own agents never starts a run.`,
  },
];

const PULL_REQUEST_EVENTS: ReadonlySet<GitHubTriggerEvent> = new Set([
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_LABELED,
  GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED,
]);

function toggled<Value>(list: readonly Value[], value: Value, on: boolean): readonly Value[] {
  return on
    ? [...list.filter((each) => each !== value), value]
    : list.filter((each) => each !== value);
}

function GitHubSettingsRows({
  event,
  settings,
  onSettings,
}: {
  event: GitHubTriggerEvent;
  settings: GitHubTriggerSettings;
  onSettings: (settings: GitHubTriggerSettings) => void;
}): React.JSX.Element {
  return (
    <Reveal shown={event !== GITHUB_TRIGGER_EVENT.CHECK_FAILED}>
      {SENDER_CHOICES.map((choice) => (
        <SwitchRow
          key={choice.value}
          label={choice.label}
          labelReplayUnmasked
          detail={
            choice.detail === undefined ? undefined : <ReplayUnmask>{choice.detail}</ReplayUnmask>
          }
          checked={settings.senders.includes(choice.value)}
          onChange={(on) =>
            onSettings({ ...settings, senders: toggled(settings.senders, choice.value, on) })
          }
        />
      ))}
      <Reveal shown={event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED}>
        {MOMENT_CHOICES.map((choice) => (
          <SwitchRow
            key={choice.value}
            label={choice.label}
            labelReplayUnmasked
            detail={
              choice.detail === undefined ? undefined : <ReplayUnmask>{choice.detail}</ReplayUnmask>
            }
            checked={settings.moments.includes(choice.value)}
            onChange={(on) =>
              onSettings({ ...settings, moments: toggled(settings.moments, choice.value, on) })
            }
          />
        ))}
      </Reveal>
      <Reveal shown={PULL_REQUEST_EVENTS.has(event)}>
        <SwitchRow
          label="Skip drafts"
          labelReplayUnmasked
          detail={<ReplayUnmask>A draft starts a run once it is marked ready.</ReplayUnmask>}
          checked={!settings.drafts}
          onChange={(skip) => onSettings({ ...settings, drafts: !skip })}
        />
        <SwitchRow
          label="Include forks"
          labelReplayUnmasked
          detail={
            <ReplayUnmask>
              A fork's pull request is code from outside the repository, read by an agent that can
              push to it.
            </ReplayUnmask>
          }
          checked={settings.forks}
          onChange={(forks) => onSettings({ ...settings, forks })}
        />
      </Reveal>
    </Reveal>
  );
}

function FilterRow({
  label,
  detail,
  values,
  problem,
  onValues,
}: {
  label: string;
  detail: string;
  values: readonly string[];
  problem: string | undefined;
  onValues: (values: readonly string[]) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => values.join(", "));
  return (
    <SettingsRow
      label={<ReplayUnmask>{label}</ReplayUnmask>}
      description={<ReplayUnmask>{detail}</ReplayUnmask>}
      error={inputProblem(problem)}
    >
      {(control) => (
        <span className={AUTOMATION_FIELD}>
          <TextField
            ref={field}
            label={label}
            describedBy={control["aria-describedby"]}
            invalid={control["aria-invalid"]}
            autoCorrect={false}
            spellCheck={false}
            placeholder="All"
            value={text}
            onEscape={() => field.current?.blur()}
            onChange={(typed) => {
              setText(typed);
              onValues(filterValuesOf(typed));
            }}
          />
        </span>
      )}
    </SettingsRow>
  );
}

const sentryEventOf = optionValue(SENTRY_EVENTS);

function SentryRows({
  draft,
  sentry,
  withheld,
  problems,
  onDraft,
}: {
  draft: AutomationDraft;
  sentry: SentryOffer;
  withheld: boolean;
  problems: DraftProblems;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const hours = useRef<HTMLInputElement>(null);
  if (withheld) {
    return (
      <SettingsRow
        label={<ReplayUnmask>Sentry isn't available</ReplayUnmask>}
        description={<ReplayUnmask>{SENTRY_WITHHELD}</ReplayUnmask>}
      >
        {() => null}
      </SettingsRow>
    );
  }
  if (sentry.read !== undefined && sentry.read.installations.length === 0) {
    return (
      <SettingsRow
        label={<ReplayUnmask>Sentry isn't installed</ReplayUnmask>}
        error={
          sentry.refusal === undefined
            ? undefined
            : {
                words: sentry.refusal,
                failure: failureShown({
                  surface: FAILURE_SURFACE.AUTOMATION_SENTRY_INSTALL,
                  cause: FAILURE_CONDITION.REFUSED,
                  refused: true,
                }),
              }
        }
      >
        {() => (
          <ReplayUnmask>
            <Button
              variant={BUTTON_VARIANT.PRIMARY}
              busy={sentry.installing}
              busyLabel="Opening Sentry"
              onClick={sentry.onInstall}
            >
              Install Sentry
            </Button>
          </ReplayUnmask>
        )}
      </SettingsRow>
    );
  }
  const trigger = draft.integrationTrigger;
  const filter = (filters: IntegrationTriggerFilters) =>
    onDraft(withIntegrationFilters(draft, filters));
  return (
    <>
      {sentry.failed ? (
        <SettingsRow
          label={<ReplayUnmask>Sentry</ReplayUnmask>}
          below={() => (
            <ReplayUnmask>
              <ErrorState
                onRetry={sentry.onRetry}
                failure={unreadShown(FAILURE_SURFACE.AUTOMATION_SENTRY_READ)}
              >
                {SENTRY_UNREAD}
              </ErrorState>
            </ReplayUnmask>
          )}
        />
      ) : null}
      <SelectRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Event"
        labelReplayUnmasked
        detail={SENTRY_EVENT_DETAIL[trigger.event]}
        value={trigger.event}
        options={SENTRY_EVENTS}
        parse={sentryEventOf}
        onChange={(event) => onDraft(withIntegrationEvent(draft, event))}
      />
      <FilterRow
        label="Projects"
        detail="Project slugs, comma-separated."
        values={trigger.filters?.project ?? []}
        problem={
          filterAdmitted(trigger.filters?.project) ? undefined : problems[DRAFT_FIELD.FILTERS]
        }
        onValues={(project) => filter({ project })}
      />
      <FilterRow
        label="Environments"
        detail="Comma-separated."
        values={trigger.filters?.environment ?? []}
        problem={
          filterAdmitted(trigger.filters?.environment) ? undefined : problems[DRAFT_FIELD.FILTERS]
        }
        onValues={(environment) => filter({ environment })}
      />
      <SettingsRow
        label={<ReplayUnmask>Levels</ReplayUnmask>}
        description={<ReplayUnmask>None picked for every level.</ReplayUnmask>}
        below={() => (
          <ReplayUnmask>
            <ChoiceList
              legend="Levels"
              select={CHOICE_SELECT.MANY}
              look={CHOICE_LOOK.PILL}
              options={SENTRY_LEVELS}
              value={trigger.filters?.level ?? []}
              onChange={(level) => filter({ level })}
            />
          </ReplayUnmask>
        )}
      />
      <SettingsRow
        label={<ReplayUnmask>Same issue again after</ReplayUnmask>}
        description={
          <ReplayUnmask>{`Hours, from 1 to ${AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS}.`}</ReplayUnmask>
        }
        error={inputProblem(problems[DRAFT_FIELD.COOLDOWN])}
      >
        {(control) => (
          <span className={AUTOMATION_FIELD}>
            <TextField
              ref={hours}
              type={TEXT_FIELD_TYPE.NUMBER}
              inputMode={TEXT_FIELD_INPUT_MODE.NUMERIC}
              label="Hours before the same issue runs again"
              describedBy={control["aria-describedby"]}
              invalid={control["aria-invalid"]}
              value={draft.subjectCooldownHours}
              onEscape={() => hours.current?.blur()}
              onChange={(subjectCooldownHours) => onDraft({ subjectCooldownHours })}
            />
          </span>
        )}
      </SettingsRow>
    </>
  );
}

const NEW_SECRET_REFUSAL_WORDS = {
  ...SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "The secret could not be made. Try again.",
} as const satisfies Record<AutomationCallFailure, string>;

function ShownSecretRow({
  secret,
  onDone,
}: {
  secret: string;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <div className="ph-no-capture">
      <SettingsRow
        label="Secret"
        description="You won't be able to see this again. Copy it into your sender now."
      >
        {() => (
          <>
            <CopyField label="Secret" value={secret} what="secret" copy={copyThroughShell} />
            <Button onClick={onDone}>Done</Button>
          </>
        )}
      </SettingsRow>
    </div>
  );
}

function WebhookRows({
  automation,
  writes,
  secret,
  onSecret,
}: {
  automation: AutomationSummary | undefined;
  writes: AutomationWrites;
  secret: string | undefined;
  onSecret: (secret: string | undefined) => void;
}): React.JSX.Element {
  const minting = useMutation(WEBHOOK_SECRET_MUTATION);
  const rotationAct = useConfirmAct(minting, {
    send: () => {
      if (automation === undefined) return Promise.resolve();
      onSecret(undefined);
      return minting.mutateAsync(automation.id).then((answer) => {
        if (!("failure" in answer)) onSecret(answer.webhookSecret);
      });
    },
    answered: (answer): ActionResult =>
      "failure" in answer
        ? {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: NEW_SECRET_REFUSAL_WORDS[answer.failure],
          }
        : ACCEPTED,
  });
  const rotation = useConfirmDialog(
    { subject: automation !== undefined, surfaceOpen: true },
    rotationAct,
    confirmFailure(FAILURE_SURFACE.AUTOMATION_SECRET_ROTATE, { automationId: automation?.id }),
  );
  const url =
    automation?.trigger.kind === AUTOMATION_TRIGGER.WEBHOOK ? automation.webhookUrl : undefined;
  if (automation === undefined || url === undefined) {
    return (
      <SettingsRow
        label={<ReplayUnmask>Address</ReplayUnmask>}
        description={
          <ReplayUnmask>
            Save it as a webhook to get its address and a secret to call it with.
          </ReplayUnmask>
        }
      >
        {() => null}
      </SettingsRow>
    );
  }
  return (
    <>
      <SettingsRow
        label={<ReplayUnmask>Address</ReplayUnmask>}
        description={
          <ReplayUnmask>
            POST to the address with the secret as <code>Authorization: Bearer</code>. Don't send
            secrets in the body: {PRODUCT_NAME} hands the body to the run's agent, and it shows in
            the run's transcript.
          </ReplayUnmask>
        }
      >
        {() => (
          <>
            <CopyField label="Webhook address" value={url} what="address" copy={copyThroughShell} />
          </>
        )}
      </SettingsRow>
      {secret === undefined ? (
        <SettingsRow label={<ReplayUnmask>Secret</ReplayUnmask>}>
          {() => (
            <ReplayUnmask>
              <Button variant={BUTTON_VARIANT.OUTLINE} onClick={rotation.ask}>
                New secret
              </Button>
            </ReplayUnmask>
          )}
        </SettingsRow>
      ) : (
        <ShownSecretRow key={secret} secret={secret} onDone={() => onSecret(undefined)} />
      )}
      <ConfirmDialog
        open
        confirm={rotation}
        question={{
          title: "Make a new secret?",
          body: `The secret your sender uses now stops working until you give it the new one, which ${PRODUCT_NAME} shows you once. ${IRREVERSIBLE_WORDS}`,
          verb: "Make secret",
          running: "Making",
          replayUnmasked: true,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </>
  );
}

const TARGETS: readonly { value: AutomationTargetKind; label: string }[] = [
  { value: AUTOMATION_TARGET.NEW_AGENT, label: "New agent each run" },
  { value: AUTOMATION_TARGET.SAME_AGENT, label: "Same agent" },
];

function ModelPicker({
  models,
  modelsFailed,
  readModels,
  onChoose,
}: {
  models: RunChoices["models"];
  modelsFailed: boolean;
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
    <div className="automation-model-picker relative flex min-w-0" ref={root}>
      <Chip
        ref={trigger}
        look={CHIP_LOOK.FIELD}
        width={CHIP_WIDTH.MIN_FIELD}
        chevron
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <ChipName>
          <ReplayUnmask>Choose a model</ReplayUnmask>
        </ChipName>
      </Chip>
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          align={POPOVER_ALIGN.END}
          models={models}
          failed={modelsFailed}
          onRetry={readModels}
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
      ) : null}
    </div>
  );
}

function ModelRow({
  draft,
  mine,
  choices,
  onDraft,
}: {
  draft: AutomationDraft;
  mine: boolean;
  choices: RunChoices;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const shown = draft.choice ?? choices.defaultChoice;
  const note =
    shown !== undefined
      ? draft.choice === null
        ? "Your default, until you choose one."
        : undefined
      : choices.defaultFailed
        ? "It runs on your default model, which could not be read."
        : "Your default model.";
  return (
    <SettingsRow
      label={<ReplayUnmask>Model</ReplayUnmask>}
      description={note === undefined ? undefined : <ReplayUnmask>{note}</ReplayUnmask>}
    >
      {() =>
        shown !== undefined ? (
          <AgentModelChip
            model={{ choice: shown, note: undefined, choose: (choice) => onDraft({ choice }) }}
            models={choices.models}
            modelsFailed={choices.modelsFailed}
            readModels={choices.readModels}
            usage={undefined}
            look={CHIP_LOOK.FIELD}
            width={CHIP_WIDTH.MIN_FIELD}
            startsNew={mine}
          />
        ) : choices.defaultFailed ? (
          <ModelPicker
            models={choices.models}
            modelsFailed={choices.modelsFailed}
            readModels={choices.readModels}
            onChoose={(choice) => onDraft({ choice })}
          />
        ) : null
      }
    </SettingsRow>
  );
}

const KEPT_AGENT_LABEL = "The agent it goes to now";

const AGENTS_UNREAD = readFailedWords("the workspace's agents");
const AGENT_SEARCH_FAILED = readFailedWords("the search for agents");

const AGENT_DETAIL =
  "Each run is sent to that agent as a message, even mid-turn. It keeps its own model and effort.";

const FIRST_RUN_LABEL = "Started by its first run";
const FIRST_RUN_ROW = "first-run";
const FIRST_RUN_DETAIL =
  "Every later run is sent to it. If it is archived or deleted, the next run starts another.";

function AgentRow({
  draft,
  savedAgentId,
  choices,
  onDraft,
}: {
  draft: AutomationDraft;
  savedAgentId: string | null;
  choices: RunChoices;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const {
    agents,
    found,
    models,
    searched: words,
    searchAgents,
    searchFailed,
    retryAgents,
  } = choices;
  const [picked, setPicked] = useState<MentionableAgent | undefined>(undefined);
  const known = useKnownNames();
  const place = useAgentRowPlace();
  const drawn = { ...place, models: models ?? place.models };
  const detail = draft.agentId === null ? FIRST_RUN_DETAIL : AGENT_DETAIL;
  if (agents !== undefined && "failed" in agents) {
    return (
      <SettingsRow
        label={<ReplayUnmask>Agent</ReplayUnmask>}
        description={<ReplayUnmask>{detail}</ReplayUnmask>}
        below={() => (
          <ReplayUnmask>
            <ErrorState
              onRetry={retryAgents}
              failure={unreadShown(FAILURE_SURFACE.AUTOMATION_AGENTS_READ)}
            >
              {AGENTS_UNREAD}
            </ErrorState>
          </ReplayUnmask>
        )}
      />
    );
  }
  const offered = (agents?.agents ?? []).map((agent) =>
    mentionableAgent(agent, known.tasks, drawn.models),
  );
  const searched = found?.map((agent) => mentionableAgent(agent, known.tasks, drawn.models));
  const matched = new Set(
    matchingRows(
      offered.map((agent) => agentMenuRow(agent, drawn)),
      words,
    ).map((row) => row.id),
  );
  const listed =
    words === ""
      ? offered
      : [
          ...offered.filter((agent) => matched.has(agent.id)),
          ...(searched ?? []).filter((agent) => !matched.has(agent.id)),
        ];
  const chosen =
    offered.find((agent) => agent.id === draft.agentId) ??
    searched?.find((agent) => agent.id === draft.agentId) ??
    (picked?.id === draft.agentId ? picked : undefined);
  const chosenRow = chosen === undefined ? undefined : agentMenuRow(chosen, drawn);
  const kept =
    savedAgentId !== null && !offered.some((agent) => agent.id === savedAgentId)
      ? savedAgentId
      : undefined;
  const rows = [
    ...(words !== "" ? [] : [{ id: FIRST_RUN_ROW, label: FIRST_RUN_LABEL }]),
    ...(kept === undefined || words !== "" ? [] : [{ id: kept, label: KEPT_AGENT_LABEL }]),
    ...listed.map((agent) => ({ ...agentMenuRow(agent, drawn), replayMasked: true })),
  ];
  return (
    <PickerRow
      width={CHIP_WIDTH.MIN_FIELD}
      label="Agent"
      labelReplayUnmasked
      detail={<ReplayUnmask>{detail}</ReplayUnmask>}
      replayUnmasked
      value={draft.agentId ?? FIRST_RUN_ROW}
      valueLabel={
        chosenRow !== undefined
          ? chosenRow.label
          : draft.agentId === null
            ? FIRST_RUN_LABEL
            : draft.agentId === kept
              ? KEPT_AGENT_LABEL
              : "Choose an agent"
      }
      valueIcon={chosenRow?.icon}
      rows={rows}
      placeholder="Search agents"
      note={
        words !== "" ? (
          searchFailed ? (
            <ErrorState
              onRetry={retryAgents}
              failure={unreadShown(FAILURE_SURFACE.AUTOMATION_AGENTS_SEARCH)}
            >
              {AGENT_SEARCH_FAILED}
            </ErrorState>
          ) : undefined
        ) : agents === undefined ? (
          <Spinner delay label={readingWords("agents")} />
        ) : listed.length === 0 && kept === undefined ? (
          "No agents of this workspace work in it yet."
        ) : undefined
      }
      noMatch={NO_MATCH.AGENTS}
      onOpen={() => searchAgents("")}
      onSearch={searchAgents}
      onPick={(id) => {
        const agentId = id === FIRST_RUN_ROW ? null : id;
        setPicked(listed.find((agent) => agent.id === agentId));
        onDraft({ agentId });
      }}
    />
  );
}

const targetOf = optionValue(TARGETS);

function RunsGroup({
  draft,
  mine,
  savedAgentId,
  workspace,
  problems,
  taskBacked,
  repositories,
  slackOffered,
  onDraft,
}: {
  draft: AutomationDraft;
  mine: boolean;
  savedAgentId: string | null;
  workspace: Workspace | undefined;
  problems: DraftProblems;
  taskBacked: boolean;
  repositories: RepositoryChooser;
  slackOffered: boolean;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  const sameAgent = draft.target === AUTOMATION_TARGET.SAME_AGENT;
  const choices = useRunChoices({
    workspaceId: workspace?.id,
    repository: draft.repository,
    wantsAgents: sameAgent,
  });
  const also = draft.alsoRepositories.filter((repository) => repository !== draft.repository);
  return (
    <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.WHERE_IT_RUNS}</ReplayUnmask>}>
      <SettingsRow
        label={<ReplayUnmask>Repository</ReplayUnmask>}
        description={
          taskBacked ? (
            <ReplayUnmask>Its task's repository.</ReplayUnmask>
          ) : also.length === 0 ||
            (draft.repository === null &&
              draft.triggerKind !== AUTOMATION_TRIGGER.GITHUB) ? undefined : (
            <ReplayUnmask>
              Runs start here, and also work in <ReplayMask>{andList(also)}</ReplayMask>.
            </ReplayUnmask>
          )
        }
        error={inputProblem(problems[DRAFT_FIELD.REPOSITORY])}
      >
        {(control) =>
          taskBacked ? null : (
            <RepositoryChip
              key={repositories.scope}
              place={CHIP_PLACE.FIELD}
              width={CHIP_WIDTH.MIN_FIELD}
              describedBy={control["aria-describedby"]}
              invalid={control["aria-invalid"]}
              value={draft.repository}
              chooser={repositories}
              onChoose={(repository) => onDraft(withRepository(draft, repository))}
              onClear={
                draft.triggerKind === AUTOMATION_TRIGGER.GITHUB
                  ? undefined
                  : () => onDraft(withRepository(draft, null))
              }
            />
          )
        }
      </SettingsRow>
      <SelectRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Runs land in"
        labelReplayUnmasked
        value={draft.target}
        options={TARGETS}
        parse={targetOf}
        onChange={(target) => onDraft({ target })}
      />
      <RevealChoice value={draft.target}>
        {(target) =>
          target === AUTOMATION_TARGET.SAME_AGENT ? (
            <AgentRow
              draft={draft}
              savedAgentId={savedAgentId}
              choices={choices}
              onDraft={onDraft}
            />
          ) : (
            <>
              <ModelRow draft={draft} mine={mine} choices={choices} onDraft={onDraft} />
              <ServersRow
                mine={mine}
                disabled={draft.disabledServers}
                onSwitch={(disabledServers) => onDraft({ disabledServers })}
              />
              <SwitchRow
                label="Archive finished runs"
                labelReplayUnmasked
                detail={<ReplayUnmask>Its transcript and pull request are kept.</ReplayUnmask>}
                checked={draft.archiveSuccessful}
                onChange={(archiveSuccessful) => onDraft({ archiveSuccessful })}
              />
            </>
          )
        }
      </RevealChoice>
      {slackOffered ? (
        <SwitchRow
          label="Send the result to me on Slack"
          labelReplayUnmasked
          detail={
            <ReplayUnmask>The workspace's Slack bot sends each run's final message.</ReplayUnmask>
          }
          checked={draft.slackDelivery}
          onChange={(slackDelivery) => onDraft({ slackDelivery })}
        />
      ) : null}
    </SettingsSection>
  );
}

const triggerKindOf = optionValue(TRIGGERS);

const githubEventOf = optionValue(GITHUB_EVENTS);

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
  sentry,
  slackBot,
  onDraft,
  onUnreadableTime,
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
  savedAgentId: string | null;
  sentry: SentryOffer;
  slackBot: boolean;
  onDraft: (patch: Partial<AutomationDraft>) => void;
  onUnreadableTime: (unreadable: boolean) => void;
}): React.JSX.Element {
  const triggers =
    sentry.read?.configured === false && draft.triggerKind !== AUTOMATION_TRIGGER.INTEGRATION
      ? TRIGGERS.map((trigger) =>
          trigger.value === AUTOMATION_TRIGGER.INTEGRATION
            ? { ...trigger, disabled: SENTRY_NOT_SET_UP }
            : trigger,
        )
      : TRIGGERS;
  const prompt = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const workspaceName = workspace?.name ?? "Workspace";
  const mine = automation === undefined || automation.mine === true;
  const maker = useCreator(
    automation?.creatorId === undefined ? {} : { ownerId: automation.creatorId },
  );
  const owners = [
    {
      value: AUTOMATION_SCOPE.PERSONAL,
      label: automationOwnerName(AUTOMATION_SCOPE.PERSONAL, undefined, mine),
    },
    { value: AUTOMATION_SCOPE.WORKSPACE, label: workspaceName },
  ] as const;
  return (
    <RevealArea root={form}>
      <AutomationForm ref={form} {...revealArea()}>
        {offersOwner ? (
          <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.SHARING}</ReplayUnmask>}>
            <OwnerRow
              owner={draft.owner}
              owners={owners}
              mine={mine}
              maker={maker}
              workspace={workspace}
              onOwner={(owner) => onDraft({ owner })}
            />
            {automation === undefined ? null : <MakerRow maker={maker} at={automation.createdAt} />}
          </SettingsSection>
        ) : null}
        <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.TRIGGER}</ReplayUnmask>}>
          <SelectRow
            width={CHIP_WIDTH.MIN_FIELD}
            label="Type"
            labelReplayUnmasked
            detail={automationTriggerText(draftTrigger(draft), draftRepositories(draft))}
            value={draft.triggerKind}
            options={triggers}
            parse={triggerKindOf}
            error={
              draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE
                ? undefined
                : inputProblem(problems[DRAFT_FIELD.SCHEDULE])
            }
            onChange={(triggerKind) => onDraft({ triggerKind })}
          />
          <RevealChoice value={draft.triggerKind}>
            {(kind) =>
              kind === AUTOMATION_TRIGGER.SCHEDULE ? (
                <ScheduleRows
                  draft={draft}
                  problem={problems[DRAFT_FIELD.SCHEDULE]}
                  onSchedule={(schedule) => onDraft({ schedule })}
                  onTimezone={(timezone) => onDraft({ timezone })}
                  onUnreadableTime={onUnreadableTime}
                />
              ) : kind === AUTOMATION_TRIGGER.GITHUB ? (
                <>
                  <SelectRow
                    width={CHIP_WIDTH.MIN_FIELD}
                    label="Event"
                    labelReplayUnmasked
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
              ) : kind === AUTOMATION_TRIGGER.INTEGRATION ? (
                <SentryRows
                  draft={draft}
                  sentry={sentry}
                  withheld={sentryWithheld(sentry, automation, draft)}
                  problems={problems}
                  onDraft={onDraft}
                />
              ) : (
                <WebhookRows
                  automation={automation}
                  writes={writes}
                  secret={shownSecret}
                  onSecret={onSecret}
                />
              )
            }
          </RevealChoice>
        </SettingsSection>
        <SettingsSection
          title={<ReplayUnmask>{EDITOR_SECTION.PROMPT}</ReplayUnmask>}
          frame={SETTINGS_SECTION_FRAME.NONE}
        >
          <TextArea
            ref={prompt}
            label="Prompt"
            rows={PROMPT_ROWS}
            placeholder="Find the flakiest test in CI this week and fix it."
            value={draft.prompt}
            invalid={problems[DRAFT_FIELD.PROMPT] !== undefined}
            onEscape={() => prompt.current?.blur()}
            onChange={(text) => onDraft({ prompt: text })}
          />
          {problems[DRAFT_FIELD.PROMPT] === undefined ? null : (
            <ErrorState failure={UNREPORTED.INPUT}>
              <ReplayUnmask>{problems[DRAFT_FIELD.PROMPT]}</ReplayUnmask>
            </ErrorState>
          )}
        </SettingsSection>
        <RunsGroup
          draft={draft}
          mine={automation === undefined || automation.mine === true}
          savedAgentId={savedAgentId}
          workspace={workspace}
          problems={problems}
          taskBacked={taskBacked}
          repositories={repositories}
          slackOffered={slackBot || automation?.slackDelivery === true}
          onDraft={onDraft}
        />
      </AutomationForm>
    </RevealArea>
  );
}

function AutomationPageFrame({
  screenRef,
  layoutRef,
  hidden,
  title,
  toolbar,
  setup,
  beside,
  children,
}: {
  screenRef?: Ref<HTMLDivElement> | undefined;
  layoutRef?: RefObject<HTMLDivElement | null> | undefined;
  hidden?: boolean | undefined;
  title: ReactNode;
  toolbar: (pickUp: ToolbarPickUp) => ReactNode;
  setup: ReactNode;
  beside: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const [pickUp, setPickUp] = useState<ToolbarPickUp>({ name: "", shown: false });
  return (
    <Fill ref={screenRef} className="automations-view">
      <Fill className="automation-editor-screen [&[hidden]]:hidden" hidden={hidden}>
        {toolbar(pickUp)}
        <div ref={layoutRef} className="automation-editor-layout relative flex min-h-0 flex-1">
          <DetailPage frame={PAGE_FRAME.PAGE} title={title} onPickUp={setPickUp}>
            {setup}
          </DetailPage>
          {beside}
        </div>
      </Fill>
      {children}
    </Fill>
  );
}

function AutomationSetup({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="automation-editor flex flex-col gap-block-gap">{children}</div>;
}

function AutomationForm({
  ref,
  children,
  ...area
}: {
  ref?: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
} & Partial<ReturnType<typeof revealArea>>): React.JSX.Element {
  return (
    <div
      ref={ref}
      className="automation-form flex flex-col gap-page-section-gap [&_.settings-picker]:max-w-full"
      {...area}
    >
      {children}
    </div>
  );
}

function PromptSkeleton(): React.JSX.Element {
  return (
    <div
      className="automation-prompt-skeleton"
      style={cssCustomProperties({ "--automation-prompt-rows": String(PROMPT_ROWS) })}
    >
      <Skeleton shape={SKELETON_SHAPE.BLOCK} />
    </div>
  );
}

function EditorSkeleton({ offersOwner }: { offersOwner: boolean }): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_AUTOMATION}>
      <AutomationSetup>
        <Skeleton shape={SKELETON_SHAPE.CONTROL} />
        <AutomationForm>
          {offersOwner ? (
            <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.SHARING}</ReplayUnmask>}>
              <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.SHARING]} />
            </SettingsSection>
          ) : null}
          <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.TRIGGER}</ReplayUnmask>}>
            <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.TRIGGER]} />
          </SettingsSection>
          <SettingsSection
            title={<ReplayUnmask>{EDITOR_SECTION.PROMPT}</ReplayUnmask>}
            frame={SETTINGS_SECTION_FRAME.NONE}
          >
            <PromptSkeleton />
          </SettingsSection>
          <SettingsSection title={<ReplayUnmask>{EDITOR_SECTION.WHERE_IT_RUNS}</ReplayUnmask>}>
            <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.WHERE_IT_RUNS]} />
          </SettingsSection>
        </AutomationForm>
      </AutomationSetup>
    </SkeletonRegion>
  );
}

function EditorActsSkeleton(): React.JSX.Element {
  return (
    <>
      <EditorStatus>
        <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
          <Skeleton width={SKELETON_ACTS.STATUS} />
        </Text>
      </EditorStatus>
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.RUN_NOW} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.SAVE} />
      <SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SWITCH} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ICON_PRESS_WIDTH} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ICON_PRESS_WIDTH} />
    </>
  );
}

export function AutomationPageSkeleton({
  room,
  offersOwner,
  onBack,
}: {
  room: ShellRoom;
  offersOwner: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const runsPanel = useRunsPanel();
  return (
    <AutomationPageFrame
      title={
        <Inline gap={GAP.CONTROL}>
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={actorMarkWidth(ACTOR_SIZE.PAGE)} />
          <Skeleton width={SKELETON_NAME.TITLE} />
        </Inline>
      }
      toolbar={(pickUp) =>
        room === SHELL_ROOM.NARROW ? (
          <PhoneHead
            place="automation"
            start={<AutomationsBack onBack={onBack} />}
            pickUp={pickUp}
            end={null}
          />
        ) : (
          <EditorToolbarFrame pickUp={pickUp} onBack={onBack}>
            <EditorActsSkeleton />
          </EditorToolbarFrame>
        )
      }
      setup={<EditorSkeleton offersOwner={offersOwner} />}
      beside={
        room === SHELL_ROOM.NARROW ? null : (
          <AutomationRunsPanel
            panel={runsPanel}
            mine
            created
            automationId={undefined}
            runs={undefined}
            onRetry={() => undefined}
            onOpenAgent={() => undefined}
            onOpenSetup={() => undefined}
          />
        )
      }
    />
  );
}

const SETUP_COLUMN = ".ui-detail-page-main";

const EDITOR_SCREENS: NarrowColumns = {
  list: ":scope > .automation-editor-screen",
  item: ":scope > .automation-runs-screen",
};

export function AutomationEditor({
  automation,
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
  room,
  runsShown,
  onRuns,
  sentry,
  slackBot,
}: {
  automation: AutomationSummary | undefined;
  workspace: Workspace | undefined;
  offersOwner: boolean;
  repositories: RepositoryChooser;
  writes: AutomationWrites;
  onBack: () => void;
  onCreated: (automationId: string) => void;
  onDeleted: (automationId: string) => void;
  onOpenAgent: (agentId: string) => void;
  linked?: { readonly runId?: string | undefined } | undefined;
  leaveGuard: LeaveGuard;
  room: ShellRoom;
  runsShown: boolean;
  onRuns: (shown: boolean) => void;
  sentry: SentryOffer;
  slackBot: boolean;
}): React.JSX.Element {
  const runs = useAutomationRuns(automation?.id);
  const linkedRun = linked?.runId;
  const [running, setRunning] = useState(false);
  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: readerZone(),
    owner: AUTOMATION_SCOPE.PERSONAL,
  }));
  const [start] = useState(() =>
    automation !== undefined
      ? automationDraft(automation, defaults)
      : { ...automationDraft(undefined, defaults), repository: repositories.recent[0] ?? null },
  );
  const [draft, setDraft] = useState(start);
  const [shownProblems, setShownProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [shownSecret, setShownSecret] = useState<string | undefined>(undefined);
  const taskBacked = automation !== undefined && automation.planId !== null;
  const change = automation === undefined ? undefined : changeOf(draft, automation, defaults);
  const saved = automation === undefined ? undefined : automationDraft(automation, defaults);
  const [unreadableTime, setUnreadableTime] = useState(false);
  const dirty = saved === undefined || !sameDraft(draft, saved) || unreadableTime;
  const savedAgentId =
    saved !== undefined && saved.repository === draft.repository ? saved.agentId : null;
  const written = automation === undefined ? unreadableTime || !sameDraft(draft, start) : dirty;
  const narrow = room === SHELL_ROOM.NARROW;
  const split = useScreenSplit(room);
  const { single } = split;
  const runsAlone = single && runsShown;
  const hidden = hiddenColumns(split.columns, !runsAlone);
  const screen = useScreenRef(useNarrowFocus(split.columns, !runsAlone, EDITOR_SCREENS), split.ref);
  const runsScreen = useId();
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, runsAlone ? () => onRuns(false) : onBack);
  const runsPanel = useRunsPanel();
  const toggleRuns = single ? () => onRuns(!runsShown) : runsPanel.onToggle;
  const editorLayout = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, toggleRuns);
  const showRuns = useRef(runsPanel.onShow);
  showRuns.current = runsPanel.onShow;
  useEffect(() => {
    if (linked?.runId !== undefined) showRuns.current();
  }, [linked]);
  const drafted = draftProblems(draft, repositoryHeld(automation), new Date());
  const problems: DraftProblems =
    unreadableTime && drafted[DRAFT_FIELD.SCHEDULE] === undefined
      ? { ...drafted, [DRAFT_FIELD.SCHEDULE]: UNREADABLE_TIME }
      : drafted;
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
    setShownProblems(false);
    if (answer.automation.trigger.kind !== AUTOMATION_TRIGGER.WEBHOOK) setShownSecret(undefined);
    else if (answer.webhookSecret !== undefined) setShownSecret(answer.webhookSecret);
    if (automation === undefined) leaveGuard.pass(() => onCreated(answer.automation.id));
  };
  const save = () => {
    if (sentryWithheld(sentry, automation, draft)) {
      setRefusal(SENTRY_WITHHELD);
      return;
    }
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
      if ("failure" in answer) setRefusal(RUN_REFUSAL_WORDS[answer.failure]);
    });
  };
  const [leavingBy, setLeavingBy] = useState<{ readonly leave: () => void } | undefined>(undefined);
  const leaving = useConfirmDialog(
    { subject: leavingBy !== undefined, surfaceOpen: true },
    neverBusyAct(() => leavingBy?.leave()),
    confirmFailure(FAILURE_SURFACE.AUTOMATION_LEAVE),
  );
  const askLeave = useRef<LeaveAsk>(() => undefined);
  askLeave.current = (leave) => {
    setLeavingBy({ leave });
    leaving.ask();
  };
  useEffect(
    () => (written ? leaveGuard.stand((leave) => askLeave.current(leave)) : undefined),
    [written, leaveGuard],
  );
  const toggle = (enabled: boolean) =>
    automation === undefined
      ? Promise.resolve<AutomationView>({ failure: AUTOMATION_CALL_FAILURE.NOT_FOUND })
      : writes.toggle(automation.id, enabled);
  const removing = useMutation(AUTOMATION_DELETE_MUTATION);
  const deletionAct = useConfirmAct(removing, {
    send: () => {
      if (automation === undefined) return Promise.resolve();
      return removing.mutateAsync(automation.id).then((answer) => {
        if (!("failure" in answer)) leaveGuard.pass(() => onDeleted(automation.id));
      });
    },
    answered: (answer): ActionResult =>
      "failure" in answer
        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: SAVE_REFUSAL_WORDS[answer.failure] }
        : ACCEPTED,
  });
  const deletion = useConfirmDialog(
    { subject: automation !== undefined, surfaceOpen: true },
    deletionAct,
    confirmFailure(FAILURE_SURFACE.AUTOMATION_DELETE, { automationId: automation?.id }),
  );
  const openSetup = () => {
    const column = editorLayout.current?.querySelector<HTMLElement>(SETUP_COLUMN);
    if (single) onRuns(false);
    else if (column) {
      column.scrollTop = 0;
      column.focus({ preventScroll: true });
    }
  };
  const runsRead = {
    mine: automation === undefined || automation.mine === true,
    created: automation !== undefined,
    automationId: automation?.id,
    linkedRun,
    runs: runs.read,
    onRetry: runs.reload,
    onOpenAgent,
    onOpenSetup: openSetup,
  };
  return (
    <AutomationPageFrame
      screenRef={screen}
      layoutRef={editorLayout}
      hidden={hidden.list}
      title={
        <EditorTitle
          automation={automation}
          name={draft.name}
          nameField={nameField}
          invalid={shownProblems && problems[DRAFT_FIELD.NAME] !== undefined}
          onName={(name) => editDraft({ name })}
        />
      }
      toolbar={(pickUp) => (
        <EditorToolbar
          automation={automation}
          pickUp={{
            ...pickUp,
            name:
              draft.name.trim() ||
              (automation === undefined ? NEW_AUTOMATION : UNTITLED_AUTOMATION),
          }}
          dirty={dirty}
          saving={saving}
          saveRefused={refusal !== undefined}
          onBack={onBack}
          onSave={save}
          onToggle={toggle}
          onDelete={deletion.ask}
          running={running}
          onRunNow={runNow}
          runs={{
            shown: runsPanel.open,
            screen: single ? runsScreen : undefined,
            onPress: toggleRuns,
          }}
          narrow={narrow}
        />
      )}
      setup={
        <AutomationSetup>
          {shownProblems && problems[DRAFT_FIELD.NAME] !== undefined ? (
            <FailureNote failure={UNREPORTED.INPUT}>
              <ReplayUnmask>{problems[DRAFT_FIELD.NAME]}</ReplayUnmask>
            </FailureNote>
          ) : null}
          {refusal === undefined ? null : (
            <FailureNote
              failure={failureShown({
                surface: FAILURE_SURFACE.AUTOMATION_SAVE,
                cause: FAILURE_CONDITION.REFUSED,
                about: { automationId: automation?.id },
                refused: true,
              })}
            >
              <ReplayUnmask>{refusal}</ReplayUnmask>
            </FailureNote>
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
            sentry={sentry}
            slackBot={slackBot}
            onDraft={editDraft}
            onUnreadableTime={setUnreadableTime}
          />
        </AutomationSetup>
      }
      beside={
        <>
          {single ? null : <AutomationRunsPanel panel={runsPanel} {...runsRead} />}
          <PaneGlide root={editorLayout} layout={{ runsOpen: !single && runsPanel.open }} />
        </>
      }
    >
      {single ? (
        <AutomationRunsScreen
          id={runsScreen}
          name={automation === undefined ? NEW_AUTOMATION : automation.name}
          hidden={hidden.item}
          onBack={() => onRuns(false)}
          {...runsRead}
        />
      ) : null}
      <ConfirmDialog
        open
        confirm={leaving}
        question={{
          title: "Leave with unsaved changes?",
          body: `Your changes to this automation are lost. ${IRREVERSIBLE_WORDS}`,
          verb: "Leave",
          running: "Leaving",
          replayUnmasked: true,
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
      <ConfirmDialog
        open
        confirm={deletion}
        question={automationDeleteQuestion(automation?.name)}
      />
    </AutomationPageFrame>
  );
}
