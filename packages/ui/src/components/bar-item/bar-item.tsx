import type { ReactNode } from "react";

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
 */

export interface BarItemProps {
  /** The glyph over its name, decoration a reader is not told. */
  icon: ReactNode;
  /** Its name. */
  children: ReactNode;
  /** Whether it is the place shown. */
  current?: boolean | undefined;
  /** Whether what it opens stands open; absent where it opens nothing. */
  expanded?: boolean | undefined;
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
  inert = false,
  onPointerDown,
  onPress,
}: BarItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="luke-bar-item"
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      inert={inert}
      onPointerDown={onPointerDown}
      onClick={onPress}
    >
      <span className="luke-bar-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}
