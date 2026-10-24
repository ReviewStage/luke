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
  presetDraft,
  repositoryHeld,
  SCHEDULE_KIND,
  type ScheduleDraft,
  type ScheduleKind,
  sameDraft,
  withGithubEvent,
  withIntegrationEvent,
  withIntegrationFilters,
  withRepository,
} from "@luke/features/automation-draft-model";
import { automationTriggerText } from "@luke/features/automation-list-model";
import { readSchedule, SCHEDULE_REFUSAL } from "@luke/features/automation-schedule";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCallFailure,
  type AutomationChangeParams,
  type AutomationCreateParams,
  type AutomationDeletedView,
  type AutomationView,
} from "@luke/features/automation-view";
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
} from "@luke/features/automation-wire";
import { readerZone } from "@luke/features/date-mention";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import type { ModelChoice } from "@luke/features/models-wire";
import type { WorkspaceSentry } from "@luke/features/sentry-install-wire";
import { dayAndTimeText, timeZoneNames } from "@luke/features/time-format";
import {
  SENTRY_LEVEL,
  SENTRY_TRIGGER_EVENT,
  type SentryLevel,
  type SentryTriggerEvent,
} from "@luke/features/trigger-catalog";
import { andList, noMatchWords, readFailedWords, readingWords, TERM } from "@luke/features/words";
import type { Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
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
  CopyButton,
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
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useOptimisticSettingWrite } from "@luke/ui/use-setting-write";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { Result } from "effect";
import { HistoryIcon, PlayIcon, SaveIcon, Trash2Icon, ZapIcon } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ActorMark, automationActor } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { copyThroughShell } from "../copy-feedback.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ExperimentTag, SendFeedbackButton, useSendFeedbackItem } from "../experiment-marks.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
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
import { useExperiment } from "../use-app-state.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { OWNER_MARK_SIZE, OwnerMark } from "./automation-owner.js";
import { AutomationRunsPanel, AutomationRunsScreen } from "./automation-runs-panel.js";
import { automationOwnerName } from "./automation-words.js";
import { useRunsPanel } from "./folded-groups.js";
import { type NarrowColumns, useNarrowFocus } from "./narrow-focus.js";
import { PaneGlide } from "./pane-motion.js";
import { PhoneHead } from "./phone-head.js";
import { useAutomationRuns } from "./use-automation-runs.js";
import { type RunChoices, useRunChoices } from "./use-run-choices.js";

/**
 * automation-editor.tsx -- one automation's page, or a new one's: who owns it, its name, its schedule, its task, and its repository, saved by an explicit Create or Save.
 *
 * It stands where the list stood, in the task's place, and the first crumb
 * goes back to the list. Its form is drawn as a Settings page is, from
 * Settings' own rows: a group per part, each a card of rows naming a
 * setting and why on the left and its control on the right, every pick a
 * Settings picker on the window's menu and every yes or no a switch. Who
 * owns it is the form's first row, wherever a team workspace offers the
 * choice: Only you under the account's own picture, or the workspace under
 * its photo (`automation-owner.tsx`). Where its runs land is picked: a new agent each
 * run, on the agent box's model chip and archived once it succeeds where
 * asked, or the same agent, chosen from the workspace's agents on its
 * repository. Its runs stand in the panel on
 * the right (`automation-runs-panel.tsx`), with Run now in the toolbar. A schedule is chosen as the
 * picker writes one, every hour, every day, on weekdays, or on one day of
 * the week, at a time in a zone, and a cron the picker did not write stands
 * as custom, kept as it was; its next two runs are said under it. What
 * stops a draft saving is said at its field once a save is pressed. A
 * Sentry trigger picks its event, keeps to the projects, environments, and
 * levels named, and waits so many hours before the same issue runs again;
 * where the workspace has no Sentry installed, an Install Sentry prompt
 * stands in its rows' place. A
 * save the service refuses says why in one line under the name. A save
 * sends only what moved (`automation-draft-model.ts`), so the model and the
 * target it runs on stand as they were.
 */

/**
 * The workspace's Sentry as the editor offers it: the read, nothing while
 * it is out or where it failed, whether it failed with the Retry that asks
 * again, and the install, with whether one is under way and why the last
 * was refused.
 */
export interface SentryOffer {
  readonly read: WorkspaceSentry | undefined;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly installing: boolean;
  readonly refusal: string | undefined;
  readonly onInstall: () => void;
}

/**
 * Whether a draft fires on Sentry where the deployment holds no Sentry
 * integration and the automation did not already: a choice made before the
 * read said so, which is held back from saving rather than written as a
 * trigger nothing can fire. One saved on Sentry stays as it was.
 */
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

/** Why Sentry cannot be picked where the deployment holds no Sentry integration, as the Type menu says it. */
const SENTRY_NOT_SET_UP = "Not set up on this deployment yet";

/** What the page says where a Sentry trigger is held back from saving. */
const SENTRY_WITHHELD = "Luke cannot receive Sentry events here. Choose another trigger.";

/** What the Trigger card says where the read of the workspace's Sentry did not land. */
const SENTRY_UNREAD = readFailedWords("the workspace's Sentry");

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
  { value: AUTOMATION_TRIGGER.INTEGRATION, label: "Sentry" },
];

/** The Sentry events the event menu offers, the recommended one first. */
const SENTRY_EVENTS: readonly { value: SentryTriggerEvent; label: string }[] = [
  { value: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED, label: "Alert triggered (recommended)" },
  { value: SENTRY_TRIGGER_EVENT.ISSUE_CREATED, label: "New issue" },
];

/** What each Sentry event's row says under its name: how it reaches Luke. */
const SENTRY_EVENT_DETAIL = {
  [SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED]:
    "Set the alert rule's action to send a notification to the Luke integration.",
  [SENTRY_TRIGGER_EVENT.ISSUE_CREATED]: "Every new issue in the installed organization's projects.",
} as const satisfies Record<SentryTriggerEvent, string>;

/** Sentry's levels as the level pills name them, least severe first. */
const SENTRY_LEVELS: readonly { value: SentryLevel; label: string }[] = [
  { value: SENTRY_LEVEL.DEBUG, label: "Debug" },
  { value: SENTRY_LEVEL.INFO, label: "Info" },
  { value: SENTRY_LEVEL.WARNING, label: "Warning" },
  { value: SENTRY_LEVEL.ERROR, label: "Error" },
  { value: SENTRY_LEVEL.FATAL, label: "Fatal" },
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
const TIME_ZONES = timeZoneNames();

/** What a short menu says where a search matches nothing, which it has no search to say. */
const NO_MATCH = {
  DAYS: "No days match",
  TIMES: "No times match",
  AGENTS: noMatchWords(TERM.AGENT),
} as const;

/** Why a save the service refused did not land, as the line under the name says it. */
const SAVE_REFUSAL_WORDS = {
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Could not save it. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_FOUND]: "This automation, or its workspace, is gone.",
  [AUTOMATION_CALL_FAILURE.NO_REPOSITORY]: "Choose the repository it works in.",
  [AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke cannot reach that repository from this workspace on GitHub.",
  [AUTOMATION_CALL_FAILURE.INVALID]:
    "Luke could not save it as written. Check its schedule and prompt.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can change it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** Why a Run now did not start a run, as the line under the name says it. */
const RUN_REFUSAL_WORDS = {
  ...SAVE_REFUSAL_WORDS,
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Could not run it now. Try again.",
  [AUTOMATION_CALL_FAILURE.NOT_PERMITTED]:
    "Only its creator, or the workspace's owners and admins, can run it.",
} as const satisfies Record<AutomationCallFailure, string>;

/** Why a switch did not move, as its toast says it. */
function toggleRefusal(answer: AutomationView, enabled: boolean): string | undefined {
  if (!("failure" in answer)) return undefined;
  if (answer.failure === AUTOMATION_CALL_FAILURE.NOT_PERMITTED) {
    return SAVE_REFUSAL_WORDS[AUTOMATION_CALL_FAILURE.NOT_PERMITTED];
  }
  return enabled ? "Could not turn it on. Try again." : "Could not turn it off. Try again.";
}

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/**
 * An automation's on/off switch, the list row's and the editor's alike. It
 * flips at once, from a local value, and a write the service refuses puts it
 * back and says why in a FAILED toast, as a settings switch does; it never
 * rests for a write.
 *
 * Note that its writes go one at a time, because the service reads and writes
 * each request on its own, so two in flight could commit in either order and
 * leave the opposite of the last press. A press made while one is out waits for
 * it, only the newest waiting press is sent, and one that would only repeat
 * what the burst just sent is not.
 */
export function AutomationSwitch({
  automation,
  write,
}: {
  automation: AutomationSummary;
  write: (enabled: boolean) => Promise<AutomationView>;
}): React.JSX.Element {
  const toast = useToast();
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const newest = useRef(0);
  const sent = useRef<boolean | undefined>(undefined);
  const send = (enabled: boolean, press: number): Promise<ActionResult> => {
    if (press !== newest.current || sent.current === enabled) return Promise.resolve(ACCEPTED);
    sent.current = enabled;
    const settle = () => {
      if (press === newest.current) sent.current = undefined;
    };
    return write(enabled).then(
      (answer): ActionResult => {
        const reason = toggleRefusal(answer, enabled);
        if (reason !== undefined) sent.current = undefined;
        settle();
        return reason === undefined ? ACCEPTED : { status: ACTION_RESULT_STATUS.REJECTED, reason };
      },
      (error: unknown) => {
        sent.current = undefined;
        throw error;
      },
    );
  };
  const { value, run } = useOptimisticSettingWrite(
    automation.enabled,
    (enabled) => {
      const press = ++newest.current;
      const answered = tail.current.then(() => send(enabled, press));
      tail.current = answered.catch(() => undefined);
      return answered;
    },
    (words) => toast({ words, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED }),
  );
  return (
    <Switch
      checked={value}
      label={value ? `Turn off ${automation.name}` : `Turn on ${automation.name}`}
      onChange={run}
      {...NO_CONTEXT_MENU}
    />
  );
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

/**
 * Who owns it, the form's first row: Only you under the account's own
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
  /** Whether the reading account made it, so Only you is drawn as its own; a new one is. */
  mine: boolean;
  workspace: Workspace | undefined;
  onOwner: (owner: AutomationScope) => void;
}): React.JSX.Element {
  const parse = optionValue(owners);
  return (
    <PickerRow
      width={CHIP_WIDTH.MIN_FIELD}
      label="Owner"
      detail={
        owner === AUTOMATION_SCOPE.WORKSPACE
          ? `Everyone in ${workspace?.name ?? "the workspace"} sees it, runs it, and turns it off. You, owners, and admins change it.`
          : "Only you see and change it. Owners and admins can see it and turn it off."
      }
      value={owner}
      valueLabel={automationOwnerName(owner, workspace?.name, mine)}
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
      noMatch="No owners match"
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
            : `Its creator's connected servers, but ${andList(disabled.map(switchedOffName))} switched off.`
        }
      >
        {() => null}
      </SettingsRow>
    );
  }
  return <OwnServersRow disabled={disabled} onSwitch={onSwitch} />;
}

/** Names as a sentence says them: "Linear", "Linear and Notion", "Linear, Notion, and Sentry". */
function namesSaid(providers: readonly IntegrationProvider[]): string {
  return andList(providers.map((provider) => INTEGRATION_NAME[provider]));
}

/** The most marks the servers chip holds before it counts the rest, so it stays a picker's width. */
const SERVERS_CHIP_MARKS = 4;

/** How wide the servers row's words stand while the connections are read, as a share of their line. */
const SERVERS_DETAIL_SKELETON = "40%";

/**
 * The servers row while no read of the owner's connections has answered:
 * blocks where the words and the chip will stand, claiming nothing, or the
 * failure and Retry where the read was refused.
 */
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
        label="MCP servers"
        below={() => (
          <ErrorState onRetry={onRetry}>Your connected servers could not be read.</ErrorState>
        )}
      />
    );
  }
  return <ServersRowSkeleton />;
}

/** The servers row while the connections are read: its name, and blocks where its words and its field chip will stand, claiming nothing. */
function ServersRowSkeleton(): React.JSX.Element {
  return (
    <SettingsRow label="MCP servers" description={<Skeleton width={SERVERS_DETAIL_SKELETON} />}>
      {() => (
        <SkeletonRegion label="Reading your connected servers…">
          <SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SELECT} />
        </SkeletonRegion>
      )}
    </SettingsRow>
  );
}

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
  // Note that no provider standing yet is a read still to answer, so the row claims nothing until one does.
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

/** Which field a schedule is written in: a cron for a custom one, a clock for the rest. */
const SCHEDULE_FIELD = {
  CRON: "cron",
  CLOCK: "clock",
} as const;

/**
 * A schedule's rows: how often, under its next runs; then the time, day,
 * or cron that kind asks for; then its zone, searched since every zone this
 * Mac knows is listed.
 */
function ScheduleRows({
  draft,
  problem,
  onSchedule,
  onTimezone,
}: {
  draft: AutomationDraft;
  /** What stops a save in the schedule, said under the row it is about. */
  problem: string | undefined;
  onSchedule: (schedule: ScheduleDraft) => void;
  onTimezone: (timezone: string) => void;
}): React.JSX.Element {
  // The cron's and the time's Escape lets go of the caret and keeps the press, as every field's here does.
  const cron = useRef<HTMLInputElement>(null);
  const time = useRef<HTMLInputElement>(null);
  const { schedule, timezone } = draft;
  const zones = TIME_ZONES.includes(timezone) ? TIME_ZONES : [timezone, ...TIME_ZONES];
  // Note that a zone Luke cannot read is said under the zone's row, and any other refusal under the cron's or the time's.
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
            <SettingsRow label="Cron" error={zoneRefused ? undefined : problem}>
              {(control) => (
                <span className="automation-field">
                  <TextField
                    ref={cron}
                    label="Cron"
                    describedBy={control["aria-describedby"]}
                    invalid={control["aria-invalid"]}
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
            <SettingsRow
              label={schedule.kind === SCHEDULE_KIND.WEEKLY ? "Day and time" : "Time"}
              error={zoneRefused ? undefined : problem}
            >
              {(control) => (
                <>
                  {schedule.kind === SCHEDULE_KIND.WEEKLY ? (
                    <Picker
                      width={CHIP_WIDTH.MIN_FIELD}
                      label="Day"
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
                    <span className="automation-field automation-time-field">
                      <TextField
                        ref={time}
                        type={TEXT_FIELD_TYPE.TIME}
                        label="Time"
                        describedBy={control["aria-describedby"]}
                        invalid={control["aria-invalid"]}
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
          )
        }
      </RevealChoice>
      <PickerRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Time zone"
        value={timezone}
        valueLabel={zoneLabel(timezone)}
        rows={zones.map((zone) => ({ id: zone, label: zoneLabel(zone) }))}
        placeholder="Search time zones"
        noMatch="No time zones match"
        error={zoneRefused ? problem : undefined}
        onPick={onTimezone}
      />
    </>
  );
}

/** The form's groups, by their headings, in the order the form stands them. */
const EDITOR_SECTION = {
  SHARING: "Sharing",
  TRIGGER: "Trigger",
  PROMPT: "Prompt",
  RUNS: "Runs",
} as const;

/** How many lines the prompt's field stands, written in or read. */
const PROMPT_ROWS = 5;

/**
 * The rows a saved automation's groups stand before it is read, as a
 * scheduled one, the kind most are, runs on a new agent each time: Sharing's
 * Owner; Trigger's Type, Repeats, Time, and Time zone; and Runs' Repository,
 * Runs land in, Model on the account's default, MCP servers, and Archive
 * successful runs, each with the words under its name where it says them.
 */
const SCHEDULED_ROWS = {
  [EDITOR_SECTION.SHARING]: [{ described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] }],
  [EDITOR_SECTION.TRIGGER]: [
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    // The time's field stands at a picker's width beside the pickers (`.automation-field`).
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
  ],
  [EDITOR_SECTION.RUNS]: [
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: false, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
    { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
  ],
} as const satisfies Record<string, readonly SettingsRowSkeletonShape[]>;

/** The automation's tile before its name, at an actor mark's inline size (`avatar.css`). */
const SKELETON_TITLE_MARK = "16px";

/** How wide a placeholder page's name stands. */
const SKELETON_NAME = { TITLE: "160px" } as const;

/** How wide the placeholder toolbar's worded acts stand: where the draft stands, Run now, and Save. */
const SKELETON_ACTS = { STATUS: "34px", RUN_NOW: "100px", SAVE: "56px" } as const;

/** An icon press's width, the ⋯'s and the Runs toggle's, as tall as it is wide. */
const ICON_PRESS_WIDTH = "var(--luke-control-height)";

/** What an automation's placeholder page says to a reader while the list is first read. */
const READING_AUTOMATION = "Reading the automation…";

/** What a new automation's page is called until it is made. */
const NEW_AUTOMATION = "New automation";

/** The place above the editor, which its toolbar's first crumb names and goes back to. */
const AUTOMATIONS_PLACE = "Automations";

/** The page's title: the automation's tile beside its name, the page's one `h1`. */
function EditorTitle({
  automation,
}: {
  automation: AutomationSummary | undefined;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <ActorMark
        actor={
          automation === undefined
            ? { kind: ACTOR_KIND.AUTOMATION, name: NEW_AUTOMATION, state: ACTOR_STATE.REST }
            : automationActor(automation)
        }
      />
      {automation === undefined ? NEW_AUTOMATION : automation.name}
    </Inline>
  );
}

/** What the editor's ⋯ is called. */
const ACTIONS_THING = "Automation";

/** The editor's ⋯: Copy link, the automation's, where the page hands down a workspace, and Delete, red, which asks first. */
function AutomationActions({
  automation,
  onDelete,
  lead = [],
  heading,
}: {
  /** The automation, whose link and Delete the menu offers; none on a new automation's page, a phone's alone. */
  automation: AutomationSummary | undefined;
  onDelete: () => void;
  /** Groups over the automation's own, as a phone's ⋯ leads with the toolbar's acts (`EditorToolbar`); none elsewhere. */
  lead?: readonly MenuAction[][];
  /** Muted over the items: where the draft stands, on a phone. */
  heading?: ReactNode;
}): React.JSX.Element {
  const menu = useMenu(true);
  const linkItem = useCopyLinkItem();
  const copyLink =
    automation === undefined
      ? undefined
      : linkItem({ kind: LINK_PLACE.AUTOMATION, automationId: automation.id });
  const remove: MenuAction = {
    label: "Delete",
    icon: <Trash2Icon />,
    onSelect: onDelete,
    danger: true,
  };
  return (
    <>
      <MoreButton thing={ACTIONS_THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(ACTIONS_THING)}
          menu={menu.drawn}
          heading={heading}
          groups={[
            ...lead,
            ...(copyLink === undefined ? [] : [[copyLink]]),
            ...(automation === undefined ? [] : [[remove]]),
          ].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The editor's toolbar: the crumb back to the list leading it, the
 * automation's name after it once the page's header has scrolled away
 * (`pickUp`), and `tag` after that, with the page's acts at its end. Its own
 * width, which a container query reads, folds its acts' words before they
 * crowd its crumbs.
 */
function EditorToolbarFrame({
  pickUp,
  tag,
  onBack,
  children,
}: {
  pickUp: ToolbarPickUp;
  tag?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="automation-toolbar">
      <Toolbar
        trail={[{ label: AUTOMATIONS_PLACE, icon: <ZapIcon />, onPress: onBack }]}
        pickUp={pickUp}
        tag={tag}
        actions={children}
      />
    </div>
  );
}

/** Where the draft stands, said beside its save, and gone where the toolbar folds its acts. */
function EditorStatus({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="automation-editor-status">{children}</span>;
}

/**
 * The toolbar's Runs: the Runs panel's toggle beside the setup, or in a
 * narrow room the way to the runs' own screen, which it names by `screen`.
 */
interface RunsControl {
  /** Whether the Runs panel stands beside the setup; a narrow room's setup never stands beside them. */
  readonly shown: boolean;
  /** The id of the runs' own screen, in a narrow room alone. */
  readonly screen: string | undefined;
  readonly onPress: () => void;
}

/** Where a phone's way back from an automation's page leads, as its hint names it. */
const AUTOMATIONS_PLACE_NAME = "automations";

/** A phone's way back from an automation's page to the list, the glyph alone in its corner, with the key that leaves Automations. */
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

/** What the toolbar's way to a narrow room's runs says. */
const RUNS_LABEL = "Runs";

/** The editor's toolbar: the crumbs back to the list, then where the draft stands, its save, its switch, and its ⋯ holding Copy link and Delete. */
function EditorToolbar({
  automation,
  pickUp,
  codeReview,
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
  /** The page's name as the bar picks it up from the header. */
  pickUp: ToolbarPickUp;
  /** Whether it is a code review, an experiment still, whose page says so with the tag and Send feedback. */
  codeReview: boolean;
  dirty: boolean;
  saving: boolean;
  /** Whether the last save was refused, read as its ring leaves: one that was not lands on a check. */
  saveRefused: boolean;
  onBack: () => void;
  onSave: () => void;
  onToggle: (enabled: boolean) => Promise<AutomationView>;
  onDelete: () => void;
  /** Whether a Run now is out. */
  running: boolean;
  onRunNow: () => void;
  runs: RunsControl;
  /** Whether the room is a phone's, whose tag is the experiment's glyph alone. */
  narrow: boolean;
}): React.JSX.Element {
  const runsLabel = runs.shown ? "Hide runs" : "Show runs";
  const feedback = useSendFeedbackItem(EXPERIMENT.CODE_REVIEW);
  const status =
    automation === undefined
      ? "Not created yet"
      : saving
        ? "Saving"
        : dirty
          ? "Unsaved changes"
          : "Saved";
  if (narrow) {
    // A phone heads the page as it heads every page (`phone-head.tsx`): the way back to the list, the automation's
    // name picked up from the page's header, and one ⋯ holding the toolbar's acts over the automation's own, where the draft stands its heading.
    const lead: MenuAction[][] = [
      [
        {
          label: automation === undefined ? "Create" : "Save",
          icon: <SaveIcon />,
          disabled: saving || !(automation === undefined || dirty),
          onSelect: onSave,
        },
        ...(automation === undefined
          ? []
          : [{ label: "Run now", icon: <PlayIcon />, disabled: running, onSelect: onRunNow }]),
      ],
      automation === undefined
        ? []
        : [
            {
              label: automation.enabled ? "On" : "Off",
              detail: automation.name,
              checked: automation.enabled,
              mark: MENU_ITEM_MARK.SWITCH,
              onSelect: () => onToggle(!automation.enabled),
            },
          ],
      [{ label: RUNS_LABEL, icon: <HistoryIcon />, onSelect: runs.onPress }],
      codeReview ? [feedback] : [],
    ];
    return (
      <PhoneHead
        place="automation"
        start={<AutomationsBack onBack={onBack} />}
        pickUp={pickUp}
        tag={codeReview ? <ExperimentTag narrow /> : null}
        end={
          <AutomationActions
            automation={automation}
            onDelete={onDelete}
            lead={lead.filter((group) => group.length > 0)}
            heading={status}
          />
        }
      />
    );
  }
  return (
    <EditorToolbarFrame
      pickUp={pickUp}
      tag={codeReview ? <ExperimentTag narrow={narrow} /> : null}
      onBack={onBack}
    >
      {codeReview ? <SendFeedbackButton experiment={EXPERIMENT.CODE_REVIEW} /> : null}
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
          busyLabel="Running"
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
          <AutomationActions automation={automation} onDelete={onDelete} />
        </>
      )}
      {/* The Runs panel's toggle, the side panel's own button and chord at the window's top right; in a narrow room, the way to the runs' own screen. */}
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
}): React.JSX.Element {
  return (
    <Reveal shown={event !== GITHUB_TRIGGER_EVENT.CHECK_FAILED}>
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
      <Reveal shown={event === GITHUB_TRIGGER_EVENT.PULL_REQUEST_UPDATED}>
        {MOMENT_CHOICES.map((choice) => (
          <SwitchRow
            key={choice.value}
            label={choice.label}
            detail={choice.detail}
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
      </Reveal>
    </Reveal>
  );
}

/**
 * One filter's field: its values written comma-separated, read back into
 * the draft as they are typed. Note that the words typed stand in the row's
 * own state, so a comma still to be followed by a value is not taken away.
 */
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
  /** What stops a save in this filter, said under its row. */
  problem: string | undefined;
  onValues: (values: readonly string[]) => void;
}): React.JSX.Element {
  // The field's Escape lets go of the caret and keeps the press, as every field's here does.
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => values.join(", "));
  return (
    <SettingsRow label={label} description={detail} error={problem}>
      {(control) => (
        <span className="automation-field">
          <TextField
            ref={field}
            label={label}
            describedBy={control["aria-describedby"]}
            invalid={control["aria-invalid"]}
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

/** The parse the Sentry event picker reads its event back with. */
const sentryEventOf = optionValue(SENTRY_EVENTS);

/**
 * A Sentry trigger's rows, in the Trigger card: its event, the projects,
 * environments, and levels it keeps to, and the hours before the same
 * issue may start another run. Where the workspace has no Sentry installed
 * a row saying so stands in their place, its button going to where it is
 * installed.
 */
function SentryRows({
  draft,
  sentry,
  withheld,
  problems,
  onDraft,
}: {
  draft: AutomationDraft;
  /** The workspace's Sentry, through whose installation its events arrive. */
  sentry: SentryOffer;
  /** Whether the deployment holds no Sentry integration for this new choice of it (`sentryWithheld`). */
  withheld: boolean;
  /** What stops a save, each said under the row of the field it is about. */
  problems: DraftProblems;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  // The cooldown's Escape lets go of the caret and keeps the press, as every field's here does.
  const hours = useRef<HTMLInputElement>(null);
  if (withheld) {
    return (
      <SettingsRow label="Sentry isn't available" description={SENTRY_WITHHELD}>
        {() => null}
      </SettingsRow>
    );
  }
  // Note that a read still out, or one that failed, installs nothing, so an existing trigger stays editable, a failed one saying so above its rows.
  if (sentry.read !== undefined && sentry.read.installations.length === 0) {
    return (
      <SettingsRow label="Sentry isn't installed" error={sentry.refusal}>
        {() => (
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            busy={sentry.installing}
            busyLabel="Opening Sentry"
            onClick={sentry.onInstall}
          >
            Install Sentry
          </Button>
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
          label="Sentry"
          below={() => <ErrorState onRetry={sentry.onRetry}>{SENTRY_UNREAD}</ErrorState>}
        />
      ) : null}
      <SelectRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Event"
        detail={SENTRY_EVENT_DETAIL[trigger.event]}
        value={trigger.event}
        options={SENTRY_EVENTS}
        parse={sentryEventOf}
        onChange={(event) => onDraft(withIntegrationEvent(draft, event))}
      />
      <FilterRow
        label="Projects"
        detail="Project slugs, comma-separated. Empty for every project."
        values={trigger.filters?.project ?? []}
        problem={
          filterAdmitted(trigger.filters?.project) ? undefined : problems[DRAFT_FIELD.FILTERS]
        }
        onValues={(project) => filter({ project })}
      />
      <FilterRow
        label="Environments"
        detail="Comma-separated. Empty for every environment."
        values={trigger.filters?.environment ?? []}
        problem={
          filterAdmitted(trigger.filters?.environment) ? undefined : problems[DRAFT_FIELD.FILTERS]
        }
        onValues={(environment) => filter({ environment })}
      />
      <SettingsRow
        label="Levels"
        description="None picked for every level."
        below={() => (
          <ChoiceList
            legend="Levels"
            select={CHOICE_SELECT.MANY}
            look={CHOICE_LOOK.PILL}
            options={SENTRY_LEVELS}
            value={trigger.filters?.level ?? []}
            onChange={(level) => filter({ level })}
          />
        )}
      />
      <SettingsRow
        label="Same issue again after"
        description={`Hours before one Sentry issue can start another run, from 1 to ${AUTOMATION_BOUNDS.MAX_SUBJECT_COOLDOWN_HOURS}.`}
        error={problems[DRAFT_FIELD.COOLDOWN]}
      >
        {(control) => (
          <span className="automation-field">
            <TextField
              ref={hours}
              type={TEXT_FIELD_TYPE.NUMBER}
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
  // The rules file's Escape lets go of the caret and keeps the press, as every field's here does.
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
        width={CHIP_WIDTH.MIN_FIELD}
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
  [AUTOMATION_CALL_FAILURE.UNANSWERED]: "Could not make a new secret. Try again.",
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
            <CopyButton text={secret} what="secret" copy={copyThroughShell} />
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
            <CopyButton text={url} what="address" copy={copyThroughShell} />
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
        open
        confirm={rotation}
        question={{
          title: "Make a new secret?",
          body: "The secret your sender uses now stops working until you give it the new one, which Luke shows you once.",
          verb: "New secret",
          running: "Making",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
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
  modelsFailed,
  readModels,
  onChoose,
}: {
  models: RunChoices["models"];
  /** Whether the catalog could not be read, which the menu says with Retry. */
  modelsFailed: boolean;
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
        width={CHIP_WIDTH.MIN_FIELD}
        chevron
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) readModels();
          setOpen(!open);
        }}
      >
        <ChipName>Choose a model</ChipName>
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
    <SettingsRow label="Model" description={note}>
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

/** What the agent picker names the saved agent the workspace's list no longer holds. */
const KEPT_AGENT_LABEL = "The agent it goes to now";

/** What the agent row says where the workspace's agents could not be read, and where the search among them did not answer. */
const AGENTS_UNREAD = readFailedWords("the workspace's agents");
const AGENT_SEARCH_FAILED = readFailedWords("the search for agents");

/** What the agent row says under its name. */
const AGENT_DETAIL =
  "Each run is sent to that agent as a message, even mid-turn. It keeps its own model and effort.";

/**
 * The agent each run goes to, chosen from the workspace's agents on the
 * repository, each drawn as every agent menu draws it (`agentMenuRow`). The
 * menu lists the newest while nothing is typed and, once a word is, those
 * the service finds on the repository, so an agent past the newest is
 * found; the agent chosen from a search stays named after the list moves
 * on. The agent it goes to as saved is kept first in the menu where the
 * list no longer holds it, so another pick can still be taken back.
 */
function AgentRow({
  draft,
  savedAgentId,
  choices,
  problem,
  onDraft,
}: {
  draft: AutomationDraft;
  /** The agent its runs go to as saved, or none. */
  savedAgentId: string | null;
  choices: RunChoices;
  /** What stops a save here, or nothing. */
  problem: string | undefined;
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
  // Note that the catalog this row read names the models, since the window's own may not hold it yet.
  const drawn = { ...place, models: models ?? place.models };
  if (agents !== undefined && "failed" in agents) {
    return (
      <SettingsRow
        label="Agent"
        description={AGENT_DETAIL}
        error={problem}
        below={() => <ErrorState onRetry={retryAgents}>{AGENTS_UNREAD}</ErrorState>}
      />
    );
  }
  const offered = (agents?.agents ?? []).map((agent) =>
    mentionableAgent(agent, known.tasks, drawn.models),
  );
  const searched = found?.map((agent) => mentionableAgent(agent, known.tasks, drawn.models));
  // Note that the newest are matched here too, because the service matches an agent by its
  // title and its task, not by a name its row takes from its model.
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
  // Note that a search lists only what it found, so the kept agent stands in the menu while none is typed.
  const rows = [
    ...(kept === undefined || words !== "" ? [] : [{ id: kept, label: KEPT_AGENT_LABEL }]),
    ...listed.map((agent) => agentMenuRow(agent, drawn)),
  ];
  return (
    <PickerRow
      width={CHIP_WIDTH.MIN_FIELD}
      label="Agent"
      detail={AGENT_DETAIL}
      value={draft.agentId ?? ""}
      valueLabel={
        chosenRow !== undefined
          ? chosenRow.label
          : draft.agentId !== null && draft.agentId === kept
            ? KEPT_AGENT_LABEL
            : "Choose an agent"
      }
      valueIcon={chosenRow?.icon}
      rows={rows}
      placeholder="Search agents"
      note={
        words !== "" ? (
          searchFailed ? (
            <ErrorState onRetry={retryAgents}>{AGENT_SEARCH_FAILED}</ErrorState>
          ) : undefined
        ) : agents === undefined ? (
          <Spinner delay label={readingWords("agents")} />
        ) : rows.length === 0 ? (
          "No agents of this workspace work in it yet."
        ) : undefined
      }
      noMatch={NO_MATCH.AGENTS}
      error={problem}
      onOpen={() => searchAgents("")}
      onSearch={searchAgents}
      onPick={(agentId) => {
        setPicked(listed.find((agent) => agent.id === agentId));
        onDraft({ agentId });
      }}
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
    <SettingsSection title={EDITOR_SECTION.RUNS}>
      <SettingsRow
        label="Repository"
        description={
          taskBacked
            ? "Its task's repository."
            : also.length === 0
              ? undefined
              : `Runs start here, and also work in ${andList(also)}.`
        }
        error={problems[DRAFT_FIELD.REPOSITORY]}
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
            />
          )
        }
      </SettingsRow>
      <SelectRow
        width={CHIP_WIDTH.MIN_FIELD}
        label="Runs land in"
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
              problem={problems[DRAFT_FIELD.AGENT]}
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
          )
        }
      </RevealChoice>
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
  codeReviewOn,
  sentry,
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
  /** Whether the account has Code review's experiment on, without which no code review's settings stand apart from its prompt. */
  codeReviewOn: boolean;
  /** The workspace's Sentry, whose trigger is offered only where this deployment holds the integration. */
  sentry: SentryOffer;
  onDraft: (patch: Partial<AutomationDraft>) => void;
}): React.JSX.Element {
  // Note that Sentry stays listed where the deployment holds no integration, unpickable and saying why, so it can be found.
  const triggers =
    sentry.read?.configured === false && draft.triggerKind !== AUTOMATION_TRIGGER.INTEGRATION
      ? TRIGGERS.map((trigger) =>
          trigger.value === AUTOMATION_TRIGGER.INTEGRATION
            ? { ...trigger, disabled: SENTRY_NOT_SET_UP }
            : trigger,
        )
      : TRIGGERS;
  // A code review's own settings are the lines its task opens with, so its card reads them there and writes them back.
  const review = codeReviewOn ? readCodeReviewSettings(draft.prompt) : undefined;
  // The prompt's Escape lets go of the caret and keeps the press, as every field's here does.
  const prompt = useRef<HTMLTextAreaElement>(null);
  // The form is the area its reveals move, so the groups under a trigger's rows glide as they unroll.
  const form = useRef<HTMLDivElement>(null);
  const workspaceName = workspace?.name ?? "Workspace";
  const mine = automation === undefined || automation.mine === true;
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
          <SettingsSection title={EDITOR_SECTION.SHARING}>
            <OwnerRow
              owner={draft.owner}
              owners={owners}
              mine={mine}
              workspace={workspace}
              onOwner={(owner) => onDraft({ owner })}
            />
          </SettingsSection>
        ) : null}
        <SettingsSection title={EDITOR_SECTION.TRIGGER}>
          <SelectRow
            width={CHIP_WIDTH.MIN_FIELD}
            label="Type"
            detail={automationTriggerText(draftTrigger(draft), draftRepositories(draft))}
            value={draft.triggerKind}
            options={triggers}
            parse={triggerKindOf}
            error={
              draft.triggerKind === AUTOMATION_TRIGGER.SCHEDULE
                ? undefined
                : problems[DRAFT_FIELD.SCHEDULE]
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
                />
              ) : kind === AUTOMATION_TRIGGER.GITHUB ? (
                <>
                  <SelectRow
                    width={CHIP_WIDTH.MIN_FIELD}
                    label="Event"
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
        {review === undefined ? null : (
          <CodeReviewGroup
            settings={review}
            onSettings={(next) => onDraft({ prompt: withCodeReviewSettings(draft.prompt, next) })}
          />
        )}
        <SettingsSection title={EDITOR_SECTION.PROMPT} frame={SETTINGS_SECTION_FRAME.NONE}>
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
          {/* What stops a save, said under the prompt once a save was pressed. */}
          {problems[DRAFT_FIELD.PROMPT] === undefined ? null : (
            <ErrorState>{problems[DRAFT_FIELD.PROMPT]}</ErrorState>
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
          onDraft={onDraft}
        />
      </AutomationForm>
    </RevealArea>
  );
}

/**
 * An automation's page: its toolbar over its setup, with the Runs panel
 * `beside` it, and what stands apart from the setup after it, a narrow room's
 * runs screen and the page's questions.
 */
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
  screenRef?: RefObject<HTMLDivElement | null> | undefined;
  layoutRef?: RefObject<HTMLDivElement | null> | undefined;
  /** Whether the setup's screen is hidden, as a narrow room hides it while its runs stand. */
  hidden?: boolean | undefined;
  /** The setup's header: the page's one `h1`. */
  title: ReactNode;
  /** The window's bar over the setup and what stands beside it, handed the name it picks up from the header once that has scrolled away. */
  toolbar: (pickUp: ToolbarPickUp) => ReactNode;
  setup: ReactNode;
  beside: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  const [pickUp, setPickUp] = useState<ToolbarPickUp>({ name: "", shown: false });
  return (
    <Fill ref={screenRef} className="automations-view">
      <Fill className="automation-editor-screen" hidden={hidden}>
        {toolbar(pickUp)}
        <div ref={layoutRef} className="automation-editor-layout">
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

/** The setup's column: the name over the form, a step apart. */
function AutomationSetup({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="automation-editor">{children}</div>;
}

/** The form, as Settings draws a page: each group's name over its card, the groups a section apart. */
function AutomationForm({
  ref,
  children,
  ...area
}: {
  ref?: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
} & Partial<ReturnType<typeof revealArea>>): React.JSX.Element {
  return (
    <div ref={ref} className="automation-form" {...area}>
      {children}
    </div>
  );
}

/** The prompt's field while the automation is read: a block its rows tall. */
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

/**
 * The setup while the automation is read, as a scheduled one on a new agent
 * stands: its name's field, then each group under its heading,
 * Sharing where the workspace is shared, its rows' words and controls as
 * blocks, and the prompt's field, so the editor lands where they stood.
 */
function EditorSkeleton({ offersOwner }: { offersOwner: boolean }): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_AUTOMATION}>
      <AutomationSetup>
        <Skeleton shape={SKELETON_SHAPE.CONTROL} />
        <AutomationForm>
          {offersOwner ? (
            <SettingsSection title={EDITOR_SECTION.SHARING}>
              <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.SHARING]} />
            </SettingsSection>
          ) : null}
          <SettingsSection title={EDITOR_SECTION.TRIGGER}>
            <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.TRIGGER]} />
          </SettingsSection>
          <SettingsSection title={EDITOR_SECTION.PROMPT} frame={SETTINGS_SECTION_FRAME.NONE}>
            <PromptSkeleton />
          </SettingsSection>
          <SettingsSection title={EDITOR_SECTION.RUNS}>
            <SettingsRowsSkeleton rows={SCHEDULED_ROWS[EDITOR_SECTION.RUNS]} />
          </SettingsSection>
        </AutomationForm>
      </AutomationSetup>
    </SkeletonRegion>
  );
}

/** A saved automation's acts while it is read: where the draft stands, Run now, Save, its switch, its ⋯, and the Runs toggle. */
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

/**
 * One automation's page opened before the list is first read, from a link,
 * ⌘K, or a run's card, in the editor's own frame: its toolbar, the crumbs'
 * way back to the list ending in a block where the name will stand and its
 * acts as blocks, over the setup as blocks and the Runs panel reading, until
 * the list says what it holds. A narrow room stands the setup alone, as the
 * editor does.
 */
export function AutomationPageSkeleton({
  room,
  offersOwner,
  onBack,
}: {
  room: ShellRoom;
  /** Whether the workspace is shared, where the setup opens on Sharing. */
  offersOwner: boolean;
  onBack: () => void;
}): React.JSX.Element {
  const runsPanel = useRunsPanel();
  return (
    <AutomationPageFrame
      title={
        <Inline gap={GAP.CONTROL}>
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_TITLE_MARK} />
          <Skeleton width={SKELETON_NAME.TITLE} />
        </Inline>
      }
      toolbar={(pickUp) =>
        room === SHELL_ROOM.NARROW ? (
          // A phone's page while it is read stands as it will be drawn: the way back alone, the name read in the page's header.
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
          />
        )
      }
    />
  );
}

/** An automation's page's two screens in a narrow room: its setup, toolbar and all, and its runs. */
const EDITOR_SCREENS: NarrowColumns = {
  list: ":scope > .automation-editor-screen",
  item: ":scope > .automation-runs-screen",
};

/**
 * One automation's page, or a new one's where none is given. A new one,
 * opened from a suggestion on the list, starts filled in from its preset;
 * once made, it is handed to `onCreated`, which stands its own page where
 * this one stood. A deleted one is handed to `onDeleted`, which goes back
 * to the list.
 *
 * A narrow room, a phone's, has no room for the runs beside the setup, so
 * it stands the setup the whole width and the runs as a screen of their
 * own (`hiddenColumns`), reached by the toolbar's Runs and left by the way
 * back at their head, each a step of the window's history; the focus goes
 * with each swap (`useNarrowFocus`). The Runs panel's width and fold are
 * the wide room's alone.
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
  room,
  runsShown,
  onRuns,
  sentry,
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
  /** The room the panel's stage gives, narrow where the runs are a screen of their own. */
  room: ShellRoom;
  /** Whether a narrow room stands the runs rather than the setup. */
  runsShown: boolean;
  /** Stands the runs' screen, or the setup again, through the window's history. */
  onRuns: (shown: boolean) => void;
  /** The workspace's Sentry: a Sentry trigger offers its install in place of its rows where none is installed. */
  sentry: SentryOffer;
}): React.JSX.Element {
  const runs = useAutomationRuns(automation?.id);
  const codeReviewOn = useExperiment(EXPERIMENT.CODE_REVIEW);
  const linkedRun = linked?.runId;
  const [running, setRunning] = useState(false);
  const [defaults] = useState<DraftDefaults>(() => ({
    timezone: readerZone(),
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
  const narrow = room === SHELL_ROOM.NARROW;
  // A narrow room's runs stand as a screen of their own over the setup, and the setup the whole width.
  const runsAlone = narrow && runsShown;
  const hidden = hiddenColumns(room, !runsAlone);
  const screen = useNarrowFocus(room, !runsAlone, EDITOR_SCREENS);
  const runsScreen = useId();
  // Escape goes back to the list, asking first, as every way out does, where something written would be lost;
  // from a narrow room's runs, it goes back to the setup first.
  useAppCommand(APP_COMMAND.EXIT_AUTOMATIONS, runsAlone ? () => onRuns(false) : onBack);
  const runsPanel = useRunsPanel();
  const toggleRuns = narrow ? () => onRuns(!runsShown) : runsPanel.onToggle;
  // The form glides to its new middle as the Runs panel comes and goes (pane-motion.tsx).
  const editorLayout = useRef<HTMLDivElement>(null);
  // The name's Escape lets go of the caret and keeps the press, as every field's here does.
  const nameField = useRef<HTMLInputElement>(null);
  // ⌥⌘B shows and hides the Runs panel, as it does a plan's side panel.
  useAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL, toggleRuns);
  // A link to a run shows the Runs panel it is listed in, once each time it is opened, so a fold after it stands.
  const showRuns = useRef(runsPanel.onShow);
  showRuns.current = runsPanel.onShow;
  useEffect(() => {
    if (linked?.runId !== undefined) showRuns.current();
  }, [linked]);
  const problems = draftProblems(draft, repositoryHeld(draft, automation), new Date());
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
  const toggle = (enabled: boolean) =>
    automation === undefined
      ? Promise.resolve<AutomationView>({ failure: AUTOMATION_CALL_FAILURE.NOT_FOUND })
      : writes.toggle(automation.id, enabled);
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
  const runsRead = {
    mine: automation === undefined || automation.mine === true,
    created: automation !== undefined,
    automationId: automation?.id,
    linkedRun,
    runs: runs.read,
    onRetry: runs.reload,
    onOpenAgent,
  };
  return (
    <AutomationPageFrame
      screenRef={screen}
      layoutRef={editorLayout}
      hidden={hidden.list}
      title={<EditorTitle automation={automation} />}
      toolbar={(pickUp) => (
        <EditorToolbar
          automation={automation}
          pickUp={pickUp}
          codeReview={codeReviewOn && readCodeReviewSettings(draft.prompt) !== undefined}
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
            screen: narrow ? runsScreen : undefined,
            onPress: toggleRuns,
          }}
          narrow={narrow}
        />
      )}
      setup={
        <AutomationSetup>
          <TextField
            ref={nameField}
            label="Automation name"
            placeholder="Untitled automation"
            value={draft.name}
            onEscape={() => nameField.current?.blur()}
            onChange={(name) => editDraft({ name })}
          />
          {shownProblems && problems[DRAFT_FIELD.NAME] !== undefined ? (
            <FailureNote>{problems[DRAFT_FIELD.NAME]}</FailureNote>
          ) : null}
          {refusal === undefined ? null : <FailureNote>{refusal}</FailureNote>}
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
            codeReviewOn={codeReviewOn}
            sentry={sentry}
            onDraft={editDraft}
          />
        </AutomationSetup>
      }
      beside={
        <>
          {narrow ? null : <AutomationRunsPanel panel={runsPanel} {...runsRead} />}
          <PaneGlide root={editorLayout} layout={{ runsOpen: !narrow && runsPanel.open }} />
        </>
      }
    >
      {narrow ? (
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
          verb: "Leave",
          running: "Leaving",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
      <ConfirmDialog
        open
        confirm={deletion}
        question={{
          title: `Delete ${automation?.name ?? "this automation"}?`,
          body: "Its schedule stops and its run history goes. Agents its runs started stay.",
          verb: "Delete",
          running: "Deleting",
          loss: CONFIRM_LOSS.IRREVERSIBLE,
        }}
      />
    </AutomationPageFrame>
  );
}
