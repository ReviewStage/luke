/**
 * inbox-procedures.ts -- what an agent posted for the developer, read, answered, messaged, and marked read, and a thread a member starts.
 *
 * The inbox resource of the hosted oRPC router (`@repo/features/contract`'s
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
 * stays on the agents' group (`agents/agents-app.ts`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  readAgent,
  readVisibleAgent,
  readVisibleAgentWorkspace,
} from "@repo/database/models/agent-store";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { type StoreWriter, storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import type { AgentAttachment } from "@repo/features/agent-wire";
import {
  INBOX_ASK_STATUS,
  INBOX_CURSOR_START,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxRemindRequest,
  type InboxReply,
  inboxAnswerHeard,
  inboxAnswerMessage,
  inboxAnswersReply,
  inboxClosedMessage,
  inboxStartTitle,
  inboxThreadMessage,
  inboxTodoTicks,
} from "@repo/features/inbox-wire";
import { MESSAGE_CHANNEL, THREAD_LINE_EVENT, type ThreadLineMetadata } from "@repo/wire";
import type { LanguageModel } from "ai";
import { Effect, Option } from "effect";
import { type AccountResolving, controlsAgent } from "../agents/agent-reach.js";
import {
  accountInboxPast,
  agentInboxPast,
  taskInboxPast,
} from "../agents/coder-host/inbox-page.js";
import { deploymentTitleModel } from "../agents/coder-host/model.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { agentTakingMessage, steerAgent } from "../agents/coder-host/steer.js";
import { titleInboxThread } from "../agents/coder-host/title.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import type { HostedEnvironment } from "../environment.js";
import { recordServerEvent, recordServerEventIn, SERVER_EVENT } from "../events/server-events.js";
import { afterResponse } from "../http/after-response.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";
import { settleThreadDms } from "../slack/thread-dms.js";
import { settleAgentTaskIfFinished } from "../tasks/task-finish.js";
import {
  acknowledgeInboxItem,
  answerInboxAsk,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_MESSAGE_OUTCOME,
  type InboxItemWritten,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxMessage,
  readInboxItem,
  readInboxItemHome,
  remindInboxItem,
  retitleInboxThread,
  type StoredInboxItem,
  startInboxThread,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
  withdrawInboxThread,
} from "./inbox-store.js";

/** How a thread started with no subject finds the model its title is generated on: our own key, as every title's; none where the deployment holds none. */
export type InboxTitleModelOf = () => Effect.Effect<
  LanguageModel | undefined,
  never,
  HostedEnvironment
>;

/** What the inbox asks of the deployment: who the caller is, how eve is reached to hand an answer or a message to an agent, and, for a test, the model an untitled thread's title is generated on. */
export type InboxProcedureSeams = AccountResolving & {
  readonly titleModel?: InboxTitleModelOf | undefined;
};

/** The agent-title model on our own key (`../agents/coder-host/model.ts`), as an agent's own title is generated, whether or not the sender saved a key; none where the deployment holds no such key. */
const productionTitleModel: InboxTitleModelOf = () => deploymentTitleModel();

/**
 * A thread started with no subject titled as an agent is, by the agent-title
 * model over the member's message on our own key, past the answer, so
 * the send waits on no model: the title its first line stood for stays where
 * the deployment holds no such key, the call answers nothing, or its agent
 * retitled it first (`retitleInboxThread`).
 */
const retitled = (seams: InboxProcedureSeams, item: InboxItem, text: string) =>
  Effect.gen(function* () {
    const model = yield* (seams.titleModel ?? productionTitleModel)();
    if (model === undefined) return;
    const title = yield* titleInboxThread(model, text);
    if (Option.isNone(title)) return;
    yield* retitleInboxThread(item.id, item.title, title.value);
  });

/** What a press in a Slack DM says in that DM once its answer is taken: the message whose ask it answered, and the line naming the option chosen. */
interface SlackChosen {
  readonly messageId: string;
  readonly line: string;
}

/** Whether a hand-off was refused because the agent's session has ended for good, so no message will ever reach it. */
function retiredRefusal(refusal: HostedRefusal): boolean {
  return refusal.error === HOSTED_REFUSAL.AGENT_RETIRED.error;
}

/** The nod a member's Got it is, as the agent hears it where it waits on the notice. */
const NOD: InboxReply = { reply: INBOX_REPLY.ACKNOWLEDGED };

/** Whether the item holds an ask open on its thread, which a nod never settles. */
function holdsAsk(item: InboxItem): boolean {
  return (item.thread ?? []).some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
}

/**
 * The notice with the nod standing on it under the request's key: taken
 * now where it is open at the revision named, or as an earlier send under
 * the same key took it; nothing where it was not taken. Refused where the
 * item holds an ask open, which only an answer to the ask settles.
 */
const takenNod = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredInboxItem,
  asked: { readonly revision: number; readonly clientKey: string },
) {
  const { item, answerKey } = stored;
  // Taken by an earlier send, so this one wrote nothing to wait for.
  const standing: InboxItemWritten = item;
  if (answerKey === asked.clientKey) return standing;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (holdsAsk(item)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const nodded = yield* hostedStoreOrUnavailable(
    acknowledgeInboxItem(userId, item.id, asked.revision, asked.clientKey),
  );
  return Option.getOrUndefined<InboxItemWritten>(nodded);
});

/** What the line a member's reply, answer, or close steers into the item's agent says carried it. */
function threadLine(event: ThreadLineMetadata["event"], itemId: string): ThreadLineMetadata {
  return {
    channel: MESSAGE_CHANNEL.THREAD,
    event,
    item_id: itemId,
  };
}

/**
 * The item's agent as the member's words on its thread reach it, brought
 * back first where it stands archived (`agentTakingMessage`), as a message
 * in its Slack thread brings it back; nothing where it is gone.
 */
function agentHearing(userId: string, agentId: string) {
  return hostedStoreOrUnavailable(agentTakingMessage(userId, agentId, readAgent));
}

/**
 * An answer taken, handed to its item's agent as the member's message under
 * the answer's key through the one steer path (`coder-host/steer.ts`), then
 * counted and the agent's task settled where the answer finished its work.
 * A hand-off that fails, is interrupted, or dies takes the answer back, so
 * an item never reads answered while the agent was not told; an agent whose
 * session has ended for good can hear nothing again, so its item keeps the
 * answer.
 */
const handedAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  agentId: string,
  message: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly AgentAttachment[];
  },
  counted: Effect.Effect<void, never, DatabaseServices>,
  chosen?: SlackChosen,
) {
  const { text, clientKey, attachments } = message;
  const handedOver = Effect.gen(function* () {
    const agent = yield* agentHearing(userId, agentId);
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* routedSessions<EveTypedTurn>(userId);
    yield* steerAgent(eve, writer, userId, agent.value, {
      text,
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
      metadata: threadLine(THREAD_LINE_EVENT.ANSWER, itemId),
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
  yield* afterResponse("an answered thread's Slack DM", settleThreadDms(itemId, chosen));
  // The question settled may have finished the task's work, asked once the agent was told, so one
  // woken by the answer reads as running (`tasks/task-finish.ts`).
  yield* settleAgentTaskIfFinished(userId, agentId);
});

/**
 * Acknowledges one notice of a task of the account's workspaces, Got it,
 * whichever member started its agent. A nod naming a revision the agent
 * has since moved on from, or an item no longer open, is answered with the
 * item as it stands and not taken. Otherwise the nod is taken first, at the
 * revision it names, and only then, where the notice asks to be heard back,
 * as one posted before threads may, handed to the agent as one of the
 * developer's messages under the nod's own key through the one steer path
 * (`coder-host/steer.ts`). A hand-off that fails, is interrupted, or dies
 * takes the nod back, so a notice never reads acknowledged while the agent
 * was not told; a nod sent again under the key it was taken by is handed
 * off again, which the steer's own key makes reach the agent once. An agent
 * whose session has ended for good can hear nothing again, so its notice
 * keeps the nod rather than waiting on the developer for ever.
 */
const acknowledged = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  asked: { readonly revision: number; readonly clientKey: string },
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { clientKey } = asked;
  // A nod sent again under the key it was taken under is the same nod, counted once.
  const counted =
    stored.value.answerKey === clientKey
      ? Effect.void
      : recordServerEventIn(
          SERVER_EVENT.INBOX_ANSWER_SEND,
          userId,
          readVisibleAgentWorkspace(userId, stored.value.item.agentId),
          {},
        );
  const written = yield* takenNod(userId, stored.value, asked);
  if (written === undefined) {
    // Not taken: the item moved on, or another answer settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { item: now.value.item, taken: now.value.answerKey === clientKey };
  }
  const { txid, ...taken } = written;
  const writtenIn = txid === undefined ? {} : { txid };
  if (!inboxAnswerHeard(taken, NOD)) {
    yield* counted;
    yield* settleAgentTaskIfFinished(userId, taken.agentId);
    return { item: taken, taken: true, ...writtenIn };
  }
  yield* handedAnswer(
    writer,
    userId,
    itemId,
    taken.agentId,
    { text: inboxAnswerMessage(taken, NOD), clientKey, attachments: [] },
    counted,
  );
  return { item: taken, taken: true, ...writtenIn };
});

/**
 * A member's answer to the thread's open ask, taken first, with its words
 * and files, as the member's message that carries it (`answerInboxAsk`),
 * its agent brought back before it where it stands archived, which opens
 * again the ask the archive settled,
 * and then, by the rule every answer follows (`inboxAnswerHeard`), handed
 * to the agent under the answer's own lead, its files with it, under the
 * answer's key through the one steer path; otherwise kept for the agent to
 * read in its own time. An item put away with its task is not found. An
 * answer to an ask the thread no longer holds open, to another message, or
 * one the ask does not take is answered by what it came to and handed to
 * nobody. A hand-off that fails, is interrupted, or dies takes the answer
 * back, as a nod's does, so the thread never reads answered while the
 * agent was not told; an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once.
 * An agent whose session has ended for good can hear nothing again, so its
 * item keeps the answer.
 *
 * Exported for a caller with no request of its own: our Slack route
 * (`slack/slack-events-app.ts`), which answers a press in a DM as the
 * member it maps the presser to, and names the line that DM says once the
 * answer is taken (`chosen`); and the member MCP server
 * (`member-mcp/inbox.ts`), which answers as the member an outside agent
 * acts for.
 */
export const answerAsMember = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  sent: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly AgentAttachment[];
    readonly answers: InboxAnswers;
  },
  chosen?: SlackChosen,
) {
  const { text, clientKey, attachments, answers } = sent;
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  // Note that the agent is brought back before the answer is taken, because its archive settled the ask, which the bring-back opens again.
  yield* agentHearing(userId, stored.value.item.agentId);
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxAsk(userId, itemId, { answers, text, clientKey, files: attachments }),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome, refusal, txid } = answered.value;
  const writtenIn = txid === undefined ? {} : { txid };
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    // Why a refused answer does not fit its ask, in the check's own words, for a caller that tells it.
    return { item, outcome, ...(refusal === undefined ? undefined : { refusal }), ...writtenIn };
  }
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    outcome === INBOX_ASK_ANSWER.TAKEN
      ? Effect.andThen(
          recordServerEventIn(
            SERVER_EVENT.INBOX_ANSWER_SEND,
            userId,
            readVisibleAgentWorkspace(userId, item.agentId),
            {},
          ),
          recordServerEventIn(
            SERVER_EVENT.THREAD_POST,
            userId,
            readVisibleAgentWorkspace(userId, item.agentId),
            { answered_ask: true, has_media: attachments.length > 0 },
          ),
        )
      : Effect.void;
  const reply = inboxAnswersReply(answers, text);
  if (!inboxAnswerHeard(item, reply, attachments)) {
    yield* counted;
    yield* settleAgentTaskIfFinished(userId, item.agentId);
    return { item, outcome, ...writtenIn };
  }
  const message = inboxAnswerMessage(
    item,
    reply,
    inboxTodoTicks(item, answers, answered.value.ask),
  );
  yield* handedAnswer(
    writer,
    userId,
    itemId,
    item.agentId,
    { text: message, clientKey, attachments },
    counted,
    chosen,
  );
  return { item, outcome, ...writtenIn };
});

/**
 * A member's reply that answers the thread's open ask, as the window sends
 * one from version 5, taken and handed to the agent as `answerAsMember`
 * says. An answer to an ask the thread no longer holds open, to another
 * message, or one the ask does not take is refused, as a message's request
 * is. It answers as a plain reply does: the item as it then stands.
 */
const answeredByReply = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  sent: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly AgentAttachment[];
    readonly answers: InboxAnswers;
  },
) {
  const { item, outcome, ...writtenIn } = yield* answerAsMember(writer, userId, itemId, sent);
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return { item, ...writtenIn };
});

/**
 * Closes one open item of a task of the account's workspaces without an
 * answer, whichever member started its agent, at the revision the member
 * was shown, and answers as an answer does: the item as it then stands, and
 * whether the close was taken, which it is not where the agent changed the
 * item first or it was settled already. A close may carry the member's
 * note of why, written on the thread as their message under the close's
 * key in the close's own write. A close taken is handed to the agent,
 * brought back first where it stands archived, under
 * its own lead and the note after it, in one message, where the item asks
 * to be heard back, so an agent waiting on it is not left waiting, or where
 * it carries a note, which reaches the agent as any message on the thread
 * does; otherwise the agent reads it the next time it reads its inbox. A
 * hand-off that fails, is interrupted, or dies opens the item again and
 * takes the note back off the thread, so it never reads closed while an
 * agent waiting on it was not told; a close sent again under the key it was taken
 * by is handed off again, which the steer's own key makes reach the agent
 * once. An agent whose session has ended for good can hear nothing again,
 * so its item stays closed.
 *
 * Exported for a caller with no request of its own, the member MCP server
 * (`member-mcp/inbox.ts`), which closes as the member an outside agent
 * acts for.
 */
export const closeAsMember = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  asked: {
    readonly revision: number;
    readonly clientKey: string;
    readonly text?: string | undefined;
    readonly attachments?: readonly AgentAttachment[] | undefined;
  },
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { revision, clientKey } = asked;
  const note = { text: asked.text ?? "", files: asked.attachments ?? [] };
  const noted = note.text !== "" || note.files.length > 0;
  const { item, answerKey } = stored.value;
  // A close sent again is the one taken only while the item still stands as that close left it, never once its agent moved it on.
  const retried =
    answerKey === clientKey &&
    item.status === INBOX_STATUS.CLOSED &&
    item.closedReason === undefined &&
    item.revision === revision;
  // A close sent again wrote nothing this time, so there is no transaction to wait for.
  const written: InboxItemWritten | undefined = retried
    ? item
    : item.status !== INBOX_STATUS.OPEN || item.revision !== revision
      ? undefined
      : Option.getOrUndefined(
          yield* hostedStoreOrUnavailable(
            closeInboxItemAsMember(userId, itemId, revision, clientKey, note),
          ),
        );
  if (written === undefined) {
    // Not taken: the item moved on, or an answer or a close settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { item: now.value.item, taken: false };
  }
  const { txid, ...taken } = written;
  const writtenIn = txid === undefined ? {} : { txid };
  const dmSettled = afterResponse("a closed thread's Slack DM", settleThreadDms(itemId));
  if (!taken.needsReply && !noted) {
    yield* dmSettled;
    yield* settleAgentTaskIfFinished(userId, taken.agentId);
    return { item: taken, taken: true, ...writtenIn };
  }
  const handedOver = Effect.gen(function* () {
    const agent = yield* agentHearing(userId, taken.agentId);
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* routedSessions<EveTypedTurn>(userId);
    yield* steerAgent(eve, writer, userId, agent.value, {
      text: inboxClosedMessage(taken, note.text),
      attachments: note.files,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
      metadata: threadLine(THREAD_LINE_EVENT.CLOSE, itemId),
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
  // Counted once the hand-off stands, as a message on the thread is, since a failed one takes the note back above.
  if (noted && !retried) {
    yield* recordServerEventIn(
      SERVER_EVENT.THREAD_POST,
      userId,
      readVisibleAgentWorkspace(userId, taken.agentId),
      { answered_ask: false, has_media: note.files.length > 0 },
    );
  }
  yield* dmSettled;
  yield* settleAgentTaskIfFinished(userId, taken.agentId);
  return { item: taken, taken: true, ...writtenIn };
});

/**
 * Writes a member's message on the thread of one item of the account's
 * workspaces, open or settled, whichever member started its agent, and
 * answers with the item as it then stands. The message is written first,
 * with its files, moving the item's last change and nothing else of it
 * but that it settles the notice at the revision the request names as the
 * member's nod does, and then handed
 * to the agent as one of the developer's messages, under
 * its own lead and its files with it, the agent brought back first where
 * it stands archived, through the one steer path
 * (`coder-host/steer.ts`), which opens a turn for an agent that stopped as
 * a message typed in its tab does. A hand-off that fails, is interrupted,
 * or dies takes the message back off the thread, so the thread never shows
 * a message the agent was not told, where this send wrote it, and a notice
 * it settled waits on the nod again; a message
 * sent again under its key is the one already written and handed off
 * again, which the steer's own key makes reach the agent once, and another
 * message under a key already taken, by another member or with other words
 * or files, is refused. An agent whose session has ended for good can hear
 * nothing again, so its item keeps the message. A message that carries the
 * answer to the thread's open ask is the reply that answers it, as
 * `answeredByReply` takes one; one without is a plain reply, which never
 * answers, even while an ask stands open.
 *
 * Exported for a caller with no request of its own: our Slack route
 * (`slack/slack-agent-starts.ts`), which posts a member's reply in the Slack
 * thread of a DM the bot wrote them as their reply on the DM's thread; and
 * the member MCP server (`member-mcp/inbox.ts`), which writes as the member
 * an outside agent acts for.
 */
export const messageAsMember = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  asked: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly AgentAttachment[];
    readonly answers?: InboxAnswers | undefined;
    readonly revision?: number | undefined;
  },
) {
  const { text, clientKey, attachments, answers, revision } = asked;
  if (answers !== undefined) {
    return yield* answeredByReply(writer, userId, itemId, {
      text,
      clientKey,
      attachments,
      answers,
    });
  }
  const posted = yield* hostedStoreOrUnavailable(
    postInboxMessage(userId, itemId, { text, clientKey, files: attachments, revision }),
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
    const agent = yield* agentHearing(userId, item.agentId);
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* routedSessions<EveTypedTurn>(userId);
    yield* steerAgent(eve, writer, userId, agent.value, {
      text: inboxThreadMessage(item, text),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
      metadata: threadLine(THREAD_LINE_EVENT.MESSAGE, item.id),
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() => unheard.pipe(Effect.tapError(logStoreFailure), Effect.ignore)),
  );
  // Counted once the hand-off stands, since a failed one takes the message back above.
  if (outcome === INBOX_MESSAGE_OUTCOME.WRITTEN) {
    yield* recordServerEventIn(
      SERVER_EVENT.THREAD_POST,
      userId,
      readVisibleAgentWorkspace(userId, item.agentId),
      { answered_ask: false, has_media: attachments.length > 0 },
    );
  }
  return { item };
});

/**
 * A thread a member starts with an agent, written and handed to the agent
 * as a message on it is (`messageAsMember`), brought back first where it
 * stands archived: the agent hears the member's words
 * under the thread's key, which it answers on with its own posts. Refused
 * before anything is written where the member may not message the agent,
 * so a thread the agent could never hear never stands; a hand-off that
 * fails all the same takes the thread back whole, and one started again
 * under its key is the one already written, handed off again, which the
 * steer's own key makes reach the agent once.
 */
const started = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: InboxProcedureSeams,
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  asked: {
    readonly agentId: string;
    readonly title: string;
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly AgentAttachment[];
    /** Whether the member wrote the subject, where none stands for its message's first line until it is titled. */
    readonly titled: boolean;
  },
) {
  const { agentId, title, text, clientKey, attachments } = asked;
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (!controlsAgent(userId, agent.value)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const { userId: starterId, taskId } = agent.value;
  const written = yield* hostedStoreOrUnavailable(
    startInboxThread(
      userId,
      { userId: starterId, taskId, agentId: agent.value.id },
      { title, text, clientKey, files: attachments },
    ),
  );
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = written.value;
  if (outcome === INBOX_MESSAGE_OUTCOME.KEY_REUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // Note that a repeat leaves the thread standing on failure, because the write that wrote it decides whether it stays.
  const unheard =
    outcome === INBOX_MESSAGE_OUTCOME.WRITTEN
      ? withdrawInboxThread(userId, item.id, clientKey)
      : Effect.void;
  const handedOver = Effect.gen(function* () {
    const hearing = yield* hostedStoreOrUnavailable(
      agentTakingMessage(userId, agentId, readVisibleAgent),
    );
    if (Option.isNone(hearing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const eve = yield* routedSessions<EveTypedTurn>(userId);
    yield* steerAgent(eve, writer, userId, hearing.value, {
      text: inboxThreadMessage(item, text),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
      metadata: threadLine(THREAD_LINE_EVENT.MESSAGE, item.id),
    });
  });
  yield* handedOver.pipe(
    Effect.onError(() => unheard.pipe(Effect.tapError(logStoreFailure), Effect.ignore)),
  );
  // Counted once the hand-off stands, since a failed one takes the thread back above.
  if (outcome === INBOX_MESSAGE_OUTCOME.WRITTEN) {
    yield* recordServerEvent(
      SERVER_EVENT.THREAD_POST,
      { userId, workspaceId: agent.value.organizationId },
      { answered_ask: false, has_media: attachments.length > 0 },
    );
  }
  // Note that only the write that started the thread titles it, so a repeat asks no model again.
  if (!asked.titled && outcome === INBOX_MESSAGE_OUTCOME.WRITTEN) {
    yield* afterResponse("an inbox thread's title", retitled(seams, item, text));
  }
  return { item };
});

/** The item's reminder set for the member until the instant the body names, or ended where it names none: its id and read state, or not found. */
const remindOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  input: { readonly params: { readonly id: string }; readonly body: InboxRemindRequest },
) {
  const itemId = yield* pathUuid(input.params.id);
  const { until } = input.body;
  const marked = yield* hostedStoreOrUnavailable(
    remindInboxItem(userId, itemId, until === null ? null : new Date(until)),
  );
  if (marked === false) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { id: itemId, ...marked };
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
 * unread. Each of the member's writes but a message or a new thread is
 * taken once under the idempotency key its request carries
 * (`writeReceiptMiddleware`), so one sent again after an answer lost lands
 * once.
 */
export function inboxProcedures(seams: InboxProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  const signedIn = hosted.inbox.use(accountMiddleware(seams.resolveUserId));
  return {
    // Note that the query's `archived=include`, which an older build still sends, is taken and changes nothing: no task is archived any more, so there is none to list.
    account: signedIn.account.effect(function* ({ input, context }) {
      const after = input.after ?? INBOX_CURSOR_START;
      const repositoryless =
        input[ACCOUNT_INBOX_REPOSITORYLESS.QUERY] === ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE;
      return yield* hostedStoreOrUnavailable(
        accountInboxPast(context.userId, after, repositoryless),
      );
    }),
    task: signedIn.task.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const workspace = yield* hostedStoreOrUnavailable(readTaskWorkspace(context.userId, taskId));
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const after = input.after ?? INBOX_CURSOR_START;
      return yield* hostedStoreOrUnavailable(taskInboxPast(context.userId, taskId, after));
    }),
    agent: signedIn.agent.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.id);
      const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(context.userId, agentId));
      if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const after = input.after ?? INBOX_CURSOR_START;
      return yield* hostedStoreOrUnavailable(agentInboxPast(context.userId, agent.value.id, after));
    }),
    answer: signedIn.answer.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const itemId = yield* pathUuid(input.params.id);
      const { revision, clientKey } = input.body;
      return yield* acknowledged(writer, context.userId, itemId, {
        revision,
        clientKey,
      });
    }),
    message: hosted.inbox.use(accountMiddleware(seams.resolveUserId)).message.effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* pathUuid(input.params.id);
      const { text, clientKey, attachments = [], answers, revision } = input.body;
      return yield* messageAsMember(writer, context.userId, itemId, {
        text,
        clientKey,
        attachments,
        answers,
        revision,
      });
    }),
    start: hosted.inbox.use(accountMiddleware(seams.resolveUserId)).start.effect(function* ({
      input,
      context,
    }) {
      const agentId = yield* pathUuid(input.agentId);
      const { text, clientKey, attachments = [] } = input;
      return yield* started(seams, writer, context.userId, {
        agentId,
        title: inboxStartTitle(input),
        titled: input.title !== undefined,
        text,
        clientKey,
        attachments,
      });
    }),
    close: signedIn.close.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const itemId = yield* pathUuid(input.params.id);
      return yield* closeAsMember(writer, context.userId, itemId, input.body);
    }),
    // Note that an item the account may not read is answered as one that does not exist, so a link by its id says nothing of it.
    home: signedIn.home.effect(function* ({ input, context }) {
      const itemId = yield* pathUuid(input.id);
      const home = yield* hostedStoreOrUnavailable(readInboxItemHome(context.userId, itemId));
      if (Option.isNone(home)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return home.value;
    }),
    markItemRead: signedIn.markItemRead.use(writeReceiptMiddleware).effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* pathUuid(input.id);
      const marked = yield* hostedStoreOrUnavailable(markInboxItemRead(context.userId, itemId));
      if (marked === false) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { id: itemId, unread: false, ...marked };
    }),
    markItemUnread: signedIn.markItemUnread.use(writeReceiptMiddleware).effect(function* ({
      input,
      context,
    }) {
      const itemId = yield* pathUuid(input.id);
      const marked = yield* hostedStoreOrUnavailable(markInboxItemUnread(context.userId, itemId));
      if (marked === false) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { id: itemId, unread: true, ...marked };
    }),
    remindItem: signedIn.remindItem.use(writeReceiptMiddleware).effect(function* ({
      input,
      context,
    }) {
      return yield* remindOf(context.userId, input);
    }),
    // `remindItem` under the path a desktop built before the rename still calls; goes once the releases after it are out.
    snoozeItem: signedIn.snoozeItem.use(writeReceiptMiddleware).effect(function* ({
      input,
      context,
    }) {
      return yield* remindOf(context.userId, input);
    }),
    markAllRead: signedIn.markAllRead.use(writeReceiptMiddleware).effect(function* ({
      input,
      context,
    }) {
      return yield* hostedStoreOrUnavailable(markInboxRead(context.userId, input.workspaceId));
    }),
  };
}
