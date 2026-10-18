import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  type ChatAnswer,
  type ChatChannel,
  type ChatCodeBlock,
  type ChatMessage,
  type ChatReadBlock,
  knownBlock,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { TEXT_BUTTON_TONE, TextButton } from "@luke/ui";
import type { ChatTarget } from "@luke/ui/chat-mention";
import {
  CHAT_PLACE,
  type ChatAskAnswer,
  type ChatNames,
  type ChatPlace,
  type ChatPost,
  type ChatThread,
  type ChatWho,
  channelLabel,
  channelThreads,
  chatTargets,
  chatWho,
  type ForYouEntry,
  forYou,
  placeChannel,
  postTarget,
} from "@luke/ui/chat-model";
import { useState } from "react";
import { AskCard } from "./chat-ask";
import { ChatComposer } from "./chat-composer";
import { LinkBlock } from "./inbox-pane";
import { RelativeTime } from "./relative-time";
import { AgentGlyph } from "./tab-look";
import { TranscriptWords } from "./transcript-blocks";

/**
 * chat-pane.tsx -- one place of the window's Chat at reading size: For you, or a channel's messages with their threads.
 *
 * A message is a row led by its author's mark, an agent's own glyph as its
 * tab wears it, Luke's initial in his blue, a person's initial, then a line
 * naming the author, its handle, and when it was posted, and under it the
 * blocks it carries: Markdown as the transcript draws it, a link by its
 * label, a code block by the file and lines it points at, an image by its
 * words, and a line naming a newer Luke for a block this build does not
 * know. A message carrying an ask draws as a card in its row, answered in
 * place (`chat-ask.tsx`). A root with replies says how many under it, and
 * a press folds the thread open there with a box to reply in under it; a
 * root with none offers Reply at its byline's end while it is hovered,
 * which opens the box alone. A channel's
 * messages close on the composer (`chat-composer.tsx`), which posts to it.
 * For you lists what waits on the developer (`chat-model.ts`'s `forYou`),
 * each row saying the channel it was posted in, or that it is a direct
 * message, and answered or replied to where it stands. Every word an agent, Luke, or a person wrote draws through the
 * panel, so the masking keeps all of it out of a session recording, and
 * the stream is out of it whole besides (`ph-no-capture`).
 */

/** What For you says it holds, under its name. */
const FOR_YOU_META = "Asks, direct messages, and mentions waiting on you";

/** What For you says with nothing waiting. */
const NOTHING_WAITS = "Nothing waits on you.";

/** What a channel says before anything is posted in it. */
const NOTHING_POSTED = "Nothing posted here yet.";

/** What a row says of a block this build does not know. */
const NEWER_LUKE = "Open this in a newer Luke to see the rest.";

/** What a channel's head says of it beside its name, by its kind. */
const CHANNEL_META = {
  [CHANNEL_KIND.GENERAL]: "Everyone in the workspace",
  [CHANNEL_KIND.TOPIC]: "Topic",
} as const;

/** What a thread's press says: how many replies a folded one holds, Reply where it holds none, Hide once open. */
function threadToggleWords(open: boolean, count: number): string {
  if (open) return "Hide thread";
  if (count === 0) return "Reply";
  return `View thread · ${count === 1 ? "1 reply" : `${count} replies`}`;
}

/** What the composer at a channel's foot says it takes. */
const COMPOSER_HINTS = ["@ mention an agent, Luke, or a teammate", "# link a channel"] as const;

/** The mark a member's lines lead with: an agent's glyph, Luke's initial, a person's initial. */
export function MemberMark({ who, small }: { who: ChatWho; small?: boolean }): React.JSX.Element {
  const kind = who.member?.kind;
  const size = small === true ? "small" : "full";
  if (kind === MEMBER_KIND.AGENT) {
    return (
      <span className="chat-mark" data-kind={kind} data-size={size} aria-hidden="true">
        {/* Note that the mark is the agent's harness at rest, since a line says who wrote it, not where its agent stands now. */}
        <AgentGlyph agent={who.agent === undefined ? undefined : { model: who.agent.model }} />
      </span>
    );
  }
  const initial = kind === MEMBER_KIND.PLANNER ? "L" : (who.name.at(0)?.toUpperCase() ?? "?");
  return (
    <span className="chat-mark" data-kind={kind ?? "unknown"} data-size={size} aria-hidden="true">
      {initial}
    </span>
  );
}

/** A code block by what it points at: the file and its lines, at the agent's commit. */
function CodeLine({ block }: { block: ChatCodeBlock }): React.JSX.Element {
  const lines =
    block.startLine === block.endLine
      ? `Line ${block.startLine}`
      : `Lines ${block.startLine}–${block.endLine}`;
  return (
    <p className="chat-code" data-chat-code="">
      <span className="chat-code-path">{block.path}</span>
      <span className="chat-code-lines">{lines}</span>
    </p>
  );
}

/** One block of a message, drawn as its type is. */
function Block({
  block,
  openLink,
}: {
  block: ChatReadBlock;
  openLink: (url: string) => void;
}): React.JSX.Element {
  if (!knownBlock(block)) return <p className="chat-unknown">{NEWER_LUKE}</p>;
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      return (
        <div className="chat-words">
          <TranscriptWords text={block.text} />
        </div>
      );
    case CHAT_BLOCK.LINK:
      return (
        <p className="chat-link">
          <LinkBlock url={block.url} label={block.label} openLink={openLink} />
        </p>
      );
    case CHAT_BLOCK.CODE:
      return <CodeLine block={block} />;
    case CHAT_BLOCK.IMAGE:
      return <p className="chat-image-words">{block.alt}</p>;
  }
}

/** What the window draws a message with: the chat, the names, the moment, what the composer offers, and the doors a link, a post, and an answer go through. */
interface MessageContext {
  readonly chat: ChatAnswer;
  readonly names: ChatNames;
  readonly now: number;
  readonly targets: readonly ChatTarget[];
  readonly openLink: (url: string) => void;
  readonly onPost: (post: ChatPost) => Promise<string | undefined>;
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}

/** A message's body: its ask's card where it carries one, its blocks inside, else its blocks in turn. */
function Body({
  message,
  context,
}: {
  message: ChatMessage;
  context: MessageContext;
}): React.JSX.Element {
  const blocks = message.blocks.map((block, index) => (
    // Blocks have no key of their own and are never reordered.
    <Block key={index} block={block} openLink={context.openLink} />
  ));
  const { ask } = message;
  if (ask === undefined) return <>{blocks}</>;
  return (
    <AskCard
      message={message}
      ask={ask}
      mine={message.authorId === context.chat.self}
      blocks={blocks}
      nameOf={(memberId) => chatWho(context.chat, context.names, memberId).name}
      onAnswer={context.onAnswer}
    />
  );
}

/** The line over a message's body: its author, its handle, where it was posted where that is said, and when. */
function Byline({
  who,
  at,
  where,
  now,
  action,
}: {
  who: ChatWho;
  at: number;
  where: string | undefined;
  now: number;
  /** A press at the line's end, shown while the message is hovered or the press has the keyboard. */
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="chat-byline">
      <span className="chat-author">{who.name}</span>
      <span className="chat-handle">@{who.handle}</span>
      {where === undefined ? null : <span className="chat-where">{where}</span>}
      <RelativeTime className="chat-time" at={at} now={now} />
      {action}
    </div>
  );
}

/** One message of a thread: a smaller mark, its byline, and its body. */
function Reply({ message, context }: { message: ChatMessage; context: MessageContext }) {
  const who = chatWho(context.chat, context.names, message.authorId);
  return (
    <li className="chat-reply" data-seq={message.seq}>
      <MemberMark who={who} small />
      <div className="chat-message-body">
        <Byline who={who} at={message.postedAt} where={undefined} now={context.now} />
        <Body message={message} context={context} />
      </div>
    </li>
  );
}

/** A root message, its thread folded under it until a press opens it with the box to reply in. */
function ThreadRow({
  thread,
  where,
  context,
}: {
  thread: ChatThread;
  where: string | undefined;
  context: MessageContext;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { message, replies } = thread;
  const who = chatWho(context.chat, context.names, message.authorId);
  const toggle = (
    <TextButton
      tone={TEXT_BUTTON_TONE.ACCENT}
      aria-expanded={open}
      onClick={() => setOpen((was) => !was)}
    >
      {threadToggleWords(open, replies.length)}
    </TextButton>
  );
  // A message nobody has replied to offers Reply at its byline's end, out of the way until wanted.
  const quiet = replies.length === 0 && !open;
  return (
    <li className="chat-message" data-seq={message.seq}>
      <MemberMark who={who} />
      <div className="chat-message-body">
        <Byline
          who={who}
          at={message.postedAt}
          where={where}
          now={context.now}
          action={quiet ? <span className="chat-byline-action">{toggle}</span> : undefined}
        />
        <Body message={message} context={context} />
        {quiet ? null : (
          <div className="chat-thread" data-open={String(open)}>
            <p className="chat-thread-toggle">{toggle}</p>
            {open && replies.length > 0 ? (
              <ul className="chat-replies">
                {replies.map((reply) => (
                  <Reply key={reply.id} message={reply} context={context} />
                ))}
              </ul>
            ) : null}
            {open ? (
              <ChatComposer
                label="Reply in thread"
                hints={[]}
                targets={context.targets}
                compact
                onSend={(text) => context.onPost({ text, replyTo: message.seq })}
              />
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/** Where For you says a message was posted: its channel, or a direct message. */
function whereWords(chat: ChatAnswer, names: ChatNames, entry: ForYouEntry): string {
  // Note that the channel decides, not the reason, since an ask in a direct message is listed as an ask.
  if (entry.channel.kind === CHANNEL_KIND.DM) return "direct message";
  return `in #${channelLabel(chat, names, entry.channel)}`;
}

/** The head over a place: its name, and what it says beside that. */
function PlaceHead({
  title,
  meta,
}: {
  title: string;
  meta: string | undefined;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar chat-head">
      <h2 className="chat-head-title">{title}</h2>
      {meta === undefined ? null : <span className="chat-head-meta">{meta}</span>}
    </header>
  );
}

/** What a channel's head says beside its name: a plan channel's plan, a DM's other member's agent or plan. */
function channelMeta(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string | undefined {
  switch (channel.kind) {
    case CHANNEL_KIND.GENERAL:
    case CHANNEL_KIND.TOPIC:
      return CHANNEL_META[channel.kind];
    case CHANNEL_KIND.PLAN:
      return channel.planId === undefined ? undefined : names.plans.get(channel.planId);
    case CHANNEL_KIND.DM: {
      const other = channel.members?.find((id) => id !== chat.self);
      if (other === undefined) return undefined;
      const who = chatWho(chat, names, other);
      return who.agent?.title ?? who.planName ?? undefined;
    }
  }
}

/** A channel's title as its head says it: `# name`, or a DM's `@handle`. */
function channelTitle(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  const label = channelLabel(chat, names, channel);
  return channel.kind === CHANNEL_KIND.DM ? `@${label}` : `# ${label}`;
}

/** The pane: the place's head, then its messages, or a line saying there are none, and a channel's composer. */
export function ChatPane({
  chat,
  names,
  place,
  now,
  openLink,
  onPost,
  onAnswer,
}: {
  chat: ChatAnswer;
  names: ChatNames;
  place: ChatPlace;
  now: number;
  openLink: (url: string) => void;
  /** Posts a message; answers why it was refused, or nothing once it is taken. */
  onPost: (post: ChatPost) => Promise<string | undefined>;
  /** Answers an ask; answers why it was refused, or nothing once it is taken. */
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}): React.JSX.Element {
  const targets = chatTargets(chat, names);
  const context: MessageContext = { chat, names, now, targets, openLink, onPost, onAnswer };
  const channel = placeChannel(chat, place);
  if (place.kind === CHAT_PLACE.FOR_YOU || channel === undefined) {
    const entries = forYou(chat);
    return (
      <section className="chat-stream ph-no-capture" aria-label="For you">
        <PlaceHead title="For you" meta={FOR_YOU_META} />
        <div className="chat-scroll">
          {entries.length === 0 ? (
            <p className="chat-empty">{NOTHING_WAITS}</p>
          ) : (
            <ol className="chat-messages">
              {entries.map((entry) => (
                <ThreadRow
                  key={entry.message.id}
                  thread={entry}
                  where={whereWords(chat, names, entry)}
                  context={context}
                />
              ))}
            </ol>
          )}
        </div>
      </section>
    );
  }
  const threads = channelThreads(chat, channel.id);
  const title = channelTitle(chat, names, channel);
  return (
    <section className="chat-stream ph-no-capture" aria-label={title}>
      <PlaceHead title={title} meta={channelMeta(chat, names, channel)} />
      <div className="chat-scroll">
        {threads.length === 0 ? (
          <p className="chat-empty">{NOTHING_POSTED}</p>
        ) : (
          <ol className="chat-messages">
            {threads.map((thread) => (
              <ThreadRow
                key={thread.message.id}
                thread={thread}
                where={undefined}
                context={context}
              />
            ))}
          </ol>
        )}
      </div>
      {/* Note that the composer is keyed by its channel, so words typed for one are never sent to another. */}
      <ChatComposer
        key={channel.id}
        label={`Message ${postTarget(chat, names, channel)}`}
        hints={COMPOSER_HINTS}
        targets={targets}
        onSend={(text) => onPost({ text, to: postTarget(chat, names, channel) })}
      />
    </section>
  );
}
