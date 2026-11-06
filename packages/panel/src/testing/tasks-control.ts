import {
  AGENT_CALL_FAILURE,
  type AgentMessagesAnswerView,
  type AgentTranscriptKey,
  type AgentTranscriptPage,
} from "@repo/features/agent-view";
import {
  type AgentOlderAnswer,
  type AgentSummary,
  applyMessagesPage,
  type ListedAgent,
} from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import { TASK_CALL_FAILURE } from "@repo/features/tasks-view";
import type {
  AppHostRead,
  AppInboxAgentHolding,
  AppInboxTasklessItem,
  AppInboxWaitingItem,
  AppTranscript,
} from "@repo/host/app-state";
import { NO_TASK_SECTIONS } from "@repo/ui/task-sections-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@repo/ui/tasks-model";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { KEPT } from "../act.js";
import type { AutomationsRoute } from "../automations-route.js";
import type { SummaryPin } from "../desktop/task-summary.js";
import { descriptionEditMutation } from "../tasks/description-edit-mutation.js";
import {
  AGENT_RENAME_SHAPE,
  type AgentsControl,
  agentArchiveMutation,
  agentDeleteMutation,
  agentRenameMutation,
  MODELS_READ,
} from "../tasks/use-agents.js";
import { HISTORY_READ } from "../tasks/use-description-history.js";
import { MAIN_TAB } from "../tasks/use-main-tabs.js";
import { DRAWN_KINDS, SIDE_PANEL_WIDTH } from "../tasks/use-side-panel.js";
import {
  type AdminViewControl,
  AUTOMATIONS_PAGE,
  type TasksControl,
  taskDeleteMutation,
  taskMoveMutation,
  taskRenameMutation,
  tasksDeleteMutation,
  type VersionHistoryControl,
} from "../tasks/use-tasks-tab.js";
import type { BoardRoute, PersonRoute } from "../workspace-routes.js";
import { handHostReads, holdTranscripts, type TranscriptsHeld } from "./app-state.js";

const ignore = () => undefined;

const LISTED_WORKSPACE_ID = "workspace-listed";

export function listedAgent(
  agent: AgentSummary,
  place: Partial<Pick<ListedAgent, "workspaceId" | "repository">> = {},
): ListedAgent {
  return {
    ...agent,
    workspaceId: place.workspaceId ?? LISTED_WORKSPACE_ID,
    repository: place.repository ?? null,
  };
}

export function pushedPage(
  page: AgentMessagesAnswerView | AgentTranscriptPage,
): AgentTranscriptPage {
  if ("failure" in page || "caughtUp" in page) return page;
  return { ...page, caughtUp: page.messages.length === 0 };
}

export type ToldPage = AgentMessagesAnswerView | AgentTranscriptPage;

export function transcriptTold(pages: readonly ToldPage[]): AppHostRead<AppTranscript> {
  let held: AppTranscript = { messages: [], pages: 0 };
  for (const page of pages.map(pushedPage)) {
    if ("failure" in page) {
      held =
        page.failure === AGENT_CALL_FAILURE.NOT_FOUND
          ? { messages: [], pages: held.pages, failure: page }
          : { ...held, failure: page };
      continue;
    }
    const { messages, cursor, before, newest, ...word } = page;
    const ids = new Set(messages.map((message) => message.id));
    const meets = before === undefined || held.messages.some((message) => ids.has(message.id));
    const replaces =
      newest === true &&
      (held.messages.length === 0 || !meets || word.rewound !== held.word?.rewound);
    const { failure: _failure, before: heldBefore, ...standing } = held;
    const below =
      replaces || (newest === true && before === undefined) ? before : (heldBefore ?? before);
    held = {
      ...standing,
      messages: replaces ? messages : applyMessagesPage(held.messages, messages),
      ...(below === undefined ? undefined : { before: below }),
      cursor,
      word,
      pages: held.pages + 1,
    };
  }
  return { rows: held };
}

export function pushedTranscripts(
  pagesOf: (transcript: AgentTranscriptKey) => readonly ToldPage[],
  held?: { readonly page: number; readonly release: Promise<void> },
): TranscriptsHeld {
  let released = held === undefined;
  void held?.release.then(() => {
    released = true;
  });
  const told: TranscriptsHeld = holdTranscripts(
    handHostReads({}).deliverTranscripts,
    (transcript) => {
      const pages = pagesOf(transcript);
      if (!released) {
        void held?.release.then(() => {
          if (heldNow(told, transcript)) told.lay(transcript, transcriptTold(pages));
        });
      }
      const laid = released ? pages : pages.slice(0, held?.page ?? pages.length);
      return laid.length === 0 ? undefined : transcriptTold(laid);
    },
  );
  return told;
}

function heldNow(held: TranscriptsHeld, transcript: AgentTranscriptKey): boolean {
  const same = (other: AgentTranscriptKey) =>
    other.agentId === transcript.agentId && other.callId === transcript.callId;
  return held.asked.filter(same).length > held.closed.filter(same).length;
}

export interface TranscriptsTelling {
  readonly tell: (transcript: AgentTranscriptKey, page: ToldPage) => void;
  readonly layOlder: (transcript: AgentTranscriptKey, older: AgentOlderAnswer) => void;
  readonly asked: readonly AgentTranscriptKey[];
  readonly closed: readonly AgentTranscriptKey[];
}

interface Told {
  readonly pages: readonly ToldPage[];
  readonly older: readonly AgentOlderAnswer[];
}

function heldOf({ pages, older }: Told): AppHostRead<AppTranscript> {
  const { rows = { messages: [], pages: 0 } } = transcriptTold(pages);
  return {
    rows: older.reduce<AppTranscript>((held, page) => {
      const ids = new Set(held.messages.map((message) => message.id));
      const { before: _laid, ...rest } = held;
      return {
        ...rest,
        messages: [...page.messages.filter((message) => !ids.has(message.id)), ...held.messages],
        ...(page.before === undefined ? undefined : { before: page.before }),
      };
    }, rows),
  };
}

export function tellingTranscripts(): TranscriptsTelling {
  const told = new Map<string, Map<string | undefined, Told>>();
  const toldOf = (transcript: AgentTranscriptKey) =>
    told.get(transcript.agentId)?.get(transcript.callId);
  const held = holdTranscripts(handHostReads({}).deliverTranscripts, (transcript) => {
    const was = toldOf(transcript);
    return was === undefined ? undefined : heldOf(was);
  });
  const tellOn = (transcript: AgentTranscriptKey, more: (was: Told) => Told) => {
    const ofAgent = told.get(transcript.agentId) ?? new Map<string | undefined, Told>();
    const next = more(ofAgent.get(transcript.callId) ?? { pages: [], older: [] });
    told.set(transcript.agentId, ofAgent.set(transcript.callId, next));
    if (heldNow(held, transcript)) held.lay(transcript, heldOf(next));
  };
  return {
    asked: held.asked,
    closed: held.closed,
    tell: (transcript, page) =>
      tellOn(transcript, (was) => ({ ...was, pages: [...was.pages, page] })),
    layOlder: (transcript, older) =>
      tellOn(transcript, (was) => ({ ...was, older: [...was.older, older] })),
  };
}

export function waitingOf(item: InboxItem): AppInboxWaitingItem {
  return { id: item.id, agentId: item.agentId, title: item.title, postedAt: item.postedAt };
}

export const UNPINNED_SUMMARY: SummaryPin = {
  pinned: false,
  onToggle: ignore,
  wide: true,
  onMeasured: ignore,
};

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

const NO_REPOSITORIES = {
  recent: [],
  openGitHub: ignore,
  pictures: true,
  manages: true,
} as const satisfies TasksControl["repositories"];

export function agentsControl(overrides: Partial<AgentsControl> = {}): AgentsControl {
  const onArchive: AgentsControl["onArchive"] =
    overrides.onArchive ??
    (() => Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Ignored." }));
  return {
    me: undefined,
    agents: [],
    archived: [],
    agentIds: [],
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
    onUnarchive: undefined,
    continueAgent: undefined,
    start: {
      available: false,
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
    rename: {
      ...AGENT_RENAME_SHAPE,
      options: agentRenameMutation(() =>
        Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED, cause: undefined }),
      ),
    },
    onArchive,
    archiveAgent: agentArchiveMutation(({ agentId, archived, asked }) =>
      onArchive(agentId, archived, asked === undefined ? {} : { asked }),
    ),
    deleteAgent: agentDeleteMutation(() =>
      Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED, cause: undefined }),
    ),
    readAgent: (agentId) =>
      Promise.resolve(
        [...(overrides.agents ?? []), ...(overrides.archived ?? [])].find(
          (agent) => agent.id === agentId,
        ),
      ),
    readTranscript: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    pullRequests: new Map(),
    numberedPullRequests: new Map(),
    generateChapters: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    answerInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    messageInbox: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    startInboxThread: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    readInboxImage: () => Promise.resolve({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
    ...overrides,
  };
}

export function agentHoldingsOf(
  taskless: readonly AppInboxTasklessItem[],
): readonly AppInboxAgentHolding[] {
  const held = new Map<string, AppInboxAgentHolding>();
  for (const entry of taskless) {
    const was = held.get(entry.agentId);
    const latest = was !== undefined && was.updatedAt > entry.updatedAt ? was : entry;
    held.set(entry.agentId, {
      agentId: entry.agentId,
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

export const ADMIN_AWAY: AdminViewControl = {
  open: false,
  view: { kind: "dashboard" },
  onOpen: ignore,
  onClose: ignore,
  onPreload: ignore,
};

export const BOARD_AWAY: BoardRoute = {
  open: false,
  standingIn: undefined,
  onOpen: ignore,
  onClose: ignore,
  onTurn: ignore,
  onPreload: ignore,
};

export const AUTOMATIONS_AWAY: AutomationsRoute = {
  open: false,
  place: { kind: AUTOMATIONS_PAGE.LIST },
  runs: false,
  standingIn: undefined,
  deleted: new Set(),
  setupAddress: undefined,
  onOpen: ignore,
  onRuns: ignore,
  onClose: ignore,
  onTurn: ignore,
};

export const PERSON_AWAY: PersonRoute = {
  userId: undefined,
  name: undefined,
  workspace: undefined,
  onOpen: ignore,
  onClose: ignore,
  onPreload: ignore,
};

export function tasksControl(overrides: Partial<TasksControl> = {}): TasksControl {
  const onMoveTask: TasksControl["onMoveTask"] =
    overrides.onMoveTask ?? (() => Promise.resolve(false));
  const onDeleteTask: TasksControl["onDeleteTask"] =
    overrides.onDeleteTask ?? (() => Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }));
  return {
    page: TASKS_PAGE.HOME,
    starting: undefined,
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
    newWorkspace: { open: false, onOpen: ignore, onClose: ignore },
    onOpenWorkspaceSettings: ignore,
    onOpenWorkspaceGitHub: ignore,
    onMoveTask,
    moveTask: taskMoveMutation(({ taskId, workspaceId, quiet }) =>
      onMoveTask(taskId, workspaceId, { quiet }),
    ),
    github: undefined,
    onConnectAccountGitHub: () => Promise.resolve(false),
    onDisconnectAccountGitHub: () => Promise.resolve(false),
    activeTaskId: undefined,
    boundFor: overrides.activeTaskId,
    listFailed: false,
    listRead: true,
    region: { kind: DOCUMENT_REGION.NONE },
    copy: { onPress: ignore },
    descriptionEdit: (taskId) =>
      descriptionEditMutation(taskId, () =>
        Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
      ),
    mainTabs: {
      tabs: [MAIN_TAB.OVERVIEW],
      tab: MAIN_TAB.OVERVIEW,
      returnTab: undefined,
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
      toggleAsked: false,
      tabs: DRAWN_KINDS,
      order: [],
      closedTabs: [],
      used: DRAWN_KINDS,
      pins: [],
      carried: [],
      onCarried: ignore,
      subagents: [],
      files: [],
      changes: [],
      pages: [],
      terminals: [],
      locals: [],
      lastTerminal: undefined,
      pullRequestViews: new Map(),
      onPullRequestView: () => undefined,
      strip: DRAWN_KINDS,
      tab: undefined,
      preview: undefined,
      width: SIDE_PANEL_WIDTH.DEFAULT,
      opened: 0,
      onToggle: ignore,
      onSetOpen: ignore,
      onToggleFullScreen: ignore,
      onNewTab: ignore,
      onNewTabAnswered: ignore,
      onToggleAskedAnswered: () => undefined,
      onChoose: ignore,
      onShow: ignore,
      onCarry: ignore,
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
    onResume: ignore,
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
    onRevealMessage: ignore,
    threadReveal: undefined,
    onThreadRevealed: ignore,
    onRevealThread: ignore,
    sectionReveal: undefined,
    commentReveal: undefined,
    onCommentRevealed: ignore,
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
      onPreload: ignore,
    },
    inboxTaskless: [],
    failedRuns: [],
    adminView: ADMIN_AWAY,
    boardView: { open: false, onOpen: ignore, onClose: ignore, onPreload: ignore },
    unknownWorkspace: { open: false, onClose: ignore },
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
    onNewRelatedTask: ignore,
    onQuickAdd: () => Promise.resolve(undefined),
    onNewAutomationAgent: ignore,
    newTask: {
      open: false,
      preset: undefined,
      homeAsks: 0,
      workspaces: [],
      workspaceId: undefined,
      repositoriesIn: () => NO_REPOSITORIES,
      start: () => Promise.resolve(undefined),
      models: undefined,
      devices: undefined,
      modelsFailed: false,
      modelsRead: { state: MODELS_READ.UNREAD, generation: 0 },
      readModels: ignore,
      onClose: ignore,
      tasks: [],
      onShowMention: ignore,
    },
    onLeaveTask: ignore,
    onGoHome: ignore,
    renameTask: taskRenameMutation(() => Promise.resolve(true), undefined),
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
    onDeleteTask,
    deleteTask: taskDeleteMutation((taskId) => onDeleteTask(taskId)),
    deleteTasks: tasksDeleteMutation((taskId) => onDeleteTask(taskId)),
    back: () => false,
    leaveGuard: {
      stand: () => ignore,
      pass: (leave) => leave(),
      guard: (leave) => leave,
    },
    ...overrides,
    inboxAgents: overrides.inboxAgents ?? agentHoldingsOf(overrides.inboxTaskless ?? []),
  };
}
