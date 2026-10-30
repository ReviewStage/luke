/**
 * message-head.tsx -- the line over a message someone other than the reader sent: who sent it, then what they did, each at its own width.
 *
 * A received message names its sender over its bubble, as a group chat
 * names a speaker, and leaves the line under it (`MessageLine`) to when it
 * came and its actions, so every message keeps the time and the buttons in
 * one place whoever sent it. The sender is the caller's own chip; what they
 * did, where the message says, follows it, such as a thread's line
 * ("Thread answer" and the thread's chip, a `SubjectLine` fitted to its own
 * width). Neither grows past its own width, so the line reads as words
 * rather than as columns, and what they did breaks under the sender where
 * the column has no room for both. The reader's own message has no head.
 *
 * It is drawn in the Tailwind theme's utilities, in the caption's size and
 * the muted ink, at the bubble's inset.
 */

import type { ReactNode } from "react";

/** The line over a received message: `sender`, then `children`, what they did, where the message says. */
export function MessageHead({
  sender,
  children,
}: {
  /** Who sent it, as the caller's own mark and name. */
  sender: ReactNode;
  /** What they did, such as a thread's `SubjectLine`; none where the message says nothing more. */
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-message-head flex min-w-0 max-w-full flex-wrap items-center gap-x-luke-6 gap-y-luke-2 px-luke-4 text-caption-inline text-muted-foreground">
      <span className="luke-message-head-sender flex min-w-0 max-w-full items-center">
        {sender}
      </span>
      {children == null ? null : (
        <span className="flex min-w-0 max-w-full items-center">{children}</span>
      )}
    </div>
  );
}
