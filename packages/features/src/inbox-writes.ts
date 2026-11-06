import {
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
} from "./inbox-wire.js";

export interface InboxReader {
  readonly userId: string;
  readonly name: string;
}

function openAskId(item: InboxItem): string | undefined {
  return item.thread?.findLast((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN)?.id;
}

export function asksOpen(item: InboxItem, askId: string): boolean {
  return (item.thread ?? []).some(
    (message) => message.id === askId && message.ask?.status === INBOX_ASK_STATUS.OPEN,
  );
}

type SettledStanding =
  | { readonly status: typeof INBOX_ASK_STATUS.ANSWERED }
  | { readonly status: typeof INBOX_ASK_STATUS.WITHDRAWN; readonly withdrawnAt: number };

function settledThread(
  thread: readonly InboxMessage[],
  askId: string,
  standing: SettledStanding,
  after: readonly InboxMessage[],
): readonly InboxMessage[] {
  const settled = thread.map((message) =>
    message.id === askId && message.ask !== undefined
      ? { ...message, ask: { ...message.ask, ...standing } }
      : message,
  );
  return [...settled, ...after];
}

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
  const thread = settledThread(
    item.thread ?? [],
    sent.answers.ask,
    { status: INBOX_ASK_STATUS.ANSWERED },
    [reply],
  );
  return { ...acknowledgedNow(item, reader, now), thread };
}

export function closedNow(
  item: InboxItem,
  reader: InboxReader | undefined,
  now: number,
): InboxItem {
  const askId = openAskId(item);
  const thread =
    item.thread === undefined || askId === undefined
      ? undefined
      : settledThread(
          item.thread,
          askId,
          { status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnAt: now },
          [],
        );
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
