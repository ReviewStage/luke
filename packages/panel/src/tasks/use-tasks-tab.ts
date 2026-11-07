import type { AccountFailedRun } from "@repo/features/account-inbox-wire";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import type {
  AgentAttachment,
  AgentSummary,
  ListedAgent,
  TasklessAgent,
} from "@repo/features/agent-wire";
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
  taskLinkStep,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { type DescriptionMention, MENTION_KIND } from "@repo/features/mention-link";
import type { CatalogModel, MacOffer, ModelChoice } from "@repo/features/models-wire";
import type { PageLine } from "@repo/features/page-wire";
import { SENTRY_SEND_SPAN } from "@repo/features/sentry-tracing";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { agentMovedAt, agentsOfTask } from "@repo/features/task-agents-model";
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
import { APP_SETTING_DEFAULTS, EXPERIMENT, experimentOn } from "@repo/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";
import { STATUS_TONE } from "@repo/ui";
import {
  agentTab,
  changesTab,
  draftTab,
  pageTab,
  pullRequestLabelOf,
  STRIP_TAB_KIND,
  type StripTab,
  sameTab,
  subagentTab,
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
import { useRouter } from "@tanstack/react-router";
import { absurd } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { actMutation, pressMutation, sendMutation } from "../act-mutations.js";
import { type AdminView, adminViewOfLink } from "../admin/routing.js";
import type { AgentRoute } from "../agent-route.js";
import { appPlatform } from "../app-platform.js";
import type { AutomationsRoute } from "../automations-route.js";
import { useCopyToast } from "../copy-feedback.js";
import { useChosenWorkspace } from "../desktop/chosen-workspace.js";
import type { InboxAt, InboxRoute } from "../inbox-route.js";
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
import { LINK_ROUTED_PLACE, type RoutedLink, routedLinkOf } from "../places/link-places.js";
import type { LinkRead } from "../places/link-reads.js";
import { PLACE_BINDING, useTaskAsk } from "../places/place-binding.js";
import type { RoutedPlace } from "../places/routed-places.js";
import { type LinkStep, type TaskAt, taskAtOf, taskOfAt } from "../places/task-step.js";
import type { RenameShape } from "../rename-write.js";
import { ADDRESS, HERE, type OverviewPlace, ROUTE, route } from "../route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import type { TaskRoute } from "../task-route.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { pressRows, ROW_WRITE, type RowDoors, type TaskRows } from "../undo-stack.js";
import {
  appStateIn,
  appStateQuery,
  selectAppSettingsView,
  selectWorkspaces,
} from "../use-app-state.js";
import type { VersionHistoryRoute } from "../version-history-route.js";
import { workspaceExperimentChoices } from "../workspace-experiments.js";
import type {
  BoardRoute,
  HomeRoute,
  PersonRoute,
  UnknownWorkspaceRoute,
} from "../workspace-routes.js";
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
import {
  stripTabClosesIdle,
  stripTabDrawsAgain,
  stripTabEndsSession,
  stripTabLink,
  stripTabPin,
  stripTabReopens,
  TAB_PIN,
} from "./strip-tab-kinds.js";
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
import { useInboxTaskAgents } from "./use-inbox-task-agents.js";
import {
  isOverviewTab,
  MAIN_TAB,
  type MainTab,
  type MainTabsControl,
  useMainTabs,
} from "./use-main-tabs.js";
import {
  DRAWN_KINDS,
  SIDE_PANEL_TAB,
  type SidebarPin,
  type SidePanelControl,
  type SidePanelTab,
  type TaskHolds,
  useSidePanel,
} from "./use-side-panel.js";
import { useEndTerminalTab, useHeldTerminalTabs } from "./use-terminal-session.js";
import { useWarmAgent } from "./use-warm-agent.js";
import { listedAgentIn } from "./use-workspace-agents.js";
import { sayRestored } from "./version-view.js";

/**
 * use-tasks-tab.ts -- the panel's Tasks tab as one control: which page shows, the presses each page makes, and the host's read of the tasks as the tab shows.
 *
 * The tab draws the tasks view main holds, and every press is an act. It
 * saves nothing and decides nothing about a task: the task's notetaker writes
 * the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename, a pin, and an
 * archive are the presses drawn before the host answers them: each shows at
 * once, and goes back if the service refuses it, a pin or an archive with a
 * quiet note on the task's row. The open task archived leaves for the
 * home page once the service has kept the archive. The task the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another task, a task started, archiving it, a delete, or a
 * sign-out leaves it. With none open, the tab is the home page. The open task's
 * coding agents are the tab's too (`use-agents.ts`): read when the
 * task opens, started from the toolbar or the column's "+", and each drawn
 * on a tab of the task's column beside the task's own (`use-main-tabs.ts`),
 * their workers' in the side panel; New task's Agent mode starts the task
 * and its agent in the one start, and the task opens on that agent's tab,
 * or on a draft holding the words with why where the agent was refused.
 * Main is told which agent's tab is shown, so an agent that ends while the
 * developer is looking at it is not marked unseen, and the agents main says
 * ended unseen read in semibold until their tab is shown (`@repo/host/agent-notices`). The open description's history is the
 * tab's as well (`use-description-history.ts`): its version history, opened from
 * the task's menu or its "Edited by" line, or from a section's on the
 * revision that last changed the section, takes the whole window in the
 * task's place (`desktop-version-history.tsx`) until it is left or another
 * task opens, and a version restored through the service is answered with
 * the window's toast. The side panel stands as it was behind it.
 */

/** The item chosen in the window's Inbox, and the task it belongs to. */
/** The item chosen in the window's Inbox, by the task it stands on, or, for an agent with no task, by its agent. */
export type InboxChoice =
  // Note that an item of a task names the agent that posted it too, which its link is written under, but for one an older link named under its task alone; not as `agentId`, which tells a choice on no task.
  (
    | { readonly taskId: string; readonly itemAgentId?: string; readonly itemId: string }
    | { readonly agentId: string; readonly itemId: string }
    // An item a link named by its id alone that the account may not read, which the Inbox says is missing.
    | { readonly itemId: string }
  ) & {
    /** Whether a link or New thread asked for the item, rather than a row's choice: one no read holds then says it is missing. */
    readonly opened?: true;
  };

/**
 * The window's Inbox, standing in the task's place beside the sidebar: the
 * items of every task holding one in a column of their own, and the chosen
 * item beside them. It is the window's alone, as a version history is, so
 * it leaves the task the host has open, and the call bound to it, as they
 * stand; opening any task, or a new one, leaves it. Nothing is chosen in it
 * until a row is pressed or a link asks for an item (`onOpenItem`), and the
 * item chosen is kept while it stands, so the item answered stays in sight;
 * it opens again on nothing chosen, its list beside an empty pane, or alone
 * where the Inbox shows one column (`inbox-columns.ts`).
 */
interface InboxViewControl {
  readonly open: boolean;
  /** The item chosen in it, none until one is. */
  readonly chosen: InboxChoice | undefined;
  /** Opens the Inbox, as the places bar, the sidebar, and its chord do, on nothing chosen; asked first where leaving would lose unsaved work. */
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onChoose: (chosen: InboxChoice) => void;
  /**
   * Opens the Inbox on an item, from wherever the window stands: the
   * command palette, a person's page, or a link. Asked first where leaving
   * would lose unsaved work, as every door that moves the place is.
   */
  readonly onOpenItem: (chosen: InboxChoice) => void;
  /** Chooses no item, which stands the list alone where the Inbox shows one column. */
  readonly onClear: () => void;
  /** The task the list is narrowed to, none where it lists every task's items. */
  readonly narrowed: string | undefined;
  /** Lists every task's items again, where the list is narrowed to one; the door the task's chip over the list clears it by. */
  readonly onWiden: () => void;
  /** Whether the open Inbox shows one column by its own width (`inbox-columns.ts`), which the window's history steps between its list and its item by. */
  readonly single?: boolean;
  /** Says whether the Inbox shows one column. */
  readonly onSingle?: (single: boolean) => void;
  /** The pages of the chosen item's task as they move, which the panel beside it opens; none until read, or for an item of an agent with no task. */
  readonly pages: readonly PageLine[] | undefined;
  /** Tells the agents the Inbox read of the chosen item's task, whose Pull request tabs the panel beside it draws (`use-inbox-task-agents.ts`). */
  readonly onTaskAgents: (
    taskId: string,
    agentIds: readonly string[],
    heldIds?: readonly string[] | undefined,
  ) => void;
}

/**
 * One agent's page, standing in the task's place beside the sidebar as the
 * Inbox does: the agent an automation started with no task, which has no
 * task's column to stand in, drawn as its tab would be. It is the router's
 * (`agent-route.ts`), as the Inbox is, so it leaves the task the host has
 * open as it stands; opening any task, the Inbox, or home leaves it.
 */
interface AgentViewControl {
  /** The agent whose page stands, none while none does. */
  readonly agentId: string | undefined;
  /** The pages that agent showed on itself, working on no task, each by its newest version; none until read. */
  readonly pages?: readonly PageLine[] | undefined;
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
  /** Reads their page ahead of a press the pointer says is coming, in `workspaceId`, or the listed workspace where none is named. */
  readonly onPreload: (userId: string, workspaceId?: string) => void;
}

/** The places that are an agent's own, which open on its task where it has one, else on its page. */
type AgentPlaceKind =
  | typeof LINK_PLACE.AGENT
  | typeof LINK_PLACE.MESSAGE
  | typeof LINK_PLACE.WORKER
  | typeof LINK_PLACE.CHANGES
  | typeof LINK_PLACE.PULL_REQUEST_THREAD;

type AgentPlaceOf<K extends AgentPlaceKind> = Extract<LinkPlace, { readonly kind: K }>;

type AgentPlace = AgentPlaceOf<AgentPlaceKind>;

const AGENT_PLACE_KINDS: ReadonlySet<LinkPlace["kind"]> = new Set<AgentPlaceKind>([
  LINK_PLACE.AGENT,
  LINK_PLACE.MESSAGE,
  LINK_PLACE.WORKER,
  LINK_PLACE.CHANGES,
  LINK_PLACE.PULL_REQUEST_THREAD,
]);

/** Whether a place is an agent's own. */
function isAgentPlace(place: LinkPlace): place is AgentPlace {
  return AGENT_PLACE_KINDS.has(place.kind);
}

/** A place of a task's own that its side panel draws as a tab, named under the task. */
type TaskTabPlace =
  | (AgentPlaceOf<
      typeof LINK_PLACE.WORKER | typeof LINK_PLACE.CHANGES | typeof LINK_PLACE.PULL_REQUEST_THREAD
    > & { readonly planId: string })
  | Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.PAGE; readonly planId: string }>;

/** The window's Admin place: whether it takes the window, the view it stands on, and the presses that open and leave it. */
export interface AdminViewControl {
  readonly open: boolean;
  /** The view standing, or the Overview while the place does not stand. */
  readonly view: AdminView;
  /** Opens the place on `view`; where none is named, on the Overview. */
  readonly onOpen: (view?: AdminView) => void;
  readonly onClose: () => void;
  /** Reads the place ahead of a press the pointer says is coming, its chunk, charts and all. */
  readonly onPreload: () => void;
}

/** The window's Board: whether it stands in the task's place, and the presses that open and leave it. */
interface BoardViewControl {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** Reads the Board ahead of a press the pointer says is coming. */
  readonly onPreload: () => void;
}

/** Which Automations page stands: the list, a new automation's editor, or one automation's. */
export const AUTOMATIONS_PAGE = {
  LIST: "list",
  /** Every run of the listed workspace's automations, beside the list as its other tab. */
  RUNS: "runs",
  NEW: "new",
  EDIT: "edit",
} as const;

export type AutomationsPlace =
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.LIST;
      /** The automation whose page was left for the list by deleting it, which the window's history passes over from then on; an opening's alone, which no address holds. */
      readonly deleted?: string;
    }
  | { readonly kind: typeof AUTOMATIONS_PAGE.RUNS }
  | { readonly kind: typeof AUTOMATIONS_PAGE.NEW }
  | {
      readonly kind: typeof AUTOMATIONS_PAGE.EDIT;
      readonly automationId: string;
      /** The run a link named, which its runs mark and bring into view. */
      readonly runId?: string;
      /** Opened by the new automation's page that made it, as its Create landed, so it takes that page's step in the window's history; an opening's alone, which no address holds. */
      readonly created?: true;
    };

/** Whether a place is one of the Automations page's two tabs, the list or the runs, rather than one automation's page. */
export function automationsTab(place: AutomationsPlace): boolean {
  return place.kind === AUTOMATIONS_PAGE.LIST || place.kind === AUTOMATIONS_PAGE.RUNS;
}

/** The step a workspace's address names it by: its slug, or its id where an older service answered none, as `linkOf` writes it. */
function stepOf(workspace: Pick<Workspace, "id" | "slug">): string {
  return workspace.slug ?? workspace.id;
}

/** The window's Automations pages: whether one stands in the task's place, which, and the presses that open, move between, and leave them. */
interface AutomationsViewControl {
  readonly open: boolean;
  /** The page standing, the list while none does. */
  readonly place: AutomationsPlace;
  /**
   * Whether an automation's page stands its runs alone rather than its
   * setup, which only a narrow room draws apart: a page opened on a run's
   * link does, and any other does not until its Runs is chosen.
   */
  readonly runs: boolean;
  /** Opens the page asked for, the list where none is, under the listed workspace; nothing while none is listed. */
  readonly onOpen: (place?: AutomationsPlace) => void;
  /** Stands the page's runs alone, or its setup again; it leaves no page, so it asks nothing. */
  readonly onRuns: (shown: boolean) => void;
  readonly onClose: () => void;
}

/**
 * The coding agent New task's Agent mode starts on the task it started:
 * the key its start carries, which the card keeps for a press asking the
 * same again (`new-task-composer.tsx`), its prompt, the files attached,
 * the model picked on its chip, none where the chip was left on the
 * account's default, so the service runs the default it holds at the start,
 * and the MCP servers its + menu switched off, none by default.
 */
export interface NewTaskAgent {
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  readonly choice: ModelChoice | undefined;
  readonly disabledServers: readonly string[];
  /** The repositories the agent works in beside the task's, `owner/name`, which the card's repository chip picks after the task's own; none where left out. */
  readonly alsoRepositories?: readonly string[] | undefined;
}

/** The agent a task's start starts on it, as the act carries it: the card's key, the prompt, the files where any, the chip's model where one was picked, the servers switched off where any, and the repositories beside the task's where any. */
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

/** Where a group's quick add puts the task it adds: the group's status, priority, or assignee, or its repository. */
export interface QuickAddInto {
  readonly standing?: TaskStanding;
  readonly repository?: string;
}

/** What a quick add asks of where its task stands: a status, a priority, or an assignee, as given; no one assigned is where a task starts, so it is asked nothing. */
function startingStanding(standing: TaskStanding | undefined) {
  if (standing === undefined) return undefined;
  const { assigneeId, ...rest } = standing;
  return assigneeId === undefined || assigneeId === null ? rest : { ...rest, assigneeId };
}

/** What the press that opened New task chose: a repository (a repository group's +), the card's purpose (the Automations page's Create with an agent), the relation it starts its task in (a relation's New task, or New sub-task), or the card a start refused after it closed opens again on. */
export interface NewTaskPreset {
  readonly repository?: string;
  /** The relation the card starts its task in, from the new task's side; none for a task related to none. */
  readonly relation?: NewTaskRelation;
  /** What the card starts; a task's agent where none is named. */
  readonly purpose?: NewTaskPurpose;
  /** The card as it pressed Start, and why the start was refused, where the card is opened again on a refusal. */
  readonly refused?: { readonly card: NewTaskCardKept; readonly note: Failure };
}

/**
 * What New task's card held as it pressed Start, which it hands its start
 * so a card opened again on a refusal starts where it was left: the
 * repository, the model picked on its chip, none where it was left on the
 * account's default, and the press it made, whose key a Retry asking the
 * same carries again.
 */
interface NewTaskCardKept {
  /** What the card started, which it opens again for; a task's agent where none is named. */
  readonly purpose?: NewTaskPurpose;
  /** The relations the card started its task in, which it opens again on. */
  readonly relations: readonly NewTaskRelation[];
  readonly repository: string | null;
  readonly choice: ModelChoice | undefined;
  readonly press: NewTaskPress;
  /** The words as the box held them, which the card opens again on. */
  readonly words: string;
}

/**
 * New task's agent start under way: the line its agent opens on, and the
 * model it was started with, which the page draws while it waits. It names
 * no task, since the task stands Untitled until its agent names it.
 */
export interface StartingTask {
  readonly line: SentLine;
  /** The model the card's chip picked; none where the start takes the default. */
  readonly choice: ModelChoice | undefined;
}

/**
 * What a start comes from beyond its name, repository, and workspace: where
 * its agent runs, and the agent New task's composer starts on its words in
 * the task's own start (`handed`).
 */
export interface NewTaskStart {
  /**
   * Where the card's Runs on chose: the cloud, or one of the member's
   * devices. A task holds no place, so it is where the handed agent runs,
   * and, with none handed, the member's last pick.
   */
  readonly runsOn?: TaskRunsOnRequest;
  /** The device Runs on chose, which a refusal names; none for the cloud. */
  readonly device?: MacOffer;
  /** The relations the start makes its task in, from the new task's side, written with it in one transaction; none for a task related to none. */
  readonly relations?: readonly TaskCreateRelation[];
  readonly handed?: NewTaskAgent;
  /** How the task is worked, where the card's choice named it while the Pilot experiment is on; by its agents otherwise. */
  readonly mode?: TaskMode;
  /** What the card held as it pressed Start, which it opens again on where an agent's start is refused after the card closed. */
  readonly card?: NewTaskCardKept;
}

/** Everything the Tasks tab draws and presses, handed to the panel body whole. */
export interface TasksControl {
  page: TasksPage;
  /**
   * New task's agent start under way, which the window draws on a task's
   * page in its shape until the start answers (`StartingAgentTab`); none
   * otherwise, or once the developer went to another task or page meanwhile.
   */
  starting: StartingTask | undefined;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's tasks stand in for one. */
  signedIn: boolean;
  /** The signed-in account's id, whose own edits a task names "you"; none while signed out, for a fixture, or an identity stored without one. */
  me: string | undefined;
  /** Every task of every workspace, in the sidebar's order: the pinned ones first, newest pinned first, then the rest, newest started first; what the palette, the inbox, and the history find a task in. */
  tasks: TasksView["tasks"];
  /**
   * The chosen workspace's share of `plans`, which alone the sidebar lists,
   * and of `inbox` and `inboxTasks`, which alone the Inbox, its count, and
   * Home list; everything while no workspace is chosen.
   */
  listed: {
    tasks: TasksView["tasks"];
    inbox: readonly AppInboxTask[];
    inboxTasks: readonly AppInboxTaskHolding[];
  };
  /** The tasks a rename, a pin, or where they stand, asked here and not yet carried by the list, is drawn over (main's view's own), which a list held still moves at once; none where nothing waits. */
  pendingTasks?: ReadonlySet<string>;
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
  /**
   * New workspace's cards, standing alone in the window in the app's place
   * while open (`new-workspace-steps.tsx`): opened from the switcher or a
   * phone's account menu, and put away by their own Cancel or Close. Open
   * only for the account that opened them, so a sign-out puts them away.
   */
  newWorkspace: { open: boolean; onOpen: () => void; onClose: () => void };
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
  /** Copies the description drawn as Markdown, answered with a toast, since its press stands in a menu. */
  copy: { onPress: () => void };
  /** The writes to a description's document, as each place writing them holds its own mutation (`descriptionEditMutation`): saved, a conflict with the text as it stands now, or why not. */
  descriptionEdit: (taskId: string) => DescriptionEditMutation;
  /** The task's column's tabs: its agents' and its draft's, and which is shown. */
  mainTabs: MainTabsControl;
  /** The side panel beside the open task's column: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents' tabs that ended unseen, each until it is shown. */
  unreadTabs: readonly StripTab[];
  /** The pages agents wrote for the open task, each by its newest version, as the window holds them (`LIVE_READ.PAGES`); none until read. */
  pages: readonly PageLine[] | undefined;
  /** The open task's coding agents: their tabs, the Start, and the Stop. */
  agents: AgentsControl;
  /** The open description's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  /** Opens a task on its description: what a chip, a link, the Tasks list, the Board, the Inbox, a crumb, or a related task's row asks. */
  onSelect: (taskId: string) => void;
  /** Opens a task the developer goes back to work on, from a sidebar row, ⌘K, or Recent, on the agent waiting on them, else one at work, else the one last active, else its description. */
  onResume: (taskId: string) => void;
  /** Opens a task on its own place as it last stood, as ⌃Tab's card asks, the panes its screen held stood by the card itself. */
  onRestoreTask: (taskId: string) => void;
  /** Stands the own place of the task bound, whatever stands in its place giving way, as a version history over it does. */
  onStandTask: () => void;
  /** The task's own place as the router stands it: the task its address names, among the tasks the window holds. */
  taskView: { readonly taskId: string | undefined };
  /** Asks the host for the task the window arrived on, by Back, Forward, or the browser's own move, where the door that arrived there did not ask for it already (`places/place-binding.ts`). */
  onArriveTask: (taskId: string) => void;
  /** Opens a task on one agent's tab: what a row's press or the call card's way back asks. */
  onShowAgent: (taskId: string, agentId: string) => void;
  /** Opens a task on a tab of its column, as it last stood: what ⌃Tab's card asks (`tab-switcher.tsx`). */
  onShowColumnTab: (taskId: string, tab: MainTab) => void;
  /** Opens a task on a tab of its side panel, opening the panel where it was shut: what ⌃Tab's card asks. */
  onShowPanelTab: (taskId: string, tab: SidePanelTab) => void;
  /** Leaves the version history for the place that wrote a version: its agent's tab. */
  onShowSource: (taskId: string, source: RevisionSource) => void;
  /** Opens a task on its own document tab, out from under its version history and a side panel filling the window: the call card's way back. */
  onShowTask: (taskId: string) => void;
  /** Opens a task the same way, scrolled to the section a mention or an app link names, or at its top for the task's own. */
  onShowMention: (mention: DescriptionMention) => void;
  /**
   * Opens the place an app link names, of the Plans tab's: a task, its
   * section, version, page, call, or turn; an agent, on its task's tab or
   * its own page; an Inbox item, in its task's Inbox tab, or the Inbox on one with no task; Automations, on one. A
   * place of a workspace the account lists by the link's slug is shown in
   * it. Whoever cannot read the place is told so where it would stand, by
   * the place's own read, which is checked against them.
   */
  onOpenLink: (link: ReadLink) => void;
  /** The last ask to bring one of an agent's messages into view, which a link to it makes; let go once its tab answers it (`message-links.tsx`). */
  messageReveal: MessageReveal | undefined;
  /** The agent's tab answered the ask, so a later visit to the agent does not answer it again. */
  onMessageRevealed: (ask: number) => void;
  /** Asks the agent's transcript, wherever it is drawn, to bring one of its messages into view, going nowhere: what a link to it opened beside an Inbox item asks. */
  onRevealMessage: (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => void;
  /** The last ask to bring one review thread of an agent's pull request into view, which a link to it makes; let go once its Pull request tab takes it (`thread-reveal.tsx`). */
  threadReveal: ThreadReveal | undefined;
  /** The agent's Pull request tab took the ask, so a later visit to the tab does not answer it again. */
  onThreadRevealed: (ask: number) => void;
  /** Asks the Pull request tab of `changes`, wherever it is drawn, to bring one review thread into view, going nowhere: what a link to it opened beside an Inbox item asks. */
  onRevealThread: (
    changes: string,
    place: AgentPlaceOf<typeof LINK_PLACE.PULL_REQUEST_THREAD>,
  ) => void;
  /** The last ask to show a section, under the task it was asked of, so a section of a task not yet open is shown once it is drawn; let go once shown. */
  sectionReveal: { readonly taskId: string; readonly reveal: SectionReveal } | undefined;
  /** The task's page showed the section an ask named, so a later visit to the task does not show it again. */
  onSectionRevealed: (ask: number) => void;
  /** The last ask to open one of a task's comment threads, as a link to it asks, under the task it was asked of; counted so each ask is its own. */
  commentReveal:
    | { readonly planId: string; readonly thread: string; readonly ask: number }
    | undefined;
  /** The task's page took the ask, so a later visit to the task opens the thread neither beside its words nor in its list again. */
  onCommentRevealed: (ask: number) => void;
  /** Opens the window's Inbox narrowed to one task's items, on the item named, or on nothing chosen: what a task's "needs you" count, or an agent's waiting threads, ask. */
  onShowInbox: (narrowed: { readonly taskId: string; readonly itemId?: string }) => void;
  /** What waits on the developer across the account's tasks, as main's read last answered: each task with an open inbox item, and its items. */
  inbox: readonly AppInboxTask[];
  /** The task whose Inbox is on screen, or the agent whose own page's Inbox tab is, or none. */
  inboxShown: string | null;
  /** Every task holding an inbox item, waiting or settled, the task whose item changed latest first: what the window's Inbox lists. */
  inboxTasks: readonly AppInboxTaskHolding[];
  /** What waits on the developer from agents with no task, as main's read last answered: what the window's Inbox counts beside the tasks'. */
  inboxTaskless: readonly AppInboxTasklessItem[];
  /** Every agent with no task holding an inbox item, waiting or settled, the agent whose item changed latest first: what the window's Inbox lists beside the tasks. */
  inboxAgents: readonly AppInboxAgentHolding[];
  /** The newest run of each of the account's own automations that failed to start lately, every workspace's, which marks the sidebar's Automations of the run's workspace until that automation is opened. */
  failedRuns: readonly AccountFailedRun[];
  /** The window's Inbox: whether it stands in the task's place, the task chosen in it, and its presses. */
  inboxView: InboxViewControl;
  /** Says which agent's card in the column shows its threads in its transcript's place (`agent-threads.tsx`), none while it shows its transcript, so main is not told that transcript is on screen. */
  onThreadsShown: (agentId: string | undefined) => void;
  /** One agent's page: which agent's stands in the task's place, if any, and its presses. */
  agentView: AgentViewControl;
  /** One person's page: whose stands in the plan's place, if anyone's, and its presses (`person-page.tsx`). */
  personView: PersonViewControl;
  /** The window's Admin place, an admin's alone: whether it takes the window, its view, and its presses (`desktop-admin.tsx`). */
  adminView: AdminViewControl;
  /** The window's Automations page: whether it stands in the task's place, and its presses (`automations-page.tsx`). */
  automationsView: AutomationsViewControl;
  /** The window's Board of the listed workspace's tasks by status: whether it stands in the plan's place, and its presses (`tasks-board.tsx`). */
  /** Whether Home stands, the page of no task bound, which only its own route draws (`ROUTED_PLACE.HOME`), with no task still bound there. */
  atHome: boolean;
  /** Whether the task's own place stands, with neither Home nor any routed place, the not-found page among them, standing in its place. */
  taskPlaceStands: boolean;
  boardView: BoardViewControl;
  /** A Home or Board link whose first step names none of the reader's workspaces, which stands as not found (`desktop-shell.tsx`). */
  /** Opens a task's file in its side panel at the commit named, or its default branch's head where none is, the reference's lines lit, opening the task first where it is not the open one: what an inbox item's code opens. */
  onShowFile: (taskId: string, ref: CodeRef, commit: string | undefined) => void;
  /** Opens a tab-shaped pin of the sidebar's: its holder, the task where it is not the open one or the agent's own page, and the tab in its column, an agent's in the task's own and any other in the side panel. */
  onOpenPinnedTab: (pin: SidebarPin) => void;
  /** Opens the tab closed latest again as it stood, on its task, opening the task first where it is not the open one; none while no closed tab is kept. */
  onReopenClosedTab: (() => void) | undefined;
  /** The pin the open task was last opened from, which the sidebar marks in the task's place for as long as the task stays open; none once a task is opened otherwise. */
  chosenPin: SidebarPin | undefined;
  /** What the repository chip offers, in the composer and on the open task alike. */
  repositories: RepositoryChooser;
  /** The ask standing for the open task's chip to open its menu: which task it is about, and how many asks so far. */
  repositoryMenu: { taskId: string; request: number } | undefined;
  /** Opens a task's repository chip menu, opening the task first where it is not the open one. */
  onChangeRepository: (taskId: string) => void;
  /** The ask standing for the open task's head to open the add menu on a kind: which task it is about, the kind, and how many asks so far. */
  relationMenu: { taskId: string; kind: TaskRelationKind; request: number } | undefined;
  /** Opens a task's add menu on a kind (`task-relation-menu.tsx`), opening the task first where it is not the open one. */
  onAddRelation: (taskId: string, kind: TaskRelationKind) => void;
  /** Gives a task its repository, or takes it away with null; answers why the service refused, or nothing once it is kept. */
  onSetRepository: (taskId: string, repository: string | null) => Promise<string | undefined>;
  /** Sets where a task stands, how much it matters, or who it is assigned to, drawn at once by the assignee's name where the caller knows it; answers whether the service kept it, with what refused it where it did not. */
  onSetTaskStanding: (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ) => Promise<Kept>;
  /** Adds one block of a task or takes it away, which the open document draws as the service answers it; a refusal says why in a toast. */
  onSetTaskBlock: (taskId: string, block: TaskBlockRequest) => void;
  /** Sets a task's parent, or clears it with null, which the sidebar and the open document draw as the service answers it; a refusal says why in a toast. */
  onSetTaskParent: (taskId: string, parentTaskId: string | null) => void;
  /** Takes a task out from under its parent, said in a toast whose Undo sets the parent back; nothing for a task with none. */
  onRemoveTaskParent: (taskId: string) => void;
  /** Takes one block of a task away, said in a toast whose Undo adds it back; a refusal says why in a toast. */
  onRemoveTaskBlock: (taskId: string, relation: TaskBlockRelation, otherId: string) => void;
  /** Moves one relation of a task to another kind in one call, drawn as the service answers it; a refusal says why in a toast. */
  onChangeTaskRelation: (taskId: string, relation: TaskRelationChangeRequest) => void;
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
  /** The same move, as a question asking it first holds its own mutation over it. */
  moveTask: TaskMoveMutation;
  onRetryList: () => void;
  onRetryDocument: () => void;
  /** Opens the New task dialog over whatever stands open, which it leaves standing; on Home, hands Home's own composer the caret instead (`newTask.homeAsks`). */
  onNewTask: () => void;
  /** New task with a repository already chosen in the dialog: what a repository group's + asks. */
  onNewTaskIn: (repository: string) => void;
  /** New task related to the task given as `kind`, read from the new task's side, in that task's workspace: what the add menu's New task, and the task's menu and ⌘K's New sub-task, ask. */
  onNewRelatedTask: (taskId: string, kind: TaskCreateRelationKind) => void;
  /**
   * Adds a task named `name` to a Tasks page group with no agent, in the
   * listed workspace, and opens nothing: what a group's quick add asks.
   * Answers why it was not added, or nothing once the list carries it.
   */
  onQuickAdd: (name: string, into: QuickAddInto) => Promise<Failure | undefined>;
  /** New task's card for the agent that makes an automation: what the Automations page's Create with an agent asks. */
  onNewAutomationAgent: () => void;
  /** The New task dialog: whether it stands, what its press chose, and the two presses it makes. */
  newTask: {
    open: boolean;
    /** What the press that opened the dialog chose: a repository, where it chose one. */
    preset: NewTaskPreset | undefined;
    /** How many times New task was pressed on Home, whose composer takes the caret at each press rather than a dialog opening over it. */
    homeAsks: number;
    /** The workspaces a task may start in, the account's every one. */
    workspaces: readonly Workspace[];
    /** The workspace the dialog starts the task in until another is chosen: the one listed; none before the workspaces are read. */
    workspaceId: string | undefined;
    /** The repository chip's list for a workspace, as the dialog chooses which the task starts in. */
    repositoriesIn: (workspaceId: string | undefined) => RepositoryChooser;
    /**
     * Starts the task on the repository given, or none, in the workspace
     * given, with an empty description and no call,
     * which closes the dialog and opens the task; with an agent handed over it opens the
     * task on a draft agent's tab holding the agent's prompt, files, and
     * model, which starts the agent at once; answers why the task did not
     * start, with the press that mends it where there is one, or nothing
     * once it has.
     */
    start: (
      name: string,
      repository: string | null,
      workspaceId: string | undefined,
      from?: NewTaskStart,
    ) => Promise<Failure | undefined>;
    /** The models the composer's chip offers, as last read; nothing before the first read lands. */
    models: readonly CatalogModel[] | undefined;
    /** The member's devices Runs on offers, as the same read last listed them: none listed where it offered none, and nothing before a read lands. */
    devices: readonly MacOffer[] | undefined;
    /** Whether the last read of the models did not land. */
    modelsFailed: boolean;
    /** Where the newest read of the models stands, at the generation it took, so the card can wait on a read made since it opened. */
    modelsRead: ModelsRead;
    /** Asks the host for the models again, as the card opening and the chip's Retry ask. */
    readModels: () => void;
    /** Puts the dialog away with nothing started. */
    onClose: () => void;
    /** The tasks the window lists, archived ones among them, which name the agents an `@` in the composer offers and New task's Task relation offers its workspace's of. */
    tasks: readonly TaskSummary[];
    /** Opens a task or a section a mention in the composer names, as the window's own opener does. */
    onShowMention: (mention: DescriptionMention) => void;
  };
  /** Leaves the open task for Home (`desktop-home.tsx`); a call on it stands, as opening another task leaves one. */
  onLeaveTask: () => void;
  /** Goes to Home from wherever the tab stands, which lets go of the open task as it arrives. */
  onGoHome: () => void;
  /** Asks the host to bind no task, as arriving on Home does (`places/place-binding.ts`); no door of its own. */
  onUnbindTask: () => void;
  /** The options a surface renaming a task holds its own mutation over (`taskRenameMutation`). */
  renameTask: TaskRenameMutation;
  /**
   * Draws a name being typed for a task everywhere the task is named, before
   * any of it is saved, or none, which draws its saved name again.
   */
  onDraftName: (taskId: string, name: string | undefined) => void;
  /**
   * Pins or unpins a task, drawn at once and put back with a note if the
   * service refuses.
   */
  onMarkTask: (taskId: string, mark: TaskMark) => void;
  /**
   * Sets one task or several at a status, as Mark done, Cancel task, a
   * group's Mark tasks done, and the Tasks page's selection ask: each drawn
   * there at once, and one toast for them all once the service answered,
   * naming how many it refused, whose Undo puts back the status each stood
   * at. A task already there is left as it stands.
   */
  onSettleTasks: (taskIds: readonly string[], status: TaskStatus) => void;
  /** The repositories the account pinned in the sidebar, newest pinned first, whose groups stand above the rest. */
  pinnedRepositories: readonly string[];
  /** Pins a repository in the sidebar or unpins it, on the account: drawn at once, and put back with a toast if the service refuses. */
  onPinRepository: (repository: string, pinned: boolean) => void;
  /** Pins an agent, on a plan or with none, in the sidebar or unpins it, for the account alone: drawn at once, and put back with a toast if the service refuses. */
  onPinAgent: (agentId: string, pinned: boolean) => void;
  /** The account's pins of agents on a plan, the archived ones left out, which the sidebar's Pinned section draws beside the pinned plans; none while the list is not followed live. */
  taskAgentPins: readonly TaskAgentPin[];
  /** Every agent the list followed live carries, on a plan or with none, the archived ones among them, each with its own workspace and repository; none while it is not. */
  liveAgents: readonly ListedAgent[] | undefined;
  /** The pull request of every agent the list followed live carries that opened one, as its row keeps it; none while it is not. */
  listedPullRequests: readonly ListedPullRequest[] | undefined;
  /**
   * Gives the pins a drag in the sidebar's Pinned section moved their new
   * places, on the account: a plan's and an agent's, drawn
   * there at once, and put back with a toast if the service refuses, along
   * with what `putBack` undoes. A tab pinned to the sidebar keeps its place
   * on this Mac instead (`sidePanel`), which the drop's `putBack` restores.
   */
  onMovePins: (moves: readonly PinMove[], putBack?: () => void) => void;
  /**
   * The sections the account made in its sidebars and the tasks it keeps
   * in them, every workspace's, as main draws them, the writes still out
   * among them.
   */
  taskSections: TaskSections;
  /**
   * Writes a drag's or a menu's changes to the sections, in order, on the
   * account: drawn by main at once, and put back with a toast if the
   * service refuses one.
   */
  onWriteSections: (writes: readonly TaskSectionWrite[]) => void;
  /** Deletes a task, which ends its call and returns to the home page if it is the open one; answers whether it was deleted. */
  onDeleteTask: (taskId: string) => Promise<ActionResult>;
  /** The same delete, as a question asking it first holds its own mutation over it. */
  deleteTask: TaskDeleteMutation;
  /** Several deletes at once, as a selection's question holds its own mutation over them. */
  deleteTasks: TasksDeleteMutation;
  /**
   * Steps back one layer, answering whether there was one to step back from:
   * a side panel filling the window back beside the document, else an open
   * task left for the page the window rests on. The window's Escape takes an open task back
   * through its history instead (`navigation-history.ts`'s `throughHistory`),
   * to the page it was opened from.
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
 *
 * `onStanding` hears the ask each time one is stood, and nothing each time
 * the standing one is taken down, so a shell that can leave the page by
 * ways of its own (a browser tab closed, reloaded, or sent elsewhere) asks
 * first only while a page holds unsaved work.
 */
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

/** The open description's history as the window opens and draws it, over what is read of it. */
export interface VersionHistoryControl extends DescriptionHistoryControl {
  /** Whether the description's version history takes the window in its place. */
  open: boolean;
  /**
   * Opens a description's version history on the description as it stands, or, given the
   * moment of a save, on the revision that made it, opening the task first
   * where it is not the open one.
   */
  onOpen: (taskId: string, save?: number) => void;
  /** Reads a description's version history ahead, as the pointer comes to a way into it. */
  onPreload: (taskId: string) => void;
  /** Leaves the version history for the task, its side panel as it was. */
  onClose: () => void;
}

/** The save a version history opened on, on its task, whose revision it seeks. */
interface HistorySeek {
  readonly taskId: string;
  readonly save: number;
}

/**
 * The pin the open place was last opened from, which the sidebar marks for
 * as long as it stays open: one on a task while that task is the one bound,
 * and one on an agent's own page while that page stands; none otherwise.
 */
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

/** Whether a pin of the sidebar's is of the task: a tab pinned on it, or an agent on it. */
function pinOnTask(pin: SidebarPin, taskId: string): boolean {
  return "task" in pin && pin.task === taskId;
}

/**
 * The agent a task the developer goes back to work on lands on, so they
 * arrive in the conversation: one with a thread waiting on them, a question
 * before a notice, as the Inbox lists what waits; else the task's agent
 * that was last active, one at work counting as active now, archived ones
 * left out (`agentsOfTask`); none where it has none, so it opens on its
 * description.
 */
function resumingAgentOf(
  taskId: string,
  agents: readonly ListedAgent[] | undefined,
  waiting: readonly AppInboxTask[],
): string | undefined {
  const items = waiting.find((each) => each.taskId === taskId)?.items ?? [];
  const waitingOn = items.find(holdsAsk) ?? items[0];
  if (waitingOn !== undefined) return waitingOn.agentId;
  const lines = agentsOfTask(agents, taskId);
  const working = lines.find((line) => agentStillWriting(line.status));
  if (working !== undefined) return working.id;
  let latest = lines[0];
  for (const line of lines) {
    if ((agentMovedAt(line) ?? 0) > (latest === undefined ? 0 : (agentMovedAt(latest) ?? 0))) {
      latest = line;
    }
  }
  return latest?.id;
}

/** A pin pressed in the sidebar, and the task open when it was, or its own once that opens. */
interface PinChoice {
  readonly pin: SidebarPin;
  readonly over: string | undefined;
}

/** Takes back nothing, as a fixture run's select, which asks nothing of the host it binds. */
const NO_TAKE_BACK = (): void => undefined;

/** No repository pinned, as before main's view carries the sidebar. */
const NO_REPOSITORY_PINS: readonly RepositoryPin[] = [];

/** No task a write asked here stands over, as main's view says where it names none. */
const NO_PENDING_TASKS: readonly string[] = [];

/** A task with no page, the same array every render, so the arrivals read no change in it. */
const NO_PAGES: readonly PageLine[] = [];

/** The account's workspaces before their first read lands, whose experiments are all off. */
const NO_CHOOSING: readonly Workspace[] = [];

/** What the Inbox's bare panel, and an agent's own page, hold of the plan's panel kinds: nothing, the task's page drawing what they show. */
const NO_HOLDS: TaskHolds = {};

/** No ids, the same array every render. */
const NO_IDS: readonly string[] = [];

/** No agent with no plan, before the list carries any. */
const NO_TASKLESS_AGENTS: readonly TasklessAgent[] = [];

/** A task's act that never answered, settled as unanswered with the error beneath. */
const taskUnreached = unreachedAs(TASK_CALL_FAILURE.UNANSWERED);

/** How an agent's pin asked of the service landed, where it was not refused: written, or never asked, the account having changed while it waited its turn. */
const AGENT_PIN_ASKED = {
  CHANGED: "changed",
  UNASKED: "unasked",
} as const;

/** How an agent's pin landed: as above, or refused, with the answer or error that refused it. */
type AgentPinAsked =
  | (typeof AGENT_PIN_ASKED)[keyof typeof AGENT_PIN_ASKED]
  | { readonly refused: unknown };

/** No pin of an agent on a plan, the same array every render. */
const NO_TASK_AGENT_PINS: readonly TaskAgentPin[] = [];

/** What the toast says once Copy description has put the description on the clipboard. */
const TASK_COPIED_NOTE = "Description copied";

/** Whether a task New task starts opens, as Settings › Profile › Tasks says; until the first document arrives it does. */
const selectOpensNewTask = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.openNewTask ?? APP_SETTING_DEFAULTS.openNewTask;

/** What the toast says once New task started a task it did not open. */
const TASK_STARTED_NOTE = "Task started";

/** What it says instead where the task started but its agent was refused. */
const TASK_STARTED_AGENT_REFUSED_NOTE = "Task started, but its agent did not";

/** That toast's action, which opens the task. */
const OPEN_STARTED_TASK = "Open";

/** What the toast says once a task is deleted. */

/** What the toast says when the service did not move a task, which stays where it was. */
const MOVE_REFUSED_NOTE = "The task could not be moved. Try again.";

/** What the toast says when the service kept no change to a task's blocks, which stand as they were. */
const BLOCK_REFUSED_NOTE = "That relation could not be changed. Try again.";

/** What the toast says when a block would close a cycle, the other task already waiting on this one. */
const BLOCK_CYCLE_NOTE = "That task already waits on this one, so it can't block it too.";

/** What the toast says when a parent would put the task under itself, the other task already a sub-task of it. */
const PARENT_CYCLE_NOTE =
  "That task is already a sub-task of this one, so it can't be its parent too.";

/** What the toast says when a parent works in another repository, which a sub-task always shares. */
const PARENT_REPOSITORY_NOTE =
  "A sub-task works in its parent's repository, so the two must share one.";

/** What the toast says once a task's parent is removed, offering Undo. */
const PARENT_REMOVED_NOTE = "Parent removed";

/** What the toast says once a block is removed, offering Undo. */
const BLOCK_REMOVED_NOTE = "Relation removed";

/** What ⌘Z's toast calls a task's rename it takes back or puts back. */
const TASK_RENAMED_NOTE = "Task renamed";

/** A task's rename as a mutation asks it: the task, and the name already trimmed and changed. */
interface TaskRenameAsk {
  readonly taskId: string;
  readonly name: string;
}

/**
 * A task's rename as each surface renaming one holds it, a mutation of its
 * own over these options: sent through `send`, drawn under the new name at
 * once, and under its old name again by the host where the service refuses,
 * answering whether it was renamed. A rename the service kept is ⌘Z's to
 * take back, through `doors`; none where nothing is drawn to take back.
 */
export function taskRenameMutation(
  send: (asked: TaskRenameAsk) => Promise<boolean>,
  doors: RowDoors<TaskRows, typeof ROW_WRITE.TASK_RENAME.kind> | undefined,
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

/** A task's rename as a surface holds it (`taskRenameMutation`). */
export type TaskRenameMutation = ReturnType<typeof taskRenameMutation>;

/** A task's delete as each place asking it holds its own mutation over it, run through `run`, answering whether it was deleted. */
export function taskDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_DELETE], mutationFn: run });
}

/** A task's delete, as a place asking it holds it. */
type TaskDeleteMutation = ReturnType<typeof taskDeleteMutation>;

/** Several tasks deleted at once, as a selection's question holds its own mutation over them, each through `run`, answering each in the order asked. */
export function tasksDeleteMutation(run: (taskId: string) => Promise<ActedResult>) {
  return mutationOptions({
    mutationKey: [ACT_KIND.TASKS_DELETE],
    mutationFn: (taskIds: readonly string[]) => Promise.all(taskIds.map(run)),
  });
}

/** Several tasks deleted at once, as a selection's question holds it. */
type TasksDeleteMutation = ReturnType<typeof tasksDeleteMutation>;

/** A task moved to another workspace, and whether a refusal goes unsaid, as the Move dialog says it under its list. */
interface TaskMoveAsk {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly quiet: boolean;
}

/** A task's move as each place asking it holds its own mutation over it, run through `run`, answering whether it moved. */
export function taskMoveMutation(run: (asked: TaskMoveAsk) => Promise<boolean>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_MOVE], mutationFn: run });
}

/** A task's move, as a place asking it holds it. */
type TaskMoveMutation = ReturnType<typeof taskMoveMutation>;

/** How a task's rename is asked and read back, its refusal the answer that it was not renamed. */
export const TASK_RENAME_SHAPE: RenameShape<boolean, TaskRenameAsk> = {
  ask: (taskId, name) => ({ taskId, name }),
  asked: ({ taskId, name }) => ({ subjectId: taskId, name }),
  refused: (renamed) => !renamed,
};

/** What ⌘Z's toast calls a task's pin it takes back or puts back, by what was asked. */
const TASK_MARKED_NOTES = {
  [TASK_MARK.PIN]: "Task pinned",
  [TASK_MARK.UNPIN]: "Task unpinned",
} as const satisfies Record<TaskMark, string>;

/** What ⌘Z's toast calls an agent's pin it takes back or puts back, by whether it was a pin or an unpin. */
const AGENT_PINNED_NOTES = {
  PIN: "Agent pinned",
  UNPIN: "Agent unpinned",
} as const;

/** What ⌘Z's toast calls a change of a task's priority it takes back or puts back. */
const PRIORITY_CHANGED_NOTE = "Priority changed";

/** What ⌘Z's toast calls a change of who a task is assigned to, by whether it names anyone. */
const ASSIGNEE_CHANGED_NOTES = {
  ASSIGNED: "Task assigned",
  UNASSIGNED: "Task unassigned",
} as const;

/** What ⌘Z's toast calls a change of where one task stands, by what it changed. */
function standingNote(standing: TaskStanding): string {
  if (standing.status !== undefined) return settledNote(standing.status, 1, 0);
  if (standing.assigneeId === undefined) return PRIORITY_CHANGED_NOTE;
  return standing.assigneeId === null
    ? ASSIGNEE_CHANGED_NOTES.UNASSIGNED
    : ASSIGNEE_CHANGED_NOTES.ASSIGNED;
}

/** What a relation's refusal says: its own reason where the service named one, and a plain refusal otherwise. */
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
 * count, and Home's waiting list, is the listed workspace's share. A task is placed by
 * the workspace the account's task list says it is in, so an item of a task
 * not yet listed is in no workspace's share until it is.
 */

/** The sidebar's list of `tasks`, pinned first. */
function sidebarList(tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  const { pinned, rest } = sidebarTasks(tasks);
  return [...pinned, ...rest];
}

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

/** The Inbox's choice of the item a link names: under its task, its agent, or by its id alone. */
function inboxChoiceOf(place: InboxItemPlace): InboxChoice {
  if ("planId" in place) return { taskId: place.planId, itemId: place.itemId };
  return "agentId" in place
    ? { agentId: place.agentId, itemId: place.itemId }
    : { itemId: place.itemId };
}

/** The task an Inbox choice stands on; none for one on no task, or named by its id alone. */
function choiceTaskOf(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

/** The agent with no task an Inbox choice stands on; none for one on a task, or named by its id alone. */
function choiceAgentOf(choice: InboxChoice): string | undefined {
  return "agentId" in choice ? choice.agentId : undefined;
}

/** Where an item stands, as the service says for one the account may read; nothing for one it may not, one that does not exist, or where the read failed. */
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
  /** The tasks main holds, the account's; a fixture run's own stand in for them. */
  tasks: TasksView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  /** The signed-in account's email, which the task last open is kept under; none while signed out. */
  account: string | undefined;
  /** The signed-in account's id, whose own work the window names as theirs; none while signed out. */
  accountId?: string | undefined;
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
  /** Every agent with no task main says holds an inbox item, waiting or settled. */
  inboxAgents: readonly AppInboxAgentHolding[];
  /** The newest run of each of the account's own automations main says failed to start lately. */
  failedRuns: readonly AccountFailedRun[];
  /** Opens Settings on its Integrations page, where an agent's MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page at the provider's harness row, where the developer's key for it is. */
  onOpenApiKeys: AgentsControl["onOpenApiKeys"];
  /** Opens Settings at the place the link names. */
  onOpenSettings: (link: SettingsLink) => void;
  /** The window's ask before leaving unsaved work, which guards every door here that moves the place. */
  leaveGuard: LeaveGuard;
  /** The room the panel's stage gives, which holds the side panel only full screen while it is narrow (`shell-room.ts`). */
  room: ShellRoom;
  /** Admin as the router stands it, which a link to it opens (`admin-route.ts`). */
  adminView: AdminViewControl;
  /** The listed workspace's Board as the router stands it (`workspace-routes.ts`). */
  boardView: BoardRoute;
  /** A person's page as the router stands it (`workspace-routes.ts`). */
  personView: PersonRoute;
  /** An agent's own page as the router stands it (`agent-route.ts`). */
  agentView: AgentRoute;
  /** The listed workspace's Automations pages as the router stands them (`automations-route.ts`). */
  automationsView: AutomationsRoute;
  /** A task's version history as the router stands it (`version-history-route.ts`). */
  versionHistoryView: VersionHistoryRoute;
  /** The window's Inbox as the router stands it (`inbox-route.ts`). */
  inboxView: InboxRoute;
  /** A workspace's address naming none of the reader's as the router stands it, not found (`workspace-routes.ts`). */
  unknownWorkspaceView: UnknownWorkspaceRoute;
  /** Home as the router stands it (`workspace-routes.ts`). */
  homeView: HomeRoute;
  /** A task's own place as the router stands it (`task-route.ts`). */
  taskView: TaskRoute;
  /** The routed place standing (`useWindowPlace`); none on an address the window's state draws. */
  place: RoutedPlace | undefined;
  /** Reads how many times the developer arrived on another page of the window (`usePlaceArrivals`). */
  arrivals: () => number;
  /** Begins a link's read of the service, answering whether it is still the window's to act on (`places/link-reads.ts`). */
  linkReads: LinkRead;
  /** Writes the step a link opens on a task's own place before the window stands there, as one move (`navigation-history.ts`'s `onVisitTask`). */
  visitTask: (at: TaskAt, step: LinkStep) => boolean;
}): TasksControl {
  const { shown, leaveGuard } = input;
  const { guard } = leaveGuard;
  // Note that the reads below stay on `act` until they move to queries; every write is a mutation, and
  // none invalidates a query, since what each changes comes back through app state.
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
  // Note that a task started with its agent is traced as a send; one started with none is not.
  const { mutateAsync: sendTaskStart } = useMutation(
    sendMutation(ACT_KIND.TASKS_START, (start) =>
      start.agent === undefined ? undefined : SENTRY_SEND_SPAN.TASK_START,
    ),
  );
  // Note that which agent is shown is told, quiet whatever comes back, since no person pressed for it.
  const { mutate: tellShown } = useMutation(actMutation(ACT_KIND.AGENTS_SHOWN));
  const { mutate: refreshTasks } = useMutation(pressMutation(ACT_KIND.TASKS_REFRESH));
  const copyWithToast = useCopyToast();
  const toast = useToast();
  // The New task dialog's ask, standing while the dialog does: the preset it was opened with, if any.
  const [newTaskAsk, setNewTaskAsk] = useState<
    { readonly preset: TasksControl["newTask"]["preset"] } | undefined
  >(undefined);
  // How many times New task was pressed while Home stood, whose own composer takes the caret on each.
  const [homeNewTasks, setHomeNewTasks] = useState(0);
  // New task's agent start under way: what its page draws, and the arrivals counted once the window stood where it was pressed into.
  const [startingTask, setStartingTask] = useState<
    (StartingTask & { readonly arrivals: number }) | undefined
  >(undefined);
  const [repositoryMenu, setRepositoryMenu] = useState<TasksControl["repositoryMenu"]>(undefined);
  const [relationMenu, setRelationMenu] = useState<TasksControl["relationMenu"]>(undefined);
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  /** The save whose revision a version history opened from a section's "Edited by" seeks, on its task, until it is found, given up on, or the history is left. */
  const [historySeek, setHistorySeek] = useState<HistorySeek | undefined>(undefined);
  const historyRoute = input.versionHistoryView;
  // The routed places a door into a place of the window's state leaves, the Inbox, an agent's page, and a workspace not there, which stand in the task's place.
  const overPlan =
    input.inboxView.open ||
    input.agentView.agentId !== undefined ||
    input.unknownWorkspaceView.workspace !== undefined;
  // The window's Inbox is the router's, which stands it in the task's place as its address says (`inbox-route.ts`).
  const inboxView = input.inboxView.open ? input.inboxView : undefined;
  // Note that the Inbox already open has no opening to time.
  const timeInboxOpen = () => {
    if (inboxView === undefined) beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  };
  // Whether the window's Inbox shows one column, as it measures itself.
  const [inboxSingle, setInboxSingle] = useState(false);
  const agentView = input.agentView.agentId === undefined ? undefined : input.agentView;
  // Every select, start, and workspace switch asked for, counted, so an answer that lands after a newer one was asked for
  // changes nothing the newer one decided.
  const navigations = useRef(0);
  // The window's router, which a link is matched on (`places/link-places.ts`).
  const router = useRouter();
  // How many times the developer arrived on another page of the window, as the binding counts them (`places/place-binding.ts`).
  const { arrivals } = input;
  // A link's read of the service stands until any later navigation: a select, start, or switch counted here, or any move of the window to another page.
  const linkRead = () => {
    const mine = navigations.current;
    const unmoved = input.linkReads();
    return () => navigations.current === mine && unmoved();
  };
  // What stood where a door was pressed, a workspace not there, an agent's page, the Inbox, and, where `history` says, a
  // version history, each by where its address stood, which a refusal of the move stands again where the developer went
  // nowhere since the press, the press's own move, `moved`, aside; the place a refusal leaves standing otherwise is the
  // binding's (`places/place-binding.ts`).
  const pressedOverNow = useRef<(history: boolean, moved: boolean) => () => void>(
    () => () => undefined,
  );
  pressedOverNow.current = (history, moved) => {
    // Note that the press's own arrival is counted once the window is drawn where it went, after the press.
    const landed = arrivals() + (moved ? 1 : 0);
    const unknownBefore = input.unknownWorkspaceView.workspace;
    const agentBefore =
      agentView?.agentId === undefined || agentView.workspace === undefined
        ? undefined
        : { agentId: agentView.agentId, workspace: agentView.workspace };
    const inboxBefore =
      inboxView?.standingIn === undefined
        ? undefined
        : {
            at: { workspace: inboxView.standingIn, narrowed: inboxView.narrowed },
            chosen: inboxView.chosen,
          };
    const historyBefore =
      !history || historyRoute.workspace === undefined || historyRoute.task === undefined
        ? undefined
        : { workspace: historyRoute.workspace, task: historyRoute.task, spot: historyRoute.spot };
    const { unknownWorkspaceView, agentView: agentRoute, inboxView: inboxRoute } = input;
    return () => {
      if (arrivals() > landed) return;
      if (unknownBefore !== undefined) unknownWorkspaceView.onOpen(unknownBefore);
      if (agentBefore !== undefined) agentRoute.onOpen(agentBefore.agentId, agentBefore.workspace);
      if (inboxBefore !== undefined) {
        if (inboxBefore.chosen === undefined) inboxRoute.onOpen(inboxBefore.at);
        else inboxRoute.onChoose(inboxBefore.chosen, inboxBefore.at);
      }
      if (historyBefore !== undefined) {
        historyRoute.onOpen(historyBefore.workspace, historyBefore.task, historyBefore.spot);
      }
    };
  };
  // The synthetic tasks, which only a fixture run draws: the window is drawn once they have landed (`App`).
  const tasksFixture = loadedTasksFixture();
  /** A file an inbox item opens on a task not yet open, opened once the host has it open. */
  const [fileFor, setFileFor] = useState<
    | { readonly taskId: string; readonly ref: CodeRef; readonly commit: string | undefined }
    | undefined
  >(undefined);
  const [sectionReveal, setSectionReveal] = useState<TasksControl["sectionReveal"]>(undefined);
  const [messageReveal, setMessageReveal] = useState<MessageReveal | undefined>(undefined);
  const [commentReveal, setCommentReveal] = useState<TasksControl["commentReveal"]>(undefined);
  const messageAsks = useRef(0);
  const [threadReveal, setThreadReveal] = useState<ThreadReveal | undefined>(undefined);
  /** The asks to show a section made so far, so each is its own even after the last was let go. */
  const sectionAsks = useRef(0);
  /** The asks to open a comment thread made so far, so each is its own even after the last was let go. */
  const commentAsks = useRef(0);
  /** The tabs closed in the window, the latest last, which ⇧⌘T opens again (`closed-tabs.ts`). */
  const [closedTabs, setClosedTabs, latestClosedTabs] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);
  /** The closed tabs opened again on a task not yet open, in the order asked, opened once the host has it open. */
  const [reopenFor, setReopenFor, latestReopenFor] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);

  // A fixture run draws its synthetic tasks in place of the account's,
  // signed out as every fixture run is.
  const fixture = tasksFixture?.fixtureTasksView(input.run);
  const viewed = fixture ?? input.tasks;
  const accountSignedIn = input.signedIn;
  // A name, pin, status, priority, or assignee given here, a task's or an
  // agent's pin, and a pin's new place, are drawn by main the moment they
  // are asked (`@repo/host`'s `task-list-collections.ts`), so the view
  // already carries them. A name being typed is drawn over the view, held
  // here rather than read back from main, so every surface naming the task
  // follows the typing at once.
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
  // Note that every list step below is memoized on what it reads, because
  // this runs on every render of the window and each step walks every task
  // of every workspace. A repository's pin and a change to the sections are
  // drawn by main the moment they are asked, so the view already carries them.
  const taskSections = viewed.taskSections ?? NO_TASK_SECTIONS;
  // A tab closed names a task of the account it was closed under, so a sign-out lets them go.
  useEffect(() => {
    if (!accountSignedIn) setClosedTabs(NO_CLOSED_TABS);
  }, [accountSignedIn, setClosedTabs]);
  const pendingTasks = useMemo(
    () => new Set(viewed.pendingTasks ?? NO_PENDING_TASKS),
    [viewed.pendingTasks],
  );
  const tasks = useMemo(() => renamedView(viewed, drafts), [viewed, drafts]);
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
  const personWorkspace =
    input.personView.workspace === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, input.personView.workspace)?.id;
  // Note that an address naming none of the reader's workspaces is its route's gate's to answer (`route-gates.ts`).
  const personElsewhere =
    input.personView.userId !== undefined &&
    listedWorkspace !== undefined &&
    personWorkspace !== undefined &&
    personWorkspace !== listedWorkspace.id;
  const closePerson = input.personView.onClose;
  useEffect(() => {
    if (personElsewhere) closePerson();
  }, [personElsewhere, closePerson]);
  // The Board is the listed workspace's, so another listed in its place stands its Board in the step's place.
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
  // The Automations pages are the listed workspace's too, so another listed in its place stands the same page under it in the step's place.
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
  // The Inbox lists the listed workspace's items alone, so another listed in its place stands that one's Inbox, on its list, in the step's place.
  const inboxWorkspace =
    input.inboxView.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, input.inboxView.standingIn)?.id;
  const inboxElsewhere =
    listedWorkspace !== undefined &&
    inboxWorkspace !== undefined &&
    inboxWorkspace !== listedWorkspace.id;
  const turnInbox = input.inboxView.onTurn;
  useEffect(() => {
    if (inboxElsewhere && listedStep !== undefined) turnInbox(listedStep);
  }, [inboxElsewhere, listedStep, turnInbox]);
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
  // Every agent the list followed live carries, on a plan or with none, the archived ones among them; none while it is not.
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
  // The account New workspace's cards were opened for, which alone they stand for.
  const [founding, setFounding] = useState<{ accountId: string | undefined } | undefined>(
    undefined,
  );
  // A sign-out, or another account, puts the cards away for good, so the same account signing in again does not find them open.
  if (founding !== undefined && (!signedIn || founding.accountId !== input.accountId)) {
    setFounding(undefined);
  }
  const page = tasksPage(tasks);
  // The open task's description is held whenever a task is open, so a task held lately draws its description in
  // its first frame, and one never held reads; a name being typed draws over it as over the list.
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
  // A started agent's tab opens selected; the column's tabs are built after
  // the agents they draw, so the opening reaches them through this late binding.
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
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
  // A fixture's task lists its agents at the act door: none, but where an agent profile stages one (`tasks-fixture.ts`).
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
    onStarted: (agentId) => mainRef.current?.onChoose(agentTab(agentId)),
    onDraftRestored: (on, draftId) => mainRef.current?.onShow(on, draftTab(draftId)),
    keywords: dictationWords,
  });
  // The agents with no plan are listed by the same workspace as the plans, standing and archived apart as the plans are,
  // each named, archived, and pinned as main draws it.
  const listedAgents = useMemo(() => {
    const listed = (tasklessAgents ?? NO_TASKLESS_AGENTS).filter(
      (agent) => listedWorkspaceId === undefined || agent.workspaceId === listedWorkspaceId,
    );
    return {
      standing: listed.filter((agent) => agent.archivedAt === undefined),
      archived: listed.filter((agent) => agent.archivedAt !== undefined),
    };
  }, [tasklessAgents, listedWorkspaceId]);
  // The task's archived agents, whose tabs stand once opened (`use-main-tabs.ts`).
  const archivedIds = useMemo(() => agents.archived?.map((agent) => agent.id), [agents.archived]);
  const mainTabs = useMainTabs(
    fixture === undefined ? undefined : { tab: tasksFixture?.fixtureColumnTab(input.run) },
    viewed.activeTaskId,
    agents.agentIds,
    archivedIds,
    agents.draft?.id,
    input.room === SHELL_ROOM.NARROW,
  );
  mainRef.current = mainTabs;
  // A task opens on its agents, so one with no agent's tab standing, once its agents are read,
  // opens a new agent's draft, its composer ready; one that starts none of its own, an archived
  // task's or a pilot's, and any in a narrow room, shows its details instead. Note that the draft
  // is not chosen but stands as the column's last tab, which it falls to, so it is not counted
  // viewed: an agent coming back, as a refused archive brings it, is shown again over it.
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
  // The open task's pages are held whenever a task is open, the Inbox's or an agent's page over it
  // among them, so its page draws them from where they stand, and a page's tab is held to them.
  const taskPages = useQuery(
    pagesQuery(viewed.activeTaskId === undefined ? undefined : { taskId: viewed.activeTaskId }),
  ).data;
  const pages = useMemo(() => (taskPages ?? NO_PAGES).map((page) => page.id), [taskPages]);
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
  const inboxTask = inboxChosen === undefined ? undefined : choiceTaskOf(inboxChosen);
  const inboxAgent = inboxChosen === undefined ? undefined : choiceAgentOf(inboxChosen);
  // Note that an item of an agent on no task opens that agent's own pages beside it (`route.ts`), and that the
  // pages are held in the host while drawn and a while after, so choosing another item of the task, or the task again, reads none anew.
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
  // An agent on no task shows its pages on itself, which its page's panel draws as a task's draws its own.
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
  // The cloud Browser tabs, which the panel draws by its holder: an agent's page its agent's,
  // on a task or on none, and a task's own panel its agents', never the Inbox's.
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
  // A draft of a tab in an agent's browser stands in the strip after the tabs the service lists.
  const cloudDrafts = useCloudBrowserDrafts(cloudPlace, cloudPlace !== undefined);
  // Note that a panel off its holder lists none, rather than none read yet, so a cloud tab chosen there gives way.
  const cloudBrowsers = useMemo(
    () =>
      cloudPlace === undefined
        ? NO_IDS
        : cloudListed === undefined
          ? undefined
          : [...cloudListed.map((each) => each.id), ...cloudDrafts.map((each) => each.id)],
    [cloudPlace, cloudListed, cloudDrafts],
  );
  // Where the panel's file and page tabs opened here read, saved with each tab: the task the panel
  // stands for and its repository, or, beside an agent on no task, the agent's pages and no files,
  // whose opener names the workspace and repository it reads them through (`desktop-agent-page.tsx`).
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
  const stagedPanel = tasksFixture?.fixtureSidePanel(input.run);
  // A fixture run's staged Terminal tab is held under the account signed in, as a real open holds it, so it stands.
  useHeldTerminalTabs(stagedPanel?.terminals);
  const sidePanel = useSidePanel(
    stagedPanel,
    inboxView !== undefined
      ? {
          id: inboxTask ?? inboxAgent,
          holds: NO_HOLDS,
          bare: true,
          files: panelFileReads,
          pages: panelPages,
          // Each item is a stop of its own, two of one task among them.
          stop: inboxChosen?.itemId,
        }
      : pageAgents === undefined
        ? { id: viewed.activeTaskId, holds: NO_HOLDS, files: panelFileReads, pages: panelPages }
        : { id: pageAgent, holds: NO_HOLDS, pages: panelPages },
    inboxView !== undefined ? inboxAgents : (pageAgents ?? mainTabs.openAgents),
    NO_IDS,
    inboxView !== undefined ? inboxPageIds : pageAgents === undefined ? pages : agentPageIds,
    // Note that the task's agents in the Inbox are its own read's (`desktop-inbox.tsx`), which the panel draws a Pull request tab by (`use-inbox-task-agents.ts`).
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.agentIds
        : inboxAgents
      : (pageAgents ?? agents.agentIds),
    input.room,
    cloudBrowsers,
    // Every agent of the task, an archived one among them, whose Pull request tab stands as a live agent's does.
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.heldIds
        : inboxAgents
      : (pageAgents ?? agents.heldIds),
  );
  // An agent, or its Pull request, pinned to the sidebar is named there as
  // its tab is named now, so a pin made before the agent had its title or its
  // pull request was read, or before a rename, catches up while its task is open.
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
  // A Plan tab an earlier version pinned to the sidebar on this Mac becomes
  // the task's own pin on the account, since the Plan tab's Pin is the
  // task's now (`task-actions.tsx`), once the list names the task, and
  // leaves this Mac's pins only once the account's pin landed, so a refusal
  // keeps it for the next launch to try again; one the list does not name
  // yet waits there too, drawn nowhere (`desktop-sidebar.tsx`). A task
  // already pinned only lets the tab's pin go. Note that each task is asked
  // once a launch, and that the mark is read as the effect runs, so it is
  // the newest, as a press's would be.
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
  // Main hears which agent's tab, or which task's Inbox, is on screen, and
  // neither while the tab is away, the version history stands in the task's
  // place, the side panel fills the window over the column, or the column
  // shows something else; a fixture's staged agents are no one's to announce.
  // The window's Inbox stands in the column's place, showing the task whose item is chosen there.
  // Whether the column stands on screen, a fixture's among them.
  // Note that a routed place beside the sidebar, Admin, the Board, a person's page, or the Automations pages, stands over the window's state, which stays
  // as it was under it (`admin-route.ts`, `workspace-routes.ts`), so none of it is on screen then.
  const routedOver =
    input.adminView.open ||
    input.boardView.open ||
    input.personView.userId !== undefined ||
    input.automationsView.open;
  const stateShown = shown && !routedOver;
  const columnInView = stateShown && !historyRoute.open && !overPlan && !sidePanel.fullScreen;
  const columnShown = columnInView && fixture === undefined;
  // Note that the column is filled only while in view, because a blank draft out of view is let
  // go at once (below), which would leave it empty to fill again.
  useEffect(() => {
    if (columnEmpty && columnInView) fillColumn();
  }, [columnEmpty, columnInView, fillColumn]);
  // A new agent's draft opens only from the column's "+" (`main-tabs.tsx`), and one holding
  // nothing (`holdsNothing`) stands only while its tab is in view: left for another tab, another
  // task, or another place, Settings and the side panel filling the window among them, it closes,
  // and one standing out of view, as a launch reads back a draft whose files it kept nowhere,
  // closes once the column settles its tab. Note that the draft left is remembered as it last
  // stood in view, because by the render that leaves it the open task's draft may be another's.
  const shownTab = mainTabs.tab;
  const draftInView =
    columnInView &&
    shownTab !== undefined &&
    !isOverviewTab(shownTab) &&
    shownTab.kind === STRIP_TAB_KIND.DRAFT
      ? shownTab.draft
      : undefined;
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
  // The agent whose card in the column shows its threads rather than its transcript, as the task's page says.
  const [threadsShown, setThreadsShown] = useState<string | undefined>(undefined);
  // An agent's page stands in the task's place, showing its agent as its tab would.
  // An agent's transcript beside the Inbox shows its agent the same way, while the panel stands open on it.
  const inboxTranscript =
    stateShown &&
    fixture === undefined &&
    inboxView !== undefined &&
    sidePanel.open &&
    sidePanel.tab !== undefined &&
    typeof sidePanel.tab !== "string" &&
    sidePanel.tab.kind === STRIP_TAB_KIND.TRANSCRIPT
      ? sidePanel.tab.transcript
      : undefined;
  // Note that an agent's card showing its threads keeps its transcript out of sight, so its end is still unseen.
  const shownAgent =
    stateShown && fixture === undefined && agentView?.agentId !== undefined
      ? agentView.agentId
      : inboxTranscript !== undefined
        ? inboxTranscript
        : columnShown &&
            mainTabs.tab !== undefined &&
            !isOverviewTab(mainTabs.tab) &&
            mainTabs.tab.kind === STRIP_TAB_KIND.AGENT &&
            mainTabs.tab.agent !== threadsShown
          ? mainTabs.tab.agent
          : null;
  const shownInbox =
    stateShown && fixture === undefined && inboxView !== undefined ? (inboxTask ?? null) : null;
  // Main is told which agent's tab is on screen, whose end it marks unseen nowhere then.
  const reportedAgent = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reportedAgent.current === shownAgent) return;
    reportedAgent.current = shownAgent;
    tellShown({ agentId: shownAgent });
  }, [shownAgent, tellShown]);
  // The agent on screen is kept warm for the next message while the page is visible.
  useWarmAgent((liveAgents ?? agents.agents)?.find((agent) => agent.id === shownAgent));

  // The host answers a press a round trip later, so where the tab is bound
  // is said at once, and a select that did not open the task takes its ask
  // back (`places/place-binding.ts`). A fixture's tasks are opened nowhere, so nothing is asked of them.
  const openTaskId = tasks.activeTaskId;
  const { boundFor, ask, boundNow } = useTaskAsk(openTaskId);
  // Home is the listed workspace's too, at `/app` while none is listed, so another listed, or the first one read, stands its
  // Home in the step's place. Note that Home with a task still bound is left as it is, since the binding moves it next
  // (`places/place-binding.ts`).
  // Note that it is compared by the address step its link names, so a slug renamed, or a workspace addressed by its id, stands Home at the step Copy link names.
  const homeElsewhere =
    input.homeView.open &&
    boundFor === undefined &&
    listedStep !== undefined &&
    input.homeView.standingIn !== listedStep;
  // Note that Home whose own workspace the reader is no longer in is found not there by its route without moving, and turns
  // the same way, while an address naming a workspace never the reader's, as a link's, stays not found.
  const homeWasIn = useRef<string | undefined>(undefined);
  const unknownIn = input.unknownWorkspaceView.workspace;
  // Note that it is kept only while the page saying so stands at Home's own workspace, so a not-found page Home was left for keeps none.
  if (input.homeView.open) homeWasIn.current = input.homeView.standingIn;
  else if (unknownIn !== homeWasIn.current) homeWasIn.current = undefined;
  const homeLost = unknownIn !== undefined && unknownIn === homeWasIn.current;
  const turnHome = input.homeView.onTurn;
  useEffect(() => {
    if ((homeElsewhere || homeLost) && listedStep !== undefined) turnHome(listedStep);
  }, [homeElsewhere, homeLost, listedStep, turnHome]);
  // Descriptions is each workspace's choice, so a task's description, its sections, comments, and history stand by its own
  // workspace's: a task the window holds none of by the workspace its link names, else by the open task's, whose words
  // mention it, else by the listed one. Its choices are read off main's document, as the description's own page reads
  // them (`useWorkspaceExperiment`), so the two agree.
  const choosing = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_CHOOSING;
  const openWorkspace = region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : undefined;
  const workspaceOfTask = (taskId: string, step?: string): string | undefined =>
    tasks.tasks.find((each) => each.id === taskId)?.workspaceId ??
    (step === undefined ? undefined : workspaceOfSlug(choosing, step)?.id) ??
    openWorkspace ??
    workspace.chosen?.id;
  const descriptionsOnFor = (taskId: string, step?: string): boolean =>
    experimentOn(
      workspaceExperimentChoices(choosing, workspaceOfTask(taskId, step)),
      EXPERIMENT.DESCRIPTIONS,
    );
  // The version history is the router's (`version-history-route.ts`), of the task its address names by its number in the
  // workspace it names, or by its id, found among the tasks the window holds, else asked of the service as a link's is.
  const routedStep = historyRoute.task;
  const routedNumber =
    routedStep === undefined
      ? undefined
      : taskNumberOf({ kind: LINK_PLACE.TASK, planId: routedStep });
  const routedHome =
    historyRoute.workspace === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, historyRoute.workspace)?.id;
  // Note that a step naming none of the reader's workspaces, once they are read, names none of their tasks by number either.
  const homeNamed =
    historyRoute.workspace === undefined ||
    viewed.workspaces.length === 0 ||
    routedHome !== undefined;
  const namesTask = (task: {
    readonly id: string;
    readonly number?: number | undefined;
    readonly workspaceId: string;
  }) =>
    task.id === routedStep ||
    (homeNamed &&
      taskLinkStep(task) === routedStep &&
      (routedHome === undefined || task.workspaceId === routedHome));
  const heldTask =
    routedStep === undefined
      ? undefined
      : (tasks.tasks.find(namesTask) ??
        (region.kind === DOCUMENT_REGION.READY && namesTask(region.task)
          ? region.task
          : undefined));
  const findsTask =
    heldTask === undefined && routedNumber !== undefined && historyRoute.workspace !== undefined;
  const found = useQuery({
    ...taskByNumberQueryOptions(historyRoute.workspace ?? "", routedNumber ?? 0),
    enabled: findsTask,
    select: (answer) => ("taskId" in answer ? answer.taskId : undefined),
  });
  const foundTask = found.data;
  // A number the service finds no task for has no history to show, so its step gives way to the task, opened as its link opens it, whose Not found stands.
  const numberMissing = findsTask && !found.isPending && foundTask === undefined;
  const routedHistoryTask =
    routedStep === undefined
      ? undefined
      : (heldTask?.id ?? (routedNumber === undefined ? routedStep : foundTask));
  // The task a version history's address names opens under it as the history lands, whatever stood in the plan's place giving way, as opening it always had them.
  const landHistory = useRef<(taskId: string) => void>(() => undefined);
  useEffect(() => {
    if (routedHistoryTask === undefined) return;
    landHistory.current(routedHistoryTask);
    // A save sought is the opening's alone, so the history left lets it go.
    return () => setHistorySeek(undefined);
  }, [routedHistoryTask]);
  // The history is the description's, which stands only while Descriptions is on (`versionHistoryRouteStands`).
  const historyOpen =
    routedHistoryTask !== undefined &&
    routedHistoryTask === boundFor &&
    descriptionsOnFor(routedHistoryTask, historyRoute.workspace) &&
    region.kind !== DOCUMENT_REGION.MISSING;
  // A plan the service would not hand the reader has no history to show, so its step gives way to the task, whose Not found stands, as a version's link may ask for one.
  const historyMissing =
    routedHistoryTask !== undefined &&
    routedHistoryTask === tasks.activeTaskId &&
    region.kind === DOCUMENT_REGION.MISSING;
  const giveHistoryWay = useRef(historyRoute.onGiveWay);
  giveHistoryWay.current = historyRoute.onGiveWay;
  useEffect(() => {
    if (historyMissing) giveHistoryWay.current();
  }, [historyMissing]);
  const showMissingTask = useRef<(taskId: string) => void>(() => undefined);
  useEffect(() => {
    if (!numberMissing || routedStep === undefined) return;
    giveHistoryWay.current();
    showMissingTask.current(routedStep);
  }, [numberMissing, routedStep]);
  // A pin stays chosen while its task stays open, whichever of its tabs is
  // shown: once its task opens it is held there, and any other task opening
  // lets it go. Note that this reads the task open rather than the one asked
  // for, because an ask the host refuses leaves the pin chosen.
  if (chosen !== undefined && openTaskId !== chosen.over) {
    const pinTask = "task" in chosen.pin ? chosen.pin.task : undefined;
    setChosen(openTaskId === pinTask ? { pin: chosen.pin, over: openTaskId } : undefined);
  }
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
  // The task last asked to open, until its document is drawn ready: a later
  // ask replaces it, and one refused, or left for another, ends untimed.
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
  // The tasks a task's own address may name: those listed, and the one whose description is drawn, which a link may have
  // opened though no list holds it.
  const addressed = useMemo(
    () =>
      readyTask === undefined || tasksNow.some((task) => task.id === readyTask.id)
        ? tasksNow
        : [...tasksNow, readyTask],
    [tasksNow, readyTask],
  );
  // The task the task's own place stands on, by its address (`task-route.ts`).
  // Note that a step holding a task's step is that task's place whatever address its link gave it, as a narrow room's
  // side panel names a Pull request tab by its agent alone.
  const taskRouted =
    input.taskView.saved ??
    (input.taskView.at === undefined
      ? undefined
      : taskOfAt(input.taskView.at, addressed, workspacesNow));
  // Whether a door opening a task, or starting one, stands the task's own place: from Home, the task's own place, an
  // address the window's state draws, and a place standing in the task's place (`PlaceDeclaration.inTaskPlace`); a place
  // standing beside it, as the Board, keeps standing, the task opening under it.
  const opensTaskPlace =
    input.place === undefined ||
    input.place.binding !== PLACE_BINDING.KEPT ||
    input.place.inTaskPlace;
  // Stands the own place of `taskId`, where a door opening it does, answering whether the window moved: not where it
  // stands already, read as the router stands at the call. Note that a fixture run binds its task for good, so its task's
  // place stands for any, and Home where it binds none.
  // What the link opening now opens on its task's own place, which the window's move there holds (`places/link-places.ts`).
  const linking = useRef<LinkStep | undefined>(undefined);
  const standTaskPlace = (taskId: string | undefined): boolean => {
    if (!opensTaskPlace) return false;
    const toward = fixture === undefined ? taskId : openTaskId;
    if (toward === undefined) {
      const moved = !input.homeView.open;
      input.homeView.onOpen();
      return moved;
    }
    const at = taskAtOf(
      toward,
      addressed,
      workspacesNow,
      listedWorkspace,
      input.taskView.workspaceNow(),
    );
    if (at === undefined) return false;
    // Note that a task stands where its address names it, by the window's tasks or as the same step, as a number they hold none for,
    // and where the step standing holds it whatever its address, as a narrow room's at its side panel's worker or Pull request link.
    const now = input.taskView.atNow();
    const standing =
      input.taskView.savedNow() === toward ||
      (now !== undefined &&
        ((now.workspace === at.workspace && now.task === at.task) ||
          taskOfAt(now, addressed, workspacesNow) === toward));
    if (standing) return false;
    // Note that a link's door names what it opens there, so its step is written at once, at its address, with it.
    const step = linking.current;
    const visited = step !== undefined && step.taskId === toward && input.visitTask(at, step);
    if (!visited) input.taskView.onOpen(at);
    return true;
  };
  const standTask = useRef(standTaskPlace);
  standTask.current = standTaskPlace;
  // The task whose own place stood as the window was last drawn, which a press reads as where it was pressed.
  const routedTask = useRef({ taskId: taskRouted, opens: opensTaskPlace });
  routedTask.current = { taskId: taskRouted, opens: opensTaskPlace };
  // Opening a task, or leaving one, is going to its own place, whatever stood there giving way, as only one place stands
  // at a time (`places/routed-places.ts`), unless the door `stays`, as a version history opening over its task.
  // Note that `onOpened` runs only once the task opened, because a task that
  // would not open must not leave the sidebar on another workspace, this
  // launch or the next.
  const openTask = useCallback(
    (taskId: string, onOpened: () => void, onRefused?: () => void, stays = false) => {
      // Note that what stood at the press is read before the move, so a refusal stands it again; a version history is left by
      // the doors that open it, which a refusal never brings back, as its task is what opens.
      const moved =
        !stays &&
        routedTask.current.opens &&
        (fixture === undefined ? taskId : openTaskId) !== routedTask.current.taskId;
      const standBack = pressedOverNow.current(false, moved);
      // Note that the task is asked for before the window moves, so its arrival finds it asked for already.
      const takeBack = fixture === undefined ? ask(taskId) : NO_TAKE_BACK;
      if (!stays) standTask.current(taskId);
      // Another task asked for is timed to its document drawn ready; the one
      // open already has nothing to wait on.
      const timed = { taskId, startedAt: Date.now() };
      opening.current = taskId === openTaskId ? undefined : timed;
      const withdraw = () => {
        takeBack();
        if (opening.current === timed) opening.current = undefined;
        // A refusal with no way of its own stands again what stood where another task's open was pressed; the task already
        // open, and a fixture run's, which binds nothing asked of it, stand as they are.
        if (onRefused !== undefined) onRefused();
        else if (fixture === undefined && taskId !== openTaskId) standBack();
      };
      sendSelect({ taskId }).then((opened) => {
        if (!opened) {
          withdraw();
          return;
        }
        onOpened();
      }, withdraw);
    },
    [sendSelect, fixture, openTaskId, ask],
  );
  // Binding no task is asked rather than told, so a refused one takes its ask back too. It is what arriving on Home asks of
  // the host (`places/place-binding.ts`), never a door of its own.
  const unbindTask = useCallback(() => {
    opening.current = undefined;
    if (fixture !== undefined) return;
    const takeBack = ask(undefined);
    sendClose().catch(takeBack);
  }, [fixture, ask, sendClose]);
  // Home is the page of no task bound, so leaving the open task, or going Home from anywhere, is a navigation to Home, whose
  // arrival asks the host to bind none; on Home already, it only lets go of a task still bound there. Note that it reads
  // where the window stands as it is called, since a toast's Back calls it long after it was handed.
  const homeOpen = input.homeView.open;
  const homeNow = useRef({ home: input.homeView, boundFor });
  homeNow.current = { home: input.homeView, boundFor };
  // Note that a fixture run binds its task for good, so leaving it stands that task's own place, as it always has.
  const leaveTask = useCallback(() => {
    const now = homeNow.current;
    if (fixture !== undefined && now.boundFor !== undefined) standTask.current(now.boundFor);
    else if (!now.home.open) now.home.onOpen();
    else if (now.boundFor !== undefined) unbindTask();
  }, [fixture, unbindTask]);
  // A workspace chosen on purpose, from the switcher, a workspace made, or
  // one left, is listed at once, and the task on screen follows: the task
  // last open there opens again, where it is still that workspace's, or
  // else the home page, so the task on screen is the listed
  // workspace's. A remembered task that would not open gives way to the home
  // page, unless the developer went somewhere else meanwhile.
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
    (taskId: string, stays = false) => {
      navigations.current += 1;
      const mine = navigations.current;
      const taskWorkspace = tasksNow.find((task) => task.id === taskId)?.workspaceId;
      const target = workspacesNow.find((each) => each.id === taskWorkspace);
      const from = workspacesNow.find((each) => each.id === listedId);
      const over = openTaskId;
      const opened = () => {
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
      };
      openTask(taskId, opened, undefined, stays);
    },
    [tasksNow, workspacesNow, listedId, openTaskId, openTask, chooseListed, toast, leaveTask],
  );
  // Note that the version history stands over its task, so its task is asked for where the window already stands.
  landHistory.current = (taskId) => {
    if (taskId !== boundFor) select(taskId, true);
  };

  // A fixture's tasks are deleted nowhere, as they are read from nowhere. A
  // delete that landed says nothing, since the task leaving the list says it;
  // a refusal is said where the question that asked it stands, or in a toast
  // where the task leaving took it away (`use-refusal-heard.ts`).
  const sendDeleteTask = async (taskId: string): Promise<ActedResult> => {
    if (fixture !== undefined) return DELETE_REFUSED;
    const deleted = await askKept(sendAct(ACT_KIND.TASKS_DELETE, { taskId }));
    if (deleted.kept) return { status: ACTION_RESULT_STATUS.ACCEPTED };
    return { ...DELETE_REFUSED, cause: deleted.cause };
  };
  const deleteTaskOptions = taskDeleteMutation(sendDeleteTask);
  const { mutateAsync: deleteTask } = useMutation(deleteTaskOptions);

  // The tasks the tab draws as they stand at each call, and each row write's
  // mutation, which ⌘Z reads a press's rows and sends its writes through (`undo-stack.ts`).
  const drawnTasks = useRef(tasks);
  drawnTasks.current = tasks;
  const drawnRows = (): TaskRows => ({
    tasks: drawnTasks.current,
    held: appStateIn(queryClient)?.[LIVE_READ.DESCRIPTION_DOCUMENT],
  });
  const renameDoors: RowDoors<TaskRows, typeof ROW_WRITE.TASK_RENAME.kind> = {
    rows: drawnRows,
    send: sendTaskRename,
  };
  const taskPinDoors: RowDoors<TaskRows, typeof ROW_WRITE.TASK_PIN.kind> = {
    rows: drawnRows,
    send: sendTaskPin,
  };
  const agentPinDoors: RowDoors<TaskRows, typeof ROW_WRITE.AGENT_PIN.kind> = {
    rows: drawnRows,
    send: sendAgentPin,
  };
  const standingDoors: RowDoors<TaskRows, typeof ROW_WRITE.TASK_STANDING.kind> = {
    rows: drawnRows,
    send: sendStandingRow,
  };

  // A fixture's tasks are renamed nowhere, as they are read from nowhere.
  const renameTask =
    fixture === undefined
      ? taskRenameMutation((asked) => sendAct(ROW_WRITE.TASK_RENAME.kind, asked), renameDoors)
      : taskRenameMutation(() => Promise.resolve(false), undefined);

  // The open task as it stands when a move is answered, which may be
  // another than the one open when it was pressed.
  const openNow = useRef(openTaskId);
  openNow.current = openTaskId;

  // A fixture's tasks are marked nowhere, as they are read from nowhere.
  // Main draws a pin at once and puts it back where the service refused it;
  // a pin says nothing once it lands, since the row it moves is in sight,
  // and a refusal says so in a toast, since the menu that asked has closed;
  // one kept is ⌘Z's to take back. It answers whether the service kept the
  // mark, which the pin migration above waits on.
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
  // A fixture's repositories are pinned nowhere, as its tasks are marked
  // nowhere. Main draws a pin at once and puts the group back where the
  // service refused it (`@repo/host`'s `sidebar-collections.ts`); a pin says
  // nothing once it lands, since the group it moves is in sight, and a
  // refusal says so in a toast, since the menu that asked has closed.
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

  // Each agent's pins in flight, the newest last, which the next waits on,
  // each answering how it landed, or nothing where it was never asked.
  const agentPinFlights = useRef(new Map<string, Promise<unknown>>());
  // The account signed in now, which a pin waiting its turn must still be pressed under.
  const accountNow = useRef(input.account);
  accountNow.current = input.account;
  // A fixture's agents are pinned nowhere, as its plans are marked nowhere.
  // Main draws a pin at once and puts the row back where the service refused
  // it; a pin says nothing once it lands, since the row it moves is in sight,
  // and a refusal says so in a toast, since the menu that asked has closed.
  // Note that one agent's pins are asked one after another, because each
  // writes as it lands, so a Pin and an Unpin pressed together landing out
  // of order would leave standing the one not pressed last. One still
  // waiting when the account changes is never asked, since a pin is its
  // presser's own and would land on whoever signed in since.
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

  // An agent's tab an earlier version pinned on this Mac becomes the agent's
  // own pin on the account, standing where it was dragged, as a Plan tab's
  // becomes its task's: once the list followed live names the task it was
  // pinned on, asked after that agent's pins already in flight, so an Unpin
  // pressed at launch is not undone by it. It leaves this Mac only once the
  // account's pin landed, archived agents among those pinned, and a refusal
  // keeps it for a later launch, drawn nowhere. Note that a refusal of an
  // agent the service says it reads none of keeps it too, because the
  // service answers so as well for an agent the account cannot see just now,
  // its access to the agent's repository gone for a while, and only the pin
  // kept here would bring it back. An agent the account already pinned only
  // lets it go. Each agent is asked once a launch.
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

  // A fixture's pins are moved nowhere, as they are pinned nowhere. Each pin
  // a drop gave a place is asked of the service, which main draws at once: a
  // plan's through the host, which asks one change at a time, and an agent's
  // after that agent's pins already in flight, as a pin waits, and never
  // under an account signed in since. A refusal is put back by main, and
  // whatever else the drop placed on this Mac alone by `putBack`, and says
  // so once for the drop, since the pointer that asked has let go.
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

  // A drag's or a menu's changes to the sections go to main as one ask,
  // which draws them at once and writes them in order after every ask
  // before them, putting them back where the service refused one
  // (`@repo/host`'s `sidebar-collections.ts`). A fixture's sections are
  // changed nowhere, as its repositories are pinned nowhere.
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

  // The tasks as the list holds them, or the open document where the list does not hold one yet.
  const standingTasksOf = (taskIds: readonly string[]) => {
    const held = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
    return taskIds.flatMap((taskId): readonly Pick<TaskSummary, "id" | "status">[] => {
      const task = tasks.tasks.find((each) => each.id === taskId);
      if (task !== undefined) return [task];
      return held?.id === taskId ? [held] : [];
    });
  };
  // A change of where a task stands, its status, priority, or assignee, is
  // sent, which main draws at once and puts back where the service refused
  // it. Answers whether the service kept it, with what refused it where it did not.
  const sendStanding = (
    taskId: string,
    standing: TaskStanding,
    assigneeName?: string,
  ): Promise<Kept> => {
    // Note that the name the reader knows a member by goes with them, so main draws them by it until the list carries them.
    const named = standing.assigneeId && assigneeName !== undefined ? { assigneeName } : undefined;
    return askKept(sendStandingRow({ taskId, ...standing, ...named }));
  };
  // Each status change is sent as one standing. Answers which tasks the
  // service kept, how many it refused, and what refused the first of them.
  const sendStatuses = (changes: readonly StatusChange[]) => {
    const answers = changes.map(({ taskId, status }) => sendStanding(taskId, { status }));
    return Promise.all(answers).then((changed) => {
      const landed = changes
        .filter((_, index) => changed[index]?.kept === true)
        .map(({ taskId }) => taskId);
      return { landed, refused: changes.length - landed.length, cause: firstRefusal(changed) };
    });
  };

  // Tasks set at a status by one press answer with one toast rather than
  // one each, and are one entry for ⌘Z, whose Undo the toast runs: it puts
  // back the status of every task the service kept that still stands where
  // the press left it (`undo-stack.ts`). The open task stays open, since a
  // task done or canceled is still read and worked on.
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

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(descriptionMarkdown(region.task), TASK_COPIED_NOTE);
  };

  // An agent that ended unseen marks its tab unread; main clears it once the
  // tab is shown.
  const unreadTabs: readonly StripTab[] = input.unseenAgents.map((agent) => agentTab(agent));

  // A fixture's repositories are read from nowhere, as its tasks are. The
  // chip lists the repositories of the workspace its task is in: the open
  // task's, else the one New task starts in.
  const repositoriesOf =
    region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : listedWorkspace?.id;
  const openGitHub = useCallback((url: string) => appPlatform().openGitHub(url), []);
  /**
   * The repository chip's list for one workspace: the repositories its tasks
   * were about lately that its GitHub reaches, newest first, so a task never
   * starts on another workspace's nor on one a task stranded there by #2524
   * still names; a read of every repository its GitHub reaches; whether the
   * account manages it, so can connect its GitHub; and whether it has a
   * GitHub connected, so a read finding none installed says GitHub removed
   * or suspended it. A workspace not yet read is taken as managed, so the
   * chip still points somewhere, and its recent repositories are left to the
   * service's read to judge; and whether the tasks are still being read, so
   * the chip asks for no pick before its default could be known.
   */
  const repositoriesIn = useCallback(
    (workspaceId: string | undefined): RepositoryChooser => {
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
  // The open task's chip, or New task's, made again only as what it lists from moves.
  const repositories = useMemo(
    () => repositoriesIn(repositoriesOf),
    [repositoriesIn, repositoriesOf],
  );
  // A fixture's GitHub is connected nowhere. Connecting opens the service's
  // page, and the connection arrives on the view once the panel comes forward
  // again; disconnecting asks the service under the Mac's session, and the
  // view takes the answer at once. A refusal of either says why in a toast.
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
  // A fixture's tasks are given no repository, as they are read from nowhere.
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

  // A fixture's tasks are read from nowhere, so nothing keeps where they
  // stand. A change the service kept is ⌘Z's to take back.
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

  // A fixture's tasks are read from nowhere, so no block of one is kept. The
  // open document takes the task the service answers, so a refusal is all
  // there is to say, in a toast, since the menu that asked has closed.
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

  // Remove relation asks nothing of a block, since it can be added back: once
  // the service keeps it, a toast offers Undo, which adds the same block again.
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

  // A fixture's tasks are read from nowhere, so no parent of one is kept. The
  // sidebar and the open document take the task the service answers, so a
  // refusal is all there is to say, in a toast.
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

  // Remove parent asks nothing, since the parent can be set back: once the
  // service keeps it, a toast offers Undo, which sets the parent it had.
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

  // A relation's kind moves in one call, so a refusal leaves it as it stood,
  // and the sidebar and the open document take the task the service answers.
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

  // A fixture's tasks move nowhere, as they are read from nowhere. Note that
  // the workspace moves with the task, because the sidebar lists one
  // workspace's tasks and the open task must not drop out of it, but only
  // while that task is still open and no workspace was chosen since, so a
  // move answered late never undoes where the developer went meanwhile.
  const moveTaskOptions = taskMoveMutation(({ taskId, workspaceId, quiet }) => {
    if (fixture !== undefined) return Promise.resolve(false);
    const choicesThen = workspaceChoices.current;
    return sendAct(ACT_KIND.TASKS_MOVE, { taskId, workspaceId })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) {
          // A first workspace read landing meanwhile lists one too, but nobody chose it.
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

  // A fixture's tasks are read from nowhere, so an edit of one is never saved.
  const descriptionEdit = (taskId: string) =>
    descriptionEditMutation(taskId, (request) =>
      fixture === undefined
        ? sendAct(ACT_KIND.TASKS_EDIT, { taskId, edit: request })
        : Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
    );

  // The chip's menu stands on the open task's toolbar, so another task's is
  // opened first; the ask is counted so each press opens it again.
  const changeRepository = (taskId: string) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    setRepositoryMenu((held) => ({ taskId, request: (held?.request ?? 0) + 1 }));
  };

  // The add menu hangs from the task's head, so the task opens first, as
  // Change repository's chip does, and comes out from under a page standing
  // in its place, such as the Board whose card asked.
  const addRelation = (taskId: string, kind: TaskRelationKind) => {
    showTask(taskId);
    setRelationMenu((held) => ({ taskId, kind, request: (held?.request ?? 0) + 1 }));
  };

  // A fixture's task reads its staged history through the same acts, and holds it on its staged document (`tasks-fixture.ts`).
  const historySource = useMemo(
    (): DescriptionHistorySource => ({
      readPage: (taskId, before) => askAct(ACT_KIND.TASKS_REVISIONS, { taskId, before }),
      restore: (taskId, seq) => sendRestore({ taskId, seq }),
    }),
    [sendRestore],
  );
  const historyTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  // The open task's history is held while its version history is shown, and main keeps it a while after, so one opened again lists its versions in its first frame.
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
    at: shown && historyOpen ? historyRoute.spot : undefined,
    seek: historySeek?.taskId === historyTaskId ? historySeek?.save : undefined,
    narrow: input.room === SHELL_ROOM.NARROW,
    onMove: historyRoute.onMove,
    onSought: () => setHistorySeek(undefined),
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) => sayRestored(toast, undo),
  });

  const opensNewTask =
    useQuery({ ...appStateQuery, select: selectOpensNewTask }).data ??
    APP_SETTING_DEFAULTS.openNewTask;
  // A task opened from a list or a started task's toast, its pin no longer chosen.
  const openUnpinned = (taskId: string) => {
    setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
    select(taskId);
  };
  // One the developer goes back to work on, from a sidebar row, ⌘K, or Recent, lands on its
  // agent (`resumingAgentOf`); one with none, on the tab its column falls to, a new agent's draft
  // where no agent's stands. In a narrow room the panel shuts over it, and the agent stands as a
  // screen over the task's details, which its header's Back, named for the task, returns to, a
  // task with no agent opening on its details.
  const resumeListed = (taskId: string) => {
    openUnpinned(taskId);
    const narrow = input.room === SHELL_ROOM.NARROW;
    if (narrow) sidePanel.onSetOpen(false);
    const agentId = resumingAgentOf(taskId, tasks.taskAgents, input.inboxWaiting);
    if (agentId !== undefined) mainTabs.onShow(taskId, agentTab(agentId));
    else if (narrow) mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  // A task pressed anywhere opens on its agents, as one gone back to does; in a narrow room on
  // its details, whose head lists its agents, the one waiting on the developer first.
  const selectListed = (taskId: string) => {
    if (input.room !== SHELL_ROOM.NARROW) {
      resumeListed(taskId);
      return;
    }
    openUnpinned(taskId);
    sidePanel.onSetOpen(false);
    mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  // A started task becomes the host's open one, which turns the page to it,
  // so the dialog closes and the Inbox or a version history standing behind
  // it gives way. It starts in the chosen workspace; with none listed the
  // service starts it in the account's first one. A name left blank is not
  // sent, and the plan stands as Untitled. A start opens no call, and
  // names no planning, so the task opens on its empty description. New task starts the task
  // and its agent in that one start, under the key its card holds
  // (`agentRequest`), and opens the task on the agent's tab, or on a draft
  // holding the words with why where the agent was refused (`openAgent`).
  // An agent's start answered after the developer opened another task, or
  // left the task, opens nothing (the host's `TASKS_START`), so the window
  // stays where they went, and the agent's tab is the one the task opens on
  // when they come to it.
  // Note that a start whose task was refused, or never answered, is never
  // sent again by itself, because the service keeps no key for a task, so a
  // second start could make a second task; the card says why with Retry.
  // With Settings' Open a task once it starts off, the start is a quiet one:
  // the window stays on the page it was on, the agent's tab is made ready
  // for when the task opens, and a toast says the task started with Open.
  const startTask = (
    name: string,
    repository: string | null,
    workspaceId: string | undefined,
    from: NewTaskStart = {},
  ): Promise<Failure | undefined> => {
    // An agent's start opens on its task's page at once, its words drawn as
    // the agent's first line, rather than holding the card until the
    // service answers; a refusal opens the card again where it was left.
    const { handed, card } = from;
    const stays = !opensNewTask;
    // Note that the agent's first line is stamped at the press, which its line after the answer keeps.
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
    // Note that a start's page is let go only while it is still this start's, because another start may have replaced it.
    const letGoOfPage = () => setStartingTask((now) => (now?.line === line ? undefined : now));
    // Staying, an agent's start puts the card away at once and opens nothing; an opening one stands the task bound's own
    // place, or Home, where its page draws, in place of whatever stood in it.
    // Note that what stood at the press is where its address stood, which a refusal opens again.
    let standBack = pressedOverNow.current(true, false);
    if (handed !== undefined && stays) setNewTaskAsk(undefined);
    else if (line !== undefined) {
      const moved = standTask.current(boundFor);
      standBack = pressedOverNow.current(true, moved);
      setStartingTask({ line, choice: handed?.choice, arrivals: arrivals() + (moved ? 1 : 0) });
      setNewTaskAsk(undefined);
    }
    // Note that the host opens a start's task at once, so a bare one pressed on Home's own
    // composer, whose page the task's took the place of, says its refusal in a toast, as no
    // card stands to say it.
    const saidInToast = handed === undefined && !stays && newTaskAsk === undefined;
    // Note that a refusal keeps what refused it, so the box that shows it reports that in its place.
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
        // Note that what stood before the press comes back only where the developer went nowhere since.
        standBack();
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
        // Note that an agent's start put the card and whatever stood away as it was pressed, so
        // what stands now is the developer's since, a New task opened again among it, and stays.
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
          standTask.current(homeNow.current.boundFor);
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

  // A task started without opening says so in a toast whose Open opens it
  // as an opening start would, on the agent's tab where its agent started,
  // or on the draft saying why where it did not, which the toast says too,
  // so a narrow room does not lay the plan over it as a list's press does.
  // Note that Open asks first while a page stands unsaved work, as the
  // sidebar's press does, and reads the opener of the render it is pressed in.
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

  // A task started with an agent opens on the agent's tab, as a landed
  // Start opens it; one whose agent was refused opens on a draft holding
  // the words, the files, the model, and the servers under the start's key, with why
  // under its box, whose Retry is the agent's own Start on the task. Either
  // opens on the agent's tab, the task's Overview beside it, so the side
  // panel stands as it stood on every other task.
  // Note that an answer naming neither is read as one the service never gave.
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
      mainTabs.onShow(planId, agentTab(started.agent.id));
      return;
    }
    // Note that the refusal keeps the answer that said it, so the draft's tab reports the service's word for it.
    const answer = started ?? { failure: AGENT_CALL_FAILURE.UNANSWERED };
    const refused = { ...agentStartFailureNote(answer, planId, device), cause: answer };
    const { idempotencyKey: id, ...words } = handed;
    agents.onHandDraft(planId, { id, ...words, refused });
    mainTabs.onShow(planId, draftTab(id));
  };

  // Note that New task's start is a steady door, so the dialog handed it holds while nothing it draws moves.
  const steadyStartTask = useSteadyDoor(startTask);

  // A group's quick add starts a task with no agent and no call, quietly, so
  // the window stays on the Tasks page and the task lands in its group.
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

  // New task opens the dialog over whatever stands, an open task and its
  // call included, which stay until a task is started. Note that a press
  // while the dialog stands, as the menu bar's still can, leaves it as it is,
  // because a fresh ask would keep the card's draft under another preset.
  const newTaskWith = (preset: TasksControl["newTask"]["preset"]) =>
    setNewTaskAsk((standing) => standing ?? { preset });
  // Home opens on New task's composer, so a plain New task there takes its
  // caret rather than drawing the same card again in a dialog over it. Note
  // that the tab need not be shown, because every New task press brings it
  // forward first.
  const newTask = () => {
    // Note that only Home's own route draws its composer (`ROUTED_PLACE.HOME`), once no task is bound there.
    const atHome = input.homeView.open && boundFor === undefined;
    if (atHome && signedIn && newTaskAsk === undefined) setHomeNewTasks((n) => n + 1);
    else newTaskWith(undefined);
  };
  // The dialog is the Tasks tab's, so Settings taking the window puts it
  // away rather than leaving it to stand again on the way back.
  if (!shown && newTaskAsk !== undefined) setNewTaskAsk(undefined);

  // A description's version history opens over the task, so another task opens first.
  // Note that a task's versions are its description's, so while Descriptions is off whatever would open them, a link to a version among them, opens the task's Overview.
  // A task's history's address names it as its links do, under its workspace, the one a link named where the window holds no such task, else the listed one;
  // a workspace not yet read is named by its id, as a link names one.
  const historyAddressOf = (taskId: string, workspace: string | undefined) => {
    const task =
      tasksNow.find((each) => each.id === taskId) ??
      (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
        ? region.task
        : undefined);
    const home = viewed.workspaces.find((each) => each.id === task?.workspaceId);
    const listedStep = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
    const under =
      home === undefined ? (workspace ?? task?.workspaceId ?? listedStep) : stepOf(home);
    return under === undefined
      ? undefined
      : { workspace: under, task: task === undefined ? taskId : taskLinkStep(task) };
  };
  // It is opened at its address (`version-history-route.ts`).
  const openHistory = (
    taskId: string,
    opening: {
      readonly save?: number | undefined;
      readonly spot?: HistorySpot;
      readonly workspace?: string;
    },
  ) => {
    if (!descriptionsOnFor(taskId, opening.workspace)) {
      showOverview({ kind: LINK_PLACE.TASK, planId: taskId });
      return;
    }
    const address = historyAddressOf(taskId, opening.workspace);
    if (address === undefined) return;
    if (taskId !== boundFor) select(taskId, true);
    setHistorySeek(opening.save === undefined ? undefined : { taskId, save: opening.save });
    historyRoute.onOpen(address.workspace, address.task, opening.spot);
  };
  // A task's own place, whatever stands giving way as only one place stands at a time (`places/routed-places.ts`), its
  // task asked of the host where it is another than the one open.
  const showTask = (taskId: string) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    else standTaskPlace(taskId);
  };

  // A task's own tab, its Inbox, and an agent's are in its column, so a
  // version history over it gives way, and so does a side panel filling the
  // window over it.
  const showColumnTab = (taskId: string, tab: MainTab) => {
    showTask(taskId);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(taskId, tab);
  };

  // A tab of the side panel, on its plan, out from under a version history or whatever stands in the plan's place.
  const showPanelTab = (taskId: string, tab: SidePanelTab) => {
    showTask(taskId);
    sidePanel.onShow(taskId, tab);
  };
  // The task's description shown at the place given: its column's Overview, which
  // holds it, chosen in place on the task standing, and on another task as
  // the window goes there (`route.ts`), a panel filling the window over the
  // column giving way.
  const showOverview = (place: OverviewPlace) => {
    const standing = !overPlan && !historyRoute.open;
    const routed = route(
      { kind: ADDRESS.PLACE, link: { workspace: "", place } },
      { kind: HERE.TASKS_TAB, taskId: standing ? tasks.activeTaskId : undefined },
    );
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    if (routed.kind === ROUTE.OVERVIEW) {
      mainTabs.onChoose(MAIN_TAB.OVERVIEW);
      return;
    }
    showTask(place.planId);
    mainTabs.onShow(place.planId, MAIN_TAB.OVERVIEW);
  };
  // A link to a tab of the task standing opens it in the panel, as any link
  // pressed there does; one to another task's goes there and opens
  // it as a tab of its own (`route.ts`).
  const linkPanelTab = (place: TaskTabPlace, tab: SidePanelTab) => {
    const standing = !overPlan && !historyRoute.open;
    const routed = route(
      { kind: ADDRESS.PLACE, link: { workspace: "", place } },
      { kind: HERE.TASKS_TAB, taskId: standing ? tasks.activeTaskId : undefined },
    );
    if (routed.kind === ROUTE.BESIDE) sidePanel.onOpen(tab);
    else showPanelTab(place.planId, tab);
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

  // A link's workspace, by its id, its slug, or a slug it stood under before, listed where the account is in it and another is listed; answers the workspace listed after it.
  const listLinked = (workspace: string): string | undefined => {
    const home = workspaceOfSlug(viewed.workspaces, workspace);
    if (home !== undefined && home.id !== listedWorkspace?.id) chooseListed(home.id);
    return home?.id ?? listedWorkspace?.id;
  };

  // A version's Open lands where its writer wrote it: an agent's tab.
  const showSource = (taskId: string, source: RevisionSource) => {
    showColumnTab(taskId, agentTab(source.agentId));
  };

  // A task named anywhere, by a chip, a link, an Inbox crumb, or a call's row, opens on its
  // agents, its main view, as one gone back to does (`resumeListed`), a panel filling the window
  // giving way; a task already open on its details goes back to the agents they were opened over.
  // Only a place in its description opens the details.
  const showTaskAgents = (taskId: string) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    const returnTab = taskId === tasks.activeTaskId ? mainTabs.returnTab : undefined;
    if (returnTab !== undefined && isOverviewTab(mainTabs.tab)) {
      standTaskPlace(taskId);
      mainTabs.onChoose(returnTab);
      return;
    }
    resumeListed(taskId);
  };

  // Each ask is its own, so the same section asked twice scrolls twice.
  // Note that a section is the description's, so while descriptions are off a mention of one opens its task's agents.
  const showMention = (mention: DescriptionMention) => {
    const anchor =
      mention.kind === MENTION_KIND.SECTION && descriptionsOnFor(mention.taskId)
        ? mention.anchor
        : undefined;
    if (anchor === undefined) {
      showTaskAgents(mention.taskId);
      return;
    }
    showOverview({ kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor });
    sectionAsks.current += 1;
    setSectionReveal({ taskId: mention.taskId, reveal: { anchor, ask: sectionAsks.current } });
  };
  showMissingTask.current = (taskId) => showMention({ kind: MENTION_KIND.TASK, taskId });

  // The page of `agentId`, under the workspace it stands under where it stands, else `home`, a link's, else the listed one, whatever stood in the plan's place giving way to it as the router stands one place at a time.
  const openAgentPage = (agentId: string, home?: string) => {
    const standing = input.agentView.agentId === agentId ? input.agentView.workspace : undefined;
    const listed = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
    const workspace = standing ?? home ?? listed;
    if (workspace === undefined) return;
    input.agentView.onOpen(agentId, workspace);
  };
  // The Inbox of the workspace `workspaceId`, the listed one where it names none of the reader's, narrowed to `narrowed`.
  const inboxIn = (
    workspaceId: string | undefined,
    narrowed: string | undefined,
  ): InboxAt | undefined => {
    const shown = viewed.workspaces.find((each) => each.id === workspaceId) ?? listedWorkspace;
    return shown === undefined ? undefined : { workspace: stepOf(shown), narrowed };
  };
  // The Inbox opened on `chosen`, or on its list where nothing is chosen, at `at`: a version history or an agent's page there giving way, as the Inbox is the router's.
  const standInbox = (at: InboxAt | undefined, chosen: InboxChoice | undefined) => {
    if (at === undefined) return;
    timeInboxOpen();
    if (chosen === undefined) input.inboxView.onOpen(at);
    else input.inboxView.onChoose(chosen, at);
  };

  // A review thread's ask, taken by its agent's Pull request tab once drawn; each ask is its own.
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
  // A message's ask, which its agent's tab or page takes; each ask is its own, so the same message asked twice is brought into view twice.
  const revealMessage = (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => {
    messageAsks.current += 1;
    setMessageReveal({
      agentId: place.agentId,
      messageId: place.messageId,
      ask: messageAsks.current,
    });
  };

  /**
   * An agent's place on its task: the agent's tab, an archived agent's among
   * them, and the tab of the side panel that shows what the place names. Note
   * that an agent's worker is drawn only while its agent's tab is open, so
   * the agent's tab opens with it, and that its tab is opened with no task
   * words, since a link carries none; its own rows name its task once they land.
   */
  const openOnTask = (planId: string, place: AgentPlace) => {
    const column = agentTab(place.agentId);
    // A tab of the side panel a link opens, and the link a narrow room's step on it stands at (`places/task-step.ts`).
    const sideOf = (tab: SidePanelTab) => ({ tab, link: stripTabLink(tab, { taskId: planId }) });
    switch (place.kind) {
      case LINK_PLACE.WORKER: {
        const tab = subagentTab(place.callId, { agent: place.agentId, task: "" });
        linkingTo({ taskId: planId, column, side: sideOf(tab) }, () => {
          showColumnTab(planId, column);
          linkPanelTab({ ...place, planId }, tab);
        });
        return;
      }
      case LINK_PLACE.CHANGES: {
        const tab = changesTab(sharedChangesAgent(planId, place.agentId));
        linkingTo({ taskId: planId, side: sideOf(tab) }, () =>
          linkPanelTab({ ...place, planId }, tab),
        );
        return;
      }
      // A review thread opens its agent's Pull request tab on the view the link names.
      case LINK_PLACE.PULL_REQUEST_THREAD: {
        const changes = sharedChangesAgent(planId, place.agentId);
        const tab = changesTab(changes);
        sidePanel.onPullRequestView(tab, place.view);
        linkingTo({ taskId: planId, side: sideOf(tab) }, () =>
          linkPanelTab({ ...place, planId }, tab),
        );
        revealThread(changes, place);
        return;
      }
      case LINK_PLACE.AGENT:
        linkingTo({ taskId: planId, column }, () => showColumnTab(planId, column));
        return;
      case LINK_PLACE.MESSAGE:
        linkingTo({ taskId: planId, column }, () => showColumnTab(planId, column));
        revealMessage(place);
        return;
    }
  };

  // An agent's place on its own page, where it works on no task: the page, and the tab of its panel, held under the agent, that shows what the place names.
  const openOnAgentPage = (place: AgentPlace, home?: string) => {
    const { agentId } = place;
    openAgentPage(agentId, home);
    switch (place.kind) {
      case LINK_PLACE.WORKER:
        sidePanel.onShow(agentId, subagentTab(place.callId, { agent: agentId, task: "" }));
        return;
      case LINK_PLACE.CHANGES:
        sidePanel.onShow(agentId, changesTab(agentId));
        return;
      case LINK_PLACE.PULL_REQUEST_THREAD:
        sidePanel.onPullRequestView(changesTab(agentId), place.view);
        sidePanel.onShow(agentId, changesTab(agentId));
        revealThread(agentId, place);
        return;
      case LINK_PLACE.AGENT:
        return;
      case LINK_PLACE.MESSAGE:
        revealMessage(place);
        return;
    }
  };

  /**
   * An app link opened as `openPlace` opens its place, once a task it names
   * by its number in the link's workspace is found by its id on the
   * service. One not found, or not answered, opens by the number as an id
   * naming no task does, its read saying it is not there; nothing opens
   * where the window moved on before the service answered.
   */
  const openLink = (link: ReadLink) => {
    const number = taskNumberOf(link.place);
    if (number === undefined) {
      openLinked(link);
      return;
    }
    // Note that a number the account's list holds under the workspace named opens at once, so a link to the place
    // already standing keeps it standing rather than leaving it while the service is asked (`onStayRouted`).
    const home = workspaceOfSlug(viewed.workspaces, link.workspace);
    const listed = viewed.tasks.find(
      (task) => task.workspaceId === home?.id && taskLinkStep(task) === String(number),
    );
    if (listed !== undefined) {
      openLinked({ ...link, place: withTaskId(link.place, listed.id) });
      return;
    }
    navigations.current += 1;
    const current = linkRead();
    const opened = (taskId: string | undefined) => {
      if (!current()) return;
      openLinked(taskId === undefined ? link : { ...link, place: withTaskId(link.place, taskId) });
    };
    queryClient.fetchQuery(taskByNumberQueryOptions(link.workspace, number)).then(
      (found) => opened("taskId" in found ? found.taskId : undefined),
      () => opened(undefined),
    );
  };

  // An agent's place opened by the agent as the list or the service has it: on its page where it is on no task, else on its task, an archived agent's tab among its tabs.
  const openFoundAgent = (agent: AgentSummary, place: AgentPlace, home?: string) => {
    if (agent.planId === null) openOnAgentPage(place, home);
    else openOnTask(agent.planId, place);
  };

  /**
   * An agent's place opened on its task where it has one, else on its page.
   * Note that a link names the task only where it was written under it, so
   * one naming none finds the task by the agent: at once where the agent is
   * the open task's or one the list followed live carries, else by reading
   * the agent, which opens nothing where the window moved on before it
   * answered.
   */
  const openAgentPlace = (place: AgentPlace, home: string) => {
    const open = tasks.activeTaskId;
    const listed = listedAgentIn(tasks, place.agentId);
    if (place.planId !== undefined) openOnTask(place.planId, place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openOnTask(open, place);
    else if (listed !== undefined) openFoundAgent(listed, place, home);
    else {
      const current = linkRead();
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (!current()) return;
        // Note that an agent not read may yet be on a task, so its page stands alone, its own read saying whether it is there, and no tab of a panel it may not hold opens.
        if (agent === undefined) openAgentPage(place.agentId, home);
        else openFoundAgent(agent, place, home);
      });
    }
  };

  /**
   * An Inbox item opened in the window's Inbox as it stands, its search,
   * view, and narrowing kept, where its task, found already, holds it. Note
   * that only a task the Inbox is narrowed to other than the item's is left,
   * so the list it opens in holds it; a link never narrows the Inbox to its
   * task, which only the task's own "needs you" count does (`onShowInbox`).
   */
  const openInboxItemOn = (workspace: string, place: InboxItemPlace, planId: string | null) => {
    // An item of a task the account lists is shown in the task's own workspace, whatever the slug says.
    const holder = planId === null ? undefined : viewed.tasks.find((task) => task.id === planId);
    const listedId = listLinked(holder?.workspaceId ?? workspace);
    const chosen: InboxChoice =
      holder !== undefined
        ? {
            taskId: holder.id,
            ...("agentId" in place ? { itemAgentId: place.agentId } : undefined),
            itemId: place.itemId,
            opened: true,
          }
        : { ...inboxChoiceOf(place), opened: true };
    // Note that only the narrowing of the Inbox standing is kept, so a link opened from elsewhere opens on every task's list.
    const narrowed = inboxView?.standingIn === undefined ? undefined : inboxView.narrowed;
    standInbox(inboxIn(listedId, narrowed), chosen);
  };

  /**
   * An Inbox item opened by its id alone, as a link written so names it: the
   * service says where it stands, its agent, task, and workspace, for an item
   * the account may read, and it then opens as a link under its agent does;
   * one it may not read, or that does not exist, opens on the Inbox saying it
   * is missing. Note that the workspace is the service's, never the link's
   * slug, which may name a workspace by a slug it has since given up.
   */
  const openInboxItemById = (place: InboxItemPlace) => {
    // Note that the item the Inbox already stands on, once asked after, stands again at once, so the door keeps it standing rather than waiting on the service while the window leaves it;
    // one the service did not find is asked after again below, as a link to it always asks.
    const standing = inboxView?.chosen;
    const asked =
      standing !== undefined &&
      ("taskId" in standing || "agentId" in standing || standing.opened === true);
    if (inboxView?.standingIn !== undefined && asked && standing.itemId === place.itemId) {
      const at = { workspace: inboxView.standingIn, narrowed: inboxView.narrowed };
      standInbox(at, { ...standing, opened: true });
      if ("taskId" in standing || "agentId" in standing) return;
    }
    const current = linkRead();
    readInboxItemHome(queryClient, place.itemId).then((home) => {
      if (!current()) return;
      if (home === undefined) {
        standInbox(inboxIn(listedWorkspace?.id, undefined), { itemId: place.itemId, opened: true });
        return;
      }
      const found = { kind: LINK_PLACE.INBOX_ITEM, agentId: home.agentId, itemId: place.itemId };
      openInboxItemOn(home.workspaceId, found, home.planId);
    });
  };

  /**
   * An Inbox item opened by its task, which a link under its agent leaves
   * the reader to find by the agent, as an agent's place is found
   * (`openAgentPlace`): at once where the agent is the open task's or one
   * the list followed live carries, else by reading the agent, which opens
   * nothing where the window moved on before it answered.
   */
  const openInboxItem = (workspace: string, place: InboxItemPlace) => {
    const open = tasks.activeTaskId;
    const listed = "agentId" in place ? listedAgentIn(tasks, place.agentId) : undefined;
    if ("planId" in place) openInboxItemOn(workspace, place, place.planId);
    else if (!("agentId" in place)) openInboxItemById(place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openInboxItemOn(workspace, place, open);
    else if (listed !== undefined) openInboxItemOn(workspace, place, listed.planId);
    else {
      const current = linkRead();
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (!current()) return;
        openInboxItemOn(workspace, place, agent?.planId ?? null);
      });
    }
  };

  // The Board of `home`, the listed workspace where none is named, opened past whatever stood in the plan's place, which gives way to it.
  const openBoard = (home: Pick<Workspace, "id" | "slug"> | undefined) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    input.boardView.onOpen(stepOf(shown));
  };

  /**
   * A person's page in `home`, the listed workspace where none is named,
   * listed first where another is, because the page reads the listed
   * workspace's work, and only listed, as a link's place is: reopening its
   * last plan behind the page would only hide it again.
   */
  const openPerson = (
    userId: string,
    name: string | undefined,
    home: Pick<Workspace, "id" | "slug"> | undefined,
  ) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    // Note that the page is a navigation of its own, so a plan's open or a workspace's reopen
    // asked before it, answering late, lists nothing and leaves nothing over it.
    navigations.current += 1;
    if (shown.id !== listedWorkspace?.id) chooseListed(shown.id);
    input.personView.onOpen(userId, name, stepOf(shown));
  };

  /**
   * An Automations page under the workspace whose address step is
   * `workspace`, listed first where the account is in it, the listed one
   * otherwise, opened past whatever stood in the plan's place, which gives
   * way to it.
   */
  const openAutomations = (to: AutomationsPlace, workspace?: string) => {
    const listedId = workspace === undefined ? listedWorkspace?.id : listLinked(workspace);
    const shown = viewed.workspaces.find((each) => each.id === listedId) ?? listedWorkspace;
    if (shown === undefined) return;
    input.automationsView.onOpen(to, stepOf(shown));
  };

  const goHome = () => leaveTask();

  // Opens `open` as the door of a link naming `step` on its task's own place, which the window's move there holds.
  const linkingTo = (step: LinkStep, open: () => void) => {
    linking.current = step;
    try {
      open();
    } finally {
      linking.current = undefined;
    }
  };

  /**
   * A link place opened as its route reads it (`places/link-places.ts`): a
   * comment thread or a section opens its task's Overview, asking its page
   * to bring the thread or the section into view, and a page opens the side
   * panel on its tab, on its task or on the page of its agent on no task.
   * Each is the description's but a page, so while descriptions are off a
   * link to one opens the task's agents.
   */
  const openRouted = ({ declared, link }: RoutedLink) => {
    const { workspace, place } = link;
    // Every link opened is a navigation of its own, so an agent's read asked for by an earlier one, answering late, opens nothing.
    navigations.current += 1;
    switch (declared) {
      case LINK_ROUTED_PLACE.COMMENT: {
        if (place.kind !== LINK_PLACE.COMMENT) return;
        const { planId } = place;
        if (!descriptionsOnFor(planId, workspace)) {
          linkingTo({ taskId: planId }, () => showTaskAgents(planId));
          return;
        }
        linkingTo({ taskId: planId, column: MAIN_TAB.OVERVIEW }, () => showOverview(place));
        commentAsks.current += 1;
        setCommentReveal({ planId, thread: place.threadId, ask: commentAsks.current });
        return;
      }
      case LINK_ROUTED_PLACE.SECTION: {
        if (place.kind !== LINK_PLACE.SECTION) return;
        const { planId, anchor } = place;
        const column = descriptionsOnFor(planId) ? MAIN_TAB.OVERVIEW : undefined;
        linkingTo({ taskId: planId, column }, () =>
          showMention({ kind: MENTION_KIND.SECTION, taskId: planId, anchor }),
        );
        return;
      }
      case LINK_ROUTED_PLACE.PAGE: {
        if (place.kind !== LINK_PLACE.PAGE) return;
        const tab = pageTab(place.pageId);
        // A page of an agent on no task opens on that agent's page, in its panel.
        if ("agentId" in place) {
          openAgentPage(place.agentId, workspace);
          sidePanel.onShow(place.agentId, tab);
          return;
        }
        const step = { taskId: place.planId, side: { tab, link: place } };
        linkingTo(step, () => linkPanelTab(place, tab));
        return;
      }
      // An agent's place opens on its task, found by the agent where the link names none, else on its page.
      case LINK_ROUTED_PLACE.AGENT:
      case LINK_ROUTED_PLACE.MESSAGE:
      case LINK_ROUTED_PLACE.WORKER:
      case LINK_ROUTED_PLACE.CHANGES:
      case LINK_ROUTED_PLACE.PULL_REQUEST_THREAD:
        if (isAgentPlace(place)) openAgentPlace(place, workspace);
        return;
    }
  };

  // A link opened by matching it on the route tree, as its link place's route reads it, else through the door its kind has.
  const openLinked = (link: ReadLink) => {
    const listedStep = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
    const routed = routedLinkOf(router, link, input.taskView.workspaceNow() ?? listedStep);
    if (routed !== undefined) openRouted(routed);
    else openPlace(link);
  };

  /**
   * An app link's place opened through the door each kind already has: the
   * task's tabs, its side panel, its version history, or what stands in the
   * plan's place. One of an agent's messages opens the agent's tab and asks
   * it to bring the message into view. Note
   * that nothing is checked here: a place the account cannot read is read
   * all the same, and its read says it is not there.
   */
  const openPlace = ({ workspace, place }: ReadLink) => {
    // Every link opened is a navigation of its own, so an agent's read asked for by an earlier one, answering late, opens nothing.
    navigations.current += 1;
    switch (place.kind) {
      // A step naming no workspace of the reader's, by id, slug, or former slug, is not there for them, so it stands as not
      // found rather than opening the listed workspace or where the window rests.
      case LINK_PLACE.HOME:
      case LINK_PLACE.BOARD:
        if (
          viewed.workspaces.length > 0 &&
          workspaceOfSlug(viewed.workspaces, workspace) === undefined
        ) {
          // Note that it takes the step's place, as the router finds the workspace not found (`panel-router.tsx`).
          input.unknownWorkspaceView.onOpen(workspace);
          return;
        }
        listLinked(workspace);
        if (place.kind === LINK_PLACE.HOME) goHome();
        else openBoard(workspaceOfSlug(viewed.workspaces, workspace));
        return;
      case LINK_PLACE.TASK:
        showMention({ kind: MENTION_KIND.TASK, taskId: place.planId });
        return;
      case LINK_PLACE.VERSION:
        openHistory(place.planId, {
          spot: { revision: place.revision, opened: undefined, listed: false },
          workspace,
        });
        return;
      case LINK_PLACE.PERSON: {
        // A person's page is theirs in the workspace the link names, listed first; one the reader is not in names nobody they can see.
        const home = workspaceOfSlug(viewed.workspaces, workspace);
        listLinked(workspace);
        openPerson(place.userId, undefined, home);
        return;
      }
      case LINK_PLACE.INBOX: {
        // Note that a link to the Inbox opens it as its sidebar row does, on nothing chosen, narrowed to the task it names or to none.
        standInbox(inboxIn(listLinked(workspace), place.planId), undefined);
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
      // Note that an Admin link's workspace is only the one it was copied in, since the place reads every
      // workspace's accounts, so it lists nothing; one naming the place alone opens on its Overview.
      case LINK_PLACE.ADMIN:
        input.adminView.onOpen(adminViewOfLink(place));
        return;
      // Settings is the window's, not the Plans tab's, so its link is opened there.
      case LINK_PLACE.SETTINGS:
        return;
    }
  };

  // An inbox item's code opens in its task's File tab; on a task not yet
  // open, once the host has it open, since the panel draws the open task's.
  const showFile = (taskId: string, ref: CodeRef, commit: string | undefined) => {
    if (taskId === tasks.activeTaskId) {
      standTaskPlace(taskId);
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
  // which lets its draft go.
  const openTabs = mainTabs.tabs;
  const { onClose: closeMainTab, onDoze: dozeMainTab } = mainTabs;
  const keepColumnClosed = useCallback(
    (tab: MainTab) => {
      // Note that the place is counted among the tabs after Overview, as the column's moves are.
      const at = openTabs
        .filter((each) => !isOverviewTab(each))
        .findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0 && stripTabReopens(tab)) {
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
  // Note that an agent's tab closed for being idle opens again as the agent wakes (`use-idle-tabs.ts`).
  const dozeColumnTab = useCallback(
    (tab: MainTab) => {
      keepColumnClosed(tab);
      if (isOverviewTab(tab)) {
        closeMainTab(tab);
        return;
      }
      switch (tab.kind) {
        case STRIP_TAB_KIND.AGENT:
          dozeMainTab(tab);
          return;
        case STRIP_TAB_KIND.DRAFT:
          closeMainTab(tab);
          return;
        default:
          absurd(tab);
      }
    },
    [keepColumnClosed, closeMainTab, dozeMainTab],
  );
  const { strip: panelStrip, files: panelFiles, onClose: closePanelTab } = sidePanel;
  const endTerminal = useEndTerminalTab();
  // Note that a terminal tab's shell ends as its tab closes, whichever way it closes, since the tab
  // is the only place it stands, so the tab goes on no stack of closed tabs: nothing opens it again.
  const closeSidePanelTab = useCallback(
    (tab: SidePanelTab) => {
      if (stripTabEndsSession(tab)) endTerminal(tab);
      const at = panelStrip.findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0 && stripTabReopens(tab)) {
        const file =
          typeof tab !== "string" && tab.kind === STRIP_TAB_KIND.FILE
            ? panelFiles.find((each) => each.path === tab.file)
            : undefined;
        const closed = { strip: CLOSED_TAB_STRIP.SIDE_PANEL, task, tab, at, file };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
      closePanelTab(tab);
    },
    [
      panelStrip,
      panelFiles,
      closePanelTab,
      viewed.activeTaskId,
      setClosedTabs,
      latestClosedTabs,
      endTerminal,
    ],
  );
  // Whether the open task's strips draw a closed tab of it again: an agent's
  // while the agent is the task's, archived or not, never the Inbox, which the panel
  // draws no more, a Changes tab while its agent is the task's, archived or not,
  // and a subagent's or a page's on the strip's own
  // terms. Note that what the task has not read yet counts as drawn, as the
  // strips stand a tab until the read says otherwise.
  // A fixed kind of the side panel draws on every task or on none, so whether it draws again is
  // known before its task opens: the retired Inbox and Comments draw on none.
  const drawsOnAnyTask = (closed: ClosedTab): boolean =>
    closed.strip !== CLOSED_TAB_STRIP.SIDE_PANEL ||
    typeof closed.tab !== "string" ||
    DRAWN_KINDS.some((kind) => kind === closed.tab);
  const drawsAgain = (closed: ClosedTab): boolean =>
    stripTabDrawsAgain(closed.tab, {
      openAgents: mainTabs.openAgents,
      taskAgents: agents.heldIds,
      pages: taskPages === undefined ? undefined : pages,
    });
  const reopenable = withUndrawnPassed(closedTabs, tasks.activeTaskId, drawsAgain, drawsOnAnyTask);

  // A tab not viewed for a day closes itself onto the same stack (`use-idle-tabs.ts`), unless it is
  // pinned, its agent works, waits on the developer, or ended unseen, or nothing could open it again:
  // a draft's, which lets the draft go, a Browser tab's, which takes its
  // page with it, a cloud Browser tab's, which only the "+" opens again, and a terminal tab's,
  // whose shell ends as it closes. The side panel's fixed kinds, the only tabs it names by a word, are its own and close only by hand.
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
  // A strip's tab is viewed only while the task's page is on screen, nothing standing over it.
  const taskOnScreen =
    stateShown && page === TASKS_PAGE.DOCUMENT && !overPlan && !historyRoute.open;
  const pinnedHere = (tab: StripTab) => {
    const pin = stripTabPin(tab);
    if (pin === TAB_PIN.ACCOUNT)
      return taskAgentPins.some((each) => sameTab(agentTab(each.agentId), tab));
    return (
      pin === TAB_PIN.SIDEBAR &&
      viewed.activeTaskId !== undefined &&
      sidePanel.pins.some(
        (each) => "task" in each && each.task === viewed.activeTaskId && sameTab(each.tab, tab),
      )
    );
  };
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
              !stripTabClosesIdle(tab) ||
              pinnedHere(tab) ||
              (!isOverviewTab(tab) &&
                tab.kind === STRIP_TAB_KIND.AGENT &&
                (awakeAgents.includes(tab.agent) || input.unseenAgents.includes(tab.agent))),
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
            keeps: (tab) => !stripTabClosesIdle(tab) || pinnedHere(tab),
          },
    awake: awakeAgents,
    onWake: mainTabs.onWake,
  });
  // A closed tab opens again where it stood, in its strip at its place and
  // showing what it showed, so a version history or the window's Inbox over
  // the task gives way, and a side panel filling the window over its column.
  // One the task no longer draws, read only once a reopen opened its task, opens nothing.
  const reopenHere = (closed: ClosedTab) => {
    if (!drawsAgain(closed)) return;
    standTaskPlace(closed.task);
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
  // else the kind last closed on it, kept across launches, else none, the
  // toggle dropping what the "+" offers (`useSidePanel`'s `onToggle`). An
  // agent's page, and the Inbox beside an item, have no kind to fall back on,
  // so their toggle drops the same.
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
    // Note that the description's and the Inbox's kinds of old stand nowhere in the panel now, nor a kind whose experiment is off, so they are passed over.
    const closedKind = sidePanel.closedTabs.findLast((tab) => DRAWN_KINDS.includes(tab));
    if (closedKind === undefined) sidePanel.onToggle();
    else sidePanel.onChoose(closedKind);
  };

  // The tab rests on no task, so only an open task steps back,
  // and a panel filling the window over it is the nearer layer.
  const back = useCallback((): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leaveTask();
    return true;
  }, [leaveTask, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  // Note that the tab is handed back steady, so a part that holds while its share of the tab does (`memo`) holds for every draw that moved nothing it reads.
  // Note that the start's page gives way for good to any place the developer went since, by any door, while it is out;
  // the start's own move there, counted once the window is drawn there, and the host's binding of its task are no such place.
  const starting =
    startingTask !== undefined && arrivals() <= startingTask.arrivals ? startingTask : undefined;

  return useSteadyDoors({
    page,
    starting,
    shown,
    signedIn,
    // Note that a fixture's invented tasks are nobody's, but those of a profile that signs in its own reader.
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
    // A failed read is taken as stale, so the refresh reads the workspaces again at once.
    onRetryWorkspaces: () => refreshTasks(),
    workspace: listedWorkspace,
    onChooseWorkspace: guard(switchWorkspace),
    newWorkspace: {
      open: signedIn && founding !== undefined && founding.accountId === input.accountId,
      // Note that the cards take the window in the page's place, so a page holding unsaved work asks first, as leaving it does.
      onOpen: guard(() => setFounding({ accountId: input.accountId })),
      onClose: () => setFounding(undefined),
    },
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
      leaveTask();
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
      // The history takes the window from whatever stood, so a page holding unsaved work asks first.
      onOpen: guard((taskId: string, save?: number) => openHistory(taskId, { save })),
      onPreload: (taskId) => {
        const address = historyAddressOf(taskId, undefined);
        if (address !== undefined) historyRoute.onPreload(address.workspace, address.task);
      },
      onClose: historyRoute.onClose,
    },
    // Note that the pin's own task opened by its row is the task the
    // sidebar marks again rather than the pin; another task's lets the pin
    // go only once it opens. A task opened from a list lands in the
    // conversation, on its agent rather than on whatever tab it last showed,
    // a narrow room's side panel shut over it; a link names its own place
    // (`openLink`), and a task arrived on by the history is asked for as it arrives (`onArriveTask`), the history standing
    // the panes its step held.
    onSelect: guard(selectListed),
    onResume: guard(resumeListed),
    onRestoreTask: guard((taskId: string) => {
      setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
      select(taskId);
    }),
    onStandTask: () => {
      if (boundFor !== undefined) standTaskPlace(boundFor);
    },
    taskView: { taskId: taskRouted },
    // Note that the move that arrived was let past the leave ask already, so the ask is not asked again.
    onArriveTask: (taskId: string) => {
      if (boundNow(taskId)) return;
      setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
      select(taskId);
    },
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
    onThreadsShown: setThreadsShown,
    // The window's Inbox stands over the task's place, so a version history there gives way.
    inboxView: {
      open: inboxView !== undefined,
      chosen: inboxChosen,
      // Note that it opens on nothing chosen, so one column shows the list and two an empty pane beside it (`inbox-columns.ts`).
      // It leaves any task it was narrowed to, so the Inbox lists every item.
      onOpen: guard(() => standInbox(inboxIn(listedWorkspace?.id, undefined), undefined)),
      onClose: guard(input.inboxView.onClose),
      onChoose: (chosen) => input.inboxView.onChoose(chosen),
      onOpenItem: guard((chosen: InboxChoice) => {
        // Note that the Inbox standing keeps its narrowing for an item of the task it is narrowed to, as a row's choice does.
        const narrowed = inboxView === undefined ? undefined : inboxView.narrowed;
        standInbox(inboxIn(listedWorkspace?.id, narrowed), chosen);
      }),
      onClear: input.inboxView.onClear,
      narrowed: inboxView?.narrowed,
      onWiden: input.inboxView.onWiden,
      single: inboxView !== undefined && inboxSingle,
      onSingle: setInboxSingle,
      pages: inboxPages,
      onTaskAgents: inboxTaskAgents.onRead,
    },
    // An agent's page stands over the task's place as the Inbox does, so a version history there gives way.
    agentView: {
      agentId: agentView?.agentId,
      pages: agentPages,
      onOpen: guard((agentId: string) => openAgentPage(agentId)),
      onClose: guard(input.agentView.onClose),
    },
    // A person's page is the router's, which draws it in the plan's place (`workspace-routes.ts`); a version history there gives way.
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
    // The Admin place is the router's, which draws it in the task's place (`admin-route.ts`).
    adminView: { ...input.adminView, onOpen: guard(input.adminView.onOpen) },
    // The Automations pages are the router's, which draw them in the plan's place (`automations-route.ts`); a version history there gives way.
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
    // The Board is the router's, which draws it in the plan's place (`workspace-routes.ts`).
    boardView: {
      open: input.boardView.open,
      onOpen: guard(() => openBoard(listedWorkspace)),
      onClose: guard(input.boardView.onClose),
      onPreload: () => {
        if (listedWorkspace !== undefined) input.boardView.onPreload(stepOf(listedWorkspace));
      },
    },
    onShowFile: showFile,
    // A version's Open lands where its writer wrote it: an agent's tab.
    onShowSource: guard(showSource),
    // A task named by an Inbox item or a call's row opens on its agents.
    onShowTask: guard(showTaskAgents),
    // Each ask is its own, so the same section asked twice scrolls twice.
    onShowMention: guard(showMention),
    onOpenLink: guard((link: ReadLink) => openLink(link)),
    messageReveal,
    // Only the ask answered is let go; a newer one stands until its agent's tab answers it.
    onMessageRevealed: (ask) => setMessageReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealMessage: revealMessage,
    threadReveal,
    // Only the ask taken is let go; a newer one stands until its tab takes it.
    onThreadRevealed: (ask) => setThreadReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealThread: revealThread,
    sectionReveal,
    commentReveal,
    // Only the ask taken is let go; a newer one stands until its own task takes it.
    onCommentRevealed: (ask) => setCommentReveal((last) => (last?.ask === ask ? undefined : last)),
    // Only the ask shown is let go; a newer one stands until its own task shows it.
    onSectionRevealed: (ask) =>
      setSectionReveal((last) => (last?.reveal.ask === ask ? undefined : last)),
    onShowInbox: guard(
      ({ taskId, itemId }: { readonly taskId: string; readonly itemId?: string }) => {
        const chosen = itemId === undefined ? undefined : { taskId, itemId, opened: true as const };
        const home = viewed.tasks.find((task) => task.id === taskId)?.workspaceId;
        standInbox(inboxIn(home ?? listedWorkspace?.id, taskId), chosen);
      },
    ),
    // A pinned tab is in one of the task's columns, so a version history over it gives way as well.
    onOpenPinnedTab: guard((pin: SidebarPin) => {
      const { tab } = pin;
      setChosen({ pin, over: openTaskId });
      // A tab pinned on an agent's own page opens that page, its panel on the tab.
      if ("agent" in pin) {
        openAgentPage(pin.agent);
        sidePanel.onShow(pin.agent, pin.tab);
        return;
      }
      showTask(pin.task);
      if (typeof tab === "string" || tab.kind !== STRIP_TAB_KIND.AGENT) {
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
    onRetryList: () => refreshTasks(),
    onRetryDocument: retryDescription,
    onNewTask: newTask,
    onNewTaskIn: (repository) => newTaskWith({ repository }),
    onNewRelatedTask: (taskId, kind) => {
      // The open document stands for its task where the list read did not land, as its menu reads it.
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
    onUnbindTask: unbindTask,
    atHome: homeOpen && boundFor === undefined,
    taskPlaceStands: input.place === undefined || input.place.binding === PLACE_BINDING.TASK,
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
