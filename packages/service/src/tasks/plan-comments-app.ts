import type { DatabaseServices } from "@luke/database/core/query";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  planCommentStamps,
  planCommentStampsLiveStatement,
  readPlanCommentThreads,
  startPlanCommentThread,
} from "@luke/database/models/plan-comments";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentsAnswer,
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsCursorSchema,
} from "@luke/features/plan-comment-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { CODER } from "../agents/coder-host/bounds.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
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
import type { StoreFailure } from "../http/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

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
 * does not hold as not found too. Posting a comment asks no agent anything.
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
  PLAN: "id",
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

export interface PlanCommentsAppSeams {
  resolveUserId: UserIdResolver;
}

type PlanCommentsServices = DatabaseServices | HttpServerRequest.HttpServerRequest;

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
    Option.toArray(planCommentStampsLiveStatement(userId, taskId)),
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
    const taskId = yield* idOf(request, QUERY.PLAN);
    const userId = yield* resolvedUserId(seams, request);
    const after = yield* cursorQueryOf(request);
    const read = yield* hostedStoreOrUnavailable(planCommentsPast(userId, taskId, after));
    if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, read.value);
  }
  if (incoming.method !== HTTP_METHOD.POST)
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const taskId = yield* idOf(request, QUERY.PLAN);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_START_BODY_BYTES);
  const start = readEither(planCommentStartRequestSchema)(body);
  if (Result.isFailure(start)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId } as const;
  const outcome = yield* hostedStoreOrUnavailable(
    startPlanCommentThread(writer, taskId, start.success),
  );
  return yield* outcomeAnswer(outcome, true);
});

/** POST does one thing to one thread of the plan, as the member the bearer is. */
const threadEndpoint = /* @__PURE__ */ Effect.fn("web/planCommentThreadEndpoint")(function* (
  seams: PlanCommentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlanCommentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST)
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, QUERY.PLAN);
  const threadId = yield* idOf(request, QUERY.THREAD);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_ACTION_BODY_BYTES);
  const action = readEither(planCommentActionRequestSchema)(body);
  if (Result.isFailure(action)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId } as const;
  const outcome = yield* hostedStoreOrUnavailable(
    actOnPlanCommentThread(writer, taskId, threadId, action.success),
  );
  return yield* outcomeAnswer(outcome, false);
});

/** The group: the comment paths, and the hosted vocabulary's own refusal for any other. */
export function planCommentsApp(seams: PlanCommentsAppSeams): WebRoutes<DatabaseServices> {
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
