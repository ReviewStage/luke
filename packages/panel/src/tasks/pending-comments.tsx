import type { GitHubPerson, PendingReviewComment, ReviewThread } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  Comment,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  QuietWords,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { CommentMenu } from "./comment-menu.js";
import { useNamer } from "./pull-request-people.js";
import { noop, useThreadWriting } from "./pull-request-thread-actions.js";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes.js";
import { ReplyForm, type ReplyFormWords } from "./reply-form.js";

/**
 * pending-comments.tsx -- the member's own pending review comments, which nobody else sees until they submit the review, drawn as GitHub draws them: on their lines in Files changed, each marked Pending, with Edit and Delete in its ⋯.
 *
 * The conversation's read carries them beside the review they hold
 * pending, read on their own token (`pendingReview.drafts`). Each is drawn
 * where a review thread is drawn, so it is placed as threads are, on its
 * line, a gap opened over it included, or above the diff, and counted in a
 * minimized line's chip (`pendingThreadsOf`): a reply on a published thread
 * as that thread's last comment, and one that starts a thread as a thread
 * of its own, keyed by the comment's own id, which no thread's page is. A
 * comment drawn so is told apart by that key (`PendingCommentsProvider`),
 * and draws itself Pending, in the member's own name, with a ⋯ where every
 * comment wears one (`CommentMenu`): beside a reply's name, and at the head
 * of the card a thread it starts stands in. Its Edit opens its words in
 * place, and its Delete asks first, since it cannot be undone. Each is one change on GitHub as the member
 * (`PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT`, `DELETE_REVIEW_COMMENT`),
 * which the service holds to their own pending review on this pull
 * request; GitHub's refusal stands under the comment in its words, and the
 * tab reads the conversation again whatever GitHub answered.
 */

/** What a pending comment says of itself and its presses. */
export const PENDING_WORDS = {
  PENDING: "Pending",
  EDIT: "Edit",
  DELETE: "Delete",
} as const;

/** What the edit's form is named, asks for, and says. */
const EDIT_WORDS: ReplyFormWords = {
  field: "Pending comment",
  placeholder: "Edit comment",
  cancel: "Cancel",
  send: "Save",
  sending: "Saving",
};

/** What Delete asks before it takes a pending comment out of the review. */
const DELETE_QUESTION: DialogQuestion = {
  title: "Delete this pending comment?",
  body: IRREVERSIBLE_WORDS,
  verb: "Delete comment",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** A pending comment as the comment of a thread it is drawn as: keyed by its own id. */
function commentOf(draft: PendingReviewComment): ReviewThread["comments"][number] {
  return { by: draft.by, html: draft.html, body: draft.body, at: draft.at, url: draft.id };
}

/** A pending comment that starts a thread, as a thread of its own on its lines, open and current, with no id a reply or a resolve could name. */
function threadOf(draft: PendingReviewComment): ReviewThread {
  return {
    path: draft.path,
    line: draft.line,
    startLine: draft.startLine,
    originalLine: draft.line,
    originalStartLine: draft.startLine,
    side: draft.side,
    startSide: draft.startSide,
    diffHunk: "",
    resolved: false,
    outdated: false,
    comments: [commentOf(draft)],
    more: 0,
  };
}

/**
 * The review threads with the member's pending comments among them: a reply
 * on a published thread as that thread's last comment, and every other
 * comment as a thread of its own after them, oldest first. The threads are
 * handed back as they are where no comment is pending.
 */
export function pendingThreadsOf(
  threads: readonly ReviewThread[],
  drafts: readonly PendingReviewComment[],
): readonly ReviewThread[] {
  if (drafts.length === 0) return threads;
  const replies = new Map<string, PendingReviewComment[]>();
  const known = new Set(threads.flatMap((thread) => (thread.id === undefined ? [] : [thread.id])));
  const starts: PendingReviewComment[] = [];
  for (const draft of drafts) {
    const threadId = draft.threadId;
    if (threadId === undefined || !known.has(threadId)) starts.push(draft);
    else replies.set(threadId, [...(replies.get(threadId) ?? []), draft]);
  }
  const replied = threads.map((thread) => {
    const own = thread.id === undefined ? undefined : replies.get(thread.id);
    return own === undefined
      ? thread
      : { ...thread, comments: [...thread.comments, ...own.map(commentOf)] };
  });
  return [...replied, ...starts.map(threadOf)];
}

/** The member's pending comments by the key each is drawn under, its own id. */
export type PendingComments = ReadonlyMap<string, PendingReviewComment>;

const PendingCommentsContext = createContext<PendingComments>(new Map());

/** Tells every comment drawn under it which of them are the member's pending ones. */
export const PendingCommentsProvider = PendingCommentsContext.Provider;

/** The member's pending comment drawn under `key`; none for any other comment. */
export function usePendingComment(key: string | undefined): PendingReviewComment | undefined {
  const pending = useContext(PendingCommentsContext);
  return key === undefined ? undefined : pending.get(key);
}

const PendingSurfaceContext = createContext(true);

/**
 * Whether the surface the pending comments under it are drawn on is shown:
 * Files changed hidden behind another view of the tab is not, and a
 * Delete's question asked there goes with it.
 */
export const PendingSurfaceProvider = PendingSurfaceContext.Provider;

/** Whether a thread is one a pending comment starts, which has no id to reply or resolve by, and no page on GitHub yet. */
export function usePendingThread(thread: ReviewThread): boolean {
  return usePendingComment(thread.comments[0]?.url) !== undefined;
}

/** The Pending words a pending comment and a thread it starts wear, a pull request's and a page's alike: the app's own words, unmasked. */
export function PendingWords(): React.JSX.Element {
  return (
    <QuietWords>
      <ReplayUnmask>{PENDING_WORDS.PENDING}</ReplayUnmask>
    </QuietWords>
  );
}

/** A pending comment's acts, as whatever draws it places them: its ⋯, at the end of the head that names it, and its body, its words or the field editing them. */
export interface PendingActs {
  /** Its ⋯ with Edit and Delete; nothing outside a tab that writes, or while its words are edited. */
  readonly menu: ReactNode;
  /** Its words, or the field over them while Edit is open; GitHub's refusal under them; and Delete's question. */
  readonly body: (words: ReactNode) => ReactNode;
}

/**
 * The acts on one of the member's pending comments, none where `draft` is
 * none: a ⋯, as every comment's (`CommentMenu`), with Edit, which opens its
 * words in place, Esc keeping what was written for the next Edit and Cancel
 * keeping nothing, and Delete, which asks first, since GitHub keeps no
 * pending comment it deletes. Outside a tab that writes, it offers neither.
 */
export function usePendingActs(
  draft: PendingReviewComment | undefined,
  /** Opens the card the comment stands in, folded or not, so what Edit or Delete opens is in view. */
  onAct?: (() => void) | undefined,
): PendingActs {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  const [editing, setEditing] = useState(false);
  const surfaceOpen = useContext(PendingSurfaceContext);
  const deleting = useConfirmDialog(
    { subject: draft !== undefined, surfaceOpen },
    writes.confirmAct({
      action: PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT,
      commentId: draft?.id ?? "",
    }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_COMMENT_DELETE),
  );
  const out = writes.pending;
  const groups: MenuAction[][] =
    draft === undefined || writing === undefined || editing || out !== undefined
      ? []
      : [
          [
            {
              label: PENDING_WORDS.EDIT,
              icon: <GLYPH.RENAME />,
              onSelect: () => {
                onAct?.();
                setEditing(true);
              },
            },
          ],
          [
            {
              label: PENDING_WORDS.DELETE,
              icon: <GLYPH.DELETE />,
              danger: true,
              onSelect: () => {
                onAct?.();
                deleting.ask();
              },
            },
          ],
        ];
  const body = (words: ReactNode): ReactNode =>
    draft === undefined ? (
      words
    ) : (
      <div className="flex min-w-0 flex-col gap-item-gap">
        {editing && writing !== undefined ? (
          <ReplyForm
            words={EDIT_WORDS}
            start={writing.edits.of(draft.id) ?? draft.body}
            busy={out !== undefined}
            sending={out === PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT}
            // Note that words written back to the comment's own are no edit, so none are held.
            onWrite={(next) => writing.edits.keep(draft.id, next === draft.body ? undefined : next)}
            onSend={(next) =>
              writes.write(
                {
                  action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT,
                  commentId: draft.id,
                  body: next,
                },
                () => {
                  writing.edits.keep(draft.id, undefined);
                  setEditing(false);
                },
              )
            }
            onLeave={() => setEditing(false)}
            onDiscard={() => {
              writing.edits.keep(draft.id, undefined);
              setEditing(false);
            }}
          />
        ) : (
          words
        )}
        <PullRequestWriteNote writes={writes} className="pull-request-thread-note" />
        <ConfirmDialog
          open
          confirm={deleting}
          question={DELETE_QUESTION}
          restoreTo={nextRowOrHead}
        />
      </div>
    );
  return { menu: <CommentMenu groups={groups} />, body };
}

/** One of the member's pending comments as the Review panel lists it, a comment of its own: its head, marked Pending, with its ⋯, then its body (`usePendingActs`). */
export function PendingComment({
  draft,
  head,
  words,
}: {
  draft: PendingReviewComment;
  /** Who wrote it and when, as every comment's head names them (`Comment`). */
  head: { readonly person: GitHubPerson; readonly at: number; readonly now: number };
  /** Its words as every comment's are drawn. */
  words: ReactNode;
}): React.JSX.Element {
  const acts = usePendingActs(draft);
  const writer = useNamer()(head.person);
  return (
    <Comment
      author={commentAuthor(writer)}
      nameRef={<ActorRef actor={writer} nameOnly />}
      at={head.at}
      now={head.now}
      trailing={
        <>
          <PendingWords />
          {acts.menu}
        </>
      }
    >
      {acts.body(words)}
    </Comment>
  );
}
