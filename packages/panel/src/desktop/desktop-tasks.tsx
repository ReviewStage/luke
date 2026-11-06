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
import { DescriptionCommentsProvider } from "@repo/ui/description-comments";
import { GLYPH } from "@repo/ui/icons";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { FIND_PAGE, FindScope, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { renameWrite } from "../rename-write.js";
import { HERE } from "../route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { type SentLine, startsOwnAgents } from "../tasks/agent-model.js";
import { AgentCard, agentSubject } from "../tasks/agent-ref.js";
import { StartingAgentTab } from "../tasks/agent-tab.js";
import { AgentTabSkeleton, type ComposerModel } from "../tasks/agent-tab-skeleton.js";
import { useChangesPeopleOf } from "../tasks/changes-people.js";
import { startCloudDraft, useCloudBrowserTabs } from "../tasks/cloud-browser-tabs.js";
import {
  DescriptionBody,
  type DescriptionRoom,
  type SectionLinks,
  type TitleRename,
} from "../tasks/description-body.js";
import { CommentFocusScope } from "../tasks/description-comments.js";
import { keyedItem, waitingByAgent } from "../tasks/inbox-model.js";
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
import { useDescriptionComments } from "../tasks/use-description-comments.js";
import { isOverviewTab, MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import { OpenAddressesHere, openPullRequestsHere, useOpenPlace } from "../tasks/use-open-link.js";
import { PULL_REQUEST_VIEW, type SidePanelTab } from "../tasks/use-side-panel.js";
import { useTaskInbox } from "../tasks/use-task-inbox.js";
import type { TaskLooks } from "../tasks/use-task-looks.js";
import {
  AUTOMATIONS_PAGE,
  type StartingTask,
  TASK_RENAME_SHAPE,
  type TasksControl,
} from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
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

const TASK_LOADING_LABEL = readingWords("the task");

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

function TaskBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="desktop-description-body relative flex min-h-0 flex-1">{children}</div>;
}

function TaskTabsRow({
  hidden,
  children,
}: {
  hidden: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={hidden ? undefined : "task-tabs contents"} hidden={hidden}>
      {children}
    </div>
  );
}

function TaskPageSkeleton({
  drawing,
  summary,
  onColumn,
  starting,
  head,
}: {
  starting?: { readonly line: SentLine; readonly model: ComposerModel | undefined } | undefined;
  drawing: SidePanelDrawing;
  summary: Pick<SummaryLayout, "mode">;
  onColumn: (column: HTMLElement | null) => void;
  head?: React.ReactNode;
}): React.JSX.Element {
  const { panel, ...frame } = drawing;
  return (
    <>
      {head}
      {head === undefined ? <Toolbar measure /> : null}
      <TaskPage
        columnRef={onColumn}
        panelOpen={panel !== undefined}
        fullScreen={panel?.fullScreen === true}
        column={
          <>
            {head === undefined ? (
              <TaskTabsRow hidden={false}>
                <Toolbar start={TOOLBAR_INSET.COLUMN} look={TOOLBAR_LOOK.TABS} measure />
              </TaskTabsRow>
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

const TASK_TITLE_SKELETON = "50%";

function TaskTitleSkeleton(): React.JSX.Element {
  return <Skeleton width={TASK_TITLE_SKELETON} />;
}

function AgentColumn({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Fill as={FILL_ELEMENT.SECTION} className="desktop-agent">
      {children}
    </Fill>
  );
}

function CopyChord({ copy }: { copy: TasksControl["copy"] }): null {
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true
      ? copy.onPress
      : undefined,
  );
  return null;
}

function NewTabChord({ onNewTab }: { onNewTab: () => void }): null {
  useAppCommand(APP_COMMAND.NEW_TAB, onNewTab);
  return null;
}

const PHONE_THING = {
  [TASK_PANE.OVERVIEW]: "Task",
  [TASK_PANE.AGENT]: "Agent",
  [TASK_PANE.PANEL]: "Tab",
} as const satisfies Record<TaskPane, string>;

const DISCARD_DRAFT = "Discard draft";

function discardDraftItem(onSelect: () => void): MenuEntry {
  return { label: DISCARD_DRAFT, icon: <GLYPH.DELETE />, onSelect };
}

function DescriptionDocument({
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
  const [shownTab, setShownTab] = useState<ShownTab | undefined>(undefined);
  const [shownAgentTab, setShownAgentTab] = useState<ShownTab | undefined>(undefined);
  const phone = room === SHELL_ROOM.NARROW;
  const drawing = useSidePanelDrawing(tasks.sidePanel);
  const views = useTabViews();
  const inboxTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
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
  const descriptionsOn =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const commentsTaskId = tasks.shown && descriptionsOn ? tasks.activeTaskId : undefined;
  const comments = useDescriptionComments(
    useMemo(
      () => (commentsTaskId === undefined ? undefined : { taskId: commentsTaskId }),
      [commentsTaskId],
    ),
  );
  const commentAsk = tasks.commentReveal?.planId === inboxTaskId ? tasks.commentReveal : undefined;
  const commentsRead = comments?.read === true;
  const { onCommentRevealed } = tasks;
  useEffect(() => {
    if (commentAsk === undefined || inboxTaskId === undefined || !commentsRead) return;
    onCommentRevealed(commentAsk.ask);
  }, [commentAsk, inboxTaskId, commentsRead, onCommentRevealed]);
  const { onArea: setArea, focus, setFocus } = useColumnFocus();
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const [documentBox, setDocumentBox] = useState<HTMLElement | null>(null);
  const headingTask = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const columnHeld = useMemo(() => ({ current: column }), [column]);
  const documentHeld = useMemo(
    () => ({ current: headingTask === undefined ? null : documentBox }),
    [documentBox, headingTask],
  );
  const descriptionHeading = useHeadingAway(columnHeld, documentHeld);
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
  const now = useMinute();
  const { onOpen: onOpenAutomations } = tasks.automationsView;
  const openAutomation = useCallback(
    (automationId: string) => onOpenAutomations({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    [onOpenAutomations],
  );
  const taskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  const renaming = useMutation(tasks.renameTask);
  const rename = useInlineRename(taskId, renameWrite(renaming, TASK_RENAME_SHAPE));
  const [titleAsked, setTitleAsked] = useState(false);
  const [titleAsks, setTitleAsks] = useState(0);
  const descriptionShown = isOverviewTab(tasks.mainTabs.tab) && !tasks.sidePanel.fullScreen;
  const { onChoose: chooseColumnTab } = tasks.mainTabs;
  useEffect(() => {
    if (!titleAsked || !descriptionShown) return;
    setTitleAsked(false);
    setTitleAsks((count) => count + 1);
  }, [titleAsked, descriptionShown]);
  const showOverview = useSteadyDoor(() => {
    if (tasks.sidePanel.fullScreen) tasks.sidePanel.onToggleFullScreen();
    chooseColumnTab(MAIN_TAB.OVERVIEW);
  });
  const beginRename = useSteadyDoor(() => {
    if (room === SHELL_ROOM.NARROW) {
      rename.begin();
      return;
    }
    if (!descriptionShown) showOverview();
    setTitleAsked(true);
  });
  useOfferTaskRename(taskId, beginRename);
  const showSide = () => setFocus(COLUMN.SIDE);
  const terminalDoors = useAgentTerminalDoors(tasks.sidePanel, showSide);
  const [refusal, setRefusal] = useState<{ taskId: string; note: string } | undefined>(undefined);
  const opened = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  const listedOpen =
    opened === undefined
      ? undefined
      : (tasks.tasks.find((each) => each.id === opened.id) ?? opened);
  const stranded = useStrandedTaskBanner(tasks, listedOpen);
  const readMentionAgents = useMentionAgentsReader(
    opened?.workspaceId,
    tasks.tasks,
    tasks.agents.models,
  );
  const openMention = tasks.onShowMention;
  const revealed = tasks.sectionReveal;
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
  const workspace =
    opened === undefined ? undefined : taskLinkPlace(tasks.workspaces, opened).workspace;
  const openColumnTab = (opened: MainTab) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose(opened);
    setFocus(COLUMN.MAIN);
  };
  const openAgentColumn = (agent: string) => {
    if (agents.archived?.some((each) => each.id === agent) !== true) {
      openColumnTab({ agent });
      return;
    }
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    tasks.agentView.onOpen(agent);
    setFocus(COLUMN.MAIN);
  };
  const openOverview = () => openColumnTab(MAIN_TAB.OVERVIEW);
  const leaveDetails = () => {
    const { returnTab } = mainTabs;
    if (returnTab !== undefined) {
      openColumnTab(returnTab);
      return;
    }
    const [start] = newAgentStarts(mainTabs, agents);
    if (start !== undefined && start.disabled !== true) start.onSelect();
  };
  const toggleDetails = () =>
    tab !== undefined && isOverviewTab(tab) ? leaveDetails() : openOverview();
  const leaveDetailsDoor = useSteadyDoor(leaveDetails);
  const detailsLead = useMemo(
    () =>
      phone ? undefined : (
        <BackButton label={AGENTS_SECTION} place={DETAILS_WORDS.PLACE} onBack={leaveDetailsDoor} />
      ),
    [phone, leaveDetailsDoor],
  );
  const detailsOver = isOverviewTab(tab) && !phone;
  const panelWasOpen = useRef(sidePanel.open);
  useEffect(() => {
    const opened = sidePanel.open && !panelWasOpen.current;
    panelWasOpen.current = sidePanel.open;
    if (opened && detailsOver) leaveDetailsDoor();
  }, [sidePanel.open, detailsOver, leaveDetailsDoor]);
  const openPanelTab = (opened: SidePanelTab) => {
    sidePanel.onChoose(opened);
    showSide();
  };
  const openPlace = useOpenPlace();
  const openTarget = (target: ToolTarget, from?: string) => {
    switch (target.kind) {
      case TOOL_TARGET.AGENT:
        return openAgentColumn(target.agent);
      case TOOL_TARGET.DESCRIPTION:
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
        if (target.agent === undefined && target.task === taskId) return openOverview();
        return openPlace?.(placeOfTaskTarget(target));
    }
  };
  const openDelegation = (agent: string, callId: string, task: string, status: AgentStatus) => {
    views.onWorkerStatus(callId, status);
    sidePanel.onPreview({ subagent: callId, delegation: { agent, task } });
  };
  const openPullRequest = (agentId: string, number?: number) =>
    showPullRequest(sidePanel, agents, agentId, PULL_REQUEST_VIEW.CONVERSATION, number);
  const agentLook = (agentId: string) => {
    const subject = agentSubject(agents, agentId, views.held, false);
    if (subject.agent === undefined) return undefined;
    return { actor: subject.tile, card: <AgentCard subject={subject} models={agents.models} /> };
  };
  const agentPullRequests = agents.pullRequests;
  const changesPeople = useChangesPeopleOf(
    useMemo(() => [...agentPullRequests.keys()], [agentPullRequests]),
  );
  const pullRequestCard = (url: string) => {
    const owned = [...agents.pullRequests].map(([agentId, each]) => ({ agentId, url: each.url }));
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
      people: peopleOf(changesPeople.get(agentId), pullRequest),
      onOpenAgent: () => openAgentColumn(agentId),
    });
    return card ?? undefined;
  };
  const openTargetDoor = useSteadyDoor((target: ToolTarget) => openTarget(target, agentOfTab(tab)));
  const openDelegationDoor = useSteadyDoor(openDelegation);
  const openPullRequestDoor = useSteadyDoor(openPullRequest);
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
  const descriptionEdit = opened === undefined ? undefined : tasks.descriptionEdit(opened.id);
  const renameDoor = useSteadyDoor(
    (name: string): Promise<boolean> =>
      taskId === undefined
        ? Promise.resolve(true)
        : renaming.mutateAsync(TASK_RENAME_SHAPE.ask(taskId, name)).catch(() => false),
  );
  const titleRename = useMemo<TitleRename>(
    () => ({ asks: titleAsks, asked: rename.asked, onBegin: beginRename }),
    [titleAsks, rename.asked, beginRename],
  );
  const draftNameDoor = useSteadyDoor(
    opened === undefined
      ? undefined
      : (name: string | undefined) => tasks.onDraftName(opened.id, name),
  );
  const standingDoor = useStandingDoor(tasks);
  const setStanding = useSteadyDoor(
    opened === undefined ? undefined : (standing: TaskStanding) => standingDoor(opened, standing),
  );
  const openedId = opened?.id;
  const openedRepository = opened?.repository ?? null;
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
  const taskMenuHand = useRef<TaskMenuItems | undefined>(undefined);
  const descriptionMenu = useMemo<DocumentMenu>(
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
    if (menuRequest === undefined || descriptionShown) return;
    showOverview();
  }, [menuRequest, descriptionShown, showOverview]);
  const openRequest = descriptionShown ? menuRequest : undefined;
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
  const [answeredRelation, setAnsweredRelation] = useState(0);
  const relationPending =
    relationMenu !== undefined &&
    relationMenu.taskId === openedId &&
    relationMenu.request > answeredRelation
      ? relationMenu
      : undefined;
  const relationAsk = descriptionShown ? relationPending : undefined;
  useEffect(() => {
    if (relationPending === undefined || descriptionShown) return;
    showOverview();
  }, [relationPending, descriptionShown, showOverview]);
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
  const standing = useMemo<TaskStandingDoor>(
    () => ({
      workspaceName,
      onSet: setStanding,
      repository: repositoryDoor,
      tasks: blockTasks,
      onOpenTask: openTask,
      relations,
      inSight: descriptionShown,
    }),
    [workspaceName, setStanding, repositoryDoor, blockTasks, openTask, relations, descriptionShown],
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
  const planAgents = useMemo(
    () => (
      <PlanAgents
        agents={agents}
        held={views.held}
        tab={tab}
        folded={false}
        waiting={waitingOf}
        onOpenAgent={(agentId) => openAgentTab({ agent: agentId })}
        onOpenPullRequest={openPullRequestDoor}
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
  const descriptionHead = useCallback(
    (room: DescriptionRoom) => (
      <Fragment key={openedId}>
        {opened === undefined ? null : (
          <PlanRelations
            task={opened}
            tasks={tasks}
            door={relations}
            room={room}
            onOpenTask={openTask}
          />
        )}
        {planAgents}
      </Fragment>
    ),
    [openedId, opened, tasks, relations, openTask, planAgents],
  );
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
    const close = { label: "Close task", onClick: tasks.onLeaveTask };
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
  const columnComing =
    agents.agents === undefined ? !agents.listFailed : startsOwnAgents(agents.mode);
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  const terminalHere = agentOfTab(
    sideFocused && sidePanel.tab !== undefined ? sidePanel.tab : mainTabs.tab,
  );
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
  const overviewShown = isOverviewTab(tab);
  const detailsWide = overviewShown && !phone;
  const documentBody = (
    <Fill
      ref={setDocumentBox}
      as={FILL_ELEMENT.SECTION}
      className="desktop-document @container/description-document [&[hidden]]:hidden"
      role="tabpanel"
      aria-label={task.name}
      hidden={!overviewShown}
    >
      {detailsWide ? <div className="task-details-back">{detailsLead}</div> : null}
      <DescriptionBody
        task={task}
        reader={reader}
        agents={editAgents}
        onShowHistory={showHistory}
        edit={descriptionEdit}
        onRename={renameDoor}
        onDraftName={draftNameDoor}
        rename={titleRename}
        looks={looks}
        sectionLinks={sectionLinks}
        standing={standing}
        head={descriptionHead}
        titleActions={!phone}
        shown={overviewShown}
      />
    </Fill>
  );
  const pane = taskPaneOf({ open: sidePanel.open, column: tab });
  const openBrowser = (agentId: string) => {
    const newest = (agentBrowsers ?? [])
      .filter((each) => each.agentId === agentId)
      .toSorted((one, other) => other.createdAt - one.createdAt)[0];
    openPanelTab({
      cloudBrowser: newest?.id ?? startCloudDraft({ taskId: task.id }, agentId).id,
    });
  };
  const newAgentOnPhone = () => {
    const [start] = phoneAgentStarts(mainTabs, agents);
    if (start === undefined || start.disabled === true) return;
    if (sidePanel.open) sidePanel.onToggle();
    start.onSelect();
  };
  const planLabel = opened?.name.trim() || TAB_WORDS.OVERVIEW;
  const columnLabel =
    tab === undefined || isOverviewTab(tab) ? planLabel : mainTabLabel(tab, agents);
  const draftShown =
    pane === TASK_PANE.AGENT && tab !== undefined && isDraftTab(tab) ? tab : undefined;
  const back =
    pane === TASK_PANE.OVERVIEW
      ? away
      : pane === TASK_PANE.PANEL
        ? screenBack(columnLabel ?? planLabel, sidePanel.onToggle)
        : screenBack(planLabel, () => mainTabs.onChoose(MAIN_TAB.OVERVIEW));
  const shownGroups = (opener: HTMLElement): readonly (readonly MenuEntry[])[] =>
    pane === TASK_PANE.OVERVIEW
      ? descriptionMenu.groups()
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
      title={
        rename.editing
          ? (rename.asked ?? task.name)
          : pane === TASK_PANE.PANEL
            ? shownTab?.label
            : pane === TASK_PANE.AGENT
              ? columnLabel
              : undefined
      }
      pickUp={{ name: descriptionHeading.name, shown: descriptionHeading.away }}
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
          ends={() => (pane === TASK_PANE.OVERVIEW ? descriptionMenu : undefined)}
        />
      }
    />
  ) : null;
  return (
    <LinkWorkspaceProvider value={workspace}>
      <DescriptionCommentsProvider value={comments}>
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
                  <TaskActions
                    key={task.id}
                    tasks={tasks}
                    task={task}
                    onRename={beginRename}
                    hand={taskMenuHand}
                  />
                  {head}
                  <div className={phone ? "task-topbar" : "task-topbar contents"} hidden={phone}>
                    <TaskTopbar
                      task={listed}
                      details={
                        phone ? undefined : { shown: overviewShown, onToggle: toggleDetails }
                      }
                      descriptionMenu={phone ? undefined : descriptionMenu}
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
                  <TaskPage
                    areaRef={setArea}
                    columnRef={setColumn}
                    panelOpen={sidePanel.open && !detailsWide}
                    fullScreen={sidePanel.fullScreen}
                    barless={detailsWide}
                    column={
                      <>
                        <TaskTabsRow hidden={phone || detailsWide}>
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
                            onOpenLocal={terminalDoors.onOpenLocal}
                            onOpenBrowser={phone ? openBrowser : undefined}
                            onShown={phone ? setShownAgentTab : undefined}
                            waiting={waitingOf}
                          />
                        </TaskTabsRow>
                        {sidePanel.fullScreen ? null : stranded.banner}
                        <TaskBody>
                          <FindScope
                            className="desktop-task-column"
                            active={tasks.shown && !sideFocused}
                            subject={{ task: task.id, tab: tab ?? MAIN_TAB.OVERVIEW }}
                          >
                            {documentBody}
                            {tab === undefined || isOverviewTab(tab) ? (
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
      </DescriptionCommentsProvider>
    </LinkWorkspaceProvider>
  );
}

function StartingTaskPage({
  tasks,
  starting,
  summary,
  phoneAway,
}: {
  tasks: TasksControl;
  starting: StartingTask;
  summary: SummaryPin;
  phoneAway: TaskHeadBack | undefined;
}): React.JSX.Element {
  const drawing = { ...useSidePanelDrawing(tasks.sidePanel), panel: undefined };
  const [column, setColumn] = useState<HTMLElement | null>(null);
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
  accountName?: string | undefined;
  staged?: boolean;
  looks: TaskLooks;
  summary: SummaryPin;
  room?: ShellRoom;
  away?: TaskHeadBack | undefined;
}): React.JSX.Element {
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
          onOpen={(skill) => tasks.sidePanel.onOpenFile({ path: skill.path })}
        >
          <DescriptionDocument
            tasks={tasks}
            looks={looks}
            summary={summary}
            room={room}
            away={away ?? { label: HOME_BACK, onPress: tasks.onGoHome }}
          />
        </SkillFiles>
      );
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
