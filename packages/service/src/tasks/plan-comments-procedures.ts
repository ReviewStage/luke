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
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENTS_CURSOR_START,
  type PlanCommentAsked,
  type PlanCommentsAnswer,
  type PlanCommentThread,
  type PlanCommentThreadAnswer,
} from "@luke/features/plan-comment-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { cursorOf, heldUntilMoved } from "../http/held-read.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  askableAgent,
  type CommentAskSeams,
  type CommentRecipient,
  commentAskMessage,
  handCommentAskOver,
} from "./comment-ask.js";

/**
 * plan-comments-procedures.ts -- a plan's comment threads for the desktop: read them as they change, start one, and answer, edit, resolve, reopen, or delete one.
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
 *
 * The read stays a long-held JSON answer: the hold is the route's own,
 * `heldUntilMoved` under the coding agents' hold, and nothing the handler
 * adds times it out first.
 */

export interface PlanCommentsProcedureSeams extends CommentAskSeams {
  resolveUserId: UserIdResolver;
}

/** The id a path named; one that is not a UUID names no row. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
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

/** A write's outcome as the procedure answers it: the thread, its deletion, or a refusal in band; a plan or thread not reached as not found. */
const outcomeAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: PlanCommentOutcome,
): Effect.fn.Return<PlanCommentThreadAnswer, HostedRefusal> {
  if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE)
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return outcome.answer;
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
  seams: PlanCommentsProcedureSeams,
  request: Request,
  outcome: PlanCommentOutcome,
  comment: MentioningComment,
) {
  const answer = yield* outcomeAnswer(outcome);
  if (!("thread" in answer)) return answer;
  const { thread } = answer;
  const unsent = thread.entries.some(
    (entry) =>
      entry.kind === PLAN_COMMENT_ENTRY.COMMENT &&
      entry.writer.by?.userId === comment.userId &&
      entry.words === comment.words,
  )
    ? yield* mentionsHandedOver(seams, request, thread, comment)
    : [];
  return unsent.length === 0 ? answer : { thread, unsent };
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
  seams: PlanCommentsProcedureSeams,
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
  seams: PlanCommentsProcedureSeams,
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

/** The plan comments resource: its held read, a start, and one thing done to a thread, each to a signed-in member. */
export function planCommentsProcedures(seams: PlanCommentsProcedureSeams) {
  const member = hosted.planComments.use(accountMiddleware(seams.resolveUserId));
  return {
    read: member.read.effect(function* ({ input, context }) {
      const taskId = yield* idOf(input.id);
      const read = yield* hostedStoreOrUnavailable(
        planCommentsPast(context.userId, taskId, input.after ?? PLAN_COMMENTS_CURSOR_START),
      );
      if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return read.value;
    }),
    start: member.start.effect(function* ({ input, context }) {
      const start = input.body;
      const taskId = yield* idOf(input.params.id);
      const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: context.userId } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        startPlanCommentThread(writer, taskId, start),
      );
      const body = yield* commentAnswer(seams, context.request, outcome, {
        userId: context.userId,
        taskId,
        words: start.words,
        clientKey: start.clientKey,
      });
      return {
        status: "thread" in body ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
        body,
      };
    }),
    act: member.act.effect(function* ({ input, context }) {
      const action = input.body;
      const taskId = yield* idOf(input.params.id);
      const threadId = yield* idOf(input.params.thread);
      const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: context.userId } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        actOnPlanCommentThread(writer, taskId, threadId, action),
      );
      if (action.action !== PLAN_COMMENT_ACTION.REPLY) return yield* outcomeAnswer(outcome);
      return yield* commentAnswer(seams, context.request, outcome, {
        userId: context.userId,
        taskId,
        words: action.words,
        clientKey: action.clientKey,
      });
    }),
  };
}
