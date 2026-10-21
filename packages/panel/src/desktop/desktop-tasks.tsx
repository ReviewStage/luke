import type { CodingAgentAttachment, CodingAgentStatus } from "@luke/features/coding-agent-wire";
import { type MentionLines, sectionAnchors } from "@luke/features/mention-link";
import { planSections } from "@luke/features/plan-document";
import type { TaskStanding } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  SKELETON_SHAPE,
  Skeleton,
} from "@luke/ui";
import { chatNames } from "@luke/ui/chat-model";
import { openThread, PlanCommentsProvider, usePlanComments } from "@luke/ui/plan-comments";
import { agentOfTab, followedAgent, sameTab, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION, RENAME_FAILED_NOTE, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { InboxIcon } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { CallTabVideo } from "../call/panel-avatar.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FIND_PAGE, FindScope, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import type { ShellRoom } from "../shell-room.js";
import { SPINNER_SIZE, Spinner } from "../spinner.js";
import { useSteadyDoor } from "../steady-door.js";
import { AgentCard, agentSubject } from "../tasks/agent-ref.js";
import { ArchivedBanner } from "../tasks/archived-task.js";
import { useChatOn } from "../tasks/chat-gate.js";
import { agentActor, agentTabLabel } from "../tasks/coding-agent-model.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { useInboxCloser } from "../tasks/inbox-close.js";
import type { InboxCodeDoors } from "../tasks/inbox-code-card.js";
import { INBOX_COLUMNS, useInboxColumns } from "../tasks/inbox-columns.js";
import {
  INBOX_SCOPES,
  InboxList,
  InboxListSkeleton,
  ItemMark,
  ShowEmpty,
} from "../tasks/inbox-list.js";
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
import { TaskCall } from "../tasks/task-call.js";
import { TaskIssueLinks } from "../tasks/task-issue-links.js";
import {
  mentionablePullRequests,
  TaskMentions,
  type TaskMentionsValue,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { taskLinkPlace } from "../tasks/task-menu-items.js";
import { useMinute } from "../tasks/task-time.js";
import { CallBar } from "../tasks/tasks-parts.js";
import { TerminalCommands } from "../tasks/terminal-commands.js";
import { TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { useHeldInboxList } from "../tasks/use-held-inbox-list.js";
import { useInboxReadMarks, useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import { OpenHereProvider, openPullRequestsHere, useOpenLink } from "../tasks/use-open-link.js";
import type { PlanEditDoor } from "../tasks/use-plan-editing.js";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import { type TaskInboxControl, useTaskInbox } from "../tasks/use-task-inbox.js";
import { type TaskLooks, useReadMarks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { workRowsOf } from "../tasks/work-model.js";
import { useCapability } from "../use-app-state.js";
import { useAgentTerminalDoors } from "./agent-actions.js";
import { TaskChatTab } from "./desktop-chat.js";
import { DesktopHome } from "./desktop-home.js";
import { useTaskInboxShow } from "./folded-groups.js";
import { AgentPane, MainTabStrip, mainTabLabel } from "./main-tabs.js";
import {
  COLUMN,
  SIDE_PANEL_HOLDER,
  SidePanel,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { StartAgentButton } from "./start-agent-button.js";
import { useStrandedTaskBanner } from "./stranded-task-banner.js";
import { useTabViews } from "./strip-tabs.js";
import { TaskActions } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import {
  SummaryButton,
  type SummaryPin,
  summaryHolds,
  TaskSummary,
  useSummaryLayout,
} from "./task-summary.js";

/**
 * The work column while Tasks is chosen: the open task's column, its
 * toolbar above and the call bar below, and the side panel beside it, the
 * window's full height, while that is open (or over it, while it fills the
 * window); or, with none open, the home page (`desktop-home.tsx`).
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
 * the draft agent's. Start and the ⋯ menu are the task's, not an agent's,
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
 *
 * An archived task reads and takes nothing until it is brought back: its
 * banner under the toolbar says so with Unarchive as its primary button,
 * and in the meantime the document is not edited, the task is not renamed,
 * no repository is chosen, Start, a new agent, and the call's start are not
 * drawn, and a version viewed is not restored (`../tasks/archived-task.tsx`).
 */

/** How wide the block standing in the plan's tab is while the plan is read: a typical tab's width. */
const TAB_SKELETON_WIDTH = "120px";

/**
 * The strip across the top of the work column, which is also the window's
 * drag handle: the column's tabs at its left and the task's actions at its right.
 */
function Toolbar({
  heading,
  children,
}: {
  heading: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar">
      {heading}
      {children ? <div className="desktop-toolbar-actions">{children}</div> : null}
    </header>
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
 * through the list (`inbox-pager.tsx`).
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
  const marks = useInboxReadMarks({
    act,
    workspaceId: task.workspaceId,
    // Note that a task's own Inbox offers no Mark all as read.
    onMarkedAll: () => undefined,
  });
  const closeItem = useInboxCloser({ act, onHeard: tasks.agents.onRetryList });
  // Note that the task's read draws the window's own marks, answers, and messages over it already (`inbox-settling.ts`).
  const groups = [
    { holder: taskHolder(task), items: [...inbox.board.open, ...inbox.board.settled] },
  ];
  const items = groups.flatMap((group) => group.items);
  const counts = inboxCounts(groups, tasks.me);
  const filter = {
    grouping: INBOX_GROUPING.NONE,
    show: show.show,
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
  const filteredOut = show.show !== INBOX_SHOW.ALL && listed.length === 0 && items.length > 0;
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
    ({ holder, item }) => (
      <ItemMark
        holder={holder}
        agentId={item.agentId}
        models={tasks.agents.models}
        readerId={tasks.me}
      />
    ),
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
          scopes: INBOX_SCOPES.TASK,
          view: undefined,
        }}
        models={tasks.agents.models}
        readerId={tasks.me}
        note={
          inbox.reading ? (
            <InboxListSkeleton />
          ) : inbox.failed && listed.length === 0 ? (
            <div className="sidebar-note">
              <ErrorState onRetry={inbox.onRetry}>The inbox could not be read.</ErrorState>
            </div>
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
          <header className="desktop-toolbar" />
          {/* Note that the list says what its tab left out, so the pane beside it stands bare. */}
          {inbox.read && listed.length === 0 && !filteredOut ? (
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
            // An archived plan's items are read but not answered, the box giving way to Unarchive.
            onUnarchive:
              task.archivedAt === undefined
                ? undefined
                : () => tasks.onMarkTask(task.id, TASK_MARK.UNARCHIVE),
          }}
        />
      )}
    </section>
  );
}

/**
 * The open task's region: its column, or the state standing in its place.
 * While the task is read, its strip holds one tab-shaped skeleton where the
 * plan's tab will stand, so the row does not move when the task is drawn,
 * and no name is guessed before the read says it; a task that could not be
 * drawn has no tab at all. The captions, handed in while the task is drawn,
 * stand just above the call bar.
 */
function PlanDocument({
  tasks,
  looks,
  captions,
  summary,
}: {
  tasks: TasksControl;
  looks: TaskLooks;
  captions: React.ReactNode;
  summary: SummaryPin;
}): React.JSX.Element {
  const { region } = tasks;
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
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  const summaryLayout = useSummaryLayout(
    summary,
    column,
    tasks.sidePanel.fullScreen,
    summaryHolds(tasks, inbox.board, openComments),
  );
  const summaryCard = useId();
  // The clock the plan's tab's card counts its update back from.
  const now = useMinute();
  const voiceOffered = useCapability(HOST_CAPABILITY.VOICE);
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
  // Open terminal and Run open an agent's terminals as on every surface that draws it (`agent-actions.tsx`).
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
  // The one slot the toolbar keeps for a ⋯: the task's on its tab, and on
  // another the chosen tab's own, drawn there from the tab (`strip-tabs.tsx`).
  // Held above the states with no document for the same reason.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // The task as the list names it, its owner, agents, and pull requests
  // among it, which its card and its banner read. Held above the states
  // with no document for the same reason.
  const opened = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const listedOpen =
    opened === undefined
      ? undefined
      : ([...tasks.tasks, ...tasks.archived].find((each) => each.id === opened.id) ?? opened);
  const stranded = useStrandedTaskBanner(tasks, listedOpen);
  // The workspace's agents an `@` offers after the task's own, named by the tasks the window lists, archived ones among them.
  const mentionTasks = useMemo(
    () => [...tasks.tasks, ...tasks.archived],
    [tasks.tasks, tasks.archived],
  );
  const readMentionAgents = useMentionAgentsReader(
    opened?.workspaceId,
    mentionTasks,
    tasks.agents.models,
  );
  const openMention = tasks.onShowMention;
  const revealed = tasks.sectionReveal;
  // A file a mention names opens in its tab, its lines at the commit the mention pins them to.
  const openMentionedFile = (path: string, lines: MentionLines | undefined) =>
    lines === undefined
      ? tasks.sidePanel.onOpenFile({ path })
      : tasks.sidePanel.onOpenFile(
          { path, startLine: lines.startLine, endLine: lines.endLine },
          lines.commit,
        );
  const { mainTabs, sidePanel, agents } = tasks;
  const { tab } = mainTabs;
  const archived = opened?.archivedAt !== undefined;
  const home =
    opened === undefined
      ? undefined
      : tasks.workspaces.find((each) => each.id === opened.workspaceId);
  // The slug the task's links are written under, as its ⋯ menu's Copy link to task writes it.
  const workspace =
    opened === undefined ? undefined : taskLinkPlace(tasks.workspaces, opened).workspace;
  // A row that opens a tab of this column, as a coding agent's start on the
  // Call tab opens the agent's, first has a panel filling the window over it
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
        return chatOn ? openColumnTab(MAIN_TAB.CHAT) : undefined;
      case TOOL_TARGET.BOARD:
        return sidePanel.onChoose(SIDE_PANEL_TAB.BOARD);
      case TOOL_TARGET.PAGE:
        return sidePanel.onChoose({ page: target.page });
      case TOOL_TARGET.TASK:
        return tasks.onShowTask(target.task);
      case TOOL_TARGET.SHOWN_CODE: {
        // The lines are read at the commit Luke read them at, as the Code tab's snippet opens them.
        const showing = tasks.shownCode?.find((each) => each.callId === target.call);
        return sidePanel.onOpenFile(target.ref, showing?.code.commit);
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
    sidePanel.onChoose({ subagent: callId, delegation: { agent, task } });
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
  // Note that what the transcripts and the plan are handed, and what they
  // read from around them, is held across this page's draws over the same
  // task, because each holds while that does (`TaskCall`, `AgentPane`,
  // `PlanBody`), and the page is drawn again as its column's focus, its side
  // panel's width, and the minute's clock move; only the cards a
  // transcript's rows hang move with the minute. Each door stands across
  // draws and calls the newest closure (`useSteadyDoor`).
  const openTargetDoor = useSteadyDoor(openTarget);
  const openSubagent = useSteadyDoor((callId: string) => openPanelTab({ subagent: callId }));
  const openDelegationDoor = useSteadyDoor(openDelegation);
  const openPullRequestDoor = useSteadyDoor(openPullRequest);
  const openAgent = useSteadyDoor((agent: string) => openColumnTab({ agent }));
  const agentLookDoor = useSteadyDoor(agentLook);
  const openMentionedFileDoor = useSteadyDoor(openMentionedFile);
  const forkDoor = useSteadyDoor(
    archived ? undefined : (fork: AgentFork) => openColumnTab({ draft: agents.onForkDraft(fork) }),
  );
  const continueDoor = useSteadyDoor(
    archived
      ? undefined
      : (agentId: string, words: string, attachments: readonly CodingAgentAttachment[]) =>
          openColumnTab({ draft: agents.onContinueDraft(agentId, words, attachments) }),
  );
  const showHistory = useSteadyDoor((save: number | undefined) => {
    if (opened !== undefined) tasks.history.onOpen(opened.id, save);
  });
  const edit: PlanEditDoor | undefined =
    archived || opened === undefined ? undefined : (request) => tasks.edit(opened.id, request);
  const editDoor = useSteadyDoor(edit);
  const renameDoor = useSteadyDoor(archived ? undefined : (name: string) => rename.end(name));
  const draftNameDoor = useSteadyDoor(
    archived || opened === undefined
      ? undefined
      : (name: string | undefined) => tasks.onDraftName(opened.id, name),
  );
  const markRead = useSteadyDoor((unread: boolean) => {
    if (opened !== undefined) reads.mark(opened, unread);
  });
  const setStanding = useSteadyDoor(
    archived || opened === undefined
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
          },
    [workspace, openMention, openMentionedFileDoor, reveal, onSectionRevealed],
  );
  const { linearIssuesIn, githubIssuesIn } = tasks.newTask;
  const underTitle = useMemo(
    () =>
      opened === undefined ? undefined : (
        <TaskIssueLinks
          taskId={opened.id}
          workspaceId={opened.workspaceId}
          repository={opened.repository}
          archived={archived}
          linearIn={linearIssuesIn}
          githubIn={githubIssuesIn}
        />
      ),
    [opened, archived, linearIssuesIn, githubIssuesIn],
  );
  const video = useMemo(
    () => (openedId === undefined ? undefined : <CallTabVideo taskId={openedId} />),
    [openedId],
  );
  // A chat notice in an agent's transcript reads its message from the chat
  // the window holds, and opens the window's Chat on its channel.
  const chatRead = tasks.chatView.chat;
  const { onShow: showChat } = tasks.chatView;
  const chat = useMemo(
    () =>
      chatRead === undefined
        ? undefined
        : {
            chat: chatRead.answer,
            names: chatNames(tasks.tasks, chatRead.agents, undefined),
            onOpen: showChat,
          },
    [chatRead, tasks.tasks, showChat],
  );
  // A row in a transcript that opens a tab hangs that tab's card, read as
  // the tab reads it, so an agent, a subagent, or a file is previewed alike wherever named.
  const listedCard = listedOpen ?? opened;
  const conversation = tasks.work.conversation;
  const sideTab = sidePanel.tab;
  const { shownCode } = tasks;
  const cards = useMemo(
    () =>
      listedCard === undefined
        ? undefined
        : taskCards({
            agents,
            workRows: workRowsOf(conversation),
            held: views.held,
            chosen: (chosen) =>
              sameTab(chosen, tab) || (sideTab !== undefined && sameTab(chosen, sideTab)),
            shownCode: shownCode ?? [],
            task: {
              name: listedCard.name,
              status: listedCard.status,
              card: taskCardOf(tasks, listedCard, now),
            },
          }),
    [agents, conversation, views.held, tab, sideTab, shownCode, listedCard, tasks, now],
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
        return { id: agent.id, name, actor: agentActor(agent, name) };
      }),
      readAgents: readMentionAgents,
      pullRequests: mentionablePullRequests(agents),
      doors: {
        taskId: opened.id,
        place: { workspace, repository: opened.repository },
        anchors: new Set(
          sectionAnchors(planSections(opened.document.body).map((section) => section.heading)),
        ),
        onOpenTask: openMention,
        onOpenFile: openMentionedFileDoor,
        agentOf: agentLookDoor,
      },
    };
  }, [
    opened,
    workspace,
    pages,
    agents,
    readMentionAgents,
    openMention,
    openMentionedFileDoor,
    agentLookDoor,
  ]);
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
    // A plan that cannot be drawn offers no menu, so its way back to the home page is said here.
    const close = { label: "Close task", onClick: tasks.onLeaveTask };
    return (
      <>
        <Toolbar
          heading={
            <div className="desktop-toolbar-heading">
              {region.kind === DOCUMENT_REGION.READING ? (
                <Skeleton shape={SKELETON_SHAPE.CONTROL} width={TAB_SKELETON_WIDTH} />
              ) : null}
            </div>
          }
        />
        {/* A plan the service would not hand the reader is not there for them, whether it was deleted or never theirs. */}
        {region.kind === DOCUMENT_REGION.MISSING ? (
          <NotFound thing={NOT_FOUND_THING.TASK} action={close} />
        ) : (
          <section className="desktop-empty">
            {region.kind === DOCUMENT_REGION.READING ? (
              <Spinner label="Loading task" size={SPINNER_SIZE.REGION} />
            ) : region.kind === DOCUMENT_REGION.FAILED ? (
              <ErrorState onRetry={tasks.onRetryDocument} placement={ERROR_STATE_PLACEMENT.CENTRED}>
                {line}
              </ErrorState>
            ) : (
              <p role="alert">{line}</p>
            )}
            {region.kind === DOCUMENT_REGION.FAILED ? (
              <Button onClick={close.onClick}>{close.label}</Button>
            ) : null}
          </section>
        )}
      </>
    );
  }
  const { task } = region;
  const listed = listedOpen ?? task;
  const unarchive = () => tasks.onMarkTask(task.id, TASK_MARK.UNARCHIVE);
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
  // Start and the task's ⋯ are the task's, not an agent's, so only the
  // Call's tab, which anchors the column, draws them; the task's chords
  // stand on every tab.
  const onTaskTab = tab === MAIN_TAB.CALL;
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
    <section className="desktop-document" aria-label={task.name}>
      {/* Keyed by the archive, so an editor still open when the plan is
          archived elsewhere is let go rather than left taking words. */}
      <PlanBody
        key={String(archived)}
        task={task}
        live={tasks.live}
        reader={reader}
        agents={editAgents}
        onShowHistory={showHistory}
        // None of the three stands on an archived plan, which is drawn read-only.
        onEdit={editDoor}
        // The title renames as the chip's field does, so a refusal is said beside it.
        onRename={renameDoor}
        onDraftName={draftNameDoor}
        looks={looks}
        readMark={readMark}
        sectionLinks={sectionLinks}
        standing={standing}
        underTitle={underTitle}
      />
    </section>
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
        onOpenFile: sidePanel.onOpenFile,
      }}
    />
  );
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
                  <div
                    ref={setArea}
                    className="desktop-task"
                    data-panel-open={String(sidePanel.open)}
                  >
                    {/* Note that the column is hidden rather than left out while the
          panel fills the window, and keeps its layout beneath the panel, so
          leaving full screen uncovers it as it was. */}
                    <div
                      ref={setColumn}
                      className="desktop-task-main"
                      hidden={sidePanel.fullScreen}
                    >
                      <Toolbar
                        heading={
                          <MainTabStrip
                            task={task}
                            taskCard={taskCardOf(tasks, listed, now)}
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
                            chat={chatOn && tasks.chatView.available}
                            actionsSlot={actionsSlot}
                            onOpenTerminal={terminalDoors.onOpenTerminal}
                            onOpenOnMac={terminalDoors.onOpenOnMac}
                          />
                        }
                      >
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
                          {archived ? null : (
                            <>
                              <RepositoryChip
                                place={CHIP_PLACE.TOOLBAR}
                                value={task.repository}
                                chooser={tasks.repositories}
                                onChoose={chooseRepository}
                                openRequest={menuRequest}
                              />
                              {onTaskTab ? <StartAgentButton control={agents} /> : null}
                            </>
                          )}
                          <span ref={setActionsSlot} className="toolbar-tab-actions">
                            <TaskActions
                              tasks={tasks}
                              task={task}
                              button={onTaskTab}
                              onRename={rename.begin}
                            />
                          </span>
                        </Fragment>
                        <SummaryButton layout={summaryLayout} cardId={summaryCard} />
                      </Toolbar>
                      {/* The plan's banner is the whole plan's, so it stands over every
            tab of the column, and over the panel's while that fills the window. */}
                      {sidePanel.fullScreen ? null : stranded.banner}
                      {/* The summary stands beside what the column shows, under the
            toolbar and over the call bar, which both span the column. */}
                      <div className="desktop-plan-body">
                        <FindScope
                          className="desktop-task-column"
                          active={tasks.shown && !sideFocused}
                          subject={{ task: task.id, tab }}
                        >
                          {archived ? <ArchivedBanner onUnarchive={unarchive} /> : null}
                          {tab === MAIN_TAB.CALL ? (
                            <section
                              className="desktop-agent"
                              role="tabpanel"
                              aria-label={TAB_WORDS.CALL}
                              data-popover-room=""
                            >
                              <TaskCall
                                region={tasks.transcript.region}
                                onRetry={tasks.transcript.onRetry}
                                conversation={tasks.work.conversation}
                                onLoadEarlier={tasks.work.onLoadEarlier}
                                onOpenSubagent={openSubagent}
                                onOpenTarget={openTargetDoor}
                                cards={cards.call}
                                shown={tasks.shown && !sidePanel.fullScreen}
                                models={agents.models}
                                reveal={tasks.transcript.reveal ?? tasks.work.reveal}
                                video={video}
                              />
                            </section>
                          ) : null}
                          {tab === MAIN_TAB.CHAT && chatOn ? (
                            <section
                              className="desktop-task-chat"
                              role="tabpanel"
                              aria-label="Chat"
                            >
                              <TaskChatTab tasks={tasks} taskId={task.id} />
                            </section>
                          ) : null}
                          {tab === MAIN_TAB.CALL || tab === MAIN_TAB.CHAT ? null : (
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
                              chat={chat}
                              onFork={forkDoor}
                              onContinue={continueDoor}
                            />
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
                      </div>
                      {/* Note that a call of the plan's own still stands, so it can be
            ended, when only a race left one on a plan just archived. */}
                      {!voiceOffered || (archived && !tasks.stop.shown) ? null : (
                        <div className="desktop-call-bar">
                          {captions}
                          <CallBar
                            status={tasks.status}
                            microphone={tasks.microphone}
                            speaker={tasks.speaker}
                            stop={tasks.stop}
                          />
                        </div>
                      )}
                    </div>
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
                        codeFailed={tasks.workFailed ? { onRetry: tasks.onRetryWork } : undefined}
                        pages={tasks.pages}
                        transcript={tasks.transcript}
                        work={tasks.work}
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
                          waiting: inbox.board.open.length,
                          drafted: inbox.drafted,
                        }}
                      />
                    ) : null}
                    {stranded.dialog}
                  </div>
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
 * The Tasks tab's work column: the open task's page, or the home page.
 *
 * A memo boundary: the shell drawn again over the same tasks, as a setting
 * that moves draws it, leaves the open plan, its transcripts, and its side
 * panel as they were.
 */
export const DesktopTasks = memo(function DesktopTasks({
  tasks,
  looks,
  captions,
  summary,
  room,
  accountName,
}: {
  tasks: TasksControl;
  /** The room the panel's stage gives, which says how many tasks the home page lists; wide where left out. */
  room?: ShellRoom | undefined;
  /** The signed-in account's name, which the home page greets. */
  accountName?: string | undefined;
  /** The open plan's sections changed since the developer last looked, held by the shell across the plan's version history. */
  looks: TaskLooks;
  /** The live captions, while they ride the open task's call bar. */
  captions?: React.ReactNode;
  /** Whether the task's summary stands pinned beside its column where it fits, rather than collapsed to its rail, and whether it fits, held by the shell, whose panes glide as either turns. */
  summary: SummaryPin;
}): React.JSX.Element {
  // The second call's question stands over either page: a Talk press on a
  // task's page asks it, and so does a task started from the New task dialog.
  const secondCall = (
    <ConfirmDialog confirm={tasks.secondCall.confirm} question={tasks.secondCall.question} />
  );
  switch (tasks.page) {
    case TASKS_PAGE.DOCUMENT:
      return (
        <SkillFiles
          source={tasks.agents.readSkills}
          // Note that a skill's file opens as a file the palette finds does, whole,
          // so its tab stands on this task though Luke never showed it.
          onOpen={(skill) => tasks.sidePanel.onOpenFile({ path: skill.path })}
        >
          <PlanDocument tasks={tasks} looks={looks} captions={captions} summary={summary} />
          {secondCall}
        </SkillFiles>
      );
    // With no task open the column opens on New task's composer, and ⌘N's
    // dialog stands over it as it stands over a task.
    case TASKS_PAGE.HOME:
      // A launch reopening the task last open draws the window's ground
      // alone until it opens, so the home page never flashes before it.
      if (tasks.restoring) return <div className="desktop-drag-strip" />;
      return (
        <>
          <div className="desktop-drag-strip" />
          <PageFind page={FIND_PAGE.HOME} active={tasks.shown}>
            <section className="home" aria-label="Home">
              <DesktopHome tasks={tasks} room={room} accountName={accountName} />
            </section>
          </PageFind>
          {secondCall}
        </>
      );
  }
});
