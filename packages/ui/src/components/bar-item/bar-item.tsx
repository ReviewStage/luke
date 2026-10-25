import type { ReactNode } from "react";
import { pulseOnPress } from "../../press-pulse.js";

/**
 * bar-item.tsx -- one place in a phone's bar of places: its glyph over its name.
 *
 * A BarItem is a press that goes somewhere or opens something, standing in
 * a row of its kind (a flex row, which it shares equally). The place shown
 * (`current`) is announced as the page (`aria-current="page"`) and drawn in
 * the accent's ink; the rest are muted. One that opens something says
 * whether it stands open (`expanded`), and one the room around it has made
 * inert takes no press. `onPointerDown` lets its caller mark the press
 * before the click lands. It takes no class or style.
 *
 * A `count` of what waits on the reader there stands as a badge on the
 * glyph's top corner, the figure alone, and is said after the item's name
 * with its noun ("Inbox, 3 need you"); it is left out at none. It is a
 * NavItem's needs-you count (`STATUS_TONE.ATTENTION`) turned inside out, so a
 * place reads the same in the bar as in a column of places.
 */

/** The press: a share of the bar, its glyph over its name in the caption's type, muted until it is the place shown. */
const BAR_ITEM =
  "luke-bar-item flex min-h-luke-48 flex-1 basis-0 flex-col items-center justify-center gap-luke-2 border-0 bg-transparent [font-family:inherit] [font-style:inherit] [font-weight:inherit] text-caption text-muted-foreground [-webkit-tap-highlight-color:transparent] aria-[current=page]:text-accent-ink";

/**
 * What waits on the reader, as a badge on the glyph's top corner: a
 * NavItem's needs-you count turned inside out, its figures in white on the
 * needs-you fill the "!" disc is drawn in, in even figures, growing away from
 * the glyph as it lengthens. A ring of the ground the bar stands on parts it
 * from the glyph's strokes.
 */
const BAR_ITEM_COUNT =
  "absolute -top-luke-4 left-bar-count-reach h-caption-leading min-w-caption-leading rounded-luke-full bg-attention-fill px-luke-4 text-center text-caption font-emphasis text-on-attention tabular-nums shadow-bar-count-ring";

/** What waits on the reader in a place: its figure and what it counts, as a reader hears it after the figure. */
export interface BarCount {
  readonly value: number;
  /** Said after the figure to a reader, "need you"; the figure alone where absent. */
  readonly noun?: string | undefined;
}

export interface BarItemProps {
  /** The glyph over its name, decoration a reader is not told. */
  icon: ReactNode;
  /** Its name. */
  children: ReactNode;
  /** Whether it is the place shown. */
  current?: boolean | undefined;
  /** Whether what it opens stands open; absent where it opens nothing. */
  expanded?: boolean | undefined;
  /** What waits on the reader there, drawn on its glyph and said after its name; left out at none. */
  count?: BarCount | undefined;
  /** Whether the room around it is inert, so it takes no press. */
  inert?: boolean | undefined;
  onPointerDown?: (() => void) | undefined;
  onPress: () => void;
}

/** A place in a phone's bar; see the module's head. */
export function BarItem({
  icon,
  children,
  current = false,
  expanded,
  count,
  inert = false,
  onPointerDown,
  onPress,
}: BarItemProps): React.JSX.Element {
  const counted = count !== undefined && count.value > 0;
  return (
    <button
      type="button"
      className={BAR_ITEM}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      inert={inert}
      onPointerDown={onPointerDown}
      onClick={pulseOnPress(onPress)}
    >
      <span className="relative flex [&_svg]:size-luke-20" aria-hidden="true">
        {icon}
        {counted ? <span className={BAR_ITEM_COUNT}>{count.value}</span> : null}
      </span>
      <span>
        {children}
        {counted ? (
          <span className="luke-visually-hidden">
            {count.noun === undefined ? `, ${count.value}` : `, ${count.value} ${count.noun}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}
