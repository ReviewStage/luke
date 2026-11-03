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
import { readPageById } from "@luke/database/models/plan-pages";
import { readTaskHeader, readTaskWorkspace } from "@luke/database/models/task-store";
import { TOPIC } from "@luke/database/sync/notification";
import { askedInWords } from "@luke/features/mention-link";
import { PAGE_SHOWER } from "@luke/features/page-wire";
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
 * Inbox is read, and woken by Sync on the plan's topic, so a window
 * hears a teammate's or an agent's comment the moment it lands; `POST`
 * starts a thread with its first comment, anchored to words of the plan's
 * text (`@luke/database/models/plan-comments`).
 * `POST /api/plans/{id}/comments/{thread}` is one thing done to a thread,
 * answered with the thread as it now stands. Every member of the plan's
 * workspace reads and writes every thread; a plan the account does not reach,
 * or an archived one for a write, answers as not found, and a thread the plan
 * does not hold as not found too. A member's comment reaches the agents in
 * its thread, each the thread handed to it (\`mentionsHandedOver\`): every
 * agent a comment was handed to before and every one that answered in it,
 * and each one of the task's agents its words mention with \`@\`, which
 * joins it.
 *
 * A page of the task is commented on through the same doors: the read names
 * the page to read its threads in the plan's place, and a start names the
 * page and the version it is on. The agent that showed the page's newest
 * version, its writer, is in every thread on the page from the start, so a
 * comment reaches whoever revises the page; one in a thread that cannot
 * take it, an archived agent say, is said back as not sent, the comment
 * posted all the same.
 *
 * The read stays a long-held JSON answer: the hold is the route's own,
 * `heldUntilMoved` under the coding agents' hold, and nothing the handler
 * adds times it out first.
 */

export interface PlanCommentsProcedureSeams extends CommentAskSeams {
  resolveUserId: UserIdResolver;
}

/**
 * The plan's threads as they stand, held while its cursor is still the
 * reader's; nothing where the account reaches no such plan. The hold is
 * woken by a write to the plan's threads or their entries, or to the task,
 * all on the task's topic, and by a change to what admits the reader to the
 * task, their membership and GitHub reach, on their own topic.
 */
function planCommentsPast(
  userId: string,
  taskId: string,
  after: string,
  pageId: string | undefined,
): Effect.Effect<Option.Option<PlanCommentsAnswer>, StoreFailure, DatabaseServices> {
  return heldUntilMoved(
    planCommentStamps(userId, taskId, pageId),
    after,
    [
      [TOPIC.TASK, taskId],
      [TOPIC.ACCOUNT, userId],
    ],
    CODER.MESSAGES_POLL,
    CODER.MESSAGES_HOLD,
  ).pipe(
    Effect.andThen(readPlanCommentThreads(userId, taskId, pageId)),
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
  /** Whether it replied on a thread, or started one. */
  readonly isReply: boolean;
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
  // Note that a retry under the key already taken wrote nothing, so it is not counted again.
  if (outcome.status === PLAN_COMMENT_OUTCOME.DONE && outcome.repeated !== true) {
    yield* recordServerEventIn(
      SERVER_EVENT.PLAN_COMMENT,
      comment.userId,
      readTaskWorkspace(comment.userId, comment.taskId),
      { is_reply: comment.isReply },
    );
  }
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
 * The writer of the page a thread is on: the agent that showed its newest
 * version, or the app where it showed it; none for a thread on the plan, or
 * a page shown before who showed it was kept.
 */
const pageWriterOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  thread: PlanCommentThread,
): Effect.fn.Return<PlanCommentAsked | undefined, HostedRefusal, DatabaseServices> {
  if (thread.page === undefined) return undefined;
  const found = yield* hostedStoreOrUnavailable(readPageById(userId, thread.page.id, undefined));
  const shownBy = Option.getOrUndefined(found)?.page.shownBy;
  if (shownBy === undefined) return undefined;
  return shownBy.kind === PAGE_SHOWER.AGENT
    ? { actor: PLAN_COMMENT_ACTOR.AGENT, agentId: shownBy.agentId }
    : { actor: PLAN_COMMENT_ACTOR.LUKE };
});

/** One the thread is handed to, and whether a hand-over that could not land is said back, as one asked whatever the words say is. */
interface HandOver {
  readonly to: PlanCommentAsked;
  readonly owed: boolean;
}

/**
 * The agents in a thread, in the order they joined it: on a page's thread
 * the page's writer from the start, then each agent a comment was handed to
 * and each that answered in it.
 */
function agentsIn(
  thread: PlanCommentThread,
  writer: PlanCommentAsked | undefined,
): readonly PlanCommentAsked[] {
  const joined = thread.entries.flatMap((entry) => {
    const agentId =
      entry.kind === PLAN_COMMENT_ENTRY.ASKED
        ? entry.asked?.agentId
        : entry.kind === PLAN_COMMENT_ENTRY.COMMENT &&
            entry.writer.actor === PLAN_COMMENT_ACTOR.AGENT
          ? entry.writer.agentId
          : undefined;
    return agentId === undefined ? [] : [{ actor: PLAN_COMMENT_ACTOR.AGENT, agentId }];
  });
  return writer === undefined ? joined : [writer, ...joined];
}

/**
 * Whom a member's comment hands its thread to: the one rule of who a comment
 * wakes, for the plan's threads and the pages' alike, which is that a thread
 * reaches the agents in it (\`agentsIn\`), and each agent its words mention
 * with \`@\` joins it. One already in the thread that cannot take it, an
 * archived one say, is said back as not sent; a mention of one that cannot
 * take it is a reference, which asks no one.
 */
function handedTo(
  thread: PlanCommentThread,
  words: string,
  writer: PlanCommentAsked | undefined,
): readonly HandOver[] {
  const handOvers = new Map<string | undefined, HandOver>();
  for (const to of agentsIn(thread, writer)) {
    if (!handOvers.has(to.agentId)) handOvers.set(to.agentId, { to, owed: true });
  }
  for (const agentId of askedInWords(words)) {
    if (!handOvers.has(agentId)) {
      handOvers.set(agentId, { to: { actor: PLAN_COMMENT_ACTOR.AGENT, agentId }, owed: false });
    }
  }
  return [...handOvers.values()];
}

/**
 * The thread handed to each of the task's standing agents the comment reaches
 * (\`handedTo\`); an agent of another task, or an archived one, cannot take
 * it, and neither can the app's own assistant, which no task has any more.
 * Who can take it is read before the answer, which says back the ones in the
 * thread who could not; the hand-overs themselves run past it
 * (\`afterResponse\`), because waking an idle agent resumes its sandbox, which
 * can outlast the member's request, and a comment posted must never read as
 * not posted. Each ask is written under a key drawn from the words' own, so
 * the words sent again ask no one twice; a hand-over that does not land is
 * taken back and logged, the words posted all the same.
 */
const mentionsHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsProcedureSeams,
  request: Request,
  thread: PlanCommentThread,
  comment: MentioningComment,
) {
  const { userId, taskId } = comment;
  // Note that a page that could not be read names no writer, so the comment asks only those its thread and words name.
  const writer = yield* pageWriterOf(userId, thread).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );
  const unsent: PlanCommentAsked[] = [];
  const taking: { readonly to: PlanCommentAsked; readonly agent: CommentRecipient }[] = [];
  for (const { to, owed } of handedTo(thread, comment.words, writer)) {
    const agent = yield* askableAgent(userId, taskId, to).pipe(
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
        handedOver(seams, request, thread, comment, to, agent).pipe(
          // Note that one hand-over not taken leaves the others, and the words, as they are.
          Effect.catch((refusal) =>
            Effect.logWarning(`a comment's hand-over was not taken: ${String(refusal)}`),
          ),
        ),
      { discard: true },
    ),
  );
  return unsent;
});

/** The ask written in the thread and the thread handed to the agent, under a key drawn from the comment's own. */
const handedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlanCommentsProcedureSeams,
  request: Request,
  thread: PlanCommentThread,
  comment: MentioningComment,
  to: PlanCommentAsked,
  agent: CommentRecipient,
) {
  const { userId, taskId } = comment;
  const ask = { action: PLAN_COMMENT_ACTION.ASK, clientKey: mentionKey(comment.clientKey, to), to };
  const outcome = yield* hostedStoreOrUnavailable(
    actOnPlanCommentThread({ actor: PLAN_COMMENT_ACTOR.MEMBER, userId }, taskId, thread.id, ask),
  );
  if (outcome.status !== PLAN_COMMENT_OUTCOME.DONE || !("thread" in outcome.answer)) return;
  yield* askHandedOver(seams, request, {
    userId,
    taskId,
    thread: outcome.answer.thread,
    clientKey: ask.clientKey,
    words: comment.words,
    to: agent,
  });
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
  // Note that a thread on a whole page quotes the page's title, which its line names already, so it quotes nothing.
  const line = {
    taskId,
    quote:
      thread.page !== undefined && thread.page.element === undefined ? undefined : thread.quote,
    page:
      thread.page === undefined || shown === undefined
        ? undefined
        : { id: thread.page.id, title: shown.title },
  };
  yield* handCommentAskOver(seams, request, {
    userId,
    to,
    clientKey,
    text,
    threadId,
    words,
    line,
  }).pipe(
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
      const taskId = yield* pathUuid(input.id);
      const read = yield* hostedStoreOrUnavailable(
        planCommentsPast(
          context.userId,
          taskId,
          input.after ?? PLAN_COMMENTS_CURSOR_START,
          input.page === undefined ? undefined : yield* pathUuid(input.page),
        ),
      );
      if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return read.value;
    }),
    start: member.start.effect(function* ({ input, context }) {
      const start = input.body;
      const taskId = yield* pathUuid(input.params.id);
      const writer = { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: context.userId } as const;
      const outcome = yield* hostedStoreOrUnavailable(
        startPlanCommentThread(writer, taskId, start),
      );
      const body = yield* commentAnswer(seams, context.request, outcome, {
        userId: context.userId,
        taskId,
        words: start.words,
        clientKey: start.clientKey,
        isReply: false,
      });
      return {
        status: "thread" in body ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK,
        body,
      };
    }),
    act: member.act.effect(function* ({ input, context }) {
      const action = input.body;
      const taskId = yield* pathUuid(input.params.id);
      const threadId = yield* pathUuid(input.params.thread);
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
        isReply: true,
      });
    }),
  };
}
