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
 * NavItem's accent count (`NAV_COUNT_TONE.ACCENT`) turned inside out, so a
 * place reads the same in the bar as in a column of places.
 */

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
      className="luke-bar-item"
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      inert={inert}
      onPointerDown={onPointerDown}
      onClick={pulseOnPress(onPress)}
    >
      <span className="luke-bar-item-icon" aria-hidden="true">
        {icon}
        {counted ? <span className="luke-bar-item-count">{count.value}</span> : null}
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
