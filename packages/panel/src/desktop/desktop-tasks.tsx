import type { AgentStatus } from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { MentionLines } from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import type {
  TaskBlockRequest,
  TaskCreateRelationKind,
  TaskStanding,
} from "@repo/features/task-wire";
import { readingWords } from "@repo/features/words";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  BackButton,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FailureNote,
  FILL_ELEMENT,
  Fill,
  NOT_FOUND_THING,
  NotFound,
  Skeleton,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
  useHeadingAway,
  useMinute,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { PlanCommentsProvider } from "@repo/ui/plan-comments";
import { pullRequestAgentOf, repositoryPullRequestOf } from "@repo/ui/pull-request-link";
import {
  agentOfTab,
  followedAgent,
  isDraftTab,
  sameTab,
  TAB_WORDS,
} from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION, RENAME_FAILED_NOTE, TASKS_PAGE } from "@repo/ui/tasks-model";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { FIND_PAGE, FindScope, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { HERE } from "../route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { type SentLine, startsOwnAgents } from "../tasks/agent-model.js";
import { AgentCard, agentSubject } from "../tasks/agent-ref.js";
import { StartingAgentTab } from "../tasks/agent-tab.js";
import { AgentTabSkeleton, type ComposerModel } from "../tasks/agent-tab-skeleton.js";
import { startCloudDraft, useCloudBrowserTabs } from "../tasks/cloud-browser-tabs.js";
import { keyedItem, waitingByAgent } from "../tasks/inbox-model.js";
import { PlanBody, type SectionLinks, type TitleRename } from "../tasks/plan-body.js";
import { CommentFocusScope } from "../tasks/plan-comments.js";
import { peopleOf } from "../tasks/pull-request-card.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import { TAB_KIND } from "../tasks/tab-look.js";
import {
  heldTaskMentions,
  TaskMentions,
  type TaskMentionsValue,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { taskLinkPlace, useOfferTaskRename } from "../tasks/task-menu-items.js";
import type { TaskRelationsDoor } from "../tasks/task-relation-menu.js";
import type { TaskRepositoryDoor, TaskStandingDoor } from "../tasks/task-standing.js";
import { TerminalCommands } from "../tasks/terminal-commands.js";
import { placeOfTaskTarget, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { isOverviewTab, MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import { OpenAddressesHere, openPullRequestsHere, useOpenPlace } from "../tasks/use-open-link.js";
import { usePlanComments } from "../tasks/use-plan-comments.js";
import { usePlanEditDoor } from "../tasks/use-plan-editing.js";
import { PULL_REQUEST_VIEW, type SidePanelTab } from "../tasks/use-side-panel.js";
import { useTaskInbox } from "../tasks/use-task-inbox.js";
import type { TaskLooks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type StartingTask, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useExperiment } from "../use-app-state.js";
import type { MenuEntry } from "./action-menu.js";
import { useAgentDraftDoors, useAgentTerminalDoors } from "./agent-actions.js";
import { ArchivedAgents } from "./agent-archive.js";
import { DesktopHome } from "./desktop-home.js";
import {
  AGENTS_SECTION,
  AgentPane,
  DETAILS_WORDS,
  MainTabBars,
  mainTabLabel,
  newAgentStarts,
  phoneAgentStarts,
  TaskTopbar,
} from "./main-tabs.js";
import { PhoneBack, PhoneHead, PlaceMore, phoneBar, phoneFindGroups } from "./phone-head.js";
import { PlanAgents } from "./plan-agents.js";
import { PlanRelations } from "./plan-relations.js";
import {
  COLUMN,
  changesTabOf,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  SidePanelSkeleton,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { useStrandedTaskBanner } from "./stranded-task-banner.js";
import { type DocumentMenu, type ShownTab, useTabViews } from "./strip-tabs.js";
import { tabCard } from "./tab-card.js";
import { TaskActions, type TaskMenuItems } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import {
  HOME_BACK,
  screenBack,
  TASK_PANE,
  TaskHead,
  type TaskHeadBack,
  type TaskPane,
  taskPaneOf,
} from "./task-pane-switcher.js";
import { useStandingDoor } from "./task-row-parts.js";
import {
  type SummaryLayout,
  type SummaryPin,
  SummarySkeleton,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
} from "./task-summary.js";

/**
 * The work column while Tasks is chosen: the open task's column, its
 * toolbar above, and the side panel beside it, the
 * window's full height, while that is open (or over it, while it fills the
 * window); or, with none open, Home (`desktop-home.tsx`).
 * The task list itself is the sidebar's, and so is moving between tasks: the
 * toolbar offers no way out of the open task, only its actions: Start, which
 * hands the task to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. The toolbar is one row, the side panel's bar's height exactly;
 * the task's repository is the sidebar's row's to name, so the toolbar draws
 * the repository chip only while the task has none, and otherwise only the
 * chip's menu, which Change repository opens.
 *
 * A task opens on its agents. Its topbar spans the page, over the column
 * and the side panel: the task's status mark and name, Details, and the
 * task's ⋯ (`main-tabs.tsx`'s `TaskTopbar`). Under it, on one row of the
 * frame, the column's bar holds the agents' tabs, the "+", and the chosen
 * agent's ⋯, and the side panel's its own. Details opens the task's details,
 * its Overview, across the page in place of the column's bar and the side
 * panel, the way back to the agents pinned at its card's top left: its path over its title (its
 * repository, the task it is a child of, and its key), its chips, its
 * relations, its agents, and its plan. A phone heads the task with its own row instead (`TaskHead`).
 *
 * The column's summary stands at its right, under the column's bar, listing what
 * both "+" menus open, with its button last in that bar (`task-summary.tsx`).
 *
 * The column holds tabs as the side panel does (`main-tabs.tsx`): the
 * plan's own first, showing its document, then one per coding agent,
 * showing its transcript and its composer at the document's measure, and
 * the draft agent's. A task with no agent's tab to show shows a new
 * agent's draft (`use-main-tabs.ts`), whose composer starts an agent on
 * what is typed. Start and the ⋯ menu are the task's, not an agent's,
 * so only the plan's own tab draws them, while their chords (Copy plan,
 * Archive, Permanently delete) answer on every tab. The document stays laid out while an agent's tab is shown,
 * so coming back to it finds it where it was left.
 *
 * ⌘T opens the "+" of the column holding the window's focus, ⌘W closes
 * its chosen tab, and ⌘F finds in that tab (`../find-in-tab.tsx`): the side
 * panel's once the pointer or the focus went into it, else this column's,
 * which a panel shut hands them back to.
 *
 * A skill named in a message to a coding agent, in either column, opens
 * its `SKILL.md` in a File tab of the side panel (`../tasks/skill-chip.tsx`).
 *
 * What is wrong with the task itself, whichever tab is read, is said in one
 * line under the toolbar, over every tab of the column, and under the side
 * panel's bar while the panel covers the column (`task-banner.tsx`): a
 * task whose repository belongs to another of the account's workspaces says
 * which, with the press that moves it there (`stranded-task-banner.tsx`).
 */

/** What the task's page says to a reader while the task is read. */
const TASK_LOADING_LABEL = readingWords("the task");

/**
 * The task's page as it and its placeholder stand it: the column, its
 * toolbar over its body, and what stands beside it, the side panel; the
 * column hidden rather than left out while the panel fills the window.
 */
function TaskPage({
  areaRef,
  columnRef,
  panelOpen,
  fullScreen,
  barless = false,
  column,
  children,
}: {
  areaRef?: ((area: HTMLDivElement | null) => void) | undefined;
  columnRef: (column: HTMLElement | null) => void;
  panelOpen: boolean;
  fullScreen: boolean;
  /** Whether the column stands with no bar of its own, its sheet starting under the topbar: the task's details. */
  barless?: boolean;
  column: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      ref={areaRef}
      className="desktop-task relative flex min-h-0 flex-1"
      data-panel-open={String(panelOpen)}
      data-barless={barless ? "true" : undefined}
    >
      <Fill ref={columnRef} className="desktop-task-main" hidden={fullScreen}>
        {column}
      </Fill>
      {children}
    </div>
  );
}

/** The column's body under its toolbar: what the column shows, and the summary beside it. */
function TaskBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="desktop-plan-body relative flex min-h-0 flex-1">{children}</div>;
}

/**
 * The task's page while the task is read, in the shape it lands in and
 * through the frames it lands in: the toolbar empty where it stands, the
 * column standing as an agent's tab does before its transcript lands
 * (`AgentTabSkeleton`), the summary's room where it will stand, and the
 * side panel at its width where it is open. The column's tab draws the very
 * same placeholder until it lands, so a task opens through one placeholder
 * rather than a chain of them, and nothing moves as the page arrives but
 * what fills it.
 */
function TaskPageSkeleton({
  drawing,
  summary,
  onColumn,
  starting,
  head,
}: {
  /** New task's agent start under way, the line its agent opens on and the model it names, which the column draws as the agent's tab will; none while a task is read. */
  starting?: { readonly line: SentLine; readonly model: ComposerModel | undefined } | undefined;
  /** The side panel as it will be drawn, its panel none where it is shut. */
  drawing: SidePanelDrawing;
  /** How the summary will stand, whose room is kept. */
  summary: Pick<SummaryLayout, "mode">;
  /** Hands over the column, which the summary's room is measured on, as the page's own does. */
  onColumn: (column: HTMLElement | null) => void;
  /** A phone's head over the page, as the page will be headed once it lands (`TaskWaitHead`); none elsewhere. */
  head?: React.ReactNode;
}): React.JSX.Element {
  const { panel, ...frame } = drawing;
  return (
    <>
      {head}
      {/* Note that the bars stand empty, never in blocks for the words, tabs, and actions they land with, and a phone, whose page hides them, draws none. */}
      {head === undefined ? <Toolbar measure /> : null}
      <TaskPage
        columnRef={onColumn}
        panelOpen={panel !== undefined}
        fullScreen={panel?.fullScreen === true}
        column={
          <>
            {head === undefined ? (
              <Toolbar start={TOOLBAR_INSET.COLUMN} look={TOOLBAR_LOOK.TABS} measure />
            ) : null}
            <TaskBody>
              <Fill className="desktop-task-column">
                <AgentColumn>
                  {starting === undefined ? (
                    <AgentTabSkeleton label={TASK_LOADING_LABEL} />
                  ) : (
                    <StartingAgentTab line={starting.line} model={starting.model} />
                  )}
                </AgentColumn>
              </Fill>
              <SummarySkeleton mode={summary.mode} />
            </TaskBody>
          </>
        }
      >
        {panel === undefined ? null : <SidePanelSkeleton drawing={frame} panel={panel} />}
      </TaskPage>
    </>
  );
}

/**
 * A phone's head over a task that is not drawn yet, or cannot be: its way
 * back, as the task's own head leads (`TaskHead`), and its title a block
 * while it is read, nothing where it cannot be; no ⋯, since a task not
 * drawn offers no menu.
 */
function TaskWaitHead({
  away,
  reading,
}: {
  away: TaskHeadBack;
  reading: boolean;
}): React.JSX.Element {
  return (
    <PhoneHead
      place="task"
      start={<PhoneBack back={away} />}
      title={reading ? <TaskTitleSkeleton /> : null}
      end={null}
    />
  );
}

/** How wide a phone's head's title stands as a block while the task is read. */
const TASK_TITLE_SKELETON = "50%";

/** The block standing in a phone's head's title while the task is read. */
function TaskTitleSkeleton(): React.JSX.Element {
  return <Skeleton width={TASK_TITLE_SKELETON} />;
}

/** The column showing an agent's tab before its agent lands: the placeholder or the line it starts on. */
function AgentColumn({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="desktop-agent">
      {children}
    </Fill>
  );
}

/**
 * ⌥⌘C on the plan, the toolbar's while a task is drawn: the press itself
 * stands in the ⋯ menu, and what came of it is said in the window's toast.
 * A focused agent's pane or tab offers its transcript's copy over it
 * (`main-tabs.tsx`, `side-panel.tsx`).
 */
function CopyChord({ copy }: { copy: TasksControl["copy"] }): null {
  // While Plans is off there is no plan to copy, so the chord is an agent's alone.
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    useExperiment(EXPERIMENT.DESCRIPTIONS) ? copy.onPress : undefined,
  );
  return null;
}

/** ⌘T's offer while a task is drawn: the "+" of the column holding the window's focus. */
function NewTabChord({ onNewTab }: { onNewTab: () => void }): null {
  useAppCommand(APP_COMMAND.NEW_TAB, onNewTab);
  return null;
}

/** What a phone's header's ⋯ acts on, which names its menu ("Agent actions"), by the screen standing. */
const PHONE_THING = {
  [TASK_PANE.OVERVIEW]: "Task",
  [TASK_PANE.AGENT]: "Agent",
  [TASK_PANE.PANEL]: "Tab",
} as const satisfies Record<TaskPane, string>;

/** What a phone's header's ⋯ calls letting a draft go. */
const DISCARD_DRAFT = "Discard draft";

/** A phone's way to let a draft go, which no strip's close stands for there: its tab closes and its words go, as the strip's close does (`main-tabs.tsx`). */
function discardDraftItem(onSelect: () => void): MenuEntry {
  return { label: DISCARD_DRAFT, icon: <GLYPH.DELETE />, onSelect };
}

/**
 * The open task's region: its column, or the state standing in its place.
 * While the task is read, its strip holds one tab-shaped skeleton where the
 * plan's tab will stand, so the row does not move when the task is drawn,
 * and no name is guessed before the read says it; a task that could not be
 * drawn has no tab at all.
 */
function PlanDocument({
  tasks,
  looks,
  summary,
  room,
  away,
}: {
  tasks: TasksControl;
  looks: TaskLooks;
  summary: SummaryPin;
  room: ShellRoom;
  away: TaskHeadBack;
}): React.JSX.Element {
  const { region } = tasks;
  // The tab a phone's panel shows past the plan, which its header is named by, and the tab its column shows, whose menu the header's ⋯ offers on the agent's screen (`strip-tabs.tsx`'s `ShownTab`).
  const [shownTab, setShownTab] = useState<ShownTab | undefined>(undefined);
  const [shownAgentTab, setShownAgentTab] = useState<ShownTab | undefined>(undefined);
  const phone = room === SHELL_ROOM.NARROW;
  const drawing = useSidePanelDrawing(tasks.sidePanel);
  const views = useTabViews();
  const inboxTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  // The task's agents' cloud browser tabs, which a phone's Show browser goes back to, read only on a phone.
  const agentBrowsers = useCloudBrowserTabs(
    inboxTaskId === undefined ? undefined : { taskId: inboxTaskId },
    phone,
  );
  const inbox = useTaskInbox({
    taskId: inboxTaskId,
    shown: tasks.shown,
    onScreen: inboxTaskId !== undefined && tasks.inboxShown === inboxTaskId,
    waiting: tasks.inbox.some((task) => task.taskId === inboxTaskId),
    readerId: tasks.me,
    agents: tasks.agents,
  });
  // The task's comments are held from its open while it is shown, for its plan's margin and list, so its first ready frame marks them; none are read while Plans is off.
  const plansOn = useExperiment(EXPERIMENT.DESCRIPTIONS);
  const commentsTaskId = tasks.shown && plansOn ? tasks.activeTaskId : undefined;
  const comments = usePlanComments(
    useMemo(
      () => (commentsTaskId === undefined ? undefined : { taskId: commentsTaskId }),
      [commentsTaskId],
    ),
  );
  // A link to a comment thread is let go once the task's comments are read,
  // so nothing opens it again. Note that the plan has taken it by then,
  // beside its words or, resolved, in its list, since a child's effects run
  // before ours.
  const commentAsk = tasks.commentReveal?.planId === inboxTaskId ? tasks.commentReveal : undefined;
  const commentsRead = comments?.read === true;
  const { onCommentRevealed } = tasks;
  useEffect(() => {
    if (commentAsk === undefined || inboxTaskId === undefined || !commentsRead) return;
    onCommentRevealed(commentAsk.ask);
  }, [commentAsk, inboxTaskId, commentsRead, onCommentRevealed]);
  const { onArea: setArea, focus, setFocus } = useColumnFocus();
  const [column, setColumn] = useState<HTMLElement | null>(null);
  // The plan's document in the column, whose heading a phone's row picks up once it scrolls away under the row (`useHeadingAway`).
  // Note that each box is handed afresh as it mounts, and the document's for each task, because the document stands only once the task is read, and the heading watched is that task's.
  const [documentBox, setDocumentBox] = useState<HTMLElement | null>(null);
  const headingTask = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const columnHeld = useMemo(() => ({ current: column }), [column]);
  const documentHeld = useMemo(
    () => ({ current: headingTask === undefined ? null : documentBox }),
    [documentBox, headingTask],
  );
  const planHeading = useHeadingAway(columnHeld, documentHeld);
  // The summary lists the task's agents once they are read, so where the
  // task's row says it has some, the summary's room is kept from the open on
  // and the list landing moves nothing in the column.
  const listedRow = tasks.tasks.find((each) => each.id === tasks.activeTaskId);
  const agentsComing =
    tasks.agents.agents === undefined &&
    !tasks.agents.listFailed &&
    (listedRow?.agents?.total ?? 0) > 0;
  const summaryLayout = useSummaryLayout(
    summary,
    column,
    tasks.sidePanel.fullScreen,
    agentsComing || summaryHolds(tasks, inbox.board),
  );
  const summaryCard = useId();
  // The clock the plan's tab's card counts its update back from.
  const now = useMinute();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const taskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const rename = useInlineRename(taskId, tasks.onRenameTask);
  // The open task's one rename door, which its toolbar's ⋯, its title's ⋯,
  // and ⌘K all ask. On a phone it opens the head's field; wider, it puts the
  // caret in the plan's own title, showing the plan first where the panel
  // hides it. Note that the title is asked once the plan stands, because a
  // title drawn afresh takes only the asks that come after it.
  const [titleAsked, setTitleAsked] = useState(false);
  const [titleAsks, setTitleAsks] = useState(0);
  // The plan is shown while the column is on Overview, with no panel filling the window over it.
  const planShown = isOverviewTab(tasks.mainTabs.tab) && !tasks.sidePanel.fullScreen;
  const { onChoose: chooseColumnTab } = tasks.mainTabs;
  useEffect(() => {
    if (!titleAsked || !planShown) return;
    setTitleAsked(false);
    setTitleAsks((count) => count + 1);
  }, [titleAsked, planShown]);
  // Overview shown, a panel filling the window over the column giving way, as a row opening a tab of the column does.
  const showOverview = useSteadyDoor(() => {
    if (tasks.sidePanel.fullScreen) tasks.sidePanel.onToggleFullScreen();
    chooseColumnTab(MAIN_TAB.OVERVIEW);
  });
  const beginRename = useSteadyDoor(() => {
    if (room === SHELL_ROOM.NARROW) {
      rename.begin();
      return;
    }
    if (!planShown) showOverview();
    setTitleAsked(true);
  });
  useOfferTaskRename(taskId, beginRename);
  // A terminal shown hands the keys to the side panel, where it stands; an
  // agent's tab's Show terminal always opens that agent's own.
  const showSide = () => setFocus(COLUMN.SIDE);
  // Show terminal opens an agent's terminal as on every surface that draws it (`agent-actions.tsx`).
  const terminalDoors = useAgentTerminalDoors(tasks.sidePanel, showSide);
  // A refusal is said beside the chip, under the task it was about and no
  // other. Note that it is held above the states with no document, because
  // a task opened from the list is drawn reading before its read lands, and
  // a hook that only the ready page reached would be one more hook than
  // the reading page had, which React refuses by unmounting the window.
  const [refusal, setRefusal] = useState<{ taskId: string; note: string } | undefined>(undefined);
  // The task as the list names it, its owner, agents, and pull requests
  // among it, which its card and its banner read. Held above the states
  // with no document for the same reason.
  const opened = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const listedOpen =
    opened === undefined
      ? undefined
      : (tasks.tasks.find((each) => each.id === opened.id) ?? opened);
  const stranded = useStrandedTaskBanner(tasks, listedOpen);
  // The workspace's agents an `@` offers after the task's own, named by the tasks the window lists.
  const readMentionAgents = useMentionAgentsReader(
    opened?.workspaceId,
    tasks.tasks,
    tasks.agents.models,
  );
  const openMention = tasks.onShowMention;
  const revealed = tasks.sectionReveal;
  // A file a mention names opens in its tab, its lines at the commit the mention pins them to.
  const openMentionedFile = (path: string, lines: MentionLines | undefined) =>
    lines === undefined
      ? tasks.sidePanel.onPreviewFile({ path })
      : tasks.sidePanel.onPreviewFile(
          { path, startLine: lines.startLine, endLine: lines.endLine },
          lines.commit,
        );
  const { mainTabs, sidePanel, agents } = tasks;
  const { tab } = mainTabs;
  const home =
    opened === undefined
      ? undefined
      : tasks.workspaces.find((each) => each.id === opened.workspaceId);
  // The slug the task's links are written under, as its ⋯ menu's Copy link to task writes it.
  const workspace =
    opened === undefined ? undefined : taskLinkPlace(tasks.workspaces, opened).workspace;
  // A row that opens a tab of this column, as a coding agent's start in an
  // agent's tab opens the agent's, first has a panel filling the window over it
  // give way, and hands the keys to this column, so ⌘W closes the tab it opened.
  const openColumnTab = (opened: MainTab) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose(opened);
    setFocus(COLUMN.MAIN);
  };
  // An agent's tab is in this column, but an archived agent's, never drawn, opens on its own page
  // instead, where it is read and brought back, a panel filling the window over it giving way and
  // the keys handed to the page, as a tab of this column opens.
  const openAgentColumn = (agent: string) => {
    if (agents.archived?.some((each) => each.id === agent) !== true) {
      openColumnTab({ agent });
      return;
    }
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    tasks.agentView.onOpen(agent);
    setFocus(COLUMN.MAIN);
  };
  // The plan's document stands in the column's Overview, so a row that opens it chooses that tab.
  const openOverview = () => openColumnTab(MAIN_TAB.OVERVIEW);
  // The task's details go back to the agent's tab they were opened over, or the agents' last, or
  // a new agent's draft where no agent's tab stands, as a task with none opens on.
  const leaveDetails = () => {
    const { returnTab } = mainTabs;
    if (returnTab !== undefined) {
      openColumnTab(returnTab);
      return;
    }
    const [start] = newAgentStarts(mainTabs, agents);
    if (start !== undefined && start.disabled !== true) start.onSelect();
  };
  // Details opens the task's details in the column's place, and pressed again goes back to the agents.
  const toggleDetails = () =>
    tab !== undefined && isOverviewTab(tab) ? leaveDetails() : openOverview();
  // The way back to the agents stands pinned in the details' own card; a phone's head is its way back.
  const leaveDetailsDoor = useSteadyDoor(leaveDetails);
  const detailsLead = useMemo(
    () =>
      phone ? undefined : (
        <BackButton label={AGENTS_SECTION} place={DETAILS_WORDS.PLACE} onBack={leaveDetailsDoor} />
      ),
    [phone, leaveDetailsDoor],
  );
  // The panel opened over the task's details, as its toggle opens it, goes back to the agents,
  // beside which the panel stands, since the details take the panel's room too.
  const detailsOver = isOverviewTab(tab) && !phone;
  const panelWasOpen = useRef(sidePanel.open);
  useEffect(() => {
    const opened = sidePanel.open && !panelWasOpen.current;
    panelWasOpen.current = sidePanel.open;
    if (opened && detailsOver) leaveDetailsDoor();
  }, [sidePanel.open, detailsOver, leaveDetailsDoor]);
  // A row that opens the comments, which stand in the side panel, shows the
  // panel on them and hands it the keys, as a terminal shown does.
  const openPanelTab = (opened: SidePanelTab) => {
    sidePanel.onChoose(opened);
    showSide();
  };
  // A call's row in a transcript opens what the call is about where the
  // window already draws it: an agent or the plan in this column, the
  // thread a call names in the window's Inbox as it stands, where the task's
  // items hold it, posted by the agent whose row it was (`from`), else the
  // window's Inbox narrowed to the task,
  // another task as a link to it opens (`route.ts`), the rest in the side panel.
  const openPlace = useOpenPlace();
  const openTarget = (target: ToolTarget, from?: string) => {
    switch (target.kind) {
      case TOOL_TARGET.AGENT:
        return openAgentColumn(target.agent);
      case TOOL_TARGET.PLAN:
        return openOverview();
      case TOOL_TARGET.INBOX: {
        if (taskId === undefined) return;
        const itemId =
          target.item ??
          (target.key === undefined ? undefined : keyedItem(inbox.board, target.key, from)?.id);
        return openPlace?.(
          itemId === undefined
            ? { kind: LINK_PLACE.INBOX, planId: taskId }
            : { kind: LINK_PLACE.INBOX_ITEM, planId: taskId, itemId },
        );
      }
      case TOOL_TARGET.PAGE:
        return sidePanel.onPreview({ page: target.page });
      case TOOL_TARGET.TASK:
        // A call that named this very task opens its plan in the column, as one on its own plan does.
        if (target.agent === undefined && target.task === taskId) return openOverview();
        return openPlace?.(placeOfTaskTarget(target));
    }
  };
  // A delegation's row in an agent's transcript opens its worker in the side
  // panel, where every subagent stands; where the worker stands seeds its glyph.
  const openDelegation = (agent: string, callId: string, task: string, status: AgentStatus) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onPreview({ subagent: callId, delegation: { agent, task } });
  };
  // An agent's pull request chip opens its pull request in the side panel, beside its tab, in
  // the one Pull request tab the "+" offers for that pull request (`showPullRequest`), on its conversation.
  const openPullRequest = (agentId: string, number?: number) =>
    showPullRequest(sidePanel, agents, agentId, PULL_REQUEST_VIEW.CONVERSATION, number);
  // An agent a mention names wears its tab's tile and hangs its tab's card, read as its tab reads them.
  // An agent the task lists not has no tab here, so a link to it, which names no task, wears what the window reads of it.
  const agentLook = (agentId: string) => {
    const subject = agentSubject(agents, agentId, views.held, false);
    if (subject.agent === undefined) return undefined;
    return { actor: subject.tile, card: <AgentCard subject={subject} models={agents.models} /> };
  };
  // A pull request one of the task's agents opened hangs its Pull request tab's card wherever a link names it.
  const pullRequestCard = (url: string) => {
    const owned = [...agents.pullRequests].map(([agentId, each]) => ({ agentId, url: each.url }));
    // A page under an agent's pull request, as its files, is still that pull request, as its press says.
    const number = repositoryPullRequestOf(url, opened?.repository);
    const owner =
      pullRequestAgentOf(url, owned) ??
      (number === undefined
        ? undefined
        : owned.find((each) => repositoryPullRequestOf(each.url, opened?.repository) === number)
            ?.agentId);
    if (owner === undefined) return undefined;
    const agentId = changesTabOf(agents, owner, tasks.sidePanel.changes).changes;
    const pullRequest = agents.pullRequests.get(agentId);
    if (pullRequest === undefined) return undefined;
    const card = tabCard({
      kind: TAB_KIND.CHANGES,
      subject: agentSubject(agents, agentId, views.held, false),
      models: agents.models,
      pullRequest,
      people: peopleOf(agents.changesPeople.get(agentId), pullRequest),
      onOpenAgent: () => openAgentColumn(agentId),
    });
    return card ?? undefined;
  };
  // Note that what the transcripts and the plan are handed, and what they
  // read from around them, is held across this page's draws over the same
  // task, because each holds while that does (`AgentPane`, `PlanBody`), and
  // the page is drawn again as its column's focus, its side
  // panel's width, and the minute's clock move; only the cards a
  // transcript's rows hang move with the minute. Each door stands across
  // draws and calls the newest closure (`useSteadyDoor`).
  // Note that the column's pane draws its tab's agent alone, so a row it opens is that agent's.
  const openTargetDoor = useSteadyDoor((target: ToolTarget) => openTarget(target, agentOfTab(tab)));
  const openDelegationDoor = useSteadyDoor(openDelegation);
  const openPullRequestDoor = useSteadyDoor(openPullRequest);
  // A page of another task, a subtask's among them, opens beside this one, read on its own task, so the reader stays here.
  const openPageBeside = useSteadyDoor((page: string, place: PagePlace) =>
    sidePanel.onPreview({ page }, place),
  );
  const openAgent = useSteadyDoor(openAgentColumn);
  const openAgentTab = useSteadyDoor(openColumnTab);
  const agentLookDoor = useSteadyDoor(agentLook);
  const pullRequestCardDoor = useSteadyDoor(pullRequestCard);
  const openMentionedFileDoor = useSteadyDoor(openMentionedFile);
  const { onFork: forkDoor, onContinue: continueDoor } = useAgentDraftDoors(
    agents,
    false,
    (draft) => openColumnTab({ draft }),
  );
  const showHistory = useSteadyDoor((save: number | undefined) => {
    if (opened !== undefined) tasks.history.onOpen(opened.id, save);
  });
  const editDoor = usePlanEditDoor(opened?.id, tasks.edit);
  const renameDoor = useSteadyDoor((name: string) => rename.end(name));
  const titleRename = useMemo<TitleRename>(
    () => ({ asks: titleAsks, asked: rename.asked, onBegin: beginRename }),
    [titleAsks, rename.asked, beginRename],
  );
  const draftNameDoor = useSteadyDoor(
    opened === undefined
      ? undefined
      : (name: string | undefined) => tasks.onDraftName(opened.id, name),
  );
  // The chips send a change through the door the rows use, which says so
  // where the service did not keep it, and the chip goes on drawing the
  // task's own value, which is the one that stands.
  const standingDoor = useStandingDoor(tasks);
  const setStanding = useSteadyDoor(
    opened === undefined ? undefined : (standing: TaskStanding) => standingDoor(opened, standing),
  );
  const openedId = opened?.id;
  const openedRepository = opened?.repository ?? null;
  // The threads each agent posted that wait on the developer, which its tab counts and its box's
  // dock opens in the Inbox narrowed to the task, on the next of them.
  const waitingOf = useMemo(() => waitingByAgent(inbox.board.waiting), [inbox.board.waiting]);
  const openWaitingThread = useSteadyDoor((item: InboxItem) => {
    if (openedId !== undefined) tasks.onShowInbox({ taskId: openedId, itemId: item.id });
  });
  const tabAgent = tab === undefined ? undefined : agentOfTab(tab);
  const threads = useMemo(() => {
    const waiting = tabAgent === undefined ? undefined : waitingOf.get(tabAgent);
    return waiting === undefined ? undefined : { waiting, onOpen: openWaitingThread };
  }, [tabAgent, waitingOf, openWaitingThread]);
  const reader = useMemo(() => ({ readerId: tasks.me }), [tasks.me]);
  const editAgents = useMemo(() => ({ control: agents, onOpen: openAgent }), [agents, openAgent]);
  // The task's own menu, as the task's page holds it keyed by the task
  // (`TaskActions`), handed up here for the Plan tab's ⋯ and right-click and
  // a phone's header on its Plan view, each reading the newest items as it
  // draws. Note that the page draws `TaskActions` ahead of the panel, so the
  // items stand here by the time the panel's tabs read them.
  const taskMenuHand = useRef<TaskMenuItems | undefined>(undefined);
  const planMenu = useMemo<DocumentMenu>(
    () => ({
      groups: () => taskMenuHand.current?.groups() ?? [],
      get subject() {
        return taskMenuHand.current?.subject;
      },
      get footer() {
        return taskMenuHand.current?.footer;
      },
    }),
    [],
  );
  // The repository crumb's doors (`task-standing.tsx`): a pick is sent
  // through the task's own door, which answers why the service refused it,
  // said under the path of the task it was about and no other. ⌘K's
  // Change repository asks the crumb to open its menu, each ask counted so
  // the same press opens it again: the ask stands until the crumb answers it
  // (`onAsked`), so a crumb drawn again later does not open on an ask already
  // answered, and the plan is shown first where the panel hides it, since
  // the crumb stands in the plan.
  const chooseRepository = useSteadyDoor((repository: string) => {
    if (opened === undefined) return;
    const { id: taskId } = opened;
    setRefusal(undefined);
    tasks.onSetRepository(taskId, repository).then(
      (note) => setRefusal(note === undefined ? undefined : { taskId, note }),
      () => undefined,
    );
  });
  const repositoryNote =
    refusal !== undefined && refusal.taskId === openedId ? refusal.note : undefined;
  const { repositories, repositoryMenu } = tasks;
  const [answeredRequest, setAnsweredRequest] = useState(0);
  const menuRequest =
    repositoryMenu !== undefined &&
    repositoryMenu.taskId === openedId &&
    repositoryMenu.request > answeredRequest
      ? repositoryMenu.request
      : undefined;
  useEffect(() => {
    if (menuRequest === undefined || planShown) return;
    showOverview();
  }, [menuRequest, planShown, showOverview]);
  // Note that the crumb is handed the ask only once the plan is in sight, so its menu never opens behind a list.
  const openRequest = planShown ? menuRequest : undefined;
  const repositoryDoor = useMemo<TaskRepositoryDoor | undefined>(
    () =>
      openedId === undefined
        ? undefined
        : {
            chooser: repositories,
            onChoose: chooseRepository,
            openRequest,
            onAsked: setAnsweredRequest,
            note: repositoryNote,
          },
    [openedId, repositories, chooseRepository, openRequest, repositoryNote],
  );
  const workspaceName = home?.name ?? "";
  // The task's path and its add menu name and offer the tasks of its own workspace, and a press on the parent's crumb opens it as a list's row would.
  const openedWorkspace = opened?.workspaceId;
  const {
    tasks: everyTask,
    onSelect: selectTask,
    onSetTaskBlock,
    onSetTaskParent,
    onNewRelatedTask,
    relationMenu,
  } = tasks;
  const blockTasks = useMemo(
    () => everyTask.filter((each) => each.workspaceId === openedWorkspace),
    [everyTask, openedWorkspace],
  );
  // A task the head names, a crumb or a related row, opens on its plan, as a list's row does.
  const openTask = useSteadyDoor(selectTask);
  const changeBlock = useSteadyDoor(
    openedId === undefined
      ? undefined
      : (change: TaskBlockRequest) => onSetTaskBlock(openedId, change),
  );
  const setParent = useSteadyDoor(openedId === undefined ? undefined : onSetTaskParent);
  const newRelatedTask = useSteadyDoor(
    openedId === undefined
      ? undefined
      : (kind: TaskCreateRelationKind) => onNewRelatedTask(openedId, kind),
  );
  // The task's menus and ⌘K ask the head to open the add menu, each ask counted and answered as the repository chip's is, once the plan is in sight.
  const [answeredRelation, setAnsweredRelation] = useState(0);
  const relationPending =
    relationMenu !== undefined &&
    relationMenu.taskId === openedId &&
    relationMenu.request > answeredRelation
      ? relationMenu
      : undefined;
  const relationAsk = planShown ? relationPending : undefined;
  useEffect(() => {
    if (relationPending === undefined || planShown) return;
    showOverview();
  }, [relationPending, planShown, showOverview]);
  const relations = useMemo<TaskRelationsDoor>(
    () => ({
      workspaceName,
      tasks: blockTasks,
      onChange: changeBlock,
      onSetParent: setParent,
      onNewTask: newRelatedTask,
      ask: relationAsk,
      onAsked: setAnsweredRelation,
    }),
    [workspaceName, blockTasks, changeBlock, setParent, newRelatedTask, relationAsk],
  );
  // Note that S opens the status chip only while the plan is in sight, never behind an agent's tab or Activity's list.
  const standing = useMemo<TaskStandingDoor>(
    () => ({
      workspaceName,
      onSet: setStanding,
      repository: repositoryDoor,
      tasks: blockTasks,
      onOpenTask: openTask,
      relations,
      inSight: planShown,
    }),
    [workspaceName, setStanding, repositoryDoor, blockTasks, openTask, relations, planShown],
  );
  const reveal = revealed?.taskId === openedId ? revealed?.reveal : undefined;
  const { onSectionRevealed } = tasks;
  const sectionLinks = useMemo<SectionLinks | undefined>(
    () =>
      workspace === undefined
        ? undefined
        : {
            workspace,
            onOpen: openMention,
            onOpenFile: openMentionedFileDoor,
            reveal,
            onRevealed: onSectionRevealed,
            agentOf: agentLookDoor,
            pullRequestOf: pullRequestCardDoor,
          },
    [
      workspace,
      openMention,
      openMentionedFileDoor,
      reveal,
      onSectionRevealed,
      agentLookDoor,
      pullRequestCardDoor,
    ],
  );
  // The task's agents head its plan, a row opening its agent in this column as its tab does.
  const planAgents = useMemo(
    () => (
      <PlanAgents
        agents={agents}
        held={views.held}
        tab={tab}
        // Overview's agents stand open, its list the task's own rather than a fold under the plan's head.
        folded={false}
        waiting={waitingOf}
        onOpenAgent={(agentId) => openAgentTab({ agent: agentId })}
        onOpenPullRequest={openPullRequestDoor}
        // Note that New agent stands at every width, a fresh plan's one next step, as the "+" offers it.
        starts={
          room === SHELL_ROOM.NARROW
            ? phoneAgentStarts(mainTabs, agents)
            : newAgentStarts(mainTabs, agents)
        }
        phone={
          room === SHELL_ROOM.NARROW
            ? {
                archived: (
                  <ArchivedAgents
                    agents={agents}
                    shown={tasks.shown}
                    onOpen={tasks.agentView.onOpen}
                  />
                ),
                onOpenInbox: () => {
                  if (openedId !== undefined) tasks.onShowInbox({ taskId: openedId });
                },
              }
            : undefined
        }
      />
    ),
    [
      openedId,
      agents,
      views.held,
      tab,
      openAgentTab,
      openPullRequestDoor,
      room,
      mainTabs,
      tasks.shown,
      waitingOf,
      tasks.onShowInbox,
    ],
  );
  // The task's sub-tasks and relations stand over its agents, the head keyed once by the task,
  // so another task's groups start folded rather than as this one's were left. Note that the
  // key is the head's alone, because two siblings under one key leave the old task's drawn.
  const planHead = useMemo(
    () => (
      <Fragment key={openedId}>
        {opened === undefined ? null : (
          <PlanRelations task={opened} tasks={tasks} door={relations} onOpenTask={openTask} />
        )}
        {planAgents}
      </Fragment>
    ),
    [openedId, opened, tasks, relations, openTask, planAgents],
  );
  // A row in a transcript that opens a tab hangs that tab's card, read as
  // the tab reads it, so an agent, a subagent, or a file is previewed alike wherever named.
  const listedCard = listedOpen ?? opened;
  const sideTab = sidePanel.tab;
  const cards = useMemo(
    () =>
      listedCard === undefined
        ? undefined
        : taskCards({
            agents,
            held: views.held,
            chosen: (chosen) =>
              sameTab(chosen, tab) || (sideTab !== undefined && sameTab(chosen, sideTab)),
            pages: { taskId: listedCard.id },
            task: {
              name: listedCard.name,
              status: listedCard.status,
              card: taskCardOf(tasks, listedCard, now),
            },
          }),
    [agents, views.held, tab, sideTab, listedCard, tasks, now],
  );
  // A link anywhere on the task to a pull request one of its agents opened, a chip in the plan,
  // a transcript, or an Inbox item, opens that same tab rather than GitHub; a link to any other
  // pull request of the task's repository opens in a Pull request tab by its number, and one to
  // another task's page opens beside the task.
  const openHere = useMemo(
    () =>
      openPullRequestsHere(
        {
          kind: HERE.TASK,
          taskId: openedId ?? "",
          repository: openedRepository,
          pullRequests: agents.pullRequests,
          agentIds: agents.agentIds,
          heldIds: agents.heldIds,
        },
        openPullRequestDoor,
        openPageBeside,
      ),
    [agents, openPullRequestDoor, openPageBeside, openedRepository, openedId],
  );
  // What every place on the page that picks or draws a mention reads (`task-mentions.tsx`).
  const { pages } = tasks;
  const mentions = useMemo<TaskMentionsValue | undefined>(() => {
    if (opened === undefined || workspace === undefined) return undefined;
    return heldTaskMentions(
      opened,
      workspace,
      opened.document.body,
      { pages, agents, readAgents: readMentionAgents },
      {
        onOpenTask: openMention,
        onOpenFile: openMentionedFileDoor,
        agentOf: agentLookDoor,
        pullRequestOf: pullRequestCardDoor,
      },
    );
  }, [
    opened,
    workspace,
    pages,
    agents,
    readMentionAgents,
    openMention,
    openMentionedFileDoor,
    agentLookDoor,
    pullRequestCardDoor,
  ]);
  if (region.kind === DOCUMENT_REGION.READING) {
    return (
      <TaskPageSkeleton
        drawing={drawing}
        summary={summaryLayout}
        onColumn={setColumn}
        head={phone ? <TaskWaitHead away={away} reading /> : undefined}
      />
    );
  }
  if (
    region.kind !== DOCUMENT_REGION.READY ||
    workspace === undefined ||
    cards === undefined ||
    mentions === undefined ||
    sectionLinks === undefined
  ) {
    const line =
      region.kind === DOCUMENT_REGION.FAILED
        ? "The task could not be read."
        : "Choose a task, or start a new one.";
    // A plan that cannot be drawn offers no menu, so its way out is said here.
    const close = { label: "Close task", onClick: tasks.onLeaveTask };
    // A plan the service would not hand the reader is not there for them, whether it was deleted or never theirs.
    if (region.kind === DOCUMENT_REGION.MISSING) {
      return (
        <NotFound
          thing={NOT_FOUND_THING.TASK}
          bar={
            phone ? phoneBar({ place: "task", start: <PhoneBack back={away} />, end: null }) : {}
          }
          action={close}
        />
      );
    }
    return (
      <>
        {phone ? <TaskWaitHead away={away} reading={false} /> : <Toolbar />}
        <Fill as={FILL_ELEMENT.SECTION} className="desktop-empty-region">
          {region.kind === DOCUMENT_REGION.FAILED ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.TASK_DOCUMENT_READ)}
              onRetry={tasks.onRetryDocument}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
              exit={close}
            >
              {line}
            </ErrorState>
          ) : (
            <EmptyState>{line}</EmptyState>
          )}
        </Fill>
      </>
    );
  }
  const { task } = region;
  const listed = listedOpen ?? task;
  // The column has a tab on its way: the agents are still read, or, read, a draft opens in the task's
  // empty column, which a pilot task's never does (`startsOwnAgents`).
  const columnComing =
    agents.agents === undefined ? !agents.listFailed : startsOwnAgents(agents.mode);
  // The panel holds the keys while the focus went into it last, or while it
  // fills the window over this column; shut, it hands them back.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The agent a terminal command means from where the developer is: the one
  // whose own tab, Changes tab, or Terminal tab holds the keys, if any.
  const terminalHere = agentOfTab(
    sideFocused && sidePanel.tab !== undefined ? sidePanel.tab : mainTabs.tab,
  );
  // The plan's document stands in the column's Overview and the task's Inbox
  // in the side panel, each drawn here, where what they read is held.
  // A summary row that opens a tab of the side panel hands the panel the
  // keys, as a transcript's row does (`openPanelTab`), so ⌘W closes what it opened.
  const summaryTasks: TasksControl = {
    ...tasks,
    sidePanel: {
      ...sidePanel,
      onChoose: openPanelTab,
      onOpenFile: (ref, commit) => {
        sidePanel.onOpenFile(ref, commit);
        showSide();
      },
    },
  };
  // Note that the document stays laid out while another tab of the column is
  // shown, so coming back to Overview finds it where it was left.
  const overviewShown = isOverviewTab(tab);
  // Wider than a phone, the task's details take the whole page, its column and its side panel alike.
  const detailsWide = overviewShown && !phone;
  const documentBody = (
    <Fill
      ref={setDocumentBox}
      as={FILL_ELEMENT.SECTION}
      className="desktop-document @container/plan-document [&[hidden]]:hidden"
      role="tabpanel"
      aria-label={task.name}
      hidden={!overviewShown}
    >
      {/* The way back to the agents stays pinned at the card's top left, over the details as they scroll. */}
      {detailsWide ? <div className="task-details-back">{detailsLead}</div> : null}
      <PlanBody
        task={task}
        reader={reader}
        agents={editAgents}
        onShowHistory={showHistory}
        onEdit={editDoor}
        // The title renames as the chip's field does, so a refusal is said beside it.
        onRename={renameDoor}
        onDraftName={draftNameDoor}
        rename={titleRename}
        looks={looks}
        sectionLinks={sectionLinks}
        standing={standing}
        head={planHead}
        titleActions={!phone}
        shown={overviewShown}
      />
    </Fill>
  );
  const pane = taskPaneOf({ open: sidePanel.open, column: tab });
  // A phone's agent's ⋯ shows its cloud browser: the tab it opened last, or a new one, as the panel's
  // "+" offers either, which a phone draws nowhere.
  const openBrowser = (agentId: string) => {
    const newest = (agentBrowsers ?? [])
      .filter((each) => each.agentId === agentId)
      .toSorted((one, other) => other.createdAt - one.createdAt)[0];
    openPanelTab({
      cloudBrowser: newest?.id ?? startCloudDraft({ taskId: task.id }, agentId).id,
    });
  };
  // ⌘T on a phone starts New agent at once, since no "+" stands in sight to drop its menu.
  const newAgentOnPhone = () => {
    const [start] = phoneAgentStarts(mainTabs, agents);
    if (start === undefined || start.disabled === true) return;
    if (sidePanel.open) sidePanel.onToggle();
    start.onSelect();
  };
  // The plan's screen by the task's name, which a phone's Back says from an agent's screen, so the
  // way to the task reads as the task itself; Overview where the task is not read or has no name.
  const planLabel = opened?.name.trim() || TAB_WORDS.OVERVIEW;
  // What the column shows, by name: the agent's or the draft's screen, and where a tab of the panel goes back to.
  const columnLabel =
    tab === undefined || isOverviewTab(tab) ? planLabel : mainTabLabel(tab, agents);
  const draftShown =
    pane === TASK_PANE.AGENT && tab !== undefined && isDraftTab(tab) ? tab : undefined;
  // Back leaves the task on Overview, and goes back a screen anywhere else: the panel shuts over
  // the column, and the column goes back to Overview, which lets an empty draft go (`use-main-tabs.ts`).
  const back =
    pane === TASK_PANE.OVERVIEW
      ? away
      : pane === TASK_PANE.PANEL
        ? screenBack(columnLabel ?? planLabel, sidePanel.onToggle)
        : screenBack(planLabel, () => mainTabs.onChoose(MAIN_TAB.OVERVIEW));
  // What the header's ⋯ offers follows what is on screen: the task's own menu on Overview, the
  // agent's on its screen, Discard draft on a draft's, and the tab's on one of the panel's, each
  // agent's item left unnamed, since the header names the agent.
  const shownGroups = (opener: HTMLElement): readonly (readonly MenuEntry[])[] =>
    pane === TASK_PANE.OVERVIEW
      ? planMenu.groups()
      : draftShown !== undefined
        ? [
            [
              discardDraftItem(() => {
                mainTabs.onClose(draftShown);
                agents.onDiscardDraft(draftShown.draft);
              }),
            ],
          ]
        : ((pane === TASK_PANE.AGENT ? shownAgentTab : shownTab)?.groups(opener) ?? []);
  const head = phone ? (
    <TaskHead
      back={back}
      // Note that the task's Rename opens the task's name in the title's place on any screen, since the screen hides the plan's own title.
      // Note that Overview's plan names the task in its own heading, so the row names it only once that heading scrolls away.
      title={
        rename.editing
          ? (rename.asked ?? task.name)
          : pane === TASK_PANE.PANEL
            ? shownTab?.label
            : pane === TASK_PANE.AGENT
              ? columnLabel
              : undefined
      }
      pickUp={{ name: planHeading.name, shown: planHeading.away }}
      rename={{
        editing: rename.editing,
        onEnd: (end) => {
          void rename.end(end.value);
        },
      }}
      actions={
        <PlaceMore
          thing={PHONE_THING[pane]}
          shown={tasks.shown}
          groups={(opener) => [...phoneFindGroups(), ...shownGroups(opener)]}
          ends={() => (pane === TASK_PANE.OVERVIEW ? planMenu : undefined)}
        />
      }
    />
  ) : null;
  return (
    <LinkWorkspaceProvider value={workspace}>
      <PlanCommentsProvider value={comments}>
        <CommentFocusScope
          planId={inboxTaskId}
          reveal={tasks.commentReveal?.planId === inboxTaskId ? tasks.commentReveal : undefined}
        >
          <MemberDirectory workspace={home} readerId={tasks.me}>
            <AutomationDirectory
              workspace={home}
              wanted={[...(agents.agents ?? []), ...(agents.archived ?? [])].some(
                (each) => each.automationId !== undefined,
              )}
              onOpen={openAutomation}
            >
              <TaskMentions value={mentions}>
                <OpenAddressesHere value={openHere}>
                  {/* The task's menu, its shortcuts, and the questions its items ask, keyed by the task so none outlives it; drawn ahead of the panel, which reads the items. */}
                  <TaskActions
                    key={task.id}
                    tasks={tasks}
                    task={task}
                    onRename={beginRename}
                    hand={taskMenuHand}
                  />
                  {head}
                  {/* On a phone no bar stands, its head naming the task instead, the bars drawn hidden so the chords they hold still answer. */}
                  <div className={phone ? "task-topbar" : "task-topbar contents"} hidden={phone}>
                    <TaskTopbar
                      task={listed}
                      // A phone's head offers the task's menu and its details itself (`TaskHead`).
                      details={
                        phone ? undefined : { shown: overviewShown, onToggle: toggleDetails }
                      }
                      planMenu={phone ? undefined : planMenu}
                      shown={tasks.shown}
                      actions={
                        <>
                          {rename.refused ? (
                            <FailureNote
                              failure={failureShown({
                                surface: FAILURE_SURFACE.TASK_RENAME,
                                cause: FAILURE_CONDITION.REFUSED,
                                refused: true,
                              })}
                            >
                              {RENAME_FAILED_NOTE}
                            </FailureNote>
                          ) : null}
                          <CopyChord copy={tasks.copy} />
                          {terminalDoors.terminals ? (
                            <TerminalCommands
                              here={terminalHere}
                              agents={agents}
                              sidePanel={sidePanel}
                              onShown={showSide}
                            />
                          ) : null}
                          {/* A version drawn in the plan's place is the version's page, which opens no tab. */}
                          {tasks.history.viewing === undefined ? (
                            <NewTabChord
                              onNewTab={
                                phone
                                  ? newAgentOnPhone
                                  : sideFocused
                                    ? sidePanel.onNewTab
                                    : mainTabs.onNewTab
                              }
                            />
                          ) : null}
                        </>
                      }
                    />
                  </div>
                  {/* Note that the column is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
                  <TaskPage
                    areaRef={setArea}
                    columnRef={setColumn}
                    panelOpen={sidePanel.open && !detailsWide}
                    fullScreen={sidePanel.fullScreen}
                    barless={detailsWide}
                    column={
                      <>
                        {/* On a phone no strip stands, its details listing the agents instead, the strip drawn hidden so its shown agent's tab still hands the header's ⋯ its menu (`onShown`); wider, the task's details stand in place of the strip and the panel alike. */}
                        <div
                          className={phone || detailsWide ? undefined : "contents"}
                          hidden={phone || detailsWide}
                        >
                          <MainTabBars
                            task={listed}
                            main={mainTabs}
                            agents={agents}
                            unread={tasks.unreadTabs}
                            views={views}
                            pins={{
                              pinned: (agentId) =>
                                tasks.taskAgentPins.some((pin) => pin.agentId === agentId),
                              onPin: tasks.onPinAgent,
                            }}
                            keys={!phone && tasks.shown && !sideFocused}
                            shown={tasks.shown}
                            onOpenTerminal={terminalDoors.onOpenTerminal}
                            onOpenBrowser={phone ? openBrowser : undefined}
                            onShown={phone ? setShownAgentTab : undefined}
                            waiting={waitingOf}
                          />
                        </div>
                        {/* The plan's banner is the whole plan's, so it stands over every
            tab of the column, and over the panel's while that fills the window. */}
                        {sidePanel.fullScreen ? null : stranded.banner}
                        {/* The summary stands beside what the column shows, under the
            toolbar, which spans the column. */}
                        <TaskBody>
                          <FindScope
                            className="desktop-task-column"
                            active={tasks.shown && !sideFocused}
                            subject={{ task: task.id, tab: tab ?? MAIN_TAB.OVERVIEW }}
                          >
                            {documentBody}
                            {tab === undefined || isOverviewTab(tab) ? (
                              // While the agents are read, or a draft opens on a task with none, the
                              // column stands as the tab it will show does before it lands.
                              tab === undefined && columnComing ? (
                                <AgentColumn>
                                  <AgentTabSkeleton />
                                </AgentColumn>
                              ) : null
                            ) : (
                              <AgentPane
                                label={mainTabLabel(tab, agents)}
                                tabbed
                                tab={tab}
                                agents={agents}
                                shown={tasks.shown && !sidePanel.fullScreen}
                                views={views}
                                onOpenDelegation={openDelegationDoor}
                                onOpenPullRequest={openPullRequestDoor}
                                onOpenTarget={openTargetDoor}
                                cards={cards}
                                onFork={forkDoor}
                                onContinue={continueDoor}
                                threads={threads}
                              />
                            )}
                          </FindScope>
                          {detailsWide ? null : (
                            <TaskSummary
                              tasks={summaryTasks}
                              layout={summaryLayout}
                              cardId={summaryCard}
                              inbox={inbox.board}
                              held={views.held}
                              onOpenAgent={openAgentColumn}
                            />
                          )}
                        </TaskBody>
                      </>
                    }
                  >
                    {/* Note that the panel stands while its toggle asks for its "+" with nothing to show, drawing the menu alone. */}
                    {!detailsWide && (drawing.panel !== undefined || sidePanel.toggleAsked) ? (
                      <SidePanel
                        {...drawing}
                        panel={drawing.panel ?? sidePanel}
                        unread={tasks.unreadTabs}
                        holder={SIDE_PANEL_HOLDER.TASK}
                        taskId={task.id}
                        repository={task.repository}
                        pages={tasks.pages}
                        agents={agents}
                        openAgents={mainTabs.openAgents}
                        shownAgent={followedAgent(mainTabs.tab, {
                          shown: tasks.shown,
                          covered: sidePanel.fullScreen,
                        })}
                        views={views}
                        shown={tasks.shown}
                        focused={sideFocused}
                        onOpenTarget={openTarget}
                        banner={stranded.banner}
                        taskOfTab={tasks}
                        activity={phone ? { onShown: setShownTab } : undefined}
                      />
                    ) : null}
                    {stranded.dialog}
                  </TaskPage>
                </OpenAddressesHere>
              </TaskMentions>
            </AutomationDirectory>
          </MemberDirectory>
        </CommentFocusScope>
      </PlanCommentsProvider>
    </LinkWorkspaceProvider>
  );
}

/**
 * The page of a task New task is still starting with its agent, before the
 * service has made either: the task's page in the shape it lands in, its
 * column standing as the agent's tab with the developer's words as its first
 * line and no side panel beside it, since the task lands on its agent alone
 * (`useTasksTab`'s `openAgent`), so Start opens the page at once and the
 * start's answer only fills it in. The model the start named stands as
 * itself in the composer's chip rather than a block; the task's title stays
 * a block, since the task is Untitled until its agent names it.
 */
function StartingTaskPage({
  tasks,
  starting,
  summary,
  phoneAway,
}: {
  tasks: TasksControl;
  starting: StartingTask;
  summary: SummaryPin;
  /** A phone's way back, which heads the page as the task's will be (`TaskWaitHead`); none elsewhere. */
  phoneAway: TaskHeadBack | undefined;
}): React.JSX.Element {
  const drawing = { ...useSidePanelDrawing(tasks.sidePanel), panel: undefined };
  const [column, setColumn] = useState<HTMLElement | null>(null);
  // Note that the summary's room is kept, as the task's page keeps it for the agent it lists, so nothing moves as the page lands.
  const summaryLayout = useSummaryLayout(summary, column, false, true);
  return (
    <TaskPageSkeleton
      drawing={drawing}
      summary={summaryLayout}
      onColumn={setColumn}
      starting={{
        line: starting.line,
        model:
          starting.choice === undefined
            ? undefined
            : { choice: starting.choice, models: tasks.agents.models ?? [] },
      }}
      head={phoneAway === undefined ? undefined : <TaskWaitHead away={phoneAway} reading />}
    />
  );
}

/**
 * The Tasks tab's work column: the open task's page, or Home.
 *
 * A memo boundary: the shell drawn again over the same tasks, as a setting
 * that moves draws it, leaves the open plan, its transcripts, and its side
 * panel as they were.
 */
export const DesktopTasks = memo(function DesktopTasks({
  tasks,
  looks,
  summary,
  room = SHELL_ROOM.WIDE,
  away,
  accountName,
  staged = false,
}: {
  tasks: TasksControl;
  /** The signed-in account's name, which Home greets. */
  accountName?: string | undefined;
  /** Whether a fixture stages the window, whose tasks' looks Home's rows read as staged. */
  staged?: boolean;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: TaskLooks;
  /** Whether the task's summary stands pinned beside its column where it fits, rather than collapsed to its rail, and whether it fits, held by the shell, whose panes glide as either turns. */
  summary: SummaryPin;
  /** The room the panel's stage gives; narrow, a task is headed by one row of its own (`task-pane-switcher.tsx`). */
  room?: ShellRoom;
  /** A phone's way back out of the task, to the page it was opened from (`WindowHistory`'s `onLeave`); Home where none is handed. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  // A task New task is starting with its agent stands as its page until the start answers.
  if (tasks.starting !== undefined) {
    return (
      <StartingTaskPage
        tasks={tasks}
        starting={tasks.starting}
        summary={summary}
        phoneAway={
          room === SHELL_ROOM.NARROW
            ? (away ?? { label: HOME_BACK, onPress: tasks.onGoHome })
            : undefined
        }
      />
    );
  }
  switch (tasks.page) {
    case TASKS_PAGE.DOCUMENT:
      return (
        <SkillFiles
          source={tasks.agents.readSkills}
          // Note that a skill's file opens as a file the palette finds does, whole,
          // so its tab stands on this task though the app never showed it.
          onOpen={(skill) => tasks.sidePanel.onOpenFile({ path: skill.path })}
        >
          <PlanDocument
            tasks={tasks}
            looks={looks}
            summary={summary}
            room={room}
            away={away ?? { label: HOME_BACK, onPress: tasks.onGoHome }}
          />
        </SkillFiles>
      );
    // With no task open the column is Home, whose own composer New task
    // hands the caret rather than opening its dialog over it.
    case TASKS_PAGE.HOME:
      return (
        <>
          <div className="desktop-drag-strip" />
          <PageFind page={FIND_PAGE.HOME} active={tasks.shown}>
            <Fill as={FILL_ELEMENT.SECTION} className="home" aria-label="Home">
              <DesktopHome tasks={tasks} room={room} accountName={accountName} staged={staged} />
            </Fill>
          </PageFind>
        </>
      );
  }
});
