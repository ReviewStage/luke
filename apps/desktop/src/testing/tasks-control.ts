import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type { AppInboxWaitingItem } from "@luke/host/app-state";
import { CONFIRM_STAGE } from "@luke/ui/confirm-state";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION } from "@luke/voice/transcript-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import type { SummaryPin } from "../renderer/desktop/task-summary";
import type { CodingAgentsControl } from "../renderer/tasks/use-coding-agents";
import { MAIN_TAB } from "../renderer/tasks/use-main-tabs";
import { HISTORY_READ } from "../renderer/tasks/use-plan-history";
import {
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  SIDE_PANEL_WIDTH,
} from "../renderer/tasks/use-side-panel";
import {
  AUTOMATIONS_PAGE,
  type TasksControl,
  type VersionHistoryControl,
} from "../renderer/tasks/use-tasks-tab";

const ignore = () => undefined;

/** An open item as main's read of the account carries it into what waits: its id, its agent, what it asks, and when it was posted. */
export function waitingOf(item: InboxItem): AppInboxWaitingItem {
  return { id: item.id, agentId: item.agentId, title: item.title, postedAt: item.postedAt };
}

/** The plan's summary unpinned, its press ignored, so a page drawn over it draws the summary as its narrow rail of glyphs. */
export const UNPINNED_SUMMARY: SummaryPin = {
  pinned: false,
  onToggle: ignore,
  wide: true,
  onMeasured: ignore,
};

/** A plan whose version history is shut, its history still being read, no version chosen, every press ignored. */
function versionHistoryControl(
  overrides: Partial<VersionHistoryControl> = {},
): VersionHistoryControl {
  return {
    open: false,
    onOpen: ignore,
    onReturn: ignore,
    onClose: ignore,
    list: { kind: HISTORY_READ.READING },
    selected: undefined,
    viewing: undefined,
    onSelect: ignore,
    spot: undefined,
    onOpenSections: ignore,
    onChooseSection: ignore,
    onCloseSections: ignore,
    onRetry: ignore,
    onLoadEarlier: () => Promise.resolve(false),
    onRestore: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    ...overrides,
  };
}

/** A repository chip's list read from nowhere, which answers that the service did not. */
const NO_REPOSITORIES = {
  recent: [],
  read: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
  openGitHub: ignore,
  pictures: true,
  manages: true,
} as const satisfies TasksControl["repositories"];

/** A plan with no agents and no repository, every press ignored. */
export function codingAgentsControl(
  overrides: Partial<CodingAgentsControl> = {},
): CodingAgentsControl {
  return {
    me: undefined,
    agents: [],
    archived: [],
    agentIds: [],
    // A plan with no archived agent holds exactly the agents given.
    heldIds: overrides.agentIds ?? [],
    keywords: [],
    readSkills: undefined,
    draft: undefined,
    onNewDraft: () => "draft",
    onDraftChange: ignore,
    onDraftAttachments: ignore,
    onDiscardDraft: ignore,
    startPrompt: () => Promise.resolve(undefined),
    listFailed: false,
    listMissing: false,
    onRetryList: ignore,
    models: undefined,
    readModels: ignore,
    readDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    writeDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onUnarchive: undefined,
    start: { available: false, reason: undefined, busy: false, note: undefined, onPress: ignore },
    onStop: () => Promise.resolve(),
    onMessage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onChoose: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onSwitchServers: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onOpenIntegrations: ignore,
    onOpenApiKeys: ignore,
    onRename: () => Promise.resolve(false),
    onArchive: () => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }),
    // An agent read again stands as the control's list has it.
    readAgent: (agentId) =>
      Promise.resolve(
        [...(overrides.agents ?? []), ...(overrides.archived ?? [])].find(
          (agent) => agent.id === agentId,
        ),
      ),
    onStatus: ignore,
    onTitle: ignore,
    readTranscript: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readPullRequest: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    pullRequests: new Map(),
    readChanges: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    changesPeople: new Map(),
    readInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    answerInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
  };
}

/**
 * A signed-in Plans tab on screen on its home page with no plans, every
 * press ignored, bound for whichever plan it is given as open.
 */
export function tasksControl(overrides: Partial<TasksControl> = {}): TasksControl {
  return {
    page: TASKS_PAGE.HOME,
    restoring: false,
    shown: true,
    signedIn: true,
    me: undefined,
    tasks: [],
    archived: [],
    listed: {
      tasks: overrides.tasks ?? [],
      archived: overrides.archived ?? [],
      inbox: overrides.inbox ?? [],
      inboxTasks: overrides.inboxTasks ?? [],
    },
    listedAgents: { standing: [], archived: [] },
    workspaces: [],
    workspace: undefined,
    onChooseWorkspace: ignore,
    onLeftWorkspace: ignore,
    onCreateWorkspace: () => Promise.resolve(undefined),
    onOpenWorkspaceSettings: ignore,
    onOpenWorkspaceGitHub: ignore,
    onMoveTask: () => Promise.resolve(false),
    github: undefined,
    onConnectAccountGitHub: () => Promise.resolve(false),
    onDisconnectAccountGitHub: () => Promise.resolve(false),
    activeTaskId: undefined,
    boundFor: overrides.activeTaskId,
    listFailed: false,
    listRead: true,
    region: { kind: DOCUMENT_REGION.NONE },
    copy: { onPress: ignore },
    edit: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
    microphone: { label: "Talk about this task", enabled: true, muted: false, onPress: ignore },
    speaker: { muted: false, onPress: ignore },
    stop: { shown: false, onPress: ignore },
    status: undefined,
    live: false,
    mainTabs: {
      tabs: [MAIN_TAB.PLAN],
      tab: MAIN_TAB.PLAN,
      openAgents: undefined,
      newTabAsked: false,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onInboxRead: ignore,
      onMove: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
    },
    sidePanel: {
      open: false,
      fullScreen: false,
      newTabAsked: false,
      tabs: SIDE_PANEL_TABS,
      order: [],
      closedTabs: [],
      used: SIDE_PANEL_TABS,
      pins: [],
      subagents: [],
      files: [],
      changes: [],
      pages: [],
      terminals: [],
      lastTerminal: undefined,
      strip: SIDE_PANEL_TABS,
      tab: SIDE_PANEL_TAB.BOARD,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      onToggle: ignore,
      onToggleFullScreen: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onMove: ignore,
      onReopen: ignore,
      onPin: ignore,
      onUnpin: ignore,
      onRenamePins: ignore,
      onPlacePins: ignore,
      onOpenFile: ignore,
      onBrowseFile: ignore,
      onFileHistory: ignore,
      onFoldNote: ignore,
      onResize: ignore,
    },
    unreadTabs: [],
    board: undefined,
    shownCode: undefined,
    pages: undefined,
    transcript: { region: { kind: TRANSCRIPT_REGION.READING }, onRetry: ignore },
    work: {
      conversation: undefined,
      callLive: false,
      onLoadEarlier: () => Promise.resolve(),
      readWorker: () => Promise.reject(new Error("No planning worker is read in this test.")),
    },
    agents: codingAgentsControl(),
    history: versionHistoryControl(),
    onSelect: ignore,
    onShowAgent: ignore,
    onShowSource: ignore,
    onShowTask: ignore,
    onShowMention: ignore,
    onOpenLink: ignore,
    messageReveal: undefined,
    onMessageRevealed: ignore,
    sectionReveal: undefined,
    onSectionRevealed: ignore,
    onShowInbox: ignore,
    secondCall: {
      confirm: {
        stage: CONFIRM_STAGE.RESTING,
        rejection: undefined,
        busy: false,
        ask: ignore,
        keep: ignore,
        clear: ignore,
        run: ignore,
        standing: false,
      },
      question: { title: "", body: "", verb: "", running: "" },
    },
    inbox: [],
    inboxShown: null,
    inboxTasks: [],
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: ignore,
      onClose: ignore,
      onChoose: ignore,
    },
    agentView: { agentId: undefined, onOpen: ignore, onClose: ignore },
    personView: {
      userId: undefined,
      name: undefined,
      workspaceId: undefined,
      onOpen: ignore,
      onClose: ignore,
    },
    inboxTaskless: [],
    failedRuns: [],
    factoryView: { open: false, onOpen: ignore, onClose: ignore },
    automationsView: {
      open: false,
      place: { kind: AUTOMATIONS_PAGE.LIST },
      onOpen: ignore,
      onClose: ignore,
    },
    callTaskId: undefined,
    onShowFile: ignore,
    onOpenPinnedTab: ignore,
    onReopenClosedTab: undefined,
    chosenPin: undefined,
    repositories: NO_REPOSITORIES,
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    onSetRepository: () => Promise.resolve(undefined),
    onOpenOnGitHub: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewTask: ignore,
    onNewTaskIn: ignore,
    newTask: {
      open: false,
      preset: undefined,
      workspaces: [],
      workspaceId: undefined,
      repositoriesIn: () => NO_REPOSITORIES,
      start: () => Promise.resolve(undefined),
      onClose: ignore,
      linearIssuesIn: () => undefined,
    },
    onLeaveTask: ignore,
    onGoHome: ignore,
    onRenameTask: () => Promise.resolve(true),
    onDraftName: ignore,
    onMarkTask: ignore,
    onArchiveTasks: ignore,
    pinnedRepositories: [],
    onPinRepository: ignore,
    onPinAgent: ignore,
    onMovePins: ignore,
    onDeleteTask: () => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    back: () => false,
    // No page asks before it is left, so every way out goes at once.
    leaveGuard: {
      stand: () => ignore,
      pass: (leave) => leave(),
      guard: (leave) => leave,
    },
    ...overrides,
  };
}
