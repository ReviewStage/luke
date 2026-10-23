import type { ReactNode } from "react";

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
 * A glyph that arrives as its line changes, a step taken up or done, rides
 * in on its `arrival` when the slot mounts: a small scale for a step, a
 * spring from well under its size for a check. Its caller mounts the slot
 * anew on the change (by its key) and gives none where the line was drawn
 * as it stands, so a list opened or read back does not play its history.
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

/** A glyph's seat before a line's words, in `ink`, named `label` where it says more than its words. */
export function GlyphSlot({
  ink = GLYPH_INK.MUTED,
  line = false,
  label,
  arrival,
  children,
}: {
  ink?: GlyphInk;
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
        className="luke-glyph-slot"
        data-ink={ink}
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
      className="luke-glyph-slot"
      data-ink={ink}
      data-line={line ? "true" : undefined}
      data-arrival={arrival}
      role="img"
      aria-label={label}
    >
      {children}
    </span>
  );
}
