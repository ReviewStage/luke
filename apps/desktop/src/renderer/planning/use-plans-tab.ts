import type { AccountFailedRun } from "@luke/features/account-inbox-wire";
import type { AutomationPresetName } from "@luke/features/automation-code-review";
import type { Board } from "@luke/features/board-wire";
import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import type { GitHubConnection } from "@luke/features/github-connection-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import type { PlanEditRequest } from "@luke/features/plan-edit";
import { planMarkdown } from "@luke/features/plan-markdown";
import type { CodeRef, Task } from "@luke/features/task-wire";
import {
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksEditAnswer,
  type TasksView,
} from "@luke/features/tasks-view";
import { managesWorkspace } from "@luke/features/workspace-role";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTask, AppInboxTaskHolding, AppInboxTasklessItem } from "@luke/host/app-state";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { callCard } from "@luke/ui/call-card-model";
import {
  isAgentTab,
  isChangesTab,
  isDraftTab,
  isFileTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  type StripTab,
  sameTab,
} from "@luke/ui/tab-strip-model";
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
  MARK_FAILED_NOTES,
  MARK_UNDOS,
  MICROPHONE_PRESS,
  markedView,
  microphoneButton,
  type PendingAgentPins,
  type PendingMarks,
  type PendingRenames,
  type PendingRepositoryPin,
  type PendingRepositoryPins,
  pendingMark,
  pinnedRepositories,
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
  taskNameOfIssue,
  tasksPage,
  unsettledAgentPins,
  unsettledMarks,
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
import type { ActHandle } from "../act";
import { useCopyToast } from "../copy-feedback";
import { useChosenWorkspace } from "../desktop/chosen-workspace";
import {
  DIALOG_TONE,
  type DialogConfirm,
  type DialogQuestion,
  useConfirmDialog,
} from "../settings/confirm-dialog";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import {
  CLOSED_TAB_STRIP,
  type ClosedTab,
  NO_CLOSED_TABS,
  withClosedTab,
  withUndrawnPassed,
} from "./closed-tabs";
import { agentTabLabel } from "./coding-agent-model";
import type { MessageReveal } from "./message-links";
import type { SectionReveal } from "./plan-body";
import { REVISION_SOURCE, type RevisionSource } from "./plan-history-model";
import {
  FIXTURE_PLANNING_CALL,
  fixturePlanningView,
  fixtureRepositories,
  fixtureSidePanel,
} from "./planning-fixture";
import type { RepositoryChooser } from "./repository-chip";
import type { TranscriptReader } from "./use-agent-transcript";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";
import { useLastPlan } from "./use-last-plan";
import { MAIN_TAB, type MainTab, type MainTabsControl, useMainTabs } from "./use-main-tabs";
import { usePanelArrivals } from "./use-panel-arrivals";
import {
  type HistorySpot,
  type PlanHistoryControl,
  type PlanHistorySource,
  usePlanHistory,
} from "./use-plan-history";
import {
  drawsChanges,
  drawsSubagent,
  drawsTerminal,
  inColumn,
  type PinnedTab,
  type PlanHolds,
  SIDE_PANEL_TAB,
  type SidePanelControl,
  type SidePanelTab,
  useSidePanel,
} from "./use-side-panel";
import { sayRestored } from "./version-view";
import { startedAgentCallIds, workerCallIds, workRowsOf } from "./work-model";

/**
 * use-plans-tab.ts -- the panel's Plans tab as one control: which page shows, the presses each page makes, and the host's read of the plans as the tab shows.
 *
 * The tab draws the planning view main holds and the voice window's report,
 * and every press is an act. It saves nothing and decides nothing about a
 * plan: the plan's notetaker writes the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename, a pin, and an
 * archive are the presses drawn before the host answers them: each shows at
 * once, and goes back if the service refuses it, a pin or an archive with a
 * quiet note on the plan's row. The open plan archived leaves for the
 * home page once the service has kept the archive. The plan the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another plan, a plan started, archiving it, a delete, or a
 * sign-out leaves it. With none open, the tab is the home page. The open plan's
 * coding agents are the tab's too (`use-coding-agents.ts`): read when the
 * plan opens, started from the toolbar or the column's "+", and each drawn
 * on a tab of the plan's column beside the plan's own (`use-main-tabs.ts`),
 * their workers' in the side panel. Main is told which agent's tab is shown, so the notification it
 * posts when an agent ends is held back while the developer is looking at
 * that agent, and the agents main says ended unseen read in semibold until their
 * tab is shown (`@luke/host/agent-notices`). The open plan's history is the
 * tab's as well (`use-plan-history.ts`): its version history, opened from
 * the plan's menu or its "Edited by" line, or from a section's on the
 * revision that last changed the section, takes the whole window in the
 * plan's place (`desktop-version-history.tsx`) until it is left or another
 * plan opens, and a version restored through the service is answered with
 * the window's toast. The side panel stands as it was behind it.
 */

/** A call or a turn the open plan's side panel is asked to bring into view, on the plan it was asked of. */
interface SourceReveal {
  readonly planId: string;
  readonly source: Exclude<RevisionSource, { kind: typeof REVISION_SOURCE.AGENT }>;
}

/** The item chosen in the window's Inbox, and the plan it belongs to. */
/** The item chosen in the window's Inbox, by the plan it stands on, or, for an agent with no plan, by its agent. */
export type InboxChoice = (
  | { readonly planId: string; readonly itemId: string }
  | { readonly agentId: string; readonly itemId: string }
) & {
  /** Whether the item itself is shown where the Inbox shows one column: a notification's ask, rather than a row's choice the list stays standing for. */
  readonly opened?: true;
};

/**
 * The window's Inbox, standing in the plan's place beside the sidebar: the
 * items of every plan holding one in a column of their own, and the chosen
 * item beside them. It is the window's alone, as a version history is, so
 * it leaves the plan the host has open, and the call bound to it, as they
 * stand; opening any plan, or a new one, leaves it. The item chosen is kept
 * while it stands, so the item answered stays in sight.
 */
interface InboxViewControl {
  readonly open: boolean;
  /** The item chosen in it, none until one is, where the list's first stands in. */
  readonly chosen: InboxChoice | undefined;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (chosen: InboxChoice) => void;
}

/**
 * One agent's page, standing in the plan's place beside the sidebar as the
 * Inbox does: the agent an automation started with no plan, which has no
 * plan's column to stand in, drawn as its tab would be. It is the window's
 * alone, as the Inbox is, so it leaves the plan the host has open as it
 * stands; opening any plan, the Inbox, or home leaves it.
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

/** What may stand in the plan's place, the window's own rather than the plan's. */
const STAND_IN = {
  INBOX: "inbox",
  AGENT: "agent",
  PERSON: "person",
  FACTORY: "factory",
  AUTOMATIONS: "automations",
} as const;

/** The window's Inbox with the item chosen in it, one agent's page, Factory, or the Automations page. */
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
  | { readonly kind: typeof STAND_IN.AUTOMATIONS; readonly place: AutomationsPlace };

/** The window's Factory: whether it stands in the plan's place, and the presses that open and leave it. */
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
  | { readonly kind: typeof AUTOMATIONS_PAGE.LIST }
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
    };

/** The list, where the Automations pages open with none asked for. */
const AUTOMATIONS_LIST: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST };

/** The window's Automations pages: whether one stands in the plan's place, which, and the presses that open, move between, and leave them. */
interface AutomationsViewControl {
  readonly open: boolean;
  /** The page standing, the list while none does. */
  readonly place: AutomationsPlace;
  /** Opens the page asked for, the list where none is. */
  readonly onOpen: (place?: AutomationsPlace) => void;
  readonly onClose: () => void;
}

/** Everything the Plans tab draws and presses, handed to the panel body whole. */
export interface PlansControl {
  page: TasksPage;
  /** Whether a launch is still opening the plan last open, while the home page waits rather than flash before it (`use-last-plan.ts`). */
  restoring: boolean;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's plans stand in for one. */
  signedIn: boolean;
  /** The signed-in account's id, whose own edits a plan names "you"; none while signed out, for a fixture, or an identity stored without one. */
  me: string | undefined;
  /** Every plan of every workspace, in the sidebar's order: the pinned ones first, newest pinned first, then the rest, newest started first; what the palette, the inbox, and the history find a plan in. */
  plans: TasksView["tasks"];
  /** Every archived plan of every workspace, newest archived first. */
  archived: TasksView["tasks"];
  /**
   * The chosen workspace's share of `plans` and `archived`, which alone the
   * sidebar lists, and of `inbox` and `inboxPlans`, which alone the Inbox,
   * its count, and Home list; everything while no workspace is chosen.
   */
  listed: {
    plans: TasksView["tasks"];
    archived: TasksView["tasks"];
    inbox: readonly AppInboxTask[];
    inboxPlans: readonly AppInboxTaskHolding[];
  };
  /** The chosen workspace's agents an automation started with no plan, newest started first, which the sidebar lists among the plans, and those archived, which its Archived view lists among the archived plans. */
  listedAgents: {
    readonly standing: readonly TasklessAgent[];
    readonly archived: readonly TasklessAgent[];
  };
  /** The workspaces the account is a member of, its first one first; none before the first read lands. */
  workspaces: readonly Workspace[];
  /** The workspace the sidebar lists and New plan starts in; absent while none is listed, when every plan is listed. */
  workspace: Workspace | undefined;
  /** Lists another of the account's workspaces, and starts the next new plan in it. */
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
  activePlanId: string | undefined;
  /**
   * The plan the tab is on its way to: the one a press asked the host for,
   * until the host's open plan next moves, else the open one. Nothing is the
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
  edit: (planId: string, request: PlanEditRequest) => Promise<TasksEditAnswer>;
  microphone: { label: string; enabled: boolean; muted: boolean; onPress: () => void };
  /** Silences Luke's voice on this Mac for the open plan's call, or plays it again; offered with the stop. */
  speaker: { muted: boolean; onPress: () => void };
  /** Ends the open plan's call at once, offered only while that call is in progress. */
  stop: { shown: boolean; onPress: () => void };
  /** The open plan's call status beside the microphone, absent while none stands. */
  status: CallStatus | undefined;
  /** Whether the open plan's call is in progress, so the plan is still being written. */
  live: boolean;
  /** The plan's column's tabs: the plan's own, then its agents' and its draft's, and which is shown. */
  mainTabs: MainTabsControl;
  /** The side panel beside the open plan's column: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents' tabs that ended unseen, each until it is shown. */
  unreadTabs: readonly StripTab[];
  /** The open plan's whiteboard as main holds it; absent before its first read lands. */
  board: Board | undefined;
  /** Every code Luke showed on the open plan, oldest first: what the service keeps, and each a call shows as it shows it. */
  shownCode: TasksView["shownCode"];
  /** The pages agents wrote for the open plan, each by its newest version; absent with none. */
  pages: TasksView["pages"];
  /** What was said on the open plan's calls, the call standing now included, and the retry of a read that failed. */
  transcript: {
    region: TranscriptRegion;
    onRetry: () => void;
    /** The call the tab is asked to bring into view, by its key, and the word that it has; what a version's Open asks. */
    reveal?: { readonly call: string; readonly onRevealed: () => void } | undefined;
  };
  /**
   * What Luke's planning model wrote and ran on the open plan's calls,
   * whether its call still stands, the turn the page before the oldest drawn
   * is read before where an older one stands, and that read.
   */
  work: {
    /** The open plan's planning conversation as an agent's transcript is read; none before the first read lands. */
    conversation: TasksView["conversation"];
    callLive: boolean;
    onLoadEarlier: () => Promise<void>;
    /** Reads a planning worker's session past a cursor, as an agent's worker's tab reads its own, the plan standing in the agent's place. */
    readWorker: TranscriptReader;
    /** The moment whose turn the tab is asked to bring into view, and the word that it has; what a version's Open asks. */
    reveal?: { readonly at: number; readonly onRevealed: () => void } | undefined;
  };
  /** The open plan's coding agents: their tabs, the Start, and the Stop. */
  agents: CodingAgentsControl;
  /** The open plan's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  onSelect: (planId: string) => void;
  /** Opens a plan on one agent's tab: what a notification's click asks. */
  onShowAgent: (planId: string, agentId: string) => void;
  /** Leaves the version history for the place that wrote a version: its agent's tab, its call in the Transcript, or its turn in Work. */
  onShowSource: (planId: string, source: RevisionSource) => void;
  /** The question a Talk press or a start asks before it ends the call standing about another plan. */
  secondCall: { confirm: DialogConfirm; question: DialogQuestion };
  /** Opens a plan on its own document tab, out from under its version history and a side panel filling the window: the call card's way back. */
  onShowPlan: (planId: string) => void;
  /** Opens a plan the same way, scrolled to the section a mention or a Luke link names, or at its top for the plan's own. */
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
  /** The last ask to show a section, under the plan it was asked of, so a section of a plan not yet open is shown once it is drawn; let go once shown. */
  sectionReveal: { readonly planId: string; readonly reveal: SectionReveal } | undefined;
  /** The plan's page showed the section an ask named, so a later visit to the plan does not show it again. */
  onSectionRevealed: (ask: number) => void;
  /** Opens a plan on its Inbox tab the same way, opening the tab where it was closed: what ⌘K's Inbox row asks. */
  onShowInbox: (planId: string) => void;
  /** What waits on the developer across the account's plans, as main's read last answered: each plan with an open inbox item, and its items. */
  inbox: readonly AppInboxTask[];
  /** The plan whose Inbox is on screen, or none: what main is told, so an item it shows is not announced. */
  inboxShown: string | null;
  /** Every plan holding an inbox item, waiting or settled, the plan whose item changed latest first: what the window's Inbox lists. */
  inboxPlans: readonly AppInboxTaskHolding[];
  /** What waits on the developer from agents with no plan, as main's read last answered: what the window's Inbox lists beside the plans' and counts with them. */
  inboxPlanless: readonly AppInboxTasklessItem[];
  /** The newest run of each of the account's own automations that failed to start lately, every workspace's, which marks the sidebar's Automations of the run's workspace until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
  /** The window's Inbox: whether it stands in the plan's place, the plan chosen in it, and its presses. */
  inboxView: InboxViewControl;
  /** One agent's page: which agent's stands in the plan's place, if any, and its presses. */
  agentView: AgentViewControl;
  /** One person's page: whose stands in the plan's place, if anyone's, and its presses (`person-page.tsx`). */
  personView: PersonViewControl;
  /** The window's Factory: whether it stands in the plan's place, and its presses (`desktop-factory.tsx`). */
  factoryView: FactoryViewControl;
  /** The window's Automations page: whether it stands in the plan's place, and its presses (`automations-page.tsx`). */
  automationsView: AutomationsViewControl;
  /** The plan the call in progress on this Mac is about, or none: what Factory marks as being planned. */
  callTaskId: string | undefined;
  /** Opens a plan's file in its side panel at the commit named, the reference's lines lit, opening the plan first where it is not the open one: what an inbox item's code opens. */
  onShowFile: (planId: string, ref: CodeRef, commit: string) => void;
  /** Opens a tab pinned to the sidebar: its plan, where it is not the open one, and the tab in its column, opening the side panel for one of its own. */
  onOpenPinnedTab: (pin: PinnedTab) => void;
  /** Opens the tab closed latest again as it stood, on its plan, opening the plan first where it is not the open one; none while no closed tab is kept. */
  onReopenClosedTab: (() => void) | undefined;
  /** The pin the open plan was last opened from, which the sidebar marks in the plan's place for as long as the plan stays open; none once a plan is opened otherwise. */
  chosenPin: PinnedTab | undefined;
  /** What the repository chip offers, in the composer and on the open plan alike. */
  repositories: RepositoryChooser;
  /** The ask standing for the open plan's chip to open its menu: which plan it is about, and how many asks so far. */
  repositoryMenu: { planId: string; request: number } | undefined;
  /** Opens a plan's repository chip menu, opening the plan first where it is not the open one. */
  onChangeRepository: (planId: string) => void;
  /** Gives a plan its repository, or takes it away with null; answers why the service refused, or nothing once it is kept. */
  onSetRepository: (planId: string, repository: string | null) => Promise<string | undefined>;
  /** Opens a plan's repository on GitHub in the browser. */
  onOpenOnGitHub: (planId: string) => void;
  /** Opens Settings › Workspace at its GitHub, for the workspace the plan belongs to. */
  onOpenWorkspaceGitHub: (planId: string) => void;
  /**
   * Moves a plan to another of the account's workspaces, whose GitHub
   * reaches its repository, and lists that workspace so the plan stays in
   * sight; answers whether it moved, a refusal saying why in a toast unless
   * the caller says it itself (`quiet`), as the Move dialog does under its list.
   */
  onMovePlan: (
    planId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ) => Promise<boolean>;
  onRetryList: () => void;
  onRetryDocument: () => void;
  /** Opens the New plan dialog over whatever stands open, which it leaves standing. */
  onNewPlan: () => void;
  /** New plan with a repository already chosen in the dialog: what a repository group's + asks. */
  onNewPlanIn: (repository: string) => void;
  /** The New plan dialog: whether it stands, what its press chose, and the two presses it makes. */
  newPlan: {
    open: boolean;
    /** The repository the press that opened the dialog chose, where it chose one. */
    preset: { readonly repository: string } | undefined;
    /** The workspaces a plan may start in, the account's every one. */
    workspaces: readonly Workspace[];
    /** The workspace the dialog starts the plan in until another is chosen: the one listed; none before the workspaces are read. */
    workspaceId: string | undefined;
    /** The repository chip's list for a workspace, as the dialog chooses which the plan starts in. */
    repositoriesIn: (workspaceId: string | undefined) => RepositoryChooser;
    /** Starts the plan on the repository given, or none, in the workspace given, which closes the dialog and opens the plan; answers why it did not start, or nothing once it has. */
    start: (
      name: string,
      repository: string | null,
      workspaceId: string | undefined,
    ) => Promise<string | undefined>;
    /** Puts the dialog away with nothing started. */
    onClose: () => void;
    /**
     * The listed workspace's Linear, where it stands connected: its issues
     * read for the picker New plan opens, and a plan started from one, named
     * by its title, on the repository the dialog would start on, in the
     * listed workspace; answers why it did not start, or nothing once it
     * has. Absent where the workspace has no Linear connected, which leaves
     * New plan to the dialog alone.
     */
    linear:
      | {
          readonly issues: () => Promise<readonly LinearIssueSummary[]>;
          readonly start: (issue: LinearIssueSummary) => Promise<string | undefined>;
        }
      | undefined;
  };
  /** Leaves the open plan for the home page; a call on it stands, as opening another plan leaves one. */
  onLeavePlan: () => void;
  /** Goes to the home page from wherever the tab stands: the open plan left, and the window's Inbox put away. */
  onGoHome: () => void;
  /**
   * Renames a plan to a name already trimmed and changed, drawn under it at
   * once and under its old name again if the service refuses; answers
   * whether it was renamed.
   */
  onRenamePlan: (planId: string, name: string) => Promise<boolean>;
  /**
   * Draws a name being typed for a plan everywhere the plan is named, before
   * any of it is saved, or none, which draws its saved name again.
   */
  onDraftName: (planId: string, name: string | undefined) => void;
  /**
   * Pins or unpins a plan, archives it or brings it back, drawn at once and
   * put back with a note if the service refuses. Archiving the open plan
   * leaves it for the home page, as deleting it does.
   */
  onMarkPlan: (planId: string, mark: TaskMark) => void;
  /**
   * Archives several plans at once, as a repository's Archive plans asks:
   * each drawn archived at once, and one toast for them all once the
   * service answered, whose Undo brings back every plan it kept.
   */
  onArchivePlans: (planIds: readonly string[]) => void;
  /** The repositories the account pinned in the sidebar, newest pinned first, whose groups stand above the rest. */
  pinnedRepositories: readonly string[];
  /** Pins a repository in the sidebar or unpins it, on the account: drawn at once, and put back with a toast if the service refuses. */
  onPinRepository: (repository: string, pinned: boolean) => void;
  /** Pins an agent with no plan in the sidebar or unpins it, for the account alone: drawn at once, and put back with a toast if the service refuses. */
  onPinAgent: (agentId: string, pinned: boolean) => void;
  /** Deletes a plan, which ends its call and returns to the home page if it is the open one; answers whether it was deleted. */
  onDeletePlan: (planId: string) => Promise<ActionResult>;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, else an open
   * plan back to the home page.
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
   * moment of a save, on the revision that made it, opening the plan first
   * where it is not the open one.
   */
  onOpen: (planId: string, save?: number) => void;
  /** Opens a plan's version history where it stood when it was left, as Back and Forward go to it. */
  onReturn: (planId: string, spot: HistorySpot | undefined) => void;
  /** Leaves the version history for the plan, its side panel as it was. */
  onClose: () => void;
}

/** The plan whose version history stands, and the save whose revision it opened on or where it stood before. */
interface HistoryOpening {
  readonly planId: string;
  readonly save: number | undefined;
  readonly spot: HistorySpot | undefined;
}

/** A pin pressed in the sidebar, and the plan open when it was, or its own once that opens. */
interface PinChoice {
  readonly pin: PinnedTab;
  readonly over: string | undefined;
}

/**
 * A plan asked of the host, or the home page as nothing, and the open
 * plan it was asked over: the ask stands only while that plan is still the
 * open one, so the host's next move, whatever it is, answers it.
 */
interface PlanAsk {
  planId: string | undefined;
  over: string | undefined;
}

/** No repository pin given here and still waiting on main's view. */
const NO_PENDING_PINS: PendingRepositoryPins = new Map();

/** No agent pin given here and still waiting on main's view. */
const NO_PENDING_AGENT_PINS: PendingAgentPins = new Map();

/** A plan with no page, the same array every render, so the arrivals read no change in it. */
const NO_PAGES: NonNullable<TasksView["pages"]> = [];

/** What an agent's page holds of the plan's panel kinds: nothing, its tabs being the agent's own. */
const NO_HOLDS: PlanHolds = {};

/** No ids, the same array every render. */
const NO_IDS: readonly string[] = [];

/** No agent with no plan, before the list carries any. */
const NO_PLANLESS_AGENTS: readonly TasklessAgent[] = [];

/** What the toast says once Copy plan has put the plan on the clipboard. */
const PLAN_COPIED_NOTE = "Plan copied";

/** What the toast says once a plan is deleted. */
const PLAN_DELETED_NOTE = "Task deleted";

/** What the toast says when the service did not move a plan, which stays where it was. */
const MOVE_REFUSED_NOTE = "The task could not be moved. Try again.";

/** What the toast says when opening a plan listed the workspace it is in. */
function switchedNote(workspace: string): string {
  return `Switched to ${workspace}`;
}

/** The switch toast's action, which lists the workspace left again. */
function backNote(workspace: string): string {
  return `Back to ${workspace}`;
}

/** Why a delete the service did not carry was refused. */
const DELETE_REFUSED_NOTE = "The task could not be deleted. Try again.";

/** What a delete the service did not carry answers, so the plan stays and says why. */
const DELETE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: DELETE_REFUSED_NOTE,
};

/*
 * What the Inbox holds, by workspace. Main reads what waits across every
 * plan the account can reach, and the window lists one workspace at a time,
 * so everything the window lists of the Inbox, its rows, the sidebar's
 * count, and Home's waiting list, is the listed workspace's share
 * (`docs/proposals/workspace-clarity.md`, decision 11). A plan is placed by
 * the workspace the account's plan list says it is in, so an item of a plan
 * not yet listed is in no workspace's share until it is.
 */

/** The entries of the plans in `workspaceId`, or every entry while no workspace is listed. */
function inWorkspace<Entry extends { readonly taskId: string }>(
  entries: readonly Entry[],
  plans: readonly Pick<Task, "id" | "workspaceId">[],
  workspaceId: string | undefined,
): readonly Entry[] {
  if (workspaceId === undefined) return entries;
  const listed = new Set(
    plans.filter((plan) => plan.workspaceId === workspaceId).map((plan) => plan.id),
  );
  return entries.filter((entry) => listed.has(entry.taskId));
}

/** What the second call's question says: the call it ends, and what the act does. */
function secondCallQuestion(planName: string): DialogQuestion {
  return {
    title: `End your call on ${planName} and start one here?`,
    body: "What was said on that call stays in its transcript.",
    verb: "Start new call",
    running: "Starting",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** What the open plan holds of each fixed tab's kind, each unknown until its read lands: the transcript's calls are those heard on it too. */
function planHolds(
  view: Pick<TasksView, "board" | "shownCode" | "conversation">,
  transcript: TranscriptRegion,
): PlanHolds {
  const { board, shownCode, conversation } = view;
  const work = conversation?.messages;
  return {
    [SIDE_PANEL_TAB.BOARD]:
      board === undefined
        ? undefined
        : board.elements.length > 0 || (board.drawing?.elements.length ?? 0) > 0,
    [SIDE_PANEL_TAB.CODE]: shownCode === undefined ? undefined : shownCode.length > 0,
    // A call holds something once a line was said on it or Luke worked on the plan, and nothing yet while neither has been read.
    [SIDE_PANEL_TAB.CALL]:
      transcript.kind === TRANSCRIPT_REGION.READY || (work?.length ?? 0) > 0
        ? true
        : transcript.kind === TRANSCRIPT_REGION.EMPTY && work !== undefined
          ? false
          : undefined,
  };
}

export function usePlansTab(input: {
  acts: Pick<ActHandle, "act" | "tell">;
  /** The plans main holds, the account's; a fixture run's own stand in for them. */
  planning: TasksView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  /** The signed-in account's email, which the plan last open is kept under; none while signed out. */
  account: string | undefined;
  /** The signed-in account's id, whose own work the window names as theirs; none while signed out. */
  accountId?: string | undefined;
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** The agents main says ended while no one was looking, each until its tab is shown. */
  unseenAgents: readonly string[];
  /** What main says waits on the developer across the account's plans. */
  inboxWaiting: readonly AppInboxTask[];
  /** Every plan main says holds an inbox item, waiting or settled. */
  inboxPlans: readonly AppInboxTaskHolding[];
  /** What main says waits on the developer from agents with no plan. */
  inboxPlanless: readonly AppInboxTasklessItem[];
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
}): PlansControl {
  const { shown, voice, leaveGuard } = input;
  const { guard } = leaveGuard;
  const { act, tell } = input.acts;
  const copyWithToast = useCopyToast();
  const toast = useToast();
  // The New plan dialog's ask, standing while the dialog does: the preset it was opened with, if any.
  const [newPlanAsk, setNewPlanAsk] = useState<
    { readonly preset: PlansControl["newPlan"]["preset"] } | undefined
  >(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<PlansControl["repositoryMenu"]>(undefined);
  const [asked, setAsked] = useState<PlanAsk | undefined>(undefined);
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  /**
   * The plan whose version history stands in the window, which it does only
   * while that plan is the one bound for, and the save whose revision it
   * opened on, none for the plan as it stands.
   */
  const [historyFor, setHistoryFor] = useState<HistoryOpening | undefined>(undefined);
  /** What stands in the plan's place while one does: the window's Inbox and the item chosen in it, or one agent's page. */
  const [standIn, setStandIn] = useState<StandIn | undefined>(undefined);
  const inboxView = standIn?.kind === STAND_IN.INBOX ? standIn : undefined;
  const agentView = standIn?.kind === STAND_IN.AGENT ? standIn : undefined;
  /** A file an inbox item opens on a plan not yet open, opened once the host has it open. */
  const [fileFor, setFileFor] = useState<
    { readonly planId: string; readonly ref: CodeRef; readonly commit: string } | undefined
  >(undefined);
  const [reveal, setReveal] = useState<SourceReveal | undefined>(undefined);
  const [sectionReveal, setSectionReveal] = useState<PlansControl["sectionReveal"]>(undefined);
  const [messageReveal, setMessageReveal] = useState<MessageReveal | undefined>(undefined);
  const messageAsks = useRef(0);
  /** The asks to show a section made so far, so each is its own even after the last was let go. */
  const sectionAsks = useRef(0);
  /** The tabs closed in the window, the latest last, which ⇧⌘T opens again (`closed-tabs.ts`). */
  const [closedTabs, setClosedTabs, latestClosedTabs] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);
  /** The closed tabs opened again on a plan not yet open, in the order asked, opened once the host has it open. */
  const [reopenFor, setReopenFor, latestReopenFor] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);

  // A fixture run draws its synthetic plans in place of the account's,
  // signed out as every fixture run is.
  const fixture = fixturePlanningView(input.run);
  const viewed = fixture ?? input.planning;
  // A name given here stands until main's view carries it, so a rename that
  // landed never flickers back while main's copy of the view catches up.
  const [renames, setRenames] = useState<PendingRenames>(new Map());
  useEffect(() => setRenames((held) => unsettledRenames(held, viewed)), [viewed]);
  // A name being typed is drawn over both, held here rather than read back
  // from main, so every surface naming the plan follows the typing at once.
  const [drafts, setDrafts] = useState<PendingRenames>(new Map());
  const draftName = useCallback((planId: string, name: string | undefined) => {
    setDrafts((held) => {
      if (held.get(planId) === name) return held;
      const next = new Map(held);
      if (name === undefined) next.delete(planId);
      else next.set(planId, name);
      return next;
    });
  }, []);
  // A pin or an archive given here stands until main's view carries it, as a name does.
  const [marks, setMarks] = useState<PendingMarks>(new Map());
  useEffect(() => setMarks((held) => unsettledMarks(held, viewed)), [viewed]);
  // A repository's pin given here stands until main's view carries it, as a
  // plan's does. Note that a sign-out lets every one go, because a pin names
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
          ? unsettledAgentPins(held, viewed.tasklessAgents ?? NO_PLANLESS_AGENTS)
          : NO_PENDING_AGENT_PINS,
      ),
    [viewed, accountSignedIn],
  );
  // A tab closed names a plan of the account it was closed under, so a sign-out lets them go.
  useEffect(() => {
    if (!accountSignedIn) setClosedTabs(NO_CLOSED_TABS);
  }, [accountSignedIn, setClosedTabs]);
  const planning = markedView(renamedView(renamedView(viewed, renames), drafts), marks);
  // The sidebar lists the chosen workspace's plans alone, and everything
  // else that finds a plan, the palette, the inbox, and the history, finds
  // it among them all; with no workspace listed yet, every plan is listed.
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
  const sidebar = sidebarTasks(planning.tasks);
  const listedSidebar = sidebarTasks(
    listedWorkspace === undefined
      ? planning.tasks
      : planning.tasks.filter((plan) => plan.workspaceId === listedWorkspace.id),
  );
  const listedWorkspaceId = listedWorkspace?.id;
  // The agents with no plan are listed by the same workspace as the plans, standing and archived apart as the plans are,
  // each pinned as given here until main's view carries it.
  const { tasklessAgents: planlessAgents } = planning;
  const listedAgents = useMemo(() => {
    const listed = agentsPinned(planlessAgents ?? NO_PLANLESS_AGENTS, agentPins).filter(
      (agent) => listedWorkspaceId === undefined || agent.workspaceId === listedWorkspaceId,
    );
    return {
      standing: listed.filter((agent) => agent.archivedAt === undefined),
      archived: listed.filter((agent) => agent.archivedAt !== undefined),
    };
  }, [planlessAgents, agentPins, listedWorkspaceId]);
  const { inboxWaiting, inboxPlans } = input;
  const listedInbox = useMemo(
    () => ({
      inbox: inWorkspace(inboxWaiting, planning.tasks, listedWorkspaceId),
      inboxPlans: inWorkspace(inboxPlans, planning.tasks, listedWorkspaceId),
    }),
    [inboxWaiting, inboxPlans, planning.tasks, listedWorkspaceId],
  );
  const signedIn = fixture !== undefined || input.signedIn;
  const page = tasksPage(planning);
  const region = documentRegion(planning);
  // A started agent's tab opens selected; the column's tabs are built after
  // the agents they draw, so the opening reaches them through this late binding.
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = viewed.document.task;
  // The open plan's own words, which a dictation into one of its agents' boxes listens for.
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
  // A fixture's plans have no agents, as they are read from nowhere.
  const agents = useCodingAgents({
    acts: input.acts,
    planId: fixture === undefined ? viewed.activeTaskId : undefined,
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
  // The calls heard on the open plan, each held past its end until the
  // record's copy catches up; a fixture's open plan is drawn with its own
  // call's words.
  const reported = fixture === undefined ? voice.view : FIXTURE_PLANNING_CALL;
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
  // A subagent's tab is held to the plan's work as an agent's is to its agents.
  const workers = useMemo(
    () => workerCallIds(workRowsOf(viewed.conversation, false)),
    [viewed.conversation],
  );
  // An agent Luke started in the call is in the work before it is in the
  // list, so the list is read again as its start answers, and the tab
  // appears as it does after a Start; a start already in the work when the
  // plan opens is read with the plan.
  const startedByLuke = useMemo(
    () => startedAgentCallIds(viewed.conversation),
    [viewed.conversation],
  );
  const startsSeen = useRef<{ planId: string | undefined; ids: ReadonlySet<string> }>({
    planId: undefined,
    ids: new Set(),
  });
  const readAgents = agents.onRetryList;
  useEffect(() => {
    const seen = startsSeen.current;
    const planId = viewed.activeTaskId;
    const landed = seen.planId === planId && startedByLuke.some((callId) => !seen.ids.has(callId));
    startsSeen.current = { planId, ids: new Set(startedByLuke) };
    if (landed) readAgents();
  }, [startedByLuke, viewed.activeTaskId, readAgents]);
  // A file's tab is held to the files Luke showed on the plan the same way.
  const files = useMemo(
    () => shownFiles(viewed.shownCode ?? []).map((ref) => ref.path),
    [viewed.shownCode],
  );
  const mainTabs = useMainTabs(
    fixture !== undefined,
    viewed.activeTaskId,
    agents.agentIds,
    agents.draft?.id,
    input.inboxWaiting.some((plan) => plan.taskId === viewed.activeTaskId),
    agents.heldIds,
  );
  mainRef.current = mainTabs;
  // A page's tab is held to the pages agents wrote for the plan.
  const pages = useMemo(() => (viewed.pages ?? []).map((page) => page.id), [viewed.pages]);
  // While an agent's page stands, the panel is that agent's: its workers', its Changes', and its
  // Terminal's tabs, and nothing of the plan the host has open beneath it, which keeps its own.
  const pageAgent = agentView?.agentId;
  const pageAgents = useMemo(
    () => (pageAgent === undefined ? undefined : [pageAgent]),
    [pageAgent],
  );
  const sidePanel = useSidePanel(
    fixtureSidePanel(input.run),
    pageAgents === undefined
      ? { id: viewed.activeTaskId, holds: planHolds(viewed, transcript) }
      : { id: pageAgent, holds: NO_HOLDS },
    pageAgents ?? mainTabs.openAgents,
    pageAgents === undefined ? workers : NO_IDS,
    pageAgents === undefined ? files : NO_IDS,
    pageAgents === undefined ? pages : NO_IDS,
    pageAgents ?? agents.agentIds,
  );
  // An agent pinned to the sidebar is named there as its tab is named now,
  // so a pin made before the agent had its title, or before a rename,
  // catches up while its plan is open.
  const pinLabels = useMemo(
    () =>
      new Map(
        (agents.agents ?? []).map((agent) => [agent.id, agentTabLabel(agent, agents.models)]),
      ),
    [agents.agents, agents.models],
  );
  const { onRenamePins } = sidePanel;
  useEffect(() => {
    if (viewed.activeTaskId !== undefined) onRenamePins(viewed.activeTaskId, pinLabels);
  }, [viewed.activeTaskId, pinLabels, onRenamePins]);
  // Main hears which agent's tab, or which plan's Inbox, is on screen, and
  // neither while the tab is away, the version history stands in the plan's
  // place, the side panel fills the window over the column, or the column
  // shows something else; a fixture's staged agents are no one's to announce.
  // The window's Inbox stands in the column's place, showing the plan whose item is chosen there.
  const columnShown =
    shown &&
    historyFor === undefined &&
    standIn === undefined &&
    fixture === undefined &&
    !sidePanel.fullScreen;
  // An agent's page stands in the plan's place, showing its agent as its tab would.
  const shownAgent =
    shown && fixture === undefined && agentView !== undefined
      ? agentView.agentId
      : columnShown && isAgentTab(mainTabs.tab)
        ? mainTabs.tab.agent
        : null;
  // The Inbox lists the listed workspace's items alone, so a choice another workspace's list made gives way with it.
  // Note that an agent's with no plan is held to the listed workspace by the list itself, which lists its workspace's alone.
  const inboxAsked = inboxView?.chosen;
  const inboxChosen =
    inboxAsked !== undefined &&
    (!("planId" in inboxAsked) ||
      inWorkspace([{ taskId: inboxAsked.planId }], planning.tasks, listedWorkspaceId).length > 0)
      ? inboxAsked
      : undefined;
  const shownInbox =
    shown && fixture === undefined && inboxView !== undefined
      ? inboxChosen !== undefined && "planId" in inboxChosen
        ? inboxChosen.planId
        : null
      : columnShown && mainTabs.tab === MAIN_TAB.INBOX
        ? (viewed.activeTaskId ?? null)
        : null;
  const reportedTab = useRef<{ agentId: string | null; inboxPlanId: string | null } | undefined>(
    undefined,
  );
  useEffect(() => {
    const was = reportedTab.current;
    if (was?.agentId === shownAgent && was.inboxPlanId === shownInbox) return;
    reportedTab.current = { agentId: shownAgent, inboxPlanId: shownInbox };
    tell(ACT_KIND.CODING_AGENTS_SHOWN, { agentId: shownAgent, inboxTaskId: shownInbox });
  }, [shownAgent, shownInbox, tell]);

  // The tab showing is what asks the host to read the plans again; the open
  // plan and its call stand through it going away, and a call's drafts reach
  // the document without any read. A fixture's plans are read from nowhere.
  const reading = shown && signedIn && fixture === undefined;
  const wasReading = useRef(false);
  useEffect(() => {
    if (reading === wasReading.current) return;
    wasReading.current = reading;
    if (reading) tell(ACT_KIND.TASKS_REFRESH);
  }, [reading, tell]);

  // The host answers a press a round trip later, so where the tab is bound
  // is said at once, and a select that did not open the plan takes its ask
  // back. A fixture's plans are opened nowhere, so nothing is asked of them.
  const openPlanId = planning.activeTaskId;
  const boundFor = asked !== undefined && asked.over === openPlanId ? asked.planId : openPlanId;
  // The version history is the plan's, so another plan, or none, leaves it.
  if (historyFor !== undefined && historyFor.planId !== boundFor) setHistoryFor(undefined);
  // A plan the service would not hand the reader has no history to show, so its Not found stands in the history's place, as a version's link may ask for one.
  const historyOpen =
    historyFor !== undefined &&
    historyFor.planId === boundFor &&
    region.kind !== DOCUMENT_REGION.MISSING;
  // A reveal is the open plan's, so another plan opening drops it, and
  // coming back asks nothing of the visit after.
  if (reveal !== undefined && reveal.planId !== boundFor) setReveal(undefined);
  const revealing = reveal !== undefined && reveal.planId === boundFor ? reveal.source : undefined;
  // A pin stays chosen while its plan stays open, whichever of its tabs is
  // shown: once its plan opens it is held there, and any other plan opening
  // lets it go. Note that this reads the plan open rather than the one asked
  // for, because an ask the host refuses leaves the pin chosen.
  if (chosen !== undefined && openPlanId !== chosen.over) {
    setChosen(openPlanId === chosen.pin.plan ? { pin: chosen.pin, over: openPlanId } : undefined);
  }
  // An answer clears the ask it answers, never one made since.
  const revealed = () => setReveal((held) => (held === reveal ? undefined : held));
  const listedId = listedWorkspace?.id;
  const plansNow = planning.tasks;
  const workspacesNow = viewed.workspaces;
  // The plan last open in each workspace, which a switch to it opens again.
  const lastOpenIn = useRef(new Map<string, string>());
  const openWorkspaceId = plansNow.find((plan) => plan.id === openPlanId)?.workspaceId;
  useEffect(() => {
    if (openPlanId !== undefined && openWorkspaceId !== undefined) {
      lastOpenIn.current.set(openWorkspaceId, openPlanId);
    }
  }, [openPlanId, openWorkspaceId]);
  // Opening a plan, or leaving one, is leaving the window's Inbox for it.
  // Note that `onOpened` runs only once the plan opened, because a plan that
  // would not open must not leave the sidebar on another workspace, this
  // launch or the next.
  const openPlan = useCallback(
    (planId: string, onOpened: () => void, onRefused: () => void = () => undefined) => {
      setStandIn(undefined);
      const ask = { planId, over: openPlanId };
      const withdraw = () => {
        setAsked((held) => (held === ask ? undefined : held));
        onRefused();
      };
      if (fixture === undefined) setAsked(ask);
      act(ACT_KIND.TASKS_SELECT, { taskId: planId }).then((opened) => {
        if (!opened) {
          withdraw();
          return;
        }
        onOpened();
      }, withdraw);
    },
    [act, fixture, openPlanId],
  );
  // A leave is asked rather than told, so a refused one takes its ask back too.
  const leavePlan = useCallback(() => {
    setStandIn(undefined);
    if (fixture !== undefined) return;
    const ask = { planId: undefined, over: openPlanId };
    setAsked(ask);
    act(ACT_KIND.TASKS_CLOSE).catch(() => setAsked((held) => (held === ask ? undefined : held)));
  }, [act, fixture, openPlanId]);
  // Every navigation a press asked for, counted, so an answer that lands
  // after a newer one was asked for changes nothing the newer one decided.
  const navigations = useRef(0);
  // A workspace chosen on purpose, from the switcher, a workspace made, or
  // one left, is listed at once, and the plan on screen follows: the plan
  // last open there opens again, where it is still that workspace's and not
  // archived, or else the home page, so the plan on screen is the listed
  // workspace's. A remembered plan that would not open gives way to the home
  // page, unless the developer went somewhere else meanwhile.
  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      navigations.current += 1;
      const mine = navigations.current;
      chooseListed(workspaceId);
      if (openWorkspaceId === undefined || openWorkspaceId === workspaceId) return;
      const last = lastOpenIn.current.get(workspaceId);
      const reopens = plansNow.some(
        (plan) =>
          plan.id === last && plan.workspaceId === workspaceId && plan.archivedAt === undefined,
      );
      if (last === undefined || !reopens) {
        leavePlan();
        return;
      }
      openPlan(
        last,
        () => undefined,
        () => {
          if (navigations.current === mine) leavePlan();
        },
      );
    },
    [chooseListed, openWorkspaceId, plansNow, openPlan, leavePlan],
  );
  // What the window lists and shows now, which a switch toast's Back reads
  // as it is pressed rather than as the toast was raised.
  const standingNow = useRef({ listed: listedId, open: openPlanId });
  standingNow.current = { listed: listedId, open: openPlanId };
  // A plan opened from another workspace, from the palette, the Inbox, a
  // notice, or the history, lists its workspace once it opened, so the
  // sidebar holds the plan open, and says so in a toast whose Back lists the
  // workspace left and returns to what stood open there. An open answered
  // after the developer went somewhere else lists nothing, and Back does
  // nothing once the window has moved on from the switch it reports.
  const select = useCallback(
    (planId: string) => {
      navigations.current += 1;
      const mine = navigations.current;
      const planWorkspace = plansNow.find((plan) => plan.id === planId)?.workspaceId;
      const target = workspacesNow.find((each) => each.id === planWorkspace);
      const from = workspacesNow.find((each) => each.id === listedId);
      const over = openPlanId;
      openPlan(planId, () => {
        if (navigations.current !== mine) return;
        if (target === undefined || target.id === listedId) return;
        chooseListed(target.id);
        if (from === undefined) return;
        const back = () => {
          const now = standingNow.current;
          if (now.listed !== target.id || now.open !== planId) return;
          navigations.current += 1;
          const backed = navigations.current;
          chooseListed(from.id);
          if (over === undefined) leavePlan();
          else {
            openPlan(
              over,
              () => undefined,
              () => {
                if (navigations.current === backed) leavePlan();
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
    [plansNow, workspacesNow, listedId, openPlanId, openPlan, chooseListed, toast, leavePlan],
  );

  // A fixture's plans are deleted nowhere, as they are read from nowhere. A
  // delete that landed says so in a toast, since its dialog has closed; a
  // refusal is said in the dialog that asked, unless the tab went away while
  // the delete was out and took the dialog with it.
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const deletePlan = async (planId: string): Promise<ActionResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await act(ACT_KIND.TASKS_DELETE, { taskId: planId }).catch(() => false);
    if (deleted) {
      toast({ words: PLAN_DELETED_NOTE, tone: TOAST_TONE.DONE, hold: TOAST_HOLD.DONE });
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    }
    if (!shownNow.current) {
      toast({ words: DELETE_REFUSED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    }
    return DELETE_REFUSED;
  };

  // A fixture's plans are renamed nowhere, as they are read from nowhere.
  const renamePlan = async (planId: string, name: string): Promise<boolean> => {
    if (fixture !== undefined) return false;
    setRenames((held) => new Map(held).set(planId, name));
    const renamed = await act(ACT_KIND.TASKS_RENAME, { taskId: planId, name }).catch(() => false);
    if (!renamed) {
      setRenames((held) =>
        held.get(planId) === name
          ? new Map([...held].filter(([pending]) => pending !== planId))
          : held,
      );
    }
    return renamed;
  };

  // The open plan as it stands when an archive is answered, which may be
  // another than the one open when it was pressed.
  const openNow = useRef(openPlanId);
  openNow.current = openPlanId;

  // A fixture's plans are marked nowhere, as they are read from nowhere. A
  // refusal puts back the mark it drew only while no later press replaced it,
  // and says so in a toast, since the menu that asked has closed. An archive
  // that landed, or an unarchive, says so with an Undo, which marks the plan
  // back and opens it again if the archive had left it; an undoing says
  // nothing of its own unless it is refused. Note that the open plan is left
  // only once its archive is answered, because leaving ends its call, which a
  // refusal could not give back, nor can an Undo.
  const markPlan = (planId: string, mark: TaskMark, undoing?: { reopen: boolean }) => {
    if (fixture !== undefined) return;
    const next = { ...marks.get(planId), ...pendingMark(mark, Date.now()) };
    setMarks((held) => new Map(held).set(planId, next));
    const pinning = mark === TASK_MARK.PIN || mark === TASK_MARK.UNPIN;
    const asked = pinning
      ? act(ACT_KIND.TASKS_PIN, { taskId: planId, pinned: mark === TASK_MARK.PIN })
      : act(ACT_KIND.TASKS_ARCHIVE, { taskId: planId, archived: mark === TASK_MARK.ARCHIVE });
    asked
      .catch(() => false)
      .then((changed) => {
        if (!changed) {
          setMarks((held) =>
            held.get(planId) === next
              ? new Map([...held].filter(([pending]) => pending !== planId))
              : held,
          );
          toast({
            words: MARK_FAILED_NOTES[mark],
            tone: TOAST_TONE.FAILED,
            hold: TOAST_HOLD.FAILED,
          });
          return;
        }
        const left = mark === TASK_MARK.ARCHIVE && openNow.current === planId;
        if (left) leavePlan();
        if (undoing?.reopen) selectNow.current(planId);
        if (pinning || undoing !== undefined) return;
        const { note, undo } = MARK_UNDOS[mark];
        toast({
          words: note,
          tone: TOAST_TONE.DONE,
          action: {
            label: UNDO_LABEL,
            onPress: () => markNow.current(planId, undo, { reopen: left }),
          },
        });
      });
  };
  // A fixture's repositories are pinned nowhere, as its plans are marked
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

  // Several plans archived at once answer with one toast rather than one
  // each, so its Undo brings back every plan the service kept, and opens
  // again the open plan where the archive left it. A plan the service
  // refused goes back where it was, and the toast counts it. Note that the
  // plans share one stamp, because they were archived by one press, so they
  // stand under Archived in the order they were listed rather than in an
  // order set by whether the clock ticked between two of them.
  const archivePlans = (planIds: readonly string[]) => {
    if (fixture !== undefined || planIds.length === 0) return;
    const at = Date.now();
    const asked = planIds.map((planId) => ({
      planId,
      next: { ...marks.get(planId), ...pendingMark(TASK_MARK.ARCHIVE, at) },
    }));
    setMarks(
      (held) => new Map([...held, ...asked.map(({ planId, next }) => [planId, next] as const)]),
    );
    const answers = asked.map(({ planId }) =>
      act(ACT_KIND.TASKS_ARCHIVE, { taskId: planId, archived: true }).catch(() => false),
    );
    Promise.all(answers).then((changed) => {
      const refused = asked.filter((_, index) => !changed[index]);
      const landed = asked.filter((_, index) => changed[index]).map(({ planId }) => planId);
      setMarks(
        (held) =>
          new Map(
            [...held].filter(([pending, mark]) =>
              refused.every((each) => each.planId !== pending || each.next !== mark),
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
      const left = landed.find((planId) => planId === openNow.current);
      if (left !== undefined) leavePlan();
      toast({
        words: archivedTasksNote(landed.length, refused.length),
        tone: TOAST_TONE.DONE,
        action: {
          label: UNDO_LABEL,
          onPress: () => {
            for (const planId of landed) {
              markNow.current(planId, TASK_MARK.UNARCHIVE, { reopen: planId === left });
            }
          },
        },
      });
    });
  };
  // An Undo is pressed renders after its archive landed, so it marks, and
  // opens, through the tab as it stands then rather than as it stood.
  const markNow = useRef(markPlan);
  markNow.current = markPlan;
  const restoring = useLastPlan({
    staged: fixture !== undefined,
    account: input.account,
    plans: planning.tasks,
    listStatus: planning.listStatus,
    openPlanId,
    boundFor,
    select,
  });
  const selectNow = useRef(select);
  selectNow.current = select;

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(planMarkdown(region.task), PLAN_COPIED_NOTE);
  };

  const microphone = microphoneButton({
    voiceAvailable: input.voiceAvailable,
    microphoneStatus: input.microphoneStatus,
    activeTaskId: planning.activeTaskId,
    archived: region.kind === DOCUMENT_REGION.READY && region.task.archivedAt !== undefined,
    listening: voice.listening,
    callTaskId: voice.view.callTaskId,
    voiceStatus: voice.view.voiceStatus,
  });
  const live = callInProgress(voice.view) && voice.view.callTaskId === planning.activeTaskId;
  // A press that would open a call here while one stands about another plan
  // ends that call, so it asks first; the answer is the same Talk press, and
  // Cancel leaves the call standing as it was. The talk key never asks: it
  // speaks into the call standing, whatever plan is open. The question is the
  // plan's it was asked on, so it goes the moment another plan opens (the
  // press would talk about whichever plan the host has open), and its surface
  // is the plan's page, which a version history covers.
  const callElsewhere =
    callInProgress(voice.view) && voice.view.callTaskId !== planning.activeTaskId;
  const [askedFor, setAskedFor] = useState<string>();
  const secondCallFor = callElsewhere && askedFor !== undefined ? askedFor : undefined;
  const secondCall = useConfirmDialog(
    { subject: secondCallFor === planning.activeTaskId, surfaceOpen: shown && !historyOpen },
    () =>
      act(ACT_KIND.TASKS_TALK).then(
        (): ActionResult => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
        (refused: Error): ActionResult => ({
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: refused.message,
        }),
      ),
  );
  // A started plan asks once it is the plan open, which the host may say
  // only after the start's own answer has come back.
  const askOnOpen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (askOnOpen.current === undefined || askOnOpen.current !== secondCallFor) return;
    if (secondCallFor !== planning.activeTaskId) return;
    askOnOpen.current = undefined;
    secondCall.ask();
  });
  const callingNow = useRef(callElsewhere);
  callingNow.current = callElsewhere;
  // The press names no plan: main reads the one the host has open, and the
  // voice window, which owns the call, opens it about that plan or toggles it.
  const pressMicrophone = () => {
    if (microphone.press === MICROPHONE_PRESS.ASK_ACCESS) voice.requestMicrophoneAccess();
    if (microphone.press === MICROPHONE_PRESS.OPEN_SETTINGS)
      tell(ACT_KIND.MICROPHONE_OPEN_SETTINGS);
    if (microphone.press === MICROPHONE_PRESS.TALK) {
      if (!callElsewhere) tell(ACT_KIND.TASKS_TALK);
      else {
        setAskedFor(planning.activeTaskId);
        secondCall.ask();
      }
    }
  };

  // A fixture's staged plan has nothing arriving on it, and code arrives
  // only on a call, since what a plan opens with it already held.
  const arrivedTabs = usePanelArrivals({
    // Note that nothing arrives while an agent's page holds the panel, so the plan's visit ends, and what it gained meanwhile counts as seen.
    planId: fixture === undefined && pageAgent === undefined ? planning.activeTaskId : undefined,
    board: planning.board,
    code: live ? (planning.shownCode ?? []) : undefined,
    pages: live ? (planning.pages ?? NO_PAGES) : undefined,
    panel: sidePanel,
  });
  // An agent that ended unseen marks its tab unread as an arrival does; main
  // clears it once the tab is shown.
  const unreadTabs: readonly StripTab[] = [
    ...arrivedTabs,
    ...input.unseenAgents.map((agent) => ({ agent })),
  ];

  // A fixture's repositories are read from nowhere, as its plans are. The
  // chip lists the repositories of the workspace its plan is in: the open
  // plan's, else the one New plan starts in.
  const repositoriesOf =
    region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : listedWorkspace?.id;
  const openGitHub = (url: string) => tell(ACT_KIND.GITHUB_OPEN, { url });
  /**
   * The repository chip's list for one workspace: the repositories its plans
   * were about lately that its GitHub reaches, newest first, so a plan never
   * starts on another workspace's nor on one a plan stranded there by #2524
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
        ? planning.tasks
        : planning.tasks.filter((plan) => plan.workspaceId === workspaceId);
    // Note that the plans are filtered before the recent ones are counted,
    // because a few newer stranded plans would otherwise crowd out an older
    // repository the workspace does reach.
    const offered =
      workspace === undefined
        ? own
        : own.filter(
            (plan) => plan.repository !== null && workspaceReaches(workspace, plan.repository),
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

  // A fixture's plans are given no repository, as they are read from nowhere.
  const setRepository = (
    planId: string,
    repository: string | null,
  ): Promise<string | undefined> => {
    if (fixture !== undefined) return Promise.resolve(undefined);
    return act(ACT_KIND.TASKS_SET_REPOSITORY, { taskId: planId, repository }).then(
      (answer) => ("failure" in answer ? repositoryFailureNote(answer.failure) : undefined),
      (refused: Error) => refused.message,
    );
  };

  // A fixture's plans move nowhere, as they are read from nowhere. Note that
  // the workspace moves with the plan, because the sidebar lists one
  // workspace's plans and the open plan must not drop out of it, but only
  // while that plan is still open and no workspace was chosen since, so a
  // move answered late never undoes where the developer went meanwhile.
  const movePlan = (
    planId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ): Promise<boolean> => {
    if (fixture !== undefined) return Promise.resolve(false);
    const choicesThen = workspaceChoices.current;
    return act(ACT_KIND.TASKS_MOVE, { taskId: planId, workspaceId })
      .catch(() => ({ failure: TASK_CALL_FAILURE.UNANSWERED }) as const)
      .then((answer) => {
        if (!("failure" in answer)) {
          // A first workspace read landing meanwhile lists one too, but nobody chose it.
          if (openNow.current === planId && workspaceChoices.current === choicesThen) {
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

  // A fixture's plans are read from nowhere, so an edit of one is never saved.
  const edit = (planId: string, request: PlanEditRequest): Promise<TasksEditAnswer> => {
    if (fixture !== undefined) return Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });
    return act(ACT_KIND.TASKS_EDIT, { taskId: planId, edit: request });
  };

  // The chip's menu stands on the open plan's toolbar, so another plan's is
  // opened first; the ask is counted so each press opens it again.
  const changeRepository = (planId: string) => {
    if (planId !== planning.activeTaskId) select(planId);
    setRepositoryMenu((held) => ({ planId, request: (held?.request ?? 0) + 1 }));
  };

  const repositoryOf = (planId: string): string | null =>
    planning.tasks.find((plan) => plan.id === planId)?.repository ??
    (region.kind === DOCUMENT_REGION.READY && region.task.id === planId
      ? region.task.repository
      : null);

  // A fixture's plan has no history, as it is read from nowhere.
  const historySource = useMemo(
    (): PlanHistorySource => ({
      readPage: (planId, before) =>
        act(ACT_KIND.TASKS_REVISIONS, {
          taskId: planId,
          ...(before === undefined ? undefined : { before }),
        }),
      readRevision: (planId, seq) => act(ACT_KIND.TASKS_REVISION, { taskId: planId, seq }),
      restore: (planId, seq) => act(ACT_KIND.TASKS_RESTORE, { taskId: planId, seq }),
    }),
    [act],
  );
  const history = usePlanHistory({
    source: historySource,
    planId:
      fixture === undefined && region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined,
    editedAt: region.kind === DOCUMENT_REGION.READY ? region.task.lastEdit?.at : undefined,
    name: region.kind === DOCUMENT_REGION.READY ? region.task.name : undefined,
    shown: shown && historyOpen,
    seek: historyFor?.save,
    returnTo: historyFor?.spot,
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) => sayRestored(toast, undo),
  });

  // A started plan becomes the host's open one, which turns the page to it,
  // so the dialog closes and the Inbox or a version history standing behind
  // it gives way. It starts in the chosen workspace; with none listed the
  // service starts it in the account's first one. A name left blank is not
  // sent, and the plan stands as Untitled. A start opens its
  // plan's call at once, except over a call standing about another plan,
  // which main leaves for this question to end or keep.
  const startPlan = (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    linearIssueId?: string,
  ): Promise<string | undefined> =>
    act(ACT_KIND.TASKS_START, {
      ...(name.length === 0 ? undefined : { name }),
      ...(repository === null ? undefined : { repository }),
      ...(workspaceId === undefined ? undefined : { workspaceId }),
      ...(linearIssueId === undefined ? undefined : { linearIssueId }),
    }).then(
      (answer) => {
        if ("failure" in answer) return startFailureNote(answer.failure);
        setNewPlanAsk(undefined);
        setStandIn(undefined);
        setHistoryFor(undefined);
        if (callingNow.current) {
          askOnOpen.current = answer.planId;
          setAskedFor(answer.planId);
        }
        return undefined;
      },
      (refused: Error) => refused.message,
    );

  // A plan started from a Linear issue is named by its title, cut to a
  // name's bound, and starts where the dialog would have: the listed
  // workspace, on the newest repository its plans were about that its
  // GitHub reaches.
  const listedLinear = listedWorkspace?.linear?.active === true ? listedWorkspace : undefined;
  const linearPicker: PlansControl["newPlan"]["linear"] =
    listedLinear === undefined
      ? undefined
      : {
          issues: () => act(ACT_KIND.WORKSPACE_LINEAR_ISSUES, { workspaceId: listedLinear.id }),
          start: (issue) =>
            startPlan(
              taskNameOfIssue(issue),
              repositoriesIn(listedLinear.id).recent[0] ?? null,
              listedLinear.id,
              issue.id,
            ),
        };

  // New plan opens the dialog over whatever stands, an open plan and its
  // call included, which stay until a plan is started. Note that a press
  // while the dialog stands, as the menu bar's still can, leaves it as it is,
  // because a fresh ask would keep the card's draft under another preset.
  const newPlanWith = (preset: PlansControl["newPlan"]["preset"]) =>
    setNewPlanAsk((standing) => standing ?? { preset });
  // The dialog is the Plans tab's, so Settings taking the window puts it
  // away rather than leaving it to stand again on the way back.
  if (!shown && newPlanAsk !== undefined) setNewPlanAsk(undefined);

  // A plan's version history opens over the plan, so another plan opens first.
  const openHistory = (opening: HistoryOpening) => {
    if (opening.planId !== boundFor) select(opening.planId);
    setStandIn(undefined);
    setHistoryFor(opening);
  };

  // A plan's own tab, its Inbox, and an agent's are in its column, so a
  // version history over it gives way, and so does a side panel filling the
  // window over it.
  const showColumnTab = (planId: string, tab: MainTab) => {
    if (planId !== planning.activeTaskId) select(planId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(planId, tab);
  };

  // A tab of the side panel, on its plan, out from under a version history or whatever stands in the plan's place.
  const showPanelTab = (planId: string, tab: SidePanelTab) => {
    if (planId !== planning.activeTaskId) select(planId);
    setStandIn(undefined);
    setHistoryFor(undefined);
    sidePanel.onShow(planId, tab);
  };

  // A link's workspace, by its slug or its id, listed where the account is in it and another is listed.
  const listLinked = (workspace: string) => {
    const home = viewed.workspaces.find((each) => each.slug === workspace || each.id === workspace);
    if (home !== undefined && home.id !== listedWorkspace?.id) chooseListed(home.id);
  };

  // A version's Open lands where its writer wrote it: an agent's tab as a
  // notification opens it, or the side panel's Call tab, asked to
  // bring the call or the turn into view once it draws.
  const showSource = (planId: string, source: RevisionSource) => {
    if (source.kind === REVISION_SOURCE.AGENT) {
      showColumnTab(planId, { agent: source.agentId });
      return;
    }
    setReveal({ planId, source });
    showPanelTab(planId, SIDE_PANEL_TAB.CALL);
  };

  // Each ask is its own, so the same section asked twice scrolls twice.
  const showMention = (mention: PlanMention) => {
    showColumnTab(mention.taskId, MAIN_TAB.PLAN);
    const anchor = mention.kind === MENTION_KIND.SECTION ? mention.anchor : undefined;
    sectionAsks.current += 1;
    setSectionReveal({ planId: mention.taskId, reveal: { anchor, ask: sectionAsks.current } });
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
          planId: place.planId,
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
        showPanelTab(place.planId, { changes: place.agentId });
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
      case LINK_PLACE.INBOX:
        listLinked(workspace);
        standInFor({ kind: STAND_IN.INBOX, chosen: undefined });
        return;
      case LINK_PLACE.INBOX_ITEM:
        // An item of a task the account lists is shown in the task's own workspace, whatever the slug says.
        listLinked(
          ("planId" in place
            ? viewed.tasks.find((plan) => plan.id === place.planId)?.workspaceId
            : undefined) ?? workspace,
        );
        standInFor({
          kind: STAND_IN.INBOX,
          chosen:
            "planId" in place
              ? { planId: place.planId, itemId: place.itemId, opened: true }
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
      // Settings is the window's, not the Plans tab's, so its link is opened there.
      case LINK_PLACE.SETTINGS:
        return;
    }
  };

  // An inbox item's code opens in its plan's File tab; on a plan not yet
  // open, once the host has it open, since the panel draws the open plan's.
  const showFile = (planId: string, ref: CodeRef, commit: string) => {
    setStandIn(undefined);
    setHistoryFor(undefined);
    if (planId === planning.activeTaskId) {
      sidePanel.onOpenFile(ref, commit);
      return;
    }
    select(planId);
    setFileFor({ planId, ref, commit });
  };
  // A file asked for is the plan's it was asked on, so a select refused, or
  // another plan asked for since, lets it go.
  if (fileFor !== undefined && fileFor.planId !== boundFor) setFileFor(undefined);
  const { onOpenFile } = sidePanel;
  useEffect(() => {
    if (fileFor === undefined || fileFor.planId !== planning.activeTaskId) return;
    setFileFor(undefined);
    onOpenFile(fileFor.ref, fileFor.commit);
  }, [fileFor, planning.activeTaskId, onOpenFile]);

  // Every tab closed is kept as it stood for ⇧⌘T to open again: the plan's
  // tab never closes, and a draft's lets its draft go, so neither is kept.
  const openTabs = mainTabs.tabs;
  const closeMainTab = mainTabs.onClose;
  // A planning worker's tab reads its session as an agent's worker's tab does, the plan standing in the agent's place.
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
      const at = openTabs.findIndex((each) => sameTab(each, tab));
      const plan = viewed.activeTaskId;
      if (plan !== undefined && at > 0 && !isDraftTab(tab)) {
        const closed = { strip: CLOSED_TAB_STRIP.COLUMN, plan, tab, at: at - 1 };
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
      const plan = viewed.activeTaskId;
      if (plan !== undefined && at >= 0) {
        const file = isFileTab(tab) ? panelFiles.find((each) => each.path === tab.file) : undefined;
        const closed = { strip: CLOSED_TAB_STRIP.SIDE_PANEL, plan, tab, at, file };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
      closePanelTab(tab);
    },
    [panelStrip, panelFiles, closePanelTab, viewed.activeTaskId, setClosedTabs, latestClosedTabs],
  );
  // Whether the open plan's strips draw a closed tab of it again: an agent's
  // while the agent is not archived, the Inbox while the plan holds an
  // agent, and a subagent's, a Changes or Terminal tab, or a page's on the strip's own
  // terms. Note that what the plan has not read yet counts as drawn, as the
  // strips stand a tab until the read says otherwise.
  const drawsAgain = (closed: ClosedTab): boolean => {
    const { tab } = closed;
    const agentIds = agents.agentIds;
    if (closed.strip === CLOSED_TAB_STRIP.COLUMN) {
      if (isAgentTab(tab)) return agentIds === undefined || agentIds.includes(tab.agent);
      if (tab !== MAIN_TAB.INBOX) return true;
      const held = agents.heldIds;
      const waiting = input.inboxWaiting.some((plan) => plan.taskId === closed.plan);
      return held === undefined || held.length > 0 || waiting;
    }
    if (isSubagentTab(tab))
      return drawsSubagent(tab, { agents: mainTabs.openAgents, subagents: workers });
    if (isChangesTab(tab)) return drawsChanges(tab, { planAgents: agentIds });
    if (isPageTab(tab)) return viewed.pages === undefined || pages.includes(tab.page);
    if (isTerminalTab(tab)) return drawsTerminal(tab, { planAgents: agentIds });
    return true;
  };
  const reopenable = withUndrawnPassed(closedTabs, planning.activeTaskId, drawsAgain);
  // A closed tab opens again where it stood, in its strip at its place and
  // showing what it showed, so a version history or the window's Inbox over
  // the plan gives way, and a side panel filling the window over its column.
  // One the plan no longer draws, read only once a reopen opened its plan, opens nothing.
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
  // A tab closed on another plan opens once the host has that plan open.
  // Note that a press while one waits on its plan takes the next tab only
  // where it is that same plan's, because asking for another plan would let
  // the waiting one go; it waits its turn on the stack instead.
  const reopenClosedTab = () => {
    const waiting = latestReopenFor();
    const open = waiting.length === 0 ? planning.activeTaskId : undefined;
    const stack = withUndrawnPassed(latestClosedTabs(), open, drawsAgain);
    const closed = stack.at(-1);
    if (closed === undefined || (waiting.length > 0 && waiting[0]?.plan !== closed.plan)) return;
    setClosedTabs(stack.slice(0, -1));
    if (waiting.length === 0 && closed.plan === planning.activeTaskId) {
      reopenHere(closed);
      return;
    }
    if (waiting.length === 0) select(closed.plan);
    setReopenFor([...waiting, closed]);
  };
  // A reopen is the plan's it was asked on, so a select refused, or another
  // plan asked for since, puts the tabs waiting on it back, as they stood.
  useEffect(() => {
    const waiting = latestReopenFor();
    if (waiting.length === 0 || waiting[0]?.plan === boundFor) return;
    setReopenFor(NO_CLOSED_TABS);
    setClosedTabs([...latestClosedTabs(), ...waiting.toReversed()]);
  }, [boundFor, latestReopenFor, setReopenFor, latestClosedTabs, setClosedTabs]);
  const reopenNow = useRef(reopenHere);
  reopenNow.current = reopenHere;
  useEffect(() => {
    if (reopenFor.length === 0 || reopenFor[0]?.plan !== planning.activeTaskId) return;
    setReopenFor(NO_CLOSED_TABS);
    for (const closed of reopenFor) reopenNow.current(closed);
  }, [reopenFor, planning.activeTaskId, setReopenFor]);

  // The home page is where the tab rests, so only an open plan steps back,
  // and a panel filling the window over it is the nearer layer.
  const back = useCallback((): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leavePlan();
    return true;
  }, [leavePlan, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  return {
    page,
    restoring,
    shown,
    signedIn,
    me: fixture === undefined ? input.accountId : undefined,
    plans: [...sidebar.pinned, ...sidebar.rest],
    archived: sidebar.archived,
    listed: {
      plans: [...listedSidebar.pinned, ...listedSidebar.rest],
      archived: listedSidebar.archived,
      inbox: listedInbox.inbox,
      inboxPlans: listedInbox.inboxPlans,
    },
    listedAgents,
    workspaces: viewed.workspaces,
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
    // switch reopens the plan last open there, and a leave goes Home; the
    // navigation it counts passes over any open still on its way.
    onLeftWorkspace: (workspaceId) => {
      const others = viewed.workspaces.filter((each) => each.id !== workspaceId);
      const next = others.find((each) => each.personal === true) ?? others[0];
      navigations.current += 1;
      if (next !== undefined) chooseListed(next.id);
      if (boundFor === undefined) setStandIn(undefined);
      else leavePlan();
    },
    github: viewed.github,
    onConnectAccountGitHub: () => accountGitHub(ACT_KIND.GITHUB_CONNECT),
    onDisconnectAccountGitHub: () => accountGitHub(ACT_KIND.GITHUB_DISCONNECT),
    activePlanId: planning.activeTaskId,
    boundFor,
    listFailed: planning.listStatus === TASKS_READ.FAILED,
    listRead: planning.listStatus === TASKS_READ.READY,
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
    // A fixture's open plan is drawn on a call with Luke working, read from
    // the fixture's own call rather than a voice window that holds none.
    status: callStatus(reported, planning),
    live,
    mainTabs: { ...mainTabs, onClose: closeColumnTab },
    sidePanel: { ...sidePanel, onClose: closeSidePanelTab },
    unreadTabs,
    board: planning.board,
    shownCode: planning.shownCode,
    pages: planning.pages,
    transcript: {
      region: transcript,
      onRetry: () => tell(ACT_KIND.TASKS_REFRESH),
      reveal:
        revealing?.kind === REVISION_SOURCE.CALL
          ? { call: revealing.callId, onRevealed: revealed }
          : undefined,
    },
    // A fixture's open plan is drawn mid-call, as its status and transcript are.
    work: {
      conversation: planning.conversation,
      callLive: fixture === undefined ? live : reported.callTaskId === planning.activeTaskId,
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
      onOpen: (planId, save) => openHistory({ planId, save, spot: undefined }),
      onReturn: (planId, spot) => openHistory({ planId, save: undefined, spot }),
      onClose: () => setHistoryFor(undefined),
    },
    // Note that the pin's own plan opened by its row is the plan the
    // sidebar marks again rather than the pin; another plan's lets the pin
    // go only once it opens.
    onSelect: guard((planId: string) => {
      setChosen((held) => (held?.pin.plan === planId ? undefined : held));
      select(planId);
    }),
    onShowAgent: guard((planId: string, agentId: string) =>
      showColumnTab(planId, { agent: agentId }),
    ),
    inbox: input.inboxWaiting,
    inboxShown: shownInbox,
    inboxPlans: input.inboxPlans,
    inboxPlanless: input.inboxPlanless,
    failedRuns: input.failedRuns,
    // The window's Inbox stands over the plan's place, so a version history there gives way.
    inboxView: {
      open: inboxView !== undefined,
      chosen: inboxChosen,
      onOpen: guard(() => {
        setHistoryFor(undefined);
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX ? held : { kind: STAND_IN.INBOX, chosen: undefined },
        );
      }),
      onClose: guard(() => setStandIn(undefined)),
      onChoose: (chosen) =>
        setStandIn((held) =>
          held?.kind === STAND_IN.INBOX ? { kind: STAND_IN.INBOX, chosen } : held,
        ),
    },
    // An agent's page stands over the plan's place as the Inbox does, so a version history there gives way.
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
    // Factory stands over the plan's place as the Inbox and an agent's page do, each giving way to the others.
    factoryView: {
      open: standIn?.kind === STAND_IN.FACTORY,
      onOpen: guard(() => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.FACTORY });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    // The Automations page stands over the plan's place as Factory does, each giving way to the others.
    automationsView: {
      open: standIn?.kind === STAND_IN.AUTOMATIONS,
      place: standIn?.kind === STAND_IN.AUTOMATIONS ? standIn.place : AUTOMATIONS_LIST,
      onOpen: guard((place: AutomationsPlace = AUTOMATIONS_LIST) => {
        setHistoryFor(undefined);
        setStandIn({ kind: STAND_IN.AUTOMATIONS, place });
      }),
      onClose: guard(() => setStandIn(undefined)),
    },
    callTaskId: callInProgress(reported) ? reported.callTaskId : undefined,
    onShowFile: showFile,
    // A version's Open lands where its writer wrote it: an agent's tab as a
    // notification opens it, or the side panel's Call tab, asked to
    // bring the call or the turn into view once it draws.
    onShowSource: guard(showSource),
    // The call card's way back lands where the plan's call bar is in sight.
    secondCall: {
      confirm: secondCall,
      question: secondCallQuestion(callCard({ view: voice.view, tasks: planning }).taskName),
    },
    onShowPlan: guard((planId: string) => showColumnTab(planId, MAIN_TAB.PLAN)),
    // Each ask is its own, so the same section asked twice scrolls twice.
    onShowMention: guard(showMention),
    onOpenLink: guard((link: ReadLink) => openLink(link)),
    messageReveal,
    // Only the ask answered is let go; a newer one stands until its agent's tab answers it.
    onMessageRevealed: (ask) => setMessageReveal((last) => (last?.ask === ask ? undefined : last)),
    sectionReveal,
    // Only the ask shown is let go; a newer one stands until its own plan shows it.
    onSectionRevealed: (ask) =>
      setSectionReveal((last) => (last?.reveal.ask === ask ? undefined : last)),
    onShowInbox: guard((planId: string) => showColumnTab(planId, MAIN_TAB.INBOX)),
    // A pinned tab is in one of the plan's columns, so a version history over it gives way as well.
    onOpenPinnedTab: guard((pin: PinnedTab) => {
      const { tab } = pin;
      setChosen({ pin, over: openPlanId });
      if (pin.plan !== planning.activeTaskId) select(pin.plan);
      setStandIn(undefined);
      setHistoryFor(undefined);
      if (!inColumn(tab)) {
        sidePanel.onShow(pin.plan, tab);
        return;
      }
      if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
      mainTabs.onShow(pin.plan, tab);
    }),
    chosenPin: chosen !== undefined && chosen.pin.plan === boundFor ? chosen.pin : undefined,
    onReopenClosedTab: reopenable.length === 0 ? undefined : reopenClosedTab,
    repositories: repositoriesIn(repositoriesOf),
    repositoryMenu,
    onChangeRepository: changeRepository,
    onSetRepository: setRepository,
    onMovePlan: movePlan,
    onOpenWorkspaceGitHub: (planId) => {
      // The open document names its workspace where the list read did not land.
      const workspaceId =
        planning.tasks.find((plan) => plan.id === planId)?.workspaceId ??
        (region.kind === DOCUMENT_REGION.READY && region.task.id === planId
          ? region.task.workspaceId
          : undefined);
      input.onOpenSettings({
        page: SETTINGS_VIEW.WORKSPACE,
        section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
        ...(workspaceId === undefined ? undefined : { workspaceId }),
      });
    },
    onOpenOnGitHub: (planId) => {
      const repository = repositoryOf(planId);
      if (repository !== null) openGitHub(repositoryPageUrl(repository));
    },
    onRetryList: () => tell(ACT_KIND.TASKS_REFRESH),
    onRetryDocument: () => {
      if (planning.activeTaskId !== undefined) select(planning.activeTaskId);
    },
    onNewPlan: () => newPlanWith(undefined),
    onNewPlanIn: (repository) => newPlanWith({ repository }),
    newPlan: {
      open: newPlanAsk !== undefined,
      preset: newPlanAsk?.preset,
      workspaces: viewed.workspaces,
      workspaceId: listedWorkspace?.id,
      repositoriesIn,
      start: startPlan,
      onClose: () => setNewPlanAsk(undefined),
      linear: linearPicker,
    },
    onLeavePlan: guard(() => leavePlan()),
    // Home is the page with no plan open, so where none is, only the Inbox, an
    // agent's page, or Factory standing over it is put away, and the host is asked nothing.
    onGoHome: guard(() => (boundFor === undefined ? setStandIn(undefined) : leavePlan())),
    onRenamePlan: renamePlan,
    onDraftName: draftName,
    onMarkPlan: (planId, mark) => markPlan(planId, mark),
    onArchivePlans: archivePlans,
    pinnedRepositories: pinnedRepositories(viewed.repositoryPins, repositoryPins),
    onPinRepository: pinRepository,
    onPinAgent: pinAgent,
    onDeletePlan: deletePlan,
    back,
    leaveGuard,
  };
}
