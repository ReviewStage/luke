import { Comment, type CommentAuthor } from "@luke/ui";

/**
 * inbox-comment.tsx -- one message of an Inbox thread as a comment, headed by who wrote it and when: the Inbox's thread draws every message so, and Chat draws an ask's answer so.
 */

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
 * One message of the thread as a comment (`Comment`): its writer's face on
 * the gutter's line, their name as the caller's ref hanging their card, when
 * they wrote it, and what stands at the head's end, then what they wrote
 * under it. The face is the thread's gutter: it stands out to the left of
 * the words, on the line that runs down through every face to join the
 * comments, as an issue's timeline joins them.
 */
export function InboxComment({
  kind,
  author,
  nameRef,
  at,
  now,
  trailing,
  messageId,
  children,
}: {
  kind: CommentKind;
  author: CommentAuthor;
  /** The writer's name as the window names anyone, hanging their card. */
  nameRef: React.ReactNode;
  /** When they wrote it; none for the reader's draft reply. */
  at?: number | undefined;
  now?: number | undefined;
  /** What stands at the head's end: where an answer went. */
  trailing?: React.ReactNode;
  /** The message a thread's message comment draws, which a send scrolls to. */
  messageId?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="inbox-comment" data-inbox-comment={kind} data-message-id={messageId}>
      <Comment author={author} nameRef={nameRef} at={at} now={now} trailing={trailing}>
        {children === undefined ? undefined : <div className="inbox-comment-body">{children}</div>}
      </Comment>
    </li>
  );
}
