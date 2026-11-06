import { AGENT_CALL_FAILURE, type AgentInboxMessagedView } from "@repo/features/agent-view";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import {
  encodeMention,
  MENTION_KIND,
  type MentionLines,
  type DescriptionMention,
} from "@repo/features/mention-link";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { CodeRef } from "@repo/features/task-wire";
import { backToWords, readFailedWords } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { ERROR_STATE_PLACEMENT, ErrorState, Toolbar } from "@repo/ui";
import { isAgentTab, isTranscriptTab, type StripTab, sameTab } from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { ADDRESS, type Address, addressOf, HERE, ROUTE, route, THING } from "../route.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { agentName, messageFailureWords } from "../tasks/agent-model.js";
import type { InboxCodeDoors } from "../tasks/inbox-code-card.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, InboxPaneEmpty, NOTHING_HERE } from "../tasks/inbox-list.js";
import {
  anyUnread,
  holderAutomationId,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  itemWorkspaceId,
} from "../tasks/inbox-model.js";
import { useInboxPager } from "../tasks/inbox-pager.js";
import { type InboxNewThread, InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import {
  heldTaskMentions,
  type TasklessPlace,
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
  useSavedDescriptionText,
} from "../tasks/task-mentions.js";
import {
  cardTitle,
  placeOfTaskTarget,
  TOOL_TARGET,
  type ToolTarget,
} from "../tasks/tool-call-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { useInboxItemOpenSpan, useInboxOpenSpan } from "../tasks/use-inbox-spans.js";
import { leaveInboxTask, openTaskThread, useInboxTask } from "../tasks/use-inbox-task.js";
import { OpenAddressesHere, type OpenAddressHere, placeOfMention } from "../tasks/use-open-link.js";
import {
  type FileReads,
  PULL_REQUEST_VIEW,
  type SidePanelControl,
} from "../tasks/use-side-panel.js";
import { type HeldTaskInboxControl, useInboxCardDrafts } from "../tasks/use-task-inbox.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { AgentPane } from "./main-tabs.js";
import {
  COLUMN,
  changesTabOf,
  type PanelRepositoryPlace,
  SIDE_PANEL_HOLDER,
  SidePanel,
  type SidePanelDrawing,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { type TabViews, useTabViews } from "./strip-tabs.js";
import { taskCardOf } from "./task-card.js";

const ITEM_NOT_READ = readFailedWords("this item");

const BACK_TO_INBOX = backToWords("inbox");

const _nothing = (): void => undefined;

const NO_UNREAD: readonly StripTab[] = [];

const NO_OPEN_AGENTS: readonly string[] = [];

function useHeldWhile<Drawn>(holding: boolean, drawn: Drawn): Drawn {
  const held = useRef(drawn);
  const shown = holding ? held.current : drawn;
  useLayoutEffect(() => {
    held.current = shown;
  });
  return shown;
}

export const DesktopInbox = memo(function DesktopInbox({
  tasks,
  room = SHELL_ROOM.WIDE,
  phoneStart = null,
}: {
  tasks: TasksControl;
  room?: ShellRoom;
  phoneStart?: React.ReactNode;
}): React.JSX.Element {
  const newTask = tasks.signedIn ? tasks.onNewTask : undefined;
  const narrowedTask = useInboxTask();
  const narrowedTaskRow = tasks.tasks.find((task) => task.id === narrowedTask);
  const narrowedTaskName = narrowedTaskRow?.name;
  const {
    view,
    choices,
    openAutomation,
    failed,
    asked,
    settling,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    liveScope,
    named,
    marks,
    standing,
    counts,
    list,
    listedRows,
    steps,
    onPointing,
    chosen,
    filteredOut,
    search,
    searched,
    missing,
    chosenFailed,
    onRetryChosen,
    reading,
    choose,
    clear,
    closeItem,
    onRetry,
  } = useInboxListing(tasks, narrowedTask);
  const unread = useMemo(() => anyUnread(standing), [standing]);
  const { onMarkAll, onMarkEach } = marks;
  const markAll = () =>
    (narrowedTask === undefined ? onMarkAll : onMarkEach)(standing.flatMap(({ items }) => items));
  useAppCommand(APP_COMMAND.MARK_INBOX_READ, tasks.shown && unread ? markAll : undefined);
  const phone = room === SHELL_ROOM.NARROW;
  const { onSingle } = view;
  const columns = useInboxColumns(
    chosen?.item.id ?? (missing || chosenFailed ? asked?.itemId : undefined),
    { onClear: clear, onSingle },
  );
  const timeOpen = useInboxItemOpenSpan(chosen?.item.id, live.read);
  useInboxOpenSpan(listedRows.length);
  const open = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const { onMark: markItem } = marks;
  const step = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onStep();
  };
  const pager = useInboxPager(steps, list, chosen?.item.id, step, { shown: tasks.shown });
  const place = chosen === undefined ? undefined : answerPlace(chosen, agents, tasks);
  const chosenWorkspaceId =
    chosen === undefined
      ? undefined
      : chosen.holder.kind === INBOX_HOLDER.TASK
        ? chosen.holder.task.workspaceId
        : (agents.workspaceId ?? itemWorkspaceId(chosen.holder));
  const chosenLinkWorkspace =
    chosenWorkspaceId === undefined
      ? (tasks.workspace?.slug ?? tasks.workspace?.id)
      : (tasks.workspaces.find((each) => each.id === chosenWorkspaceId)?.slug ?? chosenWorkspaceId);
  const readMentionAgents = useMentionAgentsReader(place?.workspaceId, tasks.tasks, named.models);
  const { startInboxThread } = agents;
  const newThread: InboxNewThread | undefined = tasks.signedIn
    ? {
        onStart: (item, start) =>
          startInboxThread({
            agentId: item.agentId,
            text: start.text,
            ...(start.attachments.length === 0 ? undefined : { attachments: start.attachments }),
            clientKey: start.clientKey,
          })
            .catch(
              (): AgentInboxMessagedView => ({
                failure: AGENT_CALL_FAILURE.UNANSWERED,
              }),
            )
            .then((answer) => {
              if ("failure" in answer) return messageFailureWords(answer.failure);
              const holder = chosen?.item.id === item.id ? chosen.holder : undefined;
              view.onChoose({
                ...(holder?.kind === INBOX_HOLDER.TASK
                  ? { taskId: holder.task.id }
                  : { agentId: item.agentId }),
                itemId: answer.item.id,
                opened: true,
              });
              return undefined;
            }),
      }
    : undefined;
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  const openFile = (ref: CodeRef, commit: string | undefined) =>
    sidePanel.onPreviewFile(
      ref,
      commit,
      chosen?.holder.kind === INBOX_HOLDER.TASK ? undefined : repositoryReads(place),
    );
  const openMentionedFile = (path: string, lines: MentionLines | undefined) =>
    openFile(fileRef(path, lines), lines?.commit);
  const { heldIds } = agents;
  const openHere: OpenAddressHere = (address) => {
    const routed = route(address, {
      kind: HERE.INBOX_ITEM,
      taskId,
      agentId: taskId === undefined ? chosenAgentId : undefined,
      repository:
        taskId === undefined ? (place?.repository ?? null) : (chosenTask?.repository ?? null),
      pullRequests: named.pullRequests,
      agentIds: named.agentIds,
      heldIds,
    });
    if (routed.kind === ROUTE.GO) {
      const { place: at } = routed.link;
      if (at.kind !== LINK_PLACE.AGENT || at.planId === undefined) return false;
      tasks.onShowAgent(at.planId, at.agentId);
      return true;
    }
    if (routed.kind !== ROUTE.PREVIEW) return false;
    const { thing } = routed;
    switch (thing.kind) {
      case THING.FILE: {
        const ref = fileRef(thing.path, thing.lines);
        if (thing.repository === undefined) {
          openFile(ref, thing.lines?.commit);
          return true;
        }
        if (place === undefined) return false;
        const { repository } = thing;
        const reads = { place: { workspaceId: place.workspaceId, repository }, repository };
        sidePanel.onPreviewFile(ref, thing.lines?.commit, reads);
        return true;
      }
      case THING.PAGE:
        sidePanel.onPreview({ page: thing.pageId }, thing.place);
        return true;
      case THING.CHANGES:
        sidePanel.onPreview({ changes: thing.agentId });
        return true;
      case THING.TRANSCRIPT:
        sidePanel.onPreview({ transcript: thing.agentId });
        if (thing.messageId !== undefined) {
          tasks.onRevealMessage({
            kind: LINK_PLACE.MESSAGE,
            agentId: thing.agentId,
            messageId: thing.messageId,
          });
        }
        return true;
      case THING.PULL_REQUEST:
        showPullRequest(
          sidePanel,
          named,
          thing.agentId,
          PULL_REQUEST_VIEW.CONVERSATION,
          thing.number,
        );
        return true;
      case THING.THREAD: {
        const tab = changesTabOf(named, thing.agentId, sidePanel.changes);
        sidePanel.onPullRequestView(tab, thing.view);
        sidePanel.onPreview(tab);
        tasks.onRevealThread(tab.changes, {
          kind: LINK_PLACE.PULL_REQUEST_THREAD,
          agentId: thing.agentId,
          threadId: thing.threadId,
          view: thing.view,
        });
        return true;
      }
      case THING.INBOX_ITEM: {
        const { itemId, taskId: holder, agentId } = thing;
        const listed =
          holder === undefined ||
          holder === taskId ||
          tasks.tasks.some((each) => each.id === holder);
        if (!listed) return false;
        const choice: InboxChoice | undefined =
          holder !== undefined
            ? {
                taskId: holder,
                ...(agentId === undefined ? undefined : { itemAgentId: agentId }),
                itemId,
                opened: true,
              }
            : agentId === undefined
              ? undefined
              : { agentId, itemId, opened: true };
        if (choice === undefined) return false;
        openTaskThread(holder);
        view.onChoose(choice);
        return true;
      }
      case THING.WORKER:
        return false;
    }
  };
  const openPlaceHere = (at: LinkPlace, elsewhere: () => void) => {
    const address: Address = { kind: ADDRESS.PLACE, link: { workspace: "", place: at } };
    if (!openHere(address)) elsewhere();
  };
  const openMention = (mention: DescriptionMention) =>
    openPlaceHere(placeOfMention(mention), () => tasks.onShowMention(mention));
  const heldTask = chosen?.holder.kind === INBOX_HOLDER.TASK ? chosen.holder.task : undefined;
  const descriptionText = useSavedDescriptionText(heldTask);
  const mentions =
    place === undefined
      ? undefined
      : heldTask === undefined
        ? tasklessMentions(place, openMention, readMentionAgents, {
            onOpenFile: openMentionedFile,
          })
        : heldTaskMentions(
            heldTask,
            place.workspace,
            descriptionText,
            { pages: view.pages, agents: named, readAgents: readMentionAgents },
            { onOpenTask: openMention, onOpenFile: openMentionedFile },
          );
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  const opened =
    tasks.shown && !sidePanel.fullScreen && columns.shown !== INBOX_COLUMNS.LIST
      ? chosen
      : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: tasks.shown && !sideFocused,
    onMark: markItem,
  });
  const panelAgent =
    sideFocused && sidePanel.tab !== undefined && isTranscriptTab(sidePanel.tab)
      ? sidePanel.tab.transcript
      : undefined;
  const openInTask = (): (() => void) | undefined => {
    if (!tasks.shown) return undefined;
    if (panelAgent !== undefined && taskId !== undefined) {
      return () => tasks.onShowAgent(taskId, panelAgent);
    }
    if (opened === undefined) return undefined;
    const { holder, item } = opened;
    return holder.kind === INBOX_HOLDER.TASK
      ? () => tasks.onShowTask(holder.task.id)
      : () => tasks.agentView.onOpen(item.agentId);
  };
  useAppCommand(APP_COMMAND.OPEN_IN_TASK, openInTask());
  const panelFor = taskId ?? chosenAgentId;
  const { pages } = view;
  const { onTaskAgents } = view;
  const taskAgents = agents.agents;
  useEffect(() => {
    if (taskId === undefined || taskAgents === undefined) return;
    onTaskAgents(
      taskId,
      taskAgents.map((agent) => agent.id),
      heldIds,
    );
  }, [taskId, taskAgents, heldIds, onTaskAgents]);
  const itemPane = (listed: InboxListed) => (
    <OpenAddressesHere value={openHere}>
      <SkillFiles
        source={agents.readSkills}
        onOpen={(skill) => {
          if (place === undefined) return;
          const url = encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, place);
          if (!openHere(addressOf(url))) appPlatform().openGitHub(url);
        }}
      >
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          <TaskMentions value={mentions}>
            <DraftedInboxPane
              holder={listed.holder}
              item={listed.item}
              control={live}
              scope={liveScope}
              opened={opened}
              readerId={tasks.me}
              agents={named}
              hidden={columns.shown === INBOX_COLUMNS.LIST}
              onBack={columns.onBack}
              pager={columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined}
              mentions={mentions}
              newThread={newThread}
              phone={
                phone
                  ? {
                      onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle,
                      narrowedTask:
                        narrowedTask === undefined ? undefined : (narrowedTaskName ?? "Task"),
                    }
                  : undefined
              }
              doors={{
                ...paneDoors(tasks, listed.holder, {
                  panelFor,
                  place,
                  openPlace: openPlaceHere,
                }),
                onMark: markItem,
                onClose: closeItem,
                onRemind: marks.onRemind,
              }}
            />
          </TaskMentions>
        </LinkWorkspaceProvider>
      </SkillFiles>
    </OpenAddressesHere>
  );
  const heldPanel = useHeldWhile(
    settling,
    drawing.panel !== undefined || sidePanel.toggleAsked ? (
      <OpenAddressesHere value={openHere}>
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          <InboxSidePanel
            tasks={tasks}
            openPlace={openPlaceHere}
            drawing={{ ...drawing, panel: drawing.panel ?? sidePanel }}
            focused={sideFocused}
            taskId={taskId}
            panelFor={panelFor}
            repository={
              chosenTask?.repository ?? place?.repository ?? agents.agentRepository ?? null
            }
            repositoryPlace={
              taskId === undefined && place !== undefined && place.repository !== null
                ? { workspaceId: place.workspaceId, repository: place.repository }
                : undefined
            }
            pages={pages}
            agents={named}
            views={views}
            mentions={mentions}
            phone={
              room === SHELL_ROOM.NARROW && chosen !== undefined
                ? { back: cardTitle(chosen.item.title), onBack: sidePanel.onToggle }
                : undefined
            }
          />
        </LinkWorkspaceProvider>
      </OpenAddressesHere>
    ) : null,
  );
  return (
    <LinkWorkspaceProvider value={listedWorkspace?.slug ?? listedWorkspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationDirectory workspace={tasks.workspace} wanted onOpen={openAutomation}>
          <div
            ref={onArea}
            className="desktop-task relative flex min-h-0 flex-1"
            data-panel-open={String(sidePanel.open)}
            data-page="inbox"
          >
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className={INBOX_VIEW} ref={columns.ref} data-columns={columns.shown}>
                <InboxList
                  view={list}
                  chosen={chosen?.item.id}
                  columns={columns.shown}
                  rows={columns.rows}
                  head={{
                    shown: tasks.shown,
                    view: narrowedTask === undefined ? choices : undefined,
                    search,
                    phone:
                      room === SHELL_ROOM.NARROW
                        ? {
                            start: phoneStart,
                            readAll: { unread, onMarkAll: markAll },
                          }
                        : undefined,
                    readAll:
                      room === SHELL_ROOM.NARROW || narrowedTask !== undefined
                        ? undefined
                        : { unread, onMarkAll: markAll },
                    task:
                      narrowedTask === undefined
                        ? undefined
                        : {
                            name: narrowedTaskName,
                            status: narrowedTaskRow?.status,
                            onClear: leaveInboxTask,
                          },
                  }}
                  models={named.models}
                  readerId={tasks.me}
                  reading={reading}
                  note={
                    <InboxListNote
                      failed={failed}
                      reading={reading}
                      empty={listedRows.length === 0}
                      alone={columns.shown === INBOX_COLUMNS.LIST}
                      filteredOut={filteredOut ? choices : undefined}
                      counts={counts}
                      onList={columns.onList}
                      onRetry={onRetry}
                      searched={searched}
                      onNewTask={newTask}
                      none={narrowedTask === undefined ? undefined : NOTHING_HERE}
                    />
                  }
                  onChoose={open}
                  onMark={(listed, unread, saying) => markItem(listed.item, unread, saying)}
                  onClose={closeItem}
                  onRemind={marks.onRemind}
                  onPointing={onPointing}
                />
                {chosen === undefined ? (
                  <section
                    className={INBOX_VIEW_ITEMS}
                    hidden={
                      missing || chosenFailed
                        ? columns.shown === INBOX_COLUMNS.LIST
                        : columns.shown !== INBOX_COLUMNS.BOTH
                    }
                  >
                    <Toolbar />
                    {missing ? (
                      <NotFound
                        thing={NOT_FOUND_THING.INBOX_ITEM}
                        action={
                          columns.onBack === undefined
                            ? undefined
                            : { label: BACK_TO_INBOX, onClick: columns.onBack }
                        }
                      />
                    ) : chosenFailed ? (
                      <ErrorState
                        failure={unreadShown(FAILURE_SURFACE.INBOX_ITEM_READ)}
                        placement={ERROR_STATE_PLACEMENT.CENTERED}
                        onRetry={onRetryChosen}
                      >
                        {ITEM_NOT_READ}
                      </ErrorState>
                    ) : failed || reading || filteredOut || searched !== undefined ? null : (
                      <InboxPaneEmpty
                        listed={listedRows.length}
                        newTask={newTask}
                        none={narrowedTask === undefined ? undefined : NOTHING_HERE}
                      />
                    )}
                  </section>
                ) : (
                  itemPane(chosen)
                )}
              </div>
            </PageFind>
            {heldPanel}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});

function DraftedInboxPane({
  control,
  scope,
  opened,
  readerId,
  ...pane
}: Omit<React.ComponentProps<typeof InboxPane>, "control"> & {
  control: HeldTaskInboxControl;
  scope: Parameters<typeof useInboxCardDrafts>[1];
  opened: InboxListed | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const live = { ...control, ...useInboxCardDrafts(control, scope) };
  useNodOnOpen({ shown: opened, readerId, control: live });
  return <InboxPane {...pane} control={live} />;
}

function fileRef(path: string, lines: MentionLines | undefined): CodeRef {
  return lines === undefined
    ? { path }
    : { path, startLine: lines.startLine, endLine: lines.endLine };
}

function answerPlace(
  chosen: InboxListed,
  agents: AgentsControl,
  tasks: TasksControl,
): TasklessPlace | undefined {
  const { holder } = chosen;
  const workspaceId =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.workspaceId
      : (agents.workspaceId ?? itemWorkspaceId(holder));
  const repository =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.repository
      : (agents.agentRepository ?? holder.agent.repository);
  if (workspaceId === undefined || repository === undefined || repository === null) {
    return undefined;
  }
  const workspace = tasks.workspaces.find((each) => each.id === workspaceId)?.slug ?? workspaceId;
  return { workspace, workspaceId, repository };
}

function InboxSidePanel({
  tasks,
  openPlace,
  drawing,
  focused,
  taskId,
  panelFor,
  repository,
  repositoryPlace,
  pages,
  agents,
  views,
  mentions,
  phone,
}: {
  tasks: TasksControl;
  openPlace: (place: LinkPlace, elsewhere: () => void) => void;
  drawing: SidePanelDrawing & { panel: SidePanelControl };
  focused: boolean;
  taskId: string | undefined;
  panelFor: string | undefined;
  repository: string | null;
  repositoryPlace: PanelRepositoryPlace | undefined;
  pages: TasksControl["inboxView"]["pages"];
  agents: AgentsControl;
  views: TabViews;
  mentions: TaskMentionsValue | undefined;
  phone: { readonly back: string; readonly onBack: () => void } | undefined;
}): React.JSX.Element {
  const { panel } = drawing;
  const terminals =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.TERMINALS) }).data ===
    true;
  const openTarget = (target: ToolTarget) => {
    switch (target.kind) {
      case TOOL_TARGET.PAGE:
        return panel.onPreview({ page: target.page });
      case TOOL_TARGET.TASK:
        return openPlace(placeOfTaskTarget(target), () =>
          target.agent === undefined
            ? tasks.onShowTask(target.task)
            : tasks.onShowAgent(target.task, target.agent),
        );
      case TOOL_TARGET.AGENT: {
        const { agent } = target;
        return taskId === undefined
          ? openPlace({ kind: LINK_PLACE.AGENT, agentId: agent }, () =>
              tasks.agentView.onOpen(agent),
            )
          : openPlace({ kind: LINK_PLACE.AGENT, planId: taskId, agentId: agent }, () =>
              tasks.onShowAgent(taskId, agent),
            );
      }
      case TOOL_TARGET.DESCRIPTION:
        if (taskId === undefined) return;
        return openPlace({ kind: LINK_PLACE.TASK, planId: taskId }, () => tasks.onShowTask(taskId));
      case TOOL_TARGET.INBOX:
      case TOOL_TARGET.PULL_REQUEST:
        return;
    }
  };
  const listedTask =
    taskId === undefined ? undefined : tasks.tasks.find((each) => each.id === taskId);
  const cards = taskCards({
    agents,
    held: views.held,
    chosen: (opened) =>
      isAgentTab(opened) && panel.tab !== undefined && isTranscriptTab(panel.tab)
        ? panel.tab.transcript === opened.agent
        : panel.tab !== undefined && sameTab(opened, panel.tab),
    pages: taskId === undefined ? undefined : { taskId },
    task:
      listedTask === undefined
        ? undefined
        : {
            name: listedTask.name,
            status: listedTask.status,
            card: taskCardOf(tasks, listedTask, undefined),
          },
  });
  const transcript = (agentId: string) => {
    const agent = agents.agents?.find((each) => each.id === agentId);
    return (
      <TaskMentions value={mentions}>
        <AgentPane
          label={agent === undefined ? undefined : agentName(agent, agents.models)}
          tabbed={false}
          tab={{ agent: agentId }}
          agents={agents}
          shown={tasks.shown}
          views={views}
          onOpenDelegation={(agent, callId, _task, status) => {
            views.onWorkerStatus(callId, status);
            if (taskId !== undefined) tasks.onShowAgent(taskId, agent);
          }}
          onOpenPullRequest={(agent) =>
            showPullRequest(panel, agents, agent, PULL_REQUEST_VIEW.CONVERSATION)
          }
          onOpenTarget={openTarget}
          cards={cards}
        />
      </TaskMentions>
    );
  };
  return (
    <SidePanel
      {...drawing}
      unread={NO_UNREAD}
      holder={SIDE_PANEL_HOLDER.INBOX}
      taskId={panelFor ?? ""}
      onAgent={taskId === undefined && panelFor !== undefined}
      repository={repository}
      repositoryPlace={repositoryPlace}
      pages={pages}
      agents={agents}
      openAgents={NO_OPEN_AGENTS}
      shownAgent={undefined}
      views={views}
      shown={tasks.shown}
      focused={focused}
      onOpenTarget={openTarget}
      transcript={taskId === undefined ? undefined : transcript}
      transcriptDoors={
        taskId === undefined
          ? undefined
          : {
              onOpenInTask: (agentId) => tasks.onShowAgent(taskId, agentId),
              onOpenTerminal: terminals
                ? (agentId) => tasks.onShowPanelTab(taskId, { terminal: agentId })
                : undefined,
            }
      }
      phone={phone}
      taskOfTab={tasks}
    />
  );
}

function tasklessCode(tasks: TasksControl, place: TasklessPlace | undefined): InboxCodeDoors {
  if (place === undefined || place.repository === null) {
    return { repository: null, place: undefined, onOpenFile: () => undefined };
  }
  const { workspaceId, repository } = place;
  return {
    repository,
    place: { workspaceId, repository },
    onOpenFile: (ref, commit) => tasks.sidePanel.onPreviewFile(ref, commit, repositoryReads(place)),
  };
}

function repositoryReads(place: TasklessPlace | undefined): FileReads | undefined {
  if (place === undefined || place.repository === null) return undefined;
  const { workspaceId, repository } = place;
  return { place: { workspaceId, repository }, repository };
}

function paneDoors(
  tasks: TasksControl,
  holder: InboxHolder,
  seams: {
    panelFor: string | undefined;
    openPlace: (place: LinkPlace, elsewhere: () => void) => void;
    place: TasklessPlace | undefined;
  },
): InboxPaneDoors {
  if (holder.kind === INBOX_HOLDER.TASK) {
    const { task } = holder;
    const openAgent = (taskId: string, agentId: string) =>
      seams.openPlace({ kind: LINK_PLACE.AGENT, planId: taskId, agentId }, () =>
        tasks.onShowAgent(taskId, agentId),
      );
    const openTask = (taskId: string) =>
      seams.openPlace({ kind: LINK_PLACE.TASK, planId: taskId }, () => tasks.onSelect(taskId));
    return {
      onOpenHolder: () => tasks.onShowTask(task.id),
      taskCard: taskCardOf(
        { ...tasks, onShowAgent: openAgent, onSelect: openTask },
        task,
        undefined,
      ),
      onOpenAgent: (agentId) => openAgent(task.id, agentId),
      code: {
        repository: task.repository,
        place: { taskId: task.id },
        onOpenFile: (ref, commit) =>
          seams.panelFor === task.id
            ? tasks.sidePanel.onPreviewFile(ref, commit)
            : tasks.onShowFile(task.id, ref, commit),
      },
    };
  }
  const automationId = holderAutomationId(holder);
  return {
    onOpenHolder:
      automationId !== null
        ? () => tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    taskCard: undefined,
    onOpenAgent: (agentId) =>
      seams.openPlace({ kind: LINK_PLACE.AGENT, agentId }, () => tasks.agentView.onOpen(agentId)),
    code: tasklessCode(tasks, seams.place),
  };
}
