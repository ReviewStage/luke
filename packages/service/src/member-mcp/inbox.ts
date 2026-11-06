import { randomUUID } from "node:crypto";
import { storeWriter } from "@repo/database/models/writer";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxMessage,
  inboxWaitsOn,
  openAskOf,
  threadNeedsReader,
} from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf, mentionMarkdownLink } from "@repo/features/link-grammar";
import { Effect } from "effect";
import { agentToolRejected, orStoreRefusal } from "../agents/agent-tools.js";
import {
  type AgentAskLine,
  answersLineOf,
  askLineOf,
  settledMessages,
} from "../agents/coder-host/inbox.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { workspaceStepOf } from "../agents/written-mentions.js";
import { ACTION_RESULT_STATUS, HOSTED_API_ERROR, type WireRecord } from "../core.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { answerAsMember, closeAsMember, messageAsMember } from "../inbox/inbox-procedures.js";
import { INBOX_ASK_ANSWER, workspaceInboxItems } from "../inbox/inbox-store.js";

export const MEMBER_INBOX_TOOL = {
  READ: "read_inbox",
  ANSWER: "answer_ask",
  REPLY: "reply_to_thread",
  CLOSE: "close_thread",
} as const;

const MEMBER_INBOX_REFUSAL = {
  NO_THREAD: `Not done: the member reaches no such thread, or its agent no longer stands to hear it; ${MEMBER_INBOX_TOOL.READ} names their threads.`,
  NOT_OPEN: `Not answered: that ask no longer stands open, since it was answered, replaced by a newer ask, or withdrawn; ${MEMBER_INBOX_TOOL.READ} reads the thread as it stands.`,
  NOT_FITTING: (why: string) => `Not answered: ${why}`,
  MOVED: `Not closed: the thread's agent changed it since that revision, or it was answered or closed already; ${MEMBER_INBOX_TOOL.READ} reads it as it stands.`,
  NOT_PERMITTED:
    "Not done: the thread's agent runs on its starter's own GitHub token or plan, so only its starter's words reach it.",
  UNTOLD:
    "Not done: it could not be handed to the thread's agent just now, so nothing was kept; try again in a moment.",
} as const;

const WRITER = storeWriter({ tools: CODER_TOOL_SET });

const THREAD_ORDER = {
  NEEDS_MEMBER: 0,
  ASKING: 1,
  NOTICE: 2,
  SETTLED: 3,
} as const;

type ThreadOrder = (typeof THREAD_ORDER)[keyof typeof THREAD_ORDER];

type MemberThreadLine = {
  readonly from: string;
  readonly text: string;
  readonly files?: readonly string[];
  readonly ask?: AgentAskLine;
  readonly answers?: Omit<InboxAnswers, "ask">;
};

function writerOf(message: InboxMessage, userId: string): string {
  if (message.author === INBOX_MESSAGE_AUTHOR.AGENT) return "agent";
  if (message.member === undefined) return "a former member";
  return message.member.userId === userId ? "you" : message.member.name;
}

function threadLineOf(message: InboxMessage, userId: string): MemberThreadLine {
  return {
    from: writerOf(message, userId),
    text: message.text,
    ...(message.files === undefined
      ? undefined
      : { files: message.files.map((file) => file.name) }),
    ...(message.ask === undefined ? undefined : { ask: askLineOf(message.ask) }),
    ...(message.answers === undefined ? undefined : { answers: answersLineOf(message.answers) }),
  };
}

function orderOf(item: InboxItem, userId: string): ThreadOrder {
  if (item.status !== INBOX_STATUS.OPEN) return THREAD_ORDER.SETTLED;
  if (threadNeedsReader(item, userId)) return THREAD_ORDER.NEEDS_MEMBER;
  return openAskOf(item.thread ?? []) === undefined ? THREAD_ORDER.NOTICE : THREAD_ORDER.ASKING;
}

function threadOf(item: InboxItem, userId: string): WireRecord {
  const messages = item.thread ?? [];
  const open = item.status === INBOX_STATUS.OPEN;
  const told = open ? messages : settledMessages(messages);
  const earlier = messages.length - told.length;
  const waitsOn = inboxWaitsOn(item);
  const asking = open ? openAskOf(messages) : undefined;
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    revision: item.revision,
    agentId: item.agentId,
    waitsOn: waitsOn?.name ?? null,
    waitsOnMember: waitsOn?.userId === userId,
    unread: item.unread === true,
    ...(asking === undefined ? undefined : { askId: asking.message.id }),
    ...(earlier > 0 ? { earlier } : undefined),
    thread: told.map((message) => threadLineOf(message, userId)),
    ...(item.answeredBy === undefined ? undefined : { answeredBy: item.answeredBy.name }),
    ...(item.closedBy === undefined ? undefined : { closedBy: item.closedBy.name }),
    ...(item.closedReason === undefined ? undefined : { closedReason: item.closedReason }),
  };
}

function accepted(item: InboxItem, userId: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.ACCEPTED, thread: threadOf(item, userId) };
}

function refusedAs(refusal: HostedRefusal): WireRecord {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.NO_THREAD);
    case HOSTED_API_ERROR.NOT_PERMITTED:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_PERMITTED);
    default:
      return agentToolRejected(MEMBER_INBOX_REFUSAL.UNTOLD);
  }
}

export function readMemberInbox(userId: string, workspaceId: string) {
  return orStoreRefusal(
    Effect.zipWith(
      workspaceInboxItems(userId, workspaceId),
      workspaceStepOf(userId, workspaceId),
      (items, step) => {
        const orders = Object.values(THREAD_ORDER);
        const threads = orders.flatMap((order) =>
          items
            .filter((item) => orderOf(item, userId) === order)
            .map((item) => ({
              ...threadOf(item, userId),
              mention: mentionMarkdownLink(
                item.title,
                linkOf({ kind: LINK_PLACE.INBOX_ITEM, itemId: item.id }, step),
              ),
            })),
        );
        return { threads };
      },
      { concurrent: true },
    ),
  );
}

export function answerAskAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly note: string; readonly answers: InboxAnswers },
) {
  const sent = {
    text: asked.note,
    clientKey: randomUUID(),
    attachments: [],
    answers: asked.answers,
  };
  return answerAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map((answered) => {
      if (answered.outcome === INBOX_ASK_ANSWER.NOT_OPEN) {
        return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_OPEN);
      }
      if (answered.outcome === INBOX_ASK_ANSWER.REFUSED) {
        return agentToolRejected(MEMBER_INBOX_REFUSAL.NOT_FITTING(answered.refusal ?? ""));
      }
      return accepted(answered.item, userId);
    }),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}

export function replyAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly text: string },
) {
  const sent = { text: asked.text, clientKey: randomUUID(), attachments: [] };
  return messageAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map(({ item }) => accepted(item, userId)),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}

export function closeThreadAsMember(
  userId: string,
  asked: { readonly threadId: string; readonly revision: number },
) {
  const sent = { revision: asked.revision, clientKey: randomUUID() };
  return closeAsMember(WRITER, userId, asked.threadId, sent).pipe(
    Effect.map(({ item, taken }) =>
      taken ? accepted(item, userId) : agentToolRejected(MEMBER_INBOX_REFUSAL.MOVED),
    ),
    Effect.catch((refusal) => Effect.succeed(refusedAs(refusal))),
  );
}
