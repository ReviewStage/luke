import {
  COMMAND_KEY,
  commandKeyNow,
  type ShortcutChord,
  shortcutAccelerator,
  shortcutGlyphs,
} from "@luke/settings/shortcuts";
import { cn } from "../../cn.js";
import { Kbd, KbdGroup } from "../../shadcn/kbd.js";

/**
 * shortcut.tsx -- a chord as the window draws it everywhere: its glyphs set tight and muted, ⇧⌘I, the way a Mac menu prints a key equivalent, or its words spaced, Ctrl Shift I, where Command is Ctrl.
 *
 * One look in every place a chord is shown — a hover, a menu, a sidebar
 * row, ⌘K and its foot, a button, and the Keyboard shortcuts page — so a
 * chord reads the same wherever it is met. A place says only how big and how
 * loud (`--luke-shortcut-text`, `--luke-shortcut-ink`), never draws it some
 * other way. Each key is a glyph of its own (`luke-shortcut-glyph`), so the
 * stylesheet can set a modifier and a letter on one line and centre the
 * chord on the words beside it. Where the window's command key is Ctrl, in a
 * browser on Windows or Linux (`COMMAND_KEY`), the modifiers are words, and
 * words set tight would run together, so the chord says so (`data-words`)
 * and the stylesheet spaces them.
 *
 * Its words are text like any other, so the session recording masks them with
 * the rest.
 *
 * It is drawn by shadcn/ui's kbd (`../../shadcn/kbd.tsx`), the chord its
 * group and each key a `Kbd`, in the Tailwind theme's utilities: muted, in
 * the caption's size and weight unless the place's hooks say otherwise, the
 * window's own face rather than the user agent's monospace (a menu prints
 * ⌘, ⇧, ⌥, arrows, ⌫, and ⏎ in the system face, on the capitals' line),
 * digits and letters at one advance so ⌘1 and ⌘5 are one width, and a hair
 * between the keys as a gap rather than letter-spacing, which would leave
 * the hair after the last key too. Under a finger there is no keyboard to
 * press a chord on, so a chord shown as a hint is not drawn; a value still
 * is, and a tablet worked with a trackpad keeps its hints.
 */

/** The chord's look, every place's: set tight in the hooks' size and ink, spaced a word apart where its keys are words, and a row's value at the label's size in the value's ink. */
const CHORD =
  "luke-shortcut flex-none gap-[0.04em] [font-family:inherit] text-shortcut font-caption leading-none text-shortcut-ink tabular-nums whitespace-nowrap data-words:gap-luke-4 data-value:[--luke-shortcut-ink:var(--luke-color-text-muted)] data-value:[--luke-shortcut-text:var(--luke-type-label-size)] finger:not-data-value:hidden";

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
    /**
     * Whether the chord is a row's whole value, as on the Keyboard shortcuts
     * page: set at the row's label size in the value's ink, and drawn under a
     * finger too, where a chord shown as a hint is not.
     */
    value?: boolean;
  },
): React.JSX.Element {
  const accelerator =
    props.accelerator === undefined ? shortcutAccelerator(props.chord) : props.accelerator;
  return (
    <KbdGroup
      className={cn(CHORD, props.className)}
      data-value={props.value === true ? "" : undefined}
      data-words={commandKeyNow() === COMMAND_KEY.CONTROL ? "" : undefined}
      aria-hidden={props.spoken === true ? undefined : "true"}
    >
      {shortcutGlyphs(accelerator).map((glyph) => (
        <Kbd key={glyph} className="luke-shortcut-glyph">
          {glyph}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
