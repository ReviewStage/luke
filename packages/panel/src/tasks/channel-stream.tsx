/**
 * channel-stream.tsx -- PROTOTYPE ONLY: a channel drawn as Slack draws one, its threads a stream of posts with a box at its foot (STAG-547).
 *
 * Each thread of the channel is a post, oldest at the top and the newest
 * over the box, drawn as the Inbox draws a message (`Comment`): its writer's
 * face, their name, when, and its kind where its line's glyph cannot say it.
 * Under the words, an open ask offers its options as buttons, and a thread
 * with replies says how many and who wrote them; either opens the thread
 * beside the stream, where it is answered as in the Inbox. The box posts to
 * the channel; in the mockup a post stays in the window alone.
 */

import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
} from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  AVATAR_SIZE,
  Avatar,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  Comment,
  GROUP_HEADING,
  GroupHeader,
  IconButton,
  NavItem,
  SCROLL_FADE,
  ScrollArea,
  STATUS_TONE,
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
import { ArrowUpIcon, SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { GLYPH } from "@luke/ui/icons";
import { ActionMenu, type MenuEntry } from "../desktop/action-menu.js";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import {
  answerInStream,
  CHANNELS,
  channelCount,
  channelLastLooked,
  chooseChannel,
  type ChannelInfo,
  type ChannelPost,
  openThread,
  useChannelCounts,
  useChannelPosts,
  useStreamAnswer,
} from "./channels-mock.js";
import { agentActor } from "./coding-agent-model.js";
import { INBOX_HOLDER, type InboxListed, openAskOf } from "./inbox-model.js";
import { TranscriptWords } from "./transcript-blocks.js";

const DAY = 24 * 60 * 60 * 1000;

/** What a day's divider says: Today, Yesterday, or the date. */
function dayWords(at: number, now: number): string {
  const start = new Date(now).setHours(0, 0, 0, 0);
  if (at >= start) return "Today";
  if (at >= start - DAY) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Whether a thread still asks someone something. */
function asksSomeone(listed: InboxListed): boolean {
  return (
    listed.item.status === INBOX_STATUS.OPEN && openAskOf(listed.item.thread ?? []) !== undefined
  );
}

/** Which of a channel's threads the stream shows: everyone's, or the reader's own. */
const STREAM_SCOPE = { EVERYONE: "everyone", MINE: "mine", NEEDS: "needs" } as const;

type StreamScope = (typeof STREAM_SCOPE)[keyof typeof STREAM_SCOPE];

/** The scope the reader last chose, kept across channels as Slack keeps a filter. */
let lastScope: StreamScope = STREAM_SCOPE.MINE;

/** Whether a thread is the reader's: of a task they own, asking them, or one they wrote on. */
function isMine(listed: InboxListed, readerId: string | undefined): boolean {
  const { holder, item } = listed;
  if (readerId === undefined) return false;
  if (holder.kind === INBOX_HOLDER.TASK && holder.task.ownerId === readerId) return true;
  if (asksSomeone(listed) && item.waitsOn?.userId === readerId) return true;
  return (item.thread ?? []).some((message) => message.member?.userId === readerId);
}

/**
 * The grounds the mockup can draw under a post that needs the reader,
 * compared by `?ground=` in a development tab: a neutral fill, the attention
 * tint, a lifted card, an outlined card, and the others dimmed instead.
 */
const GROUND = {
  NEUTRAL: "neutral",
  TINT: "tint",
  LIFT: "lift",
  OUTLINE: "outline",
  DIM: "dim",
} as const;

type Ground = (typeof GROUND)[keyof typeof GROUND];

/** The ground shown: the one the address names, else the attention tint. */
const STREAM_GROUND: Ground = (() => {
  const named = new URLSearchParams(globalThis.location?.search ?? "").get("ground");
  return (Object.values(GROUND) as readonly string[]).includes(named ?? "")
    ? (named as Ground)
    : GROUND.TINT;
})();

/** Whether a thread asks the reader something still open. */
function needsReader(listed: InboxListed, readerId: string | undefined): boolean {
  return asksSomeone(listed) && listed.item.waitsOn?.userId === readerId;
}

/**
 * How many posts that need the reader stand scrolled up out of sight above
 * the stream's view, and the press that brings the nearest of them into it,
 * read again as the stream scrolls and whenever `drawn` names a new set of
 * posts. Note that the stream scrolls its own box, never the window, so the
 * jump sets the box's own offset rather than calling `scrollIntoView`.
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
      const hidden = [
        ...box.querySelectorAll<HTMLElement>('.channels-post[data-needs="true"]'),
      ].filter((post) => post.getBoundingClientRect().bottom < top + 8);
      nearest.current = hidden.at(-1);
      setCount(hidden.length);
    };
    // Note that the log scrolls itself to its newest post as it opens, which fires a scroll, so that first scroll measures it settled.
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    return () => box.removeEventListener("scroll", measure);
  }, [log, drawn]);
  const onJump = () => {
    const box = log.current;
    const post = nearest.current;
    if (box === null || post === undefined) return;
    const offset = post.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top: box.scrollTop + offset - 12, behavior: "smooth" });
  };
  return { count, onJump };
}

/** What each of a channel's views is called, in its menu and after the channel's name where it is not Mine. */
const SCOPE_WORDS = {
  [STREAM_SCOPE.MINE]: "Mine",
  [STREAM_SCOPE.EVERYONE]: "Everyone",
  [STREAM_SCOPE.NEEDS]: "Needs me",
} as const satisfies Record<StreamScope, string>;

/** The channel's View options, as the Inbox's own: a button whose menu chooses Mine, Everyone, or Needs me, the last counting what waits on the reader. */
function StreamViewOptions({
  scope,
  needsCount,
  onChoose,
}: {
  scope: StreamScope;
  needsCount: number;
  onChoose: (scope: StreamScope) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const entries: MenuEntry[] = [STREAM_SCOPE.MINE, STREAM_SCOPE.EVERYONE, STREAM_SCOPE.NEEDS].map(
    (value) => ({
      label:
        value === STREAM_SCOPE.NEEDS && needsCount > 0
          ? `${SCOPE_WORDS[value]} · ${needsCount}`
          : SCOPE_WORDS[value],
      checked: scope === value,
      onSelect: () => onChoose(value),
    }),
  );
  return (
    <>
      <Tooltip label="View options">
        <IconButton icon={<SlidersHorizontalIcon />} label="View options" {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="View options"
          menu={menu.drawn}
          groups={[entries]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * How a decision's buttons say which option its agent recommends, compared by
 * `?rec=` in a development tab: a star after its label, as the Inbox's rows
 * star it, or a line after the buttons naming it. Every button is drawn
 * alike either way, so none reads as already chosen.
 */
const RECOMMENDED = { STAR: "star", CAPTION: "caption" } as const;

type RecommendedLook = (typeof RECOMMENDED)[keyof typeof RECOMMENDED];

const RECOMMENDED_LOOK: RecommendedLook =
  new URLSearchParams(globalThis.location?.search ?? "").get("rec") === RECOMMENDED.CAPTION
    ? RECOMMENDED.CAPTION
    : RECOMMENDED.STAR;

/** One entry of the stream: a thread, or a post made in the window. */
type StreamEntry =
  | { readonly kind: "thread"; readonly at: number; readonly listed: InboxListed }
  | { readonly kind: "post"; readonly at: number; readonly post: ChannelPost };

/** The writer of a thread's first message, as the Inbox's comment draws them. */
function useThreadAuthor(listed: InboxListed) {
  const { holder, item } = listed;
  const first = item.thread?.[0];
  const member = usePerson(first?.member);
  if (first?.author !== INBOX_MESSAGE_AUTHOR.AGENT) return member;
  const agent =
    holder.kind === INBOX_HOLDER.TASK
      ? holder.task.agents?.agents.find((each) => each.id === item.agentId)
      : undefined;
  return agentActor(
    agent ?? { model: "", status: CODING_AGENT_STATUS.RUNNING },
    agent?.title ?? "Coding agent",
  );
}

/**
 * What an open ask offers under its post: a decision's options, each of
 * which answers it there, as a Slack app's buttons do, or, for steps or an
 * answer in words, the one press that opens the thread. Once picked, the
 * post says what the reader chose.
 */
function AskButtons({ listed, onOpen }: { listed: InboxListed; onOpen: () => void }) {
  const { act } = useAct();
  const picked = useStreamAnswer(listed.item.id);
  const asking = openAskOf(listed.item.thread ?? []);
  if (picked !== undefined) {
    return (
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {`You chose ${picked}`}
      </Text>
    );
  }
  if (asking === undefined || listed.item.status !== INBOX_STATUS.OPEN) return null;
  const { ask, message } = asking;
  const choose = (label: string) => {
    answerInStream(listed.item.id, label);
    void act(ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: listed.item.id,
      text: "",
      attachments: [],
      clientKey: `stream-${listed.item.id}-${Date.now()}`,
      answers: { ask: message.id, reply: INBOX_REPLY.CHOSE, choices: [label] },
    });
  };
  const options =
    ask.type === INBOX_ASK.DECIDE
      ? ask.options.map((option) => ({
          label: option.label,
          recommended: option.label === ask.recommended,
          onPress: () => choose(option.label),
        }))
      : [
          {
            label: ask.type === INBOX_ASK.DO ? "Open the steps" : "Answer",
            recommended: true,
            onPress: onOpen,
          },
        ];
  const recommended =
    ask.type === INBOX_ASK.DECIDE ? options.find((option) => option.recommended)?.label : undefined;
  return (
    <div className="channels-post-asks">
      {options.map((option) => (
        <Button
          key={option.label}
          size={BUTTON_SIZE.COMPACT}
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={option.onPress}
        >
          {option.recommended && RECOMMENDED_LOOK === RECOMMENDED.STAR
            ? `${option.label} ★`
            : option.label}
        </Button>
      ))}
      {RECOMMENDED_LOOK === RECOMMENDED.CAPTION && recommended !== undefined ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`Recommended: ${recommended}`}
        </Text>
      ) : null}
    </div>
  );
}

/** Who replied on a thread and how many times, which opens it, or a way to reply where nobody has. */
function RepliesLine({
  listed,
  readerId,
  onOpen,
}: {
  listed: InboxListed;
  readerId: string | undefined;
  onOpen: () => void;
}) {
  const replies = (listed.item.thread ?? []).slice(1);
  const repliers = [
    ...new Map(
      replies.map((reply) => [reply.member?.userId ?? reply.author, reply] as const),
    ).values(),
  ];
  const { item } = listed;
  const waiting = asksSomeone(listed) ? item.waitsOn : undefined;
  const waitingOn =
    waiting === undefined ? undefined : waiting.userId === readerId ? "you" : waiting.name;
  return (
    <div className="channels-post-replies">
      {repliers.map((reply) => (
        <ReplierFace key={reply.id} listed={listed} member={reply.member} />
      ))}
      <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={onOpen}>
        {replies.length === 0
          ? "Reply in thread"
          : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
      </TextButton>
      {waitingOn === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`Waiting on ${waitingOn}`}
        </Text>
      )}
    </div>
  );
}

/** A replier's face: a member's own, or the thread's agent's. */
function ReplierFace({
  listed,
  member,
}: {
  listed: InboxListed;
  member: { readonly userId: string; readonly name: string } | undefined;
}) {
  const person = usePerson(member);
  const agent = useThreadAuthor(listed);
  const author = commentAuthor(member === undefined ? agent : person);
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

/** One thread as a post in the stream. */
function ThreadPost({
  listed,
  chosen,
  readerId,
  now,
  onOpen,
}: {
  listed: InboxListed;
  chosen: boolean;
  readerId: string | undefined;
  now: number;
  onOpen: (listed: InboxListed) => void;
}) {
  const { item } = listed;
  const actor = useThreadAuthor(listed);
  const first = item.thread?.[0];
  const open = () => onOpen(listed);
  return (
    <div
      className="channels-post"
      data-chosen={String(chosen)}
      data-settled={String(item.status !== INBOX_STATUS.OPEN)}
      data-needs={String(needsReader(listed, readerId))}
    >
      <Comment
        author={commentAuthor(actor)}
        nameRef={<ActorRef actor={actor} nameOnly />}
        at={item.postedAt}
        now={now}
      >
        <div className="channels-post-body">
          <Text variant={TEXT_VARIANT.LABEL}>{item.title}</Text>
          {first === undefined || first.text === "" ? null : (
            <div className="inbox-words">
              <TranscriptWords text={first.text} asDocument />
            </div>
          )}
          <AskButtons listed={listed} onOpen={open} />
          <RepliesLine listed={listed} readerId={readerId} onOpen={open} />
        </div>
      </Comment>
    </div>
  );
}

/** A post the reader made in the window. */
function LocalPost({
  post,
  readerId,
  now,
}: {
  post: ChannelPost;
  readerId: string | undefined;
  now: number;
}) {
  const { members } = useMemberDirectory();
  const me = members?.find((each) => each.userId === readerId);
  const person = usePerson(me === undefined ? undefined : { userId: me.userId, name: me.name });
  return (
    <div className="channels-post">
      <Comment
        author={commentAuthor(person)}
        nameRef={<ActorRef actor={person} nameOnly />}
        at={post.at}
        now={now}
      >
        <div className="channels-post-body">
          <div className="inbox-words">
            <TranscriptWords text={post.text} asDocument />
          </div>
        </div>
      </Comment>
    </div>
  );
}

/** The channel as a stream: its head and its posts by day, what needs the reader on a ground of its own. */
export function ChannelStream({
  channel,
  items,
  chosen,
  threadOpen,
  readerId,
  now,
  onOpen,
}: {
  channel: ChannelInfo;
  items: readonly InboxListed[];
  /** The thread the pane beside shows, where it stands open. */
  chosen: string | undefined;
  threadOpen: boolean;
  readerId: string | undefined;
  now: number;
  onOpen: (listed: InboxListed) => void;
}): React.JSX.Element {
  const log = useRef<HTMLDivElement>(null);
  const posts = useChannelPosts(channel.id);
  const [scope, setScope] = useState<StreamScope>(lastScope);
  // Note that the New line stands where the reader left off as the channel opened, and stays while they read it.
  const looked = useMemo(() => channelLastLooked(channel.id), [channel.id]);
  const scoped = items.filter((listed) =>
    scope === STREAM_SCOPE.EVERYONE
      ? true
      : scope === STREAM_SCOPE.MINE
        ? isMine(listed, readerId)
        : needsReader(listed, readerId),
  );
  const shown = scoped;
  const needsCount = items.filter((listed) => needsReader(listed, readerId)).length;
  const above = useNeedsAbove(log, `${channel.id}:${scope}:${shown.length}`);
  const entries: StreamEntry[] = [
    ...shown.map((listed) => ({ kind: "thread" as const, at: listed.item.postedAt, listed })),
    ...posts.map((post) => ({ kind: "post" as const, at: post.at, post })),
  ].toSorted((a, b) => a.at - b.at);
  const firstNew = entries.find(
    (entry) =>
      looked !== undefined &&
      entry.at > looked &&
      entry.kind === "thread" &&
      entry.listed.item.thread?.[0]?.member?.userId !== readerId,
  );
  const choose = (next: StreamScope) => {
    lastScope = next;
    setScope(next);
  };
  const open = (listed: InboxListed) => {
    onOpen(listed);
    openThread();
  };
  let lastDay = "";
  return (
    <section
      className="channels-stream"
      aria-label={`#${channel.name}`}
      data-ground={STREAM_GROUND}
    >
      <Toolbar
        title={
          scope === STREAM_SCOPE.MINE
            ? `#${channel.name}`
            : `#${channel.name} · ${SCOPE_WORDS[scope]}`
        }
        end={TOOLBAR_INSET.COLUMN}
        actions={<StreamViewOptions scope={scope} needsCount={needsCount} onChoose={choose} />}
      />
      <div className="channels-head">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
          {channel.inFlight === ""
            ? channel.purpose
            : `${channel.purpose} · In flight: ${channel.inFlight}`}
        </Text>
      </div>
      <Conversation subject={channel.id} list={log} className="channels-stream-log">
        <ConversationContent>
          <div className="channels-stream-body">
            {entries.length === 0 ? (
              <div className="channels-day">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {scope === STREAM_SCOPE.NEEDS
                    ? `Nothing in #${channel.name} needs you`
                    : `Nothing of yours in #${channel.name} right now`}
                </Text>
              </div>
            ) : null}
            {entries.map((entry) => {
              const day = dayWords(entry.at, now);
              const divider =
                day === lastDay ? null : (
                  <div className="channels-day" key={`day-${day}`}>
                    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                      {day}
                    </Text>
                  </div>
                );
              lastDay = day;
              return [
                divider,
                entry === firstNew ? (
                  <div className="chat-unread-line" key="new-line">
                    New
                  </div>
                ) : null,
                entry.kind === "thread" ? (
                  <ThreadPost
                    key={entry.listed.item.id}
                    listed={entry.listed}
                    chosen={threadOpen && entry.listed.item.id === chosen}
                    readerId={readerId}
                    now={now}
                    onOpen={open}
                  />
                ) : (
                  <LocalPost key={entry.post.id} post={entry.post} readerId={readerId} now={now} />
                ),
              ];
            })}
          </div>
        </ConversationContent>
        <ConversationScrollButton />
        {above.count === 0 ? null : (
          <div className="channels-jump">
            <Button
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.OUTLINE}
              icon={<ArrowUpIcon />}
              onClick={above.onJump}
            >
              {above.count === 1 ? "1 older ask needs you" : `${above.count} older asks need you`}
            </Button>
          </div>
        )}
      </Conversation>
    </section>
  );
}

/**
 * PROTOTYPE ONLY (STAG-547): a phone's list of channels, the screen its
 * Channels tab opens, as Slack's Home lists them: each channel's glyph, its
 * name and purpose, and how many of its threads need the reader, the
 * standing channels and then the projects'.
 */
export function ChannelList(): React.JSX.Element {
  useChannelCounts();
  const row = (channel: ChannelInfo) => {
    const counted = channelCount(channel.id);
    return (
      <NavItem
        key={channel.id}
        icon={<GLYPH.CHANNEL />}
        detail={channel.purpose}
        unread={counted.unread && counted.needsYou === 0}
        count={{
          value: counted.needsYou,
          noun: counted.needsYou === 1 ? "thread needs you" : "threads need you",
          tone: STATUS_TONE.ATTENTION,
        }}
        onClick={() => chooseChannel(channel.id)}
      >
        {channel.name}
      </NavItem>
    );
  };
  return (
    <section className="channels-stream" aria-label="Channels">
      <Toolbar title="Channels" end={TOOLBAR_INSET.COLUMN} />
      <ScrollArea fade={SCROLL_FADE.BOTH}>
        <div className="channels-list">
          <GroupHeader heading={GROUP_HEADING.NONE} label="Channels" />
          {CHANNELS.filter((channel) => !channel.project).map(row)}
          <GroupHeader heading={GROUP_HEADING.NONE} label="Projects" />
          {CHANNELS.filter((channel) => channel.project).map(row)}
        </div>
      </ScrollArea>
    </section>
  );
}
