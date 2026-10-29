import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * status-dot.tsx -- a menu row's glyph wearing a dot in a status tone at its lower end corner, as a chat app marks a face online: a device in Runs on's menu.
 *
 * The dot stands on the glyph rather than at the row's end, so a menu with
 * one row checked keeps its end column for the check alone, and no dot
 * floats a column short of the edge beside an empty check room. The glyph
 * has a hole cut under the dot (`status-dot.css`), so the dot reads apart
 * from its strokes on any ground the row stands on. The glyph and its dot say their words to a
 * reader and on hover, since a colour alone says nothing to a reader or an
 * eye that cannot tell the inks apart.
 */

/** `children`, a row's glyph, with a dot in `tone` at its corner, called `label`. */
export function StatusGlyph({
  tone = STATUS_TONE.NEUTRAL,
  label,
  children,
}: {
  tone?: StatusTone | undefined;
  /** What the dot says: the standing it stands for. */
  label: string;
  /** The glyph the dot stands on. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label}>
      <span
        className="luke-status-glyph relative inline-flex"
        data-tone={tone}
        role="img"
        aria-label={label}
      >
        {children}
        <span className="luke-status-glyph-dot" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
