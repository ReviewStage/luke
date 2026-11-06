import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  taskCommentsLiveRowsSchema,
  threadsOfLiveRows,
} from "@repo/features/description-comment-live";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { COMMENT_SUBJECT, type TasksCommentsFollow } from "@repo/features/tasks-view";
import { type EntityPool, fieldKind, type HeldRows } from "@repo/sync";
import { Data, Effect, Option, Schema } from "effect";
import { type AppDescriptionComments, NO_DESCRIPTION_COMMENTS } from "./app-state.js";
import { type HeldAnswers, heldSlice } from "./live-collection.js";
import { confirmWrite, type SealedRead, type TxWait } from "./live-follow.js";
import { pushLive } from "./live-push.js";

export type CommentThreadRow = DescriptionCommentThread & { readonly taskId: string };

export const COMMENT_THREAD = fieldKind((row: CommentThreadRow) => row.id);

export class CommentSubjectKey extends Data.Class<{
  readonly taskId: string;
  readonly pageId: string | undefined;
}> {}

export function commentSubjectOf(follow: TasksCommentsFollow): CommentSubjectKey {
  return new CommentSubjectKey({ taskId: follow.taskId, pageId: follow.pageId });
}

function followOf(subject: CommentSubjectKey): TasksCommentsFollow {
  return subject.pageId === undefined
    ? { taskId: subject.taskId }
    : { taskId: subject.taskId, pageId: subject.pageId };
}

function drawnThread({ taskId: _taskId, ...thread }: CommentThreadRow): DescriptionCommentThread {
  return thread;
}

type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface DescriptionCommentReadsDependencies {
  readonly pool: EntityPool;
  readonly seal: (
    subject: TasksCommentsFollow,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<SealedRead<"threads" | "entries" | "files"> | SealFailure>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly tell: (held: AppDescriptionComments) => void;
}

const decodeRows = Schema.decodeUnknownOption(taskCommentsLiveRowsSchema);

export function descriptionCommentReads(dependencies: DescriptionCommentReadsDependencies) {
  const follow = (
    subject: CommentSubjectKey,
    answers: HeldAnswers<readonly DescriptionCommentThread[]>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
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
          adopts: (row) => row.taskId === subject.taskId && row.page?.id === subject.pageId,
        });
        const drawn = () => {
          if (answered && open) answers.answered(threads.rows().map(drawnThread));
        };
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
