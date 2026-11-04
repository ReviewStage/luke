import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { taskCommentsLiveRowsSchema, threadsOfLiveRows } from "@repo/features/plan-comment-live";
import type { PlanCommentThread } from "@repo/features/plan-comment-wire";
import {
  COMMENT_SUBJECT,
  type TasksCommentAnswer,
  type TasksCommentsFollow,
} from "@repo/features/tasks-view";
import { Data, Effect, MutableHashMap, Option, Schema } from "effect";
import { type AppPlanComments, NO_PLAN_COMMENTS } from "./app-state.js";
import { type HeldAnswers, heldSlice } from "./live-collection.js";
import type { SealedRead } from "./live-follow.js";
import { pushLive } from "./live-push.js";

/**
 * plan-comment-reads.ts -- a task's comments, its plan's own threads or one page's, followed for main over the service's held poll while a window shows them, and told whole on the app state as they change, the windows' writes laid over them until the read holds them.
 *
 * The host follows a subject's live read (`live-push.ts`) the first time a
 * window holds it, and keeps the few let go latest followed (`heldSlice`),
 * so a window stepping back to a plan or a page draws its threads from
 * where they stand; every held subject is told on the one slice the windows
 * draw (`LIVE_READ.PLAN_COMMENTS`), a plan's by its task and a page's by
 * the page, never its version. A page's subject names its task too, which
 * the service reads it by.
 *
 * A write to a thread answers the thread as it then stands, which stands
 * over the read's row of it, in the subject its page names, until the read
 * holds that thread at its revision or later; every change of a thread
 * moves its revision, so no transaction need be waited on. A thread
 * deleted names no page, so it is hidden in whichever subject of its task
 * holds it, until a read lands without it.
 */

/** One subject of a task's comments, as the host keys its follow: the plan's own threads where it names no page. */
export class CommentSubjectKey extends Data.Class<{
  readonly taskId: string;
  readonly pageId: string | undefined;
}> {}

/** The subject a window names comments by, as their key. */
export function commentSubjectOf(follow: TasksCommentsFollow): CommentSubjectKey {
  return new CommentSubjectKey({ taskId: follow.taskId, pageId: follow.pageId });
}

/** The subject the service reads a key by. */
function followOf(subject: CommentSubjectKey): TasksCommentsFollow {
  return subject.pageId === undefined
    ? { taskId: subject.taskId }
    : { taskId: subject.taskId, pageId: subject.pageId };
}

/** A read the service did not answer, `gone` where it names nothing the account reaches. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface PlanCommentReadsDependencies {
  /** The subject's read for the account named, its rows inline, held past `after` where it names one; or why the service answered none. */
  readonly seal: (
    subject: TasksCommentsFollow,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<SealedRead<"threads" | "entries" | "files"> | SealFailure>;
  /** The account signed in now, which a follow is read for from its first read on; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  readonly tell: (held: AppPlanComments) => void;
}

/** A thread a write answered, and whether a read has held it since, at an earlier revision. */
interface Written {
  readonly thread: PlanCommentThread;
  readonly seen: boolean;
}

/** Where one followed subject stands: its read's threads once it answered, and the writes laid over them. */
interface SubjectStanding {
  read: readonly PlanCommentThread[] | undefined;
  readonly written: Map<string, Written>;
  readonly deleted: Set<string>;
  readonly answers: HeldAnswers<readonly PlanCommentThread[]>;
}

/**
 * The writes let go that the read holds now: a thread it holds at the
 * written revision or later, one it held and has since dropped, and a
 * deletion it no longer holds.
 */
function settled(standing: SubjectStanding, read: readonly PlanCommentThread[]): void {
  const held = new Map(read.map((thread) => [thread.id, thread]));
  for (const [id, written] of standing.written) {
    const now = held.get(id);
    if (now === undefined ? written.seen : now.revision >= written.thread.revision) {
      standing.written.delete(id);
    } else if (now !== undefined) standing.written.set(id, { ...written, seen: true });
  }
  for (const id of standing.deleted) if (!held.has(id)) standing.deleted.delete(id);
}

/** The subject's threads as the windows draw them: the read's, each written one in place of its row or after them where new, and none deleted. */
function laid(standing: SubjectStanding, read: readonly PlanCommentThread[]) {
  const drawn = read.map((thread) => standing.written.get(thread.id)?.thread ?? thread);
  const added = [...standing.written.values()]
    .map((written) => written.thread)
    .filter((thread) => !read.some((each) => each.id === thread.id));
  return [...drawn, ...added].filter((thread) => !standing.deleted.has(thread.id));
}

/** Whether a subject holds a thread, as read or as written. */
function holds(standing: SubjectStanding, threadId: string): boolean {
  return (
    standing.written.has(threadId) ||
    (standing.read?.some((thread) => thread.id === threadId) ?? false)
  );
}

const decodeRows = Schema.decodeUnknownOption(taskCommentsLiveRowsSchema);

/**
 * The held lifetime over every subject's follow (`heldSlice`), told whole on
 * the held comments' slice: each subject's threads as its read last
 * answered them, the windows' writes laid over them, kept where a later
 * read does not answer, and failed where it never answered. A subject the
 * service refuses is followed no longer (`pushLive`), until every window
 * lets it go and one holds it anew. Beside the slice's own doors it answers
 * `answered`: a write's answer on a task's comments, laid over the subject
 * it moved where a window holds it, a refusal or no answer laying nothing.
 * Note that its type is the slice's as `heldSlice` answers it, never spelled
 * here, so it follows that type as it moves.
 */
export function planCommentReads(dependencies: PlanCommentReadsDependencies) {
  return Effect.gen(function* () {
    const followed = MutableHashMap.empty<CommentSubjectKey, SubjectStanding>();
    const told = (standing: SubjectStanding) => {
      if (standing.read !== undefined) standing.answers.answered(laid(standing, standing.read));
    };
    const follow = (
      subject: CommentSubjectKey,
      answers: HeldAnswers<readonly PlanCommentThread[]>,
    ) => {
      const standing: SubjectStanding = {
        read: undefined,
        written: new Map(),
        deleted: new Set(),
        answers,
      };
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.accountId();
      const pushed = pushLive({
        seal: (poll, after) =>
          dependencies.gate() && userId !== undefined
            ? dependencies.seal(followOf(subject), userId, poll, after)
            : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
        decode: (rows) => Option.map(decodeRows(rows), threadsOfLiveRows),
        publish: (threads) => {
          if (threads === undefined) return answers.unanswered();
          settled(standing, threads);
          standing.read = threads;
          told(standing);
        },
      });
      return Effect.ensuring(
        Effect.andThen(
          Effect.sync(() => MutableHashMap.set(followed, subject, standing)),
          pushed,
        ),
        Effect.sync(() => {
          if (Option.getOrUndefined(MutableHashMap.get(followed, subject)) === standing) {
            MutableHashMap.remove(followed, subject);
          }
        }),
      );
    };
    const held = yield* heldSlice<typeof LIVE_READ.PLAN_COMMENTS, CommentSubjectKey>({
      empty: NO_PLAN_COMMENTS,
      path: (subject) =>
        subject.pageId === undefined
          ? [COMMENT_SUBJECT.PLAN, subject.taskId]
          : [COMMENT_SUBJECT.PAGE, subject.pageId],
      gate: dependencies.gate,
      follow,
      tell: dependencies.tell,
    });
    const answered = (taskId: string, answer: TasksCommentAnswer): void => {
      if ("thread" in answer) {
        const { thread } = answer;
        const subject = new CommentSubjectKey({ taskId, pageId: thread.page?.id });
        const standing = Option.getOrUndefined(MutableHashMap.get(followed, subject));
        if (standing === undefined) return;
        const was = standing.written.get(thread.id);
        // Note that an answer may land after a later one of its thread, as one whose mentions waited on the hand-over does, so the later one stays.
        if (was !== undefined && was.thread.revision > thread.revision) return;
        standing.written.set(thread.id, { thread, seen: was?.seen ?? false });
        told(standing);
        return;
      }
      if (!("deleted" in answer)) return;
      for (const [subject, standing] of followed) {
        if (subject.taskId !== taskId || !holds(standing, answer.deleted)) continue;
        standing.written.delete(answer.deleted);
        standing.deleted.add(answer.deleted);
        told(standing);
      }
    };
    return { ...held, answered };
  });
}
