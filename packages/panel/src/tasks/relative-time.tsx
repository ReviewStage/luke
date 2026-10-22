import { Tooltip } from "@luke/ui";
import { agoText, momentText, sinceText, useMinute } from "./task-time.js";

/**
 * relative-time.tsx -- how long ago a moment was, as every row, card, and thread in the window draws it: a `<time>` in a row's few letters, the moment in full in the window's own tooltip.
 *
 * The letters are `sinceText`'s, so a sidebar row, an Inbox row, a version
 * row, a file note, and a card all say "3h" for the same save, and each
 * keeps its own class for where it stands in its row; a line of words, as a
 * menu's "Last edited by you · 2h ago" is, says it with "ago" after a count
 * (`agoText`), the task's own "Edited by" line's word. The full moment hangs
 * in the window's pill rather than the system's `title`, as every other hint
 * here does. Note that a time drawn on a hover card raises no pill
 * (`hint={false}`), because a pill hung from a card stands over the card and
 * covers the words it is read beside; nor does a sidebar or Inbox row's,
 * which steps out of sight while its row is hovered, so no pointer rests on it.
 */

/**
 * A moment as long ago as `now` counts it, in a line's words where `ago`
 * asks, its full moment on hover where `hint` is left on. With no `now`, it
 * counts from the window's minute itself (`useMinute`), so a row drawing it
 * need not be drawn again each minute for its time to move.
 */
export function RelativeTime(props: {
  at: number;
  now?: number | undefined;
  className?: string;
  hint?: boolean;
  ago?: boolean;
}): React.JSX.Element {
  const { now } = props;
  return now === undefined ? <TickingTime {...props} /> : <TimeAt {...props} now={now} />;
}

/** A time counted from the window's minute, which alone is drawn again as the minute moves. */
function TickingTime(props: Omit<React.ComponentProps<typeof TimeAt>, "now">): React.JSX.Element {
  return <TimeAt {...props} now={useMinute()} />;
}

function TimeAt({
  at,
  now,
  className,
  hint = true,
  ago = false,
}: {
  at: number;
  now: number;
  className?: string | undefined;
  hint?: boolean | undefined;
  ago?: boolean | undefined;
}): React.JSX.Element {
  const time = (
    <time className={className} dateTime={new Date(at).toISOString()}>
      {ago ? agoText(at, now) : sinceText(at, now)}
    </time>
  );
  // Note that a time raising no pill is drawn bare, because a sidebar row
  // draws several, and a tooltip saying nothing still costs each its own.
  return hint ? <Tooltip label={momentText(at)}>{time}</Tooltip> : time;
}
