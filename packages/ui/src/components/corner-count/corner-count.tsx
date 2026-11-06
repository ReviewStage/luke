import type { ReactNode } from "react";
import { cappedCount } from "../count-figure/count-figure.js";

/**
 * corner-count.tsx -- a glyph wearing a count at its corner, in the accent, as a mail app counts what waits: the comments a pending review holds, on its press's glyph.
 *
 * The count stands on the glyph rather than beside its words, so a press
 * folded to its glyph alone still says it. It is a picture of a number the
 * caller says in its press's name, so it is hidden from a reader here, and
 * none is drawn while nothing waits; past 99 it is drawn "99+" (`cappedCount`).
 *
 * Its quieter sibling, `CornerDot`, says only that something is so, a view
 * filtered, with a dot over a press's corner rather than a number; and
 * `CornerBadge` says what kind of thing a press is, an experiment, with a
 * small glyph on a disc at its corner.
 */

/** The inks a `CornerDot` takes, as its caller says what the dot means. */
export const CORNER_DOT_TONE = {
  /** A view's state, a list filtered: the accent's ink. */
  ACCENT: "accent",
  /** Something waits on the reader behind the press: the attention ink, as the Inbox's count is drawn. */
  ATTENTION: "attention",
} as const;

export type CornerDotTone = (typeof CORNER_DOT_TONE)[keyof typeof CORNER_DOT_TONE];

const CORNER_DOT_INK = {
  [CORNER_DOT_TONE.ACCENT]: "bg-accent-ink",
  [CORNER_DOT_TONE.ATTENTION]: "bg-attention",
} as const satisfies Record<CornerDotTone, string>;

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
    <span className="ui-corner-count">
      {children}
      {count > 0 ? (
        <span className="ui-corner-count-mark" aria-hidden="true">
          {cappedCount(count)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * `children`, a press, with a dot over its top end corner while `shown`: a
 * view that leaves something out says so on the press that set it, so a
 * filtered list never passes for the whole of it; or, in the attention tone,
 * that something waits on the reader behind the press, the Inbox's count
 * while the sidebar that draws it is folded away. The accent's dot is its
 * ink rather than its fill, since the site's accent fill is too light to
 * hold a mark's 3:1 on its light page. It is a picture the caller says in
 * its press's name or description, so it is hidden from a reader here and
 * takes no pointer; the box says it stands in `data-dot`.
 */
export function CornerDot({
  shown,
  tone = CORNER_DOT_TONE.ACCENT,
  children,
}: {
  /** Whether the dot is drawn. */
  shown: boolean;
  /** The dot's ink: the accent's for a view's state, the attention's for what waits on the reader. */
  tone?: CornerDotTone | undefined;
  /** The press the dot stands over. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-corner-dot relative inline-flex" data-dot={shown ? "true" : undefined}>
      {children}
      {shown ? (
        <span
          className={`ui-corner-dot-mark pointer-events-none absolute top-ui-4 right-ui-4 size-corner-dot rounded-disc ${CORNER_DOT_INK[tone]}`}
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
    <span className="ui-corner-badge relative inline-flex min-w-0">
      {children}
      <span
        className="ui-corner-badge-mark pointer-events-none absolute -top-ui-6 -right-ui-6 inline-grid size-corner-badge place-items-center rounded-disc border border-border-strong bg-ground text-muted-foreground [&>svg]:size-corner-badge-glyph"
        aria-hidden="true"
      >
        {mark}
      </span>
    </span>
  );
}
