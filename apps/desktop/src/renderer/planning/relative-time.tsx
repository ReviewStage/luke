import { Tooltip } from "../tooltip";
import { momentText, sinceText } from "./plan-time";

/**
 * relative-time.tsx -- how long ago a moment was, as every row, card, and thread in the window draws it: a `<time>` in a row's few letters, the moment in full in the window's own tooltip.
 *
 * The letters are `sinceText`'s, so a sidebar row, a version
 * row, a file note, and a card all say "3h" for the same save, and each
 * keeps its own class for where it stands in its row. The full moment hangs
 * in the window's pill rather than the system's `title`, as every other hint
 * here does. Note that a time drawn on a hover card raises no pill
 * (`hint={false}`), because one tooltip stands in the window at a time and a
 * pill on a card would take the card down; nor does a sidebar row's,
 * which steps out of sight while its row is hovered, so no pointer rests on it.
 */

/** A moment as long ago as `now` counts it, its full moment on hover where `hint` is left on. */
export function RelativeTime({
  at,
  now,
  className,
  hint = true,
}: {
  at: number;
  now: number;
  className?: string;
  hint?: boolean;
}): React.JSX.Element {
  return (
    <Tooltip label={hint ? momentText(at) : undefined}>
      <time className={className} dateTime={new Date(at).toISOString()}>
        {sinceText(at, now)}
      </time>
    </Tooltip>
  );
}
