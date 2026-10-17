import { PULL_REQUEST_ACTION } from "@luke/features/pull-request-write-wire";
import { useState } from "react";
import { MarkdownField } from "./markdown-field";
import { PullRequestWriteNote, type PullRequestWrites } from "./pull-request-writes";

/**
 * pull-request-comment-box.tsx -- the comment box at the foot of an agent's pull request's Conversation, as GitHub's own: a new comment on the pull request itself, in Markdown.
 *
 * The comment is one change (`PULL_REQUEST_ACTION.COMMENT`), made on GitHub
 * by the service as the member pressing Comment, on their own GitHub
 * sign-in and never the Luke GitHub App's. Once GitHub took it the box lets
 * its words go and the tab reads the conversation again, so the comment
 * stands in it; GitHub's refusal stands under the box in its own words,
 * with the sign-in offered where GitHub would not take the member's, and
 * the words written stay for another try.
 */

/** The box's own words. */
const COMMENT_WORDS = {
  TITLE: "Add a comment",
  FIELD: "Comment",
  PLACEHOLDER: "Leave a comment in Markdown…",
  SEND: "Comment",
  SENDING: "Commenting…",
} as const;

/** The box: its heading, the words with their preview, GitHub's answer where it did not take the last one, and Comment, which ⌘↩ presses too. */
export function PullRequestCommentBox({
  writes,
}: {
  writes: PullRequestWrites;
}): React.JSX.Element {
  const [body, setBody] = useState("");
  const sending = writes.pending !== undefined;
  const blank = body.trim() === "";
  const send = () => {
    if (blank || sending) return;
    writes.write({ action: PULL_REQUEST_ACTION.COMMENT, body }, () => setBody(""));
  };
  return (
    <section
      className="pull-request-section pull-request-comment-box"
      aria-label={COMMENT_WORDS.TITLE}
    >
      <h3 className="pull-request-heading">{COMMENT_WORDS.TITLE}</h3>
      <MarkdownField
        label={COMMENT_WORDS.FIELD}
        placeholder={COMMENT_WORDS.PLACEHOLDER}
        value={body}
        onChange={setBody}
        readOnly={sending}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <PullRequestWriteNote writes={writes} className="pull-request-comment-note" />
      <div className="pull-request-comment-foot">
        <button
          type="button"
          className="primary-button"
          disabled={blank || sending}
          aria-busy={sending}
          onClick={send}
        >
          {sending ? COMMENT_WORDS.SENDING : COMMENT_WORDS.SEND}
        </button>
      </div>
    </section>
  );
}
