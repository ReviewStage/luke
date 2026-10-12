import { Schema as EffectSchema } from "effect";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

/**
 * inbox-wire.ts -- the developer's inbox: what a plan's coding agents need of the developer, posted by the agents and answered on the desktop.
 *
 * An item is one thing an agent cannot do or decide alone, kept on the
 * service as a row of its own rather than in the agent's transcript, so it
 * stands where the developer looks whatever the transcript has scrolled
 * past, and the agent can change it or take it back. The agent names each
 * item by a key of its own: posting under a key it used before replaces
 * that item, and reopens it where it was answered or closed, so an item is
 * kept current rather than posted twice. Each item is one of four kinds,
 * each answered its own way: a choice among the agent's options or in the
 * developer's own words, an approval or a decline of a step, an open
 * question, or a task the developer does by hand and marks done or not
 * possible. An item says whether the agent needs to hear back: where it
 * does, the answer reaches the agent as one of the developer's messages,
 * which steers its turn or opens one; where it does not, the answer is
 * kept and the agent reads it the next time it reads its inbox. Every item
 * carries a revision the agent's every change moves on, and an answer names
 * the revision it answers, so an answer to an item the agent has since
 * changed is refused rather than taken for the item as it now stands.
 *
 * The agent posts, closes, and reads its items through the tools named
 * below, whose inputs are declared here so the model is shown, eve holds,
 * and the desktop draws one shape. A plan's inbox is read past a cursor the
 * service hands back, held open while nothing changed, as a transcript is.
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added.
 */

export const INBOX_BOUNDS = {
  /** The most characters an item's key may spell: a short slug the agent chooses. */
  MAX_KEY_CHARS: 80,
  /** The most characters an item's title may spell: one line in the inbox. */
  MAX_TITLE_CHARS: 160,
  /** The most characters an item's details may spell: the context the developer needs, short Markdown rather than a report. */
  MAX_DETAILS_CHARS: 8_000,
  /** The most options a choice may offer: a choice a person makes at a glance. */
  MAX_OPTIONS: 6,
  /** The most characters an option's label may spell. */
  MAX_OPTION_CHARS: 160,
  /** The most characters an option's detail may spell: the trade-off in a sentence or two. */
  MAX_OPTION_DETAIL_CHARS: 600,
  /** The most characters the developer's note may spell. */
  MAX_NOTE_CHARS: 4_000,
  /** The most characters the agent's reason for closing an item may spell. */
  MAX_REASON_CHARS: 600,
  /** The most items one agent keeps open at once: what a person works through, never a log. */
  MAX_OPEN_PER_AGENT: 20,
  /** The most settled items a read of a plan's inbox carries beside every open one, the latest changed first. */
  MAX_ITEMS_READ: 200,
  /** The most settled items an agent's inbox tool answers with beside every open one: enough to hear what was answered lately. */
  MAX_SETTLED_TOLD: 20,
  /** The most characters a cursor may spell. */
  MAX_CURSOR_CHARS: 64,
  /** The most characters an answer's key may spell; a UUID is the usual. */
  MAX_CLIENT_KEY_CHARS: 128,
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

/** The shapes an item takes, each answered its own way. */
export const INBOX_KIND = {
  /** Pick one of the agent's options, one perhaps recommended, or answer in the developer's own words. */
  CHOICE: "choice",
  /** Approve or decline a step the agent proposes. */
  APPROVAL: "approval",
  /** An open answer in the developer's own words. */
  QUESTION: "question",
  /** Something the developer does by hand, such as a setting on GitHub, marked done or not possible. */
  TASK: "task",
} as const;

export type InboxKind = (typeof INBOX_KIND)[keyof typeof INBOX_KIND];

/** Where an item stands. */
export const INBOX_STATUS = {
  /** Waiting on the developer. */
  OPEN: "open",
  /** The developer answered it. */
  ANSWERED: "answered",
  /** The agent took it back. */
  CLOSED: "closed",
} as const;

export type InboxStatus = (typeof INBOX_STATUS)[keyof typeof INBOX_STATUS];

/** How the developer answered an item. */
export const INBOX_REPLY = {
  /** Picked one of a choice's options. */
  CHOSE: "chose",
  /** Approved an approval's step. */
  APPROVED: "approved",
  /** Declined an approval's step. */
  DECLINED: "declined",
  /** Answered in their own words: a question, or a choice none of whose options fit. */
  ANSWERED: "answered",
  /** Did a task. */
  DONE: "done",
  /** Could not, or would not, do a task. */
  NOT_DONE: "not-done",
} as const;

export type InboxReplyKind = (typeof INBOX_REPLY)[keyof typeof INBOX_REPLY];

/** The answers each kind of item takes. */
const INBOX_REPLIES_OF = {
  [INBOX_KIND.CHOICE]: [INBOX_REPLY.CHOSE, INBOX_REPLY.ANSWERED],
  [INBOX_KIND.APPROVAL]: [INBOX_REPLY.APPROVED, INBOX_REPLY.DECLINED],
  [INBOX_KIND.QUESTION]: [INBOX_REPLY.ANSWERED],
  [INBOX_KIND.TASK]: [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE],
} as const satisfies Record<InboxKind, readonly InboxReplyKind[]>;

function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
}

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** An item's key as the agent spells it: a short slug, the same each time it means the same item. */
export const inboxKeySchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_KEY_CHARS),
  EffectSchema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u),
);

/** One option of a choice: its label, and the trade-off in a sentence where the agent wrote one. */
export const inboxOptionSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_OPTION_CHARS),
  detail: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

export type InboxOption = typeof inboxOptionSchema.Type;

/**
 * What a post's tool part carries as its input: the item's key, its kind,
 * a title, the context in Markdown, a choice's options and the label it
 * recommends, and whether the agent needs to hear back, which it does
 * unless it says not. The model is shown this schema and eve holds the
 * call to it.
 */
export const inboxPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  kind: EffectSchema.Literals(Object.values(INBOX_KIND)),
  title: filledText(INBOX_BOUNDS.MAX_TITLE_CHARS),
  details: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_DETAILS_CHARS)),
  options: EffectSchema.optionalKey(
    EffectSchema.Array(inboxOptionSchema).check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS)),
  ),
  recommended: EffectSchema.optionalKey(EffectSchema.String),
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxPost = typeof inboxPostInputSchema.Type;

/** What a close's tool part carries as its input: the item's key, and why the agent takes it back. */
export const inboxCloseInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  reason: filledText(INBOX_BOUNDS.MAX_REASON_CHARS),
});

/** What a read's tool part carries as its input: nothing, since an agent reads its own items alone. */
export const inboxReadInputSchema = EffectSchema.Struct({});

/** The developer's answer: how they answered, the option where they picked one, and their note. */
export const inboxReplySchema = EffectSchema.Struct({
  reply: EffectSchema.Literals(Object.values(INBOX_REPLY)),
  choice: EffectSchema.optionalKey(EffectSchema.String),
  note: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_NOTE_CHARS)),
});

export type InboxReply = typeof inboxReplySchema.Type;

/** One item as the desktop reads it. */
export const inboxItemSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  key: EffectSchema.String,
  revision: countedNumber,
  kind: EffectSchema.Literals(Object.values(INBOX_KIND)),
  title: EffectSchema.String,
  details: EffectSchema.optionalKey(EffectSchema.String),
  options: EffectSchema.optionalKey(EffectSchema.Array(inboxOptionSchema)),
  recommended: EffectSchema.optionalKey(EffectSchema.String),
  needsReply: EffectSchema.Boolean,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  /** The developer's answer, on an answered item. */
  answer: EffectSchema.optionalKey(inboxReplySchema),
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
  ...inboxReplySchema.fields,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

export type InboxAnswerRequest = typeof inboxAnswerRequestSchema.Type;

/** What an answer comes back as: the item as it then stands, and whether the answer was taken, which it is not where the agent changed the item first. */
export const inboxAnsweredSchema = EffectSchema.Struct({
  item: inboxItemSchema,
  taken: EffectSchema.Boolean,
});

/** How the developer's answer opens, in the message that hands it to the agent. */
export const INBOX_ANSWER_LEAD = "Inbox answer";

/** The answer's own words, as the agent reads them. */
function replyWords(reply: InboxReply): string {
  switch (reply.reply) {
    case INBOX_REPLY.CHOSE:
      return `Chose "${reply.choice ?? ""}".`;
    case INBOX_REPLY.APPROVED:
      return "Approved.";
    case INBOX_REPLY.DECLINED:
      return "Declined.";
    case INBOX_REPLY.ANSWERED:
      return "Answered in their own words.";
    case INBOX_REPLY.DONE:
      return "Done.";
    case INBOX_REPLY.NOT_DONE:
      return "Not done.";
  }
}

/**
 * The message an answer reaches the agent as: a first line naming the item
 * by its key and title with what the developer did, then their note. Note
 * that the title is put on one line, because the line is read whole.
 */
export function inboxAnswerMessage(
  item: Pick<InboxItem, "key" | "title">,
  reply: InboxReply,
): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_ANSWER_LEAD} on "${title}" (key ${item.key}): ${replyWords(reply)}`;
  const note = reply.note?.trim();
  return note ? `${header}\n\n${note}` : header;
}

/** Why an answer does not fit its item, or nothing where it does: the kind takes it, a choice names one of the options, and words stand where the answer is the developer's own. */
export function inboxReplyRefusal(
  item: Pick<InboxItem, "kind" | "options">,
  reply: InboxReply,
): string | undefined {
  const takes: readonly InboxReplyKind[] = INBOX_REPLIES_OF[item.kind];
  if (!takes.includes(reply.reply)) return "The item does not take that answer.";
  if (reply.reply === INBOX_REPLY.CHOSE) {
    const offered = (item.options ?? []).some((option) => option.label === reply.choice);
    if (!offered) return "The choice names no option of the item.";
  }
  if (reply.reply === INBOX_REPLY.ANSWERED && (reply.note ?? "").trim() === "") {
    return "An answer in the developer's own words needs words.";
  }
  return undefined;
}
