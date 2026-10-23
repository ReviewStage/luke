import {
  CHANNEL_KIND,
  CHAT_ASK,
  type ChatAnswer,
  type ChatMessage,
  type ChatReply,
  type ChatResponse,
} from "@luke/features/chat-wire";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK_STATUS,
  INBOX_REPLY,
  type InboxAnswers,
  type InboxAsk,
  type InboxReplyKind,
  inboxReplyAnswers,
} from "@luke/features/inbox-wire";
import {
  askNumberedPick,
  doDecision,
  type InboxDraft,
  type InboxMissing,
  inboxMissing,
  inboxReply,
} from "./inbox-model.js";

/**
 * chat-ask-model.ts -- a chat ask read as the Inbox's ask: the answer its controls hold, what that answer lacks, and whom it waits on.
 *
 * A chat ask carries the Inbox's version 4 response, which the chat's wire
 * keeps (`chat-wire.ts`), while the Inbox draws its asks as version 5's
 * `decide`, `do`, and `answer`. The card draws a chat ask as the ask its
 * response stands for (`inbox-wire.ts`'s `inboxResponseAsk`): a choice as a
 * `decide` of its options, an approval as a `decide` between Approve and
 * Decline, a task as a `do` naming no step, a form as an `answer` of its
 * fields, and words as an `answer` of none; an acknowledgement asks
 * nothing, and is nodded to. What the controls hold is read back as the
 * version 4 answer the chat's wire takes, held to the rule the service holds
 * it to (`inbox-model.ts`'s `inboxReply`), and an answer given is read as
 * the version 5 answer its controls draw (`inboxReplyAnswers`). Nothing
 * here draws.
 */

/** The version 4 decision an approval's pick stands for, by the option picked. */
const APPROVAL_REPLY: ReadonlyMap<string, InboxReplyKind> = new Map([
  [INBOX_APPROVAL_OPTION.APPROVE, INBOX_REPLY.APPROVED],
  [INBOX_APPROVAL_OPTION.DECLINE, INBOX_REPLY.DECLINED],
]);

/** A task as its `do` stands for it: no step of its own. */
const NO_STEPS = { steps: [] } as const;

/**
 * The draft as the version 4 response reads one: an approval's pick and a
 * task's press held as the card's one pick, by the decision's kind, as the
 * Inbox's older cards held them (`decidedOf`); the rest as they are.
 */
function respondedDraft(response: ChatResponse, draft: InboxDraft): InboxDraft {
  const decision = (() => {
    switch (response.type) {
      case CHAT_ASK.APPROVAL:
        return { held: APPROVAL_REPLY.get(draft.choices[0] ?? "") };
      case CHAT_ASK.TASK:
        return { held: doDecision(NO_STEPS, draft) };
      default:
        return undefined;
    }
  })();
  if (decision === undefined) return draft;
  return { ...draft, choices: decision.held === undefined ? [] : [decision.held] };
}

/** The answer the card's controls and note hold, or none where they hold none the ask takes. */
export function chatAskReply(response: ChatResponse, draft: InboxDraft): ChatReply | undefined {
  return inboxReply({ response }, respondedDraft(response, draft));
}

/** What the card's answer still lacks, the first thing in the ask's order, or nothing where it lacks nothing it can be told to fill. */
export function chatAskMissing(
  response: ChatResponse,
  draft: InboxDraft,
): InboxMissing | undefined {
  return inboxMissing({ response }, respondedDraft(response, draft));
}

/** Whether the card holds anything at all, a pick, a press, a tick, a field filled, or words, which lights its Send. */
export function chatAskHolds(draft: InboxDraft): boolean {
  return (
    draft.choices.length > 0 ||
    draft.values.length > 0 ||
    (draft.steps ?? []).length > 0 ||
    draft.press !== undefined ||
    draft.note.trim() !== ""
  );
}

/** The draft after the option numbered `number`, counted from one, is picked by its key; none where the ask has no such option. */
export function chatNumberedPick(
  ask: InboxAsk,
  draft: InboxDraft,
  number: number,
): InboxDraft | undefined {
  return askNumberedPick({ ...ask, status: INBOX_ASK_STATUS.OPEN }, draft, number);
}

/** An answer given as the ask it answered draws it, by the message that asked; none for an acknowledgement, which answers no ask. */
export function chatAnswers(
  message: ChatMessage,
  ask: InboxAsk,
  reply: ChatReply,
): InboxAnswers | undefined {
  return inboxReplyAnswers({ id: message.id, ask }, reply);
}

/**
 * Whom an ask waits on, by member: in a direct message, the other of its
 * two; elsewhere, the members its message mentions; never its poster. None
 * where it names no one, as any member of its channel may answer it.
 */
export function chatAskWaitsOn(chat: ChatAnswer, message: ChatMessage): readonly string[] {
  const channel = chat.channels.find((each) => each.id === message.channelId);
  const named = channel?.kind === CHANNEL_KIND.DM ? (channel.members ?? []) : message.mentions;
  return named.filter((memberId) => memberId !== message.authorId);
}

/**
 * When an answered ask was answered: when the reply its answer posted in
 * its thread landed, the ask moving to that reply's place, else the latest
 * reply its answerer left there; none where the read carries neither.
 */
export function chatAnsweredAt(chat: ChatAnswer, message: ChatMessage): number | undefined {
  const answeredBy = message.ask?.answeredBy;
  if (answeredBy === undefined) return undefined;
  const root = message.parentId ?? message.id;
  const replies = chat.messages
    .filter((each) => each.parentId === root && each.authorId === answeredBy)
    .toSorted((one, other) => one.seq - other.seq);
  const reply = replies.find((each) => each.seq === message.touchedSeq) ?? replies.at(-1);
  return reply?.postedAt;
}
