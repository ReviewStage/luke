import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import type { AgentAttachment, ListedAgent, TasklessAgent } from "@repo/features/agent-wire";
import { descriptionMarkdown } from "@repo/features/description-markdown";
import { dictationKeywords } from "@repo/features/dictation-keywords";
import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import type { GitHubConnection } from "@repo/features/github-connection-wire";
import type { InboxItemPlace } from "@repo/features/inbox-attachment-link";
import type { InboxItemHome } from "@repo/features/inbox-wire";
import {
  LINK_PLACE,
  type LinkPlace,
  type ReadLink,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { type DescriptionMention, MENTION_KIND } from "@repo/features/mention-link";
import type { CatalogModel, MacOffer, ModelChoice } from "@repo/features/models-wire";
import type { PageLine } from "@repo/features/page-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSections, TaskSectionWrite } from "@repo/features/task-section-wire";
import {
  type CodeRef,
  type ListedPullRequest,
  type RepositoryPin,
  TASK_BLOCK_CHANGE,
  type Task,
  type TaskAgentPin,
  type TaskBlockRelation,
  type TaskBlockRequest,
  type TaskCreateRelation,
  type TaskCreateRelationKind,
  type TaskMode,
  type TaskRelationChangeRequest,
  type TaskRelationKind,
  type TaskRunsOnRequest,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  type ParentCallFailure,
  type RelationCallFailure,
  summaryOfTaskless,
  TASK_BLOCK_FAILURE,
  TASK_CALL_FAILURE,
  TASK_PARENT_FAILURE,
  TASKS_READ,
  type TasksView,
} from "@repo/features/tasks-view";
import { managesWorkspace } from "@repo/features/workspace-role";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type {
  AppInboxAgentHolding,
  AppInboxTask,
  AppInboxTaskHolding,
  AppInboxTasklessItem,
  AppStateSnapshot,
} from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS, EXPERIMENT, experimentOn, NO_EXPERIMENTS } from "@repo/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { STATUS_TONE } from "@repo/ui";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isDraftTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  pullRequestLabelOf,
  type StripTab,
  sameTab,
} from "@repo/ui/tab-strip-model";
import { NO_TASK_SECTIONS, SECTION_WRITE_FAILED_NOTE } from "@repo/ui/task-sections-model";
import {
  AGENT_PIN_FAILED_NOTES,
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  MARK_FAILED_NOTES,
  PIN_MOVE_FAILED_NOTE,
  type PinMove,
  REPOSITORY_PIN_FAILED_NOTES,
  recentRepositories,
  renamedRegion,
  renamedView,
  repositoryChangeFailureNote,
  type StatusChange,
  settleChanges,
  settledNote,
  settleFailedNote,
  sidebarTasks,
  startFailureNote,
  TASK_MARK,
  TASKS_PAGE,
  type TaskMark,
  type TaskNames,
  type TasksPage,
  tasksPage,
  workspaceReaches,
} from "@repo/ui/tasks-model";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import {
  mutationOptions,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type ActedResult,
  askAct,
  askKept,
  firstRefusal,
  KEPT,
  type Kept,
  notKept,
  sendAct,
  unreachedAs,
} from "../act.js";
import { actMutation, pressMutation } from "../act-mutations.js";
import { type AdminView, adminViewOfLink } from "../admin/routing.js";
import { appPlatform } from "../app-platform.js";
import type { AutomationsRoute } from "../automations-route.js";
import { useCopyToast } from "../copy-feedback.js";
import { useChosenWorkspace } from "../desktop/chosen-workspace.js";
import {
  descriptionDocumentQuery,
  descriptionDocumentRetryMutation,
  historyQuery,
  historyRetryMutation,
  pagesQuery,
} from "../live-reads.js";
import {
  beginPanelSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
  recordPanelSpan,
} from "../panel-spans.js";
import type { RenameShape } from "../rename-write.js";
import { ADDRESS, HERE, type OverviewPlace, ROUTE, route } from "../route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { pressRows, ROW_WRITE, type RowDoors } from "../undo-stack.js";
import { appStateQuery, selectAppSettingsView, selectExperimentChoices } from "../use-app-state.js";
import type { BoardRoute, PersonRoute } from "../workspace-routes.js";
import {
  startFailureNote as agentStartFailureNote,
  agentStillWriting,
  choiceRequest,
  localAgentRefusalWords,
  openingLineOf,
  type SentLine,
  startsOwnAgents,
} from "./agent-model.js";
import { inboxItemHomeQueryOptions, taskByNumberQueryOptions } from "./agent-reads.js";
import {
  CLOSED_TAB_STRIP,
  type ClosedTab,
  NO_CLOSED_TABS,
  withClosedTab,
  withUndrawnPassed,
} from "./closed-tabs.js";
import { useCloudBrowserDrafts, useCloudBrowserTabs } from "./cloud-browser-tabs.js";
import type { SectionReveal } from "./description-body.js";
import {
  type DescriptionEditMutation,
  descriptionEditMutation,
} from "./description-edit-mutation.js";
import type { RevisionSource } from "./description-history-model.js";
import { holdsAsk } from "./inbox-model.js";
import type { MessageReveal } from "./message-links.js";
import type { NewTaskPress } from "./new-task-composer.js";
import { NEW_TASK_PURPOSE, type NewTaskPurpose } from "./new-task-purpose.js";
import type { NewTaskRelation } from "./new-task-relation.js";
import type { RepositoryChooser } from "./repository-chip.js";
import { loadedTasksFixture } from "./tasks-fixture-loader.js";
import type { ThreadReveal } from "./thread-reveal.js";
import type { ComposerNote } from "./use-agent-composer.js";
import {
  type AgentsControl,
  holdsNothing,
  type ModelsRead,
  readAgentById,
  useAgents,
} from "./use-agents.js";
import {
  type DescriptionHistoryControl,
  type DescriptionHistorySource,
  type HistorySpot,
  useDescriptionHistory,
} from "./use-description-history.js";
import { useIdleTabs } from "./use-idle-tabs.js";
import {
  chooseInboxTask,
  leaveInboxTask,
  listInboxWorkspace,
  openTaskThread,
} from "./use-inbox-task.js";
import { useInboxTaskAgents } from "./use-inbox-task-agents.js";
import {
  isOverviewTab,
  MAIN_TAB,
  type MainTab,
  type MainTabsControl,
  type NamedAgents,
  useMainTabs,
} from "./use-main-tabs.js";
import {
  DRAWN_KINDS,
  drawsChanges,
  drawsLocal,
  drawsSubagent,
  drawsTerminal,
  isPinnable,
  SIDE_PANEL_TAB,
  type SidebarPin,
  type SidePanelControl,
  type SidePanelTab,
  type TaskHolds,
  useSidePanel,
} from "./use-side-panel.js";
import { sayRestored } from "./version-view.js";

export type InboxChoice = (
  | { readonly taskId: string; readonly itemAgentId?: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string }
  | { readonly itemId: string }
) & {
  readonly opened?: true;
};

interface InboxViewControl {
  readonly open: boolean;
  readonly chosen: InboxChoice | undefined;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (chosen: InboxChoice) => void;
  readonly onOpenItem: (chosen: InboxChoice) => void;
  readonly onClear: () => void;
  readonly single?: boolean;
  readonly onSingle?: (single: boolean) => void;
  readonly pages: readonly PageLine[] | undefined;
  readonly onTaskAgents: (
    taskId: string,
    agentIds: readonly string[],
    heldIds?: readonly string[] | undefined,
  ) => void;
}

interface AgentViewControl {
  readonly agentId: string | undefined;
  readonly pages?: readonly PageLine[] | undefined;
  readonly onOpen: (agentId: string) => void;
  readonly onClose: () => void;
}

interface PersonViewControl {
  readonly userId: string | undefined;
  readonly name: string | undefined;
  readonly workspaceId: string | undefined;
  readonly onOpen: (userId: string, name?: string, workspaceId?: string) => void;
  readonly onClose: () => void;
  readonly onPreload: (userId: string, workspaceId?: string) => void;
}

type AgentPlaceKind =
  | typeof LINK_PLACE.AGENT
  | typeof LINK_PLACE.MESSAGE
  | typeof LINK_PLACE.WORKER
  | typeof LINK_PLACE.CHANGES
  | typeof LINK_PLACE.PULL_REQUEST_THREAD;

type AgentPlaceOf<K extends AgentPlaceKind> = Extract<LinkPlace, { readonly kind: K }>;

type AgentPlace = AgentPlaceOf<AgentPlaceKind>;

const TRANSCRIPT_PLACES: ReadonlySet<AgentPlaceKind> = new Set([
  LINK_PLACE.AGENT,
  LINK_PLACE.MESSAGE,
  LINK_PLACE.WORKER,
]);

type TaskTabPlace =
  | (AgentPlaceOf<
      typeof LINK_PLACE.WORKER | typeof LINK_PLACE.CHANGES | typeof LINK_PLACE.PULL_REQUEST_THREAD
    > & { readonly planId: string })
  | Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.PAGE; readonly planId: string }>;

const STAND_IN = {
  INBOX: "inbox",
  AGENT: "agent",
  UNKNOWN_WORKSPACE: "unknown-workspace",
} as const;

type StandIn =
  | {
      readonly kind: typeof STAND_IN.INBOX;
      readonly chosen: InboxChoice | undefined;
    }
  | { readonly kind: typeof STAND_IN.AGENT; readonly agentId: string }
  | { readonly kind: typeof STAND_IN.UNKNOWN_WORKSPACE };

export interface AdminViewControl {
  readonly open: boolean;
  readonly view: AdminView;
  readonly onOpen: (view?: AdminView) => void;
  readonly onClose: () => void;
  readonly onPreload: () => void;
}

interface BoardViewControl {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onPreload: () => void;
}

interface UnknownWorkspaceControl {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const AUTOMATIONS_PAGE = {
  LIST: "list",
  RUNS: "runs",
  NEW: "new",
  EDIT: "edit",
} as const;

export type AutomationsPlace =
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.LIST;
      readonly deleted?: string;
    }
  | { readonly kind: typeof AUTOMATIONS_PAGE.RUNS }
  | { readonly kind: typeof AUTOMATIONS_PAGE.NEW }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.EDIT;
      readonly automationId: string;
      readonly runId?: string;
      readonly created?: true;
    };

export function automationsTab(place: AutomationsPlace): boolean {
  return place.kind === AUTOMATIONS_PAGE.LIST || place.kind === AUTOMATIONS_PAGE.RUNS;
}

function stepOf(workspace: Pick<Workspace, "id" | "slug">): string {
  return workspace.slug ?? workspace.id;
}

interface AutomationsViewControl {
  readonly open: boolean;
  readonly place: AutomationsPlace;
  readonly runs: boolean;
  readonly onOpen: (place?: AutomationsPlace) => void;
  readonly onRuns: (shown: boolean) => void;
  readonly onClose: () => void;
}

export interface NewTaskAgent {
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  readonly alsoRepositories?: readonly string[] | undefined;
}

function agentRequest(handed: NewTaskAgent) {
  const also = handed.alsoRepositories ?? [];
  return {
    idempotencyKey: handed.idempotencyKey,
    prompt: handed.prompt,
    ...(handed.attachments.length === 0 ? undefined : { attachments: handed.attachments }),
    ...(handed.choice === undefined ? undefined : choiceRequest(handed.choice)),
    ...(handed.disabledServers.length === 0
      ? undefined
      : { disabledServers: handed.disabledServers }),
    ...(also.length === 0
      ? undefined
      : { alsoRepositories: also.map((repository) => ({ repository })) }),
  };
}

export interface QuickAddInto {
  readonly standing?: TaskStanding;
  readonly repository?: string;
}

function startingStanding(standing: TaskStanding | undefined) {
  if (standing === undefined) return undefined;
  const { assigneeId, ...rest } = standing;
  return assigneeId === undefined || assigneeId === null ? rest : { ...rest, assigneeId };
}

export interface NewTaskPreset {
  readonly repository?: string;
  readonly relation?: NewTaskRelation;
  readonly purpose?: NewTaskPurpose;
  readonly refused?: { readonly card: NewTaskCardKept; readonly note: Failure };
}

interface NewTaskCardKept {
  readonly purpose?: NewTaskPurpose;
  readonly relations: readonly NewTaskRelation[];
  readonly repository: string | null;
  readonly choice: ModelChoice | undefined;
  readonly press: NewTaskPress;
  readonly words: string;
}

export interface StartingTask {
  readonly line: SentLine;
  readonly choice: ModelChoice | undefined;
}

export interface NewTaskStart {
  readonly runsOn?: TaskRunsOnRequest;
  readonly device?: MacOffer;
  readonly relations?: readonly TaskCreateRelation[];
  readonly handed?: NewTaskAgent;
  readonly mode?: TaskMode;
  readonly card?: NewTaskCardKept;
}

export interface TasksControl {
  page: TasksPage;
  starting: StartingTask | undefined;
  shown: boolean;
  signedIn: boolean;
  me: string | undefined;
  tasks: TasksView["tasks"];
  listed: {
    tasks: TasksView["tasks"];
    inbox: readonly AppInboxTask[];
    inboxTasks: readonly AppInboxTaskHolding[];
  };
  pendingTasks?: ReadonlySet<string>;
  listedAgents: {
    readonly standing: readonly TasklessAgent[];
    readonly archived: readonly TasklessAgent[];
  };
  workspaces: readonly Workspace[];
  workspacesFailed: boolean;
  onRetryWorkspaces: () => void;
  workspace: Workspace | undefined;
  onChooseWorkspace: (workspaceId: string) => void;
  onLeftWorkspace: (workspaceId: string) => void;
  newWorkspace: { open: boolean; onOpen: () => void; onClose: () => void };
  onOpenWorkspaceSettings: () => void;
  github: GitHubConnection | undefined;
  onConnectAccountGitHub: () => Promise<boolean>;
  onDisconnectAccountGitHub: () => Promise<boolean>;
  activeTaskId: string | undefined;
  boundFor: string | undefined;
  listFailed: boolean;
  listRead: boolean;
  region: DocumentRegion;
  copy: { onPress: () => void };
  descriptionEdit: (taskId: string) => DescriptionEditMutation;
  mainTabs: MainTabsControl;
  sidePanel: SidePanelControl;
  unreadTabs: readonly StripTab[];
  pages: readonly PageLine[] | undefined;
  agents: AgentsControl;
  history: VersionHistoryControl;
  onSelect: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onRestoreTask: (taskId: string) => void;
  onShowAgent: (taskId: string, agentId: string) => void;
  onShowColumnTab: (taskId: string, tab: MainTab) => void;
  onShowPanelTab: (taskId: string, tab: SidePanelTab) => void;
  onShowSource: (taskId: string, source: RevisionSource) => void;
  onShowTask: (taskId: string) => void;
  onShowMention: (mention: DescriptionMention) => void;
  onOpenLink: (link: ReadLink) => void;
  messageReveal: MessageReveal | undefined;
  onMessageRevealed: (ask: number) => void;
  onRevealMessage: (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => void;
  threadReveal: ThreadReveal | undefined;
  onThreadRevealed: (ask: number) => void;
  onRevealThread: (
    changes: string,
    place: AgentPlaceOf<typeof LINK_PLACE.PULL_REQUEST_THREAD>,
  ) => void;
  sectionReveal: { readonly taskId: string; readonly reveal: SectionReveal } | undefined;
  onSectionRevealed: (ask: number) => void;
  commentReveal:
    | { readonly planId: string; readonly thread: string; readonly ask: number }
    | undefined;
  onCommentRevealed: (ask: number) => void;
  onShowInbox: (narrowed: { readonly taskId: string; readonly itemId?: string }) => void;
  inbox: readonly AppInboxTask[];
  inboxShown: string | null;
  inboxTasks: readonly AppInboxTaskHolding[];
  inboxTaskless: readonly AppInboxTasklessItem[];
  inboxAgents: readonly AppInboxAgentHolding[];
  failedRuns: readonly AccountFailedRun[];
  inboxView: InboxViewControl;
  agentView: AgentViewControl;
  personView: PersonViewControl;
  adminView: AdminViewControl;
  automationsView: AutomationsViewControl;
  boardView: BoardViewControl;
  unknownWorkspace: UnknownWorkspaceControl;
  onShowFile: (taskId: string, ref: CodeRef, commit: string | undefined) => void;
  onOpenPinnedTab: (pin: SidebarPin) => void;
  onReopenClosedTab: (() => void) | undefined;
  chosenPin: SidebarPin | undefined;
  repositories: RepositoryChooser;
  repositoryMenu: { taskId: string; request: number } | undefined;
  onChangeRepository: (taskId: string) => void;
  relationMenu: { taskId: string; kind: TaskRelationKind; request: number } | undefined;
  onAddRelation: (taskId: string, kind: TaskRelationKind) => void;
  onSetRepository: (taskId: string, repository: string | null) => Promise<string | undefined>;
  onSetTaskStanding: (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ) => Promise<Kept>;
  onSetTaskBlock: (taskId: string, block: TaskBlockRequest) => void;
  onSetTaskParent: (taskId: string, parentTaskId: string | null) => void;
  onRemoveTaskParent: (taskId: string) => void;
  onRemoveTaskBlock: (taskId: string, relation: TaskBlockRelation, otherId: string) => void;
  onChangeTaskRelation: (taskId: string, relation: TaskRelationChangeRequest) => void;
  onOpenWorkspaceGitHub: (taskId: string) => void;
  onMoveTask: (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ) => Promise<boolean>;
  moveTask: TaskMoveMutation;
  onRetryList: () => void;
  onRetryDocument: () => void;
  onNewTask: () => void;
  onNewTaskIn: (repository: string) => void;
  onNewRelatedTask: (taskId: string, kind: TaskCreateRelationKind) => void;
  onQuickAdd: (name: string, into: QuickAddInto) => Promise<Failure | undefined>;
  onNewAutomationAgent: () => void;
  newTask: {
    open: boolean;
    preset: NewTaskPreset | undefined;
    homeAsks: number;
    workspaces: readonly Workspace[];
    workspaceId: string | undefined;
    repositoriesIn: (workspaceId: string | undefined) => RepositoryChooser;
    start: (
      name: string,
      repository: string | null,
      workspaceId: string | undefined,
      from?: NewTaskStart,
    ) => Promise<Failure | undefined>;
    models: readonly CatalogModel[] | undefined;
    devices: readonly MacOffer[] | undefined;
    modelsFailed: boolean;
    modelsRead: ModelsRead;
    readModels: () => void;
    onClose: () => void;
    tasks: readonly TaskSummary[];
    onShowMention: (mention: DescriptionMention) => void;
  };
  onLeaveTask: () => void;
  onGoHome: () => void;
  renameTask: TaskRenameMutation;
  onDraftName: (taskId: string, name: string | undefined) => void;
  onMarkTask: (taskId: string, mark: TaskMark) => void;
  onSettleTasks: (taskIds: readonly string[], status: TaskStatus) => void;
  pinnedRepositories: readonly string[];
  onPinRepository: (repository: string, pinned: boolean) => void;
  onPinAgent: (agentId: string, pinned: boolean) => void;
  taskAgentPins: readonly TaskAgentPin[];
  liveAgents: readonly ListedAgent[] | undefined;
  listedPullRequests: readonly ListedPullRequest[] | undefined;
  onMovePins: (moves: readonly PinMove[], putBack?: () => void) => void;
  taskSections: TaskSections;
  onWriteSections: (writes: readonly TaskSectionWrite[]) => void;
  onDeleteTask: (taskId: string) => Promise<ActionResult>;
  deleteTask: TaskDeleteMutation;
  deleteTasks: TasksDeleteMutation;
  back: () => boolean;
  leaveGuard: LeaveGuard;
}

export type LeaveAsk = (leave: () => void) => void;

export interface LeaveGuard {
  readonly stand: (ask: LeaveAsk) => () => void;
  readonly pass: (leave: () => void) => void;
  readonly guard: <Args extends readonly unknown[]>(
    leave: (...args: Args) => void,
  ) => (...args: Args) => void;
}

export function useLeaveGuard(onStanding?: (ask: LeaveAsk | undefined) => void): LeaveGuard {
  const standing = useRef<LeaveAsk | undefined>(undefined);
  const passing = useRef(false);
  const heard = useRef(onStanding);
  heard.current = onStanding;
  return useMemo<LeaveGuard>(() => {
    const pass = (leave: () => void) => {
      passing.current = true;
      try {
        leave();
      } finally {
        passing.current = false;
      }
    };
    return {
      stand: (ask) => {
        standing.current = ask;
        heard.current?.(ask);
        return () => {
          if (standing.current !== ask) return;
          standing.current = undefined;
          heard.current?.(undefined);
        };
      },
      pass,
      guard:
        (leave) =>
        (...args) => {
          const ask = standing.current;
          if (ask === undefined || passing.current) {
            leave(...args);
            return;
          }
          ask(() => pass(() => leave(...args)));
        },
    };
  }, []);
}

export interface VersionHistoryControl extends DescriptionHistoryControl {
  open: boolean;
  onOpen: (taskId: string, save?: number) => void;
  onReturn: (taskId: string, spot: HistorySpot | undefined) => void;
  onClose: () => void;
}

interface HistoryOpening {
  readonly taskId: string;
  readonly save: number | undefined;
  readonly spot: HistorySpot | undefined;
}

function chosenPinOf(
  chosen: PinChoice | undefined,
  boundFor: string | undefined,
  pageAgent: string | undefined,
): SidebarPin | undefined {
  if (chosen === undefined) return undefined;
  const { pin } = chosen;
  const open = "agent" in pin ? pin.agent === pageAgent : pin.task === boundFor;
  return open ? pin : undefined;
}

function pinOnTask(pin: SidebarPin, taskId: string): boolean {
  return "task" in pin && pin.task === taskId;
}

function resumingAgentOf(
  taskId: string,
  tasks: readonly TaskSummary[],
  waiting: readonly AppInboxTask[],
): string | undefined {
  const items = waiting.find((each) => each.taskId === taskId)?.items ?? [];
  const waitingOn = items.find(holdsAsk) ?? items[0];
  if (waitingOn !== undefined) return waitingOn.agentId;
  const lines = tasks.find((task) => task.id === taskId)?.agents?.agents ?? [];
  const working = lines.find((line) => agentStillWriting(line.status));
  if (working !== undefined) return working.id;
  let latest = lines[0];
  for (const line of lines) if ((line.at ?? 0) > (latest?.at ?? 0)) latest = line;
  return latest?.id;
}

interface PinChoice {
  readonly pin: SidebarPin;
  readonly over: string | undefined;
}

interface TaskAsk {
  taskId: string | undefined;
  over: string | undefined;
}

const NO_REPOSITORY_PINS: readonly RepositoryPin[] = [];

const NO_PENDING_TASKS: readonly string[] = [];

const NO_PAGES: readonly PageLine[] = [];

const NO_HOLDS: TaskHolds = {};

const NO_IDS: readonly string[] = [];

const NO_TASKLESS_AGENTS: readonly TasklessAgent[] = [];

const taskUnreached = unreachedAs(TASK_CALL_FAILURE.UNANSWERED);

const AGENT_PIN_ASKED = {
  CHANGED: "changed",
  UNASKED: "unasked",
} as const;

type AgentPinAsked =
  | (typeof AGENT_PIN_ASKED)[keyof typeof AGENT_PIN_ASKED]
  | { readonly refused: unknown };

const NO_TASK_AGENT_PINS: readonly TaskAgentPin[] = [];

const TASK_COPIED_NOTE = "Description copied";

const selectOpensNewTask = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.openNewTask ?? APP_SETTING_DEFAULTS.openNewTask;

const TASK_STARTED_NOTE = "Task started";

const TASK_STARTED_AGENT_REFUSED_NOTE = "Task started, but its agent did not";

const OPEN_STARTED_TASK = "Open";

const MOVE_REFUSED_NOTE = "The task could not be moved. Try again.";

const BLOCK_REFUSED_NOTE = "That relation could not be changed. Try again.";

const BLOCK_CYCLE_NOTE = "That task already waits on this one, so it can't block it too.";

const PARENT_CYCLE_NOTE =
  "That task is already a sub-task of this one, so it can't be its parent too.";

const PARENT_REPOSITORY_NOTE =
  "A sub-task works in its parent's repository, so the two must share one.";

const PARENT_REMOVED_NOTE = "Parent removed";

const BLOCK_REMOVED_NOTE = "Relation removed";

const TASK_RENAMED_NOTE = "Task renamed";

interface TaskRenameAsk {
  readonly taskId: string;
  readonly name: string;
}

export function taskRenameMutation(
  send: (asked: TaskRenameAsk) => Promise<boolean>,
  doors: RowDoors<TasksView, typeof ROW_WRITE.TASK_RENAME.kind> | undefined,
) {
  return mutationOptions({
    mutationKey: [ROW_WRITE.TASK_RENAME.kind],
    mutationFn: send,
    onMutate: (asked) =>
      doors === undefined
        ? undefined
        : pressRows(ROW_WRITE.TASK_RENAME, doors, [
            { id: asked.taskId, after: { name: asked.name } },
          ]),
    onSuccess: (renamed, _asked, pressed) => {
      if (renamed) pressed?.keep(TASK_RENAMED_NOTE);
    },
  });
}

export type TaskRenameMutation = ReturnType<typeof taskRenameMutation>;

export function taskDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_DELETE], mutationFn: run });
}

type TaskDeleteMutation = ReturnType<typeof taskDeleteMutation>;

export function tasksDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TASKS_DELETE],
    mutationFn: (taskIds: readonly string[]) => Promise.all(taskIds.map(run)),
  });
}

type TasksDeleteMutation = ReturnType<typeof tasksDeleteMutation>;

interface TaskMoveAsk {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly quiet: boolean;
}

export function taskMoveMutation(run: (asked: TaskMoveAsk) => Promise<boolean>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_MOVE], mutationFn: run });
}

type TaskMoveMutation = ReturnType<typeof taskMoveMutation>;

export const TASK_RENAME_SHAPE: RenameShape<boolean, TaskRenameAsk> = {
  ask: (taskId, name) => ({ taskId, name }),
  asked: ({ taskId, name }) => ({ subjectId: taskId, name }),
  refused: (renamed) => !renamed,
};

const TASK_MARKED_NOTES = {
  [TASK_MARK.PIN]: "Task pinned",
  [TASK_MARK.UNPIN]: "Task unpinned",
} as const satisfies Record<TaskMark, string>;

const AGENT_PINNED_NOTES = {
  PIN: "Agent pinned",
  UNPIN: "Agent unpinned",
} as const;

const PRIORITY_CHANGED_NOTE = "Priority changed";

const ASSIGNEE_CHANGED_NOTES = {
  ASSIGNED: "Task assigned",
  UNASSIGNED: "Task unassigned",
} as const;

function standingNote(standing: TaskStanding): string {
  if (standing.status !== undefined) return settledNote(standing.status, 1, 0);
  if (standing.assigneeId === undefined) return PRIORITY_CHANGED_NOTE;
  return standing.assigneeId === null
    ? ASSIGNEE_CHANGED_NOTES.UNASSIGNED
    : ASSIGNEE_CHANGED_NOTES.ASSIGNED;
}

function relationRefusedNote(failure: RelationCallFailure | ParentCallFailure): string {
  switch (failure) {
    case TASK_BLOCK_FAILURE.CYCLE:
      return BLOCK_CYCLE_NOTE;
    case TASK_PARENT_FAILURE.CYCLE:
      return PARENT_CYCLE_NOTE;
    case TASK_PARENT_FAILURE.REPOSITORY_DIFFERS:
      return PARENT_REPOSITORY_NOTE;
    default:
      return BLOCK_REFUSED_NOTE;
  }
}

function switchedNote(workspace: string): string {
  return `Switched to ${workspace}`;
}

function backNote(workspace: string): string {
  return `Back to ${workspace}`;
}

const DELETE_REFUSED_NOTE = "The task could not be deleted. Try again.";

const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_REFUSED_NOTE,
};

function sidebarList(tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  const { pinned, rest } = sidebarTasks(tasks);
  return [...pinned, ...rest];
}

function inWorkspace<Entry extends { readonly taskId: string }>(
  entries: readonly Entry[],
  tasks: readonly Pick<Task, "id" | "workspaceId">[],
  workspaceId: string | undefined,
): readonly Entry[] {
  if (workspaceId === undefined) return entries;
  const listed = new Set(
    tasks.filter((task) => task.workspaceId === workspaceId).map((task) => task.id),
  );
  return entries.filter((entry) => listed.has(entry.taskId));
}

function inboxChoiceOf(place: InboxItemPlace): InboxChoice {
  if ("planId" in place) return { taskId: place.planId, itemId: place.itemId };
  return "agentId" in place
    ? { agentId: place.agentId, itemId: place.itemId }
    : { itemId: place.itemId };
}

function choiceTaskOf(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

function choiceAgentOf(choice: InboxChoice): string | undefined {
  return "agentId" in choice ? choice.agentId : undefined;
}

function readInboxItemHome(
  queryClient: QueryClient,
  itemId: string,
): Promise<InboxItemHome | undefined> {
  return queryClient.fetchQuery(inboxItemHomeQueryOptions(itemId)).then(
    (answer) => ("failure" in answer ? undefined : answer),
    () => undefined,
  );
}

export function useTasksTab(input: {
  tasks: TasksView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  account: string | undefined;
  accountId?: string | undefined;
  shown: boolean;
  unseenAgents: readonly string[];
  inboxWaiting: readonly AppInboxTask[];
  inboxTasks: readonly AppInboxTaskHolding[];
  inboxTaskless: readonly AppInboxTasklessItem[];
  inboxAgents: readonly AppInboxAgentHolding[];
  failedRuns: readonly AccountFailedRun[];
  onOpenIntegrations: () => void;
  onOpenApiKeys: AgentsControl["onOpenApiKeys"];
  onOpenSettings: (link: SettingsLink) => void;
  leaveGuard: LeaveGuard;
  room: ShellRoom;
  adminView: AdminViewControl;
  boardView: BoardRoute;
  personView: PersonRoute;
  automationsView: AutomationsRoute;
}): TasksControl {
  const { shown, leaveGuard } = input;
  const { guard } = leaveGuard;
  const queryClient = useQueryClient();
  const { mutateAsync: sendSelect } = useMutation(actMutation(ACT_KIND.TASKS_SELECT));
  const { mutateAsync: sendGitHubConnect } = useMutation(actMutation(ACT_KIND.GITHUB_CONNECT));
  const { mutateAsync: sendGitHubDisconnect } = useMutation(
    actMutation(ACT_KIND.GITHUB_DISCONNECT),
  );
  const { mutateAsync: sendClose } = useMutation(actMutation(ACT_KIND.TASKS_CLOSE));
  const { mutateAsync: sendTaskRename } = useMutation(actMutation(ROW_WRITE.TASK_RENAME.kind));
  const { mutateAsync: sendTaskPin } = useMutation(actMutation(ROW_WRITE.TASK_PIN.kind));
  const { mutateAsync: sendRepositoryPin } = useMutation(
    actMutation(ACT_KIND.TASKS_PIN_REPOSITORY),
  );
  const { mutateAsync: sendAgentPin } = useMutation(actMutation(ROW_WRITE.AGENT_PIN.kind));
  const { mutateAsync: sendSections } = useMutation(actMutation(ACT_KIND.TASKS_WRITE_SECTION));
  const { mutateAsync: sendStandingRow } = useMutation(actMutation(ROW_WRITE.TASK_STANDING.kind));
  const { mutateAsync: sendTaskRepository } = useMutation(
    actMutation(ACT_KIND.TASKS_SET_REPOSITORY),
  );
  const { mutateAsync: sendBlock } = useMutation(actMutation(ACT_KIND.TASKS_BLOCK));
  const { mutateAsync: sendParent } = useMutation(actMutation(ACT_KIND.TASKS_SET_PARENT));
  const { mutateAsync: sendRelation } = useMutation(actMutation(ACT_KIND.TASKS_CHANGE_RELATION));
  const { mutateAsync: sendRestore } = useMutation(actMutation(ACT_KIND.TASKS_RESTORE));
  const { mutateAsync: sendTaskStart } = useMutation(actMutation(ACT_KIND.TASKS_START));
  const { mutate: tellShown } = useMutation(actMutation(ACT_KIND.AGENTS_SHOWN));
  const { mutate: refreshTasks } = useMutation(pressMutation(ACT_KIND.TASKS_REFRESH));
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const [newTaskAsk, setNewTaskAsk] = useState<
    { readonly preset: TasksControl["newTask"]["preset"] } | undefined
  >(undefined);
  const [homeNewTasks, setHomeNewTasks] = useState(0);
  const [startingTask, setStartingTask] = useState<
    (StartingTask & { readonly navigation: number }) | undefined
  >(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<TasksControl["repositoryMenu"]>(undefined);
  const [relationMenu, setRelationMenu] = useState<TasksControl["relationMenu"]>(undefined);
  const [asked, setAsked] = useState<TaskAsk | undefined>(undefined);
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  const [historyFor, setHistoryFor] = useState<HistoryOpening | undefined>(undefined);
  const [standIn, setStandIn] = useState<StandIn | undefined>(undefined);
  const inboxView = standIn?.kind === STAND_IN.INBOX ? standIn : undefined;
  const timeInboxOpen = () => {
    if (inboxView === undefined) beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  };
  const [inboxSingle, setInboxSingle] = useState(false);
  const agentView = standIn?.kind === STAND_IN.AGENT ? standIn : undefined;
  const tasksFixture = loadedTasksFixture();
  const [fileFor, setFileFor] = useState<
    | { readonly taskId: string; readonly ref: CodeRef; readonly commit: string | undefined }
    | undefined
  >(undefined);
  const [sectionReveal, setSectionReveal] = useState<TasksControl["sectionReveal"]>(undefined);
  const [messageReveal, setMessageReveal] = useState<MessageReveal | undefined>(undefined);
  const [commentReveal, setCommentReveal] = useState<TasksControl["commentReveal"]>(undefined);
  const messageAsks = useRef(0);
  const [threadReveal, setThreadReveal] = useState<ThreadReveal | undefined>(undefined);
  const sectionAsks = useRef(0);
  const commentAsks = useRef(0);
  const [closedTabs, setClosedTabs, latestClosedTabs] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);
  const [reopenFor, setReopenFor, latestReopenFor] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);

  const fixture = tasksFixture?.fixtureTasksView(input.run);
  const viewed = fixture ?? input.tasks;
  const accountSignedIn = input.signedIn;
  const [drafts, setDrafts] = useState<TaskNames>(new Map());
  const draftName = useCallback((taskId: string, name: string | undefined) => {
    setDrafts((held) => {
      if (held.get(taskId) === name) return held;
      const next = new Map(held);
      if (name === undefined) next.delete(taskId);
      else next.set(taskId, name);
      return next;
    });
  }, []);
  const taskSections = viewed.taskSections ?? NO_TASK_SECTIONS;
  useEffect(() => {
    if (!accountSignedIn) setClosedTabs(NO_CLOSED_TABS);
  }, [accountSignedIn, setClosedTabs]);
  const pendingTasks = useMemo(
    () => new Set(viewed.pendingTasks ?? NO_PENDING_TASKS),
    [viewed.pendingTasks],
  );
  const tasks = useMemo(() => renamedView(viewed, drafts), [viewed, drafts]);
  const workspace = useChosenWorkspace(viewed.workspaces, fixture !== undefined);
  const workspaceChoices = useRef(0);
  const listWorkspace = workspace.choose;
  const chooseListed = useCallback(
    (workspaceId: string) => {
      workspaceChoices.current += 1;
      listInboxWorkspace(workspaceId);
      listWorkspace(workspaceId);
    },
    [listWorkspace],
  );
  const listedWorkspace = workspace.chosen;
  useLayoutEffect(() => {
    if (listedWorkspace !== undefined) listInboxWorkspace(listedWorkspace.id);
  }, [listedWorkspace]);
  const personWorkspace =
    input.personView.workspace === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, input.personView.workspace)?.id;
  const personElsewhere =
    input.personView.userId !== undefined &&
    listedWorkspace !== undefined &&
    personWorkspace !== undefined &&
    personWorkspace !== listedWorkspace.id;
  const closePerson = input.personView.onClose;
  useEffect(() => {
    if (personElsewhere) closePerson();
  }, [personElsewhere, closePerson]);
  const boardWorkspace =
    input.boardView.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, input.boardView.standingIn)?.id;
  const boardElsewhere =
    input.boardView.open &&
    listedWorkspace !== undefined &&
    boardWorkspace !== undefined &&
    boardWorkspace !== listedWorkspace.id;
  const listedStep = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
  const turnBoard = input.boardView.onTurn;
  useEffect(() => {
    if (boardElsewhere && listedStep !== undefined) turnBoard(listedStep);
  }, [boardElsewhere, listedStep, turnBoard]);
  const automationsWorkspace =
    input.automationsView.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, input.automationsView.standingIn)?.id;
  const automationsElsewhere =
    listedWorkspace !== undefined &&
    automationsWorkspace !== undefined &&
    automationsWorkspace !== listedWorkspace.id;
  const turnAutomations = input.automationsView.onTurn;
  useEffect(() => {
    if (automationsElsewhere && listedStep !== undefined) turnAutomations(listedStep);
  }, [automationsElsewhere, listedStep, turnAutomations]);
  const listedWorkspaceId = listedWorkspace?.id;
  const sidebar = useMemo(() => sidebarList(tasks.tasks), [tasks.tasks]);
  const listedSidebar = useMemo(
    () =>
      sidebarList(
        listedWorkspaceId === undefined
          ? tasks.tasks
          : tasks.tasks.filter((task) => task.workspaceId === listedWorkspaceId),
      ),
    [tasks.tasks, listedWorkspaceId],
  );
  const { tasklessAgents } = tasks;
  const liveAgents = useMemo(
    () =>
      tasks.taskAgents === undefined
        ? undefined
        : [...tasks.taskAgents, ...(tasklessAgents ?? NO_TASKLESS_AGENTS).map(summaryOfTaskless)],
    [tasks.taskAgents, tasklessAgents],
  );
  const { inboxWaiting, inboxTasks } = input;
  const listedInbox = useMemo(
    () => ({
      inbox: inWorkspace(inboxWaiting, tasks.tasks, listedWorkspaceId),
      inboxTasks: inWorkspace(inboxTasks, tasks.tasks, listedWorkspaceId),
    }),
    [inboxWaiting, inboxTasks, tasks.tasks, listedWorkspaceId],
  );
  const signedIn = fixture !== undefined || input.signedIn;
  const [founding, setFounding] = useState<{ accountId: string | undefined } | undefined>(
    undefined,
  );
  if (founding !== undefined && (!signedIn || founding.accountId !== input.accountId)) {
    setFounding(undefined);
  }
  const page = tasksPage(tasks);
  const heldDescription = useQuery(descriptionDocumentQuery(viewed.activeTaskId));
  const heldDescriptionRows = heldDescription.data;
  const heldDescriptionFailed = heldDescription.isError;
  const { mutate: retryDescriptionAct } = useMutation(descriptionDocumentRetryMutation());
  const openedTaskId = viewed.activeTaskId;
  const retryDescription = useCallback(() => {
    if (openedTaskId !== undefined) retryDescriptionAct({ taskId: openedTaskId });
  }, [retryDescriptionAct, openedTaskId]);
  const region = useMemo(
    () =>
      renamedRegion(
        documentRegion(
          { activeTaskId: openedTaskId },
          { rows: heldDescriptionRows, failed: heldDescriptionFailed },
        ),
        drafts,
      ),
    [openedTaskId, heldDescriptionRows, heldDescriptionFailed, drafts],
  );
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const dictationWords = useMemo(
    () =>
      openDocument === undefined || openDocument.id !== viewed.activeTaskId
        ? []
        : dictationKeywords({
            repository: openDocument.repository,
            title: openDocument.name,
            body: openDocument.document.body,
          }),
    [openDocument, viewed.activeTaskId],
  );
  const agents = useAgents({
    taskId: viewed.activeTaskId,
    repository:
      openDocument?.id === viewed.activeTaskId ? (openDocument?.repository ?? null) : null,
    listedAgents: tasks.tasks.some((task) => task.id === viewed.activeTaskId)
      ? liveAgents
      : undefined,
    listedPullRequests: tasks.agentPullRequests,
    modeOf: (planId) => tasks.tasks.find((task) => task.id === planId)?.mode,
    onOpenIntegrations: input.onOpenIntegrations,
    onOpenApiKeys: input.onOpenApiKeys,
    me: input.accountId,
    onStarted: (agentId) => mainRef.current?.onChoose({ agent: agentId }),
    onDraftRestored: (on, draftId) => mainRef.current?.onShow(on, { draft: draftId }),
    keywords: dictationWords,
  });
  const listedAgents = useMemo(() => {
    const listed = (tasklessAgents ?? NO_TASKLESS_AGENTS).filter(
      (agent) => listedWorkspaceId === undefined || agent.workspaceId === listedWorkspaceId,
    );
    return {
      standing: listed.filter((agent) => agent.archivedAt === undefined),
      archived: listed.filter((agent) => agent.archivedAt !== undefined),
    };
  }, [tasklessAgents, listedWorkspaceId]);
  const openRow = tasks.tasks.find((task) => task.id === viewed.activeTaskId);
  const rowAgents = openRow?.agents;
  const rowListed = openRow !== undefined;
  const named = useMemo<NamedAgents | undefined>(() => {
    if (!rowListed) return undefined;
    if (rowAgents === undefined) return { ids: [], total: 0 };
    const { agents: lines, total } = rowAgents;
    return { ids: lines.map((line) => line.id), total };
  }, [rowListed, rowAgents]);
  const mainTabs = useMainTabs(
    fixture === undefined ? undefined : { tab: tasksFixture?.fixtureColumnTab(input.run) },
    viewed.activeTaskId,
    agents.agentIds,
    named,
    agents.draft?.id,
    input.room === SHELL_ROOM.NARROW,
  );
  mainRef.current = mainTabs;
  const columnEmpty =
    viewed.activeTaskId !== undefined &&
    agents.agentIds !== undefined &&
    mainTabs.tab === undefined;
  const opensDraft =
    input.room !== SHELL_ROOM.NARROW &&
    agents.onUnarchive === undefined &&
    startsOwnAgents(agents.mode);
  const fillColumn = useSteadyDoor(() => {
    if (opensDraft) agents.onNewDraft();
    else mainTabs.onChoose(MAIN_TAB.OVERVIEW);
  });
  const taskPages = useQuery(
    pagesQuery(viewed.activeTaskId === undefined ? undefined : { taskId: viewed.activeTaskId }),
  ).data;
  const pages = useMemo(() => (taskPages ?? NO_PAGES).map((page) => page.id), [taskPages]);
  const pageAgent = agentView?.agentId;
  const pageAgents = useMemo(
    () => (pageAgent === undefined ? undefined : [pageAgent]),
    [pageAgent],
  );
  const inboxAsked = inboxView?.chosen;
  const inboxChosen =
    inboxAsked !== undefined &&
    (!("taskId" in inboxAsked) ||
      inWorkspace([inboxAsked], tasks.tasks, listedWorkspaceId).length > 0)
      ? inboxAsked
      : undefined;
  const inboxTask = inboxChosen === undefined ? undefined : choiceTaskOf(inboxChosen);
  const inboxAgent = inboxChosen === undefined ? undefined : choiceAgentOf(inboxChosen);
  const inboxPages = useQuery(
    pagesQuery(
      inboxView === undefined
        ? undefined
        : inboxTask !== undefined
          ? { taskId: inboxTask }
          : inboxAgent !== undefined
            ? { agentId: inboxAgent }
            : undefined,
    ),
  ).data;
  const agentPages = useQuery(
    pagesQuery(
      inboxView !== undefined || pageAgent === undefined ? undefined : { agentId: pageAgent },
    ),
  ).data;
  const agentPageIds = useMemo(() => (agentPages ?? NO_PAGES).map((page) => page.id), [agentPages]);
  const inboxPageIds = useMemo(() => (inboxPages ?? NO_PAGES).map((page) => page.id), [inboxPages]);
  const inboxAgents = useMemo(
    () => (inboxAgent === undefined ? NO_IDS : [inboxAgent]),
    [inboxAgent],
  );
  const inboxTaskAgents = useInboxTaskAgents(inboxView === undefined ? undefined : inboxTask);
  const activeTaskId = viewed.activeTaskId;
  const cloudPlace = useMemo(
    () =>
      inboxView !== undefined
        ? undefined
        : pageAgent !== undefined
          ? { agentId: pageAgent }
          : activeTaskId === undefined
            ? undefined
            : { taskId: activeTaskId },
    [inboxView, pageAgent, activeTaskId],
  );
  const cloudListed = useCloudBrowserTabs(cloudPlace, cloudPlace !== undefined);
  const cloudDrafts = useCloudBrowserDrafts(cloudPlace, cloudPlace !== undefined);
  const cloudBrowsers = useMemo(
    () =>
      cloudPlace === undefined
        ? NO_IDS
        : cloudListed === undefined
          ? undefined
          : [...cloudListed.map((each) => each.id), ...cloudDrafts.map((each) => each.id)],
    [cloudPlace, cloudListed, cloudDrafts],
  );
  const panelTaskId =
    inboxView !== undefined ? inboxTask : pageAgents === undefined ? activeTaskId : undefined;
  const panelRepository = tasks.tasks.find((task) => task.id === panelTaskId)?.repository ?? null;
  const panelFileReads = useMemo(
    () =>
      panelTaskId === undefined
        ? undefined
        : { place: { taskId: panelTaskId }, repository: panelRepository },
    [panelTaskId, panelRepository],
  );
  const panelPagesAgent = inboxView !== undefined ? inboxAgent : pageAgent;
  const panelPages = useMemo(
    () =>
      panelTaskId !== undefined
        ? { taskId: panelTaskId }
        : panelPagesAgent === undefined
          ? undefined
          : { agentId: panelPagesAgent },
    [panelTaskId, panelPagesAgent],
  );
  const experiments =
    useQuery({ ...appStateQuery, select: selectExperimentChoices }).data ?? NO_EXPERIMENTS;
  const sidePanel = useSidePanel(
    tasksFixture?.fixtureSidePanel(input.run),
    inboxView !== undefined
      ? {
          id: inboxTask ?? inboxAgent,
          holds: NO_HOLDS,
          bare: true,
          files: panelFileReads,
          pages: panelPages,
          stop: inboxChosen?.itemId,
        }
      : pageAgents === undefined
        ? { id: viewed.activeTaskId, holds: NO_HOLDS, files: panelFileReads, pages: panelPages }
        : { id: pageAgent, holds: NO_HOLDS, pages: panelPages },
    inboxView !== undefined ? inboxAgents : (pageAgents ?? mainTabs.openAgents),
    NO_IDS,
    inboxView !== undefined ? inboxPageIds : pageAgents === undefined ? pages : agentPageIds,
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.agentIds
        : inboxAgents
      : (pageAgents ?? agents.agentIds),
    input.room,
    cloudBrowsers,
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.heldIds
        : inboxAgents
      : (pageAgents ?? agents.heldIds),
  );
  const pinLabels = useMemo(
    () => ({
      pullRequests: new Map(
        [...agents.pullRequests].map(([agentId, pullRequest]) => [
          agentId,
          pullRequestLabelOf(pullRequest),
        ]),
      ),
      numbered: new Map(
        [...agents.numberedPullRequests].map(([agentId, numbered]) => [
          agentId,
          new Map(
            [...numbered].map(([number, pullRequest]) => [number, pullRequestLabelOf(pullRequest)]),
          ),
        ]),
      ),
    }),
    [agents.pullRequests, agents.numberedPullRequests],
  );
  const { onRenamePins } = sidePanel;
  useEffect(() => {
    if (viewed.activeTaskId !== undefined) onRenamePins(viewed.activeTaskId, pinLabels);
  }, [viewed.activeTaskId, pinLabels, onRenamePins]);
  const markTaskNow = useRef<(taskId: string, mark: TaskMark) => Promise<boolean>>(() =>
    Promise.resolve(false),
  );
  const migratedPins = useRef(new Set<string>());
  const { onUnpin } = sidePanel;
  useEffect(() => {
    for (const pin of sidePanel.pins) {
      if (!("task" in pin)) continue;
      const { task: taskId, tab } = pin;
      if (tab !== SIDE_PANEL_TAB.DESCRIPTION || migratedPins.current.has(taskId)) continue;
      const pinned = tasks.tasks.find((each) => each.id === taskId);
      if (pinned === undefined) continue;
      migratedPins.current.add(taskId);
      if (pinned.pinnedAt !== undefined) {
        onUnpin({ task: taskId }, tab);
        continue;
      }
      markTaskNow.current(pinned.id, TASK_MARK.PIN).then((changed) => {
        if (changed) onUnpin({ task: taskId }, tab);
      });
    }
  }, [sidePanel.pins, tasks.tasks, onUnpin]);
  const routedOver =
    input.adminView.open ||
    input.boardView.open ||
    input.personView.userId !== undefined ||
    input.automationsView.open;
  const stateShown = shown && !routedOver;
  const columnInView =
    stateShown && historyFor === undefined && standIn === undefined && !sidePanel.fullScreen;
  const columnShown = columnInView && fixture === undefined;
  useEffect(() => {
    if (columnEmpty && columnInView) fillColumn();
  }, [columnEmpty, columnInView, fillColumn]);
  const shownTab = mainTabs.tab;
  const draftInView =
    columnInView && shownTab !== undefined && isDraftTab(shownTab) ? shownTab.draft : undefined;
  const blankDraft =
    agents.draft !== undefined && holdsNothing(agents.draft) ? agents.draft.id : undefined;
  const columnSettled = shownTab !== undefined;
  const discardDraftNow = useRef(agents.onDiscardDraft);
  discardDraftNow.current = agents.onDiscardDraft;
  const blankInView = useRef<string | undefined>(undefined);
  useEffect(() => {
    const left = blankInView.current;
    blankInView.current =
      draftInView !== undefined && draftInView === blankDraft ? blankDraft : undefined;
    if (left !== undefined && left !== draftInView) discardDraftNow.current(left);
    if (blankDraft !== undefined && blankDraft !== draftInView && columnSettled) {
      discardDraftNow.current(blankDraft);
    }
  }, [draftInView, blankDraft, columnSettled]);
  const inboxTranscript =
    stateShown &&
    fixture === undefined &&
    inboxView !== undefined &&
    sidePanel.open &&
    sidePanel.tab !== undefined &&
    isTranscriptTab(sidePanel.tab)
      ? sidePanel.tab.transcript
      : undefined;
  const shownAgent =
    stateShown && fixture === undefined && agentView !== undefined
      ? agentView.agentId
      : inboxTranscript !== undefined
        ? inboxTranscript
        : columnShown && mainTabs.tab !== undefined && isAgentTab(mainTabs.tab)
          ? mainTabs.tab.agent
          : null;
  const shownInbox =
    stateShown && fixture === undefined && inboxView !== undefined ? (inboxTask ?? null) : null;
  const reportedAgent = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reportedAgent.current === shownAgent) return;
    reportedAgent.current = shownAgent;
    tellShown({ agentId: shownAgent });
  }, [shownAgent, tellShown]);

  const openTaskId = tasks.activeTaskId;
  const boundFor = asked !== undefined && asked.over === openTaskId ? asked.taskId : openTaskId;
  const descriptionsOn = experimentOn(experiments, EXPERIMENT.DESCRIPTIONS);
  if (historyFor !== undefined && (historyFor.taskId !== boundFor || !descriptionsOn)) {
    setHistoryFor(undefined);
  }
  const historyOpen =
    historyFor !== undefined &&
    historyFor.taskId === boundFor &&
    region.kind !== DOCUMENT_REGION.MISSING;
  if (chosen !== undefined && openTaskId !== chosen.over) {
    const pinTask = "task" in chosen.pin ? chosen.pin.task : undefined;
    setChosen(openTaskId === pinTask ? { pin: chosen.pin, over: openTaskId } : undefined);
  }
  const listedId = listedWorkspace?.id;
  const tasksNow = tasks.tasks;
  const workspacesNow = viewed.workspaces;
  const lastOpenIn = useRef(new Map<string, string>());
  const openWorkspaceId = tasksNow.find((task) => task.id === openTaskId)?.workspaceId;
  useEffect(() => {
    if (openTaskId !== undefined && openWorkspaceId !== undefined) {
      lastOpenIn.current.set(openWorkspaceId, openTaskId);
    }
  }, [openTaskId, openWorkspaceId]);
  const opening = useRef<{ readonly taskId: string; readonly startedAt: number } | undefined>(
    undefined,
  );
  const readyTask = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  useEffect(() => {
    const timed = opening.current;
    if (timed === undefined || readyTask?.id !== timed.taskId) return;
    opening.current = undefined;
    const descriptionChars = readyTask.document.body.length;
    recordPanelSpan({
      name: PANEL_SPAN.TASK_OPEN,
      startedAt: timed.startedAt,
      endedAt: Date.now(),
      attributes: () => ({ [PANEL_SPAN_ATTRIBUTE.DESCRIPTION_CHARS]: descriptionChars }),
    });
  }, [readyTask]);
  const openTask = useCallback(
    (taskId: string, onOpened: () => void, onRefused: () => void = () => undefined) => {
      setStandIn(undefined);
      const ask = { taskId, over: openTaskId };
      const timed = { taskId, startedAt: Date.now() };
      opening.current = taskId === openTaskId ? undefined : timed;
      const withdraw = () => {
        setAsked((held) => (held === ask ? undefined : held));
        if (opening.current === timed) opening.current = undefined;
        onRefused();
      };
      if (fixture === undefined) setAsked(ask);
      sendSelect({ taskId }).then((opened) => {
        if (!opened) {
          withdraw();
          return;
        }
        onOpened();
      }, withdraw);
    },
    [sendSelect, fixture, openTaskId],
  );
  const leaveTask = useCallback(() => {
    setStandIn(undefined);
    opening.current = undefined;
    if (fixture !== undefined) return;
    const ask = { taskId: undefined, over: openTaskId };
    setAsked(ask);
    sendClose().catch(() => setAsked((held) => (held === ask ? undefined : held)));
  }, [fixture, openTaskId, sendClose]);
  const navigations = useRef(0);
  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      navigations.current += 1;
      const mine = navigations.current;
      chooseListed(workspaceId);
      if (openWorkspaceId === undefined || openWorkspaceId === workspaceId) return;
      const last = lastOpenIn.current.get(workspaceId);
      const reopens = tasksNow.some((task) => task.id === last && task.workspaceId === workspaceId);
      if (last === undefined || !reopens) {
        leaveTask();
        return;
      }
      openTask(
        last,
        () => undefined,
        () => {
          if (navigations.current === mine) leaveTask();
        },
      );
    },
    [chooseListed, openWorkspaceId, tasksNow, openTask, leaveTask],
  );
  const standingNow = useRef({ listed: listedId, open: openTaskId });
  standingNow.current = { listed: listedId, open: openTaskId };
  const select = useCallback(
    (taskId: string) => {
      navigations.current += 1;
      const mine = navigations.current;
      const taskWorkspace = tasksNow.find((task) => task.id === taskId)?.workspaceId;
      const target = workspacesNow.find((each) => each.id === taskWorkspace);
      const from = workspacesNow.find((each) => each.id === listedId);
      const over = openTaskId;
      openTask(taskId, () => {
        if (navigations.current !== mine) return;
        if (target === undefined || target.id === listedId) return;
        chooseListed(target.id);
        if (from === undefined) return;
        const back = () => {
          const now = standingNow.current;
          if (now.listed !== target.id || now.open !== taskId) return;
          navigations.current += 1;
          const backed = navigations.current;
          chooseListed(from.id);
          if (over === undefined) leaveTask();
          else {
            openTask(
              over,
              () => undefined,
              () => {
                if (navigations.current === backed) leaveTask();
              },
            );
          }
        };
        toast({
          words: switchedNote(target.name),
          tone: STATUS_TONE.COMPLETE,
          action: { label: backNote(from.name), onPress: back },
        });
      });
    },
    [tasksNow, workspacesNow, listedId, openTaskId, openTask, chooseListed, toast, leaveTask],
  );

  const sendDeleteTask = async (taskId: string): Promise<ActedResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await askKept(sendAct(ACT_KIND.TASKS_DELETE, { taskId }));
    if (deleted.kept) return { status: ACTION_RESULT_STATUS.ACCEPTED };
    return { ...DELETE_REFUSED, cause: deleted.cause };
  };
  const deleteTaskOptions = taskDeleteMutation(sendDeleteTask);
  const { mutateAsync: deleteTask } = useMutation(deleteTaskOptions);

  const drawnTasks = useRef(tasks);
  drawnTasks.current = tasks;
  const drawnRows = () => drawnTasks.current;
  const renameDoors: RowDoors<TasksView, typeof ROW_WRITE.TASK_RENAME.kind> = {
    rows: drawnRows,
    send: sendTaskRename,
  };
  const taskPinDoors: RowDoors<TasksView, typeof ROW_WRITE.TASK_PIN.kind> = {
    rows: drawnRows,
    send: sendTaskPin,
  };
  const agentPinDoors: RowDoors<TasksView, typeof ROW_WRITE.AGENT_PIN.kind> = {
    rows: drawnRows,
    send: sendAgentPin,
  };
  const standingDoors: RowDoors<TasksView, typeof ROW_WRITE.TASK_STANDING.kind> = {
    rows: drawnRows,
    send: sendStandingRow,
  };

  const renameTask =
    fixture === undefined
      ? taskRenameMutation((asked) => sendAct(ROW_WRITE.TASK_RENAME.kind, asked), renameDoors)
      : taskRenameMutation(() => Promise.resolve(false), undefined);

  const openNow = useRef(openTaskId);
  openNow.current = openTaskId;

  const markTask = (taskId: string, mark: TaskMark): Promise<boolean> => {
    if (fixture !== undefined) return Promise.resolve(false);
    const pinned = mark === TASK_MARK.PIN;
    const pressed = pressRows(ROW_WRITE.TASK_PIN, taskPinDoors, [
      { id: taskId, after: { pinned, position: null } },
    ]);
    return askKept(sendTaskPin({ taskId, pinned })).then((changed) => {
      if (changed.kept) {
        pressed.keep(TASK_MARKED_NOTES[mark]);
        return true;
      }
      toast({
        replayUnmasked: true,
        words: MARK_FAILED_NOTES[mark],
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.TASK_MARK, cause: changed.cause, about: { taskId } },
      });
      return false;
    });
  };
  markTaskNow.current = markTask;
  const pinRepository = (repository: string, pinned: boolean) => {
    if (fixture !== undefined) return;
    askKept(sendRepositoryPin({ repository, pinned })).then((changed) => {
      if (changed.kept) return;
      toast({
        replayUnmasked: true,
        words: pinned ? REPOSITORY_PIN_FAILED_NOTES.PIN : REPOSITORY_PIN_FAILED_NOTES.UNPIN,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.REPOSITORY_PIN, cause: changed.cause },
      });
    });
  };

  const agentPinFlights = useRef(new Map<string, Promise<unknown>>());
  const accountNow = useRef(input.account);
  accountNow.current = input.account;
  const askAgentPin = (
    agentId: string,
    pinned: boolean,
    position?: string,
  ): Promise<AgentPinAsked> => {
    const flights = agentPinFlights.current;
    const pressedBy = input.account;
    const placed = position === undefined ? {} : { position };
    const asked = (flights.get(agentId) ?? Promise.resolve()).then(
      (): Promise<AgentPinAsked> | AgentPinAsked =>
        accountNow.current === pressedBy
          ? sendAgentPin({ agentId, pinned, ...placed }).then(
              (answer) => ("agent" in answer ? AGENT_PIN_ASKED.CHANGED : { refused: answer }),
              (error: unknown) => ({ refused: error }),
            )
          : AGENT_PIN_ASKED.UNASKED,
    );
    flights.set(agentId, asked);
    asked.then(() => {
      if (flights.get(agentId) === asked) flights.delete(agentId);
    });
    return asked;
  };
  const pinAgent = (agentId: string, pinned: boolean) => {
    if (fixture !== undefined) return;
    const pressed = pressRows(ROW_WRITE.AGENT_PIN, agentPinDoors, [
      { id: agentId, after: { pinned, position: null } },
    ]);
    askAgentPin(agentId, pinned).then((asked) => {
      if (asked === AGENT_PIN_ASKED.CHANGED) {
        pressed.keep(pinned ? AGENT_PINNED_NOTES.PIN : AGENT_PINNED_NOTES.UNPIN);
        return;
      }
      if (asked === AGENT_PIN_ASKED.UNASKED) return;
      toast({
        replayUnmasked: true,
        words: pinned ? AGENT_PIN_FAILED_NOTES.PIN : AGENT_PIN_FAILED_NOTES.UNPIN,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.AGENT_PIN, cause: asked.refused, about: { agentId } },
      });
    });
  };

  const carriedAsked = useRef(new Set<string>());
  const { carried, onCarried } = sidePanel;
  const { taskAgents, taskAgentPins = NO_TASK_AGENT_PINS } = tasks;
  const askCarried = useRef(askAgentPin);
  askCarried.current = askAgentPin;
  useEffect(() => {
    if (fixture !== undefined || taskAgents === undefined) return;
    for (const pin of carried) {
      if (carriedAsked.current.has(pin.agent)) continue;
      if (!tasks.tasks.some((task) => task.id === pin.task)) continue;
      carriedAsked.current.add(pin.agent);
      const pinned =
        taskAgentPins.some((each) => each.agentId === pin.agent) ||
        (tasklessAgents ?? []).some(
          (agent) => agent.id === pin.agent && agent.pinnedAt !== undefined,
        );
      if (pinned) {
        onCarried(pin.agent);
        continue;
      }
      askCarried.current(pin.agent, true, pin.position).then((asked) => {
        if (asked === AGENT_PIN_ASKED.CHANGED) onCarried(pin.agent);
      });
    }
  }, [fixture, carried, tasks.tasks, taskAgents, taskAgentPins, tasklessAgents, onCarried]);

  const movePins = (moves: readonly PinMove[], putBack?: () => void) => {
    if (fixture !== undefined || moves.length === 0) return;
    const pressedBy = input.account;
    const asked = moves.map(({ agent, id, position }) => {
      const flights = agentPinFlights.current;
      const flight: Promise<Kept | undefined> = agent
        ? (flights.get(id) ?? Promise.resolve(true)).then(() =>
            accountNow.current === pressedBy
              ? sendAgentPin({ agentId: id, pinned: true, position }).then(
                  (answer) => ("agent" in answer ? KEPT : notKept(answer)),
                  notKept,
                )
              : undefined,
          )
        : askKept(sendTaskPin({ taskId: id, pinned: true, position }));
      if (agent) flights.set(id, flight);
      return flight.then((changed) => {
        if (agent && flights.get(id) === flight) flights.delete(id);
        return changed;
      });
    });
    Promise.all(asked).then((answers) => {
      const asked = answers.filter((answer) => answer !== undefined);
      if (asked.every((answer) => answer.kept)) return;
      putBack?.();
      toast({
        replayUnmasked: true,
        words: PIN_MOVE_FAILED_NOTE,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.PIN_MOVE, cause: firstRefusal(asked) },
      });
    });
  };

  const writeSections = (writes: readonly TaskSectionWrite[]) => {
    const [first, ...rest] = writes;
    if (first === undefined || fixture !== undefined) return;
    askKept(sendSections({ writes: [first, ...rest] })).then((changed) => {
      if (changed.kept) return;
      toast({
        replayUnmasked: true,
        words: SECTION_WRITE_FAILED_NOTE,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.SECTION_WRITE, cause: changed.cause },
      });
    });
  };

  const standingTasksOf = (taskIds: readonly string[]) => {
    const held = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
    return taskIds.flatMap((taskId): readonly Pick<TaskSummary, "id" | "status">[] => {
      const task = tasks.tasks.find((each) => each.id === taskId);
      if (task !== undefined) return [task];
      return held?.id === taskId ? [held] : [];
    });
  };
  const sendStanding = (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ): Promise<Kept> => {
    const named = standing.assigneeId && assigneeName !== undefined ? { assigneeName } : undefined;
    return askKept(sendStandingRow({ taskId, ...standing, ...named }));
  };
  const sendStatuses = (changes: readonly StatusChange[]) => {
    const answers = changes.map(({ taskId, status }) => sendStanding(taskId, { status }));
    return Promise.all(answers).then((changed) => {
      const landed = changes
        .filter((_, index) => changed[index]?.kept === true)
        .map(({ taskId }) => taskId);
      return { landed, refused: changes.length - landed.length, cause: firstRefusal(changed) };
    });
  };

  const settleTasks = (taskIds: readonly string[], status: TaskStatus) => {
    if (fixture !== undefined) return;
    const asked = settleChanges(standingTasksOf(taskIds), status);
    if (asked.length === 0) return;
    const pressed = pressRows(
      ROW_WRITE.TASK_STANDING,
      standingDoors,
      asked.map((change) => ({ id: change.taskId, after: { status: change.status } })),
    );
    sendStatuses(asked).then(({ landed, refused, cause }) => {
      if (landed.length === 0) {
        toast({
          replayUnmasked: true,
          words: settleFailedNote(status, refused),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.TASK_SETTLE, cause },
        });
        return;
      }
      const words = settledNote(status, landed.length, refused);
      const undo = pressed.keep(words, (taskId) => landed.includes(taskId));
      toast(
        undo === undefined
          ? { replayUnmasked: true, words, tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }
          : { ...undoToast(words, undo), replayUnmasked: true },
      );
    });
  };

  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(descriptionMarkdown(region.task), TASK_COPIED_NOTE);
  };

  const unreadTabs: readonly StripTab[] = input.unseenAgents.map((agent) => ({ agent }));

  const repositoriesOf =
    region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : listedWorkspace?.id;
  const openGitHub = useCallback((url: string) => appPlatform().openGitHub(url), []);
  const repositoriesIn = useCallback(
    (workspaceId: string | undefined): RepositoryChooser => {
      const workspace = viewed.workspaces.find((each) => each.id === workspaceId);
      const own =
        workspaceId === undefined
          ? tasks.tasks
          : tasks.tasks.filter((task) => task.workspaceId === workspaceId);
      const offered =
        workspace === undefined
          ? own
          : own.filter(
              (task) => task.repository !== null && workspaceReaches(workspace, task.repository),
            );
      return {
        recent: recentRepositories(offered),
        reading: tasks.listStatus !== TASKS_READ.READY && tasks.listStatus !== TASKS_READ.FAILED,
        openGitHub,
        pictures: fixture === undefined,
        scope: workspaceId,
        manages: workspace === undefined || managesWorkspace(workspace),
        ...(workspace?.github == null ? undefined : { connected: true }),
      };
    },
    [viewed.workspaces, tasks.tasks, tasks.listStatus, fixture, openGitHub],
  );
  const repositories = useMemo(
    () => repositoriesIn(repositoriesOf),
    [repositoriesIn, repositoriesOf],
  );
  const accountGitHub = (
    kind: typeof ACT_KIND.GITHUB_CONNECT | typeof ACT_KIND.GITHUB_DISCONNECT,
  ): Promise<boolean> => {
    if (fixture !== undefined) return Promise.resolve(false);
    const send = kind === ACT_KIND.GITHUB_CONNECT ? sendGitHubConnect : sendGitHubDisconnect;
    return send().then(
      () => true,
      (refused: Error) => {
        toast({
          words: refused.message,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.GITHUB_ACCOUNT, act: kind, cause: refused },
        });
        return false;
      },
    );
  };
  const setRepository = (
    taskId: string,
    repository: string | null,
  ): Promise<string | undefined> => {
    if (fixture !== undefined) return Promise.resolve(undefined);
    return sendTaskRepository({ taskId, repository }).then(
      (answer) => ("failure" in answer ? repositoryChangeFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );
  };

  const setTaskStanding = (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ): Promise<Kept> => {
    if (fixture !== undefined) return Promise.resolve(notKept(FAILURE_CONDITION.NOT_KEPT));
    const { assigneeId, ...rest } = standing;
    const assignee =
      assigneeId === undefined
        ? undefined
        : {
            assignee: assigneeId === null ? null : { userId: assigneeId, name: assigneeName ?? "" },
          };
    const pressed = pressRows(ROW_WRITE.TASK_STANDING, standingDoors, [
      { id: taskId, after: { ...rest, ...assignee } },
    ]);
    return sendStanding(taskId, standing, assigneeName).then((kept) => {
      if (kept.kept) pressed.keep(standingNote(standing));
      return kept;
    });
  };

  const setTaskBlock = (taskId: string, block: TaskBlockRequest, onKept?: () => void) => {
    if (fixture !== undefined) return;
    void sendBlock({ taskId, block })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) {
          onKept?.();
          return;
        }
        toast({
          replayUnmasked: true,
          words: relationRefusedNote(answer.failure),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.TASK_BLOCK, cause: answer, about: { taskId } },
        });
      });
  };

  const removeTaskBlock = (taskId: string, relation: TaskBlockRelation, otherId: string) => {
    setTaskBlock(taskId, { change: TASK_BLOCK_CHANGE.REMOVE, relation, taskId: otherId }, () =>
      toast({
        ...undoToast(BLOCK_REMOVED_NOTE, () =>
          setTaskBlock(taskId, { change: TASK_BLOCK_CHANGE.ADD, relation, taskId: otherId }),
        ),
        replayUnmasked: true,
      }),
    );
  };

  const setTaskParent = (taskId: string, parentTaskId: string | null, onKept?: () => void) => {
    if (fixture !== undefined) return;
    void sendParent({ taskId, parentTaskId })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) {
          onKept?.();
          return;
        }
        toast({
          replayUnmasked: true,
          words: relationRefusedNote(answer.failure),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.TASK_PARENT, cause: answer, about: { taskId } },
        });
      });
  };

  const removeTaskParent = (taskId: string) => {
    const parentTaskId =
      tasks.tasks.find((task) => task.id === taskId)?.parentTaskId ??
      (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
        ? region.task.parentTaskId
        : undefined);
    if (parentTaskId === undefined) return;
    setTaskParent(taskId, null, () =>
      toast({
        ...undoToast(PARENT_REMOVED_NOTE, () => setTaskParent(taskId, parentTaskId)),
        replayUnmasked: true,
      }),
    );
  };

  const changeTaskRelation = (taskId: string, relation: TaskRelationChangeRequest) => {
    if (fixture !== undefined) return;
    void sendRelation({ taskId, relation })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) return;
        toast({
          replayUnmasked: true,
          words: relationRefusedNote(answer.failure),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.TASK_RELATION, cause: answer, about: { taskId } },
        });
      });
  };

  const moveTaskOptions = taskMoveMutation(({ taskId, workspaceId, quiet }) => {
    if (fixture !== undefined) return Promise.resolve(false);
    const choicesThen = workspaceChoices.current;
    return sendAct(ACT_KIND.TASKS_MOVE, { taskId, workspaceId })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) {
          if (openNow.current === taskId && workspaceChoices.current === choicesThen) {
            listWorkspace(answer.workspaceId);
          }
          return true;
        }
        if (quiet !== true) {
          toast({
            replayUnmasked: true,
            words: MOVE_REFUSED_NOTE,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: {
              surface: FAILURE_SURFACE.TASK_MOVE,
              cause: answer,
              about: { taskId, workspaceId },
            },
          });
        }
        return false;
      });
  });
  const { mutateAsync: sendTaskMove } = useMutation(moveTaskOptions);
  const moveTask = (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ): Promise<boolean> => sendTaskMove({ taskId, workspaceId, quiet: told?.quiet === true });

  const descriptionEdit = (taskId: string) =>
    descriptionEditMutation(taskId, (request) =>
      fixture === undefined
        ? sendAct(ACT_KIND.TASKS_EDIT, { taskId, edit: request })
        : Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
    );

  const changeRepository = (taskId: string) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setRepositoryMenu((held) => ({ taskId, request: (held?.request ?? 0) + 1 }));
  };

  const addRelation = (taskId: string, kind: TaskRelationKind) => {
    if (taskId !== tasks.activeTaskId || standIn !== undefined) select(taskId);
    setRelationMenu((held) => ({ taskId, kind, request: (held?.request ?? 0) + 1 }));
  };

  const historySource = useMemo(
    (): DescriptionHistorySource => ({
      readPage: (taskId, before) => askAct(ACT_KIND.TASKS_REVISIONS, { taskId, before }),
      restore: (taskId, seq) => sendRestore({ taskId, seq }),
    }),
    [sendRestore],
  );
  const historyTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const historyRead = useQuery({
    ...historyQuery(historyTaskId),
    enabled: shown && historyOpen && historyTaskId !== undefined,
  });
  const { mutate: retryHistory } = useMutation(historyRetryMutation());
  const onRetryHistory = useCallback(() => {
    if (historyTaskId !== undefined) retryHistory({ taskId: historyTaskId });
  }, [retryHistory, historyTaskId]);
  const heldHistory = useMemo(
    () => ({ rows: historyRead.data, failed: historyRead.isError, onRetry: onRetryHistory }),
    [historyRead.data, historyRead.isError, onRetryHistory],
  );
  const history = useDescriptionHistory({
    source: historySource,
    taskId: historyTaskId,
    history: heldHistory,
    editedAt: region.kind === DOCUMENT_REGION.READY ? region.task.lastEdit?.at : undefined,
    name: region.kind === DOCUMENT_REGION.READY ? region.task.name : undefined,
    shown: shown && historyOpen,
    seek: historyFor?.save,
    returnTo: historyFor?.spot,
    onRestored: (undo) => sayRestored(toast, undo),
  });

  const opensNewTask =
    useQuery({ ...appStateQuery, select: selectOpensNewTask }).data ??
    APP_SETTING_DEFAULTS.openNewTask;
  const openUnpinned = (taskId: string) => {
    setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
    select(taskId);
  };
  const resumeListed = (taskId: string) => {
    openUnpinned(taskId);
    const narrow = input.room === SHELL_ROOM.NARROW;
    if (narrow) sidePanel.onSetOpen(false);
    const agentId = resumingAgentOf(taskId, tasksNow, input.inboxWaiting);
    if (agentId !== undefined) mainTabs.onShow(taskId, { agent: agentId });
    else if (narrow) mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  const selectListed = (taskId: string) => {
    if (input.room !== SHELL_ROOM.NARROW) {
      resumeListed(taskId);
      return;
    }
    openUnpinned(taskId);
    sidePanel.onSetOpen(false);
    mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  const startTask = (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    from: NewTaskStart = {},
  ): Promise<Failure | undefined> => {
    const { handed, card } = from;
    const standingBefore = standIn;
    const historyBefore = historyFor;
    const stays = !opensNewTask;
    const pressedAt = navigations.current;
    const sentAt = Date.now();
    const line =
      handed === undefined || stays
        ? undefined
        : openingLineOf({
            key: handed.idempotencyKey,
            prompt: handed.prompt,
            attachments: handed.attachments,
            sentAt,
          });
    const letGoOfPage = () => setStartingTask((now) => (now?.line === line ? undefined : now));
    if (handed !== undefined && stays) setNewTaskAsk(undefined);
    else if (line !== undefined) {
      setStartingTask({ line, choice: handed?.choice, navigation: pressedAt });
      setNewTaskAsk(undefined);
      setStandIn(undefined);
      setHistoryFor(undefined);
    }
    const saidInToast = handed === undefined && !stays && newTaskAsk === undefined;
    const refusedWith = (note: ComposerNote): ComposerNote => {
      if (saidInToast) {
        toast({
          words: note.text,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.TASK_START, cause: note.cause },
        });
      }
      if (handed !== undefined) {
        letGoOfPage();
        if (navigations.current === pressedAt) {
          setStandIn((now) => now ?? standingBefore);
          setHistoryFor((now) => now ?? historyBefore);
        }
        setNewTaskAsk({
          preset:
            card === undefined
              ? undefined
              : {
                  ...(card.purpose === undefined ? undefined : { purpose: card.purpose }),
                  refused: { card, note },
                },
        });
      }
      return note;
    };
    return sendTaskStart({
      ...(name.length === 0 ? undefined : { name }),
      ...(repository === null ? undefined : { repository }),
      ...(workspaceId === undefined ? undefined : { workspaceId }),
      ...(from.runsOn === undefined || from.handed !== undefined
        ? undefined
        : { runsOn: from.runsOn }),
      ...(from.mode === undefined ? undefined : { mode: from.mode }),
      ...(from.relations === undefined || from.relations.length === 0
        ? undefined
        : { relations: from.relations }),
      planning: false,
      ...(from.handed === undefined
        ? undefined
        : {
            agent: {
              ...agentRequest(from.handed),
              ...(from.runsOn === undefined ? undefined : { runsOn: from.runsOn }),
            },
          }),
      ...(stays ? { quiet: true } : undefined),
    }).then(
      (answer) => {
        if ("failure" in answer) {
          return refusedWith({
            reason: FAILURE_REASON.OTHER,
            text:
              answer.failure === TASK_CALL_FAILURE.LOCAL_AGENT_REFUSED
                ? localAgentRefusalWords(answer.localAgentRefusal, from.device)
                : startFailureNote(answer.failure),
            cause: answer,
          });
        }
        if (stays) {
          if (handed === undefined) setNewTaskAsk(undefined);
          else openAgent(answer.planId, handed, answer.agentStart, from.device, sentAt);
          const { agentStart } = answer;
          sayStarted(
            answer.planId,
            handed === undefined || (agentStart !== undefined && !("failure" in agentStart)),
          );
          return undefined;
        }
        if (handed === undefined) {
          setNewTaskAsk(undefined);
          setStartingTask(undefined);
          setStandIn(undefined);
          setHistoryFor(undefined);
          return undefined;
        }
        letGoOfPage();
        openAgent(answer.planId, handed, answer.agentStart, from.device, sentAt);
        return undefined;
      },
      (refused: Error) =>
        refusedWith({ reason: FAILURE_REASON.OTHER, text: refused.message, cause: refused }),
    );
  };

  const selectNow = useRef(guard(openUnpinned));
  selectNow.current = guard(openUnpinned);
  const sayStarted = (planId: string, agentRan: boolean) =>
    toast({
      replayUnmasked: true,
      words: agentRan ? TASK_STARTED_NOTE : TASK_STARTED_AGENT_REFUSED_NOTE,
      tone: agentRan ? STATUS_TONE.COMPLETE : STATUS_TONE.ATTENTION,
      action: {
        label: OPEN_STARTED_TASK,
        replayUnmasked: true,
        onPress: () => selectNow.current(planId),
      },
    });

  const openAgent = (
    planId: string,
    handed: NewTaskAgent,
    started: AgentAgentAnswer | undefined,
    device: MacOffer | undefined,
    sentAt: number,
  ) => {
    if (started !== undefined && !("failure" in started)) {
      agents.onTaskStarted(planId, started.agent, {
        key: handed.idempotencyKey,
        prompt: handed.prompt,
        attachments: handed.attachments,
        sentAt,
      });
      mainTabs.onShow(planId, { agent: started.agent.id });
      return;
    }
    const answer = started ?? { failure: AGENT_CALL_FAILURE.UNANSWERED };
    const refused = { ...agentStartFailureNote(answer, planId, device), cause: answer };
    const { idempotencyKey: id, ...words } = handed;
    agents.onHandDraft(planId, { id, ...words, refused });
    mainTabs.onShow(planId, { draft: id });
  };

  const steadyStartTask = useSteadyDoor(startTask);

  const quickAdd: TasksControl["onQuickAdd"] = (name, into) =>
    sendTaskStart({
      name,
      ...(into.repository === undefined ? undefined : { repository: into.repository }),
      ...(listedWorkspace === undefined ? undefined : { workspaceId: listedWorkspace.id }),
      ...startingStanding(into.standing),
      planning: false,
      quiet: true,
    }).then(
      (answer): Failure | undefined =>
        "failure" in answer
          ? { reason: FAILURE_REASON.OTHER, text: startFailureNote(answer.failure) }
          : undefined,
      (refused: Error): Failure => ({ reason: FAILURE_REASON.OTHER, text: refused.message }),
    );

  const newTaskWith = (preset: TasksControl["newTask"]["preset"]) =>
    setNewTaskAsk((standing) => standing ?? { preset });
  const newTask = () => {
    const atHome =
      page === TASKS_PAGE.HOME && standIn === undefined && historyFor === undefined && !routedOver;
    if (atHome && signedIn && newTaskAsk === undefined) setHomeNewTasks((n) => n + 1);
    else newTaskWith(undefined);
  };
  if (!shown && newTaskAsk !== undefined) setNewTaskAsk(undefined);

  const openHistory = (opening: HistoryOpening) => {
    if (!descriptionsOn) {
      showOverview({ kind: LINK_PLACE.TASK, planId: opening.taskId });
      return;
    }
    if (opening.taskId !== boundFor) select(opening.taskId);
    setStandIn(undefined);
    setHistoryFor(opening);
  };

  const showColumnTab = (taskId: string, tab: MainTab) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(taskId, tab);
  };

  const showPanelTab = (taskId: string, tab: SidePanelTab) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    sidePanel.onShow(taskId, tab);
  };
  const showOverview = (place: OverviewPlace) => {
    const standing = standIn === undefined && historyFor === undefined;
    const routed = route(
      { kind: ADDRESS.PLACE, link: { workspace: "", place } },
      { kind: HERE.TASKS_TAB, taskId: standing ? tasks.activeTaskId : undefined },
    );
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    if (routed.kind === ROUTE.OVERVIEW) {
      mainTabs.onChoose(MAIN_TAB.OVERVIEW);
      return;
    }
    if (place.planId !== tasks.activeTaskId) select(place.planId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    mainTabs.onShow(place.planId, MAIN_TAB.OVERVIEW);
  };
  const linkPanelTab = (place: TaskTabPlace, tab: SidePanelTab) => {
    const standing = standIn === undefined && historyFor === undefined;
    const routed = route(
      { kind: ADDRESS.PLACE, link: { workspace: "", place } },
      { kind: HERE.TASKS_TAB, taskId: standing ? tasks.activeTaskId : undefined },
    );
    if (routed.kind === ROUTE.PREVIEW) sidePanel.onPreview(tab);
    else showPanelTab(place.planId, tab);
  };

  const sharedChangesAgent = (planId: string, agentId: string): string => {
    const url = planId === tasks.activeTaskId ? agents.pullRequests.get(agentId)?.url : undefined;
    if (url === undefined) return agentId;
    const drawn = agents.agentIds ?? [];
    const open = sidePanel.changes.find(
      (tab) => drawn.includes(tab.changes) && agents.pullRequests.get(tab.changes)?.url === url,
    );
    return open?.changes ?? agentId;
  };

  const listLinked = (workspace: string): string | undefined => {
    const home = workspaceOfSlug(viewed.workspaces, workspace);
    if (home !== undefined && home.id !== listedWorkspace?.id) chooseListed(home.id);
    return home?.id ?? listedWorkspace?.id;
  };

  const showSource = (taskId: string, source: RevisionSource) => {
    showColumnTab(taskId, { agent: source.agentId });
  };

  const showTaskAgents = (taskId: string) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    setStandIn(undefined);
    setHistoryFor(undefined);
    const returnTab = taskId === tasks.activeTaskId ? mainTabs.returnTab : undefined;
    if (returnTab !== undefined && isOverviewTab(mainTabs.tab)) {
      mainTabs.onChoose(returnTab);
      return;
    }
    resumeListed(taskId);
  };

  const showMention = (mention: DescriptionMention) => {
    const anchor =
      mention.kind === MENTION_KIND.SECTION && descriptionsOn ? mention.anchor : undefined;
    if (anchor === undefined) {
      showTaskAgents(mention.taskId);
      return;
    }
    showOverview({ kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor });
    sectionAsks.current += 1;
    setSectionReveal({ taskId: mention.taskId, reveal: { anchor, ask: sectionAsks.current } });
  };

  const archivedAgent = (agentId: string) =>
    agents.archived?.some((agent) => agent.id === agentId) === true ||
    liveAgents?.some((agent) => agent.id === agentId && agent.archivedAt !== undefined) === true;

  const standInFor = (standing: StandIn) => {
    setHistoryFor(undefined);
    setStandIn(standing);
  };

  const revealThread = (
    changes: string,
    place: AgentPlaceOf<typeof LINK_PLACE.PULL_REQUEST_THREAD>,
  ) =>
    setThreadReveal((last) => ({
      agentId: changes,
      threadId: place.threadId,
      view: place.view,
      ask: (last?.ask ?? 0) + 1,
    }));
  const revealMessage = (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => {
    messageAsks.current += 1;
    setMessageReveal({
      agentId: place.agentId,
      messageId: place.messageId,
      ask: messageAsks.current,
    });
  };

  const openOnTask = (planId: string, place: AgentPlace) => {
    if (!TRANSCRIPT_PLACES.has(place.kind) || agents.agentIds?.includes(place.agentId) === true) {
      showOnTask(planId, place);
    } else if (archivedAgent(place.agentId)) {
      openArchived(place);
    } else if (liveAgents !== undefined) {
      showOnTask(planId, place);
    } else {
      const mine = navigations.current;
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (navigations.current !== mine) return;
        if (agent?.archivedAt === undefined) showOnTask(planId, place);
        else openArchived(place);
      });
    }
  };

  const openArchived = useSteadyDoor((place: AgentPlace) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    openOnAgentPage(place);
  });

  const showOnTask = (planId: string, place: AgentPlace) => {
    switch (place.kind) {
      case LINK_PLACE.WORKER:
        showColumnTab(planId, { agent: place.agentId });
        linkPanelTab(
          { ...place, planId },
          { subagent: place.callId, delegation: { agent: place.agentId, task: "" } },
        );
        return;
      case LINK_PLACE.CHANGES:
        linkPanelTab({ ...place, planId }, { changes: sharedChangesAgent(planId, place.agentId) });
        return;
      case LINK_PLACE.PULL_REQUEST_THREAD: {
        const changes = sharedChangesAgent(planId, place.agentId);
        sidePanel.onPullRequestView({ changes }, place.view);
        linkPanelTab({ ...place, planId }, { changes });
        revealThread(changes, place);
        return;
      }
      case LINK_PLACE.AGENT:
        showColumnTab(planId, { agent: place.agentId });
        return;
      case LINK_PLACE.MESSAGE:
        showColumnTab(planId, { agent: place.agentId });
        revealMessage(place);
        return;
    }
  };

  const openOnAgentPage = (place: AgentPlace) => {
    const { agentId } = place;
    standInFor({ kind: STAND_IN.AGENT, agentId });
    switch (place.kind) {
      case LINK_PLACE.WORKER:
        sidePanel.onShow(agentId, {
          subagent: place.callId,
          delegation: { agent: agentId, task: "" },
        });
        return;
      case LINK_PLACE.CHANGES:
        sidePanel.onShow(agentId, { changes: agentId });
        return;
      case LINK_PLACE.PULL_REQUEST_THREAD:
        sidePanel.onPullRequestView({ changes: agentId }, place.view);
        sidePanel.onShow(agentId, { changes: agentId });
        revealThread(agentId, place);
        return;
      case LINK_PLACE.AGENT:
        return;
      case LINK_PLACE.MESSAGE:
        revealMessage(place);
        return;
    }
  };

  const openLink = (link: ReadLink) => {
    const number = taskNumberOf(link.place);
    if (number === undefined) {
      openPlace(link);
      return;
    }
    navigations.current += 1;
    const mine = navigations.current;
    const opened = (taskId: string | undefined) => {
      if (navigations.current !== mine) return;
      openPlace(taskId === undefined ? link : { ...link, place: withTaskId(link.place, taskId) });
    };
    queryClient.fetchQuery(taskByNumberQueryOptions(link.workspace, number)).then(
      (found) => opened("taskId" in found ? found.taskId : undefined),
      () => opened(undefined),
    );
  };

  const openAgentPlace = (place: AgentPlace) => {
    const open = tasks.activeTaskId;
    if (place.planId !== undefined) openOnTask(place.planId, place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openOnTask(open, place);
    else if (tasklessAgents?.some((agent) => agent.id === place.agentId)) openOnAgentPage(place);
    else {
      const mine = navigations.current;
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (navigations.current !== mine) return;
        if (agent === undefined) standInFor({ kind: STAND_IN.AGENT, agentId: place.agentId });
        else if (agent.planId === null) openOnAgentPage(place);
        else if (agent.archivedAt !== undefined && TRANSCRIPT_PLACES.has(place.kind))
          openArchived(place);
        else showOnTask(agent.planId, place);
      });
    }
  };

  const openInboxItemOn = (workspace: string, place: InboxItemPlace, planId: string | null) => {
    const holder = planId === null ? undefined : viewed.tasks.find((task) => task.id === planId);
    listLinked(holder?.workspaceId ?? workspace);
    openTaskThread(holder?.id ?? ("planId" in place ? place.planId : undefined));
    standInFor({
      kind: STAND_IN.INBOX,
      chosen:
        holder !== undefined
          ? {
              taskId: holder.id,
              ...("agentId" in place ? { itemAgentId: place.agentId } : undefined),
              itemId: place.itemId,
              opened: true,
            }
          : { ...inboxChoiceOf(place), opened: true },
    });
  };

  const openInboxItemById = (place: InboxItemPlace) => {
    const mine = navigations.current;
    readInboxItemHome(queryClient, place.itemId).then((home) => {
      if (navigations.current !== mine) return;
      if (home === undefined) {
        standInFor({ kind: STAND_IN.INBOX, chosen: { itemId: place.itemId, opened: true } });
        return;
      }
      const found = { kind: LINK_PLACE.INBOX_ITEM, agentId: home.agentId, itemId: place.itemId };
      openInboxItemOn(home.workspaceId, found, home.planId);
    });
  };

  const openInboxItem = (workspace: string, place: InboxItemPlace) => {
    const open = tasks.activeTaskId;
    if ("planId" in place) openInboxItemOn(workspace, place, place.planId);
    else if (!("agentId" in place)) openInboxItemById(place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openInboxItemOn(workspace, place, open);
    else if (tasklessAgents?.some((agent) => agent.id === place.agentId))
      openInboxItemOn(workspace, place, null);
    else {
      const mine = navigations.current;
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (navigations.current !== mine) return;
        openInboxItemOn(workspace, place, agent?.planId ?? null);
      });
    }
  };

  const openBoard = (home: Pick<Workspace, "id" | "slug"> | undefined) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    setHistoryFor(undefined);
    setStandIn(undefined);
    input.boardView.onOpen(stepOf(shown));
  };

  const openPerson = (
    userId: string,
    name: string | undefined,
    home: Pick<Workspace, "id" | "slug"> | undefined,
  ) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    setHistoryFor(undefined);
    setStandIn(undefined);
    navigations.current += 1;
    if (shown.id !== listedWorkspace?.id) chooseListed(shown.id);
    input.personView.onOpen(userId, name, stepOf(shown));
  };

  const openAutomations = (to: AutomationsPlace, workspace?: string) => {
    const listedId = workspace === undefined ? listedWorkspace?.id : listLinked(workspace);
    const shown = viewed.workspaces.find((each) => each.id === listedId) ?? listedWorkspace;
    if (shown === undefined) return;
    setHistoryFor(undefined);
    setStandIn(undefined);
    input.automationsView.onOpen(to, stepOf(shown));
  };

  const goHome = () => {
    setHistoryFor(undefined);
    if (boundFor === undefined) setStandIn(undefined);
    else leaveTask();
  };

  const openPlace = ({ workspace, place }: ReadLink) => {
    navigations.current += 1;
    switch (place.kind) {
      case LINK_PLACE.HOME:
      case LINK_PLACE.BOARD:
        if (
          viewed.workspaces.length > 0 &&
          workspaceOfSlug(viewed.workspaces, workspace) === undefined
        ) {
          standInFor({ kind: STAND_IN.UNKNOWN_WORKSPACE });
          return;
        }
        listLinked(workspace);
        if (place.kind === LINK_PLACE.HOME) goHome();
        else openBoard(workspaceOfSlug(viewed.workspaces, workspace));
        return;
      case LINK_PLACE.TASK:
        showMention({ kind: MENTION_KIND.TASK, taskId: place.planId });
        return;
      case LINK_PLACE.SECTION:
        showMention({ kind: MENTION_KIND.SECTION, taskId: place.planId, anchor: place.anchor });
        return;
      case LINK_PLACE.COMMENT:
        if (!descriptionsOn) {
          showTaskAgents(place.planId);
          return;
        }
        showOverview(place);
        commentAsks.current += 1;
        setCommentReveal({
          planId: place.planId,
          thread: place.threadId,
          ask: commentAsks.current,
        });
        return;
      case LINK_PLACE.VERSION:
        openHistory({
          taskId: place.planId,
          save: undefined,
          spot: { revision: place.revision, opened: undefined },
        });
        return;
      case LINK_PLACE.PAGE:
        if ("agentId" in place) {
          standInFor({ kind: STAND_IN.AGENT, agentId: place.agentId });
          sidePanel.onShow(place.agentId, { page: place.pageId });
          return;
        }
        linkPanelTab(place, { page: place.pageId });
        return;
      case LINK_PLACE.WORKER:
      case LINK_PLACE.CHANGES:
      case LINK_PLACE.PULL_REQUEST_THREAD:
      case LINK_PLACE.AGENT:
      case LINK_PLACE.MESSAGE:
        openAgentPlace(place);
        return;
      case LINK_PLACE.PERSON: {
        const home = workspaceOfSlug(viewed.workspaces, workspace);
        listLinked(workspace);
        openPerson(place.userId, undefined, home);
        return;
      }
      case LINK_PLACE.INBOX: {
        listLinked(workspace);
        if (place.planId === undefined) leaveInboxTask();
        else chooseInboxTask(place.planId);
        timeInboxOpen();
        standInFor({ kind: STAND_IN.INBOX, chosen: undefined });
        return;
      }
      case LINK_PLACE.INBOX_ITEM:
        openInboxItem(workspace, place);
        return;
      case LINK_PLACE.AUTOMATIONS:
        openAutomations({ kind: AUTOMATIONS_PAGE.LIST }, workspace);
        return;
      case LINK_PLACE.AUTOMATION:
        openAutomations(
          { kind: AUTOMATIONS_PAGE.EDIT, automationId: place.automationId },
          workspace,
        );
        return;
      case LINK_PLACE.AUTOMATION_RUN:
        openAutomations(
          { kind: AUTOMATIONS_PAGE.EDIT, automationId: place.automationId, runId: place.runId },
          workspace,
        );
        return;
      case LINK_PLACE.ADMIN:
        input.adminView.onOpen(adminViewOfLink(place));
        return;
      case LINK_PLACE.SETTINGS:
        return;
    }
  };

  const showFile = (taskId: string, ref: CodeRef, commit: string | undefined) => {
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (taskId === tasks.activeTaskId) {
      sidePanel.onOpenFile(ref, commit);
      return;
    }
    select(taskId);
    setFileFor({ taskId, ref, commit });
  };
  if (fileFor !== undefined && fileFor.taskId !== boundFor) setFileFor(undefined);
  const { onOpenFile } = sidePanel;
  useEffect(() => {
    if (fileFor === undefined || fileFor.taskId !== tasks.activeTaskId) return;
    setFileFor(undefined);
    onOpenFile(fileFor.ref, fileFor.commit);
  }, [fileFor, tasks.activeTaskId, onOpenFile]);

  const openTabs = mainTabs.tabs;
  const { onClose: closeMainTab, onDoze: dozeMainTab } = mainTabs;
  const keepColumnClosed = useCallback(
    (tab: MainTab) => {
      const at = openTabs
        .filter((each) => !isOverviewTab(each))
        .findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0 && !isDraftTab(tab)) {
        const closed = { strip: CLOSED_TAB_STRIP.COLUMN, task, tab, at };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
    },
    [openTabs, viewed.activeTaskId, setClosedTabs, latestClosedTabs],
  );
  const closeColumnTab = useCallback(
    (tab: MainTab) => {
      keepColumnClosed(tab);
      closeMainTab(tab);
    },
    [keepColumnClosed, closeMainTab],
  );
  const dozeColumnTab = useCallback(
    (tab: MainTab) => {
      keepColumnClosed(tab);
      if (isAgentTab(tab)) dozeMainTab(tab);
      else closeMainTab(tab);
    },
    [keepColumnClosed, closeMainTab, dozeMainTab],
  );
  const { strip: panelStrip, files: panelFiles, onClose: closePanelTab } = sidePanel;
  const closeSidePanelTab = useCallback(
    (tab: SidePanelTab) => {
      const at = panelStrip.findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0) {
        const file = isFileTab(tab) ? panelFiles.find((each) => each.path === tab.file) : undefined;
        const closed = { strip: CLOSED_TAB_STRIP.SIDE_PANEL, task, tab, at, file };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
      closePanelTab(tab);
    },
    [panelStrip, panelFiles, closePanelTab, viewed.activeTaskId, setClosedTabs, latestClosedTabs],
  );
  const drawsOnAnyTask = (closed: ClosedTab): boolean =>
    closed.strip !== CLOSED_TAB_STRIP.SIDE_PANEL ||
    typeof closed.tab !== "string" ||
    DRAWN_KINDS.some((kind) => kind === closed.tab);
  const drawsAgain = (closed: ClosedTab): boolean => {
    const { tab } = closed;
    const agentIds = agents.agentIds;
    if (closed.strip === CLOSED_TAB_STRIP.COLUMN) {
      return !isAgentTab(tab) || agentIds === undefined || agentIds.includes(tab.agent);
    }
    if (typeof tab === "string") return drawsOnAnyTask(closed);
    if (isSubagentTab(tab))
      return drawsSubagent(tab, { agents: mainTabs.openAgents, subagents: NO_IDS });
    if (isChangesTab(tab)) return drawsChanges(tab, { taskAgents: agents.heldIds });
    if (isPageTab(tab)) return taskPages === undefined || pages.includes(tab.page);
    if (isTerminalTab(tab)) return drawsTerminal(tab, { taskAgents: agentIds });
    if (isLocalTab(tab)) return drawsLocal(tab, { taskAgents: agentIds });
    return true;
  };
  const reopenable = withUndrawnPassed(closedTabs, tasks.activeTaskId, drawsAgain, drawsOnAnyTask);

  const workingAgents = useMemo(
    () =>
      (agents.agents ?? []).flatMap((agent) => (agentStillWriting(agent.status) ? [agent.id] : [])),
    [agents.agents],
  );
  const waitingAgents = useMemo(
    () => input.inboxWaiting.flatMap((task) => task.items.map((item) => item.agentId)),
    [input.inboxWaiting],
  );
  const awakeAgents = useMemo(
    () => [...new Set([...workingAgents, ...waitingAgents])],
    [workingAgents, waitingAgents],
  );
  const taskOnScreen =
    stateShown && page === TASKS_PAGE.DOCUMENT && standIn === undefined && historyFor === undefined;
  const pinnedHere = (tab: StripTab) =>
    isAgentTab(tab)
      ? taskAgentPins.some((pin) => pin.agentId === tab.agent)
      : isPinnable(tab) &&
        viewed.activeTaskId !== undefined &&
        sidePanel.pins.some(
          (pin) => "task" in pin && pin.task === viewed.activeTaskId && sameTab(pin.tab, tab),
        );
  useIdleTabs({
    taskId: fixture === undefined ? viewed.activeTaskId : undefined,
    column:
      agents.agentIds === undefined
        ? undefined
        : {
            tabs: mainTabs.tabs,
            shown: taskOnScreen && !sidePanel.fullScreen ? mainTabs.tab : undefined,
            viewedAt: mainTabs.viewedAt,
            onViewedAt: mainTabs.onViewedAt,
            onIdle: dozeColumnTab,
            keeps: (tab) =>
              isOverviewTab(tab) ||
              isDraftTab(tab) ||
              pinnedHere(tab) ||
              awakeAgents.includes(tab.agent) ||
              input.unseenAgents.includes(tab.agent),
          },
    panel:
      inboxView !== undefined || pageAgents !== undefined
        ? undefined
        : {
            tabs: sidePanel.strip,
            shown: taskOnScreen && sidePanel.open ? sidePanel.tab : undefined,
            viewedAt: sidePanel.viewedAt,
            onViewedAt: sidePanel.onViewedAt,
            onIdle: closeSidePanelTab,
            keeps: (tab) => typeof tab === "string" || isCloudBrowserTab(tab) || pinnedHere(tab),
          },
    awake: awakeAgents,
    onWake: mainTabs.onWake,
  });
  const reopenHere = (closed: ClosedTab) => {
    if (!drawsAgain(closed)) return;
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (closed.strip === CLOSED_TAB_STRIP.SIDE_PANEL) {
      sidePanel.onReopen(closed.tab, closed.at, closed.file);
      return;
    }
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose(closed.tab);
    mainTabs.onMove(closed.tab, closed.at);
  };
  const reopenClosedTab = () => {
    const waiting = latestReopenFor();
    const open = waiting.length === 0 ? tasks.activeTaskId : undefined;
    const stack = withUndrawnPassed(latestClosedTabs(), open, drawsAgain, drawsOnAnyTask);
    const closed = stack.at(-1);
    if (closed === undefined || (waiting.length > 0 && waiting[0]?.task !== closed.task)) return;
    setClosedTabs(stack.slice(0, -1));
    if (waiting.length === 0 && closed.task === tasks.activeTaskId) {
      reopenHere(closed);
      return;
    }
    if (waiting.length === 0) select(closed.task);
    setReopenFor([...waiting, closed]);
  };
  useEffect(() => {
    const waiting = latestReopenFor();
    if (waiting.length === 0 || waiting[0]?.task === boundFor) return;
    setReopenFor(NO_CLOSED_TABS);
    setClosedTabs([...latestClosedTabs(), ...waiting.toReversed()]);
  }, [boundFor, latestReopenFor, setReopenFor, latestClosedTabs, setClosedTabs]);
  const reopenNow = useRef(reopenHere);
  reopenNow.current = reopenHere;
  useEffect(() => {
    if (reopenFor.length === 0 || reopenFor[0]?.task !== tasks.activeTaskId) return;
    setReopenFor(NO_CLOSED_TABS);
    for (const closed of reopenFor) reopenNow.current(closed);
  }, [reopenFor, tasks.activeTaskId, setReopenFor]);

  const toggleSidePanel = () => {
    const task = tasks.activeTaskId;
    if (
      sidePanel.open ||
      sidePanel.strip.length > 0 ||
      pageAgents !== undefined ||
      inboxView !== undefined ||
      task === undefined
    ) {
      sidePanel.onToggle();
      return;
    }
    const stack = latestClosedTabs();
    const at = stack.findLastIndex(
      (closed) =>
        closed.strip === CLOSED_TAB_STRIP.SIDE_PANEL && closed.task === task && drawsAgain(closed),
    );
    const closed = stack[at];
    if (closed !== undefined) {
      setClosedTabs(stack.toSpliced(at, 1));
      reopenHere(closed);
      return;
    }
    const closedKind = sidePanel.closedTabs.findLast((tab) => DRAWN_KINDS.includes(tab));
    if (closedKind === undefined) sidePanel.onToggle();
    else sidePanel.onChoose(closedKind);
  };

  const back = useCallback((): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leaveTask();
    return true;
  }, [leaveTask, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  const starting =
    startingTask !== undefined &&
    startingTask.navigation === navigations.current &&
    standIn === undefined &&
    historyFor === undefined
      ? startingTask
      : undefined;

  return useSteadyDoors({
    page,
    starting,
    shown,
    signedIn,
    me: fixture === undefined ? input.accountId : tasksFixture?.fixtureReader(input.run),
    tasks: sidebar,
    listed: {
      tasks: listedSidebar,
      inbox: listedInbox.inbox,
      inboxTasks: listedInbox.inboxTasks,
    },
    listedAgents,
    pendingTasks,
    workspaces: viewed.workspaces,
    workspacesFailed: viewed.workspacesStatus === TASKS_READ.FAILED,
    onRetryWorkspaces: () => refreshTasks(),
    workspace: listedWorkspace,
    onChooseWorkspace: guard(switchWorkspace),
    newWorkspace: {
      open: signedIn && founding !== undefined && founding.accountId === input.accountId,
      onOpen: guard(() => setFounding({ accountId: input.accountId })),
      onClose: () => setFounding(undefined),
    },
    onOpenWorkspaceSettings: () =>
      input.onOpenSettings({
        page: SETTINGS_VIEW.WORKSPACE,
        ...(listedWorkspace === undefined ? undefined : { workspaceId: listedWorkspace.id }),
      }),
    onLeftWorkspace: (workspaceId) => {
      const others = viewed.workspaces.filter((each) => each.id !== workspaceId);
      const next = others.find((each) => each.personal === true) ?? others[0];
      navigations.current += 1;
      if (next !== undefined) chooseListed(next.id);
      if (boundFor === undefined) setStandIn(undefined);
      else leaveTask();
    },
    github: viewed.github,
    onConnectAccountGitHub: () => accountGitHub(ACT_KIND.GITHUB_CONNECT),
    onDisconnectAccountGitHub: () => accountGitHub(ACT_KIND.GITHUB_DISCONNECT),
    activeTaskId: tasks.activeTaskId,
    boundFor,
    listFailed: tasks.listStatus === TASKS_READ.FAILED,
    listRead: tasks.listStatus === TASKS_READ.READY,
    region,
    copy: { onPress: pressCopy },
    descriptionEdit,
    mainTabs: { ...mainTabs, onClose: closeColumnTab },
    sidePanel: { ...sidePanel, onClose: closeSidePanelTab, onToggle: toggleSidePanel },
    unreadTabs,
    pages: taskPages,
    agents,
    history: {
      ...history,
      open: historyOpen,
      onOpen: (taskId, save) => openHistory({ taskId, save, spot: undefined }),
      onReturn: (taskId, spot) => openHistory({ taskId, save: undefined, spot }),
      onClose: () => setHistoryFor(undefined),
    },
    onSelect: guard(selectListed),
    onResume: guard(resumeListed),
    onRestoreTask: guard((taskId: string) => {
      setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
      select(taskId);
    }),
    onShowAgent: guard((taskId: string, agentId: string) =>
      openOnTask(taskId, { kind: LINK_PLACE.AGENT, planId: taskId, agentId }),
    ),
    onShowColumnTab: guard(showColumnTab),
    onShowPanelTab: guard(showPanelTab),
    inbox: input.inboxWaiting,
    inboxShown: shownInbox,
    inboxTasks: input.inboxTasks,
    inboxTaskless: input.inboxTaskless,
    inboxAgents: input.inboxAgents,
    failedRuns: input.failedRuns,
    inboxView: {
      open: inboxView !== undefined,
      chosen: inboxChosen,
      onOpen: guard(() => {
        timeInboxOpen();
        setHistoryFor(undefined);
        leaveInboxTask();
        setStandIn({ kind: STAND_IN.INBOX, chosen: undefined });
      }),
      onClose: guard(() => setStandIn(undefined)),
      onChoose: (chosen) =>
        setStandIn((held) => (held?.kind === STAND_IN.INBOX ? { ...held, chosen } : held)),
      onOpenItem: guard((chosen: InboxChoice) => {
        setHistoryFor(undefined);
        openTaskThread("taskId" in chosen ? chosen.taskId : undefined);
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX ? { ...held, chosen } : { kind: STAND_IN.INBOX, chosen },
        );
      }),
      onClear: () =>
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX ? { ...held, chosen: undefined } : held,
        ),
      single: inboxView !== undefined && inboxSingle,
      onSingle: setInboxSingle,
      pages: inboxPages,
      onTaskAgents: inboxTaskAgents.onRead,
    },
    agentView: {
      agentId: agentView?.agentId,
      pages: agentPages,
      onOpen: guard((agentId: string) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.AGENT, agentId });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    personView: {
      userId: input.personView.userId,
      name: input.personView.name,
      workspaceId: personWorkspace,
      onOpen: guard((userId: string, name?: string, workspaceId?: string) => {
        openPerson(
          userId,
          name,
          workspaceId === undefined
            ? undefined
            : viewed.workspaces.find((each) => each.id === workspaceId),
        );
      }),
      onClose: guard(input.personView.onClose),
      onPreload: (userId: string, workspaceId?: string) => {
        const home = viewed.workspaces.find((each) => each.id === workspaceId) ?? listedWorkspace;
        if (home !== undefined) input.personView.onPreload(userId, stepOf(home));
      },
    },
    adminView: { ...input.adminView, onOpen: guard(input.adminView.onOpen) },
    automationsView: {
      open: input.automationsView.open,
      place: input.automationsView.place,
      runs: input.automationsView.runs,
      onOpen: guard((place: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST }) =>
        openAutomations(place),
      ),
      onRuns: input.automationsView.onRuns,
      onClose: guard(input.automationsView.onClose),
    },
    boardView: {
      open: input.boardView.open,
      onOpen: guard(() => openBoard(listedWorkspace)),
      onClose: guard(input.boardView.onClose),
      onPreload: () => {
        if (listedWorkspace !== undefined) input.boardView.onPreload(stepOf(listedWorkspace));
      },
    },
    unknownWorkspace: {
      open: standIn?.kind === STAND_IN.UNKNOWN_WORKSPACE,
      onClose: guard(() => setStandIn(undefined)),
    },
    onShowFile: showFile,
    onShowSource: guard(showSource),
    onShowTask: guard(showTaskAgents),
    onShowMention: guard(showMention),
    onOpenLink: guard((link: ReadLink) => openLink(link)),
    messageReveal,
    onMessageRevealed: (ask) => setMessageReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealMessage: revealMessage,
    threadReveal,
    onThreadRevealed: (ask) => setThreadReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealThread: revealThread,
    sectionReveal,
    commentReveal,
    onCommentRevealed: (ask) => setCommentReveal((last) => (last?.ask === ask ? undefined : last)),
    onSectionRevealed: (ask) =>
      setSectionReveal((last) => (last?.reveal.ask === ask ? undefined : last)),
    onShowInbox: guard(
      ({ taskId, itemId }: { readonly taskId: string; readonly itemId?: string }) => {
        timeInboxOpen();
        setHistoryFor(undefined);
        chooseInboxTask(taskId);
        const chosen = itemId === undefined ? undefined : { taskId, itemId, opened: true as const };
        setStandIn({ kind: STAND_IN.INBOX, chosen });
      },
    ),
    onOpenPinnedTab: guard((pin: SidebarPin) => {
      const { tab } = pin;
      setChosen({ pin, over: openTaskId });
      setHistoryFor(undefined);
      if ("agent" in pin) {
        setStandIn({ kind: STAND_IN.AGENT, agentId: pin.agent });
        sidePanel.onShow(pin.agent, pin.tab);
        return;
      }
      if (pin.task !== tasks.activeTaskId) select(pin.task);
      setStandIn(undefined);
      if (!isAgentTab(tab)) {
        sidePanel.onShow(pin.task, tab);
        return;
      }
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(pin.task, tab);
    }),
    chosenPin: chosenPinOf(chosen, boundFor, agentView?.agentId),
    onReopenClosedTab: reopenable.length === 0 ? undefined : reopenClosedTab,
    repositories,
    repositoryMenu,
    relationMenu,
    onAddRelation: addRelation,
    onChangeRepository: changeRepository,
    onSetRepository: setRepository,
    onSetTaskStanding: setTaskStanding,
    onSetTaskBlock: (taskId, block) => setTaskBlock(taskId, block),
    onRemoveTaskBlock: removeTaskBlock,
    onSetTaskParent: (taskId, parentTaskId) => setTaskParent(taskId, parentTaskId),
    onRemoveTaskParent: removeTaskParent,
    onChangeTaskRelation: changeTaskRelation,
    onMoveTask: moveTask,
    moveTask: moveTaskOptions,
    onOpenWorkspaceGitHub: (taskId) => {
      const workspaceId =
        tasks.tasks.find((task) => task.id === taskId)?.workspaceId ??
        (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
          ? region.task.workspaceId
          : undefined);
      input.onOpenSettings({
        page: SETTINGS_VIEW.WORKSPACE,
        section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
        ...(workspaceId === undefined ? undefined : { workspaceId }),
      });
    },
    onRetryList: () => refreshTasks(),
    onRetryDocument: retryDescription,
    onNewTask: newTask,
    onNewTaskIn: (repository) => newTaskWith({ repository }),
    onNewRelatedTask: (taskId, kind) => {
      const task =
        tasks.tasks.find((each) => each.id === taskId) ??
        (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
          ? region.task
          : undefined);
      if (task === undefined) return;
      newTaskWith({ relation: { kind, task } });
    },
    onQuickAdd: quickAdd,
    onNewAutomationAgent: () => newTaskWith({ purpose: NEW_TASK_PURPOSE.AUTOMATION }),
    newTask: {
      open: newTaskAsk !== undefined,
      preset: newTaskAsk?.preset,
      homeAsks: homeNewTasks,
      workspaces: viewed.workspaces,
      workspaceId: listedWorkspace?.id,
      repositoriesIn,
      start: steadyStartTask,
      models: agents.models,
      devices: agents.macs,
      modelsFailed: agents.modelsFailed,
      modelsRead: agents.modelsRead,
      readModels: agents.readModels,
      onClose: () => setNewTaskAsk(undefined),
      tasks: sidebar,
      onShowMention: guard(showMention),
    },
    onLeaveTask: guard(() => leaveTask()),
    onGoHome: guard(goHome),
    renameTask,
    onDraftName: draftName,
    onMarkTask: (taskId, mark) => markTask(taskId, mark),
    onSettleTasks: settleTasks,
    pinnedRepositories: (viewed.repositoryPins ?? NO_REPOSITORY_PINS).map((pin) => pin.repository),
    onPinRepository: pinRepository,
    taskSections,
    onWriteSections: writeSections,
    onPinAgent: pinAgent,
    taskAgentPins,
    liveAgents,
    listedPullRequests: tasks.agentPullRequests,
    onMovePins: movePins,
    onDeleteTask: deleteTask,
    deleteTask: deleteTaskOptions,
    deleteTasks: tasksDeleteMutation(sendDeleteTask),
    back,
    leaveGuard,
  });
}
