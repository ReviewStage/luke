import { Schema as EffectSchema } from "effect";
import {
  ASK_BOUNDS,
  ASK_STATUS,
  type ChatBlock,
  type ChatChoice,
  type ChatForm,
  type ChatImageBlock,
  type ChatImageType,
  type ChatPostBlock,
  type ChatReply,
  type ChatResponse,
  chatKeySchema,
  chatPostBlocksSchema,
  chatReadBlockSchema,
  chatReadResponseSchema,
  chatReplySchema,
  chatResponseSchema,
  formValueLines,
  replyRefusal,
  replyWords,
} from "./chat-blocks.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";

/**
 * inbox-wire.ts -- the developer's inbox: what a plan's coding agents need of the developer, posted by the agents and answered on the desktop.
 *
 * An item is one thing an agent cannot do or decide alone, kept on the
 * service as a row of its own rather than in the agent's transcript, so it
 * stands where the developer looks whatever the transcript has scrolled
 * past, and the agent can change it or take it back. The agent names each
 * item by a key of its own: posting under a key it used before replaces
 * that item, and reopens it where it was answered or closed, so an item is
 * kept current rather than posted twice. An item is a title, the blocks
 * of context under it, and the response it asks for. The blocks are a
 * closed set of shapes, Markdown, a link, a reference to lines of the
 * agent's repository at a commit, and an image, each a tagged record, so a
 * later block type is one more member rather than a new column. An image
 * is one the agent took in its sandbox, a screenshot of what it rendered:
 * the agent posts it by the file's path there, the service reads the file
 * and keeps it as an attachment of the item's, and the block the desktop
 * reads names the attachment, which the desktop fetches under the account
 * and never by an address the agent wrote. The
 * response is a closed set too, each answered its own way: a choice among
 * the agent's options, one or several, or in the developer's own words;
 * an approval or a decline of a step; words; a task the developer does by
 * hand and marks done or not possible; a form of typed fields; or nothing
 * but an acknowledgement, for something the developer should know. An
 * item says whether the agent needs to hear back: where it does, the
 * answer reaches the agent as one of the developer's messages, which
 * steers its turn or opens one; where it does not, the answer is kept and
 * the agent reads it the next time it reads its inbox. Every item carries
 * a revision the agent's every change moves on, and an answer names the
 * revision it answers, so an answer to an item the agent has since changed
 * is refused rather than taken for the item as it now stands.
 *
 * The agent posts, closes, and reads its items through the tools named
 * below, whose inputs are declared here so the model is shown, eve holds,
 * and the desktop draws one shape. A plan's inbox is read past a cursor the
 * service hands back, held open while nothing changed, as a transcript is.
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. The item a desktop reads carries the version of
 * this vocabulary the service wrote it in, and reads a block or a response
 * of a type this build does not know as its type alone, so a desktop
 * behind the service draws what it knows and a placeholder for the rest
 * rather than refusing the whole inbox.
 *
 * The block, response, and answer shapes are chat's (`chat-blocks.ts`), an
 * inbox item being an ask a chat message carries; the names below alias
 * chat's until the Inbox goes.
 */

/**
 * The version of this vocabulary: moved on when a block or a response type
 * is added, so a desktop reading an item written under a later one knows
 * what it cannot draw was written for a newer Luke. Version 1 was the
 * fixed kinds, a choice, an approval, a question, and a task, with one
 * Markdown details field; version 2 is blocks and a response; version 3
 * adds the code block; version 4 adds the image block.
 */
export const INBOX_WIRE_VERSION = 4;

export const INBOX_BOUNDS = {
  ...ASK_BOUNDS,
  /** The most items one agent keeps open at once: what a person works through, never a log. */
  MAX_OPEN_PER_AGENT: 20,
  /** The most settled items a read of a plan's inbox carries beside every open one, the latest changed first. */
  MAX_ITEMS_READ: 200,
  /** The most settled items an agent's inbox tool answers with beside every open one: enough to hear what was answered lately. */
  MAX_SETTLED_TOLD: 20,
} as const;

/** The tools an agent keeps its items with, by the names their tool parts carry in its transcript. */
export const INBOX_TOOL = {
  /** Posts an item, or replaces the one under the same key. */
  POST: "post_to_inbox",
  /** Takes an item back, with why. */
  CLOSE: "close_inbox_item",
  /** Reads the agent's items as they stand, answers and all. */
  READ: "read_inbox",
} as const;

/** The blocks an item's context is made of: chat's. */
/** The pictures an image block may be: chat's. */
export { CHAT_BLOCK as INBOX_BLOCK, CHAT_IMAGE_TYPE as INBOX_IMAGE_TYPE } from "./chat-blocks.js";

export type InboxImageType = ChatImageType;

/** The responses an item asks for: chat's asks. */
/** The fields a form may ask: chat's. */
/** Where an item stands: where an ask stands. */
export {
  ASK_STATUS as INBOX_STATUS,
  CHAT_ASK as INBOX_RESPONSE,
  CHAT_FIELD as INBOX_FIELD,
  chatImageTypeSchema as inboxImageTypeSchema,
} from "./chat-blocks.js";

export type InboxStatus = (typeof ASK_STATUS)[keyof typeof ASK_STATUS];

/** How the developer answered an item: how an ask is answered. */
export { CHAT_REPLY as INBOX_REPLY } from "./chat-blocks.js";

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** An item's key as the agent spells it: chat's key. */
export {
  chatBlockSchema as inboxBlockSchema,
  chatKeySchema as inboxKeySchema,
} from "./chat-blocks.js";

export type InboxBlock = ChatBlock;

export { codeLinesReadable } from "./chat-blocks.js";

export type InboxImageBlock = ChatImageBlock;

export {
  chatBlocksSchema as inboxBlocksSchema,
  chatPostBlockSchema as inboxPostBlockSchema,
} from "./chat-blocks.js";

export type InboxPostBlock = ChatPostBlock;

export {
  chatFieldSchema as inboxFieldSchema,
  chatOptionSchema as inboxOptionSchema,
  chatPostBlocksSchema as inboxPostBlocksSchema,
  chatResponseSchema as inboxResponseSchema,
} from "./chat-blocks.js";

export type InboxResponse = ChatResponse;

export type InboxChoice = ChatChoice;

export type InboxForm = ChatForm;

/**
 * What a post's tool part carries as its input: the item's key, a title,
 * the blocks of context under it, an image among them by its path in the
 * sandbox, the response it asks for, and whether the agent needs to hear
 * back, which it does unless it says not. The model is shown this schema
 * and eve holds the call to it.
 */
export const inboxPostInputSchema = EffectSchema.Struct({
  key: chatKeySchema,
  title: filledText(INBOX_BOUNDS.MAX_TITLE_CHARS),
  blocks: EffectSchema.optionalKey(chatPostBlocksSchema),
  response: chatResponseSchema,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxPost = typeof inboxPostInputSchema.Type;

/** What a close's tool part carries as its input: the item's key, and why the agent takes it back. */
export const inboxCloseInputSchema = EffectSchema.Struct({
  key: chatKeySchema,
  reason: filledText(INBOX_BOUNDS.MAX_REASON_CHARS),
});

/** What a read's tool part carries as its input: nothing, since an agent reads its own items alone. */
export const inboxReadInputSchema = EffectSchema.Struct({});

export {
  chatFieldValueSchema as inboxFieldValueSchema,
  chatFormValueSchema as inboxFormValueSchema,
  chatFormValuesSchema as inboxFormValuesSchema,
  chatReplySchema as inboxReplySchema,
} from "./chat-blocks.js";

export type InboxReply = ChatReply;

export {
  chatReadBlockSchema as inboxReadBlockSchema,
  chatReadResponseSchema as inboxReadResponseSchema,
} from "./chat-blocks.js";

/** One item as the desktop reads it. */
export const inboxItemSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  key: EffectSchema.String,
  revision: countedNumber,
  /** The version of this vocabulary the service wrote the item in. */
  version: countedNumber,
  title: EffectSchema.String,
  blocks: EffectSchema.Array(chatReadBlockSchema),
  response: chatReadResponseSchema,
  needsReply: EffectSchema.Boolean,
  status: EffectSchema.Literals(Object.values(ASK_STATUS)),
  /** The developer's answer, on an answered item. */
  answer: EffectSchema.optionalKey(chatReplySchema),
  /**
   * The member who answered, on an answered item, any member of the plan's
   * workspace; absent for an answer nobody can be named for, and from a
   * service before answerers were kept. The window says "You" only where it
   * is the signed-in account.
   */
  answeredBy: EffectSchema.optionalKey(memberRefSchema),
  /** Why the agent took the item back, on a closed one. */
  closedReason: EffectSchema.optionalKey(EffectSchema.String),
  /** When the agent first posted the item under its key. */
  postedAt: countedNumber,
  /** When the item last changed, by the agent or the developer. */
  updatedAt: countedNumber,
});

export type InboxItem = typeof inboxItemSchema.Type;

/** Where a reader of an inbox starts: before anything. */
export const INBOX_CURSOR_START = "0";

/** Where a reader of an inbox stands, as the service last handed it back. */
export const inboxCursorSchema = filledText(INBOX_BOUNDS.MAX_CURSOR_CHARS);

/** A plan's inbox as it stands: every item its agents posted, the latest changed first, and the cursor to read on from. */
export const inboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxItemSchema),
  cursor: EffectSchema.String,
});

export type InboxAnswer = typeof inboxAnswerSchema.Type;

/** An answer to one item: the revision it answers, the answer, and a key the client made, so an answer sent again after a lost reply is taken once. */
export const inboxAnswerRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  ...chatReplySchema.fields,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

/** What an answer comes back as: the item as it then stands, and whether the answer was taken, which it is not where the agent changed the item first. */
export const inboxAnsweredSchema = EffectSchema.Struct({
  item: inboxItemSchema,
  taken: EffectSchema.Boolean,
});

/** How the developer's answer opens, in the message that hands it to the agent. */
export const INBOX_ANSWER_LEAD = "Inbox answer";

/**
 * The message an answer reaches the agent as: a first line naming the item
 * by its key and title with what the developer did, then a form's values
 * one per line, then their note. Note that the title is put on one line,
 * because the line is read whole.
 */
export function inboxAnswerMessage(
  item: Pick<InboxItem, "key" | "title">,
  reply: InboxReply,
): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_ANSWER_LEAD} on "${title}" (key ${item.key}): ${replyWords(reply)}`;
  const values = reply.values === undefined ? "" : formValueLines(reply.values);
  const note = reply.note?.trim() ?? "";
  return [header, values, note].filter((part) => part !== "").join("\n\n");
}

/**
 * Why an answer does not fit its item, or nothing where it does: the
 * response takes the reply, a pick names offered options, a form's values
 * fill it, and words stand where the answer is the developer's own. A
 * response this build does not know takes nothing.
 */
export function inboxReplyRefusal(
  item: Pick<InboxItem, "response">,
  reply: InboxReply,
): string | undefined {
  return replyRefusal(item.response, reply);
}
