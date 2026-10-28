/**
 * inbox-writes.ts -- what a member's nod, answer, or close leaves an inbox item as, so the host draws the write before the service answers it.
 *
 * Every function is pure over the item as a read holds it, and answers it
 * as the service will once it has taken the write: settled by the reader,
 * now, and read, its thread's open ask answered or withdrawn.
 */

import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";

/** The member signed in, as an answer or a close names who gave it; none where the account names no id. */
export interface InboxReader {
  readonly userId: string;
  readonly name: string;
}

/** The thread's open ask's message, by id; none where its thread holds no open ask, as a notice's. */
function openAskId(item: InboxItem): string | undefined {
  return item.thread?.findLast((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id;
}

/** The thread with the ask on the message given settled as `status` says, and the messages given after it. */
function settledThread(
  thread: readonly InboxMessage[],
  askId: string,
  status: typeof INBOX_ASK_STATUS.ANSWERED | typeof INBOX_ASK_STATUS.WITHDRAWN,
  after: readonly InboxMessage[],
): readonly InboxMessage[] {
  const settled = thread.map((message) =>
    message.id === askId && message.ask !== undefined
      ? { ...message, ask: { ...message.ask, status } }
      : message,
  );
  return [...settled, ...after];
}

/**
 * The item as the reader nodded to it with Got it, before the service says
 * how it stands: answered by the reader, now, and read, as the service
 * answers it, its thread as it was, since a nod writes no message.
 */
export function acknowledgedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  return {
    ...item,
    status: INBOX_STATUS.ANSWERED,
    ...(reader === undefined ? undefined : { answeredBy: reader }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}

/**
 * The item as the reader answered it, before the service says how it
 * stands: as a nod leaves it (`acknowledgedNow`), and its open ask answered
 * and the reply carrying the answer after it, under the reply's own key
 * until the service names the message. Note that the files the reply
 * carried are not drawn until then, since the service names them.
 */
export function answeredNow(
  item: InboxItem,
  sent: { readonly key: string; readonly text: string; readonly answers: InboxAnswers },
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const reply: InboxMessage = {
    id: sent.key,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...(reader === undefined ? undefined : { member: reader }),
    text: sent.text,
    answers: sent.answers,
    createdAt: now,
  };
  const thread = settledThread(item.thread ?? [], sent.answers.ask, INBOX_ASK_STATUS.ANSWERED, [
    reply,
  ]);
  return { ...acknowledgedNow(item, reader, now), thread };
}

/** The item as the reader closed it without an answer, before the service says how it stands: closed by the reader, now, and read, its thread's open ask withdrawn with no reason. */
export function closedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const askId = openAskId(item);
  const thread =
    item.thread === undefined || askId === undefined
      ? undefined
      : settledThread(item.thread, askId, INBOX_ASK_STATUS.WITHDRAWN, []);
  return {
    ...item,
    status: INBOX_STATUS.CLOSED,
    ...(reader === undefined ? undefined : { closedBy: reader }),
    ...(thread === undefined ? undefined : { thread }),
    settledAt: now,
    updatedAt: Math.max(item.updatedAt, now),
    unread: false,
  };
}
