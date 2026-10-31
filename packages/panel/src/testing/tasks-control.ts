import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentTranscriptKey,
  type AgentTranscriptPage,
} from "@luke/features/agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type {
  AppInboxAgentHolding,
  AppInboxTasklessItem,
  AppInboxWaitingItem,
} from "@luke/host/app-state";
import { NO_TASK_SECTIONS } from "@luke/ui/task-sections-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { KEPT } from "../act.js";
import type { SummaryPin } from "../desktop/task-summary.js";
import type { TranscriptFollower } from "../tasks/use-agent-transcript.js";
import { type AgentsControl, MODELS_READ } from "../tasks/use-agents.js";
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
  page: AgentMessagesAnswerView | AgentTranscriptPage,
): AgentTranscriptPage {
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
    transcript: AgentTranscriptKey,
  ) => readonly (AgentMessagesAnswerView | AgentTranscriptPage)[],
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
  const waiting = {
    id: item.id,
    agentId: item.agentId,
    title: item.title,
    postedAt: item.postedAt,
  };
  return item.channelId === undefined ? waiting : { ...waiting, channelId: item.channelId };
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
export function agentsControl(overrides: Partial<AgentsControl> = {}): AgentsControl {
  return {
    me: undefined,
    agents: [],
    archived: [],
    agentIds: [],
    // A task with no archived agent holds exactly the agents given.
    heldIds: overrides.agentIds ?? [],
    keywords: [],
    readSkills: undefined,
    mode: undefined,
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
    modelsRead: { state: MODELS_READ.UNREAD, generation: 0 },
    macs: undefined,
    readModels: ignore,
    readDefault: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onUnarchive: undefined,
    continueAgent: undefined,
    start: {
      available: false,
      reason: undefined,
      busy: false,
      onPress: () => Promise.resolve(undefined),
    },
    onStop: () => Promise.resolve(false),
    onRewind: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onMessage: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onChoose: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onSwitchServers: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    onOpenIntegrations: ignore,
    onOpenApiKeys: ignore,
    archiving: false,
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
    readTranscript: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    transcripts: pushedTranscripts(() => []),
    readPullRequest: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    pullRequests: new Map(),
    numberedPullRequests: new Map(),
    readNumberedPullRequest: () => Promise.resolve(false),
    readChanges: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readChapters: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    generateChapters: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewPullRequest: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readReviewOptions: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewChecks: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readOverviewConversation: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readPullRequestViewed: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    changesPeople: new Map(),
    answerInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    messageInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    startInboxThread: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
  };
}

/**
 * Each agent the open items of agents with no task name, once, as main lists
 * the agents holding items: how many of them it holds, how many ask, and
 * when the latest changed, named as its latest item names it.
 */
export function agentHoldingsOf(
  taskless: readonly AppInboxTasklessItem[],
): readonly AppInboxAgentHolding[] {
  const held = new Map<string, AppInboxAgentHolding>();
  for (const entry of taskless) {
    const was = held.get(entry.agentId);
    const latest = was !== undefined && was.updatedAt > entry.updatedAt ? was : entry;
    held.set(entry.agentId, {
      agentId: entry.agentId,
      ...(latest.agentKind === undefined ? undefined : { agentKind: latest.agentKind }),
      agentTitle: latest.agentTitle,
      agentModel: latest.agentModel,
      automationId: latest.automationId,
      automationName: latest.automationName,
      repository: latest.repository,
      ...(latest.workspaceId === undefined ? undefined : { workspaceId: latest.workspaceId }),
      items: (was?.items ?? 0) + 1,
      toDo: (was?.toDo ?? 0) + (entry.asking === false ? 0 : 1),
      updatedAt: latest.updatedAt,
    });
  }
  return [...held.values()];
}

/**
 * A signed-in Tasks tab on screen with no task open and no tasks, every
 * press ignored, bound for whichever task it is given as open; the agents
 * holding items, where none are given, those its open items of agents with
 * no task name (`agentHoldingsOf`), as main lists both from one read.
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
      carried: [],
      onCarried: ignore,
      subagents: [],
      files: [],
      changes: [],
      pages: [],
      terminals: [],
      lastTerminal: undefined,
      pullRequestViews: new Map(),
      onPullRequestView: () => undefined,
      strip: SIDE_PANEL_TABS,
      tab: SIDE_PANEL_TAB.COMMENTS,
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
      onCloseOn: ignore,
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
      onResize: ignore,
      viewedAt: [],
      onViewedAt: ignore,
    },
    unreadTabs: [],
    pages: undefined,
    agents: agentsControl(),
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
    inboxItemReveal: undefined,
    onInboxItemRevealed: ignore,
    onSectionRevealed: ignore,
    onShowInbox: ignore,
    inbox: [],
    inboxShown: null,
    inboxTasks: [],
    inboxView: {
      open: false,
      chosen: undefined,
      onOpen: ignore,
      onClose: ignore,
      onChoose: ignore,
      onOpenItem: ignore,
      onOpenChannel: ignore,
      onClear: ignore,
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
      onOpen: ignore,
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
    onShowFile: ignore,
    onOpenPinnedTab: ignore,
    onReopenClosedTab: undefined,
    chosenPin: undefined,
    repositories: NO_REPOSITORIES,
    repositoryMenu: undefined,
    onChangeRepository: ignore,
    relationMenu: undefined,
    onAddRelation: ignore,
    onSetRepository: () => Promise.resolve(undefined),
    onSetTaskStanding: () => Promise.resolve(KEPT),
    onSetTaskBlock: () => undefined,
    onSetTaskParent: () => undefined,
    onRemoveTaskParent: () => undefined,
    onRemoveTaskBlock: () => undefined,
    onChangeTaskRelation: () => undefined,
    onRetryList: ignore,
    onRetryDocument: ignore,
    onNewTask: ignore,
    onNewTaskIn: ignore,
    onNewChildTask: ignore,
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
      devices: undefined,
      modelsFailed: false,
      modelsRead: { state: MODELS_READ.UNREAD, generation: 0 },
      readModels: ignore,
      readDefault: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
      onClose: ignore,
      tasks: [],
      onShowMention: ignore,
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
    taskAgentPins: [],
    liveAgents: [],
    listedPullRequests: undefined,
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
    inboxAgents: overrides.inboxAgents ?? agentHoldingsOf(overrides.inboxTaskless ?? []),
  };
}
