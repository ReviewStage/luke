import type { ChannelThread } from "@luke/features/channel-wire";
import { encodeMention, MENTION_KIND, type MentionLines } from "@luke/features/mention-link";
import type { CodeRef } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFileAnswer } from "@luke/features/tasks-view";
import { backToWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import {
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  NOTE_LINE_LOOK,
  NoteLine,
  TOOLBAR_INSET,
  Toolbar,
  useMinute,
} from "@luke/ui";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "@luke/ui/inbox-panel-link";
import { isAgentTab, isTranscriptTab, type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { InboxIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
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
import {
  ChannelMissing,
  ChannelReading,
  ChannelStream,
  type PostMenuDoors,
  useChannelStream,
} from "../tasks/channel-stream.js";
import { CHANNEL_SHOWN, channelShown, generalChannel } from "../tasks/channels-model.js";
import { agentName } from "../tasks/coding-agent-model.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxCompose } from "../tasks/inbox-compose.js";
import { INBOX_NOT_READ, InboxList, InboxListNote, newTaskAction } from "../tasks/inbox-list.js";
import {
  anyUnread,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  itemWorkspaceId,
  listedItems,
  NEEDS_YOU,
} from "../tasks/inbox-model.js";
import { inboxNext, useChannelPager, useInboxPager } from "../tasks/inbox-pager.js";
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
import { useChannelPlace, useChannels, useThreadChannel } from "../tasks/use-channels.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { choiceOf, type InboxListing, useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { type OpenHere, OpenHereProvider } from "../tasks/use-open-link.js";
import {
  PULL_REQUEST_VIEW,
  SIDE_PANEL_TAB,
  type SidePanelControl,
} from "../tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useExperiment } from "../use-app-state.js";
import { useAgentCallDoors } from "./agent-actions.js";
import { useChannelDialog } from "./channel-dialog.js";
import { AgentPane } from "./main-tabs.js";
import { NewTaskButton } from "./new-task-button.js";
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
 * desktop-inbox.tsx -- the window's Inbox: every item of every task of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the task's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each task of the
 * workspace the sidebar lists that main says holds one (the switcher counts
 * what waits in the others), needing the developer or settled, each task read whole
 * as main says it changed (`use-inbox-items.ts`), under its task, its
 * person, its status, or in one run, the latest first or the oldest
 * first, For you, what needs them and what of theirs is unread, or All,
 * everything, of everyone's, theirs, or one teammate's, as the developer
 * last chose; Needs
 * you is the Inbox's one name for an item not yet answered
 * (`inbox-model.ts`'s `NEEDS_YOU`), and the sidebar's Inbox row counts the
 * same items. A task's status never hides its items: the Inbox is a feed
 * of what the agents got done, so an item of a task done or canceled is
 * listed and counted as any other until it is read or answered, its row
 * wearing its task's status (`inbox-list.tsx`). A press on a row chooses it, and the pane beside the
 * list (`inbox-pane.tsx`) shows it as a thread, answered in place, on its
 * task's own held read, which stands in for the list's read of that task
 * so an answer shows at once. With nothing chosen, the first item listed
 * that waits stands chosen, else the first listed. The pane's crumbs open
 * the task or the agent's tab, leaving the Inbox; what the item opens that
 * a task's side panel draws opens in that panel beside it instead, standing
 * for the chosen item's task (`use-tasks-tab.ts`): a code block's Open its
 * file, and a link naming a file of the task's repository, one of its
 * pages, or one of its agents' pull requests (`inbox-panel-link.ts`). The
 * panel's toggle, its width, and its keys are a task's own, and ⌘F finds in
 * the panel while it holds the keys, as on a task. With nothing listed, it says so under the Inbox's
 * glyph (`@luke/ui`'s `EmptyState`) over New task, the window resting here
 * with no task open (`resting-page.ts`); with its scope leaving out every item, the list
 * says so and offers the scope that holds something, while the pane goes on showing the item
 * chosen, answered, though the list draws it no row. Escape never leaves it, a stray press
 * being no reason to lose the item being read; any row of the sidebar does, and so does Back. Too narrow for the list and the item
 * side by side, it shows one at a time (`inbox-columns.ts`): the chosen
 * item, whose way back, Back's chord, or Escape gives the list, and a press
 * on a row there the item again. K and J, and the pager where the
 * item stands alone, step through the list (`inbox-pager.tsx`). Everything in it that names a
 * person, an answer and an agent's starter, reads them against the listed
 * workspace's members (`member-directory.tsx`). The chosen item's box
 * mentions what its repository and workspace hold (`answerPlace`), and
 * its skills are read through its holder and drawn as chips that open
 * their `SKILL.md` in the panel beside it, as a file the item names opens,
 * or on GitHub where the item has no plan whose panel could open it.
 *
 * With Channels on, a channel's stream stands in the list's place
 * (`channel-stream.tsx`): K and J step through its threads rather than the
 * list's items, Back's chord and Escape close the thread open from it, a
 * thread that is gone says so where it would stand, beside the stream or,
 * on a phone, in its place, and a channel archived or never the
 * workspace's says so in the stream's place, with the way to #general. A
 * phone's list of channels makes one from its "+", as the sidebar does.
 *
 * Its items are read and listed by `use-inbox-listing.ts`. While the account
 * has the inbox-first sidebar on, the shell reads them once and hands the
 * listing to the sidebar, which lists them (`sidebar-inbox.tsx`), and here,
 * where the chosen item then stands alone across the place, with no list of
 * its own and no way back to one, the list being always in sight.
 */

/** The page's grid while it is a channel's stream, which stands alone, its thread opening in the side panel beside it; a narrow room draws no title bar's buttons, so its bars start where their column's words do, as a phone's own row does (`phone-head.tsx`). */
const CHANNELS_VIEW =
  "inbox-view channels-view @container grid min-h-0 flex-1 grid-cols-single [&>[hidden]]:hidden in-data-[luke-room=narrow]:[--luke-toolbar-start-at:initial]";

/** What the page says where the workspace's channels could not be read, and where none stand. */
const CHANNELS_NOT_READ = "Could not read this workspace's channels.";
const CHANNELS_NONE = "This workspace has no channels yet.";

/** What leads back to the list from a missing item's notice, where the Inbox shows one column. */
const BACK_TO_INBOX = backToWords("inbox");

/** A taskless item's code reads no file, there being no task whose repository it reads through. */
const UNREAD_FILE = (): Promise<TasksFileAnswer> =>
  Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED });

const _nothing = (): void => undefined;

/** The column a New thread stands in, which the Inbox shows as it would an item. */
const COMPOSE_COLUMN = "new-thread";

/** No tab of the Inbox's panel is drawn in semibold: what arrives on a task arrives on its page. */
const NO_UNREAD: readonly StripTab[] = [];

/** No agent's tab stands open beside the Inbox, so no worker's tab stands in its panel. */
const NO_OPEN_AGENTS: readonly string[] = [];

/** The window's Inbox, in the task's place: every task's items and every automation's, and the chosen one read beside them. */
export function DesktopInbox({
  tasks,
  listing,
  room = SHELL_ROOM.WIDE,
}: {
  tasks: TasksControl;
  /** The Inbox as the inbox-first sidebar lists it, where the sidebar holds the list and the page shows the chosen item alone; none where the page reads and lists it itself. */
  listing?: InboxListing | undefined;
  /** The room the stage gives; narrow, a phone's, the list is headed as a phone's page is (`phone-head.tsx`). */
  room?: ShellRoom;
}): React.JSX.Element {
  return listing === undefined ? (
    <ListedInbox tasks={tasks} room={room} />
  ) : (
    <InboxShown tasks={tasks} listing={listing} paneOnly room={room} />
  );
}

/** The Inbox page reading its own items, its list and the chosen item side by side. */
function ListedInbox({ tasks, room }: { tasks: TasksControl; room: ShellRoom }): React.JSX.Element {
  const listing = useInboxListing(tasks);
  return <InboxShown tasks={tasks} listing={listing} paneOnly={false} room={room} />;
}

/**
 * The Inbox as read: its list and the chosen item beside it, or, where the
 * sidebar lists it (`paneOnly`), the chosen item alone across the place,
 * with no way back to a list that is always in sight.
 */
function InboxShown({
  tasks,
  listing,
  paneOnly,
  room,
}: {
  tasks: TasksControl;
  listing: InboxListing;
  paneOnly: boolean;
  room: ShellRoom;
}): React.JSX.Element {
  const {
    view,
    act,
    choices,
    folds,
    openAutomation,
    failed,
    asked,
    chosenTask,
    taskId,
    chosenAgentId,
    agents,
    live,
    named,
    marks,
    standing,
    counts,
    list,
    steps,
    chosen,
    filteredOut,
    search,
    searched,
    missing,
    reading,
    choose,
    closeItem,
    onRetry,
    compose,
  } = listing;
  // New task is the way on from an Inbox with nothing in it, wherever an account can start one.
  const newTask = tasks.signedIn ? tasks.onNewTask : undefined;
  const now = useMinute();
  // Note that with Channels on the page is a channel's stream, its thread in the side panel once one is opened, rather than the Inbox's list.
  const streaming = useExperiment(EXPERIMENT.CHANNELS) && !paneOnly;
  const channelPlace = useChannelPlace();
  const channels = useChannels(streaming ? tasks.workspace?.id : undefined, tasks.shown);
  const channelState = channelShown(
    streaming ? channels.channels : undefined,
    channelPlace.channelId,
  );
  const channel = channelState.kind === CHANNEL_SHOWN.CHANNEL ? channelState.channel : undefined;
  // Note that a phone shows one thing at a time across the screen: the list of channels its bar opens, a channel's stream, or a thread in place of the stream.
  const phone = room === SHELL_ROOM.NARROW;
  // A phone's list of channels stands while the list is asked for, as the bar's Channels asks, so the window's Back returns to it from a stream.
  const channelsListed = streaming && phone && view.listed;
  // A thread opened from a stream stands in the side panel as its Inbox tab (`use-tasks-tab.ts`), and on a phone in the stream's place; one that is gone says so there.
  const threadMissing =
    streaming &&
    missing &&
    channelPlace.threadId !== undefined &&
    asked?.itemId === channelPlace.threadId;
  const threadOpen =
    streaming &&
    ((chosen !== undefined && channelPlace.threadId === chosen.item.id) || threadMissing);
  // A thread opened by a link or from another channel moves the stream to its own channel once its item is read.
  useThreadChannel(streaming ? chosen?.item : undefined);
  const threadShown = threadOpen && channel !== undefined && !channelsListed;
  const threadBeside = threadOpen && !phone;
  // A missing item's pane stands where its item would, so a narrow Inbox shows the notice rather than the list.
  // Note that the window keeps whether the list was asked for, so its history can go back to it.
  const { listed, onListed, onSingle } = view;
  // Closing the thread gives the stream the place again, and what counts what waits is read again, an answer given there among it.
  const closeThread = () => {
    channelPlace.onCloseThread();
    channels.onRefresh();
  };
  const pageColumns = useInboxColumns(
    compose.on ? COMPOSE_COLUMN : (chosen?.item.id ?? (missing ? asked?.itemId : undefined)),
    !paneOnly,
    { asked: listed, onAsk: onListed, onSingle: paneOnly ? undefined : onSingle },
    // Note that Back's chord and Escape close a stream's thread, so a phone goes back to the stream rather than to its list of channels.
    streaming ? { onClose: threadOpen ? closeThread : undefined } : undefined,
  );
  // Note that the Inbox reports one column only once an item stands, since its list lives in the sidebar and a list step would show nothing new.
  const itemStands = chosen !== undefined;
  useLayoutEffect(() => {
    if (paneOnly) onSingle?.(itemStands);
  }, [paneOnly, onSingle, itemStands]);
  // Note that with the list in the sidebar the place shows the item alone, measured by nothing, with no way back to a list that stays in sight.
  const columns = paneOnly
    ? { ...pageColumns, ref: undefined, shown: INBOX_COLUMNS.ITEM, onBack: undefined }
    : pageColumns;
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    compose.onEnd();
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const { onMark: markItem } = marks;
  // K and J choose the item above or below, the keyboard following it to its row.
  const step = (listed: InboxListed) => {
    choose(listed);
    columns.onStep();
  };
  // Note that the Inbox's pager stands down while a stream stands in its list's place, which pages its own threads.
  const { pager, direction } = useInboxPager(steps, list, chosen?.item.id, step, {
    shown: tasks.shown && !streaming,
    folded: folds.folded,
  });
  const next = inboxNext(
    steps,
    chosen,
    { models: named.models, readerId: tasks.me },
    open,
    folds.folded,
    direction,
  );
  // A choice that asks for its item opens it once, the one column the Inbox shows being the
  // item's; Back from it then stands on the list, the choice taken already.
  const opensItem = asked?.opened === true && chosen?.item.id === asked.itemId;
  const taken = useRef<InboxChoice | undefined>(undefined);
  const openColumn = columns.onOpen;
  useEffect(() => {
    if (!opensItem || asked === undefined || taken.current === asked) return;
    taken.current = asked;
    openColumn(asked.itemId);
  }, [opensItem, asked, openColumn]);
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
  // What a New thread's To offers: the agents of the workspace the Inbox lists.
  const readWorkspaceAgents = useMentionAgentsReader(
    tasks.workspace?.id,
    tasks.tasks,
    named.models,
  );
  const startCompose = compose.onStart;
  const onCompose = tasks.signedIn
    ? () => {
        startCompose();
        columns.onOpen(COMPOSE_COLUMN);
      }
    : undefined;
  const listedWorkspace = tasks.workspace;
  const { sidePanel } = tasks;
  // A file the item names opens beside the Inbox as the panel's preview; pressed with ⌘, it goes to the item's task, opened there.
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
  // The thread beside the stream is the panel's Inbox tab, so closing that tab closes the thread, and the panel's hiding closes it too.
  const threadTabs = useThreadTab(
    sidePanel,
    threadBeside,
    threadOpen ? channelPlace.threadId : undefined,
    closeThread,
  );
  const drawing = useSidePanelDrawing(threadTabs);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the Inbox.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The thread beside the stream is seen while the panel shows its tab.
  const threadSeen = threadBeside && sidePanel.open && sidePanel.tab === SIDE_PANEL_TAB.INBOX;
  // The item shown is read as it opens, and U marks it, only while the Inbox holds the keys and the panel does not cover it.
  // Note that a stream with no thread open shows no item, so none is read or nodded to unseen.
  const opened =
    tasks.shown &&
    !compose.on &&
    (threadBeside
      ? threadSeen
      : !sidePanel.fullScreen &&
        columns.shown !== INBOX_COLUMNS.LIST &&
        (!streaming || threadShown))
      ? chosen
      : undefined;
  useReadOnOpen({
    shown: opened?.item,
    chosen: chosen?.item,
    active: tasks.shown && (threadSeen || !sideFocused),
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
  // The panel's state is held to the task's agents this Inbox read, whose Pull request tabs alone the panel draws, an archived one's among them.
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
  // A channel's thread as the Inbox lists it, with what holds it, so its post says where its agent stands and the pane reads it through its holder.
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
  // A post's press opens its thread in the side panel beside the stream, chosen as the Inbox chooses an item, by its holder where it is read.
  const openThread = (thread: ChannelThread) => {
    compose.onEnd();
    // Note that the thread already open is shown again, its tab chosen over what was opened from it.
    if (threadBeside && thread.id === channelPlace.threadId)
      sidePanel.onChoose(SIDE_PANEL_TAB.INBOX);
    const listedThread = listedOf(thread.id);
    view.onChoose({
      ...(listedThread === undefined
        ? { agentId: thread.agentId, itemId: thread.id }
        : choiceOf(listedThread)),
      opened: true,
    });
    channelPlace.onOpenThread(thread.id);
  };
  // A post's ⋯ marks, closes, and moves its thread, and opens its task or its agent where the pane's crumbs would.
  const postMenu: PostMenuDoors = {
    onMark: markItem,
    onClose: closeItem,
    onOpenTask: tasks.onShowTask,
    onOpenAgent: (thread, holder) =>
      holder?.kind === INBOX_HOLDER.TASK
        ? tasks.onShowAgent(holder.task.id, thread.agentId)
        : tasks.agentView.onOpen(thread.agentId),
    onMove: channels.onMove,
    channels: channels.channels ?? [],
  };
  // A channel pressed on a phone's list opens on its stream, never on a thread left open in it.
  const openChannel = (channelId: string) => {
    channelPlace.onChoose(channelId);
    channelPlace.onCloseThread();
    onListed(false);
  };
  // The stream is read here, so K and J page the threads it posts, and the thread's bar counts them.
  const stream = useChannelStream(channel?.id, tasks.me, ownTask);
  const streamPager = useChannelPager(
    stream.viewed,
    threadOpen ? channelPlace.threadId : undefined,
    openThread,
    tasks.shown && channel !== undefined && !channelsListed && !sidePanel.fullScreen,
  );
  // A phone's list of channels makes one from its "+", as the sidebar does, opening it once made.
  const making = useChannelDialog({
    workspaceId: tasks.workspace?.id,
    channels,
    shown: tasks.shown && channelsListed,
    onMade: openChannel,
  });
  const general = generalChannel(channels.channels ?? []);
  // The thread asked for that is gone, where it would stand: beside the stream, or on a phone in its place.
  const missingThread = (
    <section className={INBOX_VIEW_ITEMS} aria-label="Thread not found">
      <Toolbar end={TOOLBAR_INSET.COLUMN} />
      <NotFound
        thing={NOT_FOUND_THING.INBOX_ITEM}
        action={
          channel === undefined
            ? undefined
            : { label: backToWords(`#${channel.name}`), onClick: closeThread }
        }
      />
    </section>
  );
  const openHere: OpenHere = (href) => {
    const target = inboxPanelTarget(href, {
      taskId,
      repository: chosenTask?.repository ?? null,
      pullRequests,
      agentIds: named.agentIds,
    });
    if (target === undefined || panelFor === undefined) return false;
    // A link pressed with ⌘ goes to its task, opening what it names there as a tab of its own, as against a
    // plain press, which opens it beside the item as the panel's preview, so reading an item leaves no tab
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
        // An agent of the item's task reads beside the item as the panel's preview; pressed with ⌘, or archived, which its task alone draws, it goes to the task on its tab.
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
  // The chosen item's thread, in the Inbox's place, or beside a channel's stream as the side panel's Inbox tab.
  const itemPane = (listed: InboxListed, beside: boolean) => (
    <OpenHereProvider value={openHere}>
      <SkillFiles
        source={agents.readSkills}
        onOpen={(skill) => {
          // Note that a skill's file opens in the panel beside the Inbox, as a file the item names does, and on GitHub where the item has no plan's panel to open it in.
          if (place === undefined) return;
          const url = encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, place);
          if (!openHere(url)) appPlatform().openGitHub(url);
        }}
      >
        {/* The item's links are written under its own workspace, which a link may open outside the one listed. */}
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          {/* Its thread's words read their mentions where its box does, so a file it names opens as its code does. */}
          <TaskMentions value={mentions}>
            <InboxPane
              holder={listed.holder}
              item={listed.item}
              control={live}
              agents={named}
              hidden={!streaming && columns.shown === INBOX_COLUMNS.LIST}
              onBack={beside ? undefined : streaming ? closeThread : columns.onBack}
              pager={
                streaming ? streamPager : columns.shown === INBOX_COLUMNS.ITEM ? pager : undefined
              }
              next={streaming ? undefined : next}
              mentions={mentions}
              channel={
                streaming && channel !== undefined
                  ? { name: channel.name, onClose: closeThread }
                  : undefined
              }
              phone={
                phone && !beside
                  ? { onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle }
                  : undefined
              }
              doors={{
                ...paneDoors(tasks, listed.holder, {
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
  );
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
              <div
                className={streaming ? CHANNELS_VIEW : INBOX_VIEW}
                ref={columns.ref}
                data-columns={streaming ? undefined : columns.shown}
              >
                {streaming ? (
                  channelsListed ? (
                    <ChannelList
                      workspaceId={tasks.workspace?.id}
                      channels={channels}
                      shown={tasks.shown}
                      onOpen={openChannel}
                      onNew={() => making.askNew(false)}
                    />
                  ) : channelState.kind === CHANNEL_SHOWN.MISSING ? (
                    <ChannelMissing
                      onGeneral={
                        general === undefined ? undefined : () => channelPlace.onChoose(general.id)
                      }
                    />
                  ) : channel !== undefined ? (
                    <ChannelStream
                      key={channel.id}
                      channel={channel}
                      stream={stream}
                      chosenId={threadBeside ? chosen?.item.id : undefined}
                      hidden={threadShown && phone}
                      readerId={tasks.me}
                      now={now}
                      shown={tasks.shown}
                      agents={named}
                      listedOf={listedOf}
                      menuDoors={postMenu}
                      onOpen={openThread}
                      onLook={channels.onLook}
                      onAnswered={channels.onRefresh}
                    />
                  ) : channels.channels === undefined && !channels.failed ? (
                    <ChannelReading />
                  ) : channels.failed ? (
                    <ErrorState
                      placement={ERROR_STATE_PLACEMENT.CENTRED}
                      onRetry={channels.onRefresh}
                    >
                      {CHANNELS_NOT_READ}
                    </ErrorState>
                  ) : (
                    <NoteLine look={NOTE_LINE_LOOK.CENTRED} status>
                      {CHANNELS_NONE}
                    </NoteLine>
                  )
                ) : paneOnly ? null : (
                  <InboxList
                    view={list}
                    chosen={chosen?.item.id}
                    columns={columns.shown}
                    rows={columns.rows}
                    head={{
                      shown: tasks.shown,
                      show: choices,
                      view: { choices, folds },
                      readAll: {
                        unread: anyUnread(standing),
                        onMarkAll: () => marks.onMarkAll(standing.flatMap(({ items }) => items)),
                      },
                      search,
                      onCompose,
                      phone:
                        room === SHELL_ROOM.NARROW
                          ? { start: <NewTaskButton tasks={tasks} /> }
                          : undefined,
                    }}
                    models={named.models}
                    readerId={tasks.me}
                    reading={reading}
                    note={
                      <InboxListNote
                        failed={failed}
                        reading={reading}
                        empty={listedItems(list).length === 0}
                        alone={columns.shown === INBOX_COLUMNS.LIST}
                        filteredOut={filteredOut ? choices : undefined}
                        counts={counts}
                        onList={columns.onList}
                        onRetry={onRetry}
                        searched={searched}
                        onNewTask={newTask}
                      />
                    }
                    onChoose={open}
                    onMark={(listed, unread, saying) => markItem(listed.item, unread, saying)}
                    onClose={closeItem}
                  />
                )}
                {streaming && !(threadShown && phone) ? null : compose.on ? (
                  <InboxCompose
                    // Note that the pane is the listed workspace's, so another listed starts it afresh, its To and its agents read there.
                    key={listedWorkspace?.id}
                    hidden={columns.shown === INBOX_COLUMNS.LIST}
                    workspace={
                      listedWorkspace === undefined
                        ? undefined
                        : {
                            workspace: listedWorkspace.slug ?? listedWorkspace.id,
                            workspaceId: listedWorkspace.id,
                          }
                    }
                    repositoryOf={(id) =>
                      tasks.tasks.find((each) => each.id === id)?.repository ?? null
                    }
                    onShowMention={tasks.onShowMention}
                    onBack={columns.onBack}
                    readAgents={readWorkspaceAgents}
                    to={chosen?.item.agentId}
                    keywords={agents.keywords}
                    start={agents.startInboxThread}
                    onStarted={({ item, agent }) => {
                      compose.onEnd();
                      view.onChoose({
                        ...(agent.task === undefined
                          ? { agentId: agent.id }
                          : { taskId: agent.task.id }),
                        itemId: item.id,
                        opened: true,
                      });
                    }}
                    onDiscard={compose.onEnd}
                    phone={room === SHELL_ROOM.NARROW}
                    onRestore={() => onCompose?.()}
                  />
                ) : chosen === undefined && streaming ? (
                  missingThread
                ) : chosen === undefined ? (
                  <section
                    className={INBOX_VIEW_ITEMS}
                    aria-label="Inbox"
                    // Note that with the list in the sidebar this is the whole place, so its empty state and its missing item's notice always stand.
                    hidden={
                      paneOnly
                        ? false
                        : missing
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
                    ) : failed ? (
                      // Note that the list beside says the read failed, so only a pane standing alone draws it, never the empty state.
                      paneOnly ? (
                        <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={onRetry}>
                          {INBOX_NOT_READ}
                        </ErrorState>
                      ) : null
                    ) : reading || filteredOut || searched !== undefined ? null : (
                      // Note that the list says what the filter or its search left out, so the pane beside it stands bare.
                      <EmptyState icon={<InboxIcon />} action={newTaskAction(newTask)}>
                        {NEEDS_YOU.NONE}
                      </EmptyState>
                    )}
                  </section>
                ) : (
                  itemPane(chosen, false)
                )}
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
                thread={
                  !threadBeside
                    ? undefined
                    : chosen === undefined
                      ? missingThread
                      : itemPane(chosen, true)
                }
                phone={
                  room === SHELL_ROOM.NARROW && chosen !== undefined
                    ? { back: cardTitle(chosen.item.title), onBack: sidePanel.onToggle }
                    : undefined
                }
              />
            ) : null}
            {making.dialog}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

/**
 * The side panel beside a channel's stream, whose Inbox tab is the thread
 * open there (`use-side-panel.ts`'s `thread`): each thread opened is chosen
 * on it, which opens the panel, and closing the tab, or hiding the panel,
 * closes the thread, the stream keeping its scroll, its New line, and its
 * look, since it stays drawn. What the thread opens, a pull request, a page,
 * or a file, stands as a tab beside it, and closing that one, or choosing
 * the thread's tab, is the way back to the thread.
 */
function useThreadTab(
  panel: SidePanelControl,
  beside: boolean,
  threadId: string | undefined,
  onCloseThread: () => void,
): SidePanelControl {
  const shownId = beside ? threadId : undefined;
  const choose = useRef(panel.onChoose);
  choose.current = panel.onChoose;
  // Note that a thread is chosen as it opens alone, so a tab opened from it after stays chosen.
  useLayoutEffect(() => {
    if (shownId !== undefined) choose.current(SIDE_PANEL_TAB.INBOX);
  }, [shownId]);
  const close = useRef(onCloseThread);
  close.current = onCloseThread;
  const wasOpen = useRef(panel.open);
  const { open } = panel;
  useEffect(() => {
    const hidden = wasOpen.current && !open;
    wasOpen.current = open;
    if (hidden && shownId !== undefined) close.current();
  }, [open, shownId]);
  if (!beside) return panel;
  return {
    ...panel,
    onClose: (tab) => {
      if (tab === SIDE_PANEL_TAB.INBOX) onCloseThread();
      panel.onClose(tab);
    },
  };
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
  thread,
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
  /** The channel's thread open beside its stream, which the panel's Inbox tab shows; none where no thread is open there. */
  thread: React.ReactNode | undefined;
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
      inbox={thread === undefined ? undefined : { body: thread, board: undefined, drafted: false }}
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
