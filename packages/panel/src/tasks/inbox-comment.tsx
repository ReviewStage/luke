import { Comment, type CommentAuthor, cn } from "@luke/ui";

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
 * An Inbox thread's comments, each its writer's chip, their face on the
 * gutter's line, and its words under it; the thread stands flush on what the
 * log says under it, rather than a log line's step apart.
 */
export const INBOX_THREAD = "inbox-thread mb-0";

/**
 * A comment of the thread, its words a step under its head and a step over
 * the next comment, and the line that runs from its face down to the next
 * one's, under it, since each face's head stands over the line in a ring of
 * the ground that cuts the line short of the face.
 */
const INBOX_COMMENT =
  "inbox-comment relative isolate flex min-w-0 flex-col gap-tight-gap pb-luke-20 last:pb-0 not-last:before:absolute not-last:before:top-inbox-face-half not-last:before:-bottom-inbox-face-half not-last:before:left-inbox-line not-last:before:-z-1 not-last:before:w-luke-2 not-last:before:bg-border not-last:before:content-['']";

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
    <li className={INBOX_COMMENT} data-inbox-comment={kind} data-message-id={messageId}>
      <Comment author={author} nameRef={nameRef} at={at} now={now} trailing={trailing}>
        {children === undefined ? undefined : (
          // Note that the reader's draft reply lets what stands over its box's field, its @ and / lists, run past the comment.
          <div
            className={cn(
              "inbox-comment-body flex min-w-0 flex-col gap-control-gap text-body-size leading-reading text-foreground",
              kind === COMMENT.DRAFT
                ? "overflow-visible"
                : "overflow-clip [overflow-clip-margin:var(--luke-focus-ring-room)]",
            )}
          >
            {children}
          </div>
        )}
      </Comment>
    </li>
  );
}
