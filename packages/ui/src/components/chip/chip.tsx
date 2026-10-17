import type { ReactNode } from "react";
import { ChipFrame, type ChipFrameProps } from "./chip-frame.js";

/**
 * chip.tsx -- the one chip: a button naming a value or a thing, drawn in the look of the place it stands.
 *
 * A chip is one control of the shared contract, a control's height, corner,
 * glyph, and label type in its profile, and differs only in the look its
 * place asks for:
 *
 * - a toolbar chip, a control that picks what the place it stands in runs
 *   on (a plan toolbar's repository, an agent's model), is quiet until the
 *   pointer is on it or its menu is open, as the toolbar's own buttons are;
 * - a pill, a thing named rather than a setting (what an agent published, the
 *   repository a new plan is for), is a filled, hairlined capsule;
 * - a field, a settings row's value, wears an outlined button's hairline,
 *   its words leading, so a picker and the buttons beside it read as one
 *   column.
 * - a filter, one of a row of pills that narrow a list to one kind (⌘K's
 *   All, Plans, Files), is a quiet capsule until it stands pressed
 *   (`aria-pressed`), when it fills inside the selection's hairline; its
 *   caller holds which one is pressed.
 *
 * A chip that opens a menu of values ends in the menu's small, muted
 * chevron where `chevron` asks for one. Its words go in a `ChipName`, which
 * cuts them short rather than letting them push past the row around it.
 * It takes no class or style: its outer layout is its container's.
 */

export { CHIP_LOOK, type ChipLook } from "./chip-frame.js";

/** A chip: a button in the look of its place. */
export function Chip(props: Omit<ChipFrameProps, "className">): React.JSX.Element {
  return <ChipFrame {...props} />;
}

/** A chip's words, cut short at its end rather than pushing past the row it stands in. */
export function ChipName({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="luke-chip-name">{children}</span>;
}
