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
  Badge,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  Comment,
  STATUS_TONE,
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import {
  answerInStream,
  channelLastLooked,
  type ChannelInfo,
  type ChannelPost,
  openThread,
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
const STREAM_SCOPE = { EVERYONE: "everyone", MINE: "mine" } as const;

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

/** The ways the mockup can mark what needs the reader, compared by `?needs=` in a development tab: a badge on the post, a ground under it, and a strip under the channel's head. */
const NEEDS_LOOK = { BADGE: "badge", FILL: "fill", STRIP: "strip" } as const;

type NeedsLook = (typeof NEEDS_LOOK)[keyof typeof NEEDS_LOOK];

/** The looks shown: those the address names, else the badge and the strip. */
const NEEDS_LOOKS: ReadonlySet<NeedsLook> = (() => {
  const named = new URLSearchParams(globalThis.location?.search ?? "").get("needs");
  const all = Object.values(NEEDS_LOOK) as readonly string[];
  const picked = (named ?? "").split(",").filter((look) => all.includes(look)) as NeedsLook[];
  return new Set<NeedsLook>(picked.length > 0 ? picked : [NEEDS_LOOK.BADGE, NEEDS_LOOK.STRIP]);
})();

/** Whether a thread asks the reader something still open. */
function needsReader(listed: InboxListed, readerId: string | undefined): boolean {
  return asksSomeone(listed) && listed.item.waitsOn?.userId === readerId;
}

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
  return (
    <div className="channels-post-asks">
      {options.map((option) => (
        <Button
          key={option.label}
          size={BUTTON_SIZE.COMPACT}
          variant={option.recommended ? BUTTON_VARIANT.PRIMARY : BUTTON_VARIANT.OUTLINE}
          onClick={option.onPress}
        >
          {option.label}
        </Button>
      ))}
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
    waiting === undefined
      ? undefined
      : waiting.userId !== readerId
        ? waiting.name
        : NEEDS_LOOKS.has(NEEDS_LOOK.BADGE)
          ? undefined
          : "you";
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
      data-needs-fill={String(NEEDS_LOOKS.has(NEEDS_LOOK.FILL) && needsReader(listed, readerId))}
    >
      <Comment
        author={commentAuthor(actor)}
        nameRef={<ActorRef actor={actor} nameOnly />}
        at={item.postedAt}
        now={now}
        trailing={
          NEEDS_LOOKS.has(NEEDS_LOOK.BADGE) && needsReader(listed, readerId) ? (
            <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>
          ) : undefined
        }
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

/** The channel as a stream: its head, what needs the reader, and its posts by day. */
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
  const scoped = items.filter(
    (listed) => scope === STREAM_SCOPE.EVERYONE || isMine(listed, readerId),
  );
  const shown = scoped;
  const needing = items.filter((listed) => needsReader(listed, readerId));
  const mineCount = items.filter(
    (listed) => isMine(listed, readerId) && asksSomeone(listed),
  ).length;
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
    <section className="channels-stream" aria-label={`#${channel.name}`}>
      <Toolbar
        title={`#${channel.name}`}
        end={TOOLBAR_INSET.COLUMN}
        actions={
          <div className="channels-actions">
            <ChoiceBar
              label="Show"
              look={CHOICE_BAR_LOOK.SEGMENTED}
              size={CHOICE_BAR_SIZE.COMPACT}
              items={[
                { value: STREAM_SCOPE.EVERYONE, label: "Everyone" },
                {
                  value: STREAM_SCOPE.MINE,
                  label: "Mine",
                  count: mineCount === 0 ? undefined : String(mineCount),
                },
              ]}
              value={scope}
              onChange={choose}
            />
          </div>
        }
      />
      <div className="channels-head">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
          {channel.inFlight === ""
            ? channel.purpose
            : `${channel.purpose} · In flight: ${channel.inFlight}`}
        </Text>
      </div>
      {!NEEDS_LOOKS.has(NEEDS_LOOK.STRIP) || needing.length === 0 ? null : (
        <div className="channels-needs">
          <Badge tone={STATUS_TONE.ATTENTION}>
            {needing.length === 1 ? "1 needs you" : `${needing.length} need you`}
          </Badge>
          {needing.map((listed) => (
            <TextButton
              key={listed.item.id}
              tone={TEXT_BUTTON_TONE.ACCENT}
              onClick={() => open(listed)}
            >
              {listed.item.title}
            </TextButton>
          ))}
        </div>
      )}
      <Conversation subject={channel.id} list={log} className="channels-stream-log">
        <ConversationContent>
          <div className="channels-stream-body">
            {entries.length === 0 ? (
              <div className="channels-day">
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {`Nothing of yours in #${channel.name} right now`}
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
      </Conversation>
    </section>
  );
}
