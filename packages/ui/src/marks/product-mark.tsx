import { MARK_ART } from "@repo/brand";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

interface ProductMarkProps {
  /** Draws the mark in the muted text colour, where it stands behind what is said over it. */
  muted?: boolean;
  /** Fills the box that holds it rather than standing at the font's size. */
  fill?: boolean;
  /** Draws the mark in its holder's ink, where the holder says what it is by its colour. */
  inherit?: boolean;
  /** Draws the small cut, its V opened wider, for a mark 32 pixels across or smaller. */
  small?: boolean;
}

/**
 * The product's mark, drawn from `@repo/brand`'s generated `MARK_ART` so every
 * surface that wears it stays tied to the artwork the icons are cut from, in
 * one colour, `currentColor`, so its holder decides the ink. Decorative:
 * whatever stands beside it already says the product's name.
 *
 * It stands at the font's size until its holder gives it a box, in the
 * primary ink because it is the product rather than one of the things the
 * product is watching.
 */
export function ProductMark({
  muted = false,
  fill = false,
  inherit = false,
  small = false,
}: ProductMarkProps): React.JSX.Element {
  return (
    <svg
      className="ui-product-mark"
      viewBox={MARK_ART.VIEW_BOX}
      aria-hidden="true"
      focusable="false"
      data-muted={muted || undefined}
      data-fill={fill || undefined}
      data-inherit={inherit || undefined}
    >
      <path d={small ? MARK_ART.SMALL_PATH : MARK_ART.PATH} fill="currentColor" />
    </svg>
  );
}
