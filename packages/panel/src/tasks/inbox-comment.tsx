import { Comment, type CommentAuthor, cn } from "@repo/ui";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { REPLY_SCOPE } from "./reply-to-selection.js";

export const COMMENT = {
  ASKED: "asked",
  ANSWERED: "answered",
  WITHDRAWN: "withdrawn",
  REPLACED: "replaced",
  CLOSED: "closed",
  MESSAGE: "message",
  DRAFT: "draft",
} as const;

type CommentKind = (typeof COMMENT)[keyof typeof COMMENT];

export const INBOX_THREAD = "inbox-thread mb-0";

const INBOX_COMMENT =
  "inbox-comment relative isolate flex min-w-0 flex-col gap-tight-gap pb-ui-20 last:pb-0 not-last:before:absolute not-last:before:top-inbox-face-half not-last:before:-bottom-inbox-face-half not-last:before:left-inbox-line not-last:before:-z-1 not-last:before:w-ui-2 not-last:before:bg-border not-last:before:content-['']";

export function InboxComment({
  kind,
  author,
  nameRef,
  said,
  at,
  now,
  trailing,
  messageId,
  place,
  children,
}: {
  kind: CommentKind;
  author: CommentAuthor;
  nameRef: React.ReactNode;
  said?: string | undefined;
  at?: number | undefined;
  now?: number | undefined;
  trailing?: React.ReactNode;
  messageId?: string | undefined;
  place: VirtualRowPlace;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <li {...place} className={INBOX_COMMENT} data-inbox-comment={kind} data-message-id={messageId}>
      <Comment author={author} nameRef={nameRef} said={said} at={at} now={now} trailing={trailing}>
        {children === undefined ? undefined : (
          <div
            className={cn(
              "inbox-comment-body flex min-w-0 flex-col gap-control-gap text-body-size leading-reading text-foreground",
              kind === COMMENT.DRAFT
                ? "overflow-visible"
                : "overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)]",
            )}
            {...(kind === COMMENT.DRAFT ? {} : { [REPLY_SCOPE]: "" })}
          >
            {children}
          </div>
        )}
      </Comment>
    </li>
  );
}
