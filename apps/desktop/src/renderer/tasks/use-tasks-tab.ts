import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import type { AutomationPresetName } from "@luke/features/automation-code-review";
import type { Board } from "@luke/features/board-wire";
import { CHANNEL_KIND } from "@luke/features/chat-wire";
import type { CodingAgentDefaultAnswer } from "@luke/features/coding-agent-view";
import type { CodingAgentAttachment, TasklessAgent } from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import type { GitHubConnection } from "@luke/features/github-connection-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import type { PageLine } from "@luke/features/page-wire";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { TaskSections, TaskSectionWrite } from "@luke/features/task-section-wire";
import { type CodeRef, type Task, UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import {
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksEditAnswer,
  type TasksView,
} from "@luke/features/tasks-view";
import { managesWorkspace } from "@luke/features/workspace-role";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, type ChatShown } from "@luke/host/acts";
import {
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppInboxTasklessItem,
  RUN_PROFILE,
} from "@luke/host/app-state";
import type { ActHandle } from "@luke/panel/act";
import { appPlatform } from "@luke/panel/app-platform";
import { useCopyToast } from "@luke/panel/copy-feedback";
import { useChatOn } from "@luke/panel/tasks/chat-gate";
import {
  CLOSED_TAB_STRIP,
  type ClosedTab,
  NO_CLOSED_TABS,
  withClosedTab,
  withUndrawnPassed,
} from "@luke/panel/tasks/closed-tabs";
import { useInboxPages } from "@luke/panel/tasks/use-inbox-pages";
import {
  MAIN_TAB,
  type MainTab,
  type MainTabsControl,
  useMainTabs,
} from "@luke/panel/tasks/use-main-tabs";
import { usePanelArrivals } from "@luke/panel/tasks/use-panel-arrivals";
import {
  drawsChanges,
  drawsMacTerminal,
  drawsSubagent,
  drawsTerminal,
  inColumn,
  type PinnedTab,
  SIDE_PANEL_TAB,
  type SidePanelControl,
  type SidePanelTab,
  type TaskHolds,
  useSidePanel,
} from "@luke/panel/tasks/use-side-panel";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "@luke/panel/toast";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { DIALOG_TONE, type DialogConfirm, type DialogQuestion, useConfirmDialog } from "@luke/ui";
import { callCard } from "@luke/ui/call-card-model";
import {
  CHAT_PLACE,
  type ChatAskAnswer,
  type ChatPlace,
  type ChatPost,
  FOR_YOU,
} from "@luke/ui/chat-model";
import {
  isAgentTab,
  isBrowserTab,
  isChangesTab,
  isDraftTab,
  isFileTab,
  isMacTerminalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  pullRequestLabelOf,
  type StripTab,
  sameTab,
} from "@luke/ui/tab-strip-model";
import {
  applySectionWrite,
  NO_TASK_SECTIONS,
  SECTION_WRITE_FAILED_NOTE,
} from "@luke/ui/task-sections-model";
import {
  AGENT_PIN_FAILED_NOTES,
  agentsPinned,
  archivedTasksNote,
  archiveTasksFailedNote,
  type CallStatus,
  callStatus,
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  type LinearIssuesAsk,
  MARK_FAILED_NOTES,
  MARK_UNDOS,
  MICROPHONE_PRESS,
  markedView,
  microphoneButton,
  type PendingAgentPins,
  type PendingMarks,
  type PendingPinPositions,
  type PendingRenames,
  type PendingRepositoryPin,
  type PendingRepositoryPins,
  PIN_MOVE_FAILED_NOTE,
  type PinMove,
  pendingMark,
  pinnedRepositories,
  positionedView,
  REPOSITORY_PIN_FAILED_NOTES,
  recentRepositories,
  renamedView,
  repositoryFailureNote,
  repositoryPageUrl,
  sidebarTasks,
  startFailureNote,
  TASK_MARK,
  TASKS_PAGE,
  type TaskMark,
  type TasksPage,
  tasksPage,
  unsettledAgentPins,
  unsettledMarks,
  unsettledPinPositions,
  unsettledRenames,
  unsettledRepositoryPins,
  workspaceReaches,
} from "@luke/ui/tasks-model";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import type { MicrophoneStatus } from "@luke/voice/audio";
import { shownFiles } from "@luke/voice/code-pane-model";
import {
  type HeardCall,
  heardCalls,
  TRANSCRIPT_REGION,
  type TranscriptRegion,
  transcriptRegion,
} from "@luke/voice/transcript-model";
import { callInProgress, VOICE_COMMAND, type VoiceView } from "@luke/voice/voice-view";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChosenWorkspace } from "../desktop/chosen-workspace";
import type { FixtureChat, Staged } from "./chat-fixture";
import { agentTabLabel } from "./coding-agent-model";
import type { MessageReveal } from "./message-links";
import type { SectionReveal } from "./plan-body";
import { REVISION_SOURCE, type RevisionSource } from "./plan-history-model";
import type { RepositoryChooser } from "./repository-chip";
import {
  FIXTURE_TASKS_CALL,
  fixtureRepositories,
  fixtureSidePanel,
  fixtureTasksView,
} from "./tasks-fixture";
import type { TranscriptReader } from "./use-agent-transcript";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";
import { useLastTask } from "./use-last-task";
import {
  type HistorySpot,
  type PlanHistoryControl,
  type PlanHistorySource,
  usePlanHistory,
} from "./use-plan-history";
import { useWorkspaceChat } from "./use-workspace-chat";
import { sayRestored } from "./version-view";
import { agentListCallIds, sidebarCallIds, workerCallIds, workRowsOf } from "./work-model";

/** A change to the sections drawn before the service answered it, and when it was asked. */
interface PendingSectionWrite {
  readonly write: TaskSectionWrite;
  readonly at: number;
}

/**
 * use-tasks-tab.ts -- the panel's Tasks tab as one control: which page shows, the presses each page makes, and the host's read of the tasks as the tab shows.
 *
 * The tab draws the tasks view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * task: the task's notetaker writes the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename, a pin, and an
 * archive are the presses drawn before the host answers them: each shows at
 * once, and goes back if the service refuses it, a pin or an archive with a
 * quiet note on the task's row. The open task archived leaves for the
 * home page once the service has kept the archive. The task the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another task, a task started, archiving it, a delete, or a
 * sign-out leaves it. With none open, the tab is the home page. The open task's
 * coding agents are the tab's too (`use-coding-agents.ts`): read when the
 * task opens, started from the toolbar or the column's "+", and each drawn
 * on a tab of the task's column beside the task's own (`use-main-tabs.ts`),
 * their workers' in the side panel. Main is told which agent's tab is shown, so the notification it
 * posts when an agent ends is held back while the developer is looking at
 * that agent, and the agents main says ended unseen read in semibold until their
 * tab is shown (`@luke/host/agent-notices`). The open plan's history is the
 * tab's as well (`use-plan-history.ts`): its version history, opened from
 * the task's menu or its "Edited by" line, or from a section's on the
 * revision that last changed the section, takes the whole window in the
 * task's place (`desktop-version-history.tsx`) until it is left or another
 * task opens, and a version restored through the service is answered with
 * the window's toast. The side panel stands as it was behind it.
 */

/** A call or a turn the open task's side panel is asked to bring into view, on the task it was asked of. */
interface SourceReveal {
  readonly taskId: string;
  readonly source: Exclude<RevisionSource, { kind: typeof REVISION_SOURCE.AGENT }>;
}

/** The item chosen in the window's Inbox, and the task it belongs to. */
/** The item chosen in the window's Inbox, by the task it stands on, or, for an agent with no task, by its agent. */
export type InboxChoice = (
  | { readonly taskId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string }
) & {
  /** Whether the item itself is shown where the Inbox shows one column: a notification's ask, rather than a row's choice the list stays standing for. */
  readonly opened?: true;
};

/**
 * The window's Inbox, standing in the task's place beside the sidebar: the
 * items of every task holding one in a column of their own, and the chosen
 * item beside them. It is the window's alone, as a version history is, so
 * it leaves the task the host has open, and the call bound to it, as they
 * stand; opening any task, or a new one, leaves it. The item chosen is kept
 * while it stands, so the item answered stays in sight, and after it is
 * left, so opening it again in the same workspace stands on the item last read.
 */
interface InboxViewControl {
  readonly open: boolean;
  /** The item chosen in it, none until one is, where the list's first stands in. */
  readonly chosen: InboxChoice | undefined;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (chosen: InboxChoice) => void;
  /** The pages of the chosen item's task, which the panel beside it opens; none until read, or for an item of an agent with no task. */
  readonly pages: readonly PageLine[] | undefined;
  /** Reads the chosen item's task's pages again, as a link names a page the last read did not hold. */
  readonly onRereadPages: () => void;
}

/**
 * One agent's page, standing in the task's place beside the sidebar as the
 * Inbox does: the agent an automation started with no task, which has no
 * task's column to stand in, drawn as its tab would be. It is the window's
 * alone, as the Inbox is, so it leaves the task the host has open as it
 * stands; opening any task, the Inbox, or home leaves it.
 */
interface AgentViewControl {
  /** The agent whose page stands, none while none does. */
  readonly agentId: string | undefined;
  readonly onOpen: (agentId: string) => void;
  readonly onClose: () => void;
}

/**
 * One person's page, standing in the plan's place as an agent's does: a
 * member of the listed workspace, the reader among them, or someone who left
 * it, by their account id (`person-page.tsx`).
 */
interface PersonViewControl {
  /** The person whose page stands, none while none does. */
  readonly userId: string | undefined;
  /** The name the place that opened the page knew them by, which names someone the page finds nowhere else. */
  readonly name: string | undefined;
  /** The workspace the page is the person's in, which their link names. */
  readonly workspaceId: string | undefined;
  /** Opens their page in `workspaceId`, the window listing it first where it lists another; in the listed workspace where none is named. */
  readonly onOpen: (userId: string, name?: string, workspaceId?: string) => void;
  readonly onClose: () => void;
}

/** What may stand in the task's place, the window's own rather than the task's. */
const STAND_IN = {
  INBOX: "inbox",
  AGENT: "agent",
  PERSON: "person",
  FACTORY: "factory",
  AUTOMATIONS: "automations",
  CHAT: "chat",
  ISSUES: "issues",
} as const;

/** The window's Inbox with the item chosen in it, one agent's page, Factory, the Automations page, Chat with the place shown in it, or the Issues page. */
type StandIn =
  | { readonly kind: typeof STAND_IN.INBOX; readonly chosen: InboxChoice | undefined }
  | { readonly kind: typeof STAND_IN.AGENT; readonly agentId: string }
  | {
      readonly kind: typeof STAND_IN.PERSON;
      readonly userId: string;
      readonly name?: string;
      /** The workspace the page is the person's in, which it gives way to another listed in its place. */
      readonly workspaceId: string | undefined;
    }
  | { readonly kind: typeof STAND_IN.FACTORY }
  | { readonly kind: typeof STAND_IN.AUTOMATIONS; readonly place: AutomationsPlace }
  | { readonly kind: typeof STAND_IN.CHAT; readonly place: ChatPlace }
  | { readonly kind: typeof STAND_IN.ISSUES; readonly place: IssuesPlace };

/** The window's Factory: whether it stands in the task's place, and the presses that open and leave it. */
interface FactoryViewControl {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

/** Which Automations page stands: the list, a new automation's editor, or one automation's. */
export const AUTOMATIONS_PAGE = {
  LIST: "list",
  NEW: "new",
  EDIT: "edit",
} as const;

export type AutomationsPlace =
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.LIST;
      /** The automation whose page was left for the list by deleting it, which the window's history passes over from then on. */
      readonly deleted?: string;
    }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.NEW;
      /** The suggestion on the list it was opened from, whose preset fills its draft in; none for a blank one. */
      readonly preset?: AutomationPresetName;
    }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.EDIT;
      readonly automationId: string;
      /** The run a link named, which its runs mark and bring into view. */
      readonly runId?: string;
      /** Opened by the new automation's page that made it, as its Create landed, so it takes that page's step in the window's history. */
      readonly created?: true;
    };

/** The list, where the Automations pages open with none asked for. */
const AUTOMATIONS_LIST: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST };

/** The window's Automations pages: whether one stands in the task's place, which, and the presses that open, move between, and leave them. */
interface AutomationsViewControl {
  readonly open: boolean;
  /** The page standing, the list while none does. */
  readonly place: AutomationsPlace;
  /** Opens the page asked for, the list where none is. */
  readonly onOpen: (place?: AutomationsPlace) => void;
  readonly onClose: () => void;
}

/**
 * The window's Chat, standing in the plan's place beside the sidebar as the
 * Inbox does and on the same terms: the workspace's channels in a rail of
 * their own, and For you or the channel chosen beside it. It gives way to
 * the Inbox, an agent's page, Factory, and the Automations page, and they to it. A live run reads
 * the listed workspace's chat from the service (`use-workspace-chat.ts`) while
 * the account has Chat on; a fixture run stages its own.
 */
interface ChatViewControl {
  readonly open: boolean;
  /** Whether there is a chat to read at all: a live run signed in, or a fixture run's staged one. */
  readonly available: boolean;
  /** The chat as last read, with the agent lines that name its agents beyond the plans'; none before the first read answers. */
  readonly chat: FixtureChat | undefined;
  /** Whether the last read did not answer, so Chat offers to try again. */
  readonly failed: boolean;
  readonly onRetry: () => void;
  /** For you or the channel shown, For you until another is chosen. */
  readonly place: ChatPlace;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (place: ChatPlace) => void;
  /** Opens it on a place, from wherever the window stands: what a chat notice's Open in Chat asks. */
  readonly onShow: (place: ChatPlace) => void;
  /** Posts a message as the developer; answers why it was refused, or nothing once it is taken. */
  readonly onPost: (post: ChatPost) => Promise<string | undefined>;
  /** Answers an ask as the developer; answers why it was refused, or nothing once it is taken. */
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}

/** The fixture's staging, as a fixture run imports it. */
type ChatStager = typeof import("./chat-fixture");

/** What a post or an answer says where no chat is read to send it to. */
const NO_CHAT_SERVICE = "Chat is not available yet.";

/** One of the workspace's issues a new task starts from: its id and workspace, and its identifier and title, which the dialog names it by. */
export interface NewTaskIssue {
  readonly id: string;
  readonly workspaceId: string;
  readonly identifier: string;
  readonly title: string;
}

/** The coding agent New task's Agent mode starts on the task it started: its prompt, the files attached, and the model its chip named, none for the account's default. */
export interface NewTaskAgent {
  readonly prompt: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly choice: ModelChoice | undefined;
}

/**
 * What the press that opened New task chose: a repository (a repository
 * group's +), or the issue the task starts from (an issue's Start task…),
 * and whether an agent starts on the task at once (an issue's Start
 * agent…), which starts it without its planning phase.
 */
export interface NewTaskPreset {
  readonly repository?: string;
  readonly issue?: NewTaskIssue;
  readonly agent?: boolean;
}

/**
 * What a start comes from beyond its name, repository, workspace, and
 * planning: a Linear issue, one of the workspace's own issues, whether an
 * agent starts on the task's plan at once (`agent`), and the agent New
 * task's composer starts on its words (`handed`).
 */
export interface NewTaskStart {
  readonly linearIssueId?: string;
  readonly issueId?: string;
  readonly agent?: boolean;
  readonly handed?: NewTaskAgent;
}

/** Which Issues page stands: the list, or one issue's. */
export const ISSUES_PAGE = {
  LIST: "list",
  ISSUE: "issue",
} as const;

export type IssuesPlace =
  | { readonly kind: typeof ISSUES_PAGE.LIST }
  | { readonly kind: typeof ISSUES_PAGE.ISSUE; readonly issueId: string };

/** The side panel beside the Issues pages: no task's, its one tab the issue the list peeked, which the list draws. */
const ISSUES_PANEL = { id: undefined, holds: {}, bare: true, drawsOwn: true } as const;

/** The list, where the Issues pages open with none asked for. */
const ISSUES_LIST: IssuesPlace = { kind: ISSUES_PAGE.LIST };

/** The window's Issues pages: whether one stands in the plan's place, which, and the presses that open, move between, and leave them. */
interface IssuesViewControl {
  readonly open: boolean;
  /** The page standing, the list while none does. */
  readonly place: IssuesPlace;
  /** Opens the page asked for, the list where none is. */
  readonly onOpen: (place?: IssuesPlace) => void;
  readonly onClose: () => void;
  /**
   * The issue the list last peeked, which the window's side panel draws
   * beside it while the panel is open, as the Inbox's chosen item's task's
   * panel stands beside the Inbox; none before one is peeked.
   */
  readonly peeked: string | undefined;
  readonly onPeek: (issueId: string | undefined) => void;
}

/** Everything the Tasks tab draws and presses, handed to the panel body whole. */
export interface TasksControl {
  page: TasksPage;
  /** Whether a launch is still opening the task last open, while the home page waits rather than flash before it (`use-last-task.ts`). */
  restoring: boolean;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's tasks stand in for one. */
  signedIn: boolean;
  /** The signed-in account's id, whose own edits a task names "you"; none while signed out, for a fixture, or an identity stored without one. */
  me: string | undefined;
  /** Every task of every workspace, in the sidebar's order: the pinned ones first, newest pinned first, then the rest, newest started first; what the palette, the inbox, and the history find a task in. */
  tasks: TasksView["tasks"];
  /** Every archived task of every workspace, newest archived first. */
  archived: TasksView["tasks"];
  /**
   * The chosen workspace's share of `plans` and `archived`, which alone the
   * sidebar lists, and of `inbox` and `inboxTasks`, which alone the Inbox,
   * its count, and Home list; everything while no workspace is chosen.
   */
  listed: {
    tasks: TasksView["tasks"];
    archived: TasksView["tasks"];
    inbox: readonly AppInboxTask[];
    inboxTasks: readonly AppInboxTaskHolding[];
  };
  /** The chosen workspace's agents an automation started with no plan, newest started first, which the sidebar lists among the plans, and those archived, which its Archived view lists among the archived plans. */
  listedAgents: {
    readonly standing: readonly TasklessAgent[];
    readonly archived: readonly TasklessAgent[];
  };
  /** The workspaces the account is a member of, its first one first; none before the first read lands. */
  workspaces: readonly Workspace[];
  /** Whether the last read of the workspaces did not land, those held still drawn. */
  workspacesFailed: boolean;
  /** Reads the workspaces again after a read that did not land. */
  onRetryWorkspaces: () => void;
  /** The workspace the sidebar lists and New task starts in; absent while none is listed, when every task is listed. */
  workspace: Workspace | undefined;
  /** Lists another of the account's workspaces, and starts the next new task in it. */
  onChooseWorkspace: (workspaceId: string) => void;
  /** Lists the account's own workspace, else the first other, once one is left, and turns to the home page. */
  onLeftWorkspace: (workspaceId: string) => void;
  /** Creates a workspace of that name and lists it; answers why it was not created, or nothing once it was. */
  onCreateWorkspace: (name: string) => Promise<string | undefined>;
  /** Opens Settings on its Workspace page, showing the listed workspace. */
  onOpenWorkspaceSettings: () => void;
  /** Whether the account has GitHub connected, and its login; absent before the first read lands. */
  github: GitHubConnection | undefined;
  /** Opens the page that connects the account's own GitHub in the browser; answers whether it opened, a refusal saying why in a toast. */
  onConnectAccountGitHub: () => Promise<boolean>;
  /** Disconnects the account's own GitHub, under the Mac's session; answers whether it did, a refusal saying why in a toast. */
  onDisconnectAccountGitHub: () => Promise<boolean>;
  activeTaskId: string | undefined;
  /**
   * The task the tab is on its way to: the one a press asked the host for,
   * until the host's open task next moves, else the open one. Nothing is the
   * home page, asked for or standing.
   */
  boundFor: string | undefined;
  listFailed: boolean;
  /** Whether the list drawn is one the service answered, rather than the empty one before the first read lands. */
  listRead: boolean;
  region: DocumentRegion;
  /** Copies the plan drawn as Markdown, answered with a toast, since its press stands in a menu. */
  copy: { onPress: () => void };
  /** Saves the developer's edit of the open plan's document: saved, a conflict with the text as it stands now, or why not. */
  edit: (taskId: string, request: PlanEditRequest) => Promise<TasksEditAnswer>;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  /** Silences Luke's voice on this Mac for the open task's call, or plays it again; offered with the stop. */
  speaker: { muted: boolean; onPress: () => void };
  /** Ends the open task's call at once, offered only while that call is in progress. */
  stop: { shown: boolean; onPress: () => void };
  /** The open task's call status beside the microphone, absent while none stands. */
  status: CallStatus | undefined;
  /** Whether the open task's call is in progress, so the plan is still being written. */
  live: boolean;
  /** The task's column's tabs: the task's own, then its agents' and its draft's, and which is shown. */
  mainTabs: MainTabsControl;
  /** The side panel beside the open task's column: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents' tabs that ended unseen, each until it is shown. */
  unreadTabs: readonly StripTab[];
  /** The open task's whiteboard as main holds it; absent before its first read lands. */
  board: Board | undefined;
  /** Every code Luke showed on the open task, oldest first: what the service keeps, and each a call shows as it shows it. */
  shownCode: TasksView["shownCode"];
  /** Whether the last read of the open task's work and code did not land, what is held still drawn. */
  workFailed: boolean;
  /** Reads the open task's work and code again after a read that did not land. */
  onRetryWork: () => void;
  /** The pages agents wrote for the open task, each by its newest version; absent with none. */
  pages: TasksView["pages"];
  /** What was said on the open task's calls, the call standing now included, and the retry of a read that failed. */
  transcript: {
    region: TranscriptRegion;
    onRetry: () => void;
    /** The call the tab is asked to bring into view, by its key, and the word that it has; what a version's Open asks. */
    reveal?: { readonly call: string; readonly onRevealed: () => void } | undefined;
  };
  /**
   * What Luke's brain wrote and ran on the open task's calls, the turn the
   * page before the oldest drawn
   * is read before where an older one stands, and that read.
   */
  work: {
    /** The open task's conversation with the brain as an agent's transcript is read; none before the first read lands. */
    conversation: TasksView["conversation"];
    onLoadEarlier: () => Promise<void>;
    /** Reads the brain's worker's session past a cursor, as an agent's worker's tab reads its own, the task standing in the agent's place. */
    readWorker: TranscriptReader;
    /** The moment whose turn the tab is asked to bring into view, and the word that it has; what a version's Open asks. */
    reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
  };
  /** The open task's coding agents: their tabs, the Start, and the Stop. */
  agents: CodingAgentsControl;
  /** The open plan's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  onSelect: (taskId: string) => void;
  /** Opens a task on one agent's tab: what a notification's click asks. */
  onShowAgent: (taskId: string, agentId: string) => void;
  /** Leaves the version history for the place that wrote a version: its agent's tab, its call in the Transcript, or its turn in Work. */
  onShowSource: (taskId: string, source: RevisionSource) => void;
  /** The question a Talk press or a start asks before it ends the call standing about another task. */
  secondCall: { confirm: DialogConfirm; question: DialogQuestion };
  /** Opens a task on its own document tab, out from under its version history and a side panel filling the window: the call card's way back. */
  onShowTask: (taskId: string) => void;
  /** Opens a task the same way, scrolled to the section a mention or a Luke link names, or at its top for the task's own. */
  onShowMention: (mention: PlanMention) => void;
  /**
   * Opens the place a Luke link names, of the Plans tab's: a task, its
   * section, version, page, call, or turn; an agent, on its task's tab or
   * its own page; the Inbox, on an item; Automations, on one; Factory. A
   * place of a workspace the account lists by the link's slug is shown in
   * it. Whoever cannot read the place is told so where it would stand, by
   * the place's own read, which is checked against them.
   */
  onOpenLink: (link: ReadLink) => void;
  /** The last ask to bring one of an agent's messages into view, which a link to it makes; let go once its tab answers it (`message-links.tsx`). */
  messageReveal: MessageReveal | undefined;
  /** The agent's tab answered the ask, so a later visit to the agent does not answer it again. */
  onMessageRevealed: (ask: number) => void;
  /** The last ask to show a section, under the task it was asked of, so a section of a task not yet open is shown once it is drawn; let go once shown. */
  sectionReveal: { readonly taskId: string; readonly reveal: SectionReveal } | undefined;
  /** The task's page showed the section an ask named, so a later visit to the task does not show it again. */
  onSectionRevealed: (ask: number) => void;
  /** Opens a task on its Inbox tab the same way, opening the tab where it was closed: what ⌘K's Inbox row asks. */
  onShowInbox: (taskId: string) => void;
  /** Opens a plan on its Chat tab, its channel of the workspace's chat, opening the tab where it was closed: what ⌘K's Chat row asks. */
  onShowChat: (taskId: string) => void;
  /** What waits on the developer across the account's tasks, as main's read last answered: each task with an open inbox item, and its items. */
  inbox: readonly AppInboxTask[];
  /** The task whose Inbox is on screen, or none: what main is told, so an item it shows is not announced. */
  inboxShown: string | null;
  /** The Chat on screen, the window's or a task's Chat tab, or none: what main is told, so a message it shows is not announced. */
  chatShown: ChatShown | null;
  /** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
  inboxTasks: readonly AppInboxTaskHolding[];
  /** What waits on the developer from agents with no task, as main's read last answered: what the window's Inbox lists beside the tasks' and counts with them. */
  inboxTaskless: readonly AppInboxTasklessItem[];
  /** The newest run of each of the account's own automations that failed to start lately, every workspace's, which marks the sidebar's Automations of the run's workspace until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
  /** The window's Inbox: whether it stands in the task's place, the task chosen in it, and its presses. */
  inboxView: InboxViewControl;
  /** One agent's page: which agent's stands in the task's place, if any, and its presses. */
  agentView: AgentViewControl;
  /** One person's page: whose stands in the plan's place, if anyone's, and its presses (`person-page.tsx`). */
  personView: PersonViewControl;
  /** The window's Factory: whether it stands in the task's place, and its presses (`desktop-factory.tsx`). */
  factoryView: FactoryViewControl;
  /** The window's Automations page: whether it stands in the task's place, and its presses (`automations-page.tsx`). */
  automationsView: AutomationsViewControl;
  /** The window's Issues page: whether it stands in the plan's place, which, and its presses (`issues-page.tsx`). */
  issuesView: IssuesViewControl;
  /** The task the call in progress on this Mac is about, or none: what Factory marks as being planned. */
  callTaskId: string | undefined;
  /** The window's Chat: whether it stands in the plan's place, the chat it reads, the place shown in it, and its presses. */
  chatView: ChatViewControl;
  /** Opens a task's file in its side panel at the commit named, the reference's lines lit, opening the task first where it is not the open one: what an inbox item's code opens. */
  onShowFile: (taskId: string, ref: CodeRef, commit: string) => void;
  /** Opens a tab pinned to the sidebar: its task, where it is not the open one, and the tab in its column, opening the side panel for one of its own. */
  onOpenPinnedTab: (pin: PinnedTab) => void;
  /** Opens the tab closed latest again as it stood, on its task, opening the task first where it is not the open one; none while no closed tab is kept. */
  onReopenClosedTab: (() => void) | undefined;
  /** The pin the open task was last opened from, which the sidebar marks in the task's place for as long as the task stays open; none once a task is opened otherwise. */
  chosenPin: PinnedTab | undefined;
  /** What the repository chip offers, in the composer and on the open task alike. */
  repositories: RepositoryChooser;
  /** The ask standing for the open task's chip to open its menu: which task it is about, and how many asks so far. */
  repositoryMenu: { taskId: string; request: number } | undefined;
  /** Opens a task's repository chip menu, opening the task first where it is not the open one. */
  onChangeRepository: (taskId: string) => void;
  /** Gives a task its repository, or takes it away with null; answers why the service refused, or nothing once it is kept. */
  onSetRepository: (taskId: string, repository: string | null) => Promise<string | undefined>;
  /** Opens a task's repository on GitHub in the browser. */
  onOpenOnGitHub: (taskId: string) => void;
  /** Opens Settings › Workspace at its GitHub, for the workspace the task belongs to. */
  onOpenWorkspaceGitHub: (taskId: string) => void;
  /**
   * Moves a task to another of the account's workspaces, whose GitHub
   * reaches its repository, and lists that workspace so the task stays in
   * sight; answers whether it moved, a refusal saying why in a toast unless
   * the caller says it itself (`quiet`), as the Move dialog does under its list.
   */
  onMoveTask: (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ) => Promise<boolean>;
  onRetryList: () => void;
  onRetryDocument: () => void;
  /** Opens the New task dialog over whatever stands open, which it leaves standing. */
  onNewTask: () => void;
  /** New task with a repository already chosen in the dialog: what a repository group's + asks. */
  onNewTaskIn: (repository: string) => void;
  /** New task started from one of the workspace's issues: named by it, in its workspace, and linked to it once started; what an issue's Start task… asks, and with `agent` its Start agent…, which starts an agent on the task at once. */
  onNewTaskFrom: (issue: NewTaskIssue, agent?: boolean) => void;
  /** The New task dialog: whether it stands, what its press chose, and the two presses it makes. */
  newTask: {
    open: boolean;
    /** What the press that opened the dialog chose: a repository, or the issue the task starts from, where it chose one. */
    preset: NewTaskPreset | undefined;
    /** The workspaces a task may start in, the account's every one. */
    workspaces: readonly Workspace[];
    /** The workspace the dialog starts the task in until another is chosen: the one listed; none before the workspaces are read. */
    workspaceId: string | undefined;
    /** The repository chip's list for a workspace, as the dialog chooses which the task starts in. */
    repositoriesIn: (workspaceId: string | undefined) => RepositoryChooser;
    /**
     * Starts the plan on the repository given, or none, in the workspace
     * given, with its planning phase or without it, from the Linear issue
     * given where one was picked, or from the workspace's own issue the
     * dialog was opened on, which closes the dialog and opens the plan; with
     * an agent asked for at once it presses the task's Start once it stands
     * open, and with an agent handed over it opens the task on a draft
     * agent's tab holding the agent's prompt, files, and model, which starts
     * the agent at once; answers why the task did not start, or nothing once
     * it has.
     */
    start: (
      name: string,
      repository: string | null,
      workspaceId: string | undefined,
      planning: boolean,
      from?: NewTaskStart,
    ) => Promise<string | undefined>;
    /** The models the composer's chip offers, as last read; nothing before the first read lands. */
    models: readonly CatalogModel[] | undefined;
    /** Reads the models now, for the chip's name and its menu opening. */
    readModels: () => void;
    /** Reads the account's default model, which the composer's chip starts on. */
    readDefault: () => Promise<CodingAgentDefaultAnswer>;
    /** Puts the dialog away with nothing started. */
    onClose: () => void;
    /**
     * The read of a workspace's Linear issues, where that workspace has
     * Linear connected; none where it has not, which leaves the name a plain
     * field. Asked nothing, it answers the issues the dialog reads as it
     * opens; asked a search or an identifier, it answers what Linear finds
     * for the name as typed.
     */
    linearIssuesIn: (
      workspaceId: string | undefined,
    ) => ((ask?: LinearIssuesAsk) => Promise<readonly LinearIssueSummary[]>) | undefined;
  };
  /** Leaves the open task for the home page; a call on it stands, as opening another task leaves one. */
  onLeaveTask: () => void;
  /** Goes to the home page from wherever the tab stands: the open task left, and the window's Inbox put away. */
  onGoHome: () => void;
  /**
   * Renames a task to a name already trimmed and changed, drawn under it at
   * once and under its old name again if the service refuses; answers
   * whether it was renamed.
   */
  onRenameTask: (taskId: string, name: string) => Promise<boolean>;
  /**
   * Draws a name being typed for a task everywhere the task is named, before
   * any of it is saved, or none, which draws its saved name again.
   */
  onDraftName: (taskId: string, name: string | undefined) => void;
  /**
   * Pins or unpins a task, archives it or brings it back, drawn at once and
   * put back with a note if the service refuses. Archiving the open task
   * leaves it for the home page, as deleting it does.
   */
  onMarkTask: (taskId: string, mark: TaskMark) => void;
  /**
   * Archives several tasks at once, as a repository's Archive tasks asks:
   * each drawn archived at once, and one toast for them all once the
   * service answered, whose Undo brings back every task it kept.
   */
  onArchiveTasks: (taskIds: readonly string[]) => void;
  /** The repositories the account pinned in the sidebar, newest pinned first, whose groups stand above the rest. */
  pinnedRepositories: readonly string[];
  /** Pins a repository in the sidebar or unpins it, on the account: drawn at once, and put back with a toast if the service refuses. */
  onPinRepository: (repository: string, pinned: boolean) => void;
  /** Pins an agent with no plan in the sidebar or unpins it, for the account alone: drawn at once, and put back with a toast if the service refuses. */
  onPinAgent: (agentId: string, pinned: boolean) => void;
  /**
   * Gives the pins a drag in the sidebar's Pinned section moved their new
   * places, on the account: a plan's and an agent's with no plan, drawn
   * there at once, and put back with a toast if the service refuses, along
   * with what `putBack` undoes. A tab pinned to the sidebar keeps its place
   * on this Mac instead (`sidePanel`), which the drop's `putBack` restores.
   */
  onMovePins: (moves: readonly PinMove[], putBack?: () => void) => void;
  /**
   * The sections the account made in its sidebars and the tasks it keeps
   * in them, every workspace's, as the service last answered them with the
   * writes still out drawn over them.
   */
  taskSections: TaskSections;
  /**
   * Writes changes to the sections, in order, on the account: drawn at
   * once, sent one after another, and let go as each is answered, so a
   * refused one goes back with a toast.
   */
  onWriteSections: (writes: readonly TaskSectionWrite[]) => void;
  /** Deletes a task, which ends its call and returns to the home page if it is the open one; answers whether it was deleted. */
  onDeleteTask: (taskId: string) => Promise<ActionResult>;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, else an open
   * task back to the home page.
   */
  back: () => boolean;
  /** The window's one ask before leaving a page whose unsaved work would be lost. */
  leaveGuard: LeaveGuard;
}

/** Asks before the window leaves a page whose unsaved work would be lost; `leave` goes, past the ask, once the developer says to. */
export type LeaveAsk = (leave: () => void) => void;

/**
 * The window's ask before leaving a page that holds unsaved work. A page
 * stands its ask for as long as it holds that work; every way the window
 * moves its place, a sidebar row, ⌘K, history, a tab, is a door this
 * guards, so each asks first, and a page's own way out once its work is
 * saved, or the developer said to leave, passes.
 */
export interface LeaveGuard {
  /** Stands `ask` until the returned function takes it down. */
  readonly stand: (ask: LeaveAsk) => () => void;
  /** Takes a way out past the ask, as the page holding the work takes its own. */
  readonly pass: (leave: () => void) => void;
  /** A way out that asks first while an ask stands. */
  readonly guard: <Args extends readonly unknown[]>(
    leave: (...args: Args) => void,
  ) => (...args: Args) => void;
}

/**
 * The window's one leave guard, made where the window's tabs are, so the
 * tab switch is guarded as the plans tab's own doors are. Note that the ask
 * standing is read through a ref, because a door is called from a closure a
 * render handed out earlier.
 */
export function useLeaveGuard(): LeaveGuard {
  const standing = useRef<LeaveAsk | undefined>(undefined);
  const passing = useRef(false);
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
        return () => {
          if (standing.current === ask) standing.current = undefined;
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

/** The open plan's history as the window opens and draws it, over what is read of it. */
export interface VersionHistoryControl extends PlanHistoryControl {
  /** Whether the plan's version history takes the window in its place. */
  open: boolean;
  /**
   * Opens a plan's version history on the plan as it stands, or, given the
   * moment of a save, on the revision that made it, opening the task first
   * where it is not the open one.
   */
  onOpen: (taskId: string, save?: number) => void;
  /** Opens a plan's version history where it stood when it was left, as Back and Forward go to it. */
  onReturn: (taskId: string, spot: HistorySpot | undefined) => void;
  /** Leaves the version history for the task, its side panel as it was. */
  onClose: () => void;
}

/** The task whose version history stands, and the save whose revision it opened on or where it stood before. */
interface HistoryOpening {
  readonly taskId: string;
  readonly save: number | undefined;
  readonly spot: HistorySpot | undefined;
}

/** A pin pressed in the sidebar, and the task open when it was, or its own once that opens. */
interface PinChoice {
  readonly pin: PinnedTab;
  readonly over: string | undefined;
}

/**
 * A task asked of the host, or the home page as nothing, and the open
 * task it was asked over: the ask stands only while that task is still the
 * open one, so the host's next move, whatever it is, answers it.
 */
interface TaskAsk {
  taskId: string | undefined;
  over: string | undefined;
}

/** No repository pin given here and still waiting on main's view. */
const NO_PENDING_PINS: PendingRepositoryPins = new Map();

/** No agent pin given here and still waiting on main's view. */
const NO_PENDING_AGENT_PINS: PendingAgentPins = new Map();

/** No pin dragged here whose new place main's view has yet to carry. */
const NO_PENDING_POSITIONS: PendingPinPositions = new Map();

/** A task with no page, the same array every render, so the arrivals read no change in it. */
const NO_PAGES: NonNullable<TasksView["pages"]> = [];

/** What an agent's page holds of the plan's panel kinds: nothing, its tabs being the agent's own. */
const NO_HOLDS: TaskHolds = {};

/** No ids, the same array every render. */
const NO_IDS: readonly string[] = [];

/** No agent with no plan, before the list carries any. */
const NO_TASKLESS_AGENTS: readonly TasklessAgent[] = [];

/** What the toast says once Copy plan has put the plan on the clipboard. */
const TASK_COPIED_NOTE = "Plan copied";

/** What the toast says once a task is deleted. */
const TASK_DELETED_NOTE = "Task deleted";

/** What the toast says when the service did not move a task, which stays where it was. */
const MOVE_REFUSED_NOTE = "The task could not be moved. Try again.";

/** What the toast says when opening a task listed the workspace it is in. */
function switchedNote(workspace: string): string {
  return `Switched to ${workspace}`;
}

/** The switch toast's action, which lists the workspace left again. */
function backNote(workspace: string): string {
  return `Back to ${workspace}`;
}

/** Why a delete the service did not carry was refused. */
const DELETE_REFUSED_NOTE = "The task could not be deleted. Try again.";

/** What a delete the service did not carry answers, so the task stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_REFUSED_NOTE,
};

/*
 * What the Inbox holds, by workspace. Main reads what waits across every
 * task the account can reach, and the window lists one workspace at a time,
 * so everything the window lists of the Inbox, its rows, the sidebar's
 * count, and Home's waiting list, is the listed workspace's share
 * (`docs/proposals/workspace-clarity.md`, decision 11). A task is placed by
 * the workspace the account's task list says it is in, so an item of a task
 * not yet listed is in no workspace's share until it is.
 */

/** The entries of the tasks in `workspaceId`, or every entry while no workspace is listed. */
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

/**
 * The Inbox's last choice, by the account signed in and the workspace listed
 * as it was made, so another account on this Mac, or another workspace,
 * never opens on it.
 */
interface RememberedInboxChoice {
  readonly account: string | undefined;
  readonly workspaceId: string | undefined;
  readonly chosen: InboxChoice;
}

/**
 * The Inbox's choice to stand on as it opens again: the one last made, where
 * it was made by the account signed in now in the workspace listed, else none,
 * where the list's first stands in. Note that it comes back as a row's choice
 * rather than an ask, so an item gone since gives way to the first rather than
 * saying it is missing.
 */
function rememberedChoice(
  remembered: RememberedInboxChoice | undefined,
  now: { readonly account: string | undefined; readonly workspaceId: string | undefined },
): InboxChoice | undefined {
  if (remembered === undefined) return undefined;
  if (remembered.account !== now.account || remembered.workspaceId !== now.workspaceId) {
    return undefined;
  }
  const { chosen } = remembered;
  return "taskId" in chosen
    ? { taskId: chosen.taskId, itemId: chosen.itemId }
    : { agentId: chosen.agentId, itemId: chosen.itemId };
}

/** What the second call's question says: the call it ends, and what the act does. */
function secondCallQuestion(taskName: string): DialogQuestion {
  return {
    title: `End your call on ${taskName} and start one here?`,
    body: "What was said on that call stays in its transcript.",
    verb: "Start new call",
    running: "Starting",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** What the open task holds of each fixed tab's kind, each unknown until its read lands: the transcript's calls are those heard on it too. */
function taskHolds(
  view: Pick<TasksView, "board" | "shownCode" | "conversation">,
  transcript: TranscriptRegion,
): TaskHolds {
  const { board, shownCode, conversation } = view;
  const work = conversation?.messages;
  return {
    [SIDE_PANEL_TAB.BOARD]:
      board === undefined
        ? undefined
        : board.elements.length > 0 || (board.drawing?.elements.length ?? 0) > 0,
    [SIDE_PANEL_TAB.CODE]: shownCode === undefined ? undefined : shownCode.length > 0,
    // A call holds something once a line was said on it or Luke worked on the task, and nothing yet while neither has been read.
    [SIDE_PANEL_TAB.CALL]:
      transcript.kind === TRANSCRIPT_REGION.READY || (work?.length ?? 0) > 0
        ? true
        : transcript.kind === TRANSCRIPT_REGION.EMPTY && work !== undefined
          ? false
          : undefined,
  };
}

export function useTasksTab(input: {
  acts: Pick<ActHandle, "act" | "tell">;
  /** The tasks main holds, the account's; a fixture run's own stand in for them. */
  tasks: TasksView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  /** The signed-in account's email, which the task last open is kept under; none while signed out. */
  account: string | undefined;
  /** The signed-in account's id, whose own work the window names as theirs; none while signed out. */
  accountId?: string | undefined;
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** The agents main says ended while no one was looking, each until its tab is shown. */
  unseenAgents: readonly string[];
  /** What main says waits on the developer across the account's tasks. */
  inboxWaiting: readonly AppInboxTask[];
  /** Every task main says holds an inbox item, waiting or settled. */
  inboxTasks: readonly AppInboxTaskHolding[];
  /** What main says waits on the developer from agents with no task. */
  inboxTaskless: readonly AppInboxTasklessItem[];
  /** The newest run of each of the account's own automations main says failed to start lately. */
  failedRuns: readonly AccountFailedRun[];
  voice: {
    view: VoiceView;
    listening: boolean;
    requestMicrophoneAccess: () => void;
  };
  /** Opens Settings on its Integrations page, where an agent's MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Coding agents page, where the developer's API keys are. */
  onOpenApiKeys: () => void;
  /** Opens Settings at the place the link names. */
  onOpenSettings: (link: SettingsLink) => void;
  /** The window's ask before leaving unsaved work, which guards every door here that moves the place. */
  leaveGuard: LeaveGuard;
}): TasksControl {
  const { shown, voice, leaveGuard } = input;
  const { guard } = leaveGuard;
  const { act, tell } = input.acts;
  const copyWithToast = useCopyToast();
  const toast = useToast();
  // The New task dialog's ask, standing while the dialog does: the preset it was opened with, if any.
  const [newTaskAsk, setNewTaskAsk] = useState<
    { readonly preset: TasksControl["newTask"]["preset"] } | undefined
  >(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<TasksControl["repositoryMenu"]>(undefined);
  const [asked, setAsked] = useState<TaskAsk | undefined>(undefined);
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  /**
   * The task whose version history stands in the window, which it does only
   * while that task is the one bound for, and the save whose revision it
   * opened on, none for the plan as it stands.
   */
  const [historyFor, setHistoryFor] = useState<HistoryOpening | undefined>(undefined);
  /** What stands in the task's place while one does: the window's Inbox and the item chosen in it, or one agent's page. */
  // The chat profile opens Chat at launch over its fixture.
  // The issue the Issues list last peeked, held for the window's life so the panel's toggle shows it again.
  const [issuePeek, setIssuePeek] = useState<string | undefined>(undefined);
  const [standIn, setStandIn] = useState<StandIn | undefined>(() =>
    input.run.fixtureMode && input.run.profile === RUN_PROFILE.CHAT
      ? { kind: STAND_IN.CHAT, place: FOR_YOU }
      : undefined,
  );
  const inboxView = standIn?.kind === STAND_IN.INBOX ? standIn : undefined;
  const agentView = standIn?.kind === STAND_IN.AGENT ? standIn : undefined;
  /** The item last chosen in the Inbox, by whom and where, which opening the Inbox again stands on. */
  const lastInboxChoice = useRef<RememberedInboxChoice | undefined>(undefined);
  /**
   * The chat a fixture run stages, stamped once at the moment it lands,
   * which its own posts and answers land in, and the module that stages it.
   * Note that the module is imported only by a fixture run, because its
   * synthetic chat must never ship in the bundle every launch parses.
   */
  const [chat, setChat] = useState<FixtureChat | undefined>(undefined);
  const [stager, setStager] = useState<ChatStager | undefined>(undefined);
  const { fixtureMode } = input.run;
  useEffect(() => {
    if (!fixtureMode) return;
    let live = true;
    import("./chat-fixture").then((loaded) => {
      if (!live) return;
      setStager(loaded);
      setChat(loaded.fixtureChat({ fixtureMode }, Date.now()));
    });
    return () => {
      live = false;
    };
  }, [fixtureMode]);
  const stage = (
    staged: (held: FixtureChat, staging: ChatStager) => Staged,
  ): Promise<string | undefined> => {
    if (chat === undefined || stager === undefined) return Promise.resolve(NO_CHAT_SERVICE);
    const landed = staged(chat, stager);
    if ("refused" in landed) return Promise.resolve(landed.refused);
    setChat(landed.chat);
    return Promise.resolve(undefined);
  };
  /** A file an inbox item opens on a task not yet open, opened once the host has it open. */
  const [fileFor, setFileFor] = useState<
    { readonly taskId: string; readonly ref: CodeRef; readonly commit: string } | undefined
  >(undefined);
  const [reveal, setReveal] = useState<SourceReveal | undefined>(undefined);
  const [sectionReveal, setSectionReveal] = useState<TasksControl["sectionReveal"]>(undefined);
  const [messageReveal, setMessageReveal] = useState<MessageReveal | undefined>(undefined);
  const messageAsks = useRef(0);
  /** The asks to show a section made so far, so each is its own even after the last was let go. */
  const sectionAsks = useRef(0);
  /** The tabs closed in the window, the latest last, which ⇧⌘T opens again (`closed-tabs.ts`). */
  const [closedTabs, setClosedTabs, latestClosedTabs] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);
  /** The closed tabs opened again on a task not yet open, in the order asked, opened once the host has it open. */
  const [reopenFor, setReopenFor, latestReopenFor] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);

  // A fixture run draws its synthetic tasks in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixtureTasksView(input.run);
  const viewed = fixture ?? input.tasks;
  // A name given here stands until main's view carries it, so a rename that
  // landed never flickers back while main's copy of the view catches up.
  const [renames, setRenames] = useState<PendingRenames>(new Map());
  useEffect(() => setRenames((held) => unsettledRenames(held, viewed)), [viewed]);
  // A name being typed is drawn over both, held here rather than read back
  // from main, so every surface naming the task follows the typing at once.
  const [drafts, setDrafts] = useState<PendingRenames>(new Map());
  const draftName = useCallback((taskId: string, name: string | undefined) => {
    setDrafts((held) => {
      if (held.get(taskId) === name) return held;
      const next = new Map(held);
      if (name === undefined) next.delete(taskId);
      else next.set(taskId, name);
      return next;
    });
  }, []);
  // A pin or an archive given here stands until main's view carries it, as a name does.
  const [marks, setMarks] = useState<PendingMarks>(new Map());
  useEffect(() => setMarks((held) => unsettledMarks(held, viewed)), [viewed]);
  // A repository's pin given here stands until main's view carries it, as a
  // task's does. Note that a sign-out lets every one go, because a pin names
  // a repository rather than a row of this account's own, so one left
  // standing would be drawn on the next account to sign in.
  const [repositoryPins, setRepositoryPins] = useState<PendingRepositoryPins>(new Map());
  const accountSignedIn = input.signedIn;
  useEffect(
    () =>
      setRepositoryPins((held) =>
        accountSignedIn ? unsettledRepositoryPins(held, viewed.repositoryPins) : NO_PENDING_PINS,
      ),
    [viewed, accountSignedIn],
  );
  // An agent's pin given here stands until main's view carries it, as a plan's does.
  const [agentPins, setAgentPins] = useState<PendingAgentPins>(NO_PENDING_AGENT_PINS);
  useEffect(
    () =>
      setAgentPins((held) =>
        accountSignedIn
          ? unsettledAgentPins(held, viewed.tasklessAgents ?? NO_TASKLESS_AGENTS)
          : NO_PENDING_AGENT_PINS,
      ),
    [viewed, accountSignedIn],
  );
  // A pin dragged here stands in its new place until main's view carries it, as a pin does.
  const [pinPositions, setPinPositions] = useState<PendingPinPositions>(NO_PENDING_POSITIONS);
  useEffect(
    () =>
      setPinPositions((held) =>
        accountSignedIn ? unsettledPinPositions(held, viewed) : NO_PENDING_POSITIONS,
      ),
    [viewed, accountSignedIn],
  );
  // A change to the sections stands drawn until its act settles, by which
  // time main's view carries the service's answer to it. Note that a
  // sign-out lets every one go, as it does a repository's pin.
  const [sectionWrites, setSectionWrites] = useState<readonly PendingSectionWrite[]>([]);
  useEffect(() => {
    if (!accountSignedIn) setSectionWrites([]);
  }, [accountSignedIn]);
  const taskSections = sectionWrites.reduce(
    (held, pending) => applySectionWrite(held, pending.write, pending.at),
    viewed.taskSections ?? NO_TASK_SECTIONS,
  );
  // A tab closed names a task of the account it was closed under, so a sign-out lets them go.
  useEffect(() => {
    if (!accountSignedIn) setClosedTabs(NO_CLOSED_TABS);
  }, [accountSignedIn, setClosedTabs]);
  const tasks = positionedView(
    markedView(renamedView(renamedView(viewed, renames), drafts), marks),
    pinPositions,
  );
  // The sidebar lists the chosen workspace's tasks alone, and everything
  // else that finds a task, the palette, the inbox, and the history, finds
  // it among them all; with no workspace listed yet, every task is listed.
  const workspace = useChosenWorkspace(viewed.workspaces, fixture !== undefined);
  // Every workspace listed by a choice is counted, so a move answered late can tell whether one was made since it was pressed.
  const workspaceChoices = useRef(0);
  const listWorkspace = workspace.choose;
  const chooseListed = useCallback(
    (workspaceId: string) => {
      workspaceChoices.current += 1;
      listWorkspace(workspaceId);
    },
    [listWorkspace],
  );
  const listedWorkspace = workspace.chosen;
  // A person's page is theirs in the workspace it opened in, so another listed in its
  // place, chosen or fallen back to as the account's workspaces change, closes it.
  if (standIn?.kind === STAND_IN.PERSON && standIn.workspaceId !== listedWorkspace?.id) {
    setStandIn(undefined);
  }
  const sidebar = sidebarTasks(tasks.tasks);
  const listedSidebar = sidebarTasks(
    listedWorkspace === undefined
      ? tasks.tasks
      : tasks.tasks.filter((task) => task.workspaceId === listedWorkspace.id),
  );
  const listedWorkspaceId = listedWorkspace?.id;
  // The agents with no plan are listed by the same workspace as the plans, standing and archived apart as the plans are,
  // each pinned as given here until main's view carries it.
  const { tasklessAgents } = tasks;
  const listedAgents = useMemo(() => {
    const listed = agentsPinned(tasklessAgents ?? NO_TASKLESS_AGENTS, agentPins).filter(
      (agent) => listedWorkspaceId === undefined || agent.workspaceId === listedWorkspaceId,
    );
    return {
      standing: listed.filter((agent) => agent.archivedAt === undefined),
      archived: listed.filter((agent) => agent.archivedAt !== undefined),
    };
  }, [tasklessAgents, agentPins, listedWorkspaceId]);
  const { inboxWaiting, inboxTasks } = input;
  const listedInbox = useMemo(
    () => ({
      inbox: inWorkspace(inboxWaiting, tasks.tasks, listedWorkspaceId),
      inboxTasks: inWorkspace(inboxTasks, tasks.tasks, listedWorkspaceId),
    }),
    [inboxWaiting, inboxTasks, tasks.tasks, listedWorkspaceId],
  );
  const signedIn = fixture !== undefined || input.signedIn;
  // Outside a fixture run, Chat reads the listed workspace's chat from the service, while the account has it on.
  const chatOn = useChatOn();
  // A channel chosen in Chat is the listed workspace's, so another workspace listed puts Chat back on For you.
  const [chatWorkspace, setChatWorkspace] = useState(listedWorkspace?.id);
  if (chatWorkspace !== listedWorkspace?.id) {
    setChatWorkspace(listedWorkspace?.id);
    if (standIn?.kind === STAND_IN.CHAT && standIn.place.kind === CHAT_PLACE.CHANNEL) {
      setStandIn({ kind: STAND_IN.CHAT, place: FOR_YOU });
    }
  }
  // The task's Chat tab on screen reads the task's plan channel, which the column below says once it knows its tab.
  const [tabReading, setTabReading] = useState<string | undefined>(undefined);
  const liveChat = useWorkspaceChat({
    account: input.account,
    workspaceId: listedWorkspace?.id,
    active: fixture === undefined && input.signedIn && chatOn,
    reading:
      shown && standIn?.kind === STAND_IN.CHAT && standIn.place.kind === CHAT_PLACE.CHANNEL
        ? standIn.place.channelId
        : tabReading,
    readChat: (params) => act(ACT_KIND.CODING_AGENTS_CHAT, params),
    writeChat: (params) => act(ACT_KIND.CODING_AGENTS_CHAT_POST, params),
  });
  const liveRun = fixture === undefined;
  const shownChat: FixtureChat | undefined = liveRun
    ? liveChat.chat === undefined
      ? undefined
      : { answer: liveChat.chat, agents: [] }
    : chat;
  const page = tasksPage(tasks);
  const region = documentRegion(tasks);
  // A started agent's tab opens selected; the column's tabs are built after
  // the agents they draw, so the opening reaches them through this late binding.
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = viewed.document.task;
  // The open task's own words, which a dictation into one of its agents' boxes listens for.
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
  // A fixture's tasks have no agents, as they are read from nowhere.
  const agents = useCodingAgents({
    acts: input.acts,
    taskId: fixture === undefined ? viewed.activeTaskId : undefined,
    repository:
      openDocument?.id === viewed.activeTaskId ? (openDocument?.repository ?? null) : null,
    // Read through the marks, so an Unarchive opens the composers at once, as it does the document.
    archived: region.kind === DOCUMENT_REGION.READY && region.task.archivedAt !== undefined,
    onUnarchive: () => {
      if (region.kind === DOCUMENT_REGION.READY)
        markNow.current(region.task.id, TASK_MARK.UNARCHIVE);
    },
    onOpenIntegrations: input.onOpenIntegrations,
    onOpenApiKeys: input.onOpenApiKeys,
    me: input.accountId,
    onStarted: (agentId) => mainRef.current?.onChoose({ agent: agentId }),
    keywords: dictationWords,
  });
  // An agent asked to start on a task the moment it starts, as an issue's
  // Start agent… asks, is the open task's own Start pressed once that task
  // stands open with its repository: it is handed the task's plan, on the
  // account's default choice, and its tab opens once it lands, while one
  // that did not start says why beside the task's Start.
  // Note that the ask goes once the developer leaves its task before it
  // could start, so coming back to the task later starts nothing unasked.
  const [agentAskedFor, setAgentAskedFor] = useState<string | undefined>(undefined);
  const askedTaskOpened = useRef(false);
  const pressStart = useRef(agents.start.onPress);
  pressStart.current = agents.start.onPress;
  const startable = agents.start.available && openDocument?.id === viewed.activeTaskId;
  useEffect(() => {
    if (agentAskedFor === undefined) return;
    if (viewed.activeTaskId !== agentAskedFor) {
      if (askedTaskOpened.current) setAgentAskedFor(undefined);
      return;
    }
    askedTaskOpened.current = true;
    if (!startable) return;
    setAgentAskedFor(undefined);
    pressStart.current();
  }, [agentAskedFor, viewed.activeTaskId, startable]);
  // The calls heard on the open task, each held past its end until the
  // record's copy catches up; a fixture's open task is drawn with its own
  // call's words.
  const reported = fixture === undefined ? voice.view : FIXTURE_TASKS_CALL;
  const [heard, setHeard] = useState<readonly HeardCall[]>([]);
  useEffect(() => {
    setHeard((held) =>
      heardCalls({
        held,
        voice: { callTaskId: reported.callTaskId, callTranscript: reported.callTranscript },
        taskId: viewed.activeTaskId,
        now: Date.now(),
      }),
    );
  }, [reported.callTaskId, reported.callTranscript, viewed.activeTaskId]);
  const transcript = transcriptRegion({
    transcript: viewed.transcript,
    heard,
    lukeEndedCall: voice.view.lukeEndedCall,
    readerId: input.accountId,
  });
  // A subagent's tab is held to the task's work as an agent's is to its agents.
  const workers = useMemo(
    () => workerCallIds(workRowsOf(viewed.conversation)),
    [viewed.conversation],
  );
  // An agent Luke started, archived, or brought back in the call moves in
  // the work before it moves in the list, so the list is read again as the
  // call answers, and the tab appears or leaves as it does after a Start or
  // an Archive; a call already in the work when the plan opens is read with
  // the plan.
  const startedByLuke = useMemo(() => agentListCallIds(viewed.conversation), [viewed.conversation]);
  const startsSeen = useRef<{ taskId: string | undefined; ids: ReadonlySet<string> }>({
    taskId: undefined,
    ids: new Set(),
  });
  const readAgents = agents.onRetryList;
  useEffect(() => {
    const seen = startsSeen.current;
    const taskId = viewed.activeTaskId;
    const landed = seen.taskId === taskId && startedByLuke.some((callId) => !seen.ids.has(callId));
    startsSeen.current = { taskId, ids: new Set(startedByLuke) };
    if (landed) readAgents();
  }, [startedByLuke, viewed.activeTaskId, readAgents]);
  // A call of Luke's that made a new task, or made, deleted, or filled a section, changes the
  // sidebar only once the tasks are read again, as one lands in the work of the task it was made on.
  const sidebarByLuke = useMemo(() => sidebarCallIds(viewed.conversation), [viewed.conversation]);
  const sidebarSeen = useRef<{ taskId: string | undefined; ids: ReadonlySet<string> }>({
    taskId: undefined,
    ids: new Set(),
  });
  useEffect(() => {
    const seen = sidebarSeen.current;
    const taskId = viewed.activeTaskId;
    const landed = seen.taskId === taskId && sidebarByLuke.some((callId) => !seen.ids.has(callId));
    sidebarSeen.current = { taskId, ids: new Set(sidebarByLuke) };
    if (landed) tell(ACT_KIND.TASKS_REFRESH);
  }, [sidebarByLuke, viewed.activeTaskId, tell]);
  // An Untitled task takes its first agent's title on the service, and the
  // window hears no push for a task's row, so the tasks are read again as an
  // agent of the open task first holds a title while it stands Untitled.
  // Note that a list read already holding a title is no title landing, so a
  // task opened on titled agents asks nothing.
  const agentTitled =
    agents.agents === undefined ? undefined : agents.agents.some((agent) => agent.title !== null);
  const openName =
    tasks.tasks.find((task) => task.id === viewed.activeTaskId)?.name ??
    (openDocument?.id === viewed.activeTaskId ? openDocument?.name : undefined);
  const untitled = openName === UNTITLED_TASK_NAME;
  const titledSeen = useRef<{ taskId: string | undefined; titled: boolean | undefined }>({
    taskId: undefined,
    titled: undefined,
  });
  useEffect(() => {
    const seen = titledSeen.current;
    const taskId = viewed.activeTaskId;
    const landed = seen.taskId === taskId && seen.titled === false && agentTitled === true;
    titledSeen.current = { taskId, titled: agentTitled };
    if (landed && untitled) tell(ACT_KIND.TASKS_REFRESH);
  }, [agentTitled, untitled, viewed.activeTaskId, tell]);
  // A file's tab is held to the files Luke showed on the task the same way.
  const files = useMemo(
    () => shownFiles(viewed.shownCode ?? []).map((ref) => ref.path),
    [viewed.shownCode],
  );
  const mainTabs = useMainTabs(
    fixture !== undefined,
    viewed.activeTaskId,
    agents.agentIds,
    agents.draft?.id,
    input.inboxWaiting.some((task) => task.taskId === viewed.activeTaskId),
    agents.heldIds,
  );
  mainRef.current = mainTabs;
  // A page's tab is held to the pages agents wrote for the task.
  const pages = useMemo(() => (viewed.pages ?? []).map((page) => page.id), [viewed.pages]);
  // While an agent's page stands, the panel is that agent's: its workers', its Changes', and its
  // Terminal's tabs, and nothing of the plan the host has open beneath it, which keeps its own.
  const pageAgent = agentView?.agentId;
  const pageAgents = useMemo(
    () => (pageAgent === undefined ? undefined : [pageAgent]),
    [pageAgent],
  );
  // The Inbox lists the listed workspace's items alone, so a choice another workspace's list made gives way with it.
  // Note that an agent's with no task is held to the listed workspace by the list itself, which lists its workspace's alone.
  const inboxAsked = inboxView?.chosen;
  const inboxChosen =
    inboxAsked !== undefined &&
    (!("taskId" in inboxAsked) ||
      inWorkspace([inboxAsked], tasks.tasks, listedWorkspaceId).length > 0)
      ? inboxAsked
      : undefined;
  // While the Inbox stands, the panel beside it is the chosen item's task's, or its agent's where it
  // has no task, as that agent's page's is: what the item opens there, its files, its task's pages,
  // and its agents' pull requests, and none of the fixed kinds, which the task's page draws.
  const inboxTask =
    inboxChosen !== undefined && "taskId" in inboxChosen ? inboxChosen.taskId : undefined;
  const inboxAgent =
    inboxChosen !== undefined && "agentId" in inboxChosen ? inboxChosen.agentId : undefined;
  const inboxPages = useInboxPages(inboxView === undefined ? undefined : inboxTask);
  const inboxPageIds = useMemo(
    () => (inboxPages.pages ?? NO_PAGES).map((page) => page.id),
    [inboxPages.pages],
  );
  const inboxAgents = useMemo(
    () => (inboxAgent === undefined ? NO_IDS : [inboxAgent]),
    [inboxAgent],
  );
  // The Issues list's panel is its peek's, which the list draws itself, beside no task.
  const issuesStand = standIn?.kind === STAND_IN.ISSUES;
  const sidePanel = useSidePanel(
    fixtureSidePanel(input.run),
    issuesStand
      ? ISSUES_PANEL
      : inboxView !== undefined
        ? { id: inboxTask ?? inboxAgent, holds: NO_HOLDS, bare: true }
        : pageAgents === undefined
          ? { id: viewed.activeTaskId, holds: taskHolds(viewed, transcript) }
          : { id: pageAgent, holds: NO_HOLDS },
    issuesStand
      ? NO_IDS
      : inboxView !== undefined
        ? inboxAgents
        : (pageAgents ?? mainTabs.openAgents),
    !issuesStand && inboxView === undefined && pageAgents === undefined ? workers : NO_IDS,
    !issuesStand && inboxView === undefined && pageAgents === undefined ? files : NO_IDS,
    issuesStand
      ? NO_IDS
      : inboxView !== undefined
        ? inboxPageIds
        : pageAgents === undefined
          ? pages
          : NO_IDS,
    // Note that the task's agents in the Inbox are its own read's (`desktop-inbox.tsx`), which the panel draws a Pull request tab by.
    issuesStand
      ? NO_IDS
      : inboxView !== undefined
        ? inboxAgent === undefined
          ? undefined
          : inboxAgents
        : (pageAgents ?? agents.agentIds),
  );
  // An agent, or its Pull request, pinned to the sidebar is named there as
  // its tab is named now, so a pin made before the agent had its title or its
  // pull request was read, or before a rename, catches up while its task is open.
  const pinLabels = useMemo(
    () => ({
      agents: new Map(
        (agents.agents ?? []).map((agent) => [agent.id, agentTabLabel(agent, agents.models)]),
      ),
      pullRequests: new Map(
        [...agents.pullRequests].map(([agentId, pullRequest]) => [
          agentId,
          pullRequestLabelOf(pullRequest),
        ]),
      ),
    }),
    [agents.agents, agents.models, agents.pullRequests],
  );
  const { onRenamePins } = sidePanel;
  useEffect(() => {
    if (viewed.activeTaskId !== undefined) onRenamePins(viewed.activeTaskId, pinLabels);
  }, [viewed.activeTaskId, pinLabels, onRenamePins]);
  // Main hears which agent's tab, or which task's Inbox, is on screen, and
  // neither while the tab is away, the version history stands in the task's
  // place, the side panel fills the window over the column, or the column
  // shows something else; a fixture's staged agents are no one's to announce.
  // The window's Inbox stands in the column's place, showing the task whose item is chosen there.
  const columnShown =
    shown &&
    historyFor === undefined &&
    standIn === undefined &&
    fixture === undefined &&
    !sidePanel.fullScreen;
  // The task's Chat tab on screen is its plan channel read, as the window's Chat on a channel is.
  const tabChannel =
    columnShown && mainTabs.tab === MAIN_TAB.CHAT
      ? liveChat.chat?.channels.find(
          (channel) => channel.kind === CHANNEL_KIND.TASK && channel.planId === viewed.activeTaskId,
        )?.id
      : undefined;
  if (tabChannel !== tabReading) setTabReading(tabChannel);
  // An agent's page stands in the task's place, showing its agent as its tab would.
  const shownAgent =
    shown && fixture === undefined && agentView !== undefined
      ? agentView.agentId
      : columnShown && isAgentTab(mainTabs.tab)
        ? mainTabs.tab.agent
        : null;
  const shownInbox =
    shown && fixture === undefined && inboxView !== undefined
      ? inboxChosen !== undefined && "taskId" in inboxChosen
        ? inboxChosen.taskId
        : null
      : columnShown && mainTabs.tab === MAIN_TAB.INBOX
        ? (viewed.activeTaskId ?? null)
        : null;
  // Chat on screen is where what waits in it is read, so main announces none of that then: the
  // window's Chat reads the listed workspace's every channel, and a task's Chat tab only its plan's.
  const chatShown: ChatShown | null =
    !shown || listedWorkspace === undefined
      ? null
      : standIn?.kind === STAND_IN.CHAT
        ? { workspaceId: listedWorkspace.id, taskId: null }
        : columnShown && mainTabs.tab === MAIN_TAB.CHAT && viewed.activeTaskId !== undefined
          ? { workspaceId: listedWorkspace.id, taskId: viewed.activeTaskId }
          : null;
  const chatShownWorkspace = chatShown?.workspaceId ?? null;
  const chatShownTask = chatShown?.taskId ?? null;
  const reportedTab = useRef<
    | {
        agentId: string | null;
        inboxTaskId: string | null;
        chatShownWorkspace: string | null;
        chatShownTask: string | null;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const was = reportedTab.current;
    if (
      was?.agentId === shownAgent &&
      was.inboxTaskId === shownInbox &&
      was.chatShownWorkspace === chatShownWorkspace &&
      was.chatShownTask === chatShownTask
    ) {
      return;
    }
    reportedTab.current = {
      agentId: shownAgent,
      inboxTaskId: shownInbox,
      chatShownWorkspace,
      chatShownTask,
    };
    tell(ACT_KIND.CODING_AGENTS_SHOWN, {
      agentId: shownAgent,
      inboxTaskId: shownInbox,
      chatShown:
        chatShownWorkspace === null
          ? null
          : { workspaceId: chatShownWorkspace, taskId: chatShownTask },
    });
  }, [shownAgent, shownInbox, chatShownWorkspace, chatShownTask, tell]);
  // Note that the Inbox's choice is remembered as it is made, so leaving the Inbox and coming back stands on it.
  useEffect(() => {
    if (inboxChosen !== undefined) {
      lastInboxChoice.current = {
        account: input.account,
        workspaceId: listedWorkspaceId,
        chosen: inboxChosen,
      };
    }
  }, [inboxChosen, input.account, listedWorkspaceId]);

  // The tab showing is what asks the host to read the tasks again; the open
  // task and its call stand through it going away, and a call's drafts reach
  // the document without any read. A fixture's tasks are read from nowhere.
  const reading = shown && signedIn && fixture === undefined;
  const wasReading = useRef(false);
  useEffect(() => {
    if (reading === wasReading.current) return;
    wasReading.current = reading;
    if (reading) tell(ACT_KIND.TASKS_REFRESH);
  }, [reading, tell]);

  // The host answers a press a round trip later, so where the tab is bound
  // is said at once, and a select that did not open the task takes its ask
  // back. A fixture's tasks are opened nowhere, so nothing is asked of them.
  const openTaskId = tasks.activeTaskId;
  const boundFor = asked !== undefined && asked.over === openTaskId ? asked.taskId : openTaskId;
  // The version history is the task's, so another task, or none, leaves it.
  if (historyFor !== undefined && historyFor.taskId !== boundFor) setHistoryFor(undefined);
  // A plan the service would not hand the reader has no history to show, so its Not found stands in the history's place, as a version's link may ask for one.
  const historyOpen =
    historyFor !== undefined &&
    historyFor.taskId === boundFor &&
    region.kind !== DOCUMENT_REGION.MISSING;
  // A reveal is the open task's, so another task opening drops it, and
  // coming back asks nothing of the visit after.
  if (reveal !== undefined && reveal.taskId !== boundFor) setReveal(undefined);
  const revealing = reveal !== undefined && reveal.taskId === boundFor ? reveal.source : undefined;
  // A pin stays chosen while its task stays open, whichever of its tabs is
  // shown: once its task opens it is held there, and any other task opening
  // lets it go. Note that this reads the task open rather than the one asked
  // for, because an ask the host refuses leaves the pin chosen.
  if (chosen !== undefined && openTaskId !== chosen.over) {
    setChosen(openTaskId === chosen.pin.task ? { pin: chosen.pin, over: openTaskId } : undefined);
  }
  // An answer clears the ask it answers, never one made since.
  const revealed = () => setReveal((held) => (held === reveal ? undefined : held));
  const listedId = listedWorkspace?.id;
  const tasksNow = tasks.tasks;
  const workspacesNow = viewed.workspaces;
  // The task last open in each workspace, which a switch to it opens again.
  const lastOpenIn = useRef(new Map<string, string>());
  const openWorkspaceId = tasksNow.find((task) => task.id === openTaskId)?.workspaceId;
  useEffect(() => {
    if (openTaskId !== undefined && openWorkspaceId !== undefined) {
      lastOpenIn.current.set(openWorkspaceId, openTaskId);
    }
  }, [openTaskId, openWorkspaceId]);
  // Opening a task, or leaving one, is leaving the window's Inbox for it.
  // Note that `onOpened` runs only once the task opened, because a task that
  // would not open must not leave the sidebar on another workspace, this
  // launch or the next.
  const openTask = useCallback(
    (taskId: string, onOpened: () => void, onRefused: () => void = () => undefined) => {
      setStandIn(undefined);
      const ask = { taskId, over: openTaskId };
      const withdraw = () => {
        setAsked((held) => (held === ask ? undefined : held));
        onRefused();
      };
      if (fixture === undefined) setAsked(ask);
      act(ACT_KIND.TASKS_SELECT, { taskId }).then((opened) => {
        if (!opened) {
          withdraw();
          return;
        }
        onOpened();
      }, withdraw);
    },
    [act, fixture, openTaskId],
  );
  // A leave is asked rather than told, so a refused one takes its ask back too.
  const leaveTask = useCallback(() => {
    setStandIn(undefined);
    if (fixture !== undefined) return;
    const ask = { taskId: undefined, over: openTaskId };
    setAsked(ask);
    act(ACT_KIND.TASKS_CLOSE).catch(() => setAsked((held) => (held === ask ? undefined : held)));
  }, [act, fixture, openTaskId]);
  // Every navigation a press asked for, counted, so an answer that lands
  // after a newer one was asked for changes nothing the newer one decided.
  const navigations = useRef(0);
  // A workspace chosen on purpose, from the switcher, a workspace made, or
  // one left, is listed at once, and the task on screen follows: the task
  // last open there opens again, where it is still that workspace's and not
  // archived, or else the home page, so the task on screen is the listed
  // workspace's. A remembered task that would not open gives way to the home
  // page, unless the developer went somewhere else meanwhile.
  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      navigations.current += 1;
      const mine = navigations.current;
      chooseListed(workspaceId);
      if (openWorkspaceId === undefined || openWorkspaceId === workspaceId) return;
      const last = lastOpenIn.current.get(workspaceId);
      const reopens = tasksNow.some(
        (task) =>
          task.id === last && task.workspaceId === workspaceId && task.archivedAt === undefined,
      );
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
  // What the window lists and shows now, which a switch toast's Back reads
  // as it is pressed rather than as the toast was raised.
  const standingNow = useRef({ listed: listedId, open: openTaskId });
  standingNow.current = { listed: listedId, open: openTaskId };
  // A task opened from another workspace, from the palette, the Inbox, a
  // notice, or the history, lists its workspace once it opened, so the
  // sidebar holds the task open, and says so in a toast whose Back lists the
  // workspace left and returns to what stood open there. An open answered
  // after the developer went somewhere else lists nothing, and Back does
  // nothing once the window has moved on from the switch it reports.
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
          tone: TOAST_TONE.DONE,
          action: { label: backNote(from.name), onPress: back },
        });
      });
    },
    [tasksNow, workspacesNow, listedId, openTaskId, openTask, chooseListed, toast, leaveTask],
  );

  // A fixture's tasks are deleted nowhere, as they are read from nowhere. A
  // delete that landed says so in a toast, since its dialog has closed; a
  // refusal is said in the dialog that asked, unless the tab went away while
  // the delete was out and took the dialog with it.
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const deleteTask = async (taskId: string): Promise<ActionResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await act(ACT_KIND.TASKS_DELETE, { taskId }).catch(() => false);
    if (deleted) {
      toast({ words: TASK_DELETED_NOTE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    }
    if (!shownNow.current) {
      toast({ words: DELETE_REFUSED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    }
    return DELETE_REFUSED;
  };

  // A fixture's tasks are renamed nowhere, as they are read from nowhere.
  const renameTask = async (taskId: string, name: string): Promise<boolean> => {
    if (fixture !== undefined) return false;
    setRenames((held) => new Map(held).set(taskId, name));
    const renamed = await act(ACT_KIND.TASKS_RENAME, { taskId, name }).catch(() => false);
    if (!renamed) {
      setRenames((held) =>
        held.get(taskId) === name
          ? new Map([...held].filter(([pending]) => pending !== taskId))
          : held,
      );
    }
    return renamed;
  };

  // The open task as it stands when an archive is answered, which may be
  // another than the one open when it was pressed.
  const openNow = useRef(openTaskId);
  openNow.current = openTaskId;

  // A fixture's tasks are marked nowhere, as they are read from nowhere. A
  // refusal puts back the mark it drew only while no later press replaced it,
  // and says so in a toast, since the menu that asked has closed. An archive
  // that landed, or an unarchive, says so with an Undo, which marks the task
  // back and opens it again if the archive had left it; an undoing says
  // nothing of its own unless it is refused. Note that the open task is left
  // only once its archive is answered, because leaving ends its call, which a
  // refusal could not give back, nor can an Undo.
  const markTask = (taskId: string, mark: TaskMark, undoing?: { reopen: boolean }) => {
    if (fixture !== undefined) return;
    const next = { ...marks.get(taskId), ...pendingMark(mark, Date.now()) };
    setMarks((held) => new Map(held).set(taskId, next));
    const pinning = mark === TASK_MARK.PIN || mark === TASK_MARK.UNPIN;
    const asked = pinning
      ? act(ACT_KIND.TASKS_PIN, { taskId, pinned: mark === TASK_MARK.PIN })
      : act(ACT_KIND.TASKS_ARCHIVE, { taskId, archived: mark === TASK_MARK.ARCHIVE });
    asked
      .catch(() => false)
      .then((changed) => {
        if (!changed) {
          setMarks((held) =>
            held.get(taskId) === next
              ? new Map([...held].filter(([pending]) => pending !== taskId))
              : held,
          );
          toast({
            words: MARK_FAILED_NOTES[mark],
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          });
          return;
        }
        const left = mark === TASK_MARK.ARCHIVE && openNow.current === taskId;
        if (left) leaveTask();
        if (undoing?.reopen) selectNow.current(taskId);
        if (pinning || undoing !== undefined) return;
        const { note, undo } = MARK_UNDOS[mark];
        toast({
          words: note,
          tone: TOAST_TONE.DONE,
          action: {
            label: UNDO_LABEL,
            onPress: () => markNow.current(taskId, undo, { reopen: left }),
          },
        });
      });
  };
  // A fixture's repositories are pinned nowhere, as its tasks are marked
  // nowhere. A pin says nothing once it lands, since the group it moves is
  // in sight; a refusal puts the group back only while no later press
  // replaced it, and says so in a toast, since the menu that asked has closed.
  const pinRepository = (repository: string, pinned: boolean) => {
    if (fixture !== undefined) return;
    const next: PendingRepositoryPin = { pinned, at: Date.now() };
    setRepositoryPins((held) => new Map(held).set(repository, next));
    act(ACT_KIND.TASKS_PIN_REPOSITORY, { repository, pinned })
      .catch(() => false)
      .then((changed) => {
        if (changed) return;
        setRepositoryPins((held) =>
          held.get(repository) === next
            ? new Map([...held].filter(([pending]) => pending !== repository))
            : held,
        );
        toast({
          words: pinned ? REPOSITORY_PIN_FAILED_NOTES.PIN : REPOSITORY_PIN_FAILED_NOTES.UNPIN,
          tone: TOAST_TONE.FAILED,
          hold: TOAST_HOLD.FAILED,
        });
      });
  };

  // Each agent's pins in flight, the newest last, which the next waits on,
  // each answering whether it landed, or nothing where it was never asked.
  const agentPinFlights = useRef(new Map<string, Promise<boolean | undefined>>());
  // The account signed in now, which a pin waiting its turn must still be pressed under.
  const accountNow = useRef(input.account);
  accountNow.current = input.account;
  // A fixture's agents are pinned nowhere, as its plans are marked nowhere. A
  // pin says nothing once it lands, since the row it moves is in sight; a
  // refusal puts the row back only while no later press replaced it, and
  // says so in a toast, since the menu that asked has closed. Note that one
  // agent's pins are asked one after another, because each writes as it
  // lands, so a Pin and an Unpin pressed together landing out of order would
  // leave standing the one not pressed last. One still waiting when the
  // account changes is never asked, since a pin is its presser's own and
  // would land on whoever signed in since; the sign-out already let go of
  // what it drew.
  const pinAgent = (agentId: string, pinned: boolean) => {
    if (fixture !== undefined) return;
    const next = { pinned, at: Date.now() };
    setAgentPins((held) => new Map(held).set(agentId, next));
    const flights = agentPinFlights.current;
    const pressedBy = input.account;
    const asked = (flights.get(agentId) ?? Promise.resolve(true)).then(() =>
      accountNow.current === pressedBy
        ? act(ACT_KIND.CODING_AGENTS_PIN, { agentId, pinned }).then(
            (answer) => "agent" in answer,
            () => false,
          )
        : undefined,
    );
    flights.set(agentId, asked);
    asked.then((changed) => {
      if (flights.get(agentId) === asked) flights.delete(agentId);
      if (changed !== false) return;
      setAgentPins((held) =>
        held.get(agentId) === next
          ? new Map([...held].filter(([pending]) => pending !== agentId))
          : held,
      );
      toast({
        words: pinned ? AGENT_PIN_FAILED_NOTES.PIN : AGENT_PIN_FAILED_NOTES.UNPIN,
        tone: TOAST_TONE.FAILED,
        hold: TOAST_HOLD.FAILED,
      });
    });
  };

  // A fixture's pins are moved nowhere, as they are pinned nowhere. A drop
  // stands at once, and each pin it gave a place is asked of the service: a
  // plan's through the host, which asks one change at a time, and an agent's
  // after that agent's pins already in flight, as a pin waits, and never
  // under an account signed in since. A place answered is let go with the
  // next view, which carries it or a later drag from another Mac. A refusal
  // puts back only the places no later drop replaced, and whatever else the
  // drop placed on this Mac alone (`putBack`), and says so once for the
  // drop, since the pointer that asked has let go.
  const movePins = (moves: readonly PinMove[], putBack?: () => void) => {
    if (fixture !== undefined || moves.length === 0) return;
    setPinPositions(
      (held) =>
        new Map([
          ...held,
          ...moves.map(({ id, position }) => [id, { position, answered: false }] as const),
        ]),
    );
    const pressedBy = input.account;
    const settle = (id: string, position: string, changed: boolean | undefined) =>
      setPinPositions((held) => {
        const place = held.get(id);
        if (place?.position !== position) return held;
        const next = new Map(held);
        if (changed === false) next.delete(id);
        else next.set(id, { position, answered: true });
        return next;
      });
    const asked = moves.map(({ agent, id, position }) => {
      const flights = agentPinFlights.current;
      const flight: Promise<boolean | undefined> = agent
        ? (flights.get(id) ?? Promise.resolve(true)).then(() =>
            accountNow.current === pressedBy
              ? act(ACT_KIND.CODING_AGENTS_PIN, { agentId: id, pinned: true, position }).then(
                  (answer) => "agent" in answer,
                  () => false,
                )
              : undefined,
          )
        : act(ACT_KIND.TASKS_PIN, { taskId: id, pinned: true, position }).catch(() => false);
      if (agent) flights.set(id, flight);
      return flight.then((changed) => {
        if (agent && flights.get(id) === flight) flights.delete(id);
        settle(id, position, changed);
        return changed;
      });
    });
    Promise.all(asked).then((answers) => {
      if (!answers.includes(false)) return;
      putBack?.();
      toast({ words: PIN_MOVE_FAILED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    });
  };

  // Each change to the sections waits on the one before it, so the service
  // takes them in the order they were drawn. A fixture run draws them and
  // sends none, so its sections stand as dragged until it ends.
  const sectionFlight = useRef<Promise<unknown>>(Promise.resolve());
  const writeSections = (writes: readonly TaskSectionWrite[]) => {
    const now = Date.now();
    const pending = writes.map((write): PendingSectionWrite => ({ write, at: now }));
    if (pending.length === 0) return;
    setSectionWrites((held) => [...held, ...pending]);
    if (fixture !== undefined) return;
    const pressedBy = input.account;
    for (const each of pending) {
      const flight = sectionFlight.current.then(() =>
        accountNow.current === pressedBy
          ? act(ACT_KIND.TASKS_WRITE_SECTION, each.write).catch(() => false)
          : undefined,
      );
      sectionFlight.current = flight;
      flight.then((changed) => {
        setSectionWrites((held) => held.filter((one) => one !== each));
        if (changed === false) {
          toast({
            words: SECTION_WRITE_FAILED_NOTE,
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          });
        }
      });
    }
  };

  // Several tasks archived at once answer with one toast rather than one
  // each, so its Undo brings back every task the service kept, and opens
  // again the open task where the archive left it. A task the service
  // refused goes back where it was, and the toast counts it. Note that the
  // tasks share one stamp, because they were archived by one press, so they
  // stand under Archived in the order they were listed rather than in an
  // order set by whether the clock ticked between two of them.
  const archiveTasks = (taskIds: readonly string[]) => {
    if (fixture !== undefined || taskIds.length === 0) return;
    const at = Date.now();
    const asked = taskIds.map((taskId) => ({
      taskId,
      next: { ...marks.get(taskId), ...pendingMark(TASK_MARK.ARCHIVE, at) },
    }));
    setMarks(
      (held) => new Map([...held, ...asked.map(({ taskId, next }) => [taskId, next] as const)]),
    );
    const answers = asked.map(({ taskId }) =>
      act(ACT_KIND.TASKS_ARCHIVE, { taskId, archived: true }).catch(() => false),
    );
    Promise.all(answers).then((changed) => {
      const refused = asked.filter((_, index) => !changed[index]);
      const landed = asked.filter((_, index) => changed[index]).map(({ taskId }) => taskId);
      setMarks(
        (held) =>
          new Map(
            [...held].filter(([pending, mark]) =>
              refused.every((each) => each.taskId !== pending || each.next !== mark),
            ),
          ),
      );
      if (landed.length === 0) {
        toast({
          words: archiveTasksFailedNote(refused.length),
          tone: TOAST_TONE.FAILED,
          hold: TOAST_HOLD.FAILED,
        });
        return;
      }
      const left = landed.find((taskId) => taskId === openNow.current);
      if (left !== undefined) leaveTask();
      toast({
        words: archivedTasksNote(landed.length, refused.length),
        tone: TOAST_TONE.DONE,
        action: {
          label: UNDO_LABEL,
          onPress: () => {
            for (const taskId of landed) {
              markNow.current(taskId, TASK_MARK.UNARCHIVE, { reopen: taskId === left });
            }
          },
        },
      });
    });
  };
  // An Undo is pressed renders after its archive landed, so it marks, and
  // opens, through the tab as it stands then rather than as it stood.
  const markNow = useRef(markTask);
  markNow.current = markTask;
  const restoring = useLastTask({
    staged: fixture !== undefined,
    account: input.account,
    tasks: tasks.tasks,
    listStatus: tasks.listStatus,
    openTaskId,
    boundFor,
    select,
  });
  const selectNow = useRef(select);
  selectNow.current = select;

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(planMarkdown(region.task), TASK_COPIED_NOTE);
  };

  const microphone = microphoneButton({
    voiceAvailable: input.voiceAvailable,
    microphoneStatus: input.microphoneStatus,
    activeTaskId: tasks.activeTaskId,
    archived: region.kind === DOCUMENT_REGION.READY && region.task.archivedAt !== undefined,
    listening: voice.listening,
    callTaskId: voice.view.callTaskId,
    voiceStatus: voice.view.voiceStatus,
  });
  const live = callInProgress(voice.view) && voice.view.callTaskId === tasks.activeTaskId;
  // A press that would open a call here while one stands about another task
  // ends that call, so it asks first; the answer is the same Talk press, and
  // Cancel leaves the call standing as it was. The talk key never asks: it
  // speaks into the call standing, whatever task is open. The question is the
  // task's it was asked on, so it goes the moment another task opens (the
  // press would talk about whichever task the host has open), and its surface
  // is the task's page, which a version history covers.
  const callElsewhere = callInProgress(voice.view) && voice.view.callTaskId !== tasks.activeTaskId;
  const [askedFor, setAskedFor] = useState<string>();
  const secondCallFor = callElsewhere && askedFor !== undefined ? askedFor : undefined;
  const secondCall = useConfirmDialog(
    { subject: secondCallFor === tasks.activeTaskId, surfaceOpen: shown && !historyOpen },
    () =>
      act(ACT_KIND.TASKS_TALK).then(
        (): ActionResult => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
        (refused: Error): ActionResult => ({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: refused.message,
        }),
      ),
  );
  // A started task asks once it is the task open, which the host may say
  // only after the start's own answer has come back.
  const askOnOpen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (askOnOpen.current === undefined || askOnOpen.current !== secondCallFor) return;
    if (secondCallFor !== tasks.activeTaskId) return;
    askOnOpen.current = undefined;
    secondCall.ask();
  });
  const callingNow = useRef(callElsewhere);
  callingNow.current = callElsewhere;
  // The press names no task: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that task or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) {
      if (!callElsewhere) tell(ACT_KIND.TASKS_TALK);
      else {
        setAskedFor(tasks.activeTaskId);
        secondCall.ask();
      }
    }
  };

  // A fixture's staged task has nothing arriving on it, and code arrives
  // only on a call, since what a task opens with it already held.
  const arrivedTabs = usePanelArrivals({
    // Note that nothing arrives while an agent's page holds the panel, so the plan's visit ends, and what it gained meanwhile counts as seen.
    taskId: fixture === undefined && pageAgent === undefined ? tasks.activeTaskId : undefined,
    board: tasks.board,
    code: live ? (tasks.shownCode ?? []) : undefined,
    pages: live ? (tasks.pages ?? NO_PAGES) : undefined,
    panel: sidePanel,
  });
  // An agent that ended unseen marks its tab unread as an arrival does; main
  // clears it once the tab is shown.
  const unreadTabs: readonly StripTab[] = [
    ...arrivedTabs,
    ...input.unseenAgents.map((agent) => ({ agent })),
  ];

  // A fixture's repositories are read from nowhere, as its tasks are. The
  // chip lists the repositories of the workspace its task is in: the open
  // task's, else the one New task starts in.
  const repositoriesOf =
    region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : listedWorkspace?.id;
  const openGitHub = (url: string) => appPlatform().openGitHub(url);
  /**
   * The repository chip's list for one workspace: the repositories its tasks
   * were about lately that its GitHub reaches, newest first, so a task never
   * starts on another workspace's nor on one a task stranded there by #2524
   * still names; a read of every repository its GitHub reaches; whether the
   * account manages it, so can connect its GitHub; and whether it has a
   * GitHub connected, so a read finding none installed says GitHub removed
   * or suspended it. A workspace not yet read is taken as managed, so the
   * chip still points somewhere, and its recent repositories are left to the
   * service's read to judge.
   */
  const repositoriesIn = (workspaceId: string | undefined): RepositoryChooser => {
    const workspace = viewed.workspaces.find((each) => each.id === workspaceId);
    const own =
      workspaceId === undefined
        ? tasks.tasks
        : tasks.tasks.filter((task) => task.workspaceId === workspaceId);
    // Note that the tasks are filtered before the recent ones are counted,
    // because a few newer stranded tasks would otherwise crowd out an older
    // repository the workspace does reach.
    const offered =
      workspace === undefined
        ? own
        : own.filter(
            (task) => task.repository !== null && workspaceReaches(workspace, task.repository),
          );
    return {
      recent: recentRepositories(offered),
      read: () =>
        fixture !== undefined
          ? Promise.resolve(fixtureRepositories(workspaceId))
          : act(
              ACT_KIND.TASKS_REPOSITORIES,
              workspaceId === undefined ? {} : { workspaceId },
            ).catch(() => ({ failure: TASK_CALL_FAILURE.UNANSWERED })),
      openGitHub,
      pictures: fixture === undefined,
      scope: workspaceId,
      manages: workspace === undefined || managesWorkspace(workspace),
      ...(workspace === undefined ? undefined : { workspaceName: workspace.name }),
      ...(workspace?.github == null ? undefined : { connected: true }),
    };
  };
  // A fixture's GitHub is connected nowhere. Connecting opens the service's
  // page, and the connection arrives on the view once the panel comes forward
  // again; disconnecting asks the service under the Mac's session, and the
  // view takes the answer at once. A refusal of either says why in a toast.
  const accountGitHub = (
    kind: typeof ACT_KIND.GITHUB_CONNECT | typeof ACT_KIND.GITHUB_DISCONNECT,
  ): Promise<boolean> => {
    if (fixture !== undefined) return Promise.resolve(false);
    return act(kind).then(
      () => true,
      (refused: Error) => {
        toast({ words: refused.message, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
        return false;
      },
    );
  };
  // A fixture's workspaces are made, shared, and connected nowhere. A
  // workspace made is listed at once, main's view holding it after; the
  // invite and the connect open the browser, and a refusal of either says
  // why in a toast, since the menu that asked has closed.
  const createWorkspace = (name: string): Promise<string | undefined> => {
    if (fixture !== undefined) return Promise.resolve(undefined);
    return act(ACT_KIND.WORKSPACE_CREATE, { name }).then(
      (created) => {
        switchWorkspace(created.id);
        return undefined;
      },
      (refused: Error) => refused.message,
    );
  };

  // A fixture's tasks are given no repository, as they are read from nowhere.
  const setRepository = (
    taskId: string,
    repository: string | null,
  ): Promise<string | undefined> => {
    if (fixture !== undefined) return Promise.resolve(undefined);
    return act(ACT_KIND.TASKS_SET_REPOSITORY, { taskId, repository }).then(
      (answer) => ("failure" in answer ? repositoryFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );
  };

  // A fixture's tasks move nowhere, as they are read from nowhere. Note that
  // the workspace moves with the task, because the sidebar lists one
  // workspace's tasks and the open task must not drop out of it, but only
  // while that task is still open and no workspace was chosen since, so a
  // move answered late never undoes where the developer went meanwhile.
  const moveTask = (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ): Promise<boolean> => {
    if (fixture !== undefined) return Promise.resolve(false);
    const choicesThen = workspaceChoices.current;
    return act(ACT_KIND.TASKS_MOVE, { taskId, workspaceId })
      .catch(() => ({ failure: TASK_CALL_FAILURE.UNANSWERED }) as const)
      .then((answer) => {
        if (!("failure" in answer)) {
          // A first workspace read landing meanwhile lists one too, but nobody chose it.
          if (openNow.current === taskId && workspaceChoices.current === choicesThen) {
            listWorkspace(answer.workspaceId);
          }
          return true;
        }
        if (told?.quiet !== true) {
          toast({ words: MOVE_REFUSED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
        }
        return false;
      });
  };

  // A fixture's tasks are read from nowhere, so an edit of one is never saved.
  const edit = (taskId: string, request: PlanEditRequest): Promise<TasksEditAnswer> => {
    if (fixture !== undefined) return Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });
    return act(ACT_KIND.TASKS_EDIT, { taskId, edit: request });
  };

  // The chip's menu stands on the open task's toolbar, so another task's is
  // opened first; the ask is counted so each press opens it again.
  const changeRepository = (taskId: string) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setRepositoryMenu((held) => ({ taskId, request: (held?.request ?? 0) + 1 }));
  };

  const repositoryOf = (taskId: string): string | null =>
    tasks.tasks.find((task) => task.id === taskId)?.repository ??
    (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
      ? region.task.repository
      : null);

  // A fixture's task has no history, as it is read from nowhere.
  const historySource = useMemo(
    (): PlanHistorySource => ({
      readPage: (taskId, before) =>
        act(ACT_KIND.TASKS_REVISIONS, {
          taskId,
          ...(before === undefined ? undefined : { before }),
        }),
      readRevision: (taskId, seq) => act(ACT_KIND.TASKS_REVISION, { taskId, seq }),
      restore: (taskId, seq) => act(ACT_KIND.TASKS_RESTORE, { taskId, seq }),
    }),
    [act],
  );
  const history = usePlanHistory({
    source: historySource,
    taskId:
      fixture === undefined && region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined,
    editedAt: region.kind === DOCUMENT_REGION.READY ? region.task.lastEdit?.at : undefined,
    name: region.kind === DOCUMENT_REGION.READY ? region.task.name : undefined,
    shown: shown && historyOpen,
    seek: historyFor?.save,
    returnTo: historyFor?.spot,
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) => sayRestored(toast, undo),
  });

  // A started task becomes the host's open one, which turns the page to it,
  // so the dialog closes and the Inbox or a version history standing behind
  // it gives way. It opens with the side panel hidden, since it has nothing
  // in it yet. Note that the panel is hidden as the start is sent, while the
  // modal dialog stands over it, because the host turns to the new plan
  // before the start answers, and a hide on the answer would close a panel
  // opened on the new plan since; a refusal shows it again as it stood.
  // It starts in the chosen workspace; with none listed the
  // service starts it in the account's first one. A name left blank is not
  // sent, and the plan stands as Untitled. A start opens its
  // task's call at once, except over a call standing about another task,
  // which main leaves for this question to end or keep. A start without
  // planning opens no call, so it asks nothing about the one standing; it
  // names its planning only where it is off, so a request with planning is
  // the one every service has read. New task's Agent mode hands the task it
  // started a draft agent holding the prompt, files, and model, and opens
  // the task on that draft's tab, which starts the agent at once, so a
  // refused agent leaves the words in that tab's box with why and Retry.
  const startTask = (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    planning: boolean,
    from: NewTaskStart = {},
  ): Promise<string | undefined> => {
    const panelWasOpen = sidePanel.open;
    sidePanel.onSetOpen(false);
    const refusedWith = (note: string): string => {
      if (panelWasOpen) sidePanel.onSetOpen(true);
      return note;
    };
    return act(ACT_KIND.TASKS_START, {
      ...(name.length === 0 ? undefined : { name }),
      ...(repository === null ? undefined : { repository }),
      ...(workspaceId === undefined ? undefined : { workspaceId }),
      ...(from.linearIssueId === undefined ? undefined : { linearIssueId: from.linearIssueId }),
      ...(from.issueId === undefined ? undefined : { issueId: from.issueId }),
      ...(planning ? undefined : { planning }),
    }).then(
      (answer) => {
        if ("failure" in answer) return refusedWith(startFailureNote(answer.failure));
        setNewTaskAsk(undefined);
        setStandIn(undefined);
        setHistoryFor(undefined);
        if (planning && callingNow.current) {
          askOnOpen.current = answer.planId;
          setAskedFor(answer.planId);
        }
        if (from.agent === true) {
          askedTaskOpened.current = false;
          setAgentAskedFor(answer.planId);
        }
        // An agent handed over starts from a draft the task is handed, its tab
        // the one the task opens on, so a refusal leaves the words there with Retry.
        if (from.handed !== undefined) {
          const draftId = crypto.randomUUID();
          agents.onHandDraft(answer.planId, { id: draftId, ...from.handed });
          mainTabs.onShow(answer.planId, { draft: draftId });
        }
        return undefined;
      },
      (refused: Error) => refusedWith(refused.message),
    );
  };

  // The dialog matches its name against the Linear issues of the workspace
  // it starts in, and searches them, where that workspace has Linear connected.
  const linearIssuesIn: TasksControl["newTask"]["linearIssuesIn"] = (workspaceId) => {
    const linked = viewed.workspaces.find((each) => each.id === workspaceId);
    if (linked?.linear?.active !== true) return undefined;
    return (ask) => act(ACT_KIND.WORKSPACE_LINEAR_ISSUES, { ...ask, workspaceId: linked.id });
  };

  // New task opens the dialog over whatever stands, an open task and its
  // call included, which stay until a task is started. Note that a press
  // while the dialog stands, as the menu bar's still can, leaves it as it is,
  // because a fresh ask would keep the card's draft under another preset.
  const newTaskWith = (preset: TasksControl["newTask"]["preset"]) =>
    setNewTaskAsk((standing) => standing ?? { preset });
  // The dialog is the Tasks tab's, so Settings taking the window puts it
  // away rather than leaving it to stand again on the way back.
  if (!shown && newTaskAsk !== undefined) setNewTaskAsk(undefined);

  // A plan's version history opens over the task, so another task opens first.
  const openHistory = (opening: HistoryOpening) => {
    if (opening.taskId !== boundFor) select(opening.taskId);
    setStandIn(undefined);
    setHistoryFor(opening);
  };

  // A task's own tab, its Inbox, and an agent's are in its column, so a
  // version history over it gives way, and so does a side panel filling the
  // window over it.
  const showColumnTab = (taskId: string, tab: MainTab) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(taskId, tab);
  };

  // A tab of the side panel, on its plan, out from under a version history or whatever stands in the plan's place.
  const showPanelTab = (taskId: string, tab: SidePanelTab) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    sidePanel.onShow(taskId, tab);
  };

  // Note that a pull request two of the open task's agents share opens in the tab already open on it, whichever agent it stands under, as the panel's own door picks it (`changesTabOf`), so a link never stands a second tab on one pull request.
  // Only a tab the task draws is taken, its agent one of the task's agents at hand: not an archived agent's, nor one of a page the panel stands beside instead.
  const sharedChangesAgent = (planId: string, agentId: string): string => {
    const url = planId === tasks.activeTaskId ? agents.pullRequests.get(agentId)?.url : undefined;
    if (url === undefined) return agentId;
    const drawn = agents.agentIds ?? [];
    const open = sidePanel.changes.find(
      (tab) => drawn.includes(tab.changes) && agents.pullRequests.get(tab.changes)?.url === url,
    );
    return open?.changes ?? agentId;
  };

  // A link's workspace, by its slug or its id, listed where the account is in it and another is listed; answers the workspace listed after it.
  const listLinked = (workspace: string): string | undefined => {
    const home = viewed.workspaces.find((each) => each.slug === workspace || each.id === workspace);
    if (home !== undefined && home.id !== listedWorkspace?.id) chooseListed(home.id);
    return home?.id ?? listedWorkspace?.id;
  };

  // A version's Open lands where its writer wrote it: an agent's tab as a
  // notification opens it, or the side panel's Call tab, asked to
  // bring the call or the turn into view once it draws.
  const showSource = (taskId: string, source: RevisionSource) => {
    if (source.kind === REVISION_SOURCE.AGENT) {
      showColumnTab(taskId, { agent: source.agentId });
      return;
    }
    setReveal({ taskId, source });
    showPanelTab(taskId, SIDE_PANEL_TAB.CALL);
  };

  // Each ask is its own, so the same section asked twice scrolls twice.
  const showMention = (mention: PlanMention) => {
    showColumnTab(mention.taskId, MAIN_TAB.PLAN);
    const anchor = mention.kind === MENTION_KIND.SECTION ? mention.anchor : undefined;
    sectionAsks.current += 1;
    setSectionReveal({ taskId: mention.taskId, reveal: { anchor, ask: sectionAsks.current } });
  };

  // What stands in the plan's place for a link, a version history there giving way, as each one's own door does.
  const standInFor = (standing: StandIn) => {
    setHistoryFor(undefined);
    setStandIn(standing);
  };

  /**
   * A Luke link's place opened through the door each kind already has: the
   * task's tabs, its side panel, its version history, or what stands in the
   * plan's place. One of an agent's messages opens the agent's tab and asks
   * it to bring the message into view. Note
   * that nothing is checked here: a place the account cannot read is read
   * all the same, and its read says it is not there.
   */
  const openLink = ({ workspace, place }: ReadLink) => {
    switch (place.kind) {
      case LINK_PLACE.TASK:
        showMention({ kind: MENTION_KIND.TASK, taskId: place.planId });
        return;
      case LINK_PLACE.SECTION:
        showMention({ kind: MENTION_KIND.SECTION, taskId: place.planId, anchor: place.anchor });
        return;
      case LINK_PLACE.VERSION:
        openHistory({
          taskId: place.planId,
          save: undefined,
          spot: { revision: place.revision, opened: undefined },
        });
        return;
      case LINK_PLACE.PAGE:
        showPanelTab(place.planId, { page: place.pageId });
        return;
      case LINK_PLACE.CALL:
        if (place.callId === undefined) showPanelTab(place.planId, SIDE_PANEL_TAB.CALL);
        else showSource(place.planId, { kind: REVISION_SOURCE.CALL, callId: place.callId });
        return;
      case LINK_PLACE.TURN:
        showSource(place.planId, { kind: REVISION_SOURCE.WORK, at: place.at });
        return;
      // Note that an agent's worker's tab is opened with no task words, since a link carries none; its own rows name its task once they land.
      // An agent's worker is drawn only while its agent's tab is open, so the agent's tab opens with it.
      case LINK_PLACE.WORKER:
        if (place.agentId === undefined) {
          showPanelTab(place.planId, { subagent: place.callId });
          return;
        }
        showColumnTab(place.planId, { agent: place.agentId });
        showPanelTab(place.planId, {
          subagent: place.callId,
          delegation: { agent: place.agentId, task: "" },
        });
        return;
      case LINK_PLACE.CHANGES:
        showPanelTab(place.planId, { changes: sharedChangesAgent(place.planId, place.agentId) });
        return;
      case LINK_PLACE.AGENT:
        if (place.planId === undefined)
          standInFor({ kind: STAND_IN.AGENT, agentId: place.agentId });
        else showColumnTab(place.planId, { agent: place.agentId });
        return;
      // Each ask is its own, so the same message asked twice is brought into view twice.
      case LINK_PLACE.MESSAGE:
        if (place.planId === undefined)
          standInFor({ kind: STAND_IN.AGENT, agentId: place.agentId });
        else showColumnTab(place.planId, { agent: place.agentId });
        messageAsks.current += 1;
        setMessageReveal({
          agentId: place.agentId,
          messageId: place.messageId,
          ask: messageAsks.current,
        });
        return;
      case LINK_PLACE.PERSON: {
        // A person's page is theirs in the workspace the link names, listed first; one the reader is not in names nobody they can see.
        const home = viewed.workspaces.find(
          (each) => each.slug === workspace || each.id === workspace,
        );
        navigations.current += 1;
        listLinked(workspace);
        standInFor({
          kind: STAND_IN.PERSON,
          userId: place.userId,
          workspaceId: home?.id ?? listedWorkspace?.id,
        });
        return;
      }
      case LINK_PLACE.INBOX: {
        // Note that a link to the Inbox opens it as its sidebar row does, on the item last chosen in the workspace it lists.
        const workspaceId = listLinked(workspace);
        standInFor({
          kind: STAND_IN.INBOX,
          chosen: rememberedChoice(lastInboxChoice.current, {
            account: input.account,
            workspaceId,
          }),
        });
        return;
      }
      case LINK_PLACE.INBOX_ITEM:
        // An item of a task the account lists is shown in the task's own workspace, whatever the slug says.
        listLinked(
          ("planId" in place
            ? viewed.tasks.find((task) => task.id === place.planId)?.workspaceId
            : undefined) ?? workspace,
        );
        standInFor({
          kind: STAND_IN.INBOX,
          chosen:
            "planId" in place
              ? { taskId: place.planId, itemId: place.itemId, opened: true }
              : { agentId: place.agentId, itemId: place.itemId, opened: true },
        });
        return;
      case LINK_PLACE.AUTOMATIONS:
        listLinked(workspace);
        standInFor({ kind: STAND_IN.AUTOMATIONS, place: AUTOMATIONS_LIST });
        return;
      case LINK_PLACE.AUTOMATION:
        listLinked(workspace);
        standInFor({
          kind: STAND_IN.AUTOMATIONS,
          place: { kind: AUTOMATIONS_PAGE.EDIT, automationId: place.automationId },
        });
        return;
      case LINK_PLACE.AUTOMATION_RUN:
        listLinked(workspace);
        standInFor({
          kind: STAND_IN.AUTOMATIONS,
          place: {
            kind: AUTOMATIONS_PAGE.EDIT,
            automationId: place.automationId,
            runId: place.runId,
          },
        });
        return;
      case LINK_PLACE.FACTORY:
        standInFor({ kind: STAND_IN.FACTORY });
        return;
      // An issue's page reads the workspace listed, so the link's is listed first; an issue of any other says it is not in this workspace.
      case LINK_PLACE.ISSUE:
        listLinked(workspace);
        standInFor({
          kind: STAND_IN.ISSUES,
          place: { kind: ISSUES_PAGE.ISSUE, issueId: place.issueId },
        });
        return;
      // Settings is the window's, not the Plans tab's, so its link is opened there.
      case LINK_PLACE.SETTINGS:
        return;
    }
  };

  // An inbox item's code opens in its task's File tab; on a task not yet
  // open, once the host has it open, since the panel draws the open task's.
  const showFile = (taskId: string, ref: CodeRef, commit: string) => {
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (taskId === tasks.activeTaskId) {
      sidePanel.onOpenFile(ref, commit);
      return;
    }
    select(taskId);
    setFileFor({ taskId, ref, commit });
  };
  // A file asked for is the task's it was asked on, so a select refused, or
  // another task asked for since, lets it go.
  if (fileFor !== undefined && fileFor.taskId !== boundFor) setFileFor(undefined);
  const { onOpenFile } = sidePanel;
  useEffect(() => {
    if (fileFor === undefined || fileFor.taskId !== tasks.activeTaskId) return;
    setFileFor(undefined);
    onOpenFile(fileFor.ref, fileFor.commit);
  }, [fileFor, tasks.activeTaskId, onOpenFile]);

  // Every tab closed is kept as it stood for ⇧⌘T to open again, but a draft's,
  // which lets its draft go, and the task's while it stands alone, which
  // does not close. Note that a tab's place is counted among those after the
  // plan's, which stand there whether or not the plan's tab is open.
  const openTabs = mainTabs.tabs;
  const closeMainTab = mainTabs.onClose;
  // The brain's worker's tab reads its session as an agent's worker's tab does, the task standing in the agent's place.
  const readWorker = useCallback<TranscriptReader>(
    ({ agentId, after, callId }) =>
      act(ACT_KIND.TASKS_MESSAGES, {
        taskId: agentId,
        after,
        ...(callId === undefined ? undefined : { callId }),
      }),
    [act],
  );
  const closeColumnTab = useCallback(
    (tab: MainTab) => {
      const after = openTabs.filter((each) => each !== MAIN_TAB.PLAN);
      const at = after.findIndex((each) => sameTab(each, tab));
      const closes = tab === MAIN_TAB.PLAN ? openTabs.includes(tab) && after.length > 0 : at >= 0;
      const task = viewed.activeTaskId;
      if (task !== undefined && closes && !isDraftTab(tab)) {
        const closed = { strip: CLOSED_TAB_STRIP.COLUMN, task, tab, at: Math.max(0, at) };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
      closeMainTab(tab);
    },
    [openTabs, closeMainTab, viewed.activeTaskId, setClosedTabs, latestClosedTabs],
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
  // Whether the open task's strips draw a closed tab of it again: an agent's
  // while the agent is not archived, the Inbox while the task holds an
  // agent, and a subagent's, a Changes or Terminal tab, or a page's on the strip's own
  // terms. Note that what the task has not read yet counts as drawn, as the
  // strips stand a tab until the read says otherwise.
  const drawsAgain = (closed: ClosedTab): boolean => {
    const { tab } = closed;
    const agentIds = agents.agentIds;
    if (closed.strip === CLOSED_TAB_STRIP.COLUMN) {
      if (isAgentTab(tab)) return agentIds === undefined || agentIds.includes(tab.agent);
      if (tab !== MAIN_TAB.INBOX) return true;
      const held = agents.heldIds;
      const waiting = input.inboxWaiting.some((task) => task.taskId === closed.task);
      return held === undefined || held.length > 0 || waiting;
    }
    if (isSubagentTab(tab))
      return drawsSubagent(tab, { agents: mainTabs.openAgents, subagents: workers });
    if (isChangesTab(tab)) return drawsChanges(tab, { taskAgents: agentIds });
    if (isPageTab(tab)) return viewed.pages === undefined || pages.includes(tab.page);
    if (isTerminalTab(tab)) return drawsTerminal(tab, { taskAgents: agentIds });
    if (isMacTerminalTab(tab)) return drawsMacTerminal(tab, { taskAgents: agentIds });
    // A Browser tab's page went with it, so there is nothing to open again.
    if (isBrowserTab(tab)) return false;
    return true;
  };
  const reopenable = withUndrawnPassed(closedTabs, tasks.activeTaskId, drawsAgain);
  // A closed tab opens again where it stood, in its strip at its place and
  // showing what it showed, so a version history or the window's Inbox over
  // the task gives way, and a side panel filling the window over its column.
  // One the task no longer draws, read only once a reopen opened its task, opens nothing.
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
  // A tab closed on another task opens once the host has that task open.
  // Note that a press while one waits on its task takes the next tab only
  // where it is that same task's, because asking for another task would let
  // the waiting one go; it waits its turn on the stack instead.
  const reopenClosedTab = () => {
    const waiting = latestReopenFor();
    const open = waiting.length === 0 ? tasks.activeTaskId : undefined;
    const stack = withUndrawnPassed(latestClosedTabs(), open, drawsAgain);
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
  // A reopen is the task's it was asked on, so a select refused, or another
  // task asked for since, puts the tabs waiting on it back, as they stood.
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

  // Showing the panel on a plan whose strip holds no tab opens one first, so
  // the panel is never shown empty beside the summary that lists the same:
  // the tab last closed on the plan this launch, where ⇧⌘T would open it,
  // else the kind last closed on it, kept across launches, else Call. An
  // agent's page, and the Inbox beside an item, have no kind to fall back on,
  // so their panel shows empty, offering what its "+" does.
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
    sidePanel.onChoose(sidePanel.closedTabs.at(-1) ?? SIDE_PANEL_TAB.CALL);
  };

  // The home page is where the tab rests, so only an open task steps back,
  // and a panel filling the window over it is the nearer layer.
  const back = useCallback((): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leaveTask();
    return true;
  }, [leaveTask, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  return {
    page,
    restoring,
    shown,
    signedIn,
    me: fixture === undefined ? input.accountId : undefined,
    tasks: [...sidebar.pinned, ...sidebar.rest],
    archived: sidebar.archived,
    listed: {
      tasks: [...listedSidebar.pinned, ...listedSidebar.rest],
      archived: listedSidebar.archived,
      inbox: listedInbox.inbox,
      inboxTasks: listedInbox.inboxTasks,
    },
    listedAgents,
    workspaces: viewed.workspaces,
    workspacesFailed: viewed.workspacesStatus === TASKS_READ.FAILED,
    // A failed read is taken as stale, so the refresh reads the workspaces again at once.
    onRetryWorkspaces: () => tell(ACT_KIND.TASKS_REFRESH),
    workspace: listedWorkspace,
    onChooseWorkspace: guard(switchWorkspace),
    onCreateWorkspace: createWorkspace,
    onOpenWorkspaceSettings: () =>
      input.onOpenSettings({
        page: SETTINGS_VIEW.WORKSPACE,
        ...(listedWorkspace === undefined ? undefined : { workspaceId: listedWorkspace.id }),
      }),
    // A workspace left lands the window on the account's own workspace's
    // Home, since nothing of the one left is the reader's to show any more.
    // Note that it lists the workspace rather than switching to it, because a
    // switch reopens the task last open there, and a leave goes Home; the
    // navigation it counts passes over any open still on its way.
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
    edit,
    microphone: {
      label: microphone.label,
      enabled: microphone.press !== MICROPHONE_PRESS.NONE,
      muted: microphone.muted,
      onPress: pressMicrophone,
    },
    // The speaker is the voice window's to silence, since it plays Luke.
    speaker: {
      muted: voice.view.speakerMuted,
      onPress: () =>
        tell(ACT_KIND.VOICE_COMMAND, {
          command: voice.view.speakerMuted
            ? VOICE_COMMAND.UNMUTE_SPEAKER
            : VOICE_COMMAND.MUTE_SPEAKER,
        }),
    },
    // The stop is the voice window's to carry out, as every voice command is:
    // it holds the call, and ends whichever one stands.
    stop: {
      shown: live,
      onPress: () => tell(ACT_KIND.VOICE_COMMAND, { command: VOICE_COMMAND.END_CALL }),
    },
    // A fixture's open task is drawn on a call with Luke working, read from
    // the fixture's own call rather than a voice window that holds none.
    status: callStatus(reported, tasks),
    live,
    mainTabs: { ...mainTabs, onClose: closeColumnTab },
    sidePanel: { ...sidePanel, onClose: closeSidePanelTab, onToggle: toggleSidePanel },
    unreadTabs,
    board: tasks.board,
    shownCode: tasks.shownCode,
    workFailed: tasks.workStatus === TASKS_READ.FAILED,
    onRetryWork: () => tell(ACT_KIND.TASKS_REFRESH),
    pages: tasks.pages,
    transcript: {
      region: transcript,
      onRetry: () => tell(ACT_KIND.TASKS_REFRESH),
      reveal:
        revealing?.kind === REVISION_SOURCE.CALL
          ? { call: revealing.callId, onRevealed: revealed }
          : undefined,
    },
    // A fixture's open task is drawn mid-call, as its status and transcript are.
    work: {
      conversation: tasks.conversation,
      onLoadEarlier: () => act(ACT_KIND.TASKS_CONVERSATION_EARLIER),
      readWorker,
      reveal:
        revealing?.kind === REVISION_SOURCE.WORK
          ? { at: revealing.at, onRevealed: revealed }
          : undefined,
    },
    agents,
    history: {
      ...history,
      open: historyOpen,
      onOpen: (taskId, save) => openHistory({ taskId, save, spot: undefined }),
      onReturn: (taskId, spot) => openHistory({ taskId, save: undefined, spot }),
      onClose: () => setHistoryFor(undefined),
    },
    // Note that the pin's own task opened by its row is the task the
    // sidebar marks again rather than the pin; another task's lets the pin
    // go only once it opens.
    onSelect: guard((taskId: string) => {
      setChosen((held) => (held?.pin.task === taskId ? undefined : held));
      select(taskId);
    }),
    onShowAgent: guard((taskId: string, agentId: string) =>
      showColumnTab(taskId, { agent: agentId }),
    ),
    inbox: input.inboxWaiting,
    inboxShown: shownInbox,
    chatShown,
    inboxTasks: input.inboxTasks,
    inboxTaskless: input.inboxTaskless,
    failedRuns: input.failedRuns,
    // The window's Inbox stands over the task's place, so a version history there gives way.
    inboxView: {
      open: inboxView !== undefined,
      chosen: inboxChosen,
      onOpen: guard(() => {
        setHistoryFor(undefined);
        const remembered = lastInboxChoice.current;
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX
            ? held
            : {
                kind: STAND_IN.INBOX,
                chosen: rememberedChoice(remembered, {
                  account: input.account,
                  workspaceId: listedWorkspaceId,
                }),
              },
        );
      }),
      onClose: guard(() => setStandIn(undefined)),
      onChoose: (chosen) =>
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX ? { kind: STAND_IN.INBOX, chosen } : held,
        ),
      pages: inboxPages.pages,
      onRereadPages: inboxPages.onReread,
    },
    // Chat stands over the plan's place on the Inbox's terms, each giving way to the other.
    chatView: {
      open: standIn?.kind === STAND_IN.CHAT,
      available: liveRun ? input.signedIn && chatOn : chat !== undefined,
      chat: shownChat,
      failed: liveRun && liveChat.failed,
      onRetry: liveChat.onRetry,
      place: standIn?.kind === STAND_IN.CHAT ? standIn.place : FOR_YOU,
      onOpen: guard(() => {
        setHistoryFor(undefined);
        setStandIn((held) =>
          held?.kind === STAND_IN.CHAT ? held : { kind: STAND_IN.CHAT, place: FOR_YOU },
        );
      }),
      onClose: guard(() => setStandIn(undefined)),
      onChoose: (place) =>
        setStandIn((held) =>
          held?.kind === STAND_IN.CHAT ? { kind: STAND_IN.CHAT, place } : held,
        ),
      onShow: guard((place: ChatPlace) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.CHAT, place });
      }),
      onPost: (post) =>
        liveRun
          ? liveChat.onPost(post)
          : stage((held, staging) => staging.stagedPost(held, post, Date.now())),
      onAnswer: (answer) =>
        liveRun
          ? liveChat.onAnswer(answer)
          : stage((held, staging) => staging.stagedAnswer(held, answer, Date.now())),
    },
    // An agent's page stands over the task's place as the Inbox does, so a version history there gives way.
    agentView: {
      agentId: agentView?.agentId,
      onOpen: guard((agentId: string) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.AGENT, agentId });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    // A person's page stands over the plan's place as an agent's does, so a version history there gives way.
    personView: {
      userId: standIn?.kind === STAND_IN.PERSON ? standIn.userId : undefined,
      name: standIn?.kind === STAND_IN.PERSON ? standIn.name : undefined,
      workspaceId: standIn?.kind === STAND_IN.PERSON ? standIn.workspaceId : undefined,
      onOpen: guard((userId: string, name?: string, workspaceId?: string) => {
        setHistoryFor(undefined);
        // Note that the page is a navigation of its own, so a plan's open or a workspace's reopen
        // asked before it, answering late, lists nothing and leaves nothing over it.
        navigations.current += 1;
        // Note that the workspace is listed first, because the page reads the listed workspace's
        // work, and only listed, as a link's place is: reopening its last plan behind the page
        // would only hide it again, and a reopen refused would take the page with it.
        if (workspaceId !== undefined && workspaceId !== listedWorkspace?.id) {
          chooseListed(workspaceId);
        }
        const opened = {
          kind: STAND_IN.PERSON,
          userId,
          workspaceId: workspaceId ?? listedWorkspace?.id,
        } as const;
        setStandIn(name === undefined ? opened : { ...opened, name });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    // Factory stands over the task's place as the Inbox and an agent's page do, each giving way to the others.
    factoryView: {
      open: standIn?.kind === STAND_IN.FACTORY,
      onOpen: guard(() => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.FACTORY });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    // The Automations page stands over the task's place as Factory does, each giving way to the others.
    automationsView: {
      open: standIn?.kind === STAND_IN.AUTOMATIONS,
      place: standIn?.kind === STAND_IN.AUTOMATIONS ? standIn.place : AUTOMATIONS_LIST,
      onOpen: guard((place: AutomationsPlace = AUTOMATIONS_LIST) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.AUTOMATIONS, place });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    // The Issues page stands over the plan's place as the Automations page does, each giving way to the others.
    issuesView: {
      open: standIn?.kind === STAND_IN.ISSUES,
      place: standIn?.kind === STAND_IN.ISSUES ? standIn.place : ISSUES_LIST,
      onOpen: guard((place: IssuesPlace = ISSUES_LIST) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.ISSUES, place });
      }),
      onClose: guard(() => setStandIn(undefined)),
      peeked: issuePeek,
      onPeek: setIssuePeek,
    },
    callTaskId: callInProgress(reported) ? reported.callTaskId : undefined,
    onShowFile: showFile,
    // A version's Open lands where its writer wrote it: an agent's tab as a
    // notification opens it, or the side panel's Call tab, asked to
    // bring the call or the turn into view once it draws.
    onShowSource: guard(showSource),
    // The call card's way back lands where the task's call bar is in sight.
    secondCall: {
      confirm: secondCall,
      question: secondCallQuestion(callCard({ view: voice.view, tasks }).taskName),
    },
    onShowTask: guard((taskId: string) => showColumnTab(taskId, MAIN_TAB.PLAN)),
    // Each ask is its own, so the same section asked twice scrolls twice.
    onShowMention: guard(showMention),
    onOpenLink: guard((link: ReadLink) => openLink(link)),
    messageReveal,
    // Only the ask answered is let go; a newer one stands until its agent's tab answers it.
    onMessageRevealed: (ask) => setMessageReveal((last) => (last?.ask === ask ? undefined : last)),
    sectionReveal,
    // Only the ask shown is let go; a newer one stands until its own task shows it.
    onSectionRevealed: (ask) =>
      setSectionReveal((last) => (last?.reveal.ask === ask ? undefined : last)),
    onShowInbox: guard((taskId: string) => showColumnTab(taskId, MAIN_TAB.INBOX)),
    onShowChat: guard((taskId: string) => showColumnTab(taskId, MAIN_TAB.CHAT)),
    // A pinned tab is in one of the task's columns, so a version history over it gives way as well.
    onOpenPinnedTab: guard((pin: PinnedTab) => {
      const { tab } = pin;
      setChosen({ pin, over: openTaskId });
      if (pin.task !== tasks.activeTaskId) select(pin.task);
      setStandIn(undefined);
      setHistoryFor(undefined);
      if (!inColumn(tab)) {
        sidePanel.onShow(pin.task, tab);
        return;
      }
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(pin.task, tab);
    }),
    chosenPin: chosen !== undefined && chosen.pin.task === boundFor ? chosen.pin : undefined,
    onReopenClosedTab: reopenable.length === 0 ? undefined : reopenClosedTab,
    repositories: repositoriesIn(repositoriesOf),
    repositoryMenu,
    onChangeRepository: changeRepository,
    onSetRepository: setRepository,
    onMoveTask: moveTask,
    onOpenWorkspaceGitHub: (taskId) => {
      // The open document names its workspace where the list read did not land.
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
    onOpenOnGitHub: (taskId) => {
      const repository = repositoryOf(taskId);
      if (repository !== null) openGitHub(repositoryPageUrl(repository));
    },
    onRetryList: () => tell(ACT_KIND.TASKS_REFRESH),
    onRetryDocument: () => {
      if (tasks.activeTaskId !== undefined) select(tasks.activeTaskId);
    },
    onNewTask: () => newTaskWith(undefined),
    onNewTaskIn: (repository) => newTaskWith({ repository }),
    onNewTaskFrom: (issue, agent) =>
      newTaskWith({ issue, ...(agent === true ? { agent } : undefined) }),
    newTask: {
      open: newTaskAsk !== undefined,
      preset: newTaskAsk?.preset,
      workspaces: viewed.workspaces,
      workspaceId: listedWorkspace?.id,
      repositoriesIn,
      start: startTask,
      models: agents.models,
      readModels: agents.readModels,
      readDefault: agents.readDefault,
      onClose: () => setNewTaskAsk(undefined),
      linearIssuesIn,
    },
    onLeaveTask: guard(() => leaveTask()),
    // Home is the page with no task open, so where none is, only the Inbox, an
    // agent's page, Factory, the Automations page, or Chat standing over it is put away, and the host is asked nothing.
    onGoHome: guard(() => (boundFor === undefined ? setStandIn(undefined) : leaveTask())),
    onRenameTask: renameTask,
    onDraftName: draftName,
    onMarkTask: (taskId, mark) => markTask(taskId, mark),
    onArchiveTasks: archiveTasks,
    pinnedRepositories: pinnedRepositories(viewed.repositoryPins, repositoryPins),
    onPinRepository: pinRepository,
    taskSections,
    onWriteSections: writeSections,
    onPinAgent: pinAgent,
    onMovePins: movePins,
    onDeleteTask: deleteTask,
    back,
    leaveGuard,
  };
}
