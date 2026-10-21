import { CHANNEL_KIND, type ChatChannel } from "@luke/features/chat-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import type { MentionPlace } from "@luke/features/mention-link";
import { inPinOrder } from "@luke/features/pin-order";
import {
  ArchiveIcon,
  BackIcon,
  BUTTON_SIZE,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  LIST_ROW_META,
  ListRow,
  PencilIcon,
  PlusIcon,
  SCROLL_FADE,
  ScrollArea,
  UnarchiveIcon,
  useMenu,
} from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import {
  CHAT_PLACE,
  type ChatPlace,
  type ChatRailRow,
  type ChatTaskGrouping,
  chatNames,
  chatRail,
  FOR_YOU,
} from "@luke/ui/chat-model";
import { sectionOrder, workspaceSections } from "@luke/ui/task-sections-model";
import { AtSignIcon, HashIcon, MailOpenIcon, MessagesSquareIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import { FoldingButton } from "../folding-button.js";
import { MemberDirectory } from "../member-directory.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { SpinnerRegion } from "../spinner.js";
import { AgentCard, lineSubject } from "../tasks/agent-ref.js";
import { useChatActor } from "../tasks/chat-actors.js";
import { ChatPane } from "../tasks/chat-pane.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { PlanGlyph } from "../tasks/tab-look.js";
import { markReadItem } from "../tasks/task-menu-items.js";
import { useMinute } from "../tasks/task-time.js";
import { useTaskStatus } from "../tasks/use-known-names.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { type ChannelDialogs, useChannelDialogs } from "./chat-channel-dialogs.js";
import { previewWords } from "./chat-preview.js";
import { SidebarResizeEdge } from "./desktop-sidebar.js";
import { INBOX_LIST_WIDTH, useChatListWidth } from "./folded-groups.js";
import { strandedHome } from "./move-task-dialog.js";
import { useNarrowFocus } from "./narrow-focus.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { SidebarGroupHeader } from "./sidebar-group-header.js";
import { TaskStatusMark, taskCardOf } from "./task-card.js";
import { EDGE_SIDE, useResizableEdge } from "./use-resizable-edge.js";

/**
 * desktop-chat.tsx -- the window's Chat: the workspace's channels and direct messages in a rail of their own, and For you or the channel chosen read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Chat row is
 * marked while it does, as the window's Inbox (`desktop-inbox.tsx`) does.
 * The rail is drawn from the sidebar's own pieces: For you at its head,
 * counting what waits on the developer, then the channels, then the direct
 * messages, each group under its heading as Settings' page list's are
 * (`.section-heading`), each row counting what in it the developer has not read and
 * in the unread weight while anything is (`chat-model.ts`). A direct
 * message's row leads with the other member's mark and is named by who it
 * is with. Each row behaves as a sidebar task's and an Inbox item's do: it
 * hangs its card while the pointer rests on it, a task's channel ends in its
 * task's mark, and a right-click, a hover button, or a swipe marks it read;
 * each task group is headed as the sidebar heads the same tasks, and a
 * group's ⋯ marks every place in it read. A press on a row shows its place in
 * the pane beside the rail (`chat-pane.tsx`). The agents are named from
 * the plans' summaries, the way the sidebar names them, and from the lines
 * the chat read carries where those name more. With nothing read, it says
 * so under Chat's glyph. Any row of the sidebar leaves it for the plan it
 * stood over; Escape does not, as it does not leave the Inbox, so a stray
 * press never loses the place being read. A narrow room shows the rail or
 * the place, one at a time (`hiddenColumns`): Chat opens on its rail, and a
 * place chosen there, or shown from elsewhere, stands alone the whole width,
 * under a way back to the rail.
 */

/** The workspace a chip's link is written in, the chat's own; none while no workspace is listed. */
function mentionPlaceOf(tasks: TasksControl): MentionPlace | undefined {
  const { workspace } = tasks;
  if (workspace === undefined) return undefined;
  return { workspace: workspace.slug ?? workspace.id, repository: null };
}

/** What the way back from a place to the rail says, in a narrow room. */
const CHAT_LIST = "Chat";

/**
 * How the rail groups the tasks' channels: as the reader's sidebar groups
 * the tasks, the pinned first in the pins' order, then each of the
 * reader's sections in the listed workspace.
 */
function taskGrouping(tasks: TasksControl): ChatTaskGrouping {
  const pinned = inPinOrder(
    tasks.tasks.filter((task) => task.pinnedAt !== undefined),
    (task) => ({ position: task.pinPosition, at: task.pinnedAt ?? 0 }),
  ).map((task) => task.id);
  const workspaceId = tasks.workspace?.id;
  const state = tasks.taskSections;
  const sections =
    workspaceId === undefined
      ? []
      : workspaceSections(state, workspaceId).map((section) => ({
          id: section.id,
          title: section.title,
          icon: section.icon,
          taskIds: sectionOrder(state, section.id).map((entry) => entry.taskId),
        }));
  return { pinned, sections };
}

/** The room the place beside the rail keeps however wide the rail is dragged, as the Inbox's item keeps beside its list. */
const PANE_RESERVE = 560;

/** The rail's width as drawn: as dragged, but never so wide the place beside it has less than its room. */
function drawnWidth(width: number): string {
  return `min(${width}px, max(${INBOX_LIST_WIDTH.MIN}px, 100cqw - ${PANE_RESERVE}px))`;
}

/** What a row's unread dot says to a screen reader, and what a group's count counts. */
const UNREAD_WORDS = "Unread";
const UNREAD_NOUN = { one: "unread", many: "unread" } as const;

/** What For you's row says under its name. */
const NOTHING_WAITS = "Nothing waits on you";
function waitingWords(count: number): string {
  return `${count} ${count === 1 ? "waits" : "wait"} on you`;
}

/** The keys of the rail's groups no task's group names. */
const RAIL_GROUP = {
  CHANNELS: "channels",
  ARCHIVED: "archived",
  DIRECT: "direct",
} as const;

/** Which of the rail's groups a group is among: the rail's own, or the tasks' as the sidebar groups them, each keyed apart. */
const RAIL_SPACE = {
  RAIL: "rail",
  TASKS: "tasks",
} as const;
type RailSpace = (typeof RAIL_SPACE)[keyof typeof RAIL_SPACE];

/** A group of the rail as drawn: which groups it is among, its key there, name, glyph, places, and whether it starts folded. */
interface RailGroupShown {
  readonly space: RailSpace;
  readonly key: string;
  readonly name: string;
  readonly glyph: React.ReactNode;
  readonly rows: readonly ChatRailRow[];
  readonly foldedAtFirst: boolean;
}

/** The rail's groups as drawn, in three runs: those before the tasks', the tasks', and those after. */
interface RailGroupsShown {
  readonly lead: readonly RailGroupShown[];
  readonly tasks: readonly RailGroupShown[];
  readonly trail: readonly RailGroupShown[];
}

/** The rail's groups in order, as the sidebar's stand: the channels, the tasks' as the sidebar groups the tasks, then the archived folded and the direct messages, each run drawn as its own list so a key is only ever its own group's. */
function railGroups(rail: ReturnType<typeof chatRail>): RailGroupsShown {
  const held = (group: RailGroupShown) => group.rows.length > 0;
  return {
    lead: [
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.CHANNELS,
        name: "Channels",
        glyph: <HashIcon />,
        rows: rail.channels,
        foldedAtFirst: false,
      } satisfies RailGroupShown,
    ].filter(held),
    tasks: rail.tasks
      .map(
        (group): RailGroupShown => ({
          space: RAIL_SPACE.TASKS,
          key: group.key,
          name: group.title,
          // Note that Pinned and Tasks wear no glyph, and a section its own icon or none, as the sidebar heads them.
          glyph: sectionGlyph(group.icon),
          rows: group.rows,
          foldedAtFirst: false,
        }),
      )
      .filter(held),
    trail: [
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.ARCHIVED,
        name: "Archived",
        glyph: <ArchiveIcon />,
        rows: rail.archived,
        foldedAtFirst: true,
      } satisfies RailGroupShown,
      {
        space: RAIL_SPACE.RAIL,
        key: RAIL_GROUP.DIRECT,
        name: "Direct messages",
        glyph: <AtSignIcon />,
        rows: rail.direct,
        foldedAtFirst: false,
      } satisfies RailGroupShown,
    ].filter(held),
  };
}

/** Which of the rail's groups stand folded, for as long as Chat stands: each as it starts until toggled, the toggled kept apart for each space. */
function useRailFolds() {
  const [toggled, setToggled] = useState<Readonly<Record<RailSpace, ReadonlySet<string>>>>({
    [RAIL_SPACE.RAIL]: new Set(),
    [RAIL_SPACE.TASKS]: new Set(),
  });
  return {
    folded: (group: RailGroupShown) => group.foldedAtFirst !== toggled[group.space].has(group.key),
    toggle: (group: RailGroupShown) =>
      setToggled((was) => {
        const next = new Set(was[group.space]);
        if (!next.delete(group.key)) next.add(group.key);
        return { ...was, [group.space]: next };
      }),
  };
}

/** What the press that opens a topic channel is called. */
const NEW_CHANNEL = "New channel";

/** What the view says where no chat is read. */
const NO_CHAT = "Chat is not available yet.";

/** What the view says where the workspace's chat could not be read. */
const CHAT_FAILED = "The workspace's chat could not be read.";

/** Whether a row stands for the place shown. */
function shows(place: ChatPlace, row: ChatRailRow): boolean {
  return place.kind === CHAT_PLACE.CHANNEL && place.channelId === row.channel.id;
}

/** What a row's hover button and swipe that mark it read are called. */
const MARK_READ = "Mark as read";
const SWIPE_READ = "Read";

/** What the press on a group's header that marks every place in it read is called. */
const MARK_ALL_READ = "Mark all as read";

/**
 * The card a place's row hangs, as the sidebar and the Inbox hang the same
 * thing: a task's channel its task's, a direct message the other member's,
 * an agent's tab's card naming its task or a person's; none for a channel
 * of the workspace's own, whose row names it whole.
 */
function placeCard(
  tasks: TasksControl,
  row: ChatRailRow,
  actorOf: (memberId: string) => Actor,
  now: number,
): React.ReactNode {
  const { channel, other } = row;
  if (channel.kind === CHANNEL_KIND.TASK) {
    const task = tasks.tasks.find((each) => each.id === channel.planId);
    return task === undefined ? undefined : taskCardOf(tasks, task, now);
  }
  if (other?.member === undefined) return undefined;
  if (other.agent !== undefined) {
    const { models } = tasks.agents;
    const subject = lineSubject(other.agent, models, tasks.me);
    return <AgentCard subject={subject} models={models} foot={other.taskName} />;
  }
  return actorCard(actorOf(other.member.id));
}

/** A topic's actions, from its head's ⋯ or its row's menu: edit its name and purpose and archive it, or bring an archived one back. */
function topicActionGroups(channel: ChatChannel, dialogs: ChannelDialogs): MenuAction[][] {
  if (channel.archived) {
    return [
      [
        {
          label: "Bring back channel",
          icon: <UnarchiveIcon />,
          onSelect: () => dialogs.askArchive(channel),
        },
      ],
    ];
  }
  return [
    [{ label: "Edit channel", icon: <PencilIcon />, onSelect: () => dialogs.askEdit(channel) }],
    [
      {
        label: "Archive channel",
        icon: <ArchiveIcon />,
        onSelect: () => dialogs.askArchive(channel),
      },
    ],
  ];
}

/** One channel's or direct message's row: its glyph or the other member's mark, its name, what it says after, its count, its card, and its menu. */
function RailRow({
  tasks,
  row,
  current,
  actorOf,
  now,
  dialogs,
  shown,
  onRead,
  onChoose,
}: {
  tasks: TasksControl;
  row: ChatRailRow;
  current: boolean;
  actorOf: (memberId: string) => Actor;
  now: number;
  dialogs: ChannelDialogs;
  /** Whether Chat is on screen, which a menu does not outlive. */
  shown: boolean;
  onRead: (channelIds: readonly string[]) => void;
  onChoose: () => void;
}): React.JSX.Element {
  const other = row.other?.member;
  const { latest, channel } = row;
  // A direct message is named by who it is with, both of its two where the reader is neither (`channelLabel`).
  const title = row.label;
  const taskStatus = useTaskStatus(channel.planId);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.CHAT, channelId: channel.id });
  const mark =
    other !== undefined ? (
      <ActorMark actor={actorOf(other.id)} size={ACTOR_SIZE.INLINE} />
    ) : channel.kind === CHANNEL_KIND.TASK ? (
      <PlanGlyph status={taskStatus} />
    ) : (
      <HashIcon />
    );
  const task =
    channel.kind === CHANNEL_KIND.TASK
      ? tasks.tasks.find((each) => each.id === channel.planId)
      : undefined;
  const said = latest === undefined ? "" : previewWords(latest);
  // Note that the service never moves a read back, so a row offers Mark as read alone, while something waits.
  const read = row.unread > 0 ? () => onRead([channel.id]) : undefined;
  const groups = [
    read === undefined ? [] : [markReadItem({ unread: true, onMark: read })],
    copyLink === undefined ? [] : [copyLink],
    ...(channel.kind === CHANNEL_KIND.TOPIC ? topicActionGroups(channel, dialogs) : []),
  ].filter((group) => group.length > 0);
  return (
    <PlaceRow
      mark={mark}
      title={title}
      preview={
        latest === undefined
          ? undefined
          : `${actorName(actorOf(latest.authorId))}${said === "" ? "" : `: ${said}`}`
      }
      at={latest?.postedAt}
      now={now}
      unread={row.unread > 0}
      current={current}
      card={placeCard(tasks, row, actorOf, now)}
      end={
        task === undefined ? undefined : (
          <TaskStatusMark task={task} stranded={strandedHome(tasks, task)} />
        )
      }
      groups={groups}
      shown={shown}
      onRead={read}
      onChoose={onChoose}
    />
  );
}

/**
 * One place of the rail as a row of the Inbox's own list (`ListRow`): the
 * blue dot in a gutter where something waits unread, its mark, its name in
 * the unread weight while it does, at the line's end what its row says
 * there and when it last spoke, and under it who said what last. It hangs
 * its card, or its name alone, while the pointer rests on it, a
 * right-click opens its menu where it has one, and while something waits
 * unread in it, Mark as read stands at its end on hover and a swipe right
 * does it, as an Inbox row's do.
 */
function PlaceRow({
  mark,
  title,
  preview,
  at,
  now,
  unread,
  current,
  card,
  end,
  groups,
  shown,
  onRead,
  onChoose,
}: {
  mark: React.ReactNode;
  title: string;
  preview: string | undefined;
  at: number | undefined;
  now: number;
  unread: boolean;
  current: boolean;
  /** The card it hangs while the pointer rests on it; none hangs its name alone. */
  card: React.ReactNode;
  /** Said at the line's end before its time: a task's agent at work or its pull request. */
  end: React.ReactNode;
  /** Its menu's groups of actions, a right-click away; none opens no menu. */
  groups: readonly MenuAction[][];
  /** Whether Chat is on screen, which its menu does not outlive. */
  shown: boolean;
  /** Marks it read; none where nothing in it waits unread. */
  onRead: (() => void) | undefined;
  onChoose: () => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const press = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control, as a sidebar task's row does.
  const region = useRef<HTMLElement | null>(null);
  const hold = useCallback((element: HTMLElement | null) => {
    press.current = element;
    region.current = element?.parentElement ?? null;
  }, []);
  return (
    <>
      <RowHintOptions card={card} cardBeside cardRegion={region}>
        <ListRow
          ref={hold}
          leading={
            <>
              {/* Note that the gutter stands on every row, so the marks line up whether a row wears the dot or not. */}
              <span className="inbox-row-gutter">
                {unread ? <span className="inbox-row-unread" /> : null}
              </span>
              <span className="inbox-row-mark">{mark}</span>
            </>
          }
          title={title}
          description={preview}
          meta={
            <span className="home-row-meta">
              {unread ? <span className="visually-hidden">{UNREAD_WORDS}</span> : null}
              {end}
              {at === undefined ? null : <RelativeTime at={at} now={now} hint={false} />}
            </span>
          }
          metaAt={LIST_ROW_META.TITLE}
          ink={LIST_ROW_INK.SIDEBAR}
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          menuOpen={menu.open !== undefined}
          hint={{ Hint: RowHint, label: title }}
          onPress={onChoose}
          contextMenu={groups.length === 0 ? undefined : menu.contextMenu(press)}
          actions={
            onRead === undefined ? undefined : (
              <Tooltip label={MARK_READ}>
                <IconButton
                  icon={<MailOpenIcon />}
                  label={MARK_READ}
                  size={BUTTON_SIZE.COMPACT}
                  onClick={onRead}
                />
              </Tooltip>
            )
          }
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          swipe={
            onRead === undefined
              ? undefined
              : { label: SWIPE_READ, icon: <MailOpenIcon />, onAct: onRead }
          }
        />
      </RowHintOptions>
      {menu.drawn === undefined || groups.length === 0 ? null : (
        <ActionMenu
          label={`${title} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * A group of the rail under the sidebar's own group header: its name,
 * folding, and how many of its places wait unread; folded, the place shown
 * stays in sight. Its ⋯, and a right-click on its header, offer Mark all
 * as read, as a sidebar section's head does.
 */
function RailGroup({
  name,
  glyph,
  rows,
  folded,
  shown,
  onToggle,
  onRead,
  row,
  current,
}: {
  name: string;
  glyph: React.ReactNode;
  rows: readonly ChatRailRow[];
  folded: boolean;
  /** Whether Chat is on screen, which its menu does not outlive. */
  shown: boolean;
  onToggle: () => void;
  onRead: (channelIds: readonly string[]) => void;
  row: (each: ChatRailRow) => React.JSX.Element;
  current: (each: ChatRailRow) => boolean;
}): React.JSX.Element {
  const drawn = folded ? rows.filter(current) : rows;
  const unread = rows.filter((each) => each.unread > 0);
  const menu = useMenu(shown);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const groups: MenuAction[][] = [
    [
      {
        label: MARK_ALL_READ,
        icon: <MailOpenIcon />,
        disabled: unread.length === 0,
        onSelect: () => onRead(unread.map((each) => each.channel.id)),
      },
    ],
  ];
  return (
    <div className="sidebar-repository">
      <SidebarGroupHeader
        glyph={glyph}
        name={name}
        folded={folded}
        count={unread.length}
        noun={UNREAD_NOUN}
        steady
        menuOpen={menu.open !== undefined}
        contextMenu={menu.contextMenu(ellipsis)}
        onToggle={onToggle}
        actions={
          <Tooltip label="Group actions">
            <IconButton
              ref={ellipsis}
              icon={<EllipsisIcon />}
              label={`Actions for ${name}`}
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
          </Tooltip>
        }
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${name} actions`}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {drawn.length === 0 ? null : <ul className="sidebar-tasks">{drawn.map(row)}</ul>}
    </div>
  );
}

/**
 * The window's Chat, in the plan's place: the rail, and the place chosen
 * beside it, inside the listed workspace's members read, as the Inbox
 * stands, so every member is drawn with their photo and card and a link
 * names its workspace.
 */
export function DesktopChat(props: {
  tasks: TasksControl;
  room: ShellRoom;
  accountName: string | undefined;
}): React.JSX.Element {
  const { tasks } = props;
  return (
    <LinkWorkspaceProvider value={tasks.workspace?.slug ?? tasks.workspace?.id}>
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <ChatView {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
}

/** The rail and the place chosen, read against the members around it. */
function ChatView({
  tasks,
  room,
  accountName,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  accountName: string | undefined;
}): React.JSX.Element {
  const view = tasks.chatView;
  const now = useMinute();
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useMemo(
    () => chatNames(listed, read?.agents ?? [], accountName),
    [listed, read, accountName],
  );
  const dialogs = useChannelDialogs(tasks.workspace?.id, read?.answer, view.onChannel, view.open);
  const actorOf = useChatActor(read?.answer, names);
  const folds = useRailFolds();
  // Note that For you is where Chat opens, so its link is Chat's own.
  const copyChat = useCopyLinkItem()({ kind: LINK_PLACE.CHAT });
  const { width, onResize } = useChatListWidth();
  const edge = useResizableEdge({
    side: EDGE_SIDE.RIGHT,
    width,
    bounds: INBOX_LIST_WIDTH,
    reserve: () => PANE_RESERVE,
    label: "Resize chat list",
    onResize,
  });
  const screen = useNarrowFocus(room, view.listed);
  if (read === undefined || view.failed) {
    // Nothing read yet: a read that did not answer, one still out, or no chat to read at all.
    const standIn = view.failed ? (
      <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
        {CHAT_FAILED}
      </ErrorState>
    ) : view.available ? (
      <SpinnerRegion label="Loading chat" />
    ) : (
      <EmptyState icon={<MessagesSquareIcon />}>{NO_CHAT}</EmptyState>
    );
    return (
      <div className="chat-view">
        <section className="chat-stream" aria-label="Chat">
          <header className="desktop-toolbar" />
          {standIn}
        </section>
      </div>
    );
  }
  const chat = read.answer;
  const rail = chatRail(chat, names, taskGrouping(tasks));
  const hidden = hiddenColumns(room, view.listed);
  const groups = railGroups(rail);
  const forYouGroups = copyChat === undefined ? [] : [[copyChat]];
  const row = (each: ChatRailRow) => (
    <RailRow
      key={each.channel.id}
      tasks={tasks}
      row={each}
      current={shows(view.place, each)}
      actorOf={actorOf}
      now={now}
      dialogs={dialogs}
      shown={view.open}
      onRead={view.onRead}
      onChoose={() => view.onChoose({ kind: CHAT_PLACE.CHANNEL, channelId: each.channel.id })}
    />
  );
  const group = (shown: RailGroupShown) => (
    <RailGroup
      key={shown.key}
      name={shown.name}
      glyph={shown.glyph}
      rows={shown.rows}
      folded={folds.folded(shown)}
      shown={view.open}
      onToggle={() => folds.toggle(shown)}
      onRead={view.onRead}
      row={row}
      current={(each) => shows(view.place, each)}
    />
  );
  return (
    <div ref={screen} className="chat-view">
      <nav
        className="chat-rail"
        aria-label="Chat"
        hidden={hidden.list}
        style={{ width: room === SHELL_ROOM.NARROW ? undefined : drawnWidth(width) }}
      >
        <header className="desktop-toolbar chat-rail-bar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Chat</h1>
          </div>
          <div className="desktop-toolbar-actions">
            <Tooltip label={NEW_CHANNEL}>
              <IconButton icon={<PlusIcon />} label={NEW_CHANNEL} onClick={dialogs.askNew} />
            </Tooltip>
          </div>
        </header>
        <ScrollArea fade={SCROLL_FADE.START}>
          <div className="chat-rail-body">
            <ul className="sidebar-tasks">
              <PlaceRow
                mark={<AtSignIcon />}
                title="For you"
                preview={rail.forYou === 0 ? NOTHING_WAITS : waitingWords(rail.forYou)}
                at={undefined}
                now={now}
                unread={rail.forYou > 0}
                current={view.place.kind === CHAT_PLACE.FOR_YOU}
                card={undefined}
                end={undefined}
                groups={forYouGroups}
                shown={view.open}
                onRead={undefined}
                onChoose={() => view.onChoose(FOR_YOU)}
              />
            </ul>
            {groups.lead.map(group)}
            {groups.tasks.map(group)}
            {groups.trail.map(group)}
          </div>
        </ScrollArea>
        {room === SHELL_ROOM.NARROW ? null : <SidebarResizeEdge edge={edge} />}
      </nav>
      <ChatPane
        chat={chat}
        names={names}
        place={view.place}
        mentionPlace={mentionPlaceOf(tasks)}
        now={now}
        openLink={openLink}
        onPost={view.onPost}
        onAnswer={view.onAnswer}
        channelActions={(channel) =>
          channel.kind === CHANNEL_KIND.TOPIC ? (
            <TopicActions channel={channel} dialogs={dialogs} shown={view.open} />
          ) : undefined
        }
        readPicture={view.readPicture}
        lead={
          room === SHELL_ROOM.NARROW ? (
            <FoldingButton label={CHAT_LIST} icon={<BackIcon />} onClick={view.onList} />
          ) : undefined
        }
        hidden={hidden.item}
      />
      {dialogs.dialog}
    </div>
  );
}

/** A topic's menu at its head's end: edit its name and purpose and archive it, or bring an archived one back. */
function TopicActions({
  channel,
  dialogs,
  shown,
}: {
  channel: ChatChannel;
  dialogs: ChannelDialogs;
  shown: boolean;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const label = `#${channel.name ?? ""} actions`;
  const groups = topicActionGroups(channel, dialogs);
  return (
    <>
      <Tooltip label="Channel actions">
        <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}

/** What the plan's Chat tab says where its plan has no channel yet. */
const NO_TASK_CHANNEL = "Nothing is posted in this task's channel yet.";

/**
 * The plan's own Chat tab, in the plan's column: its channel of the
 * workspace's chat, at reading size, as the window's Chat shows it, its
 * composer posting there. A plan whose channel is not opened yet, which
 * its first post opens, says so; a chat not read yet waits on the read.
 */
export function TaskChatTab({
  tasks,
  taskId,
}: {
  tasks: TasksControl;
  taskId: string;
}): React.JSX.Element {
  const view = tasks.chatView;
  const now = useMinute();
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = tasks.tasks;
  const names = useMemo(() => chatNames(listed, read?.agents ?? [], undefined), [listed, read]);
  const channel = read?.answer.channels.find(
    (each) => each.kind === CHANNEL_KIND.TASK && each.planId === taskId,
  );
  if (read === undefined || channel === undefined) {
    return (
      <section className="chat-stream task-chat" aria-label="Chat">
        {view.failed ? (
          <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={view.onRetry}>
            {CHAT_FAILED}
          </ErrorState>
        ) : read === undefined && view.available ? (
          <SpinnerRegion label="Loading chat" />
        ) : (
          <EmptyState icon={<MessagesSquareIcon />}>{NO_TASK_CHANNEL}</EmptyState>
        )}
      </section>
    );
  }
  return (
    <ChatPane
      chat={read.answer}
      names={names}
      place={{ kind: CHAT_PLACE.CHANNEL, channelId: channel.id }}
      mentionPlace={mentionPlaceOf(tasks)}
      now={now}
      openLink={openLink}
      onPost={view.onPost}
      onAnswer={view.onAnswer}
      readPicture={view.readPicture}
    />
  );
}
