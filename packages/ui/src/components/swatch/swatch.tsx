import type { Ref } from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * swatch.tsx -- a colour dot a reader presses to choose that colour.
 *
 * A Swatch is a toggle: `pressed` says whether its colour is the one
 * chosen, which it draws as a ring and announces as a pressed button. One
 * given no `color` stands for none, a dot struck through. It is named by its
 * `label`, since a dot says nothing to a reader who cannot see it, and it
 * takes the Tab stop or not (`tabbable`) as one of a roving group.
 */
export function Swatch({
  color,
  label,
  pressed,
  tabbable,
  onClick,
  ref,
}: {
  /** Any CSS colour the dot is filled with; none draws the struck-through dot. */
  color?: string | undefined;
  /** Its accessible name: the colour it chooses. */
  label: string;
  /** Whether its colour is the one chosen. */
  pressed: boolean;
  /** Whether Tab stops on it; false takes it out of the order. */
  tabbable?: boolean | undefined;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement> | undefined;
}): React.JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      className="luke-swatch"
      aria-label={label}
      aria-pressed={pressed}
      tabIndex={tabbable === false ? -1 : undefined}
      data-none={color === undefined || undefined}
      style={color === undefined ? undefined : cssCustomProperties({ "--luke-swatch": color })}
      onClick={onClick}
    />
  );
}
