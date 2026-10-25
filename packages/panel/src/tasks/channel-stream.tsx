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
  TEXT_BUTTON_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TOOLBAR_INSET,
  Toolbar,
} from "@luke/ui";
import { useRef } from "react";
import { useAct } from "../act.js";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import {
  addChannelPost,
  answerInStream,
  type ChannelInfo,
  type ChannelPost,
  openThread,
  useChannelPosts,
  useStreamAnswer,
} from "./channels-mock.js";
import { ChatComposer } from "./chat-composer.js";
import { agentActor } from "./coding-agent-model.js";
import { INBOX_HOLDER, type InboxListed, openAskOf } from "./inbox-model.js";
import { NO_TASK } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

const DAY = 24 * 60 * 60 * 1000;
const NO_KEYWORDS: readonly string[] = [];

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
  const waiting = item.waitsOn;
  const waitingOther =
    item.status === INBOX_STATUS.OPEN &&
    openAskOf(item.thread ?? []) !== undefined &&
    waiting !== undefined &&
    waiting.userId !== readerId;
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
      {waitingOther ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {`Waiting on ${waiting.name}`}
        </Text>
      ) : null}
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

/** The channel as a stream: its head, its posts by day, and the box at its foot. */
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
  const entries: StreamEntry[] = [
    ...items.map((listed) => ({ kind: "thread" as const, at: listed.item.postedAt, listed })),
    ...posts.map((post) => ({ kind: "post" as const, at: post.at, post })),
  ].toSorted((a, b) => a.at - b.at);
  const open = (listed: InboxListed) => {
    onOpen(listed);
    openThread();
  };
  let lastDay = "";
  return (
    <section className="channels-stream" aria-label={`#${channel.name}`}>
      <Toolbar title={`#${channel.name}`} end={TOOLBAR_INSET.COLUMN} />
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
      <div className="channels-composer">
        <ChatComposer
          key={channel.id}
          channelId={`channels-mock-${channel.id}`}
          label={`Message #${channel.name}`}
          mentions={{
            source: {
              taskId: NO_TASK,
              taskName: "",
              workspace: "stage",
              repository: "ReviewStage/luke",
              text: () => "",
            },
            members: { people: [], agents: [] },
            channels: [],
            crowded: () => false,
          }}
          keywords={NO_KEYWORDS}
          onSend={(text) => addChannelPost(channel.id, text)}
        />
      </div>
    </section>
  );
}
