import { CONVERSATION_MESSAGE_AUTHOR, type ConversationMessageAuthor } from "@sidecar/session";
import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * What the messages endpoint answers: one bounded page of a session's
 * conversation. Who wrote one message, like every other vocabulary on this
 * wire, is the owning package's own set rather than a copy of it.
 */

/**
 * One attributed message of a session's conversation, as the messages
 * endpoint relays it: the provider's own id, who wrote it, and the words
 * whole — the read's bounds live on the page, never on the message. Only the
 * two voices a chat screen draws exist on the wire, because a message the
 * provider's store did not attribute never left the adapter at all.
 */
export interface HostedConversationMessage {
  id: string;
  author: ConversationMessageAuthor;
  text: string;
  /** Unix ms the provider recorded the message at, when it reported one. */
  receivedAt?: number;
}

/**
 * The messages endpoint answer: one bounded page of attributed messages and
 * the positions to continue from. `lastMessageId` is where a poll resumes —
 * absent on an older-history page, which must never move a poll backward —
 * and `firstOffset`/`hasOlder` are where a scroll to the top continues,
 * absent on a poll, which never looks backward. The server assembled it from
 * a fresh read and stored nothing — a new request is a new read.
 */
export interface HostedConversationAnswer {
  messages: HostedConversationMessage[];
  lastMessageId?: string;
  hasMore: boolean;
  firstOffset?: number;
  hasOlder?: boolean;
}

const conversationMessageSchema: Schema<HostedConversationMessage> = s.record(
  {
    id: s.text(),
    author: s.enumOf(Object.values(CONVERSATION_MESSAGE_AUTHOR), { ends: TEXT_ENDS.TRIM }),
    // The words are read as written: a message is rendered as its author
    // wrote it, and trimming is a display decision this wire reader has no
    // business making. Only an empty message is no message.
    text: writtenText,
    receivedAt: s.dropRefused(countedNumber),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** A malformed message is skipped, not fatal. */
export const hostedConversationAnswerSchema: Schema<HostedConversationAnswer> = s.record(
  {
    messages: s.array(conversationMessageSchema, { skipRefused: true }),
    lastMessageId: s.dropRefused(s.text()),
    hasMore: s.boolean(),
    firstOffset: s.dropRefused(countedNumber),
    hasOlder: s.dropRefused(s.boolean()),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
