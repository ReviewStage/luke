import type { ComponentPropsWithRef } from "react";
import { ChevronDownIcon } from "../../face/glyphs.js";

/**
 * chip-frame.tsx -- the one chip's markup, which the barrel's `Chip` and the
 * compatibility door's `CompatChip` both draw, so the two are one control
 * that differ only in whether a caller may add a class of its own.
 */

/** The looks a chip comes in, by the place it stands. */
export const CHIP_LOOK = {
  TOOLBAR: "toolbar",
  PILL: "pill",
  FIELD: "field",
} as const;

export type ChipLook = (typeof CHIP_LOOK)[keyof typeof CHIP_LOOK];

/** What a chip takes: its look, whether it ends in a menu's chevron, and its button's own attributes. */
export type ChipFrameProps = {
  look: ChipLook;
  /** Whether the chip ends in a chevron, saying it opens a menu of values. */
  chevron?: boolean;
} & Omit<ComponentPropsWithRef<"button">, "type" | "style">;

/** A chip's button, wearing `extraClass` beside its own where a caller still passes one. */
export function ChipFrame({
  look,
  chevron = false,
  className,
  children,
  ...button
}: ChipFrameProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...button}
      className={className === undefined ? "luke-chip" : `luke-chip ${className}`}
      data-look={look}
    >
      <span className="luke-chip-face">
        {children}
        {chevron ? <ChevronDownIcon /> : null}
      </span>
    </button>
  );
}
