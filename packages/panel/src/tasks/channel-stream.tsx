import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_PRESS_REACH,
  CardPress,
  Comment,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
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
  useMenu,
} from "@luke/ui";
import { ArrowUpIcon, SlidersHorizontalIcon } from "@luke/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  FLOATING_OVER_LOG_CLASS,
} from "../ai-elements/conversation.js";
import { ActionMenu, type MenuEntry } from "../desktop/action-menu.js";
import { usePerson } from "../member-directory.js";
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
  threadNeedsReader,
  viewedThreads,
} from "./channels-model.js";
import { agentActor } from "./coding-agent-model.js";
import { AskControls } from "./inbox-ask-controls.js";
import { VIEW_OPTIONS } from "./inbox-columns.js";
import {
  EMPTY_INBOX_DRAFT,
  INBOX_HOLDER,
  type InboxListed,
  inboxThreadSend,
  knownAsk,
  openAskOf,
} from "./inbox-model.js";
import { useInboxSettler, useSettledItems } from "./inbox-settling.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { useChannelThreads, useChannelView } from "./use-channels.js";

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
 * time, then the thread's title and its first message's words. A decision
 * still open offers its options under the post with the thread's own
 * controls, numbered for no keys, and one pick answers it there; steps and
 * a written answer offer one press that opens the thread. The replies line
 * under every post shows who replied, how many replies or Reply in thread,
 * and who the open ask waits on. A post that needs the reader stands on the
 * attention tint and nothing else marks it, cleared the moment it is
 * answered, since the window's own answers are laid over the read
 * (`inbox-settling.ts`). A press anywhere on a post opens its thread beside
 * the stream (`onOpen`). While a post that needs the reader is scrolled out
 * of sight above, a button floats over the stream's head counting them,
 * and a press scrolls the stream's own box to the nearest; never
 * `scrollIntoView`, which would scroll the window around a sliding pane
 * (`packages/panel/AGENTS.md`). Leaving the channel stamps the reader's
 * look at it, and the New line stands where it stood as the channel opened
 * while they read it.
 */

/**
 * The stream's column, its log filling what its head leaves, a rule at its
 * end where a thread stands beside it. Note that its bar ends where its
 * posts do wherever the side panel's toggle stands over no edge of it, with
 * a thread or the side panel beside it, rather than past the toggle or at
 * the sheet's edge as the window would end it.
 */
const STREAM =
  "channel-stream relative flex min-h-0 min-w-0 flex-col data-[beside]:border-r data-[beside]:border-border data-[beside]:[--luke-toolbar-end-at:initial] in-data-[panel-open=true]:[--luke-toolbar-end-at:initial]";

/** The posts' run, on the column's inset. */
const STREAM_BODY =
  "channel-stream-body flex flex-col gap-luke-4 px-column-inset pt-luke-8 pb-luke-16";

/** One post: its own ground, the hover's fill, the chosen thread's, or the attention tint where it needs the reader. */
const POST =
  "channel-post relative rounded-luke-10 px-luke-12 py-luke-8 hover:bg-muted data-[chosen]:bg-fill-selected data-[needs]:bg-attention-tint";

/** A post's words and what stands under them. */
const POST_BODY = "channel-post-body flex min-w-0 flex-col gap-luke-6";

/** A line of presses or faces under a post's words, over the post's own press. */
const POST_LINE = "channel-post-line relative z-1 flex flex-wrap items-center gap-luke-6";

/** The way up to an older post that needs the reader, floating over the stream's head on a ground of its own, so no post's words show through it. */
const JUMP = `channel-jump ${FLOATING_OVER_LOG_CLASS} top-luke-8 z-1 bg-button-ground [--luke-button-ground:var(--luke-color-well)]`;

/** What the line before the first thread posted since the reader last looked says. */
const NEW_LINE = "New";

/** No thread is read yet. */
const NO_THREADS: readonly ChannelThread[] = [];

/** How far over a post's head the stream stops when it scrolls up to it, so the post is not flush with the box's edge. */
const JUMP_ROOM_PX = 12;

/** The post a scroll finds: one that needs the reader. */
const NEEDS_SELECTOR = "[data-channel-post][data-needs]";

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

/** A message's writer, a member as the directory draws them, or the thread's agent as its task lists it. */
function useWriter(
  message: InboxMessage | undefined,
  item: InboxItem,
  listed: InboxListed | undefined,
) {
  const member = usePerson(message?.member);
  if (message?.author !== INBOX_MESSAGE_AUTHOR.AGENT) return member;
  const agent =
    listed?.holder.kind === INBOX_HOLDER.TASK
      ? listed.holder.task.agents?.agents.find((each) => each.id === item.agentId)
      : undefined;
  return agentActor(
    agent ?? { model: "", status: CODING_AGENT_STATUS.RUNNING },
    agent?.title ?? "Coding agent",
  );
}

/** A replier's face, a member's own or the thread's agent's. */
function ReplierFace({
  message,
  item,
  listed,
}: {
  message: InboxMessage;
  item: InboxItem;
  listed: InboxListed | undefined;
}): React.JSX.Element {
  const author = commentAuthor(useWriter(message, item, listed));
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

/** One thread as a post in the stream. */
function ThreadPost({
  item,
  listed,
  chosen,
  readerId,
  now,
  onPick,
  onOpen,
}: {
  item: InboxItem;
  /** The thread as the Inbox lists it, with what holds it; none until its holder is read. */
  listed: InboxListed | undefined;
  chosen: boolean;
  readerId: string | undefined;
  now: number;
  onPick: (item: InboxItem, label: string) => void;
  onOpen: () => void;
}): React.JSX.Element {
  const first = item.thread?.[0];
  const actor = useWriter(first, item, listed);
  const replies = repliesLine(item, readerId);
  return (
    <div
      className={POST}
      data-channel-post=""
      data-chosen={chosen ? "" : undefined}
      data-needs={threadNeedsReader(item, readerId) ? "" : undefined}
    >
      <Comment
        author={commentAuthor(actor)}
        nameRef={<ActorRef actor={actor} nameOnly />}
        at={item.postedAt}
        now={now}
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
          <PostAsk item={item} onPick={onPick} onOpen={onOpen} />
          <div className={POST_LINE}>
            {replies.repliers.map((reply) => (
              <ReplierFace key={reply.id} message={reply} item={item} listed={listed} />
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
    </div>
  );
}

/** The stream as one channel draws it; `listedOf` finds a thread as the Inbox lists it, `ownTask` whether it stands on a task of the reader's. */
export function ChannelStream({
  channel,
  chosenId,
  beside,
  hidden,
  readerId,
  now,
  shown,
  listedOf,
  ownTask,
  onOpen,
  onLook,
  onAnswered,
}: {
  channel: Channel;
  /** The thread the pane beside shows, where one does. */
  chosenId: string | undefined;
  /** Whether a thread stands open beside the stream. */
  beside: boolean;
  /** Whether a thread stands in the stream's place, as on a phone, which keeps the stream and the New line where they stood. */
  hidden: boolean;
  readerId: string | undefined;
  now: number;
  /** Whether the window shows the stream, which its menus close with. */
  shown: boolean;
  listedOf: (itemId: string) => InboxListed | undefined;
  ownTask: (thread: ChannelThread) => boolean;
  onOpen: (thread: ChannelThread) => void;
  /** Stamps the reader's look at the channel, as they leave it. */
  onLook: (channelId: string) => void;
  /** Tells the window a thread was answered here, so what counts what waits is read again. */
  onAnswered: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const settler = useInboxSettler();
  const log = useRef<HTMLDivElement>(null);
  const [view, onView] = useChannelView();
  const read = useChannelThreads(channel.id);
  // Note that the New line stands where the reader left off as the channel opened, and stays while they read it.
  const [lookedAt] = useState(channel.lookedAt);
  // Note that leaving the channel is having looked at it, so its New line is gone when the reader comes back.
  const look = useRef(onLook);
  look.current = onLook;
  useEffect(() => () => look.current(channel.id), [channel.id]);
  // Note that the window's own answers stand over the read, so a pick clears the tint the moment it is sent.
  const settled = useSettledItems(read.threads ?? NO_THREADS);
  const threads = useMemo(
    () => settled.map((item): ChannelThread => ({ ...item, channelId: channel.id })),
    [settled, channel.id],
  );
  const viewed = viewedThreads(threads, view, readerId, ownTask);
  const needsCount = needsReaderCount(threads, readerId);
  const rows = streamRows(viewed, { lookedAt, readerId, now });
  const above = useNeedsAbove(log, `${channel.id}:${view}:${viewed.length}:${needsCount}`);
  const { onRefresh } = read;
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
    <section
      className={STREAM}
      aria-label={`#${channel.name}`}
      data-beside={beside ? "" : undefined}
      hidden={hidden}
    >
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
        <Conversation subject={`${channel.id}:${view}`} list={log}>
          <ConversationContent className={STREAM_BODY}>
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
                  listed={listedOf(row.thread.id)}
                  chosen={beside && row.thread.id === chosenId}
                  readerId={readerId}
                  now={now}
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
    </section>
  );
}
