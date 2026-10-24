import type { PointerEvent } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import type { StatusTone } from "../../status-tone.js";
/**
 * mark-strip.tsx -- the thin strip a hidden rail leaves in its place: one mark for each of its rows, a press on which shows the rail again, or the pointer resting on which peeks it.
 *
 * Each mark is drawn in its row's tone from the state palette, or the
 * border's ink where it has none, dimmed once its row is viewed, the row
 * shown standing out. Its look is a dot for each row, or a bar for each
 * (`MARK_STRIP_LOOK.BARS`), sharing the strip's height and no taller than a
 * dot, so a rail of thousands of rows draws every mark thinner rather than
 * out of sight, the row shown never thinner than a line and standing wider.
 * It is a picture of the rail, hidden from assistive technology, which
 * reaches the rail through its own toggle, so its press is the pointer's
 * shortcut to that toggle and no control of its own; a strip without a
 * press is only looked at, or rested on to peek the rail. It fills the box
 * its place stands it in, which says when the strip is drawn at all and the
 * edge it keeps from the rail's neighbour.
 */

/** How a strip draws its marks: a dot for each row, or a bar for each, sharing the strip's height. */
export const MARK_STRIP_LOOK = {
  DOTS: "dots",
  BARS: "bars",
} as const;

export type MarkStripLook = (typeof MARK_STRIP_LOOK)[keyof typeof MARK_STRIP_LOOK];

/** One row's mark: its tone, whether its row was viewed, and whether its row is the one shown. */
export interface StripMark {
  readonly tone?: StatusTone | undefined;
  readonly viewed?: boolean | undefined;
  readonly current?: boolean | undefined;
}

/** A strip of marks, one for each row of a hidden rail, a press on which shows it. */
export function MarkStrip({
  marks,
  look = MARK_STRIP_LOOK.DOTS,
  onPress,
  onPointerEnter,
  onPointerLeave,
}: {
  marks: readonly StripMark[];
  look?: MarkStripLook;
  /** Shows the rail, as its toggle does; none where the strip takes no press. */
  onPress?: (() => void) | undefined;
  /** The pointer coming to rest on the strip, as a rail that peeks out under it hears. */
  onPointerEnter?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  /** The pointer leaving the strip. */
  onPointerLeave?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  return (
    <div
      className="luke-mark-strip"
      data-look={look}
      data-pressable={onPress === undefined ? undefined : "true"}
      aria-hidden="true"
      onClick={onPress === undefined ? undefined : pulseOnPress(onPress, PRESS_PULSE.QUIET)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {marks.map((mark, index) => (
        <span
          key={index}
          className="luke-mark-strip-mark"
          data-tone={mark.tone}
          data-viewed={mark.viewed === true ? "" : undefined}
          data-current={mark.current === true ? "" : undefined}
        />
      ))}
    </div>
  );
}
