/**
 * inbox-procedures.ts -- what an agent posted for the developer, read, answered, messaged, and marked read.
 *
 * The inbox resource of the hosted oRPC router (`@luke/features/contract`'s
 * `inbox.ts`), each procedure answering the bytes its old `HttpRouter`
 * endpoint answered. The caller is resolved on the resource's implementer,
 * so an unsigned request is refused before its input is read; a procedure
 * that takes a body caps it there too, at the bound the old endpoint read
 * it under, before its shape is checked.
 *
 * The three reads, a task's, an agent's, and the account's, are held while
 * nothing changed since the reader's cursor, by the holds they always had
 * (`agents/coder-host/inbox-page.ts`), and answer as one JSON body when the
 * inbox moves or the hold ends. An item's attachment is bytes, not JSON, and
 * stays on the agents' group (`agents/coding-agents-app.ts`).
 */

import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { readTask } from "@luke/database/models/task-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { ACCOUNT_INBOX_ARCHIVED } from "@luke/features/account-inbox-wire";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxReply,
  inboxAnswerHeard,
  inboxAnswerMessage,
  inboxAnswersReply,
  inboxClosedMessage,
  inboxReplyRefusal,
  inboxThreadMessage,
} from "@luke/features/inbox-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import type { AccountResolving } from "../agents/agent-reach.js";
import type { EveTypedTurn } from "../agents/brain-host/eve-sessions.js";
import {
  accountInboxPast,
  agentInboxPast,
  taskInboxPast,
} from "../agents/coder-host/inbox-page.js";
import { steerCodingAgent } from "../agents/coder-host/steer.js";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  answerInboxAsk,
  answerInboxItem,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_MESSAGE_OUTCOME,
  inboxItemArchived,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxMessage,
  readInboxItem,
  type StoredInboxItem,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
} from "./inbox-store.js";

/** What the inbox asks of the deployment: who the caller is, and how eve is reached to hand an answer or a message to an agent. */
export type InboxProcedureSeams = AccountResolving & EveReach;

/** The id a path named, where it is a UUID; any other names no row, and is not found. */
const rowIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** Whether a hand-off was refused because the agent's session has ended for good, so no message will ever reach it. */
function retiredRefusal(refusal: HostedRefusal): boolean {
  return refusal.error === HOSTED_REFUSAL.AGENT_RETIRED.error;
}

/**
 * The item with the answer standing on it under the request's key: taken
 * now where the item is open at the revision named and takes the answer,
 * or as an earlier send under the same key took it; nothing where it was
 * not taken. Refused where the answer does not fit the item.
 */
const takenAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredInboxItem,
  asked: {
    readonly revision: number;
    readonly clientKey: string;
    readonly reply: InboxReply;
    readonly attachments: readonly CodingAgentAttachment[];
  },
) {
  const { item, answerKey } = stored;
  if (answerKey === asked.clientKey) return item;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (inboxReplyRefusal(item, asked.reply, asked.attachments) !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxItem(
      userId,
      item.id,
      asked.revision,
      asked.reply,
      asked.clientKey,
      asked.attachments,
    ),
  );
  return Option.getOrUndefined<InboxItem>(answered);
});

/**
 * Answers one item of a task of the account's workspaces, whichever
 * member started its agent. An answer naming a revision the agent has
 * since moved on from, or an item no longer open, is answered with the
 * item as it stands and not taken. Otherwise the answer is taken first, at
 * the revision it names, with the files it carries kept as the item's, and
 * only then, where the item asks to be heard back or the developer typed a
 * note or attached a file, handed to the agent as one of the developer's
 * messages, its files with it, under the answer's own key through the one
 * steer path (`coder-host/steer.ts`), so an answer the item no longer takes
 * never reaches the agent. A hand-off that fails, is interrupted, or dies
 * takes the answer back, so an item never reads answered while the agent
 * was not told; and an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once,
 * so a hand-off cut short by the function's own end is finished by the
 * retry rather than reported done. An agent whose session has ended for
 * good can hear nothing again, so its item keeps the answer rather than
 * waiting on the developer for ever.
 */
const answered = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: InboxProcedureSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  asked: {
    readonly revision: number;
    readonly clientKey: string;
    readonly reply: InboxReply;
    readonly attachments: readonly CodingAgentAttachment[];
  },
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // An item put away with its task is read but not answered, whether or not its agent would hear it, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const { clientKey, attachments } = asked;
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    stored.value.answerKey === clientKey
      ? Effect.void
      : recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {});
  const taken = yield* takenAnswer(userId, stored.value, asked);
  if (taken === undefined) {
    // Not taken: the item moved on, or another answer settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { item: now.value.item, taken: now.value.answerKey === clientKey };
  }
  if (taken.answer === undefined || !inboxAnswerHeard(taken, taken.answer, taken.answerFiles)) {
    yield* counted;
    return { item: taken, taken: true };
  }
  const answer = taken.answer;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(taken, answer),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxAnswer(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return { item: taken, taken: true };
});

/**
 * A member's reply that answers the thread's open ask, as the window sends
 * one from version 5: the answer taken first, with the reply's words and
 * files, as the member's message that carries it (`answerInboxAsk`), and
 * then, by the rule an answer by revision follows (`inboxAnswerHeard`),
 * handed to the agent under the answer's own lead, its files with it, under
 * the reply's key through the one steer path; otherwise kept for the agent
 * to read in its own time. An item put away with its task is not answered.
 * An answer to an ask the thread no longer holds open, to another message,
 * or one the ask does not take is refused, as a message's request is. A
 * hand-off that fails, is interrupted, or dies takes the answer back, as
 * one by revision does, so the thread never reads answered while the agent
 * was not told; an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once.
 * An agent whose session has ended for good can hear nothing again, so its
 * item keeps the answer. It answers as a plain reply does: the item as it
 * then stands.
 */
const answeredByReply = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: InboxProcedureSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  sent: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly CodingAgentAttachment[];
    readonly answers: InboxAnswers;
  },
) {
  const { text, clientKey, attachments, answers } = sent;
  // An item put away with its task is read but not answered, as an answer by revision is not, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxAsk(userId, itemId, { answers, text, clientKey, files: attachments }),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = answered.value;
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    outcome === INBOX_ASK_ANSWER.TAKEN
      ? recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {})
      : Effect.void;
  const reply = inboxAnswersReply(answers, text);
  if (!inboxAnswerHeard(item, reply, attachments)) {
    yield* counted;
    return { item };
  }
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(item, reply),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxAnswer(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return { item };
});

/**
 * Closes one open item of a task of the account's workspaces without an
 * answer, whichever member started its agent, at the revision the member
 * was shown, and answers as an answer does: the item as it then stands, and
 * whether the close was taken, which it is not where the agent changed the
 * item first or it was settled already. A close taken is handed to the
 * agent, under its own lead, only where the item asks to be heard back, so
 * an agent waiting on it is not left waiting; otherwise the agent reads it
 * the next time it reads its inbox. A hand-off that fails, is interrupted,
 * or dies opens the item again, so it never reads closed while an agent
 * waiting on it was not told; a close sent again under the key it was taken
 * by is handed off again, which the steer's own key makes reach the agent
 * once. An agent whose session has ended for good can hear nothing again,
 * so its item stays closed.
 */
const closed = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: InboxProcedureSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  asked: { readonly revision: number; readonly clientKey: string },
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // An item put away with its task is read but not closed, as it is not answered, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const { revision, clientKey } = asked;
  const { item, answerKey } = stored.value;
  // A close sent again is the one taken only while the item still stands as that close left it, never once its agent moved it on.
  const retried =
    answerKey === clientKey &&
    item.status === INBOX_STATUS.CLOSED &&
    item.closedReason === undefined &&
    item.revision === revision;
  const taken = retried
    ? item
    : item.status !== INBOX_STATUS.OPEN || item.revision !== revision
      ? undefined
      : Option.getOrUndefined(
          yield* hostedStoreOrUnavailable(
            closeInboxItemAsMember(userId, itemId, revision, clientKey),
          ),
        );
  if (taken === undefined) {
    // Not taken: the item moved on, or an answer or a close settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { item: now.value.item, taken: false };
  }
  if (!taken.needsReply) return { item: taken, taken: true };
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxClosedMessage(taken),
      attachments: [],
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxClose(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  return { item: taken, taken: true };
});

/**
 * Writes a member's message on the thread of one item of the account's
 * workspaces, open or settled, whichever member started its agent, and
 * answers with the item as it then stands. The message is written first,
 * with its files, moving the item's last change and nothing else of it,
 * and then handed to the agent as one of the developer's messages, under
 * its own lead and its files with it, through the one steer path
 * (`coder-host/steer.ts`), which opens a turn for an agent that stopped as
 * a message typed in its tab does. A hand-off that fails, is interrupted,
 * or dies takes the message back off the thread, so the thread never shows
 * a message the agent was not told, where this send wrote it; a message
 * sent again under its key is the one already written and handed off
 * again, which the steer's own key makes reach the agent once, and another
 * message under a key already taken, by another member or with other words
 * or files, is refused. An agent whose session has ended for good can hear
 * nothing again, so its item keeps the message. A message that carries the
 * answer to the thread's open ask is the reply that answers it, as
 * `answeredByReply` takes one; one without is a plain reply, which never
 * answers, even while an ask stands open.
 */
const messaged = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: InboxProcedureSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  asked: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly CodingAgentAttachment[];
    readonly answers?: InboxAnswers | undefined;
  },
) {
  const { text, clientKey, attachments, answers } = asked;
  if (answers !== undefined) {
    return yield* answeredByReply(seams, writer, request, userId, itemId, {
      text,
      clientKey,
      attachments,
      answers,
    });
  }
  const posted = yield* hostedStoreOrUnavailable(
    postInboxMessage(userId, itemId, { text, clientKey, files: attachments }),
  );
  if (Option.isNone(posted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = posted.value;
  if (outcome === INBOX_MESSAGE_OUTCOME.KEY_REUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // Note that a repeat leaves the message standing on failure, because the write that wrote it decides whether it stays.
  const unheard =
    outcome === INBOX_MESSAGE_OUTCOME.WRITTEN
      ? withdrawInboxMessage(userId, itemId, clientKey)
      : Effect.void;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxThreadMessage(item, text),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() => unheard.pipe(Effect.tapError(logStoreFailure), Effect.ignore)),
  );
  return { item };
});

/**
 * The inbox resource, to a signed-in caller: the three held reads, an
 * item answered or closed without an answer, a message on its thread, and the member's own read state,
 * which no other member's moves. Marking an item read is what opening it
 * does and writes nothing where it stands read already; marking it unread
 * holds until they read it again; each answers the item's id and its read
 * state, and an item of a workspace the account is not in is not found.
 * Marking every item read marks every item their Inbox lists, in the
 * workspace the body names or in all of theirs, and answers how many were
 * unread.
 */
export function inboxProcedures(seams: InboxProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  const signedIn = hosted.inbox.use(accountMiddleware(seams.resolveUserId));
  return {
    account: signedIn.account.effect(function* ({ input, context }) {
      const after = input.after ?? INBOX_CURSOR_START;
      const archived = input.archived === ACCOUNT_INBOX_ARCHIVED.INCLUDE;
      return yield* hostedStoreOrUnavailable(accountInboxPast(context.userId, after, { archived }));
    }),
    task: signedIn.task.effect(function* ({ input, context }) {
      const taskId = yield* rowIdOf(input.id);
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const after = input.after ?? INBOX_CURSOR_START;
      return yield* hostedStoreOrUnavailable(taskInboxPast(context.userId, taskId, after));
    }),
    agent: signedIn.agent.effect(function* ({ input, context }) {
      const agentId = yield* rowIdOf(input.id);
      const agent = yield* hostedStoreOrUnavailable(readCodingAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const after = input.after ?? INBOX_CURSOR_START;
      return yield* hostedStoreOrUnavailable(agentInboxPast(context.userId, agent.value.id, after));
    }),
    answer: hosted.inbox.use(accountMiddleware(seams.resolveUserId)).answer.effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* rowIdOf(input.params.id);
      const { revision, clientKey, attachments = [], ...reply } = input.body;
      return yield* answered(seams, writer, context.request, context.userId, itemId, {
        revision,
        clientKey,
        reply,
        attachments,
      });
    }),
    message: hosted.inbox.use(accountMiddleware(seams.resolveUserId)).message.effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* rowIdOf(input.params.id);
      const { text, clientKey, attachments = [], answers } = input.body;
      return yield* messaged(seams, writer, context.request, context.userId, itemId, {
        text,
        clientKey,
        attachments,
        answers,
      });
    }),
    close: hosted.inbox.use(accountMiddleware(seams.resolveUserId)).close.effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* rowIdOf(input.params.id);
      return yield* closed(seams, writer, context.request, context.userId, itemId, input.body);
    }),
    markItemRead: signedIn.markItemRead.effect(function* ({ input, context }) {
      const itemId = yield* rowIdOf(input.id);
      const found = yield* hostedStoreOrUnavailable(markInboxItemRead(context.userId, itemId));
      if (!found) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { id: itemId, unread: false };
    }),
    markItemUnread: signedIn.markItemUnread.effect(function* ({ input, context }) {
      const itemId = yield* rowIdOf(input.id);
      const found = yield* hostedStoreOrUnavailable(markInboxItemUnread(context.userId, itemId));
      if (!found) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { id: itemId, unread: true };
    }),
    markAllRead: hosted.inbox
      .use(accountMiddleware(seams.resolveUserId))
      .markAllRead.effect(function* ({ input, context }) {
        const marked = yield* hostedStoreOrUnavailable(
          markInboxRead(context.userId, input.workspaceId),
        );
        return { marked };
      }),
  };
}
