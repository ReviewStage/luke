import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  type ChatAnswer,
  type ChatChannel,
  chatNoticeWords,
  knownBlock,
} from "@luke/features/chat-wire";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  MESSAGE_ACTIONS_PLACEMENT,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { CHAT_PLACE, type ChatNames, type ChatPlace, chatWho } from "@luke/ui/chat-model";
import { momentText } from "@luke/ui/time-format";
import { type ChatNoticeMetadata, MESSAGE_AUTHOR } from "@luke/wire";
import { MessagesSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message, MessageAction, MessageContent } from "../ai-elements/message.js";
import { previewWords } from "../desktop/chat-preview.js";
import { useChatActor } from "./chat-actors.js";
import { ChannelName, channelTitle } from "./chat-channel-name.js";
import { CopyMessageAction } from "./copy-message.js";
import { SentTime } from "./sent-time.js";
import { SentWords } from "./skill-chip.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * chat-notice.tsx -- a chat notice in an agent's transcript, drawn as its sender's bubble at the column's left.
 *
 * A line the chat steered into a coding agent's turn is no message of the
 * developer's, so it never draws as their bubble at the right. It draws as
 * the same bubble at the left instead, the way a chat app sets the other
 * side's words, with the line under it the mirror of a sent message's: the
 * sender's mark and name, then when it was posted, then, while the pointer
 * or the keyboard is on it, Open in Chat, Copy, and Copy link. Where it was
 * said is no part of that line: Open in Chat hangs a hover card saying it,
 * a direct message and its two, or the channel and, for a reply, the
 * thread's first message, and the moment in full; a press on it opens the
 * window's Chat on that channel. Its body is the message as the chat holds
 * it, Markdown as the transcript draws it, and a person's as they typed it,
 * its line breaks and skills kept, as Chat draws it (`skill-chip.tsx`'s
 * `SentWords`); where the window has read no chat holding it, the line names
 * the sender the notice's own metadata names, the body is the notice's
 * words, and there is nothing to open.
 */

/** No names, for a notice read before the chat is: its sender is drawn as someone until the chat lands. */
const NO_NAMES: ChatNames = {
  agents: new Map(),
  tasks: new Map(),
  agentTasks: new Map(),
  selfName: undefined,
};

/** What Open in Chat is called. */
const OPEN_IN_CHAT = "Open in Chat";

/** What a direct message's card is named. */
const DIRECT_MESSAGE = "Direct message";

/** What a reply's card says under its channel. */
const IN_A_THREAD = "Reply in a thread";

/** What the card reads beside the notice: the chat the window holds, how it names members, and the door that opens a place of it. */
export interface ChatNoticeDoors {
  readonly chat: ChatAnswer;
  readonly names: ChatNames;
  readonly onOpen: (place: ChatPlace) => void;
}

type HeldMessage = ChatAnswer["messages"][number];

/** The message's words as the chat holds them: each Markdown block, the rest by nothing, since the notice is a glance and Chat the full read. */
function heldWords(message: HeldMessage): string {
  return message.blocks
    .flatMap((block) =>
      knownBlock(block) && block.type === CHAT_BLOCK.MARKDOWN ? [block.text] : [],
    )
    .join("\n\n");
}

/** Where a notice's message was said, hung from its Open in Chat: a DM and its two, or the channel and the thread it replies in, its first message as plain words (`chat-preview.ts`), then the moment in full. */
function NoticePlaceCard({
  doors,
  channel,
  held,
}: {
  doors: ChatNoticeDoors;
  channel: ChatChannel;
  held: HeldMessage;
}): React.JSX.Element {
  const dm = channel.kind === CHANNEL_KIND.DM;
  const root =
    held.parentId === undefined
      ? undefined
      : doors.chat.messages.find((message) => message.id === held.parentId);
  const rootWords = root === undefined ? "" : previewWords(root);
  return (
    <HoverCard data-chat-notice-place="">
      <HoverCardHead
        name={
          dm ? (
            DIRECT_MESSAGE
          ) : (
            <ChannelName chat={doors.chat} names={doors.names} channel={channel} />
          )
        }
        sub={
          dm
            ? channelTitle(doors.chat, doors.names, channel)
            : held.parentId === undefined
              ? undefined
              : IN_A_THREAD
        }
      />
      {root === undefined || rootWords === "" ? null : (
        <>
          <HoverCardRule />
          <HoverCardNote>
            {`${chatWho(doors.chat, doors.names, root.authorId).name}: ${rootWords}`}
          </HoverCardNote>
        </>
      )}
      <HoverCardNote>{momentText(held.postedAt)}</HoverCardNote>
    </HoverCard>
  );
}

/** A chat notice's bubble at the column's left: the message, then its sender and when, and its actions, Open in Chat among them where the window holds the chat. */
export function ChatNoticeCard({
  messageId,
  notice,
  words,
  from,
  sentAt,
  doors,
}: {
  /** The transcript line the notice wrote, which a link to it finds the bubble by. */
  messageId: string;
  notice: ChatNoticeMetadata;
  /** The notice's own words, drawn where the chat the window holds does not carry the message, without the lines that are the agent's alone (`chatNoticeWords`). */
  words: string;
  /** Who posted, drawn in the name's place: another coding agent's own chip; none to name the poster by their mark and name. */
  from?: ReactNode | undefined;
  /** When the notice reached the agent, said where the chat the window holds does not carry the message. */
  sentAt?: number | undefined;
  doors: ChatNoticeDoors | undefined;
}): React.JSX.Element {
  const held = doors?.chat.messages.find((message) => message.seq === notice.chat_seq);
  const channel =
    held === undefined
      ? undefined
      : doors?.chat.channels.find((each) => each.id === held.channelId);
  const actorOf = useChatActor(doors?.chat, doors?.names ?? NO_NAMES);
  const who =
    held === undefined || doors === undefined
      ? undefined
      : chatWho(doors.chat, doors.names, held.authorId);
  // Note that a message of no Markdown, a link or a picture alone, keeps the notice's own words.
  const fromChat = held === undefined ? "" : heldWords(held);
  const shownWords = fromChat === "" ? chatNoticeWords(words) : fromChat;
  const at = held?.postedAt ?? sentAt;
  const open =
    doors === undefined || channel === undefined || held === undefined ? null : (
      <MessageAction
        label={OPEN_IN_CHAT}
        card={<NoticePlaceCard doors={doors} channel={channel} held={held} />}
        onClick={() => doors.onOpen({ kind: CHAT_PLACE.CHANNEL, channelId: channel.id })}
      >
        <MessagesSquareIcon />
      </MessageAction>
    );
  return (
    <Message
      from="assistant"
      className="is-chat"
      data-chat-notice=""
      data-author={notice.author}
      data-message-id={messageId}
    >
      {shownWords === "" ? null : (
        <MessageContent className="chat-notice-words">
          {notice.author === MESSAGE_AUTHOR.HUMAN ? (
            <SentWords text={shownWords} />
          ) : (
            <TranscriptWords text={shownWords} />
          )}
        </MessageContent>
      )}
      <div className="message-meta">
        {/* A sender the chat names is drawn by their own chip, which hangs their card, as another agent is by its own. */}
        <span className="message-sender">
          {from ??
            (who?.member === undefined ? (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="message-sender-words"
              >
                {notice.from}
              </Text>
            ) : (
              <ActorRef actor={actorOf(who.member.id)} />
            ))}
        </span>
        {at === undefined ? null : <SentTime at={at} named />}
        <CopyMessageAction
          words={shownWords}
          copyable={shownWords !== ""}
          messageId={messageId}
          placement={MESSAGE_ACTIONS_PLACEMENT.INLINE}
          lead={open}
        />
      </div>
    </Message>
  );
}
