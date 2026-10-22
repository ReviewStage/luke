/**
 * inbox-comment.tsx -- one message of an Inbox thread as a comment, headed by who wrote it and when: the Inbox's thread draws every message so, and Chat draws an ask's answer so.
 */

/** How long ago a thread's line says something happened: in the caption type, quieter still, in tabular figures, as a card's corner says it (`.thread-time`, tasks.css). */
export const THREAD_TIME_CLASS = "thread-time";

/** Which message of the thread a comment is: the agent's question, the developer's answer, the agent taking the item back, a member closing it without an answer, a message on the thread, or the reader's draft reply at its end. */
export const COMMENT = {
  ASKED: "asked",
  ANSWERED: "answered",
  WITHDRAWN: "withdrawn",
  CLOSED: "closed",
  MESSAGE: "message",
  DRAFT: "draft",
} as const;

type CommentKind = (typeof COMMENT)[keyof typeof COMMENT];

/**
 * One message of the thread as a comment: a line of who and when, then
 * what they wrote under it. The writer leads the line as the window names
 * anyone, their face and name as one chip hanging their card, and the
 * chip's face is the thread's gutter: it stands out to the left of the
 * words, on the line that runs down through every face to join the
 * comments, as an issue's timeline joins them.
 */
export function Comment({
  kind,
  head,
  messageId,
  children,
}: {
  kind: CommentKind;
  head: React.ReactNode;
  /** The message a thread's message comment draws, which a send scrolls to. */
  messageId?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="inbox-comment" data-inbox-comment={kind} data-message-id={messageId}>
      <div className="inbox-comment-head">{head}</div>
      {children === undefined ? null : <div className="inbox-comment-body">{children}</div>}
    </li>
  );
}

/** A comment's writer, their face and name as one chip, which hangs their card and opens their page or tab. */
export function CommentName({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="inbox-comment-name">{children}</span>;
}
