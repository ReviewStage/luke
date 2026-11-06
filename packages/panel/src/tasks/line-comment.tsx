import {
  PULL_REQUEST_ACTION,
  REVIEW_COMMENT_MODE,
  type ReviewCommentMode,
} from "@repo/features/pull-request-write-wire";
import { BUTTON_VARIANT, Button, CARD_CORNER, CARD_PADDING, Card } from "@repo/ui";
import { useState } from "react";
import { type CommentLines, commentLinesLabel } from "./changes-model.js";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import { ACTS_AT_END_CLASS } from "./pull-request-look.js";
import {
  PullRequestWriteNote,
  type ReadAgain,
  usePullRequestWrites,
  WRITE_NOTE,
} from "./pull-request-writes.js";

const NOTE_CLASS = "line-comment-note m-0 text-caption-inline text-muted-foreground";

const LINE_WORDS = {
  FIELD: "Comment",
  PLACEHOLDER: "Add a comment",
  CANCEL: "Cancel",
  SINGLE: "Add single comment",
  START: "Start a review",
  ADD: "Add review comment",
  SENDING: "Commenting",
  REFRESH: "Refresh changes",
  NO_HEAD: "Refresh changes to comment on these lines.",
  on: (lines: string) => `Comment on ${lines}`,
} as const;

export type PendingReview = { readonly comments: number } | null | undefined;

export function LineComment({
  agentId,
  path,
  lines,
  headSha,
  pending,
  body,
  onBody,
  suggestion,
  onActive,
  onClose,
  onWritten,
  onRefresh,
}: {
  agentId: string;
  path: string;
  lines: CommentLines;
  headSha: string | undefined;
  pending: PendingReview;
  body: string;
  onBody: (body: string) => void;
  suggestion: string | undefined;
  onActive?: (() => void) | undefined;
  onClose: () => void;
  onWritten: ReadAgain;
  onRefresh: () => void;
}): React.JSX.Element {
  const writes = usePullRequestWrites(agentId, onWritten);
  const [sentAs, setSentAs] = useState<ReviewCommentMode | undefined>(undefined);
  const sending = writes.pending !== undefined;
  const blank = body.trim() === "" || overCommentBound(body);
  const holding = pending != null;
  const send = (mode: ReviewCommentMode) => {
    if (blank || sending || headSha === undefined) return;
    setSentAs(mode);
    writes.write(
      { action: PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT, mode, path, ...lines, body, headSha },
      () => {
        onBody("");
        onClose();
      },
    );
  };
  const first = holding ? REVIEW_COMMENT_MODE.REVIEW : REVIEW_COMMENT_MODE.SINGLE;

  return (
    <Card
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      className="line-comment flex max-w-line-comment flex-col gap-control-gap px-list-inset pt-row-inset pb-list-inset"
      onFocus={onActive}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || sending) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p className="line-comment-head m-0 text-caption-inline font-ui-semibold text-muted-foreground">
        {LINE_WORDS.on(commentLinesLabel(lines))}
      </p>
      <CommentEditor
        label={LINE_WORDS.FIELD}
        placeholder={LINE_WORDS.PLACEHOLDER}
        value={body}
        onChange={onBody}
        busy={sending}
        focus
        onSubmit={() => send(first)}
        onCancel={() => {
          if (!sending) onClose();
        }}
        suggestion={suggestion}
      />
      {headSha === undefined ? <p className={NOTE_CLASS}>{LINE_WORDS.NO_HEAD}</p> : null}
      <PullRequestWriteNote writes={writes} className={NOTE_CLASS} />
      <div className={`line-comment-foot flex-wrap ${ACTS_AT_END_CLASS}`}>
        {headSha === undefined || writes.note?.kind === WRITE_NOTE.WORDS ? (
          <Button onClick={onRefresh}>{LINE_WORDS.REFRESH}</Button>
        ) : null}
        <Button disabled={sending} onClick={onClose}>
          {LINE_WORDS.CANCEL}
        </Button>
        {holding ? null : (
          <Button
            disabled={blank || headSha === undefined}
            busy={sending && sentAs === REVIEW_COMMENT_MODE.SINGLE}
            busyLabel={LINE_WORDS.SENDING}
            onClick={() => send(REVIEW_COMMENT_MODE.SINGLE)}
          >
            {LINE_WORDS.SINGLE}
          </Button>
        )}
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={blank || headSha === undefined}
          busy={sending && sentAs === REVIEW_COMMENT_MODE.REVIEW}
          busyLabel={LINE_WORDS.SENDING}
          onClick={() => send(REVIEW_COMMENT_MODE.REVIEW)}
        >
          {holding ? LINE_WORDS.ADD : LINE_WORDS.START}
        </Button>
      </div>
    </Card>
  );
}
