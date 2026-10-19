import type { FileChip } from "@luke/features/attachment-model";
import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  type ChatAnswer,
  type ChatChannel,
  type ChatCodeBlock,
  type ChatImageBlock,
  type ChatMessage,
  type ChatReadBlock,
  knownBlock,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import type { MentionPlace } from "@luke/features/mention-link";
import {
  EmptyState,
  ScrollArea,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@luke/ui";
import { ACTOR_KIND, type Actor, distinctActors } from "@luke/ui/actor-model";
import type { ChatTarget } from "@luke/ui/chat-mention";
import {
  CHAT_PLACE,
  type ChatAskAnswer,
  type ChatNames,
  type ChatPlace,
  type ChatPost,
  type ChatThread,
  channelLabel,
  channelThreads,
  chatKeywords,
  chatTargets,
  chatWho,
  type ForYouEntry,
  forYou,
  placeChannel,
  postsIn,
  postTarget,
} from "@luke/ui/chat-model";
import { PICTURE_STATE, type PictureAnswer, usePicture } from "@luke/ui/picture-cache";
import { AtSignIcon, HashIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, ActorStack } from "../actor-ref.js";
import { PictureBlock } from "../picture-block.js";
import { SendingAgent } from "./agent-ref.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { useChatActor } from "./chat-actors.js";
import { AskCard } from "./chat-ask.js";
import { ChatComposer } from "./chat-composer.js";
import { FileRef } from "./file-ref.js";
import { LinkBlock } from "./inbox-pane.js";
import { RelativeTime } from "./relative-time.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * chat-pane.tsx -- one place of the window's Chat at reading size: For you, or a channel's messages with their threads.
 *
 * A message is a row led by its author's mark, an agent's own glyph as its
 * tab wears it, Luke's initial in his blue, a person's initial, then a line
 * naming the author, its handle, and when it was posted, and under it the
 * blocks it carries: Markdown as the transcript draws it, a link by its
 * label, a code block by the file and lines it points at as a transcript
 * names a file (`file-ref.tsx`), a picture drawn as a plan's picture is
 * (`../picture-block.tsx`), read once through the window's picture cache
 * under its message and pressed to open it over the window, and a line naming a
 * newer Luke for a block this build does not know. A message carrying an ask draws as a card in its row, answered in
 * place (`chat-ask.tsx`). A root with replies says how many under it, and
 * a press folds the thread open there with a box to reply in under it; a
 * root with none offers Reply at its byline's end while it is hovered,
 * which opens the box alone. A channel's
 * messages close on the composer (`chat-composer.tsx`), which posts to it.
 * For you lists what waits on the developer (`chat-model.ts`'s `forYou`),
 * each row saying the channel it was posted in, or that it is a direct
 * message, and answered or replied to where it stands. A place with
 * nothing in it says so under its rail glyph, as an empty pane does
 * (`EmptyState`). Every word an agent, Luke, or a person wrote draws through the
 * panel, so the masking keeps all of it out of a session recording, and
 * the stream is out of it whole besides (`ph-no-capture`).
 */

/** What For you says it holds, under its name. */
const FOR_YOU_META = "Asks, direct messages, and mentions waiting on you";

/** What For you says with nothing waiting. */
const NOTHING_WAITS = "Nothing waits on you.";

/** What a channel says before anything is posted in it. */
const NOTHING_POSTED = "Nothing posted here yet.";

/** What a channel no box is offered in says at its foot: an archived one, or a direct message between two others. */
const ARCHIVED_CHANNEL = "This channel is archived, so nothing more is posted in it.";
const OTHERS_DM = (pair: string) => `Only ${pair} post in this conversation.`;

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
  return count === 1 ? "1 reply" : `${count} replies`;
}

/** A code block by what it points at: the file and its lines, named as a transcript names them, with nothing to open them from here. */
function CodeLine({ block }: { block: ChatCodeBlock }): React.JSX.Element {
  const { path, startLine, endLine } = block;
  return (
    <Text>
      <FileRef codeRef={{ path, startLine, endLine }} note={undefined} onOpen={undefined} />
    </Text>
  );
}

/** What a file's name may not spell on the Mac it is saved to. */
const UNSAVEABLE = /[/\\:]/gu;

/** The picture as the viewer takes a file: its file's name, under its type's own extension where the name lacks it, since the viewer saves it by that name. */
function viewerFile(block: ChatImageBlock, url: string): FileChip {
  const mediaType = url.slice("data:".length, url.indexOf(";"));
  const extension = `.${mediaType.slice("image/".length)}`;
  const name = block.alt.replace(UNSAVEABLE, "-");
  return { name: name.endsWith(extension) ? name : `${name}${extension}`, mediaType, url };
}

/**
 * A picture a message carries: its own block at its own size up to the
 * column's, a quiet box while its bytes are read, its words where it is
 * gone, and pressed to open it larger over the window.
 */
function ChatPicture({
  messageId,
  block,
  readPicture,
}: {
  messageId: string;
  block: ChatImageBlock;
  readPicture: MessageContext["readPicture"];
}): React.JSX.Element {
  const [viewing, setViewing] = useState(false);
  const read = useCallback(
    (_message: string, attachmentId: string) => readPicture(messageId, attachmentId),
    [readPicture, messageId],
  );
  const state = usePicture(messageId, block.attachmentId, read);
  return (
    <div className="chat-picture">
      <PictureBlock
        state={state}
        alt={block.alt}
        caption={undefined}
        onOpen={() => setViewing(true)}
      />
      {viewing && state.kind === PICTURE_STATE.READY ? (
        <AttachmentViewer
          files={[viewerFile(block, state.url)]}
          at={0}
          onAt={() => undefined}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </div>
  );
}

/** One block of a message, drawn as its type is. */
function Block({
  messageId,
  block,
  context,
}: {
  messageId: string;
  block: ChatReadBlock;
  context: MessageContext;
}): React.JSX.Element {
  const { openLink } = context;
  if (!knownBlock(block)) return <Text tone={TEXT_TONE.SUBTLE}>{NEWER_LUKE}</Text>;
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      return (
        <div className="chat-words">
          <TranscriptWords text={block.text} />
        </div>
      );
    case CHAT_BLOCK.LINK:
      return (
        <Text>
          <LinkBlock url={block.url} label={block.label} openLink={openLink} />
        </Text>
      );
    case CHAT_BLOCK.CODE:
      return <CodeLine block={block} />;
    case CHAT_BLOCK.IMAGE:
      return <ChatPicture messageId={messageId} block={block} readPicture={context.readPicture} />;
  }
}

/** What the window draws a message with: the chat, the names, the moment, what the composer offers, and the doors a link, a post, and an answer go through. */
interface MessageContext {
  readonly chat: ChatAnswer;
  readonly names: ChatNames;
  readonly now: number;
  readonly targets: readonly ChatTarget[];
  /** The words a dictation in the chat is likely to say. */
  readonly keywords: readonly string[];
  /** The workspace a chip's link is written in. */
  readonly mentionPlace: MentionPlace | undefined;
  /** The actor a member is drawn as, by the member's id (`chat-actors.ts`). */
  readonly actorOf: (memberId: string) => Actor;
  readonly openLink: (url: string) => void;
  readonly onPost: (post: ChatPost) => Promise<string | undefined>;
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readonly readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer>;
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
    <Block key={index} messageId={message.id} block={block} context={context} />
  ));
  const { ask } = message;
  if (ask === undefined) return <>{blocks}</>;
  const home = context.chat.channels.find((channel) => channel.id === message.channelId);
  return (
    <AskCard
      message={message}
      ask={ask}
      mine={message.authorId === context.chat.self}
      answers={home === undefined || postsIn(context.chat, home)}
      blocks={blocks}
      nameOf={(memberId) => chatWho(context.chat, context.names, memberId).name}
      onAnswer={context.onAnswer}
    />
  );
}

/** The line over a message's body: its author, its handle, where it was posted where that is said, and when. */
/** The line over a message's words, as an Inbox comment's head is: its author by name, their card on it, where it was said, and when. */
function Byline({
  actor,
  handle,
  at,
  where,
  now,
  action,
}: {
  actor: Actor;
  /** An agent's handle, said quietly after its title, since two agents may share a title and the chat names them by it. */
  handle: string | undefined;
  at: number;
  where: string | undefined;
  now: number;
  /** A press at the line's end, shown while the message is hovered or the press has the keyboard. */
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="chat-byline">
      <span className="chat-byline-name">
        {actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
          <SendingAgent actor={actor} agentId={actor.agentId} nameOnly />
        ) : (
          <ActorRef actor={actor} nameOnly />
        )}
      </span>
      {handle === undefined ? null : <span className="chat-byline-handle">@{handle}</span>}
      {where === undefined ? null : <span className="chat-byline-where">{where}</span>}
      <RelativeTime at={at} now={now} />
      {action}
    </div>
  );
}

/** An agent author's handle, which tells two agents of one title apart; none for a person or Luke, named by who they are. */
function agentHandle(context: MessageContext, memberId: string): string | undefined {
  const member = context.chat.members.find((each) => each.id === memberId);
  return member?.kind === MEMBER_KIND.AGENT ? member.handle : undefined;
}

/** The face a message leads with, in a column of its own: the author's photo, Luke, or the agent's harness, as a list row draws them. */
function Face({ actor }: { actor: Actor }): React.JSX.Element {
  return (
    <span className="chat-face">
      <ActorMark actor={actor} size={ACTOR_SIZE.ROW} />
    </span>
  );
}

/** One message of a thread: its face, its byline, and its body. */
function Reply({ message, context }: { message: ChatMessage; context: MessageContext }) {
  const actor = context.actorOf(message.authorId);
  return (
    <li className="chat-reply" data-seq={message.seq}>
      <Face actor={actor} />
      <div className="chat-message-body">
        <Byline
          actor={actor}
          handle={agentHandle(context, message.authorId)}
          at={message.postedAt}
          where={undefined}
          now={context.now}
        />
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
  const actor = context.actorOf(message.authorId);
  const home = context.chat.channels.find((channel) => channel.id === message.channelId);
  // The thread's repliers lead its press by their faces, each once, as a comment thread at rest names them.
  const repliers = distinctActors(replies.map((reply) => context.actorOf(reply.authorId)));
  // A thread in a channel the reader cannot post in reads as it stands, with no box to reply in.
  const canReply = home === undefined || postsIn(context.chat, home);
  const toggle = (
    <TextButton
      tone={TEXT_BUTTON_TONE.ACCENT}
      aria-expanded={open}
      onClick={() => setOpen((was) => !was)}
    >
      {replies.length > 0 && !open ? <ActorStack actors={repliers} drawn={3} /> : null}
      {threadToggleWords(open, replies.length)}
    </TextButton>
  );
  // A message nobody has replied to offers Reply at its byline's end, out of the way until wanted.
  const quiet = replies.length === 0 && !open;
  if (quiet && !canReply) {
    return (
      <li className="chat-message" data-seq={message.seq}>
        <Face actor={actor} />
        <div className="chat-message-body">
          <Byline
            actor={actor}
            handle={agentHandle(context, message.authorId)}
            at={message.postedAt}
            where={where}
            now={context.now}
          />
          <Body message={message} context={context} />
        </div>
      </li>
    );
  }
  return (
    <li className="chat-message" data-seq={message.seq}>
      <Face actor={actor} />
      <div className="chat-message-body">
        <Byline
          actor={actor}
          handle={agentHandle(context, message.authorId)}
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
            {open && canReply ? (
              <ChatComposer
                label="Reply in thread"
                targets={context.targets}
                keywords={context.keywords}
                place={context.mentionPlace}
                compact
                onSend={(text, attachments) =>
                  context.onPost({ ...postOf(text, attachments), replyTo: message.seq })
                }
              />
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/** A post's words and pictures as it carries them: each where there is any, since a post may be pictures alone. */
function postOf(text: string, attachments: readonly CodingAgentAttachment[]): ChatPost {
  return {
    ...(text === "" ? undefined : { text }),
    ...(attachments.length === 0 ? undefined : { attachments }),
  };
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
  lead,
  actions,
}: {
  title: string;
  meta: string | undefined;
  lead: React.ReactNode;
  /** The place's own presses at the head's end, a topic's menu. */
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar chat-head">
      {lead}
      <Text as={TEXT_ELEMENT.H2} variant={TEXT_VARIANT.DIALOG} truncate>
        {title}
      </Text>
      {meta === undefined ? null : (
        <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED} truncate>
          {meta}
        </Text>
      )}
      {actions === undefined ? null : <span className="chat-head-actions">{actions}</span>}
    </header>
  );
}

/** What a channel's head says beside its name: a plan channel's plan, a DM's other member's agent or plan. */
function channelMeta(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string | undefined {
  switch (channel.kind) {
    case CHANNEL_KIND.GENERAL:
      return CHANNEL_META[channel.kind];
    case CHANNEL_KIND.TOPIC:
      return channel.purpose ?? CHANNEL_META[channel.kind];
    case CHANNEL_KIND.TASK:
      return channel.planId === undefined ? undefined : names.tasks.get(channel.planId);
    case CHANNEL_KIND.DM: {
      const other = channel.members?.find((id) => id !== chat.self);
      if (other === undefined) return undefined;
      const who = chatWho(chat, names, other);
      return who.agent?.title ?? who.taskName ?? undefined;
    }
  }
}

/** A direct message's two, each by their handle, as its title and its foot name them where the reader is neither. */
function dmPair(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  return (channel.members ?? []).map((id) => `@${chatWho(chat, names, id).handle}`).join(" and ");
}

/** A channel's title as its head says it: `# name`, a DM's `@handle`, or a DM between two others' `@a ↔ @b`. */
function channelTitle(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  if (channel.kind === CHANNEL_KIND.DM && !(channel.members ?? []).includes(chat.self)) {
    return (channel.members ?? []).map((id) => `@${chatWho(chat, names, id).handle}`).join(" ↔ ");
  }
  const label = channelLabel(chat, names, channel);
  return channel.kind === CHANNEL_KIND.DM ? `@${label}` : `# ${label}`;
}

/** The pane: the place's head, then its messages, or a line saying there are none, and a channel's composer. */
export function ChatPane({
  chat,
  names,
  place,
  mentionPlace,
  now,
  openLink,
  onPost,
  onAnswer,
  readPicture,
  lead,
  channelActions,
  hidden,
}: {
  chat: ChatAnswer;
  names: ChatNames;
  place: ChatPlace;
  /** The workspace a chip's link is written in; none where it is not known yet, when members are written as their handles. */
  mentionPlace?: MentionPlace | undefined;
  now: number;
  openLink: (url: string) => void;
  /** Posts a message; answers why it was refused, or nothing once it is taken. */
  onPost: (post: ChatPost) => Promise<string | undefined>;
  /** Answers an ask; answers why it was refused, or nothing once it is taken. */
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer>;
  /** What leads the place's head: the way back to the rail, where the place stands alone. */
  lead?: React.ReactNode;
  /** The presses a channel's head ends on, a topic's menu; none where the channel offers none. */
  channelActions?: ((channel: ChatChannel) => React.ReactNode) | undefined;
  /** Whether the pane is hidden, as a narrow room hides it behind the rail. */
  hidden?: boolean;
}): React.JSX.Element {
  const targets = chatTargets(chat, names);
  const keywords = chatKeywords(chat, names);
  const actorOf = useChatActor(chat, names);
  const context: MessageContext = {
    actorOf,
    chat,
    names,
    now,
    targets,
    keywords,
    mentionPlace,
    openLink,
    onPost,
    onAnswer,
    readPicture,
  };
  const channel = placeChannel(chat, place);
  if (place.kind === CHAT_PLACE.FOR_YOU || channel === undefined) {
    const entries = forYou(chat);
    return (
      <section className="chat-stream ph-no-capture" aria-label="For you" hidden={hidden}>
        <PlaceHead title="For you" meta={FOR_YOU_META} lead={lead} />
        {entries.length === 0 ? (
          <EmptyState icon={<AtSignIcon />}>{NOTHING_WAITS}</EmptyState>
        ) : (
          <ScrollArea>
            <div className="chat-stream-body">
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
            </div>
          </ScrollArea>
        )}
      </section>
    );
  }
  const threads = channelThreads(chat, channel.id);
  const title = channelTitle(chat, names, channel);
  return (
    <section className="chat-stream ph-no-capture" aria-label={title} hidden={hidden}>
      <PlaceHead
        title={title}
        meta={channelMeta(chat, names, channel)}
        lead={lead}
        actions={channelActions?.(channel)}
      />
      {threads.length === 0 ? (
        <EmptyState icon={channel.kind === CHANNEL_KIND.DM ? <AtSignIcon /> : <HashIcon />}>
          {NOTHING_POSTED}
        </EmptyState>
      ) : (
        <ScrollArea>
          <div className="chat-stream-body">
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
          </div>
        </ScrollArea>
      )}
      {/* Note that the composer is keyed by its channel, so words typed for one are never sent to another. */}
      {postsIn(chat, channel) ? (
        <ChatComposer
          key={channel.id}
          label={`Message ${postTarget(chat, names, channel)}`}
          targets={targets}
          keywords={keywords}
          place={mentionPlace}
          onSend={(text, attachments) =>
            onPost({ ...postOf(text, attachments), to: postTarget(chat, names, channel) })
          }
        />
      ) : (
        <div className="chat-closed-foot">
          <Text tone={TEXT_TONE.MUTED}>
            {channel.archived ? ARCHIVED_CHANNEL : OTHERS_DM(dmPair(chat, names, channel))}
          </Text>
        </div>
      )}
    </section>
  );
}
