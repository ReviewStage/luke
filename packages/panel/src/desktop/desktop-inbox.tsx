import type { ChannelThread } from "@luke/features/channel-wire";
import { encodeMention, MENTION_KIND, type MentionLines } from "@luke/features/mention-link";
import type { CodeRef } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import { backToWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  NOTE_LINE_LOOK,
  NoteLine,
  Toolbar,
  useMinute,
} from "@luke/ui";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "@luke/ui/inbox-panel-link";
import { isAgentTab, isTranscriptTab, type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { useEffect, useRef } from "react";
import type { useAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { pressedWithCommand } from "../press-intent.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ChannelList } from "../tasks/channel-list.js";
import { ChannelStream } from "../tasks/channel-stream.js";
import { shownChannel } from "../tasks/channels-model.js";
import { agentName } from "../tasks/coding-agent-model.js";
import { INBOX_VIEW_ITEMS } from "../tasks/inbox-columns.js";
import {
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  itemWorkspaceId,
} from "../tasks/inbox-model.js";
import { InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import {
  type TasklessPlace,
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { cardTitle, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import { useChannelPlace, useChannels } from "../tasks/use-channels.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { choiceOf, useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { type OpenHere, OpenHereProvider } from "../tasks/use-open-link.js";
import { PULL_REQUEST_VIEW, type SidePanelControl } from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAgentCallDoors } from "./agent-actions.js";
import { AgentPane } from "./main-tabs.js";
import {
  COLUMN,
  changesTabOf,
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

/**
 * desktop-inbox.tsx -- the window's Channels: a channel's stream in the task's place, the thread opened from it read beside it.
 *
 * It stands in the task's place beside the sidebar, whose channel's row is
 * marked while it does. The stream (`channel-stream.tsx`) shows the channel
 * the sidebar chose, else #general, its threads as posts; a press on a post
 * opens its thread beside the stream in the thread pane (`inbox-pane.tsx`),
 * answered in place on its task's own held read, and × closes it. A link
 * or a notification that asks for an item opens it as a thread beside the
 * channel shown. The pane's crumbs open the task or the agent's tab,
 * leaving Channels; what the thread opens that a task's side panel draws
 * opens in that panel beside it instead, standing for the thread's task
 * (`use-tasks-tab.ts`): a code block's Open its file, and a link naming a
 * file of the task's repository, one of its pages, or one of its agents'
 * pull requests (`inbox-panel-link.ts`). The panel's toggle, its width, and
 * its keys are a task's own, and ⌘F finds in the panel while it holds the
 * keys, as on a task. Escape never leaves it, a stray press being no reason
 * to lose the thread being read; any row of the sidebar does, and so does
 * Back. A phone shows one thing at a time across the screen: the list of
 * channels its bar opens, a channel's stream, or a thread in place of the
 * stream. Everything in it that names a person, an answer and an agent's
 * starter, reads them against the listed workspace's members
 * (`member-directory.tsx`). The thread's box mentions what its repository
 * and workspace hold (`answerPlace`), and its skills are read through its
 * holder and drawn as chips that open their `SKILL.md` in the panel beside
 * it, as a file the thread names opens, or on GitHub where it has no plan
 * whose panel could open it. Its threads' holders are read by
 * `use-inbox-listing.ts`.
 */

/** The page's grid: the stream alone, or the stream and its thread beside it. */
const CHANNELS_VIEW =
  "inbox-view channels-view @container grid min-h-0 flex-1 grid-cols-single data-[thread]:grid-cols-channel-thread [&>[hidden]]:hidden";

/** What the page says while the workspace's channels are read, where none could be, and where none stand. */
const CHANNELS_READING = "Reading channels…";
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";
const CHANNELS_NONE = "This workspace has no channels yet.";

/** What leads back to the stream from a missing thread's notice. */
const BACK_TO_CHANNEL = backToWords("channel");

/** A taskless item's code reads no file, there being no task whose repository it reads through. */
const UNREAD_FILE = (): Promise<TasksFileAnswer> =>
  Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });

/** No tab of the thread's panel is drawn in semibold: what arrives on a task arrives on its page. */
const NO_UNREAD: readonly StripTab[] = [];

/** No agent's tab stands open beside Channels, so no worker's tab stands in its panel. */
const NO_OPEN_AGENTS: readonly string[] = [];

/** The window's Channels, in the task's place: a channel's stream, and the thread opened from it beside it. */
export function DesktopInbox({
  tasks,
  room = SHELL_ROOM.WIDE,
}: {
  tasks: TasksControl;
  /** The room the stage gives; narrow, a phone's, it shows one thing at a time across the screen. */
  room?: ShellRoom;
}): React.JSX.Element {
  const {
    view,
    act,
    openAutomation,
    asked,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    named,
    marks,
    standing,
    chosen,
    missing,
    closeItem,
  } = useInboxListing(tasks);
  const now = useMinute();
  const channelPlace = useChannelPlace();
  const channels = useChannels(tasks.workspace?.id, tasks.shown);
  const channel = shownChannel(channels.channels ?? [], channelPlace.channelId);
  // Note that a phone shows one thing at a time across the screen: the list of channels its bar opens, a channel's stream, or a thread in place of the stream.
  const phone = room === SHELL_ROOM.NARROW;
  // A phone's list of channels stands while the list is asked for, as the bar's Channels asks, so the window's Back returns to it from a stream.
  const channelsListed = phone && view.listed;
  const { onListed } = view;
  // A thread stands beside the stream only while the item chosen is the one opened, so a choice history went back past shows the stream alone.
  const threadAsked =
    channel !== undefined &&
    asked !== undefined &&
    channelPlace.threadId === asked.itemId &&
    !channelsListed;
  const threadShown = threadAsked && chosen !== undefined;
  // Note that an item a link asked for that no read holds stands as a notice in the thread's place, so the reader is told it is gone.
  const goneShown = threadAsked && chosen === undefined && missing;
  const threadBeside = (threadShown || goneShown) && !phone;
  // A choice that asks for its item, as a link or a notification does, opens it as a thread beside the channel shown, once.
  const { onOpenThread } = channelPlace;
  const taken = useRef<InboxChoice | undefined>(undefined);
  useEffect(() => {
    if (asked?.opened !== true || taken.current === asked) return;
    taken.current = asked;
    onOpenThread(asked.itemId);
  }, [asked, onOpenThread]);
  const { onMark: markItem } = marks;
  // Where the chosen item's words are read: its plan's workspace and repository, or, with no plan, its agent's own.
  const place = chosen === undefined ? undefined : answerPlace(chosen, agents, tasks);
  // Where the chosen item's links are written: under its own workspace, by slug once the workspaces are read.
  const chosenWorkspaceId =
    chosen === undefined
      ? undefined
      : chosen.holder.kind === INBOX_HOLDER.TASK
        ? chosen.holder.task.workspaceId
        : (agents.workspaceId ?? itemWorkspaceId(chosen.holder, chosen.item.agentId));
  const chosenLinkWorkspace =
    chosenWorkspaceId === undefined
      ? (tasks.workspace?.slug ?? tasks.workspace?.id)
      : (tasks.workspaces.find((each) => each.id === chosenWorkspaceId)?.slug ?? chosenWorkspaceId);
  // What the chosen item's box offers an `@`, read under that workspace and repository.
  const readMentionAgents = useMentionAgentsReader(place?.workspaceId, tasks.tasks, named.models);
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  // A file the item names opens beside the thread as the panel's preview; pressed with ⌘, it goes to the item's task, opened there.
  const openFile = (ref: CodeRef, commit: string | undefined) => {
    const going = taskId !== undefined && pressedWithCommand() ? taskId : undefined;
    if (going === undefined) return sidePanel.onPreviewFile(ref, commit);
    if (commit !== undefined) return tasks.onShowFile(going, ref, commit);
    // A file read at no commit is drawn on the task it is browsed on, so it is opened here first, on the item's task, and then shown there.
    sidePanel.onOpenFile(ref);
    tasks.onShowPanelTab(going, { file: ref.path });
  };
  const mentions =
    place === undefined
      ? undefined
      : itemMentions(
          tasklessMentions(place, tasks.onShowMention, readMentionAgents),
          taskId === undefined ? undefined : openFile,
        );
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over Channels.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The thread shown is read as it opens, and U marks it, only while Channels holds the keys and the panel does not cover it.
  // Note that a stream with no thread open beside it shows no item, so none is read or nodded to unseen.
  const opened = tasks.shown && !sidePanel.fullScreen && threadShown ? chosen : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: tasks.shown && !sideFocused,
    onMark: markItem,
  });
  // A notice of the reader's own is acknowledged as it opens, on the same terms, once its holder's held read holds it.
  useNodOnOpen({ shown: opened, readerId: tasks.me, control: live });
  // The panel stands for the item asked for, by its task, or its agent where it has none (`use-tasks-tab.ts`).
  const panelFor = taskId ?? chosenAgentId;
  const pullRequests = [...named.pullRequests].map(([agentId, opened]) => ({
    agentId,
    url: opened.url,
  }));
  const { pages } = view;
  // The panel's state is held to the task's agents this page read, whose Pull request tabs alone the panel draws, an archived one's among them.
  const { onTaskAgents } = view;
  const taskAgents = agents.agents;
  const { heldIds } = agents;
  useEffect(() => {
    if (taskId === undefined || taskAgents === undefined) return;
    onTaskAgents(
      taskId,
      taskAgents.map((agent) => agent.id),
      heldIds,
    );
  }, [taskId, taskAgents, heldIds, onTaskAgents]);
  // A channel's thread as it is read, with what holds it, so its post names its agent and the pane reads it through its holder.
  const listedById = new Map(
    standing.flatMap(({ holder, items }) =>
      items.map((item) => [item.id, { holder, item }] as const),
    ),
  );
  const listedOf = (itemId: string) => listedById.get(itemId);
  const ownTask = (thread: ChannelThread) => {
    const holder = listedOf(thread.id)?.holder;
    return (
      holder?.kind === INBOX_HOLDER.TASK &&
      tasks.me !== undefined &&
      (holder.task.ownerId === tasks.me || holder.task.assignee?.userId === tasks.me)
    );
  };
  // A post's press opens its thread beside the stream, chosen by its holder where it is read.
  const openThread = (thread: ChannelThread) => {
    const listedThread = listedOf(thread.id);
    view.onChoose({
      ...(listedThread === undefined
        ? { agentId: thread.agentId, itemId: thread.id }
        : choiceOf(listedThread)),
      opened: true,
    });
    onOpenThread(thread.id);
  };
  // A channel pressed on a phone's list opens on its stream, never on a thread left open in it.
  const openChannel = (channelId: string) => {
    channelPlace.onChoose(channelId);
    channelPlace.onCloseThread();
    onListed(false);
  };
  // Closing the thread gives the stream the place again, and what counts what waits is read again, an answer given there among it.
  const closeThread = () => {
    channelPlace.onCloseThread();
    channels.onRefresh();
  };
  const openHere: OpenHere = (href) => {
    const target = inboxPanelTarget(href, {
      taskId,
      repository: chosenTask?.repository ?? null,
      pullRequests,
      agentIds: named.agentIds,
    });
    if (target === undefined || panelFor === undefined) return false;
    // A link pressed with ⌘ goes to its task, opening what it names there as a tab of its own, as against a
    // plain press, which opens it beside the thread as the panel's preview, so reading a thread leaves no tab
    // standing on its task but the one last read.
    const going = taskId !== undefined && pressedWithCommand() ? taskId : undefined;
    switch (target.kind) {
      case INBOX_PANEL_TARGET.FILE:
        openFile(fileRef(target.path, target.lines), target.lines?.commit);
        return true;
      case INBOX_PANEL_TARGET.PAGE:
        // A page an agent showed since the pages were read stands as its change lands, since they are followed as they move.
        if (going !== undefined) tasks.onShowPanelTab(going, { page: target.pageId });
        else sidePanel.onPreview({ page: target.pageId });
        return true;
      case INBOX_PANEL_TARGET.CHANGES:
        if (going !== undefined) tasks.onShowPanelTab(going, { changes: target.agentId });
        else sidePanel.onPreview({ changes: target.agentId });
        return true;
      case INBOX_PANEL_TARGET.AGENT:
        // An agent of the item's task reads beside the thread as the panel's preview; pressed with ⌘, or archived, which its task alone draws, it goes to the task on its tab.
        if (going === undefined && named.agentIds?.includes(target.agentId) === true) {
          sidePanel.onPreview({ transcript: target.agentId });
          return true;
        }
        if (taskId !== undefined) tasks.onShowAgent(taskId, target.agentId);
        return true;
      case INBOX_PANEL_TARGET.PULL_REQUEST:
        if (going !== undefined) {
          // The tab is the one the plain press would open, the pull request's own where it is another than the agent's.
          const tab = changesTabOf(named, target.agentId, sidePanel.changes, target.number);
          sidePanel.onPullRequestView(tab, PULL_REQUEST_VIEW.CONVERSATION);
          tasks.onShowPanelTab(going, tab);
          return true;
        }
        showPullRequest(
          sidePanel,
          named,
          target.agentId,
          PULL_REQUEST_VIEW.CONVERSATION,
          target.number,
        );
        return true;
    }
  };
  return (
    <LinkWorkspaceProvider value={listedWorkspace?.slug ?? listedWorkspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <AutomationDirectory workspace={tasks.workspace} wanted onOpen={openAutomation}>
          <div
            ref={onArea}
            className="desktop-task relative flex min-h-0 flex-1"
            data-panel-open={String(sidePanel.open)}
          >
            {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className={CHANNELS_VIEW} data-thread={threadBeside ? "" : undefined}>
                {channel === undefined ? (
                  channels.failed ? (
                    <ErrorState
                      placement={ERROR_STATE_PLACEMENT.CENTRED}
                      onRetry={channels.onRefresh}
                    >
                      {CHANNELS_NOT_READ}
                    </ErrorState>
                  ) : (
                    <NoteLine look={NOTE_LINE_LOOK.CENTRED} status>
                      {channels.channels === undefined ? CHANNELS_READING : CHANNELS_NONE}
                    </NoteLine>
                  )
                ) : channelsListed ? (
                  <ChannelList channels={channels.channels ?? []} onOpen={openChannel} />
                ) : (
                  <ChannelStream
                    key={channel.id}
                    channel={channel}
                    chosenId={chosen?.item.id}
                    beside={threadBeside}
                    hidden={(threadShown || goneShown) && phone}
                    readerId={tasks.me}
                    now={now}
                    shown={tasks.shown}
                    listedOf={listedOf}
                    ownTask={ownTask}
                    onOpen={openThread}
                    onLook={channels.onLook}
                    onAnswered={channels.onRefresh}
                  />
                )}
                {goneShown ? (
                  <section className={INBOX_VIEW_ITEMS} aria-label="Thread">
                    <Toolbar />
                    <NotFound
                      thing={NOT_FOUND_THING.INBOX_ITEM}
                      action={{ label: BACK_TO_CHANNEL, onClick: closeThread }}
                    />
                  </section>
                ) : threadShown && chosen !== undefined && channel !== undefined ? (
                  <OpenHereProvider value={openHere}>
                    <SkillFiles
                      source={agents.readSkills}
                      onOpen={(skill) => {
                        // Note that a skill's file opens in the panel beside the thread, as a file the item names does, and on GitHub where the item has no plan's panel to open it in.
                        if (place === undefined) return;
                        const url = encodeMention(
                          { kind: MENTION_KIND.FILE, path: skill.path },
                          place,
                        );
                        if (!openHere(url)) appPlatform().openGitHub(url);
                      }}
                    >
                      {/* The item's links are written under its own workspace, which a link may open outside the one listed. */}
                      <LinkWorkspaceProvider value={chosenLinkWorkspace}>
                        {/* Its thread's words read their mentions where its box does, so a file it names opens as its code does. */}
                        <TaskMentions value={mentions}>
                          <InboxPane
                            holder={chosen.holder}
                            item={chosen.item}
                            control={live}
                            agents={named}
                            hidden={false}
                            onBack={phone ? closeThread : undefined}
                            pager={undefined}
                            next={undefined}
                            mentions={mentions}
                            channel={{ name: channel.name, onClose: closeThread }}
                            phone={
                              phone
                                ? {
                                    onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle,
                                  }
                                : undefined
                            }
                            doors={{
                              ...paneDoors(tasks, chosen.holder, {
                                act,
                                now,
                                panelFor,
                                besideAgents: named.agentIds,
                              }),
                              onMark: markItem,
                              onClose: closeItem,
                            }}
                          />
                        </TaskMentions>
                      </LinkWorkspaceProvider>
                    </SkillFiles>
                  </OpenHereProvider>
                ) : null}
              </div>
            </PageFind>
            {drawing.panel ? (
              <InboxSidePanel
                tasks={tasks}
                drawing={{ ...drawing, panel: drawing.panel }}
                focused={sideFocused}
                taskId={taskId}
                panelFor={panelFor}
                repository={chosenTask?.repository ?? agents.agentRepository ?? null}
                pages={pages}
                agents={named}
                views={views}
                mentions={mentions}
                phone={
                  phone && chosen !== undefined
                    ? { back: cardTitle(chosen.item.title), onBack: sidePanel.onToggle }
                    : undefined
                }
              />
            ) : null}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

/** A file the item names as its code names it: its path, and its lines where it names them. */
function fileRef(path: string, lines: MentionLines | undefined): CodeRef {
  return lines === undefined
    ? { path }
    : { path, startLine: lines.startLine, endLine: lines.endLine };
}

/**
 * The mentions of the chosen item's words and box, read where `answerPlace`
 * says: a file or its lines an item of a task names opens through
 * `openFile`, as its code and its links do; an item of an agent with no
 * task has no File tab to open it in, so its file stays GitHub's.
 */
function itemMentions(
  taskless: TaskMentionsValue,
  openFile: ((ref: CodeRef, commit: string | undefined) => void) | undefined,
): TaskMentionsValue {
  if (openFile === undefined) return taskless;
  const onOpenFile = (path: string, lines: MentionLines | undefined) =>
    openFile(fileRef(path, lines), lines?.commit);
  return { ...taskless, doors: { ...taskless.doors, onOpenFile } };
}

/**
 * Where the chosen item's words are read in the window's Inbox, which
 * stands on no plan's page: its plan's workspace, by its slug, and
 * repository, or, for an agent with no plan, the agent's own as its read
 * names them, never its group's, which agents of other repositories share
 * and which an agent a link reached stands under with none. Its box
 * mentions what that repository and workspace hold, as the page of an
 * agent no plan holds does (`tasklessMentions`), and its skills' files
 * open there. None until both are known.
 */
function answerPlace(
  chosen: InboxListed,
  agents: CodingAgentsControl,
  tasks: TasksControl,
): TasklessPlace | undefined {
  const { holder, item } = chosen;
  const workspaceId =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.workspaceId
      : (agents.workspaceId ?? itemWorkspaceId(holder, item.agentId));
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : agents.agentRepository;
  if (workspaceId === undefined || repository === undefined || repository === null) {
    return undefined;
  }
  const workspace = tasks.workspaces.find((each) => each.id === workspaceId)?.slug ?? workspaceId;
  return { workspace, workspaceId, repository };
}

/**
 * The side panel beside the Inbox, standing for the chosen item's task, or
 * its agent where it has none (`use-tasks-tab.ts`): what the item opened
 * there, and what the task's "+" offers of it. A row of its tabs that
 * opens what it names opens it as the item's crumbs and links do: an
 * agent's tab leaves for it, a page stands in the panel, and the task's
 * own tabs leave for the task.
 */
function InboxSidePanel({
  tasks,
  drawing,
  focused,
  taskId,
  panelFor,
  repository,
  pages,
  agents,
  views,
  mentions,
  phone,
}: {
  tasks: TasksControl;
  drawing: SidePanelDrawing & { panel: SidePanelControl };
  focused: boolean;
  /** The chosen item's task, none for an item of an agent with no task. */
  taskId: string | undefined;
  panelFor: string | undefined;
  repository: string | null;
  pages: TasksControl["inboxView"]["pages"];
  agents: CodingAgentsControl;
  views: TabViews;
  /** What the item's box offers an `@`, which the composer of an agent's transcript beside it offers too. */
  mentions: TaskMentionsValue | undefined;
  /** Where the panel heads itself on a phone, its way back shutting it to the item (`SidePanel`'s `phone`). */
  phone: { readonly back: string; readonly onBack: () => void } | undefined;
}): React.JSX.Element {
  const { panel } = drawing;
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.PAGE) return panel.onPreview({ page: target.page });
    if (target.kind === TOOL_TARGET.TASK) return tasks.onShowTask(target.task);
    if (target.kind === TOOL_TARGET.AGENT) {
      if (taskId === undefined) return tasks.agentView.onOpen(target.agent);
      // An agent of the item's task reads beside the item as the panel's preview; pressed with ⌘, it goes to the task.
      if (!pressedWithCommand() && agents.agentIds?.includes(target.agent) === true) {
        return panel.onPreview({ transcript: target.agent });
      }
      return tasks.onShowAgent(taskId, target.agent);
    }
    if (target.kind !== TOOL_TARGET.INBOX && taskId !== undefined) tasks.onShowTask(taskId);
  };
  // An agent's transcript beside the item reads and writes as its tab in the task's column does,
  // through the agents the Inbox read of the item's task; its call starts on that task.
  const calls = useAgentCallDoors(tasks.calls, { taskId, archived: false });
  const cards = taskCards({
    agents,
    held: views.held,
    chosen: (opened) =>
      isAgentTab(opened) && panel.tab !== undefined && isTranscriptTab(panel.tab)
        ? panel.tab.transcript === opened.agent
        : panel.tab !== undefined && sameTab(opened, panel.tab),
    shownCode: [],
    pages: taskId === undefined ? undefined : { taskId },
  });
  const transcript = (agentId: string) => {
    const agent = agents.agents?.find((each) => each.id === agentId);
    return (
      <TaskMentions value={mentions}>
        <AgentPane
          call={calls}
          label={agent === undefined ? undefined : agentName(agent, agents.models)}
          tabbed={false}
          tab={{ agent: agentId }}
          agents={agents}
          shown={tasks.shown}
          views={views}
          // Note that a worker is drawn beside its agent's column alone, so its row goes to the task.
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
      repository={repository}
      board={undefined}
      shownCode={undefined}
      codeFailed={undefined}
      pages={pages}
      agents={agents}
      openAgents={NO_OPEN_AGENTS}
      shownAgent={undefined}
      views={views}
      shown={tasks.shown}
      focused={focused}
      onOpenTarget={openTarget}
      transcript={taskId === undefined ? undefined : transcript}
      phone={phone}
    />
  );
}

/**
 * The pane's doors for what holds its item: a task's open the task, its
 * agents' tabs, and its files, a file in the panel beside the Inbox where
 * the panel stands for the task; an automation's open its page where the
 * Automations experiment is on, its agents' own pages, and no file, there
 * being no task whose repository a file is read through.
 */
function paneDoors(
  tasks: TasksControl,
  holder: InboxHolder,
  seams: {
    act: ReturnType<typeof useAct>["act"];
    now: number;
    /** The task, or the agent, the panel beside the Inbox stands for. */
    panelFor: string | undefined;
    /** The task's agents whose transcripts the panel beside the Inbox draws: its agents not archived, once read. */
    besideAgents: readonly string[] | undefined;
  },
): InboxPaneDoors {
  if (holder.kind === INBOX_HOLDER.TASK) {
    const { task } = holder;
    return {
      onOpenHolder: () => tasks.onShowTask(task.id),
      taskCard: taskCardOf(tasks, task, seams.now),
      // An agent the item names reads beside it, as a link to it does; pressed with ⌘, it goes to the task on its tab.
      // Note that an archived agent's transcript is drawn on its task alone, so it goes there.
      onOpenAgent: (agentId) =>
        seams.panelFor === task.id &&
        seams.besideAgents?.includes(agentId) === true &&
        !pressedWithCommand()
          ? tasks.sidePanel.onPreview({ transcript: agentId })
          : tasks.onShowAgent(task.id, agentId),
      code: {
        repository: task.repository,
        readFile: (window) => seams.act(ACT_KIND.TASKS_FILE, { taskId: task.id, ...window }),
        // Note that code is a link like any other: beside the item it opens as the panel's preview, and pressed with ⌘ it goes to the task.
        onOpenFile: (ref, commit) =>
          seams.panelFor === task.id && !pressedWithCommand()
            ? tasks.sidePanel.onPreviewFile(ref, commit)
            : tasks.onShowFile(task.id, ref, commit),
      },
    };
  }
  const { automationId } = holder;
  return {
    onOpenHolder:
      automationId !== null
        ? () => tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    taskCard: undefined,
    onOpenAgent: (agentId) => tasks.agentView.onOpen(agentId),
    code: { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined },
  };
}
