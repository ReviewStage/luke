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
import { askedInWords } from "@repo/features/mention-link";
import { PAGE_SHOWER } from "@repo/features/page-wire";
import { EXPERIMENT } from "@repo/settings";
import { COMMENT_LINE_BOUNDS } from "@repo/wire";
import { Effect, Option } from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import { experimentOnIn } from "../agents/workspace-experiment-on.js";
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

/**
 * description-comments-procedures.ts -- a description's comment threads for the desktop: read them as they change, start one, and answer, edit, resolve, reopen, or delete one.
 *
 * `GET /api/plans/{id}/comments` reads every thread of the description, held while
 * nothing moved since the cursor `after` names (`http/held-read.ts`), as the
 * Inbox is read, and woken by Sync on the plan's topic, so a window
 * hears a teammate's or an agent's comment the moment it lands; `POST`
 * starts a thread with its first comment, anchored to words of the description's
 * text (`@repo/database/models/description-comments`).
 * `POST /api/plans/{id}/comments/{thread}` is one thing done to a thread,
 * answered with the thread as it now stands. Every member of the plan's
 * workspace reads and writes every thread; a plan the account does not reach,
 * or an archived one for a write, answers as not found, and a thread the description
 * does not hold as not found too. A member's comment reaches the agents in
 * its thread, each the thread handed to it (`mentionsHandedOver`): every
 * agent a comment was handed to before and every one that answered in it,
 * and each one of the task's agents its words mention with `@`, which
 * joins it.
 *
 * A page of the task is commented on through the same doors: the read names
 * the page to read its threads in the description's place, and a start names the
 * page and the version it is on. The agent that showed the page's newest
 * version, its writer, is in every thread on the page from the start, so a
 * comment reaches whoever revises the page; one in a thread that cannot
 * take it, an archived agent say, is said back as not sent, the comment
 * posted all the same. A member's review of a page hands nothing over until
 * it is sent: each thread of it is started held, and the start that sends
 * it names them along, so each agent in any of them hears them all at once
 * (`reviewHandedOver`).
 *
 * The read stays a long-held JSON answer: the hold is the route's own,
 * `heldUntilMoved` under the coding agents' hold, and nothing the handler
 * adds times it out first.
 */

export interface DescriptionCommentsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/**
 * The description's threads as they stand, held while its cursor is still the
 * reader's; nothing where the account reaches no such plan. The hold is
 * woken by a write to the description's threads or their entries, or to the task,
 * all on the task's topic, and by a change to what admits the reader to the
 * task, their membership and GitHub reach, on their own topic.
 */
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

/** A write's outcome as the procedure answers it: the thread, its deletion, or a refusal in band; a plan or thread not reached as not found. */
const outcomeAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentOutcome,
): Effect.fn.Return<DescriptionCommentThreadAnswer, HostedRefusal> {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE)
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return outcome.answer;
});

/**
 * A write's answer with the transaction it committed in, where it wrote one,
 * so the desktop following the thread waits for it; the agents' tools and
 * the member MCP server answer without it.
 */
function withTxid(
  body: DescriptionCommentThreadAnswer,
  outcome: DescriptionCommentOutcome,
): DescriptionCommentThreadAnswer {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE || outcome.txid === undefined)
    return body;
  return "refused" in body ? body : { ...body, txid: outcome.txid };
}

/** A member's comment, as its mentions are read from it and handed over under its key. */
export interface MentioningComment {
  readonly userId: string;
  readonly taskId: string;
  readonly words: string;
  readonly clientKey: string;
  /** Whether it replied on a thread, or started one. */
  readonly isReply: boolean;
  /** Whether it started a thread held in a review, which hands it to no one yet. */
  readonly held?: boolean;
  /** The threads held in the review it sends, by their ids, handed over together with its own. */
  readonly along?: readonly string[];
}

/** A write the store took, with what it answers. */
type DescriptionCommentDone = Extract<
  DescriptionCommentOutcome,
  { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.DONE }
>;

/**
 * A member's comment the store took, answered: its thread, its mentions
 * handed over first, with the ones asked who could not take it, so the
 * member reads that they were not asked. A comment the store refused, at its
 * bound or under a key another thread holds, posted nothing, so it hands
 * nothing over; nor does a key sent again with other words, which answers
 * the comment first posted under it, whose words, not the new ones, say whom
 * it asks. The desktop's start and reply answer through it, and so does a
 * member's comment from the member MCP server (`../member-mcp/tools.ts`), so
 * a comment wakes the same agents whichever way the member sent it.
 */
export const memberCommentAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentDone,
  comment: MentioningComment,
) {
  const { answer } = outcome;
  if (!("thread" in answer)) return answer;
  // Note that a retry under the key already taken wrote nothing, so it is not counted again.
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

/** A comment's answer as the procedure answers it: as `memberCommentAnswer`, a plan or thread not reached as not found. */
const commentAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  outcome: DescriptionCommentOutcome,
  comment: MentioningComment,
) {
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return yield* memberCommentAnswer(outcome, comment);
});

/**
 * The writer of the page a thread is on: the agent that showed its newest
 * version, or the app where it showed it; none for a thread on the description, or
 * a page shown before who showed it was kept.
 */
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

/** One the thread is handed to, and whether a hand-over that could not land is said back, as one asked whatever the words say is. */
interface HandOver {
  readonly to: DescriptionCommentAsked;
  readonly owed: boolean;
}

/**
 * The agents in a thread, in the order they joined it: on a page's thread
 * the page's writer from the start, then each agent a comment was handed to
 * and each that answered in it.
 */
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

/**
 * Whom a member's comment hands its thread to: the one rule of who a comment
 * wakes, for the description's threads and the pages' alike, which is that a thread
 * reaches the agents in it (`agentsIn`), and each agent its words mention
 * with `@` joins it. One already in the thread that cannot take it, an
 * archived one say, is said back as not sent; a mention of one that cannot
 * take it is a reference, which asks no one.
 */
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

/**
 * The thread handed to each of the task's standing agents the comment reaches
 * (`handedTo`); an agent of another task, or an archived one, cannot take
 * it, and neither can the app's own assistant, which no task has any more.
 * Who can take it is read before the answer, which says back the ones in the
 * thread who could not; the hand-overs themselves run past it
 * (`afterResponse`), because waking an idle agent resumes its sandbox, which
 * can outlast the member's request, and a comment posted must never read as
 * not posted. Each ask is written under a key drawn from the words' own, so
 * the words sent again ask no one twice; a hand-over that does not land is
 * taken back and logged, the words posted all the same.
 */
const mentionsHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  thread: DescriptionCommentThread,
  comment: MentioningComment,
) {
  const { userId, taskId } = comment;
  // Note that a page that could not be read names no writer, so the comment asks only those its thread and words name.
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

/**
 * The key a mention's ask is written under: the words' own and whom it
 * asks, each kept whole in one encoded record rather than spelled into one
 * another, so no two comments and recipients spell the same key, and each is
 * asked once whatever times the words are sent.
 */
function mentionKey(clientKey: string, to: DescriptionCommentAsked): string {
  return JSON.stringify({ comment: clientKey, actor: to.actor, agent: to.agentId ?? null });
}

/**
 * An ask written in the thread handed to the one asked, in the words of the
 * thread as it now stands, its line taken back where the hand-over fails, so
 * the thread never says someone was asked who was not. A thread on the
 * description is handed over only while the task's workspace has Task
 * descriptions on, read again here because the hand-over runs past the
 * member's request (`afterResponse`), where the switch may have flipped
 * since `askableAgent` read it; one held back has its line taken back too.
 */
const askHandedOver = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
  readonly userId: string;
  readonly taskId: string;
  readonly thread: DescriptionCommentThread;
  readonly clientKey: string;
  readonly words: string;
  readonly to: CommentRecipient;
}) {
  const { userId, taskId, thread, clientKey, words, to } = input;
  // The member's own newest ask names them, since an earlier one may be another member's.
  const asked = thread.entries.findLast(
    (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED && entry.writer.by?.userId === userId,
  );
  const task = yield* hostedStoreOrUnavailable(readTaskHeader(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (
    thread.page === undefined &&
    !(yield* experimentOnIn(task.value.workspaceId, EXPERIMENT.DESCRIPTIONS))
  ) {
    return yield* withdrawnAsk(taskId, clientKey);
  }
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
  yield* handCommentAskOver({
    userId,
    to,
    clientKey,
    text,
    threadId,
    words,
    line,
  }).pipe(Effect.onError(() => withdrawnAsk(taskId, clientKey)));
});

/** The ask's line taken back from its thread; one that could not be is logged and left. */
function withdrawnAsk(taskId: string, clientKey: string) {
  return withdrawDescriptionCommentAsk(taskId, clientKey).pipe(
    Effect.tapError(logStoreFailure),
    Effect.ignore,
  );
}

/** Where a start stands in a review: held in one, sending one with the threads it names along, or in none. */
function reviewOf(start: DescriptionCommentStart): Pick<MentioningComment, "held" | "along"> {
  if (!("page" in start)) return {};
  if (start.held === true) return { held: true };
  return start.along === undefined ? {} : { along: start.along };
}

/** The member's own first comment in a thread, whose words say whom its thread is handed to. */
function firstWordsOf(thread: DescriptionCommentThread, userId: string): string | undefined {
  return thread.entries.find(
    (entry) =>
      entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT && entry.writer.by?.userId === userId,
  )?.words;
}

/** The threads a review sends, in the order they were started: each named along that the task holds, then the one sending it. */
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

/**
 * A review handed to each agent in any of its threads (`handedTo`, by each
 * thread's first comment), once with every thread of it that agent is in,
 * rather than once a comment; one in a thread that cannot take it is said
 * back as not sent, as a lone comment's is.
 */
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
  // Each one asked, with whether a hand-over that cannot land is said back and the threads they are in, by agent.
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
    // Note that a review's threads stand on one page, which Descriptions does not gate.
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

/**
 * The key a review's ask in one of its threads is written under: the key
 * of the comment sending the review, the thread, and whom it asks, each kept
 * whole in one encoded record, so the review sent again asks no one twice.
 */
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

/**
 * A review's words as its line in the transcript draws them, and as the
 * member's own words the agent's next turn reads: the member's words in each
 * thread, which open with the quote of the element it is on as the page's
 * comment field writes them, cut to the line's bound.
 */
function reviewLineWords(threads: readonly DescriptionCommentThread[], userId: string): string {
  const words = threads.map((thread) => firstWordsOf(thread, userId) ?? "").join("\n\n");
  return words.length > COMMENT_LINE_BOUNDS.WORDS_CHARS
    ? `${words.slice(0, COMMENT_LINE_BOUNDS.WORDS_CHARS - 1)}…`
    : words;
}

/**
 * An ask written in each thread of a review the agent is in, and the
 * threads handed to it in one message, as the member's; the asks are taken
 * back where the hand-over fails, so no thread says someone was asked who
 * was not.
 */
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

/** The description comments resource: its held read, a start, and one thing done to a thread, each to a signed-in member. */
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
