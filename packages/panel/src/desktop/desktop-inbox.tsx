import { AGENT_CALL_FAILURE, type AgentInboxMessagedView } from "@luke/features/agent-view";
import type { Channel } from "@luke/features/channel-wire";
import type { InboxItem } from "@luke/features/inbox-wire";
import { encodeMention, MENTION_KIND, type MentionLines } from "@luke/features/mention-link";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import type { CodeRef } from "@luke/features/task-wire";
import { backToWords, readFailedWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ERROR_STATE_PLACEMENT, ErrorState, STATUS_TONE, Toolbar } from "@luke/ui";
import { INBOX_PANEL_TARGET, inboxPanelTarget } from "@luke/ui/inbox-panel-link";
import { isAgentTab, isTranscriptTab, type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { useAct } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { AutomationDirectory } from "../automation-directory.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { MemberDirectory } from "../member-directory.js";
import { NOT_FOUND_THING, NotFound } from "../not-found.js";
import { pressedWithCommand } from "../press-intent.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { agentName, messageFailureWords } from "../tasks/agent-model.js";
import {
  ChannelMissing,
  ChannelsNotRead,
  type HeadedChannel,
  useChannelHead,
} from "../tasks/channel-head.js";
import { CHANNEL_SHOWN, channelShown, generalChannel } from "../tasks/channels-model.js";
import { type InboxCodeDoors, UNREAD_FILE } from "../tasks/inbox-code-card.js";
import {
  INBOX_COLUMNS,
  INBOX_VIEW,
  INBOX_VIEW_ITEMS,
  useInboxColumns,
} from "../tasks/inbox-columns.js";
import { InboxList, InboxListNote, InboxPaneEmpty } from "../tasks/inbox-list.js";
import {
  anyUnread,
  holderAutomationId,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  itemWorkspaceId,
} from "../tasks/inbox-model.js";
import { inboxNext, useInboxPager } from "../tasks/inbox-pager.js";
import { type InboxNewThread, InboxPane, type InboxPaneDoors } from "../tasks/inbox-pane.js";
import { useMoveThreadDialog } from "../tasks/move-thread-dialog.js";
import { SkillFiles } from "../tasks/skill-chip.js";
import {
  type TasklessPlace,
  TaskMentions,
  type TaskMentionsValue,
  tasklessMentions,
  useMentionAgentsReader,
} from "../tasks/task-mentions.js";
import { cardTitle, TOOL_TARGET, type ToolTarget } from "../tasks/tool-call-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import {
  openChannelThread,
  useArchivedChannels,
  useChannelPlace,
  useChannels,
  useInboxNarrowed,
  useThreadChannel,
} from "../tasks/use-channels.js";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import { useNodOnOpen, useReadOnOpen } from "../tasks/use-inbox-read-marks.js";
import { useInboxItemOpenSpan, useInboxOpenSpan } from "../tasks/use-inbox-spans.js";
import { type OpenHere, OpenHereProvider } from "../tasks/use-open-link.js";
import { PULL_REQUEST_VIEW, type SidePanelControl } from "../tasks/use-side-panel.js";
import { type HeldTaskInboxControl, useInboxCardDrafts } from "../tasks/use-task-inbox.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { useCapability, useExperiment } from "../use-app-state.js";
import { AgentPane } from "./main-tabs.js";
import { NewTaskButton } from "./new-task-button.js";
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

/**
 * desktop-inbox.tsx -- the window's Inbox: every item of every task of the listed workspace holding one in a list of its own, and the chosen item read beside it.
 *
 * It stands in the task's place beside the sidebar, whose Inbox row is
 * marked while it does, the way a mail app's mailbox stands beside its
 * folders. The list (`inbox-list.tsx`) holds the items of each task of the
 * workspace the sidebar lists that main says holds one (the switcher counts
 * what waits in the others), needing the developer or settled, each task read whole
 * as main says it changed (`use-holder-inbox-items.ts`), under its task, its
 * person, its status, or in one run, the latest first or the oldest
 * first, Needs you, the open threads that wait on them, or All,
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
 * so an answer shows at once. Nothing is chosen until a row is pressed or a
 * link asks for an item, the pane saying meanwhile how to choose one
 * (`InboxPaneEmpty`), so nothing is read by the Inbox opening. The pane's crumbs open
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
 * side by side, it shows one at a time (`inbox-columns.ts`): the list,
 * and the item once a row's press or a link opens it, whose way back, Back's
 * chord, or Escape gives the list again. K and J, and the pager where the
 * item stands alone, step through the list (`inbox-pager.tsx`). Everything in it that names a
 * person, an answer and an agent's starter, reads them against the listed
 * workspace's members (`member-directory.tsx`). The chosen item's box
 * mentions what its repository and workspace hold (`answerPlace`), and
 * its skills are read through its holder and drawn as chips that open
 * their `SKILL.md` in the panel beside it, as a file the item names opens,
 * or on GitHub where the item has no plan whose panel could open it.
 *
 * With Channels on, a channel chosen from the sidebar narrows the page to
 * its own items, the same list, reading pane, and keys, under the channel's
 * name and purpose (`channel-head.tsx`), on a scope of the channel's own
 * that opens on All of everyone's (`use-inbox-listing.ts`); leaving it stamps the
 * reader's look at it; and a row's ⋯ moves its thread to another channel
 * (`move-thread-dialog.tsx`). An item opened into a channel from a link
 * narrows the page to its own channel once read, and a channel archived or
 * never the workspace's says so in the list's place, with the way to
 * #general.
 *
 * Its items are read and listed by `use-inbox-listing.ts`.
 *
 * It is a memo boundary over the window's steady tasks (`useSteadyDoors`),
 * as the sidebar and a task's page are, so the shell drawn again over the
 * same tasks leaves it as it was. Nothing over its list reads the clock or
 * the pointer: each row's time counts from the window's minute on its own,
 * and the list keeps the pointer where its next draw reads it; and the box's
 * drafts are read in the pane that draws it (`DraftedInboxPane`), so a word
 * typed there draws the pane alone. A row chosen is drawn here first, the
 * window holding the choice once that frame has painted
 * (`use-inbox-listing.ts`), so the side panel, which follows the window's
 * choice, stands as last drawn until then.
 */

/** What the pane says where the item asked for could not be read, its holder's own read having failed. */
const ITEM_NOT_READ = readFailedWords("this item");

/** What leads back to the list from a missing item's notice, where the Inbox shows one column. */
const BACK_TO_INBOX = backToWords("inbox");

const _nothing = (): void => undefined;

/** No tab of the Inbox's panel is drawn in semibold: what arrives on a task arrives on its page. */
const NO_UNREAD: readonly StripTab[] = [];

/** No agent's tab stands open beside the Inbox, so no worker's tab stands in its panel. */
const NO_OPEN_AGENTS: readonly string[] = [];

/** No channel is read yet. */
const NO_CHANNELS: readonly Channel[] = [];

/** What heads the Inbox narrowed to no channel: nothing it draws. */
const NO_CHANNEL: HeadedChannel = { id: "", name: "", purpose: "" };

/**
 * `drawn` as last drawn while `holding`, else as it is now. Note that what
 * is handed back while holding is the element drawn before, which React
 * draws nothing anew for.
 */
function useHeldWhile<Drawn>(holding: boolean, drawn: Drawn): Drawn {
  const held = useRef(drawn);
  const shown = holding ? held.current : drawn;
  useLayoutEffect(() => {
    held.current = shown;
  });
  return shown;
}

/** The window's Inbox, in the task's place: every task's items and every automation's, and the chosen one read beside them; a memo boundary, as the module's head says. */
export const DesktopInbox = memo(function DesktopInbox({
  tasks,
  room = SHELL_ROOM.WIDE,
}: {
  tasks: TasksControl;
  /** The room the stage gives; narrow, a phone's, the list is headed as a phone's page is (`phone-head.tsx`). */
  room?: ShellRoom;
}): React.JSX.Element {
  // New task is the way on from an Inbox with nothing in it, wherever an account can start one.
  const newTask = tasks.signedIn ? tasks.onNewTask : undefined;
  // With Channels on, a row's ⋯ moves its thread to another channel, and a channel chosen narrows the Inbox to its own items.
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const narrowed = useInboxNarrowed();
  const channelPlace = useChannelPlace();
  const channels = useChannels(channelsOn ? tasks.workspace?.id : undefined);
  // A channel chosen that is open no more is looked for among the archived ones, and shown to read where it is one.
  const chosenGone =
    narrowed &&
    channels.channels !== undefined &&
    channelPlace.channelId !== undefined &&
    !channels.channels.some((each) => each.id === channelPlace.channelId);
  const archived = useArchivedChannels(chosenGone ? tasks.workspace?.id : undefined);
  const channelState = channelShown(
    narrowed ? channels.channels : undefined,
    channelPlace.channelId,
    archived.channels,
  );
  const archivedShown =
    channelState.kind === CHANNEL_SHOWN.ARCHIVED ? channelState.channel : undefined;
  const channel: HeadedChannel | undefined =
    channelState.kind === CHANNEL_SHOWN.CHANNEL ? channelState.channel : archivedShown;
  const channelHead = useChannelHead(
    channel ?? NO_CHANNEL,
    archivedShown === undefined
      ? undefined
      : {
          archivedAt: archivedShown.archivedAt,
          onUnarchive: () => channels.onUnarchive(archivedShown.id),
        },
  );
  const {
    view,
    act,
    choices,
    folds,
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
  } = useInboxListing(tasks, narrowed ? channelPlace.channelId : undefined);
  // An item opened into a channel from a link, which names its item and not its channel, narrows the Inbox to its own channel once read.
  useThreadChannel(narrowed ? chosen?.item : undefined);
  // Leaving a channel is having looked at it, so its row no longer reads unread for what was posted before.
  const shownChannelId = channel?.id;
  const look = useRef(channels.onLook);
  look.current = channels.onLook;
  useEffect(
    () => (shownChannelId === undefined ? undefined : () => look.current(shownChannelId)),
    [shownChannelId],
  );
  // Every item standing, which Mark all as read marks and a thread is moved among.
  const standingItems = useMemo(() => standing.flatMap(({ items }) => items), [standing]);
  const unread = useMemo(() => anyUnread(standing), [standing]);
  // An item's ⋯, its row's and its thread bar's, moves its thread to another open channel, which the channels' counts are read again for.
  const move = useMoveThreadDialog({
    channels: channels.channels ?? NO_CHANNELS,
    threads: standingItems,
    shown: tasks.shown,
    onMove: channels.onMove,
    onMoved: channels.onRefresh,
  });
  const { ask: askThreadMove } = move;
  const askMove =
    channelsOn && askThreadMove !== undefined
      ? (listed: InboxListed) => askThreadMove(listed.item)
      : undefined;
  const general = generalChannel(channels.channels ?? NO_CHANNELS);
  // A thread started from an item's box lands in that item's channel where it is open, else in #general, where a thread starts.
  const landsIn = (from: InboxItem): Channel | undefined =>
    channelsOn
      ? (channels.channels?.find((each) => each.id === from.channelId) ?? general)
      : undefined;
  // It is moved there once started, since a thread starts in #general; a move refused says why.
  const toast = useToast();
  const startedIn = (started: InboxItem, from: InboxItem) => {
    const into = landsIn(from)?.id;
    if (into === undefined || started.channelId === into) return;
    channels.onMove(started.id, into).then((refused) => {
      if (refused === undefined) return channels.onRefresh();
      toast({
        words: refused.words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface: FAILURE_SURFACE.CHANNEL_MOVE,
          cause: refused.cause,
          about: { inboxItemId: started.id, agentId: started.agentId, channelId: into },
        },
      });
    });
  };
  // Note that a phone shows one thing at a time across the screen: the list, or the item in its place.
  const phone = room === SHELL_ROOM.NARROW;
  // A missing item's pane stands where its item would, and so does one whose read failed, so a narrow Inbox shows the notice rather than the list.
  // Note that the Inbox's own way back to its list chooses nothing through the listing, which drops a choice still on its way (`use-inbox-listing.ts`).
  const { onSingle } = view;
  const columns = useInboxColumns(
    chosen?.item.id ?? (missing || chosenFailed ? asked?.itemId : undefined),
    { onClear: clear, onSingle },
  );
  const timeOpen = useInboxItemOpenSpan(chosen?.item.id, live.read);
  useInboxOpenSpan(listedRows.length);
  // A row's press and Next's open their item alike, the keyboard following it.
  const open = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onOpen(listed.item.id);
  };
  const { onMark: markItem } = marks;
  // K and J choose the item above or below, the keyboard following it to its row.
  const step = (listed: InboxListed) => {
    timeOpen(listed.item.id);
    choose(listed);
    columns.onStep();
  };
  const { pager, direction } = useInboxPager(steps, list, chosen?.item.id, step, {
    shown: tasks.shown,
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
  // Where the chosen item's words are read: its plan's workspace and repository, or, with no plan, its agent's own.
  const place = chosen === undefined ? undefined : answerPlace(chosen, agents, tasks);
  // Where the chosen item's links are written: under its own workspace, by slug once the workspaces are read.
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
  // What the chosen item's box offers an `@`, read under that workspace and repository.
  const readMentionAgents = useMentionAgentsReader(place?.workspaceId, tasks.tasks, named.models);
  // An item's box starts a new thread with its agent, which lands in the item's channel and opens in its place.
  const { startInboxThread } = agents;
  const newThread: InboxNewThread | undefined = tasks.signedIn
    ? {
        channelOf: landsIn,
        workspaceId: tasks.workspace?.id,
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
              startedIn(answer.item, item);
              // An Inbox narrowed to a channel turns to the one the thread lands in, which is #general's where the item's is archived.
              openChannelThread(answer.item.id, landsIn(item)?.id);
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
  // A file the item names opens beside the Inbox as the panel's preview; pressed with ⌘, it goes to the item's task, opened there.
  const openFile = (ref: CodeRef, commit: string | undefined) => {
    const going = taskId !== undefined && pressedWithCommand() ? taskId : undefined;
    if (going === undefined) return sidePanel.onPreviewFile(ref, commit);
    if (commit !== undefined) return tasks.onShowFile(going, ref, commit);
    // A file read at no commit is drawn on the task it is browsed on, so it is opened here first, on the item's task, and then shown there.
    sidePanel.onOpenFile(ref);
    tasks.onShowPanelTab(going, { file: ref.path });
  };
  // A file the item's words or box name opens as its code does, in the panel beside the Inbox.
  const openMentionedFile = (path: string, lines: MentionLines | undefined) =>
    openFile(fileRef(path, lines), lines?.commit);
  const mentions =
    place === undefined
      ? undefined
      : tasklessMentions(place, tasks.onShowMention, readMentionAgents, {
          onOpenFile: openMentionedFile,
        });
  const drawing = useSidePanelDrawing(sidePanel);
  const views = useTabViews();
  const { onArea, focus } = useColumnFocus();
  // The panel holds the keys while the focus went into it last, or while it fills the window over the Inbox.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);
  // The item shown is read as it opens, and U marks it, only while the Inbox holds the keys and the panel does not cover it.
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
  // ⌘O opens what holds the keys in its full place: the agent the panel shows while it holds them, in its task; else the item shown, in its task, or on its agent's page where it has none.
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
  const openHere: OpenHere = (href) => {
    const target = inboxPanelTarget(href, {
      taskId,
      repository:
        taskId === undefined ? (place?.repository ?? null) : (chosenTask?.repository ?? null),
      pullRequests,
      agentIds: named.agentIds,
      heldIds,
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
  // The chosen item's thread, beside the list or in its place.
  const itemPane = (listed: InboxListed) => (
    <OpenHereProvider value={openHere}>
      <SkillFiles
        source={agents.readSkills}
        onOpen={(skill) => {
          // Note that a skill's file opens in the panel beside the Inbox, as a file the item names does, and on GitHub where the panel cannot open it.
          if (place === undefined) return;
          const url = encodeMention({ kind: MENTION_KIND.FILE, path: skill.path }, place);
          if (!openHere(url)) appPlatform().openGitHub(url);
        }}
      >
        {/* The item's links are written under its own workspace, which a link may open outside the one listed. */}
        <LinkWorkspaceProvider value={chosenLinkWorkspace}>
          {/* Its thread's words read their mentions where its box does, so a file it names opens as its code does. */}
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
              next={next}
              mentions={mentions}
              channelName={channel?.name}
              newThread={newThread}
              phone={
                phone ? { onShowPanel: sidePanel.open ? undefined : sidePanel.onToggle } : undefined
              }
              doors={{
                ...paneDoors(tasks, listed.holder, {
                  act,
                  panelFor,
                  place,
                  besideAgents: named.agentIds,
                }),
                onMark: markItem,
                onClose: closeItem,
                onMove: channelsOn ? askThreadMove : undefined,
              }}
            />
          </TaskMentions>
        </LinkWorkspaceProvider>
      </SkillFiles>
    </OpenHereProvider>
  );
  // The panel stands for the chosen item's task, so its links are written under the item's own workspace, as its pane's are.
  // Note that it follows the window's choice, so it stands as last drawn while a choice made here settles (`useChoiceFirst`).
  const heldPanel = useHeldWhile(
    settling,
    drawing.panel ? (
      <LinkWorkspaceProvider value={chosenLinkWorkspace}>
        <InboxSidePanel
          tasks={tasks}
          drawing={{ ...drawing, panel: drawing.panel }}
          focused={sideFocused}
          taskId={taskId}
          panelFor={panelFor}
          repository={chosenTask?.repository ?? place?.repository ?? agents.agentRepository ?? null}
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
            {/* Hidden rather than left out while the panel fills the window, as a plan's column is. */}
            <PageFind
              page={FIND_PAGE.INBOX}
              active={tasks.shown && !sideFocused}
              hidden={sidePanel.fullScreen}
            >
              <div className={INBOX_VIEW} ref={columns.ref} data-columns={columns.shown}>
                {narrowed && channels.channels === undefined && channels.failed ? (
                  <ChannelsNotRead onRetry={channels.onRefresh} />
                ) : channelState.kind === CHANNEL_SHOWN.MISSING ? (
                  <ChannelMissing
                    onGeneral={
                      general === undefined ? undefined : () => channelPlace.onChoose(general.id)
                    }
                  />
                ) : (
                  <InboxList
                    view={list}
                    scene={narrowed ? channelPlace.channelId : undefined}
                    chosen={chosen?.item.id}
                    columns={columns.shown}
                    rows={columns.rows}
                    head={{
                      shown: tasks.shown,
                      show: choices,
                      view: { choices, folds },
                      readAll: {
                        unread,
                        onMarkAll: () => marks.onMarkAll(standingItems),
                      },
                      search,
                      phone:
                        room === SHELL_ROOM.NARROW
                          ? { start: <NewTaskButton tasks={tasks} /> }
                          : undefined,
                      channel: channel === undefined ? undefined : channelHead,
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
                      />
                    }
                    onChoose={open}
                    onMark={(listed, unread, saying) => markItem(listed.item, unread, saying)}
                    onClose={closeItem}
                    onAskMove={askMove}
                    onPointing={onPointing}
                  />
                )}
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
                        placement={ERROR_STATE_PLACEMENT.CENTRED}
                        onRetry={onRetryChosen}
                      >
                        {ITEM_NOT_READ}
                      </ErrorState>
                    ) : failed || reading || filteredOut || searched !== undefined ? null : (
                      // Note that the list says the read failed, or what the filter or its search left out, so the pane beside it stands bare.
                      <InboxPaneEmpty listed={listedRows.length} newTask={newTask} />
                    )}
                  </section>
                ) : (
                  itemPane(chosen)
                )}
              </div>
            </PageFind>
            {move.dialog}
            {heldPanel}
          </div>
        </AutomationDirectory>
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});

/**
 * The chosen item's thread (`InboxPane`), its box's drafts read here,
 * where the box is drawn, rather than by the page around it, so a word typed
 * draws the pane alone (`useInboxCardDrafts`); and its notice acknowledged
 * as it opens, once its holder's held read holds it, unless its box holds
 * words (`useNodOnOpen`).
 */
function DraftedInboxPane({
  control,
  scope,
  opened,
  readerId,
  ...pane
}: Omit<React.ComponentProps<typeof InboxPane>, "control"> & {
  /** The chosen item's holder's own held read, without its cards' drafts. */
  control: HeldTaskInboxControl;
  /** Whose read it is, under which its cards keep their drafts. */
  scope: Parameters<typeof useInboxCardDrafts>[1];
  /** The item shown while the Inbox holds the keys, which is acknowledged as it opens; none while it is not. */
  opened: InboxListed | undefined;
  readerId: string | undefined;
}): React.JSX.Element {
  const live = { ...control, ...useInboxCardDrafts(control, scope) };
  useNodOnOpen({ shown: opened, readerId, control: live });
  return <InboxPane {...pane} control={live} />;
}

/** A file the item names as its code names it: its path, and its lines where it names them. */
function fileRef(path: string, lines: MentionLines | undefined): CodeRef {
  return lines === undefined
    ? { path }
    : { path, startLine: lines.startLine, endLine: lines.endLine };
}

/**
 * Where the chosen item's words are read in the window's Inbox, which
 * stands on no plan's page: its plan's workspace, by its slug, and
 * repository, or, for an agent with no plan, the agent's own as its read
 * names them, or its line in main's read before that read lands, never its
 * group's, which agents of other repositories share and which an agent a
 * link reached stands under with none. Its box
 * mentions what that repository and workspace hold, as the page of an
 * agent no plan holds does (`tasklessMentions`), and its skills' files
 * open there. None until both are known.
 */
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
  repositoryPlace,
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
  /** The workspace and repository the panel reads a file through where the item's agent is on no task. */
  repositoryPlace: PanelRepositoryPlace | undefined;
  pages: TasksControl["inboxView"]["pages"];
  agents: AgentsControl;
  views: TabViews;
  /** What the item's box offers an `@`, which the composer of an agent's transcript beside it offers too. */
  mentions: TaskMentionsValue | undefined;
  /** Where the panel heads itself on a phone, its way back shutting it to the item (`SidePanel`'s `phone`). */
  phone: { readonly back: string; readonly onBack: () => void } | undefined;
}): React.JSX.Element {
  const { panel } = drawing;
  const terminals = useCapability(HOST_CAPABILITY.TERMINALS);
  const openTarget = (target: ToolTarget) => {
    if (target.kind === TOOL_TARGET.PAGE) return panel.onPreview({ page: target.page });
    if (target.kind === TOOL_TARGET.TASK) {
      return target.agent === undefined
        ? tasks.onShowTask(target.task)
        : tasks.onShowAgent(target.task, target.agent);
    }
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
  // through the agents the Inbox read of the item's task.
  const cards = taskCards({
    agents,
    held: views.held,
    chosen: (opened) =>
      isAgentTab(opened) && panel.tab !== undefined && isTranscriptTab(panel.tab)
        ? panel.tab.transcript === opened.agent
        : panel.tab !== undefined && sameTab(opened, panel.tab),
    pages: taskId === undefined ? undefined : { taskId },
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
              // Note that an agent's terminal never stands beside the Inbox, so it opens on the agent's task.
              onOpenInTask: (agentId) => tasks.onShowAgent(taskId, agentId),
              onOpenTerminal: terminals
                ? (agentId) => tasks.onShowPanelTab(taskId, { terminal: agentId })
                : undefined,
            }
      }
      phone={phone}
    />
  );
}

/**
 * The code doors of an item of an agent with no task: its lines read
 * through the agent's workspace and repository, and its file opened in the
 * panel beside the Inbox, which stands for the agent and reads it the same
 * way; nothing read or opened until both are known.
 */
function tasklessCode(
  tasks: TasksControl,
  act: ReturnType<typeof useAct>["act"],
  place: TasklessPlace | undefined,
): InboxCodeDoors {
  if (place === undefined || place.repository === null) {
    return { repository: null, readFile: UNREAD_FILE, onOpenFile: () => undefined };
  }
  const { workspaceId, repository } = place;
  return {
    repository,
    readFile: (window) => act(ACT_KIND.TASKS_FILE, { workspaceId, repository, ...window }),
    onOpenFile: (ref, commit) => tasks.sidePanel.onPreviewFile(ref, commit),
  };
}

/**
 * The pane's doors for what holds its item: a task's open the task, its
 * agents' tabs, and its files, a file in the panel beside the Inbox where
 * the panel stands for the task; an automation's open its page where the
 * Automations experiment is on, its agents' own pages, and its agent's
 * files, read through its workspace and repository (`answerPlace`), in the
 * panel beside the Inbox, which stands for that agent.
 */
function paneDoors(
  tasks: TasksControl,
  holder: InboxHolder,
  seams: {
    act: ReturnType<typeof useAct>["act"];
    /** The task, or the agent, the panel beside the Inbox stands for. */
    panelFor: string | undefined;
    /** The task's agents whose transcripts the panel beside the Inbox draws: its agents not archived, once read. */
    besideAgents: readonly string[] | undefined;
    /** Where the item's words are read (`answerPlace`), whose repository an agent with no task reads its files through; none until known. */
    place: TasklessPlace | undefined;
  },
): InboxPaneDoors {
  if (holder.kind === INBOX_HOLDER.TASK) {
    const { task } = holder;
    return {
      onOpenHolder: () => tasks.onShowTask(task.id),
      // Note that the card's times count from the window's minute, so the page reads no clock.
      taskCard: taskCardOf(tasks, task, undefined),
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
  const automationId = holderAutomationId(holder);
  return {
    onOpenHolder:
      automationId !== null
        ? () => tasks.automationsView.onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId })
        : undefined,
    taskCard: undefined,
    onOpenAgent: (agentId) => tasks.agentView.onOpen(agentId),
    code: tasklessCode(tasks, seams.act, seams.place),
  };
}
