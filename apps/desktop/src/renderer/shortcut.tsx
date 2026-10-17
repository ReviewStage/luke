/**
 * shortcut.tsx -- a chord as the window draws it everywhere: its glyphs set tight and muted, ⇧⌘I, the way a Mac menu prints a key equivalent.
 *
 * One look in every place a chord is shown — a hover, a menu, a sidebar
 * row, ⌘K and its foot, a button, and the Keyboard shortcuts page — so a
 * chord reads the same wherever it is met. A place says only how big and how
 * loud (`--shortcut-text`, `--shortcut-ink`), never draws it some other way.
 * Each key is a glyph of its own (`shortcut-glyph`), so the stylesheet can set
 * a modifier and a letter on one line and centre the chord on the words
 * beside it.
 *
 * Its words are text like any other, so the session recording masks them with
 * the rest.
 */

import { type ShortcutChord, shortcutAccelerator, shortcutGlyphs } from "@luke/settings/shortcuts";
import type React from "react";

/** Which chord: the window's own, or a system-wide key's accelerator as Settings stores it. */
type ShortcutOf =
  | { chord: ShortcutChord; accelerator?: never }
  | { accelerator: string; chord?: never };

export function Shortcut(
  props: ShortcutOf & {
    className?: string;
    /**
     * Whether a reader hears it. Note that it is hidden by default, because a
     * control that shows its chord already says it in `aria-keyshortcuts`; a
     * chord that is a row's whole value, as on the Keyboard shortcuts page, is
     * read.
     */
    spoken?: boolean;
  },
): React.JSX.Element {
  const accelerator =
    props.accelerator === undefined ? shortcutAccelerator(props.chord) : props.accelerator;
  return (
    <kbd
      className={props.className ? `shortcut ${props.className}` : "shortcut"}
      aria-hidden={props.spoken === true ? undefined : "true"}
    >
      {shortcutGlyphs(accelerator).map((glyph) => (
        <span key={glyph} className="shortcut-glyph">
          {glyph}
        </span>
      ))}
    </kbd>
  );
}
