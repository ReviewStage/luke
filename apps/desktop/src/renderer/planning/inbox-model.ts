import {
  INBOX_KIND,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
  type InboxReply,
  type InboxReplyKind,
  inboxReplyRefusal,
} from "@sidecar/hosted/inbox-wire";

/**
 * inbox-model.ts -- the plan's Inbox tab as pure decisions: which items wait on the developer and which are settled, what a card's answer is, and how a settled one reads.
 *
 * What waits stands first, the oldest posted first, since it has held its
 * agent longest; what is settled, answered or taken back by its agent,
 * follows, the latest changed first. Every item the plan's inbox holds is
 * drawn, whether or not the window's list of agents has caught up with the
 * agent that posted it, since the service reads the inbox by plan and an
 * agent's items go with it. A card's answer is held to the same rule the service holds it to
 * (`inbox-wire.ts`'s `inboxReplyRefusal`), so a press the service would
 * refuse is never offered. Nothing here draws.
 */

/** What the developer has put on a card so far: the option picked on a choice, and their note. */
export interface InboxDraft {
  readonly choice: string | undefined;
  readonly note: string;
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { choice: undefined, note: "" };

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The plan's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first. */
export function inboxBoard(items: readonly InboxItem[]): InboxBoardView {
  return {
    open: items
      .filter((item) => item.status === INBOX_STATUS.OPEN)
      .toSorted((a, b) => a.postedAt - b.postedAt),
    settled: items
      .filter((item) => item.status !== INBOX_STATUS.OPEN)
      .toSorted((a, b) => b.updatedAt - a.updatedAt),
  };
}

/** The answer's kind for what the card holds: a press where the kind is answered by one, else the option picked or the developer's words. */
function replyKindOf(
  item: InboxItem,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  if (item.kind === INBOX_KIND.CHOICE && draft.choice !== undefined) return INBOX_REPLY.CHOSE;
  return draft.note.trim() === "" ? undefined : INBOX_REPLY.ANSWERED;
}

/**
 * The answer the card holds, or nothing where it holds none the item
 * takes: a choice is answered by its option, with the note beside it, or
 * by the developer's own words; an approval and a task by their presses,
 * with the note beside them; a question by words.
 */
export function inboxReply(
  item: InboxItem,
  draft: InboxDraft,
  press?: InboxReplyKind,
): InboxReply | undefined {
  const reply = replyKindOf(item, draft, press);
  if (reply === undefined) return undefined;
  const note = draft.note.trim();
  const answer: InboxReply = {
    reply,
    ...(reply === INBOX_REPLY.CHOSE && draft.choice !== undefined
      ? { choice: draft.choice }
      : undefined),
    ...(note === "" ? undefined : { note }),
  };
  return inboxReplyRefusal(item, answer) === undefined ? answer : undefined;
}

/** What each answer's kind says on a settled card. */
const REPLY_WORDS = {
  [INBOX_REPLY.CHOSE]: "Chose",
  [INBOX_REPLY.APPROVED]: "Approved",
  [INBOX_REPLY.DECLINED]: "Declined",
  [INBOX_REPLY.ANSWERED]: "Answered",
  [INBOX_REPLY.DONE]: "Done",
  [INBOX_REPLY.NOT_DONE]: "Not done",
} as const satisfies Record<InboxReplyKind, string>;

/** What a settled card says of what came of it: a lead in strong words, and the note after it where there is one. */
interface SettledWords {
  readonly lead: string;
  readonly note?: string;
}

/** How a settled card says what came of it: the answer and its note, or why the agent took it back. */
export function settledWords(item: InboxItem): SettledWords {
  if (item.status === INBOX_STATUS.CLOSED) {
    return {
      lead: "Closed by the agent",
      ...(item.closedReason === undefined ? undefined : { note: item.closedReason }),
    };
  }
  const answer = item.answer;
  if (answer === undefined) return { lead: REPLY_WORDS[INBOX_REPLY.ANSWERED] };
  const lead =
    answer.reply === INBOX_REPLY.CHOSE
      ? `${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${answer.choice ?? ""}`
      : REPLY_WORDS[answer.reply];
  return { lead, ...(answer.note === undefined ? undefined : { note: answer.note }) };
}
