import type { MouseEvent, Ref } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { type ButtonSize, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * more-button.tsx -- a thing's ⋯: the one button that drops the menu of its acts, named for the thing it acts on.
 *
 * Every ⋯ wears the one glyph (`GLYPH.MORE`) and is named "{Thing}
 * actions", "Task actions" or "Repository actions", which its hint says
 * too, so a reader and a pointer meet the same words wherever a menu of
 * acts hangs. It drops the menu its owner keeps: `useMenu`'s `trigger()`
 * spreads on it, which opens and closes the menu and says whether it
 * stands open. A row's ⋯ is `ListRow`'s `menu`, which draws this button
 * with the same menu on a right-click and the menu key; this one is for a
 * header's or a toolbar's ⋯, where no row stands.
 */

/** The name of a thing's ⋯ and of the menu it drops: "Task" makes "Task actions". */
export function moreLabel(thing: string): string {
  return `${thing} actions`;
}

/** A ⋯ that drops the menu of `thing`'s acts, named "{thing} actions". */
export function MoreButton({
  thing,
  size,
  disabled,
  tabbable,
  ref,
  onClick,
  "aria-haspopup": hasPopup,
  "aria-expanded": expanded,
  "aria-describedby": describedBy,
}: {
  /** What it acts on, as a sentence opens with it: "Task", "Repository". */
  thing: string;
  size?: ButtonSize | undefined;
  /** Whether its menu is unavailable now, as a thing being deleted offers none. */
  disabled?: boolean | undefined;
  /** Whether it is a Tab stop; false leaves it to the pointer, where a neighbour holds the one stop. */
  tabbable?: boolean | undefined;
  /** Handed the button, which a right-click's menu hands focus back to. */
  ref?: Ref<HTMLButtonElement> | undefined;
  /** Opens or closes the menu (`useMenu`'s `trigger()`). */
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  "aria-haspopup"?: "menu" | undefined;
  "aria-expanded"?: boolean | undefined;
  /** The id of the words naming which thing it is, where several stand side by side. */
  "aria-describedby"?: string | undefined;
}): React.JSX.Element {
  const label = moreLabel(thing);
  return (
    <Tooltip label={label}>
      <IconButton
        ref={ref}
        icon={<GLYPH.MORE />}
        label={label}
        {...(size === undefined ? {} : { size })}
        disabled={disabled}
        tabbable={tabbable}
        onClick={onClick}
        aria-haspopup={hasPopup}
        aria-expanded={expanded}
        aria-describedby={describedBy}
      />
    </Tooltip>
  );
}
