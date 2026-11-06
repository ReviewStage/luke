export const POPOVER_SIDE = {
  ABOVE: "above",
  BELOW: "below",
} as const;

export type PopoverSide = (typeof POPOVER_SIDE)[keyof typeof POPOVER_SIDE];

export const POPOVER_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type PopoverAlign = (typeof POPOVER_ALIGN)[keyof typeof POPOVER_ALIGN];

export const POPOVER_WIDTH = {
  NARROW: "narrow",
  REGULAR: "regular",
  WIDE: "wide",
} as const;

export type PopoverWidth = (typeof POPOVER_WIDTH)[keyof typeof POPOVER_WIDTH];

const POPOVER_GAP = 4;

const POPOVER_MARGIN = 8;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverPlace {
  side: PopoverSide;
  inset: number;
  width: number;
  room: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

export function popoverPlace(input: {
  anchor: Box;
  room: Box;
  width: number;
  height: number;
  align: PopoverAlign;
  side?: PopoverSide | undefined;
}): PopoverPlace {
  const { anchor, room, align } = input;
  const width = Math.min(input.width, room.right - room.left - 2 * POPOVER_MARGIN);
  const low = room.left + POPOVER_MARGIN;
  const high = room.right - POPOVER_MARGIN - width;
  const startLeft = anchor.left;
  const endLeft = anchor.right - width;
  const [asked, other] =
    align === POPOVER_ALIGN.START ? [startLeft, endLeft] : [endLeft, startLeft];
  const fits = (left: number) => left >= low && left <= high;
  const left = fits(asked) ? asked : fits(other) ? other : clamp(asked, low, high);
  const above = anchor.top - room.top - POPOVER_GAP - POPOVER_MARGIN;
  const below = room.bottom - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const wanted = input.side ?? POPOVER_SIDE.ABOVE;
  const [own, across, turned] =
    wanted === POPOVER_SIDE.ABOVE
      ? [above, below, POPOVER_SIDE.BELOW]
      : [below, above, POPOVER_SIDE.ABOVE];
  const turns = own < input.height && (across >= input.height || across > own);
  const side = turns ? turned : wanted;
  const inset = align === POPOVER_ALIGN.START ? left - anchor.left : anchor.right - left - width;
  return { side, inset, width, room: Math.max(side === POPOVER_SIDE.BELOW ? below : above, 0) };
}

export function samePlace(a: PopoverPlace | undefined, b: PopoverPlace): boolean {
  return (
    a !== undefined &&
    a.side === b.side &&
    a.inset === b.inset &&
    a.width === b.width &&
    a.room === b.room
  );
}
