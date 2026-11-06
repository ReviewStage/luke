import type { ReactNode } from "react";
import { ICON_SIZE, type IconSize } from "../../icons/icon-size.js";

export const GLYPH_INK = {
  MUTED: "muted",
  TEXT: "text",
  INHERIT: "inherit",
  VOICE: "voice",
} as const;

export type GlyphInk = (typeof GLYPH_INK)[keyof typeof GLYPH_INK];

export const GLYPH_ARRIVAL = {
  STEP: "step",
  CHECK: "check",
} as const;

export type GlyphArrival = (typeof GLYPH_ARRIVAL)[keyof typeof GLYPH_ARRIVAL];

const SLOT_BASE = "ui-glyph-slot inline-flex flex-none items-center justify-center";

const FIT_CLASS = {
  fill: "[&>:is(svg,img)]:size-glyph",
  inset: "[&>:is(svg,img)]:size-glyph-inset",
} as const;

const SEAT_CLASS = {
  [ICON_SIZE.SMALL]: "[--ui-glyph-size:var(--ui-icon-12)] [&>svg]:opacity-100",
  [ICON_SIZE.MEDIUM]: "[--ui-glyph-size:var(--ui-icon-16)] [&>svg]:opacity-100",
  [ICON_SIZE.LARGE]: "[--ui-glyph-size:var(--ui-icon-20)] [&>svg]:opacity-100",
  [ICON_SIZE.EMPTY]: "[--ui-glyph-size:var(--ui-icon-40)] [&>svg]:opacity-100",
} as const satisfies Record<IconSize, string>;

const INK_CLASS = {
  [GLYPH_INK.MUTED]: "text-muted-foreground",
  [GLYPH_INK.TEXT]: "text-foreground",
  [GLYPH_INK.INHERIT]: "",
  [GLYPH_INK.VOICE]: "text-working",
} as const satisfies Record<GlyphInk, string>;

function slotClass(
  ink: GlyphInk,
  size: IconSize | undefined,
  line: boolean,
  inset: boolean,
): string {
  return [
    SLOT_BASE,
    inset ? FIT_CLASS.inset : FIT_CLASS.fill,
    line ? "w-glyph h-lh" : "size-glyph",
    size === undefined ? "" : SEAT_CLASS[size],
    INK_CLASS[ink],
  ]
    .filter((part) => part !== "")
    .join(" ");
}

export function GlyphSlot({
  ink = GLYPH_INK.MUTED,
  size,
  line = false,
  inset = false,
  label,
  arrival,
  children,
}: {
  ink?: GlyphInk;
  size?: IconSize | undefined;
  line?: boolean | undefined;
  inset?: boolean | undefined;
  label?: string | undefined;
  arrival?: GlyphArrival | undefined;
  children: ReactNode;
}): React.JSX.Element {
  if (label === undefined) {
    return (
      <span
        className={slotClass(ink, size, line, inset)}
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
      className={slotClass(ink, size, line, inset)}
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
