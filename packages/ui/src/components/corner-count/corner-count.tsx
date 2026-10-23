import type { ReactNode } from "react";

/**
 * corner-count.tsx -- a glyph wearing a count at its corner, in the accent, as a mail app counts what waits: the comments a pending review holds, on its press's glyph.
 *
 * The count stands on the glyph rather than beside its words, so a press
 * folded to its glyph alone still says it. It is a picture of a number the
 * caller says in its press's name, so it is hidden from a reader here, and
 * none is drawn while nothing waits.
 */

/** `children`, a glyph, with `count` at its corner while it is more than none. */
export function CornerCount({
  count,
  children,
}: {
  /** How many wait; none is drawn at nought. */
  count: number;
  /** The glyph the count stands on. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-corner-count">
      {children}
      {count > 0 ? (
        <span className="luke-corner-count-mark" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </span>
  );
}
