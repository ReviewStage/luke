import {
  COMMAND_KEY,
  commandKeyNow,
  type ShortcutChord,
  shortcutAccelerator,
  shortcutGlyphs,
} from "@repo/settings/shortcuts";
import { cn } from "../../cn.js";
import { Kbd, KbdGroup } from "../../shadcn/kbd.js";

const CHORD =
  "ui-shortcut flex-none gap-[0.04em] [font-family:inherit] text-shortcut font-caption leading-none text-shortcut-ink tabular-nums whitespace-nowrap data-words:gap-ui-4 data-value:[--ui-shortcut-ink:var(--ui-color-text-muted)] data-value:[--ui-shortcut-text:var(--ui-type-label-size)] finger:not-data-value:hidden";

type ShortcutOf =
  | { chord: ShortcutChord; accelerator?: never }
  | { accelerator: string; chord?: never };

export function Shortcut(
  props: ShortcutOf & {
    className?: string;
    spoken?: boolean;
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
        <Kbd key={glyph} className="ui-shortcut-glyph">
          {glyph}
        </Kbd>
      ))}
    </KbdGroup>
  );
}
