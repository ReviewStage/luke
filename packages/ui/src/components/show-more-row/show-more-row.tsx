import { SHOW_LESS_WORDS, showMoreWords } from "@luke/features/words";
import type { BusyProps } from "../button/button.js";
import { LINE_BUTTON_LOOK, LineButton } from "../line-button/line-button.js";
import { BusyLabel } from "../spinner/spinner.js";

/**
 * show-more-row.tsx -- the foot of a capped list: "Show 3 more" while it leaves rows out, and "Show less" once it shows them all.
 *
 * A list that draws only its first few rows ends in this row, which says
 * how many more it holds and shows them on its press, and once they stand
 * puts them back. It is drawn as a list's own row (`LineButton`'s `row`
 * look), as wide as the list and in its muted caption, and says whether the
 * rest stand open in `aria-expanded`. The list keeps the cap and whether it
 * is lifted, so a list that remembers it keeps it through `useKept`; a list
 * whose rows all fit under its cap draws no foot. A list that reads its next
 * rows as they are asked for says so with the busy shape every button takes:
 * the row refuses another press, and its words give way to the ring once the
 * read has been out a moment.
 */

/** The foot of a list capped short of `more` of its rows, which shows them or puts them back. */
export function ShowMoreRow({
  more,
  shown,
  onToggle,
  controls,
  busy,
  busyLabel,
}: BusyProps & {
  /** How many rows the cap leaves out. */
  more: number;
  /** Whether those rows stand shown now. */
  shown: boolean;
  onToggle: () => void;
  /** The id of the list whose rows it shows and puts back. */
  controls?: string | undefined;
}): React.JSX.Element | null {
  if (more <= 0) return null;
  return (
    <LineButton
      look={LINE_BUTTON_LOOK.ROW}
      brightens
      aria-expanded={shown}
      aria-controls={controls}
      aria-label={busy === true ? busyLabel : undefined}
      onClick={() => {
        if (busy !== true) onToggle();
      }}
    >
      <BusyLabel busy={busy === true} label={busyLabel ?? ""}>
        {shown ? SHOW_LESS_WORDS : showMoreWords(more)}
      </BusyLabel>
    </LineButton>
  );
}
