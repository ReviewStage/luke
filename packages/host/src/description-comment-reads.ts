import {
  taskCommentsLiveRowsSchema,
  threadsOfLiveRows,
} from "@repo/features/description-comment-live";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { COMMENT_SUBJECT, type TasksCommentsFollow } from "@repo/features/tasks-view";
import { type EntityPool, fieldKind, type HeldRows } from "@repo/sync";
import { Data, Effect, Option, Schema } from "effect";
import { type AppDescriptionComments, NO_DESCRIPTION_COMMENTS } from "./app-state.js";
import { type HeldAnswers, heldSlice } from "./live-collection.js";
import { confirmWrite, type SealedRead, type TxWait } from "./live-follow.js";
import { pushLive } from "./live-push.js";

/**
 * description-comment-reads.ts -- a task's comments, its plan's own threads or one page's, each thread one row of the sync engine's pool, followed for main over the service's held poll while a window shows them, and told whole on the app state as they change, every write standing drawn over them.
 *
 * A thread is a kind of the pool (`@repo/sync`), its comments and the lines
 * of what happened to it carried on its row, since the read answers a
 * thread whole and every change of one, a comment's among them, moves the
 * thread's revision. The host follows a subject's live read (`live-push.ts`)
 * the first time a window holds it, and keeps the few let go latest
 * followed (`heldSlice`), so a window stepping back to a plan or a page
 * draws its threads from where they stand; every held subject is told on
 * the one slice the windows draw (`LIVE_READ.DESCRIPTION_COMMENTS`), a plan's by
 * its task and a page's by the page, never its version. A page's subject
 * names its task too, which the service reads it by.
 *
 * Each subject's read stands on the threads it answered, and on a thread a
 * write made under it while that write stands, so a thread started draws in
 * its subject before the service answers. A write to a thread
 * (`description-comment-writes.ts`) is drawn over it in whichever subject holds it
 * the moment it is asked, and stands until that subject's read carries its
 * transaction, through the wait its follow hands, or is taken back where
 * the service refused it. Nothing is drawn of a subject until its read
 * first answers.
 */

/** A thread as the pool holds it: the wire's thread and the task it is on, by which a subject's read knows a thread made under it. */
export type CommentThreadRow = DescriptionCommentThread & { readonly taskId: string };

/** A thread of a task's comments as the pool holds it, by its id, every write to it a change of its fields, its deletion, or a thread made. */
export const COMMENT_THREAD = fieldKind((row: CommentThreadRow) => row.id);

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

/** A thread as the windows draw it, without the task the pool keys its subject by. */
function drawnThread({ taskId: _taskId, ...thread }: CommentThreadRow): DescriptionCommentThread {
  return thread;
}

/** A read the service did not answer, `gone` where it names nothing the account reaches. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface DescriptionCommentReadsDependencies {
  /** The pool every subject's threads stand in. */
  readonly pool: EntityPool;
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
  readonly tell: (held: AppDescriptionComments) => void;
}

const decodeRows = Schema.decodeUnknownOption(taskCommentsLiveRowsSchema);

/**
 * The held lifetime over every subject's follow (`heldSlice`), told whole on
 * the held comments' slice: each subject's threads as its read last
 * answered them, every write standing drawn over them, kept where a later
 * read does not answer, and failed where it never answered. A subject the
 * service refuses is followed no longer (`pushLive`), until every window
 * lets it go and one holds it anew. Note that its type is the slice's as
 * `heldSlice` answers it, never spelled here, so it follows that type as it
 * moves.
 */
export function descriptionCommentReads(dependencies: DescriptionCommentReadsDependencies) {
  const follow = (
    subject: CommentSubjectKey,
    answers: HeldAnswers<readonly DescriptionCommentThread[]>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Note that nothing is drawn before the read first answers, nor once its follow was let go, since a follow let go draws for no window.
        let answered = false;
        let open = true;
        let wait: TxWait | undefined;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            open = false;
          }),
        );
        const threads: HeldRows<CommentThreadRow> = yield* dependencies.pool.stand(COMMENT_THREAD, {
          redraw: () => Effect.sync(() => drawn()),
          confirmation: () => (wait === undefined ? undefined : (txid) => confirmWrite(wait, txid)),
          // Note that a thread started shows in the subject it was started in alone: its task's plan, or the page it names.
          adopts: (row) => row.taskId === subject.taskId && row.page?.id === subject.pageId,
        });
        const drawn = () => {
          if (answered && open) answers.answered(threads.rows().map(drawnThread));
        };
        // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
        const userId = dependencies.accountId();
        yield* pushLive({
          seal: (poll, after) =>
            dependencies.gate() && userId !== undefined
              ? dependencies.seal(followOf(subject), userId, poll, after)
              : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
          decode: (rows) => Option.map(decodeRows(rows), threadsOfLiveRows),
          publish: (read) => {
            if (read === undefined) return Effect.sync(() => answers.unanswered());
            const rows = read.map((thread) => ({ ...thread, taskId: subject.taskId }));
            return Effect.andThen(
              threads.answer(rows),
              Effect.sync(() => {
                answered = true;
                drawn();
              }),
            );
          },
          onTxWait: (handed) => {
            wait = handed;
          },
        });
      }),
    );
  return heldSlice<typeof LIVE_READ.DESCRIPTION_COMMENTS, CommentSubjectKey>({
    empty: NO_DESCRIPTION_COMMENTS,
    path: (subject) =>
      subject.pageId === undefined
        ? [COMMENT_SUBJECT.DESCRIPTION, subject.taskId]
        : [COMMENT_SUBJECT.PAGE, subject.pageId],
    gate: dependencies.gate,
    follow,
    tell: dependencies.tell,
  });
}
