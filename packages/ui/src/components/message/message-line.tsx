/**
 * message-line.tsx -- the line under a message: who sent it and when, at the edge of the column the message keeps to, and its actions on the side toward the middle.
 *
 * An agent's transcript and a chat notice both end a message on this line,
 * so the name, the time and the buttons never trade places from one
 * message to the next. The time is `Time`'s day and clock, a call's
 * words, after a dot where someone is named; the actions are a
 * `MessageActions` bar, hidden until the pointer rests on the message
 * (`MessageFrame`). Note that the actions stand inside the name and the
 * time, before them on a sent message's line and after them on a received
 * one's, because a bar that shows only on hover would otherwise leave a
 * gap at the column's edge at rest. A line with nothing to say draws
 * nothing.
 *
 * It is drawn in the Tailwind theme's utilities, in the caption's size and
 * the muted ink, held to the column: who sent it gives way, cut short, so
 * the time and the buttons keep their whole width, and a line that may wrap
 * breaks before the time rather than squeeze who sent it.
 */

import type { ReactNode } from "react";
import { TIME_LOOK, Time } from "../time/time.js";

/** Which edge of the column the line keeps to: a sent message's right, a received one's left. */
export const MESSAGE_LINE_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type MessageLineAlign = (typeof MESSAGE_LINE_ALIGN)[keyof typeof MESSAGE_LINE_ALIGN];

/** Whether a node draws anything: none, null, and a boolean, as a condition leaves it, draw nothing. */
function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

/** The line under a message: `sender`, `at`, and `actions`, each left out where the message has none, the actions on the side away from `align`'s edge. */
export function MessageLine({
  sender,
  at,
  actions,
  align = MESSAGE_LINE_ALIGN.END,
  wrap = false,
}: {
  /** Who sent it, as the caller's own mark and name; none for the reader's own. */
  sender?: ReactNode;
  /** When it was sent. */
  at?: number | undefined;
  /** Its actions, a `MessageActions` bar. */
  actions?: ReactNode;
  align?: MessageLineAlign;
  /** Whether the time may break onto a line under a sender too long to share one. */
  wrap?: boolean;
}): React.JSX.Element | null {
  const named = drawsSomething(sender);
  if (!named && at === undefined && !drawsSomething(actions)) return null;
  const actionsFirst = align === MESSAGE_LINE_ALIGN.END;
  return (
    <div
      className={`luke-message-line flex max-w-full items-center gap-luke-2 text-caption-inline text-muted-foreground ${align === MESSAGE_LINE_ALIGN.START ? "justify-start" : "justify-end"}${wrap ? " flex-wrap gap-y-luke-2" : ""}`}
      data-align={align}
      data-wrap={wrap ? "true" : undefined}
    >
      {actionsFirst ? actions : null}
      {named ? (
        <span className="luke-message-line-sender flex min-w-0 items-center px-luke-4">
          {sender}
        </span>
      ) : null}
      {at === undefined ? null : (
        <span className="luke-message-line-time flex flex-none items-center gap-luke-6 pe-luke-4 whitespace-nowrap tabular-nums">
          {named ? <span aria-hidden="true">·</span> : null}
          <Time at={at} look={TIME_LOOK.DAY} />
        </span>
      )}
      {actionsFirst ? null : actions}
    </div>
  );
}
