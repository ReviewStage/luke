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
    <div className="luke-message-line" data-align={align} data-wrap={wrap ? "true" : undefined}>
      {actionsFirst ? actions : null}
      {named ? <span className="luke-message-line-sender">{sender}</span> : null}
      {at === undefined ? null : (
        <span className="luke-message-line-time">
          {named ? <span aria-hidden="true">·</span> : null}
          <Time at={at} look={TIME_LOOK.DAY} />
        </span>
      )}
      {actionsFirst ? null : actions}
    </div>
  );
}
