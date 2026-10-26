import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
  openAskOf,
  threadNeedsReader,
} from "@luke/features/inbox-wire";
import { readingWords } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_PRESS_REACH,
  CardPress,
  CONTROL_GROUND,
  Comment,
  CommentSkeleton,
  type ContextMenuProps,
  ControlGround,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  MoreButton,
  moreLabel,
  NOTE_LINE_LOOK,
  NoteLine,
  NotFoundIcon,
  SkeletonRegion,
  STREAM_DIVIDER,
  StreamDivider,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  UnreadMark,
  useMenu,
  VisuallyHidden,
} from "@luke/ui";
import { ArrowUpIcon, GLYPH, SlidersHorizontalIcon } from "@luke/ui/icons";
import { askScroll } from "@luke/ui/scroll-asked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  FLOATING_OVER_LOG_CLASS,
} from "../ai-elements/conversation.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { usePerson } from "../member-directory.js";
import { type AgentLine, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import {
  CHANNEL_VIEW,
  type ChannelView,
  channelTitle,
  channelViewLabel,
  emptyStreamWords,
  needsReaderCount,
  olderAsksWords,
  repliesLine,
  STREAM_ROW,
  streamRows,
  viewedThreads,
} from "./channels-model.js";
import { AskControls } from "./inbox-ask-controls.js";
import type { InboxCloser } from "./inbox-close.js";
import { VIEW_OPTIONS } from "./inbox-columns.js";
import { useInboxItemActions } from "./inbox-item-actions.js";
import {
  EMPTY_INBOX_DRAFT,
  INBOX_HOLDER,
  type InboxHolder,
  type InboxListed,
  inboxThreadSend,
  isUnread,
  knownAsk,
} from "./inbox-model.js";
import { useInboxSettler, useSettledItems } from "./inbox-settling.js";
import { useMoveThreadDialog } from "./move-thread-dialog.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { type ChannelThreadsControl, useChannelThreads, useChannelView } from "./use-channels.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";

/**
 * channel-stream.tsx -- one channel drawn as a stream of its threads, as Slack draws a channel, in the Inbox's place (STAG-547).
 *
 * The stream is headed by the channel's name and purpose and its View
 * options, the Inbox's sliders, whose menu offers Mine, Everyone, and Needs
 * me with what waits on the reader counted; the title names the view where
 * it is not Mine (`channels-model.ts`). Under it, each thread the view shows
 * is a post, oldest first, a divider before each day and the New line
 * before the first posted since the reader last looked: drawn as the
 * Inbox's thread draws a message (`Comment`), the writer's face, name, and
 * time, an agent named as the thread's pane names it (`agentSubject`), then
 * the thread's title and its first message's words. A decision
 * still open offers its options under the post with the thread's own
 * controls, numbered for no keys, and one pick answers it there; steps and
 * a written answer offer one press that opens the thread. The replies line
 * under every post shows who replied, how many replies or Reply in thread,
 * and who the open ask waits on. A post that needs the reader stands on the
 * attention tint and nothing else marks it, its ask's controls standing on
 * the column's ground over it (`ControlGround`), cleared the moment it is
 * answered, since the window's own answers are laid over the read
 * (`inbox-settling.ts`). A press anywhere on a post opens its thread in the
 * side panel beside the stream, or in its place on a phone (`onOpen`).
 * An unread thread, changed since the reader last read it or marked
 * unread, wears the Inbox's blue dot in a gutter before its writer's face
 * until it is opened (`UnreadMark`). Each post's ⋯, at its head's end under
 * the pointer, and a right-click or a long press on the post, offer the
 * thread's menu: Mark as read or unread, Copy link, Open task and Open
 * agent, Move to channel, which asks which (`move-thread-dialog.tsx`), and
 * Resolve without answering, asked first, while its ask stands open.
 * While a post that needs the reader is scrolled out of sight above, a
 * button floats over the stream's head counting them,
 * and a press scrolls the stream's own box to the nearest; never
 * `scrollIntoView`, which would scroll the window around a sliding pane
 * (`packages/panel/AGENTS.md`). Leaving the channel stamps the reader's
 * look at it, and the New line stands where it stood as the channel opened
 * while they read it.
 *
 * The stream is read by its holder (`useChannelStream`), which pages the
 * threads its view shows with K and J as well (`inbox-pager.tsx`); a thread
 * opened by a key that stands out of sight is scrolled into the stream's
 * box. Until its first read lands, the stream stands a few posts' blocks
 * through a post's own frame (`ChannelStreamSkeleton`); a first read that
 * fails says so in its place with Retry, and a later one that fails over
 * the threads held says so in a line at the stream's foot with Retry. Older
 * threads are read as the reader nears the stream's top, the log keeping
 * their place as they land above (`Conversation`'s `onNearTop`).
 */

/**
 * The stream's column, its log filling what its head leaves. Note that its
 * bar ends where its posts do while the side panel stands beside it, its
 * thread's or another tab's, whose toggle stands over no edge of it, rather
 * than past the toggle or at the sheet's edge as the window would end it.
 */
const STREAM =
  "channel-stream relative flex min-h-0 min-w-0 flex-col in-data-[panel-open=true]:[--luke-toolbar-end-at:initial]";

/** The posts' run, on the column's inset. */
const STREAM_BODY =
  "channel-stream-body flex flex-col gap-luke-4 px-column-inset pt-luke-8 pb-luke-16";

/** One post: the unread dot's gutter and the post's words, on its own ground, the hover's fill, the chosen thread's, or the attention tint where it needs the reader. */
const POST =
  "channel-post relative flex gap-luke-4 rounded-luke-10 py-luke-8 ps-luke-4 pe-luke-12 hover:bg-muted data-[chosen]:bg-fill-selected data-[needs]:bg-attention-tint";

/** A post's words and what stands under them. */
const POST_BODY = "channel-post-body flex min-w-0 flex-col gap-luke-6";

/** A line of presses or faces under a post's words, over the post's own press. */
const POST_LINE = "channel-post-line relative z-1 flex flex-wrap items-center gap-luke-6";

/** The way up to an older post that needs the reader, floating over the stream's head on a ground of its own, so no post's words show through it. */
const JUMP = `channel-jump ${FLOATING_OVER_LOG_CLASS} top-luke-8 z-1 bg-button-ground [--luke-button-ground:var(--luke-color-well)]`;

/** What a reader hears an unread post is, the dot saying it to the eye. */
const UNREAD_WORD = "Unread";

/** What the line before the first thread posted since the reader last looked says. */
const NEW_LINE = "New";

/** No thread is read yet. */
const NO_THREADS: readonly ChannelThread[] = [];

/** How far over a post's head the stream stops when it scrolls up to it, so the post is not flush with the box's edge. */
const JUMP_ROOM_PX = 12;

/** The post a scroll finds: one that needs the reader. */
const NEEDS_SELECTOR = "[data-channel-post][data-needs]";

/** The post of the thread open beside the stream. */
const CHOSEN_SELECTOR = "[data-channel-post][data-chosen]";

/** What the stream's placeholder says to a reader. */
const READING_THREADS = readingWords("threads");

/**
 * The posts the stream stands while its first read is on its way, oldest
 * first: how wide each one's name and each line of its words stand, a
 * screen's worth of short posts.
 */
const SKELETON_POSTS = [
  { name: "18%", lines: ["42%", "86%"] },
  { name: "24%", lines: ["36%", "92%", "58%"] },
  { name: "20%", lines: ["48%", "74%"] },
] as const;

/**
 * How many posts that need the reader stand scrolled out of sight above the
 * stream's view, and the press that brings the nearest into it, read again
 * as the stream scrolls and whenever `drawn` names another set of posts.
 */
function useNeedsAbove(
  log: React.RefObject<HTMLDivElement | null>,
  drawn: string,
): { readonly count: number; readonly onJump: () => void } {
  const [count, setCount] = useState(0);
  const nearest = useRef<HTMLElement | undefined>(undefined);
  useEffect(() => {
    const box = log.current;
    if (box === null) return;
    const measure = () => {
      const top = box.getBoundingClientRect().top;
      const hidden = [...box.querySelectorAll<HTMLElement>(NEEDS_SELECTOR)].filter(
        (post) => post.getBoundingClientRect().bottom < top,
      );
      nearest.current = hidden.at(-1);
      setCount(hidden.length);
    };
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    return () => box.removeEventListener("scroll", measure);
  }, [log, drawn]);
  const onJump = () => {
    const box = log.current;
    const post = nearest.current;
    if (box === null || post === undefined) return;
    // Note that the stream's own box scrolls, never the window, so the jump sets the box's offset rather than calling scrollIntoView.
    const offset = post.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top: box.scrollTop + offset - JUMP_ROOM_PX, behavior: "smooth" });
  };
  return { count, onJump };
}

/** The channel's View options, as the Inbox's own: the sliders, whose menu chooses Mine, Everyone, or Needs me. */
function StreamViewOptions({
  view,
  needsCount,
  shown,
  onView,
}: {
  view: ChannelView;
  needsCount: number;
  shown: boolean;
  onView: (view: ChannelView) => void;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const entries: MenuEntry[] = Object.values(CHANNEL_VIEW).map((each) => ({
    label: channelViewLabel(each, needsCount),
    checked: view === each,
    onSelect: () => onView(each),
  }));
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          groups={[entries]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The agents a post names its writer from: the open thread's, as its pane names them. */
type StreamAgents = Pick<
  CodingAgentsControl,
  "agents" | "archived" | "models" | "me" | "pullRequests"
>;

/** What a post names its writers from: the open thread's agents, and the thread as the Inbox lists it, none until its holder is read. */
interface PostDoors {
  readonly agents: StreamAgents;
  readonly listed: InboxListed | undefined;
}

/**
 * What names a post's agent beside the open thread's agents: the line its
 * thread was read with, which names it as the account's read does, its
 * automation's name among it; and where it stands, from its task's row,
 * which says so for a task's first few agents alone. Note that the row
 * names no automation, so it names the agent only where the thread's line
 * is missing.
 */
function threadAgentLine(
  thread: ChannelThread,
  listed: InboxListed | undefined,
): AgentLine | undefined {
  const row =
    listed?.holder.kind === INBOX_HOLDER.TASK
      ? listed.holder.task.agents?.agents.find((each) => each.id === thread.agentId)
      : undefined;
  if (row === undefined) return thread.agent;
  if (thread.agent === undefined) return row;
  return { ...thread.agent, kind: row.kind, status: row.status };
}

/** A message's writer, a member as the directory draws them, or the thread's agent as its pane names it (`agentSubject`), by a line read beside it where the open thread's agents hold none of it. */
function useWriter(message: InboxMessage | undefined, thread: ChannelThread, doors: PostDoors) {
  const member = usePerson(message?.member);
  if (message?.author !== INBOX_MESSAGE_AUTHOR.AGENT) return member;
  const line = threadAgentLine(thread, doors.listed);
  return agentSubject(doors.agents, thread.agentId, NOTHING_HELD, false, line).tile;
}

/** A replier's face, a member's own or the thread's agent's. */
function ReplierFace({
  message,
  thread,
  doors,
}: {
  message: InboxMessage;
  thread: ChannelThread;
  doors: PostDoors;
}): React.JSX.Element {
  const author = commentAuthor(useWriter(message, thread, doors));
  return (
    <Avatar
      size={AVATAR_SIZE.INLINE}
      name={author.name}
      src={author.picture}
      {...(author.shape === undefined ? {} : { shape: author.shape })}
      {...(author.glyph === undefined ? {} : { glyph: author.glyph, tiled: true })}
    />
  );
}

/** What an open ask offers under its post: a decision's options, one pick answering it, or the press that opens the thread. */
function PostAsk({
  item,
  onPick,
  onOpen,
}: {
  item: InboxItem;
  onPick: (item: InboxItem, label: string) => void;
  onOpen: () => void;
}): React.JSX.Element | null {
  const asking = item.status === INBOX_STATUS.OPEN ? openAskOf(item.thread ?? []) : undefined;
  if (asking === undefined) return null;
  const { ask } = asking;
  if (!knownAsk(ask)) return null;
  if (ask.type === INBOX_ASK.DECIDE) {
    return (
      <div className="channel-post-ask relative z-1">
        <AskControls
          ask={ask}
          title={item.title}
          numbered={false}
          doors={{
            draft: EMPTY_INBOX_DRAFT,
            disabled: false,
            // Note that a decision draws no form field, the one control that reads these.
            text: {
              self: item.agentId,
              agent: undefined,
              skills: undefined,
              keywords: [],
              onEnter: () => undefined,
            },
            onDraft: (next) => {
              const label = next.choices[0];
              if (label !== undefined) onPick(item, label);
            },
          }}
        />
      </div>
    );
  }
  return (
    <div className={POST_LINE}>
      <Button size={BUTTON_SIZE.COMPACT} variant={BUTTON_VARIANT.OUTLINE} onClick={onOpen}>
        {ask.type === INBOX_ASK.DO ? "Open the steps" : "Answer in thread"}
      </Button>
    </div>
  );
}

/** A post's own box, its ground marking it chosen or needing the reader, the unread dot in a gutter before it, and its menu where it has one. */
function PostFrame({
  chosen,
  needs,
  unread = false,
  contextMenu,
  menu,
  children,
}: {
  chosen: boolean;
  needs: boolean;
  unread?: boolean;
  /** The right-click and long press that open the post's menu. */
  contextMenu?: ContextMenuProps | undefined;
  /** The post's menu and its question, while drawn. */
  menu?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={POST}
      data-channel-post=""
      data-chosen={chosen ? "" : undefined}
      data-needs={needs ? "" : undefined}
      data-unread={unread ? "" : undefined}
      {...contextMenu}
    >
      <UnreadMark unread={unread} />
      <div className="channel-post-comment min-w-0 flex-1">{children}</div>
      {menu}
    </div>
  );
}

/** The stream while its first read is on its way: a few posts' blocks, each in a post's own box and a comment's frame (`SKELETON_POSTS`). */
export function ChannelStreamSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={READING_THREADS}>
      {SKELETON_POSTS.map((post) => (
        <PostFrame key={post.name} chosen={false} needs={false}>
          <CommentSkeleton name={post.name} lines={post.lines} />
        </PostFrame>
      ))}
    </SkeletonRegion>
  );
}

/** What a post's ⋯ acts through, as the stream's owner hands them down. */
export interface PostMenuDoors {
  /** Marks the thread read or unread. */
  readonly onMark: (item: InboxItem, unread: boolean) => void;
  /** Closes an open ask without an answer, asked first; none where the stream offers no close. */
  readonly onClose: InboxCloser | undefined;
  /** Opens the task that holds a thread. */
  readonly onOpenTask: (taskId: string) => void;
  /** Opens the thread's agent, on its task where a task holds it. */
  readonly onOpenAgent: (thread: ChannelThread, holder: InboxHolder | undefined) => void;
  /** Moves a thread into another open channel; what refused it, or none where it moved. */
  readonly onMove: (threadId: string, channelId: string) => Promise<string | undefined>;
  /** The workspace's open channels, which Move to channel lists. */
  readonly channels: readonly Channel[];
}

/** What a post's ⋯ calls its thread. */
const POST_THING = "Thread";

/** What a post's ⋯ offers of its own between the thread's link and its close. */
const POST_WORDS = {
  OPEN_TASK: "Open task",
  OPEN_AGENT: "Open agent",
  MOVE: "Move to channel…",
} as const;

/**
 * A post's ⋯, at its head's end under the pointer or the keyboard, and the
 * same menu on a right-click or a long press anywhere on the post: the
 * thread's own acts as every menu of an Inbox item offers them
 * (`inbox-item-actions.tsx`), with Open task where a task holds it, Open
 * agent, and Move to channel between its link and its close.
 */
function usePostMenu({
  item,
  holder,
  chosen,
  shown,
  menuDoors,
  onAskMove,
}: {
  item: ChannelThread;
  holder: InboxHolder | undefined;
  chosen: boolean;
  shown: boolean;
  menuDoors: PostMenuDoors;
  onAskMove: ((thread: ChannelThread) => void) | undefined;
}) {
  const menu = useMenu(shown);
  const { close, groups } = useInboxItemActions(holder, item, {
    onMark: menuDoors.onMark,
    onClose: menuDoors.onClose,
    shown,
    keyed: chosen,
  });
  const opens: MenuAction[] = [
    ...(holder?.kind === INBOX_HOLDER.TASK
      ? [
          {
            label: POST_WORDS.OPEN_TASK,
            detail: holder.task.name,
            icon: <GLYPH.TASK />,
            onSelect: () => menuDoors.onOpenTask(holder.task.id),
          },
        ]
      : []),
    {
      label: POST_WORDS.OPEN_AGENT,
      icon: <GLYPH.AGENT />,
      onSelect: () => menuDoors.onOpenAgent(item, holder),
    },
  ];
  const move: MenuAction[] =
    onAskMove === undefined
      ? []
      : [{ label: POST_WORDS.MOVE, icon: <GLYPH.MOVE />, onSelect: () => onAskMove(item) }];
  const entries = groups([], [opens, move]);
  return {
    contextMenu: menu.contextMenu(),
    button: (
      <div className="comment-tools">
        <MoreButton thing={POST_THING} size={BUTTON_SIZE.COMPACT} {...menu.trigger()} />
      </div>
    ),
    drawn: (
      <>
        {menu.drawn === undefined ? null : (
          <ActionMenu
            label={moreLabel(POST_THING)}
            menu={menu.drawn}
            groups={entries}
            onClose={menu.close}
          />
        )}
        {close.dialog}
      </>
    ),
  };
}

/** One thread as a post in the stream, the unread dot in a gutter before it until it is opened, as the Inbox's rows wear it. */
function ThreadPost({
  item,
  doors,
  chosen,
  readerId,
  now,
  shown,
  menuDoors,
  onAskMove,
  onPick,
  onOpen,
}: {
  item: ChannelThread;
  doors: PostDoors;
  chosen: boolean;
  readerId: string | undefined;
  now: number;
  shown: boolean;
  menuDoors: PostMenuDoors;
  onAskMove: ((thread: ChannelThread) => void) | undefined;
  onPick: (item: InboxItem, label: string) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const first = item.thread?.[0];
  const actor = useWriter(first, item, doors);
  const replies = repliesLine(item, readerId);
  const needs = threadNeedsReader(item, readerId);
  const unread = isUnread(item);
  const menu = usePostMenu({
    item,
    holder: doors.listed?.holder,
    chosen,
    shown,
    menuDoors,
    onAskMove,
  });
  return (
    <PostFrame
      chosen={chosen}
      needs={needs}
      unread={unread}
      contextMenu={menu.contextMenu}
      menu={menu.drawn}
    >
      <Comment
        author={commentAuthor(actor)}
        nameRef={<ActorRef actor={actor} nameOnly />}
        at={item.postedAt}
        now={now}
        trailing={
          <>
            {unread ? <VisuallyHidden>{UNREAD_WORD}</VisuallyHidden> : null}
            {menu.button}
          </>
        }
      >
        <div className={POST_BODY}>
          <CardPress reach={CARD_PRESS_REACH.CARD} label={`Open ${item.title}`} onPress={onOpen}>
            <Text variant={TEXT_VARIANT.LABEL}>{item.title}</Text>
          </CardPress>
          {first === undefined || first.text === "" ? null : (
            <div className="channel-post-words min-w-0 text-body-size leading-reading text-foreground">
              <TranscriptWords text={first.text} asDocument />
            </div>
          )}
          {/* Note that on the attention tint the ask's controls stand on the column's ground, so they read gray as in the thread. */}
          <ControlGround ground={needs ? CONTROL_GROUND.OPAQUE : CONTROL_GROUND.CLEAR}>
            <PostAsk item={item} onPick={onPick} onOpen={onOpen} />
          </ControlGround>
          <div className={POST_LINE}>
            {replies.repliers.map((reply) => (
              <ReplierFace key={reply.id} message={reply} thread={item} doors={doors} />
            ))}
            <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={onOpen}>
              {replies.words}
            </TextButton>
            {replies.waiting === undefined ? null : (
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {replies.waiting}
              </Text>
            )}
          </div>
        </div>
      </Comment>
    </PostFrame>
  );
}

/** One channel's stream as its holder reads it: the read, the view chosen, the threads the view shows, the window's own answers laid over them, and how many need the reader. */
export interface ChannelStreamRead {
  readonly read: ChannelThreadsControl;
  readonly view: ChannelView;
  readonly onView: (view: ChannelView) => void;
  /** The threads the view shows, oldest first, which the stream posts and K and J step through. */
  readonly viewed: readonly ChannelThread[];
  readonly needsCount: number;
}

/** Reads one channel's stream for its holder, which draws it (`ChannelStream`) and pages it (`useChannelPager`) from the one read; `ownTask` says which threads stand on a task of the reader's. */
export function useChannelStream(
  channelId: string | undefined,
  readerId: string | undefined,
  ownTask: (thread: ChannelThread) => boolean,
): ChannelStreamRead {
  const [view, onView] = useChannelView();
  const read = useChannelThreads(channelId);
  // Note that the window's own answers stand over the read, so a pick clears the tint the moment it is sent.
  const readThreads = read.threads ?? NO_THREADS;
  const settled = useSettledItems(readThreads);
  // Note that an answer's item carries no agent of its own, so each thread keeps the one it was read with.
  const threads = useMemo(() => {
    const byId = new Map(readThreads.map((thread) => [thread.id, thread]));
    return settled.flatMap((item): ChannelThread[] => {
      const thread = byId.get(item.id);
      return thread === undefined ? [] : [{ ...thread, ...item }];
    });
  }, [readThreads, settled]);
  return {
    read,
    view,
    onView,
    viewed: viewedThreads(threads, view, readerId, ownTask),
    needsCount: needsReaderCount(threads, readerId),
  };
}

/** Scrolls the stream's own box to the chosen post where it stands out of sight, as a key opening the next thread leaves it; never `scrollIntoView`. */
function useChosenInView(
  log: React.RefObject<HTMLDivElement | null>,
  chosenId: string | undefined,
) {
  useLayoutEffect(() => {
    const box = log.current;
    if (box === null || chosenId === undefined) return;
    const post = box.querySelector<HTMLElement>(CHOSEN_SELECTOR);
    if (post === null) return;
    const room = box.getBoundingClientRect();
    const at = post.getBoundingClientRect();
    if (at.top >= room.top && at.bottom <= room.bottom) return;
    // Note that a post below comes up to the box's foot, and one above, or one taller than the box, down to its head.
    const below = at.top > room.top && at.height < room.height;
    const offset = below
      ? at.bottom - room.bottom + JUMP_ROOM_PX
      : at.top - room.top - JUMP_ROOM_PX;
    askScroll(box);
    box.scrollTo({ top: box.scrollTop + offset });
  }, [log, chosenId]);
}

/** The stream's column, named for what it holds, hidden while a thread stands in its place. */
function StreamColumn({
  label,
  hidden = false,
  children,
}: {
  label: string;
  hidden?: boolean | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={STREAM} aria-label={label} hidden={hidden}>
      {children}
    </section>
  );
}

/** The stream's place while the workspace's channels are first read, so no channel is named yet: its bar, and a few posts' blocks under it. */
export function ChannelReading(): React.JSX.Element {
  return (
    <StreamColumn label="Channel">
      <Toolbar end={TOOLBAR_INSET.COLUMN} />
      <Conversation>
        <ConversationContent className={STREAM_BODY}>
          <ChannelStreamSkeleton />
        </ConversationContent>
      </Conversation>
    </StreamColumn>
  );
}

/**
 * The stream's place where the channel chosen stands no more: archived,
 * by whoever archived it, or never one of the workspace's, as a link to it
 * may name; with the way to #general where the workspace holds it.
 */
export function ChannelMissing({
  onGeneral,
}: {
  onGeneral: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <StreamColumn label="Channel not found">
      <Toolbar end={TOOLBAR_INSET.COLUMN} />
      <EmptyState
        icon={<NotFoundIcon />}
        title="Channel not found"
        action={
          onGeneral === undefined ? undefined : { label: "Go to #general", onClick: onGeneral }
        }
      >
        This channel was archived, or isn't one of this workspace's.
      </EmptyState>
    </StreamColumn>
  );
}

/** The stream as one channel draws it; `listedOf` finds a thread as the Inbox lists it. */
export function ChannelStream({
  channel,
  stream,
  chosenId,
  hidden,
  readerId,
  now,
  shown,
  agents,
  listedOf,
  menuDoors,
  onOpen,
  onLook,
  onAnswered,
}: {
  channel: Channel;
  /** The channel's stream as its holder reads it (`useChannelStream`). */
  stream: ChannelStreamRead;
  /** The thread open in the side panel beside the stream, where one is. */
  chosenId: string | undefined;
  /** Whether a thread stands in the stream's place, as on a phone, which keeps the stream and the New line where they stood. */
  hidden: boolean;
  readerId: string | undefined;
  now: number;
  /** Whether the window shows the stream, which its menus close with. */
  shown: boolean;
  /** The open thread's agents, as its pane names them, which every post naming one of them names it by. */
  agents: StreamAgents;
  listedOf: (itemId: string) => InboxListed | undefined;
  /** What each post's ⋯ acts through. */
  menuDoors: PostMenuDoors;
  onOpen: (thread: ChannelThread) => void;
  /** Stamps the reader's look at the channel, as they leave it. */
  onLook: (channelId: string) => void;
  /** Tells the window a thread was answered here, so what counts what waits is read again. */
  onAnswered: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const settler = useInboxSettler();
  const log = useRef<HTMLDivElement>(null);
  const { read, view, onView, viewed, needsCount } = stream;
  // Note that the New line stands where the reader left off as the channel opened, and stays while they read it.
  const [lookedAt] = useState(channel.lookedAt);
  // Note that leaving the channel is having looked at it, so its New line is gone when the reader comes back.
  const look = useRef(onLook);
  look.current = onLook;
  useEffect(() => () => look.current(channel.id), [channel.id]);
  const rows = streamRows(viewed, { lookedAt, readerId, now });
  const above = useNeedsAbove(log, `${channel.id}:${view}:${viewed.length}:${needsCount}`);
  useChosenInView(log, chosenId);
  const { onRefresh } = read;
  const move = useMoveThreadDialog({
    channels: menuDoors.channels,
    from: channel.id,
    threads: read.threads ?? NO_THREADS,
    shown,
    onMove: menuDoors.onMove,
    onMoved: onRefresh,
  });
  const pick = (item: InboxItem, label: string) => {
    const message = inboxThreadSend(item.thread ?? [], { ...EMPTY_INBOX_DRAFT, choices: [label] });
    if (message?.answers === undefined) return;
    const { text, answers } = message;
    const sent = settler.answer(item, { text, answers });
    act(ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: item.id,
      text,
      answers,
      clientKey: crypto.randomUUID(),
    }).then(
      (answer) => {
        if ("failure" in answer) return settler.refuse(sent);
        settler.take(sent, answer.item);
        onRefresh();
        onAnswered();
      },
      () => settler.refuse(sent),
    );
  };
  return (
    <StreamColumn label={`#${channel.name}`} hidden={hidden}>
      <Toolbar
        title={channelTitle(channel.name, view)}
        detail={channel.purpose}
        end={TOOLBAR_INSET.COLUMN}
        actions={
          <StreamViewOptions view={view} needsCount={needsCount} shown={shown} onView={onView} />
        }
      />
      {read.threads === undefined && read.failure !== undefined ? (
        <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={onRefresh}>
          {`Could not read #${channel.name}.`}
        </ErrorState>
      ) : (
        <Conversation
          subject={`${channel.id}:${view}`}
          list={log}
          onNearTop={read.hasOlder ? read.onOlder : undefined}
        >
          <ConversationContent className={STREAM_BODY}>
            {read.threads === undefined ? <ChannelStreamSkeleton /> : null}
            {read.threads !== undefined && rows.length === 0 ? (
              <NoteLine look={NOTE_LINE_LOOK.CENTRED}>
                {emptyStreamWords(channel.name, view)}
              </NoteLine>
            ) : null}
            {rows.map((row) =>
              row.kind === STREAM_ROW.THREAD ? (
                <ThreadPost
                  key={row.thread.id}
                  item={row.thread}
                  doors={{ agents, listed: listedOf(row.thread.id) }}
                  chosen={row.thread.id === chosenId}
                  readerId={readerId}
                  now={now}
                  shown={shown}
                  menuDoors={menuDoors}
                  onAskMove={move.ask}
                  onPick={pick}
                  onOpen={() => onOpen(row.thread)}
                />
              ) : row.kind === STREAM_ROW.DAY ? (
                <StreamDivider key={`day-${row.key}`} kind={STREAM_DIVIDER.DAY}>
                  {row.words}
                </StreamDivider>
              ) : (
                <StreamDivider key="new" kind={STREAM_DIVIDER.NEW}>
                  {NEW_LINE}
                </StreamDivider>
              ),
            )}
            {/* Note that a refresh failing over the threads held keeps them, and says so under the newest. */}
            {read.threads !== undefined && read.failure !== undefined ? (
              <ErrorState
                onRetry={onRefresh}
              >{`Could not read #${channel.name} again.`}</ErrorState>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
          {above.count === 0 ? null : (
            <div className={JUMP}>
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                icon={<ArrowUpIcon />}
                onClick={above.onJump}
              >
                {olderAsksWords(above.count)}
              </Button>
            </div>
          )}
        </Conversation>
      )}
      {move.dialog}
    </StreamColumn>
  );
}
