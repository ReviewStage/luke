import { useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
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
import { andList } from "@luke/features/words";
import {
  CONFIRM_LOSS,
  Comment,
  ConfirmDialog,
  type DialogQuestion,
  EmptyState,
  FailureNote,
  OneLine,
  PaneBar,
  STREAM_DIVIDER,
  STREAM_DIVIDER_ELEMENT,
  StreamDivider,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  Text,
  TextButton,
  Time,
  TOOLBAR_INSET,
  Toolbar,
  useConfirmDialog,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import { ACTOR_KIND, type Actor, actorName, distinctActors } from "@luke/ui/actor-model";
import {
  CHAT_PLACE,
  type ChatAskAnswer,
  type ChatNames,
  type ChatPlace,
  type ChatPost,
  type ChatRoster,
  type ChatThread,
  channelLabel,
  channelThreads,
  chatKeywords,
  chatWho,
  continuesRun,
  firstUnreadSeq,
  forYou,
  messageMarkdown,
  placeChannel,
  postsIn,
} from "@luke/ui/chat-model";
import { PICTURE_STATE, type PictureAnswer, usePicture } from "@luke/ui/picture-cache";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { AtSignIcon, HashIcon } from "lucide-react";
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { actFailureWords } from "../act.js";
import { ActorRef, ActorStack, commentAuthor } from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { PhoneHead } from "../desktop/phone-head.js";
import { HandTabActionsContext } from "../desktop/strip-tabs.js";
import { PictureBlock } from "../picture-block.js";
import { usePhoneRoom } from "../stage-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { SendingAgent } from "./agent-ref.js";
import { ArchivedComposerNote } from "./archived-note.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { AttachmentViewer } from "./attachment-viewer.js";
import { useChatActor } from "./chat-actors.js";
import { AskCard } from "./chat-ask.js";
import { ChannelGlyph, ChannelName, channelTitle } from "./chat-channel-name.js";
import { ChatComposer, type ChatComposerMentions } from "./chat-composer.js";
import { useChatMentions } from "./chat-mention-source.js";
import {
  type ChatReplyDoors,
  ChatReplyDoorsContext,
  replyInto,
  useChatReplyDoor,
} from "./chat-reply-doors.js";
import { CopyMessageAction } from "./copy-message.js";
import { FileRef } from "./file-ref.js";
import { InboxCodeCard, type InboxCodeDoors } from "./inbox-code-card.js";
import { NEEDS_YOU } from "./inbox-model.js";
import { LinkBlock } from "./inbox-pane.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { REPLY_SCOPE, ReplyToSelection } from "./reply-to-selection.js";
import { SentWords, SkillFiles } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import type { SkillWithFile } from "./skill-ref.js";
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
 * Words selected in a message, or in an ask's card, stand Reply over them,
 * as an agent's words do in its tab (`reply-to-selection.tsx`), which
 * quotes them into the box that answers them (`chat-reply-doors.ts`): an
 * open ask's answer, the thread's box where it is open, else the channel's
 * at its foot; For you, which has no box of its own, opens the thread.
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
 *
 * A row is drawn again only for what it draws: its message, its replies, or
 * the roster and the doors every row shares (`RowDoors`), which stand across
 * a push that only brings a message, so a new message draws its own row and
 * the pane around it, and no other. A row's time counts the minute itself
 * (`Time`), and an ask's card, which reads the chat whole, alone
 * reads it as it moves (`ChatReadContext`).
 */

/**
 * A place's stream: its head, its messages at the reading measure, and its
 * box; the head's purpose (`PaneBar`'s detail) gives way before the name does.
 */
export const CHAT_STREAM =
  "chat-stream flex min-h-0 min-w-0 flex-col [&>.luke-pane-bar_.luke-pane-bar-detail]:flex [&>.luke-pane-bar_.luke-pane-bar-detail]:min-w-0 [&>.luke-pane-bar_.luke-pane-bar-detail]:flex-[0_1000_auto]";

/**
 * A message or a reply, laid out as Slack's is: its author's face in a
 * column of its own at a card's 32px, then its byline and its words, a
 * message continuing its author's run right under the one before, the row
 * lighting up while hovered; a post on its way, or one refused, reads
 * quieter; one that names its author is a comment spanning the row.
 */
const CHAT_ROW =
  "relative -mx-row-inset grid grid-cols-chat-message gap-x-control-gap rounded-menu-row px-row-inset py-item-gap transition-[background-color] duration-(--luke-duration-hover) ease-motion-exit hover:bg-muted data-[continued=true]:py-luke-2 [&[data-pending]>.chat-message-body>.chat-words]:opacity-60 [&[data-unsent]>.chat-message-body>.chat-words]:opacity-60 [&>.luke-comment]:col-span-full";

/** A message's body: its byline, its words, and what it carries, a hair apart. */
const CHAT_MESSAGE_BODY = "chat-message-body flex min-w-0 flex-col gap-list-gap";

/** A message's words, at the reading leading. */
const CHAT_WORDS = "chat-words text-body-size leading-reading text-foreground";

/**
 * The presses at a byline's end, shown while their row is hovered or holds
 * the focus, and always on a screen with no hover; a root's own presses are
 * reached by children alone, so hovering a reply in its open thread shows
 * that reply's and not the root's. Their Copy stands with their Reply
 * rather than waiting on a transcript's hover of its own.
 */
const CHAT_BYLINE_ACTION =
  "chat-byline-action ml-auto flex items-center gap-tight-gap opacity-0 transition-opacity duration-(--luke-duration-quick) ease-spring focus-within:opacity-100 [&>.luke-message-actions]:pointer-events-auto [&>.luke-message-actions]:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:hover)]:[:is(.chat-message,.chat-reply):hover>.chat-message-body>.chat-byline>&]:opacity-100 [@media(hover:hover)]:[:is(.chat-message,.chat-reply):hover>.luke-comment>.luke-comment-head>.luke-comment-trailing>&]:opacity-100";

/** The tasks of a window that lists none. */
const NO_TASKS: readonly TaskSummary[] = [];

/** What a channel says before anything is posted in it. */
const NOTHING_POSTED = "Nothing posted here yet.";

/** What a channel no box is offered in says at its foot: an archived one, or a direct message between two others; and the press that unarchives a topic. */
const ARCHIVED_CHANNEL = "This channel is archived";
const UNARCHIVE_CHANNEL = "Unarchive channel";
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
  const extension = `.${mediaType.slice(mediaType.indexOf("/") + 1)}`;
  const name = block.alt.replace(UNSAVEABLE, "-");
  return { name: name.endsWith(extension) ? name : `${name}${extension}`, mediaType, url };
}

/**
 * A picture a message carries: its own block at its own size up to the
 * column's, a quiet box while its bytes are read, its words where it is
 * gone, and pressed to open it larger over the window; a recording an agent
 * posted is drawn as its still, and the viewer plays it.
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
  if (!knownBlock(block)) return <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE}</Text>;
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      // Note that every message is drawn as a document, as an Inbox item's words are, so a link alone on its line is its card; whoever wrote it, a selection inside may be replied to.
      return (
        <div className={CHAT_WORDS} {...{ [REPLY_SCOPE]: "" }}>
          {typed ? (
            <SentWords text={block.text} asDocument />
          ) : (
            <TranscriptWords text={block.text} asDocument />
          )}
        </div>
      );
    case CHAT_BLOCK.LINK:
      return (
        <Text as={TEXT_ELEMENT.DIV}>
          <LinkBlock url={block.url} label={block.label} />
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
    | { readonly source: SkillSource; readonly onOpen: (skill: SkillWithFile) => void }
    | undefined;
}

/**
 * What every row of a place is drawn with: the roster and the names, what
 * the composer offers, and the doors a link, a post, and an answer go
 * through. Note that none of it reads a message, so it stands across a push
 * that only brings one, and a row holds (`memo`) unless its own message or
 * replies moved.
 */
interface MessageContext {
  readonly roster: ChatRoster;
  readonly names: ChatNames;
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
  /** The reader's member who sent it, which names the account and the workspace at once, so only that reader's chat draws it. */
  readonly self: string;
  /** The key the post goes under, which the chat hands back on the message once it holds it (`ChatMessage.clientKey`), so the message stands in the post's place whichever lands first. */
  readonly id: string;
  readonly post: ChatPost;
  /** When it was sent, which its byline says. */
  readonly at: number;
  /** Why it was refused, where it was and its words stayed on it rather than in the box. */
  readonly refused?: string;
}

const DISCARD_POST = "Discard";

/** What Discard asks before a refused post is let go. */
const DISCARD_QUESTION: DialogQuestion = {
  title: "Discard this post?",
  body: "Its words and pictures are kept nowhere else.",
  verb: "Discard",
  running: "Discarding",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

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
function postWords(
  entry: PendingPlace & { readonly self: string; readonly post: ChatPost },
): string {
  return JSON.stringify([entry.self, entry.channelId, entry.replyTo ?? null, entry.post]);
}

/**
 * Each window's posts still on their way or refused, kept past the pane, so
 * a refused post with its pictures waits where it went while Chat is closed
 * and opened again. Note that each window's registry holds its own.
 */
const pendingPostsAtom = Atom.keepAlive(Atom.make<readonly PendingPost[]>([]));

/** What a window's posts go out through, kept past the pane as its posts are: the queue they go in, and the key of each post taken back into its box, by its place and words. */
interface Outbox {
  queue: Promise<void>;
  readonly refusedKeys: Map<string, string>;
  /** How each post is sent, by its key, as the pane handed it when the post was sent, so it goes to the account and workspace it was written in whatever the window reads by then. */
  readonly senders: Map<string, (post: ChatPost, clientKey: string) => Promise<string | undefined>>;
}

const outboxes = new WeakMap<AtomRegistry.AtomRegistry, Outbox>();

function usePendingPosts(
  chat: ChatAnswer,
  onPost: (post: ChatPost, clientKey: string) => Promise<string | undefined>,
) {
  const registry = useContext(RegistryContext);
  const pending = useAtomValue(pendingPostsAtom);
  const outbox: Outbox = outboxes.get(registry) ?? {
    queue: Promise.resolve(),
    refusedKeys: new Map(),
    senders: new Map(),
  };
  outboxes.set(registry, outbox);
  const change = (next: (was: readonly PendingPost[]) => readonly PendingPost[]) =>
    registry.set(pendingPostsAtom, next(registry.get(pendingPostsAtom)));
  const go = (entry: PendingPost, takeBack: (refused: string) => boolean) => {
    outbox.queue = outbox.queue.then(async () => {
      const sender = outbox.senders.get(entry.id) ?? onPost;
      const refused = await sender(entry.post, entry.id).catch(actFailureWords);
      const back = refused !== undefined && takeBack(refused);
      if (back) outbox.refusedKeys.set(postWords(entry), entry.id);
      if (refused === undefined || back) outbox.senders.delete(entry.id);
      change((was) =>
        refused === undefined || back
          ? was.filter((each) => each.id !== entry.id)
          : was.map((each) => (each.id === entry.id ? { ...each, refused } : each)),
      );
    });
  };
  const sendNow = (place: PendingPlace, post: ChatPost, takeBack: (refused: string) => boolean) => {
    const words = postWords({ ...place, self: chat.self, post });
    const id = outbox.refusedKeys.get(words) ?? crypto.randomUUID();
    outbox.refusedKeys.delete(words);
    const entry: PendingPost = { ...place, self: chat.self, id, post, at: Date.now() };
    outbox.senders.set(id, onPost);
    change((was) => [...was, entry]);
    go(entry, takeBack);
  };
  const retryNow = (id: string) => {
    const entry = registry.get(pendingPostsAtom).find((each) => each.id === id);
    if (entry?.refused === undefined) return;
    const { refused: _refused, ...again } = entry;
    change((was) => was.map((each) => (each.id === id ? again : each)));
    go(again, () => false);
  };
  const discardNow = (id: string) => {
    outbox.senders.delete(id);
    change((was) => was.filter((each) => each.id !== id));
  };
  // Note that the doors stand across draws, so every row handed them holds while posts come and go.
  const send = useSteadyDoor(sendNow);
  const onRetryPost = useSteadyDoor(retryNow);
  const onDiscardPost = useSteadyDoor(discardNow);
  const { self, messages } = chat;
  const lastShown = useRef<readonly PendingPost[]>(NO_PENDING);
  const shown = useMemo(() => {
    // Note that a post the chat already holds is drawn as the chat's message alone, whether its answer has landed or not.
    const held = new Set(messages.flatMap((message) => message.clientKey ?? []));
    // Note that only the reader's own posts in this workspace are drawn, so another account signed in to the window reads none.
    const next = pending.filter((each) => each.self === self && !held.has(each.id));
    const before = lastShown.current;
    const same = next.length === before.length && next.every((each, at) => each === before[at]);
    if (!same) lastShown.current = next.length === 0 ? NO_PENDING : next;
    return lastShown.current;
  }, [pending, messages, self]);
  return { pending: shown, send, onRetryPost, onDiscardPost };
}

/** No post on its way. */
const NO_PENDING: readonly PendingPost[] = [];

/** Where a pending post stands: under a thread's root by its place, or at its channel's foot. */
function pendingKey(channelId: string, replyTo: number | undefined): string {
  return `${channelId}:${replyTo ?? ""}`;
}

/** The posts on their way by where each stands, so a row is handed its own alone and holds while others come and go. */
function pendingByPlace(
  pending: readonly PendingPost[],
): ReadonlyMap<string, readonly PendingPost[]> {
  const byPlace = new Map<string, PendingPost[]>();
  for (const entry of pending) {
    const key = pendingKey(entry.channelId, entry.replyTo);
    const list = byPlace.get(key);
    if (list === undefined) byPlace.set(key, [entry]);
    else list.push(entry);
  }
  return byPlace;
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
  const actor = context.actorOf(context.roster.self);
  const { text, attachments } = entry.post;
  // Note that Discard asks first, since the post's words and pictures are kept nowhere else.
  const discard = useConfirmDialog(
    { subject: entry.refused !== undefined, surfaceOpen: true },
    () => {
      context.onDiscardPost(entry.id);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  return (
    <li
      className={reply ? `chat-reply ${CHAT_ROW}` : `chat-message ${CHAT_ROW}`}
      data-pending={entry.refused === undefined ? "" : undefined}
      data-unsent={entry.refused === undefined ? undefined : ""}
    >
      <MessageComment actor={actor} at={entry.at}>
        <div className={CHAT_MESSAGE_BODY}>
          <AttachedFileChips files={attachmentChips(attachments ?? [])} />
          {text === undefined ? null : (
            <div className={CHAT_WORDS}>
              <SentWords text={text} asDocument />
            </div>
          )}
          {entry.refused === undefined ? null : (
            <FailureNote
              onRetry={() => context.onRetryPost(entry.id)}
              also={
                <TextButton tone={TEXT_BUTTON_TONE.QUIET} onClick={discard.ask}>
                  {DISCARD_POST}
                </TextButton>
              }
            >
              {entry.refused}
            </FailureNote>
          )}
          <ConfirmDialog open confirm={discard} question={DISCARD_QUESTION} />
        </div>
      </MessageComment>
    </li>
  );
}

/** The chat whole, as last read, for what reads it as it moves: an ask's card, which counts its replies. */
const ChatReadContext = createContext<ChatAnswer | undefined>(undefined);

/** Whether a person wrote the message, whose words are drawn as typed and whose pictures lead them. */
function byPerson(message: ChatMessage, context: MessageContext): boolean {
  return (
    chatWho(context.roster, context.names, message.authorId).member?.kind === MEMBER_KIND.HUMAN
  );
}

/** Whether the reader may post in the channel a message stands in: one the roster no longer holds is taken as one they may. */
function postsWhere(message: ChatMessage, roster: ChatRoster): boolean {
  const home = placeChannel(roster, { kind: CHAT_PLACE.CHANNEL, channelId: message.channelId });
  return home === undefined || postsIn(roster, home);
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
  typed: boolean,
): readonly { readonly block: ChatReadBlock; readonly index: number }[] {
  const placed = message.blocks.map((block, index) => ({ block, index }));
  if (!typed) return placed;
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
  const typed = byPerson(message, context);
  const code = context.doorsIn(message.channelId)?.code;
  const blocks = drawnBlocks(message, typed).map(({ block, index }) => (
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
  return <AskBody message={message} ask={ask} blocks={blocks} context={context} />;
}

/** A message's ask, as its card draws it, read against the chat as it moves and the minute. */
function AskBody({
  message,
  ask,
  blocks,
  context,
}: {
  message: ChatMessage;
  ask: NonNullable<ChatMessage["ask"]>;
  blocks: React.ReactNode;
  context: MessageContext;
}): React.JSX.Element | null {
  const chat = useContext(ChatReadContext);
  const now = useMinute();
  if (chat === undefined) return null;
  return (
    <AskCard
      message={message}
      ask={ask}
      chat={chat}
      answers={postsWhere(message, context.roster)}
      blocks={blocks}
      actorOf={context.actorOf}
      mentions={context.mentionsIn(message.channelId)}
      keywords={context.keywords}
      now={now}
      onAnswer={context.onAnswer}
    />
  );
}

/**
 * A message the chat draws as a comment (`Comment`): its author's face, their name hanging their card, how long ago, the full moment on hover, as every row and thread in the window says it, and where it was said and the presses at the line's end, shown while the message is hovered or one has the keyboard; then its words.
 */
function MessageComment({
  actor,
  at,
  where,
  action,
  children,
}: {
  actor: Actor;
  at: number;
  /** Where it was said, as For you names a message's channel; none in the channel itself. */
  where?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const door =
    actor.kind === ACTOR_KIND.AGENT && actor.agentId !== undefined ? (
      <SendingAgent actor={actor} agentId={actor.agentId} nameOnly />
    ) : (
      <ActorRef actor={actor} nameOnly />
    );
  const trailing =
    where === undefined && action === undefined ? undefined : (
      <>
        {where === undefined ? null : <OneLine className="chat-byline-where">{where}</OneLine>}
        {action}
      </>
    );
  return (
    <Comment author={commentAuthor(actor)} nameRef={door} at={at} trailing={trailing}>
      {children}
    </Comment>
  );
}

/** The presses of a message continuing its author's run, on a line that names no one: the author stays named for a screen reader, which may land on this message alone. */
function ContinuedByline({
  actor,
  action,
}: {
  actor: Actor;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="chat-byline absolute top-luke-2 right-luke-8 flex min-w-0 items-baseline gap-x-control-gap text-caption-inline text-muted-foreground [@media(hover:none)]:static [@media(hover:none)]:justify-end"
      data-continued="true"
    >
      <VisuallyHidden>{actorName(actor)}</VisuallyHidden>
      {action}
    </div>
  );
}

/** A message continuing its author's run leads with its time instead of a face, shown while it is hovered, as Slack's grouped messages do. */
function ContinuedTime({ at }: { at: number }): React.JSX.Element {
  return (
    <span
      className="chat-face flex justify-end whitespace-nowrap text-caption-inline leading-body text-muted-foreground opacity-0 [.chat-message:focus-within_&]:opacity-100 [@media(hover:hover)]:[.chat-message:hover_&]:opacity-100"
      data-continued="true"
    >
      <Time className="chat-time" at={at} />
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
    <span className={CHAT_BYLINE_ACTION}>
      {words === "" ? null : <CopyMessageAction words={words} />}
      {extra}
    </span>
  );
}

/** One message of a thread: its face, its byline with its Copy, and its body; drawn again only as its message moves. */
const Reply = memo(function Reply({
  message,
  context,
}: {
  message: ChatMessage;
  context: MessageContext;
}): React.JSX.Element {
  const actor = context.actorOf(message.authorId);
  return (
    <li className={`chat-reply ${CHAT_ROW}`} data-seq={message.seq}>
      <MessageComment actor={actor} at={message.postedAt} action={<RowActions message={message} />}>
        <div className={CHAT_MESSAGE_BODY}>
          <Body message={message} context={context} />
        </div>
      </MessageComment>
    </li>
  );
});

/**
 * A root message, its thread folded under it until a press opens it with
 * the box to reply in; drawn again only as its message, its replies, or
 * what every row shares moves.
 */
const ThreadRow = memo(function ThreadRow({
  message,
  replies,
  posted,
  pendingReplies = NO_PENDING,
  context,
  continued = false,
}: {
  message: ChatMessage;
  replies: readonly ChatMessage[];
  /** The channel For you names the message as posted in; none in the channel itself. */
  posted?: ChatChannel | undefined;
  /** The reader's replies on their way in its thread. */
  pendingReplies?: readonly PendingPost[] | undefined;
  context: MessageContext;
  /** Whether the root continues its author's run, drawn under the name the run began with (`continuesRun`). */
  continued?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const threadDoor = useRef<((words: string) => boolean) | undefined>(undefined);
  // A quote For you's Reply opened the thread for, laid into its box once the box stands.
  const [quoting, setQuoting] = useState<string | undefined>(undefined);
  const actor = context.actorOf(message.authorId);
  // The thread's repliers lead its press by their faces, each once, as a comment thread at rest names them.
  const repliers = distinctActors(replies.map((reply) => context.actorOf(reply.authorId)));
  // A thread in a channel the reader cannot post in reads as it stands, with no box to reply in.
  const canReply = postsWhere(message, context.roster);
  const where =
    posted === undefined ? undefined : <ForYouWhere channel={posted} context={context} />;
  const toggle = (
    <TextButton
      tone={TEXT_BUTTON_TONE.ACCENT}
      aria-expanded={open}
      onClick={() => setOpen((was) => !was)}
    >
      {threadToggleWords(open, replies.length)}
    </TextButton>
  );
  // A message nobody has replied to offers Reply at its byline's end beside its Copy, out of the way until wanted.
  const quiet = replies.length === 0 && !open;
  // A Reply over the thread's words quotes into its box while it is open; For you, which has no box of its own, opens it.
  useChatReplyDoor(row, (words) => {
    if (!canReply) return false;
    if (open) return threadDoor.current?.(words) === true;
    if (posted === undefined) return false;
    setOpen(true);
    setQuoting(words);
    return true;
  });
  const pendingQuote = useMemo(
    () =>
      quoting === undefined ? undefined : { words: quoting, onQuoted: () => setQuoting(undefined) },
    [quoting],
  );
  const thread = quiet ? null : (
    <div className="chat-thread mt-tight-gap" data-open={String(open)}>
      <div className="chat-thread-toggle m-0 text-label [&_.actor-stack]:me-item-gap! [&_.actor-stack]:align-middle">
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
        <ul className="chat-replies m-0 list-none p-0">
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
          replyDoor={threadDoor}
          pendingQuote={pendingQuote}
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
  );
  const action = <RowActions message={message} extra={quiet && canReply ? toggle : undefined} />;
  return (
    <li
      ref={row}
      className={`chat-message ${CHAT_ROW}`}
      data-seq={message.seq}
      data-continued={String(continued)}
    >
      {continued ? (
        <>
          <ContinuedTime at={message.postedAt} />
          <div className={CHAT_MESSAGE_BODY}>
            <ContinuedByline actor={actor} action={action} />
            <Body message={message} context={context} />
          </div>
        </>
      ) : (
        <MessageComment actor={actor} at={message.postedAt} where={where} action={action}>
          <div className={CHAT_MESSAGE_BODY}>
            <Body message={message} context={context} />
          </div>
        </MessageComment>
      )}
      {/* Note that the thread stands in a slot of its own after the message, because a reply landing in the thread above
          turns a continued message into a named one, and an open box drawn inside either shape would be drawn anew,
          losing its caret and a dictation under way. */}
      {thread}
    </li>
  );
});

/** Whether a thread says what the one held said: each field the same, its replies each the one held. */
function sameThread<Thread extends ChatThread>(standing: Thread, thread: Thread): boolean {
  const keys = Object.keys(thread) as (keyof Thread)[];
  return (
    keys.length === Object.keys(standing).length &&
    keys.every((key) => key === "replies" || standing[key] === thread[key]) &&
    standing.replies.length === thread.replies.length &&
    standing.replies.every((reply, at) => reply === thread.replies[at])
  );
}

/**
 * The threads as drawn last, each kept where it says what the one held
 * said, so a row handed it holds while a push moves only others: a
 * channel's threads, and For you's entries alike.
 */
function useKeptThreads<Thread extends ChatThread>(threads: readonly Thread[]): readonly Thread[] {
  const held = useRef(new Map<string, Thread>());
  return useMemo(() => {
    const before = held.current;
    const kept = threads.map((thread) => {
      const standing = before.get(thread.message.id);
      return standing !== undefined && sameThread(standing, thread) ? standing : thread;
    });
    held.current = new Map(kept.map((thread) => [thread.message.id, thread]));
    return kept;
  }, [threads]);
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
  chat,
  channelId,
  context,
  pending,
}: {
  chat: ChatAnswer;
  channelId: string;
  context: MessageContext;
  /** The reader's posts on their way, by where each stands (`pendingByPlace`). */
  pending: ReadonlyMap<string, readonly PendingPost[]>;
}): React.JSX.Element {
  const threads = useKeptThreads(channelThreads(chat, channelId));
  // The first unread message as the channel opened, taken again as another opens in its place.
  const [opened, setOpened] = useState(() => ({
    channelId,
    unreadFrom: firstUnreadSeq(chat, channelId),
  }));
  if (opened.channelId !== channelId) {
    setOpened({ channelId, unreadFrom: firstUnreadSeq(chat, channelId) });
  }
  const unreadFrom = opened.channelId === channelId ? opened.unreadFrom : undefined;
  const list = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLElement>(null);
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
      <ConversationContent className="chat-stream-body px-chat-reading py-luke-16">
        <ol className="chat-messages m-0 list-none p-0">
          {threads.map((thread, index) => {
            const first = thread.message.seq === unreadFrom;
            return (
              <Fragment key={thread.message.id}>
                {first ? (
                  <StreamDivider
                    kind={STREAM_DIVIDER.NEW}
                    as={STREAM_DIVIDER_ELEMENT.LI}
                    ref={line}
                  >
                    {UNREAD_LINE}
                  </StreamDivider>
                ) : null}
                <ThreadRow
                  message={thread.message}
                  replies={thread.replies}
                  pendingReplies={pending.get(pendingKey(channelId, thread.message.seq))}
                  context={context}
                  continued={!first && continuesRun(threads[index - 1], thread)}
                />
              </Fragment>
            );
          })}
          {(pending.get(pendingKey(channelId, undefined)) ?? NO_PENDING).map((entry) => (
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
  channel,
  context,
}: {
  channel: ChatChannel;
  context: MessageContext;
}): React.JSX.Element {
  const { onOpen } = context;
  // Note that the channel decides, not the reason, since an ask in a direct message is listed as an ask.
  const direct = channel.kind === CHANNEL_KIND.DM;
  const name = direct ? (
    DIRECT_MESSAGE
  ) : (
    <ChannelName chat={context.roster} names={context.names} channel={channel} />
  );
  return (
    <>
      {direct ? null : "in "}
      {onOpen === undefined ? (
        name
      ) : (
        <TextButton onClick={() => onOpen({ kind: CHAT_PLACE.CHANNEL, channelId: channel.id })}>
          {name}
        </TextButton>
      )}
    </>
  );
}

/**
 * The head over a place: the way back where it stands alone and a task's
 * glyph as its mark, its name as the title, what it says beside that, and
 * its menu. In the window's Chat it is the window's bar (`Toolbar`), as the
 * Inbox item's beside its list is, level with the rail's and on the card's
 * edges; in a task's tab it is the tab's own bar (`PaneBar`). Standing alone
 * behind its way back, its name keeps the room and what is said beside it
 * is left out.
 */
function PlaceHead({
  title,
  channel,
  meta,
  lead,
  actions,
  phone = false,
}: {
  /** The place's name in words. */
  title: string;
  /** The channel the place shows, whose task's glyph marks it; none on For you. */
  channel: ChatChannel | undefined;
  meta: string | undefined;
  lead: React.ReactNode;
  /** The place's own presses at the head's end, a channel's menu. */
  actions?: React.ReactNode;
  /** Whether a phone heads the place (`phone-head.tsx`): the way back alone at its start, the name centred, its menu at its end, and what is said beside the name left to the place's own view. */
  phone?: boolean;
}): React.JSX.Element {
  const inTab = useContext(HandTabActionsContext) !== undefined;
  if (phone) {
    return <PhoneHead place="chat-place" start={lead} title={title} end={actions} />;
  }
  if (!inTab) {
    const glyph = channel === undefined ? undefined : <ChannelGlyph channel={channel} />;
    return (
      <Toolbar
        place="chat-place"
        start={lead === undefined ? undefined : TOOLBAR_INSET.COLUMN}
        lead={
          lead === undefined ? (
            glyph
          ) : (
            <>
              {lead}
              {glyph}
            </>
          )
        }
        title={title}
        detail={lead === undefined ? meta : undefined}
        actions={actions}
      />
    );
  }
  return (
    <PaneBar
      mark={
        <>
          {lead}
          {channel === undefined ? null : <ChannelGlyph channel={channel} />}
        </>
      }
      title={title}
      detail={
        meta === undefined ? undefined : (
          <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED} truncate>
            {meta}
          </Text>
        )
      }
      actions={actions}
    />
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
  return andList((channel.members ?? []).map((id) => chatWho(chat, names, id).name));
}

/** What a channel's composer is called: "Message" and the channel's `#name`, or who a DM is with. */
function composerLabel(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  const label = channelLabel(chat, names, channel);
  return channel.kind === CHANNEL_KIND.DM ? `Message ${label}` : `Message #${label}`;
}

/** The pane: the place's head, then its messages, or a line saying there are none, and a channel's composer; drawn again only as what it is handed moves. */
export const ChatPane = memo(function ChatPane({
  chat,
  names,
  place,
  mentionPlace,
  tasks = NO_TASKS,
  openLink,
  onPost,
  onAnswer,
  readPicture,
  lead,
  channelActions,
  onOpen,
  takesCaret = false,
  onBringBack,
  hidden,
  taskDoors,
  phone = false,
}: {
  chat: ChatAnswer;
  names: ChatNames;
  place: ChatPlace;
  /** The workspace a chip's link is written in; none where it is not known yet, when the composer offers no member to name. */
  mentionPlace?: MentionPlace | undefined;
  /** The tasks the window lists, whose channels' composers offer them. */
  tasks?: readonly TaskSummary[];
  openLink: (url: string) => void;
  /** Posts a message under the key the pane minted for it; answers why it was refused, or nothing once it is taken. */
  onPost: (post: ChatPost, clientKey: string) => Promise<string | undefined>;
  /** Answers an ask; answers why it was refused, or nothing once it is taken. */
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
  /** Reads one picture a message carries, by the message and the attachment its block names. */
  readPicture: (messageId: string, attachmentId: string) => Promise<PictureAnswer>;
  /** What leads the place's head: the way back to the rail, where the place stands alone. */
  lead?: React.ReactNode;
  /** Whether a phone heads the place (`phone-head.tsx`), `lead` its one start control. */
  phone?: boolean;
  /** The presses a channel's head ends on, its menu; none where the channel offers none. */
  channelActions?: ((channel: ChatChannel) => React.ReactNode) | undefined;
  /** Shows a place of the chat, as For you's row opens its channel; none where no other place is shown here. */
  onOpen?: ((place: ChatPlace) => void) | undefined;
  /** Whether the box at a channel's foot takes the caret as the channel opens, as a press, ⌘K, or a link opens it and K and J do not; none takes it where this is left out. */
  takesCaret?: boolean;
  /** Asks to bring an archived topic back, from its foot; none where it is not offered. */
  onBringBack?: ((channel: ChatChannel) => void) | undefined;
  /** Whether the pane is hidden, as a narrow room hides it behind the rail. */
  hidden?: boolean;
  /** The doors of a task, by its id, that its channel's messages read their code and open their files through; none where the task is not at hand. */
  taskDoors?: ((taskId: string) => ChatTaskDoors | undefined) | undefined;
}): React.JSX.Element {
  // Note that the roster stands while a push keeps its arrays, so what is read of it alone stands with it.
  const { self, members, channels } = chat;
  const roster = useMemo(
    (): ChatRoster => ({ self, members, channels }),
    [self, members, channels],
  );
  const keywords = chatKeywords(roster, names);
  const actorOf = useChatActor(roster, names);
  // A composer offers only the members a post in its own channel reaches, as the service holds the chat to its tasks.
  const mentionsIn = useChatMentions({ chat: roster, names, place: mentionPlace, tasks, actorOf });
  const doorsIn = useCallback(
    (channelId: string) => {
      const home = placeChannel(roster, { kind: CHAT_PLACE.CHANNEL, channelId });
      if (home?.kind !== CHANNEL_KIND.TASK || home.planId === undefined) return undefined;
      return taskDoors?.(home.planId);
    },
    [roster, taskDoors],
  );
  const posting = usePendingPosts(chat, onPost);
  // The boxes a Reply in the place shown quotes into, each by the words it answers.
  const [replyDoors] = useState((): ChatReplyDoors => new Map());
  const { send, onRetryPost, onDiscardPost } = posting;
  const context = useMemo(
    (): MessageContext => ({
      actorOf,
      roster,
      names,
      mentionsIn,
      keywords,
      openLink,
      send,
      onRetryPost,
      onDiscardPost,
      onAnswer,
      readPicture,
      doorsIn,
      onOpen,
    }),
    [
      actorOf,
      roster,
      names,
      mentionsIn,
      keywords,
      openLink,
      send,
      onRetryPost,
      onDiscardPost,
      onAnswer,
      readPicture,
      doorsIn,
      onOpen,
    ],
  );
  return (
    <ChatReadContext.Provider value={chat}>
      <ChatReplyDoorsContext.Provider value={replyDoors}>
        <PlaceView
          chat={chat}
          place={place}
          context={context}
          pending={posting.pending}
          lead={lead}
          hidden={hidden}
          channelActions={channelActions}
          onBringBack={onBringBack}
          takesCaret={takesCaret}
          phone={phone}
        />
      </ChatReplyDoorsContext.Provider>
    </ChatReadContext.Provider>
  );
});

/** The place shown: For you, or a channel with its head, its messages, and its foot. */
function PlaceView({
  chat,
  place,
  context,
  pending,
  lead,
  hidden,
  channelActions,
  onBringBack,
  takesCaret,
  phone,
}: {
  chat: ChatAnswer;
  place: ChatPlace;
  context: MessageContext;
  /** The reader's posts the chat does not hold yet, in the order sent (`usePendingPosts`). */
  pending: readonly PendingPost[];
  lead: React.ReactNode;
  hidden: boolean | undefined;
  channelActions: ((channel: ChatChannel) => React.ReactNode) | undefined;
  onBringBack: ((channel: ChatChannel) => void) | undefined;
  takesCaret: boolean;
  phone: boolean;
}): React.JSX.Element {
  const { names, keywords, mentionsIn, doorsIn, send } = context;
  const channel = placeChannel(chat, place);
  const entries = useKeptThreads(forYou(chat));
  const pendingBy = useMemo(() => pendingByPlace(pending), [pending]);
  const section = useRef<HTMLElement>(null);
  const replyDoors = useContext(ChatReplyDoorsContext);
  const footDoor = useRef<((words: string) => boolean) | undefined>(undefined);
  // A channel drawn in a task's tab on a phone is headed by the task's header alone, whose title
  // names the tab, so its own head, which says the task's name again, is not drawn there.
  const phoneRoom = usePhoneRoom();
  const inTab = useContext(HandTabActionsContext) !== undefined;
  const headed = !(phoneRoom && inTab);
  // A Reply over words no nearer box answers quotes into the channel's own, at its foot.
  const reply = (
    <ReplyToSelection
      scope={section}
      onReply={(words, picked) => {
        if (replyDoors === undefined || !replyInto(replyDoors, picked, words)) {
          footDoor.current?.(words);
        }
      }}
    />
  );
  if (place.kind === CHAT_PLACE.FOR_YOU || channel === undefined) {
    return (
      <section
        ref={section}
        className={`${CHAT_STREAM} ph-no-capture`}
        aria-label="For you"
        hidden={hidden}
      >
        <PlaceHead
          title={FOR_YOU_TITLE}
          channel={undefined}
          meta={undefined}
          lead={lead}
          phone={phone}
        />
        {entries.length === 0 ? (
          <EmptyState icon={<AtSignIcon />}>{NEEDS_YOU.NONE}</EmptyState>
        ) : (
          <Conversation>
            <ConversationContent className="chat-stream-body px-chat-reading py-luke-16">
              <ol className="chat-messages m-0 list-none p-0">
                {entries.map((entry) => (
                  // Each row is of its own channel, so each reads through its own task.
                  <TaskDoorsScope key={entry.message.id} doors={doorsIn(entry.channel.id)}>
                    <ThreadRow
                      message={entry.message}
                      replies={entry.replies}
                      posted={entry.channel}
                      pendingReplies={pendingBy.get(
                        pendingKey(entry.channel.id, entry.message.seq),
                      )}
                      context={context}
                    />
                  </TaskDoorsScope>
                ))}
              </ol>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
        {reply}
      </section>
    );
  }
  const threads = channelThreads(chat, channel.id);
  const title = channelTitle(chat, names, channel);
  const doors = doorsIn(channel.id);
  return (
    <section
      ref={section}
      className={`${CHAT_STREAM} ph-no-capture`}
      aria-label={title}
      hidden={hidden}
    >
      {headed ? (
        <PlaceHead
          title={title}
          channel={channel}
          meta={channelMeta(chat, names, channel)}
          lead={lead}
          actions={channelActions?.(channel)}
          phone={phone}
        />
      ) : null}
      {threads.length === 0 && !pending.some((each) => each.channelId === channel.id) ? (
        <EmptyState icon={channel.kind === CHANNEL_KIND.DM ? <AtSignIcon /> : <HashIcon />}>
          {NOTHING_POSTED}
        </EmptyState>
      ) : (
        <TaskDoorsScope doors={doors}>
          <ChannelStream chat={chat} channelId={channel.id} context={context} pending={pendingBy} />
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
          takesCaret={takesCaret}
          replyDoor={footDoor}
          onSend={(text, attachments, takeBack) =>
            send(
              { channelId: channel.id },
              { ...postOf(text, attachments), channelId: channel.id },
              takeBack,
            )
          }
        />
      ) : channel.archived && channel.kind === CHANNEL_KIND.TOPIC && onBringBack !== undefined ? (
        <ArchivedComposerNote
          words={ARCHIVED_CHANNEL}
          action={UNARCHIVE_CHANNEL}
          onUnarchive={() => onBringBack(channel)}
        />
      ) : (
        // Note that a task's channel comes back with its task, and a DM between two others is only read, so neither offers a press.
        <div className="chat-closed-foot mx-auto mt-block-gap mb-luke-16 w-chat-measure text-center">
          <Text tone={TEXT_TONE.MUTED}>
            {channel.archived ? ARCHIVED_CHANNEL : OTHERS_DM(dmPair(chat, names, channel))}
          </Text>
        </div>
      )}
      {/* Note that a channel the reader cannot post in has no box a quote could go to, so it offers no Reply. */}
      {postsIn(chat, channel) ? reply : null}
    </section>
  );
}
