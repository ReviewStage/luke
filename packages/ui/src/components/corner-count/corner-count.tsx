import type { ReactNode } from "react";

/**
 * corner-count.tsx -- a glyph wearing a count at its corner, in the accent, as a mail app counts what waits: the comments a pending review holds, on its press's glyph.
 *
 * The count stands on the glyph rather than beside its words, so a press
 * folded to its glyph alone still says it. It is a picture of a number the
 * caller says in its press's name, so it is hidden from a reader here, and
 * none is drawn while nothing waits.
 *
 * Its quieter sibling, `CornerDot`, says only that something is so, a view
 * filtered, with a dot over a press's corner rather than a number; and
 * `CornerBadge` says what kind of thing a press is, an experiment, with a
 * small glyph on a disc at its corner.
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

/**
 * `children`, a press, with a dot over its top end corner while `shown`: a
 * view that leaves something out says so on the press that set it, so a
 * filtered list never passes for the whole of it. The dot is the accent's
 * ink rather than its fill, since the site's accent fill is too light to
 * hold a mark's 3:1 on its light page. It is a picture the caller says in
 * its press's description, so it is hidden from a reader here and takes no
 * pointer; the box says it stands in `data-dot`.
 */
export function CornerDot({
  shown,
  children,
}: {
  /** Whether the dot is drawn. */
  shown: boolean;
  /** The press the dot stands over. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-corner-dot relative inline-flex" data-dot={shown ? "true" : undefined}>
      {children}
      {shown ? (
        <span
          className="luke-corner-dot-mark pointer-events-none absolute top-luke-4 right-luke-4 size-corner-dot rounded-disc bg-accent-ink"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

/**
 * `children`, a press, wearing `mark`, a glyph, on a small disc over its top
 * end corner: the experiment's flask on a control that is still one, as an
 * app's icon wears a beta badge. The disc is quiet, neutral and hairlined
 * like the Experimental tag, opaque so the press's edge does not show
 * through it. It is a picture the caller says in its press's hint, so it is
 * hidden from a reader and takes no pointer, and a press on it presses the
 * control beneath.
 */
export function CornerBadge({
  mark,
  children,
}: {
  /** The glyph on the disc. */
  mark: ReactNode;
  /** The press the badge stands on. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-corner-badge relative inline-flex min-w-0">
      {children}
      <span
        className="luke-corner-badge-mark pointer-events-none absolute -top-luke-6 -right-luke-6 inline-grid size-corner-badge place-items-center rounded-disc border border-border-strong bg-ground text-muted-foreground [&>svg]:size-corner-badge-glyph"
        aria-hidden="true"
      >
        {mark}
      </span>
    </span>
  );
}
