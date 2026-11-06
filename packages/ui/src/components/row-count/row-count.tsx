import type { StatusTone } from "../../status-tone.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * row-count.tsx -- a count at a row's or a tab's end, in the caption's size and even figures: a tally in the muted ink, or what waits on the reader in the attention tone, as the sidebar's Inbox row counts it.
 *
 * The figure is what the eye reads; `noun` follows it for a reader alone,
 * so "3" is heard as "3 need you". A count of none is not drawn, so a row
 * with nothing waiting reads as it would with no count at all. Its ink is
 * its status tone's (`tokens/status-tone.css`), read from `data-tone`, and
 * the muted ink where it names none.
 */

/** `value` at a row's end, followed for a reader by `noun`, in `tone`'s ink; nothing at none. */
export function RowCount({
  value,
  noun,
  tone,
}: {
  /** The figure, a number or words already counted ("3"); none is drawn at 0. */
  value: number | string;
  /** What it counts as a reader hears it after the figure ("need you"). */
  noun?: string | undefined;
  /** Its status tone: attention for what waits on the reader; the muted ink where absent. */
  tone?: StatusTone | undefined;
}): React.JSX.Element | null {
  if (value === 0) return null;
  return (
    <span
      className="ui-row-count flex-none text-caption-inline text-muted-foreground tabular-nums data-[tone]:text-tone-ink"
      data-tone={tone}
    >
      {value}
      {noun === undefined ? null : <VisuallyHidden> {noun}</VisuallyHidden>}
    </span>
  );
}
