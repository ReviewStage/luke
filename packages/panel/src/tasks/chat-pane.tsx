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
import type { TaskSummary } from "@luke/features/task-wire";
import { EmptyState, TEXT_BUTTON_TONE, TEXT_ELEMENT, TEXT_TONE, Text, TextButton } from "@luke/ui";
import { ACTOR_KIND, type Actor, actorName, distinctActors } from "@luke/ui/actor-model";
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
  chatWho,
  continuesRun,
  type ForYouEntry,
  firstUnreadSeq,
  forYou,
  messageMarkdown,
  placeChannel,
  postsIn,
} from "@luke/ui/chat-model";
import { PICTURE_STATE, type PictureAnswer, usePicture } from "@luke/ui/picture-cache";
import type { SkillOption } from "@luke/ui/skill-mention";
import { AtSignIcon, CircleAlertIcon, HashIcon } from "lucide-react";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, ActorStack } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { MESSAGE_ACTIONS_PLACEMENT } from "../ai-elements/message.js";
import { FADING_ELEMENT, FadingWords } from "../fading-words.js";
import { PictureBlock } from "../picture-block.js";
import { SendingAgent } from "./agent-ref.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { useChatActor } from "./chat-actors.js";
import { AskCard } from "./chat-ask.js";
import { ChannelName, channelTitle } from "./chat-channel-name.js";
import { ChatComposer, type ChatComposerMentions } from "./chat-composer.js";
import { useChatMentions } from "./chat-mention-source.js";
import { CopyMessageAction } from "./copy-message.js";
import { FileRef } from "./file-ref.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { NEEDS_YOU } from "./inbox-model.js";
import { LinkBlock } from "./inbox-pane.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { RelativeTime } from "./relative-time.js";
import { SentWords, SkillFiles } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * chat-pane.tsx -- one place of the window's Chat at reading size: For you, or a channel's messages with their threads.
 *
 * A message is a row led by its author's mark, an agent's own glyph as its
 * tab wears it, or a person's photo or initial, then a line
 * naming the author and when it was posted, and under it the
 * blocks it carries: Markdown drawn as a document, as an Inbox item's is,
 * a link alone on its line as its card, and a person's words as they typed
 * them, their line breaks and skills kept (`skill-chip.tsx`'s `SentWords`);
 * a link by its label; a code block in a task's channel as the Inbox's
 * card of its lines, read through the task and opening the file in it
 * (`inbox-code-card.tsx`), and elsewhere by the file and lines it points
 * at as a transcript names a file (`file-ref.tsx`); a picture drawn as a plan's picture is
 * (`../picture-block.tsx`), read once through the window's picture cache
 * under its message and pressed to open it over the window, and a line naming a
 * newer Luke for a block this build does not know. A message carrying an ask draws as a card in its row, answered in
 * place (`chat-ask.tsx`). A root with replies says how many under it, and
 * a press folds the thread open there with a box to reply in under it; a
 * root with none offers Reply at its byline's end while it is hovered,
 * which opens the box alone, beside the Copy every message offers there.
 * A place's messages are a log, as every conversation in the window is:
 * it opens at the newest, follows new ones while the reader is there, and
 * a channel opened with messages unread draws a "New" line before the
 * first of them. A channel's
 * messages close on the composer (`chat-composer.tsx`), which posts to it.
 * A task's channel reads through that task's doors where the place drawing
 * it hands them (`ChatTaskDoors`): its code cards, and in the window's
 * Chat, which stands on no task's page, its mentions, so a file's chip
 * opens the file in its task.
 * For you lists what waits on the developer (`chat-model.ts`'s `forYou`),
 * each row saying the channel it was posted in, or that it is a direct
 * message, pressed to open it there, and answered or replied to where it
 * stands. A channel is named as the rail names it: a task's by its glyph
 * and name, as a task is named everywhere (`PlanGlyph`), a topic by its
 * `#name`, and a direct message by who it is with. A place's head is a
 * page's toolbar, its name in the toolbar's title. A place with
 * nothing in it says so under its rail glyph, as an empty pane does
 * (`EmptyState`). An archived topic's foot offers to bring it back where
 * its box stood, as an archived task's composer does
 * (`ArchivedComposerNote`). Every word an agent, Luke, or a person wrote draws through the
 * panel, so the masking keeps all of it out of a session recording, and
 * the stream is out of it whole besides (`ph-no-capture`).
 */

/** The tasks of a window that lists none. */
const NO_TASKS: readonly TaskSummary[] = [];

/** What a channel says before anything is posted in it. */
const NOTHING_POSTED = "Nothing posted here yet.";

/** What a channel no box is offered in says at its foot: an archived one, or a direct message between two others; and the press that brings an archived topic back. */
const ARCHIVED_CHANNEL = "This channel is archived";
const BRING_BACK_CHANNEL = "Bring back channel";
const OTHERS_DM = (pair: string) => `Only ${pair} post in this conversation.`;

/** What a row says of a block this build does not know. */
const NEWER_LUKE = "Open this in a newer Luke to see the rest.";

/** Where For you says a direct message was posted, in a channel's name's place. */
const DIRECT_MESSAGE = "direct message";

/** What a channel's head says of it beside its name, by its kind. */
const CHANNEL_META = {
  [CHANNEL_KIND.GENERAL]: "Everyone in the workspace",
  [CHANNEL_KIND.TOPIC]: "Topic",
} as const;

/** How many repliers a folded thread draws before it counts the rest. */
const REPLIERS_DRAWN = 3;

/** What a folded thread's faces are, to a screen reader. */
const REPLIERS_LABEL = "Replies from";

/** What For you is called, at its head and in the rail. */
const FOR_YOU_TITLE = "For you";

/** What a thread's press says: how many replies a folded one holds, Reply where it holds none, Hide once open. */
function threadToggleWords(open: boolean, count: number): string {
  if (open) return "Hide thread";
  if (count === 0) return "Reply";
  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * A code block: the Inbox's card of its lines in a task's channel, read
 * through the task and opening the file in it; elsewhere, where no task's
 * repository reads them, the file and its lines named as a transcript
 * names them, with nothing to open them from.
 */
function CodeBlock({
  block,
  code,
}: {
  block: ChatCodeBlock;
  code: InboxCodeDoors | undefined;
}): React.JSX.Element {
  if (code !== undefined) return <InboxCodeCard block={block} code={code} />;
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

/** One block of a message, drawn as its type is; `typed` where a person wrote it. */
function Block({
  messageId,
  block,
  typed,
  code,
  context,
}: {
  messageId: string;
  block: ChatReadBlock;
  typed: boolean;
  /** What a code block reads its lines through and opens its file with; none outside a task's channel. */
  code: InboxCodeDoors | undefined;
  context: MessageContext;
}): React.JSX.Element {
  const { openLink } = context;
  if (!knownBlock(block)) return <Text tone={TEXT_TONE.SUBTLE}>{NEWER_LUKE}</Text>;
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      // Note that every message is drawn as a document, as an Inbox item's words are, so a link alone on its line is its card.
      return (
        <div className="chat-words">
          {typed ? (
            <SentWords text={block.text} asDocument />
          ) : (
            <TranscriptWords text={block.text} asDocument />
          )}
        </div>
      );
    case CHAT_BLOCK.LINK:
      return (
        <Text>
          <LinkBlock url={block.url} label={block.label} openLink={openLink} />
        </Text>
      );
    case CHAT_BLOCK.CODE:
      return <CodeBlock block={block} code={code} />;
    case CHAT_BLOCK.IMAGE:
      return <ChatPicture messageId={messageId} block={block} readPicture={context.readPicture} />;
  }
}

/**
 * What a task's channel reads through where Chat draws it: what its code
 * reads its lines through and opens its files with, and, where the place
 * drawing it stands off the task's page, the task's mentions, so a file's
 * chip opens the file in its task and a GitHub link is read against its
 * repository.
 */
export interface ChatTaskDoors {
  readonly code: InboxCodeDoors;
  /** None where the page drawing the chat hands the task's mentions itself, as the plan's Chat tab stands on the task's page. */
  readonly mentions?: TaskMentionsValue | undefined;
  /** Where a person's `/skill` is read from and what opens its file, so it draws as its chip; none where the page hands its own, or the task names no repository. */
  readonly skills?:
    | { readonly source: SkillSource; readonly onOpen: (skill: SkillOption) => void }
    | undefined;
}

/** What the window draws a message with: the chat, the names, the moment, what the composer offers, and the doors a link, a post, and an answer go through. */
interface MessageContext {
  readonly chat: ChatAnswer;
  readonly names: ChatNames;
  readonly now: number;
  /** What a composer posting in the channel offers to name: the members a post there reaches, its task, and the channels. */
  /** What a composer posting in the channel offers, a reply's by the members of its thread, its root's author and repliers. */
  readonly mentionsIn: (channelId: string, thread?: readonly string[]) => ChatComposerMentions;
  /** The words a dictation in the chat is likely to say. */
  readonly keywords: readonly string[];
  /** The actor a member is drawn as, by the member's id (`chat-actors.ts`). */
  readonly actorOf: (memberId: string) => Actor;
  readonly openLink: (url: string) => void;
  /** Posts from a box, the post drawn as on its way until the chat holds it (`usePendingPosts`). */
  readonly send: (
    place: PendingPlace,
    post: ChatPost,
    takeBack: (refused: string) => boolean,
  ) => void;
  /** The reader's posts the chat does not hold yet, in the order sent. */
  readonly pending: readonly PendingPost[];
  readonly onRetryPost: (id: string) => void;
  readonly onDiscardPost: (id: string) => void;
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readonly readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer>;
  /** The doors of the task whose channel the channel named is; none for any other channel, or a task not at hand. */
  readonly doorsIn: (channelId: string) => ChatTaskDoors | undefined;
  /** Shows a place of the chat, as For you's row opens the channel it was posted in; none where no other place is shown here. */
  readonly onOpen: ((place: ChatPlace) => void) | undefined;
}

/** Where a post goes: its channel, and the thread's root it replies under, by its place; none for the channel's foot. */
interface PendingPlace {
  readonly channelId: string;
  readonly replyTo?: number | undefined;
}

/** A post the reader sent that the chat does not hold yet: on its way, or refused with why. */
interface PendingPost extends PendingPlace {
  /** The key the post goes under, which the chat hands back on the message once it holds it (`ChatMessage.clientKey`), so the message stands in the post's place whichever lands first. */
  readonly id: string;
  readonly post: ChatPost;
  /** When it was sent, which its byline says. */
  readonly at: number;
  /** Why it was refused, where it was and its words stayed on it rather than in the box. */
  readonly refused?: string;
}

/** What a post refused says where nothing said why. */
const UNSENT = "Not sent";
const RETRY_POST = "Retry";
const DISCARD_POST = "Discard";

/**
 * The reader's posts on their way, drawn in the stream as theirs at once,
 * each under the key it goes under, and drawn no more once the chat holds a
 * message under that key, which the reader's own messages carry, so the
 * message stands in the post's place and never beside it, whether the push
 * or the post's answer brings it first. Posts go one at a time in the order
 * sent, each once the one before it has answered, since the service places
 * each as it takes it. A post refused goes back to its box where the box
 * holds nothing newer (`ChatSend`), and the same words sent from there again
 * go under the same key, so a post whose answer was lost is posted once;
 * else it stays where it went, marked as not sent, with Retry, which sends
 * it under its key, and Discard.
 */
/** A post's place and words, which the same post sent again is known by. */
function postWords(entry: PendingPlace & { readonly post: ChatPost }): string {
  return JSON.stringify([entry.channelId, entry.replyTo ?? null, entry.post]);
}

function usePendingPosts(
  chat: ChatAnswer,
  onPost: (post: ChatPost, clientKey: string) => Promise<string | undefined>,
) {
  const [pending, setPending] = useState<readonly PendingPost[]>([]);
  // The key of each post taken back into its box, by its place and words, which the same post sent again goes under.
  const refusedKeys = useRef(new Map<string, string>());
  const latest = useRef(onPost);
  latest.current = onPost;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const go = (entry: PendingPost, takeBack: (refused: string) => boolean) => {
    queue.current = queue.current.then(async () => {
      const refused = await latest
        .current(entry.post, entry.id)
        .catch((failed: unknown) => (failed instanceof Error ? failed.message : UNSENT));
      const back = refused !== undefined && takeBack(refused);
      if (back) refusedKeys.current.set(postWords(entry), entry.id);
      setPending((was) =>
        refused === undefined || back
          ? was.filter((each) => each.id !== entry.id)
          : was.map((each) => (each.id === entry.id ? { ...each, refused } : each)),
      );
    });
  };
  const send = (place: PendingPlace, post: ChatPost, takeBack: (refused: string) => boolean) => {
    const words = postWords({ ...place, post });
    const id = refusedKeys.current.get(words) ?? crypto.randomUUID();
    refusedKeys.current.delete(words);
    const entry: PendingPost = { ...place, id, post, at: Date.now() };
    setPending((was) => [...was, entry]);
    go(entry, takeBack);
  };
  const onRetryPost = (id: string) => {
    const entry = pending.find((each) => each.id === id);
    if (entry?.refused === undefined) return;
    const { refused: _refused, ...again } = entry;
    setPending((was) => was.map((each) => (each.id === id ? again : each)));
    go(again, () => false);
  };
  const onDiscardPost = (id: string) => setPending((was) => was.filter((each) => each.id !== id));
  // Note that a post the chat already holds is drawn as the chat's message alone, whether its answer has landed or not.
  const held = new Set(chat.messages.flatMap((message) => message.clientKey ?? []));
  const shown = pending.filter((each) => !held.has(each.id));
  return { pending: shown, send, onRetryPost, onDiscardPost };
}

/** A post of the reader's the chat does not hold yet, drawn as their message is, quiet while it goes, and marked with why and Retry where it was refused. */
function PendingRow({
  entry,
  context,
  reply = false,
}: {
  entry: PendingPost;
  context: MessageContext;
  /** Whether it stands in a thread, as a reply is drawn. */
  reply?: boolean;
}): React.JSX.Element {
  const actor = context.actorOf(context.chat.self);
  const { text, attachments } = entry.post;
  return (
    <li
      className={reply ? "chat-reply" : "chat-message"}
      data-pending={entry.refused === undefined ? "" : undefined}
      data-unsent={entry.refused === undefined ? undefined : ""}
    >
      <Face actor={actor} at={entry.at} now={context.now} />
      <div className="chat-message-body">
        <Byline actor={actor} at={entry.at} where={undefined} now={context.now} />
        <AttachedFileChips files={attachmentChips(attachments ?? [])} />
        {text === undefined ? null : (
          <div className="chat-words">
            <SentWords text={text} asDocument />
          </div>
        )}
        {entry.refused === undefined ? null : (
          <p className="agent-undelivered chat-unsent" role="alert">
            <CircleAlertIcon aria-hidden="true" />
            {entry.refused}
            <TextButton
              tone={TEXT_BUTTON_TONE.ACCENT}
              onClick={() => context.onRetryPost(entry.id)}
            >
              {RETRY_POST}
            </TextButton>
            <TextButton
              tone={TEXT_BUTTON_TONE.QUIET}
              onClick={() => context.onDiscardPost(entry.id)}
            >
              {DISCARD_POST}
            </TextButton>
          </p>
        )}
      </div>
    </li>
  );
}

/** Whether a person wrote the message, whose words are drawn as typed and whose pictures lead them. */
function byPerson(message: ChatMessage, chat: ChatAnswer): boolean {
  const author = chat.members.find((member) => member.id === message.authorId);
  return author?.kind === MEMBER_KIND.HUMAN;
}

/**
 * A message's blocks in the order they are drawn, each with its place in
 * the message: a person's pictures first, over their words, as the box held
 * them and as every message's files stand; an agent's and Luke's in the
 * order they wrote them, since a picture of theirs may stand between words
 * that speak of it.
 */
function drawnBlocks(
  message: ChatMessage,
  chat: ChatAnswer,
): readonly { readonly block: ChatReadBlock; readonly index: number }[] {
  const placed = message.blocks.map((block, index) => ({ block, index }));
  if (!byPerson(message, chat)) return placed;
  const picture = (block: ChatReadBlock) => knownBlock(block) && block.type === CHAT_BLOCK.IMAGE;
  return [
    ...placed.filter(({ block }) => picture(block)),
    ...placed.filter(({ block }) => !picture(block)),
  ];
}

/**
 * Hands what is drawn under it the doors of the task whose channel it is:
 * the code doors a link to lines alone on its line reads through, and the
 * task's mentions and skills where the page drawing them does not hand them.
 */
function TaskDoorsScope({
  doors,
  children,
}: {
  doors: ChatTaskDoors | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  if (doors === undefined) return <>{children}</>;
  const { mentions, skills } = doors;
  const cards = <LoneLinkCards doors={doors}>{children}</LoneLinkCards>;
  const named =
    skills === undefined ? (
      cards
    ) : (
      <SkillFiles source={skills.source} onOpen={skills.onOpen}>
        {cards}
      </SkillFiles>
    );
  if (mentions === undefined) return named;
  return <TaskMentions value={mentions}>{named}</TaskMentions>;
}

/** A message's body: its ask's card where it carries one, its blocks inside, else its blocks in turn. */
function Body({
  message,
  context,
}: {
  message: ChatMessage;
  context: MessageContext;
}): React.JSX.Element {
  const typed = byPerson(message, context.chat);
  const code = context.doorsIn(message.channelId)?.code;
  const blocks = drawnBlocks(message, context.chat).map(({ block, index }) => (
    // Blocks have no key of their own, so each keeps its place in the message as its key.
    <Block
      key={index}
      messageId={message.id}
      block={block}
      typed={typed}
      code={code}
      context={context}
    />
  ));
  const { ask } = message;
  if (ask === undefined) return <>{blocks}</>;
  const home = context.chat.channels.find((channel) => channel.id === message.channelId);
  return (
    <AskCard
      message={message}
      ask={ask}
      chat={context.chat}
      answers={home === undefined || postsIn(context.chat, home)}
      blocks={blocks}
      actorOf={context.actorOf}
      keywords={context.keywords}
      now={context.now}
      onAnswer={context.onAnswer}
    />
  );
}

/** The line over a message's words, as Slack's is: its author by name in bold, their card on it, where it was said, and how long ago, the full moment on hover, as every row and thread in the window says it. */
function Byline({
  actor,
  at,
  where,
  now,
  action,
  continued = false,
}: {
  actor: Actor;
  at: number;
  /** Where it was said, as For you names a message's channel; none in the channel itself. */
  where: React.ReactNode;
  now: number;
  /** The presses at the line's end, shown while the message is hovered or one has the keyboard. */
  action?: React.ReactNode;
  /** Whether the message continues its author's run, so the line names no one and holds its press alone. */
  continued?: boolean;
}): React.JSX.Element {
  if (continued) {
    // The author stays named for a screen reader, which may land on this message alone.
    return (
      <div className="chat-byline" data-continued="true">
        <span className="visually-hidden">{actorName(actor)}</span>
        {action}
      </div>
    );
  }
  return (
    <div className="chat-byline">
      <span className="chat-byline-name">
        {actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
          <SendingAgent actor={actor} agentId={actor.agentId} nameOnly />
        ) : (
          <ActorRef actor={actor} nameOnly />
        )}
      </span>
      {where === undefined ? null : (
        <FadingWords className="chat-byline-where">{where}</FadingWords>
      )}
      <RelativeTime className="chat-time" at={at} now={now} />
      {action}
    </div>
  );
}

/**
 * The face a message leads with, in a column of its own at a card's size: the
 * person's photo or initial, as a circle, or the agent's own mark, as a rounded square. A message continuing its
 * author's run leads with its time instead, shown while it is hovered, as
 * Slack's grouped messages do.
 */
function Face({
  actor,
  continued = false,
  at,
  now,
}: {
  actor: Actor;
  continued?: boolean;
  at: number;
  now: number;
}): React.JSX.Element {
  if (continued) {
    return (
      <span className="chat-face" data-continued="true">
        <RelativeTime className="chat-time" at={at} now={now} />
      </span>
    );
  }
  return (
    <span className="chat-face">
      <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />
    </span>
  );
}

/**
 * The presses at a message's byline's end: Copy of its words as Markdown,
 * the one every transcript's message offers (`copy-message.tsx`), where it
 * has any, and the press the caller adds. Note that it offers no Copy
 * link, since no Luke link names one message of the chat.
 */
function RowActions({
  message,
  extra,
}: {
  message: ChatMessage;
  extra?: React.ReactNode;
}): React.JSX.Element | undefined {
  const words = messageMarkdown(message);
  if (words === "" && extra === undefined) return undefined;
  return (
    <span className="chat-byline-action">
      {words === "" ? null : (
        <CopyMessageAction words={words} placement={MESSAGE_ACTIONS_PLACEMENT.INLINE} />
      )}
      {extra}
    </span>
  );
}

/** One message of a thread: its face, its byline with its Copy, and its body. */
function Reply({ message, context }: { message: ChatMessage; context: MessageContext }) {
  const actor = context.actorOf(message.authorId);
  return (
    <li className="chat-reply" data-seq={message.seq}>
      <Face actor={actor} at={message.postedAt} now={context.now} />
      <div className="chat-message-body">
        <Byline
          actor={actor}
          at={message.postedAt}
          where={undefined}
          now={context.now}
          action={<RowActions message={message} />}
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
  continued = false,
}: {
  thread: ChatThread;
  where: React.ReactNode;
  context: MessageContext;
  /** Whether the root continues its author's run, drawn under the name the run began with (`continuesRun`). */
  continued?: boolean;
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
      {threadToggleWords(open, replies.length)}
    </TextButton>
  );
  // The reader's replies on their way stand after the thread's, while the thread is open.
  const pendingReplies = context.pending.filter(
    (each) => each.channelId === message.channelId && each.replyTo === message.seq,
  );
  // A message nobody has replied to offers Reply at its byline's end beside its Copy, out of the way until wanted.
  const quiet = replies.length === 0 && !open;
  return (
    <li className="chat-message" data-seq={message.seq} data-continued={String(continued)}>
      <Face actor={actor} continued={continued} at={message.postedAt} now={context.now} />
      <div className="chat-message-body">
        <Byline
          actor={actor}
          at={message.postedAt}
          where={where}
          now={context.now}
          continued={continued}
          action={<RowActions message={message} extra={quiet && canReply ? toggle : undefined} />}
        />
        <Body message={message} context={context} />
        {quiet ? null : (
          <div className="chat-thread" data-open={String(open)}>
            <div className="chat-thread-toggle">
              {/* Note that the faces stand beside the press rather than in it, since each hangs its replier's card. */}
              {replies.length > 0 && !open ? (
                <ActorStack
                  actors={repliers}
                  drawn={REPLIERS_DRAWN}
                  faces={repliers.map(() => ({}))}
                  label={REPLIERS_LABEL}
                />
              ) : null}
              {toggle}
            </div>
            {open && replies.length + pendingReplies.length > 0 ? (
              <ul className="chat-replies">
                {replies.map((reply) => (
                  <Reply key={reply.id} message={reply} context={context} />
                ))}
                {pendingReplies.map((entry) => (
                  <PendingRow key={entry.id} entry={entry} context={context} reply />
                ))}
              </ul>
            ) : null}
            {open && canReply ? (
              <ChatComposer
                channelId={message.channelId}
                replyTo={message.seq}
                label="Reply in thread"
                mentions={context.mentionsIn(message.channelId, [
                  message.authorId,
                  ...replies.map((reply) => reply.authorId),
                ])}
                keywords={context.keywords}
                compact
                onSend={(text, attachments, takeBack) =>
                  context.send(
                    { channelId: message.channelId, replyTo: message.seq },
                    { ...postOf(text, attachments), replyTo: message.seq },
                    takeBack,
                  )
                }
              />
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/** What the line before a channel's first unread message says. */
const UNREAD_LINE = "New";

/**
 * A channel's messages as a log, as every conversation in the window is
 * (`../ai-elements/conversation.tsx`): it opens at its newest message,
 * follows each new one while the reader is there, and floats the way back
 * once they scroll up. A channel opened with messages someone else posted
 * since the reader last read it draws a "New" line before the first of
 * them, taken as it opened and held while it stays open, since the read
 * the window then tells moves the cursor past them. Where the unread run
 * is taller than the box, it opens with that line at its top instead,
 * scrolled from the newest message there before the paint, and told so the
 * log lets go of its newest line.
 */
function ChannelStream({
  channelId,
  threads,
  context,
}: {
  channelId: string;
  threads: readonly ChatThread[];
  context: MessageContext;
}): React.JSX.Element {
  // The first unread message as the channel opened, taken again as another opens in its place.
  const [opened, setOpened] = useState(() => ({
    channelId,
    unreadFrom: firstUnreadSeq(context.chat, channelId),
  }));
  if (opened.channelId !== channelId) {
    setOpened({ channelId, unreadFrom: firstUnreadSeq(context.chat, channelId) });
  }
  const unreadFrom = opened.channelId === channelId ? opened.unreadFrom : undefined;
  const list = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLLIElement>(null);
  // Note that this runs after the log has taken itself to the channel's newest message, since a parent's layout effect follows its children's.
  useLayoutEffect(() => {
    if (opened.unreadFrom === undefined) return;
    const box = list.current;
    const at = line.current;
    if (box === null || at === null) return;
    const room = Number.parseFloat(window.getComputedStyle(at).scrollMarginTop) || 0;
    const above = at.getBoundingClientRect().top - box.getBoundingClientRect().top - room;
    if (above >= 0) return;
    box.scrollTop += above;
    box.dispatchEvent(new Event("scroll"));
  }, [opened]);
  return (
    <Conversation subject={channelId} list={list}>
      <ConversationContent className="chat-stream-body">
        <ol className="chat-messages">
          {threads.map((thread, index) => {
            const first = thread.message.seq === unreadFrom;
            return (
              <Fragment key={thread.message.id}>
                {first ? (
                  <li ref={line} className="chat-unread-line">
                    {UNREAD_LINE}
                  </li>
                ) : null}
                <ThreadRow
                  thread={thread}
                  where={undefined}
                  context={context}
                  continued={!first && continuesRun(threads[index - 1], thread)}
                />
              </Fragment>
            );
          })}
          {context.pending
            .filter((each) => each.channelId === channelId && each.replyTo === undefined)
            .map((entry) => (
              <PendingRow key={entry.id} entry={entry} context={context} />
            ))}
        </ol>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/** A post's words and pictures as it carries them: each where there is any, since a post may be pictures alone. */
function postOf(text: string, attachments: readonly CodingAgentAttachment[]): ChatPost {
  return {
    ...(text === "" ? undefined : { text }),
    ...(attachments.length === 0 ? undefined : { attachments }),
  };
}

/** Where For you says a message was posted: in its channel, or a direct message, pressed to open it there. */
function ForYouWhere({
  entry,
  context,
}: {
  entry: ForYouEntry;
  context: MessageContext;
}): React.JSX.Element {
  const { channel } = entry;
  const { onOpen } = context;
  // Note that the channel decides, not the reason, since an ask in a direct message is listed as an ask.
  const direct = channel.kind === CHANNEL_KIND.DM;
  const name = direct ? (
    DIRECT_MESSAGE
  ) : (
    <ChannelName chat={context.chat} names={context.names} channel={channel} />
  );
  return (
    <>
      {direct ? null : "in "}
      {onOpen === undefined ? (
        name
      ) : (
        <TextButton
          tone={TEXT_BUTTON_TONE.LINK}
          onClick={() => onOpen({ kind: CHAT_PLACE.CHANNEL, channelId: channel.id })}
        >
          {name}
        </TextButton>
      )}
    </>
  );
}

/** The head over a place, a page's toolbar: the way back where it stands alone, its name as the toolbar's title, what it says beside that, and its menu. */
function PlaceHead({
  title,
  name,
  meta,
  lead,
  actions,
}: {
  /** The place's name in words, which the title is measured by. */
  title: string;
  /** The place's name as drawn, a task's glyph before it. */
  name: React.ReactNode;
  meta: string | undefined;
  lead: React.ReactNode;
  /** The place's own presses at the head's end, a channel's menu. */
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="desktop-toolbar chat-head">
      {lead}
      <div className="desktop-toolbar-heading">
        <FadingWords as={FADING_ELEMENT.H1} className="desktop-toolbar-title" words={title}>
          {name}
        </FadingWords>
        {meta === undefined ? null : (
          <span className="chat-head-meta">
            <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED} truncate>
              {meta}
            </Text>
          </span>
        )}
      </div>
      {actions === undefined ? null : <div className="desktop-toolbar-actions">{actions}</div>}
    </header>
  );
}

/** What a channel's head says beside its name: a topic's purpose, a DM's other member's agent or plan; nothing of a task's, whose name is its title. */
function channelMeta(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string | undefined {
  switch (channel.kind) {
    case CHANNEL_KIND.GENERAL:
      return CHANNEL_META[channel.kind];
    case CHANNEL_KIND.TOPIC:
      return channel.purpose ?? CHANNEL_META[channel.kind];
    case CHANNEL_KIND.TASK:
      return undefined;
    case CHANNEL_KIND.DM: {
      const other = channel.members?.find((id) => id !== chat.self);
      if (other === undefined) return undefined;
      const who = chatWho(chat, names, other);
      return who.agent?.title ?? who.taskName ?? undefined;
    }
  }
}

/** A direct message's two, each by name, as its foot names them where the reader is neither. */
function dmPair(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  return (channel.members ?? []).map((id) => chatWho(chat, names, id).name).join(" and ");
}

/** What a channel's composer is called: "Message" and the channel's `#name`, or who a DM is with. */
function composerLabel(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  const label = channelLabel(chat, names, channel);
  return channel.kind === CHANNEL_KIND.DM ? `Message ${label}` : `Message #${label}`;
}

/** The pane: the place's head, then its messages, or a line saying there are none, and a channel's composer. */
export function ChatPane({
  chat,
  names,
  place,
  mentionPlace,
  tasks = NO_TASKS,
  now,
  openLink,
  onPost,
  onAnswer,
  readPicture,
  lead,
  channelActions,
  onOpen,
  onBringBack,
  hidden,
  taskDoors,
}: {
  chat: ChatAnswer;
  names: ChatNames;
  place: ChatPlace;
  /** The workspace a chip's link is written in; none where it is not known yet, when the composer offers no member to name. */
  mentionPlace?: MentionPlace | undefined;
  /** The tasks the window lists, whose channels' composers offer them. */
  tasks?: readonly TaskSummary[];
  now: number;
  openLink: (url: string) => void;
  /** Posts a message under the key the pane minted for it; answers why it was refused, or nothing once it is taken. */
  onPost: (post: ChatPost, clientKey: string) => Promise<string | undefined>;
  /** Answers an ask; answers why it was refused, or nothing once it is taken. */
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer>;
  /** What leads the place's head: the way back to the rail, where the place stands alone. */
  lead?: React.ReactNode;
  /** The presses a channel's head ends on, its menu; none where the channel offers none. */
  channelActions?: ((channel: ChatChannel) => React.ReactNode) | undefined;
  /** Shows a place of the chat, as For you's row opens its channel; none where no other place is shown here. */
  onOpen?: ((place: ChatPlace) => void) | undefined;
  /** Asks to bring an archived topic back, from its foot; none where it is not offered. */
  onBringBack?: ((channel: ChatChannel) => void) | undefined;
  /** Whether the pane is hidden, as a narrow room hides it behind the rail. */
  hidden?: boolean;
  /** The doors of a task, by its id, that its channel's messages read their code and open their files through; none where the task is not at hand. */
  taskDoors?: ((taskId: string) => ChatTaskDoors | undefined) | undefined;
}): React.JSX.Element {
  const keywords = chatKeywords(chat, names);
  const actorOf = useChatActor(chat, names);
  // A composer offers only the members a post in its own channel reaches, as the service holds the chat to its tasks.
  const mentionsIn = useChatMentions({ chat, names, place: mentionPlace, tasks, actorOf });
  const doorsIn = (channelId: string) => {
    const home = chat.channels.find((each) => each.id === channelId);
    if (home?.kind !== CHANNEL_KIND.TASK || home.planId === undefined) return undefined;
    return taskDoors?.(home.planId);
  };
  const posting = usePendingPosts(chat, onPost);
  const context: MessageContext = {
    actorOf,
    chat,
    names,
    now,
    mentionsIn,
    keywords,
    openLink,
    send: posting.send,
    pending: posting.pending,
    onRetryPost: posting.onRetryPost,
    onDiscardPost: posting.onDiscardPost,
    onAnswer,
    readPicture,
    doorsIn,
    onOpen,
  };
  const channel = placeChannel(chat, place);
  if (place.kind === CHAT_PLACE.FOR_YOU || channel === undefined) {
    const entries = forYou(chat);
    return (
      <section className="chat-stream ph-no-capture" aria-label="For you" hidden={hidden}>
        <PlaceHead title={FOR_YOU_TITLE} name={FOR_YOU_TITLE} meta={undefined} lead={lead} />
        {entries.length === 0 ? (
          <EmptyState icon={<AtSignIcon />}>{NEEDS_YOU.NONE}</EmptyState>
        ) : (
          <Conversation>
            <ConversationContent className="chat-stream-body">
              <ol className="chat-messages">
                {entries.map((entry) => (
                  // Each row is of its own channel, so each reads through its own task.
                  <TaskDoorsScope key={entry.message.id} doors={doorsIn(entry.channel.id)}>
                    <ThreadRow
                      thread={entry}
                      where={<ForYouWhere entry={entry} context={context} />}
                      context={context}
                    />
                  </TaskDoorsScope>
                ))}
              </ol>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </section>
    );
  }
  const threads = channelThreads(chat, channel.id);
  const title = channelTitle(chat, names, channel);
  const doors = doorsIn(channel.id);
  return (
    <section className="chat-stream ph-no-capture" aria-label={title} hidden={hidden}>
      <PlaceHead
        title={title}
        name={<ChannelName chat={chat} names={names} channel={channel} />}
        meta={channelMeta(chat, names, channel)}
        lead={lead}
        actions={channelActions?.(channel)}
      />
      {threads.length === 0 && !posting.pending.some((each) => each.channelId === channel.id) ? (
        <EmptyState icon={channel.kind === CHANNEL_KIND.DM ? <AtSignIcon /> : <HashIcon />}>
          {NOTHING_POSTED}
        </EmptyState>
      ) : (
        <TaskDoorsScope doors={doors}>
          <ChannelStream channelId={channel.id} threads={threads} context={context} />
        </TaskDoorsScope>
      )}
      {/* Note that the composer is keyed by its channel, so words typed for one are never sent to another, and each channel's draft waits under its own. */}
      {postsIn(chat, channel) ? (
        <ChatComposer
          key={channel.id}
          channelId={channel.id}
          label={composerLabel(chat, names, channel)}
          mentions={mentionsIn(channel.id)}
          keywords={keywords}
          onSend={(text, attachments, takeBack) =>
            posting.send(
              { channelId: channel.id },
              { ...postOf(text, attachments), channelId: channel.id },
              takeBack,
            )
          }
        />
      ) : channel.archived && channel.kind === CHANNEL_KIND.TOPIC && onBringBack !== undefined ? (
        <ArchivedComposerNote
          words={ARCHIVED_CHANNEL}
          action={BRING_BACK_CHANNEL}
          onUnarchive={() => onBringBack(channel)}
        />
      ) : (
        // Note that a task's channel comes back with its task, and a DM between two others is only read, so neither offers a press.
        <div className="chat-closed-foot">
          <Text tone={TEXT_TONE.MUTED}>
            {channel.archived ? ARCHIVED_CHANNEL : OTHERS_DM(dmPair(chat, names, channel))}
          </Text>
        </div>
      )}
    </section>
  );
}
