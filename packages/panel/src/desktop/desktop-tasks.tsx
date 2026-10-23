import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { type MentionLines, sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { TaskStanding } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackIcon,
  ConfirmDialog,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  IconButton,
  PageToolbar,
  SKELETON_SHAPE,
  Skeleton,
  Tooltip,
  useMinute,
} from "@luke/ui";
import { openThread, PlanCommentsProvider, usePlanComments } from "@luke/ui/plan-comments";
import { pullRequestAgentOf, repositoryPullRequestOf } from "@luke/ui/pull-request-link";
import { searchTokens } from "@luke/ui/search-tokens";
import { agentOfTab, followedAgent, sameTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION, RENAME_FAILED_NOTE, TASKS_PAGE } from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { InboxIcon } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FindScope } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { CallNotice } from "../tasks/agent-call.js";
import { AgentCard, agentSubject } from "../tasks/agent-ref.js";
import { StartingAgentTab } from "../tasks/agent-tab.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { peopleOf } from "../tasks/changes-card.js";
import { useChatNames } from "../tasks/chat-actors.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { agentActor, agentTabLabel, type SentLine } from "../tasks/coding-agent-model.js";
import { useInboxCloser } from "../tasks/inbox-close.js";
import type { InboxCodeDoors } from "../tasks/inbox-code-card.js";
import { INBOX_COLUMNS, useInboxColumns } from "../tasks/inbox-columns.js";
import { InboxList, InboxListSkeleton, SearchEmpty, ShowEmpty } from "../tasks/inbox-list.js";
import {
  firstChoice,
  INBOX_GROUPING,
  INBOX_SHOW,
  type InboxListed,
  inboxCounts,
  listedItems,
  NEEDS_YOU,
  taskHolder,
} from "../tasks/inbox-model.js";
import { inboxNext, useInboxPager } from "../tasks/inbox-pager.js";
import { InboxPane } from "../tasks/inbox-pane.js";
import { PlanBody, type SectionLinks } from "../tasks/plan-body.js";
import { CommentFocusScope } from "../tasks/plan-comments.js";
import { CHIP_PLACE, RepositoryChip } from "../tasks/repository-chip.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import { TAB_KIND } from "../tasks/tab-look.js";
import { TaskIssueLinks } from "../tasks/task-issue-links.js";
import {
  mentionablePullRequests,
  TaskMentions,
  type TaskMentionsValue,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { taskLinkPlace } from "../tasks/task-menu-items.js";
import { TerminalCommands } from "../tasks/terminal-commands.js";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { useHeldInboxList } from "../tasks/use-held-inbox-list.js";
import { useInboxReadMarks, useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { OpenHereProvider, openPullRequestsHere, useOpenLink } from "../tasks/use-open-link.js";
import type { PlanEditDoor } from "../tasks/use-plan-editing.js";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { type TaskInboxControl, useTaskInbox } from "../tasks/use-task-inbox.js";
import { type TaskLooks, useReadMarks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useCallingAgent } from "../use-voice-view.js";
import type { MenuAction } from "./action-menu.js";
import { useAgentCallDoors, useAgentDraftDoors, useAgentTerminalDoors } from "./agent-actions.js";
import { TaskChatTab } from "./desktop-chat.js";
import { DesktopWelcome } from "./desktop-welcome.js";
import { useTaskInboxShow } from "./folded-groups.js";
import { AgentPane, MainTabStrip, MainTabStripSkeleton, mainTabLabel } from "./main-tabs.js";
import { PhoneHead } from "./phone-head.js";
import {
  COLUMN,
  changesTabOf,
  type ShownTab,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  SidePanelSkeleton,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { StartAgentButton } from "./start-agent-button.js";
import { useStrandedTaskBanner } from "./stranded-task-banner.js";
import { useTabViews } from "./strip-tabs.js";
import { tabCard } from "./tab-card.js";
import { TaskActions } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import {
  ACTIVITY_BACK,
  TASK_PANE,
  TASKS_BACK,
  TaskHead,
  type TaskHeadBack,
  type TaskPane,
  taskPaneItems,
  taskPaneOf,
} from "./task-pane-switcher.js";
import {
  SummaryButton,
  type SummaryLayout,
  type SummaryPin,
  SummarySkeleton,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
} from "./task-summary.js";

/**
 * The work column while Tasks is chosen: the open task's column, its
 * toolbar above and the call bar below, and the side panel beside it, the
 * window's full height, while that is open (or over it, while it fills the
 * window); or, with none open, a new account's welcome (`desktop-welcome.tsx`),
 * every other account resting on a page standing in its place instead
 * (`resting-page.ts`).
 * The task list itself is the sidebar's, and so is moving between tasks: the
 * toolbar offers no way out of the open task, only its actions: Start, which
 * hands the task to a coding agent, and the ⋯ menu, where Copy plan and the
 * rest stand. The toolbar is one row, the side panel's bar's height exactly;
 * the task's repository is the sidebar's row's to name, so the toolbar draws
 * the repository chip only while the task has none, and otherwise only the
 * chip's menu, which Change repository opens.
 *
 * The column's summary stands at its right, under the toolbar and over the
 * call bar, listing what both "+" menus open, with its button last in the
 * toolbar, after the ⋯ menu (`task-summary.tsx`).
 *
 * The column holds tabs as the side panel does (`main-tabs.tsx`): the
 * plan's own first, showing its document, then one per coding agent,
 * showing its transcript and its composer at the document's measure, and
 * the draft agent's. A task with no agent's tab to show shows a new
 * agent's draft (`use-main-tabs.ts`), whose composer starts an agent on
 * what is typed, or a voice chat from its Call. Start and the ⋯ menu are the task's, not an agent's,
 * so only the plan's own tab draws them, while their chords (Copy plan,
 * Archive, Permanently delete) answer on every tab; the call bar is the
 * task's too, and stands on every tab: a call is about the task whichever
 * tab is read. The document stays laid out while an agent's tab is shown,
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
const TASK_LOADING_LABEL = "Loading task";

/** How wide the toolbar's worded actions stand while the task is read: a repository's chip, and Start with its model menu. */
const ACTION_SKELETON_WIDTHS = { REPOSITORY: "112px", START: "104px" } as const;

/** An icon press's width, the task's ⋯'s and the summary's toggle's, as tall as it is wide. */
const ICON_PRESS_WIDTH = "var(--luke-control-height)";

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
  column,
  children,
}: {
  areaRef?: ((area: HTMLDivElement | null) => void) | undefined;
  columnRef: (column: HTMLElement | null) => void;
  panelOpen: boolean;
  fullScreen: boolean;
  column: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div ref={areaRef} className="desktop-task" data-panel-open={String(panelOpen)}>
      <Fill ref={columnRef} className="desktop-task-main" hidden={fullScreen}>
        {column}
      </Fill>
      {children}
    </div>
  );
}

/** The column's body under its toolbar: what the column shows, and the summary beside it. */
function TaskBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="desktop-plan-body">{children}</div>;
}

/** The task's actions at the toolbar's right while the task is read, as the toolbar lands them: the repository's chip, Start, the ⋯, and the summary's toggle where the summary holds something. */
function TaskActionsSkeleton({ summary }: { summary: boolean }): React.JSX.Element {
  return (
    <>
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ACTION_SKELETON_WIDTHS.REPOSITORY} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ACTION_SKELETON_WIDTHS.START} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ICON_PRESS_WIDTH} />
      {summary ? <Skeleton shape={SKELETON_SHAPE.CONTROL} width={ICON_PRESS_WIDTH} /> : null}
    </>
  );
}

/**
 * The task's page while the task is read, in the shape it lands in and
 * through the frames it lands in: the toolbar with a tab where the
 * column's first will stand, its "+" after it and its actions at its right,
 * the column standing as an agent's tab does before its transcript lands
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
  /** The line New task's agent start under way opens its agent on, which the column draws as the agent's tab will; none while a task is read. */
  starting?: SentLine | undefined;
  /** The side panel as it will be drawn, its panel none where it is shut. */
  drawing: SidePanelDrawing;
  /** How the summary will stand, whose room is kept, and whether it holds anything, which its toggle stands for. */
  summary: Pick<SummaryLayout, "mode" | "holds">;
  /** Hands over the column, which the summary's room is measured on, as the page's own does. */
  onColumn: (column: HTMLElement | null) => void;
  /** A phone's head over the page, as the page will be headed once it lands (`TaskWaitHead`); none elsewhere. */
  head?: React.ReactNode;
}): React.JSX.Element {
  const { panel, ...frame } = drawing;
  return (
    <>
      {head}
      <TaskPage
        columnRef={onColumn}
        panelOpen={panel !== undefined}
        fullScreen={panel?.fullScreen === true}
        column={
          <>
            <PageToolbar
              lead={<MainTabStripSkeleton />}
              actions={<TaskActionsSkeleton summary={summary.holds} />}
            />
            <TaskBody>
              <Fill className="desktop-task-column">
                <AgentColumn>
                  {starting === undefined ? (
                    <AgentTabSkeleton label={TASK_LOADING_LABEL} />
                  ) : (
                    <StartingAgentTab line={starting} />
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
  const back = `Back to ${away.label}`;
  return (
    <PhoneHead
      place="task"
      start={
        <Tooltip label={back}>
          <IconButton icon={<BackIcon />} label={back} onClick={away.onPress} />
        </Tooltip>
      }
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
 * Copy plan's chord, the toolbar's while a task is drawn: the press itself
 * stands in the ⋯ menu, and what came of it is said in the window's toast.
 */
function CopyChord({ copy }: { copy: TasksControl["copy"] }): null {
  useAppCommand(APP_COMMAND.COPY_PLAN, copy.onPress);
  return null;
}

/** ⌘T's offer while a task is drawn: the "+" of the column holding the window's focus. */
function NewTabChord({ onNewTab }: { onNewTab: () => void }): null {
  useAppCommand(APP_COMMAND.NEW_TAB, onNewTab);
  return null;
}

/** The plan's own Inbox lists one plan's items in one run, so nothing in it folds. */
const NO_FOLDS = () => false;

/**
 * The plan's own Inbox tab, in the side panel: its items newest first in the window's Inbox's
 * list, under the window's head, whose view's menu offers To do and All
 * alone, kept as a choice of their own (`folded-groups.ts`), and no groups since they are one
 * plan's, and the chosen item read beside them in the same pane, on the
 * plan's own held read. With nothing chosen, the first item listed that
 * the reader is not done with stands chosen, else the newest; a plan whose read holds nothing
 * says so under the Inbox's glyph, and one whose items its scope leaves out
 * says so in its list and offers All, the item chosen still shown
 * beside it. The pane's plan crumb chooses the plan's tab and its agent crumb
 * the agent's. Too narrow for both, it shows the chosen item, and the list
 * once its way back is taken, as the window's Inbox does
 * (`inbox-columns.ts`); holding one item, it is that item, with no list to
 * go back to. K and J, and the pager where the item stands alone, step
 * through the list (`inbox-pager.tsx`). Its head's magnifier searches the
 * list as the window's Inbox's does, the item shown keeping its place.
 */
function TaskInboxTab({
  tasks,
  task,
  inbox,
  onOpenTask,
  onOpenAgent,
  openLink,
  code,
}: {
  tasks: TasksControl;
  task: TasksControl["tasks"][number];
  inbox: TaskInboxControl;
  onOpenTask: () => void;
  onOpenAgent: (agentId: string) => void;
  openLink: (url: string) => void;
  code: InboxCodeDoors;
}): React.JSX.Element {
  const now = useMinute();
  const [asked, setAsked] = useState<string | undefined>(undefined);
  const show = useTaskInboxShow();
  const { act } = useAct();
  const closeItem = useInboxCloser({ act, onHeard: tasks.agents.onRetryList });
  // Note that the task's read draws the window's own marks, answers, and messages over it already (`inbox-settling.ts`).
  const groups = [
    { holder: taskHolder(task), items: [...inbox.board.open, ...inbox.board.settled] },
  ];
  const marks = useInboxReadMarks({
    act,
    workspaceId: task.workspaceId,
    // Note that a task's own Inbox offers no Mark all as read.
    toDo: { groups, holdings: tasks.inboxTasks, readerId: tasks.me },
  });
  const items = groups.flatMap((group) => group.items);
  const counts = inboxCounts(groups, tasks.me);
  // The list's search, as the window's Inbox holds it, which narrows what it lists, never what it counts.
  const [query, setQuery] = useState("");
  const search = searchTokens(query);
  const searched = search.length > 0 ? query : undefined;
  const filter = {
    grouping: INBOX_GROUPING.NONE,
    show: show.show,
    search,
    readerId: tasks.me,
  };
  // Note that the tab stands in the side panel, so it is on screen while the panel is.
  const shown = tasks.shown && tasks.sidePanel.open;
  // The rows hold what the filter lists and the chosen row they drew, while the steps keep the item the pane shows in its
  // place, both held still while the tab is shown (`use-held-inbox-list.ts`).
  const { list, steps } = useHeldInboxList(groups, filter, asked, shown);
  const listed = listedItems(list);
  const chosen = listedItems(steps).find(({ item }) => item.id === asked) ?? firstChoice(list);
  // Note that the item standing chosen is kept as asked, so the pane keeps it shown once it is answered, as the window's Inbox keeps its stand-in.
  if (chosen !== undefined && chosen.item.id !== asked) setAsked(chosen.item.id);
  const filteredOut =
    searched === undefined &&
    show.show !== INBOX_SHOW.ALL &&
    listed.length === 0 &&
    items.length > 0;
  // Note that the way back counts every item, filtered out or not, since the list holds the view's menu.
  const columns = useInboxColumns(chosen?.item.id, items.length > 1);
  const choose = ({ item }: InboxListed) => setAsked(item.id);
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const opened = shown && columns.shown !== INBOX_COLUMNS.LIST ? chosen : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: shown,
    onMark: marks.onMark,
  });
  // A notice of the reader's own is acknowledged as it opens, as the window's Inbox acknowledges it.
  useNodOnOpen({ shown: opened, readerId: tasks.me, control: inbox });
  const { pager, direction } = useInboxPager(steps, list, chosen?.item.id, choose, {
    shown,
    folded: NO_FOLDS,
  });
  const next = inboxNext(
    steps,
    chosen,
    { models: tasks.agents.models, readerId: tasks.me },
    open,
    NO_FOLDS,
    direction,
  );
  return (
    <section
      ref={columns.ref}
      className="inbox-view"
      role="tabpanel"
      aria-label="Inbox"
      data-columns={columns.shown}
    >
      <InboxList
        view={list}
        chosen={chosen?.item.id}
        columns={columns.shown}
        rows={columns.rows}
        head={{
          shown,
          show,
          view: undefined,
          search: { query, onQuery: setQuery },
        }}
        models={tasks.agents.models}
        readerId={tasks.me}
        reading={inbox.reading}
        note={
          inbox.reading ? (
            <InboxListSkeleton />
          ) : inbox.failed && listed.length === 0 ? (
            <div className="sidebar-note">
              <ErrorState onRetry={inbox.onRetry}>The inbox could not be read.</ErrorState>
            </div>
          ) : inbox.read && searched !== undefined && listed.length === 0 ? (
            <SearchEmpty searched={searched} />
          ) : inbox.read && filteredOut ? (
            <ShowEmpty show={show} counts={counts} onList={columns.onList} />
          ) : inbox.read && listed.length === 0 && columns.shown !== INBOX_COLUMNS.BOTH ? (
            // Note that the list standing alone says what the hidden pane would, as the pane says it.
            <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>
          ) : null
        }
        onChoose={open}
        onMark={(listed, unread) => marks.onMark(listed.item, unread)}
        onClose={closeItem}
      />
      {chosen === undefined ? (
        <section
          className="inbox-view-items"
          aria-label="Inbox"
          hidden={columns.shown !== INBOX_COLUMNS.BOTH}
        >
          {/* The empty pane keeps a bar the list's head's height, as the window's Inbox does. */}
          <PageToolbar />
          {/* Note that the list says what its tab or its search left out, so the pane beside it stands bare. */}
          {inbox.read && listed.length === 0 && !filteredOut && searched === undefined ? (
            <EmptyState icon={<InboxIcon />}>{NEEDS_YOU.NONE}</EmptyState>
          ) : null}
        </section>
      ) : (
        <InboxPane
          holder={taskHolder(task)}
          item={chosen.item}
          control={inbox}
          agents={tasks.agents}
          hidden={columns.shown === INBOX_COLUMNS.LIST}
          onBack={columns.onBack}
          pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
          next={next}
          doors={{
            onOpenHolder: onOpenTask,
            taskCard: taskCardOf(tasks, task, now),
            onOpenAgent,
            openLink,
            code,
            onMark: marks.onMark,
            onClose: closeItem,
          }}
        />
      )}
    </section>
  );
}

/**
 * What the tab a phone shows offers on what it shows, as its header's ⋯
 * offers it between the task's views and the task's own actions: each item
 * says under it what it acts on, the tab, so the tab's Copy link is told
 * from the task's beneath it.
 */
function shownTabGroups(shown: ShownTab | undefined): MenuAction[][] {
  if (shown === undefined) return [];
  return shown
    .groups()
    .map((group) => group.map((item) => ({ ...item, detail: item.detail ?? shown.label })));
}

/**
 * The open task's region: its column, or the state standing in its place.
 * While the task is read, its strip holds one tab-shaped skeleton where the
 * plan's tab will stand, so the row does not move when the task is drawn,
 * and no name is guessed before the read says it; a task that could not be
 * drawn has no tab at all. The voice's notice line, handed in while the
 * task is drawn, rides the foot of the call's agent's tab.
 */
function PlanDocument({
  tasks,
  looks,
  notice,
  summary,
  room,
  away,
}: {
  tasks: TasksControl;
  looks: TaskLooks;
  notice: React.ReactNode;
  summary: SummaryPin;
  room: ShellRoom;
  away: TaskHeadBack;
}): React.JSX.Element {
  const { region } = tasks;
  // The tab a phone's panel shows past the plan, which its header is named by (`side-panel.tsx`'s `ShownTab`).
  const [shownTab, setShownTab] = useState<ShownTab | undefined>(undefined);
  // A phone's Activity lists the panel's tabs until one is chosen, from it or by anything else, such as
  // an arrival the panel shows, on the task it was asked on alone (`task-pane-switcher.tsx`).
  // Asked over a shut panel, it holds whatever tab the panel opens on, which a shut panel with every tab closed chooses as it opens.
  const [activityAsked, setActivityAsked] = useState<{
    taskId: string;
    tab: SidePanelTab | undefined;
    opening: boolean;
  }>();
  const { open: panelOpen, tab: panelTab } = tasks.sidePanel;
  useEffect(() => {
    if (activityAsked?.opening && panelOpen)
      setActivityAsked({ ...activityAsked, tab: panelTab, opening: false });
  }, [activityAsked, panelOpen, panelTab]);
  const drawing = useSidePanelDrawing(tasks.sidePanel);
  const views = useTabViews();
  const chatOn = useChatOn();
  const { act } = useAct();
  const openLink = useOpenLink();
  const inboxTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const inbox = useTaskInbox({
    taskId: inboxTaskId,
    shown: tasks.shown,
    waiting: tasks.inbox.some((task) => task.taskId === inboxTaskId),
    agents: tasks.agents,
  });
  // The task's comments are read while the task is shown, for its plan's margin, its Comments tab, and its summary.
  const comments = usePlanComments({
    planId: inboxTaskId,
    shown: tasks.shown,
    readComments: (params) => act(ACT_KIND.TASKS_COMMENTS, params),
    startComment: (params) => act(ACT_KIND.TASKS_COMMENT_START, params),
    actOnComment: (params) => act(ACT_KIND.TASKS_COMMENT_ACT, params),
  });
  const openComments = comments?.threads.filter(openThread).length;
  // A link to a resolved thread opens the task's Comments tab, where it is listed, once per ask.
  const resolvedLinked =
    tasks.commentReveal?.planId === inboxTaskId &&
    comments?.threads.some(
      (thread) => thread.id === tasks.commentReveal?.thread && !openThread(thread),
    ) === true
      ? tasks.commentReveal?.ask
      : undefined;
  const { onShow: showSideTab } = tasks.sidePanel;
  useEffect(() => {
    if (resolvedLinked !== undefined && inboxTaskId !== undefined) {
      showSideTab(inboxTaskId, SIDE_PANEL_TAB.COMMENTS);
    }
  }, [resolvedLinked, inboxTaskId, showSideTab]);
  const { onArea: setArea, focus, setFocus } = useColumnFocus();
  const [column, setColumn] = useState<HTMLElement | null>(null);
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
    agentsComing || summaryHolds(tasks, inbox.board, openComments),
  );
  const summaryCard = useId();
  // The clock the plan's tab's card counts its update back from.
  const now = useMinute();
  // The agent of this task a call is in progress into, whose tab wears the live mark.
  const calling = useCallingAgent();
  const reads = useReadMarks();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const taskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  // What waits in the task's inbox opens its Inbox tab in the side panel
  // where an item did not wait at the last read (`use-side-panel.ts`). Note
  // that only a read that answered counts, because a task just opened holds
  // nothing yet, and nothing would forget what waited there.
  const waiting = useMemo(() => inbox.board.open.map((item) => item.id), [inbox.board.open]);
  const { onInboxRead } = tasks.sidePanel;
  useEffect(() => {
    if (taskId !== undefined && inbox.read) onInboxRead(taskId, waiting);
  }, [taskId, inbox.read, waiting, onInboxRead]);
  const rename = useInlineRename(taskId, tasks.onRenameTask);
  // A terminal shown hands the keys to the side panel, where it stands; an
  // agent's tab's Open terminal always opens that agent's own.
  const showSide = () => setFocus(COLUMN.SIDE);
  // Open terminal opens an agent's terminal as on every surface that draws it (`agent-actions.tsx`).
  const terminalDoors = useAgentTerminalDoors(
    tasks.sidePanel,
    region.kind === DOCUMENT_REGION.READY ? region.task.repository : null,
    showSide,
  );
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
  // The column's agents take calls on the open task.
  const calls = useAgentCallDoors(tasks.calls, { taskId });
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
  // A row that opens the plan or the Inbox, which stand in the side panel,
  // shows the panel on it and hands it the keys, as a terminal shown does.
  const openPanelTab = (opened: SidePanelTab) => {
    sidePanel.onChoose(opened);
    showSide();
  };
  // A call's row in a transcript opens what the call is about where the
  // window already draws it: an agent in this column, the plan and the
  // Inbox in the side panel, another task as the sidebar opens it, the
  // rest in the side panel.
  const openTarget = (target: ToolTarget) => {
    switch (target.kind) {
      case TOOL_TARGET.AGENT:
        return openColumnTab({ agent: target.agent });
      case TOOL_TARGET.PLAN:
        return openPanelTab(SIDE_PANEL_TAB.PLAN);
      case TOOL_TARGET.INBOX:
        return openPanelTab(SIDE_PANEL_TAB.INBOX);
      case TOOL_TARGET.CHAT:
        return chatOn ? openPanelTab(SIDE_PANEL_TAB.CHAT) : undefined;
      case TOOL_TARGET.BOARD:
        return sidePanel.onChoose(SIDE_PANEL_TAB.BOARD);
      case TOOL_TARGET.PAGE:
        return sidePanel.onPreview({ page: target.page });
      case TOOL_TARGET.TASK:
        return tasks.onShowTask(target.task);
      case TOOL_TARGET.SHOWN_CODE: {
        // The lines are read at the commit Luke read them at, as the Code tab's snippet opens them.
        const showing = tasks.shownCode?.find((each) => each.callId === target.call);
        return sidePanel.onPreviewFile(target.ref, showing?.code.commit);
      }
    }
  };
  // A delegation's row in an agent's transcript opens its worker in the side
  // panel, where every subagent stands; where the worker stands seeds its glyph.
  const openDelegation = (
    agent: string,
    callId: string,
    task: string,
    status: CodingAgentStatus,
  ) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onPreview({ subagent: callId, delegation: { agent, task } });
  };
  // An agent's pull request chip opens its pull request in the side panel, beside its tab, in
  // the one Pull request tab the "+" offers for that pull request (`showPullRequest`), on its conversation.
  const openPullRequest = (agentId: string, number?: number) =>
    showPullRequest(sidePanel, agents, agentId, PULL_REQUEST_VIEW.CONVERSATION, number);
  // An agent a mention names wears its tab's tile and hangs its tab's card, read as its tab reads them.
  const agentLook = (agentId: string) => {
    const subject = agentSubject(agents, agentId, views.held, false);
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
      onOpenAgent: () => openColumnTab({ agent: agentId }),
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
  const openTargetDoor = useSteadyDoor(openTarget);
  const openDelegationDoor = useSteadyDoor(openDelegation);
  const openPullRequestDoor = useSteadyDoor(openPullRequest);
  const openAgent = useSteadyDoor((agent: string) => openColumnTab({ agent }));
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
  const edit: PlanEditDoor | undefined =
    opened === undefined ? undefined : (request) => tasks.edit(opened.id, request);
  const editDoor = useSteadyDoor(edit);
  const renameDoor = useSteadyDoor((name: string) => rename.end(name));
  const draftNameDoor = useSteadyDoor(
    opened === undefined
      ? undefined
      : (name: string | undefined) => tasks.onDraftName(opened.id, name),
  );
  const markRead = useSteadyDoor((unread: boolean) => {
    if (opened !== undefined) reads.mark(opened, unread);
  });
  const setStanding = useSteadyDoor(
    opened === undefined
      ? undefined
      : (standing: TaskStanding) => {
          void tasks.onSetTaskStanding(opened.id, standing);
        },
  );
  const openedId = opened?.id;
  const openedRepository = opened?.repository ?? null;
  const reader = useMemo(() => ({ readerId: tasks.me }), [tasks.me]);
  const editAgents = useMemo(() => ({ control: agents, onOpen: openAgent }), [agents, openAgent]);
  const unread = openedId === undefined ? false : reads.markedUnread(openedId);
  const readMark = useMemo(() => ({ unread, onMark: markRead }), [unread, markRead]);
  const workspaceName = home?.name ?? "";
  const standing = useMemo(
    () => ({ workspaceName, onSet: setStanding }),
    [workspaceName, setStanding],
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
  const { linearIssuesIn, githubIssuesIn } = tasks.newTask;
  const underTitle = useMemo(
    () =>
      opened === undefined ? undefined : (
        <TaskIssueLinks
          taskId={opened.id}
          workspaceId={opened.workspaceId}
          repository={opened.repository}
          linearIn={linearIssuesIn}
          githubIn={githubIssuesIn}
        />
      ),
    [opened, linearIssuesIn, githubIssuesIn],
  );
  // A chat notice in an agent's transcript reads its message from the chat
  // the window holds, and opens the window's Chat on its channel.
  const chatRead = tasks.chatView.chat;
  const { onShow: showChat } = tasks.chatView;
  const chatNamed = useChatNames(tasks.tasks, chatRead, undefined);
  const chat = useMemo(
    () =>
      chatRead === undefined
        ? undefined
        : { chat: chatRead.answer, names: chatNamed, onOpen: showChat },
    [chatRead, chatNamed, showChat],
  );
  // A row in a transcript that opens a tab hangs that tab's card, read as
  // the tab reads it, so an agent, a subagent, or a file is previewed alike wherever named.
  const listedCard = listedOpen ?? opened;
  const sideTab = sidePanel.tab;
  const { shownCode } = tasks;
  const cards = useMemo(
    () =>
      listedCard === undefined
        ? undefined
        : taskCards({
            agents,
            held: views.held,
            chosen: (chosen) =>
              sameTab(chosen, tab) || (sideTab !== undefined && sameTab(chosen, sideTab)),
            shownCode: shownCode ?? [],
            pages: { taskId: listedCard.id },
            task: {
              name: listedCard.name,
              status: listedCard.status,
              card: taskCardOf(tasks, listedCard, now),
            },
          }),
    [agents, views.held, tab, sideTab, shownCode, listedCard, tasks, now],
  );
  // A link anywhere on the task to a pull request one of its agents opened, a chip in the plan,
  // a transcript, or an Inbox item, opens that same tab rather than GitHub; a link to any other
  // pull request of the task's repository opens in a Pull request tab by its number.
  const openHere = useMemo(
    () => openPullRequestsHere(agents, openPullRequestDoor, openedRepository),
    [agents, openPullRequestDoor, openedRepository],
  );
  // What every place on the page that picks or draws a mention reads (`task-mentions.tsx`).
  const { pages } = tasks;
  const mentions = useMemo<TaskMentionsValue | undefined>(() => {
    if (opened === undefined || workspace === undefined) return undefined;
    return {
      taskId: opened.id,
      taskName: opened.name,
      workspace,
      repository: opened.repository,
      text: () => opened.document.body,
      pages,
      agents: (agents.agents ?? []).map((agent) => {
        const name = agentTabLabel(agent, agents.models);
        return { id: agent.id, name, actor: agentActor(agent, name), summary: agent };
      }),
      readAgents: readMentionAgents,
      pullRequests: mentionablePullRequests(agents),
      shownCode,
      openFiles: sidePanel.files,
      doors: {
        taskId: opened.id,
        place: { workspace, repository: opened.repository },
        anchors: new Set(
          sectionAnchors(planSections(opened.document.body).map((section) => section.heading)),
        ),
        onOpenTask: openMention,
        onOpenFile: openMentionedFileDoor,
        agentOf: agentLookDoor,
        pullRequestOf: pullRequestCardDoor,
      },
    };
  }, [
    opened,
    workspace,
    pages,
    shownCode,
    sidePanel.files,
    agents,
    readMentionAgents,
    openMention,
    openMentionedFileDoor,
    agentLookDoor,
    pullRequestCardDoor,
  ]);
  const phone = room === SHELL_ROOM.NARROW;
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
    return (
      <>
        {phone ? <TaskWaitHead away={away} reading={false} /> : <PageToolbar heading={null} />}
        {/* A plan the service would not hand the reader is not there for them, whether it was deleted or never theirs. */}
        {region.kind === DOCUMENT_REGION.MISSING ? (
          <NotFound thing={NOT_FOUND_THING.TASK} action={close} />
        ) : (
          <Fill as={FILL_ELEMENT.SECTION} className="desktop-empty-region">
            {region.kind === DOCUMENT_REGION.FAILED ? (
              <ErrorState
                onRetry={tasks.onRetryDocument}
                placement={ERROR_STATE_PLACEMENT.CENTRED}
                exit={close}
              >
                {line}
              </ErrorState>
            ) : (
              <EmptyState>{line}</EmptyState>
            )}
          </Fill>
        )}
      </>
    );
  }
  const { task } = region;
  const listed = listedOpen ?? task;
  // The column has a tab on its way: the agents are still read, or, read, a draft opens in the task's empty column.
  const columnComing = agents.agents === undefined ? !agents.listFailed : true;
  const repositoryNote = refusal?.taskId === task.id ? refusal.note : undefined;
  const chooseRepository = (repository: string) => {
    const { id: taskId } = task;
    setRefusal(undefined);
    tasks.onSetRepository(taskId, repository).then(
      (note) => setRefusal(note === undefined ? undefined : { taskId, note }),
      () => undefined,
    );
  };
  const menuRequest =
    tasks.repositoryMenu?.taskId === task.id ? tasks.repositoryMenu.request : undefined;
  // The panel holds the keys while the focus went into it last, or while it
  // fills the window over this column; shut, it hands them back.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The agent a terminal command means from where the developer is: the one
  // whose own tab, Changes tab, or Terminal tab holds the keys, if any.
  const terminalHere = agentOfTab(
    sideFocused && sidePanel.tab !== undefined ? sidePanel.tab : mainTabs.tab,
  );
  const openTaskLink = (href: string) => {
    if (!openHere(href)) openLink(href);
  };
  // The plan's document and its Inbox stand in the side panel, drawn here,
  // where what they read is held, and handed to the panel to draw as tabs.
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
  const documentBody = (
    <Fill as={FILL_ELEMENT.SECTION} className="desktop-document" aria-label={task.name}>
      <PlanBody
        task={task}
        live={tasks.live}
        reader={reader}
        agents={editAgents}
        onShowHistory={showHistory}
        onEdit={editDoor}
        // The title renames as the chip's field does, so a refusal is said beside it.
        onRename={renameDoor}
        onDraftName={draftNameDoor}
        looks={looks}
        readMark={readMark}
        sectionLinks={sectionLinks}
        standing={standing}
        underTitle={underTitle}
        titleActions={room !== SHELL_ROOM.NARROW}
      />
    </Fill>
  );
  const inboxBody = (
    <TaskInboxTab
      tasks={tasks}
      task={listed}
      inbox={inbox}
      onOpenTask={() => openPanelTab(SIDE_PANEL_TAB.PLAN)}
      onOpenAgent={(agent) => openColumnTab({ agent })}
      openLink={openTaskLink}
      code={{
        repository: task.repository,
        readFile: (window) => act(ACT_KIND.TASKS_FILE, { taskId: task.id, ...window }),
        // A code card is a link, which opens its file as the panel's preview, as the window's Inbox opens one.
        onOpenFile: sidePanel.onPreviewFile,
      }}
    />
  );
  // A phone heads the task with one row in place of the side panel's bar and toggle: the way back, what is on screen, and one ⋯.
  const switched = room === SHELL_ROOM.NARROW;
  const activityListed =
    activityAsked !== undefined &&
    activityAsked.taskId === task.id &&
    (activityAsked.opening ||
      (activityAsked.tab === undefined
        ? sidePanel.tab === undefined
        : sidePanel.tab !== undefined && sameTab(activityAsked.tab, sidePanel.tab)));
  const onListed = (asked: boolean) =>
    setActivityAsked(
      asked ? { taskId: task.id, tab: sidePanel.tab, opening: !sidePanel.open } : undefined,
    );
  const pane = taskPaneOf({ open: sidePanel.open, tab: sidePanel.tab, listed: activityListed });
  const choosePane = (chosen: TaskPane) => {
    if (chosen === TASK_PANE.AGENTS) {
      onListed(false);
      // Note that the panel's own toggle shuts it as a step back where the window keeps one, as its Close does.
      if (sidePanel.open) sidePanel.onToggle();
      return;
    }
    onListed(chosen === TASK_PANE.ACTIVITY);
    // Note that a shut panel already on the plan opens by its own toggle, as Show panel opened it, so the window's history steps as it did.
    if (chosen === TASK_PANE.PLAN && !sidePanel.open && sidePanel.tab === SIDE_PANEL_TAB.PLAN)
      sidePanel.onToggle();
    else if (chosen === TASK_PANE.PLAN) sidePanel.onChoose(SIDE_PANEL_TAB.PLAN);
    else if (!sidePanel.open) sidePanel.onToggle();
  };
  // A tab chosen from Activity heads the row by its name and leads back to the list; the task's own views name the task and lead out of it.
  const onTab = pane === TASK_PANE.ACTIVITY && !activityListed ? shownTab : undefined;
  const taskMenu = (
    <TaskActions
      tasks={tasks}
      task={task}
      button
      onRename={rename.begin}
      lead={
        switched ? () => [taskPaneItems(pane, choosePane), ...shownTabGroups(onTab)] : undefined
      }
    />
  );
  const head = switched ? (
    <TaskHead
      back={onTab === undefined ? away : { label: ACTIVITY_BACK, onPress: () => onListed(true) }}
      // Note that the task's Rename opens the task's name in the title's place on a tab too, since the tab hides the plan's own title.
      title={onTab === undefined || rename.editing ? task.name : onTab.label}
      rename={{
        editing: rename.editing,
        onEnd: (end) => {
          void rename.end(end.value);
        },
      }}
      actions={taskMenu}
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
                <OpenHereProvider value={openHere}>
                  {head}
                  {/* Note that the column is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
                  <TaskPage
                    areaRef={setArea}
                    columnRef={setColumn}
                    panelOpen={sidePanel.open}
                    fullScreen={sidePanel.fullScreen}
                    column={
                      <>
                        <PageToolbar
                          lead={
                            <MainTabStrip
                              task={task}
                              main={mainTabs}
                              agents={agents}
                              unread={tasks.unreadTabs}
                              views={views}
                              pins={{
                                pinned: sidePanel.pins,
                                onPin: sidePanel.onPin,
                                onUnpin: sidePanel.onUnpin,
                              }}
                              keys={tasks.shown && !sideFocused}
                              shown={tasks.shown}
                              onOpenTerminal={terminalDoors.onOpenTerminal}
                              calling={calling}
                            />
                          }
                          actions={
                            <>
                              {rename.refused ? (
                                <p className="error-message" role="alert">
                                  {RENAME_FAILED_NOTE}
                                </p>
                              ) : null}
                              {repositoryNote !== undefined ? (
                                <p className="error-message" role="alert">
                                  {repositoryNote}
                                </p>
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
                                  onNewTab={sideFocused ? sidePanel.onNewTab : mainTabs.onNewTab}
                                />
                              ) : null}
                              {/* Keyed once for the chip and the menu alike, so another plan
              starts both afresh and the same plan keeps them. */}
                              <Fragment key={task.id}>
                                <RepositoryChip
                                  place={CHIP_PLACE.TOOLBAR}
                                  value={task.repository}
                                  chooser={tasks.repositories}
                                  onChoose={chooseRepository}
                                  openRequest={menuRequest}
                                />
                                <StartAgentButton control={agents} />
                                {/* The toolbar's one ⋯ is the task's; a tab's own actions are its menu's. A phone's is its header's. */}
                                {switched ? null : taskMenu}
                              </Fragment>
                              <SummaryButton layout={summaryLayout} cardId={summaryCard} />
                            </>
                          }
                        />
                        {/* The plan's banner is the whole plan's, so it stands over every
            tab of the column, and over the panel's while that fills the window. */}
                        {sidePanel.fullScreen ? null : stranded.banner}
                        {/* The summary stands beside what the column shows, under the
            toolbar and over the call bar, which both span the column. */}
                        <TaskBody>
                          <FindScope
                            className="desktop-task-column"
                            active={tasks.shown && !sideFocused}
                            subject={{ task: task.id, tab: tab ?? SIDE_PANEL_TAB.PLAN }}
                          >
                            {tab === undefined ? (
                              // While the agents are read, or a draft opens on a task with none, the
                              // column stands as the tab it will show does before it lands.
                              columnComing ? (
                                <AgentColumn>
                                  <AgentTabSkeleton />
                                </AgentColumn>
                              ) : null
                            ) : (
                              <CallNotice.Provider value={notice}>
                                <AgentPane
                                  call={calls}
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
                                  chat={chat}
                                  onFork={forkDoor}
                                  onContinue={continueDoor}
                                />
                              </CallNotice.Provider>
                            )}
                          </FindScope>
                          <TaskSummary
                            tasks={summaryTasks}
                            layout={summaryLayout}
                            cardId={summaryCard}
                            inbox={inbox.board}
                            held={views.held}
                            repository={task.repository}
                            onOpenAgent={(agent) => openColumnTab({ agent })}
                          />
                        </TaskBody>
                      </>
                    }
                  >
                    {drawing.panel ? (
                      <SidePanel
                        {...drawing}
                        panel={drawing.panel}
                        unread={tasks.unreadTabs}
                        holder={SIDE_PANEL_HOLDER.TASK}
                        taskId={task.id}
                        repository={task.repository}
                        board={tasks.board}
                        shownCode={tasks.shownCode}
                        codeFailed={tasks.codeFailed ? { onRetry: tasks.onRetryCode } : undefined}
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
                        plan={documentBody}
                        task={{ name: task.name, status: listed.status }}
                        inbox={{
                          body: inboxBody,
                          board: inbox.board,
                          drafted: inbox.drafted,
                        }}
                        chat={
                          chatOn && tasks.chatView.available ? (
                            <Fill
                              as={FILL_ELEMENT.SECTION}
                              className="desktop-task-chat"
                              aria-label="Chat"
                            >
                              <TaskChatTab tasks={tasks} taskId={task.id} />
                            </Fill>
                          ) : undefined
                        }
                        activity={
                          switched
                            ? { listed: activityListed, onListed, onShown: setShownTab }
                            : undefined
                        }
                      />
                    ) : null}
                    {stranded.dialog}
                  </TaskPage>
                </OpenHereProvider>
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
 * line, and the side panel at its width, so Start opens the page at once
 * and the start's answer only fills it in.
 */
function StartingTaskPage({
  tasks,
  line,
  summary,
  phoneAway,
}: {
  tasks: TasksControl;
  line: SentLine;
  summary: SummaryPin;
  /** A phone's way back, which heads the page as the task's will be (`TaskWaitHead`); none elsewhere. */
  phoneAway: TaskHeadBack | undefined;
}): React.JSX.Element {
  const drawing = useSidePanelDrawing(tasks.sidePanel);
  const [column, setColumn] = useState<HTMLElement | null>(null);
  // Note that the summary's room is kept, as the task's page keeps it for the agent it lists, so nothing moves as the page lands.
  const summaryLayout = useSummaryLayout(summary, column, tasks.sidePanel.fullScreen, true);
  return (
    <TaskPageSkeleton
      drawing={drawing}
      summary={summaryLayout}
      onColumn={setColumn}
      starting={line}
      head={phoneAway === undefined ? undefined : <TaskWaitHead away={phoneAway} reading />}
    />
  );
}

/**
 * The Tasks tab's work column: the open task's page, or a new account's welcome.
 *
 * A memo boundary: the shell drawn again over the same tasks, as a setting
 * that moves draws it, leaves the open plan, its transcripts, and its side
 * panel as they were.
 */
export const DesktopTasks = memo(function DesktopTasks({
  tasks,
  looks,
  notice,
  summary,
  room = SHELL_ROOM.WIDE,
  away,
}: {
  tasks: TasksControl;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: TaskLooks;
  /** The voice's notice line, while it rides the foot of the open task's call. */
  notice?: React.ReactNode;
  /** Whether the task's summary stands pinned beside its column where it fits, rather than collapsed to its rail, and whether it fits, held by the shell, whose panes glide as either turns. */
  summary: SummaryPin;
  /** The room the panel's stage gives; narrow, a task is headed by one row of its own (`task-pane-switcher.tsx`). */
  room?: ShellRoom;
  /** A phone's way back out of the task, to the page it was opened from (`WindowHistory`'s `onLeave`); the Tasks page where none is handed. */
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
  // The second call's question stands over either page: a Talk press on a
  // task's page asks it, and so does a task started from the New task dialog.
  const secondCall = (
    <ConfirmDialog confirm={tasks.secondCall.confirm} question={tasks.secondCall.question} />
  );
  // A task New task is starting with its agent stands as its page until the start answers.
  if (tasks.starting !== undefined) {
    return (
      <StartingTaskPage
        tasks={tasks}
        line={tasks.starting}
        summary={summary}
        phoneAway={
          room === SHELL_ROOM.NARROW
            ? (away ?? { label: TASKS_BACK, onPress: tasks.boardView.onOpen })
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
          // so its tab stands on this task though Luke never showed it.
          onOpen={(skill) => tasks.sidePanel.onOpenFile({ path: skill.path })}
        >
          <PlanDocument
            tasks={tasks}
            looks={looks}
            notice={notice}
            summary={summary}
            room={room}
            away={away ?? { label: TASKS_BACK, onPress: tasks.boardView.onOpen }}
          />
          {secondCall}
        </SkillFiles>
      );
    // With no task open the column is a new account's welcome, and ⌘N's
    // dialog stands over it as it stands over a task; any other account rests
    // on a page standing in the column's place.
    case TASKS_PAGE.HOME:
      // A launch reopening the task last open draws the window's ground
      // alone until it opens, so the welcome never flashes before it.
      if (tasks.restoring) return <div className="desktop-drag-strip" />;
      return (
        <>
          <div className="desktop-drag-strip" />
          <Fill className="home">
            <DesktopWelcome tasks={tasks} />
          </Fill>
          {secondCall}
        </>
      );
  }
});
