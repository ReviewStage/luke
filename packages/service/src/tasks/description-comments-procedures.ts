import type { DatabaseServices } from "@repo/database/core/query";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  type DescriptionCommentOutcome,
  descriptionCommentStamps,
  readDescriptionCommentThread,
  readDescriptionCommentThreads,
  startDescriptionCommentThread,
  withdrawDescriptionCommentAsk,
} from "@repo/database/models/description-comments";
import { readPageById } from "@repo/database/models/task-pages";
import { readTaskHeader, readTaskWorkspace } from "@repo/database/models/task-store";
import { TOPIC } from "@repo/database/sync/notification";
import { askedInWords } from "@repo/features/mention-link";
import { PAGE_SHOWER } from "@repo/features/page-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENTS_CURSOR_START,
  type DescriptionCommentAsked,
  type DescriptionCommentStart,
  type DescriptionCommentsAnswer,
  type DescriptionCommentThread,
  type DescriptionCommentThreadAnswer,
} from "@repo/features/description-comment-wire";
import { COMMENT_LINE_BOUNDS } from "@repo/wire";
import { Effect, Option } from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import { recordServerEventIn, SERVER_EVENT } from "../events/server-events.js";
import { afterResponse } from "../http/after-response.js";
import { cursorOf, heldUntilMoved } from "../http/held-read.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  askableAgent,
  type CommentRecipient,
  commentAskMessage,
  handCommentAskOver,
  reviewAskMessage,
} from "./comment-ask.js";

export interface DescriptionCommentsProcedureSeams {
  resolveUserId: UserIdResolver;
}

function descriptionCommentsPast(
  userId: string,
  taskId: string,
  after: string,
  pageId: string | undefined,
): Effect.Effect<Option.Option<DescriptionCommentsAnswer>, StoreFailure, DatabaseServices> {
  return heldUntilMoved(
    descriptionCommentStamps(userId, taskId, pageId),
    after,
    [
      [TOPIC.TASK, taskId],
      [TOPIC.ACCOUNT, userId],
    ],
    CODER.MESSAGES_POLL,
    CODER.MESSAGES_HOLD,
  ).pipe(
    Effect.andThen(readDescriptionCommentThreads(userId, taskId, pageId)),
    Effect.map(Option.map((threads) => ({ threads, cursor: cursorOf(threads) }))),
  );
}

const outcomeAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentOutcome,
): Effect.fn.Return<DescriptionCommentThreadAnswer, HostedRefusal> {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE)
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return outcome.answer;
});

function withTxid(
  body: DescriptionCommentThreadAnswer,
  outcome: DescriptionCommentOutcome,
): DescriptionCommentThreadAnswer {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || outcome.txid === undefined)
    return body;
  return "refused" in body ? body : { ...body, txid: outcome.txid };
}

export interface MentioningComment {
  readonly userId: string;
  readonly taskId: string;
  readonly words: string;
  readonly clientKey: string;
  readonly isReply: boolean;
  readonly held?: boolean;
  readonly along?: readonly string[];
}

type DescriptionCommentDone = Extract<
  DescriptionCommentOutcome,
  { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.DONE }
>;

export const memberCommentAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentDone,
  comment: MentioningComment,
) {
  const { answer } = outcome;
  if (!("thread" in answer)) return answer;
  if (outcome.repeated !== true) {
    yield* recordServerEventIn(
      SERVER_EVENT.DESCRIPTION_COMMENT,
      comment.userId,
      readTaskWorkspace(comment.userId, comment.taskId),
      { is_reply: comment.isReply },
    );
  }
  const { thread } = answer;
  const own = thread.entries.some(
    (entry) =>
      entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT &&
      entry.writer.by?.userId === comment.userId &&
      entry.words === comment.words,
  );
  const unsent =
    !own || comment.held === true
      ? []
      : comment.along === undefined || comment.along.length === 0
        ? yield* mentionsHandedOver(thread, comment)
        : yield* reviewHandedOver(thread, comment, comment.along);
  return unsent.length === 0 ? answer : { thread, unsent };
});

const commentAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentOutcome,
  comment: MentioningComment,
) {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return yield* memberCommentAnswer(outcome, comment);
});

const pageWriterOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  thread: DescriptionCommentThread,
): Effect.fn.Return<DescriptionCommentAsked | undefined, HostedRefusal, DatabaseServices> {
  if (thread.page === undefined) return undefined;
  const found = yield* hostedStoreOrUnavailable(readPageById(userId, thread.page.id, undefined));
  const shownBy = Option.getOrUndefined(found)?.page.shownBy;
  if (shownBy === undefined) return undefined;
  return shownBy.kind === PAGE_SHOWER.AGENT
    ? { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: shownBy.agentId }
    : { actor: DESCRIPTION_COMMENT_ACTOR.APP };
});

interface HandOver {
  readonly to: DescriptionCommentAsked;
  readonly owed: boolean;
}

function agentsIn(
  thread: DescriptionCommentThread,
  writer: DescriptionCommentAsked | undefined,
): readonly DescriptionCommentAsked[] {
  const joined = thread.entries.flatMap((entry) => {
    const agentId =
      entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED
        ? entry.asked?.agentId
        : entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT &&
            entry.writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT
          ? entry.writer.agentId
          : undefined;
    return agentId === undefined ? [] : [{ actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId }];
  });
  return writer === undefined ? joined : [writer, ...joined];
}

function handedTo(
  thread: DescriptionCommentThread,
  words: string,
  writer: DescriptionCommentAsked | undefined,
): readonly HandOver[] {
  const handOvers = new Map<string | undefined, HandOver>();
  for (const to of agentsIn(thread, writer)) {
    if (!handOvers.has(to.agentId)) handOvers.set(to.agentId, { to, owed: true });
  }
  for (const agentId of askedInWords(words)) {
    if (!handOvers.has(agentId)) {
      handOvers.set(agentId, {
        to: { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId },
        owed: false,
      });
    }
  }
  return [...handOvers.values()];
}

const mentionsHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  thread: DescriptionCommentThread,
  comment: MentioningComment,
) {
  const { userId, taskId } = comment;
  const writer = yield* pageWriterOf(userId, thread).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );
  const unsent: DescriptionCommentAsked[] = [];
  const taking: { readonly to: DescriptionCommentAsked; readonly agent: CommentRecipient }[] = [];
  for (const { to, owed } of handedTo(thread, comment.words, writer)) {
    const agent = yield* askableAgent(userId, taskId, to, thread).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (agent !== undefined) taking.push({ to, agent });
    else if (owed) unsent.push(to);
  }
  yield* afterResponse(
    "a comment's hand-over",
    Effect.forEach(
      taking,
      ({ to, agent }) =>
        handedOver(thread, comment, to, agent).pipe(
          Effect.catch((refusal) =>
            Effect.logWarning(`a comment's hand-over was not taken: ${String(refusal)}`),
          ),
        ),
      { discard: true },
    ),
  );
  return unsent;
});

const handedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  thread: DescriptionCommentThread,
  comment: MentioningComment,
  to: DescriptionCommentAsked,
  agent: CommentRecipient,
) {
  const { userId, taskId } = comment;
  const ask = {
    action: DESCRIPTION_COMMENT_ACTION.ASK,
    clientKey: mentionKey(comment.clientKey, to),
    to,
  };
  const outcome = yield* hostedStoreOrUnavailable(
    actOnDescriptionCommentThread(
      { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId },
      taskId,
      thread.id,
      ask,
    ),
  );
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) return;
  yield* askHandedOver({
    userId,
    taskId,
    thread: outcome.answer.thread,
    clientKey: ask.clientKey,
    words: comment.words,
    to: agent,
  });
});

function mentionKey(clientKey: string, to: DescriptionCommentAsked): string {
  return JSON.stringify({ comment: clientKey, actor: to.actor, agent: to.agentId ?? null });
}

const askHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
  readonly userId: string;
  readonly taskId: string;
  readonly thread: DescriptionCommentThread;
  readonly clientKey: string;
  readonly words: string;
  readonly to: CommentRecipient;
}) {
  const { userId, taskId, thread, clientKey, words, to } = input;
  const asked = thread.entries.findLast(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED && entry.writer.by?.userId === userId,
  );
  const task = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const page =
    thread.page === undefined
      ? undefined
      : yield* hostedStoreOrUnavailable(readPageById(userId, thread.page.id, undefined));
  const text = commentAskMessage({
    taskId,
    taskName: task.value.name,
    thread,
    sender: asked?.writer.by?.name ?? "A member",
    ...(page === undefined || Option.isNone(page)
      ? undefined
      : { page: { title: page.value.page.title, newestVersion: page.value.newestVersion } }),
  });
  const threadId = thread.id;
  const shown = page === undefined ? undefined : Option.getOrUndefined(page)?.page;
  const line = {
    taskId,
    quote:
      thread.page !== undefined && thread.page.element === undefined ? undefined : thread.quote,
    page:
      thread.page === undefined || shown === undefined
        ? undefined
        : { id: thread.page.id, title: shown.title },
  };
  yield* handCommentAskOver({
    userId,
    to,
    clientKey,
    text,
    threadId,
    words,
    line,
  }).pipe(
    Effect.onError(() =>
      withdrawDescriptionCommentAsk(taskId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
});

function reviewOf(start: DescriptionCommentStart): Pick<MentioningComment, "held" | "along"> {
  if (!("page" in start)) return {};
  if (start.held === true) return { held: true };
  return start.along === undefined ? {} : { along: start.along };
}

function firstWordsOf(thread: DescriptionCommentThread, userId: string): string | undefined {
  return thread.entries.find(
    (entry) =>
      entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT && entry.writer.by?.userId === userId,
  )?.words;
}

const reviewThreads = /* @__PURE__ */ Effect.fnUntraced(function* (
  thread: DescriptionCommentThread,
  comment: MentioningComment,
  along: readonly string[],
) {
  const held: DescriptionCommentThread[] = [];
  for (const id of along) {
    const read = yield* hostedStoreOrUnavailable(
      readDescriptionCommentThread(comment.userId, comment.taskId, id),
    ).pipe(Effect.catch(() => Effect.succeed(Option.none<DescriptionCommentThread>())));
    if (Option.isSome(read)) held.push(read.value);
  }
  return [...held, thread];
});

const reviewHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  thread: DescriptionCommentThread,
  comment: MentioningComment,
  along: readonly string[],
) {
  const { userId, taskId } = comment;
  const threads = yield* reviewThreads(thread, comment, along);
  const writer = yield* pageWriterOf(userId, thread).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );
  const asked = new Map<
    string | undefined,
    {
      readonly to: DescriptionCommentAsked;
      owed: boolean;
      readonly threads: DescriptionCommentThread[];
    }
  >();
  for (const each of threads) {
    const words = each.id === thread.id ? comment.words : (firstWordsOf(each, userId) ?? "");
    for (const { to, owed } of handedTo(each, words, writer)) {
      const was = asked.get(to.agentId);
      if (was === undefined) asked.set(to.agentId, { to, owed, threads: [each] });
      else {
        was.owed ||= owed;
        was.threads.push(each);
      }
    }
  }
  const unsent: DescriptionCommentAsked[] = [];
  const taking: {
    readonly to: DescriptionCommentAsked;
    readonly agent: CommentRecipient;
    readonly threads: readonly DescriptionCommentThread[];
  }[] = [];
  for (const { to, owed, threads: theirs } of asked.values()) {
    const agent = yield* askableAgent(userId, taskId, to, thread).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (agent !== undefined) taking.push({ to, agent, threads: theirs });
    else if (owed) unsent.push(to);
  }
  yield* afterResponse(
    "a review's hand-over",
    Effect.forEach(
      taking,
      ({ to, agent, threads: theirs }) =>
        reviewAsked(theirs, comment, to, agent).pipe(
          Effect.catch((refusal) =>
            Effect.logWarning(`a review's hand-over was not taken: ${String(refusal)}`),
          ),
        ),
      { discard: true },
    ),
  );
  return unsent;
});

function reviewKey(
  clientKey: string,
  threadId: string | undefined,
  to: DescriptionCommentAsked,
): string {
  return JSON.stringify({
    review: clientKey,
    thread: threadId ?? null,
    actor: to.actor,
    agent: to.agentId ?? null,
  });
}

function reviewLineWords(threads: readonly DescriptionCommentThread[], userId: string): string {
  const words = threads.map((thread) => firstWordsOf(thread, userId) ?? "").join("\n\n");
  return words.length > COMMENT_LINE_BOUNDS.WORDS_CHARS
    ? `${words.slice(0, COMMENT_LINE_BOUNDS.WORDS_CHARS - 1)}…`
    : words;
}

const reviewAsked = /* @__PURE__ */ Effect.fnUntraced(function* (
  threads: readonly DescriptionCommentThread[],
  comment: MentioningComment,
  to: DescriptionCommentAsked,
  agent: CommentRecipient,
) {
  const { userId, taskId } = comment;
  const keys: string[] = [];
  const asked: DescriptionCommentThread[] = [];
  for (const thread of threads) {
    const ask = {
      action: DESCRIPTION_COMMENT_ACTION.ASK,
      clientKey: reviewKey(comment.clientKey, thread.id, to),
      to,
    };
    const outcome = yield* hostedStoreOrUnavailable(
      actOnDescriptionCommentThread(
        { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId },
        taskId,
        thread.id,
        ask,
      ),
    );
    if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer))
      continue;
    keys.push(ask.clientKey);
    asked.push(outcome.answer.thread);
  }
  const last = asked.at(-1);
  if (last?.page === undefined) return;
  const task = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));
  const page = yield* hostedStoreOrUnavailable(readPageById(userId, last.page.id, undefined));
  if (Option.isNone(task) || Option.isNone(page)) return;
  const shown = page.value.page;
  const sender = last.entries.findLast(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED && entry.writer.by?.userId === userId,
  )?.writer.by?.name;
  yield* handCommentAskOver({
    userId,
    to: agent,
    clientKey: reviewKey(comment.clientKey, undefined, to),
    text: reviewAskMessage({
      taskId,
      taskName: task.value.name,
      threads: asked,
      sender: sender ?? "A member",
      page: { id: last.page.id, title: shown.title, newestVersion: page.value.newestVersion },
    }),
    threadId: last.id,
    words: reviewLineWords(asked, userId),
    line: { taskId, quote: undefined, page: { id: last.page.id, title: shown.title } },
  }).pipe(
    Effect.onError(() =>
      Effect.forEach(
        keys,
        (key) =>
          withdrawDescriptionCommentAsk(taskId, key).pipe(
            Effect.tapError(logStoreFailure),
            Effect.ignore,
          ),
        { discard: true },
      ),
    ),
  );
});

export function descriptionCommentsProcedures(seams: DescriptionCommentsProcedureSeams) {
  const member = hosted.descriptionComments.use(accountMiddleware(seams.resolveUserId));
  return {
    read: member.read.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const read = yield* hostedStoreOrUnavailable(
        descriptionCommentsPast(
          context.userId,
          taskId,
          input.after ?? DESCRIPTION_COMMENTS_CURSOR_START,
          input.page === undefined ? undefined : yield* pathUuid(input.page),
        ),
      );
      if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return read.value;
    }),
    start: member.start.effect(function* ({ input, context }) {
      const start = input.body;
      const taskId = yield* pathUuid(input.params.id);
      const writer = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: context.userId } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        startDescriptionCommentThread(writer, taskId, start),
      );
      const body = yield* commentAnswer(outcome, {
        userId: context.userId,
        taskId,
        words: start.words,
        clientKey: start.clientKey,
        isReply: false,
        ...reviewOf(start),
      });
      return {
        status: "thread" in body ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
        body: withTxid(body, outcome),
      };
    }),
    act: member.act.effect(function* ({ input, context }) {
      const action = input.body;
      const taskId = yield* pathUuid(input.params.id);
      const threadId = yield* pathUuid(input.params.thread);
      const writer = { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, userId: context.userId } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        actOnDescriptionCommentThread(writer, taskId, threadId, action),
      );
      if (action.action !== DESCRIPTION_COMMENT_ACTION.REPLY) {
        return withTxid(yield* outcomeAnswer(outcome), outcome);
      }
      const body = yield* commentAnswer(outcome, {
        userId: context.userId,
        taskId,
        words: action.words,
        clientKey: action.clientKey,
        isReply: true,
      });
      return withTxid(body, outcome);
    }),
  };
}
