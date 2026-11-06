import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { BUTTON_VARIANT, Button, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
import { useRef, useState } from "react";
import { CommentEditor, overCommentBound } from "./comment-editor.js";
import {
  PullRequestWriteNote,
  type PullRequestWrites,
  type ReadAgain,
  usePullRequestWrites,
} from "./pull-request-writes.js";

const COMMENT_WORDS = {
  TITLE: "Add a comment",
  FIELD: "Comment",
  PLACEHOLDER: "Add a comment",
  SEND: "Comment",
  SENDING: "Commenting",
} as const;

export interface PullRequestComment {
  readonly writes: PullRequestWrites;
  readonly body: string;
  readonly setBody: (body: string) => void;
}

export function usePullRequestComment(agentId: string, onWritten: ReadAgain): PullRequestComment {
  const writes = usePullRequestWrites(agentId, onWritten);
  const [body, setBody] = useState("");
  return { writes, body, setBody };
}

export function PullRequestCommentBox({
  comment,
}: {
  comment: PullRequestComment;
}): React.JSX.Element {
  const { writes, body, setBody } = comment;
  const sending = writes.pending !== undefined;
  const field = useRef<HTMLElement>(null);
  const blank = body.trim() === "" || overCommentBound(body);
  const send = () => {
    if (blank || sending) return;
    writes.write({ action: PULL_REQUEST_ACTION.COMMENT, body }, () => setBody(""));
  };
  return (
    <section
      className="pull-request-section pull-request-comment-box flex flex-col gap-control-gap"
      aria-label={COMMENT_WORDS.TITLE}
    >
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        truncate
        className="pull-request-heading mx-0 mt-0 mb-item-gap flex items-baseline gap-item-gap px-row-inset"
      >
        {COMMENT_WORDS.TITLE}
      </Text>
      <CommentEditor
        label={COMMENT_WORDS.FIELD}
        placeholder={COMMENT_WORDS.PLACEHOLDER}
        value={body}
        onChange={setBody}
        busy={sending}
        onSubmit={send}
        onCancel={() => field.current?.blur()}
        fieldRef={field}
      />
      <PullRequestWriteNote writes={writes} className="pull-request-comment-note" />
      <div className="pull-request-comment-foot flex justify-end">
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          disabled={blank}
          busy={sending}
          busyLabel={COMMENT_WORDS.SENDING}
          onClick={send}
        >
          {COMMENT_WORDS.SEND}
        </Button>
      </div>
    </section>
  );
}
