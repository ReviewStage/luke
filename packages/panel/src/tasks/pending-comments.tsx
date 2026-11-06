import type { GitHubPerson, PendingReviewComment, ReviewThread } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  Comment,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  QuietWords,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ActorRef, commentAuthor } from "../actor-ref.js";
import { confirmFailure } from "../failure-report.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";
import { useNamer } from "./pull-request-people.js";
import { noop, useThreadWriting } from "./pull-request-thread-actions.js";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes.js";
import { ReplyForm, type ReplyFormWords } from "./reply-form.js";

export const PENDING_WORDS = {
  PENDING: "Pending",
  EDIT: "Edit",
  DELETE: "Delete",
} as const;

const EDIT_WORDS: ReplyFormWords = {
  field: "Pending comment",
  placeholder: "Edit comment",
  cancel: "Cancel",
  send: "Save",
  sending: "Saving",
};

const DELETE_QUESTION: DialogQuestion = {
  title: "Delete this pending comment?",
  body: IRREVERSIBLE_WORDS,
  verb: "Delete comment",
  running: "Deleting",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

function commentOf(draft: PendingReviewComment): ReviewThread["comments"][number] {
  return { by: draft.by, html: draft.html, body: draft.body, at: draft.at, url: draft.id };
}

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

export type PendingComments = ReadonlyMap<string, PendingReviewComment>;

const PendingCommentsContext = createContext<PendingComments>(new Map());

export const PendingCommentsProvider = PendingCommentsContext.Provider;

export function usePendingComment(key: string | undefined): PendingReviewComment | undefined {
  const pending = useContext(PendingCommentsContext);
  return key === undefined ? undefined : pending.get(key);
}

const PendingSurfaceContext = createContext(true);

export const PendingSurfaceProvider = PendingSurfaceContext.Provider;

export function usePendingThread(thread: ReviewThread): boolean {
  return usePendingComment(thread.comments[0]?.url) !== undefined;
}

export function PendingWords(): React.JSX.Element {
  return <QuietWords>{PENDING_WORDS.PENDING}</QuietWords>;
}

export function PendingComment({
  draft,
  head,
  words,
  marked = true,
}: {
  draft: PendingReviewComment;
  marked?: boolean;
  head?: { readonly person: GitHubPerson; readonly at: number; readonly now: number } | undefined;
  words: ReactNode;
}): React.JSX.Element {
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  const [editing, setEditing] = useState(false);
  const surfaceOpen = useContext(PendingSurfaceContext);
  const deleting = useConfirmDialog(
    { subject: true, surfaceOpen },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT, commentId: draft.id }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_COMMENT_DELETE),
  );
  const out = writes.pending;
  const name = useNamer();
  const body = (
    <div className="flex min-w-0 flex-col gap-item-gap">
      {editing && writing !== undefined ? (
        <ReplyForm
          words={EDIT_WORDS}
          start={writing.edits.of(draft.id) ?? draft.body}
          busy={out !== undefined}
          sending={out === PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT}
          onWrite={(next) => writing.edits.keep(draft.id, next === draft.body ? undefined : next)}
          onSend={(body) =>
            writes.write(
              { action: PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT, commentId: draft.id, body },
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
      {writing === undefined || editing ? null : (
        <div className={`pull-request-thread-actions-row items-center ${ACTS_AT_END_CLASS}`}>
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.OUTLINE}
            icon={<GLYPH.RENAME />}
            disabled={out !== undefined}
            onClick={() => setEditing(true)}
          >
            {PENDING_WORDS.EDIT}
          </Button>
          <Button
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.DANGER_OUTLINE}
            icon={<GLYPH.DELETE />}
            disabled={out !== undefined}
            onClick={deleting.ask}
          >
            {PENDING_WORDS.DELETE}
          </Button>
        </div>
      )}
      <PullRequestWriteNote writes={writes} className="pull-request-thread-note" />
      <ConfirmDialog open confirm={deleting} question={DELETE_QUESTION} restoreTo={nextRowOrHead} />
    </div>
  );
  if (head === undefined) return body;
  const writer = name(head.person);
  return (
    <Comment
      author={commentAuthor(writer)}
      nameRef={<ActorRef actor={writer} nameOnly />}
      at={head.at}
      now={head.now}
      trailing={marked ? <PendingWords /> : undefined}
    >
      {body}
    </Comment>
  );
}
