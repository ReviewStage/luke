import { Tooltip } from "../tooltip";
import { agoText, momentText, sinceText } from "./task-time";

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

/** A moment as long ago as `now` counts it, in a line's words where `ago` asks, its full moment on hover where `hint` is left on. */
export function RelativeTime({
  at,
  now,
  className,
  hint = true,
  ago = false,
}: {
  at: number;
  now: number;
  className?: string;
  hint?: boolean;
  ago?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip label={hint ? momentText(at) : undefined}>
      <time className={className} dateTime={new Date(at).toISOString()}>
        {ago ? agoText(at, now) : sinceText(at, now)}
      </time>
    </Tooltip>
  );
}
