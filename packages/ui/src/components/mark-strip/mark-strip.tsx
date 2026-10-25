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
/** The strip, a column of marks filling the box its place stands it in; bars share its height with no gap between. */
const STRIP_CLASS = {
  [MARK_STRIP_LOOK.DOTS]:
    "luke-mark-strip flex min-w-0 flex-1 flex-col items-center gap-luke-4 py-luke-12",
  [MARK_STRIP_LOOK.BARS]:
    "luke-mark-strip flex min-w-0 flex-1 flex-col items-center gap-0 py-luke-12",
} as const satisfies Record<MarkStripLook, string>;

/** A mark's ink, in its status tone's where it has one (`tokens/status-tone.css`). */
const MARK_INK =
  "luke-mark-strip-mark [--luke-mark-strip-ink:var(--luke-color-border-strong)] data-tone:[--luke-mark-strip-ink:var(--luke-tone-ink)]";

/** A dot, or a bar: a share of the strip's height, at most a dot's, its ink filling the top of its share so the gap between bars shrinks with them. */
const MARK_SHAPE = {
  [MARK_STRIP_LOOK.DOTS]: "size-luke-6 flex-none rounded-luke-full bg-mark-strip-ink",
  [MARK_STRIP_LOOK.BARS]:
    "h-auto min-h-0 max-h-luke-6 flex-[1_1_0] bg-[linear-gradient(var(--luke-mark-strip-ink)_0_66%,transparent_66%)]",
} as const satisfies Record<MarkStripLook, string>;

/** The classes a mark of `look` is drawn in: the row shown ringed in the text's ink, and a bar of it wider and never thinner than a line; a row already viewed faint. */
function markClass(look: MarkStripLook, mark: StripMark): string {
  const bar = look === MARK_STRIP_LOOK.BARS;
  const width = bar ? (mark.current === true ? "w-luke-12 min-h-luke-2" : "w-luke-6") : "";
  const standing =
    mark.current === true
      ? "opacity-100 ring-1 ring-foreground"
      : mark.viewed === true
        ? "opacity-35"
        : "";
  return [MARK_INK, MARK_SHAPE[look], width, standing].filter((part) => part !== "").join(" ");
}

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
      className={onPress === undefined ? STRIP_CLASS[look] : `${STRIP_CLASS[look]} cursor-pointer`}
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
          className={markClass(look, mark)}
          data-tone={mark.tone}
          data-viewed={mark.viewed === true ? "" : undefined}
          data-current={mark.current === true ? "" : undefined}
        />
      ))}
    </div>
  );
}
