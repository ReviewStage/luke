import { CHANNEL_KIND, CHAT_BLOCK, type ChatAnswer, knownBlock } from "@luke/features/chat-wire";
import { ChevronRightIcon } from "@luke/ui";
import {
  CHAT_PLACE,
  type ChatNames,
  type ChatPlace,
  channelLabel,
  chatWho,
} from "@luke/ui/chat-model";
import type { ChatNoticeMetadata } from "@luke/wire";
import { MemberMark } from "./chat-pane";
import { RelativeTime } from "./relative-time";
import { TranscriptWords } from "./transcript-blocks";

/**
 * chat-notice.tsx -- a chat notice in an agent's transcript, drawn as a card from the member who sent the message it tells of.
 *
 * A line the chat steered into a coding agent's turn is no message of the
 * developer's, so it never draws as their bubble. It draws as a card across
 * the column instead, washed in Luke's blue, headed by its sender's mark,
 * handle, the channel the message was posted in, its place in the
 * workspace's chat as `m 41`, and how long ago it was posted, with Open in
 * Chat at the head's end, which opens the window's Chat on that channel.
 * Its body is the message as the chat holds it, Markdown as the transcript
 * draws it; where the window has read no chat holding it, the head says
 * what the notice's own metadata says, the sender and the place, and the
 * body is the notice's words, with nothing to open.
 */

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
  notice,
  words,
  doors,
  now,
}: {
  notice: ChatNoticeMetadata;
  /** The notice's own words, drawn where the chat the window holds does not carry the message. */
  words: string;
  doors: ChatNoticeDoors | undefined;
  now: number;
}): React.JSX.Element {
  const held = doors?.chat.messages.find((message) => message.seq === notice.chat_seq);
  const channel =
    held === undefined
      ? undefined
      : doors?.chat.channels.find((each) => each.id === held.channelId);
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
  const shownWords = held === undefined ? words : heldWords(held);
  return (
    <section className="chat-notice" data-chat-notice="" data-author={notice.author}>
      <header className="chat-notice-head">
        {who === undefined ? null : <MemberMark who={who} small />}
        <span className="chat-notice-from">@{notice.from}</span>
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
          <button
            type="button"
            className="chat-notice-open"
            onClick={() => doors.onOpen({ kind: CHAT_PLACE.CHANNEL, channelId: channel.id })}
          >
            {OPEN_IN_CHAT}
            <ChevronRightIcon aria-hidden="true" />
          </button>
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
