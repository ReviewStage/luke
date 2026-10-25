import type { ReactNode } from "react";
import { ICON_SIZE, type IconSize } from "../../icons/icon-size.js";

/**
 * glyph-slot.tsx -- the seat a glyph stands in before a line's words: a square a row's glyph fills, so every line's words start on one edge whatever glyph leads them.
 *
 * A slot is a glyph's footprint, 16px where nothing says otherwise, its
 * glyph (an svg, a picture, or a mark of the app's) centred in it and
 * filling it. Its size is `--luke-glyph-size` where a component's own glyph
 * slot or the app's container sets it, the one placement hook a slot reads,
 * so a note's face stands at the note's face size and a tab's glyph at the
 * tab's. Before words that may wrap, it stands as tall as their first line
 * (`line`) and centred on it, rather than on the whole of them.
 *
 * Its ink says how the glyph reads beside its words: muted, as a call's or
 * a list's glyph is; the full ink, for the one that stands out; the ink its
 * holder sets; or Luke's own blue, the colour his voice and face answer in.
 * A glyph that only repeats its words is hidden from a reader; one that says
 * something its words do not is named by `label`.
 *
 * A slot takes its size from the seat it names (`ICON_SIZE`: 12, 16, 20, or
 * 40 for an empty state) where the caller has one, so an icon is drawn at a
 * seat rather than a size of its own; with none, the size above stands.
 *
 * A glyph that arrives as its line changes, a step taken up or done, rides
 * in on its `arrival` when the slot mounts: a small scale for a step, a
 * spring from well under its size for a check. Its caller mounts the slot
 * anew on the change (by its key) and gives none where the line was drawn
 * as it stands, so a list opened or read back does not play its history.
 *
 * It is drawn in the Tailwind theme's utilities (`size-glyph` reads
 * `--luke-glyph-size`); a seat sets that size on the slot itself, ahead of
 * any a container hands down, and draws its glyph whole, whatever weight the
 * glyph's own class gave it. The arrival's keyframes are `glyph-slot.css`'s.
 */

/** How a slot's glyph reads beside its words. */
export const GLYPH_INK = {
  MUTED: "muted",
  TEXT: "text",
  INHERIT: "inherit",
  VOICE: "voice",
} as const;

export type GlyphInk = (typeof GLYPH_INK)[keyof typeof GLYPH_INK];

/** How a glyph that arrives on a change rides in: a step's small scale, or a check's spring. */
export const GLYPH_ARRIVAL = {
  STEP: "step",
  CHECK: "check",
} as const;

export type GlyphArrival = (typeof GLYPH_ARRIVAL)[keyof typeof GLYPH_ARRIVAL];

/** The slot's square, or a line's height before words that may wrap, its glyph centred in it and filling it. */
const SLOT_BASE =
  "luke-glyph-slot inline-flex flex-none items-center justify-center [&>:is(svg,img)]:size-glyph";

/** The size each seat sets, from the icon scale (`tokens/scale.css`). */
const SEAT_CLASS = {
  [ICON_SIZE.SMALL]: "[--luke-glyph-size:var(--luke-icon-12)] [&>svg]:opacity-100",
  [ICON_SIZE.MEDIUM]: "[--luke-glyph-size:var(--luke-icon-16)] [&>svg]:opacity-100",
  [ICON_SIZE.LARGE]: "[--luke-glyph-size:var(--luke-icon-20)] [&>svg]:opacity-100",
  [ICON_SIZE.EMPTY]: "[--luke-glyph-size:var(--luke-icon-40)] [&>svg]:opacity-100",
} as const satisfies Record<IconSize, string>;

/** Each ink a slot names; `inherit` takes its holder's. */
const INK_CLASS = {
  [GLYPH_INK.MUTED]: "text-muted-foreground",
  [GLYPH_INK.TEXT]: "text-foreground",
  [GLYPH_INK.INHERIT]: "",
  [GLYPH_INK.VOICE]: "text-working",
} as const satisfies Record<GlyphInk, string>;

/** The classes a slot of `ink`, `size`, and `line` is drawn in. */
function slotClass(ink: GlyphInk, size: IconSize | undefined, line: boolean): string {
  return [
    SLOT_BASE,
    line ? "w-glyph h-lh" : "size-glyph",
    size === undefined ? "" : SEAT_CLASS[size],
    INK_CLASS[ink],
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** A glyph's seat before a line's words, in `ink`, named `label` where it says more than its words. */
export function GlyphSlot({
  ink = GLYPH_INK.MUTED,
  size,
  line = false,
  label,
  arrival,
  children,
}: {
  ink?: GlyphInk;
  /** The seat it stands in, one of `ICON_SIZE`; none leaves the size to its container. */
  size?: IconSize | undefined;
  /** Whether it stands as tall as the line it leads, centred on its first line, rather than square. */
  line?: boolean | undefined;
  /** What the glyph says that its words do not; none where it only repeats them. */
  label?: string | undefined;
  /** How the glyph rides in as the slot mounts on a change; none for one drawn as it stands. */
  arrival?: GlyphArrival | undefined;
  /** The glyph, which fills the slot. */
  children: ReactNode;
}): React.JSX.Element {
  if (label === undefined) {
    return (
      <span
        className={slotClass(ink, size, line)}
        data-ink={ink}
        data-size={size}
        data-line={line ? "true" : undefined}
        data-arrival={arrival}
        aria-hidden="true"
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={slotClass(ink, size, line)}
      data-ink={ink}
      data-size={size}
      data-line={line ? "true" : undefined}
      data-arrival={arrival}
      role="img"
      aria-label={label}
    >
      {children}
    </span>
  );
}
