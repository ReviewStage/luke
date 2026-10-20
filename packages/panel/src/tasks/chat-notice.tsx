import {
  CHANNEL_KIND,
  CHAT_BLOCK,
  type ChatAnswer,
  chatNoticeWords,
  knownBlock,
} from "@luke/features/chat-wire";
import { Button } from "@luke/ui";
import {
  CHAT_PLACE,
  type ChatNames,
  type ChatPlace,
  channelLabel,
  chatWho,
} from "@luke/ui/chat-model";
import type { ChatNoticeMetadata } from "@luke/wire";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useChatActor } from "./chat-actors.js";
import { RelativeTime } from "./relative-time.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * chat-notice.tsx -- a chat notice in an agent's transcript, drawn as a card from the member who sent the message it tells of.
 *
 * A line the chat steered into a coding agent's turn is no message of the
 * developer's, so it never draws as their bubble. It draws as a card across
 * the column instead, washed in Luke's blue, headed by its sender's mark,
 * name, the channel the message was posted in, its place in the
 * workspace's chat as `m 41`, and how long ago it was posted, with Open in
 * Chat at the head's end, which opens the window's Chat on that channel.
 * Its body is the message as the chat holds it, Markdown as the transcript
 * draws it; where the window has read no chat holding it, the head says
 * what the notice's own metadata says, the sender and the place, and the
 * body is the notice's words, with nothing to open.
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

/** What the card reads beside the notice: the chat the window holds, how it names members, and the door that opens a place of it. */
export interface ChatNoticeDoors {
  readonly chat: ChatAnswer;
  readonly names: ChatNames;
  readonly onOpen: (place: ChatPlace) => void;
}

/** The message's words as the chat holds them: each Markdown block, the rest by nothing, since the notice is a glance and Chat the full read. */
function heldWords(message: ChatAnswer["messages"][number]): string {
  return message.blocks
    .flatMap((block) =>
      knownBlock(block) && block.type === CHAT_BLOCK.MARKDOWN ? [block.text] : [],
    )
    .join("\n\n");
}

/** A chat notice's card: the sender, the channel, the place, and when, then the message; Open in Chat where the window holds the chat. */
export function ChatNoticeCard({
  messageId,
  notice,
  words,
  from,
  doors,
  now,
}: {
  /** The transcript line the notice wrote, which a link to it finds the card by. */
  messageId: string;
  notice: ChatNoticeMetadata;
  /** The notice's own words, drawn where the chat the window holds does not carry the message, without the lines that are the agent's alone (`chatNoticeWords`). */
  words: string;
  /** Who posted, drawn in the name's place: another coding agent's own chip; none to name the poster by their mark and name. */
  from?: ReactNode | undefined;
  doors: ChatNoticeDoors | undefined;
  now: number;
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
  const where =
    channel === undefined || doors === undefined
      ? undefined
      : channel.kind === CHANNEL_KIND.DM
        ? "direct message"
        : `in #${channelLabel(doors.chat, doors.names, channel)}`;
  // Note that a message of no Markdown, a link or a picture alone, keeps the notice's own words.
  const fromChat = held === undefined ? "" : heldWords(held);
  const shownWords = fromChat === "" ? chatNoticeWords(words) : fromChat;
  return (
    <section
      className="chat-notice"
      data-chat-notice=""
      data-author={notice.author}
      data-message-id={messageId}
    >
      <header className="chat-notice-head">
        {from ?? (
          <>
            {who?.member === undefined ? null : (
              <ActorMark actor={actorOf(who.member.id)} size={ACTOR_SIZE.INLINE} />
            )}
            <span className="chat-notice-from">
              {who?.member === undefined ? notice.from : who.name}
            </span>
          </>
        )}
        <span className="chat-notice-place">
          {where === undefined ? null : `${where} · `}m {notice.chat_seq}
          {held === undefined ? null : (
            <>
              {" · "}
              <RelativeTime at={held.postedAt} now={now} />
            </>
          )}
        </span>
        {channel === undefined || doors === undefined ? null : (
          <Button onClick={() => doors.onOpen({ kind: CHAT_PLACE.CHANNEL, channelId: channel.id })}>
            {OPEN_IN_CHAT}
          </Button>
        )}
      </header>
      {shownWords === "" ? null : (
        <div className="chat-notice-words">
          <TranscriptWords text={shownWords} />
        </div>
      )}
    </section>
  );
}
