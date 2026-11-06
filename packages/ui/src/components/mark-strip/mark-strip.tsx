import type { PointerEvent } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import type { StatusTone } from "../../status-tone.js";

export const MARK_STRIP_LOOK = {
  DOTS: "dots",
  BARS: "bars",
} as const;

export type MarkStripLook = (typeof MARK_STRIP_LOOK)[keyof typeof MARK_STRIP_LOOK];

export interface StripMark {
  readonly tone?: StatusTone | undefined;
  readonly viewed?: boolean | undefined;
  readonly current?: boolean | undefined;
}

const STRIP_CLASS = {
  [MARK_STRIP_LOOK.DOTS]:
    "ui-mark-strip flex min-w-0 flex-1 flex-col items-center gap-ui-4 py-ui-12",
  [MARK_STRIP_LOOK.BARS]: "ui-mark-strip flex min-w-0 flex-1 flex-col items-center gap-0 py-ui-12",
} as const satisfies Record<MarkStripLook, string>;

const MARK_INK =
  "ui-mark-strip-mark [--ui-mark-strip-ink:var(--ui-color-border-strong)] data-tone:[--ui-mark-strip-ink:var(--ui-tone-ink)]";

const MARK_SHAPE = {
  [MARK_STRIP_LOOK.DOTS]: "size-ui-6 flex-none rounded-ui-full bg-mark-strip-ink",
  [MARK_STRIP_LOOK.BARS]:
    "h-auto min-h-0 max-h-ui-6 flex-[1_1_0] bg-[linear-gradient(var(--ui-mark-strip-ink)_0_66%,transparent_66%)]",
} as const satisfies Record<MarkStripLook, string>;

function markClass(look: MarkStripLook, mark: StripMark): string {
  const bar = look === MARK_STRIP_LOOK.BARS;
  const width = bar ? (mark.current === true ? "w-ui-12 min-h-ui-2" : "w-ui-6") : "";
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
  onPress?: (() => void) | undefined;
  onPointerEnter?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  onPointerLeave?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  return (
    <div
      className={onPress === undefined ? STRIP_CLASS[look] : `${STRIP_CLASS[look]} cursor-press`}
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
