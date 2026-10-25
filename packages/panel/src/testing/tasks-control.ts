import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentTranscriptKey,
  type CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type { AppInboxWaitingItem } from "@luke/host/app-state";
import { FOR_YOU } from "@luke/ui/chat-model";
import { NO_TASK_SECTIONS } from "@luke/ui/task-sections-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import type { SummaryPin } from "../desktop/task-summary.js";
import type { TranscriptFollower } from "../tasks/use-agent-transcript.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import { SIDE_PANEL_TAB, SIDE_PANEL_TABS, SIDE_PANEL_WIDTH } from "../tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type TasksControl,
  type VersionHistoryControl,
} from "../tasks/use-tasks-tab.js";

const ignore = () => undefined;

/** An open item as main's read of the account carries it into what waits: its id, its agent, what it asks, and when it was posted. */
/** A page as the host pushes it: caught up where it came back with nothing on it, unless it says otherwise. */
export function pushedPage(
  page: CodingAgentMessagesAnswerView | CodingAgentTranscriptPage,
): CodingAgentTranscriptPage {
  if ("failure" in page || "caughtUp" in page) return page;
  return { ...page, caughtUp: page.messages.length === 0 };
}

/**
 * A follower that answers each follow as the host would: the pages `pagesOf`
 * names for the transcript, pushed to the window in turn, at once; or, where
 * `held` names one of them, that page and those after it once its release
 * lands.
 */
export function pushedTranscripts(
  pagesOf: (
    transcript: CodingAgentTranscriptKey,
  ) => readonly (CodingAgentMessagesAnswerView | CodingAgentTranscriptPage)[],
  held?: { readonly page: number; readonly release: Promise<void> },
): TranscriptFollower {
  return (transcript, hear) => {
    let stopped = false;
    const pages = pagesOf(transcript);
    const cut = held?.page ?? pages.length;
    for (const page of pages.slice(0, cut)) hear(pushedPage(page));
    void held?.release.then(() => {
      if (stopped) return;
      for (const page of pages.slice(cut)) hear(pushedPage(page));
    });
    return () => {
      stopped = true;
    };
  };
}

export function waitingOf(item: InboxItem): AppInboxWaitingItem {
  return { id: item.id, agentId: item.agentId, title: item.title, postedAt: item.postedAt };
}

/** The task's summary unpinned, its press ignored, so a page drawn over it draws the summary as its narrow rail of glyphs. */
export const UNPINNED_SUMMARY: SummaryPin = {
  pinned: false,
  onToggle: ignore,
  wide: true,
  onMeasured: ignore,
};

/** A task whose version history is shut, its history still being read, no version chosen, every press ignored. */
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
    listed: true,
    onList: ignore,
    onStand: ignore,
    onRetry: ignore,
    onRetryVersion: ignore,
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

/** A task with no agents and no repository, every press ignored. */
export function codingAgentsControl(
  overrides: Partial<CodingAgentsControl> = {},
): CodingAgentsControl {
  return {
    me: undefined,
    chatOn: true,
    agents: [],
    archived: [],
    agentIds: [],
    // A task with no archived agent holds exactly the agents given.
    heldIds: overrides.agentIds ?? [],
    keywords: [],
    readSkills: undefined,
    draft: undefined,
    onNewDraft: () => "draft",
    onForkDraft: () => "draft",
    onContinueDraft: () => "draft",
    onDropFork: ignore,
    onDraftChange: ignore,
    onHandDraft: ignore,
    onTaskStarted: ignore,
    opening: undefined,
    onDraftAttachments: ignore,
    onDiscardDraft: ignore,
    startPrompt: () => Promise.resolve(undefined),
    startFork: () => Promise.resolve(undefined),
    listFailed: false,
    listMissing: false,
    onRetryList: ignore,
    models: undefined,
    modelsFailed: false,
    readModels: ignore,
    readDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onUnarchive: undefined,
    continueAgent: undefined,
    start: {
      available: false,
      reason: undefined,
      busy: false,
      note: undefined,
      succeeded: false,
      onPress: ignore,
    },
    startCall: undefined,
    onStop: () => Promise.resolve(),
    onRewind: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onMessage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onChoose: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onSwitchServers: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    onOpenIntegrations: ignore,
    onOpenApiKeys: ignore,
    pending: { titles: new Map(), archives: new Map() },
    onRename: () => Promise.resolve(false),
    onArchive: () => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }),
    onDelete: () => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }),
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
    readCalls: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    transcripts: pushedTranscripts(() => []),
    readPullRequest: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    pullRequests: new Map(),
    numberedPullRequests: new Map(),
    readNumberedPullRequest: () => Promise.resolve(false),
    readChanges: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readChapters: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    generateChapters: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewPullRequest: () =>
      Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readReviewOptions: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewChecks: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewConversation: () =>
      Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readPullRequestViewed: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    changesPeople: new Map(),
    inboxFollower: { follow: () => () => undefined },
    answerInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    messageInbox: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    startInboxThread: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
  };
}

/**
 * A signed-in Tasks tab on screen with no task open and no tasks, every
 * press ignored, bound for whichever task it is given as open.
 */
export function tasksControl(overrides: Partial<TasksControl> = {}): TasksControl {
  return {
    page: TASKS_PAGE.HOME,
    restoring: false,
    starting: undefined,
    resting: false,
    shown: true,
    signedIn: true,
    me: undefined,
    tasks: [],
    listed: {
      tasks: overrides.tasks ?? [],
      inbox: overrides.inbox ?? [],
      inboxTasks: overrides.inboxTasks ?? [],
    },
    listedAgents: { standing: [], archived: [] },
    workspaces: [],
    workspacesFailed: false,
    onRetryWorkspaces: ignore,
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
    calls: undefined,
    live: false,
    mainTabs: {
      tabs: [],
      tab: undefined,
      openAgents: undefined,
      newTabAsked: false,
      onChoose: ignore,
      onShow: ignore,
      onClose: ignore,
      onMove: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      viewedAt: [],
      onViewedAt: ignore,
      onDoze: ignore,
      onWake: ignore,
    },
    sidePanel: {
      open: false,
      fullScreen: false,
      fullScreenOnly: false,
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
      pullRequestViews: new Map(),
      onPullRequestView: () => undefined,
      strip: SIDE_PANEL_TABS,
      tab: SIDE_PANEL_TAB.BOARD,
      preview: undefined,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      onToggle: ignore,
      onSetOpen: ignore,
      onToggleFullScreen: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      onInboxRead: ignore,
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
      onPreview: ignore,
      onPreviewFile: ignore,
      onKeep: ignore,
      onBrowseFile: ignore,
      onFileHistory: ignore,
      onFoldNote: ignore,
      onResize: ignore,
      viewedAt: [],
      onViewedAt: ignore,
    },
    unreadTabs: [],
    board: undefined,
    shownCode: undefined,
    agentCallCode: undefined,
    codeFailed: false,
    onRetryCode: ignore,
    pages: undefined,
    agents: codingAgentsControl(),
    history: versionHistoryControl(),
    onSelect: ignore,
    onRestoreTask: ignore,
    onShowAgent: ignore,
    onShowColumnTab: ignore,
    onShowPanelTab: ignore,
    onShowSource: ignore,
    onShowTask: ignore,
    onShowMention: ignore,
    onOpenLink: ignore,
    messageReveal: undefined,
    onMessageRevealed: ignore,
    threadReveal: undefined,
    onThreadRevealed: ignore,
    sectionReveal: undefined,
    commentReveal: undefined,
    onSectionRevealed: ignore,
    onShowInbox: ignore,
    onShowChat: ignore,
    inbox: [],
    inboxShown: null,
    chatShown: null,
    inboxTasks: [],
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: ignore,
      onOpenList: ignore,
      onClose: ignore,
      onChoose: ignore,
      onOpenItem: ignore,
      listed: false,
      onListed: ignore,
      pages: undefined,
      onTaskAgents: () => undefined,
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
    adminView: {
      open: false,
      view: { kind: "dashboard" },
      listed: false,
      onOpen: ignore,
      onList: ignore,
      onClose: ignore,
    },
    boardView: { open: false, onOpen: ignore, onClose: ignore },
    automationsView: {
      open: false,
      place: { kind: AUTOMATIONS_PAGE.LIST },
      runs: false,
      onOpen: ignore,
      onRuns: ignore,
      onClose: ignore,
    },
    chatView: {
      open: false,
      available: false,
      chat: undefined,
      failed: false,
      onRetry: ignore,
      place: FOR_YOU,
      listed: true,
      onList: ignore,
      onOpen: ignore,
      onClose: ignore,
      onChoose: ignore,
      onShow: ignore,
      onShowMessage: ignore,
      onPost: () => Promise.resolve(undefined),
      onAnswer: () => Promise.resolve(undefined),
      onChannel: () => Promise.resolve(undefined),
      onRead: ignore,
      readPicture: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }),
    },
    onShowFile: ignore,
    onOpenPinnedTab: ignore,
    onReopenClosedTab: undefined,
    chosenPin: undefined,
    repositories: NO_REPOSITORIES,
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    onSetRepository: () => Promise.resolve(undefined),
    onSetTaskStanding: () => Promise.resolve(true),
    onOpenOnGitHub: ignore,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewTask: ignore,
    onNewTaskIn: ignore,
    onQuickAdd: () => Promise.resolve(undefined),
    onNewAutomationAgent: ignore,
    newTask: {
      open: false,
      preset: undefined,
      workspaces: [],
      workspaceId: undefined,
      repositoriesIn: () => NO_REPOSITORIES,
      start: () => Promise.resolve(undefined),
      models: undefined,
      modelsFailed: false,
      readModels: ignore,
      readDefault: () => Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
      onClose: ignore,
      tasks: [],
      onShowMention: ignore,
      linearIssuesIn: () => undefined,
      githubIssuesIn: () => undefined,
    },
    onLeaveTask: ignore,
    onRenameTask: () => Promise.resolve(true),
    onDraftName: ignore,
    onMarkTask: ignore,
    onSettleTasks: ignore,
    pinnedRepositories: [],
    onPinRepository: ignore,
    taskSections: NO_TASK_SECTIONS,
    onWriteSections: ignore,
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
