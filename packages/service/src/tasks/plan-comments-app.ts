import type { DatabaseServices } from "@luke/database/core/query";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  planCommentStamps,
  readPlanCommentThreads,
  startPlanCommentThread,
  withdrawPlanCommentAsk,
} from "@luke/database/models/plan-comments";
import { readTask } from "@luke/database/models/task-store";
import { askedInWords } from "@luke/features/mention-link";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentAsked,
  type PlanCommentsAnswer,
  type PlanCommentThread,
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsCursorSchema,
} from "@luke/features/plan-comment-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { CODER } from "../agents/coder-host/bounds.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { cursorOf, heldUntilMoved } from "../http/held-read.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import {
  askableAgent,
  type CommentAskSeams,
  type CommentRecipient,
  commentAskMessage,
  handCommentAskOver,
} from "./comment-ask.js";

/**
 * plan-comments-app.ts -- a plan's comment threads for the desktop: read them as they change, start one, and answer, edit, resolve, reopen, or delete one.
 *
 * `GET /api/plans/{id}/comments` reads every thread of the plan, held while
 * nothing moved since the cursor `after` names (`http/held-read.ts`), as the
 * Inbox is read, so a window hears a teammate's or an agent's comment the
 * moment it lands; `POST` starts a thread with its first comment, anchored to
 * words of the plan's text (`@luke/database/models/plan-comments`).
 * `POST /api/plans/{id}/comments/{thread}` is one thing done to a thread,
 * answered with the thread as it now stands. Every member of the plan's
 * workspace reads and writes every thread; a plan the account does not reach,
 * or an archived one for a write, answers as not found, and a thread the plan
 * does not hold as not found too. A member's comment that mentions Luke or
 * one of the task's agents with \`@\` hands each the thread (\`mentionsHandedOver\`).
 */

const PLAN_COMMENTS_PATH = {
  /** GET reads the plan's threads past the cursor `after` names; POST starts one. The rewrite moves the path's id into the `id` query. */
  COMMENTS: "/api/plans/comments",
  /** POST does one thing to one thread; the rewrite moves the path's ids into the `id` and `thread` queries. */
  THREAD: "/api/plans/comment-thread",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

const QUERY = {
  TASK: "id",
  THREAD: "thread",
  AFTER: "after",
} as const;

/** A start carries the plan's text its anchor is measured in, every character escaped, beside a comment and a quote at their bounds. */
const MAXIMUM_START_BODY_BYTES =
  (TASK_BOUNDS.MAX_BODY_CHARS +
    PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS +
    PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS) *
    6 +
  1_024;

/** An action is a comment at its bound and an id or a key, every character escaped. */
const MAXIMUM_ACTION_BODY_BYTES = PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS * 6 + 1_024;

export interface PlanCommentsAppSeams extends CommentAskSeams {
  resolveUserId: UserIdResolver;
}

/** What the routes may require of the function that stands them: the store, and the network and GitHub a hand-over to a coding agent reaches. */
export type PlanCommentsAppServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

type PlanCommentsServices = PlanCommentsAppServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The one id the path named under `query`; two are refused, and one that is not a UUID names no row. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  query: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(query);
  const [id] = ids;
  if (id === undefined || ids.length !== 1)
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The cursor a read names, the start where it names none. */
const cursorQueryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(QUERY.AFTER);
  const [after] = named;
  if (after === undefined) return PLAN_COMMENTS_CURSOR_START;
  const read = readEither(planCommentsCursorSchema)(unparsedWire(after));
  if (named.length !== 1 || Result.isFailure(read))
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

/** The plan's threads as they stand, held while its cursor is still the reader's; nothing where the account reaches no such plan. */
function planCommentsPast(
  userId: string,
  taskId: string,
  after: string,
): Effect.Effect<Option.Option<PlanCommentsAnswer>, StoreFailure, DatabaseServices> {
  return heldUntilMoved(
    planCommentStamps(userId, taskId),
    after,
    CODER.MESSAGES_POLL,
    CODER.MESSAGES_HOLD,
  ).pipe(
    Effect.andThen(readPlanCommentThreads(userId, taskId)),
    Effect.map(Option.map((threads) => ({ threads, cursor: cursorOf(threads) }))),
  );
}

/** A write's outcome as the route answers it: the thread, its deletion, or a refusal in band; a plan or thread not reached as not found. */
const outcomeAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: PlanCommentOutcome,
  created: boolean,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal> {
  if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE)
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const status =
    created && "thread" in outcome.answer ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK;
  return hostedJsonResponse(status, outcome.answer);
});

/** GET reads the plan's threads, held past the reader's cursor; POST starts one with its first comment. */
const commentsEndpoint = /* @__PURE__ */ Effect.fn("web/planCommentsEndpoint")(function* (
  seams: PlanCommentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlanCommentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  if (incoming.method === HTTP_METHOD.GET) {
    const taskId = yield* idOf(request, QUERY.TASK);
    const userId = yield* resolvedUserId(seams, request);
    const after = yield* cursorQueryOf(request);
    const read = yield* hostedStoreOrUnavailable(planCommentsPast(userId, taskId, after));
    if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, read.value);
  }
  if (incoming.method !== HTTP_METHOD.POST)
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const taskId = yield* idOf(request, QUERY.TASK);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_START_BODY_BYTES);
  const start = readEither(planCommentStartRequestSchema)(body);
  if (Result.isFailure(start)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId } as const;
  const outcome = yield* hostedStoreOrUnavailable(
    startPlanCommentThread(writer, taskId, start.success),
  );
  return yield* commentAnswer(seams, request, outcome, true, {
    userId,
    taskId,
    words: start.success.words,
    clientKey: start.success.clientKey,
  });
});

/** POST does one thing to one thread of the plan, as the member the bearer is. */
const threadEndpoint = /* @__PURE__ */ Effect.fn("web/planCommentThreadEndpoint")(function* (
  seams: PlanCommentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlanCommentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST)
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, QUERY.TASK);
  const threadId = yield* idOf(request, QUERY.THREAD);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_ACTION_BODY_BYTES);
  const action = readEither(planCommentActionRequestSchema)(body);
  if (Result.isFailure(action)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId } as const;
  const outcome = yield* hostedStoreOrUnavailable(
    actOnPlanCommentThread(writer, taskId, threadId, action.success),
  );
  if (action.success.action !== PLAN_COMMENT_ACTION.REPLY)
    return yield* outcomeAnswer(outcome, false);
  return yield* commentAnswer(seams, request, outcome, false, {
    userId,
    taskId,
    words: action.success.words,
    clientKey: action.success.clientKey,
  });
});

/** A member's comment, as its mentions are read from it and handed over under its key. */
interface MentioningComment {
  readonly userId: string;
  readonly taskId: string;
  readonly words: string;
  readonly clientKey: string;
}

/**
 * A comment's answer: its thread, its mentions handed over first, with the
 * ones asked who could not take it, so the member reads that they were not
 * asked. A comment the store refused, at its bound or under a key another
 * thread holds, posted nothing, so it hands nothing over; nor does a key
 * sent again with other words, which answers the comment first posted under
 * it, whose words, not the new ones, say whom it asks.
 */
const commentAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsAppSeams,
  request: Request,
  outcome: PlanCommentOutcome,
  created: boolean,
  comment: MentioningComment,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlanCommentsServices> {
  if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
    return yield* outcomeAnswer(outcome, created);
  }
  const { thread } = outcome.answer;
  const unsent = thread.entries.some(
    (entry) =>
      entry.kind === PLAN_COMMENT_ENTRY.COMMENT &&
      entry.writer.by?.userId === comment.userId &&
      entry.words === comment.words,
  )
    ? yield* mentionsHandedOver(seams, request, thread, comment)
    : [];
  if (unsent.length === 0) return yield* outcomeAnswer(outcome, created);
  return hostedJsonResponse(created ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK, {
    thread,
    unsent,
  });
});

/**
 * The thread handed to each one a member's words mention with \`@\`: Luke,
 * where they mention this task's, and each of the task's standing agents;
 * an agent of another task, or an archived one, is a reference, which asks
 * no one. Each ask is written under a key drawn from the words' own, so the
 * words sent again ask no one twice. A hand-over that does not land is taken
 * back, the words posted all the same. Answers the ones asked who could not
 * take it.
 */
const mentionsHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsAppSeams,
  request: Request,
  thread: PlanCommentThread,
  comment: MentioningComment,
) {
  const { userId, taskId } = comment;
  const asked = askedInWords(comment.words, taskId);
  const tos: readonly PlanCommentAsked[] = [
    ...(asked.luke ? [{ actor: PLAN_COMMENT_ACTOR.LUKE }] : []),
    ...asked.agentIds.map((agentId) => ({ actor: PLAN_COMMENT_ACTOR.AGENT, agentId })),
  ];
  const unsent: PlanCommentAsked[] = [];
  for (const to of tos) {
    const landed = yield* Effect.gen(function* () {
      const agent = yield* askableAgent(userId, taskId, to);
      if (to.actor === PLAN_COMMENT_ACTOR.AGENT && agent === undefined) return true;
      const ask = {
        action: PLAN_COMMENT_ACTION.ASK,
        clientKey: mentionKey(comment.clientKey, to),
        to,
      } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        actOnPlanCommentThread(
          { actor: PLAN_COMMENT_ACTOR.MEMBER, userId },
          taskId,
          thread.id,
          ask,
        ),
      );
      if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) {
        return false;
      }
      yield* askHandedOver(seams, request, {
        userId,
        taskId,
        thread: outcome.answer.thread,
        clientKey: ask.clientKey,
        words: comment.words,
        to:
          agent === undefined
            ? { actor: PLAN_COMMENT_ACTOR.LUKE }
            : { actor: PLAN_COMMENT_ACTOR.AGENT, agent },
      });
      return true;
    }).pipe(
      // Note that one mention not taken leaves the others, and the words, as they are, and is said back.
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!landed) unsent.push(to);
  }
  return unsent;
});

/**
 * The key a mention's ask is written under: the words' own and whom it
 * asks, each kept whole in one encoded record rather than spelled into one
 * another, so no two comments and recipients spell the same key, and each is
 * asked once whatever times the words are sent.
 */
function mentionKey(clientKey: string, to: PlanCommentAsked): string {
  return JSON.stringify({ comment: clientKey, actor: to.actor, agent: to.agentId ?? null });
}

/**
 * An ask written in the thread handed to the one asked, in the words of the
 * thread as it now stands, its line taken back where the hand-over fails, so
 * the thread never says someone was asked who was not.
 */
const askHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsAppSeams,
  request: Request,
  input: {
    readonly userId: string;
    readonly taskId: string;
    readonly thread: PlanCommentThread;
    readonly clientKey: string;
    readonly words: string;
    readonly to: CommentRecipient;
  },
) {
  const { userId, taskId, thread, clientKey, words, to } = input;
  // The member's own newest ask names them, since an earlier one may be another member's.
  const asked = thread.entries.findLast(
    (entry) => entry.kind === PLAN_COMMENT_ENTRY.ASKED && entry.writer.by?.userId === userId,
  );
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const text = commentAskMessage({
    taskName: task.value.task.name,
    thread,
    sender: asked?.writer.by?.name ?? "A member",
    toLuke: to.actor === PLAN_COMMENT_ACTOR.LUKE,
  });
  yield* handCommentAskOver(seams, request, { userId, taskId, to, clientKey, text, words }).pipe(
    Effect.onError(() =>
      withdrawPlanCommentAsk(taskId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
});

/** The group: the comment paths, and the hosted vocabulary's own refusal for any other. */
export function planCommentsApp(seams: PlanCommentsAppSeams): WebRoutes<PlanCommentsAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      PLAN_COMMENTS_PATH.COMMENTS,
      hostedRefusing(commentsEndpoint(seams)),
    ),
    HttpRouter.add(ANY_METHOD, PLAN_COMMENTS_PATH.THREAD, hostedRefusing(threadEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
