import { SHOW_LESS_WORDS, showMoreWords } from "@luke/features/words";
import { LINE_BUTTON_LOOK, LineButton } from "../line-button/line-button.js";

/**
 * show-more-row.tsx -- the foot of a capped list: "Show 3 more" while it leaves rows out, and "Show less" once it shows them all.
 *
 * A list that draws only its first few rows ends in this row, which says
 * how many more it holds and shows them on its press, and once they stand
 * puts them back. It is drawn as a list's own row (`LineButton`'s `row`
 * look), as wide as the list and in its muted caption, and says whether the
 * rest stand open in `aria-expanded`. The list keeps the cap and whether it
 * is lifted, so a list that remembers it keeps it through `useKept`; a list
 * whose rows all fit under its cap draws no foot.
 */

/** The foot of a list capped short of `more` of its rows, which shows them or puts them back. */
export function ShowMoreRow({
  more,
  shown,
  onToggle,
  controls,
}: {
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
      onClick={onToggle}
    >
      {shown ? SHOW_LESS_WORDS : showMoreWords(more)}
    </LineButton>
  );
}
