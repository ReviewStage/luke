import { ChevronDownIcon } from "@luke/ui";
import type { ComponentPropsWithRef } from "react";

/**
 * chip.tsx -- the one chip: a button naming a value or a thing, drawn in the look of the place it stands.
 *
 * Every chip is the window's labelled button (`.toolbar-button`) underneath,
 * so it shares that button's box, glyph, focus ring, disabled face, and the
 * drag region it leaves, and differs only in the look its place asks for:
 *
 * - a toolbar chip, a control that picks what the place it stands in runs
 *   on (the plan toolbar's repository, an agent's model at its box's foot),
 *   is a toolbar button outright, quiet until the pointer is on it or its
 *   menu is open, so it reads as one of the ⋯ and Summary buttons beside it;
 * - a pill, a thing named rather than a setting (what an agent published, the
 *   repository a new plan is for), is a filled, hairlined capsule;
 * - a field, a settings row's value, wears the row buttons' hairline at a
 *   form's type, so a picker and the buttons beside it read as one column.
 *
 * A chip that opens a menu of values ends in the menu's own small, muted
 * chevron where `chevron` asks for one.
 */

/** The looks a chip comes in, by the place it stands. */
export const CHIP_LOOK = {
  TOOLBAR: "toolbar",
  PILL: "pill",
  FIELD: "field",
} as const;

export type ChipLook = (typeof CHIP_LOOK)[keyof typeof CHIP_LOOK];

/** The button classes each look is drawn over: the labelled button, and its hairline for a field. */
const LOOK_CLASSES = {
  [CHIP_LOOK.TOOLBAR]: ["toolbar-button", "chip"],
  [CHIP_LOOK.PILL]: ["toolbar-button", "chip"],
  [CHIP_LOOK.FIELD]: ["toolbar-button", "bordered-button", "chip"],
} as const satisfies Record<ChipLook, readonly string[]>;

/** A chip: a button in the look of its place, its words in `.chip-name` where they may run long. */
export function Chip({
  look,
  chevron = false,
  className,
  children,
  ...button
}: {
  look: ChipLook;
  /** Whether the chip ends in a chevron, saying it opens a menu of values. */
  chevron?: boolean;
} & Omit<ComponentPropsWithRef<"button">, "type">): React.JSX.Element {
  const classes = className === undefined ? LOOK_CLASSES[look] : [...LOOK_CLASSES[look], className];
  return (
    <button type="button" {...button} className={classes.join(" ")} data-look={look}>
      {children}
      {chevron ? <ChevronDownIcon /> : null}
    </button>
  );
}
