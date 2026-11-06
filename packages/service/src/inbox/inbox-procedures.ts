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

export type InboxTitleModelOf = () => Effect.Effect<
  LanguageModel | undefined,
  never,
  HostedEnvironment
>;

export type InboxProcedureSeams = AccountResolving & {
  readonly titleModel?: InboxTitleModelOf | undefined;
};

const productionTitleModel: InboxTitleModelOf = () => deploymentTitleModel();

const retitled = (seams: InboxProcedureSeams, item: InboxItem, text: string) =>
  Effect.gen(function* () {
    const model = yield* (seams.titleModel ?? productionTitleModel)();
    if (model === undefined) return;
    const title = yield* titleInboxThread(model, text);
    if (Option.isNone(title)) return;
    yield* retitleInboxThread(item.id, item.title, title.value);
  });

interface SlackChosen {
  readonly messageId: string;
  readonly line: string;
}

function retiredRefusal(refusal: HostedRefusal): boolean {
  return refusal.error === HOSTED_REFUSAL.AGENT_RETIRED.error;
}

const NOD: InboxReply = { reply: INBOX_REPLY.ACKNOWLEDGED };

function holdsAsk(item: InboxItem): boolean {
  return (item.thread ?? []).some((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
}

const takenNod = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredInboxItem,
  asked: { readonly revision: number; readonly clientKey: string },
) {
  const { item, answerKey } = stored;
  const standing: InboxItemWritten = item;
  if (answerKey === asked.clientKey) return standing;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (holdsAsk(item)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const nodded = yield* hostedStoreOrUnavailable(
    acknowledgeInboxItem(userId, item.id, asked.revision, asked.clientKey),
  );
  return Option.getOrUndefined<InboxItemWritten>(nodded);
});

function threadLine(event: ThreadLineMetadata["event"], itemId: string): ThreadLineMetadata {
  return {
    channel: MESSAGE_CHANNEL.THREAD,
    event,
    item_id: itemId,
  };
}

function agentHearing(userId: string, agentId: string) {
  return hostedStoreOrUnavailable(agentTakingMessage(userId, agentId, readAgent));
}

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
  yield* counted;
  yield* afterResponse("an answered thread's Slack DM", settleThreadDms(itemId, chosen));
  yield* settleAgentTaskIfFinished(userId, agentId);
});

const acknowledged = /* @__PURE__ */ Effect.fnUntraced(function* (
  writer: Effect.Effect<StoreWriter>,
  userId: string,
  itemId: string,
  asked: { readonly revision: number; readonly clientKey: string },
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { clientKey } = asked;
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
  yield* agentHearing(userId, stored.value.item.agentId);
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxAsk(userId, itemId, { answers, text, clientKey, files: attachments }),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome, refusal, txid } = answered.value;
  const writtenIn = txid === undefined ? {} : { txid };
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    return { item, outcome, ...(refusal === undefined ? undefined : { refusal }), ...writtenIn };
  }
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
  const retried =
    answerKey === clientKey &&
    item.status === INBOX_STATUS.CLOSED &&
    item.closedReason === undefined &&
    item.revision === revision;
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
  if (outcome === INBOX_MESSAGE_OUTCOME.WRITTEN) {
    yield* recordServerEvent(
      SERVER_EVENT.THREAD_POST,
      { userId, workspaceId: agent.value.organizationId },
      { answered_ask: false, has_media: attachments.length > 0 },
    );
  }
  if (!asked.titled && outcome === INBOX_MESSAGE_OUTCOME.WRITTEN) {
    yield* afterResponse("an inbox thread's title", retitled(seams, item, text));
  }
  return { item };
});

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

export function inboxProcedures(seams: InboxProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  const signedIn = hosted.inbox.use(accountMiddleware(seams.resolveUserId));
  return {
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
